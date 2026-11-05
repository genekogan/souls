// CW4 (#738): the operator report over a time range, from the store. Pure apart from reading the store.
// Values the source does not export are `unknown`, never 0. Schema: REPORT_SCHEMA (bump on incompatible change).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fineFiles, hourOf, rollups, tryReadHour, unreadable } from './store.mjs';
import { merge, reduceHour, reduceRows, view } from './reduce.mjs';
import { labelsOf } from './prom.mjs';

export const REPORT_SCHEMA = 'sim-telemetry-report/1';
const HOUR = 3_600_000, TICK_HZ = 20;

/** '1h' | '24h' | '7d' | '<iso>..<iso>' → [from, to) */
export function parseRange(r, now = Date.now()) {
  const m = /^(\d+)([hd])$/.exec(r ?? '24h'); if (m) return [now - Number(m[1]) * (m[2] === 'h' ? HOUR : 24 * HOUR), now];
  const [a, b] = String(r).split('..').map((x) => Date.parse(x)); if (Number.isFinite(a) && Number.isFinite(b) && b > a) return [a, b];
  throw new Error(`--range ${r}: 1h | 24h | 7d | <iso>..<iso>`);
}

/** The store reduced over [from, to): exact from fine samples up to 2 h, else hour-aligned from rollups (an hour without
 *  one is reduced from its fine file, e.g. the current hour). */
export function reduceRange(dir, types, from, to, everyMs) {
  if (to - from <= 2 * HOUR) { const hs = fineFiles(dir, from, to).map(tryReadHour).filter(Boolean); return { ...reduceRows(hs.flatMap((h) => h.rows), types, { from, to, everyMs }), restarts: hs.reduce((n, h) => n + h.restarts, 0) }; }
  const have = new Map(rollups(dir, hourOf(from), to).map((r) => [r.hour, r])); let acc = null;
  for (let h = hourOf(from); h < to; h += HOUR) {
    let r = have.get(h);
    if (!r) { const f = fineFiles(dir, h, h + HOUR); r = f.length ? reduceHour(h, { rows: f.map(tryReadHour).filter(Boolean).flatMap((x) => x.rows), restarts: 0 }, types, everyMs) : { hour: h, from: h, to: h + HOUR, everyMs, samples: 0, gaps: 0, expected: Math.round(HOUR / everyMs), skewMaxMs: 0, series: {} }; }
    acc = merge(acc, r);
  }
  return acc;
}

/** Per world and fleet numbers from one reduction. */
export function summarize(red) {
  const by = {}, fleet = {};
  for (const [key, s] of Object.entries(red.series)) {
    const { name, labels } = labelsOf(key);
    if (labels.world) (by[labels.world] ??= {})[key.replace(/,?world="[^"]*"/, '').replace('{}', '')] = { name, labels, s };
    else fleet[key] = { name, labels, s };
  }
  const pick = (m, name, lab) => Object.values(m).find((x) => x.name === name && Object.entries(lab ?? {}).every(([k, v]) => x.labels[k] === v))?.s ?? null;
  const sumInc = (m, name) => { const xs = Object.values(m).filter((x) => x.name === name); return xs.length ? Object.fromEntries(xs.map((x) => [Object.entries(x.labels).filter(([k]) => k !== 'world').map(([, v]) => v).join(',') || 'all', view(x.s).increase])) : null; };
  const worlds = {};
  for (const [w, m] of Object.entries(by)) {
    const status = Object.values(m).filter((x) => x.name === 'sim_world_status'), level = Object.values(m).filter((x) => x.name === 'sim_world_level');
    const tick = pick(m, 'sim_world_tick'), gc = pick(m, 'sim_world_gc_seconds_total'), live = pick(m, 'sim_world_live_age_seconds'), cover = status[0]?.s ?? live;
    worlds[w] = {
      coverage: { samples: cover?.n ?? 0, expected: red.expected },
      status: Object.fromEntries(status.map((x) => [x.labels.status, round(view(x.s).mean, 3)])),
      souls: { active: view(pick(m, 'sim_world_active_souls')), connected: view(pick(m, 'sim_world_active_souls_connected')) },
      // sampled tick progress over answered samples: an indication; the meetup bench's clock check is the oracle
      tick: tick ? { progress: tick.rise, coveredSeconds: view(tick).coveredSeconds, perSecond: round(view(tick).risePerSecond, 2), ratioAtFullClock: view(tick).risePerSecond == null ? null : round(view(tick).risePerSecond / TICK_HZ, 3), late: view(pick(m, 'sim_world_ticks_late_total'))?.increase ?? 'unknown' } : 'unknown',
      service: view(pick(m, 'sim_world_tick_service_ratio')), tickP99Seconds: view(pick(m, 'sim_world_tick_p99_seconds')), loopDelayP99Seconds: view(pick(m, 'sim_world_event_loop_delay_p99_seconds')),
      levels: Object.fromEntries(level.map((x) => [x.labels.level, round(view(x.s).mean, 3)])),
      queue: { depth: view(pick(m, 'sim_world_queue_depth')), oldestSeconds: view(pick(m, 'sim_world_queue_oldest_seconds')) },
      heapUsedBytes: view(pick(m, 'sim_world_heap_used_bytes')), elu: view(pick(m, 'sim_world_elu')) ?? 'unknown', gcShare: gc && view(gc).perSecond != null ? round(view(gc).perSecond, 4) : 'unknown',
      liveAgeSeconds: view(live), restarts: sumInc(m, 'sim_world_restarts_total') ?? {}, shed: sumInc(m, 'sim_world_shed_total') ?? {}, refused: sumInc(m, 'sim_world_refused_total') ?? {},
    };
  }
  return {
    fleet: { worldsRunning: view(pick(fleet, 'sim_launcher_worlds_running')), worldsKnown: view(pick(fleet, 'sim_launcher_worlds_total')), hostMemAvailableBytes: view(pick(fleet, 'sim_host_mem_available_bytes')),
      clientErrors: sumInc(fleet, 'sim_client_errors_total') ?? {}, soulsActive: sumGauge(Object.values(worlds), (x) => x.souls.active, red.expected), soulsConnected: sumGauge(Object.values(worlds), (x) => x.souls.connected, red.expected) },
    worlds,
  };
}
// fleet totals of per-world gauges over the whole range: each world's mean weighted by its share of the range (a world up
// for 10 % of it at 50 Souls adds 5, not 50); maxima of the sum are not known from per-world maxima
const sumGauge = (ws, f, expected) => { const v = ws.map(f).filter(Boolean); return v.length ? { meanTotal: round(v.reduce((n, x) => n + (x.mean ?? 0) * Math.min(1, (x.samples ?? 0) / Math.max(1, expected)), 0), 2), sumOfMaxima: v.reduce((n, x) => n + (x.max ?? 0), 0), note: 'meanTotal is over the whole range (uncovered time counts as no Souls known); sumOfMaxima bounds the concurrent peak from above' } : 'unknown'; };
const round = (v, d) => (v == null ? null : Number(v.toFixed(d)));

/** The full report: range, coverage, 1h/24h/7d comparisons, per world, store and loss counters. */
export function report(dir, state, { range = '24h', now = Date.now(), everyMs = 15_000 } = {}) {
  const [from, to] = parseRange(range, now), red = reduceRange(dir, state.types ?? {}, from, to, everyMs);
  const cmp = Object.fromEntries(['1h', '24h', '7d'].map((r) => { const [f, t] = parseRange(r, to), x = reduceRange(dir, state.types ?? {}, f, t, everyMs), s = summarize(x);
    return [r, { coverage: round(x.samples / Math.max(1, x.expected), 3), gaps: x.gaps, worldsRunningMean: s.fleet.worldsRunning?.mean ?? null, soulsActiveMeanTotal: s.fleet.soulsActive?.meanTotal ?? null,
      restarts: Object.values(s.worlds).reduce((n, w) => n + Object.values(w.restarts).reduce((a, b) => a + b, 0), 0), shed: Object.values(s.worlds).reduce((n, w) => n + Object.values(w.shed).reduce((a, b) => a + b, 0), 0) }]; }));
  return { schema: REPORT_SCHEMA, range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    coverage: { samples: red.samples, expected: red.expected, gaps: red.gaps, share: round(red.samples / Math.max(1, red.expected), 3), collectorRestarts: red.restarts ?? 0, clockSkewMaxMs: red.skewMaxMs },
    compare: cmp, ...summarize(red), store: storeFacts(dir), loss: { ...(state.loss ?? {}), unreadableFilesThisReport: unreadable.n },
    unknown: ['actions by outcome (attempted/started/completed/failed)', 'reads by outcome on the main thread', 'viewer and connection counts', 'world DB/WAL growth', 'process CPU and RSS'].map((x) => `${x}: not exported by /__sim/metrics yet (#737)`) };
}
function storeFacts(dir) {
  const per = {}; let bytes = 0;
  for (const sub of ['fine', 'rollup']) { if (!existsSync(join(dir, sub))) continue; for (const f of readdirSync(join(dir, sub))) { const b = statSync(join(dir, sub, f)).size; bytes += b; const d = f.slice(0, 10); per[d] = (per[d] ?? 0) + b; } }
  const days = Object.keys(per).sort();
  return { bytes, days: days.length, bytesPerDay: days.length ? Math.round(bytes / days.length) : 0, byDay: per };
}

/** A concise text rendering of report(). */
export function text(r) {
  const L = [`telemetry ${r.range.from} .. ${r.range.to}  (${r.schema})`,
    `coverage ${r.coverage.samples}/${r.coverage.expected} samples (${Math.round(100 * r.coverage.share)} %), ${r.coverage.gaps} gaps, ${r.coverage.collectorRestarts} collector restarts, clock skew max ${r.coverage.clockSkewMaxMs} ms`,
    `compare  ${Object.entries(r.compare).map(([k, v]) => `${k}: cover ${Math.round(100 * v.coverage)} %, worlds ${fmt(v.worldsRunningMean)}, Souls ${fmt(v.soulsActiveMeanTotal)}, restarts ${v.restarts}, shed ${v.shed}`).join(' | ')}`,
    `fleet    worlds running mean ${fmt(r.fleet.worldsRunning?.mean)} max ${fmt(r.fleet.worldsRunning?.max)}; Souls active mean total ${fmt(r.fleet.soulsActive?.meanTotal)}; host mem min ${r.fleet.hostMemAvailableBytes ? Math.round(r.fleet.hostMemAvailableBytes.min / 2 ** 20) + ' MB' : 'unknown'}`,
    '', 'world            cover  souls(mean/max)  tick ratio  service min  loop p99 max  queue max  elu mean  gc share  restarts  shed'];
  for (const [w, x] of Object.entries(r.worlds)) L.push([w.padEnd(16), `${Math.round(100 * x.coverage.samples / Math.max(1, x.coverage.expected))}%`.padStart(5), `${fmt(x.souls.active?.mean)}/${fmt(x.souls.active?.max)}`.padStart(16),
    String(x.tick?.ratioAtFullClock ?? '?').padStart(11), fmt(x.service?.min).padStart(12), fmt(x.loopDelayP99Seconds?.max).padStart(13), fmt(x.queue.depth?.max).padStart(10), fmt(x.elu?.mean).padStart(9), String(x.gcShare).padStart(9),
    String(Object.values(x.restarts).reduce((a, b) => a + b, 0)).padStart(9), String(Object.values(x.shed).reduce((a, b) => a + b, 0)).padStart(5)].join(' '));
  L.push('', `store ${Math.round(r.store.bytes / 2 ** 20)} MB over ${r.store.days} days (${Math.round(r.store.bytesPerDay / 2 ** 20)} MB/day); loss ${JSON.stringify(r.loss)}`, ...r.unknown.map((u) => `unknown: ${u}`));
  return L.join('\n') + '\n';
}
const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? String(Number(v.toFixed(3))) : String(v));
