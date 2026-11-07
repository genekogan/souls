// reasonable-carried-out and refusal-helps (#623 S3 demo 3): each passes only on the world's records, never on a seat's
// claim. A refused or cut-short request fails; a receipt with no later world record is unknown; a refusal that names no
// offer, or a recovery that fails, fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import carried from './reasonable-carried-out.mjs';
import helps from './refusal-helps.mjs';

let line = 0;
const S = (verb, args, out) => ({ verb, args, out, isError: false, atMs: ++line * 1000, file: 'playtest/seats/ada/transcript.jsonl', line });
const rec = (id, capability, phase, events = []) => ({ accepted: true, receipt: { id, capability, phase }, events });
const seated = (id) => [{ kind: 'activity.observed', receipt: { id }, action: { status: 'executing' }, body: { posture: 'seated' } }];
const ctx = (steps, packs = []) => ({ seats: ['ada'], hasTranscript: () => true, steps: () => steps, stepRef: (s) => ({ path: s.file, line: s.line }), ref: (path) => ({ path }), evidencePacks: packs });
const pack = (requestId, receipts, samples = []) => ({ requestId, receipts, samples });

test('reasonable-carried-out: completed or reached-and-held passes, from world records only', () => {
  const steps = [S('act', ['sit on the bench outside the cottage', '--wait', '55'], rec('r1', 'sit:cottage/bench', 'started', seated('r1'))),
    S('act', ['go for a swim in the pond', '--wait', '55'], rec('r2', 'swim:pond', 'started')), S('act', ['walk to the pond hall'], rec('r3', 'walk:lab-pond-hall', 'started'))];
  const packs = [pack('p1', [{ id: 'r2', phase: 'started' }], [{ posture: 'swimming', lastReceipt: { id: 'r2', phase: 'started' } }]), pack('p2', [{ id: 'r3', phase: 'completed' }])];
  assert.equal(carried.score(ctx(steps, packs)).verdict, 'pass');
  // the walk has no later world record: unknown, not pass (the seat's claim is never read)
  assert.equal(carried.score(ctx(steps, packs.slice(0, 1))).verdict, 'unknown');
});
test('reasonable-carried-out: a refused or cut-short reasonable request fails; the reading room is not scored here', () => {
  const refused = [S('act', ['walk over to the orchard', '--wait', '55'], { accepted: false, code: 'capability.unknown', reason: 'nothing matches' })];
  assert.equal(carried.score(ctx(refused)).verdict, 'fail');
  const cut = [S('act', ['sit in the presenter\'s chair', '--wait', '55'], rec('r4', 'sit:presenter-seat', 'started'))];
  assert.equal(carried.score(ctx(cut, [pack('p', [{ id: 'r4', phase: 'replaced' }], [{ posture: 'walking', lastReceipt: { id: 'r4', phase: 'started' } }])])).verdict, 'fail');
  const onlyRoom = [S('act', ['go into the reading room'], { accepted: false, code: 'x', reason: 'closed' })];
  assert.equal(carried.score(ctx(onlyRoom)).verdict, 'unknown');
});
test('refusal-helps: a reason, an offer, and a recovery the world carries out', () => {
  const refusal = { accepted: false, code: 'place.closed', reason: 'The door is closed.', alternatives: [{ id: 'sit:cottage/bench', label: 'Sit' }] };
  const ok = [S('ack', ['m1', 'Trying']), S('act', ['go into the reading room'], refusal), S('act', ['sit:cottage/bench', '--wait', '55'], rec('r5', 'sit:cottage/bench', 'started', seated('r5')))];
  assert.equal(helps.score(ctx(ok)).verdict, 'pass');
  const none = [S('act', ['go into the reading room'], { accepted: false, code: 'place.closed', reason: 'The door is closed.' })];
  assert.equal(helps.score(ctx(none)).verdict, 'fail', 'no offer');
  const failed = [ok[0], ok[1], S('act', ['sit:cottage/bench', '--wait', '55'], rec('r6', 'sit:cottage/bench', 'failed'))];
  assert.equal(helps.score(ctx(failed)).verdict, 'fail', 'recovery failed');
  const accepted = [S('act', ['go into the reading room'], rec('r7', 'walk:lab-reading-room', 'started'))];
  assert.equal(helps.score(ctx(accepted)).verdict, 'unknown');
});
test('v2: a sit replaced while seated was reached (the receipt\'s end record), even with no sample in between', () => {
  const steps = [S('act', ['sit on the cottage bench', '--wait', '55'], rec('r8', 'sit:cottage/bench', 'started'))];
  const seatedEnd = [pack('p', [{ id: 'r8', phase: 'replaced', endedAt: { posture: 'seated' } }], [{ posture: 'walking', lastReceipt: { id: 'r8', phase: 'started' } }])];
  assert.equal(carried.score(ctx(steps, seatedEnd)).verdict, 'pass');
  const walkingEnd = [pack('p', [{ id: 'r8', phase: 'replaced', endedAt: { posture: 'walking' } }])];
  assert.equal(carried.score(ctx(steps, walkingEnd)).verdict, 'fail', 'replaced on the way');
});
