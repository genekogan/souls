// Mesh half of `make: {kind:'mesh'}` defs: the stored GLB by sha, cached and cloned per entity, fitted to
// the def's box (base-centred, uniform scale to size.box height), clips played per frame. Owner: L5.
// Replaces the placeholder box in basic.mesh.ts (this file registers `mesh` after it).
//
// Clips: a def with a moving behaviour (wander/graze/fly/swim/follow) plays `Walk` (Fly/Swim for birds
// and fish) while its entity moves and `Idle` while it stands; anything else with clips plays `Idle`
// (or its only clip). Time is wall-clock seconds so every viewer sees the same phase.
// Motion: a def with a `behavior` component gets L4's creature rig (no role pivots: the GLB's own clips
// move the legs), so motion.ts walks, grazes, flies or swims it like a kit creature.
import * as THREE from 'three';
import { frameHook, instantiate, loadAsset, type ModelInstance } from './gltf-assets.ts';
import { assetShown, deferLoad, isEager, noteDeferred, plannedArrivalEye } from './lazy-assets.ts';
import { registerMesh, type MeshBuilder } from './registry.ts';
import { assetHidden } from '../moderation-hidden.ts';
import { bindMotionModel, makeRig, type Gait } from './motion.ts';
import { seedOf, type BehaviorKind } from './creatures/behavior.ts';
import { adoptInstance, GLB_INSTANCING } from './glb-instances.ts';
import { lookKey } from './vocab-look.ts';
import { trackShadowProxies } from './shadow-proxy.ts';
import { meshLodAsset, type LodMake } from './mesh-lod.ts';
import { variantOf } from './material-variants.ts';

const HIDE_ROOFS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('hideRoofs') && new URLSearchParams(location.search).get('hideRoofs') !== '0';
const MOVING = new Set(['wander', 'graze', 'fly', 'swim', 'follow']);
const hashPhase = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 10000) / 1000; };

const meshBuilder: MeshBuilder = {
  gen: 'mesh',
  build(ctx) {
    const make = ctx.def.make as { kind: 'mesh' } & LodMake;
    const holder = new THREE.Group(); holder.name = `mesh ${ctx.def.name}`;
    const behavior = ctx.def.components.behavior?.kind;
    const phase = hashPhase(ctx.entity.id);
    let inst: ModelInstance | null = null, gone = false;
    const last = new THREE.Vector3(Number.NaN, 0, 0), now = new THREE.Vector3();
    let stillFor = 0;
    const b = ctx.def.components.behavior;
    if (b) {
      bindMotionModel(ctx.model);
      const gait: Gait = b.kind === 'fly' ? 'bird-fly' : b.kind === 'swim' ? 'fish-swim' : 'none';
      holder.userData.rig = makeRig(holder, { gait, kind: b.kind as BehaviorKind, speed: b.speed ?? 1, radius: b.radius ?? 6, follow: b.ref, seed: ctx.entity.seed ?? seedOf(ctx.entity.id), model: ctx.model, species: ctx.def.name.replace(/^core-|-pack$/g, ''), box: ctx.def.size.box as [number, number, number] });
    }
    // lane PERF: the clip hook is added once the model is in and only if it has clips (a static model costs no per-frame
    // hook draw; mars-two had 166 of them)
    const clipHook = () => frameHook(() => {
      if (!inst || !inst.clips.length) return;
      const t = Date.now() / 1000;
      holder.getWorldPosition(now);
      const moved = Number.isFinite(last.x) ? now.distanceToSquared(last) > 1e-6 : false;
      last.copy(now);
      stillFor = moved ? 0 : stillFor + 1;
      const walking = !!behavior && MOVING.has(behavior) && stillFor < 3;   // a few frames of grace across easing jitter
      inst.play(behavior === 'fly' ? 'Fly' : behavior === 'swim' ? 'Swim' : walking ? 'Walk' : 'Idle', t, { phase });
    });
    // Z2: a def with a distant version (make.lod1) keeps one child group per model ('lod0' = the original, 'lod1'); the
    // one for the current distance is visible. A model loads the first time it is wanted; until it is in, the other
    // stays shown. One-model defs add their model straight to the holder, as before.
    const variants = new Map<string, { root: THREE.Object3D; inst?: ModelInstance; failed?: boolean }>();
    let wanted = make.asset, clipHooked = false;
    const show = () => {
      const v = variants.get(wanted); if (!v || (!v.inst && !v.failed)) return;   // keep the shown one until this one is in
      if (v.inst) inst = v.inst;
      for (const [sha, x] of variants) x.root.visible = sha === wanted;
      holder.userData.lodAsset = wanted;
    };
    // VOCAB-MECH: GLBs outside the eager set load when the thing comes near the camera or in the background (lazy-assets.ts)
    const load = (sha: string = make.asset, target: THREE.Object3D = holder) => { return loadAsset(sha).then((gltf) => {
      if (gone) return;
      const loaded = instantiate(gltf, { box: ctx.def.size.box as [number, number, number] });
      const v = variants.get(sha); if (v) v.inst = loaded; else inst = loaded;
      // flat things (rugs, boards, plates a few cm thick) would z-fight with gently uneven ground: draw them
      // a hair towards the camera (the materials are shared per asset, so every copy of it gets the same)
      // (the materials are shared per asset and, merged, across assets: the offset is a shared variant, never a write)
      if (ctx.def.size.box[1] <= 0.06) loaded.object.traverse((o) => { const mesh = o as THREE.Mesh; if (!mesh.isMesh || !mesh.material) return; const lift = (m: THREE.Material) => variantOf(m, 'flat-offset', (x) => { x.polygonOffset = true; x.polygonOffsetFactor = -2; x.polygonOffsetUnits = -4; }); mesh.material = Array.isArray(mesh.material) ? mesh.material.map(lift) : lift(mesh.material); });
      target.add(loaded.object); assetShown(sha); if (v) show();
      trackShadowProxies(loaded.object);   // lane PERF2: its one shadow caster draws only in the shadow pass (shadow-proxy.ts)
      // lane PERF2: repeated static copies (no clips, no roof to hide, no motion rig, no look) share one InstancedMesh per
      // part (glb-instances.ts); the holder (or the model's lod group) stays the anchor the layer eases, carries and removes
      if (GLB_INSTANCING && !loaded.clips.length && !b && !lookKey(ctx) && !loaded.object.getObjectByName('roof')) adoptInstance(sha, target, loaded.object);
      if (loaded.clips.length && !clipHooked) { clipHooked = true; loaded.play('Idle', Date.now() / 1000, { phase }); const hook = clipHook(); hook.userData.animates = true; holder.add(hook); }  // P1: an animated model never freezes (WorldEntityLayer.freeze)
      // a building cut with a `roof` group (the Mars campus pieces): hidden in the roofs-off view (?hideRoofs=1 or the
      // viewer's toggle). PARITY: not when the camera is inside — sim.mars.college keeps every ceiling, and its rooms are
      // in the roofs' shadow (Chiba's whole roof had vanished from the auditorium, the gallery and the diner, which then
      // stood in full sun under the open sky)
      const roof = loaded.object.getObjectByName('roof');
      if (roof) {
        holder.add(frameHook(() => {
          const live = (globalThis as { __buildingView?: { hideRoofs?: boolean } }).__buildingView;
          roof.visible = !(live?.hideRoofs ?? HIDE_ROOFS);
        }));
      }
    }).catch(() => {
      if (gone || assetHidden(sha)) return;
      // the asset is missing or broken: a soft placeholder of the def's size, so the place is still visible
      const [w, h, d] = ctx.def.size.box;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ctx.materials.get('paint', '#b0a090')); m.position.y = h / 2; m.name = 'asset missing';
      target.add(m); assetShown(sha);
      const v = variants.get(sha); if (v) { v.failed = true; show(); }
    }); };
    // G8: a file hidden by moderation is not drawn at all (no request, no placeholder)
    if (assetHidden(make.asset)) return holder;
    const start = (sha: string, target?: THREE.Object3D) => { if (isEager(sha)) void load(sha, target); else { holder.add(deferLoad(sha, () => load(sha, target), frameHook, holder)); noteDeferred(); } };
    if (make.lod1 && !assetHidden(make.lod1)) {
      const at = new THREE.Vector3(); let tick = Math.floor(phase * 7) % 8;
      const want = (sha: string) => {
        wanted = sha;
        if (!variants.has(sha)) { const root = new THREE.Group(); root.name = sha === make.asset ? 'lod0' : 'lod1'; root.visible = false; variants.set(sha, { root }); holder.add(root); start(sha, root); }
        show();
      };
      // t4-phone-new: with an arrival plan, the model the plan chose from the arrival eye starts now (lazy-assets.ts
      // plannedArrivalEye); the frame check below then follows the camera as before
      const eye = plannedArrivalEye();
      if (eye) { let p: { x: number; z: number } | null = null; try { p = ctx.model.worldPose(ctx.entity); } catch { /* the frame check decides */ } if (p) want(meshLodAsset(make, ctx.def.size.box, Math.hypot(p.x - eye[0], p.z - eye[1]), ctx.entity.s ?? 1)); }
      // distance check every 8th frame (staggered per thing); the first one runs on the first drawn frame
      holder.add(frameHook((cam) => {
        if (variants.size && (tick++ & 7)) return;
        holder.getWorldPosition(at);
        want(meshLodAsset(make, ctx.def.size.box, Math.hypot(at.x - cam.position.x, at.z - cam.position.z), ctx.entity.s ?? 1, variants.size ? wanted : undefined));
      }));
    } else start(make.asset);
    holder.addEventListener('removed', () => { gone = true; if (variants.size) for (const v of variants.values()) { v.inst?.dispose(); v.root.removeFromParent(); } else inst?.dispose(); });
    return holder;
  },
};
registerMesh(meshBuilder);
// basic.mesh.ts still registers a placeholder under the same id (removal requested of L1); glob import order is
// not guaranteed, so claim the id again once every mesh module has evaluated.
queueMicrotask(() => registerMesh(meshBuilder));
