// capacity-qualify.mjs (#840): inputs, the quiet decision before and after the bench, and the artifact staging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInputs, checkoutRef, benchArgs, overlappingJobs, runnerLabels, sameRunnerSet, decideBefore, decideAfter, scrub, stage, benchOtherSouls, LOAD_PER_CORE_MAX } from './capacity-qualify.mjs';

const ENV = { INPUT_REF: 'agent/736-hardware-qualification', INPUT_PROFILE: 'even,meetup', INPUT_REPEATS: '2', INPUT_SHORT: 'false', INPUT_QUIET_HOST: 'true', INPUT_BROWSER: 'false', INPUT_HOST_CLASS: 'maintainer-self-hosted', INPUT_SLICE_CPU_QUOTA: '', INPUT_SLICE_MEMORY_MAX: '' };

test('inputs: valid dispatch parses; slice prefix only from validated limits', () => {
  const i = parseInputs(ENV);
  assert.deepEqual([i.profile, i.repeats, i.short, i.quietDeclared, i.slice], ['even,meetup', 2, false, true, '']);
  assert.equal(parseInputs({ ...ENV, INPUT_SLICE_CPU_QUOTA: '400%', INPUT_SLICE_MEMORY_MAX: '8G' }).slice, 'systemd-run --user --scope --quiet -p CPUQuota=400% -p MemoryMax=8G');
  assert.equal(parseInputs({ ...ENV, INPUT_REF: 'main' }).ref, 'main');
  assert.equal(parseInputs({ ...ENV, INPUT_REF: 'agent/840-capacity-qualify' }).ref, 'agent/840-capacity-qualify');
  assert.equal(checkoutRef('agent/840-capacity-qualify'), 'refs/heads/agent/840-capacity-qualify');
  assert.equal(parseInputs({ ...ENV, INPUT_BROWSER: undefined }).browser, false);
});

test('inputs: ref is main or one agent/<name> branch of this repository; everything else is refused', () => {
  for (const v of ['', 'a'.repeat(40), 'v1.0', 'refs/heads/main', 'feature/x', 'agent', 'agent/', 'agent/a/b', 'agent/../main', 'agent/x..y', 'agent/x.lock', 'agent/x.', 'agent/-x',
    'mainx', 'main ', 'Main', 'origin/main', 'agent/x:y', 'agent/x~1', 'agent/$(id)'])
    assert.throws(() => parseInputs({ ...ENV, INPUT_REF: v }), /input ref=.*main or an agent\/<name> branch/, JSON.stringify(v));
});

test('inputs: malformed values are refused before anything runs', () => {
  for (const [k, v] of [['INPUT_SLICE_CPU_QUOTA', '400% -p Foo=1'], ['INPUT_SLICE_CPU_QUOTA', '4'], ['INPUT_SLICE_MEMORY_MAX', '8G;id'], ['INPUT_SLICE_MEMORY_MAX', '0G'],
    ['INPUT_PROFILE', 'even,even'], ['INPUT_PROFILE', 'burst'], ['INPUT_REPEATS', '0'], ['INPUT_REPEATS', '9'], ['INPUT_REPEATS', '2 --short'],
    ['INPUT_REF', '../main'], ['INPUT_REF', '-x'], ['INPUT_REF', 'a b'], ['INPUT_REF', '$(id)'], ['INPUT_HOST_CLASS', 'Host Name'], ['INPUT_HOST_CLASS', ''], ['INPUT_QUIET_HOST', 'yes'], ['INPUT_SHORT', '1'], ['INPUT_BROWSER', 'on']])
    assert.throws(() => parseInputs({ ...ENV, [k]: v }), new RegExp(k.slice(6).toLowerCase()), `${k}=${v}`);
});

test('bench args: --quiet-host and --qualifying-executor together, only when quiet', () => {
  const i = parseInputs({ ...ENV, INPUT_SLICE_MEMORY_MAX: '8G' }), q = benchArgs(i, true, 'o'), n = benchArgs(i, false, 'o');
  assert.ok(q.includes('--quiet-host') && q.includes('--qualifying-executor'));
  assert.ok(!n.includes('--quiet-host') && !n.includes('--qualifying-executor'));
  assert.equal(q[q.indexOf('--slice') + 1], 'systemd-run --user --scope --quiet -p MemoryMax=8G');
  assert.ok(benchArgs(parseInputs({ ...ENV, INPUT_SHORT: 'true' }), true, 'o').includes('--short'));
});

test('bench args: the real browser is off unless browser=true', () => {
  assert.ok(!benchArgs(parseInputs(ENV), true, 'o').includes('--browser'));
  assert.ok(benchArgs(parseInputs({ ...ENV, INPUT_BROWSER: 'true' }), true, 'o').includes('--browser'));
});

const job = (o) => ({ run_id: 7, name: 'ci', status: 'in_progress', runner_name: 'r', labels: ['self-hosted', 'qualify-pool'], started_at: '2026-11-04T10:00:00Z', completed_at: null, ...o });

test('jobs: others on the label count; this run, other labels, unassigned and earlier jobs do not', () => {
  const jobs = [job({}), job({ run_id: 1 }), job({ run_id: 8, labels: ['ubuntu-latest'] }), job({ run_id: 9, runner_name: null, status: 'queued' }),
    job({ run_id: 10, status: 'completed', completed_at: '2026-11-04T09:00:00Z' })];
  assert.deepEqual(overlappingJobs(jobs, { selfRunId: 1, labels: ['self-hosted', 'qualify-pool'] }).map((j) => j.run), [7]);
  // after: a job that started and finished inside the window overlaps; one that finished before it does not
  const since = Date.parse('2026-11-04T09:30:00Z'), until = Date.parse('2026-11-04T12:00:00Z');
  const after = [job({ status: 'completed', started_at: '2026-11-04T10:00:00Z', completed_at: '2026-11-04T10:05:00Z' }), job({ run_id: 10, status: 'completed', completed_at: '2026-11-04T09:00:00Z' }),
    job({ run_id: 11, started_at: '2026-11-04T13:00:00Z' })];
  assert.deepEqual(overlappingJobs(after, { selfRunId: 1, labels: ['self-hosted', 'qualify-pool'], since, until }).map((j) => j.run), [7]);
});

test('runner set: labels come from the variable; generic labels alone match any self-hosted job', () => {
  assert.deepEqual(runnerLabels(''), ['self-hosted']);
  assert.deepEqual(runnerLabels('["self-hosted","qualify-pool"]'), ['self-hosted', 'qualify-pool']);
  for (const bad of ['self-hosted', '[]', '[1]', '{"a":1}']) assert.throws(() => runnerLabels(bad), /QUALIFY_RUNNER/);
  assert.equal(sameRunnerSet(['self-hosted', 'Qualify-Pool'], ['self-hosted', 'qualify-pool']), true);
  assert.equal(sameRunnerSet(['self-hosted', 'other-pool'], ['self-hosted', 'Linux', 'qualify-pool']), false);
  assert.equal(sameRunnerSet(['self-hosted', 'other-pool'], ['self-hosted']), true);
  assert.equal(sameRunnerSet(['ubuntu-latest'], ['self-hosted']), false);
});

test('before: quiet only when declared, no other job or Soul server, load settled', () => {
  const ok = { declared: true, jobs: [], otherSouls: 0, loadPerCore: 0.05 };
  assert.deepEqual(decideBefore(ok), { quiet: true, reasons: [] });
  for (const [o, re] of [[{ declared: false }, /did not declare/], [{ jobs: [{ run: 7 }] }, /other job/], [{ jobs: null }, /could not be read/], [{ otherSouls: 2 }, /2 other Soul server/],
    [{ otherSouls: null }, /could not be counted/], [{ loadPerCore: LOAD_PER_CORE_MAX }, /did not settle/], [{ loadPerCore: null }, /unknown/]]) {
    const d = decideBefore({ ...ok, ...o }); assert.equal(d.quiet, false); assert.match(d.reasons.join('\n'), re); assert.equal(d.reasons.length, 1);
  }
  // every failing reason is kept, not only the first
  assert.equal(decideBefore({ declared: false, jobs: [{}], otherSouls: 1, loadPerCore: 3 }).reasons.length, 4);
});

test('after: overlap or a bench-counted Soul server downgrades a quiet run', () => {
  assert.deepEqual(decideAfter({ quietBefore: true, jobs: [], benchOtherSouls: 0 }), { quiet: true, reasons: [] });
  assert.equal(decideAfter({ quietBefore: true, jobs: [{ run: 7 }], benchOtherSouls: 0 }).quiet, false);
  assert.equal(decideAfter({ quietBefore: true, jobs: [], benchOtherSouls: 1 }).quiet, false);
  assert.equal(decideAfter({ quietBefore: true, jobs: null, benchOtherSouls: 0 }).quiet, false);
  assert.equal(decideAfter({ quietBefore: false, jobs: [], benchOtherSouls: 0 }).quiet, false);
});

test('scrub: paths verbatim, names as whole words, short values ignored', () => {
  const s = scrub('/srv/w/souls/x at /home/runner1 on boxhost; boxhosted; ab', { paths: [['/srv/w/souls', '.'], ['/home/runner1', '~'], ['ab', 'X']], names: [['boxhost', '<host>'], ['ab', '<user>']] });
  assert.equal(s, './x at ~ on <host>; boxhosted; ab');
});

function fixture({ token = 'tok-FAKE-fixture-0000', leak = false, otherSouls = 0 } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'cq-')), r = join(out, 'even-r1');
  mkdirSync(join(r, 'souls', 's0'), { recursive: true }); mkdirSync(join(r, 'launcher'), { recursive: true });
  writeFileSync(join(r, 'souls', 's0', '.eden-agent.json'), JSON.stringify({ token }));
  writeFileSync(join(r, 'launcher', 'worlds.json'), '{}'); writeFileSync(join(r, 'ops.jsonl'), '{}\n'); writeFileSync(join(r, 'launcher.log'), 'log\n'); writeFileSync(join(out, 'meetup.log'), 'log\n');
  writeFileSync(join(out, 'VERDICT.md'), `# verdict\nran under ${out}\n`); writeFileSync(join(out, 'summary.json'), '{"verdict":{}}');
  writeFileSync(join(r, 'REPORT.md'), 'report'); writeFileSync(join(r, 'receipt.json'), '{}');
  writeFileSync(join(r, 'result.json'), JSON.stringify({ load: { otherSoulsProcessesBefore: otherSouls, otherSoulsProcessesAfter: 0 }, note: leak ? token : 'none' }));
  return out;
}
const Q = { inputs: { hostClass: 'maintainer-self-hosted' }, before: { quiet: true, reasons: [] }, after: { quiet: true, reasons: [] } };

test('stage: allowlist only, scrubbed, with the executor header', () => {
  const out = fixture(), dest = join(out, 'artifact');
  const copied = stage({ out, dest, qualify: Q, scrubWith: { paths: [[out, '.']], names: [] } });
  assert.deepEqual(copied.sort(), ['VERDICT.md', 'even-r1/REPORT.md', 'even-r1/receipt.json', 'even-r1/result.json', 'qualify.json', 'summary.json']);
  for (const f of ['even-r1/souls', 'even-r1/launcher', 'even-r1/ops.jsonl', 'even-r1/launcher.log', 'meetup.log']) assert.ok(!existsSync(join(dest, f)), f);
  const v = readFileSync(join(dest, 'VERDICT.md'), 'utf8');
  assert.match(v, /self-hosted runner, host class `maintainer-self-hosted`. Quiet before: yes; after: yes/);
  assert.ok(!v.includes(out) && v.includes('ran under .'));
  assert.doesNotMatch(v, /NOT QUIET/);
  rmSync(out, { recursive: true });
});

test('stage: a quiet run that failed the re-check gets the banner', () => {
  const out = fixture({ otherSouls: 1 }), dest = join(out, 'artifact');
  assert.equal(benchOtherSouls(out), 1);
  stage({ out, dest, qualify: { ...Q, after: { quiet: false, reasons: ['the bench counted 1 other Soul server process(es) before or after a run'] } }, scrubWith: { paths: [], names: [] } });
  const v = readFileSync(join(dest, 'VERDICT.md'), 'utf8');
  assert.match(v, /NOT QUIET after the fact/); assert.match(v, /after: no/); assert.match(v, /1 other Soul server/);
  rmSync(out, { recursive: true });
});

test('stage: refuses when a staged file holds a Soul token', () => {
  const out = fixture({ leak: true });
  assert.throws(() => stage({ out, dest: join(out, 'artifact'), qualify: Q, scrubWith: { paths: [], names: [] } }), /even-r1\/result.json holds a Soul token/);
  rmSync(out, { recursive: true });
});

test('CW8 A2 (#955): active_min and telemetry pass through; without them the argument list is exactly today\'s', () => {
  const today = ['--profile', 'even,meetup', '--repeats', '2', '--host-class', 'maintainer-self-hosted', '--out', 'o', '--port', '4460', '--range', '4461-4490', '--quiet-host', '--qualifying-executor'];
  assert.deepEqual(benchArgs(parseInputs(ENV), true, 'o'), today);
  assert.deepEqual(benchArgs(parseInputs({ ...ENV, INPUT_ACTIVE_MIN: undefined, INPUT_TELEMETRY: undefined }), true, 'o'), today);
  const long = parseInputs({ ...ENV, INPUT_PROFILE: 'meetup', INPUT_REPEATS: '1', INPUT_ACTIVE_MIN: '60', INPUT_TELEMETRY: 'true' });
  assert.deepEqual([long.activeMin, long.telemetry], [60, true]);
  assert.deepEqual(benchArgs(long, true, 'o').slice(-3), ['--active-min', '60', '--telemetry']);
  assert.equal(parseInputs({ ...ENV, INPUT_ACTIVE_MIN: '20' }).activeMin, 20, '4 runs of 20 min fit');
  assert.equal(parseInputs({ ...ENV, INPUT_REPEATS: '1', INPUT_ACTIVE_MIN: '60' }).activeMin, 60, 'both profiles once: (60 + 15) x 2 = 150');
  for (const v of ['19', '241', '60.5', '060', 'sixty', '60 --short'])
    assert.throws(() => parseInputs({ ...ENV, INPUT_PROFILE: 'meetup', INPUT_REPEATS: '1', INPUT_ACTIVE_MIN: v }), /active_min/, v);
  assert.throws(() => parseInputs({ ...ENV, INPUT_ACTIVE_MIN: '60' }), /active_min="60".*fits the 300 min job/, 'even,meetup x2 at 60 min: (75) x 4 = 300 > 280');
  assert.throws(() => parseInputs({ ...ENV, INPUT_SHORT: 'true', INPUT_ACTIVE_MIN: '60', INPUT_PROFILE: 'meetup', INPUT_REPEATS: '1' }), /active_min.*short/);
  assert.throws(() => parseInputs({ ...ENV, INPUT_TELEMETRY: 'yes' }), /telemetry/);
});
