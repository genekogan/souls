// The local smoke runner's argument and port handling (the browser run itself is e2e/local-smoke.mjs; see
// docs/testing/e2e.md#local-smoke).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { UsageError, browsersDir, checkPort, parseArgs, portFree, smokeMarsWeb, missingSmokeKit, preflight } from './local-smoke.mjs';
import { config } from './config.mjs';

test('parseArgs: defaults, flags and the port from E2E_PORT', () => {
  assert.deepEqual(parseArgs([], {}), { port: null, out: null, clip: false, build: false, keepData: false, marsWeb: null, timeoutSeconds: 90 });
  const a = parseArgs(['--port', '9950', '--clip', '--build', '--keep-data', '--out', 'x', '--timeout-seconds', '30'], {});
  assert.equal(a.port, 9950); assert.equal(a.out, 'x'); assert.ok(a.clip && a.build && a.keepData); assert.equal(a.timeoutSeconds, 30);
  assert.equal(parseArgs([], { E2E_PORT: '9970' }).port, 9970);
  assert.equal(parseArgs(['--port', '9980'], { E2E_PORT: '9970' }).port, 9980, 'the argument wins over the env');
});

test('parseArgs: refuses unknown flags and missing values', () => {
  assert.throws(() => parseArgs(['--nope'], {}), UsageError);
  assert.throws(() => parseArgs(['--port'], {}), UsageError);
  assert.throws(() => parseArgs(['--timeout-seconds', '0'], {}), UsageError);
});

test('checkPort: a valid range clear of the client fixture ports in e2e/config.mjs', () => {
  assert.equal(checkPort('9950'), 9950);
  for (const bad of ['80', '65534', 'abc', '99.5']) assert.throws(() => checkPort(bad), UsageError, bad);
  const reserved = Object.values(config.ports);
  assert.ok(reserved.includes(7830));
  assert.throws(() => checkPort(7830), /reserved/);
  assert.throws(() => checkPort(7828), /7830 reserved/, 'the world ports (port+1, port+2) are checked too');
});

test('portFree: false while something listens', async () => {
  const s = createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  assert.equal(await portFree(port), false);
  await new Promise((r) => s.close(r));
  assert.equal(await portFree(port), true);
});

test('browsersDir: the env, then /opt/pw-browsers, then this checkout; never a home-directory cache', () => {
  assert.equal(browsersDir({ PLAYWRIGHT_BROWSERS_PATH: '/x' }, () => true), '/x');
  assert.equal(browsersDir({}, (p) => p === '/opt/pw-browsers'), '/opt/pw-browsers');
  const local = browsersDir({}, () => false);
  assert.ok(local.endsWith(join('.e2e', 'browsers')), local);
});

test('preflight selects and checks the actual served overlay, not a complete viewer beside an incomplete lane', () => {
  const root = '/fixture', lane = join(root, '.lane/mars-web'), viewer = join(root, 'mars/viewer/dist/client');
  const present = new Set([lane, join(root, 'apps/web/dist/index.html'), join(viewer, 'modular/humanoid/kit.json'), join(viewer, 'modular/environment/clips-ual.glb')]);
  const exists = (p) => present.has(p);
  assert.equal(smokeMarsWeb(root, null, {}, exists), lane);
  assert.deepEqual(missingSmokeKit(lane, exists), ['modular/humanoid/kit.json', 'modular/environment/clips-ual.glb']);
  const missing = preflight({ build: false }, lane, { root, exists, spawnCmd: () => ({ status: 0 }) });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /selected smoke overlay.*lacks.*--mars-web/);
  assert.deepEqual(missingSmokeKit(smokeMarsWeb(root, viewer, {}, exists), exists), []);
  assert.equal(smokeMarsWeb(root, null, { MARS_WEB_DIR: '/env-overlay' }, () => false), '/env-overlay');
  assert.equal(parseArgs(['--mars-web', '/isolated'], {}).marsWeb, '/isolated');
});
