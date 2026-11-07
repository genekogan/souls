// Lane PERF-MATERIALS: one shadow caster per generated static thing (shadow-proxy.ts `generated`), buildings cut back
// to their own casters in the interior view, kit prototypes and instancer pools carry the proxy, and building soups
// share geometry by content (building-kit.ts).
//   node --import=./tools/test-harness/web-loader.mjs --test apps/web/src/gen-mesh/shadow-proxy-generated.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GENERATORS, type Value } from '@souls/generators';
import { CORE_KIT, WorldModel, type Entity } from '@souls/world-compiler';
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import { addShadowProxy, proxiedCasters, setShadowCut, shadowProxyStats, ShadowProxyMesh, trackShadowProxies } from './shadow-proxy.ts';
import { Builder, sharedGeometryCount } from './building-kit.ts';
import { EntityInstancer } from '../EntityInstancer.ts';
import { StaticBatchOwner } from '../rendering/StaticBatchOwner.ts';
import './building.mesh.ts';

const renderer = { info: { render: { frame: 1 } } } as unknown as THREE.WebGLRenderer;
type Hook = (...args: unknown[]) => void;
/** What three does to an object in a pass: onBeforeShadow (shadow pass) / onBeforeRender (main pass) / raycast. */
const shadowPass = (o: THREE.Object3D) => (o.onBeforeShadow as unknown as Hook)(renderer, o, new THREE.Camera(), new THREE.Camera(), (o as THREE.Mesh).geometry, (o as THREE.Mesh).material, null);
const mainDraw = (o: THREE.Object3D, scene: THREE.Scene, cam: THREE.Camera = new THREE.Camera()) => (o.onBeforeRender as unknown as Hook)(renderer, scene, cam, (o as THREE.Mesh).geometry, (o as THREE.Mesh).material, null);
const rayHits = (o: THREE.Object3D, from: THREE.Vector3) => { const hits: THREE.Intersection[] = []; (o.raycast as unknown as Hook)(new THREE.Raycaster(from, new THREE.Vector3(0, 0, 1)), hits); return hits.length; };
const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); }); return out; };
const casters = (o: THREE.Object3D) => meshes(o).filter((m) => m.castShadow);
const proxies = (o: THREE.Object3D) => meshes(o).filter((m) => m.userData.shadowProxy);
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

function thing() {
  const root = new THREE.Group(), lib = new THREE.MeshStandardMaterial({ color: '#888888' });
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lib); m.position.set(i * 2, 0.5, 0); m.castShadow = true; m.name = 'kit:paint:' + i; root.add(m); }
  const pivot = new THREE.Group(); pivot.name = 'role:door'; const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 1), lib); door.castShadow = true; door.name = 'door'; pivot.add(door); root.add(pivot);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: new THREE.Texture() })); face.castShadow = true; face.name = 'sign-face'; root.add(face);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true })); glass.castShadow = false; glass.name = 'kit:glass'; root.add(glass);
  return { root, door, face, glass };
}

test('a generated thing casts as one position-only proxy; role parts and textured faces keep casting themselves', () => {
  const { root, door, face, glass } = thing();
  assert.equal(addShadowProxy(root, { generated: true }), 3);
  const [p] = proxies(root);
  assert.ok(p instanceof ShadowProxyMesh); assert.equal(p.castShadow, true); assert.equal(p.parent, root);
  assert.equal(tris(p.geometry), 36, 'three boxes'); assert.equal(Object.keys(p.geometry.attributes).join(), 'position');
  assert.deepEqual(casters(root).map((m) => m.name).sort(), ['door', 'shadow-proxy', 'sign-face']);
  assert.equal(glass.castShadow, false); assert.equal(door.castShadow, true); assert.equal(face.castShadow, true);
  assert.equal(proxiedCasters(root).length, 3);
  assert.equal(addShadowProxy(root, { generated: true }), 0, 'idempotent');
  // the proxy's world positions are the boxes' own
  p.geometry.computeBoundingBox(); const b = p.geometry.boundingBox!;
  assert.ok(Math.abs(b.min.x + 0.5) < 1e-6 && Math.abs(b.max.x - 4.5) < 1e-6 && Math.abs(b.min.y) < 1e-6 && Math.abs(b.max.y - 1) < 1e-6, JSON.stringify(b));
  // no raycast answer from the proxy
  assert.equal(rayHits(p, new THREE.Vector3(0, 0.5, -5)), 0);
});

test('a clone keeps the proxy class and registers itself with the scene when first drawn; the hub shows it only to the shadow pass', () => {
  const { root } = thing(); addShadowProxy(root, { generated: true });
  const copy = root.clone(true), scene = new THREE.Scene(); scene.add(copy);
  const [p] = proxies(copy);
  assert.ok(p instanceof ShadowProxyMesh); assert.notEqual(p, proxies(root)[0]); assert.equal(p.geometry, proxies(root)[0].geometry, 'geometry shared with the template');
  assert.equal(p.visible, true, 'drawn once (nothing) until the hub knows it');
  mainDraw(p, scene);
  assert.equal(p.visible, false); assert.equal(shadowProxyStats(scene).proxies, 1);
  const hook = scene.children[0] as THREE.Mesh; assert.equal(hook.name, 'shadow-proxy hook');
  shadowPass(hook); assert.equal(p.visible, true, 'on for the shadow pass');
  mainDraw(hook, scene); assert.equal(p.visible, false, 'off again for the main pass');
  scene.remove(copy); shadowPass(hook);
  assert.equal(shadowProxyStats(scene).proxies, 0, 'a removed thing leaves the hub');
});

test('a cut hands the shadow back to the casters while it lasts', () => {
  const { root } = thing(); addShadowProxy(root, { generated: true });
  const scene = new THREE.Scene(); scene.add(root); trackShadowProxies(root);
  const [p] = proxies(root), own = proxiedCasters(root); let cut = false;
  setShadowCut(p, own, () => cut);
  const hook = scene.children[0] as THREE.Mesh, pass = () => shadowPass(hook);
  pass(); assert.equal(p.visible, true); assert.ok(own.every((m) => !m.castShadow)); assert.equal(shadowProxyStats(scene).cut, 0);
  cut = true; pass(); assert.equal(p.visible, false); assert.ok(own.every((m) => m.castShadow)); assert.equal(shadowProxyStats(scene).cut, 1);
  own[0].castShadow = false;   // a render-time pass restored the flag: re-asserted next pass
  cut = false; pass(); assert.equal(p.visible, true); assert.ok(own.every((m) => !m.castShadow));
});

function building(name: string, extra: Record<string, unknown> = {}, canonicalContext = false) {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'sp' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const def = w.def(`core/${name}@1`)!;
  const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
  Object.assign(params, extra);
  const e = { id: 'b-' + name, def: def.ref, in: { parent: 'world' }, by: 'b1', born: 0, v: 1, params } as Entity;
  const ctx = { canonicalContext, def, entity: e, params, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked: w.bake(def, params as Record<string, Value>, 7), model: w, materials: new MaterialLib(), tint: (_k: string, f: string) => f } as unknown as MeshCtx;
  return meshFor(def)!.build(ctx)!;
}

test('a building casts as one proxy, cut back to its own casters by the interior view', () => {
  const g = building('cottage', { floors: 2 });
  const ps = proxies(g); assert.equal(ps.length, 1, 'one proxy per building');
  const p = ps[0]; assert.equal(p.parent!.name, 'building-canonical');
  const own = proxiedCasters(g); assert.ok(own.length >= 6, `walls, trim, floors, roof: ${own.length}`);
  assert.deepEqual(casters(g).map((m) => m.name), ['shadow-proxy']);
  const sum = own.reduce((a, m) => a + tris(m.geometry), 0); assert.equal(tris(p.geometry), sum, 'the proxy is every caster triangle');
  // the interior view: hidden storeys are a cut
  const scene = new THREE.Scene(); scene.add(g); trackShadowProxies(g);
  const hook = scene.children[0] as THREE.Mesh, pass = () => shadowPass(hook);
  pass(); assert.equal(p.visible, true); assert.ok(own.every((m) => !m.castShadow), 'whole: the meshes cast nothing');
  const view = (globalThis as { __buildingView?: { hideRoofs?: boolean } });
  view.__buildingView = { hideRoofs: true };
  try {
    const cam = new THREE.PerspectiveCamera(); cam.position.set(100, 50, 100); cam.updateMatrixWorld();
    mainDraw(own[0], scene, cam);   // the main pass decides the cut
    (renderer.info.render as { frame: number }).frame++; pass();
    assert.equal(p.visible, false, 'roofs off: the proxy stands down'); assert.ok(own.every((m) => m.castShadow), 'the meshes cast themselves, hiding the roof');
  } finally { delete view.__buildingView; }
  (renderer.info.render as { frame: number }).frame++;
  const cam = new THREE.PerspectiveCamera(); cam.position.set(100, 50, 100); cam.updateMatrixWorld();
  mainDraw(own[0], scene, cam);
  (renderer.info.render as { frame: number }).frame++; pass();
  assert.equal(p.visible, true); assert.ok(own.every((m) => !m.castShadow));
});

test('buildings share soup geometry by content across templates', () => {
  const n0 = sharedGeometryCount();
  const a = building('cottage'), b = building('cottage', { wall: '#d0c0a0' });
  const ga = meshes(a).filter((m) => !m.userData.shadowProxy), gb = meshes(b).filter((m) => !m.userData.shadowProxy);
  assert.ok(ga.length > 4);
  const shared = ga.filter((m) => gb.some((o) => o.geometry === m.geometry));
  assert.ok(shared.length > 0, 'parts the paint does not touch are one geometry in both');
  assert.ok(sharedGeometryCount() - n0 < ga.length + gb.length, 'fewer geometries than meshes');
  for (const m of ga) assert.ok(m.geometry.userData.sharedKey);
  // the same soup twice is the same object; a different soup is not
  const soup = () => { const x = new Builder(); x.wallSlab(0, 3, 0, 2, -0.1, 0.1, '#aa5544', '#eeeeee', { outer: 0 }); return x.emit(new MaterialLib()); };
  const m1 = soup().groups.values().next().value!.children[0] as THREE.Mesh, m2 = soup().groups.values().next().value!.children[0] as THREE.Mesh;
  assert.equal(m1.geometry, m2.geometry);
  const other = new Builder(); other.wallSlab(0, 3, 0, 2.5, -0.1, 0.1, '#aa5544', '#eeeeee', { outer: 0 });
  assert.notEqual((other.emit(new MaterialLib()).groups.values().next().value!.children[0] as THREE.Mesh).geometry, m1.geometry);
});

test('an instancer pool built from a prototype with a proxy draws the proxy part only in the shadow pass', () => {
  const { root } = thing(); addShadowProxy(root, { generated: true });
  const inst = new EntityInstancer(), scene = new THREE.Scene(); scene.add(inst.group);
  inst.ensure('k', root); inst.set('k', 'a', new THREE.Vector3(1, 0, 1), 0, 1); inst.set('k', 'b', new THREE.Vector3(5, 0, 1), 0, 1);
  const pool = inst.group.children as THREE.InstancedMesh[];
  const pp = pool.filter((m) => m.userData.shadowProxy); assert.equal(pp.length, 1);
  assert.ok(pool.filter((m) => !m.userData.shadowProxy).every((m) => !m.castShadow || m.name.endsWith(':3') || m.name.endsWith(':4')), 'the merged parts cast nothing');
  assert.equal(pp[0].castShadow, true);
  mainDraw(pp[0], scene);
  assert.equal(pp[0].visible, false); assert.equal(shadowProxyStats(scene).proxies, 1);
  assert.equal(rayHits(pp[0], new THREE.Vector3(1, 0.5, -5)), 0);
});

test('a statically batched proxied thing casts from its cell batch; its proxy stands down while the batch draws', async () => {
  const scene = new THREE.Scene(), root = new THREE.Group(), mat = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(), mat); m.castShadow = true; m.position.x = i * 2; root.add(m); }
  scene.add(root);
  assert.equal(addShadowProxy(root, { generated: true }), 3);
  assert.ok(trackShadowProxies(root, scene));
  const proxy = root.children.find((o) => o.userData.shadowProxy)!, hook = scene.children[0];
  const casters = proxiedCasters(root); assert.equal(casters.length, 3); assert.ok(casters.every((m) => !m.castShadow));
  shadowPass(hook); assert.equal(proxy.visible, true, 'unbatched: the proxy casts');
  const owner = new StaticBatchOwner(scene); await owner.prepare([root], { generation: 1, hideWholeRoots: true });
  const batch = owner.group.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh;
  assert.ok(batch, 'the proxied casters still batch'); assert.equal(batch.castShadow, true, 'the batch casts their shadow');
  assert.ok(!owner.group.children.some((o) => (o as THREE.Mesh).geometry === (proxy as THREE.Mesh).geometry), 'the proxy itself is never merged');
  owner.withRender(() => {
    assert.equal(root.visible, false, 'the whole root (proxy included) hides while its batch draws');
    root.visible = true; for (const m of casters) m.visible = false;   // the mesh-by-mesh case
    shadowPass(hook); assert.equal(proxy.visible, false, 'casters drawn by a batch: the proxy stands down');
    for (const m of casters) m.visible = true; root.visible = false;
  });
  shadowPass(hook); assert.equal(proxy.visible, true, 'after the batch draw the proxy casts again');
  owner.dispose();
});
