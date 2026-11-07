// Stage B (lane B-port): a world's read-worker pool, main-thread side. SIM_READ_WORKER=1 only (main.ts); off, nothing here
// is imported or run. 1–4 worker_threads (split/read-worker.ts, registry `readWorkers`, default 1), each with its own
// loopback HTTP port (SIM_READ_PORTS from the launcher, else one the OS picks), each fed the same WorldInit and then a
// WorldDelta per tick (generation `gen`, one per message). The pool publishes into the watchdog's shared numbers
// (load/shared.ts S.read*), so live.json advertises `readPort` / `read` (LOAD-CONTRACT §4) and the launcher routes C2
// reads there. Per worker: its applied generation in a SharedArrayBuffer (lag = main's gen − the worker's, readable from
// any thread); an `intents` MessagePort into Admission (load/admission.ts admissionPort) for whatever the worker
// cannot answer itself, and token lookups. A worker that exits is started again after `respawnMs` and every worker is
// sent a fresh WorldInit (the delta source is a diff against the last init, so they all restart from the same one).
import {MessageChannel, Worker} from 'node:worker_threads';
import type {Admission} from '../load/admission.ts';
import {admissionPort} from '../load/admission.ts';
import {S} from '../load/shared.ts';
import type {WorldDelta, WorldInit} from './read-model.ts';
import type {Forward, Forwarded, ReadWorkerData, ToWorker} from './read-worker.ts';

export const MAX_READ_WORKERS = 4;
export type ReadPoolOptions = {
  workers: number; ports?: number[]; mode?: number; worldPath: string;
  /** the watchdog's shared numbers (load/shared.ts sharedLoad); the pool writes S.read* and the workers read S.level */
  shared?: Float64Array;
  admission?: Admission;
  /** the world's WorldInit now (the delta source's init: B-delta's world-init.ts when it lands, the spike's DeltaTap now) */
  init: () => WorldInit;
  /** a request a worker forwards, already admitted: run it through the app */
  run: (f: Forward) => Promise<Forwarded>;
  /** a Soul token → its Soul (null: not a Soul of this world) and the opaque account tag for x-sim-account */
  auth: (token: string) => {soulId: string | null; account?: string | null};
  /** B-facade: a worker's verdict misses, to main's pump */
  ask?: (misses: {program: import('@souls/engine-contract').Program; scope: string}[]) => void;
  respawnMs?: number; heapMb?: number; log?: (m: string) => void;
  /** mode 2: the place visits/finds a worker's reads recorded (its database is read-only), for main's ledger to merge */
  writes?: (rows: {soulId: string; placeId: string; k: {visits: number; firstTick: number; lastTick: number; how: 'visited' | 'found'}}[]) => void;
  /** mode 2: the agent inbox block main's middleware adds to a Soul's private answer (inbox-routes.ts: touch, then view) */
  inbox?: (soulId: string) => unknown;
  /** mode 2 (B-facade): the world database and id each worker opens read-only */
  world?: import('./read-worker.ts').ReadWorld;
};
type Slot = {index: number; worker: Worker | null; port: number; alive: boolean; ready: boolean; restarts: number; lastError?: string};

export class ReadPool {
  gen = 0;
  readonly lag = new Float64Array(new SharedArrayBuffer((1 + MAX_READ_WORKERS) * 8));
  readonly slots: Slot[] = [];
  readonly stats = {deltas: 0, inits: 0, resyncs: 0, auths: 0, jobs: [] as {jobs: number; refused: number; dropped: number; failed: number}[]};
  private closing = false; private timer: NodeJS.Timeout | null = null;
  private readonly o: ReadPoolOptions; private readonly n: number; private readonly mode: number;
  constructor(o: ReadPoolOptions) {
    this.o = o; this.n = Math.max(1, Math.min(MAX_READ_WORKERS, Math.floor(o.workers) || 1)); this.mode = o.mode ?? 1;
  }
  get size() { return this.n; }
  start() {
    for (let i = 0; i < this.n; i++) this.slots.push({index: i, worker: null, port: 0, alive: false, ready: false, restarts: 0});
    for (const s of this.slots) this.spawn(s);
    this.reinit();
    // lag and liveness are republished between deltas too (a caught-up worker shows 0; a stopped tick changes nothing)
    this.timer = setInterval(() => this.publish(), 250); this.timer.unref();
    return this;
  }
  private log(m: string) { (this.o.log ?? ((x: string) => console.log(`[read] ${x}`)))(m); }
  private spawn(s: Slot) {
    const ch = new MessageChannel();
    const data: ReadWorkerData = {index: s.index, port: this.o.ports?.[s.index] ?? 0, mode: this.mode, worldPath: this.o.worldPath, lag: this.lag.buffer as SharedArrayBuffer,
      load: this.o.shared?.buffer as SharedArrayBuffer | undefined, intents: ch.port2, ...(this.o.world ? {world: this.o.world} : {})};
    const w = new Worker(new URL('./read-worker.ts', import.meta.url), {workerData: data, transferList: [ch.port2], execArgv: [], resourceLimits: {maxOldGenerationSizeMb: this.o.heapMb ?? (this.mode >= 2 ? 1536 : 512)}});
    s.worker = w; s.alive = true; s.ready = false; s.port = 0; this.lag[1 + s.index] = 0;
    // the worker's intents: token lookups here, jobs into Admission
    ch.port1.on('message', (m: {t: string; id: number; token?: string; soulId?: string}) => {
      if (m.t === 'inbox') {let inbox: unknown = null; try { inbox = this.o.inbox?.(m.soulId ?? '') ?? null; } catch { /* the worker falls back */ } ch.port1.postMessage({t: 'inbox', id: m.id, inbox}); return;}
      if (m.t !== 'auth') return;
      this.stats.auths++;
      let a: {soulId: string | null; account?: string | null} = {soulId: null};
      try { a = this.o.auth(m.token ?? ''); } catch { /* unknown: main answers it */ }
      ch.port1.postMessage({t: 'auth', id: m.id, soulId: a.soulId, account: a.account ?? null});
    });
    this.stats.jobs[s.index] = admissionPort(this.o.admission, ch.port1, async (payload) => {
      const r = await this.o.run(payload as Forward);
      return {result: r, transfer: [r.body]};
    });
    w.on('message', (m: {t: string; port?: number; error?: string; gen?: number}) => {
      if (m.t === 'listening') { s.port = m.port!; this.publish(); this.log(`worker ${s.index} on 127.0.0.1:${s.port}`); }
      else if (m.t === 'ready') { s.ready = true; this.publish(); }
      else if (m.t === 'error') { s.lastError = m.error; this.log(`worker ${s.index}: ${m.error}`); }
      else if (m.t === 'resync') { this.stats.resyncs = (this.stats.resyncs ?? 0) + 1; this.reinit(); }
      else if (m.t === 'writes') this.o.writes?.((m as unknown as {rows: Parameters<NonNullable<ReadPoolOptions['writes']>>[0]}).rows);
      else if (m.t === 'ask') this.o.ask?.((m as unknown as {misses: {program: import('@souls/engine-contract').Program; scope: string}[]}).misses);
    });
    w.on('error', (e) => { s.lastError = e.message; this.log(`worker ${s.index} failed: ${e.message}`); });
    w.once('exit', (code) => {
      s.alive = false; s.ready = false; s.port = 0; s.worker = null; ch.port1.close(); this.publish();
      if (this.closing) return;
      this.log(`worker ${s.index} exited (${code}); again in ${this.o.respawnMs ?? 1000} ms`);
      setTimeout(() => { if (this.closing) return; s.restarts++; this.spawn(s); this.reinit(); }, this.o.respawnMs ?? 1000).unref();
    });
    w.unref();
  }
  private post(m: ToWorker) { for (const s of this.slots) if (s.alive) s.worker!.postMessage(m); }
  /** A fresh WorldInit to every live worker (start, and after a worker came back). */
  reinit() {
    const w = this.o.init(); this.gen++; this.lag[0] = this.gen; this.stats.inits++;
    this.post({t: 'init', gen: this.gen, w}); this.publish();
  }
  /** After a tick: one delta to every live worker. */
  delta(d: WorldDelta) {
    this.gen++; this.lag[0] = this.gen; this.stats.deltas++;
    this.post({t: 'delta', gen: this.gen, d}); this.publish();
  }
  /** Largest gap between main's generation and a live, ready worker's. */
  lagGens() { let m = 0; for (const s of this.slots) if (s.alive && s.ready) m = Math.max(m, this.gen - this.lag[1 + s.index]); return m; }
  private publish() {
    const a = this.o.shared; if (!a || this.closing) return;
    a[S.readMode] = this.mode; let n = 0;
    for (let i = 0; i < MAX_READ_WORKERS; i++) { const s = this.slots[i], up = !!s && s.alive && s.ready && s.port > 0; if (up) n++; a[S.readPorts + i] = up ? s.port : 0; }
    a[S.readWorkers] = n; a[S.readLagGens] = this.lagGens();
  }
  status() { return {mode: this.mode, gen: this.gen, lagGens: this.lagGens(), workers: this.slots.map(s => ({index: s.index, port: s.port, alive: s.alive, ready: s.ready, gen: this.lag[1 + s.index], restarts: s.restarts, ...(s.lastError ? {lastError: s.lastError} : {})}))}; }
  async close() {
    this.closing = true; if (this.timer) clearInterval(this.timer);
    const a = this.o.shared; if (a) { a[S.readMode] = 0; a[S.readWorkers] = 0; a[S.readLagGens] = 0; for (let i = 0; i < MAX_READ_WORKERS; i++) a[S.readPorts + i] = 0; }
    await Promise.all(this.slots.map(s => s.worker?.terminate()));
  }
}

/** SIM_READ_PORTS="5231,5232" → ports (0 for a missing one: the OS picks). */
export function readPorts(env: string | undefined) { return (env ?? '').split(',').map(x => Number(x.trim())).filter(p => Number.isInteger(p) && p > 0 && p < 65536); }

/** The delta source: B-delta's WorldDelta v1 tap (installDeltaStream, after every tick) and WorldInit v1, with B-facade's
 *  `menu` section (split/verdict-pump.ts: action rows, verdicts, menu statics). A resnapshot re-inits every worker;
 *  `ask` takes a worker's verdict misses to main's pump (answered with the next delta). */
export async function deltaSource(host: import('../world.ts').WorldHost, L: import('../edge/ledger/ledger.ts').EdgeLedger, env: NodeJS.ProcessEnv = process.env) {
  const {installDeltaStream} = await import('./delta.ts'), {worldInit} = await import('./world-init.ts');
  const tap = installDeltaStream(host, L, env);
  if (!tap) throw new Error('read pool: the delta stream is off (SIM_READ_WORKER is not 1)');
  const pump = tap.extend as import('./verdict-pump.ts').VerdictPump;
  return {tap, pump, init: () => worldInit(host, L, tap), cost: tap.cost,
    onDelta: (f: (d: WorldDelta) => void, resnapshot: () => void) => tap.subscribe(m => {if ('t' in m) resnapshot(); else f(m);}),
    ask: (misses: {program: import('@souls/engine-contract').Program; scope: string}[]) => pump.ask(misses),
    writes: (rows: Parameters<typeof L.knowledge.merge>[0]) => L.knowledge.merge(rows)};
}
