// bridge/1, pier/1, deck/1: things on posts over water or a gap. Owner: L3. Spec 29 WP3.
// Heights are frozen from the ground by prepareBridge / prepareDeck into params.at (absolute
// metres, `abs: true` on the surfaces and rails); without it the surfaces are ground-relative and
// the viewer derives the same heights from the terrain (ground is the only height source).
import { pointInPoly } from '@souls/ground';
import { bounds2, boxOfBounds, n } from './geom.ts';
import { deckAt, type Span } from './road.ts';
import { arcLengths, band, hyp, pathSig, round2, smoothPath, subPath, type AbsOBB, type AbsSurface, type TerrainQuery } from './terrain-query.ts';
import type { Baked, Generator, Shape, Vec2 } from './types.ts';
import type { Value } from './fields.ts';

export type At = { sig: string; y0?: number; y1?: number; y?: number };
const sigOfShape = (shape: Shape | undefined) => pathSig(shape?.path ?? shape?.area ?? []);
export function atOf(params: Record<string, Value>, shape: Shape | undefined): At | null { const a = params.at as At | null | undefined; return a && typeof a === 'object' && a.sig === sigOfShape(shape) ? a : null; }

/** Rails along both edges of a centre line at absolute deck heights (one collider per ≈2 m). */
function railsAlong(c: Vec2[], s: number[], w: number, yAt: (q: number) => number, open: (q: number, side: number) => boolean = () => false): AbsOBB[] {
  const out: AbsOBB[] = [];
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i], dx = b[0] - a[0], dz = b[1] - a[1], len = hyp(dx, dz) || 1, yaw = Math.atan2(-dz / len, dx / len), y = yAt((s[i - 1] + s[i]) / 2);
    for (const side of [1, -1]) if (!open((s[i - 1] + s[i]) / 2, side)) out.push({ c: [(a[0] + b[0]) / 2 - (dz / len) * side * w / 2, (a[1] + b[1]) / 2 + (dx / len) * side * w / 2], half: [len / 2, 0.06], yaw, y0: y, y1: y + 1.0, tag: 'rail', abs: true });
  }
  return out;
}
function deckQuads(c: Vec2[], s: number[], w: number, yAt: (q: number) => number, mat: string, tag: string, abs: boolean): AbsSurface[] {
  const out: AbsSurface[] = [];
  for (let i = 1; i < c.length; i++) out.push({ level: 0, y: yAt((s[i - 1] + s[i]) / 2), polygon: band([c[i - 1], c[i]], w / 2, -w / 2), material: mat, tag, abs });
  return out;
}

export function bridgeSpan(at: At | null, total: number, deck: number, arch: number): Span { return { from: 0, to: total, y0: at?.y0 ?? 0, y1: at?.y1 ?? 0, rise: deck + arch }; }

export const bridgeGen: Generator = {
  id: 'bridge/1', form: 'path', owner: 'L3', doc: 'A bridge along a short path over water or a gap: ends on the banks, a humped deck (deck + arch at mid-span), rails, posts or a stone arch to the bed.',
  params: {
    width: { type: 'number', min: 1, max: 20, default: 3 }, deck: { type: 'number', min: 0, max: 20, default: 0.8, doc: 'extra height at mid-span above the line between the ends' },
    material: { type: 'enum', values: ['wood', 'stone', 'metal'], default: 'wood' }, arch: { type: 'number', min: 0, max: 6, default: 0.6, doc: 'additional rise at mid-span' },
    rails: { type: 'bool', default: true }, at: { type: 'json', doc: 'frozen by prepareBridge: {sig, y0, y1} absolute end heights' },
  },
  physics({ params, shape }) {
    const c = smoothPath(shape?.path ?? [[-5, 0], [5, 0]], 1.5, 120), s = arcLengths(c), total = s[s.length - 1], w = n(params.width, 3);
    const at = atOf(params, shape), sp = bridgeSpan(at, total, n(params.deck, 0.8), n(params.arch, 0.6)), yAt = (q: number) => deckAt(sp, q);
    const mat = String(params.material ?? 'wood');
    return {
      box: boxOfBounds(bounds2(band(c, w / 2, -w / 2)), sp.rise + 1.2), slots: [],
      surfaces: deckQuads(c, s, w, yAt, mat, 'bridge', !!at),
      colliders: params.rails === false ? [] : railsAlong(c, s, w, yAt).map((r) => ({ ...r, abs: !!at })),
      tris: c.length * 60, notes: [at ? `deck ${sp.y0.toFixed(1)} → ${(Math.max(sp.y0, sp.y1) + sp.rise).toFixed(1)} → ${sp.y1.toFixed(1)} m` : 'deck heights relative (run prepareBridge)'],
    };
  },
};

export const pierGen: Generator = {
  id: 'pier/1', form: 'path', owner: 'L3', doc: 'A pier / jetty / boardwalk on posts: from the shore out over water along a path, a flat deck `height` above the water, rails, an end platform.',
  params: {
    width: { type: 'number', min: 1, max: 8, default: 2.4 }, height: { type: 'number', min: 0.2, max: 6, default: 0.7, doc: 'deck above the water (or above the ground at the start when dry)' },
    rails: { type: 'bool', default: true }, platform: { type: 'number', min: 0, max: 16, default: 5, doc: 'end platform size (0 = none)' },
    color: { type: 'color', default: '#a07a4f' }, at: { type: 'json', doc: 'frozen by prepareDeck: {sig, y}' },
  },
  physics({ params, shape }) {
    const c = smoothPath(shape?.path ?? [[-5, 0], [5, 0]], 2, 200), s = arcLengths(c), w = n(params.width, 2.4), pl = n(params.platform, 5);
    const at = atOf(params, shape), y = at?.y ?? n(params.height, 0.7), yAt = () => y, abs = !!at;
    const surfaces = deckQuads(c, s, w, yAt, 'wood', 'pier', abs);
    const end = c[c.length - 1], prev = c[Math.max(0, c.length - 2)];
    let plat: Vec2[] | null = null;
    if (pl > 0) { const dx = end[0] - prev[0], dz = end[1] - prev[1], l = hyp(dx, dz) || 1, ux = dx / l, uz = dz / l; const h = pl / 2; plat = [[end[0] - uz * h, end[1] + ux * h], [end[0] - uz * h + ux * pl, end[1] + ux * h + uz * pl], [end[0] + uz * h + ux * pl, end[1] - ux * h + uz * pl], [end[0] + uz * h, end[1] - ux * h]]; surfaces.push({ level: 0, y, polygon: plat, material: 'wood', tag: 'pier', abs }); }
    const rails = params.rails === false ? [] : railsAlong(c, s, w, yAt, (q) => q < 3).map((r) => ({ ...r, abs }));
    return { box: boxOfBounds(bounds2([...band(c, w / 2, -w / 2), ...(plat ?? [])]), y + 1.2), colliders: rails, surfaces, slots: plat ? [{ id: 'end', kind: 'stand', p: [end[0], y, end[1]], yaw: 0, accepts: {}, capacity: 12 }] : [], tris: c.length * 40, notes: [abs ? `deck at ${y.toFixed(2)} m` : 'deck height relative (run prepareDeck)'] };
  },
};

const areaOf = (shape: Shape | undefined): Vec2[] => shape?.area ?? [[-5, -5], [5, -5], [5, 5], [-5, 5]];
/** A deck this far or more above the ground (or water) under it has rails and is an upper floor of its own: walked onto by
 *  stairs, ramps or ladders, never stepped up onto from the ground. Lower decks are slabs on the ground (walked straight on). */
export const DECK_RAISED = 0.4;
export const deckRaised = (params: Record<string, Value>): boolean => n(params.height, 0.6) >= DECK_RAISED;
/** Where the rail along a→b opens for a stair, ramp or ladder end at `p` (within `reach` of the line and its span): intervals in
 *  metres from a, merged, each the end's width plus 0.3 m. Shared by the engine bridge (rail solids) and the deck picture. */
export function railGaps(a: Vec2, b: Vec2, ends: { p: Vec2; width: number }[], reach = 0.6): [number, number][] {
  const len = hyp(b[0] - a[0], b[1] - a[1]); if (len < 1e-6) return [];
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, out: [number, number][] = [];
  for (const e of ends) {
    const dx = e.p[0] - a[0], dz = e.p[1] - a[1], t = dx * ux + dz * uz, d = Math.abs(-dx * uz + dz * ux), g = e.width / 2 + 0.15;
    if (d > reach || t < -g || t > len + g) continue;
    out.push([Math.max(0, t - g), Math.min(len, t + g)]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const iv of out) { const last = merged[merged.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push([...iv]); }
  return merged;
}
export const deckGen: Generator = {
  id: 'deck/1', form: 'area', owner: 'L3', doc: 'A raised platform on posts (deck, terrace, jetty head) over ground or water; walkable surface with rails on the open edges.',
  params: {
    height: { type: 'number', min: 0, max: 12, default: 0.6, doc: 'above the highest ground under it, or above the water' },
    material: { type: 'enum', values: ['wood', 'stone', 'metal'], default: 'wood' }, rails: { type: 'bool', default: true },
    color: { type: 'color', default: '#a07a4f' }, at: { type: 'json', doc: 'frozen by prepareDeck: {sig, y}' },
  },
  physics({ params, shape }) {
    const area = areaOf(shape), at = atOf(params, shape), y = at?.y ?? n(params.height, 0.6), abs = !!at;
    const ring = [...area, area[0]], s = arcLengths(ring);
    const rails = params.rails === false || !deckRaised(params) ? [] : railsAlong(ring, s, 0, () => y).filter((_, i) => i % 2 === 0).map((r) => ({ ...r, abs }));
    return { box: boxOfBounds(bounds2(area), y + 1), colliders: rails, surfaces: [{ level: 0, y, polygon: area, material: String(params.material ?? 'wood'), tag: 'deck', abs } as AbsSurface], slots: [], tris: area.length * 40 };
  },
};

/** Freeze a bridge's end heights from the ground: each end sits on its bank. */
export function prepareBridge(q: TerrainQuery, path: Vec2[]): { at: At } {
  const a = path[0], b = path[path.length - 1];
  return { at: { sig: pathSig(path), y0: round2(q.height(a[0], a[1]) + 0.12), y1: round2(q.height(b[0], b[1]) + 0.12) } };
}
/** Freeze a deck's or pier's height: `height` above the highest water under it, or above the ground at its landward end when dry. */
export function prepareDeck(q: TerrainQuery, shape: { path?: Vec2[]; area?: Vec2[] }, params: Record<string, Value> = {}): { at: At } {
  const h = n(params.height, shape.path ? 0.7 : 0.6);
  const pts = shape.path ? smoothPath(shape.path, 2, 200) : areaSamples(shape.area!);
  let water = -Infinity, ground = -Infinity;
  for (const [x, z] of pts) { const lv = q.waterLevel(x, z), g = q.height(x, z); if (lv !== null && lv > g) water = Math.max(water, lv); else ground = Math.max(ground, g); }
  const start = shape.path ? q.height(shape.path[0][0], shape.path[0][1]) + 0.15 : -Infinity;
  const y = Math.max(water > -Infinity ? water + h : -Infinity, shape.path ? start : ground + h);
  return { at: { sig: pathSig(shape.path ?? shape.area!), y: round2(Number.isFinite(y) ? y : h) } };
}
function areaSamples(area: Vec2[]): Vec2[] {
  const [x0, z0, x1, z1] = bounds2(area), out: Vec2[] = [...area];
  const st = Math.max(1, Math.max(x1 - x0, z1 - z0) / 12);
  for (let x = x0; x <= x1; x += st) for (let z = z0; z <= z1; z += st) if (pointInPoly(x, z, area)) out.push([x, z]);
  return out;
}

export { subPath };
export const BRIDGE_GENERATORS = [bridgeGen, pierGen, deckGen];
