import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ancestry, candidates, childAction, conflictComment, forkComment, forward, forwardComment, gitIn, parseUnmerged, run, REBASE } from './restack.mjs';

const repo = { full_name: 'o/r' }, fork = { full_name: 'someone/r' };
const merged = { number: 1, merged_at: '2026-11-05T00:00:00Z', head: { ref: 'agent/1-base', sha: 'b'.repeat(40) }, base: { ref: 'main' } };
const pr = (number, base, o = {}) => ({ number, state: 'open', base: { ref: base, repo }, head: { ref: `agent/${number}-x`, sha: String(number).repeat(40).slice(0, 40), repo }, ...o });

test('candidates: open PRs on the merged head branch or on its base, never the merged PR itself', () => {
  const open = [pr(2, 'agent/1-base'), pr(3, 'main'), pr(4, 'agent/9-other'), pr(5, 'release'), { ...pr(6, 'agent/1-base'), state: 'closed' }, pr(1, 'main')];
  assert.deepEqual(candidates({ merged, open }).map(p => p.number), [2, 3]);
});

test('childAction: on the merged branch always a child; on the base only when it shares merged-branch commits', () => {
  const f = { sharesCommits: false, containsTarget: false };
  assert.deepEqual(childAction({ pr: pr(2, 'agent/1-base'), merged, ...f }), { action: 'forward', retarget: true, why: 'stacked on #1' });
  assert.deepEqual(childAction({ pr: pr(3, 'main'), merged, ...f }), { action: 'skip', retarget: false, why: 'not stacked on #1' });
  assert.deepEqual(childAction({ pr: pr(3, 'main'), merged, ...f, sharesCommits: true }), { action: 'forward', retarget: false, why: 'stacked on #1' }, 'GitHub already retargeted it');
  assert.equal(childAction({ pr: pr(2, 'agent/1-base'), merged, ...f, containsTarget: true }).action, 'retarget', 'already current: retarget only');
  assert.equal(childAction({ pr: pr(3, 'main'), merged, sharesCommits: true, containsTarget: true }).action, 'skip');
  const forked = pr(7, 'agent/1-base', { head: { ref: 'x', sha: 'f'.repeat(40), repo: fork } });
  assert.deepEqual(childAction({ pr: forked, merged, ...f }).action, 'fork');
  assert.equal(childAction({ pr: forked, merged, ...f }).retarget, true);
});

test('parseUnmerged: one path per conflicted file, stages folded, tabs in names kept', () => {
  const text = '100644 aaa 1\tsrc/a.ts\n100644 bbb 2\tsrc/a.ts\n100644 ccc 3\tsrc/a.ts\n100644 ddd 2\tdocs/b c.md\n';
  assert.deepEqual(parseUnmerged(text), ['src/a.ts', 'docs/b c.md']);
  assert.deepEqual(parseUnmerged(''), []);
});

test('comments name the merged PR, the target, the fork point and (on conflict) the files', () => {
  const ctx = { merged, target: 'main', fork: 'c0ffee1234567', retargeted: true };
  const ok = forwardComment({ ...ctx, before: 'a'.repeat(40), after: 'd'.repeat(40) });
  assert.match(ok, /#1 squash-merged into `main`\. This PR now targets `main`\./);
  assert.match(ok, /fork point from the old base \(`c0ffee1`\)/);
  assert.match(ok, /`aaaaaaa` → `ddddddd` \(fast-forward push, no force\)/);
  const bad = conflictComment({ ...ctx, files: ['a.ts', 'b.md'] });
  assert.match(bad, /labelled `needs:rebase`/);
  assert.match(bad, /- `a\.ts`\n- `b\.md`/);
  assert.match(forkComment({ ...ctx, retargeted: false }), /lives in a fork/);
  assert.doesNotMatch(forkComment({ ...ctx, retargeted: false }), /now targets/);
});

// ── a real stack in a temp repository ────────────────────────────────────────────────────────────────────────
// main ─ m1 ──────────── m2 (other.txt) ─ S (squash of base)
//         └ base: b1 (base.txt v1, shared.txt) ─ b2 (base.txt v2)
//                  ├ child: c1 (child.txt)              stacked on b1, behind b2
//                  └ clash: x1 (base.txt edited)        conflicts with b2 for real
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'restack-test-'));
  const origin = join(root, 'origin.git'), work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  const git = gitIn(work);
  git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid'); git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', origin);
  const write = (file, text) => writeFileSync(join(work, file), text);
  const commit = (msg, files) => { for (const [f, t] of Object.entries(files)) write(f, t); git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  commit('m1', { 'a.txt': 'a\n', 'shared.txt': 'one\ntwo\nthree\n' });
  git('checkout', '-q', '-b', 'agent/1-base');
  const b1 = commit('b1', { 'base.txt': 'base v1\n', 'shared.txt': 'one (base)\ntwo\nthree\n' });
  git('checkout', '-q', '-b', 'agent/2-child');
  const c1 = commit('c1', { 'child.txt': 'child\n' });
  git('checkout', '-q', '-b', 'agent/3-clash', b1);
  const x1 = commit('x1', { 'base.txt': 'base edited by the clash child\n' });
  git('checkout', '-q', '-b', 'agent/4-other', 'main');
  const o1 = commit('o1', { 'unrelated.txt': 'u\n' });
  git('checkout', '-q', 'agent/1-base');
  const b2 = commit('b2', { 'base.txt': 'base v2\n' });
  git('checkout', '-q', 'main');
  commit('m2', { 'other.txt': 'other\n' });
  git('merge', '-q', '--squash', 'agent/1-base');
  const squash = commit('base (#1)', {});
  git('push', '-q', 'origin', 'main', 'agent/2-child', 'agent/3-clash', 'agent/4-other',
    `${b2}:refs/pull/1/head`, `${c1}:refs/pull/2/head`, `${x1}:refs/pull/3/head`, `${o1}:refs/pull/4/head`, `${c1}:refs/pull/5/head`, `${c1}:refs/pull/6/head`);
  return { root, origin, work, git, b1, b2, c1, x1, o1, squash, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('forward: a plain merge of the squashed main conflicts; the 3-way merge against the fork point is clean', () => {
  const fx = fixture();
  try {
    const { git, c1, b2, squash } = fx;
    const facts = ancestry(git, { child: c1, mergedHead: b2, target: squash });
    assert.deepEqual(facts, { fork: fx.b1, sharesCommits: true, containsTarget: false });
    // The problem: git's own merge diffs from m1 and fights the squashed base.txt it never changed.
    git('checkout', '-q', '--detach', c1);
    assert.throws(() => git('merge', '-q', '--no-edit', squash));
    assert.ok(parseUnmerged(git('ls-files', '-u')).includes('base.txt'));
    git('merge', '--abort'); git('checkout', '-q', 'main');
    const f = forward(git, { child: c1, target: squash, fork: facts.fork, message: 'restack' });
    assert.equal(f.status, 'clean');
    assert.deepEqual(git('rev-list', '--parents', '-n', '1', f.commit).split(' ').slice(1), [c1, squash], 'a two-parent merge: child head, then target');
    assert.equal(git('diff', '--name-only', squash, f.commit), 'child.txt', 'the diff against main is the child\'s own change only');
    assert.equal(git('show', `${f.commit}:base.txt`), 'base v2', 'a file the child never touched takes the squashed content');
    assert.equal(git('show', `${f.commit}:other.txt`), 'other');
    assert.equal(git('worktree', 'list').split('\n').length, 1, 'the scratch worktree is removed');
  } finally { fx.cleanup(); }
});

test('forward: a real overlap with the squashed base is reported as a conflict, file by file', () => {
  const fx = fixture();
  try {
    const { git, x1, b2, squash } = fx;
    const facts = ancestry(git, { child: x1, mergedHead: b2, target: squash });
    assert.deepEqual(forward(git, { child: x1, target: squash, fork: facts.fork, message: 'restack' }), { status: 'conflict', files: ['base.txt'] });
    assert.equal(git('status', '--porcelain'), '', 'the caller\'s checkout is untouched');
  } finally { fx.cleanup(); }
});

test('run: retargets, merges forward with a fast-forward push, labels conflicts and forks, leaves the rest alone', () => {
  const fx = fixture();
  try {
    const { git, origin, c1, x1, o1, squash } = fx;
    const remote = gitIn(origin);
    const calls = [];
    const mergedPr = { ...merged, head: { ref: 'agent/1-base', sha: fx.b2 } };
    const head = (number, ref, sha, o = {}) => ({ number, state: 'open', base: { ref: 'agent/1-base', repo }, head: { ref, sha, repo }, ...o });
    const open = [
      head(2, 'agent/2-child', c1),                                                   // still on the deleted branch
      { ...head(3, 'agent/3-clash', x1), base: { ref: 'main', repo } },               // GitHub already retargeted it
      { ...head(4, 'agent/4-other', o1), base: { ref: 'main', repo } },               // unrelated
      head(5, 'fork-branch', c1, { head: { ref: 'fork-branch', sha: c1, repo: fork } }),
      head(6, 'agent/6-moved', 'e'.repeat(40)),                                       // moved since the event
    ];
    const api = {
      pr: n => { assert.equal(n, 1); return mergedPr; },
      open: () => open,
      retarget: (n, base) => calls.push(['retarget', n, base]),
      label: (n, name) => calls.push(['label', n, name]),
      comment: (n, body) => calls.push(['comment', n, body.split('\n')[0]]),
    };
    const results = run({ prNumber: 1, api, git, log: () => {} });
    assert.deepEqual(results.map(r => r.pr), [2, 3, 5, 6]);
    assert.match(results[0].result, /^merged main forward/);
    assert.match(results[1].result, /^conflict in base\.txt/);
    assert.match(results[3].result, /head moved/);
    assert.deepEqual(calls.filter(c => c[0] !== 'comment'), [['retarget', 2, 'main'], ['label', 3, REBASE], ['retarget', 5, 'main'], ['label', 5, REBASE]]);
    assert.deepEqual(calls.filter(c => c[0] === 'comment').map(c => c[1]), [2, 3, 5]);
    const pushed = remote('rev-parse', 'refs/heads/agent/2-child');
    assert.equal(remote('rev-parse', `${pushed}^1`), c1, 'a fast-forward of the old head');
    assert.equal(remote('rev-parse', `${pushed}^2`), squash);
    assert.equal(remote('diff', '--name-only', squash, pushed), 'child.txt');
    assert.equal(remote('rev-parse', 'refs/heads/agent/3-clash'), x1, 'a conflict pushes nothing');
    assert.equal(remote('rev-parse', 'refs/heads/agent/4-other'), o1);
    // Run again: the child now contains main, so there is nothing left to do (GitHub moves refs/pull/2/head itself).
    remote('update-ref', 'refs/pull/2/head', pushed);
    open[0] = { ...open[0], base: { ref: 'main', repo }, head: { ...open[0].head, sha: pushed } };
    calls.length = 0;
    const again = run({ prNumber: 1, api: { ...api, open: () => open.slice(0, 1) }, git, log: () => {} });
    assert.deepEqual(again, [{ pr: 2, result: 'skip: already contains main' }]);
    assert.deepEqual(calls, []);
  } finally { fx.cleanup(); }
});

test('run: an open (unmerged) PR does nothing unless it is a dry run', () => {
  const api = { pr: () => ({ ...merged, merged_at: null }), open: () => assert.fail('not reached') };
  assert.deepEqual(run({ prNumber: 1, api, git: () => assert.fail('no git') }), [{ pr: 1, result: 'not merged; nothing to do' }]);
});

test('the workflow runs main\'s copy on merged PRs only, serialized, and never forces a push', () => {
  const yml = readFileSync(new URL('../workflows/restack.yml', import.meta.url), 'utf8');
  assert.match(yml, /pull_request_target:\n\s+types: \[closed\]/);
  assert.match(yml, /github\.event\.pull_request\.merged == true/);
  assert.match(yml, /group: restack\n\s+cancel-in-progress: false/);
  assert.match(yml, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  const src = readFileSync(new URL('./restack.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(yml, /git push|--force/);
  assert.deepEqual(src.match(/'push'.*$/gm), ["'push', '-q', 'origin', `${f.commit}:refs/heads/${pr.head.ref}`)) { say(`push refused (branch moved?); skipped`); continue; }"], 'one push, a plain refspec: no --force, no leading +');
});
