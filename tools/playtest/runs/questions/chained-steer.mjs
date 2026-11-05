// Question (#1020, eden-chained-steer): a seated rider's chained words ("fly to the library then fly north") are read one
// clause at a time, so the first clause is the steer toward the library, accepted, and the rest is named for later.
// Deterministic over the scripted seat's own CLI calls.
const CHAINED = /then fly north/i;
export default {
  id: 'chained-steer',
  version: 1,
  question: 'Was the rider\'s chained steer accepted as a steer toward its first clause\'s place, with the second clause left for a later act?',
  assumptions: ['The seat ran `resolve` and then `act` with the same chained words; the resolve output carries the params and the note.'],
  score(ctx) {
    const steps = ctx.seats.flatMap((s) => ctx.steps(s).filter((x) => (x.verb === 'act' || x.verb === 'resolve') && x.args.some((a) => CHAINED.test(a))));
    const act = steps.find((x) => x.verb === 'act'), look = steps.find((x) => x.verb === 'resolve');
    const evidence = steps.map(ctx.stepRef);
    if (!act) return { verdict: 'unknown', uncertainty: 'no seat sent the chained steer', evidence };
    const would = look?.out?.would ?? null, cap = act.out?.receipt?.capability ?? act.out?.resolved ?? null;
    const detail = { accepted: act.out?.accepted ?? null, capability: cap, code: act.out?.code ?? act.out?.error?.code ?? null, params: would?.params ?? null, note: would?.resolved ?? null };
    const steered = act.out?.accepted === true && /:steer$/.test(cap ?? '') && typeof would?.params?.to === 'string' && !CHAINED.test(would.params.to);
    return { verdict: steered ? 'pass' : 'fail', evidence, detail };
  },
};
