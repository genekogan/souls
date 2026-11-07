// Creature bodies (R11a; mars/viewer/engine/bodies/creatures.ts): a duck, a snail and a dog in the Mars engine on a
// ground world. Each moves at its own speed; the duck and the dog swim, the snail is refused by name; limb programs are
// refused; humanoid behaviour is untouched (ground.test.ts keeps covering it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { groundFact } from './ground-bridge.ts';
import { emptyGround, type Ground } from '../../ground/src/index.ts';
import type { Engine } from '@souls/engine-contract';
import { CREATURES, creatureBody, bodyProblem, type CreatureId } from '../../../mars/viewer/engine/bodies/index.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
const lakeArea: [number, number][] = [[-90, -40], [-50, -40], [-50, 0], [-90, 0]];
function terrain(): Ground {
  const g = emptyGround(1000);
  g.landforms.push({ id: 'lake', kind: 'carve', area: lakeArea, bed: -3, edge: 6 });
  g.waters.push({ id: 'lake', area: lakeArea, level: 0 });
  return g;
}
const fact = groundFact(terrain(), 4);
type E = Engine & { installGroundV1(f: unknown): unknown; assignBodyV1(id: string, b: unknown): boolean; bodyAssignmentProblemV1(id: string, b: unknown): string | null };
type Body = { pose: { p: [number, number, number] }; human: { activity: string; speed?: number } };

function world(species: CreatureId): E {
  const e = factory.create(factory.genesis(`creature-${species}`)) as never as E;
  e.installGroundV1(fact);
  e.spawnHuman({ id: 'h_pet', label: 'Pet', soul: 's_pet' });
  assert.equal(e.bodyAssignmentProblemV1('h_pet', creatureBody(species)), null);
  assert.equal(e.assignBodyV1('h_pet', creatureBody(species)), true);
  return e;
}
const body = (e: Engine) => e.world.entities.h_pet as unknown as Body;
function run(e: Engine, steps: { verb: string; params: Record<string, unknown> }[], maxTicks = 20 * 600) {
  const adm = e.perform({ actor: 'h_pet', label: 'test', steps });
  if (!adm.ok) return { adm, end: { kind: 'refused', ...adm.diagnostic }, acts: new Set<string>(), speeds: [] as number[], swimSpeeds: [] as number[] };
  const acts = new Set<string>(), speeds: number[] = [], swimSpeeds: number[] = [];
  let end: { kind: string; code?: string; message?: string } | undefined;
  for (let i = 0; i < maxTicks && !end; i++) {
    const out = e.step();
    const b = body(e); acts.add(b.human.activity); if (b.human.speed) { speeds.push(b.human.speed); if (b.human.activity === 'swim') swimSpeeds.push(b.human.speed); }
    end = out.programs.find((p) => p.id === adm.id && (p.kind === 'completed' || p.kind === 'failed' || p.kind === 'cancelled'));
  }
  return { adm, end, acts, speeds, swimSpeeds };
}

test('creature bodies validate: known species only, procedural (no model URL), eye heights under the floater minimum', () => {
  for (const id of ['duck', 'snail', 'dog'] as const) assert.equal(bodyProblem(creatureBody(id)), null, id);
  assert.equal(bodyProblem({ family: 'floater', type: 'creature', model: 'dragon', radius: 0.3, hoverHeight: 0.5 }), 'body.creature');
  assert.equal(bodyProblem({ ...creatureBody('duck'), modelUrl: '/world-assets/littlemartians/characters/ada.glb' }), 'body.creature');
  assert.equal(bodyProblem({ ...creatureBody('duck'), hoverHeight: 0.05 }), 'body.hover-height');
  assert.equal(bodyProblem({ family: 'floater', type: 'ceramic', radius: 0.35, hoverHeight: 0.3 }), 'body.hover-height', 'non-creature floaters keep their range');
});

test('each creature walks at its own speed: the snail slides at 0.15 m/s, the duck waddles at 0.6, the dog trots at 1.4', () => {
  for (const id of ['snail', 'duck', 'dog'] as const) {
    const e = world(id), start = [...body(e).pose.p];
    const r = run(e, [{ verb: 'walk_to', params: { to: [start[0] + 4, start[2]] } }]);
    assert.equal(r.end?.kind, 'completed', `${id}: ${JSON.stringify(r.end)}`);
    const top = Math.max(...r.speeds);
    assert.ok(Math.abs(top - CREATURES[id].speed) < 0.02, `${id} top speed ${top}`);
    assert.deepEqual(e.runtime.violations, [], id);
  }
});

test('the duck and the dog swim the lake at their own pace; the snail is refused by name', () => {
  for (const id of ['duck', 'dog'] as const) {
    const e = world(id);
    assert.equal(run(e, [{ verb: 'walk_to', params: { to: [-49, -20] } }]).end?.kind, 'completed', id);
    const r = run(e, [{ verb: 'mars:swim_to', params: { x: -70, z: -20 } }]);
    assert.equal(r.end?.kind, 'completed', `${id}: ${JSON.stringify(r.end)}`);
    assert.ok(r.acts.has('swim'), `${id}: ${[...r.acts]}`);
    // deep water at the species' pace (the one tick crossing from the shallows keeps the wading pace, as for humanoids)
    const atPace = r.swimSpeeds.filter((v) => v === CREATURES[id].swimSpeed).length;
    assert.ok(atPace >= 0.95 * r.swimSpeeds.length, `${id}: ${atPace}/${r.swimSpeeds.length} swim ticks at ${CREATURES[id].swimSpeed}`);
    assert.equal(body(e).human.activity, 'tread');
    assert.deepEqual(e.runtime.violations, [], id);
  }
  const s = world('snail');
  assert.equal(run(s, [{ verb: 'walk_to', params: { to: [-49, -20] } }], 20 * 2000).end?.kind, 'completed');
  const refused = run(s, [{ verb: 'mars:swim_to', params: { x: -70, z: -20 } }]).end!;
  assert.match(JSON.stringify(refused), /snail does not swim/, JSON.stringify(refused));
});

test('creatures refuse limb programs with a species reason and rest (settle) like any rigid body', () => {
  const e = world('snail');
  const sit = e.perform({ actor: 'h_pet', label: 'sit', steps: [{ verb: 'sit', params: {} }] });
  assert.equal(sit.ok, false);
  assert.match(String((sit as { diagnostic: { message: string } }).diagnostic.message), /snail cannot do that; it can slide/);
  const pause = run(e, [{ verb: 'rest', params: { seconds: 2 } }]);
  assert.ok(!pause.acts.has('settle'), 'a 2 s pause (inside a walk-with) is not a settle');
  const rest = run(e, [{ verb: 'rest', params: { seconds: 6 } }]);
  assert.equal(rest.end?.kind, 'completed');
  assert.ok(rest.acts.has('settle'), `a resting creature shows 'settle' (the viewer draws its settle pose): ${[...rest.acts]}`);
  assert.equal(body(e).human.activity, 'idle', 'and gets up again when the rest ends');
});
