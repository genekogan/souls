import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import type { LogEvent } from '@souls/protocol';
import { coreRef } from '@souls/world-compiler';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
const seed = 'projection-readiness', worldId = 'projection-readiness';
const post = { schema: 'def/1', name: 'readiness-post', size: { box: [0.5, 1, 0.5] },
  make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [0.5, 1, 0.5] }] } } };
const turns = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture(t: TestContext, withPost = true) {
  const db = new Db(':memory:'), host = new WorldHost(db, factory, seed, 1e9, worldId);
  host.boot(); host.drainInputs();
  const god = new GodMode(db, { worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {} });
  if (withPost) assert.equal(god.act({ ops: [{ op: 'define', def: post }, { op: 'place', def: 'readiness-post@1', name: 'post', p: [30, 0] }] }).accepted, true);
  const bridge = installEngineBridge({ host, god, log() {}, worldClock: false, worldLore: false });
  t.after(() => { host.stop(); db.close(); });
  return { db, host, god, bridge };
}
const physics = (host: WorldHost) => (host.engine.world as unknown as { entityPhysicsV1?: { hash: string } }).entityPhysicsV1;

// No timer clock or network is started: these are the actual sequencer's synchronous ticks.
test('readiness requires exact queued acceptance and a complete tick, not reconcile or a manual drain', async t => {
  const w = fixture(t); let ready = false, lastListener = false;
  const waiting = w.bridge.waitForInitialProjection().then(() => { ready = true; assert.equal(lastListener, true); });
  w.host.listeners.push({ afterTick() { lastListener = true; } });
  const before = w.host.engine.world.tick;
  await turns(); assert.equal(w.host.engine.world.tick, before, 'waiting never advances the clock');
  w.host.tickOnce(); await turns(); assert.equal(ready, false, 'derivation only queued its draft');
  w.host.drainInputs(); await turns(); assert.equal(ready, false, 'standalone acceptance is not a complete tick');
  lastListener = false;
  w.host.tickOnce(); await waiting;
  assert.equal(w.bridge.initialProjectionReady(), true);
  assert.ok(physics(w.host));
  assert.equal(w.db.events(worldId).filter(e => e.kind === 'world-edit').length, 1);
});

test('restored no-op projection reaches readiness without synthesizing a world edit', async t => {
  const w = fixture(t); w.host.tickOnce(); w.host.tickOnce(); await turns();
  w.host.saveSnapshot(true);
  const host = new WorldHost(w.db, factory, seed, 1e9, worldId); host.boot();
  const god = new GodMode(w.db, { worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {} });
  const bridge = installEngineBridge({ host, god, log() {}, worldClock: false, worldLore: false });
  t.after(() => host.stop());
  const count = w.db.events(worldId).filter(e => e.kind === 'world-edit').length;
  const waiting = bridge.waitForInitialProjection();
  host.tickOnce(); await waiting;
  assert.equal(bridge.stats.edits, 0);
  assert.equal(w.db.events(worldId).filter(e => e.kind === 'world-edit').length, count);
});

test('later afterTick model commits cannot publish readiness before their projection folds', async t => {
  const w = fixture(t); let edited = false, ready = false;
  const waiting = w.bridge.waitForInitialProjection().then(() => { ready = true; });
  w.host.listeners.push({ afterTick() {
    if (edited || !physics(w.host)) return;
    edited = true;
    assert.equal(w.god.act({ ops: [{ op: 'place', def: 'readiness-post@1', name: 'second', p: [34, 0] }] }).accepted, true);
  } });
  w.host.tickOnce(); w.host.tickOnce(); await turns();
  assert.equal(edited, true); assert.equal(ready, false);
  w.host.tickOnce(); await turns(); assert.equal(ready, false, 'second draft was only queued');
  w.host.tickOnce(); await waiting;
  assert.equal(w.db.events(worldId).filter(e => e.kind === 'world-edit').length, 2);
});

test('same-hash fixture edits still wait for their exact draft acceptance', async t => {
  const w = fixture(t);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('chair'), name: 'chair', p: [38, 0] }] }).accepted, true);
  w.host.tickOnce(); w.host.tickOnce(); await turns();
  const before = physics(w.host)!.hash, id = w.god.model.get('chair')!.id;
  // Hold only the acknowledgement of the actual queued/folded draft. A fixture's label is not
  // in the physics hash: that hash alone must not certify acceptance of this exact projection.
  const enqueue = w.host.enqueue.bind(w.host); let release!: () => void;
  t.mock.method(w.host, 'enqueue', (kind: Parameters<WorldHost['enqueue']>[0], author: string, payload: unknown) => {
    const accepted = enqueue(kind, author, payload);
    if (kind !== 'world-edit') return accepted;
    return accepted.then(event => new Promise<LogEvent>(resolve => { release = () => resolve(event); }));
  });
  // Entity names use NAME (/^[a-z0-9][a-z0-9._-]{0,47}$/); the fixture label expands hyphens.
  const renamed = w.god.act({ ops: [{ op: 'set', id, name: 'renamed-chair' }] });
  assert.equal(renamed.accepted, true, JSON.stringify(renamed));
  w.host.tickOnce(); w.host.tickOnce(); await turns();
  assert.equal(physics(w.host)!.hash, before);
  assert.equal((w.host.engine.world.entities as Record<string, { label?: string }>)[id]?.label, 'renamed chair');
  assert.equal(typeof release, 'function', 'the renamed fixture produced an accepted world-edit draft');
  assert.equal(w.bridge.initialProjectionReady(), false);
  release(); await turns();
  await w.bridge.waitForInitialProjection();
});

test('a late ordinary tick listener failure cannot masquerade as a completed tick', async t => {
  const w = fixture(t); w.host.tickOnce();
  const abort = new AbortController(); let ready = false;
  const waiting = w.bridge.waitForInitialProjection({ signal: abort.signal }).then(() => { ready = true; });
  const rejected = assert.rejects(waiting, /test cancelled/);
  w.host.listeners.push({ afterTick() { throw new Error('late tick failure'); } });
  assert.throws(() => w.host.tickOnce(), /late tick failure/);
  await turns(); assert.equal(ready, false);
  abort.abort(new Error('test cancelled')); await rejected;
});

test('recovery replacing the engine after acceptance cannot open readiness', async t => {
  const w = fixture(t); w.host.tickOnce();
  const waiting = assert.rejects(w.bridge.waitForInitialProjection(), /engine-replaced|draft-not-accepted/);
  w.host.listeners.push({ afterTick() { w.host.engine = Object.create(w.host.engine); } });
  w.host.tickOnce(); await waiting;
});

test('mismatched installed physics and mismatched acknowledgement fail closed', async t => {
  for (const mode of ['physics', 'ack'] as const) await t.test(mode, async t => {
    const w = fixture(t);
    if (mode === 'physics') w.host.listeners.unshift({ onApplied(e) {
      if (e.kind === 'world-edit') {
        const world = w.host.engine.world as unknown as { entityPhysicsV1: { hash: string } };
        world.entityPhysicsV1 = { ...world.entityPhysicsV1, hash: 'not-the-draft' };
      }
    } });
    else {
      const enqueue = w.host.enqueue.bind(w.host);
      t.mock.method(w.host, 'enqueue', (...args: Parameters<WorldHost['enqueue']>) => enqueue(...args).then(e => e.kind === 'world-edit' ? { ...e, payload: structuredClone(e.payload) } : e));
    }
    const waiting = assert.rejects(w.bridge.waitForInitialProjection(), /projection-not-installed|draft-not-accepted/);
    w.host.tickOnce(); w.host.tickOnce(); await waiting;
  });
});

test('a rejected projection acknowledgement releases its retained draft and waiters', async t => {
  const w = fixture(t), enqueue = w.host.enqueue.bind(w.host);
  t.mock.method(w.host, 'enqueue', (...args: Parameters<WorldHost['enqueue']>) => args[0] === 'world-edit'
    ? Promise.reject(new Error('projection admission unavailable')) : enqueue(...args));
  const waiting = assert.rejects(w.bridge.waitForInitialProjection(), /projection admission unavailable/);
  w.host.tickOnce(); await waiting;
  // Inspect retained ownership, without adding a public debug API to the bridge.
  const retained = w.bridge as unknown as { projectionDrafts: Map<unknown, unknown>; readinessChecks: Set<unknown> };
  assert.equal(retained.projectionDrafts.size, 0);
  assert.equal(retained.readinessChecks.size, 0);
});

test('stop, clock failure, abort and a held-clock deadline reject without driving work', async t => {
  for (const mode of ['stop', 'clock', 'abort', 'deadline'] as const) await t.test(mode, async t => {
    const w = fixture(t), abort = new AbortController(); let deadline!: () => void;
    if (mode === 'deadline') {
      t.mock.method(globalThis, 'setTimeout', (fn: () => void) => { deadline = fn; return {} as NodeJS.Timeout; });
      t.mock.method(globalThis, 'clearTimeout', () => {});
    }
    const before = w.host.engine.world.tick, seq = w.host.seq;
    const waiting = assert.rejects(w.bridge.waitForInitialProjection({ signal: abort.signal, timeoutMs: 100 }), /stopped|clock-unavailable|cancelled|timeout/);
    if (mode === 'stop') w.host.stop();
    if (mode === 'clock') for (const listener of w.host.listeners) listener.onClockUnavailable?.();
    if (mode === 'abort') abort.abort(new Error('cancelled'));
    if (mode === 'deadline') deadline();
    await waiting;
    assert.equal(w.host.engine.world.tick, before); assert.equal(w.host.seq, seq);
  });
});

test('waiter cancellation is local; installations without waiters have no rejected promise', async t => {
  const w = fixture(t, false), abort = new AbortController();
  const cancelled = assert.rejects(w.bridge.waitForInitialProjection({ signal: abort.signal }), /cancelled/);
  const live = w.bridge.waitForInitialProjection();
  abort.abort(new Error('cancelled')); await cancelled;
  w.host.tickOnce(); await live;
  assert.equal(w.bridge.initialProjectionReady(), true);
  // Stopping after all waiters settled only records state; it does not manufacture a rejection.
  w.host.stop(); await turns();
});

test('observing readiness preserves the first six engine hashes and accepted event frontiers', async t => {
  const observed = fixture(t), plain = fixture(t);
  const ready = observed.bridge.waitForInitialProjection();
  for (let i = 0; i < 6; i++) {
    observed.host.tickOnce(); plain.host.tickOnce(); await turns();
    assert.equal(observed.host.engine.stateHash(), plain.host.engine.stateHash(), `tick ${i + 1}`);
    const events = (db: Db) => db.events(worldId).map(({ at: _at, ...event }) => event);
    assert.deepEqual(events(observed.db), events(plain.db));
    assert.equal(observed.host.seq, plain.host.seq);
  }
  await ready;
});
