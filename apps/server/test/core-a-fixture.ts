// Core-A test fixture (perception/1, intents/1, strict/1): the native Eden nav world with the real /v1/edge routes and
// Comms mounted on a Hono app; bearer = the Soul id (test only). Fake minds, no network, no model keys.
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {kernelHash} from '@souls/kernel';
import {edenNavWorld, factory} from './eden-nav-fixture.ts';
import {accept} from './native-owner-fixture.ts';
import {WorldHost} from '../src/world.ts';
import {mountEdgeRoutes} from '../src/edge/routes.ts';
import {EdgeError} from '../src/edge/contract.ts';

export async function coreAWorld(n: number) {
  const w = await edenNavWorld(n), app = new Hono();
  const byId = new Map(w.souls.map(s => [s.soulId, s]));
  const comms = mountEdgeRoutes(app, {host: w.f.host, db: w.f.db, souls: w.f.souls, ledger: w.ledger,
    soul: c => {const s = byId.get(c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''); if (!s) throw new EdgeError(401, 'unauthorized', 'test token'); return s;}});
  type S = typeof w.souls[number];
  const http = async (s: S, method: string, path: string, body?: unknown) => {
    const p = app.request(path, {method, headers: {authorization: `Bearer ${s.soulId}`, ...(body === undefined ? {} : {'content-type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    // acts await the logged decision: keep the world ticking while the request is in flight
    const res = await accept(w.f.host, p as Promise<Response>);
    return {status: res.status, body: await res.json() as any};
  };
  const body = (s: {entityId: string}) => (w.engine.world.entities as any)[s.entityId];
  const pos = (s: {entityId: string}) => [body(s).pose.p[0], body(s).pose.p[2]] as [number, number];
  /** Move an idle body to (about) a point: a logged edge-relocate, like a reclaim. */
  const put = async (s: S, to: [number, number]) => {await accept(w.f.host, w.f.host.enqueue('edge-relocate', 'test:put', {soulId: s.soulId, entityId: s.entityId, to}));};
  const ticks = async (n: number, until = () => false) => {for (let i = 0; i < n && !until(); i++) {w.f.host.tickOnce(); if (i % 20 === 0) {await new Promise(r => setImmediate(r)); w.f.host.drainInputs();}}};
  const receipt = (s: {soulId: string}, id: string) => w.ledger.receipt(s.soulId, id)!;
  const open = (s: {soulId: string}, id: string) => ['waiting', 'started'].includes(receipt(s, id).phase);
  const replayExact = async () => {
    w.f.host.drainInputs(); w.f.host.saveSnapshot(true); const head = {engine: w.f.host.engine.stateHash(), kernel: kernelHash(w.f.host.kernel)};
    w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.f.host.worldId);
    const h = new WorldHost(w.f.db, await factory(), w.f.host.seed, 1e9, w.f.host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
    assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, 'replay exact'); h.stop();
  };
  const close = () => {comms.close(); w.f.host.stop(); w.f.db.close();};
  return {...w, app, comms, http, body, pos, put, ticks, receipt, open, replayExact, close};
}
