// LOAD-CONTRACT §1: the in-world load sensor. Samples every 250 ms on the main thread (cheap: a few reads, one sort of
// <= 400 tick times), decides the level with hysteresis, publishes the numbers into the shared array the watchdog
// thread reads (shared.ts), and tells the registered dials the level. It only sets levels; every dial lives in the file
// that owns the cost and documents its own green/amber/red/black values.
import {monitorEventLoopDelay, PerformanceObserver, type IntervalHistogram} from 'node:perf_hooks';
import v8 from 'node:v8';
import {LEVELS, S, sharedLoad, type Level} from './shared.ts';
import {frameBudgetMs} from './admission.ts';

export type Signals = {service: number; loopP99Ms: number; heapFrac: number; gcFrac: number; oldestMs: number};
const RANK: Record<Level, number> = {green: 0, amber: 1, red: 2, black: 3};
export const STEP_DOWN_MS = 30_000, BLACK_SERVICE_MS = 30_000;

/** Loop-delay bands are relative to the world's own quiet baseline (LOAD-CONTRACT §1): a large world whose quiet ticks
 *  take 170 ms has a quiet loop p99 near 170 ms, so fixed 200/100 ms amber bands would hold it at amber forever.
 *  A loop band enters at max(absolute, 2 × baseline) and leaves below max(absolute, 1.2 × baseline). */
export const BASELINE_ENTER_X = 2, BASELINE_LEAVE_X = 1.2, BASELINE_CAP_MS = 400;
const loopEnter = (abs: number, b: number) => Math.max(abs, BASELINE_ENTER_X * b);
const loopLeave = (abs: number, b: number) => Math.max(abs, BASELINE_LEAVE_X * b);

/** Enter on any condition; step down one level after 30 s with every signal below the current level's lower band. */
export class LevelState {
  level: Level = 'green';
  /** The world's quiet loop-delay p99 (ms), from QuietBaseline or a registry pin; 0 = absolute bands only. */
  baselineMs = 0;
  private calmSince: number | null = null;
  private starvedSince: number | null = null;   // tick service < 0.2 since
  enterOf(s: Signals, now: number): Level {
    const b = this.baselineMs;
    if (s.service < 0.2) this.starvedSince ??= now; else this.starvedSince = null;
    if ((s.heapFrac > 0.92 && s.gcFrac > 0.40) || (this.starvedSince !== null && now - this.starvedSince >= BLACK_SERVICE_MS)) return 'black';
    if (s.service < 0.5 || s.loopP99Ms > loopEnter(1000, b) || s.heapFrac > 0.85) return 'red';
    // Queue age enters amber (the slow-down hint) but never red and never holds a level: at red the request budget is
    // 8 ms/frame, so a queue that red itself starves could keep red forever (the eden2 bench, 2026-10-31: red held for
    // whole windows at tick service 1.0 while the launcher shed every read as world.busy). Whether the thread is behind
    // is what service / loop delay / heap say.
    if (s.service < 0.8 || s.loopP99Ms > loopEnter(200, b) || s.heapFrac > 0.70 || s.oldestMs > 2000) return 'amber';
    return 'green';
  }
  below(level: Level, s: Signals): boolean {
    const b = this.baselineMs;
    switch (level) {
      case 'black': return s.service >= 0.4 && s.heapFrac < 0.85;
      case 'red': return s.service >= 0.7 && s.loopP99Ms < loopLeave(400, b) && s.heapFrac < 0.75;
      case 'amber': return s.service >= 0.9 && s.loopP99Ms < loopLeave(100, b) && s.heapFrac < 0.60;
      default: return true;
    }
  }
  /** Suspension is neither calm time nor continuous starvation. Keep the level, restart its timers. */
  resumed(now: number) {
    if (this.calmSince !== null) this.calmSince = now;
    if (this.starvedSince !== null) this.starvedSince = now;
  }
  update(s: Signals, now: number): Level {
    const enter = this.enterOf(s, now);
    if (RANK[enter] > RANK[this.level]) { this.level = enter; this.calmSince = null; return this.level; }
    if (this.level === 'green' || !this.below(this.level, s)) { this.calmSince = null; return this.level; }
    this.calmSince ??= now;
    if (now - this.calmSince >= STEP_DOWN_MS) { this.level = LEVELS[RANK[this.level] - 1]; this.calmSince = null; }
    return this.level;
  }
}

/** The quiet baseline: a peak-hold of the loop p99 of quiet windows (nothing queued, request time < 5 % of the window,
 *  tick service >= 0.95), decaying 2 % per window (half-life ~3 min). A peak, not a mean: a quiet large world's loop p99
 *  is mostly low (the live Eden copy: ~30 ms) with a window at its heavy ticks' length (~150 ms) every 10-15 s, and the
 *  level signal is the max of two windows, so a mean-like baseline still held it at amber. Each sample is bounded by
 *  the world's own tick p99 × 1.25 + 10 ms (a quiet world's peaks are its ticks; un-admitted work such as account
 *  creation is not learned) and capped at 400 ms (amber enter <= 800 ms stays below red's 1 s). Load never teaches it
 *  and it holds through load. */
export const BASELINE_DECAY = 0.98, QUIET_REQUEST_FRAC = 0.05;
export class QuietBaseline {
  value = 0;
  readonly pinned: number | undefined;
  constructor(pinned?: number) {
    this.pinned = pinned !== undefined && Number.isFinite(pinned) ? Math.min(BASELINE_CAP_MS, Math.max(0, pinned)) : undefined;
    this.value = this.pinned ?? 0;
  }
  /** A completed window's loop p99 (ms, already bounded by the tick p99) and whether it was quiet. Returns the baseline. */
  window(loopP99Ms: number, quiet: boolean): number {
    if (this.pinned !== undefined || !quiet || !Number.isFinite(loopP99Ms) || loopP99Ms < 0) return this.value;
    this.value = Math.max(Math.min(BASELINE_CAP_MS, loopP99Ms), this.value * BASELINE_DECAY);
    return this.value;
  }
}

/** The quiet tick (lane srv-admission-calib; LOAD-CONTRACT §2b): an EWMA of the tick's own average ms over the quiet loop
 *  windows (the same test as QuietBaseline), which sets the admission frame budget (admission.ts frameBudgetMs: the
 *  requests get a share of what the tick leaves of each 50 ms frame). Alpha 0.1 per 5 s window: a time constant of ~10
 *  windows (~50 s, half-life ~33 s), long enough to average over a large world's heavy ticks (one every 10-15 s) and short
 *  enough to follow a world that grows within a minute or two. Until the first quiet window, non-warm windows with tick
 *  service >= 0.95 seed it provisionally (a world that boots straight into load still calibrates); the first quiet window
 *  replaces that seed. A window needs >= 20 ticks of its own (1 s) to count. */
export const QUIET_TICK_ALPHA = 0.1, QUIET_TICK_MIN_TICKS = 20;
export class QuietTick {
  value = 0;
  /** true once a quiet window has been learned (the provisional seed is then no longer fed). */
  quietSeen = false;
  /** A completed window's own tick average and whether it was quiet / served (service >= 0.95). Returns the EWMA. */
  window(avgMs: number, quiet: boolean, served: boolean): number {
    if (!Number.isFinite(avgMs) || avgMs < 0) return this.value;
    if (quiet && !this.quietSeen) { this.quietSeen = true; this.value = avgMs; return this.value; }
    if (quiet || (!this.quietSeen && served)) this.value = this.value > 0 ? this.value + QUIET_TICK_ALPHA * (avgMs - this.value) : avgMs;
    return this.value;
  }
}

/** What the monitor reads from the world (WorldHost satisfies it). */
export type HostLike = {rewinds?: number; engine: {world: {tick: number}}; tickMs: number[]; paused: boolean; pace: number; baseRate: number; readonly running: boolean; readonly clockAvailable: boolean};
export type Dial = (level: Level) => void;
export type MonitorOpts = {
  host: HostLike;
  queue?: () => {depth: number; oldestMs: number};
  shed?: () => {reads: number; acts: number};
  /** Monotonic request handler ms (Admission.spentMs): a loop window is quiet only if requests took < 5 % of it. */
  requestMs?: () => number;
  /** Registry pin for the quiet loop baseline (SIM_LOAD_BASELINE_MS): fixed, never learned; 0 = absolute bands. */
  baselineMs?: number;
  souls?: () => {awake: number; waiting: number; connected: number};
  onLevel?: (from: Level, to: Level, s: Signals) => void;
  /** Black for this long → planned restart (main.ts: snapshot, exit 75). */
  onBlackTooLong?: () => void; blackLimitMs?: number;
  shared?: Float64Array; now?: () => number; sampleMs?: number;
  /** Loop-delay window (default 5 s; tests shorten it). */
  windowMs?: number;
  /** Drill only (SIM_LOAD_DRILL_LEVEL): hold this level whatever the signals say, to exercise dials and the restart path. */
  drill?: Level;
};

const TICK_MS = 50, MIN_WINDOW_SAMPLES = 100;
export class LoadMonitor {
  readonly state = new LevelState();
  readonly baseline: QuietBaseline;
  readonly quietTick = new QuietTick();
  private windowMs: number;
  private startedAt: number | null = null;
  private quiet = {depth: 0, reqMs: 0, service: 1, tick0: 0};   // the current loop window: max queue depth, request ms at its start, min tick service, world tick at its start
  get level(): Level { return this.state.level; }
  signals: Signals = {service: 1, loopP99Ms: 0, heapFrac: 0, gcFrac: 0, oldestMs: 0};
  tickStats = {avg: 0, max: 0, n: 0, p99: 0};
  private dials = new Map<string, Dial>();
  private hist: IntervalHistogram | null = null;
  private prevLoopP99 = 0;
  private histAt = 0;
  private gc: {at: number; ms: number}[] = [];
  private obs: PerformanceObserver | null = null;
  private ticks: {at: number; tick: number; due: number}[] = [];   // due = ticks owed since the previous sample
  private timer: NodeJS.Timeout | null = null;
  private pendingSample: NodeJS.Immediate | null = null;
  private blackSince: number | null = null;
  private soulsAt = 0;
  private souls = {awake: 0, waiting: 0, connected: 0};
  private a: Float64Array;
  private now: () => number;
  private o: MonitorOpts;
  constructor(o: MonitorOpts) { this.o = o; this.a = o.shared ?? sharedLoad; this.now = o.now ?? Date.now; this.windowMs = o.windowMs ?? 5000; this.baseline = new QuietBaseline(o.baselineMs); this.state.baselineMs = this.baseline.value; }

  /** The dial registry (LOAD-CONTRACT §1). A dial is told the current level at once and on every change. */
  register(name: string, dial: Dial) { this.dials.set(name, dial); try { dial(this.level); } catch (e) { console.error(`[load] dial ${name} failed`, e); } }
  start() {
    if (this.timer) return;
    this.hist = monitorEventLoopDelay({resolution: 10}); this.hist.enable(); this.histAt = this.startedAt = this.now(); this.quiet = {depth: 0, reqMs: this.o.requestMs?.() ?? 0, service: 1, tick0: this.o.host.engine.world.tick};
    try { this.obs = new PerformanceObserver(list => { for (const e of list.getEntries()) this.gc.push({at: this.now(), ms: e.duration}); }); this.obs.observe({entryTypes: ['gc']}); } catch { this.obs = null; }
    process.on('SIGCONT', this.resumed);
    // On thaw, overdue timers can run before the SIGCONT callback. Sample after the poll phase so the explicit
    // resume notification can discard suspended wall time before it becomes a false red lasting 30 seconds.
    this.timer = setInterval(() => {
      if (!this.pendingSample) this.pendingSample = setImmediate(() => { this.pendingSample = null; this.sample(); });
    }, this.o.sampleMs ?? 250); this.timer.unref();
    this.sample();
  }
  stop() {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    if (this.pendingSample) clearImmediate(this.pendingSample); this.pendingSample = null;
    process.off('SIGCONT', this.resumed); this.hist?.disable(); this.obs?.disconnect();
  }
  private resumed = () => {
    const now = this.now();
    this.ticks = []; this.prevLoopP99 = 0; this.hist?.reset(); this.histAt = now; this.gc = [];
    this.quiet = {depth: 0, reqMs: this.o.requestMs?.() ?? 0, service: 1, tick0: this.o.host.engine.world.tick};
    this.state.resumed(now);
    if (this.blackSince !== null) this.blackSince = now;
  };

  /** One sample: read, decide, publish. Public for tests (which pass signals straight to state.update instead). */
  sample(): Level {
    const now = this.now(), h = this.o.host, a = this.a;
    a[S.lastTurnAt] = now;
    a[S.halted] = h.clockAvailable === false ? 1 : 0;
    a[S.rewinds] = h.rewinds ?? 0;
    // tick service over 5 s: ticks run / ticks owed at the admin rate and the attention pace (dilation counts as missed)
    const prev = this.ticks.at(-1), owing = h.running && !h.paused && h.clockAvailable;
    const due = prev && owing ? (Math.min(1000, now - prev.at) * h.baseRate * h.pace) / TICK_MS : 0;
    this.ticks.push({at: now, tick: h.engine.world.tick, due});
    while (this.ticks.length > 2 && now - this.ticks[1].at > 5000) this.ticks.shift();
    let owed = 0; for (let i = 1; i < this.ticks.length; i++) owed += this.ticks[i].due;
    const ran = this.ticks.at(-1)!.tick - this.ticks[0].tick;
    const service = owed >= 2 ? Math.min(1, ran / owed) : 1;
    // event-loop delay p99 over the last ~5 s (two rotating windows)
    const q = this.o.queue?.() ?? {depth: 0, oldestMs: 0};
    this.quiet.depth = Math.max(this.quiet.depth, q.depth); this.quiet.service = Math.min(this.quiet.service, service);
    let loopP99 = this.prevLoopP99;
    if (this.hist) {
      // the open window counts once it has >= 100 samples (~1 s at 10 ms): just after a reset, its p99 is the max of a
      // handful of samples, so one ordinary heavy tick read as p99 and kept resetting the 30 s calm (live copy: 77 s
      // at amber with every full window at 65 ms); a stall shows ~1 s later here, at the window's close in any case,
      // and through tick service and the queue meanwhile
      if (this.hist.count >= MIN_WINDOW_SAMPLES) loopP99 = Math.max(loopP99, this.hist.percentile(99) / 1e6);
      if (now - this.histAt >= this.windowMs) {
        this.prevLoopP99 = this.hist.count > 0 ? this.hist.percentile(99) / 1e6 : 0;
        this.windowDone(this.prevLoopP99, now);
        this.hist.reset(); this.histAt = now;
      }
    }
    const hs = v8.getHeapStatistics(), heapFrac = hs.heap_size_limit ? hs.used_heap_size / hs.heap_size_limit : 0;
    while (this.gc.length && now - this.gc[0].at > 10_000) this.gc.shift();
    let gcMs = 0; for (const g of this.gc) gcMs += g.ms;
    this.signals = {service, loopP99Ms: loopP99, heapFrac, gcFrac: gcMs / 10_000, oldestMs: q.oldestMs};
    // tick times (the last ~20 s, as /healthz has always reported them)
    const ms = h.tickMs; let sum = 0, max = 0; for (const x of ms) { sum += x; if (x > max) max = x; }
    const sorted = ms.length ? [...ms].sort((x, y) => x - y) : [];
    this.tickStats = {avg: ms.length ? Math.round(10 * sum / ms.length) / 10 : 0, max: Math.round(10 * max) / 10, n: ms.length, p99: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))] : 0};
    if (this.o.souls && now - this.soulsAt >= 2000) { this.soulsAt = now; try { this.souls = this.o.souls(); } catch { /* presence is best effort */ } }
    // the serving turn's own warm-up (JIT, first projections) is not load: loop delay counts for levels once two windows
    // have closed (the first window's p99 carries into the second); service, heap and queue count at once
    const warm = this.startedAt !== null && now - this.startedAt < 2 * this.windowMs, judged = warm ? {...this.signals, loopP99Ms: 0} : this.signals;
    const from = this.level, to = this.o.drill ? (this.state.level = this.o.drill) : this.state.update(judged, now);
    if (to !== from) this.changed(from, to);
    if (to === 'black') {
      this.blackSince ??= now;
      if (now - this.blackSince >= (this.o.blackLimitMs ?? 60_000)) { this.blackSince = null; try { this.o.onBlackTooLong?.(); } catch (e) { console.error('[load] planned restart failed', e); } }
    } else this.blackSince = null;
    const shed = this.o.shed?.() ?? {reads: 0, acts: 0};
    a[S.worldTick] = h.engine.world.tick; a[S.service5s] = service; a[S.tickP99Ms] = this.tickStats.p99; a[S.loopP99Ms] = loopP99;
    a[S.heapUsedMb] = hs.used_heap_size / 1048576; a[S.heapLimitMb] = hs.heap_size_limit / 1048576; a[S.gcPct10s] = 100 * gcMs / 10_000;
    a[S.level] = LEVELS.indexOf(to); a[S.queueDepth] = q.depth; a[S.queueOldestMs] = q.oldestMs;
    a[S.awake] = this.souls.awake; a[S.waiting] = this.souls.waiting; a[S.connected] = this.souls.connected;
    a[S.shedReads] = shed.reads; a[S.shedActs] = shed.acts; a[S.sampledAt] = now; a[S.quietTickMs] = this.quietTick.value;
    return to;
  }
  /** A loop window closed: feed the quiet baseline (QuietBaseline). The serving warm-up windows are not quiet. Public for tests. */
  windowDone(loopP99Ms: number, now: number) {
    const reqMs = this.o.requestMs?.() ?? 0, spanMs = Math.max(1, now - this.histAt);
    const warm = this.startedAt !== null && now - this.startedAt < 2 * this.windowMs;
    const quiet = !warm && this.quiet.depth === 0 && reqMs - this.quiet.reqMs < QUIET_REQUEST_FRAC * spanMs && this.quiet.service >= 0.95;
    const own = this.tickStats.n > 0 ? Math.min(loopP99Ms, 1.25 * this.tickStats.p99 + 10) : loopP99Ms;
    this.state.baselineMs = this.baseline.window(own, quiet);
    // the window's own ticks: the last (ticks run since it opened) entries of the host's tick-time ring (one per tick)
    const h = this.o.host, tick = h.engine.world.tick, n = Math.min(h.tickMs.length, tick - this.quiet.tick0);
    if (!warm && n >= QUIET_TICK_MIN_TICKS) {
      let sum = 0; for (let i = h.tickMs.length - n; i < h.tickMs.length; i++) sum += h.tickMs[i];
      this.a[S.quietTickMs] = this.quietTick.window(sum / n, quiet, this.quiet.service >= 0.95);
    }
    this.quiet = {depth: 0, reqMs, service: 1, tick0: tick};
  }
  /** Mark a main-thread turn without a full sample (after a tick). */
  turn() { this.a[S.lastTurnAt] = this.now(); }
  private changed(from: Level, to: Level) {
    const s = this.signals;
    console.log(`[load] ${from}→${to}: service ${s.service.toFixed(2)}, loop p99 ${Math.round(s.loopP99Ms)} ms (quiet ${Math.round(this.state.baselineMs)}), heap ${Math.round(100 * s.heapFrac)}%, gc ${Math.round(100 * s.gcFrac)}%, queue ${(s.oldestMs / 1000).toFixed(1)} s`);
    this.o.onLevel?.(from, to, s);
    for (const [name, dial] of this.dials) { try { dial(to); } catch (e) { console.error(`[load] dial ${name} failed`, e); } }
  }
  /** The /healthz `load` block: O(1), from the last sample. */
  health() {
    const s = this.signals;
    return {level: this.level, service5s: Math.round(100 * s.service) / 100, loopP99Ms: Math.round(s.loopP99Ms), heapPct: Math.round(100 * s.heapFrac), gcPct10s: Math.round(100 * s.gcFrac),
      tickP99Ms: Math.round(10 * this.tickStats.p99) / 10, loopBaselineMs: Math.round(this.state.baselineMs),
      quietTickMs: Math.round(10 * this.quietTick.value) / 10, frameBudgetMs: Math.round(10 * frameBudgetMs(this.level, this.quietTick.value)) / 10, queue: this.o.queue?.() ?? {depth: 0, oldestMs: 0}, souls: this.souls};
  }
}
