// node --test tools/world-launcher/god-label.test.mjs
// "god: <name>" on /worlds is self-chosen text; authority is the verified owner account only.
// Real launcher HTTP + synthetic Clerk issuer + real fresh Sim children; fake minds, a free block of ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';
import { tmpdir } from 'node:os';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(4);

test('the god label is display text: a second account sees a visitor view, cannot take the world, and cannot wear the label', { timeout: 240_000 }, async () => {
  const scratch = process.env.SAFETY_SCRATCH ?? tmpdir();
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'god-label-')), dataDir = join(dir, 'data'), templatesDir = join(dir, 'templates');
  mkdirSync(templatesDir);
  const origin = `http://127.0.0.1:${P0}`, keys = await clerkKeys(origin);
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  const envFile = join(dir, 'fixture.env'), preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname;
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origin}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, ''].join('\n'));
  const launcher = await openLauncher({ port: P0, range: [P0 + 1, P0 + 3], dataDir, templatesDir, authEnvFile: envFile, publicOrigin: origin, eager: 0, newAccountCreateLimit: 3, newAccountWorldLimit: 3, log: () => {} });
  const tok = (subject) => keys.sign(subject);
  const call = async (path, subject, body) => fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(subject ? { authorization: `Bearer ${await tok(subject)}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = (name, subject, godName) => call('/__sim/worlds', subject, { name, template: 'empty', godName });
  try {
    const made = await create('Hello World2', 'user_alice', 'geno');
    const world = await made.json(); assert.equal(made.status, 201, JSON.stringify(world)); assert.equal(world.claimed, true);
    const base = `/w/${world.slug}`;
    assert.equal((await (await call(`${base}/v1/god/status`, 'user_alice')).json()).you, 'owner', 'the creator gets the god panel');
    const bobStatus = await (await call(`${base}/v1/god/status`, 'user_bob')).json();
    assert.equal(bobStatus.you, 'visitor'); assert.deepEqual(bobStatus.pending, []); assert.equal('agents' in bobStatus, false);
    assert.equal((await (await call(`${base}/v1/god/status`)).json()).you, 'anonymous');
    for (const path of ['/v1/god/mint', '/v1/god/claim']) assert.equal((await call(base + path, 'user_bob', {})).status, 403, path);
    assert.equal((await call(`${base}/v1/god/welcome`, 'user_bob')).status, 403);

    const card = (await (await call('/__sim/worlds.json')).json()).worlds.find((w) => w.slug === world.slug);
    assert.equal(card.godName, 'geno'); assert.equal(card.god, true);
    const session = await (await call(`${base}/v1/account/session`, 'user_alice')).json();
    assert.match(session.accountId, /^acct_/);
    assert.equal(JSON.stringify(card).includes(session.accountId), false, 'the card never shows the owner account id');

    // Another person cannot put the same label on their own world (any case); nothing is allocated.
    for (const label of ['geno', 'GENO', ' Geno ']) {
      const r = await create('Bob Mirror', 'user_bob', label); const b = await r.json();
      assert.equal(r.status, 409, label); assert.equal(b.code, 'god-name-taken'); assert.match(b.message, /choose another name/);
    }
    assert.equal(existsSync(join(dataDir, 'worlds', 'bob-mirror')), false);
    const bobOwn = await create('Bob Mirror', 'user_bob', 'bobby'); assert.equal(bobOwn.status, 201, JSON.stringify(await bobOwn.json()));
    // The same owner may reuse their own label.
    const again = await create('Hello World3', 'user_alice', 'Geno'); assert.equal(again.status, 201, JSON.stringify(await again.json()));
    const names = (await (await call('/__sim/worlds.json')).json()).worlds.map((w) => [w.slug, w.godName]).sort();
    assert.deepEqual(names, [['bob-mirror', 'bobby'], ['hello-world2', 'geno'], ['hello-world3', 'Geno']]);
  } finally { await launcher.close(); rmSync(dir, { recursive: true, force: true }); }
});
