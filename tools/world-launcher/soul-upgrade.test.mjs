// CTX-3 (#1136): one CLI serves every world in a home; `upgrade` fetches a newer bundle and checks it against the world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newerThan } from './soul/home.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const ours = /const VERSION = "([0-9.]+)"/.exec(readFileSync(cli, 'utf8'))[1];
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const describe = (bytes, version, minVersion = '2.0.0') => ({ contract: 'eden-edge/1', version, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), minVersion });

async function world(t, served) {
  const hits = [];
  const server = createServer((req, res) => { req.resume(); req.on('end', () => {
    const path = req.url.replace(/^\/w\/[a-z]+/, ''); hits.push(path);
    const w = served[/^\/w\/([a-z]+)/.exec(req.url)?.[1]];
    if (path === '/v1/config') return json(res, 200, { devAuth: true, worldId: 'w', worldName: 'W', ...(w?.manifest ? { soulClient: w.manifest } : {}) });
    if (path === '/eden.mjs') return res.end(w.bytes);
    json(res, 404, {});
  }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { base: `http://127.0.0.1:${server.address().port}/w`, hits };
}
function folder(t) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'souls-upgrade-'))); t.after(() => rmSync(d, { recursive: true, force: true }));
  copyFileSync(cli, join(d, 'eden.mjs'));
  return { d, run: (...args) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['eden.mjs', ...args], { cwd: d, env: { ...process.env, HOME: d, SOULS_HOME: '', SOULS_PRINCIPAL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', (x) => { out += x; }); c.stderr.on('data', (x) => { err += x; });
    c.on('exit', (code) => { let j = null; try { j = JSON.parse(out); } catch { /* words */ } resolve({ code, d: j, err }); });
  }) };
}
const NEWER = '9.9.9', newer = Buffer.from(`// a newer bundle\nconst VERSION = "${NEWER}";\nconsole.log('{"newer":true}');\n`);

test('versions compare by number', () => {
  assert.ok(newerThan('2.17.0', '2.9.9')); assert.ok(newerThan('2.17.1', '2.17')); assert.ok(!newerThan('2.17.0', '2.17.0')); assert.ok(newerThan('1.0', undefined));
});

test('A2 A3: the home records each world, a world needing more says how, upgrade verifies and installs', async (t) => {
  const w = await world(t, { old: { manifest: describe(Buffer.from('x'), '2.0.0') }, next: { manifest: describe(newer, NEWER, NEWER), bytes: newer } });
  const { d, run } = folder(t);
  assert.equal((await run('register', `${w.base}/old`)).code, 0);
  const refused = await run('register', `${w.base}/next`);
  assert.equal(refused.code, 1); assert.match(refused.err, new RegExp(`needs eden ${NEWER.replaceAll('.', '\\.')} or newer; this is ${ours.replaceAll('.', '\\.')}\\. Run: node eden\\.mjs upgrade next`));
  const cfg = JSON.parse(readFileSync(join(d, '.souls/config.json'), 'utf8'));
  assert.deepEqual([cfg.worlds.old.contract, cfg.worlds.old.bundle, cfg.worlds.next.bundle], ['eden-edge/1', '2.0.0', NEWER]);
  // an older world's bundle is never installed over a newer one
  const same = await run('upgrade', 'old');
  assert.equal(same.d.upgraded, false); assert.equal(same.d.version, ours);
  const up = await run('upgrade', 'next');
  assert.equal(up.d.upgraded, true, up.err); assert.equal(up.d.to, NEWER);
  assert.deepEqual(readFileSync(join(d, '.souls/bin/eden.mjs')), newer);
  assert.deepEqual(readFileSync(join(d, 'eden.mjs')), newer, 'the copy in this folder moves with it');
});

test('A2: a bundle that is not what the world describes changes nothing', async (t) => {
  const tampered = Buffer.concat([newer, Buffer.from('// more')]);
  const w = await world(t, { next: { manifest: describe(newer, NEWER), bytes: tampered }, bare: {} });
  const { d, run } = folder(t), before = readFileSync(join(d, 'eden.mjs'));
  await run('register', `${w.base}/next`);
  const r = await run('upgrade', 'next');
  assert.equal(r.code, 1); assert.match(r.err, /not the one it describes/);
  assert.deepEqual(readFileSync(join(d, 'eden.mjs')), before);
  assert.notDeepEqual(readFileSync(join(d, '.souls/bin/eden.mjs')), tampered);
  await run('register', `${w.base}/bare`);
  assert.match((await run('upgrade', 'bare')).err, /does not say which bundle/);
});

test('doctor says when a world has moved past this client', async (t) => {
  const served = { old: { manifest: describe(Buffer.from('x'), '2.0.0') } }, w = await world(t, served);
  const { run } = folder(t);
  await run('register', `${w.base}/old`);
  assert.equal((await run('doctor')).d.needsUpgrade, undefined);
  served.old.manifest = describe(newer, NEWER, NEWER); served.old.bytes = newer;
  assert.deepEqual((await run('doctor')).d.needsUpgrade, [{ world: 'old', needs: NEWER, next: 'node eden.mjs upgrade old' }]);
});

test('A5: everyday commands ask nothing about versions', async (t) => {
  const w = await world(t, { old: { manifest: describe(Buffer.from('x'), '2.0.0') } });
  const { run } = folder(t);
  await run('register', `${w.base}/old`);
  w.hits.length = 0;
  await run('list'); await run('status');
  assert.deepEqual(w.hits, []);
});
