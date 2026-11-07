import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { toyFactory } from '@souls/engine-toy';
import type { Engine, EngineFactory, EngineCheckpoint } from '@souls/engine-contract';
import { Db } from './db.ts';
import { WorldHost, type SnapshotBody } from './world.ts';

type PrivateHost = { periodicSnapshot: unknown; recoveryCapture: (() => SnapshotBody) | null; recoveryBaseline: SnapshotBody | null;
  schedulePeriodicSnapshot(): void; captureBody(): SnapshotBody; restoreBody(body: SnapshotBody): void; recoverFault(error: unknown, card?: string): void };
function fixture(t: TestContext) {
  let clock = 0, fail = false, failure: unknown = Error('fixture digest provider failed'), finishes = 0;
  t.mock.method(performance, 'now', () => ++clock * 5);
  const errors: unknown[] = []; t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args); });
  const decorate = (engine: Engine) => {
    engine.captureCheckpoint = () => {
      const owned: EngineCheckpoint = { snapshot: engine.snapshot(), physicalHash: engine.physicalHash() };
      const finish = () => { finishes++; if (fail) throw failure; return structuredClone(owned); };
      return { tick: owned.snapshot.tick, finish, *steps() { yield; yield; return finish(); } };
    };
    return engine;
  };
  const factory: EngineFactory = { ...toyFactory, create: world => decorate(toyFactory.create(world)), restore: snapshot => decorate(toyFactory.restore(snapshot)) };
  const db = new Db(':memory:'), host = new WorldHost(db, factory, 'hash-checkpoint', 1e9, 'hash-checkpoint', { durableClockV1: true });
  host.boot(); const priv = host as unknown as PrivateHost;
  t.after(() => { host.stop(); db.close(); });
  const begin = () => { host.snapshotEvery = 1; host.tickOnce(); host.snapshotEvery = 1e9; };
  const settle = async () => { for (let i = 0; priv.periodicSnapshot && i < 30; i++) await turn(); assert.equal(priv.periodicSnapshot, null); };
  return { host, db, priv, factory, errors, begin, settle, fail: (...reason: unknown[]) => { fail = true; if (reason.length) failure = reason[0]; }, finishes: () => finishes };
}

test('new checkpoint path retains only prior completed baseline until the same owned frontier finishes', async t => {
  const f = fixture(t), previous = f.priv.recoveryBaseline; f.host.extra.fixture = { value: 1 }; f.begin();
  const expected = f.priv.captureBody(), physical = f.host.engine.physicalHash();
  assert.strictEqual(f.priv.recoveryBaseline, previous); assert.ok(f.priv.recoveryCapture);
  await turn();
  f.host.extra.fixture = { value: 2 }; void f.host.enqueue('admin', 'fixture', { action: 'later' }); f.host.drainInputs();
  f.host.tickOnce();
  t.mock.method(f.host.engine, 'physicalHash', () => { throw Error('live physical hash must not be used on completion'); });
  await f.settle();
  const row = f.db.latestSnapshot(f.host.worldId)!;
  assert.deepEqual(row.body, JSON.parse(JSON.stringify(expected))); assert.equal(row.stateHash, expected.runtime.stateHash);
  assert.equal(f.db.db.prepare('SELECT physical_hash AS h FROM snapshots WHERE world_id=?').get(f.host.worldId)!.h, physical);
  assert.notStrictEqual(f.priv.recoveryBaseline, previous); assert.deepEqual(f.priv.recoveryBaseline, expected);
  assert.equal(f.priv.recoveryCapture, null);
});

test('partial hashing followed by normal recovery uses the newest captured frontier', async t => {
  const f = fixture(t); f.begin(); const tick = f.host.engine.world.tick; await turn();
  f.host.tickOnce(); f.priv.recoverFault(Error('fixture engine fault'), 'fixture-card');
  const repair = f.db.events(f.host.worldId).find(e => e.payload?.recovery)!;
  assert.equal(repair.payload.recovery.baseline.runtime.tick, tick);
  assert.equal(f.host.clockAvailable, true); const saved = f.db.latestSnapshot(f.host.worldId);
  await turn(); await turn(); assert.deepEqual(f.db.latestSnapshot(f.host.worldId), saved);
});

for (const where of ['async', 'fault', 'rollback'] as const) test(`digest failure during ${where} stops without claiming an older recovery frontier`, async t => {
  const f = fixture(t), previous = f.priv.recoveryBaseline;
  f.begin(); await turn();
  f.host.tickOnce(); f.host.extra.rollback = { value: 3 };
  const rollback = f.priv.captureBody(), before = f.db.events(f.host.worldId).length;
  f.host.extra.rollback = { value: 4 }; f.fail();
  if (where === 'async') await f.settle();
  if (where === 'fault') assert.doesNotThrow(() => f.priv.recoverFault(Error('engine fault while digest pending'), 'fixture-card'));
  if (where === 'rollback') {
    assert.doesNotThrow(() => f.priv.restoreBody(rollback));
    assert.deepEqual(f.priv.captureBody(), rollback, 'every supplied transaction rollback field is restored');
  }
  assert.equal(f.host.clockAvailable, false); assert.equal(f.host.paused, true); assert.equal(f.host.running, false);
  assert.equal(f.priv.recoveryCapture, null); assert.equal(f.priv.periodicSnapshot, null);
  assert.strictEqual(f.priv.recoveryBaseline, previous);
  assert.equal(f.db.events(f.host.worldId).length, before, 'no invented recovery recipe');
  assert.equal(f.db.latestSnapshot(f.host.worldId), null); assert.equal(f.errors.length, 1);
  await turn(); await turn(); assert.equal(f.db.latestSnapshot(f.host.worldId), null);
});

test('same-tick supersession and stop cancel deferred hash ownership without a stale writer', async t => {
  const f = fixture(t); f.begin(); await turn();
  void f.host.enqueue('admin', 'fixture', { action: 'newer' }); f.host.drainInputs();
  f.host.saveSnapshot(true); const saved = f.db.latestSnapshot(f.host.worldId), baseline = f.priv.recoveryBaseline;
  f.fail(); for (let i = 0; i < 5; i++) await turn();
  assert.deepEqual(f.db.latestSnapshot(f.host.worldId), saved); assert.strictEqual(f.priv.recoveryBaseline, baseline);
  assert.equal(f.priv.recoveryCapture, null); assert.equal(f.errors.length, 0);
  f.priv.schedulePeriodicSnapshot(); await turn(); f.host.stop();
  for (let i = 0; i < 5; i++) await turn();
  assert.deepEqual(f.db.latestSnapshot(f.host.worldId), saved); assert.equal(f.errors.length, 0);
});

test('synchronous invalid-domain capture never replaces the previous recovery ownership', t => {
  const f = fixture(t), baseline = f.priv.recoveryBaseline;
  t.mock.method(f.host.engine as Engine & Required<Pick<Engine, 'captureCheckpoint'>>, 'captureCheckpoint', () => { throw Error('non-finite number in hashed state'); });
  assert.throws(() => f.priv.schedulePeriodicSnapshot(), /non-finite/);
  assert.strictEqual(f.priv.recoveryBaseline, baseline); assert.equal(f.priv.recoveryCapture, null); assert.equal(f.priv.periodicSnapshot, null);
});

test('a digest failure still stops the host when the supplied rollback restore independently fails', async t => {
  const f = fixture(t); f.begin(); await turn();
  const rollback = f.priv.captureBody(); f.fail();
  t.mock.method(f.factory, 'restore', () => { throw Error('independent rollback restore failed'); });
  assert.throws(() => f.priv.restoreBody(rollback), /independent rollback restore failed/);
  assert.equal(f.host.clockAvailable, false); assert.equal(f.host.paused, true); assert.equal(f.host.running, false);
  assert.equal(f.priv.recoveryCapture, null); assert.equal(f.priv.periodicSnapshot, null); assert.equal(f.errors.length, 1);
});

for (const where of ['async', 'rollback'] as const) test(`falsy digest rejection during ${where} still makes the clock unavailable`, async t => {
  const f = fixture(t), previous = f.priv.recoveryBaseline;
  f.begin(); await turn(); const rollback = f.priv.captureBody(); f.fail(undefined);
  if (where === 'async') await f.settle(); else f.priv.restoreBody(rollback);
  assert.equal(f.host.clockAvailable, false); assert.equal(f.host.paused, true); assert.equal(f.host.running, false);
  assert.strictEqual(f.priv.recoveryBaseline, previous); assert.equal(f.priv.recoveryCapture, null);
  assert.equal(f.db.latestSnapshot(f.host.worldId), null); assert.equal(f.db.events(f.host.worldId).filter(e => e.payload?.recovery).length, 0);
  if (where === 'rollback') assert.deepEqual(f.priv.captureBody(), rollback);
});

test('exceptional eager ticket keeps host clone before physical hash', async t => {
  const f = fixture(t), order: string[] = [], engine = f.host.engine;
  const physical = engine.physicalHash.bind(engine);
  let owned: ReturnType<Engine['snapshot']> | undefined, expectedPhysical = '';
  t.mock.method(engine as Engine & Required<Pick<Engine, 'captureCheckpoint'>>, 'captureCheckpoint', () => {
    order.push('capture'); owned = engine.snapshot();
    return { tick: owned.tick, stateHash: owned.stateHash,
      finish: () => structuredClone(owned!),
      steps() { order.push('steps'); return (function* () { yield; return structuredClone(owned!); })(); },
    };
  });
  Object.defineProperty(f.host.extra, 'hostGetter', { enumerable: true, configurable: true, get() {
    order.push('host'); engine.world.base.staticHash = 'changed by host clone'; return 'owned host value';
  } });
  t.mock.method(engine, 'physicalHash', () => { order.push('physical'); return expectedPhysical = physical(); });
  f.priv.schedulePeriodicSnapshot();
  assert.deepEqual(order, ['capture', 'host', 'physical', 'steps']);
  delete f.host.extra.hostGetter;
  await f.settle();
  const row = f.db.latestSnapshot(f.host.worldId)!;
  assert.equal(row.stateHash, owned!.stateHash); assert.equal(row.body.extra.hostGetter, 'owned host value');
  assert.equal(f.db.db.prepare('SELECT physical_hash AS h FROM snapshots WHERE world_id=?').get(f.host.worldId)!.h, expectedPhysical);
});

test('exceptional eager iterator setup failure never publishes recovery ownership', t => {
  // A fresh durable frontier isolates iterator setup from the preceding test's
  // intentional getter mutation; changing the same durable head must still fail.
  const f = fixture(t), engine = f.host.engine, owned = engine.snapshot(), baseline = f.priv.recoveryBaseline;
  t.mock.method(engine as Engine & Required<Pick<Engine, 'captureCheckpoint'>>, 'captureCheckpoint', () => ({
    tick: owned.tick, stateHash: owned.stateHash, finish: () => structuredClone(owned),
    steps() { throw Error('legacy iterator setup failed'); },
  }));
  assert.throws(() => f.priv.schedulePeriodicSnapshot(), /legacy iterator setup/);
  assert.equal(f.priv.periodicSnapshot, null); assert.equal(f.priv.recoveryCapture, null);
  assert.strictEqual(f.priv.recoveryBaseline, baseline);
});
