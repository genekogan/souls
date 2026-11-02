// Offline: node --import=./tools/test-harness/web-loader.mjs --test --test-concurrency=1 apps/web/src/WorldEntityLayer.eventloop.test.ts
// PERF-EVENTLOOP (2026-11-02): update() is event-driven. A settled still thing leaves the per-frame set after one still pass and
// costs nothing until an event wakes it (a write to `settled`, a thaw, a twin, a hand, a redraw); a host's cut or far change
// re-reads only the things of that host; a steady lamp's glow follows the shared level and syncs only when it steps (and only
// when seen); patterned lamps keep their 1/4 rate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';

type Drawn = { settled?: boolean; inst?: string; shown?: boolean; frozen?: THREE.Object3D[]; offscreen?: boolean; glowStale?: boolean; interior?: unknown; motion?: { entity: unknown; def: { components: Record<string, unknown>; tags?: string[] }; yaw: number; glowOnly: boolean }; obj: THREE.Object3D; from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3; s: number }; t0: number; dur: number; defHash: string };
type Inner = { drawn: Map<string, Drawn>; thingsGroup: THREE.Group; model: unknown; seq: number; instancer: { set: (...a: unknown[]) => void }; hostState: Map<unknown, unknown>; refreshVisibility: (id: string, d: Drawn, now: number) => void };

async function layerFor() {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hooks.deregister());
  const { quantizeGlow, steadyGlowAt } = await import('./gen-mesh/motion.ts');
  (await import('./arrival-marks.ts')).arrivalMark('card-done');
  const layer = new WorldEntityLayer((p) => p);
  layer.active = true; layer.freezeSettled = true;
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
  const frame = () => { now += 16; layer.update(0.016, now); scene.updateMatrixWorld(); return now; };
  return { layer, inner, scene, put, frame, quantizeGlow, steadyGlowAt, now: () => now };
}
const ent = (id: string, parent: string, slot?: string) => [id, { id, def: 'x@1', in: { parent, ...(slot ? { slot } : {}) } }] as const;

test('settled still things leave the per-frame set after one pass; a write to `settled` or `thaw` brings one back', async () => {
  const { layer, put, frame } = await layerFor();
  const things = Array.from({ length: 50 }, (_, i) => put(`t${i}`, [i * 3, 0, 0]));
  assert.equal(layer.loopStats.live, 50, 'every new record is visited once');
  frame();
  assert.equal(layer.loopStats.live, 0, 'all settled and still: none is visited again');
  assert.ok(things.every((t) => t.d().frozen), 'the still pass froze them');
  frame(); frame();
  assert.equal(layer.loopStats.live, 0);
  things[7].d().settled = false;
  assert.equal(layer.loopStats.live, 1, 'the write woke it');
  frame();
  assert.equal(things[7].d().frozen, undefined, 'visited: thawed for its move');
  frame();
  assert.ok(things[7].d().frozen, 'settled again (t >= 1) and refrozen on the next still pass');
  assert.equal(layer.loopStats.live, 0);
  const glb = new THREE.Mesh(new THREE.BoxGeometry()); things[3].mesh.add(glb);   // a child added to a frozen subtree thaws its owner
  assert.equal(layer.loopStats.live, 1);
  frame();
  assert.ok(things[3].d().frozen?.includes(glb)); assert.equal(layer.loopStats.live, 0);
});

test('enabling freezing after the early renderer settled things wakes them for their freeze and batch pass', async () => {
  const { layer, put, frame } = await layerFor();
  layer.freezeSettled = false;
  const things = Array.from({ length: 20 }, (_, i) => put(`early-${i}`, [i * 3, 0, 0]));
  frame(); frame();
  assert.equal(layer.loopStats.live, 0); assert.ok(things.every(t => !t.d().frozen));
  layer.freezeSettled = true;
  assert.equal(layer.loopStats.live, 20);
  frame();
  assert.equal(layer.loopStats.live, 0); assert.ok(things.every(t => t.d().frozen));
  assert.equal(layer.staticBatchRoots().length, 20);
  layer.freezeSettled = true;
  assert.equal(layer.loopStats.live, 0, 'the same setting on subsequent frames does not wake anything');
});

test('a host\'s cut change re-reads only the things of that host; the other host\'s things are not touched', async () => {
  const { layer, inner, put, frame } = await layerFor();
  const reads: string[] = []; const orig = inner.refreshVisibility; inner.refreshVisibility = function (id, d, now) { reads.push(id); return orig.call(this, id, d, now); };
  const sets: unknown[][] = []; inner.instancer.set = (...a: unknown[]) => { sets.push(a); };
  let cutA = 1, cutB = 1;
  const houseA = put('houseA', [0, 0, 0], 6), houseB = put('houseB', [100, 0, 0], 6);
  houseA.obj.userData.interior = { cut: () => cutA, floorOf: { ground: 0, 'floor-1': 1 } };
  houseB.obj.userData.interior = { cut: () => cutB, floorOf: { ground: 0, 'floor-1': 1 } };
  const upA = put('upA', [1, 3, 1], 0.5, { inst: 'chair', shown: true }), downA = put('downA', [2, 0, 1]);
  const upB = put('upB', [101, 3, 1]), downB = put('downB', [102, 0, 1], 0.5, { inst: 'chair', shown: true });
  inner.model = { entities: new Map([ent('houseA', 'world'), ent('houseB', 'world'), ent('upA', 'houseA', 'floor-1'), ent('downA', 'houseA', 'ground'), ent('upB', 'houseB', 'floor-1'), ent('downB', 'houseB', 'ground')]) };
  frame(); frame();
  assert.equal(layer.loopStats.live, 0); assert.equal(layer.loopStats.hosts, 2, 'two hosts, each read once per frame');
  reads.length = 0; sets.length = 0;
  frame(); frame();
  assert.deepEqual(reads, [], 'nothing changed: no thing is read');
  cutA = 0; frame();
  assert.deepEqual(reads.sort(), ['downA', 'upA'], 'only house A\'s things were read');
  assert.equal(sets.length, 1, 'the instanced chair on the cut storey was rewritten once'); assert.equal(upA.d().shown, false);
  assert.equal(downA.obj.visible, true); assert.equal(upB.obj.visible, true); assert.equal(downB.d().shown, true);
  reads.length = 0; frame(); frame();
  assert.deepEqual(reads, []);
  cutB = 0; frame();
  assert.deepEqual(reads.sort(), ['downB', 'upB']); assert.equal(upB.obj.visible, false); assert.equal(sets.length, 1, 'house B\'s instanced chair is on the ground: no write');
  // the phone tier's far check: the viewpoint moves away from house A only
  layer.interiorFrom = new THREE.Vector3(100, 0, 0); layer.interiorRange = 30; reads.length = 0; frame();
  assert.deepEqual(reads.sort(), ['downA', 'upA'], 'house A became far: its things re-read');
  assert.equal(downA.obj.visible, false); assert.equal(downB.d().shown, true);
  layer.interiorFrom = null; reads.length = 0; frame();
  assert.deepEqual(reads.sort(), ['downA', 'upA']); assert.equal(downA.obj.visible, true);
});

test('a hand thaw wakes a settled thing so its changed parts freeze again', async () => {
  const { layer, inner, put, frame } = await layerFor();
  const thing = put('door', [0, 0, 0]); frame();
  assert.equal(layer.loopStats.live, 0);
  (inner as unknown as { thaw: (d: Drawn) => void }).thaw(thing.d());
  thing.mesh.position.x = 2; thing.obj.updateMatrixWorld(true);
  assert.equal(layer.loopStats.live, 1, 'the hand changed a frozen thing outside update');
  frame();
  assert.ok(thing.d().frozen); assert.equal(layer.loopStats.live, 0);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(thing.mesh.matrixWorld).x, 2);
});

test('a parent change at the same world pose re-resolves the interior without restarting its easing', async () => {
  const { layer, inner, put, frame } = await layerFor();
  const a = put('houseA', [0, 0, 0]), b = put('houseB', [0, 0, 0]);
  a.obj.userData.interior = { cut: () => 0, floorOf: { up: 1 } };
  b.obj.userData.interior = { cut: () => 1, floorOf: { up: 1 } };
  const def = { hash: 'test', make: { kind: 'gen', gen: 'none' }, tags: [], components: {} };
  const entities = new Map([ent('houseA', 'world'), ent('houseB', 'world'), ent('chair', 'houseA', 'up')]);
  inner.model = { entities, resolvedDef: () => def, worldPose: () => ({ x: 0, y: 3, z: 0, s: 1, yaw: 0 }) };
  const chair = put('chair', [0, 3, 0], 1, { defHash: 'test:{}:{}:null:0' });
  frame(); frame(); assert.equal(chair.obj.visible, false); assert.equal(layer.loopStats.live, 0);
  const next = ent('chair', 'houseB', 'up')[1]; entities.set('chair', next);
  (inner as unknown as { draw: (e: unknown, ease: boolean) => void }).draw(next, false);
  assert.equal(chair.d().settled, true, 'no easing restarted'); assert.equal(layer.loopStats.live, 1);
  frame(); assert.equal(chair.obj.visible, true, 'the new host shows its upper storey'); assert.equal(layer.loopStats.live, 0);
});

test('a host redrawn (new record, same id) is found again by its things; a removed host shows them; a thing kept in a box is read every frame', async () => {
  const { layer, inner, put, frame } = await layerFor();
  const reads: string[] = []; const orig = inner.refreshVisibility; inner.refreshVisibility = function (id, d, now) { reads.push(id); return orig.call(this, id, d, now); };
  let cut = 0;
  const host = put('house', [0, 0, 0], 6); host.obj.userData.interior = { cut: () => cut, floorOf: { up: 1, down: 0 } };
  const up = put('lamp-up', [0, 3, 0]), down = put('lamp-down', [1, 0, 0]);
  inner.model = { entities: new Map([ent('house', 'world'), ent('lamp-up', 'house', 'up'), ent('lamp-down', 'house', 'down')]) };
  frame(); frame();
  assert.equal(up.obj.visible, false); assert.equal(down.obj.visible, true);
  reads.length = 0;
  const again = put('house', [0, 0, 0], 6); inner.thingsGroup.remove(host.obj);   // the building is drawn again: a new record, a new object
  again.obj.userData.interior = { cut: () => 1, floorOf: { up: 1, down: 0 } };
  frame();
  assert.deepEqual(reads.filter((r) => r !== 'house').sort(), ['lamp-down', 'lamp-up'], 'its things looked for their host again (the new record had its own still pass)');
  assert.equal(up.obj.visible, true, 'the new host\'s cut'); assert.equal(layer.loopStats.hosts, 1, 'the old host record left');
  cut = 0; frame(); frame(); assert.equal(up.obj.visible, true, 'the old host\'s cut no longer matters');
  reads.length = 0; inner.drawn.delete('house'); frame();
  assert.deepEqual(reads.sort(), ['lamp-down', 'lamp-up']); assert.equal(layer.loopStats.hosts, 0);
  (inner as unknown as { keptIn: Map<string, string> }).keptIn.set('lamp-down', 'box');   // entry 42: read every frame (a 200 ms hand window)
  reads.length = 0; frame(); frame(); assert.deepEqual(reads, ['lamp-down', 'lamp-down']);
});

test('steady lamps sync only when the shared glow level steps, and only those seen; patterned lamps keep their 1/4 rate', async () => {
  const { layer, inner, put, frame, quantizeGlow, steadyGlowAt, now } = await layerFor();
  inner.model = null;
  const ticks = new Map<string, number>();
  const lamp = (id: string, at: [number, number, number], components: Record<string, unknown>, state: Record<string, unknown> = { on: true }) => {
    const t = put(id, at, 1, { motion: { entity: { id, seed: 1, def: 'core/lamp@1', state }, def: { components, tags: [] }, yaw: 0, glowOnly: true } });
    t.obj.userData.tick = () => { ticks.set(id, (ticks.get(id) ?? 0) + 1); };
    return t;
  };
  const steady = lamp('steady', [0, 0, 0], { light: { range: 4 } }), steady2 = lamp('steady2', [3, 0, 0], { light: { range: 4 } });
  const blink = lamp('blink', [6, 0, 0], { light: { range: 4, pattern: 'blink' } });
  const off = lamp('off', [9, 0, 0], { light: { range: 4 } }, { on: false });
  frame(); frame();
  assert.equal(layer.loopStats.live, 0, 'lamps are still things');
  assert.deepEqual([layer.loopStats.glowSteady, layer.loopStats.glowAnim], [2, 1], 'a switched-off lamp moves nothing');
  ticks.clear();
  let steps = 0, last = quantizeGlow(steadyGlowAt(now() / 1000));
  for (let i = 0; i < 120; i++) { const t = frame(); const q = quantizeGlow(steadyGlowAt(t / 1000)); if (q !== last) { last = q; steps++; } }
  assert.ok(steps > 0 && steps < 120, `the level stepped ${steps} times in 120 frames`);
  assert.equal(ticks.get('steady'), steps, 'synced once per step'); assert.equal(ticks.get('steady2'), steps);
  assert.equal(ticks.get('blink'), 30, 'patterned: every 4th frame');
  assert.equal(ticks.get('off'), undefined);
  // off screen (the render-time cull says so): not synced at a step, marked stale; synced once when the cull sees it drawn
  steady2.d().offscreen = true; ticks.clear(); steps = 0;
  for (let i = 0; i < 120; i++) { const t = frame(); const q = quantizeGlow(steadyGlowAt(t / 1000)); if (q !== last) { last = q; steps++; } }
  assert.equal(ticks.get('steady'), steps); assert.equal(ticks.get('steady2'), undefined); assert.equal(steady2.d().glowStale, true);
  steady2.d().offscreen = false;
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000); cam.position.set(3, 1, 10); cam.lookAt(3, 0.5, 0);
  layer.cull(cam, 900, false); layer.uncull();
  assert.equal(layer.loopStats.visDirty, 1, 'seen with a stale glow: read at the next update');
  ticks.clear(); const t = frame(); const stepped = quantizeGlow(steadyGlowAt(t / 1000)) !== last ? 1 : 0;
  assert.equal(ticks.get('steady2'), 1 + stepped, 'synced for the stale glow (and once more if the level stepped this frame)'); assert.equal(steady2.d().glowStale, false);
  void off;
});
