// Floors (2026-10-26, Gene's Chiba report): a body stands on the walkable surface under it. A level-0 floor plate a step
// above the terrain (the Chiba gallery deck, 0.374 m) is stood on inside its footprint and walked onto as a step; outside
// it the body stands on the terrain; a body born or set down on it starts on it, not under it (natives and Souls alike).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { groundFact, groundField } from './ground-bridge.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';
import { emptyGround } from '../../ground/src/index.ts';
import type { Engine } from '@souls/engine-contract';

const factory = await marsFactory(GREEN_FIELD_WORLD);
const fact = groundFact(emptyGround(1000), 4, { paged: process.env.GROUND_PAGED === '1' });
const field = groundField(fact.recipeHash);
const DECK_Y = 0.374, C: [number, number] = [-5, 22], HALF: [number, number] = [6.4, 5.6];
type E = Engine & { installGroundV1(f: unknown): unknown; applyWorldEditV1(ev: WorldEditV1): { hash: string; trapped: string[] }; spawnHuman(o: { id: string; label: string; soul: string; near?: { at: [number, number]; first?: boolean } }): string };
function world(seed: string): E {
  const e = factory.create(factory.genesis(seed)) as never as E;
  e.installGroundV1(fact);
  const ev: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: {}, set: { e_chiba: { surfaces: [{ id: 'e_chiba#f0', level: 0, y: DECK_Y, obb: { c: C, half: HALF, yaw: 0 }, label: 'chiba raised gallery floor' }] } } };
  ev.hash = nextEntityPhysics(undefined, ev).hash;
  assert.deepEqual(e.applyWorldEditV1(ev).trapped, []);
  return e;
}
const pose = (e: Engine, id: string) => (e.world.entities[id] as unknown as { pose: { p: [number, number, number] } }).pose.p;
function walk(e: Engine, actor: string, to: [number, number]) {
  const adm = e.perform({ actor, label: 'test', steps: [{ verb: 'walk_to', params: { to } }] });
  assert.ok(adm.ok, JSON.stringify(adm));
  const ys: { x: number; z: number; y: number }[] = [];
  for (let i = 0; i < 20 * 120; i++) {
    const out = e.step(), p = pose(e, actor); ys.push({ x: p[0], z: p[2], y: p[1] });
    const end = out.programs.find((q) => q.id === adm.id && (q.kind === 'completed' || q.kind === 'failed' || q.kind === 'cancelled'));
    if (end) return { end, ys };
  }
  return { end: undefined, ys };
}
const inside = (x: number, z: number, pad = 0) => Math.abs(x - C[0]) <= HALF[0] - pad && Math.abs(z - C[1]) <= HALF[1] - pad;

test('walking onto a floor plate a step up: on it inside its footprint, the terrain outside, the step spread over ticks', () => {
  const e = world('floor-plate-walk');
  e.spawnHuman({ id: 'h_ember', label: 'Ember', soul: 's_ember', near: { at: [C[0], C[1] + 12], first: true } });
  assert.equal(pose(e, 'h_ember')[1], field.height(pose(e, 'h_ember')[0], pose(e, 'h_ember')[2]), 'born outside: on the terrain');
  const on = walk(e, 'h_ember', C);
  assert.equal(on.end?.kind, 'completed', JSON.stringify(on.end));
  assert.ok(Math.abs(pose(e, 'h_ember')[1] - DECK_Y) < 1e-9, `on the deck: y ${pose(e, 'h_ember')[1]}`);
  for (const s of on.ys) if (inside(s.x, s.z, 0.6)) assert.ok(Math.abs(s.y - DECK_Y) < 1e-9, `under the deck at ${s.x},${s.z}: ${s.y}`);
  for (const s of on.ys) if (!inside(s.x, s.z)) assert.ok(s.y <= DECK_Y + 1e-9);
  const rises = on.ys.map((s, i) => (i ? s.y - on.ys[i - 1].y : 0));
  assert.ok(Math.max(...rises) < DECK_Y - 1e-6, 'the step up is spread over several ticks, never one jump');
  const off = walk(e, 'h_ember', [C[0], C[1] + 12]);
  assert.equal(off.end?.kind, 'completed', JSON.stringify(off.end));
  assert.equal(pose(e, 'h_ember')[1], field.height(C[0], C[1] + 12), 'off the deck: back on the terrain (a step down)');
  assert.deepEqual(e.runtime.violations, []);
});

test('a body born on a floor plate stands on it, not under it (births use the same standing rule as walking)', () => {
  const e = world('floor-plate-birth');
  e.spawnHuman({ id: 'h_nat', label: 'Native', soul: 's_nat', near: { at: [C[0] + 1, C[1] - 1], first: true } });
  const p = pose(e, 'h_nat');
  assert.ok(inside(p[0], p[2], 0.5), `born inside the deck: ${p}`);
  assert.ok(Math.abs(p[1] - DECK_Y) < 1e-9, `born on the deck: y ${p[1]}`);
});

test('sitting on the ground never picks a spot inside a solid: from inside a timber box on the deck, the open spot is clear of it', () => {
  const e = factory.create(factory.genesis('floor-plate-box')) as never as E & { nearestStandableV1(at: [number, number], except?: string, minClear?: number, maxRing?: number): [number, number] | null; standYAtV1(x: number, z: number, level?: number): number | null; clearanceAtV1(x: number, z: number): number };
  e.installGroundV1(fact);
  const box = { id: 'e_box', obb: { c: [C[0] + 2, C[1]] as [number, number], half: [0.25, 0.23] as [number, number], yaw: 0 }, y0: DECK_Y, y1: DECK_Y + 0.41, kind: 'fixture' as const, label: 'presenter timber box' };
  const ev: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: {}, set: {
    e_chiba: { surfaces: [{ id: 'e_chiba#f0', level: 0, y: DECK_Y, obb: { c: C, half: HALF, yaw: 0 }, label: 'chiba raised gallery floor' }] }, e_box: { solids: [box] } } };
  ev.hash = nextEntityPhysics(undefined, ev).hash;
  e.applyWorldEditV1(ev);
  assert.equal(e.clearanceAtV1(box.obb.c[0], box.obb.c[1]), 0, 'no ground to sit on inside the box');
  const spot = e.nearestStandableV1(box.obb.c, undefined, 0.45, 20);
  assert.ok(spot, 'an open spot nearby');
  const [dx, dz] = [Math.abs(spot[0] - box.obb.c[0]) - box.obb.half[0], Math.abs(spot[1] - box.obb.c[1]) - box.obb.half[1]];
  assert.ok(Math.hypot(Math.max(0, dx), Math.max(0, dz)) >= 0.45 - 1e-6, `clear of the box by 0.45 m: ${spot}`);
  assert.ok(Math.abs((e.standYAtV1(spot[0], spot[1], 0) ?? NaN) - DECK_Y) < 1e-9, 'the spot is on the deck, at its height');
});
