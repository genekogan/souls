// #371 PR 2 (H-a, H-f, H-i): per-request window validity, the scripted schedule rule, and the server root's HEAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { windowTickRate, windowValidity } from './tick-validity.mjs';
import { scheduleProblems, fitDuration, QUEUE_SLACK_SEC } from './lib/schedule.mjs';
import { serverRootState } from './lib/server-root.mjs';
import { runOracles } from './review/oracles.mjs';
import { loadRun } from './review/run.mjs';
import { computeMetrics } from './review/metrics.mjs';
import { reportRun, serverRootLine, replayToScenario } from './review/report.mjs';
import { rescoreRun } from './review/rescore-oracles.mjs';
import { readJson, writeJson } from './lib/jsonl.mjs';
import { cmdRun } from './playtest.mjs';
import { FIX, MAIN, copyRuns } from './review/test/helpers.mjs';

const T0 = Date.parse('2026-11-05T12:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const pack = (rate, { secs = [0, 10, 20, 30], cutoffSec = 30, ...extra } = {}) => ({ requestId: 'q', seat: 'pip', channel: 'card', text: 'sit down', sentAt: at(0), cutoffAt: at(cutoffSec), cutoffReason: 'result', budgetSec: 90, samples: secs.map((s) => ({ t: at(s), tick: 1000 + Math.round(s * rate), posture: 'standing' })), ...extra });

test('V1: the window rate comes from the request\'s own samples; below 15 ticks/s is stalled; too few samples is not judged', () => {
  assert.equal(windowTickRate(pack(20)), 20);
  assert.equal(windowValidity(pack(20)).scorable, true);
  const stalled = windowValidity(pack(4));
  assert.deepEqual({ scorable: stalled.scorable, rate: stalled.rate, reason: stalled.reason }, { scorable: false, rate: 4, reason: 'stalled' });
  assert.equal(stalled.detail, 'unscorable (world stalled): 4 ticks/s in the request window');
  assert.equal(windowValidity(pack(15)).scorable, true, '15 ticks/s is not below the bound');
  // samples outside sentAt..cutoffAt do not count
  assert.equal(windowTickRate(pack(4, { secs: [-30, 0, 10, 60], cutoffSec: 10 })), 4);
  assert.equal(windowTickRate(pack(4, { secs: [0] })), null, 'one sample');
  assert.equal(windowTickRate(pack(4, { secs: [0, 1.5] })), null, 'two samples under 2 s apart');
  assert.equal(windowValidity(pack(4, { secs: [0, 1.5] })).scorable, true, 'not judged → nothing changes');
  assert.equal(windowTickRate({ ...pack(20), samples: [{ t: at(0) }, { t: at(10) }] }), null, 'samples without ticks');
});

test('V1: a stalled window turns every oracle row unscorable and keeps the verdict it would have had', () => {
  const run = loadRun(join(FIX, MAIN));
  const ev = structuredClone(run.evidence.find((e) => e.requestId === 'r1'));
  const healthy = runOracles(ev, { run });
  assert.ok(healthy.every((r) => r.status !== 'unscorable'), 'the fixture ticks at 20/s');
  const t0 = ev.samples[0].tick, m0 = Date.parse(ev.samples[0].t);
  ev.samples = ev.samples.map((s) => ({ ...s, tick: t0 + Math.round(((Date.parse(s.t) - m0) / 1000) * 3) }));
  const rows = runOracles(ev, { run });
  assert.equal(rows.length, healthy.length);
  for (const [i, r] of rows.entries()) {
    assert.equal(r.status, 'unscorable'); assert.equal(r.unscorable, 'stalled'); assert.equal(r.windowTickRate, 3);
    assert.equal(r.detail, 'unscorable (world stalled): 3 ticks/s in the request window');
    assert.deepEqual(r.wouldBe, { status: healthy[i].status, detail: healthy[i].detail }); assert.equal(r.id, healthy[i].id);
  }
});

test('V4: a window the run end or a quota stop cut before its budget is unscorable (truncated); one past its budget is not', () => {
  const cut = windowValidity(pack(20, { cutoffReason: 'run-end', budgetSec: 90 }));
  assert.deepEqual({ scorable: cut.scorable, reason: cut.reason, detail: cut.detail }, { scorable: false, reason: 'truncated', detail: 'unscorable (window truncated by run end)' });
  assert.equal(windowValidity(pack(20, { cutoffReason: 'quota', budgetSec: 90 })).reason, 'truncated');
  assert.equal(windowValidity(pack(20, { cutoffReason: 'run-end', budgetSec: 25 })).scorable, true, 'budget had elapsed');
  assert.equal(windowValidity(pack(20, { cutoffReason: 'run-end', budgetSec: 40, budgetStartAt: at(-15) })).scorable, true, 'the budget clock starts at budgetStartAt');
  assert.equal(windowValidity(pack(20, { cutoffReason: 'budget', budgetSec: 90 })).scorable, true, 'only run-end and quota truncate');
  const run = loadRun(join(FIX, MAIN));
  const ev = { ...structuredClone(run.evidence.find((e) => e.requestId === 'r3')), cutoffReason: 'run-end', budgetSec: 180 }; // cut 90 s into a 180 s budget
  const rows = runOracles(ev, { run });
  assert.ok(rows.every((r) => r.status === 'unscorable' && r.unscorable === 'truncated' && r.detail === 'unscorable (window truncated by run end)'));
  assert.ok(rows.some((r) => r.wouldBe.status === 'fail'), 'r3 had fails; they are kept as wouldBe, not counted');
});

test('V1/V2/V4/V6: metrics count unscorable windows as neither pass nor fail; the report header prints the rate, the counts and both heads; rescore keeps the status', () => {
  const { main } = copyRuns();
  const r1 = join(main, 'evidence/r1.json'), e1 = readJson(r1);
  const t0 = e1.samples[0].tick, m0 = Date.parse(e1.samples[0].t);
  e1.samples = e1.samples.map((s) => ({ ...s, tick: t0 + Math.round(((Date.parse(s.t) - m0) / 1000) * 2) }));
  writeJson(r1, e1);
  const r3 = join(main, 'evidence/r3.json'); writeJson(r3, { ...readJson(r3), cutoffReason: 'run-end', budgetSec: 180 });
  writeJson(join(main, 'world.json'), { ...readJson(join(main, 'world.json'), {}), serverRoot: { headAtStart: 'a'.repeat(40), dirtyAtStart: false, headAtEnd: 'b'.repeat(40), dirtyAtEnd: true } });
  const run = loadRun(main);
  const m = computeMetrics(run);
  assert.equal(m.uptime.unscorableStalled, 1); assert.equal(m.uptime.unscorableTruncated, 1);
  assert.equal(m.fidelity.truthfulnessPassRate, 1, 'only r2 is scorable, and it is truthful');
  assert.equal(m.physical.noProgress, 0, 'r3\'s no-progress fail is unscorable, not counted');
  reportRun(main);
  const md = readFileSync(join(main, 'REPORT.md'), 'utf8');
  assert.match(md, /\| Validity \| world [\d.]+ ticks\/s · request windows unscorable: 1 world stalled \(under 15 ticks\/s\), 1 truncated by run end or quota \|/);
  assert.match(md, /\| Server root \| start `aaaaaaaaaaaa` · end `bbbbbbbbbbbb` \(dirty\) · \*\*CHANGED during the run\*\* \|/);
  const re = rescoreRun(main);
  const rows = readFileSync(join(main, 'oracles.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(rows.filter((r) => r.requestId === 'r1').every((r) => r.status === 'unscorable'));
  assert.ok(rows.filter((r) => r.requestId === 'r2').every((r) => r.status !== 'unscorable'));
  assert.equal(re.truth, 1);
});

test('V5: serverRootLine reads unchanged, changed and missing records', () => {
  const h = 'c'.repeat(40);
  assert.equal(serverRootLine({ headAtStart: h, dirtyAtStart: false, headAtEnd: h, dirtyAtEnd: false }), 'start `cccccccccccc` · end `cccccccccccc`');
  assert.equal(serverRootLine({ headAtStart: h, dirtyAtStart: true }), 'start `cccccccccccc` (dirty) · end not recorded');
  assert.equal(serverRootLine(undefined), 'not recorded');
});

test('V5/V7: one git call reads HEAD and the dirty flag; outside a checkout both are null; the path is never returned', () => {
  const calls = [];
  const git = (out) => (args) => { calls.push(args); return out; };
  const sha = '0123456789abcdef0123456789abcdef01234567';
  assert.deepEqual(serverRootState('/r', { git: git(`# branch.oid ${sha}\n# branch.head main\n`) }), { head: sha, dirty: false });
  assert.deepEqual(serverRootState('/r', { git: git(`# branch.oid ${sha}\n# branch.head main\n1 .M N... 100644 100644 100644 x y apps/a.ts\n`) }), { head: sha, dirty: true });
  assert.deepEqual(serverRootState('/r', { git: git(`# branch.oid ${sha}\n? new.ts\n`) }), { head: sha, dirty: true });
  assert.deepEqual(serverRootState('/r', { git: git('# branch.oid (initial)\n') }), { head: null, dirty: false });
  assert.deepEqual(serverRootState('/r', { git: () => { throw new Error('not a git repository'); } }), { head: null, dirty: null });
  assert.equal(calls.length, 4); assert.deepEqual(calls[0], ['-C', '/r', 'status', '--porcelain=v2', '--branch']);
});

const scripted = (script, extra = {}) => ({ name: 's', durationSec: 300, seats: [{ id: 'pip' }], god: null, director: { mode: 'scripted', script }, ...extra });

test('V3: a scripted request that cannot finish inside the run is named; valid, persona and fitted scenarios pass', () => {
  assert.equal(QUEUE_SLACK_SEC, 15);
  assert.deepEqual(scheduleProblems(scripted([{ seat: 'pip', atSec: 10, text: 'sit', budgetSec: 90 }, { seat: 'pip', atSec: 195, text: 'stand', budgetSec: 90 }])), []);
  const bad = scheduleProblems(scripted([{ seat: 'pip', atSec: 10, text: 'sit', budgetSec: 90 }, { seat: 'pip', atSec: 196, text: 'go to the library', budgetSec: 90 }, { seat: 'pip', atSec: 250, text: 'wave' }]));
  assert.deepEqual(bad.map((p) => [p.index, p.endSec]), [[1, 301], [2, 445]], 'a missing budget uses the scenario default (180 s)');
  assert.match(bad[0].message, /^script\[1\] \(pip at 196 s, "go to the library"\): budget 90 s \+ 15 s slack ends at 301 s, after the run's 300 s$/);
  assert.match(scheduleProblems(scripted([{ seat: 'pip', text: 'wave', budgetSec: 10 }]))[0].message, /^script\[0\] \(pip, "wave"\): no numeric atSec$/);
  const god = scheduleProblems(scripted([{ seat: 'god', atSec: 10, text: 'build a hut' }], { god: { model: 'm' }, durationSec: 600 }));
  assert.equal(god[0].budgetSec, 600, 'a god request gets the god default');
  assert.deepEqual(scheduleProblems({ ...scripted([{ seat: 'pip', atSec: 299, text: 'x' }]), director: { mode: 'persona', script: [{ seat: 'pip', atSec: 299, text: 'x' }] } }), [], 'persona mode is unchanged');
  const fitted = fitDuration(scripted([{ seat: 'pip', atSec: 250.5, text: 'x', budgetSec: 90 }]));
  assert.equal(fitted.durationSec, 356); assert.deepEqual(scheduleProblems(fitted), []);
  assert.equal(fitDuration(scripted([{ seat: 'pip', atSec: 1, text: 'x', budgetSec: 90 }])).durationSec, 300, 'never shortened');
  const rp = { run: 'r', seed: 1, scenario: scripted([]), requests: [{ seat: 'pip', channel: 'card', text: 'x', sendOffsetSec: 290, budgetSec: 90 }] };
  assert.deepEqual(scheduleProblems(replayToScenario(rp)), [], 'a scripted replay is long enough for its requests');
});

test('V3: every scripted scenario and battery in tools/playtest fits its run', async () => {
  const { execFileSync } = await import('node:child_process');
  const here = new URL('.', import.meta.url).pathname;
  const files = execFileSync('git', ['-C', here, 'ls-files', '*.json'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  let n = 0;
  for (const f of files) {
    let j; try { j = JSON.parse(readFileSync(join(here, f), 'utf8')); } catch { continue; }
    for (const [label, s] of Array.isArray(j?.entries) ? j.entries.map((e) => [`${f}#${e.label}`, e.scenario]) : [[f, j]]) {
      if (s?.director?.mode !== 'scripted') continue; n++;
      assert.deepEqual(scheduleProblems(s).map((p) => p.message), [], label);
    }
  }
  assert.ok(n >= 10, `${n} scripted scenarios checked`);
  // Soul-run specs: the scenario each one executes (its cast and duration overrides applied)
  const { applyOverrides } = await import('./runs/spec.mjs');
  for (const f of files.filter((x) => x.startsWith('runs/specs/'))) {
    const spec = JSON.parse(readFileSync(join(here, f), 'utf8'));
    const scen = JSON.parse(readFileSync(join(here, 'runs/specs', spec.scenario), 'utf8'));
    assert.deepEqual(scheduleProblems(applyOverrides(scen, { cast: spec.cast ?? 'scenario', durationSec: spec.durationSec ?? null })).map((p) => p.message), [], f);
  }
});

test('V3: playtest.mjs run refuses a late script before preflight or provisioning, naming each entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-schedule-'));
  const file = join(dir, 'late.json');
  writeFileSync(file, JSON.stringify({ name: 'late', version: 1, seed: 1, providers: { allowed: ['codex'] }, world: { kind: 'dev', genesis: 'g.json', slug: 'pt-late', port: 4998 }, durationSec: 60, seats: [{ id: 'pip', adapter: 'codex-headless', model: 'm' }], god: null, observer: { cameras: [] }, director: { mode: 'scripted', script: [{ seat: 'pip', atSec: 1, channel: 'card', text: 'sit', budgetSec: 90 }] }, review: { mode: 'deterministic', developer: false } }));
  let provisioned = false, preflighted = false;
  const modules = { provision: { startWorld: async () => { provisioned = true; throw new Error('must not provision'); } } };
  const lines = []; const err = console.error; console.error = (...a) => lines.push(a.join(' '));
  let code; try { code = await cmdRun({ _: ['run', file], out: join(dir, 'out'), 'server-root': dir }, { modules, get preflight() { preflighted = true; return { ok: true }; } }); } finally { console.error = err; }
  assert.equal(code, 2); assert.equal(provisioned, false); assert.equal(preflighted, false);
  assert.equal(existsSync(join(dir, 'out')), false, 'no run folder');
  assert.ok(lines.some((l) => /schedule refused: script\[0\] \(pip at 1 s, "sit"\): budget 90 s \+ 15 s slack ends at 106 s, after the run's 60 s/.test(l)), lines.join('\n'));
});
