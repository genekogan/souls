// E-polish item 1 (souls-r2 run 4): the engine's fault recovery rewinds an edge Soul's decisions to the recovery
// baseline, which on a young world is genesis, so she was left at her arrival point ([0, 0, 0] in that run) instead of
// where she was. Now only the decision she was running is set aside, the recovery recipe carries the rewound bodies' last valid poses (taken before the faulting tick)
// and each lands back there (or at the nearest free standing point); the recipe is logged, so replay stays exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { kernelHash } from '@souls/kernel';
import { fixture, invite, accept, factory, seed } from '../test/native-owner-fixture.ts';
import { WorldHost } from './world.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('fault recovery puts a rewound edge Soul back where she last stood validly, never at her arrival point; replay exact', { timeout: 300000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const edge = new EdgeLedger(f.host, f.db); void edge;
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const host = f.host, settle = async (n = 3) => { for (let i = 0; i < n; i++) { host.tickOnce(); await setImmediate(); host.drainInputs(); } };
  assert.equal(host.recoveryForEdge, true);
  await settle(2);
  await invite(f, 'ana');
  const row: any = await accept(host, f.souls.create('dev:ana', { name: 'Ana', description: 'walks' }));
  await settle(3);
  const ents = () => host.engine.world.entities as any, id = row.entity_id as string;
  const born = [...ents()[id].pose.p] as number[];
  // she walks away from the arrival point (an edge decision, as /v1/edge/act logs it)
  const to: [number, number] = [born[0] + 9, born[2] + 6];
  await accept(host, host.enqueue('decision', `edge:${row.id}`, { soulId: row.id, entityId: id, option: 'walk', label: 'walk', steps: [{ verb: 'walk_to', params: { to } }], reevalTicks: 1e9, fallback: false, trigger: 'edge-test' }));
  for (let i = 0; i < 3000 && (host.engine.programOf(id) || Math.hypot(ents()[id].pose.p[0] - to[0], ents()[id].pose.p[2] - to[1]) > 0.3); i++) { host.tickOnce(); if (i % 20 === 0) { await setImmediate(); host.drainInputs(); } }
  const stood = [...ents()[id].pose.p] as number[];
  assert.ok(Math.hypot(stood[0] - to[0], stood[2] - to[1]) <= 0.3, `arrived ${stood}`);
  // she starts another walk; one tick into it the engine reports a fault naming her body
  await accept(host, host.enqueue('decision', `edge:${row.id}`, { soulId: row.id, entityId: id, option: 'walk2', label: 'walk on', steps: [{ verb: 'walk_to', params: { to: [to[0] + 6, to[1]] } }], reevalTicks: 1e9, fallback: false, trigger: 'edge-test' }));
  for (let i = 0; i < 30; i++) host.tickOnce();
  const before = [...ents()[id].pose.p] as number[];
  const engine = host.engine as any, step = engine.step; let fired = false;
  engine.step = function (this: unknown) {
    const out = step.call(this);
    if (!fired) { fired = true; throw new Error(JSON.stringify([{ code: 'motion.teleport', message: `${id} moved 1.90 m in one tick (test)`, subjects: [id] }])); }
    return out;
  };
  host.tickOnce();
  const rec = f.db.events(host.worldId).filter((e) => e.kind === 'rules' && e.payload?.recovery);
  assert.equal(rec.length, 1, 'one logged recovery');
  const recipe = rec[0].payload.recovery;
  // only the decision she was running is set aside: her earlier walk replays as it was
  const walks = f.db.events(host.worldId).filter((e) => e.kind === 'decision' && e.payload?.entityId === id).map((e) => [e.payload.option, e.seq]);
  assert.deepEqual(recipe.edge.excludedSeqs, [walks.find(([o]) => o === 'walk2')![1]], JSON.stringify({ walks, edge: recipe.edge }));
  assert.ok(recipe.edge.poses?.[id], `the recipe carries her last valid pose: ${JSON.stringify(recipe.edge)}`);
  assert.ok(Math.hypot(recipe.edge.poses[id].p[0] - before[0], recipe.edge.poses[id].p[2] - before[2]) < 0.2, 'taken before the faulting tick');
  const now = ents()[id].pose.p as number[];
  assert.ok(Math.hypot(now[0] - before[0], now[2] - before[2]) < 0.6, `back where she was (${now}), not at her arrival point (${born})`);
  assert.ok(Math.hypot(now[0] - born[0], now[2] - born[2]) > 5, 'not rewound to the arrival point');
  assert.equal(ents()[id].human.activity, 'idle');
  assert.deepEqual(host.engine.runtime.violations, [], 'the recovered world is clean');
  // the world carries on and she can walk again from there
  await accept(host, host.enqueue('decision', `edge:${row.id}`, { soulId: row.id, entityId: id, option: 'walk3', label: 'walk back', steps: [{ verb: 'walk_to', params: { to: [born[0] + 4, born[2] + 4] } }], reevalTicks: 1e9, fallback: false, trigger: 'edge-test' }));
  for (let i = 0; i < 200; i++) host.tickOnce();
  assert.deepEqual(host.engine.runtime.violations, []);
  // exact replay from genesis, through the logged recovery and its pose restore
  host.drainInputs(); host.saveSnapshot(true);
  const head = { engine: host.engine.stateHash(), kernel: kernelHash(host.kernel) };
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(host.worldId);
  const h = new WorldHost(f.db, factory, seed, 1e9, host.worldId, { durableClockV1: true });
  assert.equal(h.boot().from, 'genesis');
  assert.deepEqual({ engine: h.engine.stateHash(), kernel: kernelHash(h.kernel) }, head, 'replay exact');
  h.stop();
});
