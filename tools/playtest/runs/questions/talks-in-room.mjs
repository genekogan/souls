// Question (#623 S3): did every Soul give its talk inside the room it was asked to reach, and close that turn done? The
// world's answer to the say (`said.channel.placeId`) says where it was heard; the room comes from the cast.
export default {
  id: 'talks-in-room',
  version: 1,
  question: 'Did every seat give its talk (the say after a "Your turn" card) inside the cast\'s room, and close that card done?',
  assumptions: [
    'The room is any place id containing one of the director room\'s match words (e.g. "pond-hall").',
    'A talk is the first say the world accepted after the seat acknowledged its "Your turn" card with "My turn".',
  ],
  score(ctx) {
    const match = (ctx.scenario?.director?.room?.match ?? []).map((m) => String(m).toLowerCase().replace(/\s+/g, '-'));
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) { rows.push({ seat, talk: false }); continue; }
      const steps = ctx.steps(seat), i = steps.findIndex((x) => x.verb === 'ack' && /^My turn/i.test(x.args?.[1] ?? ''));
      const say = i < 0 ? null : steps.slice(i).find((x) => x.verb === 'say' && x.out?.said);
      const close = say ? steps.slice(steps.indexOf(say)).find((x) => x.verb === 'result' && x.args[0] === steps[i].args[0]) : null;
      if (say) evidence.push(ctx.stepRef(say));
      const place = say?.out?.said?.channel?.placeId ?? null;
      rows.push({ seat, talk: !!say, place, inRoom: !!place && (!match.length || match.some((m) => place.toLowerCase().includes(m))), closed: close?.args?.[1] ?? null });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no seats', evidence };
    if (!match.length) return { verdict: 'unknown', uncertainty: 'the cast names no room to check against', evidence, detail: rows };
    if (rows.some((x) => !x.talk) && ctx.status !== 'completed') return { verdict: 'unknown', uncertainty: `the run ended ${ctx.status} before every talk`, evidence, detail: rows };
    const pass = rows.every((x) => x.talk && x.inRoom && x.closed === 'done');
    return { verdict: pass ? 'pass' : 'fail', evidence, detail: rows, notes: rows.map((x) => `${x.seat}: ${x.talk ? `talk at ${x.place}` : 'no talk'}; card ${x.closed ?? '-'}`) };
  },
};
