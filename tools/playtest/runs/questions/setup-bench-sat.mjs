// Question (SR4 example, littlemartians-garden with a setup batch): did a Soul use what the setup placed?
// Deterministic over setup.json and the seats' CLI calls.
export default {
  id: 'setup-bench-sat',
  version: 1,
  question: 'Did a Soul sit on the bench that the run\'s setup batch placed?',
  assumptions: [
    'The setup placed a bench if an accepted batch has a place op whose def is a bench.',
    'A sit counts when the world returned a completed receipt or observed the sit executing (seated).',
    'The bench is the one the setup placed only if the records link the sat-on entity to the setup op.',
  ],
  score(ctx) {
    const placed = (ctx.setup?.batches ?? []).filter((b) => b.accepted);
    if (!ctx.setup) return { verdict: 'unknown', uncertainty: 'this run had no setup', evidence: [] };
    const sits = ctx.seats.flatMap((s) => ctx.steps(s).filter((x) => x.verb === 'act' && /^sit:/.test(x.out?.receipt?.capability ?? '')));
    const evidence = [ctx.ref('setup.json'), ...sits.map(ctx.stepRef)];
    if (!placed.length) return { verdict: 'fail', uncertainty: 'no setup batch was accepted', evidence: [ctx.ref('setup.json')] };
    const seated = sits.filter((x) => x.out?.receipt?.phase === 'completed' || (x.out?.events ?? []).some((e) => e?.kind === 'activity.observed' && e.action?.status === 'executing' && e.body?.posture === 'seated'));
    if (!seated.length) return { verdict: 'fail', uncertainty: sits.length ? 'sit was asked but never observed seated' : 'no Soul ran a sit', evidence };
    const targets = seated.map((x) => ({ seat: x.seat, entity: x.out.receipt.capability.slice(4), place: (x.out.events ?? []).find((e) => e?.where)?.where?.place ?? null }));
    // setup.json records each batch's outcome (seq) but not the ids of the entities it created.
    const linked = targets.filter((t) => JSON.stringify(ctx.setup).includes(t.entity));
    if (linked.length) return { verdict: 'pass', evidence, notes: linked.map((t) => `${t.seat} sat on ${t.entity}, created by setup`) };
    return {
      verdict: 'unknown', evidence, detail: targets,
      notes: targets.map((t) => `${t.seat} sat on ${t.entity}${t.place ? ` in ${t.place}` : ''}`),
      uncertainty: `a Soul was seated, but setup.json does not record the entity ids its batch created (${placed.map((b) => `${b.id} seq ${b.seq}`).join(', ')}), so the sat-on entity cannot be tied to the setup bench from these records; likely, not shown`,
    };
  },
};
