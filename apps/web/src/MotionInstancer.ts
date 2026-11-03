// PERF-BATCH round 2: moving things draw as instances. A motion thing (a swimming duck, a bobbing punt, a turning wheel)
// is posed every frame, so it can never join a static batch; but its meshes are plain meshes of shared geometry (Eden
// 2026's 38 lake ducks are 6 meshes each of 12 geometries; a punt is 31 boxes of one geometry in 5 materials), so one
// InstancedMesh per (geometry, material, shadow flags) draws all of them, and each frame copies every tracked mesh's
// world matrix into its slot (a few hundred 4×4 copies). The sources stay in the scene, hidden, as the pick and
// ownership authority: they keep `visible` (pickers and hover walk visibility) and leave the draw through an own
// `boundingSphere` that no frustum contains (three culls by it before the geometry's); a source hidden by its thing
// (culled, in a shut drawer) is a zero matrix. Nothing here moves anything: the pools observe the sources' poses after
// the frame's animation.
import * as THREE from 'three';

type Pool = { key: string; mesh: THREE.InstancedMesh; capacity: number; count: number; free: number[]; live: number; dirty: boolean };
type Entry = { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.Material; pool: Pool; i: number; shown: boolean; frustum: boolean };
type Culled = THREE.Mesh & { boundingSphere?: THREE.Sphere };
/** A sphere no frustum contains (every plane distance is under +∞): an own `boundingSphere` that keeps a mesh out of every pass. */
export const NEVER_DRAWN = Object.freeze(new THREE.Sphere(new THREE.Vector3(), -Infinity)) as THREE.Sphere;
type Tracked = { root: THREE.Object3D; entries: Entry[]; watched: THREE.Object3D[]; dirty: boolean; changed: () => void };
const tmp = new THREE.Matrix4(), v = new THREE.Vector3(), box = new THREE.Box3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const meshBefore = THREE.Object3D.prototype.onBeforeRender, meshAfter = THREE.Object3D.prototype.onAfterRender;

/** A plain, hook-free, single-material mesh whose geometry is shareable. */
export function motionInstanceable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  return m.constructor === THREE.Mesh && !Array.isArray(m.material) && !m.customDepthMaterial && !m.customDistanceMaterial && m.onBeforeRender === meshBefore && m.onAfterRender === meshAfter
    && !!m.geometry.attributes.position && !Object.keys(m.geometry.morphAttributes).length && m.geometry.drawRange.start === 0 && m.geometry.drawRange.count === Infinity && !m.userData.shadowProxy && (m as Culled).boundingSphere === undefined;
}

export class MotionInstancer {
  readonly group = new THREE.Group();
  private pools = new Map<string, Pool>();
  private tracked = new Map<THREE.Object3D, Tracked>();
  constructor() { this.group.name = 'motion pools'; }

  /** Instance every eligible mesh under `root` from now on; the meshes hide. A root already tracked is left as it is. */
  track(root: THREE.Object3D): number {
    if (this.tracked.has(root)) return this.tracked.get(root)!.entries.length;
    const tracked: Tracked = { root, entries: [], watched: [], dirty: false, changed: () => { tracked.dirty = true; } };
    this.refresh(tracked);
    this.tracked.set(root, tracked);
    return tracked.entries.length;
  }
  untrack(root: THREE.Object3D) {
    const t = this.tracked.get(root); if (!t) return;
    for (const o of t.watched) { o.removeEventListener('childadded', t.changed); o.removeEventListener('childremoved', t.changed); }
    for (const e of t.entries) this.release(e);
    this.tracked.delete(root);
  }
  /** Track each child of `group` that is not yet tracked (an engine fixture group whose boats come and go). */
  trackChildren(group: THREE.Object3D) { for (const c of group.children) if (!this.tracked.has(c)) this.track(c); }
  has(root: THREE.Object3D) { return this.tracked.has(root); }

  /** Fixture stock and other live owners may replace nested children without replacing their root. Revisit only after
   *  a structural event; ordinary frames keep their existing entries and avoid another subtree traversal. */
  private refresh(t: Tracked) {
    for (const o of t.watched) { o.removeEventListener('childadded', t.changed); o.removeEventListener('childremoved', t.changed); }
    for (const e of t.entries) this.release(e);
    t.watched.length = 0; t.entries.length = 0;
    t.root.traverse(o => {
      t.watched.push(o); o.addEventListener('childadded', t.changed); o.addEventListener('childremoved', t.changed);
      if (motionInstanceable(o)) t.entries.push(this.place(o));
    });
    t.dirty = false;
  }

  private place(mesh: THREE.Mesh): Entry {
    const material = mesh.material as THREE.Material;
    const key = `${mesh.geometry.uuid}|${material.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${mesh.renderOrder}|${mesh.layers.mask}`;
    let pool = this.pools.get(key);
    if (!pool) { pool = { key, mesh: null as unknown as THREE.InstancedMesh, capacity: 0, count: 0, free: [], live: 0, dirty: true }; this.pools.set(key, pool); this.grow(pool, 8, mesh); }
    let i = pool.free.pop(); if (i === undefined) { i = pool.count++; if (i >= pool.capacity) this.grow(pool, pool.capacity * 2); }
    pool.live++; pool.dirty = true; pool.mesh.count = pool.count;
    const frustum = mesh.frustumCulled; mesh.frustumCulled = true; (mesh as Culled).boundingSphere = NEVER_DRAWN;
    return { mesh, geometry: mesh.geometry, material, pool, i, shown: false, frustum };
  }
  private release(e: Entry) {
    e.pool.mesh.setMatrixAt(e.i, ZERO); e.pool.mesh.instanceMatrix.needsUpdate = true; e.pool.free.push(e.i); e.pool.live--; e.pool.dirty = true;
    delete (e.mesh as Culled).boundingSphere; e.mesh.frustumCulled = e.frustum;
  }
  private grow(pool: Pool, capacity: number, like?: THREE.Mesh) {
    const old = pool.mesh as THREE.InstancedMesh | null, proto = (like ?? old)!;
    const mesh = new THREE.InstancedMesh(proto.geometry, proto.material as THREE.Material, capacity);
    mesh.name = `motion pool: ${(like ? like.name : old!.name.replace(/^motion pool: /, '')) || 'mesh'}`;
    mesh.castShadow = proto.castShadow; mesh.receiveShadow = proto.receiveShadow; mesh.renderOrder = proto.renderOrder; mesh.layers.mask = proto.layers.mask;
    if (like) { for (const k of ['cameraTransparent', 'edenWindMode', 'kind'] as const) if (like.userData[k] !== undefined) mesh.userData[k] = like.userData[k]; } else Object.assign(mesh.userData, old!.userData);
    mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, ZERO);
    if (old) { const gm = new THREE.Matrix4(); for (let i = 0; i < pool.capacity; i++) { old.getMatrixAt(i, gm); mesh.setMatrixAt(i, gm); } this.group.remove(old); old.dispose(); }
    mesh.count = pool.count; pool.mesh = mesh; pool.capacity = capacity; pool.dirty = true;
    this.group.add(mesh);
  }

  /** After the frame's animation, before the draw: every tracked mesh's world matrix into its slot; a root taken out of
   *  the scene is forgotten; a mesh whose geometry or material changed moves pool. */
  sync() {
    for (const t of this.tracked.values()) {
      if (!t.root.parent) { this.untrack(t.root); continue; }
      if (t.dirty) this.refresh(t);
      t.root.updateWorldMatrix(true, true);
      let rootShown = true; for (let p: THREE.Object3D | null = t.root; p; p = p.parent) if (!p.visible) { rootShown = false; break; }
      for (let k = 0; k < t.entries.length; k++) {
        let e = t.entries[k]; const m = e.mesh;
        if (m.geometry !== e.geometry || m.material !== e.material) { this.release(e); e = t.entries[k] = this.place(m); }
        let shown = rootShown;
        if (shown) for (let p: THREE.Object3D | null = m; p && p !== t.root; p = p.parent) if (!p.visible) { shown = false; break; }
        if (shown) { e.pool.mesh.setMatrixAt(e.i, m.matrixWorld); e.pool.dirty = true; }
        else if (e.shown) { e.pool.mesh.setMatrixAt(e.i, ZERO); e.pool.dirty = true; }
        e.shown = shown;
      }
    }
    for (const pool of this.pools.values()) {
      if (!pool.dirty) continue; pool.dirty = false;
      const mesh = pool.mesh; mesh.instanceMatrix.needsUpdate = true;
      if (!pool.live) { mesh.visible = false; continue; }
      mesh.visible = true;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const r0 = mesh.geometry.boundingSphere!.radius + mesh.geometry.boundingSphere!.center.length();
      box.makeEmpty(); let r = 0;
      for (let i = 0; i < pool.count; i++) { mesh.getMatrixAt(i, tmp); const el = tmp.elements; if (el[0] === 0 && el[5] === 0 && el[10] === 0) continue; v.set(el[12], el[13], el[14]); box.expandByPoint(v); r = Math.max(r, r0 * Math.max(Math.hypot(el[0], el[1], el[2]), Math.hypot(el[4], el[5], el[6]), Math.hypot(el[8], el[9], el[10]))); }
      if (box.isEmpty()) { mesh.visible = false; continue; }
      const s = mesh.boundingSphere ??= new THREE.Sphere(); box.getBoundingSphere(s); s.radius += r; mesh.frustumCulled = true;
    }
  }
  /** Draw calls the pools add (one per pool with a live instance). */
  get draws() { let n = 0; for (const p of this.pools.values()) if (p.live) n++; return n; }
  get instances() { let n = 0; for (const p of this.pools.values()) n += p.live; return n; }
  get roots() { return this.tracked.size; }
  dispose() { for (const t of [...this.tracked.values()]) this.untrack(t.root); for (const p of this.pools.values()) { this.group.remove(p.mesh); p.mesh.dispose(); } this.pools.clear(); }
}
