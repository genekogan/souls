import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, type MarsWorldConfig } from './engine.ts';
import { marsCampExpansionFactory } from './camp-expansion-engine.ts';
import { CAMP_ARRIVALS } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import { createRegistry } from '../../../mars/viewer/engine/api/registry.ts';
import { DISASSEMBLY_ACTIONS } from '../../../mars/viewer/engine/construction/disassembly.ts';
import { atPile, LOOKOUT_PARTS, lookoutStateV1, pendingDisassembly } from './disassembly.ts';
import type { Engine, EngineFactory, EngineSnapshot } from '@souls/engine-contract';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';

const base: MarsWorldConfig = { scene: 'eden-camp', arrival: CAMP_ARRIVALS[0].p, arrivalPlace: 'yard', reference: CAMP_ARRIVALS[1].p, grounds: { id: 'grounds', name: 'Camp' } };
const cfg: MarsWorldConfig = { ...base, disassemblyV1: true };
const PARTS = (w: WorldState) => LOOKOUT_PARTS.map((id) => `${id}:${w.entities[id]?.def}`);
const installed = (w: WorldState) => LOOKOUT_PARTS.filter((id) => w.entities[id].phase === 'installed').length;

function run(e: Engine, verb: 'build_lookout' | 'unbuild_lookout', phase: string, actor = 'h0') {
  const p = { actor, label: `${verb} ${phase}`, steps: [{ verb, params: { phase } }] };
  assert.equal(e.canPerform(p), null, `${verb} ${phase}: ${JSON.stringify(e.canPerform(p))}`);
  const hash = e.stateHash(), world = JSON.stringify(e.world), predicted = e.previewAdmission!(p);
  assert.equal(e.stateHash(), hash, 'admission preview is pure');
  assert.equal(JSON.stringify(e.world), world);
  const r = e.perform(p);
  assert.deepEqual(r, predicted);
  assert.equal(r.ok, true, JSON.stringify(r));
  for (let n = 0; n < 90000; n++) {
    const out = e.step();
    assert.deepEqual(e.runtime.violations, [], `${verb} ${phase} tick ${e.world.tick}`);
    const ev = out.programs.find((x) => x.id === r.id && ['completed', 'failed', 'cancelled'].includes(x.kind));
    if (ev) { assert.equal(ev.kind, 'completed', `${verb} ${phase}: ${JSON.stringify(ev)}`); return r.id; }
  }
  assert.fail(`${verb} ${phase} did not finish`);
}
const code = (e: Engine, verb: string, params: Record<string, unknown>, actor = 'h0') => e.canPerform({ actor, label: 'probe', steps: [{ verb, params }] })?.code;
const phaseCode = (e: Engine, verb: string, phase: string, actor = 'h0') => code(e, verb, { phase }, actor);

let f: EngineFactory, built: EngineSnapshot, deckDown: EngineSnapshot, genesisParts: string[];
before(async () => {
  f = await marsFactory(cfg);
  const e = f.create(f.genesis('disassembly-proof'));
  for (const [i, name] of ['Alice', 'Bob', 'Carol', 'David'].entries()) e.spawnHuman({ id: `h${i}`, label: name, soul: `s${i}` });
  genesisParts = PARTS(e.world as WorldState);
  assert.equal(phaseCode(e, 'unbuild_lookout', 'stage'), 'disassembly.not-built', 'nothing is up at genesis');
  for (const phase of ['stage', 'frame', 'deck', 'stairs']) run(e, 'build_lookout', phase);
  assert.equal(installed(e.world as WorldState), 24);
  assert.equal(e.canSnapshot!(), true);
  built = structuredClone(e.snapshot());
  run(e, 'unbuild_lookout', 'stairs'); run(e, 'unbuild_lookout', 'deck');
  deckDown = structuredClone(e.snapshot());
});

test('built lookout comes down in reverse, materials return to their piles exactly, and the same parts build it again', () => {
  const e = f.restore(structuredClone(built)), w = () => e.world as WorldState;
  assert.equal(phaseCode(e, 'unbuild_lookout', 'deck'), 'disassembly.order');
  assert.equal(phaseCode(e, 'unbuild_lookout', 'frame'), 'disassembly.order');
  assert.equal(phaseCode(e, 'unbuild_lookout', 'stage'), 'disassembly.order');
  const avail = () => lookoutStateV1(w()).actions.filter((a) => a.available).map((a) => `${a.verb}:${a.phase}`);
  assert.deepEqual(lookoutStateV1(w()).phases, { stage: 'up', frame: 'up', deck: 'up', stairs: 'up' });
  assert.deepEqual(avail(), ['unbuild_lookout:stairs']);
  const expectInstalled = { stairs: 13, deck: 6, frame: 0, stage: 0 };
  for (const phase of ['stairs', 'deck', 'frame', 'stage'] as const) {
    run(e, 'unbuild_lookout', phase);
    assert.equal(pendingDisassembly(w(), phase).length, 0, `${phase} fully down`);
    assert.equal(phaseCode(e, 'unbuild_lookout', phase), 'disassembly.not-built');
    assert.equal(installed(w()), expectInstalled[phase], `${phase}: installed parts remaining`);
    assert.equal(phaseCode(e, 'build_lookout', phase), undefined, `${phase} can be built again straight away`);
    assert.equal(lookoutStateV1(w()).phases[phase], 'down');
    assert.ok(avail().includes(`build_lookout:${phase}`), `${phase}: the object offers building it again`);
  }
  assert.deepEqual(avail(), ['build_lookout:stage']);
  assert.deepEqual(PARTS(w()), genesisParts, 'what went up came down: same ids and definitions, nothing added or lost');
  for (const id of LOOKOUT_PARTS) {
    const x = w().entities[id];
    assert.equal(x.support?.kind, 'ground', id);
    assert.equal(x.connections, undefined, `${id} keeps no stale connection`);
    assert.ok(['staged', 'stored'].includes(x.phase!), `${id} is ${x.phase}`);
    if (!/^tread-|^lookout-stair$/.test(id)) assert.ok(atPile(w(), id), `${id} lies in its original pile place`);
  }
  for (const id of ['upright-a', 'upright-b']) assert.equal(w().entities[id].connections, undefined);
  assert.equal(e.canSnapshot!(), true);
  for (const phase of ['stage', 'frame', 'deck', 'stairs']) run(e, 'build_lookout', phase);
  assert.equal(installed(w()), 24, 'rebuilt from the returned piles');
  assert.deepEqual(PARTS(w()), genesisParts);
  for (const id of ['upright-a', 'upright-b']) assert.equal(w().entities[id].support?.kind, 'connected');
});

test('disassembly is deterministic: two replays and a mid-way checkpoint agree tick for tick', () => {
  const a = f.restore(structuredClone(built)), b = f.restore(structuredClone(built));
  assert.equal(a.stateHash(), b.stateHash());
  for (const phase of ['stairs', 'deck']) {
    run(a, 'unbuild_lookout', phase); run(b, 'unbuild_lookout', phase);
    assert.equal(a.world.tick, b.world.tick, phase);
    assert.equal(a.stateHash(), b.stateHash(), phase);
  }
  assert.equal(a.stateHash(), f.restore(structuredClone(deckDown)).stateHash(), 'the same as the shared fixture history');
  const c = f.restore(structuredClone(a.snapshot()));
  assert.equal(c.stateHash(), a.stateHash());
  for (const phase of ['frame', 'stage']) {
    run(a, 'unbuild_lookout', phase); run(c, 'unbuild_lookout', phase);
    assert.equal(a.world.tick, c.world.tick, phase);
    assert.equal(a.stateHash(), c.stateHash(), `${phase} after a checkpoint restore`);
  }
});

test('refusals are precise: order, phase, occupancy, crew, loads, holds and one site at a time', () => {
  const e = f.restore(structuredClone(built));
  assert.equal(phaseCode(e, 'unbuild_lookout', 'roof'), 'disassembly.phase');
  assert.equal(e.canPerform({ actor: 'h0', label: 'two', steps: [{ verb: 'unbuild_lookout', params: { phase: 'stairs' } }, { verb: 'rest', params: {} }] })?.code, 'disassembly.one-job');
  // native verbs refuse what would drop or free something
  assert.equal(code(e, 'mars:remove_joist', { crew: ['h0'], joist: 'joist-1', to: { x: -13.6, z: 9.37, yaw: 1.57 } }), 'remove.still-loaded');
  assert.equal(code(e, 'mars:disconnect_beam', { crew: ['h0', 'h1'], beam: 'beam-4', to: { x: -10.7, z: 9.37, yaw: 1.57 } }), 'remove.upright-not-held');
  assert.equal(code(e, 'mars:lower_upright', { crew: ['h0'], item: 'upright-a' }), 'lower.not-held-by-crew');
  assert.equal(code(e, 'mars:remove_stair_flight', { crew: ['h0', 'h1'], stair: 'lookout-stair', to: { x: -7, z: 8.75, yaw: Math.PI } }), 'remove.stair-has-treads');
  assert.equal(code(e, 'mars:hold_upright', { crew: ['h0', 'h1', 'h2'], item: 'upright-a' }), 'action.invalid-params');
  // nobody on (or climbing to) a deck that is coming apart
  const top = { x: -12, z: 9.37 };
  assert.equal(e.perform({ actor: 'h3', label: 'climb', steps: [{ verb: 'mars:walk_to', params: { x: top.x, z: top.z, level: 4 } }] }).ok, true);
  e.step();
  assert.equal(phaseCode(e, 'unbuild_lookout', 'stairs'), 'disassembly.deck-occupied', 'on the way up');
  for (let i = 0; i < 3000 && e.programOf('h3'); i++) e.step();
  assert.equal(e.world.entities.h3.human!.level, 4, 'h3 stands on the lookout deck');
  assert.equal(phaseCode(e, 'unbuild_lookout', 'stairs'), 'disassembly.deck-occupied', 'up there');
  assert.equal(code(e, 'mars:remove_tread', { crew: ['h0'], stair: 'lookout-stair', tread: 'tread-10', index: 10, to: { x: -10.935, z: 11.3, yaw: 1.570796 } }), 'remove.stair-occupied');
  assert.deepEqual(e.runtime.violations, []);
  // crew: a deck job needs two free people
  const solo = f.restore(structuredClone(built));
  for (const id of ['h1', 'h2', 'h3']) solo.removeEntity(id);
  for (let i = 0; i < 5; i++) solo.step();
  assert.equal(phaseCode(solo, 'unbuild_lookout', 'stairs'), 'disassembly.crew-unavailable');
  // one finite job on the site at a time, and committed crew cannot be borrowed
  const busy = f.restore(structuredClone(built));
  const job = busy.perform({ actor: 'h0', label: 'unbuild stairs', steps: [{ verb: 'unbuild_lookout', params: { phase: 'stairs' } }] });
  assert.equal(job.ok, true);
  assert.equal(phaseCode(busy, 'build_lookout', 'stairs', 'h2'), 'construction.site-busy');
  assert.equal(phaseCode(busy, 'unbuild_lookout', 'stairs', 'h3'), 'construction.site-busy');
  assert.equal(busy.canPerform({ actor: 'h1', label: 'wander', steps: [{ verb: 'rest', params: { seconds: 1 } }] })?.code, 'construction.committed');
});

test('stop and the daily quiet drain let a frame take-down finish its safe segment; nothing is left held up', () => {
  const e = f.restore(structuredClone(deckDown)), w = () => e.world as WorldState;
  const r = e.perform({ actor: 'h0', label: 'unbuild frame', steps: [{ verb: 'unbuild_lookout', params: { phase: 'frame' } }] });
  assert.equal(r.ok, true);
  let held = false;
  for (let i = 0; i < 20000 && !held; i++) { e.step(); held = ['upright-a', 'upright-b'].every((id) => w().entities[id].support?.kind === 'held'); }
  assert.equal(held, true, 'both uprights are held before any beam comes out');
  for (let i = 0; i < 400 && !e.runtime.liveIds().some((id) => e.runtime.records.get(id)!.verb === 'disconnect_beam'); i++) e.step();
  assert.equal(e.canSnapshot!(), false, 'a held load mid-disassembly is not a checkpoint');
  e.stop(r.id); e.beginQuiet!();
  let ended: string | undefined;
  for (let i = 0; i < 20000 && !ended; i++) { const out = e.step(); assert.deepEqual(e.runtime.violations, []); ended = out.programs.find((p) => p.id === r.id && ['completed', 'failed', 'cancelled'].includes(p.kind))?.kind; }
  assert.equal(ended, 'cancelled', 'the stop is honoured once the committed segment is safe');
  for (let i = 0; i < 2000 && !e.isQuiet!(); i++) e.step();
  assert.equal(e.isQuiet!(), true);
  for (const id of ['upright-a', 'upright-b']) {
    assert.equal(w().entities[id].support?.kind, 'ground', `${id} lowered, not abandoned standing`);
    assert.equal(w().entities[id].phase, 'staged');
  }
  assert.equal(pendingDisassembly(w(), 'frame').length, 0);
  assert.equal(e.canSnapshot!(), true);
});

test('legacy rules are unchanged: no reverse verbs, no unbuild card, and no cross-policy restore or replay', async () => {
  const legacy = await marsFactory(base);
  assert.equal(f.rulesVersion, legacy.rulesVersion + '+disassembly/1');
  assert.ok(!/disassembly/.test(legacy.rulesVersion));
  assert.equal(legacy.canReplayHistory!(f.rulesVersion), false);
  assert.equal(f.canReplayHistory!(legacy.rulesVersion), false);
  assert.equal(f.canReplayHistory!(f.rulesVersion), true);
  assert.equal(legacy.canRestoreSnapshot!(f.rulesVersion), false);
  assert.equal(f.canRestoreSnapshot!(legacy.rulesVersion), false);
  const old = legacy.create(legacy.genesis('legacy')), next = f.create(f.genesis('legacy'));
  assert.equal(old.physicalHash(), next.physicalHash(), 'the same physical genesis');
  assert.notEqual(old.stateHash(), next.stateHash(), 'the policy is part of the state');
  old.spawnHuman({ id: 'h0', label: 'Alice', soul: 's0' });
  assert.equal(phaseCode(old, 'unbuild_lookout', 'stairs'), 'action.unknown-verb');
  assert.equal(code(old, 'mars:remove_joist', { crew: ['h0'], joist: 'joist-1', to: { x: 0, z: 0, yaw: 0 } }), 'action.unknown-verb');
  const verbs = (e: Engine) => e.describeVerbs().map((v) => v.verb);
  assert.ok(!verbs(old).includes('unbuild_lookout') && !verbs(old).some((v) => /remove_|lower_upright|hold_upright|disconnect_beam/.test(v)));
  assert.ok(verbs(next).includes('unbuild_lookout'));
  for (const a of DISASSEMBLY_ACTIONS) assert.ok(verbs(next).includes(`mars:${a.verb}`), a.verb);
  const registry = createRegistry();
  for (const a of DISASSEMBLY_ACTIONS) assert.equal(registry.has(a.verb), false, `${a.verb} stays out of the default registry`);
  assert.notEqual(registry.get('carry'), undefined);
  assert.throws(() => legacy.restore(next.snapshot()), /disassembly policy differs/);
  assert.throws(() => f.restore(old.snapshot()), /disassembly policy differs/);
});

test('the live camp reader (eight-person ground expansion) carries disassembly/1 through adoption and checkpoint restore', async () => {
  const xcfg: MarsWorldConfig = { scene: 'eden-camp', safeArrivalV1: true, safeCrewRemoval: true, disassemblyV1: true, arrival: [-3, 18], arrivalPlace: 'arrival', reference: [-1, 17], grounds: { id: 'grounds', name: 'Camp grounds' } };
  const factory = await marsCampExpansionFactory(xcfg), plain = await marsCampExpansionFactory({ ...xcfg, disassemblyV1: false });
  const e = factory.create(factory.genesis('expanded-disassembly'));
  const p = e.previewCampExpansionV1!();
  assert.ok(p.ok);
  e.adoptCampExpansionV1!(p.transition);
  assert.match(e.rulesVersion, /\+camp-ground-expansion\/1.*\+disassembly\/1/);
  assert.equal(factory.canReplayHistory!(e.rulesVersion), true);
  assert.equal(plain.canReplayHistory!(e.rulesVersion), false);
  for (const [i, name] of ['Alice', 'Bob', 'Carol', 'David'].entries()) e.spawnHuman({ id: `h${i}`, label: name, soul: `s${i}` });
  for (const phase of ['stage', 'frame', 'deck', 'stairs']) run(e, 'build_lookout', phase);
  run(e, 'unbuild_lookout', 'stairs');
  const restored = factory.restore(structuredClone(e.snapshot()));
  assert.equal(restored.stateHash(), e.stateHash());
  assert.throws(() => plain.restore(structuredClone(e.snapshot())));
  run(e, 'unbuild_lookout', 'deck'); run(restored, 'unbuild_lookout', 'deck');
  assert.equal(restored.stateHash(), e.stateHash(), 'restored expanded reader takes the deck down identically');
  assert.equal(installed(e.world as WorldState), 6);
});
