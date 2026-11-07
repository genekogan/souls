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
  halted: 29,      // 1 once the world's clock has stopped (a fault or a durability failure, #1150): the launcher alerts on it
  // CW3 (#737): series the launcher's /__sim/metrics already mapped but nothing wrote. elu: event-loop utilization of
  // the last closed 5 s window (-1 = no window closed yet); gcMsTotal: GC pause ms since the process started (never
  // reset, so a scrape sees every pause); ticksLateTotal: ticks whose own run took longer than their 50 ms budget.
  elu: 30, gcMsTotal: 31, ticksLateTotal: 32,
  size: 33,
} as const;

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
  /** The world's clock has stopped; present only then (#1150). */
  halted?: true;
};

/** The routes a read worker answers itself, by mode (S.readMode): what the launcher may route to its port. */
export const READ_ROUTES: Record<number, string[]> = {1: ['here', 'capabilities'], 2: ['here', 'observe', 'capabilities', 'resolve', 'view']};

export const newSharedLoad = () => { const a = new Float64Array(new SharedArrayBuffer(S.size * Float64Array.BYTES_PER_ELEMENT)); a[S.elu] = -1; return a; };
/** The process's one shared array (the watchdog gets this buffer). Tests make their own with newSharedLoad(). */
export const sharedLoad = newSharedLoad();
sharedLoad[S.lastTurnAt] = Date.now();
attachBootSlots(sharedLoad, S.boot);   // boot-progress.ts writes phase + replay progress straight into this buffer

const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
/** live.json from the shared numbers (pure: the worker calls it, and so do tests). */
export function liveOf(a: Float64Array, pid: number, now: number): LiveJson {
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
  }
  const mode = a[S.readMode], ports = [0, 1, 2, 3].map(i => a[S.readPorts + i]).filter(p => p > 0);
  if (mode > 0 && ports.length) {
    out.readPort = ports[0];
    out.read = {ports, workers: a[S.readWorkers], lagGens: a[S.readLagGens], subset: mode === 1, routes: READ_ROUTES[mode] ?? []};
  }
  if (a[S.halted]) out.halted = true;
  return out;
}
