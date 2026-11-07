// Real Hono owner route, real Auth/SQLite; no network, provider or production data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { toyFactory } from '@souls/engine-toy';
import type { BrainCall } from '@souls/protocol';
import { Auth, hashToken } from './auth.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import { migrate } from './migrations.ts';
import type { Hub } from './hub.ts';
import { Souls } from './souls.ts';
import { WorldHost } from './world.ts';

function fixture() {
  const db = new Db(':memory:');
  const host = new WorldHost(db, toyFactory, 'prompt-authority', 1e9, 'eden-fixture'); host.boot();
  for (const [id, worldId, owner] of [['s_alice', host.worldId, 'dev:alice'], ['s_bob', host.worldId, 'dev:bob'], ['s_remote', 'mars-fixture', 'dev:alice']]) {
    db.createSoul({ id, worldId, owner, entityId: `h_${id}`, name: id, description: 'local fixture', native: false });
  }
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', worldPath: '/w/eden', brainMode: 'fake' as const,
    budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined, privyAppId: '', privyAppSecret: '', publicUrl: 'http://127.0.0.1:4950' };
  const auth = new Auth(cfg, db); auth.devAuth = true;
  const brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {}, onTalk() {} });
  const souls = new Souls(host, db, brain, cfg);
  // These routes do not use WS; keep the fixture in-process and off reserved ports.
  const app = buildApp({ cfg, db, host, auth, brain, souls, hub: { refreshMe() {} } as unknown as Hub });
  const call = (text: string, soulId: string | null, worldId = host.worldId, at = Date.now()) => {
    const ref = db.internPrompt(text);
    const c: Omit<BrainCall, 'id'> = { tick: 0, at, tier: 'compile', subject: 'fixture', soulId, model: 'fake', mode: 'fake',
      request: { system: [{ type: 'text', text: ref }] }, response: {}, applied: {}, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 };
    return { ...ref, callId: db.saveBrainCall(worldId, c) };
  };
  const get = (hash: string, token?: string) => app.request(`/v1/prompt/${hash}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { db, host, app, auth, call, get };
}

test('prompt lookup requires originating Soul ownership; knowing another owner’s hash never grants its text', async () => {
  const f = fixture(); try {
    const alice = f.call('PRIVATE_ALICE_MARKER', 's_alice'), bob = f.call('PRIVATE_BOB_MARKER', 's_bob');
    const allowed = await f.get(alice.$prompt, 'dev:alice');
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    assert.equal(await allowed.text(), 'PRIVATE_ALICE_MARKER');
    const denied = await f.get(bob.$prompt, 'dev:alice');
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await denied.json(), { ok: false, code: 'not-found', message: 'no such prompt' });
    assert.equal((await f.get(bob.$prompt, 'dev:bob')).status, 200);
    const anonymous = await f.get(alice.$prompt);
    assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get('cache-control'), 'no-store');
  } finally { f.db.close(); }
});

test('shared prompt content is visible through an own call; global and foreign-world calls do not grant owner access', async () => {
  const f = fixture(); try {
    const shared = f.call('IDENTICAL_SHARED_CONTENT', 's_alice'); f.call('IDENTICAL_SHARED_CONTENT', 's_bob');
    assert.equal((await f.get(shared.$prompt, 'dev:alice')).status, 200);
    assert.equal((await f.get(shared.$prompt, 'dev:bob')).status, 200);
    const global = f.call('GLOBAL_ONLY', null), remote = f.call('FOREIGN_WORLD', 's_remote', 'mars-fixture');
    assert.equal((await f.get(global.$prompt, 'dev:alice')).status, 404);
    assert.equal((await f.get(global.$prompt, 'dev:admin')).status, 200);
    assert.equal((await f.get(remote.$prompt, 'dev:alice')).status, 404);
    assert.equal((await f.get(remote.$prompt, 'dev:admin')).status, 404);
    const mismatch = f.call('MISMATCHED_SOUL_WORLD', 's_remote');
    assert.equal((await f.get(mismatch.$prompt, 'dev:alice')).status, 404);
  } finally { f.db.close(); }
});

test('unassociated, pruned and nonexistent prompt references fail closed even for admins', async () => {
  const f = fixture(); try {
    const orphan = f.db.internPrompt('ORPHAN_MARKER'), old = f.call('PRUNED_MARKER', 's_alice', f.host.worldId, 0);
    f.db.pruneBrainCalls();
    assert.equal(f.db.db.prepare('SELECT COUNT(*) AS n FROM prompts').get()!.n, 2, 'pruning does not erase prompt history');
    for (const token of ['dev:alice', 'dev:admin']) for (const hash of [orphan.$prompt, old.$prompt, 'not-a-real-hash']) {
      const r = await f.get(hash, token); assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { ok: false, code: 'not-found', message: 'no such prompt' });
    }
  } finally { f.db.close(); }
});

test('current ownership, retirement and admin role are checked on every prompt request', async () => {
  const f = fixture(); try {
    const ref = f.call('RECHECK_MARKER', 's_alice');
    assert.equal((await f.get(ref.$prompt, 'dev:alice')).status, 200);
    f.db.db.prepare('UPDATE souls SET owner = ? WHERE id = ?').run('dev:bob', 's_alice');
    assert.equal((await f.get(ref.$prompt, 'dev:alice')).status, 404);
    assert.equal((await f.get(ref.$prompt, 'dev:bob')).status, 200);
    f.db.retireSoul('s_alice');
    assert.equal((await f.get(ref.$prompt, 'dev:bob')).status, 404);
    assert.equal((await f.get(ref.$prompt, 'dev:admin')).status, 200);
    f.db.db.prepare('UPDATE users SET role = ? WHERE id = ?').run('user', 'dev:admin');
    assert.equal((await f.get(ref.$prompt, 'dev:admin')).status, 404);
  } finally { f.db.close(); }
});

test('a Soul bearer token cannot use the signed-in debug prompt route, including after revocation', async () => {
  const f = fixture(); try {
    const ref = f.call('AGENT_MARKER', 's_alice'), token = 'fixture-only-agent-token';
    f.db.setSoulToken('s_alice', hashToken(token));
    assert.equal((await f.get(ref.$prompt, token)).status, 401);
    f.db.setSoulToken('s_alice', null);
    assert.equal((await f.get(ref.$prompt, token)).status, 401);
  } finally { f.db.close(); }
});

test('reference lookalikes in response or user content are not originating system prompt associations', async () => {
  const f = fixture(); try {
    const ref = f.call('BOB_SECRET', 's_bob');
    f.db.saveBrainCall(f.host.worldId, { tick: 0, at: Date.now(), tier: 'mid', subject: 'lookalike', soulId: 's_alice', model: 'fake', mode: 'fake',
      request: { state: { text: ref }, messages: [{ content: JSON.stringify(ref) }] }, response: { system: [{ text: ref }] }, applied: {},
      ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 });
    assert.equal((await f.get(ref.$prompt, 'dev:alice')).status, 404);
  } finally { f.db.close(); }
});

test('existing retained references survive indexed upgrade/restart without rewriting call or prompt history', () => {
  const dir = mkdtempSync(join(config.dataDir, 'prompt-upgrade-')), path = join(dir, 'fixture.db');
  let db = new Db(path);
  try {
    db.createSoul({ id: 's_old', worldId: 'w_old', owner: 'old-owner', entityId: 'h_old', name: 'Old', description: 'fixture', native: false });
    const ref = db.internPrompt('LEGACY_RETAINED_MARKER');
    db.saveBrainCall('w_old', { tick: 4, at: Date.now(), tier: 'compile', subject: 'legacy fixture', soulId: 's_old', model: 'fake', mode: 'fake',
      request: { system: [{ text: ref }] }, response: {}, applied: {}, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 });
    const before = db.db.prepare('SELECT body FROM brain_calls').get()!.body;
    // Exact prior six-migration schema/data: the new change adds only an index.
    db.db.exec('DROP INDEX brain_calls_prompt; DELETE FROM schema_migrations WHERE id = 7');
    db.close(); db = new Db(path);
    assert.deepEqual(db.migrated, [7]);
    assert.equal(db.prompt(ref.$prompt, { worldId: 'w_old', userId: 'old-owner', admin: false }), 'LEGACY_RETAINED_MARKER');
    assert.equal(db.db.prepare('SELECT body FROM brain_calls').get()!.body, before);
    db.close(); db = new Db(path); assert.deepEqual(db.migrated, []);
    assert.equal(db.prompt(ref.$prompt, { worldId: 'w_old', userId: 'other', admin: false }), null);
    assert.equal(db.prompt(ref.$prompt, { worldId: 'w_old', userId: 'admin', admin: true }), 'LEGACY_RETAINED_MARKER');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a malformed legacy call cannot authorize a prompt or break the indexed migration', () => {
  const f = fixture(); try {
    const ref = f.call('MALFORMED_CALL_MARKER', 's_alice');
    f.db.db.prepare('UPDATE brain_calls SET body = ? WHERE id = ?').run('{not-json', ref.callId);
    f.db.db.exec('DROP INDEX brain_calls_prompt; DELETE FROM schema_migrations WHERE id = 7');
    assert.deepEqual(migrate(f.db.db), [7]);
    assert.equal(f.db.prompt(ref.$prompt, { worldId: f.host.worldId, userId: 'admin', admin: true }), null);
  } finally { f.db.close(); }
});
