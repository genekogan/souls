// PC11 (#690): a loose material's handling is refused when it is defined if no crew could carry it (handling.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch, type DefInput } from './index.ts';
import { handlingProblem, MAX_KG_PER_CARRIER } from './handling.ts';
import { MAX_KG_PER_CARRIER as ENGINE_MAX_KG } from '../../../mars/viewer/engine/carry/formation.ts';
import work from './core-kit/work.json' with { type: 'json' };
import { coreLibrary } from './library.ts';

type H = { crew: [number, number]; pose: 'flat' | 'edge'; height: number; grips: Record<string, [number, number, number][]> };
const table = (handling: Partial<H> = {}, mass = 75, box: [number, number, number] = [2.4384, 0.762, 0.9144]): DefInput => ({
  schema: 'def/1', name: 'candidate-table', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.38, 0], size: box }] } }, size: { box }, tags: ['shared-carry'],
  components: { carryable: { mass, grips: 4, handling: { crew: [3, 4], pose: 'flat', height: 0.75, grips: { 3: [[-1.1, 0, 0.38], [-1.1, 0, -0.38], [1.1, 0, 0]], 4: [[-1.1, 0, 0.38], [-1.1, 0, -0.38], [1.1, 0, 0.38], [1.1, 0, -0.38]] }, ...handling } } },
} as DefInput);
const define = (def: DefInput) => applyBatch(new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'handling-test' }), { ops: [{ op: 'define', def }] }, 'god', 1).result;

test('PC11 A2c: a handling no crew could carry is refused on define, with a named code', () => {
  assert.equal(define(table()).accepted, true, 'a sound table defines');
  const cases: [string, DefInput, RegExp][] = [
    ['handling.crew', table({ crew: [4, 3] }), /crew range \[4, 3\] is inverted/],
    ['handling.grips', table({ grips: { 3: [[-1.1, 0, 0.38], [1.1, 0, 0]], 4: table().components!.carryable!.handling!.grips[4] as never } }), /crew of 3 has 2 grips/],
    ['handling.grips', table({ grips: { 3: table().components!.carryable!.handling!.grips[3] as never } }), /no grip layout for a crew of 4/],
    ['handling.grips', table({ grips: { ...(table().components!.carryable!.handling!.grips as object), 2: [[-1, 0, 0], [1, 0, 0]] } }), /crew of 2 is outside the crew range \[3, 4\]/],
    ['handling.mass', table({}, 130), /130 kg needs 5 carriers at 30 kg each, but the crew range allows at most 4/],
    ['handling.reach', table({ grips: { 3: [[-1.1, 0, 0.38], [-1.1, 0, -0.38], [1.9, 0, 0]], 4: table().components!.carryable!.handling!.grips[4] as never } }), /grip 3 of the crew-of-3 layout \(1\.9, 0, 0\) is outside the load/],
  ];
  for (const [code, def, why] of cases) {
    const r = define(def);
    assert.equal(r.accepted, false, `${code} refused`);
    if (r.accepted) continue;
    assert.equal(r.failures[0].code, code); assert.match(r.failures[0].detail, why); assert.match(r.failures[0].field ?? '', /^components\.carryable/);
  }
});

test('PC11 A2c: every library def\'s handling fits together, and the limit per carrier is the engine\'s', () => {
  assert.equal(MAX_KG_PER_CARRIER, ENGINE_MAX_KG);
  const lib = coreLibrary();
  let loose = 0;
  for (const d of lib.all()) { if (d.components?.carryable?.handling) loose++; assert.equal(handlingProblem(d), null, d.ref); }
  assert.ok(loose >= 4, `${loose} loose materials checked`);
  const t = (work as { name: string; version: number; components?: { carryable?: { mass: number; handling?: H } } }[]).find((d) => d.name === 'core-work-table');
  assert.deepEqual([t?.version, t?.components?.carryable?.mass, t?.components?.carryable?.handling?.crew], [1, 75, [3, 4]]);
});
