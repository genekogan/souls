// #371 H4: a near answer's names are measured from the place asked about (its targets[] and the genesis), not from where
// the Soul stood; the scenario validator holds near expects to the same truth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOracles, genesisThings } from '../oracles.mjs';
import { wordFromTargets } from '../expect-oracles.mjs';
import { checkNear, validateScenario } from '../../scenarios/lib/validate.mjs';

const T0 = Date.parse('2026-11-05T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const sample = (s, x, z) => ({ t: at(s), tick: 100 + s * 20, pos: x == null ? undefined : { x, z }, place: null, placePath: [], posture: 'standing' });
const pack = (x, z) => ({ requestId: 'r1', seat: 'pip', text: 'x', channel: 'chat', sentAt: at(0), cutoffAt: at(120), chatTurns: [3], receipts: [], samples: [sample(1, x, z), sample(60, x, z)] });
const row = (rows, id) => rows.find((r) => r.id === id);
// A tiny genesis: the bandstand with a violin beside it; a windmill and a bench 60 m east, where the Soul stands.
const things = new Map([
  ['bandstand', { name: 'bandstand', def: 'core/pavilion@1', pos: [0, 0] }],
  ['bandstand-violin-1', { name: 'bandstand-violin-1', def: 'eden-music-stand-violin@1', pos: [1, 0] }],
  ['street-bench-1', { name: 'street-bench-1', def: 'core/bench@1', pos: [5, 0] }],
  ['eden-windmill', { name: 'eden-windmill', def: 'core/windmill@1', pos: [60, 0] }],
  ['street-bench-2', { name: 'street-bench-2', def: 'core/bench@1', pos: [62, 0] }],
]);
const near = { kind: 'near', source: 'test fixture', targets: [{ ref: 'bandstand', names: ['bandstand'], pos: [0, 0], radiusM: 20 }], answer: { anyOf: ['violin', 'bench', 'windmill', 'commons'], minHits: 1 } };
const score = (text, { expect = near, ctx = { things }, pos = [60, 2] } = {}) => row(runOracles(pack(...pos), { expect, acts: [], turns: [{ turn: 3, finalText: text, endedAt: at(30) }], ...ctx }), 'answer-names');

test('N3: a word counts only when the genesis has it within radiusM of the target', () => {
  assert.deepEqual(wordFromTargets(things, near.targets, 'violin'), { word: 'violin', placed: true, near: true, thing: 'bandstand-violin-1', target: near.targets[0], d: 1 });
  assert.equal(wordFromTargets(things, near.targets, 'windmill').near, false);
  assert.equal(wordFromTargets(things, near.targets, 'bench').thing, 'street-bench-1', 'the bench nearest the target, not the one by the Soul');
  assert.deepEqual(wordFromTargets(things, near.targets, 'commons'), { word: 'commons', placed: false }, 'a word that names nothing placed is an alias');
  assert.equal(wordFromTargets(things, near.targets, 'pavilion').placed, false, 'the target itself is not near itself');
  const r = score('There is a violin by it.');
  assert.equal(r.status, 'pass'); assert.equal(r.detail, 'names violin (1/1 needed)');
});

test('N3: names that are only near the Soul do not count, and the row fails with distances from the target and the Soul', () => {
  const r = score('The windmill is right there.');
  assert.equal(r.status, 'fail');
  assert.equal(r.detail, 'names 0 thing(s) near bandstand (1 needed); not near bandstand: windmill (nearest 60.0 m from bandstand, radius 20 m, 2.0 m from the Soul)');
  const mixed = score('A windmill, and a bench.');
  assert.equal(mixed.status, 'pass', 'a bench lies within 20 m of the bandstand');
  assert.match(mixed.detail, /^names bench \(1\/1 needed\); not near bandstand: windmill/);
  assert.equal(score('The commons.').status, 'pass', 'an alias still counts');
  assert.equal(score('A windmill.', { pos: [null, null] }).detail.includes('from the Soul'), false, 'no Soul distance without a position');
});

test('N4: without targets or without a genesis the old scoring holds, and the detail says so', () => {
  const { targets, ...noTargets } = near;
  const a = score('The windmill is right there.', { expect: noTargets });
  assert.equal(a.status, 'pass'); assert.equal(a.detail, 'names windmill (1/1 needed); names not measured from the target (no targets)');
  const b = score('The windmill is right there.', { ctx: { things: null } });
  assert.equal(b.status, 'pass'); assert.match(b.detail, /not measured from the target \(genesis not loaded\)$/);
  // the genesis comes from the run's scenario; a missing file is null, not a throw
  const run = { scenario: { world: { genesis: 'worlds/templates/hello-hamlet.json' } }, evidence: [], turns: { pip: [] } };
  assert.ok(genesisThings(run.scenario.world.genesis).get('cottage'));
  assert.equal(genesisThings('worlds/templates/no-such-template.json'), null);
  const hamlet = { kind: 'near', source: 'x', targets: [{ ref: 'cottage', names: ['cottage'], pos: [44, 10], radiusM: 10 }], answer: { anyOf: ['knoll', 'pond'] } };
  const viaRun = (text) => row(runOracles(pack(-17, 40), { run, expect: hamlet, acts: [], turns: [{ turn: 3, finalText: text, endedAt: at(30) }] }), 'answer-names');
  assert.equal(viaRun('The knoll.').status, 'pass');
  assert.equal(viaRun('The pond.').status, 'fail', 'the pond is 70 m from the cottage, where the Soul stands');
});

test('N1, N2: the validator wants targets with radiusM on near and holds anyOf words to the template', () => {
  const G = 'worlds/templates/hello-hamlet.json';
  const x = { kind: 'near', source: G, targets: [{ ref: 'cottage', names: ['cottage'], pos: [44, 10], radiusM: 10 }], answer: { anyOf: ['knoll', 'hill'] } };
  assert.deepEqual(checkNear(G, x, 'w'), []);
  assert.match(checkNear(G, { ...x, targets: undefined }, 'w')[0], /targets\[\] required for near/);
  assert.match(checkNear(G, { ...x, targets: [{ ...x.targets[0], radiusM: undefined }] }, 'w')[0], /radiusM required for near/);
  assert.match(checkNear(G, { ...x, answer: { anyOf: ['knoll', 'pond'] } }, 'w')[0], /anyOf "pond": the nearest placed .* m from cottage \(radiusM 10\)/);
});

test('N1: every near expect in the scenario folder has targets and passes the template truth', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { SCENARIOS } = await import('../../scenarios/lib/validate.mjs');
  let n = 0;
  for (const f of readdirSync(SCENARIOS).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(`${SCENARIOS}/${f}`, 'utf8'));
    for (const e of s.director?.script ?? []) if (e.expect?.kind === 'near') { n++; assert.ok(e.expect.targets?.length, `${f}: ${e.text}`); }
    if (s.director?.script?.some((e) => e.expect?.kind === 'near')) assert.deepEqual(validateScenario(s), [], f);
  }
  assert.ok(n >= 18, `${n} near expects`);
});
