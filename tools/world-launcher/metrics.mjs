// Prometheus metrics for the launcher and its worlds (lane L7, 2026-10-31; names: docs/architecture/load.md §5).
// Served at GET /__sim/metrics to direct loopback requests only (Grafana Alloy on the box scrapes it; never public).
// No dependency: the text exposition format (version 0.0.4) is written here, so a scrape costs one pass over the worlds
// and the small `live.json` each world's watchdog thread writes every 2 s (LOAD-CONTRACT §4). A world whose main thread is
// wedged still has a fresh-or-stale live.json, never a blocked scrape: the launcher never asks a world anything here.
//
// Labels: `world` (the slug) and a few closed enums (kind, class, reason, level, phase, status). Never a Soul id, account
// id, name or address (privacy). Values the world did not report are left out, not written as 0, so a dashboard shows
// "no data" instead of a false green.
//
// Mapping from live.json (fields absent in a release are skipped): at → sim_world_last_heartbeat_seconds;
// loop.delayP99Ms → sim_world_event_loop_delay_p99_seconds; loop.lastTurnAgeMs → sim_world_loop_last_turn_age_seconds;
// loop.elu → sim_world_elu; heap.gcPct10s → sim_world_gc_fraction (10 s window; heap.gcSecondsTotal, when present, →
// sim_world_gc_seconds_total); heap.usedMb/limitMb → bytes; tick.p99Ms → sim_world_tick_p99_seconds (a summary quantile:
// live.json carries a p99, not buckets); tick.lateTotal → sim_world_ticks_late_total; tick.service5s →
// sim_world_tick_service_ratio; souls.* → active/waiting/connected; queue.*; shed.{reads,acts,...} →
// sim_world_shed_total{class}; level → sim_world_level{level} 0/1; phase → sim_world_phase{phase} 0/1; boot.tick/target;
// read.workers/lagGens → sim_world_read_workers / sim_world_read_lag_gens (Stage B, only with read workers).
// CW3 (#737) S2 (the metric dictionary: docs/architecture/load.md §5.1): proc.* → sim_world_process_*; clock.* →
// sim_world_clock_admin_rate / _rate / sim_world_attention_pace / sim_world_tick_sampled_seconds; inventory.* →
// sim_world_souls_resident / _entities / _viewers; activity.* → sim_world_{awake_soul,connected_soul,viewer}_seconds_total;
// ws.* → sim_world_ws_*; requests/refused → sim_world_requests_total{class,outcome} / sim_world_requests_refused_total
// {class,code}; latency → sim_world_request_{queue,run}_seconds histograms{class}; disk.* → sim_world_{db,wal}_bytes and
// sim_world_disk_free_bytes.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LEVELS = ['green', 'amber', 'red', 'black'];
const PHASES = ['boot:restore', 'boot:replay', 'boot:projection', 'boot:prepare', 'serving', 'stopping'];
const LIVE_MAX_BYTES = 64 * 1024;
// closed label sets of the request counters (apps/server/src/load/shared.ts REQ_*): anything else is not exported
const REQ_CLASSES = ['read', 'act'];
const REQ_OUTCOMES = ['attempted', 'started', 'completed', 'rejected', 'failed', 'dropped'];
const REQ_CODES = ['soul.busy', 'soul.slow-down', 'world.busy', 'world.crowded'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
// 15 significant digits: a Unix time in seconds keeps its milliseconds (6 digits rounded it to ±5000 s), small values stay short
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15))));

/** The world's live.json (LOAD-CONTRACT §4), or null when absent, too big or not JSON. Never throws. */
export function readLive(dataDir) {
  if (!dataDir) return null;
  const file = join(dataDir, 'live.json');
  try {
    if (statSync(file).size > LIVE_MAX_BYTES) return null;
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/** A small builder: families keep HELP/TYPE once, samples in insertion order. */
function registry() {
  const fams = new Map();
  const add = (name, type, help, labels, value, suffix = '') => {
    const v = num(value); if (v === null) return;
    let f = fams.get(name); if (!f) fams.set(name, (f = { type, help, rows: [] }));
    const l = Object.entries(labels ?? {}).map(([k, x]) => `${k}="${esc(x)}"`).join(',');
    // counters and histograms keep 12 significant digits, so a long uptime's fractional totals still rate() finely
    f.rows.push(`${name}${suffix}${l ? `{${l}}` : ''} ${fmt(v)}`);
  };
  const text = () => {
    let out = '';
    for (const [name, f] of fams) out += `# HELP ${name} ${f.help}\n# TYPE ${name} ${f.type}\n${f.rows.join('\n')}\n`;
    return out;
  };
  return { add, text };
}

/**
 * metricsText({worlds, launcher, clientErrors, now}) → Prometheus text.
 *  worlds: [{slug, status, restarts?, restartsByReason?: {exit|wedged|crashloop|planned: n}, lastBootMs?, refused?, live?}]
 *          refused = the launcher's ceilings: requests it refused for this world since it started, by class
 *          ({'client.rate': n, 'account.rate': n, 'world.busy': n}) → sim_world_refused_total{world,class}
 *          listenHeld = { served, refused, gone, ended, seconds } (lane srv-shed) → sim_world_listen_held_total{world,outcome},
 *          sim_world_listen_held_seconds_sum/_count{world}
 *          (status from the launcher's pool; live = readLive(world.dataDir) or null)
 *  launcher: {build?, maxRunning?, maxWorlds?, memAvailableMb?}
 *  clientErrors: the clientErrors() table (client-errors.mjs) or null
 */
export function metricsText({ worlds = [], launcher = {}, clientErrors = null, now = Date.now() } = {}) {
  const r = registry(), g = (n, h, l, v) => r.add(n, 'gauge', h, l, v), c = (n, h, l, v) => r.add(n, 'counter', h, l, v);
  const running = worlds.filter((w) => w.status === 'running').length;
  g('sim_launcher_info', 'Launcher build (value always 1).', { build: launcher.build ?? 'dev' }, 1);
  g('sim_launcher_worlds_running', 'Worlds whose process is running (not asleep, stopped or held).', {}, running);
  g('sim_launcher_worlds_total', 'Worlds the launcher knows.', {}, worlds.length);
  g('sim_launcher_max_running', 'Cap on running worlds.', {}, launcher.maxRunning);
  g('sim_launcher_max_worlds', 'Cap on worlds.', {}, launcher.maxWorlds);
  g('sim_host_mem_available_bytes', 'MemAvailable of the host as the launcher sees it.', {}, num(launcher.memAvailableMb) === null ? null : launcher.memAvailableMb * 1048576);
  g('sim_metrics_scrape_timestamp_seconds', 'When this scrape was rendered (a dead-man reads it).', {}, now / 1000);

  for (const w of worlds) {
    const world = String(w.slug ?? '');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(world)) continue;
    const L = { world };
    for (const s of ['running', 'starting', 'restarting', 'asleep', 'stopped', 'failed', 'held', 'handover']) {
      g('sim_world_status', 'The launcher\'s status of the world (1 = current).', { world, status: s }, w.status === s ? 1 : 0);
    }
    const byReason = w.restartsByReason && typeof w.restartsByReason === 'object' ? w.restartsByReason : null;
    if (byReason) for (const reason of ['exit', 'wedged', 'crashloop', 'planned']) c('sim_world_restarts_total', 'World restarts by the launcher, by reason.', { world, reason }, num(byReason[reason]) ?? 0);
    else c('sim_world_restarts_total', 'World restarts by the launcher, by reason.', { world, reason: 'exit' }, w.restarts);   // a launcher without reasons
    for (const [cls, n] of Object.entries(w.refused && typeof w.refused === 'object' ? w.refused : {})) {
      if (/^[a-z][a-z0-9_.]{0,31}$/.test(cls)) c('sim_world_refused_total', 'Requests the launcher refused for this world (its ceilings), by class.', { world, class: cls }, n);
    }
    // lane srv-shed: listens over a listen ceiling held for a slot (then served, or refused after the hold)
    const lh = w.listenHeld && typeof w.listenHeld === 'object' ? w.listenHeld : null;
    if (lh) {
      for (const outcome of ['served', 'refused', 'gone']) c('sim_world_listen_held_total', 'Listen/wait long-polls held at the launcher for a free slot, by how the hold ended.', { world, outcome }, num(lh[outcome]) ?? 0);
      r.add('sim_world_listen_held_seconds', 'summary', 'Seconds listen/wait long-polls spent held for a slot.', L, lh.seconds, '_sum');
      r.add('sim_world_listen_held_seconds', 'summary', 'Seconds listen/wait long-polls spent held for a slot.', L, lh.ended, '_count');
    }
    g('sim_world_last_boot_seconds', 'Seconds the world\'s last boot took (start to healthy).', L, num(w.lastBootMs) === null ? null : w.lastBootMs / 1000);
    // Stage B (lane B-port): C2 reads the launcher sent to the world's read workers, and those it then asked main (a
    // worker error, a 5xx or no answer in 2 s); only for worlds with read workers on
    if (w.read) { for (const [level, n] of Object.entries(w.read.routedBy ?? {})) if (LEVELS.includes(level)) c('sim_world_read_routed_total', 'C2 reads the launcher routed to the world\'s read workers, by the world\'s load level then (at red/black: reads not shed).', { world, level }, n); c('sim_world_read_fallback_total', 'Routed reads asked of the main thread instead (worker error, 5xx or 2 s timeout).', L, w.read.fallback); c('sim_world_read_main_answered_total', 'Routed reads the read worker handed to the main thread itself (not ready, lagging, a main-only read): counted against the world budget.', L, w.read.mainAnswered ?? 0); c('sim_world_read_fallback_refused_total', 'Fallbacks refused because the world budget (main\'s share) was spent.', L, w.read.fallbackRefused ?? 0); }

    const v = w.live; if (!v) continue;
    const at = num(v.at);
    g('sim_world_last_heartbeat_seconds', 'Unix time of the watchdog\'s last live.json write.', L, at === null ? null : at / 1000);
    g('sim_world_live_age_seconds', 'Age of live.json at scrape time (> 30 s = wedged).', L, at === null ? null : Math.max(0, (now - at) / 1000));
    const loop = v.loop ?? {}, heap = v.heap ?? {}, tick = v.tick ?? {}, souls = v.souls ?? {}, queue = v.queue ?? {}, boot = v.boot ?? {};
    g('sim_world_event_loop_delay_p99_seconds', 'Event loop delay p99 of the world\'s main thread.', L, num(loop.delayP99Ms) === null ? null : loop.delayP99Ms / 1000);
    g('sim_world_loop_last_turn_age_seconds', 'Since the main thread last completed a loop turn.', L, num(loop.lastTurnAgeMs) === null ? null : loop.lastTurnAgeMs / 1000);
    g('sim_world_elu', 'Event loop utilization of the main thread (0..1).', L, loop.elu);
    g('sim_world_gc_fraction', 'Fraction of the last 10 s spent in GC (0..1).', L, num(heap.gcPct10s) === null ? null : heap.gcPct10s / 100);
    c('sim_world_gc_seconds_total', 'Seconds spent in GC since the world started.', L, heap.gcSecondsTotal);
    g('sim_world_heap_used_bytes', 'V8 heap used.', L, num(heap.usedMb) === null ? null : heap.usedMb * 1048576);
    g('sim_world_heap_limit_bytes', 'V8 heap limit.', L, num(heap.limitMb) === null ? null : heap.limitMb * 1048576);
    g('sim_world_tick', 'World tick number.', L, tick.world);
    g('sim_world_tick_p99_seconds', 'p99 duration of one world tick (recent window).', L, num(tick.p99Ms) === null ? null : tick.p99Ms / 1000);
    g('sim_world_tick_service_ratio', 'Ticks served / ticks due over the last 5 s (1 = keeping up).', L, tick.service5s);
    c('sim_world_ticks_late_total', 'Ticks that ran late since the world started.', L, tick.lateTotal);
    g('sim_world_active_souls', 'Souls awake in the world.', L, souls.awake);
    g('sim_world_active_souls_waiting', 'Souls waiting (asleep but listening).', L, souls.waiting);
    g('sim_world_active_souls_connected', 'Souls with a live connection.', L, souls.connected);
    g('sim_world_queue_depth', 'Requests queued for the tick thread.', L, queue.depth);
    g('sim_world_queue_oldest_seconds', 'Age of the oldest queued request.', L, num(queue.oldestMs) === null ? null : queue.oldestMs / 1000);
    for (const [cls, n] of Object.entries(v.shed && typeof v.shed === 'object' ? v.shed : {})) {
      if (/^[a-z][a-z0-9_]{0,31}$/.test(cls)) c('sim_world_shed_total', 'Requests shed by admission, by class.', { world, class: cls }, n);
    }
    if (typeof v.level === 'string') for (const lv of LEVELS) g('sim_world_level', 'Load level (1 = current).', { world, level: lv }, v.level === lv ? 1 : 0);
    if (typeof v.phase === 'string') for (const ph of PHASES) g('sim_world_phase', 'Process phase (1 = current).', { world, phase: ph }, v.phase === ph ? 1 : 0);
    const read = v.read && typeof v.read === 'object' ? v.read : null;
    if (read) { g('sim_world_read_workers', 'Read workers alive and serving (Stage B).', L, read.workers); g('sim_world_read_lag_gens', 'Largest delta gap between the main thread and a read worker (generations).', L, read.lagGens); }
    g('sim_world_boot_tick', 'Replay progress while booting: tick reached.', L, boot.tick);
    g('sim_world_boot_target_tick', 'Replay progress while booting: tick to reach.', L, boot.target);
    worldS2(r, world, v);
  }

  if (clientErrors) {
    const totals = clientErrors.totals?.() ?? {};
    for (const [kind, n] of Object.entries(totals)) c('sim_client_errors_total', 'Client error events visitors\' pages reported, by kind (since the launcher started).', { kind }, n);
    g('sim_client_errors_rate10m', 'Socket error events (ws, storm, arrival) in the last 10 minutes.', {}, clientErrors.rate10m?.());
    g('sim_client_errors_new_kinds', 'Error kinds first seen since this build went live.', {}, clientErrors.newSinceRelease?.());
  }
  return r.text();
}

/** CW3 (#737) S2 series of one world's live.json (absent fields are skipped, never written as 0). */
function worldS2(r, world, v) {
  const L = { world }, g = (n, h, l, x) => r.add(n, 'gauge', h, l, x), c = (n, h, l, x) => r.add(n, 'counter', h, l, x);
  const o = (x) => (x && typeof x === 'object' ? x : {});
  const MB = (x) => (num(x) === null ? null : x * 1048576);
  const proc = o(v.proc), clock = o(v.clock), inv = o(v.inventory), act = o(v.activity), ws = o(v.ws), disk = o(v.disk);
  c('sim_world_process_cpu_seconds_total', 'CPU seconds of the world process since it started, by mode (includes its worker threads).', { world, mode: 'user' }, proc.cpuUserSeconds);
  c('sim_world_process_cpu_seconds_total', 'CPU seconds of the world process since it started, by mode (includes its worker threads).', { world, mode: 'system' }, proc.cpuSystemSeconds);
  g('sim_world_process_resident_bytes', 'RSS of the world process (includes its worker threads).', L, MB(proc.rssMb));
  g('sim_world_process_external_bytes', 'V8 external memory of the world\'s main thread only (not its worker threads).', L, MB(proc.externalMb));
  g('sim_world_process_array_buffers_bytes', 'ArrayBuffer/Buffer memory of the world\'s main thread only (not its worker threads).', L, MB(proc.arrayBuffersMb));
  g('sim_world_clock_admin_rate', 'World time per wall time as the admin set it (the full-clock rate).', L, clock.adminRate);
  g('sim_world_clock_rate', 'Effective world clock rate (below the admin rate while dilated).', L, clock.rate);
  g('sim_world_attention_pace', 'Attention pace of the clock (1 = full pace).', L, clock.pace);
  g('sim_world_tick_sampled_seconds', 'Process-monotonic Unix time at which sim_world_tick was read.', L, num(clock.monoMs) === null ? null : clock.monoMs / 1000);
  if (typeof clock.state === 'string') for (const st of ['running', 'paused', 'unavailable']) g('sim_world_clock_state', 'The world clock runs, is paused by an admin, or is unavailable (1 = current).', { world, state: st }, clock.state === st ? 1 : 0);
  g('sim_world_souls_resident', 'Souls resident in the world process (minds; not humans).', L, inv.souls);
  g('sim_world_entities', 'Entities in the world\'s god model (placed objects; not definitions).', L, inv.entities);
  g('sim_world_viewers', 'Viewer sockets on the world\'s hub (connections, not humans).', L, inv.viewers);
  c('sim_world_awake_soul_seconds_total', 'Integral of awake Souls over wall seconds since the process started.', L, act.awakeSoulSeconds);
  c('sim_world_connected_soul_seconds_total', 'Integral of connected Souls over wall seconds since the process started.', L, act.connectedSoulSeconds);
  c('sim_world_viewer_seconds_total', 'Integral of viewer sockets over wall seconds since the process started.', L, act.viewerSeconds);
  for (const ev of ['opened', 'closed']) c('sim_world_ws_connections_total', 'Viewer WebSockets opened / closed since the process started.', { world, event: ev }, ws[ev]);
  c('sim_world_ws_sent_bytes_total', 'Text the hub sent to viewers since the process started (as it counts it per client).', L, ws.bytesSent);
  c('sim_world_ws_received_bytes_total', 'Bytes viewers sent to the hub since the process started.', L, ws.bytesReceived);
  const req = o(v.requests), ref = o(v.refused), lat = o(v.latency);
  for (const cls of REQ_CLASSES) {
    for (const outcome of REQ_OUTCOMES) c('sim_world_requests_total', 'Admitted-class requests (read = C2, act = C1) by outcome since the process started.', { world, class: cls, outcome }, o(req[cls])[outcome]);
    for (const code of REQ_CODES) c('sim_world_requests_refused_total', 'Requests in-world admission refused, by class and code.', { world, class: cls, code }, o(ref[cls])[code]);
    for (const kind of ['queue', 'run']) {
      const h = o(lat[`${cls}.${kind}`]), name = `sim_world_request_${kind}_seconds`;
      const help = kind === 'queue' ? 'Seconds a started request waited in admission (arrival to start).' : 'Seconds a started request ran (start to answer).';
      if (!Array.isArray(h.le) || !Array.isArray(h.counts) || h.counts.length !== h.le.length + 1) continue;
      h.le.forEach((le, i) => r.add(name, 'histogram', help, { world, class: cls, le: String(le) }, h.counts[i], '_bucket'));
      r.add(name, 'histogram', help, { world, class: cls, le: '+Inf' }, h.counts.at(-1), '_bucket');
      r.add(name, 'histogram', help, { world, class: cls }, h.sum, '_sum');
      r.add(name, 'histogram', help, { world, class: cls }, h.counts.at(-1), '_count');
    }
  }
  g('sim_world_db_bytes', 'Size of the world\'s sim.db.', L, disk.dbBytes);
  g('sim_world_wal_bytes', 'Size of the world\'s sim.db-wal.', L, disk.walBytes);
  g('sim_world_disk_free_bytes', 'Free bytes on the filesystem of the world\'s data directory.', L, disk.freeBytes);
}

/** Answer a metrics request (the caller has already checked it is a direct loopback GET). */
export function serveMetrics(res, opts) {
  let body;
  try { body = metricsText(opts); } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }).end(`metrics failed: ${e.message}\n`); return; }
  res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' }).end(body);
}
