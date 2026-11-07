// river/1 and shore/1: water as systems. Owner: L3. Spec <eden4>/29 WP3, 33 §2 row 6.
//   - `snapRiver` (pure; the skill or the compiler calls it) snaps the ends into lakes/ponds within
//     reach, takes the source and mouth levels from them, and freezes a monotone water profile that
//     follows the ground downhill (flow from the first point to the last) into params.flow, with
//     waterfalls where the surface drops more than 1 m in one step;
//   - physics carves the bed with a `channel` (cut) to level − depth per point, lays path water with
//     per-point levels (the ground's water record), and emits shore bands as surfaces;
//   - shore/1 rings a lake or pond with a sand / stone / pebble band.
import { pointInPoly, type Water } from '@souls/ground';
import { bounds2, boxOfBounds, n } from './geom.ts';
import { arcLengths, band, distSeg, hyp, pathSig, round2, smoothPath, type AbsSurface, type TerrainQuery } from './terrain-query.ts';
import type { Baked, Generator, Shape, Vec2 } from './types.ts';
import type { Value } from './fields.ts';

export type Fall = { s: number; top: number; bottom: number; i: number };
export type Flow = { sig: string; levels: number[]; falls?: Fall[]; source?: string; mouth?: string };

const pathOf = (shape: Shape | undefined): Vec2[] => shape?.path ?? [[-5, 0], [5, 0]];
export const riverLine = (shape: Shape | undefined): Vec2[] => smoothPath(pathOf(shape), 2, 400);
export function flowOf(params: Record<string, Value>, shape: Shape | undefined, c: Vec2[]): Flow | null {
  const f = params.flow as Flow | null | undefined;
  if (!f || typeof f !== 'object' || f.sig !== pathSig(pathOf(shape)) || !Array.isArray(f.levels) || f.levels.length !== c.length) return null;
  return f;
}
const BANK: Record<string, string> = { grass: 'grass', sand: 'sand', stone: 'stone', reeds: 'mud', pebble: 'gravel' };

export const riverGen: Generator = {
  id: 'river/1', form: 'path', owner: 'L3', doc: 'A river along a path: carves a bed, fills it with water flowing from the first point to the last (snapRiver freezes levels, snaps the ends into lakes); waterfalls where the bed steps; shores.',
  params: {
    width: { type: 'number', min: 1, max: 60, default: 6 }, depth: { type: 'number', min: 0.2, max: 10, default: 1.2 },
    level: { type: 'number', min: -50, max: 400, default: -0.3, doc: 'water level at the source (used flat until snapRiver freezes a profile)' },
    banks: { type: 'enum', values: ['grass', 'sand', 'stone', 'reeds', 'pebble'], default: 'grass' },
    bankWidth: { type: 'number', min: 0, max: 12, default: 2.5 },
    flow: { type: 'json', doc: 'frozen by snapRiver: {sig, levels[] per centre-line point, falls[], source, mouth}' },
  },
  physics({ params, shape }) {
    const c = riverLine(shape), s = arcLengths(c), W = n(params.width, 6), depth = n(params.depth, 1.2), bankW = n(params.bankWidth, 2.5);
    const f = flowOf(params, shape, c);
    const L = f ? f.levels : c.map(() => n(params.level, -0.3));
    const low = Math.min(...L);
    const surfaces: AbsSurface[] = [];
    const mat = BANK[String(params.banks ?? 'grass')] ?? 'grass';
    if (bankW > 0) surfaces.push({ level: 0, y: 0.02, polygon: band(c, W / 2 + bankW, W / 2 - 0.4), material: mat, tag: 'shore' }, { level: 0, y: 0.02, polygon: band(c, -W / 2 + 0.4, -W / 2 - bankW), material: mat, tag: 'shore' });
    const water = { level: low, path: c, width: W, levels: L };
    const notes = [`flows ${s[s.length - 1].toFixed(0)} m from ${L[0].toFixed(2)} to ${L[L.length - 1].toFixed(2)} m${f ? '' : ' (flat: not snapped)'}`];
    for (const fall of f?.falls ?? []) notes.push(`waterfall at ${fall.s.toFixed(0)} m: ${fall.top.toFixed(1)} → ${fall.bottom.toFixed(1)} m`);
    if (f?.source) notes.push(`source: ${f.source}`); if (f?.mouth) notes.push(`mouth: ${f.mouth}`);
    return {
      box: boxOfBounds(bounds2(c, W / 2 + bankW), depth + 1), colliders: [], slots: [], surfaces,
      landform: { kind: 'channel', path: c, levels: L.map((l) => l - depth), w: W * 0.3, edge: W * 0.35 + 1.5, mode: 'cut' },
      water, tris: c.length * 8, notes,
    };
  },
};

/** Nearest point on a polygon's boundary. */
function nearestEdge(p: Vec2, poly: Vec2[]): { d: number; e: Vec2 } {
  let best = Infinity, e: Vec2 = poly[0];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], vx = b[0] - a[0], vz = b[1] - a[1], nn = vx * vx + vz * vz;
    let t = nn ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / nn : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q: Vec2 = [a[0] + vx * t, a[1] + vz * t], d = hyp(p[0] - q[0], p[1] - q[1]);
    if (d < best) { best = d; e = q; }
  }
  return { d: best, e };
}
function centroid(poly: Vec2[]): Vec2 { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }

/** Snap one end into the nearest area water within reach: returns the moved point and the body. */
function snapEnd(p: Vec2, waters: Water[], reach: number, into: number): { p: Vec2; body?: Water } {
  let best: { d: number; w: Water; e: Vec2 } | null = null;
  for (const w of waters) {
    if (!w.area) continue;
    if (pointInPoly(p[0], p[1], w.area)) return { p, body: w };
    const ne = nearestEdge(p, w.area);
    if (ne.d <= reach && (!best || ne.d < best.d)) best = { d: ne.d, w, e: ne.e };
  }
  if (!best) return { p };
  const area = best.w.area!;
  let dx = best.e[0] - p[0], dz = best.e[1] - p[1], l = hyp(dx, dz);
  if (l < 1e-6) { const c = centroid(area); dx = c[0] - p[0]; dz = c[1] - p[1]; l = hyp(dx, dz) || 1; }
  let q: Vec2 = [best.e[0] + (dx / l) * into, best.e[1] + (dz / l) * into];
  if (!pointInPoly(q[0], q[1], area)) { const c = centroid(area); const cx = c[0] - best.e[0], cz = c[1] - best.e[1], cl = hyp(cx, cz) || 1; q = [best.e[0] + (cx / cl) * into, best.e[1] + (cz / cl) * into]; }
  return { p: [round2(q[0]), round2(q[1])], body: best.w };
}

/**
 * Snap a river's ends into the lakes/ponds within `reach` m and freeze its flow from the ground.
 * Returns the (possibly moved) control path and params to merge: `{ flow, level }`.
 * Levels: the source body's level (or the ground at a spring − 0.3), then down the valley never
 * above the ground − 0.35 and never rising (flow), never below the mouth body's level.
 */
export function snapRiver(q: TerrainQuery, path: Vec2[], params: Record<string, Value> = {}, opts: { reach?: number } = {}): { path: Vec2[]; params: { flow: Flow; level: number } } {
  const W = n(params.width, 6), reach = opts.reach ?? 30;
  const ctrl = path.map((p) => [p[0], p[1]] as Vec2);
  const a = snapEnd(ctrl[0], q.waters, reach, W * 0.5 + 3), b = snapEnd(ctrl[ctrl.length - 1], q.waters, reach, W * 0.5 + 3);
  ctrl[0] = a.p; ctrl[ctrl.length - 1] = b.p;
  const c = smoothPath(ctrl, 2, 400), s = arcLengths(c), N = c.length;
  const ground = c.map(([x, z]) => q.height(x, z));
  const source = a.body ? a.body.level : ground[0] - 0.3;
  let mouth = b.body ? b.body.level : ground[N - 1] - 0.35;
  if (mouth > source) mouth = source;
  const inBody = (i: number, w?: Water) => !!w?.area && pointInPoly(c[i][0], c[i][1], w.area);
  const L: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    if (inBody(i, a.body)) { L[i] = source; continue; }
    if (inBody(i, b.body)) { L[i] = mouth; continue; }
    const prev = i ? L[i - 1] : source;
    let l = Math.min(prev, ground[i] - 0.35);
    if (l < mouth) l = mouth;
    L[i] = l;
  }
  // the last points inside the mouth body sit at its level even if the ground before was lower
  const falls: Fall[] = [];
  for (let i = 1; i < N; i++) if (L[i - 1] - L[i] > 1) falls.push({ s: round2(s[i]), top: round2(L[i - 1]), bottom: round2(L[i]), i });
  return { path: ctrl, params: { level: round2(source), flow: { sig: pathSig(ctrl), levels: L.map(round2), falls, ...(a.body ? { source: a.body.id } : {}), ...(b.body ? { mouth: b.body.id } : {}) } } };
}

/** Distance from a point to a river's water edge (for scatter rules), 0 inside. */
export function distToRiver(x: number, z: number, c: Vec2[], W: number): number { let best = Infinity; for (let i = 1; i < c.length; i++) best = Math.min(best, distSeg(x, z, c[i - 1], c[i])); return Math.max(0, best - W / 2); }

/** Offset a closed polygon outward by d (negative inward), mitred and clamped. */
export function offsetRing(poly: Vec2[], d: number): Vec2[] {
  let area = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  const ccw = area < 0 ? 1 : -1; // orientation in x/z
  return poly.map((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = hyp(e1[0], e1[1]) || 1, l2 = hyp(e2[0], e2[1]) || 1;
    const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = hyp(mx, mz) || 1; mx /= ml; mz /= ml;
    const cos = mx * n1[0] + mz * n1[1], k = Math.min(2.5, 1 / Math.max(0.4, cos));
    return [p[0] - ccw * mx * d * k, p[1] - ccw * mz * d * k] as Vec2;
  });
}

export const shoreGen: Generator = {
  id: 'shore/1', form: 'area', owner: 'L3', doc: 'A shore band around a lake or pond outline (the area): sand beach, stone edge, pebbles or reeds; a surface ring from `inner` m inside to `width` m outside.',
  params: {
    material: { type: 'enum', values: ['sand', 'stone', 'pebble', 'grass', 'reeds'], default: 'sand' },
    width: { type: 'number', min: 0.5, max: 20, default: 3 }, inner: { type: 'number', min: 0, max: 10, default: 1.5 },
  },
  physics({ params, shape }) {
    const area = shape?.area ?? ([[-10, -10], [10, -10], [10, 10], [-10, 10]] as Vec2[]);
    const wOut = n(params.width, 3), wIn = n(params.inner, 1.5), outer = offsetRing(area, wOut), inner = offsetRing(area, -wIn);
    const mat = BANK[String(params.material ?? 'sand')] ?? 'sand';
    const surfaces: AbsSurface[] = area.map((_, i) => { const j = (i + 1) % area.length; return { level: 0, y: 0.02, polygon: [inner[i], inner[j], outer[j], outer[i]], material: mat, tag: 'shore' }; });
    return { box: boxOfBounds(bounds2(outer), 0.3), colliders: [], slots: [], surfaces, tris: area.length * 6 };
  },
};

export const RIVER_GENERATORS = [riverGen, shoreGen];
