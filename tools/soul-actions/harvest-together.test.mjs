import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {createHarvest} from '../../apps/server/src/god/harvest.ts';

// #1214: Souls picking at the same moment. A harvest receipt is `completed` only when the hand's contact picked: the vessel
// holds what was picked and the planter moved on a stage. Otherwise it fails with a named code. Ana and Ben start apart from
// the table as they did in the Soul Run that found this, with the basket and the vase on it 0.5 m apart.
const ENDED = ['completed', 'failed', 'cancelled', 'replaced'];
async function garden(t, ops, ben = [0.6, 0.7]) {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 const bridge = installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
 await tick();
 const join = async (k, name) => { await invite(f, k); const row = await accept(f.host, f.souls.create('dev:' + k, {name, description: 'Harvest test'})); await tick(); return {soulId: row.id, entityId: row.entity_id, name: row.name, owner: 'dev:' + k}; };
 const ana = await join('ana', 'Ana'), b = await join('ben', 'Ben');
 const W = () => f.host.engine.world, at = W().entities[ana.entityId].pose.p, [ax, az] = [at[0], at[2]];
 const move = async (s, to) => { await accept(f.host, f.host.enqueue('edge-relocate', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to, why: 'test placement'})); await tick(20); };
 await move(b, [ax + ben[0], az + ben[1]]);
 const sc = god.act({ops: ops(ax, az)}); assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(45);
 const byName = n => [...god.model.entities.values()].find(e => e.name === n), id = n => byName(n).id, state = n => byName(n).state ?? {};
 const act = async (s, vessel) => { soul = s; const r = await (await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: `object:${id(vessel)}:harvest`, strict: true})}))).json(); assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 300)); return {soulId: s.soulId, id: r.receipt.id}; };
 const receipt = r => edge.receipt(r.soulId, r.id);
 const end = async (rs, ticks = 2600) => { for (let n = 0; n < ticks && !rs.every(r => ENDED.includes(receipt(r)?.phase)); n++) await tick(1); return rs.map(receipt); };
 return {f, god, bridge, tick, ana, ben: b, W, ax, az, move, id, state, act, receipt, end};
}
const table = (ax, az) => [
 {op: 'place', def: 'core/garden-planter@2', name: 'bed', p: [ax + 4.9, az + 3.9], state: {growth: 4, moisture: 1}},
 {op: 'place', def: 'core/garden-planter@2', name: 'flower-bed', p: [ax + 4.9, az + 7.5], state: {growth: 3, moisture: 1}},
 {op: 'place', def: 'core/table@1', name: 'garden-table', p: [ax + 2.5, az + 1.9]},
 {op: 'place', def: 'core/harvest-basket@1', name: 'basket', in: {parent: 'garden-table', slot: 'top'}, p: [0.25, 0.1]},
 {op: 'place', def: 'core/flower-vase@1', name: 'vase', in: {parent: 'garden-table', slot: 'top'}, p: [-0.25, 0.1]}];

test('two Souls at one table, each picking from their own bed, both finish and both picked', {timeout: 120000}, async t => {
 const g = await garden(t, table);
 const [a, b] = await g.end([await g.act(g.ana, 'basket'), await g.act(g.ben, 'vase')]);
 assert.equal(a.phase, 'completed', JSON.stringify(a).slice(0, 300)); assert.equal(b.phase, 'completed', JSON.stringify(b).slice(0, 300));
 assert.deepEqual([g.state('basket').fruit, g.state('bed').growth, g.state('vase').flowers, g.state('flower-bed').growth], [3, 3, 3, 2], 'both vessels hold what was picked and both beds moved on a stage');
 assert.ok(Math.max(a.endedTick - a.acceptedTick, b.endedTick - b.acceptedTick) < 800, 'neither waited out a blocked route');
 assert.deepEqual(g.f.host.engine.runtime.violations, []);
});

test('two Souls after one ripe bed: the first hand picks, the other receipt fails by name', {timeout: 120000}, async t => {
 const g = await garden(t, (ax, az) => [...table(ax, az).filter(o => o.name !== 'vase'), {op: 'place', def: 'core/harvest-basket@1', name: 'basket-two', in: {parent: 'garden-table', slot: 'top'}, p: [-0.25, 0.1]}]);
 const rs = await g.end([await g.act(g.ana, 'basket'), await g.act(g.ben, 'basket-two')]);
 assert.deepEqual(rs.map(r => r.phase).sort(), ['completed', 'failed'], JSON.stringify(rs.map(r => [r.phase, r.code, r.reason])));
 const lost = rs.find(r => r.phase === 'failed'); assert.equal(lost.code, 'harvest.not-ripe', JSON.stringify(lost)); assert.match(lost.reason, /nothing was picked/);
 assert.equal(g.state('bed').growth, 3, 'the bed moved on one stage, once');
 assert.equal((g.state('basket').fruit ?? 0) + (g.state('basket-two').fruit ?? 0), 3, 'three tomatoes in all');
});

test('the bed stops being ripe before the hand arrives: failed by name, nothing picked', {timeout: 120000}, async t => {
 const g = await garden(t, table);
 const r = await g.act(g.ana, 'basket'); await g.tick(40);
 assert.equal(g.god.act({ops: [{op: 'set', id: 'bed', state: {growth: 1}}]}).accepted, true);
 const [a] = await g.end([r]);
 assert.equal(a.phase, 'failed', JSON.stringify(a).slice(0, 300)); assert.equal(a.code, 'harvest.not-ripe'); assert.match(a.reason, /was sprout when your hand reached it, not fruiting/);
 assert.equal(g.state('basket').fruit ?? 0, 0, 'nothing in the basket'); assert.equal(g.state('bed').growth, 1, 'the bed as it was set');
});

// From every side of the table: the walk is a step of the act, so a head-on swap ends with a name instead of hanging, and
// whatever the two receipts say is what the vessels hold. Starts (3, 0), (3, 0.3) and (4, 0) hung for good under `take_item`'s
// own approach.
test('two Souls at one table end truthfully from any start', {timeout: 240000}, async t => {
 for (const start of [[3, 0], [3, 0.3], [4, 0], [0, 3], [5, 3], [1.5, -1], [2.5, 4], [-1, 2]]) {
  await t.test(`Ben from ${start}`, async t => {
   const g = await garden(t, table, start);
   const [a, b] = await g.end([await g.act(g.ana, 'basket'), await g.act(g.ben, 'vase')], 3200);
   for (const [r, vessel, field, bed, was] of [[a, 'basket', 'fruit', 'bed', 4], [b, 'vase', 'flowers', 'flower-bed', 3]]) {
    assert.ok(ENDED.includes(r.phase), `${vessel} ended: ${JSON.stringify(r).slice(0, 300)}`);
    assert.equal(g.state(vessel)[field] ?? 0, r.phase === 'completed' ? 3 : 0, `${vessel}: ${r.phase} ${r.code}`);
    assert.equal(g.state(bed).growth, r.phase === 'completed' ? was - 1 : was, `${bed}: ${r.phase} ${r.code}`);
    if (r.phase === 'failed') assert.ok(r.code, 'failed by name');
   }
   assert.ok([a, b].some(r => r.phase === 'completed'), `at least one finished: ${JSON.stringify([a.code, b.code])}`);
  });
 }
});

test('a vessel on the ground is fetched from any distance', {timeout: 60000}, async t => {
 const g = await garden(t, (ax, az) => [{op: 'place', def: 'core/garden-planter@2', name: 'bed', p: [ax + 4.9, az + 3.9], state: {growth: 4, moisture: 1}}, {op: 'place', def: 'core/harvest-basket@1', name: 'basket', p: [ax + 1.5, az + 2.4]}], [9, -6]);
 const [a] = await g.end([await g.act(g.ana, 'basket')]);
 assert.equal(a.phase, 'completed', JSON.stringify(a).slice(0, 300)); assert.equal(g.state('basket').fruit, 3);
});

// The faculty alone, on a clock the test turns: a walk can outlast any grace, and an act that never touched says so.
test('the watch outlives a hold-up while the act is open, and only a contact makes a pick', {timeout: 60000}, async t => {
 const g = await garden(t, table), {model} = g.god, basket = g.id('basket'), bed = g.id('bed'), me = g.ana.entityId;
 const world = {tick: 0, entities: {[me]: {human: {}, pose: {p: [g.ax + 2.5, 0, g.az + 2.8]}}, [basket]: {support: {kind: 'ground'}, pose: {p: [g.ax + 2.8, 0, g.az + 2.8]}, tags: []}}};
 let open = true; const commits = [];
 const h = createHarvest({model, version: () => 1, engine: {world, dt: 0.05}, commit: ops => { commits.push(ops); return {accepted: true}; }, log() {}, actOpen: () => open});
 const capability = `object:${basket}:harvest`, run = n => { for (let i = 0; i < n; i++) { world.tick++; h.tick(); } };
 const plan = () => { const p = h.plan({entityId: me}, basket, 'harvest'); assert.ok(p?.steps?.length, JSON.stringify(p)); h.expect(me); };
 plan(); run(3000);
 assert.equal(h.watchingCount(), 1, 'an open act keeps its watch through a long hold-up, the vessel still on the table');
 world.entities[basket].support = {kind: 'in-hand', by: me, hand: 'right'}; run(10);
 assert.deepEqual(h.outcome(capability, me, false), null, 'stopped before any contact: the programme\'s own reason stands');
 assert.equal(h.outcome(capability, me, true).code, 'harvest.not-picked', 'the steps ended and no hand touched anything');
 world.entities[me].human.handActuator = {target: bed, at: [0, 0, 0], hand: 'left', hold: 0.7, startTick: world.tick, actionId: 'a1'}; run(40);
 assert.equal(commits.length, 1, 'the contact picked, long after the first minute'); assert.equal(h.outcome(capability, me, false), 'done', 'a hold cut short after the pick is still a pick');
 assert.equal(h.outcome(capability, me, true).code, 'harvest.not-picked', 'an outcome is read once');
 delete world.entities[me].human.handActuator; run(2); assert.equal(h.watchingCount(), 0, 'the hand is back: nothing watched');
 plan(); open = false; run(1300);
 assert.equal(h.watchingCount(), 0, 'an act that has closed loses its watch at the end of the grace, the vessel still held'); assert.equal(commits.length, 1);
});
