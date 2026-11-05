import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { FULL_EVENTS, GOD_SKILL_TESTS, JOBS, changedFiles, jobsFor, smokeFor } from './ci-scope.mjs';
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

test('pushes to main and manual runs check everything; pull request runs stay scoped', () => {
  const script = fileURLToPath(new URL('./ci-scope.mjs', import.meta.url));
  const plan = event => JSON.parse(execFileSync(process.execPath, [script, '--files', 'docs/a.md', '--event', event], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } }));
  assert.deepEqual(FULL_EVENTS, ['push', 'workflow_dispatch']);
  for (const event of FULL_EVENTS) {
    const p = plan(event);
    assert.equal(p.scope, 'full', event);
    assert.deepEqual(p.matrix, JOBS.map(j => j.name), event);
    assert.equal(p.smoke, 'true', event);
  }
  for (const event of ['pull_request', 'merge_group']) {
    const p = plan(event);
    assert.equal(p.scope, 'none', event);
    assert.deepEqual(p.matrix, [], event);
  }
  // ci.yml passes the event to the scope step, and only takes pushes to main.
  const workflow = readFileSync(fileURLToPath(new URL('../workflows/ci.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /ci-scope\.mjs --base "\$BASE" --head "\$HEAD_SHA" --event "\$EVENT"/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
});

// #918: the god-skill unit tests (replay corpus included) run on the one job carrying godSkill.
test('god-skill unit tests: one job runs them, and god or god-skill changes select it', async () => {
  assert.deepEqual(JOBS.filter(j => j.godSkill).map(j => j.name), ['server-0']);
  assert.equal(JOBS.find(j => j.godSkill).assets, true, 'glb and upload tests read pulled media');
  const god = files => jobsFor(files).include.filter(j => j.godSkill).map(j => j.name);
  for (const f of ['tools/god-skill/lib/upload.mjs', 'tools/god-skill/replay-corpus.test.mjs', 'apps/server/src/god/buildsafe-rule.ts']) assert.deepEqual(god([f]), ['server-0'], f);
  assert.deepEqual(god(['docs/testing.md']), []);
  const workflow = readFileSync(fileURLToPath(new URL('../workflows/ci.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /GOD_SKILL: \$\{\{ matrix\.godSkill \|\| false \}\}/);
  assert.ok(workflow.includes(`if [ "$GOD_SKILL" = true ]; then node --test --test-concurrency=1 ${GOD_SKILL_TESTS} || god=$?; fi`));
  assert.match(workflow, /exit \$\(\( server \|\| god \)\)/);
  // every god-skill *.test.mjs is covered by the globs (the e2e/*.test.mjs are fixture unit tests: no browser)
  const { readdirSync } = await import('node:fs');
  const root = fileURLToPath(new URL('../../tools/god-skill/', import.meta.url));
  const all = readdirSync(root, { recursive: true }).filter(f => /\.test\.mjs$/.test(f) && !f.includes('node_modules')).map(f => `tools/god-skill/${f}`);
  const covered = f => GOD_SKILL_TESTS.split(' ').some(g => new RegExp(`^${g.replace(/\./g, '\\.').replace('*', '[^/]*')}$`).test(f));
  assert.deepEqual(all.filter(f => !covered(f)), [], 'god-skill tests outside GOD_SKILL_TESTS');
});
