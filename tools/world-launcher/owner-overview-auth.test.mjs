// node --test tools/world-launcher/owner-overview-auth.test.mjs
// Existing Clerk verifier with two independently signed identities. No worlds are started.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { projectRecords } from './owner-overview-data.mjs';
import { verifiedCreator } from './creator-auth.mjs';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(3);

const PORT = P0, RANGE = [P0 + 1, P0 + 2], ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'owner-overview-auth-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname;
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const PROXIED = { 'x-forwarded-for': '203.0.113.7' };   // as through Caddy: not the operator
let L, sign, envFile;
const dash = (h = {}) => fetch(`${ORIGIN}/ops?json=1`, { headers: { ...PROXIED, ...h } });

before(async () => {
  const keys = await clerkKeys(ORIGIN); sign = keys.sign;
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  envFile = join(dir, 'clerk.env');
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${ORIGIN}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, ''].join('\n'));
  delete process.env.CATALOG_GENE_OWNER_ID;
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'owner-overview.json'), JSON.stringify(projectRecords({ issues: [{ number: 556, title: 'PRIVATE STATUS SENTINEL', url: 'https://github.com/soulsimulation/souls/issues/556', state: 'OPEN', updatedAt: new Date().toISOString(), assignees: [], comments: [], labels: [] }], observedAt: new Date().toISOString() })));
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), templatesDir, authEnvFile: envFile, publicOrigin: ORIGIN, eager: 0, log: () => {} });
});
after(async () => { await L?.close(); delete process.env.SIM_SITE_OWNERS; rmSync(dir, { recursive: true, force: true }); });

test('real Clerk verifier: owner and non-owner sessions, no loopback bypass, revocation, static boundary and data-free shell', async () => {
  const owner = await sign('user_owner'), other = await sign('user_other');
  const ownerAcct = await verifiedCreator(`Bearer ${owner}`, { envFile, registryPath: join(dir, 'data', 'accounts.sqlite') }, ORIGIN, ROOT);
  assert.match(ownerAcct, /^acct_/);
  const otherAcct = await verifiedCreator(`Bearer ${other}`, { envFile, registryPath: join(dir, 'data', 'accounts.sqlite') }, ORIGIN, ROOT);
  process.env.CATALOG_GENE_OWNER_ID = otherAcct; // differing explicit lists: SIM_SITE_OWNERS wins in both checks

  process.env.SIM_SITE_OWNERS = `acct_someone-else, ${ownerAcct}`;   // read per request

  let r = await dash(); assert.equal(r.status, 401); assert.deepEqual(await r.json(), { ok: false, code: 'sign-in' });
  r = await dash({ authorization: 'Bearer not-a-jwt' }); assert.equal(r.status, 401);
  r = await dash({ authorization: 'Bearer dev:gene' }); assert.equal(r.status, 401, 'a dev token is nobody under Clerk');
  r = await dash({ authorization: `Bearer ${other}` }); assert.equal(r.status, 403); assert.deepEqual(await r.json(), { ok: false, code: 'not-owner' });
  r = await dash({ authorization: `Bearer ${owner}` }); assert.equal(r.status, 200);
  const d = await r.json(); assert.equal(d.ok, true); assert.equal(d.source.state, 'cached'); assert.equal(d.items[0].title, 'PRIVATE STATUS SENTINEL');
  r = await dash({ cookie: `theme=dark; __session=${owner}` }); assert.equal(r.status, 200, 'the Clerk session cookie works too');
  r = await dash({ cookie: `__session=${other}` }); assert.equal(r.status, 403);
  r = await fetch(`${ORIGIN}/ops?json=1`); assert.equal(r.status, 401, 'loopback still requires owner authentication');

  // a different owner list drops the old owner on the next request (nothing cached about who owns the site)
  process.env.SIM_SITE_OWNERS = 'acct_someone-else';
  r = await dash({ authorization: `Bearer ${owner}` }); assert.equal(r.status, 403);

  r = await fetch(`${ORIGIN}/ops`, { headers: PROXIED });
  assert.equal(r.status, 200); const html = await r.text();
  assert.ok(html.includes(PUBLISHABLE_KEY), 'the page knows the public sign-in key');
  for (const s of ['PRIVATE STATUS SENTINEL', 'acct_', ownerAcct, '"ok":true', '"worlds":', 'owner-overview.json']) assert.equal(html.includes(s), false, `shell leaks ${s}`);
});

// Configuration is explicit: a stale/missing world slug can never grant access.
test('no configured owner fails closed; fallback configuration survives world slug migration', async () => {
  const token = await sign('user_owner');
  const acct = await verifiedCreator(`Bearer ${token}`, { envFile, registryPath: join(dir, 'data', 'accounts.sqlite') }, ORIGIN, ROOT);
  delete process.env.SIM_SITE_OWNERS; delete process.env.CATALOG_GENE_OWNER_ID;
  let r = await dash({ authorization: `Bearer ${token}` }); assert.equal(r.status, 503);
  process.env.CATALOG_GENE_OWNER_ID = acct;
  r = await dash({ authorization: `Bearer ${token}` }); assert.equal(r.status, 200);
  for (const path of ['/ops/snapshot.json', '/ops/proof.mp4', '/ops/metadata.json']) {
    r = await fetch(ORIGIN + path, { headers: { ...PROXIED, authorization: `Bearer ${token}` } }); assert.equal(r.status, 404);
  }
  r = await fetch(ORIGIN + '/ops?json=1', { method: 'HEAD', headers: PROXIED }); assert.equal(r.status, 401); assert.equal(await r.text(), '');
  delete process.env.CATALOG_GENE_OWNER_ID;
});
