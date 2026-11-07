// CW7 (#741): the slopes bench's pure parts: distant inventory, the reductions, profile summaries and the slopes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY_DEFS, CLEARANCE_M, emptySquare, withDistantInventory } from './inventory.mjs';
import { AXES, CROWD_MS, SLOPES, activePlan, activeWindow, cores, liveWindow, planSeed, probeRoute, qualifies, reportText, scheduleFacts, slopes, summarizeProfile } from './report.mjs';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const EDEN = JSON.parse(readFileSync(`${ROOT}worlds/templates/eden-2026.json`, 'utf8'));
const places = (t) => t.batches.flatMap((b) => b.ops.filter((o) => o.op === 'place'));

test('distant inventory: exact totals, deterministic, distant from every authored object, authored batches untouched', () => {
  const own = places(EDEN).length;
  for (const total of [5000, 10000]) {
    const a = withDistantInventory(EDEN, total), b = withDistantInventory(EDEN, total);
    assert.equal(places(a.template).length, total);
    assert.equal(a.added, total - own);
    assert.deepEqual(a, b, 'deterministic');
    assert.deepEqual(a.template.batches.slice(0, EDEN.batches.length), EDEN.batches, 'the authored batches are the same objects, unchanged');
    const extra = a.template.batches.slice(EDEN.batches.length), added = extra.flatMap((x) => x.ops), half = EDEN.constants.extent / 2;
    assert.ok(extra.every((x) => x.ops.length <= 256 && x.group === 'slopes'), 'god batches hold at most 256 ops');
    assert.ok(added.every((o) => COPY_DEFS.includes(o.def) && !('in' in o) && !('tmp' in o) && o.name.startsWith('slopes-far-')));
    assert.equal(new Set(added.map((o) => o.name)).size, added.length);
    assert.ok(added.every((o) => Math.abs(o.p[0]) < half && Math.abs(o.p[1]) < half), 'inside the world');
    const authored = places(EDEN).filter((o) => Array.isArray(o.p));
    let nearest = Infinity;
    for (const o of added.filter((_, i) => i % 97 === 0)) for (const x of authored) nearest = Math.min(nearest, Math.hypot(o.p[0] - x.p[0], o.p[1] - x.p[1]));
    assert.ok(nearest >= CLEARANCE_M, `the nearest authored object is ${nearest.toFixed(0)} m away`);
  }
  assert.equal(withDistantInventory(EDEN, own).template, EDEN, 'the template as authored when nothing is added');
  assert.throws(() => withDistantInventory(EDEN, own - 1), /below the template/);
  assert.deepEqual(emptySquare(EDEN), emptySquare(EDEN));
});

test('axes: orthogonal, the reading stated on #741', () => {
  assert.deepEqual(AXES.inventory.map((a) => [a.placed, a.registered, a.active, a.quiet]), [[5000, 5, 5, 0], [10000, 5, 5, 0]]);
  assert.deepEqual(AXES.activity.map((a) => [a.placed, a.registered, a.active]), [[null, 10, 0], [null, 10, 5], [null, 10, 10]]);
  assert.deepEqual(AXES.quiet.map((a) => [a.active, a.quiet]), [[5, 0], [5, 9]]);
});

test('reductions: probe CPU per call nets out the quiet rate; the active window keeps every call; unknown stays null', () => {
  assert.equal(cores({ t: 0, cpuS: 1 }, { t: 2000, cpuS: 2 }), 0.5);
  assert.equal(cores({ t: 0, cpuS: null }, { t: 2000, cpuS: 2 }), null);
  const calls = Array.from({ length: 10 }, (_, i) => ({ ms: 100 + i, bytes: 1000, status: 200 }));
  // 2 CPU s over 4 s at a quiet 0.25 cores: 1 s of it is the tick, 1 s / 10 calls = 100 ms per call
  assert.deepEqual(probeRoute(calls, { cpuS: 2, spanMs: 4000, quietCores: 0.25 }), { n: 10, ok: 10, cpuMsPerCall: 100, p50Ms: 104, p95Ms: 109, bytesMean: 1000 });
  assert.equal(probeRoute(calls, { cpuS: null, spanMs: 4000, quietCores: 0.25 }).cpuMsPerCall, null);
  assert.equal(probeRoute(calls, { cpuS: 0.5, spanMs: 4000, quietCores: 0.25 }).cpuMsPerCall, null);   // below the quiet rate: unknown, not negative
  assert.equal(probeRoute(calls, { cpuS: 2, spanMs: null, quietCores: 0.25 }).cpuMsPerCall, null);
  const act = activeWindow([{ route: 'here', ms: 50, lateMs: 0, bytes: 10, status: 200, outcome: 'ok' }, { route: 'act', ms: 70, lateMs: 30, bytes: 5, status: 503, outcome: 'load-refused' }],
    { cpuS: 1.5, spanMs: 10_000, quietCores: 0.1, offered: 3 });
  assert.equal(act.unissued, 1); assert.equal(act.served, 1); assert.equal(act.cpuMsPerServed, 500);
  assert.deepEqual(act.outcomes, { ok: 1, 'load-refused': 1 }); assert.equal(act.endToEnd.max, 100);
  const lw = liveWindow([{ tick: { p99Ms: 30 }, loop: { delayP99Ms: 200, elu: 0.5 }, heap: { usedMb: 500 }, queue: { depth: 2 }, souls: { awake: 4 }, level: 'green' }, { loop: { delayP99Ms: 900 }, level: 'amber' }]);
  assert.equal(lw.loopP99MsMax, 900); assert.equal(lw.tickP99MsMax, 30); assert.deepEqual(lw.levels, { green: 1, amber: 1 });
});

test('profile summary: self and inclusive time by function, idle excluded from shares, paths relative to the root', () => {
  const f = (id, functionName, url, children = []) => ({ id, callFrame: { functionName, url, lineNumber: 9 }, children });
  const p = { nodes: [f(1, '(root)', ''), f(2, 'handle', `file://${ROOT}apps/server/src/x.ts`, [3]), f(3, 'scan', `file://${ROOT}apps/server/src/y.ts`), f(4, '(idle)', '')], samples: [3, 3, 2, 4], timeDeltas: [1000, 1000, 1000, 5000] };
  p.nodes[0].children = [2, 4];
  const s = summarizeProfile(p, ROOT);
  assert.equal(s.sampledMs, 8); assert.equal(s.busyMs, 3);
  assert.deepEqual(s.self.map((x) => [x.fn, x.ms]), [['scan apps/server/src/y.ts:10', 2], ['handle apps/server/src/x.ts:10', 1]]);
  assert.equal(s.inclusive.find((x) => x.fn.startsWith('handle')).ms, 3);
  // watched paths: inclusive time by name and file whatever their rank; a path never sampled reads 0
  const w = summarizeProfile(p, ROOT, 1, [['scan', 'apps/server/src/y.ts'], ['scan', 'apps/server/src/x.ts'], ['handle', 'apps/server/src/x.ts']]);
  assert.equal(w.inclusive.length, 1);
  assert.deepEqual(w.watched.map((x) => [x.fn, x.ms, x.share]), [['scan apps/server/src/y.ts', 2, 0.667], ['scan apps/server/src/x.ts', 0, 0], ['handle apps/server/src/x.ts', 3, 1]]);
  assert.match(reportText({ host: {} }, [{ arm: AXES.quiet[0], rep: 1, profiles: { probe: w } }]), /\| 2 \| 0\.667 \| `scan apps\/server\/src\/y\.ts` \|/);
  // recursion and same-named nesting count once per sample
  const q = { nodes: [f(1, '(root)', '', [2]), f(2, 'goal', `file://${ROOT}apps/server/src/god/nav.ts`, [3]), { id: 3, callFrame: { functionName: 'goal', url: `file://${ROOT}apps/server/src/god/nav.ts`, lineNumber: 40 }, children: [4] }, f(4, 'goal', `file://${ROOT}apps/server/src/god/nav.ts`)], samples: [4, 2], timeDeltas: [3000, 1000] };
  const g = summarizeProfile(q, ROOT, 15, [['goal', 'apps/server/src/god/nav.ts']]);
  assert.equal(g.watched[0].ms, 4); assert.equal(g.inclusive.find((x) => x.fn === 'goal apps/server/src/god/nav.ts:10').ms, 4);
  assert.equal(summarizeProfile(null), null);
});

test('slopes: deltas across arms, each with its repeats; a missing arm gives no slope, never 0', () => {
  const res = (id, rep, here, act, cores) => ({ arm: Object.values(AXES).flat().find((a) => a.id === id), rep, probe: { here: { cpuMsPerCall: here } }, active: { cpuMsPerServed: act, servedPerS: 1, endToEnd: { p95: 300 } }, windows: { quiet: { cores: 0.1 }, active: { cores, rssMbMax: 900 } }, boot: { seconds: 10, dbMb: 5 }, quietWorlds: id === 'quiet10' ? { cores: 0.9 } : null });
  const s = slopes([res('inv5000', 1, 100, 150, 0.4), res('inv5000', 2, 110, 150, 0.4), res('inv10000', 1, 160, 200, 0.5), res('inv10000', 2, 170, 210, 0.5),
    res('act0', 1, 90, null, 0.1), res('act10', 1, 95, 120, 0.6), res('quiet1', 1, 90, 100, 0.4), res('quiet10', 1, 90, 110, 0.4)]);
  assert.deepEqual(s.inventory.probeCpuMsPerCall.here, { at5000: 105, at10000: 165, delta: 60, spread: [10, 10] });
  assert.equal(s.inventory.probeCpuMsPerCall.observe.delta, null);
  assert.equal(s.activity.coresPerActiveSoul, 0.05);
  assert.equal(s.quiet.coresPerQuietWorld, 0.1);
  assert.deepEqual(slopes([res('inv5000', 1, 100, 150, 0.4)]), {});
  assert.match(reportText({ indicative: true, host: { class: 'laptop', cores: 8 }, repeats: 1, windows: {}, coverage: ['x'] }, [res('inv5000', 1, 100, 150, 0.4)]), /INDICATIVE[\s\S]*\| inv5000 \| 1 \|/);
});

test('active plan (#951): seeded by the repeat, never the arm; arms of a repeat share phases, repeats differ', () => {
  const W = 180_000, seeds = [1, 2, 3].map(planSeed);
  assert.equal(SLOPES, 'cw7-slopes/2');
  assert.deepEqual(seeds, ['cw7-slopes/2|r1', 'cw7-slopes/2|r2', 'cw7-slopes/2|r3']);
  for (const id of ['quiet1', 'quiet10', 'act5']) assert.ok(!planSeed(1).includes(id));
  const five = activePlan(seeds[0], 5, W), ten = activePlan(seeds[0], 10, W);
  assert.deepEqual(activePlan(seeds[0], 5, W), five, 'pure');
  assert.deepEqual(ten.slice(0, 5), five, 'an arm with more Souls extends the plan of one with fewer');
  assert.deepEqual(activePlan(seeds[0], 0, W), []);
  assert.notDeepEqual(activePlan(seeds[1], 5, W), five, 'repeats sample different phases');
  for (const ops of five) {
    assert.ok(ops.every((o, i) => i === 0 || ops[i - 1].at <= o.at) && ops.every((o) => o.at >= 0 && o.at < W));
    assert.equal(ops.filter((o) => o.route !== 'act').length, 45, 'a read every 4 s'); assert.equal(ops.filter((o) => o.route === 'act').length, 9, 'an act every 20 s');
    assert.deepEqual(ops.filter((o) => o.route === 'act').map((o) => o.n), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  }
});

test('schedule facts (#951): read phases and the crowded-read share; the cw7-slopes/1 arm seeds reproduce the diagnosis', () => {
  // hand-made: Soul 0 reads at 0, Soul 1 at 100 (crowded), Soul 2 at 100 + CROWD_MS (not crowded), Soul 1's act at 5
  const plan = [[{ at: 0, route: 'observe' }], [{ at: 5, route: 'act', n: 0 }, { at: 100, route: 'here' }], [{ at: 100 + CROWD_MS, route: 'resolve' }]];
  assert.deepEqual(scheduleFacts(plan, 's'), { seed: 's', readPhasesMs: [0, 100, 400], crowdedReadFrac: 0.33 });
  assert.deepEqual(scheduleFacts([[{ at: 0, route: 'act', n: 0 }, { at: 10, route: 'here' }]], 's').crowdedReadFrac, 0, "a Soul's own call never crowds it");
  assert.equal(scheduleFacts([], 's').crowdedReadFrac, null, 'no reads (act0): unknown, not 0');
  // run 41972880510's seeds (the arm id): quiet10's five reads sat inside 784 ms of every period, quiet1's were spread
  const old = (id) => scheduleFacts(activePlan(`cw7-slopes/1|${id}`, 5, 180_000), id);
  assert.deepEqual([...old('quiet1').readPhasesMs].sort((a, b) => a - b), [776, 1108, 2825, 3410, 3569]);
  assert.deepEqual([...old('quiet10').readPhasesMs].sort((a, b) => a - b), [1312, 1448, 1765, 2023, 2096]);
  assert.equal(old('quiet1').crowdedReadFrac, 0.2); assert.equal(old('quiet10').crowdedReadFrac, 0.64);
});

test('report (#951): the crowded-read share is a column of the per-arm table', () => {
  const x = { arm: AXES.quiet[1], rep: 1, facts: { placed: 4498 }, schedule: { seed: 'cw7-slopes/2|r1', readPhasesMs: [1, 2, 3, 4, 5], crowdedReadFrac: 0.27 }, profiles: {} };
  const text = reportText({ indicative: true, host: {}, windows: {}, source: {} }, [x]), row = text.split('\n').find((l) => l.startsWith('| quiet10 |'));
  assert.match(text, /\| e2e p95 ms \| crowded reads \|/); assert.match(row, /\| 0\.27 \|/);
  assert.match(reportText({ indicative: true, host: {}, windows: {}, source: {} }, [{ ...x, schedule: undefined }]).split('\n').find((l) => l.startsWith('| quiet10 |')), /\| — \| \? \/ /);
});

test('#911 review: a failed run is listed in REPORT.md, enters no mean, and every section says how many runs it rests on', () => {
  const res = (id, rep, here) => ({ arm: Object.values(AXES).flat().find((a) => a.id === id), rep, probe: { here: { cpuMsPerCall: here } }, active: { cpuMsPerServed: 100, servedPerS: 1, endToEnd: { p95: 300 } }, windows: { quiet: { cores: 0.1 }, active: { cores: 0.4, rssMbMax: 900 } }, boot: { seconds: 10, dbMb: 5 } });
  const all = [res('inv5000', 1, 100), res('inv5000', 2, 110), res('inv10000', 1, 160), { arm: AXES.inventory[1], rep: 2, error: 'sw0 did not answer /healthz in 15 min | boot' }];
  const s = slopes(all);
  assert.deepEqual(s.inventory.n, { inv5000: 2, inv10000: 1 });
  assert.deepEqual(s.inventory.probeCpuMsPerCall.here, { at5000: 105, at10000: 160, delta: 55, spread: [10, null] }, 'the failed repeat is not a value');
  const text = reportText({ indicative: true, host: {}, windows: {}, source: {} }, all);
  assert.match(text, /## Failed runs: 1 of 4/);
  assert.match(text, /\| inv10000 \| 2 \| sw0 did not answer \/healthz in 15 min \\\| boot \|/, 'the error is printed, its pipe escaped');
  assert.equal(text.split('\n').filter((l) => /^\| inv10000 \| 2 \| 10000 \|/.test(l)).length, 0, 'not a row of the arm table');
  assert.doesNotMatch(reportText({ indicative: true, host: {}, windows: {}, source: {} }, all.slice(0, 3)), /Failed runs/);
  assert.deepEqual(slopes([...all.slice(0, 2), { arm: AXES.quiet[0], rep: 1, error: 'x' }, res('quiet10', 1, 90)]).quiet, undefined, 'a failed arm is a missing arm');
});

test('#911 review: only a quiet, full-length, two-repeat run on the qualifying executor qualifies', () => {
  const ok = { executor: true, quiet: true, short: false, repeats: 2 };
  assert.equal(qualifies(ok), true); assert.equal(qualifies({ ...ok, repeats: 3 }), true);
  for (const bad of [{ executor: false }, { quiet: false }, { short: true }, { repeats: 1 }, { repeats: undefined }]) assert.equal(qualifies({ ...ok, ...bad }), false, JSON.stringify(bad));
});

test('#911 CodeQL: a backslash before a pipe in a failed run error cannot unescape the pipe in the table', () => {
  const run = { arm: AXES.inventory[1], rep: 2, error: 'path C:\\tmp\\| tail' };
  const text = reportText({ indicative: true, host: {}, windows: {}, source: {} }, [run]);
  assert.ok(text.split('\n').includes('| inv10000 | 2 | path C:\\\\tmp\\\\\\| tail |'), 'backslashes doubled, then the pipe escaped');
});
