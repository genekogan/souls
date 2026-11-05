// LOAD-CONTRACT §2–§3: in-world admission. Heavy requests (C1 writes, C2 personal reads) no longer run straight from
// the HTTP callback: they queue, and a dispatcher runs them between ticks within a frame budget, writes before reads,
// the god's work holding a reserved quarter. One heavy request in flight per Soul (`soul.busy`); a per-Soul CPU-ms
// bucket under contention (`soul.slow-down`); a job whose deadline passes is answered `world.busy` unrun, and a job
// whose client went away is dropped. It queues, delays and refuses; it never chooses or retries an act for a Soul.
import {createHash} from 'node:crypto';
import type {Context, MiddlewareHandler} from 'hono';
import {histSlot, observe, refusedSlot, reqSlot, S, sharedLoad, type Level, type ReqCode, type ReqOutcome} from './shared.ts';
import {crowdedNote} from './waking.ts';

export type Cls = 'C0' | 'C1' | 'C2' | 'C3';
export type RouteClass = {cls: Cls; id: string; god: boolean; deadlineMs: number};
export type Refusal = {status: 429 | 503; code: 'soul.busy' | 'soul.slow-down' | 'world.busy'; retryAfterS: number; message: string};

const C1_MS = 20_000, GOD_C1_MS = 30_000, C2_MS = 8_000;
const EDGE_READ = /^\/v1\/edge\/(here|observe|capabilities|view|objects(?:\/[^/]+)?)$/;
const EDGE_WRITE = /^\/v1\/edge\/(act|say|converse|objects\/[^/]+\/act|plan(?:\/[^/]+)?)$/;
const PUBLIC = /^\/v1\/(?:edge\/(?:map|rides|items|platforms)|world\/snapshot)$/;
const GOD_READ = /^\/v1\/god\/(mirror|doctor|trace|recommend|layers|layers\/zone-suggest|defs\/unused)$/;
const GOD_FREE = /^\/v1\/god\/(?:pair\/|claim$|answer$|inbox\/|pray$|assets$|visitors$)/;   // auth flows, uploads, Souls' prayers
/** The request class of a route (§2); null = not admitted here (passes straight through). Paths are world-relative. */
export function classify(method: string, path: string): RouteClass | null {
  if (path === '/healthz' || path === '/v1/config') return {cls: 'C0', id: path, god: false, deadlineMs: 0};
  if (PUBLIC.test(path)) return method === 'GET' ? {cls: 'C3', id: path, god: false, deadlineMs: 0} : null;
  let m: RegExpExecArray | null;
  if (path.startsWith('/v1/edge/')) {
    // `around` explores: it records the places found and invalidates menus (around.ts), so it is a write (C1), not a read
    if (method === 'GET' && path === '/v1/edge/around') return {cls: 'C1', id: 'edge:around', god: false, deadlineMs: C1_MS};
    if (method === 'GET' && (m = EDGE_READ.exec(path))) return {cls: 'C2', id: 'edge:' + m[1].replace(/\/.*/, '/:id'), god: false, deadlineMs: C2_MS};
    if (method === 'POST' && path === '/v1/edge/resolve') return {cls: 'C2', id: 'edge:resolve', god: false, deadlineMs: C2_MS};
    if (method !== 'GET' && (m = EDGE_WRITE.exec(path))) return {cls: 'C1', id: 'edge:' + m[1].replace(/\/[^/]+/, '/:id'), god: false, deadlineMs: C1_MS};
    return null;
  }
  if (path.startsWith('/v1/god/')) {
    if (method === 'GET' && (m = GOD_READ.exec(path))) return {cls: 'C2', id: 'god:' + m[1], god: true, deadlineMs: C2_MS};
    if (method === 'POST' && path === '/v1/god/query') return {cls: 'C2', id: 'god:query', god: true, deadlineMs: C2_MS};
    if (method !== 'GET' && !GOD_FREE.test(path)) return {cls: 'C1', id: 'god:' + path.slice(8).replace(/\/[0-9a-z_-]{8,}(?=\/|$)/gi, '/:id'), god: true, deadlineMs: GOD_C1_MS};
    return null;
  }
  return null;
}

/** Dial values (LOAD-CONTRACT §1, §2b). Frame budget: request ms per 50 ms frame. These are the caps (tuned on the laptop);
 *  the budget a world gets is calibrated to what its own tick leaves of the frame (frameBudgetMs below). */
export const FRAME_BUDGET_MS: Record<Level, number> = {green: 25, amber: 15, red: 8, black: 0};
/** Share of the frame's slack (50 ms − the quiet tick) the requests may take, by level (lane srv-admission-calib). */
export const FRAME_SLACK_K: Record<Level, number> = {green: 0.6, amber: 0.4, red: 0.2, black: 0};
/** Floor, so a world whose quiet tick nearly fills the frame still answers (slowly) rather than never. */
export const FRAME_BUDGET_FLOOR_MS: Record<Level, number> = {green: 2, amber: 1, red: 0.5, black: 0};
export const FRAME_MS = 50;
/** The calibrated frame budget: min(cap, max(floor, k × max(0, 50 − quietTickMs))). quietTickMs = the monitor's EWMA of
 *  the tick's own ms in quiet windows (monitor.ts QuietTick; 0 = not measured yet → the caps). Production (tick 12 ms):
 *  22.8/15/7.6/0; a box ticking at 35 ms: 9/6/3/0; the laptop (tick ≤ 8 ms): 25/15/8/0. */
export function frameBudgetMs(level: Level, quietTickMs: number): number {
  const cap = FRAME_BUDGET_MS[level];
  if (!(quietTickMs > 0) || !Number.isFinite(quietTickMs)) return cap;
  return Math.min(cap, Math.max(FRAME_BUDGET_FLOOR_MS[level], FRAME_SLACK_K[level] * Math.max(0, FRAME_MS - quietTickMs)));
}
/** The god's bucket (the reserve, unchanged): 25 % of the green cap's throughput × this multiplier by level. The Souls'
 *  refill has the level folded into the frame budget instead (refillPerS). */
export const GOD_REFILL_X: Record<Level, number> = {green: 1, amber: 0.5, red: 0.25, black: 0.25};
export const SOUL_REFILL_MAX_PER_S = 200;
const COOL_MS = 60_000, CAPACITY_MS = 2000, GOD_SHARE = 0.25, DEFAULT_EST_MS = 20, ANSWER_MARGIN_MS = 250, ACTIVE_MS = 60_000;

type Job = {key: string; god: boolean; route: RouteClass; arrival: number; deadline: number; closed: () => boolean;
  settle: (v: 'run' | 'dropped' | Refusal) => void; finished: Promise<void>; finish: () => void};
type Bucket = {tokens: number; at: number; seen: number};
type Strikes = {slow: number[]; busy: number[]; coolUntil: number; retryUntil: number};
/** Socket-independent (Stage B): a job is (key = Soul or god, class, deadline, `closed()` = "has the asker gone", and the
 *  ticket as its reply handle). The HTTP middleware below is one front end; a worker's MessagePort can be another. */
export type Ticket = {refusal: Refusal} | {turn: Promise<'run' | 'dropped' | Refusal>; done: () => void; waitedMs: () => number};

export type AdmissionOpts = {now?: () => number; yieldTurn?: () => Promise<void>;
  /** The quiet tick ms (default: the monitor's, from the process's shared numbers, S.quietTickMs). */
  quietTickMs?: () => number;
  /** Where the request counters go (CW3 S2; default: the process's shared numbers). */
  shared?: Float64Array};
export class Admission {
  level: Level = 'green';
  readonly queue: Job[] = [];
  readonly outstanding = new Set<string>();
  readonly shed = {reads: 0, acts: 0, busy: 0, slow: 0, dropped: 0, cooled: 0};
  /** Monotonic measured request ms (the monitor's quiet-window test). */
  spentMs = 0;
  private buckets = new Map<string, Bucket>();
  private est = new Map<string, number>();
  /** World-total request time (LOAD-CONTRACT §2b): credit accrues at budget/50 ms per ms, capped at one frame's
   *  budget, and every job's measured time is debited, so a job longer than the budget is paid back by the frames
   *  after it. Whatever the sum of the per-Soul budgets, requests never take more than budget/50 of the thread. */
  private credit = FRAME_BUDGET_MS.green; private creditAt = 0;
  /** Per principal: strike times, the cool-down's end, and when the Retry-After it was last given elapses (retryUntil). */
  private strikes = new Map<string, Strikes>();
  private share = {god: 0, souls: 0};   // decaying ms spent, for the god's reserve
  private draining = false; private wake: NodeJS.Timeout | null = null; private soon: NodeJS.Immediate | null = null; private sweeper: NodeJS.Timeout | null = null;
  private now: () => number;
  private o: AdmissionOpts;
  private quietTick: () => number;
  /** CW3 S2: the request counters and latency histograms (shared.ts REQ_*), plain increments into the shared numbers. */
  readonly tel: Float64Array;
  constructor(o: AdmissionOpts = {}) { this.o = o; this.now = o.now ?? (() => performance.now()); this.quietTick = o.quietTickMs ?? (() => sharedLoad[S.quietTickMs]); this.tel = o.shared ?? sharedLoad; this.tel[S.reqOn] = 1; }
  /** Count one request outcome (C2 = read, C1 = act; other classes are not admitted and not counted). */
  count(cls: Cls, outcome: ReqOutcome) { if (cls === 'C1' || cls === 'C2') this.tel[reqSlot(cls === 'C2' ? 'read' : 'act', outcome)]++; }
  refusedAs(cls: Cls, code: ReqCode) { if (cls === 'C1' || cls === 'C2') this.tel[refusedSlot(cls === 'C2' ? 'read' : 'act', code)]++; }
  /** One latency sample: queue = arrival to start, run = start to answer. */
  timed(cls: Cls, kind: 'queue' | 'run', ms: number) { if (cls === 'C1' || cls === 'C2') observe(this.tel, histSlot(cls === 'C2' ? 'read' : 'act', kind), ms); }
  /** The outcome of a request that ran, by the status it was answered with. */
  answered(cls: Cls, status: number, ranMs: number) { this.count(cls, status >= 500 ? 'failed' : status >= 400 ? 'rejected' : 'completed'); this.timed(cls, 'run', ranMs); }
  /** This level's frame budget (request ms per 50 ms frame), calibrated from the measured quiet tick (frameBudgetMs). */
  frameBudget(level: Level = this.level) { return frameBudgetMs(level, this.quietTick()); }

  /** Load dial (LOAD-CONTRACT §1): frame budget (frameBudgetMs, at most 25/15/8/0 ms) and bucket refill ×1/×0.5/×0.25/×0.25. */
  setLoadLevel(level: Level) { this.level = level; this.kick(); }
  queueStats() { const now = this.now(); let oldest = 0; for (const j of this.queue) oldest = Math.max(oldest, now - j.arrival); return {depth: this.queue.length, oldestMs: Math.round(oldest)}; }
  /** Principals (Souls + god) with a heavy request in the last minute: the `awake` of the refill formula. */
  active() { const now = this.now(); let n = 0; for (const b of this.buckets.values()) if (now - b.seen < ACTIVE_MS) n++; return Math.max(1, n); }
  estimate(id: string) { return this.est.get(id) ?? DEFAULT_EST_MS; }
  /** Refill of one principal's bucket, ms per s. A Soul: min(200, 20 × frameBudget / awake), so the Souls' buckets together
   *  refill at the frame budget's own throughput (20 frames/s × budget ms) and a crowd never earns more than the dispatcher
   *  can serve (srv-admission-calib: the old 500/awake × {1, .5, .25} was the laptop's green budget at every box). The god:
   *  the reserve, 25 % of the green cap × GOD_REFILL_X (unchanged). */
  refillPerS(god = false) { return god ? 1000 * GOD_SHARE * FRAME_BUDGET_MS.green / FRAME_MS * GOD_REFILL_X[this.level] : Math.min(SOUL_REFILL_MAX_PER_S, (1000 / FRAME_MS) * this.frameBudget() / this.active()); }
  private refill(god: boolean) { return this.refillPerS(god) / 1000; }
  private bucket(key: string, god: boolean, now: number) {
    let b = this.buckets.get(key);
    if (!b) { b = {tokens: CAPACITY_MS, at: now, seen: now}; this.buckets.set(key, b); }
    b.tokens = Math.min(CAPACITY_MS, b.tokens + (now - b.at) * this.refill(god)); b.at = now;
    if (this.buckets.size > 4096) for (const [k, x] of this.buckets) if (now - x.seen > ACTIVE_MS && k !== key) this.buckets.delete(k);
    return b;
  }
  /** Budgets bind when someone else is waiting or in flight, or the world is red/black: one Soul alone in a calm
   *  world is never slowed (no quiet-case regression), and a crowd shares the request time fairly. */
  private contended(key: string) {
    if (this.level === 'red' || this.level === 'black') return true;
    for (const k of this.outstanding) if (k !== key) return true;
    return false;
  }

  request(r: {key: string; god: boolean; route: RouteClass; hintMs?: number; closed?: () => boolean}): Ticket {
    const now = this.now(), read = r.route.cls === 'C2';
    const cool = this.cooling(r.key, now);
    if (cool) { this.shed.slow++; if (read) this.shed.reads++; else this.shed.acts++; return {refusal: {status: 429, code: 'soul.slow-down', retryAfterS: cool, message: 'this Soul has asked for too much in a short time; the world answers it again in a minute'}}; }
    if (this.outstanding.has(r.key)) { this.shed.busy++; if (read) this.shed.reads++; this.strike(r.key, r.god, 'busy', now); return this.told(r.key, r.god, now, {status: 429, code: 'soul.busy', retryAfterS: 1, message: 'a previous request from this Soul is still being answered'}); }
    const b = this.bucket(r.key, r.god, now); b.seen = now;
    const est = this.estimate(r.route.id);
    if (read && this.level === 'black') { this.shed.reads++; return this.told(r.key, r.god, now, busyRefusal(this.level)); }
    if (read && b.tokens < est && this.contended(r.key)) {
      // §2b strike only for an impolite request: one that came back before the Retry-After it was last given had
      // elapsed. A Soul that waited and is still over budget is refused again with a Retry-After, but not struck
      // (eden2, 2026-10-31: honest Souls collected 3 strikes and a 60 s cool-down, 45-59 % of all read wall time)
      this.shed.slow++; this.shed.reads++; if (this.impolite(r.key, now)) this.strike(r.key, r.god, 'slow', now);
      const rate = this.refill(r.god);
      return this.told(r.key, r.god, now, {status: 429, code: 'soul.slow-down', retryAfterS: Math.min(COOL_MS / 1000, Math.max(1, Math.ceil((est - b.tokens) / Math.max(rate, 1e-6) / 1000))), message: 'this Soul has asked for a lot in a short time; the world can answer it again shortly'});
    }
    const deadline = now + Math.min(r.route.deadlineMs, r.hintMs && r.hintMs > 0 ? r.hintMs : Infinity);
    // a read that cannot start before its deadline (the time already queued, paid at the frame budget) is answered now,
    // not after the client has waited for nothing; acts always queue (refused only past their deadline)
    if (read && this.queue.length) {
      let ahead = 0; for (const j of this.queue) ahead += this.estimate(j.route.id);
      const wait = ahead * FRAME_MS / Math.max(1, this.frameBudget());
      if (now + wait + est + ANSWER_MARGIN_MS >= deadline) { this.shed.reads++; return this.told(r.key, r.god, now, {...busyRefusal(this.level), retryAfterS: Math.max(busyRefusal(this.level).retryAfterS, Math.ceil(wait / 1000))}); }
    }
    let settle!: Job['settle'], finish!: () => void;
    const turn = new Promise<'run' | 'dropped' | Refusal>(res => { settle = res; });
    const finished = new Promise<void>(res => { finish = res; });
    let ranAt = 0, isDone = false;
    const job: Job = {key: r.key, god: r.god, route: r.route, arrival: now, deadline, closed: r.closed ?? (() => false), finished, finish,
      settle: v => { if (v === 'run') ranAt = this.now(); settle(v); }};
    this.outstanding.add(r.key);
    // fast path: nothing waiting, the dispatcher idle, frame credit left and nobody else in flight → run now, inline
    // (no hop: the quiet case costs what it did before admission). Green or amber: a lone Soul in a world that is
    // amber (a boot or creation spike still stepping down) is not slowed; red/black always queue (budgets bind).
    // Charged when it answers.
    if (!this.queue.length && !this.draining && this.outstanding.size === 1 && (this.level === 'green' || this.level === 'amber') && this.creditNow(now) > 0) {
      settle('run'); ranAt = now;
      return {turn, waitedMs: () => 0, done: () => { if (isDone) return; isDone = true; this.outstanding.delete(r.key); this.charge(r.key, r.god, r.route.id, this.now() - now, now); finish(); this.kick(); }};
    }
    this.queue.push(job); this.kick();
    return {turn, waitedMs: () => (ranAt || this.now()) - now, done: () => { if (isDone) return; isDone = true; this.outstanding.delete(r.key); finish(); this.kick(); }};
  }

  private creditNow(now: number) { const budget = this.frameBudget(); this.credit = Math.min(budget, this.credit + (now - this.creditAt) * budget / FRAME_MS); this.creditAt = now; return this.credit; }
  /** Debit a job's measured time: the world credit, the god/Souls shares, the principal's bucket, the route estimate. */
  private charge(key: string, god: boolean, id: string, ms: number, startedAt: number) {
    this.creditNow(startedAt); this.credit -= ms; this.spentMs += ms;
    this.share.god = this.share.god * 0.95 + (god ? ms : 0); this.share.souls = this.share.souls * 0.95 + (god ? 0 : ms);
    const b = this.bucket(key, god, startedAt + ms); b.tokens -= ms;
    const e = this.est.get(id); this.est.set(id, e === undefined ? ms : e * 0.8 + ms * 0.2);
  }
  /** §2b cool-down: over budget impolitely 3× (or 20 refusals for overlapping requests) in a minute → 60 s of slow-down.
   *  The god is never cooled (it is never starved; its share is the reserve). */
  private strike(key: string, god: boolean, kind: 'slow' | 'busy', now: number) {
    if (god) return;
    const s = this.strikesOf(key), xs = s[kind]; xs.push(now); while (xs.length && now - xs[0] > 60_000) xs.shift();
    if (s.slow.length >= 3 || s.busy.length >= 20) { s.coolUntil = now + COOL_MS; s.slow.length = 0; s.busy.length = 0; this.shed.cooled++; }
    if (this.strikes.size > 4096) for (const [k, x] of this.strikes) if (x.coolUntil < now && x.retryUntil < now && !x.slow.length && !x.busy.length) this.strikes.delete(k);
  }
  private strikesOf(key: string) { let s = this.strikes.get(key); if (!s) { s = {slow: [], busy: [], coolUntil: 0, retryUntil: 0}; this.strikes.set(key, s); } return s; }
  /** A refusal given to a principal: remember when its Retry-After elapses (the politeness test of the next refusal). */
  private told(key: string, god: boolean, now: number, refusal: Refusal): {refusal: Refusal} {
    if (!god) this.strikesOf(key).retryUntil = now + refusal.retryAfterS * 1000;
    return {refusal};
  }
  /** Did this request arrive before the Retry-After this principal was last given had elapsed? */
  private impolite(key: string, now: number) { const s = this.strikes.get(key); return !!s && now < s.retryUntil; }
  /** Seconds left of this principal's cool-down, or 0. */
  private cooling(key: string, now: number) { const s = this.strikes.get(key); return s && s.coolUntil > now ? Math.ceil((s.coolUntil - now) / 1000) : 0; }
  /** Answer what can no longer be answered in time, drop what nobody waits for. */
  private sweep(now: number) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const j = this.queue[i];
      if (j.closed()) { this.queue.splice(i, 1); this.outstanding.delete(j.key); this.shed.dropped++; j.settle('dropped'); continue; }
      if (now + Math.min(this.estimate(j.route.id), 1000) + ANSWER_MARGIN_MS >= j.deadline) {
        this.queue.splice(i, 1); this.outstanding.delete(j.key);
        if (j.route.cls === 'C2') this.shed.reads++; else this.shed.acts++;
        j.settle(this.told(j.key, j.god, now, busyRefusal(this.level)).refusal);
      }
    }
  }
  /** Next job: writes before reads, FIFO across Souls (each Soul has at most one), the god's reserve under contention. */
  private pick(now: number): number {
    const godTurn = this.share.god <= GOD_SHARE * (this.share.god + this.share.souls);
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i];
      if (j.route.cls === 'C1') {
        if (this.level === 'black') continue;   // black: budget 0; acts wait for their deadline answer
        const b = this.bucket(j.key, j.god, now);
        if (b.tokens < this.estimate(j.route.id) && this.contended(j.key)) continue;   // short of budget: the act waits
      }
      const score = (j.route.cls === 'C1' ? 0 : 1e12) + (j.god === godTurn ? 0 : 1e11) + j.arrival;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  private kick() {
    if (this.draining || this.wake || this.soon || !this.queue.length) return;
    // check phase, right after this poll's arrivals are all queued (writes-first ordering sees the whole batch), with
    // no 1 ms timer clamp; the frame credit, not the hop, keeps requests to their share between ticks
    this.soon = setImmediate(() => { this.soon = null; void this.drain(); });
    if (!this.sweeper) { this.sweeper = setInterval(() => { this.sweep(this.now()); if (!this.queue.length && this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; } }, 100); this.sweeper.unref(); }
  }
  /** The dispatcher: runs queued jobs back to back while this frame's request budget lasts, then yields to the tick. */
  async drain() {
    if (this.draining) return; this.draining = true;
    try {
      while (this.queue.length) {
        let now = this.now();
        this.sweep(now);
        const budget = this.frameBudget();
        if (this.creditNow(now) <= 0) { this.later(budget > 0 ? Math.min(1000, -this.credit * FRAME_MS / budget + 1) : FRAME_MS); return; }
        const i = this.pick(now);
        if (i < 0) { this.later(FRAME_MS); return; }
        const [j] = this.queue.splice(i, 1);
        j.settle('run');
        await Promise.race([j.finished, this.o.yieldTurn ? this.o.yieldTurn() : new Promise<void>(r => setImmediate(r))]);
        this.charge(j.key, j.god, j.route.id, this.now() - now, now);
      }
    } finally { this.draining = false; }
  }
  private later(ms: number) { if (this.wake) return; this.wake = setTimeout(() => { this.wake = null; void this.drain(); }, Math.max(1, Math.ceil(ms))); this.wake.unref?.(); }
  close() { if (this.wake) clearTimeout(this.wake); if (this.soon) clearImmediate(this.soon); if (this.sweeper) clearInterval(this.sweeper); this.wake = this.sweeper = null; this.soon = null; }
}

export const NOTE: Record<Level, string | undefined> = {green: undefined, amber: 'It is crowded here right now; things take a little longer.', red: 'It is crowded here right now; things take a little longer.', black: 'The world is very crowded right now; it is slow to answer.'};
const RETRY_S: Record<Level, number> = {green: 1, amber: 2, red: 5, black: 15};
function busyRefusal(level: Level): Refusal { return {status: 503, code: 'world.busy', retryAfterS: RETRY_S[level], message: 'the world is too busy to answer this in time'}; }
/** The `world` block of §3 (refusals always; frames at amber and above). */
export function worldBlock(level: Level, retryAfterS?: number) { const note = NOTE[level]; return {load: level, ...(retryAfterS ? {retry_after_s: retryAfterS} : {}), ...(note ? {note} : {})}; }

const LOAD_KEY = 'simLoad';
/** The level this request was admitted at (routes.ts `wrap` adds the world block from it at amber and above). */
export const loadOf = (c: Context): Level | undefined => (c.get as (k: string) => unknown)(LOAD_KEY) as Level | undefined;

/** Mount on '*' before the routes: classifies, admits, stamps X-Sim-Load (and Retry-After on refusals at amber+). */
/** An opaque, stable id of the account behind a Soul token (the same for all its Souls), never the raw account id. */
export const accountTag = (owner: string) => createHash('sha256').update('sim-account/1\0' + owner).digest('base64url').slice(0, 16);

/** `account(token)` → the token's account (Soul owner) for `x-sim-account`, which the launcher's per-account ceilings read
 *  and strip (LOAD-CONTRACT §2b). Cached per token for a minute (a token lookup reads the database). */
export function admissionMiddleware(adm: Admission, level: () => Level, bearer: (c: Context) => string | undefined, account?: (token: string) => string | undefined,
  crowded?: (token: string) => {position: number; eta_s: number} | null): MiddlewareHandler {
  const tags = new Map<string, {tag: string | null; at: number}>();
  const tagOf = (token: string) => {
    const now = Date.now(), hit = tags.get(token);
    if (hit && now - hit.at < 60_000) return hit.tag;
    let owner: string | undefined; try { owner = account?.(token); } catch { owner = undefined; }
    const tag = owner ? accountTag(owner) : null;
    if (tags.size > 4096) tags.clear();
    tags.set(token, {tag, at: now}); return tag;
  };
  const stamp = (c: Context, lv: Level, token?: string) => {
    c.header('X-Sim-Load', lv);
    if (token && account) { const tag = tagOf(token); if (tag) c.header('x-sim-account', tag); }
    if (lv !== 'green' && (c.res.status === 429 || c.res.status === 503) && !c.res.headers.has('Retry-After')) c.header('Retry-After', String(RETRY_S[lv]));
  };
  return async (c, next) => {
    const path = c.req.path, edge = path.startsWith('/v1/edge/') || path.startsWith('/v1/god/') || path.startsWith('/v1/world/');
    if (!edge) return next();
    const lv = level(); (c.set as (k: string, v: unknown) => void)(LOAD_KEY, lv);
    const r = classify(c.req.method, path), token = bearer(c);
    // admitted already by the MessagePort front end (a read worker's forward, admissionPort below); the env is set
    // only by an in-process app.fetch, never by a client
    if ((c.env as {simAdmitted?: boolean} | undefined)?.simAdmitted === true) { await next(); stamp(c, lv, token); return; }
    if (!r || !token || (r.cls !== 'C1' && r.cls !== 'C2')) { await next(); stamp(c, lv, token); return; }
    adm.count(r.cls, 'attempted');
    // waking limit (dark): a Soul waiting its turn has its acts answered world.crowded; its reads still answer
    const line = r.cls === 'C1' && !r.god ? crowded?.(token) : null;
    if (line) { adm.refusedAs(r.cls, 'world.crowded'); stamp(c, lv, token); c.header('Cache-Control', 'no-store'); c.header('Retry-After', String(Math.max(1, Math.min(line.eta_s, 60))));
      return c.json({contract: 'eden-edge/1', error: {code: 'world.crowded', message: crowdedNote(line), position: line.position, eta_s: line.eta_s}, world: worldBlock(lv, Math.max(1, Math.min(line.eta_s, 60)))}, 503); }
    // the body is NOT pre-read here: god/ingestion.ts and edge/body/routes.ts measure/stream the raw body with their own
    // reader, and a stream Hono has already consumed is locked (R2 integration: every POST /v1/god/* answered 500). Body
    // I/O therefore counts inside the handler's turn; the launcher caps bodies at 64 KB, so the cost is negligible.
    // the client went away = its socket closed (not `incoming.destroyed`: a fully read request body is destroyed too)
    const env = c.env as {incoming?: {socket?: {destroyed?: boolean}}} | undefined, hint = Number(c.req.header('x-sim-timeout-ms'));
    const t = adm.request({key: r.god ? 'god' : 'soul:' + token, god: r.god, route: r, hintMs: Number.isFinite(hint) ? hint : undefined, closed: () => env?.incoming ? env.incoming.socket?.destroyed === true : c.req.raw.signal?.aborted === true});
    const refuse = (x: Refusal) => { c.header('Cache-Control', 'no-store'); c.header('Retry-After', String(x.retryAfterS)); stamp(c, lv, token);
      return c.json({contract: 'eden-edge/1', error: {code: x.code, message: x.message}, world: worldBlock(lv, x.retryAfterS)}, x.status); };
    if ('refusal' in t) { adm.refusedAs(r.cls, t.refusal.code); return refuse(t.refusal); }
    const v = await t.turn;
    if (v === 'dropped') { adm.count(r.cls, 'dropped'); return c.body(null, 499 as never); }
    if (v !== 'run') { adm.refusedAs(r.cls, v.code); return refuse(v); }
    adm.count(r.cls, 'started'); adm.timed(r.cls, 'queue', t.waitedMs());
    const ranAt = performance.now();
    try { await next(); } catch (e) { adm.answered(r.cls, 500, performance.now() - ranAt); t.done(); throw e; }
    adm.answered(r.cls, c.res.status, performance.now() - ranAt); t.done();
    stamp(c, lv, token);
  };
}

// ---------- Stage B (lane B-port): the MessagePort front end. A read worker (split/read-worker.ts) that is asked for
// something it cannot answer itself (a C1 by mistake, a read outside its subset) sends it here as a job: the same
// Admission.request as the HTTP middleware (key = the Soul's token or 'god', class, deadline), with closed() answered
// by the port (the worker posts {t:'closed', id} when its client hangs up). The job's payload is run by `run` when its
// turn comes (today: the HTTP request through the app, already admitted; B-facade: an act with a bound plan) and the
// result (the receipt) goes back over the port. Without admission (SIM_ADMISSION=0) jobs run at once.
export type PortJob = {t: 'job'; id: number; key: string; god: boolean; route: RouteClass | null; hintMs?: number; payload: unknown};
export type PortClosed = {t: 'closed'; id: number};
export type PortDone = {t: 'done'; id: number; refusal?: Refusal; dropped?: true; result?: unknown; error?: string};
type PortLike = {on(ev: 'message', f: (m: unknown) => void): unknown; postMessage(m: unknown, transfer?: readonly ArrayBuffer[]): void};
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function admissionPort(adm: Admission | undefined, port: PortLike, run: (payload: unknown, job: PortJob) => Promise<{result: unknown; transfer?: ArrayBuffer[]}>) {
  const closed = new Set<number>(), stats = {jobs: 0, refused: 0, dropped: 0, failed: 0};
  const reply = (d: PortDone, transfer?: ArrayBuffer[]) => { closed.delete(d.id); port.postMessage(d, transfer); };
  const go = async (m: PortJob, done?: () => void) => {
    const counted = !!adm && !!m.route && (m.route.cls === 'C1' || m.route.cls === 'C2'), ranAt = performance.now();
    let r: {result: unknown; transfer?: ArrayBuffer[]};
    try { r = await run(m.payload, m); }
    catch (e) { stats.failed++; if (counted) adm!.answered(m.route!.cls, 500, performance.now() - ranAt); try { reply({t: 'done', id: m.id, error: msg(e)}); } catch { /* the port is gone: nothing to answer */ } finally { done?.(); } return; }
    // counted once, before the reply (a reply that throws is not a second outcome)
    if (counted) { const st = (r.result as {status?: unknown} | null)?.status; adm!.answered(m.route!.cls, typeof st === 'number' ? st : 200, performance.now() - ranAt); }
    // a reply that throws (an uncloneable result, a closed port) becomes an error reply, never an unhandled rejection
    try { reply({t: 'done', id: m.id, result: r.result}, r.transfer); }
    catch (e) { try { reply({t: 'done', id: m.id, error: msg(e)}); } catch { /* the port is gone */ } }
    finally { done?.(); }
  };
  port.on('message', (x) => {
    const m = x as PortJob | PortClosed;
    if (m?.t === 'closed') { closed.add(m.id); return; }
    if (m?.t !== 'job') return;
    stats.jobs++;
    if (!adm || !m.route || (m.route.cls !== 'C1' && m.route.cls !== 'C2')) { void go(m); return; }
    const cls = m.route.cls;
    adm.count(cls, 'attempted');
    const t = adm.request({key: m.key, god: m.god, route: m.route, hintMs: m.hintMs, closed: () => closed.has(m.id)});
    if ('refusal' in t) { stats.refused++; adm.refusedAs(cls, t.refusal.code); reply({t: 'done', id: m.id, refusal: t.refusal}); return; }
    // (a dropped or refused job is already out of `outstanding`: done() is not called, as in the middleware)
    void t.turn.then((v) => {
      if (v === 'dropped') { stats.dropped++; adm.count(cls, 'dropped'); reply({t: 'done', id: m.id, dropped: true}); return; }
      if (v !== 'run') { stats.refused++; adm.refusedAs(cls, v.code); reply({t: 'done', id: m.id, refusal: v}); return; }
      adm.count(cls, 'started'); adm.timed(cls, 'queue', t.waitedMs());
      void go(m, t.done);
    });
  });
  return stats;
}
