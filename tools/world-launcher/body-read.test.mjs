// node --test tools/world-launcher/body-read.test.mjs (#717; launcher :6754, fake worlds on 6750-6753)
// The launcher's body read path: site key and loopback only, GET of a content address, binary passed through, 4 MiB cap.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';

const PORT = 6754, RANGE = [6750, 6753];
const dir = mkdtempSync(join(tmpdir(), 'launcher-body-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const webDir = join(dir, 'web'); mkdirSync(webDir);
const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
let key = null, size = 64, env = null;
const command = (w, port, o) => { key = o.site?.key ?? key; env = { WORLD_PATH: `/w/${w.slug}`, BODY_COLLECTION_PATH: w.bodyCollectionPath }; return { cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), FAKE_BODY_BYTES: String(size) } }; };
let L;
after(async () => { await L?.close(); });
const ref = 'body_' + 'a'.repeat(64);

test('site body read: keyed, GET-only, binary, capped at 4 MiB; withdrawn and unknown sources are refused', async () => {
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} });
  const made = await fetch(`http://127.0.0.1:${PORT}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Stone Field' }) });
  assert.equal(made.status, 201); const { slug } = await made.json();
  const url = `http://127.0.0.1:${PORT}/__sim/site/body/${slug}/${ref}.glb`;
  assert.equal((await fetch(url)).status, 404, 'no site key: not found');
  await fetch(`http://127.0.0.1:${PORT}/w/${slug}/healthz`);   // boots the world, which captures the run's key
  assert.ok(key, 'children receive the site key');
  assert.equal(env.BODY_COLLECTION_PATH, join(dir, 'data', 'body-collections.sqlite'), 'one collection store per launcher stage');
  const r = await fetch(url, { headers: { 'x-sim-site-key': key } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'model/gltf-binary'); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), new Uint8Array(64).fill(7));
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-sim-site-key': key } })).status, 404, 'GET only');
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/__sim/site/body/${slug}/not-a-ref.glb`, { headers: { 'x-sim-site-key': key } })).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/__sim/site/body/nowhere/${ref}.glb`, { headers: { 'x-sim-site-key': key } })).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/__sim/site/body/${slug}/body_${'f'.repeat(64)}.glb`, { headers: { 'x-sim-site-key': key } })).status, 410);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/w/${slug}/v1/site/body/${ref}.glb`, { headers: { 'x-sim-site-key': key } })).status, 404, 'the public proxy never reaches the world route');
  // over the cap: restart the world with a 4 MiB + 1 byte answer
  await L.close(); size = 4 * 1024 * 1024 + 1; key = null;
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} });
  await fetch(`http://127.0.0.1:${PORT}/w/${slug}/healthz`);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/__sim/site/body/${slug}/${ref}.glb`, { headers: { 'x-sim-site-key': key } })).status, 413);
});

test('site body read resolves the stable world id after a reslug, and the old slug as an alias', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');const { reslugRegistry } = await import('./reslug.mjs');
  await L.close(); size = 64; key = null;
  const file = join(dir, 'data', 'worlds.json'), reg = JSON.parse(readFileSync(file, 'utf8')), old = reg.worlds[0].slug, id = `${old}-1`;
  writeFileSync(file, JSON.stringify(reslugRegistry(reg, [[old, 'granite-field']])));
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} });
  await fetch(`http://127.0.0.1:${PORT}/w/granite-field/healthz`);
  for (const source of [id, old, 'granite-field']) assert.equal((await fetch(`http://127.0.0.1:${PORT}/__sim/site/body/${source}/${ref}.glb`, { headers: { 'x-sim-site-key': key } })).status, 200, source);
});
