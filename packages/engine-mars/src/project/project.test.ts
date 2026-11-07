// PC17 (#696): blueprint and procedure are data that cannot name a Soul; a site is only a transform; stock is counted per def.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCEDURES, atSite, bindStock, blueprintSchema, inSite, procedureProblems, procedureSchema, spotAt } from './project.ts';
import blueprintData from './rack-bay.blueprint.json' with { type: 'json' };
import procedureData from './rack-bay-build.procedure.json' with { type: 'json' };

const { procedure, blueprint } = PROCEDURES['rack-bay-build@1']!;

test('R1: blueprint and procedure parse, and a bad one is refused with a reason', () => {
  assert.equal(blueprint.id, 'rack-bay'); assert.equal(Object.keys(blueprint.parts).length, 18);
  assert.equal(procedure.sections.flatMap((s) => s.maneuvers).length, 32);
  assert.deepEqual(procedureProblems(blueprint, procedure), []);
  const parts = { ...blueprint.parts, joist: { def: ['core/deck-joist@1'], hosts: ['nothing'] } };
  assert.match(procedureProblems({ ...blueprint, parts }, procedure).join(), /rests on nothing/);
  const m = structuredClone(procedure); m.sections[0]!.maneuvers[0]!.after = ['carry-sheet']; m.sections[0]!.maneuvers.at(-1)!.after = [m.sections[0]!.maneuvers[0]!.key];
  assert.match(procedureProblems(blueprint, m).join(), /wait for each other/);
});

test('R1: neither schema can name a Soul or an entity', () => {
  assert.throws(() => blueprintSchema.parse({ ...blueprintData, soul: 's_1' }));
  assert.throws(() => blueprintSchema.parse({ ...blueprintData, parts: { a: { def: ['core/deck-joist@1'], hosts: [], entity: 'e_1' } } }));
  const bad = structuredClone(procedureData) as { sections: { maneuvers: Record<string, unknown>[] }[] }; bad.sections[0]!.maneuvers[0]!.actors = ['Ada'];
  assert.throws(() => procedureSchema.parse(bad));
  assert.throws(() => procedureSchema.parse({ ...procedureData, world: 'w_1' }));
});

test('R1: one blueprint at two sites differs only by the transform', () => {
  const a = { origin: [0, 0] as [number, number], yaw: 0 }, b = { origin: [40, -7] as [number, number], yaw: 0.6 }, c = Math.cos(0.6), s = Math.sin(0.6);
  for (const m of procedure.sections.flatMap((x) => x.maneuvers)) {
    if (!m.spot) continue;
    const p = spotAt(a, m.spot), q = spotAt(b, m.spot);
    assert.ok(Math.abs(q.x - (40 + p.x * c - p.z * s)) < 1e-9 && Math.abs(q.z - (-7 + p.x * s + p.z * c)) < 1e-9);
    assert.ok(Math.abs(Math.sin(q.yaw - p.yaw - 0.6)) < 1e-9, 'the yaw turns with the site');
  }
  assert.deepEqual(atSite(a, [1, 2]), [1, 2]);
  assert.equal(inSite(procedure, b, atSite(b, [5.9, 2.9])), true); assert.equal(inSite(procedure, b, atSite(b, [6.1, 0])), false);
});

test('R2: stock binds nearest first and is counted per def', () => {
  const site = { origin: [0, 0] as [number, number], yaw: 0 }, stock: { id: string; def: string; at: [number, number] }[] = [];
  let n = 0; const add = (def: string, x: number, z: number) => stock.push({ id: `e${n++}`, def, at: [x, z] });
  add('core/rack-upright@2', -3, -3); add('core/rack-upright@2', 3, -3); add('core/rack-upright@2', 13, 13);
  add('core/rack-beam@5', 0, -4); add('core/rack-beam@5', 0, 4); add('core/rack-beam@3', 0, -5); add('core/rack-beam@3', 0, 5);
  for (let i = 0; i < 5; i++) add('core/deck-joist@1', -1 + i * 0.5, 2.5);
  add('core/plywood-sheet@2', 3, -5); add('core/deck-stair@1', 2.3, 2.4);
  const treads = () => [1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, def: 'core/deck-stair-tread@1', at: [-2, 0.9 + 0.4 * i] as [number, number] }));
  const short = bindStock(blueprint, procedure, site, stock.concat(treads().slice(1)), 14);
  assert.ok('short' in short); assert.deepEqual(short.short, [{ def: 'core/deck-stair-tread@1', need: 5, have: 4 }]);
  const all = bindStock(blueprint, procedure, site, stock.concat(treads()), 14);
  assert.ok('bound' in all); assert.equal(Object.keys(all.bound).length, 18);
  assert.equal(all.bound['upright-a'], 'e0', 'the nearer of two');
  assert.ok(!Object.values(all.bound).includes('e2'), 'the far one stays out');
});
