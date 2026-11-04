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
      ...s2(m, pick),
    };
  }
  return {
    fleet: { worldsRunning: view(pick(fleet, 'sim_launcher_worlds_running')), worldsKnown: view(pick(fleet, 'sim_launcher_worlds_total')), hostMemAvailableBytes: view(pick(fleet, 'sim_host_mem_available_bytes')),
      clientErrors: sumInc(fleet, 'sim_client_errors_total') ?? {}, soulsActive: sumGauge(Object.values(worlds), (x) => x.souls.active, red.expected), soulsConnected: sumGauge(Object.values(worlds), (x) => x.souls.connected, red.expected),
      ...fleetS2(Object.values(worlds)) },
    worlds,
  };
}
// fleet totals of per-world gauges over the whole range: each world's mean weighted by its share of the range (a world up
// for 10 % of it at 50 Souls adds 5, not 50); maxima of the sum are not known from per-world maxima
const sumGauge = (ws, f, expected) => { const v = ws.map(f).filter(Boolean); return v.length ? { meanTotal: round(v.reduce((n, x) => n + (x.mean ?? 0) * Math.min(1, (x.samples ?? 0) / Math.max(1, expected)), 0), 2), sumOfMaxima: v.reduce((n, x) => n + (x.max ?? 0), 0), note: 'meanTotal is over the whole range (uncovered time counts as no Souls known); sumOfMaxima bounds the concurrent peak from above' } : 'unknown'; };
const round = (v, d) => (v == null ? null : Number(v.toFixed(d)));

// ---------- CW4 S2 (#738): the CW3 S2 series (#859). Each block is 'unknown' when the world did not export it.
const REQ_CLASSES = ['read', 'act'], REQ_OUTCOMES = ['attempted', 'started', 'completed', 'rejected', 'failed', 'dropped'];
const S2_UNKNOWN = { requests: 'actions and reads by outcome (attempted/started/completed/rejected/failed/dropped, refusals by code)', latency: 'request queue and run latency histograms',
  process: 'process CPU and RSS', disk: 'world DB/WAL growth and free disk', viewers: 'viewer and connection counts and viewer time', clock: 'independent full-clock ratio (tick vs its own sample time)' };
/** Quantiles of a histogram from its bucket increases: the upper bound of the first bucket whose cumulative count reaches
 *  q × count (a bucket bound, not an interpolation); '>last' when only +Inf reaches it. Never from averaged quantiles. */
export function histQuantiles(buckets) {
  const fin = buckets.filter((b) => b.le !== Infinity).sort((a, b) => a.le - b.le), inf = buckets.find((b) => b.le === Infinity);
  const count = inf?.n ?? fin.at(-1)?.n ?? 0; if (!count) return { count: 0 };
  const q = (p) => { const need = p * count; for (const b of fin) if (b.n >= need) return b.le; return `>${fin.at(-1)?.le ?? 0}`; };
  return { count, p50: q(0.5), p95: q(0.95), p99: q(0.99), ...(count < 100 ? { p99Supported: false } : {}) };
}
function s2(m, pick) {
  const all = Object.values(m), named = (n) => all.filter((x) => x.name === n), inc = (x) => view(x.s).increase;
  const out = {};
  const req = named('sim_world_requests_total'), ref = named('sim_world_requests_refused_total');
  out.requests = req.length ? Object.fromEntries(REQ_CLASSES.map((c) => [c, { ...Object.fromEntries(REQ_OUTCOMES.map((o) => [o, req.find((x) => x.labels.class === c && x.labels.outcome === o) ? inc(req.find((x) => x.labels.class === c && x.labels.outcome === o)) : 'unknown'])),
    refused: Object.fromEntries(ref.filter((x) => x.labels.class === c).map((x) => [x.labels.code, inc(x)])) }])) : 'unknown';
  const lat = {};
  for (const kind of ['queue', 'run']) for (const x of named(`sim_world_request_${kind}_seconds_bucket`)) (((lat[x.labels.class] ??= {})[kind] ??= []).push({ le: x.labels.le === '+Inf' ? Infinity : Number(x.labels.le), n: inc(x) }));
  out.latency = Object.keys(lat).length ? Object.fromEntries(Object.entries(lat).map(([c, k]) => [c, Object.fromEntries(Object.entries(k).map(([kind, b]) => [kind, histQuantiles(b)]))])) : 'unknown';
  const cpu = named('sim_world_process_cpu_seconds_total').map((x) => view(x.s)), rss = pick(m, 'sim_world_process_resident_bytes');
  out.process = cpu.length || rss ? { cpuCores: cpu.length && cpu.every((v) => v.perSecond != null) ? round(cpu.reduce((n, v) => n + v.perSecond, 0), 3) : 'unknown', rssBytes: view(rss) ?? 'unknown',
    mainThreadExternalBytes: view(pick(m, 'sim_world_process_external_bytes')) ?? 'unknown', note: 'RSS is the whole process; external memory is the main thread only and is never added to RSS' } : 'unknown';
  // growth from the first to the last answered sample, per day of that span (gaps included: a size is a level, not a rate)
  const growth = (s) => { if (!s) return 'unknown'; const span = ((s.lastT ?? 0) - (s.firstT ?? 0)) / 1000; return { first: s.first, last: s.last, max: s.max, perDay: span > 0 ? round(((s.last - s.first) / span) * 86_400, 0) : null }; };
  const db = pick(m, 'sim_world_db_bytes'), wal = pick(m, 'sim_world_wal_bytes'), free = pick(m, 'sim_world_disk_free_bytes');
  out.disk = db || wal || free ? { dbBytes: growth(db), walBytes: growth(wal), freeBytesMin: view(free)?.min ?? 'unknown' } : 'unknown';
  const vs = pick(m, 'sim_world_viewer_seconds_total'), viewers = pick(m, 'sim_world_viewers'), ws = named('sim_world_ws_connections_total');
  out.viewers = vs || viewers || ws.length ? { now: view(viewers) ?? 'unknown', meanConcurrent: vs && view(vs).perSecond != null ? round(view(vs).perSecond, 3) : 'unknown',
    viewerSeconds: vs ? view(vs).increase : 'unknown', awakeSoulSeconds: view(pick(m, 'sim_world_awake_soul_seconds_total'))?.increase ?? 'unknown',
    connections: Object.fromEntries(ws.map((x) => [x.labels.event, inc(x)])), soulsResident: view(pick(m, 'sim_world_souls_resident')) ?? 'unknown', entities: view(pick(m, 'sim_world_entities')) ?? 'unknown' } : 'unknown';
  // the tick's own sample time (#859), not the scrape's: the rise of the tick over the rise of the time it was read at
  const tick = pick(m, 'sim_world_tick'), at = pick(m, 'sim_world_tick_sampled_seconds'), rate = pick(m, 'sim_world_clock_admin_rate');
  out.clock = tick && at && rate && (at.covRise ?? 0) > 0 ? { fullClockRatio: round((tick.covRise ?? 0) / ((at.covRise ?? 0) * TICK_HZ * view(rate).last), 4), seconds: round(at.covRise, 1), adminRate: view(rate).last,
    pace: view(pick(m, 'sim_world_attention_pace')) ?? 'unknown' } : 'unknown';
  return out;
}
function fleetS2(ws) {
  const known = (k) => ws.filter((w) => w[k] && w[k] !== 'unknown');
  const req = known('requests'), proc = known('process').filter((w) => typeof w.process.cpuCores === 'number');
  const sum = (c, o) => req.reduce((n, w) => n + (typeof w.requests[c][o] === 'number' ? w.requests[c][o] : 0), 0);
  return { requests: req.length ? Object.fromEntries(REQ_CLASSES.map((c) => [c, Object.fromEntries(REQ_OUTCOMES.map((o) => [o, sum(c, o)]))])) : 'unknown',
    cpuCores: proc.length ? { sum: round(proc.reduce((n, w) => n + w.process.cpuCores, 0), 3), worlds: proc.length, note: 'world processes only; the launcher and the host are not included' } : 'unknown' };
}
/** What no world in the range exported (S1's list, now only where it is still true). */
function unknownOf(worlds) {
  const ws = Object.values(worlds), out = [];
  for (const [k, what] of Object.entries(S2_UNKNOWN)) if (!ws.some((w) => w[k] && w[k] !== 'unknown')) out.push(`${what}: not exported by any world in this range (needs #737 S2 / #859)`);
  return out;
}

/** The full report: range, coverage, 1h/24h/7d comparisons, per world, store and loss counters. */
export function report(dir, state, { range = '24h', now = Date.now(), everyMs = 15_000 } = {}) {
  const [from, to] = parseRange(range, now), red = reduceRange(dir, state.types ?? {}, from, to, everyMs); let sum;
  const cmp = Object.fromEntries(['1h', '24h', '7d'].map((r) => { const [f, t] = parseRange(r, to), x = reduceRange(dir, state.types ?? {}, f, t, everyMs), s = summarize(x);
    return [r, { coverage: round(x.samples / Math.max(1, x.expected), 3), gaps: x.gaps, worldsRunningMean: s.fleet.worldsRunning?.mean ?? null, soulsActiveMeanTotal: s.fleet.soulsActive?.meanTotal ?? null,
      restarts: Object.values(s.worlds).reduce((n, w) => n + Object.values(w.restarts).reduce((a, b) => a + b, 0), 0), shed: Object.values(s.worlds).reduce((n, w) => n + Object.values(w.shed).reduce((a, b) => a + b, 0), 0) }]; }));
  return { schema: REPORT_SCHEMA, range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    coverage: { samples: red.samples, expected: red.expected, gaps: red.gaps, share: round(red.samples / Math.max(1, red.expected), 3), collectorRestarts: red.restarts ?? 0, clockSkewMaxMs: red.skewMaxMs },
    compare: cmp, ...(sum = summarize(red)), store: storeFacts(dir), loss: { ...(state.loss ?? {}), unreadableFilesThisReport: unreadable.n },
    unknown: unknownOf(sum.worlds) };
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
  for (const [w, x] of Object.entries(r.worlds)) {   // S2: only for worlds that exported the #859 series
    if (x.requests === 'unknown' && x.process === 'unknown' && x.disk === 'unknown') continue;
    const rq = (c) => (x.requests === 'unknown' ? '?' : `${c} ${x.requests[c].completed}/${x.requests[c].rejected}/${x.requests[c].failed}/${Object.values(x.requests[c].refused).reduce((a, b) => a + b, 0)}`);
    const p95 = (c, k) => (x.latency === 'unknown' ? '?' : String(x.latency[c]?.[k]?.p95 ?? '—'));
    L.push(`  ${w}: ok/rejected/failed/refused ${rq('read')}, ${rq('act')}; p95 s queue ${p95('read', 'queue')}/${p95('act', 'queue')} run ${p95('read', 'run')}/${p95('act', 'run')}; cpu ${x.process === 'unknown' ? '?' : x.process.cpuCores} cores; rss max ${x.process === 'unknown' || x.process.rssBytes === 'unknown' ? '?' : Math.round(x.process.rssBytes.max / 2 ** 20) + ' MB'}; db ${x.disk === 'unknown' || x.disk.dbBytes === 'unknown' ? '?' : fmt(x.disk.dbBytes.perDay) + ' B/day'}; clock ${x.clock === 'unknown' ? '?' : x.clock.fullClockRatio}`);
  }
  L.push('', `store ${Math.round(r.store.bytes / 2 ** 20)} MB over ${r.store.days} days (${Math.round(r.store.bytesPerDay / 2 ** 20)} MB/day); loss ${JSON.stringify(r.loss)}`, ...r.unknown.map((u) => `unknown: ${u}`));
  return L.join('\n') + '\n';
}
const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? String(Number(v.toFixed(3))) : String(v));
