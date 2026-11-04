// errand-kept-through-burst and cancel-not-resumed (#623 S3 demo 4): each answers from world records, never from a
// seat's claim. A duplicate or lost errand step or an unanswered chat fails; no chat during the errand is unknown. A
// cancelled walk that completes or is started again fails; a walk that had already ended is not a cancel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kept from './errand-kept-through-burst.mjs';
import cancel from './cancel-not-resumed.mjs';

let line = 0;
const T0 = Date.parse('2026-11-04T10:00:00Z'), at = (s) => T0 + s * 1000, iso = (s) => new Date(at(s)).toISOString();
const S = (verb, args, out, sec, doneSec = sec) => ({ verb, args, out, isError: false, atMs: at(sec), doneMs: at(doneSec), file: 'playtest/seats/ada/transcript.jsonl', line: ++line });
const rec = (id, capability, phase, events = []) => ({ accepted: true, receipt: { id, capability, phase }, events });
const seated = (id) => [{ kind: 'activity.observed', receipt: { id }, action: { status: 'executing' } }];
const ctx = (steps, packs = []) => ({ seats: ['ada'], hasTranscript: () => true, steps: () => steps, stepRef: (s) => ({ path: s.file, line: s.line }), ref: (path) => ({ path }), evidencePacks: packs });
const card = (requestId, sentSec, ackSec, receipts = [], samples = []) => ({ requestId, seat: 'ada', channel: 'card', text: 'lovely morning!', sentAt: iso(sentSec), ackAt: ackSec == null ? null : iso(ackSec), receipts, samples });
const ackOf = (id, sec) => S('ack', [id, 'ok'], { acked: id }, sec);

const errand = (second = rec('r2', 'sit:cottage/bench', 'started', seated('r2'))) => [S('ack', ['m1', 'Orchard first'], { acked: 'm1' }, 6),
  S('act', ['walk over to the orchard', '--wait', '55'], rec('r1', 'walk:orchard', 'completed'), 7, 40),
  S('act', ['sit on the bench outside the cottage', '--wait', '55'], second, 40, 80), S('result', ['m1', 'done', 'ok'], {}, 81)];

test('errand-kept-through-burst: both steps happen once each and the chat is answered', () => {
  const sent = [card('c0', 5, null), card('c1', 14, null), card('c2', 15, null)];   // the errand card, then two chat cards
  const answered = [...errand(), ackOf('c1', 82), ackOf('c2', 83)];
  assert.equal(kept.score(ctx(answered, sent)).verdict, 'pass');
  assert.equal(kept.score(ctx([...errand(), ackOf('c1', 82)], sent)).verdict, 'unknown', 'acks do not pair with the cards');
  assert.equal(kept.score(ctx([...errand(rec('r2', 'sit:cottage/bench', 'failed')), ackOf('c1', 82), ackOf('c2', 83)], sent)).verdict, 'fail', 'lost step');
  assert.equal(kept.score(ctx([...errand(rec('r2', 'walk:orchard', 'completed')), ackOf('c1', 82), ackOf('c2', 83)], sent)).verdict, 'fail', 'duplicate step');
  assert.equal(kept.score(ctx([...errand(), ackOf('c1', 102)], [card('c0', 5, null), card('c1', 100, null)])).verdict, 'unknown', 'no chat during the errand');
});
test('errand-kept-through-burst v2: a card left open does not swallow the next card\'s acts', () => {
  const open = [S('ack', ['g', 'later'], { acked: 'g' }, 1), ...errand(), ackOf('c1', 82), ackOf('c2', 83), S('ack', ['w', 'walking'], { acked: 'w' }, 90),
    S('act', ['walk to the pond hall'], rec('r9', 'walk:lab-pond-hall', 'completed'), 90)];
  const sent = [card('g', 0.5, null), card('c0', 5, null), card('c1', 14, null), card('c2', 15, null), card('w', 89, null)];
  const a = kept.score(ctx(open, sent));
  assert.equal(a.verdict, 'pass', JSON.stringify(a.detail)); assert.equal(a.detail.length, 1, 'one errand');
});

const walkThenStop = (walkPhase = 'started') => [S('act', ['walk over to the orchard'], rec('w1', 'walk:orchard', walkPhase), 7), S('ack', ['m2', 'Stopping']),
  S('act', ['stand:here', '--wait', '20'], rec('s1', 'stand:here', 'completed'), 17)];
test('cancel-not-resumed: the cancelled walk ends without arriving and is not started again', () => {
  const ended = [card('p', 18, 19, [{ id: 'w1', phase: 'replaced' }])];
  assert.equal(cancel.score(ctx(walkThenStop(), ended)).verdict, 'pass');
  assert.equal(cancel.score(ctx(walkThenStop(), [card('p', 18, 19, [{ id: 'w1', phase: 'completed' }])])).verdict, 'fail', 'arrived anyway');
  const resumed = [...walkThenStop(), S('act', ['walk over to the orchard'], rec('w2', 'walk:orchard', 'started'), 40)];
  assert.equal(cancel.score(ctx(resumed, ended)).verdict, 'fail', 'started again');
  assert.equal(cancel.score(ctx(walkThenStop('completed'), ended)).verdict, 'unknown', 'the walk had ended before the stop');
  assert.equal(cancel.score(ctx(walkThenStop(), [])).verdict, 'unknown', 'no end recorded');
});
