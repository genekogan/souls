// GOD-ENV: the god shapes the land. One verb → ordinary god ops over the existing landform defs (core/brush, knoll, hill,
// mountain, plateau, cliff, channel, terrace, the waters' `level`) plus `move` and `expand` — so every land edit is
// validated by the compiler, journaled with its inverse (undo/redo), broadcast to viewers as a world diff (terrain tiles),
// re-derived for the engine (ground fact: Souls stand and walk on the new ground) and for the Souls' map (places.ts).
//
//   POST /v1/god/land { verb, …, preview?: true }   (god token)
//
// verbs   raise | lower | smooth | flatten       at, radius, amount (smooth 0..1), level (flatten; default the ground there)
//         knoll | hill | mountain               at, height, radius, peak, name        (a point; a path makes a ridge/range)
//         plateau                               area, height, edge, name
//         terrace                               area, level | step, name
//         valley | ditch                        path, depth, width, edge, name        (cut below the ground along the path)
//         cliff                                 path, height, side (1 left / −1 right), face, steps, name
//         move                                  ref (a landform or anything), by [dx, dz] | to [x, z]
//         water                                 ref (a pond / lake / river), level (absolute m) | by (m); the bed stays
//         extend                                toward n|s|e|w|ne|…, metres  (or bounds [x0, z0, x1, z1])
//
// Placed things stay grounded: the compiler re-settles every root thing on a changed tile (benches rise with a raised
// ground, a house gets its foundation pad); a thing that cannot be re-settled (or a Soul it would bury) refuses the edit,
// so nothing is left floating or buried. `preview: true` plans without committing and answers the same report: tiles,
// how much ground rises and falls, which things move and by how much, the bounds before → after.
import type { Context, Hono } from 'hono';
import { applyBatch, boundsOf, type Entity, type WorldModel } from '@souls/world-compiler';
import { TILE_M } from '@souls/ground';
import { CREATION_LIMITS } from '@souls/generators';
import { godTokenLimiter } from './rate-limit.ts';
import { ApiError } from '../souls.ts';
import type { GodMode } from './god.ts';
import { callerOf } from './builds.ts';

type V2 = [number, number];
/** An op as a client writes it (the compiler fills defaults: in, mode). */
type OpIn = { op: string; [k: string]: unknown };
export type LandInput = {
  verb: string; preview?: boolean; note?: string; group?: string; name?: string; force?: boolean;
  at?: V2 | string; radius?: number; amount?: number; level?: number; height?: number; peak?: number; edge?: number; step?: number;
  path?: V2[]; width?: number; depth?: number; side?: number; face?: number; steps?: number;
  area?: V2[];
  ref?: string; by?: V2 | number; to?: V2 | string;
  toward?: string; metres?: number; bounds?: [number, number, number, number];
};
export type LandReport = {
  accepted: boolean; verb: string; preview: boolean; ops: OpIn[];
  seq?: number; undoId?: string; failures?: { op: number; code: string; detail: string }[]; warnings: string[];
  tiles: number; ground: { raisedM: number; loweredM: number; changedM2: number; at?: V2 } | null;
  moved: { id: string; path: string; dy: number; dxz: number }[];
  bounds: { before: number[]; after: number[] } | null;
  says: string;
};

const COMPASS: Record<string, V2> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };
const WORDS: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };
const r2 = (v: number) => Math.round(v * 100) / 100;
const bad = (m: string) => new ApiError(400, 'invalid', m);
const num = (v: unknown, name: string, lo: number, hi: number, dflt?: number): number => {
  if (v === undefined || v === null) { if (dflt === undefined) throw bad(`${name} is required`); return dflt; }
  const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw bad(`${name} is ${lo} … ${hi}`); return x;
};
const v2 = (v: unknown, name: string): V2 => {
  if (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(Number(x)))) return [Number(v[0]), Number(v[1])];
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(v)) { const [a, b] = v.split(',').map(Number); return [a, b]; }
  throw bad(`${name} is [x, z]`);
};
const poly = (v: unknown, name: string, min: number): V2[] => { if (!Array.isArray(v) || v.length < min || v.length > 512) throw bad(`${name} is ${min}…512 points [[x, z], …]`); return v.map((p, i) => v2(p, `${name}[${i}]`)); };
const centre = (pts: V2[]): V2 => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/** A point from [x, z], "x,z" or the name/path of a thing (its position). */
function pointOf(m: WorldModel, v: unknown, name: string): V2 {
  if (typeof v === 'string' && !/^\s*-?\d/.test(v)) {
    const e = m.get(v); if (!e) throw bad(`${name}: no thing called ${v}`);
    const sh = e.shape as { area?: V2[]; path?: V2[] } | undefined;
    if (sh?.area) return centre(sh.area); if (sh?.path) return centre(sh.path);
    const p = m.worldPose(e); return [p.x, p.z];
  }
  return v2(v, name);
}
/** A name nobody at the root has yet: `mountain`, `mountain-2`, … */
function freeName(m: WorldModel, base: string): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'land';
  if (!m.names.has(`world/${stem}`)) return stem;
  for (let k = 2; k < 1000; k++) if (!m.names.has(`world/${stem}-${k}`)) return `${stem}-${k}`;
  return `${stem}-${Date.now() % 100000}`;
}
/** Resample a polyline every ≈ `step` m (at most 120 points), keeping its corners. */
function resample(path: V2[], step = 6): V2[] {
  const out: V2[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([r2(a[0] + ((b[0] - a[0]) * k) / n), r2(a[1] + ((b[1] - a[1]) * k) / n)]);
  }
  if (out.length <= 120) return out;
  const every = Math.ceil(out.length / 120); return out.filter((_, i) => i % every === 0 || i === out.length - 1);
}
const shiftShape = (sh: NonNullable<Entity['shape']>, dx: number, dz: number): NonNullable<Entity['shape']> => ('area' in sh ? { area: sh.area.map(([x, z]) => [r2(x + dx), r2(z + dz)] as V2) } : { ...sh, path: sh.path.map(([x, z]) => [r2(x + dx), r2(z + dz)] as V2) });

/** The ops one land verb means on this world (pure; throws ApiError 400 on bad input). */
export function landOps(m: WorldModel, b: LandInput): { ops: OpIn[]; centre?: V2 } {
  const verb = String(b.verb ?? '').toLowerCase();
  const name = (base: string) => (b.name ? String(b.name) : freeName(m, base));
  switch (verb) {
    case 'raise': case 'lower': case 'smooth': case 'flatten': {
      const at = pointOf(m, b.at, 'at'), radius = num(b.radius, 'radius', 1, 400, 12);
      const amount = verb === 'smooth' || verb === 'flatten' ? num(b.amount, 'amount', 0, 1, 1) : num(b.amount, 'amount', 0, 60, 3);
      const level = verb === 'flatten' ? num(b.level, 'level', -200, 400, r2(m.terrain.sample(at[0], at[1]))) : undefined;
      return { centre: at, ops: [{ op: 'place', def: 'core/brush@1', p: at, params: { op: verb, radius, amount, ...(level !== undefined ? { level } : {}) }, ...(b.name ? { name: String(b.name) } : {}) } as OpIn] };
    }
    case 'knoll': case 'hill': case 'mountain': {
      const lim = { knoll: [0.5, 15, 4, 5, 60, 18], hill: [5, 60, 25, 20, 300, 80], mountain: [40, 400, 180, 60, 1200, 200] }[verb]!;
      const params = { height: num(b.height, 'height', lim[0], lim[1], lim[2]), radius: num(b.radius, 'radius', lim[3], lim[4], lim[5]), ...(b.peak !== undefined ? { peak: num(b.peak, 'peak', 0.25, 6) } : {}) };
      if (b.path) { const path = poly(b.path, 'path', 2); return { centre: centre(path), ops: [{ op: 'place', def: `core/${verb}@1`, name: name(verb === 'mountain' ? 'range' : 'ridge'), shape: { path, width: params.radius }, params } as OpIn] }; }
      const at = pointOf(m, b.at, 'at');
      return { centre: at, ops: [{ op: 'place', def: `core/${verb}@1`, name: name(verb), p: at, params } as OpIn] };
    }
    case 'plateau': {
      const area = poly(b.area, 'area', 3);
      return { centre: centre(area), ops: [{ op: 'place', def: 'core/plateau@1', name: name('plateau'), shape: { area }, params: { height: num(b.height, 'height', 0.5, 60, 4), edge: num(b.edge, 'edge', 1, 100, 10) } } as OpIn] };
    }
    case 'terrace': {
      const area = poly(b.area, 'area', 3);
      const params: Record<string, number | string> = { edge: num(b.edge, 'edge', 0.5, 60, 4) };
      if (b.step !== undefined) params.step = num(b.step, 'step', 0.3, 20); else { const c = centre(area); params.level = num(b.level, 'level', -200, 400, r2(m.terrain.sample(c[0], c[1]))); }
      return { centre: centre(area), ops: [{ op: 'place', def: 'core/terrace@1', name: name('terrace'), shape: { area }, params } as OpIn] };
    }
    case 'valley': case 'ditch': {
      const ctrl = poly(b.path, 'path', 2), path = resample(ctrl, verb === 'ditch' ? 3 : 6);
      const depth = num(b.depth, 'depth', 0.2, 120, verb === 'ditch' ? 1 : 8), width = num(b.width, 'width', 0.5, 200, verb === 'ditch' ? 1.2 : 8);
      const edge = num(b.edge, 'edge', 0.5, 60, verb === 'ditch' ? 0.8 : Math.min(60, Math.max(4, depth * 2.5)));
      // cut to the ground less `depth` at each point, never rising downstream of where it started (water runs along it)
      const levels = path.map(([x, z]) => r2(m.terrain.sample(x, z) - depth));
      return { centre: centre(ctrl), ops: [{ op: 'place', def: 'core/channel@1', name: name(verb), shape: { path }, params: { width, edge, levels, mode: 'cut' } } as OpIn] };
    }
    case 'cliff': {
      const path = poly(b.path, 'path', 2);
      const params = { height: num(b.height, 'height', -120, 200, 10), side: num(b.side, 'side', -1, 1, 1) < 0 ? -1 : 1, face: num(b.face, 'face', 0.5, 60, 3), steps: Math.round(num(b.steps, 'steps', 1, 12, 1)), shelf: num(b.width, 'width', 0, 400, 30) };
      return { centre: centre(path), ops: [{ op: 'place', def: 'core/cliff@1', name: name('cliff'), shape: { path }, params } as OpIn] };
    }
    case 'move': {
      if (typeof b.ref !== 'string') throw bad('move needs ref (the landform or thing to move)');
      const e = m.get(b.ref); if (!e) throw bad(`no thing called ${b.ref}`);
      if (e.in.parent !== 'world') throw bad(`${b.ref} is inside ${m.pathOf(e.in.parent)}; move that instead`);
      const sh = e.shape, from: V2 = sh ? centre('area' in sh ? sh.area : sh.path) : [m.worldPose(e).x, m.worldPose(e).z];
      let d: V2;
      if (b.to !== undefined) { const to = pointOf(m, b.to, 'to'); d = [to[0] - from[0], to[1] - from[1]]; } else d = v2(b.by, 'by');
      const op = sh ? { op: 'move', id: e.id, shape: shiftShape(sh, d[0], d[1]) } : { op: 'move', id: e.id, p: [r2(from[0] + d[0]), r2(from[1] + d[1])] };
      return { centre: [from[0] + d[0], from[1] + d[1]], ops: [op as OpIn] };
    }
    case 'water': {
      if (typeof b.ref !== 'string') throw bad('water needs ref (a pond, lake or river)');
      const e = m.get(b.ref); if (!e) throw bad(`no water called ${b.ref}`);
      const def = m.resolvedDef(e.def), params = { ...(e.params ?? {}) } as Record<string, unknown>;
      if (!def || !def.params.level) throw bad(`${b.ref} has no water level (ponds, lakes and rivers do)`);
      const cur = Number(params.level ?? def.params.level.default ?? 0);
      const lvl = b.level !== undefined ? num(b.level, 'level', -100, 400) : cur + num(b.by, 'by', -60, 60);
      const set: Record<string, number> = { level: r2(lvl) };
      // a lake keeps its bed: the depth follows the water (lake/1 carves level − depth)
      if (def.params.depth) { const df = def.params.depth as { default?: unknown; min?: number; max?: number }, dep = Number(params.depth ?? df.default ?? 1), mx = Number(df.max ?? 60), mn = Number(df.min ?? 0.2); set.depth = r2(Math.max(mn, Math.min(mx, dep + (lvl - cur)))); }
      const sh = e.shape as { area?: V2[]; path?: V2[] } | undefined;
      return { centre: sh?.area ? centre(sh.area) : sh?.path ? centre(sh.path) : undefined, ops: [{ op: 'set', id: e.id, params: set } as OpIn] };
    }
    case 'extend': {
      const bb = boundsOf(m);
      if (b.bounds) return { ops: [{ op: 'expand', bounds: b.bounds.map(Number) as [number, number, number, number] } as OpIn] };
      const k = String(b.toward ?? '').toLowerCase().replace(/[^a-z]/g, ''), dir = COMPASS[k] ?? COMPASS[WORDS[k] ?? ''];
      if (!dir) throw bad('extend needs toward (n, s, e, w, ne, nw, se, sw or north …) and metres');
      const d = num(b.metres, 'metres', 1, 8000);
      const nb: [number, number, number, number] = [bb[0] - (dir[0] < 0 ? d : 0), bb[1] - (dir[1] < 0 ? d : 0), bb[2] + (dir[0] > 0 ? d : 0), bb[3] + (dir[1] > 0 ? d : 0)];
      return { centre: [(dir[0] > 0 ? bb[2] + d / 2 : dir[0] < 0 ? bb[0] - d / 2 : (bb[0] + bb[2]) / 2), (dir[1] > 0 ? bb[3] + d / 2 : dir[1] < 0 ? bb[1] - d / 2 : (bb[1] + bb[3]) / 2)], ops: [{ op: 'expand', bounds: nb } as OpIn] };
    }
    default: throw bad(`unknown land verb ${verb}: raise, lower, smooth, flatten, knoll, hill, mountain, plateau, terrace, valley, ditch, cliff, move, water, extend`);
  }
}

/** Compare a world before/after one batch: ground rise/fall over the changed tiles, things moved (dy, dxz). */
function compare(before: WorldModel, after: WorldModel, tiles: string[], upserts: Entity[]) {
  let raised = 0, lowered = 0, changed = 0, at: V2 | undefined, best = 0;
  const S = 4;
  for (const t of tiles.slice(0, 400)) {
    const [tx, tz] = t.split(',').map(Number);
    for (let j = 0; j < TILE_M; j += S) for (let i = 0; i < TILE_M; i += S) {
      const x = tx * TILE_M + i + S / 2, z = tz * TILE_M + j + S / 2, d = after.terrain.sample(x, z) - before.terrain.sample(x, z);
      if (Math.abs(d) > 0.05) changed += S * S;
      if (d > raised) raised = d; if (-d > lowered) lowered = -d;
      if (Math.abs(d) > best) { best = Math.abs(d); at = [r2(x), r2(z)]; }
    }
  }
  const moved: LandReport['moved'] = [];
  for (const e of upserts) {
    const was = before.entities.get(e.id); if (!was || !was.p || !e.p || e.in.parent !== 'world' || after.resolvedDef(e.def)?.components.body) continue;   // Souls' bodies: the engine stands them
    const a = was.p, b = e.p, dy = (b.length === 3 ? b[1] : 0) - (a.length === 3 ? a[1] : 0), dxz = Math.hypot(b[0] - a[0], b[b.length - 1] - a[a.length - 1]);
    if (Math.abs(dy) > 0.01 || dxz > 0.01) moved.push({ id: e.id, path: after.pathOf(e.id), dy: r2(dy), dxz: r2(dxz) });
  }
  return { ground: tiles.length ? { raisedM: r2(raised), loweredM: r2(lowered), changedM2: changed, ...(at ? { at } : {}) } : null, moved };
}

/** Plan (and unless `preview`, commit) one land verb; answers the report either way. */
export function land(god: GodMode, b: LandInput): LandReport {
  const verb = String(b?.verb ?? '').toLowerCase(), preview = b?.preview === true;
  const { ops } = landOps(god.model, b);
  const batch = { ops, ...(b.group ? { group: String(b.group).slice(0, 60) } : {}) };
  // simulate on a fork (the model is untouched), with the same body-aware hooks as a real edit
  const fork = god.model.fork(), boundsBefore = boundsOf(god.model);
  const sim = applyBatch(fork, batch, 'god', 0, { uses: god.bodies?.uses, refuse: god.bodies?.refuse });
  const base = { verb, preview, ops, tiles: 0, ground: null, moved: [], bounds: null } as Omit<LandReport, 'accepted' | 'warnings' | 'says'>;
  if (!sim.result.accepted) return { ...base, accepted: false, failures: sim.result.failures, warnings: [], says: `refused: ${sim.result.failures.map((f) => `${f.code}: ${f.detail}`).join('; ')}` };
  const diff = sim.diff!, cmp = compare(god.model, fork, diff.tiles, diff.upserts), after = boundsOf(fork);
  const grew = after.some((v, i) => v !== boundsBefore[i]) ? { before: boundsBefore, after } : null;
  // grounding: a thing the compiler could not re-settle on the new ground stays where it was — floating or buried. Refuse.
  const stuck = sim.result.warnings.filter((w) => /support|outside|unsatisf|settle|no-water/.test(w) && !/bridge/.test(w));
  if (stuck.length && !b.force) return { ...base, ...cmp, tiles: diff.tiles.length, bounds: grew, accepted: false, failures: [{ op: 0, code: 'ground.unsettled', detail: `${stuck.join('; ')} — move or remove it first (or force: true to leave it)` }], warnings: sim.result.warnings, says: `refused: things would be left off the ground: ${stuck.join('; ')}` };
  const says = describe(verb, cmp, grew, diff.tiles.length);
  if (preview) return { ...base, ...cmp, tiles: diff.tiles.length, bounds: grew, accepted: true, warnings: sim.result.warnings, says: `preview (nothing changed yet): ${says}` };
  const r = god.act(batch, b.note ? String(b.note).slice(0, 400) : `land: ${verb}`);
  if (!r.accepted) return { ...base, accepted: false, failures: r.failures, warnings: [], says: `refused: ${r.failures.map((f) => `${f.code}: ${f.detail}`).join('; ')}` };
  return { ...base, ...cmp, tiles: diff.tiles.length, bounds: grew, accepted: true, seq: r.seq, undoId: r.undoId, warnings: r.warnings, says: `${says} (seq ${r.seq}; undo reverts it)` };
}

function describe(verb: string, cmp: ReturnType<typeof compare>, grew: LandReport['bounds'], tiles: number): string {
  const parts: string[] = [];
  if (grew) { const [a, b] = [grew.before, grew.after]; parts.push(`the world grows from ${a[2] - a[0]}×${a[3] - a[1]} m to ${b[2] - b[0]}×${b[3] - b[1]} m (bounds ${b.join(', ')})`); }
  if (cmp.ground) parts.push(`${verb}: ground up to +${cmp.ground.raisedM} m / −${cmp.ground.loweredM} m over about ${Math.round(cmp.ground.changedM2)} m² (${tiles} tiles)`);
  else if (!grew) parts.push(`${verb}: no ground change`);
  if (cmp.moved.length) parts.push(`${cmp.moved.length} thing${cmp.moved.length > 1 ? 's' : ''} re-grounded: ${cmp.moved.slice(0, 8).map((x) => `${x.path} ${x.dy >= 0 ? '+' : ''}${x.dy} m`).join(', ')}${cmp.moved.length > 8 ? ', …' : ''}`);
  return parts.join('; ');
}

export function mountLandRoutes(app: Hono, d: { god: GodMode; requireGod: (c: Context) => unknown }) {
  const limitGod = godTokenLimiter(d.requireGod);
  app.post('/v1/god/land', async (c) => {
    limitGod(c, 'land', CREATION_LIMITS.landEditsPerMinute);
    let b: LandInput; try { b = await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); }
    return c.json(d.god.as(callerOf(d.requireGod(c)), () => land(d.god, b)), 200, { 'cache-control': 'no-store' });
  });
}
