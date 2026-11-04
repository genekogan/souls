import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EngineFixtureInstances } from './EngineFixtureInstances.ts';
import { MotionInstancer, NEVER_DRAWN } from './MotionInstancer.ts';

function fixture() {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  root.add(mesh);
  return { root, mesh };
}
function setup() {
  const scene = new THREE.Scene(), instancer = new MotionInstancer();
  scene.add(instancer.group);
  const owner = new EngineFixtureInstances(instancer);
  return { scene, instancer, owner };
}
const sphere = (mesh: THREE.Mesh) => (mesh as THREE.Mesh & { boundingSphere?: THREE.Sphere }).boundingSphere;

test('a missing fixture group draws normally until the bounded lookup retry; attached groups avoid scene traversal', () => {
  const { scene, instancer, owner } = setup();
  const lookup = scene.getObjectByName.bind(scene);
  let lookups = 0;
  scene.getObjectByName = (name: string) => { lookups++; return lookup(name); };
  owner.track(scene);
  const group = new THREE.Group(), f = fixture(); group.name = 'engine fixtures'; group.add(f.root); scene.add(group);
  for (let i = 0; i < 59; i++) owner.track(scene);
  assert.equal(lookups, 1);
  assert.equal(sphere(f.mesh), undefined, 'new fixtures retain their original drawing while lookup waits');
  owner.track(scene); instancer.sync();
  assert.equal(lookups, 2); assert.equal(instancer.instances, 1); assert.equal(sphere(f.mesh), NEVER_DRAWN);
  for (let i = 0; i < 120; i++) owner.track(scene);
  assert.equal(lookups, 2);
  owner.clear(); instancer.dispose();
});

test('removing an ancestor releases old fixture sources and finds its replacement immediately', () => {
  const { scene, instancer, owner } = setup();
  const oldParent = new THREE.Group(), oldGroup = new THREE.Group(), old = fixture();
  oldGroup.name = 'engine fixtures'; oldGroup.add(old.root); oldParent.add(oldGroup); scene.add(oldParent);
  const unrelated = fixture(); scene.add(unrelated.root); instancer.track(unrelated.root);
  owner.track(scene); instancer.sync(); assert.equal(instancer.instances, 2);
  scene.remove(oldParent);
  assert.equal(oldGroup.parent, oldParent, 'the former parent-only cache check cannot detect this removal');
  const nextGroup = new THREE.Group(), next = fixture(); next.root.position.x = 17;
  nextGroup.name = 'engine fixtures'; nextGroup.add(next.root); scene.add(nextGroup);
  owner.track(scene); instancer.sync();
  assert.equal(instancer.has(old.root), false); assert.equal(sphere(old.mesh), undefined);
  assert.equal(instancer.has(next.root), true); assert.equal(instancer.has(unrelated.root), true);
  assert.equal(instancer.instances, 2);
  const pool = instancer.group.children.find(o => (o as THREE.InstancedMesh).geometry === next.mesh.geometry) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(); pool.getMatrixAt(0, matrix); assert.equal(matrix.elements[12], 17);
  owner.clear(); instancer.sync();
  assert.equal(instancer.instances, 1, 'cleanup releases only fixture-owned roots');
  assert.equal(sphere(next.mesh), undefined); instancer.dispose();
});

test('fixture children replaced or reparented to other scenery regain their original drawing', () => {
  const { scene, instancer, owner } = setup();
  const group = new THREE.Group(), other = new THREE.Group(), old = fixture(), next = fixture();
  group.name = 'engine fixtures'; group.add(old.root); scene.add(group, other);
  owner.track(scene); instancer.sync();
  other.add(old.root); group.add(next.root);
  owner.track(scene); instancer.sync();
  assert.equal(old.root.parent, other); assert.equal(old.mesh.visible, true); assert.equal(sphere(old.mesh), undefined);
  assert.equal(instancer.has(old.root), false); assert.equal(instancer.has(next.root), true); assert.equal(instancer.instances, 1);
  group.remove(next.root); owner.track(scene); instancer.sync();
  assert.equal(instancer.instances, 0); assert.equal(sphere(next.mesh), undefined);
  owner.clear(); instancer.dispose();
});

test('renaming an attached group invalidates it and cleanup leaves sources reusable', () => {
  const { scene, instancer, owner } = setup();
  const group = new THREE.Group(), f = fixture(); group.name = 'engine fixtures'; group.add(f.root); scene.add(group);
  owner.track(scene); instancer.sync();
  group.name = 'retired fixtures';
  owner.track(scene); instancer.sync();
  assert.equal(instancer.instances, 0); assert.equal(sphere(f.mesh), undefined);
  owner.clear(); group.name = 'engine fixtures'; owner.track(scene); instancer.sync();
  assert.equal(instancer.instances, 1);
  owner.clear(); owner.clear(); instancer.sync(); assert.equal(instancer.instances, 0); assert.equal(sphere(f.mesh), undefined);
  instancer.dispose();
});
