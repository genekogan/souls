// PC15 (#694): a deck on a rack bay. Two people set a loose deck joist across a bay onto the step ledges of its two beams,
// and two people lay a loose plywood sheet across five installed joists, so that its top is a floor. The native
// `install_joist` and `install_plywood` (construction/deck.ts) checks and choreography, applied to PC12's typed
// connectors: a joist's two `joist-end`s go into a `joist-seat` of each beam, a sheet's `sheet-bearing`s each into a
// joist's `sheet-seat`, wherever the defs put them. The native rules hold by construction: a joist bears on two beams
// that are seated in supported frames (beamProblems), a sheet on parallel members at most 24 in apart (the seats' pitch)
// along its whole width. Nothing here names a def or a part. The native verbs stay for native decks.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../../../mars/viewer/engine/actions/types.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { def, type AssetDef } from '../../../mars/viewer/engine/world/catalog.ts';
import { angleDelta, datan2, hypot, rot2, wrapAngle, type Vec2, type Vec3 } from '../../../mars/viewer/engine/core/math.ts';
import { holdingDiagnostic, STANDING_REACH } from '../../../mars/viewer/engine/construction/rules.ts';
import { childrenState, walkCrew, type Children } from '../../../mars/viewer/engine/construction/children.ts';
import { findStations, liftDuration, liftStep, sweptLiftPath } from '../../../mars/viewer/engine/construction/access.ts';
import { pickupPlan, STATION_SLOT } from '../../../mars/viewer/engine/construction/liftcrew.ts';
import { frameSupported, isBeamPart, isFrame, worldPoint } from './beam-connect.ts';

export const JOIST_END = 'joist-end', JOIST_SEAT = 'joist-seat', SHEET_BEARING = 'sheet-bearing', SHEET_SEAT = 'sheet-seat';
/** How far a seat may be from where the part's connector would be and still take it (m): PC12's join tolerance. */
const SEAT_TOL = 0.05;
/** The part lies on the ground at most this far (horizontally) from where it goes (m): a joist under its bay, a sheet
 *  beside it (it cannot come up through the joists it goes onto, so it is lifted over from the side). */
const STAGED_NEAR = { joist: 1.5, plywood: 3.5 };

type Socket = NonNullable<AssetDef['sockets']>[number];
const tryDef = (id: string): AssetDef | undefined => { try { return def(id); } catch { return undefined; } };
const socketsOf = (e: Entity | undefined): Socket[] => (e && tryDef(e.def)?.sockets) || [];
const ofKind = (e: Entity | undefined, kind: string) => socketsOf(e).filter((s) => s.kind === kind).sort((a, b) => a.local[0] - b.local[0] || (a.id < b.id ? -1 : 1));
const takenBy = (e: Entity, socket: string) => (e.connections ?? []).find((c) => c.socket === socket);
const item = (e: Entity | undefined): e is Entity => !!e && e.kind !== 'human' && tryDef(e.def)?.category === 'item';
/** A loose part with two joist ends. */
export const isJoistPart = (e: Entity | undefined): e is Entity => item(e) && ofKind(e, JOIST_END).length === 2;
/** A loose sheet with two or more bearing connectors. */
export const isSheetPart = (e: Entity | undefined): e is Entity => item(e) && ofKind(e, SHEET_BEARING).length >= 2;
const label = (e: Entity) => `${tryDef(e.def)?.label ?? e.def} ${e.id}`;
const f2 = (v: number) => v.toFixed(2);
const fail = (code: string, message: string, subjects: string[]): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: { code, message, subjects } });

/** Why a beam cannot carry a joist now ([] = it can): seated at both ends in frames held up by a crew or standing on their own. */
export function beamProblems(w: WorldState, b: Entity | undefined): string[] {
  if (!b) return ['the beam is gone'];
  if (!isBeamPart(b) || b.phase !== 'installed') return [`${b.id} is not a seated beam`];
  const frames = (b.connections ?? []).map((c) => w.entities[c.to]).filter(isFrame);
  if (frames.length < 2) return [`${b.id} is not seated in two uprights`];
  return frames.filter((u) => !frameSupported(w, u)).map((u) => `upright ${u.id} (under beam ${b.id}) is neither held nor in a frame that stands on its own`);
}
/** Why an installed joist cannot carry a sheet now ([] = it can): both ends on beams that can carry it. */
export function joistProblems(w: WorldState, j: Entity | undefined): string[] {
  if (!j) return ['the joist is gone'];
  if (!isJoistPart(j) || j.phase !== 'installed') return [`${j.id} is not an installed joist`];
  return ofKind(j, JOIST_END).flatMap((s) => { const c = takenBy(j, s.id); return c ? beamProblems(w, w.entities[c.to]) : [`${j.id} ${s.id} rests on nothing`]; });
}

type Pair = { host: string; seat: string };
type Prog = { ends: string[]; pairs: Pair[]; target: Pose; stations: { p: Vec2; yaw: number; level: number }[]; path: Pose[]; duration: number };
type Kind = 'joist' | 'plywood';
export type SeatExec = {
  p: { crew: string[] }; part: string; kind: Kind; prog: Prog; id: string; phase: 'approach' | 'lift'; children?: Children; t: number; from: Pose; to: Pose; start: Pose;
  path?: Pose[]; duration: number; crew: string[]; item: string; slots?: string[]; stall?: number; lowering?: true;
};

/** The pose that puts the part's connectors `ends` (in order) on the points `qs`: yaw from the first to the last, the
 *  first on its point; with the largest miss of any connector (m). */
function fit(part: Entity, ends: Socket[], qs: Vec3[]): { pose: Pose; miss: number } {
  const e0 = ends[0]!.local, e1 = ends[ends.length - 1]!.local, q0 = qs[0]!, q1 = qs[qs.length - 1]!;
  const yaw = wrapAngle(datan2(q1[2] - q0[2], q1[0] - q0[0]) - datan2(e1[2] - e0[2], e1[0] - e0[0]));
  const o = rot2([e0[0], e0[2]], yaw), pose: Pose = { p: [q0[0] - o[0], q0[1] - e0[1], q0[2] - o[1]], yaw };
  let miss = 0;
  for (let i = 0; i < ends.length; i++) { const p = worldPoint({ pose }, ends[i]!.local), q = qs[i]!; miss = Math.max(miss, hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); }
  void part;
  return { pose, miss };
}

/** Geometry and preconditions for setting `part` (its connectors of `endKind`) into the seats `pairs`, in either order. */
export function planSeat(rt: Runtime, kind: Kind, crew: string[], partId: string, pairs: Pair[], endKind: string, seatKind: string,
  hostProblems: (w: WorldState, h: Entity | undefined) => string[]): { ok: true; program: Prog } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world, part = w.entities[partId]!, code = (c: string) => `${kind}.${c}`;
  if (new Set(pairs.map((p) => p.host)).size !== pairs.length) return fail(code('no-beams'), `${label(part)} rests on ${pairs.length} different ${kind === 'joist' ? 'beams' : 'joists'}`, [partId]);
  for (const { host } of pairs) {
    const h = w.entities[host], why = hostProblems(w, h);
    if (why.length) return fail(kind === 'joist' ? 'joist.beam-unsupported' : 'plywood.support-unsupported', `${label(part)} cannot rest on ${host}: ${why.join('; ')}`, [partId, host]);
  }
  if (new Set(crew).size !== crew.length) return fail('crew.duplicate', `crew for ${label(part)} lists someone twice`, crew);
  if (crew.length !== 2) return fail(code('crew'), `${kind === 'joist' ? 'setting a joist' : 'laying a sheet'} needs exactly two people, one at each end`, crew);
  for (const c of crew) {
    if (w.entities[c]?.kind !== 'human') return fail('entity.unknown', `no person "${c}"`, [c]);
    const d = holdingDiagnostic(w, c); if (d) return { ok: false, diagnostic: d };
  }
  const qs: Vec3[] = [];
  for (const { host, seat } of pairs) {
    const h = w.entities[host]!, s = socketsOf(h).find((x) => x.id === seat && x.kind === seatKind);
    if (!s) return fail(kind === 'joist' ? 'joist.no-beams' : 'plywood.too-few-supports', `${label(h)} has no ${seatKind} ${seat}`, [host]);
    const t = takenBy(h, seat); if (t) return fail(kind === 'joist' ? 'joist.occupied' : 'plywood.overlap', `${seat} of ${label(h)} already holds ${t.to}`, [host, t.to]);
    qs.push(worldPoint(h, s.local));
  }
  const ends = ofKind(part, endKind);
  if (ends.length !== pairs.length) return fail(kind === 'joist' ? 'joist.no-beams' : 'plywood.too-few-supports', `${label(part)} bears on ${ends.length} supports; ${pairs.length} named`, [partId]);
  // either way round; the one that turns it least where it lies, so it does not spin in the air
  const fits = [fit(part, ends, qs), fit(part, [...ends].reverse(), qs)].map((f, i) => ({ ...f, ends: i ? [...ends].reverse() : ends }))
    .sort((a, b) => Math.abs(angleDelta(part.pose.yaw, a.pose.yaw)) - Math.abs(angleDelta(part.pose.yaw, b.pose.yaw)));
  const good = fits.find((f) => f.miss <= SEAT_TOL);
  if (!good) return fail(kind === 'joist' ? 'joist.no-beams' : 'plywood.span', `${label(part)} does not fit those seats: one of its ends would be ${f2(Math.min(...fits.map((f) => f.miss)))} m from its seat (at most ${SEAT_TOL} m)`, [partId, ...pairs.map((p) => p.host)]);
  const target = good.pose, floor = part.pose.p[1], top = Math.max(...qs.map((q) => q[1]));
  if (part.support?.kind !== 'ground' || part.phase !== 'staged' || part.reservedBy || part.connections?.length || hypot(part.pose.p[0] - target.p[0], part.pose.p[2] - target.p[2]) > STAGED_NEAR[kind])
    return fail(code('not-staged'), `${label(part)} must be lying on the ground within ${STAGED_NEAR[kind]} m of where it goes (carry it to the bay first)`, [partId]);
  if (top - floor > STANDING_REACH) return fail('reach.too-high', `a seat at ${f2(top - floor)} m exceeds standing reach (${STANDING_REACH} m)`, [partId, ...crew]);
  const lift = sweptLiftPath(rt, part, part.pose, target, { ignore: pairs.map((p) => p.host), what: label(part) });
  if (!lift.ok) return lift;
  // one at each end of it where it goes, as the native installs stand them (deck.ts anchors)
  const size = def(part.def).size, u = rot2([size[0] * 0.45, 0], target.yaw), c: Vec2 = [target.p[0], target.p[2]];
  const st = findStations(rt, crew, [[c[0] - u[0], c[1] - u[1]], [c[0] + u[0], c[1] + u[1]]], { label: label(part), obb: { c, half: [size[0] / 2, size[2] / 2], yaw: target.yaw }, y: target.p[1] + size[1], y0: target.p[1] });
  if (!st.ok) return st.diagnostic.code === 'reach.too-high' ? st : fail(code('station-unreachable'), st.diagnostic.message, st.diagnostic.subjects ?? crew);
  return { ok: true, program: { ends: good.ends.map((e) => e.id), pairs, target, stations: st.stations.map((s) => ({ p: s.p, yaw: s.yaw, level: s.level })), path: lift.path.poses, duration: liftDuration(lift.path, kind === 'joist' ? 2.0 : 3.0) } };
}

/** The lift so far, backwards: from where the part is now to where it lay (beam-connect.ts backPath). */
function backPath(ex: SeatExec, now: Pose): Pose[] {
  const path = ex.path ?? [ex.from, ex.to];
  if (path.length === 2) return [structuredClone(now), structuredClone(ex.start)];
  const lens = path.slice(1).map((q, i) => hypot(q.p[0] - path[i]!.p[0], q.p[1] - path[i]!.p[1], q.p[2] - path[i]!.p[2]) + 1e-9), total = lens.reduce((x, y) => x + y, 0);
  const passed: Pose[] = []; let acc = 0;
  for (let i = 0; i < lens.length; i++) { if (acc / total < ex.t) passed.push(path[i]!); acc += lens[i]!; }
  return [structuredClone(now), ...passed.slice(1).reverse().map((q) => structuredClone(q)), structuredClone(ex.start)];
}
function letGo(rt: Runtime, ex: SeatExec) {
  for (const c of ex.crew) if (rt.world.entities[c]?.human) Object.assign(rt.world.entities[c]!.human!, { activity: 'idle', grip: undefined, task: undefined });
}

/** The shared programme of both verbs: walk to it and take hold, check again, lift along the path, set it into its seats. */
function seatAction<P extends { crew: string[] }>(o: { verb: string; kind: Kind; description: string; schema: z.ZodType<P>; part: (p: P) => string; hosts: (p: P) => string[];
  plan: (rt: Runtime, p: P) => { ok: true; program: Prog } | { ok: false; diagnostic: Diagnostic } }): ActionDef<P, Prog, SeatExec> {
  return {
    verb: o.verb, description: o.description, schema: o.schema, resumable: true,
    reservations: (w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${o.part(p)}`, mode: 'exclusive' as const }],
    plan: o.plan,
    start(rt, p, prog, id) {
      const part = rt.world.entities[o.part(p)]!;
      part.phase = 'reserved'; part.reservedBy = id;
      const start = structuredClone(part.pose);
      return { p: { crew: p.crew }, part: o.part(p), kind: o.kind, prog, id, phase: 'approach', t: 0, from: structuredClone(start), to: prog.target, start, duration: prog.duration, crew: p.crew, item: o.part(p) };
    },
    step(rt, ex, dt) {
      const w = rt.world, part = w.entities[ex.part]!;
      if (ex.phase === 'approach') {
        if (!ex.children) {
          const pk = pickupPlan(rt, ex.crew, part, ex.prog.target, ex.prog.stations);
          if ('code' in pk) { part.phase = 'staged'; part.reservedBy = undefined; return { status: 'failed', diagnostic: pk }; }
          ex.slots = pk.slots;
          const r = walkCrew(rt, ex.id, pk.moves);
          if ('code' in r) { part.phase = 'staged'; part.reservedBy = undefined; return { status: 'failed', diagnostic: { ...r, code: `${ex.kind}.station-unreachable` } }; }
          ex.children = r;
        }
        const s = childrenState(ex.children);
        if (s === 'running') return { status: 'running', phase: 'approach' };
        part.phase = 'staged'; part.reservedBy = undefined;
        if (s !== 'done') return { status: 'failed', diagnostic: s };
        // every seat again at the moment of lifting: a beam may have lost its frame's support, or a seat its room, meanwhile
        const again = o.plan(rt, (ex as unknown as { params: P }).params);
        if (!again.ok) return { status: 'failed', diagnostic: again.diagnostic };
        ex.path = again.program.path; ex.duration = again.program.duration; ex.prog = { ...ex.prog, ends: again.program.ends, target: again.program.target };
        ex.to = again.program.target; ex.from = structuredClone(part.pose); ex.t = 0; ex.phase = 'lift';
        part.support = { kind: 'held', by: [...ex.crew] }; part.phase = 'carried'; part.reservedBy = ex.id;
        for (const [i, c] of ex.crew.entries()) Object.assign(w.entities[c]!.human!, { activity: 'lift', grip: { entity: part.id, slot: ex.slots?.[i] ?? STATION_SLOT }, task: ex.id });
      }
      const ls = liftStep(rt, ex, dt);
      if (ls !== true) return ls ? { status: 'blocked', diagnostic: ls } : { status: 'running', phase: ex.lowering ? 'lower' : 'lift' };
      letGo(rt, ex);
      part.reservedBy = undefined;
      if (ex.lowering) {
        part.pose = structuredClone(ex.start); part.support = { kind: 'ground' }; part.phase = 'staged';
        return { status: 'completed', outputs: { lowered: part.id } };
      }
      // set: every connector joins its seat, both halves, as the native connections
      const { ends, pairs } = ex.prog;
      part.pose = structuredClone(ex.prog.target); part.phase = 'installed'; part.support = { kind: 'connected', to: [...new Set(pairs.map((p) => p.host))].sort() };
      part.connections = ends.map((end, i) => ({ socket: end, to: pairs[i]!.host, toSocket: pairs[i]!.seat }));
      for (const [i, end] of ends.entries()) (w.entities[pairs[i]!.host]!.connections ??= []).push({ socket: pairs[i]!.seat, to: part.id, toSocket: end });
      return { status: 'completed', outputs: { installed: part.id, on: pairs.map((p) => p.host) } };
    },
    cancel(rt, ex) {
      const part = rt.world.entities[ex.part]!;
      if (ex.lowering) return { ok: true, deferred: true };
      if (ex.phase === 'approach') {
        for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
        part.phase = 'staged'; part.reservedBy = undefined;
        letGo(rt, ex);
        return { ok: true };
      }
      // in the air: lowered back along the way it came, to exactly where it lay
      ex.path = backPath(ex, part.pose); ex.from = structuredClone(part.pose); ex.to = structuredClone(ex.start);
      ex.duration = Math.max(1, ex.duration * ex.t); ex.t = 0; ex.lowering = true;
      return { ok: true, deferred: true };
    },
  };
}

type JP = { crew: string[]; joist: string; beams: [string, string]; seats: [string, string] };
export function planJoistV1(rt: Runtime, p: JP) {
  const j = rt.world.entities[p.joist];
  if (!isJoistPart(j)) return fail('joist.not-joist', `${p.joist} is not a loose joist with two ends`, [p.joist]);
  return planSeat(rt, 'joist', p.crew, p.joist, p.beams.map((host, i) => ({ host, seat: p.seats[i]! })), JOIST_END, JOIST_SEAT, beamProblems);
}
const joistPlan = (rt: Runtime, p: JP) => planJoistV1(rt, p);
export const installJoistV1: ActionDef<JP, Prog, SeatExec> = withParams(seatAction<JP>({
  verb: 'install_joist_v1', kind: 'joist',
  description: 'Two people set a loose deck joist lying under a bay onto a joist seat of each of the bay\'s two beams (seats: the seat of the first beam, then of the second); stopping before the lift lets go, during it lowers the joist back where it lay.',
  schema: z.strictObject({ crew: z.array(z.string().max(80)).min(1).max(4), joist: z.string().max(80), beams: z.tuple([z.string().max(80), z.string().max(80)]), seats: z.tuple([z.string().max(40), z.string().max(40)]) }),
  part: (p) => p.joist, hosts: (p) => p.beams, plan: joistPlan,
}));

type SP = { crew: string[]; sheet: string; joists: string[] };
export function planSheetV1(rt: Runtime, p: SP) {
  const s = rt.world.entities[p.sheet];
  if (!isSheetPart(s)) return fail('plywood.not-plywood', `${p.sheet} is not a loose sheet that bears on joists`, [p.sheet]);
  const pairs: Pair[] = [];
  for (const id of p.joists) { const seat = ofKind(rt.world.entities[id], SHEET_SEAT)[0]; if (!seat) return fail('plywood.too-few-supports', `${id} is not a joist a sheet rests on`, [p.sheet, id]); pairs.push({ host: id, seat: seat.id }); }
  return planSeat(rt, 'plywood', p.crew, p.sheet, pairs, SHEET_BEARING, SHEET_SEAT, joistProblems);
}
export const laySheetV1: ActionDef<SP, Prog, SeatExec> = withParams(seatAction<SP>({
  verb: 'lay_sheet_v1', kind: 'plywood',
  description: 'Two people lay a loose plywood sheet lying beside a bay across the installed joists it bears on (joists: in order along the bay), lifting it over from the side; stopping before the lift lets go, during it lowers the sheet back where it lay.',
  schema: z.strictObject({ crew: z.array(z.string().max(80)).min(1).max(4), sheet: z.string().max(80), joists: z.array(z.string().max(80)).min(2).max(8) }),
  part: (p) => p.sheet, hosts: (p) => p.joists, plan: planSheetV1,
}));
/** The exec keeps its own params, so the lift's second plan reads exactly what was asked. */
function withParams<P extends { crew: string[] }>(a: ActionDef<P, Prog, SeatExec>): ActionDef<P, Prog, SeatExec> {
  return { ...a, start(rt, p, prog, id) { const ex = a.start(rt, p, prog, id); return Object.assign(ex, { params: structuredClone(p) }); } };
}

/** The joist seat pairs a loose joist lying here could go into: one free `joist-seat` on each of two seated beams that
 *  can carry it, a joist's length apart, level and facing each other across a bay. One entry per position along it. */
export type JoistBay = { beams: [string, string]; seats: [string, string]; at: number };
export function joistBays(w: WorldState, joistId: string, near = 3): JoistBay[] {
  const j = w.entities[joistId];
  if (!isJoistPart(j) || j.support?.kind !== 'ground' || j.phase !== 'staged' || j.reservedBy || j.connections?.length) return [];
  const [e0, e1] = ofKind(j, JOIST_END), len = hypot(e1!.local[0] - e0!.local[0], e1!.local[2] - e0!.local[2]);
  const beams = Object.values(w.entities).filter((b) => isBeamPart(b) && ofKind(b, JOIST_SEAT).length && hypot(b.pose.p[0] - j.pose.p[0], b.pose.p[2] - j.pose.p[2]) <= near + 1.5 && !beamProblems(w, b).length).sort((x, y) => (x.id < y.id ? -1 : 1));
  const out: JoistBay[] = [];
  for (let i = 0; i < beams.length; i++) for (let k = i + 1; k < beams.length; k++) {
    const a = beams[i]!, b = beams[k]!;
    const free = (x: Entity) => ofKind(x, JOIST_SEAT).filter((s) => !takenBy(x, s.id)).map((s) => ({ s, q: worldPoint(x, s.local) }));
    const fb = free(b);
    for (const sa of free(a)) for (const sb of fb) {
      if (Math.abs(sa.q[1] - sb.q[1]) > 0.02 || Math.abs(hypot(sb.q[0] - sa.q[0], sb.q[2] - sa.q[2]) - len) > SEAT_TOL) continue;
      const mid: Vec2 = [(sa.q[0] + sb.q[0]) / 2, (sa.q[2] + sb.q[2]) / 2];
      if (hypot(mid[0] - j.pose.p[0], mid[1] - j.pose.p[2]) > near) continue;
      // along the bay: how far from the first beam's middle, its own x
      out.push({ beams: [a.id, b.id], seats: [sa.s.id, sb.s.id], at: +sa.s.local[0].toFixed(2) });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}
/** The installed joists a loose sheet lying here could be laid across: one free `sheet-seat` per bearing connector,
 *  in a row the sheet's connectors fit, every joist able to carry it. */
export function sheetBays(w: WorldState, sheetId: string, near = 3.5): string[][] {
  const s = w.entities[sheetId];
  if (!isSheetPart(s) || s.support?.kind !== 'ground' || s.phase !== 'staged' || s.reservedBy || s.connections?.length) return [];
  const ends = ofKind(s, SHEET_BEARING), n = ends.length, pitch = hypot(ends[1]!.local[0] - ends[0]!.local[0], ends[1]!.local[2] - ends[0]!.local[2]);
  const js = Object.values(w.entities).filter((j) => isJoistPart(j) && j.phase === 'installed' && ofKind(j, SHEET_SEAT).some((x) => !takenBy(j, x.id)) && !joistProblems(w, j).length)
    .map((j) => ({ j, q: worldPoint(j, ofKind(j, SHEET_SEAT)[0]!.local) })).filter((x) => hypot(x.q[0] - s.pose.p[0], x.q[2] - s.pose.p[2]) <= near + pitch * n / 2);
  const out: string[][] = [];
  // rows: start at each joist, step to the next one a pitch further along the line the first two make
  for (const a of js) for (const b of js) {
    if (a === b || Math.abs(hypot(b.q[0] - a.q[0], b.q[2] - a.q[2]) - pitch) > SEAT_TOL || Math.abs(b.q[1] - a.q[1]) > 0.02) continue;
    const d: Vec3 = [b.q[0] - a.q[0], 0, b.q[2] - a.q[2]], row = [a, b];
    while (row.length < n) { const last = row[row.length - 1]!, want: Vec3 = [last.q[0] + d[0], last.q[1], last.q[2] + d[2]]; const nx = js.find((x) => !row.includes(x) && hypot(x.q[0] - want[0], x.q[1] - want[1], x.q[2] - want[2]) <= SEAT_TOL); if (!nx) break; row.push(nx); }
    if (row.length === n && (row[0]!.j.id < row[n - 1]!.j.id)) out.push(row.map((x) => x.j.id));
  }
  return out.sort((x, y) => (x.join() < y.join() ? -1 : 1));
}

/** Every tick: an installed deck joist has both ends joined to installed beams, and an installed deck sheet every bearing
 *  connector to an installed joist, each joint reciprocal (`deck.unsupported`). */
export function decksBear(rt: Runtime): Diagnostic[] {
  const w = rt.world, out: Diagnostic[] = [];
  for (const e of Object.values(w.entities)) {
    if (e.phase !== 'installed') continue;
    const joist = isJoistPart(e), sheet = !joist && isSheetPart(e);
    if (!joist && !sheet) continue;
    for (const s of ofKind(e, joist ? JOIST_END : SHEET_BEARING)) {
      const c = takenBy(e, s.id), h = c && w.entities[c.to];
      if (!c || !h || h.phase !== 'installed' || !(joist ? isBeamPart(h) : isJoistPart(h)) || !(h.connections ?? []).some((x) => x.to === e.id && x.socket === c.toSocket && x.toSocket === s.id)) {
        out.push({ code: 'deck.unsupported', message: `${label(e)} is installed but its ${s.id} does not rest on an installed ${joist ? 'beam' : 'joist'}`, subjects: [e.id] });
        break;
      }
    }
  }
  return out;
}
