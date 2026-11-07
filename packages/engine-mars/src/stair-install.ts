// PC16 (#695): stairs up to a rack deck. Two people set a loose stair flight standing beside a bay so that its header's
// `stair-hook` hangs on a free ledge seat of the bay's outer beam face (a step beam's `joist-seat`, PC15), its foot on
// the ground; one person (or two) sets a loose tread into one of its `tread-seat`s. The native `install_stair_flight`
// and `install_tread` (construction/stairs.ts) checks, applied to PC12's typed connectors: the flight hangs on a beam
// seated in supported frames (beam-connect frameSupported), its hook height fits the ledge so its foot stands on the
// ground, nothing and nobody is where it goes; a tread goes only into an installed, supported flight. Both reuse PC15's
// seat programme (deck-install.ts seatAction): walk to it, take hold, lift along the swept path, set it on its seat.
// Whether the flight can be walked (every tread in, a floor at its top) is the bridge's stairs link (engine-bridge.ts).
// Nothing here names a def or a part. The native verbs stay for native stairs.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../../../mars/viewer/engine/actions/types.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { def } from '../../../mars/viewer/engine/world/catalog.ts';
import { datan2, hypot, obbOverlap, pointInObb, rot2, type OBB2, type Vec2, type Vec3 } from '../../../mars/viewer/engine/core/math.ts';
import { HUMAN_PROFILE } from '../../../mars/viewer/engine/spatial/types.ts';
import { spatialOf, symmetricYaw } from '../../../mars/viewer/engine/construction/access.ts';
import { isBeamPart, worldPoint } from './beam-connect.ts';
import { beamProblems, fail, isJoistPart, item, label, ofKind, planSeat, seatAction, takenBy, withParams, JOIST_SEAT, type Place, type Prog, type SeatExec, type Stand } from './deck-install.ts';

export const STAIR_HOOK = 'stair-hook', TREAD_SEAT = 'tread-seat', TREAD_BEARING = 'tread-bearing';
/** How far the flight's foot may be above or below the ground it stands on when its hook is on the ledge (m): PC12's join tolerance. */
const RISE_TOL = 0.05;

/** A loose or installed stair flight: one hook and its tread seats. */
export const isFlightPart = (e: Entity | undefined): e is Entity => item(e) && ofKind(e, STAIR_HOOK).length === 1 && ofKind(e, TREAD_SEAT).length >= 1;
/** A loose or installed tread: one bearing connector into a tread seat. */
export const isTreadPart = (e: Entity | undefined): e is Entity => item(e) && ofKind(e, TREAD_BEARING).length === 1;
/** A flight's tread seats from the bottom up (their order along its run), each with its number. */
export const treadSeats = (f: Entity) => ofKind(f, TREAD_SEAT).map((s, i) => ({ id: s.id, n: i + 1, local: s.local }));
/** The numbers of a flight's treads that are not in (a tread seat joined to an installed tread is in). */
export function missingTreads(w: WorldState, f: Entity): number[] {
  return treadSeats(f).filter((s) => { const c = takenBy(f, s.id); return !c || w.entities[c.to]?.phase !== 'installed'; }).map((s) => s.n);
}
/** "treads 3–5 missing" / "tread 4 missing" / "treads 1, 3 missing" (construction/stairs.ts treadsPhrase). */
export function treadsPhrase(ix: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ix.length;) {
    let j = i; while (j + 1 < ix.length && ix[j + 1] === ix[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${ix[i]}–${ix[j]}` : j === i ? `${ix[i]}` : `${ix[i]}, ${ix[j]}`);
    i = j + 1;
  }
  return `${ix.length === 1 ? 'tread' : 'treads'} ${parts.join(', ')} missing`;
}
/** Why an installed flight cannot take a tread now ([] = it can): its hook on a beam that can carry it. */
export function flightProblems(w: WorldState, f: Entity | undefined): string[] {
  if (!f) return ['the stair flight is gone'];
  if (!isFlightPart(f) || f.phase !== 'installed') return [`${f.id} is not an installed stair flight`];
  const h = ofKind(f, STAIR_HOOK)[0]!, c = takenBy(f, h.id);
  return c ? beamProblems(w, w.entities[c.to]) : [`${f.id} hangs on nothing`];
}

/** Where a flight goes with its hook on the ledge point `q` of `beam`: it ascends toward the beam, square to it, from
 *  the side of the face the seat is on. */
export function flightPose(part: Entity, beam: Entity, q: Vec3): Pose {
  const zAxis = rot2([0, 1], beam.pose.yaw), side = (q[0] - beam.pose.p[0]) * zAxis[0] + (q[2] - beam.pose.p[2]) * zAxis[1] >= 0 ? 1 : -1;
  const yaw = datan2(-zAxis[1] * side, -zAxis[0] * side), hook = ofKind(part, STAIR_HOOK)[0]!.local, o = rot2([hook[0], hook[2]], yaw);
  return { p: [q[0] - o[0], q[1] - hook[1], q[2] - o[1]], yaw };
}
const sizeOf = (e: Entity) => def(e.def).size;
/** The flight's footprint where it stands at `pose` (its box is centred on its origin in plan). */
export const flightObb = (e: Entity, pose: Pose): OBB2 => { const s = sizeOf(e); return { c: [pose.p[0], pose.p[2]], half: [s[0] / 2, s[2] / 2], yaw: pose.yaw }; };

type FP = { crew: string[]; flight: string; beam: string; seat: string };
export function planFlightV1(rt: Runtime, p: FP) {
  const w = rt.world, f = w.entities[p.flight];
  if (!isFlightPart(f)) return fail('stair.not-stair', `${p.flight} is not a loose stair flight`, [p.flight]);
  if (!isBeamPart(w.entities[p.beam])) return fail('stair.beam-unsupported', `${p.beam} is not a rack beam a flight hangs on`, [p.flight, p.beam]);
  const place: Place = (part, qs, hosts) => {
    const pose = flightPose(part, hosts[0]!, qs[0]!), ground = part.pose.p[1], off = pose.p[1] - ground;
    if (Math.abs(off) > RISE_TOL) return fail('stair.rise', `${label(part)} does not fit that ledge: with its hook on it, its foot would be ${Math.abs(off).toFixed(2)} m ${off > 0 ? 'above' : 'below'} the ground (at most ${RISE_TOL} m)`, [part.id, hosts[0]!.id]);
    // nothing in the way where it stands (the beam it hangs on, and anything it already touches, aside)
    const obb = flightObb(part, pose), top = pose.p[1] + sizeOf(part)[1];
    for (const o of spatialOf(rt).scene.obstacles) {
      if (o.id === part.id || o.id === hosts[0]!.id || o.y1 <= pose.p[1] + 0.02 || o.y0 >= top - 0.02) continue;
      if (obbOverlap(obb, o.obb, -0.01)) return fail('stair.site-blocked', `${label(part)} would stand through ${o.label ?? o.id} where it goes`, [part.id, o.id]);
    }
    for (const h of Object.values(w.entities))
      if (h.kind === 'human' && !p.crew.includes(h.id) && (h.human?.level ?? 0) === 0 && pointInObb([h.pose.p[0], h.pose.p[2]], obb, HUMAN_PROFILE.radius))
        return fail('stair.site-occupied', `${h.id} is standing where ${label(part)} goes`, [part.id, h.id]);
    return { pose, ends: [ofKind(part, STAIR_HOOK)[0]!.id] };
  };
  // one either side of the flight, at its middle, clear of it once it stands: the walk grid reads a turned flight up to 0.28 m wider (PC17)
  const stand: Stand = (part, t) => {
    const s = sizeOf(part), n = rot2([0, s[2] / 2 + 0.62], t.yaw), c: Vec2 = [t.p[0], t.p[2]];
    return { points: [[c[0] - n[0], c[1] - n[1]], [c[0] + n[0], c[1] + n[1]]], obb: flightObb(part, t), y: t.p[1] + s[1], y0: t.p[1] };
  };
  return planSeat(rt, 'flight', p.crew, p.flight, [{ host: p.beam, seat: p.seat }], STAIR_HOOK, JOIST_SEAT, beamProblems, { place, stand });
}
export const installFlightV1: ActionDef<FP, Prog, SeatExec> = withParams(seatAction<FP>({
  verb: 'install_flight_v1', kind: 'flight',
  description: 'Two people set a loose stair flight standing beside a bay so that its header hangs on a free ledge seat of a seated beam (its foot on the ground); its treads go in separately. Stopping before the lift lets go, during it lowers the flight back where it stood.',
  schema: z.strictObject({ crew: z.array(z.string().max(80)).min(1).max(4), flight: z.string().max(80), beam: z.string().max(80), seat: z.string().max(40) }),
  part: (p) => p.flight, hosts: (p) => [p.beam], plan: planFlightV1, seats: (_w, p) => [`${p.beam}:${p.seat}`],
}));

type TP = { crew: string[]; tread: string; flight: string; index: number };
const seatOf = (w: WorldState, p: TP) => { const f = w.entities[p.flight]; return isFlightPart(f) ? treadSeats(f).find((s) => s.n === p.index) : undefined; };
export function planTreadV1(rt: Runtime, p: TP) {
  const w = rt.world, t = w.entities[p.tread], f = w.entities[p.flight];
  if (!isTreadPart(t)) return fail('tread.not-tread', `${p.tread} is not a loose stair tread`, [p.tread]);
  if (!isFlightPart(f)) return fail('tread.no-stair', `${p.flight} is not a stair flight`, [p.flight]);
  const s = seatOf(w, p);
  if (!s) return fail('tread.index', `${label(f)} has treads 1–${treadSeats(f).length}; ${p.index} asked`, [p.flight]);
  const place: Place = (part, qs, hosts) => ({ pose: { p: [qs[0]![0], qs[0]![1], qs[0]![2]], yaw: symmetricYaw(part.pose.yaw, hosts[0]!.pose.yaw + Math.PI / 2) }, ends: [ofKind(part, TREAD_BEARING)[0]!.id] });
  // beside the flight, out of it, level with the tread
  const stand: Stand = (part, to) => ({ points: [[to.p[0], to.p[2]], [to.p[0], to.p[2]]], obb: flightObb(f, f.pose), y: to.p[1] + sizeOf(part)[1], y0: to.p[1] });
  return planSeat(rt, 'tread', p.crew, p.tread, [{ host: p.flight, seat: s.id }], TREAD_BEARING, TREAD_SEAT, flightProblems, { place, stand, crew: [1, 2] });
}
export const installTreadV1: ActionDef<TP, Prog, SeatExec> = withParams(seatAction<TP>({
  verb: 'install_tread_v1', kind: 'tread',
  description: 'One person (or two) sets a loose stair tread lying by an installed stair flight into its tread `index` (1 = bottom). Stopping before the lift lets go, during it lowers the tread back where it lay.',
  schema: z.strictObject({ crew: z.array(z.string().max(80)).min(1).max(2), tread: z.string().max(80), flight: z.string().max(80), index: z.number().int().min(1).max(40) }),
  part: (p) => p.tread, hosts: (p) => [p.flight], plan: planTreadV1, seats: (w, p) => [`${p.flight}:${seatOf(w, p)?.id ?? p.index}`],
}));

/** The ledge seats a loose flight standing here could hang on: a free seat on the outer face of a seated, supported
 *  beam that carries a deck (a joist on its other face), where the flight's foot then stands on the ground. A seat
 *  must take a stair hook (its def says), and not be the last along the face: stairs up to the deck's very edge land
 *  where no body fits. `near` is `planSeat`'s reach for a flight. */
export type FlightBay = { beam: string; seat: string; at: number };
export function flightBays(w: WorldState, flightId: string, near = 3): FlightBay[] {
  const f = w.entities[flightId];
  if (!isFlightPart(f) || f.support?.kind !== 'ground' || f.phase !== 'staged' || f.reservedBy || f.connections?.length) return [];
  const out: FlightBay[] = [];
  for (const b of Object.values(w.entities).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!isBeamPart(b) || hypot(b.pose.p[0] - f.pose.p[0], b.pose.p[2] - f.pose.p[2]) > near + 1.5 || beamProblems(w, b).length) continue;
    const seats = ofKind(b, JOIST_SEAT), deckSide = seats.filter((s) => { const c = takenBy(b, s.id); return c && isJoistPart(w.entities[c.to]); }).map((s) => Math.sign(s.local[2]));
    if (!deckSide.length) continue;
    for (const s of seats) {
      if (takenBy(b, s.id) || deckSide.includes(Math.sign(s.local[2])) || (s.mates && !s.mates.includes(STAIR_HOOK))) continue;
      const along = seats.filter((x) => Math.sign(x.local[2]) === Math.sign(s.local[2]));
      if (s === along[0] || s === along[along.length - 1]) continue;
      const q = worldPoint(b, s.local), pose = flightPose(f, b, q);
      if (Math.abs(pose.p[1] - f.pose.p[1]) > RISE_TOL || hypot(pose.p[0] - f.pose.p[0], pose.p[2] - f.pose.p[2]) > near) continue;
      out.push({ beam: b.id, seat: s.id, at: +s.local[0].toFixed(2) });
    }
  }
  return out.sort((x, y) => x.at - y.at || (x.beam < y.beam ? -1 : 1));
}
/** The beam of a deck near this loose flight whose ledge would have had room but does not take a stair hook. */
export function flightUnfit(w: WorldState, flightId: string, near = 3): string | null {
  const f = w.entities[flightId];
  if (!isFlightPart(f) || f.support?.kind !== 'ground' || f.phase !== 'staged' || f.reservedBy || f.connections?.length) return null;
  for (const b of Object.values(w.entities).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!isBeamPart(b) || hypot(b.pose.p[0] - f.pose.p[0], b.pose.p[2] - f.pose.p[2]) > near + 1.5 || beamProblems(w, b).length) continue;
    const seats = ofKind(b, JOIST_SEAT), carries = seats.some((s) => { const c = takenBy(b, s.id); return c && isJoistPart(w.entities[c.to]); });
    if (carries && seats.every((s) => s.mates && !s.mates.includes(STAIR_HOOK))) return b.id;
  }
  return null;
}
/** The flight a loose tread lying here goes into next, and which tread: the nearest installed, supported flight with a
 *  tread missing, its lowest missing one, within `near` of that seat (`planSeat`'s reach for a tread). */
export function treadTarget(w: WorldState, treadId: string, near = 3): { flight: string; index: number } | null {
  const t = w.entities[treadId];
  if (!isTreadPart(t) || t.support?.kind !== 'ground' || t.phase !== 'staged' || t.reservedBy || t.connections?.length) return null;
  let best: { flight: string; index: number; d: number } | null = null;
  for (const f of Object.values(w.entities)) {
    if (!isFlightPart(f) || f.phase !== 'installed' || flightProblems(w, f).length) continue;
    const miss = missingTreads(w, f), seat = treadSeats(f).find((s) => s.n === miss[0]);
    if (!seat) continue;
    const q = worldPoint(f, seat.local), d = hypot(q[0] - t.pose.p[0], q[2] - t.pose.p[2]);
    if (d > near) continue;
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && f.id < best.flight)) best = { flight: f.id, index: miss[0]!, d };
  }
  return best && { flight: best.flight, index: best.index };
}

/** Every tick: an installed flight's hook is joined to an installed beam, and an installed tread to an installed
 *  flight, each joint reciprocal (`stair.unsupported`). */
export function stairsBear(rt: Runtime): Diagnostic[] {
  const w = rt.world, out: Diagnostic[] = [];
  for (const e of Object.values(w.entities)) {
    if (e.phase !== 'installed') continue;
    const flight = isFlightPart(e), tread = !flight && isTreadPart(e);
    if (!flight && !tread) continue;
    const s = ofKind(e, flight ? STAIR_HOOK : TREAD_BEARING)[0]!, c = takenBy(e, s.id), h = c && w.entities[c.to];
    if (!c || !h || h.phase !== 'installed' || !(flight ? isBeamPart(h) : isFlightPart(h)) || !(h.connections ?? []).some((x) => x.to === e.id && x.socket === c.toSocket && x.toSocket === s.id))
      out.push({ code: 'stair.unsupported', message: `${label(e)} is installed but its ${s.id} does not rest on an installed ${flight ? 'beam' : 'stair flight'}`, subjects: [e.id] });
  }
  return out;
}
