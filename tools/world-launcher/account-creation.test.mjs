// Real launcher HTTP + Clerk verification + real fresh Sim children; fake minds, lane safety ports only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLauncher } from './launcher.mjs';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';
import { tmpdir } from 'node:os';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(3);

test('account creation caps use verified owner, survive restart, serialize concurrent attempts and return Retry-After', { timeout: 240_000 }, async () => {
  const scratch = process.env.SAFETY_SCRATCH ?? tmpdir();
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'creation-')), dataDir = join(dir, 'data'), templatesDir = join(dir, 'templates');
  mkdirSync(templatesDir);
  const origin = `http://127.0.0.1:${P0 + 2}`, keys = await clerkKeys(origin);
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  const envFile = join(dir, 'fixture.env'), preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname;
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origin}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, ''].join('\n'));
  let launcher;
  const open = () => openLauncher({ port: P0 + 2, range: [P0, P0 + 1], dataDir, templatesDir, authEnvFile: envFile, publicOrigin: origin, eager: 0, idleMs: 0, maxWorldsPerAccount: 2, log: () => {} });
  const post = async (name, subject, extra = {}, ip = '192.0.2.1') => fetch(`${origin}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await keys.sign(subject)}`, 'x-forwarded-for': ip }, body: JSON.stringify({ name, ...extra }) });
  const sql = fn => { const db = new DatabaseSync(join(dataDir, 'accounts.sqlite')); try { return fn(db); } finally { db.close(); } };
  try {
    launcher = await open();
    const first = await post('Alice One', 'user_alice'); assert.equal(first.status, 201, JSON.stringify(await first.json()));
    const [x, y] = await Promise.all([post('Alice Two', 'user_alice', { owner: 'acct_forged' }, '192.0.2.2'), post('Alice Three', 'user_alice', { creator: 'somebody else' }, '192.0.2.3')]);
    for (const r of [x, y]) { assert.equal(r.status, 429); const b = await r.json(); assert.equal(b.code, 'new-account-velocity'); assert.ok(b.retry_after > 0 && b.retry_after <= 3600); assert.equal(r.headers.get('retry-after'), String(b.retry_after)); }
    assert.equal(launcher.registry.worlds.length, 1); assert.deepEqual(readdirSync(join(dataDir, 'worlds')), ['alice-one']);
    await launcher.close(); launcher = await open();
    assert.equal((await post('Still Limited', 'user_alice')).status, 429, 'restart cannot reset account history');
    const bob = await post('Bob One', 'user_bob'); assert.equal(bob.status, 201, JSON.stringify(await bob.json()));
    const bobHeaders = { authorization: `Bearer ${await keys.sign('user_bob')}`, 'x-forwarded-for': '192.0.2.2', 'content-type': 'application/json' };
    for (const action of ['remove-fork', 'register-fork', 'create-world']) {
      const response = await fetch(`${origin}/__sim/op/${action}`, { method: 'POST', headers: bobHeaders, body: JSON.stringify({ slug: 'alice-one', name: 'Stolen' }) });
      assert.equal(response.status, 403, action); assert.equal((await response.json()).code, 'local-only');
    }
    for (const method of ['PATCH', 'DELETE']) assert.equal((await fetch(`${origin}/__sim/worlds/alice-one`, { method, headers: bobHeaders, body: '{"name":"Stolen"}' })).status, 404);
    assert.equal((await fetch(`${origin}/__sim/worlds/alice-one/previews`, { headers: bobHeaders })).status, 401);
    assert.equal(launcher.registry.get('alice-one').name, 'Alice One');
    // Old-world forks have a separate identity registry and need not have GodMode tables.
    mkdirSync(join(dataDir, 'worlds', 'eden'));
    new DatabaseSync(join(dataDir, 'worlds', 'eden', 'sim.db')).close();
    launcher.registry.add({ slug: 'eden', name: 'Old Eden fixture', template: 'fork', fork: { of: 'eden' }, port: null, createdAt: Date.now() });
    sql(db => db.prepare('UPDATE provider_accounts_v1 SET created_at=? WHERE subject=?').run(Date.now() - 25 * 3600_000, 'user_alice'));
    const second = await post('Alice Two', 'user_alice'); assert.equal(second.status, 201, JSON.stringify(await second.json()));
    const cap = await post('Alice Too Many', 'user_alice'); assert.equal(cap.status, 409); assert.equal((await cap.json()).code, 'account-world-limit');
    assert.equal(launcher.registry.worlds.length, 4);
    assert.equal(existsSync(join(dataDir, 'worlds', 'alice-too-many')), false);
  } finally { await launcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});
