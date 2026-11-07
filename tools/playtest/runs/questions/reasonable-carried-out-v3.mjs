// Question (#623 S3, reasonable actions), v3 (#1098 candidate arm): v2 looks for an act in the owner's own words, which the strict
// contract refuses, so it can only answer unknown there. v3 starts from what the owner asked: each owner message the seat acknowledged
// that asks for an ordinary thing, and the acts the seat made for it, whatever words or ids those used. The outcome is the world's
// record (never a seat's claim). A request replaced by the owner's next line is unknown, not a fail: v2's fails were mostly the cast's timing.
import { actOutcome } from '../evaluate.mjs';

const NECESSARY = /reading room/i;
const ENDED_BAD = ['failed', 'refused', 'cancelled', 'interrupted'], ENDED = [...ENDED_BAD, 'completed', 'replaced'];

/** (Repeated from v2 on purpose: a question's hash covers only its own file.) What the world shows for one accepted act's receipt: completed | ongoing (its activity reached and held, e.g. seated
 *  or swimming, before anything replaced it) | failed | cut-short (replaced before it got there) | started (no later
 *  record). Kept in this file (apart from evaluate.mjs actOutcome) so the question hash covers it. */
function worldOutcome(ctx, seat, step) {
  const id = step.out?.receipt?.id; if (!id) return { outcome: 'unknown', why: 'no receipt id' };
  const own = actOutcome(step), phases = [own.phase ?? null];
  for (const s of ctx.steps(seat)) if (s.verb === 'receipt' && s.args[0] === id && s.line > step.line) phases.push(s.out?.phase ?? s.out?.receipt?.phase ?? null);
  const packs = ctx.evidencePacks ?? [], samples = packs.flatMap((p) => (p.samples ?? []).filter((x) => x.lastReceipt?.id === id));
  for (const p of packs) for (const r of p.receipts ?? []) if (r?.id === id) phases.push(r.phase ?? null);
  for (const x of samples) phases.push(x.lastReceipt.phase ?? null);
  // the world's end record says where the body was when the receipt ended (a sit replaced while seated was reached)
  const endedAt = packs.flatMap((p) => (p.receipts ?? []).filter((r) => r?.id === id && r.endedAt?.posture).map((r) => r.endedAt.posture));
  const reached = own.outcome === 'ongoing' || samples.some((x) => !ENDED.includes(x.lastReceipt.phase) && !['walking', 'standing'].includes(x.posture))
    || endedAt.some((p) => !['walking', 'standing'].includes(p));
  const packRefs = packs.filter((p) => (p.receipts ?? []).some((r) => r?.id === id) || (p.samples ?? []).some((x) => x.lastReceipt?.id === id)).map((p) => p.requestId);
  if (phases.includes('completed')) return { outcome: 'completed', packRefs };
  const bad = phases.find((ph) => ENDED_BAD.includes(ph)); if (bad) return { outcome: 'failed', why: bad, packRefs };
  if (reached) return { outcome: 'ongoing', packRefs };
  if (phases.includes('replaced')) return { outcome: 'cut-short', why: 'replaced before its activity was reached', packRefs };
  return { outcome: 'started', why: 'no later world record of this receipt', packRefs };
}


const ASKS = /\b(walk|go|sit|swim|stop by|visit|bench|orchard)\b/i, NOT_ORDINARY = /\b(that's all|your turn|talk|fly|don't go|stop,|not to|should be in)\b/i;
/** The owner's requests, from the evidence packs (each names its text and when it was sent). The seat's ack step gives the message id: the
 *  one whose text the pack recorded, else the seat's first unclaimed ack after it was sent (the director records only its latest card's ack). */
export function requestsOf(ctx) {
  const claimed = new Set(), packs = (ctx.evidencePacks ?? []).filter((p) => p.seat && typeof p.text === 'string').sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  const acks = (seat) => ctx.steps(seat).filter((s) => s.verb === 'ack');
  const named = new Map(packs.map((p) => [p, p.ackText ? acks(p.seat).find((s) => s.args[1] === p.ackText) : null]));
  for (const a of named.values()) if (a) claimed.add(a);
  return packs.map((p) => {
    let ack = named.get(p);
    if (!ack) { ack = acks(p.seat).find((s) => !claimed.has(s) && (s.doneMs ?? s.atMs) >= Date.parse(p.sentAt)) ?? null; if (ack) claimed.add(ack); }
    return { seat: p.seat, requestId: p.requestId, text: p.text, sentAt: p.sentAt, resultAt: p.resultAt ?? null, messageId: ack?.args[0] ?? null };
  });
}

/** The seat's steps for one owner request: from its ack to its result on that message (or the end), and acts it tied to it with --for. */
export function stepsFor(ctx, r) {
  const steps = ctx.steps(r.seat), id = r.messageId, ack = steps.findIndex((s) => s.verb === 'ack' && s.args[0] === id);
  const res = steps.findIndex((s) => s.verb === 'result' && s.args[0] === id), end = res < 0 ? steps.length : res;
  const tied = (s) => s.args.includes(id) || s.out?.for === id, free = (s) => !s.args.includes('--for') || s.args.includes('none');
  const acts = steps.filter((s, i) => s.verb === 'act' && (tied(s) || (ack >= 0 && i > ack && i < end && free(s))));
  return { steps, ack: ack >= 0 ? steps[ack] : null, result: res >= 0 ? steps[res] : null, between: ack >= 0 ? steps.slice(ack + 1, end) : [], acts };
}

export default {
  id: 'reasonable-carried-out',
  version: 3,
  question: 'When an owner asked for an ordinary thing the world offers, did the Soul act on it, did the world accept that at once, and was it carried out?',
  assumptions: [
    'A request is an owner message in the run\'s evidence packs, past the opening direction, whose text asks to walk, go, sit, swim, stop by or visit. The closed reading room is left to refusal-helps; the cast\'s closing lines and impossible requests aren\'t ordinary.',
    'The acts for a request are those the seat tied to it with --for, and those untied between its ack and its result on that message.',
    'No act, with the seat closing it as failed, fails: the request was offered and didn\'t happen. If the owner called it off first (a later line opening with stop, don\'t, never mind or change of plan), or the seat was killed during the act, it is unknown. An act the world refused fails.',
    'Carried out: the world shows the last act\'s receipt completed, or its activity reached and held. Replaced by a later line before it got there is unknown. No world record after it started is unknown.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    const requests = requestsOf(ctx);
    for (const r of requests) {
      const text = r.text;
      if (!ctx.hasTranscript(r.seat) || !ASKS.test(text) || NOT_ORDINARY.test(text) || NECESSARY.test(text) || text.length > 200) continue;
      const seat = r.seat;
      evidence.push(ctx.ref(`playtest/evidence/${r.requestId}.json`));
      if (!r.messageId) { rows.push({ seat, text, outcome: 'not-acknowledged' }); continue; }
      const { ack, result, acts } = stepsFor(ctx, r);
      evidence.push(ctx.stepRef(ack));
      // the owner's later line called it off before the seat closed it
      const calledOff = requests.some((x) => x.seat === seat && x.requestId !== r.requestId && Date.parse(x.sentAt) > Date.parse(r.sentAt) && (!r.resultAt || Date.parse(x.sentAt) < Date.parse(r.resultAt)) && /^(?:actually\s+)?(?:stop|don't|never mind)\b|^change of plan\b/i.test(x.text));
      if (calledOff) { rows.push({ seat, text, outcome: 'called-off' }); continue; }
      if (!acts.length) { if (result) evidence.push(ctx.stepRef(result)); rows.push({ seat, text, outcome: result?.args[1] === 'failed' ? 'no-act' : 'no-act-open' }); continue; }
      const last = acts.at(-1); evidence.push(ctx.stepRef(last));
      // killed at the seat's wall limit: the world never answered this act, so it says nothing about the request
      if (last.isError && !(last.out && typeof last.out === 'object')) { rows.push({ seat, text, capability: last.args[0], outcome: 'killed' }); continue; }
      if (last.isError || last.out?.accepted === false) { rows.push({ seat, text, capability: last.args[0], outcome: 'refused', code: last.out?.code ?? null }); continue; }
      const w = worldOutcome(ctx, seat, last);
      rows.push({ seat, text, capability: last.out?.receipt?.capability ?? last.args[0], outcome: w.outcome, ...(w.why ? { why: w.why } : {}) });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no ordinary owner request acknowledged in this run', evidence };
    const notes = rows.map((x) => `${x.seat}: "${x.text.slice(0, 60)}" -> ${x.capability ?? 'no act'}, ${x.outcome}${x.why ? ` (${x.why})` : ''}`);
    if (rows.some((x) => ['no-act', 'refused', 'failed'].includes(x.outcome))) return { verdict: 'fail', evidence, detail: rows, notes };
    if (rows.some((x) => !['completed', 'ongoing'].includes(x.outcome))) return { verdict: 'unknown', uncertainty: 'a request was called off or replaced by a later owner line, was never acknowledged, or has no world record after it started', evidence, detail: rows, notes };
    return { verdict: 'pass', evidence, detail: rows, notes };
  },
};
