// Lane P5: a visitor's join set goes out before the world's next frame. The hub counts each client's unwritten join
// messages and holds the world clock (at most 750 ms after the hello); a held frame's wall time is caught up by the next
// one, so the same ticks run, only later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { marsFactory, EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { Hub } from './hub.ts';

test('a held clock skips frames and catches their wall time up afterwards', async (t) => {
  const run = async (holdMs: number) => {
    const db = new Db(':memory:'); const factory = await marsFactory(EDEN_COMMONS_WORLD);
    const host = new WorldHost(db, factory, 'join-hold', 1e9, 'join-hold'); host.boot(); host.drainInputs();
    const t0 = performance.now(); host.holdClock = () => performance.now() - t0 < holdMs;
    const tick0 = host.engine.world.tick;
    host.start();
    await sleep(holdMs ? holdMs - 100 : 0);
    const held = host.engine.world.tick - tick0;
    await sleep(holdMs ? 500 : 900);
    host.stop(); db.close();
    return { held, total: host.engine.world.tick - tick0 };
  };
  const held = await run(400), free = await run(0);
  assert.equal(held.held, 0, 'no tick while held');
  // ~900 ms of wall time either way: the held run's ticks are late, not lost (loose bound for a loaded machine)
  assert.ok(held.total >= free.total * 0.7, `held ${held.total} vs free ${free.total} ticks`);
  t.diagnostic(`ticks over ~900 ms: held 400 ms -> ${held.total}, free -> ${free.total}`);
});

test('the hub holds the clock only while a join set is unwritten', async (t) => {
  const db = new Db(':memory:'); const factory = await marsFactory(EDEN_COMMONS_WORLD);
  const host = new WorldHost(db, factory, 'join-hold-hub', 1e9, 'join-hold-hub'); host.boot(); host.drainInputs();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, publicUrl: 'http://127.0.0.1:0' };
  const server = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  const capture = t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  const hub = new Hub(server, host, new Auth(cfg, db), db); capture.mock.restore();
  hub.brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const timer of timers) clearInterval(timer); for (const ws of sockets) ws.terminate(); hub.wss.close(); await new Promise<void>((r) => server.close(() => r())); db.close(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  assert.equal(typeof host.holdClock, 'function');
  assert.equal(host.holdClock!(), false, 'no client, no hold');

  // every write of the join set reports back while the clock holds; once it is out the clock runs
  const holds: boolean[] = [];
  const clients = (hub as unknown as { clients: Set<{ ws: { send: (s: string, cb?: (e?: Error) => void) => void } }> }).clients;
  const port = (server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws);
  const types: string[] = []; ws.on('message', (b) => types.push(JSON.parse(String(b)).t));
  await once(ws, 'open');
  for (const c of clients) { const send = c.ws.send.bind(c.ws); c.ws.send = (s, cb) => send(s, (e) => { holds.push(host.holdClock!()); cb?.(e); }); }
  ws.send(JSON.stringify({ t: 'hello', proto: 1 }));
  for (let i = 0; i < 100 && !types.includes('takes'); i++) await sleep(20);
  assert.ok(types.includes('snapshot') && types.includes('takes'), `join set arrived: ${types.join(',')}`);
  assert.ok(holds.length >= 2 && holds.slice(0, -1).every(Boolean), `held until the last join message was written: ${holds.join(',')}`);
  assert.equal(host.holdClock!(), false, 'join set out: the clock runs');

  // joiners that never finish (slow, or one after another) hold at most 750 ms, then the clock runs for 2 s regardless
  const stuck = { joinPending: 1, lastHello: Date.now(), ws: { readyState: 1 } };
  (clients as unknown as Set<unknown>).add(stuck);
  const t0 = Date.now(); let releasedAt = 0;
  while (Date.now() - t0 < 1500) { stuck.lastHello = Date.now(); if (!host.holdClock!()) { releasedAt = Date.now() - t0; break; } await sleep(10); }
  assert.ok(releasedAt >= 700 && releasedAt < 1200, `one hold ends after ~750 ms (${releasedAt})`);
  stuck.lastHello = Date.now(); assert.equal(host.holdClock!(), false, 'then a rest without holds');
  (clients as unknown as Set<unknown>).delete(stuck);
});
