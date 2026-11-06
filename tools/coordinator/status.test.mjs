import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStates, collect, format, parseSince, queueDepth, workflowOf } from './status.mjs';

const NOW = Date.parse('2026-11-05T06:00:00Z');

test('parseSince: spans back from now, ISO times normalised, anything else refused', () => {
  assert.equal(parseSince('6h', NOW), '2026-11-05T00:00:00Z');
  assert.equal(parseSince('30m', NOW), '2026-11-05T05:30:00Z');
  assert.equal(parseSince('2d', NOW), '2026-11-03T06:00:00Z');
  assert.equal(parseSince(undefined, NOW), '2026-11-04T18:00:00Z', 'default 12h');
  assert.equal(parseSince('2026-11-04T22:00:00.000Z', NOW), '2026-11-04T22:00:00Z');
  assert.throws(() => parseSince('yesterday', NOW), /--since/);
});

// One head: ci ran twice (run 10 cancelled by run 11), proof-check twice (run 20 replaced by the newer run 21).
const wf = (id, workflow_id, suite, conclusion = 'success', status = 'completed') => ({ id, workflow_id, check_suite_id: suite, conclusion, status });
const run = (id, name, suite, conclusion = 'success', status = 'completed') => ({ id, name, check_suite: { id: suite }, conclusion, status });
const required = ['ci-ok', 'proof-ok', 'gitleaks', 'fragment'];

test('checkStates: stale results (cancelled or superseded Actions runs) never count; cancelled is pending', () => {
  const workflowRuns = [wf(10, 1, 100, 'cancelled'), wf(11, 1, 101, null, 'in_progress'), wf(20, 2, 200, 'failure'), wf(21, 2, 201)];
  const runs = [run(1, 'ci-ok', 100, 'failure'), run(2, 'proof-ok', 200, 'failure'), run(3, 'proof-ok', 201), run(4, 'gitleaks', 300, 'cancelled')];
  assert.deepEqual(checkStates({ runs, workflowRuns, required }), { 'ci-ok': 'pending', 'proof-ok': 'pass', gitleaks: 'pending', fragment: 'missing' });
  // Without the Actions runs a red from a cancelled run would read as a failure; that is the bug this avoids.
  assert.equal(checkStates({ runs, required })['ci-ok'], 'fail:failure');
});

test('checkStates: the newest live run wins; commit statuses fill names with no check run', () => {
  const runs = [run(5, 'ci-ok', 500, 'failure'), run(6, 'ci-ok', 500), run(7, 'gitleaks', 500, null, 'in_progress')];
  const statuses = [{ context: 'fragment', state: 'success' }, { context: 'fragment', state: 'failure' }, { context: 'proof-ok', state: 'error' }];
  assert.deepEqual(checkStates({ runs, statuses, required }), { 'ci-ok': 'pass', 'proof-ok': 'fail:error', gitleaks: 'pending', fragment: 'pass' });
});

test('queueDepth: queued and running counted per workflow file, largest first', () => {
  const r = (status, path, name = 'x') => ({ status, path, name });
  const q = queueDepth([r('queued', '.github/workflows/ci.yml', 'ci'), r('queued', '.github/workflows/claude-review.yml', 'PR #917'), r('queued', '.github/workflows/ci.yml'),
    r('in_progress', 'dynamic/github-code-scanning/codeql'), r('completed', '.github/workflows/ci.yml')]);
  assert.deepEqual(q, { queued: { ci: 2, 'claude-review': 1 }, in_progress: { codeql: 1 } });
  assert.equal(workflowOf({ name: 'legacy' }), 'legacy');
});

test('collect + format: merges by merged_at, train order by number with tier and wait, needs:rebase, queue', async () => {
  const pr = (number, o = {}) => ({ number, title: `PR ${number}`, draft: false, state: 'open', base: { ref: 'main' }, head: { sha: `${number}`.padEnd(40, 'a') }, labels: [{ name: 'merge:ready' }], ...o });
  const files = { 12: ['docs/a.md'], 9: ['apps/server/src/edge-x.ts'], 15: ['docs/b.md'] };
  const prs = { 9: pr(9), 12: pr(12), 15: pr(15, { draft: true }) };
  const calls = [];
  const api = { get: async path => {
    calls.push(path);
    if (path === 'repos/o/r') return [{ default_branch: 'main' }];
    if (path.startsWith('search/issues')) { assert.match(decodeURIComponent(path), /repo:o\/r is:pr is:merged merged:>=2026-11-05T00:00:00Z/); return [{ items: [
      { number: 656, title: 'old PR merged late', pull_request: { merged_at: '2026-11-05T05:17:03Z' } },
      { number: 900, title: 'new PR', pull_request: { merged_at: '2026-11-05T01:00:00Z' } }] }]; }
    if (path.includes('labels=merge%3Aready')) return [[{ number: 15, pull_request: {} }, { number: 9, pull_request: {} }, { number: 12, pull_request: {} }, { number: 3 }]];
    if (path.includes('labels=needs%3Arebase')) return [[{ number: 777, title: 'behind', pull_request: {} }]];
    if (path.includes('actions/runs?status=queued')) return [{ workflow_runs: [{ status: 'queued', path: '.github/workflows/ci.yml' }] }];
    if (path.includes('actions/runs?status=in_progress')) return [{ workflow_runs: [] }];
    let m;
    if ((m = /^repos\/o\/r\/pulls\/(\d+)$/.exec(path))) return [prs[m[1]]];
    if ((m = /^repos\/o\/r\/pulls\/(\d+)\/files/.exec(path))) return [files[m[1]].map(filename => ({ filename }))];
    if (/check-runs/.test(path)) return [{ check_runs: [{ id: 1, name: 'ci-ok', status: 'completed', conclusion: 'success' }] }];
    if (/statuses|actions\/runs\?head_sha|reviews|events/.test(path)) return [[]];
    throw Error(`unexpected ${path}`);
  } };
  const s = await collect({ repo: 'o/r', since: '2026-11-05T00:00:00Z', maintainer: 'owner', required: ['ci-ok', 'proof-ok'], api });
  assert.deepEqual(s.merged.map(m => m.number), [900, 656], 'sorted by merged_at, so a late merge of an old PR shows');
  assert.deepEqual(s.ready.map(p => [p.number, p.tier, p.waits]), [[9, 'T3', 'awaiting-approval'], [12, 'T0', null], [15, 'T0', 'draft']]);
  assert.deepEqual(s.ready[1].checks, { 'ci-ok': 'pass', 'proof-ok': 'missing' });
  assert.ok(calls.every(c => !/-X|POST|PATCH|DELETE/.test(c)), 'read-only');
  const text = format(s, '2026-11-05T06:00:00.000Z');
  assert.equal(text, [
    'status o/r at 2026-11-05T06:00Z',
    'merged since 2026-11-05T00:00:00Z (2):',
    '  #900 11-05 01:00Z new PR',
    '  #656 11-05 05:17Z old PR merged late',
    'train, merge:ready in order (3):',
    `  1. #9 T3 waits:awaiting-approval @9aaaaaaa | proof-ok=missing | PR 9`,
    `  2. #12 T0 can go @12aaaaaa | proof-ok=missing | PR 12`,
    `  3. #15 T0 waits:draft @15aaaaaa | proof-ok=missing | PR 15`,
    'needs:rebase (1):',
    '  #777 behind',
    'actions: queued 1 (ci 1); running 0',
  ].join('\n'));
});
