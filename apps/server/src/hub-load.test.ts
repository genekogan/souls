// srv-load (audit #5): a stall never cuts the viewers (lag-aware heartbeat); at black new joins wait; viewers hear {t:'load'}.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { marsFactory, EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Hub } from './hub.ts';
import { Brain } from './brain.ts';
import { spawn } from 'node:child_process';

async function fixture(t: import('node:test').TestContext) {
  const db = new Db(':memory:'); const factory = await marsFactory(EDEN_COMMONS_WORLD);
  const host = new WorldHost(db, factory, 'hub-load', 1e9, 'hub-load'); host.boot(); host.drainInputs();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, publicUrl: 'http://127.0.0.1:0' };
  const server = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  const capture = t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  const hub = new Hub(server, host, new Auth(cfg, db), db); capture.mock.restore();
  hub.brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} });
  const sockets: WebSocket[] = [];
  t.after(() => { for (const timer of timers) clearInterval(timer); for (const s of sockets) s.terminate(); hub.wss.close(); if (server.listening) server.close(); db.close(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const open = async () => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws); await once(ws, 'open'); return ws; };
  // a viewer in another process: it answers pings while this process is stalled
  const remote = async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {WebSocket} from 'ws'; const ws = new WebSocket('ws://127.0.0.1:${port}/ws'); ws.on('open', () => console.log('OPEN')); setInterval(() => {}, 1000);`], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(() => child.kill('SIGKILL'));
    await once(child.stdout!, 'data'); return child;
  };
  return { hub, open, remote, sweep: () => (hub as unknown as { sweep(): void }).sweep(), setSweepAt: (ms: number) => { (hub as unknown as { sweepAt: number }).sweepAt = ms; } };
}

test('heartbeat: pongs that arrived during a stall are read before the verdict; a late sweep judges nobody', async (t) => {
  const f = await fixture(t);
  await f.remote(); while (f.hub.clients.size < 1) await new Promise((r) => setTimeout(r, 5));
  const c = [...f.hub.clients][0]!;
  // a ping goes out, then the main thread stalls while the pong arrives; the sweep runs right after the stall
  f.sweep(); await new Promise((r) => setImmediate(r));
  assert.equal(c.alive, false);
  const end = Date.now() + 1500; while (Date.now() < end) { /* the stall (long enough for the other process to answer) */ }
  f.sweep(); await new Promise((r) => setImmediate(r));
  assert.ok(f.hub.clients.has(c), 'the pong that came in during the stall counted');
  // a viewer whose pong really never came, seen by a sweep that ran 40 s late: kept one more round
  for (let i = 0; i < 300 && !c.alive; i++) await new Promise((r) => setTimeout(r, 10));   // the last real ping's pong is in
  c.alive = false; (c.ws as unknown as { ping: () => void }).ping = () => {};
  f.setSweepAt(Date.now() - 40_000); f.sweep(); await new Promise((r) => setImmediate(r));
  assert.ok(f.hub.clients.has(c), 'a late sweep judges nobody');
  // the next on-time sweep cuts it
  f.setSweepAt(Date.now() - 15_000); f.sweep(); await new Promise((r) => setImmediate(r));
  assert.ok(!f.hub.clients.has(c), 'an on-time sweep still cuts a dead viewer');
});

test('load dial: viewers hear {t:"load"}; at black a join waits, and goes out when the world recovers', async (t) => {
  const f = await fixture(t);
  const ws = await f.open(); const got: { t: string; level?: string }[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  f.hub.setLoadLevel('black');
  ws.send(JSON.stringify({ t: 'hello', proto: 1 }));
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(got.some((m) => m.t === 'load' && m.level === 'black'), 'told the world is busy');
  assert.ok(!got.some((m) => m.t === 'welcome' || m.t === 'snapshot'), 'no join while black');
  f.hub.setLoadLevel('green');
  const t0 = Date.now(); while (!got.some((m) => m.t === 'snapshot') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
  assert.ok(got.some((m) => m.t === 'snapshot'), 'joined after the world recovered');
});
