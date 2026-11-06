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
