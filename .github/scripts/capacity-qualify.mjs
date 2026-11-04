#!/usr/bin/env node
// The control side of .github/workflows/capacity-qualify.yml (#840): validate the dispatch inputs, decide whether
// the self-hosted host is quiet before and after the meetup bench (tools/bench/capacity/meetup/meetup.mjs), and
// stage a sanitized artifact. It runs from the workflow's own commit, never from the ref under measurement.
//
//   node capacity-qualify.mjs inputs                           validate INPUT_* env; write step outputs
//   node capacity-qualify.mjs slice-check                      the slice prefix applies a real cgroup limit
//   node capacity-qualify.mjs before --qualify <file>          quiet decision before the bench (bounded load wait)
//   node capacity-qualify.mjs bench  --qualify <file> --out <bench out>   run meetup.mjs with the decided flags (cwd: the bench ref)
//   node capacity-qualify.mjs after  --qualify <file> --out <bench out>   overlap re-check after the bench
//   node capacity-qualify.mjs stage  --qualify <file> --out <bench out> --dest <dir>   allowlisted, scrubbed copy
//
// Pure decisions are exported for capacity-qualify.test.mjs. Nothing here prints a path, host or user name.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { cpus, hostname, loadavg, userInfo } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LABEL = 'souls-saturn';
export const LOAD_PER_CORE_MAX = 0.25;   // 1-minute load per core that counts as settled
export const SETTLE_WAIT_S = 300;
const PROFILES = ['even', 'meetup'];

/** INPUT_* env → validated inputs and the bench argument list; throws on anything malformed. */
export function parseInputs(env) {
  const bad = (k, v, why) => { throw new Error(`input ${k}=${JSON.stringify(v)}: ${why}`); };
  const bool = (k) => { const v = String(env[`INPUT_${k.toUpperCase()}`] ?? 'false'); if (v !== 'true' && v !== 'false') bad(k, v, 'true or false'); return v === 'true'; };
  const ref = String(env.INPUT_REF ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref) || ref.includes('..') || ref.endsWith('/') || ref.endsWith('.lock')) bad('ref', ref, 'a branch, tag or commit');
  const profile = String(env.INPUT_PROFILE ?? 'even,meetup'), list = profile.split(',');
  if (!list.length || list.some((p) => !PROFILES.includes(p)) || new Set(list).size !== list.length) bad('profile', profile, 'even, meetup or even,meetup');
  const repeats = String(env.INPUT_REPEATS ?? '2');
  if (!/^[1-3]$/.test(repeats)) bad('repeats', repeats, '1, 2 or 3');
  const hostClass = String(env.INPUT_HOST_CLASS ?? '');
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(hostClass)) bad('host_class', hostClass, 'lowercase letters, digits and dashes, at most 40');
  const cpu = String(env.INPUT_SLICE_CPU_QUOTA ?? ''), mem = String(env.INPUT_SLICE_MEMORY_MAX ?? '');
  if (cpu && !/^[1-9]\d{0,4}%$/.test(cpu)) bad('slice_cpu_quota', cpu, 'empty or a systemd CPUQuota such as 400%');
  if (mem && !/^[1-9]\d{0,5}[MG]$/.test(mem)) bad('slice_memory_max', mem, 'empty or a systemd MemoryMax such as 8G');
  const slice = cpu || mem ? ['systemd-run', '--user', '--scope', '--quiet', ...(cpu ? ['-p', `CPUQuota=${cpu}`] : []), ...(mem ? ['-p', `MemoryMax=${mem}`] : [])].join(' ') : '';
  const short = bool('short'), quietDeclared = bool('quiet_host');
  return { ref, profile, repeats: Number(repeats), short, quietDeclared, hostClass, slice };
}

/** The bench's argument list for a decision. --quiet-host and --qualifying-executor go together, only when quiet. */
export function benchArgs(inp, quiet, out) {
  return ['--profile', inp.profile, '--repeats', String(inp.repeats), '--host-class', inp.hostClass, '--out', out, '--port', '4460', '--range', '4461-4490',
    ...(inp.short ? ['--short'] : []), ...(inp.slice ? ['--slice', inp.slice] : []), ...(quiet ? ['--quiet-host', '--qualifying-executor'] : [])];
}

/** Jobs that ran on a runner with `label`, outside run `selfRunId`, overlapping [since, until] (null = open). */
export function overlappingJobs(jobs, { selfRunId, label = LABEL, since = null, until = null }) {
  const t = (s) => (s ? Date.parse(s) : null);
  return jobs.filter((j) => String(j.run_id) !== String(selfRunId) && j.runner_name && (j.labels ?? []).includes(label)
    && (j.status === 'in_progress' || (j.status === 'completed' && since != null && (t(j.completed_at) ?? 0) > since))
    && (until == null || (t(j.started_at) ?? Infinity) < until))
    .map((j) => ({ run: j.run_id, job: j.name, status: j.status }));
}

/** Before the bench: quiet only when declared and nothing else is running on the host or the label. */
export function decideBefore({ declared, jobs, otherSouls, loadPerCore, max = LOAD_PER_CORE_MAX }) {
  const reasons = [];
  if (!declared) reasons.push('the dispatcher did not declare the host quiet (quiet_host=false)');
  if (jobs == null) reasons.push('the Actions jobs API could not be read, so other jobs on the runner label are unknown');
  else if (jobs.length) reasons.push(`${jobs.length} other job(s) in progress on a ${LABEL} runner`);
  if (otherSouls == null) reasons.push('other Soul server processes could not be counted');
  else if (otherSouls > 0) reasons.push(`${otherSouls} other Soul server process(es) running on the host`);
  if (loadPerCore == null || !(loadPerCore < max)) reasons.push(`1-minute load per core ${loadPerCore ?? 'unknown'} did not settle below ${max} within ${SETTLE_WAIT_S} s`);
  return { quiet: reasons.length === 0, reasons };
}

/** After the bench: a quiet run stays quiet only if no job overlapped it and the bench saw no other Soul server. */
export function decideAfter({ quietBefore, jobs, benchOtherSouls }) {
  const reasons = [];
  if (jobs == null) reasons.push('the Actions jobs API could not be read after the run');
  else if (jobs.length) reasons.push(`${jobs.length} other job(s) ran on a ${LABEL} runner during the measurement`);
  if (benchOtherSouls > 0) reasons.push(`the bench counted ${benchOtherSouls} other Soul server process(es) before or after a run`);
  return { quiet: quietBefore && reasons.length === 0, reasons };
}

/** Largest other-Soul-process count any run's result.json recorded (the bench's own load facts). */
export function benchOtherSouls(out) {
  let n = 0;
  for (const d of runDirs(out)) {
    try { const l = JSON.parse(readFileSync(join(out, d, 'result.json'), 'utf8')).load ?? {}; n = Math.max(n, l.otherSoulsProcessesBefore ?? 0, l.otherSoulsProcessesAfter ?? 0); } catch { /* failed run: no load facts */ }
  }
  return n;
}
const runDirs = (out) => (existsSync(out) ? readdirSync(out, { withFileTypes: true }).filter((e) => e.isDirectory() && /^(even|meetup)-r\d+$/.test(e.name)).map((e) => e.name) : []);

/** Replace host-identifying strings: paths verbatim, names only as whole words, short values never. */
export function scrub(text, { paths = [], names = [] }) {
  let s = text;
  for (const [v, to] of paths.filter(([v]) => v && v.length >= 4).sort((a, b) => b[0].length - a[0].length)) s = s.split(v).join(to);
  for (const [v, to] of names.filter(([v]) => v && v.length >= 4)) s = s.replace(new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), to);
  return s;
}

/** Soul tokens the run wrote (souls/<s>/.eden-agent.json); none of them may leave the runner. */
export function soulTokens(out) {
  const tokens = [];
  for (const d of runDirs(out)) {
    const souls = join(out, d, 'souls'); if (!existsSync(souls)) continue;
    for (const s of readdirSync(souls)) { try { const t = JSON.parse(readFileSync(join(souls, s, '.eden-agent.json'), 'utf8')).token; if (t) tokens.push(String(t)); } catch { /* no token */ } }
  }
  return tokens;
}

/** Copy the allowlisted files into dest, scrubbed; refuse if any still holds a Soul token. Returns the copied list. */
export function stage({ out, dest, qualify, scrubWith }) {
  const files = [['VERDICT.md'], ['summary.json'], ...runDirs(out).flatMap((d) => ['REPORT.md', 'receipt.json', 'result.json'].map((f) => [d, f]))].filter((p) => existsSync(join(out, ...p)));
  const tokens = soulTokens(out), copied = [];
  mkdirSync(dest, { recursive: true });
  const write = (rel, text) => {
    const hit = tokens.find((t) => text.includes(t)); if (hit) throw new Error(`${rel.join('/')} holds a Soul token; nothing is uploaded`);
    if (rel.length > 1) mkdirSync(join(dest, ...rel.slice(0, -1)), { recursive: true });
    writeFileSync(join(dest, ...rel), text); copied.push(rel.join('/'));
  };
  const head = `> Executor: self-hosted runner \`${LABEL}\`, host class \`${qualify.inputs?.hostClass}\`. Quiet before: ${qualify.before?.quiet ? 'yes' : 'no'}; after: ${qualify.after?.quiet ? 'yes' : 'no'}.`
    + `${[...(qualify.before?.reasons ?? []), ...(qualify.after?.reasons ?? [])].map((r) => `\n> - ${r}`).join('')}\n`
    + (qualify.before?.quiet && qualify.after?.quiet === false ? '\n> **NOT QUIET after the fact: the bench was told the host was quiet, but the re-check above failed. This verdict does not qualify.**\n' : '') + '\n';
  for (const rel of files) write(rel, scrub((rel.join('/') === 'VERDICT.md' ? head : '') + readFileSync(join(out, ...rel), 'utf8'), scrubWith));
  write(['qualify.json'], scrub(JSON.stringify(qualify, null, 1) + '\n', scrubWith));
  return copied;
}

// ------------------------------------------------------------------ impure side (the workflow's steps)
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return e.status === 1 ? '' : null; } };
const otherSoulsNow = () => { const v = sh('pgrep', ['-f', 'apps/server/src/main.ts']); return v == null ? null : v.split('\n').filter(Boolean).length; };
async function api(path) {
  const r = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, { headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  return r.json();
}
async function labelJobs(createdSince = null) {   // jobs of in-progress runs, plus runs created since a time
  const repo = process.env.GITHUB_REPOSITORY, runs = new Map();
  try {
    for (const q of ['status=in_progress', ...(createdSince ? [`created=%3E%3D${encodeURIComponent(createdSince)}`] : [])])
      for (const r of (await api(`/repos/${repo}/actions/runs?${q}&per_page=100`)).workflow_runs ?? []) runs.set(r.id, r);
    const jobs = [];
    for (const id of runs.keys()) jobs.push(...((await api(`/repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`)).jobs ?? []));
    return jobs;
  } catch { return null; }
}
const output = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? null : process.argv[i + 1]; };
const readJ = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main(cmd) {
  const inp = parseInputs(process.env), qf = arg('qualify');
  if (cmd === 'inputs') { output('slice', inp.slice); console.log(`inputs ok: ${inp.profile} x${inp.repeats}${inp.short ? ' short' : ''}, quiet declared ${inp.quietDeclared}, slice ${inp.slice ? 'set' : 'none'}`); return; }
  if (cmd === 'slice-check') {
    if (!inp.slice) { console.log('no slice limits requested'); return; }
    const probe = "d=/sys/fs/cgroup$(sed -n 's/^0:://p' /proc/self/cgroup); echo $(cat $d/cpu.max 2>/dev/null || echo none) $(cat $d/memory.max 2>/dev/null || echo none)";
    const got = sh(inp.slice.split(' ')[0], [...inp.slice.split(' ').slice(1), 'sh', '-c', probe]);
    const [quota, , memMax] = (got ?? '').split(/\s+/), wantCpu = /CPUQuota/.test(inp.slice), wantMem = /MemoryMax/.test(inp.slice);
    if (got == null || (wantCpu && (!quota || quota === 'max' || quota === 'none')) || (wantMem && (!memMax || memMax === 'max' || memMax === 'none')))
      throw new Error('slice limits requested, but systemd-run --user --scope did not apply them on this host (needs a user systemd instance with cpu and memory delegated)');
    console.log('slice limits apply'); return;
  }
  if (cmd === 'before') {
    const cores = cpus().length; let lpc = null;
    for (let t = 0; t <= SETTLE_WAIT_S; t += 15) { lpc = +(loadavg()[0] / cores).toFixed(3); if (lpc < LOAD_PER_CORE_MAX) break; if (t < SETTLE_WAIT_S) await sleep(15_000); }
    const jobs = await labelJobs(), facts = { declared: inp.quietDeclared, jobs: jobs && overlappingJobs(jobs, { selfRunId: process.env.GITHUB_RUN_ID }), otherSouls: otherSoulsNow(), loadPerCore: lpc };
    const d = decideBefore(facts), startedAt = new Date().toISOString();
    writeFileSync(qf, JSON.stringify({ schema: 'capacity-qualify/1', workflowRun: process.env.GITHUB_RUN_ID, ref: inp.ref, commit: process.env.BENCH_COMMIT ?? null, inputs: { ...inp, slice: inp.slice || null },
      host: { cores, loadPerCoreAtStart: lpc, otherSoulsAtStart: facts.otherSouls, otherJobsAtStart: facts.jobs }, startedAt, before: d }, null, 1));
    output('quiet', d.quiet);
    console.log(`quiet before: ${d.quiet}${d.reasons.map((r) => `\n  - ${r}`).join('')}`); return;
  }
  if (cmd === 'bench') {   // fake minds, no GitHub token; signals reach the bench so it stops what it owns
    const q = readJ(qf), env = { ...process.env, BRAIN_MODE: 'fake' }; delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
    const args = benchArgs(inp, !!q.before?.quiet, arg('out'));
    console.log(`meetup.mjs ${args.join(' ')}`);
    const child = spawn(process.execPath, ['tools/bench/capacity/meetup/meetup.mjs', ...args], { stdio: 'inherit', env });
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
    process.exitCode = await new Promise((r) => child.on('exit', (code) => r(code ?? 1))); return;
  }
  if (cmd === 'after') {
    const q = readJ(qf), out = arg('out'), now = Date.now(), jobs = await labelJobs(q.startedAt);
    const d = decideAfter({ quietBefore: !!q.before?.quiet, jobs: jobs && overlappingJobs(jobs, { selfRunId: process.env.GITHUB_RUN_ID, since: Date.parse(q.startedAt), until: now }), benchOtherSouls: benchOtherSouls(out) });
    writeFileSync(qf, JSON.stringify({ ...q, endedAt: new Date(now).toISOString(), after: d }, null, 1));
    console.log(`quiet after: ${d.quiet}${d.reasons.map((r) => `\n  - ${r}`).join('')}`); return;
  }
  if (cmd === 'stage') {
    const q = readJ(qf), env = process.env, u = (() => { try { return userInfo().username; } catch { return env.USER; } })();
    const copied = stage({ out: arg('out'), dest: arg('dest'), qualify: q, scrubWith: { paths: [[env.GITHUB_WORKSPACE, '.'], [env.RUNNER_WORKSPACE, '<runner-work>'], [env.RUNNER_TEMP, '<runner-temp>'], [env.HOME, '~']], names: [[hostname(), '<host>'], [u, '<user>']] } });
    console.log(`staged ${copied.length} file(s): ${copied.join(', ')}`); return;
  }
  throw new Error(`unknown command ${cmd}: inputs | slice-check | before | bench | after | stage`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv[2]).catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
