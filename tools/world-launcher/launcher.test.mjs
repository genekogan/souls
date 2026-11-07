// node --test tools/world-launcher/launcher.test.mjs
// Uses fake world processes (fake-world.mjs) on one block of 25 ports from LAUNCHER_TEST_PORT_BASE (default: a free
// block): base+0..19 (proxy base+19, children base+11..18; the smaller launchers below take base+0..10), the flood
// launcher base+20..21 and the Eyes launcher base+22..24. Set the base to run beside other local processes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { slugFor, listTemplates } from './registry.mjs';
import { productionSettings, decorateCommand, shadowsExisting } from './production.mjs';
import { backoffMs } from './children.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';

const BASE = Number(process.env.LAUNCHER_TEST_PORT_BASE ?? await testPort(25));
if (!Number.isInteger(BASE) || BASE < 1024 || BASE > 65535 - 24) throw Error(`LAUNCHER_TEST_PORT_BASE must be 1024–65511 (got ${process.env.LAUNCHER_TEST_PORT_BASE})`);
const at = (offset) => BASE + offset;
const PORT = at(19), RANGE = [at(11), at(18)];
const dir = mkdtempSync(join(tmpdir(), 'launcher-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'hello-hamlet.json'), JSON.stringify({ schema: 'genesis/1', name: 'Hello hamlet', description: 'a hamlet', batches: [{ ops: [{ op: 'place' }] }] }));
writeFileSync(join(templatesDir, 'island.json'), JSON.stringify({ schema: 'genesis/1', name: 'Island', description: 'sea all round', batches: [] }));
writeFileSync(join(templatesDir, 'broken.json'), '{ not json');
writeFileSync(join(templatesDir, 'retired.json'), JSON.stringify({ schema: 'genesis/1', hidden: true, name: 'Retired', description: 'gone from the dialog', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(join(webDir, 'assets'), { recursive: true });
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Sim</title>');
writeFileSync(join(webDir, 'assets', 'a.js'), 'console.log(1)');
const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), ...(w.templateFile ? { GENESIS_FILE: w.templateFile } : {}) } });
let L;
const open = () => openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 4, log: () => {} });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const post = (body) => api('/__sim/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
before(async () => { L = await open(); });
after(async () => { await L?.close(); });

test('slugs are url-safe, unique and avoid reserved names', () => {
  assert.equal(slugFor("Gene's Valley"), 'genes-valley');
  assert.equal(slugFor('Gene’s  Valley!!'), 'genes-valley');
  assert.equal(slugFor('Café Ñandú'), 'cafe-nandu');
  assert.equal(slugFor('42 Towers'), 'world-42-towers');
  assert.equal(slugFor('Mars'), 'my-mars');
  // nothing may land under a world the existing release serves, even by a /w/<key>* glob
  assert.equal(slugFor('Eden Garden'), 'my-eden-garden');
  assert.equal(slugFor('Marshmallow Hills'), 'my-marshmallow-hills');
  assert.equal(slugFor('Little Martians'), 'little-martians');
  assert.equal(slugFor('littlemartians'), 'my-littlemartians');
  assert.equal(slugFor('Toy'), 'my-toy');
  assert.equal(slugFor('mars', new Set(['my-mars'])), 'my-mars-2');
  assert.equal(slugFor('☃'), 'world');
  assert.equal(slugFor('a', new Set(['a', 'a-2'])), 'a-3');
  assert.match(slugFor('x'.repeat(80)), /^[a-z][a-z0-9-]{0,31}$/);
});
test('templates: empty first, hello hamlet next, broken files skipped', () => {
  const t = listTemplates(templatesDir).map((x) => x.id);
  assert.deepEqual(t, ['empty', 'hello-hamlet', 'island']);
  assert.deepEqual(listTemplates(templatesDir, { all: true }).map((x) => x.id), ['empty', 'hello-hamlet', 'island', 'retired'], 'a hidden template is still found for worlds made from it');
  assert.equal(backoffMs(0, () => 0.5), 500); assert.equal(backoffMs(3, () => 0.5), 4000); assert.equal(backoffMs(20, () => 0.5), 150_000);   // full jitter (lane L1): uniform under min(5 min, 1 s * 2^n)
});
test('homepage and assets come from the web build', async () => {
  const r = await api('/'); assert.equal(r.status, 200); assert.match(await r.text(), /<title>Sim/);
  for (const path of ['/old', '/old/']) for(const method of ['GET','HEAD']) {
    const old = await api(path+'?source=bookmark', {method,redirect:'manual'});
    assert.equal(old.status,308);assert.equal(old.headers.get('location'),'/?source=bookmark#');
    assert.equal(old.headers.get('cache-control'),'no-store');assert.equal(await old.text(),'','redirect never serves legacy markup');
  }
  assert.equal((await api('/old-world')).status,404,'similar unknown paths do not redirect');
  assert.equal((await api('/old',{method:'POST'})).status,404,'no legacy mutation endpoint is introduced');
  assert.equal((await api('/assets/a.js')).status, 200);
  assert.equal((await api('/assets/../../etc/passwd')).status, 404);
});
test('create → healthy → listed; the template reaches the world as GENESIS_FILE', async () => {
  const r = await post({ name: 'Gene’s Valley', template: 'hello-hamlet' });
  assert.equal(r.status, 201); const b = await r.json();
  assert.equal(b.slug, 'genes-valley'); assert.equal(b.url, '/w/genes-valley/?dev=1&new=1');
  const h = await (await api('/w/genes-valley/healthz')).json();
  assert.match(h.genesis, /hello-hamlet\.json$/);
  const list = await (await api('/__sim/worlds.json')).json();
  assert.equal(list.contract, 'local-worlds/1'); assert.equal(list.launcher, 'world-launcher/1');
  const w = list.worlds.find((x) => x.slug === 'genes-valley');
  assert.equal(w.basePath, '/w/genes-valley'); assert.equal(w.name, 'Gene’s Valley'); assert.equal(w.templateName, 'Hello hamlet');
  assert.equal(w.entities, 3); assert.equal(w.god, false); assert.equal(w.status, 'running');
  assert.ok(list.templates.some((t) => t.id === 'island') && !list.templates.some((t) => 'file' in t));
  const again = await (await post({ name: "Gene's valley" })).json();
  assert.equal(again.slug, 'genes-valley-2');
  const e = await (await api('/w/genes-valley-2/healthz')).json(); assert.equal(e.genesis, null);
});
test('bad requests are refused with reasons', async () => {
  assert.equal((await post({ name: '' })).status, 400);
  assert.equal((await post({ name: 'x', template: 'nope' })).status, 400);
  assert.equal((await api('/__sim/worlds', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await api('/w/nobody/healthz')).status, 404);
  const html = await api('/w/nobody/', { headers: { accept: 'text/html' } }); assert.equal(html.status, 404); assert.match(await html.text(), /No world called/);
  const r = await api('/w/genes-valley?dev=1', { redirect: 'manual' }); assert.equal(r.status, 308); assert.equal(r.headers.get('location'), '/w/genes-valley/?dev=1');
});
test('proxy: request bodies, host header, SSE streaming and upgrades pass through', async () => {
  const echo = await api('/w/genes-valley/echo', { method: 'POST', body: 'hello' });
  assert.equal(await echo.text(), 'hello'); assert.equal(echo.headers.get('x-host'), `127.0.0.1:${PORT}`);
  const spoof = await api('/w/genes-valley/echo', { method: 'POST', body: 'x', headers: { 'x-forwarded-for': '203.0.113.7' } });
  assert.equal(spoof.headers.get('x-xff'), '127.0.0.1', 'not behind a proxy: the connecting address, never a client-supplied one');
  const t0 = performance.now(); const sse = await api('/w/genes-valley/sse');
  const reader = sse.body.getReader(); const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /data: 0/); assert.ok(performance.now() - t0 < 300, 'first event arrives before the stream ends');
  let rest = ''; for (;;) { const c = await reader.read(); if (c.done) break; rest += new TextDecoder().decode(c.value); }
  assert.match(rest, /data: 3/);
  const echoed = await new Promise((yes, no) => {
    const s = connect(PORT, '127.0.0.1', () => s.write('GET /w/genes-valley/ws HTTP/1.1\r\nHost: x\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n'));
    let buf = ''; s.on('data', (d) => { buf += d; if (buf.includes('101') && !buf.includes('PING')) s.write('ping'); if (buf.includes('PING')) { s.destroy(); yes(buf); } }); s.on('error', no);
  });
  assert.match(echoed, /101 Switching/); assert.match(echoed, /PING/);
});
test('the launcher notes looks, agents and previews; previews need a god token', async () => {
  await api('/w/genes-valley/?shot=1&eye=1,2,3');
  await api('/w/genes-valley/v1/god/status', { headers: { authorization: 'Bearer god_x', 'user-agent': 'node' } });
  await api('/w/genes-valley/v1/god/preview', { method: 'POST', body: '{}' });
  await new Promise((r) => setTimeout(r, 50));
  const one = await (await api('/__sim/worlds/genes-valley')).json();
  assert.equal(one.seen.looks, 1); assert.ok(one.seen.agentSeenAt); assert.equal(one.seen.previews, 1);
  assert.equal((await api('/__sim/worlds/genes-valley/previews')).status, 401);
  const p = await (await api('/__sim/worlds/genes-valley/previews', { headers: { authorization: 'Bearer god_ok' } })).json();
  assert.equal(p.previews[0].id, 'pv_test');
});
test('a crashed world restarts by itself', async () => {
  const before = (await (await api('/__sim/launcher')).json()).children.find((c) => c.slug === 'genes-valley');
  await api('/w/genes-valley/crash');
  let after;
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 100)); after = (await (await api('/__sim/launcher')).json()).children.find((c) => c.slug === 'genes-valley'); if (after.status === 'running' && after.pid !== before.pid) break; }
  assert.equal(after.status, 'running'); assert.notEqual(after.pid, before.pid); assert.equal(after.restarts, 1);
  assert.equal(after.lastExit.code, 3);
  assert.equal((await api('/w/genes-valley/healthz')).status, 200);
});
test('a world that cannot boot is not registered', async () => {
  process.env.FAKE_BOOT_FAIL = 'doomed';
  const r = await post({ name: 'Doomed' }); delete process.env.FAKE_BOOT_FAIL;
  assert.equal(r.status, 500); assert.equal((await r.json()).code, 'boot-failed');
  const list = await (await api('/__sim/worlds.json')).json(); assert.ok(!list.worlds.some((w) => w.slug === 'doomed'));
});
test('the registry survives a launcher restart and worlds wake again', async () => {
  await L.close(); L = await open();
  const reg = JSON.parse(readFileSync(join(dir, 'data', 'worlds.json'), 'utf8'));
  assert.deepEqual(reg.worlds.map((w) => w.slug).sort(), ['genes-valley', 'genes-valley-2']);
  for (let i = 0; i < 50 && (await api('/w/genes-valley/healthz')).status !== 200; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await api('/w/genes-valley/healthz')).status, 200);
});

test('with every port taken, the least recently used idle world sleeps to make room, and wakes on its next visit', async () => {
  const L2 = await openLauncher({ port: at(10), range: [at(9), at(9)], dataDir: join(dir, 'data-small'), webDir, templatesDir, command, idleMs: 0, eager: 0, log: () => {} });
  try {
    const post2 = (name) => fetch(`http://127.0.0.1:${at(10)}/__sim/worlds`, { method: 'POST', body: JSON.stringify({ name }) });
    assert.equal((await post2('First')).status, 201);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await post2('Second')).status, 201);
    const kids = async () => Object.fromEntries((await (await fetch(`http://127.0.0.1:${at(10)}/__sim/launcher`)).json()).children.map((c) => [c.slug, c.status]));
    assert.deepEqual(await kids(), { first: 'asleep', second: 'running' });
    assert.equal((await fetch(`http://127.0.0.1:${at(10)}/w/first/healthz`)).status, 200);
    assert.deepEqual(await kids(), { first: 'running', second: 'asleep' });
  } finally { await L2.close(); }
});
test('an idle world falls asleep (frozen in place) and wakes at once on its next visit; a watched or busy one stays awake', async () => {
  const P = at(4), base = `http://127.0.0.1:${P}`;
  const L4 = await openLauncher({ port: P, range: [at(2), at(3)], dataDir: join(dir, 'data-sleep'), webDir, templatesDir, command, sleepMs: 400, eager: 0, log: () => {} });
  const kids = async () => Object.fromEntries((await (await fetch(`${base}/__sim/launcher`)).json()).children.map((c) => [c.slug, c.status]));
  const { execFileSync } = await import('node:child_process');
  const stateOf = (pid) => execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()[0];
  try {
    for (const name of ['Idle', 'Held']) assert.equal((await fetch(`${base}/__sim/worlds`, { method: 'POST', body: JSON.stringify({ name }) })).status, 201);
    // a viewer on Held keeps it awake
    const ws = await new Promise((yes, no) => { const s = connect(P, '127.0.0.1', () => s.write('GET /w/held/ws HTTP/1.1\r\nHost: x\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n')); s.once('data', () => yes(s)); s.on('error', no); });
    for (let i = 0; i < 40 && (await kids()).idle !== 'asleep'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await kids(), { idle: 'asleep', held: 'running' });
    const k = L4.pool.state('idle'); assert.equal(k.frozen, true);
    assert.equal(stateOf(k.child.pid), 'T', 'the process is stopped, not exited');
    const pid = k.child.pid;
    // a monitor's health read is answered (the world wakes for it) but is not a visit: the world goes back to sleep
    assert.equal((await fetch(`${base}/w/idle/healthz`)).status, 200);
    for (let i = 0; i < 40 && (await kids()).idle !== 'asleep'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await kids()).idle, 'asleep', 'a passive read does not keep it awake');
    const t0 = Date.now(); const r = await fetch(`${base}/w/idle/slow?ms=1`); const wakeMs = Date.now() - t0;
    assert.equal(r.status, 200); assert.ok(wakeMs < 500, `woke in ${wakeMs} ms`);
    assert.equal(L4.pool.state('idle').child.pid, pid, 'the same process, thawed');
    assert.equal((await kids()).idle, 'running');
    // a request in flight (a god's long-poll) keeps a world awake past the idle time
    const slow = fetch(`${base}/w/idle/slow?ms=1200`);
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal((await kids()).idle, 'running', 'busy with a long request');
    assert.equal((await slow).status, 200);
    ws.destroy();
    for (let i = 0; i < 40 && Object.values(await kids()).some((s) => s !== 'asleep'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await kids(), { idle: 'asleep', held: 'asleep' }, 'with the viewer gone, Held sleeps too');
    // a handover hands the next launcher running processes only: everything asleep is thawed first
    const list = L4.pool.handoverList();
    assert.deepEqual(list.map((x) => x.slug).sort(), ['held', 'idle']);
    for (const x of list) assert.notEqual(stateOf(x.pid), 'T');
    for (let i = 0; i < 40 && (await kids()).held !== 'asleep'; i++) await new Promise((r) => setTimeout(r, 100));
    // a frozen world still stops cleanly (thawed first, so it handles SIGTERM)
    const exited = new Promise((r) => L4.pool.state('held').child.once('exit', (code, signal) => r(signal ?? code)));
    await L4.pool.stop('held'); assert.ok(['SIGTERM', 0].includes(await exited));
  } finally { await L4.close(); }
});
test('the Eyes render worker (user agent EdenEyes/1) is not a watcher: its page and socket let the world sleep', async () => {
  // the Eyes launcher: base+22..24
  const P = at(24), base = `http://127.0.0.1:${P}`, UA = 'Mozilla/5.0 HeadlessChrome EdenEyes/1';
  const L6 = await openLauncher({ port: P, range: [at(22), at(23)], dataDir: join(dir, 'data-eyes'), webDir, templatesDir, command, sleepMs: 400, eager: 0, log: () => {} });
  const kids = async () => Object.fromEntries((await (await fetch(`${base}/__sim/launcher`)).json()).children.map((c) => [c.slug, c.status]));
  try {
    assert.equal((await fetch(`${base}/__sim/worlds`, { method: 'POST', body: JSON.stringify({ name: 'Seen' }) })).status, 201);
    const used = L6.pool.state('seen').lastUsed;
    const ws = await new Promise((yes, no) => { const s = connect(P, '127.0.0.1', () => s.write(`GET /w/seen/ws HTTP/1.1\r\nHost: x\r\nUser-Agent: ${UA}\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n`)); s.once('data', () => yes(s)); s.on('error', no); });
    assert.equal((await fetch(`${base}/w/seen/slow?ms=1`, { headers: { 'user-agent': UA } })).status, 200);
    assert.equal(L6.pool.state('seen').lastUsed, used, 'an eyes request is not a use');
    for (let i = 0; i < 40 && (await kids()).seen !== 'asleep'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await kids()).seen, 'asleep', 'the eyes socket does not hold the world awake');
    ws.destroy();
    assert.equal(L6.pool.state('seen').lastUsed, used, 'the eyes socket leaving is not a use either');
  } finally { await L6.close(); }
});

test('a flood refusal (P2) neither wakes a sleeping world nor counts as its use', async () => {
  const P = at(20), base = `http://127.0.0.1:${P}`;
  const L5 = await openLauncher({ port: P, range: [at(21), at(21)], dataDir: join(dir, 'data-flood'), webDir, templatesDir, command, sleepMs: 400, eager: 0, log: () => {}, floodLimits: { godTokenPerS: 0.001, godTokenBurst: 1 } });
  const kids = async () => Object.fromEntries((await (await fetch(`${base}/__sim/launcher`)).json()).children.map((c) => [c.slug, c.status]));
  const asleep = async () => { for (let i = 0; i < 40 && (await kids()).calm !== 'asleep'; i++) await new Promise((r) => setTimeout(r, 100)); return (await kids()).calm; };
  const god = { headers: { authorization: 'Bearer god_ok' } };
  try {
    assert.equal((await fetch(`${base}/__sim/worlds`, { method: 'POST', body: JSON.stringify({ name: 'Calm' }) })).status, 201);
    assert.equal((await fetch(`${base}/w/calm/v1/god/edits?limit=1`, god)).status, 200, 'the first request is within the burst');
    assert.equal(await asleep(), 'asleep');
    const pid = L5.pool.state('calm').child.pid, used = L5.pool.state('calm').lastUsed;
    const t0 = Date.now(), r = await fetch(`${base}/w/calm/v1/god/edits?limit=1`, god);
    assert.equal(r.status, 429); assert.ok(r.headers.get('retry-after')); assert.ok(Date.now() - t0 >= 900, 'held about a second');
    assert.match((await r.json()).message, /slow down/);
    assert.equal((await kids()).calm, 'asleep', 'refused before the world was woken');
    assert.equal(L5.pool.state('calm').frozen, true);
    assert.equal(L5.pool.state('calm').child.pid, pid);
    assert.equal(L5.pool.state('calm').lastUsed, used, 'a refusal is not a use');
  } finally { await L5.close(); }
});
test('children a hard-killed launcher left behind are stopped before their worlds start again', async () => {
  const { spawn } = await import('node:child_process');
  const orphan = spawn(process.execPath, [fake], { env: { ...process.env, WORLD_KEY: 'orphan', PORT: String(at(8)) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  const d = join(dir, 'data-orphan'); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'children.json'), JSON.stringify({ orphan: { pid: orphan.pid, port: at(8), script: fake } }));
  const exited = new Promise((r) => orphan.once('exit', (code, signal) => r(signal ?? code)));
  const L3 = await openLauncher({ port: at(7), range: [at(5), at(6)], dataDir: d, webDir, templatesDir, command, eager: 0, log: () => {} });
  try { assert.equal(await exited, 'SIGTERM'); } finally { await L3.close(); }
});

// ---------- production mode (lane P3)
test('production settings refuse unsafe combinations', () => {
  const ok = { range: [1, 4] };
  assert.throws(() => productionSettings({ ...ok, devAuth: true, publicOrigin: 'https://sim.eden.art' }, 'http://127.0.0.1:1'), /dev auth on a public https origin/);
  assert.throws(() => productionSettings({ ...ok, devAuth: false }, 'http://127.0.0.1:1'), /--auth-env file is required/);
  assert.throws(() => productionSettings({ ...ok, authEnvFile: 'relative.env' }, 'http://127.0.0.1:1'), /absolute path/);
  assert.throws(() => productionSettings({ ...ok, maxRunning: 5 }, 'http://127.0.0.1:1'), /exceeds the 4 child ports/);
  assert.throws(() => productionSettings({ ...ok, publicOrigin: 'https://sim.eden.art/w' }, 'x'), /scheme:\/\/host/);
  const local = productionSettings(ok, 'http://127.0.0.1:1');
  assert.equal(local.devAuth, true); assert.equal(local.publicOrigin, 'http://127.0.0.1:1'); assert.equal(local.maxRunning, 4); assert.equal(local.maxWorlds, 200);
  assert.ok(shadowsExisting('mars') && shadowsExisting('eden-2') && shadowsExisting('toyland') && !shadowsExisting('my-mars') && !shadowsExisting('little-martians'));
});
test('children get edge minds, no model keys, the public origin; the auth file stays a path', () => {
  const envFile = join(dir, 'auth.env'); writeFileSync(envFile, 'FAKE_FROM_FILE=1\n');
  const s = productionSettings({ range: [1, 4], authEnvFile: envFile, publicOrigin: 'https://sim.eden.art', worldHeapMb: 768 }, 'http://127.0.0.1:1');
  assert.equal(s.devAuth, false);
  const c = decorateCommand({ cmd: 'node', args: ['apps/server/src/main.ts'], env: { DEV_AUTH: '1', MIND_DRIVER: 'central', ANTHROPIC_API_KEY: 'x', BRAIN_MODE: 'live' } }, s);
  assert.deepEqual(c.args, ['apps/server/src/main.ts'], 'defaultCommand (P1) adds --env-file; decorate leaves args alone');
  assert.equal(c.env.MIND_DRIVER, 'edge'); assert.equal(c.env.DEV_AUTH, '0'); assert.equal(c.env.ANTHROPIC_API_KEY, ''); assert.equal(c.env.BRAIN_MODE, 'fake');
  assert.equal(c.env.PUBLIC_URL, 'https://sim.eden.art'); assert.equal(c.env.NODE_OPTIONS, '--max-old-space-size=768');
  assert.ok(!JSON.stringify(c).includes('FAKE_FROM_FILE'), 'the launcher never reads the file');
});
test('production launcher under --base /worlds: one prefix for page, assets, API, worlds and WebSocket; caps, limits, health', async () => {
  const P = at(4), base = `http://127.0.0.1:${P}`, B = '/worlds';
  const L4 = await openLauncher({ port: P, range: [at(1), at(3)], dataDir: join(dir, 'data-prod'), webDir, templatesDir, command, eager: 0, log: () => {}, base: B,
    publicOrigin: `http://sim-worlds.localhost:${at(4)}`, devAuth: true, worldHeapMb: 512, maxWorlds: 3, maxRunning: 2, idleMs: 60_000, createLimit: 3 });
  const make = (name, headers = {}) => fetch(`${base}${B}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ name }) });
  try {
    const h = await (await fetch(`${base}${B}/__sim/healthz`)).json();
    assert.equal(h.ok, true); assert.equal(h.auth, 'dev'); assert.equal(h.maxWorlds, 3); assert.equal(h.maxRunning, 2); assert.equal(typeof h.memAvailableMb, 'number');
    assert.equal((await fetch(`${base}${B}/__sim/healthz`, { headers: { 'x-forwarded-for': '1.2.3.4' } }).then((r) => r.json())).memAvailableMb, undefined);
    assert.equal((await fetch(`${base}${B}`, { redirect: 'manual' })).headers.get('location'), `${B}/`);
    assert.match(await (await fetch(`${base}${B}/`)).text(), /<title>Sim/);
    assert.equal(await (await fetch(`${base}${B}/assets/a.js`)).text(), 'console.log(1)');
    const a = await make('Mars'); assert.equal(a.status, 201); const ab = await a.json();
    assert.equal(ab.slug, 'my-mars'); assert.equal(ab.url, `${B}/w/my-mars/?dev=1&new=1`);
    const env = await (await fetch(`${base}${B}/w/my-mars/env`)).json();
    assert.deepEqual(env, { MIND_DRIVER: 'edge', DEV_AUTH: '1', BRAIN_MODE: 'fake', PUBLIC_URL: `http://sim-worlds.localhost:${at(4)}`, ANTHROPIC_API_KEY: '', NODE_OPTIONS: null, FAKE_FROM_FILE: null, WORLD_PATH: `${B}/w/my-mars` });
    // lane L1: the heap is the child's own node flag (--world-heap-mb is the default only), never NODE_OPTIONS
    const argv = await (await fetch(`${base}${B}/w/my-mars/argv`)).json(); assert.deepEqual([argv.execArgv, argv.heapMb], [['--max-old-space-size=512'], '512']);
    // behind the reverse proxy the visitor's x-forwarded-for reaches the world unchanged
    assert.equal((await fetch(`${base}${B}/w/my-mars/echo`, { method: 'POST', body: 'x', headers: { 'x-forwarded-for': '203.0.113.7' } })).headers.get('x-xff'), '203.0.113.7');
    const ws = await new Promise((yes, no) => { const s = connect(P, '127.0.0.1', () => s.write(`GET ${B}/w/my-mars/ws HTTP/1.1\r\nHost: x\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n`)); s.once('data', (d) => { s.destroy(); yes(String(d)); }); s.on('error', no); });
    assert.match(ws, /101 Switching/);
    const list = await (await fetch(`${base}${B}/__sim/worlds.json`)).json();
    assert.equal(list.worlds[0].url, `${B}/w/my-mars/?dev=1`); assert.equal(list.worlds[0].basePath, `${B}/w/my-mars`); assert.equal(list.limits.maxRunning, 2);
    // the other release's root paths are not ours: no launcher API, no worlds, no writes outside the base
    assert.equal((await fetch(`${base}/__sim/worlds`, { method: 'POST', body: '{"name":"x"}' })).status, 404);
    assert.equal((await fetch(`${base}/w/my-mars/env`)).status, 404, 'a GET outside the base only reaches public static files');
    assert.equal((await make('Second')).status, 201);
    // both slots in use, neither idle long enough to sleep: the third is refused (and not registered)
    const full = await make('Third'); assert.equal(full.status, 503); assert.equal((await full.json()).code, 'capacity');
    assert.ok(!(await (await fetch(`${base}${B}/__sim/worlds.json`)).json()).worlds.some((w) => w.slug === 'third'));
    // diagnostics only for direct local requests, not through the reverse proxy
    assert.equal((await fetch(`${base}${B}/__sim/launcher`, { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 404);
    assert.equal((await (await fetch(`${base}${B}/__sim/launcher`)).json()).maxRunning, 2);
  } finally { await L4.close(); }
  assert.throws(() => productionSettings({ range: [1, 2], base: '/assets' }, 'http://x'), /belongs to the existing release/);
  assert.throws(() => productionSettings({ range: [1, 2], base: '/a/b' }, 'http://x'), /one path segment/);
});
test('the world cap, the creation limit, and a watched world never sleeps', async () => {
  const P = at(0), base = `http://127.0.0.1:${P}`;
  const L5 = await openLauncher({ port: P, range: [at(1), at(1)], dataDir: join(dir, 'data-cap'), webDir, templatesDir, command, eager: 0, log: () => {}, maxWorlds: 2, idleMs: 0, createLimit: 2 });
  const make = (name, ip = '9.9.9.9') => fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ name }) });
  try {
    assert.equal((await make('One')).status, 201);
    // a viewer holds a WebSocket open on One: Two cannot put it to sleep
    const ws = await new Promise((yes, no) => { const s = connect(P, '127.0.0.1', () => s.write('GET /w/one/ws HTTP/1.1\r\nHost: x\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n')); s.once('data', () => yes(s)); s.on('error', no); });
    await new Promise((r) => setTimeout(r, 20));
    const two = await make('Two'); assert.equal(two.status, 503);
    ws.destroy(); await new Promise((r) => setTimeout(r, 50));
    assert.equal((await make('Two')).status, 201, 'with the viewer gone, One sleeps and Two starts');
    assert.equal((await make('Three', '8.8.8.8')).status, 409, 'world cap');
    assert.equal((await make('Four')).status, 429, 'creation limit per visitor');
  } finally { await L5.close(); }
});
