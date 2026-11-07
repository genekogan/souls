// MEM3: a world's stop never waits on a viewer. A peer that does not answer the 1001 close (a frozen or background tab, a
// phone asleep, a dead path behind the proxy) held server.close() and wss.close() for ws's 30 s close timeout, past the
// launcher's 10 s SIGKILL: legacy /w/eden at 3.53 and 3.57 stopped in 10 s with no stop snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { marsFactory, EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Hub, CLOSE_GRACE_MS } from './hub.ts';

/** A raw WebSocket client that completes the upgrade, then never answers anything (the close frame included). */
function mutePeer(port: number): Promise<{ closes: () => number; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1'); let head = '', up = false, closes = 0;
    socket.on('error', () => {});
    socket.on('connect', () => socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    socket.on('data', (d) => {
      if (!up) { head += d.toString('latin1'); if (!head.includes('\r\n\r\n')) return; if (!head.startsWith('HTTP/1.1 101')) return reject(Error(head)); up = true; resolve({ closes: () => closes, socket }); return; }
      if ((d[0]! & 15) === 8) closes++;   // the server's close frame: never answered
    });
  });
}

test('closeClients: a peer that never answers the close is cut after the grace; server.close() and wss.close() follow', async (t) => {
  const db = new Db(':memory:'); const factory = await marsFactory(EDEN_COMMONS_WORLD);
  const host = new WorldHost(db, factory, 'hub-close', 1e9, 'hub-close'); host.boot(); host.drainInputs();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, publicUrl: 'http://127.0.0.1:0' };
  const server = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  const capture = t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  const hub = new Hub(server, host, new Auth(cfg, db), db); capture.mock.restore();
  const peers: net.Socket[] = [];
  t.after(() => { for (const timer of timers) clearInterval(timer); for (const s of peers) s.destroy(); if (server.listening) server.close(); db.close(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const good = new WebSocket(`ws://127.0.0.1:${port}/ws`); await once(good, 'open');
  const goodClosed = once(good, 'close');
  const mute = await mutePeer(port); peers.push(mute.socket);
  // one the hub already dropped ('no hello' closes a socket and forgets it): still a socket holding the server
  const dropped = await mutePeer(port); peers.push(dropped.socket);
  while (hub.clients.size < 3) await new Promise((r) => setTimeout(r, 10));
  const forgotten = [...hub.clients][2]!;   // connection order: good, mute, dropped
  forgotten.ws.close(1008, 'no hello'); hub.clients.delete(forgotten);

  const t0 = performance.now();
  const viewersGone = hub.closeClients('stopping');
  const serverClosed = new Promise<void>((r) => server.close(() => r()));
  await Promise.race([Promise.all([viewersGone, serverClosed, new Promise<void>((r) => hub.wss.close(() => r()))]), new Promise((_, no) => setTimeout(() => no(Error('stop still waiting on a viewer after 5 s')), 5000))]);
  const ms = performance.now() - t0;
  assert.ok(ms >= CLOSE_GRACE_MS - 20 && ms < CLOSE_GRACE_MS + 1000, `stopped in ${Math.round(ms)} ms (grace ${CLOSE_GRACE_MS})`);
  const [code] = await goodClosed as [number];
  assert.equal(code, 1001, 'an answering viewer still gets the 1001 close (fast reconnect)');
  assert.equal(mute.closes(), 1, 'the mute peer was sent the close before it was cut');
  assert.equal(hub.wss.clients.size, 0);
});

test('closeClients with only answering viewers resolves without waiting for the grace', async (t) => {
  const db = new Db(':memory:'); const factory = await marsFactory(EDEN_COMMONS_WORLD);
  const host = new WorldHost(db, factory, 'hub-close-2', 1e9, 'hub-close-2'); host.boot(); host.drainInputs();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, publicUrl: 'http://127.0.0.1:0' };
  const server = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  const capture = t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  const hub = new Hub(server, host, new Auth(cfg, db), db); capture.mock.restore();
  t.after(() => { for (const timer of timers) clearInterval(timer); if (server.listening) server.close(); db.close(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const sockets = await Promise.all([0, 1, 2].map(async () => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); await once(ws, 'open'); return ws; }));
  const codes = sockets.map((ws) => once(ws, 'close'));
  const t0 = performance.now(); await hub.closeClients('stopping', 5000); const ms = performance.now() - t0;
  assert.ok(ms < 1000, `answering viewers closed in ${Math.round(ms)} ms`);
  assert.deepEqual((await Promise.all(codes)).map(([c]) => c), [1001, 1001, 1001]);
  assert.equal(await hub.closeClients('again'), undefined, 'nothing open: resolves at once');
});

test('every world stop path closes its viewers through closeClients, never a bare 1001 loop', () => {
  for (const f of ['../../../tools/core/edge-server.mjs', '../../../tools/core/multiworld/world-server.mjs', '../../../tools/core/local-eden-expanded.mjs', './main.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(src.includes('hub.closeClients('), `${f} stops through hub.closeClients`);
    assert.ok(!/c\.ws\.close\(1001/.test(src), `${f}: no bare 1001 loop`);
  }
});
