// #1006: every answer carries the shared security headers, and every route but the CLOCK_EXEMPT ones answers 503 while
// the world's clock is halted. The walk covers the whole route table of a world with edge, god and travel, so a route
// registered anywhere in buildApp (before or after the rest) is held to the same rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {buildApp, CLOCK_EXEMPT, clockExempt} from './http.ts';
import {config} from './config.ts';
import {GodMode} from './god/god.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

const UNAVAILABLE = {ok: false, code: 'world-unavailable', message: 'World temporarily unavailable.'};
const haltClock = (host: unknown) => { (host as {clockFailure: unknown}).clockFailure = new Error('test: clock halted'); };
const secure = (r: Response, why: string) => {
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', why);
  assert.equal(r.headers.get('x-frame-options'), 'DENY', why);
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/, why);
};

function world(t: {after(fn: () => void): void}) {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const app = buildApp({cfg: {...config, port: 5964, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5964/w/eden', accountAuthRequired: false, inviteRequired: true, webDir: '/nonexistent-route-guards', marsWebDir: '/nonexistent-route-guards'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), god, hub: {clients: new Map(), refreshMe() {}, joinMessages: [], upgradeHandlers: []} as never});
  return {f, app};
}

/** A concrete URL for a route pattern: `:name{regex}` and `:name` get a value their pattern accepts, `*` a segment. */
const concrete = (path: string) => path
  .replace(/:[A-Za-z]+\{([^}]*)\}/g, (_, re: string) => re.includes('[0-9a-f]{64}') ? 'a'.repeat(64) + (/\\\.\(([a-z0-9]+)/.exec(re) ? '.' + /\\\.\(([a-z0-9]+)/.exec(re)![1] : '') : re.includes('mjs') ? 'x.mjs' : 'x')
  .replace(/:[A-Za-z]+/g, 'x').replace(/\*/g, 'x');

/** Every distinct (method, path) the built app registers, middleware included ('ALL' is sent as GET and POST). */
const table = (app: {routes: {method: string; path: string}[]}) => {
  const seen = new Set<string>(), out: {method: string; url: string; path: string}[] = [];
  for (const r of app.routes) for (const method of r.method === 'ALL' ? ['GET', 'POST'] : [r.method]) {
    const url = concrete(r.path), key = `${method} ${url}`;
    if (!seen.has(key)) { seen.add(key); out.push({method, url, path: r.path}); }
  }
  return out;
};
const call = (app: {request(u: string, i: RequestInit): Response | Promise<Response>}, method: string, url: string) => Promise.race([
  Promise.resolve(app.request(url, {method, headers: {host: '127.0.0.1:5964', 'content-type': 'application/json'}, ...(method === 'GET' || method === 'HEAD' ? {} : {body: '{}'})})),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${method} ${url} did not answer in 5 s`)), 5000).unref()),
]);

test('the exempt list is moderation only, and /healthz is not on it', () => {
  assert.deepEqual(CLOCK_EXEMPT.map(String), [String(/^\/v1\/moderation(?:\/|$)/)]);
  for (const p of ['/v1/moderation', '/v1/moderation/hide', '/v1/moderation/log']) assert.equal(clockExempt(p), true, p);
  for (const p of ['/healthz', '/v1/moderationx', '/v1/edge/act', '/v1/god/act', '/v1/world/snapshot']) assert.equal(clockExempt(p), false, p);
});

test('every route in the table carries the security headers, and answers 503 while the clock is halted unless exempt', async t => {
  const {f, app} = world(t), routes = table(app as never);
  assert.ok(routes.length > 200, `the walk sees the whole table (${routes.length} entries)`);
  for (const early of ['/v1/edge/act', '/v1/god/act', '/v1/moderation/hide', '/v1/site/arrive', '/v1/edge/owner/:soulId/inbox', '/v1/souls/:soulId/command', '/v1/world/env', '/SKILL.md'])
    assert.ok(routes.some(r => r.path === early), `${early} is in the walk`);
  for (const r of [...routes, {method: 'GET', url: '/v1/no-such-route', path: ''}, {method: 'GET', url: '/no-such-page', path: ''}]) secure(await call(app as never, r.method, r.url), `${r.method} ${r.url}`);
  haltClock(f.host);
  const exempt: string[] = [];
  for (const r of routes) {
    const res = await call(app as never, r.method, r.url), why = `${r.method} ${r.url} (halted)`;
    secure(res, why);
    if (clockExempt(r.url)) { assert.notEqual(res.status, 503, why); exempt.push(`${r.method} ${r.url}`); continue; }
    assert.equal(res.status, 503, why); assert.equal(res.headers.get('cache-control'), 'no-store', why); assert.deepEqual(await res.json(), UNAVAILABLE, why);
  }
  assert.ok(exempt.includes('GET /v1/moderation') && exempt.includes('POST /v1/moderation/hide'), 'the moderation routes answer while halted');
});

test('the owner inbox route takes no text while the clock is halted (edge and god inbox)', async t => {
  const {f, app} = world(t);
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Inbox fixture'}));
  const post = (path: string, text: string) => app.request(path, {method: 'POST', headers: {host: '127.0.0.1:5964', authorization: 'Bearer dev:alice', 'content-type': 'application/json'}, body: JSON.stringify({text})});
  const queued = () => (f.db.db.prepare('SELECT count(*) AS n FROM soul_inbox_queue_v1').get() as {n: number}).n;
  const ok = await post(`/v1/edge/owner/${a.id}/inbox`, 'before'); assert.equal(ok.status, 200); secure(ok, 'accepted');
  const before = queued(); assert.ok(before >= 1, 'the running world queued it');
  haltClock(f.host);
  for (const path of [`/v1/edge/owner/${a.id}/inbox`, `/v1/souls/${a.id}/command`, '/v1/god/inbox']) {
    const r = await post(path, 'halted'); assert.equal(r.status, 503, path); assert.deepEqual(await r.json(), UNAVAILABLE, path); secure(r, path);
  }
  assert.equal(queued(), before, 'a halted world queued nothing');
});

test("a route's own CSP keeps its directives and gains frame-ancestors; refusals of the early middleware carry the headers", async t => {
  const {f, app} = world(t), id = 'body_' + 'b'.repeat(64);
  f.db.db.prepare('INSERT INTO edge_body_assets_v1(world_id,asset_id,descriptor,content) VALUES(?,?,?,?)').run(f.host.worldId, id, '{}', new Uint8Array([1, 2, 3]));
  const own = await app.request(`/v1/edge/body/assets/${id}.glb`);
  assert.equal(own.status, 200); assert.equal(own.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'", 'the asset keeps default-src none');
  secure(own, 'edge body asset');
  const big = await app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024)}, body: 'x'.repeat(2 * 1024 * 1024)});
  assert.equal(big.status, 413); secure(big, 'body ceiling 413');
});
