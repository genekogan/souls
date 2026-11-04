// Offline: node --test --test-concurrency=1 apps/web/src/WorldEntityLayer.freeze.test.ts
// P1 phones: settled still things freeze (their subtree leaves scene.updateMatrixWorld), thaw when anything in them changes,
// and are culled at render time when off screen (not on shadow-map frames) or under `cullPx`. Desktop (freezeSettled off)
// keeps three.js' own behaviour exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';

type Drawn = { settled?: boolean; frozen?: THREE.Object3D[]; noFreeze?: boolean; sphere?: THREE.Sphere; offscreen?: boolean; obj: THREE.Object3D; from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3; s: number }; t0: number; dur: number; defHash: string };
type Inner = { drawn: Map<string, Drawn>; thingsGroup: THREE.Group };

async function layerFor(phone: boolean) {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hooks.deregister());
  const layer = new WorldEntityLayer((p) => p);
  layer.active = true; layer.freezeSettled = phone;
  const inner = layer as unknown as Inner;
  const scene = new THREE.Scene(); scene.add(layer.group);
  const put = (id: string, at: [number, number, number], size = 1, child?: THREE.Object3D) => {
    const obj = new THREE.Group(); obj.position.set(...at);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size)); mesh.position.set(0, size / 2, 0); obj.add(mesh);
    if (child) mesh.add(child);
    inner.thingsGroup.add(obj);
    const p = new THREE.Vector3(...at);
    inner.drawn.set(id, { settled: true, obj, from: { p, s: 1 }, to: { p: p.clone(), s: 1 }, t0: 0, dur: 0.001, defHash: id });
    return { obj, mesh, d: () => inner.drawn.get(id)! };
  };
  let now = 1000;
  const frame = () => { now += 16; layer.update(0.016, now); scene.updateMatrixWorld(); };
  return { layer, inner, scene, put, frame };
}
const worldPos = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

test('static root collection bounds visited records, including ineligible records, before reading the tail', async () => {
  const { layer, inner, put } = await layerFor(false);
  put('moving', [0, 0, 0]);
  const selected = put('static', [2, 0, 0]); selected.d().frozen = [];
  const tail = put('tail', [4, 0, 0]);
  Object.defineProperty(tail.d(), 'frozen', { get() { throw Error('unvisited record read'); }, configurable: true });
  let records = 0; const entries = inner.drawn.entries.bind(inner.drawn);
  inner.drawn.entries = () => { const iterator = entries(), next = iterator.next.bind(iterator); iterator.next = () => { const entry = next(); if (!entry.done) records++; return entry; }; return iterator; };
  assert.deepEqual(layer.staticBatchRoots(2), [selected.obj]);
  assert.equal(records, 2); assert.deepEqual(layer.staticBatchRootScan, { records: 2, truncated: true });
  records = 0; assert.deepEqual(layer.staticBatchRoots(0), []); assert.equal(records, 0);
  assert.throws(() => layer.staticBatchRoots(-1), /invalid-record-limit/);
});

test('phone: a settled still thing freezes; its subtree leaves the matrix walk with current matrices', async () => {
  const { put, frame } = await layerFor(true);
  const a = put('a', [5, 0, 0]);
  frame();
  const d = a.d();
  assert.ok(d.frozen && d.frozen.length === 2, 'the thing and its mesh are frozen');
  assert.equal(a.mesh.matrixAutoUpdate, false);
  assert.notEqual(a.obj.updateMatrixWorld, THREE.Object3D.prototype.updateMatrixWorld, 'the subtree is skipped by scene.updateMatrixWorld');
  assert.deepEqual(worldPos(a.mesh).toArray(), [5, 0.5, 0], 'matrices were brought up to date at freeze');
  assert.ok(d.sphere && d.sphere.center.distanceTo(new THREE.Vector3(5, 0.5, 0)) < 1e-6, 'bounding sphere for render-time cull');
});

test('phone: a child added anywhere in a frozen thing (a lazy GLB arriving) thaws it; the next frame refreezes with the child current', async () => {
  const { put, frame } = await layerFor(true);
  const a = put('a', [5, 0, 0]);
  frame();
  const glb = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)); glb.position.set(0, 2, 0);
  a.mesh.add(glb);
  frame();
  assert.ok(a.d().frozen?.includes(glb), 'refrozen with the new child');
  assert.deepEqual(worldPos(glb).toArray(), [5, 2.5, 0], 'the new child has its world matrix');
  assert.ok(a.d().sphere!.radius > Math.sqrt(3) - 1e-6, 'sphere recomputed around the new geometry');
});

test('phone: a thing that starts moving thaws: matrices recompose again and follow it', async () => {
  const { put, frame } = await layerFor(true);
  const a = put('a', [5, 0, 0]);
  frame();
  const d = a.d();
  d.settled = false; d.from = { p: new THREE.Vector3(5, 0, 0), s: 1 }; d.to = { p: new THREE.Vector3(9, 0, 0), s: 1 }; d.t0 = 0;
  frame();
  assert.equal(d.frozen, undefined);
  assert.equal(a.mesh.matrixAutoUpdate, true);
  assert.equal(a.obj.updateMatrixWorld, THREE.Object3D.prototype.updateMatrixWorld, 'the prototype method is back');
  assert.deepEqual(worldPos(a.mesh).toArray(), [9, 0.5, 0]);
});

test('phone: if what frozen things hang from moves, all of them thaw', async () => {
  const { put, frame, inner } = await layerFor(true);
  const a = put('a', [5, 0, 0]), b = put('b', [-5, 0, 0]);
  frame();
  inner.thingsGroup.position.set(0, 1, 0); inner.thingsGroup.updateMatrixWorld();
  frame();
  // thawed in the walk then (still settled) frozen again against the new parent matrix
  assert.deepEqual(worldPos(a.mesh).toArray(), [5, 1.5, 0]);
  assert.deepEqual(worldPos(b.mesh).toArray(), [-5, 1.5, 0]);
});

test('phone: skinned or clip-animated things never freeze', async () => {
  const { put, frame } = await layerFor(true);
  const hook = new THREE.Object3D(); hook.userData.animates = true;
  const a = put('a', [0, 0, 0], 1, hook);
  const skin = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const b = put('b', [2, 0, 0], 1, skin);
  frame(); frame();
  for (const t of [a, b]) { assert.equal(t.d().frozen, undefined); assert.equal(t.d().noFreeze, true); assert.equal(t.mesh.matrixAutoUpdate, true); }
});

test('phone: render-time cull - off screen (except shadow-map frames) and sub-pixel frozen things are hidden, then restored', async () => {
  const { layer, put, frame } = await layerFor(true);
  const ahead = put('ahead', [0, 0, -10]), behind = put('behind', [0, 0, 10]), speck = put('speck', [0, 0, -900], 0.01);
  frame();
  const cam = new THREE.PerspectiveCamera(60, 390 / 844, 0.1, 2000); cam.position.set(0, 0.5, 0); cam.lookAt(0, 0.5, -1);
  layer.cull(cam, 844, false);
  assert.equal(ahead.obj.visible, true);
  assert.equal(behind.obj.visible, false, 'off screen: not drawn');
  assert.equal(speck.obj.visible, false, 'under cullPx: not drawn');
  assert.equal(layer.cullStats.culled, 2);
  assert.equal(behind.d().offscreen, true);
  layer.uncull();
  assert.deepEqual([ahead, behind, speck].map((t) => t.obj.visible), [true, true, true], 'uncull restores');
  layer.cull(cam, 844, true);
  assert.equal(behind.obj.visible, true, 'a shadow-map frame keeps off-screen casters');
  assert.equal(speck.obj.visible, false);
  layer.uncull();
  // a thing already hidden (an interior storey) is left alone and not restored to visible
  behind.obj.visible = false; layer.cull(cam, 844, false); layer.uncull();
  assert.equal(behind.obj.visible, false);
});

test('phone: a thing whose only child is a frame hook (no extent yet) is never culled, so its hook runs', async () => {
  const { layer, inner, frame } = await layerFor(true);
  const obj = new THREE.Group(); obj.position.set(0, 0, -300);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); geo.setDrawRange(0, 0);
  obj.add(new THREE.Mesh(geo)); inner.thingsGroup.add(obj);
  const p = new THREE.Vector3(0, 0, -300);
  inner.drawn.set('lod', { settled: true, obj, from: { p, s: 1 }, to: { p: p.clone(), s: 1 }, t0: 0, dur: 0.001, defHash: 'lod' });
  frame();
  assert.ok(inner.drawn.get('lod')!.frozen, 'frozen');
  assert.equal(inner.drawn.get('lod')!.sphere, undefined, 'no sphere: a point has no size to cull by');
  const cam = new THREE.PerspectiveCamera(60, 390 / 844, 0.1, 2000); cam.position.set(0, 0.5, 0); cam.lookAt(0, 0.5, -1);
  layer.cull(cam, 844, false);
  assert.equal(obj.visible, true, 'drawn, so its hook can choose and load the model');
  layer.uncull();
});

test('desktop (freezeSettled off): nothing freezes and cull is a no-op', async () => {
  const { layer, put, frame } = await layerFor(false);
  const behind = put('behind', [0, 0, 10]);
  frame(); frame();
  assert.equal(behind.d().frozen, undefined);
  assert.equal(behind.mesh.matrixAutoUpdate, true);
  assert.equal(behind.obj.updateMatrixWorld, THREE.Object3D.prototype.updateMatrixWorld);
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000); cam.lookAt(0, 0, -1);
  layer.cull(cam, 900, false);
  assert.equal(behind.obj.visible, true);
  assert.equal(layer.cullStats.culled, 0);
});

test('interior storeys: a thing on a storey above the building\'s cut is hidden; the host is found again after a redraw', async () => {
  const { layer, inner, put, frame } = await layerFor(true);
  const host = put('house', [0, 0, 0]);
  let cut = 0; host.obj.userData.interior = { cut: () => cut, floorOf: { up: 1, down: 0 } };
  const up = put('lamp-up', [0, 3, 0]), down = put('lamp-down', [1, 0, 0]);
  const ent = (id: string, parent: string, slot?: string) => [id, { id, def: 'x@1', in: { parent, ...(slot ? { slot } : {}) } }] as const;
  (inner as unknown as { model: unknown }).model = { entities: new Map([ent('house', 'world'), ent('lamp-up', 'house', 'up'), ent('lamp-down', 'house', 'down')]), resolvedDef: () => null };
  frame(); frame();
  assert.equal(up.obj.visible, false, 'storey 1 above cut 0');
  assert.equal(down.obj.visible, true);
  cut = 1; frame(); frame();
  assert.equal(up.obj.visible, true, 'the cut moved up');
  // the building is redrawn (new object, same id): its things follow the new one's cut
  const again = put('house', [0, 0, 0]); inner.thingsGroup.remove(host.obj);
  again.obj.userData.interior = { cut: () => 0, floorOf: { up: 1, down: 0 } };
  frame(); frame();
  assert.equal(up.obj.visible, false);
  void layer;
});

// PERF-BATCH: the static batcher's roots and revision (LiveWorld re-prepares entity batches when the revision changes).
test('static batch roots are the frozen still things; freeze, thaw, hide and show move the revision', async () => {
  const { layer, put, frame } = await layerFor(true);
  const a = put('a', [5, 0, 0]), b = put('b', [9, 0, 0]);
  const inner = layer as unknown as { staticRevision: number };
  assert.deepEqual(layer.staticBatchRoots(), []);
  const r0 = inner.staticRevision; frame();
  assert.ok(a.d().frozen && b.d().frozen); assert.ok(inner.staticRevision > r0);
  assert.deepEqual(layer.staticBatchRoots(), [a.obj, b.obj]);
  const r1 = inner.staticRevision; frame(); assert.equal(inner.staticRevision, r1);  // nothing changed: nothing to re-prepare
  b.d().settled = false; frame();  // b moves: thawed and marked dynamic, out of the roots until it freezes again
  assert.ok(!b.d().frozen); assert.equal(b.obj.userData.renderDynamic, true); assert.ok(inner.staticRevision > r1);
  assert.deepEqual(layer.staticBatchRoots(), [a.obj]);
  b.d().settled = true; frame(); assert.ok(b.d().frozen); assert.equal(b.obj.userData.renderDynamic, undefined);
  assert.deepEqual(layer.staticBatchRoots(), [a.obj, b.obj]);
});
