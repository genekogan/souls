// srv-hub-physics item 1: a tick's broadcasts serialise once per message and reach each viewer as one socket write, in order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { marsFactory, EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { PROTO } from '@souls/protocol';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Hub } from './hub.ts';

test('20 viewers x 50 broadcasts in one turn: 50 serialisations, one socket write per viewer, wire order kept', async (t) => {
  const db = new Db(':memory:'); const factory = await marsFactory(EDEN_COMMONS_WORLD);
  const host = new WorldHost(db, factory, 'hub-coalesce', 1e9, 'hub-coalesce'); host.boot(); host.drainInputs();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, publicUrl: 'http://127.0.0.1:0' };
  const server = createServer((_q, s) => { s.statusCode = 404; s.end(); });
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  const capture = t.mock.method(globalThis, 'setInterval', (...a: Parameters<typeof setInterval>) => { const x = interval(...a); timers.push(x); return x; });
  const hub = new Hub(server, host, new Auth(cfg, db), db); capture.mock.restore();
  hub.brain = { camera: null, ticker: [], narratives: new Map(), inflight: new Map(), mode: 'fake', callsToday: 0 } as never;
  const sockets: WebSocket[] = [];
  t.after(() => { for (const x of timers) clearInterval(x); for (const s of sockets) s.terminate(); hub.wss.close(); server.close(); db.close(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const N = 20, K = 50, got: number[][] = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws); await once(ws, 'open');
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'edge' && m.burst) got[i]!.push(m.n); });
    ws.send(JSON.stringify({ t: 'hello', proto: PROTO }));
  }
  while ([...hub.clients].filter((c) => c.ready).length < N) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 100));
  let flushes = 0;
  for (const c of hub.clients) {
    const sock = (c.ws as unknown as { _socket: Record<string, (...a: unknown[]) => unknown> })._socket;
    for (const k of ['_write', '_writev']) { const f = sock[k]!; sock[k] = function (this: unknown, ...a: unknown[]) { flushes++; return f.apply(this, a); }; }
  }
  const real = JSON.stringify; let strings = 0;
  t.mock.method(JSON, 'stringify', (...a: Parameters<typeof JSON.stringify>) => { strings++; return real(...a); });
  for (let n = 0; n < K; n++) hub.broadcast({ t: 'edge', kind: 'speech', burst: true, n, text: `line ${n}` } as never);
  const serialised = strings;
  (JSON.stringify as unknown as { mock: { restore(): void } }).mock.restore();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(serialised, K, 'one serialisation per message, not per viewer');
  assert.equal(flushes, N, 'one socket write per viewer for the whole turn');
  const end = Date.now() + 5000; while (got.some((g) => g.length < K) && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  for (const g of got) assert.deepEqual(g, Array.from({ length: K }, (_, n) => n), 'every viewer got every frame, in order');
  // the next turn writes again (the cork is released)
  flushes = 0; hub.broadcast({ t: 'edge', kind: 'speech', burst: true, n: K, text: 'again' } as never);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(flushes, N);
});
