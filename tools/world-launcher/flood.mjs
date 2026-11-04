// The launcher's coarse ceiling (lane P2, 2026-10-19). Every world shares this one event loop, so a flood is refused here,
// before a connection to its world is even opened. The worlds' own buckets (apps/server/src/flood.ts: a god token 10/s,
// an address 40 reads + 20 writes a second) are tighter and give the precise refusal; this one only trips on traffic no
// person or agent sends: more than 30 requests a second from one god token, or 100 API requests/writes a second from one
// address (several people behind one NAT included). Page and static-file GETs are never counted here.
import { createHash } from 'node:crypto';

export const LAUNCHER_FLOOD = Object.freeze({ godTokenPerS: 30, godTokenBurst: 900, ipPerS: 100, ipBurst: 2000 });

export class TokenBuckets {
  constructor(perS, burst, now = Date.now) { this.perS = perS; this.burst = burst; this.now = now; this.b = new Map(); this.calls = 0; }
  /** 0 when allowed, else ms until one token is back. `force`: the request was already let through (counted after
   *  the fact): take the token even when there is none, down to one burst of debt, and answer 0 */
  take(key, force = false) {
    const now = this.now(); let e = this.b.get(key);
    if (!e) { e = { t: this.burst, at: now }; this.b.set(key, e); }
    else { e.t = Math.min(this.burst, e.t + Math.max(0, now - e.at) * this.perS / 1000); e.at = now; }
    if (++this.calls % 5000 === 0) for (const [k, x] of this.b) if (x.t + (now - x.at) * this.perS / 1000 >= this.burst) this.b.delete(k);
    if (e.t >= 1 || force) { e.t = Math.max(-this.burst, e.t - 1); return 0; }
    return Math.max(1, Math.ceil((1 - e.t) * 1000 / this.perS));
  }
}

export const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/**
 * check(req, rest, behindProxy) → null (go on) or { status: 429, body, headers } for the caller to send.
 * `rest` is the path inside the world (/v1/...). Requests without a proxy's x-forwarded-for come from this machine and
 * are not address-limited.
 */
export function launcherFlood({ limits = {}, now = Date.now, log = (l) => console.warn(`[launcher] ${l}`), everyMs = 60_000 } = {}) {
  const L = { ...LAUNCHER_FLOOD, ...limits };
  const tokens = new TokenBuckets(L.godTokenPerS, L.godTokenBurst, now), ips = new TokenBuckets(L.ipPerS, L.ipBurst, now);
  const seen = new Map();
  const note = (id, what) => {
    const t = now(), e = seen.get(id);
    if (!e || t - e.since >= everyMs) {
      if (e?.n) log(`refused ${id}: ${e.n} more in the last ${Math.round((t - e.since) / 1000)} s (latest ${e.last})`);
      else if (!e) log(`refused ${id}: ${what} (further refusals counted, one line a minute)`);
      seen.set(id, { n: 0, since: t, last: what }); if (seen.size > 10_000) seen.clear(); return;
    }
    e.n++; e.last = what;
  };
  const refuse = (scope, key, why, waitMs, what) => {
    const s = Math.max(1, Math.ceil(waitMs / 1000)); note(`${scope} ${key}`, what);
    return { status: 429, headers: { 'retry-after': String(s), 'cache-control': 'no-store' }, body: { ok: false, code: 'rate-limited', message: `slow down: ${why}; try again in ${s} s`, retry_after: s, retryAfterMs: waitMs, limit: { scope } } };
  };
  return (req, rest, behindProxy, slug) => {
    const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (!write && !rest.startsWith('/v1/')) return null;
    const what = `${req.method} ${slug} ${rest.split('?')[0]}`;
    const auth = req.headers.authorization ?? '', m = /^Bearer\s+(god_\S+)/i.exec(auth);
    if (m) { const key = short(m[1]), wait = tokens.take(key); if (wait) return refuse('god-token', key, `more than ${L.godTokenPerS * 60} requests a minute from this god token`, wait, what); }
    const xff = behindProxy ? req.headers['x-forwarded-for'] : undefined;
    if (xff) { const ip = String(xff).split(',')[0].trim(), key = short(ip), wait = ips.take(ip); if (wait) return refuse('address', key, `more than ${L.ipPerS * 60} requests a minute from your address`, wait, what); }
    return null;
  };
}

// ---------- Ceilings for untrusted clients (lane L1, LOAD-CONTRACT §2b; Gene 2026-10-31: agents that run Souls are
// untrusted users, the world must be immune to being hammered). Exact limits on the Soul API, answered at once by the
// launcher (no world call, no held refusal), registry-tunable per world (`limits` in worlds.json, op.mjs set-limits).
// Per address only behind the reverse proxy (x-forwarded-for, which Caddy sets itself); this machine is never limited by
// address. Caddy, not the launcher, accepts the connections, so "connections per address" is counted as the address's
// requests in flight to world APIs and its WebSockets.
// Re-derived 2026-10-31 (maintainer decision, 13:40Z: "I want real scalability
// solutions, not limits"): a floor an order of magnitude above legitimate use — 6 Souls at home are 20–30 requests per
// 10 s and ~110 heavy per minute; the first numbers were set before Stage A was measured and sat at that edge. The world
// budget is a stop-gap until shedding is load-driven (the world's green/amber/red/black, LOAD-CONTRACT §1).
export const SOUL_CEILINGS = Object.freeze({
  ipPer10s: 600,            // Soul API requests per address per world per 10 s
  ipConcurrent: 50,         // API requests in flight + WebSockets per address
  ipListen: 40,             // listen/wait long-polls per address
  soulListen: 4,            // listen/wait per Soul token (a Soul needs 1–2; more is a client bug)
  accountListen: 40,        // listen/wait per account (learned from the world's x-sim-account header, else per Soul)
  accountHeavyPerMin: 900,  // C1/C2 per account (as above) per minute
  worldBudgetRps: 200,      // C1/C2 forwarded to the world's main thread per second, every Soul together (bursts of 2 s); reads its read workers answer are exempt. A safety ceiling only (lane srv-shed): shedding follows the world's level, and the Stage B mix at N=100 is ~30/s
  listenHoldMs: 5000,       // a listen/wait over its listen ceiling is held this long for a slot before it is refused (never at red/black)
  listenHeldMax: 200,       // listens held at once per world (past it, refused at once)
  maxBodyKb: 64,            // a Soul API request body (body uploads excepted)
  c3CacheMs: 1000,          // C3 public reads: one world call per this long per URL (the micro-cache)
});

/** LOAD-CONTRACT §2 request classes for a path inside a world: 'C0' | 'listen' (C0 long-polls) | 'C1' | 'C2' | 'C3' | null. */
export function requestClass(rest, method = 'GET') {
  const read = method === 'GET' || method === 'HEAD';
  if (rest === '/healthz' || rest === '/v1/config') return 'C0';
  if (rest === '/v1/world/snapshot') return read ? 'C3' : null;
  if (!rest.startsWith('/v1/edge/')) return null;
  // Admitted mesh bytes are public so any visitor can render a Soul; selection/uploads remain owner-bound.
  if (read && /^\/v1\/edge\/body\/assets\/body_[a-f0-9]{64}\.glb$/.test(rest)) return 'C3';
  const r = rest.slice('/v1/edge/'.length);
  if (/^(inbox\/listen|wait)\/?$/.test(r)) return 'listen';
  if (/^(receipts(\/|$)|inbox(\/|$)|schema\/?$|boot\/static\/?$)/.test(r)) return 'C0';
  // `around` explores (it records the places found and invalidates menus): a write, as in-world admission classes it
  if (/^around\/?$/.test(r)) return 'C1';
  // public/souls/:id is the visitor page's Soul chip (apps/web PublicSoulRecord): a public read, served without a token
  if (read && /^(map|rides|items|platforms)\/?$|^public\//.test(r)) return 'C3';
  return read ? 'C2' : 'C1';
}

/** LOAD-CONTRACT §1 levels at which the launcher sheds (no listen is held, C2 the read workers do not answer is refused). */
const HOT_LEVELS = new Set(['red', 'black']);

/** A refusal body a person can read (LOAD-CONTRACT §2b "Refusal shapes"): the code, words, and when to come back. */
export function refusalBody(code, message, waitMs, scope) {
  const s = Math.max(1, Math.ceil(waitMs / 1000));
  return { ok: false, code, message, retry_after: s, retryAfterMs: Math.max(1000, Math.round(waitMs)), ...(scope ? { limit: { scope } } : {}) };
}
const secs = (ms) => { const s = Math.max(1, Math.ceil(ms / 1000)); return `${s} s`; };

/** How long a listen/wait asked to be held by the world (its own deadline): wait `timeout` (s, default 25), listen
 *  `timeoutMs` (default 25 000); both at most 55 s. */
export function listenTimeoutMs(rest, search = '') {
  const q = new URLSearchParams(search);
  if (/\/wait\/?$/.test(rest)) { const t = Number(q.get('timeout') ?? 25); return Number.isFinite(t) ? Math.min(55, Math.max(0, t)) * 1000 : 25_000; }
  const t = Number(q.get('timeoutMs') ?? 25_000); return Number.isFinite(t) ? Math.min(55_000, Math.max(0, t)) : 25_000;
}
/** A listener is past its own deadline this long after the time it asked for (the world answers a long-poll at its
 *  timeout; one still open well after that is a ghost: a client that went away without closing, a stuck relay). */
export const LISTEN_GRACE_MS = 5000;

export function soulCeilings({ limitsFor = () => null, now = Date.now, log = (l) => console.warn(`[launcher] ${l}`) } = {}) {
  const buckets = new Map(), counts = new Map(), accounts = new Map(), refused = new Map(), held = new Map();
  const bucket = (name, perS, burst) => { const k = `${name}:${perS}:${burst}`; let b = buckets.get(k); if (!b) buckets.set(k, b = new TokenBuckets(perS, burst, now)); return b; };
  const n = (k) => counts.get(k) ?? 0;
  const add = (k, d) => { const v = n(k) + d; if (v > 0) counts.set(k, v); else counts.delete(k); };
  // lane srv-shed: the listeners holding each listen key (oldest first), and the listens held for a slot
  const holders = new Map();   // key -> Set<{ at, deadline, evict }>
  const waiting = new Map();   // slug -> Set<wake()>
  const wakeAll = () => { for (const ws of waiting.values()) for (const w of [...ws]) w(); };
  const seen = new Map();
  const note = (slug, code, scope) => {
    const r = refused.get(slug) ?? {}; r[code] = (r[code] ?? 0) + 1; refused.set(slug, r);
    const t = now(), id = `${slug} ${scope}`, e = seen.get(id);
    if (!e || t - e.since >= 60_000) { log(`ceiling ${code} on ${id}${e?.n ? ` (+${e.n} in the last minute)` : ''}`); seen.set(id, { since: t, n: 0 }); if (seen.size > 10_000) seen.clear(); } else e.n++;
  };
  const limits = (slug) => ({ ...SOUL_CEILINGS, ...(limitsFor(slug) ?? {}) });
  const no = (slug, status, code, scope, waitMs, message) => {
    const s = Math.max(1, Math.ceil(waitMs / 1000)); note(slug, code, scope);
    return { refuse: { status, headers: { 'retry-after': String(s), 'cache-control': 'no-store' }, body: refusalBody(code, message, waitMs, scope) } };
  };
  const soulOf = (req) => { const t = /^Bearer\s+(sim_\S+)/i.exec(req.headers.authorization ?? '')?.[1]; return t ? short(t) + short(t + '.') : null; };
  /** The first listen ceiling this listen is over: { key, status, code, scope, waitMs, message } or null. */
  const listenOver = (l, ip, soul, acct) => {
    if (ip && n(`l|${ip}`) >= l.ipListen) return { key: `l|${ip}`, status: 429, code: 'client.rate', scope: 'address', waitMs: 5000, message: `Your address already holds ${l.ipListen} listening connections to this world (its most). The world asked you to wait 5 s before listening again` };
    if (soul && n(`ls|${soul}`) >= l.soulListen) return { key: `ls|${soul}`, status: 429, code: 'soul.busy', scope: 'soul', waitMs: 5000, message: `This Soul already holds ${l.soulListen} listening connections (one is enough). The world asked you to wait 5 s before listening again` };
    if (soul && n(`la|${acct}`) >= l.accountListen) return { key: `la|${acct}`, status: 429, code: 'account.rate', scope: 'account', waitMs: 5000, message: `This account's Souls already hold ${l.accountListen} listening connections. The world asked you to wait 5 s before listening again` };
    return null;
  };
  /** Release the oldest listener on `key` when it is past its own deadline (it frees its slot when its response closes). */
  const evictStale = (key) => {
    const hs = holders.get(key); if (!hs) return false;
    for (const e of hs) {   // oldest first
      if (e.evicted || !e.evict) continue;
      if (now() < e.deadline) return false;
      e.evicted = true; try { e.evict(); } catch { /* the response is already gone */ }
      return true;
    }
    return false;
  };
  const heldOf = (slug) => { let h = held.get(slug); if (!h) held.set(slug, h = { total: 0, served: 0, refused: 0, gone: 0, ended: 0, seconds: 0, now: 0 }); return h; };
  return {
    limits, refused: (slug) => ({ ...(refused.get(slug) ?? {}) }), soulOf,
    /** Listens held for a slot (lane srv-shed): { total, served, refused, gone (the client left), ended, seconds, now }. */
    held: (slug) => ({ ...heldOf(slug) }),
    /** Count (and log, once a minute per world) a refusal made elsewhere: the launcher's boot and load admission. */
    note: (slug, code, scope) => note(slug, code, scope),
    /** The world says which account a Soul token belongs to (an opaque id): its Souls share the account's ceilings. */
    learn(soul, account) { if (soul && account) { accounts.set(soul, short(String(account))); if (accounts.size > 50_000) accounts.clear(); } },
    /** A WebSocket from `ip` (behind the proxy): admitted, or refused; release() when it closes. */
    socket(slug, ip) {
      if (!ip) return { release() {} };
      const l = limits(slug);
      if (n(`c|${ip}`) >= l.ipConcurrent) { note(slug, 'client.rate', 'address'); return null; }
      add(`c|${ip}`, 1); let done = false;
      return { release() { if (!done) { done = true; add(`c|${ip}`, -1); } } };
    },
    /** The world budget (main's share) for a request let through without it (`worldDeferred`): a read meant for the
     *  read workers that goes to main after all. null = go on, else { refuse }; `force` (main already answered it): counted,
     *  never refused. A safety ceiling only (lane srv-shed): the world's level sheds first. */
    chargeWorld(slug, { force = false } = {}) {
      const l = limits(slug), wait = bucket('world', l.worldBudgetRps, l.worldBudgetRps * 2).take(slug, force);
      return wait ? no(slug, 503, 'world.busy', 'world', wait, `This world is answering as many requests as it can right now. It asked you to wait ${secs(wait)}`) : null;
    },
    /** One request to a world: null (not an API request: go on), { refuse }, { hold(gone) } or { cls, soul, release(), worldDeferred }.
     *  `toWorker`: a C2 read the world's read workers will answer (Stage B): the world budget, which protects the tick
     *  thread, is not taken here; chargeWorld() takes it if the read reaches main after all.
     *  Listens (lane srv-shed): `level` (the world's load level), `deadlineMs` (how long this listen asked to be held) and
     *  `evict()` (end it, when a newer listen needs its slot after its deadline). A listen over a listen ceiling below red
     *  answers { hold(gone) }: a promise of the same answer once a slot frees, refused only after `listenHoldMs`. */
    check(req, slug, rest, behindProxy, { toWorker = false, level = 'green', deadlineMs = 25_000, evict = null } = {}) {
      if (!rest.startsWith('/v1/') && rest !== '/healthz') return null;
      const cls = requestClass(rest, req.method), edge = rest.startsWith('/v1/edge/'), l = limits(slug);
      // only the Soul API is ceilinged: god and world routes (the world creator's own coding agent) keep the god-token
      // bucket and the address flood guard (launcherFlood); a C3 public read still gets its class for the micro-cache
      if (!edge) return cls === 'C3' ? { cls, soul: null, release() {} } : null;
      const xff = behindProxy ? req.headers['x-forwarded-for'] : undefined, ip = xff ? String(xff).split(',')[0].trim() : null;
      const soul = soulOf(req), acct = soul ? accounts.get(soul) ?? soul : null, heavy = edge && (cls === 'C1' || cls === 'C2');
      const len = Number(req.headers['content-length'] ?? 0);
      if (edge && !rest.startsWith('/v1/edge/body/uploads') && len > l.maxBodyKb * 1024) { note(slug, 'request.too-large', 'body'); return { refuse: { status: 413, headers: { 'cache-control': 'no-store' }, body: { ok: false, code: 'request.too-large', message: `A request body may be at most ${l.maxBodyKb} KB; this one is larger, so it was not sent to the world`, limit: { scope: 'body' } } } }; }
      if (heavy && !req.headers.authorization) { note(slug, 'auth.required', 'token'); return { refuse: { status: 401, headers: { 'cache-control': 'no-store' }, body: { ok: false, code: 'auth.required', message: 'This needs a Soul token (Authorization: Bearer sim_...)', limit: { scope: 'token' } } } }; }
      if (ip) {
        { const wait = bucket('ip', l.ipPer10s / 10, l.ipPer10s).take(`${slug}|${ip}`); if (wait) return no(slug, 429, 'client.rate', 'address', wait, `More than ${l.ipPer10s} requests in 10 s came from your address to this world. The world asked you to slow down for ${secs(wait)}`); }
        if (n(`c|${ip}`) >= l.ipConcurrent) return no(slug, 429, 'client.rate', 'address', 1000, `More than ${l.ipConcurrent} requests at once came from your address. The world asked you to wait 1 s`);
      }
      if (heavy && acct) { const wait = bucket('acct', l.accountHeavyPerMin / 60, Math.max(1, Math.round(l.accountHeavyPerMin / 4))).take(acct); if (wait) return no(slug, 429, 'account.rate', 'account', wait, `This account's Souls sent more than ${l.accountHeavyPerMin} requests in a minute. The world asked you to slow down for ${secs(wait)}`); }
      const worldDeferred = heavy && toWorker && cls === 'C2';
      if (heavy && !worldDeferred) { const wait = bucket('world', l.worldBudgetRps, l.worldBudgetRps * 2).take(slug); if (wait) return no(slug, 503, 'world.busy', 'world', wait, `This world is answering as many requests as it can right now. It asked you to wait ${secs(wait)}`); }
      const listen = cls === 'listen';
      const keys = [...(ip ? [`c|${ip}`] : []), ...(listen ? [...(ip ? [`l|${ip}`] : []), ...(soul ? [`ls|${soul}`, `la|${acct}`] : [])] : [])];
      const admit = () => {
        for (const k of keys) add(k, 1);
        const entry = listen ? { at: now(), deadline: now() + Math.max(0, deadlineMs) + LISTEN_GRACE_MS, evict, evicted: false } : null;
        const lkeys = listen ? keys.filter((k) => !k.startsWith('c|')) : [];
        for (const k of lkeys) { let hs = holders.get(k); if (!hs) holders.set(k, hs = new Set()); hs.add(entry); }
        let done = false;
        return { cls, soul, worldDeferred, release() {
          if (done) return; done = true; for (const k of keys) add(k, -1);
          for (const k of lkeys) { const hs = holders.get(k); if (hs) { hs.delete(entry); if (!hs.size) holders.delete(k); } }
          if (listen) wakeAll();
        } };
      };
      if (!listen) return admit();
      let over = listenOver(l, ip, soul, acct);
      if (!over) return admit();
      if (evictStale(over.key)) over = listenOver(l, ip, soul, acct);   // (its slot frees when its response closes)
      if (!over) return admit();
      const ws = waiting.get(slug) ?? new Set();
      if (HOT_LEVELS.has(level) || !(l.listenHoldMs > 0) || ws.size >= l.listenHeldMax) return no(slug, over.status, over.code, over.scope, over.waitMs, HOT_LEVELS.has(level) ? `${over.message} (the world is very busy: ${level})` : over.message);
      // lane srv-shed: held for a slot up to listenHoldMs (the oldest listener past its deadline released first), answered
      return { hold: (gone = () => false) => new Promise((resolve) => {
        const t0 = now(), h = heldOf(slug); h.total++; h.now++; waiting.set(slug, ws);
        let timer = null, poll = null;
        const finish = (r, outcome) => {
          clearTimeout(timer); clearInterval(poll); ws.delete(wake); if (!ws.size) waiting.delete(slug);
          h.now--; h.ended++; h.seconds += Math.max(0, now() - t0) / 1000; h[outcome]++;
          resolve(r);
        };
        function wake() {
          if (gone()) return finish(null, 'gone');
          const o = listenOver(l, ip, soul, acct);
          if (!o) return finish(admit(), 'served');
          evictStale(o.key);
        }
        ws.add(wake);
        timer = setTimeout(() => { const o = listenOver(l, ip, soul, acct); finish(o ? no(slug, o.status, o.code, o.scope, o.waitMs, `${o.message} (held ${secs(l.listenHoldMs)} for a free slot first)`) : admit(), o ? 'refused' : 'served'); }, l.listenHoldMs);
        poll = setInterval(wake, 250);   // a listener past its deadline frees nothing by itself: look again
      }) };
    },
  };
}

/** C3 public reads (LOAD-CONTRACT §2): one world call per URL per `ttlMs`, concurrent misses share it (single flight). */
export class MicroCache {
  constructor({ now = Date.now, maxEntries = 500, maxBytes = 8 * 2 ** 20 } = {}) { this.now = now; this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.m = new Map(); this.flying = new Map(); this.hits = 0; this.misses = 0; }
  /** fetch() → Promise<{ status, headers, body: Buffer }>; resolves with that response and whether it was shared. */
  async get(key, ttlMs, fetch) {
    const t = this.now(), e = this.m.get(key);
    if (e && t - e.at < ttlMs) { this.hits++; return { ...e.r, cache: 'hit' }; }
    const f = this.flying.get(key);
    if (f) { this.hits++; return { ...(await f), cache: 'shared' }; }
    this.misses++;
    const p = fetch().then((r) => { if (r.status === 200 && r.body.length <= this.maxBytes) { this.m.set(key, { at: this.now(), r }); if (this.m.size > this.maxEntries) this.m.delete(this.m.keys().next().value); } return r; }).finally(() => this.flying.delete(key));
    this.flying.set(key, p);
    return { ...(await p), cache: 'miss' };
  }
}
