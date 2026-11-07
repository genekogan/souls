// mars-2026-map/1: the camp on the 2026 campus keeps every camp behaviour (meals, garden, sleep, the
// pallet-rack lookout built and taken down) while the campus around it is walkable and solid; the map
// is a separate versioned history that never mixes with the original camp.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, type MarsWorldConfig } from './engine.ts';
import { MARS_2026_MAP, MARS_2026_BOUNDS, CAMPUS_OBSTACLE_PREFIX } from './mars-2026-map.ts';
import { CAMP_ARRIVALS } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import { LOOKOUT_PARTS } from './disassembly.ts';
import type { Engine, EngineFactory } from '@souls/engine-contract';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';

const camp: MarsWorldConfig = { scene: 'eden-camp', arrival: CAMP_ARRIVALS[0].p, arrivalPlace: 'arrival', reference: CAMP_ARRIVALS[1].p, grounds: { id: 'grounds', name: 'Mars camp' }, disassemblyV1: true };
const mapped: MarsWorldConfig = { ...camp, map: MARS_2026_MAP };
let f: EngineFactory, old: EngineFactory;
const installed = (w: WorldState) => LOOKOUT_PARTS.filter((id) => w.entities[id].phase === 'installed').length;

function run(e: Engine, p: { actor: string; label: string; steps: { verb: string; params: Record<string, unknown> }[] }, limit = 90000) {
  assert.equal(e.canPerform(p), null, `${p.label}: ${JSON.stringify(e.canPerform(p))}`);
  const r = e.perform(p);
  assert.equal(r.ok, true, JSON.stringify(r));
  for (let n = 0; n < limit; n++) {
    const out = e.step();
    assert.deepEqual(e.runtime.violations, [], `${p.label} tick ${e.world.tick}`);
    const ev = out.programs.find((x) => x.id === r.id && ['completed', 'failed', 'cancelled'].includes(x.kind));
    if (ev) { assert.equal(ev.kind, 'completed', `${p.label}: ${JSON.stringify(ev)}`); return; }
  }
  assert.fail(`${p.label} did not finish`);
}

before(async () => { f = await marsFactory(mapped); old = await marsFactory(camp); });

test('the map is its own versioned history: rules, static base and replay never mix with the original camp', () => {
  assert.ok(f.rulesVersion.endsWith('+mars-2026-map/1'), f.rulesVersion);
  assert.ok(!old.rulesVersion.includes('mars-2026-map'));
  assert.equal(old.canReplayHistory!(f.rulesVersion), false, 'the original camp never replays a map history');
  assert.equal(f.canReplayHistory!(old.rulesVersion), false, 'the map never replays an original camp history');
  assert.equal(old.canRestoreSnapshot!(f.rulesVersion), false);
  assert.equal(f.canRestoreSnapshot!(old.rulesVersion), false);
  const a = f.genesis('x') as WorldState, b = old.genesis('x') as WorldState;
  assert.equal(a.base.campus, 'eden-camp');
  assert.notEqual(a.base.staticHash, b.base.staticHash);
  assert.deepEqual(Object.keys(a.entities).sort(), Object.keys(b.entities).sort(), 'the camp itself is unchanged');
  for (const id of ['chiba', 'north-workshops', 'north-rack-building']) assert.ok(a.regions[id], id);
  for (const [id, r] of Object.entries(b.regions)) assert.deepEqual(a.regions[id], r, id);
});

test('the render scene carries the campus backdrop and its campus prisms; the camp walls are unchanged', () => {
  const e = f.create(f.genesis('render')), o = old.create(old.genesis('render'));
  const s = (e.renderScene!() as { scene: any }).scene, so = (o.renderScene!() as { scene: any }).scene;
  assert.deepEqual(s.bounds, [...MARS_2026_BOUNDS]);
  assert.equal(s.backdrop.contract, 'mars-campus-backdrop/1');
  const campus = s.obstacles.filter((x: any) => x.id.startsWith(CAMPUS_OBSTACLE_PREFIX));
  assert.ok(campus.length > 2000, `campus prisms ${campus.length}`);
  assert.deepEqual(s.obstacles.filter((x: any) => !x.id.startsWith(CAMPUS_OBSTACLE_PREFIX)), so.obstacles);
  assert.equal(so.backdrop, undefined, 'the original camp has no backdrop');
});

test('a Soul walks from the camp to Chiba and back; the camp is clear of campus geometry', () => {
  const e = f.create(f.genesis('walk'));
  e.spawnHuman({ id: 'h0', label: 'Alice', soul: 's0' });
  run(e, { actor: 'h0', label: 'to chiba', steps: [{ verb: 'walk_to', params: { to: [44, -12] } }] });
  const p = (e.world as WorldState).entities.h0.pose.p;
  assert.ok(Math.hypot(p[0] - 44, p[2] + 12) < 1.5, `arrived near Chiba ${p}`);
  run(e, { actor: 'h0', label: 'back to the fire', steps: [{ verb: 'walk_to', params: { to: [2, 10] } }] });
});

test('the pallet-rack lookout is built and taken down on the map exactly as in the camp', () => {
  const e = f.create(f.genesis('build'));
  for (const [i, name] of ['Alice', 'Bob', 'Carol', 'David'].entries()) e.spawnHuman({ id: `h${i}`, label: name, soul: `s${i}` });
  for (const phase of ['stage', 'frame', 'deck', 'stairs']) run(e, { actor: 'h0', label: `build ${phase}`, steps: [{ verb: 'build_lookout', params: { phase } }] });
  assert.equal(installed(e.world as WorldState), 24);
  for (const [i, to] of [[-4, 12], [-2, 12], [0, 12], [2, 12]].entries()) run(e, { actor: `h${i}`, label: 'step clear', steps: [{ verb: 'walk_to', params: { to } }] });
  run(e, { actor: 'h1', label: 'unbuild stairs', steps: [{ verb: 'unbuild_lookout', params: { phase: 'stairs' } }] });
  assert.equal(installed(e.world as WorldState), 13);
  assert.equal(e.canSnapshot!(), true);
  const back = f.restore(structuredClone(e.snapshot()));
  assert.equal(back.stateHash(), e.stateHash(), 'exact restore on the map');
});
