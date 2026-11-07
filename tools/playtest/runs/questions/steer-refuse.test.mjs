// steer-honoured v3 and refusal-recovered v2 (#1098): every case gets a real pass or fail from the seat's own CLI calls and
// the world's answers, including a steering card acknowledged mid-walk and the director's pre-turn redirect card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import steer from './steer-honoured.mjs';
import refusal from './refusal-recovered.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seatSteps } from '../evaluate.mjs';

let line = 0;
const S = (verb, args, out) => ({ verb, args, out, isError: false, atMs: ++line * 1000, file: 'playtest/seats/ada/transcript.jsonl', line });
const rec = (id, capability, phase, extra = {}) => ({ accepted: true, receipt: { id, capability, phase }, ...extra });
const ctx = (steps) => ({ seats: ['ada'], requests: [], hasTranscript: () => true, steps: () => steps, stepRef: (s) => ({ path: s.file, line: s.line }), ref: (path) => ({ path }), evidencePacks: [] });
const card = (id, text) => ({ ownerMessages: [{ id, text }] });

const gather = (more = {}) => [S('ack', ['m1', 'Walking to the pond hall']), S('act', ['walk:lab-pond-hall', '--wait', '60'], rec('r1', 'walk:lab-pond-hall', 'started', card('m2', 'Change of plan: instead, stop by the orchard first, then go on to the pond hall.'))), ...(more.before ?? [])];

test('steer-honoured v3: a change acknowledged mid-walk and carried out passes', () => {
  const steps = [...gather(), S('ack', ['m2', 'Orchard first']), S('act', ['walk:flag-orchard', '--wait', '90'], rec('r2', 'walk:flag-orchard', 'completed')),
    S('act', ['walk:lab-pond-hall', '--wait', '90'], rec('r3', 'walk:lab-pond-hall', 'started')), S('wait', ['60'], { receipt: { id: 'r3', phase: 'completed' } }), S('result', ['m2', 'done', 'At the pond hall by the orchard'])];
  const a = steer.score(ctx(steps)); assert.equal(a.verdict, 'pass', JSON.stringify(a)); assert.equal(a.detail[0].mode, 'acknowledged');
});
test('steer-honoured v3: acknowledging the change and going on with the earlier walk fails', () => {
  const steps = [...gather(), S('ack', ['m2', 'Got it, keeping on']), S('wait', ['60'], { receipt: { id: 'r1', phase: 'completed' } }), S('result', ['m1', 'done', 'In the pond hall'])];
  const a = steer.score(ctx(steps)); assert.equal(a.verdict, 'fail', JSON.stringify(a)); assert.match(a.notes[0], /new acts none/);
});
test('steer-honoured v3: the director\'s pre-turn redirect card, delivered mid-walk, is scored too (pass and fail)', () => {
  const held = 'Change of plan for Ada, for when your turn comes: instead, stop by the orchard first, then go on to the pond hall. Do not say it yet.';
  const kept = [S('ack', ['m1', 'Walking']), S('act', ['walk:lab-pond-hall', '--wait', '60'], rec('r1', 'walk:lab-pond-hall', 'started', card('m9', held))), S('ack', ['m9', 'Noted']), S('result', ['m1', 'done', 'here'])];
  assert.equal(steer.score(ctx(kept)).verdict, 'fail');
  const followed = [...kept.slice(0, 3), S('act', ['walk:flag-orchard'], rec('r5', 'walk:flag-orchard', 'completed')), S('result', ['m9', 'done', 'orchard first'])];
  assert.equal(steer.score(ctx(followed)).verdict, 'pass');
});
test('seat steps read the CLI\'s JSON answer after its owner banner lines (#1098)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'steps-')), f = join(dir, 't.jsonl');
  const out = 'OWNER: 1 message(s) waiting. Run: node eden.mjs listen\nOWNER MESSAGE: [{"id":"m9","text":"Change of plan"}]\n' + JSON.stringify({ accepted: true, receipt: { id: 'r1', capability: 'walk:x', phase: 'started' } }, null, 1);
  writeFileSync(f, [{ message: { content: [{ type: 'tool_use', id: 'u1', input: { command: 'node eden.mjs act walk:x' } }] } }, { message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: out }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const [step] = seatSteps(f, 'ada'); assert.equal(step.out.accepted, true); assert.equal(step.out.receipt.id, 'r1');
});
test('steer-honoured: no steering card at all stays unknown; v2\'s supersede path still passes', () => {
  assert.equal(steer.score(ctx([S('ack', ['m1', 'Walking']), S('act', ['walk:lab-pond-hall'], rec('r1', 'walk:lab-pond-hall', 'completed')), S('result', ['m1', 'done', 'here'])])).verdict, 'unknown');
  const v2 = [S('ack', ['m1', 'Walking']), S('act', ['walk:lab-pond-hall', '--wait', '60'], rec('r1', 'walk:lab-pond-hall', 'started')), S('result', ['m1', 'failed', 'Changed: going by the orchard first']),
    S('ack', ['m2', 'Orchard first']), S('act', ['walk:flag-orchard'], rec('r2', 'walk:flag-orchard', 'completed')), S('result', ['m2', 'done', 'ok'])];
  assert.equal(steer.score(ctx(v2)).verdict, 'pass');
});

const fly = { accepted: false, code: 'ride.unavailable', reason: 'No matching ride is offered here.', alternatives: [{ id: 'walk:lab-pond-hall' }, { id: 'sit:here' }] };
test('refusal-recovered v2: a walk already under way that completes after the refusal is the recovery', () => {
  const steps = [S('act', ['walk to the pond hall', '--wait', '60'], rec('r1', 'walk:lab-pond-hall', 'started')), S('act', ['fly up to the pond hall'], fly), S('wait', ['30'], { receipt: { id: 'r1', capability: 'walk:lab-pond-hall', phase: 'completed' } })];
  const a = refusal.score(ctx(steps)); assert.equal(a.verdict, 'pass', JSON.stringify(a)); assert.equal(a.detail[0].recoveryIsAlternative, true);
});
test('refusal-recovered v2: nothing completed after the refusal fails; a refusal with no alternatives fails', () => {
  assert.equal(refusal.score(ctx([S('act', ['fly up'], fly), S('act', ['walk:lab-pond-hall'], rec('r2', 'walk:lab-pond-hall', 'failed'))])).verdict, 'fail');
  assert.equal(refusal.score(ctx([S('act', ['fly up'], { ...fly, alternatives: [] }), S('act', ['sit:here'], rec('r3', 'sit:here', 'completed'))])).verdict, 'fail');
  assert.equal(refusal.score(ctx([S('act', ['walk:x'], rec('r4', 'walk:x', 'completed'))])).verdict, 'unknown', 'no impossible act asked');
});
