// Deterministic oracles over one request's evidence pack (DESIGN §4.4, spec §2.4). Code only: pass | fail | unknown
// with pointers, never a score. Facts after the request's cutoff are excluded (late diagnostics never grant hits).
import { seatActs, xz } from './run.mjs';
import { journeyOracles } from './journey-oracles.mjs';
import { expectFor, expectOracles } from './expect-oracles.mjs';
import { windowValidity } from '../tick-validity.mjs';

export const ORACLE_IDS = ['ack-latency', 'result-sent', 'listen-open', 'arrival', 'posture', 'duration-held', 'inside-solid', 'no-progress', 'oscillation', 'stuck-receipt', 'truthfulness-basic', 'vocabulary', 'duplicate-acts', 'server-errors', 'first-body-change'];
export const PHYSICAL = ['arrival', 'posture', 'truthfulness-basic', 'inside-solid', 'no-progress'];
export const ACK_BOUND_SEC = 10;
const WALK = /^(go|walk|visit|goto|stroll|wander|run|follow)[:.]/i;
const ms = (iso) => (iso ? Date.parse(iso) : null);
const secs = (a, b) => Math.round((b - a) / 100) / 10;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (s) => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const o = (id, status, detail, pointers = []) => ({ id, status, detail, pointers });

function postureWanted(text) {
  const t = String(text).toLowerCase();
  if (/\b(sit|seat|have a seat)\b/.test(t)) return 'sitting';
  if (/\b(lie|lay|nap|sleep|rest on)\b/.test(t)) return 'lying';
  if (/\bstand( up)?\b|\bget up\b/.test(t)) return 'standing';
  return null;
}
const postureIs = (p, want) => ({ sitting: /sit|seated|riding|rowing/i, lying: /lying|lie|asleep|sleep|nap/i, standing: /stand/i })[want]?.test(String(p ?? '')) ?? false;

function inside(fp, p) {
  if (!fp || !p) return false;
  if (Array.isArray(fp)) { let c = false; for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) { const [xi, zi] = fp[i], [xj, zj] = fp[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c; } return c; }
  if (fp.minX != null) return p[0] >= fp.minX && p[0] <= fp.maxX && p[1] >= fp.minZ && p[1] <= fp.maxZ;
  if (fp.radius != null) return dist(xz(fp.center ?? [fp.x, fp.z]), p) <= fp.radius;
  if (fp.w != null) return Math.abs(p[0] - fp.x) <= fp.w / 2 && Math.abs(p[1] - fp.z) <= (fp.d ?? fp.w) / 2;
  return false;
}

/** Tick → wall-clock (ms) from samples that carry both (piecewise linear; extrapolated at the ends). null without ticks. */
export function tickClock(samples) {
  const s = samples.filter((x) => Number.isFinite(x.tick) && Number.isFinite(x.ms)).sort((a, b) => a.ms - b.ms);
  if (s.length < 2) return null;
  const a = s[0], b = s.at(-1);
  if (b.tick <= a.tick) return null;
  const rate = (b.tick - a.tick) / (b.ms - a.ms); // ticks per ms
  return (tick) => {
    if (!Number.isFinite(tick)) return null;
    if (tick <= a.tick) return a.ms - (a.tick - tick) / rate;
    if (tick >= b.tick) return b.ms + (tick - b.tick) / rate;
    const i = s.findIndex((x, k) => k + 1 < s.length && x.tick <= tick && s[k + 1].tick >= tick);
    const p = s[i], q = s[i + 1];
    return q.tick === p.tick ? p.ms : p.ms + ((tick - p.tick) / (q.tick - p.tick)) * (q.ms - p.ms);
  };
}
const isoMs = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);
/** When a receipt was accepted / ended (ms): ISO acceptedAt/startedAt/endedAt when present, else ticks via the samples. */
export const acceptedMs = (r, clk) => { const t = isoMs(r?.acceptedAt ?? r?.startedAt); if (Number.isFinite(t)) return t; const k = r?.acceptedTick ?? r?.startedTick; return k != null && clk ? clk(k) : null; };
export const endedMs = (r, clk) => { const t = isoMs(r?.endedAt); if (Number.isFinite(t)) return t; return r?.endedTick != null && clk ? clk(r.endedTick) : null; };
const seatSampleCache = new WeakMap();
/** Every sample of one seat across the run's evidence packs (deduplicated by time), for facts outside one window. */
export function seatSamples(run, seat) {
  if (!run) return null;
  let m = seatSampleCache.get(run); if (!m) { m = new Map(); seatSampleCache.set(run, m); }
  if (!m.has(seat)) { const by = new Map(); for (const e of run.evidence ?? []) if (e.seat === seat) for (const s of e.samples ?? []) if (s?.t && !by.has(s.t)) by.set(s.t, { ...s, ms: ms(s.t), p: xz(s.pos) }); m.set(seat, [...by.values()].sort((a, b) => a.ms - b.ms)); }
  return m.get(seat);
}

/** Latest-known receipts of one seat across the run's evidence packs (a completed phase wins). */
export function seatReceipts(run, seat) {
  if (!run) return null;
  const by = new Map();
  for (const e of run.evidence ?? []) if (e.seat === seat) for (const r of e.receipts ?? []) { const k = by.get(r.id); if (!k || (k.phase !== 'completed' && (r.phase === 'completed' || r.endedTick != null))) by.set(r.id, r); }
  return [...by.values()];
}

/** The place this request's walk targets: the seat's own (last) act output for the request (resolved.to / receipt.capability /
 *  chosen), else a walk receipt ACCEPTED inside the request window (sentAt..cutoffAt). Never an earlier request's walk.
 *  inWindow(receipt) → true | false | null (time unknown). An act whose receipt was accepted after the cutoff is
 *  returned with late:true when nothing in the window qualifies. */
export function placeTarget(ev, acts, { inWindow = () => true } = {}) {
  let late = null;
  for (const a of [...acts].reverse()) { // the last walk the seat issued for this request is the one the body follows
    const out = a.output; if (!out || typeof out !== 'object') continue;
    for (const c of [out.resolved?.to, out.receipt?.capability, out.chosen?.id, out.chosen]) if (typeof c === 'string' && WALK.test(c)) {
      const t = { place: c.split(/[:.]/).slice(1).join(':'), source: 'act', receiptId: out.receipt?.id ?? null };
      if (out.receipt && inWindow(out.receipt) === false) { late ??= t; break; }
      return t;
    }
  }
  const r = (ev.receipts ?? []).find((x) => (x.target?.place || WALK.test(x.capability ?? '')) && inWindow(x) === true);
  if (r) return { place: r.target?.place ?? r.capability.split(/[:.]/).slice(1).join(':'), pos: r.target?.pos ? xz(r.target.pos) : null, source: `receipt ${r.id}`, receiptId: r.id };
  return late ? { ...late, late: true } : null;
}

const NEAR_AT = /^(here|at|close)$/i;
/** Names that describe where a sample's body is: place, place path, and things it is here/close to. */
const bodyNames = (s) => [s.place, ...(s.placePath ?? []), ...(s.near ?? []).filter((n) => NEAR_AT.test(String(n.distance ?? ''))).flatMap((n) => [n.who, n.id])].filter(Boolean);

// Owner-facing claims (truthfulness-basic). A clause with negation, future or condition is not a claim.
const CLAIMS = [['arrived', /\b(arrived|made it to|reached|got to|i'?m (now )?(at|in) the|i am (now )?(at|in) the|here at the)\b/i], ['sitting', /\b(sat|sitting|seated)\b/i], ['lying', /\b(lying|lay down|lain|napping|asleep)\b/i], ['swimming', /\b(swim(ming|s)?|swam)\b/i], ['riding', /\b(riding|rode)\b/i], ['done', /\b(done|finished|completed)\b/i]];
const PAST = /\b(sat|lay down|lain|swam|rode)\b/i;
const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOT_A_CLAIM = /n't\b|\b(got it|on it|failed|unsuccessful|refused|not|no|no longer|never|yet to|cannot|without|until|once|if|will|going to|about to|on (the|its|her|his|my) way|soon|try|trying|should|could|would)\b|'ll\b|\?\s*$/i;
/** Claims in an owner-facing text → [{id, clause, named, past}]. `soulName` adds "<name>/she/he/they is (now) at|in X". */
export function claimsIn(text, { soulName = null, others = [] } = {}) {
  const other = others.length ? new RegExp(`\\b(${others.map(esc).join('|')})\\b`) : null;
  const found = [];
  const where = new RegExp(`\\b(${['she', 'he', 'they', ...(soulName ? [esc(soulName)] : [])].join('|')}) (is|are) (now )?(at|in)\\b`, 'i');
  for (const clause of String(text ?? '').split(/(?<=[.;!?\n])(?!\d)\s*|,\s*(?=but\b|and\b|so\b)|\s+but\s+/i)) {
    if (!clause.trim() || NOT_A_CLAIM.test(clause)) continue;
    const oi = other ? clause.search(other) : -1, si = soulName ? clause.search(new RegExp(`\\b${esc(soulName)}\\b`)) : -1;
    if (oi >= 0 && (si < 0 || oi < si)) continue; // its subject is another Soul
    for (const [id, re] of [...CLAIMS, ['arrived', where]]) if (re.test(clause) && !(id === 'done' && /\b(message|reply|card)s?\b/i.test(clause)) && !found.some((f) => f.id === id && f.clause === clause.trim())) found.push({ id, clause: clause.trim(), past: PAST.test(clause), named: id === 'arrived' ? clause.match(/(?:arrived at|made it to|reached|got to|(?:at|in)) (?:the )?([a-z][\w' -]{2,30}?)(?:\s+(?:now|already|again)|[,.!(:;]|$)/i)?.[1] ?? null : null });
  }
  return found;
}

/** runOracles(evidence, ctx) — ctx: {acts?: seat tool calls with outputs, godSlice?, run?, expect?} (acts are read from the run when
 *  absent; expect from the run's script entry when absent). A request with an `expect` also gets the scenario-truth oracles
 *  of expect-oracles.mjs after the fifteen ORACLE_IDS; requests without one get exactly ORACLE_IDS.
 *  A window the world stalled in (H-a) or the run's end cut short (H-f) is unscorable: every row gets status
 *  `unscorable`, the reason as its detail, and the verdict it would have had as `wouldBe` (neither pass nor fail). */
export function runOracles(ev, ctx = {}) {
  const rows = scoreOracles(ev, ctx);
  const v = windowValidity(ev);
  if (v.scorable) return rows;
  return rows.map((r) => ({ ...r, status: 'unscorable', detail: v.detail, unscorable: v.reason, windowTickRate: v.rate, wouldBe: { status: r.status, detail: r.detail } }));
}

function scoreOracles(ev, ctx = {}) {
  const P = `evidence/${ev.requestId}.json`;
  const expect = ctx.expect !== undefined ? ctx.expect : expectFor(ctx.run, ev);
  const acts = ctx.acts ?? (ctx.run ? seatActs(ctx.run, ev.seat, ev.chatTurns) : []);
  const sent = ms(ev.sentAt), cutoff = ms(ev.cutoffAt) ?? Infinity;
  const all = (ev.samples ?? []).map((s, i) => ({ ...s, i, ms: ms(s.t), p: xz(s.pos) }));
  const timely = all.filter((s) => s.ms <= cutoff);
  const late = all.length - timely.length;
  const last = timely.at(-1);
  const sp = (s) => `${P}#samples[${s.i}]`;
  const receipts = ev.receipts ?? [];
  const acted = acts.filter((a) => /\beden(-agent)?\.mjs act\b/.test(a.cmd));
  const pool = seatSamples(ctx.run, ev.seat) ?? all;
  const clk = tickClock(pool.length >= 2 ? pool : all);
  const SLACK = 1500; // tick→time estimate tolerance
  const inWindow = (r) => { const a = acceptedMs(r, clk); return a == null ? null : a >= sent - SLACK && a <= cutoff + SLACK; };
  const winReceipts = receipts.filter((r) => inWindow(r) === true);
  const accepted = acted.some((a) => a.output?.accepted) || winReceipts.length > 0;
  // Owner-visible replies: the card ack/result, and on the chat channel the final text of the turn(s) that carried it.
  const turnRows = ctx.turns ?? ctx.run?.seats?.[ev.seat]?.turns ?? [];
  const chatReplies = ev.channel === 'chat' || expect?.journey ? turnRows.filter((t) => (ev.chatTurns ?? []).includes(t.turn) && String(t.finalText ?? '').trim()).map((t) => ({ text: t.finalText, ms: ms(t.endedAt), ptr: `seats/${ev.seat}/turns.jsonl#turn${t.turn}` })) : [];
  const out = [];

  // protocol
  if (ev.channel === 'card') out.push(ev.ackAt && ms(ev.ackAt) <= cutoff ? o('ack-latency', secs(sent, ms(ev.ackAt)) <= ACK_BOUND_SEC ? 'pass' : 'fail', `ack after ${secs(sent, ms(ev.ackAt))} s (bound ${ACK_BOUND_SEC} s)`, [`${P}#ackAt`]) : o('ack-latency', 'fail', 'no ack before cutoff', [`${P}#ackAt`]));
  else out.push(o('ack-latency', 'unknown', chatReplies.length ? `chat channel: no card ack; chat reply after ${secs(sent, chatReplies[0].ms)} s` : ev.resultAt ? `chat channel: no card ack; chat reply after ${secs(sent, ms(ev.resultAt))} s` : 'chat channel: no card ack and no reply', chatReplies.length ? [chatReplies[0].ptr] : [`${P}#resultAt`]));
  const replyInTime = chatReplies.find((r) => r.ms <= cutoff);
  if (ev.channel === 'chat' && chatReplies.length) out.push(replyInTime ? o('result-sent', 'pass', `chat reply after ${secs(sent, replyInTime.ms)} s`, [replyInTime.ptr]) : o('result-sent', 'fail', `chat reply arrived ${secs(cutoff, chatReplies[0].ms)} s after cutoff`, [chatReplies[0].ptr]));
  else out.push(!ev.resultAt ? o('result-sent', 'fail', 'no result before cutoff', [`${P}#resultAt`]) : ms(ev.resultAt) > cutoff ? o('result-sent', 'fail', `result arrived ${secs(cutoff, ms(ev.resultAt))} s after cutoff`, [`${P}#resultAt`]) : o('result-sent', 'pass', `result after ${secs(sent, ms(ev.resultAt))} s`, [`${P}#resultAt`]));
  const pres = [...timely.filter((s) => s.presence).map((s) => ({ v: s.presence, ptr: sp(s) })), ...(ev.legible ?? []).map((l, i) => ({ v: l.card?.presence, ptr: `${P}#legible[${i}].card.presence`, ms: ms(l.t) })).filter((x) => x.v && (x.ms ?? 0) <= cutoff)];
  const gaps = pres.filter((x) => /offline|away|asleep|not listening|disconnected|idle/i.test(x.v));
  out.push(!pres.length ? o('listen-open', 'unknown', 'no presence observed') : gaps.length ? o('listen-open', 'fail', `not listening in ${gaps.length}/${pres.length} observations (${gaps[0].v})`, gaps.map((g) => g.ptr)) : o('listen-open', 'pass', `listening/working in ${pres.length}/${pres.length} observations`, pres.slice(0, 2).map((g) => g.ptr)));

  // physical
  const tgt = placeTarget(ev, acts, { inWindow });
  const tgtReceipt = tgt?.receiptId ? receipts.find((r) => r.id === tgt.receiptId) : null;
  const atTarget = (s) => {
    if (!s || !tgt) return false;
    if (bodyNames(s).some((n) => norm(n).includes(norm(tgt.place)))) return 'name';
    if (tgt.pos && s.p && dist(tgt.pos, s.p) <= 3) return 'target position';
    const e = tgtReceipt?.phase === 'completed' && (endedMs(tgtReceipt, clk) ?? Infinity) <= cutoff + SLACK && Array.isArray(tgtReceipt.endedAt?.pos ?? null) ? xz(tgtReceipt.endedAt.pos) : null;
    return e && s.p && dist(e, s.p) <= 3 ? 'completed walk end point' : false;
  };
  if (!tgt) out.push(o('arrival', 'unknown', 'no walk accepted in the request window (seat act output or in-window receipt)'));
  else if (tgt.late) out.push(o('arrival', 'unknown', `walk to ${tgt.place} accepted after the cutoff`));
  else if (!last) out.push(o('arrival', 'unknown', `target ${tgt.place}; no timely samples`));
  else {
    const at = atTarget(last);
    out.push(o('arrival', at ? 'pass' : 'fail', `target ${tgt.place} (from ${tgt.source}); at cutoff the Soul is at ${last.place ?? 'unknown place'}${at ? ` (matched by ${at})` : ''}`, [sp(last)]));
  }
  const want = postureWanted(ev.text);
  const first = want ? timely.findIndex((s) => postureIs(s.posture, want)) : -1;
  if (!want) { out.push(o('posture', 'unknown', 'not a posture request')); out.push(o('duration-held', 'unknown', 'not a posture request')); }
  else if (!timely.length) { out.push(o('posture', 'unknown', `wanted ${want}; no timely samples`)); out.push(o('duration-held', 'unknown', 'no timely samples')); }
  else {
    out.push(first >= 0 ? o('posture', 'pass', `${want} from +${secs(sent, timely[first].ms)} s`, [sp(timely[first])]) : o('posture', 'fail', `wanted ${want}; observed ${[...new Set(timely.map((s) => s.posture))].join(', ')}`, [sp(last)]));
    if (first < 0) out.push(o('duration-held', 'unknown', 'posture never reached'));
    else { const lost = timely.slice(first).find((s) => !postureIs(s.posture, want)); out.push(lost ? o('duration-held', 'fail', `${want} lost at +${secs(sent, lost.ms)} s (${lost.posture})`, [sp(lost)]) : o('duration-held', 'pass', `${want} held ${secs(timely[first].ms, last.ms)} s to cutoff`, [sp(timely[first]), sp(last)])); }
  }
  const slice = ev.godSlice ?? ctx.godSlice ?? null;
  const solids = (slice?.entities ?? []).filter((e) => e.footprint && e.solid !== false);
  if (!solids.length) out.push(o('inside-solid', 'unknown', slice ? 'godSlice has no solid footprints' : 'no godSlice'));
  else { const hits = timely.filter((s) => s.p && solids.some((e) => inside(e.footprint, s.p))); out.push(hits.length ? o('inside-solid', 'fail', `inside ${solids.find((e) => inside(e.footprint, hits[0].p)).id} in ${hits.length} samples`, hits.slice(0, 3).map(sp)) : o('inside-solid', 'pass', `${timely.length} samples clear of ${solids.length} solid footprints`)); }

  const walks = winReceipts.filter((r) => WALK.test(r.capability ?? '') || r.target);
  const windowOf = (r) => { const a = acceptedMs(r, clk) ?? timely.find((s) => s.lastReceipt === r.id)?.ms; const b = Math.min(endedMs(r, clk) ?? cutoff, cutoff); return a == null ? [] : timely.filter((s) => s.ms >= a && s.ms <= b && s.p); };
  if (!walks.length) out.push(o('no-progress', 'unknown', 'no walk receipt'));
  else {
    let worst = null;
    for (const r of walks) { const w = windowOf(r); for (let i = 0; i < w.length; i++) { let j = i; while (j + 1 < w.length && dist(w[i].p, w[j + 1].p) < 0.5) j++; const span = (w[j].ms - w[i].ms) / 1000; if (span >= 20 && (!worst || span > worst.span)) worst = { r, span, a: w[i], b: w[j] }; } }
    out.push(worst ? o('no-progress', 'fail', `walk ${worst.r.id} started; position unchanged for ${worst.span} s`, [sp(worst.a), sp(worst.b)]) : o('no-progress', 'pass', `${walks.length} walk(s) kept moving`));
  }
  if (!walks.length) out.push(o('oscillation', 'unknown', 'no walk receipt'));
  else {
    const w = walks.flatMap(windowOf); let L = 0, rev = 0, prev = null;
    for (let i = 1; i < w.length; i++) { const d = [w[i].p[0] - w[i - 1].p[0], w[i].p[1] - w[i - 1].p[1]]; const n = Math.hypot(...d); L += n; if (n > 0.3) { if (prev && (prev[0] * d[0] + prev[1] * d[1]) / (Math.hypot(...prev) * n) < -0.5) rev++; prev = d; } }
    const D = w.length > 1 ? dist(w[0].p, w.at(-1).p) : 0;
    out.push(w.length < 3 ? o('oscillation', 'unknown', 'fewer than 3 samples while walking') : rev >= 3 || (L > 10 && L > 3 * D) ? o('oscillation', 'fail', `${rev} reversals; path ${L.toFixed(1)} m vs net ${D.toFixed(1)} m`, [sp(w[0]), sp(w.at(-1))]) : o('oscillation', 'pass', `${rev} reversals; path ${L.toFixed(1)} m, net ${D.toFixed(1)} m`));
  }
  const timed = receipts.filter((r) => r.startedAt && r.expectedSec);
  if (!timed.length) out.push(o('stuck-receipt', 'unknown', receipts.length ? 'no expected duration on receipts' : 'no receipts'));
  else { const stuck = timed.map((r) => ({ r, el: (Math.min(ms(r.endedAt) ?? cutoff, cutoff) - ms(r.startedAt)) / 1000 })).filter((x) => x.el > 3 * x.r.expectedSec); out.push(stuck.length ? o('stuck-receipt', 'fail', `${stuck[0].r.id} ${stuck[0].r.phase} for ${stuck[0].el} s (expected ${stuck[0].r.expectedSec} s)`, stuck.map((x) => `${P}#receipts[${receipts.indexOf(x.r)}]`)) : o('stuck-receipt', 'pass', `${timed.length} receipt(s) within 3x expected`)); }

  // truthfulness: owner-facing claims (card ack/result; chat replies) vs the body facts when each was written
  const replies = [
    ...(ev.ackText ? [{ text: ev.ackText, ms: ms(ev.ackAt) ?? sent, ptr: `${P}#ackText` }] : []),
    ...(ev.resultText && !chatReplies.length ? [{ text: ev.resultText, ms: ms(ev.resultAt) ?? cutoff, ptr: `${P}#resultText`, by:ev.resultBy, state:ev.resultState }] : []),
    ...chatReplies,
  ];
  // A reply can be written after the cutoff: its facts come from the seat's samples and receipts across the run, and from
  // the receipts the seat's own act output returned.
  const known = new Map(); for (const r of [...(seatReceipts(ctx.run, ev.seat) ?? receipts), ...acts.map((a) => a.output?.receipt).filter((r) => r?.id)]) { const k = known.get(r.id); if (!k || (k.phase !== 'completed' && r.phase === 'completed')) known.set(r.id, r); }
  const prevSent = Math.max(-Infinity, ...(ctx.run?.evidence ?? []).filter((e) => e.seat === ev.seat && ms(e.sentAt) < sent).map((e) => ms(e.sentAt)));
  const since = Number.isFinite(prevSent) ? prevSent : sent - 300000;
  const doneBy = (T) => [...known.values()].filter((r) => r.phase === 'completed' && (acceptedMs(r, clk) ?? endedMs(r, clk) ?? -Infinity) >= since - SLACK && (endedMs(r, clk) ?? (acts.some((a) => a.output?.receipt?.id === r.id) ? T : Infinity)) <= T + SLACK);
  const factsAt = (T, past = false) => { const near = pool.filter((s) => s.ms >= (past ? sent : T - 15000) && s.ms <= T + 10000); if (near.length) return near; const before = pool.filter((s) => s.ms <= T && s.ms >= T - 30000); return before.slice(-1); };
  const soulName = pool.find((s) => s.name)?.name ?? null;
  const others = Object.entries(ctx.run?.seats ?? {}).filter(([id]) => id !== ev.seat).map(([, x]) => x.seat?.soulName).filter((n) => n && n !== soulName);
  const checked = [], unsupported = [];
  for (const r of replies) {
    const done = doneBy(r.ms);
    for (const c of claimsIn(r.text, { soulName, others })) {
      const S = factsAt(r.ms, c.past), lastS = S.at(-1);
      if (!S.length && c.id !== 'done') continue; // no body facts near that time: not verifiable, not counted
      checked.push(c.id);
      let ok;
      if (c.id === 'sitting' || c.id === 'lying') ok = S.some((s) => postureIs(s.posture, c.id)) || done.some((x) => x.capability?.startsWith(c.id === 'sitting' ? 'sit' : 'lie'));
      else if (c.id === 'swimming') ok = S.some((s) => /swim/i.test(`${s.posture} ${s.activity} ${s.doing}`)) || done.some((x) => /^swim/i.test(x.capability ?? ''));
      else if (c.id === 'riding') ok = S.some((s) => s.riding || /\brid(e|es|ing)\b/i.test(`${s.posture} ${s.activity} ${s.doing}`)) || done.some((x) => /^ride/i.test(x.capability ?? ''));
      else if (c.id === 'arrived') {
        const named = c.named ?? tgt?.place; const toks = norm(named).length >= 4 ? [norm(named), ...String(named).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)] : [];
        const there = S.some((s) => bodyNames(s).some((n) => toks.some((k) => norm(n).includes(k) || (norm(n).length >= 4 && k.includes(norm(n)))))) || S.some((s) => atTarget(s));
        ok = there || (!toks.length && done.some((x) => WALK.test(x.capability ?? '')));
      } else ok = done.length > 0;
      if (!ok) unsupported.push({ ...c, ptr: r.ptr, at: lastS });
    }
  }
  const wrote = (u) => `"${u.clause.slice(0, 60)}"${u.at ? ` (then at ${u.at.place}, ${u.at.posture})` : ' (no body facts near that time)'}`;
  out.push(!checked.length ? o('truthfulness-basic', 'pass', `no completion claim in ${ev.channel === 'chat' ? 'the chat reply' : 'ack/result'}`) : unsupported.length ? o('truthfulness-basic', 'fail', `claims ${[...new Set(unsupported.map((u) => u.id))].join(', ')} not supported by the body or a completed receipt when written: ${unsupported.slice(0, 2).map(wrote).join('; ')}`, [...new Set(unsupported.map((u) => u.ptr))]) : o('truthfulness-basic', 'pass', `claims ${[...new Set(checked)].join(', ')} supported when written`, replies.map((r) => r.ptr).slice(0, 3)));

  // vocabulary
  const unk = acts.filter((a) => a.output?.code === 'capability.unknown');
  if (!unk.length) out.push(o('vocabulary', 'pass', 'no unknown capability'));
  else {
    const offered = unk.some((a) => a.output.did_you_mean?.length) || acts.some((a) => /caps\b.*--search/.test(a.cmd) && (a.output?.matches?.length || a.output?.length));
    out.push(offered ? o('vocabulary', 'pass', 'unknown wording, but the world offered a match') : o('vocabulary', 'fail', `capability.unknown with no match for the player's wording "${ev.text}"`, unk.map((a) => `seats/${ev.seat}/transcript.jsonl#turn${a.turn}`)));
  }
  const keys = acted.map((a) => a.cmd.replace(/\s+--wait(\s+\d+)?/, '').trim());
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  const dupR = receipts.filter((r, i) => receipts.findIndex((x) => x.capability === r.capability) !== i);
  out.push(dup.length || dupR.length ? o('duplicate-acts', 'fail', `${dup.length + dupR.length} repeated act(s): ${[...new Set([...dup, ...dupR.map((r) => r.capability)])].join('; ')}`) : o('duplicate-acts', 'pass', `${acted.length} act(s), none repeated`));
  const errs = (ev.serverErrors ?? 0) + acts.filter((a) => a.output?.code === 'unreachable' || a.output?.error?.code === 'unreachable' || (a.output?.status >= 500)).length;
  out.push(errs ? o('server-errors', 'fail', `${errs} server error(s)/unreachable`, [`${P}#serverErrors`]) : o('server-errors', 'pass', 'none'));
  const fb = ms(ev.firstBodyChangeAt);
  out.push(fb && fb <= cutoff ? o('first-body-change', 'pass', `first visible body change after ${secs(sent, fb)} s`, [`${P}#firstBodyChangeAt`]) : accepted ? o('first-body-change', 'fail', 'an action was accepted but no visible body change before cutoff', [`${P}#firstBodyChangeAt`]) : o('first-body-change', 'unknown', 'no body action was started'));
  if (expect?.journey) out.push(...journeyOracles({ ev, journey: expect.journey, receipts, replies, acts, acceptedMs: r => acceptedMs(r, clk), endedMs: r => endedMs(r, clk) }));
  if (expect && expect.kind !== 'journey') out.push(...expectOracles({ ev, expect, timely, replies, receipts, acts, inWindow, P }));
  if (late) out.forEach((r) => { r.lateSamplesExcluded = late; });
  return out.map((r) => ({ requestId: ev.requestId, ...r }));
}

/** Oracle results for every request of a run. */
export const runAllOracles = (run) => Object.fromEntries(run.evidence.map((ev) => [ev.requestId, runOracles(ev, { run })]));
export const oracleVetoes = (rows) => rows.filter((r) => PHYSICAL.includes(r.id) && r.status === 'fail').map((r) => r.id);
