// Real Hono/Auth/SQLite/Souls. In-process local fixtures; no socket or paid mind.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { Auth, hashToken } from './auth.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import { Souls } from './souls.ts';
import { WorldHost } from './world.ts';

function fixture(t: TestContext) {
  const db = new Db(':memory:'); t.after(() => db.close());
  const host = new WorldHost(db, toyFactory, 'pair-body-fixture', 1e9, 'eden-pair-fixture'); host.boot();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', worldPath: '/w/eden', brainMode: 'fake' as const,
    budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined, privyAppId: '', privyAppSecret: '', inviteRequired: true };
  const auth = new Auth(cfg, db); auth.devAuth = true;
  for (const name of ['alice', 'bob', 'admin']) {
    db.upsertUser({ id: `dev:${name}`, role: name === 'admin' ? 'admin' : 'user', email: null, wallet: null });
    db.setInvited(`dev:${name}`, 'local-fixture');
  }
  const brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {}, onTalk() {} });
  const souls = new Souls(host, db, brain, cfg);
  db.createSoul({ id: 's_alice', worldId: host.worldId, owner: 'dev:alice', entityId: 'h_alice', name: 'Alice', description: 'fixture', native: false });
  void host.enqueue('birth', 'fixture', { soulId: 's_alice', entityId: 'h_alice', owner: 'dev:alice', name: 'Alice', description: 'fixture' }); host.drainInputs();
  const app = buildApp({ cfg, db, host, auth, brain, souls, hub: { refreshMe() {} } as unknown as Hub });
  const request = (path: string, data?: unknown, token?: string, ip = 'fixture') => app.request(path, {
    method: data === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:4950', 'x-forwarded-for': ip,
      ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const start = async () => { const r = await request('/v1/agent/pair/start', { agent: 'local fixture' }); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); return await r.json() as any; };
  const poll = (key: string, ip?: string) => request('/v1/agent/pair/poll', { poll_token: key }, undefined, ip);
  const approve = (code: string, soulId = 's_alice', owner = 'dev:alice') => request('/v1/pair/approve', { code, soulId }, owner);
  return { db, host, souls, app, request, start, poll, approve };
}

test('body poll pairs once, proves current Soul via Me/perceive, then owner revokes', async t => {
  const f = fixture(t), started = await f.start();
  assert.ok(!started.approve_url.includes(started.poll_token));
  assert.ok(!started.approve_url.includes('?')); assert.ok(started.approve_url.includes('/w/eden/#pair/'));
  const pending = await f.poll(started.poll_token); assert.deepEqual(await pending.json(), { ok: true, status: 'pending' });
  const metadata = await f.request(`/v1/pair/${started.user_code}`, undefined, 'dev:alice');
  assert.equal(metadata.headers.get('cache-control'), 'no-store'); assert.ok(!JSON.stringify(await metadata.json()).includes(started.poll_token));
  assert.equal((await f.approve(started.user_code, 's_alice', 'dev:bob')).status, 403);
  const approved = await f.approve(started.user_code); assert.equal(approved.status, 200); assert.equal(approved.headers.get('cache-control'), 'no-store');
  const delivered = await f.poll(started.poll_token); assert.equal(delivered.status, 200); assert.equal(delivered.headers.get('cache-control'), 'no-store');
  const pair = await delivered.json() as any; assert.equal(pair.status, 'approved'); assert.equal(pair.soul.id, 's_alice');
  assert.equal((await f.poll(started.poll_token)).status, 404);
  assert.equal((await (await f.request('/v1/agent/me', undefined, pair.token)).json() as any).soul.id, 's_alice');
  const perceived = await f.request('/v1/agent/perceive', undefined, pair.token); assert.equal(perceived.status, 200); assert.equal((await perceived.json() as any).soul.name, 'Alice');
  assert.equal((await f.request('/v1/souls/s_alice/revoke', {}, 'dev:alice')).status, 200);
  assert.equal((await f.request('/v1/agent/me', undefined, pair.token)).status, 401);
  assert.equal((await f.request('/v1/agent/perceive', undefined, pair.token)).status, 401);
  assert.equal(f.db.paidCost(), 0);
});

test('strict poll body refuses query credentials, malformed JSON, extra fields and oversized bodies with no-store', async t => {
  const f = fixture(t), started = await f.start();
  for (const value of [{}, { poll_token: '' }, { poll_token: started.poll_token, extra: true }, { poll_token: 3 }]) {
    const r = await f.request('/v1/agent/pair/poll', value); assert.equal(r.status, 400); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  const query = await f.request(`/v1/agent/pair/poll?poll_token=${started.poll_token}`, {}); assert.equal(query.status, 400);
  for (const [body, status] of [['{bad-json', 400], [JSON.stringify({ poll_token: 'x'.repeat(70_000) }), 413]] as const) {
    const r = await f.app.request('/v1/agent/pair/poll', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, status); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  for (const path of ['/v1/pair/missing', '/v1/souls/s_alice/pair']) {
    const r = await f.request(path, path.includes('souls') ? {} : undefined); assert.equal(r.status, 401); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});

test('unknown and expired poll refuse without releasing a credential; legacy GET keeps one-use compatibility', async t => {
  const f = fixture(t); assert.equal((await f.poll('a'.repeat(32))).status, 404);
  const started = await f.start(); const clock = t.mock.method(Date, 'now', () => 0);
  const old = await f.start(); clock.mock.restore();
  assert.equal((await f.poll(old.poll_token)).status, 404); assert.equal((await f.approve(old.user_code)).status, 404);
  assert.equal((await f.approve(started.user_code)).status, 200);
  const legacy = await f.request(`/v1/agent/pair/poll?poll_token=${started.poll_token}`);
  assert.equal(legacy.status, 200); assert.equal(legacy.headers.get('cache-control'), 'no-store');
  assert.equal((await legacy.json() as any).status, 'approved'); assert.equal((await f.poll(started.poll_token)).status, 404);
});

test('POST and legacy GET share the poll rate bucket, including error responses', async t => {
  const f = fixture(t), started = await f.start();
  for (let i = 0; i < 30; i++) {
    assert.equal((await f.poll(started.poll_token, 'shared-rate')).status, 200);
    assert.equal((await f.request(`/v1/agent/pair/poll?poll_token=${started.poll_token}`, undefined, undefined, 'shared-rate')).status, 200);
  }
  const limited = await f.poll(started.poll_token, 'shared-rate'); assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('cache-control'), 'no-store'); assert.ok(limited.headers.get('retry-after'));
});

test('approved but undelivered credentials refuse rotation, revocation, retirement or changed current approval authority', async t => {
  const changes: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ['rotation', f => f.db.setSoulToken('s_alice', hashToken('fixture-new-generation'))],
    ['revoke', f => f.db.setSoulToken('s_alice', null)],
    ['retire', f => f.db.retireSoul('s_alice')],
    ['owner transfer', f => f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('dev:bob', 's_alice')],
    ['invite revoke', f => f.db.db.prepare('UPDATE users SET invited_by=NULL WHERE id=?').run('dev:alice')],
    ['world transfer', f => f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run('elsewhere', 's_alice')],
  ];
  for (const [name, change] of changes) await t.test(name, async sub => {
    const f = fixture(sub), started = await f.start(); await f.approve(started.user_code); change(f);
    const r = await f.poll(started.poll_token); assert.equal(r.status, 404); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(!('token' in await r.json() as any)); assert.equal((await f.poll(started.poll_token)).status, 404);
  });
  await t.test('admin approval follows current role', async sub => {
    const f = fixture(sub), started = await f.start(); assert.equal((await f.approve(started.user_code, 's_alice', 'dev:admin')).status, 200);
    f.db.db.prepare('UPDATE users SET role=? WHERE id=?').run('user', 'dev:admin'); assert.equal((await f.poll(started.poll_token)).status, 404);
  });
});

test('selected-world approval, owner code and bearer lookup refuse foreign Souls', async t => {
  const f = fixture(t); f.db.createSoul({ id: 's_remote', worldId: 'mars-fixture', owner: 'dev:alice', entityId: 'h_remote', name: 'Remote', description: 'fixture', native: false });
  const started = await f.start(); assert.equal((await f.approve(started.user_code, 's_remote')).status, 404);
  assert.equal((await f.request('/v1/souls/s_remote/pair', {}, 'dev:alice')).status, 404);
  const bearer = 'sim_fixture_remote_only'; f.db.setSoulToken('s_remote', hashToken(bearer));
  assert.equal((await f.request('/v1/agent/me', undefined, bearer)).status, 401);
  assert.equal((await f.request('/v1/agent/perceive', undefined, bearer)).status, 401);
});

test('owner code remains one-use and rechecks original ownership and invitation before exchange', async t => {
  const f = fixture(t); const codeResponse = await f.request('/v1/souls/s_alice/pair', {}, 'dev:alice');
  assert.equal(codeResponse.headers.get('cache-control'), 'no-store'); const code = (await codeResponse.json() as any).code;
  f.db.db.prepare('UPDATE users SET invited_by=NULL WHERE id=?').run('dev:alice');
  assert.equal((await f.request('/v1/agent/pair', { code })).status, 404); assert.equal(f.db.soul('s_alice')!.token_hash, null);
  f.db.setInvited('dev:alice', 'fixture'); const next = await f.request('/v1/souls/s_alice/pair', {}, 'dev:alice');
  const nextCode = (await next.json() as any).code; assert.equal((await f.request('/v1/agent/pair', { code: nextCode })).status, 200);
  assert.equal((await f.request('/v1/agent/pair', { code: nextCode })).status, 404);
  const transferred = await f.request('/v1/souls/s_alice/pair', {}, 'dev:alice');
  f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('dev:bob', 's_alice');
  assert.equal((await f.request('/v1/agent/pair', { code: (await transferred.json() as any).code })).status, 404);
});
