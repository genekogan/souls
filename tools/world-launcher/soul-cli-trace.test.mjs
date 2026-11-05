// 2.7.2 (#371 H-b): EDEN_TRACE=1 writes one stderr line per HTTP attempt with the CLI's wall ms and the world's
// x-handler-ms, so a late answer splits into server and client/network time. Without the variable nothing changes.
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {traceLine} from './soul/eden.mjs';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));

async function world(t, {handler = true, busyFirst = 0} = {}) {
  const seen = [];
  const dir = mkdtempSync(join(tmpdir(), 'trace-')), server = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), h = {'content-type': 'application/json', ...(handler ? {'x-handler-ms': '4.5'} : {})};
      seen.push(u.pathname);
      if (u.pathname === '/v1/edge/here' && busyFirst-- > 0) { res.writeHead(503, {...h, 'retry-after': '1'}); return res.end(JSON.stringify({error: {code: 'world.busy', message: 'busy'}, world: {load: 'green', retry_after_s: 1}})); }
      res.writeHead(200, h);
      res.end(JSON.stringify(u.pathname === '/v1/edge/act' ? {accepted: true, receipt: {id: 'r_1', phase: 'accepted', capability: 'wander:here'}} : {soul: {id: 's_pip', name: 'Pip'}, inbox: {connected: true, queued: 0}}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, {recursive: true, force: true});});
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: 'http://127.0.0.1:' + server.address().port, soul: 's_pip', token: 'sim_fixture_secret_token'}));
  const run = (args, env = {}) => new Promise(resolve => execFile(process.execPath, [CLI, ...args], {cwd: dir, env: {...process.env, EDEN_TRACE: '', ...env}}, (err, out, errText) => {
    assert.equal(err?.code ?? 0, 0, errText); resolve({out, err: errText});
  }));
  return {run, seen};
}
const traces = (s) => s.split('\n').filter(l => l.startsWith('TRACE ')).map(l => JSON.parse(l.slice(6)));

test('traceLine: method, query-free path with opaque segments redacted, status, ms to 0.1, handlerMs or null, attempt', () => {
  // the view image's real capability URL shape (eyes/routes.ts): /v1/edge/view/img/<randomBytes(16) hex>.jpg
  const img = randomBytes(16).toString('hex');
  const t = traces(traceLine('GET', `http://h:1/w/x/v1/edge/view/img/${img}.jpg?sig=secret`, 200, 12.345, '3.2', 2))[0];
  assert.deepEqual(t, {method: 'GET', path: '/w/x/v1/edge/view/img/<redacted>.jpg', status: 200, ms: 12.3, handlerMs: 3.2, attempt: 2});
  assert.ok(!JSON.stringify(t).includes(img.slice(0, 8)), 'no part of the capability value is traced');
  for (const seg of [img, `${img}.png`, `${img.slice(0, 16)}.webp`, 'AbCdEfGhIjKlMnOpQrStUv', `v.${img}`, `${img}.tar.gz`])
    assert.match(traces(traceLine('GET', `http://h:1/v1/edge/view/img/${seg}`, 200, 1, null))[0].path, /^\/v1\/edge\/view\/img\/<redacted>(\.[a-z]+)?$/, seg.length + ' chars');
  assert.equal(traces(traceLine('GET', 'http://h:1/v1/edge/receipts/r_1a2b3c', 200, 1, null))[0].path, '/v1/edge/receipts/r_1a2b3c', 'short ids stay readable');
  assert.equal(traces(traceLine('POST', 'http://h:1/v1/edge/act', 0, 1, null))[0].handlerMs, null, 'no header: null');
  assert.equal(traces(traceLine('POST', 'http://h:1/v1/edge/act', 200, 1, ''))[0].handlerMs, null);
});

test('EDEN_TRACE=1: one stderr line per request with the world handler time; stdout is the same JSON; no token or query', async t => {
  const w = await world(t), plain = await w.run(['act', 'wander:here']), before = w.seen.length, traced = await w.run(['act', 'wander:here'], {EDEN_TRACE: '1'});
  assert.equal(traced.out, plain.out, 'stdout unchanged');
  assert.equal(traces(plain.err).length, 0, 'nothing without the variable');
  assert.equal(traced.out.includes('TRACE'), false, 'never on stdout');
  const lines = traces(traced.err);
  assert.equal(lines.length, w.seen.length - before, 'one line per request of the traced run'); assert.ok(lines.some(l => l.method === 'POST' && l.path === '/v1/edge/act' && l.status === 200));
  for (const l of lines) { assert.equal(l.handlerMs, 4.5); assert.ok(l.ms >= 0); assert.equal(l.attempt, 1); assert.deepEqual(Object.keys(l), ['method', 'path', 'status', 'ms', 'handlerMs', 'attempt']); }
  assert.ok(!traced.err.includes('sim_fixture_secret_token') && !/\?/.test(lines.map(l => l.path).join('')), 'no token, no query');
  assert.equal(traced.err.replace(/^TRACE .*\n/gm, ''), plain.err, 'the rest of stderr unchanged');
});

test('EDEN_TRACE=1 against a world without the header: handlerMs is null', async t => {
  const w = await world(t, {handler: false}), lines = traces((await w.run(['status'], {EDEN_TRACE: '1'})).err);
  assert.equal(lines.length, w.seen.length); for (const l of lines) assert.equal(l.handlerMs, null);
});

test('EDEN_TRACE=1 on a read the world answers busy twice: one line per attempt, numbered 1, 2, 3', {timeout: 30000}, async t => {
  const w = await world(t, {busyFirst: 2}), lines = traces((await w.run(['here'], {EDEN_TRACE: '1'})).err).filter(l => l.path === '/v1/edge/here');
  assert.deepEqual(lines.map(l => [l.status, l.attempt]), [[503, 1], [503, 2], [200, 3]]);
  assert.equal(w.seen.filter(p => p === '/v1/edge/here').length, 3);
});
