// W2: every flame part burns, whoever made it (fx/flames.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildKit } from '../gen-mesh/kit.mesh.ts';
import { MaterialLib } from '../gen-mesh/materials.ts';
import { flameHint, hasFlames, isFlameShape, mountFlames, flameStats } from './flames.ts';
import type { StoredDef } from '@souls/world-compiler';

const draw = (shapes: unknown[], flameHint = false) => buildKit({ v: 2, shapes } as never, { materials: new MaterialLib(), tint: (key, fallback) => key === 'flame' ? '#ff9a2a' : fallback, params: {}, state: {}, flameHint });
const fires = (o: THREE.Object3D) => { const out: THREE.Object3D[] = []; o.traverse((c) => { if (c.name === 'fire') out.push(c); }); return out; };
const cone = (at: number[], extra: Record<string, unknown> = {}) => ({ kind: 'cone', at, r: 0.1, h: 0.3, ...extra });

test('role:flame, a flame tint, or a warm glow in a def that says fire become a burning flame', () => {
  for (const [shapes, hint] of [[[cone([0, 1, 0], { role: 'flame', tint: 'flame', glow: 1 })], false], [[cone([0, 1, 0], { tint: 'flame', glow: 1 })], false], [[cone([0, 1, 0], { color: '#ff7a18', glow: 1 })], true]] as const) {
    const o = draw([...shapes], hint);
    assert.ok(o.getObjectByName('role:flame'), JSON.stringify(shapes));
    assert.equal(mountFlames(o, 'e1'), true);
    assert.equal(fires(o).length, 1);
    assert.equal(typeof o.userData.fx, 'function');
  }
});

test('a warm glow without a fire word, and a cool glow with one, stay plain glows', () => {
  assert.equal(mountFlames(draw([cone([0, 1, 0], { color: '#ff7a18', glow: 1 })], false), 'e2'), false);
  assert.equal(mountFlames(draw([cone([0, 1, 0], { color: '#8ad0ff', glow: 1 })], true), 'e3'), false);
  assert.equal(isFlameShape({ at: [0, 0, 0], glow: 1, color: '#ffe9c4' }, true, '#ffe9c4'), false, 'cream lamp glass is not a flame');
});

test('separate flames are separate fires (an altar), touching cones are one (a campfire)', () => {
  const altar = draw([cone([-0.6, 1.4, 0], { role: 'flame', tint: 'flame', glow: 1, r: 0.015, h: 0.04 }), cone([0.6, 1.4, 0], { role: 'flame', tint: 'flame', glow: 1, r: 0.015, h: 0.04 })]);
  mountFlames(altar, 'altar'); assert.equal(fires(altar).length, 2);
  const camp = draw([cone([0, 0.45, 0], { role: 'flame', tint: 'flame', glow: 1, r: 0.32, h: 0.8 }), cone([0.12, 0.35, 0.08], { role: 'flame', tint: 'flame', glow: 1, r: 0.16, h: 0.5 })]);
  mountFlames(camp, 'camp'); assert.equal(fires(camp).length, 1);
});

test('defs with flames animate (never instanced); removing the entity disposes its fires', () => {
  const def = (name: string, shapes: unknown[]) => ({ name, tags: [], make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes } } }) as unknown as StoredDef;
  assert.equal(hasFlames(def('core-campfire', [cone([0, 0, 0], { role: 'flame', glow: 1 })])), true);
  assert.equal(hasFlames(def('iron-brazier', [cone([0, 0, 0], { color: '#ff6a10', glow: 1 })])), true);
  assert.equal(hasFlames(def('bench', [cone([0, 0, 0], {})])), false);
  assert.equal(flameHint({ name: 'wall-torch', tags: [] }), true);
  assert.equal(flameHint({ name: 'firehouse', tags: ['fire'] }), true);
  const parent = new THREE.Group(), o = draw([cone([0, 1, 0], { role: 'flame', tint: 'flame', glow: 1 })]);
  const before = flameStats.mounted; mountFlames(o, 'gone'); parent.add(o);
  assert.equal(flameStats.mounted, before + 1);
  parent.remove(o);
  assert.equal(flameStats.mounted, before);
});

test('a chimney stack\'s grey puffs become one moving-smoke source, never a fire; a moving train keeps its puffs', () => {
  const puffs = [0.22, 0.32, 0.42].map((r, i) => ({ kind: 'sphere', at: [-0.2 + i * 0.2, 2.55 + i * 0.45, 0.1 * i], r, role: 'flame', tint: 'smoke' }));
  const shapes = [{ kind: 'box', at: [0, 1, 0], size: [0.5, 2, 0.5] }, ...puffs];
  const kit = (smokeFx: boolean) => buildKit({ v: 2, shapes } as never, { materials: new MaterialLib(), tint: (_k, f) => f, params: {}, state: {}, smokeFx });
  const still = kit(true);
  assert.equal(mountFlames(still, 'stack'), false);
  assert.equal(still.getObjectByName('role:flame'), undefined, 'the puffs are not drawn');
  const src = still.userData.edenSmokeSources as number[][];
  assert.equal(src.length, 1); assert.ok(src[0][1] > 2 && src[0][1] < 2.6, `base of the column, got ${src[0][1]}`);
  const moving = kit(false);
  assert.ok(moving.getObjectByName('role:flame'), 'drawn puffs travel with the train');
  assert.equal(moving.userData.edenSmokeSources, undefined);
});

test('fountain water ripples, stacked basins overflow, and spray shapes fall', async () => {
  const { rippleMaterial, fallingWaterMaterial } = await import('./water.ts');
  const lib = new MaterialLib();
  const o = buildKit({ v: 2, shapes: [
    { kind: 'cyl', at: [0, 0.5, 0], r: 1.8, h: 0.04, material: 'water' }, { kind: 'cyl', at: [0, 1.66, 0], r: 0.7, h: 0.03, material: 'water' },
    { kind: 'cone', at: [0, 2.2, 0], r: 0.1, h: 0.4, tint: 'spray', material: 'water' } ] } as never, { materials: lib, tint: (_k, f) => f, params: {}, state: {} });
  const meshes: THREE.Mesh[] = []; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
  const sheets = meshes.filter((m) => m.name === 'falling water');
  assert.equal(sheets.length, 1, 'the upper basin overflows into the lower one');
  assert.ok(Math.abs(sheets[0].position.y - (0.52 + 1.675) / 2) < 0.02);
  assert.ok(meshes.some((m) => m.material === fallingWaterMaterial('spray')), 'the jet falls');
  const water = meshes.find((m) => m.name.startsWith('kit:water') && !m.name.endsWith('spray'))!;
  assert.equal(water.material, rippleMaterial(lib.get('water', undefined, { vertexColors: true, glow: 0, vertexGlow: true })));
});
