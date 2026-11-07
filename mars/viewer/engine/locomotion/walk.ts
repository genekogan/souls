import {bodyProfile,bodySpatial} from '../bodies/navigation.ts';
// walk_to: global route (spatial/path.ts) → corridor following → contextual
// stair traversal. Layers are separate as in Unity/Detour practice:
//   planning  : route legs with guaranteed clearance (replanned only on topology change)
//   smoothing : each walk leg's polyline becomes straight runs + circular fillets inside the
//               corridor clearance (locomotion/spline.ts), with a speed cap per vertex
//   steering  : arc-length progress along the smoothed corridor, curvature + look-ahead speed caps,
//               heading follows the path (turn in place only beyond 120°), lateral right-hand
//               passing offset bounded by local clearance
//   reaction  : a 1.5 s look-ahead stops short of standing people, carried loads and geometry; a
//               block is decided within 0.5 s (wait with a named reason, or replan around)
//               (docs/engineering/MOVEMENT.md)
//   traffic   : single-file passages are exclusive resources per direction (yield, never oscillate)
//   animation : consumers read pose + human.activity; they never write positions
import { blockedWait, publishedWaitsFor } from '../runtime/waits.ts';
import { z } from 'zod';
import { pointInObb, add2, angleDelta, clamp, cross2, dist2, dot2, heading, len2, norm2, rot2, scale2, sub2, wrapAngle, type OBB2, type Vec2, hypot } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { entityFootprint, narrowIdOf, type AroundPerson } from '../spatial/service.ts';
import { cellOf, clearanceAt, nearestBlocker, segmentClearance, type LevelGrid } from '../spatial/grid.ts';
import { PLAN_MARGIN, type Leg, type LinkLeg, type Route, type WalkLeg } from '../spatial/path.ts';
import { smoothPolyline, type PathSeg } from './spline.ts';
import { type AgentProfile, MAX_LEVEL_ID } from '../spatial/types.ts';
import { gapToSleep, SLEEP_BODY_MARGIN } from '../activities/sleep.ts';
import { G_WADE } from '../spatial/ground.ts';
import { followHand, handPartnerOf } from '../social/hand-hold.ts';

const ACCEL = 1.2; // m/s²
const BRAKE = 2 * ACCEL; // m/s² ordinary deceleration
/** m/s along the stair path (the horizontal ground speed on a flight is at most this). */
export const CLIMB_SPEED = 0.45;
/**
 * The fastest ordinary walk (m/s): without an explicit faster gait, `walk_to`'s `speed` may not exceed
 * it. Every gait keeps one speed × DT budget in each tick: lateral sidesteps, offsets swept
 * round a bend and pulling back into line all come out of that one per-tick budget, never on top of it.
 */
export const WALK_SPEED_CAP = 1.4;
/** Explicit, stamina-free faster gaits. Legacy steps keep the walking cap. */
export const JOG_SPEED_CAP = 2.5;
export const RUN_SPEED_CAP = 4;
/** todo (leisure): riding a bicycle taken from a dock, on the same dry routes as a jog. */
export const CYCLE_SPEED_CAP = 4.5;
export const GAIT_SPEED_CAPS = { walk: WALK_SPEED_CAP, jog: JOG_SPEED_CAP, run: RUN_SPEED_CAP, cycle: CYCLE_SPEED_CAP } as const;
export type Gait = keyof typeof GAIT_SPEED_CAPS;
/** Heading error (rad) at and above which the walker cannot walk off: it turns in place (120°). */
export const TURN_IN_PLACE = 2.1;
const HEAD_FULL = 0.35; // rad heading error up to which full speed is allowed; linear down to 0 at TURN_IN_PLACE
const FACE_LOOK = 0.3; // m: heading aims along the chord to the path point this far ahead
/** Ground speed (m/s) below which a walker is not shown walking: activity 'walk' needs ≥ WALK_MIN. */
export const WALK_MIN = 0.08;
const LOOK_TIME = 1.5; // s of look-ahead along the corridor for standing people, loads, geometry
const STATIC_TOL = 0.03; // m: the static-clearance invariant's tolerance (runtime/invariants.ts)
const STOP_GAP = 0.02; // m kept before the exact contact point of a hazard when stopping for it
const VEHICLE_GAP = 1.5; // m body gap to a vehicle being driven within which a walker slows (look-ahead included)
const VEHICLE_WALK = 0.5; // m/s walking speed near a vehicle that is being driven
/** Ticks (0.5 s) after which a walker still blocked by something that has not moved replans around it. */
export const DECIDE_TICKS = 10;
const PASS_OFFSET = 0.45; // m lateral offset when passing another walker
const PASS_SPEED = 0.7; // m/s cap while two walkers pass head-on with room for both (never a stop)
const STATIC_OFFSET = 0.8; // m sidestep around a standing person
const STUCK_TICKS = 80; // 4 s blocked by a person / load that keeps moving → replan around them anyway
const MAX_PEOPLE_REPLANS = 6; // after this, stay blocked (fail loudly via diagnostics) rather than churn grids
/**
 * A blocked stretch ends only once the walker is really under way again: faster than CREEP_SPEED or
 * BLOCK_PROGRESS further along the corridor. Creeping a few millimetres per tick round a blocker at the
 * separation limit (stopped, 0.06 m/s, stopped …) is still the same block, so its decision clock runs on.
 */
const CREEP_SPEED = 0.15; // m/s
/**
 * A standing person as a planning obstacle in the squeezed people-replan: an octagon of this inradius
 * (m) instead of the usual 0.3 m half-width square. With the conservative 0.1 m raster, cells are
 * plannable from 0.60–0.875 m of a person's centre for the square and 0.61–0.78 m for this octagon
 * (measured over directions and sub-cell offsets): never inside the 0.54 m separation, but a diagonal gap
 * between two people needs ≈ 1.56 m instead of 1.75 m. (0.20 would open 1.2 m gaps but plans corridors
 * down to 0.46 m from a centre, where the look-ahead stops the walker again.)
 */
const SQUEEZE_HALF = 0.22;
const BLOCK_PROGRESS = 0.2; // m
/** Construction replans per tick before walkers with a still-clear current segment wait their turn. */
export const REPLANS_PER_TICK = 4;
const REPLAN_MAX_WAIT = 10; // ticks a deferred walker may follow its old corridor before replanning regardless
const YIELD_OFFSET = 0.9; // m lateral offset while waiting for oncoming traffic
const LOOK = 2.5; // m look-ahead for conflicts
const ENC_STEP = 0.1; // m between samples of the path ahead that encounters are measured against
const ENC_TIME = 1.0; // s: another walker's heading is the chord of its own smoothed path over this much of its walking

export type WalkParams = { actor: string; x: number; z: number; level?: number; face?: number; speed?: number; gait?: Gait;arrivalEvidence?:'navigation-arrival/1' };

type Seg = PathSeg;
type Narrow = { res: string; s0: number; s1: number; entry: Vec2; dir: Vec2 };
type Exec = {
  id: string;
  actor: string;
  arrivalEvidence?:'navigation-arrival/1';
  goal: { level: number; p: Vec2 };
  face?: number;
  speed: number;
  gait?: 'jog' | 'run' | 'cycle';
  profile: AgentProfile;
  route: Route;
  leg: number;
  segs: Seg[];
  total: number;
  s: number;
  v: number;
  offset: number;
  narrows: Narrow[];
  held: Set<string>;
  climbT: number;
  epoch: number;
  replans: number;
  phase: string;
  side: number;
  /** The standing person the static sidestep (`side`) is for: latched until they are behind the walker. */
  sideFor?: string;
  /** The lateral offset chosen for that sidestep, and the person it was computed for. */
  sideTarget?: number;
  sideAt?: string;
  stuck: number;
  turning: boolean;
  /** What blocks this walker now, and where every blocker of this blocked stretch stood when last seen moving. */
  block?: { id: string; at: Record<string, Vec2>; s0: number; leg: number };
  /** Consecutive blocked ticks during which none of those blockers moved 0.1 m (DECIDE_TICKS). */
  still?: number;
  /** Ticks on which the hard separation layer (intrusion / loadIntrusion) had to cancel a step. */
  pushes: number;
  /** Navigation epoch the current smoothed segments were last verified against (geometry look-ahead runs only when stale). */
  segEpoch?: number;
  /** Standing people the current route was planned around (ignored by local encounters while they stay put). */
  plannedAround: Record<string, Vec2>;
  /** The temporary obstacles the current route was planned with (routeAround); its legs are smoothed on those grids. */
  around?: AroundPerson[];
  peopleReplans: number;
  /** occupied-link-routing/1: stable far-landing obstruction, observed only
   * while still supported at the flight entry. Plain state survives snapshots. */
  linkWait?: { link: string; blocker: string; at: Vec2; still: number; lastTry: number };
  /** concurrent-link-egress/1: at most one courtesy search per unchanged
   * climber/blocker/geometry episode. Never replan the between-floor body. */
  linkYield?: {link:string;blocker:string;epoch:number;at:number[];other:number[];nearby:Record<string,number[]>};
  /**
   * Head-on encounter decision, latched for the whole encounter (hysteresis): `room` = both walkers'
   * passing spots have clearance, so both keep walking at PASS_SPEED on PASS_OFFSET (side +1 = right)
   * instead of the later id stopping to give way. Cleared once that person is no longer a head-on walker ahead.
   */
  pass?: { id: string; side: 1 | -1; room: boolean };
  /** Ticks this walker has deferred a construction replan (planning budget); undefined = none pending. */
  replanWait?: number;
  /** Set by a cancel during a stair traversal: finish the flight at the nearer landing, then stop (review M2). */
  cancelTo?: 'entry' | 'exit';
  /**
   * Stepping aside for a directed task this blocked walker stands in the way of (a carry formation,
   * `makeWay` with `clearOf`): walk to `spot`, wait there until `clearOf(goal)` holds (the formation no
   * longer needs the goal), then replan to the goal.
   */
  detour?: { spot: Vec2; level: number; by: string; blockers?: string[]; clearOf?: (q: Vec2) => boolean; landing?: {y:number;radius:number}; stage: 'pending' | 'going' | 'waiting'; faceoff?: boolean;
    /** A validated short courtesy route; avoids repeating its budgeted search. */
    planned?:{epoch:number;route:Route;around:AroundPerson[]};egress?:true};
  /** Entity worlds: the walker this one has stood face to face with (each blocked by the other) since `since`, as of `tick`. */
  faceoff?: { id: string; since: number; tick: number };
  /** BS3 watchdog: where (and on which level) the walk last made progress, its own ticks since, and whether it replanned. */
  watch?: { at: Vec2; level: number; n: number; replanned: boolean };
};

const walkSchemaWithin = (reach: number) => z.strictObject({
  arrivalEvidence:z.literal('navigation-arrival/1').optional(),
  actor: z.string().max(80),
  x: z.number().min(-reach).max(reach),
  z: z.number().min(-reach).max(reach),
  level: z.number().int().min(0).max(MAX_LEVEL_ID).optional(),
  face: z.number().min(-7).max(7).optional(),
  speed: z.number().min(0.3).max(CYCLE_SPEED_CAP).optional(),
  gait: z.enum(['walk', 'jog', 'run', 'cycle']).optional(),
}).refine(p => p.speed === undefined || p.speed <= GAIT_SPEED_CAPS[p.gait ?? 'walk'], { message: 'speed exceeds the selected gait cap', path: ['speed'] });
const walkSchema500 = walkSchemaWithin(500);
let walkSchemaWide: typeof walkSchema500 | null = null;
/** GOD-ENV: a god's (entity) world can grow past ±500 m ("extend the world east"); its server widens the reach of
 *  walk_to to the world's bounds. Worlds that never call this (the old worlds) parse with the same ±500 schema as before. */
export function setWalkReach(metres: number) { walkSchemaWide = metres > 500 ? walkSchemaWithin(Math.min(16000, metres)) : null; }
/** The walk_to schema now (lane NAV: read on every use — a `z.lazy` memoises its first schema, so a world widened after the
 *  process's first walk kept ±500 m). */
export const walkSchemaNow = () => walkSchemaWide ?? walkSchema500;

const spatial = bodySpatial;

/**
 * What a `walk_to` step reads about everyone else, read once per step (PLANNING_BUDGET.md §6):
 * - the world's entities in world order: the people scans (encounter, look-ahead, intrusion, vehicles,
 *   stairs) ran `Object.values` 4–6× per walker per tick, and `world.entities` is a V8 dictionary-mode
 *   object, where each call sorts and copies (~2 µs for 30; `entityList` ~0.5 µs);
 * - the carried-load discs (`services.loadDiscs`, rebuilt from every carried component on each call),
 *   on first use.
 * A walker's step never adds, removes or replaces an entity (it moves its own pose, read live through
 * these same objects), and never moves a load or changes a carry, so each snapshot is exactly what
 * every read in the step would return. Outside a step: fresh reads.
 */
let stepScope: { entities: Entity[]; discs?: LoadDiscView[] } | null = null;
/** Pure-performance switches (PLANNING_BUDGET.md §6). Each leaves every result bit-identical; tests turn them off to prove it. */
export const WALK_PERF = { stepSnapshot: true, lazyLinkDiagnostics: true };
/** Entry 35: while a walker steps, the body it walks hand in hand with is beside it by design, not in its way. */
let handPartner: string | null = null;
const entitiesOf = (rt: Runtime): Entity[] => stepScope?.entities ?? (handPartner ? entityList(rt).filter((e) => e.id !== handPartner) : entityList(rt));
/** `Object.values(world.entities)`, same order (both follow OrdinaryOwnPropertyKeys), ~4× cheaper on a dictionary-mode map. */
function entityList(rt: Runtime): Entity[] {
  const ents = rt.world.entities;
  const ids = Object.keys(ents);
  const out = Array.from<Entity>({ length: ids.length });
  for (let i = 0; i < ids.length; i++) out[i] = ents[ids[i]];
  return out;
}
/** Where the current route leads: the goal, or the step-aside spot while walking to it. */
const targetOf = (ex: Exec) => (ex.detour?.stage === 'going' ? { level: ex.detour.level, p: ex.detour.spot } : ex.goal);
/** Live walk_to execs by action id (so `makeWay` can ask a blocked walker to step aside). */
const walkExecs = (rt: Runtime): Map<string, Exec> => (rt.services.walkExecs ??= new Map());
/** W47: the last single-file yield of each walker (actor → whom it waited for, at which tick, since when); plain data. */
const yieldsOf = (rt: Runtime): Record<string, { to: string; tick: number; since: number }> => (rt.services.walkYields ??= {});
/** W47: ticks a mutual single-file wait must last before the waiter holding the passage lets it go (3 s). */
const RELEASE_AFTER = 60;
/** Traffic resources. `exclusive` (a carrier with a load on a flight): nobody else may enter, whatever their direction. */
export const traffic = (rt: Runtime): Map<string, { actors: Set<string>; entry: Vec2; dir: Vec2; exclusive?: boolean }> =>
  (rt.services.traffic ??= new Map());

function actorOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return { code: 'entity.unknown', message: `no actor "${id}"`, subjects: [id] };
  if (e.kind !== 'human' || !e.human) return { code: 'actor.not-human', message: `"${id}" is a ${e.kind}, not a person`, subjects: [id] };
  return e;
}

export function planWalk(rt: Runtime, actor: Entity, goal: { level: number; p: Vec2 }, profile = bodyProfile(actor)) {
  return spatial(rt,actor.id).route(rt.world, profile, { level: actor.human!.level, p: [actor.pose.p[0], actor.pose.p[2]] }, goal, actor.body?.family==='floater'?{planner:'corridor'}:undefined);
}

export const walkTo: ActionDef<WalkParams, Route, Exec> = {
  verb: 'walk_to',
  // a walk moves its own body (and asks others to make way through their own actions); a holding walker fails at once
  navPure: true,
  description:
    'Walk a person to (x, z) on a level (default: current level) along a planned corridor route, using completed stairs between levels. Fails with a diagnostic if no route exists.',
  get schema() { return walkSchemaNow(); },
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = actorOf(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    if (p.gait && p.gait !== 'walk' && a.body?.family === 'floater')
      return { ok: false, diagnostic: { code: 'gait.unsupported-body', message: 'Jogging and running require a humanoid body; this body can glide instead.', subjects: [p.actor] } };
    if (a.human!.grip)
      return { ok: false, diagnostic: { code: 'actor.holding', message: `${p.actor} is holding ${a.human!.grip.entity} and cannot walk away until it is set down or stable`, subjects: [p.actor, a.human!.grip.entity] } };
    const sleeper = occupant(rt, a, [p.x, p.z], bodyProfile(a).radius, true, p.level ?? a.human!.level);
    if (sleeper) return { ok: false, diagnostic: { code: 'walk.goal-occupied', message: `${p.actor}'s destination overlaps ${sleeper}'s supported sleep space`, subjects: [p.actor, sleeper] } };
    const r = planWalk(rt, a, { level: p.level ?? a.human!.level, p: [p.x, p.z] });
    if (!r.ok) return { ok: false, diagnostic: { ...r.diagnostic, subjects: [p.actor, ...(r.diagnostic.subjects ?? [])] } };
    // Faster gaits are dry-ground activities. Never relabel wading as running.
    const ground = spatial(rt, p.actor).ground;
    if (ground && p.gait && p.gait !== 'walk') for (const leg of r.route.legs) if (leg.kind === 'walk' && leg.level === 0) {
      for (let i = 1; i < leg.points.length; i++) {
        const from = leg.points[i - 1], to = leg.points[i], n = Math.max(1, Math.ceil(dist2(from, to) / 0.1));
        for (let j = 0; j <= n; j++) if (ground.field.medium(from[0] + (to[0] - from[0]) * j / n, from[1] + (to[1] - from[1]) * j / n) === G_WADE)
          return { ok: false, diagnostic: { code: 'gait.dry-ground-required', message: 'Jogging and running need a dry route; walk or swim through the water first.', subjects: [p.actor] } };
      }
    }
    return { ok: true, program: r.route };
  },
  start(rt, p, route, id) {
    const a = rt.world.entities[p.actor];
    a.human!.task = id;
    const ex: Exec = {
      id, actor: p.actor, ...(p.arrivalEvidence?{arrivalEvidence:p.arrivalEvidence}:{}), goal: { level: p.level ?? a.human!.level, p: [p.x, p.z] }, face: p.face,
      speed: p.speed ?? (p.gait && p.gait !== 'walk' ? GAIT_SPEED_CAPS[p.gait] : bodyProfile(a).speed), ...(p.gait && p.gait !== 'walk' ? { gait: p.gait } : {}), profile: bodyProfile(a), route, leg: 0, segs: [], total: 0, s: 0, v: 0,
      offset: 0, narrows: [], held: new Set(), climbT: 0, epoch: spatial(rt,p.actor).epoch, replans: 0, phase: 'walk', side: 0, stuck: 0, turning: false, plannedAround: {}, peopleReplans: 0, pushes: 0,
    };
    // paged ground: the walk is registered first, so the window covering its chunk is there when the leg is smoothed
    if (spatial(rt, p.actor).ground?.paged) { walkExecs(rt).set(id, ex); enterLeg(rt, ex); return ex; }
    enterLeg(rt, ex);
    walkExecs(rt).set(id, ex);
    return ex;
  },
  step(rt, ex, dt) {
    const h = rt.world.entities[ex.actor];
    const x0 = h.pose.p[0], z0 = h.pose.p[2];
    const outer = stepScope, outerPartner = handPartner;
    handPartner = h.human?.handHold ? handPartnerOf(rt, h) : null;
    stepScope = WALK_PERF.stepSnapshot ? { entities: handPartner ? entityList(rt).filter((e) => e.id !== handPartner) : entityList(rt) } : null;
    let r: StepResult;
    try {
      r = stepWalk(rt, ex, dt);
    } finally {
      stepScope = outer; handPartner = outerPartner;
    }
    r = watchdog(rt, ex, h, r);
    if (r.status === 'completed' || r.status === 'failed') {
      walkExecs(rt).delete(ex.id);
      delete h.human!.speed;
    } else h.human!.speed = Math.round((dist2([x0, z0], [h.pose.p[0], h.pose.p[2]]) / dt) * 1000) / 1000;
    if (h.body?.family==='floater' && (h.human!.speed??0)>=WALK_MIN && ['wait','idle'].includes(h.human!.activity)) h.human!.activity='walk';
    // entry 35: the partner whose hand this walker holds walks beside it, this same tick
    if (h.human?.handHold) followHand(rt, h, dt);
    return r;
  },
  recoverWait(rt, ex, mover) {
    const unavailable = (message: string) => ({ status: 'unavailable' as const, diagnostic: { code: 'deadlock.recovery-unavailable', message, subjects: [mover] } });
    if (mover !== ex.actor || ex.phase !== 'walk' || ex.v >= 0.02 || !ex.block || ex.peopleReplans >= MAX_PEOPLE_REPLANS || ex.detour || ex.cancelTo)
      return unavailable('walker has no remaining applicable person/load replan; occupied goals and stairs require clearance');
    if (!takeReplan(rt, false)) return { status: 'deferred', diagnostic: { code: 'deadlock.recovery-budget', message: 'walker recovery waits for existing planner budget', subjects: [mover] } };
    const planned = retryPeople(rt, ex, rt.world.entities[ex.actor]);
    return { status: 'attempted', diagnostic: { code: planned ? 'deadlock.replanned' : 'deadlock.replan-refused', message: planned ? 'existing person/load planner found a route from the current pose' : 'existing person/load planner found no safe route', subjects: [mover] } };
  },
  waitQuiescent(_rt, ex, exhausted) { return exhausted.has(ex.actor) && ((ex.v < 0.02 && ex.phase === 'walk') || ex.phase === 'align' || ex.phase === 'climb') && !ex.cancelTo && !ex.detour; },
  cancel(rt, ex) {
    // mid-flight on a stair: the body is between levels, so stopping here would leave it standing on
    // the flight. Defer: walk on to whichever landing is nearer along the path, then finish as cancelled.
    const leg = ex.route.legs[ex.leg];
    if (leg?.kind === 'link' && ex.phase === 'climb' && ex.climbT > 1e-9) {
      ex.cancelTo ??= rt.world.entities[ex.actor].body?.family==='floater'?'exit':ex.climbT >= linkGeometry(leg).total / 2 ? 'exit' : 'entry';
      return { ok: true, deferred: true };
    }
    releaseAll(rt, ex);
    walkExecs(rt).delete(ex.id);
    const a = rt.world.entities[ex.actor];
    a.human!.activity = 'idle';
    a.human!.task = undefined;
    delete a.human!.speed;
    return { ok: true };
  },
};

/** BS3 watchdog: ticks of a walk's own steps with no progress (≤ WATCH_M from where it last made some) before one forced
 *  replan from where it stands (15 s), and before it ends honestly as walk.stuck (15 s more). */
export const WATCH_REPLAN_TICKS = 300, WATCH_FAIL_TICKS = 600;
const WATCH_M = 0.5;
/** Waits that name someone moving (or an occupied goal): they have their own decisions and deadlock recovery, and the
 *  watchdog's clock pauses while they last. A walker stopped by geometry (walk.obstacle) or walking on the spot counts. */
const WATCH_PAUSE = new Set(['traffic.person', 'traffic.load', 'traffic.yield', 'traffic.stepped-aside', 'walk.goal-occupied']);
/**
 * BS3 (Souls never stuck): driven only by the walk's own ticks (its exec state, so a snapshot or replay resumes it exactly).
 * Progress is the body leaving a 0.5 m disc round where it last made progress (or changing level). Climbing a flight,
 * cancelling and named waits for people pause it. After WATCH_REPLAN_TICKS without progress the walk replans once from
 * where it stands (the corridor-construction path, whatever the budget); after WATCH_FAIL_TICKS it fails `walk.stuck`.
 */
function watchdog(rt: Runtime, ex: Exec, h: Entity, r: StepResult): StepResult {
  if (r.status === 'completed' || r.status === 'failed') return r;
  if (ex.cancelTo || ex.phase === 'climb' || ex.phase === 'align' || ex.route.legs[ex.leg]?.kind === 'link') return r;
  if (r.status === 'blocked' && WATCH_PAUSE.has(r.diagnostic?.code ?? '')) return r;
  const p: Vec2 = [h.pose.p[0], h.pose.p[2]], level = h.human!.level;
  const w = (ex.watch ??= { at: p, level, n: 0, replanned: false });
  if (dist2(p, w.at) > WATCH_M || level !== w.level) { ex.watch = { at: p, level, n: 0, replanned: false }; return r; }
  w.n++;
  if (w.n >= WATCH_FAIL_TICKS) {
    releaseAll(rt, ex);
    return { status: 'failed', diagnostic: { code: 'walk.stuck', message: `${ex.actor} made no headway for ${Math.round((w.n * DT))} s at (${p[0].toFixed(1)}, ${p[1].toFixed(1)}), even after planning again from there`, subjects: [ex.actor], at: [...h.pose.p] as [number, number, number] } };
  }
  if (w.n >= WATCH_REPLAN_TICKS && !w.replanned) { w.replanned = true; ex.replanWait = REPLAN_MAX_WAIT; }
  return r;
}

function enterLeg(rt: Runtime, ex: Exec) {
  const leg = ex.route.legs[ex.leg];
  { const sp = spatial(rt, ex.actor); if (sp.ground?.paged) { sp.sync(rt.world); sp.focusOn(rt.world, ex.actor); } }
  ex.s = 0;
  // every leg starts at the body's actual position (replans start from the offset pose), so any
  // lateral passing offset of the previous corridor must not carry over (it would teleport the body)
  ex.offset = 0;
  ex.side = 0; // a new corridor: any static sidestep was for the old one
  ex.sideFor = undefined;
  ex.sideAt = undefined;
  ex.segs = [];
  ex.narrows = [];
  if (leg.kind === 'walk') {
    // smooth on the grid the route was planned on: with the people / loads it was routed around
    const sp = spatial(rt,ex.actor);
    const lg = (ex.around?.length ? sp.gridsAround(rt.world, ex.around).grids.levels.get(leg.level) : undefined) ?? sp.level(leg.level)!;
    const sm = smoothPolyline(lg, leg.points, { clearance: ex.profile.radius + PLAN_MARGIN, speed: ex.speed, turnRate: ex.profile.turnRate });
    ex.segs = sm.segs;
    ex.total = sm.total;
    ex.segEpoch = spatial(rt,ex.actor).epoch;
    ex.narrows = findNarrows(rt, ex, leg);
    ex.phase = 'walk';
    // a new corridor (replan, next leg) that leaves at an angle to where the body faces: the walker
    // cannot keep its momentum sideways or backwards; it slows at once to what the heading allows
    const a = rt.world.entities[ex.actor];
    if (ex.segs.length) ex.v = Math.min(ex.v, headingCap(angleDelta(a.pose.yaw, faceAt(ex, 0)), ex.speed));
  } else {
    ex.climbT = 0;
    ex.phase = 'align';
  }
}

/** Paged ground: plan the next chunk when the walker is this close (m) to the end of the current one (it never stops). */
const CHUNK_AHEAD_M = 6;
/** Paged ground: follow on with the next chunk toward `route.rest`; a failure ends the walk (null: walking on). */
function nextChunk(rt: Runtime, ex: Exec, a: Entity): StepResult | null {
  const r = planWalk(rt, a, ex.route.rest!, ex.profile);
  if (!r.ok) { releaseAll(rt, ex); return { status: 'failed', diagnostic: { ...r.diagnostic, subjects: [ex.actor, ...(r.diagnostic.subjects ?? [])] } }; }
  releaseAll(rt, ex);
  ex.route = r.route;
  ex.around = undefined;
  ex.leg = 0;
  enterLeg(rt, ex);
  return null;
}

/** Every point of the route's first `upTo` metres (sampled every 0.3 m on walk legs) passes `ok`. */
function routeHeadClear(route: Route, ok: (q: Vec2) => boolean, upTo: number): boolean {
  let s = 0;
  for (const leg of route.legs) {
    if (leg.kind !== 'walk') return true;
    for (let i = 1; i < leg.points.length; i++) {
      const a = leg.points[i - 1], b = leg.points[i], len = dist2(a, b);
      for (let t = 0; t <= len; t += 0.3) {
        if (!ok(add2(a, scale2(sub2(b, a), len > 0 ? t / len : 0)))) return false;
        if (s + t > upTo) return true;
      }
      s += len;
    }
  }
  return true;
}

/** Intervals of the leg that pass through single-file components. */
function findNarrows(rt: Runtime, ex: Exec, leg: WalkLeg): Narrow[] {
  const sp = spatial(rt,ex.actor);
  const g = sp.level(leg.level)!;
  // paged ground: passages named by their own first cell (window-independent), found by flood fill along the leg only
  const paged = !!sp.ground?.paged, lab = paged ? null : sp.narrow(leg.level, ex.profile.radius);
  const out: Narrow[] = [];
  let cur: Narrow | null = null;
  for (let s = 0; s <= ex.total + 1e-9; s += g.cell * 0.5) {
    const p = pointAt(ex, s);
    const c = cellOf(g, p);
    let res: string | null;
    if (lab) { const comp = c >= 0 ? lab[c] : -1; res = comp >= 0 ? `narrow:${sp.epoch}:${leg.level}:${comp}` : null; }
    else { const id = c >= 0 ? narrowIdOf(g, ex.profile.radius, c) : null; res = id ? `narrow:${sp.epoch}:${leg.level}:${id}` : null; }
    if (res && (!cur || cur.res !== res)) {
      if (cur) out.push(cur);
      cur = { res, s0: s, s1: s, entry: p, dir: tangentAt(ex, s) };
    } else if (res && cur) cur.s1 = s;
    else if (!res && cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Index of the first segment whose end lies at or beyond s + tol (segs.length if none): binary search on s0 + len. */
function segAt(segs: Seg[], s: number, tol: number): number {
  let lo = 0, hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s + tol <= segs[mid].s0 + segs[mid].len) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
function pointAt(ex: Exec, s: number): Vec2 {
  if (!ex.segs.length) {
    const leg = ex.route.legs[ex.leg] as WalkLeg;
    return leg.points[leg.points.length - 1];
  }
  const i = segAt(ex.segs, s, 0);
  if (i >= ex.segs.length) return ex.segs[ex.segs.length - 1].b;
  const g = ex.segs[i];
  return add2(g.a, scale2(sub2(g.b, g.a), clamp((s - g.s0) / g.len, 0, 1)));
}
function tangentAt(ex: Exec, s: number): Vec2 {
  const i = segAt(ex.segs, s, 1e-9);
  const g = ex.segs[Math.min(i, ex.segs.length - 1)];
  return g ? norm2(sub2(g.b, g.a)) : [1, 0];
}
/**
 * Speed allowed now so that every upcoming vertex speed cap (fillet curvature, sharp corner) is met on
 * arrival there, braking at ACCEL: min over vertices b ahead of √(cap_b² + 2·ACCEL·d_b).
 */
function capAhead(ex: Exec): number {
  let v = Infinity;
  const horizon = (ex.speed * ex.speed) / (2 * ACCEL) + 0.5;
  for (const g of ex.segs) {
    const d = g.s0 + g.len - ex.s;
    if (d < -1e-9) continue;
    if (g.cap < Infinity) v = Math.min(v, Math.sqrt(g.cap * g.cap + 2 * ACCEL * Math.max(0, d)));
    if (d > horizon) break;
  }
  return v;
}
/** BS3 (a): arc length from ex.s to the first shallow-water point of the corridor within a faster gait's braking horizon
 *  down to walking pace (0: underfoot), or Infinity. Sampled every 0.25 m on the smoothed path. */
function wadeAhead(ex: Exec, f: { medium(x: number, z: number): number }): number {
  const horizon = Math.min(ex.total - ex.s, (ex.speed * ex.speed - WALK_SPEED_CAP * WALK_SPEED_CAP) / (2 * ACCEL) + 0.5);
  for (let d = 0; d <= horizon + 1e-9; d += 0.25) { const q = pointAt(ex, ex.s + d); if (f.medium(q[0], q[1]) === G_WADE) return d; }
  return Infinity;
}
/** Heading the walker aims for at arc length s: along the chord to the path point FACE_LOOK ahead. */
function faceAt(ex: Exec, s: number): number {
  const p = pointAt(ex, s), q = pointAt(ex, Math.min(ex.total, s + FACE_LOOK));
  return dist2(p, q) > 1e-6 ? heading(sub2(q, p)) : heading(tangentAt(ex, s));
}
/** Speed allowed with heading error `err`: full up to HEAD_FULL, linear to 0 at TURN_IN_PLACE (turn in place beyond). */
export const headingCap = (err: number, speed: number) => speed * clamp((TURN_IN_PLACE - Math.abs(err)) / (TURN_IN_PLACE - HEAD_FULL), 0, 1);

function releaseAll(rt: Runtime, ex: Exec) {
  const t = traffic(rt);
  for (const r of ex.held) {
    const e = t.get(r);
    e?.actors.delete(ex.actor);
    if (e && !e.actors.size) t.delete(r);
  }
  ex.held.clear();
}

function tryEnter(rt: Runtime, ex: Exec, n: Narrow): string | null {
  const t = traffic(rt);
  const e = t.get(n.res);
  if (!e || !e.actors.size) {
    t.set(n.res, { actors: new Set([ex.actor]), entry: n.entry, dir: n.dir });
    ex.held.add(n.res);
    return null;
  }
  if (e.actors.has(ex.actor)) return null;
  // same-direction followers may share a single-file passage
  if (e.dir[0] * n.dir[0] + e.dir[1] * n.dir[1] > 0.5) {
    e.actors.add(ex.actor);
    ex.held.add(n.res);
    return null;
  }
  return [...e.actors][0];
}

/** Existing person/load recovery path, shared with the bounded persistent-wait request. */
function retryPeople(rt: Runtime, ex: Exec, a: Entity, landingPeople: AroundPerson[] = []): boolean {
  // Do not substitute a snapped safe endpoint for a destination inside a sleeper.
  if (!ex.cancelTo && occupant(rt, a, ex.goal.p, ex.profile.radius, true, ex.goal.level)) return false;
  const sp = spatial(rt,ex.actor);
  ex.stuck = 0;
  ex.still = 0;
  ex.peopleReplans++;
  // a carried load in the way counts as an obstacle too: route around where it is now. In a crowd
  // (a fire ring filling up) every standing person as a comfortable obstacle (0.3 m half-width) can wall
  // the walker in, crowd its start or its goal: then squeeze — route around the same people planned
  // smaller (SQUEEZE_HALF), still keeping the body separation from every one of them
  const loads = loadDiscsFor(rt, a).map((d, i) => ({ id: `${d.entity}#${i}`, p: d.p }));
  const blockers = Object.entries(ex.block!.at).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).filter(([id]) => rt.world.entities[id]?.kind === 'human').map(([id, p]) => ({ id, p }));
  let others = [...standingPeople(rt, a), ...loads];
  for (const b of blockers) if (!others.some((o) => o.id === b.id)) others.push(b);
  for (const b of landingPeople) if (!others.some((o) => o.id === b.id)) others.push(b);
  const from = { level: a.human!.level, p: [a.pose.p[0], a.pose.p[2]] as Vec2 };
  // a failure's diagnostic is only read below, for subjects among `others`: an unfinished-stairs
  // explanation (a second, successful search naming links) can matter only for a link with such an id
  const lazy = WALK_PERF.lazyLinkDiagnostics;
  let rr = sp.routeAround(rt.world, ex.profile, from, targetOf(ex), others, lazy ? (id) => others.some((o) => o.id === id) : undefined);
  // (only when the failure names a person: `routeAround` names the people / loads that wall the walker
  // in, crowd its start or goal, or stand at a stair it needs (path.ts nameObstacles); a structural
  // failure, e.g. an unfinished stair, names nobody and is not searched twice. Routing round only the
  // blockers, as before, walked the walker into the people it left out.)
  const isPerson = (id: string) => rt.world.entities[id]?.kind === 'human';
  if (!rr.ok && (rr.diagnostic.subjects ?? []).some((id) => isPerson(id) && others.some((o) => o.id === id))) {
    const squeezed = others.map((o) => (isPerson(o.id) ? { ...o, half: SQUEEZE_HALF } : o));
    const r2 = sp.routeAround(rt.world, ex.profile, from, targetOf(ex), squeezed, lazy ? () => false : undefined); // only r2.ok is read
    if (r2.ok) { rr = r2; others = squeezed; }
  }
  ex.plannedAround = Object.fromEntries(others.map((o) => [o.id, o.p]));
  if (rr.ok) {
    releaseAll(rt, ex);
    ex.route = rr.route;
    ex.around = others;
    ex.leg = 0;
    ex.replans++;
    ex.block = undefined;
    enterLeg(rt, ex);
    return true;
  }
  return false;
}

function stepWalk(rt: Runtime, ex: Exec, dt: number): StepResult {
  const a = rt.world.entities[ex.actor];
  const sp = spatial(rt,ex.actor);
  // a holder never walks off, whichever path started the walk (walk_to plan, or a parent action
  // calling walkTo.start directly — review C2)
  if (a.human!.grip) {
    releaseAll(rt, ex);
    return { status: 'failed', diagnostic: { code: 'actor.holding', message: `${ex.actor} is holding ${a.human!.grip.entity} and cannot walk away until it is set down or stable`, subjects: [ex.actor, a.human!.grip.entity] } };
  }
  const activeLeg = ex.route.legs[ex.leg];
  if (activeLeg?.kind === 'link') {
    // The planned Link may be a stale object after construction replaces scene links.
    // Check before replanning or deferred cancellation can move a body between levels.
    sp.sync(rt.world);
    const current = sp.scene.links.find((l) => l.id === activeLeg.link.id);
    const planned = activeLeg.link;
    const samePoint = (p: number[], q: number[]) => p.length === q.length && p.every((v, i) => v === q[i]);
    const unchanged = current && current.kind === planned.kind && current.heading === planned.heading && current.width >= planned.width &&
      current.from.level === planned.from.level && current.from.y === planned.from.y && samePoint(current.from.p, planned.from.p) &&
      current.to.level === planned.to.level && current.to.y === planned.to.y && samePoint(current.to.p, planned.to.p) &&
      current.path.length === planned.path.length && current.path.every((p, i) => samePoint(p, planned.path[i]));
    if (!current?.usable || !unchanged) {
      const diagnostic: Diagnostic = { code: 'route.link-unusable',
        message: `${activeLeg.link.kind} ${activeLeg.link.id} became unusable: ${!current ? 'link removed' : !current.usable ? (current.reason ?? 'closed') : 'link geometry changed'}`,
        subjects: [ex.actor, activeLeg.link.id] };
      if (ex.phase === 'climb' && ex.climbT > 1e-9) {
        a.human!.activity = 'climb-wait';
        ex.v = 0;
        // A climber cannot be dropped onto either floor; retain its actor/link claims.
        return { status: 'blocked', diagnostic };
      }
      releaseAll(rt, ex);
      return { status: 'failed', diagnostic };
    }
  }
  if (ex.cancelTo) return stepLinkCancel(rt, ex, a, ex.route.legs[ex.leg] as LinkLeg, dt);
  if (activeLeg?.kind === 'link' && ex.phase === 'climb') {
    // Replanning from a between-level pose would project it onto a floor. Hold until the
    // remaining route is valid; only replan after reaching a supported landing.
    if (sp.epoch !== ex.epoch && !remainingValid(rt, ex)) {
      a.human!.activity = 'climb-wait'; ex.v = 0;
      return { status: 'blocked', diagnostic: { code: 'route.invalidated', message: `${ex.actor} waits on ${activeLeg.link.id}: the remaining route changed before a safe landing`, subjects: [ex.actor, activeLeg.link.id] } };
    }
    return stepLink(rt, ex, a, activeLeg, dt);
  }
  if (ex.detour?.stage === 'pending') {
    const planned=ex.detour.planned;
    if(planned&&planned.epoch!==sp.epoch){ex.detour=undefined;}
    else {
      const by = ex.detour.faceoff ? rt.world.entities[ex.detour.by] : undefined;
      const r = planned?{ok:true as const,route:planned.route}:by ? sp.routeAround(rt.world, ex.profile, { level: a.human!.level, p: [a.pose.p[0], a.pose.p[2]] }, { level: ex.detour.level, p: ex.detour.spot }, [{ id: by.id, p: [by.pose.p[0], by.pose.p[2]] }])
        : planWalk(rt, a, { level: ex.detour.level, p: ex.detour.spot }, ex.profile);
      if (r.ok) {
        releaseAll(rt, ex);
        ex.route = r.route;
        ex.around = planned?.around;
        delete ex.detour.planned;
        ex.leg = 0;
        ex.replans++;
        ex.stuck = 0;
        ex.v = 0;
        ex.detour.stage = 'going';
        enterLeg(rt, ex);
        return { status: 'running', phase: 'step-aside' };
      }
      ex.detour = undefined;
    }
  }
  if (ex.detour?.stage === 'waiting') {
    // walk on once the goal and the first stretch of the way back to it are clear of the formation
    const d = ex.detour;
    const clear=(q:Vec2)=>d.landing?(!rt.world.entities[d.by] || Math.abs(rt.world.entities[d.by].pose.p[1]-d.landing.y)>1 || dist2(q,[rt.world.entities[d.by].pose.p[0],rt.world.entities[d.by].pose.p[2]])>d.landing.radius):d.clearOf!(q);
    const r = clear(ex.goal.p) ? planWalk(rt, a, ex.goal, ex.profile) : null;
    if (r && !r.ok) return { status: 'failed', diagnostic: { ...r.diagnostic, code: 'route.invalidated', message: `${ex.actor} cannot walk on after stepping aside: ${r.diagnostic.message}` } };
    if (!r || !routeHeadClear(r.route, clear, 4)) {
      a.human!.activity = 'wait';
      return blockedWait(rt, ex.id, ex.actor, d.blockers ?? [], { code: 'traffic.stepped-aside', message: `${ex.actor} stepped aside for ${d.by} and waits for it to pass before walking on`, subjects: [ex.actor, d.by] });
    }
    const resetPeople=ex.detour.egress===true;
    ex.detour = undefined;
    releaseAll(rt, ex);
    ex.route = r.route;
    ex.around = undefined;
    ex.leg = 0;
    ex.replans++;
    ex.stuck = 0;
    // The bounded courtesy actually reached another supported spot and waited
    // for the dependency to clear. Its old blocked episode must not exhaust
    // avoidance of a different person later along the original route.
    if(resetPeople)ex.peopleReplans=0;
    enterLeg(rt, ex);
    return { status: 'running', phase: 'replan' };
  }
  // Link admission already synced above; avoid repeating the same scan while aligning.
  // Topology changed (construction)? replan only if the remaining corridor is no longer valid.
  if (activeLeg?.kind !== 'link') sp.sync(rt.world);
  let moved = false;
  if (sp.epoch !== ex.epoch) {
    ex.epoch = sp.epoch;
    moved = true;
    if (remainingValid(rt, ex)) {
      ex.replanWait = undefined;
      ex.segEpoch = sp.epoch;
      if (ex.route.legs[ex.leg].kind === 'walk') ex.narrows = findNarrows(rt, ex, ex.route.legs[ex.leg] as WalkLeg);
    } else ex.replanWait ??= 0;
  }
  // construction replans are budgeted per tick (PLANNING_BUDGET.md): over budget, a walker whose
  // next stretch of corridor is still clear keeps following it for up to REPLAN_MAX_WAIT ticks; one
  // whose next stretch is blocked (or who has waited long enough) replans at once and still counts
  // against the budget. Deterministic: live actions step in submission order.
  if (ex.replanWait !== undefined) {
    if (takeReplan(rt, ex.replanWait >= REPLAN_MAX_WAIT || !prefixValid(rt, ex))) {
      ex.replanWait = undefined;
      releaseAll(rt, ex);
      const r = planWalk(rt, a, targetOf(ex), ex.profile);
      if (!r.ok) return { status: 'failed', diagnostic: { ...r.diagnostic, code: 'route.invalidated', message: `route invalidated by construction: ${r.diagnostic.message}` } };
      ex.route = r.route;
      ex.around = undefined;
      ex.leg = 0;
      ex.replans++;
      enterLeg(rt, ex);
    } else {
      // following the old corridor meanwhile: key its single-file passages to the new epoch
      if (moved && ex.route.legs[ex.leg].kind === 'walk') ex.narrows = findNarrows(rt, ex, ex.route.legs[ex.leg] as WalkLeg);
      ex.replanWait++;
    }
  }
  // paged ground (spatial/tiled.ts pagedRoute): a few metres before the end of a chunk, the next one is planned from here
  if (ex.route.rest && !ex.detour && !ex.cancelTo && ex.leg === ex.route.legs.length - 1 && ex.route.legs[ex.leg].kind === 'walk' && ex.total - ex.s < CHUNK_AHEAD_M) {
    const c = nextChunk(rt, ex, a);
    if (c) return c;
  }
  const leg = ex.route.legs[ex.leg];
  if (leg.kind === 'link') return stepLink(rt, ex, a, leg, dt);

  const g = sp.level(leg.level)!;
  const r = ex.profile.radius;
  // traffic: need the next narrow interval before entering it
  let yieldTo: string | null = null;
  // stepping aside out of a face-off: the walk to the spot is the way out of the single-file stretch, never queued on it
  for (const n of ex.detour?.faceoff && ex.detour.stage === 'going' ? [] : ex.narrows) {
    if (ex.s > n.s1 + r + 0.2) {
      if (ex.held.has(n.res)) {
        const e = traffic(rt).get(n.res);
        e?.actors.delete(ex.actor);
        if (e && !e.actors.size) traffic(rt).delete(n.res);
        ex.held.delete(n.res);
      }
      continue;
    }
    if (ex.s >= n.s0 - (r + 0.9)) { yieldTo = tryEnter(rt, ex, n); }
    break;
  }
  const tan = tangentAt(ex, ex.s);
  const arrived = ex.s >= ex.total - 1e-6;
  // walker-walker encounters are measured against the smoothed path ahead (not the current tangent), so
  // two walkers on curved approaches resolve as they would on straight ones
  const track = lazyTrack(ex, a);
  const enc: Encounter = arrived ? { kind: 'none' } : encounter(rt, ex, a, track);
  // static sidestep, latched per standing person until they are behind us (no swinging back into
  // them while alongside, no flicker when they sit at the edge of the encounter band)
  if (arrived) { ex.side = 0; ex.sideFor = undefined; ex.sideAt = undefined; } // at the goal the body settles onto the corridor point
  else if (enc.kind === 'static') ex.sideFor = enc.id; // one side kept while passing a group (no flip-flop)
  else if (ex.side && !(ex.sideFor && alongside(rt, ex, a, tan, ex.sideFor))) { ex.side = 0; ex.sideFor = undefined; ex.sideAt = undefined; }
  // head-on with room for both: latch the decision per encounter (hysteresis); while the partner is
  // still ahead, keep passing even after the offsets have opened the lateral gap past `encounter`'s band.
  // The latch ends when the partner stops being a head-on walker (turns, stops, or is behind us).
  if (arrived) ex.pass = undefined; // at the goal the body settles onto the corridor point
  else if (ex.pass) {
    const same = enc.kind !== 'none' && enc.id === ex.pass.id;
    if (same ? enc.kind !== 'headon' : !stillPassing(rt, a, track, ex.pass.id)) ex.pass = undefined;
  }
  if (enc.kind === 'headon' && ex.pass?.id !== enc.id) {
    // keep right, unless the oncoming walker is already clearly on our right (then both pass on the
    // left: the test is symmetric, so both walkers pick the same way round)
    // (onRight: signed lateral of the oncoming walker from my walked line where we meet)
    const side = enc.onRight > 0.1 ? -1 : 1;
    ex.pass = { id: enc.id, side, room: roomToPass(ex, g, enc.along, side) };
  }
  const passing = !yieldTo && !!ex.pass?.room && ex.held.size === 0 && !holdsTraffic(rt, ex.pass.id) && (enc.kind === 'none' || enc.id === ex.pass.id);
  // lateral offset target (bounded by clearance below)
  let targetOffset = 0;
  let giveWay = false;
  if (yieldTo) targetOffset = -YIELD_OFFSET;
  else if (passing) targetOffset = -ex.pass!.side * PASS_OFFSET;
  else if (enc.kind === 'headon' || enc.kind === 'crossing') {
    const iHold = ex.held.size > 0;
    const oHolds = holdsTraffic(rt, enc.id);
    giveWay = (oHolds && !iHold) || (!iHold && !oHolds && enc.id < ex.actor);
    targetOffset = giveWay ? -YIELD_OFFSET : -PASS_OFFSET;
  } else if (enc.kind === 'static' || ex.side) {
    // where to pass standing people: the lateral offset with the most room at the encounter point
    // (grid clearance and every standing person there), recomputed when a new person is met
    if (!ex.side || (enc.kind === 'static' && enc.id !== ex.sideAt)) {
      const t = sidestepTarget(rt, ex, a, g, enc.kind === 'static' ? enc.along : 0);
      // never swing back towards the person the current sidestep is for while they are still alongside
      // (two people flanking the way, e.g. a slot between neighbours in a ring, would otherwise flip the
      // side every tick as each becomes the nearer encounter)
      const flip = !!ex.side && (t >= 0 ? 1 : -1) !== ex.side && !!ex.sideAt && alongside(rt, ex, a, tan, ex.sideAt);
      if (!flip) {
        ex.sideTarget = t;
        ex.side = t >= 0 ? 1 : -1;
        ex.sideAt = enc.kind === 'static' ? enc.id : ex.sideAt;
      }
    }
    targetOffset = ex.sideTarget ?? ex.side * STATIC_OFFSET;
  }
  // the lateral offset the body is at now (the body stands at the corridor point of ex.s shifted by it)
  const bodyOff = ex.offset;
  ex.offset += clamp(targetOffset - ex.offset, -0.9 * dt, 0.9 * dt);
  // speed planning: curvature / sharp-corner caps of the smoothed path ahead (spline.ts), arrival
  let vmax = Math.min(ex.speed, capAhead(ex));
  vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, ex.total - ex.s)) + 0.05);
  if (yieldTo) {
    const narrow = ex.narrows.find((n) => ex.s <= n.s1 + r + 0.2)!;
    vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, narrow.s0 - (r + 1.0) - ex.s)));
  }
  let personBlock: string | null = null;
  if (passing) vmax = Math.min(vmax, PASS_SPEED);
  if (enc.kind !== 'none') {
    const tight = enc.lateral < 2 * r + 0.04;
    if (enc.kind === 'follow') {
      if (enc.along < 2 * r + 0.3) { vmax = 0; personBlock = enc.id; }
      else vmax = Math.min(vmax, 0.9);
    } else if (giveWay) {
      vmax = 0; // stand aside and let them pass
      personBlock = enc.id;
    } else if (tight && enc.along < 2 * r + 0.35 && enc.kind !== 'static') {
      vmax = 0;
      personBlock = enc.id;
    } else if (tight) vmax = Math.min(vmax, passing ? 0.5 : 0.45); // a pass slows but keeps walking
    // (a standing person close ahead is left to the look-ahead: it stops the walker exactly before
    // contact along the path it will really take, sidestep included, instead of 0.9 m short of them)
  }
  // carried loads (review C3): never step into one (loadIntrusion below): wait for it to pass
  let loadBlock: string | null = null;
  let geoBlock: string | null = null;
  let phase = 'walk';
  // heading follows the path; the heading error caps the speed (full up to 20°, none at 120°), so a
  // walker only turns in place when the path leaves at more than 120° from where it faces
  if (!arrived) {
    const hc = headingCap(angleDelta(a.pose.yaw, faceAt(ex, ex.s)), ex.speed);
    ex.turning = hc <= 0;
    if (ex.turning) phase = 'turn';
    vmax = Math.min(vmax, hc);
  } else ex.turning = false;
  // anticipation: standing people, carried loads (and stale-corridor geometry) within ~1.5 s ahead:
  // brake to stop STOP_GAP short of them instead of finding them by contact
  const hz = arrived ? null : hazardAhead(rt, ex, a, g, targetOffset);
  if (!arrived && nearDrivenVehicle(rt, ex, a)) vmax = Math.min(vmax, VEHICLE_WALK);
  if (hz) vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, hz.d - STOP_GAP)));
  // stopped by it already: hold, do not creep up to it, until the decision (or until it moves off)
  if (hz && ex.block?.at[hz.id]) vmax = 0;
  // BS3 (a): a faster gait is a dry-ground activity on every chunk and replan, not only the first one walk_to.plan checks:
  // shallow water ahead (or underfoot) brings a jogger or runner down to walking pace before it steps in (wading is walking)
  const wadeF = ex.gait && g.level === 0 ? sp.ground?.field : undefined;
  if (wadeF && !arrived && ex.speed > WALK_SPEED_CAP) {
    const d = wadeAhead(ex, wadeF);
    if (d < Infinity) vmax = Math.min(vmax, Math.sqrt(WALK_SPEED_CAP * WALK_SPEED_CAP + 2 * ACCEL * Math.max(0, d - 0.1)));
  }
  const prevS = ex.s;
  ex.v += clamp(vmax - ex.v, -BRAKE * dt, ACCEL * dt);
  if (ex.v < 0) ex.v = 0;
  let adv = ex.v * dt;
  let stoppedFor: Hazard | null = null;
  if (hz) {
    const room = Math.max(0, hz.d - STOP_GAP);
    // it appeared inside the comfortable stopping distance (placed / stepped in front of us: the
    // look-ahead sees everything else ≥ 1.5 s out): stop now, on this tick, rather than carry on
    // into it; otherwise never advance past the stop point
    if ((ex.v * ex.v) / (2 * ACCEL) > room + 1e-9) { adv = 0; ex.v = 0; stoppedFor = hz; }
    else if (adv > room) { adv = room; ex.v = room / dt; }
    // at its stop point, or already stopped by it (held until the decision or until it moves off)
    if (ex.v < 0.02 && (hz.d - STOP_GAP <= 0.05 || ex.block?.at[hz.id])) stoppedFor = hz;
  }
  ex.s = Math.min(ex.total, ex.s + adv);
  // facing: along the path chord ahead (anticipates curves by FACE_LOOK), at most turnRate
  if (!arrived) a.pose.yaw = turnToward(a.pose.yaw, faceAt(ex, ex.s), ex.profile.turnRate * dt);
  // position = corridor point + bounded lateral offset (never outside clearance)
  const cur: Vec2 = [a.pose.p[0], a.pose.p[2]];
  const place = (s: number, offset: number): { p: Vec2; off: number } => {
    const base = pointAt(ex, s);
    const fq = pointAt(ex, Math.min(ex.total, s + FACE_LOOK));
    const ahead: Vec2 = dist2(base, fq) > 1e-6 ? norm2(sub2(fq, base)) : tangentAt(ex, s);
    const normal: Vec2 = rot2(ahead, -Math.PI / 2);
    const at = (off: number) => add2(base, scale2(normal, -off));
    const clear = (q: Vec2) => clearanceAt(g, q) >= r && segmentClearance(g, base, q) >= r;
    let q = at(offset);
    if (offset === 0 || clear(q)) return { p: q, off: offset };
    if (clearanceAt(g, base) < r) return { p: base, off: 0 };
    // no room at the full offset here: the largest fraction of it that has room (bisection), so the
    // offset narrows continuously with the corridor's clearance instead of halving in one step
    let lo = 0, hi = 1;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      if (clear(at(offset * mid))) lo = mid;
      else hi = mid;
    }
    q = at(offset * lo);
    return { p: q, off: offset * lo };
  };
  // No jumps (MOVEMENT.md): the body moves at most min(speed, gait cap) × dt this tick, forward
  // progress, sidestep and any pull back into line together. Over budget, the walker takes the largest
  // fraction t of this tick's corridor progress and offset change that fits (it slows down: an offset
  // swept round the outside of a bend, a sidestep while walking at full speed). If that leaves it
  // (nearly) stuck because the offset must narrow ahead (a gap the sidestep does not fit through), it
  // first steps back towards the corridor where it is; a body away from its corridor point (a walk
  // started off its route) walks straight back to it.
  const stepMax = Math.min(ex.speed, GAIT_SPEED_CAPS[ex.gait ?? 'walk']) * dt;
  const sNew = ex.s, offNew = ex.offset;
  const at = (t: number) => place(prevS + (sNew - prevS) * t, bodyOff + (offNew - bodyOff) * t);
  let pl = at(1);
  let frac = 1;
  let lagging = false;
  if (dist2(cur, pl.p) > stepMax + 1e-9) {
    const p0 = at(0);
    const j0 = dist2(cur, p0.p);
    if (j0 > stepMax + 1e-9) {
      // off the corridor point: walk back to it, holding the corridor progress
      pl = { p: add2(cur, scale2(sub2(p0.p, cur), stepMax / j0)), off: bodyOff };
      frac = 0;
      lagging = true;
    } else {
      let lo = 0, hi = 1, best = p0;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        const q = at(mid);
        if (dist2(cur, q.p) <= stepMax) { lo = mid; best = q; }
        else hi = mid;
      }
      frac = lo;
      pl = best;
      const want = at(1).off;
      const narrows = lo < 0.5 && Math.abs(want) < Math.abs(bodyOff) - 1e-6;
      if ((narrows || lo === 0) && bodyOff !== 0) {
        // the offset must narrow ahead (or nothing fits at all): pull it in here first, straight towards
        // this spot's corridor point (the segment the body was placed on, so inside its clearance), then
        // walk on. Stuck with no progress at all, it pulls in towards the corridor itself.
        const to = narrows ? want : 0;
        const nOff = bodyOff + clamp(to - bodyOff, -stepMax, stepMax);
        const base = place(prevS, 0).p;
        pl = { p: add2(base, scale2(sub2(cur, base), nOff / bodyOff)), off: nOff };
        frac = 0;
      } else if (lo === 0) {
        // on the corridor line and still no fraction fits (the corridor point itself jumps): take this
        // tick's progress and walk to its point over the next ticks (held there, as off the corridor above)
        const p1 = at(1);
        pl = { p: add2(cur, scale2(sub2(p1.p, cur), stepMax / dist2(cur, p1.p))), off: p1.off };
        frac = 1;
        lagging = true;
      }
      lagging ||= frac < 1;
    }
    ex.s = prevS + (sNew - prevS) * frac;
    ex.v = Math.min(ex.v, (ex.s - prevS) / dt);
  }
  // hard separation guarantee (collision-enforcement layer, independent of the avoidance heuristics):
  // never take a step that brings this body inside another person's space or a carried load. The
  // look-ahead above normally stops the walker first. If only the sidestep would intrude, the step
  // is taken without it (the offset holds); a step cancelled outright is counted (`pushes`).
  let into = intrusion(rt, a, cur, pl.p, r) ?? loadIntrusion(rt, a, cur, pl.p, r);
  if (into && pl.off !== bodyOff && !lagging) {
    const keep = place(ex.s, bodyOff);
    if (dist2(cur, keep.p) <= stepMax + 1e-9 && !(intrusion(rt, a, cur, keep.p, r) ?? loadIntrusion(rt, a, cur, keep.p, r))) {
      // Prospective reporting only: at the endpoint a held sidestep can be
      // obstructed even though the destination itself is free. Retain the real
      // dependency for existing wait/recovery instead of an unnamed settle.
      if (arrived && rt.services.walkSettleWaitV1 === true) {
        if (rt.world.entities[into]?.kind === 'human') personBlock ??= into;
        else loadBlock ??= into;
        ex.v = 0;
      }
      pl = keep; into = null;
    }
  }
  let p = pl.p;
  ex.offset = pl.off;
  if (into) {
    // the body stays where it is: so do its corridor progress and its offset (an offset that kept
    // moving towards a sidestep target while the body was held would be jumped to on release)
    ex.s = prevS;
    ex.offset = bodyOff;
    ex.v = 0;
    p = cur;
    lagging = false;
    if (rt.world.entities[into]?.kind === 'human') personBlock ??= into;
    else loadBlock ??= into;
    ex.pushes++;
  }
  // stopped for a hazard (at its stop point, or at once because it appeared too close): that hazard
  // is what blocks us (named below)
  if (stoppedFor && ex.v < 0.02) {
    if (stoppedFor.kind === 'person') personBlock ??= stoppedFor.id;
    else if (stoppedFor.kind === 'load') loadBlock ??= stoppedFor.id;
    else geoBlock = stoppedFor.id;
  }
  // BS3 (a) hard guard: a step that ends in shallow water is a wading step, at most walking pace (motion.overspeed's
  // 'wade' cap); the look-ahead above normally slowed it already (a lateral offset or a chunk boundary can surprise it)
  if (wadeF && p !== cur && dist2(cur, p) > WALK_SPEED_CAP * dt + 1e-9 && wadeF.medium(p[0], p[1]) === G_WADE) {
    const k = (WALK_SPEED_CAP * dt) / dist2(cur, p);
    ex.s = prevS + (ex.s - prevS) * k;
    const q = place(ex.s, ex.offset);
    p = dist2(cur, q.p) <= WALK_SPEED_CAP * dt + 1e-9 ? q.p : add2(cur, scale2(sub2(q.p, cur), (WALK_SPEED_CAP * dt) / dist2(cur, q.p)));
    ex.offset = q.off;
    ex.v = Math.min(ex.v, WALK_SPEED_CAP);
  }
  // hard static layer (W38): never step to where the body would overlap static geometry by the invariant's measure
  // (runtime/invariants.ts humanStaticClearance: clearance < r − 3 cm) unless it already stands worse. A route planned
  // from a start inside the radius runs its first leg straight to the nearest standable cell (spatial/path.ts snap), and
  // past a column corner that leg can cut into a beam end (chiba 2022, planned round people). The walker holds and
  // replans instead (as for a stale corridor). A step it takes here would be a collision.human-static violation.
  if (p !== cur) {
    const cn = clearanceAt(g, p);
    if (cn < r - STATIC_TOL && cn < clearanceAt(g, cur) - 1e-9) {
      geoBlock ??= nearestBlocker(g, p) ?? 'geometry';
      ex.s = prevS;
      ex.offset = bodyOff;
      ex.v = 0;
      p = cur;
      lagging = false;
    }
  }
  // ground worlds (spatial/ground.ts): level 0 is the terrain, so the body stands at the tiles' height and wades in shallows
  const gn = g.level === 0 ? sp.ground : undefined, gf = gn?.field;
  let y = gn ? gn.standY(p[0], p[1]) : g.y;
  // ground worlds: a step up/down (a deck's end, a floor slab's edge) is taken over a few ticks, never in one jump
  // (runtime/invariants.ts motion.teleport); slopes change far less than this per tick, so on them y is the tiles' exactly
  if (gn) { const dy = y - a.pose.p[1], h = hypot(p[0] - cur[0], p[1] - cur[1]), budget = ex.gait ? Math.max(0.145, GAIT_SPEED_CAPS[ex.gait] * dt * 1.25 - 0.005) : 0.145, v = Math.max(0.02, Math.sqrt(Math.max(0, budget * budget - h * h))); if (Math.abs(dy) > v && Math.abs(dy) < 1.5) y = a.pose.p[1] + Math.sign(dy) * v; }
  a.pose.p = [p[0], y, p[1]];
  // animation signal: 'walk' only while the body actually covers ground (the renderer's Walk clip);
  // a stopped walker waits (named reason) or stands idle — it never walks on the spot
  const gs = dist2(cur, p) / dt;
  a.human!.activity = gs >= WALK_MIN ? (gf && gf.medium(p[0], p[1]) === G_WADE ? 'wade' : ex.gait ?? 'walk') : yieldTo || personBlock || loadBlock || geoBlock ? 'wait' : 'idle';

  // decide within DECIDE_TICKS (0.5 s) of being stopped: a blocker that has not moved since (a
  // standing person, a parked load) is routed around (they become temporary obstacles); one that keeps
  // moving is waited for with a named reason, and routed around after STUCK_TICKS regardless
  // (one blocked stretch may alternate between two people, e.g. passing between them: it counts as one)
  const blocker = ex.v < 0.02 ? personBlock ?? loadBlock : null;
  const creeping = !blocker && !arrived && !!ex.block && ex.block.leg === ex.leg && ex.v < CREEP_SPEED && ex.s - ex.block.s0 < BLOCK_PROGRESS;
  if (blocker || creeping) {
    if (!ex.block) { ex.block = { id: blocker!, at: {}, s0: ex.s, leg: ex.leg }; ex.stuck = 0; ex.still = 0; }
    if (blocker) ex.block.id = blocker;
    ex.stuck++;
    let moved = false;
    for (const id of [...Object.keys(ex.block.at), ...(!blocker || blocker in ex.block.at ? [] : [blocker])].sort()) {
      const at = blockerAt(rt, a, id);
      if (!at) continue;
      const was = ex.block.at[id];
      if (!was || dist2(at, was) >= 0.1) { ex.block.at[id] = at; if (was) moved = true; }
    }
    ex.still = moved ? 0 : (ex.still ?? 0) + 1;
  } else { ex.block = undefined; ex.stuck = 0; ex.still = 0; }
  // the first decision comes within DECIDE_TICKS; if routing around did not free the walker, each
  // further attempt waits twice as long (0.5, 1, 2, 4 … s), so a crowd that clears is waited for
  const decideAfter = DECIDE_TICKS * (1 << Math.min(ex.peopleReplans, 5)); // (a shift: `**` is host pow)
  if (ex.block && !arrived && ex.peopleReplans < MAX_PEOPLE_REPLANS && ((ex.still ?? 0) >= decideAfter || ex.stuck >= Math.max(STUCK_TICKS, decideAfter))) {
    if (retryPeople(rt, ex, a)) return { status: 'running', phase: 'replan' };
  }
  // the corridor ahead turned out blocked by geometry (a stale corridor while a construction replan
  // was deferred): replan on the next tick, whatever the budget
  if (geoBlock) {
    ex.replanWait = REPLAN_MAX_WAIT;
    return blockedWait(rt, ex.id, ex.actor, [geoBlock], { code: 'walk.obstacle', message: `${ex.actor} stops short of ${geoBlock} on its corridor and replans`, subjects: [ex.actor, geoBlock] });
  }
  if (yieldTo && ex.v < 0.02) {
    const y0 = yieldsOf(rt)[ex.actor];
    yieldsOf(rt)[ex.actor] = { to: yieldTo, tick: rt.tick, since: y0 && y0.to === yieldTo && rt.tick - y0.tick <= 1 ? y0.since : rt.tick };
    return blockedWait(rt, ex.id, ex.actor, [yieldTo], { code: 'traffic.yield', message: `${ex.actor} is waiting for ${yieldTo} to clear a single-file passage`, subjects: [ex.actor, yieldTo] });
  }
  if (loadBlock && ex.v < 0.02)
    return blockedWait(rt, ex.id, ex.actor, [loadBlock], { code: 'traffic.load', message: `${ex.actor} waits for the carried ${loadBlock} to pass`, subjects: [ex.actor, loadBlock] });
  if (personBlock && ex.v < 0.02) {
    // W47: the W38 passage release below, for a person in my way (not only on my destination) who waits for me to clear a
    // single-file passage I hold (west-house 2022, D1: m6 → its climb foot, m3 stopped on it yielding to m6 — deadlocked). Their yield is read from this tick or the last (walks inside a carry have no record of their own); only
    // a wait that has lasted RELEASE_AFTER on both sides (a transient one resolves as before: every pin unchanged).
    const y = yieldsOf(rt)[personBlock];
    if (ex.held.size && y && y.to === ex.actor && rt.tick - y.tick <= 1 && rt.tick - y.since >= RELEASE_AFTER && (ex.still ?? 0) >= RELEASE_AFTER) releaseAll(rt, ex);
    if (rt.world.entityPhysicsV1) resolveFaceoff(rt, ex, personBlock);
    makeWay(rt, personBlock, pointAt(ex, ex.total));
    if (!ex.cancelTo && occupant(rt, a, ex.goal.p, ex.profile.radius, true, ex.goal.level) === personBlock)
      return blockedWait(rt, ex.id, ex.actor, [personBlock], { code: 'walk.goal-occupied', message: `${ex.actor}'s destination overlaps ${personBlock}'s supported sleep space`, subjects: [ex.actor, personBlock] });
    return blockedWait(rt, ex.id, ex.actor, [personBlock], { code: 'traffic.person', message: `${ex.actor} is waiting for ${personBlock} to move out of the way`, subjects: [ex.actor, personBlock] });
  }
  if (arrived) {
    const sleeper = !ex.cancelTo && occupant(rt, a, ex.goal.p, ex.profile.radius, true, ex.goal.level);
    if (sleeper) return blockedWait(rt, ex.id, ex.actor, [sleeper], { code: 'walk.goal-occupied', message: `${ex.actor}'s destination overlaps ${sleeper}'s supported sleep space`, subjects: [ex.actor, sleeper] });
    if (lagging) return { status: 'running', phase: 'settle' }; // the body is still closing on the corridor point
    if (Math.abs(ex.offset) > 0.05) {
      const occ = occupant(rt, a, pointAt(ex, ex.total), ex.profile.radius);
      if (occ) {
        // W38: the person on my destination waits for me to clear a single-file passage my destination lies in — I hold it
        // while I wait for them (chiba 2022, D1: m3 / m6 deadlocked for 16 h): let the passage go so they walk on through
        const ot = rt.world.entities[occ].human?.task, orec = ot ? rt.records.get(ot) : undefined;
        if (ex.held.size && orec?.status === 'blocked' && ((orec.diagnostic?.code === 'traffic.yield' && orec.diagnostic.subjects?.includes(ex.actor)) || (orec.diagnostic?.code.startsWith('deadlock.') && publishedWaitsFor(rt, occ, ex.actor, 'traffic.yield')))) releaseAll(rt, ex);
        makeWay(rt, occ, pointAt(ex, ex.total));
        return blockedWait(rt, ex.id, ex.actor, [occ], { code: 'walk.goal-occupied', message: `${ex.actor} cannot step onto its destination: ${occ} is standing there`, subjects: [ex.actor, occ] });
      }
      return { status: 'running', phase: 'settle' };
    }
    if (ex.leg < ex.route.legs.length - 1) {
      ex.leg++;
      enterLeg(rt, ex);
      return { status: 'running', phase: ex.phase };
    }
    if (ex.route.rest && !ex.detour && !ex.cancelTo) { const c = nextChunk(rt, ex, a); if (c) return c; return { status: 'running', phase: ex.phase }; }
    if (ex.detour?.stage === 'going') {
      releaseAll(rt, ex);
      ex.detour.stage = 'waiting';
      // #1120: this tick's step reached the aside spot at walking pace, so it stays a walk; the waiting stage says 'wait'
      // from the next tick, when the body is still (a 'wait' published with this tick's speed broke W21's wait cap).
      return { status: 'running', phase: 'step-aside' };
    }
    if (ex.face !== undefined && Math.abs(angleDelta(a.pose.yaw, ex.face)) > 0.03) {
      a.pose.yaw = turnToward(a.pose.yaw, ex.face, ex.profile.turnRate * dt);
      return { status: 'running', phase: 'face' };
    }
    releaseAll(rt, ex);
    a.human!.activity = 'idle';
    a.human!.task = undefined;
    // snapped: how far the standable arrival point lies from the requested goal (0 = exact; review H2)
    const snapped = Math.round(dist2(pointAt(ex, ex.total), ex.goal.p) * 1000) / 1000;
    return { status: 'completed', outputs: { replans: ex.replans, length: ex.route.length, snapped, pushes: ex.pushes, ...(ex.arrivalEvidence?{arrivalEndpoint:{position:[...a.pose.p],level:a.human!.level}}:{}) } };
  }
  return { status: 'running', phase };
}

/** Id of a person that moving from `from` to `to` would intrude on (closer than 2r and getting closer). */
function intrusion(rt: Runtime, me: Entity, from: Vec2, to: Vec2, r: number): string | null {
  for (const o of entitiesOf(rt)) {
    if (o.id === me.id || o.kind !== 'human' || !sameBodyPlane(me,o)) continue;
    if (me.body?.family!=='floater' && Math.abs(o.pose.p[1] - me.pose.p[1]) > 1.0) continue;
    const sleepTo = gapToSleep(o, to);
    if (sleepTo !== null) {
      if (sleepTo <= r + SLEEP_BODY_MARGIN && sleepTo < gapToSleep(o, from)! - 1e-9) return o.id;
      continue;
    }
    const dTo = hypot(o.pose.p[0] - to[0], o.pose.p[2] - to[1]);
    if (dTo >= 2 * r - 0.02) continue;
    const dFrom = hypot(o.pose.p[0] - from[0], o.pose.p[2] - from[1]);
    if (dTo < dFrom - 1e-9) return o.id;
  }
  return null;
}

/** Carried-load discs published by the carry action (`rt.services.loadDiscs`, see carry/actions.ts activeLoadDiscs). */
type LoadDiscView = { p: Vec2; r: number; entity: string; crew: string[]; level: number };
function loadDiscsFor(rt: Runtime, me: Entity): LoadDiscView[] {
  const read = () => (rt.services.loadDiscs?.() ?? []) as LoadDiscView[];
  const all = stepScope ? (stepScope.discs ??= read()) : read();
  return all.filter((d) => !d.crew.includes(me.id) && d.level === me.human!.level);
}

/** The carried load that moving from `from` to `to` would push this body into (and deeper). */
function loadIntrusion(rt: Runtime, me: Entity, from: Vec2, to: Vec2, r: number): string | null {
  for (const d of loadDiscsFor(rt, me)) {
    const dTo = dist2(to, d.p);
    if (dTo >= d.r + r - 0.02) continue;
    if (dTo < dist2(from, d.p) - 1e-9) return d.entity;
  }
  return null;
}

/** Where a blocker (person, or carried load by entity id) is now; null if it is gone. */
function blockerAt(rt: Runtime, me: Entity, id: string): Vec2 | null {
  const o = rt.world.entities[id];
  if (o?.kind === 'human') return [o.pose.p[0], o.pose.p[2]];
  const d = loadDiscsFor(rt, me).find((q) => q.entity === id);
  return d ? d.p : null;
}

/** Footprints of vehicles being driven right now (the rider's action executing, not stopped/blocked). */
function drivenVehicles(rt: Runtime, me: Entity): OBB2[] {
  const out: OBB2[] = [];
  for (const o of entitiesOf(rt)) {
    const vid = o.human?.riding, t = o.human?.task;
    if (!vid || !t || o.human!.level !== me.human!.level) continue;
    const rec = rt.records.get(t);
    const v = rt.world.entities[vid];
    if (!v || !rec || !rt.isActive(t) || rec.status === 'blocked') continue;
    out.push(entityFootprint(v).obb);
  }
  return out;
}
/** Body gap from p to an oriented rectangle (0 inside). */
function gapToObb(p: Vec2, o: OBB2): number {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return len2([Math.max(Math.abs(l[0]) - o.half[0], 0), Math.max(Math.abs(l[1]) - o.half[1], 0)]);
}
/** People keep their distance from a moving truck or ride: the walker, or its path in the next LOOK_TIME, is within VEHICLE_GAP of one. */
function nearDrivenVehicle(rt: Runtime, ex: Exec, a: Entity): boolean {
  const vs = drivenVehicles(rt, a);
  if (!vs.length) return false;
  const r = ex.profile.radius;
  const horizon = Math.min(ex.total - ex.s, Math.max(1.0, ex.speed * LOOK_TIME));
  for (let dd = 0; ; dd = Math.min(horizon, dd + 0.25)) {
    const q = dd === 0 ? ([a.pose.p[0], a.pose.p[2]] as Vec2) : pointAt(ex, ex.s + dd);
    if (vs.some((o) => gapToObb(q, o) - r < VEHICLE_GAP)) return true;
    if (dd >= horizon) return false;
  }
}

type Hazard = { d: number; id: string; kind: 'person' | 'load' | 'geometry' };
const HAZARD_STEP = 0.1; // m between look-ahead samples
const NEAR_LOOK = 0.1; // m of look-ahead for a (momentarily blocked) walker: contact avoidance only

/**
 * The first thing within LOOK_TIME (≥ 1 m) ahead along the corridor that the body would touch: a
 * standing person (or a blocked walker), a carried load (intrusion thresholds, and only when getting
 * closer), or — while the corridor predates the current navigation epoch — geometry. Samples follow
 * the lateral offset as it moves toward `targetOffset`. `d` = arc length ahead of the walker.
 * Moving walkers are left to the encounter rules (follow / head-on / crossing) and the hard layer.
 */
function hazardAhead(rt: Runtime, ex: Exec, a: Entity, g: LevelGrid, targetOffset: number): Hazard | null {
  const r = ex.profile.radius;
  const horizon = Math.min(ex.total - ex.s, Math.max(1.0, ex.speed * LOOK_TIME));
  if (horizon <= 1e-6) return null;
  const me: Vec2 = [a.pose.p[0], a.pose.p[2]];
  const reach = horizon + 2 * r + 1.0;
  // `near`: only the next few centimetres matter (contact avoidance, no cancelled steps): a walker that
  // is momentarily blocked is still a walker, handled by the encounter rules (give way, pass, follow)
  const cands: { id: string; kind: 'person' | 'load'; p: Vec2; need: number; now: number; near?: boolean; sleeper?: Entity }[] = [];
  for (const o of entitiesOf(rt)) {
    if (o.id === a.id || o.kind !== 'human' || !sameBodyPlane(a,o) || Math.abs(o.pose.p[1] - a.pose.p[1]) > 1.0) continue;
    const q: Vec2 = [o.pose.p[0], o.pose.p[2]];
    const sleepNow = gapToSleep(o, me), now = sleepNow ?? dist2(me, q);
    if (now > reach || isActiveWalker(rt, o)) continue;
    // (people the route was planned around stay candidates: the smoothed route keeps ≥ 0.58 m from
    // them so they never trigger, unless the start snapped close to one — then we stop, not push)
    const t = o.human!.task;
    const walker = !!t && rt.records.get(t)?.verb === 'walk_to' && rt.isActive(t);
    cands.push({ id: o.id, kind: 'person', p: q, need: sleepNow !== null ? r + SLEEP_BODY_MARGIN : 2 * r - 0.02, now, near: walker, ...(sleepNow !== null ? { sleeper: o } : {}) });
  }
  for (const d of loadDiscsFor(rt, a)) {
    const now = dist2(me, d.p);
    if (now <= reach + d.r) cands.push({ id: d.entity, kind: 'load', p: d.p, need: d.r + r - 0.02, now });
  }
  const stale = ex.segEpoch !== spatial(rt,ex.actor).epoch;
  if (!cands.length && !stale) return null;
  const hereClear = Math.min(r, clearanceAt(g, me));
  // the lateral offset keeps moving (0.9 m/s) however slowly the walker advances, so a slow walker
  // reaches a sample with more of its sidestep done: predict with the actual speed (floored at 0.1 m/s)
  const vref = Math.max(ex.v, 0.1);
  /** What the body would touch at arc length dd ahead (null = clear). */
  const probe = (dd: number): Hazard | null => {
    const s = ex.s + dd;
    const base = pointAt(ex, s);
    if (stale && clearanceAt(g, base) < hereClear) return { d: dd, id: nearestBlocker(g, base) ?? 'geometry', kind: 'geometry' };
    if (!cands.length) return null;
    const t = dd / vref;
    let off = ex.offset + clamp(targetOffset - ex.offset, -0.9 * t, 0.9 * t);
    const nrm = rot2(tangentAt(ex, s), -Math.PI / 2);
    let q = add2(base, scale2(nrm, -off));
    // the same clearance bound the position step applies (the offset halves where it would not fit)
    for (let h = 0; h < 6 && clearanceAt(g, q) < r; h++) {
      off *= 0.5;
      q = add2(base, scale2(nrm, -off));
    }
    for (const c of cands) {
      if (c.near && dd > NEAR_LOOK) continue;
      const dq = c.sleeper ? gapToSleep(c.sleeper, q)! : dist2(q, c.p);
      if ((c.sleeper ? dq <= c.need : dq < c.need) && dq < c.now - 1e-9) return { d: dd, id: c.id, kind: c.kind };
    }
    return null;
  };
  const n = Math.ceil(horizon / HAZARD_STEP - 1e-9);
  for (let k = 1; k <= n; k++) {
    const hit = probe(Math.min(k * HAZARD_STEP, horizon));
    if (!hit) continue;
    // refine the contact point between the last clear sample and this one (6 halvings: < 2 mm);
    // d = the last clear arc length, so stopping STOP_GAP before it never touches
    let lo = (k - 1) * HAZARD_STEP, hi = hit.d, best = hit;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2, h = probe(mid);
      if (h) { hi = mid; best = h; } else lo = mid;
    }
    return { ...best, d: lo };
  }
  return null;
}

/** Floaters approaching a landing share its physical space before their level changes. */
function sameBodyPlane(me:Entity,other:Entity):boolean {
  return me.body?.family==='floater'?Math.abs(me.pose.p[1]-other.pose.p[1])<=1.1:other.human?.level===me.human!.level;
}

/** A person that moving from `from` to `to` on a flight would bring `me` within 2r of (and closer). Also used by the carry climb. */
export function stairBlocker(rt: Runtime, me: Entity, from: number[], to: number[], r: number): string | null {
  for (const o of entitiesOf(rt)) {
    if (o.id === me.id || o.kind !== 'human') continue;
    const floater=me.body?.family==='floater';
    const dyTo=Math.abs(o.pose.p[1]-to[1]),dyFrom=Math.abs(o.pose.p[1]-from[1]);
    const dTo = floater && dyTo<=1.1?hypot(o.pose.p[0]-to[0],o.pose.p[2]-to[2]):hypot(o.pose.p[0] - to[0], (o.pose.p[1] - to[1]) * 0.5, o.pose.p[2] - to[2]);
    if (dTo >= 2 * r - 0.02) continue;
    const dFrom = floater && dyFrom<=1.1?hypot(o.pose.p[0]-from[0],o.pose.p[2]-from[2]):hypot(o.pose.p[0] - from[0], (o.pose.p[1] - from[1]) * 0.5, o.pose.p[2] - from[2]);
    if ((floater && dyTo<=1.1) || dTo < dFrom - 1e-9) return o.id;
  }
  return null;
}

/**
 * stair-landing-clearance/1 (#509): a body on a flight's destination level (within 1 m in height) that stands closer
 * to its landing point than the two bodies' radii less 2 cm, in entity order, or null. Walk avoidance and the separation invariant compare
 * bodies on the same level only, so a walker on the destination floor cannot see a climber who is still on the flight.
 * `stairBlocker` refuses only a step that brings the climber closer to a body; this refuses the final step onto an
 * occupied landing whatever its direction, so the climber waits on the flight instead of arriving overlapping.
 */
export function landingBlocker(rt: Runtime, me: Entity, landing: { p: Vec2; y: number; level: number }, r: number): string | null {
  for (const o of entitiesOf(rt)) {
    if (o.id === me.id || o.kind !== 'human' || o.human?.level !== landing.level || Math.abs(o.pose.p[1] - landing.y) > 1.0) continue;
    if (hypot(o.pose.p[0] - landing.p[0], o.pose.p[2] - landing.p[1]) < r + bodyProfile(o).radius - 0.02) return o.id;
  }
  return null;
}

/**
 * Directed tasks outrank ambient idleness (spec §17): an idle person who is in
 * the way is asked to step to the nearest free spot clear of the requester's
 * destination. People holding or carrying are never moved. A walker whose own
 * walk_to is blocked (e.g. its goal lies in a carry formation's path, so each
 * waits for the other) is moved only when the requester passes `clearOf`
 * (true where the requester no longer needs the ground): it steps aside to a spot
 * `clearOf` accepts, waits there until its goal is clear, then walks on.
 */
export function makeWay(rt: Runtime, who: string, keepClear: Vec2, clearOf?: { by: string; subjects: string[]; test?: (q: Vec2) => boolean; landing?: {y:number;radius:number} }) {
  const o = rt.world.entities[who];
  if (!o?.human || o.human.grip) return;
  let ex: Exec | undefined;
  if (o.human.task) {
    if (!clearOf) return;
    const rec = rt.records.get(o.human.task);
    ex = walkExecs(rt).get(o.human.task);
    const settledFloater=o.body?.family==='floater' && !!clearOf.landing && (o.human.speed??0)<WALK_MIN && ex?.phase==='walk' && ex.s>=ex.total-1e-6;
    if (!ex || rec?.verb !== 'walk_to' || (rec.status !== 'blocked' && !settledFloater) || ex.detour || ex.cancelTo || (ex.route.legs[ex.leg]?.kind !== 'walk' && !(o.body?.family==='floater' && ex.phase==='align'))) return;
    // A settled floater at a landing may yield to the body that cannot step off there.
    // Other walkers retain the original mutual-wait admission.
    if (!settledFloater && !rec.diagnostic?.subjects?.some((s) => s !== who && clearOf.subjects.includes(s))) return;
  }
  // A coordinator may hold an idle actor between physical children. Respect
  // that claim instead of repeatedly submitting a conflicting ambient nudge.
  if (!ex && rt.holder(`actor:${who}`).length) return;
  // A short solo pose (a shelf browse) is not shoved off its spot: the walker waits the few seconds it has left.
  // Grouped poses settle through a nudge (social/pose.ts) and a long pose is nudged as before.
  if (!ex && rt.holder(`pose:${who}`).some((id) => { const r = rt.records.get(id), p = r?.params as { group?: string; seconds?: number } | undefined;
    return r?.verb === 'pose_v1' && !p?.group && rt.isActive(id) && (p?.seconds ?? Infinity) - (rt.tick - r.requestedTick) * DT <= POSE_DEFER_S; })) return;
  const sp = spatial(rt,o.id);
  const g = sp.level(o.human.level);
  if (!g) return;
  const from: Vec2 = [o.pose.p[0], o.pose.p[2]];
  const away = norm2(sub2(from, keepClear));
  const base = len2(away) > 0 ? away : [1, 0] as Vec2;
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (let k = 0; k < 12; k++) {
    const dir = rot2(base, (k * Math.PI) / 6);
    for (const d of ex ? [1.2, 1.6, 2.2, 3.0] : [1.2, 1.6, 2.2]) {
      const q = add2(from, scale2(dir, d));
      if (dist2(q, keepClear) < 1.0) continue;
      const c = clearanceAt(g, q);
      if (c < bodyProfile(o).radius + 0.1 || occupant(rt, o, q, bodyProfile(o).radius + 0.2)) continue;
      if (ex && (!(clearOf!.landing?dist2(q,keepClear)>clearOf!.landing.radius:clearOf!.test!(q)) || !stepAwayClear(rt, o, from, q))) continue;
      const score = Math.min(c, 1.0) - 0.1 * d + 0.3 * (dir[0] * base[0] + dir[1] * base[1]);
      if (score > bestScore) { bestScore = score; best = q; }
    }
  }
  if (!best) return;
  if (ex) ex.detour = { spot: best, level: o.human.level, by: clearOf!.by, blockers: [...clearOf!.subjects], ...(clearOf!.landing?{landing:clearOf!.landing}:{clearOf:clearOf!.test}), stage: 'pending' };
  else {
    const id = `${who}:make-way:${rt.tick}`;
    // Multiple blocked movers may nudge the same idle person in one tick, even after a refusal.
    if (!rt.records.has(id)) { const move = rt.submit('walk_to', { actor: who, x: best[0], z: best[1] }, { id }); move.internalCause = 'traffic.make-way'; }
  }
}

/** Ticks two walkers may stand face to face, each blocked by the other, before one steps aside (1 s). */
export const FACEOFF_TICKS = 20;
/** makeWay leaves a solo pose alone in its last seconds (a 3-4 s shelf browse); longer poses are nudged. */
export const POSE_DEFER_S = 5;
/**
 * Entity worlds (god-built, `world.entityPhysicsV1`): two walkers face to face, each blocked by the other — in a
 * cottage doorway or a furnished room that is one single-file stretch, where the yielder is already inside the passage
 * and cannot give way by stepping to the side of it, and routing round the other finds nothing (Party Hill, 2026-10-10:
 * ~2.5 min, W47's release only swapping the two roles every 3 s). After FACEOFF_TICKS one of them steps aside to the
 * nearest free spot clear of the other's remaining way (`makeWay` with `clearOf`), waits there until the other has
 * passed, then walks on: first the one yielding the passage (or, two plain person-waits, the later id); if that one
 * finds no spot within 3·FACEOFF_TICKS, the other. Mars/Eden/LM native worlds (no entity physics) are unchanged.
 */
function resolveFaceoff(rt: Runtime, ex: Exec, who: string) {
  const f = ex.faceoff;
  ex.faceoff = f && f.id === who && f.tick >= rt.tick - 1 ? { ...f, tick: rt.tick } : { id: who, since: rt.tick, tick: rt.tick };
  const waited = rt.tick - ex.faceoff.since;
  if (waited < FACEOFF_TICKS) return;
  const ot = rt.world.entities[who]?.human?.task, orec = ot ? rt.records.get(ot) : undefined, oex = ot ? walkExecs(rt).get(ot) : undefined;
  if (!oex || orec?.status !== 'blocked' || !orec.diagnostic?.subjects?.includes(ex.actor) || oex.detour || ex.detour) return;
  // The prospective landing rule handles this cross-phase case. The old
  // floor faceoff's clearOfWay/pointAt requires two actual walk legs.
  if(rt.services.concurrentLinkEgressV1===true&&oex.route.legs[oex.leg]?.kind!=='walk')return;
  const first = orec.diagnostic.code === 'traffic.yield' || ex.actor < who ? who : ex.actor;
  const mover = waited < 3 * FACEOFF_TICKS ? first : first === who ? ex.actor : who;
  const forEx = mover === who ? ex : oex, moverEx = mover === who ? oex : ex;
  const m = rt.world.entities[mover], o = rt.world.entities[forEx.actor];
  if (!m?.human || m.human.grip) return;
  const g = spatial(rt, mover).level(m.human.level);
  if (!g) return;
  const test = clearOfWay(rt, forEx, moverEx.profile.radius), r = moverEx.profile.radius;
  const from: Vec2 = [m.pose.p[0], m.pose.p[2]];
  // nearest free spot first; it must be reachable going round the other body (not through it, as a plain plan would)
  const spots: { q: Vec2; d: number }[] = [];
  for (let k = 0; k < 16; k++) for (const d of [0.8, 1.2, 1.6, 2.2, 3.0, 4.0]) {
    const q = add2(from, scale2(rot2([1, 0], (k * Math.PI) / 8), d));
    if (clearanceAt(g, q) < r + 0.05 || occupant(rt, m, q, r + 0.1) || !test(q)) continue;
    spots.push({ q, d });
  }
  spots.sort((a, b) => a.d - b.d);
  const around = [{ id: o.id, p: [o.pose.p[0], o.pose.p[2]] as Vec2 }];
  for (const { q } of spots.slice(0, 12)) {
    const rr = spatial(rt, mover).routeAround(rt.world, moverEx.profile, { level: m.human.level, p: from }, { level: m.human.level, p: q }, around);
    if (!rr.ok || rr.route.length > 6) continue;
    moverEx.detour = { spot: q, level: m.human.level, by: forEx.actor, blockers: [forEx.actor], clearOf: test, stage: 'pending', faceoff: true };
    return;
  }
}

/** `q` is clear of what is left of `forEx`'s way (or that walk is over): a body of radius `r` there does not touch it. */
function clearOfWay(rt: Runtime, forEx: Exec, r: number) {
  return (q: Vec2) => {
    if (walkExecs(rt).get(forEx.id) !== forEx || forEx.detour) return true;
    const need = r + forEx.profile.radius + 0.1;
    for (let s = forEx.s; ; s = Math.min(forEx.total, s + 0.2)) {
      if (dist2(q, pointAt(forEx, s)) < need) return false;
      if (s >= forEx.total) return true;
    }
  };
}

/** The straight way from `from` to `q` never brings `me` closer to a person or carried-load disc it is (or would be) touching. */
function stepAwayClear(rt: Runtime, me: Entity, from: Vec2, q: Vec2): boolean {
  const r = bodyProfile(me).radius;
  const discs = [
    ...loadDiscsFor(rt, me).map((d) => ({ p: d.p, need: d.r + r + 0.05 })),
    ...entitiesOf(rt)
      .filter((o) => o.id !== me.id && o.kind === 'human' && sameBodyPlane(me,o))
      .map((o) => ({ p: [o.pose.p[0], o.pose.p[2]] as Vec2, need: 2 * r + 0.05 })),
  ];
  const len = dist2(from, q);
  for (let t = 0.25; t <= len; t += 0.25) {
    const p = add2(from, scale2(sub2(q, from), t / len));
    for (const d of discs) if (dist2(p, d.p) < Math.min(d.need, dist2(from, d.p) - 1e-9)) return false;
  }
  return true;
}

function occupant(rt: Runtime, me: Entity, p: Vec2, r: number, sleepOnly = false, level = me.human!.level): string | null {
  for (const o of entitiesOf(rt)) {
    if (o.id === me.id || o.kind !== 'human' || o.human?.level !== level) continue;
    const sleepGap = gapToSleep(o, p);
    if (sleepGap !== null) { if (sleepGap <= r + SLEEP_BODY_MARGIN) return o.id; }
    else if (!sleepOnly && hypot(o.pose.p[0] - p[0], o.pose.p[2] - p[1]) < 2 * r) return o.id;
  }
  return null;
}

const turnToward = (yaw: number, want: number, max: number) => wrapAngle(yaw + clamp(angleDelta(yaw, want), -max, max));

/**
 * The lateral offset (within ±STATIC_OFFSET, 0.1 m steps) at which to pass the standing people around
 * the corridor point `along` ahead: the one with the most room — min(grid clearance − r, distance to
 * each standing person − the separation 2r − 0.02) — reachable straight from the corridor. Ties go to
 * the smaller offset, then to the right (+). 0 if no offset beats staying on the corridor.
 */
function sidestepTarget(rt: Runtime, ex: Exec, a: Entity, g: LevelGrid, along: number): number {
  const r = ex.profile.radius;
  const s = Math.min(ex.total, ex.s + Math.max(0, along));
  const base = pointAt(ex, s);
  const n: Vec2 = rot2(tangentAt(ex, s), -Math.PI / 2);
  const people: { p: Vec2; sleeper?: Entity }[] = [];
  for (const o of entitiesOf(rt)) {
    if (o.id === a.id || o.kind !== 'human' || !sameBodyPlane(a,o) || isActiveWalker(rt, o)) continue;
    const q: Vec2 = [o.pose.p[0], o.pose.p[2]];
    const sleepGap = gapToSleep(o, base);
    if ((sleepGap ?? dist2(q, base)) < STATIC_OFFSET + 2 * r + 0.5) people.push({ p: q, ...(sleepGap !== null ? { sleeper: o } : {}) });
  }
  const room = (off: number) => {
    const q = add2(base, scale2(n, -off));
    if (segmentClearance(g, base, q) < r) return -Infinity;
    let m = clearanceAt(g, q) - r;
    for (const o of people) m = Math.min(m, o.sleeper ? gapToSleep(o.sleeper, q)! - (r + SLEEP_BODY_MARGIN) : dist2(q, o.p) - (2 * r - 0.02));
    return m;
  };
  let best = 0, bestRoom = room(0);
  for (let k = 1; k <= Math.round(STATIC_OFFSET / 0.1); k++)
    for (const off of [k * 0.1, -k * 0.1]) {
      const m = room(off);
      if (m > bestRoom + 1e-9) { best = off; bestRoom = m; }
    }
  return best;
}

function standingPeople(rt: Runtime, me: Entity) {
  return entitiesOf(rt)
    .filter((o) => o.id !== me.id && o.kind === 'human' && sameBodyPlane(me,o) && !isActiveWalker(rt, o))
    .map((o) => ({ id: o.id, p: [o.pose.p[0], o.pose.p[2]] as Vec2 }));
}

/**
 * A person whose walk is actually progressing. A blocked walker counts as standing (so others route around
 * them), and so does one at the end of its route — settling onto its goal or turning to face (speed 0: its
 * yaw is no heading, and treating it as oncoming or crossing traffic walked people into it).
 */
function isActiveWalker(rt: Runtime, o: Entity) {
  const t = o.human?.task;
  if (!t) return false;
  const rec = rt.records.get(t);
  if (!rec || rec.verb !== 'walk_to' || !rt.isActive(t) || rec.status === 'blocked') return false;
  const ex = walkExecs(rt).get(t);
  return !ex || ex.leg < ex.route.legs.length - 1 || ex.route.legs[ex.leg].kind !== 'walk' || ex.s < ex.total - 1e-6;
}

const holdsTraffic = (rt: Runtime, id: string) => [...traffic(rt).values()].some((t) => t.actors.has(id));

/**
 * Room for a head-on pass: my passing spot (corridor point + PASS_OFFSET to my `side`, +1 = right) and the
 * oncoming walker's (the corridor point level with them, PASS_OFFSET to the other side) both keep a body
 * radius (plus margin) of clearance, reachable straight from the corridor. In a 2.0 m corridor that holds
 * (centre clearance ≈ 0.95 m ≥ r + PASS_OFFSET); in the 1.0 m gap it does not, so the give-way applies.
 */
function roomToPass(ex: Exec, g: LevelGrid, along: number, side: number): boolean {
  const r = ex.profile.radius;
  const ok = (s: number, sgn: number) => {
    const base = pointAt(ex, s);
    const n: Vec2 = rot2(tangentAt(ex, s), -Math.PI / 2); // offset −PASS_OFFSET maps to base + n·PASS_OFFSET (the local normal)
    const q = add2(base, scale2(n, sgn * PASS_OFFSET));
    return clearanceAt(g, q) >= r + 0.04 && segmentClearance(g, base, q) >= r;
  };
  return ok(ex.s, side) && ok(Math.min(ex.total, ex.s + along), -side);
}

/** A standing person we are stepping round is still level with or ahead of us, near our line. */
function alongside(rt: Runtime, ex: Exec, a: Entity, tan: Vec2, id: string): boolean {
  const o = rt.world.entities[id];
  if (!o || !sameBodyPlane(a,o) || isActiveWalker(rt, o)) return false;
  const pa = ex.plannedAround[o.id];
  if (pa && dist2(pa, [o.pose.p[0], o.pose.p[2]]) < 0.15) return false; // the route avoids them
  const d = sub2([o.pose.p[0], o.pose.p[2]], [a.pose.p[0], a.pose.p[2]]);
  const along = d[0] * tan[0] + d[1] * tan[1];
  const lateral = Math.abs(d[0] * -tan[1] + d[1] * tan[0]);
  return along > -(2 * ex.profile.radius + 0.1) && along < LOOK && lateral < 2 * ex.profile.radius + STATIC_OFFSET;
}

/** The pass partner is still an active walker ahead of us, near enough to our line to matter. */
function stillPassing(rt: Runtime, a: Entity, track: () => Track, id: string): boolean {
  const o = rt.world.entities[id];
  if (!o || !sameBodyPlane(a,o) || !isActiveWalker(rt, o)) return false;
  const r = bodyProfile(a).radius;
  const pr = project(track(), [o.pose.p[0], o.pose.p[2]]);
  return pr.along > -r && pr.along < LOOK && pr.lateral < 2 * PASS_OFFSET + 2 * r;
}

export type Encounter = { kind: 'none' } | { kind: 'follow' | 'headon' | 'crossing' | 'static'; id: string; along: number; lateral: number; onRight: number };

/**
 * The line this walker will walk over the next LOOK metres: the smoothed path sampled every ENC_STEP,
 * shifted by its current lateral offset and anchored at its body (on a straight path: the body plus the
 * tangent, i.e. the old straight-line measure), then straight on past the goal. `t` = unit tangent there.
 */
type Track = { q: Vec2[]; t: Vec2[] };
function lazyTrack(ex: Exec, a: Entity): () => Track {
  let tr: Track | null = null;
  return () => (tr ??= trackAhead(ex, a));
}
function trackAhead(ex: Exec, a: Entity): Track {
  const me: Vec2 = [a.pose.p[0], a.pose.p[2]];
  const endP = pointAt(ex, ex.total), endT = tangentAt(ex, ex.total);
  const at = (s: number): { p: Vec2; t: Vec2 } => {
    const t = s <= ex.total ? tangentAt(ex, s) : endT;
    const base = s <= ex.total ? pointAt(ex, s) : add2(endP, scale2(endT, s - ex.total));
    return { p: add2(base, scale2([t[1], -t[0]], -ex.offset)), t }; // (t[1], −t[0]) = the normal place() offsets along
  };
  const p0 = at(ex.s).p;
  const n = Math.round(LOOK / ENC_STEP);
  const q = Array.from<Vec2>({ length: n + 1 }), t = Array.from<Vec2>({ length: n + 1 });
  for (let k = 0; k <= n; k++) {
    const x = at(ex.s + k * ENC_STEP);
    q[k] = add2(me, sub2(x.p, p0));
    t[k] = x.t;
  }
  return { q, t };
}
/** A point against the track: arc length ahead (negative = behind the body), unsigned and signed (+ = right) lateral distance, tangent there. */
function project(tr: Track, p: Vec2): { along: number; lateral: number; onRight: number; t: Vec2 } {
  let k = 0, best = Infinity;
  for (let i = 0; i < tr.q.length; i++) {
    const dx = p[0] - tr.q[i][0], dz = p[1] - tr.q[i][1];
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; k = i; }
  }
  const d = sub2(p, tr.q[k]), t = tr.t[k];
  const onRight = cross2(d, t);
  return { along: k * ENC_STEP + dot2(d, t), lateral: Math.abs(onRight), onRight, t };
}
/** The encounter a live walk (action id) would react to now (tests / inspection; read-only, outside a step). */
export function encounterOf(rt: Runtime, id: string): Encounter {
  const ex = walkExecs(rt).get(id);
  if (!ex || ex.route.legs[ex.leg]?.kind !== 'walk') return { kind: 'none' };
  const a = rt.world.entities[ex.actor];
  return encounter(rt, ex, a, lazyTrack(ex, a));
}
/** Where another walker is heading: the chord of its own smoothed path over its next ENC_TIME of walking (its yaw if it has none). */
function headingOf(rt: Runtime, o: Entity): Vec2 {
  const oex = o.human?.task ? walkExecs(rt).get(o.human.task) : undefined;
  if (oex && oex.route.legs[oex.leg]?.kind === 'walk' && oex.segs.length) {
    const p = pointAt(oex, oex.s), q = pointAt(oex, Math.min(oex.total, oex.s + Math.max(0.3, oex.speed * ENC_TIME)));
    if (dist2(p, q) > 1e-3) return norm2(sub2(q, p));
  }
  return rot2([1, 0], o.pose.yaw);
}

/**
 * The most pressing person within LOOK metres ahead along the path this walker will walk (its smoothed
 * path at its current offset) whose disc conflicts with it. Kind: standing ('static'), or by the other
 * walker's heading over its next ~1 s against this walker's path tangent where they meet: along it
 * ('follow'), against it ('headon'), across it ('crossing').
 */
function encounter(rt: Runtime, ex: Exec, a: Entity, track: () => Track): Encounter {
  let best: Encounter = { kind: 'none' };
  const me: Vec2 = [a.pose.p[0], a.pose.p[2]];
  const band = 2 * ex.profile.radius + 0.12;
  for (const o of entitiesOf(rt)) {
    if (o.id === a.id || o.kind !== 'human' || !sameBodyPlane(a,o)) continue;
    const op: Vec2 = [o.pose.p[0], o.pose.p[2]];
    const pa = ex.plannedAround[o.id];
    if (pa && dist2(pa, op) < 0.15) continue; // route already avoids them
    if (dist2(me, op) > LOOK + band) continue; // (the path ahead never reaches farther from the body)
    const pr = project(track(), op);
    if (pr.along < 0 || pr.along > LOOK || pr.lateral >= band) continue;
    if (best.kind !== 'none' && best.along <= pr.along) continue;
    const walking = isActiveWalker(rt, o);
    const dot = walking ? dot2(headingOf(rt, o), pr.t) : 0;
    const kind = !walking ? 'static' : dot > 0.3 ? 'follow' : dot < -0.3 ? 'headon' : 'crossing';
    best = { kind, id: o.id, along: pr.along, lateral: pr.lateral, onRight: pr.onRight };
  }
  return best;
}

function stepLink(rt: Runtime, ex: Exec, a: Entity, leg: Extract<Leg, { kind: 'link' }>, dt: number): StepResult {
  const link = leg.link;
  // a turning flight (Link.faceAlong, upper-floors/1) is entered and climbed facing along its steps
  const face = link.faceAlong ? alongYaw(linkGeometry(leg), ex.phase === 'align' ? 0 : ex.climbT, a.pose.yaw) : leg.ascending ? link.heading : wrapAngle(link.heading + Math.PI);
  if (ex.phase === 'align') {
    if (rt.services.occupiedLinkRoutingV1 === true && !ex.cancelTo && !ex.detour && ex.climbT <= 1e-9) {
      const exit = leg.ascending ? link.to : link.from;
      const stationary = entitiesOf(rt).filter(o => o.id !== a.id && o.kind === 'human' && !isActiveWalker(rt, o));
      const atLanding = (o: Entity, end: LinkLeg['link']['from']) => {
        const dy = Math.abs(o.pose.p[1] - end.y), dx = o.pose.p[0] - end.p[0], dz = o.pose.p[2] - end.p[1];
        // Same physical separation as stairBlocker; a different level label
        // does not let a seated body at the far landing disappear from view.
        return (a.body?.family === 'floater' && dy <= 1.1 ? hypot(dx, dz) : hypot(dx, dy * .5, dz)) < 2 * ex.profile.radius - .02;
      };
      const blocker = stationary.find(o => atLanding(o, exit));
      if (blocker) {
        const p: Vec2 = [blocker.pose.p[0], blocker.pose.p[2]], old = ex.linkWait;
        if (!old || old.link !== link.id || old.blocker !== blocker.id)
          ex.linkWait = {link: link.id, blocker: blocker.id, at: p, still: 1, lastTry: rt.tick};
        else if (dist2(old.at, p) >= .1) { old.at = p; old.still = 0; }
        else old.still++;
        const wait = ex.linkWait!;
        // retryPeople adds the named blocker explicitly, including one on a
        // different floor; its normal standingPeople scan covers our plane.
        ex.block = {id: blocker.id, at: {[blocker.id]: p}, s0: ex.s, leg: ex.leg};
        ex.v = 0; a.human!.activity = 'wait';
        const entry = leg.ascending ? link.from : link.to, sp = spatial(rt, ex.actor), here: Vec2 = [a.pose.p[0], a.pose.p[2]];
        const floor = sp.levelAt(entry.level, here), y = entry.level === 0 && sp.ground ? sp.ground.standY(...here) : floor?.y;
        const supported = a.human!.level === entry.level && floor && y !== undefined && Math.abs(a.pose.p[1] - y) <= .03 && clearanceAt(floor, here) >= ex.profile.radius;
        const delay = DECIDE_TICKS * (1 << Math.min(ex.peopleReplans, 5));
        if (supported && wait.still >= delay && rt.tick - wait.lastTry >= delay && ex.peopleReplans < MAX_PEOPLE_REPLANS && takeReplan(rt, false)) {
          wait.lastTry = rt.tick;
          // Include other occupied landings too: choosing another already
          // blocked flight would spend the retry budget walking between them.
          const people = stationary.filter(o => sp.scene.links.some(l => atLanding(o, l.from) || atLanding(o, l.to)))
            .map(o => ({id: o.id, p: [o.pose.p[0], o.pose.p[2]] as Vec2}));
          const before = ex.peopleReplans, rerouted = retryPeople(rt, ex, a, people);
          // A newly occupied sleep goal can refuse before retryPeople starts
          // its search; that decision still consumes this bounded attempt.
          if (ex.peopleReplans === before) ex.peopleReplans++;
          if (rerouted) { delete ex.linkWait; return {status: 'running', phase: 'replan'}; }
        }
        return blockedWait(rt, ex.id, ex.actor, [blocker.id], {code: 'traffic.person',
          message: `${ex.actor} waits before ${link.id}: ${blocker.id} occupies its far landing`, subjects: [ex.actor, blocker.id, link.id]});
      }
      if (ex.linkWait) { delete ex.linkWait; ex.block = undefined; ex.stuck = 0; ex.still = 0; }
    }
    // a walk leg ends within 5 cm of the flight's standing entry point (its settle tolerance): step onto
    // it at walking pace first, so the climb starts from where the body is (no jump onto the first step)
    const en = leg.ascending ? link.from : link.to;
    const gap = dist2([a.pose.p[0], a.pose.p[2]], en.p);
    if (gap > 1e-3) {
      const k = Math.min(1, (Math.min(ex.speed, WALK_SPEED_CAP) * dt) / gap);
      const next: [number,number,number]=[a.pose.p[0] + (en.p[0] - a.pose.p[0]) * k, a.pose.p[1], a.pose.p[2] + (en.p[1] - a.pose.p[2]) * k];
      const blocker=a.body?.family==='floater'?stairBlocker(rt,a,a.pose.p,next,ex.profile.radius):null;
      if(blocker){
        makeWay(rt,blocker,[next[0],next[2]],{by:a.id,subjects:[a.id],landing:{y:rt.world.entities[blocker].pose.p[1],radius:2*ex.profile.radius+.3}});
        a.human!.activity='wait';ex.v=0;
        return blockedWait(rt,ex.id,ex.actor,[blocker],{code:'traffic.person',message:`${ex.actor} waits at ${link.id} for ${blocker}`,subjects:[ex.actor,blocker,link.id]});
      }
      a.pose.p = next;
      a.pose.yaw = wrapAngle(a.pose.yaw + clamp(angleDelta(a.pose.yaw, face), -ex.profile.turnRate * dt, ex.profile.turnRate * dt));
      a.human!.activity = (gap * k) / dt >= WALK_MIN ? 'walk' : 'idle';
      return { status: 'running', phase: 'align' };
    }
    const e = angleDelta(a.pose.yaw, face);
    if (Math.abs(e) > 0.05) {
      a.pose.yaw = wrapAngle(a.pose.yaw + clamp(e, -ex.profile.turnRate * dt, ex.profile.turnRate * dt));
      a.human!.activity = 'idle';
      return { status: 'running', phase: 'align' };
    }
    ex.phase = 'climb';
    // occupy the stair as a single-file resource
    const res = `link:${link.id}`;
    const t = traffic(rt).get(res);
    if (t && t.actors.size && !t.actors.has(ex.actor) && (t.exclusive || dist2(t.entry, leg.ascending ? link.from.p : link.to.p) > 0.5 || (a.body?.family==='floater' && dot2(t.dir,rot2([1,0],face)) < -0.5))) {
      ex.phase = 'align';
      return blockedWait(rt, ex.id, ex.actor, [...t.actors], { code: 'traffic.yield', message: `${ex.actor} waits for ${[...t.actors][0]} to finish using ${link.id}`, subjects: [ex.actor, ...(a.body?.family==='floater'?[...t.actors]:[]), link.id] });
    }
    if (!t) traffic(rt).set(res, { actors: new Set([ex.actor]), entry: leg.ascending ? link.from.p : link.to.p, dir: rot2([1, 0], face) });
    else t.actors.add(ex.actor);
    ex.held.add(res);
  }
  const geo = linkGeometry(leg);
  const total = geo.total;
  ex.climbT = Math.min(total, ex.climbT + CLIMB_SPEED * dt);
  const next = pointOnLink(geo, ex.climbT);
  // someone standing on / at the end of the stair: wait rather than pass through them
  const onStair = stairBlocker(rt, a, a.pose.p, next, ex.profile.radius), exitEnd = leg.ascending ? link.to : link.from;
  const atLanding = !onStair && rt.services.stairLandingClearanceV1 === true && ex.climbT >= total - 1e-9 ? landingBlocker(rt, a, exitEnd, ex.profile.radius) : null;
  const blocker = onStair ?? atLanding;
  // stair-landing-clearance/1: ask an idle body on the landing to step aside, clear of it (spec §17), once a second.
  if (atLanding && a.body?.family !== 'floater' && rt.tick % 20 === 0) makeWay(rt, atLanding, exitEnd.p);
  if (blocker) {
    if(rt.services.concurrentLinkEgressV1===true)yieldLinkLanding(rt,ex,a,leg,blocker);
    if(a.body?.family==='floater')makeWay(rt,blocker,[next[0],next[2]],{by:a.id,subjects:[a.id],landing:{y:rt.world.entities[blocker].pose.p[1],radius:2*ex.profile.radius+.3}});
    ex.climbT = Math.max(0, ex.climbT - CLIMB_SPEED * dt);
    a.human!.activity = 'climb-wait'; // still on the stair: stair geometry, not the floor grid, applies
    return blockedWait(rt, ex.id, ex.actor, [blocker], { code: 'traffic.person', message: `${ex.actor} waits on ${link.id} for ${blocker} to move`, subjects: [ex.actor, blocker, link.id] });
  }
  a.pose.p = next;
  a.pose.yaw = link.faceAlong ? wrapAngle(a.pose.yaw + clamp(angleDelta(a.pose.yaw, alongYaw(geo, ex.climbT, a.pose.yaw)), -ex.profile.turnRate * 2 * dt, ex.profile.turnRate * 2 * dt)) : face;
  a.human!.activity = leg.ascending ? 'climb-up' : 'climb-down';
  if (ex.climbT >= total - 1e-9) {
    const exit = leg.ascending ? link.to : link.from;
    a.pose.p = [exit.p[0], exit.y, exit.p[1]];
    a.human!.level = exit.level;
    const res = `link:${link.id}`;
    const e = traffic(rt).get(res);
    e?.actors.delete(ex.actor);
    if (e && !e.actors.size) traffic(rt).delete(res);
    ex.held.delete(res);
    ex.leg++;
    enterLeg(rt, ex);
    return { status: 'running', phase: ex.phase };
  }
  return { status: 'running', phase: 'climb' };
}

/** A supported walker can clear a climber while retaining its own departure.
 * Only an actual reciprocal passage wait admits this short physical courtesy;
 * idle/held bodies and arbitrary active programs never become its subjects. */
function yieldLinkLanding(rt:Runtime,ex:Exec,a:Entity,leg:LinkLeg,who:string){
  if(ex.cancelTo||ex.detour||!['traffic.yield','traffic.person'].some(code=>publishedWaitsFor(rt,who,a.id,code)))return;
  const other=rt.world.entities[who],task=other?.human?.task,walker=task?walkExecs(rt).get(task):undefined,record=task?rt.records.get(task):undefined;
  if(!other?.human||other.human.grip||other.human.on||other.human.riding||other.human.sleepPose||!walker||record?.verb!=='walk_to'||record.status!=='blocked'||walker.phase!=='walk'||walker.route.legs[walker.leg]?.kind!=='walk'||walker.detour||walker.cancelTo)return;
  const sp=spatial(rt,who),from:Vec2=[other.pose.p[0],other.pose.p[2]],level=other.human.level,g=sp.levelAt(level,from);
  const floorY=level===0&&sp.ground?sp.ground.standY(...from):g?.y;
  if(!g||floorY===undefined||Math.abs(other.pose.p[1]-floorY)>.03)return;
  const prior=ex.linkYield,moved=(p:number[],q:number[])=>hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])>=.1;
  // A third body leaving a candidate pocket changes its availability even if
  // the two waiting bodies and static geometry have not changed. Retain local
  // anchors, not a periodic retry or an ever-growing observation history.
  const nearby=Object.fromEntries(entitiesOf(rt).filter(o=>o.id!==who&&o.id!==a.id&&o.kind==='human'&&sameBodyPlane(other,o)&&dist2(from,[o.pose.p[0],o.pose.p[2]])<=3).map(o=>[o.id,[...o.pose.p]]));
  const samePeople=prior?.nearby&&Object.keys(prior.nearby).length===Object.keys(nearby).length&&Object.entries(nearby).every(([id,p])=>prior.nearby[id]&&!moved(prior.nearby[id],p));
  if(prior&&prior.link===leg.link.id&&prior.blocker===who&&prior.epoch===sp.epoch&&samePeople&&!moved(prior.at,a.pose.p)&&!moved(prior.other,other.pose.p))return;
  if(!takeReplan(rt,false))return;
  ex.linkYield={link:leg.link.id,blocker:who,epoch:sp.epoch,at:[...a.pose.p],other:[...other.pose.p],nearby};
  const radius=walker.profile.radius,need=radius+ex.profile.radius+.1,geo=linkGeometry(leg);
  // Clear the whole flight, not only the climber's present centre. Vertical
  // weighting matches the existing stair-person separation; no level snap.
  const clearFlight=(q:Vec2)=>geo.path.slice(1).every((p,i)=>{
    const start=geo.path[i],dx=p[0]-start[0],dy=(p[1]-start[1])*.5,dz=p[2]-start[2],n=dx*dx+dy*dy+dz*dz;
    const qx=q[0]-start[0],qy=(floorY-start[1])*.5,qz=q[1]-start[2],t=n?clamp((qx*dx+qy*dy+qz*dz)/n,0,1):0;
    return hypot(qx-t*dx,qy-t*dy,qz-t*dz)>=need;
  });
  const away=norm2(sub2(from,[a.pose.p[0],a.pose.p[2]])),base=len2(away)>0?away:[1,0] as Vec2;
  let spot:Vec2|undefined;
  // A narrow landing can have a genuine sub-metre pocket while all of the
  // older 1.2m+ make-way candidates lie beyond its floor. Search remains finite.
  for(const distance of [.4,.6,.8,1,1.2,1.6]){
    for(let k=0;k<16;k++){
      const q=add2(from,scale2(rot2(base,k*Math.PI/8),distance)),floor=sp.levelAt(level,q);
      const y=level===0&&sp.ground?sp.ground.standY(...q):floor?.y;
      if(!floor||y===undefined||Math.abs(y-floorY)>.03||clearanceAt(floor,q)<radius+PLAN_MARGIN||occupant(rt,other,q,radius+.1)||!clearFlight(q)||!stepAwayClear(rt,other,from,q))continue;
      spot=q;break;
    }
    if(spot)break;
  }
  if(!spot)return;
  const around=[{id:a.id,p:[a.pose.p[0],a.pose.p[2]] as Vec2}],route=sp.routeAround(rt.world,walker.profile,{level,p:from},{level,p:spot},around);
  if(!route.ok||route.route.length>3||route.route.legs.some(l=>l.kind!=='walk'||l.level!==level))return;
  // The existing faceoff detour leaves the contended passage without queuing
  // on it; static and body collision checks still apply to every actual step.
  walker.detour={spot,level,by:a.id,blockers:[a.id],landing:{y:floorY,radius:need},stage:'pending',faceoff:true,egress:true,planned:{epoch:sp.epoch,route:route.route,around}};
}

type LinkGeometry = { entry: LinkLeg['link']['from']; exit: LinkLeg['link']['from']; path: [number, number, number][]; lens: number[]; total: number };

/** Continuous traversal path of a link leg: from the standing entry point, along the steps, to the exit point (no end snaps). */
function linkGeometry(leg: LinkLeg): LinkGeometry {
  const link = leg.link;
  const entry = leg.ascending ? link.from : link.to, exit = leg.ascending ? link.to : link.from;
  const steps = leg.ascending ? link.path : [...link.path].reverse();
  const path: [number, number, number][] = [[entry.p[0], entry.y, entry.p[1]], ...steps, [exit.p[0], exit.y, exit.p[1]]];
  const lens = path.slice(1).map((q, i) => hypot(q[0] - path[i][0], q[1] - path[i][1], q[2] - path[i][2]));
  return { entry, exit, path, lens, total: lens.reduce((s, x) => s + x, 0) };
}

/** Horizontal heading of the link path at distance `at` (the next segment that moves sideways), or `fallback`. */
function alongYaw(g: LinkGeometry, at: number, fallback: number): number {
  let d = at, i = 0;
  while (i < g.lens.length - 1 && d > g.lens[i]) { d -= g.lens[i]; i++; }
  for (; i < g.lens.length; i++) {
    const P = g.path[i], Q = g.path[i + 1];
    if (Q && hypot(Q[0] - P[0], Q[2] - P[2]) > 1e-3) return heading([Q[0] - P[0], Q[2] - P[2]]);
  }
  return fallback;
}

function pointOnLink(g: LinkGeometry, at: number): [number, number, number] {
  let d = at, i = 0;
  while (i < g.lens.length - 1 && d > g.lens[i]) { d -= g.lens[i]; i++; }
  const t = g.lens[i] ? clamp(d / g.lens[i], 0, 1) : 1;
  const P = g.path[i], Q = g.path[i + 1] ?? g.path[i];
  return [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t];
}

/**
 * Deferred cancel on a stair (review M2): continue (or back down) the flight at climbing speed to the
 * nearer landing, keep facing the stair, then stand there on that landing's level and complete (the
 * runtime records the action as `cancelled`). Waits, rather than passes through, anyone in the way.
 */
function stepLinkCancel(rt: Runtime, ex: Exec, a: Entity, leg: LinkLeg, dt: number): StepResult {
  const geo = linkGeometry(leg);
  const forward = ex.cancelTo === 'exit';
  const landing = forward ? geo.exit : geo.entry;
  const sp = spatial(rt,ex.actor), grid = sp.level(landing.level);
  const supported = sp.scene.surfaces.some((s) => s.level === landing.level && Math.abs(s.y - landing.y) <= 1e-6 && pointInObb(landing.p, s.obb));
  if (!supported || !grid || clearanceAt(grid, landing.p) < ex.profile.radius) {
    a.human!.activity = 'climb-wait'; ex.v = 0;
    return { status: 'blocked', diagnostic: { code: 'route.landing-unavailable',
      message: `${ex.actor} waits on ${leg.link.id}: the cancellation ${forward ? 'exit' : 'entry'} landing has no supported clear floor`,
      subjects: [ex.actor, leg.link.id], at: [landing.p[0], landing.y, landing.p[1]] } };
  }
  const at = forward ? Math.min(geo.total, ex.climbT + CLIMB_SPEED * dt) : Math.max(0, ex.climbT - CLIMB_SPEED * dt);
  const next = pointOnLink(geo, at);
  const onStair = stairBlocker(rt, a, a.pose.p, next, ex.profile.radius);
  const atLanding = !onStair && rt.services.stairLandingClearanceV1 === true && (forward ? at >= geo.total - 1e-9 : at <= 1e-9) ? landingBlocker(rt, a, landing, ex.profile.radius) : null;
  const blocker = onStair ?? atLanding;
  // stair-landing-clearance/1: ask an idle body on the landing to step aside, clear of it (spec §17), once a second.
  if (atLanding && a.body?.family !== 'floater' && rt.tick % 20 === 0) makeWay(rt, atLanding, landing.p);
  if (blocker) {
    if(a.body?.family==='floater')makeWay(rt,blocker,[next[0],next[2]],{by:a.id,subjects:[a.id],landing:{y:rt.world.entities[blocker].pose.p[1],radius:2*ex.profile.radius+.3}});
    a.human!.activity = 'climb-wait';
    return blockedWait(rt, ex.id, ex.actor, [blocker], { code: 'traffic.person', message: `${ex.actor} (cancelled) waits on ${leg.link.id} for ${blocker} to move before stepping off at the ${forward ? 'far' : 'near'} landing`, subjects: [ex.actor, blocker, leg.link.id] });
  }
  ex.climbT = at;
  a.pose.p = next;
  a.human!.activity = leg.ascending === forward ? 'climb-up' : 'climb-down';
  if (forward ? at < geo.total - 1e-9 : at > 1e-9) return { status: 'running', phase: 'cancel-climb' };
  const end = forward ? geo.exit : geo.entry;
  a.pose.p = [end.p[0], end.y, end.p[1]];
  a.human!.level = end.level;
  releaseAll(rt, ex);
  a.human!.activity = 'idle';
  a.human!.task = undefined;
  return { status: 'completed', outputs: { cancelled: true, stoppedAt: forward ? 'exit' : 'entry', level: end.level, x: end.p[0], z: end.p[1], link: leg.link.id } };
}

/** Per-tick construction-replan budget (`services.planning.replansPerTick` overrides REPLANS_PER_TICK);
 *  `services.replanBudget` also keeps totals (replans, deferred walker-ticks, peak replans in one tick). */
export type ReplanBudget = { tick: number; used: number; peak: number; deferred: number; replans: number };
export function takeReplan(rt: Runtime, forced: boolean): boolean {
  const b = (rt.services.replanBudget ??= { tick: -1, used: 0, peak: 0, deferred: 0, replans: 0 }) as ReplanBudget;
  if (b.tick !== rt.tick) { b.tick = rt.tick; b.used = 0; }
  const max = (rt.services.planning as { replansPerTick?: number } | undefined)?.replansPerTick ?? REPLANS_PER_TICK;
  if (!forced && b.used >= max) {
    b.deferred++;
    return false;
  }
  b.used++;
  b.replans++;
  if (b.used > b.peak) b.peak = b.used;
  return true;
}

/** Whether the walker can keep following its old corridor while it waits: the next stretch it could
 *  cover in REPLAN_MAX_WAIT ticks (+0.5 m) is clear, or its current link is still usable. */
function prefixValid(rt: Runtime, ex: Exec): boolean {
  const sp = spatial(rt,ex.actor);
  const leg = ex.route.legs[ex.leg];
  if (leg.kind === 'link') return sp.scene.links.some((l) => l.id === leg.link.id && l.usable);
  const g = sp.level(leg.level);
  if (!g) return false;
  const end = Math.min(ex.total, ex.s + ex.speed * REPLAN_MAX_WAIT * DT + 0.5);
  const pts = [pointAt(ex, ex.s), ...ex.segs.filter((q) => q.s0 > ex.s && q.s0 < end).map((q) => q.a), pointAt(ex, end)];
  for (let i = 1; i < pts.length; i++) if (segmentClearance(g, pts[i - 1], pts[i]) < ex.profile.radius) return false;
  return true;
}

function remainingValid(rt: Runtime, ex: Exec): boolean {
  const sp = spatial(rt,ex.actor);
  for (let k = ex.leg; k < ex.route.legs.length; k++) {
    const leg = ex.route.legs[k];
    if (leg.kind === 'link') {
      if (!sp.scene.links.some((l) => l.id === leg.link.id && l.usable)) return false;
      continue;
    }
    const g = sp.level(leg.level);
    if (!g) return false;
    // the current leg: what the walker actually follows (the smoothed segments ahead of it)
    const pts = k === ex.leg ? [pointAt(ex, ex.s), ...ex.segs.filter((q) => q.s0 + q.len > ex.s).map((q) => q.b)] : leg.points;
    for (let i = 1; i < pts.length; i++) if (segmentClearance(g, pts[i - 1], pts[i]) < ex.profile.radius) return false;
  }
  return true;
}
