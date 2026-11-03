// Instancing for static entity meshes (spec 29 WP1, 33 §5 L1): entities whose builder gives an
// `instanceKey` and that have no per-frame motion share one InstancedMesh per (key, part), so a
// village of 300 benches, lamps and trees costs a few draws. Easing is per instance.
import * as THREE from 'three';
import { isShadowProxyMaterial, markShadowProxy } from './gen-mesh/shadow-proxy.ts';

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4; castShadow: boolean; receiveShadow: boolean; windMode?: string };
type Pool = { key: string; parts: Part[]; meshes: THREE.InstancedMesh[]; capacity: number; count: number; slots: Map<string, number>; free: number[]; radius: number; dirty: boolean };

const tmp = new THREE.Matrix4(), tmp2 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** True when an object can be instanced: only plain meshes (no sprites, no skinning, no animated pivots). */
export function instanceable(obj: THREE.Object3D): boolean {
  let ok = true;
  obj.traverse((o) => {
    if (o === obj) return;
    if ((o as THREE.Sprite).isSprite || (o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh || o.userData.role) ok = false;
  });
  return ok;
}

export class EntityInstancer {
  readonly group = new THREE.Group();
  private pools = new Map<string, Pool>();
  /** PERF-BAKED-SHADOWS: changes whenever an instance is placed, moved or removed (the cached sun shadow redraws). */
  revision = 0;
  constructor() { this.group.name = 'entity-instances'; }

  /** Register a prototype object for a key (first time only); later calls reuse it. */
  ensure(key: string, proto: THREE.Object3D) {
    if (this.pools.has(key)) return;
    proto.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(proto.matrixWorld).invert();
    const parts: Part[] = [];
    proto.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      parts.push({ geometry: m.geometry, material: m.material, local: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), castShadow: m.castShadow, receiveShadow: m.receiveShadow, windMode: m.userData.edenWindMode });
    });
    // PERF-BATCH: the prototype's own radius; with every instance's position it bounds the pool (updateBounds)
    const box = new THREE.Box3().setFromObject(proto), radius = box.isEmpty() ? 1 : box.getBoundingSphere(new THREE.Sphere()).radius + box.getBoundingSphere(new THREE.Sphere()).center.length();
    const pool: Pool = { key, parts, meshes: [], capacity: 0, count: 0, slots: new Map(), free: [], radius, dirty: true };
    this.pools.set(key, pool);
    this.grow(pool, 8);
  }
  has(key: string) { return this.pools.has(key); }

  /** Place or move an instance: position, yaw (+ optional pitch/roll), uniform scale. */
  set(key: string, id: string, p: THREE.Vector3, yaw: number, s: number, tilt?: [number, number]) {
    const pool = this.pools.get(key); if (!pool) return;
    let i = pool.slots.get(id);
    if (i === undefined) { i = pool.free.pop() ?? pool.count++; if (i >= pool.capacity) this.grow(pool, pool.capacity * 2); pool.slots.set(id, i); }
    e.set(tilt?.[0] ?? 0, yaw, tilt?.[1] ?? 0, 'YXZ'); q.setFromEuler(e);
    tmp.compose(p, q, sc.set(s, s, s));
    for (let k = 0; k < pool.parts.length; k++) { tmp2.multiplyMatrices(tmp, pool.parts[k].local); pool.meshes[k].setMatrixAt(i, tmp2); pool.meshes[k].instanceMatrix.needsUpdate = true; }
    for (const m of pool.meshes) { m.count = pool.count; }
    pool.dirty = true; this.revision++;
  }
  remove(key: string, id: string) {
    const pool = this.pools.get(key); if (!pool) return;
    const i = pool.slots.get(id); if (i === undefined) return;
    for (const m of pool.meshes) { m.setMatrixAt(i, ZERO); m.instanceMatrix.needsUpdate = true; }
    pool.slots.delete(id); pool.free.push(i); pool.dirty = true; this.revision++;
  }
  /** PERF-BATCH: each pool's meshes get one bounding sphere around its placed instances, so a pool whose things are all
   *  off screen costs no draws (they were drawn always: Eden 2026 spent ~220 draws a frame on pools out of view). Call
   *  before rendering; a pool is re-measured only after a set or remove. */
  updateBounds() {
    for (const pool of this.pools.values()) {
      if (!pool.dirty) continue; pool.dirty = false;
      const mesh0 = pool.meshes[0]; if (!mesh0) continue;
      let n = 0; v.set(0, 0, 0);
      for (const i of pool.slots.values()) { mesh0.getMatrixAt(i, tmp); v.x += tmp.elements[12]; v.y += tmp.elements[13]; v.z += tmp.elements[14]; n++; }
      if (!n) { for (const m of pool.meshes) { m.boundingSphere = null; m.frustumCulled = false; } continue; }
      v.divideScalar(n); let r = 0;
      for (const i of pool.slots.values()) { mesh0.getMatrixAt(i, tmp); const s = Math.hypot(tmp.elements[0], tmp.elements[1], tmp.elements[2]); r = Math.max(r, Math.hypot(tmp.elements[12] - v.x, tmp.elements[13] - v.y, tmp.elements[14] - v.z) + pool.radius * s); }
      for (const m of pool.meshes) { (m.boundingSphere ??= new THREE.Sphere()).set(v, r); m.frustumCulled = true; }
    }
  }
  /** Draw calls this instancer adds (one per part per non-empty pool). */
  get draws() { let n = 0; for (const p of this.pools.values()) if (p.slots.size) n += p.parts.length; return n; }
  get instances() { let n = 0; for (const p of this.pools.values()) n += p.slots.size; return n; }

  private grow(pool: Pool, capacity: number) {
    const old = pool.meshes;
    pool.meshes = pool.parts.map((part, k) => {
      const m = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      m.castShadow = part.castShadow; m.receiveShadow = part.receiveShadow; m.name = `instances:${pool.key}:${k}`; if (part.windMode) m.userData.edenWindMode = part.windMode; // W2: plant parts sway
      m.frustumCulled = false;  // instances spread across the world; per-instance culling is not worth it at this scale
      if (isShadowProxyMaterial(part.material)) markShadowProxy(m);   // a prototype's shadow proxy: drawn only in the shadow pass
      for (let i = 0; i < capacity; i++) m.setMatrixAt(i, ZERO);
      if (old[k]) { for (let i = 0; i < pool.capacity; i++) { old[k].getMatrixAt(i, tmp); m.setMatrixAt(i, tmp); } this.group.remove(old[k]); old[k].dispose(); }
      pool.dirty = true;
      m.count = pool.count;
      this.group.add(m);
      return m;
    });
    pool.capacity = capacity;
  }
  dispose() { for (const p of this.pools.values()) for (const m of p.meshes) m.dispose(); this.pools.clear(); this.group.clear(); }
}
export { v as _v };
