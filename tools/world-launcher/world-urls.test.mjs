import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connect } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { Registry, worldIdOf } from './registry.mjs';
import { migrateRegistry, reslugRegistry } from './reslug.mjs';
import { canonicalRequest } from './world-urls.mjs';
import { defaultCommand } from './children.mjs';
import { openLauncher } from './launcher.mjs';
import { archiveWorld, restoreWorld, addGodToken } from './worldops.mjs';
import { notTestWorld } from './op-souls.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';

const mappings = [['eden-2026', 'eden'], ['my-mars-college-2026-3', 'mars-college-2026'], ['mars-2027', 'mars-college-2027']];
const fixture = () => ({ schema: 'world-launcher-registry/1', other: 'preserved', worlds: mappings.map(([slug]) => ({ slug, name: slug, template: 'empty', createdAt: 1, owner: 'synthetic-owner', limits: { look: 7 }, worldHeapMb: 2048 })) });
const dir = () => { mkdirSync('.local', { recursive: true }); return mkdtempSync(resolve('.local/root-urls-')); };

test('offline migration changes only registry URLs; stable identity, opaque files and settings survive reload', () => {
  const data = dir(), original = JSON.stringify(fixture()); writeFileSync(join(data, 'worlds.json'), original);
  writeFileSync(join(data, 'accounts.sqlite'), 'synthetic opaque account registry');
  for (const [from] of mappings) { mkdirSync(join(data, 'worlds', from, 'god'), { recursive: true }); writeFileSync(join(data, 'worlds', from, 'sim.db'), 'synthetic opaque souls and ownership'); writeFileSync(join(data, 'worlds', from, 'god', 'token'), 'synthetic opaque token'); }
  assert.deepEqual(migrateRegistry(data, mappings), { applied: false, worlds: 3, renamed: 3 });
  assert.equal(readFileSync(join(data, 'worlds.json'), 'utf8'), original);
  assert.throws(() => migrateRegistry(data, mappings, { apply: true }), /offline/);
  migrateRegistry(data, mappings, { apply: true, offline: true });
  const registry = new Registry(data); registry.save(); const loaded = new Registry(data);
  for (const [from, to] of mappings) {
    const w = loaded.get(to);
    assert.equal(w.worldId, from + '-1'); assert.equal(w.worldKey, from); assert.equal(w.owner, 'synthetic-owner'); assert.equal(w.worldHeapMb, 2048); assert.deepEqual(w.limits, { look: 7 });
    assert.equal(loaded.worldDir(to), join(data, 'worlds', from)); assert.equal(loaded.resolveSlug(from), to);
    assert.equal(readFileSync(join(loaded.worldDir(to), 'sim.db'), 'utf8'), 'synthetic opaque souls and ownership');
    assert.equal(readFileSync(join(loaded.worldDir(to), 'god', 'token'), 'utf8'), 'synthetic opaque token');
    assert.equal(existsSync(join(data, 'worlds', to)), false);
    const env = defaultCommand({ ...w, dataDir: loaded.worldDir(to) }, 1, {}).env;
    assert.equal(env.WORLD_ID, from + '-1'); assert.equal(env.WORLD_KEY, from); assert.equal(env.WORLD_SLUG, to); assert.equal(env.WORLD_PATH, '/w/' + to);
    assert.equal(notTestWorld({ ...w, test: true }, data)[1], 'op.not-test-world');
  }
  assert.equal(readFileSync(join(data, 'accounts.sqlite'), 'utf8'), 'synthetic opaque account registry');
  assert.equal(readFileSync(join(data, 'worlds.before-reslug.json'), 'utf8'), original);
  assert.equal(JSON.parse(readFileSync(loaded.file)).other, 'preserved');
});

test('collisions, malformed mappings and forks refuse the whole batch without writing', () => {
  for (const map of [[['eden-2026', 'mars-2027']], [['eden-2026', 'eden'], ['missing', 'new-name']], [['eden-2026', '../eden']], [['eden-2026', 'eden'], ['mars-2027', 'eden']], [['eden-2026', 'eden'], ['eden-2026', 'other']]]) {
    const data = dir(), bytes = JSON.stringify(fixture()); writeFileSync(join(data, 'worlds.json'), bytes);
    assert.throws(() => migrateRegistry(data, map, { apply: true, offline: true }));
    assert.equal(readFileSync(join(data, 'worlds.json'), 'utf8'), bytes); assert.equal(existsSync(join(data, 'worlds.before-reslug.json')), false);
  }
  const many = fixture(); many.legacyBases = Array.from({ length: 8 }, (_, i) => `/old-${i}`); assert.throws(() => reslugRegistry(many, mappings), /limit/);
  const f = fixture(); f.worlds[0].fork = {}; assert.throws(() => reslugRegistry(f, mappings), /fork/);
  const data = dir(); writeFileSync(join(data, 'worlds.json'), JSON.stringify(fixture())); mkdirSync(join(data, 'worlds', 'eden'), { recursive: true });
  assert.throws(() => migrateRegistry(data, mappings, { apply: true, offline: true }), /directory/);
});

test('canonical routes: old prefix, old slugs, canonical prefix and distinct second world; no substring aliases', () => {
  const data = dir(); writeFileSync(join(data, 'worlds.json'), JSON.stringify(reslugRegistry(fixture(), mappings))); const r = new Registry(data);
  for (const base of ['', '/next']) {
    for (const [old, slug] of mappings) for (const prefix of ['/worlds', base]) for (const name of [old, slug]) {
      assert.equal(canonicalRequest(`${prefix}/w/${name}/v1/edge/act`, base, r), `${base}/w/${slug}/v1/edge/act`);
      assert.equal(canonicalRequest(`${prefix}/__sim/worlds/${name}/claim`, base, r), `${base}/__sim/worlds/${slug}/claim`);
    }
    assert.equal(canonicalRequest('/worlds', base, r), base + '/');
  }
  assert.equal(canonicalRequest('/worldsx/w/eden-2026/', '', r), '/worldsx/w/eden-2026/');
  assert.equal(canonicalRequest('/w/eden-2026-other/', '', r), '/w/eden-2026-other/');
});

test('archive and restore a migrated world keep its original directory and aliases', async () => {
  const data = dir(); writeFileSync(join(data, 'worlds.json'), JSON.stringify(reslugRegistry(fixture(), mappings))); const registry = new Registry(data);
  mkdirSync(registry.worldDir('eden'), { recursive: true }); writeFileSync(join(registry.worldDir('eden'), 'sim.db'), 'opaque');
  const pool = { state: () => null, stop: async () => {}, kids: new Map() };
  const out = await archiveWorld({ registry, pool, dataDir: data }, 'eden', 'synthetic-operator');
  assert.equal(existsSync(join(data, 'worlds', 'eden-2026')), false);
  assert.equal(restoreWorld({ registry, dataDir: data }, out.id, 'synthetic-operator')[0], 200);
  assert.equal(readFileSync(join(registry.worldDir('eden'), 'sim.db'), 'utf8'), 'opaque'); assert.equal(registry.resolveSlug('eden-2026'), 'eden');
});

test('root launcher redirects pages but proxies legacy POST bytes, SSE and websocket upgrades to one child', { timeout: 30000 }, async t => {
  const data = dir(); writeFileSync(join(data, 'worlds.json'), JSON.stringify(reslugRegistry(fixture(), mappings)));
  const originalDir = join(data, 'worlds', 'eden-2026'); mkdirSync(originalDir, { recursive: true });
  const dbFile = join(originalDir, 'sim.db'), db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT); CREATE TABLE god_tokens_v1 (world_id TEXT, token_hash TEXT, label TEXT, created_at INTEGER)');
  db.prepare('INSERT INTO world_meta_v1 VALUES (?, ?)').run('eden-2026-1', JSON.stringify({ owner: 'synthetic-owner' })); db.close();
  addGodToken(dbFile, 'eden-2026-1', 'god_synthetic_existing', 'synthetic god');
  const web = join(data, 'web'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<head><title>Worlds</title></head>');
  const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
  const basePort = Number(process.env.ROOT_URL_TEST_PORT ?? await testPort(4));
  const launcher = await openLauncher({ port: basePort, range: [basePort + 1, basePort + 3], base: '/', dataDir: data, webDir: web, eager: 0, log: () => {}, command: (w, p) => ({ cmd: process.execPath, args: [fake], env: { WORLD_KEY: w.worldKey, WORLD_SLUG: w.slug, WORLD_ID: worldIdOf(w), WORLD_PATH: `/w/${w.slug}`, PORT: String(p) } }) });
  t.after(() => launcher.close()); const origin = `http://127.0.0.1:${basePort}`;
  assert.equal((await fetch(origin + '/')).status, 200);
  for (const [old, slug] of mappings) {
    const response = await fetch(`${origin}/worlds/w/${old}?proof=1`, { redirect: 'manual' });
    assert.equal(response.status, 308); assert.equal(response.headers.get('location'), `/w/${slug}/?proof=1`);
    for (const path of [`/worlds/w/${old}`, `/worlds/w/${slug}`, `/w/${old}`, `/w/${slug}`]) {
      const post = await fetch(origin + path + '/echo', { method: 'POST', body: 'unchanged body\nsecond line' });
      assert.equal(post.status, 200); assert.equal(await post.text(), 'unchanged body\nsecond line');
      const config = await (await fetch(origin + path + '/v1/config')).json(); assert.equal(config.worldId, old + '-1');
    }
  }
  const owned = await fetch(origin + '/worlds/__sim/worlds/eden-2026/unlisted', { method: 'POST', headers: { authorization: 'Bearer god_synthetic_existing', 'content-type': 'application/json' }, body: JSON.stringify({ unlisted: false }) });
  assert.equal(owned.status, 200, 'existing god token reaches original identity/owner through old launcher route');
  const sse = await fetch(origin + '/worlds/w/eden-2026/sse'); assert.match(sse.headers.get('content-type'), /text\/event-stream/); assert.match(await sse.text(), /data: 0[\s\S]*data: 3/);
  await new Promise((yes, no) => {
    const socket = connect(basePort, '127.0.0.1'); let result = ''; socket.setTimeout(5000, () => { socket.destroy(); no(Error('upgrade timed out')); });
    socket.once('connect', () => socket.write('GET /worlds/w/eden-2026/ws?proof=1 HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n'));
    socket.on('data', chunk => { result += chunk; if (result.includes('101') && !result.includes('PING')) socket.write('ping'); if (result.includes('PING')) { socket.destroy(); yes(); } }); socket.on('error', no);
  });
  assert.equal(launcher.pool.kids.size, 3, 'aliases did not create another world');
  const list = await (await fetch(origin + '/worlds/__sim/worlds.json')).json(); assert.deepEqual(list.worlds.map(w => w.basePath), mappings.map(([, s]) => '/w/' + s));
});
