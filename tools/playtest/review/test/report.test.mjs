import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { readJson, writeJson } from '../../lib/jsonl.mjs';
import { reviewRun } from '../reviewer.mjs';
import { reportRun, buildReplay, replayToScenario, verifyReplay } from '../report.mjs';
import { metricsRun } from '../metrics.mjs';
import { compareRuns, compareMd } from '../compare.mjs';
import { loadRun } from '../run.mjs';
import { copyRuns, fakeReviewer, PREV } from './helpers.mjs';

async function reviewed() { const r = copyRuns(); await reviewRun({ runDir: r.main, call: fakeReviewer(), log: () => {} }); return r; }

test('metrics.json families from the fixture', async () => {
  const { main } = await reviewed(); const m = metricsRun(main);
  assert.equal(m.requests, 3);
  assert.equal(m.speed.ackSec.n, 2); assert.equal(m.speed.ackSec.max, 4);
  assert.equal(m.speed.resultSec.median, 22);
  assert.ok(m.speed.walkMps.median > 0 && m.speed.walkMps.median < 1, 'stuck walk is slow');
  assert.deepEqual(m.fidelity.counts, { H: 1, P: 1, M: 1, W: 0, unresolved: 0 });
  assert.equal(m.fidelity.vetoed, 1); assert.equal(m.fidelity.vocabularyMisses, 1);
  assert.equal(m.fidelity.truthfulnessPassRate, 2 / 3);
  assert.deepEqual(m.physical, { ...m.physical, insideSolid: 0, noProgress: 1, stuckReceipts: 1, oscillations: 0 });
  assert.equal(m.uptime.listenOpenFraction, 1); assert.equal(m.uptime.unackedAtCutoff, 0); assert.equal(m.uptime.tickRate, 20);
  assert.equal(m.cost.tokensTotal.input, 49500); assert.equal(m.cost.turnsPerRequest.median, 1); assert.equal(m.cost.cliCallsPerRequest.max, 3);
  assert.equal(m.emergence.storyRating, 2); assert.equal(m.harness.reviewerLeaks, 1);
  assert.ok(m.harness.shotsPlanned > 0 && m.harness.packsWithUnknowns === 3);
});

test('REPORT.md has the eight sections, deltas against the previous run, relative image links; journal is player\'s-eye', async () => {
  const { main } = await reviewed();
  mkdirSync(join(main, 'specs'), { recursive: true });
  writeJson(join(main, 'specs/index.json'), [{ id: 'I-2', kind: 'issue', title: 'Card says Pip arrived', file: 'specs/I-2.md', laneBrief: { lane: 'team/lanes/x.md' }, rescored: false, serverRootTouched: false }]);
  reportRun(main);
  const md = readFileSync(join(main, 'REPORT.md'), 'utf8');
  for (const h of ['## 1. Identity', '## 2. What happened', '## 3. Fidelity', '## 4. Objective measures', '## 5. Emergence and story', '## 6. Issues and feature requests', '## 7. Developer drafts', '## 8. Harness notes']) assert.ok(md.includes(h), h);
  assert.match(md, /we-22303887a287/); assert.match(md, /pip: claude-headless haiku\/medium, persona newcomer/);
  assert.match(md, new RegExp(`previous run of this scenario: \`${PREV}\``));
  assert.match(md, /\| ack \(median\) \(s\) \| 3\.50 \| 6 \| -2\.50 \|/);
  assert.match(md, /\| \*\*P\*\* \|/); assert.match(md, /H→P by/);
  const links = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 2); for (const l of links) { assert.ok(!l.startsWith('/'), l); assert.ok(existsSync(join(main, l)), l); }
  assert.match(md, /DRAFT — NOT IMPLEMENTED/); assert.match(md, /\[I-2: Card says Pip arrived\]\(specs\/I-2\.md\)/);
  assert.match(md, /stripped/); assert.match(md, /Greet animals\*\* ×2/);
  const j = readFileSync(join(main, 'journal.md'), 'utf8');
  assert.match(j, /pip asked Pip: "go to the library" \(card\)/);
  assert.match(j, /Card result\*\* \(after 40 s\): "I've arrived at the library\."/);
  assert.match(j, /went from sitting in Fountain Plaza to standing in Market Square/);
  assert.match(j, /complaint:\* "it says she arrived at the library but she is standing still in the market"/);
  assert.match(j, /fun 2\/5, alive 2\/5/); assert.match(j, /\]\(shots\/pip\/185000\.png\)/);
});

test('replay.json round trip: a scripted replay is reproducible from replay.json alone', async () => {
  const { main } = await reviewed(); reportRun(main);
  const replay = JSON.parse(readFileSync(join(main, 'replay.json'), 'utf8'));
  assert.deepEqual(replay, buildReplay(loadRun(main)), 'deterministic');
  assert.equal(replay.seed, 1); assert.equal(replay.build, 'we-22303887a287');
  assert.equal(replay.world.genesis, 'worlds/templates/eden-2026.json'); assert.equal(replay.world.cli['eden.mjs'].length, 64);
  assert.equal(replay.personas.pip.sha256.length, 64); assert.equal(replay.review.rubric.sha256.length, 64);
  assert.deepEqual(replay.adapters[0], { seat: 'pip', adapter: 'claude-headless', model: 'haiku', effort: 'medium', personaModel: 'opus', soulId: 'soul_pip01' });
  assert.equal(replay.decisionLog.pip.length, 7);
  // from replay.json only (copied elsewhere, run folder gone)
  const only = JSON.parse(JSON.stringify(replay));
  const sc = replayToScenario(only, 'scripted');
  assert.equal(sc.director.mode, 'scripted'); assert.equal(sc.seed, 1); assert.equal(sc.world.slug, 'pt-fixture');
  assert.deepEqual(sc.director.script, [{ seat: 'pip', atSec: 30, channel: 'card', text: 'sit down', budgetSec: 90 }, { seat: 'pip', atSec: 90, channel: 'chat', text: 'say hi to the duck', budgetSec: 90 }, { seat: 'pip', atSec: 150, channel: 'card', text: 'go to the library', budgetSec: 90 }]);
  assert.equal(replayToScenario(only, 'live').director.mode, 'persona');
  assert.deepEqual(verifyReplay(only, { pip: readFileSync(join(main, 'personas/pip/sheet.md'), 'utf8') }), [{ seat: 'pip', ok: true }]);
  assert.deepEqual(verifyReplay(only, { pip: 'edited sheet' }), [{ seat: 'pip', ok: false }]);
});

test('compare: metric deltas and issues appeared / persisted / vanished', async () => {
  const { main, prev } = await reviewed(); reportRun(main);
  const c = compareRuns(prev, main);
  assert.equal(c.scenario.a, 'fixture-newcomer');
  assert.deepEqual(c.metrics['speed.ackSec.median'], { a: 6, b: 3.5, delta: -2.5 });
  assert.deepEqual(c.issues.persisted, ['Greeting the duck is not possible']);
  assert.deepEqual(c.issues.vanished, ['Pip sat on the ground instead of a bench']);
  assert.equal(c.issues.appeared.length, 1);
  assert.ok(c.emergence['narrative.storyRating']);
  assert.match(compareMd(c), /\| speed\.ackSec\.median \| 6 \| 3\.5 \| -2\.5 \|/);
});
