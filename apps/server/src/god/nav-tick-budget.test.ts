import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { kernelHash } from '@souls/kernel';
import { Db } from '../db.ts';
import { WorldHost, replayFromGenesis, type HostListener } from '../world.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { MarsEngine } from '../../../../packages/engine-mars/src/engine.ts';
import { Spatial } from '../../../../mars/viewer/engine/spatial/service.ts';
import { NavConnectivity, type ConnPoint } from '../../../../mars/viewer/engine/spatial/connectivity.ts';
import type { SpatialScene } from '../../../../mars/viewer/engine/spatial/types.ts';
import { addAll, component, emptyWorld, human } from '../../../../mars/viewer/engine/world/factory.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fixture(t: TestContext) {
  const db = new Db(':memory:'), host = new WorldHost(db, toyFactory, 'nav-tick-budget', 1e9, 'nav-tick-budget');
  host.boot(); host.drainInputs(); t.after(() => { host.stop(); db.close(); });
  const clock = { now: 100, readCost: 0, stepCost: 0, earlierCost: 0 };
  const calls: { tick: number; name: string }[] = [], grants: number[] = [];
  const contexts: { name: string; value: Parameters<NonNullable<HostListener['afterTick']>>[1] }[] = [];
  const call = (name: string) => calls.push({ tick: host.engine.world.tick, name });
  host.listeners.push({ afterTick(_tick, context) { call('earlier'); contexts.push({ name: 'earlier', value: context }); clock.now += clock.earlierCost; } });
  const god = new GodMode(db, { worldId: host.worldId, ownerId: 'owner', tick: () => host.engine.world.tick, emit() {} });
  const bridge = installEngineBridge({ host, god, log() {}, worldClock: false, worldLore: false });
  const state = bridge as any;
  Object.assign(state, { reconciled: true, writeBackPass: {}, navWarm: false, navPending: true, navDeferred: [],
    editTick: 0, evacuatedEdit: 0, rescued: 0, rescuedAt: -100 });
  const costs: Record<string, number> = {};
  for (const name of ['flush', 'perceiveStep', 'spotsStep', 'layersStep', 'flushMapNotices', 'evacuateSites', 'rescueTrapped']) {
    t.mock.method(state, name, () => { call(name); clock.now += costs[name] ?? 0; if (name === 'rescueTrapped') state.rescued = state.editTick; });
  }
  t.mock.method(bridge, 'writeBack', (budget: number) => { assert.equal(budget, 8); call('writeBack'); clock.now += costs.writeBack ?? 0; return false; });
  t.mock.method(state, 'navRescueSouls', () => { call('navRescueSouls'); return 0; });
  t.mock.method(state, 'navLines', () => { call('navLines'); return []; });
  let warm = (_budget: number) => false;
  Object.assign(host.engine, { navWarmV1(budget: number) { call('nav'); grants.push(budget); return warm(budget); } });
  host.listeners.push({ afterTick(_tick, context) { call('later'); contexts.push({ name: 'later', value: context }); } });
  const originalStep = host.engine.step;
  t.mock.method(host.engine, 'step', function (this: typeof host.engine, ...args: Parameters<typeof originalStep>) {
    call('step'); clock.now += clock.stepCost; return originalStep.apply(this, args);
  });
  t.mock.method(performance, 'now', () => { const value = clock.now; clock.now += clock.readCost; return value; });
  return { db, host, bridge, state, clock, calls, contexts, grants, costs, warm(fn: (ms: number) => boolean) { warm = fn; } };
}

test('installed nav allowance includes engine work and prior listeners, while retaining the 20ms cap', t => {
  const f = fixture(t); f.clock.stepCost = 25; f.clock.earlierCost = 5;
  f.host.tickOnce(); assert.equal(f.grants.at(-1), 10, '30ms already spent leaves 10ms of the 40ms envelope');
  assert.equal(f.contexts[0].value?.startedAtMs, 100, 'context starts before engine.step');
  assert.equal(f.contexts[0].value, f.contexts[1].value, 'listeners share the exact same tick start');
  assert.equal(Object.isFrozen(f.contexts[0].value), true);
  f.clock.stepCost = 41; f.clock.earlierCost = 0;
  f.host.tickOnce(); assert.equal(f.grants.at(-1), 0, 'exhausted ticks still poll native navigation');
  assert.notEqual(f.contexts[2].value, f.contexts[0].value, 'a new tick has a new context');
  assert.equal(f.contexts[2].value?.startedAtMs, 130);
  f.clock.stepCost = 0; f.costs.writeBack = 8; f.costs.perceiveStep = 7;
  f.host.tickOnce(); assert.equal(f.grants.at(-1), 20, '15ms prefix retains the existing cap');
  f.costs.flush = 12;
  f.host.tickOnce(); assert.equal(f.grants.at(-1), 13, 'bridge work also consumes the same envelope');
  assert.equal(f.host.engine.world.tick, 4, 'manual stepping remains synchronous and complete');
});

test('exhausted nav budget preserves required listener order, accepted input sequence, and replay', async t => {
  const f = fixture(t); f.clock.stepCost = 50;
  f.state.evacuatedEdit = -1; f.state.rescued = -1;
  const accepted = f.host.enqueue('admin', 'nav-budget-test', { action: 'ordered input' });
  let sawApplied = false;
  f.host.listeners.unshift({ onApplied(event) { if (event.author === 'nav-budget-test') { sawApplied = true; assert.equal(f.host.engine.world.tick, 0); } } });
  // Catch-up work is only a cache schedule; accepted input remains before the first engine step.
  const step = f.host.engine.step;
  t.mock.method(f.host.engine, 'step', function (this: typeof f.host.engine, ...args: Parameters<typeof step>) {
    assert.equal(sawApplied, true); return step.apply(this, args);
  });
  for (let i = 0; i < 54; i++) f.host.tickOnce();
  const event = await accepted; assert.equal(event.tick, 0);
  assert.ok(f.grants.length >= 54); assert.ok(f.grants.every(ms => ms === 0));
  const names = (tick: number) => f.calls.filter(c => c.tick === tick && c.name !== 'step').map(c => c.name);
  assert.deepEqual(names(10), ['earlier', 'flush', 'writeBack', 'perceiveStep', 'nav', 'evacuateSites', 'rescueTrapped', 'later']);
  assert.deepEqual(names(14), ['earlier', 'flush', 'writeBack', 'perceiveStep', 'spotsStep', 'nav', 'later']);
  assert.deepEqual(names(47), ['earlier', 'flush', 'writeBack', 'perceiveStep', 'layersStep', 'nav', 'later']);
  assert.deepEqual(names(53), ['earlier', 'flush', 'writeBack', 'perceiveStep', 'flushMapNotices', 'nav', 'later']);
  const events = f.db.events(f.host.worldId);
  assert.equal(events.filter(e => e.author === 'nav-budget-test').length, 1);
  const replay = replayFromGenesis(toyFactory, f.host.seed, events, f.host.engine.world.tick);
  assert.equal(replay.engine.stateHash(), f.host.engine.stateHash());
  assert.equal(kernelHash(replay.kernel), kernelHash(f.host.kernel));
});

test('zero polls retain pending work without a hidden progress override; cheap ticks complete once', t => {
  const f = fixture(t); f.clock.stepCost = 50;
  f.warm(ms => ms > 0);
  for (let i = 0; i < 50; i++) f.host.tickOnce();
  assert.ok(f.grants.every(ms => ms === 0)); assert.equal(f.state.navPending, true); assert.equal(f.state.navWarm, false);
  assert.equal(f.calls.some(c => c.name === 'navRescueSouls'), false);
  f.clock.stepCost = 0; f.host.tickOnce();
  assert.equal(f.grants.at(-1), 20); assert.equal(f.state.navPending, false); assert.equal(f.state.navWarm, true);
  assert.equal(f.calls.filter(c => c.name === 'navRescueSouls').length, 1);
  const calls = f.grants.length; f.host.tickOnce(); assert.equal(f.grants.length, calls, 'completed background work stays quiescent');
  f.state.navStep(); assert.equal(f.grants.at(-1), 20, 'legacy no-context method call retains its original allowance');
});

function graphFixture() {
  const scene: SpatialScene = { bounds: [-16, -16, 16, 16], levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [16, 16], yaw: 0 } }],
    obstacles: [{ id: 'wall', kind: 'wall', obb: { c: [4, 0], half: [.5, 6], yaw: 0 }, y0: 0, y1: 3 }], links: [] };
  const world = addAll(emptyWorld('tick-nav-graph', scene), human('person', 0, 0));
  const spatial = new Spatial(scene, { cell: 1 }); spatial.sync(world);
  const engine = Object.create(MarsEngine.prototype) as MarsEngine;
  Object.assign(engine, { rt: { world, services: { spatial } }, cfg: { arrival: [0, 0] } });
  return { world, spatial, engine, connection: () => (engine as unknown as { conn: NavConnectivity }).conn };
}
const points: ConnPoint[] = [{ id: 'arrival', p: [0, 0], tol: 1 }, { id: 'across', p: [8, 0], tol: 1 }, { id: 'wall', p: [4, 0], tol: .1 }];

test('real current-epoch graph invalidates at zero, resumes on cheap ticks, and required reads remain fresh', t => {
  const f = fixture(t), actual = graphFixture(), reference = graphFixture();
  f.warm(ms => actual.engine.navWarmV1(ms));
  actual.engine.navWarmV1(Infinity); reference.engine.navWarmV1(Infinity);
  const conn = actual.connection(), epoch = actual.spatial.epoch;
  for (const w of [actual, reference]) w.world.entities.edit = component('edit', 'test-wall', [0, 0, 4]);
  f.clock.stepCost = 50; f.host.tickOnce();
  assert.equal(f.grants.at(-1), 0); assert.ok(actual.spatial.epoch > epoch);
  assert.equal(conn.ready, false, 'the real adapter polled and invalidated current geometry despite zero allowance');
  assert.equal(f.state.navPending, true); assert.equal(f.state.navWarm, false);
  f.clock.stepCost = 0; f.clock.readCost = .25;
  let ticks = 0; while (f.state.navPending) { f.host.tickOnce(); assert.ok(++ticks < 2000, 'eligible finite slices make progress'); }
  reference.engine.navWarmV1(Infinity);
  assert.equal(conn.ready, true); assert.ok(conn.stats.updates > 0);
  assert.deepEqual(conn.check(points), reference.connection().check(points));
  assert.equal(conn.check(points)[2].code, 'nav.no-standing-room');
  assert.deepEqual(conn.summary(), reference.connection().summary());
  assert.equal(f.calls.filter(c => c.name === 'navRescueSouls').length, 1);
  for (const w of [actual, reference]) delete w.world.entities.edit;
  f.state.navPending = true; f.clock.stepCost = 50; f.host.tickOnce();
  assert.equal(f.grants.at(-1), 0); assert.equal(conn.ready, false);
  assert.deepEqual(actual.engine.navCheckV1(points), reference.engine.navCheckV1(points), 'required reads drain the current epoch independently of the background allowance');
  assert.equal(conn.ready, true);
});
