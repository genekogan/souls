// #431: a param set into an enum field names one of its values; case, spacing and Unicode forms are forgiven, nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionPatch, enumParamProblem } from './actuators.ts';

const def = { state: { tune: { type: 'enum', values: ['Café', 'Ünder', 'नमस्ते'] } } } as never;
const a = { name: 'put-on', then: [{ op: 'set', field: 'tune', value: { param: 'tune' } }] } as never;
test('enum params: every value matches itself and its other spellings; a missing or unknown one is refused', () => {
  for (const v of ['Café', 'Ünder', 'नमस्ते', '  café ', 'CAFÉ', 'ünder']) assert.equal(enumParamProblem(def, a, { tune: v }, 'the box'), null, v);
  for (const v of [undefined, '', '   ', 'Cafe', 'नमस्त']) assert.equal(enumParamProblem(def, a, { tune: v }, 'the box')?.code, 'capability.params', String(v));
  assert.match(enumParamProblem(def, a, { tune: 'Jazz' }, 'the box')!.reason, /choose one of: Café, Ünder, नमस्ते/);
});
test('enum params: a Unicode variant stores the def\'s own spelling; an emoji-only pick is an empty key (#1051)', () => {
  assert.equal(enumParamProblem(def, a, { tune: 'Cafe\u0301' }, 'the box'), null, 'NFD for NFC');
  assert.equal(actionPatch({ ...(def as object), tags: [] } as never, a, {}, { tune: 'CAFE\u0301' }, {} as never).tune, 'Café', 'stored as the def spells it');
  const emoji = { state: { tune: { type: 'enum', values: ['\u{1F3B5}\uFE0F'] } } } as never;
  assert.equal(enumParamProblem(emoji, a, { tune: '\u{1F3B9}\uFE0F' }, 'the box')?.code, 'capability.params', 'another emoji is not a match');
  assert.equal(enumParamProblem(emoji, a, { tune: '\u{1F3B5}\uFE0F' }, 'the box')?.code, 'capability.params', 'an emoji-only value has no key');
});
