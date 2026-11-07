// Stage B (lane B-facade): the read-only world the Soul read code runs against. `binds()`, Perception (here/around/
// observe), together, god-nav and the human-capability/deck listings read the world ONLY through a `MenuWorld`:
// on main a `LiveMenuWorld` over the engine (each read delegates to the engine method itself: behaviour is
// byte-identical), in a read worker a `ReplicaMenuWorld` over the replicated plain state (B-delta's read model), the
// engine's own spatial service rebuilt from the static scene (B-spatial's SpatialReplica) and main's admission verdicts
// (the feasibility table). Inventory and classes: docs/architecture/split.md §1.2.
//
// The read code reaches it through `menuWorldOf(host)` (one LiveMenuWorld per engine, unless a worker registered a
// replica for its read-only host with `setMenuWorld`): dependency injection without threading a parameter through
// every reader. Grep test: apps/server/src/split/menu-world.test.ts (no `host.engine` reach in read code).
import type {Anchor, Program, ProgramAction, RuntimeView, VerbInfo} from '@souls/engine-contract';
import type {WorldState as NativeWorld} from '../../../../mars/viewer/engine/world/types.ts';
import type {ConnPoint, ConnVerdict} from '../../../../mars/viewer/engine/spatial/connectivity.ts';

type V2 = [number, number];
export type Diag = {code: string; message: string};
export type Reach = {ok: true; length: number; legs: number; levels: number[]} | {ok: false; code: string; message: string};
export type CarrierInfo = {id: string; def: string; label: string; pose: {p: number[]; yaw: number}; state: unknown};
export type Aboard = {id: string; slot: string; riderPhase: string; phase: string; label: string; outInSeconds?: number};
export type NewcomerResource = {id: string; slot: number; mat: string; bowl: string; spoon: string; bowlHome: [number, number, number]; spoonHome: [number, number, number]; sleepReturn: V2};

/** (c) The engine-private admission reads. On main the engine itself (with a per-(tick, log seq) cache); on a replica the
 *  verdicts main shipped in the delta. `scope` names what besides the program the verdict depends on (a route check: the
 *  nav epoch and the 0.5 m cell the Soul stands in); '' = the program alone at the current state. */
export interface Feasibility {
  canPerform(program: Program, scope?: string): Diag | null;
  /** Whether `reach` answers here (an engine without a planner route proof, or a replica without one: no reach checks). */
  readonly reaches: boolean;
  /** The planner's route proof between two standing points (god-nav goal and room reach checks). */
  reach(from: {p: V2; level?: number}, to: {p: V2; level?: number}): Reach | undefined;
}

/** Exactly the engine reads the read path makes (classes: a = plain state, b = spatial service, c = `feasibility`). */
export interface MenuWorld {
  // (a) plain state
  readonly world: NativeWorld;
  readonly runtime: RuntimeView;
  readonly rulesVersion: string;
  describeVerbs(): VerbInfo[];
  anchors(): Anchor[];
  programOf(actor: string): string | null;
  programAction?(programId: string): ProgramAction | null;
  commonsNewcomerResourcesV1?(): NewcomerResource[];
  commonsFoodDeliveriesV1?(): {batch: number}[];
  carriers?(): CarrierInfo[];
  carrierOf?(actor: string): Aboard | null;
  placeLevelV1?(level: number): number;
  bodyUsesV1?(id: string): {body: string; how: 'occupied' | 'held'} | null;
  seatOccupantsV1?(id: string, kind?: string): {slot: string; body: string}[];
  /** The actor's native seat holds (here.ts seat(): the exact slot it sits in; continuity hereMe). */
  nativeSeatHoldsV1?(actor: string): {action: string; slot: string}[];
  // (b) the engine's spatial service (B-spatial mirrors these names in split/spatial-replica.ts)
  withFeasibilityRead?<T>(read: () => T): T;
  readPassV1?<T>(fn: () => T): T;
  staticEpochV1?(): number;
  navEpochV1?(): number;
  navWarmV1?(budgetMs: number): boolean;
  navCheckV1?(points: ConnPoint[]): ConnVerdict[];
  navNearestMainV1?(p: V2, except?: string, maxR?: number): V2 | null;
  clearanceAtV1?(x: number, z: number, level?: number): number;
  clearanceUpToV1?(x: number, z: number, cap?: number, level?: number): number;
  nearestStandableV1?(at: V2, except?: string, minClear?: number, maxRing?: number, withPeople?: boolean): V2 | null;
  standableNearV1?(at: V2, level?: number, except?: string, minClear?: number, maxRing?: number): V2 | null;
  clearSpotsV1?(polygon: V2[], n: number): V2[];
  dryGroundAtV1?(x: number, z: number): boolean;
  lyingRoomAtV1?(x: number, z: number, level?: number, sampleMargin?: number): boolean;
  standYAtV1?(x: number, z: number, level?: number): number | null;
  nativeSeatLevelsV1?(fixture: string): number[];
  movementVerb?(actor: string, x: number, z: number): string;
  /** body-state.ts: how deep the water is over the body's root (0 on dry ground, aboard, upstairs) */
  bodyWaterDepthV1?(actor: string): number;
  /** intents.ts eta: the walk planner's route length from the body to a point */
  routeEstimateV1?(actor: string, to: V2, level?: number): {ok: true; metres: number} | {ok: false; code: string; message: string};
  // (c)
  readonly feasibility: Feasibility;
}

/** The optional engine reads, bound to the engine when it has them (an absent method stays absent: `?.()` callers and
 *  `if (E.readPassV1)` branches behave exactly as against the engine). */
const OPTIONAL = ['programAction', 'commonsNewcomerResourcesV1', 'commonsFoodDeliveriesV1', 'carriers', 'carrierOf', 'placeLevelV1',
  'bodyUsesV1', 'seatOccupantsV1', 'withFeasibilityRead', 'readPassV1', 'staticEpochV1', 'navEpochV1', 'navWarmV1', 'navCheckV1', 'navNearestMainV1',
  'clearanceAtV1', 'clearanceUpToV1', 'nearestStandableV1', 'standableNearV1', 'clearSpotsV1', 'dryGroundAtV1', 'lyingRoomAtV1',
  'standYAtV1', 'nativeSeatLevelsV1', 'movementVerb', 'bodyWaterDepthV1', 'routeEstimateV1'] as const;

/** `E.withFeasibilityRead(read)` when the world has it, else `read()` (the engine contract's optional batch). */
export const withRead = <T>(E: MenuWorld, read: () => T): T => E.withFeasibilityRead ? E.withFeasibilityRead(read) : read();

/** A canonical key for one program (the verdict table's `planKey`). */
export const planKey = (p: Program) => `${p.actor}\u0001${p.label}\u0001${JSON.stringify(p.steps)}`;

type EngineLike = {readonly world: NativeWorld; readonly runtime: RuntimeView; readonly rulesVersion: string; describeVerbs(): VerbInfo[];
  anchors(): Anchor[]; programOf(actor: string): string | null; canPerform(program: Program): Diag | null; reachV1?(from: {p: V2; level?: number}, to: {p: V2; level?: number}): Reach};

/** Main: the engine's own answers. `canPerform` is cached per (tick, log seq): the engine's state changes only by a tick
 *  or a logged input, so two reads of the same program between them get the same answer. The keys asked are kept per
 *  actor (`asked`) so main can pump the verdicts a replica needs (item 3). */
export class LiveFeasibility implements Feasibility {
  private at = ''; private cache = new Map<string, Diag | null>();
  readonly asked = new Map<string, Map<string, {program: Program; scope: string}>>();
  /** When a VerdictPump is attached (split/verdict-pump.ts): every answer computed afresh, shipped with the next delta. */
  fresh?: {key: string; program: Program; scope: string; verdict: Diag | null}[];
  hits = 0; calls = 0;
  private engine: EngineLike; private logSeq: () => number;
  constructor(engine: EngineLike, logSeq: () => number) {this.engine = engine; this.logSeq = logSeq;}
  canPerform(program: Program, scope = ''): Diag | null {
    const at = `${this.engine.world.tick}|${this.logSeq()}`;
    if (at !== this.at) {this.at = at; this.cache.clear();}
    const key = scope + '\u0002' + planKey(program); this.calls++;
    if (this.cache.has(key)) {this.hits++; const v = this.cache.get(key)!; return v && {...v};}
    const v = this.engine.canPerform(program); this.cache.set(key, v && {...v});
    if (this.fresh && this.fresh.length < 4096) this.fresh.push({key, program, scope, verdict: v && {...v}});
    let mine = this.asked.get(program.actor); if (!mine) this.asked.set(program.actor, mine = new Map());
    if (!mine.has(key) && mine.size < 256) mine.set(key, {program, scope});
    return v;
  }
  get reaches() {return !!this.engine.reachV1;}
  reach(from: {p: V2; level?: number}, to: {p: V2; level?: number}): Reach | undefined {return this.engine.reachV1?.(from, to);}
}

export class LiveMenuWorld implements MenuWorld {
  readonly feasibility: LiveFeasibility;
  seqHost: {seq: number} | null = null;
  readonly engine: EngineLike;
  constructor(engine: EngineLike) {
    this.engine = engine;
    this.feasibility = new LiveFeasibility(engine, () => this.seqHost?.seq ?? 0);
    const e = engine as unknown as Record<string, unknown>, self = this as unknown as Record<string, unknown>;
    for (const k of OPTIONAL) if (typeof e[k] === 'function') self[k] = (e[k] as (...a: unknown[]) => unknown).bind(engine);
  }
  get world() {return this.engine.world;}
  get runtime() {return this.engine.runtime;}
  get rulesVersion() {return this.engine.rulesVersion;}
  describeVerbs() {return this.engine.describeVerbs();}
  anchors() {return this.engine.anchors();}
  programOf(actor: string) {return this.engine.programOf(actor);}
  /** Looked up per read, not bound at construction: the engine's own (possibly replaced) method, or absent. */
  get nativeSeatHoldsV1(): MenuWorld['nativeSeatHoldsV1'] {const f = (this.engine as {nativeSeatHoldsV1?: MenuWorld['nativeSeatHoldsV1']}).nativeSeatHoldsV1; return typeof f === 'function' ? f.bind(this.engine) : undefined;}
}
export interface LiveMenuWorld extends Pick<MenuWorld, typeof OPTIONAL[number]> {}

// ---- registry: one facade per host (main: per engine; a worker registers its replica for its read-only host)
type HostLike = {engine: unknown; seq?: number};
const LIVE = new WeakMap<object, LiveMenuWorld>(), SET = new WeakMap<object, MenuWorld>();
export function menuWorldOf(host: HostLike): MenuWorld {
  const set = SET.get(host); if (set) return set;
  const engine = host.engine as EngineLike & {feasibility?: unknown};
  if (engine.feasibility) return engine as unknown as MenuWorld;   // injected: `engine` is a MenuWorld already
  let mw = LIVE.get(engine);
  if (!mw) LIVE.set(engine, mw = new LiveMenuWorld(engine));
  if (typeof host.seq === 'number' && mw.seqHost !== host) mw.seqHost = host as {seq: number};   // the world host's log seq keys the per-tick cache
  return mw;
}
export function setMenuWorld(host: object, mw: MenuWorld | null) {if (mw) SET.set(host, mw); else SET.delete(host);}

// ---- replica side (item 2b): plain state + spatial replica + verdicts
/** Main ships these with the verdicts (split/verdict-pump.ts; B-delta does not replicate them: they change inside a step
 *  without an event). `ActionRow`: one per actor with a program (answers `programAction`), emitted when it changes.
 *  `RecordRow`: the runtime records the read code reads (live sit/take_slot holds; each program's current action, with
 *  params.seconds and the first 'running' tick for here.ts `endsIn`). Receipt plan/detail/outcome are NOT shipped: the
 *  worker reads them from sqlite (read-only WAL connection), as the ledger does. */
export type ActionRow = {programId: string; actor: string; step: number; action: {id: string; verb: string; status: string; phase?: string} | null; tick: number};
export type RecordRow = {id: string; verb: string; status: string; phase?: string; live: boolean; params: Record<string, unknown>; requestedTick?: number; runningTick?: number};
/** The engine's static-per-epoch reads (resent whole when they move). `kernel` = host.kernel (things, vocab, decks). */
export type MenuStatics = {regions: unknown; navV1: unknown; rulesVersion: string; verbs: VerbInfo[]; anchors: Anchor[]; newcomer?: NewcomerResource[]; deliveries?: {batch: number}[]; kernel?: unknown; names?: unknown;
  /** movementVerb / placeLevelV1 inputs: world.groundV1 set, the engine's physical-shore mode, world.upperFloorsV1 */
  groundV1?: boolean; physical?: boolean; upperFloors?: unknown};
/** A claimed fixture slot (runtime owners `slot:<fixture>#<slot>`): the slot id and the claiming record's actor. */
export type ClaimRow = [slot: string, actor: string];
/** The ledger's god-fed reads (main-only providers): weatherNow(), the recent lightning strikes, the god's activity spots.
 *  A key present = its new value (null = none); resent when it changed. */
export type LedgerEnv = {weather?: unknown; strikes?: unknown; spots?: unknown; /** the god bridge's physics facts (engine-bridge readPhysicsV1), when its hash moved */ physics?: unknown; /** the ground swim offers' recipe and deep-middle answers (ground-host GroundEnvV1) */ ground?: unknown; /** main ledger's ride boarding checks {carrier: {tick, route, issue}} */ boarding?: unknown;
  /** Eyes: main's livePlatforms() answer when the world has an accepted render fact (edge/eyes/platforms.ts), else null */ platforms?: unknown};
/** `assets`: the CATALOG entries main's engine registered at runtime (entity-world defs, `ew:` ids, from its entity physics):
 *  a worker's CATALOG has only the built-in ones (the read code looks seats, fires, beds and labels up there). */
export type MenuInit = {actions: ActionRow[]; records: RecordRow[]; verdicts: VerdictRow[]; statics: MenuStatics; claims?: ClaimRow[]; env?: LedgerEnv; assets?: Record<string, unknown>};
export type MenuDelta = {assets?: Record<string, unknown>; actions?: ActionRow[]; actionsGone?: string[]; records?: RecordRow[]; recordsGone?: string[]; verdicts?: VerdictRow[]; statics?: Omit<MenuStatics, 'kernel' | 'names'>; kernel?: unknown; names?: unknown; claims?: ClaimRow[]; env?: LedgerEnv};
export type VerdictRow = {soulId: string; actor: string; key: string; verdict: Diag | null; tick: number};
/** The verdicts main computed for the programs a replica's reads ask about. A miss answers "feasible" (the planner's
 *  refusal then comes at act time, as `deferRouteChecks` offers do today) and is queued for main (`misses`). */
export class VerdictTable implements Feasibility {
  private rows = new Map<string, VerdictRow>(); readonly misses = new Map<string, {program: Program; scope: string}>();
  hits = 0; missCount = 0;
  private reachOf?: (from: {p: V2; level?: number}, to: {p: V2; level?: number}) => Reach | undefined;
  constructor(reachOf?: (from: {p: V2; level?: number}, to: {p: V2; level?: number}) => Reach | undefined) {this.reachOf = reachOf;}
  apply(rows: readonly VerdictRow[]) {for (const r of rows) {this.rows.set(r.key, r); this.misses.delete(r.key);}}
  clear() {this.rows.clear(); this.misses.clear();}
  forget(actor: string) {for (const [k, r] of this.rows) if (r.actor === actor) this.rows.delete(k);}
  canPerform(program: Program, scope = ''): Diag | null {
    const key = scope + '\u0002' + planKey(program), hit = this.rows.get(key);
    if (hit) {this.hits++; return hit.verdict && {...hit.verdict};}
    this.missCount++; if (this.misses.size < 1024) this.misses.set(key, {program, scope});
    return null;
  }
  get reaches() {return !!this.reachOf;}
  reach(from: {p: V2; level?: number}, to: {p: V2; level?: number}) {return this.reachOf?.(from, to);}
}

/** What a ReplicaMenuWorld is built from (structural, so it compiles against B-delta's Replica and B-spatial's
 *  SpatialReplica without importing them; wiring in read-worker.ts, item 6). */
export type ReplicaSources = {
  world(): NativeWorld;
  runtime(): RuntimeView;
  programOf(actor: string): string | null;
  programAction(programId: string): ProgramAction | null;
  statics: {rulesVersion: string; verbs: VerbInfo[]; anchors(): Anchor[]; newcomer?: NewcomerResource[]; deliveries?: {batch: number}[]};
  carriers?(): CarrierInfo[];
  carrierOf?(actor: string): Aboard | null;
  placeLevelV1?(level: number): number;
  bodyUsesV1?(id: string): {body: string; how: 'occupied' | 'held'} | null;
  seatOccupantsV1?(id: string, kind?: string): {slot: string; body: string}[];
  nativeSeatHoldsV1?(actor: string): {action: string; slot: string}[];
  movementVerb?(actor: string, x: number, z: number): string;
  bodyWaterDepthV1?(actor: string): number;
  routeEstimateV1?(actor: string, to: V2, level?: number): {ok: true; metres: number} | {ok: false; code: string; message: string};
  /** B-spatial's SpatialReplica (same method names as the engine). */
  spatial: Partial<Pick<MenuWorld, 'readPassV1' | 'staticEpochV1' | 'navEpochV1' | 'navWarmV1' | 'navCheckV1' | 'navNearestMainV1' | 'clearanceAtV1'
    | 'clearanceUpToV1' | 'nearestStandableV1' | 'standableNearV1' | 'clearSpotsV1' | 'dryGroundAtV1' | 'lyingRoomAtV1' | 'standYAtV1'
    | 'nativeSeatLevelsV1' | 'movementVerb'>>;
  verdicts: VerdictTable;
};
export class ReplicaMenuWorld implements MenuWorld {
  readonly feasibility: VerdictTable;
  private s: ReplicaSources;
  constructor(s: ReplicaSources) {
    this.s = s;
    this.feasibility = s.verdicts;
    const self = this as unknown as Record<string, unknown>, sp = s.spatial as Record<string, unknown>;
    for (const k of Object.keys(sp)) if (typeof sp[k] === 'function') self[k] = (sp[k] as (...a: unknown[]) => unknown).bind(s.spatial);
    if (s.carriers) self.carriers = s.carriers; if (s.carrierOf) self.carrierOf = s.carrierOf;
    if (s.placeLevelV1) self.placeLevelV1 = s.placeLevelV1; if (s.bodyUsesV1) self.bodyUsesV1 = s.bodyUsesV1;
    if (s.seatOccupantsV1) self.seatOccupantsV1 = s.seatOccupantsV1; if (s.nativeSeatHoldsV1) self.nativeSeatHoldsV1 = s.nativeSeatHoldsV1; if (s.movementVerb) self.movementVerb = s.movementVerb; if (s.bodyWaterDepthV1) self.bodyWaterDepthV1 = s.bodyWaterDepthV1; if (s.routeEstimateV1) self.routeEstimateV1 = s.routeEstimateV1;
    if ('newcomer' in s.statics) self.commonsNewcomerResourcesV1 = () => structuredClone(s.statics.newcomer);
    if ('deliveries' in s.statics) self.commonsFoodDeliveriesV1 = () => structuredClone(s.statics.deliveries);
  }
  get world() {return this.s.world();}
  get runtime() {return this.s.runtime();}
  get rulesVersion() {return this.s.statics.rulesVersion;}
  describeVerbs() {return this.s.statics.verbs;}
  anchors() {return this.s.statics.anchors();}
  programOf(actor: string) {return this.s.programOf(actor);}
  programAction(programId: string) {return this.s.programAction(programId);}
  /** The replica's grids are synced already: a feasibility batch is just the read. */
  withFeasibilityRead<T>(read: () => T): T {return read();}
}
export interface ReplicaMenuWorld extends Pick<MenuWorld, typeof OPTIONAL[number]> {}
