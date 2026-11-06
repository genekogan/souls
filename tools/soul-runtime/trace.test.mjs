import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openHostTrace, createHostTrace} from './trace.mjs';
import {createTap} from '../soul-trace/tap.mjs';
import {hostRecorder} from '../soul-trace/host.mjs';
import {reconstruct} from '../soul-trace/readout.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SECRET = 'PROMPT_PRIVATE_CANARY';

function fakeHost() {
  const host = new EventEmitter();
  let n = 0;
  host.threadId = 'thread-1';
  host.begin = async function (prompt) { assert.equal(this, host); assert.ok(prompt.includes(SECRET)); return {turnId: 'turn-' + (++n), completed: new Promise(() => {})}; };
  return host;
}

test('managed host trace (#733 S2): turns and tool items become host.turn / host.tool, and the readout splits the episode', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-managed-trace-')), file = join(dir, 'trace.jsonl');
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  // The tap on the same process records the owner-message delivery, as with --import tap.mjs.
  const tap = createTap({file, argv: ['node', 'run.mjs', '--folder'], readScript: () => 'x', env: {}});
  tap.start();
  const fetch = tap.wrapFetch(async () => Response.json({backlog: [{id: 'm_1', text: SECRET, sentAt: Date.now() - 50, state: 'delivered'}], inbox: {queued: 1}}));
  await (await fetch('http://127.0.0.1:1/w/x/v1/edge/inbox/listen?timeoutMs=50000')).text();
  await sleep(15);
  const trace = openHostTrace({SOUL_TRACE_FILE: file}), host = fakeHost();
  assert.ok(trace, 'SOUL_TRACE_FILE installs the trace');
  const original = host.begin;
  trace.bindHost(host);
  const begun = await host.begin(`{"pending":"${SECRET}"}`);
  await sleep(5);
  trace.state({state: 'host-notified', mode: 'start', threadId: 'thread-1', turnId: begun.turnId, events: [{source: 'world', id: 'c_9'}, {source: 'owner', id: 'm_1'}]});
  trace.state({state: 'host-notified', mode: 'steer', turnId: begun.turnId, events: [{source: 'owner', id: 'm_2'}]});
  host.emit('event', {method: 'item/started', params: {turnId: begun.turnId, item: {id: 'item-7', type: 'commandExecution', command: SECRET}}});
  host.emit('event', {method: 'item/started', params: {turnId: begun.turnId, item: {id: 'item-8', type: 'reasoning', text: SECRET}}});
  host.emit('event', {method: 'item/completed', params: {turnId: begun.turnId, item: {id: 'item-7', type: 'commandExecution', exitCode: 0, aggregatedOutput: SECRET}}});
  await sleep(20);
  host.emit('event', {method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: begun.turnId, status: 'completed', items: [{text: SECRET}]}}});
  await trace.close();
  tap.close(0);
  assert.equal(host.begin, original, 'close restores begin');
  assert.equal(host.listenerCount('event'), 0, 'close removes its listener');

  const raw = readFileSync(file, 'utf8'), rows = raw.trim().split('\n').map(JSON.parse), hostRows = rows.filter(r => r.kind.startsWith('host.'));
  assert.ok(!raw.includes(SECRET), 'no prompt, text, command or output');
  assert.deepEqual(hostRows.map(r => [r.kind, r.phase, r.turn ?? null, r.tool ?? null, r.for ?? null]), [
    ['host.turn', 'start', 'turn-1', null, 'm_1'],
    ['host.tool', 'start', 'turn-1', 'item-7', null],
    ['host.tool', 'end', 'turn-1', 'item-7', null],
    ['host.turn', 'end', 'turn-1', null, null],
  ]);
  assert.equal(hostRows[2].exitCode, 0);
  const begin = hostRows[0], delivery = rows.find(r => r.kind === 'http');
  assert.ok(begin.at >= delivery.at, 'the turn is timed at its begin request, after the delivery');
  const ep = reconstruct(raw).episodes[0];
  assert.equal(ep.origin.id, 'm_1');
  assert.deepEqual(ep.host.segments.map(s => [s.from, s.to]), [['delivered', 'turn.start'], ['turn.start', 'turn.end']]);
  assert.equal(ep.host.segments[1].clock, 'process-monotonic');
  assert.ok(ep.host.segments[1].ms >= 20, String(ep.host.segments[1].ms));
  assert.equal(ep.host.toolCalls, 1);
});

test('managed host trace is off without SOUL_TRACE_FILE, refuses links, and a failing sink never reaches the host', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-managed-trace-off-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  assert.equal(openHostTrace({}), null);
  writeFileSync(join(dir, 'target'), 'UNTOUCHED'); symlinkSync(join(dir, 'target'), join(dir, 'link'));
  assert.equal(openHostTrace({SOUL_TRACE_FILE: join(dir, 'link')}), null);
  assert.equal(readFileSync(join(dir, 'target'), 'utf8'), 'UNTOUCHED');
  const rec = hostRecorder({file: join(dir, 'fail.jsonl'), queued: true, append: (_f, _d, _o, cb) => setImmediate(cb, Error('EIO')), limits: {queuedBytes: 4096, exitBytes: 4096, flushMs: 0}});
  const trace = createHostTrace(rec), host = fakeHost();
  trace.bindHost(host);
  for (let i = 0; i < 3; i++) {
    const r = await host.begin(SECRET);
    trace.state({state: 'host-notified', mode: 'start', turnId: r.turnId, events: []});
    host.emit('event', {method: 'turn/completed', params: {turn: {id: r.turnId}}});
    await sleep(2);
  }
  await trace.close();
  assert.equal(rec.enabled, false);
  assert.equal(rec.stats.sinkFailures, 1);
  assert.ok(rec.stats.dropped >= 1);
});

test('managed host trace close is bounded: a trace sink that never calls back cannot hold shutdown', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-managed-trace-stall-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  let syncWrites = 0;
  const rec = hostRecorder({file: join(dir, 'stall.jsonl'), queued: true, append: () => {}, appendSync: () => { syncWrites++; }, limits: {queuedBytes: 4096, exitBytes: 4096, flushMs: 0}});
  const trace = createHostTrace(rec, {closeWaitMs: 50}), host = fakeHost();
  trace.bindHost(host);
  const r = await host.begin(SECRET);
  trace.state({state: 'host-notified', mode: 'start', turnId: r.turnId, events: []});
  await sleep(5);
  host.emit('event', {method: 'turn/completed', params: {turn: {id: r.turnId}}});
  const t0 = performance.now(), summary = await trace.close();
  assert.ok(performance.now() - t0 < 1000, 'close returns after closeWaitMs');
  assert.equal(summary.complete, false);
  assert.ok(summary.dropped >= 2, String(summary.dropped));
  assert.equal(syncWrites, 0, 'no synchronous write into a stalled sink');
  assert.equal(host.listenerCount('event'), 0);
});
