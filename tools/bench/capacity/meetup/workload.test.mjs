// CW1 (#735) A2–A6: the meetup workload is fixed data, deterministic per seed, and its accounting hides nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, PROFILES, DEMAND, phases, souls, schedule, scheduleId, scheduleCounts, account, outcomeOf, quantiles, clockWindow } from './workload.mjs';

const ROOT = new URL('../../../../', import.meta.url).pathname;

test('ten authored fixtures exist; both profiles total fifty Souls', () => {
  assert.equal(FIXTURES.length, 10);
  for (const f of FIXTURES) assert.ok(existsSync(join(ROOT, 'worlds/templates', `${f.template}.json`)), f.template);
  assert.deepEqual(Object.values(PROFILES).map((p) => p.reduce((a, b) => a + b, 0)), [50, 50]);
  assert.equal(PROFILES.meetup[0], 20);
  assert.equal(PROFILES.meetup.slice(1).reduce((a, b) => a + b, 0), 30);
  assert.ok(PROFILES.even.every((n) => n === 5));
});

test('account and address grouping: a shared-account and a shared-network subset, the rest their own', () => {
  for (const p of Object.keys(PROFILES)) {
    const s = souls(p), by = (k) => s.reduce((m, x) => (m[x[k]] = (m[x[k]] ?? 0) + 1, m), {});
    assert.equal(by('account')['acct-a'], 3); assert.equal(by('account')['acct-b'], 3);
    assert.equal(Object.values(by('address')).filter((n) => n > 1).length, 1);
    assert.equal(Math.max(...Object.values(by('address'))), 5);
    assert.ok(s.every((x) => /^(198\.51\.100|203\.0\.113)\./.test(x.address)), 'documentation addresses only');
  }
});

test('the schedule is deterministic for a seed and changes with the seed', () => {
  const a = schedule('meetup', 'seed-1'), b = schedule('meetup', 'seed-1'), c = schedule('meetup', 'seed-2');
  assert.equal(scheduleId(a), scheduleId(b));
  assert.notEqual(scheduleId(a), scheduleId(c));
  assert.notEqual(scheduleId(schedule('even', 'seed-1')), scheduleId(a));
});

test('declared rates: one read per 4 s, one act per 20 s (plus interrupts), three meetups of 50 acts and 100 reads', () => {
  const ph = phases(), ops = schedule('even', 's'), n = scheduleCounts(ops);
  const perSoulReads = ph.activeMs / DEMAND.readEveryMs, perSoulActs = ph.activeMs / DEMAND.actEveryMs;
  const burst = ops.filter((o) => o.burst != null);
  assert.equal(burst.filter((o) => o.cls === 'act').length, 150);
  assert.equal(burst.filter((o) => o.cls === 'read').length, 300);
  assert.equal(n.read - 300, 50 * perSoulReads);
  // one act slot in actMix.length is a walk followed by a stand
  assert.ok(Math.abs((n.act - 150) - 50 * perSoulActs * (1 + 1 / DEMAND.actMix.length)) <= 50, `${n.act}`);
  for (const [b, m] of ph.meetupsMs.entries()) {
    const acts = burst.filter((o) => o.burst === b && o.cls === 'act'), reads = burst.filter((o) => o.burst === b && o.cls === 'read');
    assert.ok(acts.every((o) => o.atMs >= m && o.atMs < m + DEMAND.burstActWithinMs));
    assert.ok(reads.every((o) => o.atMs >= m + DEMAND.burstActWithinMs && o.atMs <= m + DEMAND.burstActWithinMs + DEMAND.burstReadsWithinMs));
    assert.equal(new Set(acts.map((o) => o.soul)).size, 50);
  }
  assert.deepEqual(new Set(ops.map((o) => o.kind)), new Set(['observe', 'here', 'capabilities', 'resolve', 'walk', 'attention', 'say', 'gesture', 'stand', 'shared', 'meetup']));
  // each Soul's calls are in time order (they are sent one at a time, in this order)
  for (let i = 0; i < 50; i++) { const t = ops.filter((o) => o.soul === i).map((o) => o.atMs); assert.deepEqual(t, [...t].sort((x, y) => x - y)); }
});

test('outcomes: valid gameplay refusals are kept apart from load failures', () => {
  assert.equal(outcomeOf({ status: 200 }), 'ok');
  assert.equal(outcomeOf({ status: 200, accepted: false }), 'gameplay-refused');
  assert.equal(outcomeOf({ status: 503, code: 'world.busy' }), 'load-refused');
  assert.equal(outcomeOf({ status: 429, code: 'account.rate' }), 'load-refused');
  assert.equal(outcomeOf({ status: 429, code: 'something.else' }), 'error');
  assert.equal(outcomeOf({ status: -1 }), 'timeout');
  assert.equal(outcomeOf({ status: 0 }), 'unreachable');
});

test('accounting: offered = issued + unissued; overdue and timeouts are counted, never dropped', () => {
  const ops = [
    { id: 'a', world: 0, cls: 'read', atMs: 0, burst: null }, { id: 'b', world: 0, cls: 'read', atMs: 100, burst: null },
    { id: 'c', world: 1, cls: 'act', atMs: 200, burst: 0 }, { id: 'd', world: 1, cls: 'act', atMs: 300, burst: 0 },
  ];
  const recs = [
    { id: 'a', issuedAt: 0, doneAt: 50, outcome: 'ok' },
    { id: 'b', issuedAt: 1500, doneAt: 1600, outcome: 'ok' },          // overdue: queued behind a, 1.4 s late
    { id: 'c', issuedAt: 200, doneAt: 60_200, outcome: 'timeout' },
  ];
  const a = account(ops, recs);
  assert.deepEqual({ o: a['all|read'].offered, i: a['all|read'].issued, od: a['all|read'].overdue }, { o: 2, i: 2, od: 1 });
  assert.equal(a['all|read'].e2eMs.max, 1500, 'end-to-end runs from the scheduled time');
  assert.equal(a['all|read'].answeredOnlyServiceMs.max, 100, 'answered-only is diagnostic');
  assert.deepEqual(a['all|act'].outcomes, { timeout: 1, unissued: 1 });
  assert.equal(a['all|act'].loadFailures, 1, 'the timeout; the unissued call is counted apart');
  assert.equal(a['all|act'].unissued, 1);
  assert.equal(a['burst0|act'].offered, 2);
  assert.equal(a['w1|act'].e2eMs.max, 60_000);
});

test('quantiles mark p99 as unsupported below 100 samples', () => {
  assert.equal(quantiles([1, 2, 3]).p99Supported, false);
  assert.equal(quantiles(Array.from({ length: 100 }, (_, i) => i)).p99Supported, undefined);
  assert.deepEqual(quantiles([]), { n: 0 });
});

test('clock proof: full clock is 1; a stall is neither clipped nor reset; rate comes from the world', () => {
  const full = Array.from({ length: 61 }, (_, k) => ({ t: k * 1000, tick: k * 20, rttMs: 2 }));
  assert.equal(clockWindow(full, { from: 0, to: 60_000 }).ratio, 1);
  // a 20 s stall in the middle (samples answered, tick frozen), then the clock resumes at full pace
  const stalled = full.map((x) => ({ ...x, tick: x.t <= 20_000 ? x.tick : x.t <= 40_000 ? 400 : 400 + (x.t - 40_000) / 50 }));
  const w = clockWindow(stalled, { from: 0, to: 60_000 });
  assert.equal(w.ratio, +(800 / 1200).toFixed(4));
  assert.equal(w.maxStallMs, 20_000);
  assert.equal(w.endDeficitTicks, 400, 'the deficit after the stall stays visible');
  // an unanswered stretch (no samples for 30 s) is one 30 s gap, not a shorter elapsed time
  const gap = full.filter((x) => x.t <= 10_000 || x.t >= 40_000);
  const g = clockWindow(gap, { from: 0, to: 60_000 });
  assert.equal(g.maxSampleGapMs, 30_000); assert.equal(g.ratio, 1);
  // a half-rate admin setting is due half the ticks
  assert.equal(clockWindow(full.map((x) => ({ ...x, tick: x.tick / 2 })), { from: 0, to: 60_000, rate: 0.5 }).ratio, 1);
  assert.equal(clockWindow(full.slice(0, 1), { from: 0, to: 60_000 }).ratio, null);
});

test('phases --active-min (#955): the default is the CW2 baseline schedule; a long window keeps rates and repeats meetups', () => {
  // the schedule sha256 of capacity-qualify run 41915686991 (the CW2 baseline), both profiles, seed cw1
  const BASE = { even: 'ae3dfd508b0c5f68315eaab8d99c0d6c1083291c685dd5615b052cb831814572', meetup: 'e077d9f729165e0cbf640fa5d9a3ada1c893ce342665d9921338cb602dda8ff8' };
  for (const p of ['even', 'meetup']) { assert.equal(scheduleId(schedule(p, 'cw1', phases())), BASE[p]); assert.equal(scheduleId(schedule(p, 'cw1', phases(false, 20))), BASE[p]); }
  const L = phases(false, 60);
  assert.equal(L.activeMs, 60 * 60_000); assert.equal(L.quietMs, phases().quietMs);
  assert.deepEqual(L.meetupsMs.map((m) => m / 60_000), [5, 11, 17, 25, 31, 37, 45, 51, 57]);
  assert.deepEqual(phases(false, 70).meetupsMs.map((m) => m / 60_000).slice(9), [65], 'a partial block keeps the meetups that fit');
  const per = (ph, cls) => schedule('even', 'cw1', ph).filter((o) => o.soul === 0 && o.cls === cls && o.burst == null).length;
  assert.equal(per(L, 'read'), 3 * per(phases(), 'read'), 'the same read rate, three times as long');
  for (const bad of [19, 241, 30.5, NaN]) assert.throws(() => phases(false, bad), /--active-min/);
  assert.throws(() => phases(true, 60), /--short/);
});
