// Question (#623 S3, necessary refusals help recovery), v3 (#1098 candidate arm): v2 looks for an act whose words name the reading
// room, which the strict contract refuses as words, so it can only answer unknown there. v3 follows the owner's reading-room message:
// the seat's lookups and acts for it, and the first refusal the world gave, by act or by resolve. Never a seat's claim.
import { actOutcome } from '../evaluate.mjs';

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

/** The owner's requests, from the evidence packs (each names its text and when it was sent). The seat's ack step gives the message id: the
 *  one whose text the pack recorded, else the seat's first unclaimed ack after it was sent (the director records only its latest card's ack). */
function requestsOf(ctx) {
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
function stepsFor(ctx, r) {
  const steps = ctx.steps(r.seat), id = r.messageId, ack = steps.findIndex((s) => s.verb === 'ack' && s.args[0] === id);
  const res = steps.findIndex((s) => s.verb === 'result' && s.args[0] === id), end = res < 0 ? steps.length : res;
  const tied = (s) => s.args.includes(id) || s.out?.for === id, free = (s) => !s.args.includes('--for') || s.args.includes('none');
  const acts = steps.filter((s, i) => s.verb === 'act' && (tied(s) || (ack >= 0 && i > ack && i < end && free(s))));
  return { steps, ack: ack >= 0 ? steps[ack] : null, result: res >= 0 ? steps[res] : null, between: ack >= 0 ? steps.slice(ack + 1, end) : [], acts };
}


const ROOM = /reading[- ]room/i;
const refused = (s) => (s.verb === 'act' && (s.isError || s.out?.accepted === false)) || (s.verb === 'resolve' && s.out?.ok === false);

export default {
  id: 'refusal-helps',
  version: 3,
  question: 'When an owner asked for something the world cannot do here (into the closed reading room), did the world\'s refusal give a reason and name an offer, and did acting on that offer work?',
  assumptions: [
    'The request is the owner message naming the reading room. Its steps run from the seat\'s ack to its result on that message, plus acts tied to it with --for.',
    'The refusal is the first act or resolve in those steps that the world refused, whose words name the reading room or which is tied to the request. An offer is any id in its alternatives or did_you_mean.',
    'Recovery is the seat\'s next act, at any later point, whose capability is one of those offers; it works when the world shows it completed or held.',
    'No refusal in those steps is unknown: the seat decided without being told (a resolve can answer with an unrelated offer). A refusal with no reason or no offer fails; no act on an offer fails.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const r of requestsOf(ctx)) {
      if (!r.messageId || !ctx.hasTranscript(r.seat) || !ROOM.test(r.text)) continue;
      const seat = r.seat, { ack, between, acts } = stepsFor(ctx, r); if (!ack) continue;
      const mine = [...new Set([...between, ...acts])].sort((x, y) => x.line - y.line);
      evidence.push(ctx.stepRef(ack));
      const no = mine.find((s) => refused(s) && (ROOM.test(s.args[0] ?? '') || s.args.includes(r.messageId)));
      if (!no) { rows.push({ seat, refused: false, lookedUp: mine.filter((s) => ['resolve', 'caps'].includes(s.verb)).map((s) => s.args.join(' ')) }); continue; }
      evidence.push(ctx.stepRef(no));
      const o = no.out && typeof no.out === 'object' ? no.out : {}, offers = [...(o.alternatives ?? []), ...(o.did_you_mean ?? [])].map((x) => x?.id).filter(Boolean);
      const rec = ctx.steps(seat).filter((x) => x.line > no.line).find((x) => x.verb === 'act' && offers.includes(x.args[0]));
      let recovery = null;
      if (rec) { evidence.push(ctx.stepRef(rec)); const ok = !rec.isError && rec.out?.accepted !== false, w = ok ? worldOutcome(ctx, seat, rec) : { outcome: 'failed', why: rec.out?.code ?? 'not accepted' }; recovery = { capability: rec.args[0], outcome: w.outcome, ...(w.why ? { why: w.why } : {}) }; }
      rows.push({ seat, refused: true, by: no.verb, code: o.code ?? null, reason: String(o.reason ?? '').slice(0, 200), offers, recovery });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no reading-room request in this run', evidence };
    const notes = rows.map((x) => !x.refused ? `${x.seat}: no refusal; looked up ${x.lookedUp.join(', ') || 'nothing'}` : `${x.seat}: ${x.by} refused ${x.code} ("${x.reason}"), offers ${x.offers.join(', ') || 'none'}; recovery ${x.recovery ? `${x.recovery.capability}, ${x.recovery.outcome}` : 'none'}`);
    if (rows.some((x) => !x.refused)) return { verdict: 'unknown', uncertainty: 'no refusal was given for the request, so there is nothing to score', evidence, detail: rows, notes };
    const pass = rows.every((x) => x.reason.trim() && x.offers.length && ['completed', 'ongoing'].includes(x.recovery?.outcome));
    if (!pass && rows.some((x) => x.recovery?.outcome === 'started')) return { verdict: 'unknown', uncertainty: 'a recovery receipt has no world record after it started', evidence, detail: rows, notes };
    return { verdict: pass ? 'pass' : 'fail', evidence, detail: rows, notes };
  },
};
