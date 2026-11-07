// P4 (party lane): a Soul walks to what the god built, by name, with no flags — through the real host, sequencer,
// edge ledger and compiler. The god builds a fountain, a cottage "rose-house", a plaza with a bench, a pond with a
// bench by it (and an unnamed bench elsewhere); the Soul is told in plain words to walk to the fountain, go into
// rose-house and sit on the bench by the pond. The words go through the ledger's own vocabulary unchanged; the bridge
// only offers `walk:<path>` capabilities and labels seats with what they are and what they are by.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('a Soul walks to the fountain, goes into rose-house and sits on the bench by the pond, by name, without flags', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const r = god.act({ ops: [
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [8, 8] },
    { op: 'place', def: coreRef('cottage'), name: 'rose-house', p: [-14, 8] },
    { op: 'place', tmp: '$pl', def: coreRef('plaza'), name: 'plaza', shape: { area: [[0, -24], [16, -24], [16, -10], [0, -10]] } },
    { op: 'place', def: coreRef('bench'), name: 'bench-2', in: { parent: '$pl' }, p: [6, -16] },
    { op: 'place', def: coreRef('pond'), name: 'pond', shape: { area: [[-26, -24], [-16, -24], [-16, -14], [-26, -14]] }, params: { depth: 0.3, level: 0, edge: 1 } },
    { op: 'place', def: coreRef('bench'), p: [-21, -11], r: Math.PI },
    { op: 'place', def: coreRef('bench'), p: [20, 14] },
  ] }, 'a little town') as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  await settle(3);
  const E = f.host.engine as any, id = (p: string) => god.model.get(p)!.id;

  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const caps = edge.capabilities(soul).map((c) => c.id);
  for (const want of ['walk:fountain', 'walk:rose-house', 'walk:rose-house/living', 'walk:rose-house/kitchen', 'walk:plaza', 'walk:plaza/bench-2', 'walk:pond'])
    assert.ok(caps.includes(want), `${want} offered: ${caps.filter((c) => c.startsWith('walk:')).join(' ')}`);
  const pondBench = [...god.model.entities.values()].find((e) => e.def.includes('bench') && !e.name && Math.hypot((e.p as number[])[0] + 21, (e.p as number[])[(e.p as number[]).length - 1] + 11) < 0.1)!.id;
  const room = () => (runQuery(god.model, { where: [me().pose.p[0], me().pose.p[2]] }).where as any).room;
  const me = () => E.world.entities[row.entity_id];
  const done = async (n = 6000) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const o: any = edge.observe(soul, new Set()); if (i > 40 && !o.self.receipts.length) break; } } await settle(2); };

  // 1. "walk to the fountain"
  const a1: any = await accept(f.host, edge.act(soul, { capability: 'walk to the fountain' }));
  assert.equal(a1.accepted, true, JSON.stringify(a1)); assert.equal(a1.resolved?.to, 'walk:fountain', JSON.stringify(a1.resolved));
  await done();
  assert.ok(Math.hypot(me().pose.p[0] - 8, me().pose.p[2] - 8) < 3.2, `at the fountain: ${me().pose.p}`);

  // 2. "go into rose-house": in at its front door, into the room behind it; then "walk to the kitchen in rose-house"
  const a2: any = await accept(f.host, edge.act(soul, { capability: 'go into rose-house' }));
  assert.equal(a2.accepted, true, JSON.stringify(a2)); assert.equal(a2.resolved?.to, 'walk:rose-house', JSON.stringify(a2.resolved));
  await done();
  assert.deepEqual(room(), { building: 'rose-house', room: 'living', floor: 0 }, `inside: ${me().pose.p}`);
  const a2b: any = await accept(f.host, edge.act(soul, { capability: 'walk to the kitchen in rose-house' }));
  assert.equal(a2b.resolved?.to, 'walk:rose-house/kitchen', JSON.stringify(a2b));
  await done();
  assert.equal(room()?.room, 'kitchen', `in the kitchen: ${me().pose.p}`);

  // 3. "sit on the bench by the pond": the pond's bench, not the plaza's or the unnamed one
  const a3: any = await accept(f.host, edge.act(soul, { capability: 'sit on the bench by the pond', params: { seconds: 300 } }));
  assert.equal(a3.accepted, true, JSON.stringify(a3)); assert.equal(a3.resolved?.to, `sit:${pondBench}`, JSON.stringify(a3.resolved));
  for (let i = 0; i < 6000 && me().human.activity !== 'sit'; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); } }
  assert.equal(me().human.activity, 'sit');
  assert.equal(E.bodyUsesV1(pondBench)?.body, row.entity_id, 'seated on the pond bench');

  // 4. by path, from the seat: walk:plaza/bench-2 (stands up first)
  const a4: any = await accept(f.host, edge.act(soul, { capability: 'walk:plaza/bench-2' }));
  assert.equal(a4.accepted, true, JSON.stringify(a4));
  await done();
  assert.ok(Math.hypot(me().pose.p[0] - 6, me().pose.p[2] + 16) < 2, `at bench-2: ${me().pose.p}`);
  void id;
  assert.deepEqual(E.runtime.violations, []);
});
