// 2.5.2 (server reliability, churn item 1): a refusal or slow-down reaches the human in words. Every 429/503 the world or
// launcher answers is kept for 60 s per channel (requests, the background listen) and cleared when the world answers
// that channel again; each command's JSON starts with `slowed` (stderr `SLOWED:` on a failed command). Waits unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refusalOf, slowedSentence, recoveredSentence, SLOWED_WINDOW_MS, SLOWED_FILES, channelOf } from './soul/eden.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const SCALE = 0.05;
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
// The launcher's shape (flood.mjs `no`): top-level code + message + retry_after; and the world's (admission.ts): error {code, message}.
const launcher429 = (res, after = 5, message = `more than 600 requests in 10 s from your address to this world; try again in ${after} s`) =>
  json(res, 429, { ok: false, code: 'client.rate', ...(message ? { message } : {}), retry_after: after, limit: { scope: 'address' } }, { 'retry-after': String(after) });
const world429 = (res, code = 'soul.slow-down', after = 5, message) =>
  json(res, 429, { contract: 'eden-edge/1', error: { code, ...(message ? { message } : {}) }, world: { load: 'amber', retry_after_s: after } }, { 'retry-after': String(after), 'x-sim-load': 'amber' });

async function fixture(t, respond) {
  const dir = mkdtempSync(join(tmpdir(), 'souls-slowed-')), seen = [];
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(req.url); respond(req, res, seen.length); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}`, soul: 's_slow', token: 'synthetic-slowed-token' }), { mode: 0o600 });
  const children = [];
  t.after(() => { for (const c of children) c.kill('SIGKILL'); server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); });
  const start = (...args) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, EDEN_TIME_SCALE: String(SCALE) }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); child.out = ''; child.err = '';
    child.stdout.on('data', c => { child.out += c; }); child.stderr.on('data', c => { child.err += c; });
    child.done = new Promise(resolve => child.on('exit', (code) => { let d = null; try { d = JSON.parse(child.out); } catch { /* not JSON */ } resolve({ code, d, stderr: child.err }); }));
    return child;
  };
  return { dir, seen, start, run: (...args) => start(...args).done };
}

test('words: the world\'s message (first clause, "your" → "my") or a built-in sentence per code; count, next try, 60 s window', () => {
  assert.deepEqual(refusalOf(429, { code: 'client.rate', message: 'more than 600 requests in 10 s from your address to this world; try again in 5 s' }, 5000),
    { code: 'client.rate', reason: 'more than 600 requests in 10 s from my address to this world', ms: 5000 });
  assert.equal(refusalOf(429, { error: { code: 'soul.busy' } }).reason, 'my previous request was still being answered');
  assert.equal(refusalOf(503, { raw: 'Bad gateway' }).code, 'http-503');
  assert.equal(channelOf('/v1/edge/inbox/listen?timeoutMs=50000'), 'listen'); assert.equal(channelOf('/v1/edge/here'), 'requests');
  const at = 1_000_000, r = (dt, code, next, ms = 5000, reason = 'too many requests at once from this address') => ({ at: at - dt, code, reason, ms, next });
  assert.equal(slowedSentence([r(0, 'soul.slow-down', 'retry', 5000, 'I asked for a lot in a short time')], 'requests', at),
    'The world asked me to slow down for 5 s: I asked for a lot in a short time (soul.slow-down); retrying in 5 s.');
  assert.equal(slowedSentence([r(30_000, 'client.rate', 'retry'), r(20_000, 'client.rate', 'retry'), r(2000, 'client.rate', 'none', 6000)], 'requests', at),
    'The world asked me to slow down 3 times in the last 30 s: too many requests at once from this address (client.rate); not retried; I can try once more in 4 s.');
  assert.equal(slowedSentence([r(8000, 'world.busy', 'none', 2000, 'the world was too busy to answer in time')], 'requests', at),
    'My last request was refused: the world was too busy to answer in time (world.busy); not retried; I can try once more now.');
  assert.equal(slowedSentence([r(10_000, 'soul.busy', 'listen', null, 'this Soul already holds 4 listening connections'), r(1000, 'soul.busy', 'listen', null, 'this Soul already holds 4 listening connections')], 'listen', at),
    'My listen for your messages was refused 2 times in the last 10 s: this Soul already holds 4 listening connections (soul.busy); still listening, next try shortly.');
  assert.equal(slowedSentence([r(SLOWED_WINDOW_MS, 'world.busy', 'none')], 'requests', at), null, 'older than 60 s is gone');
  assert.equal(recoveredSentence([r(9000, 'soul.slow-down', 'retry', 5000, 'I asked for a lot in a short time'), r(4000, 'soul.slow-down', 'retry', 4000, 'I asked for a lot in a short time')], at),
    'The world asked me to slow down twice (soul.slow-down: I asked for a lot in a short time); it answered after 9 s.');
  assert.equal(recoveredSentence([r(3000, 'world.busy', 'retry', 3000, 'the world was too busy to answer in time')], at),
    'The world refused my request once (world.busy: the world was too busy to answer in time); it went through after 3 s.');
  assert.equal(recoveredSentence([], at), null);
});

test('a fake launcher answering 429 client.rate (with message): the CLI waits as before, says it in words, and the next answer clears it', { timeout: 10_000 }, async t => {
  let refuse = true;
  const f = await fixture(t, (req, res) => refuse ? launcher429(res, 5) : json(res, 200, { here: { me: { name: 'S' } } }));
  const failed = await f.run('here');
  assert.equal(failed.code, 75, failed.stderr);
  assert.equal(f.seen.length, 4, 'one try and three waits: the etiquette is unchanged');
  assert.match(failed.stderr, /SLOWED: The world asked me to slow down 4 times in the last 1 s: more than 600 requests in 10 s from my address to this world \(client\.rate\); not retried; I can try once more in [45] s\./);
  assert.match(failed.stderr, /client\.rate — too many requests are coming from this address\. Try once again in 5 s; do not loop/);
  assert.ok(existsSync(join(f.dir, SLOWED_FILES.requests)), 'kept for the next command');
  refuse = false;
  const ok = await f.run('here');
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.d.slowed, undefined, 'cleared once the world answers');
  assert.ok(!existsSync(join(f.dir, SLOWED_FILES.requests)));
});

test('429 without a message: the built-in sentence per code; refused, then answered within one command, is said once in the past tense', { timeout: 10_000 }, async t => {
  const f = await fixture(t, (req, res, n) => n <= 2 ? world429(res, 'soul.slow-down', 4) : req.url === '/v1/edge/act'
    ? json(res, 200, { accepted: true, receipt: { id: 'r_1', phase: 'running', capability: 'wave:here', now: 'waving' }, channel: 'body' })
    : json(res, 200, { here: {} }));
  const got = await f.run('act', 'wave:here');
  assert.equal(got.code, 0, got.stderr);
  assert.match(got.d.slowed, /^The world asked me to slow down twice \(soul\.slow-down: I asked for a lot in a short time\); it answered after \d+ s\.$/);
  assert.equal(Object.keys(got.d)[0], 'slowed', 'the first thing the agent reads');
  assert.equal(got.d.now, 'waving', 'the receipt sentence is untouched');
  const next = await f.run('here');
  assert.equal(next.d.slowed, undefined, 'said once');
});

test('a refused background listen shows on the other commands until the listen gets through', { timeout: 10_000 }, async t => {
  let listenRefused = true;
  const f = await fixture(t, (req, res) => {
    if (req.url.startsWith('/v1/edge/inbox/listen')) return listenRefused
      ? json(res, 429, { ok: false, code: 'soul.busy', message: 'this Soul already holds 4 listening connections; try again in 5 s', retry_after: 5 }, { 'retry-after': '5' })
      : json(res, 200, { backlog: [{ id: 'm1', text: 'come to the pond' }] });
    json(res, 200, { here: {} });
  });
  const listen = f.start('listen');
  for (let i = 0; i < 200 && !existsSync(join(f.dir, SLOWED_FILES.listen)); i++) await new Promise(r => setTimeout(r, 20));
  const here = await f.run('here');
  assert.equal(here.code, 0, here.stderr);
  assert.match(here.d.slowed, /^My listen for your messages was (just refused|refused \d+ times in the last \d+ s): this Soul already holds 4 listening connections \(soul\.busy\); still listening, next try (now|in [1-5] s)\.$/);
  listenRefused = false;
  const end = await listen.done;
  assert.equal(end.code, 0, end.stderr);
  assert.equal(end.d.messages[0].id, 'm1');
  assert.match(end.d.slowed, /^My listen for your messages was refused (once|twice|\d+ times) \(soul\.busy: this Soul already holds 4 listening connections\); it got through after \d+ s\.$/);
  assert.ok(!existsSync(join(f.dir, SLOWED_FILES.listen)), 'cleared by the listen that got through');
  assert.equal((await f.run('here')).d.slowed, undefined);
});
