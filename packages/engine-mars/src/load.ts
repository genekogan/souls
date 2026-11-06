// The hard-forked engine lives inside this repository and is required in CI and deployment.
import {bodyMotionAction} from './body-motion-action.ts';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const marsDir = () => fileURLToPath(new URL('../../../mars/viewer/engine', import.meta.url));
export const marsAvailable = () => existsSync(join(marsDir(), 'runtime/runtime.ts'));

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The parts of the Mars engine the adapter uses. Typed loosely on purpose: the Mars types stay in Mars. */
export type Mars = {
  Runtime: any;
  makeWay: (rt:any, actor:string, clear:[number,number])=>void;
  admitFloaters: (verb:string,params:any,body:(id:string)=>any)=>any;
  TakeRecorder: any;
  finalStateOf: (world: any) => { hash: string };
  compactRuntime: (rt: any, services: (world: any) => any) => any;
  compactionIssue: (rt: any) => string | null;
  nonResumableReason: (def: any) => string | null;
  canonicalEntityOrder: (w: any) => any;
  rulesVersion: string;
  createRegistry: (extra?: any[]) => Map<string, any>;
  servicesFor: (scenes: Record<string, any>) => (world: any) => Record<string, any>;
  invariants: any[];
  describeVerbs: (registry: Map<string, any>) => { verb: string; description: string; inputSchema: Record<string, unknown> }[];
  scenes: Record<string, any>;
  provingGroundWorld: () => any;
  /** One of Mars's own authored scenarios (a table, a pot of stew, four people, four chairs round a fire) and its per-person steps. */
  edenCampWorld: (seed?: string) => any;
  littleMartiansWorld: (seed?: string) => any;
  greenFieldWorld: (seed?: string) => any;
  edenCommonsWorld: (seed?: string) => any;
  commonsLayout: any;
  littleMartiansRender: any;
  campActivities: () => any[];
  bindCampActivity: (activity: any, roles: Record<string,string>) => any;
  bindCampChess: (world: any, white: string, black: string) => void;
  mealWorld: () => any;
  mealSteps: () => Record<string, { verb: string; params: Record<string, unknown>; until?: string }[]>;
  human: (id: string, x: number, z: number, opts?: Record<string, unknown>) => any;
  seedRng: (seed: string) => [number, number, number, number];
  nextRandom: (st: [number, number, number, number]) => number;
  /** carrier/1: advance every carrier one tick (before the runtime steps), and the carrier entity factory. */
  stepCarriers: (rt: any, table?: any) => void;
  /** entry 35: finish letting go and let go of a pair that is no longer one (before the runtime steps; no holds: no effect). */
  stepHandHolds: (rt: any) => void;
  carrierEntity: (spec: any, tick: number) => any;
};

export async function loadMars(): Promise<Mars> {
  if (!marsAvailable()) throw new Error(`Mars engine not found at ${marsDir()} (vendored engine required)`);
  const at = (f: string) => import(pathToFileURL(join(marsDir(), f)).href);
  const [rt, reg, seeds, fac, rng, meal, recorder, snapshot, compact, camp, hashes, lm, field, bodies, walk, commons] = await Promise.all([at('runtime/runtime.ts'), at('api/registry.ts'), at('api/seeds.ts'), at('world/factory.ts'), at('core/rng.ts'), at('scenarios/meal.ts'), at('take/recorder.ts'), at('runtime/snapshot.ts'), at('runtime/compact.ts'), at('scenarios/eden-camp.ts'), at('core/hash.ts'), at('scenarios/littlemartians.ts'), at('scenarios/greenfield.ts'),at('bodies/policy.ts'),at('locomotion/walk.ts'),at('scenarios/eden-commons.ts')]);
  const carrier = await at('vehicles/carrier.ts');
  const edits = await at('spatial/edits.ts');
  const pose = await at('social/pose.ts');
  const handHold = await at('social/hand-hold.ts');
  // The server uses the identical UTF-8 SHA-256 digest in native code. The
  // browser/Worker engine retains its portable default and the same addresses.
  hashes.setSha256Provider((text: string) => createHash('sha256').update(text, 'utf8').digest('hex'),
    () => streamOf(createHash('sha256')));
  // Preserve the original proving-ground fixtures as a western annex during additive adoption.
  const campScene = structuredClone(camp.EDEN_CAMP_SCENE);
  campScene.bounds = [-30,-30,30,30]; campScene.surfaces[0].obb.half = [30,30];
  const campWorld = (seed?: string) => { const w = camp.edenCampWorld(seed); w.base.staticHash = hashes.hashOf(campScene); return w; };
  return {
    Runtime: rt.Runtime, makeWay:walk.makeWay, admitFloaters:bodies.admitFloaters, compactRuntime: compact.compactRuntime, compactionIssue: compact.compactionIssue, TakeRecorder: recorder.TakeRecorder, finalStateOf: recorder.finalStateOf, nonResumableReason: snapshot.nonResumableReason, canonicalEntityOrder: rt.canonicalEntityOrder, rulesVersion: reg.ENGINE_RULES_VERSION, createRegistry: (extra: any[] = []) => reg.createRegistry([...carrier.CARRIER_ACTIONS, pose.poseV1, bodyMotionAction, ...extra]), stepCarriers: carrier.stepCarriers, stepHandHolds: handHold.stepHandHolds, carrierEntity: carrier.carrierEntity, servicesFor: entityPhysicsServices(reg.servicesFor, edits.entityPhysicsContribution),
    littleMartiansWorld: lm.littleMartiansWorld, greenFieldWorld:field.greenFieldWorld,edenCommonsWorld:commons.edenCommonsWorld,commonsLayout:commons.COMMONS_LAYOUT,littleMartiansRender:lm.LITTLE_MARTIANS_RENDER,
    invariants: [...reg.ENGINE_INVARIANTS, carrier.carrierInvariant], describeVerbs: reg.describeVerbs, scenes: {...seeds.ENGINE_SCENES, [camp.EDEN_CAMP_CAMPUS]: campScene,littlemartians:lm.LITTLE_MARTIANS_SCENE,greenfield:field.GREEN_FIELD_SCENE,'eden-commons':commons.EDEN_COMMONS_SCENE}, edenCampWorld: campWorld, campActivities: camp.edenCampActivities, bindCampActivity: camp.bindCampActivity, bindCampChess: camp.bindCampChess, provingGroundWorld: seeds.provingGroundWorld, human: fac.human, seedRng: rng.seedRng, nextRandom: rng.nextRandom, mealWorld: meal.mealWorld, mealSteps: meal.mealSteps,
  };
}

/** entity-physics/1 (lane L9): every Spatial of a world reads its world-edit floors, solids and links as a scene
 * contribution (empty in every authored world, so they are unchanged). */
function entityPhysicsServices(servicesFor: Mars['servicesFor'], contribution: (world: any) => any): Mars['servicesFor'] {
  return (scenes) => { const make = servicesFor(scenes); return (world) => { const s = make(world); if (s.spatial) s.spatial.contributors = [...(s.spatial.contributors ?? []), contribution]; return s; }; };
}

/** The native digest as hash.ts's Sha256Stream; `copy` forks its state (S1 V7b: take final-state hashes resume). */
type NativeStream = { update(piece: string): void; digest(): string; copy(): NativeStream };
function streamOf(h: ReturnType<typeof createHash>): NativeStream {
  return { update: (piece) => { h.update(piece, 'utf8'); }, digest: () => h.digest('hex'), copy: () => streamOf(h.copy()) };
}
