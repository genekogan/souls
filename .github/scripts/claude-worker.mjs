#!/usr/bin/env node
// Owner dispatch adapter; no model calls. The workflow invokes this trusted copy before/after source checkout.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TURNS = 12;
export const MAX_QUOTA_AGE_MS = 30 * 60 * 1000;
const integer = (s, name, min = 0) => {
  if (typeof s !== 'string' || !/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s) < min) throw Error(`Invalid ${name}`);
  return Number(s);
};
export function validateDispatch(input, context, now = Date.now()) {
  if (context.ref !== 'refs/heads/main' || context.actor !== context.owner || context.triggeringActor !== context.owner) throw Error('Only the repository owner may dispatch or rerun from main');
  const task = integer(input.task, 'task', 1);
  if (String(task) !== input.task) throw Error('task must use its canonical decimal number (no leading zeros)');
  if (!/^[a-f0-9]{40}$/.test(input.source_sha || '')) throw Error('source_sha must be a full lowercase commit SHA');
  if (typeof input.objective !== 'string' || !input.objective.trim() || input.objective.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.objective)) throw Error('objective must be 1–4000 text characters');
  if (!/^[a-z0-9][a-z0-9._-]{1,99}$/.test(input.model || '') || input.model !== context.approvedModel) throw Error('model must exactly match the reviewed CLAUDE_WORKER_MODEL variable; no default or fallback');
  const observed = Date.parse(input.quota_observed_at);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input.quota_observed_at || '') || !Number.isFinite(observed) || new Date(observed).toISOString().slice(0, 19) !== input.quota_observed_at.slice(0, 19) || observed > now || now - observed > MAX_QUOTA_AGE_MS) throw Error('Weekly quota observation is missing, future or older than 30 minutes');
  for (const field of ['weekly_used_percent', 'short_window_used_percent'])
    if (typeof input[field] !== 'string' || !/^\d+(?:\.\d+)?$/.test(input[field]) || Number(input[field]) >= 85) throw Error('Weekly and short-window usage must be observed and below 85%; unknown is not a pass');
  const ceiling = integer(input.worker_ceiling, 'worker_ceiling', 1), active = integer(input.active_workers, 'active_workers');
  if (active >= ceiling) throw Error('No available worker slot in the owner-reported total ceiling');
  if (input.writer_released !== true && input.writer_released !== 'true') throw Error('Owner must confirm the outgoing writer stopped and existing WIP is preserved');
  return { task, source: input.source_sha, objective: input.objective, model: input.model, turns: TURNS,
    quota: { source: 'owner observation of approved usage helper', observedAt: input.quota_observed_at, weeklyUsedPercent: Number(input.weekly_used_percent), shortWindowUsedPercent: Number(input.short_window_used_percent) },
    capacity: { active, ceiling }, actor: context.actor, run: context.run };
}
export async function qualifyTask(task, context, api) {
  const issue = await api(`repos/${context.repo}/issues/${task.task}`);
  if (issue.number !== task.task) throw Error('Task identity mismatch');
  let branch = `agent/${task.task}-cloud`, readOnly = issue.state === 'closed';
  const commit = await api(`repos/${context.repo}/commits/${task.source}`);
  if (commit.sha !== task.source) throw Error('Source commit is unavailable in this repository');
  if (issue.pull_request) {
    const pr = await api(`repos/${context.repo}/pulls/${task.task}`);
    if (pr.head?.repo?.full_name !== context.repo || pr.head.sha !== task.source) throw Error('PR must belong to this repository and name the exact dispatched head');
    branch = pr.head.ref;
  } else if (readOnly) throw Error('Closed issues are not implementation tasks; use their existing PR for read-only qualification');
  if (!readOnly && (!issue.labels?.some(x => x.name === 'agent:claimed') || !issue.assignees?.some(x => x.login === context.actor))) throw Error('An implementation task needs an explicit agent:claimed assignment to the dispatch owner');
  if (!/^agent\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.lock')) throw Error('Task branch must be an existing lifecycle agent branch or its canonical new issue branch');
  if (!issue.pull_request) {
    // A different existing source is unfinished work, never something this adapter may reset or overwrite.
    const ref = await api(`repos/${context.repo}/git/ref/heads/${branch}`, { optional404: true });
    if (ref && ref.object?.sha !== task.source) throw Error('Existing issue branch differs from source; preserve it and dispatch its actual head');
  }
  return { ...task, repo: context.repo, url: issue.html_url, title: issue.title, acceptance: issue.body, branch, readOnly };
}
export function argsFor(task) {
  const tools = task.readOnly ? 'Read,Grep,Glob,Bash' : 'Read,Grep,Glob,Edit,Write,Bash';
  const git = task.readOnly ? ['status', 'diff', 'log', 'show', 'rev-parse'].map(x => `Bash(git ${x}:*)`).join(',') : 'Bash(git:*)';
  const allowed = `Read,Grep,Glob,${task.readOnly ? '' : 'Edit,Write,Bash(gh pr create:*),'}${git},Bash(gh pr view:*),Bash(gh issue view:*),Bash(node --test:*),Bash(node --check:*)`;
  return `--model ${task.model} --max-turns ${TURNS} --permission-mode default --tools ${tools} --disallowedTools "Agent,Task,mcp__*" --allowedTools "${allowed}"`;
}
export function outcome(task, action, structured) {
  let report = null;
  try {
    const x = JSON.parse(structured || 'null');
    if (x && ['summary', 'checks', 'failures', 'next', 'source_refs'].every(k => typeof x[k] === 'string' && x[k].length <= 8000)) report = Object.fromEntries(['summary', 'checks', 'failures', 'next', 'source_refs'].map(k => [k, x[k]]));
  } catch { /* Absence/failure is retained; an action success is not acceptance qualification. */ }
  return { task: task.task, source: task.source, branch: task.branch, run: task.run, action,
    report, qualification: 'unverified by adapter', handoff: report ? 'Worker report; source refs and checks require review' : 'No valid worker report; inspect run and preserve any durable commits before retry' };
}
const api = async (path, { optional404 = false, body } = {}) => {
  try { return JSON.parse(execFileSync('gh', ['api', path, ...(body ? ['--method', 'POST', '--input', '-'] : [])], { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, stdio: ['pipe', 'pipe', 'pipe'] })); }
  catch (e) { if (optional404 && /HTTP 404/.test(String(e.stderr))) return null; throw Error(`GitHub operation failed for ${path}; no model execution should follow failed preparation`); }
};
async function main(mode) {
  const env = process.env, dir = join(env.RUNNER_TEMP, 'cloud-worker');
  mkdirSync(dir, { recursive: true });
  if (mode === 'prepare') {
    const input = JSON.parse(env.DISPATCH_INPUTS);
    const context = { repo: env.GITHUB_REPOSITORY, owner: env.GITHUB_REPOSITORY_OWNER, actor: env.GITHUB_ACTOR,
      triggeringActor: env.GITHUB_TRIGGERING_ACTOR, ref: env.GITHUB_REF, approvedModel: env.APPROVED_MODEL,
      run: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}` };
    const task = await qualifyTask(validateDispatch(input, context), context, api);
    writeFileSync(join(dir, 'task.json'), JSON.stringify(task, null, 2) + '\n');
    // Every output is a validated single line; objective/issue text never becomes shell or CLI argument code.
    const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
    appendFileSync(env.GITHUB_OUTPUT, `source=${task.source}\nbranch=${task.branch}\nargs=${argsFor(task)}\nhandler_sha256=${hash(fileURLToPath(import.meta.url))}\ntask_sha256=${hash(join(dir, 'task.json'))}\nready=true\n`);
    await api(`repos/${context.repo}/issues/${task.task}/comments`, { body: { body: `Owner-dispatched cloud worker: ${task.run}\n\nExact source: \`${task.source}\`; branch: \`${task.branch}\`; model: \`${task.model}\`; max ${TURNS} turns. ${task.readOnly ? 'Read-only qualification of a closed PR; no source updates.' : 'Claim confirmed; existing WIP preserved.'}\n\nThis is a dispatch receipt, not passed acceptance.\n\nValidated task handoff (owner observation, not a quota API):\n    ${JSON.stringify({ ...task, acceptance: undefined }, null, 2).replaceAll('\n', '\n    ')}` } });
  } else if (mode === 'finish') {
    const taskBytes = readFileSync(join(dir, 'task.json'));
    if (createHash('sha256').update(taskBytes).digest('hex') !== env.TASK_SHA256) throw Error('Task handoff changed during execution; refuse to post it as the original dispatch');
    const task = JSON.parse(taskBytes);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'verified=true\n');
    const result = outcome(task, env.AGENT_OUTCOME || 'not run', env.AGENT_REPORT);
    result.workspace = {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      uncommitted: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim(),
    };
    result.sourcePreservation = result.workspace.uncommitted ? 'Uncommitted source may be lost with this runner; owner must recover before cancellation/retry' : 'Local tree clean; review reported remote refs before reusing the claim';
    if (task.readOnly && (result.workspace.head !== task.source || result.workspace.uncommitted)) result.qualification = 'failed read-only task scope';
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    await api(`repos/${task.repo}/issues/${task.task}/comments`, { body: { body: `Cloud worker outcome: **${result.action}** — ${task.run}\n\nExact dispatched source: \`${task.source}\`; branch: \`${task.branch}\`; resulting local HEAD: \`${result.workspace.head}\`. Adapter qualification: **${result.qualification}**. ${result.handoff}.\n\n${result.sourcePreservation}.\n\n${result.report ? 'Worker report (not independently qualified):\n```json\n' + JSON.stringify(result.report, null, 2) + '\n```\n\n' : ''}Review the cloud-worker artifact for the objective, observations and structured result. Missing/failed checks remain unverified. A successful action does not establish merged/released/live-verified status; do not restart interrupted work without checking its durable source/proof and outgoing writer.` } });
    if (result.qualification.startsWith('failed')) throw Error(result.qualification);
  } else throw Error('usage: claude-worker.mjs prepare|finish');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(e => { console.error(e.message); process.exitCode = 1; });
