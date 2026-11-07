// Soul Runs diagnostics (#752): opt-in trace attachment to the scripted-owner controller path, capability recording,
// isolation, receipt linkage and correlation. Develops against fixtures because the upstream capture (#757) and
// inspector (#758) are not merged on this base: a FIXTURE tap that writes soul-trace/1 process records, and a FIXTURE
// readout that returns a reconstruction in the shape #757's readout documents. Real attachment is proven separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDiagnostics, attachTrace, attachReports, collectReports, reportDisagreements, traceLaunch, summarizeTraces, checkTap, correlateRun, traceCapability, TRACE, REPORTS } from './diagnostics.mjs';
import { actOutput, receiptOutcome } from './controllability.mjs';
import { createSeat } from '../arena/seat.mjs';
import { validateSpec } from './spec.mjs';
import { startRun } from './lifecycle.mjs';
import { turn } from '../arena/adapters/scripted-owner.mjs';
import { wakeText } from '../arena/seat.mjs';

// FIXTURE tap: like #757's, a no-op without SOUL_TRACE_FILE; with it, one proc.start (with run/seat) and one proc.end.
const FIXTURE_TAP = `import { appendFileSync } from 'node:fs';
const f = process.env.SOUL_TRACE_FILE;
if (f) { const proc = Math.random().toString(36).slice(2, 10), cmd = process.argv[2] ?? null;
  appendFileSync(f, JSON.stringify({ v: 1, kind: 'proc.start', proc, seq: 1, at: Date.now(), mono: 0, command: cmd, run: process.env.SOUL_TRACE_RUN, seat: process.env.SOUL_TRACE_SEAT }) + '\\n');
  process.on('exit', (c) => appendFileSync(f, JSON.stringify({ v: 1, kind: 'proc.end', proc, seq: 2, at: Date.now(), mono: 1, exitCode: c, stats: { dropped: 0, truncated: 0, sinkFailures: 0, inFlightAtExit: 0 } }) + '\\n')); }`;
// FIXTURE readout: the reconstruction fields correlate reads (episodes, processes, anomalies, unlinked).
const FIXTURE_READOUT = `export function reconstruct(text) {
  const recs = text.split('\\n').filter(Boolean).map((l) => JSON.parse(l)), starts = recs.filter((r) => r.kind === 'proc.start');
  return { schema: 'soul-trace/1', replay: false, records: recs.length, anomalies: [], unlinked: [],
    processes: starts.map((s) => ({ proc: s.proc, command: s.command, run: s.run ?? null, seat: s.seat ?? null, closed: true })),
    episodes: [{ origin: { kind: 'owner-message', id: 'msg_2', sentAt: 1 }, deliveredAt: 2, deliveredBy: 'p0', firstCommand: { command: 'ack', at: 3, proc: 'p1' }, inbox: [{ id: 'msg_2', verb: 'ack', status: 200, at: 3 }],
      acts: [{ op: 'op-1', link: 'world', attempts: [{ attempt: 1, status: 200, accepted: true, durationMs: 50, at: 4 }], outcome: 'accepted', code: null, receipt: { id: 'r-msg_2', capability: 'walk:lab-pond-hall', terminal: 'completed', ticks: { accepted: 10, started: 10, ended: 40 } } }] }] };
}`;
function toolsRoot({ tap = FIXTURE_TAP, readout = FIXTURE_READOUT, inspector = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sr-diag-root-'));
  mkdirSync(join(root, 'tools/soul-trace'), { recursive: true });
  if (tap) writeFileSync(join(root, TRACE.tap), tap);
  if (readout) writeFileSync(join(root, TRACE.readout), readout);
  if (inspector) writeFileSync(join(root, TRACE.inspector), 'export async function startInspector() { throw new Error("fixture"); }');
  return root;
}
const seats = [{ id: 'bo', adapter: 'scripted-owner', soulName: 'Bo' }, { id: 'pip', adapter: 'codex-headless', soulName: 'Pip' }];

test('diagnostics are off unless asked; a request is checked against seats, the supported adapter and availability', () => {
  const root = toolsRoot();
  assert.deepEqual(validateDiagnostics(undefined, seats, { root }), { errors: [], effective: null });
  assert.deepEqual(validateDiagnostics({ trace: false }, seats, { root }).effective, null);
  const codes = (d, r = root) => validateDiagnostics(d, seats, { root: r }).errors.map((e) => e.code);
  assert.deepEqual(codes({ trace: ['zed'] }), ['diagnostics.seat']);
  assert.deepEqual(codes({ trace: ['pip'] }), ['diagnostics.unsupported-adapter'], 'a live agent seat cannot be given the preload');
  assert.deepEqual(codes({ trace: true, view: true }), ['diagnostics.unknown-field', 'diagnostics.unsupported-adapter']);
  assert.deepEqual(codes({ trace: ['bo'] }, toolsRoot({ tap: null })), ['diagnostics.unavailable'], 'requested but not delivered is refused, not silently off');
  const ok = validateDiagnostics({ trace: ['bo'] }, seats, { root });
  assert.deepEqual(ok.effective.trace.seats, ['bo']);
  assert.equal(ok.effective.trace.contract, 'soul-trace/1');
  assert.match(ok.effective.trace.tap.sha256, /^[0-9a-f]{16}$/, 'capability and version are recorded');
  const none = traceCapability({ root: toolsRoot({ tap: null, readout: null, inspector: false }) });
  assert.equal(none.available, false); assert.match(none.reason, /#757/); assert.match(none.inspectorReason, /#758/);
});

test('the spec carries the request; this checkout without the upstream tap refuses it with the owner named', () => {
  const s = { soulRun: 1, scenario: 'tools/playtest/scenarios/soul-runs/hamlet-trio.json', diagnostics: { trace: ['bo'] } };
  const here = validateSpec(s, { toolsRoot: toolsRoot({ tap: null }) });
  assert.deepEqual(here.errors.map((e) => e.code), ['diagnostics.unavailable']);
  const withTap = validateSpec(s, { toolsRoot: toolsRoot() });
  assert.equal(withTap.ok, true, JSON.stringify(withTap.errors));
  assert.deepEqual(withTap.effective.diagnostics.trace.seats, ['bo']);
  assert.equal(validateSpec({ ...s, diagnostics: undefined }).effective.diagnostics, undefined, 'off adds nothing to the effective spec');
});

test('a traced scripted-owner seat runs the same commands with the same outputs; only its processes get the preload', async () => {
  const root = toolsRoot();
  const STANDIN = `import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2); appendFileSync('calls.jsonl', JSON.stringify({ a, traced: 'SOUL_TRACE_FILE' in process.env }) + '\\n');
console.log(JSON.stringify(a[0] === 'act' ? { accepted: true, receipt: { id: 'r1', phase: 'completed' }, for: a[1] } : { ok: true, cmd: a[0] }));`;
  const script = { rules: [{ match: 'pond', do: [['act', 'walk to the pond', '--wait', '30']], result: 'At the pond' }] };
  const play = async (diagnostics) => {
    const d = mkdtempSync(join(tmpdir(), 'sr-diag-seat-')); writeFileSync(join(d, 'eden.mjs'), STANDIN);
    const r = await turn({ cwd: d, text: wakeText('node eden.mjs listen', JSON.stringify({ messages: [{ id: 'm1', text: 'go to the pond' }] })), script, diagnostics });
    return { d, r, calls: readFileSync(join(d, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) };
  };
  const off = await play(null);
  const runDir = mkdtempSync(join(tmpdir(), 'sr-diag-run-'));
  const scenario = { seats: structuredClone(seats) };
  const eff = validateDiagnostics({ trace: ['bo'] }, seats, { root }).effective;
  const section = attachTrace(scenario, { effective: eff, runId: 'run-1', runDir, root });
  assert.equal(scenario.seats[1].diagnostics, undefined, 'untraced seats are untouched');
  const on = await play(scenario.seats[0].diagnostics);
  assert.deepEqual(on.calls.map((c) => c.a), off.calls.map((c) => c.a), 'same commands in the same order');
  assert.deepEqual(on.r.stream.filter((e) => e.type === 'user').map((e) => e.message.content[0].content), off.r.stream.filter((e) => e.type === 'user').map((e) => e.message.content[0].content), 'same outputs');
  assert.ok(off.calls.every((c) => !c.traced), 'off: no trace environment at all');
  assert.ok(on.calls.every((c) => c.traced));
  assert.deepEqual(traceLaunch(null), { pre: [], env: undefined });
  const sum = summarizeTraces(runDir, section).bo;
  assert.equal(sum.present, true); assert.equal(sum.file, 'diagnostics/bo.trace.jsonl');
  assert.equal(sum.processes, 3); assert.equal(sum.closed, 3);
  assert.deepEqual(sum.ids, { run: ['run-1'], seat: ['bo'] }, 'the trace carries the run and seat ids it was given');
  assert.deepEqual(sum.commands, { ack: 1, act: 1, result: 1 });
  assert.equal(section.viewer.startedByRun, false); assert.equal(section.analysis.startedByRun, false);
  assert.match(section.sharing, /never a publication input/);
});

test('a preload that does not load is refused before play; the fixture tap loads with capture off', async () => {
  assert.equal((await checkTap({ root: toolsRoot() })).ok, true);
  const bad = await checkTap({ root: toolsRoot({ tap: 'throw new Error("broken tap")' }) });
  assert.equal(bad.ok, false); assert.match(bad.error, /broken tap|Error/);
});

test('a run with diagnostics links its trace from the receipt; diagnostics off writes no diagnostics at all', async () => {
  const root = toolsRoot(), out = mkdtempSync(join(tmpdir(), 'sr-diag-life-')), serverRoot = join(out, 'root');
  for (const f of ['apps/server/src/main.ts', 'apps/web/dist/index.html', 'tools/world-launcher/soul/eden.mjs', 'g.json']) { mkdirSync(join(serverRoot, f, '..'), { recursive: true }); writeFileSync(join(serverRoot, f), '{}'); }
  const scenarioFile = join(out, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify({ name: 'diag-fixture', version: 1, seed: 1, providers: { allowed: [] }, world: { kind: 'dev', genesis: 'g.json', slug: 'pt-diag', port: 43391 }, durationSec: 10,
    seats: [{ id: 'bo', adapter: 'scripted-owner', soulName: 'Bo', script: { rules: [{ match: 'x', do: [['here']] }] } }], god: null, director: { mode: 'scripted', sequential: false, script: [{ seat: 'bo', atSec: 1, channel: 'card', text: 'x', budgetSec: 5 }] },
    observer: { cameras: [], viewport: [1280, 800] }, review: { mode: 'deterministic', developer: false }, rails: {} }));
  let seen = null;
  const execute = async ({ scenarioFile: f }) => { seen = JSON.parse(readFileSync(f, 'utf8')); const t = seen.seats[0].diagnostics?.trace; if (t) writeFileSync(t.file, JSON.stringify({ v: 1, kind: 'proc.start', proc: 'p', seq: 1, command: 'here', run: t.run, seat: t.seat }) + '\n'); return 0; };
  const base = { soulRun: 1, scenario: scenarioFile, observer: { check: false } };
  const on = await startRun({ spec: { ...base, world: { port: 43392 }, diagnostics: { trace: ['bo'] } }, serverRoot, outDir: join(out, 'on'), execute, toolsRoot: root, tapCheck: async () => ({ ok: true, ms: 1 }) });
  assert.equal(on.status, 'completed', JSON.stringify(on.errors ?? on.reason));
  assert.equal(seen.seats[0].diagnostics.trace.run, on.runId);
  assert.equal(on.diagnostics.capture.seats.bo.file, 'diagnostics/bo.trace.jsonl');
  assert.equal(on.diagnostics.capture.result.bo.records, 1);
  assert.equal(on.preflight.diagnostics.ok, true);
  const off = await startRun({ spec: { ...base, world: { port: 43393 } }, serverRoot, outDir: join(out, 'off'), execute, toolsRoot: root, tapCheck: async () => assert.fail('off never checks the tap') });
  assert.equal(off.status, 'completed');
  assert.equal(off.diagnostics, undefined); assert.equal(seen.seats[0].diagnostics, undefined); assert.equal(off.preflight.diagnostics, undefined);
  assert.equal(existsSync(join(out, 'off', 'diagnostics')), false);
  const refused = await startRun({ spec: { ...base, world: { port: 43394 }, diagnostics: { trace: ['bo'] } }, serverRoot, outDir: join(out, 'bad'), execute, toolsRoot: root, tapCheck: async () => ({ ok: false, error: 'SyntaxError' }) });
  assert.equal(refused.status, 'refused'); assert.deepEqual(refused.errors.map((e) => e.code), ['diagnostics.tap']);
  assert.equal(existsSync(join(out, 'bad')), false, 'refused before anything was created');
});

test('correlation joins run, seat, owner message, seat turn and receipt stages without equating them, and names gaps', async () => {
  const root = toolsRoot(), runDir = mkdtempSync(join(tmpdir(), 'sr-diag-corr-')), p = join(runDir, 'playtest');
  const t0 = Date.parse('2026-11-04T08:00:00Z'), iso = (s) => new Date(t0 + s * 1000).toISOString();
  const w = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
  w(join(p, 'receipts/7-report.json'), { ok: true }); w(join(p, 'scenario.json'), { seats: [{ id: 'bo', adapter: 'scripted-owner' }], director: { script: [] } });
  w(join(p, 'personas/bo/decisions.jsonl'), [{ t: iso(0), delivered: { requestId: 'bo-001', messageId: 'msg_1', channel: 'card' }, scripted: { text: 'a' } }, { t: iso(9), delivered: { requestId: 'bo-002', messageId: 'msg_2', channel: 'card' }, scripted: { text: 'b' } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  w(join(p, 'personas/bo/requests.jsonl'), '');
  w(join(p, 'seats/bo/seat.json'), { id: 'bo', adapter: 'scripted-owner' });
  const use = (i, sec, cmd, out) => [{ type: 'assistant', turn: 3, _rx: t0 + sec * 1000, message: { content: [{ type: 'tool_use', id: `t${i}`, input: { command: cmd } }] } }, { type: 'user', turn: 3, _rx: t0 + sec * 1000 + 20, message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: JSON.stringify(out) }] } }];
  w(join(p, 'seats/bo/transcript.jsonl'), [...use(1, 9.1, 'node eden.mjs ack msg_2 "ok"', { acked: 'msg_2' }), ...use(2, 9.2, 'node eden.mjs act "walk" --wait 9', { accepted: true, receipt: { id: 'r-msg_2', capability: 'walk:lab-pond-hall', phase: 'completed' }, for: 'msg_2' })].map((x) => JSON.stringify(x)).join('\n') + '\n');
  w(join(runDir, 'diagnostics/bo.trace.jsonl'), JSON.stringify({ v: 1, kind: 'proc.start', proc: 'p1', seq: 1, command: 'ack', run: 'run-x', seat: 'bo' }) + '\n');
  w(join(runDir, 'run-receipt.json'), { runId: 'run-x', status: 'completed', diagnostics: { capture: { tap: { path: TRACE.tap, sha256: 'f' }, seats: { bo: { file: 'diagnostics/bo.trace.jsonl', run: 'run-x', seat: 'bo' } } } } });
  const c = await correlateRun(runDir, { root });
  assert.equal(c.replay, false);
  const [r1, r2] = c.seats.bo.requests;
  assert.equal(r2.messageId, 'msg_2'); assert.equal(r2.run, 'run-x'); assert.equal(r2.trace.deliveredAt, 2);
  assert.deepEqual(r2.stages, [{ receipt: 'r-msg_2', capability: 'walk:lab-pond-hall', ackedByOwnerCard: true, admitted: 'accepted', acceptedTick: 10, startedTick: 10, endedTick: 40, terminal: 'completed' }]);
  assert.match(r2.seatTranscript.refs.join(' '), /transcript\.jsonl:1/);
  assert.equal(r2.missing.length, 0);
  assert.deepEqual(r1.missing, ['no traced delivery of this owner message (listen not traced, killed, or capture lost)', 'no ack in the seat transcript'], 'gaps are named, not filled');
  assert.equal(c.seats.bo.foreignProcesses, 0);
  assert.equal((await correlateRun(runDir, { root: toolsRoot({ readout: null }) })).analysis, 'unavailable');
});

// #590 A17: experience reports on every seat, triangulated against the run's own records.
function reportsRoot(on = true) { const root = toolsRoot(); mkdirSync(join(root, 'tools/world-launcher/soul'), { recursive: true }); writeFileSync(join(root, REPORTS.cli), on ? `const REPORT_ON = "${REPORTS.switchFile}";` : '// an older client'); return root; }

test('reports: off adds nothing; on takes any kind of seat, or a list; a client without them is refused', () => {
  assert.deepEqual(validateDiagnostics(undefined, seats, { root: reportsRoot() }), { errors: [], effective: null });
  assert.deepEqual(validateDiagnostics({ reports: false }, seats, { root: reportsRoot() }), { errors: [], effective: null });
  assert.deepEqual(validateDiagnostics({ reports: true }, seats, { root: reportsRoot() }).effective, { reports: { seats: ['bo', 'pip'] } }, 'a live seat needs no preload');
  assert.deepEqual(validateDiagnostics({ reports: ['pip'] }, seats, { root: reportsRoot() }).effective, { reports: { seats: ['pip'] } });
  assert.deepEqual(validateDiagnostics({ reports: ['nobody'] }, seats, { root: reportsRoot() }).errors.map((e) => e.code), ['diagnostics.seat']);
  assert.deepEqual(validateDiagnostics({ reports: true }, seats, { root: reportsRoot(false) }).errors.map((e) => e.code), ['diagnostics.reports-unavailable']);
  const both = validateDiagnostics({ trace: ['bo'], reports: ['pip'] }, seats, { root: reportsRoot() }).effective;
  assert.deepEqual([both.trace.seats, both.reports.seats], [['bo'], ['pip']]);
});

test('reports: the seat gets the switch only when asked, and the run copies the report out of its folder', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'sr-reports-')), scenario = { seats: seats.map((s) => ({ ...s })) };
  assert.equal(attachReports(scenario, { effective: null }), null);
  const section = attachReports(scenario, { effective: { reports: { seats: ['bo'] } } });
  assert.deepEqual(scenario.seats.map((s) => s.diagnostics?.reports ?? false), [true, false]);
  const [bo, pip] = scenario.seats.map((seat) => createSeat({ runDir: join(runDir, 'playtest'), seat, worldBase: 'https://example.test/w/x', rails: {} }));
  assert.equal(existsSync(join(bo.folder, REPORTS.switchFile)), true); assert.equal(existsSync(join(pip.folder, REPORTS.switchFile)), false);
  writeFileSync(join(bo.folder, REPORTS.file), [JSON.stringify({ kind: 'http', route: '/v1/edge/here' }), JSON.stringify({ kind: 'note', annotation: 'agent' })].join('\n') + '\n');
  const result = collectReports(runDir, join(runDir, 'playtest'), section);
  assert.equal(result.bo.present, true); assert.deepEqual([result.bo.records, result.bo.http, result.bo.notes], [2, 1, 1]);
  assert.equal(existsSync(join(runDir, 'diagnostics/bo.report.jsonl')), true);
  const none = collectReports(runDir, join(runDir, 'playtest'), { seats: { pip: { file: 'diagnostics/pip.report.jsonl' } } });
  assert.equal(none.pip.present, false, 'a seat whose client wrote nothing says so');
});

test('reports: every kind of disagreement is listed, with both sides, and agreement lists none', () => {
  const row = (facts) => ({ kind: 'http', route: '/v1/edge/act', facts }), act = (out) => ({ verb: 'act', args: [], out });
  const rows = [row({ accepted: true, receipt: { id: 'r1', phase: 'started' } }), row({ accepted: false, code: 'capability.unknown' }), row({ accepted: true, receipt: { id: 'r2', phase: 'started' } })];
  const same = [act({ accepted: true, receipt: { id: 'r1', phase: 'started' } }), act({ accepted: false, code: 'capability.unknown' }), act({ accepted: true, receipt: { id: 'r2', phase: 'started' } })];
  const check = (o) => reportDisagreements({ seat: 'bo', rows, steps: same, actOutput, receiptOutcome, ...o });
  assert.deepEqual(check({}), []);
  const card = { intentions: [{ seat: 'bo', acts: [{ state: 'accepted', receipt: 'r1' }, { state: 'refused' }, { state: 'accepted', receipt: 'r2' }] }, { seat: 'other', acts: [{ state: 'refused' }] }] };
  assert.deepEqual(check({ card }), [], 'the scorecard counts only this seat');
  const kinds = (o) => check(o).map((d) => d.kind);
  assert.deepEqual(kinds({ steps: same.slice(0, 2) }), ['receipt.report-only'], 'a plan step the seat never saw');
  assert.deepEqual(kinds({ rows: rows.slice(0, 2) }), ['receipt.transcript-only']);
  assert.deepEqual(check({ steps: [same[0], same[2]] }).map((d) => [d.kind, d.report, d.transcript]), [['refusals.count', 1, 0]]);
  const ended = [...same, { verb: 'receipt', args: ['r1'], out: { phase: 'completed' } }];
  assert.deepEqual(check({ steps: ended }).map((d) => [d.kind, d.report, d.world]), [['receipt.outcome', 'started', 'completed']]);
  assert.deepEqual(kinds({ card: { intentions: [] } }), ['scorecard.accepted', 'scorecard.refused']);
});

