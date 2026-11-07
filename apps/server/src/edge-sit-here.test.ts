// D2 (playtest 2026-10-25, ROOT-CAUSES §C D2): "sit down" resolved to sit:here, the nearest free seat within 30 m, so 3 of 3
// batteries walked ~30 m to a kitchen chair in Eden House 1. "Here" now means here: a seat in the Soul's own room, or
// within 8 m with no enclosure boundary between; otherwise sit:here sits on the ground where the Soul stands. Named seats
// ("sit on the bench") keep their reach (edge-far-seat.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {fixture, invite, accept, factory} from '../test/native-owner-fixture.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import type {EdgeSoul} from './edge/contract.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';

test('D2: sit:here takes a bench 2.5 m away outdoors, but not one 12 m away (on the ground instead); "sit on the bench" still walks there', {timeout: 300000}, async t => {
  const f = fixture(':memory:', factory, {durableClockV1: true});
  f.brain.quiesce();
  t.after(() => {f.brain.quiesce(); f.host.stop(); f.db.close();});
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {}});
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({host: f.host, god, edge, log: () => {}});
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'sit here'}));
  const soul: EdgeSoul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  await settle(3);
  const me = (f.host.engine.world.entities as Record<string, {pose: {p: number[]}}>)[soul.entityId]!.pose.p;
  assert.equal(god.act({ops: [{op: 'place', def: coreRef('bench'), name: 'far', p: [me[0] + 12, me[2]]}]}).accepted, true);
  await settle(3);
  const sitHere = () => edge.coreA.binds(soul).caps.find(c => c.id === 'sit:here')!;
  const far = sitHere();
  assert.equal(far.target, undefined, 'a 12 m bench is not here: ' + far.label);
  assert.match(far.label, /on the ground here/);
  const plain = edge.intents.dryRun(soul, {capability: 'sit down'}) as {would?: {capability: string; label: string}};
  assert.equal(plain.would?.capability, 'sit:here');
  assert.match(plain.would!.label, /on the ground here/);
  const named = edge.intents.dryRun(soul, {capability: 'sit on the bench'}) as {would?: {capability: string}};
  assert.notEqual(named.would?.capability, 'sit:here', 'a named bench keeps its own walk-and-sit: ' + JSON.stringify(named));
  assert.equal(god.act({ops: [{op: 'place', def: coreRef('bench'), name: 'near', p: [me[0] + 2.5, me[2]]}]}).accepted, true);
  await settle(3);
  const near = sitHere();
  assert.equal(near.target?.id, god.model.get('near')!.id, 'a 2.5 m bench with no wall between is here: ' + near.label);
  assert.match(near.label, /free seat here/);
});

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';
test('D2 Eden 2026: on the commons lawn sit:here is the free outdoor chair 6 m off (a few steps, no wall between); in a house living room it is the sofa there', {timeout: 900_000, skip: NO_EDEN}, async t => {
  const w = await bootEden();
  t.after(() => w.close());
  const e = () => (w.host.engine.world.entities as Record<string, {pose: {p: number[]}}>)[w.soul.entityId];
  const L = w.edge as unknown as {coreA: {binds(s: unknown): {caps: {id: string; label: string; target?: {id: string}}[]}}; placePathOf(s: string): {id: string}[]};
  const at = async (p: [number, number]) => {e().pose.p = [p[0], e().pose.p[1], p[1]]; await w.settle(2); return L.coreA.binds(w.soul).caps.find(c => c.id === 'sit:here')!;};
  const lawn = await at([15.5, 4.8]);
  assert.ok(lawn.target, 'outdoors, the free chair 6 m off with no wall between is here: ' + lawn.label);
  assert.match(lawn.label, /6 m\)/);
  const room = await at([31.8, 17.2]);
  assert.ok(L.placePathOf(w.soul.soulId).some(p => p.id === 'g-eden-house-1.living'), 'in the living room');
  assert.ok(room.target, 'the living room has a free seat: ' + room.label);
  assert.match(room.label, /eden-house-1/);
});
