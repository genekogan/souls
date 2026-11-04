// CW5 S1 (#739 A4/A6): alert rules over the telemetry store, and the drill: synthetic scrapes through the real
// collector path (metricsText → scrapeOnce → Store) on a fake clock at the 15 s cadence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { metricsText } from './metrics.mjs';
import { openStore, scrapeOnce } from './telemetry.mjs';
import { catchUp, evaluate, rulesWith, initialState, NOT_EXPORTED } from './telemetry/alerts.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const tmp = (t) => { mkdirSync(join(ROOT, '.local'), { recursive: true }); const d = mkdtempSync(join(ROOT, '.local', 'alerts-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const S = 1000, MIN = 60 * S, EVERY = 15 * S, T0 = Date.UTC(2026, 10, 1, 0, 0, 0);
const live = (t, o = {}) => ({ v: 1, pid: 1, at: o.stale ? t - 60 * S : t - 2 * S, phase: 'serving', loop: { lastTurnAgeMs: 10, delayP99Ms: o.loop ?? 20, elu: o.elu ?? 0.3 },
  tick: { world: Math.round((t - T0) / 50), service5s: 1, p99Ms: o.p99 ?? 30, lateTotal: o.late ?? 0 }, heap: { usedMb: o.heap ?? 500, limitMb: 2048, gcPct10s: o.gc ?? 1, gcSecondsTotal: 0 },
  level: 'green', queue: { depth: 0, oldestMs: o.oldest ?? 0 }, souls: { awake: 3, waiting: 0, connected: 3 }, shed: { reads: o.shed ?? 0, acts: 0 } });
const world = (slug, t, o = {}) => ({ slug, status: o.status ?? 'running', restarts: o.restarts ?? 0, refused: o.refused, live: o.nolive ? null : live(t, o) });
const fetchOf = (body, status = 200) => async () => ({ ok: status === 200, status, text: async () => body });

/** A collector on a fake clock. scene(t) → [world...] or 'fail' (HTTP 500) or 'silent' (no scrape at all). */
async function run(dir, scene, { from = 0, to, eachStep = false } = {}) {
  const store = openStore(dir, { everyMs: EVERY }), events = [];
  for (let s = from; s < to; s += EVERY / S) {
    const t = T0 + s * S, w = scene(s);
    if (w === 'silent') continue;
    const body = w === 'fail' ? '' : metricsText({ now: t, launcher: { build: 'test', maxRunning: 10, memAvailableMb: 8192 }, worlds: w });
    await scrapeOnce(store, 'http://127.0.0.1:1/__sim/metrics', { now: () => t, fetchImpl: fetchOf(body, w === 'fail' ? 500 : 200) });
    if (eachStep) events.push(...catchUp(dir, { everyMs: EVERY, now: t }).events);
  }
  store.saveState();
  return events;
}
const healthy = (s) => [world('a', T0 + s * S), world('b', T0 + s * S)];
const lines = (dir) => (existsSync(join(dir, 'alerts.jsonl')) ? readFileSync(join(dir, 'alerts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('drill: a loop stall fires within 60 s, stays silent while unchanged, resolves once', async (t) => {
  const dir = tmp(t);
  const ev = await run(dir, (s) => (s >= 300 && s < 600 ? [world('a', T0 + s * S, { loop: 400 }), world('b', T0 + s * S)] : healthy(s)), { to: 600 + 30 * 60, eachStep: true });
  const mine = ev.filter((e) => e.rule === 'loop-stall');
  assert.deepEqual(mine.map((e) => [e.world, e.to]), [['a', 'firing'], ['a', 'resolved']]);
  assert.ok(mine[0].t - (T0 + 300 * S) <= 60 * S, `fired ${(mine[0].t - T0) / S - 300} s after the condition held`);
  assert.ok(mine[1].t - (T0 + 600 * S) >= 60 * S && mine[1].t - (T0 + 600 * S) <= 90 * S, 'resolved after the clear window, not before');
  assert.equal(ev.length, 2, `no other transition in 40 min (b healthy throughout, 30 min unchanged after recovery): ${JSON.stringify(ev)}`);
  assert.deepEqual(lines(dir), ev, 'alerts.jsonl holds exactly the transitions');
});

test('drill: every world rule fires within 60 s of its condition and resolves', async (t) => {
  const cases = [
    ['tick-slow', { p99: 200 }], ['gc-pressure', { gc: 30 }], ['main-thread-busy', { elu: 0.97 }], ['heap-pressure', { heap: 1900 }],
    ['queue-stall', { oldest: 5000 }], ['stale-live', { stale: true }],
  ];
  for (const [rule, o] of cases) {
    const dir = tmp(t);
    const ev = await run(dir, (s) => [world('a', T0 + s * S, s >= 120 && s < 300 ? o : {})], { to: 600, eachStep: true });
    const mine = ev.filter((e) => e.rule === rule);
    assert.deepEqual(mine.map((e) => e.to), ['firing', 'resolved'], `${rule}: ${JSON.stringify(ev)}`);
    assert.ok(mine[0].t - (T0 + 120 * S) <= 60 * S, `${rule} fired late`);
  }
});

test('drill: clock lag reads late ticks per second; refusals fire on any increase and stay deduplicated', async (t) => {
  const dir = tmp(t);
  // 2 late ticks per second from 120 s to 300 s; refusals at 400 s and 420 s (one alert, not two)
  const ev = await run(dir, (s) => [world('a', T0 + s * S, { late: s < 120 ? 0 : 2 * (Math.min(s, 300) - 120), refused: s >= 400 ? { 'world.busy': s >= 420 ? 9 : 4 } : undefined })], { to: 900, eachStep: true });
  const lag = ev.filter((e) => e.rule === 'clock-lag'), ref = ev.filter((e) => e.rule === 'refusals');
  assert.deepEqual(lag.map((e) => e.to), ['firing', 'resolved']);
  assert.ok(lag[0].t - (T0 + 120 * S) <= 60 * S);
  assert.equal(lag[0].value, 2);
  assert.deepEqual(ref.map((e) => e.to), ['firing', 'resolved'], JSON.stringify(ref));
  assert.ok(ref[1].t - (T0 + 420 * S) >= 5 * MIN, 'refusals clear only after 5 quiet minutes');
});

test('drill: a crash loop is judged while the world is not running', async (t) => {
  const dir = tmp(t);
  const ev = await run(dir, (s) => [world('a', T0 + s * S, { status: s >= 60 && s < 120 ? 'restarting' : 'running', restarts: s < 60 ? 0 : Math.min(3, Math.floor((s - 60) / 15) + 1), nolive: s >= 60 && s < 120 })], { to: 60 + 25 * 60, eachStep: true });
  const mine = ev.filter((e) => e.rule === 'crash-loop');
  assert.deepEqual(mine.map((e) => e.to), ['firing', 'resolved']);
  assert.ok(mine[0].t - (T0 + 90 * S) <= 60 * S, 'fires once the third restart is seen');
  assert.ok(mine[1].t - mine[0].t >= 10 * MIN, 'stays firing while the restarts are inside the 10 min window');
  assert.ok(!ev.some((e) => e.rule !== 'crash-loop' && e.to === 'unknown'), 'a restarting world is not a missing-telemetry world');
});

test('drill: collector outage, failed scrapes or no rows at all, fires telemetry-gap and recovers', async (t) => {
  const dir = tmp(t);
  const ev = await run(dir, (s) => (s >= 300 && s < 420 ? 'fail' : healthy(s)), { to: 600, eachStep: true });
  const gap = ev.filter((e) => e.rule === 'telemetry-gap');
  assert.deepEqual(gap.map((e) => e.to), ['firing', 'resolved']);
  assert.ok(gap[0].t - (T0 + 300 * S) <= 60 * S, 'failed scrapes surface within 60 s');
  assert.equal(gap[1].t, T0 + 420 * S);
  // silence: the collector died; a cron-style catch-up 5 min later sees no rows and says so
  const silent = catchUp(dir, { everyMs: EVERY, now: T0 + 600 * S + 5 * MIN });
  assert.deepEqual(silent.events.map((e) => [e.rule, e.to]), [['telemetry-gap', 'firing']]);
  assert.deepEqual(silent.open, [{ rule: 'telemetry-gap', state: 'firing' }]);
  // and an empty store is a gap too, never healthy
  assert.deepEqual(catchUp(tmp(t), { everyMs: EVERY, now: T0 }).events.map((e) => e.to), ['firing']);
});

test('missing series on a running world are unknown, never healthy; what is not exported is listed', async (t) => {
  const dir = tmp(t);
  const ev = await run(dir, (s) => [world('a', T0 + s * S, { nolive: s >= 60 && s < 180 })], { to: 300, eachStep: true });
  const unk = ev.filter((e) => e.world === 'a' && e.to === 'unknown').map((e) => e.rule).sort();
  assert.deepEqual(unk, ['clock-lag', 'gc-pressure', 'heap-pressure', 'loop-stall', 'main-thread-busy', 'queue-stall', 'stale-live', 'tick-slow']);
  assert.ok(ev.filter((e) => e.to === 'unknown').every((e) => e.t - (T0 + 60 * S) <= 60 * S));
  assert.equal(ev.filter((e) => e.to === 'known').length, unk.length, 'each one becomes known again exactly once');
  assert.deepEqual(catchUp(dir, { everyMs: EVERY, now: T0 + 300 * S }).notExported, NOT_EXPORTED);
});

test('deterministic: one catch-up over the store equals evaluating after every scrape; a restart repeats nothing', async (t) => {
  const scene = (s) => (s >= 200 && s < 500 ? [world('a', T0 + s * S, { loop: 400, elu: 0.95 }), world('b', T0 + s * S, { stale: s > 300 })] : healthy(s));
  const a = tmp(t), b = tmp(t);
  const stepwise = await run(a, scene, { to: 900, eachStep: true });
  await run(b, scene, { to: 900 });
  const once = catchUp(b, { everyMs: EVERY, now: T0 + 885 * S }).events;
  assert.deepEqual(once, stepwise);
  assert.ok(stepwise.length >= 6);
  assert.deepEqual(catchUp(b, { everyMs: EVERY, now: T0 + 885 * S }).events, [], 'evaluating again from the saved state adds nothing');
});

test('rules: overrides change thresholds and windows or turn a rule off; unknown ids are refused', () => {
  const r = rulesWith({ 'loop-stall': { threshold: 1, holdMs: 0 }, 'host-memory': { off: true } });
  assert.equal(r.find((x) => x.id === 'loop-stall').threshold, 1);
  assert.ok(!r.some((x) => x.id === 'host-memory'));
  assert.throws(() => rulesWith({ 'no-such': {} }), /unknown rule no-such/);
  // pure evaluation on bare rows: hysteresis holds a firing state between the clear threshold and the threshold
  const row = (s, v) => ({ t: T0 + s * S, ok: true, values: new Map([['sim_world_status{status="running",world="a"}', 1], ['sim_world_event_loop_delay_p99_seconds{world="a"}', v]]) });
  const only = rulesWith(Object.fromEntries(rulesWith().filter((x) => x.id !== 'loop-stall').map((x) => [x.id, { off: true }])));
  const { events } = evaluate([row(0, 0.3), row(15, 0.3), row(30, 0.3), row(45, 0.2), row(60, 0.2), row(75, 0.2), row(90, 0.1), row(105, 0.1), row(120, 0.1), row(135, 0.1), row(150, 0.1)], only, initialState(), { everyMs: EVERY });
  assert.deepEqual(events.map((e) => [(e.t - T0) / S, e.to]), [[30, 'firing'], [150, 'resolved']], '0.2 is above the clear threshold 0.15: still firing');
});
