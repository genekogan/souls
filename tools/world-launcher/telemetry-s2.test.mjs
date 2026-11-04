// CW4 S2 (#738): the report reads the CW3 S2 series (#859): request outcomes, merged latency histograms, process CPU and
// RSS, DB/WAL growth, viewers and the independent full-clock ratio; whatever a world did not export stays 'unknown'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { metricsText } from './metrics.mjs';
import { report, text, histQuantiles } from './telemetry/report.mjs';
import { openStore, scrapeOnce } from './telemetry.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const tmp = (t) => { mkdirSync(join(ROOT, '.local'), { recursive: true }); const d = mkdtempSync(join(ROOT, '.local', 'telemetry-s2-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0), EVERY = 15_000, N = 40;
const live = (tick) => ({ v: 1, pid: 1, at: 0, phase: 'serving', loop: { lastTurnAgeMs: 10, delayP99Ms: 20 }, tick: { world: tick, service5s: 1, p99Ms: 30, lateTotal: 0 },
  heap: { usedMb: 500, limitMb: 2048, gcPct10s: 1, gcSecondsTotal: 0 }, level: 'green', queue: { depth: 0, oldestMs: 0 }, souls: { awake: 2, waiting: 0, connected: 2 }, shed: { reads: 0, acts: 0 } });
const LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
// The #859 exposition for one world after `i` scrapes since its process started (counters restart with the process).
function s2(world, i, t, { pace = 1 } = {}) {
  const L = [], g = (n, v, l = '') => L.push(`${n}{world="${world}"${l}} ${v}`);
  g('sim_world_process_cpu_seconds_total', 0.5 * i, ',mode="user"'); g('sim_world_process_cpu_seconds_total', 0.25 * i, ',mode="system"');
  g('sim_world_process_resident_bytes', (300 + i) * 2 ** 20); g('sim_world_process_external_bytes', 5 * 2 ** 20);
  g('sim_world_clock_admin_rate', 1); g('sim_world_attention_pace', pace); g('sim_world_tick_sampled_seconds', (t - 100) / 1000);
  g('sim_world_souls_resident', 4); g('sim_world_entities', 1200); g('sim_world_viewers', 2);
  g('sim_world_awake_soul_seconds_total', 30 * i); g('sim_world_viewer_seconds_total', 30 * i);
  g('sim_world_ws_connections_total', i, ',event="opened"'); g('sim_world_ws_connections_total', i, ',event="closed"');
  // per scrape: reads 10 attempted, 9 completed, 1 soul.busy; acts 2 attempted/started, 1 completed, 1 rejected
  for (const [c, o, n] of [['read', 'attempted', 10], ['read', 'started', 9], ['read', 'completed', 9], ['read', 'rejected', 0], ['read', 'failed', 0], ['read', 'dropped', 0],
    ['act', 'attempted', 2], ['act', 'started', 2], ['act', 'completed', 1], ['act', 'rejected', 1], ['act', 'failed', 0], ['act', 'dropped', 0]]) g('sim_world_requests_total', n * i, `,class="${c}",outcome="${o}"`);
  g('sim_world_requests_refused_total', i, ',class="read",code="soul.busy"');
  // read queue: per scrape 8 samples under 5 ms and 1 at 2 s → p50 0.005, p95 2.5
  LE.forEach((le) => g('sim_world_request_queue_seconds_bucket', (le >= 0.005 ? 8 : 0) * i + (le >= 2.5 ? 1 : 0) * i, `,class="read",le="${le}"`));
  g('sim_world_request_queue_seconds_bucket', 9 * i, ',class="read",le="+Inf"'); g('sim_world_request_queue_seconds_sum', 2.04 * i, ',class="read"'); g('sim_world_request_queue_seconds_count', 9 * i, ',class="read"');
  const step = (t - T0) / EVERY;   // sizes are levels of the data directory: they do not restart with the process
  g('sim_world_db_bytes', 1_000_000 + 1000 * step); g('sim_world_wal_bytes', 4096); g('sim_world_disk_free_bytes', 5e10 - 1000 * step);
  return ['# TYPE sim_world_request_queue_seconds histogram', '# TYPE sim_world_requests_total counter', '# TYPE sim_world_process_cpu_seconds_total counter', ...L].join('\n') + '\n';
}
const fetchOf = (body) => async () => ({ ok: true, status: 200, text: async () => body });

test('histQuantiles: bucket upper bounds from merged counts, never averaged; >10 when only +Inf reaches it', () => {
  assert.deepEqual(histQuantiles([{ le: 0.005, n: 80 }, { le: 2.5, n: 90 }, { le: Infinity, n: 100 }]), { count: 100, p50: 0.005, p95: '>2.5', p99: '>2.5' });
  assert.deepEqual(histQuantiles([{ le: 0.005, n: 8 }, { le: 2.5, n: 9 }, { le: Infinity, n: 9 }]), { count: 9, p50: 0.005, p95: 2.5, p99: 2.5, p99Supported: false });
  assert.deepEqual(histQuantiles([{ le: Infinity, n: 0 }]), { count: 0 });
});

test('report: S2 series per world and for the fleet, across a world restart; absent series stay unknown', async (t) => {
  const dir = tmp(t), s = openStore(dir, { everyMs: EVERY });
  for (let k = 0; k < N; k++) {
    const at = T0 + k * EVERY, i = k < 20 ? k + 1 : k - 19;   // the world restarts after scrape 20: its counters start again
    const base = metricsText({ now: at, launcher: { build: 'test', maxRunning: 10 }, worlds: [{ slug: 'a', status: 'running', live: live(300 * (k + 1)) }, { slug: 'old', status: 'running', live: live(300 * (k + 1)) }, { slug: 'slow', status: 'running', live: live(75 * (k + 1)) }] });
    assert.equal(await scrapeOnce(s, 'u', { now: () => at, fetchImpl: fetchOf(base + s2('a', i, at) + s2('slow', k + 1, at, { pace: 0.25 }).replace(/^# TYPE.*\n/gm, '')) }), true);
  }
  const r = report(dir, s.state, { range: `${new Date(T0).toISOString()}..${new Date(T0 + N * EVERY).toISOString()}`, now: T0 + N * EVERY, everyMs: EVERY }), a = r.worlds.a;
  // 39 increases: 19 + 1 (the restart: the new value counts from 0) + 19 = 39 scrapes' worth
  assert.deepEqual(a.requests.read, { attempted: 390, started: 351, completed: 351, rejected: 0, failed: 0, dropped: 0, refused: { 'soul.busy': 39 } });
  assert.deepEqual(a.requests.act, { attempted: 78, started: 78, completed: 39, rejected: 39, failed: 0, dropped: 0, refused: {} });
  assert.equal(a.requests.read.attempted, a.requests.read.started + a.requests.read.refused['soul.busy'], 'attempted = refused + dropped + started (nothing in flight)');
  assert.deepEqual(a.latency.read.queue, { count: 351, p50: 0.005, p95: 2.5, p99: 2.5 });
  assert.equal(a.process.cpuCores, 0.05, '0.75 CPU-s per 15 s (user + system), restart steps included');
  assert.equal(a.process.rssBytes.max, 320 * 2 ** 20); assert.match(a.process.note, /never added/);
  assert.equal(a.viewers.meanConcurrent, 2, 'viewer-seconds increase / covered seconds');
  assert.deepEqual(a.viewers.connections, { opened: 39, closed: 39 });
  assert.equal(a.disk.dbBytes.perDay, 5_760_000, '1000 B per 15 s, per day of the sampled span');
  assert.equal(a.disk.walBytes.perDay, 0); assert.equal(a.disk.freeBytesMin, 5e10 - 1000 * (N - 1));
  assert.equal(a.clock.fullClockRatio, 1, 'tick rise over its own sample-time rise × 20 × rate');
  assert.equal(r.worlds.slow.clock.fullClockRatio, 0.25, 'an attention-paced world is seen at a quarter of its full clock');
  assert.equal(r.worlds.slow.clock.pace.last, 0.25);
  for (const k of ['requests', 'latency', 'process', 'disk', 'viewers', 'clock']) assert.equal(r.worlds.old[k], 'unknown', `old: ${k} unknown, never 0`);
  assert.deepEqual(r.fleet.requests.act, { attempted: 78 + 78, started: 78 + 78, completed: 39 + 39, rejected: 39 + 39, failed: 0, dropped: 0 });
  assert.equal(r.fleet.cpuCores.sum, 0.1); assert.equal(r.fleet.cpuCores.worlds, 2);
  assert.deepEqual(r.unknown, [], 'every S2 block was exported by some world');
  const txt = text(r);
  assert.match(txt, /\n {2}a: ok\/rejected\/failed\/refused read 351\/0\/0\/39, act 39\/39\/0\/0; p95 s queue 2\.5\/—/);
  assert.doesNotMatch(txt, /\n {2}old:/, 'no S2 line for a world without the series');
});

test('report: a store from before #859 says unknown for each S2 block, as S1 did', async (t) => {
  const dir = tmp(t), s = openStore(dir, { everyMs: EVERY });
  for (let k = 0; k < 4; k++) await scrapeOnce(s, 'u', { now: () => T0 + k * EVERY, fetchImpl: fetchOf(metricsText({ now: T0 + k * EVERY, worlds: [{ slug: 'a', status: 'running', live: live(300 * k) }] })) });
  const r = report(dir, s.state, { range: `${new Date(T0).toISOString()}..${new Date(T0 + 4 * EVERY).toISOString()}`, now: T0 + 4 * EVERY, everyMs: EVERY });
  assert.equal(r.unknown.length, 6); assert.ok(r.unknown.every((u) => /not exported by any world in this range/.test(u)));
  assert.equal(r.worlds.a.requests, 'unknown'); assert.equal(r.fleet.requests, 'unknown'); assert.equal(r.fleet.cpuCores, 'unknown');
  assert.ok(r.worlds.a.tick.progress > 0, 'S1 fields as before');
});
