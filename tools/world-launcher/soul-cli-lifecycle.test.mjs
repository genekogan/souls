// 2.5.3 (server reliability, eden2 B-soak r3 bug 6): a create on a SOUL_LIFECYCLE world that is not ready within the
// world's 2 s answers 503 lifecycle-pending. The CLI keeps that Soul in the folder, polls GET /v1/lifecycle/<requestId>
// every 2 s (or the world's Retry-After) for up to 120 s, and finishes the same Soul; re-running the same create resumes
// the wait, and a 409 name-taken from this identity's own pending create resumes it too. Never a second Soul.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const SCALE = 0.01;   // 2 s checks → 20 ms, the 120 s wait → 1.2 s
const REQ = 'lc_' + 'ab'.repeat(16), SOUL = 's_arrive', NAME = 'Bench7';
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const receipt = (state, ready = false) => ({
  contract: 'soul-lifecycle/1', worldId: 'w_bench', requestId: REQ, soulId: SOUL, entityId: 'h_arrive', name: NAME, operation: 'create', state,
  revision: 1, requestedAt: 1, fact: state === 'admitted' ? { seq: 1, tick: 1 } : null, ready, reason: state === 'pending' ? 'reconciling' : state === 'refused' ? 'arrival-unavailable' : null,
  allocation: { countsTowardLimit: state !== 'refused', reservesName: state !== 'refused' },
});
// The world's own answer (http.ts lifecycleReply) when the create is not admitted+ready within waitLifecycle's 2 s.
const pending503 = (res, headers) => json(res, 503, { ok: false, code: 'lifecycle-pending', message: 'Completion is unconfirmed; refresh the private lifecycle receipt.', lifecycle: receipt('pending') }, headers);

async function fixture(t, world) {
  const dir = mkdtempSync(join(tmpdir(), 'souls-lifecycle-')), seen = [];
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { const n = seen.push({ m: req.method, u: req.url, at: performance.now(), auth: req.headers.authorization }); world(req, res, n); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}`, identity: 'bench7' }), { mode: 0o600 });
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); });
  const run = (...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, EDEN_TIME_SCALE: String(SCALE) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
    child.on('exit', (code) => { let d = null; try { d = JSON.parse(out); } catch { /* not JSON */ } resolve({ code, d, stderr: err }); });
  });
  const state = () => JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8'));
  const creates = () => seen.filter(x => x.m === 'POST' && x.u === '/v1/souls').length;
  return { seen, run, state, creates };
}
/** Pairing a dev Soul (devPair): the code, then the token. */
function pairRoutes(req, res) {
  if (req.method === 'POST' && req.url === `/v1/souls/${SOUL}/pair`) return json(res, 200, { code: 'PAIRCODE' }), true;
  if (req.method === 'POST' && req.url === '/v1/agent/pair') return json(res, 200, { token: `sim_${SOUL}_synthetic` }), true;
  return false;
}

test('503 lifecycle-pending: polls the receipt and finishes the same Soul (one create, token saved, said in words)', async (t) => {
  let polls = 0;
  const f = await fixture(t, (req, res) => {
    if (pairRoutes(req, res)) return;
    if (req.method === 'POST' && req.url === '/v1/souls') return pending503(res);
    if (req.method === 'GET' && req.url === `/v1/lifecycle/${REQ}`) return json(res, 200, { lifecycle: ++polls < 3 ? receipt('pending') : receipt('admitted', true) });
    json(res, 404, { code: 'not-found' });
  });
  const r = await f.run('create', NAME);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(f.creates(), 1, 'never a second create');
  assert.equal(polls, 3);
  assert.ok(f.seen.filter(x => x.u.startsWith('/v1/lifecycle/')).every(x => x.auth === 'Bearer dev:bench7'), 'the receipt is read with the create\'s own bearer');
  assert.equal(r.d.created, true); assert.deepEqual(r.d.soul, { id: SOUL, name: NAME });
  assert.equal(Object.keys(r.d)[0], 'slowed');
  assert.match(r.d.slowed, /^The world was still finishing my arrival \(lifecycle-pending\); it finished after \d+ s\.$/);
  assert.match(r.stderr, /the world is still finishing my arrival; waiting for it \(checking every 2 s, up to 120 s\)/);
  const s = f.state(); assert.equal(s.token, `sim_${SOUL}_synthetic`); assert.equal(s.soul, SOUL); assert.equal(s.pendingCreate, undefined);
});

test('still pending after 120 s: exit 75 with the words; the same create again resumes the wait (no new Soul); another name is refused', async (t) => {
  let ready = false;
  const f = await fixture(t, (req, res) => {
    if (pairRoutes(req, res)) return;
    if (req.method === 'POST' && req.url === '/v1/souls') return pending503(res);
    if (req.method === 'GET' && req.url === `/v1/lifecycle/${REQ}`) return json(res, 200, { lifecycle: ready ? receipt('admitted', true) : receipt('pending') });
    json(res, 404, { code: 'not-found' });
  });
  const a = await f.run('create', NAME);
  assert.equal(a.code, 75, a.stderr);
  assert.match(a.stderr, /SLOWED: The world is still finishing my arrival \(lifecycle-pending\); running the same create again keeps waiting for this Soul\./);
  assert.match(a.stderr, /error: create: lifecycle-pending — the world is still finishing my arrival after 120 s\. The Soul "Bench7" is saved in this folder: run node eden\.mjs create "Bench7" again to keep waiting; do not choose another name\./);
  assert.deepEqual(f.state().pendingCreate, { name: NAME, requestId: REQ, soulId: SOUL });
  assert.equal(f.state().token, undefined);
  const st = await f.run('status');
  assert.equal(st.d.arriving, NAME); assert.match(st.d.next, /create "Bench7" to keep waiting/);
  const other = await f.run('create', 'Bench7t1');
  assert.equal(other.code, 1); assert.match(other.stderr, /A create for "Bench7" is still finishing/);
  ready = true;
  const b = await f.run('create', NAME);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(f.creates(), 1, 'the re-run resumed the wait instead of creating');
  assert.equal(b.d.soul.id, SOUL); assert.equal(f.state().token, `sim_${SOUL}_synthetic`); assert.equal(f.state().pendingCreate, undefined);
});

test('a lost create answer: 409 name-taken by this identity\'s own pending create resumes it from the lifecycle history', async (t) => {
  let polls = 0;
  const f = await fixture(t, (req, res) => {
    if (pairRoutes(req, res)) return;
    if (req.method === 'POST' && req.url === '/v1/souls') return json(res, 409, { error: { code: 'name-taken', message: `a soul named ${NAME} already exists` } });
    if (req.method === 'GET' && req.url === '/v1/lifecycle') return json(res, 200, { contract: 'owner-lifecycle-list/1', worldId: 'w_bench', requests: [{ ...receipt('pending'), name: 'Other', requestId: 'lc_' + 'cd'.repeat(16) }, receipt('pending')], nextCursor: null });
    if (req.method === 'GET' && req.url === `/v1/lifecycle/${REQ}`) return json(res, 200, { lifecycle: ++polls < 2 ? receipt('pending') : receipt('admitted', true) });
    json(res, 404, { code: 'not-found' });
  });
  const r = await f.run('create', NAME);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.d.created, true); assert.equal(r.d.soul.id, SOUL); assert.equal(f.creates(), 1);
  assert.equal(f.state().token, `sim_${SOUL}_synthetic`);
});

test('name-taken by someone else stays name-taken; Retry-After on the pending answer is honoured; a refused arrival ends the wait', async (t) => {
  let mode = 'taken';
  const f = await fixture(t, (req, res) => {
    if (pairRoutes(req, res)) return;
    if (req.method === 'POST' && req.url === '/v1/souls') return mode === 'taken' ? json(res, 409, { error: { code: 'name-taken' } }) : pending503(res, { 'retry-after': '6' });
    if (req.method === 'GET' && req.url === '/v1/lifecycle') return json(res, 200, { contract: 'owner-lifecycle-list/1', worldId: 'w_bench', requests: [], nextCursor: null });
    if (req.method === 'GET' && req.url === '/v1/me') return json(res, 200, { me: {}, souls: [] });
    if (req.method === 'GET' && req.url === `/v1/lifecycle/${REQ}`) return json(res, 200, { lifecycle: receipt('refused') });
    json(res, 404, { code: 'not-found' });
  });
  const a = await f.run('create', NAME);
  assert.equal(a.code, 0); assert.deepEqual(a.d, { created: false, code: 'name-taken', reason: 'That name is taken. Choose another.' });
  mode = 'pending';
  const b = await f.run('create', NAME);
  assert.equal(b.code, 0, b.stderr); assert.equal(b.d.created, false); assert.equal(b.d.code, 'arrival-unavailable');
  assert.equal(f.state().pendingCreate, undefined);
  const post = f.seen.filter(x => x.u === '/v1/souls').at(-1), poll = f.seen.find(x => x.u === `/v1/lifecycle/${REQ}`);
  assert.ok(poll.at - post.at >= 6000 * SCALE * 0.9, `first check waited the stated 6 s (scaled), got ${(poll.at - post.at).toFixed(0)} ms`);
});
