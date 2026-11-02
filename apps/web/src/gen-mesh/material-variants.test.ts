// Lane PERF-MATERIALS: shared materials stay shared. A per-object edit is a cached variant of its source material
// (material-variants.ts), lamp glow levels are variants (motion.ts), and static-merge's merged materials are one per
// distinct values across files (static-merge.ts).
//   node --import=./tools/test-harness/web-loader.mjs --test apps/web/src/gen-mesh/material-variants.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Entity, StoredDef } from '@sim/world-compiler';
import { VARIANT_CAP, variantCount, variantOf } from './material-variants.ts';
import { quantizeGlow, syncLightGlow } from './motion.ts';
import { mergedMaterialCount, mergeStatic } from './static-merge.ts';

test('variantOf: one clone per (source, key), shared, released with its source, capped', () => {
  const base = new THREE.MeshStandardMaterial({ color: '#ff0000', roughness: 0.5 });
  const a = variantOf(base, 'offset', (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -2; });
  const b = variantOf(base, 'offset', (m) => { m.polygonOffsetFactor = -99; });   // never runs: cached
  assert.equal(a, b); assert.notEqual(a, base);
  assert.equal(a.polygonOffsetFactor, -2); assert.equal(base.polygonOffset, false, 'the source is not written');
  assert.equal(a.color.getHexString(), 'ff0000'); assert.equal(a.roughness, 0.5);
  const c = variantOf(base, 'dim', (m) => { m.emissiveIntensity = 0; });
  assert.notEqual(c, a); assert.equal(variantCount(base), 2);
  let disposed = 0; a.addEventListener('dispose', () => disposed++); c.addEventListener('dispose', () => disposed++);
  base.dispose(); assert.equal(disposed, 2, 'variants go with their source'); assert.equal(variantCount(base), 0);
  const other = new THREE.MeshStandardMaterial();
  for (let i = 0; i < VARIANT_CAP + 10; i++) variantOf(other, 'k' + i, () => {});
  assert.equal(variantCount(other), VARIANT_CAP);
  assert.equal(variantCount(new THREE.MeshStandardMaterial()), 0);
});

const bodyLib = new THREE.MeshStandardMaterial({ color: '#777777' });
function lamp(lib: THREE.MeshStandardMaterial, flame = false) {
  const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(), bodyLib);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(), lib);
  if (flame) { const pivot = new THREE.Group(); pivot.name = 'role:flame'; pivot.userData.role = 'flame'; pivot.add(glow); g.add(pivot); } else g.add(glow);
  g.add(body);
  return { g, glow, body };
}
const entity = (id: string, state: Record<string, unknown> = {}) => ({ id, def: 'core/street-lamp@1', in: { parent: 'world' }, by: 'x', born: 0, v: 1, state, seed: 3 } as unknown as Entity);
const lampDef = { name: 'street-lamp', components: { light: { color: '#ffe9c4', intensity: 1 } }, tags: [], make: { kind: 'gen', gen: 'kit/2', args: {} } } as unknown as StoredDef;

test('lamps at the same glow level share one material; off and flame parts are variants of their own', () => {
  const lib = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffe9c4', emissiveIntensity: 1, vertexColors: true });
  lib.userData.kitGlowIntensity = 0.8;
  const a = lamp(lib), b = lamp(lib), c = lamp(lib), f = lamp(lib, true);
  syncLightGlow(a.g, entity('a'), lampDef, null, 100); syncLightGlow(b.g, entity('b'), lampDef, null, 100);
  assert.notEqual(a.glow.material, lib, 'the library material is never written');
  assert.equal(a.glow.material, b.glow.material, 'two lamps at one level draw with one material');
  assert.equal(a.body.material, b.body.material, 'parts without a glow keep the library material');
  assert.equal(lib.emissiveIntensity, 1);
  const level = (a.glow.material as THREE.MeshStandardMaterial).emissiveIntensity;
  assert.equal(level, quantizeGlow(level), 'levels are quantised to ~1% steps');
  assert.ok(level > 0 && level < 2, String(level));
  syncLightGlow(c.g, entity('c', { on: false }), lampDef, null, 100);
  assert.equal((c.glow.material as THREE.MeshStandardMaterial).emissiveIntensity, 0);
  assert.notEqual(c.glow.material, a.glow.material);
  syncLightGlow(f.g, entity('f'), lampDef, null, 100);
  const fm = f.glow.material as THREE.MeshStandardMaterial;
  assert.notEqual(fm, a.glow.material, 'a flame part dims its albedo: its own variant');
  assert.ok(fm.color.r < 0.2 && fm.userData.flameCap, 'dimmed once, not per sync');
  syncLightGlow(f.g, entity('f'), lampDef, null, 101); assert.equal((f.glow.material as THREE.MeshStandardMaterial).color.r, fm.color.r);
  assert.ok(variantCount(lib) <= 4, `variants ${variantCount(lib)}`);
  // a later sync at the same level is a no-op; a different level is another shared variant
  const before = a.glow.material; syncLightGlow(a.g, entity('a'), lampDef, null, 100); assert.equal(a.glow.material, before);
  const seen = new Set<THREE.Material>(); for (let t = 0; t < 40; t++) { syncLightGlow(a.g, entity('a'), lampDef, null, t * 0.37); seen.add(a.glow.material as THREE.Material); }
  assert.ok(seen.size > 1 && seen.size <= 40, `breathing spans a bounded set of quantised levels (${seen.size})`);
});

function model(roughness: number, color: string) {
  const root = new THREE.Group();
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })); m.position.x = i; root.add(m); }
  return root;
}
test('static-merge: models with the same plain material values share one merged material', () => {
  const n0 = mergedMaterialCount();
  const a = model(0.8, '#aa3333'), b = model(0.8, '#33aa33'), c = model(0.6, '#aa3333');
  assert.ok(mergeStatic(a, false)); assert.ok(mergeStatic(b, false)); assert.ok(mergeStatic(c, false));
  const mat = (r: THREE.Object3D) => ((r.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh).material as THREE.MeshStandardMaterial);
  assert.equal(mat(a), mat(b), 'the colour is in the vertices: one material for both');
  assert.notEqual(mat(a), mat(c), 'a different roughness is another material');
  assert.equal(mat(a).vertexColors, true); assert.equal(mat(a).roughness, 0.8); assert.equal(mat(c).roughness, 0.6);
  assert.equal(mergedMaterialCount() - n0 <= 2, true);
  assert.ok(mergeStatic(model(0.8, '#000000'), false)); assert.equal(mergedMaterialCount() - n0 <= 2, true, 'a fourth model adds none');
});

// PERF-BATCH round 2: a steady lamp's glow merges by its base material at the shared level; patterned, flame and off glows stay dynamic
test('steady glows merge by base material at a tracked level; an off lamp is dynamic and thaws its frozen owner', async () => {
  const { glowSourceMaterial, mergedGlowMaterial, steadyGlowLevel } = await import('./motion.ts');
  const base = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffe9c4', emissiveIntensity: 1, vertexColors: true }); base.userData.kitGlowIntensity = 0.8;
  const a = lamp(base), b = lamp(base), c = lamp(base);
  syncLightGlow(a.g, entity('a'), lampDef, null, 100); syncLightGlow(b.g, entity('b'), lampDef, null, 100);
  assert.equal(glowSourceMaterial(a.glow), base); assert.equal(glowSourceMaterial(b.glow), base);
  assert.equal(a.glow.userData.renderDynamic, undefined);
  const level = (a.glow.material as THREE.MeshStandardMaterial).emissiveIntensity;
  assert.equal(steadyGlowLevel(base), level);
  const merged = mergedGlowMaterial(base) as THREE.MeshStandardMaterial; assert.ok(merged && merged !== base);
  assert.equal(merged.emissiveIntensity, level); assert.equal(merged.emissive.getHex(), base.emissive.getHex());
  assert.equal(mergedGlowMaterial(base), merged, 'one merged material per base');
  syncLightGlow(a.g, entity('a'), lampDef, null, 101);   // the level moves with the clock: the merged material follows the lamps' variant
  assert.equal(merged.emissiveIntensity, (a.glow.material as THREE.MeshStandardMaterial).emissiveIntensity);
  // an off lamp: dynamic, no source material, its frozen owner asked to thaw
  c.g.userData.frozenDrawn = { thaw: false };
  syncLightGlow(c.g, entity('c', { on: false }), lampDef, null, 100);
  assert.equal(c.glow.userData.renderDynamic, true); assert.equal(glowSourceMaterial(c.glow), null); assert.equal((c.g.userData.frozenDrawn as { thaw: boolean }).thaw, true);
  // switched on again: steady, and the owner thaws once more so the batches take it back
  (c.g.userData.frozenDrawn as { thaw: boolean }).thaw = false;
  syncLightGlow(c.g, entity('c'), lampDef, null, 100);
  assert.equal(c.glow.userData.renderDynamic, undefined); assert.equal(glowSourceMaterial(c.glow), base); assert.equal((c.g.userData.frozenDrawn as { thaw: boolean }).thaw, true);
  assert.equal(mergedGlowMaterial(new THREE.MeshStandardMaterial()), null);
});
