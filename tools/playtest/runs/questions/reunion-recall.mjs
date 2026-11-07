// Question (#1138, the Reunion scenario): after both clients restarted in new chats, did each Soul know the other and keep the plan?
// Deterministic: reads each seat's own CLI calls after its second card. Whether a sentence is warm is not scored here.
const calls = (ctx, seat, after) => ctx.steps(seat).filter((s) => s.atMs >= after);
const said = (s) => ['say', 'converse'].includes(s.verb);

export default {
  id: 'reunion-recall',
  version: 1,
  question: 'On the second day, in a new chat, did each Soul use the other\'s name in what it said, and did both go to the same place without being told it again?',
  assumptions: [
    'The second day starts at the seat\'s last card, whose text names neither the other Soul nor a place.',
    'Greeting by name is a say or converse call on that day holding the other Soul\'s name.',
    'Keeping the promise is both Souls\' last walk that day naming the same place, completed by the world.',
  ],
  score(ctx) {
    const seats = ctx.seats ?? [];
    if (seats.length !== 2) return { verdict: 'unknown', uncertainty: 'Reunion has two seats', evidence: [] };
    const blind = seats.filter((s) => !ctx.hasTranscript(s));
    if (blind.length) return { verdict: 'unknown', uncertainty: `no transcript for ${blind.join(', ')}`, evidence: [] };
    const names = Object.fromEntries((ctx.scenario?.seats ?? []).map((s) => [s.id, s.soulName]));
    const rows = seats.map((seat) => {
      const other = seats.find((s) => s !== seat), last = ctx.requests.filter((r) => r.seat === seat).at(-1), from = Date.parse(last?.sentAt ?? '');
      if (!Number.isFinite(from)) return { seat, secondDay: false };
      const mine = calls(ctx, seat, from), spoke = mine.filter(said);
      const walks = (last.physical ?? []).filter((p) => /^walk:/.test(p.capability ?? '') && p.outcome === 'completed');
      return { seat, secondDay: true, greeted: spoke.some((s) => s.args.join(' ').toLowerCase().includes(String(names[other]).toLowerCase())), spoke: spoke.length, place: walks.at(-1)?.capability ?? null, refs: spoke.slice(0, 2).map((s) => ctx.stepRef(s)) };
    });
    const evidence = rows.flatMap((r) => r.refs ?? []);
    if (rows.some((r) => !r.secondDay)) return { verdict: 'unknown', evidence, detail: rows, uncertainty: 'a seat never reached the second day' };
    const kept = rows.every((r) => r.place) && rows[0].place === rows[1].place, greeted = rows.every((r) => r.greeted);
    return { verdict: kept && greeted ? 'pass' : 'fail', evidence, detail: { greeted, kept, rows } };
  },
};
