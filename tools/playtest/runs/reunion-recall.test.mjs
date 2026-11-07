// #1138: the Reunion recall question reads what each Soul said and where it went after its second start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import question from './questions/reunion-recall.mjs';

const T = Date.parse('2026-11-07T10:00:00.000Z');
const ctxOf = ({ ada = [], bo = [], adaWalk = 'walk:flag-orchard', boWalk = 'walk:flag-orchard' } = {}) => ({
  seats: ['ada', 'bo'], scenario: { seats: [{ id: 'ada', soulName: 'Ada' }, { id: 'bo', soulName: 'Bo' }] },
  requests: [{ seat: 'ada', sentAt: new Date(T - 9000).toISOString(), physical: [] }, { seat: 'ada', sentAt: new Date(T).toISOString(), physical: [{ capability: adaWalk, outcome: 'completed' }] }, { seat: 'bo', sentAt: new Date(T).toISOString(), physical: [{ capability: boWalk, outcome: 'completed' }] }],
  steps: (seat) => ({ ada, bo })[seat], hasTranscript: () => true, stepRef: (s) => ({ path: 'x', line: s.line }),
});
const say = (text, atMs = T + 1000) => ({ verb: 'say', args: [text], atMs, line: 1 });

test('both by name, same place: pass', () => {
  assert.equal(question.score(ctxOf({ ada: [say('Morning, Bo!')], bo: [say('Hello ada.')] })).verdict, 'pass');
});
test('a Soul who says no name, or speaks only on the first day, fails', () => {
  assert.equal(question.score(ctxOf({ ada: [say('Morning!')], bo: [say('Hello Ada.')] })).verdict, 'fail');
  assert.equal(question.score(ctxOf({ ada: [say('Hi Bo', T - 5000)], bo: [say('Hello Ada.')] })).verdict, 'fail');
});
test('two places fail the promise', () => {
  const r = question.score(ctxOf({ ada: [say('Bo!')], bo: [say('Ada!')], boWalk: 'walk:lab-pond-hall' }));
  assert.equal(r.verdict, 'fail'); assert.equal(r.detail.kept, false); assert.equal(r.detail.greeted, true);
});
test('no transcript is unknown, never a fail', () => {
  assert.equal(question.score({ ...ctxOf(), hasTranscript: () => false }).verdict, 'unknown');
});
