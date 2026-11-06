// Question (#623 S3, refusal and recovery): the owner asks for something the world cannot do. Was the act refused with
// a reason, did the refusal name what the Soul could do instead (`alternatives`, #824), and did the Soul then complete
// a physical act? Deterministic: the seat's own CLI calls and the world's answers to them (seat transcript).
const REFUSABLE = /\bfly\b/i;

export default {
  id: 'refusal-recovered',
  version: 2,
  question: 'After the world refused an impossible act, did the refusal name an alternative, and did the same Soul then complete a physical act?',
  assumptions: [
    'The impossible act is a seat act whose words ask to fly, answered accepted:false.',
    'A refusal is an act the world answered with accepted:false; its code is the reason.',
    'Alternatives are read from the world\'s answer to that act call (the seat transcript), not from the seat\'s claim.',
    'Recovery is the first physical act by the same seat whose receipt the world reports completed after the refusal: in a later act\'s own answer, or in a later `receipt`/`wait` of any of its receipts (v2, #1098: an act already under way, such as the walk the refusal named, counts once it completes after the refusal).',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const acts = ctx.steps(seat).filter((s) => s.verb === 'act'), r = {seat};
      const refused = acts.find((s) => REFUSABLE.test(s.args?.[0] ?? '') && s.out?.accepted === false);
      if (!refused) continue;
      const at = refused ? acts.indexOf(refused) : -1;
      // v2: the first completion the world reports after the refusal, whichever call carries it
      const all = ctx.steps(seat), from = all.indexOf(refused), ids = new Map(acts.filter((s) => s.out?.receipt?.id).map((s) => [s.out.receipt.id, s]));
      const done = all.slice(from + 1).find((s) => (s.verb === 'act' && s.out?.receipt?.phase === 'completed') || ((s.verb === 'receipt' ? s.out : s.verb === 'wait' ? s.out?.receipt : null)?.phase === 'completed' && ids.has((s.verb === 'receipt' ? s.out : s.out?.receipt)?.id)));
      const recovery = !done ? null : done.verb === 'act' ? done : { ...ids.get((done.verb === 'receipt' ? done.out : done.out.receipt).id), completedBy: done };
      const alternatives = (refused?.out?.alternatives ?? []).map((a) => a.id);
      if (refused) evidence.push(ctx.stepRef(refused)); if (recovery) evidence.push(ctx.stepRef(recovery)); if (recovery?.completedBy) evidence.push(ctx.stepRef(recovery.completedBy));
      rows.push({ seat: r.seat, refusedCode: refused?.out?.code ?? null, alternatives, recovery: recovery?.args?.[0] ?? null,
        recoveryIsAlternative: !!recovery && alternatives.some((id) => id === recovery.args?.[0] || id === recovery.out?.receipt?.capability) });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no seat transcript shows an impossible act refused in this run', evidence };
    const pass = rows.every((x) => x.refusedCode && x.alternatives.length && x.recovery);
    const unknown = rows.some((x) => !x.refusedCode);
    return { verdict: pass ? 'pass' : unknown ? 'unknown' : 'fail', evidence, detail: rows,
      notes: rows.map((x) => `${x.seat}: refused ${x.refusedCode ?? 'never'}; alternatives ${x.alternatives.join(', ') || 'none'}; recovered with ${x.recovery ?? 'nothing'}${x.recoveryIsAlternative ? ' (an alternative)' : ''}`),
      uncertainty: rows.some((x) => x.recovery && !x.recoveryIsAlternative) ? 'the recovery act is not one of the named alternatives (or the scripted seat chose it itself): this answers that recovery happened, not that the alternative caused it' : null };
  },
};
