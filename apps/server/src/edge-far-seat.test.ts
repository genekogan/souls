// SOULSIM-H F2: "sit on the bench" from 77 m sat the Soul on the ground: god-built things are offered within NEAR (60 m),
// so the only sit was sit:here ("no free seat within 30 m"). The nearest seats beyond NEAR are now offered for sitting,
// so a named seat resolves to its own walk-and-sit; plain "sit down" still sits here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../test/native-owner-fixture.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import type { EdgeSoul } from './edge/contract.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';

test('a named seat beyond 60 m resolves to sit:<seat> (walk and sit); plain sit down stays sit:here; far seats offer nothing else', { timeout: 300000 }, async t => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 1) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', { name: 'Mira', description: 'far seat' }));
  const soul: EdgeSoul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle(3);
  const me = (f.host.engine.world.entities as Record<string, { pose: { p: number[] } }>)[soul.entityId]!.pose.p;
  const placed = god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [me[0] + 80, me[2]] }, { op: 'place', def: coreRef('table'), name: 'table', p: [me[0] + 70, me[2] + 6] }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  await settle(3);
  const { caps } = edge.coreA.binds(soul);
  const far = caps.find(c => c.verb === 'sit' && c.id !== 'sit:here');
  assert.ok(far, 'the far bench is offered: ' + caps.filter(c => c.verb === 'sit').map(c => c.id + ' ' + c.label).join(' | '));
  assert.match(far!.label, /bench.*8\d m/);
  assert.ok(!caps.some(c => /^(pick-up|put-on):/.test(c.id) && c.label.includes('table')), 'far non-seats are not offered');
  const named = edge.intents.dryRun(soul, { capability: 'sit on the bench' }) as { ok: boolean; would?: { capability: string } };
  assert.equal(named.would?.capability, far!.id, JSON.stringify(named));
  const plain = edge.intents.dryRun(soul, { capability: 'sit down' }) as { would?: { capability: string } };
  assert.equal(plain.would?.capability, 'sit:here');
});
