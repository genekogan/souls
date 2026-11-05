// Question (SR4 example, hello-hamlet trio): an owner changes the plan while the Soul is still walking. Deterministic:
// reads the director records and the seat's own CLI calls (joined requests), no observer needed.
const REDIRECT = /\b(change of plan|instead|never mind)\b/i;

const rowNotes = (rows) => rows.map((x) => `${x.seat}: ${x.earlier ?? 'no earlier request'} closed ${x.earlierClosed ?? 'never'}${x.closedBeforeAck ? ' before' : ' not before'} acking ${x.request}; new request ${x.newPhysical}${x.capability ? ` (${x.capability})` : ''}`);

export default {
  id: 'redirect-honoured',
  version: 2, // v2: a run cut short before the seat took the redirection up, or without its transcript, is unknown
  question: 'When the owner changed the plan mid-activity, did the Soul close the earlier request as failed before taking up the new one, and did the world complete the new one?',
  assumptions: [
    'A redirection is an owner card whose text says "change of plan", "instead" or "never mind".',
    'The earlier request is the same seat\'s latest earlier card; its closure is the seat\'s result call.',
    'Completion is the receipt phase the world returned to the seat\'s act call, not the seat\'s own claim.',
  ],
  score(ctx) {
    const redirects = ctx.requests.filter((r) => r.channel === 'card' && REDIRECT.test(r.text ?? ''));
    if (!redirects.length) return { verdict: 'unknown', uncertainty: 'no redirection was sent in this run', evidence: [] };
    const rows = [], evidence = [];
    for (const r of redirects) {
      const prior = ctx.requests.filter((p) => p.seat === r.seat && Date.parse(p.sentAt) < Date.parse(r.sentAt)).at(-1);
      evidence.push(...r.refs, ...r.physical.map((p) => p.ref), ...(prior ? [...prior.refs] : []));
      const closedAt = Date.parse(prior?.seatResult?.at ?? '') || null, ackAt = Date.parse(r.ackAt ?? '') || null;
      const closedFirst = prior?.seatResult?.outcome === 'failed' && closedAt != null && ackAt != null && closedAt <= ackAt;
      const last = r.physical.at(-1);
      rows.push({ seat: r.seat, request: r.requestId, acked: r.ackSec != null, earlier: prior?.requestId ?? null, earlierClosed: prior?.seatResult?.outcome ?? null, closedBeforeAck: closedFirst, newPhysical: last?.outcome ?? 'no act', capability: last?.capability ?? null });
    }
    const blind = [...new Set(redirects.map((r) => r.seat).filter((seat) => !ctx.hasTranscript(seat)))];
    if (blind.length) return { verdict: 'unknown', evidence, detail: rows, uncertainty: `no seat transcript retained for ${blind.join(', ')}: the seat's own calls (ack, result, act) cannot be read` };
    // A run that ended early (cancelled, failed) may have stopped before the seat took the redirection up: unknown, not fail.
    const cutShort = ctx.status !== 'completed' && rows.some((x) => !x.acked);
    if (cutShort) return { verdict: 'unknown', evidence, detail: rows, notes: rowNotes(rows), uncertainty: `the run ended ${ctx.status} before the seat acknowledged the redirection` };
    const unknown = rows.some((x) => x.newPhysical === 'started' || x.newPhysical === 'no act');
    const pass = rows.every((x) => x.closedBeforeAck && x.newPhysical === 'completed');
    const notes = rowNotes(rows);
    return {
      verdict: pass ? 'pass' : unknown && rows.every((x) => x.closedBeforeAck) ? 'unknown' : 'fail', evidence, notes, detail: rows,
      uncertainty: ctx.observer.available ? null : 'no observer samples: the route the body took (turning back) is not seen; completion rests on the world receipt the seat received',
    };
  },
};
