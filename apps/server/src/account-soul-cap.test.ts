import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fixture } from '../test/native-owner-fixture.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import type { AccountIdentity } from './accounts/store.ts';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';

test('account approval admits twenty Souls, counts pending bodies, and refuses only that owner at twenty-one', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const factory = await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true });
  const f = fixture(':memory:', factory);
  f.brain.quiesce(); f.souls.enableLifecycle();
  t.after(() => { f.host.stop(); f.db.close(); });
  f.souls.cfg.accountAuthRequired = true;
  f.souls.cfg.inviteRequired = false;
  const identities = new Map<string, AccountIdentity>();
  for (const name of ['alice', 'bob']) {
    const id = 'account-cap-' + name;
    f.db.upsertUser({ id, email: null, wallet: null, role: 'user' });
    identities.set(name, { id, issuer: 'fixture', subject: id, verifiedAt: Date.now(), expiresAt: Date.now() + 3_600_000 });
  }
  // Only the provider boundary is synthetic; approvals, ownership and lifecycle reservations are real.
  f.auth.accountFromToken = async token => {
    const identity = identities.get(token ?? '');
    return identity ? { identity, user: f.db.user(identity.id)! } : null;
  };
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth,
    hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  const post = (path: string, body: unknown, owner?: string) => app.request(path, { method: 'POST',
    headers: { host: '127.0.0.1:4956', 'content-type': 'application/json', ...(owner ? { authorization: 'Bearer ' + owner } : {}) },
    body: JSON.stringify(body) });
  async function approve(n: number, owner = 'alice') {
    clock += 60_001; // Keep the existing per-minute request limits; this tests total owned bodies.
    const start = await post('/v1/agent/approval/start', { name: `TestCap${owner}${n}`, agentLabel: 'cap regression',
      idempotencyKey: `account-cap-${owner}-${n}`, pollSecret: randomBytes(32).toString('base64url') });
    assert.equal(start.status, 200);
    const data = await start.json() as { approval: { id: string } };
    return post(`/v1/account/approvals/${data.approval.id}/approve`, {}, owner);
  }
  for (let n = 1; n <= 20; n++) assert.equal((await approve(n)).status, 200, `Soul ${n} is admitted`);
  assert.equal(f.db.soulsOf('account-cap-alice').length, 20);
  const refused = await approve(21);
  assert.equal(refused.status, 409);
  assert.match(JSON.stringify(await refused.json()), /at most 20 souls per account/);
  assert.equal(f.db.soulsOf('account-cap-alice').length, 20, 'refusal allocates no extra body');
  assert.equal((await approve(1, 'bob')).status, 200, 'another account retains its own allowance');
});
