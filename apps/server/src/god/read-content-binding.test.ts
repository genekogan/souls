import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from 'hono';
import {coreRef} from '@souls/world-compiler';
import {fixture, invite, accept, factory, seed} from '../../test/native-owner-fixture.ts';
import {WorldHost} from '../world.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../edge/routes.ts';
import {EdgeError, type EdgeReceipt} from '../edge/contract.ts';
import type {OutcomeSnapshot} from '../edge/outcomes/store.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {NEW_WORLD_LORE} from './world-lore.ts';

async function setup(t: TestContext, constitution: string, furniture = true) {
  const f = fixture(':memory:', factory, {durableClockV1: true});
  f.brain.quiesce();
  let host = f.host;
  const hosts = [host], closers: (() => void)[] = [];
  t.after(() => {for (const close of closers) close(); for (const h of hosts) h.stop(); f.brain.quiesce(); f.db.close();});
  const mode = () => new GodMode(f.db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit: () => {}});
  let god = mode(), edge = new EdgeLedger(host, f.db);
  let bridge = installEngineBridge({host, god, edge, log: () => {}, worldLore: true});
  const settle = async (n = 3) => {for (let i = 0; i < n; i++) {host.tickOnce(); await setImmediate(); host.drainInputs();}};
  const ready = async () => {
    for (let i = 0; i < 200 && !bridge.contextReady(); i++) await settle(1);
    assert.equal(bridge.contextReady(), true, 'native geometry and place projection is published');
  };
  await settle();
  const placed = god.act({ops: [
    {op: 'world', state: {constitution}},
    {op: 'place', def: coreRef('sign'), name: 'reading-sign', p: [2, 2], state: {text: 'These are the sign’s own words.'}},
    ...(furniture ? [
      {op: 'place', def: coreRef('bookcase'), name: 'books', p: [0, 12]},
      {op: 'place', def: coreRef('armchair'), name: 'reading-chair', p: [1.5, 15], r: Math.PI},
    ] : []),
  ]});
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  await ready();
  await invite(f, 'reader');
  const row = await accept(host, f.souls.create('dev:reader', {name: 'Reader', description: 'native read-content fixture'}));
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  await ready();
  const sign = god.model.get('reading-sign')!.id, chair = furniture ? god.model.get('reading-chair')!.id : null;
  let app: Hono, closeComms: () => void;
  const mount = () => {
    app = new Hono();
    const comms = mountEdgeRoutes(app, {host, db: f.db, souls: f.souls, ledger: edge, soul: c => {
      if (c.req.header('authorization') !== `Bearer ${soul.soulId}`) throw new EdgeError(401, 'unauthorized', 'owned fixture only');
      return soul;
    }});
    closeComms = () => comms.close(); closers.push(closeComms);
  };
  mount();
  const http = async (path: string, body?: unknown) => {
    const response = await accept(host, Promise.resolve(app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {authorization: `Bearer ${soul.soulId}`, ...(body === undefined ? {} : {'content-type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})})));
    assert.equal(response.status, 200);
    return await response.json() as {accepted?: boolean; receipt: EdgeReceipt};
  };
  const act = async (capability: string, params: Record<string, unknown> = {}) => {
    const out = await http('/v1/edge/act', {capability, params});
    assert.equal(out.accepted, true, JSON.stringify(out)); return out.receipt;
  };
  const body = () => host.engine.world.entities[soul.entityId];
  const until = async (condition: () => boolean, max = 4000) => {
    for (let i = 0; i < max && !condition(); i++) {host.tickOnce(); if (i % 20 === 0) {await setImmediate(); host.drainInputs();}}
    assert.equal(condition(), true, 'bounded native condition');
  };
  const done = async (receipt: EdgeReceipt) => {
    await until(() => !['waiting', 'started'].includes(edge.receipt(soul.soulId, receipt.id)!.phase));
    const r = edge.receipt(soul.soulId, receipt.id)!;
    assert.equal(r.phase, 'completed', JSON.stringify(r)); assert.ok(r.outcome); return r;
  };
  const restart = async () => {
    closeComms(); host.drainInputs(); host.saveSnapshot(true); host.stop();
    host = new WorldHost(f.db, factory, seed, 1e9, f.host.worldId, {durableClockV1: true}); hosts.push(host);
    assert.equal(host.boot().from, 'snapshot');
    god = mode(); edge = new EdgeLedger(host, f.db);
    bridge = installEngineBridge({host, god, edge, log: () => {}, worldLore: true}); mount(); await ready();
  };
  return {f, soul, chair, sign, act, done, until, body, restart, http, edge: () => edge, host: () => host};
}

test('public read:here preserves server-selected shelf content through an active native restart', async t => {
  const w = await setup(t, '# Eden (test)\nA small village.');
  const offer = w.edge().capabilities(w.soul).find(c => c.id === 'read:here')!;
  assert.equal(offer.target?.kind, 'spot', JSON.stringify({offer, body:w.body().pose.p, spots:w.edge().spots.spots.filter(s=>s.activity==='read')})); assert.equal(offer.target?.id, `read.${w.chair}`);
  assert.match(offer.label, /Read a book/);
  // Unknown caller targeting does not choose either the body destination or the outcome source.
  const accepted = await w.act('read:here', {seconds: 20, target: 'read.e_not_the_server_selected_spot'});
  assert.equal(accepted.capability, 'read:here');
  assert.equal((accepted.chosen as {target: string}).target, offer.target.id);
  const context = w.edge().outcomes.context(accepted.id)!;
  assert.equal(context.capability, 'read:here'); assert.equal(context.readSpot, offer.target.id);
  assert.equal('target' in context.params, false);
  await w.until(() => w.body().human?.activity === 'read');
  assert.ok(w.host().engine.nativeSeatHoldsV1?.(w.soul.entityId).some(s => s.slot === `${w.chair}#seat`), 'the actual derived chair is held while reading');
  assert.equal(w.edge().receipt(w.soul.soulId, accepted.id)!.phase, 'started');
  const rawContext = w.f.db.db.prepare('SELECT body FROM edge_outcome_contexts_v1 WHERE receipt_id=?').get(accepted.id) as {body: string};
  await w.restart();
  assert.deepEqual(w.edge().outcomes.context(accepted.id), JSON.parse(rawContext.body), 'committed source binding survives restore without recapture');
  assert.equal(w.edge().receipt(w.soul.soulId, accepted.id)!.phase, 'started', 'same running native receipt survives');
  const first = await w.done(accepted);
  assert.equal(first.outcome!.learned[0].source, 'book:gardens-guide@1#p1');
  const explicit = await w.done(await w.act(`read:read.${w.chair}`, {seconds: 2}));
  assert.equal(explicit.outcome!.learned[0].source, 'book:gardens-guide@1#p2', 'explicit and generic shelf reads share durable progress');
  assert.deepEqual((await w.http('/v1/edge/receipts/' + accepted.id)).receipt.outcome, first.outcome, 'old outcome is immutable after another passage');
  assert.equal((w.f.db.db.prepare('SELECT next_passage FROM edge_reading_progress_v1 WHERE soul_id=?').get(w.soul.soulId) as {next_passage: number}).next_passage, 2);
  assert.deepEqual(w.host().engine.runtime.violations, []);
  assert.equal(w.f.db.paidCost(), 0);
});

test('non-Eden shelf reads keep constitution content; actual sign reads keep their own words', async t => {
  const w = await setup(t, 'Be kind. This is a new world.');
  const offer = w.edge().capabilities(w.soul).find(c => c.id === 'read:here')!;
  assert.match(offer.label, /Read this world's constitution/);
  const sign = await w.done(await w.act(`read:${w.sign}`));
  assert.equal(sign.outcome!.detail.passage, 'These are the sign’s own words.');
  assert.equal((sign.outcome!.detail.sign as {id: string}).id, w.sign);
  assert.equal((sign.outcome!.detail.sign as {text: string}).text, sign.outcome!.detail.passage);
  assert.equal(sign.outcome!.detail.book, undefined, 'sign content does not acquire a library book');
  const alias = await w.act('read:here', {seconds: 2, target: 'read.e_forged'});
  assert.equal(w.edge().outcomes.context(alias.id)!.readSpot, `read.${w.chair}`);
  const read = await w.done(alias);
  assert.equal((read.outcome!.detail.book as {id: string}).id, 'world-constitution');
  assert.equal(read.outcome!.detail.passage, 'Be kind. This is a new world.');
  const explicit = await w.done(await w.act(`read:read.${w.chair}`, {seconds: 2}));
  assert.equal((explicit.outcome!.detail.book as {id: string}).id, 'world-constitution');
  assert.equal((w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_reading_progress_v1').get() as {n: number}).n, 0);
  assert.deepEqual((await w.http('/v1/edge/receipts/' + sign.id)).receipt.outcome, sign.outcome, 'later shelf reads do not rewrite sign content');
});

test('generic no-source aliases and historical contexts do not gain catalogue content', async t => {
  const w = await setup(t, '# Eden (test)\nA small village.', false);
  const generic = await w.act('read:here', {seconds: 2, target: 'read.e_forged'});
  assert.equal(w.edge().outcomes.context(generic.id)!.readSpot, undefined);
  assert.match(w.edge().capabilities(w.soul).find(c => c.id === 'read:here')!.label, /this world's constitution/);
  const done = await w.done(generic);
  assert.equal((done.outcome!.detail.book as {id: string}).id, 'world-constitution');
  // A pre-field context remains on its original fallback; no migration/receipt rewrite.
  const legacy: EdgeReceipt = {...done, id: 'r_historical_without_binding'};
  w.edge().outcomes.capture(legacy.id, {soulId: w.soul.soulId, capability: 'read:here', params: {}, acceptedTick: 1});
  const snapshot: OutcomeSnapshot = {worldId: w.host().worldId, tick: w.host().engine.world.tick, place: 'field', placePath: ['field'], pos: [0, 0], walkable: ['field'], sections: [], materials: []};
  const old = w.edge().outcomes.terminal(legacy, snapshot)!;
  assert.equal((old.detail.book as {id: string}).id, 'world-constitution');
  await w.restart();
  assert.deepEqual(w.edge().outcomes.read(legacy.id), old, 'stored historical outcome is not reinterpreted');
  // No constitution still produces the neutral new-world fallback, never an Eden passage.
  const neutral = await setup(t, '', false);
  const read = await neutral.done(await neutral.act('read:here', {seconds: 2}));
  assert.equal(read.outcome!.detail.passage, NEW_WORLD_LORE);
});
