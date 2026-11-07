// Question (#623 S3, refusal and recovery), v3 (#1098 candidate arm): on the strict contract an agent looks up the owner's words
// with `resolve`, so the refusal arrives there and no `act` is refused. v2 can only answer unknown on it. v3 counts a refusal from
// either: an act answered accepted:false, or a resolve answered ok:false. Deterministic: the seat's CLI calls and the world's answers.
const REFUSABLE = /\bfly\b/i;
const refusalOf = (s) => (s.verb === 'act' && s.out?.accepted === false) || (s.verb === 'resolve' && s.out?.ok === false);
const phaseOf = (s) => (s.verb === 'act' ? s.out?.receipt : s.verb === 'receipt' ? s.out : s.verb === 'wait' ? s.out?.receipt : null);

export default {
  id: 'refusal-recovered',
  version: 3,
  question: 'After the world refused an impossible request, by act or by resolve, did the refusal name an alternative, and did the same Soul then complete a physical act?',
  assumptions: [
    'The impossible request is a seat act or resolve whose words ask to fly, answered accepted:false or ok:false; its code is the reason.',
    'Alternatives are the ids in that answer\'s alternatives or did_you_mean, read from the world\'s answer, not the seat\'s claim.',
    'Recovery is the first physical act by the same seat whose receipt the world reports completed after the refusal, in a later act\'s own answer or a later receipt/wait of any of its receipts.',
    'A refusal that names no alternative fails, even with a recovery: the agent found it some other way.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const all = ctx.steps(seat), refused = all.find((s) => ['act', 'resolve'].includes(s.verb) && REFUSABLE.test(s.args?.[0] ?? '') && refusalOf(s));
      if (!refused) continue;
      const from = all.indexOf(refused), ids = new Map(all.filter((s) => s.verb === 'act' && s.out?.receipt?.id).map((s) => [s.out.receipt.id, s]));
      const done = all.slice(from + 1).find((s) => phaseOf(s)?.phase === 'completed' && (s.verb === 'act' || ids.has(phaseOf(s).id)));
      const recovery = !done ? null : done.verb === 'act' ? done : ids.get(phaseOf(done).id);
      const alternatives = [...(refused.out?.alternatives ?? []), ...(refused.out?.did_you_mean ?? [])].map((a) => a?.id).filter(Boolean);
      evidence.push(ctx.stepRef(refused)); if (done) evidence.push(ctx.stepRef(done));
      rows.push({ seat, by: refused.verb, refusedCode: refused.out?.code ?? null, alternatives, recovery: recovery?.args?.[0] ?? null,
        recoveryIsAlternative: !!recovery && alternatives.some((id) => id === recovery.args?.[0] || id === recovery.out?.receipt?.capability) });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no seat transcript shows an impossible request refused in this run', evidence };
    const notes = rows.map((x) => `${x.seat}: ${x.by} refused ${x.refusedCode ?? 'with no code'}; alternatives ${x.alternatives.join(', ') || 'none'}; recovered with ${x.recovery ?? 'nothing'}${x.recoveryIsAlternative ? ' (an alternative)' : ''}`);
    if (rows.some((x) => !x.refusedCode)) return { verdict: 'unknown', uncertainty: 'a refusal carries no code', evidence, detail: rows, notes };
    return { verdict: rows.every((x) => x.alternatives.length && x.recovery) ? 'pass' : 'fail', evidence, detail: rows, notes };
  },
};
