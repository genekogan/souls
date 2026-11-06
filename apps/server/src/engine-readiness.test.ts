import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Engine, EngineFactory } from '@sim/engine-contract';
import { marsFactory, GREEN_FIELD_WORLD } from '@sim/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';

const native = await marsFactory(GREEN_FIELD_WORLD);
const worldId = 'engine-readiness', seed = 'engine-readiness';
const turns = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

// Inject only an adapter execution fault/capability. Recovery, replay, halting, clock lifecycle,
// projection and its waiter are production implementations; no readiness notification is forged.
function fixture(t: TestContext, snapshots = true) {
  const control = { fault: null as Error | null, steps: 0, restores: 0 };
  const wrap = (engine: Engine) => {
    const step = engine.step.bind(engine);
    engine.step = () => {
      control.steps++;
      const fault = control.fault; control.fault = null;
      if (fault) throw fault;
      return step();
    };
    if (!snapshots) engine.canSnapshot = () => false;
    return engine;
  };
  const factory: EngineFactory = { ...native,
    create: world => wrap(native.create(world)),
    restore: snapshot => { control.restores++; return wrap(native.restore(snapshot)); },
  };
  const db = new Db(':memory:'), host = new WorldHost(db, factory, seed, 1e9, worldId);
  host.boot(); host.drainInputs(); host.recoveryForEdge = true;
  t.after(() => { host.stop(); db.close(); });
  return { db, host, factory, control };
}
function bridgeFor(host: WorldHost, db: Db) {
  const god = new GodMode(db, { worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {} });
  return installEngineBridge({ host, god, log() {}, worldClock: false, worldLore: false });
}
function clock(t: TestContext) {
  let now = 0, interval!: () => void, cleared = 0;
  const handle = {} as NodeJS.Timeout;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (fn: () => void) => { interval = fn; return handle; });
  t.mock.method(globalThis, 'clearInterval', (value: unknown) => { assert.equal(value, handle); cleared++; });
  return { frame() { now += 50; interval(); }, get cleared() { return cleared; } };
}

test('an actual unrecoverable first step pauses the host and refuses startup readiness at its bounded deadline', async t => {
  const w = fixture(t, false), bridge = bridgeFor(w.host, w.db), timer = clock(t);
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args); });
  let deadline!: () => void, deadlineMs = 0, cancelled = 0;
  const handle = {} as NodeJS.Timeout;
  t.mock.method(globalThis, 'setTimeout', (fn: () => void, ms: number) => { deadline = fn; deadlineMs = ms; return handle; });
  t.mock.method(globalThis, 'clearTimeout', (value: unknown) => { assert.equal(value, handle); cancelled++; });
  let settled = false;
  const waiting = bridge.waitForInitialProjection();
  const rejected = assert.rejects(waiting, /bridge\.readiness\.clock-unavailable/).then(() => { settled = true; });
  await turns(); // The initial check ran before the fault: this is an already-pending waiter.
  assert.equal(deadlineMs, 60_000, 'the ordinary startup waiter has a bounded default deadline');
  w.control.fault = new Error('fixture.first-step-unrecoverable');
  w.host.start();
  assert.doesNotThrow(() => timer.frame());
  await turns();
  assert.equal(w.control.steps, 1); assert.equal(w.host.engine.world.tick, 0);
  assert.equal(w.control.restores, 0, 'the advertised unsnappable engine has no recovery baseline');
  assert.equal(w.host.paused, true); assert.equal(w.host.running, true);
  assert.match(w.host.engineFault!, /fixture\.first-step-unrecoverable/);
  assert.ok(errors.some(args => String(args[0]).includes('no resumable recovery baseline')));
  assert.throws(() => bridge.initialProjectionReady(), /clock-unavailable/);
  assert.equal(settled, true, 'haltOnFault tells listeners the clock is unavailable (#1120), so an already-pending waiter fails at once');
  timer.frame(); assert.equal(w.control.steps, 1, 'the real timer loop respects the paused fault');
  await rejected; assert.equal(typeof deadline, 'function');
  assert.equal(cancelled, 1, 'deadline settlement releases its timer');
  const frontier = { tick: w.host.engine.world.tick, seq: w.host.seq };
  w.host.stop(); assert.equal(w.host.running, false); assert.equal(timer.cleared, 1);
  timer.frame(); await turns();
  assert.equal(w.control.steps, 1, 'a stale interval callback cannot run after shutdown');
  assert.deepEqual({ tick: w.host.engine.world.tick, seq: w.host.seq }, frontier);
});

test('successful real first-step recovery is durable but cannot certify the bridge bound to the replaced engine', async t => {
  const w = fixture(t);
  const born = w.host.enqueue('birth', 'test', { soulId: 's_A', entityId: 'h_A', name: 'A', description: 'quiet', owner: 'test' });
  w.host.drainInputs(); await born;
  const bridge = bridgeFor(w.host, w.db), original = w.host.engine;
  const decision = w.host.enqueue('decision', 'edge:s_A', { soulId: 's_A', entityId: 'h_A', option: 'rest', label: 'rest',
    steps: [{ verb: 'rest', params: { seconds: 60 } }], reevalTicks: 1200, trigger: 'edge-test', fallback: false });
  w.control.fault = new Error(JSON.stringify([{ code: 'fixture.first-step', message: 'injected execution fault', subjects: ['h_A'] }]));
  assert.doesNotThrow(() => w.host.tickOnce());
  const accepted = await decision;
  const repairs = w.db.events(worldId).filter(event => event.kind === 'rules' && event.payload?.recovery);
  assert.equal(repairs.length, 1, 'WorldHost logged its actual successful recovery recipe');
  assert.ok(repairs[0].payload.recovery.edge.excludedSeqs.includes(accepted.seq), 'the faulting edge decision was filtered');
  assert.ok(w.control.restores > 0); assert.notEqual(w.host.engine, original);
  assert.equal(w.host.engineFault, null); assert.equal(w.host.paused, false);
  assert.deepEqual(w.host.engine.runtime.violations, []);
  assert.throws(() => bridge.initialProjectionReady(), /engine-replaced/);
  await assert.rejects(bridge.waitForInitialProjection(), /engine-replaced/);
  assert.ok(w.db.latestSnapshot(worldId)!.seq >= repairs[0].seq, 'the repaired head is persisted before another boot');
  const recoveredHash = w.host.engine.stateHash();
  w.host.stop();
  const reboot = new WorldHost(w.db, w.factory, seed, 1e9, worldId);
  t.after(() => reboot.stop());
  assert.equal(reboot.boot().from, 'snapshot');
  assert.equal(reboot.engine.stateHash(), recoveredHash);
  const freshBridge = bridgeFor(reboot, w.db), ready = freshBridge.waitForInitialProjection();
  reboot.tickOnce(); reboot.tickOnce(); await ready;
  assert.equal(freshBridge.initialProjectionReady(), true, 'a fresh bridge can certify the repaired engine on a subsequent boot');
  assert.equal(reboot.engineFault, null); assert.equal(reboot.paused, false);
  assert.equal(w.db.events(worldId).filter(event => event.payload?.recovery).length, 1, 'the recorded repair is not repeated');
});

test('an actual unrecoverable fault after initial readiness retains the running paused-host policy', async t => {
  const w = fixture(t, false), bridge = bridgeFor(w.host, w.db), timer = clock(t);
  t.mock.method(console, 'error', () => {});
  let resolved = 0, stopped = 0;
  w.host.listeners.push({ onStop() { stopped++; } });
  const ready = bridge.waitForInitialProjection().then(() => { resolved++; });
  w.host.start(); timer.frame(); timer.frame(); await ready;
  assert.equal(resolved, 1); assert.equal(bridge.initialProjectionReady(), true);
  const tick = w.host.engine.world.tick, seq = w.host.seq;
  w.control.fault = new Error('fixture.served-fault');
  assert.doesNotThrow(() => timer.frame()); await turns();
  assert.equal(w.host.paused, true); assert.equal(w.host.running, true);
  assert.match(w.host.engineFault!, /fixture\.served-fault/);
  assert.equal(stopped, 0, 'the settled startup barrier does not shut down a subsequently faulted host');
  assert.equal(resolved, 1, 'the already-settled readiness promise remains settled');
  assert.equal(w.host.engine.world.tick, tick); assert.equal(w.host.seq, seq);
  const steps = w.control.steps;
  timer.frame(); timer.frame(); await turns();
  assert.equal(w.control.steps, steps, 'the running timer remains paused without retrying the failed step');
  assert.throws(() => bridge.initialProjectionReady(), /clock-unavailable/, 'a new readiness query must not certify the faulted state');
  w.host.stop(); assert.equal(stopped, 1); assert.equal(w.host.running, false);
});
