// PERF-BATCH round 2: one InstancedMesh per (kind, cell) for the world's scattered plants and rocks. A scatter thing
// (gen-mesh ecology scatter/2) builds one InstancedMesh per species it places, so Eden 2026's 158 scatters drew 233
// pools, 130 of them with four instances or fewer (a lone pine by a path costs a draw in the main pass and another in the
// shadow pass). When a scatter freezes (WorldEntityLayer.freeze: settled, still, world matrices final) its instances
// move here, into a pool per (geometry, material, cell) shared by every scatter; its own meshes hide until it thaws.
// The pool keeps the source's material (the wind patch bends instances from `instanceMatrix`), per-instance tint,
// shadow flags and userData, so the picture is the same; a pool is frustum culled as one sphere around its instances.
import * as THREE from 'three';

type Pool = { key: string; mesh: THREE.InstancedMesh; capacity: number; count: number; free: number[]; live: number; radius: number; dirty: boolean; colored: boolean };
type Slot = { pool: Pool; i: number };
const tmp = new THREE.Matrix4(), v = new THREE.Vector3(), c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class ScatterPools {
  readonly group = new THREE.Group();
  private pools = new Map<string, Pool>();
  private owners = new Map<string, { slots: Slot[]; hidden: THREE.Object3D[] }>();
  cellSize: number;
  /** One pool per species by default (Eden 2026: 26 draws for 3,700 plants and rocks; a phone gets 192 m cells so a view
   *  draws only its own). Infinity is one cell. */
  constructor(cellSize = Infinity) { this.cellSize = cellSize; this.group.name = 'scatter pools'; }

  /** Pool every InstancedMesh under `obj` at its current world matrices; those meshes hide. Returns instances pooled. */
  add(owner: string, obj: THREE.Object3D): number {
    if (this.owners.has(owner)) this.remove(owner);
    const slots: Slot[] = [], hidden: THREE.Object3D[] = [];
    obj.updateWorldMatrix(true, true);
    obj.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || Array.isArray(im.material) || !im.count || !im.visible) return;
      const colored = !!im.instanceColor;
      for (let k = 0; k < im.count; k++) {
        im.getMatrixAt(k, tmp); tmp.premultiply(im.matrixWorld);
        const e = tmp.elements; if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue;   // a removed (zero) instance
        const pool = this.poolFor(im, Math.floor(e[12] / this.cellSize), Math.floor(e[14] / this.cellSize), colored);
        let i = pool.free.pop(); if (i === undefined) { i = pool.count++; if (i >= pool.capacity) this.grow(pool, pool.capacity * 2); }
        pool.mesh.setMatrixAt(i, tmp); if (colored) { im.getColorAt(k, c); pool.mesh.setColorAt(i, c); }
        pool.live++; pool.dirty = true; slots.push({ pool, i });
      }
      im.visible = false; hidden.push(im);
    });
    for (const s of new Set(slots.map((s) => s.pool))) { s.mesh.count = s.count; s.mesh.instanceMatrix.needsUpdate = true; if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true; }
    this.owners.set(owner, { slots, hidden });
    return slots.length;
  }
  /** Take an owner's instances back out; its own meshes show again. */
  remove(owner: string) {
    const o = this.owners.get(owner); if (!o) return;
    for (const { pool, i } of o.slots) { pool.mesh.setMatrixAt(i, ZERO); pool.mesh.instanceMatrix.needsUpdate = true; pool.free.push(i); pool.live--; pool.dirty = true; }
    for (const h of o.hidden) h.visible = true;
    this.owners.delete(owner);
  }
  has(owner: string) { return this.owners.has(owner); }

  private poolFor(im: THREE.InstancedMesh, cx: number, cz: number, colored: boolean): Pool {
    const key = `${im.geometry.uuid}|${(im.material as THREE.Material).uuid}|${im.castShadow ? 1 : 0}${im.receiveShadow ? 1 : 0}|${cx},${cz}`;
    let pool = this.pools.get(key);
    if (!pool) {
      if (!im.geometry.boundingSphere) im.geometry.computeBoundingSphere();
      const bs = im.geometry.boundingSphere!;
      pool = { key, mesh: null as unknown as THREE.InstancedMesh, capacity: 0, count: 0, free: [], live: 0, radius: bs.radius + bs.center.length(), dirty: true, colored };
      this.pools.set(key, pool);
      this.grow(pool, 16, im);
    }
    if (colored && !pool.colored) { pool.colored = true; const mesh = pool.mesh; c.set(1, 1, 1); for (let i = 0; i < pool.capacity; i++) mesh.setColorAt(i, c); }
    return pool;
  }
  private grow(pool: Pool, capacity: number, like?: THREE.InstancedMesh) {
    const old = pool.mesh as THREE.InstancedMesh | null, proto = like ?? old!;
    const mesh = new THREE.InstancedMesh(proto.geometry, proto.material, capacity);
    mesh.name = `scatter pool: ${(like ?? old!).name.replace(/^scatter( pool)?: ?/, '')}`;
    mesh.castShadow = proto.castShadow; mesh.receiveShadow = proto.receiveShadow; mesh.renderOrder = proto.renderOrder; mesh.layers.mask = proto.layers.mask;
    Object.assign(mesh.userData, proto.userData);
    mesh.frustumCulled = false;   // until updateBounds sets its sphere
    for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, ZERO);
    if (pool.colored) { const white = new THREE.Color(1, 1, 1); for (let i = 0; i < capacity; i++) mesh.setColorAt(i, white); }
    if (old) {   // own temporaries: `add` holds the instance it is placing in `tmp` and `c` while a pool grows
      const gm = new THREE.Matrix4(), gc = new THREE.Color();
      for (let i = 0; i < pool.capacity; i++) { old.getMatrixAt(i, gm); mesh.setMatrixAt(i, gm); if (old.instanceColor) { old.getColorAt(i, gc); mesh.setColorAt(i, gc); } }
      this.group.remove(old); old.dispose();
    }
    mesh.count = pool.count; pool.mesh = mesh; pool.capacity = capacity; pool.dirty = true;
    this.group.add(mesh);
  }
  /** One bounding sphere per pool around its live instances (call before rendering; a pool is re-measured only after a change). */
  updateBounds() {
    for (const pool of this.pools.values()) {
      if (!pool.dirty) continue; pool.dirty = false;
      const mesh = pool.mesh;
      if (!pool.live) { mesh.boundingSphere = null; mesh.frustumCulled = false; mesh.visible = false; continue; }
      mesh.visible = true;
      let n = 0; v.set(0, 0, 0);
      for (let i = 0; i < pool.count; i++) { mesh.getMatrixAt(i, tmp); const e = tmp.elements; if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue; v.x += e[12]; v.y += e[13]; v.z += e[14]; n++; }
      v.divideScalar(n); let r = 0;
      for (let i = 0; i < pool.count; i++) { mesh.getMatrixAt(i, tmp); const e = tmp.elements; if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue; const s = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])); r = Math.max(r, Math.hypot(e[12] - v.x, e[13] - v.y, e[14] - v.z) + pool.radius * s); }
      (mesh.boundingSphere ??= new THREE.Sphere()).set(v, r); mesh.frustumCulled = true;
    }
  }
  /** Draw calls the pools add (one per pool with a live instance). */
  get draws() { let n = 0; for (const p of this.pools.values()) if (p.live) n++; return n; }
  get instances() { let n = 0; for (const p of this.pools.values()) n += p.live; return n; }
  get poolCount() { return this.pools.size; }
  dispose() { for (const p of this.pools.values()) { this.group.remove(p.mesh); p.mesh.dispose(); } this.pools.clear(); for (const o of this.owners.values()) for (const h of o.hidden) h.visible = true; this.owners.clear(); }
}
