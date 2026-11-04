// Question (#623 S3, sustained intent): an owner gave a two-step errand in one message, then sent a burst of chat while
// the first step was under way. Did the errand survive the burst: every step accepted, carried out in the world, in
// order and once each, and was every chat message answered? Outcomes come from the world's records for each receipt id
// (the act's own --wait answer, the seat's receipt checks, the evidence packs); arrival and answer times come from the
// director's evidence packs. The outcome logic is repeated from reasonable-carried-out (a question's hash covers only
// its own file).
import { actOutcome } from '../evaluate.mjs';

const ENDED_BAD = ['failed', 'refused', 'cancelled', 'interrupted'], ENDED = [...ENDED_BAD, 'completed', 'replaced'];
function worldOutcome(ctx, seat, step) {
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
  id: 'errand-kept-through-burst',
  version: 1,
  question: 'When an owner sent chat while a two-step errand was under way, did every errand step still happen in the world, in order and once each, and was every chat message answered?',
  assumptions: [
    'An errand is two or more acts in the owner\'s words (a space in the capability argument) between one ack and that card\'s result.',
    'The burst is the owner cards for that seat (evidence packs) sent after the errand\'s first act started and before its last act returned. No such card: unknown (the condition did not happen).',
    'Carried out: completed, or its activity reached and held (seated). Once each: no second accepted act with the same capability inside the errand. Answered: the card was acknowledged (ackAt); the delay is reported, not scored.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const steps = ctx.steps(seat);
      steps.forEach((ack, i) => {
        if (ack.verb !== 'ack') return;
        const end = steps.findIndex((x, j) => j > i && x.verb === 'result' && x.args[0] === ack.args[0]);
        const acts = steps.slice(i + 1, end < 0 ? undefined : end).filter((x) => x.verb === 'act' && /\s/.test(x.args[0] ?? ''));
        if (acts.length < 2) return;
        evidence.push(ctx.stepRef(ack), ...acts.map(ctx.stepRef));
        const out = acts.map((s) => {
          const ok = !s.isError && s.out && typeof s.out === 'object' && s.out.accepted !== false, w = ok ? worldOutcome(ctx, seat, s) : { outcome: 'failed', why: s.out?.code ?? 'not accepted' };
          evidence.push(...(w.packRefs ?? []).map((p) => ctx.ref(`playtest/evidence/${p}.json`)));
          return { words: s.args[0], capability: s.out?.receipt?.capability ?? null, outcome: w.outcome, ...(w.why ? { why: w.why } : {}) };
        });
        const caps = out.map((x) => x.capability).filter(Boolean), once = new Set(caps).size === caps.length;
        const from = acts[0].atMs, to = acts.at(-1).doneMs ?? acts.at(-1).atMs;
        const burst = (ctx.evidencePacks ?? []).filter((p) => p.seat === seat && Number.isFinite(from) && Number.isFinite(to) && Date.parse(p.sentAt) > from && Date.parse(p.sentAt) < to);
        evidence.push(...burst.map((p) => ctx.ref(`playtest/evidence/${p.requestId}.json`)));
        rows.push({ seat, card: ack.args[0], steps: out, once, burst: burst.map((p) => ({ text: String(p.text ?? '').slice(0, 60), answeredSec: p.ackAt ? Math.round((Date.parse(p.ackAt) - Date.parse(p.sentAt)) / 100) / 10 : null })) });
      });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no multi-step errand in this run', evidence };
    const notes = rows.map((r) => `${r.seat}: ${r.steps.map((x) => `${x.capability ?? x.words} ${x.outcome}`).join(' -> ')}; burst ${r.burst.length} (${r.burst.map((b) => b.answeredSec == null ? 'unanswered' : `answered ${b.answeredSec} s`).join(', ')})`);
    if (rows.some((r) => !r.burst.length)) return { verdict: 'unknown', uncertainty: 'no owner message arrived while an errand was under way', evidence, detail: rows, notes };
    const bad = rows.some((r) => !r.once || r.steps.some((x) => ['failed', 'cut-short'].includes(x.outcome)) || r.burst.some((b) => b.answeredSec == null));
    if (bad) return { verdict: 'fail', evidence, detail: rows, notes };
    if (rows.some((r) => r.steps.some((x) => !['completed', 'ongoing'].includes(x.outcome)))) return { verdict: 'unknown', uncertainty: 'an errand step has no world record after it started', evidence, detail: rows, notes };
    return { verdict: 'pass', evidence, detail: rows, notes };
  },
};
