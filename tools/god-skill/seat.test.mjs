// CTX-2 (#1135): god seats in the Souls home, through the real CLIs against a stand-in world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const god = fileURLToPath(new URL('./eden-god.mjs', import.meta.url)), eden = fileURLToPath(new URL('../world-launcher/soul/eden.mjs', import.meta.url));
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
async function worlds(t) {
  const souls = new Map();
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
      const m = /^\/w\/([ab])(\/[^?]*)/.exec(req.url); if (!m) return json(res, 404, {});
      const [, slug, path] = m, body = raw ? JSON.parse(raw) : {}, auth = req.headers.authorization ?? '';
      if (path === '/v1/config') return json(res, 200, { devAuth: true, worldId: `w_${slug}`, worldName: `World ${slug}` });
      if (path === '/v1/god/mint') return auth ? json(res, 200, { token: `god_${slug}_tok`, world: slug }) : json(res, 401, {});
      if (path === '/v1/god/status') return auth === `Bearer god_${slug}_tok` ? json(res, 200, { you: 'god', world: slug, entities: 0, seq: 1, versions: {} }) : json(res, 401, { code: 'unauthorized' });
      if (path === '/v1/souls' && req.method === 'POST') { const id = `s_${slug}${souls.size + 1}`; souls.set(id, body.name); return json(res, 200, { soul: { id, name: body.name } }); }
      const pair = /^\/v1\/souls\/(s_[a-z0-9]+)\/pair$/.exec(path); if (pair) return json(res, 200, { code: `code-${pair[1]}` });
      if (path === '/v1/agent/pair') return json(res, 200, { token: `sim_${body.code.slice(5)}_x` });
      if (path === '/v1/edge/here') return json(res, 200, { here: { me: { name: souls.get(/sim_(s_[a-z0-9]+)_/.exec(auth)?.[1]) } } });
      if (path === '/v1/me') return json(res, 200, { souls: [] });
      json(res, 404, { code: 'no-route', path });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/w`;
}
const folder = (t) => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'god-seat-'))); t.after(() => { for (const p of ['souls', 'gods']) if (existsSync(join(d, '.souls', p))) chmodSync(join(d, '.souls', p), 0o700); rmSync(d, { recursive: true, force: true }); }); return d; };
const runner = (cwd, cli) => (...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HOME: cwd, SOULS_HOME: '', EDEN_GOD_SEAT: '', SOULS_PRINCIPAL: '', EDEN_GOD_WARM: '0', EDEN_GOD_WIRE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
  child.on('exit', (code) => { let d = null; try { d = JSON.parse(out); } catch { /* words */ } resolve({ code, d, out, err }); });
});

test('A1 A3 A5: two god seats beside two Souls, each principal reading only its own side', async (t) => {
  const base = await worlds(t), dir = folder(t), soul = runner(dir, eden), godCli = runner(dir, god);
  await soul('register', `${base}/a`); await soul('create', 'Mira'); await soul('register', `${base}/b`); await soul('create', 'Ivo');
  assert.ok(!existsSync(join(dir, '.souls/gods')), 'A5: no seat, no gods directory');
  assert.equal((await godCli('register', `${base}/a`, 'dev:owner')).code, 0);
  const a = await godCli('a', 'mint'); assert.equal(a.code, 0, a.err);
  assert.equal((await godCli('status')).code, 0, 'one seat needs no selector');
  await godCli('register', `${base}/b`, 'dev:owner'); await godCli('b', 'mint');
  assert.match((await godCli('status')).err, /Several god seats here: a, b/);
  assert.match((await godCli('a', 'status')).out, /god|world/);
  const seatFile = JSON.parse(readFileSync(join(dir, '.souls/gods/a/.eden-god.json'), 'utf8'));
  assert.equal(seatFile.token, undefined); assert.equal(seatFile.identity, undefined);
  const creds = JSON.parse(readFileSync(join(dir, '.souls/credentials.json'), 'utf8'));
  assert.deepEqual(creds.gods, { a: { identity: 'dev:owner', token: 'god_a_tok' }, b: { identity: 'dev:owner', token: 'god_b_tok' } });
  assert.ok(!existsSync(join(dir, '.eden-god.json')), 'nothing in the folder itself');
  const list = await soul('list');
  assert.deepEqual(list.d.gods, [{ world: 'a', paired: true }, { world: 'b', paired: true }]);
  assert.deepEqual(list.d.souls.map((s) => s.name), ['Mira', 'Ivo']);
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /Ivo in b/);
  await soul('guide');
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /God of a: `node eden-god\.mjs a status`/);
  // A3: with the other side unreadable each principal still works
  chmodSync(join(dir, '.souls/souls'), 0o000);
  assert.equal((await godCli('a', 'status')).code, 0, 'a god reads nothing under souls/');
  chmodSync(join(dir, '.souls/souls'), 0o700); chmodSync(join(dir, '.souls/gods'), 0o000);
  assert.equal((await soul('mira', 'here')).d.me.name, 'Mira', 'a Soul reads nothing under gods/');
  chmodSync(join(dir, '.souls/gods'), 0o700);
});

test('A2: a legacy god folder works unchanged, a home does not capture it, and import reuses the token', async (t) => {
  const base = await worlds(t), dir = folder(t), godCli = runner(dir, god), soul = runner(dir, eden);
  await godCli('register', `${base}/a`, 'dev:owner'); await godCli('mint');
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('.souls')), [], 'no home appears on its own');
  const file = join(dir, '.eden-god.json'), before = readFileSync(file, 'utf8');
  assert.equal(JSON.parse(before).token, 'god_a_tok');
  writeFileSync(join(dir, '.eden-god.cache.json'), '{"held":1}');
  await soul('register', `${base}/a`); await soul('create', 'Mira');
  assert.equal((await godCli('status')).code, 0, 'a home beside the file does not lose the god');
  assert.ok(!existsSync(join(dir, '.souls/gods')));
  const r = await soul('import');
  assert.equal(r.d.god.imported, true, r.err); assert.equal(r.d.god.reusedToken, true);
  assert.equal(readFileSync(file, 'utf8'), before, 'left in place');
  assert.equal(readFileSync(join(dir, '.souls/gods/a/.eden-god.cache.json'), 'utf8'), '{"held":1}');
  assert.equal(JSON.parse(readFileSync(join(dir, '.souls/credentials.json'), 'utf8')).gods.a.token, 'god_a_tok');
  rmSync(file);
  assert.equal((await godCli('status')).code, 0, 'the seat works once the file is gone');
  assert.equal((await soul('import')).code, 1, 'nothing left to import');
});
