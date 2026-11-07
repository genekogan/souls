// Dry run of the Mars engine behind Sim's contract. Skipped where the Mars checkout is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conformance } from '@souls/engine-contract/conformance';
import type { Engine, ProgramEvent } from '@souls/engine-contract';
import { MEAL_WORLD, loadMars, marsAvailable, marsFactory } from './index.ts';

if (!marsAvailable()) test('mars adapter (skipped: no Mars checkout on this machine)', { skip: true }, () => {});
else {
  const factory = await marsFactory();
  const people = (e: Engine) => Object.values(e.world.entities).filter((x) => x.kind === 'human').map((x) => x.id);
  const run = (e: Engine, ticks: number, log: ProgramEvent[] = []) => { for (let i = 0; i < ticks; i++) log.push(...e.step().programs); return log; };
  const at = (e: Engine, id: string) => e.world.entities[id].pose.p;

  conformance('mars', factory, (e, i) => {
    if (i === 0) { e.spawnHuman({ id: 'a', label: 'A', soul: 's_a' }); e.spawnHuman({ id: 'b', label: 'B', soul: 's_b' }); }
    if (i === 5) e.perform({ actor: 'a', label: 'sit by the fire', steps: [{ verb: 'gather', params: { at: 'fire', seconds: 4 } }, { verb: 'ambient_wander', params: { seconds: 6, radius: 5 } }] });
    if (i === 40) e.perform({ actor: 'b', label: 'talk', steps: [{ verb: 'walk_to', params: { to: 'a', standoff: 1.3 } }, { verb: 'converse', params: { with: 'a', seconds: 5 } }] });
    if (i === 260) e.perform({ actor: 'a', label: 'bench', steps: [{ verb: 'sit', params: { on: 'bench-s', seconds: 3 } }] });
  });

  test('mars: a body-language program runs step by step on Mars bodies, with no violations', () => {
    const e = factory.create(factory.genesis('t1'));
    e.spawnHuman({ id: 'a', label: 'A', soul: 's_a' }); e.spawnHuman({ id: 'b', label: 'B', soul: 's_b' });
    assert.deepEqual(people(e), ['a', 'b']);
    assert.ok(Math.hypot(at(e, 'a')[0] - at(e, 'b')[0], at(e, 'a')[2] - at(e, 'b')[2]) >= 0.8, 'arrivals do not overlap');
    const r = e.perform({ actor: 'a', label: 'rest on the bench', steps: [{ verb: 'walk_to', params: { to: 'bench-s', standoff: 1.5 } }, { verb: 'sit', params: { on: 'bench-s', seconds: 2 } }, { verb: 'rest', params: { seconds: 2 } }] });
    assert.equal(r.ok, true); assert.equal(e.programOf('a'), r.id);
    const log = run(e, 900);
    assert.deepEqual(log.filter((x) => x.id === r.id).map((x) => (x.kind === 'step' ? `step${x.step}` : x.kind)), ['step0', 'step1', 'step2', 'completed']);
    assert.equal(e.world.entities['a'].human!.activity, 'sit');          // still seated: a hold outlives the program that made it
    assert.equal(e.programOf('a'), null);
    // a program that only waits keeps the seat
    const rest = e.perform({ actor: 'a', label: 'rest', steps: [{ verb: 'rest', params: { seconds: 2 } }, { verb: 'wave', params: { at: 'fire', seconds: 1 } }] });
    assert.equal(run(e, 100).find((x) => x.id === rest.id && x.kind !== 'step')?.kind, 'completed');
    assert.equal(e.world.entities['a'].human!.activity, 'sit');
    // the next program stands them up by itself
    const r2 = e.perform({ actor: 'a', label: 'to the fire', steps: [{ verb: 'gather', params: { at: 'fire', seconds: 1 } }] });
    const log2 = run(e, 600);
    assert.equal(log2.find((x) => x.id === r2.id && x.kind !== 'step')?.kind, 'completed', JSON.stringify(log2));
    assert.equal(e.world.entities['a'].human!.activity, 'warm');
    assert.deepEqual(e.runtime.violations.map((v) => v.code), []);
  });

  test('mars: an impossible first step is refused without disturbing the actor; unknown verbs fail cleanly', () => {
    const e = factory.create(factory.genesis('t2'));
    e.spawnHuman({ id: 'a', label: 'A', soul: 's_a' });
    e.perform({ actor: 'a', label: 'fire', steps: [{ verb: 'gather', params: { at: 'fire', seconds: 600 } }] }); run(e, 300);
    assert.equal(e.world.entities['a'].human!.activity, 'warm');
    assert.ok(e.canPerform({ actor: 'a', label: 'x', steps: [{ verb: 'walk_to', params: { to: [400, 400] } }] }));
    assert.equal(e.perform({ actor: 'a', label: 'x', steps: [{ verb: 'walk_to', params: { to: [400, 400] } }] }).ok, false);
    assert.equal(e.perform({ actor: 'a', label: 'x', steps: [{ verb: 'teleport', params: {} }] }).ok, false);
    run(e, 40);
    assert.equal(e.world.entities['a'].human!.activity, 'warm');          // still by the fire
  });

  test('mars: a world’s own verbs are reachable as mars:<verb>, with the actor filled in and feasibility checked first', () => {
    const e = factory.create(factory.genesis('t2b'));
    e.spawnHuman({ id: 'a', label: 'A', soul: 's_a' });
    assert.ok(e.describeVerbs().some((v) => v.verb === 'mars:serve' && v.scope === 'world'));
    assert.ok(e.describeVerbs().some((v) => v.verb === 'walk_to' && v.scope === undefined));
    const r = e.perform({ actor: 'a', label: 'take a seat the Mars way', steps: [{ verb: 'mars:take_slot', params: { owner: 'bench-n', activity: 'sit' } }, { verb: 'rest', params: { seconds: 1 } }, { verb: 'mars:stand', params: {} }, { verb: 'mars:face', params: { target: { entity: 'fire' } } }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const log = run(e, 900);
    assert.deepEqual(log.filter((x) => x.id === r.id).map((x) => (x.kind === 'step' ? `step${x.step}` : x.kind)), ['step0', 'step1', 'step2', 'step3', 'completed'], JSON.stringify(log));
    assert.equal(e.world.entities['a'].human!.activity, 'idle');
    // an impossible raw step is refused up front, like any other
    const no = e.perform({ actor: 'a', label: 'x', steps: [{ verb: 'mars:take_slot', params: { owner: 'no-such-thing' } }] });
    assert.equal(no.ok, false); assert.ok(no.diagnostic);
    assert.equal(e.perform({ actor: 'a', label: 'x', steps: [{ verb: 'mars:no_such', params: {} }] }).ok, false);
    assert.deepEqual(e.runtime.violations.map((v) => v.code), []);
  });

  test('mars: joint staging is borrowed: a conversation takes a free body, and that body’s own program takes it back', () => {
    const e = factory.create(factory.genesis('t3'));
    e.spawnHuman({ id: 'a', label: 'A', soul: 's_a' }); e.spawnHuman({ id: 'b', label: 'B', soul: 's_b' });
    const talk = e.perform({ actor: 'b', label: 'talk with A', steps: [{ verb: 'walk_to', params: { to: 'a', standoff: 1.3 } }, { verb: 'converse', params: { with: 'a', seconds: 60 } }, { verb: 'rest', params: { seconds: 1 } }] });
    const log = run(e, 200);
    assert.equal(e.world.entities['a'].human!.activity, 'talk');           // A was free, so A was drawn into the circle
    assert.equal(e.world.entities['b'].human!.activity, 'talk');
    assert.equal(e.programOf('a'), null);                                  // …without being given a program
    const own = e.perform({ actor: 'a', label: 'leave', steps: [{ verb: 'walk_to', params: { to: 'bench-n', standoff: 1.5 } }] });
    run(e, 400, log);
    assert.equal(log.find((x) => x.id === own.id && x.kind !== 'step')?.kind, 'completed');
    assert.equal(log.find((x) => x.id === talk.id && x.kind !== 'step')?.kind, 'completed', 'the talker’s program carries on when the other leaves');
    // someone who is busy is not borrowed: the talker faces them and talks from where they stand
    e.perform({ actor: 'a', label: 'fire', steps: [{ verb: 'gather', params: { at: 'fire', seconds: 600 } }] }); run(e, 300);
    const t2 = e.perform({ actor: 'b', label: 'talk with A', steps: [{ verb: 'walk_to', params: { to: 'a', standoff: 1.3 } }, { verb: 'converse', params: { with: 'a', seconds: 3 } }] });
    const log2 = run(e, 500);
    assert.equal(log2.find((x) => x.id === t2.id && x.kind !== 'step')?.kind, 'completed', JSON.stringify(log2));
    assert.equal(e.world.entities['a'].human!.activity, 'warm');
    assert.deepEqual(e.runtime.violations.map((v) => v.code), []);
  });

  test('mars: one of Mars’s own scenarios (four people serve themselves stew and eat round the fire) runs as four programs', async () => {
    const mars = await loadMars(), meal = await marsFactory(MEAL_WORLD);
    const e = meal.create(meal.genesis('meal'));
    assert.deepEqual(people(e), ['p1', 'p2', 'p3', 'p4']);
    const steps = mars.mealSteps();
    const ids: Record<string, string> = {};
    for (const [who, list] of Object.entries(steps)) {
      // exactly Mars's authored steps, addressed as this world's own verbs; the actor is implied by whose program it is
      const r = e.perform({ actor: who, label: 'dinner', steps: list.map((s) => { const { actor: _a, ...params } = s.params as Record<string, unknown>; return { verb: `mars:${s.verb}`, params }; }) });
      assert.equal(r.ok, true, JSON.stringify(r)); ids[who] = r.id;
    }
    const log = run(e, 20 * 240);
    for (const [who, id] of Object.entries(ids)) assert.equal(log.find((x) => x.id === id && x.kind !== 'step')?.kind, 'completed', `${who}: ${JSON.stringify(log.filter((x) => x.id === id).slice(-2))}`);
    const w = e.world.entities as Record<string, any>;
    for (let i = 1; i <= 4; i++) assert.ok(w[`bowl${i}`].contents.fraction < 0.2, `bowl${i} was eaten from: ${JSON.stringify(w[`bowl${i}`].contents)}`);
    assert.ok(w['pot'].contents.fraction < 1, 'the pot was served from');
    for (const who of Object.keys(ids)) assert.ok(['sit', 'eat'].includes(w[who].human.activity) || w[who].human.baseActivity === 'sit', `${who} is seated: ${w[who].human.activity}`);
    assert.deepEqual([...new Set(e.runtime.violations.map((v) => v.code))], []);
  });

  test('mars: a restored world carries on identically, mid-program', () => {
    const a = factory.create(factory.genesis('t4'));
    for (const id of ['a', 'b', 'c']) a.spawnHuman({ id, label: id, soul: `s_${id}` });
    a.perform({ actor: 'a', label: 'bench', steps: [{ verb: 'sit', params: { on: 'bench-n', seconds: 5 } }, { verb: 'gather', params: { at: 'fire', seconds: 5 } }] });
    a.perform({ actor: 'b', label: 'stroll', steps: [{ verb: 'ambient_wander', params: { seconds: 30, radius: 6 } }] });
    a.perform({ actor: 'c', label: 'talk', steps: [{ verb: 'walk_to', params: { to: 'b', standoff: 1.3 } }, { verb: 'converse', params: { with: 'b', seconds: 8 } }] });
    run(a, 130);
    const snap = a.snapshot() as unknown as { dropped: number };
    assert.equal(snap.dropped, 0, 'nothing in the body language is beyond Mars’s resumable set');
    const b = factory.restore(JSON.parse(JSON.stringify(snap)));
    assert.equal(b.stateHash(), a.stateHash());
    const la = run(a, 600), lb = run(b, 600);
    assert.equal(b.stateHash(), a.stateHash());
    assert.deepEqual(lb, la);
    assert.ok(la.some((x) => x.kind === 'completed'));
  });

  test('mars: movement is broadcast as keyframes; twenty people run well inside a tick', () => {
    const e = factory.create(factory.genesis('t5'));
    for (let i = 0; i < 20; i++) e.spawnHuman({ id: `h${i}`, label: `H${i}`, soul: `s${i}` });
    for (let i = 0; i < 20; i++) e.perform({ actor: `h${i}`, label: 'stroll', steps: [{ verb: 'ambient_wander', params: { seconds: 40, radius: 8 } }] });
    let paths = 0, worst = 0; const t0 = performance.now();
    for (let i = 0; i < 600; i++) { const t = performance.now(); const out = e.step(); worst = Math.max(worst, performance.now() - t); paths += out.paths.length; for (const p of out.paths) assert.equal(p.waypoints.length, 2); }
    const avg = (performance.now() - t0) / 600;
    assert.ok(paths > 200, `keyframes: ${paths}`);
    assert.ok(avg < 10, `average tick ${avg.toFixed(2)} ms (worst ${worst.toFixed(1)} ms)`);
    console.log(`    mars: 20 walkers, average tick ${avg.toFixed(2)} ms, worst ${worst.toFixed(1)} ms, ${paths} keyframes in 30 s, violations ${e.runtime.violations.length}`);
    e.removeEntity('h3'); run(e, 40);
    assert.equal(e.world.entities['h3'], undefined);
  });
}
