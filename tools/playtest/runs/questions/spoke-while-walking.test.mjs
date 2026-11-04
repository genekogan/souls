// spoke-while-walking: pass only when the say came while the walk was under way and the world later shows that walk
// completed; a walk that speech replaced fails, a say after the walk ended fails, no later sample is unknown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import q from './spoke-while-walking.mjs';

let line = 0;
const S = (verb, args, out, atMs) => ({ verb, args, out, atMs, file: 'playtest/seats/ada/transcript.jsonl', line: ++line });
const steps = [S('ack', ['m1', 'Walking']), S('act', ['walk to the pond hall'], { accepted: true, receipt: { id: 'r1', capability: 'walk:lab-pond-hall', phase: 'started' } }, 1000),
  S('ack', ['m2', 'Telling you while I walk']), S('say', ['I can see the pond'], { said: { id: 'sp1' } }, 5000)];
const sample = (sec, phase, posture = 'walking') => ({ t: new Date(sec * 1000).toISOString(), posture, lastReceipt: { id: 'r1', phase } });
const ctx = (samples) => ({ seats: ['ada'], hasTranscript: () => true, steps: () => steps, stepRef: (s) => ({ path: s.file, line: s.line }), ref: (path) => ({ path }),
  evidencePacks: [{ requestId: 'm2', samples }] });

test('pass: said mid-walk, the same walk completes', () => {
  const a = q.score(ctx([sample(3, 'started'), sample(8, 'started'), sample(20, 'completed', 'standing')]));
  assert.equal(a.verdict, 'pass', JSON.stringify(a.detail));
});
test('fail: speech replaced the walk, or the walk had already ended; unknown without a later sample', () => {
  assert.equal(q.score(ctx([sample(3, 'started'), sample(8, 'replaced', 'standing')])).verdict, 'fail');
  assert.equal(q.score(ctx([sample(3, 'completed', 'standing'), sample(8, 'completed', 'standing')])).verdict, 'fail');
  assert.equal(q.score(ctx([sample(3, 'started')])).verdict, 'unknown');
});
