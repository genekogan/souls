// Lane L5 (fast boot): the periodic snapshot comes when the ticks since the last one would cost `snapshotDebtMs` to
// replay (not only every `snapshotEvery` ticks), at most once per `snapshotMinGapMs`, never more often than 20x its own
// cost; a boot that replayed a long gap snapshots on its first tick. Snapshot timing never changes the world.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { toyFactory } from '@souls/engine-toy';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';

function world(t: TestContext, db = new Db(':memory:')) {
  let clock = 0; t.mock.method(performance, 'now', () => (clock += 10));   // every reading is 10 ms later
  t.mock.method(console, 'log', () => {});
  const host = new WorldHost(db, toyFactory, 'adaptive', 1e9, 'adaptive');
  host.boot();
  t.after(() => host.stop());
  const advance = (ms: number) => { clock += ms; };
  const settle = async () => { for (let i = 0; i < 40; i++) await turn(); };
  return { db, host, advance, settle };
}
const latest = (db: Db) => db.latestSnapshot('adaptive')?.tick ?? null;

test('off by default: only the tick ceiling snapshots', async (t) => {
  const { db, host, advance, settle } = world(t);
  for (let i = 0; i < 50; i++) { host.tickOnce(); advance(1000); }
  await settle();
  assert.equal(latest(db), null);
  assert.ok(host.replayDebtMs > 0, 'the debt is still measured');
});

test('replay debt brings the snapshot forward, at most once per minimum gap', async (t) => {
  const { db, host, advance, settle } = world(t);
  host.snapshotDebtMs = 100; host.snapshotMinGapMs = 30_000;
  // each tick reads the clock several times (10 ms apart): its measured engine time is >= 10 ms
  let n = 0; while (latest(db) === null && n < 200) { host.tickOnce(); n++; advance(1000); await settle(); }
  const first = latest(db);
  assert.ok(first !== null && first > 0, 'a snapshot came long before the 1e9-tick ceiling');
  assert.equal(host.replayDebtMs < host.snapshotDebtMs, true, 'the debt starts again after a capture');
  // more debt within the gap: no second capture until 30 s of wall time have passed
  for (let i = 0; i < 20; i++) { host.tickOnce(); await settle(); }
  assert.equal(latest(db), first, 'within the gap');
  advance(30_000); host.tickOnce(); await settle();
  assert.ok(latest(db)! > first!, 'after the gap');
  assert.ok(host.lastSnapshotCostMs > 0, 'capture cost measured');
});

test('the capture cost backs the cadence off (capture <= 5 % of its interval)', async (t) => {
  const { db, host, advance, settle } = world(t);
  host.snapshotDebtMs = 1; host.snapshotMinGapMs = 0;
  host.tickOnce(); await settle(); const first = latest(db);
  assert.ok(first !== null);
  host.lastSnapshotCostMs = 5_000;   // a capture that cost 5 s
  host.tickOnce(); await settle();
  assert.equal(latest(db), first, '20 x 5 s = 100 s have not passed');
  advance(100_000); host.tickOnce(); await settle();
  assert.ok(latest(db)! > first!);
});

test('a boot that replayed a long gap snapshots on its first tick; the replayed world is the same', async (t) => {
  const db = new Db(':memory:');
  const a = world(t, db);
  a.host.saveSnapshot(true);
  for (let i = 0; i < 300; i++) { if (i % 50 === 0) void a.host.enqueue('rules', 'world', { note: `n${i}` }); a.host.tickOnce(); }
  a.host.drainInputs(); a.host.stop();
  const head = { tick: a.host.engine.world.tick, hash: a.host.engine.stateHash() };
  const b = new WorldHost(db, toyFactory, 'adaptive', 1e9, 'adaptive');
  b.snapshotAfterReplayTicks = 200; b.boot(); t.after(() => b.stop());
  assert.ok(b.bootStats!.replayTicks > 200, `replayed ${b.bootStats!.replayTicks}`);
  while (b.engine.world.tick < head.tick) b.tickOnce();
  assert.equal(b.engine.stateHash(), head.hash);
  await a.settle();
  assert.equal(latest(db), b.bootStats!.toTick + 1, 'snapshot right after the long replay');
});

test('requestSnapshot: now persists the head at once; soon takes it at the end of the next tick', async (t) => {
  const { db, host, settle } = world(t);
  for (let i = 0; i < 5; i++) host.tickOnce();
  const r = host.requestSnapshot('planned restart', { now: true });
  assert.deepEqual(r, { tick: host.engine.world.tick, pending: false });
  assert.equal(latest(db), host.engine.world.tick);
  assert.ok(host.snapshotAgeMs() < 1000);
  for (let i = 0; i < 5; i++) host.tickOnce();
  assert.equal(host.requestSnapshot('entering red')?.pending, true);
  assert.equal(latest(db), 5, 'nothing yet');
  host.tickOnce(); await settle();
  assert.equal(latest(db), 11, 'taken at the end of the next tick');
});
