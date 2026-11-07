// node --test tools/world-launcher/worldops.test.mjs — world housekeeping (lane WORLDOPS; free ports: proxy, children;
// a second launcher with co-builders off). WORLDOPS_TEST_PORT picks the whole block, else a free one.
// Stand-in worlds (fake-world.mjs) write their owner into sim.db the way GodMode does on first boot (WORLD_OWNER_ID).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { addGodToken } from './worldops.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { defaultCommand } from './children.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';

const PORT = Number(process.env.WORLDOPS_TEST_PORT ?? await testPort(10)), RANGE = [PORT + 1, PORT + 7], OFF_PORT = PORT + 8, OFF_RANGE = [PORT + 9, PORT + 9];
const dir = mkdtempSync(join(tmpdir(), 'launcher-worldops-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'plain.json'), JSON.stringify({ schema: 'genesis/1', name: 'Plain', description: 'x', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
const born = join(dir, 'born.mjs');
writeFileSync(born, `import { DatabaseSync } from 'node:sqlite'; import { join } from 'node:path';
const db = new DatabaseSync(join(process.env.DATA_DIR, 'sim.db')); db.exec('CREATE TABLE IF NOT EXISTS world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS god_tokens_v1 (world_id TEXT NOT NULL, token_hash TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used INTEGER, PRIMARY KEY (world_id, token_hash))');
if (!db.prepare('SELECT 1 FROM world_meta_v1 WHERE world_id=?').get(process.env.WORLD_KEY + '-1')) db.prepare('INSERT INTO world_meta_v1 VALUES (?, ?)').run(process.env.WORLD_KEY + '-1', JSON.stringify({ owner: process.env.WORLD_OWNER_ID || null }));
db.close(); await import(${JSON.stringify(new URL('./fake-world.mjs', import.meta.url).pathname)});`);
const command = (w, port) => { const c = defaultCommand(w, port, { publicOrigin: `http://127.0.0.1:${PORT}` }); return { cmd: process.execPath, args: [born], env: { ...c.env, DATA_DIR: w.dataDir } }; };
let L;
let OFF;
// L keeps co-builders on (the kept-for-later feature, Gene 2026-10-16); OFF is the default site: one god per world.
before(async () => { L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, cobuilders: true }); });
before(async () => { OFF = await openLauncher({ port: OFF_PORT, range: OFF_RANGE, dataDir: join(dir, 'data-off'), webDir, templatesDir, command, eager: 0, log: () => {} }); });
after(async () => { await L?.close(); await OFF?.close(); });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const post = (p, body, headers = {}) => api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const list = async () => (await (await api('/__sim/worlds.json')).json()).worlds;

test('same-name worlds are told apart by slug; a unique name carries no tag', async () => {
  for (const name of ['Mars', 'mars', 'Garden']) assert.equal((await post('/__sim/worlds', { name, template: 'plain' })).status, 201);
  const w = await list();
  const tags = Object.fromEntries(w.map((x) => [x.slug, x.nameTag]));
  assert.deepEqual(tags, { 'my-mars': 'my-mars', 'my-mars-2': 'my-mars-2', garden: null });
  assert.ok(w.every((x) => x.claimable === true), 'claimable by default');
});
test('site admin marks a godless world not claimable: claim, mint and pair-approve are refused; the card stops inviting claims', async () => {
  let r = await post('/__sim/op/set-claimable', { slug: 'garden', claimable: false }, { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(r.status, 403, 'not through the reverse proxy');
  r = await post('/__sim/op/set-claimable', { slug: 'garden', claimable: 'no' }); assert.equal(r.status, 400);
  r = await post('/__sim/op/set-claimable', { slug: 'nope', claimable: false }); assert.equal(r.status, 404);
  r = await post('/__sim/op/set-claimable', { slug: 'garden', claimable: false }); assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, slug: 'garden', claimable: false, hasGod: false });
  for (const p of ['/v1/god/claim', '/v1/god/mint', '/v1/god/pair/approve']) {
    r = await post(`/w/garden${p}`, {}, { authorization: 'Bearer dev:someone' });
    assert.equal(r.status, 403, p); assert.equal((await r.json()).code, 'not-claimable');
  }
  assert.equal((await api('/w/garden/v1/god/status')).status, 200, 'visitors still see the world');
  const card = (await list()).find((x) => x.slug === 'garden'); assert.equal(card.claimable, false);
  assert.equal((await (await api('/__sim/worlds/garden')).json()).world.claimable, false, 'the world page learns it too');
  // other worlds are untouched, and the flag can be lifted
  assert.equal((await post('/w/my-mars/v1/god/claim', {}, { authorization: 'Bearer dev:someone' })).status, 200);
  assert.equal((await post('/__sim/op/set-claimable', { slug: 'garden', claimable: true })).status, 200);
  assert.equal((await post('/w/garden/v1/god/claim', {}, { authorization: 'Bearer dev:someone' })).status, 200);
});
test('a world that already has a god keeps minting tokens for its owner even when marked not claimable', async () => {
  let r = await post('/__sim/op/create-world', { name: 'Owned', template: 'plain', owner: 'dev:gene' }); assert.equal(r.status, 201);
  assert.equal((await post('/__sim/op/set-claimable', { slug: 'owned', claimable: false })).status, 200);
  r = await post('/w/owned/v1/god/mint', {}, { authorization: 'Bearer dev:gene' }); assert.equal(r.status, 200);
});

const data = join(dir, 'data');
test('archive-first delete: the owner archives (signed in or via their agent), nothing is deleted, one command restores it', async () => {
  let r = await post('/__sim/op/create-world', { name: 'Keepsake', template: 'plain', owner: 'dev:gene' }); assert.equal(r.status, 201);
  const db = join(data, 'worlds/keepsake/sim.db');
  writeFileSync(join(data, 'worlds/keepsake/marker.txt'), 'built by hand');
  // strangers, the wrong account and missing confirmation are refused
  assert.equal((await post('/__sim/worlds/keepsake/archive', { confirm: 'keepsake' })).status, 403);
  assert.equal((await post('/__sim/worlds/keepsake/archive', { confirm: 'keepsake' }, { authorization: 'Bearer dev:mallory' })).status, 403);
  assert.equal((await post('/__sim/worlds/keepsake/archive', { confirm: 'keepsake' }, { authorization: 'Bearer god_notarealtoken' })).status, 403);
  r = await post('/__sim/worlds/keepsake/archive', {}, { authorization: 'Bearer dev:gene' }); assert.equal(r.status, 400); assert.equal((await r.json()).code, 'confirm');
  // the owner's own agent (a god token of this world) may archive it
  addGodToken(db, 'keepsake-1', 'god_owneragent', 'claude-code');
  r = await post('/__sim/worlds/keepsake/archive', { confirm: 'keepsake', reason: 'tidying up' }, { authorization: 'Bearer god_owneragent' });
  const a = await r.json(); assert.equal(r.status, 200, JSON.stringify(a)); assert.match(a.id, /^keepsake-\d{8}T\d{6}Z$/);
  assert.ok(!(await list()).some((x) => x.slug === 'keepsake'), 'gone from the list');
  assert.equal((await api('/w/keepsake/healthz')).status, 404, 'not served');
  assert.ok(!existsSync(join(data, 'worlds/keepsake')), 'moved out of the live folder');
  assert.equal(readFileSync(join(data, 'archive', a.id, 'world/marker.txt'), 'utf8'), 'built by hand', 'data kept whole');
  // the slug stays reserved while archived
  r = await post('/__sim/worlds', { name: 'Keepsake', template: 'plain' }); assert.equal((await r.json()).slug, 'keepsake-2');
  const arch = (await (await post('/__sim/op/list-archive', {})).json()).archive;
  assert.deepEqual(arch.map((x) => [x.id, x.slug, x.by, x.hasData, x.restoredAt]), [[a.id, 'keepsake', 'dev:gene', true, null]]);
  // restore: same slug, same data, same owner, served again
  assert.equal((await post('/__sim/op/restore-world', { id: a.id }, { 'x-forwarded-for': '1.2.3.4' })).status, 403);
  r = await post('/__sim/op/restore-world', { id: a.id }); assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(readFileSync(join(data, 'worlds/keepsake/marker.txt'), 'utf8'), 'built by hand');
  assert.equal((await api('/w/keepsake/healthz')).status, 200);
  const d = new DatabaseSync(db, { readOnly: true }); assert.equal(JSON.parse(d.prepare('SELECT body FROM world_meta_v1').get().body).owner, 'dev:gene'); d.close();
  assert.equal((await post('/__sim/op/restore-world', { id: a.id })).status, 409, 'a restore happens once');
  const log = (await (await post('/__sim/op/audit', { slug: 'keepsake' })).json()).audit;
  assert.deepEqual(log.map((x) => [x.op, x.by]), [['archive', 'dev:gene'], ['restore', 'operator']]);
  assert.equal(log[0].reason, 'tidying up');
});
test('the operator archives any world (a godless one too); restore refuses an occupied slug', async () => {
  let r = await post('/__sim/worlds', { name: 'Orphan', template: 'plain' }); assert.equal(r.status, 201);
  r = await post('/__sim/op/archive-world', { slug: 'orphan' }); const a = await r.json(); assert.equal(r.status, 200);
  assert.equal((await post('/__sim/op/archive-world', { slug: 'orphan' })).status, 404);
  mkdirSync(join(data, 'worlds/orphan'), { recursive: true });
  r = await post('/__sim/op/restore-world', { id: a.id }); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'occupied');
  assert.equal((await post('/__sim/op/restore-world', { id: '../etc' })).status, 400);
});

const tokenCount = (slug, prefix = '') => { const d = new DatabaseSync(join(data, 'worlds', slug, 'sim.db'), { readOnly: true }); try { return d.prepare('SELECT count(*) n FROM god_tokens_v1 WHERE world_id=? AND label LIKE ?').get(`${slug}-1`, `${prefix}%`).n; } finally { d.close(); } };
const ownerOf = (slug) => { const d = new DatabaseSync(join(data, 'worlds', slug, 'sim.db'), { readOnly: true }); try { return JSON.parse(d.prepare('SELECT body FROM world_meta_v1').get().body).owner; } finally { d.close(); } };
const G = { authorization: 'Bearer dev:gene' }, V = { authorization: 'Bearer dev:victor' }, M = { authorization: 'Bearer dev:mallory' };
test('co-builders: owner invites, the invited person accepts, pairs their own agent, and is removed with their tokens', async () => {
  let r = await post('/__sim/op/create-world', { name: 'Arium', template: 'plain', owner: 'dev:gene' }); assert.equal(r.status, 201);
  assert.equal((await post('/__sim/worlds/arium/cobuilders/invite', {}, M)).status, 403, 'only the owner invites');
  r = await post('/__sim/worlds/arium/cobuilders/invite', { to: 'dev:victor' }, G); const inv = await r.json();
  assert.equal(r.status, 200); assert.match(inv.url, /\/w\/arium\/#worldoffer\//);
  assert.equal((await (await api(`/__sim/worlds/arium/offer?code=${inv.code}`)).json()).kind, 'cobuild');
  assert.equal((await post('/__sim/worlds/arium/offer/accept', { code: inv.code })).status, 401, 'consent needs a sign-in');
  assert.equal((await post('/__sim/worlds/arium/offer/accept', { code: inv.code }, M)).status, 403, 'an invitation for another account');
  r = await post('/__sim/worlds/arium/offer/accept', { code: inv.code }, V); assert.equal(r.status, 200);
  assert.equal((await post('/__sim/worlds/arium/offer/accept', { code: inv.code }, V)).status, 404, 'used once');
  // the co-builder's agent pairs; only that co-builder approves it
  r = await post('/__sim/worlds/arium/cobuild/pair/start', { agent: 'victor-claude' }); const pair = await r.json();
  assert.equal((await (await post('/__sim/worlds/arium/cobuild/pair/poll', { poll_token: pair.poll_token })).json()).approved, false);
  assert.equal((await post('/__sim/worlds/arium/cobuild/pair/approve', { code: pair.user_code }, M)).status, 403);
  assert.equal((await post('/__sim/worlds/arium/cobuild/pair/approve', { code: pair.user_code }, V)).status, 200);
  const got = await (await post('/__sim/worlds/arium/cobuild/pair/poll', { poll_token: pair.poll_token })).json();
  assert.equal(got.approved, true); assert.match(got.token, /^god_/);
  assert.equal(tokenCount('arium', 'cobuilder:dev:victor:'), 1);
  // the co-builder's token cannot archive, invite or hand the world on
  const VT = { authorization: `Bearer ${got.token}` };
  assert.equal((await post('/__sim/worlds/arium/archive', { confirm: 'arium' }, VT)).status, 403);
  assert.equal((await post('/__sim/worlds/arium/cobuilders/invite', {}, VT)).status, 403);
  assert.equal((await post('/__sim/worlds/arium/transfer', {}, VT)).status, 403);
  const listed = await (await api('/__sim/worlds/arium/cobuilders', { headers: G })).json();
  assert.deepEqual(listed.cobuilders.map((c) => c.account), ['dev:victor']);
  r = await post('/__sim/worlds/arium/cobuilders/remove', { account: 'dev:victor' }, G);
  assert.deepEqual(await r.json(), { ok: true, account: 'dev:victor', tokensRevoked: 1 });
  assert.equal(tokenCount('arium', 'cobuilder:'), 0);
});
test('handoff: the world changes owner only when the receiving person accepts; every old god token is revoked; audited', async () => {
  addGodToken(join(data, 'worlds/arium/sim.db'), 'arium-1', 'god_geneagent', 'claude-code');
  assert.equal((await post('/__sim/worlds/arium/transfer', { to: 'dev:victor' }, M)).status, 403);
  let r = await post('/__sim/worlds/arium/transfer', { to: 'dev:victor' }, { authorization: 'Bearer god_geneagent' }); const off = await r.json();
  assert.equal(r.status, 200, 'the owner\'s own agent may offer it'); assert.equal(off.kind, 'transfer');
  assert.equal(ownerOf('arium'), 'dev:gene', 'nothing changes before consent');
  assert.equal((await post('/__sim/worlds/arium/offer/accept', { code: off.code }, M)).status, 403);
  r = await post('/__sim/worlds/arium/offer/accept', { code: off.code }, V); const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d)); assert.equal(d.owner, 'dev:victor'); assert.equal(d.tokensRevoked, 1);
  assert.equal(ownerOf('arium'), 'dev:victor'); assert.equal(tokenCount('arium'), 0);
  assert.equal((await api('/w/arium/healthz')).status, 200, 'wakes again under its new owner');
  // the old owner is now just a visitor; the new owner can archive it
  assert.equal((await post('/__sim/worlds/arium/cobuilders/invite', {}, G)).status, 403);
  assert.equal((await post('/__sim/worlds/arium/cobuilders/invite', {}, V)).status, 200);
  assert.equal((await post('/__sim/worlds/arium/offers/cancel', {}, V)).status, 200);
  const log = (await (await post('/__sim/op/audit', { slug: 'arium' })).json()).audit.map((x) => x.op);
  assert.deepEqual(log, ['cobuilder-invite', 'cobuilder-add', 'cobuilder-pair', 'cobuilder-remove', 'transfer-offer', 'transfer', 'cobuilder-invite', 'offers-cancel']);
});

test('co-builders are off by default (one god per world): invite, accept and pairing are refused with a reason; handover still works', async () => {
  const offApi = (p, o = {}) => fetch(`http://127.0.0.1:${OFF_PORT}${p}`, o);
  const offPost = (p, body, headers = {}) => offApi(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let r = await offPost('/__sim/op/create-world', { name: 'Solo', template: 'plain', owner: 'dev:gene' }); assert.equal(r.status, 201);
  for (const [path, body, headers] of [['cobuilders/invite', { to: 'dev:victor' }, G], ['cobuild/pair/start', { agent: 'victor-claude' }, {}], ['cobuild/pair/poll', { poll_token: 'x' }, {}], ['cobuild/pair/approve', { code: 'ABCDEFGH' }, V]]) {
    r = await offPost(`/__sim/worlds/solo/${path}`, body, headers); const d = await r.json();
    assert.equal(r.status, 403, path); assert.equal(d.code, 'cobuilders-off', path); assert.match(d.message, /one god/, path);
  }
  const offDir = join(dir, 'data-off');
  const listed = await (await offApi('/__sim/worlds/solo/cobuilders', { headers: G })).json();
  assert.equal(listed.enabled, false); assert.deepEqual(listed.cobuilders, []);
  assert.equal((await offPost('/__sim/worlds/solo/cobuilders/invite', {}, M)).status, 403);
  // handover to a new single owner is unchanged
  r = await offPost('/__sim/worlds/solo/transfer', { to: 'dev:victor' }, G); const off = await r.json(); assert.equal(r.status, 200, JSON.stringify(off));
  assert.equal((await (await offApi(`/__sim/worlds/solo/offer?code=${off.code}`)).json()).kind, 'transfer');
  r = await offPost('/__sim/worlds/solo/offer/accept', { code: off.code }, V); const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d)); assert.equal(d.owner, 'dev:victor');
  const db = new DatabaseSync(join(offDir, 'worlds/solo/sim.db'), { readOnly: true }); try { assert.equal(JSON.parse(db.prepare('SELECT body FROM world_meta_v1').get().body).owner, 'dev:victor'); } finally { db.close(); }
});
test('world servers get SIM_COBUILDERS only when the launcher turns co-builders on', () => {
  const w = { slug: 'x', name: 'X', dataDir: '/tmp/x' };
  assert.equal(defaultCommand(w, 6001, { publicOrigin: 'http://127.0.0.1:6000' }).env.SIM_COBUILDERS, undefined);
  assert.equal(defaultCommand(w, 6001, { publicOrigin: 'http://127.0.0.1:6000', cobuilders: true }).env.SIM_COBUILDERS, '1');
});
