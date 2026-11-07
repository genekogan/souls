// animals/1 mesh half: a herd living in an area. Owner: L4. Each member is a kit creature (the
// species def from the world, else the bundled core kit) with its own home inside the area and
// the same deterministic behaviour as a single creature entity. Water areas make swimmers.
// The herd ticks itself while any member is on screen (world builders get no per-frame call).
import * as THREE from 'three';
import { scatterPoints, type Value } from '@souls/generators';
import { defSchema, type DefInput, type StoredDef, type WorldModel } from '@souls/world-compiler';
import { registerMesh, type MeshCtx } from './registry.ts';
import { creatureObject } from './creatures/creature.mesh.ts';
import { seedOf, type BehaviorKind } from './creatures/behavior.ts';
import { bindMotionModel, creatureStep, waterAt, worldSeconds, type Rig } from './motion.ts';

const bundled = new Map<string, StoredDef>();
let markerMaterial: THREE.MeshBasicMaterial | undefined;
// lane PERF2: the core kit's family defs (~1.4 MB; every creature is one) are fetched only when a herd's species is missing
// from its world (worlds carry their core defs), as their own chunk, instead of riding in the main web bundle.
let CORE_KIT: DefInput[] | null = null, kitLoad: Promise<unknown> | null = null;
const loadKit = () => (kitLoad ??= import('@souls/world-compiler/family-kits').then((m) => { CORE_KIT = m.FAMILY_KITS; }, () => { kitLoad = null; }));
/** A core creature def by species, from the world model if present, else from the core kit (once loaded; see loadKit). */
export function speciesDef(model: WorldModel, ref: string): StoredDef | undefined {
  const inWorld = model.resolvedDef(ref) ?? model.resolvedDef(`core/${ref}@1`);
  if (inWorld) return inWorld;
  const name = ref.startsWith('core/') ? `core-${ref.slice(5).replace(/@\d+$/, '')}` : `core-${ref}`;
  let d = bundled.get(name);
  if (!d) {
    const input = CORE_KIT?.find((x) => x.name === name); if (!input) return undefined;
    d = { ...defSchema.parse(input), hash: `bundled-${name}`, ref: `${name}@1`, by: 'core', born: 0, budget: { tris: 0, bytes: 0, textures: 0 } } as StoredDef;
    bundled.set(name, d);
  }
  return d;
}

registerMesh({
  gen: 'animals/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    bindMotionModel(ctx.model);
    const p = ctx.params;
    const ref = typeof p.def === 'string' && p.def ? p.def : String(p.species ?? 'dog');
    const def = speciesDef(ctx.model, ref);
    if (!def) {
      if (CORE_KIT) return null;
      // not in the world: draw the herd once the core kit chunk is in
      const later = new THREE.Group(); later.name = `herd ${e.name ?? e.id} (loading)`;
      loadKit().then(() => { const d = speciesDef(ctx.model, ref); const herd = d && herdOf(ctx, d); if (herd) later.add(herd); });
      return later;
    }
    return herdOf(ctx, def);
  },
});

function herdOf(ctx: MeshCtx, def: StoredDef): THREE.Group {
    const e = ctx.entity, area = (e.shape as { area: [number, number][] }).area, p = ctx.params, count = Math.max(1, Math.min(60, Number(p.count ?? 3)));
    const seed = e.seed ?? seedOf(e.id);
    const homes = scatterPoints(area, 1, 0.8, seed, count);
    // a herd on water swims; koi and fish always do
    const [cx, cz] = homes[0] ?? area[0], g = ctx.model.terrain.sample(cx, cz), wl = waterAt(ctx.model, cx, cz);
    const wet = (wl !== null && wl > g + 0.2) || /koi|fish/.test(def.name);
    const kind = (wet ? 'swim' : String(p.behavior ?? 'wander')) as BehaviorKind;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of area) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const radius = Math.max(2, Math.min(20, 0.45 * Math.min(x1 - x0, z1 - z0)));
    const scale = Number(p.scale ?? 1), speed = Number(p.speed ?? 1) * (def.components.behavior?.speed ?? 1);
    const tint = (k: string | undefined, f: string) => (k ? (typeof (p as Record<string, Value>)[k] === 'string' && /^#/.test(String(p[k])) ? String(p[k]) : def.palette?.[k] ?? f) : f);
    const group = new THREE.Group(); group.name = `herd ${e.name ?? e.id}`;
    const members: { obj: THREE.Object3D; rig: Rig; home: [number, number] }[] = [];
    homes.slice(0, count).forEach(([x, z], i) => {
      const made = creatureObject(def, {}, tint, ctx.materials, ctx.model, (seed + i * 7919) >>> 0, { kind, speed, radius });
      if (!made) return;
      made.rig.area = area; made.rig.scale = scale * (0.85 + 0.3 * ((i * 0.618) % 1));
      made.obj.scale.setScalar(made.rig.scale);
      made.obj.position.set(x, ctx.model.terrain.sample(x, z), z);
      group.add(made.obj); members.push({ obj: made.obj, rig: made.rig, home: [x, z] });
    });
    let last = -1;
    const tick = (tIn: number) => {
      const t = worldSeconds(tIn); if (t === last) return; last = t;
      for (const m of members) { m.obj.scale.setScalar(m.rig.scale!); creatureStep(m.obj, m.rig, null, t, { y: 0, yaw: 0 }, m.home); }
    };
    group.userData.tick = tick;
    // world builders get no per-frame call from the layer: tick from a never-culled, empty marker mesh
    // (drawn as nothing; its onBeforeRender runs every frame whether or not the herd is on screen)
    const marker = new THREE.Mesh(new THREE.BufferGeometry(), markerMaterial ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    marker.frustumCulled = false; marker.name = 'herd-ticker'; marker.onBeforeRender = () => tick(Date.now() / 1000);
    group.add(marker);
    tick(Date.now() / 1000);
    return group;
}
