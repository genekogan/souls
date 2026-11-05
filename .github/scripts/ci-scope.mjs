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
  // #898: the generated reference pages (docs/site actions, api, mcp) against the server's code. Server and package
  // changes can change them; so can the generator and the pages themselves, which the gate's scope map leaves free
  // (docs and tools never gate on Modal), so `paths` adds the job for those in CI only.
  { name: 'docs-reference', kind: 'docs-reference', assets: false, steps: ['V5-server-full', 'V3-walk'], paths: /^(?:tools\/docs\/|docs\/site\/(?:actions|api|mcp)\.md$)/ },
  ...Array.from({ length: SERVER_SHARDS }, (_, shard) => ({ name: `server-${shard}`, kind: 'server', shard, assets: true, steps: ['V5-server-full', 'V6-'] })),
];

const relevant = (job, steps) => job.steps.some(s => steps.some(step => s.endsWith('-') ? step.startsWith(s) : step === s));

export function jobsFor(files) {
  const scope = scopeFor(files);
  const include = scope.resolved === 'full' ? JOBS : JOBS.filter(job => relevant(job, scope.steps) || (job.paths && files.some(f => job.paths.test(f))));
  return { scope: scope.resolved, steps: scope.steps, include: include.map(({ steps, paths, ...job }) => job), diff: scope.diff };
}

/** The local smoke job: changes under apps/web, apps/server or e2e; null (no usable base) runs it too. */
export const SMOKE_PATHS = /^(apps\/web|apps\/server|e2e)\//;
export const smokeFor = files => files === null || files.some(f => SMOKE_PATHS.test(f));

/** Events whose runs check everything regardless of the changed paths. */
export const FULL_EVENTS = ['push', 'workflow_dispatch'];

const ZERO = /^0+$/;
export function changedFiles(base, head = 'HEAD', git = (...a) => execFileSync('git', a, { encoding: 'utf8' })) {
  if (!base || ZERO.test(base)) return null; // a new branch or a missing base: run everything
  try { return git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean); }
  catch { return null; }
}

function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const files = FULL_EVENTS.includes(opt('--event')) ? null
    : opt('--files') !== undefined ? opt('--files').split(',').filter(Boolean) : changedFiles(opt('--base'), opt('--head'));
  const plan = files ? jobsFor(files) : { scope: 'full', steps: REQUIRED_STEPS, include: JOBS.map(({ steps, paths, ...job }) => job), diff: { reason: FULL_EVENTS.includes(opt('--event')) ? `${opt('--event')} runs check everything` : 'no usable base' } };
  const out = { matrix: JSON.stringify({ include: plan.include }), any: String(plan.include.length > 0), scope: plan.scope, smoke: String(smokeFor(files)) };
  console.log(JSON.stringify({ ...out, matrix: plan.include.map(j => j.name), diff: plan.diff }, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### CI scope: ${plan.scope}\n\nJobs: ${plan.include.map(j => '`' + j.name + '`').join(', ') || 'none (docs/tools only)'}; local smoke: ${out.smoke}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
