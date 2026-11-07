// SOUL3 duration: {capability: 'sit down', params: {seconds: 10}} resolved to sit:here (the nearest free god-built seat)
// and then sat the engine's default 60 s: a god-built seat's plan is one sit step with no rest after it, and the ledger
// gave the seconds only to pose/rest/wander/gather steps. The seconds are the time seated: the walk to the seat comes
// first and does not use them up. sit:here on such a seat now advertises that seat's own 1..600 s, 60 by default.
// Predeclared (20 ticks/s): seated 10 s = 200 ticks (accept 190..260) after a walk of > 20 ticks from 2.5 m; the default
// 60 s = 1200 (1150..1300); sit:<seat> with 10 s the same 190..260; dance 5 s = 100 ticks (80..160, unchanged control);
// a stand while seated ends a 600 s sit within 200 ticks, not completed.
// D2 (2026-10-25): sit:here takes a seat only when it is here (own room, or within 3 m with no wall between), so the
// bench moved from 8 m to 2.5 m; edge-sit-here.test.ts covers the 8 m bench (on the ground instead).
// World semantics: ordinary "sit down" now names the nearby durable fixture directly; the physical duration contract is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {fixture, invite, accept, factory} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import type {EdgeSoul} from './edge/contract.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';

test('seat duration: sit down with seconds sits that long once seated; default 60 s; sit:<seat>; dance control; bounds; cancel', {timeout: 600000}, async t => {
  const f = fixture(':memory:', factory, {durableClockV1: true});
  f.brain.quiesce();
  t.after(() => {f.brain.quiesce(); f.host.stop(); f.db.close();});
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {}});
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({host: f.host, god, edge, log: () => {}});
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'seat duration'}));
  const soul: EdgeSoul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  await settle(3);
  const body = () => (f.host.engine.world.entities as Record<string, any>)[soul.entityId]!;
  const start = [body().pose.p[0], body().pose.p[2]] as [number, number];
  assert.equal(god.act({ops: [{op: 'place', def: coreRef('bench'), name: 'bench', p: [start[0] + 2.5, start[1]]}]}).accepted, true);
  await settle(3);
  const tick = () => f.host.engine.world.tick, open = (id: string) => ['waiting', 'started'].includes(edge.receipt(soul.soulId, id)!.phase);
  const act = async (input: object) => {const r = await accept(f.host, edge.act(soul, input)) as any; assert.equal(r.accepted, true, JSON.stringify(r)); return r;};
  const home = async () => {
    if (body().human?.activity !== 'idle') {await act({capability: 'stand:here'}); await settle(200);}
    await accept(f.host, f.host.enqueue('edge-relocate', 'test:put', {soulId: soul.soulId, entityId: soul.entityId, to: start})); await settle(20);
  };
  // ticks from accept to seated (the body's `sit` activity) and seated to done
  const timed = async (input: object) => {
    await home(); const out = await act(input), t0 = tick(); let seatedAt: number | null = null;
    for (let i = 0; i < 4000 && open(out.receipt.id); i++) {await settle(1); if (seatedAt === null && body().human?.activity === 'sit') seatedAt = tick();}
    assert.equal(edge.receipt(soul.soulId, out.receipt.id)!.phase, 'completed');
    assert.ok(seatedAt !== null, 'sat down');
    assert.equal(out.receipt.chosen?.target, bench.target?.id, 'the receipt binds the actual bench');
    assert.equal(body().human.activity, 'sit', 'completing the requested duration leaves the fixture seat held');
    assert.ok(f.host.engine.nativeSeatHoldsV1?.(soul.entityId).some(h => h.slot.startsWith(`${bench.target!.id}#`)), 'the exact bench remains physically held');
    return {to: out.resolved?.to ?? out.receipt.capability, walk: seatedAt! - t0, seated: tick() - seatedAt!};
  };
  const {caps} = edge.coreA.binds(soul), here = caps.find(c => c.id === 'sit:here')!, bench = caps.find(c => c.verb === 'sit' && c.id !== 'sit:here')!;
  assert.equal(here.target?.id, bench.target?.id, 'sit:here is the bench');
  assert.deepEqual(here.params, bench.params, 'sit:here advertises the seat\'s own seconds');
  assert.deepEqual(here.params, {seconds: {type: 'integer', min: 1, max: 600, default: 60}});
  // control: a timed dance keeps its seconds
  const dance = await act({capability: 'dance', params: {seconds: 5}}), d0 = tick();
  for (let i = 0; i < 4000 && open(dance.receipt.id); i++) await settle(1);
  const danced = tick() - d0;
  assert.equal(edge.receipt(soul.soulId, dance.receipt.id)!.phase, 'completed', JSON.stringify(edge.receipt(soul.soulId, dance.receipt.id)));
  assert.ok(danced >= 80 && danced <= 160, 'dance 5 s: ' + danced);
  const ten = await timed({capability: 'sit down', params: {seconds: 10}});
  assert.equal(ten.to, bench.id, 'ordinary sit selects the durable nearby fixture directly');
  assert.ok(ten.walk > 20, 'walked to the bench first: ' + JSON.stringify(ten));
  assert.ok(ten.seated >= 190 && ten.seated <= 260, 'seated 10 s after the walk: ' + JSON.stringify(ten));
  const dflt = await timed({capability: 'sit down'});
  assert.ok(dflt.seated >= 1150 && dflt.seated <= 1300, 'seated the default 60 s: ' + JSON.stringify(dflt));
  const byId = await timed({capability: bench.id, params: {seconds: 10}});
  assert.ok(byId.seated >= 190 && byId.seated <= 260, 'sit:<seat> 10 s: ' + JSON.stringify(byId));
  // bounds: the seat's 1..600 integers; outside is refused, never clamped
  await home();
  for (const seconds of [0, 601, 2.5]) {
    const r = await accept(f.host, edge.act(soul, {capability: 'sit down', params: {seconds}})) as any;
    assert.equal(r.accepted, false, JSON.stringify(r)); assert.equal(r.code, 'capability.params');
  }
  // cancellation: standing up while seated ends a long timed sit at once
  await home();
  const long = await act({capability: 'sit down', params: {seconds: 600}});
  for (let i = 0; i < 4000 && body().human?.activity !== 'sit'; i++) await settle(1);
  await settle(40); assert.ok(open(long.receipt.id));
  const c0 = tick(); await act({capability: 'stand:here'});
  for (let i = 0; i < 200 && open(long.receipt.id); i++) await settle(1);
  assert.ok(!open(long.receipt.id) && tick() - c0 < 200, 'cancelled: ' + JSON.stringify(edge.receipt(soul.soulId, long.receipt.id)));
  assert.notEqual(edge.receipt(soul.soulId, long.receipt.id)!.phase, 'completed');
  console.log('seat-duration', JSON.stringify({ten, dflt, byId, danced, cancelTicks: tick() - c0}));
});
