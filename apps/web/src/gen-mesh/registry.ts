// Mesh halves of generators: one id → one builder. Files named `*.mesh.ts` anywhere under
// gen-mesh/ register themselves (Vite glob), so lanes add files without touching this one.
// Owner: L1. Spec <eden4>/33 §4.3.
import type * as THREE from 'three';
import type { Baked, Value } from '@souls/generators';
import type { Entity, StoredDef, WorldModel } from '@souls/world-compiler';
import type { MaterialLib } from './materials.ts';
import { applyLook, lookKey } from './vocab-look.ts';

export type MeshCtx = {
  /** Immutable architectural capture: no implicit camera-dependent roof/storey cuts. */
  canonicalContext?: boolean;
  def: StoredDef;
  entity: Entity;
  /** Instance params with generator and def defaults filled. */
  params: Record<string, Value>;
  /** Def-level `make.args`. */
  args: Record<string, unknown>;
  baked: Baked;
  model: WorldModel;
  materials: MaterialLib;
  /** Colour for a tint key: instance param → def palette → fallback. */
  tint(key: string | undefined, fallback: string): string;
};

export type MeshBuilder = {
  /** Generator id (e.g. 'kit/2'), or `tag:<name>` to match defs by tag before the generator (flags, signs). */
  gen: string;
  /** Build the picture in the entity's local frame (origin at its base, +z front). Null = nothing to draw. */
  build(ctx: MeshCtx): THREE.Object3D | null;
  /** Entities with the same key share geometry/materials and may be instanced (L1). Null = unique. */
  instanceKey?(ctx: MeshCtx): string | null;
  /** True if the builder places things in world coordinates (path/area forms that drape on terrain). */
  world?: boolean;
};

const builders = new Map<string, MeshBuilder>();
export function registerMesh(b: MeshBuilder) { builders.set(b.gen, b); }
export function meshFor(def: StoredDef): MeshBuilder | undefined {
  // tag builders (creature, flag, sign-text) draw generated shapes; a stored model is always drawn by `mesh`
  if (def.make.kind !== 'mesh') for (const t of def.tags) { const byTag = builders.get(`tag:${t}`); if (byTag) return looked(byTag); }
  const b = def.make.kind === 'gen' ? builders.get(def.make.gen) : def.make.kind === 'mesh' ? builders.get('mesh') : undefined;
  return b && looked(b);
}
/** VOCAB-MECH: every builder gets the catalogue's look conventions (stretch, warp, paint, wear, state roles; vocab-look.ts).
 *  An instance with a look is never merged into the plain instances' InstancedMesh. */
const wrapped = new WeakMap<MeshBuilder, MeshBuilder>();
function looked(b: MeshBuilder): MeshBuilder {
  if (b.world) return b;
  let w = wrapped.get(b);
  if (!w) {
    w = { ...b, build: (ctx) => applyLook(b.build(ctx), ctx), instanceKey: b.instanceKey ? (ctx) => (lookKey(ctx) ? null : b.instanceKey!(ctx)) : undefined };
    wrapped.set(b, w);
  }
  return w;
}
export function registeredMeshes() { return [...builders.keys()].sort(); }

