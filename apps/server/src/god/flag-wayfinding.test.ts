// F4 (#375): named god flags are wayfinding destinations. `around <flag>` answers with distance, direction and the walk,
// `map` lists the flags beside the places, and a walk that reached a flag says "at the <name> flag", not "at world".
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from 'hono';
import {coreRef} from '@sim/world-compiler';
import {fixture, factory, invite, accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../edge/routes.ts';
import {routeFrame} from '../edge/perception/route.ts';
import {GodMode} from './god.ts';
import {GroundHost, installGroundCapabilities} from './ground-host.ts';
import {installEngineBridge} from './engine-bridge.ts';
import type {EdgeSoul} from '../edge/contract.ts';

async function world(t: test.TestContext) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}}), edge = new EdgeLedger(f.host, f.db);
  new GroundHost(f.db, f.host, god); installGroundCapabilities(edge, god, f.host);
  installEngineBridge({host: f.host, god, edge, log() {}, worldClock: false, worldLore: false});
  let current: EdgeSoul | undefined; const app = new Hono();
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => current!});
  t.after(() => { comms.close(); f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const tick = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); } } };
  await tick();
  const built = god.act({ops: [
    {op: 'place', def: coreRef('zone'), name: 'field', shape: {area: [[-40, -40], [40, -40], [40, 40], [-40, 40]]}, params: {use: 'park'}},
    {op: 'place', def: coreRef('flag'), name: 'orchard', p: [-12, -9], state: {label: 'orchard'}},
    {op: 'place', def: coreRef('pavilion'), name: 'orchard-house', p: [25, 20]},
    {op: 'place', def: coreRef('pavilion'), name: 'pond-hall', p: [-25, 20]},
    {op: 'place', def: coreRef('flag'), name: 'pond-hall-flag', p: [10, -25], state: {label: 'pond hall'}},
  ]} as never); assert.equal(built.accepted, true, JSON.stringify(built)); await tick(8);
  await invite(f, 'walker'); const row = await accept(f.host, f.souls.create('dev:walker', {name: 'Walker', description: 'Flag wayfinding test'}));
  const soul: EdgeSoul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; current = soul; await tick(4); edge.map();
  return {f, edge, app, soul, tick};
}

test('F4 (#375): around finds a named flag with or without the word, an exact flag beats a partial place, an exact place keeps the answer', async (t) => {
  const w = await world(t), p = w.f.host.engine.world.entities[w.soul.entityId]!.pose.p;
  for (const q of ['orchard', 'the orchard flag', 'Orchard Flag']) {
    const r = routeFrame(w.edge, w.soul, q) as Record<string, unknown>;
    assert.equal(r.found, true, `${q}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.flag, {name: 'orchard', walk: 'walk:flag-orchard'}, q);
    assert.equal(r.walk, 'walk:flag-orchard'); assert.equal(r.place, undefined, `${q}: not the orchard-house`);
    assert.equal(r.m, Math.round(Math.hypot(-12 - p[0], -9 - p[2])), q);
    assert.match(String(r.say), /^The orchard flag: \d+ m [a-z-]+ \(~.+\)(, (past|near) .+)?\. To go: act walk:flag-orchard\.$/, String(r.say));
  }
  const hall = routeFrame(w.edge, w.soul, 'pond hall') as Record<string, unknown>;
  assert.equal(hall.flag, undefined, 'an exact place match keeps the answer'); assert.equal((hall.place as {id: string})?.id, 'g-pond-hall', JSON.stringify(hall));
  const none = routeFrame(w.edge, w.soul, 'lighthouse') as Record<string, unknown>;
  assert.equal(none.flag, undefined); assert.notEqual(none.found, true, JSON.stringify(none));
});

test('F4 (#375): map lists the named flags beside the places; a walk that reaches a flag says it arrived at the flag', async (t) => {
  const w = await world(t);
  const map = await (await w.app.request('/v1/edge/map')).json() as {places: unknown[]; flags: {name: string; walk: string; at: number[]}[]};
  assert.ok(map.places.length > 0);
  assert.deepEqual(map.flags.map(f => [f.name, f.walk, f.at]).sort(), [['orchard', 'walk:flag-orchard', [-12, -9]], ['pond hall', 'walk:flag-pond-hall-flag', [10, -25]]]);
  const r = await accept(w.f.host, w.edge.act(w.soul, {capability: 'walk:flag-orchard'})) as {receipt: {id: string}};
  for (let i = 0; i < 4000 && ['waiting', 'started'].includes(w.edge.receipt(w.soul.soulId, r.receipt.id)!.phase); i++) await w.tick(1);
  const done = w.edge.receipt(w.soul.soulId, r.receipt.id) as {phase: string; outcome?: {summary: string}};
  assert.equal(done.phase, 'completed', JSON.stringify(done));
  assert.equal(done.outcome?.summary, 'walk completed at the orchard flag.', JSON.stringify(done.outcome));
});
