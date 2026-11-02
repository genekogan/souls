// Lane PERF2: one shadow caster per static model. After static-merge a Mars campus piece is still ~6 meshes (one per
// material) and each was drawn again into the shadow map (mars-two: ~330 shadow draws, ~0.6 ms CPU per frame). Once per
// loaded file (gltf-assets.ts `prepare`), the opaque casters' positions are merged into one geometry per shadow side; that
// proxy alone casts (three's default depth material) and the visible meshes stop casting.
// The proxy must not cost a main-pass draw: it is visible only during the shadow pass. A hook mesh, first child of the
// scene, turns the scene's proxies on in its onBeforeShadow (the shadow pass walks the scene graph in order, so it runs
// first) and off in its onBeforeRender (first in the main pass, whose render list was built while they were off).
// The proxy's own material clips every vertex, in case anything ever draws it in a colour pass.
// Left casting themselves: a `roof` group (hidden in the interior view, its shadow goes with it), alpha-mapped or
// displaced materials, and alpha-tested ones whose map really has transparent texels (the depth pass needs the map).
// Measured on mars-two: 257 of 262 alpha-tested casters had fully opaque maps (the exporter marks everything MASK).
// `?shadowproxy=0` for A/B.
//
// Lane PERF-MATERIALS: the same for generated static things (`generated`). A building template (building.mesh.ts) is
// ~10 casters (walls, trim, floors, roof per storey group) and Eden 2026 has 239 of them: ~2,450 shadow draws became one
// per building. Generated proxies are ShadowProxyMesh objects: they survive Object3D.clone (templates and kit
// prototypes are cloned per thing) and register themselves with their scene's hub the first time the main pass draws
// them (no layer code needs to know). A thing whose casters can be hidden in part (a building's interior view hides
// storeys) registers a cut (setShadowCut): while it is cut, the proxy stays off and its casters cast themselves again.
import * as THREE from 'three';
import { computeBounds, transformPoints } from './fast-geometry.ts';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shadowproxy') === '0';
const nullMats = new Map<number, THREE.ShaderMaterial>();
/** Draws nothing in a colour pass (every vertex is clipped); the shadow pass uses three's depth material instead. */
/** key = side + 3 * shadowSide (3 = null): the depth pass takes shadowSide when set, else the mirror of side. */
function nullMaterial(key: number) {
  let m = nullMats.get(key);
  if (!m) {
    const side = (key % 3) as THREE.Side, shadow = Math.floor(key / 3);
    m = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }', side, colorWrite: false, depthWrite: false, depthTest: false });
    m.shadowSide = shadow === 3 ? null : (shadow as THREE.Side);
    m.name = 'shadow-proxy'; nullMats.set(key, m);
  }
  return m;
}

const opaque = new WeakMap<THREE.Texture, boolean>();
let probe: OffscreenCanvasRenderingContext2D | null = null;
export const alphaStats = { checked: 0, opaque: 0, ms: 0 };
/** True when a texture's alpha is 255 everywhere (sampled nearest at ≤ 256 px a side, so holes under ~4 texels of a 1024
 *  map can be missed: their shadow then comes out solid). Unknown images count as not opaque. */
function opaqueMap(t: THREE.Texture | null): boolean {
  if (!t) return true;
  const hit = opaque.get(t); if (hit !== undefined) return hit;
  let ok = false;
  const t0 = performance.now();
  try {
    const im = t.image as CanvasImageSource & { width: number; height: number };
    if (im && im.width && im.height && typeof OffscreenCanvas !== 'undefined') {
      const w = Math.min(256, im.width), h = Math.min(256, im.height);
      probe ??= new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true });
      if (probe) {
        probe.imageSmoothingEnabled = false; probe.clearRect(0, 0, w, h); probe.drawImage(im, 0, 0, w, h);
        const d = probe.getImageData(0, 0, w, h).data; ok = true;
        for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { ok = false; break; }
      }
    }
  } catch { ok = false; }
  alphaStats.checked++; if (ok) alphaStats.opaque++; alphaStats.ms += performance.now() - t0;
  opaque.set(t, ok);
  return ok;
}

/** Draws nothing in the main pass and answers no raycast; its clones (Object3D.clone keeps the class) register themselves
 *  with the scene's hub when first drawn, so a proxy built into a shared template or prototype works in every copy. */
export class ShadowProxyMesh extends THREE.Mesh {
  override raycast() {}
  override onBeforeRender(_renderer: THREE.WebGLRenderer, scene: THREE.Object3D) { if (this.visible && (scene as THREE.Scene).isScene) trackShadowProxies(this, scene as THREE.Scene); }
}
/** Make an InstancedMesh built from a proxy part (EntityInstancer, glb-instances) behave as a proxy: no raycast, hidden
 *  from the main pass once drawn. */
export function markShadowProxy(mesh: THREE.Mesh): void {
  mesh.userData.shadowProxy = true; mesh.raycast = () => {};
  mesh.onBeforeRender = (_r, scene) => { if (mesh.visible && (scene as THREE.Scene).isScene) trackShadowProxies(mesh, scene as THREE.Scene); };
}
export const isShadowProxyMaterial = (m: THREE.Material | THREE.Material[]) => !Array.isArray(m) && m.name === 'shadow-proxy';

export type ShadowProxyOptions = {
  /** A generated thing (building template, kit prototype): parts under a `role:` pivot (they move) and textured parts
   *  (faces, decals) keep casting themselves; a `roof` group merges too (a building's interior view is a cut instead). */
  generated?: boolean;
};
/** Add the proxy to a static model's scene (in place). Returns the casters merged, or 0 when skipped. */
export function addShadowProxy(root: THREE.Object3D, opts: ShadowProxyOptions = {}): number {
  if (OFF) return 0;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bySide = new Map<number, { mesh: THREE.Mesh; rel: THREE.Matrix4 }[]>();
  let ok = true;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh || (!opts.generated && o.name.startsWith('role:'))) ok = false;
    const m = o as THREE.Mesh; if (!m.isMesh || !m.castShadow || m.userData.shadowProxy) return;
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if ((!opts.generated && p.name === 'roof') || (opts.generated && p.name.startsWith('role:')) || !p.visible) return;
    if (Array.isArray(m.material) || Object.keys(m.geometry.morphAttributes).length || !m.geometry.attributes.position) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.name === 'shadow-proxy' || (opts.generated && mat.map)) return;
    if ((mat.alphaTest > 0 && !opaqueMap(mat.map)) || mat.alphaToCoverage || mat.wireframe || mat.alphaMap || mat.displacementMap || mat.clippingPlanes?.length || !mat.visible) return;
    const side = mat.side + 3 * (mat.shadowSide === null || mat.shadowSide === undefined ? 3 : mat.shadowSide);
    let list = bySide.get(side); if (!list) bySide.set(side, (list = []));
    list.push({ mesh: m, rel: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  const total = [...bySide.values()].reduce((a, l) => a + l.length, 0);
  if (!ok || total < 2) return 0;
  let merged = 0;
  for (const [side, list] of bySide) {
    // one position-only geometry in the model root's frame. Positions are read through getX (meshopt/quantized GLBs store
    // normalized int16 positions that their node matrix dequantizes); a mirrored node's triangles are rewound so the
    // shadow side stays the same.
    const ranges = list.map(({ mesh }) => { const g = mesh.geometry, n = g.index ? g.index.count : g.attributes.position.count, start = Math.min(n, g.drawRange.start), count = Math.min(n - start, Number.isFinite(g.drawRange.count) ? g.drawRange.count : n); return { start, count }; });
    const nv = list.reduce((a, { mesh }) => a + mesh.geometry.attributes.position.count, 0), ni = ranges.reduce((a, r) => a + r.count, 0);
    const pos = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), v = new THREE.Vector3();
    let vo = 0, io = 0;
    list.forEach(({ mesh, rel }, k) => {
      const g = mesh.geometry, sp = g.attributes.position as THREE.BufferAttribute, flip = rel.determinant() < 0, { start, count } = ranges[k];
      if (!transformPoints(sp, rel, pos, vo * 3)) for (let i = 0; i < sp.count; i++) { v.fromBufferAttribute(sp, i).applyMatrix4(rel); pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z; }
      const gi = g.index, ia = gi && !gi.normalized && !(gi as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? gi.array : null;
      for (let i = 0; i < count; i++) { const j = flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i; idx[io + i] = vo + (ia ? ia[start + j] : gi ? gi.getX(start + j) : start + j); }
      vo += sp.count; io += count;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (!computeBounds(geo)) { geo.computeBoundingSphere(); geo.computeBoundingBox(); }
    // (the CPU arrays stay: a cached asset is reused by the next renderer after a LiveWorld re-mount, which uploads again)
    const proxy = new ShadowProxyMesh(geo, nullMaterial(side));
    proxy.name = 'shadow-proxy'; proxy.castShadow = true; proxy.receiveShadow = false; proxy.userData.shadowProxy = true;
    proxy.matrixAutoUpdate = false;   // identity in the model root's frame
    root.add(proxy);
    for (const { mesh } of list) { mesh.castShadow = false; mesh.userData.shadowProxied = true; }   // (the mark survives clones: a cut finds its casters)
    merged += list.length;
  }
  return merged;
}

// ---------------------------------------------------------------- runtime: proxies are drawn only in the shadow pass
type Hub = { proxies: Set<THREE.Object3D>; scene: THREE.Scene };
const hubs = new WeakMap<THREE.Scene, Hub>();
type Cut = { casters: THREE.Mesh[]; cut: (renderer: THREE.WebGLRenderer) => boolean; on: boolean | null };
const cuts = new WeakMap<THREE.Object3D, Cut>();
/** A proxy whose casters can be hidden in part: while `cut(renderer)` is true (asked once per shadow pass) the proxy
 *  casts nothing and its `casters` (the meshes it stands for, in this copy) cast themselves again, each with its own
 *  onBeforeShadow; otherwise the proxy casts and they stay off. */
export function setShadowCut(proxy: THREE.Object3D, casters: THREE.Mesh[], cut: (renderer: THREE.WebGLRenderer) => boolean): void {
  cuts.set(proxy, { casters, cut, on: null });
}
/** Take the proxies out of one copy of a generated thing and give its casters their shadows back (a canonical context
 *  capture carries no render-time machinery). */
export function removeShadowProxies(root: THREE.Object3D): number {
  const gone: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.userData.shadowProxy) gone.push(o); else if (o.userData.shadowProxied) { (o as THREE.Mesh).castShadow = true; delete o.userData.shadowProxied; } });
  for (const p of gone) p.removeFromParent();
  return gone.length;
}
/** The casters a generated proxy stands for, in one copy of the thing (meshes marked when the proxy was built). */
export function proxiedCasters(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []; root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.shadowProxied) out.push(o as THREE.Mesh); }); return out;
}
const hookGeo = new THREE.BufferGeometry(); hookGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); hookGeo.setDrawRange(0, 0);
const hookMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function attachedTo(o: THREE.Object3D, scene: THREE.Scene) { let p: THREE.Object3D | null = o; for (let i = 0; p && i < 64; i++) { if (p === scene) return true; p = p.parent; } return false; }

const casterLists = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
function castersOf(p: THREE.Object3D): THREE.Mesh[] {
  let l = casterLists.get(p); if (!l) { l = p.parent && !(p as THREE.InstancedMesh).isInstancedMesh ? proxiedCasters(p.parent) : []; casterLists.set(p, l); } return l;
}
/** False only when every caster is hidden (a batch draws them); a proxy without known casters always casts. */
function drawn(casters: THREE.Mesh[]): boolean { if (!casters.length) return true; for (const m of casters) if (m.visible) return true; return false; }
function hubFor(scene: THREE.Scene): Hub {
  let h = hubs.get(scene);
  if (h) return h;
  const hub: Hub = { proxies: new Set(), scene };
  const hook = new THREE.Mesh(hookGeo, hookMat); hook.name = 'shadow-proxy hook'; hook.frustumCulled = false; hook.castShadow = true; hook.renderOrder = -1e9;
  hook.onBeforeShadow = (renderer) => {
    for (const p of hub.proxies) {
      if (!attachedTo(p, scene)) { hub.proxies.delete(p); continue; }
      const c = cuts.get(p);
      // a static batch that draws the casters (StaticBatchOwner hides them) casts their shadow itself: the proxy stands down
      const own = c ? c.casters : castersOf(p);
      if (!c) { p.visible = drawn(own); continue; }
      const on = !c.cut(renderer);
      // re-asserted every shadow pass: a render-time pass (WorldShadowDetail, WorldDistanceDetail) restores castShadow after it
      for (const m of c.casters) m.castShadow = !on;
      c.on = on; p.visible = on && drawn(own);
    }
  };
  hook.onBeforeRender = () => { for (const p of hub.proxies) p.visible = false; };
  scene.add(hook); scene.children.splice(scene.children.indexOf(hook), 1); scene.children.unshift(hook);
  hubs.set(scene, hub);
  return hub;
}
function sceneOf(o: THREE.Object3D): THREE.Scene | null { let p: THREE.Object3D | null = o; for (let i = 0; p && i < 64; i++) { if ((p as THREE.Scene).isScene) return p as THREE.Scene; p = p.parent; } return null; }

/** Register the shadow proxies inside `obj` (a model clone, or an InstancedMesh pool part) with `obj`'s scene: they are
 *  hidden from the main pass from now on. Returns false when `obj` is not in a scene (its proxies then stay as they are). */
export function trackShadowProxies(obj: THREE.Object3D, scene = sceneOf(obj)): boolean {
  if (!scene) return false;
  const hub = hubFor(scene);
  obj.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || !(o.userData.shadowProxy || ((o as THREE.Mesh).material as THREE.Material).name === 'shadow-proxy')) return;
    o.raycast = () => {};   // the visible meshes answer raycasts
    o.visible = false; hub.proxies.add(o);
  });
  return true;
}
/** Probe: proxies the scene's hub tracks, and how many are cut right now. */
export function shadowProxyStats(scene: THREE.Scene): { proxies: number; cut: number } {
  const hub = hubs.get(scene); let cut = 0;
  if (hub) for (const p of hub.proxies) if (cuts.get(p)?.on === false) cut++;
  return { proxies: hub?.proxies.size ?? 0, cut };
}

(globalThis as { __shadowProxyAlpha?: unknown }).__shadowProxyAlpha = alphaStats;
