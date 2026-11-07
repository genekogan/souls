// buildsafe/1 (lane BS2, 2026-10-21): commit-time auto-repair. A god edit is never refused for leaving something with
// no walk to it; before the batch is written, the things it newly cuts off at ground level are repaired, in order:
//   (a) the edit's own blocking piece is nudged through fallback poses (0.15..1.5 m round, then turned) until every way
//       it cut is open again and nothing else is cut; the ways rule is the furnish one (buildsafe-rule.ts), applied to
//       every god place/move, not only to template furnishing;
//   (b) a wall, fence or hedge the edit built round something gets a 1 m gate where it opens the way (a gap with no
//       leaf: walkers pass it; an existing closed door or gate is the god's own choice and counts as a way in);
// The repairs are extra ops appended to the same batch, so they are journaled, previewed by undo and replayed with it.
// What cannot be repaired goes back to the god as ONE line per thing: what, why, and an op that fixes it (tested here
// when one is found). Model-only and local: a 0.1 m raster round the edit (<= 60 m a side; closed gateable enclosures <= 96 m), the edit's things before
// and after; the engine's nav-connect check after the commit still steps out Souls and names what this did not see.
import { obbOverlap, type Diff, type Entity, type Op, type StoredDef, type WorldModel } from '@souls/world-compiler';
import { BAND, BODY_R, CELL, approachOf, type ApproachKey, type Vec2 } from './buildsafe-rule.ts';

type OBB = { c: Vec2; half: Vec2 | number[]; yaw: number; y0: number; y1: number };
type Key = { id: string; label: string; owner?: string; key: ApproachKey };
export type Repair = { ops: Op[]; lines: string[]; named: string[]; ms: number };

const MARGIN = 4, MAX_SIDE = 60, MAX_ENCLOSURE_SIDE = 96, GATE_W = 1;
/** A nudged piece is judged 0.15 m wider than it is: a way it leaves is never a hair's breadth (the engine's walk
 *  is stricter than this raster in a 0.9 m doorway). */
const SLACK = 0.15;
const OFFSETS = [0.15, 0.3, 0.45, 0.6, 0.8, 1, 1.25, 1.5];
const DIRS: Vec2[] = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as Vec2);
const TURNS = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const DIR_NAMES = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** The tmp each untagged place op gets while the batch is applied, so a repair can address what the batch made. */
export function tagPlaces<T extends { op: string }>(ops: T[]): T[] {
  const used = new Set(ops.map((o) => (o as { tmp?: string }).tmp).filter(Boolean));
  return ops.map((o, i) => (o.op === 'place' && !(o as { tmp?: string }).tmp && !used.has(`$bs-${i}`) ? { ...o, tmp: `$bs-${i}` } : o));
}
/** Drops the tags no repair op refers to. */
export function untagPlaces<T extends { op: string }>(tagged: T[], repairs: { op: string }[]): T[] {
  const used = new Set(repairs.map((o) => (o as { id?: string }).id));
  return tagged.map((o) => { const t = (o as { tmp?: string }).tmp; if (o.op !== 'place' || !t?.startsWith('$bs-') || used.has(t)) return o; const { tmp: _t, ...rest } = o as T & { tmp?: string }; return rest as T; });
}

class Grid {
  x0: number; z0: number; nx: number; nz: number; cnt: Uint16Array; out: Uint8Array | null = null;
  constructor(rect: [number, number, number, number]) {
    this.x0 = rect[0]; this.z0 = rect[1]; this.nx = Math.max(1, Math.ceil((rect[2] - rect[0]) / CELL)); this.nz = Math.max(1, Math.ceil((rect[3] - rect[1]) / CELL));
    this.cnt = new Uint16Array(this.nx * this.nz);
  }
  clone() { const g = Object.create(Grid.prototype) as Grid; Object.assign(g, this); g.cnt = this.cnt.slice(); g.out = null; return g; }
  mark(boxes: OBB[], sign: 1 | -1) {
    this.out = null;
    for (const b of boxes) {
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw), hx = b.half[0] + BODY_R, hz = b.half[1] + BODY_R, R = Math.hypot(hx, hz);
      const i0 = Math.max(0, Math.floor((b.c[0] - R - this.x0) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((b.c[0] + R - this.x0) / CELL));
      const j0 = Math.max(0, Math.floor((b.c[1] - R - this.z0) / CELL)), j1 = Math.min(this.nz - 1, Math.floor((b.c[1] + R - this.z0) / CELL));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const dx = this.x0 + (i + 0.5) * CELL - b.c[0], dz = this.z0 + (j + 0.5) * CELL - b.c[1];
        if (Math.abs(dx * c - dz * s) < hx && Math.abs(dx * s + dz * c) < hz) this.cnt[i * this.nz + j] += sign;
      }
    }
  }
  /** Cells joined to the window's edge (the surroundings) by free cells. */
  reach(): Uint8Array {
    if (this.out) return this.out;
    const { nx, nz, cnt } = this, out = new Uint8Array(nx * nz), st: number[] = [];
    const seed = (q: number) => { if (!cnt[q] && !out[q]) { out[q] = 1; st.push(q); } };
    for (let i = 0; i < nx; i++) { seed(i * nz); seed(i * nz + nz - 1); }
    for (let j = 0; j < nz; j++) { seed(j); seed((nx - 1) * nz + j); }
    while (st.length) {
      const q = st.pop()!, i = Math.floor(q / nz), j = q % nz;
      if (i > 0) seed(q - nz); if (i < nx - 1) seed(q + nz); if (j > 0) seed(q - 1); if (j < nz - 1) seed(q + 1);
    }
    return (this.out = out);
  }
  /** Is the free cell nearest the key joined to the surroundings? null: no free cell to stand on near it. */
  ok(k: ApproachKey): boolean | null {
    let best = -1, bd = Infinity;
    for (const [x, z] of k.pts) {
      const i0 = Math.max(0, Math.floor((x - this.x0 - k.r) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((x - this.x0 + k.r) / CELL));
      const j0 = Math.max(0, Math.floor((z - this.z0 - k.r) / CELL)), j1 = Math.min(this.nz - 1, Math.floor((z - this.z0 + k.r) / CELL));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const q = i * this.nz + j; if (this.cnt[q]) continue;
        const d = Math.hypot(this.x0 + (i + 0.5) * CELL - x, this.z0 + (j + 0.5) * CELL - z); if (d <= k.r && d < bd) { bd = d; best = q; }
      }
    }
    return best < 0 ? null : this.reach()[best] === 1;
  }
}

type View = { m: WorldModel; blockers: Map<string, OBB[]>; keys: Key[] };
const isPath = (def: StoredDef, e: Entity) => def.form !== 'point' && e.in.parent === 'world' && Array.isArray((e.shape as { path?: unknown })?.path);
const gated = (def: StoredDef) => !!(def.params as Record<string, unknown> | undefined)?.gates;

function groundAt(m: WorldModel, x: number, z: number) { try { return m.terrain.sample(x, z); } catch { return 0; } }
/** The blocking boxes of one entity at ground level (solid/surface layer, reaching into the walking band). */
function blocking(m: WorldModel, id: string, boxes?: OBB[]): OBB[] {
  const e = m.entities.get(id); if (!e) return [];
  const def = m.resolvedDef(e.def); if (!def || (def.layer !== 'solid' && def.layer !== 'surface')) return [];
  return (boxes ?? (m.footprint(e, def) as OBB[])).filter((b) => { const g = groundAt(m, b.c[0], b.c[1]); return b.y0 < g + BAND[1] && b.y1 > g + BAND[0]; });
}
function rectOf(boxes: OBB[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of boxes) {
    const c = Math.abs(Math.cos(b.yaw)), s = Math.abs(Math.sin(b.yaw));
    const rx = c * b.half[0] + s * b.half[1], rz = s * b.half[0] + c * b.half[1];
    x0 = Math.min(x0, b.c[0] - rx); z0 = Math.min(z0, b.c[1] - rz); x1 = Math.max(x1, b.c[0] + rx); z1 = Math.max(z1, b.c[1] + rz);
  }
  return [x0, z0, x1, z1];
}
const inRect = (r: number[], x: number, z: number) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
/** `r` grown to hold every building (a thing with rooms) it touches, whole and 1 m round: a window edge through a
 *  building's floor would join its rooms to the surroundings and hide a blocked door. */
function withRooms(ms: WorldModel[], r0: [number, number, number, number]): [number, number, number, number] {
  // one pass over what the window itself touches (no cascade: a street of buildings would grow it to the town)
  let r = r0;
  const win = { c: [(r0[0] + r0[2]) / 2, (r0[1] + r0[3]) / 2] as Vec2, half: [(r0[2] - r0[0]) / 2, (r0[3] - r0[1]) / 2], yaw: 0, y0: -1e4, y1: 1e4 };
  for (const m of ms) for (const id of m.near([win as never])) {
    const e = m.entities.get(id), def = e && m.resolvedDef(e.def); if (!e || !def || def.form !== 'point') continue;
    if (!m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).rooms?.length) continue;
    const fp = m.footprint(e, def) as OBB[]; if (!fp.length) continue;
    const b = rectOf(fp); if (b[2] - b[0] > MAX_SIDE || b[3] - b[1] > MAX_SIDE) continue;
    r = [Math.min(r[0], b[0] - 1), Math.min(r[1], b[1] - 1), Math.max(r[2], b[2] + 1), Math.max(r[3], b[3] + 1)];
  }
  return r;
}

/** Everything at ground level in the window: blockers by entity, and the keys (door sides, stair feet, the standing
 *  spots of named things and seats) Souls are sent to. */
function viewOf(m: WorldModel, rect: [number, number, number, number], extra: Iterable<string>): View {
  const win = { c: [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2] as Vec2, half: [(rect[2] - rect[0]) / 2, (rect[3] - rect[1]) / 2], yaw: 0, y0: -1e4, y1: 1e4 };
  const ids = new Set([...m.near([win as never]), ...extra]);
  for (const id of [...ids]) for (const k of m.children.get(id) ?? []) ids.add(k);
  const blockers = new Map<string, OBB[]>(), keys: Key[] = [];
  for (const id of ids) {
    const e = m.entities.get(id); if (!e) continue;
    const def = m.resolvedDef(e.def); if (!def) continue;
    const b = blocking(m, id); if (b.length) blockers.set(id, b);
    let wp: ReturnType<WorldModel['worldPose']>; try { wp = m.worldPose(e); } catch { continue; }
    const baked = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), path = m.pathOf(id);
    const world = isPath(def, e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
    const toW = (x: number, z: number): Vec2 => (world ? [x, z] : [wp.x + (x * c + z * s) * wp.s, wp.z + (-x * s + z * c) * wp.s]);
    const yawW = (y: number) => (world ? y : y + wp.yaw);
    // doorways, arches and gates at ground level: both sides are ways (a shut leaf is the god's; it counts as a way)
    for (const o of baked.openings ?? []) {
      if (o.kind === 'window' || o.level) continue;
      const at = toW(o.at[0], o.at[1]), n: Vec2 = [Math.sin(yawW(o.yaw)), Math.cos(yawW(o.yaw))];
      if (!inRect(rect, at[0], at[1])) continue;
      for (const k of [0.45, -0.45]) keys.push({ id: `${id}#${o.id}${k > 0 ? '+' : '-'}`, label: `${path} ${o.id}`, key: { pts: [[at[0] + n[0] * k, at[1] + n[1] * k]], r: 0.3 } });
    }
    // stair feet at ground level: the planner steps off 0.7 m beyond the end
    for (const l of baked.links ?? []) for (const [end, next, level] of [[l.path[0], l.path[1], l.from], [l.path[l.path.length - 1], l.path[l.path.length - 2], l.to]] as const) {
      if (level || !next) continue;
      const a = toW(end[0], end[1]), b2 = toW(next[0], next[1]), d = Math.hypot(a[0] - b2[0], a[1] - b2[1]) || 1, u: Vec2 = [(a[0] - b2[0]) / d, (a[1] - b2[1]) / d];
      if (inRect(rect, a[0], a[1])) keys.push({ id: `${id}#${l.id}@0`, label: `the foot of ${path} ${l.id}`, key: { pts: [[a[0] + u[0] * 0.7, a[1] + u[1] * 0.7], [a[0] - u[1] * 0.7, a[1] + u[0] * 0.7], [a[0] + u[1] * 0.7, a[1] - u[0] * 0.7]], r: 0.4 } });
    }
    // a named thing's or a seat's standing spot (not buildings, paths or areas: their doors are the ways)
    if (def.form !== 'point' || baked.rooms?.length) continue;
    const seats = (baked.slots ?? []).some((x) => x.kind === 'seat');
    if (!e.name && !seats) continue;
    if (wallLike(baked.box, e.s ?? 1)) continue;   // a wall is walked past, not to
    // a bowl on a table: walked to as its holder is (the holder's own spot is its key; walk fuzz, 2026-10-21)
    const holder = e.in?.parent ? m.entities.get(e.in.parent) : undefined, hd = holder && m.resolvedDef(holder.def);
    if (hd && hd.form === 'point' && !m.bake(hd, holder!.params ?? {}, holder!.seed ?? 0, holder!.shape).rooms?.length) continue;
    if (wp.y - groundAt(m, wp.x, wp.z) > 1.2 || !inRect(rect, wp.x, wp.z)) continue;   // upstairs, on a shelf: not this raster's
    keys.push({ id, owner: id, label: path, key: approachOf(baked, [wp.x, wp.z], wp.yaw) });
  }
  return { m, blockers, keys };
}
function gridOf(rect: [number, number, number, number], v: View, except?: string | string[]): Grid {
  const g = new Grid(rect), ex = new Set(typeof except === 'string' ? [except] : except ?? []);
  for (const [id, b] of v.blockers) if (!ex.has(id)) g.mark(b, 1);
  return g;
}

/** A pose `dyaw`, `off` away from `e`'s: its boxes and the move op that puts it there. */
function posed(m: WorldModel, e: Entity, boxes: OBB[], off: Vec2, dyaw: number, ref: string): { boxes: OBB[]; op: Op } {
  const wp = m.worldPose(e), c = Math.cos(dyaw), s = Math.sin(dyaw);
  const out = boxes.map((b) => { const dx = b.c[0] - wp.x, dz = b.c[1] - wp.z; return { ...b, c: [wp.x + dx * c + dz * s + off[0], wp.z - dx * s + dz * c + off[1]] as Vec2, yaw: b.yaw + dyaw }; });
  const lp = m.localPose(e), py = wp.yaw - lp.yaw, ss = (wp.s / (lp.s || 1)) || 1;
  const lx = (off[0] * Math.cos(py) - off[1] * Math.sin(py)) / ss, lz = (off[0] * Math.sin(py) + off[1] * Math.cos(py)) / ss;
  const p = e.p && e.p.length === 3 ? [r3(lp.x + lx), e.p[1], r3(lp.z + lz)] : [r3(lp.x + lx), r3(lp.z + lz)];
  const r = Array.isArray(e.r) ? [r3(e.r[0] + dyaw), e.r[1], e.r[2]] : r3(lp.yaw + dyaw);
  return { boxes: out, op: { op: 'move', id: ref, p, ...(dyaw ? { r } : {}) } as Op };
}
/** Would `boxes` (the entity `id` moved) cross another solid or its building's walls? (admission's overlap rule) */
function crosses(m: WorldModel, id: string, boxes: OBB[]): boolean {
  const exempt = new Set([id, ...m.subtree(id)]);
  for (let p = m.entities.get(id)?.in.parent; p && p !== 'world'; p = m.entities.get(p)?.in.parent) exempt.add(p);
  for (const o of m.near(boxes as never)) {
    if (exempt.has(o)) continue;
    for (const a of boxes) for (const b of m.footprintsOf(o)) if (obbOverlap(a as never, b)) return true;
  }
  for (let p = m.entities.get(id)?.in.parent; p && p !== 'world'; p = m.entities.get(p)?.in.parent) {
    const pe = m.entities.get(p)!; const pd = m.resolvedDef(pe.def);
    if (pd && m.bake(pd, pe.params ?? {}, pe.seed ?? 0, pe.shape).rooms?.length) for (const a of boxes) for (const b of m.footprint(pe, pd)) if (obbOverlap(a as never, b)) return true;
  }
  return false;
}
const nudgeable = (m: WorldModel, id: string) => {
  const e = m.entities.get(id), def = e && m.resolvedDef(e.def); if (!e || !def || def.form !== 'point' || def.layer !== 'solid') return false;
  if (def.components.opening) return false;   // a door or gate stands in its gap on purpose
  const baked = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape); if (baked.rooms?.length) return false;
  return Math.max(baked.box[0], baked.box[2]) * (e.s ?? 1) <= 4 && !wallLike(baked.box, e.s ?? 1);   // pieces, not walls
};
/** Long and thin: a wall piece (never nudged, never a place to walk to). */
function wallLike(box: number[], s: number) { const a = Math.max(box[0], box[2]) * s, b = Math.min(box[0], box[2]) * s; return a > 2.5 && a / Math.max(b, 0.05) > 4; }
function* poses() { for (const t of [0, ...TURNS.slice(1)]) for (const d of [0, ...OFFSETS]) for (let k = 0; k < (d ? DIRS.length : 1); k++) { if (!t && !d) continue; yield { off: [DIRS[k][0] * d, DIRS[k][1] * d] as Vec2, dyaw: t, d, k }; } }

/** Repairs for `ops` applied to `before` giving `after` (`ids`: the batch's tmp → id). null: nothing to repair. */
/** A piece standing in a building's room (its parent has rooms). */
function inRoom(m: WorldModel, id: string): boolean {
  const e = m.entities.get(id), p = e?.in?.parent ? m.entities.get(e.in.parent) : undefined, d = p && m.resolvedDef(p.def);
  return !!d && !!m.bake(d, p!.params ?? {}, p!.seed ?? 0, p!.shape).rooms?.length;
}
export function repairBatch(before: WorldModel, after: WorldModel, diff: Diff, ids: Record<string, string>, budgetMs = 400): Repair | null {
  const t0 = performance.now();
  const refOf = new Map<string, string>(); for (const [k, v] of Object.entries(ids)) if (k.startsWith('$')) refOf.set(v, k);
  // the edit's own things whose ground footprint changed
  const touched: string[] = [];
  for (const e of diff.upserts) {
    const was = before.entities.get(e.id);
    if (was && JSON.stringify([was.p, was.r, was.s, was.shape, was.params, was.in]) === JSON.stringify([e.p, e.r, e.s, e.shape, e.params, e.in])) continue;
    touched.push(e.id);
  }
  if (!touched.length) return null;
  // windows round them (merged while <= MAX_SIDE)
  const rects: { r: [number, number, number, number]; ids: string[] }[] = [];
  for (const id of touched) {
    const e = after.entities.get(id); if (!e) continue;
    let r: [number, number, number, number];
    const fp = after.footprint(e) as OBB[];
    if (fp.length) r = rectOf(fp); else { try { const p = after.worldPose(e); r = [p.x - 0.5, p.z - 0.5, p.x + 0.5, p.z + 0.5]; } catch { continue; } }
    // A newly closed authored enclosure is not an intentional pre-existing island.
    // Allow a bounded larger window only for paths that can receive a real gate.
    // The before/after cut test below still leaves existing sealed courtyards alone.
    const def = after.resolvedDef(e.def), pts = (e.shape as {path?: Vec2[]})?.path;
    const closed = def && isPath(def, e) && gated(def) && pts && pts.length >= 4 && Math.hypot(pts[0][0] - pts.at(-1)![0], pts[0][1] - pts.at(-1)![1]) < .01;
    const maxSide = closed ? MAX_ENCLOSURE_SIDE : MAX_SIDE;
    if (r[2] - r[0] > maxSide - 2 * MARGIN || r[3] - r[1] > maxSide - 2 * MARGIN) continue;
    r = withRooms([before, after], [r[0] - MARGIN, r[1] - MARGIN, r[2] + MARGIN, r[3] + MARGIN]);
    if (r[2] - r[0] > maxSide || r[3] - r[1] > maxSide) continue;
    const hit = rects.find((x) => { const u = [Math.min(x.r[0], r[0]), Math.min(x.r[1], r[1]), Math.max(x.r[2], r[2]), Math.max(x.r[3], r[3])]; return !(r[0] > x.r[2] || r[2] < x.r[0] || r[1] > x.r[3] || r[3] < x.r[1]) && u[2] - u[0] <= MAX_SIDE && u[3] - u[1] <= MAX_SIDE; });
    if (hit) { hit.r = [Math.min(hit.r[0], r[0]), Math.min(hit.r[1], r[1]), Math.max(hit.r[2], r[2]), Math.max(hit.r[3], r[3])]; hit.ids.push(id); } else rects.push({ r, ids: [id] });
  }
  const ops: Op[] = [], lines: string[] = [], named: string[] = [];
  for (const w of rects) {
    if (performance.now() - t0 > budgetMs) break;
    const pre = viewOf(before, w.r, w.ids.filter((id) => before.entities.has(id))), preGrid = gridOf(w.r, pre);
    const wasOk = new Map(pre.keys.map((k) => [k.id, preGrid.ok(k.key)]));
    const v = viewOf(after, w.r, w.ids);
    let grid = gridOf(w.r, v);
    // newly cut off: joined to the surroundings before (or new with this edit), not now
    // doorways and stair feet first: opening one rejoins what stands behind it
    // a piece set into a room by this edit is not a key: the furnish ways rule places room pieces, and this raster (real
    // collider boxes, nearest free cell) is the coarser judge there; its nudges made the walk worse (walk fuzz kitchens,
    // 2026-10-21). The room's doors and stair feet stay keys.
    const newInRoom = new Set(v.keys.filter((k) => k.owner && !wasOk.has(k.id) && inRoom(after, k.owner)).map((k) => k.id));
    const cut = () => v.keys.filter((k) => { const was = wasOk.get(k.id); return !newInRoom.has(k.id) && (was === undefined || was === true) && grid.ok(k.key) !== true; }).sort((a, b) => Number(!!a.owner) - Number(!!b.owner));
    let bad = cut(); if (!bad.length) continue;
    const done = new Set<string>(), left_: { label: string; line: string }[] = [];
    // the edit's things that cut a key off: without them it is joined again
    const culprits = (k: Key) => w.ids.filter((id) => !done.has(id) && v.blockers.has(id) && gridOf(w.r, v, id).ok(k.key) === true);
    // several of the edit's pieces that cut a key off only together (a packed room): the fewest of them, nearest first
    const jointCulprits = (k: Key) => {
      const at = k.key.pts[0], cand = w.ids.filter((id) => !done.has(id) && v.blockers.has(id) && nudgeable(after, id))
        .map((id) => { const p = after.worldPose(after.entities.get(id)!); return [id, Math.hypot(p.x - at[0], p.z - at[1])] as const; })
        .filter(([, d]) => d < 8).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([id]) => id);
      const out: string[] = [];
      for (const id of cand) {
        out.push(id); if (gridOf(w.r, v, out).ok(k.key) !== true) continue;
        for (const x of [...out]) { const less = out.filter((y) => y !== x); if (less.length && gridOf(w.r, v, less).ok(k.key) === true) out.splice(out.indexOf(x), 1); }
        return out;
      }
      return [];
    };
    for (let pass = 0; pass < 12 && bad.length && performance.now() - t0 < budgetMs; pass++) {
      const k = bad[0], blame = culprits(k);
      // a piece set down where no way reaches (nothing of the edit blocks it): the piece itself moves
      if (!blame.length && k.owner && w.ids.includes(k.owner) && nudgeable(after, k.owner) && !done.has(k.owner)) blame.push(k.owner);
      // pieces that cut it off together move in turn, each clear of the way with the ones still to move set aside; all or none
      const group = blame.length ? [] : jointCulprits(k), order = blame.length ? blame : group;
      const snap = group.length ? { ops: ops.length, lines: lines.length, grid, blockers: new Map(group.map((id) => [id, v.blockers.get(id)!])), keys: v.keys.map((x) => x.key), done: [...done] } : null;
      let fixed = false;
      for (const [gi, id] of order.entries()) {
        const e = after.entities.get(id)!, def = after.resolvedDef(e.def)!, ref = refOf.get(id) ?? id, path = after.pathOf(id);
        const rest = group.slice(gi + 1);
        const base = gridOf(w.r, v, id), kBase = rest.length ? gridOf(w.r, v, [id, ...rest]) : null, okNow = new Set(v.keys.filter((x) => grid.ok(x.key)).map((x) => x.id));
        const tryBoxes = (boxes: OBB[], slack = 0) => { const b = blocking(after, id, boxes).map((x) => (slack ? { ...x, half: [x.half[0] + slack, x.half[1] + slack] } : x)), g = base.clone(); g.mark(b, 1); const gk = kBase ? kBase.clone() : g; if (kBase) gk.mark(b, 1); return { g, gk }; };
        // k is joined again (with the group's pieces still to move set aside) and nothing joined now is cut (the moved
        // piece's own spot judged where it goes)
        // a doorway is open when both its sides are (the way through it, not only to it)
        // (when this piece alone stands in the way of both: a side another piece blocks is that piece's pass)
        const twin = /#.+[+-]$/.test(k.id) ? v.keys.find((x) => x.id === k.id.slice(0, -1) + (k.id.endsWith('+') ? '-' : '+')) : undefined;
        const twinNeeded = !!twin && wasOk.get(twin.id) !== false && (kBase ?? base).ok(twin.key) === true;
        const passes = (t: { g: Grid; gk: Grid }, moved?: Map<string, ApproachKey>) => (moved?.get(k.id) ? t.gk.ok(moved.get(k.id)!) : t.gk.ok(k.key)) === true
          && (!twinNeeded || t.gk.ok(twin!.key) === true)
          && v.keys.every((x) => { const kk = moved?.get(x.id) ?? x.key; return !okNow.has(x.id) && !moved?.has(x.id) ? true : t.g.ok(kk) === true; });
        let one = false;
        if (nudgeable(after, id)) {
          const own = after.footprint(e, def) as OBB[], wp = after.worldPose(e), ownKeys = v.keys.filter((x) => x.owner === id);
          for (const c of poses()) {
            if (performance.now() - t0 > budgetMs) break;
            const pz = posed(after, e, own, c.off, c.dyaw, ref);
            if (crosses(after, id, pz.boxes)) continue;
            // the moved piece's own standing spot moves with it
            const cc = Math.cos(c.dyaw), ss = Math.sin(c.dyaw);
            const moved = new Map(ownKeys.map((x) => [x.id, { ...x.key, pts: x.key.pts.map(([a, b]) => { const dx = a - wp.x, dz = b - wp.z; return [wp.x + dx * cc + dz * ss + c.off[0], wp.z - dx * ss + dz * cc + c.off[1]] as Vec2; }) }]));
            const t = tryBoxes(pz.boxes, SLACK); if (!passes(t, moved)) continue;
            const g = t.g;
            for (const x of ownKeys) x.key = moved.get(x.id)!;
            const label = group.length ? k.label : freed(v, grid, g, [wp.x, wp.z], id) ?? k.label;
            ops.push(pz.op); v.blockers.set(id, blocking(after, id, pz.boxes)); grid = g; done.add(id); one = true;
            lines.push(`Kept a way open (buildsafe/1): ${path} moved ${c.d ? `${c.d} m ${DIR_NAMES[c.k]}` : 'in place'}${c.dyaw ? ` and turned ${Math.round(Math.abs(c.dyaw) * 180 / Math.PI)}°` : ''} so ${label} can be walked to.`);
            break;
          }
        } else if (isPath(def, e) && gated(def)) {
          const pts = (e.shape as { path: Vec2[] }).path, gates = Array.isArray(e.params?.gates) ? (e.params!.gates as { at: number; width: number }[]) : [];
          const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), total = lens.reduce((a, b) => a + b, 0);
          const at = (s: number): Vec2 => { let acc = 0; for (let i = 0; i < lens.length; i++) { if (s <= acc + lens[i] || i === lens.length - 1) { const f = lens[i] ? (s - acc) / lens[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; } acc += lens[i]; } return pts[0]; };
          // along the wall, 0.5 m steps clear of its corners and its gates, nearest the cut-off thing first
          const corner = (s: number) => { let acc = 0; for (const L of lens) { if (Math.abs(s - acc) < GATE_W / 2 + 0.3) return true; acc += L; } return Math.abs(s - total) < GATE_W / 2 + 0.3; };
          const target = k.key.pts[0];
          const cand: number[] = []; for (let s = GATE_W / 2 + 0.3; s <= total - GATE_W / 2 - 0.3; s += 0.5) if (!corner(s) && !gates.some((g) => Math.abs(g.at - s) < (g.width + GATE_W) / 2 + 0.3)) cand.push(r3(s));
          cand.sort((a, b) => Math.hypot(at(a)[0] - target[0], at(a)[1] - target[1]) - Math.hypot(at(b)[0] - target[0], at(b)[1] - target[1]));
          for (const s of cand.slice(0, 40)) {
            if (performance.now() - t0 > budgetMs) break;
            const params = { ...(e.params ?? {}), gates: [...gates, { at: s, width: GATE_W }] };
            const t = tryBoxes(after.footprint({ ...e, params } as Entity, def) as OBB[]); if (!passes(t)) continue;
            ops.push({ op: 'set', id: ref, params: { gates: params.gates } } as Op); v.blockers.set(id, blocking(after, id, after.footprint({ ...e, params } as Entity, def) as OBB[])); grid = t.g; done.add(id); one = true;
            lines.push(`Kept a way open (buildsafe/1): ${path} has a ${GATE_W} m gate ${s} m along it so ${k.label} can be walked to.`);
            break;
          }
        }
        if (!group.length) { if (one) { fixed = true; break; } continue; }
        if (!one) {   // the group could not all move: undo its moves
          ops.length = snap!.ops; lines.length = snap!.lines; grid = snap!.grid; for (const [x, b] of snap!.blockers) v.blockers.set(x, b);
          v.keys.forEach((x, i) => { x.key = snap!.keys[i]; }); done.clear(); for (const x of snap!.done) done.add(x);
          break;
        }
        if (!rest.length) fixed = true;
      }
      bad = cut();
      if (!fixed) {
        // one line for what is left: what, why, and an op that fixes it (tested on this raster when one is found)
        const left = bad.length ? bad[0] : k; bad = bad.filter((x) => x.label !== left.label && x.id !== left.id);
        const why = order.length ? `cut off by ${order.slice(0, 2).map((id) => after.pathOf(id)).join(' and ')}${order.length > 2 ? ` and ${order.length - 2} more` : ''}` : 'it stands where no way reaches';
        const fix = suggestion(after, v, w.r, left, blame, refOf);
        left_.push({ label: left.label, line: `No walk reaches ${left.label} after this edit (buildsafe/1): ${why}; fix: ${fix}.` });
        for (const x of v.keys) if (x.label === left.label) wasOk.set(x.id, false);
      }
      bad = cut();
    }
    // a thing named while its way was still shut by a later repair is not named: only what is cut off at the end
    for (const x of left_) if (v.keys.some((y) => y.label === x.label && grid.ok(y.key) !== true)) { lines.push(x.line); named.push(x.label); }
  }
  return ops.length || lines.length ? { ops, lines: dedupe(lines), named, ms: Math.round(performance.now() - t0) } : null;
}
/** The key nearest `at` that `g` joins and `was` did not (what a repair opened, as the god reads it). */
function freed(v: View, was: Grid, g: Grid, at: Vec2, self: string): string | null {
  let best: string | null = null, bd = Infinity;
  for (const x of v.keys) { if (x.owner === self || was.ok(x.key) !== false || g.ok(x.key) !== true) continue; const d = Math.hypot(x.key.pts[0][0] - at[0], x.key.pts[0][1] - at[1]); if (d < bd) { bd = d; best = x.label; } }
  return best;
}
const dedupe = (xs: string[]) => [...new Set(xs)].slice(0, 6);
/** An op the god can send: a move of the blocking wall-piece that opens the way (tested), else of the cut-off thing. */
function suggestion(m: WorldModel, v: View, rect: [number, number, number, number], k: Key, blame: string[], refOf: Map<string, string>): string {
  for (const id of blame) {
    const e = m.entities.get(id), def = e && m.resolvedDef(e.def); if (!e || !def || def.form !== 'point') continue;
    const base = gridOf(rect, v, id), own = m.footprint(e, def) as OBB[];
    for (const d of [1, 1.5, 2]) for (const dir of DIRS) {
      const pz = posed(m, e, own, [dir[0] * d, dir[1] * d], 0, refOf.has(id) ? m.pathOf(id) : id);
      if (crosses(m, id, pz.boxes)) continue;
      const g = base.clone(); g.mark(blocking(m, id, pz.boxes), 1);
      if (g.ok(k.key) === true) return JSON.stringify(pz.op);
    }
  }
  const id = blame[0] ?? k.owner;
  if (id && blame.length) { const e = m.entities.get(id), def = e && m.resolvedDef(e.def); if (e && def && isPath(def, e) && gated(def)) return `give ${m.pathOf(id)} a gate {"op":"set","id":"${m.pathOf(id)}","params":{"gates":[{"at":<metres along>,"width":1}]}}`; return `{"op":"remove","id":"${m.pathOf(id)}"} or leave a 1 m gap in it`; }
  return k.owner ? `move it beside open ground {"op":"move","id":"${m.pathOf(k.owner)}","p":[x,z]} or open a way to it (a door, a 1 m gap, a ramp)` : 'open a way to it (a door, a 1 m gap, a ramp)';
}
