// #431: a param set into an enum field names one of its values; case, spacing and Unicode forms are forgiven, nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { enumParamProblem } from './actuators.ts';

const def = { state: { tune: { type: 'enum', values: ['Café', 'Ünder', 'नमस्ते'] } } } as never;
const a = { name: 'put-on', then: [{ op: 'set', field: 'tune', value: { param: 'tune' } }] } as never;
test('enum params: every value matches itself and its other spellings; a missing or unknown one is refused', () => {
  for (const v of ['Café', 'Ünder', 'नमस्ते', '  café ', 'CAFÉ', 'ünder']) assert.equal(enumParamProblem(def, a, { tune: v }, 'the box'), null, v);
  for (const v of [undefined, '', '   ', 'Cafe', 'नमस्त']) assert.equal(enumParamProblem(def, a, { tune: v }, 'the box')?.code, 'capability.params', String(v));
  assert.match(enumParamProblem(def, a, { tune: 'Jazz' }, 'the box')!.reason, /choose one of: Café, Ünder, नमस्ते/);
});
