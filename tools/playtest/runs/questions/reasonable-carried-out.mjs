// Question (#623 S3, reasonable actions): when owners asked for ordinary things the world offers, in their own words,
// did the world accept each one at once and carry it out? Acceptance is the world's answer to the seat's act call; the
// outcome is what the world later shows for that receipt id (the act's own --wait answer, the seat's receipt checks and
// the evidence packs' receipts and samples). The seat's result claim never counts. Demo-specific: the one request the
// demo expects to be refused (the closed reading room) is scored by refusal-helps instead.
import { actOutcome } from '../evaluate.mjs';

export const NECESSARY = /reading room/i;
const ENDED_BAD = ['failed', 'refused', 'cancelled', 'interrupted'], ENDED = [...ENDED_BAD, 'completed', 'replaced'];

/** What the world shows for one accepted act's receipt: completed | ongoing (its activity reached and held, e.g. seated
 *  or swimming, before anything replaced it) | failed | cut-short (replaced before it got there) | started (no later
 *  record). Kept in this file (apart from evaluate.mjs actOutcome) so the question hash covers it. */
export function worldOutcome(ctx, seat, step) {
  const id = step.out?.receipt?.id; if (!id) return { outcome: 'unknown', why: 'no receipt id' };
  const own = actOutcome(step), phases = [own.phase ?? null];
  for (const s of ctx.steps(seat)) if (s.verb === 'receipt' && s.args[0] === id && s.line > step.line) phases.push(s.out?.phase ?? s.out?.receipt?.phase ?? null);
  const packs = ctx.evidencePacks ?? [], samples = packs.flatMap((p) => (p.samples ?? []).filter((x) => x.lastReceipt?.id === id));
  for (const p of packs) for (const r of p.receipts ?? []) if (r?.id === id) phases.push(r.phase ?? null);
  for (const x of samples) phases.push(x.lastReceipt.phase ?? null);
  const reached = own.outcome === 'ongoing' || samples.some((x) => !ENDED.includes(x.lastReceipt.phase) && !['walking', 'standing'].includes(x.posture));
  const packRefs = packs.filter((p) => (p.receipts ?? []).some((r) => r?.id === id) || (p.samples ?? []).some((x) => x.lastReceipt?.id === id)).map((p) => p.requestId);
  if (phases.includes('completed')) return { outcome: 'completed', packRefs };
  const bad = phases.find((ph) => ENDED_BAD.includes(ph)); if (bad) return { outcome: 'failed', why: bad, packRefs };
  if (reached) return { outcome: 'ongoing', packRefs };
  if (phases.includes('replaced')) return { outcome: 'cut-short', why: 'replaced before its activity was reached', packRefs };
  return { outcome: 'started', why: 'no later world record of this receipt', packRefs };
}

export default {
  id: 'reasonable-carried-out',
  version: 1,
  question: 'When an owner asked for an ordinary thing the world offers, did the world accept the Soul\'s act in the owner\'s own words at once, and carry it out?',
  assumptions: [
    'A request in the owner\'s words is an act call whose capability argument contains a space (not an offer id); the one matching /reading room/ is the expected refusal and is left to refusal-helps.',
    'Carried out: the world shows the receipt completed, or its activity reached and held (seated, swimming: not walking or standing) before a later request replaced it. Failed, refused, cancelled or interrupted, or replaced before getting there, fails.',
    'A receipt with no world record after it started is unknown, never a pass. Seat result claims never count.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      for (const s of ctx.steps(seat)) {
        if (s.verb !== 'act' || !/\s/.test(s.args[0] ?? '') || NECESSARY.test(s.args[0])) continue;
        evidence.push(ctx.stepRef(s));
        const accepted = !s.isError && s.out && typeof s.out === 'object' && s.out.accepted !== false;
        if (!accepted) { rows.push({ seat, words: s.args[0], accepted: false, code: s.out?.code ?? null, reason: String(s.out?.reason ?? '').slice(0, 160) }); continue; }
        const w = worldOutcome(ctx, seat, s);
        evidence.push(...(w.packRefs ?? []).map((p) => ctx.ref(`playtest/evidence/${p}.json`)));
        rows.push({ seat, words: s.args[0], accepted: true, capability: s.out.receipt?.capability ?? null, outcome: w.outcome, ...(w.why ? { why: w.why } : {}) });
      }
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no act in an owner\'s words in this run', evidence };
    const notes = rows.map((x) => `${x.seat}: "${x.words}" -> ${x.accepted ? `${x.capability}, ${x.outcome}${x.why ? ` (${x.why})` : ''}` : `refused ${x.code}: ${x.reason}`}`);
    if (rows.some((x) => !x.accepted || ['failed', 'cut-short'].includes(x.outcome))) return { verdict: 'fail', evidence, detail: rows, notes };
    if (rows.some((x) => !['completed', 'ongoing'].includes(x.outcome))) return { verdict: 'unknown', uncertainty: 'a receipt has no world record after it started', evidence, detail: rows, notes };
    return { verdict: 'pass', evidence, detail: rows, notes };
  },
};
