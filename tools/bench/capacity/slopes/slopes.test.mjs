// CW7 (#741): the slopes bench's pure parts: distant inventory, the reductions, profile summaries and the slopes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY_DEFS, CLEARANCE_M, emptySquare, withDistantInventory } from './inventory.mjs';
import { AXES, activeWindow, cores, liveWindow, probeRoute, reportText, slopes, summarizeProfile } from './report.mjs';

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
