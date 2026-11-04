// Question (#623 S3, speech during activity): an owner asked a walking Soul to say something. Did it speak while the
// walk was still under way, and did that walk go on to complete (speaking did not stop, replace or cancel it)? The say
// and the walk's id come from the seat's own CLI calls; when the walk ended, and how, comes from the world's samples in
// the evidence packs (the seat's own claim never counts).
const ENDED = ['completed', 'failed', 'refused', 'cancelled', 'interrupted', 'replaced'];

export default {
  id: 'spoke-while-walking',
  version: 1,
  question: 'When an owner asked a walking Soul to say something, did it speak while the walk was under way, and did that same walk then complete?',
  assumptions: [
    'The walk is the seat\'s latest accepted `walk:` act before the say; the say is a say call the world accepted (`said`), not the seat\'s talk on its turn (a card starting "Your turn").',
    'Under way at the say: no world sample before the say shows that receipt ended. The walk\'s outcome is the last phase any world sample shows for that receipt id.',
    'No world sample of the receipt after the say is unknown, never a pass.',
  ],
  score(ctx) {
    const samples = (ctx.evidencePacks ?? []).flatMap((p) => (p.samples ?? []).map((s) => ({ ...s, ms: Date.parse(s.t), pack: p.requestId })));
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const steps = ctx.steps(seat);
      steps.forEach((s, i) => {
        if (s.verb !== 'say' || !s.out?.said) return;
        const ack = steps.slice(0, i).filter((x) => x.verb === 'ack').at(-1);
        if (/^My turn/i.test(ack?.args?.[1] ?? '')) return;
        const walk = steps.slice(0, i).filter((x) => x.verb === 'act' && x.out?.accepted && /^walk:/.test(x.out?.receipt?.capability ?? '')).at(-1);
        if (!walk) return;
        const id = walk.out.receipt.id, mine = samples.filter((x) => x.lastReceipt?.id === id).sort((a, b) => a.ms - b.ms);
        const at = s.atMs ?? 0, before = mine.filter((x) => x.ms <= at), after = mine.filter((x) => x.ms > at);
        const endedBefore = before.some((x) => ENDED.includes(x.lastReceipt.phase)) || ENDED.includes(walk.out.receipt.phase);
        const last = after.at(-1)?.lastReceipt?.phase ?? null;
        evidence.push(ctx.stepRef(walk), ctx.stepRef(s), ...[...new Set(after.map((x) => x.pack))].map((p) => ctx.ref(`playtest/evidence/${p}.json`)));
        rows.push({ seat, walk: walk.out.receipt.capability, receipt: id, said: s.args[0]?.slice(0, 60), underWay: !endedBefore, samplesAfter: after.length, lastPhase: last,
          walkingAfter: after.some((x) => x.posture === 'walking') });
      });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no owner-asked say after a walk in this run', evidence };
    if (rows.some((x) => !x.samplesAfter)) return { verdict: 'unknown', uncertainty: 'no world sample of a walk after its say', evidence, detail: rows };
    const pass = rows.every((x) => x.underWay && x.lastPhase === 'completed');
    return { verdict: pass ? 'pass' : 'fail', evidence, detail: rows,
      notes: rows.map((x) => `${x.seat}: said "${x.said}" ${x.underWay ? 'during' : 'after'} ${x.walk}; walk ${x.lastPhase}${x.walkingAfter ? ', still walking after it' : ''}`) };
  },
};
