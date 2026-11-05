// node --test tools/world-launcher/thumbnail.test.mjs — world thumbnails on the world list (#887). Lane ports: proxy 6470,
// children 6471–6474. Stand-in worlds (fake-world.mjs) write their owner and god tokens into sim.db the way GodMode does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { defaultCommand } from './children.mjs';
import { addGodToken } from './worldops.mjs';
import { THUMB, intakeThumbnail, thumbnailRate } from './thumbnail.mjs';
import { setUploadClassifier } from '../../apps/server/src/moderation/classifier.ts';

const PORT = 6470, RANGE = [6471, 6474], ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'launcher-thumbnail-test-'));
const data = join(dir, 'data'), hits = join(dir, 'hits.txt');
const templatesDir = join(dir, 'templates'); mkdirSync(join(templatesDir, 'thumbs'), { recursive: true });
writeFileSync(join(templatesDir, 'plain.json'), JSON.stringify({ schema: 'genesis/1', name: 'Plain', description: 'x', batches: [] }));
writeFileSync(join(templatesDir, 'bare.json'), JSON.stringify({ schema: 'genesis/1', name: 'Bare', description: 'no default picture', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
const born = join(dir, 'born.mjs');
writeFileSync(born, `import { DatabaseSync } from 'node:sqlite'; import { join } from 'node:path';
const db = new DatabaseSync(join(process.env.DATA_DIR, 'sim.db')); db.exec('CREATE TABLE IF NOT EXISTS world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS god_tokens_v1 (world_id TEXT NOT NULL, token_hash TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used INTEGER, PRIMARY KEY (world_id, token_hash))');
if (!db.prepare('SELECT 1 FROM world_meta_v1 WHERE world_id=?').get(process.env.WORLD_KEY + '-1')) db.prepare('INSERT INTO world_meta_v1 VALUES (?, ?)').run(process.env.WORLD_KEY + '-1', JSON.stringify({ owner: process.env.WORLD_OWNER_ID || null }));
db.close(); await import(${JSON.stringify(new URL('./fake-world.mjs', import.meta.url).pathname)});`);
const command = (w, port) => { const c = defaultCommand(w, port, { publicOrigin: ORIGIN }); return { cmd: process.execPath, args: [born], env: { ...c.env, DATA_DIR: w.dataDir, FAKE_HITS: hits } }; };
const open = () => openLauncher({ port: PORT, range: RANGE, dataDir: data, webDir, templatesDir, command, eager: 0, log: () => {}, cobuilders: true, thumbnailRate: { limit: 100 } });
let L;
before(async () => { L = await open(); });
after(async () => { await L?.close(); setUploadClassifier(null); });

/** A structurally valid JPEG (what validate.ts walks: SOI, APPn, SOF0, SOS, scan bytes, EOI). */
function jpeg(w, h, { exif = false, comment = null, pad = 0, trailer = null } = {}) {
  const seg = (m, body) => Buffer.concat([Buffer.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'))];
  if (exif) parts.push(seg(0xe1, Buffer.from('Exif\0\0GPS 51.5072N 0.1276W serial CAM-0001', 'latin1')));
  if (comment) parts.push(seg(0xfe, Buffer.from(comment, 'latin1')));
  parts.push(seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.alloc(16 + pad, 0x55), Buffer.from([0xff, 0xd9]));
  if (trailer) parts.push(Buffer.from(trailer, 'latin1'));
  return Buffer.concat(parts);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
// after a launcher restart the client may still hold a kept-alive socket to the old one: one retry on a reset
const api = (p, o = {}) => fetch(`${ORIGIN}${p}`, o).catch((e) => { if (e?.cause?.code !== 'ECONNRESET') throw e; return fetch(`${ORIGIN}${p}`, o); });
const post = (p, body, headers = {}) => api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const put = (slug, bytes, token, method = 'POST') => api(`/__sim/worlds/${slug}/thumbnail`, { method, headers: { 'content-type': 'image/jpeg', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(bytes ? { body: bytes } : {}) });
const row = async (slug) => (await (await api('/__sim/worlds.json')).json()).worlds.find((w) => w.slug === slug);
const childOf = async (slug) => (await (await api('/__sim/launcher')).json()).children.find((c) => c.slug === slug);
const DEFAULT = jpeg(1280, 720, { pad: 7 });
writeFileSync(join(templatesDir, 'thumbs', 'plain.jpg'), DEFAULT);

test('the gate: JPEG only, size, 16:9 and width, malformed bytes; every refusal carries a fix; metadata is stripped', async () => {
  const cases = [
    [Buffer.alloc(0), 400, 'thumbnail.empty'],
    [Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(64), 'latin1'), 415, 'thumbnail.type'],
    [Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), 415, 'thumbnail.type'],
    [jpeg(1280, 720, { pad: THUMB.maxBytes }), 413, 'thumbnail.size'],
    [jpeg(1280, 960), 400, 'thumbnail.dimensions'],
    [jpeg(480, 270), 400, 'thumbnail.dimensions'],
    [jpeg(2560, 1440), 400, 'thumbnail.dimensions'],
    [jpeg(1280, 720).subarray(0, 40), 400, 'thumbnail.invalid'],
  ];
  for (const [bytes, status, code] of cases) {
    const r = await intakeThumbnail(bytes);
    assert.equal(r.ok, false, code); assert.equal(r.status, status, code); assert.equal(r.body.code, code);
    assert.ok(typeof r.body.fix === 'string' && r.body.fix.length > 20, `${code} has a fix`);
  }
  const dirty = jpeg(1280, 720, { exif: true, comment: 'shot on a phone in a kitchen', trailer: 'hidden payload' });
  const r = await intakeThumbnail(dirty);
  assert.equal(r.ok, true); assert.deepEqual([r.width, r.height], [1280, 720]);
  const out = Buffer.from(r.bytes).toString('latin1');
  for (const s of ['Exif', 'GPS', 'kitchen', 'hidden payload']) assert.ok(!out.includes(s), `stripped: ${s}`);
  assert.equal(r.sha, sha(r.bytes)); assert.ok(r.stripped.segments >= 3);
  assert.equal((await intakeThumbnail(jpeg(1920, 1080))).ok, true, '1920×1080 is fine');
  assert.equal((await intakeThumbnail(jpeg(640, 360))).ok, true, '640×360 is fine');
});

test('the classifier hook sees the thumbnail; quarantine and reject are both refused (a thumbnail is public)', async () => {
  let seen = null;
  for (const action of ['quarantine', 'reject']) {
    setUploadClassifier({ name: 'test', classify: (f) => { seen = f; return { action, labels: ['test'] }; } });
    const r = await intakeThumbnail(jpeg(1280, 720), { words: ['Willow Hollow'] });
    assert.equal(r.status, 422); assert.equal(r.body.code, 'thumbnail.moderation'); assert.ok(r.body.fix);
    assert.equal(seen.surface, 'thumbnail'); assert.ok(seen.text.includes('Willow Hollow')); assert.equal(seen.images[0].w, 1280);
  }
  setUploadClassifier(null);
});

test('the rate gate: N writes per window per world, then a wait in seconds', () => {
  let t = 0; const gate = thumbnailRate({ limit: 2, windowMs: 60_000, now: () => t });
  assert.equal(gate('a'), null); assert.equal(gate('a'), null); assert.equal(gate('b'), null);
  t = 15_000; assert.equal(gate('a'), 45);
  t = 60_001; assert.equal(gate('a'), null);
});

test('who may set it: the owner (signed in or their agent) yes; co-builder, stranger, nobody no', async () => {
  let r = await post('/__sim/op/create-world', { name: 'Willow', template: 'plain', owner: 'dev:gene' }); assert.equal(r.status, 201);
  const db = join(data, 'worlds/willow/sim.db');
  addGodToken(db, 'willow-1', 'god_owneragent', 'claude-code');
  addGodToken(db, 'willow-1', 'god_cobuilder', 'cobuilder:dev:carol:agent');
  const img = jpeg(1280, 720);
  for (const [token, status, code] of [[null, 401, 'unauthorized'], ['god_unknown', 401, 'unauthorized'], ['dev:mallory', 403, 'forbidden'], ['god_cobuilder', 403, 'forbidden']]) {
    r = await put('willow', img, token); const b = await r.json();
    assert.equal(r.status, status, `${token}: ${JSON.stringify(b)}`); assert.equal(b.code, code); assert.ok(b.fix);
  }
  assert.equal(existsSync(join(data, 'worlds/willow/thumbs')), false, 'nothing stored by a refusal');
  r = await put('willow', img, 'dev:gene'); let b = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b)); assert.equal(b.thumbnailSource, 'owner'); assert.equal(b.sha, sha(img));
  r = await put('willow', jpeg(1280, 720, { pad: 3 }), 'god_owneragent'); b = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b)); assert.equal(b.thumbnail, `/__sim/thumbs/willow/${b.sha}.jpg`);
  assert.deepEqual(readdirSync(join(data, 'worlds/willow/thumbs')), [`${b.sha}.jpg`], 'a retake keeps exactly one file');
  r = await put('nope', img, 'dev:gene'); assert.equal(r.status, 404);
  r = await api('/__sim/worlds/willow/thumbnail', { method: 'GET' }); assert.equal(r.status, 405);
  const log = readFileSync(join(data, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.op === 'thumbnail');
  assert.deepEqual(log.map((x) => [x.by, x.via]), [['dev:gene', 'session'], ['dev:gene', 'token']]);
});

test('the catalog: owner → template default → none; immutable content-hashed files; one shared default URL', async () => {
  for (const name of ['Second Plain', 'Bare One']) assert.equal((await post('/__sim/op/create-world', { name, template: name === 'Bare One' ? 'bare' : 'plain', owner: 'dev:gene' })).status, 201);
  const own = await row('willow'), second = await row('second-plain'), bare = await row('bare-one');
  assert.equal(own.thumbnailSource, 'owner'); assert.match(own.thumbnail, /^\/__sim\/thumbs\/willow\/[0-9a-f]{64}\.jpg$/);
  assert.deepEqual([second.thumbnail, second.thumbnailSource], [`/__sim/thumbs/_template/${sha(DEFAULT)}.jpg`, 'template']);
  assert.deepEqual([bare.thumbnail, bare.thumbnailSource], [null, null], 'no default in place: no picture, never a broken one');
  for (const url of [own.thumbnail, second.thumbnail]) {
    const r = await api(url); const body = Buffer.from(await r.arrayBuffer());
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(sha(body), url.match(/([0-9a-f]{64})\.jpg$/)[1], 'the URL names the bytes');
    assert.equal((await api(url, { headers: { 'if-none-match': r.headers.get('etag') } })).status, 304);
  }
  // a stale sha, another world's sha, a made-up template sha and odd paths are 404s
  const ownSha = own.thumbnail.match(/([0-9a-f]{64})/)[1];
  for (const p of [`/__sim/thumbs/willow/${sha(DEFAULT)}.jpg`, `/__sim/thumbs/second-plain/${ownSha}.jpg`, `/__sim/thumbs/_template/${'0'.repeat(64)}.jpg`, `/__sim/thumbs/willow/../worlds.json`, `/__sim/thumbs/_template/${sha(DEFAULT)}.png`])
    assert.equal((await api(p)).status, 404, p);
  // DELETE falls back to the template default and removes the file
  let r = await put('willow', null, 'god_cobuilder', 'DELETE'); assert.equal(r.status, 403);
  r = await put('willow', null, 'god_owneragent', 'DELETE'); const b = await r.json();
  assert.equal(r.status, 200); assert.deepEqual([b.thumbnail, b.thumbnailSource], [second.thumbnail, 'template']);
  assert.equal(existsSync(join(data, 'worlds/willow/thumbs')), false);
  assert.equal((await api(own.thumbnail)).status, 404);
  assert.equal((await row('willow')).thumbnail, second.thumbnail, 'the next poll shows the default');
});

test('writing never wakes a sleeping world; the thumbnail survives a restart and an archive and restore', async () => {
  const img = jpeg(1280, 720, { pad: 11 });
  assert.equal((await put('willow', img, 'dev:gene')).status, 200);
  await L.close(); L = await open();   // a new launcher generation: nothing is started (eager 0)
  assert.notEqual((await childOf('willow')).status, 'running');
  writeFileSync(hits, '');
  assert.equal((await row('willow')).thumbnail, `/__sim/thumbs/willow/${sha(img)}.jpg`, 'survives the restart');
  const img2 = jpeg(1280, 720, { pad: 13 });
  for (const [token, bytes, method] of [['dev:gene', img2, 'POST'], ['god_owneragent', img, 'POST'], ['dev:mallory', img, 'POST'], ['god_owneragent', null, 'DELETE'], ['god_owneragent', img2, 'POST']])
    await (await put('willow', bytes, token, method)).arrayBuffer();
  await (await api(`/__sim/thumbs/willow/${sha(img2)}.jpg`)).arrayBuffer();
  assert.notEqual((await childOf('willow')).status, 'running', 'POST, DELETE, a refusal and the GET left the world asleep');
  assert.equal(readFileSync(hits, 'utf8'), '', 'no request reached the world');
  // archive (the owner's agent) and restore (operator): the file and the row come back together
  let r = await post('/__sim/worlds/willow/archive', { confirm: 'willow' }, { authorization: 'Bearer god_owneragent' }); const a = await r.json(); assert.equal(r.status, 200, JSON.stringify(a));
  assert.equal(await row('willow'), undefined);
  assert.equal((await api(`/__sim/thumbs/willow/${sha(img2)}.jpg`)).status, 404, 'not served while archived');
  r = await post('/__sim/op/restore-world', { id: a.id }); assert.equal(r.status, 200);
  const back = await row('willow');
  assert.deepEqual([back.thumbnail, back.thumbnailSource], [`/__sim/thumbs/willow/${sha(img2)}.jpg`, 'owner']);
  assert.equal((await api(back.thumbnail)).status, 200);
});

test('the rate limit answers 429 with Retry-After and a fix', async () => {
  await L.close();
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: data, webDir, templatesDir, command, eager: 0, log: () => {}, thumbnailRate: { limit: 1 } });
  assert.equal((await put('second-plain', jpeg(1280, 720), 'dev:gene')).status, 200);
  const r = await put('second-plain', jpeg(1280, 720, { pad: 1 }), 'dev:gene'); const b = await r.json();
  assert.equal(r.status, 429); assert.equal(b.code, 'thumbnail.rate'); assert.ok(b.fix); assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal((await put('second-plain', jpeg(1280, 720), 'dev:mallory')).status, 403, 'a stranger never spends the owner’s quota');
});

test('Clerk sign-in: the owner’s verified session sets it, another account’s is refused, a dev token is nobody', { timeout: 120_000 }, async () => {
  const { clerkKeys, ISSUER, PUBLISHABLE_KEY } = await import('../../apps/server/test/clerk-fixture.ts');
  const { verifiedCreator } = await import('./creator-auth.mjs');
  const CPORT = 6475, corigin = `http://127.0.0.1:${CPORT}`, cdir = join(dir, 'clerk'); mkdirSync(cdir);
  const keys = await clerkKeys(corigin);
  writeFileSync(join(cdir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  const envFile = join(cdir, 'fixture.env'), preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname;
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${corigin}`, `SIM_TEST_JWKS_FILE=${join(cdir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, ''].join('\n'));
  const ccommand = (w, port, o) => { const c = defaultCommand(w, port, { ...o, publicOrigin: corigin }); return { cmd: process.execPath, args: [born], env: { ...c.env, DATA_DIR: w.dataDir } }; };
  const C = await openLauncher({ port: CPORT, range: [6476, 6477], dataDir: join(cdir, 'data'), webDir, templatesDir, authEnvFile: envFile, publicOrigin: corigin, command: ccommand, eager: 0, log: () => {} });
  try {
    const alice = await keys.sign('user_alice'), bob = await keys.sign('user_bob');
    const child = { envFile, registryPath: join(cdir, 'data', 'accounts.sqlite') };
    const aliceId = await verifiedCreator(`Bearer ${alice}`, child, corigin, new URL('../..', import.meta.url).pathname);
    assert.match(aliceId ?? '', /^acct_/);
    let r = await fetch(`${corigin}/__sim/op/create-world`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alice Fen', template: 'plain', owner: aliceId }) });
    assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
    const send = (tok) => fetch(`${corigin}/__sim/worlds/alice-fen/thumbnail`, { method: 'POST', headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${tok}` }, body: jpeg(1280, 720) });
    assert.equal((await send(bob)).status, 403, 'another verified account');
    assert.equal((await send('dev:alice')).status, 401, 'no dev identity on a Clerk launcher');
    r = await send(alice); const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b)); assert.equal(b.thumbnailSource, 'owner');
  } finally { await C.close(); }
});
