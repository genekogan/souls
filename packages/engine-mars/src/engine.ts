import {LIE_CLEARANCE} from '../../../mars/viewer/engine/social/pose.ts';
import {regionArrivalMask} from './region-arrival.ts';
import { createHash } from 'node:crypto';
import { capturePhysicalHashInput, capturedPhysicalHashSteps, physicalHashNeedsLegacyCapture } from './checkpoint-hash.ts';
import { stableStringify } from '@souls/engine-contract';
import {bodyProfile} from '../../../mars/viewer/engine/bodies/navigation.ts';
import {immutableAuthoredBoundaryFact} from '../../../mars/viewer/engine/spatial/edits.ts';
import {keepStaticGridsForBoot,withStaticGridReadCache,type BootGridStore} from '../../../mars/viewer/engine/spatial/grid.ts';
import {edenGroundTransitionV1Schema,type EdenGroundTransitionV1} from '@souls/engine-contract';
import type {EdenGroundReaderV1} from './eden-ground.ts';
import {readClassroom} from '../../../mars/viewer/engine/activities/classroom.ts';
import {edenLectureV1} from './eden-lecture.ts';
import {edenLectureTransitionV1Schema,type EdenLectureTransitionV1,type EdenLecturePlacementV1} from '@souls/engine-contract';
import {nativeSleepSnapshotPolicyV1Schema,type NativeSleepSnapshotPolicyV1} from '@souls/engine-contract';
import {NATIVE_SLEEP_SNAPSHOT_V1} from '../../../mars/viewer/engine/activities/sleep.ts';
import {commonsNewcomerResourcesV1} from './newcomer-resources.ts';
import {newcomerResourcesPublicV1Schema,commonsNewcomerResourcesV1Schema,type CommonsNewcomerResourcesV1,type NewcomerResourcePlacementV1} from '@souls/engine-contract';
import {existingGreenLandmarkV1} from './green-landmark.ts';
import {existingGreenLandmarkTransitionV1Schema,type ExistingGreenLandmarkTransitionV1} from '@souls/engine-contract';
import {fixtureSlots, isFree, seatApproach} from '../../../mars/viewer/engine/social/slots.ts';
import {angleDelta} from '../../../mars/viewer/engine/core/math.ts';
import {publishedWaitsFor} from '../../../mars/viewer/engine/runtime/waits.ts';
import {inShoreDomain} from '../../../mars/viewer/engine/locomotion/connected-shore.ts';
import {rerouteCarrier,setCarrierRoute,type CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {puntCandidates,previewPunt,PuntSearch} from './punt.ts';
import {probeBody,releaseBody,setDownFrom,supportedSetDownV1} from './stall.ts';
import {commonsFoodDeliveryItemsV1} from './food-delivery.ts';
import {commonsFoodDeliveryV1Schema,type CommonsFoodDeliveryV1} from '@souls/engine-contract';
import {socialEdenV1} from './social-eden.ts';
import {applyWorldEdit,worldEditChangesNavigation,type WorldEditV1} from './entity-physics.ts';
import {applyUpperFloorsV1,placeLevelOf,previewUpperFloorsV1,type UpperFloorsFactV1,type UpperFloorsV1} from './upper-floors.ts';
import {registerAssets} from './catalog-adapter.ts';
import {socialEdenTransitionV1Schema,type SocialEdenTransitionV1} from '@souls/engine-contract';
import {searchArrival,arrivalPocket,type ArrivalGround,type ArrivalPocket,type ArrivalSpot} from './arrival-search.ts';
import {attachGround,groundRegistry,installGroundV1 as installGround,previewGroundV1,standOn,groundArrival,groundRecipe,inDeepWater,destinationInDeepWater} from './ground-bridge.ts';
// The Mars engine behind Sim's engine contract.
//
// The shell speaks a small BODY LANGUAGE (walk_to, sit, stand, rest, wave,
// converse, gather, perform, ambient_wander): what one actor's body does. This
// adapter lowers each of those to Mars verbs, runs an actor's steps one after
// another, and reports progress. Raw Mars verbs are also reachable, as
// `mars:<verb>`, for vocabulary that belongs to a Mars world (serve, eat, carry…).
//
// Three rules it enforces, which the Mars runtime leaves to its caller:
//  1. One actor, one program. A step that moves the body first releases whatever
//     held that actor (a seat, a circle); one that only waits keeps it.
//  2. Joint staging is borrowed. A Mars verb that takes several actors (converse)
//     borrows the others' bodies only while they are free; their own program takes
//     them back at any time, and the borrower treats that as the scene ending.
//  3. Feasibility is asked first (verb.plan), because in Mars even a refused
//     instruction pulls a person out of what they were doing.
import { hashOf, physicalView, type BirthNearV1, type ActionRecord, type ActivityOption, type Anchor, type ChangeEvent, type Engine, type EngineFactory, type EngineSnapshot, type EngineSnapshotCapture, type EngineCheckpointCapture, type EngineCheckpoint, type PathCommit, type PoseSample, type Program, type ProgramEvent, type RuntimeEvent, type RuntimeView, type Vec3, type VerbInfo, type WorldState } from '@souls/engine-contract';
import { loadMars, type Mars } from './load.ts';
import type {CampExpansionReader} from './camp-expansion.ts';
import {campExpansionV1Schema,type CampExpansionV1,type CampExpansionAdmissionV1} from '@souls/engine-contract';
import { CodecError, assertCapturedHashable, captureGraph, prepareImmutableSnapshotData } from '../../../mars/viewer/engine/runtime/codec.ts';
import { constructionPlan, unsafeConstruction, type BuildPhase } from './construction.ts';
import { disassemblyPlan, DISASSEMBLY_POLICY } from './disassembly.ts';
import { MARS_2026_MAP, withMars2026Map } from './mars-2026-map.ts';
import { disassemblyRegistry } from '../../../mars/viewer/engine/construction/disassembly.ts';
import { raiseHold, looseFramesHeld } from './raise-hold.ts';
import { connectBeamV1, framesStand } from './beam-connect.ts';
import { decksBear, installJoistV1, laySheetV1 } from './deck-install.ts';
import { installFlightV1, installTreadV1, stairsBear } from './stair-install.ts';
import { captureRenderScene, commonsSceneMetadataV1Schema, type RenderSceneCaptureV1, type RenderScene } from '@souls/engine-contract';
import {readLocalClassroomV1} from './classroom-observation.ts';
import { readNativeGathering } from './gathering-observation.ts';
import { prepareCommonsTransition } from './commons-transition.ts';
import { commonsTransitionV1Schema,type CommonsTransitionV1,type CommonsTransitionAdmissionV1 } from '@souls/engine-contract';
import {crewRemovalTransitionV1Schema,type CrewRemovalTransitionV1,type CrewRemovalTransitionAdmissionV1} from '@souls/engine-contract';
import {commonsProvisions,COMMONS_PERSONAL_RESOURCES} from './commons-provisions.ts';
import {commonsKitchen,COMMONS_KITCHENS,type CommonsKitchenVersion} from './commons-kitchen.ts';
import type {RetainedCommonsShoreReader} from './retained-shore.ts';
import {retainedCommonsShoreV1Schema,type RetainedCommonsShoreV1,type RetainedCommonsShoreAdmissionV1} from '@souls/engine-contract';
import { decodeSnapshot, type RuntimeSnapshot, type RuntimeSnapshotCapture } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {encode} from '../../../mars/viewer/engine/runtime/codec.ts';
import { dcos,dsin,hypot } from '../../../mars/viewer/engine/core/math.ts';
import { clearanceAt, nearestBlocker } from '../../../mars/viewer/engine/spatial/grid.ts';
import { acknowledgeRelocation } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { listTable, stableIndices, withEntityList, type EntityTable } from '../../../mars/viewer/engine/world/entity-list.ts';
import { CATALOG, HUMAN_RADIUS } from '../../../mars/viewer/engine/world/catalog.ts';
import { HUMAN_PROFILE as HUMAN_PROFILE_V1 } from '../../../mars/viewer/engine/spatial/types.ts';
import type { Spatial, StaticExportV1 } from '../../../mars/viewer/engine/spatial/service.ts';
import { NavConnectivity, NAV_CONNECT_POLICY, NAV_RESCUE_MAX_POCKET, CONNECT_CLEAR, type ConnPoint, type ConnVerdict } from '../../../mars/viewer/engine/spatial/connectivity.ts';
/** lane NAV: a body in one of these activities is anchored to furniture (seat, bed, berth): never relocated as cut off. */
const NAV_ANCHORED=new Set<unknown>(['sit','lie','nap','sleep']);
// L1: Object.values(entities)'s list, ~2.7x cheaper on a big world's dictionary-mode object (fresh array each call)
import { listEntities } from '../../../mars/viewer/engine/world/entity-list.ts';
import type {NativeBoatControlsV1} from '@souls/engine-contract';
import type {BodyLocationV1} from '@souls/engine-contract';
import {bodyDanceStep} from '../../../mars/viewer/engine/bodies/motion.ts';
import {bodyProblem} from '../../../mars/viewer/engine/bodies/body.ts';
import {humanRadius,seatOutOfReach} from '../../../mars/viewer/engine/bodies/humanoid.ts';
import {slotTransitionIssue,obstacleIndex,type ObstacleIndex} from '../../../mars/viewer/engine/social/actions.ts';
import {PLAN_MARGIN} from '../../../mars/viewer/engine/spatial/path.ts';
import {creatureOf} from '../../../mars/viewer/engine/bodies/creatures.ts';
import type {Body} from '../../../mars/viewer/engine/world/types.ts';
import {renderPlatformsV1Schema,type RenderPlatformsV1} from '@souls/engine-contract';
import {officeStairGuardsV1Schema,type OfficeStairGuardsV1} from '@souls/engine-contract';
import {authoredBoundariesV1Schema,authoredBoundariesDeclarationV1Schema,type AuthoredBoundariesV1,type AuthoredBoundariesDeclarationV1} from '@souls/engine-contract';
import {placeOnGround} from '../../../mars/viewer/engine/items/model.ts';
/** One fixture slot's verdict from useCheckV1 (lane BS1). */
export type UseCheckV1={id:string;of:string;kind:'seat'|'berth';level:number;ok:boolean;code?:string;message?:string;at?:[number,number]};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Make the next Spatial.sync rebuild (incrementally, from the previous grids): the world's scene contribution changed
 *  without a static entity changing. L8: please replace with a public `Spatial.invalidate()`. */
function invalidateSpatialV1(spatial:Spatial){const snaps=(spatial as unknown as {snaps:unknown[]}).snaps;snaps.push({id:'\u0000world-edit'});}
const TPS = 20;
const KEY_EVERY = 5;                       // ticks between broadcast keyframes for a moving body (4 per second)
const SETTLED = new Set(['gathered', 'occupied', 'talking']); // phases in which a Mars hold has arrived and simply continues
const RELEASE_TIMEOUT = 15 * TPS;          // how long a program waits for its actor to be let go
const KEEP_RECORDS = 120 * TPS;            // finished Mars action records are kept this long, then forgotten
const SNAPSHOT_FORMAT = 'sim-mars-snapshot/1';

type Diag = { code: string; message: string; subjects?: string[]; details?: Record<string, unknown> };
const SHARED_WATER_WAIT_POLICY = 'shared-water-wait/1';
/** shared-water-wait/2 (prospective): /1 plus a mutual-wait courtesy. When two swimmers each wait on the other's
 * body, the one with the larger entity id steps aside (native make-way) so the other can go first. /1 programmes
 * in old snapshots keep the plain wait, so recorded histories replay unchanged. */
const SHARED_WATER_WAIT_POLICY_V2 = 'shared-water-wait/2';
const SHARED_WATER_WAIT_POLICIES = new Set([SHARED_WATER_WAIT_POLICY, SHARED_WATER_WAIT_POLICY_V2]);
type Op = { verb: string; params: Record<string, unknown>; settle: 'done' | 'held'; soft?: boolean; raw?: boolean } | { wait: number };
type Prog = {
  id: string; actor: string; label: string; steps: Program['steps'];
  index: number; started: boolean; since: number;
  blockedSince?: number;
  quietHeldSince?: number;
  spreadWaits?: number;
  waterWait?: {step: number; since: number; attempts: number};
  walkStopping?: Diag;
  waterStopRetry?: Diag;
  walkResume?: true;
  trafficSince?: number;
  trafficTries?: number;
  stopping?: Diag;
  /** PC08: stopped with `untilSafe` (a shared carry): a held-up action keeps its own hold-up diagnostic, not a retry's. */
  stopUntilSafe?: true;
  ops: Op[]; action?: string; settle?: 'done' | 'held'; soft?: boolean; until?: number;
  controlOf?:string;
  readiedActors?:string[];
  build?: { phase: BuildPhase; crew: string[]; stopping?: Diag; reverse?: true };
};
export type MarsWorldConfig = { /** PC13 (#692): the shared raise (raise_hold_v1 and its invariant); absent, SIM_SHARED_CARRY=1 decides. */ sharedCarryV1?:boolean; groundReclaimV1?:boolean; shoreDepartV1?:boolean; map?:typeof MARS_2026_MAP; walkSettleWaitV1?:boolean; occupiedLinkRoutingV1?:boolean; concurrentLinkEgressV1?:boolean; stairLandingClearanceV1?:boolean; stallReleaseSupportV1?:boolean; edgeMotionV1?:boolean; spreadClearV1?:boolean; disassemblyV1?:boolean; spreadV2?:boolean; yieldTimeoutV1?:boolean; quietStallReleaseV1?:boolean; stairMakeWayV1?:boolean; reflexTimeoutV1?:boolean; walkBlockV1?:boolean; safeArrivalV1?:boolean; commonsArrivalV1?:boolean; commonsTransitionV1?:boolean; fixtureGroundGoalsV1?:boolean; nativeArrivalWitnessV1?:boolean; quietLandingCourtesyV1?:boolean; scene: 'proving-ground' | 'meal' | 'eden-camp' | 'littlemartians' | 'greenfield' | 'eden-commons'; clock?: { origin: number; dayTicks: number }; sleepBlockTicks?:number; quietSeatCourtesy?:boolean; safeCrewRemoval?:boolean; arrival: [number, number]; arrivalPlace: string; reference: [number, number]; grounds: { id: string; name: string } };
export const LITTLE_MARTIANS_WORLD: MarsWorldConfig={scene:'littlemartians',arrival:[0,18],arrivalPlace:'garden',reference:[0,16],grounds:{id:'grounds',name:'Ceramic garden'}};
export const GREEN_FIELD_WORLD:MarsWorldConfig={scene:'greenfield',arrival:[0,0],arrivalPlace:'field',reference:[2,0],grounds:{id:'grounds',name:'Green field'}};
export const EDEN_COMMONS_WORLD:MarsWorldConfig={scene:'eden-commons',arrival:[14,4],arrivalPlace:'commons',reference:[9,5],grounds:{id:'grounds',name:'Eden commons'}};
export const EDEN_SAFE_COMMONS_WORLD:MarsWorldConfig={...EDEN_COMMONS_WORLD,safeArrivalV1:true};
const PROVING_GROUND: MarsWorldConfig = { scene: 'proving-ground', arrival: [-24, -10.5], arrivalPlace: 'lawn', reference: [-24, -8], grounds: { id: 'grounds', name: 'the grounds' } };

const secs = (v: unknown, d: number) => Math.round(Math.min(3600, Math.max(0.5, typeof v === 'number' ? v : d)) * TPS);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** free-goal/1: the walk-step marker (`free`, with an optional room polygon `freeWithin`), the gap (m) another body leaves a
 *  goal free by (as birth-near/1) and the most route plans one step tries. */
export const FREE_GOAL_V1 = 'goal/1', FREE_GOAL_GAP = 0.8, FREE_GOAL_PLANS = 8;
/** stand/1 (#374, prospective): the walk-step marker (`stand`) for a standoff point with standing room. On paged ground a
 *  long walk's plan checks only its first fine hop, so a standoff point inside a solid (a ride's own collider) passes the
 *  plan and fails at the last hop (`route.goal-blocked`). A marked step takes only a point with room for the walker's
 *  body (an exact clearance read) and, when no turn around the target has room and a route, the nearest standable point
 *  at most STAND_CLEAR_BEYOND metres beyond the standoff (a ride boards within 3.2 m of its carrier): STAND_CLEAR_SPOKES
 *  points on each half-metre ring out to there, nearest the first turn first, at most FREE_GOAL_PLANS route plans. Unmarked steps keep the goal they always chose. */
export const STAND_CLEAR_V1 = 'clear/1', STAND_CLEAR_BEYOND = 0.9, STAND_CLEAR_SPOKES = 16;
const num = { type: 'number' }, str = { type: 'string' };
const ref = { anyOf: [str, { type: 'array', items: num, minItems: 2, maxItems: 2 }] };
/** The body language, as the card grammar and agents see it. The actor is always implied. */
export const BODY_VERBS: VerbInfo[] = [
  {verb:'activity_readiness_v1',description:'My bounded voluntary standing wait for one host and venue; only a matching owned classroom may hand over this wait.',inputSchema:{type:'object',properties:{host:{type:'string'},venue:{type:'string'},activity:{const:'classroom'},seconds:{type:'number',minimum:20,maximum:300}},required:['host','venue','activity','seconds'],additionalProperties:false}},
  {verb:'control_classroom_v1',description:'Apply an owned host control to its actual classroom without replacing its body programme; accepted control is not completed cleanup.',inputSchema:{type:'object',properties:{session:{type:'string',maxLength:80},kind:{enum:['cancel','advance']}},required:['session','kind'],additionalProperties:false}},
  { verb: 'build_lookout', description: 'Choose one finite camp construction job: stage carries rack parts to the build site; frame raises/connects/releases the uprights; deck installs joists/sheets; stairs completes access. Use the exact unprefixed verb build_lookout, target:null, approach:[], and a single during step with phase. The card sets only $actor.doing; physical part progress is maintained by the engine, never invented target states or permission links. The committed crew finishes a safe segment before interruption.', inputSchema: {type:'object',properties:{phase:{type:'string',enum:['stage','frame','deck','stairs']}},required:['phase']} },
  { verb: 'walk_to', description: 'Go to a thing or a point, stopping `standoff` metres short of it. Optional dry-ground gait: walk (default), jog (2.5 m/s), run (4 m/s), cycle (4.5 m/s, a docked bicycle); stairs remain slow.', inputSchema: { type: 'object', properties: { to: ref, standoff: num, gait: {enum:['walk','jog','run','cycle']}, pace: {enum:['shuffle','together']} }, required: ['to'] } },
  { verb: 'sit', description: 'Go to a free seat of a fixture (a bench, a chair) and sit there for a number of seconds; stays seated afterwards.', inputSchema: { type: 'object', properties: { on: str, seconds: num }, required: ['on'] } },
  { verb: 'stand', description: 'Stand up, leaving a seat or a place in a gathering.', inputSchema: { type: 'object', properties: {} } },
  { verb: 'rest', description: 'Stay as you are (seated if sitting) for a number of seconds.', inputSchema: { type: 'object', properties: { seconds: num, seatedAt:str } } },
  { verb: 'wave', description: 'Turn to face someone or something for a moment.', inputSchema: { type: 'object', properties: { at: str, seconds: num } } },
  { verb: 'converse', description: 'Stand in conversation with a nearby person for a number of seconds.', inputSchema: { type: 'object', properties: { with: str, seconds: num }, required: ['with'] } },
  { verb: 'gather', description: 'Take a place at a fixture (a campfire, a bench) or in a place with an audience layout, and stay for a number of seconds.', inputSchema: { type: 'object', properties: { at: str, seconds: num }, required: ['at'] } },
  { verb: 'perform', description: 'Perform where you stand for a number of seconds.', inputSchema: { type: 'object', properties: { what: str, seconds: num } } },
  { verb: 'ambient_wander', description: 'Stroll between nearby points, pausing, for a number of seconds within a radius in metres.', inputSchema: { type: 'object', properties: { seconds: num, radius: num } } },
];
const BODY = new Set(BODY_VERBS.map((v) => v.verb));
/** Offered only by an engine whose rules include disassembly/1 (never by the legacy body language). */
export const UNBUILD_VERB: VerbInfo = { verb: 'unbuild_lookout', description: 'Choose one finite camp disassembly job, the build in reverse: stairs takes the treads and flight down; deck lifts the sheets and joists off and carries them back to their piles; frame holds the uprights, takes the beams out and lowers the uprights; stage carries the rack parts back to the rack pile. Phases come down latest first (stairs, deck, frame, stage). Use the exact unprefixed verb unbuild_lookout, target:null, approach:[], and a single during step with phase. Refused while anyone is on the lookout. The committed crew finishes a safe segment before interruption.', inputSchema: {type:'object',properties:{phase:{type:'string',enum:['stairs','deck','frame','stage']}},required:['phase']} };
const NEEDS_BODY = new Set(['walk_to', 'sit', 'gather', 'converse', 'ambient_wander']);
/** Entry 35: two walking hand in hand stroll (m/s): slower than a walk alone, so the follower keeps beside the leader. */
const HAND_IN_HAND_SPEED = 1.0;
/** Mars's meal scenario as a world: the same proving ground, furnished and with its cast of four already there. */
export const MEAL_WORLD: MarsWorldConfig = { scene: 'meal', arrival: [-6, -12], arrivalPlace: 'lawn', reference: [-6, -10.5], grounds: { id: 'grounds', name: 'the grounds' } };

const inPoly = (x: number, z: number, poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const bucket = (m: number): 'here' | 'close' | 'near' | 'far' => (m < 2.5 ? 'here' : m < 9 ? 'close' : m < 28 ? 'near' : 'far');

/** Fresh physical bases use an explicit native binding; legacy factories omit it. */
export type MarsPhysicalBinding = {rulesVersion:string;renderScene:()=>RenderScene;restore:(snapshot:any)=>any;services:(world:any)=>any;prepareRemoval?:(runtime:any,id:string)=>boolean;boatControls?:(runtime:any,actor:string)=>NativeBoatControlsV1|null;bodyLocation?:(runtime:any,actor:string)=>BodyLocationV1|null};
/** nav/1 install spec (Core derives it from place data): flat ground rectangles and solid oriented boxes. */
export type NavSpecV1={version:'nav/1';ground:{id:string;boundsXZ:[number,number,number,number]}[];solids:{id:string;label?:string;c:[number,number];half:[number,number];yaw:number;height?:number}[]};
/** E2 #1: the level-0 grid for each point of a polygon read. Paged ground answers per 64 m tile (a place over ~100 m
 *  spans several nav windows, and the centre's window reads its far parts as blocked); other worlds keep their one grid. */
function levelGridsFor(spatial:Spatial,centre:(q:[number,number])=>boolean,t:number){
  const paged=(spatial as unknown as {ground?:{paged?:boolean}}).ground?.paged===true,tiles=new Map<string,((q:[number,number])=>boolean)|null>();
  // L1 (memory/speed): each tile's test answers as levelAt's grid would (clearance ≥ t), without copying a composite or
  // building fine tiles off the windows (Spatial.clearTester)
  return (x:number,z:number):boolean=>{if(!paged)return centre([x,z]);const k=Math.floor(x/64)+','+Math.floor(z/64);if(!tiles.has(k))tiles.set(k,spatial.clearTester(0,[x,z],t));const r=tiles.get(k);return r?r([x,z]):false;};
}

export class MarsEngine implements Engine {
  get nativeArrivalWitnessEnabledV1(){return this.cfg.nativeArrivalWitnessV1===true;}
  readonly dt = 1 / TPS;
  readonly schema: string;
  private composedRules(base:string,change?:{provisions?:boolean;kitchen?:CommonsKitchenVersion|null;food?:boolean;social?:boolean;green?:boolean}){const provisions=change?.provisions??this.commonsProvisionsActive,kitchen=change&&'kitchen' in change?change.kitchen:(this.commonsKitchenActive?this.commonsKitchenVersion:null),food=change?.food??!!this.foodDeliveries.length,social=change?.social??this.socialEdenActive,green=change?.green??this.greenLandmarkActive;return base+(provisions?(this.newcomerResources.length?'+cp/2':'+commons-provisions/1'):'')+(kitchen?'+'+kitchen:'')+(food?'+fd/1':'')+(social?'+social-eden/1':'')+(green?'+g/1':'')+(this.lecturePlacement?'+l/1':'')+(this.sleepSnapshotActive?'+ss/1':'');}
  get rulesVersion(){return this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg));}
  readonly runtime: RuntimeView;
  private m: Mars; private rt: any; private cfg: MarsWorldConfig;
  private physical?:MarsPhysicalBinding;
  private feasibilityRead?:Map<string,Diag|null>;
  private campExpansionReader?:CampExpansionReader;
  private registry: Map<string, any>;
  private programs = new Map<string, Prog>();
  private byActor = new Map<string, string>();
  private nextProg = 1;
  private cursor = 0;
  private keys = new Map<string, PoseSample>();      // last broadcast keyframe per body
  private acts = new Map<string, string>();          // last broadcast activity per body
  private ons = new Map<string, string | null>();
  private leaving: string[] = [];                    // bodies to remove once nothing holds them
  private out: { paths: PathCommit[]; changes: ChangeEvent[]; programs: ProgramEvent[] } = { paths: [], changes: [], programs: [] };
  private recorder: any;
  private servingPrepared = false;
  private readerRecordingDepth=0;
  private recorderScene!: RenderSceneCaptureV1;
  private renderBaseKey = '';
  private takeScenes = new Map<string,RenderSceneCaptureV1>();
  private quiet = false;
  private crewRemovalTransitionReader=false;
  private foodDeliveryReader=false;
  private foodDeliveries:CommonsFoodDeliveryV1[]=[];
  private edenGroundReader?:EdenGroundReaderV1;
  private lectureReader=false;
  private lecturePlacement?:EdenLecturePlacementV1;
  private socialEdenReader=false;
  private socialEdenActive=false;
  private greenLandmarkReader=false;
  private greenLandmarkActive=false;
  private retainedShoreReader?:RetainedCommonsShoreReader;
  private commonsKitchenReaderVersion:CommonsKitchenVersion='commons-kitchen/1';
  private commonsKitchenVersion:CommonsKitchenVersion='commons-kitchen/1';
  private commonsKitchenReader=false;
  private commonsKitchenActive=false;
  private sleepSnapshotReader=false;
  private sleepSnapshotActive=false;
  private newcomerReader=false;
  private newcomerResources:CommonsNewcomerResourcesV1[]=[];
  private commonsProvisionsReader=false;
  private commonsProvisionsActive=false;
  private chunks: { fromTick: number; toTick: number; take: unknown }[] = [];
  private renderPlatformMetadata?:RenderPlatformsV1;

  constructor(m: Mars, rt: any, cfg: MarsWorldConfig, saved?: { programs: Prog[]; nextProg: number; leaving: string[];renderPlatformsV1?:RenderPlatformsV1 }, physical?:MarsPhysicalBinding) {
    this.m = m; this.rt = rt; this.cfg = structuredClone(cfg); this.registry = rt.registry;this.physical=physical;
    // ground/1 (lane L8): an entity world's terrain; absent in every authored world
    if(rt.world.groundV1){attachGround(rt);this.registry=rt.registry;}
    if(this.cfg.walkSettleWaitV1===true)this.rt.services.walkSettleWaitV1=true;
    if(this.cfg.occupiedLinkRoutingV1===true)this.rt.services.occupiedLinkRoutingV1=true;
    if(this.cfg.concurrentLinkEgressV1===true)this.rt.services.concurrentLinkEgressV1=true;
    if(this.cfg.stairLandingClearanceV1===true)this.rt.services.stairLandingClearanceV1=true;
    if(this.cfg.shoreDepartV1===true)this.rt.services.shoreDepartV1=true;
    this.rt.services.doorPassersV1=this.doorPassersV1;
    if(rt.world.authoredBoundariesV1)immutableAuthoredBoundaryFact(rt.world.authoredBoundariesV1);
    this.schema = rt.world.schema;
    if (saved) { for (const p of saved.programs) { for(const step of p.steps)if(step.params?.spreadWaitPolicy!==undefined&&!this.sharedWaterStep(step))throw Error('snapshot.unknown-spread-wait-policy');this.programs.set(p.id, p); this.byActor.set(p.actor, p.id); } this.nextProg = saved.nextProg; this.leaving = saved.leaving; }
    if(saved?.renderPlatformsV1)this.renderPlatformMetadata=renderPlatformsV1Schema.parse(saved.renderPlatformsV1);
    // entity-physics/1 (world-edit, lane L9): a restored entity world re-registers its derived assets and re-bases its
    // Spatial on its own physics (absent in every authored world, so they are untouched).
    if(rt.world.entityPhysicsV1){prepareImmutableSnapshotData(rt.world.entityPhysicsV1, '$.entityPhysicsV1');registerAssets(rt.world.entityPhysicsV1.assets);}
    // A restored world's services come from its factory's genesis base (snapshot restore): re-base on the world's own
    // logged static facts (nav/1, office guards, authored boundaries, upper floors, entity physics) so a restart equals
    // the live world in every state, including after all upper floors are removed. A no-op when the base id already matches.
    (rt.services.spatial as Spatial|undefined)?.refreshForWorld?.(rt.world);
    // a restore keeps the navigation epoch its snapshot recorded (the ground/re-base rebuilds above moved it)
    if(saved)(rt.services.spatial as Spatial|undefined)?.adoptRestoredEpoch?.();
    this.cursor = rt.events.length;
    this.startRecorder();
    const self = this;
    this.runtime = {
      get tick() { return self.rt.tick as number; },
      get records() { return self.rt.records as Map<string, ActionRecord>; },
      get violations() { return self.rt.violations as { tick: number; code: string; message: string }[]; },
      liveIds: () => [...(self.rt.records as Map<string, any>).values()].filter((r) => self.rt.isActive(r.id)).map((r) => r.id as string).sort(),
    };
  }

  get world(): WorldState { return this.rt.world as WorldState; }
  private get ents(): Record<string, any> { return this.rt.world.entities; }
  describeVerbs(): VerbInfo[] {
    return [...BODY_VERBS, ...(this.cfg.disassemblyV1?[UNBUILD_VERB]:[]), ...this.m.describeVerbs(this.registry).filter(v=>v.verb!=='hand_actuator_v1').map((v) => ({ ...v, verb: `mars:${v.verb}`, description: `[Mars verb] ${v.description}`, scope: 'world' as const }))];
  }
  /** Pay the recorder's cold copy/text preparation before HTTP opens, without finishing or replacing a take.
   * Discard the result: every real cut still calls finalStateOf against the then-current live world. */
  prepareForServing(): void {
    if (this.servingPrepared) return;
    this.m.finalStateOf(this.rt.world);
    this.servingPrepared = true;
  }
  /** The world plus the adapter's own state (which program each actor is in), since both decide what happens next. */
  stateHash(): string { return this.stateHashWithWorld(this.rt.stateHash()); }
  /** Reuse only the native hash captured synchronously by snapshot(); never cache a live world hash across calls. */
  private stateHashWithWorld(nativeStateHash: string): string { return hashOf(this.stateHashInputs(nativeStateHash)); }
  private stateHashInputs(nativeStateHash: string) { return { ...(this.cfg.groundReclaimV1===true?{groundReclaimPolicy:'ground-reclaim/1'}:{}), ...(this.world.officeStairGuardsV1?{officeGuardPolicy:this.world.officeStairGuardsV1.version}:{}), ...(this.lecturePlacement?{lecturePolicy:this.lecturePlacement}:{}), ...(this.sleepSnapshotActive?{sleepSnapshotPolicy:NATIVE_SLEEP_SNAPSHOT_V1}:{}), ...(this.newcomerResources.length?{newcomerResources:this.newcomerResources}:{}), w: nativeStateHash, p: [...this.programs.values()], l: this.leaving, clock: this.cfg.clock ?? null, quiet: this.quiet, ...(this.cfg.safeCrewRemoval?{removalPolicy:'crew-removal/1'}:{}), ...(this.cfg.disassemblyV1?{disassemblyPolicy:DISASSEMBLY_POLICY}:{}), ...(this.cfg.fixtureGroundGoalsV1?{fixtureGoalPolicy:'ground-fixture-levels/1'}:{}), ...(this.cfg.nativeArrivalWitnessV1?{arrivalWitnessPolicy:'native-navigation-arrival/1'}:{}), ...(this.cfg.quietLandingCourtesyV1?{quietLandingPolicy:'idle-landing-courtesy/1'}:{}), ...(this.commonsProvisionsActive?{provisionsPolicy:'commons-provisions/1'}:{}), ...(this.commonsKitchenActive?{kitchenPolicy:this.commonsKitchenVersion}:{}), ...(this.greenLandmarkActive?{greenLandmarkPolicy:'existing-green-landmark/1'}:{}), ...(this.socialEdenActive?{socialPolicy:'social-eden/1'}:{}), ...(this.foodDeliveries.length?{foodDeliveryPolicy:'commons-food-delivery/1',foodDeliveries:this.foodDeliveries}:{}), ...(this.cfg.safeArrivalV1?{arrivalPolicy:'arrival-clearance/1'}:{}), ...(this.cfg.walkSettleWaitV1===true?{walkSettlePolicy:'walk-settle-wait/1'}:{}),...(this.cfg.occupiedLinkRoutingV1===true?{occupiedLinkPolicy:'occupied-link-routing/1'}:{}),...(this.cfg.concurrentLinkEgressV1===true?{concurrentLinkEgressPolicy:'concurrent-link-egress/1'}:{}),...(this.cfg.stairLandingClearanceV1===true?{stairLandingPolicy:'stair-landing-clearance/1'}:{}),...(this.cfg.stallReleaseSupportV1===true?{stallReleasePolicy:'stall-release-support/1'}:{}), ...(this.cfg.walkBlockV1?{walkPolicy:'walk-block/1'}:{}), ...(this.physical?{physicalBinding:this.physical.rulesVersion,physicalPolicy:this.cfg}:{}) }; }
  // Preserve the contract serializer's exact bytes; only the Node digest implementation changes.
  physicalHash(): string { return createHash('sha256').update(stableStringify(physicalView(this.world))).digest('hex'); }

  // ------------------------------------------------------------------ tick
  step() {
    // Rebased physical runtimes rebuild service state; the accepted policy stays in cfg.
    if(this.cfg.walkSettleWaitV1===true)this.rt.services.walkSettleWaitV1=true;
    if(this.cfg.occupiedLinkRoutingV1===true)this.rt.services.occupiedLinkRoutingV1=true;
    if(this.cfg.concurrentLinkEgressV1===true)this.rt.services.concurrentLinkEgressV1=true;
    if(this.cfg.stairLandingClearanceV1===true)this.rt.services.stairLandingClearanceV1=true;
    if(this.cfg.shoreDepartV1===true)this.rt.services.shoreDepartV1=true;
    this.rt.services.doorPassersV1=this.doorPassersV1;
    // Reader wrappers finish restoring public policies after construction.
    // Discard only their empty initial recorder before the first new frame.
    if(!this.readerRecordingDepth&&this.renderBaseKey!==this.renderContextKeyV1()){this.finishRecorder();this.startRecorder();}
    // S1 r2 (tranche 2026-10-19): one listing of the entity table a tick on an idle world instead of three (~4,500
    // entries on Eden 2026: listing them was over a quarter of an idle tick). The rides step changes no entry, so the
    // runtime's invariant pass reuses this listing when it runs no action code first (Runtime.step); the rest of this
    // tick reuses the pass's listing while nothing that runs here can add, remove or replace an entity: no live action
    // (clearStairHeads, timeoutStalledReflexes and the quiet point act only through live actions), no programme to
    // advance, no quiet point, no one leaving. The clock, attention and take recorder change no entry.
    // L4 (c): the listing the last step ended with, while nothing outside step has run engine code since (tableWritesV1)
    const cached = this.tableCacheV1;
    const reuse = !!cached && cached.entities === this.ents && this.tableCacheAt === this.tableWritesV1;
    if (reuse) this.tableReusesV1++;
    const table: EntityTable = reuse ? checkedTable(cached!) : listTable(this.ents);
    this.tableCacheV1 = null;
    this.m.stepCarriers(this.rt, table);   // carrier/1: rides move their seated riders first (no carriers: no effect)
    this.m.stepHandHolds(this.rt);         // entry 35: hands let go finish, a broken pair lets go (no holds: no effect)
    this.rt.step(table);
    const pass: EntityTable | null = (this.rt as any).passTable ?? null;
    const still = !!pass && pass.entities === this.ents && (this.rt as any).live.size === 0 && !this.quiet && this.programs.size === 0 && this.leaving.length === 0;
    this.updateClock();
    if (this.rt.tick % 10 === 0) this.updateAttention(still ? pass : null);
    if (this.quiet) this.advanceQuiet();
    if (this.cfg.stairMakeWayV1 === true && this.rt.tick % 200 === 0) this.clearStairHeads();
    if (this.cfg.reflexTimeoutV1 === true && this.rt.tick % 200 === 100) this.timeoutStalledReflexes();
    const tick: number = this.rt.tick;
    for (const p of [...this.programs.values()]) this.advance(p);
    if (tick - this.recorder.startTick >= 20) {
      // the next take's baseline is the state the last one ended in, this tick (the recorder samples from the pass's listing while it holds)
      const cut = () => this.startRecorder(this.finishRecorder());
      if (still) withEntityList(this.rt.world, cut, pass); else cut();
    }
    if (this.leaving.length) this.leaving = this.leaving.filter((id) => !this.tryRemove(id));
    // What changed, for broadcast: an activity change is an event; movement is a keyframe every KEY_EVERY ticks.
    // S1 r2: the bodies in Object.keys order, found again without reading every entity's kind while the table holds the
    // same objects under the same keys (stableIndices: an entity's kind never changes); the loop adds and removes none
    const ents = this.ents, listing: EntityTable = still ? pass! : listTable(ents), { keys, list } = listing as { keys: string[]; list: any[] };
    for (const i of stableIndices(ents, 'engine bodies', list, keys, (e: any) => e.kind === 'human').idx) {
      const id = keys[i], e = list[i];
      // creatures (bodies/creatures.ts) show a rest of 5 s or more as 'settle' (the duck sits, the snail withdraws, the dog lies
      // down); the short pauses inside a walk-with are not a rest
      if (e.body?.type === 'creature') { const resting = this.bodyResting(id) && this.restSecondsOf(id) >= 5; if (resting && e.human.activity === 'idle') e.human.activity = 'settle'; else if (!resting && e.human.activity === 'settle') e.human.activity = 'idle'; }
      const act: string = e.human.activity;
      if (this.acts.get(id) !== act) { this.acts.set(id, act); this.out.changes.push([tick, id, 'activity', act]); }
      const on: string | null = e.human.on ?? null;
      if ((this.ons.get(id) ?? null) !== on) { this.ons.set(id, on); this.out.changes.push([tick, id, 'on', on]); }
      if (tick % KEY_EVERY !== 0 && this.keys.has(id)) continue;
      const now = this.poseSampleOf(id), last = this.keys.get(id);
      if (last && (last[1] !== now[1] || last[3] !== now[3] || last[4] !== now[4])) this.out.paths.push({ entity: id, startTick: last[0], speed: 0, waypoints: [last, now], activity: act, actionId: e.human.task ?? '' });
      this.keys.set(id, now);
    }
    const events = this.rt.events.slice(this.cursor) as RuntimeEvent[];
    const out = { ...this.out, events };
    this.out = { paths: [], changes: [], programs: [] };
    // Bound memory. Mars keeps every event and record for ever, which suits a bounded rehearsal and not a world that never stops.
    if (this.rt.events.length > 20000) this.rt.events.splice(0, this.rt.events.length - 1000);
    this.cursor = this.rt.events.length;
    if (tick % 600 === 0) {
      const parents = new Set<string>(); for (const r of this.rt.records.values()) if (r.parent && this.rt.isActive(r.id)) parents.add(r.parent);
      for (const [id, r] of this.rt.records) if (r.endedTick !== undefined && r.endedTick < tick - KEEP_RECORDS && !parents.has(id)) this.rt.records.delete(id);
    }
    // L4 (c): the body loop changed no entry; the next step reuses this listing unless engine code runs in between
    this.tableCacheV1 = listing; this.tableCacheAt = this.tableWritesV1;
    return out;
  }

  private emit(p: Prog, kind: ProgramEvent['kind'], d?: Diag) {
    this.out.programs.push({ tick: this.rt.tick, id: p.id, actor: p.actor, kind, step: kind === 'step' ? p.index : -1, ...(d ? { code: d.code, message: d.message } : {}) });
  }
  private end(p: Prog, kind: 'completed' | 'failed' | 'cancelled', d?: Diag) {
    if (p.build && kind === 'failed' && unsafeConstruction(this.rt.world)) throw new Error(`construction.unsafe-failure: ${d?.code}: ${d?.message}; restore the accepted quiet baseline`);
    if (p.build?.stopping && kind === 'completed') { kind = 'cancelled'; d = p.build.stopping; }
    this.programs.delete(p.id); if (this.byActor.get(p.actor) === p.id) this.byActor.delete(p.actor);
    this.emit(p, kind, d);
  }
  private holders(actor: string): string[] { return this.rt.holder(`actor:${actor}`) as string[]; }
  /** Ask whatever holds this actor to let go. Returns true once nothing does (a seated person takes a moment to stand). */
  private release(actor: string, why: Diag): boolean {
    for (const h of this.holders(actor)) this.rt.cancel(h, { code: why.code, message: why.message });
    return this.holders(actor).length === 0;
  }

  /** Move a program forward as far as it can go this tick. */
  private advance(p: Prog) {
    const tick: number = this.rt.tick;
    if(p.stopping){
      // PC08: while an `untilSafe` stop's action is held up it stands still, so a retry would refuse again and only hide
      // the hold-up's own diagnostic (who is in the way); it is retried once the action moves again
      if(p.action&&this.rt.isActive(p.action)){if(!(p.stopUntilSafe&&this.rt.records.get(p.action)?.status==='blocked'))this.rt.cancel(p.action,p.stopping);return;}
      return this.end(p,'cancelled',p.stopping);
    }
    for (let guard = 0; guard < 12; guard++) {
      if (!this.ents[p.actor]) return this.end(p, 'cancelled', { code: 'actor.removed', message: 'the actor is gone' });
      if (!p.started) {
        // A program whose first step moves the body first leaves whatever seat, circle or borrowed conversation holds it.
        // One that only waits, turns, or uses this world's own verbs (eating while seated) keeps what it has.
        if (NEEDS_BODY.has(p.steps[0]?.verb) && !this.release(p.actor, { code: 'program.replaced', message: `replaced by ${p.label}` })) {
          if (tick - p.since > RELEASE_TIMEOUT) return this.end(p, 'failed', { code: 'actor.busy', message: 'the actor was not released in time' });
          return;
        }
        p.started = true; this.emit(p, 'step');
        const ops = this.lower(p, p.steps[0]); if (!Array.isArray(ops)) {if(this.retrySharedWaterV1(p,ops))continue;return this.end(p, 'failed', ops);}
        p.ops = ops;
      }
      if (p.until !== undefined) { if (tick < p.until) return; p.until = undefined; }
      if (p.action) {
        const rec = this.rt.records.get(p.action);
        // A timed-out walk can still own a between-level body. Preserve its
        // program until native cancellation actually reaches a safe landing.
        if (p.walkStopping) {
          if (rec && this.rt.isActive(rec.id)) { this.rt.cancel(rec.id, p.walkStopping); return; }
          if(p.waterStopRetry){const retry=p.waterStopRetry;p.waterStopRetry=undefined;p.walkStopping=undefined;p.action=undefined;p.settle=undefined;p.soft=undefined;p.blockedSince=undefined;p.quietHeldSince=undefined;if(this.retrySharedWaterV1(p,retry))return;return this.end(p,'failed',retry);}
          if (p.walkResume) { const why = p.walkStopping; p.walkStopping = undefined; p.walkResume = undefined; return this.trafficStepBack(p, why); }
          return this.end(p, 'failed', p.walkStopping);
        }
        if (rec) {
          const walkBlocked = this.cfg.walkBlockV1 && (rec.verb === 'walk_to'||this.physical&&rec.verb==='commons_shore_travel');
          const routeBlocked = /deadlock\.|walk.goal-occupied/.test(rec.diagnostic?.code ?? '');
          // Native sleep retains a failed/directed-away purpose for an explicit
          // Resume in the finite Lab. A living card must instead report blockage
          // and let the Soul choose again, so it cannot hold the daily barrier.
          const sleepBlocked = this.cfg.sleepBlockTicks !== undefined && rec.verb === 'sleep' && /^sleep\./.test(rec.diagnostic?.code ?? '');
          // Opt-in quiet drain: a walk/seat approach whose body stays held waiting on other
          // people (status running, never 'blocked') would hold the quiet barrier forever.
          // Release it through native cancellation like the blocked-walk timeout.
          // yieldTimeoutV1 (edge reflex floor): the same release outside quiet after 60 s, so a yield never holds a receipt forever.
          // edgeMotionV1: a walk held in a people jam (traffic.yield / traffic.person: a gridlock of walkers that the
          // runtime does not report as deadlock.*, e.g. four Souls each yielding at a deck's single-file step) steps
          // back after 10 s plus a per-actor stagger, waits 1-3 s and re-tries the same step (at most 6 times), so
          // one walker goes first and the rest follow instead of all freezing for ever.
          if (this.cfg.edgeMotionV1 === true) {
            const held = this.trafficHeld(p.actor);
            if (held) {
              p.trafficSince ??= tick;
              // An obstacle (someone else's walk waits for me to move out of the way) steps aside first, after 5 s.
              if (tick - p.trafficSince > (this.trafficWaiters(p.actor).length ? 100 : 200 + this.stagger(p.actor) * 40)) {
                const why = {code:'route.blocked',message:'stepped back from a crowd to let others pass first'};
                this.rt.cancel(rec.id, why);
                if (this.rt.isActive(rec.id)) { p.walkStopping = why; p.walkResume = true; return; }
                return this.trafficStepBack(p, why);
              }
            } else p.trafficSince = undefined;
          }
          const yieldLimit = this.quiet && this.cfg.quietStallReleaseV1 === true ? 600 : this.cfg.yieldTimeoutV1 === true ? 1200 : 0;
          const quietHeld = yieldLimit > 0 && ['walk_to','sit','take_slot','commons_shore_travel'].includes(rec.verb) && rec.status !== 'blocked' && this.rt.isActive(rec.id) && this.ents[p.actor]?.human?.activity === 'wait';
          if (quietHeld) {
            p.quietHeldSince ??= tick;
            if (tick - p.quietHeldSince > yieldLimit) {
              const why = {code:'route.blocked',message:this.quiet?'quiet checkpoint: this walk stayed held waiting on other people for 30 seconds':'this walk stayed held waiting on other people for a minute'};
              const water=this.sharedWaterBlockingAction(p,rec);this.rt.cancel(rec.id, why);
              if (this.rt.isActive(rec.id)) { p.walkStopping = why;if(water)p.waterStopRetry=water;return; }
              if(water&&this.retrySharedWaterV1(p,water)){p.action=undefined;p.settle=undefined;p.soft=undefined;p.quietHeldSince=undefined;return;}
              if (this.spreadRetry(p, 'route.occupied')) { p.action = undefined; p.settle = undefined; p.soft = undefined; p.quietHeldSince = undefined; return; }
              return this.end(p, 'failed', why);
            }
          } else p.quietHeldSince = undefined;
          if (rec.status === 'blocked' && (walkBlocked || routeBlocked || sleepBlocked)) {
            p.blockedSince ??= tick;
            if (tick-p.blockedSince > (sleepBlocked ? this.cfg.sleepBlockTicks! : 1200)) {
              const why = walkBlocked ? {code:'route.blocked',message:`walking has remained blocked for a minute: ${rec.diagnostic?.code ?? 'action.blocked'}`} : routeBlocked ? {code:'route.blocked',message:'the route has remained blocked for a minute'} : {code:'activity.blocked',message:`sleep has remained blocked for a minute: ${rec.diagnostic?.code}`};
              const water=this.sharedWaterBlockingAction(p,rec);this.rt.cancel(rec.id,why);
              if (walkBlocked && this.rt.isActive(rec.id)) { p.walkStopping = why;if(water)p.waterStopRetry=water;return; }
              if(water&&this.retrySharedWaterV1(p,water)){p.action=undefined;p.settle=undefined;p.soft=undefined;p.blockedSince=undefined;return;}
              if (walkBlocked && this.spreadRetry(p, 'route.occupied')) { p.action = undefined; p.settle = undefined; p.soft = undefined; p.blockedSince = undefined; return; }
              return this.end(p,'failed',why);
            }
          } else p.blockedSince = undefined;
          if (rec.status === 'failed' && this.spreadRetry(p, rec.diagnostic?.code,rec.diagnostic)) { p.action = undefined; p.settle = undefined; p.soft = undefined; continue; }
          if (rec.status === 'failed') { if (!p.soft || this.sharedWaterStep(p.steps[p.index]) && !!rec.diagnostic && this.waterBodyObstruction(rec.diagnostic,p.actor)) return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.failed', message: rec.diagnostic?.message ?? 'failed' }); }
          else if (rec.status === 'cancelled') { if (!p.soft) return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.interrupted', message: rec.diagnostic?.message ?? 'interrupted' }); }
          else if (rec.status !== 'completed' && !(p.settle === 'held' && SETTLED.has(rec.phase))) return; // still under way
        }
        p.action = undefined; p.settle = undefined; p.soft = undefined;
      }
      const op = p.ops.shift();
      if (!op) {
        p.index++;
        if (p.index >= p.steps.length) return this.end(p, 'completed');
        this.emit(p, 'step');
        const ops = this.lower(p, p.steps[p.index]);
        if (!Array.isArray(ops)) {
          // A shared-space spread goal that is momentarily full or crossed by another body waits
          // in place and re-chooses (1 s, at most a minute) rather than failing the programme.
          if(this.sharedWaterStep(p.steps[p.index])){if(this.retrySharedWaterV1(p,ops))continue;return this.end(p,'failed',ops);}
          const spread = String(p.steps[p.index]?.params?.spread ?? '');
          if (['pond/1','region/1','pond-lap/1'].includes(spread) && /occupied|region-full|goal-occupied/.test(ops.code) && (p.spreadWaits = (p.spreadWaits ?? 0) + 1) <= 60) { p.index--; p.ops = [{ wait: 20 }]; continue; }
          return this.end(p, 'failed', ops);
        }
        p.ops = ops; continue;
      }
      if ('wait' in op) { p.until = tick + op.wait; continue; }
      // Anything that needs the body free (all but standing up and raw Mars verbs, which know what they need) first leaves its seat or circle.
      if (op.verb !== 'stand' && !op.raw && this.holders(p.actor).length) {
        if (op.verb === 'face') continue;                                        // not worth standing up for
        if (!this.release(p.actor, { code: 'program.next-step', message: 'moving on' })) { p.ops.unshift(op); return; }
      }
      if (op.verb === 'shared_food_break') {
        for (const participant of (op.params.participants ?? []) as {actor:string}[]) {
          if (participant.actor === p.actor) continue;
          const invitation = this.byActor.get(participant.actor), host = invitation ? this.programs.get(invitation) : undefined;
          if (host?.label.startsWith('host supper ') && this.holders(participant.actor).length === 0) this.stop(host.id);
        }
      }
      // A solo pose waits out a courtesy step aside (walk.ts makeWay, `<actor>:make-way:<tick>`) begun as the last step ended,
      // for at most 10 s, instead of failing pose.not-still; a grouped pose settles through it itself, any other walk refuses.
      if (op.raw && op.verb === 'pose_v1' && !op.params.group && this.holders(p.actor).some(id => tick - Number(/:make-way:(\d+)$/.exec(id)?.[1] ?? -Infinity) <= 200 && this.rt.isActive(id))) { p.ops.unshift(op); return; }
      const rec = this.rt.submit(op.verb, op.params);
      if (rec.status === 'failed' && (!op.soft || this.sharedWaterStep(p.steps[p.index])) && this.spreadRetry(p, rec.diagnostic?.code,rec.diagnostic)) continue;
      if (rec.status === 'failed') { if (op.soft && !(this.sharedWaterStep(p.steps[p.index]) && !!rec.diagnostic && this.waterBodyObstruction(rec.diagnostic,p.actor))) continue; return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.failed', message: rec.diagnostic?.message ?? 'refused' }); }
      p.action = rec.id; p.settle = op.settle; p.soft = op.soft;
    }
  }

  // ------------------------------------------------------------------ lowering
  private pos(id: string): [number, number] | null { const e = this.ents[id]; return e ? [e.pose.p[0], e.pose.p[2]] : null; }
  private pointOf(to: unknown): [number, number] | null {
    if (Array.isArray(to) && typeof to[0] === 'number' && typeof to[1] === 'number') return [to[0], to[1]];
    if (typeof to !== 'string') return null;
    const p = this.pos(to); if (p) return p;
    const r = this.rt.world.regions[to]; if (r) return centroid(r.polygon);
    return null;
  }
  private plan(verb: string, params: unknown, subjects = false): Diag | null {
    const def = this.registry.get(verb); if (!def) return { code: 'action.unknown-verb', message: `no action verb "${verb}"` };
    const parsed = def.schema.safeParse(params); if (!parsed.success) return { code: 'action.invalid-params', message: parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    const body=this.m.admitFloaters(verb,parsed.data,(id:string)=>this.ents[id]?.body);
    if(body.status==='refuses')return {code:body.reason,message:body.note};
    const r = def.plan(this.rt, parsed.data);
    // PC07: a preview of a `holdCutV1` carry also returns the planner's details (its search size and budget); others unchanged
    return r.ok ? null : { code: r.diagnostic.code, message: r.diagnostic.message, ...(subjects?{subjects:[...(r.diagnostic.subjects??[])],...(r.diagnostic.details&&(parsed.data as {holdCutV1?:true}).holdCutV1?{details:{...r.diagnostic.details}}:{})}:{}) };
  }
  /** VEHICLE-STEER: a pure check of a Mars verb (no `mars:` prefix) against the world now: the refusal it would meet, or null. */
  previewMarsVerbV1(verb: string, params: unknown): Diag | null { return this.plan(verb, params, true); }
  /** A reachable standing point `standoff` metres from a target, on the side the actor comes from if possible. 'here' if already there. */
  private goalNear(actor: string, to: unknown, standoff: number, stand?: unknown): { x: number; z: number; level: number } | 'here' | Diag {
    const me = this.pos(actor)!, t = this.pointOf(to);
    if (!t) return { code: 'target.unknown', message: `nothing to walk to: ${JSON.stringify(to)}` };
    const level = typeof to === 'string' ? (this.rt.world.regions[to]?.level ?? this.ents[to]?.human?.level ?? (this.cfg.fixtureGroundGoalsV1&&this.ents[to]?.support?.kind==='ground'?0:this.ents[actor].human.level)) : this.ents[actor].human.level;
    const dx = me[0] - t[0], dz = me[1] - t[1], d = Math.hypot(dx, dz);
    const isBody = typeof to === 'string' && !!this.ents[to];
    const room=this.cfg.scene==='littlemartians'&&typeof to==='string'&&this.rt.world.regions[to]?.kind==='place';
    const off = Math.max(standoff, isBody ? 0.9 : room?1.4:0);
    if (d <= off + 0.4 && level === this.ents[actor].human.level) return 'here';
    const base = Math.atan2(dz, dx);
    let last: Diag = { code: 'route.unreachable', message: 'no reachable standing point near the target' };
    // stand/1: an exact read of standing room for this body before a point is planned (null: no grid there, unchanged)
    const marked = stand === STAND_CLEAR_V1 && level === 0, radius = marked ? bodyProfile(this.ents[actor]).radius + PLAN_MARGIN : 0;   // the route's own goal check (spatial/path.ts prepare)
    const roomy = marked ? (() => { const sp = this.rt.services.spatial as Spatial; sp.sync(this.rt.world); return sp.clearTester(0, [t[0], t[1]], radius); })() : null;
    let turnRoom = false;
    for (const turn of off === 0 ? [0] : [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const x = r3(t[0] + Math.cos(base + turn) * off), z = r3(t[1] + Math.sin(base + turn) * off);
      if (roomy && !roomy([x, z])) continue;
      turnRoom = true;
      const no = this.plan(this.movementVerb(actor,x,z), { actor, x, z, level });
      if (!no) return { x, z, level };
      last = no;
    }
    if (roomy) {
      // the fallback: points around the target (never further than STAND_CLEAR_BEYOND past the standoff) with room and no
      // other body within 0.8 m, ring by ring from the standoff out, nearest the first turn first; the first that plans
      const people = (listEntities(this.ents) as any[]).filter(o => o.kind === 'human' && o.id !== actor).map(o => [o.pose.p[0], o.pose.p[2]] as [number, number]);
      const rings: number[] = []; for (const r of off === 0 ? [.5, STAND_CLEAR_BEYOND] : [off, off + .5, off + STAND_CLEAR_BEYOND]) rings.push(r);   // below the 3.2 m boarding reach after rounding
      let roomless = !turnRoom, plans = 0;
      for (const rr of rings) if (plans < FREE_GOAL_PLANS) for (const k of Array.from({ length: STAND_CLEAR_SPOKES }, (_, i) => i).sort((a, b) => Math.min(a, STAND_CLEAR_SPOKES - a) - Math.min(b, STAND_CLEAR_SPOKES - b) || a - b)) {
        const ang = base + (k / STAND_CLEAR_SPOKES) * Math.PI * 2, x = r3(t[0] + dcos(ang) * rr), z = r3(t[1] + dsin(ang) * rr);
        if (!roomy([x, z])) continue;
        roomless = false;
        if (people.some(([px, pz]) => hypot(px - x, pz - z) < .8)) continue;
        if (++plans > FREE_GOAL_PLANS) break;
        const no = this.plan(this.movementVerb(actor, x, z), { actor, x, z, level }); if (!no) return { x, z, level }; last = no;
      }
      if (roomless) {
        // nothing was planned: no point around the target has room. Said as the walk's own goal refusal, naming the blocker
        const p0: [number, number] = [r3(t[0] + Math.cos(base) * off), r3(t[1] + Math.sin(base) * off)], sp = this.rt.services.spatial as Spatial, g = sp.levelAt(0, p0), b = g ? nearestBlocker(g, p0, 1.5) : undefined;
        last = { code: 'route.goal-blocked', message: `no standing room for a ${radius.toFixed(2)} m-radius body ${off ? `${off} m from the target` : 'at the target'} (${p0[0].toFixed(2)}, ${p0[1].toFixed(2)}) or up to ${STAND_CLEAR_BEYOND} m beyond it around the target${b ? ` (blocked by ${b})` : ''}`, ...(b ? { subjects: [b] } : {}) };
      }
    }
    return last;
  }
  /** Opt-in (`spread:'pond/1'`) shared-water goal chosen when the step expands, so every
   * retry re-chooses: a spaced spot inside the region away from other bodies and from
   * other running shore/walk targets, first with a currently plannable native route.
   * Absent the parameter, region goals keep the original single-centroid behaviour. */
  private spreadGoalV1(actor:string,region:string,mode:unknown='pond/1',subjects=false,regionOutside?:unknown):{x:number;z:number;level:number}|'here'|Diag{
    const r=this.rt.world.regions[region],e=this.ents[actor];if(!r||!e)return {code:'target.unknown',message:`nothing to walk to: ${region}`};
    const lap=mode==='pond-lap/1'; // pond-lap/1: from inside the water, glide on to a different spaced spot
    // A recorded mask (including []) opts new outdoor walks into physical arrival;
    // old programs retain their historical X/Z-only no-op for exact replay.
    const mask=regionArrivalMask(regionOutside,bodyProfile(e).radius+.07);if(!mask)return{code:'route.region-geometry-invalid',message:'The outdoor arrival exclusions are not bounded finite polygons'};
    if(!lap&&(regionOutside===undefined||(e.human?.level??0)===(r.level??0))&&inPoly(e.pose.p[0],e.pose.p[2],r.polygon)&&mask.outside(e.pose.p[0],e.pose.p[2]))return 'here';
    const level=r.level??0,xs=r.polygon.map((p:number[])=>p[0]),zs=r.polygon.map((p:number[])=>p[1]),taken:number[][]=[];
    for(const o of listEntities(this.ents) as any[])if(o.id!==actor&&o.human)taken.push([o.pose.p[0],o.pose.p[2]]);
    for(const rec of this.rt.records.values() as Iterable<any>){const q=rec.params;if(q&&q.actor!==actor&&(rec.verb==='commons_shore_travel'||rec.verb==='shore_travel'||rec.verb==='walk_to')&&typeof q.x==='number'&&typeof q.z==='number'&&this.rt.isActive(rec.id))taken.push([q.x,q.z]);}
    const spots:[number,number][]=[];
    // pond/1: deep-side swimming grid. region/1: any place, spaced standing spots nearest its centre first.
    // spreadV2 (prospective policy): thin/small places (the 10 x 1.4 m commons strip, mats) keep real interior spots.
    const v2=this.cfg.spreadV2===true&&!(mode==='pond/1'||lap),ex=Math.max(...xs)-Math.min(...xs),ez=Math.max(...zs)-Math.min(...zs);
    const pond=mode==='pond/1'||lap,inset=pond?[2,4]:v2?[Math.min(.6,ex/4,ez/4),Math.min(.6,ex/4,ez/4)]:[1,1],step=pond?2.5:v2?1.0:1.5,mid=centroid(r.polygon);
    // spreadClearV1 (CN5, prospective policy): only spots on clear standing ground are candidates, so a place whose middle
    // is a fountain or a pond still takes arrivals inside it rather than beside it.
    const clearGrid=this.cfg.spreadClearV1===true&&!pond?(()=>{const sp=this.rt.services.spatial as Spatial;sp.sync(this.rt.world);return sp.level(level)??null;})():null;
    for(let x=Math.min(...xs)+inset[0];x<=Math.max(...xs)-inset[1];x+=step)for(let z=Math.min(...zs)+inset[0];z<=Math.max(...zs)-inset[0];z+=step){const p:[number,number]=[r3(x),r3(z)];if(inPoly(p[0],p[1],r.polygon)&&mask.outside(p[0],p[1])&&(!clearGrid||clearanceAt(clearGrid,p)>=HUMAN_RADIUS+.07)&&taken.every(t=>Math.hypot(t[0]-p[0],t[1]-p[1])>=(pond?1.4:1.0))&&(!lap||Math.hypot(p[0]-e.pose.p[0],p[1]-e.pose.p[2])>=4))spots.push(p);}
    if(!spots.length&&!pond&&mask.outside(mid[0],mid[1])&&taken.every(t=>Math.hypot(t[0]-mid[0],t[1]-mid[1])>=1.0))spots.push(mid); // a place smaller than the grid keeps its single centre
    // spreadV2: when the inside is full (or unreachable) stand just outside it, nearest first, on the ground
    // around a raised place (never mid-air beside a deck). Arriving at a busy place is not a refusal.
    const ring:[number,number][]=[];
    if(v2){const reach=Math.max(ex,ez)/2;for(const rr of [reach+.8,reach+1.6,reach+2.4])for(let k=0;k<12;k++){const a=k/12*Math.PI*2,p:[number,number]=[r3(mid[0]+Math.cos(a)*rr),r3(mid[1]+Math.sin(a)*rr)];if(!inPoly(p[0],p[1],r.polygon)&&mask.outside(p[0],p[1])&&taken.every(t=>Math.hypot(t[0]-p[0],t[1]-p[1])>=1.0))ring.push(p);}}
    if(!spots.length&&!ring.length)return {code:'route.region-full',message:`no spaced free spot remains in ${region}`};
    const offset=[...actor].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7)%spots.length;
    const order=[...spots.slice(offset),...spots.slice(0,offset)].map((p,i)=>({p,i,band:lap?Math.round(Math.abs(Math.hypot(p[0]-e.pose.p[0],p[1]-e.pose.p[2])-6)/2):pond?Math.round(Math.hypot(p[0]-e.pose.p[0],p[1]-e.pose.p[2])/8):Math.round(Math.hypot(p[0]-mid[0],p[1]-mid[1])/2)})).sort((a,b)=>a.band-b.band||a.i-b.i).slice(0,24);
    let last:Diag={code:'route.unreachable',message:'no reachable spaced spot'},crowded:Diag|undefined;
    for(const {p} of order){const no=this.plan(this.movementVerb(actor,p[0],p[1]),{actor,x:p[0],z:p[1],level},subjects);if(!no)return {x:p[0],z:p[1],level};last=no;if(subjects&&this.waterBodyObstruction(no,actor))crowded??=no;}
    if(v2&&ring.length){const ground=0;for(const p of ring.sort((a,b)=>Math.hypot(a[0]-e.pose.p[0],a[1]-e.pose.p[2])-Math.hypot(b[0]-e.pose.p[0],b[1]-e.pose.p[2])).slice(0,24)){const no=this.plan(this.movementVerb(actor,p[0],p[1]),{actor,x:p[0],z:p[1],level:ground});if(!no)return {x:p[0],z:p[1],level:ground};}
      return {code:'route.region-full',message:`${region} is full and nobody can stand beside it right now`};}
    return crowded??last;
  }
  private sharedWaterStep(step:Program['steps'][number]|undefined):boolean{return step?.verb==='walk_to'&&SHARED_WATER_WAIT_POLICIES.has(String(step.params?.spreadWaitPolicy))&&['pond/1','pond-lap/1'].includes(String(step.params?.spread));}
  /** Prospective plan-only policy: finite waits for actual human obstructions.
   * Static geometry and unknown envelopes never become waiting/success. */
  private waterBodyObstruction(d:Diag,actor:string):boolean{return d.code==='shore.occupied-route'&&!!d.subjects?.includes(actor)&&!!d.subjects?.some(id=>id!==actor&&!!this.ents[id]?.human);}
  /** Read only the native mover dependency graph; never infer blockers from text.
   * Connected dry-gate children report their actual body dependency here. */
  private sharedWaterBlockingAction(p:Prog,record:ActionRecord):Diag|undefined{
    if(!this.sharedWaterStep(p.steps[p.index]))return;
    if(record.diagnostic&&this.waterBodyObstruction(record.diagnostic,p.actor))return record.diagnostic;
    const owned=new Set([record.id]);for(let depth=0;depth<4;depth++){let added=false;for(const child of this.rt.records.values())if(child.parent&&owned.has(child.parent)&&!owned.has(child.id)&&this.rt.isActive(child.id)){owned.add(child.id);added=true;if(child.diagnostic&&this.waterBodyObstruction(child.diagnostic,p.actor))return child.diagnostic;}if(!added)break;}
    for(const id of Object.keys(this.ents))if(id!==p.actor&&this.ents[id]?.human)for(const code of ['traffic.person','traffic.yield','walk.goal-occupied'])if(publishedWaitsFor(this.rt,p.actor,id,code))return {code:'shore.occupied-route',message:'The native connected shore entry is waiting for another body.',subjects:[p.actor,id]};
  }
  private retrySharedWaterV1(p:Prog,d:Diag):boolean{
    if(!this.sharedWaterStep(p.steps[p.index])||!this.waterBodyObstruction(d,p.actor))return false;
    const tick=this.rt.tick,wait=p.waterWait?.step===p.index?p.waterWait:{step:p.index,since:tick,attempts:0};
    p.waterWait=wait;if(++wait.attempts>60)return false;
    const yielded=p.steps[p.index]?.params?.spreadWaitPolicy===SHARED_WATER_WAIT_POLICY_V2&&this.sharedWaterYieldV2(p,d);
    p.index--;p.ops=[{wait:yielded?3*TPS:TPS}];return true;
  }
  /** shared-water-wait/2: two swimmers standing in each other's shore route (each programme waiting on the other)
   * would both wait a minute and fail together. The larger entity id steps aside with a native courtesy walk. */
  private sharedWaterYieldV2(p:Prog,d:Diag):boolean{
    const other=d.subjects?.find(id=>id!==p.actor&&!!this.ents[id]?.human);if(!other||p.actor<other)return false;
    const qid=this.byActor.get(other),q=qid?this.programs.get(qid):undefined,w=q?.waterWait;
    if(!q||!w||(w.step!==q.index&&w.step!==q.index+1)||!this.sharedWaterStep(q.steps[w.step]))return false;
    const at=this.pos(other);if(!at)return false;
    this.m.makeWay(this.rt,p.actor,at);return true;
  }
  /** Edge reflex floor (yieldTimeoutV1): a shared-space spread step whose movement failed only because another body
   * was in the way waits 1 s and re-chooses its spot (at most a minute) instead of failing the programme. */
  private spreadRetry(p: Prog, code: string | undefined, diagnostic?:Diag): boolean {
    if(this.sharedWaterStep(p.steps[p.index]))return this.retrySharedWaterV1(p,diagnostic??{code:code??'',message:'blocked'});
    if (this.cfg.yieldTimeoutV1 !== true || !code || !/occupied/.test(code)) return false;
    const spread = String(p.steps[p.index]?.params?.spread ?? '');
    if (!['pond/1','region/1','pond-lap/1'].includes(spread) || (p.spreadWaits = (p.spreadWaits ?? 0) + 1) > 60) return false;
    p.index--; p.ops = [{ wait: 20 }]; return true;
  }
  /** edgeMotionV1 stroll: every leg is a checked native walk (at least 1.5 m, on the body's own level or the ground
   * around a raised place), so a stroll always visibly moves; when nothing nearby is walkable it refuses honestly. */
  private strollV1(me: string, home: [number, number], total: number, radius: number): Op[] | Diag {
    const ops: Op[] = [], level = this.ents[me]?.human?.level ?? 0; let spent = 0, legs = 0;
    for (let leg = 0; leg < 6 && spent < total; leg++) {
      for (let tries = 0; tries < 6; tries++) {
        const ang = this.m.nextRandom(this.rt.world.rng) * Math.PI * 2, dist = Math.max(1.5, (0.3 + 0.7 * this.m.nextRandom(this.rt.world.rng)) * radius);
        const x = r3(home[0] + Math.cos(ang) * dist), z = r3(home[1] + Math.sin(ang) * dist), verb = this.movementVerb(me, x, z);
        const at = [level, 0].find(l => !this.plan(verb, { actor: me, x, z, level: l }));
        if (at === undefined) continue;
        ops.push({ verb, params: { actor: me, x, z, level: at, ...(verb === 'walk_to' ? { speed: 0.9 } : {}) }, settle: 'done', soft: true }); legs++; break;
      }
      const pause = Math.round((2 + 6 * this.m.nextRandom(this.rt.world.rng)) * TPS); ops.push({ wait: pause });
      spent += pause + Math.round((radius / 0.9) * TPS * 0.6);
    }
    return legs ? ops : { code: 'route.region-full', message: 'there is no free ground to stroll on nearby' };
  }
  /** edgeMotionV1: the actor's own walk (its current task) is held by other people in traffic. */
  private trafficHeld(actor: string): boolean {
    const t = this.ents[actor]?.human?.task, r = t ? this.rt.records.get(t) : undefined;
    return !!r && r.status === 'blocked' && (r.verb === 'walk_to' || r.verb === 'commons_shore_travel') && /^traffic\./.test(r.diagnostic?.code ?? '');
  }
  /** Positions of other walkers held in traffic waiting for this actor to move out of their way. */
  private trafficWaiters(actor: string): [number, number][] {
    const out: [number, number][] = [];
    for (const o of listEntities(this.ents) as any[]) {
      const t = o.human?.task, r = t ? this.rt.records.get(t) : undefined;
      if (o.id !== actor && r?.status === 'blocked' && r.diagnostic?.code === 'traffic.person' && r.diagnostic.subjects?.[1] === actor) out.push([o.pose.p[0], o.pose.p[2]]);
    }
    return out;
  }
  private stagger(actor: string) { return [...actor].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 5; }
  /** Re-try the current step after a short staggered pause (the body stands, so others can pass or ask it to make way). */
  private trafficStepBack(p: Prog, why: Diag) {
    p.action = undefined; p.settle = undefined; p.soft = undefined; p.trafficSince = undefined; p.blockedSince = undefined; p.quietHeldSince = undefined;
    const waiters = this.trafficWaiters(p.actor);
    if (waiters.length) this.m.makeWay(this.rt, p.actor, waiters[0]);           // step out of their way (native courtesy walk)
    if ((p.trafficTries = (p.trafficTries ?? 0) + 1) > 6) return this.end(p, 'failed', why);
    p.index--; p.ops = [{ wait: (waiters.length ? 80 : 20) + this.stagger(p.actor) * 10 }];
  }
  /** free-goal/1 (READ-DISPLACEMENT, continuity C13 2026-10-31): a walk step marked `free:'goal/1'` (a shelf browse before
   *  or after reading) whose ground goal has another body within FREE_GOAL_GAP when the step begins ends at a free standing
   *  point within 1.5 m of it instead. Walking onto the body, or brushing past it, would have the native make-way courtesy
   *  (walk.ts makeWay) move an idle bystander with no decision or event of its own. A candidate is reached straight from the
   *  goal (never through a wall), lies in the same room (`within`: the room polygon the step names, if any) and the same
   *  native regions as the goal, and its planned route keeps 2r+0.1 from every body near the goal; nearest the goal, then
   *  nearest the walker, first; at most FREE_GOAL_PLANS route plans. Null: no such point, and the step is skipped (the browse happens where the walker
   *  stands). A clear goal, and any upper floor, is unchanged. */
  private freeGoalV1(me:string,g:{x:number;z:number;level:number},within?:unknown):{x:number;z:number;level:number}|null{
    if((g.level??0)!==0||!this.ents[me])return g;
    const people=(listEntities(this.ents) as any[]).filter(o=>o.kind==='human'&&o.id!==me&&(o.human?.level??0)===0).map(o=>[o.pose.p[0],o.pose.p[2]] as [number,number]);
    const free=(x:number,z:number)=>!people.some(([px,pz])=>hypot(px-x,pz-z)<FREE_GOAL_GAP);
    if(free(g.x,g.z))return g;
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const stand=spatial.clearTester(0,[g.x,g.z],HUMAN_RADIUS+.15),pass=spatial.clearTester(0,[g.x,g.z],HUMAN_RADIUS*.5);if(!stand||!pass)return null;
    const room=Array.isArray(within)&&within.length>=3&&within.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite))?within as [number,number][]:null;
    const regions=Object.entries(this.rt.world.regions as Record<string,{level?:number;polygon:[number,number][]}>).filter(([,r])=>(r.level??0)===0&&Array.isArray(r.polygon));
    const regionsAt=(x:number,z:number)=>regions.filter(([,r])=>inPoly(x,z,r.polygon)).map(([id])=>id).sort().join('|'),home=regionsAt(g.x,g.z);
    const from=this.pos(me)!,near=people.filter(([px,pz])=>hypot(px-g.x,pz-g.z)<=3),keep=2*bodyProfile(this.ents[me]).radius+.1;
    const cands:{x:number;z:number;ring:number;d:number}[]=[];
    for(let ring=1;ring<=3;ring++){const n=ring*8;for(let k=0;k<n;k++){
      const ang=(k/n)*Math.PI*2,x=r3(g.x+dcos(ang)*ring*.5),z=r3(g.z+dsin(ang)*ring*.5);
      if(!stand([x,z])||!free(x,z)||(room&&!inPoly(x,z,room))||regionsAt(x,z)!==home)continue;
      let straight=true;for(let t=.1;t<ring*.5-1e-9&&straight;t+=.1)straight=pass([g.x+(x-g.x)*t/(ring*.5),g.z+(z-g.z)*t/(ring*.5)]);
      if(straight)cands.push({x,z,ring,d:hypot(x-from[0],z-from[1])});}}
    cands.sort((a,b)=>a.ring-b.ring||a.d-b.d);   // nearest the goal, then the walker's side (stable: angle on a tie)
    for(const c of cands.slice(0,FREE_GOAL_PLANS)){
      if(this.movementVerb(me,c.x,c.z)!=='walk_to')continue;
      const def=this.registry.get('walk_to'),parsed=def?.schema.safeParse({actor:me,x:c.x,z:c.z,level:0});if(!def||!parsed?.success)continue;
      const r=def.plan(this.rt,parsed.data) as {ok:boolean;program?:{legs:{kind:string;points?:[number,number][]}[]}};
      if(!r.ok||!r.program||!r.program.legs.every(l=>l.kind==='walk'&&Array.isArray(l.points)))continue;
      let clear=true;
      for(const l of r.program.legs)for(let i=1;i<l.points!.length&&clear;i++){const [p0,p1]=[l.points![i-1],l.points![i]],n=Math.max(1,Math.ceil(hypot(p1[0]-p0[0],p1[1]-p0[1])/.1));
        for(let j=0;j<=n&&clear;j++){const q=[p0[0]+(p1[0]-p0[0])*j/n,p0[1]+(p1[1]-p0[1])*j/n];if(hypot(q[0]-from[0],q[1]-from[1])<.5)continue;clear=!near.some(([px,pz])=>hypot(px-q[0],pz-q[1])<keep);}}
      if(clear)return {x:c.x,z:c.z,level:0};
    }
    return null;
  }
  private movementVerb(actor:string,x:number,z:number){const a=this.ents[actor];if(this.rt.world.groundV1&&(inDeepWater(this.rt,actor)||destinationInDeepWater(this.rt,x,z)))return 'ground_travel';return this.physical&&(inShoreDomain(this.rt.world,x,z)||!!a&&inShoreDomain(this.rt.world,a.pose.p[0],a.pose.p[2]))?'commons_shore_travel':'walk_to';}
  private free(id: string): boolean { return !!this.ents[id] && this.holders(id).length === 0 && !this.byActor.has(id) && ![...this.programs.values()].some(p=>p.build?.crew.includes(id)); }

  /** A raw Mars verb, with the actor filled in where the verb takes one (`actor`, or `actors` when none are given). */
  private raw(me: string, step: { verb: string; params: Record<string, unknown> }): { verb: string; params: Record<string, unknown> } | Diag {
    const verb = step.verb.slice(5), def = this.registry.get(verb), { free: _free, freeWithin: _within, ...rest } = step.params ?? {}, a = verb === 'walk_to' ? rest : step.params ?? {};
    if (!def) return { code: 'action.unknown-verb', message: `no action verb "${verb}"` };
    if(verb==='carrier_ride'){const issue=this.puntBoardingIssue(String(a.carrier??''));if(issue)return issue;}
    const helm=['boat_take_helm','boat_release_helm'].includes(verb);
    // The fresh owned helm binding must also prevent a passenger from naming
    // another body as pilot of an ordinary travel/board/leave program.
    if(((this.physical?.boatControls||this.physical?.bodyLocation)&&verb.startsWith('boat_'))||helm){
      if(a.actor!==undefined&&a.actor!==me)return {code:helm?'boat.helm-self-only':'boat.self-only',message:'A boat activity may act only for the program\u0027s own passenger.'};
    }
    if(helm){
      if(this.leaving.includes(me))return {code:'boat.helm-retiring',message:'A retiring passenger cannot acquire or release control through a new program.'};
    }
    const shape = (this.m.describeVerbs(new Map([[verb, def]]))[0].inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    return { verb, params: { ...a, ...('actor' in shape && !('actor' in a) ? { actor: me } : {}), ...('actors' in shape && !('actors' in a) ? { actors: [me] } : {}) } };
  }
  /** VERBS (accept2 brief 10): read-only, for offers: why a new boarding of this carrier would be refused today, or null.
   *  Lets the ride offer say so up front instead of offering a punt the world then blocks (punt.unsupported-water). */
  carrierBoardingIssueV1(id:string):Diag|null{return this.puntBoardingIssue(id);}
  /** A logged punt stays installed across author edits, but every new boarding must qualify against today's water. */
  private puntBoardingIssue(id:string):Diag|null{
    const e=this.ents[id],c=e?.carrier;if(e?.def!=='rowing-punt'||!c)return null;
    return previewPunt(this.rt,{id:e.id,def:e.def,label:e.label,at:[c.home[0],c.home[2]],y:c.home[1],yaw:c.yaw,route:c.route.id,routeKeys:c.route.keys,bank:c.bank},this.renderScene());
  }

  /** Read-only seat support levels, using the same native slot calculation as sit.
   * No route/admission, runtime mutation or historical policy change. */
  nativeSeatLevelsV1(fixture:string):number[]{
    const entity=this.ents[fixture];if(!entity)return [];
    return [...new Set(fixtureSlots(this.rt,entity).filter(slot=>slot.kind==='seat').map(slot=>slot.level))].sort((a,b)=>a-b);
  }
  private seatedAt(actor:string,fixture:string){const body=this.ents[actor],entity=this.ents[fixture];if(!body?.human||body.human.activity!=='sit'||!entity)return false;return fixtureSlots(this.rt,entity).some(slot=>{const r=slot.claimedBy?this.rt.records.get(slot.claimedBy):undefined;return slot.kind==='seat'&&slot.level===body.human.level&&r?.params.actor===actor&&r.phase==='occupied'&&this.rt.isActive(r.id)&&Math.hypot(slot.p[0]-body.pose.p[0],slot.p[1]-body.pose.p[2])<=.001&&Math.abs(angleDelta(slot.yaw,body.pose.yaw))<=.03;});}

  /** One body-language step → the Mars actions and waits that depict it, decided when the step begins. */
  private lower(p: Prog, step: { verb: string; params: Record<string, unknown> }): Op[] | Diag {
    const me = p.actor;
    if (step.verb === 'mars:walk_to' && step.params?.free === FREE_GOAL_V1) {
      const lv = step.params.level === undefined ? this.ents[me]?.human?.level ?? 0 : Number(step.params.level);
      const g = this.freeGoalV1(me, { x: Number(step.params.x), z: Number(step.params.z), level: lv }, step.params.freeWithin);
      if (!g) return [];
      step = { verb: step.verb, params: { ...step.params, x: g.x, z: g.z } };
    }
    const a = step.params ?? {};
    if (step.verb === 'mars:take_item') { const it=this.ents[String(a.item)]; if (it?.support?.kind === 'in-hand' && it.support.by === me && (!a.hand || it.support.hand === a.hand)) return []; }
    if (step.verb.startsWith('mars:')) { const r = this.raw(me, step); return 'code' in r ? r : [{ ...r, settle: 'held', raw: true }]; }
    switch (step.verb) {
      case 'activity_readiness_v1': {
        const issue=this.readinessIssue(me,a);if(issue)return issue;
        return [{wait:secs(a.seconds,120)}];
      }
      case 'control_classroom_v1': return [{verb:'classroom_control',params:{session:a.session,intent:{kind:a.kind}},settle:'done',raw:true}];
      case 'walk_to': {
        const gaitIssue = this.gaitIssue(me, a); if (gaitIssue) return gaitIssue;
        let g = (a.spread === 'pond/1' || a.spread === 'region/1' || a.spread === 'pond-lap/1') && typeof a.to === 'string' && this.rt.world.regions[a.to] ? this.spreadGoalV1(me, a.to, a.spread,this.sharedWaterStep(step),a.regionOutside) : this.goalNear(me, a.doorQueueV1 ? this.doorQueueGoalV1(p, a) : a.to, typeof a.standoff === 'number' ? a.standoff : 0, a.stand);
        if (g === 'here') return [];
        if ('code' in g) return g;
        if (a.free === FREE_GOAL_V1) { const f = this.freeGoalV1(me, g, a.freeWithin); if (!f) return []; g = f; }
        const movement = this.movementVerb(me,g.x,g.z);
        if (a.gait && a.gait !== 'walk' && movement !== 'walk_to') return {code:'gait.dry-ground-required',message:'This shore or water route does not support jogging or running; return to dry ground first.'};
        // LINK BODY: a zombie's shuffle (pace 'shuffle'): half the body's walking speed, dry ground at both ends only
        const shuffle = a.pace === 'shuffle', together = a.pace === 'together';
        if (shuffle && (movement !== 'walk_to' || a.gait || !this.dryGroundAtV1(g.x, g.z))) return {code:'shuffle.dry-ground-required',message:'A shuffle stays on dry ground.'};
        const ops: Op[] = [{ verb: movement, params: { actor: me, x: g.x, z: g.z, level:g.level, ...(a.gait && a.gait !== 'walk' ? {gait:a.gait} : {}), ...(shuffle ? {speed: r3(0.5 * bodyProfile(this.ents[me]).speed)} : {}), ...(together ? {speed: HAND_IN_HAND_SPEED} : {}), ...(this.cfg.nativeArrivalWitnessV1&&movement==='walk_to'?{arrivalEvidence:'navigation-arrival/1'}:{}) }, settle: 'done', ...(a.spread === 'pond-lap/1' || shuffle ? { soft: true } : {}) }];
        if (typeof a.to === 'string' && this.ents[a.to] && !together) ops.push({ verb: 'face', params: { actor: me, target: { entity: a.to } }, settle: 'done', soft: true });
        return ops;
      }
      case 'rest': return typeof a.seatedAt==='string'&&!this.seatedAt(me,a.seatedAt)?{code:'rest.native-seat-required',message:'The requested seat is no longer held by this actor.'}:[{ wait: secs(a.seconds, 60) }];
      case 'perform': return [{ wait: secs(a.seconds, 30) }];
      case 'wave': return [...(typeof a.at === 'string' && this.ents[a.at] ? [{ verb: 'face', params: { actor: me, target: { entity: a.at } }, settle: 'done', soft: true } as Op] : []), { wait: secs(a.seconds, 2) }];
      case 'converse': {
        const other = String(a.with ?? ''), n = secs(a.seconds, 30);
        if (!this.ents[other]) return { code: 'target.unknown', message: `nobody to talk with: ${other}` };
        // A conversation circle borrows the other body only if it is free; otherwise this actor turns to them and talks from where it stands.
        if (this.free(other) && !this.plan('converse', { actors: [me, other], duration: n / TPS })) return [{ verb: 'converse', params: { actors: [me, other], duration: n / TPS }, settle: 'done', soft: true }];
        return [{ verb: 'face', params: { actor: me, target: { entity: other } }, settle: 'done', soft: true }, { wait: n }];
      }
      case 'gather': {
        // `at` may be a fixture, a Mars region, or a point (then the region with an audience layout around that point, if any).
        const n = secs(a.seconds, 120), pt = this.pointOf(a.at);
        const e = typeof a.at === 'string' ? this.ents[a.at] : undefined;
        const region = typeof a.at === 'string' && this.rt.world.regions[a.at] ? a.at : !e && pt ? Object.keys(this.rt.world.regions).sort().find((id) => inPoly(pt[0], pt[1], this.rt.world.regions[id].polygon)) : undefined;
        const tries: Op[] = e ? [...(e.def === 'campfire' || CATALOG[e.def]?.slots?.some((q) => q.kind === 'fire-circle') ? [{ verb: 'campfire_circle', params: { actors: [me], fire: e.id }, settle: 'held' } as Op] : []), { verb: 'gather', params: { actors: [me], fixture: e.id }, settle: 'held' }]
          : region ? [{ verb: 'gather', params: { actors: [me], region }, settle: 'held' }] : [];
        for (const op of tries) if ('verb' in op && !this.plan(op.verb, op.params)) return [op, { wait: n }];
        // No place to take (a full bench, a spot with no layout): stand near it instead.
        const g = this.goalNear(me, a.at, 2);
        if (g !== 'here' && 'code' in g) return g;
        return [...(g === 'here' ? [] : [{ verb: this.movementVerb(me,g.x,g.z), params: { actor: me, x: g.x, z: g.z, level:g.level, ...(this.cfg.nativeArrivalWitnessV1&&this.movementVerb(me,g.x,g.z)==='walk_to'?{arrivalEvidence:'navigation-arrival/1'}:{}) }, settle: 'done' } as Op]), { wait: n }];
      }
      case 'sit': return [{ verb: 'sit', params: { actor: me, fixture: String(a.on ?? '') }, settle: 'held' }, { wait: secs(a.seconds, 60) }];
      case 'stand': return typeof a.nativeSeatReleaseV1==='string'?[{verb:'stand',params:{actor:me},settle:'done'}]:this.holders(me).length ? [{ verb: 'stand', params: { actor: me }, settle: 'done', soft: true }] : [];
      case 'ambient_wander': {
        // Mars's own ambient_wander is not resumable from a snapshot, so strolling is built from walks and pauses, which are.
        const total = secs(a.seconds, 60), radius = Math.min(40, Math.max(2, typeof a.radius === 'number' ? a.radius : 12));
        const home = this.pos(me)!, ops: Op[] = []; let spent = 0;
        if (this.cfg.edgeMotionV1 === true) return this.strollV1(me, home, total, radius);
        for (let leg = 0; leg < 6 && spent < total; leg++) {
          for (let tries = 0; tries < 4; tries++) {
            const ang = this.m.nextRandom(this.rt.world.rng) * Math.PI * 2, dist = (0.3 + 0.7 * this.m.nextRandom(this.rt.world.rng)) * radius;
            const x = r3(home[0] + Math.cos(ang) * dist), z = r3(home[1] + Math.sin(ang) * dist);
            if (leg > 0 || !this.plan(this.movementVerb(me,x,z), { actor: me, x, z })) { ops.push({ verb: this.movementVerb(me,x,z), params: { actor: me, x, z, ...(this.movementVerb(me,x,z)==='walk_to'?{speed:0.9}:{}) }, settle: 'done', soft: true }); break; }
          }
          const pause = Math.round((2 + 6 * this.m.nextRandom(this.rt.world.rng)) * TPS); ops.push({ wait: pause });
          spent += pause + Math.round((radius / 0.9) * TPS * 0.6);
        }
        return ops;
      }
      default: return { code: 'action.unknown-verb', message: `no body verb "${step.verb}"` };
    }
  }

  // ------------------------------------------------------------------ programs
  /** G9 lane Z1b, a release's standby process only (apps/server/src/standby.ts rehearseRestore): build this restored
   *  engine's static navigation grids now and keep them for the boot after the go (grid.ts keepStaticGridsForBoot), which
   *  would otherwise build them in its first tick. The engine itself is then thrown away. Returns the grid sets kept.
   *  `store` (lane t4-mem): where they wait for the go, packed, out of this process's memory (standby.ts bootGridFile). */
  warmStaticGridsForBootV1(store?:BootGridStore):number {const sp=this.rt.services?.spatial;if(!sp?.sync)return 0;return keepStaticGridsForBoot(()=>{sp.sync(this.rt.world);void sp.grids;},store);}
  withFeasibilityRead<T>(read:()=>T):T {const previous=this.feasibilityRead;this.feasibilityRead=previous??new Map();try{return withStaticGridReadCache(read);}finally{this.feasibilityRead=previous;}}
  private physicalReplacementIssue(action:string):Diag|null {
    const record=this.rt.records.get(action),key=this.feasibilityRead?hashOf({action,tick:this.rt.tick,events:this.rt.events.length,native:this.rt.stateHash(),status:record?.status,phase:record?.phase,quiet:this.quiet,cfg:this.cfg}):undefined;
    if(key&&this.feasibilityRead!.has(key))return structuredClone(this.feasibilityRead!.get(key)!);
    let result:Diag|null=null;
    if(!this.canSnapshot())result={code:'program.safe-stop-required',message:'Stop the current non-resumable action safely before replacing it.'};
    else {const copy=this.physical!.restore(this.rt.snapshot());copy.cancel(action,{code:'program.replaced',message:'replaced'});if(copy.isActive(action))result={code:'program.safe-stop-required',message:'Stop the current movement and let it reach safe support before replacing it.'};}
    if(key)this.feasibilityRead!.set(key,structuredClone(result));return result;
  }
  ownedClassroomControlRosterV1(actor:string,session:string){const r=this.rt.records.get(session);if(!r||r.verb!=='classroom_session'||!this.rt.isActive(session)||r.params.host!==actor)return null;const current=readClassroom(this.rt,session);if(!current)return null;return [...new Set(current.participants.map(p=>p.actor))];}
  /** Optional native-cast custody reader. It shares the exact construction and raw-verb participant
   * binding used at admission; unknown steps refuse qualification rather than assume actor-only.
   * Does not know owners/tokens, mutate bodies, or change ordinary owner-directed engine semantics. */
  nativeProgramParticipantsV1(program:Program):readonly string[]|null {
    if(!this.ents[program.actor]?.human)return null;
    const ids=new Set<string>([program.actor]);
    const visit=(v:unknown):void=>{if(typeof v==='string'&&this.ents[v]?.kind==='human')ids.add(v);else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};
    for(const s of program.steps){
      if(s.verb==='build_lookout'||s.verb==='unbuild_lookout'){
        if(program.steps.length!==1||s.verb==='unbuild_lookout'&&!this.cfg.disassemblyV1)return null;
        const p=s.verb==='build_lookout'?this.buildPlan(program):this.unbuildPlan(program);if('code' in p)return null;p.crew.forEach(id=>ids.add(id));
      }else if(s.verb.startsWith('mars:')){const p=this.raw(program.actor,s);if('code' in p)return null;visit(p.params);}
      else if(s.verb==='converse'){visit(s.params.with);}
      else if(s.verb==='control_classroom_v1'){const roster=this.ownedClassroomControlRosterV1(program.actor,String(s.params.session));if(!roster)return null;roster.forEach(id=>ids.add(id));}
      else if(!['walk_to','sit','stand','wave','face','gather','rest','perform','ambient_wander','activity_readiness_v1'].includes(s.verb))return null;
    }
    return [...ids].sort();
  }
  /** VEHICLE-STEER: a seated rider's steer is a word to the ride, not a body movement: it never replaces the rider's own
   *  programme (a rower's punt loop stays its receipt) and completes at once. */
  private instantV1:{actor:string;id:string}|null=null;
  /** The programme id of an instant steer this actor was just given (it is already complete), for the edge receipt. */
  instantProgramV1(actor:string):string|null{return this.instantV1?.actor===actor?this.instantV1.id:null;}
  private steerOnlyV1(program: Program): boolean { return program.steps.length===1&&program.steps[0]?.verb==='mars:carrier_steer'&&!!this.ents[program.actor]&&!!this.carrierOf(program.actor); }
  canPerform(program: Program): Diag | null {
    if(this.steerOnlyV1(program))return this.plan('carrier_steer',{...program.steps[0].params,actor:program.actor});
    for(const step of program.steps)if(step.verb==='mars:carrier_ride'){const issue=this.puntBoardingIssue(String(step.params.carrier??''));if(issue)return issue;}
    for(const step of program.steps)if(step.params?.spreadWaitPolicy!==undefined&&!this.sharedWaterStep(step))return {code:'action.invalid-spread-wait-policy',message:'Only shared-water-wait/1 or /2 on a pond/1 or pond-lap/1 walk is supported.'};
    const bodyIssue=this.bodyProgramProblemV1(program); if(bodyIssue)return bodyIssue;
    for(const step of program.steps)if(step.verb==='walk_to'){const issue=this.gaitIssue(program.actor,step.params);if(issue)return issue;}
    if(program.steps[0]?.verb==='control_classroom_v1'){const p=program.steps[0].params;if(program.steps.length!==1||!['cancel','advance'].includes(String(p.kind))||typeof p.session!=='string'||!this.ownedClassroomControlRosterV1(program.actor,p.session))return {code:'classroom.owned-host-control-required',message:'Only the active classroom host can apply this control.'};return this.plan('classroom_control',{session:p.session,intent:{kind:p.kind}});}
    if ([...this.programs.values()].some(p=>p.readiedActors?.includes(program.actor)&&!p.action))return {code:'activity.readiness-committed',message:'This body has committed its explicit ready wait to a starting classroom.'};
    if (!this.ents[program.actor]) return { code: 'actor.unknown', message: `no such actor ${program.actor}` };
    if ([...this.programs.values()].some(p=>p.build?.crew.includes(program.actor))) return {code:'construction.committed',message:'This builder is finishing a finite physical construction segment.'};
    if(this.physical){
      const old=this.programs.get(this.byActor.get(program.actor)??'');
      if(old?.stopping)return {code:'program.safe-stop-pending',message:'The previous movement is still reaching a safe supported stop.'};
      if(old?.action&&this.rt.isActive(old.action)){
        const issue=this.physicalReplacementIssue(old.action);if(issue)return issue;
      }
    }
    const first = program.steps[0]; if (!first) return null;
    const aboard=this.carrierOf(program.actor);
    if(aboard&&aboard.phase==='aloft'&&!program.steps.every(s=>['rest','wave','perform','mars:carrier_depart','mars:carrier_steer'].includes(s.verb)))
      return {code:'carrier.aloft',message:`You are riding in ${aboard.label} above the ground; it lands by itself and you step out then.`};
    if(first.verb==='stand'&&first.params.nativeSeatReleaseV1!==undefined){
      if(this.ents[program.actor].body?.family==='floater'||typeof first.params.nativeSeatReleaseV1!=='string'||!this.nativeSeatHoldsV1(program.actor).some(s=>s.action===first.params.nativeSeatReleaseV1))return {code:'stand.seat-claim-changed',message:'The explicit stand no longer owns its original native seat claim.'};
      return this.plan('stand',{actor:program.actor});
    }
    for(const step of program.steps)if(step.verb==='activity_readiness_v1'){const issue=this.readinessIssue(program.actor,step.params,false);if(issue)return issue;}
    if(first.verb==='rest'&&typeof first.params.seatedAt==='string'&&!this.seatedAt(program.actor,first.params.seatedAt))return {code:'rest.native-seat-required',message:'The requested seat is no longer held by this actor.'};
    if (this.cfg.disassemblyV1 && (first.verb === 'build_lookout' || first.verb === 'unbuild_lookout') && [...this.programs.values()].some(p=>p.build)) return {code:'construction.site-busy',message:'Another crew is building or taking down the lookout; one finite job at a time.'};
    if (first.verb === 'unbuild_lookout' && this.cfg.disassemblyV1) {
      if (program.steps.length !== 1) return {code:'disassembly.one-job',message:'A disassembly card chooses one finite job.'};
      const plan=this.unbuildPlan(program);
      if ('code' in plan) return plan;
      const raw=this.raw(program.actor,plan.steps[0]);
      return 'code' in raw?raw:this.plan(raw.verb,raw.params);
    }
    if (first.verb === 'build_lookout') {
      if (program.steps.length !== 1) return {code:'construction.one-job',message:'A construction card chooses one finite job.'};
      const plan=this.buildPlan(program);
      if ('code' in plan) return plan;
      const raw=this.raw(program.actor,plan.steps[0]);
      return 'code' in raw?raw:this.plan(raw.verb,raw.params);
    }
    if (!program.steps.some(s=>s.verb==='mars:serve')) for (const step of program.steps) if (step.verb==='mars:eat' && !(this.ents[String(step.params.bowl)]?.contents?.fraction > 0)) return {code:'eat.bowl-empty',message:'There is no food left in the bowl'};
    if(this.commonsKitchenActive){
      const services=program.steps.filter(s=>['mars:prepare_food','mars:serve'].includes(s.verb));
      const pots=services.map(s=>s.params.pot);
      if(pots.length&&[...this.programs.values()].some(p=>p.actor!==program.actor&&p.steps.some(s=>['mars:prepare_food','mars:serve'].includes(s.verb)&&pots.includes(s.params.pot))))return {code:'food.service-in-use',message:'Someone is already preparing or serving at this finite pot'};
      if(services.some(s=>s.verb==='mars:serve'&&(this.ents[String(s.params.bowl)]?.contents?.fraction??0)>0))return {code:'serve.bowl-not-empty',message:'Eat the food already in your bowl before serving more'};
    }
    const pots = program.steps.filter(s => ['mars:serve','mars:shared_food_break'].includes(s.verb)).map(s => s.params.pot);
    if (this.cfg.scene === 'eden-camp' && pots.length && [...this.programs.values()].some(p => p.actor !== program.actor && p.steps.some(s => ['mars:serve','mars:shared_food_break'].includes(s.verb) && pots.includes(s.params.pot)))) return {code:'food.service-in-use',message:'Someone is already using this pot and its serving space'};
    for (const step of program.steps) if (step.verb.startsWith('mars:')) {
      // entry 35: a hand hold names the other body only to find its hand; it never borrows it (consent is the ledger's);
      // entry 41: a hand-over likewise (each body runs its own half)
      const busy = step.verb === 'mars:hand_hold_v1' || step.verb === 'mars:hand_over_v1' ? null : this.jointIssue(step.params, program.actor,step.verb==='mars:classroom_session'); if (busy) return busy;
      if (step.verb === 'mars:serve') {
        const pot = this.ents[String(step.params.pot)];
        if (!pot?.contents || pot.contents.fraction < 0.25 || pot.foodPreparation?.complete === false) return {code: 'food.unavailable', message: 'there is no completed serving left in the pot'};
      }
    }
    if(!this.commonsKitchenActive&&program.steps.some(s=>s.verb==='mars:prepare_food'&&s.params.groundRoutePolicy==='supported-ground/1'))return {code:'commons-kitchen.reader-required',message:'The supported ground preparation policy is not installed'};
    if(this.socialEdenActive){const seats=program.steps.filter(s=>s.verb==='sit'&&String(s.params.on).startsWith('social-eden-'));for(const seat of seats){const issue=this.plan('sit',{actor:program.actor,fixture:String(seat.params.on)});if(issue)return issue;}}
    if (first.verb === 'mars:take_item') { const it=this.ents[String(first.params.item)]; if (it?.support?.kind==='in-hand' && it.support.by===program.actor && (!first.params.hand || it.support.hand===first.params.hand)) return null; }
    if (first.verb.startsWith('mars:')) { const r = this.raw(program.actor, first); return 'code' in r ? r : this.plan(r.verb, r.params); }
    if (!BODY.has(first.verb)) return { code: 'action.unknown-verb', message: `no body verb "${first.verb}"` };
    if (first.verb === 'walk_to') {
      const g = (first.params.spread === 'pond/1' || first.params.spread === 'region/1' || first.params.spread === 'pond-lap/1') && typeof first.params.to === 'string' && this.rt.world.regions[first.params.to] ? this.spreadGoalV1(program.actor, first.params.to, first.params.spread,this.sharedWaterStep(first),first.params.regionOutside) : this.goalNear(program.actor, first.params.to, typeof first.params.standoff === 'number' ? first.params.standoff : 0, first.params.stand);
      if(g==='here')return null;if('code' in g)return g;
      if(first.params.gait&&first.params.gait!=='walk'){
        if(this.movementVerb(program.actor,g.x,g.z)!=='walk_to')return {code:'gait.dry-ground-required',message:'This shore or water route does not support jogging or running; return to dry ground first.'};
        return this.plan('walk_to',{actor:program.actor,x:g.x,z:g.z,level:g.level,gait:first.params.gait});
      }
      return null;
    }
    if (first.verb === 'sit') {
      const fixture = String(first.params.on ?? '');
      if (this.cfg.scene === 'eden-camp' && this.ents[fixture]?.def === 'bench-6ft') {
        for (const r of this.rt.records.values()) if (this.rt.isActive(r.id) && r.params?.actor !== program.actor && (r.params?.fixture === fixture || String(r.params?.slot ?? '').startsWith(fixture+'#'))) return {code:'seat.approach-busy',message:'Someone is using the bench and its narrow entry; wait until they leave.'};
      }
      return this.plan('sit', { actor: program.actor, fixture });
    }
    return null;
  }
  private prepareAdmission(program: Program) {
    const no = this.canPerform(program);
    const id = `p${this.nextProg}`;
    if (no) return {result:{id,ok:false,diagnostic:no},build:null};
    const reverse=program.steps[0]?.verb==='unbuild_lookout'&&this.cfg.disassemblyV1===true;
    const build=program.steps[0]?.verb==='build_lookout'?this.buildPlan(program):reverse?this.unbuildPlan(program):null;
    if (build && 'code' in build) return {result:{id,ok:false,diagnostic:build},build:null,reverse};
    return {result:{id,ok:true},build,reverse};
  }
  previewAdmission(program:Program) { return structuredClone(this.prepareAdmission(program).result); }
  perform(program: Program) {
    if(this.steerOnlyV1(program)){
      const id=`p${this.nextProg}`,params={...program.steps[0].params,actor:program.actor},no=this.plan('carrier_steer',params);this.nextProg++;
      if(no)return {id,ok:false as const,diagnostic:no};
      const def=this.registry.get('carrier_steer'),parsed=def.schema.parse(params),r=def.plan(this.rt,parsed);def.start(this.rt,parsed,r.program,id);
      const p={id,actor:program.actor} as Prog;this.emit(p,'step');this.emit(p,'completed');this.instantV1={actor:program.actor,id};return {id,ok:true as const};
    }
    const {result,build,reverse}=this.prepareAdmission(program),id=result.id;
    this.nextProg++;
    if (!result.ok) {
      const old = this.byActor.get(program.actor);
      const explicitSeatRelease=program.steps[0]?.verb==='stand'&&program.steps[0].params.nativeSeatReleaseV1!==undefined;
      if(old&&!this.physical&&!explicitSeatRelease&&result.diagnostic?.code!=='body.unsupported')this.stop(old);
      return result;
    }
    if(program.steps[0]?.verb==='control_classroom_v1'){const p:Prog={id,actor:program.actor,label:program.label.slice(0,200),steps:structuredClone(program.steps),index:0,started:false,since:this.rt.tick,ops:[],controlOf:String(program.steps[0].params.session)};this.programs.set(id,p);return result;}
    const commitment=program.steps[0]?.verb==='mars:classroom_session'&&program.steps[0].params.handoverScope==='owned-readiness/1'?[...new Set([program.steps[0].params.host,...(program.steps[0].params.presenters as string[]??[]),...(program.steps[0].params.audience as string[]??[])].filter((id):id is string=>typeof id==='string'&&id!==program.actor))]:[];
    const handover=program.steps[0]?.verb==='mars:classroom_session'&&program.steps[0].params.handoverScope==='owned-readiness/1'?this.classroomReadyActors(program.steps[0].params,program.actor):[];
    for(const actor of handover){const ready=this.programs.get(this.byActor.get(actor)!);if(ready)this.end(ready,'completed',{code:'activity.readiness-handover',message:'The explicitly offered wait joined its matching owned classroom.'});}
    const old = this.byActor.get(program.actor);
    if (old) { const o = this.programs.get(old)!,seatRelease=program.steps[0]?.verb==='stand'&&program.steps[0].params.nativeSeatReleaseV1===o.action&&this.nativeSeatHoldsV1(program.actor).some(s=>s.action===o.action);
      // The versioned strict stand will cancel this exact actor-owned seat and
      // follow its deferred exit. Cancelling it here first would invalidate stand admission.
      if(o.action&&this.rt.isActive(o.action)&&!seatRelease)this.rt.cancel(o.action,{code:'program.replaced',message:'replaced'});
      this.end(o,'cancelled',{code:'program.replaced',message:'replaced by a new program'});
    }
    const p: Prog = { ...(commitment.length?{readiedActors:commitment}:{}), id, actor: program.actor, label: program.label.slice(0, 200), steps: build?build.steps:program.steps, index: 0, started: false, since: this.rt.tick, ops: [], ...(build?{build:{phase:program.steps[0].params.phase as BuildPhase,crew:build.crew,...(reverse?{reverse:true as const}:{})}}:{}) };
    this.programs.set(id, p); this.byActor.set(p.actor, id);
    return result;
  }
  stop(programId: string, opts?: { untilSafe?: boolean }) {
    const p = this.programs.get(programId); if (!p) return;
    if (p.build) { p.build.stopping={code:'program.stopped',message:'Construction interruption requested; finishing the committed segment safely.'}; return; }
    if (p.action && this.rt.isActive(p.action)) {
      this.rt.cancel(p.action, { code: 'program.stopped', message: 'stopped' });
      // PC08 (#687): a shared carry's stop keeps its programme (and so the crew's borrowed bodies) until the native
      // cleanup lands, as a physical runtime does: `advance` retries a refused cancel each tick
      if((this.physical||opts?.untilSafe===true)&&this.rt.isActive(p.action)){p.stopping={code:'program.stopped',message:'Stopped after native movement reaches safe support.'};if(opts?.untilSafe===true)p.stopUntilSafe=true;return;}
    }
    this.end(p, 'cancelled', { code: 'program.stopped', message: 'stopped' });
  }
  programOf(actor: string) { return this.byActor.get(actor) ?? null; }
  /** LINK BODY (2026-10-24): dry standing ground at (x, z): not the shore's slope or water, not wading or swimming depth,
   *  not steep or outside the ground. Where a zombie may shuffle (edge/ledger/body-rule.ts). Read-only. */
  dryGroundAtV1(x:number,z:number):boolean{if(this.physical&&inShoreDomain(this.rt.world,x,z))return false;const f=(this.rt.services.spatial as Spatial|undefined)?.ground?.field;return !f||f.medium(x,z)===0;}
  /** stall-guard/1 (stall.ts): what holds this body, read-only; `pending` = a program still waiting for the body. */
  stallProbeV1(actor:string){const p=probeBody(this.rt,actor);if(!p)return null;const id=this.byActor.get(actor),pp=id?this.programs.get(id):undefined;
    // stall-release-support/1: a body the release could not stand anywhere supported is not offered to the guard
    // (upper levels only, and only a hold the guard would release: walking bodies are probed every second)
    const exempt=p.exempt??(this.cfg.stallReleaseSupportV1===true&&p.held&&p.candidate&&(this.ents[actor]?.human?.level??0)!==0&&!this.stallSetDownV1(actor)?'release.unsupported':null);
    return {...p,exempt,pending:!!pp&&!pp.started};}
  /** stall-guard/1: the world releases a stalled body (folded from 'edge-stop' {stallReleaseV1}) and stands it at the nearest
   *  free standing spot to its seat exit or where it is. A program whose own step held the body ends with `reason`; one still
   *  waiting for the body starts on the next tick. Null when bodiless, not held, or exempt (aloft, construction). */
  stallReleaseV1(actor:string,reason:{code:string;message:string}){
    const p=probeBody(this.rt,actor),a:any=this.ents[actor];if(!p||!a||p.exempt||!p.held)return null;
    if(this.cfg.stallReleaseSupportV1===true&&(a.human?.level??0)!==0){
      // stall-release-support/1 (#447): never stand a released body off its level's floor (a body stuck mid-flight was
      // set down where it was and the next tick's invariant faulted: collision.human-static, unrecoverable). Nowhere
      // supported: nothing is released and the body stays in its native hold.
      const to=this.stallSetDownV1(actor);if(!to)return null;
      const id=this.byActor.get(actor),pp=id?this.programs.get(id):undefined,own=!!pp?.action&&p.holders.some(x=>x.id===pp!.action);
      const r=releaseBody(this.rt,actor,[r3(to.at[0]),r3(to.y),r3(to.at[1])],reason);
      if(r){a.human.level=to.level;r.at=[a.pose.p[0],a.pose.p[1],a.pose.p[2]];}
      if(r&&pp&&own)this.end(pp,'failed',reason);
      return r;
    }
    const from=setDownFrom(this.rt,actor),upper=(a.human?.level??0)!==0;
    const xz=upper?from.at:(this.freeStandingNearV1([r3(from.at[0]),r3(from.at[1])],a.body?.radius??HUMAN_RADIUS)??from.at);
    const f=this.rt.world.groundV1&&!upper?(this.rt.services.spatial as Spatial).ground:undefined;
    const y=f?standOn(f,xz[0],xz[1]):(from.y??a.pose.p[1]);
    const id=this.byActor.get(actor),pp=id?this.programs.get(id):undefined,own=!!pp?.action&&p.holders.some(x=>x.id===pp!.action);
    const r=releaseBody(this.rt,actor,[r3(xz[0]),r3(y),r3(xz[1])],reason);
    if(r&&pp&&own)this.end(pp,'failed',reason);
    return r;
  }
  /** stall-release-support/1 (stall.ts supportedSetDownV1): where a stall release stands a body on an upper level (the
   *  ground keeps the nearest free standing spot), or null when nowhere is supported. Read-only and deterministic. */
  private stallSetDownV1(actor:string):{at:[number,number];y:number;level:number}|null{
    const a:any=this.ents[actor];if(!a?.human)return null;
    const spatial=this.rt.services.spatial as Spatial,field=this.rt.world.groundV1?spatial.ground:undefined;
    return supportedSetDownV1(this.rt,actor,setDownFrom(this.rt,actor),a.body?.radius??HUMAN_RADIUS,(lv,p,y)=>lv===0&&field?standOn(field,p[0],p[1]):y);
  }
  nativeSeatHoldsV1(actor:string):{action:string;slot:string}[]{
    const out:{action:string;slot:string}[]=[];
    for(const action of this.rt.holder('actor:'+actor)){
      const r=this.rt.records.get(action),l=this.rt.live.get(action),slot=l?.exec?.slot;
      if(!r||!l||!['sit','take_slot'].includes(r.verb)||r.params.actor!==actor||slot?.kind!=='seat'||typeof slot.id!=='string')continue;
      if(this.rt.holder('slot:'+slot.id).includes(action))out.push({action,slot:slot.id});
    }return out;
  }
  /** Seat exit is only complete on current native support; no relocation or geometry exemption. */
  standingSupportProblemV1(actor:string,originalSeats:{action:string;slot:string}[]=[]):Diag|null{
    const e=this.ents[actor],h=e?.human;
    const no=(message:string):Diag=>({code:'stand.unsupported',message});
    if(!h||!e.pose.p.every(Number.isFinite)||!Number.isFinite(e.pose.yaw))return no('The original body has no finite standing pose.');
    if(originalSeats.some(s=>this.rt.isActive(s.action)||this.rt.holder('slot:'+s.slot).includes(s.action)))return no('The original native seat action or slot claim remains active.');
    if(this.holders(actor).length||h.baseActivity==='sit'||!['idle','wait'].includes(h.activity)||h.on||h.grip||h.riding||h.carrier||h.boatPassenger||h.boatTransit||h.sleepPose||h.shore)return no('The body has not finished releasing its native support.');
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const p:[number,number]=[e.pose.p[0],e.pose.p[2]],g=spatial.levelAt(h.level,p),profile=bodyProfile(e);
    if(!g||clearanceAt(g,p)<profile.radius)return no('The body has no admitted clear standing surface.');
    const y=g.level===0&&spatial.ground?spatial.ground.standY(p[0],p[1]):g.y;
    if(!Number.isFinite(y)||Math.abs(e.pose.p[1]-y)>.03)return no('The body is not at its native standing support height.');
    // Grid support uses the planner's floor/void boundary. Check actual body height as well.
    for(const o of spatial.scene.obstacles){if(o.y1<=e.pose.p[1]+1e-9||o.y0>=e.pose.p[1]+profile.height-1e-9)continue;
      const dx=p[0]-o.obb.c[0],dz=p[1]-o.obb.c[1],cs=dcos(o.obb.yaw),sn=dsin(o.obb.yaw),x=Math.max(Math.abs(dx*cs+dz*sn)-o.obb.half[0],0),z=Math.max(Math.abs(-dx*sn+dz*cs)-o.obb.half[1],0);
      if(x*x+z*z<profile.radius*profile.radius-1e-9)return no('Standing would intersect native solid geometry.');
    }
    if(listEntities(this.ents).some(o=>o.id!==actor&&o.human&&o.human.level===h.level&&o.pose.p[1]<e.pose.p[1]+profile.height&&e.pose.p[1]<o.pose.p[1]+bodyProfile(o).height&&hypot(o.pose.p[0]-p[0],o.pose.p[2]-p[1])<profile.radius+bodyProfile(o).radius))return no('Standing would overlap another body.');
    return null;
  }
  programAction(programId:string) {
    const p=this.programs.get(programId),r=p?.action?this.rt.records.get(p.action):undefined;
    if(!p || !r)return null;
    return {tick:this.rt.tick,programId:p.id,actor:p.actor,step:p.index,
      action:{id:r.id as string,verb:r.verb as string,status:r.status as ActionRecord['status'],...(r.phase?{phase:r.phase as string}:{})}};
  }
  /** Seconds of the rest step a program is on (0 when it is not resting). */
  private restSecondsOf(actor:string):number { const id=this.byActor.get(actor),p=id?this.programs.get(id):undefined,s=p?.steps[p.index]; return s?.verb==='rest'?Number(s.params?.seconds??0):0; }
  /** Effective deep-water target, excluding a walking deck above the base water. */
  deepWaterTargetV1(x:number,z:number):boolean {return destinationInDeepWater(this.rt,x,z);}
  /** D1 body state: metres of water over the ground at the body's root (the recipe's base water; 0 aboard a carrier, on a
   *  deck over the water, upstairs, or on a world without ground/1). Read-only. */
  bodyWaterDepthV1(actor:string):number {
    const e=this.ents[actor],h=e?.human;if(!h||(h.level??0)!==0||h.carrier||h.riding||!this.rt.world.groundV1)return 0;
    const g=(this.rt.services.spatial as Spatial|undefined)?.ground;if(!g)return 0;
    const x=e.pose.p[0],z=e.pose.p[2],lvl=g.base.waterLevel(x,z);if(lvl===null)return 0;
    if(g.field!==g.base&&e.pose.p[1]>=g.field.height(x,z)-0.5&&g.field.height(x,z)>=lvl)return 0;
    return Math.max(0,lvl-g.base.height(x,z));
  }
  bodyResting(actor:string) { const id=this.byActor.get(actor),p=id?this.programs.get(id):undefined; return !!p && p.until!==undefined && p.steps[p.index]?.verb==='rest' && !this.ents[actor]?.human?.task; }
  observeLocalClassroomV1(observer:string){return readLocalClassroomV1(this.rt,observer,this.rulesVersion);}
  gatheringObservation() { return readNativeGathering(this.rt,this.rulesVersion,this.dt); }
  submit(verb: string, params: unknown, opts?: { id?: string; parent?: string; preempt?: boolean }): ActionRecord { return this.rt.submit(verb, params, opts) as ActionRecord; }
  cancel(id: string, reason?: Diag): ActionRecord { return this.rt.cancel(id, reason) as ActionRecord; }

  // ------------------------------------------------------------------ bodies
  private gaitIssue(actor:string,params:Record<string,unknown>):Diag|null {
    if(params.gait===undefined||params.gait==='walk')return null;
    if(params.gait!=='jog'&&params.gait!=='run'&&params.gait!=='cycle')return {code:'gait.invalid',message:'Choose walk, jog, run or cycle.'};
    return this.ents[actor]?.body?.family==='floater'?{code:'gait.unsupported-body',message:'Jogging and running require a humanoid body; this body can glide instead.'}:null;
  }
  /** BODY-v1 owner assignments never run limb/ride/building programs. Legacy native
   * descriptors keep the original named floater policy when replaying accepted history. */
  bodyProgramProblemV1(program:Program):Diag|null {
    const body=this.ents[program.actor]?.body;
    if(body?.family!=='floater'||body.type===undefined&&body.modelUrl===undefined)return null;
    // creatures (bodies/creatures.ts) whose species swims may also swim and come ashore
    const swims=!!creatureOf(body)?.swimSpeed;
    for(const s of program.steps){if(bodyDanceStep(body,s.verb,s.params))continue;const verb=s.verb.replace(/^mars:/,'');if(!['walk_to','ambient_wander','face','wave','rest','gather','stand','converse'].includes(verb)&&!(swims&&['swim_to','ground_travel','swim_in'].includes(verb)))return {code:'body.unsupported',message:creatureOf(body)?(['swim_to','ground_travel','swim_in'].includes(verb)&&creatureOf(body)!.cannot.swim||`A ${creatureOf(body)!.id} cannot do that; it can ${creatureOf(body)!.moves}, settle, turn and follow.`):'Rigid ceramic/floater bodies cannot do that limb activity; try glide, hover, settle or turn.'};}
    return null;
  }
  /** BODY-v1: never interrupt holders, commitments or unsafe postures to swap a body. */
  // World body-type policy is live admission only: it is outside cfg (hashed) and never re-judges logged assignments.
  private bodyTypesV1?:string[];
  configureBodyTypesV1(types:readonly string[]){this.bodyTypesV1=[...types];}
  bodyAssignmentProblemV1(id:string,body:Body|null):string|null {
    if(this.bodyTypesV1&&!this.bodyTypesV1.includes(body?.type??body?.family??'humanoid'))return 'body.world-policy';
    return this.bodySwapProblemV1(id,body);
  }
  private bodySwapProblemV1(id:string,body:Body|null):string|null {
    const problem=bodyProblem(body??undefined);if(problem)return problem;
    const e=this.ents[id],h=e?.human;if(!h)return 'body.not-found';
    if(!this.free(id)||this.actorBorrowed(id)||h.task||h.grip||h.on||h.riding||h.carrier||h.boatPassenger||h.boatTransit||h.sleepPose||h.shore||h.together||h.partner||h.holding||h.prop||h.baseActivity==='sit'||!['idle','wait'].includes(h.activity))return 'body.safe-standing-required';
    if(listEntities(this.ents).some((o:any)=>o.support?.kind==='in-hand'&&o.support.by===id))return 'body.safe-standing-required';
    const radius=body?.family==='floater'?(body.radius??.35):humanRadius({body:body??undefined});
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const grid=spatial.levelAt(h.level,[e.pose.p[0],e.pose.p[2]]);
    if(!grid||clearanceAt(grid,[e.pose.p[0],e.pose.p[2]])<radius)return 'body.no-clearance';
    if(listEntities(this.ents).some((o:any)=>o.id!==id&&o.kind==='human'&&o.human?.level===h.level&&hypot(o.pose.p[0]-e.pose.p[0],o.pose.p[2]-e.pose.p[2])<radius+humanRadius(o)))return 'body.no-clearance';
    return null;
  }
  assignBodyV1(id:string,body:Body|null):boolean {
    if(this.bodySwapProblemV1(id,body))return false;
    delete this.ents[id].human.bodyMotionV1;
    if(body)this.ents[id].body=structuredClone(body);else delete this.ents[id].body;
    this.out.changes.push([this.rt.tick,id,'body',body]);return true;
  }
  /** The native seat controller's standing approach, before its animation is compressed by a god edit. */
  private godWalkoutStartV1(id:string):{level:number;p:[number,number]}|null {
    const e=this.ents[id];if(!e?.human)return null;
    return this.seatStand(id)??{level:e.human.level??0,p:[e.pose.p[0],e.pose.p[2]]};
  }
  /** Where a body held by a seat (sitting down, seated or rising) stands when it gets up: the seat's standing approach. */
  private seatStand(id:string):{level:number;p:[number,number]}|null {
    const live=this.rt.internals().live as Map<string,any>;
    for(const action of this.holders(id)){
      const seat=live.get(action);
      if(seat&&['sit','take_slot'].includes(seat.rec.verb)&&seat.exec.slot.kind==='seat'&&['sit-down','occupied','stand-up'].includes(seat.exec.phase)){
        const approach=seat.exec.approach??seatApproach(this.rt,seat.exec.slot);
        if(Array.isArray(approach))return {level:seat.exec.slot.level,p:[...approach] as [number,number]};
      }
    }
    return null;
  }
  /** The landing check a god walk-out folds with (pure): standing room for this body at `to` on `level`, walkable
   * ground there on level 0 (not deep water, steep or outside), and no other body in the way. The planner uses the same
   * check, so a planned exit is one the fold accepts. */
  godWalkoutLandableV1(id:string,to:[number,number],level=0):boolean {
    const e=this.ents[id];
    if(!e?.human||!Array.isArray(to)||to.length!==2||!to.every(Number.isFinite)||!Number.isInteger(level)||level<0)return false;
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const grid=spatial.levelAt(level,to),profile=bodyProfile(e),field=level===0&&this.rt.world.groundV1?spatial.ground?.field:undefined;
    if(!grid||clearanceAt(grid,to)<profile.radius||field&&field.medium(to[0],to[1])>1)return false;
    return !listEntities(this.ents).some((other:any)=>other.id!==id&&other.human&&(other.human.level??0)===level&&hypot(other.pose.p[0]-to[0],other.pose.p[2]-to[1])<profile.radius+bodyProfile(other).radius);
  }
  /** Pure preflight for a synchronous god walk-out, using the ordinary body's native route planner.
   * A seat first returns to its normal standing approach. No clock, action or body is changed. A failing search is
   * proved early (identical results; path.ts proveUnreachable), so a walled-in exit costs little. */
  godWalkoutRouteV1(id:string,to:[number,number],level=0):boolean {
    const e=this.ents[id],start=this.godWalkoutStartV1(id);
    if(!e?.human||!start||!this.godWalkoutLandableV1(id,to,level))return false;
    const spatial=this.rt.services.spatial as Spatial;
    return spatial.route(this.rt.world,bodyProfile(e),start,{level,p:to},{proveUnreachable:true}).ok;
  }
  /** world-edit/1 read: where a walking body is heading (its live walk_to goal), or null. */
  walkGoalV1(id:string):{level:number;p:[number,number]}|null{
    const task=this.ents[id]?.human?.task,ex=task?(this.rt.services.walkExecs as Map<string,any>|undefined)?.get(task):undefined;
    return ex?.goal&&Array.isArray(ex.goal.p)?{level:ex.goal.level??0,p:[ex.goal.p[0],ex.goal.p[1]]}:null;
  }
  /** Logged god intervention only: ordinary cancellation releases the old activity, then its remaining
   * interpolation is compressed to the supported terminal state. A native walk is planned/reserved/started
   * and completed at its endpoint in this request; no engine/world ticks or unrelated actions are stepped.
   * All carried items are set down at `dropAt` (default: the body's original feet) before it leaves. Historical
   * edge-relocate stays unchanged; only its explicit godWalkout payload may use this stronger, synchronous intervention. */
  godWalkoutV1(id:string,to:[number,number],released:string[],how:'walked'|'relocated',dropAt?:[number,number,number],toLevel=0):boolean {
    const e=this.ents[id];
    if(!e?.human||!Array.isArray(to)||to.length!==2||!to.every(Number.isFinite)||!Array.isArray(released)||released.some(x=>typeof x!=='string')||!['walked','relocated'].includes(how))return false;
    if(dropAt!==undefined&&(!Array.isArray(dropAt)||dropAt.length!==3||!dropAt.every(Number.isFinite)))return false;
    if(!this.godWalkoutLandableV1(id,to,toLevel))return false;
    const spatial=this.rt.services.spatial as Spatial,field=this.rt.world.groundV1?spatial.ground?.field:undefined;
    if(how==='walked'&&!this.godWalkoutRouteV1(id,to,toLevel))return false;
    const start=this.godWalkoutStartV1(id)!,feet:[number,number,number]=[e.pose.p[0],e.pose.p[1],e.pose.p[2]],yaw=e.pose.yaw;
    const setDown:[number,number,number]=dropAt?[dropAt[0],dropAt[1],dropAt[2]]:feet;
    const reason={code:'god.walkout',message:'The god is rebuilding here; the activity ended and you stepped clear.',subjects:[id]};
    const drop=new Set<string>();
    for(const item of listEntities(this.ents) as any[]){const support=item.support;if(support?.kind==='in-hand'&&support.by===id||support?.kind==='held'&&support.by.includes(id))drop.add(item.id);}
    // A shared carry is let go of too: the other carrier's action on that load ends with this one (never half-cancelled).
    const internal=this.rt.internals(),affected=new Set<string>(),resources=new Set([`actor:${id}`,`holds:${id}`,`hand:${id}:left`,`hand:${id}:right`,...[...released,...drop].map(x=>`entity:${x}`)]);
    for(const [resource,owners] of internal.owners as Map<string,{action:string}[]>)if(resources.has(resource))for(const owner of owners)affected.add(owner.action);
    for(const p of this.programs.values())if(p.actor===id||p.build?.crew.includes(id)){if(p.action)affected.add(p.action);}
    // Include the full native action tree: its parent must not recreate a cancelled child next tick.
    let added=true;while(added){added=false;for(const record of this.rt.records.values())if(this.rt.isActive(record.id)){
      if(affected.has(record.id)&&record.parent&&!affected.has(record.parent)){affected.add(record.parent);added=true;}
      if(record.parent&&affected.has(record.parent)&&!affected.has(record.id)){affected.add(record.id);added=true;}
    }}
    for(const action of affected)if(this.rt.isActive(action))this.rt.cancel(action,reason);
    // A controlled stop may admit cleanup children (return an item, leave a seat). Include those as well.
    added=true;while(added){added=false;for(const record of this.rt.records.values())if(this.rt.isActive(record.id)&&record.parent&&affected.has(record.parent)&&!affected.has(record.id)){affected.add(record.id);added=true;}}
    // Runtime's existing checkpoint terminalizer releases reservations and ordinary task/traffic ownership.
    // Deferred seat/sleep/stair transitions cannot wait for a tick while their supporting geometry is removed.
    const depth=(action:string)=>{let n=0;for(let record=this.rt.records.get(action);record?.parent;record=this.rt.records.get(record.parent))n++;return n;};
    // Finish leaves first so generic parent cleanup cannot start another deferred child exit.
    for(const action of [...affected].sort((a,b)=>depth(b)-depth(a))){const live=internal.live.get(action);if(live)internal.forceFinish(live,'cancelled',reason);else if(internal.waiting.has(action))this.rt.cancel(action,reason);}
    for(const p of [...this.programs.values()])if(p.actor===id||p.build?.crew.includes(id)||p.action&&affected.has(p.action))this.end(p,'cancelled',reason);
    // An already seated passenger need not have a live boarding controller, so release the seat's back-reference.
    for(const thing of listEntities(this.ents) as any[]){
      if(thing.support?.kind==='ridden-by'&&thing.support.by===id){thing.support={kind:'ground'};if(thing.vehicle)thing.vehicle.speed=0;}
      for(const seats of [thing.carrier?.seats,thing.boat?.passengers])if(seats)for(const slot of Object.keys(seats))if(seats[slot]===id){if(thing.carrier?.seats===seats)seats[slot]=null;else delete seats[slot];}
    }
    for(const body of listEntities(this.ents) as any[])if(body.human&&(body.id===id||body.human.grip&&drop.has(body.human.grip.entity))){
      const h=body.human;for(const key of ['task','grip','hands','sleepPose','on','riding','carrier','boatPassenger','boatTransit','shore','baseActivity','phaseK','proneYaw','prop','seatHeight','holding','partner','together','instrument','game'])delete h[key];h.activity='idle';h.speed=0;
    }
    for(const key of ['walkExecs','carryExecs']){const store=this.rt.services[key];if(store instanceof Map)for(const action of affected)store.delete(action);}
    const sleeps=this.rt.services.sleeps;if(sleeps)for(const action of affected){delete sleeps.holds[action];delete sleeps.purposes[action];}
    if(this.rt.services.socialReturns)this.rt.services.socialReturns=this.rt.services.socialReturns.filter((ret:any)=>ret.actor!==id&&!affected.has(ret.source)&&!affected.has(ret.directive));
    // Finish the seat's ordinary rise before admitting a native route from that standing point.
    const land=()=>{
      for(const itemId of drop){const item=this.ents[itemId];placeOnGround(item,setDown,yaw);delete item.reservedBy;acknowledgeRelocation(this.rt,itemId);}
      e.pose.p=[r3(to[0]),toLevel===0&&field?r3(standOn(spatial.ground!,...to)):r3(spatial.base.levels.find(l=>l.id===toLevel)?.y??0),r3(to[1])];e.human.level=toLevel;
    };
    let walked=false;
    if(how==='walked'){
      const level=spatial.base.levels.find(l=>l.id===start.level),height=start.level===0&&field?standOn(spatial.ground!,...start.p):level?.y??feet[1];
      e.pose.p=[start.p[0],r3(height),start.p[1]];e.human.level=start.level;
      const walk=this.rt.submit('walk_to',{actor:id,x:to[0],z:to[1],level:toLevel},{preempt:false});
      const live=walk.status==='failed'?undefined:internal.live.get(walk.id);
      // Admit against the same pre-drop geometry as preflight: a released load must not bury its
      // former carrier's start before the already validated walk has been admitted.
      if(live){land();internal.forceFinish(live,'completed');this.rt.services.walkExecs?.delete(walk.id);walked=true;}
      else if(walk.status!=='failed'&&this.rt.isActive(walk.id))this.rt.cancel(walk.id,reason);
    }
    // No admitted walk (or no route at all): land at the same clear point, as a relocation.
    if(!walked)land();
    delete e.human.task;delete e.human.speed;e.human.activity='idle';acknowledgeRelocation(this.rt,id);
    this.rt.mark('god.walkout',{entityId:id,to:[...to],...(toLevel?{level:toLevel}:{}),how:walked?'walked':'relocated',released:[...drop].sort()});
    return true;
  }
  /** Mars has no way to add a person to a running world; the adapter does what its world editor does, then restores canonical order. */
  /** Edge reclaim (logged 'edge-relocate'): an idle, unheld body lands on its feet at the nearest free
   * standing spot near `to` (same ring search as arrival). Refuses busy/held/sleeping bodies. */
  relocateHumanV1(id: string, to: [number, number]): boolean {
    const e = this.ents[id];
    if (!e?.human || this.byActor.has(id) || this.holders(id).length || e.human.sleepPose || e.human.on || e.human.riding) return false;
    const people = listEntities(this.ents).filter((o: any) => o.kind === 'human' && o.id !== id).map((o: any) => [o.pose.p[0], o.pose.p[2]] as [number, number]);
    const spatial = this.rt.services.spatial as Spatial; spatial.sync(this.rt.world); const grid = spatial.levelAt(0, [to[0], to[1]]);
    for (let ring = 0; ring < 8; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const ang = (k / Math.max(1, ring * 6)) * Math.PI * 2 + ring * 0.5, x = r3(to[0] + dcos(ang) * ring * 0.9), z = r3(to[1] + dsin(ang) * ring * 0.9);
      if (people.some(([px, pz]) => hypot(px - x, pz - z) < 0.8)) continue;
      if (!grid || clearanceAt(grid, [x, z]) < HUMAN_RADIUS) continue;
      // Ground worlds land on their derived support (terrain or a ground-floor slab).
      // No ground fact: retain the authored worlds' historical level-zero landing.
      const y = this.rt.world.groundV1 && this.cfg.groundReclaimV1 === true ? spatial.ground!.standY(x, z) : 0;
      e.pose.p = [x, y, z]; e.human.level = 0; e.human.activity = 'idle'; e.human.speed = 0; delete e.human.shore; acknowledgeRelocation(this.rt, id); return true;
    }
    return false;
  }
  /** Fault recovery (logged inside the recovery recipe): a body whose programmes were rewound lands back at its last valid
   * pose (taken the tick before the fault) instead of wherever the rewind left it (e.g. its arrival point). Upstairs it keeps
   * its floor when the floor still has room there; otherwise the nearest free standing point on level 0 (dry or wadable
   * ground on a ground world, never deep water), rings of 0.5 m out to 40 m. Refuses busy/held/sleeping/seated-aboard bodies. */
  restoreHumanPoseV1(id: string, pose: { p: [number, number, number]; yaw?: number; level?: number }): boolean {
    const e = this.ents[id];
    if (!e?.human || this.byActor.has(id) || this.holders(id).length || e.human.sleepPose || e.human.on || e.human.riding || e.human.carrier) return false;
    if (!Array.isArray(pose?.p) || pose.p.length !== 3 || !pose.p.every(Number.isFinite)) return false;
    const spatial = this.rt.services.spatial as Spatial; spatial.sync(this.rt.world);
    const people = listEntities(this.ents).filter((o: any) => o.kind === 'human' && o.id !== id).map((o: any) => [o.pose.p[0], o.pose.p[2], o.human?.level ?? 0] as [number, number, number]);
    const free = (x: number, z: number, level: number) => !people.some(([px, pz, pl]) => pl === level && hypot(px - x, pz - z) < 0.8);
    const land = (p: [number, number, number], level: number) => {
      e.pose.p = p; if (typeof pose.yaw === 'number' && Number.isFinite(pose.yaw)) e.pose.yaw = r3(pose.yaw);
      e.human.level = level; e.human.activity = 'idle'; e.human.speed = 0; delete e.human.shore; acknowledgeRelocation(this.rt, id); return true;
    };
    const [x0, y0, z0] = pose.p, level = Number.isInteger(pose.level) ? pose.level! : 0;
    if (level > 0) {
      const g = spatial.levelAt(level, [x0, z0]); if (g && clearanceAt(g, [x0, z0]) >= HUMAN_RADIUS && free(x0, z0, level)) return land([r3(x0), r3(y0), r3(z0)], level);
      // MARSLIVED: a crowded upper floor (five Souls in a raised diner) keeps the body on its floor: the nearest free
      // spot on that level within 2 m, before the ground search below (which put it outside, under the floor)
      for (let ring = 1; ring <= 5; ring++) for (let k = 0; k < ring * 8; k++) {
        const ang = (k / (ring * 8)) * Math.PI * 2, x = r3(x0 + dcos(ang) * ring * 0.4), z = r3(z0 + dsin(ang) * ring * 0.4), gg = spatial.levelAt(level, [x, z]);
        if (gg && clearanceAt(gg, [x, z]) >= HUMAN_RADIUS && free(x, z, level)) return land([x, r3(y0), z], level);
      }
    }
    const grid = spatial.levelAt(0, [x0, z0]); if (!grid) return false;
    const f = this.rt.world.groundV1 ? spatial.ground?.field : undefined;
    const ok = (x: number, z: number) => clearanceAt(grid, [x, z]) >= HUMAN_RADIUS && free(x, z, 0) && (!f || f.medium(x, z) <= 1);
    for (let ring = 0; ring <= 80; ring++) { const n = Math.max(1, ring * 8); for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2, x = r3(x0 + dcos(ang) * ring * 0.5), z = r3(z0 + dsin(ang) * ring * 0.5);
      if (ok(x, z)) return land([x, f ? r3(standOn(spatial.ground!, x, z)) : 0, z], 0);
    } }
    return false;
  }
  /** attention/1 (logged 'edge-attention'): set or clear a body's gaze (head target: a body/fixture id or a point, until a tick),
   * and with `yaw` also turn a free standing body (no program, nothing holding it, awake, not seated/riding). Never cancels
   * or blocks anything the body is doing. Returns what turned. */
  attendHumanV1(id: string, gaze: { target?: string; at?: [number, number]; until?: number; kind?: string } | null, yaw?: number): 'body' | 'head' | 'none' {
    const e = this.ents[id]; if (!e?.human) return 'none';
    if (gaze === null) { delete e.human.gaze; delete e.human.attention; return 'none'; }
    const g: any = { kind: gaze.kind ?? 'look' }; if (typeof gaze.target === 'string' && this.ents[gaze.target]) g.target = gaze.target; else if (Array.isArray(gaze.at)) g.at = [r3(gaze.at[0]), r3(gaze.at[1])];
    if (Number.isInteger(gaze.until)) g.until = gaze.until;
    let turned: 'body' | 'head' = 'head';
    const free = !this.byActor.has(id) && !this.holders(id).length && !e.human.sleepPose && !e.human.on && !e.human.riding && !e.human.carrier && !e.human.together && (e.human.activity === 'idle' || e.human.activity === 'wait');
    if (typeof yaw === 'number' && Number.isFinite(yaw) && free) { e.pose.yaw = r3(yaw); turned = 'body'; }
    if (g.target || g.at) { e.human.gaze = g; this.gazeAt(e); } else delete e.human.gaze;
    return turned;
  }
  private gazeAt(e: any): boolean {
    const g = e.human.gaze; if (!g) return false;
    if (g.until !== undefined && this.rt.tick >= g.until) { delete e.human.gaze; return false; }
    const t = g.target ? this.ents[g.target] : null, at = t ? [t.pose.p[0], t.pose.p[2]] : g.at;
    if (!at) { delete e.human.gaze; return false; }
    e.human.attention = [at[0], at[1]]; return true;
  }
  /** attention/1 + intents: the planned walking route length (m) from a body to a point, without moving it (read-only planning). */
  routeEstimateV1(actor: string, to: [number, number], level?: number): { ok: true; metres: number } | { ok: false; code: string; message: string } {
    const def = this.registry.get('walk_to'), a = this.ents[actor];
    if (!def || !a?.human) return { ok: false, code: 'actor.unknown', message: 'no such body' };
    const parsed = def.schema.safeParse({ actor, x: to[0], z: to[1], ...(level !== undefined ? { level } : {}) });
    if (!parsed.success) return { ok: false, code: 'action.invalid-params', message: 'bad point' };
    const r = def.plan(this.rt, parsed.data);
    return r.ok ? { ok: true, metres: Math.round((r.program?.length ?? 0) * 10) / 10 } : { ok: false, code: r.diagnostic.code, message: r.diagnostic.message };
  }
  spawnHuman({ id, label, soul, near }: { id: string; label: string; soul: string; near?: BirthNearV1 }): string {
    if (this.ents[id]) return id;
    const [ax, az] = this.rt.world.groundV1 ? groundArrival(this.rt, this.cfg.arrival) : this.cfg.arrival;
    const body=this.cfg.scene==='littlemartians'&&['Verdelis','Kalama','Kweku','Mycos','Ada','Shuijing','Nyx'].includes(label)?{family:'floater',model:label.toLowerCase(),radius:.35,hoverHeight:1.45}:undefined;
    const people = listEntities(this.ents).filter((e: any) => e.kind === 'human').map((e: any) => [e.pose.p[0], e.pose.p[2]] as [number, number]);
    let spot: [number, number] | null = null;
    // birth-near/1 (verifier probes only; journaled, so replay is exact): an explicit start is searched first.
    if (near?.first) spot = this.freeStandingNearV1(near.at, body?.radius ?? HUMAN_RADIUS);
    if (!spot) search: for (let ring = 0; ring < 6; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const ang = (k / Math.max(1, ring * 6)) * Math.PI * 2 + ring * 0.5;
      // Original history retains its placement math; the explicit new policy
      // uses portable native math and checks the actual standing disc first.
      const x = r3(ax + (this.cfg.safeArrivalV1?dcos(ang):Math.cos(ang)) * ring * 0.9),
        z = r3(az + (this.cfg.safeArrivalV1?dsin(ang):Math.sin(ang)) * ring * 0.9);
      if (people.some(([px, pz]) => (this.cfg.safeArrivalV1?hypot(px-x,pz-z):Math.hypot(px-x,pz-z)) < 0.8)) continue;
      // birth-near/1 also checks the standing disc first: no route is planned from inside a collider.
      if(this.cfg.safeArrivalV1||near){
        const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
        const grid=spatial.levelAt(0,[x,z]),radius=body?.radius??HUMAN_RADIUS;
        if(!grid||clearanceAt(grid,[x,z])<radius)continue;
      }
      this.ents[id] = this.m.human(id, x, z, { label }); if(body)this.ents[id].body=body;
      let ok=false;
      try{ok = !this.plan('walk_to', { actor: id, x: this.cfg.reference[0], z: this.cfg.reference[1] }) || !this.plan('walk_to', { actor: id, x: ax, z: az });}
      finally{delete this.ents[id];}
      if (ok) { spot = [x, z]; break search; }
    }
    // birth-near/1: a built-over arrival no longer refuses the birth: the nearest clear standing ground to the
    // arrival point, else to the hinted start. Events without `near` keep the original refusal.
    if (!spot && near) spot = this.freeStandingNearV1([ax, az], body?.radius ?? HUMAN_RADIUS) ?? (near.first ? null : this.freeStandingNearV1(near.at, body?.radius ?? HUMAN_RADIUS));
    if (!spot) throw new Error('no free standing room at the arrival point');
    const e = this.m.human(id, spot[0], spot[1], { label, provenance: { origin: 'simulation', confidence: 'hypothetical' } });
    if(this.rt.world.groundV1){const g=(this.rt.services.spatial as Spatial).ground!;e.pose.p[1]=standOn(g,spot[0],spot[1]);}
    e.human.soul = soul; if(body)e.body=body;
    this.ents[id] = e; this.m.canonicalEntityOrder(this.rt.world);
    this.out.changes.push([this.rt.tick, id, 'present', e]);
    return id;
  }
  /** arrival-search/1 (lane ARR): the standing geometry a new body of `label` reads (see arrival-search.ts). Read-only. */
  private arrivalGroundV1(label?: string): { g: ArrivalGround; at: [number, number] } {
    const at: [number, number] = this.rt.world.groundV1 ? groundArrival(this.rt, this.cfg.arrival) : [this.cfg.arrival[0], this.cfg.arrival[1]];
    const floater = this.cfg.scene === 'littlemartians' && ['Verdelis','Kalama','Kweku','Mycos','Ada','Shuijing','Nyx'].includes(label ?? '');
    const radius = floater ? .35 : HUMAN_RADIUS;
    const spatial = this.rt.services.spatial as Spatial; spatial.sync(this.rt.world);
    const f = this.rt.world.groundV1 ? spatial.ground?.field : undefined;
    // one clearance reader per 64 m tile (paged ground: read off the windows without building fine tiles), capped at the radius
    const readers = new Map<number, ((q: [number, number]) => number) | null>();
    const clear = (q: [number, number]) => {
      const tx = Math.floor(q[0] / 64), tz = Math.floor(q[1] / 64), k = (tx + 4096) * 8192 + tz + 4096;
      let read = readers.get(k);
      if (read === undefined) { read = spatial.clearanceCapped(0, [tx * 64 + 32, tz * 64 + 32], radius); readers.set(k, read); }
      return read ? read(q) : 0;
    };
    const people = Object.values(this.ents).filter((e: any) => e.kind === 'human' && (e.human?.level ?? 0) === 0).map((e: any) => [e.pose.p[0], e.pose.p[2]] as [number, number]);
    const b = f ? f.extent : spatial.base.bounds;
    return { at, g: { clear, medium: f ? (q) => f.medium(q[0], q[1]) : () => 0, bounds: [b[0], b[1], b[2], b[3]], people, radius, cos: dcos, sin: dsin } };
  }
  /** arrival-search/1: the nearest standing spot to the arrival point in the world's open walkable area, else the nearest
   * spot of its largest pocket; null when the world has no standing ground at all. Read-only: the server records the spot
   * as the birth's birth-near/1 hint {at, first:true}, so replay never searches. */
  arrivalSearchV1(label?: string): ArrivalSpot | null { const { g, at } = this.arrivalGroundV1(label); return searchArrival(g, at); }
  /** arrival-search/1: is the point in the open walkable area, and how large is its pocket when not? Read-only. */
  arrivalPocketV1(p: [number, number], label?: string): ArrivalPocket { return arrivalPocket(this.arrivalGroundV1(label).g, p); }
  /** arrival-search/1: the world itself keeps a new body off the arrival point (a solid built over it, deep water) or
   * walls it off from the open area. Bodies standing there do not count. Read-only; the god's arrival note. */
  arrivalBlockedV1(): boolean {
    const { g, at } = this.arrivalGroundV1(), q: [number, number] = [at[0], at[1]];
    return !(g.clear(q) >= g.radius && g.medium(q) <= 1) || !arrivalPocket(g, q).open;
  }
  /** birth-near/1: the nearest ground point (rings of 0.25 m out to 12 m) with a clear standing disc, nobody within
   * 0.8 m and no deep water. Walkability from there is proved by the caller's own physical walk, never assumed. */
  private freeStandingNearV1(at: [number, number], radius: number): [number, number] | null {
    if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isFinite)) return null;
    const spatial = this.rt.services.spatial as Spatial; spatial.sync(this.rt.world);
    const f = this.rt.world.groundV1 ? spatial.ground?.field : undefined;
    const people = Object.values(this.ents).filter((e: any) => e.kind === 'human' && (e.human?.level ?? 0) === 0).map((e: any) => [e.pose.p[0], e.pose.p[2]] as [number, number]);
    for (let ring = 0; ring <= 48; ring++) { const n = Math.max(1, ring * 8); for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2, x = r3(at[0] + dcos(ang) * ring * 0.25), z = r3(at[1] + dsin(ang) * ring * 0.25);
      const grid = spatial.levelAt(0, [x, z]);
      if (!grid || clearanceAt(grid, [x, z]) < radius || people.some(([px, pz]) => hypot(px - x, pz - z) < 0.8) || (f && f.medium(x, z) > 1)) continue;
      return [x, z];
    } }
    return null;
  }
  /** Detached admission uses the same native standing-disc geometry as the
   * corrected placer. Legacy replay keeps its original births, but a new
   * admission must never label a known overlapping placement ready. */
  humanBirthIssue(id:string):Diag|null {
    const e=this.ents[id];if(!e?.human)throw new Error('birth body is missing');
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const grid=spatial.levelAt(e.human.level,[e.pose.p[0],e.pose.p[2]]),radius=e.body?.family==='floater'?e.body.radius:HUMAN_RADIUS;
    if(!grid||clearanceAt(grid,[e.pose.p[0],e.pose.p[2]])<radius)
      return {code:'birth.arrival-unavailable',message:'No safe standing room at the arrival point.'};
    return null;
  }
  private tryRemove(id: string): boolean {
    if (!this.ents[id]) return true;
    // A committed build owns its whole crew even between native actions,
    // when no actor reservation exists. Never pull a holder out of the load.
    if(this.cfg.safeCrewRemoval&&[...this.programs.values()].some(p=>p.build?.crew.includes(id)))return false;
    // Fresh physical bases may own occupancy beyond actor reservations. A
    // passenger is still supported by its boat after boarding has completed.
    if(this.physical?.prepareRemoval&&!this.physical.prepareRemoval(this.rt,id))return false;
    if (!this.release(id, { code: 'actor.removed', message: 'actor removed' })) return false;
    delete this.ents[id]; this.keys.delete(id); this.acts.delete(id); this.ons.delete(id);
    this.out.changes.push([this.rt.tick, id, 'present', null]);
    return true;
  }
  removeEntity(id: string) {
    if(this.cfg.safeCrewRemoval)for(const p of this.programs.values())if(p.build?.crew.includes(id))this.stop(p.id);
    const pid = this.byActor.get(id); if (pid) this.stop(pid);
    if (!this.tryRemove(id)&&(!this.cfg.safeCrewRemoval||!this.leaving.includes(id))) this.leaving.push(id); // finish owned obligations first
  }

  // ------------------------------------------------------------------ what the shell reads
  anchors(): Anchor[] {
    return this.anchorsOf(this.rt.world,this.cfg);
  }
  private anchorsOf(w:any,cfg:MarsWorldConfig):Anchor[] {
    const out: Anchor[] = [{ id: cfg.grounds.id, kind: 'region', name: cfg.grounds.name, point: cfg.arrival }];
    for (const id of Object.keys(w.regions).sort()) { const r = w.regions[id]; if (r.kind === 'no-go') continue; out.push({ id, kind: 'place', name: r.label, in: cfg.grounds.id, point: centroid(r.polygon), tags: [r.kind, ...(id === cfg.arrivalPlace ? ['arrival'] : [])] }); }
    for (const id of Object.keys(w.entities).sort()) { const e = w.entities[id]; if (e.kind !== 'fixture') continue; out.push({ id, kind: 'place', name: e.label ?? id, in: cfg.grounds.id, entity: id, tags: [e.def] }); }
    return out;
  }
  regionAt(p: Vec3): string {
    if(this.physical)for(const id of ['shore-water','shore-bank']){const r=this.rt.world.regions[id];if(r&&inPoly(p[0],p[2],r.polygon))return id;}
    return this.cfg.grounds.id;
  }
  poseSampleOf(id: string): PoseSample {
    const e = this.ents[id];
    return [this.rt.tick, Math.round(e.pose.p[0] * 1000), Math.round(e.pose.p[1] * 1000), Math.round(e.pose.p[2] * 1000), Math.round(e.pose.yaw * 1000)];
  }
  currentPath(_id: string): PathCommit | undefined { return undefined; }   // movement is broadcast as keyframes, not as paths decided in advance
  enumerateActivities(): ActivityOption[] { return []; }                    // superseded by cards
  observeBoatControls(actorId:string):NativeBoatControlsV1|null{
    const view=this.physical?.boatControls?.(this.rt,actorId);if(!view)return null;
    if(this.leaving.includes(actorId)){const unavailable={available:false,reason:{code:'boat.helm-retiring',message:'The retiring passenger is completing physical cleanup.'}};view.take=unavailable;view.release=structuredClone(unavailable);}
    return view;
  }
  describeSurroundings(actorId: string) {
    const me = this.pos(actorId) ?? [0, 0];
    const items = Object.keys(this.ents).filter((id) => id !== actorId && (this.ents[id].kind === 'human' || this.ents[id].kind === 'fixture')).map((id) => {
      const e = this.ents[id], d = Math.hypot(e.pose.p[0] - me[0], e.pose.p[2] - me[1]);
      return { id, d, who: (e.label ?? id) as string, what: e.kind === 'human' ? 'a soul' : (e.def as string), doing: e.kind === 'human' ? (e.human.activity as string) : '' };
    }).sort((x, y) => x.d - y.d || (x.id < y.id ? -1 : 1));
    const place = Object.keys(this.rt.world.regions).sort().find((id) => inPoly(me[0], me[1], this.rt.world.regions[id].polygon));
    return { nearby: items.slice(0, 8).map(({ id, who, what, doing, d }) => ({ id, who, what, distance: bucket(d), doing })), region: place ?? this.cfg.grounds.id, happening: 'nothing in particular' };
  }
  observeBodyLocation(actorId:string):BodyLocationV1|null|undefined{return this.physical?.bodyLocation?.(this.rt,actorId);}

  private updateAttention(table: EntityTable | null = null) {
    const people = ((table?.list ?? listEntities(this.ents)) as any[]).filter(e => e.kind === 'human').sort((a,b) => a.id.localeCompare(b.id));
    for (const e of people) {
      // attention/1 (logged 'edge-attention'): a Soul's own look/turn/auto-face holds its head until it expires
      if (e.human.gaze && this.gazeAt(e)) continue;
      delete e.human.attention;
      if (!/talk|converse|listen|watch|warm/.test(e.human.activity)) continue;
      const near = people.filter(o => o !== e).map(o => ({o, d: Math.hypot(o.pose.p[0]-e.pose.p[0], o.pose.p[2]-e.pose.p[2])})).filter(x => x.d < 7).sort((a,b) => a.d-b.d);
      if (near[0]) e.human.attention = [near[0].o.pose.p[0], near[0].o.pose.p[2]];
    }
  }
  renderScene() {
    if(this.physical){
      const visible=structuredClone(this.physical.renderScene()),scene=visible.scene as Record<string,unknown>;
      if(this.newcomerResources.length)scene.newcomerProvisions=newcomerResourcesPublicV1Schema.parse({contract:'commons-newcomer-resources/1',resources:this.newcomerResources.flatMap(f=>commonsNewcomerResourcesV1(f.firstSlot,f.placements).resources),nativeGroundY:0});
      if(this.commonsProvisionsActive)scene.provisions={version:'commons-provisions/1',resources:structuredClone(COMMONS_PERSONAL_RESOURCES),nativeGroundY:0};
      if(this.commonsKitchenActive)scene.kitchen={version:this.commonsKitchenVersion,...(this.commonsKitchenVersion==='commons-kitchen/2'?{slotRow:'r1'}:{}),stations:structuredClone(COMMONS_KITCHENS),ingredientBowlsPerStation:2,servingsPerStation:2,nativeGroundY:0};
      if(this.foodDeliveries.length)scene.foodDeliveries={contract:'commons-food-delivery/1',batches:this.foodDeliveries.map(d=>({deliveryId:d.deliveryId,batch:d.batch,portions:8,resources:commonsFoodDeliveryItemsV1(d.batch).resources}))};
      if(this.socialEdenActive)scene.social={version:'social-eden/1',layoutHash:socialEdenV1().layoutHash,layout:socialEdenV1().layout,nativeGeometry:socialEdenV1().nativeGeometry};
      if(this.greenLandmarkActive)scene.landmarks={contract:'existing-green-landmark/1',sourceProposalHash:existingGreenLandmarkV1().sourceProposalHash,items:[{id:existingGreenLandmarkV1().id,label:'South commons tree',point:existingGreenLandmarkV1().point,visual:existingGreenLandmarkV1().source.visual,visualId:'commons-canopy-tree-16',capabilities:['walk','hang_out']}]};
      if(visible.shore)visible.shore.rulesVersion=this.rulesVersion;
      this.projectRenderPlatformsV1(scene);
      if(this.world.officeStairGuardsV1)scene.officeStairGuards=structuredClone(this.world.officeStairGuardsV1);
      if(this.world.authoredBoundariesV1)scene.authoredBoundaries=structuredClone(this.world.authoredBoundariesV1);
      return {...visible,clock:this.cfg.clock?{origin:this.cfg.clock.origin,dayTicks:this.cfg.clock.dayTicks}:null};
    }
    const scene=structuredClone(this.m.scenes[this.rt.world.base.campus] ?? null);
    if(this.cfg.scene==='eden-commons')scene.commons=commonsSceneMetadataV1Schema.parse({
      version:'commons/1',source:'9b6db72fc2dcf45a762d7ce8e4db0b71d0418ea8',layout:structuredClone(this.m.commonsLayout),
    });
    if(this.foodDeliveries.length)scene.foodDeliveries={contract:'commons-food-delivery/1',batches:this.foodDeliveries.map(d=>({deliveryId:d.deliveryId,batch:d.batch,portions:8,resources:commonsFoodDeliveryItemsV1(d.batch).resources}))};
    if(this.socialEdenActive)scene.social={version:'social-eden/1',layoutHash:socialEdenV1().layoutHash,layout:socialEdenV1().layout,nativeGeometry:socialEdenV1().nativeGeometry};
      if(this.greenLandmarkActive)scene.landmarks={contract:'existing-green-landmark/1',sourceProposalHash:existingGreenLandmarkV1().sourceProposalHash,items:[{id:existingGreenLandmarkV1().id,label:'South commons tree',point:existingGreenLandmarkV1().point,visual:existingGreenLandmarkV1().source.visual,visualId:'commons-canopy-tree-16',capabilities:['walk','hang_out']}]};
    if(this.commonsKitchenActive)scene.kitchen={version:this.commonsKitchenVersion,...(this.commonsKitchenVersion==='commons-kitchen/2'?{slotRow:'r1'}:{}),stations:structuredClone(COMMONS_KITCHENS),ingredientBowlsPerStation:2,servingsPerStation:2,nativeGroundY:0};
    if(this.newcomerResources.length)scene.newcomerProvisions=newcomerResourcesPublicV1Schema.parse({contract:'commons-newcomer-resources/1',resources:this.newcomerResources.flatMap(f=>commonsNewcomerResourcesV1(f.firstSlot,f.placements).resources),nativeGroundY:0});
    if(this.commonsProvisionsActive)scene.provisions={version:'commons-provisions/1',resources:structuredClone(COMMONS_PERSONAL_RESOURCES),nativeGroundY:0};
    this.projectRenderPlatformsV1(scene);
    if(this.world.officeStairGuardsV1)scene.officeStairGuards=structuredClone(this.world.officeStairGuardsV1);
      if(this.world.authoredBoundariesV1)scene.authoredBoundaries=structuredClone(this.world.authoredBoundariesV1);
    return {scene,clock:this.cfg.clock?{origin:this.cfg.clock.origin,dayTicks:this.cfg.clock.dayTicks}:null,
      ...(this.cfg.scene==='littlemartians'?structuredClone(this.m.littleMartiansRender):{}),
      ground:['greenfield','eden-commons'].includes(this.cfg.scene)?'grass' as const:undefined};
  }
  officeStairGuardsV1(){return this.world.officeStairGuardsV1?structuredClone(this.world.officeStairGuardsV1):undefined;}
  authoredBoundariesV1(){return this.world.authoredBoundariesV1?structuredClone(this.world.authoredBoundariesV1):undefined;}
  /** Conservative current-body refusal before any acceptance. Existing support
   * stays authoritative; a source prism is never lowered to a visual floor. */
  previewAuthoredBoundariesV1(raw:AuthoredBoundariesDeclarationV1){
    const declaration=authoredBoundariesDeclarationV1Schema.parse(raw);
    const spatial=this.rt.services.spatial as Spatial;if(!spatial.source)return {code:'authored-boundaries.spatial-not-rebasable',message:'The current native scene cannot admit new boundary bands.'};
    for(const e of listEntities(this.ents)){if(!e.human)continue;const profile=bodyProfile(e),radius=profile.radius,height=profile.height,feet=e.pose.p[1];
      for(const b of declaration.boxes){if(b.collision!=='solid'||b.c[1]+b.half[1]<=feet+1e-10||b.c[1]-b.half[1]>=feet+height-1e-10)continue;
        const dx=e.pose.p[0]-b.c[0],dz=e.pose.p[2]-b.c[2],cs=dcos(b.yaw),sn=dsin(b.yaw),x=Math.max(Math.abs(dx*cs+dz*sn)-b.half[0],0),z=Math.max(Math.abs(-dx*sn+dz*cs)-b.half[2],0);
        if(x*x+z*z<radius*radius-1e-10)return {code:'authored-boundaries.body-intersection',message:`Boundary ${b.id} would intersect current occupied ${profile.id} movement envelope of ${e.id}; no movement or installation was accepted.`};
      }
    }return null;
  }
  configureAuthoredBoundariesV1(raw:AuthoredBoundariesV1){
    const fact=authoredBoundariesV1Schema.parse(raw);if(hashOf(fact)===hashOf(this.world.authoredBoundariesV1??null))return;
    const {acceptedAtTick:_,...declaration}=fact,issue=this.previewAuthoredBoundariesV1(declaration);if(issue)throw Error(issue.code);
    const spatial=this.rt.services.spatial as Spatial;
    this.finishRecorder();this.world.authoredBoundariesV1=immutableAuthoredBoundaryFact(structuredClone(fact));
    if(!spatial.refreshForWorld(this.rt.world))throw Error('authored-boundaries.spatial-not-rebasable');
    spatial.sync(this.rt.world);this.renderBaseKey='';this.startRecorder();
  }
  configureOfficeStairGuardsV1(raw:OfficeStairGuardsV1){
    const fact=officeStairGuardsV1Schema.parse(raw);
    if(hashOf(fact)===hashOf(this.world.officeStairGuardsV1??null))return;
    if(this.world.officeStairGuardsV1)throw Error('office-guards.revision-already-installed');
    const spatial=this.rt.services.spatial as Spatial;if(!spatial.source)throw Error('office-guards.spatial-not-rebasable');
    this.finishRecorder();this.world.officeStairGuardsV1=structuredClone(fact);
    if(!spatial.refreshForWorld(this.rt.world))throw Error('office-guards.spatial-not-rebasable');
    spatial.sync(this.rt.world);this.renderBaseKey='';this.startRecorder();
  }
  readerSetupWithoutRecordingV1<T>(read:()=>T):T{this.readerRecordingDepth++;try{return read();}finally{this.readerRecordingDepth--;}}
  renderPlatformsV1(){return this.renderPlatformMetadata?structuredClone(this.renderPlatformMetadata):undefined;}
  configureRenderPlatformsV1(raw:RenderPlatformsV1){const metadata=renderPlatformsV1Schema.parse(raw);if(metadata.navHash!==hashOf((this.world as any).navV1??null)||metadata.baseStaticHash!==this.world.base.staticHash)throw Error('render-platforms.source-differs');if(hashOf(metadata)===hashOf(this.renderPlatformMetadata??null))return;this.finishRecorder();this.renderPlatformMetadata=structuredClone(metadata);this.renderBaseKey='';this.startRecorder();}
  private projectRenderPlatformsV1(scene:Record<string,unknown>|null){const m=this.renderPlatformMetadata;if(!scene||!m)return;if(m.navHash!==hashOf((this.world as any).navV1??null)||m.baseStaticHash!==this.world.base.staticHash){scene.platforms=[];return;}const {platforms,...provenance}=m;scene.platforms=structuredClone(platforms);scene.platformProvenance=structuredClone(provenance);}
  // E-life: the clock's day length, not its origin: a god setting the time of day moved the origin, the render base was
  // captured again under a new hash and every viewer reinstalled the scene behind the arrival card (viewers read only
  // dayTicks from the scene; the time itself travels in each take's env.datetime)
  private renderContextKeyV1(){return JSON.stringify([this.rt.world.base.campus,this.cfg.scene,this.cfg.clock?.dayTicks??null,this.rulesVersion]);}
  /** `stateHashNow`: rt.stateHash() at this tick when the caller has it (the take it just finished); used only when no
   *  render base is captured in between (lane L1: one world serialisation per 20-tick take boundary, not two). */
  private startRecorder(stateHashNow?:string) {
    if(this.readerRecordingDepth)return;
    // Authored render bases are immutable for this engine instance. Supported
    // campus/clock/config boundaries change this key; actor/object motion is in
    // the take and does not cause repeated hashing of a static render base.
    const key=this.renderContextKeyV1();
    if(key!==this.renderBaseKey) {
      stateHashNow=undefined;
      this.recorderScene=captureRenderScene(this.rulesVersion,this.renderScene());this.renderBaseKey=key;
    }
    this.takeScenes.set(this.recorderScene.ref.hash,this.recorderScene);
    this.recorder=new this.m.TakeRecorder(this.rt,{rulesVersion:this.rulesVersion,renderSceneRef:structuredClone(this.recorderScene.ref)},stateHashNow);
    const retained=new Set([this.recorderScene.ref.hash,...this.chunks.map(c=>(c.take as {renderSceneRef:{hash:string}}).renderSceneRef.hash)]);
    for(const hash of this.takeScenes.keys())if(!retained.has(hash))this.takeScenes.delete(hash);
  }
  /** Finishes the current take; returns its final state hash (= rt.stateHash() now), or undefined inside a reader setup. */
  private finishRecorder():string|undefined {
    if(this.readerRecordingDepth)return undefined;
    const take=this.recorder.finish();
    if(this.rt.tick<=take.startTick)return take.finalStateHash;
    this.chunks.push({fromTick:take.startTick,toTick:this.rt.tick,take});
    if(this.chunks.length>12)this.chunks.shift();
    return take.finalStateHash;
  }
  takeScene(hash:string) { const captured=this.takeScenes.get(hash);return captured?structuredClone(captured):undefined; }
  actorBorrowed(actor: string) {
    return [...this.programs.values()].some(p=>p.readiedActors?.includes(actor)&&!p.action) || !this.byActor.has(actor) && ([...this.programs.values()].some(p=>p.build?.crew.includes(actor)) || this.holders(actor).some(id => ['shared_food_break','converse','classroom_session','computer_music','campfire_circle','group_warmup'].includes(this.rt.records.get(id)?.verb)));
  }
  private buildPlan(program: Program) {
    return constructionPlan(this.rt.world,program.actor,program.steps[0].params.phase,id=>id===program.actor?this.holders(id).length===0:this.free(id));
  }
  private unbuildPlan(program: Program) {
    const walks=[...this.rt.records.values()].filter((r:any)=>r.verb==='walk_to'&&this.rt.isActive(r.id)&&typeof r.params?.x==='number').map((r:any)=>({actor:String(r.params.actor),x:r.params.x,z:r.params.z,level:r.params.level??0}));
    return disassemblyPlan(this.rt.world,program.actor,program.steps[0].params.phase,id=>id===program.actor?this.holders(id).length===0:this.free(id),walks);
  }
  private readinessIssue(actor:string,params:Record<string,unknown>,requireStanding=true):Diag|null{
    const e=this.ents[actor];if(!e?.human||params.activity!=='classroom'||typeof params.host!=='string'||!this.ents[params.host]?.human||typeof params.venue!=='string'||!this.rt.world.regions[params.venue]||typeof params.seconds!=='number'||!Number.isFinite(params.seconds)||params.seconds<20||params.seconds>300)return {code:'activity.readiness-invalid',message:'Readiness needs a current host/venue and a bounded own wait.'};
    if(e.human.grip)return {code:'activity.readiness-load-held',message:'Finish the actual construction/carry phase before offering readiness.'};
    if(requireStanding&&(this.holders(actor).length||e.human.on||e.human.sleepPose))return {code:'activity.readiness-standing-required',message:'Safely finish standing before declaring readiness.'};
    if(requireStanding&&listEntities(this.ents).some((i:any)=>i.support?.kind==='in-hand'&&i.support.by===actor))return {code:'activity.readiness-hands-occupied',message:'Put down held small items through native transfer before declaring readiness.'};
    return null;
  }
  private readyFor(actor:string,host:string,venue:unknown){const p=this.programs.get(this.byActor.get(actor)??''),step=p?.steps[p.index];return !!p&&p.until!==undefined&&!p.action&&!p.stopping&&step?.verb==='activity_readiness_v1'&&step.params.host===host&&step.params.venue===venue&&step.params.activity==='classroom'&&this.holders(actor).length===0&&!this.readinessIssue(actor,step.params);}
  private classroomReadyActors(params:Record<string,unknown>,actor:string){return [...new Set([params.host,...(Array.isArray(params.presenters)?params.presenters:[]),...(Array.isArray(params.audience)?params.audience:[])].filter((a):a is string=>typeof a==='string'&&a!==actor&&this.readyFor(a,actor,params.readinessVenue)))];}
  private jointIssue(params: unknown, actor: string,classroom=false): Diag | null {
    const ids = new Set<string>();
    const visit = (v: unknown) => {
      if (typeof v === 'string' && this.ents[v]?.kind === 'human') ids.add(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(params);
    const p=params as Record<string,unknown>;if(classroom&&p.handoverScope==='owned-readiness/1'&&p.readinessVenue!==this.lecturePlacement?.id)return {code:'activity.readiness-venue-mismatch',message:'Readiness can join only its actual installed lecture venue.'};const ready=classroom&&p.handoverScope==='owned-readiness/1'&&typeof p.readinessVenue==='string'&&this.rt.world.regions[p.readinessVenue];
    for (const id of ids) if (id !== actor && !this.free(id) && !(ready&&this.readyFor(id,actor,p.readinessVenue)) && !(this.programs.get(this.byActor.get(id) ?? '')?.label.startsWith('host supper ') && this.holders(id).length === 0)) return {code: 'actor.busy', message: `${id} is doing something of their own`};
    return null;
  }
  campAnchors(): Anchor[] {
    const cfg: MarsWorldConfig = {...this.cfg, scene:'eden-camp',arrival:[-3,18],reference:[-1,17],arrivalPlace:'arrival'};
    const w = this.m.edenCampWorld();
    return new MarsEngine(this.m, new this.m.Runtime(w,this.registry,this.m.servicesFor(this.m.scenes)(w),this.m.invariants),cfg).anchors();
  }
  adoptCamp() {
    if(this.physical===this.campExpansionReader&&this.campExpansionReader&&hashOf(this.rt.world.base)===hashOf(this.campExpansionReader.base))return;
    if(this.physical)throw new Error('connected.adoption-unqualified');
    if (this.rt.world.base.campus === 'eden-camp') return;
    if (!this.isQuiet()) throw new Error('camp.adoption-not-quiet');
    const camp = this.m.edenCampWorld();
    for(const id of Object.keys(camp.entities))if(this.ents[id])throw new Error(`camp.entity-collision:${id}`);
    // Seal the old public render base before replacing campus/runtime. Even a
    // partial segment keeps its own geometry; no chunk straddles this boundary.
    this.finishRecorder();
    // Add the camp without deleting the original bodies, fixtures, object progress or regions.
    for (const [id, e] of Object.entries(camp.entities)) {
      this.ents[id] = e;
    }
    for (const [id, r] of Object.entries(camp.regions)) if (!this.rt.world.regions[id]) this.rt.world.regions[id] = r;
    this.rt.world.base = camp.base;
    this.cfg = {...this.cfg, scene: 'eden-camp', arrival: [-3,18], reference: [-1,17], arrivalPlace: 'arrival'};
    const actors = Object.keys(this.ents).filter(id => this.ents[id].kind === 'human').sort();
    if (actors.length >= 2) this.m.bindCampChess(this.rt.world, actors[0], actors[1]);
    this.rt = new this.m.Runtime(this.rt.world, this.registry, this.m.servicesFor(this.m.scenes)(this.rt.world), this.m.invariants);
    this.rt.beginActionEpoch(); this.cursor = 0;
    this.startRecorder();
  }
  previewCommonsTransition():CommonsTransitionAdmissionV1 {
    if(!this.cfg.commonsTransitionV1)return {ok:false,diagnostic:{code:'commons-transition.disabled',message:'this factory has no explicit commons transition reader'}};
    if(this.cfg.scene!=='greenfield'||this.programs.size||this.leaving.length)
      return {ok:false,diagnostic:{code:'commons-transition.not-quiet',message:'the original Greenfield programs and departures must finish first'}};
    const nextCfg={...this.cfg,...EDEN_COMMONS_WORLD,...(this.cfg.commonsArrivalV1?{safeArrivalV1:true}:{})};
    const p=prepareCommonsTransition(this.m,this.rt,this.rulesVersion,nativeRulesVersion(this.m.rulesVersion,nextCfg));
    return p.ok?{ok:true,transition:p.transition,anchors:this.anchorsOf(p.runtime.world,nextCfg)}:p;
  }
  /** Only the explicit dual-history factory enables this prospective reader.
   * Installing the reader itself changes no rules, body, program or hash. */
  enableCrewRemovalTransitionReaderV1(){this.crewRemovalTransitionReader=true;}
  enableCommonsFoodDeliveryReaderV1(recorded:CommonsFoodDeliveryV1[]=[]){this.foodDeliveryReader=true;if(recorded.length){this.finishRecorder();this.foodDeliveries=recorded.map(d=>commonsFoodDeliveryV1Schema.parse(d));if(this.foodDeliveries.length>4||this.foodDeliveries.some((d,i)=>d.batch!==i+1))throw Error('food-delivery.snapshot-sequence');this.renderBaseKey='';this.startRecorder();}}
  commonsFoodDeliveriesV1(){return structuredClone(this.foodDeliveries);}
  previewCommonsFoodDeliveryV1(deliveryId:string){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'food-delivery.'+code}});
    if(!this.foodDeliveryReader||!this.commonsProvisionsActive||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.foodDeliveries.some(d=>d.deliveryId===deliveryId))return no('already-delivered');if(this.foodDeliveries.length>=4)return no('capacity');if(!this.canSnapshot())return no('resumable-boundary-required');
    const add=commonsFoodDeliveryItemsV1(this.foodDeliveries.length+1);if(Object.keys(add.entities).some(id=>this.ents[id]))return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(add.entities));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    return {ok:true as const,transition:commonsFoodDeliveryV1Schema.parse({contract:'commons-food-delivery/1',deliveryId,batch:this.foodDeliveries.length+1,portions:8,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{food:true}),fromStateHash:this.stateHash(),additionsHash:add.hash,base:this.world.base})};
  }
  adoptCommonsFoodDeliveryV1(raw:CommonsFoodDeliveryV1){const fact=commonsFoodDeliveryV1Schema.parse(raw),p=this.previewCommonsFoodDeliveryV1(fact.deliveryId);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('food-delivery.stale-or-forged');this.finishRecorder();Object.assign(this.ents,structuredClone(commonsFoodDeliveryItemsV1(fact.batch).entities));this.foodDeliveries.push(fact);this.renderBaseKey='';this.startRecorder();}
  enableExistingGreenLandmarkReaderV1(active=false){this.greenLandmarkReader=true;if(active){this.finishRecorder();this.greenLandmarkActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewExistingGreenLandmarkV1(){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'green-landmark.'+code}});
    if(!this.greenLandmarkReader||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.greenLandmarkActive)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');
    const add=existingGreenLandmarkV1();if(this.ents[add.id]||this.world.regions[add.id])return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.regions,structuredClone(add.regions));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    const spatial=detached.services.spatial as Spatial;spatial.sync(detached.world);const grid=spatial.level(0);if(!grid||clearanceAt(grid,add.point)<HUMAN_RADIUS+.02)return no('unsupported-approach');
    return {ok:true as const,transition:existingGreenLandmarkTransitionV1Schema.parse({contract:'existing-green-landmark/1',tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{green:true}),fromStateHash:this.stateHash(),additionsHash:add.hash,sourceProposalHash:add.sourceProposalHash,base:this.world.base})};
  }
  adoptExistingGreenLandmarkV1(raw:ExistingGreenLandmarkTransitionV1){const fact=existingGreenLandmarkTransitionV1Schema.parse(raw),p=this.previewExistingGreenLandmarkV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('green-landmark.stale-or-forged');this.finishRecorder();Object.assign(this.world.regions,structuredClone(existingGreenLandmarkV1().regions));this.greenLandmarkActive=true;this.renderBaseKey='';this.startRecorder();}
  installEdenGroundReaderV1(reader:EdenGroundReaderV1){this.edenGroundReader=reader;}
  previewEdenGroundV1(){const reader=this.edenGroundReader;if(!reader)return {ok:false as const,diagnostic:{code:'eden-ground.reader-required'}};if(this.physical?.rulesVersion===reader.rulesVersion)return {ok:false as const,diagnostic:{code:'eden-ground.already-installed'}};if(!this.physical||this.cfg.scene!=='eden-commons'||!this.canSnapshot())return {ok:false as const,diagnostic:{code:'eden-ground.resumable-retained-world-required'}};const target=this.composedRules(nativeRulesVersion(reader.rulesVersion,this.cfg));if(target.length>200)return {ok:false as const,diagnostic:{code:'eden-ground.header-capacity'}};const p=reader.prepare(this.rt,this.rulesVersion,target,this.stateHash());return p.ok?{ok:true as const,transition:edenGroundTransitionV1Schema.parse(p.transition)}:p;}
  adoptEdenGroundV1(raw:EdenGroundTransitionV1){const fact=edenGroundTransitionV1Schema.parse(raw),reader=this.edenGroundReader!,p=this.previewEdenGroundV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(p.transition)!==hashOf(fact))throw Error('eden-ground.stale-or-forged');const prepared=reader.prepare(this.rt,this.rulesVersion,fact.toRulesVersion,this.stateHash());if(!prepared.ok)throw Error(prepared.diagnostic.code);this.finishRecorder();this.rt=prepared.runtime;this.registry=this.rt.registry;this.physical=reader;this.cursor=0;this.renderBaseKey='';this.startRecorder();}
  lectureReadout(session:string){const read=readClassroom(this.rt,session);if(!read)return undefined;return {...read,physicalParticipants:read.participants.map(p=>{const body=this.ents[p.actor],fixture=this.ents[p.seat.split('#')[0]],slot=fixture?fixtureSlots(this.rt,fixture).find(s=>s.id===p.seat):undefined,seat=[...this.rt.records.values()].find((r:any)=>r.verb==='sit'&&r.params.actor===p.actor&&r.params.slot===p.seat&&r.phase==='occupied'&&this.rt.isActive(r.id));return {actor:p.actor,seat:p.seat,occupied:!!seat,seatActionId:seat?.id,claimHolders:this.rt.holder('slot:'+p.seat),slot:slot?{position:slot.p,yaw:slot.yaw,level:slot.level}:null,pose:body?structuredClone(body.pose):null,activity:body?.human?.activity};}),display:readClassroom(this.rt,session)?structuredClone(this.lecturePlacement?this.ents[edenLectureV1(this.lecturePlacement).displayId]?.equipment:undefined):undefined};}
  enableEdenLectureReaderV1(placement?:EdenLecturePlacementV1){this.lectureReader=true;if(placement){this.finishRecorder();this.lecturePlacement=structuredClone(placement);this.renderBaseKey='';this.startRecorder();}}
  previewEdenLectureV1(placement:EdenLecturePlacementV1){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'eden-lecture.'+code}});
    if(!this.lectureReader||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.lecturePlacement)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');if(this.rulesVersion.length+5>200)return no('header-capacity');
    let add;try{add=edenLectureV1(placement);}catch{return no('invalid-placement');}if(Object.keys(add.entities).some(id=>this.ents[id])||Object.keys(add.regions).some(id=>this.world.regions[id]))return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(add.entities));Object.assign(graph.world.regions,structuredClone(add.regions));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const copy=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(copy.invariants.some((inv:any)=>inv(copy).length))return no('physical-conflict');
    const spatial=copy.services.spatial as Spatial;spatial.sync(copy.world);const grid=spatial.level(0);if(!grid)return no('ground-required');for(const point of [add.entrance,...add.sideAisles])if(clearanceAt(grid,point)<HUMAN_RADIUS+.02)return no('access-blocked');
    const toRulesVersion=this.rulesVersion.replace(/\+ss\/1$/,'')+'+l/1'+(this.sleepSnapshotActive?'+ss/1':'');
    return {ok:true as const,transition:edenLectureTransitionV1Schema.parse({contract:'eden-lecture-transition/1',placement:add.placement,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion,fromStateHash:this.stateHash(),layoutHash:add.layoutHash})};
  }
  adoptEdenLectureV1(raw:EdenLectureTransitionV1){const fact=edenLectureTransitionV1Schema.parse(raw),p=this.previewEdenLectureV1(fact.placement);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('eden-lecture.stale-or-forged');const add=edenLectureV1(fact.placement);this.finishRecorder();Object.assign(this.ents,structuredClone(add.entities));Object.assign(this.world.regions,structuredClone(add.regions));this.lecturePlacement=structuredClone(fact.placement);this.renderBaseKey='';this.startRecorder();}
  private lectureBaseStateHash(nativeStateHash: string){const saved=this.lecturePlacement,sleep=this.sleepSnapshotActive;try{this.lecturePlacement=undefined;this.sleepSnapshotActive=false;return this.stateHashWithWorld(nativeStateHash);}finally{this.lecturePlacement=saved;this.sleepSnapshotActive=sleep;}}
  enableSocialEdenReaderV1(active=false){this.socialEdenReader=true;if(active){this.finishRecorder();this.socialEdenActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewSocialEdenV1(){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'social-eden.'+code}});
    if(!this.socialEdenReader||this.cfg.scene!=='eden-commons')return no('reader-required');if(this.socialEdenActive)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');
    const p=socialEdenV1();if(Object.keys(p.entities).some(id=>this.ents[id])||Object.keys(p.regions).some(id=>this.world.regions[id]))return no('identity-collision');
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(p.entities));Object.assign(graph.world.regions,structuredClone(p.regions));
    const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);
    if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    return {ok:true as const,transition:socialEdenTransitionV1Schema.parse({contract:'social-eden/1',tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{social:true}),fromStateHash:this.stateHash(),additionsHash:p.hash,layoutHash:p.layoutHash,base:this.world.base})};
  }
  adoptSocialEdenV1(raw:SocialEdenTransitionV1){
    const fact=socialEdenTransitionV1Schema.parse(raw),p=this.previewSocialEdenV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('social-eden.stale-or-forged');
    const add=socialEdenV1();this.finishRecorder();Object.assign(this.ents,structuredClone(add.entities));Object.assign(this.world.regions,structuredClone(add.regions));this.socialEdenActive=true;this.renderBaseKey='';this.startRecorder();
  }
  installRetainedCommonsShoreReader(reader:RetainedCommonsShoreReader){this.retainedShoreReader=reader;}
  previewRetainedCommonsShoreV1():RetainedCommonsShoreAdmissionV1{
    const reader=this.retainedShoreReader;
    if(!reader)return {ok:false,diagnostic:{code:'retained-shore.reader-required',message:'An explicit retained-world reader is required.'}};
    if(this.physical||this.cfg.scene!=='eden-commons'||this.programs.size||this.leaving.length||!this.isQuiet())return {ok:false,diagnostic:{code:'retained-shore.not-quiet-commons',message:'Finish programmes and departures at an exact quiet commons boundary.'}};
    const cfg={...this.cfg,walkBlockV1:true},target=this.composedRules(nativeRulesVersion(reader.rulesVersion,cfg));
    const prepared=reader.prepare(this.rt,this.rulesVersion,target,this.stateHash());return prepared.ok?{ok:true,transition:prepared.transition}:prepared;
  }
  adoptRetainedCommonsShoreV1(raw:RetainedCommonsShoreV1){
    const fact=retainedCommonsShoreV1Schema.parse(raw),preview=this.previewRetainedCommonsShoreV1();if(!preview.ok)throw Error(preview.diagnostic.code);
    if(hashOf(fact)!==hashOf(preview.transition))throw Error('retained-shore.stale-or-forged');
    const reader=this.retainedShoreReader!,prepared=reader.prepare(this.rt,fact.fromRulesVersion,fact.toRulesVersion,fact.fromStateHash);if(!prepared.ok)throw Error(prepared.diagnostic.code);
    this.finishRecorder();this.rt=prepared.runtime;this.registry=this.rt.registry;this.physical=reader;this.cfg={...this.cfg,walkBlockV1:true};
    this.cursor=this.rt.events.length;this.renderBaseKey='';this.keys.clear();this.acts.clear();this.ons.clear();this.startRecorder();
  }
  enableCommonsKitchenReaderV1(active=false,version:CommonsKitchenVersion='commons-kitchen/1'){this.commonsKitchenReader=true;this.commonsKitchenReaderVersion=version;if(active){this.commonsKitchenVersion=version;this.finishRecorder();this.commonsKitchenActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewCommonsKitchenV1(version=this.commonsKitchenReaderVersion){
    if(!this.commonsKitchenReader||!this.commonsProvisionsActive||this.cfg.scene!=='eden-commons')return {ok:false as const,diagnostic:{code:'commons-kitchen.reader-unavailable'}};
    if(this.commonsKitchenActive)return {ok:false as const,diagnostic:{code:'commons-kitchen.already-installed'}};
    if(!this.canSnapshot())return {ok:false as const,diagnostic:{code:'commons-kitchen.resumable-boundary-required'}};
    const additions=commonsKitchen(version);if(Object.keys(additions.entities).some(id=>this.ents[id]))return {ok:false as const,diagnostic:{code:'commons-kitchen.identity-collision'}};
    // Validate the actual retained bodies, supports and reservations against
    // the new obstacles on a detached exact graph, never move them to fit.
    const snapshot=this.rt.snapshot(),graph=decodeSnapshot(snapshot);
    Object.assign(graph.world.entities,structuredClone(additions.entities));
    const next={...snapshot,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);
    if(this.m.invariants.some(inv=>inv(detached).length))return {ok:false as const,diagnostic:{code:'commons-kitchen.physical-conflict'}};
    return {ok:true as const,transition:{contract:version,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{kitchen:version}),fromStateHash:this.stateHash(),additionsHash:additions.hash,base:structuredClone(this.world.base)}};
  }
  adoptCommonsKitchenV1(raw:unknown){
    const version=(raw as {contract?:unknown})?.contract;if(version!=='commons-kitchen/1'&&version!=='commons-kitchen/2')throw Error('commons-kitchen.version');
    const p=this.previewCommonsKitchenV1(version);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(raw)!==hashOf(p.transition))throw Error('commons-kitchen.stale-or-forged');
    this.finishRecorder();Object.assign(this.ents,structuredClone(commonsKitchen(version).entities));this.commonsKitchenVersion=version;this.commonsKitchenActive=true;this.renderBaseKey='';this.startRecorder();
  }
  enableNativeSleepSnapshotReaderV1(active=false){this.sleepSnapshotReader=true;this.sleepSnapshotActive=active;if(active)this.rt.services.nativeSleepSnapshotV1=NATIVE_SLEEP_SNAPSHOT_V1;}
  previewNativeSleepSnapshotV1(){const no=(code:string)=>({ok:false as const,diagnostic:{code:'sleep-snapshot.'+code}});if(!this.sleepSnapshotReader)return no('reader-required');if(this.sleepSnapshotActive)return no('already-installed');if(!this.canSnapshot())return no('resumable-boundary-required');if(this.rulesVersion.length+5>200)return no('header-capacity');return {ok:true as const,transition:nativeSleepSnapshotPolicyV1Schema.parse({contract:NATIVE_SLEEP_SNAPSHOT_V1,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.rulesVersion+'+ss/1',fromStateHash:this.stateHash()})};}
  adoptNativeSleepSnapshotV1(raw:NativeSleepSnapshotPolicyV1){const fact=nativeSleepSnapshotPolicyV1Schema.parse(raw),p=this.previewNativeSleepSnapshotV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('sleep-snapshot.stale-or-forged');this.finishRecorder();this.enableNativeSleepSnapshotReaderV1(true);this.renderBaseKey='';this.startRecorder();}
  private sleepSnapshotBaseStateHash(nativeStateHash: string){const saved=this.sleepSnapshotActive;try{this.sleepSnapshotActive=false;return this.stateHashWithWorld(nativeStateHash);}finally{this.sleepSnapshotActive=saved;}}
  enableCommonsNewcomerReaderV1(recorded:CommonsNewcomerResourcesV1[]=[]){this.newcomerReader=true;let next=9;const facts=recorded.map(f=>commonsNewcomerResourcesV1Schema.parse(f));for(const f of facts){if(f.firstSlot!==next)throw Error('newcomer-resources.snapshot-sequence');next+=f.placements.length;}this.newcomerResources=structuredClone(facts);}
  commonsNewcomerResourcesV1(){return this.newcomerResources.flatMap(f=>commonsNewcomerResourcesV1(f.firstSlot,f.placements).resources);}
  previewCommonsNewcomerResourcesV1(placements:readonly NewcomerResourcePlacementV1[]){
    const no=(code:string)=>({ok:false as const,diagnostic:{code:'newcomer-resources.'+code}});
    if(!this.newcomerReader||!this.commonsProvisionsActive||this.cfg.scene!=='eden-commons')return no('reader-required');if(!this.canSnapshot())return no('resumable-boundary-required');
    const firstSlot=9+this.newcomerResources.reduce((n,f)=>n+f.placements.length,0);let add;try{add=commonsNewcomerResourcesV1(firstSlot,placements);}catch{return no('capacity-or-layout');}
    if(Object.keys(add.entities).some(id=>this.ents[id])||Object.keys(add.regions).some(id=>this.world.regions[id]))return no('identity-collision');
    const allMats=[...Object.values(add.regions),...Object.values(this.world.regions).filter(r=>r.id.startsWith('commons-mat-'))];
    for(const r of Object.values(add.regions)){const p=r.polygon;for(const other of allMats){if(other.id===r.id)continue;const q=other.polygon;if(Math.max(...p.map(v=>v[0]))>=Math.min(...q.map(v=>v[0]))&&Math.min(...p.map(v=>v[0]))<=Math.max(...q.map(v=>v[0]))&&Math.max(...p.map(v=>v[1]))>=Math.min(...q.map(v=>v[1]))&&Math.min(...p.map(v=>v[1]))<=Math.max(...q.map(v=>v[1])))return no('overlapping-rest');}}
    const snap=this.rt.snapshot(),graph=decodeSnapshot(snap);Object.assign(graph.world.entities,structuredClone(add.entities));Object.assign(graph.world.regions,structuredClone(add.regions));const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const detached=this.physical?this.physical.restore(next):this.m.Runtime.restore(next,this.registry,this.m.servicesFor(this.m.scenes)(graph.world),this.m.invariants);if(detached.invariants.some((inv:any)=>inv(detached).length))return no('physical-conflict');
    const spatial=detached.services.spatial as Spatial;spatial.sync(detached.world);const grid=spatial.level(0);if(!grid)return no('ground-required');
    for(const resource of add.resources){const mat=add.regions[resource.mat],points:[number,number][]=[...mat.polygon,resource.sleepReturn,[resource.bowlHome[0],resource.bowlHome[2]],[resource.spoonHome[0],resource.spoonHome[2]]];for(let x=mat.polygon[0][0];x<=mat.polygon[1][0];x+=.25)for(let z=mat.polygon[0][1];z<=mat.polygon[2][1];z+=.25)points.push([x,z]);for(const point of points){if(clearanceAt(grid,point)<HUMAN_RADIUS+.02)return no('unsupported-envelope');}}
    const toRulesVersion=this.rulesVersion.replace('+commons-provisions/1','+cp/2');
    return {ok:true as const,transition:commonsNewcomerResourcesV1Schema.parse({contract:'commons-newcomer-resources/1',firstSlot,placements,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion,fromStateHash:this.stateHash(),additionsHash:add.hash,base:this.world.base})};
  }
  adoptCommonsNewcomerResourcesV1(raw:CommonsNewcomerResourcesV1){const fact=commonsNewcomerResourcesV1Schema.parse(raw),p=this.previewCommonsNewcomerResourcesV1(fact.placements);if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(fact)!==hashOf(p.transition))throw Error('newcomer-resources.stale-or-forged');const add=commonsNewcomerResourcesV1(fact.firstSlot,fact.placements);this.finishRecorder();Object.assign(this.ents,structuredClone(add.entities));Object.assign(this.world.regions,structuredClone(add.regions));this.newcomerResources.push(fact);this.renderBaseKey='';this.startRecorder();}
  private newcomerBaseStateHash(nativeStateHash: string){const saved=this.newcomerResources,sleep=this.sleepSnapshotActive,lecture=this.lecturePlacement;try{this.newcomerResources=[];this.sleepSnapshotActive=false;this.lecturePlacement=undefined;return this.stateHashWithWorld(nativeStateHash);}finally{this.newcomerResources=saved;this.sleepSnapshotActive=sleep;this.lecturePlacement=lecture;}}
  enableCommonsProvisionsReaderV1(active=false){this.commonsProvisionsReader=true;if(active){this.finishRecorder();this.commonsProvisionsActive=true;this.renderBaseKey='';this.startRecorder();}}
  previewCommonsProvisionsV1(){
    if(!this.commonsProvisionsReader||this.cfg.scene!=='eden-commons')return {ok:false as const,diagnostic:{code:'commons-provisions.reader-unavailable'}};
    if(this.commonsProvisionsActive)return {ok:false as const,diagnostic:{code:'commons-provisions.already-installed'}};
    if(!this.canSnapshot())return {ok:false as const,diagnostic:{code:'commons-provisions.resumable-boundary-required'}};
    const p=commonsProvisions();
    if(Object.keys(p.entities).some(id=>this.ents[id])||Object.keys(p.regions).some(id=>this.world.regions[id]))return {ok:false as const,diagnostic:{code:'commons-provisions.identity-collision'}};
    return {ok:true as const,transition:{contract:'commons-provisions/1' as const,tick:this.world.tick,fromRulesVersion:this.rulesVersion,toRulesVersion:this.composedRules(nativeRulesVersion(this.physical?.rulesVersion??this.m.rulesVersion,this.cfg),{provisions:true}),fromStateHash:this.stateHash(),additionsHash:p.hash,base:structuredClone(this.world.base)}};
  }
  adoptCommonsProvisionsV1(raw:unknown){
    const p=this.previewCommonsProvisionsV1();if(!p.ok)throw Error(p.diagnostic.code);if(hashOf(raw)!==hashOf(p.transition))throw Error('commons-provisions.stale-or-forged');
    const additions=commonsProvisions();this.finishRecorder();Object.assign(this.ents,structuredClone(additions.entities));Object.assign(this.world.regions,structuredClone(additions.regions));
    this.commonsProvisionsActive=true;this.renderBaseKey='';this.startRecorder();
  }
  previewCrewRemovalTransitionV1():CrewRemovalTransitionAdmissionV1 {
    const no=(code:string,message:string)=>({ok:false as const,diagnostic:{code:'crew-removal-transition.'+code,message}});
    if(!this.crewRemovalTransitionReader)return no('reader-unavailable','an explicit legacy native dual-policy reader is required');
    if(this.cfg.safeCrewRemoval)return no('already-adopted','crew-removal/1 is already active');
    if(!this.isQuiet()||this.leaving.length||!this.canSnapshot())return no('not-quiet','programs, borrowed crews and departures must finish at a resumable native boundary');
    return {ok:true,transition:crewRemovalTransitionV1Schema.parse({contract:'crew-removal-transition/1',tick:this.world.tick,
      fromRulesVersion:this.rulesVersion,toRulesVersion:nativeRulesVersion(this.m.rulesVersion,{...this.cfg,safeCrewRemoval:true}),
      fromStateHash:this.stateHash(),nativeWorldHash:this.rt.stateHash(),base:this.world.base})};
  }
  adoptCrewRemovalTransitionV1(raw:CrewRemovalTransitionV1){
    const fact=crewRemovalTransitionV1Schema.parse(raw),preview=this.previewCrewRemovalTransitionV1();
    if(!preview.ok)throw Error(preview.diagnostic.code+': '+preview.diagnostic.message);
    if(hashOf(fact)!==hashOf(preview.transition))throw Error('crew-removal-transition.stale-or-forged');
    this.finishRecorder();this.cfg={...this.cfg,safeCrewRemoval:true};this.startRecorder();
  }
  adoptCommons(raw:CommonsTransitionV1) {
    const expected=commonsTransitionV1Schema.parse(raw),preview=this.previewCommonsTransition();
    if(!preview.ok)throw new Error(`${preview.diagnostic.code}: ${preview.diagnostic.message}`);
    if(hashOf(expected)!==hashOf(preview.transition))throw new Error('commons-transition.stale-or-forged');
    const prepared=prepareCommonsTransition(this.m,this.rt,expected.fromRulesVersion,expected.toRulesVersion);
    if(!prepared.ok)throw new Error(`${prepared.diagnostic.code}: ${prepared.diagnostic.message}`);
    this.finishRecorder();this.rt=prepared.runtime;this.cursor=0;
    this.cfg={...this.cfg,...EDEN_COMMONS_WORLD,...(this.cfg.commonsArrivalV1?{safeArrivalV1:true}:{})};
    this.startRecorder();
  }
  restockCamp() {
    const expanded=this.physical===this.campExpansionReader&&this.campExpansionReader&&hashOf(this.rt.world.base)===hashOf(this.campExpansionReader.base);
    if ((this.rt.world.base.campus !== 'eden-camp'&&!expanded) || !this.isQuiet()) return;
    // A logged practical supply edit; no trade/economy and no object progress reset.
    const camp = this.m.edenCampWorld();
    for (const id of ['stew-pot', 'beans-bowl', 'greens-bowl', 'water-bowl', 'seed-bowl',...(expanded?['camp-eight-stew']:[])]) {
      const e = this.ents[id], initial = camp.entities[id]??(expanded?this.campExpansionReader!.initialEntity(id):undefined);
      if (e?.contents && initial?.contents && !e.foodPreparation) e.contents = structuredClone(initial.contents);
    }
  }
  /** The explicit factory installs a reader without altering legacy state or
   * history identity. Installation alone grants no scene change. */
  installCampExpansionReader(reader:CampExpansionReader){this.campExpansionReader=reader;}
  previewCampExpansionV1():CampExpansionAdmissionV1{
    const reader=this.campExpansionReader;
    if(!reader)return {ok:false,diagnostic:{code:'camp-expansion.disabled',message:'No explicit camp expansion reader is installed.'}};
    if(this.cfg.scene!=='eden-camp'||this.physical||this.programs.size||this.leaving.length)
      return {ok:false,diagnostic:{code:'camp-expansion.not-idle-camp',message:'The original camp must have finished all programs and physical departures.'}};
    const prepared=reader.prepare(this.rt,this.rulesVersion,nativeRulesVersion(reader.rulesVersion,this.cfg));
    if(!prepared.ok)return prepared;
    const e=new MarsEngine(this.m,prepared.runtime,this.cfg,undefined,reader);
    return {ok:true,transition:prepared.transition,anchors:e.anchors()};
  }
  adoptCampExpansionV1(raw:CampExpansionV1){
    const expected=campExpansionV1Schema.parse(raw),preview=this.previewCampExpansionV1();
    if(!preview.ok||hashOf(preview.transition)!==hashOf(expected))throw new Error('camp-expansion.stale-or-forged');
    const prepared=this.campExpansionReader!.prepare(this.rt,expected.fromRulesVersion,expected.toRulesVersion);
    if(!prepared.ok)throw new Error(prepared.diagnostic.code+': '+prepared.diagnostic.message);
    this.finishRecorder();this.rt=prepared.runtime;this.registry=this.rt.registry;this.physical=this.campExpansionReader;
    this.cursor=this.rt.events.length;this.renderBaseKey='';this.startRecorder();
  }

  /** placeRegionsV1: why a W1 place cannot become a native destination region here (pure), or null. It must be new, level 0,
   *  and lie on admitted native ground with at least three clear 1 m standing spots inside it. */
  previewPlaceRegionV1(r:{id:string;label:string;polygon:[number,number][]}):Diag|null{
    if(!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(String(r?.id)))return {code:'region.bad-id',message:'a place-style id is required'};
    if(this.rt.world.regions[r.id]||this.ents[r.id])return {code:'region.exists',message:`${r.id} already names a region or entity`};
    if(typeof r.label!=='string'||!r.label||r.label.length>100)return {code:'region.bad-label',message:'label 1..100 characters'};
    if(!Array.isArray(r.polygon)||r.polygon.length<3||r.polygon.length>64||!r.polygon.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)))return {code:'region.bad-polygon',message:'3..64 [x,z] points'};
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const centre=spatial.clearTester(0,[r.polygon.reduce((s,v)=>s+v[0],0)/r.polygon.length,r.polygon.reduce((s,v)=>s+v[1],0)/r.polygon.length],HUMAN_RADIUS+.07);if(!centre)return {code:'region.no-ground',message:'no level-0 ground'};
    const xs=r.polygon.map(v=>v[0]),zs=r.polygon.map(v=>v[1]),clearOf=levelGridsFor(spatial,centre,HUMAN_RADIUS+.07);let clear=0;
    for(let x=Math.ceil(Math.min(...xs))+.5;x<Math.max(...xs);x+=1)for(let z=Math.ceil(Math.min(...zs))+.5;z<Math.max(...zs);z+=1){if(!inPoly(x,z,r.polygon))continue;if(clearOf(x,z))clear++;}
    return clear>=3?null:{code:'region.unsupported',message:`${r.id} has ${clear} clear standing spots on admitted native ground (needs 3)`};
  }
  /** placeRegionsV1 (logged rules fact `placeRegionsV1`): W1 places become native destination regions (walk/hang-out/gather offers);
   *  idempotent by id; a place that is not admissible is skipped. Returns the ids added. */
  installPlaceRegionsV1(list:{id:string;label:string;polygon:[number,number][]}[]):string[]{
    const added:string[]=[];
    for(const r of list??[]){if(this.previewPlaceRegionV1(r))continue;this.rt.world.regions[r.id]={id:r.id,label:r.label,kind:'place',level:0,polygon:r.polygon.map(v=>[v[0],v[1]] as [number,number]),provenance:{origin:'design-edit',confidence:'hypothetical',note:'W1 place admitted as a native destination (placeRegionsV1)'}};added.push(r.id);}
    if(added.length){const sorted:Record<string,any>={};for(const id of Object.keys(this.rt.world.regions).sort())sorted[id]=this.rt.world.regions[id];this.rt.world.regions=sorted;}
    return added;
  }
  /** nav/1: why this ground/solids spec cannot be installed (pure), or null. Ground rectangles are flat level-0 floor
   *  (never over the connected shore west of its dry gate); solids are oriented boxes (centre, half-extents, yaw). */
  previewNavV1(spec:NavSpecV1):Diag|null{
    if(!spec||spec.version!=='nav/1'||!Array.isArray(spec.ground)||!Array.isArray(spec.solids))return {code:'nav.bad-spec',message:'{version:"nav/1",ground:[],solids:[]} required'};
    if(spec.ground.length>16||spec.solids.length>1024)return {code:'nav.too-many',message:'at most 16 ground rectangles and 1024 solids'};
    const ids=new Set<string>(),okId=(id:unknown)=>typeof id==='string'&&/^[a-z0-9][a-z0-9._#-]{0,119}$/.test(id)&&!ids.has(id)&&!!ids.add(id);
    for(const g of spec.ground){const b=g?.boundsXZ;if(!okId(g?.id)||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||!(b[0]<b[2]&&b[1]<b[3]))return {code:'nav.bad-ground',message:`ground ${g?.id}: id and boundsXZ [x0,z0,x1,z1] required`};
      // CN5: ground may lie west of the shore's dry gate (x < -29.5: the artists' village, the beach) but never over the
      // connected shore itself (its slope and water, x -62..-29.5, z -12..12, with a metre's margin): there the shore controller rules.
      if(b[0]< -29.5&&b[1]<13&&b[3]> -13&&b[2]> -63)return {code:'nav.ground-west-of-shore-gate',message:`ground ${g.id} overlaps the connected shore west of its dry gate (x -63..-29.5, z -13..13)`};
      if(Math.abs(b[0])>2000||Math.abs(b[1])>2000||Math.abs(b[2])>2000||Math.abs(b[3])>2000)return {code:'nav.bad-ground',message:`ground ${g.id} out of range`};}
    for(const o of spec.solids){if(!okId(o?.id)||!Array.isArray(o.c)||o.c.length!==2||!o.c.every(Number.isFinite)||!Array.isArray(o.half)||o.half.length!==2||!o.half.every(h=>Number.isFinite(h)&&h>0&&h<200)||!Number.isFinite(o.yaw))return {code:'nav.bad-solid',message:`solid ${o?.id}: id, c [x,z], half [hx,hz] (>0) and yaw required`};}
    return null;
  }
  /** nav/1 (logged rules fact `navV1`): extra flat walking ground and solid footprints become part of this world's static
   *  scene (world.navV1; every Spatial built for the world agrees), the walk planner re-bases once (precomputed raster) and
   *  routes around the solids. Idempotent for the same spec. Idle bodies standing inside a new solid step out to the nearest
   *  clear spot; busy ones are named in `trapped` (their programme ends on its own when it cannot route). */
  installNavV1(spec:NavSpecV1):{installed:boolean;relocated:string[];trapped:string[]}{
    if(this.previewNavV1(spec))return {installed:false,relocated:[],trapped:[]};
    const nav=this.navFromSpecV1(spec);
    if(hashOf(this.rt.world.navV1??null)===hashOf(nav))return {installed:false,relocated:[],trapped:[]};
    if(this.renderPlatformMetadata)this.finishRecorder();
    this.rt.world.navV1=nav;
    const spatial=this.rt.services.spatial as Spatial;
    if(!spatial.refreshForWorld(this.rt.world))throw Error('nav.spatial-not-rebasable');
    const grid=spatial.level(0),relocated:string[]=[],trapped:string[]=[];
    for(const id of Object.keys(this.ents).sort()){
      const e=this.ents[id];if(e.kind!=='human'||!e.human||(e.human.level??0)!==0||e.human.shore||e.human.carrier||e.human.sleepPose||e.human.on||!grid)continue;
      if(clearanceAt(grid,[e.pose.p[0],e.pose.p[2]])>=HUMAN_RADIUS)continue;
      const to=this.nearestStandableV1([e.pose.p[0],e.pose.p[2]],id);
      if(to&&this.relocateHumanV1(id,to))relocated.push(id);else trapped.push(id);
    }
    if(this.renderPlatformMetadata){this.renderBaseKey='';this.startRecorder();}
    return {installed:true,relocated,trapped};
  }
  /** upper-floors/1 (logged rules fact `upperFloorsV1`, upper-floors.ts): why this building's upper floors (or their removal)
   *  cannot be applied here (pure), or null. */
  previewUpperFloorsV1(fact:unknown):Diag|null{
    const spatial=this.rt.services.spatial as Spatial,w=this.rt.world,source=spatial.source?.scene.levels??spatial.base.levels;
    return previewUpperFloorsV1(fact,{world:w,sceneLevels:source.map(l=>l.id),groundWorld:!!w.groundV1,
      bodiesOn:(levels)=>Object.keys(this.ents).sort().filter(id=>{const e=this.ents[id],h=e.human;if(e.kind!=='human'||!h)return false;if(levels.has(h.level??0))return true;
        const b=Object.values((w.upperFloorsV1 as UpperFloorsV1|undefined)?.buildings??{}).find(b=>b.levels.some(l=>levels.has(l.id)));
        return !!b&&/^climb/.test(String(h.activity??''))&&e.pose.p[0]>=b.crop[0]-2&&e.pose.p[0]<=b.crop[2]+2&&e.pose.p[2]>=b.crop[1]-2&&e.pose.p[2]<=b.crop[3]+2;}),
      bodiesIn:(crop)=>Object.keys(this.ents).sort().filter(id=>{const e=this.ents[id],h=e.human;return e.kind==='human'&&!!h&&(h.level??0)===0&&e.pose.p[0]>=crop[0]&&e.pose.p[0]<=crop[2]&&e.pose.p[2]>=crop[1]&&e.pose.p[2]<=crop[3];})});
  }
  /** upper-floors/1: install a building's upper floors (cropped levels, floors, solids, stairs, rooms) or remove them; a fact
   *  that does not preview cleanly is a no-op (replay agrees). The planner re-bases once; walkers replan. */
  installUpperFloorsV1(fact:UpperFloorsFactV1):{installed:boolean;added:string[];removed:string[];relocated:string[]}{
    const none={installed:false,added:[] as string[],removed:[] as string[],relocated:[] as string[]};
    if(this.previewUpperFloorsV1(fact))return none;
    if('building' in fact&&this.rt.world.upperFloorsV1?.buildings[fact.building.id])return none;
    if(this.renderPlatformMetadata)this.finishRecorder();
    const out=applyUpperFloorsV1(this.rt.world,fact),spatial=this.rt.services.spatial as Spatial;
    if(!spatial.refreshForWorld(this.rt.world))throw Error('upper-floors.spatial-not-rebasable');
    const relocated:string[]=[];
    if('remove' in fact)for(const id of Object.keys(this.ents).sort()){const e=this.ents[id];if(e.kind!=='human'||!e.human||!out.levels.includes(e.human.level??0))continue;
      const to=this.nearestStandableV1([e.pose.p[0],e.pose.p[2]],id);if(to&&this.relocateHumanV1(id,to))relocated.push(id);}
    if(this.renderPlatformMetadata){this.renderBaseKey='';this.startRecorder();}
    return {installed:true,added:out.added,removed:out.removed,relocated};
  }
  /** upper-floors/1 read: the authored floor number of an engine level (an upper floor's placeLevel; else the level). */
  placeLevelV1(level:number):number{return placeLevelOf(this.rt.world,level);}
  /** world-edit/1 (logged event `world-edit`, lane L9): the entity world's derived physics for the changed entities —
   *  floors on levels, wall solids, stairs, closed doors — and its god-placed fixtures/items (same ids) join this world's
   *  static scene (world.entityPhysicsV1, like nav/1) and entities. The planner re-bases once; idle bodies a new solid
   *  buries step out to the nearest clear spot (edits never bury a Soul); busy ones are named in `trapped`.
   *  Returns the hash it derived so the host can check replay agreement. */
  applyWorldEditV1(raw:WorldEditV1):{hash:string;relocated:string[];trapped:string[];kept:string[]}{
    if(!raw||raw.contract!=='world-edit/1'||typeof raw.set!=='object'||!Array.isArray(raw.levels))throw Error('world-edit.bad-payload');
    if(this.renderPlatformMetadata)this.finishRecorder();
    const baseKey=this.rt.world.entityPhysicsV1?.baseKey;
    const navigationChanged=worldEditChangesNavigation(this.rt.world,raw);
    const {physics,kept}=applyWorldEdit(this.rt.world,raw);
    this.m.canonicalEntityOrder(this.rt.world);
    // entity-world fixtures are depicted by the viewer's entity layer (entity diffs), not by engine change events or takes
    const spatial=this.rt.services.spatial as Spatial;
    // new levels / wider raster: re-base once; otherwise the next sync patches only the changed cells (incremental)
    if(physics.baseKey!==baseKey&&spatial.source)spatial.refreshForWorld(this.rt.world);
    else if(navigationChanged)invalidateSpatialV1(spatial);
    const relocated:string[]=[],trapped:string[]=[];
    for(const id of navigationChanged?Object.keys(this.ents).sort():[]){
      const e=this.ents[id];if(e.kind!=='human'||!e.human||e.human.shore||e.human.carrier||e.human.sleepPose||e.human.on)continue;
      const grid=spatial.levelAt(e.human.level??0,[e.pose.p[0],e.pose.p[2]]);if(!grid||clearanceAt(grid,[e.pose.p[0],e.pose.p[2]])>=HUMAN_RADIUS*0.9)continue;
      if(e.human.activity==='sit'||e.human.baseActivity==='sit')continue; // a seated body's own seat is its support
      const to=(e.human.level??0)===0?this.nearestStandableV1([e.pose.p[0],e.pose.p[2]],id):null;
      if(to&&this.relocateHumanV1(id,to))relocated.push(id);else trapped.push(id);
    }
    if(this.renderPlatformMetadata){this.renderBaseKey='';this.startRecorder();}
    return {hash:physics.hash,relocated,trapped,kept};
  }
  /** A read of this world that moves nothing (a Soul's walk listing): the planner syncs once for all of it (Spatial.readPass). */
  readPassV1<T>(fn:()=>T):T{if(this.inPass++===0)this.passHumans=null;try{return (this.rt.services.spatial as Spatial).readPass(this.rt.world,fn);}finally{if(--this.inPass===0)this.passHumans=null;}}
  /** S2: inside readPassV1 (nothing moves), the world's bodies listed once for every standableNearV1 of the pass (each
   *  listed all ~4,900 entities of Eden 2026 to find the few bodies; ~4% of a busy world). Positions are read live. */
  private passHumans:any[]|null=null;
  private inPass=0;
  /** L4 (c): the entity-table listing the last step ended with, and the tableWritesV1 count it was taken at. */
  private tableCacheV1: EntityTable | null = null;
  private tableCacheAt = -1;
  /** L4 (c): moves on entry to and exit from every MarsEngine method but `step` and the TABLE_PURE reads (below the
   *  class), so a listing taken at the end of one step is reused by the next only when no other engine code ran. */
  tableWritesV1 = 0;
  /** L4 (c): steps that reused the listing (load stats). */
  tableReusesV1 = 0;
  /** world-edit/1 read: the nearest clear standing point to `at` on a level (rings of 0.25 m out to `maxRing`), away from
   *  other bodies; null when none. Used to plan a Soul's approach to a god-placed thing on another floor. */
  standableNearV1(at:[number,number],level=0,except?:string,minClear=HUMAN_RADIUS+.12,maxRing=24):[number,number]|null{
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const clear=spatial.clearTester(level,at,minClear);if(!clear)return null;
    const bodies=this.inPass?(this.passHumans??=listEntities(this.ents).filter((o:any)=>o.kind==='human')):listEntities(this.ents);
    const people=bodies.filter((o:any)=>o.kind==='human'&&o.id!==except&&(o.human?.level??0)===level).map((o:any)=>[o.pose.p[0],o.pose.p[2]] as [number,number]);
    for(let ring=0;ring<=maxRing;ring++){const n=Math.max(1,ring*8);for(let k=0;k<n;k++){
      const ang=(k/n)*Math.PI*2,x=r3(at[0]+dcos(ang)*ring*.25),z=r3(at[1]+dsin(ang)*ring*.25);
      if(!clear([x,z])||people.some(([px,pz])=>hypot(px-x,pz-z)<.7))continue;return [x,z];}}
    return null;
  }
  /** world-edit/1 read: engine level ids and heights (ground 0 first). */
  levelsV1():{id:number;y:number}[]{const spatial=this.rt.services.spatial as Spatial;return spatial.base.levels.map(l=>({id:l.id,y:l.y}));}
  /** world-edit/1 read: who uses an entity-world fixture right now — a body seated on it (its seat slot is claimed) or
   *  holding it — so a god edit can walk that body out first (G1) and query can name who uses it. */
  bodyUsesV1(id:string):{body:string;how:'occupied'|'held'}|null{
    const e=this.ents[id];if(!e)return null;
    const s=e.support;if(s?.kind==='in-hand')return {body:s.by,how:'held'};if(s?.kind==='held'&&s.by?.[0])return {body:s.by[0],how:'held'};
    for(const slot of fixtureSlots(this.rt,e)){const r=slot.claimedBy?this.rt.records.get(slot.claimedBy):undefined;const actor=r?.params?.actor;if(typeof actor==='string'&&this.ents[actor]?.human)return {body:actor,how:'occupied'};}
    return null;
  }
  /** world-edit/1 read (F1): who sits on which seat slot of a fixture now (`seat-1` → the body's id); beds/1: kind 'berth' → who lies on which berth. */
  seatOccupantsV1(id:string,kind:'seat'|'berth'='seat'):{slot:string;body:string}[]{
    const e=this.ents[id];if(!e)return [];const out:{slot:string;body:string}[]=[];
    for(const slot of fixtureSlots(this.rt,e)){if(slot.kind!==kind)continue;const r=slot.claimedBy?this.rt.records.get(slot.claimedBy):undefined;const actor=r?.params?.actor;if(typeof actor==='string'&&this.ents[actor]?.human)out.push({slot:slot.id.slice(id.length+1),body:actor});}
    return out;
  }
  /** Pure world-edit read: actual free native seat slots and their controller's
   * standing approaches. No claim, body movement or hypothetical action. */
  freeSeatSlotsV1(id:string,except?:string):{id:string;p:[number,number];level:number;approach?:[number,number]}[]{
    const e=this.ents[id];if(!e)return [];
    return this.withFeasibilityRead(()=>fixtureSlots(this.rt,e)
      .filter(slot=>slot.kind==='seat'&&isFree(this.rt.world,slot,new Set(except?[except]:[])))
      .map(slot=>{const approach=seatApproach(this.rt,slot);return {id:slot.id,p:[...slot.p] as [number,number],level:slot.level,...(Array.isArray(approach)?{approach:[...approach] as [number,number]}:{})};}));
  }
  /** world-edit/1 read: whether a body of the default human profile can walk from one standing point to another
   *  (levels included, stairs and doors as the planner sees them), and how far. Pure read. A failing search is proved early
   *  (identical results; path.ts proveUnreachable): a Soul's look into a house tries up to 14 points per closed-off room. */
  reachV1(from:{p:[number,number];level?:number},to:{p:[number,number];level?:number}):{ok:true;length:number;legs:number;levels:number[]}|{ok:false;code:string;message:string}{
    const spatial=this.rt.services.spatial as Spatial;
    const r=spatial.route(this.rt.world,HUMAN_PROFILE_V1,{level:from.level??0,p:from.p},{level:to.level??0,p:to.p},{proveUnreachable:true});
    if(!r.ok)return {ok:false,code:r.diagnostic.code,message:r.diagnostic.message};
    const levels=[...new Set(r.route.legs.map((l:any)=>l.kind==='walk'?l.level:l.link.to.level))] as number[];
    return {ok:true,length:Math.round(r.route.length*100)/100,legs:r.route.legs.length,levels};
  }
  /** ground/1 (logged rules fact `groundV1`, lane L8): the world stands on this terrain recipe from now on; bodies take its height.
   *  Idempotent for the same recipe; the recipe must be registered (ground-bridge.ts registerGroundRecipe) before the fact folds. */
  previewGroundV1(fact:unknown){return previewGroundV1(fact);}
  installGroundV1(fact:any):{installed:boolean;settled:string[]}{
    const r=installGround(this.rt,fact);this.registry=this.rt.registry;
    return r;
  }
  /** nav/1: the world.navV1 value a valid spec installs (pure; prefixed ids so they never collide with source obstacles). */
  navFromSpecV1(spec:NavSpecV1){
    return {version:'nav/1' as const,
      ground:spec.ground.map(g=>{const [x0,z0,x1,z1]=g.boundsXZ;return {id:'nav-ground:'+g.id,level:0,y:0,obb:{c:[(x0+x1)/2,(z0+z1)/2] as [number,number],half:[(x1-x0)/2,(z1-z0)/2] as [number,number],yaw:0}};}),
      solids:spec.solids.map(o=>({id:'nav-solid:'+o.id,obb:{c:[o.c[0],o.c[1]] as [number,number],half:[o.half[0],o.half[1]] as [number,number],yaw:o.yaw},y0:-.5,y1:Number.isFinite(o.height)&&o.height!>0?o.height!:4,kind:'solid' as const,...(o.label?{label:String(o.label).slice(0,100)}:{})}))};
  }
  /** Bootstrap nav must use immutable source bounds, not the raster widened by its own previous installation. */
  nativeGroundBoundsV1():[number,number,number,number]{const spatial=this.rt.services.spatial as Spatial;const bounds=spatial.source?.scene.bounds;if(!bounds)throw Error('nav.source-ground-unavailable');return [...bounds] as [number,number,number,number];}
  /** nav/1 read: current raster bounds, widened by installed navigation overlays. */
  groundBoundsV1():[number,number,number,number]{const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);return [...spatial.scene.bounds] as [number,number,number,number];}
  /** nav read: the navigation epoch after syncing (moves exactly when the static world the planner sees changes). */
  navEpochV1():number{const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);return spatial.epoch;}
  /** lane NAV (nav-connect/1, connectivity.ts): the world's level-0 connectivity, relabelled for what changed since the last
   *  read (only the edited ground tiles on a ground world). The main area is the one holding the arrival point. Pure read. */
  private conn?:NavConnectivity;
  private epochSpatial?:Spatial;private epochSeen=-1;private staticEpoch=0;
  /** Load lane L4: the static-geometry epoch — a counter that moves exactly when what the walk planner sees of the static
   *  world changed since the last call (a god commit, a layer or def change, a world edit, a construction phase, a re-based
   *  or replaced spatial service). It is read after a spatial sync, so it is the planner's own change test (Spatial.epoch,
   *  `navChanged`), monotonic over this engine's life. Consumers key derived caches on it instead of scanning the world
   *  (punt search, menu sources). Inside readPassV1 it costs nothing more than an integer compare. */
  staticEpochV1():number{const sp=this.rt.services.spatial as Spatial;sp.sync(this.rt.world);
    if(sp!==this.epochSpatial||sp.epoch!==this.epochSeen){this.epochSpatial=sp;this.epochSeen=sp.epoch;this.staticEpoch++;}return this.staticEpoch;}
  connectivityV1():NavConnectivity{this.navWarmV1(Infinity);return this.conn!;}
  /** Stage B (lane B-spatial): everything the spatial service's static reads need at the current static epoch, as plain
   *  data (structured-clone it), so a read worker can build its own instance (split/spatial-replica.ts) with no engine.
   *  Pure read after the usual sync; the lists are the service's own (shared, never mutate them). */
  exportStaticScene():StaticExportV1{
    const sp=this.rt.services.spatial as Spatial,epoch=this.staticEpochV1(),s=sp.staticScene(this.rt.world),g=this.rt.world.groundV1 as {recipeHash:string}|undefined;
    const arrival:[number,number]=g?groundArrival(this.rt,this.cfg.arrival):[this.cfg.arrival[0],this.cfg.arrival[1]];
    return {...s,epoch,recipeHash:g?.recipeHash??null,recipe:g?groundRecipe(g.recipeHash)??null:null,arrival,physical:!!this.physical,seatDefs:Object.keys(CATALOG).filter(d=>(CATALOG[d]?.slots??[]).some((x:any)=>x.kind==='seat')),physicsHash:(this.rt.world.entityPhysicsV1?.hash as string|undefined)??null};
  }
  /** lane NAV: is each standing point connected to the main walkable area (levels and stairs as the planner sees them)?
   *  Points off the main component, and upper floors, are settled by the planner (reachV1 to the nearest main point). */
  navCheckV1(points:ConnPoint[]):ConnVerdict[]{return this.connectivityV1().check(points);}
  /** lane NAV: warm the world's labels within `budgetMs`, including the current spatial sync. Atomic sync or compile
   *  units may overrun; an exhausted budget still polls and invalidates the graph. True when the labels are complete. */
  navWarmV1(budgetMs:number):boolean{const started=performance.now(),spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    if(!this.conn||this.conn.spatial!==spatial)this.conn=new NavConnectivity(spatial,{anchors:()=>[this.rt.world.groundV1?groundArrival(this.rt,this.cfg.arrival):this.cfg.arrival]});
    return this.conn.update(budgetMs===Infinity?Infinity:Math.max(0,budgetMs-(performance.now()-started)));}
  /** lane NAV: the nearest point of the main walkable area to p with room to stand, away from other bodies (rescue target). */
  navNearestMainV1(p:[number,number],except?:string,maxR=40):[number,number]|null{
    const c=this.connectivityV1(),people=listEntities(this.ents).filter((o:any)=>o.kind==='human'&&o.id!==except&&(o.human?.level??0)===0).map((o:any)=>[o.pose.p[0],o.pose.p[2]] as [number,number]);
    return c.nearestMain(p,maxR,undefined,(q)=>people.some(([x,z])=>hypot(x-q[0],z-q[1])<.8));
  }
  /** lane NAV (nav-connect/1): where a body cut off from the main walkable area should step to — the nearest open spot
   *  of the main area — or null when it is connected, busy (held, seated aboard, asleep, riding), stands in a separate
   *  area larger than `maxPocket` m² (an island or a walled quarter is a place to live, not a trap), or the labels are
   *  not ready within `budgetMs` (a later call finishes them). A body on a seat counts as standing where it gets up (the
   *  seat's standing approach): connected there, it is never moved; when that spot is cut off the answer says `seated`
   *  and the caller logs a god walk-out (the body rises and lands at `to`), since a plain relocate refuses a held body.
   *  Any other held body (a berth, mid-action) is never answered: a relocate refuses it. A body sitting or lying with no
   *  hold is judged where it is. Seated or resting, no standing room (under it, or at a tight approach) is not a pocket:
   *  only a closed-off area moves it.
   *  Pure read; the caller logs the move (edge-relocate). */
  navRescueV1(id:string,budgetMs=50,maxPocket=NAV_RESCUE_MAX_POCKET):{to:[number,number];code:string;pocket?:number;level:number;seated?:true}|null{
    const e=this.ents[id],h=e?.human;if(!h||this.byActor.has(id)||h.sleepPose||h.on||h.riding||h.carrier)return null;
    const seat=this.seatStand(id);if(!seat&&this.holders(id).length)return null;
    const anchored=!seat&&(NAV_ANCHORED.has(h.activity)||NAV_ANCHORED.has(h.baseActivity));
    if(!this.navWarmV1(budgetMs))return null;
    const p:[number,number]=seat?seat.p:[e.pose.p[0],e.pose.p[2]],level=seat?seat.level:h.level??0,v=this.conn!.check([{id,p,level,tol:.6}])[0];
    if(!v||v.ok||(seat||anchored)&&v.code==='nav.no-standing-room')return null;
    if(level===0&&v.code!=='nav.no-standing-room'&&(v.pocket??0)>maxPocket)return null;
    const to=this.navNearestMainV1(p,id);if(!to||hypot(to[0]-e.pose.p[0],to[1]-e.pose.p[2])<.05)return null;
    return {to,code:v.code??'nav.disconnected',...(v.pocket!==undefined?{pocket:v.pocket}:{}),level,...(seat?{seated:true as const}:{})};
  }
  /** lane NAV: what the engine itself offers as destinations — every seat and berth's standing approach, and a standing
   *  spot inside each place region (the one nearest its centre that is on the main area, else its centre) — for the audit. */
  /** `keep` (lane WALK: the gate's walk audit runs in spatial shards) skips fixtures / regions whose position it rejects. */
  navTargetsV1(keep?:(at:[number,number])=>boolean):(ConnPoint&{kind:'seat'|'berth'|'region';of:string})[]{
    const out:(ConnPoint&{kind:'seat'|'berth'|'region';of:string})[]=[],w=this.rt.world,c=this.connectivityV1();
    // lane BS3F: fixtures in spatial order (32 m cells), so each seat's approach reads fine tiles still in the 24-tile LRU
    // (id order thrashed it: a furnished town rebuilt most tiles once per seat)
    for(const id of spatialFixtureIdsV1(w.entities)){const e=w.entities[id];if(keep&&!keep([e.pose.p[0],e.pose.p[2]]))continue;
      for(const slot of fixtureSlots(this.rt,e)){if(slot.kind!=='seat'&&slot.kind!=='berth')continue;const a=seatApproach(this.rt,slot);if(!Array.isArray(a))continue;out.push({id:slot.id,of:id,kind:slot.kind,p:[a[0],a[1]],level:slot.level??0,tol:.5});}}
    for(const id of Object.keys(w.regions).sort()){const r=w.regions[id];if(r.kind==='no-go'||!r.polygon?.length)continue;
      if(keep&&!keep(centroid(r.polygon) as [number,number]))continue;
      const xs=r.polygon.map((v:any)=>v[0]),zs=r.polygon.map((v:any)=>v[1]),ctr=centroid(r.polygon) as [number,number];let best:[number,number]|null=null,bd=Infinity;
      for(let x=Math.min(...xs)+.5;x<Math.max(...xs);x+=1)for(let z=Math.min(...zs)+.5;z<Math.max(...zs);z+=1){if(!inPoly(x,z,r.polygon))continue;const d=hypot(x-ctr[0],z-ctr[1]);if(d<bd&&c.connectedRoot(c.rootAt([x,z]))){best=[x,z];bd=d;}}
      out.push({id,of:id,kind:'region',p:best??ctr,level:0,tol:.5});}
    return out;
  }
  /** BUILDSAFE use-check (lane BS1): can a standard body actually sit on each seat and lie on each berth, judged the way the
   *  sit plan (social/actions.ts take_slot) does it, with the main walkable ground standing in for the walker: a standing
   *  approach with room for the body (reachable/1 assets: radius + plan margin, any angle), the straight sit/stand slide
   *  from it onto the slot crossing nothing (slotTransitionIssue), that approach joined to the main ground both ways
   *  (connectivity, as the walk audit reads it), and, for seats whose top `seatTop` names, a seat height the standard
   *  body sits on. Unlike navTargetsV1 a slot with no standing room at all is counted (use.no-approach), not skipped.
   *  `of` limits it to these fixtures; `keep` skips fixtures whose position it rejects. Pure read. */
  useCheckV1(opts:{of?:string[];keep?:(at:[number,number])=>boolean;seatTop?:(slot:{id:string;of:string})=>number|undefined}={}):UseCheckV1[]{
    const w=this.rt.world,c=this.connectivityV1(),body=HUMAN_PROFILE_V1;
    const ids=opts.of?[...new Set(opts.of)].filter(id=>w.entities[id]).sort():Object.keys(w.entities).sort();
    const verb=(k:string)=>k==='berth'?'lain on':'sat on',spatial=this.rt.services.spatial as Spatial;
    // one obstacle index for every slide tested (rebuilt if the scene's list changes), and the fixtures walked in spatial
    // order (32 m cells) so neighbours share the fine nav tiles (a small LRU); the verdicts are the same, listed by id
    let idx:ObstacleIndex|undefined;const index=()=>(idx&&idx.obstacles===spatial.scene.obstacles?idx:(idx=obstacleIndex(spatial.scene.obstacles)));
    const cell=(v:number)=>Math.floor(v/32),todo=ids.filter(id=>{const e=w.entities[id];return e.kind==='fixture'&&!(opts.keep&&!opts.keep([e.pose.p[0],e.pose.p[2]]));});
    const order=todo.map((id,k)=>({id,k,p:w.entities[id].pose.p})).sort((a,b)=>cell(a.p[2])-cell(b.p[2])||cell(a.p[0])-cell(b.p[0])||a.k-b.k);
    const per:UseCheckV1[][]=todo.map(()=>[]);
    for(const {id,k} of order){const e=w.entities[id],out=per[k];
      for(const slot of fixtureSlots(this.rt,e)){if(slot.kind!=='seat'&&slot.kind!=='berth')continue;
        const base={id:slot.id,of:id,kind:slot.kind as 'seat'|'berth',level:slot.level??0};
        let navIssue:(ConnVerdict&{p:[number,number]})|undefined,slide:{code:string;message:string}|undefined;
        const joined=(p:[number,number])=>{const v=c.check([{id:slot.id,p,level:base.level,tol:.5}])[0];if(v.ok)return true;navIssue??={...v,p};return false;};
        const a=slot.approachPolicy==='reachable/1'?seatApproach(this.rt,slot,{minClearance:body.radius+PLAN_MARGIN,anyAngle:true,accept:(p)=>{
          const issue=slotTransitionIssue(this.rt,slot,p,body,index());if(issue){if(issue.code!=='slot.no-floor')slide??=issue;return false;}
          return joined([p[0],p[1]]);}}):seatApproach(this.rt,slot);
        if(!Array.isArray(a)){
          if(navIssue){const where=navIssue.code==='nav.no-standing-room'?'has no standing room on the walk raster':navIssue.code==='nav.one-way'?'is joined to the main ground one way only':'is cut off from the main ground';
            out.push({...base,ok:false,code:navIssue.code??'nav.disconnected',message:`${slot.id} cannot be ${verb(slot.kind)}: where a body stands to get on it (${navIssue.p[0].toFixed(2)}, ${navIssue.p[1].toFixed(2)}) ${where}`,at:navIssue.p});}
          else if(slide)out.push({...base,ok:false,code:'use.transition-blocked',message:slide.message,at:[slot.p[0],slot.p[1]]});
          else out.push({...base,ok:false,code:'use.no-approach',message:a.message,at:Array.isArray(a.at)?[a.at[0],a.at[2]]:[slot.p[0],slot.p[1]]});
          continue;}
        const at:[number,number]=[a[0],a[1]];
        if(slot.approachPolicy!=='reachable/1'&&!joined(at)){const v=navIssue!;out.push({...base,ok:false,code:v.code??'nav.disconnected',message:`${slot.id} cannot be ${verb(slot.kind)}: where a body stands to get on it (${at[0].toFixed(2)}, ${at[1].toFixed(2)}) ${v.code==='nav.no-standing-room'?'has no standing room on the walk raster':v.code==='nav.one-way'?'is joined to the main ground one way only':'is cut off from the main ground'}`,at});continue;}
        const top=slot.kind==='seat'?opts.seatTop?.({id:slot.id,of:id}):undefined,far=top!==undefined?seatOutOfReach(undefined,top):null;
        if(far){out.push({...base,ok:false,code:'use.seat-out-of-reach',message:`${slot.id}: ${far.message}`,at});continue;}
        out.push({...base,ok:true,at});}}
    return per.flat();
  }
  /** lane NAV: the audit's policy id and passable clearance (reports). */
  navPolicyV1(){return {policy:NAV_CONNECT_POLICY,clear:CONNECT_CLEAR};}
  /** nav/1 read: clearance (m) of level-0 standing ground at a point (0 off ground or inside a solid). */
  /** Floors (2026-10-26): where a body's feet rest at (x, z) on `level`: level 0 of a ground world is the nav's standing
   *  height (the terrain, or a floor plate / deck on it; the swim root in deep water); else the level's flat height. */
  standYAtV1(x:number,z:number,level=0):number|null{const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);if(level===0&&this.rt.world.groundV1&&spatial.ground)return r3(standOn(spatial.ground,x,z));const l=spatial.scene.levels.find(v=>v.id===level);return l?l.y:null;}
  clearanceAtV1(x:number,z:number,level=0):number{const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const clear=spatial.clearanceReader(level,[x,z]);return clear?clear([x,z]):0;}
  /** nav read (L1): clearanceAtV1 capped at `cap` — the same value below it, `cap` at or above it — answered off the paged
   *  windows without building fine nav tiles. For the many "is there standing room here (≥ t ≤ cap)?" reads. */
  clearanceUpToV1(x:number,z:number,cap=1,level=0):number{const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const read=spatial.clearanceCapped(level,[x,z],cap);return read?read([x,z]):0;}
  /** Body-reflex read: leave lying room between quarter-metre path samples too. The cell-distance
   * field is piecewise constant, so include a cell diagonal as well as the half-step margin. */
  lyingRoomAtV1(x:number,z:number,level=0,sampleMargin=0):boolean {
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const need=LIE_CLEARANCE+sampleMargin+Math.SQRT2*spatial.cell;
    const read=spatial.clearanceCapped(level,[x,z],need);return !!read&&read([x,z])>=need;
  }
  /** BS3 closest approach (pure): for a plan's first walk_to whose destination no walk reaches, the nearest point to that
   * destination a walk from where the body stands (a seat's standing approach for a seated body) does reach, on the body's
   * own level: rings of 1.5-36 m round the destination, nearest ring first, each starting on the side facing the body.
   * At most `maxTries` route proofs within about `budgetMs`. Null: no walk_to, a destination it cannot name, or no point found. */
  walkApproachV1(actor:string,steps:{verb:string;params?:Record<string,unknown>}[],budgetMs=250,maxTries=40):{to:[number,number];goal:[number,number];short:number;level:number}|null{
    const step=steps.find(s=>s.verb==='walk_to'),e=this.ents[actor];if(!step||!e?.human)return null;
    const t=this.pointOf(step.params?.to);if(!t)return null;
    const start=this.godWalkoutStartV1(actor);if(!start)return null;
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const level=e.human.level??0,clear=spatial.clearanceCapped(level,[t[0],t[1]],1),t0=performance.now();
    const a0=Math.atan2(start.p[1]-t[1],start.p[0]-t[0]);let tries=0;
    for(const r of [1.5,3,5,8,12,18,26,36]){const n=r<5?8:12;
      for(let k=0;k<n;k++){const turn=(k%2?-1:1)*Math.ceil(k/2)*(2*Math.PI/n),q:[number,number]=[r3(t[0]+dcos(a0+turn)*r),r3(t[1]+dsin(a0+turn)*r)];
        const c=spatial.clearanceCapped(level,q,1)??clear;if(!c||c(q)<HUMAN_RADIUS+.05)continue;
        if(++tries>maxTries||performance.now()-t0>budgetMs)return null;
        const res=spatial.route(this.rt.world,HUMAN_PROFILE_V1,start,{level,p:q},{proveUnreachable:true});
        if(res.ok)return {to:q,goal:[t[0],t[1]],short:Math.round(hypot(q[0]-t[0],q[1]-t[1])*10)/10,level};}}
    return null;
  }
  /** Soul Actions entry 31 (door passage): the programmes walking through `door` (an `open` passage hand step, then the
   * walk through, then the `close` one) and where each is in it. Read by hand-actuator.ts (who is following, who is passing). */
  readonly doorPassersV1=(door:string)=>{
    // In programme start order (the Map keeps insertion order): an earlier passage on the same side goes first.
    // Entry 32: a passage may turn the lock before it opens (`unlock`); `opening` covers both hand steps.
    const out:{actor:string;phase:'approach'|'opening'|'through'|'closing';from:number}[]=[];
    for(const p of this.programs.values()){
      const pass=(s:{verb:string;params?:Record<string,unknown>}|undefined)=>s?.verb==='mars:hand_actuator_v1'&&s.params?.target===door?s.params?.passage as {mode?:string;from?:number}|undefined:undefined;
      const open=p.steps.findIndex(s=>pass(s)?.mode==='open');if(open<0)continue;
      const first=p.steps.findIndex(s=>!!pass(s)),close=p.steps.findIndex((s,j)=>j>open&&pass(s)?.mode==='close'),i=p.index;
      const phase=i===first-1?'approach':i>=first&&i<=open?'opening':i>open&&(close<0||i<close)?'through':i===close?'closing':null;
      if(phase)out.push({actor:p.actor,phase,from:Number(pass(p.steps[open])!.from)});}
    return out;
  };
  /** Soul Actions entry 32: the goal of a passage's staging walk, chosen when the walk begins. The first passage on this side
   * of this door gets the staging spot (`to`); a later one still approaching or opening behind it gets a queue spot about a
   * metre back (out of the doorway lane and the swing), so two Souls never walk into each other at one waiting spot. */
  private doorQueueGoalV1(p:Prog,a:Record<string,unknown>):unknown{
    const q=a.doorQueueV1 as {door:string;from:number;queue:[number,number][]}|undefined;if(!q||!Array.isArray(q.queue))return a.to;
    let ahead=0;
    for(const o of this.programs.values()){if(o.id===p.id)break;if(o.actor===p.actor)continue;
      const passer=this.doorPassersV1(q.door).find(x=>x.actor===o.actor);if(passer&&passer.from===q.from&&(passer.phase==='approach'||passer.phase==='opening'))ahead++;}
    if(!ahead)return a.to;
    // the nearest free queue spot to where this Soul comes from (a follower from the hinge side waits there, never crossing
    // the leader's way to the staging spot); a spot another body already stands on is taken
    const me=this.ents[p.actor]?.pose.p,taken=(q2:[number,number])=>listEntities(this.ents).some((o:any)=>!!o.human&&o.id!==p.actor&&hypot(o.pose.p[0]-q2[0],o.pose.p[2]-q2[1])<.7);
    // the first row (latch side, hinge side) before the row behind it; nearest first within a row
    const d=(x:[number,number])=>me?hypot(x[0]-me[0],x[1]-me[2]):0,spots=q.queue.map((x,i)=>({x,row:i>>1})).sort((a2,b2)=>a2.row-b2.row||d(a2.x)-d(b2.x)).map(e=>e.x);
    for(const spot of spots)if(!taken(spot)&&!this.plan(this.movementVerb(p.actor,spot[0],spot[1]),{actor:p.actor,x:spot[0],z:spot[1],level:this.ents[p.actor]?.human?.level??0}))return spot;
    return a.to;
  }
  /** Soul Actions entry 31 (pure): the closed doors walling this body off from its plan's first walk_to destination. Null
   * when a walk reaches it (or it names nothing). Doors are the walk graph's closed-gap solids (`<door>#door:<opening>`,
   * god engine-bridge) bordering the region the failed route exhausted; nearest to the way there first, at most `max`. */
  closedDoorsOnWalkV1(actor:string,steps:{verb:string;params?:Record<string,unknown>}[],max=4):{goal:[number,number];doors:string[];goalDoors:()=>string[]}|null{
    const step=steps.find(s=>s.verb==='walk_to'),e=this.ents[actor];if(!step||!e?.human||(e.human.level??0)!==0)return null;
    const t=this.pointOf(step.params?.to);if(!t)return null;
    const start=this.godWalkoutStartV1(actor);if(!start)return null;
    const goal=this.nearestStandableV1([t[0],t[1]],actor,HUMAN_RADIUS+.05,8);if(!goal)return null;
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const r=spatial.route(this.rt.world,HUMAN_PROFILE_V1,start,{level:0,p:goal},{nameObstacles:id=>id.includes('#door:')});
    if(r.ok||r.diagnostic.code!=='route.unreachable')return null;
    const pos=(id:string)=>{const o=spatial.scene.obstacles.find(x=>x.id.startsWith(id+'#door:'));return o?o.obb.c:null;};
    const along=(c:[number,number])=>hypot(c[0]-start.p[0],c[1]-start.p[1])+hypot(c[0]-goal[0],c[1]-goal[1]);
    const named=(d:{subjects?:string[]})=>[...new Set((d.subjects??[]).filter(s=>s.includes('#door:')).map(s=>s.split('#')[0]))].map(id=>({id,c:pos(id)})).filter((x):x is {id:string;c:[number,number]}=>!!x.c)
      .sort((a,b)=>along(a.c)-along(b.c)).slice(0,max).map(x=>x.id);
    const ids=named(r.diagnostic);
    // asked only when no door on this side opens the way: the doors walling the destination's own side (the same search
    // from the destination, which floods that side once), so a locked door there refuses instead of a closest approach
    const goalDoors=()=>{const back=spatial.route(this.rt.world,HUMAN_PROFILE_V1,{level:0,p:goal},{level:0,p:start.p},{nameObstacles:id=>id.includes('#door:')});return back.ok?[]:named(back.diagnostic);};
    return {goal,doors:ids,goalDoors};
  }
  /** Soul Actions entry 31 (pure): does a walk from `from` (level 0) reach this plan's first walk_to destination, a
   * standing point at its standoff as the walk itself would choose (goalNear's turns), with the world as it is now? */
  walkFromReachesV1(actor:string,from:[number,number],steps:{verb:string;params?:Record<string,unknown>}[]):boolean{
    const step=steps.find(s=>s.verb==='walk_to'),e=this.ents[actor];if(!step||!e?.human)return false;
    const to=step.params?.to,t=this.pointOf(to);if(!t)return false;
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const g=spatial.levelAt(0,from);if(!g)return false;
    const off=Math.max(typeof step.params?.standoff==='number'?step.params.standoff:0,typeof to==='string'&&!!this.ents[to]?.9:0),base=Math.atan2(from[1]-t[1],from[0]-t[0]);
    if(hypot(from[0]-t[0],from[1]-t[1])<=off+.4)return true;
    for(const turn of [0,.6,-.6,1.2,-1.2,1.9,-1.9,Math.PI]){
      const q:[number,number]=off===0?(this.nearestStandableV1([t[0],t[1]],actor,HUMAN_RADIUS+.05,8)??[t[0],t[1]]):[r3(t[0]+Math.cos(base+turn)*off),r3(t[1]+Math.sin(base+turn)*off)];
      if(spatial.route(this.rt.world,bodyProfile(e),{level:0,p:from},{level:0,p:q},{proveUnreachable:true}).ok)return true;
      if(off===0)return false;
    }
    return false;
  }
  /** Soul Actions entry 32: the god model's lock state of a door, read by a passage's thumb-turn step (hand-actuator.ts). */
  installDoorLockedV1(read:(id:string)=>boolean|null){this.rt.services.doorLockedV1=read;}
  /** Soul Actions entry 32 (pure): does a walk on the ground reach `to` from `from` with the world as it is now (shut doors
   * block their gaps)? Who hears a knock: a body the knocked door shuts in, on the other side. */
  reachesV1(from:[number,number],to:[number,number]):boolean{
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    return spatial.route(this.rt.world,HUMAN_PROFILE_V1,{level:0,p:from},{level:0,p:to},{proveUnreachable:true}).ok;
  }
  /** `people` false: ignore bodies standing there (a static spot, e.g. an item source's, that must not depend on who stands where). */
  nearestStandableV1(at:[number,number],except?:string,minClear=HUMAN_RADIUS+.15,maxRing=80,withPeople=true):[number,number]|null{
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);const clear=spatial.clearTester(0,at,minClear);if(!clear)return null;
    const people=withPeople?listEntities(this.ents).filter((o:any)=>o.kind==='human'&&o.id!==except).map((o:any)=>[o.pose.p[0],o.pose.p[2]] as [number,number]):[];
    for(let ring=0;ring<=maxRing;ring++){const n=Math.max(1,ring*8);for(let k=0;k<n;k++){
      const ang=(k/n)*Math.PI*2,x=r3(at[0]+dcos(ang)*ring*.5),z=r3(at[1]+dsin(ang)*ring*.5);
      if(!clear([x,z])||people.some(([px,pz])=>hypot(px-x,pz-z)<.8))continue;return [x,z];}}
    return null;
  }
  /** nav/1 read: up to `n` clear standing points spread over a polygon (2 m lattice, farthest-point order from its centre), for strolls. */
  clearSpotsV1(polygon:[number,number][],n:number):[number,number][]{
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);if(!Array.isArray(polygon)||polygon.length<3)return [];const centre=spatial.clearTester(0,[polygon.reduce((s,v)=>s+v[0],0)/polygon.length,polygon.reduce((s,v)=>s+v[1],0)/polygon.length],HUMAN_RADIUS+.4);if(!centre)return [];
    const xs=polygon.map(v=>v[0]),zs=polygon.map(v=>v[1]),cand:[number,number][]=[],clearOf=levelGridsFor(spatial,centre,HUMAN_RADIUS+.4);
    for(let x=Math.ceil(Math.min(...xs))+1;x<Math.max(...xs);x+=2)for(let z=Math.ceil(Math.min(...zs))+1;z<Math.max(...zs);z+=2){if(!inPoly(x,z,polygon))continue;if(clearOf(x,z))cand.push([x,z]);}
    if(!cand.length)return [];
    const cx=xs.reduce((a,b)=>a+b,0)/xs.length,cz=zs.reduce((a,b)=>a+b,0)/zs.length;
    const out:[number,number][]=[cand.reduce((b,p)=>hypot(p[0]-cx,p[1]-cz)<hypot(b[0]-cx,b[1]-cz)?p:b)];
    while(out.length<Math.min(n,cand.length)){let best=cand[0],bd=-1;for(const p of cand){const d=Math.min(...out.map(q=>hypot(p[0]-q[0],p[1]-q[1])));if(d>bd){bd=d;best=p;}}if(bd<=0)break;out.push(best);}
    return out;
  }
  /** carrier/1: the carrier this body is boarding, seated in or leaving, if any. */
  carrierOf(actor:string):{id:string;slot:string;riderPhase:string;phase:string;label:string;outInSeconds?:number}|null{
    const b=this.ents[actor]?.human?.carrier,e=b?this.ents[b.id]:undefined;if(!b||!e?.carrier)return null;
    // On the ground (landed, or stepping out): seconds until the body is out at the latest (carrier.ts LEAVE_LIMIT, 12 s).
    const out=b.phase==='leaving'||e.carrier.phase==='landed'?Math.max(1,Math.ceil(((b.phase==='leaving'&&b.outBy!==undefined?b.outBy:this.world.tick+240)-this.world.tick)/20)):undefined;
    return {id:e.id,slot:b.slot,riderPhase:b.phase,phase:e.carrier.phase,label:e.label??e.id,...(out!==undefined?{outInSeconds:out}:{})};
  }
  /** carrier/1: every carrier entity's public state (riders by entity id). */
  carriers(){return listEntities(this.ents).filter((e:any)=>e.carrier).map((e:any)=>({id:e.id as string,def:e.def as string,label:(e.label??e.id) as string,pose:structuredClone(e.pose),state:structuredClone(e.carrier)}));}
  /** carrier/1 install preview (pure): a known carrier def and route, a fresh id, home on clear level-0 ground away from bodies. */
  previewCarrierV1(spec:CarrierInstallSpec):Diag|null{
    if(!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(String(spec?.id)))return {code:'carrier.bad-id',message:'carrier id must be a place-style id'};
    if(this.ents[spec.id])return this.ents[spec.id].carrier?null:{code:'carrier.id-taken',message:`${spec.id} already names another entity`};
    if(!Array.isArray(spec.at)||!spec.at.every(Number.isFinite))return {code:'carrier.bad-home',message:'at must be [x,z]'};
    const e=this.m.carrierEntity(spec,this.rt.tick);if('code' in e)return e;
    if(spec.def==='rowing-punt')return previewPunt(this.rt,spec,this.renderScene());
    const spatial=this.rt.services.spatial as Spatial;spatial.sync(this.rt.world);
    const need=Math.hypot(0.75,0.6)+0.3;
    // One home-selected reader preserves the same bounds for home, door and every exit. Off-window
    // capped reads classify only nearby cells; in-window/flat reads keep the existing full-grid path.
    const clear=spatial.clearanceCapped(0,[spec.at[0],spec.at[1]],Math.max(need,HUMAN_RADIUS+.3));
    if(!clear||clear(spec.at)<need)return {code:'carrier.home-blocked',message:'the carrier home is not clear level-0 ground'};
    for(const o of listEntities(this.ents) as any[])if(o.human&&Math.hypot(o.pose.p[0]-spec.at[0],o.pose.p[2]-spec.at[1])<2.5)return {code:'carrier.home-occupied',message:`${o.id} stands where the carrier would be`};
    const dp=e.pose,c=dcos(dp.yaw),sn=dsin(dp.yaw);
    const cd=CATALOG[spec.def]?.capabilities?.carrier!;for(const local of [cd.door,...cd.seats.map(x=>x.exit)]){const x=dp.p[0]+local[0]*c-local[1]*sn,z=dp.p[2]+local[0]*sn+local[1]*c;if(clear([x,z])<HUMAN_RADIUS+.3)return {code:'carrier.door-blocked',message:'the boarding step or exit spots are not clear ground'};}
    return null;
  }
  /** CN5 (logged rules fact `carrierRouteV1`): a parked, empty carrier flies another named route from its next flight. */
  setCarrierRouteV1(spec:{id:string;route:string}):boolean{return setCarrierRoute(this.rt.world as any,spec.id,spec.route);}
  /** CN5: the route id a carrier flies (null if no such carrier). */
  carrierRouteV1(id:string):string|null{return (this.ents[id] as any)?.carrier?.route?.id??null;}
  /** E2 carrier reroute preview (pure): why `rerouteCarrierV1` would refuse now (busy, bad route, new home not clear), or null. */
  previewCarrierRerouteV1(spec:CarrierInstallSpec):Diag|null{
    const e=this.ents[spec.id] as any;if(!e?.carrier)return {code:'carrier.unknown',message:`no carrier ${spec.id}`};
    const c=e.carrier;if(c.phase!=='parked'||Object.values(c.seats).some(Boolean)||c.doorBy||c.hold)return {code:'carrier.busy',message:`${spec.id} has riders or boarders`};
    // the new home must be clear ground with the carrier itself away (it parks at its old home, often within a step)
    const own=this.ents[spec.id];delete this.ents[spec.id];
    let issue:Diag|null;try{issue=this.previewCarrierV1({...spec,id:`${spec.id}.reroute-preview`});}finally{this.ents[spec.id]=own;this.m.canonicalEntityOrder(this.rt.world);}
    return issue&&issue.code!=='carrier.bad-id'?issue:null;
  }
  /** E2 (logged rules fact `carrierRerouteV1`): a parked, empty carrier moves to a new home and route (its attraction changed). */
  rerouteCarrierV1(spec:CarrierInstallSpec):boolean{
    if(this.previewCarrierRerouteV1(spec))return false;
    return rerouteCarrier(this.rt.world as any,spec,this.rt.tick)===null;
  }
  /** carrier/1 (logged rules fact `carrierV1`): add the carrier at its home, idempotent by id. */
  installCarrierV1(spec:CarrierInstallSpec):boolean{
    if(this.ents[spec.id]?.carrier)return true;
    if(this.previewCarrierV1(spec))return false;
    const e=this.m.carrierEntity(spec,this.rt.tick);if('code' in e)return false;
    this.ents[e.id]=e;this.m.canonicalEntityOrder(this.rt.world);this.out.changes.push([this.rt.tick,e.id,'present',e]);
    return true;
  }
  /** First activity slice: only actual admitted standing water with a reachable dry bank qualifies. */
  puntCandidatesV1():CarrierInstallSpec[]{return puntCandidates(this.rt,this.renderScene());}
  /** The same candidate builder, privately advanced by the activity installer's tick budget. */
  puntCandidatesJobV1():PuntSearch{return new PuntSearch(this.rt,()=>this.renderScene());}
  /** Prospective ground-reclaim/1 reader; cfg and its state hash preserve the activation in snapshots. */
  groundReclaimEnabledV1(): boolean { return this.cfg.groundReclaimV1 === true; }
  enableGroundReclaimV1(): void { this.cfg = { ...this.cfg, groundReclaimV1: true }; }
  configureRuntimePolicy(policy: {sleepBlockTicks:number;walkSettleWaitV1?:boolean; occupiedLinkRoutingV1?:boolean; concurrentLinkEgressV1?:boolean;stairLandingClearanceV1?:boolean;stallReleaseSupportV1?:boolean;quietSeatCourtesy?:boolean;fixtureGroundGoalsV1?:boolean;nativeArrivalWitnessV1?:boolean;quietLandingCourtesyV1?:boolean;quietStallReleaseV1?:boolean;stairMakeWayV1?:boolean;yieldTimeoutV1?:boolean;spreadV2?:boolean;shoreDepartV1?:boolean}) {
    if(policy.walkSettleWaitV1!==undefined&&typeof policy.walkSettleWaitV1!=='boolean')throw Error('runtime-policy.walk-settle-wait');
    if(policy.occupiedLinkRoutingV1!==undefined&&typeof policy.occupiedLinkRoutingV1!=='boolean')throw Error('runtime-policy.occupied-link-routing');
    if(policy.concurrentLinkEgressV1!==undefined&&typeof policy.concurrentLinkEgressV1!=='boolean')throw Error('runtime-policy.concurrent-link-egress');
    if(policy.stairLandingClearanceV1!==undefined&&typeof policy.stairLandingClearanceV1!=='boolean')throw Error('runtime-policy.stair-landing-clearance');
    if(policy.stallReleaseSupportV1!==undefined&&typeof policy.stallReleaseSupportV1!=='boolean')throw Error('runtime-policy.stall-release-support');
    if (!Number.isInteger(policy.sleepBlockTicks) || policy.sleepBlockTicks < 20 || policy.sleepBlockTicks > 72000) throw new Error('runtime-policy.sleep-limit');
    if(policy.quietSeatCourtesy !== undefined && typeof policy.quietSeatCourtesy !== "boolean") throw new Error("runtime-policy.quiet-seat-courtesy");
    if(policy.stairMakeWayV1===true)this.cfg={...this.cfg,stairMakeWayV1:true};
    if((policy as {reflexTimeoutV1?:boolean}).reflexTimeoutV1===true)this.cfg={...this.cfg,reflexTimeoutV1:true};
    if((policy as {edgeMotionV1?:boolean}).edgeMotionV1===true)this.cfg={...this.cfg,edgeMotionV1:true};
    if(policy.spreadV2===true)this.cfg={...this.cfg,spreadV2:true};
    if((policy as {spreadClearV1?:boolean}).spreadClearV1===true)this.cfg={...this.cfg,spreadClearV1:true};
    if(policy.yieldTimeoutV1===true)this.cfg={...this.cfg,yieldTimeoutV1:true};
    // shoreDepartV1 (prospective): shore travel may step away from a body already touching the mover (shore.ts).
    if(policy.shoreDepartV1===true){this.cfg={...this.cfg,shoreDepartV1:true};this.rt.services.shoreDepartV1=true;}
    if(policy.quietStallReleaseV1===true)this.cfg={...this.cfg,quietStallReleaseV1:true};
    if(policy.quietLandingCourtesyV1===true)this.cfg={...this.cfg,quietLandingCourtesyV1:true};
    if(policy.nativeArrivalWitnessV1===true)this.cfg={...this.cfg,nativeArrivalWitnessV1:true};
    if(policy.fixtureGroundGoalsV1===true)this.cfg={...this.cfg,fixtureGroundGoalsV1:true};
    if(policy.walkSettleWaitV1===true){this.cfg={...this.cfg,walkSettleWaitV1:true};this.rt.services.walkSettleWaitV1=true;}
    if(policy.occupiedLinkRoutingV1===true){this.cfg={...this.cfg,occupiedLinkRoutingV1:true};this.rt.services.occupiedLinkRoutingV1=true;}
    if(policy.concurrentLinkEgressV1===true){this.cfg={...this.cfg,concurrentLinkEgressV1:true};this.rt.services.concurrentLinkEgressV1=true;}
    // stairLandingClearanceV1 (prospective, #509): the last climb step refuses a landing occupied on its destination level.
    if(policy.stairLandingClearanceV1===true){this.cfg={...this.cfg,stairLandingClearanceV1:true};this.rt.services.stairLandingClearanceV1=true;}
    // stallReleaseSupportV1 (prospective, #447): a stall release stands a body only on supported, clear standing.
    if(policy.stallReleaseSupportV1===true)this.cfg={...this.cfg,stallReleaseSupportV1:true};
    this.cfg.sleepBlockTicks = policy.sleepBlockTicks;
    this.cfg.quietSeatCourtesy = policy.quietSeatCourtesy;
  }
  /** A negative origin (R4-LIVE: a god set the time of day on a young world) reads as more days elapsed; every logged
   *  clock before it had origin >= 0 (clockConfig and LivingWorld never wrote one below), so replays are unchanged. */
  configureClock(clock: { origin: number; dayTicks: number }) {
    if(!Number.isSafeInteger(clock.origin)||!Number.isSafeInteger(clock.dayTicks)||clock.dayTicks<=0)
      throw new TypeError('invalid render clock');
    if(this.cfg.clock?.origin===clock.origin&&this.cfg.clock?.dayTicks===clock.dayTicks){this.updateClock();return;}
    this.finishRecorder();this.cfg.clock={...clock};this.updateClock();this.startRecorder();
  }
  private updateClock() {
    const c = this.cfg.clock; if (!c) return;
    this.rt.world.env.datetime = new Date(Date.UTC(2026, 9, 3, 6) + Math.max(0, this.rt.tick - c.origin) / c.dayTicks * 86400_000).toISOString();
    if (this.rt.tick % 10 === 0) this.out.changes.push([this.rt.tick, '$env', 'datetime', this.rt.world.env.datetime]);
  }
  beginQuiet() { this.quiet = true; }
  /** continuousDayV1: a legacy quiet ends without compaction; programmes and actions carry on untouched. */
  endQuiet() { this.quiet = false; }
  /** reflexTimeoutV1: every 10 s, any live action the runtime has reported stalled (deadlock.stalled / deadlock.cycle:
   *  a walk, seat, stair, swim, courtesy step or yield making no progress while waiting on others) for 60 s or more is
   *  natively cancelled, in every state. Its programme then ends as failed and the Soul re-chooses; a climber steps off
   *  at a landing (stairMakeWayV1 retreats it when that landing is full). Stateless: tick and runtime records only. */
  private timeoutStalledReflexes() {
    const tick = this.rt.tick;
    for (const live of [...this.rt.live.values()] as any[]) {
      const rec = live.rec, d = rec.diagnostic;
      if (live.cancelling || !d || (d.code !== 'deadlock.stalled' && d.code !== 'deadlock.cycle') || !Number.isFinite(d.details?.sinceTick) || tick - d.details.sinceTick < 1200) continue;
      let root = rec; while (root.parent && this.rt.records.get(root.parent)) root = this.rt.records.get(root.parent);
      if (this.rt.isActive(root.id)) this.rt.cancel(root.id, {code: 'reflex.timeout', message: 'this stayed held waiting on other people for a minute'});
    }
  }
  private advanceQuiet() {
    if(this.cfg.quietLandingCourtesyV1)this.clearQuietWalkLandings();
    if (this.cfg.quietSeatCourtesy) this.clearQuietSeatExits();
    if (this.programs.size) return;
    // Cancel only roots: their ordinary exits own and drain their child controllers.
    for (const r of this.rt.records.values()) if (this.rt.isActive(r.id) && !r.parent && r.internalCause !== 'traffic.make-way' && !['put_item','hold_items','face'].includes(r.verb)) this.rt.cancel(r.id, {code:'world.quiet-point',message:'quiet checkpoint after the activity finished'});
    const initial = this.cfg.scene === 'eden-camp' ? this.m.edenCampWorld().entities : {};
    for (const e of listEntities(this.ents) as any[]) if (e.support?.kind === 'in-hand') {
      const actor = e.support.by;
      if (this.holders(actor).length || this.rt.holder(`entity:${e.id}`).length) continue;
      const home = initial[e.id]?.support??(this.physical===this.campExpansionReader?this.campExpansionReader?.initialEntity(e.id)?.support:undefined);
      const slot = home?.kind === 'resting-on' && home.slot ? `${home.on}#${home.slot}` : 'ground';
      const params = {actor,item:e.id,surfaceSlot:slot};
      if (!this.plan('put_item',params)) this.rt.submit('put_item',params);
      else if (!this.plan('put_item',{...params,surfaceSlot:'ground'})) this.rt.submit('put_item',{...params,surfaceSlot:'ground'});
      else {
        // A held item in front of a fixture needs a different facing before it can be set down.
        const a = this.ents[actor], yaw = a.pose.yaw + Math.PI/2;
        this.rt.submit('face',{actor,target:{point:[a.pose.p[0]+Math.cos(yaw)*2,a.pose.p[2]+Math.sin(yaw)*2]}});
      }
    }
  }
  /** stairMakeWayV1: every 10 s, a climber the runtime itself reports stalled on a flight (climb-wait,
   *  deadlock.stalled; whether still climbing, stopping or cancelling to a landing) asks the free idle
   *  bystanders named in that wait to step aside through native make-way (spec §17, as floor walks already
   *  do). Without it an idle body at a stair head holds the climber, and so the quiet barrier, forever
   *  (live 4970, 2026-10-07). Stateless: driven by tick and runtime records only, so snapshots agree. */
  private clearStairHeads() {
    for (const live of [...this.rt.live.values()] as any[]) {
      const rec = live.rec, me = this.ents[rec.params?.actor];
      if (rec.verb !== 'walk_to' || rec.status !== 'blocked' || rec.diagnostic?.code !== 'deadlock.stalled' || me?.human?.activity !== 'climb-wait') continue;
      let room = false;
      for (const s of rec.diagnostic?.subjects ?? []) {
        if (s === me.id || !this.ents[s]?.human) continue;
        if (this.ents[s]!.human!.task) { room = true; continue; }   // already moving (e.g. an earlier courtesy step)
        if (!this.stairYieldable(s)) continue;
        this.m.makeWay(this.rt, s, [me.pose.p[0], me.pose.p[2]]);
        if (this.rt.records.has(`${s}:make-way:${this.rt.tick}`)) room = true;
      }
      // No one at a full landing can step aside: a climber already cancelling to that exit landing
      // retreats along the same flight to its entry landing instead (native cancel traversal, which
      // itself waits for a supported clear landing). Floaters keep their exit rule.
      const ex = live.exec;
      if (!room && ex?.cancelTo === 'exit' && me.body?.family !== 'floater') ex.cancelTo = 'entry';
    }
  }
  /** A free idle bystander: no programme, task, grip, seat, ride, sleep pose, borrow or hold (as quiet landing courtesy). */
  private stairYieldable(id:string){const o=this.ents[id] as any;return !!o?.human&&!o.human.task&&!o.human.grip&&!o.human.on&&!o.human.riding&&!o.human.sleepPose&&!o.human.boatPassenger&&!o.human.boatTransit&&!this.byActor.has(id)&&!this.actorBorrowed(id)&&!this.holders(id).length&&['idle','wait'].includes(o.human.activity);}
  private clearQuietWalkLandings(){
    for(const live of this.rt.live.values()){
      const ex=live.exec,leg=ex?.route?.legs?.[ex.leg];
      if(live.rec.verb!=='walk_to'||!ex.cancelTo||leg?.kind!=='link'||live.rec.status!=='blocked')continue;
      const entry=leg.ascending?leg.link.from:leg.link.to,exit=leg.ascending?leg.link.to:leg.link.from,landing=ex.cancelTo==='exit'?exit:entry;
      for(const other of listEntities(this.ents) as any[]){
        if(other.id===ex.actor||!other.human||other.human.level!==landing.level||other.human.task||other.human.grip||other.human.on||other.human.riding||other.human.sleepPose||other.human.boatPassenger||other.human.boatTransit||this.byActor.has(other.id)||this.actorBorrowed(other.id)||this.holders(other.id).length)continue;
        if(!['idle','wait'].includes(other.human.activity)||Math.hypot(other.pose.p[0]-landing.p[0],other.pose.p[2]-landing.p[1])>2*HUMAN_RADIUS+.1)continue;
        // Existing autonomous traffic controller plans a supported ordinary
        // step. It never teleports or takes over an owned active programme.
        this.m.makeWay(this.rt,other.id,landing.p);
      }
    }
  }
  private clearQuietSeatExits() {
    // Completed social cards can retain physical holds while another card is
    // still draining. Release only those idle holds, retaining every program's
    // actor/crew, then let native makeWay find a legal courtesy step for a free
    // bystander obstructing a seat's ordinary stand-up path.
    for (const live of this.rt.live.values()) {
      const r=live.rec;
      if (r.parent || !['gather','converse','take_slot','sit'].includes(r.verb)) continue;
      if ([...this.programs.values()].some(p=>p.action===r.id || [p.actor,...(p.build?.crew??[])].some(a=>this.holders(a).includes(r.id)))) continue;
      this.rt.cancel(r.id,{code:'world.quiet-point',message:'release a completed social hold while remaining work drains'});
    }
    for (const live of this.rt.live.values()) {
      if (!['sit','take_slot'].includes(live.rec.verb) || live.exec?.phase!=='stand-up' || !live.exec.approach) continue;
      const actor=this.ents[live.exec.actor],from=live.exec.from ?? [actor.pose.p[0],actor.pose.p[2]],to=live.exec.approach;
      const dx=to[0]-from[0],dz=to[1]-from[1],len=dx*dx+dz*dz;
      for(const other of listEntities(this.ents) as any[]) {
        if(other.id===actor.id || !other.human || other.human.level!==actor.human.level || this.byActor.has(other.id)||this.actorBorrowed(other.id)) continue;
        const t=len ? Math.max(0,Math.min(1,((other.pose.p[0]-from[0])*dx+(other.pose.p[2]-from[1])*dz)/len)):0;
        if(Math.hypot(other.pose.p[0]-from[0]-t*dx,other.pose.p[2]-from[1]-t*dz)<0.7) this.m.makeWay(this.rt,other.id,to);
      }
    }
  }
  isQuiet() { return this.programs.size === 0 && this.m.compactionIssue(this.rt) === null; }
  compact() {
    if (!this.isQuiet()) throw new Error('compaction.not-quiet');
    this.finishRecorder();
    this.rt = this.m.compactRuntime(this.rt, this.physical?.services??this.m.servicesFor(this.m.scenes));
    this.registry = this.rt.registry; this.cursor = 0; this.quiet = false;
    if(this.sleepSnapshotActive)this.rt.services.nativeSleepSnapshotV1=NATIVE_SLEEP_SNAPSHOT_V1;
    if(this.cfg.walkSettleWaitV1===true)this.rt.services.walkSettleWaitV1=true;
    if(this.cfg.occupiedLinkRoutingV1===true)this.rt.services.occupiedLinkRoutingV1=true;
    if(this.cfg.concurrentLinkEgressV1===true)this.rt.services.concurrentLinkEgressV1=true;
    if(this.cfg.stairLandingClearanceV1===true)this.rt.services.stairLandingClearanceV1=true;
    if(this.cfg.shoreDepartV1===true)this.rt.services.shoreDepartV1=true;
    this.startRecorder();
  }

  // ------------------------------------------------------------------ checkpoints
  /** Mars's own resumable snapshot, plus which program each actor is in. Body-language steps lower only to verbs Mars can resume exactly. */
  snapshot(): EngineSnapshot { return this.captureSnapshot().finish(); }
  captureSnapshot(): EngineSnapshotCapture {
    const mars = this.rt.captureSnapshot() as RuntimeSnapshotCapture;
    // Capture every adapter input and policy hash at the native boundary. Neither
    // completion path below reads the live engine. Keep the mars slot/order intact.
    const snapshot = this.captureSnapshotEnvelope(mars.stateHash, mars.droppedCount);
    const assemble = (native: RuntimeSnapshot): EngineSnapshot => {
      const result = structuredClone(snapshot);
      result.mars = native;
      return result;
    };
    return Object.freeze({ tick: snapshot.tick, stateHash: snapshot.stateHash,
      finish: () => assemble(mars.finish()),
      *steps() { return assemble(yield* mars.steps()); },
    });
  }
  private captureSnapshotEnvelope(nativeStateHash: string | undefined, droppedCount: number) {
    return structuredClone({ ...(this.lecturePlacement?{edenLectureV1:this.lecturePlacement,lectureBaseStateHash:nativeStateHash === undefined ? '' : this.lectureBaseStateHash(nativeStateHash)}:{}), ...(this.sleepSnapshotActive?{nativeSleepSnapshotV1:true,sleepSnapshotBaseStateHash:nativeStateHash === undefined ? '' : this.sleepSnapshotBaseStateHash(nativeStateHash)}:{}), ...(this.newcomerResources.length?{commonsNewcomerResourcesV1:structuredClone(this.newcomerResources),newcomerBaseStateHash:nativeStateHash === undefined ? '' : this.newcomerBaseStateHash(nativeStateHash)}:{}), ...(this.renderPlatformMetadata?{renderPlatformsV1:structuredClone(this.renderPlatformMetadata)}:{}), format: SNAPSHOT_FORMAT, tick: this.rt.tick as number, stateHash: nativeStateHash === undefined ? '' : this.stateHashWithWorld(nativeStateHash), mars: undefined as unknown, dropped: droppedCount, programs: [...this.programs.values()], nextProg: this.nextProg, leaving: this.leaving, cfg: this.cfg, ...(this.cfg.scene==='eden-commons'?{commonsVersion:'commons/1'}:{}), quiet: this.quiet, ...(this.commonsProvisionsActive?{commonsProvisionsV1:true}:{}), ...(this.commonsKitchenActive?{commonsKitchenV1:true}:{}), ...(this.socialEdenActive?{socialEdenV1:true}:{}), ...(this.greenLandmarkActive?{greenLandmarkV1:true}:{}), ...(this.foodDeliveries.length?{foodDeliveriesV1:structuredClone(this.foodDeliveries)}:{}), ...(this.commonsKitchenActive&&this.commonsKitchenVersion==='commons-kitchen/2'?{commonsKitchenVersion:this.commonsKitchenVersion}:{}), ...(this.physical?{physicalBinding:this.physical.rulesVersion}:{}), ...(this.rt.world.groundV1?{groundV1:true}:{}) });
  }
  captureCheckpoint(): EngineCheckpointCapture | EngineSnapshotCapture {
    const native = this.rt.captureSnapshotDeferred({}, physicalHashNeedsLegacyCapture);
    if (native.eagerStateHash !== undefined) {
      // Hidden selector metadata retains the exact legacy native getter order.
      // Return the existing eager shape so the host still captures its own fields
      // before reading the live physical hash, with no second native capture.
      const envelope = this.captureSnapshotEnvelope(native.eagerStateHash, native.droppedCount);
      const assemble = (mars: RuntimeSnapshot): EngineSnapshot => {
        const result = { ...structuredClone(envelope), mars };
        return result;
      };
      return Object.freeze({ tick: envelope.tick, stateHash: envelope.stateHash,
        finish: () => assemble(native.finish()),
        *steps() { return assemble(yield* native.steps()); },
      });
    }
    const envelope = this.captureSnapshotEnvelope(undefined, native.droppedCount);
    // Every policy input, including fields not persisted in the envelope, belongs
    // to this exact frontier. Only owned records are used after this method returns.
    const inputs = structuredClone(this.stateHashInputs(''));
    assertCapturedHashable(captureGraph(inputs), []);
    const physical = capturePhysicalHashInput(native.world);
    const assemble = (mars: RuntimeSnapshot): EngineSnapshot => {
      const result = structuredClone(envelope);
      const full = { ...inputs, w: mars.stateHash };
      result.stateHash = hashOf(full);
      if ('lectureBaseStateHash' in result) { const base = { ...full }; delete base.lecturePolicy; delete base.sleepSnapshotPolicy; result.lectureBaseStateHash = hashOf(base); }
      if ('sleepSnapshotBaseStateHash' in result) { const base = { ...full }; delete base.sleepSnapshotPolicy; result.sleepSnapshotBaseStateHash = hashOf(base); }
      if ('newcomerBaseStateHash' in result) { const base = { ...full }; delete base.newcomerResources; delete base.lecturePolicy; delete base.sleepSnapshotPolicy; result.newcomerBaseStateHash = hashOf(base); }
      result.mars = mars;
      return result;
    };
    const steps = function* (): Generator<void, EngineCheckpoint, void> {
      const snapshot = assemble(yield* native.steps());
      yield;
      const physicalHash = yield* capturedPhysicalHashSteps(physical);
      return { snapshot, physicalHash };
    };
    return Object.freeze({ tick: native.tick, steps,
      finish() { const iterator = steps(); let result = iterator.next(); while (!result.done) result = iterator.next(); return result.value; },
    });
  }
  canSnapshot(): boolean {
    // A legacy formation callback is not data and must wait for a quiet point.
    for (const live of this.rt.live.values()) {
      if (typeof live.exec?.detour?.clearOf === 'function') return false;
      // Some codecs admit only a safe execution phase (raise permits lowering).
      // A serializer's presence alone does not establish resumability.
      if (live.def.serializeExec) {
        try { live.def.serializeExec(this.rt, live.exec); }
        catch (error) { if (error instanceof CodecError) return false; throw error; }
      }
    }
    for (const r of this.rt.records.values()) if (this.rt.isActive(r.id) && this.m.nonResumableReason(this.registry.get(r.verb))) return false;
    return true;
  }
  takeChunks(afterTick: number) { return this.chunks.filter(c => c.toTick > afterTick); }
}

// L4 (c, server-reliability 2026-10-31): listing the entity table (Object.keys over ~4,900 keys of a dictionary-mode
// object, then each value) was ~12 % of an idle served world's CPU, once a tick. Nothing outside the engine writes the
// table (the server only reads engine.world), and inside it every write runs in a MarsEngine method or in step. So every
// method but step and the reads below moves `tableWritesV1` on entry and on exit (exit: a method that steps and then
// writes still voids the listing its inner step left), and step reuses the listing the previous step ended with while
// the count is unchanged and the table is the same object. Exact: the same keys, order and values as a fresh listing
// (oracle SIM_TABLE_CHECK=1 lists afresh and throws on any difference). A method added later is wrapped by default.
/** Reads called between ticks on a served world that never add, remove or replace an entry of the table. */
const TABLE_PURE: ReadonlySet<string> = new Set<string>([
  // read every tick by the server and the step itself (SIM_L4_SCAN_SITES=1 engine calls on the live copy); each only reads
  // the table (spatial syncs and connectivity labels are derived state outside it)
  'takeChunks', 'composedRules', 'renderContextKeyV1', 'carrierOf', 'carriers', 'stallProbeV1', 'placeLevelV1', 'programOf',
  'poseSampleOf', 'staticEpochV1', 'lyingRoomAtV1', 'navWarmV1', 'connectivityV1', 'navCheckV1', 'exportStaticScene',
]);
const TABLE_COUNT = process.env.SIM_L4_SCAN_SITES === '1' ? new Map<string, number>() : null;
(MarsEngine as unknown as { tableWriteSitesV1?: Map<string, number> | null }).tableWriteSitesV1 = TABLE_COUNT;   // diagnostic (SIM_L4_SCAN_SITES=1): calls per method
for (const name of Object.getOwnPropertyNames(MarsEngine.prototype)) {
  if (name === 'constructor' || name === 'step' || TABLE_PURE.has(name)) continue;
  const d = Object.getOwnPropertyDescriptor(MarsEngine.prototype, name)!;
  if (typeof d.value !== 'function') continue;
  const f = d.value as (...a: unknown[]) => unknown;
  const wrapped = TABLE_COUNT
    ? function (this: MarsEngine, ...a: unknown[]) { TABLE_COUNT.set(name, (TABLE_COUNT.get(name) ?? 0) + 1); this.tableWritesV1++; try { return f.apply(this, a); } finally { this.tableWritesV1++; } }
    : function (this: MarsEngine, ...a: unknown[]) { this.tableWritesV1++; try { return f.apply(this, a); } finally { this.tableWritesV1++; } };
  Object.defineProperty(wrapped, 'name', { value: name });
  Object.defineProperty(MarsEngine.prototype, name, { ...d, value: wrapped });
}
const TABLE_CHECK = process.env.SIM_TABLE_CHECK === '1';
/** The cached listing; under SIM_TABLE_CHECK=1 first proved equal to a fresh one. */
function checkedTable(t: EntityTable): EntityTable {
  if (!TABLE_CHECK) return t;
  const f = listTable(t.entities);
  if (f.keys.length !== t.keys.length || f.keys.some((k, i) => k !== t.keys[i] || f.list[i] !== t.list[i])) throw new Error('table-cache: the entity table changed outside a MarsEngine method');
  return t;
}

function centroid(poly: [number, number][]): [number, number] { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [r3(x / poly.length), r3(z / poly.length)]; }
function nativeRulesVersion(version:string,cfg:MarsWorldConfig){return `sim-mars/1+${version}${cfg.safeCrewRemoval?'+crew-removal/1':''}${cfg.scene==='eden-commons'?'+commons/1':''}${cfg.safeArrivalV1?'+arrival-clearance/1':''}${cfg.walkBlockV1?'+walk-block/1':''}${cfg.disassemblyV1?'+'+DISASSEMBLY_POLICY:''}${cfg.map?'+'+cfg.map:''}${cfg.sharedCarryV1?'+'+SHARED_RAISE_POLICY+'+'+SHARED_BEAM_POLICY+'+'+SHARED_DECK_POLICY+'+'+SHARED_STAIRS_POLICY:''}`;}
/** PC13 (#692): a world whose engine has the shared raise (SIM_SHARED_CARRY) says so in its rules version: a journal that
 *  names raise_hold_v1 does not replay, nor a snapshot restore, where the verb is not registered. */
export const SHARED_RAISE_POLICY = 'shared-raise/1';
/** PC14 (#693): the same flag adds connect_beam_v1 and the frame invariant: a journal that seats a beam needs them. */
export const SHARED_BEAM_POLICY = 'shared-beam/1';
/** PC15 (#694): the same flag adds install_joist_v1, lay_sheet_v1 and the deck invariant: a journal that builds a deck needs them. */
export const SHARED_DECK_POLICY = 'shared-deck/1';
/** PC16 (#695): the same flag adds install_flight_v1, install_tread_v1 and the stair invariant: a journal that builds stairs needs them. */
export const SHARED_STAIRS_POLICY = 'shared-stairs/1';

/** The factory is made once the Mars engine has been loaded (an async import); after that everything is synchronous. */
export async function marsFactory(cfg: MarsWorldConfig = PROVING_GROUND): Promise<EngineFactory> {
  const loaded = cfg.map===MARS_2026_MAP?withMars2026Map(await loadMars()):await loadMars();if(cfg.map&&cfg.map!==MARS_2026_MAP)throw new Error('mars.unknown-map');
  // PC13 (#692): the shared raise's verb and its invariant exist only behind SIM_SHARED_CARRY (the shared-carry ledger
  // flag, the same default); without it the registry and the invariants are exactly what they were before PC13.
  const sharedCarry = cfg.sharedCarryV1 ?? process.env.SIM_SHARED_CARRY === '1';
  // resolved once here, so the engine's own rules version (this.cfg) says what the factory registered; off adds no key
  if (sharedCarry && cfg.sharedCarryV1 !== true) cfg = {...cfg, sharedCarryV1: true};
  const m = sharedCarry ? {...loaded, invariants: [...loaded.invariants, looseFramesHeld, framesStand, decksBear, stairsBear]} : loaded;
  // disassembly/1 adds its reverse verbs to this engine's registry only; the default registry is unchanged.
  const registry = cfg.disassemblyV1 ? disassemblyRegistry(m.createRegistry) : m.createRegistry(), services = m.servicesFor(m.scenes);
  if (sharedCarry) { registry.set(raiseHold.verb, raiseHold as any); registry.set(connectBeamV1.verb, connectBeamV1 as any); registry.set(installJoistV1.verb, installJoistV1 as any); registry.set(laySheetV1.verb, laySheetV1 as any); registry.set(installFlightV1.verb, installFlightV1 as any); registry.set(installTreadV1.verb, installTreadV1 as any); }   // PC13 (#692), PC14 (#693), PC15 (#694), PC16 (#695)
  return {
    rulesVersion: nativeRulesVersion(m.rulesVersion,cfg),
    // A failed cross-policy checkpoint restore must not turn into replay under
    // another removal policy. An explicit, qualified transition is separate.
    canReplayHistory: version => {
      if((cfg.walkBlockV1||cfg.safeArrivalV1||cfg.scene==='eden-commons'||cfg.disassemblyV1||cfg.map||cfg.sharedCarryV1)&&version!==nativeRulesVersion(m.rulesVersion,cfg))return false;
      if(!cfg.sharedCarryV1&&/\+shared-(?:raise|beam|deck|stairs)\//.test(version))return false;
      if(!cfg.map&&/\+mars-2026-map\//.test(version))return false;
      if(!cfg.disassemblyV1&&/\+disassembly\//.test(version))return false;
      const walk=version.match(/\+walk-block\/[^+]+/g)??[];
      if(cfg.walkBlockV1?walk.length!==1||walk[0]!=='+walk-block/1':walk.length!==0)return false;
      const arrival=version.match(/\+arrival-clearance\/[^+]+/g)??[];
      if(cfg.safeArrivalV1?arrival.length!==1||arrival[0]!=='+arrival-clearance/1':arrival.length!==0)return false;
      const commons=version.match(/\+commons\/[^+]+/g)??[];
      if(cfg.scene==='eden-commons'?commons.length!==1||commons[0]!=='+commons/1':commons.length!==0)return false;
      const policies=version.match(/\+crew-removal\/[^+]+/g)??[];
      return cfg.safeCrewRemoval?policies.length===1&&policies[0]==='+crew-removal/1':policies.length===0;
    },
    // Candidate removal changes controller behavior: restore only its exact
    // policy/version. Legacy activities31 compatibility remains unchanged.
    canRestoreSnapshot: version => cfg.walkBlockV1||cfg.safeArrivalV1||cfg.safeCrewRemoval||cfg.disassemblyV1||cfg.map||cfg.sharedCarryV1||cfg.scene==='eden-commons'?version===nativeRulesVersion(m.rulesVersion,cfg):[m.rulesVersion,m.rulesVersion.replace('+bodies/1',''),m.rulesVersion.replace('+bodies/1','').replace('activities/31','activities/29')].some(v=>version===nativeRulesVersion(v,cfg)),
    /** The synthetic proving ground (a campfire, two benches, a lawn), emptied of its test people: Souls arrive by being born. */
    genesis(seed: string): WorldState {
      if (cfg.scene === 'littlemartians') return m.littleMartiansWorld(seed);
      if (cfg.scene === 'eden-commons') return m.edenCommonsWorld(seed);
      if (cfg.scene === 'greenfield') return m.greenFieldWorld(seed);
      if (cfg.scene === 'eden-camp') return m.edenCampWorld(seed);
      if (cfg.scene === 'meal') { const w = m.mealWorld(); w.rng = m.seedRng(seed); return w as WorldState; }
      const w = m.provingGroundWorld();
      for (const id of Object.keys(w.entities)) if (w.entities[id].kind === 'human') delete w.entities[id];
      w.rng = m.seedRng(seed);
      return w as WorldState;
    },
    create: (world) => {
      if(cfg.scene==='eden-commons'&&(world.base.campus!=='eden-commons'||world.base.staticHash!==m.edenCommonsWorld().base.staticHash))throw new Error('world commons physical base differs from the native factory');
      return new MarsEngine(m, new m.Runtime(world, registry, services(world), m.invariants), cfg);
    },
    restore(snap: EngineSnapshot) {
      if('nativeSleepSnapshotV1' in snap)throw Error('sleep-snapshot.reader-required');
      if('commonsNewcomerResourcesV1' in snap)throw Error('newcomer-resources.reader-required');
      if('commonsKitchenV1' in snap)throw Error('commons-kitchen.reader-required');
      if('commonsProvisionsV1' in snap)throw Error('commons-provisions.reader-required');
      const s = structuredClone(snap) as EngineSnapshot & { mars: any; programs: Prog[]; nextProg: number; leaving: string[]; cfg: MarsWorldConfig; commonsVersion?:string; quiet?: boolean;renderPlatformsV1?:RenderPlatformsV1 };
      if ('physicalBinding' in s)throw new Error('snapshot physical binding differs from the legacy factory');
      if (s.format !== SNAPSHOT_FORMAT) throw new Error(`bad snapshot format ${s.format}`);
      if(!!s.cfg?.walkBlockV1!==!!cfg.walkBlockV1)throw new Error('snapshot walk policy differs from the native factory');
      if(!!s.cfg?.safeArrivalV1!==!!cfg.safeArrivalV1)throw new Error('snapshot arrival policy differs from the native factory');
      if(!!s.cfg?.safeCrewRemoval!==!!cfg.safeCrewRemoval)throw new Error('snapshot removal policy differs from the native factory');
      if(!!s.cfg?.disassemblyV1!==!!cfg.disassemblyV1)throw new Error('snapshot disassembly policy differs from the native factory');
      if((s.cfg?.scene==='eden-commons'||cfg.scene==='eden-commons')&&s.cfg?.scene!==cfg.scene)throw new Error('snapshot commons layout differs from the native factory');
      if(cfg.scene==='eden-commons'&&s.commonsVersion!=='commons/1')throw new Error('snapshot commons rules differ from the native factory');
      // Spatial services are rebuilt for the same base scene; the snapshot carries the rest.
      const scene = (s.cfg ?? cfg).scene;
      const base = scene === 'eden-commons' ? m.edenCommonsWorld() : scene === 'littlemartians' ? m.littleMartiansWorld() : scene === 'greenfield' ? m.greenFieldWorld() : scene === 'eden-camp' ? m.edenCampWorld() : scene === 'meal' ? m.mealWorld() : m.provingGroundWorld();
      // entity-physics/1: the derived fixture assets must be known before the restored Spatial first syncs
      // (decoded once: registerAssets clones what it keeps, so the graph goes on to Runtime.restore unshared)
      const decoded=decodeSnapshot(s.mars);
      {const ep=(decoded as any).world?.entityPhysicsV1;if(ep)registerAssets(ep.assets);}
      const rt = m.Runtime.restore(s.mars, (s as {groundV1?:boolean}).groundV1 ? groundRegistry(registry) : registry, services(base), m.invariants, decoded);
      if(cfg.scene==='eden-commons'&&(rt.world.base.campus!=='eden-commons'||rt.world.base.staticHash!==base.base.staticHash))throw new Error('snapshot commons physical base differs from the native factory');
      const engine = new MarsEngine(m, rt, s.cfg ?? cfg, { programs: s.programs, nextProg: s.nextProg, leaving: s.leaving,renderPlatformsV1:s.renderPlatformsV1 });
      if (s.quiet) engine.beginQuiet();
      return engine;
    },
  };
}

/** Explicit reader for a logged Greenfield -> commons physical checkpoint.
 * Genesis stays Greenfield. A newly constructed commons world is not a replay
 * substitute; only its validated checkpoint can enter this history reader. */
export async function marsCommonsTransitionFactory(cfg:MarsWorldConfig=GREEN_FIELD_WORLD,options?:{safeArrivalV1?:boolean}):Promise<EngineFactory> {
  if(cfg.scene!=='greenfield')throw new Error('commons-transition.factory-origin');
  const target=options?.safeArrivalV1?{commonsArrivalV1:true,safeArrivalV1:true}:{};
  const old=await marsFactory({...cfg,commonsTransitionV1:true,...(options?.safeArrivalV1?{commonsArrivalV1:true}:{})}),
    next=await marsFactory({...cfg,...EDEN_COMMONS_WORLD,commonsTransitionV1:true,...target});
  const allowed=(v:string)=>v===old.rulesVersion||v===next.rulesVersion;
  return {rulesVersion:old.rulesVersion,canReplayHistory:allowed,canRestoreSnapshot:allowed,
    genesis:old.genesis,
    create(world){if(hashOf(world.base)!==hashOf(old.genesis('base').base))throw new Error('commons-transition.genesis-base');return old.create(world);},
    restore(snapshot){
      const s=structuredClone(snapshot) as EngineSnapshot&{cfg:MarsWorldConfig;mars:any};
      const scene=s.cfg?.scene;
      if(scene!=='greenfield'&&scene!=='eden-commons')throw new Error('commons-transition.snapshot-origin');
      if(scene==='eden-commons'&&!s.cfg.commonsTransitionV1)throw new Error('commons-transition.snapshot-without-reader');
      const expected=(scene==='greenfield'?old:next).genesis('base').base;
      if(hashOf(decodeSnapshot(s.mars).world.base)!==hashOf(expected))throw new Error('commons-transition.snapshot-base');
      s.cfg.commonsTransitionV1=true;
      if(options?.safeArrivalV1)s.cfg.commonsArrivalV1=true;
      return (scene==='greenfield'?old:next).restore(s);
    },
    validateHistoryHead(engine,recorded){if(engine.rulesVersion!==recorded)throw new Error('commons-transition.history-head-differs');},
  };
}

/** Fixture ids ordered by 32 m cell (z, then x), then id: the walk audits' seat/bed sweeps read neighbouring seats together. */
export function spatialFixtureIdsV1(entities:Record<string,any>):string[]{
  const cell=(v:number)=>Math.floor(v/32),ids=Object.keys(entities).filter(id=>entities[id].kind==='fixture');
  const k=new Map(ids.map(id=>{const p=entities[id].pose.p;return [id,[cell(p[2]),cell(p[0])]] as const;}));
  return ids.sort((a,b)=>{const x=k.get(a)!,y=k.get(b)!;return x[0]-y[0]||x[1]-y[1]||(a<b?-1:a>b?1:0);});
}
