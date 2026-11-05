import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitHead, blocker, fullScope, HEAD_WAIT_MS, landingMode, mainCiState, maintainerApproved, next, parseChecks, summarizeChecks, wait, DEFAULT_CHECKS } from './merge-train.mjs';
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
  const fail = summarizeChecks({ runs: [run(1, 'ci-ok', 'completed', 'failure'), run(2, 'proof-ok', 'in_progress')], statuses: [{ context: 'legacy', state: 'success' }], required });
  assert.equal(fail.state, 'fail');
  assert.deepEqual(fail.failed, ['ci-ok (failure)']);
  assert.deepEqual(parseChecks(''), DEFAULT_CHECKS);
  assert.deepEqual(parseChecks('a, b c'), ['a', 'b', 'c']);
});

test('summarizeChecks: a cancelled or replaced workflow run leaves no failure behind (#909)', () => {
  // #674 at cb6a3e35: two ci runs a second apart; the older was cancelled and its always-run ci-ok failed, the newer
  // had not created ci-ok yet. The newer run decides; until it reports, ci-ok is pending.
  const wf = (id, suite, status, conclusion, o = {}) => ({ id, workflow_id: 7, check_suite_id: suite, status, conclusion, run_attempt: 1, run_started_at: '2026-11-04T22:25:47Z', ...o });
  const cr = (id, suite, status, conclusion, completed_at = null) => ({ id, name: 'ci-ok', status, conclusion, check_suite: { id: suite }, completed_at });
  const required = ['ci-ok'];
  const cancelledOld = wf(100, 10, 'completed', 'cancelled');
  const inFlight = wf(101, 11, 'in_progress', null);
  const staleFail = cr(1, 10, 'completed', 'failure', '2026-11-04T22:25:53Z');
  // A1: the cancelled run's failure is ignored; nothing newer yet, so pending.
  const a1 = summarizeChecks({ runs: [staleFail], workflowRuns: [cancelledOld], required });
  assert.deepEqual([a1.state, a1.pending, a1.failed], ['pending', ['ci-ok'], []]);
  // A2: a newer run of the same workflow replaces an older one even when the older was not cancelled.
  const doneOld = wf(100, 10, 'completed', 'failure');
  assert.equal(summarizeChecks({ runs: [staleFail], workflowRuns: [doneOld, inFlight], required }).state, 'pending');
  assert.equal(summarizeChecks({ runs: [staleFail, cr(2, 11, 'completed', 'success')], workflowRuns: [cancelledOld, { ...inFlight, status: 'completed', conclusion: 'success' }], required }).state, 'pass');
  // ...and its own failure still fails (A5).
  const real = summarizeChecks({ runs: [staleFail, cr(2, 11, 'completed', 'failure')], workflowRuns: [cancelledOld, { ...inFlight, status: 'completed', conclusion: 'failure' }], required });
  assert.deepEqual([real.state, real.failed], ['fail', ['ci-ok (failure)']]);
  // A3: a re-run in progress: the earlier attempt's result predates the attempt and waits; one from this attempt counts.
  const rerunning = wf(100, 10, 'in_progress', null, { run_attempt: 2, run_started_at: '2026-11-04T23:00:00Z' });
  assert.equal(summarizeChecks({ runs: [staleFail], workflowRuns: [rerunning], required }).state, 'pending');
  assert.equal(summarizeChecks({ runs: [staleFail, cr(3, 10, 'completed', 'failure', '2026-11-04T23:05:00Z')], workflowRuns: [rerunning], required }).state, 'fail');
  // A4: a cancelled conclusion is pending, never a failure.
  assert.equal(summarizeChecks({ runs: [cr(4, 12, 'completed', 'cancelled')], workflowRuns: [wf(102, 12, 'completed', 'failure')], required }).state, 'pending');
  assert.equal(summarizeChecks({ runs: [{ id: 5, name: 'ci-ok', status: 'completed', conclusion: 'cancelled' }], required }).state, 'pending');
  // A5: a check from another app or an unknown suite is judged on its own; statuses are unchanged.
  assert.equal(summarizeChecks({ runs: [cr(6, 99, 'completed', 'failure')], workflowRuns: [cancelledOld], required }).state, 'fail');
  assert.equal(summarizeChecks({ runs: [], statuses: [{ context: 'ci-ok', state: 'failure' }], workflowRuns: [cancelledOld], required }).state, 'fail');
  // Other workflows are not replaced by this one's newer run.
  const gl = { id: 7, name: 'gitleaks', status: 'completed', conclusion: 'success', check_suite: { id: 20 } };
  assert.equal(summarizeChecks({ runs: [gl], workflowRuns: [wf(200, 20, 'completed', 'success', { workflow_id: 8 }), inFlight], required: ['gitleaks'] }).state, 'pass');
});

test('wait: a stale failure from a cancelled run does not eject; the replacing run decides (#909)', async () => {
  let polls = 0;
  const api = { ghAll: path => {
    if (path.includes('/actions/runs?head_sha=s')) return [{ workflow_runs: [
      { id: 100, workflow_id: 7, check_suite_id: 10, status: 'completed', conclusion: 'cancelled' },
      { id: 101, workflow_id: 7, check_suite_id: 11, status: polls < 4 ? 'in_progress' : 'completed', conclusion: polls < 4 ? null : 'success' },
    ] }];
    if (!path.includes('/check-runs')) return [];
    polls++;
    const runs = [{ id: 1, name: 'ci-ok', status: 'completed', conclusion: 'failure', check_suite: { id: 10 } }];
    if (polls >= 4) runs.push({ id: 2, name: 'ci-ok', status: 'completed', conclusion: 'success', check_suite: { id: 11 } });
    return [{ check_runs: runs }];
  } };
  const r = await wait({ repo: 'o/r', sha: 's', required: ['ci-ok'], api, sleep: async () => {}, pollSec: 0 });
  assert.equal(r.result, 'pass');
  assert.equal(polls, 4);
});

test('wait polls until the checks conclude, and times out', async () => {
  let calls = 0;
  const api = { ghAll: path => {
    if (!path.includes('/check-runs')) return [];
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
  const rerun = { ghAll: path => !path.includes('/check-runs') ? [] : (++calls === 1 ? run(1, 'completed', 'failure') : calls === 2 ? run(2, 'queued', null) : run(2, 'completed', 'success')) };
  assert.equal((await wait({ repo: 'o/r', sha: 's', required: ['proof-ok'], api: rerun, sleep: async () => {}, pollSec: 0 })).result, 'pass');
  calls = 0;
  const failing = { ghAll: path => !path.includes('/check-runs') ? [] : (calls++, run(1, 'completed', 'failure')) };
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
function train({ files, labels = [], approved = false, mainRuns = [run(2, 'success')], full = [2], pr = {}, notes = [], noticeFails = false, pendingPolls = 0 }) {
  const comments = [];
  let headReads = 0, clock = 0, pauses = 0; // head checks stay pending for the first `pendingPolls` reads
  const head = { ref: 'agent/20-x', sha: 'h20', repo: { full_name: 'o/r' } };
  const the = { number: 20, title: 't', labels: [{ name: 'merge:ready' }, ...labels.map(name => ({ name }))], head, base: { ref: 'main' }, mergeable: true, mergeable_state: 'behind', ...pr };
  const api = {
    gh: path => path === 'repos/o/r' ? { default_branch: 'main' } : path.includes('/actions/workflows/ci.yml/runs') ? { workflow_runs: mainRuns } : the,
    ghAll: path => {
      if (path.startsWith('repos/o/r/issues?')) return [{ number: 20, pull_request: {} }];
      if (path.includes('/files')) return files.map(filename => ({ filename }));
      if (path.includes('/reviews')) return approved ? [{ user: { login: M }, state: 'APPROVED' }] : [];
      if (path.includes('/check-runs')) {
        const pending = headReads++ < pendingPolls;
        return [{ check_runs: DEFAULT_CHECKS.map((name, id) => ({ id, name, status: pending && name === 'proof-ok' ? 'queued' : 'completed', conclusion: pending && name === 'proof-ok' ? null : 'success' })) }];
      }
      if (path.includes('/actions/runs/')) return [{ jobs: full.includes(Number(path.split('/')[5])) ? ALL_JOBS : [{ name: 'repo', conclusion: 'success' }, { name: 'ci-ok', conclusion: 'success' }] }];
      if (path.includes('/issues/755/comments')) { if (noticeFails) throw new Error('HTTP 403'); return notes.concat(comments.filter(c => c.n === '755').map(c => ({ body: c.body }))); }
      return [];
    },
    comment: (repo, n, body) => comments.push({ n: String(n), body }),
    pause: ms => { pauses++; clock += ms; },
    now: () => clock,
  };
  return { run: () => next({ repo: 'o/r', maintainer: M, notifyIssue: '755', api }), comments, pauses: () => pauses };
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

test('landing: pending head checks (merge:ready re-runs proof-ok) wait, not strict; a timeout is strict as before', () => {
  const base = { ...GREEN, tier: 'T1', files: ['docs/a.md'], headChecks: 'pending' };
  assert.equal(awaitHead(base), true);
  assert.equal(awaitHead({ ...base, mergeable: null, mergeableState: 'unknown' }), true); // GitHub decides later
  assert.equal(awaitHead({ ...base, headChecks: 'fail' }), false);
  assert.equal(awaitHead({ ...base, headChecks: 'pass' }), false);
  assert.equal(awaitHead({ ...base, mainCi: 'failure' }), false);
  assert.equal(awaitHead({ ...base, tier: 'T3' }), false);
  assert.equal(awaitHead({ ...base, files: ['.github/workflows/ci.yml'] }), false);
  assert.equal(awaitHead({ ...base, mergeable: false, mergeableState: 'dirty' }), false);

  const later = train({ files: ['docs/a.md'], pendingPolls: 3 });
  const r = later.run();
  assert.equal(r.mode, 'nonstrict');
  assert.equal(later.pauses(), 3);

  const stuck = train({ files: ['docs/a.md'], pendingPolls: Infinity });
  const s = stuck.run();
  assert.equal(s.mode, 'strict');
  assert.equal(s.mode_why, 'head checks pending');
  assert.equal(stuck.pauses(), HEAD_WAIT_MS / 20_000);

  const strictAnyway = train({ files: ['docs/a.md'], pendingPolls: Infinity, mainRuns: [run(9, 'failure')], full: [] });
  assert.equal(strictAnyway.run().mode, 'strict');
  assert.equal(strictAnyway.pauses(), 0); // main red: strict regardless, no wait
});

test('workflow: every gh workflow run dispatch uses github.token, not the PAT (Next PR chain)', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync(new URL('../workflows/merge-train.yml', import.meta.url), 'utf8');
  const lines = yml.split('\n');
  const idx = lines.map((l, i) => (l.includes('gh workflow run') ? i : -1)).filter(i => i >= 0);
  assert.ok(idx.length >= 3);
  for (const i of idx) {
    const near = lines.slice(Math.max(0, i - 8), i).join('\n');
    assert.match(near, /GH_TOKEN: \$\{\{ github\.token \}\}/, `dispatch at line ${i + 1} must set GH_TOKEN to github.token`);
  }
});
