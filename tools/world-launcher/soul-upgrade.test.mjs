// CTX-3 (#1136): one CLI serves every world in a home; `upgrade` fetches a newer bundle and checks it against the world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome, newerThan, openHome } from './soul/home.mjs';

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
    if (path === '/eden.mjs' && w.redirect) { res.writeHead(302, { location: w.redirect }); return res.end(); }
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

test('A3: an upgrade run from a folder below reaches every copy, and an older world never takes the home back', async (t) => {
  const v3 = Buffer.from('const VERSION = "3.0.0";\nconsole.log(\'{"v3":true}\');\n');
  const w = await world(t, { old: { manifest: describe(Buffer.from('x'), '2.0.0') }, next: { manifest: describe(newer, NEWER), bytes: newer }, three: { manifest: describe(v3, '3.0.0'), bytes: v3 } });
  const { d, run } = folder(t), sub = join(d, 'below'); mkdirSync(sub); copyFileSync(cli, join(sub, 'eden.mjs'));
  const below = (...args) => new Promise((resolve) => { const c = spawn(process.execPath, ['eden.mjs', ...args], { cwd: sub, env: { ...process.env, HOME: d, SOULS_HOME: '', SOULS_PRINCIPAL: '' }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; c.stdout.on('data', (x) => { out += x; }); c.on('exit', (code) => resolve({ code, out })); });
  await run('register', `${w.base}/old`); await run('register', `${w.base}/next`); await run('register', `${w.base}/three`);
  const up = await below('upgrade', 'next');
  assert.match(up.out, /"upgraded": true/);
  assert.deepEqual(readFileSync(join(d, '.souls/bin/eden.mjs')), newer);
  assert.equal((await run('status')).d?.newer, true, 'the folder copy runs the new bundle');
  assert.match((await below('status')).out, /newer/, 'so does the older copy below, through the home');
  assert.notDeepEqual(readFileSync(join(sub, 'eden.mjs')), newer, 'a copy outside the home folder is left alone');
  assert.equal(JSON.parse(readFileSync(join(d, '.souls/config.json'), 'utf8')).client, NEWER);
});

test('a home reached through a symlink still hands over', async (t) => {
  const w = await world(t, { next: { manifest: describe(newer, NEWER), bytes: newer } });
  const { d, run } = folder(t), link = `${d}-link`; symlinkSync(d, link); t.after(() => rmSync(link, { force: true }));
  await run('register', `${w.base}/next`); await run('upgrade', 'next');
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'souls-old-'))); t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  copyFileSync(cli, join(elsewhere, 'eden.mjs'));
  const out = await new Promise((resolve) => { const c = spawn(process.execPath, ['eden.mjs', 'status'], { cwd: elsewhere, env: { ...process.env, HOME: elsewhere, SOULS_HOME: join(link, '.souls'), SOULS_PRINCIPAL: '' }, stdio: ['ignore', 'pipe', 'ignore'] }); let o = ''; c.stdout.on('data', (x) => { o += x; }); c.on('exit', () => resolve(o)); });
  assert.match(out, /newer/);
});

test('never older: a bundle below the home\'s is not installed', (t) => {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'souls-bin-'))), '.souls'); t.after(() => rmSync(dirname(root), { recursive: true, force: true }));
  createHome(root, { version: '9.0.0' });
  assert.equal(openHome(root).installBundle(Buffer.from('old'), null, '3.0.0'), null);
  assert.ok(!existsSync(join(root, 'bin/eden.mjs')));
});

test('a client from a site this home does not know needs a person', async (t) => {
  const w = await world(t, { next: { manifest: describe(newer, NEWER), bytes: newer } }), other = await world(t, { next: { manifest: describe(newer, NEWER), bytes: newer } });
  const { d, run } = folder(t);
  await run('register', `${w.base}/next`);
  await run('register', `${other.base}/next`);
  const refused = await run('upgrade', 'next-2');
  assert.match(refused.err, /Ask your human/); assert.match(refused.err, /--trust/);
  assert.equal(JSON.parse(readFileSync(join(d, '.souls/config.json'), 'utf8')).client, ours);
  assert.equal((await run('upgrade', 'next-2', '--trust')).d.upgraded, true);
});

test('trust is never earned by asking twice: a home with no list stays refused until a person says so', async (t) => {
  const w = await world(t, { next: { manifest: describe(newer, NEWER), bytes: newer } });
  const { d, run } = folder(t), file = join(d, '.souls/config.json');
  await run('register', `${w.base}/next`);
  const c = JSON.parse(readFileSync(file, 'utf8')); delete c.trustedOrigins; writeFileSync(file, JSON.stringify(c));   // what 2.15 and 2.16 wrote
  const list = () => JSON.parse(readFileSync(file, 'utf8')).trustedOrigins;
  assert.match((await run('upgrade', 'next')).err, /Ask your human/);
  assert.equal(list(), undefined, 'a refusal grants nothing');
  assert.match((await run('upgrade', 'next')).err, /Ask your human/, 'the second try is refused too');
  await run('register', `${w.base}/next`); await run('doctor');
  assert.equal(list(), undefined, 'neither does register or doctor');
  assert.match((await run('upgrade', 'next')).err, /Ask your human/);
  assert.deepEqual(readFileSync(join(d, 'eden.mjs')), readFileSync(cli), 'nothing was installed');
  assert.equal((await run('upgrade', 'next', '--trust')).d.upgraded, true);
  assert.equal(list().length, 1);
});

test('a trusted site cannot hand the bundle over to another: a redirect is refused', async (t) => {
  const other = await world(t, { next: { bytes: newer } });
  const w = await world(t, { next: { manifest: describe(newer, NEWER), redirect: `${other.base}/next/eden.mjs` } });
  const { d, run } = folder(t);
  await run('register', `${w.base}/next`);
  for (const args of [['upgrade', 'next'], ['upgrade', 'next', '--trust']]) {
    const r = await run(...args);
    assert.equal(r.code, 1); assert.match(r.err, /redirect is not followed/); assert.match(r.err, /Nothing changed/);
  }
  assert.deepEqual(other.hits, [], 'the other site is never asked');
  assert.deepEqual(readFileSync(join(d, 'eden.mjs')), readFileSync(cli), 'nothing was installed');
  assert.equal(JSON.parse(readFileSync(join(d, '.souls/config.json'), 'utf8')).client, ours);
});

test('a refused world does not become the current world', async (t) => {
  const w = await world(t, { old: { manifest: describe(Buffer.from('x'), '2.0.0') }, next: { manifest: describe(newer, NEWER, NEWER), bytes: newer } });
  const { d, run } = folder(t);
  await run('register', `${w.base}/old`); await run('register', `${w.base}/next`);
  assert.equal(JSON.parse(readFileSync(join(d, '.souls/config.json'), 'utf8')).currentWorld, 'old');
});

test('A3: no one bundle serves two contracts', async (t) => {
  const w = await world(t, { old: { manifest: describe(Buffer.from('x'), '2.0.0') }, next: { manifest: { ...describe(newer, NEWER), contract: 'eden-edge/2' }, bytes: newer } });
  const { run } = folder(t);
  await run('register', `${w.base}/old`); await run('register', `${w.base}/next`);
  assert.match((await run('upgrade', 'next')).err, /no one bundle serves both/);
});

test('A5: everyday commands ask nothing about versions', async (t) => {
  const w = await world(t, { old: { manifest: describe(Buffer.from('x'), '2.0.0') } });
  const { run } = folder(t);
  await run('register', `${w.base}/old`);
  w.hits.length = 0;
  await run('list'); await run('status');
  assert.deepEqual(w.hits, []);
});
