import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandKitProgram } from '@souls/generators';
import { WorldModel, applyBatch, type DefInput } from './index.ts';

const program = { shapes: [{ kind: 'box', at: [0, '$height/2', 0], size: [1, '$height', 1], repeat: { n: '$count', step: [2, 0, 0] } }] };
const definition = (args: unknown = program): DefInput => ({ schema: 'def/1', name: 'program-prop', params: { height: { type: 'number', default: 2, min: 1, max: 6 }, count: { type: 'int', default: 3, min: 1, max: 512 } }, size: { box: [10, 6, 10] }, make: { kind: 'gen', gen: 'kit/2', args: args as Record<string, unknown> } });
const world = () => new WorldModel({ constants: { ground: 'land' }, seed: 'kit-program-test' });
test('server bake uses def defaults and instance overrides, matching shared expansion', () => {
  const w = world(), r = applyBatch(w, { ops: [{ op: 'define', def: definition() }] }, 'god', 0);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const d = w.resolvedDef('program-prop@1')!;
  assert.deepEqual(w.bake(d, {}, 0).box, [5, 2, 1]);
  assert.deepEqual(w.bake(d, { height: 4, count: 5 }, 0).box, [9, 4, 1]);
  const explicit = w.defineDef(definition(expandKitProgram(program, { height: 4, count: 5 })), 'fixture', 0);
  assert.deepEqual(w.bake(d, { height: 4, count: 5 }, 0), w.bake(explicit, {}, 0));
});
test('admission refuses undeclared references and malformed/oversized programs with field and fix', () => {
  for (const [args, field] of [
    [{ shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, '$undeclared', 1] }] }, 'size.1'],
    [{ shapes: [{ kind: 'box', at: [0, 0, 0], repeat: { n: 512, step: [1, 0, 0] }, mirror: true }] }, 'shapes.0'],
    [{ shapes: [{ kind: 'cyl', from: [0, 0, 0], to: [0, 0, 0] }] }, 'to'],
  ] as const) {
    const w = world(), r = applyBatch(w, { ops: [{ op: 'define', def: definition(args) }] }, 'god', 0);
    assert.equal(r.result.accepted, false); if (r.result.accepted) continue;
    const f = r.result.failures[0]; assert.equal(f.code, 'def.invalid'); assert.ok(f.field?.includes(field), JSON.stringify(f)); assert.ok(f.fix);
    assert.equal(w.def('program-prop@1'), undefined);
  }
});
test('the 80k triangle budget counts expanded primitives at definition and at instance overrides', () => {
  const args = { shapes: [{ kind: 'sphere', at: [0, 1, 0], r: .5, segments: 32, repeat: { n: '$count', step: [1, 0, 0] } }] };
  const def = definition(args); def.params!.count = { type: 'int', min: 1, max: 512, default: 100 };
  const w = world(), r = applyBatch(w, { ops: [{ op: 'define', def }] }, 'god', 0);
  assert.equal(r.result.accepted, false); if (!r.result.accepted) { assert.equal(r.result.failures[0].code, 'def.budget'); assert.equal(r.result.failures[0].limit, 80_000); }
  def.params!.count.default = 1;
  assert.equal(applyBatch(w, { ops: [{ op: 'define', def }] }, 'god', 1).result.accepted, true);
  const placed = applyBatch(w, { ops: [{ op: 'place', def: 'program-prop@1', name: 'too-many', params: { count: 100 } }] }, 'god', 2);
  assert.equal(placed.result.accepted, false); if (!placed.result.accepted) { const f = placed.result.failures[0]; assert.equal(f.code, 'def.budget'); assert.ok(f.field); assert.ok(f.fix); }
  assert.equal(w.get('too-many'), undefined);
});
