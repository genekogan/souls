import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

// CTRL-2 (#1094): a three-level drill costs three calls and no caps read; a far thing adds nothing to `here`.
test('inspect drills place -> object -> item, and here groups its offers', {timeout: 300000}, async (t) => {
 const dir = mkdtempSync(join(tmpdir(), 'soul-inspect-'));
 const f = fixture(join(dir, 'world.db'), factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 t.after(() => {comms.close(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
 const tick = async (k = 5) => {for (let i = 0; i < k; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 await tick(); await invite(f, 'ana');
 const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Inspect test'}));
 soul = {soulId: row.id, entityId: row.entityId ?? row.entity_id, name: 'Ana', owner: 'dev:ana'};
 await tick();
 const W = () => f.host.engine.world, [ax, az] = [W().entities[soul.entityId].pose.p[0], W().entities[soul.entityId].pose.p[2]];
 const here = async () => (await (await app.request('/v1/edge/here?include=doHere')).json()).here;
 const inspect = async (id, q = '') => {const r = await app.request(`/v1/edge/inspect/${encodeURIComponent(id)}${q}`); return {status: r.status, body: await r.json()};};
 const before = await here(), bytes = (h) => JSON.stringify({...h, tick: 0}).length;
 assert.ok(before.offers && typeof before.offers === 'object', 'here has grouped offers');
 assert.ok(JSON.stringify(before.offers).length <= 500, 'within its budget');

 const far = []; for (let i = 0; i < 100; i++) far.push({op: 'place', def: 'core/table@1', name: `far-${i}`, p: [100 + (i % 10) * 2, 100 + Math.floor(i / 10) * 2]});
 assert.equal(god.act({ops: far}).accepted, true); await tick(30);
 assert.deepEqual((await here()).offers, before.offers, '100 far tables change nothing');
 assert.equal(bytes(await here()), bytes(before), 'and add 0 bytes');

 const sc = god.act({ops: [
  {op: 'place', def: 'core/counter@1', name: 'counter', p: [ax, az - 1.4]},
  {op: 'place', def: 'core/kettle@2', name: 'kettle', in: {parent: 'counter', slot: 'top'}, p: [0.3, 0.1], state: {level: 1, heatTick: -1}},
 ]});
 assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(40);
 const id = (n) => [...god.model.entities.values()].find((e) => e.name === n).id;

 const grouped = (await here()).offers;
 for (const [verb, g] of Object.entries(grouped)) if (g && g.count) assert.ok(g.count >= g.nearest.length && g.nearest.length <= 3, verb + JSON.stringify(g));
 const place = edge.placeIdOf?.(soul.soulId) ?? (await here()).me.place;
 const level1 = await inspect(place);
 assert.equal(level1.status, 200, JSON.stringify(level1.body)); assert.equal(level1.body.inspect.kind, 'place');
 const counter = await inspect(id('counter'));
 assert.equal(counter.status, 200); assert.ok(counter.body.inspect.contents?.some((c) => c.id === id('kettle')), JSON.stringify(counter.body.inspect));
 const kettle = await inspect(id('kettle'));
 assert.equal(kettle.status, 200); assert.ok(kettle.body.inspect.offers.some((o) => /fill|pick-up|boil/.test(o.id)), JSON.stringify(kettle.body.inspect.offers));
 assert.ok(JSON.stringify(kettle.body).length <= 4200, 'within the default budget');

 const me = await inspect(soul.soulId); assert.equal(me.body.inspect.kind, 'soul');
 const none = await inspect('no-such-thing-at-all'); assert.equal(none.status, 404); assert.equal(none.body.error.code, 'capability.unknown');
});
