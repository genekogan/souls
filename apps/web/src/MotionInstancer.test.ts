// PERF-BATCH round 2: moving things draw as instances that follow their meshes' world matrices each frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MotionInstancer, NEVER_DRAWN, motionInstanceable } from './MotionInstancer.ts';
import { FixtureViews } from '../../../mars/viewer/app/engine-view/fixtures.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';

function duck(geo: THREE.BufferGeometry, mat: THREE.Material, at: number) {
  const g = new THREE.Group(); g.position.set(at, 0, 0);
  const body = new THREE.Mesh(geo, mat); body.name = 'kit:solid'; body.castShadow = true;
  const pivot = new THREE.Group(); pivot.name = 'role:head'; pivot.position.y = 1; const head = new THREE.Mesh(geo, mat); head.castShadow = true; pivot.add(head);
  g.add(body, pivot); return { g, body, head, pivot };
}

test('two ducks of one geometry share a pool per mesh material; slots follow poses; a hidden part is a zero matrix', () => {
  const scene = new THREE.Scene(), inst = new MotionInstancer(); scene.add(inst.group);
  const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshStandardMaterial();
  const a = duck(geo, mat, 10), b = duck(geo, mat, 20); scene.add(a.g, b.g);
  assert.equal(inst.track(a.g), 2); assert.equal(inst.track(b.g), 2);
  assert.equal(inst.draws, 1); assert.equal(inst.instances, 4);
  // the sources stay visible (pickers walk visibility) but leave every frustum through their own bounding sphere
  assert.equal(a.body.visible, true); assert.equal((a.body as { boundingSphere?: THREE.Sphere }).boundingSphere, NEVER_DRAWN); assert.equal(a.body.frustumCulled, true);
  assert.equal(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4()).intersectsObject(a.body), false);
  assert.equal(motionInstanceable(a.body), false, 'an instanced mesh is not placed twice');
  inst.sync();
  const pool = inst.group.children[0] as THREE.InstancedMesh; const m = new THREE.Matrix4();
  pool.getMatrixAt(1, m); assert.deepEqual([m.elements[12], m.elements[13]], [10, 1]);   // a's head at its pivot
  pool.getMatrixAt(3, m); assert.equal(m.elements[12], 20);
  assert.ok(pool.frustumCulled && pool.boundingSphere!.containsPoint(new THREE.Vector3(20, 1, 0)));
  a.g.position.x = 15; a.pivot.rotation.y = 1; inst.sync();
  pool.getMatrixAt(0, m); assert.equal(m.elements[12], 15);
  b.pivot.visible = false; inst.sync(); pool.getMatrixAt(3, m); assert.equal(m.elements[0], 0);
  b.pivot.visible = true; b.g.visible = false; inst.sync(); pool.getMatrixAt(2, m); assert.equal(m.elements[0], 0);
  b.g.visible = true; inst.sync(); pool.getMatrixAt(2, m); assert.equal(m.elements[12], 20);
  // a material swap moves the mesh to another pool
  a.head.material = new THREE.MeshStandardMaterial({ color: 0xff0000 }); inst.sync();
  assert.equal(inst.draws, 2); pool.getMatrixAt(1, m); assert.equal(m.elements[0], 0);
  // a root removed from the scene is forgotten at the next sync; its meshes draw by themselves again
  scene.remove(b.g); inst.sync();
  assert.equal(inst.roots, 1); assert.equal(inst.instances, 2); assert.equal((b.body as { boundingSphere?: THREE.Sphere }).boundingSphere, undefined);
  inst.dispose(); assert.equal((a.body as { boundingSphere?: THREE.Sphere }).boundingSphere, undefined); assert.equal(inst.draws, 0);
});

test('skinned, hooked and multi-material meshes are left alone', () => {
  const geo = new THREE.BoxGeometry(), mat = new THREE.MeshStandardMaterial();
  const hooked = new THREE.Mesh(geo, mat); hooked.onBeforeRender = () => {};
  const multi = new THREE.Mesh(geo, [mat, mat]);
  const skinned = new THREE.SkinnedMesh(geo, mat);
  assert.equal(motionInstanceable(hooked), false); assert.equal(motionInstanceable(multi), false); assert.equal(motionInstanceable(skinned), false);
  assert.equal(motionInstanceable(new THREE.Mesh(geo, mat)), true);
});


test('real FixtureViews stock updates release detached nested meshes and instance exactly their replacements', () => {
  const scene = new THREE.Scene(), inst = new MotionInstancer(), views = new FixtureViews();
  scene.add(inst.group, views.group);
  const contents = { food: 'stock:beam-12ft', fraction: .5, count: 10 };
  const stock: Entity = { id: 'stock', def: 'stack-beam-12ft', kind: 'fixture', pose: { p: [7, 0, 3], yaw: 0 }, support: { kind: 'ground' }, contents };
  const world = { entities: { stock } };
  const meshes = () => { const out: THREE.Mesh[] = []; views.group.traverse(o => { if (o instanceof THREE.Mesh) out.push(o); }); return out; };
  views.onTick(world);
  const before = meshes(), root = views.group.children[0];
  inst.trackChildren(views.group); inst.sync();
  assert.equal(inst.instances, before.length);
  contents.count = 1; contents.fraction = .05;
  views.onTick(world); // onTick -> fillStack -> nested group.clear()/add(), with the same tracked fixture root
  assert.equal(views.group.children[0], root);
  const after = meshes(), retired = before.filter(m => !after.includes(m)), added = after.filter(m => !before.includes(m));
  assert.ok(retired.length > 0 && added.length > 0);
  assert.ok(retired.every(m => m.parent === null));
  inst.trackChildren(views.group); inst.sync();
  assert.equal(inst.instances, after.length, 'no retired stock remains in pools');
  for (const m of retired) assert.equal((m as { boundingSphere?: THREE.Sphere }).boundingSphere, undefined);
  for (const m of after) assert.equal((m as { boundingSphere?: THREE.Sphere }).boundingSphere, NEVER_DRAWN, 'every actual replacement leaves the source draw exactly once');
  const key = (geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4) => `${geometry.uuid}|${material.uuid}|${matrix.toArray().join(',')}`;
  const pooled: string[] = [], matrix = new THREE.Matrix4();
  for (const o of inst.group.children) {
    const pool = o as THREE.InstancedMesh;
    if (!pool.visible) continue;
    for (let i = 0; i < pool.count; i++) {
      pool.getMatrixAt(i, matrix);
      if (matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0) continue;
      pooled.push(key(pool.geometry, pool.material as THREE.Material, matrix));
    }
  }
  // Instance matrices use Float32Array; compare against the same precision as WebGL receives.
  const drawn = after.map(m => key(m.geometry, m.material as THREE.Material, new THREE.Matrix4().fromArray(new Float32Array(m.matrixWorld.elements))));
  assert.deepEqual(pooled.sort(), drawn.sort(), 'pool geometry, material and pose match only current real fixture meshes');
  inst.dispose(); views.dispose();
});
