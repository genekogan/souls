// World-engine branch copy (reconciled with main e8: main keeps its own account-clerk-auth.test.ts byte-identical).
// Ported from the live release d357 (apps/server/src/account-clerk-auth.test.ts).
// Kept: exact issuer/origin/signature checks, the opaque shared account id across
// world DBs and processes, /v1/config and /v1/account/session, activation guards.
// Changed for the world-engine branch: no account-approval flow here; instead a
// Clerk user creates a Soul directly (the "make a Soul" path the Join lane uses).
import test from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Auth } from './auth.ts'; import { Db } from './db.ts'; import { config } from './config.ts';
import { AccountRegistry } from './account-registry.ts';
import { buildApp } from './http.ts'; import type { Hub } from './hub.ts';
import { fixture, accept } from '../test/native-owner-fixture.ts';
import { ISSUER, ORIGIN, PUBLISHABLE_KEY, clerkKeys, clerkSettings, stubJwks } from '../test/clerk-fixture.ts';

test('Clerk exact verified issuer and origin bind an opaque shared identity; a Clerk user makes a Soul', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-clerk-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { jwk, sign } = await clerkKeys();
  let fetches = 0; const restore = stubJwks(jwk); const stubbed = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => { fetches++; return stubbed(input, init); }) as typeof fetch; t.after(restore);
  const cfg = { ...config, ...clerkSettings(join(dir, 'accounts.sqlite'), '/w/eden'), privyAppId: 'MUST_NOT_INITIALIZE', privyAppSecret: 'synthetic-unused', adminEmails: ['admin@example.test'] };
  const db = new Db(':memory:'), auth = new Auth(cfg, db); await auth.init(); t.after(() => { auth.close(); db.close(); }); assert.equal(fetches, 0, 'no provider call at boot');
  const forged = (await sign()).split('.'); forged[2] = (forged[2][0] === 'a' ? 'b' : 'a') + forged[2].slice(1);
  for (const token of [forged.join('.'), 'user_alice', 'admin@example.test', 'dev:admin', await sign('user_alice', {}, 'https://other.example.test'), await sign('user_alice', { azp: 'https://evil.example.test' }), await sign('user_alice', { sid: null }), await sign('user_alice', { exp: 1 })])
    assert.equal(await auth.accountFromToken(token), null);
  const account = await auth.accountFromToken(await sign('user_alice', { email: 'admin@example.test' }));
  assert.ok(account); assert.match(account.identity.id, /^acct_/); assert.notEqual(account.identity.id, account.identity.subject);
  assert.equal(account.user.email, null); assert.equal(account.user.role, 'user', 'a token email never grants admin'); assert.equal(account.identity.subject, 'user_alice'); assert.equal(auth.me(account.user).userId, account.identity.id);
  const secondDb = new Db(':memory:'), second = new Auth({ ...cfg, worldId: 'other-world' }, secondDb); await second.init();
  assert.equal((await second.accountFromToken(await sign()))?.identity.id, account.identity.id); second.close(); secondDb.close();
  const reopened = new AccountRegistry(cfg.accountRegistryPath);
  assert.equal(reopened.bind(ISSUER, 'user_alice'), account.identity.id); assert.notEqual(reopened.bind('https://other.example.test', 'user_alice'), account.identity.id); assert.notEqual(reopened.bind(ISSUER, 'user_bob'), account.identity.id); reopened.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import {AccountRegistry} from " + JSON.stringify(new URL('./account-registry.ts', import.meta.url).href) + ";const r=new AccountRegistry(process.argv[1]);console.log(JSON.stringify({pid:process.pid,id:r.bind(process.argv[2],process.argv[3])}));r.close();", cfg.accountRegistryPath, ISSUER, 'user_alice'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); const restored = JSON.parse(child.stdout); assert.notEqual(restored.pid, process.pid); assert.equal(restored.id, account.identity.id);

  // mounted HTTP: public config, the session binding, and a Soul made by the signed-in user
  const f = fixture(':memory:'); t.after(() => { f.auth.close(); f.db.close(); });
  Object.assign(f.souls.cfg, cfg, { worldId: f.host.worldId, inviteRequired: false }); f.auth.devAuth = false; await f.auth.init();
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth, hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  const alice = await sign(), bob = await sign('user_bob');
  const request = (path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const publicConfig: any = await (await request('/v1/config', undefined, undefined, { host: 'preview.trycloudflare.com', 'x-forwarded-host': 'evil.example.test', 'x-forwarded-proto': 'https' })).json(); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(publicConfig.authProvider, 'clerk'); assert.equal(publicConfig.authenticationOrigin, ORIGIN, 'from configuration, never the request host');
  assert.equal(publicConfig.clerkPublishableKey, PUBLISHABLE_KEY); assert.equal(publicConfig.clerkIssuer, ISSUER); assert.equal(publicConfig.privyAppId, ''); assert.equal(publicConfig.devAuth, false); assert.equal(publicConfig.accountAuthRequired, true);
  const binding = await request('/v1/account/session', undefined, alice); assert.equal(binding.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await binding.json(), { accountId: account.identity.id, issuer: ISSUER, subject: 'user_alice' });
  assert.equal((await request('/v1/account/session', undefined, 'dev:alice')).status, 401);
  assert.equal((await request('/v1/souls', { name: 'Unsigned' })).status, 401);
  assert.equal((await request('/v1/souls', { name: 'Devvy' }, 'dev:alice')).status, 401);
  // as live (main 5e478f8a): a signed-in account makes a Soul only by approving its agent's request (accounts/), never directly
  const direct = await request('/v1/souls', { name: 'Ada', description: 'a gardener' }, alice);
  assert.equal(direct.status, 403); assert.equal((await direct.json() as { code: string }).code, 'approval-required');
  const me = await (await request('/v1/me', undefined, alice)).json() as { me: { userId: string; souls: string[] } };
  assert.equal(me.me.userId, account.identity.id); assert.deepEqual(me.me.souls, []);
  assert.equal((await request('/v1/me', undefined, bob)).status, 200);
  const none = new Auth({ ...cfg, authProvider: 'none' }, db); await none.init(); assert.equal(await none.accountFromToken(await sign()), null);
});

test('Clerk activation rejects test keys, mismatched issuer, missing origin and missing shared registry', async () => {
  const db = new Db(':memory:'); const base = { ...config, ...clerkSettings(':memory:', ''), publicUrl: ORIGIN };
  try { for (const change of [{ clerkPublishableKey: 'pk_test_invalid' }, { clerkIssuer: 'https://wrong.example.test' }, { clerkAuthorizedParties: [] }, { accountRegistryPath: '' }]) await assert.rejects(new Auth({ ...base, ...change }, db).init()); }
  finally { db.close(); }
});

test('selected Clerk refuses construction before omitted init can enable anonymous dev fallback', async () => {
  const db = new Db(':memory:');
  try {
    for (const publicUrl of ['http://127.0.0.1:4959', 'https://sim.example.test/w/eden'])
      assert.throws(() => new Auth({ ...config, authProvider: 'clerk', accountAuthRequired: false, publicUrl, privyAppId: 'synthetic-disabled', privyAppSecret: 'synthetic-disabled' }, db), /Clerk activation requires ACCOUNT_AUTH_REQUIRED=1/);
    assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 0);
    // Existing explicit local/legacy flows retain their original semantics (local dev stays available).
    const legacy = new Auth({ ...config, authProvider: 'privy', accountAuthRequired: false, publicUrl: 'http://127.0.0.1:4959' }, db); legacy.devAuth = true;
    assert.ok(await legacy.userFromToken('dev:agent-' + 'b'.repeat(24))); assert.ok(await legacy.userFromToken('dev:gene')); legacy.close();
  } finally { db.close(); }
});

test('reconciled with main e8: the dev-token lockout applies to new (world-engine) worlds only', async () => {
  const db = new Db(':memory:');
  try {
    const old = new Auth({ ...config, ...clerkSettings(':memory:', '/w/eden'), worldEngine: false }, db);
    assert.equal(old.production, false, 'old worlds keep main\'s legacy agent-local projection');
    const fresh = new Auth({ ...config, ...clerkSettings(':memory:', '/w/willow'), worldEngine: true }, db);
    assert.equal(fresh.production, true);
    assert.equal(await fresh.userFromToken('dev:agent-' + 'b'.repeat(24)), null, 'no dev identity of any shape on a new world');
  } finally { db.close(); }
});
