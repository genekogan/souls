// #1017: the answers main.ts writes itself, not through Hono (/mcp, and an Eden core world's 503 "Server restarting."),
// carry the same security headers as every buildApp answer. One actual main process, fake minds, its own DATA_DIR.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {request} from 'node:http';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {SECURITY_HEADERS, secureNodeResponse} from './http.ts';
import {createServer} from 'node:http';
import {fixture, invite} from '../test/native-owner-fixture.ts';
import {handleMcp} from './mcp.ts';
import {marsFactory, GREEN_FIELD_WORLD} from '@sim/engine-mars';

const port = 4953, base = `http://127.0.0.1:${port}/w/eden`;
const secure = (h: Headers, why: string) => { for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(h.get(name), value, `${why}: ${name}`); };

test('/mcp answers and the restart 503 from an actual main process carry the security headers', async t => {
  const root = join(new URL('../../../', import.meta.url).pathname, '.local/test'); mkdirSync(root, {recursive: true});
  const data = mkdtempSync(join(root, 'main-node-headers-')), logs: string[] = [];
  const env: NodeJS.ProcessEnv = {PATH: process.env.PATH, DATA_DIR: data, WORLD_KEY: 'eden', WORLD_ID: 'main-node-headers-1', WORLD_PATH: '/w/eden', ENGINE: 'mars', ENABLE_EDEN_CORE: '1', ENABLE_LIVING_WORLD: '1', SEED_NATIVES: '0', DEV_AUTH: '1', WORLD_OWNER_ID: 'dev:admin', BRAIN_MODE: 'fake', BRAIN_BUDGET_USD_PER_DAY: '0', ARCHIVE_TAKES: '0', PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: base, BUILD_ID: 'synthetic-main-node-headers', WRITE_DRAIN_MS: '15000'};
  const child: ChildProcess = spawn(process.execPath, [new URL('./main.ts', import.meta.url).pathname], {cwd: new URL('../../../', import.meta.url), env, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout!.on('data', d => logs.push(String(d))); child.stderr!.on('data', d => logs.push(String(d)));
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGKILL'); for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(20); } rmSync(data, {recursive: true, force: true}); });
  for (let i = 0; ; i++) {
    if (child.exitCode !== null || i > 600) throw Error('main did not become healthy: ' + logs.join('').slice(-2000));
    try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* not listening yet */ }
    await delay(100);
  }

  // M1: /mcp is served by handleMcp on the Node request, never by Hono. An unauthenticated GET and POST both answer.
  for (const init of [{method: 'GET'}, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})}]) {
    const r = await fetch(base + '/mcp', init); await r.arrayBuffer();
    secure(r.headers, `${init.method} /mcp (${r.status})`);
  }

  // M2: hold one write in flight, so the stopping world keeps its port open while it drains (WRITE_DRAIN_MS), and a
  // request in that window gets the restart answer. The write is a chunked body, which buildApp's early body ceiling
  // reads in full before anything answers, so it stays in flight until the test ends it. main.ts counts it once its
  // headers arrive: the socket connects, then a short wait. If that wait were too short, shutdown would close the port
  // at once and the test fails on the missing restart answer, never passes silently.
  const held = request({host: '127.0.0.1', port, method: 'POST', path: '/w/eden/v1/no-such-route', headers: {'content-type': 'application/json', 'transfer-encoding': 'chunked'}});
  held.on('error', () => {}); held.on('response', r => r.resume());
  await new Promise<void>(resolve => held.once('socket', s => s.once('connect', () => resolve())));
  held.write('{"held":');
  await delay(500);
  child.kill('SIGTERM');
  let restart: Response | undefined;
  for (let i = 0; i < 100 && !restart; i++) { await delay(50); const r = await fetch(base + '/healthz').catch(() => undefined); if (r?.status === 503 && (await r.clone().text()) === 'Server restarting.') restart = r; else await r?.arrayBuffer(); }
  assert.ok(restart, 'a request during the drain got the restart answer: ' + logs.join('').slice(-1500));
  assert.equal(restart.headers.get('cache-control'), 'no-store');
  secure(restart.headers, 'the restart 503');
  held.end('1}');
  for (let i = 0; i < 400 && child.exitCode === null; i++) await delay(50);
  assert.equal(child.exitCode, 0, 'the world stops in order once the held write is answered');
});

// The process test above reaches handleMcp only up to its 401. This one goes through the MCP SDK transport (an
// authenticated tools/list) and through a handler error answered as main.ts does: headers set with setHeader before
// the transport's writeHead survive it.
test('headers set before handleMcp survive the SDK transport answer and the error answer', async t => {
  const f = fixture(':memory:', await marsFactory({...GREEN_FIELD_WORLD, safeCrewRemoval: true})); f.souls.enableLifecycle(); await invite(f, 'alice');
  const op = f.souls.acceptLifecycleCreate('dev:alice', {name: 'Alice', description: 'header fixture'}); f.host.drainInputs(); await delay(0);
  const soul = f.db.soul(op.scope.soulId)!, token = f.souls.pairExchange(f.souls.pairCode(soul, 'http://127.0.0.1', f.db.user('dev:alice')!).code, 'local').token;
  let fail = false;
  const server = createServer((req, res) => { res.setHeader('Connection', 'close'); secureNodeResponse(res);
    (fail ? Promise.reject(new Error('test: handler error')) : handleMcp(req, res, f.souls)).catch(() => { if (!res.headersSent) res.writeHead(500).end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); f.host.stop(); f.db.close(); });
  const url = `http://127.0.0.1:${(server.address() as {port: number}).port}/mcp`;
  const r = await fetch(url, {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})});
  assert.equal(r.status, 200); assert.ok(((await r.json()) as {result: {tools: unknown[]}}).result.tools.length > 0, 'the SDK transport answered');
  secure(r.headers, 'tools/list through the SDK transport'); assert.equal(r.headers.get('cache-control'), 'no-store');
  fail = true;
  const e = await fetch(url, {method: 'POST', body: '{}'}); await e.arrayBuffer();
  assert.equal(e.status, 500); secure(e.headers, 'the handler-error 500');
});
