// The engine bridge (spec eden4/31 B2/B3, plan 33 §3.5, lane L9): Souls live among god-built things.
//
//  entity world ──GodMode.onCommit──▶ derive physics per changed entity ──host.enqueue('world-edit')──▶ engine fold
//  engine items (take/put by a Soul) ──afterTick──▶ trusted compiler `move` (by 'engine', not undoable) ──▶ journal + viewers
//  birth / retire ──onApplied──▶ the Soul's body entity (core/humanoid, the engine's own `h_…` id) in the entity world
//
// The derived physics is plain data in the logged event, so the engine's replay never reads the entity model.
// Fastest working path on the engine's existing structures (nav/1-style static scene re-base, CATALOG fixtures);
// the per-tile patch follows L8's tiled Spatial.
import { handReachSeconds, handReleaseSeconds, handSwingSeconds, type HandActuatorMotion } from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { menuWorldOf, type MenuWorld } from '../split/menu-world.ts';
import {CATALOG} from '../../../../mars/viewer/engine/world/catalog.ts';
import {MAX_KG_PER_CARRIER} from '../../../../mars/viewer/engine/carry/formation.ts';
import { deckRaised, railGaps, rasterOf } from '@sim/generators';
import { applyBatch, containerClaims, containerHidden, containerInside, containerOpen, obbOverlap, type Diff, type Entity, type Failure, type Op, type Result, type StoredDef, type ResidentMove, type WorldModel } from '@sim/world-compiler';
import { assetFromDef, assetIdFor, isFixtureDef, isFloatingDef, nearestSurfaceSlot, buildWorldEditPhysics, withLinkApproaches, type DefFacts, type EntityPhysicsV1, type FixtureSpecV1, type WorldEditV1 } from '@sim/engine-mars';
import { createHash } from 'node:crypto';
import type { WorldHost } from '../world.ts';
import type { LogEvent } from '@sim/protocol';
import type { EdgeLedger, FloorNear } from '../edge/ledger/ledger.ts';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import type { GodMode } from './god.ts';
import { reachProviders, seatProviders, syncProviders, usesProviders, type ReachEnd, type ReachEndpoint } from './query.ts';
import { GodNav } from './nav.ts';
import { hasStraightLandings, railRaster } from './rail-raster.ts';
import { tokenHit } from '../edge/ledger/vocabulary.ts';
import {outdoorRegionExclusions} from '../edge/ledger/region-arrival.ts';
import { doorInGap, freeDoorOpening, isDoorDef, isShut } from './doors.ts';
import { dryingOps } from './garden.ts';
import { fadingIds } from '../art/art.ts';
import { createWatering, type Watering } from './watering.ts';
import { createTea, type Tea } from './tea.ts';
import { createContactActuatorService } from './contact-actuator.ts';
import { createDoorPassage } from './door-passage.ts';
import { setWorldDaySource } from './poster-boards.ts';
import { actuatedState, keepsLeftBy, leftByOf } from './actuators.ts';
import { GodPerceive } from './perceive.ts';
import { GodPlaces, inPoly } from './places.ts';
import { GodLayers } from './layers.ts';
import { GodActivitySpots } from './activity-spots.ts';
import { GodMeals } from './meals.ts';
import { installGodRides } from './rides.ts';
import { releaseBigScratch } from '../../../../mars/viewer/engine/spatial/path.ts';
import { MAX_LEVEL_ID } from '../../../../mars/viewer/engine/spatial/types.ts';
import { pointInObb, type OBB2 } from '../../../../mars/viewer/engine/core/math.ts';
import { installWorldLore } from './world-lore.ts';
import { installHeld } from './held.ts';
import { installWorldClock } from './world-clock.ts';
import { config, KNOWN_WORLD_KEYS } from '../config.ts';
import { seatFitProblem } from '../../../../mars/viewer/engine/bodies/humanoid.ts';
import { floorPlatesOf, plateIsStep } from './floor-plates.ts';
import { isVerificationProbe } from '../verification-probe.ts';
import { planWalkouts, dropReleased, unhand, stuckWarning, type StuckResident } from './walkout.ts';
import { GodNotices } from './notices.ts';
import { MapNotices, mapChanges, mapNoticeText, nearSite, planMapNotices, type MapChange, type MapPlan, type MapResident } from './map-notices.ts';
import type { ApplyContext, WalkoutPrep } from './god.ts';
import type { BuildNotice } from './builds.ts';
import { arrivalNote } from '../arrival-placement.ts';
import { seatTopsOf } from './use-check.ts';
import { wants, wantsPrefix, type MenuFocus } from '../edge/ledger/focus.ts';
/** arrival-search/1: the upserts whose geometry (def, place, size, shape, params) differs from the before-model. */
const titleOf = (e: Entity): string | undefined => (e as Entity & {about?: {title?: string}}).about?.title;
const geometryOf = (e: Entity) => JSON.stringify([e.def, e.in, e.p, e.r, e.s, e.shape, e.anchor, e.params, e.seed]);
function shapedIds(before: WorldModel, diff: Diff): Set<string> {
  const out = new Set<string>();
  for (const e of diff.upserts) { const b = before.entities.get(e.id); if (!b || geometryOf(b) !== geometryOf(e)) out.add(e.id); }
  return out;
}
/** nav-connect/1: the shaped ids plus every door whose open/shut state the edit changed (a shut door blocks its gap, so
 *  closing one can cut a Soul off just as a wall can; opening one can make a named thing reachable again). */
function navDoorFlips(before: WorldModel, diff: Diff, shaped: Set<string>): Set<string> {
  const out = new Set(shaped), key = (e: Entity) => JSON.stringify([e.state?.open ?? null, e.state?.doors ?? null]);
  for (const e of diff.upserts) { const b = before.entities.get(e.id); if (b && key(b) !== key(e)) out.add(e.id); }
  return out;
}
/** Where a refused body placement points: people as scenery (harvest fix 'figures'). core/figure@1 has no body component,
 *  so it is never a Soul, never simulated or counted as a resident; it places like any prop. */
export const PEOPLE_AS_SCENERY = 'for people as scenery (a crowd, waiters, stallholders, a choir) place core/figure@1 instead: `place figure --at x,z --param pose=stand|walk|sit|carry|serve|wave --param hat=none|cap|sunhat|chef|scarf --param top=#hex` (one figure per placement; children --scale 0.6); it is a prop, never a resident';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Level = { id: number; y: number; label: string };
type Part = NonNullable<WorldEditV1['set'][string]>;
/** What the engine side of a MarsEngine offers the bridge (world-edit/1 methods; packages/engine-mars/src/engine.ts). */
type EngineV1 = {
  world: { tick: number; entities: Record<string, any>; entityPhysicsV1?: EntityPhysicsV1 };
  applyWorldEditV1(p: WorldEditV1): { hash: string };
  bodyUsesV1(id: string): { body: string; how: 'occupied' | 'held' } | null;
  reachV1(from: { p: Vec2; level?: number }, to: { p: Vec2; level?: number }): { ok: true; length: number; legs: number; levels: number[] } | { ok: false; code: string; message: string };
  standableNearV1(at: Vec2, level?: number, except?: string, minClear?: number, maxRing?: number): Vec2 | null;
  /** Floors (2026-10-26): where a body's feet rest at (x, z) on `level` (level 0: the terrain or a floor plate on it). */
  standYAtV1?(x: number, z: number, level?: number): number | null;
  programOf(id: string): string | null;
  godWalkoutRouteV1(id: string, to: Vec2, level?: number): boolean;
  godWalkoutLandableV1(id: string, to: Vec2, level?: number): boolean;
  walkGoalV1(id: string): { level: number; p: Vec2 } | null;
  levelsV1(): { id: number; y: number }[];
};

const EVACUATE_RETRY_TICKS = 400; // a closure walk-out the engine could not land is retried after this many ticks
/** `sent` marker for a thing a walk-out took out of a resident's hands: whatever the entity world says next (a place on
 *  the ground, or nothing: removed) differs from it, so it is always sent. */
const RELEASED = '"released"';
const SEAT_LIFT = 0.15;       // floors: a seat's thing standing this far above the sitter's floor would seat the body inside it
const GROUND_BAND = 0.35;      // a floor within this of the ground is level 0 (the engine's ground is flat at y 0 until L8's tiles)
const LEVEL_MATCH = 0.12;      // floors this close in height share an engine level
const FLOOR_NEAR = 0.6;        // levelAt: a level counts at a point within this of one of its floors (thresholds, stair heads)
/** hasFloorAt's floors of one level, bucketed by FLOOR_CELL squares (a floor in every cell its FLOOR_NEAR-grown bounding
 *  circle touches), so a point checks only the floors near it, not every floor of the level (GODLIST: levelAt per thing
 *  in the activity-spots derive). Same answer as a scan of all floors: a candidate set that contains every match. */
const FLOOR_CELL = 8;
export class FloorCells {
  private cells = new Map<string, { id: string; obb: OBB2 }[]>();
  private always: { id: string; obb: OBB2 }[] = [];
  add(id: string, obb: OBB2) {
    const f = { id, obb }, r = Math.hypot(Math.abs(obb.half[0]) + FLOOR_NEAR, Math.abs(obb.half[1]) + FLOOR_NEAR) + 1e-6;
    const x0 = Math.floor((obb.c[0] - r) / FLOOR_CELL), x1 = Math.floor((obb.c[0] + r) / FLOOR_CELL), z0 = Math.floor((obb.c[1] - r) / FLOOR_CELL), z1 = Math.floor((obb.c[1] + r) / FLOOR_CELL);
    if (![x0, x1, z0, z1].every(Number.isFinite) || (x1 - x0 + 1) * (z1 - z0 + 1) > 256) { this.always.push(f); return; }
    for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) { const key = `${i}|${k}`, l = this.cells.get(key); if (l) l.push(f); else this.cells.set(key, [f]); }
  }
  some(x: number, z: number, ok: (f: { id: string; obb: OBB2 }) => boolean): boolean {
    if (this.always.some(ok)) return true;
    if (!Number.isFinite(x) || !Number.isFinite(z)) { for (const l of this.cells.values()) if (l.some(ok)) return true; return false; }
    return this.cells.get(`${Math.floor(x / FLOOR_CELL)}|${Math.floor(z / FLOOR_CELL)}`)?.some(ok) ?? false;
  }
}
const NEAR = 60;               // capabilities: god things within this many metres
const FAR_SEAT = 250, FAR_SEATS = 6; // F2: and the nearest FAR_SEATS seats out to FAR_SEAT m (sit only)
const STORE_NEAR = 8;          // entry 42: put-in is offered for containers within this many metres of a Soul holding something
const possessive = (n: string) => `${n}${n.endsWith('s') ? "'" : "'s"}`; // "Ana's", "the bakers'"
const FACTS_NEAR = 4;          // #435: who left a kept thing is named only within here's compact-facts range (edge/perception/here.ts)
const BODY_DEF = 'core/humanoid@1';
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A helix flight (lighthouse, tower) bakes as a landing, ~17 points round the stair well and a landing; a straight
 *  flight is a 2-4 point line. The planner treats a flight as the chord between its two landings and looks for the
 *  place to stand 0.7 m back along that chord: for a helix that is inside a wall, a rail or the next flight's treads
 *  (the flight into floor 3 or 4 had no standable approach, so the floor could not be reached or left). The way on
 *  and off a helix is straight in from the well's axis, so the landings are nudged 0.2 m that way (off the first
 *  tread) and the planner is told to stand 0.7 m further in. Null for a straight flight. */
const HELIX_INSET = 0.2, HELIX_STAND = 0.7;
export function helixEnds(path: Vec2[]): { foot: Vec2; head: Vec2; stepFrom: Vec2; stepTo: Vec2 } | null {
  const n = path.length;
  if (n < 5) return null;
  const [a, b] = [path[0], path[n - 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  if (!path.some((p) => Math.abs(((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len) > 0.25)) return null;
  const into = (from: Vec2, to: Vec2, by: number): Vec2 => { const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1; return [to[0] + ((to[0] - from[0]) / d) * by, to[1] + ((to[1] - from[1]) / d) * by]; };
  const foot = into(path[1], path[0], HELIX_INSET), head = into(path[n - 2], path[n - 1], HELIX_INSET);
  return { foot, head, stepFrom: into(path[1], foot, HELIX_STAND), stepTo: into(path[n - 2], head, HELIX_STAND) };
}

export type BridgeOptions = { host: WorldHost; god: GodMode; edge?: EdgeLedger; log?: (m: string) => void; /** Highest level id levelFor hands out (default and most: MAX_LEVEL_ID; tests use fewer to reach the reuse path) */ maxLevel?: number; /** F3: new-world lore (default: any world key but eden/mars/littlemartians/toy) */ worldLore?: boolean; /** F3: the world clock from the god's time.dayTicks (default: a god world without ENABLE_LIVING_WORLD) */ worldClock?: boolean; /** B-facade: the read worker's bridge (split/read-bridge.ts): the read side only, over a GodReplica and the
 *  worker's MenuWorld (no engine listeners, no projection, no writes; acts go to main) */ read?: boolean };

/** Load lane L4: per-step ms of the bridge's tick work, the tick-ms distribution and the derived-work counters since the
 *  last line. Only built with SIM_L4_STATS=1. */
class BridgeStats {
  private steps = new Map<string, { n: number; ms: number; max: number }>();
  private lastReuse = 0;
  private last = { spatial: { pagedSyncs: 0, pagedMoved: 0, pagedChanged: 0, pagedMs: 0, gridBuilds: 0, gridMs: 0, scans: 0, scanMs: 0, trusted: 0 }, perceive: 0, spots: 0, wall: performance.now(), cpu: process.cpuUsage() };
  /** A line is due a minute of wall time after the last (ticks may run slow). */
  due(): boolean { return performance.now() - this.last.wall >= 60_000; }
  add(name: string, t0: number): number {
    const now = performance.now(), ms = now - t0; let s = this.steps.get(name); if (!s) this.steps.set(name, (s = { n: 0, ms: 0, max: 0 }));
    s.n++; s.ms += ms; if (ms > s.max) s.max = ms; return now;
  }
  line(b: EngineBridge): string {
    const sp = ((b.host.engine as unknown as { rt?: { services?: { spatial?: unknown } } }).rt?.services?.spatial as { stats?: BridgeStats['last']['spatial'] } | undefined)?.stats, now = performance.now(), cpu = process.cpuUsage();
    const wallS = (now - this.last.wall) / 1000, cpuS = ((cpu.user - this.last.cpu.user) + (cpu.system - this.last.cpu.system)) / 1e6;
    const ticks = [...b.host.tickMs].sort((x, y) => x - y), q = (f: number) => ticks.length ? Math.round(10 * ticks[Math.min(ticks.length - 1, Math.floor(f * ticks.length))]) / 10 : 0;
    const steps = [...this.steps].filter(([, v]) => v.ms >= 1).sort((x, y) => y[1].ms - x[1].ms).map(([k, v]) => `${k}=${Math.round(v.ms)}/${v.n}/${Math.round(v.max)}`).join(' ');
    const d = (k: keyof BridgeStats['last']['spatial']) => Math.round((sp?.[k] ?? 0) - this.last.spatial[k]);
    const pr = b.perceive.stats.runs - this.last.perceive, ds = b.activitySpots.stats.derives - this.last.spots;
    const out = `[l4] cpu ${(cpuS / wallS).toFixed(3)} core over ${Math.round(wallS)} s; tick p50 ${q(.5)} p99 ${q(.99)} max ${q(1)} ms (n ${ticks.length}); paged syncs ${d('pagedSyncs')} moved ${d('pagedMoved')} changed ${d('pagedChanged')} ${d('pagedMs')} ms, grids ${d('gridBuilds')} ${d('gridMs')} ms, nav scans ${d('scans')} ${d('scanMs')} ms trusted ${d('trusted')}; perceive runs ${pr} (last ${b.perceive.stats.lastIds}${b.perceive.stats.lastFull ? ' whole' : ''} ${b.perceive.stats.lastMs} ms); spots derives ${ds} (last ${b.activitySpots.stats.ms} ms); steps ms/n/max ${steps}`;
    const sites = ((b.host.engine as unknown as { rt?: { services?: { spatial?: { scanSites?: Map<string, number> | null } } } }).rt?.services?.spatial)?.scanSites;
    let extra = '';
    if (sites) {
      extra = `; scan sites ${[...sites].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(' ')}`;
      sites.clear();
      const live = (b.host.engine as unknown as { rt?: { live?: Map<string, { rec: { verb: string } }> } }).rt?.live, verbs = new Map<string, number>();
      for (const l of live?.values() ?? []) verbs.set(l.rec.verb, (verbs.get(l.rec.verb) ?? 0) + 1);
      extra += `; live ${[...verbs].map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`;
      const ents = (b.host.engine as unknown as { ents?: Record<string, unknown> }).ents;
      if (ents) {
        let t = performance.now(), k: string[] = []; for (let i = 0; i < 20; i++) k = Object.keys(ents); const keysUs = (performance.now() - t) * 50;
        t = performance.now(); for (let i = 0; i < 20; i++) { const l = new Array(k.length); for (let j = 0; j < k.length; j++) l[j] = ents[k[j]]; } const fillUs = (performance.now() - t) * 50;
        extra += `; table ${k.length} keys ${Math.round(keysUs)} us fill ${Math.round(fillUs)} us`;
        const calls = ((b.host.engine as unknown as { constructor?: { tableWriteSitesV1?: Map<string, number> | null } }).constructor)?.tableWriteSitesV1;
        if (calls) { extra += `; engine calls ${[...calls].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${k}=${v}`).join(' ')}`; calls.clear(); }

      }
    }
    const reuse = (b.host.engine as unknown as { tableReusesV1?: number }).tableReusesV1 ?? 0;
    extra += `; table reused ${reuse - this.lastReuse} steps`; this.lastReuse = reuse;
    if (sp) this.last.spatial = { ...sp }; this.last.perceive = b.perceive.stats.runs; this.last.spots = b.activitySpots.stats.derives; this.last.wall = now; this.last.cpu = cpu; this.steps.clear();
    return out + extra;
  }
}

/** B-facade: the facts of main's entity physics the bridge's listing reads, shipped to read workers. */
export type BridgePhysicsV1 = { hash: string; levels: Level[]; assets: Record<string, { slots?: { kind: string }[]; surfaceSlots?: { id: string; local?: number[] }[]; category?: string }>; /** the floors of upper levels (hasFloorAt: which level a god thing stands on) */ floors?: Record<string, { level: number; obb: OBB2 }[]> };
export const engineBridges = new WeakMap<WorldModel, EngineBridge>();

/** G1: the most a tick spends catching Souls' perception up with god edits (perceive.ts `step`). */
const PERCEIVE_SLICE_MS = Number(process.env.PERCEIVE_SLICE_MS ?? 8);
/** LOAD-CONTRACT dial (L4): background perception cadence per load level. `sliceMs` = tick-thread budget per slice,
 *  `settle` = least ticks between the starts of two background catch-ups (green 20 = the old fixed spacing). Black runs no background catch-up (a Soul's read
 *  still catches up at once through perceive.ensure, and the boot pass still runs). The radius stays 30 m at every level:
 *  it is here.ts's SIGHT_RADIUS (L3's menu-radius dial owns shrinking what a Soul sees). */
export const PERCEIVE_DIAL = {
  green: { sliceMs: PERCEIVE_SLICE_MS, settle: 20 },
  amber: { sliceMs: Math.max(1, PERCEIVE_SLICE_MS / 2), settle: 40 },
  red: { sliceMs: Math.max(1, PERCEIVE_SLICE_MS / 4), settle: 100 },
  black: { sliceMs: Math.max(1, PERCEIVE_SLICE_MS / 4), settle: Infinity },
} as const;
export type LoadLevel = keyof typeof PERCEIVE_DIAL;
/** Build notices that change nothing a Soul perceives (no step label, no closure): they never start a catch-up. */
const PERCEPTION_QUIET_BUILD = new Set<string>(['alive', 'claimed', 'released', 'taken']);
const WRITE_BACK_SLICE_MS = 8;
type WriteBackUnit = { key: string; ops: Op[]; body?: string };
type WriteBackBody = { pose: string; entity: Entity | undefined };

export class EngineBridge {
  readonly host: WorldHost; readonly god: GodMode; readonly edge?: EdgeLedger;
  /** B-facade: the read worker's bridge (BridgeOptions.read) */
  private readonly readSide: boolean;
  /** What the engine was last told, per entity (sentKey of its part's JSON: a digest, not the text), and the physics
   *  state that produced (the engine's own value once it folds the edit: entity-physics.ts buildWorldEditPhysics). */
  private sent = new Map<string, string>();
  private physics: EntityPhysicsV1 | undefined;
  private levels: Level[] = [];
  private readonly maxLevel: number;
  /** Level ids levelFor handed out during the current send (their parts are not in `sent` yet). */
  private levelsNow = new Set<number>();
  private reconciled = false;
  // Readiness observes the ordinary queue/fold; it never steps, drains or changes the projection.
  private readonly initialEngine: WorldHost['engine'];
  private projectionFailure: Error | null = null;
  private projectionDrafts = new Map<WorldEditV1, { applied: boolean }>();
  private completedTicks = 0;
  private lastProjectionFold = 0;
  private completedEdits = -1;
  private projectedEdits = -1;
  private readinessChecks = new Set<() => void>();
  private readinessQueued = false;
  private writeBackBusy = false;
  private refusedPose = new Set<string>();
  /** Bumped by every god edit and by engine edits of things other than bodies (a Soul moving a bowl), not by a body's
   *  pose: what nav and perceive re-derive on. */
  private version = 0;
  private log: (m: string) => void;
  stats = { edits: 0, entities: 0, writeBacks: 0, refusals: 0, bodies: 0, lastMs: 0 };
  /** P4: Souls walk to god-built named things (nav.ts). */
  readonly nav: GodNav;
  /** F1: god-built things Souls can see, look at and read (perceive.ts). */
  readonly perceive: GodPerceive;
  /** R4-INFO: god-built places (areas, waters, buildings and their rooms, landmarks) in the Souls' map (places.ts). */
  readonly places: GodPlaces;
  /** LAYERS: schedules, ownership, zones, relationships, economy for Souls (layers.ts). */
  readonly layers: GodLayers;
  /** G1/R8: what residents perceive about god edits (the walk-out reason; later "the god changed something near you"). */
  readonly notices: GodNotices;
  /** R8: "the god changed something near you", one per request, rate-limited per resident (map-notices.ts). */
  readonly mapNotices: MapNotices;
  /** E-life: the old worlds' activity spots, derived from what the god built (activity-spots.ts). */
  readonly activitySpots: GodActivitySpots;
  /** E-life B2: finite meals (meals.ts). */
  meals?: GodMeals;
  /** E-life B7: god balloons as native rides (rides.ts). */
  rides?: ReturnType<typeof installGodRides>;
  private godEdits = 0;
  /** G1: terrain or defs changed (nav's per-thing descriptions are re-derived). */
  private describeEpoch = 0;

  constructor(o: BridgeOptions) {
    this.host = o.host; this.god = o.god; this.edge = o.edge; this.readSide = !!o.read; const R = this.readSide; this.maxLevel = Math.min(o.maxLevel ?? MAX_LEVEL_ID, MAX_LEVEL_ID); this.log = o.log ?? ((m) => console.log(`[bridge] ${m}`));
    this.initialEngine = this.host.engine;
    engineBridges.set(this.god.model, this);
    this.nav = new GodNav({ model: this.god.model, serviceStandingPoints: () => this.activitySpots?.serviceStandingPoints(), outdoorRegionExclusions: ref => {const id = this.places.forRef(ref)?.id;return this.edge && id ? outdoorRegionExclusions(this.edge.places, id) : undefined;}, version: () => this.version, staticVersion: () => this.godEdits, engine: this.host.engine as never, levelAt: (x, z, y) => this.levelAt(x, z, y), engineOwned: (e) => this.engineOwned(e), placeOf: (ref) => (this.edge ? this.places.forRef(ref)?.id : undefined), describeStamp: () => `${this.describeEpoch}:${this.levels.length}` });
    this.layers = new GodLayers({ model: this.god.model, edge: this.edge, get engine() { return o.host.engine as never; }, living: () => this.host.living, engineAct: (ops, note) => this.god.engineAct(ops, note), placeOf: (e) => this.layerPlace(e), authoredPlaceRef: id => {
      if(!this.edge||!this.places.walkable(id))return undefined;
      const ref=(this.edge.places.byId.get(id) as {ref?:unknown}|undefined)?.ref;
      return typeof ref==='string'&&this.places.forRef(ref)?.id===id?ref:undefined;
    }, calendarPlaces: (sources) => this.calendarPlaces(sources), building: id => this.god.builds.closing(id, this.model), buildingActive: () => this.god.builds.hasClosure(), closingSites: () => this.god.builds.closingSites(), log: (m) => this.log(m) });
    (this.god as unknown as { layers?: GodLayers }).layers = this.layers;
    // P3 (E-life): places follow the god's edits, not the engine's (a carried cup, a duck, a lamp switched on move no place);
    // descriptions that list the things in a place catch up once a minute (1200 ticks)
    this.places = new GodPlaces({ model: this.god.model, nav: this.nav, edge: this.edge, publicationVersion: () => this.godEdits, version: () => `${this.godEdits}:${Math.floor(this.host.engine.world.tick / 1200)}` as never, structuralVersion: () => `${this.version}:${this.describeEpoch}:${this.levels.length}`, deferred: () => this.layerPlacesPending !== null || this.perceiveRunning || !!this.perceive?.pending(), engineOwned: (e) => this.engineOwned(e), levelAt: (x, z, y) => this.levelAt(x, z, y), log: (m) => this.log(m), layers: this.layers, readOnly: R });
    if (!R) this.god.builds.inventoryContext = () => {
      this.places.sync(true);
      return {
        occupied: id => this.seatTakers(id).length > 0,
        places: [...(this.edge?.places.byId.values() ?? [])].filter(p => p.parent !== null && !p.carrier).map(p => ({ id: p.id, name: p.name, polygon: p.polygon })),
        bodies: [...this.host.minds.values()].flatMap(m => { const b = this.engine.world.entities[m.entityId]; return b && !isVerificationProbe(m.soulId) ? [{ name: m.name, soulId: m.soulId, at: [b.pose.p[0], b.pose.p[2]] as Vec2 }] : []; }),
      };
    };
    // Soul Actions entry 32: a thing's owner for its lock, and who hears a knock on a door
    const owner=(id:string,soul:EdgeSoul)=>{const o=this.layers.ownership(id);return o?.owner?{name:this.layers.nameOf(o.owner),mine:this.layers.isOf(o.owner,soul)}:null;};
    // Entry 38: posters know the world day they went up (age on demand; no per-day pass)
    setWorldDaySource(()=>{const l=this.host.living;return l&&l.dayTicks>0?Math.floor(Math.max(0,this.host.engine.world.tick-l.origin)/l.dayTicks):0;});
    if(this.edge)this.edge.contactActuator=createContactActuatorService({model:()=>this.god.model,levelAt:(x,z,y)=>this.levelAt(x,z,y),
      clearance:(x,z,level)=>(this.host.engine as unknown as {clearanceAtV1?:(x:number,z:number,level?:number)=>number}).clearanceAtV1?.(x,z,level)??Infinity,
      body:id=>this.host.engine.world.entities[id] as never,access:(id,soul)=>this.layers.refusal(id,soul),owner,knock:(soul,id)=>this.knockHeard(soul,id),
      moreFacts:id=>this.tea?.facts(id)??null,keptNote:(box,item,soul)=>this.keptNote(box,item,soul),searchOutcome:(soul,spot,failed)=>this.searchOutcome(soul,spot,failed),
      record:(soul,id,action,params={})=>{const r=this.edge!.comms?.objects.act?.(id,soul,{action,params}) as {accepted?:boolean}|undefined;if(!r?.accepted)throw Error('switch.object-record-refused');},
      commit:(ops,note,done)=>this.god.engineAct(ops,note,done)});
    if(this.edge?.contactActuator)this.edge.doorPassage=createDoorPassage({engine:()=>this.host.engine as never,model:()=>this.god.model,contact:this.edge.contactActuator,access:(id,soul)=>this.layers.refusal(id,soul),owner});
    // Entry 34: the watering-can act (watering.ts): planned for perceive's offers, its moments committed per tick
    this.watering = createWatering({ model: this.god.model, version: () => this.version, engine: this.host.engine as never, commit: (ops, note) => this.god.engineAct(ops as never, note), log: (m) => this.log(m) });
    // Entry 43: the tea acts (tea.ts), the same way
    this.tea = createTea({ model: this.god.model, version: () => this.version, engine: this.host.engine as never, commit: (ops, note) => this.god.engineAct(ops as never, note), log: (m) => this.log(m) });
    this.perceive = new GodPerceive({ model: this.god.model, version: () => this.version, edge: this.edge, engine: this.host.engine as never, engineOwned: (e) => this.engineOwned(e), namesNear: (at, except) => this.nav.namesNear(at, except), things: () => this.nav.things(), places: this.places, levelAt: (x, z, y) => this.levelAt(x, z, y), log: (m) => this.log(m), commit: (ops, note) => this.god.engineAct(ops as never, note), layers: this.layers, watering: this.watering, tea: this.tea, claim: (id, soul) => this.claimRefusal(id, soul) });
    // L3 (server reliability): kept Soul menus read god state the ledger does not version (ownership, construction sites)
    // the bridge runs without an edge ledger too (toy/engine-only hosts): guard the ledger, not only the method
    if (!R) (this.edge as { addMenuInput?(f: () => string): void } | undefined)?.addMenuInput?.(() => `${this.version}|${this.god.builds.closingSites().map((x) => x.id).join(',')}`);
    this.god.onCommit((c) => { this.version++; if (c.diff.tiles.length || c.diff.defs.length) this.describeEpoch++; this.notePerceive([...c.diff.upserts.map((e) => e.id), ...c.diff.removes], c.diff.tiles.length > 0, c.by === 'engine' ? 'engine' : 'authored'); if (c.by !== 'engine') { this.godEdits++; this.editTick = this.host.engine.world.tick; this.onCommit(c.diff); } else if (c.diff.upserts.some(e => { const d=this.model.resolvedDef(e.def); return d?.components.opening && d.tags.includes('hand-operated'); })) { this.onCommit(c.diff); } });
    this.god.onBuild(e => { if (e.kind === 'started' || e.kind === 'resumed') this.editTick = this.host.engine.world.tick; });
    // LAYERS: "under construction (step)" is part of what an owned or scheduled thing is seen as
    // L4 (audit #8): only notices that change what a build's things are seen as (started, a new step, paused/resumed,
    // done, abandoned, closure lifted, rewound) re-derive perception; the lead's `alive` heartbeat (sent on its ordinary
    // requests) and claim hand-offs change no step and no closure, and each one forced a whole pass over ~5,000 things.
    // L4 item 5: a build event moves only the layer tags of layered things under (or just out of) a closing site; was a whole pass
    this.god.onBuild((e) => { if (!PERCEPTION_QUIET_BUILD.has(e.kind)) { const ids = this.layers.buildRetag(); if (ids.length) { this.perceive.noteRetag(ids); this.notePerceive([], false); } } });
    if (!R) this.host.listeners.push({
      afterTick: (tick, context) => { try { this.afterTickWork(tick, context?.startedAtMs); } catch (error) { this.failProjection(error); throw error; } },
      onApplied: (e) => { this.projectionApplied(e); if (e.kind === 'birth') this.bodyBorn(e.payload as { entityId: string; soulId: string; name: string }); if (e.kind === 'retire') this.bodyRetired(e.payload as { entityId: string }); },
      afterTickComplete: () => { this.completedTicks++; this.completedEdits = this.projectedEdits; this.checkProjectionSoon(); },
      onClockUnavailable: () => this.failProjection(new Error('bridge.readiness.clock-unavailable')),
      onStop: () => this.failProjection(new Error('bridge.readiness.stopped')),
    });
    reachProviders.set(this.god.model, (from, to) => this.reach(from, to));
    if (!R) syncProviders.set(this.god.model, () => { this.flush(); return this.physics?.hash === this.engine.world.entityPhysicsV1?.hash; });
    seatProviders.set(this.god.model, (id) => { const f = (this.engine as unknown as { seatOccupantsV1?: (id: string) => { slot: string; body: string }[] }).seatOccupantsV1; return f ? f.call(this.engine, id).map((x) => ({ slot: x.slot, soul: this.soulName(x.body) })) : []; });
    usesProviders.set(this.god.model, (id) => { const u = this.usesOf(id); return u ? { soul: u.soul, body: u.body, how: u.how, thing: this.model.pathOf(u.id) } : null; });
    // G1 "god rules": god edits are never refused for residents; the ones in the way are walked out (walkout.ts).
    // prepare plans on the would-be world before the commit and moves nobody, so a refused batch, a failed SQL write,
    // a preview or a receipt retry never moves a resident; apply logs and folds the planned moves after the commit,
    // before the new geometry reaches the engine, in the same request. Only body entities themselves are refused.
    this.notices = new GodNotices(this.god.db, this.host.worldId, () => this.god.now());
    this.notices.streams = () => this.edge?.comms?.streams;
    // A native mind hears a notice through the log (folded into its recent memory, deterministic on replay).
    this.notices.native = (soulId, text) => { try { void this.host.enqueue('rules', 'god:notice', { godNoticeV1: { soulId, text } }).catch(() => { /* best effort */ }); } catch { /* clock not ready */ } };
    if (!R) this.god.bodies = {
      uses: id => this.usesOne(id),
      refuse: (after, diff, ops, o) => this.protectedBody(after, diff, ops, o?.undo === true),
      prepare: (before, after, diff, _ops, o) => { if (o?.dry !== true) { try { this.arrivalShaped = shapedIds(before, diff); } catch { this.arrivalShaped = null; } this.navShaped = this.arrivalShaped && navDoorFlips(before, diff, this.arrivalShaped); this.navBefore = this.navSpots(before, [...diff.removes, ...(this.navShaped ?? diff.upserts.map(e => e.id))]); } return this.prepareWalkouts(before, after, diff, o?.dry === true); },
      apply: (moved, o) => { const late = this.applyWalkouts(moved, this.stuckPlanned.splice(0)); this.stageMapNotices(o); return late; },
      arrivalNote: diff => this.arrivalNoteFor(diff),
      navNote: (diff, said) => this.navNoteFor(diff, said),
    };
    // R8: residents near a visible map change hear of it once per request; a build near them, at start and at done.
    this.mapNotices = new MapNotices((soulId, text, place) => this.notices.notify(soulId, { text, tick: this.engine.world.tick, native: true, ...(place ? { place } : {}) }), () => this.god.now());
    if (!R) this.god.onBuild(e => this.buildNotice(e));
    this.activitySpots = new GodActivitySpots({ model: this.god.model, engine: this.host.engine as never, version: () => `${this.godEdits}|${this.engine.world.entityPhysicsV1?.hash ?? ''}`, bodies: () => this.modelBodies(), levelAt: (x, z, y) => this.levelAt(x, z, y),
      placeAt: (at, level) => this.places.placeAt(at, level), placeLocator: () => this.places.placeLocator(), prepare: () => this.places.sync(true), catchingUp: () => this.perceiveRunning || !!this.perceive?.pending(), sliced: () => !!this.host.running, placeName: (id) => this.edge?.places.byId.get(id)?.name ?? null });
    if (this.edge && !R) this.edge.spotsProvider = () => { if (!this.reconciled || this.activitySpots.pendingFirst()) return null; this.flush(); const n = this.activitySpots.stats.derives, d = this.activitySpots.data(); if (this.activitySpots.stats.derives !== n) this.logSpots(); return d; };
    if (this.edge) {
      const edge = this.edge;
      this.meals = new GodMeals({ db: this.god.db, worldId: this.host.worldId, spots: () => edge.spots, place: (id) => edge.places.byId.get(id) as never, day: () => this.layers.dayKey() });
      if (!R) edge.onReceipt((r) => { try { this.meals!.onReceipt(r); } catch (e) { this.log(`meals: ${(e as Error).message}`); } });
      if (!R) this.rides = installGodRides({ host: this.host, edge, model: this.god.model, log: (m) => this.log(m) });
    }
    if (this.edge) this.hookEdge(this.edge);
    // F3: a god thing in a Soul's hand shows as held (observe, receipts) and can be put down (held.ts)
    if (this.edge) installHeld(this.edge, { engine: this.host.engine as never, model: this.model, minds: this.host.minds });
    // F3: a god's world keeps time like the live worlds (a logged dayConfig; world-clock.ts)
    if (!R && (o.worldClock ?? (!config.livingWorld && !(KNOWN_WORLD_KEYS as readonly string[]).includes(config.worldKey)))) installWorldClock(this.host, this.god, this.log);
    // F3: a god's new world serves its constitution (or a neutral line) as lore, never Eden's (world-lore.ts)
    if (this.edge && (o.worldLore ?? !(KNOWN_WORLD_KEYS as readonly string[]).includes(config.worldKey))) installWorldLore(this.edge, this.god);
  }
  private get engine(): EngineV1 { return this.host.engine as unknown as EngineV1; }
  /** B-facade: the Soul listing (`capabilities`) reads the world through the read-only facade (split/menu-world.ts). */
  private get mw(): MenuWorld { return menuWorldOf(this.host); }
  private get model(): WorldModel { return this.god.model; }

  /** True only at a completed normal tick frontier, with every derived draft accepted by this engine.
   * Call again immediately before publishing HTTP: a model commit may occur between promise continuations. */
  initialProjectionReady(): boolean {
    if (this.projectionFailure) throw this.projectionFailure;
    if (this.host.engine !== this.initialEngine) throw new Error('bridge.readiness.engine-replaced');
    if (!this.host.clockAvailable || this.host.engineFault) throw new Error('bridge.readiness.clock-unavailable');
    if (!this.reconciled || this.pending.size || this.projectionDrafts.size ||
        this.completedTicks <= this.lastProjectionFold || this.completedEdits !== this.godEdits) return false;
    if (this.physics?.hash !== this.engine.world.entityPhysicsV1?.hash) throw new Error('bridge.readiness.physics-mismatch');
    return true;
  }

  /** Context metadata joins existing sliced maintenance; it never forces a perception pass. */
  contextReady(): boolean {
    // Named targets/access depend on published places, not the separate built-object registry.
    return this.initialProjectionReady() && this.places.hasCurrentPublication() && this.layerPlacesPending === null;
  }
  private contextDiagnosticCount = 0;
  contextReadinessState() {
    let projection = false, projectionError = false;
    try { projection = this.initialProjectionReady(); } catch { projectionError = true; }
    return { projection, projectionError, tick: this.engine.world.tick, completedTicks: this.completedTicks,
      authoredRevision: this.godEdits, completedRevision: this.completedEdits, drafts: this.projectionDrafts.size,
      physicalPending: this.pending.size, places: this.places.publicationState(), perception: this.perceive.pendingSummary(),
      perceptionRunning: this.perceiveRunning, layerPending: this.layerPlacesPending !== null };
  }
  waitForContext(o: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
    const trace = (event: string) => {
      if (process.env.SIM_CONTEXT_TIMINGS === '1' && this.contextDiagnosticCount++ < 20)
        process.stderr.write(JSON.stringify({ contextReadiness: { event, ...this.contextReadinessState() } }) + '\n');
    };
    trace('start');
    return this.waitForReadiness(() => this.contextReady(), { ...o, timeoutMs: o.timeoutMs ?? 3000 })
      .then(() => { trace('ready'); }, error => { trace(o.signal?.aborted ? 'aborted' : 'failed'); throw error; });
  }

  /** Optional boot barrier. Deadlines fail closed; they are not a delay or a source of synthetic ticks.
   * No eager promise exists, so installations that do not use this API cannot produce an unhandled rejection. */
  waitForInitialProjection(o: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
    return this.waitForReadiness(() => this.initialProjectionReady(), o);
  }
  private waitForReadiness(ready: () => boolean, o: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> {
    const timeoutMs = o.timeoutMs ?? 60_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('bridge.readiness.invalid-deadline'));
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown) => {
        this.readinessChecks.delete(check); if (timer) clearTimeout(timer);
        o.signal?.removeEventListener('abort', abort);
        if (error !== undefined) reject(error); else resolve();
      };
      const abort = () => finish(o.signal?.reason ?? new Error('bridge.readiness.aborted'));
      const check = () => { try { if (ready()) finish(); } catch (error) { finish(error); } };
      if (o.signal?.aborted) { abort(); return; }
      this.readinessChecks.add(check);
      o.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new Error('bridge.readiness.timeout')), timeoutMs);
      this.checkProjectionSoon();
    });
  }
  private watering?: Watering;
  /** Entry 43: the tea acts; read by perception for a kettle's and a cup's compact facts. */
  tea?: Tea;
  /** Entry 18: when the world day changes, gardens dry by the days passed (capped at 3; time set backwards restarts the count). */
  private gardenDay: number | null = null;
  private gardenTick(tick: number) {
    const l = this.host.living; if (!l || !(l.dayTicks > 0)) return;
    const day = Math.floor(Math.max(0, tick - l.origin) / l.dayTicks);
    // #430: the clock set back also changes how far a drawing has faded
    if (this.gardenDay !== null && day < this.gardenDay) this.noteFading(day, this.gardenDay);
    if (this.gardenDay === null || day < this.gardenDay) { this.gardenDay = day; return; }
    if (day === this.gardenDay) return;
    const days = Math.min(3, day - this.gardenDay), prev = this.gardenDay; this.gardenDay = day;
    setImmediate(() => { try { const ops = dryingOps(this.god.model, days); if (ops.length) this.god.engineAct(ops as never, `garden: ${days} day(s) of drying`, () => {}); } catch (e) { this.log(`garden drying: ${(e as Error).message}`); }
      // #430: a fading drawing's perceived line follows the world day (no edit: its age is read from its drawn day)
      this.noteFading(day, prev); });
  }
  /** #430: re-derive the perceived line of every drawing whose fade may differ between these two world days (writes nothing). */
  private noteFading(day: number, prev: number) { try { const ids = fadingIds(this.god.model, day, prev); if (ids.length) this.notePerceive(ids, false); } catch (e) { this.log(`fading: ${(e as Error).message}`); } }
  private checkProjectionSoon() {
    if (!this.readinessChecks.size || this.readinessQueued) return;
    this.readinessQueued = true;
    queueMicrotask(() => { this.readinessQueued = false; for (const check of this.readinessChecks) check(); });
  }
  private failProjection(error: unknown) {
    this.projectionFailure ??= error instanceof Error ? error : new Error(String(error));
    this.projectionDrafts.clear();
    this.checkProjectionSoon();
  }
  private projectionApplied(event: LogEvent) {
    if (event.kind !== 'world-edit') return;
    const draft = event.payload as WorldEditV1, pending = this.projectionDrafts.get(draft);
    if (!pending) return;
    if (this.host.engine !== this.initialEngine || this.engine.world.entityPhysicsV1?.hash !== draft.hash) {
      this.failProjection(new Error('bridge.readiness.projection-not-installed')); return;
    }
    pending.applied = true; this.lastProjectionFold = this.completedTicks;
  }

  // ------------------------------------------------------------------ entity world → engine

  /** Boot: tell the engine about every entity whose physics differs from what its log already holds. */
  reconcile() {
    this.reconciled = true;
    const ep = this.engine.world.entityPhysicsV1;
    // G1: shared, not cloned: a physics value is never mutated (nextEntityPhysics makes a new one), so the bridge and the
    // engine share its parts and their cached hash texts (a clone made the first edit after boot stringify every part twice)
    this.physics = ep; this.levels = ep ? structuredClone(ep.levels) : [];
    // seed `sent` from the engine's own state so only real differences are sent
    for (const [id, part] of Object.entries(ep?.byEntity ?? {})) this.sent.set(id, sentKey(JSON.stringify(normPart(part as Part))));
    for (const [id, e] of Object.entries(this.engine.world.entities)) if (e.tags?.includes('entity-world')) this.sent.set(id, sentKey(JSON.stringify(normPart({ ...(ep?.byEntity[id] ?? {}), fixture: fixtureOfEngine(e) } as Part))));
    const all = new Set<string>([...this.model.entities.keys(), ...this.sent.keys()]);
    this.send(all, 0, 'boot');
  }

  /** Commits between two ticks coalesce into one world-edit (one Spatial re-base per tick at most). */
  private pending = new Set<string>();
  private onCommit(diff: Diff) {
    if (!this.reconciled) return; // the first tick reconciles everything
    for (const e of diff.upserts) for (const id of this.model.subtree(e.id)) this.pending.add(id);
    for (const id of diff.removes) this.pending.add(id);
    // doorblock: a door put into, moved out of or taken from a wall's gate gap changes whether that gate yields to it
    if (diff.upserts.some((e) => this.doorIds.has(e.id) || this.isDoor(e)) || diff.removes.some((id) => this.doorIds.has(id))) for (const id of this.gated) this.pending.add(id);
    // terrain moved under things (pads, landforms): re-derive everything (each entity is only sent if it changed)
    if (diff.tiles.length) for (const id of this.model.entities.keys()) this.pending.add(id);
  }
  /** Send what the commits since the last tick changed (also called by tests and `reach`, so reads see the latest edit). */
  flush() { if (!this.pending.size) return; const ids = this.pending; this.pending = new Set(); this.send(ids, this.model.editSeq, 'commit'); }

  /** Derive the changed entities and enqueue one world-edit carrying exactly what differs. */
  private send(ids: Set<string>, seq: number, why: string) {
    const t0 = performance.now();
    this.doorSpotsCache = null;
    this.levelsNow.clear(); this.sendFloors = new Map(); this.sendIds = ids;
    const set: WorldEditV1['set'] = {}, assets: Record<string, unknown> = {};
    const known = this.physics?.assets ?? {};
    let linksMoved = false;
    // fixtures after everything else: a fixture names its floor's level (fixtureSpec), which a building placed in the
    // same edit allocates when its floors are derived (lane LEVELS)
    const isFixture = (id: string) => { const e = this.model.entities.get(id), d = e && this.model.resolvedDef(e.def); return !!d && isFixtureDef(d); };
    const sorted = [...ids].sort(), order = [...sorted.filter((id) => !isFixture(id)), ...sorted.filter(isFixture)];
    for (const id of order) {
      const e = this.model.entities.get(id);
      if (e && this.engineOwned(e)) continue;            // bodies and what they carry belong to the engine
      const part = e ? this.derive(e, assets, known) : null;
      for (const f of part?.surfaces ?? []) if (f.level) { const a = this.sendFloors.get(f.level) ?? []; a.push(f.obb); this.sendFloors.set(f.level, a); }
      const key = part ? sentKey(JSON.stringify(normPart(part))) : null;
      // A removed thing the engine still has (one a Soul held when it went: `sent` forgot it) is removed there too.
      const lingering = !e && (this.engine.world.entities[id]?.tags?.includes('entity-world') || !!this.physics?.byEntity[id]);
      if ((this.sent.get(id) ?? null) === key && !lingering) continue;
      if (this.sent.get(id)?.startsWith('L') || part?.links?.length) linksMoved = true;
      set[id] = part;
      if (key) this.sent.set(id, key); else this.sent.delete(id);
    }
    // a raised deck opens its rails where a stair, ramp or ladder of another thing lands on it (deckAccess): when any link
    // came, went or moved, every raised deck is derived again (only the changed ones are sent)
    if (linksMoved) for (const e of this.model.entities.values()) {
      if (set[e.id] !== undefined || !this.isRaisedDeck(e)) continue;
      const part = this.derive(e, assets, known), key = part ? sentKey(JSON.stringify(normPart(part))) : null;
      if ((this.sent.get(e.id) ?? null) === key) continue;
      set[e.id] = part;
      if (key) this.sent.set(e.id, key); else this.sent.delete(e.id);
    }
    this.sendIds = null;
    if (!Object.keys(set).length) return;
    const draft: WorldEditV1 = { contract: 'world-edit/1', seq, hash: '', levels: structuredClone(this.levels), set, ...(Object.keys(assets).length ? { assets } : {}) };
    this.physics = buildWorldEditPhysics(this.physics, draft);
    draft.hash = this.physics.hash;
    this.stats.edits++; this.stats.entities += Object.keys(set).length; this.stats.lastMs = Math.round((performance.now() - t0) * 10) / 10;
    const acceptance = { applied: false };
    this.projectionDrafts.set(draft, acceptance);
    try {
      void this.host.enqueue('world-edit', 'god', draft).then(event => {
        this.projectionDrafts.delete(draft);
        if (event.payload !== draft || !acceptance.applied || this.host.engine !== this.initialEngine) {
          this.failProjection(new Error('bridge.readiness.draft-not-accepted')); return;
        }
        this.checkProjectionSoon();
      }, err => {
        this.projectionDrafts.delete(draft);
        this.failProjection(err); this.log(`world-edit ${seq} not logged: ${err?.message ?? err}`);
      });
    } catch (error) { this.failProjection(error); throw error; }
    if (why !== 'commit' || Object.keys(set).length > 8) this.log(`${why}: world-edit seq ${seq}, ${Object.keys(set).length} entities, ${this.stats.lastMs} ms`);
  }

  /** A body entity, or anything whose ancestor is a body (a carried bowl): the engine owns its physical state. */
  private engineOwned(e: Entity): boolean {
    for (let cur: Entity | undefined = e; cur; cur = cur.in.parent === 'world' ? undefined : this.model.entities.get(cur.in.parent)) if (this.model.resolvedDef(cur.def)?.components.body) return true;
    return false;
  }

  /** Level id for a floor at world height y (allocated in height order of first appearance, logged in the event). */
  private levelFor(y: number, at?: Vec2): number {
    // level 0 is the ground itself: a floor within the band of the terrain under it (L8 makes level 0 follow the tiles)
    const ground = at ? this.model.terrain.sample(at[0], at[1]) : 0;
    if (Math.abs(y - ground) <= GROUND_BAND) return 0;
    const hit = this.levels.find((l) => Math.abs(l.y - y) <= LEVEL_MATCH);
    if (hit) { this.levelsNow.add(hit.id); return hit.id; }
    const used = new Set(this.levels.map((l) => l.id));
    let id = 1; while (used.has(id) && id < this.maxLevel) id++;
    const level = { id, y: r3(y), label: `floor at ${r3(y)} m` };
    if (used.has(id)) {
      // out of level ids: reuse one nothing stands on any more (its floors, stairs and Souls all gone: a removed building's
      // storeys), else the nearest. Levels are never dropped otherwise, so without this a world that rebuilt a few
      // multi-storey houses on a hill ran out of ids and a new upper floor shared a level at another height: its rooms
      // got no standing room (lane STACK, 2026-10-21: the door sweep's apartment-block after a lighthouse and a house).
      const live = this.levelsInUse(), i = this.levels.findIndex((l) => !live.has(l.id));
      if (i < 0) return this.levels.reduce((b, l) => (Math.abs(l.y - y) < Math.abs(b.y - y) ? l : b)).id;
      level.id = this.levels[i].id; this.levels.splice(i, 1);
      this.describeEpoch++;   // a description that placed something on the old level by height is stale
    }
    this.levels.push(level); this.levelsNow.add(level.id);
    return level.id;
  }
  /** Level ids still in use: by a part the engine holds (surfaces, link ends), one derived in this send, or a Soul. */
  private levelsInUse(): Set<number> {
    const live = new Set(this.levelsNow);
    for (const key of this.sent.values()) { const bar = key.indexOf('|'); if (bar > 1) for (const n of key.slice(1, bar).split(',')) live.add(Number(n)); }
    for (const e of Object.values(this.engine.world.entities) as { human?: { level?: number } }[]) if (e.human?.level) live.add(e.human.level);
    return live;
  }

  /** doorblock: door entities (ids), walls/fences with gates (re-derived when a door comes or goes), door spots per send. */
  private doorIds = new Set<string>();
  private gated = new Set<string>();
  private doorSpotsCache: { id: string; p: Vec2 }[] | null = null;
  private isDoor(e: Entity): boolean { const d = this.model.resolvedDef(e.def); return !!d && isDoorDef(d); }
  private doorSpots(): { id: string; p: Vec2 }[] {
    if (this.doorSpotsCache) return this.doorSpotsCache;
    const out: { id: string; p: Vec2 }[] = [];
    for (const e of this.model.entities.values()) { if (!this.isDoor(e)) continue; const wp = this.model.worldPose(e); out.push({ id: e.id, p: [wp.x, wp.z] }); }
    return (this.doorSpotsCache = out);
  }

  /** The engine physics of one entity: its solids, floors and stairs, or its fixture registration. */
  derive(e: Entity, assets: Record<string, unknown>, known: Record<string, unknown>): Part | null {
    const def = this.model.resolvedDef(e.def); if (!def) return null;
    const baked = this.model.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
    const wp = this.model.worldPose(e);
    // path/area forms at the root carry world-frame geometry (L3): heights ground-relative unless `abs`
    const worldFrame = def.form !== 'point' && e.in.parent === 'world';
    const toWorld = (x: number, z: number): Vec2 => { if (worldFrame) return [r3(x), r3(z)]; const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return [r3(wp.x + (x * c + z * s) * wp.s), r3(wp.z + (-x * s + z * c) * wp.s)]; };
    const heightAt = (y: number, at: Vec2, abs?: boolean) => r3(worldFrame ? (abs ? y : this.model.terrain.sample(at[0], at[1]) + y) : wp.y + y * wp.s);
    const part: Part = {};
    const walkableKit = def.make.kind === 'gen' && def.make.gen === 'kit/2' && !!def.make.args?.footprint; // XP5 hook
    if (isFixtureDef(def)) {
      const facts = factsOf(def, baked, wp.s);
      // a floating boat's asset carries no obstacle (catalog-adapter isFloatingDef): a new id, so worlds that registered
      // the old one (an obstacle) are sent the new one
      const aid = assetIdFor(facts, JSON.stringify(e.params ?? {}) + (isFloatingDef(def) ? '|afloat' : '') + (walkableKit ? '|ground-kit/1' : ''));
      if (!known[aid] && !assets[aid]) { const asset = assetFromDef(aid, facts); if (walkableKit) { delete asset.obstacle; asset.seatApproach = 'slot'; for (const slot of asset.slots ?? []) delete slot.approachPolicy; } assets[aid] = asset; } // XP5: seats retain slots; kit solids supply the obstacle geometry. Their exact slot approach stays (lane walk's
      // reachable/1 sweep would cross the kit's own solids).
      part.fixture = this.fixtureSpec(e, def, aid, (assets[aid] ?? known[aid]) as any, wp);
      if (!walkableKit) return part;
    }
    // solids: wall segments and blocks (solid layer only; a def's own stair treads are walked by its links)
    if ((def.layer === 'solid' || def.layer === 'surface') && baked.colliders.length) {
      const fp = this.model.footprint(e, def);
      const solids = fp.map((o, i) => ({ o, local: baked.colliders[i] })).filter(({ local }) => !(baked.links?.some(l => !l.id.startsWith('mesh-step:')) && local.y1 - local.y0 <= 0.5));
      // E-life B7: a god balloon is depiction; its body on the ground is the native ride installed at its spot (rides.ts)
      const nativeRide = !!(def.components as Record<string, unknown>).carrier && def.tags.includes('balloon');
      // door-raster/1 (lane RT): a building/1 wall piece at least a raster cell thick rasters by its cell centres, so its
      // doorways keep their width on the walk raster at any yaw (spatial/types.ts Obstacle.raster)
      if (solids.length && !nativeRide) part.solids = solids.flatMap(({ o, local }, i) => {
        const obb: OBB2 = { c: [r3(o.c[0]), r3(o.c[1])], half: [r3(o.half[0]), r3(o.half[1])], yaw: r3(-o.yaw) };
        // YAW: the rail's middle uses a cell-thick padded solid; original end caps keep conservative corner safety.
        const rails = local.tag === 'rail' && hasStraightLandings(baked.links) && local.y0 > 0.5 ? railRaster(obb) : null;
        const pieces = rails ?? [{ obb, ...(rasterOf({ tag: local.tag, half: o.half }) === 'centre' ? { raster: 'centre' as const } : {}) }];
        return pieces.map((piece, k) => ({ id: `${e.id}#c${i}${k ? `-end${k}` : ''}`, ...piece, y0: r3(o.y0), y1: r3(o.y1), kind: 'fixture' as const, label: `${this.model.pathOf(e.id)}${local.tag ? ' ' + local.tag : ''}`.slice(0, 100) }));
      });
    }
    // closed doors block their gap; a free-standing door (no doorway of its own) blocks its own width (doorblock)
    const doorState = (e.state?.doors ?? {}) as Record<string, unknown>;
    if (isDoorDef(def)) this.doorIds.add(e.id); else this.doorIds.delete(e.id);
    const free = freeDoorOpening(def, baked), openings = free ? [...(baked.openings ?? []), free] : baked.openings ?? [];
    const gates = worldFrame ? openings.filter((o) => o.kind === 'gate') : [];
    if (gates.length) this.gated.add(e.id); else this.gated.delete(e.id);
    const shut = isShut(e, def);
    for (const o of openings) {
      // a wall's or fence's gate with a door standing in it yields to the door (the door blocks or passes by its state)
      if (worldFrame && o.kind === 'gate' && doorInGap(toWorld(o.at[0], o.at[1]), o.width, this.doorSpots())) continue;
      const closed = doorState[o.id] === 'closed' || (doorState[o.id] === undefined && o.state === 'closed') || shut;
      if (!closed) continue;
      // a gate of a world-frame wall/fence sits on the ground under it (sill and height are ground-relative)
      const c = toWorld(o.at[0], o.at[1]), sc = worldFrame ? 1 : wp.s;
      (part.solids ??= []).push({ id: `${e.id}#door:${o.id}`, obb: { c, half: [r3((o.width / 2) * sc), r3(0.08 * sc)], yaw: r3(-((worldFrame ? 0 : wp.yaw) + o.yaw)) }, y0: heightAt(o.sill ?? 0, c), y1: heightAt((o.sill ?? 0) + o.height, c), kind: 'fixture' as const, label: `${this.model.pathOf(e.id)} ${o.id} (closed)` });
    }
    // floors: polygons → oriented rectangles on levels
    const surfaces = [...(baked.surfaces ?? [])];
    // floors (2026-10-26): a mesh def's measured floor plates (floor-plates.ts: the Chiba deck), walked onto as a step
    const plates = new Set<object>();
    if (!worldFrame && def.make.kind === 'mesh') for (const f of floorPlatesOf(def.name, def.make.asset)) { const s = { level: 0, y: f.y, polygon: f.polygon, tag: f.id }; plates.add(s); surfaces.push(s); }
    if (!surfaces.length && def.components.floor) { const [w, , d] = baked.box; surfaces.push({ level: 0, y: def.components.floor.y ?? baked.box[1], polygon: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] }); }
    // ground cover (roads, lawns, plazas: ground-relative level-0 surfaces of world-frame shapes) is the ground itself
    const floors = surfaces.filter((x) => !(worldFrame && !(x as { abs?: boolean }).abs && x.level === 0));
    const raisedDeck = this.isRaisedDeck(e, def);
    // a building's ground storey is the ground's level when it lies within the generous band of the terrain (as levelAt
    // reads the things in it), its stair feet with it: one sunk 0.37 m below a hillside's terrain (cliff-house-4/-18 in a
    // fresh Eden 2026) was an upper level of its own that no door or stair reached (lane LEVELS)
    const g0 = !worldFrame && def.make.kind === 'gen' && def.make.gen === 'building/1' ? surfaces.find((x) => x.level === 0) : undefined;
    const c0 = g0 ? (() => { const r = rectOf(g0.polygon); return toWorld(r.c[0], r.c[1]); })() : undefined;
    const groundY = g0 && c0 && Math.abs(heightAt(g0.y, c0) - this.model.terrain.sample(c0[0], c0[1])) <= GROUND_BAND + 0.5 ? heightAt(g0.y, c0) : undefined;
    const levelOn = (y: number, at: Vec2) => (groundY !== undefined && Math.abs(y - groundY) <= LEVEL_MATCH ? 0 : this.levelFor(y, at));
    // a floor plate within a step of the terrain under it is the ground's level (GroundNav.standY stands every body on it)
    const plateLevel = (y: number, at: Vec2) => (plateIsStep(y, this.model.terrain.sample(at[0], at[1])) ? 0 : this.levelFor(y, at));
    if (floors.length) part.surfaces = floors.map((s, i) => {
      const r = rectOf(s.polygon), abs = (s as { abs?: boolean }).abs;
      const c = toWorld(r.c[0], r.c[1]), y = heightAt(s.y, c, abs);
      // decks and bridges of world-frame shapes are walked from the ground: level 0 at their own height (L8 slabs); a
      // raised deck (deck/1 with rails, DECK_RAISED up) is an upper floor of its own that stairs, ramps and ladders reach
      const level = worldFrame && abs && s.level === 0 && !raisedDeck ? 0 : (plates.has(s) || s.tag?.startsWith('mesh-floor:')) ? plateLevel(y, c) : levelOn(y, c);
      const sc = worldFrame ? 1 : wp.s, yaw = worldFrame ? r.yaw : wp.yaw + r.yaw;
      // Level 0 describes connectivity, not elevation: retain the top of a low slab.
      return { id: `${e.id}#f${i}`, level, y, obb: { c, half: [r3(r.half[0] * sc), r3(r.half[1] * sc)] as Vec2, yaw: r3(-yaw) }, label: `${this.model.pathOf(e.id)} ${s.tag ?? 'floor'}`.slice(0, 100) };
    });
    // doorways of upper storeys: the wall's thickness has no floor polygon under it, so lay a threshold strip
    for (const o of baked.openings ?? []) {
      if (o.kind === 'window' || worldFrame) continue;
      const storey = surfaces.filter((x) => x.level === o.level);
      if (!o.level || !storey.length) continue;
      const c = toWorld(o.at[0], o.at[1]), y = heightAt(storey[0].y, c), level = levelOn(y, c);
      if (level === 0) continue;
      (part.surfaces ??= []).push({ id: `${e.id}#t:${o.id}`, level, y, obb: { c, half: [r3((o.width / 2) * wp.s), r3(0.3 * wp.s)], yaw: r3(-(wp.yaw + o.yaw)) }, label: `${this.model.pathOf(e.id)} ${o.id} threshold`.slice(0, 100) });
    }
    // stairs, ramps, ladders: links between levels
    if (baked.links?.length) part.links = baked.links.filter((l) => l.path.length >= 2).map((l) => {
      const helix = helixEnds(l.path);
      const a = toWorld(...(helix?.foot ?? l.path[0])), b = toWorld(...(helix?.head ?? l.path[l.path.length - 1]));
      const ya = heightAt(l.y0, a), yb = heightAt(l.y1, b);
      const n = Math.max(2, Math.ceil(Math.abs(yb - ya) / 0.18) + 1), path: [number, number, number][] = [];
      for (let k = 0; k < n; k++) { const t = k / (n - 1); path.push([r3(a[0] + (b[0] - a[0]) * t), r3(ya + (yb - ya) * t), r3(a[1] + (b[1] - a[1]) * t)]); }
      const kind = l.kind === 'float' ? 'climb' : l.kind;
      const linkLevel = l.id.startsWith('mesh-step:') ? plateLevel : levelOn;
      const la = linkLevel(ya, a), lb = linkLevel(yb, b);
      return { id: `${e.id}#${l.id}`, kind: kind as 'stairs' | 'ramp' | 'ladder' | 'climb', from: { level: la, p: a, y: ya }, to: { level: lb, p: b, y: yb }, width: r3(l.width * wp.s), heading: r3(Math.atan2(b[1] - a[1], b[0] - a[0])), path, usable: true,
        ...(helix ? { approach: { from: toWorld(...helix.stepFrom), to: toWorld(...helix.stepTo) } } : {}) };
    });
    // each flight's ends: its under-stair block stops short of the foot (the first tread is stepped onto, not walked
    // under) and a head tread on the upper level bridges the stairwell edge, so both ends have standing room
    for (const l of part.links ?? []) {
      if (l.kind !== 'stairs' && l.kind !== 'ramp') continue;
      const lid = l.id.slice(e.id.length + 1), d: Vec2 = [Math.cos(l.heading), Math.sin(l.heading)], T = 0.4;
      for (const o of part.solids ?? []) {
        if (!o.label?.endsWith(` stairs:${lid}`)) continue;
        const along = Math.abs(Math.cos(o.obb.yaw - l.heading)) > 0.7 ? 0 : 1;
        if (o.obb.half[along] <= T) continue;
        o.obb.half[along] = r3(o.obb.half[along] - T / 2); o.obb.c = [r3(o.obb.c[0] + d[0] * T / 2), r3(o.obb.c[1] + d[1] * T / 2)];
      }
      if (l.to.level > 0) (part.surfaces ??= []).push({ id: `${l.id}:head`, level: l.to.level, y: l.to.y, obb: { c: [r3(l.to.p[0] - d[0] * 0.25), r3(l.to.p[1] - d[1] * 0.25)], half: [0.35, r3(l.width / 2)], yaw: l.heading }, label: `${this.model.pathOf(e.id)} ${lid} head`.slice(0, 100) });
    }
    if (raisedDeck) this.deckAccess(e, part);
    // F1: a decoration (a fountain, a lamp, a sign, a statue, a house) is also a fixture Souls perceive: views list it,
    // `look` finds it. No slots and no obstacle of its own: its solids above are what blocks, exactly as before.
    if (this.seenOnly(e, def)) {
      const facts = factsOf(def, baked, wp.s), aid = assetIdFor(facts, JSON.stringify(e.params ?? {}) + '|seen');
      if (!known[aid] && !assets[aid]) assets[aid] = assetFromDef(aid, facts, { seen: true });
      part.fixture = { def: aid, kind: 'fixture', label: titleOf(e) ?? (e.name ?? def.name.replace(/^core-/, '')).replace(/-/g, ' '), p: [r3(wp.x), r3(wp.y), r3(wp.z)], yaw: r3(-wp.yaw), support: { kind: 'ground' } };
    }
    if (part.solids || part.surfaces || part.links) withLinkApproaches(part);
    // Extracted tread endpoints already sit a full body radius inside their
    // supporting patches. A generic 0.7 m run-up falls off these narrow treads.
    // Native link-edge tests still validate both endpoints against live obstacles.
    for (const l of part.links ?? []) if (l.id.includes('#mesh-step:')) l.approach = {from: l.from.p, to: l.to.p};
    return part.solids || part.surfaces || part.links || part.fixture ? part : null;
  }
  /** Floors (2026-10-26): the measured floor plates (floor-plates.ts) of placed things within `radius` of `at`, in world
   *  terms, with the sides a body can step across (clear ground 0.45 m outside and inside along ≥ 1 m of the edge). */
  floorsNear(at: Vec2, radius: number): FloorNear[] {
    const out: FloorNear[] = [], eng = this.engine as unknown as { clearanceAtV1?: (x: number, z: number, level?: number) => number }, epoch = (this.engine.world as { entityPhysicsV1?: { hash?: string } }).entityPhysicsV1?.hash ?? '';
    for (const e of this.model.entities.values()) {
      const def = this.model.resolvedDef(e.def); if (!def || def.make.kind !== 'mesh') continue;
      const plates = floorPlatesOf(def.name, def.make.asset); if (!plates.length) continue;
      const wp = this.model.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw), k = wp.s;
      const toW = (x: number, z: number): Vec2 => [wp.x + (x * c + z * s) * k, wp.z + (-x * s + z * c) * k];
      const dx = (at[0] - wp.x) / k, dz = (at[1] - wp.z) / k, lx = dx * c - dz * s, lz = dx * s + dz * c;
      for (const f of plates) {
        const xs = f.polygon.map((p) => p[0]), zs = f.polygon.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
        const d = Math.hypot(Math.max(0, x0 - lx, lx - x1), Math.max(0, z0 - lz, lz - z1)) * k; if (d > radius) continue;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, centre = toW(cx, cz), y = r3(wp.y + f.y * k), key = `${e.id}|${f.id}|${epoch}`;
        let openings = this.plateOpenings.get(key);
        if (!openings) {
          openings = [];
          const sides: [Vec2, Vec2, Vec2][] = [[[x1, z0], [x1, z1], [1, 0]], [[x0, z0], [x0, z1], [-1, 0]], [[x0, z1], [x1, z1], [0, 1]], [[x0, z0], [x1, z0], [0, -1]]];
          for (const [a, b, n] of sides) {
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.floor(len / 0.5)); let run = 0, best = 0;
            for (let i = 0; i <= steps; i++) {
              const t = i / steps, px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t, o = toW(px + n[0] * 0.45, pz + n[1] * 0.45), q = toW(px - n[0] * 0.45, pz - n[1] * 0.45);
              const clear = (eng.clearanceAtV1?.(o[0], o[1], 0) ?? 0) >= 0.3 && (eng.clearanceAtV1?.(q[0], q[1], 0) ?? 0) >= 0.3;
              run = clear ? run + len / steps : 0; best = Math.max(best, run);
            }
            if (best >= 1) openings.push([r3(n[0] * c + n[1] * s), r3(-n[0] * s + n[1] * c)]);
          }
          if (this.plateOpenings.size > 64) this.plateOpenings.clear();
          this.plateOpenings.set(key, openings);
        }
        out.push({ id: f.id, name: `the ${f.label} of ${this.model.pathOf(e.id)}`, y, rise: r3(y - this.model.terrain.sample(centre[0], centre[1])), on: d === 0, d: Math.round(d), at: [r3(centre[0]), r3(centre[1])], openings });
      }
    }
    return out.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
  }
  private plateOpenings = new Map<string, Vec2[]>();
  /** A deck/1 at the root, high enough to have rails (generators DECK_RAISED): its floor is a level of its own. */
  private isRaisedDeck(e: Entity, def = this.model.resolvedDef(e.def)): boolean {
    return !!def && def.make.kind === 'gen' && def.make.gen === 'deck/1' && def.form !== 'point' && e.in.parent === 'world' && deckRaised(e.params ?? {});
  }
  /** Stair, ramp and ladder ends of god things within `pad` metres of a world box: world point, height, width (as derive)
   *  and where the link's other end is. */
  private linkEndsNear(box: [number, number, number, number], pad: number, except: string): { p: Vec2; y: number; width: number; other: Vec2 }[] {
    const out: { p: Vec2; y: number; width: number; other: Vec2 }[] = [];
    for (const o of this.model.entities.values()) {
      if (o.id === except) continue;
      const def = this.model.resolvedDef(o.def); if (!def || this.engineOwned(o)) continue;
      const worldFrame = def.form !== 'point' && o.in.parent === 'world', wp = this.model.worldPose(o);
      if (!worldFrame && (wp.x < box[0] - pad || wp.x > box[2] + pad || wp.z < box[1] - pad || wp.z > box[3] + pad)) continue;
      let baked; try { baked = this.model.bake(def, o.params ?? {}, o.seed ?? 0, o.shape); } catch { continue; }
      if (!baked.links?.length) continue;
      const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
      const toWorld = (x: number, z: number): Vec2 => (worldFrame ? [r3(x), r3(z)] : [r3(wp.x + (x * c + z * s) * wp.s), r3(wp.z + (-x * s + z * c) * wp.s)]);
      const heightAt = (y: number, at: Vec2) => r3(worldFrame ? this.model.terrain.sample(at[0], at[1]) + y : wp.y + y * wp.s);
      for (const l of baked.links) {
        if (l.path.length < 2) continue;
        const helix = helixEnds(l.path), a = toWorld(...(helix?.foot ?? l.path[0])), b = toWorld(...(helix?.head ?? l.path[l.path.length - 1]));
        const width = r3(l.width * (worldFrame ? 1 : wp.s));
        out.push({ p: a, y: heightAt(l.y0, a), width, other: b }, { p: b, y: heightAt(l.y1, b), width, other: a });
      }
    }
    return out;
  }
  /** A raised deck is walked onto from its stairs: where another thing's stair, ramp or ladder ends at the deck's height
   *  on its edge, the rail opens for it (generators railGaps; the picture opens the same gap). A deck too low to walk
   *  under (head room under 2.1 m) is solid below its floor on the ground, so nobody is routed underneath it. */
  private deckAccess(e: Entity, part: Part) {
    const floor = part.surfaces?.find((s) => s.id === `${e.id}#f0`); if (!floor || floor.level === 0) return;
    const area = (e.shape as { area?: Vec2[] } | undefined)?.area; if (!area?.length) return;
    const xs = area.map((p) => p[0]), zs = area.map((p) => p[1]), box: [number, number, number, number] = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    // ends at the deck's height whose flight comes from off the deck (a stair starting on the deck leaves its rail alone)
    const ends = this.linkEndsNear(box, 24, e.id).filter((x) => Math.abs(x.y - floor.y) <= 0.3 && !inPoly(x.other[0], x.other[1], area));
    if (ends.length && part.solids?.length) {
      const solids: NonNullable<Part['solids']> = [];
      for (const o of part.solids) {
        if (!o.label?.endsWith(' rail')) { solids.push(o); continue; }
        const u: Vec2 = [Math.cos(o.obb.yaw), Math.sin(o.obb.yaw)], hl = o.obb.half[0];
        const a: Vec2 = [o.obb.c[0] - u[0] * hl, o.obb.c[1] - u[1] * hl], b: Vec2 = [o.obb.c[0] + u[0] * hl, o.obb.c[1] + u[1] * hl];
        const gaps = railGaps(a, b, ends);
        if (!gaps.length) { solids.push(o); continue; }
        let t = 0, k = 0;
        for (const [g0, g1] of [...gaps, [2 * hl, 2 * hl] as [number, number]]) {
          if (g0 - t > 0.05) { const m = (t + g0) / 2; solids.push({ ...o, id: `${o.id}.${k++}`, obb: { ...o.obb, c: [r3(a[0] + u[0] * m), r3(a[1] + u[1] * m)], half: [r3((g0 - t) / 2), o.obb.half[1]] } }); }
          t = g1;
        }
      }
      part.solids = solids.length ? solids : undefined;
    }
    let ground = Infinity; for (const [x, z] of [...area, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] as Vec2]) ground = Math.min(ground, this.model.terrain.sample(x, z));
    if (floor.y - ground < 2.1) (part.solids ??= []).push({ id: `${e.id}#under`, obb: structuredClone(floor.obb), y0: r3(ground - 0.5), y1: r3(floor.y - 0.1), kind: 'fixture' as const, label: `${this.model.pathOf(e.id)} under the deck`.slice(0, 100) });
  }
  /** A god-built point thing that is not otherwise an engine fixture or item, and not a creature, a body or a flag. */
  seenOnly(e: Entity, def: StoredDef): boolean {
    const c = def.components as Record<string, unknown>;
    return def.form === 'point' && !isFixtureDef(def) && !c.body && !c.behavior && !c.hover && !/^core[-/]flag@/.test(def.ref) && e.in.parent !== undefined && !this.engineOwned(e);
  }

  private fixtureSpec(e: Entity, def: StoredDef, asset: string, a: { surfaceSlots?: { id: string; local: [number, number, number] }[]; category: string }, wp: { x: number; y: number; z: number; yaw: number }): FixtureSpecV1 {
    const label = titleOf(e) ?? (e.name ?? def.name.replace(/^core-/, '')).replace(/-/g, ' ');
    const spec: FixtureSpecV1 = { def: asset, kind: a.category === 'item' ? 'item' : 'fixture', label, p: [r3(wp.x), r3(wp.y), r3(wp.z)], yaw: r3(-wp.yaw) };
    if (spec.kind !== 'item') {
      if(def.components.carryable&&def.tags.includes('upright-carry')&&Math.abs(wp.y)<.01)return {...spec,support:{kind:'ground'}};
      // E2 (2026-10-19): a fixture standing on raised ground (a hillside, an alpine terrace, or the ground floor of a
      // building on its pad up there) is logged as on the ground, so its seats are on level 0 there (the engine otherwise
      // takes the floor level nearest its height: the alpine station's benches got an upper floor elsewhere and no
      // resident could reach them). Only those: fixtures on the y-0 plain, and upper floors, keep their spec byte for byte.
      if (Math.abs(wp.y) > GROUND_BAND && Math.abs(wp.y - this.model.terrain.sample(wp.x, wp.z)) <= GROUND_BAND) return { ...spec, support: { kind: 'ground' } };
      // lane LEVELS (2026-10-21): a fixture on an upper floor names that floor's level, the one levelFor gave the floor (the
      // engine otherwise takes the level nearest its height, which can be another building's floor 0.03 m nearer)
      // no floor of its height here: the ground's level, said so when the nearest-height rule could pick another
      const level = this.levels.find((l) => Math.abs(l.y - wp.y) <= LEVEL_MATCH && this.hasFloorAt(l.id, wp.x, wp.z))?.id ?? (Math.abs(wp.y) > GROUND_BAND ? 0 : undefined);
      return level !== undefined ? { ...spec, level } : spec;
    }
    const parent = e.in.parent !== 'world' ? this.model.entities.get(e.in.parent) : undefined;
    const pdef = parent ? this.model.resolvedDef(parent.def) : undefined;
    if (parent && pdef && isFixtureDef(pdef)) {
      const pfacts = factsOf(pdef, this.model.bake(pdef, parent.params ?? {}, parent.seed ?? 0, parent.shape), this.model.worldPose(parent).s);
      const passet = assetFromDef(assetIdFor(pfacts, JSON.stringify(parent.params ?? {})), pfacts);
      const pp = this.model.worldPose(parent), c = Math.cos(pp.yaw), s = Math.sin(pp.yaw), dx = wp.x - pp.x, dz = wp.z - pp.z;
      const local: [number, number, number] = [dx * c - dz * s, wp.y - pp.y, dx * s + dz * c];
      const slot = nearestSurfaceSlot(passet, local);
      if (slot) {
        const sl = passet.surfaceSlots!.find((x) => x.id === slot)!;
        const wx = pp.x + sl.local[0] * c + sl.local[2] * s, wz = pp.z - sl.local[0] * s + sl.local[2] * c;
        return { ...spec, p: [r3(wx), r3(pp.y + sl.local[1]), r3(wz)], support: { kind: 'resting-on', on: parent.id, slot } };
      }
    }
    return { ...spec, support: { kind: 'ground' } };
  }

  /** R4-INFO: a god edit can close furniture round a Soul standing in a room (a house turned to face a moved fountain,
   *  a sofa moved): from where it stands no walk reaches the room's door any more, so every act refuses
   *  route.unreachable. Once the edit is in the engine, each idle Soul standing in a room it cannot leave steps to the
   *  room's open floor (the standing room its front door reaches; nav.ts roomGoal) — a logged edge-relocate, as the
   *  ledger steps bodies out of solids. Only after god edits, only Souls inside rooms. */
  private editTick = -1;
  private rescued = -1;
  rescueTrapped() {
    this.rescued = this.editTick;
    const E = this.engine as EngineV1 & { world: { entities: Record<string, any> } };
    const rooms = this.nav.things().filter((t) => t.kind === 'room' && t.level === 0 && t.poly && t.entry);
    if (!rooms.length) return;
    for (const m of this.host.minds.values()) {
      const b = E.world.entities[m.entityId], h = b?.human;
      if (!h || (h.level ?? 0) !== 0 || h.activity === 'sit' || h.baseActivity === 'sit' || h.sleepPose || h.carrier || E.programOf(m.entityId)) continue;
      const p: Vec2 = [b.pose.p[0], b.pose.p[2]], room = rooms.find((t) => inPoly(p[0], p[1], t.poly!)); if (!room) continue;
      if (E.reachV1({ p, level: 0 }, { p: room.entry!.p, level: room.entry!.level }).ok) continue;
      const goal = this.nav.goal(room, p, m.entityId); if (!goal || goal.level !== 0) continue;
      this.log(`${m.name} was closed in by furniture in ${room.ref}: steps to open floor at (${goal.p.join(', ')})`);
      try { void this.host.enqueue('edge-relocate', `edge:${m.soulId}`, { soulId: m.soulId, entityId: m.entityId, to: goal.p, why: `the god rearranged ${room.ref} around them: stepped to open floor` }).catch(() => { /* best effort */ }); } catch { /* clock not ready */ }
    }
  }

  /** The bridge's per-tick work (each step on its own cadence). With SIM_L4_STATS=1 every step is timed and one
   *  `[l4] …` line a minute says where the tick thread went (load lane L4 measurements; off: no clock reads). */
  private afterTickWork(tick: number, startedAtMs?: number) {
    // Soul Actions (entries 18, 34): garden drying and the watering can's per-tick moments run before the projection
    this.gardenTick(tick); const moved = [...(this.watering?.tick() ?? []), ...(this.tea?.tick() ?? [])];
    if (!this.reconciled) { this.reconcile(); this.projectedEdits = this.godEdits; return; }
    const S = this.loadStats; let t = S ? performance.now() : 0;
    this.flush(); this.projectedEdits = this.godEdits; for (const id of moved) this.writeBackNow(id); if (S) t = S.add('flush', t);
    if (tick % 10 === 0 || this.writeBackPass) { this.writeBack(WRITE_BACK_SLICE_MS); if (S) t = S.add('writeBack', t); }
    this.perceiveStep(tick); if (S) t = S.add('perceive', t);
    if (tick % 5 === 4 || this.activitySpots.deriving()) { this.spotsStep(); if (S) t = S.add('spots', t); }
    if (tick % 40 === 7 || this.layerPlacesPending !== null) { this.layersStep(tick % 40 === 7); if (S) t = S.add('layers', t); }
    if (tick % 20 === 13) { this.flushMapNotices(); if (S) t = S.add('mapNotices', t); }
    if (!this.navWarm || this.navPending) { this.navStep(startedAtMs); if (S) t = S.add('nav', t); }
    if (this.evacuatedEdit !== this.editTick && tick - this.editTick >= 10) { this.evacuatedEdit = this.editTick; this.evacuateSites(); if (S) t = S.add('evacuate', t); }
    if (this.rescued !== this.editTick && tick - this.editTick >= 10 && (tick - this.editTick >= 20 || tick - this.rescuedAt >= 40)) { this.rescuedAt = tick; this.rescueTrapped(); if (S) t = S.add('rescue', t); }
    if (S && S.due()) this.log(S.line(this));
  }
  private loadStats = process.env.SIM_L4_STATS === '1' ? new BridgeStats() : null;
  private perceiveSync(now = false) { try { if (now) this.perceive.sync(); else this.perceive.ensure(); } catch (e) { this.log(`perceive: ${(e as Error).message}`); } }
  /** G1 (tranche 2026-10-19): what Souls perceive of god edits (built objects, the places layer) catches up off the
   *  request path. An edit only notes what changed; the catch-up starts a second after the last edit, or ~2 s after the
   *  first one not yet seen while a god keeps editing, and then runs a slice of at most PERCEIVE_SLICE_MS per tick
   *  (was: a whole pass, ~0.7 s at 4,900 entities, inside the tick after every edit). Souls see an edit ≤ ~2 s late. */
  private perceiveFirst = 0;
  private perceiveLast = 0;
  private perceiveRunning = false;
  /** Tick the last catch-up began (at most one start a second; a world without comms objects retries at that pace). */
  private perceiveStarted = -Infinity;
  /** G1: a trapped-Soul check (it lists every named thing) runs a second after the last edit, or every ~2 s while a
   *  god keeps editing; a closing site's walk-out still follows each edit within 10 ticks. */
  private rescuedAt = -1;
  private evacuatedEdit = -1;
  private notePerceive(ids: string[], all: boolean, origin: 'authored' | 'engine' | 'other' = 'other') {
    const tick = this.host.engine.world.tick;
    this.perceive.note(ids, all, origin);
    if (this.perceiveFirst < 0) this.perceiveFirst = tick; this.perceiveLast = tick;
  }
  private perceiveDial: (typeof PERCEIVE_DIAL)[LoadLevel] = PERCEIVE_DIAL.green;
  /** LOAD-CONTRACT: the load monitor sets the level; only the perception cadence changes (PERCEIVE_DIAL). */
  setLoadLevel(level: LoadLevel) { this.perceiveDial = PERCEIVE_DIAL[level] ?? PERCEIVE_DIAL.green; }
  private perceiveStep(tick: number) {
    const dial = this.perceiveDial;
    if (!this.perceiveRunning) {
      if (!this.perceive.pending() || tick - this.perceiveStarted < 20) return;
      if (this.perceive.stats.runs && tick - this.perceiveStarted < dial.settle) return;   // amber/red/black: catch-ups start further apart
      // boot: the first catch-up is a whole pass (~0.4 s at 4,900 entities). A served world runs it in slices too (lane P5):
      // at once it held a cold-booted world's first visitor. A Soul's read before it ends catches up at once (perceive.ensure).
      // A world stepped by hand (tests, tools) runs it at once, as before.
      if (!this.perceive.stats.runs && !this.host.running) { this.perceiveStarted = tick; this.perceiveFirst = -1; this.perceiveSync(true); return; }
      if (this.perceive.stats.runs && tick - this.perceiveLast < 20 && tick - this.perceiveFirst < 40) return;
      this.perceiveRunning = true; this.perceiveStarted = tick; this.perceiveFirst = -1; this.catchUp = { slices: 0, maxMs: 0, t0: performance.now() };
    }
    const t0 = performance.now();
    try { if (this.perceive.step(dial.sliceMs)) this.perceiveRunning = false; }
    catch (e) { this.perceiveRunning = false; this.log(`perceive: ${(e as Error).message}`); }   // retried on the next catch-up, never every tick
    const c = this.catchUp, ms = performance.now() - t0; c.slices++; if (ms > c.maxMs) c.maxMs = ms;
    // a slice that ran long (one place or the named things re-derived at once) is worth a line in the world's log
    if (!this.perceiveRunning && c.maxMs > 40) this.log(`perceive catch-up: ${this.perceive.stats.lastIds} things${this.perceive.stats.lastFull ? ' (whole pass)' : ''}, ${c.slices} slices, longest ${Math.round(c.maxMs)} ms, ${Math.round(performance.now() - c.t0)} ms in all`);
  }
  /** The current catch-up: slices run, the longest (ms), when it began. */
  catchUp = { slices: 0, maxMs: 0, t0: 0 };
  /** Construction closure (C1): residents inside a closing zone get the same polite walk-out as an edit, seated,
   *  asleep or busy included (verification probes may enter closures and are left alone). Runs after each god edit
   *  and on the 40-tick cadence. */
  private evacuated = new Map<string, { tick: number; from: Vec2 }>();
  evacuateSites() {
    const sites = this.god.builds.closingSites(); if (!sites.length) return;
    const diff: Diff = { upserts: [], removes: [], defs: [], tiles: [], answers: [] }, avoid = sites.flatMap(s => s.zones), done = new Set<string>(), tick = this.engine.world.tick;
    // A resident the engine could not land at its exit (still where it stood) is retried after a while, not told again
    // every cadence; one that did move and is inside a closure again is walked out at once.
    const waiting = (soulId: string, entityId: string) => {
      const last = this.evacuated.get(soulId), p = this.engine.world.entities[entityId]?.pose?.p;
      if (!last || tick - last.tick >= EVACUATE_RETRY_TICKS || !p) { this.evacuated.delete(soulId); return false; }
      return Math.hypot(p[0] - last.from[0], p[2] - last.from[1]) < .5;
    };
    // Each resident hears about the site it stands in; every exit is clear of all closing sites.
    for (const site of sites) try {
      const residents = [...this.host.minds.values()].filter(m => !isVerificationProbe(m.soulId) && !done.has(m.soulId) && !waiting(m.soulId, m.entityId));
      const { moved, stuck } = planWalkouts(this.engine, this.model, this.model, diff, residents, { zones: site.zones, avoid, title: this.god.builds.body(site.id)?.title ?? site.id });
      for (const m of moved) { done.add(m.soulId); this.evacuated.set(m.soulId, { tick, from: m.from }); }
      for (const x of stuck) { done.add(x.soulId); this.evacuated.set(x.soulId, { tick, from: this.posOf(x.body) }); this.log(`evacuate: ${x.name} stays inside ${site.id}: no clear ground to step to`); }
      this.applyWalkouts(moved);
    } catch (e) { this.log(`evacuate: ${(e as Error).message}`); }
  }
  /** Plan who walks out of an accepted edit's way (pure). A planning fault never refuses the edit: it is logged, and
   *  the engine's own step-clear of buried bodies still applies. `dry` (dry run, preview): plan only, nothing rewritten. */
  /** nav-connect/1 (lane NAV): nothing a god edit does leaves a Soul unable to walk. The connectivity labels warm up after
   *  boot in ~20 ms slices on each completed tick until ready, then every Soul is
   *  checked once (Souls stranded before this release step out too). After an edit that changes geometry within 30 m of a
   *  Soul, the request brings the engine up to date and checks every Soul (only the edited tiles are relabelled: tens of ms); a Soul cut
   *  off in a small area (or upstairs) steps to the nearest open spot of the main area as a logged edge-relocate
   *  (replay folds the recorded spot), and the things within 25 m of the edit that no walk reaches are named to the
   *  god in one line. Labels not ready yet, or no Soul near the edit: the check runs from the tick loop and its line
   *  rides on the god's next reply. */
  private navWarm = false;
  private navPending = true;
  private navShaped: Set<string> | null = null;
  private navBefore: Vec2[] = [];
  /** Spots of edits checked later from the tick loop, and the lines that check produced for the god's next reply. */
  private navDeferred: Vec2[] = [];
  private navLater: string[] = [];
  /** Things already named as cut off (said once, again only after they were reachable). */
  private navBadKnown = new Set<string>();
  private navSpots(m: WorldModel, ids: string[]): Vec2[] {
    const out: Vec2[] = [];
    for (const id of ids.slice(0, 200)) { const e = m.entities.get(id); if (!e) continue; try { const p = m.worldPose(e); out.push([p.x, p.z]); } catch { /* unplaced */ } }
    return out;
  }
  /** Soul Actions entry 32: a knock is heard, once, by the Souls the knocked door shuts in on its other side (no walk from
   *  them to the knocker with the door shut) within 10 m of it, and by anyone within 3 m of the door. Never anyone else;
   *  nothing about it stays in anyone's `here`. Returns who heard (tests, proof). */
  readonly knockHeard=(soul:EdgeSoul,id:string):string[]=>{
    const m=this.god.model,e=m.entities.get(id),w=this.host.engine.world,me=w.entities[soul.entityId];if(!e||!me)return [];
    const p=m.worldPose(e),k=[Math.sin(p.yaw),Math.cos(p.yaw)],side=(x:number,z:number)=>((x-p.x)*k[0]+(z-p.z)*k[1])>=0?1:-1,mine=side(me.pose.p[0],me.pose.p[2]);
    const eng=this.host.engine as unknown as {reachesV1?:(a:[number,number],b:[number,number])=>boolean},reaches=eng.reachesV1?.bind(eng),name=e.name??'a door',heard:string[]=[];
    for(const mind of this.host.minds.values()){
      if(mind.soulId===soul.soulId||isVerificationProbe(mind.soulId))continue;const b=w.entities[mind.entityId];if(!b?.human)continue;
      const at:[number,number]=[b.pose.p[0],b.pose.p[2]],dist=Math.hypot(at[0]-p.x,at[1]-p.z);
      // shut in by THIS door: they reach the spot just behind it but not the knocker (a Soul in another yard reaches neither)
      const behind:[number,number]=[p.x-k[0]*mine*.8,p.z-k[1]*mine*.8];
      const hears=dist<=3||(dist<=10&&side(at[0],at[1])!==mine&&!!reaches&&reaches(at,behind)&&!reaches(at,[me.pose.p[0],me.pose.p[2]]));
      if(!hears)continue;heard.push(mind.soulId);
      this.edge?.comms?.streams.deliver?.(mind.soulId,'knock',w.tick,{text:`${soul.name} knocks at ${name}.`,from:{soulId:soul.soulId,name:soul.name},door:id,where:{dist:Math.round(dist)}});
    }
    this.log(`knock: ${soul.name} at ${name}; heard by ${heard.length}`);this.lastKnock={tick:w.tick,by:soul.soulId,door:id,heard};
    return heard;
  };
  lastKnock:{tick:number;by:string;door:string;heard:string[]}|null=null;
  private logSpots() { const st = this.activitySpots.stats; this.log(`activity spots: ${st.spots} spots, ${st.shelves} shelves in ${st.ms} ms`); }
  /** GODLIST: once a god edit is caught up with (perceive done), derive the activity spots in a tick instead of in the next
   *  Soul's listing (only when a listing has read them since the last such derive). */
  private spotsStep() {
    if (!this.edge || this.perceiveRunning || this.perceive.pending()) return;
    // L4 item 6: a served world derives the spots in slices of the perception budget, one per tick until done
    try { if (this.activitySpots.warm(this.perceiveDial?.sliceMs ?? PERCEIVE_SLICE_MS)) this.logSpots(); } catch (e) { this.log(`activity spots: ${(e as Error).message}`); }
  }
  private navStep(tickStartedAtMs?: number) {
    try {
      const E = this.engine as unknown as { navWarmV1?: (ms: number) => boolean };
      if (!E.navWarmV1) { this.navWarm = true; this.navPending = false; return; }
      // The 50 ms tick cadence leaves a 10 ms reserve: warm compilation may use at most
      // 20 ms, and only the remainder of a 40 ms total-tick envelope. Spatial sync remains
      // authoritative even at zero; the engine polls and invalidates without compiling a stale graph.
      const budgetMs = tickStartedAtMs === undefined ? 20
        : Math.min(20, Math.max(0, 40 - (performance.now() - tickStartedAtMs)));
      const st = this.loadStats ? this.navProbe() : null, t0 = st ? performance.now() : 0;
      this.navWarm = E.navWarmV1(budgetMs);
      if (st) { const ms = performance.now() - t0; if (ms > 50) { const now = this.navProbe(); this.log(`[l4] nav warm slice ${Math.round(ms)} ms: spatial paged ${Math.round(now.paged - st.paged)} grids ${Math.round(now.grids - st.grids)} scan ${Math.round(now.scan - st.scan)} ms; largest unit ${Math.round(now.unit)} ms (${now.phase})`); } }
      if (this.navWarm && this.navPending) {
        this.navPending = false; const spots = this.navDeferred; this.navDeferred = [];
        const lines = this.navLines(spots, this.navRescueSouls()); if (lines.length) this.navLater = [...this.navLater, ...lines].slice(-4);
      }
    } catch (e) { this.navWarm = true; this.navPending = false; this.log(`nav warm: ${(e as Error).message}`); }
  }
  /** L4 diagnostic (SIM_L4_STATS=1): the spatial ms counters and the connectivity build's largest unit so far. */
  private navProbe() {
    const rt = (this.engine as unknown as { rt?: { services?: { spatial?: { stats?: { pagedMs: number; gridMs: number; scanMs: number } } } }; conn?: { stats?: { maxStepMs: number; maxStepPhase: string } } });
    const sp = rt.rt?.services?.spatial?.stats, c = rt.conn?.stats;
    return { paged: sp?.pagedMs ?? 0, grids: sp?.gridMs ?? 0, scan: sp?.scanMs ?? 0, unit: c?.maxStepMs ?? 0, phase: c?.maxStepPhase ?? '' };
  }
  /** Last tick each Soul was stepped out (nav-connect/1): at most once a minute each, as the ledger's walk rescue. */
  private navRescuedAt = new Map<string, number>();
  /** Step every Soul cut off from the main walkable area to open ground (logged). Returns how many were moved. A seated
   *  Soul is judged where it would stand up (its seat's approach): connected there, it stays seated and nothing is
   *  logged; when that spot is closed off it rises and lands on open ground once (a god walk-out, which a plain
   *  relocate cannot do to a held body). Only moves that change where a Soul is are logged or counted. */
  private navRescueSouls(budgetMs = 0): number {
    const E = this.engine as unknown as { navRescueV1?: (id: string, budgetMs?: number) => { to: Vec2; code: string; pocket?: number; level: number; seated?: true } | null };
    if (!E.navRescueV1) return 0;
    const tick = this.engine.world.tick;
    let n = 0;
    for (const m of this.host.minds.values()) {
      if (isVerificationProbe(m.soulId) || this.engine.programOf(m.entityId)) continue;
      if ((this.navRescuedAt.get(m.soulId) ?? -1e9) > tick - 1200) continue;
      const r = E.navRescueV1(m.entityId, budgetMs); if (!r) continue;
      const where = `${r.seated ? 'sat' : 'stood'} ${r.level ? `upstairs (floor ${r.level}) with no way down` : `in a closed-off ${r.pocket !== undefined ? `${Math.round(r.pocket)} m² ` : ''}pocket`}`;
      this.log(`${m.name} ${where} (${r.code}): steps to open ground at (${r.to.join(', ')})`);
      const payload = { soulId: m.soulId, entityId: m.entityId, to: r.to, why: `nav-connect/1: ${where}, no walk out: ${r.seated ? 'stood up and ' : ''}stepped to the nearest open ground`, policy: 'nav-connect/1', ...(r.seated ? { godWalkout: true, released: [], level: 0 } : {}) };
      try { void this.host.enqueue('edge-relocate', `edge:${m.soulId}`, payload).catch(() => { /* best effort */ }); this.navRescuedAt.set(m.soulId, tick); n++; } catch { /* clock not ready */ }
    }
    return n;
  }
  private navNoteFor(diff: Diff, said?: string[]): string[] {
    // buildsafe/1 already gave the god one line for these: not named twice
    for (const ref of said ?? []) this.navBadKnown.add(ref);
    const shaped = this.navShaped, before = this.navBefore; this.navShaped = null; this.navBefore = [];
    const later = this.navLater; this.navLater = [];
    try {
      const moved = diff.upserts.filter(e => !shaped || shaped.has(e.id));
      if (!moved.length && !diff.removes.length && !diff.tiles.length) return later;
      this.navPending = true;
      const spots = [...before, ...this.navSpots(this.model, moved.map(e => e.id))];
      // Checked inside the request only when the edit's geometry is within 30 m of a Soul (the Soul is moved and the god
      // told in this reply); any other edit is checked from the tick loop and its note rides on the god's next reply, so
      // edits far from Souls cost nothing here and leave the engine "pending" as before.
      const souls = [...this.host.minds.values()].map(m => this.engine.world.entities[m.entityId]?.pose.p).filter((p): p is NonNullable<typeof p> => !!p);
      const nearSoul = (diff.tiles.length && souls.length > 0) || spots.some(q => souls.some(p => Math.hypot(p[0] - q[0], p[2] - q[1]) <= 30));
      const E = this.engine as unknown as { navWarmV1?: (ms: number) => boolean };
      if (!nearSoul || !E.navWarmV1 || !this.navWarm) { this.navDeferred = [...this.navDeferred, ...spots].slice(-400); return later; }
      this.flush(); this.host.drainInputs();
      if (!E.navWarmV1(250)) { this.navDeferred = [...this.navDeferred, ...spots].slice(-400); return later; }
      this.navPending = false;
      const stepped = this.navRescueSouls();
      return [...later, ...this.navLines([...this.navDeferred.splice(0), ...spots], stepped)];
    } catch (e) { this.log(`nav note: ${(e as Error).message}`); return later; }
  }
  /** The god's lines: things within 25 m of `spots` that no walk reaches (named once) and Souls stepped out. */
  private navLines(spots: Vec2[], stepped: number): string[] {
    const E = this.engine as unknown as { navCheckV1?: (pts: { id: string; p: Vec2; level?: number; tol?: number }[]) => { id: string; ok: boolean; code?: string }[] };
    const near = spots.length && E.navCheckV1 ? this.nav.things().filter(t => t.kind !== 'water' && t.kind !== 'area' && t.kind !== 'path' && spots.some(q => Math.hypot(t.at[0] - q[0], t.at[1] - q[1]) <= 25)).slice(0, 400) : [];
    const v = near.length ? E.navCheckV1!(near.map(t => ({ id: t.ref, p: t.at, level: t.level ?? 0, tol: 1.5 }))) : [];
    const fresh: string[] = [];
    for (const x of v) { if (x.ok) this.navBadKnown.delete(x.id); else if (!this.navBadKnown.has(x.id)) { this.navBadKnown.add(x.id); fresh.push(x.id); } }
    const lines: string[] = [];
    if (fresh.length) lines.push(`No walk reaches ${fresh.slice(0, 4).join(', ')}${fresh.length > 4 ? ` and ${fresh.length - 4} more` : ''} now (nav-connect/1): Souls are not offered ${fresh.length > 1 ? 'them' : 'it'}; open a way in (a door, a gap of 0.7 m, a ramp) to fix.`);
    if (stepped) lines.push(`${stepped} Soul${stepped > 1 ? 's' : ''} cut off by this edit stepped to open ground nearby.`);
    return lines;
  }
  /** arrival-search/1: the god's note when an edit blocks the arrival point ("new Souls will arrive nearby at x, z"),
   *  said again only when it changes. Checked (which brings the engine up to date inside the request) only when an
   *  edit places, moves, resizes or reshapes something whose footprint covers the arrival point within 1 m (or a
   *  footprint-less ground edit, a lake or landform, within 80 m), or a note already stands and the edit touches within
   *  80 m. A state-only change (a door opened) is never checked; every unchecked edit stays "pending" in the engine until
   *  the next tick, as before. */
  private arrivalNoted: string | null = null;
  /** Ids whose geometry the edit being applied changed (set by `prepare` from the before-model); null = unknown, all. */
  private arrivalShaped: Set<string> | null = null;
  private arrivalNoteFor(diff: Diff): string[] {
    try {
      const a = this.host.engine.anchors?.()[0]?.point as unknown;
      const at = Array.isArray(a) && a.length === 2 && a.every(v => typeof v === 'number') ? a as [number, number] : null;
      const near = (e: Entity) => { if (!at) return true; const p = this.model.worldPose(e); return Math.hypot(p.x - at[0], p.z - at[1]) <= 80; };
      const spot = at ? { c: at, half: [1, 1] as [number, number], yaw: 0, y0: -1e3, y1: 1e3 } : null;
      const covers = (e: Entity) => {
        if (!spot) return true;
        const fs = e.in.parent === 'world' ? this.model.footprintsOf(e.id) : this.model.footprint(e);
        return fs.length ? fs.some(f => obbOverlap(f, spot)) : diff.tiles.length > 0 && near(e);
      };
      const shaped = this.arrivalShaped, moved = diff.upserts.filter(e => !shaped || shaped.has(e.id)); this.arrivalShaped = null;
      if (this.arrivalNoted ? !diff.tiles.length && !diff.removes.length && !moved.some(near) : !moved.some(covers)) return [];
      this.flush(); this.host.drainInputs();
      const text = arrivalNote(this.host);
      if (text === this.arrivalNoted) return [];
      this.arrivalNoted = text; return text ? [text] : [];
    } catch (e) { this.log(`arrival note: ${(e as Error).message}`); return []; }
  }
  private prepareWalkouts(before: WorldModel, after: WorldModel, diff: Diff, dry = false): WalkoutPrep {
    try {
      if (!dry) { this.flush(); this.host.drainInputs(); this.stuckPlanned = []; this.mapPlanned = null; }
      // Nothing goes into a resident's hands (an undo of a take): set down first, so the plan sees where it lands.
      const kept = dry ? { warnings: [], touched: [] } : unhand(this.engine, before, after, diff);
      const { moved, stuck } = planWalkouts(this.engine, before, after, diff, this.host.minds.values());
      const warnings = [...kept.warnings, ...stuck.map(stuckWarning)], touched = [...kept.touched];
      if (!dry) { this.stuckPlanned = stuck; touched.push(...dropReleased(after, diff, moved)); this.mapPlanned = this.planMap(before, after, diff, new Set([...moved, ...stuck].map(x => x.soulId)), touched); }
      return { moved, warnings, touched };
    } catch (e) { this.log(`walk-out planning: ${(e as Error).message}`); return { moved: [], warnings: [], touched: [] }; }
  }
  /** Log and fold each planned move now (no tick, no animation wait), interrupt the resident's act, tell it why. A
   *  resident the engine could not land at its planned exit is told so and named in the returned warnings. */
  // ---- R8 map-change notices (map-notices.ts)
  /** The last prepared edit's map notice (who hears of it), delivered only once that edit has committed. */
  private mapPlanned: MapPlan | null = null;
  private residents(): MapResident[] {
    const out: MapResident[] = [];
    for (const m of this.host.minds.values()) { const p = this.engine.world.entities[m.entityId]?.pose?.p; if (p && !isVerificationProbe(m.soulId)) out.push({ soulId: m.soulId, name: m.name, p: [p[0], p[2]] }); }
    return out;
  }
  /** Planned in the request (pure, bounded); a planning fault never refuses or delays the edit. */
  private planMap(before: WorldModel, after: WorldModel, diff: Diff, told: Set<string>, touched: string[]): MapPlan | null {
    try {
      if (!this.host.minds.size) return null;
      const changes = mapChanges(before, after, diff, touched); if (!changes.length) return null;
      const relations = this.layers.relations().filter(r => r.rel === 'works-at' || r.rel === 'lives-at');
      const mine = (r: MapResident, c: MapChange) => { const soul = { soulId: r.soulId, name: r.name }; return c.owners.some(o => this.layers.isOf(o, soul)) || relations.some(x => c.things.includes(x.b) && this.layers.isOf(x.a, soul)); };
      return planMapNotices(changes, this.residents(), { exclude: told, mine });
    } catch (e) { this.log(`map notices: ${(e as Error).message}`); return null; }
  }
  /** After the commit: stage the request's notice; it is delivered when the request has finished (a build done in the
   *  same request tells its own sentence instead). A closing build's edits are covered by its start and done notices. */
  private stageMapNotices(o?: ApplyContext) {
    const plan = this.mapPlanned; this.mapPlanned = null; if (!plan) return;
    try {
      const build = o?.kind === 'edit' && o.build ? this.god.builds.body(o.build) : undefined;
      if (build && this.god.builds.closingSites().some(s => s.id === o!.build)) return;
      const label = o?.kind === 'edit' ? (build ? { title: build.title, say: build.say?.text } : { note: o.note }) : {};
      const text = mapNoticeText(plan.changes, label, this.whereOf(plan.at, plan.changes[0].id));
      this.mapNotices.stage(plan.souls, text, build?.title ?? (plan.changes.length === 1 ? plan.changes[0].name : undefined));
      queueMicrotask(() => { try { this.mapNotices.deliverStaged(); } catch (e) { this.log(`map notices: ${(e as Error).message}`); } });
    } catch (e) { this.log(`map notices: ${(e as Error).message}`); }
  }
  /** " at the harbour" (the place around it, not itself), " by the fountain" (a named thing near it), else " near you". */
  private whereOf(at: Vec2, except: string): string {
    const places = this.edge?.places, own = this.places.ofEntity(except)?.id;
    const place = places?.containing(at[0], at[1], 0).find(p => p.parent !== null && !p.carrier && p.id !== own);
    const say = (name: string) => /^[A-Z]/.test(name) || name.startsWith('the ') ? name : `the ${name}`;
    if (place?.name) return ` at ${say(place.name)}`;
    const by = this.nav.namesNear(at, except, 1, 12)[0];
    return by ? ` by ${say(by.split('/').at(-1)!.replace(/[-_]+/g, ' '))}` : ' near you';
  }
  /** Construction: a build started near a resident (one inside a closing site is walked out and told by G1), and done. */
  private buildNotice(e: BuildNotice) {
    if (e.kind !== 'started' && e.kind !== 'done') return;
    try {
      const body = this.god.builds.body(e.id); if (!body || !this.host.minds.size) return;
      const title = body.title, closing = this.god.builds.closingSites().find(s => s.id === e.id), residents = this.residents();
      if (e.kind === 'started') this.mapNotices.construction(nearSite(body.site, residents, { skipInside: closing?.zones }), `The god started building ${title} nearby${closing ? '; it is closed until finished' : ''}.`, title);
      else this.mapNotices.construction(nearSite(body.site, residents), `${title[0].toUpperCase()}${title.slice(1)} is finished and open.`, title);
    } catch (err) { this.log(`map notices: ${(err as Error).message}`); }
  }
  private flushMapNotices() { try { this.mapNotices.flush(); } catch (e) { this.log(`map notices: ${(e as Error).message}`); } }
  /** Residents the last edit's plan found no clear ground for (told why when that edit applies). */
  private stuckPlanned: StuckResident[] = [];
  private applyWalkouts(moved: ResidentMove[], stuck: StuckResident[] = []): string[] {
    const late: string[] = [];
    // Residents in the way with nowhere clear to go: they stay, and are told why.
    for (const x of stuck) this.notices.notify(x.soulId, { text: x.reason, tick: this.engine.world.tick, salience: 3, ...(x.place ? { place: x.place } : {}) });
    for (const m of moved) {
      try {
        const carried = m.released.filter(id => ['in-hand', 'held'].includes(this.engine.world.entities[id]?.support?.kind));
        if (m.how === 'stopped') {
          void this.host.enqueue('edge-stop', 'god:walkout', { soulId: m.soulId, entityId: m.body, why: m.reason }).catch(() => { /* best effort */ });
        } else {
          const payload = { soulId: m.soulId, entityId: m.body, to: m.to, ...(m.level ? { level: m.level } : {}), released: m.released, ...(m.dropAt ? { dropAt: m.dropAt } : {}), why: m.reason, ...(m.how === 'relocated' ? { godWalkout: true } : {}) };
          void this.host.enqueue(m.how === 'walked' ? 'edge-god-walkout' : 'edge-relocate', 'god:walkout', payload).catch(() => { /* logged or refused: the notice still stands */ });
        }
        this.host.drainInputs();
        const b = this.engine.world.entities[m.body], at = b?.pose?.p, landed = m.how === 'stopped' || (!!at && Math.hypot(at[0] - m.to[0], at[2] - m.to[1]) < .05 && (b.human?.level ?? 0) === (m.level ?? 0));
        if (landed) {
          // What it carried re-enters the engine from the entity world at the next flush (or leaves it, if removed).
          for (const id of carried) this.sent.set(id, RELEASED);
          this.edge?.godInterrupted(m.soulId, m.reason);
          this.notices.notify(m.soulId, { text: m.reason, tick: this.engine.world.tick, ...(m.how === 'stopped' ? { salience: 3 as const } : { moved: m.how }), ...(m.place ? { place: m.place } : {}) });
          this.log(`${m.name} ${m.how} out of the god's way: ${m.reason}`);
        } else {
          const text = m.reason.replace(/;.*$/, '; you could not step clear, so you stayed where you were.');
          this.notices.notify(m.soulId, { text, tick: this.engine.world.tick, salience: 3, ...(m.place ? { place: m.place } : {}) });
          late.push(`body.stuck: ${m.name} (${m.body}) could not be ${m.how === 'walked' ? 'walked' : 'moved'} to (${m.to.join(', ')}): the engine refused the landing; still at (${at ? `${r3(at[0])}, ${r3(at[2])}` : '?'})`);
          this.log(`walk-out of ${m.name} refused by the engine at (${m.to.join(', ')})`);
        }
      } catch (e) { this.log(`walk-out of ${m.name}: ${(e as Error).message}`); }
    }
    return late;
  }
  private posOf(body: string): Vec2 { const p = this.engine.world.entities[body]?.pose?.p; return p ? [p[0], p[2]] : [0, 0]; }
  /** Only a resident's body is protected from god edits: never removed, edited or re-made as a thing, and nothing is put
   *  into its hands (an undo that would is set down at its feet instead: walkout.ts unhand). */
  private protectedBody(after: WorldModel, diff: Diff, ops: Op[], undo = false): Failure | null {
    for (const [i, op] of ops.entries()) {
      const raw = op as { id?: string; entity?: Entity };
      const e = raw.id ? this.model.get(raw.id) : raw.entity;
      if (e && this.model.resolvedDef(e.def)?.components.body) return { op: i, code: 'body.protected', entity: e.id, detail: `${this.model.pathOf(e.id)} is a resident's body; bodies move themselves` };
    }
    for (const id of diff.removes) {
      const e = this.model.entities.get(id);
      if (e && this.model.resolvedDef(e.def)?.components.body) return { op: 0, code: 'body.protected', entity: id, detail: 'A god edit cannot remove a resident body.' };
    }
    for (const e of diff.upserts) if (after.resolvedDef(e.def)?.components.body && (!this.model.entities.has(e.id) || diff.defs.some(d => d.ref === after.resolvedDef(e.def)?.ref))) {
      const ref = after.resolvedDef(e.def)?.ref, i = ops.findIndex(o => { const x = o as { op?: string; def?: string }; try { return x.op === 'place' && !!x.def && after.resolvedDef(x.def)?.ref === ref; } catch { return false; } });
      return { op: Math.max(0, i), code: 'body.protected', entity: e.id, detail: `${ref?.replace(/^core-/, 'core/') ?? e.def} is a resident's body: residents (Souls) come only by joining, never by placing, and their bodies are managed by their Souls`, fix: PEOPLE_AS_SCENERY };
    }
    if (!undo) for (const e of diff.upserts) {
      const holder = e.in.parent !== 'world' ? after.entities.get(e.in.parent) : undefined;
      if (!holder || !after.resolvedDef(holder.def)?.components.body || this.model.entities.get(e.id)?.in.parent === holder.id) continue;
      const i = ops.findIndex(o => { const x = o as { id?: string; tmp?: string; in?: { parent?: string } }; return x.id === e.id || (typeof x.id === 'string' && this.model.get(x.id)?.id === e.id) || !!x.in?.parent && (x.in.parent === holder.id || this.model.get(x.in.parent)?.id === holder.id); });
      return { op: Math.max(0, i), code: 'body.protected', entity: e.id, field: 'in.parent', detail: `${this.soulName(holder.id)}'s hands are theirs: a god edit cannot put ${after.pathOf(e.id) || e.id} into them`, fix: 'Place it beside the resident instead; residents pick things up themselves.' };
    }
    return null;
  }
  /** LAYERS: the world clock drives schedules (states that follow them, calendar items); a new day re-derives places. */
  private layerDay = '';
  /** The requested day stays fixed while places finish. Engine writebacks must not restart this pass. */
  private layerPlacesPending: string | null = null;
  private layersStep(sweep = true) {
    try {
      if (sweep) {
        this.god.builds.sweep();
        if (this.god.builds.hasClosure()) this.evacuateSites();
      }
      const active = this.layers.active();
      // LINK still needs its initial door-safety index in worlds without calendar layers.
      const initialBodyPlaces = !!this.edge?.bodyRule && !this.places.hasPublished();
      if (!active && !initialBodyPlaces) { this.layerPlacesPending = null; return; }
      const day = this.layers.dayKey();
      if (initialBodyPlaces || day !== this.layerDay || this.layerPlacesPending !== null) {
        if (!this.host.running) {
          // Tools that step a world by hand retain synchronous publication.
          this.places.sync(true);
          this.layerDay = day;
          this.layerPlacesPending = null;
        } else {
          this.layerPlacesPending ??= day;
          if (!this.places.syncStep(this.perceiveDial?.sliceMs ?? PERCEIVE_SLICE_MS)) return;
          // Keep deferral through both syncStep's final sync() and the calendar lookup:
          // an edit/minute boundary during the pass must not force another full derive.
          // The completed list has the existing deferred-place semantics. If the day
          // changed meanwhile, the next normal cadence starts its catch-up.
          this.layerDay = this.layerPlacesPending;
          try { if (active) this.layers.step(); } finally { this.layerPlacesPending = null; }
          return;
        }
      }
      if (active) this.layers.step();
    } catch (e) { this.layerPlacesPending = null; this.log(`layers: ${(e as Error).message}`); }
  }
  private calendarPlaces(sources: readonly Entity[]): (e: Entity) => { id: string; name: string } | null {
    const own = this.places.calendarIdentities(sources, this.version);
    return (e) => this.layerPlace(e, own.get(e.id) ?? null);
  }
  /** The place a thing is in: its own place (a café building, a market plaza), else the innermost holding it. */
  private layerPlace(e: Entity, own?: { id: string; name: string } | null): { id: string; name: string } | null {
    if (!this.edge) return null;
    if (own === undefined) own = this.places.ofEntity(e.id);
    if (own) return { id: own.id, name: own.name };
    const wp = this.model.worldPose(e), id = this.places.placeAt([wp.x, wp.z], this.levelAt(wp.x, wp.z, wp.y)); if (!id) return null;
    return { id, name: this.edge.places.byId.get(id)?.name ?? id };
  }

  // ------------------------------------------------------------------ engine → entity world

  /** Trusted engine edit: journaled (by 'engine', never undone by the god), published to viewers, not echoed back. */
  engineAct(ops: Op[], note: string): Result {
    const god = this.god as any;
    if ((ops as { id?: string }[]).some((o) => !o.id || !this.model.resolvedDef(this.model.entities.get(o.id)?.def ?? '')?.components.body)) this.version++;
    if (typeof god.engineAct === 'function') {
      const r = god.engineAct(ops, note) as Result;
      if (r.accepted) this.noteSent(ops);
      return r;
    }
    const tick = this.god.opts.tick();
    const r = applyBatch(this.model, { ops }, 'engine', tick, { trusted: true });
    if (!r.result.accepted) return r.result;
    this.god.store.commit(this.model, this.god.owner, r.diff!, { seq: r.result.seq, by: 'engine', at: Date.now(), note, ops, inverse: [], kind: 'engine' as never });
    this.god.db.db.prepare('UPDATE world_edits_v1 SET undone=1 WHERE world_id=? AND seq=?').run(this.god.opts.worldId, r.result.seq);
    god.publish?.(r.result.seq, tick, r.diff!, 'engine');
    this.noteSent(ops);
    return r.result;
  }
  /** After an engine edit: what the engine already knows about the touched entities (no echo back to it). */
  private noteSent(ops: Op[]) {
    const ids = new Set<string>();
    for (const op of ops as any[]) { if (typeof op.id === 'string') ids.add(op.id); if (op.entity?.id) ids.add(op.entity.id); }
    for (const id of ids) for (const sid of this.model.entities.has(id) ? this.model.subtree(id) : []) {
      const e = this.model.entities.get(sid)!;
      // A thing in a body's hands is the engine's: forget what it was last told, so the god placing it again is sent.
      if (this.engineOwned(e)) { this.sent.delete(e.id); continue; }
      this.sent.set(e.id, sentKey(JSON.stringify(normPart(this.derive(e, {}, this.physics?.assets ?? {}) ?? {}))));
    }
  }

  /** Items the Souls moved: write their new support back as entity-world moves. */
  /** S1 V7d: the model key and engine entities of the last write-back that found nothing to write with no body in the
   *  engine world. Without bodies nothing moves a god thing in the engine (Souls carry, rides seat bodies) except an
   *  edit flushed from the model, which changes the key, so the next pass would find nothing again. */
  private writeBackQuiet: { key: object; ents: object } | null = null;
  /** The roster retains stable work IDs; poses/supports are freshly planned before each selected unit.
   * The roster advances on refusal or disappearance too, so a busy/refused prefix cannot starve its tail. */
  private writeBackPass: { keys: string[]; next: number; bodies: Map<string, WriteBackBody> } | null = null;
  /** Without a budget, retain the ordinary synchronous full drain. Scheduled slices yield only between complete
   * units: a carry's body prerequisite, strict/nudge retry, and item reparent retain their separate ordered commits. */
  writeBack(budgetMs = Infinity): boolean {
    if (this.writeBackBusy || !(budgetMs > 0)) return false;
    const sliced = Number.isFinite(budgetMs);
    if (!sliced) this.writeBackPass = null;
    if (this.writeBackQuiet) {
      const ents = this.engine.world.entities as Record<string, any>;
      let body = false;
      for (const id in ents) if (ents[id]?.human) { body = true; break; }
      if (!body && this.writeBackQuiet.key === this.model.safetyCacheKey() && this.writeBackQuiet.ents === ents) return true;
      this.writeBackQuiet = null;
    }
    this.writeBackBusy = true;
    try {
      const started = performance.now();
      if (!sliced) {
        const plan = this.writeBackUnits(), bodies = new Map<string, WriteBackBody>();
        for (const unit of plan.units) this.applyWriteBackUnit(unit, bodies);
        if (!plan.units.length && !plan.humans) this.writeBackQuiet = { key: this.model.safetyCacheKey(), ents: this.engine.world.entities };
      } else {
        if (!this.writeBackPass) {
          const plan = this.writeBackUnits();
          if (!plan.units.length) {
            if (!plan.humans) this.writeBackQuiet = { key: this.model.safetyCacheKey(), ents: this.engine.world.entities };
            return true;
          }
          this.writeBackPass = { keys: plan.units.map(unit => unit.key), next: 0, bodies: new Map() };
        }
        const pass = this.writeBackPass;
        while (pass.next < pass.keys.length) {
          const unit = this.writeBackUnit(pass.keys[pass.next]);
          if (unit) this.applyWriteBackUnit(unit, pass.bodies);
          pass.next++;
          if (pass.next < pass.keys.length && performance.now() - started >= budgetMs) return false;
        }
        this.writeBackPass = null;
      }
      return true;
    } finally { this.writeBackBusy = false; }
  }

  /** Discovery runs once per pass. The ordinary synchronous drain keeps this complete ordered plan. */
  private writeBackUnits(): { units: WriteBackUnit[]; humans: number } {
    const units: WriteBackUnit[] = [], bodies = new Set<string>(), holders = new Set<string>();
    const ents = this.engine.world.entities as Record<string, any>, humans: string[] = [];
    for (const id in ents) {
      if (!Object.hasOwn(ents, id)) continue;
      if (ents[id]?.human) humans.push(id);
      const unit = this.writeBackComponent(id, holders);
      if (unit) { units.push(unit); if (unit.body) bodies.add(unit.body); }
    }
    for (const id of holders) {
      if (bodies.has(id)) continue;
      const unit = this.writeBackBody(id, true); if (unit) units.push(unit);
    }
    for (const id of humans) {
      if (bodies.has(id) || holders.has(id)) continue;
      const unit = this.writeBackBody(id, false); if (unit) units.push(unit);
    }
    return { units, humans: humans.length };
  }

  /** Recompute only the selected ID and its direct dependencies. Never rescan or re-plan the world after a commit.
   * A body's role that changes during a pass is eligible for discovery on the next pass, just like new work. */
  private writeBackUnit(key: string): WriteBackUnit | undefined {
    const colon = key.indexOf(':'), kind = key.slice(0, colon), id = key.slice(colon + 1);
    if (kind === 'component') return this.writeBackComponent(id);
    // The holder predicate can be checked through the model's direct-child index: a projected held item must be
    // in this body's carry slot AND still supported by this body in the engine. No whole-engine scan is needed.
    let holder = false;
    const ents = this.engine.world.entities as Record<string, any>;
    for (const child of this.model.children.get(id) ?? []) {
      const e = this.model.entities.get(child), x = ents[child];
      if (e?.in.parent === id && e.in.slot === 'carry' && x?.kind === 'component' && x.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === id) { holder = true; break; }
    }
    if (holder !== (kind === 'holder')) return;
    return this.writeBackBody(id, holder);
  }

  /** Entry 34: a watering can's grasp or release reaches the world on its own tick, so a viewer shows it on the same
   *  depicted frame as the hand (instead of up to ten ticks later with the next write-back). */
  private writeBackNow(id: string) { try { const unit = this.writeBackComponent(id); if (unit) this.applyWriteBackUnit(unit, new Map()); } catch (e) { this.log(`write-back ${id}: ${(e as Error).message}`); } }
  private writeBackComponent(id: string, holders?: Set<string>): WriteBackUnit | undefined {
    const x = this.engine.world.entities[id] as any;
    if (!x?.tags?.includes('entity-world')) return;
    // Native fixture transport owns the airborne pose. Persist its grounded
    // result (also after safe cancellation) through the existing item write-back.
    if (x.kind !== 'component' && !(x.kind === 'fixture' && CATALOG[x.def]?.capabilities?.fixtureCarry && x.support?.kind === 'ground' && x.phase !== 'carried')) return;
    const e = this.model.entities.get(id); if (!e) return;
    const ops: Op[] = []; let body: string | undefined;
    const s = x.support;
    if (s?.kind === 'in-hand') {
      if (e.in.parent === s.by && e.in.slot === 'carry') { holders?.add(s.by); return; }
      if (!this.model.entities.has(s.by)) return; // the body entity is not in the entity world (pre-bridge Soul)
      const b = this.engine.world.entities[s.by];
      if (b) { ops.push({ op: 'move', id: s.by, p: [r3(b.pose.p[0]), r3(b.pose.p[1]), r3(b.pose.p[2])], r: r3(-b.pose.yaw), mode: 'strict' } as Op); body = s.by; }
      ops.push({ op: 'move', id, in: { parent: s.by, slot: 'carry' }, p: [0, 0, 0], r: 0, mode: 'strict' } as Op);
      // #435: taken off a container that keeps a `leftBy` record (a swap shelf): its entry goes with it
      const from = this.model.entities.get(e.in.parent), rec = from && keepsLeftBy(this.model.resolvedDef(from.def)) ? leftByOf(from.state) : null;
      if (from && rec?.has(id)) { rec.delete(id); ops.push({ op: 'set', id: from.id, state: { leftBy: [...rec].map(([k, v]) => `${k}=${v}`).join(',') } } as Op); }
    } else if (s?.kind === 'resting-on') {
      const parent = this.model.entities.get(s.on); if (!parent) return;
      const slotId = String(s.slot).replace(/-r\d+c\d+$/, '');
      const pp = this.model.worldPose(parent), c = Math.cos(pp.yaw), sn = Math.sin(pp.yaw), dx = x.pose.p[0] - pp.x, dz = x.pose.p[2] - pp.z;
      const slot = this.model.slotsOf(parent).find((q) => q.id === slotId);
      const lx = dx * c - dz * sn - (slot?.p[0] ?? 0), lz = dx * sn + dz * c - (slot?.p[2] ?? 0);
      const want: [number, number, number] = [r3(lx), 0, r3(lz)];
      const have = e.p ?? [0, 0, 0];
      if (e.in.parent === s.on && (e.in.slot ?? '') === (slot ? slotId : '') && Math.hypot((have[0] ?? 0) - want[0], (have[have.length - 1] ?? 0) - want[2]) < 0.05) return;
      ops.push({ op: 'move', id, in: { parent: s.on, ...(slot ? { slot: slotId } : {}) }, p: want, r: r3(-(x.pose.yaw) - pp.yaw), mode: 'strict' } as Op);
      // #435 (W071): a container that keeps a `leftBy` record (a swap shelf) notes the Soul whose hand this came from, and
      // forgets what is no longer inside it. The record is read when the unit is planned: the scheduled (sliced) pass plans
      // each unit just before applying it; the unsliced pass plans all first, so two leaves on one shelf in one such pass
      // keep only the last record (the tick drain never batches that way).
      const pdef = this.model.resolvedDef(parent.def), ins = slot && keepsLeftBy(pdef) ? containerInside(pdef) : null;
      if (ins && e.in.parent !== s.on && ins.slots.some((q) => q.id === slotId)) {
        const from = e.in.parent, by = [...this.host.minds.values()].find((m) => m.entityId === from)?.soulId, inside = new Set(ins.slots.map((q) => q.id));
        const kept = new Set([...(this.model.children.get(parent.id) ?? [])].filter((c) => c !== id && inside.has(this.model.entities.get(c)?.in.slot ?? '')));
        const rec = [...leftByOf(parent.state)].filter(([k]) => kept.has(k)); if (by) rec.push([id, by]);
        ops.push({ op: 'set', id: parent.id, state: { leftBy: rec.map(([k, v]) => `${k}=${v}`).join(',') } } as Op);
      }
    } else if (s?.kind === 'ground') {
      if (e.in.parent === 'world') { const p = e.p ?? [0, 0]; if (Math.hypot(p[0] - x.pose.p[0], p[p.length - 1] - x.pose.p[2]) < 0.05) return; }
      // A thing placed in a room, on a pier or balcony stays there until a Soul moves it away.
      else { const wp = this.model.worldPose(e); if (Math.hypot(wp.x - x.pose.p[0], wp.z - x.pose.p[2]) < 0.05) return; }
      ops.push({ op: 'move', id, in: { parent: 'world' }, p: [r3(x.pose.p[0]), r3(x.pose.p[2])], r: r3(-x.pose.yaw), mode: 'strict' } as Op);
    }
    if (ops.length) return { key: `component:${id}`, ops, ...(body ? { body } : {}) };
  }

  private writeBackBody(id: string, holder: boolean): WriteBackUnit | undefined {
    const b = this.engine.world.entities[id], e = this.model.entities.get(id);
    if (!b?.human || !e) return;
    // Carrying bodies follow coarsely while walking, exactly at rest. Other bodies follow only at rest.
    const moving = (b.human.speed ?? 0) > 0.05 || b.human.activity === 'walk';
    if (!holder && (e.in.parent !== 'world' || (b.human.speed ?? 0) > 0.05 || ['walk', 'wade', 'swim', 'tread', 'sit-down', 'stand-up'].includes(b.human.activity))) return;
    const have = e.p ?? [0, 0, 0], d = Math.hypot((have[0] ?? 0) - b.pose.p[0], (have.length === 3 ? have[1] : 0) - b.pose.p[1], (have[have.length - 1] ?? 0) - b.pose.p[2]);
    if (d > (holder ? (moving ? 2 : 0.15) : 0.4)) return { key: `${holder ? 'holder' : 'human'}:${id}`, ops: [{ op: 'move', id, p: [r3(b.pose.p[0]), r3(b.pose.p[1]), r3(b.pose.p[2])], r: r3(-b.pose.yaw), mode: 'strict' } as Op] };
  }

  private applyWriteBackUnit(unit: WriteBackUnit, bodies: Map<string, WriteBackBody>) {
    for (let i = 0; i < unit.ops.length; i++) {
      const op = unit.ops[i];
      // Several items can share a holder. Match the full drain's one prerequisite per unchanged pose,
      // while a holder changed in either world between slices gets its prerequisite before the next transfer.
      const pose = unit.body && i === 0 ? JSON.stringify(op) : undefined;
      const done = unit.body ? bodies.get(unit.body) : undefined;
      if (pose !== undefined && done?.pose === pose && done.entity === this.model.entities.get(unit.body!)) continue;
      this.applyWriteBackOp(op);
      if (pose !== undefined) bodies.set(unit.body!, { pose, entity: this.model.entities.get(unit.body!) });
    }
  }

  private applyWriteBackOp(op: Op) {
    { const o = op as { id: string; p?: number[] }; if (this.refusedPose.has(`${o.id}@${o.p?.join(',')}`)) return; }
    const r = this.engineAct([op], `engine: ${describeOp(op, this.model)}`);
    if (r.accepted) this.stats.writeBacks++;
    else {
      // A body's strict/nudge pair remains in this unit; never retry the same refused pose.
      const o = op as { id: string; p?: number[]; mode?: string }, key = `${o.id}@${o.p?.join(',')}`;
      if (this.model.resolvedDef(this.model.entities.get(o.id)?.def ?? '')?.components.body) {
        const r2 = this.engineAct([{ ...(op as object), mode: 'nudge' } as Op], `engine: ${describeOp(op, this.model)}`);
        if (r2.accepted) { this.stats.writeBacks++; return; }
        this.refusedPose.add(key); if (this.refusedPose.size > 500) this.refusedPose.clear();
      }
      this.log(`write-back refused for ${o.id}: ${JSON.stringify(r.failures).slice(0, 200)}`);
    }
  }

  /** Birth: the Soul's body becomes an entity (core/humanoid) with the engine's own id (spec 31 §3 rule 3). */
  /** The model's body entities (L4: the activity-spot key leaves them out). Seeded by one scan, kept by births, retires
   *  and commits; each read re-checks membership, so a body missed here only costs an extra derive. */
  private bodyIds: Set<string> | null = null;
  private modelBodies(): number {
    const m = this.model;
    if (!this.bodyIds) { this.bodyIds = new Set(); for (const [id, e] of m.entities) if (e.def === BODY_DEF) this.bodyIds.add(id); }
    let n = 0; for (const id of this.bodyIds) if (m.entities.get(id)?.def === BODY_DEF) n++; else this.bodyIds.delete(id);
    return n;
  }
  bodyBorn(p: { entityId: string; soulId: string; name: string }) {
    if (this.model.entities.has(p.entityId) || !this.model.def(BODY_DEF)) return;
    const b = this.engine.world.entities[p.entityId];
    const pos: [number, number, number] = b ? [r3(b.pose.p[0]), r3(b.pose.p[1]), r3(b.pose.p[2])] : [0, 0, 0];
    const slug = (p.name ?? 'soul').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'soul';
    const name = this.model.names.has(`world/${slug}`) ? `${slug}-${p.entityId.slice(2, 6)}` : slug;
    const entity = { id: p.entityId, name, def: BODY_DEF, in: { parent: 'world' }, p: pos, r: 0, anchor: 'center', state: {}, by: 'engine', born: this.god.opts.tick(), v: 1 } as unknown as Entity;
    const r = this.engineAct([{ op: 'restore', entity } as Op], `birth: ${p.name}'s body`);
    if (r.accepted) { this.stats.bodies++; this.bodyIds?.add(p.entityId); } else this.log(`body entity for ${p.entityId} refused: ${JSON.stringify(r.failures).slice(0, 300)}`);
  }
  bodyRetired(p: { entityId: string }) {
    if (!this.model.entities.has(p.entityId)) return;
    const ops: Op[] = [...(this.model.children.get(p.entityId) ?? [])].map((c) => ({ op: 'move', id: c, in: { parent: 'world' }, p: [r3(this.model.worldPose(this.model.entities.get(c)!).x), r3(this.model.worldPose(this.model.entities.get(c)!).z)], mode: 'nudge' } as Op));
    ops.push({ op: 'remove', id: p.entityId, cascade: true } as Op);
    const r = this.engineAct(ops, p.entityId.startsWith('h_vp') ? `retire: verifier probe ${p.entityId} body removed` : 'retire: body removed');
    if (!r.accepted) this.log(`retire ${p.entityId}: ${JSON.stringify(r.failures).slice(0, 200)}`);
  }

  // ------------------------------------------------------------------ god edits respect bodies

  /** Who uses an entity (or anything in its subtree): a seated Soul, a holding Soul. */
  usesOf(id: string): { id: string; body: string; how: 'occupied' | 'held'; soul: string } | null {
    for (const sid of this.model.subtree(id)) {
      const e = this.model.entities.get(sid);
      // a thing in a body's hands (its entity-world parent is the body)
      if (e && e.in.parent !== 'world' && this.model.resolvedDef(this.model.entities.get(e.in.parent)?.def ?? '')?.components.body) return { id: sid, body: e.in.parent, how: 'held', soul: this.soulName(e.in.parent) };
      const u = this.engine.bodyUsesV1(sid);
      if (u) return { id: sid, ...u, soul: this.soulName(u.body) };
    }
    return null;
  }
  /** The compiler hook (one entity, no subtree walk): a body, a thing in a body's hands, a seat or item in use. */
  usesOne(id: string): { code: 'body.protected'; detail: string } | null {
    const e = this.model.entities.get(id);
    return e && this.model.resolvedDef(e.def)?.components.body ? { code: 'body.protected', detail: `${this.model.pathOf(id)} is ${this.soulName(id)}'s body; bodies move themselves` } : null;
  }
  private soulName(body: string) { return String(this.engine.world.entities[body]?.label ?? body); }

  // ------------------------------------------------------------------ reach

  /** Where an end was looked for when the engine has nowhere to stand there: the point, its height, the engine level that
   *  height resolves to and that level's own height (a room floor at y 3.1 resolving to level 0 at y 0 = no engine floor). */
  private endpoint(what: string, at: Vec2, y: number, level: number): ReachEndpoint {
    const levelY = level === 0 ? 0 : this.levels.find((l) => l.id === level)?.y ?? 0;
    return { what, at: [r3(at[0]), r3(at[1])], y: r3(y), level, levelY: r3(levelY) };
  }
  private endOf(x: ReachEnd): { p: Vec2; level: number; what: string } | { error: string; endpoint?: ReachEndpoint } {
    if (Array.isArray(x)) { const y = x.length === 3 ? x[1] : 0; const p: Vec2 = [x[0], x[x.length - 1]]; return { p, level: this.levelOfY(y as number), what: `(${p.join(', ')})` }; }
    const [path, room] = String(x).split(':');
    const e = this.model.get(path);
    if (!e) return { error: `no such entity or point ${x}` };
    if (room) {
      const slot = this.model.slotsOf(e).find((s) => s.id === room && (s.kind === 'room' || s.kind === 'floor'));
      if (!slot) return { error: `${path} has no room ${room}` };
      const wp = this.model.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
      const at: Vec2 = [wp.x + (slot.p[0] * c + slot.p[2] * s) * wp.s, wp.z + (-slot.p[0] * s + slot.p[2] * c) * wp.s];
      const y = wp.y + slot.p[1] * wp.s, level = this.levelOfY(y);
      const p = this.engine.standableNearV1(at, level, undefined, 0.4, 40);
      return p ? { p, level, what: `${path}:${room}` } : { error: `no standing room in ${path}:${room}`, endpoint: this.endpoint(`${path}:${room}`, at, y, level) };
    }
    const body = this.engine.world.entities[e.id];
    if (body?.human) return { p: [body.pose.p[0], body.pose.p[2]], level: body.human.level ?? 0, what: this.model.pathOf(e.id) };
    // an area or path at the root (a deck, a plaza, a pier) has no pose of its own (0, 0): its end is where a Soul walking
    // to it goes (nav: the deck's middle on its own floor, a pier's end platform, a plaza's centre)
    const sdef = this.model.resolvedDef(e.def), t = sdef && sdef.form !== 'point' && e.in.parent === 'world' && e.shape ? this.nav.thing(this.model.pathOf(e.id)) : undefined;
    if (t && t.kind !== 'water') {
      const g = this.nav.goal(t, t.at);
      return g ? { p: g.p, level: g.level, what: this.model.pathOf(e.id) } : { error: `no standing room on ${this.model.pathOf(e.id)}`, endpoint: this.endpoint(this.model.pathOf(e.id), t.at, t.level ? this.levels.find((l) => l.id === t.level)?.y ?? 0 : this.model.terrain.sample(t.at[0], t.at[1]), t.level) };
    }
    const wp = this.model.worldPose(e), level = body ? this.levelOfY(body.pose.p[1]) : this.levelOfY(wp.y);
    const p = this.engine.standableNearV1([wp.x, wp.z], level, undefined, 0.4, 40);
    return p ? { p, level, what: this.model.pathOf(e.id) } : { error: `no standing room near ${this.model.pathOf(e.id)}`, endpoint: this.endpoint(this.model.pathOf(e.id), [wp.x, wp.z], body ? body.pose.p[1] : wp.y, level) };
  }
  /** Engine level of a standing height at (x, z): 0 within reach of the terrain there (hills too), else a floor's level. */
  levelAt(x: number, z: number, y: number): number {
    // a registered floor at this height wins over the generous ground band: a raised floor 0.35–0.85 m up (the Mars
    // bays' 0.53 m plywood, lane MARS) is its own level, not the ground under it. Only a level with a floor here counts
    // (lane LEVELS): levels are shared by height across the world, and with one per floor height (~50 on a hillside
    // world) a shelf or a sunk ground floor elsewhere matched another building's level and had no standing room.
    const g = this.model.terrain.sample(x, z), here = (l: Level) => this.hasFloorAt(l.id, x, z);
    if (Math.abs(y - g) > GROUND_BAND) { const exact = this.levels.find((l) => Math.abs(l.y - y) <= LEVEL_MATCH && here(l)); if (exact) return exact.id; }
    if (Math.abs(y - g) <= GROUND_BAND + 0.5) return 0;
    const hit = this.levels.find((l) => Math.abs(l.y - y) <= 0.6 && here(l)); if (hit) return hit.id;
    const below = this.levels.filter((l) => l.y <= y + 0.5 && here(l)).sort((a, b) => b.y - a.y)[0];
    return below?.id ?? 0;
  }
  /** Floors per upper level: the engine's (cached per physics hash) and those derived in the current send. */
  private floorIndex: { hash: string; by: Map<number, FloorCells> } | null = null;
  /** During a send: the floors derived so far, and the entities it re-derives (their engine floors are being replaced). */
  private sendFloors = new Map<number, OBB2[]>();
  private sendIds: Set<string> | null = null;
  private hasFloorAt(level: number, x: number, z: number): boolean {
    const hash = this.physics?.hash ?? '';
    if (this.floorIndex?.hash !== hash) {
      const by = new Map<number, FloorCells>();
      for (const [id, part] of Object.entries(this.physics?.byEntity ?? {}) as [string, Part][]) for (const f of part.surfaces ?? []) if (f.level) { let a = by.get(f.level); if (!a) by.set(f.level, (a = new FloorCells())); a.add(id, f.obb); }
      this.floorIndex = { hash, by };
    }
    const at: Vec2 = [x, z], near = (o: OBB2) => pointInObb(at, o, FLOOR_NEAR);
    const send = this.sendIds;
    return !!(this.floorIndex.by.get(level)?.some(x, z, (f) => !send?.has(f.id) && near(f.obb)) || (send && this.sendFloors.get(level)?.some(near)));
  }
  private levelOfY(y: number) { if (Math.abs(y) > GROUND_BAND) { const exact = this.levels.find((l) => Math.abs(l.y - y) <= LEVEL_MATCH); if (exact) return exact.id; } if (Math.abs(y) <= GROUND_BAND + 0.5) return 0; const l = this.levels.reduce<Level | null>((b, l) => (l.y <= y + 0.5 && (!b || l.y > b.y) ? l : b), null); return l?.id ?? 0; }
  reach(from: ReachEnd, to: ReachEnd) {
    const a = this.endOf(from), b = this.endOf(to);
    if ('error' in a) return { reachable: false, code: 'reach.bad-from', detail: a.error, ...(a.endpoint ? { endpoint: { side: 'from', ...a.endpoint } } : {}) };
    if ('error' in b) return { reachable: false, code: 'reach.bad-to', detail: b.error, ...(b.endpoint ? { endpoint: { side: 'to', ...b.endpoint } } : {}) };
    const r = this.engine.reachV1({ p: a.p, level: a.level }, { p: b.p, level: b.level });
    return r.ok ? { reachable: true, from: { ...a }, to: { ...b }, length: r.length, legs: r.legs, levels: r.levels }
      : { reachable: false, from: { ...a }, to: { ...b }, code: r.code, detail: r.message };
  }

  // ------------------------------------------------------------------ Souls: capabilities on god things, prayers

  private hookEdge(L: EdgeLedger) {
    L.bodyPlacesReady = () => this.readSide || this.places.hasPublished();
    // B-facade: read workers get this bridge's physics facts with the delta (split/verdict-pump.ts ledgerEnv)
    if (!this.readSide) (L as unknown as { godPhysicsV1?: unknown }).godPhysicsV1 = { hash: () => this.physics?.hash ?? '', read: () => this.readPhysicsV1() };
    // G1/R8: a resident's next observation carries what the god just did around it (newest first).
    const observe = L.observe.bind(L);
    L.observe = (soul, include) => {
      const out = observe(soul, include), notices = this.notices.recent(soul.soulId);
      if (notices.length) out.notices = notices;
      return out;
    };
    L.intents.planRefusal = (soul, steps, target) => this.layers.constructionRefusal(soul, steps, target);
    const priorUseRefusal = L.nativeUseRefusal;
    L.nativeUseRefusal = (capability, steps) => priorUseRefusal?.(capability, steps) ?? this.bedUseRefusal(capability, steps);
    // R4-INFO: god-built places are walkable (map, plain-words resolution, `via`), and the map follows the god's edits
    L.placeWalkable = (id) => this.readSide ? this.readWalkable.has(id) : this.places.walkable(id);
    // On-demand plans are appended after the full profile's layer pass. Apply
    // the same admission to just those new offers, with no economy enumeration.
    // Keep blocked offers and the builder's result: resolution must report that
    // exact refusal rather than silently try another destination.
    const pass = <T>(what: string, f: () => T, none: T): T => { let out = none; try { const go = () => { out = f(); }, eng = this.engine as unknown as { readPassV1?: (f: () => void) => void }; if (eng.readPassV1) eng.readPassV1(go); else go(); } catch (e) { this.log(`${what}: ${(e as Error).message}`); } releaseBigScratch(); return out; };
    const offer = <T>(what:string,soul:EdgeSoul,caps:EdgeCapability[],plans:Parameters<GodNav['walkOnDemand']>[3],f:()=>T,none:T):T => pass(what,()=>{
      const start=caps.length;
      try {
        const out=f();
        if(caps.length>start&&this.layers.active())this.layers.capabilities(soul,caps.slice(start),plans as never,null);
        return out;
      } catch(error) {
        // A failed admission pass cannot leave an unmasked offer reachable by
        // the resolver's later exact-ID or vocabulary fallback.
        for(const c of caps.splice(start))plans.delete(c.id);
        throw error;
      }
    },none);
    // A far named place asked for by name, by exact ID/ref, as a floor or
    // a named thing gets one ordinary offer with the same layer admission.
    L.gaitOnDemand = (soul,id,gait,caps,plans) => offer('gait on demand',soul,caps,plans,()=>this.nav.gaitOnDemand(soul,id,gait,caps,plans),false);
    L.walkOnDemand = (soul,id,caps,plans) => offer('walk on demand',soul,caps,plans,()=>this.nav.walkOnDemand(soul,id,caps,plans),false);
    L.thingOnDemand = (soul,ask,caps,plans) => offer('thing on demand',soul,caps,plans,()=>this.nav.thingOnDemand(soul,ask,caps,plans,tokenHit),null);
    L.walkRefOnDemand = (soul,ref,caps,plans) => offer('walk ref on demand',soul,caps,plans,()=>this.nav.walkRefOnDemand(soul,ref,caps,plans),false);
    L.floorOnDemand = (soul,q,caps,plans) => offer('floor on demand',soul,caps,plans,()=>this.nav.floorOnDemand(soul,q,caps,plans,tokenHit),null);
    L.floorsNear = (at, radius) => pass('floors near', () => this.floorsNear(at, radius), []);
    L.thingAt = (id) => { const t = this.nav.thingById(id); return t ? [t.at[0], t.at[1]] : null; };
    L.thingWords = () => pass('thing words', () => this.nav.thingWords(), [] as string[]);
    L.beforeMap = () => { this.flush(); this.perceiveSync(); };
    const prev = L.worldProfile;
    L.worldProfile = (soul, caps, plans) => { prev?.(soul, caps, plans); try { this.capabilities(soul, caps, plans as never); } catch (e) { this.log(`capabilities: ${(e as Error).message}`); } };
    L.exactAuthoredWalkRef=ref=>this.nav.exactPlaceWalkRef(ref);
    // Match resolveOnDemand's exact place-ID precedence, before its by-ref
    // fallback. A colliding native/authored place ID must keep full resolution.
    const exactAreaPlace=(ref:string)=>[ref,'g-'+ref].find(id=>L.places.byId.has(id));
    L.exactAuthoredAreaWalkRef=ref=>{const id=exactAreaPlace(ref);return !!id&&this.places.forRef(ref)?.of==='area'&&this.nav.exactAreaWalkRef(ref,id);};
    L.registerExactWalkProfile(L.worldProfile,prev,(soul,asked,caps,plans)=>{
      let selected=false;
      const read=()=>{
        // Native bindings/profile precede GodNav exactly as in the full list.
        const ref=asked.slice(5),areaPlace=exactAreaPlace(ref);
        selected=caps.some(c=>c.id===asked)||this.nav.exactListedWalk(soul,ref,caps,plans)
          || (!!areaPlace&&L.exactAuthoredAreaWalkRef!(ref)&&this.nav.exactAreaWalkOnDemand(soul,ref,areaPlace,caps,plans));
        if(!selected)return;
        const me=this.engine.world.entities[soul.entityId];
        if(this.layers.active())this.layers.capabilities(soul,caps,plans as never,me?[me.pose.p[0],me.pose.p[2]]:null);
      };
      const eng=this.engine as unknown as {readPassV1?:(f:()=>void)=>void};
      try{if(eng.readPassV1)eng.readPassV1(read);else read();}finally{releaseBigScratch();}
      return selected;
    });
    if (this.readSide) return;   // a worker never acts: main does
    const act = L.act.bind(L), self = this;
    (L as any).act = async function (soul: EdgeSoul, input: { capability?: unknown; params?: unknown; clientRef?: unknown }) {
      if (input?.capability === 'pray' || (typeof input?.capability === 'string' && /^pray(\s|:|$)/.test(input.capability))) return self.pray(L, soul, input);
      if (typeof input?.capability === 'string' && /^(buy|pay|sell):/.test(input.capability)) return self.trade(L, soul, input as { capability: string; params?: unknown; clientRef?: unknown });
      const res: any = await act(soul, input as never);
      // E-life B2: an accepted eat takes its portion from the kitchen now; the receipt says which meal it is
      if (res?.accepted && res.receipt?.id && typeof input?.capability === 'string' && self.meals) {
        const meal = self.meals.reserve(input.capability, res.receipt.id);
        if (meal) { const row = L.db.db.prepare('SELECT detail FROM edge_receipts_v1 WHERE world_id=? AND receipt_id=?').get(L.host.worldId, res.receipt.id) as { detail: string | null } | undefined;
          const d = row?.detail ? JSON.parse(row.detail) : {}; L.db.db.prepare('UPDATE edge_receipts_v1 SET detail=? WHERE world_id=? AND receipt_id=?').run(JSON.stringify({ ...d, meal }), L.host.worldId, res.receipt.id);
          res.receipt = L.receipt(soul.soulId, res.receipt.id) ?? res.receipt; }
      }
      return res;
    };
  }
  /** beds/1: a bed is lain on through its engine asset's native berths (catalog-adapter berthSlots: an adult fits on it).
   * A bed without one (a crib, a pram, a bathtub, a bunk's upper berth only) is refused by name and never offered;
   * a generic floor pose is never substituted for use of a named bed. */
  private bedUseRefusal(capability: string, steps?: { verb: string; params: Record<string, unknown> }[]): {code: string; reason: string} | null {
    const target = /^(?:lie|sleep):(.+)$/.exec(capability)?.[1];
    if (!target) return null;
    const e = this.model.entities.get(target);
    if (!e || !this.isBed(target)) return null;
    if (this.berthsOf(target)) {
      // a plan for this bed (an older server's queued bedside floor pose included) must lie on the bed's own berth
      if (!steps || steps.some((s) => s.verb === 'mars:take_slot' && (s.params.owner === target || String(s.params.slot ?? '').startsWith(`${target}#`)))) return null;
      return {code: 'bed.native-berth-required', reason: `${this.model.pathOf(target)} is used by lying on its berth (${capability}), not by a pose beside it.`};
    }
    return {code: 'bed.attachment-unavailable', reason: `${this.model.pathOf(target)} has no berth an adult can lie on (it is too short, or its mattress too high or too low); your body cannot lie or sleep on it.`};
  }
  private isBed(id: string): boolean {
    const e = this.model.entities.get(id);
    return !!e && (!!this.model.resolvedDef(e.def)?.components.bed || this.model.slotsOf(e).some(s => s.kind === 'bed'));
  }
  /** beds/1: how many native berths the engine asset of god-built thing `id` has (0 when none qualified). */
  private berthsOf(id: string): number {
    const x = this.engine.world.entities[id];
    const asset = (x ? this.physics?.assets[x.def] : undefined) as { slots?: { kind: string }[] } | undefined;
    return asset?.slots?.filter((s) => s.kind === 'berth').length ?? 0;
  }
  private pray(L: EdgeLedger, soul: EdgeSoul, input: { capability?: unknown; params?: unknown; clientRef?: unknown }) {
    const params = (input.params ?? {}) as { text?: unknown };
    const text = typeof params.text === 'string' ? params.text.trim() : typeof input.capability === 'string' ? input.capability.replace(/^pray[:\s]*/, '').trim() : '';
    if (!text) return { accepted: false as const, capability: 'pray', code: 'capability.params', reason: 'pray needs {"text": "…"} (what you ask of the god of this world)' };
    try {
      const p = this.god.pray({ id: soul.soulId, name: soul.name }, text);
      const r = (L as any).insert(soul, 'pray', 'completed', typeof input.clientRef === 'string' ? input.clientRef : undefined, true, { prayer: p.id });
      return { accepted: true as const, receipt: (L as any).receipt(soul.soulId, r.id), result: { prayer: p.id, note: 'The god reads prayers when present; answers appear in GET /v1/god/prayers/mine.' } };
    } catch (e) { const err = e as { code?: string; message?: string }; return { accepted: false as const, capability: 'pray', code: err.code ?? 'pray.refused', reason: err.message ?? 'the prayer was not heard' }; }
  }

  /** LAYERS: buy:<id>, pay:<soul>, sell:<id> — validated by the world (layers.ts), a completed receipt like pray. */
  private trade(L: EdgeLedger, soul: EdgeSoul, input: { capability: string; params?: unknown; clientRef?: unknown }) {
    const me = this.engine.world.entities[soul.entityId], here: Vec2 | null = me?.pose?.p ? [me.pose.p[0], me.pose.p[2]] : null;
    const r = this.layers.act(soul, input.capability, (input.params ?? {}) as Record<string, unknown>, here);
    if (!r.accepted) return { accepted: false as const, capability: input.capability, code: r.code, reason: r.reason };
    const row = (L as any).insert(soul, input.capability.split(':')[0], 'completed', typeof input.clientRef === 'string' ? input.clientRef : undefined, true, r.result);
    return { accepted: true as const, receipt: (L as any).receipt(soul.soulId, row.id), result: r.result };
  }

  // ---- B-facade: the read side in a read worker (split/read-bridge.ts)
  /** The god places main's layer installed in the ledger (PlaceIndex ids; shipped with the static layer). */
  private readWalkable = new Set<string>();
  /** What main's bridge last derived for the engine (physics hash, its levels, the asset facts the listing reads). */
  readPhysicsV1(): BridgePhysicsV1 | null {
    const p = this.physics; if (!p) return null;
    const assets: BridgePhysicsV1['assets'] = {};
    for (const [k, a] of Object.entries(p.assets ?? {}) as [string, { slots?: { kind: string }[]; surfaceSlots?: { id: string; local?: number[] }[]; category?: string }][])
      assets[k] = { ...(a.slots ? { slots: a.slots.map((s) => ({ kind: s.kind })) } : {}), ...(a.surfaceSlots ? { surfaceSlots: a.surfaceSlots.map((s) => ({ id: s.id, ...(s.local ? { local: [...s.local] } : {}) })) } : {}), ...(a.category ? { category: a.category } : {}) };
    const floors: NonNullable<BridgePhysicsV1['floors']> = {};
    for (const [id, part] of Object.entries(p.byEntity ?? {}) as [string, Part][]) for (const f of part.surfaces ?? []) if (f.level) (floors[id] ??= []).push({ level: f.level, obb: structuredClone(f.obb) });
    return { hash: p.hash ?? '', levels: structuredClone(this.levels), assets, floors };
  }
  /** A read worker: adopt main's physics facts and walkable god places; bring the god model to main's last commit
   *  (GodReplica.sync) and catch perception up at once (main does it in slices after its ticks). */
  readAdopt(o: { physics?: BridgePhysicsV1 | null; walkable?: readonly string[] }) {
    if (o.physics !== undefined) { this.physics = (o.physics ? { hash: o.physics.hash, assets: o.physics.assets, levels: o.physics.levels, byEntity: Object.fromEntries(Object.entries(o.physics.floors ?? {}).map(([id, fs]) => [id, { surfaces: fs }])) } : undefined) as never; this.floorIndex = null as never; this.levels = o.physics ? structuredClone(o.physics.levels) as Level[] : []; }
    if (o.walkable) this.readWalkable = new Set(o.walkable);
  }
  readSync(): boolean {
    const moved = (this.god as unknown as { sync(): boolean }).sync();
    if (moved || this.perceive.pending()) this.perceiveSync(true);
    return moved;
  }

  /** Continuity (warm after listen, EdgeLedger.warmForServing): what this Soul's first listing would build on this side
   *  of the edge, in steps of about `sliceMs`: the god's places (derived and published to the ledger, as the boot's own
   *  sliced catch-up does), the named things, the first perception catch-up (the
   *  slices the tick runs, perceiveStep; a listing otherwise runs it whole, perceive.ensure), the activity spots, then
   *  the walk goals one thing at a time (GodNav.servingWarmGen). The caches the listing fills; no world state changes. */
  *servingWarmGen(soul: EdgeSoul, sliceMs: number): Generator<void, void, void> {
    while (!this.places.syncStep(sliceMs)) yield;   // as the tick's own catch-up (layersStep) and a listing publish them
    yield;
    yield* this.nav.thingsGen(); yield;
    if (!this.perceive.stats.runs) { try { while (!this.perceive.step(sliceMs)) yield; } catch (e) { this.log(`perceive: ${(e as Error).message}`); } yield; }
    yield* this.activitySpots.servingWarmGen(sliceMs); yield;
    try { return yield* this.nav.servingWarmGen(soul); } finally { releaseBigScratch(); }
  }

  /** Capabilities on god-placed things near this Soul: sit on chairs, pick up items, put them on tables; and pray. */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>) {
    // L1: the walk listing only reads the world; the engine's planner syncs once for all of it (readPassV1). S2: so does
    // the rest of this listing (the standing points beside near items, seats, layers): one sync and one list of bodies.
    const list = () => this.listCapabilities(soul, caps, plans), eng = this.mw;
    if (eng.readPassV1) eng.readPassV1(list); else list();
  }
  private listCapabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>) {
    // L3 item 4: a focused build (EdgeLedger.bindOne) offers only the walks the focus names
    const focus = (this.edge as { menuFocusV1?(): MenuFocus | null } | undefined)?.menuFocusV1?.() ?? null;
    try { this.nav.capabilities(soul, caps, plans, focus); } catch (e) { this.log(`nav capabilities: ${(e as Error).message}`); }
    releaseBigScratch();   // L1: room-reach searches inside a multi-storey house share one ~110 MB workspace; not kept after
    // B-facade item 4 (L3 b4): a focused build (bindOne / words act) runs only the sections whose offers the focus can name:
    // the object scans read every entity of the world (three passes) and perceive/layers scan signs and stalls
    const named = (...verbs: string[]) => !focus || focus.targets.size > 0 || verbs.some((v) => wantsPrefix(focus, v + ':', v));
    if (named('read')) try { this.perceive.capabilities(soul, caps, plans); } catch (e) { this.log(`perceive capabilities: ${(e as Error).message}`); }
    caps.push({ id: 'pray', verb: 'pray', label: 'Pray to the god of this world (params: {"text": "…"}); answers come back under GET /v1/god/prayers/mine', available: true, params: { text: { type: 'string', maxLength: 2000 } } });
    const ents = this.mw.world.entities as Record<string, any>, me = ents[soul.entityId]; if (!me?.human) return;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]];
    if (named('sit', 'lie', 'sleep', 'pick-up', 'put-on', 'put-in', 'search')) {
      const held = Object.values(ents).find((x: any) => x.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === soul.entityId) as any;
      const name = (id: string) => (this.model.entities.has(id) ? this.model.pathOf(id) : String(ents[id]?.label ?? id));
      // MARSLIVED: a thing resting on a table is reached from the table's floor (its top's height matched Mimos's 0.53 m
      // raised floor, so a cup on the ground-floor tea table read "floor 1" and Souls were sent up there for it)
      const levelOf = (x: any) => { let s = x; for (let i = 0; i < 4 && s.support?.kind === 'resting-on' && ents[s.support.on]; i++) s = ents[s.support.on]; return this.levelOfY(s.pose.p[1]); };
      const near = Object.values(ents).filter((x: any) => x.tags?.includes('entity-world') && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) <= NEAR) as any[];
      near.sort((a, b) => Math.hypot(a.pose.p[0] - here[0], a.pose.p[2] - here[1]) - Math.hypot(b.pose.p[0] - here[0], b.pose.p[2] - here[1]) || (a.id < b.id ? -1 : 1));
      // SOULSIM-H F2: "sit on the bench" from 77 m sat on the ground (the bench was past NEAR, so only sit:here was offered).
      // The nearest few seats beyond NEAR are offered too (sit only), so a named seat resolves to its own walk-and-sit.
      const seatAsset = (x: any) => !!(this.physics?.assets[x.def] as { slots?: { kind: string }[] } | undefined)?.slots?.some((sl) => sl.kind === 'seat');
      near.push(...(Object.values(ents).filter((x: any) => x.tags?.includes('entity-world') && x.support?.kind !== 'in-hand' && seatAsset(x) && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) > NEAR && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) <= FAR_SEAT) as any[])
        .sort((a, b) => Math.hypot(a.pose.p[0] - here[0], a.pose.p[2] - here[1]) - Math.hypot(b.pose.p[0] - here[0], b.pose.p[2] - here[1]) || (a.id < b.id ? -1 : 1)).slice(0, FAR_SEATS));
      const approach = (x: any): { verb: string; params: Record<string, unknown> }[] => {
        const level = levelOf(x); if (level === (me.human.level ?? 0) && Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]) < 3) return [];
        const at = this.mw.standableNearV1!([x.pose.p[0], x.pose.p[2]], level, soul.entityId, 0.4, 16);
        return at ? [{ verb: 'mars:walk_to', params: { x: at[0], z: at[1], level } }] : [];
      };
      const stand = me.human.activity === 'sit' || me.human.baseActivity === 'sit' || me.human.berth ? [{ verb: 'stand', params: {} }] : [];
      // floors (2026-10-26): a seat the body cannot use names the nearest one it can (or the ground)
      const unusable: number[] = [], usable: { id: string; label: string; d: number }[] = [];
      for (const x of near) {
        // #435 (W068): a thing in a hiding place has no offers of its own, of any kind; only the place's search finds it
        if (x.support?.kind === 'resting-on' && this.keptIn(x)?.hidden) continue;
        const asset = (this.physics?.assets[x.def] ?? {}) as { slots?: { kind: string }[]; surfaceSlots?: { id: string; inside?: unknown }[]; category?: string };
        const d = Math.round(Math.hypot(x.pose.p[0] - here[0], x.pose.p[2] - here[1]));
        if (asset.slots?.some((s) => s.kind === 'seat')) {
          const u = this.mw.bodyUsesV1!(x.id), mine = u?.body === soul.entityId;
          const seats = asset.slots.filter((s) => s.kind === 'seat').length, taken = this.seatTakers(x.id), others = taken.filter((b) => b !== soul.entityId);
          // what it is and what it is by (P4): "Sit on e_… (a bench, by pond; 12 m)" — so "sit on the bench by the pond"
          // resolves through the ledger's vocabulary (every word in the label) to this seat and not another bench
          const ent = this.model.entities.get(x.id), kind = ent ? this.model.resolvedDef(ent.def)?.name.replace(/^core-/, '') : undefined;
          const by = ent ? this.nav.namesNear([x.pose.p[0], x.pose.p[2]], x.id) : [];
          const id = `sit:${x.id}`, labelOf = (seatWords: string) => `${name(x.id)} (${kind && !name(x.id).split('/').pop()!.includes(kind) ? `a ${kind}, ` : ''}${seatWords}${by.length ? `by ${by.join(' and ')}; ` : ''}${d} m${levelOf(x) ? `, ${this.floorWord(x)}` : ''})`;
          // F1: a bench for two stays free while one of its seats is; the seat a Soul sits on is not free to itself
          const full = others.length >= seats || (!!u && !mine && seats <= 1);
          // seat fit (engine bodies/humanoid.ts): a body whose look sets its height cannot get onto a seat too high for it.
          // SEATDEF: the heights are the def's seat heights as the use-check reads them (seatTopsOf: engine seat slots carry
          // none, so this read nothing before). Only too-high blocks: a seat lower than a body likes (a floor cushion) is sat on.
          const tops = [...seatTopsOf(this.model, x.id).values()].filter((y) => Number.isFinite(y));
          const misfit = tops.length && tops.every((y) => seatFitProblem(me.body, y)?.code === 'seat.too-high') ? seatFitProblem(me.body, Math.min(...tops)) : null;
          // floors (2026-10-26): the sitter's feet rest on the floor under the seat (the terrain, or a floor plate on it); a
          // thing standing higher than that floor (on a deck the world does not walk on) would seat the body inside it
          const feet = levelOf(x) === 0 ? this.mw.standYAtV1?.(x.pose.p[0], x.pose.p[2], 0) : undefined, lift = typeof feet === 'number' ? x.pose.p[1] - feet : 0;
          // a floating thing (a moored canoe, party S8) rides above the pond floor by design and is boarded from its side
          const afloat = !!ent && isFloatingDef(this.model.resolvedDef(ent.def) as { components: Record<string, unknown> });
          const inside = !afloat && lift > SEAT_LIFT ? { code: 'seat.inside', reason: `${name(x.id)} stands ${lift.toFixed(2)} m above the floor you would stand on there, on something the world does not walk on: sitting on it would put you inside it.` } : null;
          const top = tops.length ? Math.min(...tops) : undefined, ownDef = ent ? this.model.resolvedDef(ent.def) : undefined;
          const onTop = top !== undefined && ownDef && ownDef.size.box[1] > 0 && top >= ownDef.size.box[1] * (ent ? this.model.worldPose(ent).s : 1) - 0.05 ? `sit on top, ${top.toFixed(2)} m high; ` : top !== undefined ? `seat ${top.toFixed(2)} m high; ` : '';
          const block = mine ? { code: 'seat.yours', reason: `You are sitting on ${name(x.id)} already; stand:here to get up.` } : full ? { code: 'seat.taken', reason: `${(others.length ? others : [u!.body]).map((b) => this.soulName(b)).join(' and ')} ${others.length > 1 ? 'are' : 'is'} sitting there.` } : misfit ? { code: misfit.code, reason: `${name(x.id)} does not fit your body: ${misfit.message}.` } : inside;
          const label = labelOf(onTop);
          if (block?.code === 'seat.inside' || block?.code === 'seat.too-high') unusable.push(caps.length); else if (!block) usable.push({ id, label, d });
          caps.push({ id, verb: 'sit', label, target: { id: x.id, kind: 'object' }, available: !block, ...(block ? { blocked: block } : {}), params: { seconds: { type: 'integer', min: 1, max: 600, default: 60 } } });
          plans.set(id, { label, steps: [{ verb: 'sit', params: { on: x.id, seconds: 60 } }], seconds: true });
        }
        if (d > NEAR) continue; // F2: a far seat is offered for sitting only
        // beds/1: a bed with native berths is lain on through the engine's take_slot (walk to its side, lie down on the
        // mattress, rest, get up); a bed no adult fits on is not offered at all (bedUseRefusal names it if asked by id)
        const berths = x.support?.kind !== 'in-hand' && this.isBed(x.id) ? this.berthsOf(x.id) : 0;
        if (berths) {
          const occ = this.mw.seatOccupantsV1?.(x.id, 'berth') ?? [];
          const mine = occ.some((o) => o.body === soul.entityId), others = occ.filter((o) => o.body !== soul.entityId).map((o) => o.body);
          const block = mine ? { code: 'bed.yours', reason: `You are lying on ${name(x.id)} already; stand:here to get up.` }
            : others.length >= berths ? { code: 'bed.taken', reason: `${others.map((b) => this.soulName(b)).join(' and ')} ${others.length > 1 ? 'are' : 'is'} lying there.` } : null;
          for (const [verb, activity, sec] of [['lie', 'lie', 120], ['sleep', 'nap', 600]] as const) {
            const id = `${verb}:${x.id}`, label = `${verb === 'lie' ? 'Lie down on' : 'Sleep in'} ${name(x.id)} (${d} m${levelOf(x) ? `, ${this.floorWord(x)}` : ''})`;
            caps.push({ id, verb, label, target: { id: x.id, kind: 'object' }, available: !block, ...(block ? { blocked: block } : {}), params: { seconds: { type: 'integer', min: 1, max: 600, default: sec } } });
            plans.set(id, { label, steps: [...stand, { verb: 'mars:take_slot', params: { owner: x.id, activity } }, { verb: 'rest', params: { seconds: sec } }, { verb: 'stand', params: {} }], seconds: true });
          }
        }
        // Upright loads explicitly opted in by the authored def reuse the native
        // fixture mover: two hands, native reservations/clearance, no teleport.
        const handling=(asset as {capabilities?:{fixtureCarry?:{handling:{carryCrew:[number,number];carryHeight:number}}}}).capabilities?.fixtureCarry?.handling;
        if(handling){
          const modelEntity=this.model.entities.get(x.id),def=modelEntity&&this.model.resolvedDef(modelEntity.def);
          if(def?.components.carryable&&def.tags.includes('upright-carry')){
            const mass=(asset as {massKg?:number}).massKg??0,need=Math.max(handling.carryCrew[0],Math.ceil(mass/MAX_KG_PER_CARRIER));
            const denied=this.layers.refusal(x.id,soul), occupied=this.seatTakers(x.id).some(id=>id!==soul.entityId);
            const block=denied??(occupied?{code:'carry.occupied',reason:'Someone else is using this seat; wait until they stand up.'}:null)??(need>1?{code:'carry.crew-too-small',reason:`${name(x.id)} needs ${need} carriers; a solo carry allows at most ${MAX_KG_PER_CARRIER} kg.`}:held||me.human.grip?{code:'carry.hands-full',reason:'Put down what you are holding before using both hands.'}:x.support?.kind!=='ground'||x.phase==='carried'?{code:'carry.in-use',reason:`${name(x.id)} is in use or not resting on the ground.`}:(me.human.level??0)!==0||Math.abs(x.pose.p[1])>.01?{code:'carry.ground-only',reason:'This upright carry starts and finishes on level-zero ground.'}:((asset as {size?:number[]}).size?.[1]??0)>handling.carryHeight*2-.1?{code:'carry.too-tall',reason:`${name(x.id)} cannot clear the ground at this hand height.`}:null);
            const id=`carry:${x.id}`,label=`Carry ${name(x.id)} upright with both hands, then set it down (to: a place name)`;
            caps.push({id,verb:'carry',label,target:{id:x.id,kind:'object'},available:!block,...(block?{blocked:block}:{}),params:{to:{type:'string',maxLength:100}}});
            if(!block)plans.set(id,{label,steps:[...stand,{verb:'mars:move_fixture',params:{fixture:x.id,to:{x:here[0],z:here[1],yaw:x.pose.yaw??0}}}]});
          }
        }
        // PC03 (#682): a loose material (its def carries the native material's handling) is carried with both hands by the
        // native crew `carry`, never offered as a one-hand pick-up; a load that needs more carriers says how many, and a
        // solo carry of it is refused before any motion
        const loose=asset.category==='item'&&(asset as {handling?:{carryCrew:[number,number];small?:true}}).handling;
        if(loose&&!loose.small&&x.support?.kind!=='in-hand'){
          const mass=(asset as {massKg?:number}).massKg??0,need=Math.max(loose.carryCrew[0],Math.ceil(mass/MAX_KG_PER_CARRIER));
          // PC04 (#683, PC02 §1): a `shared-carry` load can be proposed as a carry with other Souls (behind the sharedCarry flag)
          const sharedDef=this.edge?.sharedCarry?this.model.entities.get(x.id):undefined,sdef=sharedDef&&this.model.resolvedDef(sharedDef.def),shareable=!!sharedDef&&!!sdef?.tags.includes('shared-carry');
          // PC06 (#685, PC02 §4): the solo refusal names the way to carry it with others when that is on offer
          const block=this.layers.refusal(x.id,soul)??(need>1?{code:'carry.crew-too-small',reason:`${name(x.id)} (${mass} kg) needs ${need} carriers; one person carries at most ${MAX_KG_PER_CARRIER} kg.${shareable&&need<=Math.min(loose.carryCrew[1],8)?` Ask others to carry it with you: carry-with:${x.id} (to: a place, with: who).`:''}`}:held||me.human.grip?{code:'carry.hands-full',reason:'Put down what you are holding before using both hands.'}:x.phase==='carried'||x.reservedBy?{code:'carry.in-use',reason:`${name(x.id)} is being carried.`}:(me.human.level??0)!==0||levelOf(x)!==0||x.support?.kind!=='ground'||Math.abs(x.pose.p[1])>.05?{code:'carry.ground-only',reason:`${name(x.id)} is carried from level-zero ground to level-zero ground; it is not lying on the ground here.`}:null);
          const id=`carry:${x.id}`,label=`Carry ${name(x.id)} with both hands, then lay it down (to: a place name)${need>1?`; it needs ${need} carriers`:''}`;
          caps.push({id,verb:'carry',label,target:{id:x.id,kind:'object'},available:!block,...(block?{blocked:block}:{}),params:{to:{type:'string',maxLength:100}}});
          if(!block)plans.set(id,{label,steps:[...stand,{verb:'mars:carry',params:{crew:[soul.entityId],item:x.id,to:{x:here[0],z:here[1],yaw:x.pose.yaw??0}}}]});
          // Proposing moves nobody: it is a together invitation, so the plan has no body steps.
          if(sharedDef&&shareable){
            const crew:[number,number]=[need,Math.min(loose.carryCrew[1],8)],sid=`carry-with:${x.id}`;
            const sblock=this.layers.refusal(x.id,soul)??(need>crew[1]?{code:'carry.crew-too-large',reason:`${name(x.id)} needs more carriers than it has grips.`}:held||me.human.grip?{code:'carry.hands-full',reason:'Put down what you are holding before using both hands.'}:x.phase==='carried'||x.reservedBy?{code:'carry.in-use',reason:`${name(x.id)} is being carried.`}:(me.human.level??0)!==0||levelOf(x)!==0||x.support?.kind!=='ground'||Math.abs(x.pose.p[1])>.05?{code:'carry.ground-only',reason:`${name(x.id)} is carried from level-zero ground to level-zero ground; it is not lying on the ground here.`}:null);
            const slabel=`Carry ${name(x.id)} with other Souls (asks them first; ${crew[0]}–${crew[1]} carriers; to: a place name, with: who)`;
            caps.push({id:sid,verb:'carry-with',label:slabel,target:{id:x.id,kind:'object'},available:!sblock,...(sblock?{blocked:sblock}:{}),params:{to:{type:'string',maxLength:100},with:{type:'string',maxLength:300,description:'the Souls who carry it with you (names or ids, comma-separated)'},invite:{type:'string',optional:true,description:'amend your own open proposal'}}});
            // `def` is the placed def ref with its revision (for example core/rack-beam@2): the load's identity (PC02 §4)
            const splan={label:slabel,steps:[],together:{kind:'shared' as const,load:x.id,def:sharedDef.def,name:name(x.id),crew}};
            if(!sblock)plans.set(sid,splan);
          }
        }
        // entry 42: a thing kept inside a container is seen, offered and named only while the container is open
        const kept = asset.category === 'item' && x.support?.kind === 'resting-on' ? this.keptIn(x) : null;
        if (asset.category === 'item' && !(loose && !loose.small) && x.support?.kind !== 'in-hand' && !held && (!kept || (kept.open && d <= STORE_NEAR))) {
          const note = kept && d <= FACTS_NEAR ? this.keptNote(kept.id, x.id, soul) : null;
          const id = `pick-up:${x.id}`, label = kept ? `Take ${name(x.id)}${note ? ` (${note})` : ''} out of ${kept.label} (${d} m)` : `Pick up ${name(x.id)} (${d} m${levelOf(x) ? `, ${this.floorWord(x)}` : ''})`;
          const block = kept ? this.storageRefusal(kept, soul) ?? this.claimRefusal(x.id, soul, d <= FACTS_NEAR) : null;
          caps.push({ id, verb: 'pick-up', label, target: { id: x.id, kind: 'item' }, available: !block, ...(block ? { blocked: block } : {}) });
          const precise=(this.physics?.assets[x.def] as {capabilities?:{recordedItemPoseV1?:boolean}})?.capabilities?.recordedItemPoseV1&&levelOf(x)===(me.human.level??0);
          // entry 43: an opted-in pick-up lets an idle gesture go before the hand reaches (entry 41's M04 finding)
          plans.set(id, { label, steps: [...stand, ...(precise?[{ verb: 'mars:let_go_v1', params: {} }]:kept?[]:approach(x)), { verb: 'mars:take_item', params: { item: x.id, hand: 'right' } }] });
        }
        const inner = (asset.surfaceSlots as { id: string; inside?: { fit: number[] } }[] | undefined)?.filter((sl) => sl.inside) ?? [];
        // #435 (W068): search a hiding place. The offer reads the same whether or not anything is there: the hand reaches in,
        // and takes what it finds; an empty place gets the same walk and a reach, and the hand comes away with nothing
        if (inner.length && d <= STORE_NEAR) {
          const box = this.storage(x.id);
          if (box?.hidden) {
            const station = this.standAt(x, box, levelOf(x), soul.entityId);
            const block = this.storageRefusal(box, soul) ?? (held || me.human.grip ? { code: 'carry.hands-full', reason: `Put down what you are holding before searching ${box.label}.` } : !station ? { code: 'container.no-room', reason: `There is no room to stand at ${box.label}.` } : null);
            const id = `search:${x.id}`, label = `Search ${box.label} (a ${box.kind}, ${d} m)`;
            caps.push({ id, verb: 'search', label, target: { id: x.id, kind: 'object' }, available: !block, ...(block ? { blocked: block } : {}) });
            // a thing this Soul may not take (private, for sale, claimed) is as if it were not there: the same reach, and nothing leaks
            const found = Object.values(ents).find((o: any) => o.support?.kind === 'resting-on' && o.support.on === x.id && inner.some((sl) => sl.id === o.support.slot) && !this.layers.takeRefusal(o.id, soul) && !this.claimRefusal(o.id, soul)) as any;
            // #435: a second seeker while another Soul's hand is in the place waits her turn there, then reaches in: an answer, not a
            // refusal
            // and one who comes while another Soul's search of it is under way leaves it to them and is told so: one finds it
            const turn = this.reachLeft(x.id, soul.entityId), rival = !!found && !turn && !!this.edge?.openByOthers(id, soul.soulId);
            if (rival) this.yielded.add(`${soul.entityId}:${x.id}`); else this.yielded.delete(`${soul.entityId}:${x.id}`);
            if (!block) plans.set(id, { label, steps: rival ? [...stand, { verb: 'rest', params: { seconds: 1 } }] : found && !turn ? [...stand, { verb: 'mars:let_go_v1', params: {} }, { verb: 'mars:take_item', params: { item: found.id, hand: 'right' } }] : [...stand, ...this.reachInto(x, box, station!, levelOf(x), turn)] });
          }
        }
        if (held && inner.length && d <= STORE_NEAR) {
          const box = this.storage(x.id);
          if (box) {
            const taken = new Set(Object.values(ents).filter((o: any) => o.support?.kind === 'resting-on' && o.support.on === x.id).map((o: any) => o.support.slot));
            const free = inner.find((sl) => !taken.has(sl.id)), size = (this.physics?.assets[held.def] as { size?: number[] } | undefined)?.size;
            const hd = this.model.entities.get(held.id), hdef = hd && this.model.resolvedDef(hd.def), lit = !!hdef && !!(hdef.components.light || hdef.components.lights) && actuatedState(hd!, hdef).on !== false;
            const fit = inner[0].inside!.fit, m2 = (v: number) => v.toFixed(2), fits = !size || (size[1] <= fit[1] + 1e-6 && ((size[0] <= fit[0] + 1e-6 && size[2] <= fit[2] + 1e-6) || (size[2] <= fit[0] + 1e-6 && size[0] <= fit[2] + 1e-6)));
            const block = this.storageRefusal(box, soul)
              ?? (!fits ? { code: 'item.does-not-fit', reason: `${name(held.id)} (${size!.map(m2).join(' × ')} m) does not fit in ${box.label} (up to ${fit.map(m2).join(' × ')} m).` } : null)
              ?? (lit ? { code: 'item.lit', reason: `${name(held.id)} is lit; switch it off before putting it away.` } : null)
              ?? (!free ? { code: 'container.full', reason: `${box.label} is full (${inner.length} ${inner.length === 1 ? 'thing' : 'things'}).` } : null);
            const id = `put-in:${x.id}`, label = `Put ${name(held.id)} in ${box.label} (${box.hidden ? `a ${box.kind}, ` : ''}${d} m)`;
            caps.push({ id, verb: 'put-in', label, target: { id: x.id, kind: 'object' }, available: !block, ...(block ? { blocked: block } : {}) });
            if (free) plans.set(id, { label, steps: [...stand, { verb: 'mars:put_item', params: { item: held.id, surfaceSlot: `${x.id}#${free.id}` } }] });
          }
        }
        if (held && asset.surfaceSlots?.some((sl: { inside?: unknown }) => !sl.inside)) {
          const taken = new Set(Object.values(ents).filter((o: any) => o.support?.kind === 'resting-on' && o.support.on === x.id).map((o: any) => o.support.slot));
          // MARSLIVED: the free place nearest the Soul (the first free one was often on a table's far side, against a
          // counter: "put the cup on the prep table" failed as unreachable while the near end was free)
          // MARSLAND: engine poses carry the negated three.js yaw (fixtureSpec registers yaw: −wp.yaw); turn the slot's local
          // offset with the entity's own (three.js) yaw, or a turned table's places are mirrored and the far one is chosen
          const yw = -(x.pose.yaw ?? 0), at = (sl: { local?: number[] }) => { const l = sl.local ?? [0, 0, 0]; return [x.pose.p[0] + l[0] * Math.cos(yw) + l[2] * Math.sin(yw), x.pose.p[2] - l[0] * Math.sin(yw) + l[2] * Math.cos(yw)]; };
          const free = (asset.surfaceSlots as { id: string; local?: number[]; inside?: unknown }[]).filter((s) => !s.inside && !taken.has(s.id)).sort((a, b) => { const pa = at(a), pb = at(b); return Math.hypot(pa[0] - here[0], pa[1] - here[1]) - Math.hypot(pb[0] - here[0], pb[1] - here[1]); })[0];
          const id = `put-on:${x.id}`, label = `Put ${name(held.id)} on ${name(x.id)} (${d} m)`;
          caps.push({ id, verb: 'put-on', label, target: { id: x.id, kind: 'object' }, available: !!free, ...(free ? {} : { blocked: { code: 'surface.full', reason: `${name(x.id)} has no free place.` } }) });
          // The native item action already plans a slot-specific station. A generic
          // walk to the table can first put the body opposite the selected slot.
          const precise=(this.physics?.assets[held.def] as {capabilities?:{recordedItemPoseV1?:boolean}})?.capabilities?.recordedItemPoseV1&&levelOf(x)===(me.human.level??0);
          if (free) plans.set(id, { label, steps: [...stand, ...(precise?[]:approach(x)), { verb: 'mars:put_item', params: { item: held.id, surfaceSlot: `${x.id}#${free.id}` } }] });
        }
      }
      const alt = usable.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))[0];
      for (const i of unusable) { const b = caps[i].blocked; if (b) b.reason = `${b.reason} ${alt ? `Nearest seat you can use: ${alt.id} (${alt.label}).` : 'Sit on the ground instead: sit-ground:here.'}`; }
    }
    // (srv-r5 stroll fix: the construction / private / for-sale refusals read only the offers already built, so they run on
    // every focused build as on the whole menu; only the economy's buy/pay listing waits for a focus that names it. A words
    // walk to a closed site was offered available on its focused build.)
    if (this.layers.active()) try { this.layers.capabilities(soul, caps, plans as never, here, named('buy', 'pay', 'sell')); } catch (e) { this.log(`layers capabilities: ${(e as Error).message}`); }
    if (wants(focus, 'sit:here')) this.sitHere(caps, plans, here, soul.entityId);
    this.fireLit(caps);
    try { this.meals?.capabilities(caps); } catch (e) { this.log(`meals capabilities: ${(e as Error).message}`); }
  }
  /** Entry 42: a god container a Soul keeps things in (def containerInside), whether it is open, and its words. */
  storage(id: string) {
    const e = this.model.entities.get(id), def = e && this.model.resolvedDef(e.def), ins = containerInside(def);
    if (!e || !def || !ins) return null;
    const n = this.model.pathOf(id), word = ins.word;
    return { id, ins, hidden: containerHidden(def), kind: def.name.replace(/^core-/, '').replace(/-/g, ' '), open: containerOpen(def, actuatedState(e, def)), label: n.toLowerCase().split(/[^a-z0-9]+/).includes(word) ? n : `${n} (${word})`, word, name: n };
  }
  /** #435 (W068): where a body ends up to reach into a container (in the world), or null. */
  private standAt(x: { pose: { p: number[]; yaw?: number } }, box: NonNullable<ReturnType<EngineBridge['storage']>>, level: number, body: string): [number, number] | null {
    // where the engine's reach ends up (items/actions.ts insideLean): a step in from `stand`, at most 0.2 m, never within 0.35 m of the face
    const yw = -(x.pose.yaw ?? 0), [l, s0] = box.ins.stand, p = box.ins.slots[0].p, f = Math.max(box.ins.face + 0.35, s0 - Math.min(0.2, Math.max(0, Math.hypot(p[0] - l, p[2] - s0) - 0.5)));
    return this.mw.standableNearV1!([x.pose.p[0] + l * Math.cos(yw) + f * Math.sin(yw), x.pose.p[2] - l * Math.sin(yw) + f * Math.cos(yw)], level, body, 0.4, 16);
  }
  /** #435 (W068): seconds until another Soul's hand is out of this place (its hand actuator holds the place for the whole
   *  reach), with a little margin; 0 when no other hand is in it. */
  /** #435 (W068): body:place pairs whose search was left to another seeker already at it (told so at the end). */
  private readonly yielded = new Set<string>();
  private reachLeft(placeId: string, me: string): number {
    const dt = (this.engine as { dt?: number }).dt ?? 0.05; let left = 0;
    for (const b of Object.values(this.engine.world.entities) as any[]) {
      const m = b.human?.handActuator as HandActuatorMotion | undefined; if (!m || b.id === me || m.target !== placeId) continue;
      left = Math.max(left, handReachSeconds(m) + handSwingSeconds(m) + handReleaseSeconds(m) - (this.engine.world.tick - m.startTick) * dt);
    }
    return left > 0 ? left + 0.4 : 0;
  }
  /** #435 (W068): an empty search's steps: to where a body stands at this place, and a hand over its lip. */
  private reachInto(x: { id: string; pose: { p: number[]; yaw?: number } }, box: NonNullable<ReturnType<EngineBridge['storage']>>, st: [number, number], level: number, wait = 0) {
    const yw = -(x.pose.yaw ?? 0), s = box.ins.slots[0].p;
    return [{ verb: 'mars:walk_to', params: { x: st[0], z: st[1], level } }, ...(wait > 0 ? [{ verb: 'rest', params: { seconds: r3(wait) } }] : []), { verb: 'mars:let_go_v1', params: {} },
      { verb: 'mars:hand_actuator_v1', params: { target: x.id, at: [x.pose.p[0] + s[0] * Math.cos(yw) + s[2] * Math.sin(yw), x.pose.p[1] + Math.max(s[1] + 0.1, box.ins.lip + 0.02), x.pose.p[2] - s[0] * Math.sin(yw) + s[2] * Math.cos(yw)].map(r3), hold: 1 } }];
  }
  /** #435 (W068): what a finished search of this place came to, told to the searcher (the receipt's outcome). */
  searchOutcome(soul: { entityId: string }, spot: string, failed = false): string | null {
    const box = this.storage(spot); if (!box) return null;
    if (failed) return `You could not finish searching ${box.label}; you came away with nothing.`;
    if (this.yielded.delete(`${soul.entityId}:${spot}`)) return `Someone else was already searching ${box.label}; you left it to them and came away with nothing.`;
    const got = Object.values(this.engine.world.entities).find((o: any) => o.tags?.includes('entity-world') && o.support?.kind === 'in-hand' && o.support.by === soul.entityId) as { id: string } | undefined, e = got && this.model.entities.get(got.id);
    return e ? `You found ${e.name ?? this.model.resolvedDef(e.def)?.name.replace(/^core-/, '') ?? 'something'} in ${box.label}.` : `You searched ${box.label} and came away with nothing.`;
  }
  /** #435: what a Soul near a container that keeps a `leftBy` record is told about a thing in it: "left by Ana" (a swap
   *  shelf, W071); in one that gives things back to their owners (`claim: "owner"`, a lost-and-found, W072), whose it is and
   *  who found it: "Ana's, found by Ben" ("yours, …" to Ana). Null when there is nothing to say. */
  keptNote(box: string, item: string, soul?: { soulId: string; name: string }): string | null {
    const e = this.model.entities.get(box), def = e && this.model.resolvedDef(e.def); if (!e || !def) return null;
    const id = keepsLeftBy(def) ? leftByOf(e.state).get(item) : undefined, by = id ? this.host.minds.get(id)?.name ?? 'someone' : null;
    if (!containerClaims(def)) return by ? `left by ${by}` : null;
    const owner = this.model.entities.get(item)?.owner, whose = owner ? (soul && !owner.startsWith('group:') && this.layers.isOf(owner, soul) ? 'yours' : possessive(this.layers.nameOf(owner))) : null;
    return [whose, by && `found by ${by}`].filter(Boolean).join(', ') || null;
  }
  /** #435 (W072): a container with `claim: "owner"` gives a thing that has an owner of its own (not inherited from the
   *  container) back only to that owner or a member of that group; nobody else may take or handle it (a take, a wash at the
   *  tap: every object action's access check), the finder included. The finder is named only `near` (the facts range). */
  claimRefusal(item: string, soul: EdgeSoul, near = false): { code: string; reason: string } | null {
    const x = this.model.entities.get(item), owner = x?.owner; if (!x || !owner || this.layers.isOf(owner, soul)) return null;
    // where it is kept: the engine's support (at once) or the model's containment (it catches up at write-back, up to ten
    // ticks later), whichever puts it in a claiming container's place
    const sup = (this.engine.world.entities[item] as { support?: { kind: string; on?: string; slot?: string } } | undefined)?.support;
    const at = [sup?.kind === 'resting-on' ? [sup.on, sup.slot] : null, [x.in.parent, x.in.slot]].map((w) => {
      const [pid, slot] = w ?? []; if (!pid || pid === 'world') return null;
      const box = this.storage(pid), be = this.model.entities.get(pid);
      return box && be && containerClaims(this.model.resolvedDef(be.def)) && box.ins.slots.some((q) => q.id === slot) ? { box, be } : null;
    }).find(Boolean);
    if (!at) return null;
    const { box, be } = at;
    const n = this.layers.nameOf(owner), id = near ? leftByOf(be.state).get(item) : undefined, by = id ? (id === soul.soulId ? 'you' : this.host.minds.get(id)?.name ?? 'someone') : null;
    return { code: 'item.not-yours', reason: `${this.model.pathOf(item)} is ${possessive(n)}${by ? `; ${by} handed it in` : ''}. Only ${n} can claim it from ${box.label}.` };
  }
  /** Entry 42: the container an engine item rests inside, or null (a table top, the ground). */
  keptIn(x: { support?: { kind: string; on?: string; slot?: string } }) {
    const on = x.support?.on, a = on ? this.physics?.assets[this.engine.world.entities[on]?.def] as { surfaceSlots?: { id: string; inside?: unknown }[] } | undefined : undefined;
    return on && a?.surfaceSlots?.some((sl) => sl.id === x.support!.slot && sl.inside) ? this.storage(on) : null;
  }
  /** Entry 42: why a Soul cannot put into or take out of a container now (whose it is, closed, being opened or shut). */
  private storageRefusal(box: NonNullable<ReturnType<EngineBridge['storage']>>, soul: EdgeSoul): { code: string; reason: string } | null {
    const denied = this.layers.refusal(box.id, soul); if (denied) return denied;
    if (!box.open) return { code: 'container.closed', reason: `${box.label} is closed; open it first (object:${box.id}:open).` };
    if (box.hidden) return null;   // #435: no door to wait for, and another Soul's reach into it (an empty search) must not show
    for (const b of Object.values(this.engine.world.entities) as any[]) if (b.human?.handActuator?.target === box.id) return { code: 'container.moving', reason: `${box.label} is being opened or closed; wait a moment.` };
    return null;
  }
  /** B6: a god-built campfire that has been put out warms nobody: warm-by-fire there is refused until someone lights it. */
  private fireLit(caps: EdgeCapability[]) {
    for (const c of caps) {
      if (c.verb !== 'warm-by-fire' || !c.target) continue;
      const e = this.model.entities.get(c.target.id), def = e ? this.model.resolvedDef(e.def) : undefined;
      const lit = e?.state?.lit ?? (def?.state as Record<string, { default?: unknown }> | undefined)?.lit?.default;
      if (lit !== false) continue;
      c.available = false; c.blocked = { code: 'fire.out', reason: `${this.model.pathOf(e!.id)} is not lit; light it first (object:${e!.id}:light), then warm up by it.` };
    }
  }
  /** SOULFIX: which storey of its building a thing upstairs stands on ("floor 1" = the first floor above the ground),
   *  from the building's own floor height (engine level ids are not storeys). */
  private floorWord(x: any): string {
    let e = this.model.entities.get(x.id);
    while (e && e.in?.parent && e.in.parent !== 'world') {
      const p = this.model.entities.get(e.in.parent); if (!p) break;
      const def = this.model.resolvedDef(p.def) as any;
      if (def?.components?.building || def?.params?.floorHeight) {
        const fh = Number((p as any).params?.floorHeight ?? def.params?.floorHeight?.default ?? 3) || 3;
        const n = Math.round((x.pose.p[1] - this.model.worldPose(p).y) / fh);
        if (n > 0) return `floor ${n}`;
        break;
      }
      e = p;
    }
    return `floor ${this.levelOfY(x.pose.p[1])}`;
  }
  /** Bodies sitting on a god-built seat fixture (any of its seat slots). */
  seatTakers(id: string): string[] {
    const e = this.engine as unknown as { seatOccupantsV1?: (id: string) => { slot: string; body: string }[] };
    if (e.seatOccupantsV1) return e.seatOccupantsV1.call(this.engine, id).map((x) => x.body);
    const u = this.engine.bodyUsesV1(id); return u?.how === 'occupied' ? [u.body] : [];
  }
  /** F1: the ledger lists `sit:here` before the world profile adds god-built seats, so it says "no free seat" beside
   *  free benches. Point it at the nearest free god-built seat instead (the same plan as its sit:<id>) — D2 (2026-10-25):
   *  only a seat that is here (EdgeLedger.seatIsHere: the Soul's own room, or within 3 m with no wall between). */
  private sitHere(caps: EdgeCapability[], plans: Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>, here: Vec2, entityId: string) {
    const i = caps.findIndex((c) => c.id === 'sit:here'); if (i < 0 || caps[i].target && caps[i].available) return;
    const ents = this.engine.world.entities;
    const best = caps.filter((c) => c.verb === 'sit' && c.id !== 'sit:here' && c.available && c.target && ents[c.target.id]?.tags?.includes('entity-world') && plans.has(c.id) && (!this.edge || this.edge.seatIsHere(entityId, ents[c.target.id].pose.p)))
      .map((c) => ({ c, d: Math.hypot(ents[c.target!.id].pose.p[0] - here[0], ents[c.target!.id].pose.p[2] - here[1]) })).filter((x) => x.d <= 30).sort((a, b) => a.d - b.d || (a.c.id < b.c.id ? -1 : 1))[0];
    if (!best) return;
    const plan = plans.get(best.c.id)!;
    const { blocked: _blocked, ...hereCap } = caps[i];
    caps[i] = { ...hereCap, label: `Sit down on the free seat here (${best.c.label.replace(/^Sit on /, '')})`, target: best.c.target, available: true, params: best.c.params };
    plans.set('sit:here', { label: 'Sit down', steps: structuredClone(plan.steps), seconds: true });
  }
}

// ---------- helpers

/** Adapter facts of a def at an entity's scale. */
function factsOf(def: StoredDef, baked: ReturnType<WorldModel['bake']>, scale: number): DefFacts {
  return {
    ref: def.ref, hash: def.hash, name: def.name, description: def.description, tags: def.tags, layer: def.layer,
    components: def.components as DefFacts['components'],
    slots: baked.slots.map((s) => ({ id: s.id, kind: s.kind, p: [s.p[0] * scale, s.p[1] * scale, s.p[2] * scale] as [number, number, number], yaw: s.yaw, ...(s.height !== undefined ? { height: s.height * scale } : {}), capacity: s.capacity })),
    box: [baked.box[0] * scale, baked.box[1] * scale, baked.box[2] * scale],
    ...(def.palette ? { palette: def.palette } : {}),
  };
}

/** A polygon as an oriented rectangle in its own frame (exact for rectangles; the bounding box of its longest edge's frame otherwise). */
export function rectOf(poly: Vec2[]): { c: Vec2; half: Vec2; yaw: number } {
  if (poly.length < 3) return { c: poly[0] ?? [0, 0], half: [0.05, 0.05], yaw: 0 };
  let best = 0, bl = -1;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl + 1e-9) { bl = l; best = i; } }
  const a = poly[best], b = poly[(best + 1) % poly.length], ux = (b[0] - a[0]) / bl, uz = (b[1] - a[1]) / bl;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of poly) { const u = x * ux + z * uz, v = -x * uz + z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  // three.js-convention yaw of the frame (u along x): x = u·cos + v·sin… the frame rotates local +x onto (ux, uz)
  const yaw = Math.atan2(-uz, ux);
  return { c: [r3(cu * ux - cv * uz), r3(cu * uz + cv * ux)], half: [r3((u1 - u0) / 2), r3((v1 - v0) / 2)], yaw: Math.abs(yaw) < 1e-9 ? 0 : r3(yaw) };
}

/** L4 #7: what `sent` keeps for a part's JSON: 'L' when it names stairs ("links": linksMoved), the levels it names
 *  (levelsInUse), then a sha256 of the text (was the text itself: ~1 KB per entity, for equality only). Equal texts give
 *  equal keys; RELEASED has no '|' and so never equals one. */
function sentKey(json: string): string {
  const levels = new Set<number>(); for (const m of json.matchAll(/"level":(\d+)/g)) levels.add(Number(m[1]));
  return `${json.includes('"links"') ? 'L' : '-'}${[...levels].join(',')}|${createHash('sha256').update(json).digest('base64')}`;
}
function normPart(p: Part): Part { const o: Part = {}; if (p.surfaces?.length) o.surfaces = p.surfaces; if (p.solids?.length) o.solids = p.solids; if (p.links?.length) o.links = p.links; if (p.fixture) o.fixture = p.fixture; return o; }
function fixtureOfEngine(e: any): FixtureSpecV1 { return { def: e.def, kind: e.kind === 'component' ? 'item' : 'fixture', label: e.label, p: [e.pose.p[0], e.pose.p[1], e.pose.p[2]], yaw: e.pose.yaw, ...(e.support ? { support: e.support } : {}), ...(e.kind !== 'component' && typeof e.level === 'number' ? { level: e.level } : {}) }; }
function describeOp(op: Op, w: WorldModel): string {
  const o = op as { op: string; id?: string; in?: { parent: string; slot?: string } };
  const who = o.id ? w.pathOf(o.id) || o.id : '';
  if (o.op === 'move' && o.in) return `${who} → ${o.in.parent === 'world' ? 'the ground' : `${w.pathOf(o.in.parent) || o.in.parent}${o.in.slot ? '/' + o.in.slot : ''}`}`;
  return `${o.op} ${who}`;
}

/** Install the bridge on an entity world (main.ts). */
export function installEngineBridge(o: BridgeOptions): EngineBridge { return new EngineBridge(o); }
