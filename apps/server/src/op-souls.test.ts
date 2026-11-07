// Lane OPS2: the operator's TEST-Soul commands (op-souls.ts) and every guard on them. A real world app (green field,
// fake minds) with account approvals on, called the way the launcher calls it: directly, with the run's site key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { fixture as worldFixture } from '../test/native-owner-fixture.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import type { AccountIdentity } from './accounts/store.ts';
import { AgentInbox } from './inbox.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { BODY_KNOBS } from './edge/ledger/body-rule.ts';
import { OPERATOR_ACCOUNT, isTestName, deniedSoul } from './op-souls.ts';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';

const KEY = randomBytes(32).toString('hex');
const input = (key: string, name: string, extra: Record<string, unknown> = {}) => ({ agentLabel: 'eden-agent 1.9.5', name, idempotencyKey: 'op-souls-test-key-' + key, pollSecret: randomBytes(32).toString('base64url'), ...extra });

async function world(t: import('node:test').TestContext, o: { edge?: boolean } = {}) {
  process.env.SIM_SITE_KEY = KEY;
  const f = worldFixture(':memory:', await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true })); f.brain.quiesce(); f.souls.enableLifecycle(); t.after(() => { f.host.stop(); f.db.close(); });
  f.souls.cfg.accountAuthRequired = true; f.souls.cfg.inviteRequired = true;
  const gene: AccountIdentity = { id: 'acct_gene', issuer: 'clerk.test', subject: 'gene', verifiedAt: Date.now(), expiresAt: Date.now() + 600_000 };
  f.db.upsertUser({ id: gene.id, email: null, wallet: null, role: 'user' }); f.db.setInvited(gene.id, 'test');
  f.auth.accountFromToken = async token => token === 'gene' ? { identity: gene, user: f.db.user(gene.id)! } : null;
  const original = f.auth.userFromToken.bind(f.auth); f.auth.userFromToken = async token => token === 'gene' ? f.db.user(gene.id)! : original(token);
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth, hub: { clients: new Map(), refreshMe() {} } as unknown as Hub, ...(o.edge ? { edge: new EdgeLedger(f.host, f.db) } : {}) });
  const call = async (path: string, body?: unknown, o: { token?: string; key?: string | null; xff?: string } = {}) => {
    const key = o.key === undefined ? KEY : o.key;
    const r = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:7051', ...(o.token ? { authorization: 'Bearer ' + o.token } : {}), ...(key ? { 'x-sim-site-key': key } : {}), ...(o.xff ? { 'x-forwarded-for': o.xff } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json() as any };
  };
  const op = (verb: string, body: unknown, o = {}) => call(`/v1/op/souls/${verb}`, body, o);
  /** an agent's pairing request, then (optionally) its poll until it holds the Soul's token */
  const request = async (key: string, name: string, extra = {}) => { const req = input(key, name, extra), r = await call('/v1/agent/approval/start', req, { key: null }); assert.equal(r.status, 200, JSON.stringify(r.data)); return { id: r.data.approval.id as string, req }; };
  const ready = async (a: { id: string; req: { pollSecret: string } }) => {
    let polled: any;
    for (let i = 0; i < 60; i++) { await setImmediate(); f.host.drainInputs(); polled = (await call('/v1/agent/approval/poll', { approvalId: a.id, pollSecret: a.req.pollSecret }, { key: null })).data; if (polled.token) break; }
    assert.equal(polled.status, 'ready', JSON.stringify(polled)); return polled;
  };
  return { f, call, op, request, ready, gene };
}

test('names: TEST names and the deny list', () => {
  for (const n of ['TestMsg', 'Test 3', 'Test-probe', 'Test_A', 'test-probe', 'TestKwyjibo']) assert.ok(isTestName(n), n);
  for (const n of ['Kwyjibo', 'Testament', 'Tester', 'testy', 'MsgCheck', 'A Test', 'test']) assert.ok(!isTestName(n), n);
  assert.ok(deniedSoul('s_c8520a0a76', 'Anything')); assert.ok(deniedSoul(null, 'TestKwyjibo')); assert.ok(deniedSoul(null, 'kwyjibo'));
  assert.ok(!deniedSoul('s_0f72ce999a', 'TestMsg'));
});

test('only the launcher reaches them: no site key, a wrong one, or a request through the proxy is a 404', async t => {
  const w = await world(t);
  for (const verb of ['pending', 'approve', 'message', 'inbox', 'delete']) {
    assert.equal((await w.op(verb, {}, { key: null })).status, 404, verb);
    assert.equal((await w.op(verb, {}, { key: 'f'.repeat(64) })).status, 404, verb);
    assert.equal((await w.op(verb, {}, { xff: '203.0.113.9' })).status, 404, `${verb} through the proxy`);
  }
  assert.equal((await w.op('pending', {})).status, 200);
});

test('approve: a TEST Soul request becomes a Soul of the operator test account; every other request is refused', async t => {
  const w = await world(t);
  const real = await w.request('0001', 'Qwyjibo');                         // a real request (no test name)
  const kw = await w.request('0002', 'TestKwyjibo');                       // deny-listed name
  const code = (await w.call('/v1/account/window-code', {}, { token: 'gene', key: null })).data.code;
  const addressed = await w.request('0003', 'TestWindow', { for: code });  // sent to Gene's open window
  const mine = await w.request('0004', 'TestMsg');
  const pending = (await w.op('pending', {})).data.pending as any[];
  assert.deepEqual(Object.fromEntries(pending.map(p => [p.name, [p.test, p.addressed]])), { Qwyjibo: [false, false], TestKwyjibo: [false, false], TestWindow: [false, true], TestMsg: [true, false] });
  const refusal = async (id: string, name: string) => { const r = await w.op('approve', { approvalId: id, name }); return [r.status, r.data.code]; };
  assert.deepEqual(await refusal(real.id, 'Qwyjibo'), [403, 'op.not-test-soul']);
  assert.deepEqual(await refusal(kw.id, 'TestKwyjibo'), [403, 'op.denied-soul']);
  assert.deepEqual(await refusal(addressed.id, 'TestWindow'), [403, 'op.addressed']);
  assert.deepEqual(await refusal(mine.id, 'TestOther'), [409, 'op.name-mismatch']);
  assert.deepEqual(await refusal('ap_' + '0'.repeat(32), 'TestMsg'), [404, 'not-found']);
  assert.equal((await w.op('approve', { approvalId: mine.id })).status, 400, 'the name is required');
  const ok = await w.op('approve', { approvalId: mine.id, name: 'TestMsg' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.owner, OPERATOR_ACCOUNT);
  assert.deepEqual(await refusal(mine.id, 'TestMsg'), [409, 'op.not-pending']);
  const polled = await w.ready(mine);
  assert.match(polled.token, /^sim_s_/);
  const soul = w.f.db.soul(polled.soulId)!;
  assert.equal(soul.owner, OPERATOR_ACCOUNT); assert.equal(soul.name, 'TestMsg');
  // nothing was answered for anyone else
  for (const a of [real, kw, addressed]) assert.equal(w.f.db.db.prepare('SELECT status FROM account_approvals_v1 WHERE id=?').get(a.id)!.status, 'pending');
});

test('message, inbox, delete: only Souls the operator approved, by name + id; Gene\'s Souls never', async t => {
  const w = await world(t);
  const mine = await w.request('0101', 'TestInbox');
  assert.equal((await w.op('approve', { approvalId: mine.id, name: 'TestInbox' })).status, 200);
  const soulId = (await w.ready(mine)).soulId as string;
  // Gene's own Soul (approved by his account; a TEST-looking name does not make it the operator's)
  const his = await w.request('0102', 'TestGene');
  assert.equal((await w.call(`/v1/account/approvals/${his.id}/approve`, {}, { token: 'gene', key: null })).status, 200);
  const hisId = (await w.ready(his)).soulId as string;
  for (const verb of ['message', 'inbox', 'delete']) {
    const r = await w.op(verb, { soulId: hisId, name: 'TestGene', text: 'hello' });
    assert.deepEqual([r.status, r.data.code], [403, 'op.not-test-soul'], verb);
    const k = await w.op(verb, { soulId: 's_c8520a0a76', name: 'Kwyjibo', text: 'hello' });
    assert.deepEqual([k.status, k.data.code], [403, 'op.denied-soul'], `${verb} Kwyjibo`);
    const n = await w.op(verb, { soulId, name: 'TestWrong', text: 'hello' });
    assert.deepEqual([n.status, n.data.code], [409, 'op.name-mismatch'], `${verb} wrong name`);
    assert.equal((await w.op(verb, { soulId })).status, 400, `${verb} needs the name`);
  }
  assert.equal(w.f.db.soul(hisId)!.retired_at, null);
  // the owner message lands in the same inbox the browser card writes (a second reader of the same store sees it)
  assert.equal((await w.op('message', { soulId, name: 'TestInbox', text: '' })).status, 400);
  const sent = await w.op('message', { soulId, name: 'TestInbox', text: 'walk to the well' });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.inbox.latest.text, 'walk to the well'); assert.equal(sent.data.inbox.latest.state, 'sent');
  const agentView = new AgentInbox(w.f.db, w.f.host.worldId).view({ scope: `soul:${soulId}`, owner: OPERATOR_ACCOUNT });
  assert.equal(agentView.latest?.id, sent.data.inbox.latest.id); assert.equal(agentView.queued, 1);
  const read = await w.op('inbox', { soulId, name: 'TestInbox' });
  assert.equal(read.status, 200); assert.equal(read.data.inbox.latest.id, sent.data.inbox.latest.id); assert.equal(read.data.inbox.latest.state, 'sent');
  // delete: retired by name + id; afterwards nothing answers for it
  const gone = await w.op('delete', { soulId, name: 'TestInbox' });
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  for (let i = 0; i < 40 && w.f.db.soul(soulId)!.retired_at === null; i++) { await setImmediate(); w.f.host.drainInputs(); }
  assert.notEqual(w.f.db.soul(soulId)!.retired_at, null);
  assert.equal((await w.op('inbox', { soulId, name: 'TestInbox' })).status, 404);
});

test('LINK body: a TEST Soul\'s body clocks shorten (never lengthen) for the live checks; other worlds have no body rule', async t => {
  const plain = await world(t);
  const p = await plain.request('0301', 'TestPlain'); await plain.op('approve', { approvalId: p.id, name: 'TestPlain' }); const pid = (await plain.ready(p)).soulId as string;
  assert.deepEqual([(await plain.op('body', { soulId: pid, name: 'TestPlain' })).status], [409], 'no edge ledger: no body rule');
  const w = await world(t, { edge: true });
  const mine = await w.request('0302', 'TestBody'); assert.equal((await w.op('approve', { approvalId: mine.id, name: 'TestBody' })).status, 200);
  const soulId = (await w.ready(mine)).soulId as string;
  const read = await w.op('body', { soulId, name: 'TestBody' });
  assert.equal(read.status, 200, JSON.stringify(read.data)); assert.deepEqual(read.data.knobs, BODY_KNOBS);
  const set = await w.op('body', { soulId, name: 'TestBody', knobs: { sleepGraceMs: 10_000, zombieWanderMs: 60_000 } });
  assert.equal(set.status, 200); assert.equal(set.data.knobs.sleepGraceMs, 10_000); assert.equal(set.data.knobs.zombieWanderMs, 60_000); assert.equal(set.data.knobs.idleStartMs, BODY_KNOBS.idleStartMs);
  assert.equal((await w.op('body', { soulId, name: 'TestBody', knobs: { sleepGraceMs: 10 * 60_000 } })).status, 400, 'never longer than the default');
  assert.equal((await w.op('body', { soulId, name: 'TestBody', knobs: { sleepGraceMs: 10 } })).status, 400, 'at least a second');
  assert.equal((await w.op('body', { soulId, name: 'TestBody', knobs: { bogus: 1 } })).status, 400);
  assert.deepEqual((await w.op('body', { soulId, name: 'TestBody', knobs: null })).data.knobs, BODY_KNOBS, 'null restores the defaults');
  assert.equal((await w.op('body', { soulId, name: 'TestBody' }, { key: null })).status, 404, 'launcher only');
  // Gene's own Souls are never touched
  const his = await w.request('0303', 'TestGene'); await w.call(`/v1/account/approvals/${his.id}/approve`, {}, { token: 'gene', key: null }); const hisId = (await w.ready(his)).soulId as string;
  assert.equal((await w.op('body', { soulId: hisId, name: 'TestGene', knobs: { sleepGraceMs: 5000 } })).status, 403);
});
