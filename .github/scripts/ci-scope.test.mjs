import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { FULL_EVENTS, GOD_SKILL_TESTS, JOBS, MERGE_FORWARD_COMMENT, MERGE_FORWARD_MARKER, WINDOW_LABELS, acceptsPrInput, changedFiles, greenAtHead, hasMergeForwardComment, jobsFor, smokeFor, windowFor, windowed } from './ci-scope.mjs';
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

test('the soul-actions job runs on its own paths, full scope included, and on nothing else (#1061)', () => {
  for (const f of ['tools/soul-actions/shared-crew.test.mjs', 'apps/server/src/edge/ledger/together.ts', 'apps/server/test/native-owner-fixture.ts', 'packages/world-compiler/src/model.ts', 'packages/engine-mars/src/x.ts']) assert.ok(names([f]).includes('soul-actions'), f);
  for (const f of ['apps/web/src/App.tsx', 'docs/testing.md', 'tools/world-launcher/launcher.mjs', 'packages/edge-cli/x.ts']) assert.ok(!names([f]).includes('soul-actions'), f);
  assert.ok(names(['pnpm-lock.yaml']).includes('soul-actions'));
  assert.ok(!('paths' in jobsFor(['tools/soul-actions/x.test.mjs']).include.find(j => j.name === 'soul-actions')));
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

// The CI window (#913, docs/testing.md#ci-window).
const script = fileURLToPath(new URL('./ci-scope.mjs', import.meta.url));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } }));

test('window: a ready PR labelled merge:ready or ci:run is open; drafts and unlabelled PRs are closed; other events are never windowed', () => {
  assert.deepEqual(WINDOW_LABELS, ['merge:ready', 'ci:run']);
  assert.equal(windowFor({ event: 'pull_request', labels: ['ci:run'] }).open, true);
  assert.equal(windowFor({ event: 'pull_request', labels: ['area:ci', 'merge:ready'] }).open, true);
  assert.equal(windowFor({ event: 'pull_request', labels: ['area:ci'] }).open, false);
  assert.equal(windowFor({ event: 'pull_request', draft: true, labels: ['ci:run'] }).open, false);
  for (const event of ['push', 'workflow_dispatch', 'merge_group', 'request']) assert.equal(windowFor({ event }).open, true, event);
});

test('window: closed with heavy jobs selected defers them all; nothing selected is never deferred', () => {
  const heavy = { include: jobsFor(['apps/server/src/world.ts']).include, smoke: true };
  const closed = windowFor({ event: 'pull_request', labels: [] }), open = windowFor({ event: 'pull_request', labels: ['ci:run'] });
  assert.deepEqual(windowed(heavy, closed), { include: [], smoke: false, deferred: true, why: closed.why });
  assert.deepEqual(windowed(heavy, open), { ...heavy, deferred: false, why: open.why });
  assert.equal(windowed({ include: [], smoke: false }, closed).deferred, false);
  assert.equal(windowed({ include: [], smoke: true }, closed).deferred, true, 'the smoke alone is heavy work too');
  const already = windowed(heavy, windowFor({ event: 'request' }), { greenAtHead: true });
  assert.deepEqual([already.include, already.smoke, already.deferred], [[], false, false]);
  assert.equal(windowed(heavy, closed, { greenAtHead: true }).deferred, true, 'an earlier green never opens a closed window');
});

test('window CLI: the outputs ci.yml reads, for a PR push outside and inside the window and for a requested run', () => {
  const server = ['--files', 'apps/server/src/world.ts'];
  const out = run(...server, '--event', 'pull_request', '--draft', 'false', '--labels', '["area:ci"]');
  assert.deepEqual([out.matrix, out.any, out.smoke, out.deferred], [[], 'false', 'false', 'true']);
  assert.ok(out.selected.includes('server-0'), 'the deferred jobs are still reported');
  const inside = run(...server, '--event', 'pull_request', '--draft', 'false', '--labels', '["ci:run"]');
  assert.deepEqual([inside.any, inside.smoke, inside.deferred], ['true', 'true', 'false']);
  assert.deepEqual(inside.matrix, names(['apps/server/src/world.ts']));
  const draft = run(...server, '--event', 'pull_request', '--draft', 'true', '--labels', '["merge:ready"]');
  assert.equal(draft.deferred, 'true');
  const requested = run(...server, '--event', 'request');
  assert.deepEqual([requested.scope, requested.deferred, requested.matrix], ['scoped', 'false', names(['apps/server/src/world.ts'])], 'a request is path-scoped, not full');
  assert.deepEqual(run(...server, '--event', 'request', '--green-at-head', 'true').matrix, []);
  const docs = run('--files', 'docs/a.md', '--event', 'pull_request', '--labels', 'null');
  assert.deepEqual([docs.deferred, docs.any, docs.smoke], ['false', 'false', 'false']);
  for (const event of FULL_EVENTS) assert.equal(run('--files', 'docs/a.md', '--event', event).deferred, 'false', event);
});

test('greenAtHead: the newest uncancelled ci run at the head passed, and none newer is running', () => {
  const r = (id, status, conclusion = null) => ({ id, status, conclusion });
  assert.equal(greenAtHead([]), false);
  assert.equal(greenAtHead([r(1, 'completed', 'success')]), true);
  assert.equal(greenAtHead([r(1, 'completed', 'success'), r(2, 'completed', 'failure')]), false, 'a deferred or failed newer run');
  assert.equal(greenAtHead([r(1, 'completed', 'success'), r(2, 'completed', 'cancelled')]), true, 'cancelled says nothing');
  assert.equal(greenAtHead([r(1, 'completed', 'success'), r(2, 'in_progress')]), false, 'a newer run is still going');
  assert.equal(greenAtHead([r(1, 'completed', 'success'), r(2, 'in_progress')], 2), true, 'a run never counts itself');
});

test('ci.yml: the window reaches the scope step, and a deferred run fails ci-ok', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../workflows/ci.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /--draft "\$DRAFT" --labels "\$LABELS" --green-at-head "\$GREEN"/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(workflow, /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pr \|\| github\.ref \}\}/);
  const ok = workflow.slice(workflow.indexOf('\n  ci-ok:'));
  assert.match(ok, /if: needs\.scope\.outputs\.deferred == 'true'[\s\S]*?exit 1/);
  const request = readFileSync(fileURLToPath(new URL('../workflows/ci-request.yml', import.meta.url)), 'utf8');
  assert.match(request, /label\.name == 'ci:run' \|\| github\.event\.label\.name == 'merge:ready'/);
  assert.match(request, /gh workflow run ci\.yml --repo "\$REPO" --ref "\$HEAD_REF" -f pr="\$PR"/);
  const [beforeDispatch] = request.split('gh workflow run');
  assert.match(beforeDispatch, /dispatchable="\$\(node \.github\/scripts\/ci-scope\.mjs dispatchable --repo "\$REPO" --sha "\$HEAD_SHA"\)"\n\s+if \[ "\$dispatchable" != true \][\s\S]*merge-forward --repo "\$REPO" --pr "\$PR"\n\s+exit 0/, 'a branch without the pr input is never dispatched');
  assert.doesNotMatch(request, /\[ "\$\(node/, 'a helper runs outside [ ], so bash -e fails the step when it fails');
  assert.doesNotMatch(request, /pull_request\.head\.sha \}\}\n\s+ref:|ref: \$\{\{ github\.event\.pull_request/, 'never checks out the PR');
  const labels = readFileSync(fileURLToPath(new URL('../labels.yml', import.meta.url)), 'utf8');
  for (const l of WINDOW_LABELS) assert.match(labels, new RegExp(`name: "${l}"`));
});

// A branch cut before #914 still has this ci.yml: dispatching it with `pr` is refused with HTTP 422.
const PRE_WINDOW = `name: ci
on:
  pull_request:
  merge_group:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  scope:
    steps:
      - uses: actions/checkout@v7
        with: { inputs: pr }
`;

test('acceptsPrInput: main\'s ci.yml takes the pr input, a pre-window branch\'s does not', () => {
  assert.equal(acceptsPrInput(readFileSync(fileURLToPath(new URL('../workflows/ci.yml', import.meta.url)), 'utf8')), true);
  assert.equal(acceptsPrInput(PRE_WINDOW), false);
  assert.equal(acceptsPrInput(''), false, 'no ci.yml at the head');
  assert.equal(acceptsPrInput(undefined), false);
  const dispatch = inputs => `on:\n  push:\n  workflow_dispatch:\n${inputs}permissions:\n  contents: read\n`;
  assert.equal(acceptsPrInput(dispatch('    inputs:\n      # the PR\n      pr:\n        required: false\n')), true);
  assert.equal(acceptsPrInput(dispatch('    inputs:\n      "pr":\n        required: false\n')), true, 'a quoted key');
  assert.equal(acceptsPrInput(dispatch('    inputs:\n      other:\n        description: pr\n')), false, 'another input only');
  assert.equal(acceptsPrInput(dispatch('    inputs:\n      other:\n        pr:\n          x: 1\n')), false, 'pr nested under another input');
  assert.equal(acceptsPrInput(dispatch('    branches: [main]\n') + 'jobs:\n  inputs:\n    pr:\n'), false, 'inputs outside workflow_dispatch');
  assert.equal(acceptsPrInput(dispatch('    inputs:\n      prefix:\n        required: false\n')), false, 'a key that only starts with pr');
});

test('merge-forward: one comment per PR, naming the fix', () => {
  assert.ok(MERGE_FORWARD_COMMENT.startsWith(MERGE_FORWARD_MARKER));
  assert.match(MERGE_FORWARD_COMMENT, /Merge main forward to enable `ci:run`/);
  assert.match(MERGE_FORWARD_COMMENT, /docs\/testing\.md#ci-window/);
  assert.equal(hasMergeForwardComment([]), false);
  assert.equal(hasMergeForwardComment(undefined), false);
  assert.equal(hasMergeForwardComment([{ body: 'lgtm' }, { body: null }]), false);
  assert.equal(hasMergeForwardComment([{ body: 'lgtm' }, { body: MERGE_FORWARD_COMMENT }]), true);
});
