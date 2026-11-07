// L6 polite clients (LOAD-CONTRACT v1 §3): the thin Soul CLI waits out Retry-After, retries only reads and keyed
// writes, backs off on `unreachable` and exits 75, and holds one listen per Soul folder (.listen.lock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullJitter, statedJitter, retryClass, retryAfterMs } from './soul/eden.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const SCALE = 0.05;   // EDEN_TIME_SCALE: a stated 4 s wait takes 200–240 ms here
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const busy = (res, code = 'world.busy', after = 4, status = code.startsWith('soul.') ? 429 : 503) =>
  json(res, status, { error: { code, message: 'synthetic busy' }, world: { load: 'red', retry_after_s: after, note: 'It is crowded here right now; things take a little longer.' } }, { 'retry-after': String(after), 'x-sim-load': 'red' });

async function fixture(t, respond) {
  const dir = mkdtempSync(join(tmpdir(), 'souls-polite-')), seen = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, key: req.headers['idempotency-key'] ?? null, body: body ? JSON.parse(body) : null, at: Date.now() }); respond(req, res, seen.length); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}`, soul: 's_polite', token: 'synthetic-polite-token' }), { mode: 0o600 });
  const children = [];
  t.after(() => { for (const c of children) c.kill('SIGKILL'); server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); });
  const start = (...args) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, EDEN_TIME_SCALE: String(SCALE) }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    child.out = ''; child.err = '';
    child.stdout.on('data', c => { child.out += c; }); child.stderr.on('data', c => { child.err += c; });
    child.done = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal, stdout: child.out, stderr: child.err })));
    return child;
  };
  return { dir, seen, start, run: (...args) => start(...args).done };
}

test('helpers: full jitter stays under the capped exponential; a stated wait is a floor, spread up to 20 % above it; Retry-After from header or body', () => {
  assert.equal(fullJitter(0, () => 1), 1000); assert.equal(fullJitter(3, () => 0.5), 4000); assert.equal(fullJitter(10, () => 1), 60_000);
  assert.equal(Math.round(statedJitter(4000, () => 0)), 4000); assert.equal(Math.round(statedJitter(4000, () => 1)), 4800);
  assert.equal(Math.round(statedJitter(120_000, () => 0)), 60_000, 'the cap holds');
  assert.equal(retryAfterMs(new Headers({ 'retry-after': '3' }), {}), 3000);
  assert.equal(retryAfterMs(new Headers(), { world: { retry_after_s: 2 } }), 2000); assert.equal(retryAfterMs(new Headers(), { retry_after: 7 }), 7000);
  assert.equal(retryAfterMs(new Headers(), {}), null);
  assert.equal(retryClass('GET', '/v1/edge/here?include=doHere'), 'read'); assert.equal(retryClass('POST', '/v1/edge/resolve'), 'read');
  for (const p of ['/v1/edge/act', '/v1/edge/say', '/v1/edge/converse', '/v1/edge/objects/o1/act']) assert.equal(retryClass('POST', p), 'keyed', p);
  for (const p of ['/v1/edge/inbox/m1/ack', '/v1/edge/inbox/m1/result', '/v1/agent/create']) assert.equal(retryClass('POST', p), 'none', p);
});

test('a read honours Retry-After: one calm line, the stated wait, then the answer', { timeout: 8_000 }, async t => {
  const f = await fixture(t, (_req, res, n) => n === 1 ? busy(res) : json(res, 200, { here: { me: { name: 'P' } } }));
  const got = await f.run('here');
  assert.equal(got.code, 0, got.stderr);
  assert.equal(f.seen.length, 2);
  const gap = f.seen[1].at - f.seen[0].at;
  assert.ok(gap >= 4000 * 0.8 * SCALE - 15, `waited the stated time (${gap} ms)`);
  assert.equal(got.stderr.match(/the world is busy; waiting [345] s/g)?.length, 1, got.stderr);
  assert.match(got.stderr, /WORLD: It is crowded here right now/);
});

test('a world that stays busy: the CLI waits 3 times, then exits 75 with a clean code instead of looping', { timeout: 8_000 }, async t => {
  const f = await fixture(t, (_req, res) => busy(res, 'world.busy', 2));
  const got = await f.run('here');
  assert.equal(got.code, 75);
  assert.equal(f.seen.length, 4, 'one try and three waits');
  assert.match(got.stderr, /world\.busy — the world is busy\. Try once again in 2 s; do not loop/);
});

test('writes without an idempotency key are never repeated: ack on world.busy and on unreachable', { timeout: 8_000 }, async t => {
  const f = await fixture(t, (_req, res, n) => n === 1 ? busy(res) : res.socket.destroy());
  const a = await f.run('ack', 'm1', 'Got it.');
  assert.equal(a.code, 75); assert.equal(f.seen.length, 1); assert.match(a.stderr, /world\.busy/);
  const b = await f.run('result', 'm1', 'done', 'Waved.');
  assert.equal(b.code, 75); assert.equal(f.seen.length, 2); assert.match(b.stderr, /Not retried: this write has no safe retry/);
});

test('act and say retry with the same Idempotency-Key and body after a busy refusal and a dropped connection', { timeout: 8_000 }, async t => {
  const f = await fixture(t, (req, res, n) => {
    if (n === 1) return busy(res, 'soul.busy', 1);
    if (n === 2) return res.socket.destroy();
    if (req.url === '/v1/edge/act') return json(res, 200, { accepted: true, receipt: { id: 'r_1', phase: 'running' }, channel: 'body' });
    return json(res, 200, { said: true });
  });
  const got = await f.run('act', 'wave:here');
  assert.equal(got.code, 0, got.stderr);
  const acts = f.seen.filter(s => s.url === '/v1/edge/act');
  assert.equal(acts.length, 3);
  assert.ok(acts[0].key && acts.every(s => s.key === acts[0].key), 'one key for every try');
  assert.ok(acts.every(s => s.body.clientRef === acts[0].body.clientRef), 'one clientRef for every try');
  assert.match(got.stderr, /your previous request is still being answered; waiting 1 s/);
  const say = await f.run('say', 'hello');
  assert.equal(say.code, 0); const says = f.seen.filter(s => s.url === '/v1/edge/say');
  assert.equal(says.length, 1); assert.ok(says[0].key && says[0].key !== acts[0].key, 'a new write gets a new key');
});

test('unreachable reads back off with full jitter, 6 tries, then exit 75', { timeout: 15_000 }, async t => {
  const f = await fixture(t, (_req, res) => res.socket.destroy());
  const got = await f.run('here');
  assert.equal(got.code, 75);
  assert.equal(f.seen.length, 6);
  assert.match(got.stderr, /unreachable — the world did not answer .*Tried 6 times/);
});

test('one listener per Soul: a second listen exits 0 at once; a stale lock is taken over; the lock goes with the listener', { timeout: 10_000 }, async t => {
  const f = await fixture(t, () => { /* hold every long-poll open */ });
  const first = f.start('listen');
  const lock = join(f.dir, '.listen.lock');
  for (let i = 0; i < 100 && !existsSync(lock); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, first.pid);
  const second = await f.run('listen');
  assert.equal(second.code, 0);
  assert.deepEqual([JSON.parse(second.stdout).alreadyListening, JSON.parse(second.stdout).pid], [true, first.pid]);
  assert.match(second.stderr, new RegExp(`already listening \\(pid ${first.pid}`));
  first.kill('SIGTERM'); await first.done;
  assert.ok(!existsSync(lock), 'released on SIGTERM');
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, start: 'long ago' }));   // a dead pid (SIGKILLed listener)
  const third = f.start('listen');
  for (let i = 0; i < 100 && JSON.parse(readFileSync(lock, 'utf8')).pid !== third.pid; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, third.pid, 'stale lock taken over');
  const listens = () => f.seen.filter(s => s.url.startsWith('/v1/edge/inbox/listen')).length;
  for (let i = 0; i < 100 && listens() < 2; i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(listens(), 2, 'only the two real listeners asked the world');
});

test('a live but stuck listener (lock not renewed for 60 s) is stopped and its lock taken over; a fresh one is left alone', { timeout: 10_000 }, async t => {
  const f = await fixture(t, () => { /* hold every long-poll open */ });
  const lock = join(f.dir, '.listen.lock'), holder = () => { try { return JSON.parse(readFileSync(lock, 'utf8')); } catch { return null; } };
  const stuck = f.start('listen');
  for (let i = 0; i < 100 && holder()?.pid !== stuck.pid; i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(holder().beatAt, 'the lock carries a heartbeat');
  const fresh = await f.run('listen');
  assert.equal(JSON.parse(fresh.stdout).alreadyListening, true, 'a renewed lock still refuses a second listen');
  stuck.kill('SIGSTOP');   // suspended: it can no longer renew; age its heartbeat past the 60 s limit
  writeFileSync(lock, JSON.stringify({ ...holder(), beatAt: new Date(Date.now() - 120_000).toISOString() }));
  const next = f.start('listen');
  for (let i = 0; i < 100 && holder()?.pid !== next.pid; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(holder()?.pid, next.pid, 'the stuck listener\'s lock was taken over');
  stuck.kill('SIGCONT');
  const end = await stuck.done;
  assert.ok(end.code === 143 || end.signal === 'SIGTERM', `the stuck listener was stopped (${end.code}/${end.signal})`);
  assert.equal(holder()?.pid, next.pid, 'its exit did not remove the new holder\'s lock');
  assert.match(next.err, new RegExp(`listener pid ${stuck.pid} has not renewed its lock for 120 s`));
});
