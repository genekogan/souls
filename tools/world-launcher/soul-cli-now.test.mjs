// 2.2 (LINK port): the Soul's public `now` line in eden.mjs. --now "<line>" rides on act, say, ack, result (JSON body)
// and wait (query); `now "<line>"` / `now --clear` set it alone; status shows the owner's link state and the line.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {takeNowFlag, cleanNowText} from './soul/eden.mjs';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));

async function mounted(t) {
  const seen = [], dir = mkdtempSync(join(tmpdir(), 'now2-'));
  const server = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), body = b ? JSON.parse(b) : null; seen.push({path: u.pathname, query: Object.fromEntries(u.searchParams), body});
      const reply = (status, data) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data));};
      if (u.pathname === '/v1/edge/act') return reply(200, {accepted: true, receipt: {id: 'r_1', phase: 'accepted', capability: 'wander:here'}});
      if (u.pathname === '/v1/edge/say') return reply(200, {said: {text: body?.text, heardBy: []}});
      if (/^\/v1\/edge\/inbox\/[^/]+\/(ack|result)$/.test(u.pathname)) return reply(200, {inbox: {connected: true, queued: 0}});
      if (u.pathname === '/v1/edge/wait') return reply(200, {cursor: 'c_3', events: []});
      if (u.pathname === '/v1/edge/self/now') return reply(200, {ok: true, now: body.text === null ? null : {text: body.text, at: 7}});
      if (u.pathname === '/v1/edge/self/link') return reply(200, {soulId: 's_pip', link: {state: 'connected', reason: 'listening', since: 3}, now: {text: 'Rowing', at: 7}});
      if (u.pathname === '/v1/agent/me') return reply(200, {soul: {id: 's_pip', name: 'Pip'}, inbox: {connected: true, queued: 0}});
      reply(200, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, {recursive: true, force: true});});
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: 'http://127.0.0.1:' + server.address().port, soul: 's_pip', token: 'sim_fixture'}));
  const run = (args, want = 0) => new Promise(resolve => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (err, out, errText) => {
    assert.equal(err?.code ?? 0, want, `${args.join(' ')}: ${errText}`); let d = null; try {d = JSON.parse(out);} catch {} resolve({d, out, err: errText});
  }));
  return {run, seen};
}

test('takeNowFlag removes the flag and its value; the line is cleaned and limited to 140 characters', () => {
  assert.deepEqual(takeNowFlag(['wander', '--now', 'Heading out']), ['wander']);
  assert.deepEqual(takeNowFlag(['msg_1', 'On my way']), ['msg_1', 'On my way']);
  assert.throws(() => takeNowFlag(['wander', '--now']), /usage: --now/);
  assert.equal(cleanNowText('  two\nlines\tand\u0007bell  '), 'two lines and bell');
  assert.throws(() => cleanNowText('x'.repeat(141)), /at most 140/);
  assert.equal(cleanNowText('   '), null);
});

test('--now rides on act, say, ack, result (body) and wait (query), once each, never sent alone', async t => {
  const m = await mounted(t);
  await m.run(['act', 'wander:here', '--now', 'Heading out for a walk', '--for', 'none']);
  const act = m.seen.find(x => x.path === '/v1/edge/act'); assert.equal(act.body.now, 'Heading out for a walk'); assert.equal(act.body.capability, 'wander:here');
  await m.run(['say', 'hello', 'there', '--now', 'Saying hello']);
  assert.equal(m.seen.find(x => x.path === '/v1/edge/say').body.now, 'Saying hello');
  await m.run(['ack', 'msg_1', 'On my way', '--now', 'Heading to the bench']);
  const ack = m.seen.find(x => x.path.endsWith('/ack')); assert.equal(ack.body.now, 'Heading to the bench'); assert.equal(ack.body.reply, 'On my way');
  await m.run(['result', 'msg_1', 'done', 'Sat down', '--now', 'Resting on the bench']);
  const res = m.seen.find(x => x.path.endsWith('/result')); assert.equal(res.body.now, 'Resting on the bench'); assert.equal(res.body.text, 'Sat down');
  await m.run(['wait', '1', '--now', 'Waiting for the boat']);
  assert.equal(m.seen.find(x => x.path === '/v1/edge/wait').query.now, 'Waiting for the boat');
  assert.equal(m.seen.filter(x => x.path === '/v1/edge/self/now').length, 0, 'carried, never sent alone');
});

test('now sets the line alone, --clear clears it; a too-long line refuses before any world call; status shows link and now', async t => {
  const m = await mounted(t);
  assert.deepEqual((await m.run(['now', 'Looking', 'for', 'someone', 'to', 'row', 'with'])).d.now, {text: 'Looking for someone to row with', at: 7});
  assert.equal((await m.run(['now', '--clear'])).d.now, null); assert.deepEqual(m.seen.at(-1).body, {text: null});
  const before = m.seen.length; const r = await m.run(['act', 'wander:here', '--now', 'y'.repeat(141)], 1);
  assert.match(r.err, /at most 140/); assert.equal(m.seen.length, before, 'no call made');
  const {d} = await m.run(['status']);
  assert.deepEqual(d.link, {state: 'connected', reason: 'listening', since: 3}); assert.deepEqual(d.now, {text: 'Rowing', at: 7}); assert.equal(d.client, '2.19.0');
});
