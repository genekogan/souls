import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@sim/engine-toy';
import type { Diff } from '@sim/world-compiler';
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
  const w = fixture(t, () => --remaining <= 0);
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
  assert.equal(w.calls.length, 4, 'ready navigation: only the #901 poll (tick 5 of every 10)'); assert.equal(w.calls[3].tick, 5);
  assert.equal(w.rescues(), 1); assert.equal(w.notices.length, 1);
  assert.equal(w.flushes(), 8, 'other per-tick bridge work continues while navigation is pending and idle');
});

test('an accepted geometry notification re-arms completed navigation on the next tick', t => {
  let remaining = 1;
  const w = fixture(t, () => --remaining <= 0);
  w.tick(); w.tick(); assert.equal(w.state.navPending, false);
  assert.deepEqual(w.rearm(), ['completed navigation notice'], 'the previous notice is consumed by the next edit reply');
  remaining = 2; assert.equal(w.state.navPending, true);
  w.tick(); assert.equal(w.calls.at(-1)!.tick, 3); assert.equal(w.state.navPending, true);
  w.tick(); assert.equal(w.state.navPending, false); assert.equal(w.rescues(), 2); assert.equal(w.notices.length, 2);
  w.tick(); assert.equal(w.calls.length, 4, 'ready navigation: only the #901 poll'); assert.equal(w.calls[3].tick, 5);
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

test('#901: after the first build, labels gone cold are found by a poll every 10 ticks and relabelled a slice a tick', t => {
  let warm = true, slices = 0;
  // cold (a moving ride invalidated them) until `slices` relabel calls have run
  const w = fixture(t, () => { if (!warm && --slices <= 0) warm = true; return warm; });
  const upTo = (n: number) => { while (w.host.engine.world.tick < n) w.tick(); };
  upTo(4);
  assert.deepEqual(w.calls, [{ tick: 2, budget: 20 }], 'the first build; warm reads cost nothing until the poll');
  upTo(5);
  assert.equal(w.calls.length, 2); assert.equal(w.calls[1].tick, 5, 'polled on tick 5 of every 10 (off the writeBack tick)');
  assert.ok(w.calls[1].budget > 0 && w.calls[1].budget <= 10, `one slice at most 10 ms: ${w.calls[1].budget}`);
  warm = false; slices = 3;
  upTo(14); assert.equal(w.calls.length, 2, 'no work between polls');
  upTo(18);
  assert.deepEqual(w.calls.slice(2).map(c => c.tick), [15, 16, 17], 'found cold on the poll, then a slice each tick until warm');
  assert.ok(w.calls.slice(2).every(c => c.budget > 0 && c.budget <= 10));
  assert.equal(w.state.navWarm, true); assert.equal(w.state.navPending, false, 'the first-build state is untouched');
  assert.equal(w.rescues(), 1, 'a re-warm is not an edit: no rescue, no notice'); assert.equal(w.notices.length, 1);
  upTo(25); assert.deepEqual(w.calls.slice(5).map(c => c.tick), [25], 'warm again: back to the poll');
});

test('#901: labels that stay cold past 30 slices in a row are sliced only on poll ticks until warm', t => {
  let warm = true;
  const w = fixture(t, () => warm);
  const upTo = (n: number) => { while (w.host.engine.world.tick < n) w.tick(); };
  upTo(4); warm = false;   // the static world keeps moving under the relabel (a flying carrier): every build is cancelled
  upTo(100);
  const cold = w.calls.slice(1).map(c => c.tick);
  assert.deepEqual(cold.slice(0, 30), Array.from({ length: 30 }, (_, i) => 5 + i), '30 slices in a row from the poll at tick 5');
  assert.deepEqual(cold.slice(30), [35, 45, 55, 65, 75, 85, 95], 'then one slice per poll');
  warm = true; upTo(106);
  assert.equal(w.calls.at(-1)!.tick, 105); assert.equal(w.calls.length, 1 + 30 + 8);
  warm = false; upTo(146);
  assert.equal(w.calls.length, 1 + 30 + 8 + 31, 'warm again resets the run: a new burst from the next poll');
});

test('#901: a re-warm error is logged once and the poll stops until the first-build path completes again', t => {
  let fail = false;
  const w = fixture(t, () => { if (fail) throw new Error('controlled re-warm failure'); return true; });
  w.tick(); w.tick(); fail = true;
  while (w.host.engine.world.tick < 40) w.tick();
  assert.deepEqual(w.logs, ['nav re-warm: controlled re-warm failure']);
  assert.deepEqual(w.calls.map(c => c.tick), [2, 5], 'no retry loop');
  fail = false; w.rearm(); w.tick();
  assert.equal(w.calls.length, 3, 'an edit re-arms the first-build path'); assert.equal(w.state.navPending, false);
  while (w.host.engine.world.tick < 45) w.tick();
  assert.equal(w.calls.at(-1)!.tick, 45, 'and the completed build re-arms the poll');
});
