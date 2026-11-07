#!/usr/bin/env node
// Restacks the PRs that were stacked on a PR that just squash-merged (.github/workflows/restack.yml).
//
//   node .github/scripts/restack.mjs run --repo o/r --pr <merged n> [--dry-run]
//        finds the stacked children of merged PR <n>, retargets each to <n>'s base and merges that base forward
//   node .github/scripts/restack.mjs forward --child <rev> --merged-head <rev> --target <rev>
//        the merge-forward alone, local and read-only: prints the result commit or the conflicting files
//
// Why: a squash merge leaves the base's commits only on the old branch. A child cut from that branch still carries
// them, so a plain `git merge main` diffs from the old main fork point and fights the squashed copies of files the child
// never touched. The merge-forward here is a 3-way merge whose base is the child's fork point from the merged branch
// (merge-base(child, merged head)): files the child's own diff leaves alone take the target's (squashed) content, and
// only real overlaps conflict. The result is an ordinary two-parent merge commit (child head, target), pushed as a
// fast-forward: never forced. A real conflict pushes nothing; the child gets needs:rebase and a comment.
//
// Children are open same-repo PRs whose base is the merged head branch, or whose base is already the merged PR's base
// (GitHub retargets them itself when it deletes the merged branch) and that share commits with the merged head that
// the target lacks. Every GitHub call goes through `gh api` (GH_TOKEN); pushes go through `origin`.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REBASE = 'needs:rebase';
const short = sha => String(sha).slice(0, 7);

/** Open PRs that could be stacked on `merged`: based on its head branch, or on its base (already retargeted). */
export function candidates({ merged, open }) {
  return open.filter(pr => pr.number !== merged.number && pr.state === 'open' &&
    (pr.base.ref === merged.head.ref || pr.base.ref === merged.base.ref));
}

/**
 * What to do with one candidate. `sharesCommits`: merge-base(child, merged head) is not in the target, so the child
 * carries commits of the merged branch. `containsTarget`: the target is already an ancestor of the child head.
 * Returns { action: 'skip' | 'fork' | 'forward' | 'retarget', retarget, why }.
 */
export function childAction({ pr, merged, sharesCommits, containsTarget }) {
  const onMergedBranch = pr.base.ref === merged.head.ref;
  if (!onMergedBranch && !sharesCommits) return { action: 'skip', retarget: false, why: `not stacked on #${merged.number}` };
  const retarget = onMergedBranch;
  if (pr.head.repo?.full_name !== pr.base.repo?.full_name) return { action: 'fork', retarget, why: 'head is in a fork; the workflow cannot push there' };
  if (containsTarget) return { action: retarget ? 'retarget' : 'skip', retarget, why: `already contains ${merged.base.ref}` };
  return { action: 'forward', retarget, why: `stacked on #${merged.number}` };
}

/** Unique paths from `git ls-files -u` output (`<mode> <sha> <stage>\t<path>`), in order. */
export function parseUnmerged(text) {
  return [...new Set(text.split('\n').filter(Boolean).map(line => line.slice(line.indexOf('\t') + 1)))];
}

export function forwardComment({ merged, target, fork, before, after, retargeted }) {
  return [
    `Restack: #${merged.number} squash-merged into \`${target}\`.${retargeted ? ` This PR now targets \`${target}\`.` : ''}`,
    `\`${target}\` was merged forward with a 3-way merge against this branch's fork point from the old base (\`${short(fork)}\`), so files this PR does not change take the squashed content and the diff is this PR's own changes again.`,
    `Head \`${short(before)}\` → \`${short(after)}\` (fast-forward push, no force).`,
  ].join('\n\n');
}

export function conflictComment({ merged, target, fork, files, retargeted }) {
  return [
    `Restack: #${merged.number} squash-merged into \`${target}\`.${retargeted ? ` This PR now targets \`${target}\`.` : ''} Merging \`${target}\` forward (3-way against this branch's fork point from the old base, \`${short(fork)}\`) conflicts, so nothing was pushed and the PR is labelled \`${REBASE}\`.`,
    `Conflicting files:\n${files.map(f => `- \`${f}\``).join('\n')}`,
    `Merge \`${target}\` into this branch by hand (resolve only these files; for every other file keep \`${target}\`'s version), push without force, then remove \`${REBASE}\`.`,
  ].join('\n\n');
}

export function forkComment({ merged, target, retargeted }) {
  return `Restack: #${merged.number} squash-merged into \`${target}\`.${retargeted ? ` This PR now targets \`${target}\`.` : ''} This branch lives in a fork, so it was not merged forward automatically: merge \`${target}\` into it, push, then remove \`${REBASE}\`.`;
}

// ── git ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const gitIn = cwd => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ok = (git, ...args) => { try { git(...args); return true; } catch { return false; } };

/** Ancestry facts for one candidate head, in the repository `git` runs in. */
export function ancestry(git, { child, mergedHead, target }) {
  const fork = git('merge-base', child, mergedHead);
  return { fork, sharesCommits: !ok(git, 'merge-base', '--is-ancestor', fork, target), containsTarget: ok(git, 'merge-base', '--is-ancestor', target, child) };
}

/**
 * Merges `target` into `child` with merge base `fork`, in a scratch worktree (the caller's checkout is untouched).
 * Returns { status: 'clean', commit } or { status: 'conflict', files }. Nothing is pushed.
 */
export function forward(git, { child, target, fork, message }) {
  const dir = mkdtempSync(join(tmpdir(), 'restack-'));
  try {
    git('worktree', 'add', '-q', '--detach', dir, child);
    const wt = gitIn(dir);
    const r = spawnSync('git', ['merge-recursive', fork, '--', 'HEAD', target], { cwd: dir, encoding: 'utf8' });
    if (r.status === 0) {
      const tree = wt('write-tree');
      return { status: 'clean', commit: wt('commit-tree', tree, '-p', git('rev-parse', child), '-p', git('rev-parse', target), '-m', message) };
    }
    const files = parseUnmerged(wt('ls-files', '-u'));
    if (r.status === 1 && files.length) return { status: 'conflict', files };
    throw Error(`git merge-recursive failed (${r.status}): ${(r.stderr || r.stdout).trim()}`);
  } finally {
    try { git('worktree', 'remove', '--force', dir); } catch { rmSync(dir, { recursive: true, force: true }); }
  }
}

// ── gh ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const ghRaw = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 1 << 26, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
const gh = (...args) => { const out = ghRaw(args); return out.trim() ? JSON.parse(out) : null; };
const ghAll = path => gh(path, '--paginate', '--slurp').flat();
export const githubApi = repo => ({
  pr: n => gh(`repos/${repo}/pulls/${n}`),
  open: () => ghAll(`repos/${repo}/pulls?state=open&per_page=100`),
  retarget: (n, base) => ghRaw(['-X', 'PATCH', `repos/${repo}/pulls/${n}`, '-f', `base=${base}`]),
  label: (n, name) => ghRaw([`repos/${repo}/issues/${n}/labels`, '--input', '-'], JSON.stringify({ labels: [name] })),
  comment: (n, body) => ghRaw([`repos/${repo}/issues/${n}/comments`, '--input', '-'], JSON.stringify({ body })),
});

/** The whole restack for one merged PR. Returns one result line per candidate that was a child. */
export function run({ prNumber, dryRun = false, api, git, log = console.log }) {
  const merged = api.pr(prNumber);
  if (!merged.merged_at && !dryRun) return [{ pr: prNumber, result: 'not merged; nothing to do' }];
  const target = merged.base.ref;
  const list = candidates({ merged, open: api.open() });
  if (!list.length) return [];
  git('fetch', '-q', '--no-tags', 'origin', `+refs/heads/${target}:refs/remotes/origin/${target}`, `+refs/pull/${merged.number}/head:refs/restack/merged`,
    ...list.map(pr => `+refs/pull/${pr.number}/head:refs/restack/${pr.number}`));
  const targetSha = git('rev-parse', `refs/remotes/origin/${target}`), mergedHead = git('rev-parse', 'refs/restack/merged');
  const results = [];
  for (const pr of list) {
    const child = git('rev-parse', `refs/restack/${pr.number}`);
    if (child !== pr.head.sha) { results.push({ pr: pr.number, result: `head moved (${short(pr.head.sha)} → ${short(child)}); skipped` }); continue; }
    const facts = ancestry(git, { child, mergedHead, target: targetSha });
    const plan = childAction({ pr, merged, ...facts });
    if (plan.action === 'skip') { if (pr.base.ref === target && !facts.sharesCommits) continue; results.push({ pr: pr.number, result: `skip: ${plan.why}` }); continue; }
    const say = result => { results.push({ pr: pr.number, result }); log(`#${pr.number}: ${result}`); };
    if (dryRun) {
      const f = plan.action === 'forward' ? forward(git, { child, target: targetSha, fork: facts.fork, message: 'dry run' }) : null;
      say(`would ${plan.retarget ? `retarget to ${target} and ` : ''}${plan.action}${f ? ` → ${f.status}${f.files ? `: ${f.files.join(', ')}` : ''}` : ''} (fork ${short(facts.fork)})`);
      continue;
    }
    if (plan.retarget) api.retarget(pr.number, target);
    const ctx = { merged, target, fork: facts.fork, retargeted: plan.retarget };
    if (plan.action === 'retarget') { say(`retargeted to ${target}; ${plan.why}`); continue; }
    if (plan.action === 'fork') { api.label(pr.number, REBASE); api.comment(pr.number, forkComment(ctx)); say(`fork: labelled ${REBASE}`); continue; }
    const f = forward(git, { child, target: targetSha, fork: facts.fork,
      message: `Merge ${target} into ${pr.head.ref} after #${merged.number} squash-merged\n\n3-way merge against the fork point from the old base (${facts.fork}), by .github/scripts/restack.mjs.` });
    if (f.status === 'conflict') { api.label(pr.number, REBASE); api.comment(pr.number, conflictComment({ ...ctx, files: f.files })); say(`conflict in ${f.files.join(', ')}: labelled ${REBASE}`); continue; }
    // A fast-forward push: refused (not forced) if the branch moved since the fetch.
    if (!ok(git, 'push', '-q', 'origin', `${f.commit}:refs/heads/${pr.head.ref}`)) { say(`push refused (branch moved?); skipped`); continue; }
    api.comment(pr.number, forwardComment({ ...ctx, before: child, after: f.commit }));
    say(`merged ${target} forward: ${short(child)} → ${short(f.commit)}`);
  }
  return results;
}

function main([mode, ...argv]) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const git = gitIn(process.cwd());
  if (mode === 'forward') {
    const [child, target] = [git('rev-parse', opt('--child')), git('rev-parse', opt('--target'))];
    const fork = git('merge-base', child, opt('--merged-head'));
    console.log(JSON.stringify({ fork, ...forward(git, { child, target, fork, message: 'restack forward (local)' }) }, null, 2));
    return 0;
  }
  if (mode === 'run') {
    const repo = opt('--repo') ?? process.env.GITHUB_REPOSITORY;
    if (!repo || !opt('--pr')) { console.error('--repo and --pr are required'); return 2; }
    const results = run({ prNumber: Number(opt('--pr')), dryRun: argv.includes('--dry-run'), api: githubApi(repo), git });
    console.log(JSON.stringify(results, null, 2));
    return 0;
  }
  console.error('usage: restack.mjs run --repo o/r --pr <n> [--dry-run] | forward --child <rev> --merged-head <rev> --target <rev>');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
