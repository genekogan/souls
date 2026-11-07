// node --test tools/world-launcher/ceilings.test.mjs — lane L1, LOAD-CONTRACT §2b: the launcher's ceilings on the Soul API.
// Fake worlds on a free block of ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { launcherFlood, requestClass, soulCeilings, SOUL_CEILINGS } from './flood.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(10);

const req = (method, headers = {}) => ({ method, headers });

test('request classes follow LOAD-CONTRACT §2', () => {
  assert.equal(requestClass('/v1/edge/act', 'POST'), 'C1'); assert.equal(requestClass('/v1/edge/here'), 'C2');
  assert.equal(requestClass('/v1/edge/map'), 'C3'); assert.equal(requestClass('/v1/world/snapshot'), 'C3');
  assert.equal(requestClass('/v1/edge/public/souls/s_fe22d9c553'), 'C3'); // the visitor page's Soul chip needs no token (402.2)
  const mesh='/v1/edge/body/assets/body_'+ 'a'.repeat(64)+'.glb';
  assert.equal(requestClass(mesh),'C3');assert.equal(requestClass(mesh,'HEAD'),'C3');assert.equal(requestClass(mesh,'PUT'),'C1');assert.equal(requestClass('/v1/edge/body'),'C2');
  assert.equal(requestClass('/v1/edge/inbox/listen'), 'listen'); assert.equal(requestClass('/v1/edge/wait'), 'listen');
  assert.equal(requestClass('/v1/edge/receipts/r1'), 'C0'); assert.equal(requestClass('/healthz'), 'C0'); assert.equal(requestClass('/v1/god/act', 'POST'), null);
});

test('ceilings: address rate, listen per Soul / account / address, account rate, world budget, body, token', () => {
  let t = 0; const c = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ ipPer10s: 5, worldBudgetRps: 3, accountHeavyPerMin: 8, soulListen: 2, accountListen: 8, listenHoldMs: 0 }) });   // (no hold: refused at once; holds below)
  const soul = (tok, ip = '1.1.1.1', m = 'POST') => req(m, { authorization: `Bearer sim_s_${tok}_x`, 'x-forwarded-for': ip });
  const ok = (r) => { assert.ok(r && !r.refuse, JSON.stringify(r?.refuse?.body)); r.release(); return r; };
  for (let i = 0; i < 6; i++) ok(c.check(soul(`a${i}`, `9.9.9.${i}`), "w", "/v1/edge/act", true));   // the budget's 2 s burst, 6 Souls
  const busy = c.check(soul('b', '2.2.2.2'), 'w', '/v1/edge/act', true);
  assert.equal(busy.refuse.status, 503); assert.equal(busy.refuse.body.code, 'world.busy'); assert.ok(Number(busy.refuse.headers['retry-after']) >= 1);
  t += 10_000;
  for (let i = 0; i < 5; i++) { const r = c.check(soul('c', '3.3.3.3', 'GET'), 'w2', '/v1/edge/receipts/x', true); ok(r); }
  assert.equal(c.check(soul('c', '3.3.3.3', 'GET'), 'w2', '/v1/edge/receipts/x', true).refuse.body.code, 'client.rate');
  ok(c.check(soul('c', '3.3.3.3', 'GET'), 'w2', '/v1/edge/receipts/x', false));   // not behind the proxy: no address limit
  t += 10_000;
  const l1 = c.check(soul('d', '203.0.113.1', 'GET'), 'w3', '/v1/edge/inbox/listen', true), l2 = c.check(soul('d', '203.0.113.2', 'GET'), 'w3', '/v1/edge/inbox/listen', true);
  assert.equal(c.check(soul('d', '203.0.113.3', 'GET'), 'w3', '/v1/edge/inbox/listen', true).refuse.body.code, 'soul.busy');
  l1.release(); ok(c.check(soul('d', '203.0.113.3', 'GET'), 'w3', '/v1/edge/inbox/listen', true)); l2.release();
  // one account's Souls share its listen and rate ceilings once the world names the account
  const souls = ['e1', 'e2', 'e3', 'e4', 'e5'].map((x) => soul(x, `5.5.5.${x}`, 'GET'));
  for (const s of souls) c.learn(c.soulOf(s), 'acct-1');
  const held = []; for (let i = 0; i < 8; i++) held.push(c.check(souls[i % 5], 'w4', '/v1/edge/inbox/listen', true));
  assert.ok(held.every((h) => !h.refuse)); assert.equal(c.check(souls[3], 'w4', '/v1/edge/inbox/listen', true).refuse.body.code, 'account.rate');   // souls[3] holds one
  held.forEach((h) => h.release());
  t += 60_000; const big = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ accountHeavyPerMin: 8, worldBudgetRps: 100 }) });
  for (const s of souls) big.learn(big.soulOf(s), 'acct-1');
  for (let i = 0; i < 2; i++) ok(big.check(souls[i], 'w5', '/v1/edge/here', true));   // burst = a quarter minute's worth
  assert.equal(big.check(souls[2], 'w5', '/v1/edge/here', true).refuse.body.code, 'account.rate');
  assert.equal(c.check(req('POST', { authorization: 'Bearer sim_s_f_x', 'content-length': String(65 * 1024) }), 'w6', '/v1/edge/act', false).refuse.status, 413);
  assert.equal(c.check(req('GET', {}), 'w6', '/v1/edge/here', false).refuse.status, 401);
  // address concurrency on the Soul API: ten in flight from one address, the eleventh refused
  const many = []; for (let i = 0; i < SOUL_CEILINGS.ipConcurrent; i++) many.push(c.check(req('GET', { 'x-forwarded-for': '6.6.6.6' }), `w7-${i}`, '/v1/edge/receipts/r1', true));
  assert.equal(c.check(req('GET', { 'x-forwarded-for': '6.6.6.6' }), 'w8', '/v1/edge/receipts/r1', true).refuse.body.code, 'client.rate');
  assert.equal(c.socket('w8', '6.6.6.6'), null); many.forEach((m) => m.release()); assert.ok(c.socket('w8', '6.6.6.6'));
});

test('world budget (lane B-serve): a C2 read for the read workers skips it; chargeWorld takes it (refusing, or forced after the fact); C1 never skips', () => {
  let t = 0; const c = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ worldBudgetRps: 2, accountHeavyPerMin: 100000 }) });
  const get = (m = 'GET') => ({ method: m, headers: { authorization: 'Bearer sim_s_z_x' } });
  for (let i = 0; i < 100; i++) { const r = c.check(get(), 'w', '/v1/edge/here', false, { toWorker: true }); assert.ok(r && !r.refuse && r.worldDeferred); r.release(); }
  for (let i = 0; i < 4; i++) { const r = c.check(get(), 'w', '/v1/edge/here', false); assert.ok(!r.refuse && !r.worldDeferred, `main read ${i}`); r.release(); }   // the 2 s burst is untouched
  assert.equal(c.check(get(), 'w', '/v1/edge/here', false).refuse.body.code, 'world.busy');
  // an act is C1: toWorker never exempts it
  t += 2000; for (let i = 0; i < 4; i++) c.check(get('POST'), 'w', '/v1/edge/act', false, { toWorker: true }).release();
  assert.equal(c.check(get('POST'), 'w', '/v1/edge/act', false, { toWorker: true }).refuse.body.code, 'world.busy');
  // a deferred read that reaches main: charged; refused when spent; forced debits push the next read back
  t += 2000; assert.equal(c.chargeWorld('w'), null); assert.equal(c.chargeWorld('w'), null); assert.equal(c.chargeWorld('w'), null); assert.equal(c.chargeWorld('w'), null);
  assert.equal(c.chargeWorld('w').refuse.body.code, 'world.busy');
  assert.equal(c.chargeWorld('w', { force: true }), null);   // already answered by main: counted, never refused
  t += 500; assert.ok(c.chargeWorld('w').refuse, 'in debt: the next main read waits');
  t += 1500; assert.equal(c.chargeWorld('w'), null);
});

test('god and world routes are not under the Soul ceilings: 200 god calls from one address in 10 s, never client.rate', () => {
  let t = 0; const c = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ ipPer10s: 5 }) });
  const flood = launcherFlood({ now: () => t, log: () => {} });
  const god = (m = 'POST') => req(m, { authorization: 'Bearer god_creator_secret', 'x-forwarded-for': '7.7.7.7' });
  const held = [];   // all 200 still in flight: neither the address rate nor its concurrency applies
  for (let i = 0; i < 200; i++, t += 50) {
    const g = c.check(god(), 'eden', '/v1/god/query', true); assert.ok(!g?.refuse, JSON.stringify(g?.refuse?.body)); if (g) held.push(g);
    const f = flood(god(), '/v1/god/query', true, 'eden'); if (f) assert.equal(f.body.limit.scope, 'god-token');
  }
  for (const r of ['/v1/world/seq', '/v1/god/status', '/healthz', '/v1/config']) assert.ok(!c.check(god('GET'), 'eden', r, true)?.refuse, r);
  assert.equal(c.check(req('GET', { 'x-forwarded-for': '7.7.7.7' }), 'eden', '/v1/world/snapshot', true).cls, 'C3');   // still micro-cached
  assert.equal(c.refused('eden')['client.rate'], undefined);
  // the same address's Soul requests still count against ipPer10s (5 here), and the god calls used none of it
  const soul = () => req('GET', { authorization: 'Bearer sim_s_g_x', 'x-forwarded-for': '7.7.7.7' });
  for (let i = 0; i < 5; i++) { const r = c.check(soul(), 'eden', '/v1/edge/receipts/r1', true); assert.ok(r && !r.refuse); r.release(); }
  assert.equal(c.check(soul(), 'eden', '/v1/edge/receipts/r1', true).refuse.body.code, 'client.rate');
  held.forEach((h) => h.release());
  // past the god bucket (30/s, burst 900) the refusal is the god token's, never the address's
  const tight = launcherFlood({ now: () => t, log: () => {}, limits: { godTokenBurst: 30 } }); const codes = new Set();
  for (let i = 0; i < 200; i++) { const f = tight(god(), '/v1/god/query', true, 'eden'); if (f) codes.add(f.body.limit.scope); }
  assert.deepEqual([...codes], ['god-token']);
});

test('through the launcher: 200 god calls (50 at a time) from one address are never refused client.rate; a Soul request still is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1-god-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port) } });
  const P = P0 + 6, base = `http://127.0.0.1:${P}`;
  const L = await openLauncher({ port: P, range: [P0 + 7, P0 + 9], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false, publicOrigin: 'http://sim.test', devAuth: true, floodLimits: { godTokenBurst: 150 } });
  try {
    const { slug } = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Godspeed' }) })).json();
    await (await fetch(`${base}/w/${slug}/v1/config`)).arrayBuffer();   // booted
    const headers = { authorization: 'Bearer god_creator_secret', 'x-forwarded-for': '203.0.113.77', 'content-type': 'application/json' };
    const out = [];   // four waves of 50 at once (more than one listen backlog's worth of connects resets on macOS)
    for (let w = 0; w < 4; w++) out.push(...await Promise.all(Array.from({ length: 50 }, () => fetch(`${base}/w/${slug}/v1/god/query`, { method: 'POST', headers, body: '{}' }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })))));
    const refused = out.filter((r) => r.status === 429 || r.status === 503);
    assert.ok(refused.length > 0 && refused.length <= 50, `${refused.length} refused (god bucket burst 150)`);
    assert.ok(refused.every((r) => r.body?.limit?.scope === 'god-token' && r.body.code !== 'client.rate'), JSON.stringify(refused[0]));
    await fetch(`${base}/__sim/op/set-limits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, limits: { ipPer10s: 3 } }) });
    const soul = { authorization: 'Bearer sim_s_g_x', 'x-forwarded-for': '203.0.113.77' }, codes = [];
    for (let i = 0; i < 4; i++) { const r = await fetch(`${base}/w/${slug}/v1/edge/receipts/r1`, { headers: soul }); codes.push(r.status === 429 ? (await r.json()).code : r.status); }
    assert.equal(codes[3], 'client.rate', JSON.stringify(codes)); assert.ok(codes.slice(0, 3).every((c) => c !== 'client.rate'));
  } finally { await L.close(); }
});

test('a 200 req/s hammer from one address: the world gets at most its budget, every refusal within 50 ms; C3 reads hit the world once a second', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1-ceil-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const hits = join(dir, 'hits.txt'); writeFileSync(hits, '');
  const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), FAKE_HITS: hits } });
  const P = P0 + 5, base = `http://127.0.0.1:${P}`;
  // the hammer tests the mechanism at tight limits (the release-402 numbers); the shipped defaults are far above a 200 req/s single address
  const tight = { ipPer10s: 120, ipConcurrent: 10, worldBudgetRps: 10 };
  const L = await openLauncher({ port: P, range: [P0, P0 + 2], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false, publicOrigin: 'http://sim.test', devAuth: true, soulLimits: tight });
  try {
    const made = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Anvil' }) })).json();
    const slug = made.slug, path = `${base}/w/${slug}/v1/edge/here`;
    writeFileSync(hits, '');
    const headers = { authorization: 'Bearer sim_s_hammer_secret', 'x-forwarded-for': '203.0.113.9' };
    const seconds = 3, rate = 200, t0 = Date.now(), runs = [];
    for (let i = 0; i < seconds * rate; i++) {
      const due = t0 + (i * 1000) / rate; const wait = due - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const s = performance.now();
      runs.push(fetch(path, { headers }).then(async (r) => { await r.arrayBuffer(); return { status: r.status, ms: performance.now() - s, retry: r.headers.get('retry-after') }; }));
    }
    const out = await Promise.all(runs), elapsed = (Date.now() - t0) / 1000;
    const reached = readFileSync(hits, 'utf8').split('\n').filter((l) => l === '/v1/edge/here').length;
    const refused = out.filter((r) => r.status === 429 || r.status === 503), worst = Math.max(...refused.map((r) => r.ms));
    const p99 = refused.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(refused.length * 0.99)];
    const budget = tight.worldBudgetRps * Math.ceil(elapsed) + 2 * tight.worldBudgetRps;
    console.log(`hammer: ${out.length} requests in ${elapsed.toFixed(1)} s; world reached ${reached} (budget ${budget}); refused ${refused.length}, p99 ${p99.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
    assert.ok(reached <= budget, `world reached ${reached} > ${budget}`);
    assert.ok(refused.length >= out.length - budget);
    assert.ok(refused.every((r) => Number(r.retry) >= 1));
    assert.ok(p99 <= 50, `p99 ${p99} ms`);
    // C3: 50 browsers asking for the snapshot at once and again for 2.5 s cost the world about one call a second
    writeFileSync(hits, '');
    const snap = `${base}/w/${slug}/v1/world/snapshot`, s0 = Date.now(); let served = 0;
    while (Date.now() - s0 < 2500) { const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => fetch(snap, { headers: { 'x-forwarded-for': `198.51.100.${i}` } }).then((r) => r.json()))); served += rs.length; await new Promise((r) => setTimeout(r, 100)); }
    const snapHits = readFileSync(hits, 'utf8').split('\n').filter((l) => l === '/v1/world/snapshot').length;
    console.log(`c3: ${served} snapshot reads, ${snapHits} reached the world`);
    assert.ok(snapHits <= 4, `${snapHits} world calls`);
    // registry-tunable: a bigger budget for this world, at once
    const r = await fetch(`${base}/__sim/op/set-limits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, limits: { worldBudgetRps: 50, nope: 1 } }) });
    assert.equal(r.status, 400);
    const ok = await (await fetch(`${base}/__sim/op/set-limits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, limits: { worldBudgetRps: 50 } }) })).json();
    assert.equal(ok.limits.worldBudgetRps, 50); assert.equal(ok.limits.ipListen, SOUL_CEILINGS.ipListen);
    const dash = await (await fetch(`${base}/__sim/health?json=1`)).json();
    const row = dash.worlds.find((w) => w.slug === slug);
    assert.equal(row.limits.worldBudgetRps, 50); assert.ok(row.refused['world.busy'] > 0 || row.refused['client.rate'] > 0);
  } finally { await L.close(); }
});

test('lane L7 mounts: /__sim/metrics (loopback only) carries the ceilings\' refusals; healthz has clientErrorsRate10m', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1-metrics-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port) } });
  const P = P0 + 5, base = `http://127.0.0.1:${P}`;
  const L = await openLauncher({ port: P, range: [P0, P0 + 2], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false, publicOrigin: 'http://sim.test', devAuth: true });
  try {
    const { slug } = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gauge' }) })).json();
    assert.equal((await fetch(`${base}/w/${slug}/v1/edge/here`, { headers: { 'x-forwarded-for': '203.0.113.1' } })).status, 401);
    const h = await (await fetch(`${base}/__sim/healthz`)).json(); assert.equal(typeof h.clientErrorsRate10m, 'number');
    const m = await (await fetch(`${base}/__sim/metrics`)).text();
    assert.match(m, new RegExp(`sim_world_refused_total\\{world="${slug}",class="auth.required"\\} 1`));
    assert.equal((await fetch(`${base}/__sim/metrics`, { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 404);
  } finally { await L.close(); }
});
