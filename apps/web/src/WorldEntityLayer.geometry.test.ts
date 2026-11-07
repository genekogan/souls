import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { WorldModel, coreLibrary, type Entity } from '@souls/world-compiler';
import { StreamRing } from './StreamRing.ts';

type Drawn = { obj: THREE.Object3D; world: boolean; inst?: string; frozen?: unknown };
type Inner = { model: WorldModel; ring: StreamRing; now: number; drawn: Map<string, Drawn>; geoRefs: Map<THREE.BufferGeometry, number>; geometryOwners: Map<THREE.Object3D, unknown>;
  build: (e: Entity) => THREE.Object3D; draw: (e: Entity, ease: boolean, force?: boolean) => void; unload: (id: string) => void; undraw: (id: string) => void; freeze: (d: Drawn) => void };

async function fixture() {
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hook = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hook.deregister());
  const layer = new WorldEntityLayer(p => p), inner = layer as unknown as Inner;
  const model = inner.model = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'geometry' }); model.library = coreLibrary();
  inner.ring = new StreamRing({ inner: 100, outer: 150 }); inner.ring.update(0, 0); inner.now = 1000;
  layer.active = true; layer.motionInstancing = false;
  const a = { id: 'a', name: 'a', def: 'core/bench@1', in: { parent: 'world' }, p: [0, 0, 0] } as Entity;
  const b = { ...a, id: 'b', name: 'b', p: [2, 0, 0] } as Entity;
  model.insert(a); model.insert(b);
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  let disposals = 0; geometry.addEventListener('dispose', () => disposals++);
  const object = (instances = false) => {
    const root = new THREE.Group();
    if (instances) { const mesh = new THREE.InstancedMesh(geometry, material, 1); mesh.setMatrixAt(0, new THREE.Matrix4()); root.add(mesh); }
    else root.add(new THREE.Mesh(geometry, material));
    return root;
  };
  inner.build = () => object();
  return { layer, inner, model, a, b, geometry, material, object, disposals: () => disposals };
}

test('repeated shared-geometry redraws preserve ownership until the last streamed unload', async t => {
  const f = await fixture(); t.after(() => { f.layer.dispose(); f.material.dispose(); });
  f.inner.draw(f.a, false); f.inner.draw(f.b, false);
  for (let n = 0; n < 6; n++) f.inner.draw(f.a, false, true);
  assert.equal(f.inner.geoRefs.get(f.geometry), 2); assert.equal(f.disposals(), 0);
  f.inner.unload(f.b.id); assert.equal(f.inner.geoRefs.get(f.geometry), 1); assert.equal(f.disposals(), 0);
  f.inner.draw(f.a, false, true); assert.equal(f.disposals(), 0, 'retain replacement before releasing the sole previous owner');
  f.inner.unload(f.a.id); assert.equal(f.disposals(), 1); assert.equal(f.inner.geoRefs.size, 0); assert.equal(f.inner.geometryOwners.size, 0);
});

test('ordinary eased removal and layer teardown release their retained geometry exactly once', async t => {
  const f = await fixture(); t.after(() => { f.layer.dispose(); f.material.dispose(); });
  f.inner.draw(f.a, false); f.inner.draw(f.b, false);
  f.inner.undraw(f.a.id); f.layer.update(0.016, 5000);
  assert.equal(f.inner.drawn.has(f.a.id), false); assert.equal(f.inner.geoRefs.get(f.geometry), 1); assert.equal(f.disposals(), 0);
  f.layer.dispose(); assert.equal(f.disposals(), 1); assert.equal(f.inner.geoRefs.size, 0); assert.equal(f.inner.geometryOwners.size, 0);
});

test('an entity instance pool retains its prototype after the last drawn owner unloads', async t => {
  const f = await fixture(); t.after(() => { f.layer.dispose(); f.material.dispose(); });
  f.inner.build = e => { const root = f.object(); if (e.id === f.b.id) root.userData.instanceKey = 'shared-prototype'; return root; };
  f.inner.draw(f.a, false); f.inner.draw(f.b, false);
  assert.equal(f.inner.drawn.get(f.b.id)?.inst, 'shared-prototype');
  f.inner.unload(f.b.id); f.inner.unload(f.a.id);
  assert.equal(f.disposals(), 0, 'the empty pool still owns its prototype'); assert.equal(f.inner.geoRefs.get(f.geometry), 1);
  f.layer.dispose(); assert.equal(f.disposals(), 1); assert.equal(f.inner.geoRefs.size, 0);
});

test('pool growth keeps one prototype owner while replacing its mesh buffers', async t => {
  const f = await fixture(); t.after(() => { f.layer.dispose(); f.material.dispose(); });
  f.inner.build = () => { const root = f.object(); root.userData.instanceKey = 'growing'; return root; };
  const entities = Array.from({ length: 20 }, (_, i) => ({ ...f.a, id: `growing-${i}`, name: `growing-${i}` }));
  for (const e of entities) { f.model.insert(e); f.inner.draw(e, false); }
  f.layer.update(0.016, 1016); // draw registers prototypes; the frame places slots and grows beyond the initial capacity.
  assert.equal(f.layer.instancer.instances, 20); assert.equal(f.inner.geoRefs.get(f.geometry), 1); assert.equal(f.disposals(), 0);
  for (const e of entities) f.inner.unload(e.id);
  assert.equal(f.layer.instancer.instances, 0); assert.equal(f.disposals(), 0);
  f.layer.dispose(); assert.equal(f.disposals(), 1); assert.equal(f.inner.geometryOwners.size, 0);
});

test('scatter and motion pool prototypes outlive removed sources and release at teardown', async t => {
  for (const kind of ['scatter', 'motion']) {
    const f = await fixture(); t.after(() => { f.layer.dispose(); f.material.dispose(); });
    f.inner.build = () => f.object(kind === 'scatter'); f.inner.draw(f.a, false);
    const d = f.inner.drawn.get(f.a.id)!;
    if (kind === 'scatter') { d.world = true; f.inner.freeze(d); assert.equal(f.layer.scatterPools.instances, 1); }
    else { f.layer.motionInstancer.track(d.obj); assert.equal(f.layer.motionInstancer.instances, 1); }
    f.inner.unload(f.a.id);
    assert.equal(kind === 'scatter' ? f.layer.scatterPools.instances : f.layer.motionInstancer.instances, 0);
    assert.equal(f.disposals(), 0, `${kind} pool still retains its prototype`); assert.equal(f.inner.geoRefs.get(f.geometry), 1);
    f.layer.dispose(); assert.equal(f.disposals(), 1); assert.equal(f.inner.geoRefs.size, 0);
  }
});

test('lazy children are retained, shared between owners and detached from listeners on unload', async t => {
  const f = await fixture(); t.after(() => { f.layer.dispose(); f.material.dispose(); });
  f.inner.build = () => new THREE.Group(); f.inner.draw(f.a, false); f.inner.draw(f.b, false);
  const a = f.inner.drawn.get(f.a.id)!.obj, b = f.inner.drawn.get(f.b.id)!.obj;
  const nested = new THREE.Group(); a.add(nested); nested.add(new THREE.Mesh(f.geometry, f.material)); b.add(new THREE.Mesh(f.geometry, f.material));
  assert.equal(f.inner.geoRefs.get(f.geometry), 2);
  f.inner.unload(f.a.id); assert.equal(f.disposals(), 0);
  f.inner.unload(f.b.id); assert.equal(f.disposals(), 1);
  a.add(new THREE.Mesh(f.geometry, f.material)); assert.equal(f.inner.geometryOwners.size, 0, 'a detached abandoned load cannot re-register ownership');
});
