import { publicAuthEnvironment } from './clerk-public-env.mjs';
// World processes behind the launcher: one `apps/server/src/main.ts` per world on
// a free port from a private range, edge minds (no server thinking), dev auth, its own data dir.
// Crashed and wedged children restart with full-jitter backoff, held after too many failures; a stop is final.
// Lane L1 (LOAD-CONTRACT §4): running worlds are watched (guard()), boots are judged by progress, not a deadline.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cgroupHeadroomMb, memAvailableMb, PREWARM_MB, prewarmBlocked, rotateLog } from './production.mjs';
import { SLUG_RE, worldIdOf } from './registry.mjs';
import { GUARD, bootMark, jitterMs, liveWedge, readLive } from './guard.mjs';
const STRIP_HOOK = 'apps/server/src/strip-cache.mjs'; // lane BOOT2 (defaultCommand)

/** Printed by a world process started with SIM_STANDBY=1 once its code is loaded (apps/server/src/standby.ts). */
export const STANDBY_MARK = '[standby] ready';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** `p`, or undefined after `ms` (the timer does not outlive it). */
const within = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t)); };
/** Restart wait after the n-th failure in a row: full jitter, 1 s base, 5 min cap (guard.mjs). */
/** The exit code of a world that asks to be restarted (apps/server main.ts: black for 60 s, snapshot saved): no backoff. */
export const PLANNED_EXIT = 75;
export const backoffMs = (n, random = Math.random, g = GUARD) => jitterMs(n, g, random);

/** True when nothing listens on 127.0.0.1:port (we can bind it ourselves). */
export function portFree(port) {
  return new Promise((yes) => {
    const s = createServer();
    s.once('error', () => yes(false));
    s.listen(port, '127.0.0.1', () => s.close(() => yes(true)));
  });
}

export class ChildPool {
  /**
   * @param {{ root: string, range: [number, number], logDir: string, marsWebDir?: string, publicOrigin: string,
   *           command?: (w: object, port: number) => { cmd: string, args: string[], env?: object },
   *           healthPath?: (slug: string) => string, onChange?: (slug: string) => void, pidFile?: string, idleMs?: number,
   *           maxRunning?: number, minFreeMb?: number, busy?: (slug: string) => boolean,
   *           decorate?: (c: { cmd: string, args: string[], env?: object }, world: object) => { cmd: string, args: string[], env?: object },
   *           soulCliFile?: string | null, soulControllerCliFile?: string | null, soulSkillFile?: string | null, soulInstructionsFile?: string | null }} o
   * maxRunning / minFreeMb: before a world boots, idle worlds are put to sleep until it fits; when none can sleep the
   * boot is refused (error.code 'capacity'). busy(slug): a world with live viewers is never put to sleep.
   * stopGraceMs: how long stop() waits after SIGTERM before SIGKILL (10 s; tests shorten it).
   * sleepMs (lane P3): freezeIdle() freezes a world nobody asked anything for that long (see there); 0/absent: never.
   * exitMs (lane SLEEP): releaseIdle() lets a world frozen that long more exit, giving its memory back (see there).
   * guard (lane L1): overrides of guard.mjs GUARD (tests); random: the backoff's jitter source (tests).
   */
  constructor(o) {
    this.o = o;
    this.kids = new Map();   // slug → state
    this.closing = false;
    /** Handed over to a newer launcher (keeper.mjs): no world of this pool may start or restart again. */
    this.fenced = false;
    this.gate = null; this.inflight = new Map();   // boot promise -> its kid
    this.g = { ...GUARD, ...(o.guard ?? {}) }; this.random = o.random ?? Math.random; this.guardTimer = null;
    this.log = o.log ?? (() => {});
    mkdirSync(o.logDir, { recursive: true });
  }

  // ---------- handover between launcher generations (keeper.mjs; lane C4 downtime)
  /** A world still run by the previous launcher (its child, its port): proxied to as is until takeOver(). Never booted,
   *  stopped, put to sleep or restarted by this pool while adopted, so its database has exactly one writer. */
  adopt(world, { port, pid, script, healthPort, readPorts }) {
    // its watchdog port (lane L1) stays held here too: the next process keeps it (the old one is gone before the new
    // one's watchdog listens), and no other world of this launcher may take it meanwhile
    this.kids.set(world.slug, { slug: world.slug, world, restarts: 0, crashes: 0, status: 'running', port, ...(Number.isInteger(healthPort) ? { healthPort } : {}), ...(Array.isArray(readPorts) && readPorts.length ? { readPorts: readPorts.filter(Number.isInteger) } : {}), child: null, adopted: { pid, script }, upSince: Date.now(), lastExit: null, ready: null, stopped: false, lastUsed: Date.now() });
    this.savePids();
  }
  /** Take an adopted world over: `release(slug)` makes the previous launcher stop it (snapshot saved, process gone);
   *  then it boots here on the same data. Requests that arrive meanwhile wait on `ready` instead of failing. */
  async takeOver(slug, release, { timeoutMs = 180_000, goneMs = 15_000 } = {}) {
    const k = this.kids.get(slug);
    if (!k?.adopted) return k?.port ?? null;
    // pre-warm: the next process loads its code while the previous one still serves (no database, no port yet); until
    // it is ready the world stays 'running' on the old process, so visitors' requests do not wait for the warm-up
    // ...only with memory for a second process of this world beside the first; otherwise it boots cold, as before
    const noRoom = this.o.prewarm ? prewarmBlocked(this.o.minFreeMb ?? 0) : null;
    if (noRoom) k.lastWarm = { ok: false, error: `cold: ${noRoom}` };
    const warm = !this.o.prewarm || noRoom ? null : await this.standby(k).catch((e) => { k.lastWarm = { ok: false, error: e.message }; return null; });
    k.status = 'handover'; this.o.onChange?.(slug);
    const prev = k.adopted.pid;
    k.ready = (async () => {
      k.pauseStart = Date.now();   // from here the world does not answer until the new process does
      // the previous process must be gone, not only released: while its pid lives it holds the data dir (edge-server.lock)
      // and the next one refuses to open it (3.53: a release SIGKILLed after 10 s and answered before the exit)
      try { await release(slug); await this.gone(slug, prev, goneMs); k.releaseMs = Date.now() - k.pauseStart; }
      catch (e) { warm?.child.kill('SIGTERM'); k.status = 'failed'; k.lastError = `handover: ${e.message}`; this.o.onChange?.(slug); throw e; }
      k.adopted = null; this.savePids();
      if (this.closing || this.fenced) { warm?.child.kill('SIGTERM'); k.status = 'stopped'; throw new Error(`world ${slug}: this launcher is closing`); }
      if (warm && warm.child.exitCode === null && warm.child.signalCode === null) {
        k.status = 'starting'; k.port = warm.port; k.asleep = false; this.attach(k, warm);
        warm.child.kill('SIGUSR2');   // open the data and the port now
        const run = this.healthy(k, warm, timeoutMs);
        this.inflight.set(run, k); run.then(() => this.inflight.delete(run), () => this.inflight.delete(run));
        return run;
      }
      return this.boot(k, timeoutMs);   // no standby process (old release, or it failed): a cold boot, as before
    })().finally(() => { k.ready = null; });
    return k.ready;
  }
  /** Resolves once process `pid` no longer exists (polled); throws after `ms`. */
  async gone(slug, pid, ms) {
    if (!Number.isInteger(pid)) return;
    const t0 = Date.now();
    for (;;) {
      try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return; }   // EPERM: alive, someone else's
      if (Date.now() - t0 >= ms) throw new Error(`previous process of ${slug} (pid ${pid}) still running ${Math.round((Date.now() - t0) / 1000)} s after its release`);
      await sleep(25);
    }
  }
  /** Start the world's next process in standby (SIM_STANDBY=1, apps/server/src/standby.ts) on its current port, which
   *  is free again once the previous process is released; resolves when it reports its code loaded. */
  async standby(k, timeoutMs = 60_000) {
    // an adopted world keeps its watchdog port: the standby process opens it only after its go, when the previous
    // process is gone (takeOver awaits gone()); a world that had none gets one if the range has room
    if (!k.healthPort) k.healthPort = await this.pickHealthPort(k, k.port);
    if (!k.readPorts?.length) await this.pickReadPorts(k, k.port);
    const t0 = Date.now(), run = this.launch(k, k.port, { SIM_STANDBY: '1' }, { rotate: false });
    await new Promise((yes, no) => {
      let buf = '';
      const t = setTimeout(() => done(new Error(`no standby mark in ${timeoutMs / 1000}s`)), timeoutMs);
      const onData = (d) => { buf = (buf + d).slice(-4096); if (buf.includes(STANDBY_MARK)) done(null); };
      const onExit = () => done(new Error('exited while loading'));
      const done = (e) => { clearTimeout(t); run.child.stdout.off('data', onData); run.child.off('exit', onExit); if (e) { run.child.kill('SIGKILL'); no(e); } else yes(); };
      run.child.stdout.on('data', onData); run.child.once('exit', onExit);
    });
    k.lastWarm = { ok: true, ms: Date.now() - t0 };
    return run;
  }
  /** Preparing a handover: hold every new boot at the gate (unpause() lets them go on; fence() refuses them). */
  pause() { if (!this.gate) { let open; const p = new Promise((r) => { open = r; }); this.gate = { p, open }; } }
  unpause() { const g = this.gate; this.gate = null; g?.open(); }
  /** Boots already past the gate (spawned), settled: after pause() nothing new starts, so the running set is final.
   *  A boot still going after `waitMs` (a world stuck booting: R389/R390 held the keeper's 60 s prepare for its 90 s boot
   *  timeout) is abandoned instead: it never served, so its process is killed, and that process must be seen to exit
   *  within `goneMs`, else this throws (closure unproven: no handover, one writer). Resolves with the abandoned boots. */
  async settled({ waitMs = Infinity, goneMs = 5_000, still = () => true } = {}) {
    const runs = [...this.inflight.keys()];   // only boots already past the gate; `still()` false: the prepare was given up
    let timer; const all = Promise.allSettled(runs).then(() => true);
    const done = Number.isFinite(waitMs) ? await Promise.race([all, new Promise((r) => { timer = setTimeout(() => r(false), waitMs); })]).finally(() => clearTimeout(timer)) : await all;
    if (!done && still()) {
      const stuck = runs.filter((r) => this.inflight.has(r)).map((r) => this.inflight.get(r)), out = [];
      for (const k of stuck) {
        k.stopped = true; k.abandoned = true;   // spawnAndWait / healthy() stop here; nothing launches after this
        out.push({ slug: k.slug, pid: k.child?.pid ?? null, status: k.status });
        k.child?.kill('SIGKILL');
      }
      const deadline = Date.now() + goneMs;
      const pending = () => runs.some((r) => this.inflight.has(r));
      while ((pending() || stuck.some((k) => k.child)) && Date.now() < deadline) await sleep(25);
      const left = stuck.filter((k) => k.child);
      if (pending() || left.length) throw new Error(`boot(s) of ${stuck.map((k) => k.slug).join(', ')} still running ${goneMs / 1000} s after being stopped${left.length ? ` (pid ${left.map((k) => k.child.pid).join(', ')})` : ''}: their data may still be open`);
      for (const k of stuck) { k.abandoned = false; k.lastError = `abandoned: still booting after ${waitMs / 1000} s when a handover was prepared`; }
      return out.map((b) => ({ ...b, error: this.kids.get(b.slug)?.lastError }));
    }
    return [];
  }
  /** After a handover: refuse every start and restart; children that exit stay stopped. */
  fence() { this.fenced = true; for (const k of this.kids.values()) if (k.timer) { clearTimeout(k.timer); k.timer = null; } this.unpause(); }
  /** This pool's canary failed (keeper.mjs hands back to the previous launcher): the world is never started here again
   *  and the pid file is the previous launcher's alone. */
  handBack(slug) { const k = this.kids.get(slug); if (k) k.handedBack = true; this.o.pidFile = null; }
  /** The next launcher's canary failed (keeper.mjs): this pool runs its worlds again. */
  unfence() { this.fenced = false; }
  /** The running children, for the next launcher to adopt. */
  handoverList() { for (const k of this.kids.values()) this.thaw(k); return [...this.kids.values()].filter((k) => k.child && k.status === 'running').map((k) => ({ slug: k.slug, port: k.port, pid: k.child.pid, script: k.script, ...(k.healthPort ? { healthPort: k.healthPort } : {}), ...(k.readPorts?.length ? { readPorts: k.readPorts } : {}) })); }

  /** Children a previous launcher left running (it was killed hard): stop them before anyone opens their databases again. */
  async reapOrphans() {
    if (!this.o.pidFile || !existsSync(this.o.pidFile)) return [];
    let rec = {}; try { rec = JSON.parse(readFileSync(this.o.pidFile, 'utf8')); } catch { return []; }
    const reaped = [];
    for (const [slug, { pid, script }] of Object.entries(rec)) {
      if (!Number.isInteger(pid) || pid === process.pid) continue;
      let cmdline = '';
      try { process.kill(pid, 0); cmdline = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }); } catch { continue; }
      if (!script || !cmdline.includes(script)) continue;   // the pid was reused by something else: leave it alone
      try { process.kill(pid, 'SIGCONT'); process.kill(pid, 'SIGTERM'); } catch { continue; }   // (a frozen orphan saves only once thawed)
      for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch { break; } await sleep(100); }
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      reaped.push({ slug, pid });
    }
    this.savePids();
    return reaped;
  }
  savePids() {
    if (!this.o.pidFile) return;
    const rec = {};
    for (const k of this.kids.values()) if (k.child?.pid) rec[k.slug] = { pid: k.child.pid, port: k.port, script: k.script, ...(k.healthPort ? { healthPort: k.healthPort } : {}), ...(k.readPorts?.length ? { readPorts: k.readPorts } : {}) }; else if (k.adopted?.pid) rec[k.slug] = { pid: k.adopted.pid, port: k.port, script: k.adopted.script, ...(k.healthPort ? { healthPort: k.healthPort } : {}), ...(k.readPorts?.length ? { readPorts: k.readPorts } : {}) };
    const tmp = `${this.o.pidFile}.${process.pid}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n'); renameSync(tmp, this.o.pidFile); } catch { /* best effort */ }
  }
  /** Put the least recently used idle world to sleep to free a port (it wakes on its next visit). */
  async evictIdle(except) {
    const idleMs = this.o.idleMs ?? 60_000, now = Date.now();
    const victim = [...this.kids.values()].filter((k) => k.slug !== except && k.status === 'running' && !k.adopted && now - (k.lastUsed ?? 0) > idleMs && !this.o.busy?.(k.slug)).sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0))[0];
    if (!victim) return null;
    await this.stop(victim.slug);
    victim.asleep = true;
    return victim.slug;
  }
  /** Freeze idle worlds (lane P3, 2026-10-19): a running world nobody has asked anything for `sleepMs`, with no viewer
   *  and nothing in flight (busy), is stopped in place (SIGSTOP): no CPU at all, its memory and port kept, its clock
   *  stopped (world time does not pass while it sleeps, as across a restart). The next request thaws it at once
   *  (ensure), so waking costs nothing like a boot (Eden 2026 boots in ~8 s). Memory still comes back the old way:
   *  makeRoom() evicts the least recently used idle world, frozen or not, when a boot needs room. */
  freezeIdle(now = Date.now()) {
    const ms = this.o.sleepMs ?? 0;
    if (!(ms > 0) || this.closing || this.fenced || this.gate) return [];
    const frozen = [];
    for (const k of this.kids.values()) {
      if (k.frozen || k.status !== 'running' || !k.child || k.adopted || k.ready || k.stopped || now - (k.lastUsed ?? 0) < ms || this.o.busy?.(k.slug)) continue;
      try { k.child.kill('SIGSTOP'); } catch { continue; }
      k.frozen = true; k.frozenAt = now; frozen.push(k.slug); this.o.onChange?.(k.slug);
    }
    return frozen;
  }
  /** Give memory back (lane SLEEP, 2026-10-21): a world asleep (frozen) for `exitMs` more after it fell asleep (nobody
   *  asked anything for sleepMs + exitMs), still with no viewer and nothing in flight, is stopped: it saves its snapshot
   *  and its process exits, so its memory and its slot under maxRunning are free. Its next request cold-boots it from that
   *  snapshot (the same state), as for a world evicted under memory pressure. A world booted only for a passive read
   *  (a health check) falls asleep and exits again at once, its last use unchanged. Old-engine forks never exit here
   *  (their boot is far slower and monitors read them every 5 min) unless exitForks is set. */
  async releaseIdle(now = Date.now()) {
    const ms = this.o.exitMs ?? 0, sleepMs = this.o.sleepMs ?? 0;
    if (!(ms > 0) || !(sleepMs > 0) || this.closing || this.fenced || this.gate) return [];
    const due = [...this.kids.values()].filter((k) => k.frozen && k.status === 'running' && k.child && !k.adopted && !k.ready && !k.stopped && !k.stopping
      && (this.o.exitForks || !k.world?.fork) && now - (k.lastUsed ?? 0) >= sleepMs + ms && !this.o.busy?.(k.slug));
    const released = [];
    for (const k of due) {
      if (this.closing || this.fenced || this.gate || !k.frozen || this.o.busy?.(k.slug)) continue;
      const c = k.child;
      await this.stop(k.slug);
      if (c.exitCode === null && c.signalCode === null) continue;
      released.push(k.slug);
      if (k.status === 'stopped') { k.asleep = true; this.o.onChange?.(k.slug); }   // (else a request already woke it again)
    }
    return released;
  }
  /** Wake a frozen world (SIGCONT); it counts as just used unless `use` is false (a passive read: it may sleep again soon). */
  thaw(k, { use = true } = {}) {
    if (!k?.frozen) return;
    k.frozen = false; k.frozenAt = null; k.thawedAt = Date.now(); if (use) k.lastUsed = Date.now();
    try { k.child?.kill('SIGCONT'); } catch { /* gone */ }
    this.o.onChange?.(k.slug);
  }
  state(slug) { return this.kids.get(slug) ?? null; }
  status(slug) {
    const k = this.kids.get(slug);
    if (!k) return { status: 'stopped' };
    return { status: k.frozen || (k.asleep && k.status === 'stopped') ? 'asleep' : k.status, ...(k.frozen ? { frozen: true } : {}), port: k.port, pid: k.child?.pid ?? k.adopted?.pid ?? null, ...(k.adopted ? { adopted: true } : {}), restarts: k.restarts, upSince: k.upSince, lastExit: k.lastExit,
      ...(k.restartsBy ? { restartsByReason: { ...k.restartsBy } } : {}), ...(k.lastBootMs != null ? { lastBootMs: k.lastBootMs } : {}), ...(k.readPorts?.length ? { readPorts: [...k.readPorts] } : {}), ...(k.healthPort ? { healthPort: k.healthPort } : k.noHealthPort ? { watchdog: 'none: live.json + main /healthz' } : {}), ...(k.held ? { held: { ...k.held } } : {}), ...(k.wedging ? { wedging: { ...k.wedging } } : {}),
      ...(k.boot && (k.status === 'starting' || k.status === 'handover') ? { boot: { ...k.boot } } : {}), ...(k.nextTryAt && k.status === 'restarting' ? { nextTryAt: k.nextTryAt } : {}),
      ...(k.live ? { level: k.live.level ?? null } : {}), ...(k.rampFrom && k.status === 'running' ? { rampFrom: k.rampFrom } : {}) };
  }
  /** Ports held by live or (re)starting children; a sleeping world's old port is free for anyone. */
  usedPorts(except) { return new Set([...this.kids.values()].filter((k) => k.slug !== except && (k.child || k.adopted || k.status === 'starting' || k.status === 'restarting' || k.status === 'handover')).flatMap((k) => [k.port, k.healthPort, ...(k.readPorts ?? [])]).filter(Boolean)); }
  /** The world's watchdog port (SIM_HEALTH_PORT, LOAD-CONTRACT §4; healthPorts option): a second port from the range,
   *  searched from its top so it does not take the port a world prefers; none free: the world runs without one. */
  async pickHealthPort(k, mainPort) {
    if (!this.o.healthPorts) return null;
    const [lo, hi] = this.o.range, used = this.usedPorts(k.slug);
    const prefer = k.healthPort && k.healthPort !== mainPort && !used.has(k.healthPort) ? [k.healthPort] : [];
    for (const p of [...prefer, ...Array.from({ length: hi - lo + 1 }, (_, i) => hi - i)]) if (p !== mainPort && !used.has(p) && await portFree(p)) { k.noHealthPort = false; return p; }
    if (!k.noHealthPort) this.log(`world ${k.slug}: no free watchdog port in ${lo}-${hi}; liveness from live.json and the main /healthz only`);
    k.noHealthPort = true; return null;
  }
  /** Stage B (lane B-port): the world's read-worker ports (SIM_READ_PORTS), one per worker, when its read workers are on
   *  (readWorkers option: SIM_READ_WORKER=1 or the registry's `readWorkers`); searched from the range's top past the
   *  watchdog port, as pickHealthPort. Fewer free than workers: the rest listen where the OS puts them (live.json says). */
  async pickReadPorts(k, mainPort) {
    const n = this.o.readWorkers?.(k.world) ?? 0;
    if (!n) { k.readPorts = null; return null; }
    const [lo, hi] = this.o.range, used = this.usedPorts(k.slug), out = [];
    const prefer = (k.readPorts ?? []).filter((p) => p >= lo && p <= hi);
    for (const p of [...prefer, ...Array.from({ length: hi - lo + 1 }, (_, i) => hi - i)]) {
      if (out.length >= n) break;
      if (p !== mainPort && p !== k.healthPort && !used.has(p) && !out.includes(p) && await portFree(p)) out.push(p);
    }
    if (out.length < n) this.log(`world ${k.slug}: ${out.length} of ${n} read-worker ports free in ${lo}-${hi}; the rest on ports the OS picks`);
    k.readPorts = out; return out;
  }
  /** The read-worker env of a world's next process (nothing at all while its read workers are off: flag off = as before).
   *  SIM_READ_MODE: 2 (B-facade: the worker runs the read code itself) unless the launcher runs with SIM_READ_MODE=1 (the
   *  spike's subset, whose answers are not main's frames); children never inherit the launcher's env, so it is set here. */
  readEnv(k) {
    const n = this.o.readWorkers?.(k.world) ?? 0;
    return n ? { SIM_READ_WORKER: '1', SIM_READ_WORKERS: String(n), SIM_READ_MODE: process.env.SIM_READ_MODE === '1' ? '1' : '2', ...(k.readPorts?.length ? { SIM_READ_PORTS: k.readPorts.join(',') } : {}) } : {};
  }
  async pickPort(prefer, self) {
    const [lo, hi] = this.o.range, used = this.usedPorts(self);
    if (prefer && prefer >= lo && prefer <= hi && !used.has(prefer) && await portFree(prefer)) return prefer;
    for (let p = lo; p <= hi; p++) if (!used.has(p) && await portFree(p)) return p;
    throw new Error(`no free port in ${lo}–${hi}`);
  }

  /** Start (or join the start of) a world; resolves with its port once /healthz answers. */
  ensure(world, { timeoutMs = 90_000, passive = false } = {}) {
    if (this.fenced) { const e = new Error(`world ${world.slug} is served by a newer launcher`); e.code = 'handed-over'; return Promise.reject(e); }
    // closing (closeAll): nothing boots again, e.g. a long-poll's GET retried after its world was stopped under it would
    // otherwise start a world no one stops (lane srv-shed, found with 100 listens open at close)
    if (this.closing) { const e = new Error(`world ${world.slug}: this launcher is closing`); e.code = 'stopping'; return Promise.reject(e); }
    let k = this.kids.get(world.slug);
    if (k?.handedBack) { const e = new Error(`world ${world.slug} is going back to the previous launcher`); e.code = 'handed-back'; return Promise.reject(e); }
    // being stopped (put to sleep, its memory given back): boot it again only once that process is gone (one writer)
    if (k?.stopping) return k.stopping.then(() => { if (this.closing) { const e = new Error(`world ${world.slug} is stopping`); e.code = 'stopping'; throw e; } return this.ensure(world, { timeoutMs, passive }); });
    if (k && !passive) k.lastUsed = Date.now();
    if (k?.frozen) this.thaw(k, { use: !passive });
    if (k && (k.status === 'running')) return Promise.resolve(k.port);
    // held (lane L1 breaker): too many failures in a row; nothing restarts it but an operator's resume()
    if (k?.held) { const e = new Error(`world ${world.slug} is resting after ${k.held.failures} failures in ${Math.round(this.g.breakerWindowMs / 60_000)} min (last: ${k.held.reason}); an operator resumes it`); e.code = 'held'; return Promise.reject(e); }
    if (k?.ready) return this.waitFor(k.ready, timeoutMs, world.slug);
    // adopted but its handover failed: the previous launcher may still hold its database, so it is never started here
    if (k?.adopted) { const e = new Error(`world ${world.slug} could not be taken over from the previous launcher${k.lastError ? `: ${k.lastError}` : ''}`); e.code = 'handover-failed'; return Promise.reject(e); }
    k = k ?? { slug: world.slug, world, restarts: 0, crashes: 0, status: 'starting', port: null, child: null, upSince: null, lastExit: null, ready: null, stopped: false, lastUsed: Date.now() };
    k.world = world; k.stopped = false; k.abandoned = false;
    this.kids.set(world.slug, k);
    // restarting after failures in a row: the visitor waits for the scheduled try, so traffic cannot defeat the backoff;
    // after a single crash someone waiting restarts it now, as before
    if (k.timer && k.crashes > 1) return this.waitFor(k.pending.p, timeoutMs, world.slug);
    if (k.timer) { clearTimeout(k.timer); k.timer = null; }
    k.ready = this.boot(k, timeoutMs).finally(() => { k.ready = null; });
    // a boot a visitor started fails: not retried here (the next visit tries again), but it counts toward the breaker,
    // so a world that cannot boot is held instead of booted by every visit
    k.ready.catch((e) => { if (!['capacity', 'handed-over', 'stopping'].includes(e.code) && !k.stopped && !this.closing && !this.fenced) this.noteFailure(k, e.reason ?? 'boot'); });
    this.settlePending(k, k.ready);
    return this.waitFor(k.ready, timeoutMs, world.slug);
  }
  /** The caller's own wait for a boot (ensure's timeoutMs): past it the caller is refused (code 'starting'), and the boot
   *  itself goes on, judged by its progress (healthy()). */
  waitFor(p, ms, slug) {
    if (!(ms > 0) || !Number.isFinite(ms)) return p;
    let t;
    const late = new Promise((_, no) => { t = setTimeout(() => { const e = new Error(`world ${slug} is still starting after ${Math.round(ms / 1000)} s`); e.code = 'starting'; no(e); }, ms); t.unref?.(); });
    return Promise.race([p, late]).finally(() => clearTimeout(t));
  }
  /** Callers waiting on a scheduled restart get that boot (or its refusal). */
  settlePending(k, v) { const w = k.pending; if (!w) return; k.pending = null; w.resolve(v instanceof Error ? Promise.reject(v) : v); }

  /** Live (or booting) children other than `except`. */
  running(except) { return [...this.kids.values()].filter((k) => k.slug !== except && (k.child || k.adopted || k.status === 'starting' || k.status === 'restarting' || k.status === 'handover')).length; }
  /** Make room for one more world under the running cap and the free-memory floor, sleeping idle worlds if needed. */
  async makeRoom(slug) {
    const { maxRunning = Infinity, minFreeMb = 0 } = this.o;
    for (;;) {
      // low: the host under its floor, or (lane P3) the unit within one world of its own MemoryHigh/Max: the worlds share
      // the unit's cgroup (production 8G/9G), which fills long before the host does, and over MemoryMax a world is killed
      const room = minFreeMb > 0 ? (this.o.unitRoom ?? cgroupHeadroomMb)() : null;
      const full = this.running(slug) >= maxRunning, low = minFreeMb > 0 && (memAvailableMb() < minFreeMb || (room !== null && room < (this.o.unitFloorMb ?? PREWARM_MB)));
      if (!full && !low) return;
      if (!(await this.evictIdle(slug))) {
        const e = new Error(full ? `all ${maxRunning} world slots are in use; try again in a minute` : `the server is low on memory (under ${minFreeMb} MB free, or ${room ?? '?'} MB under the unit's limit); try again in a minute`);
        e.code = 'capacity'; throw e;
      }
      await sleep(200);   // the sleeper's memory takes a moment to come back
    }
  }

  async boot(k, timeoutMs) {
    while (this.gate) await this.gate.p;
    if (this.fenced) { k.status = 'stopped'; const e = new Error(`world ${k.slug} is served by a newer launcher`); e.code = 'handed-over'; throw e; }
    const run = this.spawnAndWait(k, timeoutMs);
    this.inflight.set(run, k); run.then(() => this.inflight.delete(run), () => this.inflight.delete(run));
    return run;
  }
  async spawnAndWait(k, timeoutMs) {
    k.status = 'starting'; this.o.onChange?.(k.slug);
    try { await this.makeRoom(k.slug); } catch (e) { k.status = 'failed'; this.o.onChange?.(k.slug); throw e; }
    let port;
    try { port = await this.pickPort(k.port ?? k.world.port, k.slug); }
    catch (e) {
      if (!(await this.evictIdle(k.slug))) throw e;
      for (let i = 0; ; i++) { try { port = await this.pickPort(k.port ?? k.world.port, k.slug); break; } catch (again) { if (i >= 50) throw again; await sleep(100); } }  // the sleeper's socket takes a moment to close
    }
    k.port = port; k.asleep = false; k.healthPort = await this.pickHealthPort(k, port); await this.pickReadPorts(k, port);
    if (k.abandoned) { k.status = 'failed'; this.o.onChange?.(k.slug); throw new Error(`world ${k.slug}: boot abandoned for a handover`); }
    const run = this.launch(k, port);
    this.attach(k, run);
    return this.healthy(k, run, timeoutMs);
  }
  /** Spawn one world process on `port` (its log appended to the world's log file); not yet the world's child. */
  launch(k, port, extraEnv = {}, { rotate = true } = {}) {
    const base = (this.o.command ?? defaultCommand)(k.world, port, this.o);
    const { cmd, args, env } = this.o.decorate ? this.o.decorate(base, k.world) : base;
    const logFile = join(this.o.logDir, `${k.slug}.log`);
    if (rotate) rotateLog(logFile);
    const log = createWriteStream(logFile, { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} start ${k.slug} on :${port} (restart ${k.restarts})${extraEnv.SIM_STANDBY ? ' standby' : ''}\n`);
    const child = spawn(cmd, args, { cwd: this.o.root, env: { ...env, ...(k.healthPort ? { SIM_HEALTH_PORT: String(k.healthPort) } : {}), ...this.readEnv(k), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    const run = { child, port, script: args.find((a) => !a.startsWith('-')) ?? args[0], exited: false };
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    // a boot's progress, when the world writes no live.json: its output (healthy())
    const out = () => { run.lastOutputAt = Date.now(); }; child.stdout.on('data', out); child.stderr.on('data', out);
    child.once('exit', (code, signal) => { run.exited = true; log.end(`--- exit ${code ?? signal}\n`); this.onExit(k, child, code, signal); });
    child.once('error', (e) => { log.write(`--- spawn error ${e.message}\n`); });
    return run;
  }
  /** The process becomes this world's child (crash restarts, stop, pid file). */
  attach(k, run) { k.child = run.child; k.script = run.script; this.savePids(); }
  /** Resolve with the port once the world answers /healthz; a process that exits fails the boot. There is no deadline
   *  (lane L1, LOAD-CONTRACT §4): a boot is killed only when its progress has not moved for bootStallMs: live.json's boot
   *  stage/tick when the world writes one, else its output or its 503 body (then silentBootStallMs). A slow replay that
   *  keeps moving lives; each kill used to throw its progress away (10-24: 8 SIGKILLs in a row). */
  async healthy(k, run) {
    const { child, port } = run, g = this.g;
    const health = `http://127.0.0.1:${port}${(this.o.healthPath ?? ((s) => `/w/${s}/healthz`))(k.slug)}`;
    const liveFile = k.world?.dataDir ? join(k.world.dataDir, 'live.json') : null;
    const t0 = Date.now(); let mark = null, movedAt = t0, sawLive = false;
    k.boot = { since: t0, movedAt: t0, stage: null, tick: null, target: null };
    while (!run.exited && !k.stopped) {
      let body = null;
      try {
        const r = await fetch(health, { signal: AbortSignal.timeout(1500) });
        if (r.ok) {
          k.status = 'running'; k.upSince = Date.now(); k.lastBootMs = k.upSince - t0; k.boot = null; k.health = { fails: 0, okAt: k.upSince };
          k.rampFrom = k.restartBoot ? k.upSince : null; k.restartBoot = false;   // after a restart: the proxy's admission ramp
          if (k.lastBootMs > g.bootSlowMs) this.log(`world ${k.slug} booted in ${Math.round(k.lastBootMs / 1000)} s`);
          this.o.onChange?.(k.slug); return port;
        }
        body = r.status === 503 ? (await r.text()).slice(0, 256) : null;
      } catch { /* booting */ }
      const live = liveFile ? readLive(liveFile, child.pid) : null, now = Date.now();
      if (live) sawLive = true;
      const m = bootMark(live, run.lastOutputAt, body);
      if (m !== mark) { mark = m; movedAt = now; }
      k.boot = { since: t0, movedAt, stage: live?.boot?.stage ?? live?.phase ?? null, tick: live?.boot?.tick ?? null, target: live?.boot?.target ?? null };
      if (now - movedAt > (sawLive ? g.bootStallMs : g.silentBootStallMs)) break;
      await sleep(now - t0 < 5_000 ? 25 : 250);   // (P5: 25 ms while a visitor may be waiting on a fast boot)
    }
    const stalled = !run.exited && !k.stopped, since = Math.round((Date.now() - k.boot.movedAt) / 1000);
    if (!run.exited) child.kill('SIGKILL');
    k.status = 'failed'; k.boot = null; this.o.onChange?.(k.slug);
    const e = new Error(run.exited ? `world ${k.slug} exited while booting (see ${join(this.o.logDir, k.slug + '.log')})` : stalled ? `world ${k.slug} boot made no progress for ${since} s (killed ${Math.round((Date.now() - t0) / 1000)} s into it)` : `world ${k.slug}: boot stopped`);
    e.reason = stalled ? 'boot-stalled' : 'boot';
    if (stalled) this.log(e.message);
    throw e;
  }

  onExit(k, child, code, signal) {
    if (k.child !== child) return;
    const wedged = k.wedging; k.wedging = null;
    k.child = null; k.frozen = false; k.lastExit = { code, signal, at: Date.now(), ...(wedged ? { reason: `wedged: ${wedged.reason}` } : {}) }; this.savePids();
    if (this.closing || k.stopped || this.fenced) { k.status = 'stopped'; this.o.onChange?.(k.slug); return; }
    if (k.status === 'starting') return;  // boot() reports it (to ensure()'s caller, or to the restart loop)
    // exit 75 (LOAD-CONTRACT §4): the world asked for a planned restart (black too long; its snapshot is saved): at once
    const planned = !wedged && code === PLANNED_EXIT;
    this.log(`world ${k.slug} exited (${code ?? signal})${wedged ? ` after it was found wedged: ${wedged.reason}` : planned ? ': a planned restart' : ''}`);
    this.scheduleRestart(k, wedged ? 'wedged' : planned ? 'planned' : 'exit');
  }
  /** A crash, a wedge or a failed restart (lane L1): restart after a full-jitter backoff (1 s base, 5 min cap; the count
   *  resets after 10 min healthy). breakerN failures within breakerWindowMs: held, no more restarts until resume().
   *  A refusal for capacity (no memory or slot) is retried the same way but is not the world's failure. */
  scheduleRestart(k, reason = 'exit') {
    const g = this.g, now = Date.now();
    if (k.upSince && now - k.upSince > g.resetAfterMs) k.crashes = 0;
    k.upSince = null;
    if (reason === 'wedged') k.lastWedge = { at: now, reason: k.lastExit?.reason ?? 'wedged' };
    if (reason !== 'capacity' && reason !== 'planned' && this.noteFailure(k, reason)) return;
    const wait = reason === 'planned' ? 0 : backoffMs(k.crashes++, this.random, g);
    k.restartsBy = { ...(k.restartsBy ?? {}), [reason]: (k.restartsBy?.[reason] ?? 0) + 1 };
    k.status = 'restarting'; k.restarts++; k.nextTryAt = now + wait; this.o.onChange?.(k.slug);
    this.log(`world ${k.slug} restarts in ${(wait / 1000).toFixed(1)} s (${reason}; failure ${k.failures?.length ?? 0} of ${g.breakerN} in ${Math.round(g.breakerWindowMs / 60_000)} min)`);
    if (!k.pending) { let resolve; const p = new Promise((r) => { resolve = r; }); p.catch(() => {}); k.pending = { p, resolve }; }
    if (k.timer) clearTimeout(k.timer);
    k.timer = setTimeout(() => {
      k.timer = null;
      if (this.closing || k.stopped || this.fenced) { this.settlePending(k, Object.assign(new Error(`world ${k.slug} was stopped`), { code: 'stopping' })); return; }
      k.restartBoot = true; k.ready = this.boot(k).finally(() => { k.ready = null; });
      k.ready.catch((e) => { k.lastError = e.message; if (!this.closing && !k.stopped && !this.fenced) this.scheduleRestart(k, e.code === 'capacity' ? 'capacity' : e.reason ?? 'boot'); });
      this.settlePending(k, k.ready);
    }, wait);
  }
  /** One failure (crash, failed boot, wedge) into the breaker's window; true when it tripped (the world is now held). */
  noteFailure(k, reason) {
    const g = this.g, now = Date.now();
    k.failures = [...(k.failures ?? []).filter((t) => now - t < g.breakerWindowMs), now];
    if (k.failures.length < g.breakerN) return false;
    this.hold(k, reason); return true;
  }
  /** The breaker (lane L1): no more restarts; host-health shows it; resume() (op resume-world, the health page) ends it. */
  hold(k, reason) {
    if (k.timer) { clearTimeout(k.timer); k.timer = null; }
    k.held = { at: Date.now(), reason, failures: k.failures?.length ?? 0 };
    k.status = 'held'; k.nextTryAt = null; this.o.onChange?.(k.slug);
    const e = new Error(`world ${k.slug} is resting after ${k.held.failures} failures (last: ${reason})`); e.code = 'held';
    this.settlePending(k, e);
    this.log(`world ${k.slug} held: ${k.held.failures} failures in ${Math.round(this.g.breakerWindowMs / 60_000)} min (last: ${reason}); no more restarts until an operator resumes it`);
  }
  /** End a hold: the failure count starts again; the next request (or the caller's ensure) boots it. */
  resume(slug) {
    const k = this.kids.get(slug);
    if (!k?.held) return false;
    this.log(`world ${slug} resumed (was held since ${new Date(k.held.at).toISOString()}: ${k.held.reason})`);
    k.held = null; k.failures = []; k.crashes = 0; k.status = 'stopped'; this.o.onChange?.(slug);
    return true;
  }

  // ---------- the guard over running worlds (lane L1, LOAD-CONTRACT §4)
  /** Look at every running world every pollMs (the launcher starts this; tests may call guard() themselves). */
  startGuard() { if (this.guardTimer) return; this.guardTimer = setInterval(() => { void this.guard(); }, this.g.pollMs); this.guardTimer.unref?.(); }
  stopGuard() { if (this.guardTimer) clearInterval(this.guardTimer); this.guardTimer = null; }
  async guard() {
    if (this.closing || this.fenced || this.gate) return;   // (a handover being prepared owns the processes)
    await Promise.all([...this.kids.values()].map((k) => this.look(k)));
  }
  /** One look at a running world: /healthz answered at all within timeoutMs (any status: it is not stuck), and its
   *  live.json when it writes one. failures looks in a row, or a stale live.json: wedged. */
  async look(k) {
    const c = k.child, g = this.g;
    if (!c || k.status !== 'running' || k.frozen || k.adopted || k.ready || k.stopped || k.stopping || k.wedging || k.looking) return;
    k.looking = true;
    try {
      const { ok, why: said } = await this.ask(k);
      if (k.child !== c || k.status !== 'running' || k.frozen || k.stopped || k.stopping || this.closing || this.fenced || this.gate) return;   // changed meanwhile
      const now = Date.now(), h = k.health ?? (k.health = { fails: 0, okAt: null });
      if (ok) { h.fails = 0; h.okAt = now; } else h.fails++;
      k.live = k.world?.dataDir ? readLive(join(k.world.dataDir, 'live.json'), c.pid) : null;
      if (said) h.said = said; else if (ok) h.said = null;
      const why = this.liveWhy(k, now) ?? (h.fails >= g.failures ? `${h.said ?? '/healthz unanswered'} ${h.fails} times in a row` : null);
      if (why) void this.wedge(k, why);
    } finally { k.looking = false; }
  }
  /** Is the world stuck? Its watchdog thread's /healthz (SIM_HEALTH_PORT) when it has one: 200 = fine, 503 while serving
   *  = the main thread is stuck (it answers from another thread), no answer = the whole process is. Refused there (a
   *  release without the watchdog, or SIM_WATCHDOG=0): the main /healthz, where any answer at all counts as alive. */
  async ask(k) {
    const g = this.g;
    if (k.healthPort) {
      try {
        const r = await fetch(`http://127.0.0.1:${k.healthPort}/healthz`, { signal: AbortSignal.timeout(g.timeoutMs) });
        const b = await r.json().catch(() => null);
        if (r.ok || (b?.phase && b.phase !== 'serving')) return { ok: true };   // (stopping, or a boot phase: not judged here)
        return { ok: false, why: `watchdog: main thread stuck ${Math.round((b?.loop?.lastTurnAgeMs ?? 0) / 1000)} s` };
      } catch (e) {
        if (e?.cause?.code !== 'ECONNREFUSED') return { ok: false, why: 'watchdog unanswered' };
      }
    }
    try { const r = await fetch(`http://127.0.0.1:${k.port}${(this.o.healthPath ?? ((s) => `/w/${s}/healthz`))(k.slug)}`, { signal: AbortSignal.timeout(g.timeoutMs) }); await r.arrayBuffer().catch(() => {}); return { ok: true }; }
    catch { return { ok: false, why: '/healthz unanswered' }; }
  }
  /** live.json's verdict, once the world has been up (or awake again after a freeze) long enough to have written one. */
  liveWhy(k, now = Date.now()) {
    if (!k.live || now - Math.max(k.upSince ?? 0, k.thawedAt ?? 0) < this.g.liveStaleMs) return null;
    return liveWedge(k.live, now, this.g);
  }
  /** Wedged: SIGUSR2 (the world's diagnostic report; it may ignore it), then SIGTERM, then SIGKILL; onExit restarts it. */
  async wedge(k, why) {
    const c = k.child, g = this.g;
    if (!c || k.wedging) return;
    k.wedging = { reason: why, at: Date.now() }; this.o.onChange?.(k.slug);
    this.log(`world ${k.slug} wedged (${why}): SIGUSR2, SIGTERM after ${g.usr2WaitMs / 1000} s, SIGKILL ${g.termGraceMs / 1000} s later`);
    const exited = () => c.exitCode !== null || c.signalCode !== null;
    const exit = exited() ? Promise.resolve() : new Promise((r) => c.once('exit', r));
    try { c.kill('SIGUSR2'); } catch { /* gone */ }
    await within(exit, g.usr2WaitMs);
    if (!exited()) { this.log(`world ${k.slug} still running after SIGUSR2: SIGTERM`); try { c.kill('SIGTERM'); } catch { /* gone */ } await within(exit, g.termGraceMs); }
    if (!exited()) { this.log(`world ${k.slug} still running after SIGTERM: SIGKILL`); try { c.kill('SIGKILL'); } catch { /* gone */ } }
  }
  /** What host-health and /__sim/healthz show (LOAD-CONTRACT §4): wedged, held, crashloop, bootSlow. */
  problems(now = Date.now()) {
    const g = this.g, out = [], s = (ms) => `${Math.round(ms / 1000)} s`;
    for (const k of this.kids.values()) {
      const recent = (k.failures ?? []).filter((t) => now - t < g.breakerWindowMs).length;
      if (k.held) out.push({ slug: k.slug, code: 'held', text: `${k.slug} held since ${new Date(k.held.at).toISOString()} after ${k.held.failures} failures (last: ${k.held.reason}); resume: op.mjs resume-world --slug ${k.slug}` });
      else if (recent >= g.crashloopN) out.push({ slug: k.slug, code: 'crashloop', text: `${k.slug} failed ${recent} times in ${Math.round(g.breakerWindowMs / 60_000)} min (${k.status})` });
      const suspect = k.status === 'running' && !k.frozen && ((k.health?.fails ?? 0) >= g.suspectFailures ? `${k.health.said ?? '/healthz unanswered'} (${k.health.fails} looks in a row)` : this.liveWhy(k, now));
      if (k.wedging) out.push({ slug: k.slug, code: 'wedged', text: `${k.slug} wedged (${k.wedging.reason}) ${s(now - k.wedging.at)} ago; being restarted` });
      else if (suspect) out.push({ slug: k.slug, code: 'wedged', text: `${k.slug} not answering: ${suspect}` });
      else if (k.lastWedge && now - k.lastWedge.at < g.wedgeShownMs) out.push({ slug: k.slug, code: 'wedged', text: `${k.slug} was wedged ${s(now - k.lastWedge.at)} ago (${k.lastWedge.reason}); restarted` });
      if (k.status === 'starting' && k.boot && now - k.boot.since > g.bootSlowMs) out.push({ slug: k.slug, code: 'bootSlow', text: `${k.slug} booting for ${s(now - k.boot.since)}${k.boot.stage ? ` (${k.boot.stage}${k.boot.tick != null ? ` ${k.boot.tick}${k.boot.target ? `/${k.boot.target}` : ''}` : ''})` : ''}; last progress ${s(now - k.boot.movedAt)} ago` });
    }
    return out;
  }

  async stop(slug) {
    const k = this.kids.get(slug); if (!k) return;
    if (k.adopted) return;   // the previous launcher's child: only it stops it (handover release)
    if (k.stopping) return k.stopping;
    k.stopped = true; if (k.timer) { clearTimeout(k.timer); k.timer = null; }
    this.settlePending(k, Object.assign(new Error(`world ${slug} was stopped`), { code: 'stopping' }));
    const c = k.child; if (!c) { if (!k.held) k.status = 'stopped'; return; }
    k.stopping = this.stopChild(k, c).finally(() => { k.stopping = null; });
    return k.stopping;
  }
  async stopChild(k, c) {
    this.thaw(k, { use: false });   // a frozen world handles SIGTERM (saves its snapshot) only once it runs again; not a use
    c.kill('SIGTERM');
    const exited = () => c.exitCode !== null || c.signalCode !== null;
    const exit = exited() ? Promise.resolve() : new Promise((r) => c.once('exit', r));
    await within(exit, this.o.stopGraceMs ?? 10_000);
    // ...and the stop is over only once the process is gone (a handover's next process waits for it: the data-dir lock)
    if (!exited()) { c.kill('SIGKILL'); await within(exit, 5_000); }
    k.status = 'stopped';
  }
  async closeAll() { this.closing = true; this.stopGuard(); await Promise.all([...this.kids.keys()].map((s) => this.stop(s))); }
}

export const EYES_ENV = ['EDGE_EYES', 'EDGE_EYES_GPU', 'EDGE_EYES_SOUL_SECONDS', 'EDGE_EYES_GLOBAL_PER_MINUTE', 'EDGE_EYES_TIMEOUT_SECONDS', 'EDGE_EYES_RELOAD_HOURS', 'EDGE_EYES_NICE', 'EDGE_EYES_CPUS', 'EDGE_EYES_CHROME_ARGS', 'PLAYWRIGHT_BROWSERS_PATH', 'SIM_RENDER_LOCK_DIR', 'GOD_LOOK_CHROME', 'EDEN_GOD_GL'];

/** Launcher-only exact world allowlist; the server still checks its own viewer URL and world path.
 *  Unset keeps the legacy env bytes. Empty disables all; enabling members requires EDGE_EYES=world.
 *  Explicit off wins, and excluded children get off so --env-file cannot enable them. */
function eyesEnv(slug) {
  const env = Object.fromEntries(EYES_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  const raw = process.env.EDGE_EYES_WORLDS;
  if (raw === undefined) return env;
  const tokens = raw.trim() === '' ? [] : raw.split(',').map((s) => s.trim());
  if (tokens.some((s) => !SLUG_RE.test(s))) throw new Error('EDGE_EYES_WORLDS must be comma-separated exact world slugs');
  const worlds = new Set(tokens);
  if (env.EDGE_EYES === 'off' || worlds.size === 0) return { ...env, EDGE_EYES: 'off' };
  if (env.EDGE_EYES && env.EDGE_EYES !== 'world') throw new Error('EDGE_EYES_WORLDS with a nonempty list requires EDGE_EYES=world or off; explicit viewer URLs are ambiguous');
  return { ...env, EDGE_EYES: env.EDGE_EYES === 'world' && worlds.has(slug) ? 'world' : 'off' };
}

/** The Sim server for one entity world (same env as tools/god-skill/dev-world.mjs).
 *  With `o.auth.envFile` (Clerk, production sign-in) the child reads its Clerk settings from that file by path
 *  (`node --env-file`); dev auth is off and every world shares one account registry, so a person is the same
 *  account in every world. Settings set here win over the file. */
export function defaultCommand(world, port, o) {
  const marsWeb = o.marsWebDir ? resolve(o.marsWebDir) : null;
  const clerk = o.auth?.envFile ? o.auth : null;
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
    // fake minds and no model keys: $0 model spend, always
    ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '', BRAIN_MODE: 'fake',
    WORLD_KEY: world.worldKey ?? world.slug, WORLD_ID: worldIdOf(world), WORLD_SLUG: world.slug, WORLD_NAME: world.name ?? '', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1',
    DEV_AUTH: clerk ? '0' : '1', SEED_NATIVES: '0', DATA_DIR: world.dataDir, PUBLIC_URL: o.publicOrigin, ENABLE_WORLD_ENGINE: '1',
    WORLD_PATH: `/w/${world.slug}`,
    // #717: every world of this launcher shares one body-collection store (membership and attribution; bytes stay per world)
    ...(world.bodyCollectionPath ? { BODY_COLLECTION_PATH: world.bodyCollectionPath } : {}),
    // The launcher verifies signed-in creators before genesis, then confirms the same principal by claiming.
    ...(clerk ? { ...publicAuthEnvironment(clerk), AUTH_PROVIDER: 'clerk', ACCOUNT_AUTH_REQUIRED: '1', ACCOUNT_REGISTRY_PATH: clerk.registryPath, CLERK_SATELLITE_DOMAIN: clerk.satellite?.domain ?? '', CLERK_SIGN_IN_URL: clerk.satellite?.signInUrl ?? '', INVITE_REQUIRED: '0', WORLD_OWNER_ID: '' } : {}),
    // Verified creator or loopback operator account only; user JSON cannot supply this value.
    ...(world.bornOwner ? { WORLD_OWNER_ID: world.bornOwner } : {}),
    // anyone signed in may join as a Soul under dev sign-in too (Clerk sets it above; edge minds: config default + production)
    ...(clerk ? {} : { INVITE_REQUIRED: '0' }),
    // Native Soul arrival/removal (lifecycle), so a Soul is made exactly as on the live worlds: the agent's create-soul,
    // and under Clerk the human's approval of it (main's accounts/). Lane P2.
    SOUL_LIFECYCLE: '1',
    // Souls fade and are lifted up after an hour without an action (green → yellow → red → beam-up), as on /w/eden (R4-LIVE)
    EDGE_FADING: '1',
    // Nobody watching or acting here for 30 s: the clock runs at a quarter of its wall pace (apps/server/src/attention.ts)
    SIM_UNWATCHED_PACE: process.env.SIM_UNWATCHED_PACE ?? '0.25',
    // Eyes (apps/server/src/edge/eyes): a Soul's first-person picture. Off unless the launcher's own environment sets EDGE_EYES
    // (`world` = each world renders its own public page), optionally scoped by EDGE_EYES_WORLDS. The browser path,
    // GPU mode, budgets and nice level come with it; the allowlist itself is not a server setting.
    ...eyesEnv(world.slug),
    // measurement only (lane SLEEP): log the engine state hash at boot and at stop
    ...(process.env.SIM_BOOT_HASH === '1' ? { SIM_BOOT_HASH: '1' } : {}),
    // Soul mode of the world's one skill (/SKILL.md) points at Codex's Soul skill (/skill.md) and CLI (/eden-agent.mjs),
    // served as is from the published files when the launcher is given them (--soul-skill, --soul-cli).
    ...(o.soulSkillFile && existsSync(o.soulSkillFile) ? { EDGE_SKILL_FILE: resolve(o.soulSkillFile) } : {}),
    ...(o.soulCliFile && existsSync(o.soulCliFile) ? { EDGE_CLI_FILE: resolve(o.soulCliFile) } : {}),
    ...(o.soulControllerCliFile && existsSync(o.soulControllerCliFile) ? { EDGE_CONTROLLER_CLI_FILE: resolve(o.soulControllerCliFile) } : {}),
    ...(o.soulInstructionsFile && existsSync(o.soulInstructionsFile) ? { EDGE_INSTRUCTIONS_FILE: resolve(o.soulInstructionsFile) } : {}),
    ...(marsWeb && existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}),
    ...(world.templateFile ? { GENESIS_FILE: world.templateFile } : {}),
    // Travel between worlds (M3): the launcher's loopback relay and this run's site key (docs/sim/TRAVEL.md)
    ...(o.site?.url && o.site?.key ? { SIM_SITE_URL: o.site.url, SIM_SITE_KEY: o.site.key } : {}),
    // M4 shared library: one directory per launcher, <data>/library (Gene 2026-10-16 default)
    ...(o.libraryDir ? { SIM_LIBRARY_DIR: o.libraryDir } : {}),
    // Y4b co-builder tokens: off unless the launcher runs with --cobuilders (one god per world, Gene 2026-10-16)
    ...(o.cobuilders ? { SIM_COBUILDERS: '1' } : {}),
    // Lane P5: V8's compile cache for this release's code (compileCacheDir): a world boots with ~0.4 s less CPU
    ...(o.compileCache ? { NODE_COMPILE_CACHE: o.compileCache } : {}),
  };
  // Lane BOOT2: with the compile cache, the server's TypeScript is stripped once per build, not on every boot (strip-cache.mjs).
  // The hook is imported only when the release the world runs from (its cwd, o.root) ships it, so a release without it still boots.
  const strip = o.compileCache && existsSync(join(o.root ?? '.', STRIP_HOOK));
  return { cmd: process.execPath, args: [...(clerk ? [`--env-file=${resolve(clerk.envFile)}`] : []), ...(strip ? ['--import', `./${STRIP_HOOK}`] : []), 'apps/server/src/main.ts'], env };
}

/** A fork of an old world (launcher op register-fork; tools/world-launcher/fork-world.mjs): main's old-world entry points
 *  under the launcher's base, Clerk with the forks' own account registry (the old worlds' accounts, so their Souls keep
 *  their owners), no world-engine flag (config.worldEngine stays off for the old keys), fake brain, no model keys. */
export function forkCommand(world, port, o) {
  const marsWeb = o.marsWebDir ? resolve(o.marsWebDir) : null;
  const clerk = o.auth?.envFile ? o.auth : null;
  if (!clerk) throw new Error(`fork ${world.slug}: forks sign in with Clerk; start the launcher with --auth-env`);
  if (!world.fork?.descriptor || !world.fork?.accounts) throw new Error(`fork ${world.slug}: descriptor and account registry required`);
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
    ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge',
    WORLD_KEY: world.slug, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: world.dataDir, PUBLIC_URL: o.publicOrigin,
    ...publicAuthEnvironment(clerk), WORLD_PATH: `/w/${world.slug}`, DEV_AUTH: '0', AUTH_PROVIDER: 'clerk', ACCOUNT_AUTH_REQUIRED: '1', ACCOUNT_REGISTRY_PATH: world.fork.accounts, CLERK_SATELLITE_DOMAIN: clerk.satellite?.domain ?? '', CLERK_SIGN_IN_URL: clerk.satellite?.signInUrl ?? '',
    SIM_FORK: world.slug,
    ...(o.compileCache ? { NODE_COMPILE_CACHE: o.compileCache } : {}),
    ...(o.soulCliFile && existsSync(o.soulCliFile) ? { EDGE_CLI_FILE: resolve(o.soulCliFile) } : {}),
    ...(o.soulControllerCliFile && existsSync(o.soulControllerCliFile) ? { EDGE_CONTROLLER_CLI_FILE: resolve(o.soulControllerCliFile) } : {}),
    ...(marsWeb && existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}),
  };
  return { cmd: process.execPath, args: [`--env-file=${resolve(clerk.envFile)}`, '--experimental-transform-types', 'tools/world-launcher/fork-world.mjs', world.fork.descriptor], env };
}

/** Lane P5: the directory for world processes' V8 compile cache (NODE_COMPILE_CACHE), one per build under
 *  `<data>/compile-cache` (the only place a world process may write, besides its own data). Node checks each entry against
 *  the source it was made from, so a stale entry is only a miss. Other builds' directories untouched for a day are dropped
 *  (a release handover still finds the previous build's). Null when it cannot be made: worlds then boot as before. */
export function compileCacheDir(dataDir, build, now = Date.now()) {
  const root = join(dataDir, 'compile-cache'), dir = join(root, String(build).replace(/[^\w.-]+/g, '_') || 'dev');
  try {
    mkdirSync(dir, { recursive: true });
    for (const d of readdirSync(root)) {
      const p = join(root, d);
      if (p !== dir && now - statSync(p).mtimeMs > 86_400_000) rmSync(p, { recursive: true, force: true });
    }
    return dir;
  } catch { return null; }
}

