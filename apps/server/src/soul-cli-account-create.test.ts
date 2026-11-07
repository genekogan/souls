// The published eden.mjs, run as a child process against the real server app on an account world: register,
// create --for, the owner approves, approval wait, status. 2.0.0–2.2.2 sent a 32-hex pollSecret the server's
// strict schema refuses, so every create on sim.eden.art failed with "Approval request format is invalid";
// playtests run on dev-identity worlds and never reached this path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { fixture } from '../test/native-owner-fixture.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import type { AccountIdentity } from './accounts/store.ts';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';

const CLI = fileURLToPath(new URL('../../../tools/world-launcher/soul/eden.mjs', import.meta.url));

test('eden.mjs creates a Soul on an account world: create --for, owner approves, approval wait, status', async t => {
  const f = fixture(':memory:', await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true })); f.brain.quiesce(); f.souls.enableLifecycle();
  f.souls.cfg.accountAuthRequired = true; f.souls.cfg.inviteRequired = false;
  const identity: AccountIdentity = { id: 'account-cli-owner', issuer: 'fixture', subject: 'account-cli-owner', verifiedAt: Date.now(), expiresAt: Date.now() + 3_600_000 };
  f.db.upsertUser({ id: identity.id, email: null, wallet: null, role: 'user' });
  // Only the sign-in provider is synthetic; the window code, approval, Soul and token are real.
  f.auth.accountFromToken = async token => token === 'owner' ? { identity, user: f.db.user(identity.id)! } : null;
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth,
    hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  const listener = getRequestListener(app.fetch);
  // The world lives under /w/test, as on sim.eden.art.
  const server = createServer((req, res) => { req.url = req.url!.replace(/^\/w\/test/, '') || '/'; listener(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'cli-create-'));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); f.host.stop(); f.db.close(); });
  const world = `http://127.0.0.1:${(server.address() as { port: number }).port}/w/test`;
  const run = (...args: string[]) => new Promise<Record<string, any>>((resolve, reject) => execFile(process.execPath, [CLI, ...args], { cwd: dir },
    (err, out, errText) => err ? reject(new Error(`${args.join(' ')}: ${errText || out}`)) : resolve(JSON.parse(out))));
  const owner = (path: string) => app.request(path, { method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json', authorization: 'Bearer owner' }, body: '{}' });

  const { code } = await (await owner('/v1/account/window-code')).json() as { code: string };
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await run('register', world)).registered, true);
  const asked = await run('create', 'Wren', '--for', code);
  assert.equal(asked.status, 'pending'); assert.equal(asked.name, 'Wren'); assert.equal(asked.delivery, 'window', 'the request reaches the open window');
  const approved = await owner(`/v1/account/approvals/${asked.approvalId}/approve`);
  assert.equal(approved.status, 200, await approved.text());
  const ready = await run('approval', 'wait');
  assert.equal(ready.status, 'ready'); assert.equal(ready.paired, true); assert.equal(ready.soul.name, 'Wren');
  const st = await run('status');
  assert.equal(st.paired, true);
  assert.equal(f.db.soul(ready.soul.id)?.name, 'Wren');
});

test('a retry that adds the window code moves a pending request into that window (legacy create-soul, then create-soul --for)', async t => {
  const f = fixture(':memory:', await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true })); f.brain.quiesce(); f.souls.enableLifecycle();
  t.after(() => { f.host.stop(); f.db.close(); });
  f.souls.cfg.accountAuthRequired = true; f.souls.cfg.inviteRequired = false;
  const identity: AccountIdentity = { id: 'account-late-code', issuer: 'fixture', subject: 'account-late-code', verifiedAt: Date.now(), expiresAt: Date.now() + 3_600_000 };
  f.db.upsertUser({ id: identity.id, email: null, wallet: null, role: 'user' });
  f.auth.accountFromToken = async token => token === 'owner' ? { identity, user: f.db.user(identity.id)! } : null;
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth,
    hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  const req = (method: string, path: string, body?: unknown, owner = false) => app.request(path, { method,
    headers: { host: '127.0.0.1', 'content-type': 'application/json', ...(owner ? { authorization: 'Bearer owner' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const { code } = await (await req('POST', '/v1/account/window-code', {}, true)).json() as { code: string };
  const input = { name: 'Mira', agentLabel: 'eden-agent 1.9', idempotencyKey: 'late-code-retry-0001', pollSecret: 'A'.repeat(43) };
  const first = await (await req('POST', '/v1/agent/approval/start', input)).json() as { approval: { id: string; inWindow: boolean }; delivery: string };
  assert.equal(first.delivery, 'link'); assert.equal(first.approval.inWindow, false);
  const again = await (await req('POST', '/v1/agent/approval/start', { ...input, for: 'ZZZZ-ZZZZ' })).json() as { approval: { inWindow: boolean } };
  assert.equal(again.approval.inWindow, false, 'an unknown code changes nothing');
  const retry = await (await req('POST', '/v1/agent/approval/start', { ...input, for: code })).json() as { approval: { id: string; inWindow: boolean }; delivery: string };
  assert.equal(retry.approval.id, first.approval.id); assert.equal(retry.delivery, 'window'); assert.equal(retry.approval.inWindow, true);
  const waiting = await (await req('GET', '/v1/account/approvals', undefined, true)).json() as { approvals: { id: string }[] };
  assert.deepEqual(waiting.approvals.map(a => a.id), [first.approval.id], 'the open window shows it');
});
