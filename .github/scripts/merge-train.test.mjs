import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMainRun, blocker, dispatchMainCi, fullScope, landingMode, mainCiState, maintainerApproved, next, parseChecks, summarizeChecks, wait, DEFAULT_CHECKS } from './merge-train.mjs';
import { JOBS } from './ci-scope.mjs';

const M = 'owner';

test('maintainer approval: latest decisive review, or the label added by the maintainer', () => {
  const r = (login, state) => ({ user: { login }, state });
  assert.equal(maintainerApproved({ reviews: [r(M, 'APPROVED')], maintainer: M }), true);
  assert.equal(maintainerApproved({ reviews: [r(M, 'APPROVED'), r(M, 'COMMENTED')], maintainer: M }), true);
  assert.equal(maintainerApproved({ reviews: [r(M, 'APPROVED'), r(M, 'CHANGES_REQUESTED')], maintainer: M }), false);
  assert.equal(maintainerApproved({ reviews: [r('someone', 'APPROVED')], maintainer: M }), false);
  const ev = actor => [{ event: 'labeled', label: { name: 'approved:maintainer' }, actor: { login: actor } }];
  assert.equal(maintainerApproved({ labels: ['approved:maintainer'], events: ev(M), maintainer: M }), true);
  assert.equal(maintainerApproved({ labels: ['approved:maintainer'], events: ev('someone'), maintainer: M }), false);
  assert.equal(maintainerApproved({ labels: [], events: ev(M), maintainer: M }), false);
});

test('blocker: T0-T2 go on green, T3-T4 wait for approval; drafts, needs:rebase and other bases wait', () => {
  const pr = (o = {}) => ({ state: 'open', draft: false, labels: [{ name: 'merge:ready' }], base: { ref: 'main' }, ...o });
  for (const t of ['T0', 'T1', 'T2']) assert.equal(blocker({ pr: pr(), tier: t, approved: false, defaultBranch: 'main' }), null);
  for (const t of ['T3', 'T4']) {
    assert.equal(blocker({ pr: pr(), tier: t, approved: false, defaultBranch: 'main' }), 'awaiting-approval');
    assert.equal(blocker({ pr: pr(), tier: t, approved: true, defaultBranch: 'main' }), null);
  }
  assert.equal(blocker({ pr: pr({ draft: true }), tier: 'T0', defaultBranch: 'main' }), 'draft');
  assert.equal(blocker({ pr: pr({ labels: [{ name: 'needs:rebase' }] }), tier: 'T0', defaultBranch: 'main' }), 'needs-rebase');
  assert.equal(blocker({ pr: pr({ base: { ref: 'release' } }), tier: 'T0', defaultBranch: 'main' }), 'not-default-branch');
});

test('summarizeChecks: latest run per name, statuses as fallback, missing counts as pending', () => {
  const run = (id, name, status, conclusion = null) => ({ id, name, status, conclusion });
  const required = ['ci-ok', 'proof-ok', 'legacy'];
  assert.equal(summarizeChecks({ runs: [run(1, 'ci-ok', 'completed', 'success')], required }).state, 'pending');
  const all = summarizeChecks({ runs: [run(1, 'ci-ok', 'completed', 'success'), run(2, 'proof-ok', 'completed', 'failure'), run(3, 'proof-ok', 'completed', 'success')], statuses: [{ context: 'legacy', state: 'success' }], required });
  assert.equal(all.state, 'pass');
  const fail = summarizeChecks({ runs: [run(1, 'ci-ok', 'completed', 'cancelled'), run(2, 'proof-ok', 'in_progress')], statuses: [{ context: 'legacy', state: 'success' }], required });
  assert.equal(fail.state, 'fail');
  assert.deepEqual(fail.failed, ['ci-ok (cancelled)']);
  assert.deepEqual(parseChecks(''), DEFAULT_CHECKS);
  assert.deepEqual(parseChecks('a, b c'), ['a', 'b', 'c']);
});

test('wait polls until the checks conclude, and times out', async () => {
  let calls = 0;
  const api = { ghAll: path => {
    if (path.includes('/statuses')) return [];
    calls++;
    return [{ check_runs: [{ id: 1, name: 'ci-ok', status: calls < 3 ? 'in_progress' : 'completed', conclusion: calls < 3 ? null : 'success' }] }];
  } };
  const r = await wait({ repo: 'o/r', sha: 's', required: ['ci-ok'], api, sleep: async () => {}, pollSec: 0 });
  assert.equal(r.result, 'pass');
  assert.equal(calls, 3);
  let t = 0;
  const stuck = await wait({ repo: 'o/r', sha: 's', required: ['ci-ok'], timeoutMin: 1, api: { ghAll: () => [] }, sleep: async () => {}, now: () => (t += 30_000) });
  assert.equal(stuck.result, 'timeout');
  assert.deepEqual(stuck.missing, ['ci-ok']);
});

test('wait: a failure must hold for two polls, so a re-run started by an approval is not missed', async () => {
  let calls = 0;
  const run = (id, status, conclusion) => [{ check_runs: [{ id, name: 'proof-ok', status, conclusion }] }];
  const rerun = { ghAll: path => path.includes('/statuses') ? [] : (++calls === 1 ? run(1, 'completed', 'failure') : calls === 2 ? run(2, 'queued', null) : run(2, 'completed', 'success')) };
  assert.equal((await wait({ repo: 'o/r', sha: 's', required: ['proof-ok'], api: rerun, sleep: async () => {}, pollSec: 0 })).result, 'pass');
  calls = 0;
  const failing = { ghAll: path => path.includes('/statuses') ? [] : (calls++, run(1, 'completed', 'failure')) };
  const r = await wait({ repo: 'o/r', sha: 's', required: ['proof-ok'], api: failing, sleep: async () => {}, pollSec: 0 });
  assert.equal(r.result, 'fail');
  assert.equal(calls, 2);
  assert.deepEqual(r.failed, ['proof-ok (failure)']);
});

test('next: oldest eligible PR first; an unapproved T3 is skipped with one comment', () => {
  const prs = {
    5: { number: 5, title: 'engine', labels: [{ name: 'merge:ready' }], head: { ref: 'agent/5-x', sha: 'a5', repo: { full_name: 'o/r' } }, base: { ref: 'main' } },
    9: { number: 9, title: 'docs', labels: [{ name: 'merge:ready' }], head: { ref: 'agent/9-y', sha: 'a9', repo: { full_name: 'o/r' } }, base: { ref: 'main' } },
    12: { number: 12, title: 'more', labels: [{ name: 'merge:ready' }], head: { ref: 'agent/12-z', sha: 'a12', repo: { full_name: 'o/r' } }, base: { ref: 'main' } },
  };
  const files = { 5: ['packages/engine-mars/src/nav.ts'], 9: ['docs/a.md'], 12: ['apps/web/src/x.ts'] };
  const comments = [];
  const api = {
    gh: path => path === 'repos/o/r' ? { default_branch: 'main' } : prs[Number(path.split('/').pop())],
    ghAll: path => {
      if (path.startsWith('repos/o/r/issues?')) return [12, 9, 5].map(number => ({ number, pull_request: {} })).concat([{ number: 3 }]);
      const n = Number(path.split('/')[4]);
      if (path.includes('/files')) return files[n].map(filename => ({ filename }));
      if (path.includes('/reviews')) return [];
      if (path.includes('/comments')) return [];
      return [];
    },
    comment: (repo, n, body) => comments.push({ n, body }),
  };
  const r = next({ repo: 'o/r', maintainer: M, api });
  assert.equal(r.pr, 9);
  assert.equal(r.tier, 'T0');
  assert.equal(r.same_repo, true);
  assert.equal(r.more, true);
  assert.deepEqual(r.skipped, [{ pr: 5, tier: 'T3', why: 'awaiting-approval' }]);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /T3, so it waits/);
});

// A one-PR queue for next(): PR 20 is behind main (mergeable_state 'behind'), with every required check green on its
// head, unless the overrides say otherwise. `mainRuns` are ci.yml runs on main (push unless they say otherwise); the
// ids in `full` ran every qualify job.
const run = (id, conclusion, o = {}) => ({ id, status: 'completed', conclusion, event: 'push', ...o });
const ALL_JOBS = JOBS.map(j => ({ name: j.name, conclusion: 'success' }));
function train({ files, labels = [], approved = false, mainRuns = [run(2, 'success')], full = [2], pr = {}, notes = [], noticeFails = false }) {
  const comments = [];
  const head = { ref: 'agent/20-x', sha: 'h20', repo: { full_name: 'o/r' } };
  const the = { number: 20, title: 't', labels: [{ name: 'merge:ready' }, ...labels.map(name => ({ name }))], head, base: { ref: 'main' }, mergeable: true, mergeable_state: 'behind', ...pr };
  const api = {
    gh: path => path === 'repos/o/r' ? { default_branch: 'main' } : path.includes('/actions/workflows/ci.yml/runs') ? { workflow_runs: mainRuns } : the,
    ghAll: path => {
      if (path.startsWith('repos/o/r/issues?')) return [{ number: 20, pull_request: {} }];
      if (path.includes('/files')) return files.map(filename => ({ filename }));
      if (path.includes('/reviews')) return approved ? [{ user: { login: M }, state: 'APPROVED' }] : [];
      if (path.includes('/check-runs')) return [{ check_runs: DEFAULT_CHECKS.map((name, id) => ({ id, name, status: 'completed', conclusion: 'success' })) }];
      if (path.includes('/actions/runs/')) return [{ jobs: full.includes(Number(path.split('/')[5])) ? ALL_JOBS : [{ name: 'repo', conclusion: 'success' }, { name: 'ci-ok', conclusion: 'success' }] }];
      if (path.includes('/issues/755/comments')) { if (noticeFails) throw new Error('HTTP 403'); return notes.concat(comments.filter(c => c.n === '755').map(c => ({ body: c.body }))); }
      return [];
    },
    comment: (repo, n, body) => comments.push({ n: String(n), body }),
    pause: () => {},
  };
  return { run: () => next({ repo: 'o/r', maintainer: M, notifyIssue: '755', api }), comments };
}
const GREEN = { mergeable: true, mergeableState: 'behind', headChecks: 'pass', mainCi: 'success' };

test('landing: a T1 behind main, mergeable and green on its head merges as is (non-strict)', () => {
  const { run: go, comments } = train({ files: ['apps/server/src/god/catalog.ts'] });
  const r = go();
  assert.equal(r.pr, 20);
  assert.equal(r.tier, 'T1');
  assert.equal(r.head_sha, 'h20');
  assert.equal(r.mode, 'nonstrict');
  assert.equal(comments.length, 0);
  for (const tier of ['T0', 'T1', 'T2']) assert.equal(landingMode({ ...GREEN, tier, files: ['docs/a.md'] }).mode, 'nonstrict');
});

test('landing: T3 stays strict (rebase and re-test), even approved and green', () => {
  const r = train({ files: ['docs/a.md'], labels: ['tier:T3'], approved: true }).run();
  assert.equal(r.pr, 20);
  assert.equal(r.tier, 'T3');
  assert.equal(r.mode, 'strict');
  assert.equal(r.mode_why, 'tier T3');
  assert.equal(landingMode({ ...GREEN, tier: 'T4', files: ['docs/a.md'] }).mode, 'strict');
});

test('landing: a T1 touching an engine-sensitive path stays strict', () => {
  const r = train({ files: ['docs/a.md', 'packages/world-compiler/src/compile.ts'] }).run();
  assert.equal(r.tier, 'T1');
  assert.equal(r.mode, 'strict');
  assert.equal(r.mode_why, 'engine-sensitive paths');
  assert.equal(train({ files: ['mars/src/sim.ts'] }).run().mode_why, 'engine-sensitive paths'); // T2 by path
  for (const f of ['mars/src/sim.ts', 'packages/engine-mars/src/nav.ts', 'packages/engine-contract/x.ts', 'packages/kernel/src/k.ts', 'packages/world-compiler/src/c.ts']) {
    assert.deepEqual(landingMode({ ...GREEN, tier: 'T1', files: ['docs/a.md', f] }), { mode: 'strict', why: 'engine-sensitive paths' }, f);
  }
  assert.equal(landingMode({ ...GREEN, tier: 'T1', files: ['docs/mars/a.md', 'packages/protocol/x.ts', 'apps/server/src/engines.md'] }).mode, 'nonstrict');
});

test('landing: the lockfile, conformance pins, walk and bundle baselines and workflows stay strict', () => {
  const cases = {
    'pnpm-lock.yaml': 'lockfile',
    'packages/conformance/conformance/0042.json': 'conformance pins',
    'tools/test-harness/walk/baseline/eden.json': 'walk or bundle baseline',
    'tools/test-harness/bundle-budget/baseline.json': 'walk or bundle baseline',
    '.github/workflows/merge-train.yml': 'workflows',
  };
  for (const [f, why] of Object.entries(cases)) {
    assert.deepEqual(landingMode({ ...GREEN, tier: 'T1', files: [f] }), { mode: 'strict', why }, f);
    assert.equal(train({ files: [f] }).run().mode_why, why, f);
  }
  for (const f of ['packages/lockfile.ts', 'tools/test-harness/walk/walk.mjs', 'tools/test-harness/bundle-budget/budget.mjs', '.github/scripts/merge-train.mjs']) {
    assert.equal(landingMode({ ...GREEN, tier: 'T1', files: [f] }).mode, 'nonstrict', f);
  }
});

test('landing: conflicts, unknown mergeability and a head not yet green are strict', () => {
  const base = { ...GREEN, tier: 'T1', files: ['docs/a.md'] };
  assert.equal(landingMode({ ...base, mergeable: false, mergeableState: 'dirty' }).mode, 'strict');
  assert.equal(landingMode({ ...base, mergeable: null, mergeableState: 'unknown' }).mode, 'strict');
  assert.equal(landingMode({ ...base, headChecks: 'pending' }).mode, 'strict');
  assert.equal(landingMode({ ...base, headChecks: 'fail' }).mode, 'strict');
  assert.equal(train({ files: ['docs/a.md'], pr: { mergeable: false, mergeable_state: 'dirty' } }).run().mode, 'strict');
});

test('mainCiState: a later narrow green run does not clear a failure; a full-scope green or a green re-run does', () => {
  const full = new Set([5, 12]);
  const isFull = r => full.has(r.id);
  // The reviewer's case: 9 failed, 10 is a narrow (docs/tools-only) green push.
  assert.deepEqual(mainCiState([run(9, 'failure'), run(10, 'success')], isFull), { conclusion: 'failure', since: 9 });
  assert.deepEqual(mainCiState([run(5, 'success'), run(9, 'failure'), run(10, 'success'), run(11, 'failure')], isFull), { conclusion: 'failure', since: 9 });
  assert.deepEqual(mainCiState([run(9, 'failure'), run(10, 'success'), run(12, 'success')], isFull), { conclusion: 'success', since: null });
  assert.deepEqual(mainCiState([run(5, 'success'), run(9, 'success', { run_attempt: 2 }), run(10, 'success')], isFull), { conclusion: 'success', since: null }); // 9 re-run green
  assert.deepEqual(mainCiState([run(5, 'success'), run(9, 'failure'), run(10, 'cancelled')], isFull), { conclusion: 'failure', since: 9 });
  // The window holds no green full-scope run: an older failure may be hidden behind narrow greens, so not green.
  assert.deepEqual(mainCiState([run(8, 'success'), run(10, 'success')], isFull), { conclusion: 'unproven', since: 'unproven' });
  assert.deepEqual(mainCiState([run(5, 'success'), run(8, 'success'), run(10, 'success')], isFull), { conclusion: 'success', since: null });
  assert.deepEqual(mainCiState([], isFull), { conclusion: 'unproven', since: 'unproven' });
  assert.equal(fullScope(run(3, 'success', { event: 'workflow_dispatch' }), []), true);
  assert.equal(fullScope(run(3, 'success'), ALL_JOBS), true);
  assert.equal(fullScope(run(3, 'success'), ALL_JOBS.slice(1)), false);
  assert.equal(fullScope(run(3, 'success'), ALL_JOBS.map((j, i) => i ? j : { ...j, conclusion: 'skipped' })), false);
  // Through next(): the narrow green push after a failure keeps the train strict.
  const r = train({ files: ['docs/a.md'], mainRuns: [run(10, 'success'), run(9, 'failure'), run(5, 'success')], full: [5] }).run();
  assert.equal(r.mode, 'strict');
  assert.match(r.mode_why, /main CI failure/);
  // Window exhausted: only narrow greens (the failure, if any, is older than the window) keeps the train strict.
  const narrow = train({ files: ['docs/a.md'], mainRuns: [run(11, 'success'), run(10, 'success')], full: [] });
  const n = narrow.run();
  assert.equal(n.mode, 'strict');
  assert.equal(n.mode_why, 'main CI unproven');
  assert.equal(narrow.comments.length, 1);
  assert.match(narrow.comments[0].body, /is unproven/);
  // A manual run after the failure is full scope and clears it.
  assert.equal(train({ files: ['docs/a.md'], mainRuns: [run(11, 'success', { event: 'workflow_dispatch' }), run(10, 'success'), run(9, 'failure')], full: [] }).run().mode, 'nonstrict');
});

test('landing: a red main CI falls back to strict for everything and comments once on the coordination issue', () => {
  const red = [run(9, 'failure'), run(8, 'cancelled'), run(5, 'success')];
  const t = train({ files: ['docs/a.md'], mainRuns: red, full: [5] });
  const first = t.run();
  assert.equal(first.mode, 'strict');
  assert.match(first.mode_why, /main CI failure/);
  assert.equal(t.comments.length, 1);
  assert.equal(t.comments[0].n, '755');
  assert.match(t.comments[0].body, /stopped non-strict merges/);
  t.run(); // the same red streak (same first failed run): no second comment
  assert.equal(t.comments.length, 1);
  // More failures in the same streak still post nothing.
  const more = train({ files: ['docs/a.md'], mainRuns: [run(10, 'failure'), ...red], full: [5], notes: [{ body: t.comments[0].body }] });
  more.run();
  assert.equal(more.comments.length, 0);
  // A new red streak after a full green gets its own notice.
  const later = train({ files: ['docs/a.md'], mainRuns: [run(12, 'failure'), run(11, 'success')], full: [11], notes: [{ body: t.comments[0].body }] });
  later.run();
  assert.equal(later.comments.length, 1);
  // Green again: non-strict resumes, nothing posted.
  const green = train({ files: ['docs/a.md'], notes: [{ body: t.comments[0].body }] });
  assert.equal(green.run().mode, 'nonstrict');
  assert.equal(green.comments.length, 0);
});

test('landing: a failing notice does not stall the train', () => {
  const t = train({ files: ['docs/a.md'], mainRuns: [run(9, 'failure')], full: [], noticeFails: true });
  const errors = [];
  const orig = console.error;
  console.error = m => errors.push(m);
  try {
    const r = t.run();
    assert.equal(r.pr, 20);
    assert.equal(r.mode, 'strict');
  } finally { console.error = orig; }
  assert.equal(t.comments.length, 0);
  assert.match(errors.join('\n'), /could not post the main-CI notice on #755/);
});

test('main CI dispatch: after a merge, start ci.yml on main unless a main run is already queued or in progress', () => {
  const r = (id, status, event = 'push') => ({ id, status, event, conclusion: status === 'completed' ? 'success' : null });
  assert.equal(activeMainRun([r(3, 'completed'), r(2, 'completed', 'workflow_dispatch')]), null);
  assert.equal(activeMainRun([r(4, 'queued', 'workflow_dispatch'), r(3, 'completed')]).id, 4);
  assert.equal(activeMainRun([r(5, 'in_progress'), r(6, 'pending', 'workflow_dispatch')]).id, 6);
  for (const s of ['waiting', 'requested']) assert.equal(activeMainRun([r(7, s)]).id, 7);
  // A pull_request run whose head branch happens to be called main is not a main run.
  assert.equal(activeMainRun([r(8, 'in_progress', 'pull_request')]), null);

  const fake = runs => {
    const calls = [];
    return { calls, api: { gh: (...args) => { calls.push(args); return args[0] === '-X' ? null : { workflow_runs: runs }; } } };
  };
  const idle = fake([r(3, 'completed')]);
  assert.deepEqual(dispatchMainCi({ repo: 'o/r', branch: 'main', api: idle.api }), { dispatched: true });
  assert.match(idle.calls[0][0], /^repos\/o\/r\/actions\/workflows\/ci\.yml\/runs\?branch=main&/);
  assert.deepEqual(idle.calls[1], ['-X', 'POST', 'repos/o/r/actions/workflows/ci.yml/dispatches', '-f', 'ref=main']);
  const busy = fake([r(9, 'queued', 'workflow_dispatch'), r(3, 'completed')]);
  assert.deepEqual(dispatchMainCi({ repo: 'o/r', branch: 'main', api: busy.api }), { dispatched: false, run: 9, status: 'queued' });
  assert.equal(busy.calls.length, 1); // listed only, no dispatch
});
