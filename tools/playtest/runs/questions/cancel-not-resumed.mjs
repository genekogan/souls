// Question (#623 S3, owner cancel): an owner sent a Soul off on a walk, then cancelled it while it was under way, and
// went on chatting. Did the cancelled walk end without arriving, and was it never started again (no obsolete work)?
// Outcomes come from the world's records for each receipt id (the act's own answer, the seat's receipt checks, the
// evidence packs' receipts and samples), never the seat's claim.
const ENDED = ['failed', 'refused', 'cancelled', 'interrupted', 'replaced', 'completed'];

export default {
  id: 'cancel-not-resumed',
  version: 1,
  question: 'When an owner cancelled a walk under way, did that walk end without completing, and did the Soul never start the same walk again?',
  assumptions: [
    'The cancel is an accepted `stand:here` act while an earlier accepted walk had no ended phase in any world record up to that act.',
    'Ended without completing: no world record of that walk receipt shows `completed`, and some record shows it ended (failed, cancelled, interrupted, replaced). Resumed: any later accepted act with the same capability.',
    'No cancel of a walk under way: unknown (the walk finished first, or no cancel happened).',
  ],
  score(ctx) {
    const rows = [], evidence = [], packs = ctx.evidencePacks ?? [];
    const phasesOf = (seat, id, uptoMs = Infinity) => {
      const out = [];
      for (const s of ctx.steps(seat)) if ((s.atMs ?? 0) <= uptoMs && ((s.verb === 'act' && s.out?.receipt?.id === id) || (s.verb === 'receipt' && s.args[0] === id))) out.push(s.out?.receipt?.phase ?? s.out?.phase ?? null);
      for (const p of packs) {
        for (const x of p.samples ?? []) if (x.lastReceipt?.id === id && Date.parse(x.t) <= uptoMs) out.push(x.lastReceipt.phase ?? null);
        if (uptoMs === Infinity) for (const r of p.receipts ?? []) if (r?.id === id) out.push(r.phase ?? null);
      }
      return out;
    };
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const steps = ctx.steps(seat);
      steps.forEach((stop, i) => {
        if (stop.verb !== 'act' || stop.args[0] !== 'stand:here' || stop.out?.accepted === false || stop.isError) return;
        const walk = steps.slice(0, i).filter((x) => x.verb === 'act' && x.out?.accepted !== false && /^walk:/.test(x.out?.receipt?.capability ?? '')).at(-1);
        if (!walk || !Number.isFinite(stop.atMs)) return;
        const id = walk.out.receipt.id, cap = walk.out.receipt.capability;
        if (phasesOf(seat, id, stop.atMs).some((ph) => ENDED.includes(ph))) return;   // it had already ended: not a cancel under way
        const all = phasesOf(seat, id), again = steps.slice(i + 1).filter((x) => x.verb === 'act' && x.out?.accepted !== false && x.out?.receipt?.capability === cap);
        evidence.push(ctx.stepRef(walk), ctx.stepRef(stop), ...again.map(ctx.stepRef), ...packs.filter((p) => (p.receipts ?? []).some((r) => r?.id === id) || (p.samples ?? []).some((x) => x.lastReceipt?.id === id)).map((p) => ctx.ref(`playtest/evidence/${p.requestId}.json`)));
        rows.push({ seat, walk: cap, receipt: id, completed: all.includes('completed'), ended: all.filter((ph) => ENDED.includes(ph) && ph !== 'completed')[0] ?? null, resumed: again.length });
      });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no cancel of a walk under way in this run', evidence };
    const notes = rows.map((r) => `${r.seat}: ${r.walk} ${r.completed ? 'completed anyway' : r.ended ? `ended ${r.ended}` : 'no end recorded'}; started again ${r.resumed} time(s)`);
    if (rows.some((r) => r.completed || r.resumed)) return { verdict: 'fail', evidence, detail: rows, notes };
    if (rows.some((r) => !r.ended)) return { verdict: 'unknown', uncertainty: 'no world record shows the cancelled walk ended', evidence, detail: rows, notes };
    return { verdict: 'pass', evidence, detail: rows, notes };
  },
};
