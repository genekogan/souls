import test from 'node:test';
import assert from 'node:assert/strict';
import type { Engine, EngineFactory } from '@sim/engine-contract';
import { marsFactory, GREEN_FIELD_WORLD } from '@sim/engine-mars';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { WebSocket } from 'ws';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { Souls } from './souls.ts';
import { Hub } from './hub.ts';
import { buildApp } from './http.ts';

// #1120: a fault that edge recovery cannot repair halts the world. The halted host may be half-replayed (its seq behind the
// log, its state matching no logged prefix), so nothing durable is written from it afterwards: ticks, drains and snapshots
// refuse, naming the fault, and the log and the clock frontier stay as they were. Only the adapter's step is faulted.
const native = await marsFactory(GREEN_FIELD_WORLD);
const worldId = 'halt-clock', seed = 'halt-clock';

function fixture() {
  const control = { fault: null as Error | null };
  const wrap = (engine: Engine) => {
    const step = engine.step.bind(engine);
    engine.step = () => { const fault = control.fault; control.fault = null; if (fault) throw fault; return step(); };
    engine.canSnapshot = () => false;   // no recovery baseline: the fault cannot be repaired, as when the replay faults again
    return engine;
  };
  const factory: EngineFactory = { ...native, create: (w) => wrap(native.create(w)), restore: (s) => wrap(native.restore(s)) };
  const db = new Db(':memory:'), host = new WorldHost(db, factory, seed, 1e9, worldId, { durableClockV1: true });
  host.boot(); host.drainInputs(); host.recoveryForEdge = true;
  return { db, host, control };
}
const frontierRow = (db: Db) => db.db.prepare('SELECT body FROM clock_frontiers_v1 WHERE world_id=?').get(worldId) as { body: string } | undefined;

test('#1120: a halted host refuses every later tick, drain and snapshot, naming the fault; the log and the frontier are unchanged', async (t) => {
  const { db, host, control } = fixture();
  t.after(() => { host.stop(); db.close(); });
  t.mock.method(console, 'error', () => {});
  let unavailable = 0;
  host.listeners.push({ onClockUnavailable: () => { unavailable++; } });
  host.tickOnce(); host.tickOnce();
  control.fault = new Error('fixture.unrepairable');
  host.tickOnce();
  assert.equal(host.paused, true);
  assert.match(host.engineFault!, /fixture\.unrepairable/);
  assert.equal(unavailable, 1, 'listeners (the hub) hear once that the world is unavailable, as for the other clock failures');
  const seq = db.lastSeq(worldId), frontier = frontierRow(db)?.body, tick = host.engine.world.tick;
  for (const [name, run] of [['enqueue', () => host.enqueue('admin', 'test', { action: 'note' })], ['tickOnce', () => host.tickOnce()], ['drainInputs', () => host.drainInputs()], ['saveSnapshot', () => host.saveSnapshot(true)], ['resume', () => host.setPaused(false, 'admin')]] as const) {
    assert.throws(run, (e: Error) => e.message === 'clock-frontier.unavailable' && /engine\.halted: .*fixture\.unrepairable/.test(String((e.cause as Error)?.message)), name);
  }
  assert.equal(host.clockAvailable, false);
  assert.equal(db.lastSeq(worldId), seq, 'nothing appended to the log');
  assert.equal(frontierRow(db)?.body, frontier, 'the clock frontier is the one from before the fault');
  assert.equal(host.engine.world.tick, tick);
  assert.equal(host.paused, true, 'a refused resume leaves it paused');
});

test('#1120: after an engine halt the world answers 503 world-unavailable and closes viewer sockets, as other clock failures already do', async (t) => {
  const { db, host, control } = fixture();
  t.mock.method(console, 'error', () => {});
  const cfg = { ...config, worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined, privyAppId: '', privyAppSecret: '', publicUrl: 'http://127.0.0.1' };
  const auth = new Auth(cfg, db), brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} });
  const souls = new Souls(host, db, brain, cfg); let app!: ReturnType<typeof buildApp>;
  const server = createServer((req, res) => getRequestListener(app.fetch)(req, res));
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  const capture = t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  const hub = new Hub(server, host, auth, db); capture.mock.restore(); hub.brain = brain;
  app = buildApp({ cfg, db, host, auth, hub, brain, souls });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ws = new WebSocket(`ws://${base}/ws`);
  t.after(async () => { host.stop(); for (const timer of timers) clearInterval(timer); ws.terminate(); hub.wss.close(); await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); });
  await once(ws, 'open');
  const greeting = once(ws, 'message', { signal: AbortSignal.timeout(2000) }); ws.send(JSON.stringify({ t: 'hello', proto: 1 })); await greeting;
  host.tickOnce(); host.tickOnce();
  assert.equal((await fetch(`http://${base}/healthz`)).status, 200, 'served before the halt');
  const closed = once(ws, 'close', { signal: AbortSignal.timeout(2000) });
  control.fault = new Error('fixture.unrepairable');
  host.tickOnce();
  assert.equal(host.clockAvailable, false);
  const [code, reason] = await closed;
  assert.deepEqual([code, String(reason)], [1013, 'world unavailable'], 'the viewer socket is closed as for other clock failures');
  const response = await fetch(`http://${base}/healthz`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: 'world-unavailable', message: 'World temporarily unavailable.' });
});
