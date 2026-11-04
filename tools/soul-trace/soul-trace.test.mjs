// #733: passive opt-in soul-trace/1 tap and readout on the thin CLI path (eden.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile, execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createTap, factsOf, routeOf, SCHEMA} from './tap.mjs';
import {reconstruct, render} from './readout.mjs';

const CLI = fileURLToPath(new URL('../world-launcher/soul/eden.mjs', import.meta.url));
const TAP = fileURLToPath(new URL('./tap.mjs', import.meta.url));
const SECRET = 'please meet me by the quiet fountain';

// A stub world with one owner message, a walk that completes, a refused fly, and a sit that replaces a walk.
async function stubWorld(t) {
  const seen = [];
  const tick = 102;
  const server = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const body = b ? JSON.parse(b) : null; seen.push({path: req.url, body, key: req.headers['idempotency-key'] ?? null});
      const reply = (status, data) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data)); };
      if (req.url.startsWith('/v1/edge/inbox/listen')) return reply(200, {backlog: [{id: 'm_1', text: SECRET, sentAt: Date.now() - 400, state: 'delivered'}], inbox: {queued: 1}});
      if (req.url === '/v1/edge/inbox/m_1/ack') return reply(200, {inbox: {queued: 0}});
      if (req.url === '/v1/edge/inbox/m_1/result') return reply(200, {inbox: {queued: 0}});
      if (req.url === '/v1/edge/act') {
        if (body.capability === 'fly') return reply(200, {accepted: false, code: 'capability.unknown', reason: 'no fly here'});
        return reply(200, {accepted: true, channel: 'body', receipt: {id: 'r_9', soulId: 's_1', capability: 'walk:fountain', phase: 'started', acceptedTick: tick - 2, startedTick: tick, now: 'walking'}, ...(body.for ? {for: body.for} : {})});
      }
      if (req.url.startsWith('/v1/edge/receipts/r_9')) return reply(200, {receipt: {id: 'r_9', soulId: 's_1', capability: 'walk:fountain', phase: 'completed', acceptedTick: 100, startedTick: 102, endedTick: 160, outcome: {summary: SECRET}}});
      reply(404, {error: {code: 'not-found', message: 'nothing here'}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), 'soul-trace-'));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${server.address().port}`, token: 'tok-should-not-appear'}));
  return {dir, seen};
}
const run = (dir, args, env = {}, imports = true) => new Promise(res => execFile(process.execPath, [...(imports ? ['--import', TAP] : []), CLI, ...args],
  {cwd: dir, env: {...process.env, SOUL_TRACE_FILE: '', ...env}}, (e, out, err) => res({code: e?.code ?? 0, out, err})));
const stable = r => ({code: r.code, out: r.out.replace(/"(?:at|lastActAt|sentAt)":\s*"?[^",}]+"?/g, ''), err: r.err});

test('A1/A2/A3: a traced thin-CLI episode links owner message → act → receipt without text, tokens or hosts', async t => {
  const {dir, seen} = await stubWorld(t), trace = join(dir, 'trace.jsonl'), env = {SOUL_TRACE_FILE: trace, SOUL_TRACE_RUN: 'run-1', SOUL_TRACE_SEAT: 'seat-a'};
  await run(dir, ['listen', '--once'], env);
  await run(dir, ['ack', 'm_1', 'On my way'], env);
  await run(dir, ['act', 'fly'], env);
  await run(dir, ['act', 'walk to the fountain', '--for', 'm_1'], env);
  await run(dir, ['receipt', 'r_9'], env);
  await run(dir, ['result', 'm_1', 'done', 'walked to the fountain'], env);
  const text = readFileSync(trace, 'utf8');
  for (const forbidden of [SECRET, 'tok-should-not-appear', '127.0.0.1', 'On my way', 'walk to the fountain', 'Bearer']) assert.ok(!text.includes(forbidden), forbidden);
  const lines = text.trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.every(l => l.v === SCHEMA));
  const start = lines.find(l => l.kind === 'proc.start' && l.command === 'act');
  assert.equal(start.cliSha256, createHash('sha256').update(readFileSync(CLI)).digest('hex'), 'source version is the served CLI bytes');
  assert.equal(start.run, 'run-1'); assert.equal(start.seat, 'seat-a');
  const acts = lines.filter(l => l.kind === 'http' && l.route === '/v1/edge/act');
  assert.equal(acts.length, 2); assert.ok(acts.every(a => a.op && a.attempt === 1), 'logical operation is the CLI idempotency key');
  assert.deepEqual(acts.map(a => a.op), seen.filter(s => s.path === '/v1/edge/act').map(s => s.key));
  const tl = reconstruct(text), ep = tl.episodes[0];
  assert.equal(tl.replay, false);
  assert.equal(ep.origin.id, 'm_1'); assert.ok(ep.origin.sentAt);
  assert.equal(ep.firstCommand.command, 'ack');
  assert.deepEqual(ep.inbox.map(x => x.verb), ['ack', 'result']);
  assert.equal(ep.acts.length, 1, 'only the act linked by `for` belongs to the episode');
  assert.equal(ep.acts[0].receipt.terminal, 'completed');
  assert.deepEqual(ep.acts[0].receipt.ticks, {accepted: 100, started: 102, ended: 160});
  assert.equal(tl.unlinked.length, 1); assert.equal(tl.unlinked[0].outcome, 'refused', 'HTTP 200 with accepted:false is a refusal');
  assert.equal(tl.unlinked[0].origin.kind, 'unknown');
  assert.deepEqual(tl.anomalies, []);
  assert.match(render(tl), /host time, unattributed/);
});

test('A3/A4: off adds nothing; on and a failing sink leave stdout, stderr and exit code unchanged', async t => {
  const {dir} = await stubWorld(t);
  const plain = await run(dir, ['act', 'walk to the fountain', '--json'], {}, false);
  const off = await run(dir, ['act', 'walk to the fountain', '--json'], {});
  assert.deepEqual(stable(off), stable(plain)); assert.ok(!existsSync(join(dir, 'trace.jsonl')));
  const on = await run(dir, ['act', 'walk to the fountain', '--json'], {SOUL_TRACE_FILE: join(dir, 'trace.jsonl')});
  assert.deepEqual(stable(on), stable(plain)); assert.ok(existsSync(join(dir, 'trace.jsonl')));
  const broken = await run(dir, ['act', 'walk to the fountain', '--json'], {SOUL_TRACE_FILE: join(dir, 'missing-dir', 'trace.jsonl')});
  assert.deepEqual(stable(broken), stable(plain), 'an unwritable sink changes nothing the agent sees');
  const refused = await run(dir, ['act', 'fly'], {SOUL_TRACE_FILE: join(dir, 'missing-dir', 'x.jsonl')});
  const refusedPlain = await run(dir, ['act', 'fly'], {}, false);
  assert.deepEqual(stable(refused), stable(refusedPlain));
  const fifo = join(dir, 'pipe.jsonl'); execFileSync('mkfifo', [fifo]);
  const piped = await run(dir, ['act', 'walk to the fountain', '--json'], {SOUL_TRACE_FILE: fifo});
  assert.deepEqual(stable(piped), stable(plain), 'a FIFO sink (no reader) is refused rather than blocking exit');
});

const fakeResponse = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});

test('A4: a stalled sink never delays the caller and stays bounded; a throwing sink is counted and disabled', async () => {
  const stalled = [], tap = createTap({file: 'x', argv: ['node', 'eden.mjs', 'act'], readScript: () => 'x', append: (...a) => stalled.push(a), appendSync: () => { throw Error('sync must not run past the bound'); },
    limits: {records: 50, queuedBytes: 4096, recordBytes: 1024, exitBytes: 512, bodyBytes: 1 << 20, flushMs: 0}});
  tap.start();
  const f = tap.wrapFetch(async () => fakeResponse({accepted: true, receipt: {id: 'r_1', phase: 'started'}}));
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) await (await f('http://world.invalid/v1/edge/act', {method: 'POST', headers: {'idempotency-key': 'k1'}})).text();
  assert.ok(performance.now() - t0 < 2000, 'no caller waited for the sink');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(stalled.length, 1, 'one batch in flight at a time; it never completed');
  assert.ok(tap.stats.records <= 50 && tap.stats.dropped > 0, JSON.stringify(tap.stats));
  tap.close(0);
  assert.ok(tap.stats.inFlightAtExit > 0 && tap.stats.dropped > 0);

  const failing = createTap({file: 'x', argv: ['node', 'eden.mjs', 'act'], readScript: () => 'x', append: (_f, _d, _o, cb) => cb(Object.assign(Error('ENOSPC'), {code: 'ENOSPC'})), appendSync: () => { throw Error('EIO'); }, limits: {records: 50, queuedBytes: 4096, recordBytes: 1024, exitBytes: 4096, bodyBytes: 1 << 20, flushMs: 0}});
  failing.start();
  const g = failing.wrapFetch(async () => fakeResponse({ok: true}));
  for (let i = 0; i < 5; i++) await (await g('http://world.invalid/v1/edge/here')).text();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(failing.stats.sinkFailures >= 1 && failing.stats.dropped >= 1, JSON.stringify(failing.stats));
  assert.doesNotThrow(() => failing.close(1));
  const thrower = createTap({file: 'x', argv: [], append: () => { throw Error('boom'); }, limits: {records: 5, queuedBytes: 4096, recordBytes: 1024, exitBytes: 4096, bodyBytes: 1 << 20, flushMs: 0}});
  const h = thrower.wrapFetch(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(h('http://world.invalid/v1/edge/here'), /fetch failed/, 'transport errors pass through unchanged');
});

test('A3: routes keep path ids only; facts are whitelisted', () => {
  assert.equal(routeOf('https://host.example/w/toy/v1/edge/around?to=the quiet fountain'), '/v1/edge/around?to');
  assert.equal(routeOf('http://127.0.0.1:9/v1/edge/objects/a b/act'), '/v1/edge/objects/:omitted/act');
  assert.deepEqual(factsOf({accepted: true, receipt: {id: 'r_1', phase: 'started', reason: 'x', now: 'walking'}, backlog: [{id: 'm_1', text: 'hi', sentAt: 5}], text: 'y'}),
    {accepted: true, receipt: {id: 'r_1', phase: 'started'}, messages: [{id: 'm_1', sentAt: 5}]});
});

// Known-order synthetic fixtures: one record per line, as a tap would write them.
const rec = (proc, seq, kind, at, f = {}) => JSON.stringify({v: SCHEMA, kind, proc, seq, at, mono: seq, ...f});
const http = (proc, seq, at, f) => rec(proc, seq, 'http', at, {status: 200, durationMs: 5, ...f});
function interruptedFixture() {
  return [
    rec('L1', 1, 'proc.start', 1000, {command: 'listen'}),
    http('L1', 2, 1400, {method: 'GET', route: '/v1/edge/inbox/listen?timeoutMs', facts: {messages: [{id: 'm_1', sentAt: 1000}]}}),
    rec('L1', 3, 'proc.end', 1401, {exitCode: 0, stats: {}}),
    rec('A1', 1, 'proc.start', 4000, {command: 'act'}),
    http('A1', 2, 4100, {method: 'POST', route: '/v1/edge/act', op: 'k1', attempt: 1, status: 503, facts: {code: 'soul.busy'}}),
    http('A1', 3, 6100, {method: 'POST', route: '/v1/edge/act', op: 'k1', attempt: 2, facts: {accepted: true, for: 'm_1', receipt: {id: 'r_1', phase: 'started', acceptedTick: 10, startedTick: 11}}}),
    rec('A1', 4, 'proc.end', 6101, {exitCode: 0, stats: {}}),
    rec('L2', 1, 'proc.start', 7000, {command: 'listen'}),
    http('L2', 2, 9000, {method: 'GET', route: '/v1/edge/inbox/listen?after&timeoutMs', facts: {messages: [{id: 'm_2', sentAt: 8900}]}}),
    rec('L2', 3, 'proc.end', 9001, {exitCode: 0, stats: {}}),
    rec('A2', 1, 'proc.start', 12000, {command: 'act'}),
    http('A2', 2, 12100, {method: 'POST', route: '/v1/edge/act', op: 'k2', attempt: 1, facts: {accepted: true, for: 'm_2', receipt: {id: 'r_2', phase: 'started', acceptedTick: 40, startedTick: 40}}}),
    rec('A2', 3, 'proc.end', 12101, {exitCode: 0, stats: {}}),
    rec('W1', 1, 'proc.start', 13000, {command: 'wait'}),
    http('W1', 2, 13500, {method: 'GET', route: '/v1/edge/wait?after&timeout', facts: {events: [{id: 'r_1', phase: 'replaced', acceptedTick: 10, startedTick: 11, endedTick: 40, code: 'replaced'}, {id: 'r_2', phase: 'completed', acceptedTick: 40, startedTick: 40, endedTick: 70}]}}),
    rec('W1', 3, 'proc.end', 13501, {exitCode: 0, stats: {}}),
  ];
}

test('A2: an interrupted activity and a busy retry reconstruct with the same contract', () => {
  const tl = reconstruct(interruptedFixture().join('\n'));
  assert.deepEqual(tl.anomalies, []);
  const [first, second] = tl.episodes;
  assert.equal(first.acts[0].attempts.length, 2, 'two attempts of one logical operation');
  assert.deepEqual(first.acts[0].attempts.map(a => a.status), [503, 200]);
  assert.equal(first.acts[0].receipt.terminal, 'replaced');
  assert.equal(second.origin.id, 'm_2'); assert.equal(second.acts[0].receipt.terminal, 'completed');
  assert.equal(second.deliveredAt < 13500, true, 'm_2 arrived while r_1 was still running');
  const text = render(tl);
  assert.match(text, /attempt 2 → 200/); assert.match(text, /= replaced/); assert.match(text, /not a replay/);
});

test('A2: duplicates, reordering, missing origin, restart, lost records and delayed receipts are reported', () => {
  const lines = interruptedFixture();
  const mutated = [...lines.slice(0, 5), lines[4], lines[6], lines[5], ...lines.slice(7, 9), rec('L3', 1, 'proc.start', 9500, {command: 'listen'}), ...lines.slice(10, 13),
    http('W1', 2, 13500, {method: 'GET', route: '/v1/edge/wait', facts: {events: [{id: 'r_2', phase: 'completed', endedTick: 70}, {id: 'r_2', phase: 'started'}]}}),
    rec('W1', 5, 'proc.end', 13600, {exitCode: 0, stats: {dropped: 2}}),
    rec('X1', 1, 'proc.start', 14000, {command: 'act'}),
    http('X1', 2, 14100, {method: 'POST', route: '/v1/edge/act', op: 'k3', attempt: 1, facts: {accepted: true, receipt: {id: 'r_3', phase: 'started'}}}),
    'not json',
  ].join('\n');
  const tl = reconstruct(mutated), types = new Set(tl.anomalies.map(a => a.type));
  for (const t of ['duplicate', 'reordered', 'restart', 'unclosed-process', 'missing-start', 'missing-records', 'capture-loss', 'stale-receipt', 'receipt-unresolved', 'unparsed-lines']) assert.ok(types.has(t), t + ' ' + JSON.stringify(tl.anomalies));
  assert.equal(tl.unlinked.at(-1).origin.kind, 'unknown', 'an act with no recorded owner link is not joined by time');
  assert.equal(tl.episodes.find(e => e.origin.id === 'm_2').acts.length, 1);
});
