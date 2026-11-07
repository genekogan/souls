// node --test tools/world-launcher/listing.test.mjs — the public world list (listing.mjs; QA2 F4). Ports: launcher,
// children on a block (LISTING_TEST_PORT picks the block, else a free one).
// Stand-in worlds (fake-world.mjs) write their owner into sim.db the way GodMode does on first boot (WORLD_OWNER_ID).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { isUnlisted, publicWorlds } from './listing.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { defaultCommand } from './children.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';

const PORT = Number(process.env.LISTING_TEST_PORT ?? await testPort(8)), RANGE = [PORT + 1, PORT + 7];
const dir = mkdtempSync(join(tmpdir(), 'launcher-listing-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'plain.json'), JSON.stringify({ schema: 'genesis/1', name: 'Plain', description: 'x', batches: [] }));
writeFileSync(join(templatesDir, 'hidden-proof.json'), JSON.stringify({ schema: 'genesis/1', hidden: true, name: 'Hidden proof', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
const born = join(dir, 'born.mjs');
writeFileSync(born, `import { DatabaseSync } from 'node:sqlite'; import { join } from 'node:path';
const db = new DatabaseSync(join(process.env.DATA_DIR, 'sim.db')); db.exec('CREATE TABLE IF NOT EXISTS world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS god_tokens_v1 (world_id TEXT NOT NULL, token_hash TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used INTEGER, PRIMARY KEY (world_id, token_hash))');
if (!db.prepare('SELECT 1 FROM world_meta_v1 WHERE world_id=?').get(process.env.WORLD_KEY + '-1')) db.prepare('INSERT INTO world_meta_v1 VALUES (?, ?)').run(process.env.WORLD_KEY + '-1', JSON.stringify({ owner: process.env.WORLD_OWNER_ID || null }));
db.close(); await import(${JSON.stringify(new URL('./fake-world.mjs', import.meta.url).pathname)});`);
const command = (w, port) => { const c = defaultCommand(w, port, { publicOrigin: `http://127.0.0.1:${PORT}` }); return { cmd: process.execPath, args: [born], env: { ...c.env, DATA_DIR: w.dataDir } }; };
let L;
before(async () => { L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} }); });
after(async () => { await L?.close(); });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const post = (p, body, headers = {}) => api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const list = async () => (await (await api('/__sim/worlds.json')).json()).worlds;

test('listing order and defaults on the live roster of 2026-10-21: bench worlds hidden, flagships first, then Souls, then newest', () => {
  const live = [['bench-eden', 'Bench Eden (scratch)', 5, 0], ['bench-hamlet', 'Bench hamlet (scratch)', 4, 1], ['eden-2026', 'Eden 2026', 3, 0], ['godmode-lab', 'Godmode Lab', 2, 0],
    ['my-mars-college-2026-3', 'Mars College 2026', 1, 0], ['little-martians-arium', 'Little Martians (Arium)', 0, 2]].map(([slug, name, createdAt, souls]) => ({ slug, name, createdAt, souls }));
  assert.deepEqual(publicWorlds(live).map((w) => w.slug), ['eden-2026', 'my-mars-college-2026-3', 'little-martians-arium', 'godmode-lab']);
  assert.equal(isUnlisted({ slug: 'bench-hamlet', name: 'Bench hamlet (scratch)', unlisted: false }), false, 'an explicit flag wins');
  assert.equal(isUnlisted({ slug: 'garden', name: 'Garden', unlisted: true }), true);
  assert.equal(isUnlisted({ slug: 'garden', name: 'Garden' }), false);
});

test('unlisted worlds (QA2 F4): bench slugs and "(scratch)" names stay off the public list but answer at their URL; owner or operator flips it; flagships lead', async () => {
  for (const [name, slug] of [['Bench Eden (copy)', 'bench-eden'], ['Scratch pad (scratch)', undefined], ['Eden 2026', 'eden-2026'], ['Later', undefined]])
    assert.equal((await post('/__sim/op/create-world', { name, template: 'plain', owner: 'dev:gene', ...(slug ? { slug } : {}) })).status, 201, name);
  let slugs = (await list()).map((x) => x.slug);
  assert.ok(!slugs.includes('bench-eden') && !slugs.includes('scratch-pad-scratch'), 'bench and scratch worlds are unlisted');
  assert.equal(slugs[0], 'eden-2026', 'a featured world leads even when newer worlds exist');
  assert.ok(slugs.indexOf('later') > 0);
  // still reachable by URL, and the world page learns it is unlisted
  assert.equal((await api('/w/bench-eden/v1/god/status')).status, 200);
  assert.equal((await (await api('/__sim/worlds/bench-eden')).json()).world.unlisted, true);
  // operator only from this machine; validated
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'later', unlisted: true }, { 'x-forwarded-for': '1.2.3.4' })).status, 403);
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'later', unlisted: 'yes' })).status, 400);
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'nope', unlisted: true })).status, 404);
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'later', unlisted: true })).status, 200);
  assert.ok(!(await list()).some((x) => x.slug === 'later'));
  // an explicit false lists a bench world again
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'bench-eden', unlisted: false })).status, 200);
  assert.ok((await list()).some((x) => x.slug === 'bench-eden'));
  // the owner (signed in or their agent) may flip it; strangers may not
  assert.equal((await post('/__sim/worlds/later/unlisted', { unlisted: false })).status, 403);
  assert.equal((await post('/__sim/worlds/later/unlisted', { unlisted: false }, { authorization: 'Bearer dev:mallory' })).status, 403);
  let r = await post('/__sim/worlds/later/unlisted', { unlisted: false }, { authorization: 'Bearer dev:gene' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, slug: 'later', unlisted: false });
  assert.ok((await list()).some((x) => x.slug === 'later'));
  assert.equal((await api('/__sim/worlds/later/unlisted')).status, 405);
  // the operator may create a world unlisted from birth (release-probe worlds); the public create ignores the field
  assert.equal((await post('/__sim/op/create-world', { name: 'Probe', template: 'plain', owner: 'dev:gene', unlisted: true })).status, 201);
  assert.ok(!(await list()).some((x) => x.slug === 'probe'));
  assert.equal((await post('/__sim/worlds', { name: 'Public', template: 'plain', unlisted: true })).status, 201);
  assert.ok((await list()).some((x) => x.slug === 'public'));
});


test('hidden templates stay out of public catalogs and public creation; direct operator creation may select one', async () => {
  for (const path of ['/__sim/templates.json', '/__sim/worlds.json']) {
    const body = await (await api(path)).json();
    assert.ok(!body.templates.some(t => t.id === 'hidden-proof'), path);
  }
  const body = { name: 'Hidden fixture (scratch)', template: 'hidden-proof', owner: 'dev:gene', unlisted: true };
  assert.equal((await post('/__sim/worlds', body, { authorization: 'Bearer dev:gene' })).status, 400, 'owner sign-in does not grant operator template access');
  assert.equal((await post('/__sim/op/create-world', body, { 'x-forwarded-for': '203.0.113.9' })).status, 403, 'reverse-proxied operator request stays forbidden');
  const r = await post('/__sim/op/create-world', body);
  assert.equal(r.status, 201); const made = await r.json();
  const health = await (await api(`/w/${made.slug}/healthz`)).json();
  assert.match(health.genesis, /hidden-proof\.json$/, 'the selected hidden genesis reaches the child');
  assert.equal(made.owner, 'dev:gene', 'operator creation verifies persisted child ownership');
  assert.ok(!(await list()).some(w => w.slug === made.slug), 'scratch remains unlisted');
  assert.ok(!(await (await api('/__sim/templates.json')).json()).templates.some(t => t.id === 'hidden-proof'), 'creation does not publish the template');
});
