import test from 'node:test';
import assert from 'node:assert/strict';
import { runOracles, ORACLE_IDS } from '../oracles.mjs';
import { angleDiff, bearing, compassWords, expectFor, namesIn, validateExpect, EXPECT_KINDS } from '../expect-oracles.mjs';

const T0 = Date.parse('2026-10-26T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const sample = (s, x, z, extra = {}) => ({ t: at(s), tick: 100 + s * 20, pos: { x, z }, place: null, placePath: [], posture: 'standing', ...extra });
const pack = (o = {}) => ({ requestId: 'r1', seat: 'pip', text: 'x', channel: 'chat', sentAt: at(0), cutoffAt: at(120), chatTurns: [3], receipts: [], samples: [sample(1, 0, 0), sample(60, 10, 0), sample(110, 20, 0)], ...o });
const turns = (text, s = 30) => [{ turn: 3, finalText: text, endedAt: at(s) }];
const SRC = 'test fixture';
const row = (rows, id) => rows.find((r) => r.id === id);
const run1 = (ev, ctx) => runOracles(ev, { acts: [], turns: [], ...ctx });

test('compass helpers speak the world frame: north is -z, east is +x', () => {
  assert.equal(Math.round(bearing([0, 0], [0, -10])), 0);
  assert.equal(Math.round(bearing([0, 0], [10, 0])), 90);
  assert.equal(Math.round(bearing([0, 0], [0, 10])), 180);
  assert.equal(Math.round(bearing([0, 0], [-10, 0])), 270);
  assert.equal(angleDiff(350, 10), 20);
  assert.deepEqual(compassWords('Head north-east, then northeast again, then south.').map((w) => w.deg), [45, 45, 180]);
  assert.deepEqual(namesIn('There are Benches and a café terrace nearby.', ['bench', 'cafe terrace', 'pond']), ['bench', 'cafe terrace']);
  assert.deepEqual(namesIn('a cellophane', ['cello']), []);
});

test('no expect → exactly the fifteen oracles; an expect adds its kind\'s oracles after them', () => {
  assert.deepEqual(run1(pack(), { expect: null }).map((r) => r.id), ORACLE_IDS);
  for (const [kind, ids] of Object.entries(EXPECT_KINDS)) {
    const expect = { kind, source: SRC, targets: [{ names: ['bandstand'], pos: [20, 0] }], answer: { anyOf: ['violin'] } };
    assert.deepEqual(run1(pack(), { expect }).map((r) => r.id), [...ORACLE_IDS, ...ids], kind);
  }
});

test('target-arrival: world truth, by place name or position, and a miss names the nearest target distance', () => {
  const expect = { kind: 'go', source: SRC, targets: [{ names: ['eden-bandstand', 'bandstand'], pos: [20, 0], radiusM: 5 }] };
  assert.match(row(run1(pack(), { expect }), 'target-arrival').detail, /by position/);
  assert.equal(row(run1(pack(), { expect }), 'target-arrival').status, 'pass');
  const named = pack({ samples: [sample(1, 0, 0), sample(110, 90, 90, { place: 'g-eden-bandstand', placePath: ['eden-bandstand'] })] });
  assert.match(row(run1(named, { expect }), 'target-arrival').detail, /by name/);
  const miss = pack({ samples: [sample(1, 0, 0), sample(110, 0, 40, { place: 'pond' })] });
  const r = row(run1(miss, { expect }), 'target-arrival');
  assert.equal(r.status, 'fail'); assert.match(r.detail, /pond/); assert.match(r.detail, /nearest target 44\.7 m/);
  assert.equal(row(run1(pack({ samples: [] }), { expect }), 'target-arrival').status, 'unknown');
});

test('answer-names: a near answer must use a real neighbour and no false one', () => {
  const expect = { kind: 'near', source: SRC, answer: { anyOf: ['violin', 'bench', 'notice board'], noneOf: ['lighthouse'] } };
  assert.equal(row(run1(pack(), { expect, turns: turns('Next to it there are two benches and a notice board.') }), 'answer-names').status, 'pass');
  assert.equal(row(run1(pack(), { expect, turns: turns('A lighthouse and some benches.') }), 'answer-names').status, 'fail');
  assert.equal(row(run1(pack(), { expect, turns: turns('Some grass.') }), 'answer-names').status, 'fail');
  assert.match(row(run1(pack(), { expect }), 'answer-names').detail, /no answer/);
  assert.match(row(run1(pack(), { expect: { ...expect, answer: { anyOf: ['bench'] } }, turns: turns('A bench.', 300) }), 'answer-names').detail, /after the cutoff/);
});

test('answer-direction: compass words judged against the bearing from where the Soul stood when asked', () => {
  const expect = { kind: 'which-way', source: SRC, targets: [{ names: ['cafe'], pos: [0, -100] }] };
  assert.equal(row(run1(pack(), { expect, turns: turns('The cafe is north of here, about 100 m.') }), 'answer-direction').status, 'pass');
  assert.equal(row(run1(pack(), { expect, turns: turns('Go north-west a little.') }), 'answer-direction').status, 'pass');
  const f = row(run1(pack(), { expect, turns: turns('It is south of us.') }), 'answer-direction');
  assert.equal(f.status, 'fail'); assert.match(f.detail, /truth north/);
  assert.equal(row(run1(pack(), { expect, turns: turns('Turn left at the oak.') }), 'answer-direction').status, 'unknown');
  assert.equal(row(run1(pack(), { expect: { ...expect, targets: [{ names: ['x'], pos: [3, 3] }] }, turns: turns('north') }), 'answer-direction').status, 'unknown');
});

test('facing: the last completed act\'s heading points at the target (or the eyes were turned at it)', () => {
  const expect = { kind: 'face', source: SRC, targets: [{ names: ['eden-windmill', 'windmill'], pos: [10, -10] }] };
  const rc = (heading, s = 20) => ({ id: 'rc1', capability: 'face:eden-windmill', phase: 'completed', acceptedAt: at(s - 2), endedAt: { pos: [0, 0], heading, posture: 'standing' } });
  // the windmill lies north-east (45°)
  assert.equal(row(run1(pack({ receipts: [rc(40)] }), { expect }), 'facing').status, 'pass');
  const f = row(run1(pack({ receipts: [rc(200)] }), { expect }), 'facing');
  assert.equal(f.status, 'fail'); assert.match(f.detail, /155° off/);
  assert.equal(row(run1(pack({ receipts: [rc(200)] }), { expect, acts: [{ cmd: 'node eden-agent.mjs view --gaze eden-windmill --alt-only', turn: 3, output: null }] }), 'facing').status, 'pass');
  const before = { ...rc(40), acceptedAt: at(-200) };
  assert.equal(row(run1(pack({ receipts: [before] }), { expect }), 'facing').status, 'unknown', 'an act from before the request does not count');
});

test('look: view-used (any / --out) and named-in-description', () => {
  const expect = { kind: 'look', source: SRC, view: 'out', answer: { anyOf: ['windmill', 'sails'] } };
  const alt = [{ cmd: 'node eden-agent.mjs view --alt-only', turn: 3, output: null }], out = [{ cmd: 'node eden-agent.mjs view --out view.jpg', turn: 3, output: null }];
  assert.equal(row(run1(pack(), { expect, acts: out, turns: turns('A white windmill with four sails.') }), 'view-used').status, 'pass');
  assert.match(row(run1(pack(), { expect, acts: alt }), 'view-used').detail, /not view --out/);
  assert.equal(row(run1(pack(), { expect: { ...expect, view: 'any' }, acts: alt }), 'view-used').status, 'pass');
  assert.match(row(run1(pack(), { expect }), 'view-used').detail, /never looked/);
  assert.equal(row(run1(pack(), { expect, acts: out, turns: turns('A white windmill.') }), 'named-in-description').status, 'pass');
  assert.equal(row(run1(pack(), { expect, acts: out, turns: turns('Some trees.') }), 'named-in-description').status, 'fail');
});

test('expectFor: the k-th pack with the same seat and text gets the k-th script entry', () => {
  const script = [{ seat: 'pip', text: 'what is near here?', expect: { kind: 'near', n: 1 } }, { seat: 'quin', text: 'what is near here?', expect: { kind: 'near', n: 9 } }, { seat: 'pip', text: 'what is near here?', expect: { kind: 'near', n: 2 } }];
  const evidence = [{ requestId: 'b', seat: 'pip', text: 'what is near here?', sentAt: at(50) }, { requestId: 'a', seat: 'pip', text: 'what is near here?', sentAt: at(5) }];
  const run = { scenario: { director: { script } }, evidence };
  assert.equal(expectFor(run, evidence[1]).n, 1); assert.equal(expectFor(run, evidence[0]).n, 2);
  assert.equal(expectFor(run, { requestId: 'z', seat: 'pip', text: 'other' }), null);
  assert.equal(expectFor(null, evidence[0]), null);
});

test('validateExpect names every problem; an invalid expect reports unknown, never pass', () => {
  const errs = validateExpect({ kind: 'go', targets: [{ names: [], pos: [1] , radiusM: 0 }], view: 'x' });
  for (const re of [/names/, /pos/, /radiusM/, /view/, /source/]) assert.ok(errs.some((e) => re.test(e)), String(re));
  assert.ok(validateExpect({ kind: 'teleport', source: SRC }).some((e) => /kind/.test(e)));
  assert.ok(validateExpect({ kind: 'near', source: SRC }).some((e) => /answer.anyOf/.test(e)));
  assert.deepEqual(validateExpect({ kind: 'near', source: SRC, answer: { anyOf: ['x'] } }), []);
  assert.equal(row(run1(pack(), { expect: { kind: 'go', source: SRC } }), 'target-arrival').status, 'unknown');
});

test('a scripted replay keeps each request\'s expect (k-th occurrence), and adds none where there was none', async () => {
  const { replayToScenario } = await import('../report.mjs');
  const script = [{ seat: 'sol', text: 'go to the pond', expect: { kind: 'go', n: 1 } }, { seat: 'sol', text: 'wave' }, { seat: 'sol', text: 'go to the pond', expect: { kind: 'go', n: 2 } }];
  const replay = { run: 'x', seed: 1, scenario: { name: 'w', director: { mode: 'scripted', script } }, requests: [
    { seat: 'sol', channel: 'chat', text: 'go to the pond', sendOffsetSec: 20 }, { seat: 'sol', channel: 'chat', text: 'wave', sendOffsetSec: 40 }, { seat: 'sol', channel: 'chat', text: 'go to the pond', sendOffsetSec: 60 }] };
  const out = replayToScenario(replay).director.script;
  assert.deepEqual(out.map((e) => e.expect?.n ?? null), [1, null, 2]);
  assert.equal('expect' in out[1], false);
});
