// CW1 (#735): the 50-Soul / 10-world meetup workload, as data. Pure and deterministic: no I/O, no clock, no
// Math.random. meetup.mjs runs it through the launcher; workload.test.mjs pins it. Read README.md ("Meetup workload").
//
// The schedule is fixed before a run from (profile, seed, phases) and never looks at a response: offered demand is
// independent of latency. A Soul sends one call at a time, in schedule order (the one-heavy-request-per-Soul rule);
// a call that starts more than DEMAND.overdueAfterMs after its scheduled time is overdue (still sent, never dropped);
// a call still queued when the activity window closes is unissued. End-to-end latency is measured from the scheduled
// time, so client queueing, Retry-After waits and backoff are inside it.
import { createHash } from 'node:crypto';

export const WORKLOAD = 'cw1-meetup/1';
export const TICK_HZ = 20;

// Ten substantial worlds from the repository's authored templates (no private exports, no empty planes). World 0 is
// the meetup world: the largest template, the one the live Eden world is built from. Small starter templates
// (hello-hamlet, littlemartians-garden) and the upgrade patch are deliberately not used.
export const FIXTURES = Object.freeze([
  { slug: 'mw0', template: 'eden-2026' },
  { slug: 'mw1', template: 'mars-two' },
  { slug: 'mw2', template: 'littlemartians-two' },
  { slug: 'mw3', template: 'unified-mars-live-proof-20261027' },
  { slug: 'mw4', template: 'eden-district' },
  { slug: 'mw5', template: 'mars-camp' },
  { slug: 'mw6', template: 'eden-2026' },
  { slug: 'mw7', template: 'mars-two' },
  { slug: 'mw8', template: 'littlemartians-two' },
  { slug: 'mw9', template: 'eden-2026' },
]);

/** Souls per world, in FIXTURES order. Both profiles total 50. */
export const PROFILES = Object.freeze({
  even: Object.freeze([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
  meetup: Object.freeze([20, 4, 4, 4, 3, 3, 3, 3, 3, 3]),
});

// The declared planning workload (#735 A3): not measured usage. Compared before freezing with the existing Stage B
// mix (tools/bench/capacity/bench.mjs --load stageb: a read every 3–5 s, an act every 15–30 s), which it matches.
export const DEMAND = Object.freeze({
  readEveryMs: 4000,
  actEveryMs: 20_000,
  // the pinned rich-read mix, cycled per Soul from a seeded offset (observe is the richest; it leads)
  readMix: Object.freeze(['observe', 'here', 'capabilities', 'observe', 'resolve', 'here']),
  // movement, attention, speech, a gesture, an interruption (a walk replaced 3 s later by a stand) and a shared action
  // (an invitation to the next Soul in the same world, which that Soul's driver accepts from its own event stream)
  actMix: Object.freeze(['walk', 'attention', 'say', 'gesture', 'interrupt', 'shared']),
  sharedVerbs: Object.freeze(['high-five', 'handshake', 'hug', 'dance-with']),
  interruptAfterMs: 3000,
  burstActWithinMs: 1000,   // every Soul submits its coordinated act within 1 s of the meetup point
  burstReads: 2,            // ...then two reads each
  burstReadsWithinMs: 2000, // ...within the following 2 s
  overdueAfterMs: 1000,     // a call sent later than this after its scheduled time is overdue demand
});

/** Phase lengths. `short` is the smoke: the same shape, scaled, never a measuring window. */
export function phases(short = false) {
  return short
    ? { quietMs: 60_000, activeMs: 180_000, meetupsMs: [40_000, 90_000, 140_000] }
    : { quietMs: 5 * 60_000, activeMs: 20 * 60_000, meetupsMs: [5 * 60_000, 11 * 60_000, 17 * 60_000] };
}

// Documentation address ranges only (RFC 5737): one address per Soul, one shared network.
const OWN_NET = '198.51.100.', SHARED_NET = '203.0.113.7';

/** mulberry32 over a string seed: the only randomness in the workload. */
export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const c of String(seed)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The Souls of a profile: world, index in the world, account and address. Grouping is part of the workload:
 *  most Souls have their own account and address; one person runs three Souls in the meetup world (shared account
 *  A), another runs one Soul in each of worlds 1–3 (shared account B), and five Souls in worlds 4–8 sit behind one
 *  network address (a household or venue). All of it stays inside the launcher's SOUL_CEILINGS. */
export function souls(profile) {
  const per = PROFILES[profile]; if (!per) throw new Error(`profile ${profile}: even | meetup`);
  const out = [];
  per.forEach((n, w) => { for (let k = 0; k < n; k++) out.push({ i: out.length, world: w, slug: FIXTURES[w].slug, k }); });
  for (const s of out) {
    s.account = s.world === 0 && s.k < 3 ? 'acct-a' : s.world >= 1 && s.world <= 3 && s.k === 0 ? 'acct-b' : `acct-${s.i}`;
    s.address = s.world >= 4 && s.world <= 8 && s.k === 1 ? SHARED_NET : `${OWN_NET}${s.i + 10}`;
  }
  return out;
}

/** Every scheduled call of the activity window, sorted by (soul, atMs, seq). atMs is relative to the window start.
 *  Kinds: reads observe|here|capabilities|resolve; acts walk|attention|say|gesture|stand|shared|meetup. Accepting an
 *  invitation is reactive demand (it follows another Soul's act), counted apart by the runner. A Soul's targets
 *  (which place to walk to) are chosen at run time from its own world's menu by `pick`, so the same seed is valid in
 *  any template. */
export function schedule(profile, seed, ph = phases()) {
  const ops = [];
  for (const s of souls(profile)) {
    const r = rng(`${seed}|${profile}|${s.i}`), mine = [];
    const add = (atMs, cls, kind, burst = null) => { if (atMs >= 0 && atMs < ph.activeMs) mine.push({ soul: s.i, world: s.world, atMs: Math.round(atMs), cls, kind, burst, pick: Math.floor(r() * 1e6) }); };
    const ro = Math.floor(r() * DEMAND.readMix.length), rt = r() * DEMAND.readEveryMs;
    for (let k = 0, t = rt; t < ph.activeMs; k++, t += DEMAND.readEveryMs) add(t, 'read', DEMAND.readMix[(ro + k) % DEMAND.readMix.length]);
    const ao = Math.floor(r() * DEMAND.actMix.length), at = r() * DEMAND.actEveryMs;
    for (let k = 0, t = at; t < ph.activeMs; k++, t += DEMAND.actEveryMs) {
      const kind = DEMAND.actMix[(ao + k) % DEMAND.actMix.length];
      if (kind === 'interrupt') { add(t, 'act', 'walk'); add(t + DEMAND.interruptAfterMs, 'act', 'stand'); } else add(t, 'act', kind);
    }
    ph.meetupsMs.forEach((m, b) => {
      const ta = m + r() * DEMAND.burstActWithinMs; add(ta, 'act', 'meetup', b);
      const from = m + DEMAND.burstActWithinMs;
      const reads = Array.from({ length: DEMAND.burstReads }, () => from + r() * DEMAND.burstReadsWithinMs).sort((x, y) => x - y);
      reads.forEach((t, j) => add(t, 'read', j % 2 ? 'here' : 'observe', b));
    });
    mine.sort((a, b) => a.atMs - b.atMs || (a.cls === 'act' ? -1 : 1));
    mine.forEach((o, n) => ops.push({ id: `s${s.i}-${n}`, seq: n, ...o }));
  }
  return ops;
}

/** sha256 of the schedule: the receipt's identity for "the same offered demand". */
export const scheduleId = (ops) => createHash('sha256').update(JSON.stringify(ops)).digest('hex');

/** Totals by class and kind, and the burst share, for the receipt. */
export function scheduleCounts(ops) {
  const out = { total: ops.length, read: 0, act: 0, burst: 0, byKind: {} };
  for (const o of ops) { out[o.cls]++; if (o.burst != null) out.burst++; out.byKind[o.kind] = (out.byKind[o.kind] ?? 0) + 1; }
  return out;
}

// ------------------------------------------------------------------ outcomes
const BUSY = /\b(world\.busy|world\.crowded|world\.starting|soul\.busy|soul\.slow-down|rate-limited|client\.rate|account\.rate)\b/;
/** One finished call: ok | gameplay-refused (a valid in-world refusal, retained and classified) | load-refused (a
 *  designed busy answer still standing after the client's waits) | timeout | error | unreachable. */
export function outcomeOf({ status, code, accepted }) {
  if (status === -1) return 'timeout';
  if (status === 0) return 'unreachable';
  if ((status === 429 || status === 503) && BUSY.test(String(code))) return 'load-refused';
  if (status >= 200 && status < 300) return accepted === false ? 'gameplay-refused' : 'ok';
  return 'error';
}
/** Outcomes of an issued call that count against capacity (unissued demand is counted on its own, beside them). */
export const LOAD_FAILURES = Object.freeze(['load-refused', 'timeout', 'error', 'unreachable']);

/** Quantiles with their sample count; p99 is marked unsupported below 100 samples (max and n are then the answer). */
export function quantiles(xs) {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1), ...(s.length < 100 ? { p99Supported: false } : {}) };
}

/** Accounting of every scheduled call. `records` holds one entry per op that was issued ({id, issuedAt, doneAt,
 *  outcome, ...}, times relative to the window start); every op without one is unissued. Nothing is filtered out:
 *  offered = issued + unissued, and the end-to-end latency is over every issued call, timeouts included. */
export function account(ops, records, { worldsOf = (o) => o.world, overdueAfterMs = DEMAND.overdueAfterMs } = {}) {
  const byId = new Map(records.map((r) => [r.id, r])), groups = new Map();
  const g = (key) => { let x = groups.get(key); if (!x) groups.set(key, x = { offered: 0, issued: 0, unissued: 0, overdue: 0, outcomes: {}, e2e: [], service: [], lateness: [] }); return x; };
  for (const o of ops) {
    const r = byId.get(o.id);
    for (const key of [`all|${o.cls}`, `w${worldsOf(o)}|${o.cls}`, ...(o.burst != null ? [`burst${o.burst}|${o.cls}`] : [])]) {
      const x = g(key); x.offered++;
      if (!r) { x.unissued++; x.outcomes.unissued = (x.outcomes.unissued ?? 0) + 1; continue; }
      x.issued++; x.outcomes[r.outcome] = (x.outcomes[r.outcome] ?? 0) + 1;
      const late = r.issuedAt - o.atMs; x.lateness.push(late); if (late > overdueAfterMs) x.overdue++;
      x.e2e.push(r.doneAt - o.atMs); x.service.push(r.doneAt - r.issuedAt);
    }
  }
  const out = {};
  for (const [key, x] of [...groups].sort()) {
    const loadFailures = LOAD_FAILURES.reduce((n, k) => n + (x.outcomes[k] ?? 0), 0);
    out[key] = { offered: x.offered, issued: x.issued, unissued: x.unissued, overdue: x.overdue, loadFailures, outcomes: x.outcomes,
      e2eMs: quantiles(x.e2e), lateMs: quantiles(x.lateness), answeredOnlyServiceMs: quantiles(x.service) };
  }
  return out;
}

// ------------------------------------------------------------------ clock proof
/** Full-clock evidence for one world over [from, to] (monotonic ms). `samples` = [{t, tick, rttMs}] from /healthz;
 *  a sample that got no answer is simply absent, so its gap stays inside the next interval (nothing is clipped,
 *  nothing reset). due = elapsed × TICK_HZ × rate, rate being the admin rate from the world's own database; the tick
 *  was read somewhere inside each sample's round trip, so the ratio's uncertainty is half of both round trips. */
export function clockWindow(samples, { from, to, rate = 1 }) {
  const s = samples.filter((x) => x.t >= from && x.t <= to && Number.isFinite(x.tick)).sort((a, b) => a.t - b.t);
  if (s.length < 2) return { samples: s.length, ratio: null };
  const a = s[0], b = s.at(-1), perMs = (TICK_HZ * rate) / 1000, due = (b.t - a.t) * perMs, actual = b.tick - a.tick;
  let maxGapMs = 0, maxStallMs = 0, maxDeficit = 0, stallFrom = a;
  for (let k = 1; k < s.length; k++) {
    const p = s[k - 1], c = s[k];
    maxGapMs = Math.max(maxGapMs, c.t - p.t);   // longest interval without an answered sample
    if (c.tick > stallFrom.tick) stallFrom = c; else maxStallMs = Math.max(maxStallMs, c.t - stallFrom.t);   // longest time the tick did not move
    maxDeficit = Math.max(maxDeficit, (c.t - a.t) * perMs - (c.tick - a.tick));
  }
  const errTicks = ((a.rttMs ?? 0) + (b.rttMs ?? 0)) / 2 * perMs;
  const endDeficit = due - actual;
  return { samples: s.length, seconds: +((b.t - a.t) / 1000).toFixed(1), rate, dueTicks: +due.toFixed(1), actualTicks: actual,
    ratio: +(actual / due).toFixed(4), ratioUncertainty: +(errTicks / due).toFixed(4), maxDeficitTicks: +maxDeficit.toFixed(1), endDeficitTicks: +endDeficit.toFixed(1),
    maxSampleGapMs: Math.round(maxGapMs), maxStallMs: Math.round(maxStallMs) };
}
