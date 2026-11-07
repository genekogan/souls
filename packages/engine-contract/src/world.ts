// World state shape, mirroring Mars viewer/engine/world/types.ts (mars-world/1)
// so the real engine's state can later flow through the same wrapper.
import type { RngState } from './rng.ts';

export type Vec3 = [number, number, number];
export type Pose = { p: Vec3; yaw: number; pitch?: number; roll?: number };
export type Confidence = 'documented' | 'participant' | 'inferred' | 'provisional' | 'hypothetical';
export type Provenance = {
  origin: 'canonical' | 'reconstruction-edit' | 'design-edit' | 'simulation' | 'test-fixture';
  confidence: Confidence;
  evidence?: string[];
  note?: string;
};
export type EntityKind = 'human' | 'component' | 'vehicle' | 'fixture' | 'marker';

export type HumanState = {
  bodyMotionV1?: import('../../../mars/viewer/engine/bodies/motion.ts').BodyMotionState;
  activity: string; // 'idle' | 'walk' | 'sit' | 'converse' | 'wave' | 'rest' ...
  task?: string; // owning action id
  level: number;
  on?: string; // fixture id when seated
  speed?: number;
  /** Extension (not in Mars): the Soul id that owns this human, if any. */
  soul?: string;
};

export type Entity = {
  id: string;
  def: string;
  kind: EntityKind;
  label?: string;
  tags?: string[];
  pose: Pose;
  provenance: Provenance;
  human?: HumanState;
  body?: {family:'humanoid'|'floater';type?:'humanoid'|'ceramic'|'floater'|'creature';model?:string;modelUrl?:string;
    avatar?:{kind:'body';modelUrl:string;bodyType:'humanoid'|'ceramic'|'floater'};radius?:number;hoverHeight?:number;
    /** core/humanoid@2 look params (compact), with model = the look key (engine bodies/humanoid.ts). */
    actionProfile?:import('../../../mars/viewer/engine/bodies/action-profile.ts').ActionProfile;params?:Record<string,string|number>;motion?:import('../../../mars/viewer/engine/bodies/motion.ts').BodyMotion};
  reservedBy?: string;
  /** Fixture capacity for seats/gathering (toy extension). */
  seats?: number;
};

export type Region = {
  id: string;
  label: string;
  kind: 'place' | 'staging' | 'material-pile' | 'work-area' | 'walkable' | 'no-go';
  polygon: [number, number][]; // (x, z), CCW
  level?: number;
  provenance: Provenance;
};

export type BaseRef = { campus: string; staticHash: string };
export type Environment = {
  datetime: string; // ISO local
  weather: { clouds: number; rain: number; wind: number; dust: number; wet: number };
};

export type WorldState = {
  /** Explicit prospective office guard prisms; absent on all earlier worlds. */
  officeStairGuardsV1?:import('./office-stair-guards-v1.ts').OfficeStairGuardsV1;
  /** #1150 rung 3: rule breaks the world could not repair, kept visible. Each is counted once and leaves when it stops firing. */
  containedV1?:{code:string;subjects:string[]}[];
  authoredBoundariesV1?:import('./authored-boundaries-v1.ts').AuthoredBoundariesV1;
  schema: string;
  base: BaseRef;
  tick: number;
  entities: Record<string, Entity>;
  regions: Record<string, Region>;
  env: Environment;
  inventory: 'finite' | 'unlimited';
  rng: RngState;
};

/** The physical view drops labels, tags, provenance, tick and env (Mars physicalView). */
export function physicalView(w: WorldState) {
  const entities: Record<string, unknown> = {};
  for (const id of Object.keys(w.entities).sort()) {
    const { label: _l, tags: _t, provenance: _p, ...rest } = w.entities[id];
    entities[id] = rest;
  }
  const regions = Object.keys(w.regions)
    .sort()
    .map((id) => {
      const r = w.regions[id];
      return [id, r.kind, r.polygon, r.level ?? 0];
    });
  return { base: w.base, entities, regions, inventory: w.inventory, rng: w.rng };
}

export const canonicalEntityOrder = (w: WorldState) => Object.keys(w.entities).sort();
