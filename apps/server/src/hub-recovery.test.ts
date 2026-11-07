// #1221: a recovery gives every open page the picture again where it is. It used to close each socket and change the
// epoch, and a new epoch makes a page tear down its whole view (LiveWorld keys its scene on it): 12 to 16 s of still picture,
// and whoever it was following lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { PROTO } from '@souls/protocol';
import { marsFactory, EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Hub } from './hub.ts';

type Frame = { t: string; reason?: string; epoch?: string; seq?: number };
async function join(port: number, hello: Record<string, unknown> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), frames: Frame[] = [], closes: number[] = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* a binary frame */ } }); ws.on('close', (code) => closes.push(code));
  await once(ws, 'open'); ws.send(JSON.stringify({ t: 'hello', proto: PROTO, ...hello }));
  return { ws, frames, closes };
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(ok()); };

test('a recovery keeps the socket and the epoch, sends the picture again, and nothing from before it resumes', async (t) => {
  const db = new Db(':memory:'), host = new WorldHost(db, await marsFactory(EDEN_COMMONS_WORLD), 'hub-recovery', 1e9, 'hub-recovery'); host.boot(); host.drainInputs();
  const cfg = { ...config, worldId: host.worldId, worldKey: 'eden', brainMode: 'fake' as const, budgetUsdPerDay: 0, publicUrl: 'http://127.0.0.1:0' };
  const server = createServer((_req, res) => { res.statusCode = 404; res.end(); }), hub = new Hub(server, host, new Auth(cfg, db), db);
  hub.brain = { camera: null, ticker: [], narratives: new Map(), inflight: new Map(), mode: 'fake', callsToday: 0 } as never;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const port = (server.address() as { port: number }).port;
  t.after(async () => { await hub.closeClients('stopping'); server.close(); host.stop(); db.close(); });
  const page = await join(port); await until(() => page.frames.some((m) => m.t === 'snapshot'));
  const epoch = page.frames.find((m) => m.t === 'welcome')!.epoch, seen = host.currentBatchSeq;

  for (const l of host.listeners) l.onApplied?.({ seq: 1, tick: 0, kind: 'rules', author: 'world:recovery', payload: { recovery: {} }, at: 0 } as never);
  await until(() => page.frames.some((m) => m.t === 'snapshot' && m.reason === 'world restored'));
  assert.deepEqual(page.closes, [], 'the socket stays open'); assert.equal(page.ws.readyState, WebSocket.OPEN);

  // a page that was away across it comes back with the same epoch, and must not resume over what changed
  for (let i = 0; i < 40; i++) host.tickOnce();
  const back = await join(port, { since: seen, epoch });
  await until(() => back.frames.some((m) => m.t === 'welcome')); assert.equal(back.frames.find((m) => m.t === 'welcome')!.epoch, epoch, 'the epoch is the same');
  await until(() => back.frames.some((m) => m.t === 'snapshot'));
  page.ws.terminate(); back.ws.terminate();
});
