// Question (#623 S3, necessary refusals help recovery): the owner asked for something this world cannot do here (the
// hello-hamlet reading room's only door is closed, "so entry is unavailable"). Did the refusal say why and name at least
// one thing the Soul can do instead, and did acting on that offer work in the world? The refusal is the world's answer
// to the act call; the recovery's outcome is what the world later shows for its receipt (never the seat's claim).
// The outcome logic is repeated from reasonable-carried-out on purpose: a question's hash covers only its own file.
import { actOutcome } from '../evaluate.mjs';

const NECESSARY = /reading room/i;
const ENDED_BAD = ['failed', 'refused', 'cancelled', 'interrupted'], ENDED = [...ENDED_BAD, 'completed', 'replaced'];
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

export default {
  id: 'refusal-helps',
  version: 2,
  question: 'When an owner asked for something the world cannot do here (into the closed reading room), did the refusal give a reason and name an offer, and did acting on that offer work?',
  assumptions: [
    'The request is the act call whose words match /reading room/. An offer is any id in the refusal\'s alternatives or did_you_mean.',
    'Recovery is the seat\'s next act before its next ack whose capability is one of those offer ids; it works when the world shows it completed or its activity reached and held (in a sample or the receipt\'s end record, endedAt, since v2).',
    'An accepted request is unknown (the template says entry is unavailable, so acceptance needs a look); a refusal with no reason or no offer fails; no act on an offer fails (nothing was recovered).',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const steps = ctx.steps(seat);
      steps.forEach((s, i) => {
        if (s.verb !== 'act' || !NECESSARY.test(s.args[0] ?? '')) return;
        evidence.push(ctx.stepRef(s));
        const o = s.out && typeof s.out === 'object' ? s.out : {};
        if (!s.isError && o.accepted !== false) { rows.push({ seat, words: s.args[0], refused: false, capability: o.receipt?.capability ?? null }); return; }
        const offers = [...(o.alternatives ?? []), ...(o.did_you_mean ?? [])].map((x) => x?.id).filter(Boolean);
        const nextAck = steps.findIndex((x, j) => j > i && x.verb === 'ack');
        const rec = steps.slice(i + 1, nextAck < 0 ? undefined : nextAck).find((x) => x.verb === 'act' && offers.includes(x.args[0]));
        let recovery = null;
        if (rec) {
          evidence.push(ctx.stepRef(rec));
          const ok = !rec.isError && rec.out?.accepted !== false, w = ok ? worldOutcome(ctx, seat, rec) : { outcome: 'failed', why: rec.out?.code ?? 'not accepted' };
          evidence.push(...(w.packRefs ?? []).map((p) => ctx.ref(`playtest/evidence/${p}.json`)));
          recovery = { capability: rec.args[0], outcome: w.outcome, ...(w.why ? { why: w.why } : {}) };
        }
        rows.push({ seat, words: s.args[0], refused: true, code: o.code ?? null, reason: String(o.reason ?? '').slice(0, 200), offers, recovery });
      });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no reading-room request in this run', evidence };
    const notes = rows.map((x) => !x.refused ? `${x.seat}: "${x.words}" was accepted (${x.capability})` : `${x.seat}: refused ${x.code} ("${x.reason}"), offers ${x.offers.join(', ') || 'none'}; recovery ${x.recovery ? `${x.recovery.capability} ${x.recovery.outcome}` : 'none'}`);
    if (rows.some((x) => !x.refused)) return { verdict: 'unknown', uncertainty: 'the world accepted a reading-room request; whether that was right needs a look', evidence, detail: rows, notes };
    const pass = rows.every((x) => x.reason.trim() && x.offers.length && ['completed', 'ongoing'].includes(x.recovery?.outcome));
    if (!pass && rows.some((x) => x.recovery?.outcome === 'started')) return { verdict: 'unknown', uncertainty: 'a recovery receipt has no world record after it started', evidence, detail: rows, notes };
    return { verdict: pass ? 'pass' : 'fail', evidence, detail: rows, notes };
  },
};
