import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { toyFactory } from '@souls/engine-toy';
import { publicMarsAsset, mountMarsStatic } from './mars-static.ts';

test('configured world identities keep their events and checkpoints separate; toy fixture stays toy-1', () => {
  const db = new Db(':memory:');
  const toy = new WorldHost(db, toyFactory, 'toy', 100), mars = new WorldHost(db, toyFactory, 'mars', 100, 'mars-1');
  toy.boot(); mars.boot(); toy.tickOnce(); mars.tickOnce();
  void mars.enqueue('admin', 'admin', { action: 'proof' }); mars.tickOnce();
  toy.saveSnapshot(); mars.saveSnapshot();
  assert.equal(toy.worldId, 'toy-1');
  assert.equal(db.events('toy-1').some(e => e.kind === 'admin'), false);
  assert.equal(db.events('mars-1').some(e => e.kind === 'admin'), true);
  assert.equal(db.latestSnapshot('toy-1')?.tick, 1);
  assert.equal(db.latestSnapshot('mars-1')?.tick, 2);
  db.close();
});
test('Mars asset proxy admits published derivatives and refuses source archives, APIs, traversal and encoded paths', () => {
  for (const path of ['/browser/campus.glb', '/modular/environment/animated-casual.glb', '/engine/campus-2026.json', '/data/manifest.json']) assert.equal(publicMarsAsset(path), true, path);
  for (const path of ['/browser/campus.blend', '/modular/../private.json', '/api/simulation/room', '/.cloudflare/simulation-test-room.json', '/modular/%2e%2e/private.json', '//evil.test/engine/a.json', '/research/photo.jpg']) assert.equal(publicMarsAsset(path), false, path);
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Hono } from 'hono';

test('copied GLBs negotiate streaming gzip on both public asset routes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'souls-mars-static-'));
  try {
    mkdirSync(join(root, 'modular/environment'), { recursive: true });
    // Large, compressible stand-in: test transport identity rather than GLB parsing.
    const original = Buffer.from('glTF animated-character payload '.repeat(4096));
    writeFileSync(join(root, 'modular/environment/animated-casual.glb'), original);
    const app = new Hono();
    mountMarsStatic(app, root);
    for (const prefix of ['', '/mars-assets']) {
      const path = `${prefix}/modular/environment/animated-casual.glb`;
      for (const encoding of ['gzip', 'br, gzip', 'gzip;q=0.5', '*;q=0.5']) {
        const response = await app.request(path, { headers: { 'accept-encoding': encoding } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
        assert.equal(response.headers.get('content-encoding'), 'gzip');
        assert.equal(response.headers.get('vary'), 'Accept-Encoding');
        assert.equal(response.headers.get('content-length'), null);
        const encoded = Buffer.from(await response.arrayBuffer());
        assert.ok(encoded.byteLength < original.byteLength / 4);
        assert.deepEqual(gunzipSync(encoded), original, `${path}: ${encoding}`);
      }
      for (const encoding of [undefined, 'identity', 'br', 'gzip;q=0', 'gzip;q=0, *;q=1']) {
        const response = await app.request(path, { headers: encoding ? { 'accept-encoding': encoding } : {} });
        assert.equal(response.headers.get('content-encoding'), null);
        assert.equal(response.headers.get('vary'), 'Accept-Encoding');
        assert.equal(response.headers.get('content-length'), String(original.length));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), original, `${path}: ${encoding}`);
      }
      const range = await app.request(path, { headers: { 'accept-encoding': 'gzip', range: 'bytes=0-31' } });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('content-encoding'), null);
      assert.equal(range.headers.get('content-range'), `bytes 0-31/${original.length}`);
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), original.subarray(0, 32));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('GLB compression leaves other asset types and missing routes alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'souls-mars-static-'));
  try {
    mkdirSync(join(root, 'engine'), { recursive: true });
    const original = JSON.stringify({ unchanged: 'value '.repeat(4096) });
    writeFileSync(join(root, 'engine/campus.json'), original);
    const app = new Hono();
    mountMarsStatic(app, root);
    for (const prefix of ['', '/mars-assets']) {
      const response = await app.request(`${prefix}/engine/campus.json`, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.equal(response.headers.get('content-encoding'), null);
      assert.equal(response.headers.get('vary'), null);
      assert.equal(await response.text(), original);
    }
    const missing = await app.request('/mars-assets/modular/missing.glb', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('content-encoding'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
