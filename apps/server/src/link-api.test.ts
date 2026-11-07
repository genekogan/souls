// LINK tranche, API lane (team/TRANCHE-LINK-20261024.md, COMMON-LINK §2): approving a new Soul places its body inside the
// approve request (`ready`, never an owner-visible `creating`); the owner `link` state; the agent's public `now` line.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AccountIdentity } from './accounts/store.ts';
import { fixture as worldFixture } from '../test/native-owner-fixture.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { fixture as edgeFixture, invite, accept } from '../test/native-owner-fixture.ts';
import { config } from './config.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

const input = (key: string, extra: Record<string, unknown> = {}) => ({ agentLabel: 'eden-agent 1.9.17', name: 'Qwyjibo', idempotencyKey: 'link-request-key-' + key, pollSecret: randomBytes(32).toString('base64url'), ...extra });

export async function linkWorld(t: TestContext) {
  const f = worldFixture(':memory:', await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true })); f.brain.quiesce(); f.souls.enableLifecycle(); t.after(() => { f.host.stop(); f.db.close(); });
  f.souls.cfg.accountAuthRequired = true; f.souls.cfg.inviteRequired = false;
  const ids = new Map<string, AccountIdentity>();
  for (const name of ['gene', 'other']) { const id = 'did:privy:' + name; f.db.upsertUser({ id, email: null, wallet: null, role: 'user' }); ids.set(name, { id, issuer: 'privy.io/test-app', subject: id, verifiedAt: Date.now(), expiresAt: Date.now() + 600_000 }); }
  f.auth.accountFromToken = async token => { const identity = ids.get(token ?? ''); return identity ? { identity, user: f.db.user(identity.id)! } : null; };
  const original = f.auth.userFromToken.bind(f.auth); f.auth.userFromToken = async token => ids.has(token ?? '') ? f.db.user(ids.get(token!)!.id)! : original(token);
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth, hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  const call = async (path: string, body?: unknown, token?: string, method?: string) => { const r = await app.request(path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { host: '127.0.0.1:4956', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json().catch(() => null) as any }; };
  /** create + approve a Soul for gene; returns its id, the agent poll secret and approval id */
  const born = async (key: string, name = 'Qwyjibo') => {
    const code = (await call('/v1/account/window-code', {}, 'gene')).data.code;
    const req = input(key, { name, for: code });
    const start = await call('/v1/agent/approval/start', req);
    const approvalId = start.data.approval.id as string;
    const approved = await call(`/v1/account/approvals/${approvalId}/approve`, {}, 'gene');
    return { approvalId, req, approved };
  };
  const token = async (approvalId: string, pollSecret: string) => (await call('/v1/agent/approval/poll', { approvalId, pollSecret })).data.token as string;
  return { f, app, call, born, token, ids };
}

test('approve places the body standing at the arrival point inside the request and answers ready', async t => {
  const w = await linkWorld(t);
  const { approved, req } = await w.born('birth-0001');
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.approval.status, 'ready', 'the owner never sees creating');
  const soulId = approved.data.approval.soulId as string;
  assert.match(soulId, /^s_/);
  const mind = w.f.host.minds.get(soulId);
  assert.ok(mind, 'the Soul has a mind in the world in the same response');
  assert.ok(w.f.host.engine.world.entities[mind!.entityId], 'and a body');
  assert.equal(w.f.souls.controlReady(w.f.db.soul(soulId)!), true);
  assert.match(await w.token(approved.data.approval.id, req.pollSecret), /^sim_s_/, 'the first poll hands over the token');
});

test('link precedence: approved-waiting, connected, stopped-listening, pairing, revoked, replaced, never', async t => {
  const w = await linkWorld(t);
  const { approved, req } = await w.born('link-0001');
  const soulId = approved.data.approval.soulId as string, box = `/v1/edge/owner/${soulId}/inbox`;
  const link = async () => { const r = await w.call(box, undefined, 'gene'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.inbox.link; };
  const card = async () => { const r = await w.call(`/v1/souls/${soulId}`, undefined, 'gene'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.agent.link; };
  // approved, the agent has not listened yet
  let l = await link();
  assert.equal(l.state, 'disconnected'); assert.equal(l.reason, 'approved-waiting'); assert.equal(typeof l.since, 'number');
  assert.equal(l.holder.label, 'eden-agent 1.9.17');
  assert.deepEqual(await card(), l, 'GET /v1/souls/:id agent.link is the same value');
  // the first listen (a peek also stamps it) connects
  const token = await w.token(approved.data.approval.id, req.pollSecret);
  assert.equal((await w.call('/v1/edge/inbox/listen?timeoutMs=0', undefined, token)).status, 200);
  l = await link();
  assert.equal(l.state, 'connected'); assert.equal(l.reason, 'listening'); assert.equal(typeof l.since, 'number'); assert.ok(l.holder.since);
  // no listen for longer than the presence grace: stopped listening, since the grace ran out
  const old = Date.now() - 200_000;
  w.f.db.db.prepare('UPDATE agent_inbox_v1 SET listened_at=? WHERE scope=?').run(old, `soul:${soulId}`);
  w.f.db.db.prepare('UPDATE account_agent_grants_v1 SET created_at=?,token_issued_at=? WHERE soul_id=?').run(old - 5000, old - 5000, soulId);
  l = await link();
  assert.equal(l.state, 'disconnected'); assert.equal(l.reason, 'stopped-listening'); assert.equal(l.since, old + 60_000); assert.ok(l.holder);
  // a repair request in the owner's window: pairing, naming the approval, the current holder kept
  const code = (await w.call('/v1/account/window-code', {}, 'gene')).data.code;
  const repair = await w.call('/v1/agent/approval/start', { ...input('link-0002', { soulId, for: code }), name: undefined });
  assert.equal(repair.status, 200, JSON.stringify(repair.data));
  l = await link();
  assert.equal(l.state, 'pairing'); assert.equal(l.reason, 'pending-approval'); assert.equal(l.approvalId, repair.data.approval.id); assert.ok(l.holder);
  // someone else's view of the same request never sees pairing (the request is addressed to gene's window only)
  assert.equal((await w.call(box, undefined, 'other')).status, 403, 'the owner view is owner-only');
  // the owner revokes: disconnected, revoked, no holder (the pending repair is cancelled first so pairing does not win)
  assert.equal((await w.call(`/v1/account/approvals/${repair.data.approval.id}/cancel`, {}, 'gene')).status, 200);
  assert.equal((await w.call(`/v1/account/souls/${soulId}/revoke`, {}, 'gene')).status, 200);
  l = await link();
  assert.equal(l.state, 'disconnected'); assert.equal(l.reason, 'revoked'); assert.equal(l.holder, null); assert.equal(typeof l.since, 'number');
  // a grant that ended because a newer pairing took over, with none current: replaced
  w.f.db.db.prepare("UPDATE account_agent_grants_v1 SET revoked_reason='replaced',revoked_at=? WHERE soul_id=?").run(Date.now() + 1000, soulId);
  assert.equal((await link()).reason, 'replaced');
  // nothing ever: never
  w.f.db.db.prepare('DELETE FROM account_agent_grants_v1 WHERE soul_id=?').run(soulId);
  w.f.db.db.prepare('DELETE FROM agent_inbox_v1 WHERE scope=?').run(`soul:${soulId}`);
  w.f.db.db.prepare('DELETE FROM soul_token_tombstones_v1 WHERE soul_id=?').run(soulId);
  l = await link();
  assert.deepEqual(l, { state: 'disconnected', reason: 'never', since: null, holder: null });
});

test('now: set with act, say, ack, result, wait and alone; limits, clear, public reads, owner-only nothing leaks', async t => {
  const f = edgeFixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Now fixture'}));
  const token = f.souls.pairExchange(f.souls.pairCode(a, `http://127.0.0.1:${TEST_PORT}`).code, 'scripted').token;
  const app = buildApp({cfg: {...config, port: TEST_PORT, worldPath: '/w/eden', publicUrl: `http://127.0.0.1:${TEST_PORT}/w/eden`, accountAuthRequired: false, webDir: '/nonexistent-now-fixture', marsWebDir: '/nonexistent-now-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub: {clients: new Map(), refreshMe() {}} as never});
  const req = async (path: string, auth?: string, body?: unknown) => {
    const r = await app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {...(auth ? {authorization: `Bearer ${auth}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: r.status, data: await r.json().catch(() => null) as any};
  };
  const publicNow = async () => (await req(`/v1/edge/public/souls/${a.id}`)).data.now;
  assert.equal(await publicNow(), null, 'no line yet');
  // alone
  let r = await req('/v1/edge/self/now', token, {text: '  Looking for\nsomeone to row with  '});
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.now.text, 'Looking for someone to row with');
  assert.equal((await publicNow()).text, 'Looking for someone to row with');
  assert.equal(f.host.publicSoul(f.host.minds.get(a.id)!).now?.text, 'Looking for someone to row with', 'the replica public card carries it');
  // limits: 140 characters after trim, strings only; a refused line refuses the call and stores nothing
  assert.equal((await req('/v1/edge/self/now', token, {text: 'x'.repeat(141)})).status, 400);
  assert.equal((await req('/v1/edge/self/now', token, {text: ' ' + 'y'.repeat(140) + ' '})).status, 200);
  assert.equal((await req('/v1/edge/self/now', token, {text: 7})).status, 400);
  assert.equal((await req('/v1/edge/self/now', token, {now: 'wrong key'})).status, 400);
  assert.equal((await req('/v1/edge/self/now', undefined, {text: 'anon'})).status, 401);
  assert.equal((await req('/v1/edge/self/now', token, {text: 'tab\there\u0007bell​zw'})).data.now.text, 'tab here bell zw');
  assert.equal((await req('/v1/edge/say', token, {text: 'hello', now: 'z'.repeat(200)})).status, 400, 'a bad now refuses the call');
  // bundled: say, act
  r = await req('/v1/edge/say', token, {text: 'hello all', now: 'Saying hello'});
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal((await publicNow()).text, 'Saying hello');
  { let done = false; const acting = req('/v1/edge/act', token, {capability: 'wander', now: 'Wandering about'}).finally(() => { done = true; });
    for (let i = 0; i < 200 && !done; i++) { f.host.drainInputs(); await new Promise(res => setTimeout(res, 5)); } r = await acting; }
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal((await publicNow()).text, 'Wandering about');
  // wait: the now query parameter
  r = await req(`/v1/edge/wait?after=c_0&timeout=1&now=${encodeURIComponent('Waiting a moment')}`, token);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal((await publicNow()).text, 'Waiting a moment');
  // ack and result of an owner message
  assert.equal((await req(`/v1/edge/owner/${a.id}/inbox`, 'dev:alice', {text: 'sit on the bench'})).status, 200);
  const msg = (await req('/v1/edge/inbox/listen?timeoutMs=0', token)).data.backlog[0];
  r = await req(`/v1/edge/inbox/${msg.id}/ack`, token, {reply: 'On my way', now: 'Heading to the bench'});
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal((await publicNow()).text, 'Heading to the bench');
  assert.equal(r.data.inbox.latest.reply, 'On my way', 'the ack itself still lands');
  r = await req(`/v1/edge/inbox/${msg.id}/result`, token, {text: 'Sat down', outcome: 'done', now: 'Resting on the bench'});
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal((await publicNow()).text, 'Resting on the bench');
  // the owner view and the world's public list
  const owner = (await req(`/v1/edge/owner/${a.id}/inbox`, 'dev:alice')).data.inbox;
  assert.equal(owner.now.text, 'Resting on the bench'); assert.equal(owner.link.state, 'connected');
  // the agent's own link view: the same state, its own now
  const self = (await req('/v1/edge/self/link', token)).data;
  assert.equal(self.link.state, 'connected'); assert.equal(self.now.text, 'Resting on the bench');
  assert.equal((await req('/v1/edge/self/link', 'sim_garbage')).status, 401);
  // clear: null, and an empty wait now
  assert.equal((await req('/v1/edge/self/now', token, {text: null})).data.now, null);
  assert.equal(await publicNow(), null);
  assert.equal(f.host.publicSoul(f.host.minds.get(a.id)!).now, undefined, 'an unset line leaves the card shape as before');
  // nothing private leaks into the public record: no link, no holder, no inbox
  const pub = (await req(`/v1/edge/public/souls/${a.id}`)).data;
  assert.equal(JSON.stringify(pub).includes('holder'), false); assert.equal(pub.inbox, undefined); assert.equal(pub.link, undefined);
  // another account cannot read the owner view
  await invite(f, 'bob');
  assert.equal((await req(`/v1/edge/owner/${a.id}/inbox`, 'dev:bob')).status, 403);
});
