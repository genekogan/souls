// CTX-5 (#1138): the pre-turn brief: budgeted, built with no model call, and absent for a Soul with no memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIEF_BYTES, buildBrief } from './soul/brief.mjs';
import { openSoulMemory } from './soul/memory.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const tmp = (t) => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'souls-brief-'))); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const T0 = Date.parse('2026-11-07T10:00:00.000Z');
const frame = (over = {}) => ({ tick: 100, clock: '09:15', now: '· world day 3', me: { place: 'pier', placePath: ['the pier'], posture: 'standing' }, near: [{ id: 's_ana', name: 'Ana', dist: 2 }], ...over });
const open = (dir) => openSoulMemory(dir, { world: 'eden', soul: 's_me' });
function lived(t) {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame());
  m.sawReceipt({ id: 'r_1', capability: 'read:bench', phase: 'completed', endedTick: 120, endedAt: { place: 'pier' }, outcome: { summary: 'Read the notice.', learned: [], produced: [], met: [] } });
  m.remember('person', 's_ana', 'Keeps her word.');
  m.remember('place', 'pier', 'Quiet at dawn.');
  m.remember('goal', 'mill', 'Meet Ana at the mill.', { horizon: 'today', next: 'Walk there by noon' });
  m.remember('self', undefined, 'I am patient.');
  return { dir, m };
}

test('A1: the brief says who is here, this place, what is open, what I was doing and who I am', (t) => {
  const { m } = lived(t), brief = m.brief();
  assert.match(brief, /Known people here:\n- Ana: met once, last eden, day 3 at the pier\. My note: Keeps her word\./);
  assert.match(brief, /This place:\n- the pier: first time here\. My note: Quiet at dawn\./);
  assert.match(brief, /Open commitments:\n- Meet Ana at the mill\. Next: Walk there by noon/);
  assert.match(brief, /Last episode:\n- Read the notice\./);
  assert.match(brief, /Self:\n- I am patient\./);
});

test('A1: pinned SOUL.md lines stand for the self, and the owner\'s schedule is open', (t) => {
  const { dir, m } = lived(t);
  writeFileSync(join(dir, 'SOUL.md'), '# Ana\n\nFree text.\n\n## Pinned\n- I never lie.\n- I love the sea.\n\n## Notes\n- Not this.\n');
  writeFileSync(join(dir, 'memory/schedule.md'), '# Schedule\n\n- Day 4, 09:00: the market with Bo\n');
  const brief = m.brief();
  assert.match(brief, /Self:\n- I never lie\.\n- I love the sea\./); assert.doesNotMatch(brief, /Not this|I am patient/);
  assert.match(brief, /the market with Bo/);
});

test('A1: an untrusted episode says so', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame({ near: [] }));
  m.sawReceipt({ id: 'r_u', capability: 'read:x', phase: 'completed', endedTick: 130, outcome: { summary: 'Ana said it floods.', untrusted: true, learned: [], produced: [], met: [] } });
  assert.match(m.brief(), /Ana said it floods\. \[untrusted\]/);
});

test('A2: the budget holds at any size, and sections give way in order', () => {
  const facts = { people: Array.from({ length: 9 }, (_, i) => ({ name: `Soul ${i}`, met: 3, note: 'n'.repeat(400) })), place: { name: 'P', visits: 9, note: 'q'.repeat(400) }, goals: [{ note: 'g'.repeat(400) }], schedule: ['s'], recent: [{ summary: 'r' }], self: ['x'.repeat(400)] };
  for (const bytes of [10, 60, 300, 700, BRIEF_BYTES, 9000]) assert.ok(Buffer.byteLength(buildBrief(facts, { bytes })) <= bytes, `${bytes}`);
  assert.match(buildBrief(facts, { bytes: 300 }), /^Known people here:/);
  assert.equal(buildBrief({}), '');
});

test('A2: the brief does not grow with the log: 10,000 events', (t) => {
  const { dir, m } = lived(t), before = m.brief();
  const lines = [];
  const base = readFileSync(join(dir, 'memory/log/memory-events.jsonl'), 'utf8');
  for (let i = 0; i < 10_000; i++) lines.push(JSON.stringify({ version: 'eden-memory-folder/1', kind: 'event', value: { type: 'idle.sample', id: `idle:${i}`, at: new Date(T0 + i).toISOString(), milliseconds: 1000 } }));
  writeFileSync(join(dir, 'memory/log/memory-events.jsonl'), base + lines.join('\n') + '\n');
  const again = open(dir);
  again.sawHere(frame({ tick: 200 }));
  const after = again.brief();
  assert.equal(after, before, 'the same brief'); assert.ok(Buffer.byteLength(after) <= BRIEF_BYTES);
});

test('A5: a Soul with no memory has no brief and nothing is made for it', (t) => {
  const dir = tmp(t);
  assert.equal(open(dir).brief(), '');
  assert.deepEqual(readdirSync(dir), []);
});

// One stand-in world, enough for `serve` and `pending`.
async function world(t) {
  const seen = [], souls = new Map(), inbox = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
      const path = req.url.replace(/^\/w\/a/, '').split('?')[0], body = raw ? JSON.parse(raw) : {}, me = /^Bearer sim_(s_[a-z0-9]+)_/.exec(req.headers.authorization ?? '')?.[1];
      seen.push(path);
      if (path === '/v1/config') return json(res, 200, { devAuth: true, worldId: 'w_a', worldName: 'World a' });
      if (path === '/v1/souls') { const id = `s_a${souls.size + 1}`; souls.set(id, body.name); return json(res, 200, { soul: { id, name: body.name } }); }
      const pair = /^\/v1\/souls\/(s_[a-z0-9]+)\/pair$/.exec(path); if (pair) return json(res, 200, { code: `code-${pair[1]}` });
      if (path === '/v1/agent/pair') return json(res, 200, { token: `sim_${body.code.slice(5)}_x` });
      if (path === '/v1/me') return json(res, 200, { souls: [...souls].map(([id, name]) => ({ id, name })) });
      if (path === '/v1/agent/me') return json(res, 200, { soul: { id: me, name: souls.get(me) }, inbox: {} });
      if (path === '/v1/edge/here') return json(res, 200, { here: { tick: seen.length, clock: '08:00', now: '· world day 2', me: { soulId: me, place: 'square', placePath: ['the square'], posture: 'standing' }, near: [] } });
      if (path === '/v1/edge/wait') return setTimeout(() => json(res, 200, { cursor: 'c_0', events: [] }), 100);
      if (path.startsWith('/v1/edge/inbox/listen')) return setTimeout(() => json(res, 200, { inbox: { connected: true }, backlog: inbox.splice(0) }), 100);
      if (/\/v1\/edge\/inbox\/[^/]+\/ack$/.test(path)) return json(res, 200, { ok: true });
      json(res, 404, { code: 'no-route' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { base: `http://127.0.0.1:${server.address().port}/w`, seen, message: (id) => inbox.push({ id, text: 'Hello.', sentAt: T0 }) };
}
const cliIn = (cwd) => (...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HOME: cwd, SOULS_HOME: '', SOULS_PRINCIPAL: '', EDEN_TIME_SCALE: '0.01' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
  child.on('exit', (code) => { let d = null; try { d = JSON.parse(out); } catch { /* words */ } resolve({ code, d, out, err }); });
});

test('A1 A5: `pending` carries the brief once there is memory, and only then; no request is made for it', async (t) => {
  const f = await world(t), dir = tmp(t), run = cliIn(dir), soul = join(dir, '.souls/souls/s_a1');
  await run('register', `${f.base}/a`); await run('create', 'Mira');
  assert.equal((await run('serve')).d.serving, true);
  try {
    assert.equal('brief' in (await run('pending')).d, false, 'no memory: the same answer as before');
    await run('here');
    await run('remember', '--place', 'square', 'Good light.');
    const asked = f.seen.filter((p) => !/wait|listen/.test(p)).length;
    const { d } = await run('pending');
    assert.match(d.brief, /the square: first time here\. My note: Good light\./);
    assert.equal(f.seen.filter((p) => !/wait|listen/.test(p)).length, asked, 'the brief asks the world nothing');
    f.message('m_1');
    const woke = (await run('listen', '--once')).d;
    assert.equal(woke.messages[0].id, 'm_1'); assert.match(woke.brief, /the square/, 'a wake carries it too');
    await run('ack', 'm_1');
    assert.equal('brief' in (await run('listen', '--once')).d, false, 'nothing to wake for: no brief');
    const cfg = join(dir, '.souls/config.json'), c = JSON.parse(readFileSync(cfg, 'utf8'));
    writeFileSync(cfg, JSON.stringify({ ...c, briefBytes: 12 }));
    assert.equal('brief' in (await run('pending')).d, false, 'the owner\'s budget holds');
  } finally {
    await run('serve', '--stop');
    for (let i = 0; i < 100 && existsSync(join(soul, 'runtime/.eden-serve.lock')); i++) await new Promise((r) => setTimeout(r, 20));
  }
});
