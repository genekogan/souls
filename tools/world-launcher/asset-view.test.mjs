import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLauncher } from './launcher.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(2);

test('real launcher forwards asset-view bytes, validators and world isolation to the real HTTP handler', { timeout: 30_000 }, async () => {
  // Dedicated ports in the isolated test process/container; never a production data directory.
  const port = P0, childPort = P0 + 1, base = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), 'launcher-asset-view-'));
  const templatesDir = join(dir, 'templates'), webDir = join(dir, 'web'), assetsDir = join(dir, 'assets');
  for (const path of [templatesDir, webDir, assetsDir]) mkdirSync(path);
  writeFileSync(join(webDir, 'index.html'), '<title>Asset view transport fixture</title>');
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] });
  const body = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const bytes = Buffer.alloc(20 + body.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(body.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); body.copy(bytes, 20);
  const sha = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(assetsDir, `${sha}.glb`), bytes);
  writeFileSync(join(assetsDir, 'core.json'), JSON.stringify({ assets: { [sha]: { sha, ext: 'glb', kind: 'mesh', bytes: bytes.length, tris: 0, textures: 0, texPx: 0, box: [1, 1, 1] } } }));
  writeFileSync(join(assetsDir, 'renditions.json'), JSON.stringify({ schema: 'core-renditions/1', renditions: {} }));
  const fixture = fileURLToPath(new URL('../../apps/server/src/god/asset-view-http.fixture.ts', import.meta.url));
  const loader = fileURLToPath(new URL('../test-harness/web-loader.mjs', import.meta.url));
  const launcher = await openLauncher({ port, range: [childPort, childPort], base: '/worlds',
    dataDir: join(dir, 'data'), templatesDir, webDir, eager: 0, compileCache: false, sleepMs: 0, devAuth: true,
    command: (world, assignedPort) => ({ cmd: process.execPath, args: [`--import=${loader}`, fixture],
      env: { PATH: process.env.PATH, PORT: String(assignedPort), WORLD_PATH: `/worlds/w/${world.slug}`, ASSET_VIEW_FIXTURE_DIR: assetsDir } }),
    log: () => {},
  });
  const get = (url, headers = {}) => fetch(url, { headers: { 'accept-encoding': 'identity', ...headers }, signal: AbortSignal.timeout(10_000) });
  try {
    const created = await fetch(`${base}/worlds/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Asset View Fixture' }), signal: AbortSignal.timeout(15_000) });
    assert.equal(created.status, 201, 'real child boots through the launcher');
    const { slug } = await created.json();
    const path = `/asset-view/${sha}.glb`, scoped = `${base}/worlds/w/${slug}${path}`;
    const response = await get(scoped);
    assert.equal(response.status, 200, 'world-scoped asset-view route forwards to the real handler');
    assert.equal(response.headers.get('cache-control'), 'public, no-cache');
    assert.equal(response.headers.get('vary'), 'accept-encoding');
    const etag = response.headers.get('etag'); assert.equal(etag, `"${sha}"`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const unchanged = await get(scoped, { 'if-none-match': etag });
    assert.equal(unchanged.status, 304); assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
    assert.equal(unchanged.headers.get('etag'), etag);
    assert.equal(unchanged.headers.get('cache-control'), 'public, no-cache');
    assert.equal(unchanged.headers.get('vary'), 'accept-encoding');
    const missing = await get(`${base}/worlds/w/${slug}/asset-view/${'f'.repeat(64)}.glb`, { 'if-none-match': etag });
    assert.equal(missing.status, 404); assert.equal(missing.headers.get('cache-control'), 'no-store');
    for (const isolated of [`${base}/worlds/w/not-registered${path}`, `${base}${path}`, `${base}/w/${slug}${path}`, `http://127.0.0.1:${childPort}/worlds/w/not-registered${path}`]) {
      const denied = await get(isolated); assert.equal(denied.status, 404, isolated); await denied.arrayBuffer();
    }
    const direct = await get(`http://127.0.0.1:${childPort}${path}`);
    assert.equal(direct.status, 200); assert.equal(direct.headers.get('cache-control'), 'public, no-cache');
    assert.equal(direct.headers.get('etag'), etag); assert.deepEqual(Buffer.from(await direct.arrayBuffer()), bytes);
  } finally {
    await launcher.close();
  }
});
