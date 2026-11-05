// #1013: an unknown sub-path of any route family answers cleanly, never 500. The EVENTS-v1 idempotency middleware on
// /v1/edge/plan/* and /v1/edge/objects/* reads the body, so a write that matched no route fell through to the /v1/* body
// limit, which threw "ReadableStream is locked" on the spent stream when the body came without Content-Length.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';
import {buildApp, limitBody} from './http.ts';
import {Hono} from 'hono';
import {config} from './config.ts';
import {GodMode} from './god/god.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

function world(t: {after(fn: () => void): void}) {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  return buildApp({cfg: {...config, port: 5964, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5964/w/eden', accountAuthRequired: false, inviteRequired: true, webDir: '/nonexistent-unknown-subpaths', marsWebDir: '/nonexistent-unknown-subpaths'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), god, hub: {clients: new Map(), refreshMe() {}, joinMessages: [], upgradeHandlers: []} as never});
}

/** A request with a JSON body; `length` decides whether it declares Content-Length (without it, the body is read as a stream). */
const send = (app: {request(u: string, i: RequestInit): Response | Promise<Response>}, method: string, url: string, length: boolean) => {
  const headers: Record<string, string> = {host: '127.0.0.1:5964', 'content-type': 'application/json'};
  if (length && method !== 'GET') headers['content-length'] = '2';
  return Promise.race([
    Promise.resolve(app.request(url, {method, headers, ...(method === 'GET' ? {} : {body: '{}'})})),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${method} ${url} did not answer in 5 s`)), 5000).unref()),
  ]);
};

test('unknown plan and objects sub-paths answer 404, with or without Content-Length', async t => {
  const app = world(t);
  for (const url of ['/v1/edge/plan/x', '/v1/edge/plan/x/y', '/v1/edge/objects/x', '/v1/edge/objects/x/y'])
    for (const method of ['POST', 'PATCH', 'DELETE']) for (const length of [false, true]) {
      if (url === '/v1/edge/plan/x' && method !== 'POST') continue;             // PATCH and DELETE /v1/edge/plan/:id are routes
      const r = await send(app as never, method, url, length);
      assert.equal(r.status, 404, `${method} ${url} (Content-Length: ${length})`);
    }
});

test('no unknown sub-path of any route family answers 500', async t => {
  const app = world(t), families = new Set<string>();
  for (const r of app.routes) { const p = r.path.replace(/\/[:*].*$/, '').replace(/\/$/, ''); if (p) families.add(p); }
  assert.ok(families.size > 200, `the walk sees every route family (${families.size})`);
  for (const early of ['/v1/edge/plan', '/v1/edge/objects', '/v1/god/act', '/v1/site/arrive', '/v1/moderation', '/v1/souls']) assert.ok(families.has(early), `${early} is walked`);
  const failures: string[] = [];
  for (const family of families) for (const sub of ['/x', '/x/y']) for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'PUT']) for (const length of method === 'GET' ? [false] : [false, true]) {
    const r = await send(app as never, method, family + sub, length);
    if (r.status === 500) failures.push(`${method} ${family}${sub} (Content-Length: ${length}): ${(await r.text()).slice(0, 80)}`);
  }
  assert.deepEqual(failures, []);
});

test('the body limit still holds after a middleware has read the body', async t => {
  const h = new Hono(), seen: number[] = [];
  h.use('*', async (c, next) => { await c.req.text(); await next(); });       // reads through Hono's cache, as idempotency does
  h.use('*', limitBody(10, c => c.json({code: 'too-large'}, 413)));
  h.post('*', async c => { seen.push((await c.req.text()).length); return c.text('ok'); });
  assert.equal((await h.request('/', {method: 'POST', body: '12345'})).status, 200);
  assert.equal((await h.request('/', {method: 'POST', body: '12345678901234567890'})).status, 413);
  assert.deepEqual(seen, [5], 'the route reads the body the middleware read');
  const app = world(t), big = JSON.stringify({pad: 'x'.repeat(70 * 1024)});
  const r = await app.request('/v1/edge/plan/x', {method: 'POST', headers: {host: '127.0.0.1:5964', 'content-type': 'application/json'}, body: big});
  assert.equal(r.status, 413, 'the 64 KB /v1/* cap applies to a body idempotency already read');
});
