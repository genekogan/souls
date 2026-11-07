// `carry` action (spec §11, §13): gather → lift → move → set-down → release.
// The crew and load move as one rigid formation along a trajectory that was
// validated for the whole formation at submit time. Carrier positions are
// derived from the load pose every tick, so grips never drift. Cancelling
// never drops a load: it becomes a controlled set-down (deferred cancel) at
// the current pose if that spot is clear, otherwise it is refused.
import {CARRY_REACH_SECONDS, CARRY_RELEASE_SECONDS, carryContactWeight} from './contact.ts';
import { blockedWait } from '../runtime/waits.ts';
import { z } from 'zod';
import { angleDelta, clamp, dcos, dsin, rot2, wrapAngle, type Vec2, hypot } from '../core/math.ts';
import type { ActionDef, CancelResult, Diagnostic, StepResult } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { makeWay, stairBlocker, traffic, walkTo, takeReplan } from '../locomotion/walk.ts';
import { CARRY_CLIMB_SPEED, climbPose, type ClimbPose } from './climb.ts';
import { entityFootprint } from '../spatial/service.ts';
import { carriedPose, carrierSpots, entityFrame, formationFor, laidPose, worldDiscs, isCarryLoad, type SE2 } from './formation.ts';
import { poseHit } from './sweep.ts';
import { labelOf, laidIssue, planCarryAction, type CarryParams, type CarryProgram } from './validate.ts';
import { PLAN_MAX_EXPAND, planCarry } from './planner.ts';
import { nearestBlocker } from '../spatial/grid.ts';
import { relevantEntities } from '../world/relevant.ts';
import { MAX_LEVEL_ID } from '../spatial/types.ts';

export const CARRY_SPEED = 0.9; // m/s of the fastest-moving formation point (centre + load tips under rotation)
const ACCEL = 0.5; // m/s²
const RETREAT = 1; // m a refused crew backs along its route before it sets down (#1150)
const LIFT_S = 1.2;
const LIFT_REACH = 1.7; // m a walker covers in a lift (PC17)
const SETDOWN_S = 1.2;
const RELEASE_S = 0.4;
const GATHER_TIMEOUT_S = 120;
const TURN_RATE = 3.0; // rad/s, turning to face along the load before lifting

type WalkExec = ReturnType<typeof walkTo.start>;
type Transition = { from: Pose; to: Pose; fromSpots: Vec2[]; toSpots: Vec2[]; yaw: number; final: Entity['phase'] };
export type CarryExec = {
  id: string;
  p: CarryProgram;
  phase: 'gather' | 'lift' | 'move' | 'climb' | 'set-down' | 'release';
  walks: (WalkExec | null)[];
  t: number;
  u: number;
  v: number;
  i: number;
  q: SE2;
  tr?: Transition;
  cancelling: boolean;
  epoch: number;
  replans?: number;
  /** A construction cut with no alternative from here, at that scene epoch: held (blocked) without replanning again
   *  until the scene changes (PC07). */
  cut?: { epoch: number; diagnostic: Diagnostic };
  /** #1150: the world refused the crew's move. It backs along the route it came by, to this arc length, and sets down there. */
  retreatTo?: number;
  reachStart?: number;
  waited?: number;
  /** Climb (between levels): traversal parameter, whether the flight's traffic resource is held, done. */
  s?: number;
  onStair?: boolean;
  climbed?: boolean;
};

export const carrySchema = z.strictObject({
  crew: z.array(z.string().max(80)).min(1).max(8).refine((a) => new Set(a).size === a.length, 'crew members must be distinct'),
  item: z.string().max(80),
  to: z.strictObject({ x: z.number().min(-500).max(500), z: z.number().min(-500).max(500), yaw: z.number().min(-7).max(7), level: z.number().int().min(0).max(MAX_LEVEL_ID).optional() }),
  place: z.literal('lay').optional(),
  via: z.string().max(80).optional(),
  /** PC07 (#686), opt-in: a route cut with no alternative is held at that scene epoch (no new search each tick) and its
   *  diagnostic names the obstacle at the cut and whether the search was exhausted. Only the server's shared carries
   *  ask for it; every other carry is unchanged. */
  holdCutV1: z.literal(true).optional(),
  /** PC17 (#696): a shared carry does not leave the ground while a body outside the crew stands within the load's cover
   *  (another crew at work beside it): it waits, asking them to move, as for the grip positions; and it halts short of
   *  another crew's load on its way, as for a person. */
  clearLiftV1: z.literal(true).optional(),
});

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({
  p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
  yaw: wrapAngle(a.yaw + angleDelta(a.yaw, b.yaw) * t),
  pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * t,
  roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * t,
});
const crewOf = (rt: Runtime, ex: CarryExec): Entity[] => ex.p.crew.map((id) => rt.world.entities[id]);
const itemOf = (rt: Runtime, ex: CarryExec) => rt.world.entities[ex.p.item];

export type LoadDisc = { p: Vec2; r: number; actionId: string; entity: string; crew: string[]; level: number; braking?: boolean };

export const carryExecsOf = (rt: Runtime): Map<string, CarryExec> => (rt.services.carryExecs ??= new Map());

/**
 * Read-only: the load discs of every load currently lifted by a live `carry` action (review C3).
 * With `braking`, a moving crew's load and carriers also contribute their discs where they would come
 * to rest if the crew braked now (marked `braking`), so a walker never steps where the formation
 * cannot stop short of it.
 * Walkers read this through `rt.services.loadDiscs` (registered on carry start: no walk.ts → carry
 * import cycle); the human-load invariant uses the current discs only.
 */
export function activeLoadDiscs(rt: Runtime, braking = false): LoadDisc[] {
  const out: LoadDisc[] = [];
  for (const e of relevantEntities(rt.world)) {   // carried loads (a phase) only (world/relevant.ts)
    if (!isCarryLoad(e) || e.support?.kind !== 'held' || !e.support.by.length) continue;
    const actionId = e.reservedBy;
    if (!actionId || !['carry', 'move_fixture'].includes(rt.records.get(actionId)?.verb ?? '') || !rt.isActive(actionId)) continue;
    const crew = e.support.by;
    const level = rt.world.entities[crew[0]]?.human?.level ?? 0;
    const f = formationFor(e.def, crew.length);
    for (const d of worldDiscs(f, entityFrame(e).q)) if (d.d.part === 'load') out.push({ p: d.p, r: d.d.r, actionId, entity: e.id, crew, level });
    const ex = braking ? carryExecsOf(rt).get(actionId) : undefined;
    if (ex?.phase !== 'move' || ex.v < 0.02) continue;
    const U = ex.p.traj.u[ex.p.traj.u.length - 1], i0 = ex.i;
    const stop = (ex.v * ex.v) / (4 * ACCEL) + ex.v / 20; // braking distance at 2·ACCEL + one tick
    // carriers too: a walker must not stop where a carrier will be before the crew can halt (walkers
    // only see the carriers' current bodies otherwise — the "walker beside the carry path" gap)
    for (const k of [0.5, 1]) for (const d of worldDiscs(f, poseAtU(ex, Math.min(U, ex.u + k * stop)))) out.push({ p: d.p, r: d.d.r, actionId, entity: e.id, crew, level, braking: true });
    ex.i = i0; // poseAtU advances the segment cursor; restore it
  }
  return out;
}

/** Upright fixtures are held in front of each carrier; construction defaults face along the load. */
const carryFacing = (ex: CarryExec, yaw:number, index=0) => wrapAngle(yaw - (ex.p.fixture ? ex.p.f.carriers[index].side * Math.PI / 2 : 0));

/** Place load + carriers for formation pose q (the only way positions change while moving). */
function applyFormation(rt: Runtime, ex: CarryExec, q: SE2) {
  const item = itemOf(rt, ex);
  item.pose = carriedPose(ex.p.f, q, ex.p.levelY);
  const spots = carrierSpots(ex.p.f, q);
  crewOf(rt, ex).forEach((h, i) => {
    h.pose = { p: [spots[i][0], ex.p.levelY, spots[i][1]], yaw: carryFacing(ex, q.th, i) };
  });
  ex.q = q;
}

/** #1150: a refused crew's next step back would meet a person or something solid. */
function retreatBlocked(rt: Runtime, ex: CarryExec, sp: Spatial, u: number): boolean {
  const i0 = ex.i, g = sp.level(ex.p.level); ex.i = 0;
  const q = poseAtU(ex, u); ex.i = i0;
  return !!pathBystander(rt, ex, u) || (!!g && poseHit(g, ex.p.f, q, 0) >= 0);
}

/** A non-crew person inside the formation's footprint (load discs + carrier spots) at arc length u. */
/** PC17 (#696): a body outside the crew within the load's cover where it lies (the cover `humanLoadClearance` keeps once it is lifted). */
function liftBystander(rt: Runtime, ex: CarryExec): string | null {
  const p = ex.p, discs = worldDiscs(p.f, p.pickup);
  for (const o of Object.values(rt.world.entities)) {
    if (o.kind !== 'human' || p.crew.includes(o.id) || o.human?.level !== p.level) continue;
    // the lift takes LIFT_S and nobody stops it: someone on the move could walk into its cover before it is done
    const closing = (o.human?.speed ?? 0) > 0.05 ? LIFT_REACH : 0;
    if (discs.some((d) => hypot(d.p[0] - o.pose.p[0], d.p[1] - o.pose.p[2]) < d.d.r + 0.28 + 0.08 + closing)) return o.id;
  }
  return null;
}

/** PC17 (#696): someone of another crew whose load this formation (its load or a carrier) would touch at `u`: a crew
 *  walking into another's load is the same overlap as a bystander's (`humanLoadClearance`), and halts the same way. */
function pathOtherLoad(rt: Runtime, ex: CarryExec, u: number): string | null {
  const p = ex.p, others = activeLoadDiscs(rt).filter((d) => d.actionId !== ex.id && d.level === p.level);
  if (!others.length) return null;
  const i0 = ex.i, q = poseAtU(ex, u);
  ex.i = i0; // poseAtU advances the segment cursor; restore it
  const mine = [...worldDiscs(p.f, q).map((d) => ({ p: d.p, r: d.d.r })), ...carrierSpots(p.f, q).map((s) => ({ p: s, r: 0.28 }))];
  const hit = others.find((o) => mine.some((m) => hypot(m.p[0] - o.p[0], m.p[1] - o.p[1]) < m.r + o.r + 0.08));
  return hit ? hit.crew[0]! : null;
}

function pathBystander(rt: Runtime, ex: CarryExec, u: number): string | null {
  const p = ex.p;
  const i0 = ex.i;
  const q = poseAtU(ex, u);
  ex.i = i0; // poseAtU advances the segment cursor; restore it
  const discs = worldDiscs(p.f, q);
  const spots = carrierSpots(p.f, q);
  for (const o of Object.values(rt.world.entities)) {
    if (o.kind !== 'human' || p.crew.includes(o.id) || o.human?.level !== p.level) continue;
    const x = o.pose.p[0], z = o.pose.p[2];
    if (discs.some((d) => hypot(d.p[0] - x, d.p[1] - z) < d.d.r + 0.28 + 0.08)) return o.id;
    if (spots.some((s) => hypot(s[0] - x, s[1] - z) < 2 * 0.28 + 0.08)) return o.id;
  }
  return null;
}

/**
 * True when a person standing at `q` is clear of the rest of this carry's route (every load disc and
 * carrier spot from the current pose to the end, +0.15 m), or the carry has stopped moving. A walker
 * blocked in the formation's way steps aside to such a spot and walks on once its goal passes it.
 */
function clearOfRoute(rt: Runtime, ex: CarryExec, q: Vec2): boolean {
  if (!rt.isActive(ex.id) || ex.phase !== 'move') return true;
  const { traj, f } = ex.p;
  const U = traj.u[traj.u.length - 1];
  const i0 = ex.i;
  let clear = true;
  for (let u = ex.u; clear; u = Math.min(U, u + 0.3)) {
    for (const d of worldDiscs(f, poseAtU(ex, u))) if (hypot(d.p[0] - q[0], d.p[1] - q[1]) < d.d.r + 0.28 + 0.15) { clear = false; break; }
    if (u >= U) break;
  }
  ex.i = i0; // poseAtU advances the segment cursor; restore it
  return clear;
}

/** A non-crew person standing within a body width of any station, or inside a laid footprint (+0.4 m). */
export function carryBystanderAt(rt: Runtime, ex: CarryExec, spots: Vec2[], frame: ReturnType<typeof entityFrame> | null): string | null {
  const p = ex.p;
  for (const o of Object.values(rt.world.entities)) {
    if (o.kind !== 'human' || p.crew.includes(o.id) || o.human?.level !== p.level) continue;
    const q: Vec2 = [o.pose.p[0], o.pose.p[2]];
    if (spots.some((s) => hypot(s[0] - q[0], s[1] - q[1]) < 2 * 0.28 + 0.12)) return o.id;
    if (frame) {
      const l = sub2r(q, [frame.q.x, frame.q.z], frame.q.th);
      if (Math.abs(l[0]) < p.f.length / 2 + 0.4 && Math.abs(l[1]) < frame.halfW + 0.4) return o.id;
    }
  }
  return null;
}
const sub2r = (q: Vec2, c: Vec2, th: number): Vec2 => {
  const dx = q[0] - c[0], dz = q[1] - c[1];
  return [dx * dcos(-th) - dz * dsin(-th), dx * dsin(-th) + dz * dcos(-th)];
};

/**
 * Mid-carry replan starts: always the current pose; the heading-flipped pose only when it keeps
 * every carrier within 0.3 m of where they stand (otherwise the crew would teleport — review C1).
 */
function replanStarts(rt: Runtime, ex: CarryExec, here: SE2): SE2[] {
  const flip: SE2 = { ...here, th: wrapAngle(here.th + Math.PI) };
  const spots = carrierSpots(ex.p.f, flip);
  const near = crewOf(rt, ex).every((h, i) => hypot(spots[i][0] - h.pose.p[0], spots[i][1] - h.pose.p[2]) <= 0.3);
  return near ? [here, flip] : [here];
}

function poseAtU(ex: CarryExec, u: number): SE2 {
  const { poses, u: us } = ex.p.traj;
  while (ex.i < us.length - 2 && us[ex.i + 1] <= u) ex.i++;
  const a = poses[ex.i], b = poses[ex.i + 1] ?? a;
  const span = (us[ex.i + 1] ?? us[ex.i]) - us[ex.i];
  const t = span > 1e-12 ? clamp((u - us[ex.i]) / span, 0, 1) : 1;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, th: a.th + (b.th - a.th) * t };
}

function beginTransition(rt: Runtime, ex: CarryExec, phase: 'lift' | 'set-down', to: Pose, toSpots: Vec2[], yaw: number, final: Entity['phase']) {
  const item = itemOf(rt, ex);
  const fromSpots = crewOf(rt, ex).map((h) => [h.pose.p[0], h.pose.p[2]] as Vec2);
  ex.tr = { from: { ...item.pose, p: [...item.pose.p] }, to, fromSpots, toSpots, yaw, final };
  ex.phase = phase;
  ex.t = 0;
  for (const h of crewOf(rt, ex)) h.human!.activity = phase;
}

function stepTransition(rt: Runtime, ex: CarryExec, dt: number, dur: number): boolean {
  const tr = ex.tr!;
  ex.t = Math.min(dur, ex.t + dt);
  const a = smooth(ex.t / dur);
  itemOf(rt, ex).pose = lerpPose(tr.from, tr.to, a);
  crewOf(rt, ex).forEach((h, i) => {
    const s = tr.fromSpots[i], e = tr.toSpots[i];
    h.pose = { p: [s[0] + (e[0] - s[0]) * a, ex.p.levelY, s[1] + (e[1] - s[1]) * a], yaw: wrapAngle(h.pose.yaw + angleDelta(h.pose.yaw, (ex.p.fixture ? carryFacing(ex, tr.yaw, i) : tr.yaw)) * a) };
  });
  return ex.t >= dur - 1e-9;
}

function startSetDown(rt: Runtime, ex: CarryExec, q: SE2) {
  const laid = laidPose(ex.p.f, q, ex.p.levelY);
  const halfW = entityFrame({ ...itemOf(rt, ex), pose: laid }).halfW;
  beginTransition(rt, ex, 'set-down', laid, carrierSpots(ex.p.f, q, halfW), q.th, ex.p.fixture ? ex.p.fixture.restingPhase : 'staged');
}

/** Existing augmented-grid carry recovery, always starts at the current validated formation. */
function retryCarryPeople(rt: Runtime, ex: CarryExec, c: SE2): boolean {
  const p = ex.p, sp = rt.services.spatial as Spatial;
  const others = Object.values(rt.world.entities)
    .filter((o) => o.kind === 'human' && !p.crew.includes(o.id) && o.human?.level === p.level)
    .map((o) => ({ id: o.id, p: [o.pose.p[0], o.pose.p[2]] as Vec2 }));
  const aug = sp.gridsAround(rt.world, others);
  const ga = aug.grids.levels.get(p.level);
  const r = ga ? planCarry({ g: ga, f: p.f, starts: replanStarts(rt, ex, c), goals: [p.target], labelOf: (id) => labelOf(sp, id), carrierNames: p.crew }) : null;
  if (r?.ok) {
    p.traj = r.traj;
    ex.u = 0;
    ex.i = 0;
    ex.replans = (ex.replans ?? 0) + 1;
    applyFormation(rt, ex, r.traj.poses[0]);
    return true;
  }
  return false;
}

export const carry: ActionDef<CarryParams, CarryProgram, CarryExec> = {
  verb: 'carry',
  description:
    'A crew of 1–4 people picks up a component (upright, beam, 2x4, plywood), carries it as one rigid formation along a route validated for load + carriers, and lays it down at (x, z, yaw). Rejected with a diagnostic if the crew is too small or the formation cannot fit.',
  schema: carrySchema,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.item}`, mode: 'exclusive' }],
  plan: planCarryAction,
  start(rt, p, prog, id) {
    rt.services.loadDiscs ??= () => activeLoadDiscs(rt, true);
    const walks = prog.crew.map((actor, i) => {
      const r = prog.gather[i];
      return r ? walkTo.start(rt, { actor, x: prog.approach[i][0], z: prog.approach[i][1] }, r, id) : null;
    });
    for (const c of prog.crew) rt.world.entities[c].human!.task = id;
    rt.world.entities[prog.item].reservedBy = id;
    const ex: CarryExec = { id, p: prog, phase: 'gather', walks, t: 0, u: 0, v: 0, i: 0, q: prog.pickup, cancelling: false, epoch: -1 };
    carryExecsOf(rt).set(id, ex);
    return ex;
  },
  step(rt, ex, dt): StepResult {
    const p = ex.p;
    if (ex.phase === 'gather' && ex.cancelling) {
      // cancelled while a crew member was mid-stair: let their walks finish the flight (review M2)
      for (let i = 0; i < ex.walks.length; i++) {
        const w = ex.walks[i];
        if (!w) continue;
        const r = walkTo.step(rt, w, dt).status;
        if (r === 'completed' || r === 'failed') ex.walks[i] = null;
      }
      if (ex.walks.some((w) => w)) return { status: 'running', phase: 'gather-cancel' };
      for (const h of crewOf(rt, ex)) { h.human!.activity = 'idle'; h.human!.task = undefined; }
      const resting = itemOf(rt, ex);
      if (resting) resting.reservedBy = undefined;
      carryExecsOf(rt).delete(ex.id);
      return { status: 'completed', outputs: { cancelled: true } };
    }
    if (ex.phase === 'gather') {
      ex.t += dt;
      for (let i = 0; i < ex.walks.length; i++) {
        const w = ex.walks[i];
        if (!w) continue;
        const r = walkTo.step(rt, w, dt);
        if (r.status === 'failed') return carryExecsOf(rt).delete(ex.id), { status: 'failed', diagnostic: { ...r.diagnostic, code: 'carry.gather-failed', message: `${p.crew[i]} could not reach the ${p.f.name}: ${r.diagnostic.message}` } };
        if (r.status === 'completed') {
          ex.walks[i] = null;
          const h = rt.world.entities[p.crew[i]].human!;
          h.task = ex.id;
          h.activity = 'idle';
        }
      }
      // arrived carriers turn to face along the load (walk_to's own `face` option is not used: see CARRY.md)
      let aligned = true;
      crewOf(rt, ex).forEach((h, i) => {
        if (ex.walks[i]) return;
        const d = angleDelta(h.pose.yaw, carryFacing(ex, p.pickup.th, i));
        if (Math.abs(d) > 0.02) aligned = false;
        h.pose.yaw = wrapAngle(h.pose.yaw + clamp(d, -TURN_RATE * dt, TURN_RATE * dt));
      });
      if (ex.walks.some((w) => w) || !aligned) {
        if (ex.t > GATHER_TIMEOUT_S) return carryExecsOf(rt).delete(ex.id), { status: 'failed', diagnostic: { code: 'carry.gather-stuck', message: `the crew did not assemble around ${p.item} within ${GATHER_TIMEOUT_S} s`, subjects: [p.item, ...p.crew] } };
        return { status: 'running', phase: 'gather' };
      }
      // nobody may stand where the carriers step to grip the load (idle bystanders are asked to move)
      const inWay = carryBystanderAt(rt, ex, carrierSpots(p.f, p.pickup), null);
      if (inWay) {
        makeWay(rt, inWay, [p.pickup.x, p.pickup.z]);
        return blockedWait(rt, ex.id, p.item, [inWay], { code: 'carry.pickup-occupied', message: `the crew cannot take up ${p.item}: ${inWay} is standing at a grip position`, subjects: [p.item, inWay], at: [p.pickup.x, p.levelY, p.pickup.z] }, p.crew);
      }
      if (p.clearLift) {
        const under = liftBystander(rt, ex);
        if (under) {
          makeWay(rt, under, [p.pickup.x, p.pickup.z]);
          return blockedWait(rt, ex.id, p.item, [under], { code: 'carry.pickup-occupied', message: `the crew cannot lift ${p.item}: ${under} is standing too close to it`, subjects: [p.item, under], at: [p.pickup.x, p.levelY, p.pickup.z] });
        }
      }
      if (itemOf(rt, ex).tags?.includes('entity-world-transport')) {
        if (ex.reachStart === undefined) {
          ex.reachStart = rt.tick;
          crewOf(rt, ex).forEach((h, i) => { h.human!.carryContactV1 = {item:p.item, slot:p.f.carriers[i].slot, startTick:rt.tick}; });
        }
        if ((rt.tick - ex.reachStart) * dt < CARRY_REACH_SECONDS) return {status:'running',phase:'reach'};
      }
      // lift: the load leaves the ground, held by exactly the crew
      const item = itemOf(rt, ex);
      item.phase = 'carried';
      item.support = { kind: 'held', by: [...p.crew] };
      crewOf(rt, ex).forEach((h, i) => (h.human!.grip = { entity: p.item, slot: p.f.carriers[i].slot }));
      beginTransition(rt, ex, 'lift', carriedPose(p.f, p.pickup, p.levelY), carrierSpots(p.f, p.pickup), wrapAngle(p.pickup.th), p.fixture ? p.fixture.restingPhase : 'stored');
      return { status: 'running', phase: 'lift' };
    }
    if (ex.phase === 'lift') {
      if (stepTransition(rt, ex, dt, LIFT_S)) {
        ex.phase = 'move';
        ex.epoch = (rt.services.spatial as Spatial).epoch;
        for (const h of crewOf(rt, ex)) h.human!.activity = 'carry';
        applyFormation(rt, ex, p.traj.poses[0]);
      }
      return { status: 'running', phase: ex.phase };
    }
    if (ex.phase === 'move' && ex.retreatTo !== undefined) {
      const sp = rt.services.spatial as Spatial; sp.sync(rt.world);
      const next = Math.max(ex.retreatTo, ex.u - CARRY_SPEED * dt);
      // the route was clear when it was planned, not necessarily now: what stands behind ends the backing here
      if (next < ex.u && !retreatBlocked(rt, ex, sp, next)) {
        ex.u = next; ex.i = 0; applyFormation(rt, ex, poseAtU(ex, ex.u));
        if (ex.u > ex.retreatTo) return { status: 'running', phase: 'move' };
        // not clear to lay it here: further back, where it was. The route's start is as far as it goes.
        if (ex.u > 0 && laidIssue(sp, p.f, ex.q, p.level, p.levelY, p.item, p.crew)) { ex.retreatTo = Math.max(0, ex.u - RETREAT); return { status: 'running', phase: 'move' }; }
      }
      ex.retreatTo = undefined; startSetDown(rt, ex, ex.q);
      return { status: 'running', phase: 'set-down' };
    }
    if (ex.phase === 'move') {
      // construction changed the scene? the rest of the validated route must still be clear
      const sp = rt.services.spatial as Spatial;
      sp.sync(rt.world);
      if (sp.epoch !== ex.epoch) {
        // PC07 (holdCutV1): the scene has not changed since the last search found no way: still held, without searching
        // again each tick
        if (p.holdCut && ex.cut?.epoch === sp.epoch) return { status: 'blocked', diagnostic: ex.cut.diagnostic };
        if (p.holdCut) ex.cut = undefined;
        const g = sp.level(p.level)!;
        const cutAt = { p: [0, 0] as Vec2 };
        const k = p.traj.poses.findIndex((q, j) => j > ex.i && (p.holdCut ? poseHit(g, p.f, q, 0, cutAt) : poseHit(g, p.f, q, 0)) >= 0);
        if (k >= 0) {
          // replan the rest of the carry from the current formation pose (construction changed the topology)
          const here = poseAtU(ex, ex.u);
          const r = planCarry({ g, f: p.f, starts: replanStarts(rt, ex, here), goals: [p.target], labelOf: (id) => labelOf(sp, id), carrierNames: p.crew, ...(p.holdCut ? { budgetDetail: true } : {}) });
          if (r.ok) {
            p.traj = r.traj;
            ex.u = 0;
            ex.i = 0;
            ex.replans = (ex.replans ?? 0) + 1;
            ex.epoch = sp.epoch;
            applyFormation(rt, ex, r.traj.poses[0]);
            return { status: 'running', phase: 'replan' };
          }
          if (!p.holdCut) {
            const q = p.traj.poses[k];
            return { status: 'blocked', diagnostic: { code: 'carry.route-blocked', message: `the carry route of ${p.item} is now blocked near (${q.x.toFixed(1)}, ${q.z.toFixed(1)}) and no alternative exists: ${r.diagnostic.message}; the crew holds the load and waits`, subjects: [p.item, ...(r.diagnostic.subjects ?? [])], at: [q.x, p.levelY, q.z] } };
          }
          // what cut the route is the obstacle at the first blocked pose (the replan's closest try may stop elsewhere);
          // a replan that stopped at its pose budget did not prove there is no other way
          const q = p.traj.poses[k], cut = nearestBlocker(g, cutAt.p, 1.0), exhausted = r.expanded > PLAN_MAX_EXPAND;
          const label = cut ? sp.scene.obstacles.find((o) => o.id === cut)?.label : undefined;
          const diagnostic: Diagnostic = {
            code: 'carry.route-blocked',
            message: `the carry route of ${p.item} is now blocked near (${q.x.toFixed(1)}, ${q.z.toFixed(1)})${cut ? ` by '${labelOf(sp, cut)}'` : ''} and ${exhausted ? `a search of ${r.expanded} poses found no alternative (not a proof)` : 'no alternative exists'}: ${r.diagnostic.message}; the crew holds the load and waits`,
            subjects: [p.item, ...(cut ? [cut] : []), ...(r.diagnostic.subjects ?? []).filter((s) => s !== cut)],
            at: [q.x, p.levelY, q.z],
            details: { cut: cut ?? null, ...(label ? { cutLabel: label } : {}), expanded: r.expanded, budget: PLAN_MAX_EXPAND, exhausted },
          };
          ex.cut = { epoch: sp.epoch, diagnostic };
          return { status: 'blocked', diagnostic };
        }
        ex.epoch = sp.epoch;
      }
      const U = p.traj.u[p.traj.u.length - 1];
      // people in the formation's way: halt (never push through), ask idle bystanders to step aside; a walker blocked
      // in the way (its goal lies on the route) steps off the rest of the route and waits for the load to pass
      // sample the swept footprint from here to 1.2 m ahead (the first primitive may rotate in place)
      const ahead = [0, 0.3, 0.6, 0.9, 1.2].map((d) => pathBystander(rt, ex, Math.min(U, ex.u + d)) ?? (p.clearLift ? pathOtherLoad(rt, ex, Math.min(U, ex.u + d)) : null)).find((x) => x) ?? null;
      if (ahead) {
        // PC17 (#696): beside another crew, a person can step into the swing faster than the load brakes: it stops where it is
        ex.v = p.clearLift ? 0 : Math.max(0, ex.v - 2 * ACCEL * dt);
        ex.u = Math.min(U, ex.u + ex.v * dt);
        applyFormation(rt, ex, poseAtU(ex, ex.u));
        const c = poseAtU(ex, ex.u);
        makeWay(rt, ahead, [c.x, c.z], { by: `the crew carrying ${p.item}`, subjects: [p.item, ...p.crew], test: (q) => clearOfRoute(rt, ex, q) });
        // waited long enough: the people in the way are not going anywhere (another crew, a
        // boxed-in bystander) → replan the rest of the carry treating them as soft obstacles
        ex.waited = (ex.waited ?? 0) + 1;
        if (ex.waited > 120 && ex.v < 0.02) {
          ex.waited = 0;
          if (retryCarryPeople(rt, ex, c)) return { status: 'running', phase: 'replan' };
        }
        if (ex.v < 0.02) return blockedWait(rt, ex.id, p.item, [ahead], { code: 'carry.path-occupied', message: `the crew carrying ${p.item} waits for ${ahead} to move out of its way`, subjects: [p.item, ahead], at: [c.x, p.levelY, c.z] }, p.crew);
        return { status: 'running', phase: 'move' };
      }
      const vmax = Math.min(CARRY_SPEED, Math.sqrt(2 * ACCEL * Math.max(0, U - ex.u)) + 0.02);
      ex.v = clamp(vmax, ex.v - 2 * ACCEL * dt, ex.v + ACCEL * dt);
      ex.u = Math.min(U, ex.u + ex.v * dt);
      applyFormation(rt, ex, poseAtU(ex, ex.u));
      if (ex.u >= U - 1e-9) {
        applyFormation(rt, ex, p.traj.poses[p.traj.poses.length - 1]);
        if (p.climb && !ex.climbed) {
          // lined up level before the flight: climb with the load (the carrier steps on as walkers do)
          ex.phase = 'climb';
          ex.s = p.climb.s0;
          ex.v = 0;
          return { status: 'running', phase: 'climb' };
        }
        // the set-down stations must be free of other people: idle bystanders are asked to step
        // aside (directed work outranks idling); the crew holds the load meanwhile
        const bystander = carryBystanderAt(rt, ex, p.setdown, entityFrame({ ...itemOf(rt, ex), pose: p.laid }));
        if (bystander) {
          makeWay(rt, bystander, [p.target.x, p.target.z]);
          return blockedWait(rt, ex.id, p.item, [bystander], { code: 'carry.setdown-occupied', message: `the crew holds ${p.item} at its destination: ${bystander} is standing where it must be set down`, subjects: [p.item, bystander], at: [p.target.x, p.levelY, p.target.z] }, p.crew);
        }
        beginTransition(rt, ex, 'set-down', p.laid, p.setdown, wrapAngle(p.target.th), p.fixture ? p.fixture.restingPhase : 'staged');
      }
      return { status: 'running', phase: ex.phase };
    }
    if (ex.phase === 'climb') return stepClimb(rt, ex, dt);
    if (ex.phase === 'set-down') {
      if (stepTransition(rt, ex, dt, SETDOWN_S)) {
        const item = itemOf(rt, ex);
        item.pose = ex.tr!.to;
        item.phase = ex.tr!.final;
        item.support = { kind: 'ground' };
        item.reservedBy = undefined;
        for (const h of crewOf(rt, ex)) { h.human!.grip = undefined; h.human!.activity = 'release'; if(h.human!.carryContactV1) h.human!.carryContactV1!.releaseTick=rt.tick; }
        ex.phase = 'release';
        ex.t = 0;
      }
      return { status: 'running', phase: ex.phase };
    }
    ex.t += dt;
    if (ex.t < (ex.reachStart === undefined ? RELEASE_S : CARRY_RELEASE_SECONDS)) return { status: 'running', phase: 'release' };
    for (const h of crewOf(rt, ex)) { h.human!.activity = 'idle'; h.human!.task = undefined; h.human!.carryContactV1 = undefined; }
    carryExecsOf(rt).delete(ex.id);
    const e = itemOf(rt, ex);
    e.reservedBy = undefined;
    return {
      status: 'completed',
      outputs: {
        replans: ex.replans ?? 0,
        cancelled: ex.cancelling, x: ex.q.x, z: ex.q.z, yaw: e.pose.yaw,
        length: p.traj.length, rotation: p.traj.rotation, reverse: p.traj.reverse, expanded: p.stats.expanded,
        ...(p.climb ? { level: p.level, via: p.climb.link.id } : {}),
      },
    };
  },
  recoverWait(rt, ex, mover) {
    if (ex.phase === 'gather') {
      const index = ex.p.crew.indexOf(mover), walk = index >= 0 ? ex.walks[index] : null;
      if (walk) return walkTo.recoverWait!(rt, walk, mover);
    }
    if (mover !== ex.p.item || ex.phase !== 'move' || ex.v >= 0.02 || ex.onStair || ex.cancelling)
      return { status: 'unavailable', diagnostic: { code: 'deadlock.recovery-unavailable', message: 'carry recovery is unavailable outside a stopped floor formation or gathering walk', subjects: [mover] } };
    if (!takeReplan(rt, false)) return { status: 'deferred', diagnostic: { code: 'deadlock.recovery-budget', message: 'carry recovery waits for existing planner budget', subjects: [mover] } };
    const planned = retryCarryPeople(rt, ex, poseAtU(ex, ex.u));
    return { status: 'attempted', diagnostic: { code: planned ? 'deadlock.replanned' : 'deadlock.replan-refused', message: planned ? 'existing formation planner found a route from the current pose' : 'existing formation planner found no safe route', subjects: [mover] } };
  },
  waitQuiescent(rt, ex, exhausted) {
    if (ex.cancelling) return false;
    if (ex.phase === 'gather') return ex.walks.every((walk, i) => !!walk && exhausted.has(ex.p.crew[i]) && walkTo.waitQuiescent!(rt, walk, exhausted));
    return ex.phase === 'move' && ex.v < 0.02 && !ex.onStair && exhausted.has(ex.p.item);
  },
  /** #1150: the crew's last step was not taken. The route behind it is the way it came, so that is the way out, as far as it is still clear. */
  refused(rt, ex) {
    if (ex.phase !== 'move') return;
    // refused while backing: that step was back, so undo it, and go no further that way
    if (ex.retreatTo !== undefined) { ex.u = Math.min(ex.p.traj.u[ex.p.traj.u.length - 1], ex.u + CARRY_SPEED * DT); ex.i = 0; ex.q = poseAtU(ex, ex.u); ex.retreatTo = ex.u; return; }
    ex.u = Math.max(0, ex.u - ex.v * DT); ex.v = 0; ex.i = 0; ex.q = poseAtU(ex, ex.u);
    ex.retreatTo = Math.max(0, ex.u - RETREAT);
  },
  cancel(rt, ex): CancelResult {
    const p = ex.p;
    if (ex.phase === 'gather' && ex.reachStart !== undefined) {
      for (const h of crewOf(rt, ex)) {
        const contact=h.human!.carryContactV1!;
        h.human!.carryContactV1={...contact,releaseTick:rt.tick,releaseFrom:carryContactWeight(contact,rt.tick,DT)};
        h.human!.activity='release';
      }
      ex.phase='release'; ex.t=0; ex.cancelling=true;
      return {ok:true,deferred:true};
    }
    if (ex.phase === 'gather') {
      // a walker mid-stair finishes the flight at the nearer landing first (walk_to deferred cancel, review M2)
      ex.walks = ex.walks.map((w) => {
        if (!w) return null;
        const r = walkTo.cancel(rt, w);
        return r.ok && r.deferred ? w : null;
      });
      if (ex.walks.some((w) => w)) {
        ex.cancelling = true;
        return { ok: true, deferred: true };
      }
      for (const h of crewOf(rt, ex)) { h.human!.activity = 'idle'; h.human!.task = undefined; }
      const resting = itemOf(rt, ex);
      if (resting) resting.reservedBy = undefined;
      carryExecsOf(rt).delete(ex.id);
      return { ok: true };
    }
    if (ex.phase === 'lift') {
      // lower it back where it lay
      beginTransition(rt, ex, 'set-down', p.lying, p.approach, wrapAngle(p.pickup.th), p.fixture ? p.fixture.restingPhase : 'stored');
      ex.cancelling = true;
      return { ok: true, deferred: true };
    }
    if (ex.phase === 'climb')
      return {
        ok: false,
        diagnostic: {
          code: 'carry.cancel-unsafe',
          message: `cannot set the ${p.f.name} ${p.item} down on ${p.climb!.link.id}: nobody sets a load down on a flight; the carrier keeps climbing — cancel again once it is off the stairs`,
          subjects: [p.item, p.climb!.link.id],
          at: itemOf(rt, ex).pose.p,
        },
      };
    if (ex.phase === 'move') {
      if (ex.retreatTo !== undefined) { ex.cancelling = true; return { ok: true, deferred: true }; }   // #1150: backing off already; it sets down
      const sp = rt.services.spatial as Spatial;
      sp.sync(rt.world);
      const why = laidIssue(sp, p.f, ex.q, p.level, p.levelY, p.item, p.crew);
      if (why)
        return {
          ok: false,
          diagnostic: {
            code: 'carry.cancel-unsafe',
            message: `cannot set the ${p.f.name} ${p.item} down at (${ex.q.x.toFixed(1)}, ${ex.q.z.toFixed(1)}): ${why.reason}; the crew keeps carrying — cancel again where the ground is clear`,
            subjects: [p.item, ...why.subjects],
            at: [ex.q.x, p.levelY, ex.q.z],
          },
        };
      startSetDown(rt, ex, ex.q);
      ex.cancelling = true;
      return { ok: true, deferred: true };
    }
    ex.cancelling = true; // already setting down / releasing
    return { ok: true, deferred: true };
  },
};

/** A non-crew person the next climb step would bring the carrier's body or the load closer to than allowed. */
function climbBlocker(rt: Runtime, ex: CarryExec, next: ClimbPose): string | null {
  const p = ex.p;
  const me = crewOf(rt, ex)[0];
  const body = stairBlocker(rt, me, me.pose.p, next.carrier, 0.28);
  if (body) return body;
  const item = itemOf(rt, ex);
  const nowDiscs = worldDiscs(p.f, entityFrame(item).q).filter((d) => d.d.part === 'load');
  const nextDiscs = worldDiscs(p.f, next.q).filter((d) => d.d.part === 'load');
  const span = entityFootprint({ ...item, pose: next.load });
  for (const o of Object.values(rt.world.entities)) {
    if (o.kind !== 'human' || !o.human || p.crew.includes(o.id)) continue;
    const y = o.pose.p[1];
    if (y > span.y1 + 0.05 || y + 1.8 < span.y0 - 0.05) continue;
    const x = o.pose.p[0], z = o.pose.p[2];
    for (let k = 0; k < nextDiscs.length; k++) {
      const d = nextDiscs[k];
      const dn = hypot(d.p[0] - x, d.p[1] - z);
      if (dn >= d.d.r + 0.28 + 0.05) continue;
      const c = nowDiscs[k];
      if (!c || dn < hypot(c.p[0] - x, c.p[1] - z) - 1e-9) return o.id;
    }
  }
  return null;
}

/** Release the flight's traffic resource (walkers left on it keep a shared, non-exclusive entry). */
function leaveStair(rt: Runtime, ex: CarryExec) {
  if (!ex.onStair) return;
  const res = `link:${ex.p.climb!.link.id}`;
  const t = traffic(rt).get(res);
  t?.actors.delete(ex.p.crew[0]);
  if (t && !t.actors.size) traffic(rt).delete(res);
  else if (t) t.exclusive = false;
  ex.onStair = false;
}

/**
 * The climb (single carrier): advance along the flight at walk_to's climbing speed; the load pose is
 * re-derived from the traversal every tick (tilted along the flight, level on the landings). The flight
 * is held as an exclusive traffic resource (walkers wait at either end); anyone the carrier or the load
 * would walk into makes the carrier wait (`climb-wait`), idle people are asked to step aside.
 */
function stepClimb(rt: Runtime, ex: CarryExec, dt: number): StepResult {
  const p = ex.p, c = p.climb!;
  const h = crewOf(rt, ex)[0];
  const face = wrapAngle(c.face);
  const climbAct = c.ascending ? 'climb-up' : 'climb-down';
  if (!ex.onStair) {
    const sp = rt.services.spatial as Spatial;
    sp.sync(rt.world);
    const live = sp.scene.links.find((l) => l.id === c.link.id);
    if (!live?.usable) {
      h.human!.activity = 'carry';
      return { status: 'blocked', diagnostic: { code: 'route.link-unusable', message: `${p.crew[0]} holds the ${p.f.name} ${p.item} at the ${c.ascending ? 'foot' : 'top'} of ${c.link.id}: it is no longer usable (${live?.reason ?? 'removed'})`, subjects: [p.item, c.link.id] } };
    }
    const res = `link:${c.link.id}`;
    const entry = c.ascending ? c.link.from.p : c.link.to.p;
    const t = traffic(rt).get(res);
    if (t && t.actors.size && hypot(t.entry[0] - entry[0], t.entry[1] - entry[1]) > 0.5) {
      h.human!.activity = 'carry';
      return blockedWait(rt, ex.id, p.item, [...t.actors], { code: 'traffic.yield', message: `${p.crew[0]} carrying ${p.item} waits for ${[...t.actors][0]} to finish using ${c.link.id}`, subjects: [p.crew[0], p.item, c.link.id] }, p.crew);
    }
    if (t) { t.actors.add(p.crew[0]); t.exclusive = true; }
    else traffic(rt).set(res, { actors: new Set([p.crew[0]]), entry, dir: rot2([1, 0], face), exclusive: true });
    ex.onStair = true;
  }
  const s = Math.min(c.s1, ex.s! + CARRY_CLIMB_SPEED * dt);
  const next = climbPose(p.f, c, s);
  const who = climbBlocker(rt, ex, next);
  if (who) {
    h.human!.activity = 'climb-wait';
    const end = climbPose(p.f, c, c.s1).carrier;
    makeWay(rt, who, [end[0], end[2]]);
    return blockedWait(rt, ex.id, p.item, [who], { code: 'traffic.person', message: `${p.crew[0]} carrying ${p.item} waits on ${c.link.id} for ${who} to move`, subjects: [p.crew[0], who, p.item, c.link.id], at: next.carrier }, p.crew);
  }
  ex.s = s;
  itemOf(rt, ex).pose = next.load;
  h.pose = { p: next.carrier, yaw: face };
  h.human!.activity = climbAct;
  ex.q = next.q;
  if (s + c.along >= c.sExit - 1e-9) h.human!.level = c.toLevel;
  if (s < c.s1 - 1e-9) return { status: 'running', phase: 'climb' };
  // off the flight, level on the exit landing: continue as an ordinary formation on the exit level
  leaveStair(rt, ex);
  h.human!.level = c.toLevel;
  p.traj = c.deck;
  p.level = c.toLevel;
  p.levelY = c.toY;
  ex.u = 0;
  ex.i = 0;
  ex.v = 0;
  ex.climbed = true;
  ex.phase = 'move';
  ex.epoch = -1; // re-check the exit-level leg against the current scene on the next tick
  h.human!.activity = 'carry';
  applyFormation(rt, ex, p.traj.poses[0]);
  return { status: 'running', phase: 'move' };
}
