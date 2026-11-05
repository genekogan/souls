// #371 PR 3 (H-c, H-d): direction reads the sentence naming the target and fails on "can't tell"; a late answer is a
// fail; a description counts only after a view; a refused face act is a fail; the rubric never makes a true claim a W.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runOracles } from '../oracles.mjs';
import { sentencesNaming } from '../expect-oracles.mjs';
import { RUBRIC_PATH } from '../reviewer.mjs';

const T0 = Date.parse('2026-11-05T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const sample = (s, x, z) => ({ t: at(s), tick: 100 + s * 20, pos: { x, z }, place: null, placePath: [], posture: 'standing' });
const pack = (o = {}) => ({ requestId: 'r1', seat: 'pip', text: 'x', channel: 'chat', sentAt: at(0), cutoffAt: at(120), chatTurns: [3], receipts: [], samples: [sample(1, 0, 0), sample(60, 0, 0), sample(110, 0, 0)], ...o });
const turns = (text, s = 30) => [{ turn: 3, finalText: text, endedAt: at(s) }];
const row = (rows, id) => rows.find((r) => r.id === id);
const score = (expect, text, { s = 30, acts = [] } = {}) => runOracles(pack(), { expect, acts, turns: turns(text, s) });
const SRC = 'test fixture';
const cafe = { kind: 'which-way', source: SRC, targets: [{ names: ['int-cafe', 'cafe'], pos: [50, 0], radiusM: 8 }] }; // due east

test('C1: answer-direction reads only the sentences naming the target; the whole answer when none does', () => {
  assert.deepEqual(sentencesNaming("I'm facing north. The cafe is east of here.", ['cafe']), ['The cafe is east of here.']);
  assert.deepEqual(sentencesNaming('Head east, about 50 m.', ['cafe']), ['Head east, about 50 m.']);
  const r = row(score(cafe, "I'm facing north. The cafe is east of here."), 'answer-direction');
  assert.equal(r.status, 'pass'); assert.match(r.detail, /^said east;/);
  assert.equal(row(score(cafe, "I'm facing east. The cafe is to the west."), 'answer-direction').status, 'fail', 'a compass word in another sentence no longer rescues it');
  assert.equal(row(score(cafe, 'Head east, about 50 m.'), 'answer-direction').status, 'pass');
});

test('C1: an answer that cannot tell the direction is a fail, not unknown', () => {
  for (const text of ["I can't tell which way the cafe is from here.", 'Honestly, no idea where the cafe is.', "I'm not sure which way the cafe is.", "I don't know where the cafe is.", 'I am unable to tell where the cafe is.']) {
    const r = row(score(cafe, text), 'answer-direction');
    assert.equal(r.status, 'fail', text); assert.match(r.detail, /^said it can't tell/);
  }
  // "can't tell" in a sentence that does not name the target is not read when another sentence does
  assert.equal(row(score(cafe, "I can't tell you much about the plaza. The cafe is east."), 'answer-direction').status, 'pass');
  assert.equal(row(score(cafe, 'The cafe is somewhere around.'), 'answer-direction').status, 'unknown', 'no compass word and no "can\'t tell" stays unknown');
});

test('C2: an answer that came only after the cutoff is a fail for direction, names and description', () => {
  const late = { s: 130 };
  const d = row(score(cafe, 'The cafe is east.', late), 'answer-direction');
  assert.equal(d.status, 'fail'); assert.match(d.detail, /^answer came after the cutoff/);
  const near = { kind: 'near', source: SRC, answer: { anyOf: ['violin'] } };
  assert.equal(row(score(near, 'There is a violin.'), 'answer-names').status, 'pass');
  const n = row(score(near, 'There is a violin.', late), 'answer-names');
  assert.equal(n.status, 'fail'); assert.equal(n.detail, 'answer came after the cutoff');
  const look = { kind: 'look', source: SRC, answer: { anyOf: ['violin'] }, view: 'any' };
  const view = [{ turn: 3, cmd: 'node eden.mjs view', output: {}, startedAtMs: T0 + 10000 }];
  const l = row(score(look, 'I see a violin.', { ...late, acts: view }), 'named-in-description');
  assert.equal(l.status, 'fail'); assert.equal(l.detail, 'answer came after the cutoff');
  // a timely answer alongside a late one is read on its own
  const two = (first, second) => runOracles(pack({ chatTurns: [3, 4] }), { expect: near, acts: [], turns: [{ turn: 3, finalText: first, endedAt: at(30) }, { turn: 4, finalText: second, endedAt: at(200) }] });
  assert.equal(row(two('There is a violin.', 'Nothing else.'), 'answer-names').status, 'pass');
  assert.equal(row(two('Nothing here.', 'Oh, a violin.'), 'answer-names').status, 'fail', 'a name only in the late answer does not count');
});

test('C3: named-in-description passes only after a view that started by the answer', () => {
  const look = { kind: 'look', source: SRC, answer: { anyOf: ['violin', 'bandstand'] }, view: 'any' };
  const none = row(score(look, 'I see the bandstand and a violin.'), 'named-in-description');
  assert.equal(none.status, 'fail'); assert.match(none.detail, /named without looking \(no view before the answer\)/);
  const before = [{ turn: 3, cmd: 'node eden.mjs view', output: {}, startedAtMs: T0 + 10000 }];
  assert.equal(row(score(look, 'I see the bandstand and a violin.', { acts: before }), 'named-in-description').status, 'pass');
  const after = [{ turn: 3, cmd: 'node eden.mjs view --out shot.png', output: {}, startedAtMs: T0 + 40000 }];
  assert.equal(row(score(look, 'I see the bandstand and a violin.', { acts: after }), 'named-in-description').status, 'fail', 'the view came after the answer');
  const untimed = [{ turn: 3, cmd: 'node eden.mjs view', output: {} }];
  assert.equal(row(score(look, 'I see the bandstand and a violin.', { acts: untimed }), 'named-in-description').status, 'pass', 'no act times: any view in the request counts');
  assert.equal(row(score(look, 'I see grass.', { acts: before }), 'named-in-description').status, 'fail', 'a view does not make a wrong answer pass');
});

test('C4: a refused act to turn or face is a fail; with no act at all it stays unknown', () => {
  const face = { kind: 'face', source: SRC, targets: [{ names: ['eden-bandstand', 'bandstand'], pos: [0, -30] }] };
  const refused = [{ turn: 3, cmd: 'node eden.mjs act "turn to face the bandstand"', output: { accepted: false, code: 'capability.unknown', reason: 'no such capability' } }];
  const r = row(score(face, 'I tried.', { acts: refused }), 'facing');
  assert.equal(r.status, 'fail'); assert.equal(r.detail, 'facing refused (capability.unknown: no such capability)');
  assert.deepEqual(r.pointers, ['seats/pip/transcript.jsonl#turn3']);
  assert.equal(row(score(face, 'Done.'), 'facing').status, 'unknown');
  const otherRefusal = [{ turn: 3, cmd: 'node eden.mjs act "sit down"', output: { accepted: false, code: 'x' } }];
  assert.equal(row(score(face, 'Done.', { acts: otherRefusal }), 'facing').status, 'unknown', 'a refusal of another act is not a facing refusal');
  const gazed = [...refused, { turn: 3, cmd: 'node eden.mjs view --gaze bandstand', output: {} }];
  assert.equal(row(score(face, 'Looking at it.', { acts: gazed }), 'facing').status, 'pass', 'eyes turned still pass');
});

test('C5: the rubric (v2) never makes a claim that was true when written a W', () => {
  const r = readFileSync(RUBRIC_PATH, 'utf8');
  assert.match(r, /^# Playtest Reviewer rubric \(frozen copy v2\)/);
  assert.match(r, /\*\*A claim that was true when written is never W\.\*\*[\s\S]*at worst the request is an M/);
});
