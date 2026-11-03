// P1 phones: per-frame costs that were paid every frame without need (world-env light scan, the cover probe asked
// twice). Run: node --test apps/web/test/frame-costs.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';
import { installNightLighting } from '../src/WorldNightLights.ts';
const hooks = registerHooks({ load(url, context, next) {
  if (url !== new URL('../src/world-env.ts', import.meta.url).href) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
} });
const { GodWorldLiving, sharedCoverProbe } = await import('../src/world-env.ts'); hooks.deregister();
installNightLighting();

test('the light scan runs again only when the layer seq or model changes (or after 10 s)', () => {
  let reads = 0;
  const components: { light: { range: number } } = { light: { range: 4 } };
  const mk = () => ({ entities: new Map([['a', { id: 'a', def: 'a@1' }]]), resolvedDef: () => { reads++; return { components }; }, worldPose: () => ({ x: 0, y: 0, z: 0 }) });
  const layer = { active: true, group: new THREE.Group(), model: mk(), groundAt: () => 0, seq: 5 };
  const living = new GodWorldLiving(layer as never);
  living.update(0, 0); assert.equal(reads, 1); assert.equal(living.lights, 1);
  living.update(600, 0); living.update(1200, 0); assert.equal(reads, 1, 'same model, same seq: no scan');
  components.light.range = 8; layer.seq = 6; living.update(1800, 0); assert.equal(reads, 2, 'a world diff rescans');
  layer.model = mk(); living.update(2400, 0); assert.equal(reads, 3, 'a resync (new model) rescans');
  living.update(13000, 0); assert.equal(reads, 4, 'every 10 s regardless');
  living.update(13400, 0); assert.equal(reads, 4, 'and still at most twice a second');
  delete (layer as { seq?: number }).seq; living.update(14000, 0); living.update(14600, 0); assert.equal(reads, 6, 'a layer without a seq scans as before');
  living.dispose();
});

test('the atmosphere and the sound share one cover probe per layer group: one ray for both', () => {
  const group = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10), new THREE.MeshBasicMaterial()); roof.position.y = 3; group.add(roof); group.updateMatrixWorld(true);
  assert.equal(sharedCoverProbe(group), sharedCoverProbe(group));
  assert.notEqual(sharedCoverProbe(group), sharedCoverProbe(new THREE.Group()));
  const layer = { active: true, group, model: null, groundAt: () => 0 };
  const living = new GodWorldLiving(layer as never);
  let rays = 0; const raycast = roof.raycast.bind(roof); roof.raycast = (r, i) => { rays++; raycast(r, i); };
  assert.equal(living.atmosphere().indoors(0, 1, 0), true);
  assert.equal(sharedCoverProbe(group).test(0, 1, 0), true, 'the sound asks the same point');
  assert.equal(rays, 1);
  assert.equal(living.atmosphere().indoors(20, 1, 0), false); assert.equal(rays, 2, 'a new point casts again');
  layer.active = false; assert.equal(living.atmosphere().indoors(0, 1, 0), false, 'an inactive layer is never cover');
  living.dispose();
});

test('PERF-PASSES: a cover probe with candidates asks only them (the layer offers what can be above the point), else its roots', () => {
  const group = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10), new THREE.MeshBasicMaterial()); roof.position.y = 3; group.add(roof);
  const shed = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshBasicMaterial()); shed.position.set(30, 3, 0); group.add(shed); group.updateMatrixWorld(true);
  const asked: number[][] = [];
  const layer = { active: true, group, model: null, groundAt: () => 0, coverCandidates: (x: number, z: number) => { asked.push([x, z]); return Math.abs(x) < 5 ? [roof] : Math.abs(x - 30) < 2 ? [shed] : []; } };
  const living = new GodWorldLiving(layer as never);
  let roofRays = 0, shedRays = 0; const rr = roof.raycast.bind(roof), sr = shed.raycast.bind(shed); roof.raycast = (r, i) => { roofRays++; rr(r, i); }; shed.raycast = (r, i) => { shedRays++; sr(r, i); };
  const probe = sharedCoverProbe(group); probe.candidates = null;
  assert.equal(living.atmosphere().indoors(0, 1, 0), true); assert.deepEqual(asked, [[0, 0]]); assert.equal(roofRays, 1); assert.equal(shedRays, 0, 'the shed was not asked');
  assert.equal(living.atmosphere().indoors(30, 1, 0), true); assert.equal(shedRays, 1); assert.equal(roofRays, 1);
  assert.equal(living.atmosphere().indoors(100, 1, 0), false); assert.equal(roofRays + shedRays, 2, 'no candidates: no rays');
  probe.candidates = null; assert.equal(living.atmosphere().indoors(0, 1, 0), true, 'the living view re-installs the layer\'s candidates'); assert.equal(probe.candidates, layer.coverCandidates);
  living.dispose();
});
