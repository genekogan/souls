// End-of-tick invariants (spec §31). They never correct anything — they
// record violations so rehearsal reports and tests can fail loudly.
import {isFloater,floaterBody} from '../bodies/body.ts';
import {humanRadius} from '../bodies/humanoid.ts';
import type { Diagnostic } from '../actions/types.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { DT, type Invariant, type Runtime } from './runtime.ts';
import { def } from '../world/catalog.ts';
import { angleDelta, rot2, sub2, type OBB2, type Vec2, type Vec3, hypot } from '../core/math.ts';
import { isCarryLoad } from '../carry/formation.ts';
import type { WorldState } from '../world/types.ts';
import { CLIMB_SPEED, WALK_MIN, WALK_SPEED_CAP, JOG_SPEED_CAP, RUN_SPEED_CAP, CYCLE_SPEED_CAP } from '../locomotion/walk.ts';
import { sleepSafetyIssue } from '../activities/sleep.ts';
import { relevantEntities } from '../world/relevant.ts';

const TOL = 0.03;
const isHumanBody = (e: import('../world/types.ts').Entity) => e.kind === 'human' && !!e.human;
/**
 * Activities exempt from `collision.human-static` besides climb-*: a person sitting on a seat
 * fixture (engine/social) is inside that chair/bench's footprint by design, and moves between the
 * seat's approach point and the seat during the 0.6 s sit-down / stand-up transitions. `eat` / `serve`
 * (engine/items) are overlays a seated person runs without leaving the seat (they never move the body).
 */
/** activities/1 overlays (social/pose.ts) that may sit on a held seat; eat/drink only with a pose prop (native items keep their own rule). */
const POSE_OVERLAY_SET: ReadonlySet<string> = new Set(['read', 'browse', 'write', 'play-piano', 'play-music', 'paint', 'cook', 'play-game', 'craft', 'post-letter', 'wave',
  'bow', 'clap', 'nod', 'shake-head', 'point', 'cheer', 'give', 'take', 'pick-up', 'put-down',
  // E-life: the CN5/leisure overlays done on a held seat on god worlds (an audience bench, a desk chair, a swing's seat)
  'use-computer', 'sing', 'listen', 'lift-weights', 'swing', 'seesaw', 'picnic', 'tell-story']);
export const SEATED_ACTIVITIES: ReadonlySet<string> = new Set(['sit', 'sit-down', 'stand-up', 'eat', 'serve']);

/** beds/1: a body lying on a bed's berth, while its own active take_slot holds that berth (social/actions.ts). */
const onOwnBerth = (rt: Runtime, e: import('../world/types.ts').Entity) => !!e.human?.berth && !!e.human.task && rt.holder(`slot:${e.human.berth}`).includes(e.human.task);
export function humanStaticClearanceWithOverlay(qualified:(rt:Runtime,e:import('../world/types.ts').Entity)=>boolean):Invariant {return (rt: Runtime) => {
  // S1 V7a: no body to check → no spatial sync (a 4,900-entity rescan every tick in an empty world); every planner
  // read syncs lazily on its own, and the first tick with a body syncs here again before reading the grids
  // S1 r2: bodies only (world/relevant.ts: a body is relevant)
  const list = relevantEntities(rt.world);
  if (!list.some(isHumanBody)) return [];
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const out: Diagnostic[] = [];
  for (const e of list) {
    // people on the rack structure (`human.on`: a frame climb or beam walkway) are checked by construction/frame.ts frameAccessOk
    // activities/1 overlays on a seat (read, play-piano…) keep the seated exemption (baseActivity 'sit'; social/pose.ts)
    if (e.kind !== 'human' || !e.human || e.human.on || e.human.carrier || e.human.activity.startsWith('climb') || SEATED_ACTIVITIES.has(e.human.activity) || onOwnBerth(rt, e) || (e.human.baseActivity === 'sit' && (POSE_OVERLAY_SET.has(e.human.activity) || (!!e.human.prop && (e.human.activity === 'eat' || e.human.activity === 'drink')))) || qualified(rt,e)) continue;
    const g = sp.levelAt(e.human.level, [e.pose.p[0], e.pose.p[2]]);
    if (!g) continue;
    const c = clearanceAt(g, [e.pose.p[0], e.pose.p[2]]);
    const radius=isFloater(e)?floaterBody(e.body).radius:humanRadius(e);
    if (c < radius - TOL)
      out.push({
        code: 'collision.human-static',
        message: `${e.id} body overlaps static geometry (clearance ${c.toFixed(2)} m < ${radius} m) near ${nearestBlocker(g, [e.pose.p[0], e.pose.p[2]]) ?? 'the floor edge'} at (${e.pose.p[0].toFixed(2)}, ${e.pose.p[2].toFixed(2)}) level ${e.human.level} activity ${e.human.activity}`,
        subjects: [e.id],
        at: e.pose.p,
      });
  }
  return out;
};}
export const humanStaticClearance:Invariant=humanStaticClearanceWithOverlay(()=>false);

export const humanHumanSeparation: Invariant = (rt: Runtime) => {
  const hs = relevantEntities(rt.world).filter((e) => e.kind === 'human' && e.human);   // bodies only
  const out: Diagnostic[] = [];
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j];
      if (a.human!.level !== b.human!.level) continue;
      if (Math.abs(a.pose.p[1] - b.pose.p[1]) > 1.0) continue;
      const d = hypot(a.pose.p[0] - b.pose.p[0], a.pose.p[2] - b.pose.p[2]);
      const radius=(isFloater(a)?floaterBody(a.body).radius:humanRadius(a))+(isFloater(b)?floaterBody(b.body).radius:humanRadius(b));
      if (d < radius - 0.08)
        out.push({ code: 'collision.human-human', message: `${a.id} and ${b.id} overlap (${d.toFixed(2)} m apart)`, subjects: [a.id, b.id], at: a.pose.p });
    }
  return out;
};

/** Full lie/rise footprint, ordinary-ground support and active actor/mat ownership. */
export const supportedSleepSafety: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  for (const e of relevantEntities(rt.world)) {   // bodies only
    if (!e.human?.sleepPose) continue;
    const issue = sleepSafetyIssue(rt, e);
    if (issue) out.push(issue);
  }
  return out;
};

export const noUnsupported: Invariant = (rt: Runtime) =>
  relevantEntities(rt.world)   // components only
    .filter((e) => e.kind === 'component' && e.support?.kind === 'none')
    .map((e) => ({ code: 'support.unsupported', message: `${e.id} (${e.def}) has no support`, subjects: [e.id], at: e.pose.p }));

export const MAX_STEP_PER_TICK = 0.6; // m: carried components (farthest point, rotation included) and vehicle riders
/**
 * m per tick for a person on foot (3 m/s): twice the fastest walk (WALK_SPEED_CAP 1.4 m/s = 0.07 m/tick),
 * above every carry / climb / sit / stance transition measured (≤ 0.121 m/tick, a frame climb), far below
 * the 0.2–0.55 m jumps walk_to used to make (MOVEMENT.md "No jumps"). A rider (`human.riding`) moves with
 * its vehicle and keeps MAX_STEP_PER_TICK (vehicles: engine/vehicles, EUC ≤ 5 m/s = 0.25 m/tick).
 */
export const MAX_HUMAN_STEP_PER_TICK = 0.15;

/** Poses at the end of the previous tick, per runtime (only compared across consecutive ticks of the same world object). */
const lastPoses = new WeakMap<Runtime, { tick: number; world: WorldState; poses: Map<string, { p: Vec3; yaw: number; ext: number }> }>();

/** A deliberate logged relocation (edge reclaim) is not a teleport fault: forget that body's previous pose. */
export function acknowledgeRelocation(rt: Runtime, id: string): void { lastPoses.get(rt)?.poses.delete(id); }

/** #1150: a restored runtime starts with no previous poses, so its first tick could not see a jump a live one refuses.
 *  Call once after a restore, where a move's refusal must replay. Reads the world only. */
export function rememberPosesAfterRestore(rt: Runtime): void { maxStepPerTick(rt); }

/**
 * No person or carried component moves more than MAX_STEP_PER_TICK in one tick (review C1): catches
 * every teleport class (formation flips, snaps, lerps with a wrong origin). For carried components the
 * rotational displacement of the farthest point (|Δyaw| × half the largest extent) counts too.
 */
export const maxStepPerTick: Invariant = (rt: Runtime) => {
  const prev = lastPoses.get(rt);
  const valid = !!prev && prev.world === rt.world && prev.tick === rt.tick - 1;
  const poses = new Map<string, { p: Vec3; yaw: number; ext: number }>();
  const out: Diagnostic[] = [];
  for (const e of relevantEntities(rt.world)) {   // bodies and carried loads (a phase) only
    const human = e.kind === 'human' && !!e.human;
    if (!human && !isCarryLoad(e)) continue;
    const ext = human ? 0 : Math.max(...def(e.def).size) / 2;
    const cur = { p: [e.pose.p[0], e.pose.p[1], e.pose.p[2]] as Vec3, yaw: e.pose.yaw, ext };
    poses.set(e.id, cur);
    const q = valid ? prev!.poses.get(e.id) : undefined;
    if (!q) continue;
    const lin = hypot(cur.p[0] - q.p[0], cur.p[1] - q.p[1], cur.p[2] - q.p[2]);
    const d = lin + Math.abs(angleDelta(q.yaw, cur.yaw)) * ext;
    // Explicit faster gaits retain a bounded displacement, including a supported
    // terrain slope. Ordinary walkers keep the original stricter 0.15 m bound.
    const gaitMax = e.human?.activity === 'cycle' ? CYCLE_SPEED_CAP * DT * 1.25 : e.human?.activity === 'run' ? RUN_SPEED_CAP * DT * 1.25 : e.human?.activity === 'jog' ? JOG_SPEED_CAP * DT * 1.25 : 0;
    const max = human && !e.human!.riding && !e.human!.carrier ? Math.max(MAX_HUMAN_STEP_PER_TICK, gaitMax) : MAX_STEP_PER_TICK;   // a carried body (vehicles/carrier.ts) moves with its carrier
    if (d > max)
      out.push({
        code: 'motion.teleport',
        message: `${e.id} moved ${d.toFixed(2)} m in one tick (max ${max} m${human ? `, activity ${e.human!.activity}` : ''}) from (${q.p[0].toFixed(2)}, ${q.p[2].toFixed(2)}) to (${cur.p[0].toFixed(2)}, ${cur.p[2].toFixed(2)})`,
        subjects: [e.id],
        at: cur.p,
      });
  }
  lastPoses.set(rt, { tick: rt.tick, world: rt.world, poses });
  return out;
};

/**
 * Published ground speed (`human.speed`, m/s over the last tick; walk_to publishes it every tick it owns
 * the person) per activity: a person shown walking is at most WALK_SPEED_CAP, one on a flight at most
 * CLIMB_SPEED, one waiting / idle / standing on a flight under WALK_MIN (below it the body is not shown
 * walking). An activity with a published speed and no cap here is a violation too (fail loudly).
 */
export const SPEED_CAPS: Readonly<Record<string, number>> = {
  walk: WALK_SPEED_CAP,
  jog: JOG_SPEED_CAP,
  run: RUN_SPEED_CAP,
  cycle: CYCLE_SPEED_CAP,
  'climb-up': CLIMB_SPEED,
  'climb-down': CLIMB_SPEED,
  'climb-wait': WALK_MIN,
  idle: WALK_MIN,
  wait: WALK_MIN,
};
const OVERSPEED_TOL = 1.05;

/** No person's published speed exceeds its activity's cap + 5 % (MOVEMENT.md "No jumps"). */
export const speedWithinCap: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  for (const e of relevantEntities(rt.world)) {   // bodies only
    const sp = e.human?.speed;
    // #1086: a published zero is no movement (a relocated body that then reaches published 0 in `reach` and faulted); the
    // ground bridge's cap (engine-mars ground-bridge.ts) already skips it
    if (sp === undefined || sp === 0) continue;
    const cap = SPEED_CAPS[e.human!.activity];
    if (cap !== undefined && sp <= cap * OVERSPEED_TOL) continue;
    out.push({
      code: 'motion.overspeed',
      message:
        cap === undefined
          ? `${e.id} publishes a ground speed of ${sp} m/s in activity ${e.human!.activity}, which has no speed cap`
          : `${e.id} moved at ${sp} m/s over the last tick in activity ${e.human!.activity} (cap ${cap} m/s + 5 %)`,
      subjects: [e.id],
      at: e.pose.p,
    });
  }
  return out;
};

export const HOLD_REACH = 1.2; // m from the held entity's footprint

const distToObb = (p: Vec2, o: OBB2) => {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return hypot(Math.max(Math.abs(l[0]) - o.half[0], 0), Math.max(Math.abs(l[1]) - o.half[1], 0));
};

/**
 * Every entity with support { kind: 'held', by } is actually held (review C2): each holder exists,
 * grips exactly that entity, and (outside lift / set-down transitions) stands within HOLD_REACH of
 * its footprint.
 */
export const holdersPresent: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  for (const e of relevantEntities(rt.world)) {   // held things only
    if (e.support?.kind !== 'held') continue;
    let obb: OBB2 | null = null;
    for (const id of e.support.by) {
      const h = ents[id];
      const grip = h?.human?.grip?.entity;
      let why = '';
      if (!h?.human) why = `holder ${id} is not a person in this world`;
      else if (grip !== e.id) why = `${id} is not gripping it (grip ${grip ?? 'none'})`;
      else if (h.human.activity !== 'lift' && h.human.activity !== 'set-down') {
        // (during a lift / set-down transition the part follows a scripted path from its staging
        // spot to its seat and the crew walks with it, each holder beside its grip slot; reach
        // during a lift is checked against the hand points by construction's liftHandsInReach)
        obb ??= entityFootprint(e).obb;
        const d = distToObb([h.pose.p[0], h.pose.p[2]], obb);
        if (d > HOLD_REACH) why = `${id} stands ${d.toFixed(2)} m from it (reach ${HOLD_REACH} m)`;
      }
      if (why)
        out.push({ code: 'support.holder-missing', message: `${e.id} is marked held by [${e.support.by.join(', ')}] but ${why}`, subjects: [e.id, id], at: e.pose.p });
    }
  }
  return out;
};

/** Scenario set-up moved entities by hand (not through an action): don't compare motion across this tick. */
export function forgetMotion(rt: Runtime) {
  lastPoses.delete(rt);
}

export const DEFAULT_INVARIANTS = [humanStaticClearance, humanHumanSeparation, supportedSleepSafety, noUnsupported, maxStepPerTick, speedWithinCap, holdersPresent];
