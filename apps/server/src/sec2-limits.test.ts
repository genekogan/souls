// SEC2 (2026-10-21): two obvious holes closed with minimal changes.
// 1. Request bodies: routes mounted before the /v1/* 64 KB limit (edge, travel, art, moderation) read a chunked body
//    (no content-length) without bound. A 1 MB ceiling (uploads 17 MB) now applies to every non-god write.
// 2. Webhooks: a subscription URL must be public https, but fetch followed redirects, so a public URL could bounce
//    the signed POST to a loopback or metadata address. A redirect is now a failed delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {fixture} from '../test/native-owner-fixture.ts';
import {buildApp, bodyCeiling} from './http.ts';
import {config} from './config.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {commsFixture} from './edge/comms/testing.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

const cfg = {...config, port: TEST_PORT, worldPath: '/w/eden', publicUrl: `http://127.0.0.1:${TEST_PORT}/w/eden`, accountAuthRequired: false, webDir: '/nonexistent-sec2', marsWebDir: '/nonexistent-sec2'};
const hub = {clients: new Map(), refreshMe() {}} as never;
/** A chunked request body (no content-length) of `mb` MiB, counting how much of it the server pulled. */
const chunked = (mb: number) => {
  const pulled = {bytes: 0}, chunk = new Uint8Array(1 << 20).fill(0x41); let left = mb;
  const body = new ReadableStream<Uint8Array>({pull(c) { if (left-- <= 0) { c.close(); return; } pulled.bytes += chunk.length; c.enqueue(chunk); }});
  return {body, pulled};
};

test('ceilings: 1 MB for ordinary writes, 17 MB for the two upload routes', () => {
  assert.equal(bodyCeiling('/v1/edge/say'), 1 << 20);
  assert.equal(bodyCeiling('/v1/edge/body/uploads'), 17 << 20);
  assert.equal(bodyCeiling('/v1/art/media'), 17 << 20);
  assert.equal(bodyCeiling('/v1/art/media/x'), 1 << 20);
});

test('a chunked 64 MB body to an edge route is refused at the ceiling, not read whole', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const app = buildApp({cfg, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub});
  const big = chunked(64);
  const r = await app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: big.body, duplex: 'half'} as RequestInit);
  assert.equal(r.status, 413);
  assert.ok(big.pulled.bytes <= 4 << 20, `pulled ${big.pulled.bytes} bytes`);
  // An ordinary small body still reaches the route (here: no Soul token, so 401 from the route itself).
  const small = await app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: 'hi'})});
  assert.equal(small.status, 401);
});

test('a webhook that answers with a redirect is a failed delivery, and the redirect target is never called', async t => {
  let targetHits = 0;
  const target = createServer((_q, s) => { targetHits++; s.end('ok'); }); await new Promise<void>(r => target.listen(0, '127.0.0.1', r));
  const tPort = (target.address() as AddressInfo).port;
  const bouncer = createServer((_q, s) => { s.writeHead(307, {location: `http://127.0.0.1:${tPort}/internal`}).end(); }); await new Promise<void>(r => bouncer.listen(0, '127.0.0.1', r));
  const bPort = (bouncer.address() as AddressInfo).port;
  t.after(() => { target.close(); bouncer.close(); });
  // The real fetch, pointed at the local bouncer in place of the subscriber's public host.
  const f = commsFixture(['Alice', 'Bob'], {fetch: (url, init) => fetch(url.replace('https://agent.example', `http://127.0.0.1:${bPort}`), init as RequestInit)});
  try {
    f.at('Alice', 0, 0); f.at('Bob', 1, 0);
    assert.equal((await f.post('Bob', '/v1/edge/subscribe', {url: 'https://agent.example/hook', secret: 'a-long-enough-secret'})).status, 200);
    await f.post('Alice', '/v1/edge/say', {text: 'ping'});
    for (let i = 0; i < 50; i++) { const row = f.db.db.prepare('SELECT failures FROM edge_comms_subscriptions').get() as {failures: number}; if (row.failures > 0) break; await new Promise(r => setTimeout(r, 20)); }
    const row = f.db.db.prepare('SELECT cursor, failures FROM edge_comms_subscriptions').get() as {cursor: number; failures: number};
    assert.equal(row.failures, 1); assert.equal(targetHits, 0);
  } finally { f.destroy(); }
});
