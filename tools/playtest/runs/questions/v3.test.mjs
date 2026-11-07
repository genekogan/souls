// #1098: the v3 questions read `resolve` as well as `act`, and start from what the owner asked, so they can score on the strict contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import recovered from './refusal-recovered-v3.mjs';
import carried from './reasonable-carried-out-v3.mjs';
import helps from './refusal-helps-v3.mjs';

let line = 0;
const S = (verb, args, out) => ({ verb, args, out, isError: false, atMs: ++line * 1000, doneMs: line * 1000, file: 'f', line });
const ctx = (steps, requests = []) => ({ seats: ['bo'], hasTranscript: () => true, steps: () => steps, stepRef: (s) => ({ path: s.file, line: s.line }), ref: (path) => ({ path }), evidencePacks: requests });
const req = (id, text, sentAt = '2026-11-07T00:00:00Z', resultAt = null) => ({ seat: 'bo', requestId: id, text, sentAt, resultAt, ackText: `ack ${id}` });
const walk = (id, phase = 'completed') => ({ accepted: true, receipt: { id, capability: 'walk:x', phase } });

test('refusal-recovered v3: a resolve refusal counts; it passes only if it names an alternative and the Soul then completes an act', () => {
  const fly = (extra = {}) => S('resolve', ['fly up to the pond hall'], { ok: false, code: 'ride.unavailable', reason: 'no ride', ...extra });
  assert.equal(recovered.score(ctx([fly({ alternatives: [{ id: 'walk:x' }] }), S('act', ['walk:x'], walk('r1'))])).verdict, 'pass');
  assert.equal(recovered.score(ctx([fly(), S('act', ['walk:x'], walk('r1'))])).verdict, 'fail', 'no alternative named');
  assert.equal(recovered.score(ctx([fly({ alternatives: [{ id: 'walk:x' }] })])).verdict, 'fail', 'no recovery');
  assert.equal(recovered.score(ctx([S('act', ['walk:x'], walk('r1'))])).verdict, 'unknown', 'nothing refused');
  assert.equal(recovered.score(ctx([S('act', ['fly up'], { accepted: false, code: 'ride.unavailable', alternatives: [{ id: 'walk:x' }] }), S('act', ['walk:x'], walk('r1'))])).verdict, 'pass', 'an act refusal still counts');
});

test('reasonable-carried-out v3: from what the owner asked, whatever words the act used', () => {
  const ask = req('m1', 'next, walk over to the orchard');
  assert.equal(carried.score(ctx([S('ack', ['m1', 'ack m1'], {}), S('resolve', ['orchard'], { ok: true }), S('act', ['walk:flag-orchard', '--for', 'm1'], walk('r1'))], [ask])).verdict, 'pass');
  const noAct = [S('ack', ['m1', 'ack m1'], {}), S('resolve', ['orchard'], { ok: false, code: 'capability.unknown' }), S('result', ['m1', 'failed', 'no orchard'], {})];
  assert.equal(carried.score(ctx(noAct, [ask])).verdict, 'fail', 'told the owner it can\'t, with the walk on offer');
  const calledOff = req('m2', 'actually stop, don\'t go to the orchard after all', '2026-11-07T00:00:01Z');
  assert.equal(carried.score(ctx(noAct, [req('m1', ask.text, ask.sentAt, '2026-11-07T00:00:05Z'), calledOff])).verdict, 'unknown', 'the owner called it off first');
  assert.equal(carried.score(ctx([S('ack', ['m1', 'ack m1'], {}), S('act', ['walk:flag-orchard', '--for', 'm1'], { accepted: false, code: 'route.unreachable' })], [ask])).verdict, 'fail');
  assert.equal(carried.score(ctx([], [req('m3', 'walk to the reading room')])).verdict, 'unknown', 'the reading room is refusal-helps\'s');
  assert.equal(carried.score(ctx([], [req('m4', "that's all, now walk to the pond hall")])).verdict, 'unknown', 'the cast\'s closing line isn\'t ordinary');
});

test('refusal-helps v3: follows the owner\'s message to the first refusal, by act or resolve', () => {
  const ask = req('m1', 'could you pop into the reading room?');
  const steps = (no, ...rest) => [S('ack', ['m1', 'ack m1'], {}), no, ...rest];
  const byAct = S('act', ['walk:lab-reading-room', '--for', 'm1'], { accepted: false, code: 'route.unreachable', reason: 'door closed', alternatives: [{ id: 'sit:bench' }] });
  assert.equal(helps.score(ctx(steps(byAct, S('act', ['sit:bench'], walk('r1'))), [ask])).verdict, 'pass');
  assert.equal(helps.score(ctx(steps(byAct), [ask])).verdict, 'fail', 'no act on the offer');
  const noOffer = S('resolve', ['reading room'], { ok: false, code: 'x', reason: 'closed' });
  assert.equal(helps.score(ctx(steps(noOffer), [ask])).verdict, 'fail', 'a refusal that names no offer');
  assert.equal(helps.score(ctx(steps(S('resolve', ['reading room'], { ok: true, would: { capability: 'read:here' } }), S('result', ['m1', 'failed', 'closed'], {})), [ask])).verdict, 'unknown', 'no refusal to score');
});
