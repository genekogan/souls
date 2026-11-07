// metrics.mjs (lane L7): Prometheus text from launcher state + each world's live.json (LOAD-CONTRACT §4/§5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metricsText, readLive, serveMetrics } from './metrics.mjs';

const NOW = 1_800_000_000_000;
const LIVE = { v: 1, pid: 748574, at: NOW - 2_000, phase: 'serving', loop: { lastTurnAgeMs: 40, delayP99Ms: 180, elu: 0.62 },
  tick: { world: 53411, service5s: 0.92, p99Ms: 61 }, heap: { usedMb: 612, limitMb: 1536, gcPct10s: 6 }, level: 'amber',
  queue: { depth: 2, oldestMs: 310 }, souls: { awake: 3, waiting: 0, connected: 4 }, shed: { reads: 5, acts: 0 } };
const val = (text, sel) => { const line = text.split('\n').find((l) => l.startsWith(`${sel} `)); return line === undefined ? undefined : Number(line.slice(sel.length + 1)); };

test('each live.json field becomes its contract metric, labelled by world only', () => {
  const ce = { totals: () => ({ ws: 15, js: 4 }), rate10m: () => 14, newSinceRelease: () => 1 };
  const t = metricsText({ now: NOW, launcher: { build: 'we-abc', maxRunning: 24, memAvailableMb: 1000 }, clientErrors: ce,
    worlds: [{ slug: 'eden-2026', status: 'running', restarts: 2, lastBootMs: 8_500, refused: { 'client.rate': 7, 'world.busy': 2, 'Bad Class': 1 }, live: LIVE }, { slug: 'mars-2027', status: 'asleep', restarts: 0, live: null }] });
  assert.equal(val(t, 'sim_launcher_worlds_running'), 1);
  assert.equal(val(t, 'sim_launcher_worlds_total'), 2);
  assert.equal(val(t, 'sim_launcher_info{build="we-abc"}'), 1);
  assert.equal(val(t, 'sim_world_last_heartbeat_seconds{world="eden-2026"}'), (NOW - 2_000) / 1000);
  assert.equal(val(t, 'sim_world_live_age_seconds{world="eden-2026"}'), 2);
  assert.equal(val(t, 'sim_world_event_loop_delay_p99_seconds{world="eden-2026"}'), 0.18);
  assert.equal(val(t, 'sim_world_elu{world="eden-2026"}'), 0.62);
  assert.equal(val(t, 'sim_world_gc_fraction{world="eden-2026"}'), 0.06);
  assert.equal(val(t, 'sim_world_heap_used_bytes{world="eden-2026"}'), 612 * 1048576);
  assert.equal(val(t, 'sim_world_heap_limit_bytes{world="eden-2026"}'), 1536 * 1048576);
  assert.equal(val(t, 'sim_world_tick_p99_seconds{world="eden-2026"}'), 0.061);
  assert.equal(val(t, 'sim_world_active_souls{world="eden-2026"}'), 3);
  assert.equal(val(t, 'sim_world_active_souls_connected{world="eden-2026"}'), 4);
  assert.equal(val(t, 'sim_world_queue_oldest_seconds{world="eden-2026"}'), 0.31);
  assert.equal(val(t, 'sim_world_shed_total{world="eden-2026",class="reads"}'), 5);
  assert.equal(val(t, 'sim_world_level{world="eden-2026",level="amber"}'), 1);
  assert.equal(val(t, 'sim_world_level{world="eden-2026",level="green"}'), 0);
  assert.equal(val(t, 'sim_world_phase{world="eden-2026",phase="serving"}'), 1);
  assert.equal(val(t, 'sim_world_restarts_total{world="eden-2026",reason="exit"}'), 2);
  assert.equal(val(t, 'sim_world_last_boot_seconds{world="eden-2026"}'), 8.5);
  assert.equal(val(t, 'sim_world_refused_total{world="eden-2026",class="client.rate"}'), 7);
  assert.equal(val(t, 'sim_world_refused_total{world="eden-2026",class="world.busy"}'), 2);
  assert.ok(!t.includes('Bad Class'));
  assert.equal(val(t, 'sim_world_status{world="mars-2027",status="asleep"}'), 1);
  assert.equal(val(t, 'sim_client_errors_total{kind="ws"}'), 15);
  assert.equal(val(t, 'sim_client_errors_rate10m'), 14);
  // values a world did not report are absent, never a false 0
  assert.equal(val(t, 'sim_world_heap_used_bytes{world="mars-2027"}'), undefined);
  assert.equal(val(t, 'sim_world_gc_seconds_total{world="eden-2026"}'), undefined);
  // no PII: the pid is not exported, and only closed label names appear
  assert.ok(!t.includes('748574'));
  for (const l of t.split('\n').filter((x) => x && !x.startsWith('#'))) {
    const labels = [...(l.match(/\{(.*)\}/)?.[1] ?? '').matchAll(/(\w+)="/g)].map((m) => m[1]);
    for (const n of labels) assert.ok(['world', 'kind', 'class', 'reason', 'level', 'phase', 'status', 'build'].includes(n), `label ${n} in ${l}`);
  }
  // exposition format: one HELP and TYPE per family
  assert.equal(t.split('\n').filter((l) => l === '# TYPE sim_world_status gauge').length, 1);
});

test('restart reasons, odd slugs and unreadable live.json', () => {
  const t = metricsText({ now: NOW, worlds: [{ slug: 'eden-2026', status: 'held', restartsByReason: { wedged: 3, exit: 1 } }, { slug: 'Bad Slug"', status: 'running' }] });
  assert.equal(val(t, 'sim_world_restarts_total{world="eden-2026",reason="wedged"}'), 3);
  assert.equal(val(t, 'sim_world_restarts_total{world="eden-2026",reason="planned"}'), 0);
  assert.equal(val(t, 'sim_world_status{world="eden-2026",status="held"}'), 1);
  assert.ok(!t.includes('Bad Slug'));
  const dir = mkdtempSync(join(tmpdir(), 'metrics-'));
  assert.equal(readLive(dir), null);
  writeFileSync(join(dir, 'live.json'), '{"at": 1'); assert.equal(readLive(dir), null);
  writeFileSync(join(dir, 'live.json'), JSON.stringify(LIVE)); assert.equal(readLive(dir).tick.world, 53411);
  writeFileSync(join(dir, 'live.json'), 'x'.repeat(70_000)); assert.equal(readLive(dir), null);
});

test('a Unix-seconds gauge keeps millisecond resolution', () => {
  const monoMs = NOW + 123.456;
  const text = metricsText({ now: NOW, worlds: [{ slug: 'w', status: 'running', restarts: 0, live: { ...LIVE, loop: { ...LIVE.loop, elu: 0.123456789 }, clock: { adminRate: 1, rate: 1, pace: 1, monoMs, state: 'running' } } }] });
  assert.equal(val(text, 'sim_world_tick_sampled_seconds{world="w"}'), 1_800_000_000.12346);
});

test('serveMetrics answers text/plain 0.0.4 and 500 on a failure', () => {
  const res = { writeHead(s, h) { this.s = s; this.h = h; return this; }, end(b) { this.b = b; } };
  serveMetrics(res, { now: NOW, worlds: [] });
  assert.equal(res.s, 200); assert.match(res.h['content-type'], /version=0\.0\.4/); assert.match(res.b, /sim_launcher_worlds_running 0/);
  serveMetrics(res, { clientErrors: { totals() { throw new Error('boom'); } } });
  assert.equal(res.s, 500);
});
