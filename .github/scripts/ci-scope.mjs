#!/usr/bin/env node
// Picks the CI jobs a change needs, from the same path map the release gate uses (`release-gate.mjs --scope auto`).
//
//   node .github/scripts/ci-scope.mjs --base <ref|sha> [--head <ref|sha>] [--event <name>]   (or --files a,b,c for tests)
//
// A push to main (ci.yml only takes pushes to main) and a manual run check everything, whatever changed: each merge then
// leaves a full-scope run on main, which the merge train reads as proof that main is green (mainCiState in
// merge-train.mjs). Pull request runs stay scoped to their paths.
// Paths no rule names (root files, the lockfile, mars/, worlds/, vendor/, .github/ ...) run every job; docs and
// tools-only changes run none (ci-ok still reports). Writes `matrix`, `any`, `scope` and `smoke` to $GITHUB_OUTPUT when set.
// `smoke` (the browser local smoke, e2e/local-smoke.mjs) runs when apps/web, apps/server or e2e change, or with no base.
//
// The CI window (docs/testing.md#ci-window): a pull request run does its heavy jobs (the qualify matrix and the smoke)
// only when the PR is not a draft and carries merge:ready or ci:run (--draft, --labels from the event), or when CI was
// requested for it (--event request: ci-request.yml, or `gh workflow run ci.yml --ref <branch> -f pr=<n>`, scoped by
// the PR's paths against main). Outside the window a run that selected heavy jobs is deferred: none run and ci-ok fails,
// so a skipped job never reads as a pass. A requested run whose head already has a green ci run (--green-at-head) has
// nothing left to do. `green --repo o/r --sha <sha> [--self <run id>]` prints whether the head's newest ci run passed.
// A dispatch runs the ci.yml of the branch it targets, so a branch cut before the window (#914) refuses `pr` (HTTP 422).
// `dispatchable --repo o/r --sha <sha>` prints whether the head's ci.yml declares the `pr` input; when it does not,
// `merge-forward --repo o/r --pr <n>` posts one comment asking to merge main forward (never a second one).
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_STEPS, scopeFor } from '../../tools/test-harness/release-gate.mjs';
import { SERVER_SHARDS } from './server-test-files.mjs';

// The qualify matrix. `steps` are the gate steps that make a job relevant, and the job runs the same command as that
// step in tools/test-harness/one-validation.sh (web: V4-web, launcher: V3-launcher-unit, client-cli: V3-client-cli);
// `assets` says whether the job pulls media first. Keep this list and the case block in ci.yml in step;
// ci-scope.test.mjs checks that every step the scope map can select has a job.
export const JOBS = [
  { name: 'types-web', kind: 'types-web', assets: true, steps: ['V1-types', 'V2-build-root', 'V2-build-worlds', 'V3-bundle'] },
  { name: 'packages', kind: 'packages', assets: true, steps: ['V3-packages', 'V3-walk'] },
  { name: 'web', kind: 'web', assets: true, steps: ['V4-web'] },
  { name: 'launcher', kind: 'launcher', assets: true, steps: ['V3-launcher-unit'] },
  { name: 'client-cli', kind: 'client-cli', assets: true, steps: ['V3-client-cli'] },
  { name: 'native', kind: 'native', assets: true, steps: ['V3-mars-engine'] },
  { name: 'latency', kind: 'latency', assets: false, steps: ['V5-server-full'] },
  // the server inventory in SERVER_SHARDS duration-balanced shards (server-test-files.mjs)
  ...Array.from({ length: SERVER_SHARDS }, (_, shard) => ({ name: `server-${shard}`, kind: 'server', shard, assets: true, steps: ['V5-server-full', 'V6-'] })),
];

const relevant = (job, steps) => job.steps.some(s => steps.some(step => s.endsWith('-') ? step.startsWith(s) : step === s));

export function jobsFor(files) {
  const scope = scopeFor(files);
  const include = scope.resolved === 'full' ? JOBS : JOBS.filter(job => relevant(job, scope.steps));
  return { scope: scope.resolved, steps: scope.steps, include: include.map(({ steps, ...job }) => job), diff: scope.diff };
}

/** The local smoke job: changes under apps/web, apps/server or e2e; null (no usable base) runs it too. */
export const SMOKE_PATHS = /^(apps\/web|apps\/server|e2e)\//;
export const smokeFor = files => files === null || files.some(f => SMOKE_PATHS.test(f));

/** Events whose runs check everything regardless of the changed paths. */
export const FULL_EVENTS = ['push', 'workflow_dispatch'];

/** Labels that open the CI window for a ready PR. */
export const WINDOW_LABELS = ['merge:ready', 'ci:run'];

/** Whether a run may do heavy work. Only pull_request runs are windowed; a requested run is open by definition. */
export function windowFor({ event, draft = false, labels = [] }) {
  if (event === 'request') return { open: true, why: 'requested for this PR' };
  if (event !== 'pull_request') return { open: true, why: `${event} runs are not windowed` };
  if (draft) return { open: false, why: 'the PR is a draft' };
  const hit = WINDOW_LABELS.find(l => labels.includes(l));
  return hit ? { open: true, why: `labelled ${hit}` } : { open: false, why: `not labelled ${WINDOW_LABELS.join(' or ')}` };
}

/** Applies the window to a plan: closed with heavy work selected defers it all; nothing selected is never deferred. */
export function windowed({ include, smoke }, win, { greenAtHead = false } = {}) {
  if (win.open && greenAtHead) return { include: [], smoke: false, deferred: false, why: 'a ci run at this head already passed' };
  if (win.open || (!include.length && !smoke)) return { include, smoke, deferred: false, why: win.why };
  return { include: [], smoke: false, deferred: true, why: win.why };
}

/** The head's newest ci run (other than `self`) concluded success, and no newer one is still running. */
export function greenAtHead(runs = [], self = null) {
  const others = runs.filter(r => String(r.id) !== String(self ?? '') && !['cancelled', 'skipped'].includes(r.conclusion)).sort((a, b) => b.id - a.id);
  return others[0]?.status === 'completed' && others[0].conclusion === 'success';
}

/** Whether a ci.yml's workflow_dispatch declares the `pr` input (block-style YAML, as ci.yml is written). */
export function acceptsPrInput(yml) {
  const lines = String(yml ?? '').split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const indent = l => l.length - l.trimStart().length;
  const key = (l, k) => new RegExp(`^\\s*['"]?${k}['"]?:(\\s|$)`).test(l);
  // The lines nested under the first `k:` line (at the block's own level when `level`), until the indentation returns.
  const under = (block, k, level) => {
    const i = block.findIndex(l => key(l, k) && (!level || indent(l) === indent(block[0])));
    const out = [];
    if (i >= 0) for (const l of block.slice(i + 1)) { if (indent(l) <= indent(block[i])) break; out.push(l); }
    return out;
  };
  const inputs = under(under(lines, 'workflow_dispatch'), 'inputs', true);
  return inputs.some(l => indent(l) === indent(inputs[0]) && key(l, 'pr'));
}

/** The one comment a PR gets when its branch's ci.yml cannot take a requested run. */
export const MERGE_FORWARD_MARKER = '<!-- ci-request:merge-forward -->';
export const MERGE_FORWARD_COMMENT = `${MERGE_FORWARD_MARKER}
CI request: this branch's \`ci.yml\` predates the CI window (#914) and has no \`pr\` input, so \`ci:run\` and \`merge:ready\` cannot start its CI (GitHub refuses the dispatch). **Merge main forward to enable \`ci:run\`**: merge or rebase main into the branch and push. That push runs this PR's CI in the window (any push does, while the PR merges cleanly), and later \`ci:run\` requests then work. A \`merge:ready\` PR is also rebased by the merge train's strict path. See docs/testing.md#ci-window.`;
export const hasMergeForwardComment = (comments = []) => comments.some(c => String(c.body ?? '').includes(MERGE_FORWARD_MARKER));

const ZERO = /^0+$/;
export function changedFiles(base, head = 'HEAD', git = (...a) => execFileSync('git', a, { encoding: 'utf8' })) {
  if (!base || ZERO.test(base)) return null; // a new branch or a missing base: run everything
  try { return git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean); }
  catch { return null; }
}

function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv[0] === 'green') {
    const runs = JSON.parse(execFileSync('gh', ['api', `repos/${opt('--repo')}/actions/workflows/ci.yml/runs?head_sha=${opt('--sha')}&per_page=100`], { encoding: 'utf8' })).workflow_runs ?? [];
    console.log(String(greenAtHead(runs, opt('--self'))));
    return;
  }
  if (argv[0] === 'dispatchable') {
    let yml = '';
    try { yml = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${opt('--repo')}/contents/.github/workflows/ci.yml?ref=${opt('--sha')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { if (!/HTTP 404/.test(String(e.stderr))) { process.stderr.write(String(e.stderr ?? e)); throw e; } } // 404: no ci.yml (or no such commit) at the head
    console.log(String(acceptsPrInput(yml)));
    return;
  }
  if (argv[0] === 'merge-forward') {
    const path = `repos/${opt('--repo')}/issues/${opt('--pr')}/comments`;
    const comments = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `${path}?per_page=100`], { encoding: 'utf8' })).flat();
    if (hasMergeForwardComment(comments)) { console.log(`#${opt('--pr')} already has the merge-forward comment`); return; }
    execFileSync('gh', ['api', '-X', 'POST', path, '-f', `body=${MERGE_FORWARD_COMMENT}`], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`commented on #${opt('--pr')}: merge main forward to enable ci:run`);
    return;
  }
  const event = opt('--event');
  const files = FULL_EVENTS.includes(event) ? null
    : opt('--files') !== undefined ? opt('--files').split(',').filter(Boolean) : changedFiles(opt('--base'), opt('--head'));
  const full = files ? jobsFor(files) : { scope: 'full', steps: REQUIRED_STEPS, include: JOBS.map(({ steps, ...job }) => job), diff: { reason: FULL_EVENTS.includes(event) ? `${event} runs check everything` : 'no usable base' } };
  let labels = [];
  try { const l = JSON.parse(opt('--labels') || '[]'); if (Array.isArray(l)) labels = l; } catch { /* unreadable labels: none */ }
  const win = windowFor({ event, draft: opt('--draft') === 'true', labels });
  const plan = { ...full, ...windowed({ include: full.include, smoke: smokeFor(files) }, win, { greenAtHead: opt('--green-at-head') === 'true' }) };
  const out = { matrix: JSON.stringify({ include: plan.include }), any: String(plan.include.length > 0), scope: plan.scope, smoke: String(plan.smoke), deferred: String(plan.deferred), window: plan.why };
  console.log(JSON.stringify({ ...out, matrix: plan.include.map(j => j.name), selected: full.include.map(j => j.name), diff: plan.diff }, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### CI scope: ${plan.scope}\n\nJobs: ${plan.include.map(j => '`' + j.name + '`').join(', ') || 'none (docs/tools only)'}; local smoke: ${out.smoke}\n` +
    (plan.deferred ? `\n**Full CI deferred** (${plan.why}): ${full.include.length} job(s) selected, none run. Add \`ci:run\` or \`merge:ready\` to a ready PR to run them (docs/testing.md#ci-window).\n` : ''));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
