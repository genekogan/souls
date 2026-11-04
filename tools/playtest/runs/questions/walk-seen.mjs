// Question (SR4 example, any run with walks): was the walking body seen moving? Needs the observer's evidence packs;
// without them the answer is unknown, never inferred from the seat's own report.
export default {
  id: 'walk-seen',
  version: 1,
  question: 'For each walk the world completed, did the observer\'s samples show that Soul\'s body move at least 1 m during the request?',
  assumptions: ['Observer samples (evidence/<request>.json samples[].pos) are the only independent view of the body here.'],
  score(ctx) {
    const walks = ctx.requests.filter((r) => r.physical.some((p) => /^walk:/.test(p.capability ?? '') && p.outcome === 'completed'));
    if (!walks.length) return { verdict: 'unknown', uncertainty: 'no completed walk in this run', evidence: [] };
    if (!ctx.observer.available) return { verdict: 'unknown', evidence: [], uncertainty: `no observer evidence packs in this run${ctx.observer.receipt?.ok === false ? ` (observer ${ctx.observer.receipt.stage} failed; cameras disabled)` : ''}, so no independent sample of the body exists; the seat's completed receipts are not counted as seen` };
    const rows = walks.map((r) => {
      const pack = ctx.evidencePacks.find((e) => e.requestId === r.requestId || e.requestId === r.messageId);
      const pos = (pack?.samples ?? []).map((s) => s.pos).filter(Boolean).map((p) => (Array.isArray(p) ? [p[0], p.length === 3 ? p[2] : p[1]] : [p.x, p.z]));
      const moved = pos.length >= 2 ? Math.max(...pos.map((p) => Math.hypot(p[0] - pos[0][0], p[1] - pos[0][1]))) : null;
      return { request: r.requestId, seat: r.seat, samples: pos.length, movedM: moved == null ? null : Math.round(moved * 10) / 10, pack: pack ? ctx.ref(`playtest/evidence/${pack.requestId}.json`) : null };
    });
    const evidence = rows.map((x) => x.pack).filter(Boolean);
    if (rows.some((x) => x.movedM == null)) return { verdict: 'unknown', evidence, detail: rows, uncertainty: 'some walks have fewer than two samples' };
    return { verdict: rows.every((x) => x.movedM >= 1) ? 'pass' : 'fail', evidence, detail: rows };
  },
};
