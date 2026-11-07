import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { toyFactory } from '@souls/engine-toy';
import type { Engine, EngineFactory, EngineSnapshot } from '@souls/engine-contract';
import { kernelHash } from '@souls/kernel';
import { Db } from './db.ts';
import { WorldHost, type SnapshotBody } from './world.ts';

type Internals = {
  periodicSnapshot: unknown; recoveryBaseline: SnapshotBody | null; recoveryCapture: (() => SnapshotBody) | null;
  schedulePeriodicSnapshot(): void; captureBody(): SnapshotBody; restoreBody(body: SnapshotBody): void;
  recoverFault(error: unknown, cardHint?: string): void;
};
function fixture(t: TestContext, durable = false) {
  // Deterministic four-millisecond slice boundaries without burning CPU or relying on host speed.
  let clock = 0; t.mock.method(performance, 'now', () => ++clock * 5);
  const captures: EngineSnapshot[] = [], faults: unknown[] = [];
  let failure: 'none' | 'iterator' | 'emit' = 'none', finishes = 0;
  t.mock.method(console, 'error', (...args: unknown[]) => { faults.push(args); });
  const decorate = (engine: Engine) => {
    engine.captureSnapshot = () => {
      const snapshot = engine.snapshot(); captures.push(structuredClone(snapshot));
      return { tick: snapshot.tick, stateHash: snapshot.stateHash,
        steps() {
          if (failure === 'iterator') throw Error('iterator construction failed');
          return (function* () {
            yield; if (failure === 'emit') throw Error('owned emission failed');
            yield; return structuredClone(snapshot);
          })();
        },
        finish() { finishes++; return structuredClone(snapshot); },
      };
    };
    return engine;
  };
  const factory: EngineFactory = { ...toyFactory,
    create: world => decorate(toyFactory.create(world)), restore: snapshot => decorate(toyFactory.restore(snapshot)),
  };
  const db = new Db(':memory:'), host = new WorldHost(db, factory, 'periodic-owned', 1e9, 'periodic-owned', { durableClockV1: durable });
  host.boot();
  const internals = host as unknown as Internals;
  t.after(() => { host.stop(); db.close(); });
  const begin = () => { host.snapshotEvery = 1; host.tickOnce(); host.snapshotEvery = 1e9; };
  const settle = async () => { for (let i = 0; internals.periodicSnapshot && i < 30; i++) await turn(); assert.equal(internals.periodicSnapshot, null); };
  return { db, host, factory, internals, captures, faults, begin, settle, fail: (kind: typeof failure) => { failure = kind; }, finishes: () => finishes };
}

test('periodic capture persists one owned boundary while later live state and accepted sequence advance', async t => {
  const f = fixture(t, true), { host, db } = f;
  void host.enqueue('birth', 'fixture', { soulId: 's_A', entityId: 'h_A', name: 'Alice', description: 'fixture', owner: 'owner' });
  host.drainInputs(); host.extra.fixture = { values: [1] }; host.counts.fixture = 1;
  f.begin();
  const expected = f.internals.captureBody(), physicalHash = host.engine.physicalHash();
  assert.equal(db.latestSnapshot(host.worldId), null);
  assert.ok(f.internals.recoveryCapture); assert.equal(f.finishes(), 0);
  (host.extra.fixture as { values: number[] }).values.push(2); host.counts.fixture++;
  host.minds.get('s_A')!.recent.push('after capture');
  host.kernel.things.s_A.traits.about = 'after capture';
  void host.enqueue('admin', 'fixture', { action: 'after capture' }); host.drainInputs();
  host.tickOnce();
  const head = { tick: host.engine.world.tick, seq: host.seq, hash: host.engine.stateHash(), kernel: kernelHash(host.kernel) };
  await f.settle();
  const saved = db.latestSnapshot(host.worldId)!;
  assert.deepEqual(saved.body, JSON.parse(JSON.stringify(expected)));
  assert.equal(saved.tick, expected.runtime.tick); assert.equal(saved.seq, expected.seq);
  assert.equal(saved.stateHash, expected.runtime.stateHash);
  assert.equal(db.db.prepare('SELECT physical_hash AS h FROM snapshots WHERE world_id=?').get(host.worldId)!.h, physicalHash);
  assert.deepEqual(f.internals.recoveryBaseline, expected); assert.equal(f.internals.recoveryCapture, null);
  assert.equal(f.finishes(), 0, 'normal completion uses the bounded emitter, not the fallback');
  // The stored checkpoint stays behind the accepted durable frontier, and replay recovers the exact head.
  // Only durable input/engine changes are replayable; the extra/kernel fixture mutations above are intentionally local.
  assert.ok(saved.tick < head.tick); assert.ok(saved.seq < head.seq);
  assert.equal(f.factory.restore(saved.body.runtime).stateHash(), expected.runtime.stateHash);
});

test('a pending checkpoint remains the recovery baseline across an atomic transaction rollback', async t => {
  const f = fixture(t); f.begin();
  const capturedTick = f.captures[0].tick;
  f.host.tickOnce(); const rollback = f.internals.captureBody();
  f.host.extra.speculative = true;
  f.internals.restoreBody(rollback);
  assert.equal(f.internals.periodicSnapshot, null); assert.equal(f.internals.recoveryCapture, null);
  assert.equal(f.finishes(), 1); assert.equal(f.internals.recoveryBaseline!.runtime.tick, capturedTick);
  f.internals.recoverFault(Error('fixture fault after rollback'), 'fixture-card');
  const recovery = f.db.events(f.host.worldId).find(e => e.author === 'world:recovery')!;
  assert.equal(recovery.payload.recovery.baseline.runtime.tick, capturedTick);
  assert.equal(f.host.clockAvailable, true); await turn();
  assert.equal(f.db.latestSnapshot(f.host.worldId)!.tick, rollback.runtime.tick);
});

test('fault before emission finishes materializes the newest boundary and cancels its old writer', async t => {
  const f = fixture(t); f.begin(); await turn();
  f.host.tickOnce(); f.internals.recoverFault(Error('fixture pending fault'), 'fixture-card');
  assert.equal(f.finishes(), 1);
  const row = f.db.latestSnapshot(f.host.worldId)!;
  assert.equal(row.tick, f.host.engine.world.tick);
  assert.equal(f.db.events(f.host.worldId).at(-1)!.payload.recovery.baseline.runtime.tick, f.captures[0].tick);
  await turn(); await turn(); assert.deepEqual(f.db.latestSnapshot(f.host.worldId), row);
});

for (const turns of [0, 1, 3, 4]) test(`newer same-tick synchronous snapshot supersedes periodic work after ${turns} turns`, async t => {
  const f = fixture(t); f.begin();
  for (let i = 0; i < turns; i++) await turn();
  void f.host.enqueue('admin', 'fixture', { action: 'newer-sequence' }); f.host.drainInputs();
  f.host.extra.latest = true; const saved = f.host.saveSnapshot(true), seq = f.host.seq;
  for (let i = 0; i < 8; i++) await turn();
  const latest = f.db.latestSnapshot(f.host.worldId)!;
  assert.equal(latest.tick, saved.tick); assert.equal(latest.seq, seq); assert.equal(latest.body.extra.latest, true);
  assert.equal(f.internals.periodicSnapshot, null); assert.equal(f.internals.recoveryCapture, null);
});

test('an older public deferred callback cannot overwrite a newer same-tick snapshot', async t => {
  const f = fixture(t); f.host.saveSnapshot(false);
  void f.host.enqueue('admin', 'fixture', { action: 'newer-sequence' }); f.host.drainInputs();
  f.host.extra.latest = true; f.host.saveSnapshot(true); const row = f.db.latestSnapshot(f.host.worldId)!;
  await turn(); assert.deepEqual(f.db.latestSnapshot(f.host.worldId), row);
});

test('boot while encoding cancels the previous engine capture before establishing its recovery baseline', async t => {
  const f = fixture(t); f.begin(); const old = f.host.engine;
  f.host.boot(); const baseline = f.internals.recoveryBaseline;
  assert.notEqual(f.host.engine, old); assert.equal(f.internals.recoveryCapture, null); assert.equal(f.internals.periodicSnapshot, null);
  assert.ok(baseline); assert.equal(f.host.lastSnapshotTick, 0);
  for (let i = 0; i < 8; i++) await turn();
  assert.equal(f.db.latestSnapshot(f.host.worldId), null); assert.strictEqual(f.internals.recoveryBaseline, baseline);
  assert.equal(f.host.lastSnapshotTick, 0);
});

test('stop cancels every deferred stage before its database owner closes', async t => {
  const f = fixture(t); f.begin(); await turn(); f.host.stop();
  const row = f.db.latestSnapshot(f.host.worldId);
  for (let i = 0; i < 8; i++) await turn();
  assert.deepEqual(f.db.latestSnapshot(f.host.worldId), row); assert.equal(f.internals.periodicSnapshot, null);
  assert.equal(f.faults.length, 0); assert.equal(f.host.clockAvailable, true);
  // A later restart can capture afresh; cancellation did not claim the old pending tick was durable.
  assert.equal(f.host.lastSnapshotTick, 0); f.internals.schedulePeriodicSnapshot(); await f.settle();
  assert.equal(f.db.latestSnapshot(f.host.worldId)!.tick, f.host.engine.world.tick);
});

test('iterator setup failure publishes no pending job or replacement recovery boundary', t => {
  const f = fixture(t), before = f.internals.recoveryBaseline; f.fail('iterator');
  assert.throws(() => f.internals.schedulePeriodicSnapshot(), /iterator construction failed/);
  assert.equal(f.internals.periodicSnapshot, null); assert.equal(f.internals.recoveryCapture, null);
  assert.strictEqual(f.internals.recoveryBaseline, before);
});

for (const failure of ['emit', 'json', 'sql'] as const) test(`${failure} failure is reported, preserves absence of durability, and makes the host unavailable`, async t => {
  const f = fixture(t); let unavailable = 0;
  f.host.listeners.push({ onClockUnavailable: () => unavailable++ });
  if (failure === 'emit') f.fail('emit');
  if (failure === 'json') f.host.extra.big = 1n;
  if (failure === 'sql') t.mock.method(f.db, 'saveSnapshotSerialized', () => { throw Error('fixture disk fault'); });
  f.begin(); await f.settle();
  assert.equal(f.db.latestSnapshot(f.host.worldId), null);
  assert.equal(f.host.clockAvailable, false); assert.equal(f.host.paused, true); assert.equal(f.host.running, false);
  assert.equal(unavailable, 1); assert.equal(f.faults.length, 1); assert.equal(f.host.lastSnapshotTick, 0);
});

test('a completed periodic checkpoint replays later durable input and ticks to the exact frontier', async t => {
  const f = fixture(t, true); f.begin();
  void f.host.enqueue('birth', 'fixture', { soulId: 's_A', entityId: 'h_A', name: 'Alice', description: 'fixture', owner: 'owner' });
  f.host.tickOnce(); f.host.tickOnce();
  const head = { tick: f.host.engine.world.tick, seq: f.host.seq, engine: f.host.engine.stateHash(), kernel: kernelHash(f.host.kernel) };
  await f.settle();
  const restored = new WorldHost(f.db, f.factory, 'periodic-owned', 1e9, f.host.worldId, { durableClockV1: true });
  t.after(() => restored.stop());
  assert.equal(restored.boot().from, 'snapshot');
  assert.equal(restored.engine.world.tick, head.tick); assert.equal(restored.seq, head.seq);
  assert.equal(restored.engine.stateHash(), head.engine); assert.equal(kernelHash(restored.kernel), head.kernel);
});

test('serialized snapshot persistence preserves exact JSON text and the existing retention selection', t => {
  const one = new Db(':memory:'), two = new Db(':memory:'); t.after(() => { one.close(); two.close(); });
  for (const db of [one, two]) db.createWorld({ id: 'w', schema: 'fixture', rules_version: 'fixture', dt: .05, seed: 'fixture' });
  let now = 1_800_000_000_000; t.mock.method(Date, 'now', () => now);
  for (let i = 0; i < 30; i++) {
    now += 12 * 3600_000;
    const body = { unicode: '🌱', value: i, omitted: undefined, nested: [null, i] };
    const meta = { tick: i, seq: i, stateHash: `s${i}`, physicalHash: `p${i}`, rulesVersion: 'fixture' };
    one.saveSnapshot('w', { ...meta, body }); two.saveSnapshotSerialized('w', meta, JSON.stringify(body));
  }
  const sql = 'SELECT * FROM snapshots ORDER BY tick';
  assert.deepEqual(two.db.prepare(sql).all(), one.db.prepare(sql).all());
  const json = '{ "value" : 30, "unicode" : "🌱" }';
  two.saveSnapshotSerialized('w', { tick: 30, seq: 30, stateHash: 's30', physicalHash: 'p30', rulesVersion: 'fixture' }, json);
  assert.equal(two.db.prepare('SELECT snapshot FROM snapshots WHERE tick=30').get()!.snapshot, json);
});
