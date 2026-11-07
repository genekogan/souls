import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const backlog = [1, 2].map(n => ({ id: `synthetic-recovery-${n}`, text: `Queued command ${n}.`, state: 'delivered', sentAt: n }));
function dropAnswer(res, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': '1000' });
  res.write('{"inbox":');
  setTimeout(() => res.destroy(), 20);
}
async function fixture(t, respond) {
  const dir = mkdtempSync(join(tmpdir(), 'souls-listen-recovery-')), paths = [];
  const server = createServer((req, res) => { paths.push([req.method, req.url]); respond(req, res, paths.length); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}`, soul: 'synthetic', token: 'synthetic-recovery-token' }), { mode: 0o600 });
  const children = [];
  t.after(() => { for (const child of children) child.kill(); server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    paths,
    run: async (...args) => {
      const child = spawn(process.execPath, [cli, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const exit = await new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
      return { ...exit, stdout, stderr };
    },
  };
}

test('thin Soul listen survives a lost JSON answer, preserves its cursor and receives queued commands once', { timeout: 8_000 }, async t => {
  const f = await fixture(t, (_req, res, n) => {
    if (n === 1) return dropAnswer(res);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ inbox: { latest: backlog[0] }, backlog }));
  });
  const got = await f.run('listen', '--after', 'synthetic-previous');
  assert.equal(got.code, 0, `listen should reconnect instead of exiting: ${JSON.stringify({ ...got, paths: f.paths })}`);
  assert.deepEqual(JSON.parse(got.stdout).messages, backlog.map(({ id, text, sentAt }) => ({ id, text, sentAt })));
  assert.deepEqual(f.paths, Array(2).fill(['GET', '/v1/edge/inbox/listen?timeoutMs=50000&after=synthetic-previous']), 'receiving must never acknowledge or execute a command');
});

for (const [status, code] of [[401, 'control.revoked'], [403, 'forbidden'], [409, 'superseded']]) {
  for (const truncated of [false, true]) {
    test(`thin Soul listen ends on ${truncated ? 'truncated' : 'complete'} terminal ${status} ${code} without retrying`, { timeout: 3_000 }, async t => {
      const f = await fixture(t, (_req, res) => {
        if (truncated) return dropAnswer(res, status);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code, message: 'Synthetic final refusal.' }));
      });
      const got = await f.run('listen');
      assert.equal(got.code, 1);
      assert.equal(f.paths.length, 1);
      assert.equal(got.stdout, '');
      assert.match(got.stderr, truncated ? /terminated/ : new RegExp(code));
    });
  }
}

test('thin Soul listen --once retains its one-shot failed-body behavior', { timeout: 3_000 }, async t => {
  const f = await fixture(t, (_req, res) => dropAnswer(res));
  const got = await f.run('listen', '--once');
  assert.equal(got.code, 1);
  assert.deepEqual(f.paths, [['GET', '/v1/edge/inbox/listen?timeoutMs=0']]);
  assert.match(got.stderr, /terminated/);
});

test('thin Soul ack never replays a POST whose answer is lost', { timeout: 3_000 }, async t => {
  const f = await fixture(t, (req, res) => { req.resume(); req.on('end', () => dropAnswer(res)); });
  const got = await f.run('ack', 'synthetic-recovery-1', 'Received.');
  assert.equal(got.code, 1);
  assert.deepEqual(f.paths, [['POST', '/v1/edge/inbox/synthetic-recovery-1/ack']]);
  assert.equal(got.stdout, '');
  assert.match(got.stderr, /terminated/);
});
