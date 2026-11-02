// Offline: node --import=./tools/test-harness/web-loader.mjs --test apps/web/src/WorldEntityLayer.stream.test.ts
// Lane PERF-STREAM: under a ring the layer builds only what is within `inner` of the camera, unloads what the camera left
// beyond `outer` (out of the scene, its instance slot and the batches at once) and builds it again when it comes back; a
// diff's new thing is drawn only when it is near; the model keeps every record throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { WorldModel, coreLibrary, applyBatch, type Entity, type StoredDef } from '@sim/world-compiler';
import { StreamRing } from './StreamRing.ts';

type Inner = { model: WorldModel; ring: StreamRing | null; streaming: unknown; streamOption: () => { inner: number; outer: number } | null; ringSet: (e: Entity, def: StoredDef) => void; drawn: Map<string, { obj: THREE.Object3D; inst?: string }>; now: number; seq: number; signal: AbortSignal; thingsGroup: THREE.Group };

async function fixture(inner = 50, outer = 80) {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hook = registerHooks({ load(url, ctx, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, ctx); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hook.deregister()); await import('./gen-mesh/kit.mesh.ts');
  const model = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'stream' }); model.library = coreLibrary();
  const r = applyBatch(model, { ops: [{ op: 'place', def: 'core/floor-lamp@2', name: 'near', p: [3, 0] }, { op: 'place', def: 'core/floor-lamp@2', name: 'mid', p: [60, 0] }, { op: 'place', def: 'core/floor-lamp@2', name: 'far', p: [300, 0] }] }, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const layer = new WorldEntityLayer((p) => p), self = layer as unknown as Inner;
  self.model = model; layer.active = true; layer.freezeSettled = true; self.seq = 10; self.now = 1000; self.signal = new AbortController().signal;
  self.streaming = { inner, outer }; self.ring = new StreamRing({ inner, outer, step: 0 });
  for (const e of model.entities.values()) self.ringSet(e, model.resolvedDef(e.def)!);
  const scene = new THREE.Scene(); scene.add(layer.group);
  let now = 1000;
  const frame = (eye: [number, number, number]) => { now += 16; self.now = now; layer.streamFrom(new THREE.Vector3(...eye)); layer.update(0.016, now); scene.updateMatrixWorld(); };
  const byName = (n: string) => [...model.entities.values()].find((e) => e.name === n)!;
  const drawnNames = () => [...self.drawn.keys()].map((id) => model.entities.get(id)?.name ?? id).sort();
  return { layer, self, model, frame, byName, drawnNames, scene };
}

test('the ring builds what is near the camera, unloads what it leaves, rebuilds what it returns to', async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) f.frame([0, 10, 0]);
  assert.deepEqual(f.drawnNames(), ['near'], 'only the lamp within 50 m is built (mid at 60 m, far at 300 m are records only)');
  assert.equal(f.model.entities.size, 3, 'the model keeps every record');
  assert.equal(f.layer.streamStats.built, 1);
  const nearObj = f.self.drawn.get(f.byName('near').id)!;
  // the camera walks to x = 60: mid enters (within 50), near at 60 m stays (within outer 80)
  for (let i = 0; i < 3; i++) f.frame([60, 10, 0]);
  assert.deepEqual(f.drawnNames(), ['mid', 'near']);
  // on to x = 120: near is 117 m away (beyond outer): unloaded at once; mid at 60 m stays
  for (let i = 0; i < 3; i++) f.frame([120, 10, 0]);
  assert.deepEqual(f.drawnNames(), ['mid']);
  assert.equal(f.layer.streamStats.unloaded, 1);
  const inScene = nearObj.inst ? f.layer.instancer.instances : f.self.thingsGroup.children.includes(nearObj.obj);
  assert.ok(nearObj.inst ? inScene === 1 : !inScene, 'the unloaded lamp is out of the scene (or its instance slot freed)');
  assert.equal(f.layer.streamState(f.byName('near').id)?.wanted, false);
  // and back: near is built again (a fresh object), far still never
  for (let i = 0; i < 3; i++) f.frame([0, 10, 0]);
  assert.deepEqual(f.drawnNames(), ['mid', 'near']);
  assert.equal(f.layer.streamStats.built, 3);
  assert.ok(f.layer.streamState(f.byName('far').id)?.ringed && !f.layer.streamState(f.byName('far').id)?.drawn);
});

test('a diff draws a new thing only when it is near the camera; a far one waits in the model until the camera comes', async () => {
  const f = await fixture();
  for (let i = 0; i < 2; i++) f.frame([0, 10, 0]);
  const lamp = f.byName('near');
  const diff = (seq: number, e: Entity) => f.layer.applyEdge([{ type: 'edge', kind: 'world-diff', seq, by: 'god', diff: { upserts: [e], removes: [], defs: [], tiles: [] } } as never]);
  diff(11, { ...lamp, id: 'e_newnear00', name: 'newnear', p: [10, 0, 10] } as Entity);
  diff(12, { ...lamp, id: 'e_newfar000', name: 'newfar', p: [500, 0, 500] } as Entity);
  assert.ok(f.model.entities.has('e_newnear00') && f.model.entities.has('e_newfar000'), 'both records are in the model');
  f.frame([0, 10, 0]);
  assert.deepEqual(f.drawnNames(), ['near', 'newnear'], 'the near one is drawn at once (probe), the far one is not');
  for (let i = 0; i < 3; i++) f.frame([500, 10, 500]);
  assert.deepEqual(f.drawnNames(), ['newfar'], 'at the far place only the far one is drawn; the others unloaded');
  // a removal of a never-built far thing is harmless, and the ring forgets it
  f.layer.applyEdge([{ type: 'edge', kind: 'world-diff', seq: 13, by: 'god', diff: { upserts: [], removes: ['e_newnear00'], defs: [], tiles: [] } } as never]);
  assert.equal(f.layer.streamState('e_newnear00')?.ringed, false);
});

test('distance streaming requires an explicit positive radius; world size never enables it', async t => {
  const f = await fixture(); t.after(() => f.layer.dispose());
  // There is no visibility proof for automatically excluding far geometry at the former 12,000-thing threshold.
  Object.defineProperty(f.model.entities, 'size', { get: () => 50_140 });
  const globals = globalThis as unknown as { location: URL }, previous = globals.location;
  t.after(() => { globals.location = previous; });
  for (const query of ['', '?stream=0', '?stream=off', '?stream=auto', '?stream=-1', '?stream=Infinity']) {
    globals.location = new URL(`http://offline.invalid/w/fixture${query}`);
    assert.equal(f.self.streamOption(), null, query || 'no override');
  }
  globals.location = new URL('http://offline.invalid/w/fixture?stream=320');
  assert.deepEqual(f.self.streamOption(), { inner: 320, outer: 416 });
});
