import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JOBS, changedFiles, jobsFor, smokeFor } from './ci-scope.mjs';
import { SCOPE_RULES, scopeFor } from '../../tools/test-harness/release-gate.mjs';

const names = files => jobsFor(files).include.map(j => j.name);

test('docs and plain tools changes run no job', () => {
  assert.deepEqual(names(['README.md', 'docs/TESTING.md', 'tools/playtest/x.mjs']), []);
  assert.equal(jobsFor(['docs/a.md']).scope, 'none');
});

test('web changes run the typecheck/build and the web unit suite', () => {
  assert.deepEqual(names(['apps/web/src/main.ts']), ['types-web', 'web']);
});

test('launcher and client-cli changes run their own unit tests', () => {
  const launcher = names(['tools/world-launcher/launcher.mjs']);
  assert.ok(launcher.includes('launcher'), launcher.join());
  assert.ok(!launcher.includes('web') && !launcher.includes('client-cli'));
  for (const f of ['tools/edge-skill/soul.mjs', 'tools/client-eval/eval.mjs']) assert.deepEqual(names([f]), ['client-cli'], f);
});

test('every step the scope map can select is run by some job', () => {
  const selectable = new Set(SCOPE_RULES.flatMap(([prefix]) => scopeFor([`${prefix}x.ts`]).steps));
  const owned = step => JOBS.some(job => job.steps.some(s => s.endsWith('-') ? step.startsWith(s) : step === s));
  for (const step of selectable) assert.ok(owned(step), `${step} is selectable by --scope auto but no CI job runs it`);
  for (const step of ['V4-web', 'V3-launcher-unit', 'V3-client-cli']) assert.ok(selectable.has(step) && owned(step), step);
});

test('each job kind has a branch in ci.yml', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../workflows/ci.yml', import.meta.url)), 'utf8');
  for (const job of JOBS) assert.match(workflow, new RegExp(`^\\s+${job.kind}\\)$`, 'm'), job.kind);
});

test('server changes run server shards and latency, not native', () => {
  const picked = names(['apps/server/src/world.ts']);
  for (const n of ['latency', 'server-0', 'server-1', 'server-5', 'packages', 'types-web']) assert.ok(picked.includes(n), n);
  assert.ok(!picked.includes('native'));
});

// tools/body-authoring builds the pinned shared presets the server serves (D028): the server legs, including the
// renderer step on server-0, and latency; nothing else, and no browser smoke.
test('body-authoring changes run every server shard and latency, and nothing else', () => {
  const files = ['tools/body-authoring/pip/robot.mjs'], server = JOBS.filter(j => j.kind === 'server').map(j => j.name);
  assert.ok(server.includes('server-0') && server.length > 1, server.join());
  assert.deepEqual(names(files).sort(), ['latency', ...server].sort());
  assert.equal(jobsFor(files).scope, 'scoped');
  assert.equal(smokeFor(files), false);
});

test('unmapped paths (lockfile, .github, mars) run every job', () => {
  for (const f of ['pnpm-lock.yaml', '.github/workflows/ci.yml', 'mars/viewer/x.js']) assert.equal(names([f]).length, JOBS.length, f);
});

test('matrix entries keep the shape the workflow expects', () => {
  for (const job of jobsFor(['package.json']).include) {
    assert.ok(job.name && job.kind && typeof job.assets === 'boolean');
    assert.ok(!('steps' in job));
  }
});

test('no usable base means run everything', () => {
  assert.equal(changedFiles(''), null);
  assert.equal(changedFiles('0000000000000000000000000000000000000000'), null);
  assert.equal(changedFiles('abc', 'def', () => { throw Error('bad ref'); }), null);
  assert.deepEqual(changedFiles('abc', 'def', () => 'a\nb\n'), ['a', 'b']);
});

test('the local smoke runs for web, server and e2e changes, or with no base', () => {
  for (const f of ['apps/web/src/main.ts', 'apps/server/src/world.ts', 'e2e/local-smoke.mjs']) assert.equal(smokeFor([f]), true, f);
  for (const f of ['docs/testing.md', 'packages/kernel/src/x.ts', 'tools/playtest/x.mjs', 'apps/webby/x']) assert.equal(smokeFor([f]), false, f);
  assert.equal(smokeFor(null), true);
});

// Music source changes must retain the web generation/composition checks after leaving vendor/.
test('owned music source selects web build, web tests and package checks', () => {
  const names = jobsFor(['packages/music/source/site/pieces/pixel-town.js']).include.map(j => j.name);
  assert.deepEqual(names.sort(), ['packages', 'types-web', 'web']);
});
