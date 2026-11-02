// PERF-BAKED-SHADOWS: the sun's cached shadow of still things is redrawn only when the sun turns, the view steps out of
// the margin, the box changes or a still thing changes; the per-frame pass never draws still things.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BAKE_MARGIN_TEXELS, BAKE_REVISION_MS, SunShadowCache, bakeReason, lightAxes, type BakeKey } from './SunShadowCache.ts';
import { bakedSunShadowChunk } from './WorldLook.ts';

const sunDir = (deg: number): [number, number, number] => { const r = deg * Math.PI / 180; return [Math.cos(r) * 0.6, 0.8, Math.sin(r) * 0.6]; };
const key = (over: Partial<BakeKey> = {}): BakeKey => ({ half: 48, mapSize: 2048, cx: 10, cy: 0, cz: -4, dir: sunDir(30), revision: 7, ...over });

test('first frame bakes; an unchanged sun box does not', () => {
  assert.equal(bakeReason(null, key(), 0), 'first');
  assert.equal(bakeReason({ ...key(), at: 0 }, key(), 5000), null);
});

test('the sun turning more than half a degree redraws; less does not', () => {
  const last = { ...key(), at: 0 };
  // 0.6 of the azimuth turn is the angle between the directions (the sun is 37° up)
  assert.equal(bakeReason(last, key({ dir: sunDir(30.7) }), 10), null);
  assert.equal(bakeReason(last, key({ dir: sunDir(31) }), 10), 'sun');
});

test('a box of another size or map size redraws', () => {
  const last = { ...key(), at: 0 };
  assert.equal(bakeReason(last, key({ half: 56 }), 10), 'box');
  assert.equal(bakeReason(last, key({ mapSize: 1024 }), 10), 'box');
});

test('the view moves inside the margin without a redraw and steps out of it with one', () => {
  const last = { ...key(), at: 0 }, texel = 2 * 48 / 2048, [rx, , rz] = lightAxes(last.dir);
  const at = (n: number) => key({ cx: 10 + rx * n * texel, cz: -4 + rz * n * texel });
  assert.equal(bakeReason(last, at(BAKE_MARGIN_TEXELS / 2), 10), null);
  assert.equal(bakeReason(last, at(BAKE_MARGIN_TEXELS), 10), 'step');
  // along the sun's own direction a move changes nothing in its map
  const [dx, dy, dz] = last.dir;
  assert.equal(bakeReason(last, key({ cx: 10 + dx * 20, cy: dy * 20, cz: -4 + dz * 20 }), 10), null);
});

test('a still thing changing redraws, at most every BAKE_REVISION_MS', () => {
  const last = { ...key(), at: 1000 };
  assert.equal(bakeReason(last, key({ revision: 8 }), 1000 + BAKE_REVISION_MS - 1), null);
  assert.equal(bakeReason(last, key({ revision: 8 }), 1000 + BAKE_REVISION_MS), 'statics');
});

test('light axes match the shadow camera three aims at the sun', () => {
  for (const d of [sunDir(0), sunDir(123), [0.1, 0.99, -0.05] as [number, number, number]]) {
    const l = Math.hypot(...d), cam = new THREE.OrthographicCamera();
    cam.position.set(d[0] / l * 80, d[1] / l * 80, d[2] / l * 80); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3(); cam.matrixWorld.extractBasis(x, y, z);
    const a = lightAxes(d);
    assert.ok(Math.abs(a[0] - x.x) + Math.abs(a[1] - x.y) + Math.abs(a[2] - x.z) < 1e-6, 'right');
    assert.ok(Math.abs(a[3] - y.x) + Math.abs(a[4] - y.y) + Math.abs(a[5] - y.z) < 1e-6, 'up');
  }
});

test('the lights chunk shadows the sun with the darker of both maps only for two directional shadows', () => {
  const chunk = bakedSunShadowChunk(THREE.ShaderChunk.lights_fragment_begin);
  assert.ok(chunk.includes('EDEN_BAKED_SUN'));
  assert.ok(chunk.includes('min( getShadow( directionalShadowMap[ i ]'));
  assert.ok(chunk.includes('getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize'));
  assert.ok(chunk.includes('NUM_DIR_LIGHT_SHADOWS != 2'));
  assert.equal(bakedSunShadowChunk(chunk), chunk, 'idempotent');
  assert.equal(bakedSunShadowChunk('changed upstream'), 'changed upstream', 'fails closed');
});

/** A renderer with only a shadow map whose render records who was drawn, and with which lights. */
function rig() {
  const calls: { lights: string[]; drawn: string[] }[] = [];
  const map = { autoUpdate: false, needsUpdate: false, render(lights: THREE.DirectionalLight[], root: THREE.Object3D) {
    if (!this.autoUpdate && !this.needsUpdate) return;
    const drawn: string[] = []; const walk = (o: THREE.Object3D) => { if (!o.visible) return; if ((o as THREE.Mesh).isMesh) drawn.push(o.name); for (const c of o.children) walk(c); };
    walk(root); calls.push({ lights: lights.filter((l) => l.shadow.autoUpdate || l.shadow.needsUpdate).map((l) => l.name), drawn }); this.needsUpdate = false;
  } };
  const renderer = { shadowMap: map } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), baked = new THREE.DirectionalLight();
  sun.name = 'sun'; baked.name = 'baked'; sun.shadow.mapSize.set(2048, 2048); baked.shadow.autoUpdate = false;
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48 }); sun.position.set(48, 64, 0); scene.add(sun, sun.target, baked, baked.target);
  const still = new THREE.Mesh(); still.name = 'still'; const moving = new THREE.Mesh(); moving.name = 'moving';
  scene.add(still, moving);
  const state = { on: true, revision: 1 };
  const cache = new SunShadowCache(renderer, scene, sun, baked, { enabled: () => state.on, statics: () => [still], revision: () => state.revision });
  const frame = (shadow: boolean, now: number) => { map.needsUpdate = shadow; cache.prepare(shadow, now); map.render([sun, baked], scene); };
  return { calls, cache, frame, state, still, map, sun, baked };
}

test('a shadow frame bakes still things into the cached map, then draws only the rest into the sun\'s', () => {
  const { calls, frame, still, baked } = rig();
  frame(true, 0);
  assert.deepEqual(calls, [{ lights: ['baked'], drawn: ['still'] }, { lights: ['sun'], drawn: ['moving'] }]);
  assert.equal(still.visible, true, 'restored after the pass');
  assert.equal(baked.shadow.mapSize.x, 2048 + 2 * BAKE_MARGIN_TEXELS);
  assert.equal((baked.shadow.camera as THREE.OrthographicCamera).right, 48 + BAKE_MARGIN_TEXELS * 96 / 2048);
});

test('later frames reuse the cache until the statics change; frames without shadows draw nothing', () => {
  const { calls, frame, state } = rig();
  frame(true, 0); calls.length = 0;
  frame(false, 16); frame(true, 33);
  assert.deepEqual(calls, [{ lights: ['sun'], drawn: ['moving'] }]);
  calls.length = 0; state.revision++; frame(true, 300);
  assert.deepEqual(calls.map((c) => c.lights[0]), ['baked', 'sun']);
});

test('the sun moving over a degree redraws the cache', () => {
  const { calls, frame, sun } = rig();
  frame(true, 0); calls.length = 0;
  sun.position.set(48, 62, 3); frame(true, 33);
  assert.deepEqual(calls.map((c) => c.lights[0]), ['baked', 'sun']);
});

test('off: the cached map is cleared once and the sun\'s map draws everything', () => {
  const { calls, frame, state, cache } = rig();
  frame(true, 0); calls.length = 0; state.on = false;
  frame(true, 33); frame(true, 66);
  assert.deepEqual(calls, [{ lights: ['baked'], drawn: [] }, { lights: ['sun'], drawn: ['still', 'moving'] }, { lights: ['sun'], drawn: ['still', 'moving'] }]);
  assert.equal(cache.stats.reason, 'off');
});
