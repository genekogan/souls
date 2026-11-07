// PC14 (#693): two people seat a loose rack beam between two standing, supported uprights, and the frame's support is
// released only once it stands on its own. The native `connect_beam` (construction/beam.ts) checks, choreography and lift,
// applied to PC12's typed connectors: a seat is a def's `beam-seat` connector and a beam end its `beam-end` one, wherever
// a def puts them (catalog-adapter.ts sockets, the def's own frame). The stability rule is the native Mars v1 rule
// (construction/rules.ts groupStability), read from the same connectors: a seat's column is the side of the frame it is
// on (its z), its height where it is along the frame (its x). Nothing here names a def or a part. The native verbs stay
// for native frames.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../../../mars/viewer/engine/actions/types.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { def, type AssetDef } from '../../../mars/viewer/engine/world/catalog.ts';
import { angleDelta, datan2, dcos, dsin, FT, hypot, rot2, wrapAngle, type Vec2, type Vec3 } from '../../../mars/viewer/engine/core/math.ts';
import { holdingDiagnostic, STANDING_REACH } from '../../../mars/viewer/engine/construction/rules.ts';
import { checkStations, childrenState, walkCrew, type Children } from '../../../mars/viewer/engine/construction/children.ts';
import { liftDuration, liftStep, sweptLiftPath } from '../../../mars/viewer/engine/construction/access.ts';
import { pickupPlan, STATION_SLOT } from '../../../mars/viewer/engine/construction/liftcrew.ts';
import { raiseable } from './raise-hold.ts';

export const SEAT = 'beam-seat', END = 'beam-end';
/** How far a seat may be from where the beam's end would be and still take it (m): PC12's join tolerance. */
export const SEAT_TOL = 0.05;
/** The two seats are level within this (m): a beam is seated level. */
const LEVEL_TOL = 0.02;
/** The beam runs square to each frame within this (rad), as the native 2° parallel check. */
const SQUARE_TOL = 0.035;
/** The beam lies under its seats, at most this far from below their midpoint (m), as the native check. */
const STAGED_NEAR = 0.9;
/** A frame taller than this needs beams at two heights on each column (rules.ts requiredLevels). */
const TALL = 9.5 * FT;

type Socket = NonNullable<AssetDef['sockets']>[number];
const tryDef = (id: string): AssetDef | undefined => { try { return def(id); } catch { return undefined; } };
const socketsOf = (e: Entity | undefined): Socket[] => (e && tryDef(e.def)?.sockets) || [];
/** A loose upright a crew can raise, with beam seats. */
export const isFrame = (e: Entity | undefined): e is Entity => !!e && e.kind !== 'human' && raiseable(tryDef(e.def)) && socketsOf(e).some((s) => s.kind === SEAT);
/** A loose part with beam ends. */
export const isBeamPart = (e: Entity | undefined): e is Entity => !!e && e.kind !== 'human' && tryDef(e.def)?.category === 'item' && socketsOf(e).filter((s) => s.kind === END).length === 2;
/** Stood on end: rolled a quarter turn about its own z, not pitched (PC12/PC13's standing pose). */
export const standing = (e: Entity) => Math.abs(Math.abs(e.pose.roll ?? 0) - Math.PI / 2) < 0.02 && Math.abs(e.pose.pitch ?? 0) < 0.02;

/** A point in a part's own frame, in the world: roll about z, pitch about x, then yaw (spatial/service.ts entityCorners). */
export function worldPoint(e: { pose: Pose }, local: readonly number[]): Vec3 {
  const r = e.pose.roll ?? 0, pt = e.pose.pitch ?? 0;
  let X = local[0] * dcos(r) - local[1] * dsin(r), Y = local[0] * dsin(r) + local[1] * dcos(r), Z = local[2];
  [Y, Z] = [Y * dcos(pt) - Z * dsin(pt), Y * dsin(pt) + Z * dcos(pt)];
  const h = rot2([X, Z], e.pose.yaw);
  return [e.pose.p[0] + h[0], e.pose.p[1] + Y, e.pose.p[2] + h[1]];
}
const seatOf = (e: Entity, id: string) => socketsOf(e).find((s) => s.id === id && s.kind === SEAT);
/** The connector of `e` that `socket` is joined at, if any. */
const takenBy = (e: Entity, socket: string) => (e.connections ?? []).find((c) => c.socket === socket);
/** A beam's joints at its two ends (PC15: a step beam also holds deck joists, which are not what it is seated in). */
export const endJoints = (b: Entity) => { const ends = new Set(socketsOf(b).filter((s) => s.kind === END).map((s) => s.id)); return (b.connections ?? []).filter((c) => ends.has(c.socket)); };
/** A seat's column, `l` (−z) or `r` (+z): the def's own side of the frame. */
export const columnOf = (s: Socket): 'l' | 'r' => (s.local[2] < 0 ? 'l' : 'r');

/** Held up by its own crew: enough people, each with a hand on it. */
export function heldUp(w: WorldState, u: Entity): boolean {
  if (u.support?.kind !== 'held') return false;
  const least = tryDef(u.def)?.handling?.carryCrew?.[0] ?? 1;
  return u.support.by.length >= least && u.support.by.every((id) => w.entities[id]?.human?.grip?.entity === u.id);
}

type Link = { beam: string; col: 'l' | 'r'; level: number; other: string };
/** The installed beams seated in a frame, from its connections and its seats. */
export function links(w: WorldState, u: Entity): Link[] {
  const out: Link[] = [];
  for (const c of u.connections ?? []) {
    const s = seatOf(u, c.socket), b = w.entities[c.to];
    if (!s || !isBeamPart(b) || b.phase !== 'installed') continue;
    const other = endJoints(b).find((x) => x.to !== u.id)?.to;
    if (other) out.push({ beam: b.id, col: columnOf(s), level: s.local[0], other });
  }
  return out;
}
/** Frames joined to `u` through installed beams (u too), by id. */
export function frameGroup(w: WorldState, u: Entity): Entity[] {
  const seen = new Set([u.id]), q = [u];
  while (q.length) for (const l of links(w, q.pop()!)) if (!seen.has(l.other) && isFrame(w.entities[l.other])) { seen.add(l.other); q.push(w.entities[l.other]!); }
  return [...seen].sort().map((id) => w.entities[id]!);
}
export type Stability = { stable: boolean; group: string[]; missing: string[] };
/** The native Mars v1 rule (rules.ts): a group stands on its own when it has at least two standing frames and each has
 *  beams on both columns at N distinct heights (N = 2 for a frame over 9.5 ft); another frame of the group still held by
 *  its own crew is carried by them, not counted. The frame judged is always counted. */
export function frameStability(w: WorldState, u: Entity): Stability {
  const group = frameGroup(w, u), missing: string[] = [];
  if (group.length < 2) missing.push(`${u.id} is not joined by beams to another upright`);
  for (const g of group) {
    if (!standing(g)) { missing.push(`${g.id} is not standing`); continue; }
    if (g.id !== u.id && heldUp(w, g)) continue;
    const n = def(g.def).size[0] > TALL ? 2 : 1, ls = links(w, g);
    for (const col of ['l', 'r'] as const) {
      const hs = new Set(ls.filter((l) => l.col === col).map((l) => l.level.toFixed(3)));
      if (hs.size < n) missing.push(`${g.id} needs beams on its ${col} column at ${n} height${n > 1 ? 's' : ''} (has ${hs.size})`);
    }
  }
  return { stable: !missing.length, group: group.map((g) => g.id), missing };
}
/** Standing and held up: by its crew, or in a frame that stands on its own. */
export function frameSupported(w: WorldState, u: Entity): boolean {
  return standing(u) && (heldUp(w, u) || (u.phase === 'installed' && !!u.connections?.length && frameStability(w, u).stable));
}

type P = { crew: string[]; beam: string; a: string; b: string; seats: [string, string] };
type Prog = { ends: [string, string]; target: Pose; stations: { p: Vec2; yaw: number }[]; path: Pose[]; duration: number; height: number };
export type ConnectExec = {
  p: P; prog: Prog; id: string; phase: 'approach' | 'lift'; children?: Children; t: number; from: Pose; to: Pose; start: Pose; path?: Pose[]; duration: number;
  crew: string[]; item: string; slots?: string[]; stall?: number; lowering?: true;
};
const fail = (code: string, message: string, subjects: string[]): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: { code, message, subjects } });
const label = (e: Entity) => `${tryDef(e.def)?.label ?? e.def} ${e.id}`;
const f2 = (v: number) => v.toFixed(2);

/** Geometry and preconditions for seating `beam` in seat `seats[0]` of `a` and `seats[1]` of `b`. */
export function planConnect(rt: Runtime, p: P): { ok: true; program: Prog } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world, beam = w.entities[p.beam], a = w.entities[p.a], b = w.entities[p.b];
  if (!isBeamPart(beam)) return fail('beam.not-beam', `${p.beam} is not a loose beam with two ends`, [p.beam]);
  if (p.a === p.b) return fail('beam.misaligned', 'a beam joins two different uprights', [p.a]);
  for (const [u, id] of [[a, p.a], [b, p.b]] as const) {
    if (!isFrame(u)) return fail('beam.not-upright', `${id} is not an upright with beam seats`, [id]);
    if (!standing(u)) return fail('beam.upright-not-standing', `${label(u)} is not standing`, [id]);
    if (!frameSupported(w, u)) return fail('beam.upright-unsupported', `${label(u)} is standing but neither held by its crew nor in a frame that stands on its own`, [id]);
  }
  if (new Set(p.crew).size !== p.crew.length) return fail('crew.duplicate', `crew for seating ${p.beam} lists someone twice`, p.crew);
  if (p.crew.length !== 2) return fail('beam.crew', 'seating a beam needs exactly two people, one at each end', p.crew);
  for (const c of p.crew) {
    if (w.entities[c]?.kind !== 'human') return fail('entity.unknown', `no person "${c}"`, [c]);
    const d = holdingDiagnostic(w, c); if (d) return { ok: false, diagnostic: d };
  }
  const sa = seatOf(a!, p.seats[0]), sb = seatOf(b!, p.seats[1]);
  for (const [u, s, id] of [[a!, sa, p.seats[0]], [b!, sb, p.seats[1]]] as const) {
    if (!s) return fail('beam.no-seat', `${label(u)} has no beam seat ${id}`, [u.id]);
    const t = takenBy(u, id); if (t) return fail('beam.seat-taken', `seat ${id} of ${label(u)} already holds ${t.to}`, [u.id, t.to]);
  }
  const pa = worldPoint(a!, sa!.local), pb = worldPoint(b!, sb!.local), d: Vec2 = [pb[0] - pa[0], pb[2] - pa[2]], span = hypot(d[0], d[1]);
  const ends = socketsOf(beam).filter((s) => s.kind === END), e0 = ends[0]!.local, e1 = ends[1]!.local, len = hypot(e1[0] - e0[0], e1[2] - e0[2]);
  if (Math.abs(pa[1] - pb[1]) > LEVEL_TOL) return fail('beam.misaligned', `seat ${p.seats[0]} of ${a!.id} is at ${f2(pa[1])} m and seat ${p.seats[1]} of ${b!.id} at ${f2(pb[1])} m; a beam is seated level`, [a!.id, b!.id, beam.id]);
  if (Math.abs(span - len) > SEAT_TOL) return fail('beam.misaligned', `the seats are ${f2(span)} m apart; ${label(beam)} spans ${f2(len)} m between its ends`, [a!.id, b!.id, beam.id]);
  // square to each frame (its local y, the frame's normal, lies along the beam) and on the face toward the other frame
  for (const [u, s, q, dir] of [[a!, sa!, pa, 1], [b!, sb!, pb, -1]] as const) {
    const n = worldPoint(u, [s.local[0], s.local[1] + 1, s.local[2]]), nv: Vec2 = [n[0] - q[0], n[2] - q[2]], nl = hypot(nv[0], nv[1]) || 1;
    const cos = (nv[0] * d[0] + nv[1] * d[1]) / (nl * span);
    if (Math.abs(cos) < Math.cos(SQUARE_TOL)) return fail('beam.misaligned', `${label(u)} is not square to the bay: the beam would run ${f2(Math.acos(Math.min(1, Math.abs(cos))) * 180 / Math.PI)}° off its frame`, [u.id, beam.id]);
    const mid = worldPoint(u, [s.local[0], (tryDef(u.def)!.size[1]) / 2, s.local[2]]);
    if (((q[0] - mid[0]) * d[0] + (q[2] - mid[2]) * d[1]) * dir <= 0) return fail('beam.misaligned', `seat ${s.id} of ${u.id} is on the face away from the bay`, [u.id, beam.id]);
  }
  const floor = beam.pose.p[1];
  if (Math.max(pa[1], pb[1]) - floor > STANDING_REACH) return fail('reach.too-high', `a beam seat at ${f2(pa[1] - floor)} m exceeds standing reach (${STANDING_REACH} m); ladders/scaffold/deck access are not modelled yet`, [beam.id, ...p.crew]);
  // the beam's long axis along the bay, the yaw (mod π) nearest the staged one so it does not spin in the air; its ends to the seats by geometry
  const axis = datan2(d[1], d[0]), yaw = wrapAngle(Math.abs(angleDelta(beam.pose.yaw, axis)) > Math.PI / 2 ? axis + Math.PI : axis);
  const toA = (rot2([e0[0], e0[2]], yaw)[0] * d[0] + rot2([e0[0], e0[2]], yaw)[1] * d[1]) < 0;
  const endA = toA ? ends[0]! : ends[1]!, endB = toA ? ends[1]! : ends[0]!;
  const off = rot2([(endA.local[0] + endB.local[0]) / 2, (endA.local[2] + endB.local[2]) / 2], yaw);
  const m: Vec3 = [(pa[0] + pb[0]) / 2 - off[0], (pa[1] + pb[1]) / 2 - (endA.local[1] + endB.local[1]) / 2, (pa[2] + pb[2]) / 2 - off[1]];
  if (beam.support?.kind !== 'ground' || beam.phase !== 'staged' || beam.reservedBy || beam.connections?.length || hypot(beam.pose.p[0] - m[0], beam.pose.p[2] - m[2]) > STAGED_NEAR)
    return fail('beam.not-staged', `${label(beam)} must be lying on the ground within ${STAGED_NEAR} m below its seats (carry it to the bay first)`, [beam.id]);
  const target: Pose = { p: m, yaw };
  // installers stand beyond each end, outside the bay and a little outside the column, facing the seat (beam.ts face)
  const u: Vec2 = [d[0] / span, d[1] / span], out = (s: Socket, q: Vec3, frame: Entity, sgn: number) => {
    const c = worldPoint(frame, [s.local[0], s.local[1], 0]), side: Vec2 = [q[0] - c[0], q[2] - c[2]], sl = hypot(side[0], side[1]) || 1;
    const at: Vec2 = [q[0] + sgn * u[0] * 0.8 + (side[0] / sl) * 0.25, q[2] + sgn * u[1] * 0.8 + (side[1] / sl) * 0.25];
    return { p: at, yaw: datan2(q[2] - at[1], q[0] - at[0]) };
  };
  const lift = sweptLiftPath(rt, beam, beam.pose, target, { ignore: [a!.id, b!.id], what: label(beam) });
  if (!lift.ok) return lift;
  return { ok: true, program: { ends: [endA.id, endB.id], target, stations: [out(sa!, pa, a!, -1), out(sb!, pb, b!, 1)], path: lift.path.poses, duration: liftDuration(lift.path, 2.5), height: pa[1] - floor } };
}

/** The lift so far, backwards: from where the beam is now to where it lay. */
function backPath(ex: ConnectExec, now: Pose): Pose[] {
  const path = ex.path ?? [ex.from, ex.to];
  if (path.length === 2) return [structuredClone(now), structuredClone(ex.start)];
  const lens = path.slice(1).map((q, i) => hypot(q.p[0] - path[i]!.p[0], q.p[1] - path[i]!.p[1], q.p[2] - path[i]!.p[2]) + 1e-9), total = lens.reduce((x, y) => x + y, 0);
  const passed: Pose[] = []; let acc = 0;
  for (let i = 0; i < lens.length; i++) { if (acc / total < ex.t) passed.push(path[i]!); acc += lens[i]!; }
  return [structuredClone(now), ...passed.slice(1).reverse().map((q) => structuredClone(q)), structuredClone(ex.start)];
}

function letGo(rt: Runtime, ex: ConnectExec) {
  for (const c of ex.p.crew) if (rt.world.entities[c]?.human) Object.assign(rt.world.entities[c]!.human!, { activity: 'idle', grip: undefined, task: undefined });
}

export const connectBeamV1: ActionDef<P, Prog, ConnectExec> = {
  verb: 'connect_beam_v1',
  description: 'Two people seat a loose beam lying under a bay into a beam seat of each of two standing, supported uprights (seats: the seat of a, then of b); stopping before the lift lets go, during it lowers the beam back where it lay.',
  schema: z.strictObject({ crew: z.array(z.string().max(80)).min(1).max(4), beam: z.string().max(80), a: z.string().max(80), b: z.string().max(80), seats: z.tuple([z.string().max(40), z.string().max(40)]) }),
  resumable: true,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.beam}`, mode: 'exclusive' as const },
    { resource: `socket:${p.a}.${p.seats[0]}`, mode: 'exclusive' as const }, { resource: `socket:${p.b}.${p.seats[1]}`, mode: 'exclusive' as const }],
  plan(rt, p) {
    const r = planConnect(rt, p);
    if (!r.ok) return r;
    const unreachable = checkStations(rt, p.crew.map((c, i) => ({ actor: c, p: r.program.stations[i]!.p })));
    return unreachable ? { ok: false, diagnostic: { ...unreachable, code: 'beam.station-unreachable' } } : r;
  },
  start(rt, p, prog, id) {
    const beam = rt.world.entities[p.beam]!;
    beam.phase = 'reserved'; beam.reservedBy = id;
    const start = structuredClone(beam.pose);
    return { p, prog, id, phase: 'approach', t: 0, from: structuredClone(start), to: prog.target, start, duration: prog.duration, crew: p.crew, item: p.beam };
  },
  step(rt, ex, dt) {
    const w = rt.world, beam = w.entities[ex.p.beam]!;
    if (ex.phase === 'approach') {
      if (!ex.children) {
        // the crew takes hold beside the beam's ends where it lies (liftcrew pickupPlan) and walks it up
        const pk = pickupPlan(rt, ex.p.crew, beam, ex.prog.target, ex.prog.stations.map((s, i) => ({ ...s, level: w.entities[ex.p.crew[i]!]!.human!.level })));
        if ('code' in pk) return { status: 'failed', diagnostic: pk };
        ex.slots = pk.slots;
        const r = walkCrew(rt, ex.id, pk.moves);
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'beam.station-unreachable' } };
        ex.children = r;
      }
      const s = childrenState(ex.children);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') { beam.phase = 'staged'; beam.reservedBy = undefined; return { status: 'failed', diagnostic: s }; }
      // both ends again at the moment of lifting: a frame may have lost its support, or a seat its room, meanwhile
      beam.phase = 'staged'; beam.reservedBy = undefined;
      const again = planConnect(rt, ex.p);
      if (!again.ok) return { status: 'failed', diagnostic: again.diagnostic };
      ex.path = again.program.path; ex.duration = again.program.duration; ex.prog = { ...ex.prog, ends: again.program.ends, target: again.program.target };
      ex.to = again.program.target; ex.from = structuredClone(beam.pose); ex.t = 0; ex.phase = 'lift';
      beam.support = { kind: 'held', by: [...ex.p.crew] }; beam.phase = 'carried'; beam.reservedBy = ex.id;
      for (const [i, c] of ex.p.crew.entries()) Object.assign(w.entities[c]!.human!, { activity: 'lift', grip: { entity: beam.id, slot: ex.slots?.[i] ?? STATION_SLOT }, task: ex.id });
    }
    const ls = liftStep(rt, ex, dt);
    if (ls !== true) return ls ? { status: 'blocked', diagnostic: ls } : { status: 'running', phase: ex.lowering ? 'lower' : 'lift' };
    letGo(rt, ex);
    beam.reservedBy = undefined;
    if (ex.lowering) {
      beam.pose = structuredClone(ex.start); beam.support = { kind: 'ground' }; beam.phase = 'staged';
      return { status: 'completed', outputs: { lowered: beam.id } };
    }
    // seated: the beam's ends join the two seats, both halves, as the native connections
    const [endA, endB] = ex.prog.ends;
    beam.pose = structuredClone(ex.prog.target); beam.phase = 'installed'; beam.support = { kind: 'connected', to: [ex.p.a, ex.p.b] };
    beam.connections = [{ socket: endA, to: ex.p.a, toSocket: ex.p.seats[0] }, { socket: endB, to: ex.p.b, toSocket: ex.p.seats[1] }];
    (w.entities[ex.p.a]!.connections ??= []).push({ socket: ex.p.seats[0], to: beam.id, toSocket: endA });
    (w.entities[ex.p.b]!.connections ??= []).push({ socket: ex.p.seats[1], to: beam.id, toSocket: endB });
    return { status: 'completed', outputs: { seated: beam.id, stable: frameStability(w, w.entities[ex.p.a]!).stable } };
  },
  cancel(rt, ex) {
    const beam = rt.world.entities[ex.p.beam]!;
    if (ex.lowering) return { ok: true, deferred: true };
    if (ex.phase === 'approach') {
      for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
      beam.phase = 'staged'; beam.reservedBy = undefined;
      letGo(rt, ex);
      return { ok: true };
    }
    // in the air: lowered back along the way it came, to exactly where it lay
    ex.path = backPath(ex, beam.pose); ex.from = structuredClone(beam.pose); ex.to = structuredClone(ex.start);
    ex.duration = Math.max(1, ex.duration * ex.t); ex.t = 0; ex.lowering = true;
    return { ok: true, deferred: true };
  },
};

/** The beam seats a loose beam lying here could go into: pairs of free seats, one on each of two standing, supported
 *  frames nearby, level, a beam's span apart, square to both frames and on the faces toward each other, within standing
 *  reach. One entry per column and height a Soul can choose. */
export type BeamBay = { a: string; b: string; seats: [string, string]; column: 'l' | 'r'; height: number };
export function beamBays(w: WorldState, beamId: string, near = 3.5): BeamBay[] {
  const beam = w.entities[beamId];
  if (!isBeamPart(beam) || beam.support?.kind !== 'ground' || beam.phase !== 'staged' || beam.reservedBy || beam.connections?.length) return [];
  const frames = Object.values(w.entities).filter((e) => isFrame(e) && hypot(e.pose.p[0] - beam.pose.p[0], e.pose.p[2] - beam.pose.p[2]) <= near && frameSupported(w, e)).sort((x, y) => (x.id < y.id ? -1 : 1));
  const ends = socketsOf(beam).filter((s) => s.kind === END), len = hypot(ends[1]!.local[0] - ends[0]!.local[0], ends[1]!.local[2] - ends[0]!.local[2]), floor = beam.pose.p[1];
  const out: BeamBay[] = [];
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const a = frames[i]!, b = frames[j]!;
    const pb = socketsOf(b).filter((s) => s.kind === SEAT && !takenBy(b, s.id)).map((s) => ({ s, q: worldPoint(b, s.local) }));
    for (const s of socketsOf(a)) {
      if (s.kind !== SEAT || takenBy(a, s.id)) continue;
      const q = worldPoint(a, s.local);
      if (q[1] - floor > STANDING_REACH) continue;
      for (const o of pb) {
        if (Math.abs(o.q[1] - q[1]) > LEVEL_TOL || Math.abs(hypot(o.q[0] - q[0], o.q[2] - q[2]) - len) > SEAT_TOL) continue;
        const mid = worldPoint(a, [s.local[0], tryDef(a.def)!.size[1] / 2, s.local[2]]), midB = worldPoint(b, [o.s.local[0], tryDef(b.def)!.size[1] / 2, o.s.local[2]]);
        const d: Vec2 = [o.q[0] - q[0], o.q[2] - q[2]];
        if ((q[0] - mid[0]) * d[0] + (q[2] - mid[2]) * d[1] <= 0 || (o.q[0] - midB[0]) * d[0] + (o.q[2] - midB[2]) * d[1] >= 0) continue;
        out.push({ a: a.id, b: b.id, seats: [s.id, o.s.id], column: columnOf(s), height: +(q[1] - floor).toFixed(2) });
      }
    }
  }
  return out.sort((x, y) => x.height - y.height || (x.column < y.column ? -1 : 1));
}

/** Every tick: an installed loose beam has both ends joined to standing frames, and an upright a crew let go into its beams
 *  (support `connected`, as the native release) stands in a frame that stands on its own. A god's joined upright stands on
 *  the ground by the god's authority (PC12) and is not this. */
export function framesStand(rt: Runtime): Diagnostic[] {
  const w = rt.world, out: Diagnostic[] = [];
  for (const e of Object.values(w.entities)) {
    if (e.phase === 'installed' && isBeamPart(e) && e.support?.kind === 'connected') {
      const to = endJoints(e).map((c) => w.entities[c.to]);
      if (to.length !== 2 || to.some((u) => !isFrame(u) || !standing(u) || !(u.connections ?? []).some((c) => c.to === e.id)))
        out.push({ code: 'beam.unseated', message: `${e.id} is installed but not seated at both ends in standing uprights`, subjects: [e.id] });
    } else if (e.phase === 'installed' && isFrame(e) && e.support?.kind === 'connected' && standing(e)) {
      const st = frameStability(w, e);
      if (!st.stable) out.push({ code: 'support.frame-unstable', message: `${e.id} stands unheld in a frame that does not stand on its own: ${st.missing.join('; ')}`, subjects: [e.id] });
    }
  }
  return out;
}
