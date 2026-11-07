// Kit creatures (defs tagged `creature`): the kit/2 picture plus a rig of role pivots that
// motion.ts animates (gait + behaviour), with the world model bound for terrain, water and
// solids. Owner: L4. Geometry is shared per (def, palette); each instance has its own pivots.
import type * as THREE from 'three';
import { kitArgs, type Value } from '@souls/generators';
import type { StoredDef, WorldModel } from '@souls/world-compiler';
import { buildKit } from '../kit.mesh.ts';
import { registerMesh, type MeshCtx } from '../registry.ts';
import { bindMotionModel, makeRig, type Gait, type Rig } from '../motion.ts';
import { seedOf } from './behavior.ts';
import type { BehaviorKind } from './behavior.ts';

const cache = new Map<string, THREE.Object3D>();
const SPECIES = /^core-([a-z]+)$/;

/** A creature object (shared geometry, own pivots) and its rig, for single entities and herds. */
export function creatureObject(def: StoredDef, params: Record<string, Value>, tint: (k: string | undefined, f: string) => string, materials: MeshCtx['materials'], model: WorldModel | null, seed: number, opts: { kind?: BehaviorKind; speed?: number; radius?: number; follow?: string } = {}): { obj: THREE.Object3D; rig: Rig } | null {
  if (def.make.kind !== 'gen' || def.make.gen !== 'kit/2') return null;
  const parsed = kitArgs.safeParse(def.make.args); if (!parsed.success) return null;
  // K2 hook: numeric $params alter kit geometry as well as its palette.
  const colours = Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'number' || typeof v === 'string' && /^#/.test(v)).sort(([a], [b]) => a.localeCompare(b)));
  const key = def.hash + ':' + JSON.stringify(colours);
  let proto = cache.get(key);
  if (!proto) { proto = buildKit(parsed.data, { materials, tint, params }); cache.set(key, proto); }
  const obj = proto.clone(true);
  const b = def.components.behavior;
  const str = (k: string) => (typeof params[k] === 'string' && params[k] ? (params[k] as string) : undefined);
  const num = (k: string) => (typeof params[k] === 'number' ? (params[k] as number) : undefined);
  const rig = makeRig(obj, {
    gait: (parsed.data.gait ?? 'none') as Gait,
    kind: (opts.kind ?? (str('behavior') as BehaviorKind | undefined) ?? b?.kind ?? 'idle'),
    speed: opts.speed ?? num('speed') ?? b?.speed ?? 1,
    radius: opts.radius ?? num('radius') ?? b?.radius ?? 6,
    follow: opts.follow ?? str('follow') ?? b?.ref,
    flee: num('flee') ?? b?.flee,
    seed, model, species: SPECIES.exec(def.name)?.[1],
    box: def.size.box as [number, number, number],
  });
  obj.userData = { ...proto.userData, rig };
  return { obj, rig };
}

registerMesh({
  gen: 'tag:creature',
  build(ctx) {
    bindMotionModel(ctx.model);
    const made = creatureObject(ctx.def, ctx.params, ctx.tint, ctx.materials, ctx.model, ctx.entity.seed ?? seedOf(ctx.entity.id));
    return made?.obj ?? null;
  },
  instanceKey(ctx) { return ctx.def.hash + ':' + JSON.stringify(ctx.params); }, // K2: keep differing program dimensions separate.
});
