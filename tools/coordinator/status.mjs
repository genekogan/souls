#!/usr/bin/env node
// The coordinator's heartbeat in one call: merges since a time, the merge:ready queue in train order with each head's
// fresh required checks, the Actions queue by workflow, and the PRs labelled needs:rebase.
//
//   node tools/coordinator/status.mjs [--repo o/r] [--since 6h|30m|2d|<ISO time>] [--json]
//
// Read-only: every call is a `gh api` GET (GH_TOKEN or the gh login). The output holds only what the GitHub API says
// about the repository: no tokens, host names or local paths.
// - Merges come from the search API (`is:merged merged:>=<since>`), sorted by merged_at. `gh pr list --state merged
//   --limit N` lists the most recently created merged PRs and misses a late merge of an old PR.
// - Check states are the newest result per required name at the PR head, after dropping stale ones as the merge train
//   does (#910): a check run whose Actions run was cancelled or replaced by a newer run of the same workflow at that
//   head says nothing about the head. A cancelled conclusion is pending, never a failure.
// - Train order is the order `merge-train.mjs next` tries: ascending PR number among merge:ready.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_CHECKS, READY, REBASE, blocker, maintainerApproved, APPROVED_LABEL } from '../../.github/scripts/merge-train.mjs';
import { loadPolicy, tierFor } from '../proof/tier.mjs';

/** `--since`: an ISO time, or a span back from `now` (30m, 6h, 2d). */
export function parseSince(text = '12h', now = Date.now()) {
  const m = /^(\d+(?:\.\d+)?)\s*([mhd])$/.exec(String(text).trim());
  if (m) return new Date(now - Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const t = Date.parse(text);
  if (Number.isNaN(t)) throw Error(`--since: expected an ISO time or 30m/6h/2d, got "${text}"`);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Newest state per required check at one head: 'pass' | 'fail:<conclusion>' | 'pending' | 'missing'.
 * Check runs from cancelled or superseded Actions runs are dropped first (as #910 does in the train); a name that had
 * only stale runs is pending (its replacing run has not reported yet). Commit statuses fill names no check run has.
 */
export function checkStates({ runs = [], statuses = [], workflowRuns = [], required = DEFAULT_CHECKS }) {
  const bySuite = new Map(workflowRuns.filter(w => w.check_suite_id != null).map(w => [w.check_suite_id, w]));
  const newest = new Map();
  for (const w of workflowRuns) { const prev = newest.get(w.workflow_id); if (!prev || w.id > prev.id) newest.set(w.workflow_id, w); }
  const stale = r => { const w = r.check_suite?.id != null && bySuite.get(r.check_suite.id); return !!w && (w.conclusion === 'cancelled' || newest.get(w.workflow_id) !== w); };
  const latest = new Map(), seen = new Set();
  for (const r of runs) { seen.add(r.name); if (stale(r)) continue; const prev = latest.get(r.name); if (!prev || r.id > prev.id) latest.set(r.name, r); }
  const status = new Map();
  for (const s of statuses) if (!status.has(s.context)) status.set(s.context, s); // newest first
  return Object.fromEntries(required.map(name => {
    const r = latest.get(name), s = status.get(name);
    if (r) return [name, r.status !== 'completed' || r.conclusion === 'cancelled' ? 'pending' : ['success', 'neutral', 'skipped'].includes(r.conclusion) ? 'pass' : `fail:${r.conclusion}`];
    if (seen.has(name)) return [name, 'pending'];
    if (s) return [name, s.state === 'pending' ? 'pending' : s.state === 'success' ? 'pass' : `fail:${s.state}`];
    return [name, 'missing'];
  }));
}

/** Queued and in-progress Actions runs, counted by workflow file (`ci`, `security`, ...; a run-name can be per PR). */
export const workflowOf = r => r.path ? r.path.split('/').pop().replace(/\.ya?ml(@.*)?$/, '') : r.name;
export function queueDepth(runs = []) {
  const out = { queued: {}, in_progress: {} };
  for (const r of runs) if (out[r.status]) { const k = workflowOf(r); out[r.status][k] = (out[r.status][k] ?? 0) + 1; }
  const sort = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return { queued: sort(out.queued), in_progress: sort(out.in_progress) };
}

// ── collect ─────────────────────────────────────────────────────────────────────────────────────────────────────
const exec = promisify(execFile);
const ghGet = async path => { const { stdout } = await exec('gh', ['api', '-X', 'GET', path, '--paginate', '--slurp'], { maxBuffer: 1 << 27 }); return JSON.parse(stdout); };
export const githubApi = { get: ghGet };
const pages = (p, key) => p.flatMap(x => (key && x?.[key]) ?? x);

export async function collect({ repo, since, maintainer = repo.split('/')[0], required = DEFAULT_CHECKS, api = githubApi, policy = loadPolicy() }) {
  const q = encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${since}`);
  const [repoInfo, mergedPages, readyPages, rebasePages, queued, running] = await Promise.all([
    api.get(`repos/${repo}`).then(p => p[0] ?? p),
    api.get(`search/issues?q=${q}&per_page=100`),
    api.get(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(READY)}&per_page=100`),
    api.get(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(REBASE)}&per_page=100`),
    api.get(`repos/${repo}/actions/runs?status=queued&per_page=100`),
    api.get(`repos/${repo}/actions/runs?status=in_progress&per_page=100`),
  ]);
  const merged = pages(mergedPages, 'items').map(i => ({ number: i.number, merged_at: i.pull_request?.merged_at, title: i.title }))
    .sort((a, b) => String(a.merged_at).localeCompare(String(b.merged_at)));
  const ready = await Promise.all(pages(readyPages).filter(i => i.pull_request).sort((a, b) => a.number - b.number).map(async i => {
    const n = i.number;
    const [pr, files] = await Promise.all([api.get(`repos/${repo}/pulls/${n}`).then(p => p[0] ?? p), api.get(`repos/${repo}/pulls/${n}/files?per_page=100`)]);
    const labels = (pr.labels ?? []).map(l => l.name);
    const { tier } = tierFor(pages(files).flatMap(f => [f.filename, f.previous_filename]).filter(Boolean), policy, labels);
    const sha = pr.head.sha;
    const [runs, statuses, workflowRuns, reviews, events] = await Promise.all([
      api.get(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).then(p => pages(p, 'check_runs')),
      api.get(`repos/${repo}/commits/${sha}/statuses?per_page=100`).then(p => pages(p)),
      api.get(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`).then(p => pages(p, 'workflow_runs')),
      ['T3', 'T4'].includes(tier) ? api.get(`repos/${repo}/pulls/${n}/reviews?per_page=100`).then(p => pages(p)) : [],
      ['T3', 'T4'].includes(tier) && labels.includes(APPROVED_LABEL) ? api.get(`repos/${repo}/issues/${n}/events?per_page=100`).then(p => pages(p)) : [],
    ]);
    const approved = ['T3', 'T4'].includes(tier) ? maintainerApproved({ reviews, events, labels, maintainer }) : false;
    return { number: n, title: pr.title, tier, head: sha.slice(0, 8), waits: blocker({ pr, tier, approved, defaultBranch: repoInfo.default_branch }), checks: checkStates({ runs, statuses, workflowRuns, required }) };
  }));
  const needsRebase = pages(rebasePages).filter(i => i.pull_request).map(i => ({ number: i.number, title: i.title })).sort((a, b) => a.number - b.number);
  return { repo, since, merged, ready, needsRebase, actions: queueDepth([...pages(queued, 'workflow_runs'), ...pages(running, 'workflow_runs')]) };
}

// ── format ──────────────────────────────────────────────────────────────────────────────────────────────────────
const cut = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hm = iso => String(iso).slice(5, 16).replace('T', ' ');
const counts = o => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ');

export function format(s, now = new Date().toISOString()) {
  const lines = [`status ${s.repo} at ${now.slice(0, 16)}Z`];
  lines.push(`merged since ${s.since} (${s.merged.length}):`);
  for (const m of s.merged) lines.push(`  #${m.number} ${hm(m.merged_at)}Z ${cut(m.title)}`);
  lines.push(`train, merge:ready in order (${s.ready.length}):`);
  s.ready.forEach((p, i) => {
    const bad = Object.entries(p.checks).filter(([, v]) => v !== 'pass');
    const checks = bad.length ? bad.map(([k, v]) => `${k}=${v}`).join(' ') : 'all required green';
    lines.push(`  ${i + 1}. #${p.number} ${p.tier} ${p.waits ? `waits:${p.waits}` : 'can go'} @${p.head} | ${checks} | ${cut(p.title, 50)}`);
  });
  lines.push(`needs:rebase (${s.needsRebase.length}):${s.needsRebase.length ? '' : ' none'}`);
  for (const p of s.needsRebase) lines.push(`  #${p.number} ${cut(p.title)}`);
  const q = Object.values(s.actions.queued).reduce((a, b) => a + b, 0), r = Object.values(s.actions.in_progress).reduce((a, b) => a + b, 0);
  lines.push(`actions: queued ${q}${q ? ` (${counts(s.actions.queued)})` : ''}; running ${r}${r ? ` (${counts(s.actions.in_progress)})` : ''}`);
  return lines.join('\n');
}

async function repoFromGit() {
  const { stdout } = await exec('git', ['remote', 'get-url', 'origin']);
  const m = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?\s*$/.exec(stdout);
  if (!m) throw Error('no GitHub origin remote; pass --repo owner/name');
  return m[1];
}

async function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const repo = opt('--repo') ?? process.env.GITHUB_REPOSITORY ?? await repoFromGit();
  const required = process.env.MERGE_TRAIN_CHECKS ? process.env.MERGE_TRAIN_CHECKS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_CHECKS;
  const s = await collect({ repo, since: parseSince(opt('--since')), maintainer: opt('--maintainer') ?? process.env.MAINTAINER, required });
  console.log(argv.includes('--json') ? JSON.stringify(s, null, 2) : format(s));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
