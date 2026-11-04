// W5 provisioning (lane mars): water is finite and moves by hand — tank → watering can → planter — as ordinary object
// actions with honest refusals. Pure transfer maths first, then a Soul doing it in a native world with fake minds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { Hono } from 'hono';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { registerEdgeComms } from '../edge/comms/index.ts';
import { edgeSoulResolver } from '../edge/routes.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { drawWater, waterPlant } from './water.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('water transfers conserve litres and refuse honestly', () => {
  const tank = { id: 't', name: 'tank', level: 0.5, litres: 1000 }, can = { id: 'c', name: 'can', level: 0.25, litres: 10 };
  const d: any = drawWater(tank, can);
  assert.equal(d.litres, 7.5);
  assert.deepEqual(d.set.map((x: any) => [x.id, x.value]), [['t', 0.4925], ['c', 1]]);
  assert.equal((drawWater(tank, null) as any).code, 'water.no-vessel');
  assert.equal((drawWater(tank, { ...can, level: 1 }) as any).code, 'water.vessel-full');
  assert.equal((drawWater({ ...tank, level: 0 }, can) as any).code, 'water.source-empty');
  // a nearly empty tank gives what it has, no more
  const low: any = drawWater({ ...tank, level: 0.003 }, { ...can, level: 0 });
  assert.equal(low.litres, 3); assert.deepEqual(low.set.map((x: any) => x.value), [0, 0.3]); assert.match(low.summary, /all it had/);
  const bed = { id: 'p', name: 'bed', moisture: 0.5, litres: 8 };
  const w: any = waterPlant(bed, { ...can, level: 1 });
  assert.equal(w.litres, 4); assert.deepEqual(w.set.map((x: any) => [x.id, x.value]), [['c', 0.6], ['p', 1]]);
  assert.equal((waterPlant({ ...bed, moisture: 1 }, can) as any).code, 'water.plant-wet');
  assert.equal((waterPlant(bed, { ...can, level: 0 }) as any).code, 'water.vessel-empty');
  assert.equal((waterPlant(bed, null) as any).code, 'water.no-vessel');
});

test('a Soul draws finite Mars tank water; a legacy planter without biology opt-in keeps its complete state', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  // the object framework (comms) carries god things' actions, as in the real server
  const comms = registerEdgeComms(new Hono(), { host: f.host, db: f.db, souls: f.souls, soul: edgeSoulResolver(f.host, f.souls, () => undefined), ledger: edge }, { sweepMs: 0 } as any);
  edge.attachComms(comms as any); t.after(() => comms.close());
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const defs = JSON.parse(readFileSync(new URL('../../../../worlds/patches/mars-water-20261016/defs.json', import.meta.url), 'utf8'));
  const placed: any = god.act({ ops: [...defs.map((def: any) => ({ op: 'define', def })),
    // 6 L left in a 1,500 L tank: one can's worth, not a full one
    { op: 'place', def: 'mars-water-tank@1', name: 'tank', p: [8, 0], state: { level: 0.004 } },
    { op: 'place', def: 'mars-planter@1', name: 'garden-bed', p: [4, 6] },
    { op: 'place', def: 'mars-watering-can@1', name: 'can', p: [3, 0], state: { level: 0 } },
    // a catalogue can (its own fill/empty actions) lying 6 m from the tank: its fill draws only from a source beside it
    { op: 'place', def: 'core/watering-can@1', name: 'old-can', p: [2, -2], state: { level: 0 } }] }, 'water');
  assert.equal(placed.accepted, true, JSON.stringify(placed.failures));
  // G1 (tranche 2026-10-19): Souls see a god edit once the perception catch-up has run (a second after the last edit)
  await settle(30);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'a guest' }));
  const ana = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle(3);
  const id = (n: string) => ([...god.model.entities.values()].find((e: any) => e.name === n) as any).id as string;
  const tank = id('tank'), bed = id('garden-bed'), can = id('can'), oldCan = id('old-can');
  const st = (e: string) => god.model.entities.get(e)!.state as any;
  const originalBed = structuredClone(st(bed));
  const cap = (c: string) => edge.capabilities(ana).find((x: any) => x.id === c) as any;
  const run = async (rid: string) => { for (let i = 0; i < 6000; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const r: any = edge.receipt(ana.soulId, rid); if (r?.outcome) return r; } } return edge.receipt(ana.soulId, rid); };
  const act = async (c: string) => { const a: any = await accept(f.host, edge.act(ana, { capability: c })); assert.equal(a.accepted, true, JSON.stringify(a)); const r: any = await run(a.receipt?.id ?? a.receiptId ?? a.id); await settle(4); return r; };
  const refused = (c: string, code: string) => { const x = cap(c); assert.ok(x, `${c} offered: ${edge.capabilities(ana).map((y: any) => y.id).join(' ')}`); assert.equal(x.available, false, JSON.stringify(x)); assert.equal(x.blocked?.code, code, JSON.stringify(x)); };

  // empty-handed: the tank and the bed say what is missing; the can lying 5 m from the tank does not fill from nothing
  refused(`object:${tank}:draw-water`, 'water.no-vessel');
  refused(`object:${bed}:water`, 'water.biology-disabled');
  refused(`object:${oldCan}:fill`, 'water.no-source');
  assert.match(cap(`object:${tank}:draw-water`).blocked.reason, /not holding a watering can/);

  const pk: any = await act(`pick-up:${can}`);
  assert.equal(pk.phase, 'completed', JSON.stringify(pk));
  const inHand = (when: string) => { const x: any = (f.host.engine as any).world.entities[can]; assert.deepEqual([x?.support?.kind, x?.support?.by], ['in-hand', ana.entityId], `${when}: the can is in Ana's hand (engine) ${JSON.stringify(x?.support)}`); assert.equal(god.model.entities.get(can)!.in.parent, ana.entityId, `${when}: the entity world has the can in her hand too (viewers draw it there)`); };
  await settle(30); inHand('after pick-up');
  const dr: any = await act(`object:${tank}:draw-water`);
  await settle(30); inHand('after drawing water');
  assert.equal(dr.phase, 'completed', JSON.stringify(dr));
  assert.ok(Math.abs(st(can).level - 0.6) < 1e-6, JSON.stringify(st(can)));
  assert.equal(st(tank).level, 0, 'the tank gave its last 6 L');
  refused(`object:${tank}:draw-water`, 'water.source-empty');
  assert.match(cap(`object:${tank}:draw-water`).blocked.reason, /water delivery/);

  const denied: any = await accept(f.host, edge.act(ana, { capability: `object:${bed}:water` }));
  assert.equal(denied.accepted, false, JSON.stringify(denied));
  await settle(30); inHand('after disabled watering refusal');
  assert.deepEqual(st(bed), originalBed, 'unflagged legacy soil is never watered');
  assert.equal(st(can).level, 0.6, 'the refused action spends no water');
  refused(`object:${bed}:water`, 'water.biology-disabled');
  // All 6 L left the tank and remain in the can; opted-in native soil delivery is covered by garden-revival-native.
});
