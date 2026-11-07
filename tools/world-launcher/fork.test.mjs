// node --test tools/world-launcher/fork.test.mjs — lane FORKS: operator forks of the old worlds (proxy and children on a free block of ports).
// Refusals only (no world boots here): the allowlist, loopback-only, a copy must exist, the launcher's own registry is refused,
// and public creation still never yields an old world's slug. forkOptions: the launcher's settings win over the descriptor.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { slugFor } from './registry.mjs';
import { forkOptions } from './fork-world.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(4);

const PORT = P0, dir = mkdtempSync(join(tmpdir(), 'launcher-fork-test-'));
const env = join(dir, 'clerk.env'); writeFileSync(env, 'CLERK_PUBLISHABLE_KEY=pk_test_ZmFrZQ\nCLERK_ISSUER_URL=https://clerk.example.test\n');
const desc = join(dir, 'mars.json'); writeFileSync(desc, JSON.stringify({ worldKey: 'mars', worldId: 'mars-2026-1' }));
const acc = join(dir, 'accounts.sqlite'); writeFileSync(acc, '');
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
let L;
before(async () => { L = await openLauncher({ port: PORT, range: [P0 + 1, P0 + 3], dataDir: join(dir, 'data'), webDir, base: '/worlds', publicOrigin: 'https://sim.example.test', authEnvFile: env, eager: 0, log: () => {} }); });
after(async () => { await L?.close(); });
const op = (body, headers = {}) => fetch(`http://127.0.0.1:${PORT}/worlds/__sim/op/register-fork`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('register-fork: allowlist, loopback only, needs the copy, never the launcher registry', async () => {
  let r = await op({ slug: 'mars', descriptor: desc, accounts: acc }, { 'x-forwarded-for': '1.2.3.4' }); assert.equal(r.status, 403);
  r = await op({ slug: 'toy', descriptor: desc, accounts: acc }); assert.equal(r.status, 400);
  r = await op({ slug: 'helloworld', descriptor: desc, accounts: acc }); assert.equal(r.status, 400);
  r = await op({ slug: 'eden', descriptor: desc, accounts: acc }); assert.equal(r.status, 400, 'descriptor of another world');
  r = await op({ slug: 'mars', descriptor: desc, accounts: join(dir, 'data', 'accounts.sqlite') }); assert.equal(r.status, 400);
  r = await op({ slug: 'mars', descriptor: desc, accounts: acc }); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'no-data');
  assert.equal(L.registry.worlds.length, 0);
  r = await fetch(`http://127.0.0.1:${PORT}/worlds/__sim/op/remove-fork`, { method: 'POST', body: JSON.stringify({ slug: 'mars' }) }); assert.equal(r.status, 404);
});
test('public names never become an old world slug', () => {
  for (const n of ['Eden', 'Mars', 'Little Martians', 'littlemartians']) assert.ok(!['eden', 'mars', 'littlemartians'].includes(slugFor(n)), n);
});
test('forkOptions: launcher settings over the descriptor; root path refused', () => {
  const e = { WORLD_PATH: '/worlds/w/mars', PORT: '4630', DATA_DIR: '/d', PUBLIC_URL: 'https://sim.example.test', BUILD_ID: 'we-x', EDGE_CLI_FILE: '/c.mjs' };
  const o = forkOptions({ worldKey: 'mars', worldId: 'mars-2026-1', marsWebDir: '/a/m' }, e, '/rel');
  assert.deepEqual([o.basePath, o.port, o.build, o.input, o.cliFile, o.marsWebDir], ['/worlds', 4630, 'we-x', '/rel', '/c.mjs', '/a/m']);
  assert.throws(() => forkOptions({ worldKey: 'mars', worldId: 'x' }, { ...e, WORLD_PATH: '/w/mars' }), /launcher base/);
  // the launcher that took the original worlds over (--old-worlds-root) serves them at the root
  const r = forkOptions({ worldKey: 'mars', worldId: 'mars-2026-1' }, { ...e, WORLD_PATH: '/w/mars', SIM_FORK_ROOT: '1' }, '/rel');
  assert.deepEqual([r.basePath, r.launcherChild], ['', true]);
  assert.throws(() => forkOptions({ worldKey: 'mars', worldId: 'x' }, { ...e, WORLD_PATH: '/w/eden', SIM_FORK_ROOT: '1' }), /not <base>\/w\/mars/);
  assert.throws(() => forkOptions({ worldKey: 'mars', worldId: 'x', port: 1 }, e), /comes from the launcher/);
  assert.throws(() => forkOptions({ worldKey: 'toy', worldId: 'x' }, { ...e, WORLD_PATH: '/worlds/w/toy' }), /not a forkable/);
});
