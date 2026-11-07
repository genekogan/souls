// node --test tools/world-launcher/humanoid-kit.test.mjs  (a free block of ports; no world processes)
// Release 3 walk: /worlds/modular/humanoid/kit.json was proxied to "any running world"; with only the old-world eden fork
// awake (it has no such kit) every page's humanoid kit was a 404 and composed bodies fell back to simple figures. The
// launcher now serves this release's humanoid kit itself, under its base, whatever is awake.
// 3.19 legacy (2026-10-19): the same for the rest of /modular. The old-world forks' mars-web is the copy sealed at
// cutover, so the new character files (animated-*.mesh.glb, clips-*.glb) were a 404 at the root and /w/eden never drew.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(12);

const dir = mkdtempSync(join(tmpdir(), 'launcher-kit-'));
const webDir = join(dir, 'web'); mkdirSync(join(webDir, 'assets'), { recursive: true }); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const marsWebDir = join(dir, 'mars-web'); mkdirSync(join(marsWebDir, 'modular', 'humanoid', 'parts'), { recursive: true });
writeFileSync(join(marsWebDir, 'modular', 'humanoid', 'kit.json'), '{"kit":1}');
writeFileSync(join(marsWebDir, 'modular', 'humanoid', 'parts', 'a.glb'), 'glTF');
mkdirSync(join(marsWebDir, 'modular', 'environment'));
writeFileSync(join(marsWebDir, 'modular', 'environment', 'clips-ual.glb'), 'glTF-clips');
writeFileSync(join(marsWebDir, 'modular', 'ASSETS.md'), '# not served');
writeFileSync(join(marsWebDir, 'secret.json'), '{}');
const L = await openLauncher({ port: P0 + 11, range: [P0 + 3, P0 + 10], base: '/worlds', dataDir: join(dir, 'data'), webDir, templatesDir, marsWebDir, command: () => ({ cmd: process.execPath, args: ['-e', ''] }), eager: 0, log: () => {} });
after(() => L.close?.());
const get = (p) => fetch(`http://127.0.0.1:${P0 + 11}${p}`);

test('the humanoid kit and its parts are served by the launcher with no world awake', async () => {
  const kit = await get('/worlds/modular/humanoid/kit.json');
  assert.equal(kit.status, 200); assert.equal(await kit.text(), '{"kit":1}'); assert.match(kit.headers.get('content-type') ?? '', /json/);
  const part = await get('/worlds/modular/humanoid/parts/a.glb');
  assert.equal(part.status, 200); assert.equal(part.headers.get('content-type'), 'model/gltf-binary');
});

test('the environment GLBs (characters) are served by the launcher too, under the base and at the old-worlds root', async () => {
  const r = await get('/worlds/modular/environment/clips-ual.glb?v=372246400b19');
  assert.equal(r.status, 200); assert.equal(await r.text(), 'glTF-clips'); assert.match(r.headers.get('cache-control') ?? '', /max-age=86400/);
  assert.notEqual((await get('/worlds/modular/ASSETS.md')).status, 200, 'only asset types');
  const env = join(dir, 'clerk.env'); writeFileSync(env, 'CLERK_PUBLISHABLE_KEY=pk_test_ZmFrZQ\nCLERK_ISSUER_URL=https://clerk.example.test\n');
  const R = await openLauncher({ port: P0 + 2, range: [P0, P0 + 1], dataDir: join(dir, 'root-data'), webDir, templatesDir, marsWebDir, publicOrigin: 'https://sim.example.test', authEnvFile: env, oldWorldsRoot: true, eager: 0, log: () => {} });
  try {
    const root = await fetch(`http://127.0.0.1:${P0 + 2}/modular/environment/clips-ual.glb`);
    assert.equal(root.status, 200); assert.equal(await root.text(), 'glTF-clips');
    assert.equal((await fetch(`http://127.0.0.1:${P0 + 2}/modular/humanoid/kit.json`)).status, 200);
  } finally { await R.close(); }
});

test('nothing outside the kit is served from mars-web this way', async () => {
  for (const p of ['/worlds/modular/humanoid/../../secret.json', '/worlds/modular/humanoid/%2e%2e/%2e%2e/secret.json', '/worlds/modular/humanoid/missing.json', '/worlds/modular/%2e%2e/secret.json', '/worlds/modular/environment/missing.glb']) {
    assert.notEqual((await get(p)).status, 200, p);
  }
});
