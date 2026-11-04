// LOAD-CONTRACT §4: the numbers the main thread publishes for the watchdog thread (load/watchdog-worker.ts).
// One small Float64Array over a SharedArrayBuffer. The main thread writes it every 250 ms (monitor.ts), on boot
// milestones (boot-progress.ts) and, through the monitor, after ticks; the worker only reads it. A torn read of one
// float is harmless here (each slot is an independent gauge), so there is no lock.
import {attachBootSlots, BOOT_SLOT, readBootProgress} from './boot-progress.ts';
export const LEVELS = ['green', 'amber', 'red', 'black'] as const;
export type Level = typeof LEVELS[number];
export type Phase = 'boot:restore' | 'boot:replay' | 'boot:projection' | 'boot:prepare' | 'serving' | 'stopping';
export type BootStage = 'restore' | 'replay' | 'projection' | 'prepare';

/** Slot indices. Append only: the worker of a release reads the layout of the same release (same process). */
export const S = {
  lastTurnAt: 0,   // epoch ms of the main thread's last loop turn (monitor sample, boot milestone, tick)
  boot: 1,         // 4 slots owned by boot-progress.ts (lane L5): phase index, boot tick, boot target, wall ms
  worldTick: 5, service5s: 6, tickP99Ms: 7, loopP99Ms: 8,
  heapUsedMb: 9, heapLimitMb: 10, gcPct10s: 11,
  level: 12,       // index into LEVELS
  queueDepth: 13, queueOldestMs: 14,
  awake: 15, waiting: 16, connected: 17,
  shedReads: 18, shedActs: 19,
  sampledAt: 20,   // epoch ms of the last full monitor sample (tick/heap/level numbers)
  // Stage B (lane B-port, SIM_READ_WORKER=1 only; all 0 otherwise, and live.json then has no read fields):
  readMode: 21,    // 0 = no read workers; 1 = the spike's subset (here, capabilities); 2 = full (B-facade: every C2 read)
  readWorkers: 22, // read workers alive
  readLagGens: 23, // the largest delta gap (generations) between the main thread and a live read worker
  readPorts: 24,   // 4 slots: each read worker's loopback HTTP port (0 = none)
  // admission calibration (lane srv-admission-calib): EWMA of the tick's own ms over quiet loop windows (monitor.ts);
  // 0 = not measured yet. admission.ts reads it for the frame budget (frameBudgetMs).
  quietTickMs: 28,
  // CW3 (#737): series the launcher's /__sim/metrics already mapped but nothing wrote. elu: event-loop utilization of
  // the last closed 5 s window (-1 = no window closed yet); gcMsTotal: GC pause ms since the process started (never
  // reset, so a scrape sees every pause); ticksLateTotal: ticks whose own run took longer than their 50 ms budget.
  elu: 29, gcMsTotal: 30, ticksLateTotal: 31,
  // CW3 (#737) S2, sampled when a 5 s monitor window closes (procAt = 0 until then): CPU ms since the process started
  // (user, system) and RSS MB are process totals (the watchdog and read-worker threads included); external and
  // array-buffer MB are the main thread's V8 isolate only (process.memoryUsage reports those per thread).
  procAt: 32, cpuUserMs: 33, cpuSysMs: 34, rssMb: 35, externalMb: 36, arrayBuffersMb: 37,
  // independent full-clock evidence: the admin rate (world time per wall time, as set), the current rate (dilation), the
  // attention pace, and the process-monotonic epoch ms of the sample that wrote worldTick (tickMonoMs)
  adminRate: 38, clockRate: 39, pace: 40, tickMonoMs: 41,
  // inventory (soulsTotal = resident minds; entities = the god model's, -1 = no god model) and viewers (hub clients)
  soulsTotal: 42, entities: 43, viewers: 44,
  // activity integrals since the process started (seconds × count)
  awakeSoulSeconds: 45, connectedSoulSeconds: 46, viewerSeconds: 47,
  // the viewer hub's WebSockets: opened, closed, bytes sent (where the hub accounts them per client), bytes received
  wsOpened: 48, wsClosed: 49, wsBytesSent: 50, wsBytesReceived: 51,
  // admission request counters (REQ_* below); reqOn = 1 once an Admission writes here (absent with SIM_ADMISSION=0)
  reqOn: 52, req: 53,          // REQ_CLASSES × REQ_OUTCOMES counters
  refused: 65,                 // REQ_CLASSES × REQ_CODES counters
  hist: 73,                    // REQ_HISTS × HIST_SLOTS: per-bucket counts (not cumulative), +Inf, then the sum in seconds
  // 0 = the clock runs; 1 = paused by an admin; 2 = no clock (not serving it): a full-clock measurer excludes 1 and 2
  clockState: 125,
  size: 126,
} as const;

/** CW3 (#737) S2: closed label sets of the request counters. Order is the slot layout (append only). */
export const REQ_CLASSES = ['read', 'act'] as const;
export const REQ_OUTCOMES = ['attempted', 'started', 'completed', 'rejected', 'failed', 'dropped'] as const;
export const REQ_CODES = ['soul.busy', 'soul.slow-down', 'world.busy', 'world.crowded'] as const;
export const REQ_HISTS = ['read.queue', 'read.run', 'act.queue', 'act.run'] as const;
/** Upper bounds (seconds) of the latency buckets; one more slot counts +Inf, and the last slot holds the sum. */
export const HIST_LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
export const HIST_SLOTS = HIST_LE.length + 2;
export type ReqClass = typeof REQ_CLASSES[number];
export type ReqOutcome = typeof REQ_OUTCOMES[number];
export type ReqCode = typeof REQ_CODES[number];
/** One cumulative Prometheus-style histogram: counts per upper bound (cumulative, last = +Inf = count) and the sum. */
export type Hist = {le: number[]; counts: number[]; sum: number};

export type LiveJson = {
  v: 1; pid: number; at: number; phase: Phase;
  boot?: {stage: BootStage; tick: number; target: number};
  loop: {lastTurnAgeMs: number; delayP99Ms: number; elu?: number};
  /** quietAvgMs: the tick's own average ms in quiet windows (EWMA; 0 = not measured yet), which sets the frame budget. */
  tick?: {world: number; service5s: number; p99Ms: number; quietAvgMs: number; lateTotal: number};
  heap: {usedMb: number; limitMb: number; gcPct10s: number; gcSecondsTotal: number};
  level: Level;
  queue?: {depth: number; oldestMs: number};
  souls?: {awake: number; waiting: number; connected: number};
  shed: {reads: number; acts: number};
  /** Stage B: the first read worker's port (the launcher routes C2 reads here); present only with read workers. */
  readPort?: number;
  read?: {ports: number[]; workers: number; lagGens: number; subset: boolean; routes: string[]};
  /** CW3 S2 (present once a 5 s window has closed): CPU and RSS of the whole process; external and arrayBuffers of the main thread only. */
  proc?: {cpuUserSeconds: number; cpuSystemSeconds: number; rssMb: number; externalMb: number; arrayBuffersMb: number};
  /** CW3 S2: full-clock evidence; monoMs is the process-monotonic epoch ms at which `tick.world` was read; state: the clock runs, is paused, or is unavailable. */
  clock?: {adminRate: number; rate: number; pace: number; monoMs: number; state: 'running' | 'paused' | 'unavailable'};
  inventory?: {souls: number; entities?: number; viewers: number};
  activity?: {awakeSoulSeconds: number; connectedSoulSeconds: number; viewerSeconds: number};
  ws?: {opened: number; closed: number; bytesSent: number; bytesReceived: number};
  /** CW3 S2: admission counters by class; present only when in-world admission runs. */
  requests?: Record<ReqClass, Record<ReqOutcome, number>>;
  refused?: Record<ReqClass, Record<ReqCode, number>>;
  latency?: Record<typeof REQ_HISTS[number], Hist>;
  /** CW3 S2: read by the watchdog thread, not the main thread; a value it could not read is absent. */
  disk?: {dbBytes?: number; walBytes?: number; freeBytes?: number};
};

/** The slot of one request counter / refusal counter / histogram. */
export const reqSlot = (cls: ReqClass, outcome: ReqOutcome) => S.req + REQ_CLASSES.indexOf(cls) * REQ_OUTCOMES.length + REQ_OUTCOMES.indexOf(outcome);
export const refusedSlot = (cls: ReqClass, code: ReqCode) => S.refused + REQ_CLASSES.indexOf(cls) * REQ_CODES.length + REQ_CODES.indexOf(code);
export const histSlot = (cls: ReqClass, kind: 'queue' | 'run') => S.hist + REQ_HISTS.indexOf(`${cls}.${kind}`) * HIST_SLOTS;
/** Record one latency (ms) in a histogram: one bucket increment and one addition, no allocation. */
export function observe(a: Float64Array, base: number, ms: number) {
  const s = ms / 1000; if (!(s >= 0)) return;
  let i = 0; while (i < HIST_LE.length && s > HIST_LE[i]) i++;
  a[base + i]++; a[base + HIST_SLOTS - 1] += s;
}
function histOf(a: Float64Array, base: number): Hist {
  const counts: number[] = []; let n = 0;
  for (let i = 0; i <= HIST_LE.length; i++) { n += a[base + i]; counts.push(n); }
  return {le: [...HIST_LE], counts, sum: Math.round(a[base + HIST_SLOTS - 1] * 1e6) / 1e6};
}

/** The routes a read worker answers itself, by mode (S.readMode): what the launcher may route to its port. */
export const READ_ROUTES: Record<number, string[]> = {1: ['here', 'capabilities'], 2: ['here', 'observe', 'capabilities', 'resolve', 'view']};

export const newSharedLoad = () => { const a = new Float64Array(new SharedArrayBuffer(S.size * Float64Array.BYTES_PER_ELEMENT)); a[S.elu] = -1; a[S.entities] = -1; return a; };
/** The process's one shared array (the watchdog gets this buffer). Tests make their own with newSharedLoad(). */
export const sharedLoad = newSharedLoad();
sharedLoad[S.lastTurnAt] = Date.now();
attachBootSlots(sharedLoad, S.boot);   // boot-progress.ts writes phase + replay progress straight into this buffer

const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
/** live.json from the shared numbers (pure: the worker calls it, and so do tests). */
export function liveOf(a: Float64Array, pid: number, now: number, disk?: LiveJson['disk']): LiveJson {
  const bp = readBootProgress(a, S.boot), phase: Phase = bp.phase ?? 'boot:restore', serving = phase === 'serving' || phase === 'stopping';
  const turn = Math.max(a[S.lastTurnAt], a[S.boot + BOOT_SLOT.at] || 0);
  const out: LiveJson = {v: 1, pid, at: now, phase,
    loop: {lastTurnAgeMs: Math.max(0, Math.round(now - turn)), delayP99Ms: Math.round(a[S.loopP99Ms]), ...(a[S.elu] >= 0 ? {elu: r3(a[S.elu])} : {})},
    heap: {usedMb: Math.round(a[S.heapUsedMb]), limitMb: Math.round(a[S.heapLimitMb]), gcPct10s: r1(a[S.gcPct10s]), gcSecondsTotal: r3(a[S.gcMsTotal] / 1000)},
    level: LEVELS[a[S.level]] ?? 'green', shed: {reads: a[S.shedReads], acts: a[S.shedActs]}};
  if (phase.startsWith('boot:')) out.boot = {stage: (bp.boot?.stage ?? 'restore') as BootStage, tick: bp.boot?.tick ?? 0, target: bp.boot?.target ?? 0};
  if (serving) {
    out.tick = {world: a[S.worldTick], service5s: r2(a[S.service5s]), p99Ms: r1(a[S.tickP99Ms]), quietAvgMs: r1(a[S.quietTickMs]), lateTotal: a[S.ticksLateTotal]};
    out.queue = {depth: a[S.queueDepth], oldestMs: Math.round(a[S.queueOldestMs])};
    out.souls = {awake: a[S.awake], waiting: a[S.waiting], connected: a[S.connected]};
    if (a[S.adminRate] > 0) out.clock = {adminRate: a[S.adminRate], rate: a[S.clockRate], pace: a[S.pace], monoMs: Math.round(a[S.tickMonoMs]), state: a[S.clockState] === 1 ? 'paused' : a[S.clockState] === 2 ? 'unavailable' : 'running'};
    out.inventory = {souls: a[S.soulsTotal], ...(a[S.entities] >= 0 ? {entities: a[S.entities]} : {}), viewers: a[S.viewers]};
    out.activity = {awakeSoulSeconds: r1(a[S.awakeSoulSeconds]), connectedSoulSeconds: r1(a[S.connectedSoulSeconds]), viewerSeconds: r1(a[S.viewerSeconds])};
    out.ws = {opened: a[S.wsOpened], closed: a[S.wsClosed], bytesSent: a[S.wsBytesSent], bytesReceived: a[S.wsBytesReceived]};
  }
  if (a[S.procAt] > 0) out.proc = {cpuUserSeconds: r3(a[S.cpuUserMs] / 1000), cpuSystemSeconds: r3(a[S.cpuSysMs] / 1000), rssMb: r1(a[S.rssMb]), externalMb: r1(a[S.externalMb]), arrayBuffersMb: r1(a[S.arrayBuffersMb])};
  if (a[S.reqOn] === 1) {
    const requests = {} as NonNullable<LiveJson['requests']>, refused = {} as NonNullable<LiveJson['refused']>, latency = {} as NonNullable<LiveJson['latency']>;
    for (const c of REQ_CLASSES) {
      requests[c] = Object.fromEntries(REQ_OUTCOMES.map(o => [o, a[reqSlot(c, o)]])) as Record<ReqOutcome, number>;
      refused[c] = Object.fromEntries(REQ_CODES.map(k => [k, a[refusedSlot(c, k)]])) as Record<ReqCode, number>;
      for (const k of ['queue', 'run'] as const) latency[`${c}.${k}`] = histOf(a, histSlot(c, k));
    }
    Object.assign(out, {requests, refused, latency});
  }
  if (disk && Object.keys(disk).length) out.disk = disk;
  const mode = a[S.readMode], ports = [0, 1, 2, 3].map(i => a[S.readPorts + i]).filter(p => p > 0);
  if (mode > 0 && ports.length) {
    out.readPort = ports[0];
    out.read = {ports, workers: a[S.readWorkers], lagGens: a[S.readLagGens], subset: mode === 1, routes: READ_ROUTES[mode] ?? []};
  }
  return out;
}
