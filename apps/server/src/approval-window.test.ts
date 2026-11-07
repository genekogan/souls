// Lane PUX (Gene 2026-10-20): an agent's Soul request reaches the person's open, signed-in world window instead of only a
// link that opens a second tab. The match rule: the person's page mints a short window code; the agent passes it with
// its request (`create-soul --for CODE`); only a live code of this world addresses the request, and only to the account
// that minted it. Nothing else (a name, an email, a guessed code) can push a card into anyone's window. A request does not
// expire while its agent still polls; an expired one can be asked again (same request, same agent credential).
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { tx } from './edge/comms/store.ts';
import { AccountStore, AccountStoreError, WINDOW_CODE, type AccountIdentity, type Allocation, type AllocationInput, type AccountsDb } from './accounts/store.ts';
import { fillInstructions } from './accounts/instructions.ts';
import { fixture as worldFixture } from '../test/native-owner-fixture.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';

const input = (key: string, extra: Record<string, unknown> = {}) => ({ agentLabel: 'eden-agent 1.9.3', name: 'Qwyjibo', idempotencyKey: 'window-request-key-' + key, pollSecret: randomBytes(32).toString('base64url'), ...extra });
const error = (code: string) => (e: unknown) => e instanceof AccountStoreError && e.code === code;
function fixture(t: TestContext) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  let now = 10_000;
  const db: AccountsDb = { db: sql, tx<T>(fn: () => T): T { return tx(sql, fn, sql.isTransaction ? undefined : { immediate: true }); } };
  const gene: AccountIdentity = { id: 'account-gene', issuer: 'fixture', subject: 'gene', verifiedAt: 100, expiresAt: 1e15 };
  const other: AccountIdentity = { ...gene, id: 'account-other', subject: 'other' };
  const store = new AccountStore(db, 'world-a', { now: () => now, approvalTtlMs: 1000 });
  const allocate = (a: AllocationInput): Allocation => ({ worldId: a.worldId, accountId: a.accountId, requestId: a.requestId, soulId: 's_qwyjibo' });
  return { sql, db, store, gene, other, allocate, advance(ms: number) { now += ms; } };
}

test('match rule: only a live window code of this world addresses a request, and only to the account that minted it', t => {
  const f = fixture(t), mine = f.store.windowCode(f.gene);
  assert.match(mine.code, WINDOW_CODE);
  assert.equal(f.store.windowCode(f.gene).code, mine.code, 'the same code while it has time left (prompts stay stable)');
  assert.notEqual(f.store.windowCode(f.other).code, mine.code);
  const addressed = f.store.start(input('0001', { forCode: mine.code }));
  assert.equal(addressed.inWindow, true);
  assert.deepEqual(f.store.waiting(f.gene).map(a => a.id), [addressed.id]);
  assert.deepEqual(f.store.waiting(f.other), [], 'never shown to another account');
  // no code, a malformed one, a guessed one, or one minted in another world: a plain link request, shown to nobody
  const elsewhere = new AccountStore(f.db, 'world-b', { approvalTtlMs: 1000 });
  for (const [key, forCode] of [['0002', undefined], ['0003', 'k7qx-m2pa'], ['0004', 'ZZZZ-ZZZZ'], ['0005', elsewhere.windowCode(f.gene).code]] as const) {
    const plain = f.store.start(input(key, forCode ? { forCode } : {}));
    assert.equal(plain.inWindow, false, String(forCode));
  }
  assert.equal(f.store.waiting(f.gene).length, 1);
  // another account cannot see, approve, refuse or ask again on a request addressed to someone else
  assert.throws(() => f.store.view(addressed.id, f.other), error('forbidden'));
  assert.throws(() => f.store.approve(f.other, addressed.id, f.allocate), error('forbidden'));
  assert.throws(() => f.store.cancel(f.other, addressed.id), error('forbidden'));
  assert.throws(() => f.store.renew(f.other, addressed.id), error('forbidden'));
  // the addressed account may refuse it (a plain link request still needs the agent's credential to cancel)
  assert.equal(f.store.cancel(f.gene, addressed.id).status, 'cancelled');
  assert.deepEqual(f.store.waiting(f.gene), []);
  // a code lapses after a day; a request made with it then is a plain link request
  f.advance(24 * 60 * 60_000);
  assert.equal(f.store.start(input('0006', { forCode: mine.code })).inWindow, false);
  assert.notEqual(f.store.windowCode(f.gene).code, mine.code);
});

test('a retry of the same request keeps how it was addressed; the code is not part of the request', t => {
  const f = fixture(t), code = f.store.windowCode(f.gene).code, req = input('0010', { forCode: code });
  const first = f.store.start(req);
  assert.equal(first.inWindow, true);
  const retry = f.store.start({ ...req, forCode: f.store.windowCode(f.other).code });
  assert.equal(retry.id, first.id); assert.equal(retry.inWindow, true);
  assert.deepEqual(f.store.waiting(f.gene).map(x => x.id), [first.id]);
  assert.deepEqual(f.store.waiting(f.other), [], 'an addressed request is never re-addressed');
  assert.equal(f.store.start({ ...req, forCode: undefined }).id, first.id);
});

test('a retry that adds a live code moves the unaddressed request into that window', t => {
  // Real agent 2026-10-26: create-soul without the code, then with it, got the same request back as a link only.
  const f = fixture(t), code = f.store.windowCode(f.gene).code, req = input('0011');
  const first = f.store.start(req);
  assert.equal(first.inWindow, false);
  const retry = f.store.start({ ...req, forCode: code });
  assert.equal(retry.id, first.id); assert.equal(retry.inWindow, true);
  assert.deepEqual(f.store.waiting(f.gene).map(x => x.id), [first.id]);
});

test('expiry: a polled request never lapses; an unpolled one does; Ask again revives the same request for the waiting agent', t => {
  const f = fixture(t), code = f.store.windowCode(f.gene).code, req = input('0020', { forCode: code }), a = f.store.start(req);
  // the agent polls every few seconds: 5x the lifetime passes and it is still pending
  for (let i = 0; i < 10; i++) { f.advance(500); assert.equal(f.store.poll(a.id, req.pollSecret).status, 'pending'); }
  // the agent stops: one lifetime later it has expired, and is no longer waiting in the window
  f.advance(1000);
  assert.equal(f.store.view(a.id, f.gene).status, 'expired');
  assert.deepEqual(f.store.waiting(f.gene), []);
  // Ask again: same id, pending again, back in the window; the agent's own credential still polls it
  const again = f.store.renew(f.gene, a.id);
  assert.equal(again.id, a.id); assert.equal(again.status, 'pending'); assert.equal(again.inWindow, true);
  assert.deepEqual(f.store.waiting(f.gene).map(x => x.id), [a.id]);
  assert.equal(f.store.poll(a.id, req.pollSecret).status, 'pending');
  // approve -> the agent's next poll finds it accepted (the body then becomes ready through reconcile)
  assert.equal(f.store.approve(f.gene, a.id, f.allocate).status, 'creating');
  assert.equal(f.store.poll(a.id, req.pollSecret).status, 'creating');
  // renew is only for expired requests: anything else comes back unchanged
  assert.equal(f.store.renew(f.gene, a.id).status, 'creating');
});

test('Ask again on a link request (no code) addresses it to the person who asked, so it shows in their window', t => {
  const f = fixture(t), req = input('0030'), a = f.store.start(req);
  f.advance(1500);
  assert.equal(f.store.poll(a.id, req.pollSecret).status, 'expired', 'polling never revives an expired request');
  const again = f.store.renew(f.gene, a.id);
  assert.equal(again.status, 'pending'); assert.equal(again.inWindow, true);
  assert.deepEqual(f.store.waiting(f.gene).map(x => x.id), [a.id]);
  assert.throws(() => f.store.view(a.id, f.other), error('forbidden'));
  assert.equal(f.store.cancel(null, a.id, req.pollSecret).status, 'cancelled', 'the agent can still cancel it');
  assert.equal(f.store.renew(f.gene, a.id).status, 'cancelled', 'a cancelled request is not asked again');
});

test('instructions.md?for=<code> names the code in the command and points to the open window; no code keeps the link', () => {
  const text = 'World {{WORLD}} at {{BASE}}: `create-soul "<Name>"{{FOR}}`. {{APPROVE}}';
  const window = fillInstructions(text, 'https://sim.example.test/worlds/w/bench-hamlet', 'Bench Hamlet', 'K7QX-M2PA');
  assert.match(window, /create-soul "<Name>" --for K7QX-M2PA`/); assert.match(window, /open Sim window/); assert.match(window, /Bench Hamlet at https:\/\/sim\.example\.test\/worlds\/w\/bench-hamlet/);
  for (const bad of [null, '', 'k7qx-m2pa', 'K7QX-M2PA`; rm -rf /', '<script>']) {
    const plain = fillInstructions(text, 'https://x.test/w/a', 'A', bad);
    assert.match(plain, /create-soul "<Name>"`/); assert.match(plain, /approval link/); assert.doesNotMatch(plain, /--for|rm -rf|script/);
  }
});

test('HTTP: the signed-in page gets a code, the agent request with it lands in that account\'s window list, Ask again revives it', async t => {
  const f = worldFixture(':memory:', await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true })); f.brain.quiesce(); f.souls.enableLifecycle(); t.after(() => { f.host.stop(); f.db.close(); });
  f.souls.cfg.accountAuthRequired = true; f.souls.cfg.inviteRequired = false;
  const ids = new Map<string, AccountIdentity>();
  for (const name of ['gene', 'other']) { const id = 'did:privy:' + name; f.db.upsertUser({ id, email: null, wallet: null, role: 'user' }); ids.set(name, { id, issuer: 'privy.io/test-app', subject: id, verifiedAt: Date.now(), expiresAt: Date.now() + 600_000 }); }
  f.auth.accountFromToken = async token => { const identity = ids.get(token ?? ''); return identity ? { identity, user: f.db.user(identity.id)! } : null; };
  const original = f.auth.userFromToken.bind(f.auth); f.auth.userFromToken = async token => ids.has(token ?? '') ? f.db.user(ids.get(token!)!.id)! : original(token);
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth, hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  const call = async (path: string, body?: unknown, token?: string) => { const r = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:4956', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() as any }; };

  assert.equal((await call('/v1/account/window-code', {})).status, 401, 'signed-out pages get no code');
  const code = (await call('/v1/account/window-code', {}, 'gene')).data.code;
  assert.match(code, WINDOW_CODE);
  const req = input('http-0001');
  const start = await call('/v1/agent/approval/start', { ...req, for: code });
  assert.equal(start.status, 200); assert.equal(start.data.delivery, 'window'); assert.equal(start.data.approval.inWindow, true);
  const id = start.data.approval.id;
  assert.match(start.data.approvalURL, new RegExp(`/#approve/${id}$`), 'the link stays, as a backup');
  const plain = await call('/v1/agent/approval/start', input('http-0002'));
  assert.equal(plain.data.delivery, 'link');
  // the window list: gene sees exactly the addressed request (with no photo: the Soul does not exist yet); other sees nothing
  const listed = await call('/v1/account/approvals', undefined, 'gene');
  assert.deepEqual(listed.data.approvals.map((a: any) => [a.id, a.name, a.agentLabel, a.photo]), [[id, 'Qwyjibo', 'eden-agent 1.9.3', null]]);
  assert.deepEqual((await call('/v1/account/approvals', undefined, 'other')).data.approvals, []);
  assert.equal((await call('/v1/account/approvals', undefined)).status, 401);
  assert.equal((await call(`/v1/account/approvals/${id}`, undefined, 'other')).status, 403);
  assert.equal((await call(`/v1/account/approvals/${id}/approve`, {}, 'other')).status, 403);
  // it lapses (the agent stopped polling): Ask again revives it, and the agent's poll finds it pending again
  f.db.db.prepare('UPDATE account_approvals_v1 SET expires_at=? WHERE id=?').run(Date.now() - 1, id);
  assert.equal((await call(`/v1/account/approvals/${id}`, undefined, 'gene')).data.approval.status, 'expired');
  assert.equal((await call('/v1/account/approvals', undefined, 'gene')).data.approvals.length, 0);
  assert.equal((await call(`/v1/account/approvals/${id}/renew`, {}, 'other')).status, 403);
  const renewed = await call(`/v1/account/approvals/${id}/renew`, {}, 'gene');
  assert.equal(renewed.status, 200); assert.equal(renewed.data.approval.status, 'pending'); assert.equal(renewed.data.approval.id, id);
  assert.equal((await call('/v1/agent/approval/poll', { approvalId: id, pollSecret: req.pollSecret })).data.status, 'pending');
  // approve from the window: the agent's poll ends with its Soul grant
  const approved = await call(`/v1/account/approvals/${id}/approve`, {}, 'gene');
  assert.equal(approved.status, 200, JSON.stringify(approved.data)); assert.ok(['creating', 'ready'].includes(approved.data.approval.status));
  let polled: any;
  for (let i = 0; i < 40; i++) { await setImmediate(); f.host.drainInputs(); polled = (await call('/v1/agent/approval/poll', { approvalId: id, pollSecret: req.pollSecret })).data; if (polled.token) break; }
  assert.equal(polled.status, 'ready'); assert.match(polled.token, /^sim_s_/);
  // once the Soul exists the card can show its picture (when the world has one for it)
  const after = (await call(`/v1/account/approvals/${id}`, undefined, 'gene')).data.approval;
  assert.ok(after.photo === null || /\/v1\/souls\/s_[^/]+\/profile-photo\//.test(after.photo));
  // Lane PAIR-INWINDOW (Gene's review #1 + #2): a fresh folder reconnects by ID alone; with no code the request goes to the
  // owner's window, titled with the Soul's REAL name; the agent's wrong name (Gene's agent sent the ID) is ignored, and the
  // pressed Approve succeeds instead of failing with soul-name-changed.
  const sid = after.soulId as string, real = f.db.soul(sid)!.name;
  const bare = input('http-0003'); delete (bare as any).name;
  const byId = await call('/v1/agent/approval/start', { ...bare, soulId: sid });
  assert.equal(byId.status, 200, JSON.stringify(byId.data)); assert.equal(byId.data.delivery, 'window'); assert.equal(byId.data.approval.name, real);
  const guessed = await call('/v1/agent/approval/start', { ...input('http-0004'), name: sid.slice(0, 32), soulId: sid });
  assert.equal(guessed.status, 200); assert.equal(guessed.data.approval.name, real, 'the agent-supplied name is ignored for a reconnect');
  const mine = (await call('/v1/account/approvals', undefined, 'gene')).data.approvals;
  assert.deepEqual(mine.map((a: any) => [a.id, a.name, a.soulId]).sort(), [[byId.data.approval.id, real, sid], [guessed.data.approval.id, real, sid]].sort());
  assert.ok(mine.every((a: any) => 'photo' in a));
  assert.deepEqual((await call('/v1/account/approvals', undefined, 'other')).data.approvals, [], 'never shown to another account');
  assert.equal((await call(`/v1/account/approvals/${guessed.data.approval.id}/approve`, {}, 'other')).status, 403);
  const repaired = await call(`/v1/account/approvals/${guessed.data.approval.id}/approve`, {}, 'gene');
  assert.equal(repaired.status, 200, JSON.stringify(repaired.data)); assert.ok(['creating', 'ready'].includes(repaired.data.approval.status));
  const unknown = await call('/v1/agent/approval/start', { ...input('http-0005'), soulId: 's_nobodyhere' });
  assert.equal(unknown.status, 404); assert.match(JSON.stringify(unknown.data), /soul-not-found/);
  const nameless = input('http-0006'); delete (nameless as any).name;
  assert.equal((await call('/v1/agent/approval/start', nameless)).status, 400, 'a new Soul still needs a name');
});

// Lane PAIR-INWINDOW (Gene's review 2026-10-22 #1): re-pairing a Soul from a fresh folder printed only a link, which opened a
// second copy of the world. For a repair the owner is already known (the Soul's membership), so with no code the request goes
// to the owner's open window. That conveys no control: approve() still requires that exact membership.
test('a repair with no code goes to the Soul owner\'s window only; nobody else can see or approve it; a create stays a link', t => {
  const f = fixture(t);
  const made = f.store.start(input('0101'));
  assert.equal(made.inWindow, false, 'an anonymous create with no code is a link request');
  f.store.approve(f.gene, made.id, f.allocate);
  const repair = f.store.startRepairRequest('s_qwyjibo', input('0102', { mode: 'repair' }));
  assert.equal(repair.inWindow, true, 'the owner is known: delivered to their window');
  assert.deepEqual(f.store.waiting(f.gene).map(a => a.id), [repair.id]);
  assert.deepEqual(f.store.waiting(f.other), [], 'never shown to another account');
  assert.throws(() => f.store.view(repair.id, f.other), error('forbidden'));
  assert.throws(() => f.store.approve(f.other, repair.id, f.allocate), error('forbidden'));
  // a code minted by another account cannot redirect a repair away from the owner
  const stray = f.store.startRepairRequest('s_qwyjibo', input('0103', { mode: 'repair', forCode: f.store.windowCode(f.other).code }));
  assert.equal(stray.inWindow, true);
  assert.deepEqual(f.store.waiting(f.other), []);
  assert.throws(() => f.store.approve(f.other, stray.id, f.allocate), error('forbidden'));
  // an unknown Soul has no owner: link only, shown to nobody
  const unknown = f.store.startRepairRequest('s_nobody', input('0104', { mode: 'repair' }));
  assert.equal(unknown.inWindow, false);
  // the owner approves in the window; that still runs the exact membership check
  assert.equal(f.store.approve(f.gene, repair.id, f.allocate).status, 'creating');
});
