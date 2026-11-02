import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateDispatch, qualifyTask, argsFor, outcome, MAX_QUOTA_AGE_MS } from './claude-worker.mjs';
const now = Date.parse('2026-11-02T20:00:00.000Z'), sha = 'a'.repeat(40);
const context = { ref: 'refs/heads/main', actor: 'owner', triggeringActor: 'owner', owner: 'owner', repo: 'owner/repo', approvedModel: 'approved-model-fixture', run: 'https://github.com/owner/repo/actions/runs/1/attempts/1' };
const input = () => ({ task: '600', source_sha: sha, objective: 'Qualify this unchanged candidate; retain its existing checks.', model: context.approvedModel,
  quota_observed_at: new Date(now).toISOString(), weekly_used_percent: '25.5', short_window_used_percent: '20', active_workers: '2', worker_ceiling: '4', writer_released: true });
const issue = () => ({ number: 600, state: 'open', title: 'Task', body: 'Existing acceptance', html_url: 'https://github.com/owner/repo/issues/600', labels: [{ name: 'agent:claimed' }], assignees: [{ login: 'owner' }] });
const pr = () => ({ head: { sha, ref: 'agent/538-fixture', repo: { full_name: context.repo } } });
function apiFor(i = issue(), p = pr(), ref = null) {
  const calls = [];
  return Object.assign(async path => { calls.push(path); if (path.includes('/commits/')) return { sha }; if (path.includes('/git/ref/')) return ref; if (path.includes('/pulls/')) return p; return i; }, { calls });
}
test('unknown, exhausted, future and stale quota refuse, including an exhausted short window', () => {
  assert.equal(validateDispatch(input(), context, now).quota.weeklyUsedPercent, 25.5);
  for (const [key, value] of [['weekly_used_percent', 'unknown'], ['weekly_used_percent', '100'], ['weekly_used_percent', '-1'], ['short_window_used_percent', '100'], ['short_window_used_percent', ''], ['quota_observed_at', ''], ['quota_observed_at', new Date(now + 1).toISOString()], ['quota_observed_at', new Date(now - MAX_QUOTA_AGE_MS - 1).toISOString()], ['quota_observed_at', '2026-02-30T20:00:00Z']]) {
    assert.throws(() => validateDispatch({ ...input(), [key]: value }, context, now), /usage|quota/i, key);
  }
});
test('owner, source, model, scope and capacity validation fail closed', () => {
  for (const c of [{ actor: 'other' }, { triggeringActor: 'other' }, { ref: 'refs/heads/untrusted' }, { approvedModel: '' }]) assert.throws(() => validateDispatch(input(), { ...context, ...c }, now));
  for (const [key, value] of [['source_sha', 'HEAD'], ['source_sha', sha + ';echo bad'], ['task', '0600'], ['task', '600\nready=true'], ['model', 'approved-model-fixture --fallback-model other'], ['objective', ''], ['objective', 'x'.repeat(4001)], ['active_workers', '4'], ['active_workers', 'unknown'], ['writer_released', false]]) assert.throws(() => validateDispatch({ ...input(), [key]: value }, context, now), undefined, key);
});
test('claimed issues preserve a differing existing branch; PRs require exact source and same repository', async () => {
  const task = validateDispatch(input(), context, now);
  const clean = await qualifyTask(task, context, apiFor()); assert.equal(clean.branch, 'agent/600-cloud'); assert.equal(clean.readOnly, false);
  for (const i of [{ ...issue(), labels: [] }, { ...issue(), assignees: [] }, { ...issue(), state: 'closed' }]) await assert.rejects(qualifyTask(task, context, apiFor(i)));
  await assert.rejects(qualifyTask(task, context, apiFor(issue(), pr(), { object: { sha: 'b'.repeat(40) } })), /preserve/);
  const closed = { ...issue(), pull_request: {}, state: 'closed', labels: [], assignees: [] };
  const candidate = await qualifyTask(task, context, apiFor(closed)); assert.equal(candidate.readOnly, true); assert.equal(candidate.branch, 'agent/538-fixture');
  for (const p of [{ head: { ...pr().head, sha: 'b'.repeat(40) } }, { head: { ...pr().head, repo: { full_name: 'fork/repo' } } }, { head: { ...pr().head, ref: 'main' } }]) await assert.rejects(qualifyTask(task, context, apiFor(closed, p)));
});
test('action arguments use only the approved model and fixed bounds; read-only work has no write tools', () => {
  const task = validateDispatch(input(), context, now);
  assert.match(argsFor(task), /--max-turns 12/); assert.match(argsFor(task), /--model approved-model-fixture /);
  assert.match(argsFor(task), /--disallowedTools "Agent,Task,mcp__\*"/); assert.doesNotMatch(argsFor(task), /fallback|api-key/);
  const read = argsFor({ ...task, readOnly: true }); assert.doesNotMatch(read, /Edit|Write|Bash\(git:\*\)|gh pr create/); assert.match(read, /Bash\(node --test:\*\)/);
  assert.equal(outcome(task, 'failure', '{invalid').report, null);
  const r = outcome(task, 'success', JSON.stringify({ summary: 'Done', checks: 'one pass', failures: 'original failure retained', next: 'owner review', source_refs: sha, secret: 'never export extras' }));
  assert.equal(r.qualification, 'unverified by adapter'); assert.equal(JSON.stringify(r).includes('never export extras'), false);
});
test('actual preparation passes task text as data to gh, never shell code or workflow output', t => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-dispatch-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const marker = join(dir, 'executed'), output = join(dir, 'outputs'), calls = join(dir, 'calls.jsonl');
  const gh = `#!${process.execPath}\nimport fs from 'node:fs'; const a=process.argv.slice(2), p=a[1], body=fs.readFileSync(0,'utf8'); fs.appendFileSync(process.env.CALLS,JSON.stringify({a,body})+'\\n'); if(p.includes('/comments')) console.log('{}'); else if(p.includes('/commits/')) console.log(JSON.stringify({sha:'${sha}'})); else if(p.includes('/git/ref/')) {console.error('HTTP 404');process.exit(1);} else console.log(process.env.ISSUE);\n`;
  writeFileSync(join(bin, 'gh'), gh, { mode: 0o755 });
  const objective = `Literal $(touch ${marker}); \`touch ${marker}\`\nready=false\n${'${{ secrets.UNAVAILABLE }}'}`;
  const supplied = { ...input(), objective, quota_observed_at: new Date().toISOString() };
  const result = spawnSync(process.execPath, [new URL('./claude-worker.mjs', import.meta.url).pathname, 'prepare'], { encoding: 'utf8', env: { PATH: bin + ':' + process.env.PATH, RUNNER_TEMP: dir, CALLS: calls, ISSUE: JSON.stringify(issue()), DISPATCH_INPUTS: JSON.stringify(supplied), APPROVED_MODEL: context.approvedModel,
    GITHUB_REPOSITORY: context.repo, GITHUB_REPOSITORY_OWNER: 'owner', GITHUB_ACTOR: 'owner', GITHUB_TRIGGERING_ACTOR: 'owner', GITHUB_REF: 'refs/heads/main', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output } });
  assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(marker), false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'cloud-worker/task.json'))).objective, objective);
  const values = readFileSync(output, 'utf8'); assert.doesNotMatch(values, /touch|ready=false|secrets/); assert.match(values, /ready=true/);
  const posted = readFileSync(calls, 'utf8').trim().split('\n').map(x => JSON.parse(x)).find(x => x.a.includes('--input'));
  assert.equal(JSON.parse(posted.body).body.includes(objective), false, 'objective is safely JSON encoded in the journal');
  assert.equal(JSON.parse(posted.body).body.includes('Literal $(touch'), true);
  writeFileSync(join(bin, 'git'), `#!${process.execPath}\nconsole.log(process.argv[2]==='rev-parse'?'${sha}':'');\n`, { mode: 0o755 });
  const report = { summary: 'Scope checked', checks: 'one scoped pass', failures: 'prior failure retained', next: 'owner review', source_refs: sha };
  const finishEnv = { PATH: bin + ':' + process.env.PATH, RUNNER_TEMP: dir, CALLS: calls,
    TASK_SHA256: createHash('sha256').update(readFileSync(join(dir, 'cloud-worker/task.json'))).digest('hex'), AGENT_OUTCOME: 'failure', AGENT_REPORT: JSON.stringify(report) };
  const finish = () => spawnSync(process.execPath, [new URL('./claude-worker.mjs', import.meta.url).pathname, 'finish'], { encoding: 'utf8', env: finishEnv });
  assert.equal(finish().status, 0);
  const retained = JSON.parse(readFileSync(join(dir, 'cloud-worker/result.json')));
  assert.equal(retained.action, 'failure'); assert.deepEqual(retained.report, report); assert.equal(retained.qualification, 'unverified by adapter');
  const before = readFileSync(calls, 'utf8');
  writeFileSync(join(dir, 'cloud-worker/task.json'), JSON.stringify({ task: 999 }));
  const rejected = finish(); assert.equal(rejected.status, 1); assert.match(rejected.stderr, /handoff changed/);
  assert.equal(readFileSync(calls, 'utf8'), before, 'a changed dispatch cannot redirect the outcome journal');

});
test('workflow keeps task text out of shell/arguments and preserves pinned, bounded manual execution', () => {
  const workflow = readFileSync(new URL('../workflows/claude-worker.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.doesNotMatch(workflow, /schedule:|workflow_run:|push:/);
  assert.match(workflow, /anthropics\/claude-code-action@d535f5172dec02b204866b393d6b20b9b2aaf98d/);
  assert.match(workflow, /timeout-minutes: 30/); assert.match(workflow, /timeout-minutes: 25/); assert.match(workflow, /cancel-in-progress: false/); assert.match(workflow, /group: claude-\$\{\{ inputs.task }}/);
  assert.match(workflow, /DISPATCH_INPUTS: \$\{\{ toJSON\(inputs\) }}/);
  assert.doesNotMatch(workflow, /\$\{\{ inputs\.(?:objective|model|quota_observed_at|weekly_used_percent) }}/);
  assert.match(workflow, /sha256sum --check --status/); assert.doesNotMatch(workflow, /ANTHROPIC_API_KEY|DEPLOY_SSH_KEY|MODAL_TOKEN|assets:pull|pnpm install/);
  assert.match(workflow, /classify_inline_comments: false/);
});
