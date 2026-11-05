#!/usr/bin/env node
// The merge train's decisions, for .github/workflows/merge-train.yml (the label flow is documented there).
//
//   node .github/scripts/merge-train.mjs next  --repo o/r [--maintainer login] [--notify-issue n] [--output file]
//        the oldest `merge:ready` PR that can go now: pr, tier, head_ref, head_sha, base_ref, same_repo, more, and
//        mode=nonstrict|strict (with mode_why) from landingMode(), after waiting up to 15 minutes while the head's
//        required checks are pending and could still land it non-strict; a red main CI is reported once on --notify-issue
//   node .github/scripts/merge-train.mjs wait  --repo o/r --sha <sha> [--checks a,b] [--timeout-min 60] [--output f]
//        polls check runs and commit statuses on <sha> until every required check concluded: result=pass|fail|timeout
//   node .github/scripts/merge-train.mjs merge --repo o/r --pr <n> --sha <sha>
//        squash-merges exactly <sha>
//   node .github/scripts/merge-train.mjs eject --repo o/r --pr <n> [--label needs:rebase] --message-file <file>
//        takes the PR off the train (removes merge:ready), adds the label, comments why
//
// Every GitHub call goes through `gh api` (GH_TOKEN).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, tierFor } from '../../tools/proof/tier.mjs';
import { APPROVED_LABEL, maintainerApproved } from '../../tools/proof/gate.mjs';
import { JOBS } from './ci-scope.mjs';

// The maintainer gate itself is tools/proof/gate.mjs, enforced by the required `proof-ok` check; the train uses the same
// rule only to leave unapproved T3-T4 PRs queued instead of waiting on a check that will fail.
export { APPROVED_LABEL, maintainerApproved };

export const READY = 'merge:ready', REBASE = 'needs:rebase';
export const DEFAULT_CHECKS = ['ci-ok', 'gitleaks', 'path-guard', 'scrub-guard', 'fragment', 'proof-ok'];
const AWAITING = '<!-- merge-train:awaiting-approval -->';
const MAIN_RED = '<!-- merge-train:main-red';
/**
 * Paths that always take the strict path (rebase and re-test), whatever their tier: the engine (the vendored Mars
 * engine, the engine packages and kernel, the world compiler), conformance pins, the lockfile, the walk and bundle
 * baselines, and the workflows. The release gate's scope map (SCOPE_RULES) has no engine-specific rule to derive this
 * from: it maps all of packages/ to the same steps.
 */
export const STRICT_PATHS = [
  [/^(mars\/|packages\/(engine-[^/]+|kernel|world-compiler)\/)/, 'engine-sensitive paths'],
  [/^packages\/conformance\//, 'conformance pins'],
  [/^pnpm-lock\.yaml$/, 'lockfile'],
  [/^tools\/test-harness\/(walk\/baseline\/|bundle-budget\/baseline\.json$)/, 'walk or bundle baseline'],
  [/^\.github\/workflows\//, 'workflows'],
];
const strictPath = files => STRICT_PATHS.find(([re]) => files.some(f => re.test(f)))?.[1];
const rank = t => ['T0', 'T1', 'T2', 'T3', 'T4'].indexOf(t);

/** Why a ready PR cannot go now, or null when it can. */
export function blocker({ pr, tier, approved, defaultBranch }) {
  const labels = (pr.labels ?? []).map(l => l.name ?? l);
  if (pr.state && pr.state !== 'open') return 'closed';
  if (pr.draft) return 'draft';
  if (labels.includes(REBASE)) return 'needs-rebase';
  if (pr.base?.ref && pr.base.ref !== defaultBranch) return 'not-default-branch';
  if (rank(tier) >= 3 && !approved) return 'awaiting-approval';
  return null;
}

/**
 * How a pickable PR lands. `nonstrict`: squash its current head as is, even when behind main. Only for T0-T2, no
 * STRICT_PATHS file, required checks green on the head, GitHub reporting it mergeable without conflict, and main's
 * CI green (mainCiState). Anything else is `strict`: rebase onto main, re-test, merge.
 */
export function landingMode({ tier, files = [], mergeable, mergeableState, headChecks, mainCi }) {
  if (rank(tier) >= 3) return { mode: 'strict', why: `tier ${tier}` };
  const path = strictPath(files);
  if (path) return { mode: 'strict', why: path };
  if (mainCi !== 'success') return { mode: 'strict', why: `main CI ${mainCi ?? 'unknown'}` };
  if (mergeable !== true || mergeableState === 'dirty') return { mode: 'strict', why: `not mergeable (${mergeableState ?? 'unknown'})` };
  if (headChecks !== 'pass') return { mode: 'strict', why: `head checks ${headChecks}` };
  return { mode: 'nonstrict', why: 'T0-T2, green on head, mergeable' };
}

/** How long the pick waits for a head's pending required checks before deciding (then pending counts as strict). */
export const HEAD_WAIT_MS = 15 * 60_000, HEAD_POLL_MS = 20_000;

/**
 * Whether the pick should wait before choosing the mode: the head's required checks are still pending, and green ones
 * would land it non-strict (unknown mergeability counts as possible; GitHub decides it later). Adding merge:ready
 * re-runs label-triggered required checks (proof-ok, fragment) just as the train starts, so deciding at once would
 * make every labelled PR strict, and a behind PR without a token would leave with needs:rebase. Failed checks, or
 * anything else that makes the PR strict, decide at once.
 */
export function awaitHead(state) {
  return state.headChecks === 'pending' && landingMode({ ...state, headChecks: 'pass', mergeable: state.mergeable ?? true }).mode === 'nonstrict';
}

/**
 * Main's CI over its recent ci.yml runs (push and workflow_dispatch on the default branch). Both are full scope
 * (ci-scope.mjs FULL_EVENTS), but older or misconfigured runs may not be, and a narrower green run says nothing
 * about an earlier failure: main is green only
 * when no run failed after the newest green full-scope run (`isFull`: a manual run, or one whose every qualify job
 * succeeded). A failed run re-run green counts as green (a re-run keeps its id). Cancelled and skipped runs say
 * nothing. With no green full-scope run in the window main is `unproven` (strict): an older failure may be hidden.
 * Red returns `since`, the first failed run of the streak, which keys the one notice per red streak.
 */
export function mainCiState(runs = [], isFull = () => false) {
  const done = runs.filter(r => r.status === 'completed' && !['cancelled', 'skipped'].includes(r.conclusion)).sort((a, b) => b.id - a.id);
  const red = [];
  let proven = false;
  for (const r of done) {
    if (r.conclusion !== 'success') red.push(r);
    else if (isFull(r)) { proven = true; break; }
  }
  if (red.length) return { conclusion: red[0].conclusion, since: red.at(-1).id };
  return proven ? { conclusion: 'success', since: null } : { conclusion: 'unproven', since: 'unproven' };
}

/** A run checked everything: started by hand (ci.yml then scopes to full), or every qualify job ran and succeeded. */
export function fullScope(run, jobs) {
  if (run.event === 'workflow_dispatch') return true;
  const ok = new Set(jobs.filter(j => j.conclusion === 'success').map(j => j.name));
  return JOBS.every(j => ok.has(j.name));
}

/** Folds check runs and commit statuses into one verdict over the required names (latest run per name wins). */
export function summarizeChecks({ runs = [], statuses = [], required = DEFAULT_CHECKS }) {
  const latest = new Map();
  for (const r of runs) { const prev = latest.get(r.name); if (!prev || r.id > prev.id) latest.set(r.name, r); }
  const status = new Map();
  for (const s of statuses) if (!status.has(s.context)) status.set(s.context, s); // API returns newest first
  const failed = [], pending = [], missing = [];
  for (const name of required) {
    const r = latest.get(name), s = status.get(name);
    if (r) {
      if (r.status !== 'completed') pending.push(name);
      else if (!['success', 'neutral', 'skipped'].includes(r.conclusion)) failed.push(`${name} (${r.conclusion})`);
    } else if (s) {
      if (s.state === 'pending') pending.push(name);
      else if (s.state !== 'success') failed.push(`${name} (${s.state})`);
    } else missing.push(name);
  }
  const state = failed.length ? 'fail' : pending.length || missing.length ? 'pending' : 'pass';
  return { state, failed, pending, missing };
}

export function parseChecks(text) {
  const list = String(text ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CHECKS;
}

// ── gh ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const ghRaw = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 1 << 26, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
const gh = (...args) => { const out = ghRaw(args); return out.trim() ? JSON.parse(out) : null; };
const ghAll = path => gh(path, '--paginate', '--slurp').flat();

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function comment(repo, pr, body) { ghRaw([`repos/${repo}/issues/${pr}/comments`, '--input', '-'], JSON.stringify({ body })); }

export function next({ repo, maintainer, notifyIssue, api = { gh, ghAll, comment } }) {
  const repoInfo = api.gh(`repos/${repo}`);
  const defaultBranch = repoInfo.default_branch;
  const candidates = api.ghAll(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(READY)}&per_page=100`)
    .filter(i => i.pull_request).map(i => i.number).sort((a, b) => a - b);
  const policy = loadPolicy();
  const skipped = [];
  for (const [i, n] of candidates.entries()) {
    const pr = api.gh(`repos/${repo}/pulls/${n}`);
    const labels = (pr.labels ?? []).map(l => l.name);
    const files = api.ghAll(`repos/${repo}/pulls/${n}/files?per_page=100`).flatMap(f => [f.filename, f.previous_filename]).filter(Boolean);
    const { tier } = tierFor(files, policy, labels);
    let approved = false;
    if (rank(tier) >= 3) {
      approved = maintainerApproved({ reviews: api.ghAll(`repos/${repo}/pulls/${n}/reviews?per_page=100`),
        events: labels.includes(APPROVED_LABEL) ? api.ghAll(`repos/${repo}/issues/${n}/events?per_page=100`) : [], labels, maintainer });
    }
    const why = blocker({ pr, tier, approved, defaultBranch });
    if (why === 'awaiting-approval') {
      const comments = api.ghAll(`repos/${repo}/issues/${n}/comments?per_page=100`);
      if (!comments.some(c => String(c.body).startsWith(AWAITING))) {
        api.comment(repo, n, `${AWAITING}\nMerge train: this PR is ${tier}, so it waits for @${maintainer}'s approving review (or, on a PR they authored, the \`${APPROVED_LABEL}\` label added by them). It stays queued and goes on the next run after approval.`);
      }
    }
    if (why) { skipped.push({ pr: n, tier, why }); continue; }
    const mode = pickMode({ repo, pr, tier, files, defaultBranch, notifyIssue, api });
    return {
      pr: n, tier, head_ref: pr.head.ref, head_sha: pr.head.sha, base_ref: pr.base.ref, title: pr.title,
      same_repo: pr.head.repo?.full_name === repo, more: candidates.length - i - 1 > 0, skipped,
      mode: mode.mode, mode_why: mode.why,
    };
  }
  return { pr: '', more: false, skipped };
}

function pickMode({ repo, pr, tier, files, defaultBranch, notifyIssue, api }) {
  if (rank(tier) >= 3 || strictPath(files)) return landingMode({ tier, files });
  let ci; // unreadable main CI (token scope, API error) counts as not green: strict
  try {
    const runs = (api.gh(`repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(defaultBranch)}&status=completed&per_page=50`)?.workflow_runs ?? [])
      .filter(r => ['push', 'workflow_dispatch'].includes(r.event));
    ci = mainCiState(runs, r => fullScope(r, r.event === 'workflow_dispatch' ? [] : api.ghAll(`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`).flatMap(p => p.jobs ?? p)));
  } catch { ci = { conclusion: 'unreadable', since: 'unreadable' }; }
  const readHead = () => summarizeChecks({
    runs: api.ghAll(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).flatMap(p => p.check_runs ?? p),
    statuses: api.ghAll(`repos/${repo}/commits/${pr.head.sha}/statuses?per_page=100`),
    required: parseChecks(process.env.CHECKS),
  }).state;
  let headChecks = readHead();
  // Pending (not failed) head checks: wait, bounded, before choosing; on timeout pending is strict, as before.
  const now = api.now ?? Date.now, deadline = now() + HEAD_WAIT_MS;
  for (let i = 0; awaitHead({ tier, files, mergeable: pr.mergeable, mergeableState: pr.mergeable_state, mainCi: ci.conclusion, headChecks }) && now() < deadline; i++) {
    if (!i) console.error(`merge-train: #${pr.number} head checks pending, waiting up to ${HEAD_WAIT_MS / 60_000} min before choosing the landing mode`);
    (api.pause ?? pause)(HEAD_POLL_MS);
    headChecks = readHead();
  }
  // GitHub computes `mergeable` lazily (null until then, e.g. right after main moved): ask again briefly, when it decides.
  for (let i = 0; ci.conclusion === 'success' && headChecks === 'pass' && pr.mergeable == null && i < 3; i++) {
    (api.pause ?? pause)(3000);
    pr = api.gh(`repos/${repo}/pulls/${pr.number}`);
  }
  const mode = landingMode({ tier, files, mergeable: pr.mergeable, mergeableState: pr.mergeable_state, mainCi: ci.conclusion, headChecks });
  if (ci.conclusion !== 'success' && notifyIssue) {
    // The notice is best effort: a locked issue or a bad MERGE_TRAIN_NOTIFY_ISSUE must not stall the train.
    const marker = `${MAIN_RED}:${typeof ci.since === 'number' ? ci.since : `${ci.since}-${new Date().toISOString().slice(0, 10)}`} -->`;
    try {
      if (!api.ghAll(`repos/${repo}/issues/${notifyIssue}/comments?per_page=100`).some(c => String(c.body).startsWith(marker))) {
        api.comment(repo, notifyIssue, `${marker}\nMerge train: CI on \`${defaultBranch}\` is ${ci.conclusion}${typeof ci.since === 'number' ? ` since run ${ci.since}` : ''}, so the train stopped non-strict merges: every PR goes through the strict path (rebase and re-test, or \`needs:rebase\` when it cannot be rebased) until a full-scope run on \`${defaultBranch}\` is green, or the failed run is re-run green.`);
      }
    } catch (e) { console.error(`merge-train: could not post the main-CI notice on #${notifyIssue}: ${e.message}`); }
  }
  return mode;
}

export async function wait({ repo, sha, required, timeoutMin = 60, pollSec = 20, api = { ghAll, gh }, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now }) {
  const deadline = now() + timeoutMin * 60_000;
  let s, failedBefore = null;
  for (;;) {
    const runs = api.ghAll(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).flatMap(p => p.check_runs ?? p);
    const statuses = api.ghAll(`repos/${repo}/commits/${sha}/statuses?per_page=100`);
    s = summarizeChecks({ runs, statuses, required });
    if (s.state === 'pass') return { result: 'pass', ...s };
    // A failure counts once it is seen on two polls in a row: an approval re-runs `proof-ok` (proof-check.yml) at the
    // moment it kicks the train, so the first poll can still see the failed run from before the approval.
    if (s.state === 'fail') {
      const key = s.failed.join('|');
      if (failedBefore === key) return { result: 'fail', ...s };
      failedBefore = key;
    } else failedBefore = null;
    if (now() >= deadline) return { result: 'timeout', ...s };
    await sleep(pollSec * 1000);
  }
}

function out(file, obj) {
  const lines = Object.entries(obj).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`);
  if (file) appendFileSync(file, `${lines.join('\n')}\n`);
  console.log(JSON.stringify(obj, null, 2));
}

async function main([mode, ...argv]) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const repo = opt('--repo') ?? process.env.GITHUB_REPOSITORY;
  if (!repo) { console.error('--repo is required'); return 2; }
  if (mode === 'next') {
    out(opt('--output'), next({ repo, maintainer: opt('--maintainer') ?? process.env.MAINTAINER ?? repo.split('/')[0], notifyIssue: opt('--notify-issue') || undefined }));
    return 0;
  }
  if (mode === 'wait') {
    const r = await wait({ repo, sha: opt('--sha'), required: parseChecks(opt('--checks') ?? process.env.CHECKS), timeoutMin: Number(opt('--timeout-min') ?? 60) });
    out(opt('--output'), { result: r.result, failed: r.failed.join(', '), pending: [...r.pending, ...r.missing].join(', ') });
    return 0;
  }
  if (mode === 'merge') {
    const pr = gh(`repos/${repo}/pulls/${opt('--pr')}`);
    gh('-X', 'PUT', `repos/${repo}/pulls/${opt('--pr')}/merge`, '-f', 'merge_method=squash', '-f', `sha=${opt('--sha')}`, '-f', `commit_title=${pr.title} (#${pr.number})`);
    console.log(`merged #${pr.number} at ${opt('--sha')}`);
    return 0;
  }
  if (mode === 'eject') {
    const pr = opt('--pr');
    try { ghRaw(['-X', 'DELETE', `repos/${repo}/issues/${pr}/labels/${encodeURIComponent(READY)}`]); } catch { /* already gone */ }
    if (opt('--label')) ghRaw([`repos/${repo}/issues/${pr}/labels`, '--input', '-'], JSON.stringify({ labels: [opt('--label')] }));
    comment(repo, pr, readFileSync(opt('--message-file'), 'utf8'));
    console.log(`ejected #${pr}${opt('--label') ? ` with ${opt('--label')}` : ''}`);
    return 0;
  }
  console.error('usage: merge-train.mjs next | wait | merge | eject (see the header)');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
