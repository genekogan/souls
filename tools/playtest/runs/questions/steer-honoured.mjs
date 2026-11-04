// Question (#623 S3, owner steering mid-walk): the owner changed a Soul's route while it was walking. Did the Soul close
// the earlier request as failed (superseded) and did the world complete every act of the new route? Deterministic: the
// seat's own CLI calls and the world's answers (seat transcript), no observer needed.
const STEER = /\b(instead|change of plan|never mind)\b/i;

export default {
  id: 'steer-honoured',
  version: 1,
  question: 'When the owner changed a Soul\'s route mid-walk, did the Soul close the earlier request as failed and did the world complete each act of the new route?',
  assumptions: [
    'The steering card is the one the seat acknowledged right after closing an earlier request as failed in its own words (the adapter\'s supersede text); a closure reading "<verb>: …" is a failed step of that request, not a steer.',
    'Mid-walk: the earlier request\'s last act was accepted and had not completed when it was closed.',
    'Completion is the receipt phase the world returned to each act call of the new request, not the seat\'s claim.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const steps = ctx.steps(seat);
      steps.forEach((s, i) => {
        if (s.verb !== 'result' || s.args[1] !== 'failed' || /^[a-z-]+: /.test(s.args[2] ?? '')) return;   // "act: …" is a step's own failure, not a supersede
        const earlier = s.args[0], before = steps.slice(0, i).filter((x) => x.verb === 'act').at(-1);
        const ack = steps.slice(i + 1).find((x) => x.verb === 'ack'); if (!ack || ack.args[0] === earlier) return;
        const next = steps.slice(steps.indexOf(ack) + 1), end = next.findIndex((x) => x.verb === 'result'), acts = next.slice(0, end < 0 ? next.length : end).filter((x) => x.verb === 'act');
        const close = end >= 0 ? next[end] : null;
        evidence.push(ctx.stepRef(s), ctx.stepRef(ack), ...acts.map((a) => ctx.stepRef(a)));
        rows.push({ seat, earlier, midWalk: before?.out?.accepted === true && before?.out?.receipt?.phase !== 'completed', closedAs: s.args[2] ?? null,
          request: ack.args[0], acts: acts.map((a) => `${a.args[0]}: ${a.out?.receipt?.phase ?? (a.out?.accepted === false ? 'refused' : '?')}`), allCompleted: acts.length > 0 && acts.every((a) => a.out?.receipt?.phase === 'completed'),
          result: close?.args?.[1] ?? null });
      });
    }
    const steered = rows.filter((x) => x.midWalk);
    if (!steered.length) return { verdict: 'unknown', uncertainty: rows.length ? 'an earlier request was closed, but not while its walk was under way' : 'no request was superseded in this run', evidence, detail: rows };
    const pass = steered.every((x) => x.allCompleted && x.result === 'done');
    return { verdict: pass ? 'pass' : 'fail', evidence, detail: steered, notes: steered.map((x) => `${x.seat}: closed ${x.earlier} mid-walk (${x.closedAs}); new route ${x.acts.join(', ')}; result ${x.result}`) };
  },
};
