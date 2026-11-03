// PERF-BATCH: an instance pool is frustum culled as one sphere around its placed instances.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EntityInstancer } from './EntityInstancer.ts';

function proto() { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()); m.position.y = 1; g.add(m); return g; }

test('a pool bounds its instances after set and remove; an empty pool is never culled', () => {
  const inst = new EntityInstancer();
  inst.ensure('bench', proto());
  const mesh = inst.group.children[0] as THREE.InstancedMesh;
  assert.equal(mesh.frustumCulled, false);
  inst.set('bench', 'a', new THREE.Vector3(100, 0, 0), 0, 1); inst.set('bench', 'b', new THREE.Vector3(110, 0, 0), 0, 2);
  inst.updateBounds();
  assert.equal(mesh.frustumCulled, true);
  const s = mesh.boundingSphere!;
  assert.ok(Math.abs(s.center.x - 105) < 1e-6 && Math.abs(s.center.z) < 1e-6);
  // the far instance (scale 2, box 1×2×1 at y 1: radius ≈ 2.45 m from its origin) is inside
  assert.ok(s.containsPoint(new THREE.Vector3(110, 4, 0)) && s.containsPoint(new THREE.Vector3(100, 2, 0)));
  assert.ok(s.radius < 12);
  const before = s.radius;
  inst.updateBounds(); assert.equal(s.radius, before);  // not dirty: unchanged
  inst.remove('bench', 'b'); inst.updateBounds();
  assert.ok(mesh.boundingSphere!.radius < 3 && Math.abs(mesh.boundingSphere!.center.x - 100) < 1e-6);  // the removed slot (zero matrix) is not counted
  inst.remove('bench', 'a'); inst.updateBounds();
  assert.equal(mesh.frustumCulled, false); assert.equal(mesh.boundingSphere, null);
  inst.dispose();
});
