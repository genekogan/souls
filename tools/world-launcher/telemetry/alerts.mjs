// CW5 S1 (#739 A4/A6): deterministic alert evaluation over the telemetry store's rows (store.mjs readHour rows:
// {t, ok, error?, values: Map<key, number>}). Pure apart from `catchUp`, which reads the store and writes two files:
//   <dir>/alerts.jsonl        one line per transition: firing | resolved | unknown | known. Unchanged state writes nothing.
//   <dir>/alerts-state.json   the evaluator state (windows, last row), so a restart neither repeats nor loses a transition
// Rules have a hold window (the condition must hold that long before it fires), a clear window and an optional clear
// threshold (hysteresis). A running world without a rule's series becomes `unknown`, never healthy. No delivery: a
// local event only (paging is #461's).
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labelsOf } from './prom.mjs';
import { fineFiles, tryReadHour } from './store.mjs';

export const ALERTS_VERSION = 1;
const S = 1000, MIN = 60 * S, GIB = 2 ** 30;
const HOLD = 30 * S, CLEAR = 60 * S;
/** Inputs a complete monitor needs that the launcher does not export yet: reported as unknown coverage, never as ok. */
export const NOT_EXPORTED = ['process CPU', 'process RSS', 'cgroup CPU/memory pressure', 'disk and WAL growth'];

// value(ctx) → number | null (null = the series is missing). ctx: {g(name), sum(name, except?), rate(name), inc(name, windowMs)}
export const RULES = [
  { id: 'loop-stall', scope: 'world', what: 'main-thread event-loop delay p99 (s)', value: (c) => c.g('sim_world_event_loop_delay_p99_seconds'), op: '>', threshold: 0.25, clearAt: 0.15 },
  { id: 'tick-slow', scope: 'world', what: 'tick duration p99 (s)', value: (c) => c.g('sim_world_tick_p99_seconds'), op: '>', threshold: 0.1, clearAt: 0.075 },
  { id: 'gc-pressure', scope: 'world', what: 'share of time in GC', value: (c) => c.g('sim_world_gc_fraction'), op: '>', threshold: 0.1, clearAt: 0.05 },
  { id: 'main-thread-busy', scope: 'world', what: 'main-thread event-loop utilization', value: (c) => c.g('sim_world_elu'), op: '>', threshold: 0.9, clearAt: 0.8 },
  { id: 'heap-pressure', scope: 'world', what: 'heap used / heap limit', value: (c) => { const u = c.g('sim_world_heap_used_bytes'), l = c.g('sim_world_heap_limit_bytes'); return u == null || !l ? null : u / l; }, op: '>', threshold: 0.85, clearAt: 0.8 },
  { id: 'queue-stall', scope: 'world', what: 'oldest queued request (s)', value: (c) => c.g('sim_world_queue_oldest_seconds'), op: '>', threshold: 2, clearAt: 1 },
  // the independent clock measurement (#737/#799): late ticks per second, not the pace-normalized service ratio
  { id: 'clock-lag', scope: 'world', what: 'late ticks per second', value: (c) => c.rate('sim_world_ticks_late_total'), op: '>', threshold: 1, clearAt: 0.2 },
  { id: 'refusals', scope: 'world', what: 'refused or shed requests per second', value: (c) => { const a = c.rate('sim_world_refused_total'), b = c.rate('sim_world_shed_total'); return a == null && b == null ? null : (a ?? 0) + (b ?? 0); }, op: '>', threshold: 0, missingOk: true, holdMs: 0, clearMs: 5 * MIN },
  { id: 'stale-live', scope: 'world', what: 'live.json age (s)', value: (c) => c.g('sim_world_live_age_seconds'), op: '>', threshold: 30, holdMs: 0 },
  // a crash loop is judged whatever the world's status (a restarting world is not running)
  { id: 'crash-loop', scope: 'any-world', what: 'non-planned restarts in 10 min', value: (c) => c.inc('sim_world_restarts_total', 10 * MIN, 'planned'), op: '>=', threshold: 3, holdMs: 0, clearMs: 10 * MIN },
  { id: 'host-memory', scope: 'fleet', what: 'host memory available (GiB)', value: (c) => { const v = c.g('sim_host_mem_available_bytes'); return v == null ? null : v / GIB; }, op: '<', threshold: 1, clearAt: 1.5 },
  { id: 'telemetry-gap', scope: 'collector', what: 'seconds since the last answered scrape', op: '>', threshold: null, holdMs: 0, clearMs: 0 },
];

const cmp = (op, v, t) => (op === '>' ? v > t : op === '>=' ? v >= t : v < t);
/** Rules with overrides applied: {id: {threshold?, clearAt?, holdMs?, clearMs?, off?}}. Unknown ids are refused. */
export function rulesWith(over = {}) {
  for (const id of Object.keys(over)) if (!RULES.some((r) => r.id === id)) throw new Error(`rules: unknown rule ${id}`);
  return RULES.filter((r) => !over[r.id]?.off).map((r) => ({ holdMs: HOLD, clearMs: CLEAR, ...r, ...Object.fromEntries(Object.entries(over[r.id] ?? {}).filter(([k]) => ['threshold', 'clearAt', 'holdMs', 'clearMs'].includes(k))) }));
}

export function initialState() { return { version: ALERTS_VERSION, lastT: null, lastOkT: null, prev: null, keys: {}, restarts: {} }; }

/** The per-row view of one world: gauges, sums across label sets and rates against the previous adjacent row. */
function worldsOf(values) {
  const worlds = new Map();   // world → Map<key, value>
  for (const [k, v] of values) { const { labels } = labelsOf(k); if (labels.world == null) continue; let m = worlds.get(labels.world); if (!m) worlds.set(labels.world, (m = new Map())); m.set(k, v); }
  return worlds;
}
const sumOf = (m, name, except) => { let s = null; for (const [k, v] of m) { const { name: n, labels } = labelsOf(k); if (n === name && (!except || !Object.values(labels).includes(except))) s = (s ?? 0) + v; } return s; };
const running = (m, world) => m.get(`sim_world_status{status="running",world="${world}"}`) === 1;

/** Evaluate rows (oldest first) after state.lastT. → {state, events}. `now` closes a trailing outage (no rows at all). */
export function evaluate(rows, rules, state = initialState(), { everyMs = 15_000, now = null } = {}) {
  const st = structuredClone(state), events = [], gapAfter = 2.5 * everyMs;
  const step = (rule, scope, t, v) => {   // v: number | null (missing)
    const key = `${rule.id}|${scope ?? ''}`;
    if (!st.keys[key] && v != null && !(rule.op === '>' ? v > rule.threshold : rule.op === '>=' ? v >= rule.threshold : v < rule.threshold)) return;   // ok and nothing pending: keep no state
    const k = (st.keys[key] ??= { state: 'ok', condSince: null, clearSince: null, missingSince: null });
    const emit = (to) => { events.push({ t, rule: rule.id, ...(scope ? { world: scope } : {}), from: k.state, to: to === 'ok' ? (k.state === 'unknown' ? 'known' : 'resolved') : to, value: v == null ? null : +v.toFixed(4), threshold: rule.threshold, what: rule.what }); k.state = to; };
    if (v == null) { k.condSince = k.clearSince = null; k.missingSince ??= t; if (k.state !== 'unknown' && t - k.missingSince >= rule.holdMs) emit('unknown'); return; }
    k.missingSince = null;
    const holds = k.state === 'firing' && rule.clearAt != null ? cmp(rule.op, v, rule.clearAt) : cmp(rule.op, v, rule.threshold);
    if (holds) { k.clearSince = null; k.condSince ??= t; if (k.state !== 'firing' && t - k.condSince >= rule.holdMs) emit('firing'); }
    else { k.condSince = null; k.clearSince ??= t; if (k.state !== 'ok' && t - k.clearSince >= (k.state === 'unknown' ? 0 : rule.clearMs)) emit('ok'); if (k.state === 'ok') delete st.keys[key]; }
  };
  // telemetry-gap: seconds since the last answered scrape. Failed scrapes and silence (no rows by `now`) both count; an
  // answer after a silent outage records it (firing, then resolved, at that answer's time).
  const gap = rules.find((r) => r.id === 'telemetry-gap'), gapRule = gap && { ...gap, threshold: gap.threshold ?? gapAfter / S };
  const since = (t) => (st.lastOkT == null ? Infinity : (t - st.lastOkT) / S), gapAt = (t, v) => gapRule && step(gapRule, null, t, v);
  for (const row of rows) {
    if (st.lastT != null && row.t <= st.lastT) continue;
    if (!row.ok) { gapAt(row.t, since(row.t)); st.lastT = row.t; st.prev = null; continue; }
    const prev = st.prev && row.t - st.prev.t > 0 && row.t - st.prev.t <= gapAfter ? st.prev : null;
    if (st.lastOkT != null) gapAt(row.t, since(row.t));
    gapAt(row.t, 0); st.lastOkT = row.t;
    const worlds = worldsOf(row.values), prevWorlds = prev ? worldsOf(new Map(Object.entries(prev.values))) : new Map();
    for (const rule of rules) {
      if (rule.scope === 'fleet') step(rule, null, row.t, rule.value({ g: (n) => row.values.get(n) ?? null }));
      if (rule.scope !== 'world' && rule.scope !== 'any-world') continue;
      for (const [w, m] of worlds) {
        const isRunning = running(m, w);
        const ctx = {
          g: (n) => m.get(`${n}{world="${w}"}`) ?? null,
          rate: (n) => { const a = prevWorlds.get(w), x = sumOf(m, n); if (x == null) return null; if (!a) return undefined; const y = sumOf(a, n); return y == null || x < y ? undefined : (x - y) / ((row.t - prev.t) / S); },
          // change points only ([t, value]); the one at or before the window start is the baseline
          inc: (n, windowMs, except) => { const x = sumOf(m, n, except); if (x == null) return null; const h = (st.restarts[w] ??= []); if (!h.length || h.at(-1)[1] !== x) h.push([row.t, x]); while (h.length > 1 && h[1][0] <= row.t - windowMs) h.shift(); return Math.max(0, x - Math.min(...h.map((p) => p[1]))); },
        };
        if (rule.scope === 'world' && !isRunning) { if (st.keys[`${rule.id}|${w}`]) step(rule, w, row.t, rule.op === '<' ? Infinity : -Infinity); continue; }   // not running: not stalling
        let v = rule.value(ctx);
        if (v === undefined) continue;   // a rate without an adjacent previous row: no reading this time, no change
        if (v == null && rule.missingOk) v = 0;   // counters that only appear once something happened
        step(rule, w, row.t, v);
      }
    }
    // keep only what the next rows need: the previous row's counters, by key
    st.prev = { t: row.t, values: Object.fromEntries([...row.values].filter(([k]) => /_total(\{|$)/.test(k))) };
    st.lastT = row.t;
  }
  if (now != null && (st.lastT == null || now - st.lastT > gapAfter)) gapAt(now, since(now));   // no rows at all: the collector itself is down
  return { state: st, events };
}

/** The current non-ok states, for a summary line. */
export function open(state) {
  return Object.entries(state.keys).filter(([, k]) => k.state !== 'ok').map(([key, k]) => { const [rule, world] = key.split('|'); return { rule, ...(world ? { world } : {}), state: k.state }; });
}

/** Read the store's rows after the saved state, evaluate, append the transitions, save the state. */
export function catchUp(dir, { rules = rulesWith(), everyMs = 15_000, now = Date.now(), lookbackMs = 2 * 3_600_000 } = {}) {
  const file = join(dir, 'alerts-state.json');
  let state; try { state = JSON.parse(readFileSync(file, 'utf8')); if (state.version !== ALERTS_VERSION) state = initialState(); } catch { state = initialState(); }
  const from = state.lastT != null ? Math.max(state.lastT, now - lookbackMs) : now - lookbackMs;
  const rows = (existsSync(join(dir, 'fine')) ? fineFiles(dir, from, now + 1) : []).map(tryReadHour).filter(Boolean).flatMap((h) => h.rows).filter((r) => r.t > (state.lastT ?? -Infinity)).sort((a, b) => a.t - b.t);
  const r = evaluate(rows, rules, state, { everyMs, now });
  if (r.events.length) appendFileSync(join(dir, 'alerts.jsonl'), r.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(file + '.tmp', JSON.stringify(r.state) + '\n'); renameSync(file + '.tmp', file);
  return { events: r.events, open: open(r.state), rows: rows.length, notExported: NOT_EXPORTED };
}
