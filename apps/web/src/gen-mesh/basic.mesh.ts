// Mesh halves for box/1, scatter/1, landform/1, lake/1, flags. Owner: L1. (mesh defs: mesh.mesh.ts, L5)
import * as THREE from 'three';
import { scatterPoints } from '@souls/generators';
import { registerMesh, type MeshCtx } from './registry.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
let unitBox: THREE.BoxGeometry | null = null, unitSphere: THREE.SphereGeometry | null = null, unitCone: THREE.ConeGeometry | null = null;
const box = () => (unitBox ??= new THREE.BoxGeometry(1, 1, 1));
const sphere = () => (unitSphere ??= new THREE.SphereGeometry(0.5, 10, 7));
const cone = () => (unitCone ??= new THREE.ConeGeometry(0.5, 1, 7));
const frac = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };

registerMesh({
  gen: 'box/1',
  build(ctx) {
    const p = ctx.params, w = num(p.w, ctx.def.size.box[0]), h = num(p.h, ctx.def.size.box[1]), d = num(p.d, ctx.def.size.box[2]);
    const color = typeof ctx.entity.state?.paint === 'string' ? ctx.entity.state.paint : typeof p.color === 'string' ? p.color : '#9a9a9a';
    const mesh = new THREE.Mesh(box(), ctx.materials.get(ctx.def.material, color)); mesh.scale.set(w, h, d); mesh.position.y = h / 2; mesh.castShadow = mesh.receiveShadow = true;
    const holder = new THREE.Group(); holder.add(mesh);
    if (ctx.def.tags.includes('tree')) { const canopy = new THREE.Mesh(sphere(), ctx.materials.get('leaf', '#3f7d3a')); canopy.scale.set(w * 5, h * 0.55, d * 5); canopy.position.y = h * 0.8; canopy.castShadow = true; holder.add(canopy); }
    return holder;
  },
  instanceKey(ctx) { return `${ctx.def.hash}:${JSON.stringify(ctx.params)}:${ctx.entity.state?.paint ?? ''}`; },
});

registerMesh({ gen: 'landform/1', build: () => null });
registerMesh({ gen: 'lake/1', build: () => null });

registerMesh({
  gen: 'scatter/1', world: true,
  build(ctx) {
    const e = ctx.entity, m = ctx.model, params = ctx.params;
    if (!e.shape || !('area' in e.shape)) return null;
    const density = num(params.density, 0.05), spacing = num(params.minSpacing, 2), height = num(params.height, ctx.def.tags.includes('garden') ? 0.5 : 6);
    const pts = scatterPoints(e.shape.area, density, spacing, e.seed ?? hashSeed(e.id), 3000);
    if (!pts.length) return null;
    const forest = ctx.def.name.includes('forest') || height >= 3;
    const holder = new THREE.Group(); const dummy = new THREE.Object3D();
    if (forest) {
      const trunks = new THREE.InstancedMesh(box(), ctx.materials.get('bark'), pts.length), crowns = new THREE.InstancedMesh(cone(), ctx.materials.get('leaf', '#2f6b2f'), pts.length);
      pts.forEach(([x, z], i) => {
        const y = m.terrain.sample(x, z), h = height * (0.7 + 0.6 * frac(i * 7919 + (e.seed ?? 0)));
        dummy.position.set(x, y + h * 0.25, z); dummy.scale.set(0.3, h * 0.5, 0.3); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, y + h * 0.8, z); dummy.scale.set(h * 0.35, h * 0.6, h * 0.35); dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
      });
      trunks.castShadow = crowns.castShadow = true; holder.add(trunks, crowns);
    } else {
      const color = ctx.def.tags.includes('garden') ? '#c75c7a' : '#7fb24a';
      const tufts = new THREE.InstancedMesh(cone(), ctx.materials.get('grass', color), pts.length);
      pts.forEach(([x, z], i) => { const y = m.terrain.sample(x, z), h = height * (0.6 + 0.8 * frac(i * 104729 + (e.seed ?? 0))); dummy.position.set(x, y + h / 2, z); dummy.scale.set(h * 0.5, h, h * 0.5); dummy.rotation.set(0, frac(i * 31) * 6.28, 0); dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix); });
      holder.add(tufts);
    }
    return holder;
  },
});

/** Flags: pole + pennant + floating label (any def tagged `flag`). Lane U2 (Gene 2026-10-20: "flags do not need to be
 *  drawn to scale -- they should be visible zoomed out too"): up close a flag is its true 3 m; farther out it grows so it
 *  never looks shorter than FLAG_MIN_PX CSS pixels on screen (pole, pennant and label together, from the pole's foot). */
registerMesh({
  gen: 'tag:flag',
  build(ctx) {
    const h = num(ctx.params.h, 3);
    const holder = new THREE.Group(), flag = new THREE.Group(); holder.add(flag);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, h, 6), ctx.materials.get('wood', '#e8c547')); pole.position.y = h / 2; flag.add(pole);
    const pennant = new THREE.Mesh(box(), ctx.materials.get('fabric', '#d9534f', { side: THREE.DoubleSide })); pennant.scale.set(0.9, 0.5, 0.02); pennant.position.set(0.45, h - 0.3, 0); flag.add(pennant);
    const label = typeof ctx.entity.state?.label === 'string' && ctx.entity.state.label ? ctx.entity.state.label : (ctx.entity.name ?? ctx.entity.id);
    const sprite = labelSprite(label); sprite.position.y = h + 0.6; flag.add(sprite);
    // One distance check per drawn part per frame (two meshes; whichever draws first applies it for both).
    const size = new THREE.Vector2(), at = new THREE.Vector3();
    const grow = (renderer: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) => {
      const cam = camera as THREE.PerspectiveCamera; if (!cam.isPerspectiveCamera) return;
      const e = holder.matrixWorld.elements, d = at.setFromMatrixPosition(holder.matrixWorld).distanceTo(cam.position);
      const px = (renderer.getSize(size).y / (2 * Math.tan((cam.fov * Math.PI) / 360))) * (cam.zoom || 1);
      const k = flagScale(d, px, h * (Math.hypot(e[4], e[5], e[6]) || 1));
      if (Math.abs(flag.scale.y - k) > 1e-3 * k) { flag.scale.setScalar(k); flag.updateMatrix(); flag.updateMatrixWorld(true); }
    };
    for (const m of [pole, pennant]) { m.onBeforeRender = grow; m.userData.keepDetail = true; }  // the phone tier's tiny-mesh cull keeps flags
    return holder;
  },
});
/** A flag's on-screen floor (CSS px from foot to pennant top) and its scale factor (>= 1) at distance `d`, for a flag
 *  `tall` metres high in the world and `px` pixels per metre at 1 m. */
export const FLAG_MIN_PX = 40;
export function flagScale(d: number, px: number, tall: number): number {
  const shown = (tall * px) / Math.max(0.05, d);
  return shown < FLAG_MIN_PX ? FLAG_MIN_PX / shown : 1;
}

export function labelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d')!;
  ctx.font = '600 28px system-ui, sans-serif'; const w = Math.ceil(ctx.measureText(text).width) + 28;
  canvas.width = w; canvas.height = 44; const c2 = canvas.getContext('2d')!;
  c2.fillStyle = 'rgba(20,20,20,0.75)'; c2.beginPath(); c2.roundRect(0, 0, w, 44, 10); c2.fill();
  c2.font = '600 28px system-ui, sans-serif'; c2.fillStyle = '#fff'; c2.textBaseline = 'middle'; c2.fillText(text, 14, 23);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((w / 44) * 1.2, 1.2, 1); sprite.renderOrder = 10;
  sprite.userData.animates = true;  // P1: rescales itself per frame, so its thing never freezes (WorldEntityLayer.freeze)
  // a 1.2 m label drawn over everything grew to fill the screen when the camera stood beside the flag: cap it on screen
  const base = sprite.scale.clone(), size = new THREE.Vector2(), at = new THREE.Vector3();
  sprite.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera; if (!cam.isPerspectiveCamera) return;
    const d = at.setFromMatrixPosition(sprite.matrixWorld).distanceTo(cam.position), px = renderer.getSize(size).y / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const e = sprite.matrixWorld.elements, k = labelScale(d, px, Math.hypot(e[4], e[5], e[6]) / sprite.scale.y || 1);
    if (Math.abs(sprite.scale.y - base.y * k) > 1e-4) { sprite.scale.copy(base).multiplyScalar(k); sprite.updateMatrixWorld(); }
  };
  return sprite;
}
/** Scale factor (≤ 1) that keeps a 1.2 m label at most LABEL_MAX_PX CSS pixels tall at distance `d` (`px` pixels per
 *  metre at 1 m; `parentScale` the world scale above the sprite). */
export const LABEL_MAX_PX = 26;
export function labelScale(d: number, px: number, parentScale = 1): number {
  const tall = (1.2 * Math.abs(parentScale) * px) / Math.max(0.05, d);
  return tall > LABEL_MAX_PX ? LABEL_MAX_PX / tall : 1;
}
function hashSeed(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 100000; }
export type { MeshCtx };
