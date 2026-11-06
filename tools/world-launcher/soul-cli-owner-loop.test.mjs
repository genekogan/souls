// D3 (playtest 2026-10-25): eden.mjs 2.1 links an act to the owner message it serves (--for; by default the newest one
// acked in this folder), prints one top-level `now`/`done` sentence (<= 600 chars; --json prints everything), and drops
// a default link the world no longer knows. D3b (2.2.1, cloud fix-r3 trio tam-003): the default serves only the first
// act the world accepts after the ack, within 120 s of it; an unfinished receipt prints `done: false` beside `now`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brief} from './soul/eden.mjs';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));

test('brief: done when the receipt ended, now while it runs; at most 600 characters', () => {
  const run = brief({accepted: true, receipt: {id: 'r_1', capability: 'sit:here', phase: 'started', now: 'walking to the bench, 18 m left; not sitting yet'}, resolved: {from: 'sit down', to: 'sit:here', note: 'x'.repeat(900)}});
  assert.equal(run.now, 'walking to the bench, 18 m left; not sitting yet'); assert.equal(run.done, false, 'an unfinished receipt says done: false'); assert.equal(run.resolved, 'sit:here');
  const end = brief({waited: '3s', receipt: {id: 'r_1', capability: 'sit:here', phase: 'completed', outcome: {summary: 'sit completed at commons.'}}, events: [{kind: 'receipt'}]});
  assert.equal(end.done, 'sit completed at commons.'); assert.equal(end.now, undefined);
  const long = brief({receipt: {id: 'r_2', capability: 'walk:x', phase: 'failed', reason: 'r'.repeat(2000)}, events: Array.from({length: 9}, () => ({text: 'e'.repeat(200)}))});
  const {events, eventWindow, ...action} = long;
  assert.ok(JSON.stringify(action).length <= 601, String(JSON.stringify(action).length)); assert.match(long.failed, /^walk:x failed: r+…$/); assert.equal(long.done, undefined);
  assert.equal(events.length, 4); assert.equal(eventWindow.omitted, 5, 'event omissions are explicit, separate from the compact action summary');
});

test('brief F2 (#373): a failed or replaced receipt prints failed with the reason, never its success summary as done', () => {
  const failed = brief({accepted: true, receipt: {id: 'r_3', capability: 'object:ride-x:join', phase: 'failed', code: 'ride.departed', reason: 'The ride left before you boarded.', outcome: {summary: 'Boarded ride-x and seated; the ride has not left the ground yet and is not finished.'}}});
  assert.equal(failed.done, undefined); assert.equal(failed.failed, 'object:ride-x:join failed: The ride left before you boarded.');
  const replaced = brief({receipt: {id: 'r_4', capability: 'object:ride-x:join', phase: 'replaced', reason: 'A newer action from this Soul replaced it.', outcome: {summary: 'Boarded ride-x and seated.'}}});
  assert.equal(replaced.done, undefined); assert.equal(replaced.failed, 'object:ride-x:join replaced: A newer action from this Soul replaced it.');
  const coded = brief({receipt: {id: 'r_5', capability: 'walk:x', phase: 'failed', code: 'route.blocked'}});
  assert.equal(coded.failed, 'walk:x failed (route.blocked).');
  const boarded = brief({receipt: {id: 'r_6', capability: 'object:ride-x:join', phase: 'completed', outcome: {summary: 'Boarded ride-x and seated.'}}});
  assert.equal(boarded.done, 'Boarded ride-x and seated.'); assert.equal(boarded.failed, undefined);
});

test('act --for: by default the first accepted act within 120 s of an ack serves it; an explicit id, none, and a stale default dropped', async t => {
  const seen = [];
  const server = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const body = b ? JSON.parse(b) : null; seen.push({path: req.url, body});
      const reply = (status, data) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data));};
      if (req.url.includes('/ack')) return reply(200, {inbox: {}});
      if (req.url === '/v1/edge/act') {
        if (body.for === 'm_gone') return reply(400, {error: {code: 'invalid', message: 'no owner message m_gone for this Soul (it may be too old)'}});
        if (body.capability === 'fly') return reply(200, {accepted: false, code: 'capability.unknown', reason: 'no fly here'});
        return reply(200, {accepted: true, channel: 'body', receipt: {id: 'r_9', capability: 'wave:here', phase: 'started', now: 'waving'}, ...(body.for ? {for: body.for} : {})});
      }
      reply(404, {error: {code: 'not-found', message: req.url}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), 'eden-cli-for-'));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${server.address().port}`, token: 'tok'}));
  const cli = (...args) => new Promise((res, rej) => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (e, out, err) => e ? rej(new Error(err || e.message)) : res(JSON.parse(out))));
  const acts = () => seen.filter(x => x.path === '/v1/edge/act').map(x => x.body.for ?? null);
  const state = () => JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8'));
  const setState = patch => writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({...state(), ...patch}));
  assert.equal((await cli('act', 'wave')).for, undefined, 'nothing acked yet: no link');
  await cli('ack', 'm_1', 'Will try a wave');
  assert.equal((await cli('act', 'fly')).accepted, false, 'a refused act links nothing');
  const linked = await cli('act', 'wave');
  assert.equal(linked.for, 'm_1', 'the first accepted act after the ack serves it'); assert.equal(linked.now, 'waving'); assert.equal(linked.done, false); assert.equal(linked.receipt.phase, 'started');
  assert.equal((await cli('act', 'wave')).for, undefined, 'a second act does not serve the acked message by default');
  assert.equal((await cli('act', 'wave', '--for', 'm_1')).for, 'm_1', 'explicit --for still links it');
  assert.equal((await cli('act', 'wave', '--for', 'm_7')).for, 'm_7');
  await cli('ack', 'm_2');
  assert.equal((await cli('act', 'wave', '--for', 'none')).for, undefined, '--for none links nothing');
  assert.equal((await cli('act', 'wave')).for, undefined, '--for none was the first act after the ack');
  await cli('ack', 'm_3');
  const full = await cli('act', 'wave', '--json'); assert.equal(full.channel, 'body', '--json prints everything'); assert.equal(full.for, 'm_3');
  await cli('ack', 'm_4'); setState({lastAckedAt: new Date(Date.now() - 121_000).toISOString()});
  assert.equal((await cli('act', 'wave')).for, undefined, 'more than 120 s after the ack: no default link');
  assert.deepEqual(acts(), [null, 'm_1', 'm_1', null, 'm_1', 'm_7', null, null, 'm_3', null]);
  await cli('ack', 'm_5'); setState({lastAcked: 'm_gone'});
  const retried = await cli('act', 'wave'); assert.equal(retried.accepted, true); assert.equal(retried.for, undefined, 'a default the world no longer knows is dropped and the act sent plainly');
  assert.equal(state().lastAcked, undefined);
});

// D3c (laptop trio-r1 rook-003): the default link says it is a default (forDefault); when the world answers `open` (the
// act is not the message's last step: a wave for "rest, then come back to the balloon") the default serves the next act
// too, until an act the world does not keep open; an explicit --for never sends forDefault.
test('act --for (D3c): a default link is marked forDefault; an open answer keeps the default for the next act', async t => {
  const seen = [];
  const server = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const body = b ? JSON.parse(b) : null; seen.push({path: req.url, body});
      const reply = (status, data) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data));};
      if (req.url.includes('/ack')) return reply(200, {inbox: {}});
      if (req.url === '/v1/edge/act') {
        const open = body.forDefault === true && body.capability !== 'walk to the balloon';
        return reply(200, {accepted: true, channel: 'body', receipt: {id: 'r_9', capability: body.capability, phase: 'started', now: 'busy'}, ...(body.for ? {for: body.for} : {}), ...(open ? {open: true} : {})});
      }
      reply(404, {error: {code: 'not-found', message: req.url}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), 'eden-cli-for-d3c-'));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${server.address().port}`, token: 'tok'}));
  const cli = (...args) => new Promise((res, rej) => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (e, out, err) => e ? rej(new Error(err || e.message)) : res(JSON.parse(out))));
  const acts = () => seen.filter(x => x.path === '/v1/edge/act').map(x => [x.body.for ?? null, x.body.forDefault ?? null]);
  const state = () => JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8'));
  await cli('ack', 'm_1', 'Got it: rest a bit, then back to the balloon');
  const wave = await cli('act', 'wave');
  assert.equal(wave.for, 'm_1'); assert.equal(wave.open, true, 'the world keeps the message open: brief says so');
  assert.equal(state().lastAckedActed, undefined, 'an open answer does not use the default up');
  assert.equal((await cli('act', 'sit')).open, true, 'the next act is linked by default too');
  const back = await cli('act', 'walk to the balloon'); assert.equal(back.for, 'm_1'); assert.equal(back.open, undefined);
  assert.equal(state().lastAckedActed, true, 'an act the world does not keep open uses the default up');
  assert.equal((await cli('act', 'wave')).for, undefined, 'then no default link');
  await cli('ack', 'm_2');
  assert.equal((await cli('act', 'wave', '--for', 'm_2')).open, undefined, 'an explicit --for is never a default');
  assert.deepEqual(acts(), [['m_1', true], ['m_1', true], ['m_1', true], [null, null], ['m_2', null]]);
});
