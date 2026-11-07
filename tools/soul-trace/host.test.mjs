// #733 S2: host-side boundaries (turn, tool call, spawn) in the same soul-trace/1 file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostRecorder} from './host.mjs';
import {reconstruct, render} from './readout.mjs';
import {SCHEMA} from './tap.mjs';

const HOST = fileURLToPath(new URL('./host.mjs', import.meta.url));
const T0 = 1_700_000_000_000;
const rec = (proc, seq, kind, at, mono, extra = {}) => ({v: SCHEMA, kind, proc, seq, at: T0 + at, mono, ...extra});
const lines = rs => rs.map(r => JSON.stringify(r)).join('\n') + '\n';

/** listen delivers m_1 at +1000; the host's turn/tool/spawn; the CLI ack process (tool c_1) starts and requests. */
function episode({turnAt = 1100, withTool = true, withSpawn = true, toolOnProc = 'c_1', forId = 'm_1'} = {}) {
  const L = 'aaaa', A = 'bbbb', H = 'host-1';
  const rs = [
    rec(L, 1, 'proc.start', 0, 5, {command: 'listen'}),
    rec(L, 2, 'http', 1000, 990, {method: 'GET', route: '/v1/edge/inbox/listen', startMono: 20, status: 200, facts: {messages: [{id: 'm_1', sentAt: T0 + 990, state: 'delivered'}]}}),
    rec(L, 3, 'proc.end', 1001, 996, {exitCode: 0, durationMs: 996, stats: {}}),
    rec(H, 1, 'host.turn', turnAt, 0, {phase: 'start', turn: 't_1', ...(forId ? {for: forId} : {})}),
  ];
  if (withTool) rs.push(rec(H, 2, 'host.tool', 3100, 2000, {phase: 'start', turn: 't_1', tool: 'c_1'}));
  if (withSpawn) rs.push(rec(H, 3, 'host.spawn', 3130, 2030, {tool: 'c_1'}));
  rs.push(
    rec(A, 1, 'proc.start', 3200, 40, {command: 'ack', timeOrigin: T0 + 3160, ...(toolOnProc ? {tool: toolOnProc, turn: 't_1'} : {})}),
    rec(A, 2, 'http', 3230, 70, {method: 'POST', route: '/v1/edge/inbox/m_1/ack', startMono: 52, status: 200, durationMs: 18, facts: {}}),
    rec(A, 3, 'proc.end', 3240, 80, {exitCode: 0, durationMs: 80, stats: {}}),
    rec(H, 4, 'host.tool', 3260, 2160, {phase: 'end', tool: 'c_1', exitCode: 0}),
    rec(H, 5, 'host.turn', 3300, 2200, {phase: 'end', turn: 't_1'}),
  );
  return rs;
}

test('a fully recorded host splits delivery → first request into named segments, exact inside one process', () => {
  const t = reconstruct(lines(episode()));
  const g = t.episodes[0].host;
  assert.equal(g.turn, 't_1'); assert.equal(g.tool, 'c_1'); assert.equal(g.command, 'ack');
  assert.deepEqual(g.segments.map(s => [s.from, s.to, s.ms, s.clock]), [
    ['delivered', 'turn.start', 100, 'local-wall≈'],
    ['turn.start', 'tool.start', 2000, 'process-monotonic'],
    ['tool.start', 'spawn', 30, 'process-monotonic'],
    ['spawn', 'proc.origin', 30, 'local-wall≈'],
    ['proc.origin', 'proc.start', 40, 'local-wall≈'],
    ['proc.start', 'first.request', 12, 'process-monotonic'],
  ]);
  assert.ok(g.segments.every(s => !/^unattributed/.test(s.label)));
  assert.equal(t.anomalies.filter(a => /^host|missing-start|unclosed/.test(a.type)).length, 0, JSON.stringify(t.anomalies));
  assert.equal(t.processes.length, 2, 'host records are not CLI processes');
  assert.equal(t.processes.find(p => p.command === 'ack').tool, 'c_1');
  const text = render(t);
  assert.match(text, /turn\.start → tool\.start {2}2000 ms {2}host reasoning before the tool call {2}\[process-monotonic\]/);
  assert.doesNotMatch(text, /unattributed \(reasoning/);
});

test('a missing boundary leaves an explicitly unattributed segment', () => {
  const g = reconstruct(lines(episode({withTool: false, withSpawn: false}))).episodes[0].host;
  // Without tool records the process cannot be linked to the turn, so only the turn start is attributed.
  assert.equal(g.tool, null);
  assert.deepEqual(g.segments.map(s => s.to), ['turn.start', 'first.command'], 'the first command stays visible');
  assert.equal(g.segments[1].ms, 2100);
  assert.match(g.segments[1].label, /^unattributed \(no tool call linked; `ack` found by time\)/);
  assert.match(render(reconstruct(lines(episode({withTool: false, withSpawn: false})))), /turn\.start → first\.command {2}2100 ms {2}unattributed/);
  const s = reconstruct(lines(episode({withSpawn: false}))).episodes[0].host.segments;
  assert.deepEqual(s.map(x => [x.from, x.to]), [['delivered', 'turn.start'], ['turn.start', 'tool.start'], ['tool.start', 'proc.origin'], ['proc.origin', 'proc.start'], ['proc.start', 'first.request']]);
  assert.match(s[2].label, /^unattributed \(no spawn recorded\)/);
});

test('a turn that began before the delivery is reported, never subtracted', () => {
  const g = reconstruct(lines(episode({turnAt: 400}))).episodes[0].host;
  assert.deepEqual(g.before, [{boundary: 'turn.start', msBeforeDelivery: 600}]);
  assert.equal(g.segments[0].from, 'delivered');
  assert.equal(g.segments[0].to, 'tool.start');
  assert.match(g.segments[0].label, /^host reasoning before the tool call \(from the delivery; turn\.start came before it\)/);
  assert.ok(g.segments.every(s => s.ms >= 0));
});

test('boundaries out of order across clocks are flagged as skew, not hidden', () => {
  const rs = episode().map(r => (r.kind === 'proc.start' && r.command === 'ack' ? {...r, timeOrigin: r.timeOrigin + 200} : r));
  const t = reconstruct(lines(rs));
  assert.ok(t.anomalies.some(a => a.type === 'host-clock-skew' && a.from === 'proc.origin' && a.to === 'proc.start' && a.ms < 0), JSON.stringify(t.anomalies));
});

test('links are by recorded ids only: an unknown tool, an unlinked turn and a missing tool are anomalies', () => {
  const t = reconstruct(lines(episode({toolOnProc: 'c_other'})));
  assert.ok(t.anomalies.some(a => a.type === 'host-tool-missing' && a.tool === 'c_other'));
  assert.equal(t.episodes[0].host.tool, null, 'never joined by nearby time');
  const u = reconstruct(lines(episode({forId: null})));
  assert.equal(u.episodes[0].host, null);
  assert.ok(u.anomalies.some(a => a.type === 'host-turn-unlinked' && a.turn === 't_1'));
  const dup = episode(); dup.push(dup[3]);
  assert.ok(reconstruct(lines(dup)).anomalies.some(a => a.type === 'duplicate' && a.proc === 'host-1'));
});

test('host recorder: ids only, refuses non-regular sinks, a failing sink disables it without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soul-trace-host-')), file = join(dir, 't.jsonl');
  const h = hostRecorder({file});
  h.turn('start', {turn: 't_1', for: 'm_1'}); h.tool('start', {turn: 't_1', tool: 'c_1'}); h.spawn({tool: 'c_1'});
  h.tool('end', {tool: 'c_1', exitCode: 0}); h.turn('bogus', {turn: 'please walk to the "fountain"'});
  const got = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(got.map(r => r.kind), ['host.turn', 'host.tool', 'host.spawn', 'host.tool', 'host.turn']);
  assert.deepEqual(Object.keys(got[4]).sort(), ['at', 'kind', 'mono', 'proc', 'seq', 'v'], 'free text and unknown phases are dropped');
  assert.deepEqual(h.env({turn: 't_1', tool: 'c_1'}), {SOUL_TRACE_TURN: 't_1', SOUL_TRACE_TOOL: 'c_1'});
  const fifo = join(dir, 'fifo');
  execFileSync('mkfifo', [fifo]);
  const f = hostRecorder({file: fifo});
  assert.equal(f.enabled, false); assert.equal(f.turn('start', {turn: 't'}), false);
  const bad = hostRecorder({file, appendSync: () => { throw Error('disk full'); }});
  assert.equal(bad.turn('start', {turn: 't'}), false); assert.equal(bad.stats.sinkFailures, 1); assert.equal(bad.enabled, false);
  assert.equal(hostRecorder({}).enabled, false, 'off without a file');
});

test('host CLI: records one boundary, exits 0 even when the sink is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soul-trace-hostcli-')), file = join(dir, 't.jsonl');
  execFileSync(process.execPath, [HOST, 'tool', 'start', '--turn', 't_9', '--tool', 'c_9'], {env: {...process.env, SOUL_TRACE_FILE: file}});
  const r = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(r.kind, 'host.tool'); assert.equal(r.tool, 'c_9'); assert.equal(r.phase, 'start');
  execFileSync(process.execPath, [HOST, 'spawn', '--tool', 'c_9'], {env: {...process.env, SOUL_TRACE_FILE: dir}}); // a directory: refused, still exit 0
});

test('host.mjs writes the same schema as the tap without loading it', async () => {
  const {SCHEMA: hostSchema} = await import('./host.mjs');
  assert.equal(hostSchema, SCHEMA);
});
