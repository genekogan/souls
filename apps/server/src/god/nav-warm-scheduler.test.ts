import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import type { Diff } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { WorldHost } from '../world.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

type Point = [number, number];
type SchedulerState = {
  reconciled: boolean; navWarm: boolean; navPending: boolean; navDeferred: Point[]; navLater: string[];
  reconcile(): void; flush(): void; writeBack(): void; perceiveStep(tick: number): void;
  spotsStep(): void; layersStep(): void; flushMapNotices(): void; evacuateSites(): void; rescueTrapped(): void;
  navRescueSouls(): number; navLines(spots: Point[], stepped: number): string[];
};
/** Exercise the installed listener and real navStep through completed host ticks. Only the engine's readiness
 * interface and unrelated bridge jobs are controlled; the cadence, readiness/error transitions and edit re-arm are real. */
function fixture(t: TestContext, warm?: (budget: number, tick: number) => boolean) {
  const db = new Db(':memory:'), host = new WorldHost(db, toyFactory, 'nav-warm-scheduler', 1e9, 'nav-warm-scheduler');
  host.boot(); host.drainInputs();
  const logs: string[] = [], calls: { tick: number; budget: number }[] = [], notices: { spots: Point[]; stepped: number }[] = [];
  let rescues = 0, flushes = 0;
  const engine = host.engine as unknown as { navWarmV1?: (budget: number) => boolean };
  if (warm) engine.navWarmV1 = budget => {
    const tick = host.engine.world.tick;
    assert.equal(host.kernel.tick, tick, 'navigation runs after the authoritative tick has advanced');
    calls.push({ tick, budget }); return warm(budget, tick);
  };
  const god = new GodMode(db, { worldId: host.worldId, ownerId: 'test-owner', tick: () => host.engine.world.tick, emit() {} });
  const bridge = installEngineBridge({ host, god, log: line => logs.push(line), worldClock: false, worldLore: false });
  const state = bridge as unknown as SchedulerState;
  t.mock.method(state, 'reconcile', () => { state.reconciled = true; });
  t.mock.method(state, 'flush', () => { flushes++; });
  for (const name of ['writeBack', 'perceiveStep', 'spotsStep', 'layersStep', 'flushMapNotices', 'evacuateSites', 'rescueTrapped'] as const)
    t.mock.method(state, name, () => {});
  t.mock.method(state, 'navRescueSouls', () => { rescues++; return 2; });
  t.mock.method(state, 'navLines', (spots: Point[], stepped: number) => { notices.push({ spots: structuredClone(spots), stepped }); return ['completed navigation notice']; });
  t.after(() => { host.stop(); db.close(); });
  const tick = () => { const before = host.engine.world.tick; host.tickOnce(); assert.equal(host.engine.world.tick, before + 1); };
  const changed: Diff = { upserts: [], removes: ['removed-test-geometry'], defs: [], tiles: [], answers: [] };
  const rearm = () => god.bodies!.navNote!(changed);
  return { host, state, calls, logs, notices, tick, rearm, rescues: () => rescues, flushes: () => flushes };
}

test('navigation progresses on consecutive completed ticks, completes its notice once, then stays idle', t => {
  let remaining = 3;
  const w = fixture(t, () => --remaining === 0);
  w.state.navDeferred = [[4, 8]];
  w.tick(); assert.equal(w.calls.length, 0, 'initial reconciliation keeps its existing separate tick');
  for (let i = 0; i < 2; i++) {
    w.tick(); assert.equal(w.calls.length, i + 1); assert.equal(w.state.navWarm, false);
    assert.equal(w.state.navPending, true); assert.equal(w.rescues(), 0); assert.equal(w.notices.length, 0);
  }
  w.tick();
  assert.deepEqual(w.calls, [{ tick: 2, budget: 20 }, { tick: 3, budget: 20 }, { tick: 4, budget: 20 }]);
  assert.equal(w.state.navWarm, true); assert.equal(w.state.navPending, false);
  assert.deepEqual(w.notices, [{ spots: [[4, 8]], stepped: 2 }]); assert.equal(w.rescues(), 1);
  assert.deepEqual(w.state.navDeferred, []); assert.deepEqual(w.state.navLater, ['completed navigation notice']);
  for (let i = 0; i < 5; i++) w.tick();
  assert.equal(w.calls.length, 3); assert.equal(w.rescues(), 1); assert.equal(w.notices.length, 1);
  assert.equal(w.flushes(), 8, 'other per-tick bridge work continues while navigation is pending and idle');
});

test('an accepted geometry notification re-arms completed navigation on the next tick', t => {
  let remaining = 1;
  const w = fixture(t, () => --remaining === 0);
  w.tick(); w.tick(); assert.equal(w.state.navPending, false);
  assert.deepEqual(w.rearm(), ['completed navigation notice'], 'the previous notice is consumed by the next edit reply');
  remaining = 2; assert.equal(w.state.navPending, true);
  w.tick(); assert.equal(w.calls.at(-1)!.tick, 3); assert.equal(w.state.navPending, true);
  w.tick(); assert.equal(w.state.navPending, false); assert.equal(w.rescues(), 2); assert.equal(w.notices.length, 2);
  w.tick(); assert.equal(w.calls.length, 3, 'ready navigation has no recurring background cost');
});

test('a navigation error preserves its diagnostic and stops retrying until another edit', t => {
  let fail = true;
  const w = fixture(t, () => { if (fail) throw new Error('controlled nav failure'); return true; });
  w.tick(); w.tick();
  assert.equal(w.state.navWarm, true); assert.equal(w.state.navPending, false);
  assert.deepEqual(w.logs, ['nav warm: controlled nav failure']); assert.equal(w.rescues(), 0); assert.equal(w.notices.length, 0);
  w.tick(); w.tick(); assert.equal(w.calls.length, 1, 'higher frequency does not create an error retry loop');
  fail = false; w.rearm(); w.tick();
  assert.equal(w.calls.length, 2); assert.equal(w.state.navPending, false); assert.equal(w.rescues(), 1);
  assert.equal(w.logs.length, 1);
});

test('an engine without navigation support becomes ready without repeated work', t => {
  const w = fixture(t);
  w.tick(); w.tick(); w.tick();
  assert.equal(w.state.navWarm, true); assert.equal(w.state.navPending, false);
  assert.equal(w.calls.length, 0); assert.equal(w.rescues(), 0); assert.equal(w.notices.length, 0);
});
