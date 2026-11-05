// #982: POST /v1/souls/<id>/command has exactly one handler per world mode, and each mode answers as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {ownerCommandRoute} from './inbox-routes.ts';

const commandPosts = (app: {routes: {method: string; path: string}[]}) => app.routes.filter(r => r.method === 'POST' && /^\/v1\/souls\/:(id|soulId)\/command$/.test(r.path)).map(r => r.path);

test('ownerCommandRoute: an edge world answers from the agent inbox, a central-mind world from the translator', () => {
  assert.equal(ownerCommandRoute(true), 'edge-inbox');
  assert.equal(ownerCommandRoute(false), 'central-translator');
});

test('central-mind world: one command handler, the translator; its answers are unchanged', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  assert.deepEqual(commandPosts(f.app as never), ['/v1/souls/:id/command']);
  await invite(f, 'alice'); await invite(f, 'bob');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Command fixture'}));
  const bad = await f.request(`/v1/souls/${a.id}/command`, {text: ''});
  assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), {ok: false, code: 'invalid', message: 'text is required (1–280 characters)'});
  assert.equal((await f.request(`/v1/souls/${a.id}/command`, {text: 'wander'}, 'bob')).status, 403, 'not your soul');
  const r = await f.request(`/v1/souls/${a.id}/command`, {text: 'wander'}); const j = await r.json() as {inbox?: unknown};
  assert.equal(r.status, 200); assert.equal(j.inbox, undefined, 'the translator answers, not the inbox');
});

test('edge world: one command handler, the inbox; its answers are unchanged', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice'); await invite(f, 'bob');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Command fixture'}));
  const app = buildApp({cfg: {...config, port: 5963, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5963/w/eden', accountAuthRequired: false, inviteRequired: true, webDir: '/nonexistent-command-fixture', marsWebDir: '/nonexistent-command-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub: {clients: new Map(), refreshMe() {}} as never});
  assert.deepEqual(commandPosts(app as never), ['/v1/souls/:soulId/command']);
  const req = (owner: string, data: unknown) => app.request(`/v1/souls/${a.id}/command`, {method: 'POST', headers: {host: '127.0.0.1:5963', authorization: `Bearer ${owner}`, 'content-type': 'application/json'}, body: JSON.stringify(data)});
  const bad = await req('dev:alice', {text: ''});
  assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), {ok: false, code: 'invalid', message: 'text is required (1–280 characters)'});
  assert.equal((await req('dev:bob', {text: 'wander'})).status, 403, 'not your soul');
  const r = await req('dev:alice', {text: 'wander'}); const j = await r.json() as {ok: boolean; inbox: {latest: {state: string; text: string}}};
  assert.equal(r.status, 200); assert.equal(j.ok, true); assert.equal(j.inbox.latest.state, 'sent'); assert.equal(j.inbox.latest.text, 'wander');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const big = await req('dev:alice', {text: 'x'.repeat(9000)});
  assert.equal(big.status, 413, 'the inbox body limit still applies'); assert.deepEqual(await big.json(), {ok: false, code: 'too-large', message: 'message is too large'});
});

// #1000: the edge inbox handler is mounted before the shared middleware, so it gets the same headers and halted-clock
// gate from the start; the central translator gets them from '*'. Both modes answer alike.
const SECURITY = {'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'"};
const UNAVAILABLE = {ok: false, code: 'world-unavailable', message: 'World temporarily unavailable.'};
const haltClock = (host: unknown) => { (host as {clockFailure: unknown}).clockFailure = new Error('test: clock halted'); };
const headersOf = (r: Response) => Object.fromEntries(Object.keys(SECURITY).map(k => [k, r.headers.get(k)]));

test('edge world: the command route carries the security headers and answers 503 while the clock is halted', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice'); await invite(f, 'bob');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Command fixture'}));
  const app = buildApp({cfg: {...config, port: 5963, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5963/w/eden', accountAuthRequired: false, inviteRequired: true, webDir: '/nonexistent-command-fixture', marsWebDir: '/nonexistent-command-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub: {clients: new Map(), refreshMe() {}} as never});
  const req = (owner: string | null, body: string) => app.request(`/v1/souls/${a.id}/command`, {method: 'POST', headers: {host: '127.0.0.1:5963', ...(owner ? {authorization: `Bearer ${owner}`} : {}), 'content-type': 'application/json'}, body});
  for (const [why, r, status] of [
    ['accepted', await req('dev:alice', JSON.stringify({text: 'wander'})), 200],
    ['invalid', await req('dev:alice', JSON.stringify({text: ''})), 400],
    ['not your soul', await req('dev:bob', JSON.stringify({text: 'wander'})), 403],
    ['too large', await req('dev:alice', JSON.stringify({text: 'x'.repeat(9000)})), 413],
  ] as const) { assert.equal(r.status, status, why); assert.deepEqual(headersOf(r), SECURITY, why); assert.equal(r.headers.get('cache-control'), 'no-store', why); }
  // an agent token's answer is rewritten by the inbox (its `inbox` block added); the headers survive that
  const agent = (f.souls as unknown as {mint(id: string, x: null): string}).mint(a.id, null);
  const rewritten = await req(agent, JSON.stringify({text: 'x'.repeat(9000)})); const rj = await rewritten.json() as {code: string; inbox?: unknown};
  assert.equal(rewritten.status, 413); assert.equal(rj.code, 'too-large'); assert.ok(rj.inbox, 'the inbox rewrote it'); assert.deepEqual(headersOf(rewritten), SECURITY);
  haltClock(f.host);
  for (const [why, owner, body] of [['owner', 'dev:alice', JSON.stringify({text: 'halted'})], ['no auth, before auth', null, JSON.stringify({text: 'halted'})], ['before the body is read', 'dev:alice', '{not json'], ['before the inbox body limit', 'dev:alice', JSON.stringify({text: 'x'.repeat(9000)})]] as const) {
    const r = await req(owner, body);
    assert.equal(r.status, 503, why); assert.deepEqual(await r.json(), UNAVAILABLE, why);
    assert.equal(r.headers.get('cache-control'), 'no-store', why); assert.deepEqual(headersOf(r), SECURITY, why);
  }
  assert.deepEqual(f.db.db.prepare('SELECT text FROM soul_inbox_queue_v1 ORDER BY n').all().map(r => (r as {text: string}).text), ['wander'], 'a halted world took no command');
});

test('central-mind world: the command route already answers with the same headers and 503', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Command fixture'}));
  const ok = await f.request(`/v1/souls/${a.id}/command`, {text: 'wander'});
  assert.equal(ok.status, 200); assert.deepEqual(headersOf(ok), SECURITY);
  haltClock(f.host);
  const r = await f.request(`/v1/souls/${a.id}/command`, {text: 'wander'});
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), UNAVAILABLE);
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.deepEqual(headersOf(r), SECURITY);
});
