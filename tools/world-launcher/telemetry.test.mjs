// CW4 (#738): bounded telemetry history and the operator report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { metricsText } from './metrics.mjs';
import { parsePrometheus, keyOf, labelsOf, kindOf } from './telemetry/prom.mjs';
import { readHour } from './telemetry/store.mjs';
import { reduceRows, merge, view } from './telemetry/reduce.mjs';
import { report, text, parseRange, REPORT_SCHEMA } from './telemetry/report.mjs';
import { openStore, scrapeOnce } from './telemetry.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const tmp = (t) => { mkdirSync(join(ROOT, '.local'), { recursive: true }); const d = mkdtempSync(join(ROOT, '.local', 'telemetry-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const H = 3_600_000, T0 = Date.UTC(2026, 10, 1, 0, 0, 0);
const live = (o = {}) => ({ v: 1, pid: 1, at: o.at ?? T0, phase: 'serving', loop: { lastTurnAgeMs: 10, delayP99Ms: o.loop ?? 20, elu: o.elu ?? 0.3 },
  tick: { world: o.tick ?? 0, service5s: o.service ?? 1, p99Ms: o.p99 ?? 30, lateTotal: o.late ?? 0 }, heap: { usedMb: 500, limitMb: 2048, gcPct10s: 1, gcSecondsTotal: o.gc ?? 0 },
  level: o.level ?? 'green', queue: { depth: o.queue ?? 0, oldestMs: 0 }, souls: { awake: o.souls ?? 3, waiting: 0, connected: o.souls ?? 3 }, shed: { reads: o.shed ?? 0, acts: 0 } });
const scrape = (t, worlds) => metricsText({ now: t, launcher: { build: 'test', maxRunning: 10 }, worlds });
const fetchOf = (body, status = 200) => async () => ({ ok: status === 200, status, text: async () => body });

test('prom: what metrics.mjs writes parses back; keys are canonical; kinds follow the type', () => {
  const p = parsePrometheus(scrape(T0, [{ slug: 'a', status: 'running', restarts: 1, live: live({ tick: 100 }) }]));
  assert.equal(p.skipped, 0);
  const tick = p.samples.find((x) => x.name === 'sim_world_tick'); assert.equal(tick.value, 100); assert.equal(tick.key, 'sim_world_tick{world="a"}');
  assert.deepEqual(labelsOf(keyOf('x', { b: '2', a: 'q"1' })), { name: 'x', labels: { a: 'q"1', b: '2' } });
  assert.equal(kindOf('sim_world_restarts_total', {}, p.types), 'counter');
  assert.equal(kindOf('sim_world_tick_p99_seconds', {}, p.types), 'quantile', 'a p99 gauge is never averaged');
  assert.equal(kindOf('sim_world_queue_depth', {}, p.types), 'gauge');
  assert.equal(kindOf('sim_world_listen_held_seconds_count', {}, { sim_world_listen_held_seconds: 'summary' }), 'counter');
});

test('metrics.mjs keeps Unix times exact enough to measure skew and heartbeat age', () => {
  const t = 1_793_800_123_456, p = parsePrometheus(scrape(t, [{ slug: 'a', status: 'running', live: live({ at: t - 2_000 }) }]));
  assert.equal(p.samples.find((x) => x.name === 'sim_metrics_scrape_timestamp_seconds').value, t / 1000);
  assert.equal(p.samples.find((x) => x.name === 'sim_world_last_heartbeat_seconds').value, (t - 2_000) / 1000);
});

test('reduce: counter resets, quantiles by max, gauges over answered samples only; gaps are not zeros', () => {
  const types = { c_total: 'counter', g: 'gauge' }, row = (t, c, g, q) => ({ t, ok: true, values: new Map([['c_total', c], ['g', g], ['lat_p99_seconds', q]]) });
  const rows = [row(0, 10, 2, 0.1), row(15, 15, 4, 0.9), { t: 30, ok: false }, row(45, 3, 6, 0.2), row(60, 8, 8, 0.3)];   // restart between 30 and 45
  const r = reduceRows(rows, types, { from: 0, to: 75, everyMs: 15 });
  const c = view(r.series.c_total); assert.deepEqual({ increase: c.increase, resets: c.resets, last: c.last, samples: c.samples }, { increase: 5 + 3 + 5, resets: 1, last: 8, samples: 4 });
  // rates use covered time only: 0→15 is covered (5 in 15 ms); the gap breaks 15→45; 45→60 is covered (5 in 15 ms)
  assert.equal(c.coveredSeconds, 0.03); assert.equal(c.perSecond, 10 / 0.03);
  assert.equal(view(r.series.g).mean, 5, 'mean of answered samples (2,4,6,8), the gap is not a 0');
  assert.equal(view(r.series.lat_p99_seconds).max, 0.9); assert.equal(view(r.series.lat_p99_seconds).mean, undefined);
  assert.deepEqual({ samples: r.samples, gaps: r.gaps, expected: r.expected }, { samples: 4, gaps: 1, expected: 5 });
  // merging two halves gives the same counter increase, including the step across the boundary
  const a = reduceRows(rows, types, { from: 0, to: 40, everyMs: 15 }), b = reduceRows(rows, types, { from: 40, to: 75, everyMs: 15 }), m = merge(a, b);
  assert.equal(view(m.series.c_total).increase, 13); assert.equal(view(m.series.c_total).resets, 1); assert.equal(view(m.series.lat_p99_seconds).max, 0.9);
});

test('collect: gaps for an unreachable or failing launcher; skew recorded; a full store never throws', async (t) => {
  const dir = tmp(t), s = openStore(dir, { everyMs: 15_000 });
  assert.equal(await scrapeOnce(s, 'http://127.0.0.1:9/__sim/metrics', { now: () => T0, fetchImpl: async () => { throw Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }); } }), false);
  assert.equal(await scrapeOnce(s, 'u', { now: () => T0 + 15_000, fetchImpl: fetchOf('', 503) }), false);
  assert.equal(await scrapeOnce(s, 'u', { now: () => T0 + 30_000, fetchImpl: fetchOf(scrape(T0 + 29_000, [{ slug: 'a', status: 'running', live: live() }])) }), true);
  const h = readHour(join(dir, 'fine', `${new Date(T0).toISOString().slice(0, 13)}.jsonl`));
  assert.deepEqual(h.rows.map((r) => r.ok), [false, false, true]);
  assert.match(h.rows[0].error, /ECONNREFUSED/); assert.equal(h.rows[2].skewMs, 1000);
  // an unwritable store: the write fails, is counted, and the collector carries on
  chmodSync(join(dir, 'fine'), 0o500);
  try {
    const s2 = openStore(dir, { everyMs: 15_000 }); const before = s2.state.loss.failedWrites;
    await scrapeOnce(s2, 'u', { now: () => T0 + 2 * H, fetchImpl: fetchOf(scrape(T0 + 2 * H, [])) });
    assert.ok(s2.state.loss.failedWrites > before);
  } finally { chmodSync(join(dir, 'fine'), 0o700); }
});

test('store: sparse rows rebuild exactly; a series that vanishes is absent, not 0; a collector restart is a boundary', async (t) => {
  const dir = tmp(t); let s = openStore(dir, { everyMs: 15_000 });
  const w = (tick, extra = []) => [{ slug: 'a', status: 'running', live: live({ tick }) }, ...extra];
  await scrapeOnce(s, 'u', { now: () => T0, fetchImpl: fetchOf(scrape(T0, w(0, [{ slug: 'b', status: 'running', live: live({ tick: 5 }) }]))) });
  await scrapeOnce(s, 'u', { now: () => T0 + 15_000, fetchImpl: fetchOf(scrape(T0 + 15_000, w(300))) });   // world b went away
  s = openStore(dir, { everyMs: 15_000 });   // collector restarts within the hour
  await scrapeOnce(s, 'u', { now: () => T0 + 45_000, fetchImpl: fetchOf(scrape(T0 + 45_000, w(900))) });
  const h = readHour(join(dir, 'fine', `${new Date(T0).toISOString().slice(0, 13)}.jsonl`));
  assert.equal(h.rows[0].values.get('sim_world_tick{world="b"}'), 5);
  assert.equal(h.rows[1].values.has('sim_world_tick{world="b"}'), false);
  assert.equal(h.rows[2].values.get('sim_world_tick{world="a"}'), 900); assert.equal(h.restarts, 1);
});

test('a failed write between good scrapes never mis-indexes a series; a long gap does not inflate a rate', async (t) => {
  const dir = tmp(t), s = openStore(dir, { everyMs: 15_000 }), sc = (tt, worlds) => scrapeOnce(s, 'u', { now: () => tt, fetchImpl: fetchOf(scrape(tt, worlds)) });
  const a = (tick) => ({ slug: 'a', status: 'running', live: live({ tick }) }), b = (tick) => ({ slug: 'b', status: 'running', live: live({ tick }) });
  await sc(T0, [a(0)]);
  const file = join(dir, 'fine', `${new Date(T0).toISOString().slice(0, 13)}.jsonl`);
  chmodSync(file, 0o400); try { assert.equal(await sc(T0 + 15_000, [a(300), b(7)]), false); } finally { chmodSync(file, 0o600); }
  await sc(T0 + 30_000, [a(600), b(8)]);
  await sc(T0 + 30 * 60_000, [a(36_000), b(9)]);   // 29.5 min without a scrape, the clock at full rate meanwhile
  await sc(T0 + 30 * 60_000 + 15_000, [a(36_300), b(10)]);
  const h = readHour(file);
  assert.equal(h.rows.at(-1).values.get('sim_world_tick{world="b"}'), 10); assert.equal(h.rows.at(-1).values.get('sim_world_tick{world="a"}'), 36_300);
  const r = report(dir, s.state, { range: `${new Date(T0).toISOString()}..${new Date(T0 + H).toISOString()}`, everyMs: 15_000 });
  assert.ok(Math.abs(r.worlds.a.tick.ratioAtFullClock - 1) < 0.01, `ratio ${r.worlds.a.tick.ratioAtFullClock}: the gap adds neither time nor ticks to the rate`);
  assert.equal(r.worlds.a.tick.progress, 36_300, 'the total progress keeps every step');
  // 5 answered samples of 240 expected in the hour: two worlds with 3 Souls each average far below 6 over the hour
  assert.ok(r.fleet.soulsActive.meanTotal < 0.2, `fleet mean ${r.fleet.soulsActive.meanTotal} is weighted by coverage`);
});

test('retention: 7 days fine, 90 days hourly rollups, a hard size cap; pruning is counted and touches telemetry only', async (t) => {
  const dir = tmp(t), s = openStore(dir, { everyMs: 600_000 });
  mkdirSync(join(dir, 'gameplay'), { recursive: true });   // a neighbour the store must never touch
  // synthetic: one scrape every 10 min for 100 days, two worlds; hour rolls close, roll up and gzip
  for (let t2 = T0, k = 0; t2 < T0 + 100 * 24 * H; t2 += 600_000, k++) await scrapeOnce(s, 'u', { now: () => t2, fetchImpl: fetchOf(scrape(t2, [{ slug: 'a', status: 'running', live: live({ tick: k * 12_000 }) }, { slug: 'old', status: k < 500 ? 'running' : 'asleep', live: k < 500 ? live() : null }])) });
  s.close(T0 + 100 * 24 * H);
  const fine = readdirSync(join(dir, 'fine')), roll = readdirSync(join(dir, 'rollup'));
  assert.ok(fine.every((f) => Date.parse(`${f.slice(0, 13)}:00:00Z`) >= T0 + 93 * 24 * H - H), 'no fine hour older than 7 days');
  assert.ok(roll.length <= 91 && roll.every((f) => Date.parse(f.slice(0, 10)) >= T0 + 9 * 24 * H), 'no rollup older than 90 days');
  assert.ok(s.state.loss.prunedByAge > 0); assert.equal(s.state.loss.prunedBySize, 0);
  // the hard cap: oldest fine data goes first, then the oldest rollups; every removal is counted
  const capped = openStore(dir, { everyMs: 600_000, maxBytes: 32 * 1024 }); capped.prune(T0 + 100 * 24 * H);
  assert.ok(capped.bytes <= 32 * 1024, `store ${capped.bytes} B within the cap`); assert.ok(capped.state.loss.prunedBySize > 0);
  const left = readdirSync(join(dir, 'rollup')).sort(); assert.ok(left.length && left.at(-1) === roll.sort().at(-1), 'the newest rollup survives longest');
  assert.ok(existsSync(join(dir, 'gameplay')));
  assert.ok(fine.filter((f) => f.endsWith('.gz')).length >= fine.length - 1, 'closed hours are gzipped');
});

test('report: the meetup-bench fixture through metrics.mjs → store → report; schema, coverage, comparisons, tick ratio', async (t) => {
  const fx = JSON.parse(readFileSync(new URL('./telemetry/fixtures/meetup-even-smoke.json', import.meta.url), 'utf8'));
  const dir = tmp(t), s = openStore(dir, { everyMs: 15_000 }), slugs = [...new Set(fx.rows.map((r) => r.w))];
  const at = (sec) => T0 + 10 * H + sec * 1000;
  for (const sec of [...new Set(fx.rows.map((r) => r.s))]) {
    const worlds = slugs.map((w) => { const r = fx.rows.find((x) => x.w === w && x.s === sec); return r ? { slug: w, status: 'running', live: live({ at: at(sec), tick: r.tick, level: r.level, queue: r.queue, loop: r.loopP99Ms, p99: r.tickP99Ms }) } : { slug: w, status: 'running', live: null }; });
    await scrapeOnce(s, 'u', { now: () => at(sec), fetchImpl: fetchOf(scrape(at(sec), worlds)) });
  }
  const last = Math.max(...fx.rows.map((r) => r.s)), r = report(dir, s.state, { range: `${new Date(at(0)).toISOString()}..${new Date(at(last) + 1).toISOString()}`, everyMs: 15_000 });
  assert.equal(r.schema, REPORT_SCHEMA); assert.deepEqual(Object.keys(r.compare), ['1h', '24h', '7d']);
  assert.equal(Object.keys(r.worlds).length, 10);
  for (const w of slugs) {
    const rows = fx.rows.filter((x) => x.w === w), expect = (rows.at(-1).tick - rows[0].tick) / ((rows.at(-1).s - rows[0].s) * 20);
    assert.ok(Math.abs(r.worlds[w].tick.ratioAtFullClock - expect) < 0.08, `${w}: ${r.worlds[w].tick.ratioAtFullClock} vs ${expect}`);
    const share = Object.values(r.worlds[w].levels).reduce((a, b) => a + b, 0); assert.ok(Math.abs(share - 1) < 0.005, `${w} level shares sum to ${share}`);
  }
  assert.ok(r.unknown.length > 0, 'what the source does not export is listed as unknown');
  assert.match(text(r), /coverage .* samples/);
  assert.throws(() => parseRange('3w'), /--range/);
});

test('400 registered worlds (20 running): one scrape stays bounded in time, store bytes and collector memory', async (t) => {
  const dir = tmp(t), s = openStore(dir, { everyMs: 15_000 });
  const worlds = Array.from({ length: 400 }, (_, i) => ({ slug: `w${i}`, status: i < 20 ? 'running' : 'asleep', restarts: i % 3, refused: { 'world.busy': i }, live: i < 20 ? live({ tick: i }) : null }));
  const rss0 = process.memoryUsage().rss, t0 = performance.now();
  for (let k = 0; k < 40; k++) { const tt = T0 + k * 15_000; worlds.forEach((w, i) => { if (w.live) w.live.tick += 300; }); await scrapeOnce(s, 'u', { now: () => tt, fetchImpl: fetchOf(scrape(tt, worlds)) }); }
  const ms = (performance.now() - t0) / 40, grow = (process.memoryUsage().rss - rss0) / 2 ** 20, bytes = readdirSync(join(dir, 'fine')).reduce((n, f) => n + readFileSync(join(dir, 'fine', f)).length, 0) / 40;
  assert.ok(ms < 250, `${ms.toFixed(1)} ms per scrape`); assert.ok(grow < 64, `RSS grew ${grow.toFixed(1)} MB`);
  // sparse rows: after the first, a scrape stores only what changed (ticks, heartbeats), not every series
  assert.ok(bytes < 20_000, `${Math.round(bytes)} B per scrape on average`);
  t.diagnostic(`400 worlds: ${ms.toFixed(1)} ms/scrape, ${Math.round(bytes)} B/scrape uncompressed, RSS +${grow.toFixed(1)} MB`);
});
