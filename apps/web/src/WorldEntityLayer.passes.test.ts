// Offline: node --import=./tools/test-harness/web-loader.mjs --test --test-concurrency=1 apps/web/src/WorldEntityLayer.passes.test.ts
// PERF-PASSES (2026-11-01): the layer's per-frame passes while the camera moves: the native-ground walk runs rarely, a
// settled instanced thing only re-reads its interior visibility, motion things out of view are animated less often (and
// exactly where world time puts them), and the cover probe asks only the things that can be above a point.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';

type Drawn = { settled?: boolean; inst?: string; shown?: boolean; frozen?: THREE.Object3D[]; sphere?: THREE.Sphere; interior?: unknown; motion?: { entity: unknown; def: { components: Record<string, unknown> }; yaw: number; glowOnly: boolean }; obj: THREE.Object3D; from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3; s: number }; t0: number; dur: number; defHash: string };
type Inner = { drawn: Map<string, Drawn>; thingsGroup: THREE.Group; model: unknown; seq: number; instancer: { set: (...a: unknown[]) => void }; hostState: Map<unknown, unknown> };

async function layerFor(freeze = true) {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hooks.deregister());
  (await import('./arrival-marks.ts')).arrivalMark('card-done');  // motion runs once the arrival is over
  const layer = new WorldEntityLayer((p) => p);
  layer.active = true; layer.freezeSettled = freeze;
  const inner = layer as unknown as Inner;
  const scene = new THREE.Scene(); scene.add(layer.group);
  const put = (id: string, at: [number, number, number], size = 1, extra: Partial<Drawn> = {}) => {
    const obj = new THREE.Group(); obj.position.set(...at);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size)); mesh.position.set(0, size / 2, 0); obj.add(mesh);
    inner.thingsGroup.add(obj);
    const p = new THREE.Vector3(...at);
    const d: Drawn = { settled: true, obj, from: { p, s: 1 }, to: { p: p.clone(), s: 1 }, t0: 0, dur: 0.001, defHash: id, ...extra };
    inner.drawn.set(id, d);
    return { obj, mesh, d: () => inner.drawn.get(id)! };
  };
  let now = 1000;
  const frame = (base?: THREE.Object3D) => { now += 16; layer.update(0.016, now, base); scene.updateMatrixWorld(); };
  return { layer, inner, scene, put, frame };
}
const camera = (at: [number, number, number], look: [number, number, number]) => { const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000); cam.position.set(...at); cam.lookAt(...look); cam.updateMatrixWorld(); return cam; };
const viewerOf = (cam: THREE.PerspectiveCamera) => ({ eye: cam.position.clone(), frustum: new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)) });

test('the native-ground walk runs on the first frame, when the group changes, and every 30th frame, not every frame', async () => {
  const { frame } = await layerFor();
  const base = new THREE.Group(); let walks = 0; const traverse = base.traverse.bind(base); base.traverse = (cb) => { walks++; traverse(cb); };
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10)); base.add(plane);
  frame(base);
  assert.equal(walks, 1); assert.equal(plane.visible, false, 'a native floor plane is hidden');
  for (let i = 0; i < 10; i++) frame(base);
  assert.equal(walks, 1, 'ten still frames: no walk');
  const late = new THREE.Mesh(new THREE.PlaneGeometry(4, 4)); base.add(late); frame(base);
  assert.equal(walks, 2); assert.equal(late.visible, false, 'a plane added later is hidden at once');
  const nested = new THREE.Mesh(new THREE.BoxGeometry()); nested.name = 'outside-ground'; plane.add(nested);
  for (let i = 0; i < 31 && nested.visible; i++) frame(base);
  assert.equal(nested.visible, false, 'a named ground added deeper is hidden within 30 frames'); assert.equal(walks, 3);
});

test('a settled instanced thing re-reads only its interior visibility; its slot is written once when that changes', async () => {
  const { inner, put, frame } = await layerFor();
  const sets: unknown[][] = []; inner.instancer.set = (...a: unknown[]) => { sets.push(a); };
  // a building (interior host) at the origin with two storeys; a chair on floor 1 of it, drawn by the instancer
  const house = put('house', [0, 0, 0], 6); let cut = 1;
  house.obj.userData.interior = { cut: () => cut, floorOf: { ground: 0, 'floor-1': 1 } };
  const chair = put('chair', [1, 3, 1], 0.5, { inst: 'chair', shown: true });
  inner.model = { entities: new Map([['house', { id: 'house', in: { parent: 'world' } }], ['chair', { id: 'chair', in: { parent: 'house', slot: 'floor-1' } }]]) }; inner.seq = 1;
  frame(); frame(); frame();
  assert.equal(sets.length, 0, 'nothing changed: the slot is not rewritten');
  assert.equal(chair.d().shown, true);
  cut = 0; frame();
  assert.equal(sets.length, 1, 'the storey is cut away: one write'); assert.equal(sets[0][4], 0, 'scaled to nothing'); assert.equal(chair.d().shown, false);
  frame(); frame(); assert.equal(sets.length, 1);
  cut = 1; frame();
  assert.equal(sets.length, 2); assert.equal(sets[1][4], 1, 'back at its size'); assert.equal(chair.d().shown, true);
  assert.equal(inner.hostState.size, 1, 'the host was read once this frame');
});

test('motion things out of view animate every 2nd frame (routes, rigs) or 4th (sway, spin); in view every frame; always at world time', async () => {
  const { layer, inner, put, frame } = await layerFor();
  inner.model = null;
  const ticks = new Map<string, number[]>();
  const mover = (id: string, at: [number, number, number], components: Record<string, unknown>, rig = false) => {
    const t = put(id, at, 1, { motion: { entity: { id, seed: 1 }, def: { components }, yaw: 0, glowOnly: false } });
    t.obj.userData.tick = (time: number) => { ticks.set(id, [...(ticks.get(id) ?? []), time]); };
    if (rig) t.obj.userData.rig = {};
    return t;
  };
  mover('fan-ahead', [0, 0, -10], { spin: {} }); mover('fan-behind', [0, 0, 10], { spin: {} }); mover('cat-behind', [3, 0, 12], { route: {} }); mover('dog-behind', [-3, 0, 12], {}, true);
  const cam = camera([0, 1, 0], [0, 1, -1]);
  layer.viewer = viewerOf(cam);
  frame();  // settles (t >= 1) and measures view spheres
  for (const id of ticks.keys()) ticks.set(id, []); layer.motionStats.animated = layer.motionStats.skipped = 0;
  for (let i = 0; i < 16; i++) frame();
  assert.equal(ticks.get('fan-ahead')!.length, 16, 'in view: every frame');
  assert.equal(ticks.get('fan-behind')!.length, 4, 'out of view, phase motion: every 4th');
  assert.equal(ticks.get('cat-behind')!.length, 8, 'out of view, on a route: every 2nd');
  assert.equal(ticks.get('dog-behind')!.length, 8, 'out of view, a creature rig: every 2nd');
  assert.equal(layer.motionStats.animated + layer.motionStats.skipped, 64);
  // world time is passed through: the skipped frames leave no lag in what the thing is told the time is
  const far = ticks.get('fan-behind')!, near = ticks.get('fan-ahead')!;
  assert.ok(far.every((t) => near.includes(t)), 'the same world seconds as an in-view thing animated on that frame');
  layer.viewer = null; for (const id of ticks.keys()) ticks.set(id, []);
  for (let i = 0; i < 4; i++) frame();
  assert.deepEqual([...ticks.values()].map((v) => v.length), [4, 4, 4, 4], 'no viewer (eyes, shots): every frame as before');
});

test('cover candidates: the other groups, frozen things whose circle covers the point, and every unfrozen thing; the upward ray agrees with the whole layer', async () => {
  const { layer, inner, put, frame } = await layerFor();
  const roofed = put('roof', [0, 0, 0], 8), far = put('far', [40, 0, 0], 2), mover = put('mover', [60, 0, 0], 2, { motion: { entity: { id: 'mover', seed: 1 }, def: { components: { sway: {} } }, yaw: 0, glowOnly: false } });
  mover.obj.userData.tick = () => {};
  frame(); frame();
  assert.ok(roofed.d().frozen && far.d().frozen && !mover.d().frozen);
  const under = layer.coverCandidates(1, 1), aside = layer.coverCandidates(20, 0);
  const others = layer.group.children.filter((g) => g !== inner.thingsGroup);
  assert.ok(others.every((g) => under.includes(g) && aside.includes(g)), 'terrain, water, instances, sites, cover always');
  assert.ok(under.includes(roofed.obj) && !under.includes(far.obj) && under.includes(mover.obj));
  assert.ok(!aside.includes(roofed.obj) && !aside.includes(far.obj) && aside.includes(mover.obj), 'nothing frozen covers (20, 0); the unfrozen thing is always asked');
  for (const [x, z] of [[1, 1], [20, 0], [40, 0], [-3.9, 3.9], [4.1, 0]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 0.5, z), new THREE.Vector3(0, 1, 0), 0, 40);
    const whole = ray.intersectObjects([layer.group], true).length > 0, picked = ray.intersectObjects(layer.coverCandidates(x, z), true).length > 0;
    assert.equal(picked, whole, `cover at (${x}, ${z})`);
  }
});
