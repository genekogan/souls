// F3 (rehearsal item 16): a Soul that picks up a god-built thing is seen holding it — the receipt's outcome names it,
// observe says holding, the god's model has it in the body's carry slot — and can put it down again.
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
test('a Soul picks up the god\'s bowl, is seen holding it, and puts it down', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  assert.equal((god.act({ ops: [{ op: 'place', def: coreRef('roundhouse'), name: 'rose-cottage', p: [-16, 0], r: Math.PI / 2 }, { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [6, 0] }] }, 'a cottage') as any).accepted, true);
  const fu: any = runQuery(god.model, { furnish: { ref: 'rose-cottage' } }).furnish;
  assert.equal((god.act({ ops: fu.ops }, 'furnish') as any).accepted, true);
  await settle(3);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'a guest' }));
  const ana = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle(3);
  const run = async (id: string) => { for (let i = 0; i < 6000; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const r: any = edge.receipt(ana.soulId, id); if (r?.outcome) return r; } } return edge.receipt(ana.soulId, id); };
  const act = async (capability: string) => { const a: any = await accept(f.host, edge.act(ana, { capability })); assert.equal(a.accepted, true, JSON.stringify(a)); return run(a.receipt?.id ?? a.receiptId ?? a.id); };
  const bowl = [...god.model.entities.values()].find((e: any) => e.name === 'living-bowl') as any;
  assert.ok(bowl, 'the furnished cottage has a bowl');

  await act('walk:rose-cottage/living');
  const pk: any = await act(`pick-up:${bowl.id}`);
  assert.equal(pk.phase, 'completed', JSON.stringify(pk));
  assert.deepEqual(pk.outcome.changed.map((c: any) => [c.id, c.kind]), [[bowl.id, 'item-held']], JSON.stringify(pk.outcome));
  assert.match(pk.outcome.summary, /holding/);
  const o1: any = edge.observe(ana, new Set());
  assert.equal(o1.self.holding?.id, bowl.id, JSON.stringify(o1.self.holding));
  await settle(30);
  const e = god.model.entities.get(bowl.id)!;
  assert.deepEqual([e.in.parent, e.in.slot], [ana.entityId, 'carry'], 'the god model has the bowl in her hand');
  const caps = edge.capabilities(ana);
  assert.ok(caps.some((c: any) => c.id === 'put-down:here' && c.available), caps.map((c: any) => c.id).join(' '));

  // indoors among the furniture: put-down:here turns to the clearest ground first
  const pd: any = await act('put-down:here');
  assert.equal(pd.phase, 'completed', JSON.stringify(pd));
  assert.deepEqual(pd.outcome.changed.map((c: any) => [c.id, c.kind]), [[bowl.id, 'item-placed']], JSON.stringify(pd.outcome));
  assert.equal((edge.observe(ana, new Set()) as any).self.holding, null);
  assert.equal((f.host.engine as any).world.entities[bowl.id].support?.kind, 'ground');
});
