import type {NativeSleepSnapshotPolicyV1} from './sleep-snapshot.ts';
import type {CommonsNewcomerResourcesV1,NewcomerResourcePlacementV1} from './newcomer-resources.ts';
// The engine adapter: what the wrapper (server, brain, clients) needs from ANY
// engine. Two implement it: the toy engine and the Mars adapter (packages/engine-mars).
import type { ActionRecord } from './actions.ts';
import type { RuntimeEvent } from './runtime.ts';
import type { WorldState, Vec3 } from './world.ts';
import type { VerbInfo } from './registry.ts';
import type { RenderScene,RenderSceneCaptureV1 } from './scene-capture.ts';
import type {LocalClassroomObservationV1} from './classroom-observation.ts';
import type { NativeGatheringObservationV1 } from './gathering-observation.ts';
import type { CommonsTransitionV1,CommonsTransitionAdmissionV1 } from './commons-transition.ts';
import type {NativeBoatControlsV1} from './boat.ts';
import type {BodyLocationV1} from './body-location.ts';
import type {CampExpansionV1,CampExpansionAdmissionV1} from './camp-expansion.ts';
import type {CrewRemovalTransitionV1,CrewRemovalTransitionAdmissionV1} from './crew-removal-transition.ts';
export type {RenderScene} from './scene-capture.ts';

/** A feasible activity for an actor, params already bound. The brain picks by id only. */
export type ActivityOption = {
  id: string;            // e.g. 'attend:campfire'
  template: string;      // activity template name, e.g. 'attend'
  label: string;         // human readable: 'Walk to the campfire and join the gathering'
  servesIntent?: boolean; // code-known fact: this option is what the standing intent asks for
  goodWhen?: string;     // when this is the right choice (feeds Jev criteria)
  notFor?: string;       // when this is a bad choice (feeds Jev criteria)
  target?: string;       // entity/region id
  steps: { verb: string; params: Record<string, unknown> }[];
  durationHint: 'seconds' | 'minute' | 'minutes' | 'long';
};

/** Standing intent (doc 11). Closed goal list; params bounded. */
export type Intent = {
  goal: 'wander' | 'go' | 'follow' | 'attend' | 'gather' | 'converse' | 'rest' | 'perform' | 'build' | 'place';
  target?: string | null;
  params?: Record<string, string | number | boolean>;
  until?: { tick: number } | { event: string } | null;
  fallback?: Intent | null;
};

/** A path decision as broadcast to clients (Mars PoseSample keyframe format: [tick, x mm, y mm, z mm, yaw mrad]). */
export type PoseSample = number[];
export type PathCommit = { entity: string; startTick: number; speed: number; waypoints: PoseSample[]; activity: string; actionId: string };
export type ChangeEvent = [number, string, string, unknown]; // [tick, entityId, field, value|null]

/**
 * A physical anchor: something in the engine's world that meaning can refer to
 * (a region, a named place, a usable fixture). The kernel mirrors anchors as
 * place Things; depiction programs refer back to them by `entity` or `point`.
 */
export type Anchor = { id: string; kind: 'region' | 'place'; name: string; in?: string; entity?: string; point?: [number, number]; tags?: string[] };
/** A depiction program for one actor: an ordered list of engine verbs. */
export type Program = { actor: string; label: string; steps: { verb: string; params: Record<string, unknown> }[] };
export type ProgramAdmission = { id:string; ok:boolean; diagnostic?:{code:string;message:string} };
/** Progress of a program, reported by the engine each tick. `step` is the index now running; -1 on the events that end a program. */
export type ProgramEvent = { tick: number; id: string; actor: string; kind: 'step' | 'completed' | 'failed' | 'cancelled'; step: number; code?: string; message?: string };
/** Detached observation of an actual action bound to this program. A step
 * callback or program admission alone does not establish controller execution. */
export type ProgramAction = { tick:number; programId:string; actor:string; step:number;
  action:{ id:string; verb:string; status:ActionRecord['status']; phase?:string } };

/** What the shell reads of an engine's runtime: never its internals. */
export interface RuntimeView { readonly tick: number; readonly records: Map<string, ActionRecord>; readonly violations: { tick: number; code: string; message: string }[]; liveIds(): string[] }
/** An engine's resumable checkpoint. Only these three fields are read by the shell; the rest is the engine's own. */
export type EngineSnapshot = { format: string; tick: number; stateHash: string };
/** Owned checkpoint at a single synchronous engine boundary. Every completion
 * returns a fresh snapshot; iterators and finish() may be used independently.
 * steps() yields bounded graph work, not engine ticks, and never reads live state. */
export type EngineSnapshotCapture = {
  readonly tick: number;
  readonly stateHash: string;
  steps(): Generator<void, EngineSnapshot, void>;
  finish(): EngineSnapshot;
};

/** Internal periodic checkpoint: all inputs are owned before return, including
 * physical hash inputs. Hashing and encoding can finish later without live reads. */
export type EngineCheckpoint = { snapshot: EngineSnapshot; physicalHash: string };
/** Deferred owned hashes. Exceptional legacy selector metadata may instead
 * return EngineSnapshotCapture, preserving the host's eager physical-hash order. */
export type EngineCheckpointCapture = {
  readonly tick: number;
  finish(): EngineCheckpoint;
  steps(): Generator<void, EngineCheckpoint, void>;
};

/** #1150 rung 1: moves this step did not apply, by rule. Present only on a step that refused one. The log keeps them as
 *  evidence; a replay recomputes them from world state and the rules, so nothing here is an input. */
export type EngineRefusalV1 = { tick: number; rule: string; bodies: string[]; programs: string[]; poses: Record<string, { p: [number, number, number]; yaw: number; level?: number }>; relocated?: true };

/** #1150 decision 1: the world landed on a body, so there is no pose to go back to. The one named exception to "never teleport". */
export const RELOCATED = { code: 'world.relocated', message: 'The world changed where you stood, so you were moved to the nearest free spot. Nothing else changed.' };
/** #1150 rung 3: what a Soul is told when the world went back. */
export const STEP_FAILING = { code: 'world.step-failing', message: 'The world is failing to move anything right now, so nothing you try can happen yet. You can still speak.' };
export const REWOUND = { code: 'world.rewound', message: 'The world went back to its last clean moment, and what you were doing did not happen. You can act again.' };

export interface Engine {
  readonly rulesVersion: string;
  readonly dt: number;
  readonly schema: string;
  readonly runtime: RuntimeView;
  readonly world: WorldState;
  ownedClassroomControlRosterV1?(actor:string,session:string):string[]|null;
  previewEdenGroundV1?():{ok:true;transition:import('./eden-ground.ts').EdenGroundTransitionV1}|{ok:false;diagnostic:{code:string}};
  adoptEdenGroundV1?(fact:import('./eden-ground.ts').EdenGroundTransitionV1):void;
  previewEdenLectureV1?(placement:import('./eden-lecture.ts').EdenLecturePlacementV1):{ok:true;transition:import('./eden-lecture.ts').EdenLectureTransitionV1}|{ok:false;diagnostic:{code:string}};
  adoptEdenLectureV1?(fact:import('./eden-lecture.ts').EdenLectureTransitionV1):void;
  describeVerbs(): VerbInfo[];
  /** Optional synchronous boot preparation. May warm private caches only: no ticks, inputs,
   * state changes, recorder cuts or publication. Call after initial projection, before serving. */
  prepareForServing?(): void;
  stateHash(): string;
  physicalHash(): string;
  /** Advance one tick. Returns what changed for broadcast. */
  step(): { paths: PathCommit[]; changes: ChangeEvent[]; events: RuntimeEvent[]; programs: ProgramEvent[]; refusals?: EngineRefusalV1[] };
  /** Start a depiction program for an actor, replacing whatever that actor was doing. */
  perform(program: Program): ProgramAdmission;
  /** Detached admission result for the immediately following perform on the
   * same state. Read-only: no IDs consumed, cancellation, execution or events.
   * Optional; the sequencer otherwise requires an exact resumable checkpoint. */
  previewAdmission?(program: Program): ProgramAdmission;
  /** #1150 rung 3, for an engine that declares rules. None of these steps the world, so no rule can fire during them. */
  stopAllV1?(why: { code: string; message: string }, force?: boolean): number;
  setClockV1?(tick: number): void;
  containV1?(): { contained: { code: string; subjects: string[] }[]; relocated: string[] };
  /** Stop a running program (the actor is left idle where it is). */
  /** `untilSafe` (PC08, a shared carry's stop): the programme stays until its native cleanup has finished, retrying a
   *  refused cancel each tick the action moves (not while it is held up), as a physical runtime does; without it,
   *  legacy behaviour is unchanged. */
  stop(programId: string, opts?: { untilSafe?: boolean }): void;
  /** Synchronous read-only feasibility batch; memoization never crosses its boundary. */
  withFeasibilityRead?<T>(read:()=>T):T;
  /** Physical feasibility of a program's first step right now, without running it (Mars: `verb.plan`). Null = feasible. */
  canPerform(program: Program): { code: string; message: string } | null;
  /** The program an actor is running, if any. */
  programOf(actor: string): string | null;
  programAction?(programId:string): ProgramAction | null;
  /** Actual native actor+seat claims, including fixture-selected and cancelling seats. Read only. */
  nativeSeatHoldsV1?(actor:string):{action:string;slot:string}[];
  /** stall-guard/1 (packages/engine-mars/src/stall.ts): what holds a body; read-only. */
  stallProbeV1?(actor:string):StallProbeV1|null;
  /** stall-guard/1: the world releases a stalled body and stands it at the nearest free spot (folded from the log). */
  stallReleaseV1?(actor:string,reason:{code:string;message:string}):{released:string[];markers:string[];at:[number,number,number]}|null;
  /** Native ordinary standing support/clearance after releasing a seat. Null means supported. */
  standingSupportProblemV1?(actor:string,originalSeats?:{action:string;slot:string}[]):{code:string;message:string}|null;
  /** Candidate read-only public physical evidence. Native settled gather slots
   * at fixtures only; no private intent, proximity classifier or music/action admission. */
  gatheringObservation?(): NativeGatheringObservationV1;
  observeLocalClassroomV1?(observer:string):LocalClassroomObservationV1|undefined;
  /** Actual settled body-language rest, distinct from travelling toward it. */
  bodyResting?(actor:string): boolean;
  /** D1 body state: metres of water over the ground at the body's root (0 aboard, on a deck, upstairs, or with no ground). */
  bodyWaterDepthV1?(actor:string): number;
  submit(verb: string, params: unknown, opts?: { id?: string; parent?: string; preempt?: boolean }): ActionRecord;
  cancel(id: string, reason?: { code: string; message: string }): ActionRecord;
  snapshot(): EngineSnapshot;
  captureSnapshot?(): EngineSnapshotCapture;
  captureCheckpoint?(): EngineCheckpointCapture | EngineSnapshotCapture;
  /** Recorded rendering chunks; no browser Runtime. Optional for engines without takes. */
  takeChunks?(afterTick: number): { fromTick: number; toTick: number; take: unknown }[];
  renderScene?(): RenderScene;
  /** Captured public render base for an emitted take reference. Bounded hot
   * window only; persistence owns historical retention. No topology authority. */
  takeScene?(hash:string): RenderSceneCaptureV1 | undefined;
  canSnapshot?(): boolean;
  groundReclaimEnabledV1?(): boolean;
  enableGroundReclaimV1?(): void;
  configureRuntimePolicy?(policy: {sleepBlockTicks:number;quietSeatCourtesy?:boolean;nativeArrivalWitnessV1?:boolean;quietLandingCourtesyV1?:boolean;walkSettleWaitV1?:boolean;occupiedLinkRoutingV1?:boolean;concurrentLinkEgressV1?:boolean;stairLandingClearanceV1?:boolean}): void;
  configureClock?(clock: { origin: number; dayTicks: number }): void;
  beginQuiet?(): void;
  isQuiet?(): boolean;
  compact?(): void;
  adoptCamp?(): void;
  previewCommonsTransition?(): CommonsTransitionAdmissionV1;
  adoptCommons?(transition:CommonsTransitionV1): void;
  previewCommonsFoodDeliveryV1?(deliveryId:string):{ok:true;transition:import('./food-delivery.ts').CommonsFoodDeliveryV1}|{ok:false;diagnostic:{code:string}};
  adoptCommonsFoodDeliveryV1?(delivery:import('./food-delivery.ts').CommonsFoodDeliveryV1):void;
  commonsFoodDeliveriesV1?():import('./food-delivery.ts').CommonsFoodDeliveryV1[];
  previewExistingGreenLandmarkV1?():{ok:true;transition:import('./green-landmark-v1.ts').ExistingGreenLandmarkTransitionV1}|{ok:false;diagnostic:{code:string}};
  adoptExistingGreenLandmarkV1?(transition:import('./green-landmark-v1.ts').ExistingGreenLandmarkTransitionV1):void;
  previewSocialEdenV1?():{ok:true;transition:import('./social-eden.ts').SocialEdenTransitionV1}|{ok:false;diagnostic:{code:string}};
  adoptSocialEdenV1?(transition:import('./social-eden.ts').SocialEdenTransitionV1):void;
  previewRetainedCommonsShoreV1?():import('./retained-shore.ts').RetainedCommonsShoreAdmissionV1;
  adoptRetainedCommonsShoreV1?(transition:import('./retained-shore.ts').RetainedCommonsShoreV1):void;
  previewCommonsKitchenV1?():{ok:true;transition:{contract:'commons-kitchen/1'|'commons-kitchen/2';tick:number;fromRulesVersion:string;toRulesVersion:string;fromStateHash:string;additionsHash:string;base:WorldState['base']}}|{ok:false;diagnostic:{code:string}};
  adoptCommonsKitchenV1?(transition:unknown):void;
  previewNativeSleepSnapshotV1?():{ok:true;transition:NativeSleepSnapshotPolicyV1}|{ok:false;diagnostic:{code:string}};
  adoptNativeSleepSnapshotV1?(transition:NativeSleepSnapshotPolicyV1):void;
  previewCommonsNewcomerResourcesV1?(placements:readonly NewcomerResourcePlacementV1[]):{ok:true;transition:CommonsNewcomerResourcesV1}|{ok:false;diagnostic:{code:string}};
  adoptCommonsNewcomerResourcesV1?(transition:CommonsNewcomerResourcesV1):void;
  commonsNewcomerResourcesV1?():{id:string;slot:number;mat:string;bowl:string;spoon:string;bowlHome:[number,number,number];spoonHome:[number,number,number];sleepReturn:[number,number]}[];
  previewCommonsProvisionsV1?():{ok:true;transition:{contract:'commons-provisions/1';tick:number;fromRulesVersion:string;toRulesVersion:string;fromStateHash:string;additionsHash:string;base:WorldState['base']}}|{ok:false;diagnostic:{code:string}};
  adoptCommonsProvisionsV1?(transition:unknown):void;
  previewCrewRemovalTransitionV1?():CrewRemovalTransitionAdmissionV1;
  adoptCrewRemovalTransitionV1?(transition:CrewRemovalTransitionV1):void;
  previewCampExpansionV1?():CampExpansionAdmissionV1;
  adoptCampExpansionV1?(transition:CampExpansionV1):void;
  campAnchors?(): Anchor[];
  restockCamp?(): void;
  actorBorrowed?(actor: string): boolean;
  /** Optional native-cast custody reader; null means participant scope is unqualified. */
  nativeProgramParticipantsV1?(program:Program):readonly string[]|null;
  configureBodyTypesV1?(types:readonly string[]):void;
  bodyAssignmentProblemV1?(actor:string,body:import('./world.ts').Entity['body']|null):string|null;
  assignBodyV1?(actor:string,body:import('./world.ts').Entity['body']|null):boolean;
  configureRenderPlatformsV1?(metadata:import('./render-platforms-v1.ts').RenderPlatformsV1):void;
  renderPlatformsV1?():import('./render-platforms-v1.ts').RenderPlatformsV1|undefined;
  configureOfficeStairGuardsV1?(metadata:import('./office-stair-guards-v1.ts').OfficeStairGuardsV1):void;
  officeStairGuardsV1?():import('./office-stair-guards-v1.ts').OfficeStairGuardsV1|undefined;
  previewAuthoredBoundariesV1?(metadata:import('./authored-boundaries-v1.ts').AuthoredBoundariesDeclarationV1):{code:string;message:string}|null;
  configureAuthoredBoundariesV1?(metadata:import('./authored-boundaries-v1.ts').AuthoredBoundariesV1):void;
  authoredBoundariesV1?():import('./authored-boundaries-v1.ts').AuthoredBoundariesV1|undefined;
  /** Spawn a human entity for a Soul at the arrival point; returns the entity id. `near` (birth-near/1, verifier
   * probes): when the arrival point is built over, land on the nearest clear standing ground instead of refusing. */
  spawnHuman(args: { id: string; label: string; soul: string; near?: BirthNearV1 }): string;
  removeEntity(id: string): void;
  /** Feasible activities for an actor right now, cheap (no rehearsal). */
  enumerateActivities(actorId: string, intent: Intent | null): ActivityOption[];
  /** Word-bucketed local context for the brain: never numbers. */
  describeSurroundings(actorId: string): { nearby: { id: string; who: string; what: string; distance: 'here' | 'close' | 'near' | 'far'; doing: string }[]; region: string; happening: string };
  /** Optional bounded local physical cue. Availability never grants control. */
  observeBoatControls?: (actorId:string)=>NativeBoatControlsV1|null;
  /** Actual self-region/container/contact, without mutation. Undefined means
   * this observer is not installed; null means current placement is unqualified. */
  observeBodyLocation?: (actorId:string)=>BodyLocationV1|null|undefined;
  /** Regions and named places/fixtures that meaning can refer to. Stable ids. */
  anchors(): Anchor[];
  /** Region id containing a point (for per-region narration). */
  regionAt(p: Vec3): string;
  /** Kinematic position of an entity at a tick (for keyframes and clients). */
  poseSampleOf(entityId: string): PoseSample;
  /** The timed path an entity is currently on, if any (for snapshots sent to joining clients). */
  currentPath(entityId: string): PathCommit | undefined;
}

export interface EngineFactory {
  rulesVersion: string;
  /** Explicit, qualified additive checkpoint upgrades only. Rebuilding an
   * incompatible checkpoint also requires canReplayHistory's permission. */
  canRestoreSnapshot?: (rulesVersion: string) => boolean;
  /** Optional fail-closed boundary for history whose rules cannot be silently
   * reinterpreted by this factory. False forbids host boot before construction
   * or replay; absence preserves existing factories' replay behavior. This does
   * not convert a checkpoint or qualify an upgrade/rollback. */
  canReplayHistory?: (rulesVersion: string) => boolean;
  /** Optional exact history-head check after all durable events are replayed. */
  validateHistoryHead?: (engine:Engine,recordedRulesVersion:string)=>void;
  genesis(seed: string): WorldState;
  create(world: WorldState): Engine;
  restore(snap: EngineSnapshot): Engine;
}

/** birth-near/1: a journaled birth hint. `at` is the requested start; `first` searches it before the arrival point. */
export type BirthNearV1 = { at: [number, number]; first?: boolean };

/** stall-guard/1: a body's hold, as the edge's stall guard reads it (see packages/engine-mars/src/stall.ts). */
export type StallProbeV1 = { held: boolean; holders: { id: string; verb: string; phase: string; state: 'orphan' | 'cancelling' | 'transfer' | 'steady' }[];
  markers: string[]; candidate: boolean; exempt: string | null; signature: string; verbs: string[]; pos: [number, number, number]; pending: boolean };
