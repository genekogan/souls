// Directed casts as Soul Runs (#783 slice 3): a spec names a swarm cast file; validation refuses live minds, mixed
// specs and bad casts before anything starts; startRun runs cmdDirect through the lifecycle hooks (fake modules here:
// no world, controller, browser or model) and writes a terminal receipt that references the cast and the journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSpec } from './spec.mjs';
import { startRun, executeCast, RECEIPT } from './lifecycle.mjs';
import { evaluateRun } from './evaluate.mjs';
import { fakeDirectModules } from '../director/swarm/test/fakes.mjs';

const REPO_CAST = new URL('../scenarios/casts/hamlet-trio-scripted.json', import.meta.url).pathname;
const REPO_SPEC = new URL('./specs/hamlet-trio-direct.json', import.meta.url).pathname;
let nextPort = 43340;
function fixture({ seats = null, planner = null, consoleScript = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'soul-cast-'));
  const serverRoot = join(dir, 'root');
  for (const f of ['apps/server/src/main.ts', 'apps/web/dist/index.html', 'tools/world-launcher/soul/eden.mjs', 'g.json']) { mkdirSync(join(serverRoot, f, '..'), { recursive: true }); writeFileSync(join(serverRoot, f), ''); }
  const script = { rules: [{ match: '.', do: [] }] };
  const cast = { kind: 'cast', name: 'fx-trio', brief: 'Three friends give short talks.', world: { kind: 'dev', genesis: 'g.json', slug: 'pt-fx', port: nextPort++ }, room: { label: 'the hall', match: ['hall'] },
    seats: seats ?? ['ann', 'bob', 'cy'].map((id) => ({ id, soulName: id, character: 'c', adapter: 'scripted-owner', script })), durationSec: 20, orchestrator: { planner },
    timing: { truthPollSec: 0.05, gatherMaxSec: 10, nudgeAfterSec: 5, quietSec: 1, speakTimeoutSec: 5, presentWaitSec: 1 }, observer: { cameras: [], sampleSec: 1 }, console: { script: consoleScript } };
  writeFileSync(join(dir, 'cast.json'), JSON.stringify(cast));
  const spec = (over = {}) => ({ soulRun: 1, cast: { file: join(dir, 'cast.json') }, observer: { check: false }, ...over });
  return { dir, serverRoot, spec, cast, out: () => join(dir, `run-${nextPort++}`) };
}
const codes = (v) => v.errors.map((e) => e.code);
const PREFLIGHT = async () => ({ ok: true, allow: { allowed: true }, checks: { providersOk: true, machineOk: true } });

test('the repository spec validates: three scripted-owner seats, no providers, the cast hashed', () => {
  const v = validateSpec(JSON.parse(readFileSync(REPO_SPEC, 'utf8')), { specPath: REPO_SPEC });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.effective.kind, 'cast');
  assert.equal(v.effective.cast.path, REPO_CAST);
  assert.match(v.effective.cast.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(v.controllers.map((c) => `${c.id}:${c.adapter}`), ['ada:scripted-owner', 'bo:scripted-owner', 'cy:scripted-owner']);
  assert.deepEqual(v.policy.required, []);
  assert.equal(v.cast.console.script.filter((e) => /^redirect bo:/.test(e.line)).length, 1);
});

test('live seats or a live planner are refused unless controllers.allowLiveModels; mixed and malformed specs are refused', () => {
  const live = fixture({ seats: [{ id: 'ann', soulName: 'Ann', character: 'c' }] });
  const r = validateSpec(live.spec(), { serverRoot: live.serverRoot });
  assert.deepEqual(codes(r), ['controllers.live-model']);
  assert.match(r.errors[0].message, /ann:claude-headless\/haiku/);
  assert.equal(validateSpec(live.spec({ controllers: { allowLiveModels: true } }), { serverRoot: live.serverRoot }).ok, true);
  const planner = fixture({ planner: 'sonnet' });
  assert.deepEqual(codes(validateSpec(planner.spec(), { serverRoot: planner.serverRoot })), ['controllers.live-model']);
  const f = fixture();
  assert.equal(validateSpec(f.spec(), { serverRoot: f.serverRoot }).ok, true);
  assert.deepEqual(codes(validateSpec(f.spec({ scenario: 'x.json' }), { serverRoot: f.serverRoot })), ['cast.with-scenario']);
  assert.deepEqual(codes(validateSpec({ ...f.spec(), cast: { file: join(f.dir, 'cast.json'), seats: [] } }, { serverRoot: f.serverRoot })), ['cast.unknown-field']);
  assert.deepEqual(codes(validateSpec({ ...f.spec(), cast: { file: join(f.dir, 'nope.json') } }, { serverRoot: f.serverRoot })), ['cast.not-found']);
  assert.deepEqual(codes(validateSpec(f.spec({ setup: { batches: [join(f.dir, 'b.json')] } }), { serverRoot: f.serverRoot })), ['setup.batch-missing']);
  assert.deepEqual(codes(validateSpec(f.spec({ world: { genesis: 'other.json' } }), { serverRoot: f.serverRoot })), ['world.override']);
  writeFileSync(join(f.dir, 'bad.json'), JSON.stringify({ ...f.cast, seats: [{ id: 'ann', soulName: 'Ann', character: 'c', adapter: 'scripted-owner', script: { rules: [] } }] }));
  assert.deepEqual(codes(validateSpec({ ...f.spec(), cast: { file: join(f.dir, 'bad.json') } }, { serverRoot: f.serverRoot })), ['cast.seat-script']);
  writeFileSync(join(f.dir, 'worse.json'), JSON.stringify({ ...f.cast, room: null }));
  assert.deepEqual(codes(validateSpec({ ...f.spec(), cast: { file: join(f.dir, 'worse.json') } }, { serverRoot: f.serverRoot })), ['cast.invalid']);
});

test('a directed run completes through the hooks: owned resources released, receipt references cast and journal, evaluate reads it', async () => {
  const f = fixture({ consoleScript: [{ atSec: 0, line: 'redirect bob: talk about the piano', expect: ['piano'] }, { atSec: 0.5, line: 'end' }] });
  const fake = fakeDirectModules();
  const r = await startRun({ spec: f.spec({ name: 'fx-direct' }), serverRoot: f.serverRoot, outDir: f.out(), scenarioPreflight: PREFLIGHT,
    execute: (o) => executeCast({ ...o, castFile: o.scenarioFile, hooks: { ...o.hooks, modules: fake.modules } }) });
  assert.equal(r.status, 'completed', r.reason);
  assert.equal(r.resources.ok, true, JSON.stringify(r.resources.failed));
  assert.deepEqual(r.resources.entries.filter((e) => e.owner === 'run').map((e) => `${e.kind}:${e.id}:${e.state}`).sort(), ['browser:observer:released', 'controller:ann:released', 'controller:bob:released', 'controller:cy:released', 'world:pt-fx:released']);
  assert.ok(existsSync(r.references.cast));
  assert.equal(r.references.journal, join(r.references.playtestDir, 'director', 'commands.jsonl'));
  const journal = readFileSync(r.references.journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(journal.map((c) => [c.source, c.cmd, c.target, c.outcome]), [['script', 'redirect', 'bob', 'applied'], ['script', 'end', 'all', 'applied']]);
  assert.equal(typeof r.evidence.verdict.pass, 'boolean');
  const saved = JSON.parse(readFileSync(join(r.references.runDir, RECEIPT), 'utf8'));
  assert.equal(saved.spec.effective.kind, 'cast');
  const { evaluation: e } = await evaluateRun(r.references.runDir, {});
  const d = e.measures.find((m) => m.id === 'directions');
  assert.deepEqual({ status: d.status, value: d.value, redirect: d.redirections.map((x) => [x.target, x.outcome]) }, { status: 'measured', value: 2, redirect: [['bob', 'applied']] });
});

test('a cancelled directed run ends as cancelled with every owned resource released', async () => {
  const f = fixture({ consoleScript: [] });
  const ac = new AbortController();
  const fake = fakeDirectModules({ onCard: (n) => { if (n === 2) ac.abort('SIGINT'); } });
  const r = await startRun({ spec: f.spec(), serverRoot: f.serverRoot, outDir: f.out(), scenarioPreflight: PREFLIGHT, signal: ac.signal,
    execute: (o) => executeCast({ ...o, castFile: o.scenarioFile, hooks: { ...o.hooks, modules: fake.modules } }) });
  assert.equal(r.status, 'cancelled');
  assert.equal(r.resources.ok, true, JSON.stringify(r.resources.failed));
  assert.equal(r.resources.owned, 5);
});

test('executeCast refuses live minds inside the runner too when the spec did not allow them', async () => {
  const f = fixture({ seats: [{ id: 'ann', soulName: 'Ann', character: 'c' }] });
  const code = await executeCast({ castFile: join(f.dir, 'cast.json'), playtestDir: join(f.dir, 'pt'), serverRoot: f.serverRoot, hooks: { own: () => assert.fail('nothing owned'), modules: fakeDirectModules().modules, preflight: { ok: true, checks: {} } } });
  assert.equal(code, 2);
  assert.equal(existsSync(join(f.dir, 'pt')), false);
});

test('setup batches with a directed cast: validated and hashed like a scenario spec, applied before any seat, a refusal fails at setup', async () => {
  const f = fixture({ consoleScript: [{ atSec: 0.5, line: 'end' }] });
  writeFileSync(join(f.dir, 'bench.json'), JSON.stringify({ id: 'hall-bench', ops: [{ op: 'place', def: 'core/bench@1', name: 'b', p: [0, 4] }] }));
  writeFileSync(join(f.dir, 'empty.json'), JSON.stringify({ id: 'empty', ops: [] }));
  const setup = { batches: [join(f.dir, 'bench.json'), { id: 'inline', ops: [{ op: 'place', def: 'core/bench@1', name: 'c', p: [1, 4] }] }], maxWallSec: 30 };
  const v = validateSpec(f.spec({ setup }), { serverRoot: f.serverRoot });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.effective.setup.maxWallSec, 30);
  assert.deepEqual(v.effective.setup.batches.map((b) => [b.id, b.ops, /^[0-9a-f]{64}$/.test(b.sha256)]), [['hall-bench', 1, true], ['inline', 1, true]]);
  assert.equal(v.setup.batches[0].ops[0].def, 'core/bench@1');
  // The same static refusals as scenario specs, before anything starts.
  for (const [bad, code] of [[{ batches: [], extra: 1 }, ['setup.unknown-field', 'setup.batches']], [{ batches: [join(f.dir, 'empty.json')] }, ['setup.batch-ops']], [{ batches: [7] }, ['setup.batch']], [{ batches: [join(f.dir, 'b.json')], maxWallSec: 0 }, ['setup.maxWallSec']]]) {
    assert.deepEqual(codes(validateSpec(f.spec({ setup: bad }), { serverRoot: f.serverRoot })), code, JSON.stringify(bad));
  }
  // Applied after provision and before any seat: the setup call sees the world and no seat yet.
  const fake = fakeDirectModules(), seen = [];
  const setupFn = async ({ base, setup: s }) => { seen.push({ base, made: [...fake.made], ids: s.batches.map((b) => b.id) }); return { ok: true, batches: s.batches.map((b) => ({ id: b.id, ok: true })) }; };
  const out = f.out();
  const r = await startRun({ spec: f.spec({ name: 'fx-setup', setup }), serverRoot: f.serverRoot, outDir: out, scenarioPreflight: PREFLIGHT, setupFn,
    execute: (o) => executeCast({ ...o, castFile: o.scenarioFile, hooks: { ...o.hooks, modules: fake.modules } }) });
  assert.equal(r.status, 'completed', r.reason);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].ids, ['hall-bench', 'inline']);
  assert.equal(seen[0].base, 'http://127.0.0.1:9');
  assert.ok(seen[0].made.some((m) => m.startsWith('world:')) && !seen[0].made.some((m) => m.startsWith('seat')), JSON.stringify(seen[0].made));
  assert.equal(r.setup.ok, true);
  assert.ok(existsSync(join(out, 'setup.json')));
  // A refused batch fails the run at setup: no seat, everything owned released.
  const fake2 = fakeDirectModules();
  const refused = await startRun({ spec: f.spec({ name: 'fx-setup-refused', setup }), serverRoot: f.serverRoot, outDir: f.out(), scenarioPreflight: PREFLIGHT,
    setupFn: async () => ({ ok: false, error: 'batch hall-bench refused: build.blocked', batches: [] }),
    execute: (o) => executeCast({ ...o, castFile: o.scenarioFile, hooks: { ...o.hooks, modules: fake2.modules } }) });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.stage, 'setup');
  assert.match(refused.reason, /setup refused: batch hall-bench refused/);
  assert.ok(!fake2.made.some((m) => m.startsWith('seat')), JSON.stringify(fake2.made));
  assert.equal(refused.resources.ok, true, JSON.stringify(refused.resources.failed));
});
