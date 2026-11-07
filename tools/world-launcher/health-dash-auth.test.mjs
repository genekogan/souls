// node --test tools/world-launcher/health-dash-auth.test.mjs
// Lane DASH: the health page's numbers are the site owner's only. A Clerk launcher (synthetic issuer, as in
// launcher-auth.test.mjs) on a free block of ports (no worlds are started).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { verifiedCreator } from './creator-auth.mjs';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(5);

const PORT = P0 + 4, RANGE = [P0, P0 + 3], ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'health-dash-auth-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname;
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const PROXIED = { 'x-forwarded-for': '203.0.113.7' };   // as through Caddy: not the operator
let L, sign, envFile;
const dash = (h = {}) => fetch(`${ORIGIN}/__sim/health?json=1`, { headers: { ...PROXIED, ...h } });

before(async () => {
  const keys = await clerkKeys(ORIGIN); sign = keys.sign;
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  envFile = join(dir, 'clerk.env');
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${ORIGIN}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, ''].join('\n'));
  delete process.env.CATALOG_GENE_OWNER_ID;
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), templatesDir, authEnvFile: envFile, publicOrigin: ORIGIN, eager: 0, log: () => {} });
});
after(async () => { await L?.close(); delete process.env.SIM_SITE_OWNERS; rmSync(dir, { recursive: true, force: true }); });

test('anonymous 401, a non-owner 403, the owner 200 (header or __session cookie), the operator on loopback 200; the shell carries no data', async () => {
  const owner = await sign('user_owner'), other = await sign('user_other');
  const ownerAcct = await verifiedCreator(`Bearer ${owner}`, { envFile, registryPath: join(dir, 'data', 'accounts.sqlite') }, ORIGIN, ROOT);
  assert.match(ownerAcct, /^acct_/);
  process.env.SIM_SITE_OWNERS = `acct_someone-else, ${ownerAcct}`;   // read per request

  let r = await dash(); assert.equal(r.status, 401); assert.deepEqual(await r.json(), { ok: false, code: 'sign-in' });
  r = await dash({ authorization: 'Bearer not-a-jwt' }); assert.equal(r.status, 401);
  r = await dash({ authorization: 'Bearer dev:gene' }); assert.equal(r.status, 401, 'a dev token is nobody under Clerk');
  r = await dash({ authorization: `Bearer ${other}` }); assert.equal(r.status, 403); assert.deepEqual(await r.json(), { ok: false, code: 'not-owner' });
  r = await dash({ authorization: `Bearer ${owner}` }); assert.equal(r.status, 200);
  const d = await r.json(); assert.equal(d.ok, true); assert.ok(Array.isArray(d.worlds) && Array.isArray(d.alerts));
  r = await dash({ cookie: `theme=dark; __session=${owner}` }); assert.equal(r.status, 200, 'the Clerk session cookie works too');
  r = await dash({ cookie: `__session=${other}` }); assert.equal(r.status, 403);
  r = await fetch(`${ORIGIN}/__sim/health?json=1`); assert.equal(r.status, 200, 'the operator on loopback');

  // a different owner list drops the old owner on the next request (nothing cached about who owns the site)
  process.env.SIM_SITE_OWNERS = 'acct_someone-else';
  r = await dash({ authorization: `Bearer ${owner}` }); assert.equal(r.status, 403);

  r = await fetch(`${ORIGIN}/__sim/health`, { headers: PROXIED });
  assert.equal(r.status, 200); const html = await r.text();
  assert.ok(html.includes(PUBLISHABLE_KEY), 'the page knows the public sign-in key');
  for (const s of ['acct_', ownerAcct, '"ok":true', '"worlds":', '127.0.0.1']) assert.equal(html.includes(s), false, `shell leaks ${s}`);
});
