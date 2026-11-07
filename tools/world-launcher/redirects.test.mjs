// node --test tools/world-launcher/redirects.test.mjs — the original worlds at the root (lane L2): root-path routing as the
// laptop proxy did it, and the old->new redirect switch (off unless redirects.json says enabled; pages only; ?stay wins).
// Launcher part on a free block of ports: --old-worlds-root refuses a base and every creation, flips with the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyWorldFor, parseRedirects, redirectSwitch, redirectTarget } from './redirects.mjs';
import { openLauncher } from './launcher.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(3);

test('root paths go where the laptop proxy sent them', () => {
  for (const [p, w] of [['/', 'eden'], ['/l/mars', 'eden'], ['/eden-agent.mjs', 'eden'], ['/skill.md', 'eden'], ['/mars-assets/x.glb', 'eden'],
    ['/w/mars/2020/', 'eden'], ['/w/mars/v1/config', 'mars'], ['/modular/humanoid/kit.json', 'mars'], ['/engine/a.js', 'mars'], ['/browser/x', 'mars'],
    ['/world-assets/littlemartians/a.png', 'littlemartians'], ['/world-assets/toy/a', null], ['/w/toy/', null]]) assert.equal(legacyWorldFor(p), w, p);
});

const page = (path, extra = {}) => [{ method: 'GET', headers: { accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document', ...extra } }, new URL(path, 'http://x').pathname, new URL(path, 'http://x')];
const ON = parseRedirects({ enabled: true, home: '/worlds/', worlds: { eden: '/worlds/w/eden-2026/', mars: '/worlds/w/my-mars-college-2026-3/' } });

test('redirect switch: pages only, off by default, ?stay keeps the original world', () => {
  assert.equal(redirectTarget(ON, ...page('/w/eden/')), '/worlds/w/eden-2026/');
  assert.equal(redirectTarget(ON, ...page('/w/eden')), '/worlds/w/eden-2026/');
  assert.equal(redirectTarget(ON, ...page('/w/eden/?soul=abc')), '/worlds/w/eden-2026/', 'the original world\'s query is dropped');
  assert.equal(redirectTarget(ON, ...page('/')), '/worlds/');
  assert.equal(redirectTarget(ON, ...page('/w/eden/?stay=1')), null);
  assert.equal(redirectTarget(ON, ...page('/w/littlemartians/')), null, 'no target: served here');
  assert.equal(redirectTarget(ON, ...page('/w/eden/v1/config')), null, 'API untouched');
  assert.equal(redirectTarget(ON, ...page('/w/eden/', { accept: 'application/json' })), null, 'agents untouched');
  assert.equal(redirectTarget(ON, ...page('/w/eden/', { 'sec-fetch-dest': 'iframe' })), null);
  const [req, p, u] = page('/w/eden/'); assert.equal(redirectTarget(ON, { ...req, method: 'POST' }, p, u), null);
  assert.equal(redirectTarget(parseRedirects({ enabled: false, worlds: { eden: '/worlds/' } }), ...page('/w/eden/')), null);
  assert.equal(redirectTarget(null, ...page('/w/eden/')), null);
});

test('redirects.json is checked: same-site paths only, never the world itself', () => {
  for (const bad of [null, [], {}, { enabled: 'yes' }, { enabled: true, worlds: { eden: 'https://evil.example/' } }, { enabled: true, worlds: { eden: '//evil.example/' } },
    { enabled: true, worlds: { eden: '/w/eden/' } }, { enabled: true, worlds: { toy: '/worlds/' } }, { enabled: true, home: '/' }, { enabled: true, home: 'worlds' }])
    assert.throws(() => parseRedirects(bad), /redirects\.json/, JSON.stringify(bad));
});

test('the live switch re-reads the file when it changes; a bad file is off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redirects-')), f = join(dir, 'redirects.json'), logs = [];
  const sw = redirectSwitch(f, (s) => logs.push(s));
  assert.equal(sw.target(...page('/w/eden/')), null, 'absent = off');
  writeFileSync(f, JSON.stringify({ enabled: true, worlds: { eden: '/worlds/w/eden-2026/' } })); utimesSync(f, new Date(), new Date(Date.now() + 1000));
  assert.equal(sw.target(...page('/w/eden/')), '/worlds/w/eden-2026/');
  writeFileSync(f, '{nope'); utimesSync(f, new Date(), new Date(Date.now() + 2000));
  assert.equal(sw.target(...page('/w/eden/')), null); assert.match(logs.at(-1), /redirects off/);
});

test('launcher --old-worlds-root: no base, no creation, the switch answers pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-legacy-'));
  const env = join(dir, 'clerk.env'); writeFileSync(env, 'CLERK_PUBLISHABLE_KEY=pk_test_ZmFrZQ\nCLERK_ISSUER_URL=https://clerk.example.test\n');
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>root');
  const common = { range: [P0 + 1, P0 + 2], webDir, publicOrigin: 'https://sim.example.test', authEnvFile: env, eager: 0, log: () => {}, oldWorldsRoot: true };
  await assert.rejects(openLauncher({ ...common, port: P0, dataDir: join(dir, 'a'), base: '/worlds' }), /drop --base/);
  await assert.rejects(openLauncher({ ...common, port: P0, dataDir: join(dir, 'a'), authEnvFile: undefined, devAuth: true, publicOrigin: `http://127.0.0.1:${P0}` }), /needs --auth-env/);
  const data = join(dir, 'data'); const L = await openLauncher({ ...common, port: P0, dataDir: data });
  try {
    const at = (p, o = {}) => fetch(`http://127.0.0.1:${P0}${p}`, { redirect: 'manual', ...o });
    for (const p of ['/__sim/worlds', '/__sim/op/create-world']) { const r = await at(p, { method: 'POST', body: '{"name":"x","template":"empty"}' }); assert.equal(r.status, 403, p); assert.equal((await r.json()).code, 'creation.elsewhere'); }
    const html = { headers: { accept: 'text/html' } };
    assert.equal((await at('/', html)).status, 200);
    writeFileSync(join(data, 'redirects.json'), JSON.stringify({ enabled: true, home: '/worlds/', worlds: { eden: '/worlds/w/eden-2026/' } }));
    let r = await at('/w/eden/', html); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/worlds/w/eden-2026/');
    r = await at('/', html); assert.equal(r.headers.get('location'), '/worlds/');
    r = await at('/w/eden/?stay=1', html); assert.notEqual(r.status, 302);
    writeFileSync(join(data, 'redirects.json'), JSON.stringify({ enabled: false, worlds: {} })); utimesSync(join(data, 'redirects.json'), new Date(), new Date(Date.now() + 1000));
    r = await at('/', html); assert.equal(r.status, 200);
  } finally { await L.close(); }
});
