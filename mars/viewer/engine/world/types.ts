import type { Obstacle } from '../spatial/types.ts';
// Semantic world model (spec §5, §21). Three layers are kept distinct:
//   AssetDef   — reusable description of a kind of thing (catalog.ts)
//   Entity     — a placement in one world state, with provenance
//   SimState   — transient operational state during a run (held, supported…)
// A WorldState is plain JSON: it can be hashed, checkpointed, forked, sent to
// a Durable Object and replayed without any rendering objects.
import type { Vec3 } from '../core/math.ts';
import type { RngState } from '../core/rng.ts';

export const WORLD_SCHEMA = 'mars-world/1';

/** Rotation: yaw about +Y, then pitch about local X, then roll about local Z (radians). */
export type Pose = { p: Vec3; yaw: number; pitch?: number; roll?: number };

export type Confidence = 'documented' | 'participant' | 'inferred' | 'provisional' | 'hypothetical';

/** Epistemic status is independent of dimensional precision (spec §4). */
export type Provenance = {
  /** How this placement came to exist in this state. */
  origin: 'canonical' | 'reconstruction-edit' | 'design-edit' | 'simulation' | 'test-fixture';
  confidence: Confidence;
  evidence?: string[];
  note?: string;
};

export type EntityKind = 'human' | 'component' | 'vehicle' | 'fixture' | 'marker';

/** How an entity is currently held up. `none` is only legal transiently and is a violation at tick end. */
export type Support =
  | { kind: 'ground' }
  | { kind: 'resting-on'; on: string; slot?: string } // slot: a table surfaceSlot id, or 'lap' (engine/items)
  | { kind: 'held'; by: string[] }
  | { kind: 'in-hand'; by: string; hand: 'left' | 'right'; /** entry 41: item yaw − holder yaw kept from a hand-over (absent: 0) */ turn?: number } // a small item in one person's hand (engine/items)
  | { kind: 'connected'; to: string[] }
  | { kind: 'forks'; vehicle: string }
  | { kind: 'ridden-by'; by: string } // a vehicle under its rider (engine/vehicles)
  | { kind: 'none' };

export type Connection = { socket: string; to: string; toSocket: string };

export type ComponentPhase =
  | 'stored' // in a pile/stock, stacked
  | 'reserved'
  | 'carried'
  | 'staged' // lying at a work area
  | 'raising'
  | 'placed' // in final pose, possibly still needing support
  | 'installed'; // connected and self-supporting under the assembly rules

export type HumanState = {
  bodyMotionV1?: import('../bodies/motion.ts').BodyMotionState;
  /** Opt-in stopped-dock boarding and finite boat passenger frame. */
  boatPassenger?: { boatId: string; slotId: string; phase: 'boarding' | 'seated' | 'leaving'; localRoot: Vec3; relativeYaw: number };
  boatTransit?: { from: Vec3; to: Vec3; t: number; supportId: string };
  /** carrier/1 (vehicles/carrier.ts): this body is boarding, seated in or leaving a carrier's seat; the carrier supports it. */
  carrier?: { id: string; slot: string; phase: 'boarding' | 'seated' | 'leaving'; outBy?: number };
  /** Opt-in shore/1 controller: metres, upright-capsule immersion length (not
   * body-volume fraction), centre bed normal and prescribed calm buoyancy. */
  shore?: {
    contract: 'shore-contact/1'; terrainId: string; waterId: string;
    mode: 'bed' | 'buoyant'; bedY: number; datumY: number;
    depthMetres: number; submergedHeightMetres: number; normal: Vec3;
  };
  handActuator?: import('../social/hand-actuator.ts').HandActuatorMotion;
  /** Soul Actions 34: one recorded watering-can stage (fill at a tap, pour on a planter); never controller context. */
  wateringV1?: import('../items/watering.ts').WateringMotion;
  /** Soul Actions 34: a handle-held item being taken or put by hand (the arm blends in and out on this timeline). */
  handTransferV1?: import('../items/watering.ts').HandTransfer;
  /** #441 (W107): the juggling run on this body (items/juggle.ts); stays after it ended for the receipt's count. */
  juggleV1?: import('../items/juggle.ts').JuggleV1;
  /** Soul Actions 43: the last let-go before a reach (an idle gesture fades out on it); never controller context. */
  letGoV1?: import('../items/let-go.ts').LetGoV1;
  /** Soul Actions 44: one recorded mug stage (drinking in sips, rinsing at a tap); never controller context. */
  cupV1?: import('../items/cup.ts').CupMotion;
  activity: string; // 'idle' | 'walk' | 'carry' | 'support' | 'climb' | 'sit' | ...
  task?: string; // action id currently owning this actor
  grip?: { entity: string; slot: string };
  riding?: string; // vehicle id while mounted (engine/vehicles)
  level: number; // walkable level index (0 = ground)
  /** Id of the rack-structure link (construction/frame.ts: `beam:<id>` / `climb:<…>`) the person stands on, if any. */
  on?: string;
  /**
   * Hand points (world frame, metres), published every tick by engine/items while the person holds a
   * small item or an items verb drives a hand (reach, serve, eat); a hand without a point is free /
   * at rest. Absent when neither hand is published. ITEMS.md "Hand points".
   */
  hands?: { left?: Vec3; right?: Vec3 };
  /** Only opted-in world items; bounded to the two actual occupied hands. */
  heldItemsV1?: { left?: string; right?: string };
  itemTransferV1?: import('../items/presentation.ts').ItemTransferV1;
  /** While an overlay activity (`eat`) runs: the activity it is layered on ('sit' = seated, 'talk', 'idle'…). */
  baseActivity?: string;
  /**
   * Ground speed (m/s, horizontal, rounded to mm/s) over the last tick, published by walk_to while it
   * owns the person (absent otherwise). Renderers key the Walk clip on it: activity 'walk' is set only
   * when speed ≥ 0.08 (locomotion/walk.ts WALK_MIN), a blocked walker is 'wait' with speed 0.
   */
  speed?: number;
  /** Server-computed head attention target, recorded rather than decided by a viewer. */
  attention?: [number, number];
  /** attention/1 (logged 'edge-attention'): the Soul's own gaze — a body/fixture to track or a point — until a tick; it wins
   *  over the activity-derived `attention` while it lasts. Never moves or interrupts the body. */
  gaze?: { kind: string; target?: string; at?: [number, number]; until?: number };
  /**
   * Prone receiver only (construction/handup.ts, HANDUP.md "Prone receiver"): progress 0–1 within the current hand-up
   * phase (lie-down, then each receiver phase), every tick from lie-down to the release; absent otherwise.
   */
  phaseK?: number;
  carryContactV1?: import('../carry/contact.ts').CarryContact;
  /**
   * Prone receiver only: world yaw of the lying body's axis (S → head, through the grip), from lie-down through
   * kneel-up; `pose.yaw` keeps facing straight out over the edge (the lip PRONE_BACK ahead of `pose.p` along it).
   */
  proneYaw?: number;
  /** Ground-mat sleep only: semantic progress, independent of renderer rig coordinates. */
  sleepPose?: { mat: string; standingFraction: number };
  /** activities/1 (social/pose.ts, ACTIVITIES-v1): a small object in the hands while a pose activity runs (book, brush…). */
  prop?: string;
  /** activities/1: seat top (m above the feet) while seated at a scenery spot with no native seat fixture (piano bench, armchair). */
  seatHeight?: number;
  /** beds/1 (social/actions.ts take_slot): the berth slot (`<bed>#<slot>`) this body lies on; `seatHeight` is its mattress top. */
  berth?: string;
  /** together/1 (social/pose.ts): the small item carried in the hand between activities (book, flower, cup…); shown as `prop`. */
  holding?: string;
  /** together/1: the body this one is doing a paired gesture with (hug, handshake, high-five, give/take, dance together). */
  partner?: string;
  /** together/1: a grouped pose — waiting for partners or running in sync until the shared end tick. */
  together?: { group: string; phase: 'waiting' | 'active'; until?: number; mobile: boolean; pairedPolicy?: 'ready-v1'; readyAt?: number; windowPolicy?: 'once-v1'; late?: true };
  /** CN5 (social/pose.ts): the instrument a play-music body plays. */
  instrument?: string;
  /** CN5 (social/pose.ts): a choreographed game's public turn state (who throws to whom and when). */
  game?: import('../social/pose.ts').GameState;
  /** entry 35 (social/hand-hold.ts): holding hands with another body (offered, joined, letting go). */
  handHold?: import('../social/hand-hold.ts').HandHoldState;
  /** entry 35 (social/rps.ts): a rock-paper-scissors count's shared start and shoot ticks; the shape from the shoot only. */
  rps?: import('../social/rps.ts').RpsState;
};

/** Persistent committed quantities for one bounded cold preparation batch. */
export type FoodPreparation = {
  kind: 'cold-two-ingredient-v1';
  ingredients: [
    { item: string; food: string; initial: number; deposited: number },
    { item: string; food: string; initial: number; deposited: number },
  ];
  mixedTicks: number;
  complete: boolean;
};

/**
 * Body family of a person-like entity (engine/bodies). Absent = 'humanoid' (every existing human), so
 * worlds, takes and hashes without the field are unchanged. A 'floater' is a static scanned head that
 * hovers at `hoverHeight` above its ground pose with radius `radius`; `model` names its GLB.
 */
export type Body = { family: 'humanoid' | 'floater'; type?: 'humanoid' | 'ceramic' | 'floater' | 'creature'; model?: string; modelUrl?: string;
  avatar?: {kind:'body'; modelUrl:string; bodyType:'humanoid'|'ceramic'|'floater'}; radius?: number; hoverHeight?: number;
  /** core/humanoid@2 look params (compact), with `model` = the look key `humanoid2-<sha16>`. Height, build and walkSpeed
   *  are physical (bodies/humanoid.ts: radius, eye height, seat fit, walking speed); the rest is paint. */
  actionProfile?: import('../bodies/action-profile.ts').ActionProfile; params?: Record<string, string | number>; motion?: import('../bodies/motion.ts').BodyMotion };

export type Entity = {
  /** carrier/1 (vehicles/carrier.ts): a ride with seats that carries its riders along a deterministic route. */
  carrier?: import('../vehicles/carrier.ts').CarrierState;
  /** Native keel-base frame; authored proposal frame is .4m above it. */
  boat?: {
    contract: 'boat-state/1'; waterId: string; frameOffsetY: number;
    dockId: string | null; connectorOpen: boolean;
    phase: 'docked' | 'underway' | 'stopped'; speed: number;
    passengers: Record<string, string>; pilotIds: string[];
  };
  id: string;
  def: string; // AssetDef id
  kind: EntityKind;
  label?: string;
  tags?: string[];
  pose: Pose;
  provenance: Provenance;
  /** Components */
  phase?: ComponentPhase;
  support?: Support;
  /** Fixtures of an entity world: the engine level of the floor it stands on (world-edit/1 FixtureSpecV1.level); absent:
   *  the level nearest its height (social/slots.ts). */
  level?: number;
  connections?: Connection[];
  assembly?: string;
  /** Humans */
  human?: HumanState;
  /** Optional body family (engine/bodies); absent = humanoid. */
  body?: Body;
  /** Owning action while reserved/held. */
  reservedBy?: string;
  /** Containers (bowl, pot…; catalog-items.ts CONTAINERS): what food is in it and how full (0..1). */
  contents?: { food: string; fraction: number };
  /** Partial preparation survives interruption; incomplete contents cannot be served. */
  foodPreparation?: FoodPreparation;
  gardenCare?: import('../objects/garden.ts').GardenState;
  /** Soul Actions 34: a handle-held can rides this much lower in the hand when it is full (m). */
  carryDropV1?: number;
  planting?: import('../objects/planting.ts').PlantingState;
  /** Placed electrical equipment (construction/solar.ts place_equipment, spec §19): kind + configuration. */
  equipment?: { kind: string; config: Record<string, number | string | boolean> };
  /** Paint on a paintable face (engine/work/paint.ts): colour or texture, coverage 0..1 of the face, per reach band. */
  paint?: PaintState;
};

/** Paint progress on a face (engine/work/paint.ts). Heights are metres above the face's bottom edge. */
export type PaintState = {
  face: 'front' | 'back';
  color?: string;
  texture?: string;
  /** Painted fraction of the whole face (area-weighted over its bands), 0..1, rounded to 0.01. */
  coverage: number;
  bands: { from: number; to: number; coverage: number }[];
};

export type Region = {
  id: string;
  label: string;
  kind: 'place' | 'staging' | 'material-pile' | 'work-area' | 'walkable' | 'no-go';
  /** Ground polygon (x, z), counter-clockwise. */
  polygon: [number, number][];
  level?: number;
  /** upper-floors/1: the authored floor number (place data `level`) of a region on a building's upper-floor engine level. */
  placeLevel?: number;
  provenance: Provenance;
};

/** Immutable static geometry the entity layer sits on (canonical baseline or a test fixture). */
export type BaseRef = {
  campus: string; // e.g. 'mars-2026', 'proving-ground'
  /** Content hash of the static collision/walkable description used by the runtime. */
  staticHash: string;
};

export type Environment = {
  /** ISO local date/time at the campus (visual only — independent of sim elapsed time, spec §19). */
  datetime: string;
  weather: { clouds: number; rain: number; wind: number; dust: number; wet: number };
};

export type WorldState = {
  schema: typeof WORLD_SCHEMA;
  base: BaseRef;
  tick: number;
  entities: Record<string, Entity>;
  regions: Record<string, Region>;
  /** Fork-local static obstacle overrides; null removes a source obstacle. Source base stays immutable. */
  obstacleEdits?: Record<string, Obstacle | null>;
  /** nav/1: extra walking ground and solid footprints over the source scene (spatial/edits.ts); absent before its rules fact. */
  navV1?: import('../spatial/edits.ts').NavV1;
  /** Prospective elevated guard prisms; absent before their explicit rules fact. No office floor/traversal grant. */
  officeStairGuardsV1?: import('../../../../packages/engine-contract/src/office-stair-guards-v1.ts').OfficeStairGuardsV1;
  authoredBoundariesV1?: import('../../../../packages/engine-contract/src/authored-boundaries-v1.ts').AuthoredBoundariesV1;
  /** entity-physics/1 (logged `world-edit` events, packages/engine-mars/src/entity-physics.ts): walls, floors, stairs and
   *  doors derived from a god-built entity world, plus the engine asset defs of its fixtures; absent before the first edit. */
  entityPhysicsV1?: import('../spatial/edits.ts').EntityPhysicsV1;
  /** upper-floors/1 (logged rules fact `upperFloorsV1`): buildings' upper floors, stairs and rooms; absent before its fact. */
  upperFloorsV1?: import('../spatial/edits.ts').UpperFloorsV1;
  env: Environment;
  inventory: 'finite' | 'unlimited';
  rng: RngState;
};

/** The portion of state that physical plans depend on (spec §16: camera/env changes must not invalidate plans). */
export function physicalView(w: WorldState) {
  const entities: Record<string, unknown> = {};
  for (const [id, e] of Object.entries(w.entities)) {
    const { label: _l, tags: _t, provenance: _p, ...rest } = e;
    entities[id] = rest;
  }
  // inventory mode and RNG state change what a run produces (finite stock, seeded
  // choices), so a plan rehearsed under one cannot be trusted under another.
  // Deliberately excluded: tick (clock only), env (visual, §19), labels/tags/provenance.
  // A 'place' region's audience `layout` (engine_edit_world, social/slots.ts) decides where gather/take_slot
  // send people, so it is physical (LAST_MILE LM-003); a region without one hashes exactly as before.
  return {
    base: w.base,
    ...(w.obstacleEdits ? { obstacleEdits: w.obstacleEdits } : {}),
    ...(w.navV1 ? { navV1: w.navV1 } : {}),
    ...(w.officeStairGuardsV1 ? { officeStairGuardsV1:w.officeStairGuardsV1 } : {}),
    ...(w.authoredBoundariesV1 ? { authoredBoundariesV1:w.authoredBoundariesV1 } : {}),
    ...(w.entityPhysicsV1 ? { entityPhysicsV1: w.entityPhysicsV1.hash } : {}),
    ...(w.upperFloorsV1 ? { upperFloorsV1: w.upperFloorsV1 } : {}),
    entities,
    regions: Object.values(w.regions).map((r) => {
      const layout = (r as { layout?: unknown }).layout;
      return layout === undefined ? [r.id, r.kind, r.polygon, r.level ?? 0] : [r.id, r.kind, r.polygon, r.level ?? 0, layout];
    }),
    inventory: w.inventory,
    rng: w.rng,
  };
}
