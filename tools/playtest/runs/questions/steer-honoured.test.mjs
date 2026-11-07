// steer-honoured v2 (#832): an act's phase is the last one the world returned for that act's receipt id within the new
// request, so a walk read back by a later `receipt`/`wait` of the same id counts; a different id never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import q from './steer-honoured.mjs';

const R = (id, phase) => ({ id, capability: 'walk:lab-pond-hall', phase });
let line = 0;
const S = (verb, args, out = {}) => ({ verb, args, out, file: 'playtest/seats/ada/transcript.jsonl', line: ++line });
const ctx = (steps) => ({ seats: ['ada'], hasTranscript: () => true, steps: () => steps, stepRef: (s) => ({ path: s.file, line: s.line }) });
const steer = (after) => [
  S('ack', ['m1', 'Walking']), S('act', ['walk to the pond hall'], { accepted: true, receipt: R('r_old', 'started') }),
  S('result', ['m1', 'failed', 'Changed: going by the village green first']), S('ack', ['m2', 'Going by the green']),
  S('act', ['walk to the village green', '--wait', '60'], { accepted: true, receipt: R('r_green', 'completed') }),
  S('act', ['walk to the pond hall', '--wait', '100'], { accepted: true, waited: '31s', done: false, receipt: R('r_hall', 'started'), ownerMessages: [{ id: 'm3' }] }),
  ...after,
];

test('v2: an owner-woken act read back by a later receipt of the same id is completed', async () => {
  const a = await q.score(ctx(steer([S('receipt', ['r_hall'], R('r_hall', 'completed')), S('result', ['m2', 'done', 'At the pond hall'])])));
  assert.equal(a.verdict, 'pass', JSON.stringify(a.detail)); assert.match(a.notes[0], /walk to the pond hall: completed/);
  assert.ok(a.evidence.some((e) => e.line === 7), 'the receipt check is cited');
  const w = await q.score(ctx(steer([S('wait', ['60', 'r_hall'], { receipt: R('r_hall', 'completed') }), S('result', ['m2', 'done', 'At the pond hall'])])));
  assert.equal(w.verdict, 'pass', 'a later wait of the same id counts too');
});

test('v2: a different receipt id, a read-back after the result, or no read-back leaves the act unfinished', async () => {
  for (const after of [
    [S('receipt', ['r_other'], R('r_other', 'completed')), S('result', ['m2', 'done', 'At the pond hall'])],
    [S('result', ['m2', 'done', 'At the pond hall']), S('receipt', ['r_hall'], R('r_hall', 'completed'))],
    [S('result', ['m2', 'failed', 'act: receipt unknown after waiting: completion not confirmed'])],
  ]) {
    const a = await q.score(ctx(steer(after)));
    assert.equal(a.verdict, 'fail', JSON.stringify(a.detail)); assert.match(a.notes[0], /walk to the pond hall: started/);
  }
  const later = await q.score(ctx(steer([S('receipt', ['r_hall'], R('r_hall', 'replaced')), S('result', ['m2', 'done', 'x'])])));
  assert.equal(later.verdict, 'fail', 'the last phase wins: replaced is not completed');
});
