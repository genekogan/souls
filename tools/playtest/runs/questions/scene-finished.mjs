// Question (#623 S3): did every Soul of the scene finish: its last request closed done by the seat, and a talk said?
export default {
  id: 'scene-finished',
  version: 1,
  question: 'Did every seat end the scene having spoken its talk, with no request left open or failed after its talk?',
  assumptions: [
    'A talk is a say call the world accepted (`said` in its answer); its request is the card the seat acknowledged just before.',
    'Requests before the talk may fail (a refused act); only the talk and anything after it must be done.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) { rows.push({ seat, talk: null, spoke: false, after: [] }); continue; }
      const steps = ctx.steps(seat), say = steps.find((s) => s.verb === 'say' && s.out?.said);
      if (!say) { rows.push({ seat, talk: null, spoke: false, after: [] }); continue; }
      const i = steps.indexOf(say), ack = steps.slice(0, i).filter((s) => s.verb === 'ack').at(-1);
      evidence.push(ctx.stepRef(say));
      const after = steps.slice(i).filter((s) => s.verb === 'result').map((s) => s.args[1]);
      rows.push({ seat, talk: ack?.args?.[0] ?? null, spoke: true, after });
    }
    if (!rows.length) return { verdict: 'unknown', uncertainty: 'no seats in this run', evidence };
    if (rows.some((x) => !x.talk) && ctx.status !== 'completed') return { verdict: 'unknown', evidence, detail: rows, uncertainty: `the run ended ${ctx.status} before every seat's turn` };
    const pass = rows.every((x) => x.spoke && x.after.length > 0 && x.after.every((o) => o === 'done'));
    return { verdict: pass ? 'pass' : 'fail', evidence, detail: rows, notes: rows.map((x) => `${x.seat}: ${x.talk ? (x.spoke ? 'spoke' : 'did not speak') : 'no turn'}; after: ${x.after.join(', ') || '-'}`) };
  },
};
