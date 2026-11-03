// PERF-BATCH round 2: scatter instances pool per (geometry, material, cell); owners add and remove whole; bounds follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ScatterPools } from './ScatterPools.ts';

function scatter(geo: THREE.BufferGeometry, mat: THREE.Material, at: [number, number, number][], tint = false) {
  const g = new THREE.Group(); const im = new THREE.InstancedMesh(geo, mat, at.length); im.name = 'scatter:pine'; im.castShadow = true; im.userData.edenWindMode = 'crown';
  const m = new THREE.Matrix4();
  at.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m); if (tint) im.setColorAt(i, new THREE.Color(0.5, 0.25, 0.125)); });
  g.add(im); return { g, im };
}

test('two scatters of one species share a pool per cell; removal frees slots and shows the source again', () => {
  const pools = new ScatterPools(96), geo = new THREE.BoxGeometry(1, 2, 1), mat = new THREE.MeshStandardMaterial();
  const a = scatter(geo, mat, [[10, 0, 10], [20, 0, 20], [150, 0, 10]]), b = scatter(geo, mat, [[30, 0, 30]], true);
  assert.equal(pools.add('a', a.g), 3); assert.equal(pools.add('b', b.g), 1);
  assert.equal(a.im.visible, false); assert.equal(b.im.visible, false);
  assert.equal(pools.poolCount, 2);   // cell (0,0) and cell (1,0)
  assert.equal(pools.instances, 4); assert.equal(pools.draws, 2);
  pools.updateBounds();
  const meshes = pools.group.children as THREE.InstancedMesh[];
  const near = meshes.find((m) => m.boundingSphere!.containsPoint(new THREE.Vector3(10, 1, 10)))!;
  assert.ok(near && near.frustumCulled && near.boundingSphere!.containsPoint(new THREE.Vector3(30, 1, 30)));
  assert.equal(near.material, mat); assert.equal(near.castShadow, true); assert.equal(near.userData.edenWindMode, 'crown');
  // the tinted owner's colour is in the pool; the untinted owner's instances read white
  const c = new THREE.Color(); near.getColorAt(2, c); assert.ok(Math.abs(c.r - 0.5) < 1e-6 && Math.abs(c.b - 0.125) < 1e-6);
  near.getColorAt(0, c); assert.equal(c.r, 1);
  pools.remove('a');
  assert.equal(a.im.visible, true); assert.equal(pools.instances, 1); assert.equal(pools.draws, 1);
  pools.updateBounds();
  const far = meshes.find((m) => m !== near)!; assert.equal(far.visible, false);
  const m = new THREE.Matrix4(); near.getMatrixAt(0, m); assert.equal(m.elements[0], 0);   // freed slot is a zero matrix
  pools.dispose();
});

test('a pool grows past its first capacity and keeps every matrix', () => {
  const pools = new ScatterPools(1000), geo = new THREE.SphereGeometry(1), mat = new THREE.MeshStandardMaterial();
  const at: [number, number, number][] = []; for (let i = 0; i < 40; i++) at.push([i, 0, 0]);
  const s = scatter(geo, mat, at); pools.add('s', s.g); pools.updateBounds();
  const mesh = pools.group.children[0] as THREE.InstancedMesh; assert.ok(mesh.count >= 40);
  const m = new THREE.Matrix4(); for (let i = 0; i < 40; i++) { mesh.getMatrixAt(i, m); assert.equal(m.elements[12], i, `instance ${i} keeps its matrix across growth`); }
  const seen = new Set<number>(); for (let i = 0; i < 40; i++) { mesh.getMatrixAt(i, m); seen.add(m.elements[12]); } assert.equal(seen.size, 40, 'no instance is lost or doubled');
  assert.ok(mesh.boundingSphere!.radius >= 20 && mesh.boundingSphere!.radius < 24);
  pools.dispose();
});
