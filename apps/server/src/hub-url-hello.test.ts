// P7: the page's entry socket says its anonymous hello in the upgrade URL (/ws?hello=…), so the join leaves as soon as the
// socket is open instead of waiting for the page's busy main thread. A URL hello never carries a token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { marsFactory, EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { anonymousHello } from '../../../packages/client/src/hello.ts';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { Hub, urlHello } from './hub.ts';

test('urlHello reads the hello query parameter only', () => {
  assert.equal(urlHello('/ws'), null);
  assert.equal(urlHello(undefined), null);
  assert.equal(urlHello('/ws?hello=' + encodeURIComponent('{"t":"hello"}')), '{"t":"hello"}');
  assert.equal(urlHello('/ws?x=1'), null);
  assert.equal(urlHello('/ws?hello=' + 'a'.repeat(3000)), null, 'at most 2 KB');
});

test('a hello in the socket URL joins without a message; one with a token, or not a hello, is ignored', async (t) => {
  const db = new Db(':memory:'); const factory = await marsFactory(EDEN_COMMONS_WORLD);
  const host = new WorldHost(db, factory, 'url-hello', 1e9, 'url-hello'); host.boot(); host.drainInputs();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, publicUrl: 'http://127.0.0.1:0' };
  const server = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  const capture = t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  const hub = new Hub(server, host, new Auth(cfg, db), db); capture.mock.restore();
  hub.brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const timer of timers) clearInterval(timer); for (const ws of sockets) ws.terminate(); hub.wss.close(); await new Promise<void>((r) => server.close(() => r())); db.close(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const connect = async (query: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`); sockets.push(ws);
    const types: string[] = []; ws.on('message', (b) => types.push(JSON.parse(String(b)).t));
    await once(ws, 'open'); await sleep(300); return types;
  };
  const joined = await connect('?hello=' + encodeURIComponent(anonymousHello(true)));
  assert.equal(joined[0], 'welcome'); assert.ok(joined.includes('snapshot'), joined.join(','));
  const withToken = JSON.stringify({ ...JSON.parse(anonymousHello(true)), token: 'dev:someone' });
  assert.deepEqual(await connect('?hello=' + encodeURIComponent(withToken)), [], 'a token never rides in a URL');
  assert.deepEqual(await connect('?hello=' + encodeURIComponent('{"t":"resync","reason":"x"}')), [], 'only a hello');
  assert.deepEqual(await connect(''), [], 'no hello, no join (as before)');
});
