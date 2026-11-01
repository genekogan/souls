// Instancing for static entity meshes (spec 29 WP1, 33 §5 L1): entities whose builder gives an
// `instanceKey` and that have no per-frame motion share one InstancedMesh per (key, part), so a
// village of 300 benches, lamps and trees costs a few draws. Easing is per instance.
import * as THREE from 'three';
import { isShadowProxyMaterial, markShadowProxy } from './gen-mesh/shadow-proxy.ts';

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4; castShadow: boolean; receiveShadow: boolean; windMode?: string };
type Pool = { key: string; parts: Part[]; meshes: THREE.InstancedMesh[]; capacity: number; count: number; slots: Map<string, number>; free: number[] };

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
    const pool: Pool = { key, parts, meshes: [], capacity: 0, count: 0, slots: new Map(), free: [] };
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
  }
  remove(key: string, id: string) {
    const pool = this.pools.get(key); if (!pool) return;
    const i = pool.slots.get(id); if (i === undefined) return;
    for (const m of pool.meshes) { m.setMatrixAt(i, ZERO); m.instanceMatrix.needsUpdate = true; }
    pool.slots.delete(id); pool.free.push(i);
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
      m.count = pool.count;
      this.group.add(m);
      return m;
    });
    pool.capacity = capacity;
  }
  dispose() { for (const p of this.pools.values()) for (const m of p.meshes) m.dispose(); this.pools.clear(); this.group.clear(); }
}
export { v as _v };
