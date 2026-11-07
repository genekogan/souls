import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
async function garden(t, ops, ben = [0.6, 0.7], path = ':memory:') {
 const f = fixture(path, factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 let closed = false; const close = () => { if (closed) return; closed = true; comms.close(); f.host.stop(); f.db.close(); }; t.after(close);
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
 return {f, close, edge, god, bridge, tick, ana, ben: b, W, ax, az, move, id, state, act, receipt, end};
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

// Around the table, turned, on the long table whose stands are hardest to reach, and on a deep worktop no stand reaches:
// these starts hung for good, or ended with both Souls blocked on stands closer than two bodies. Whatever the receipts say
// is what the vessels hold. Neither walk may be the one with no limit, and if one is, the act gives up by name (#1216).
const turned = (r, def = 'core/table@1', at = 0.25) => (ax, az) => [
 {op: 'place', def: 'core/garden-planter@2', name: 'bed', p: [ax + 6.9, az + 3.9], state: {growth: 4, moisture: 1}},
 {op: 'place', def: 'core/garden-planter@2', name: 'flower-bed', p: [ax + 6.9, az + 7.5], state: {growth: 3, moisture: 1}},
 {op: 'place', def, name: 'garden-table', p: [ax + 2.5, az + 1.9], r},
 {op: 'place', def: 'core/harvest-basket@1', name: 'basket', in: {parent: 'garden-table', slot: 'top'}, p: [at, 0]},
 {op: 'place', def: 'core/flower-vase@1', name: 'vase', in: {parent: 'garden-table', slot: 'top'}, p: [-at, 0]}];
const arms = [
 ...[[3, 0], [3, 0.3], [4, 0], [0, 3], [5, 3], [1.5, -1], [2.5, 4], [-1, 2], [2.9, 1.1]].map(s => ['table', table, s, ['basket', 'vase']]),
 ...[[2.5, 0.25], [2.5, -0.25], [2.5, 0.5], [2.75, 0]].map(s => ['long table', turned(-0.7, 'core/long-table@1', 0.2), s, ['basket', 'vase']]),
 ...[[2.5, -0.25], [2.5, 0.25], [2.75, 0.5]].map(s => ['turned long table', turned(2.4, 'core/long-table@1', 0.2), s, ['basket', 'vase']]),
 ...[[2.3, 2.7], [2.9, 2.9], [2.5, 0.25]].map(s => ['turned table', turned(2.4), s, ['vase', 'basket']]),
 ...[[4.5, 1.9]].flatMap(s => [['deep worktop', turned(0.7, 'core/mars-og-worktop@2'), s, ['vase', 'basket']], ['deep worktop', turned(0.7, 'core/mars-og-worktop@2'), s, ['basket', 'vase']]])];
test('two Souls at one table end truthfully, and both pick', {timeout: 240000}, async t => {
 for (const [what, scene, start, [first, second]] of arms) await t.test(`${what}, Ben from ${start}`, async t => {
  const g = await garden(t, scene, start);
  const rs = await g.end([await g.act(g.ana, first), await g.act(g.ben, second)], 3200);
  assert.deepEqual(rs.map(r => r.phase), ['completed', 'completed'], JSON.stringify(rs.map(r => [r.phase, r.code, r.reason])));
  assert.deepEqual([g.state('basket').fruit, g.state('bed').growth, g.state('vase').flowers, g.state('flower-bed').growth], [3, 3, 3, 2]);
 });
});

test('an act given up ends failed by name, and the body stops', {timeout: 60000}, async t => {
 const g = await garden(t, table), r = await g.act(g.ana, 'basket'); await g.tick(30);
 g.edge.actFail(g.ana.entityId, g.receipt(r).capability, {code: 'harvest.fetch-blocked', reason: 'Others were in the way.'});
 assert.equal(g.receipt(r).phase, 'failed'); assert.equal(g.receipt(r).code, 'harvest.fetch-blocked');
 await g.tick(200); assert.equal(g.state('basket').fruit ?? 0, 0); assert.equal(g.f.host.engine.programOf(g.ana.entityId), null, 'the programme stopped');
});

test('an act given up replays exactly: a restart with no snapshot boots', {timeout: 60000}, async t => {
 const dir = mkdtempSync(join(tmpdir(), 'harvest-')), path = join(dir, 'world.db'); t.after(() => rmSync(dir, {recursive: true, force: true}));
 const g = await garden(t, table, [0.6, 0.7], path), r = await g.act(g.ana, 'basket'); await g.tick(30);
 g.edge.actFail(g.ana.entityId, g.receipt(r).capability, {code: 'harvest.fetch-blocked', reason: 'Not within two minutes.'}); await g.tick(5);
 assert.equal(g.f.host.engine.programOf(g.ana.entityId), null, 'stopped');
 const entity = g.ana.entityId; g.close();
 const again = fixture(path, factory, {durableClockV1: true}); t.after(() => { again.host.stop(); again.db.close(); });
 assert.equal(again.host.engine.programOf(entity), null, 'the stop is in the log, so replay ends the programme too');
});

test('a vessel on the ground behind something is fetched from its open side', {timeout: 60000}, async t => {
 const g = await garden(t, (ax, az) => [{op: 'place', def: 'core/garden-planter@2', name: 'bed', p: [ax + 4.9, az + 3.9], state: {growth: 4, moisture: 1}}, {op: 'place', def: 'core/counter@1', name: 'counter', p: [ax + 2, az]}, {op: 'place', def: 'core/harvest-basket@1', name: 'basket', p: [ax + 2.75, az]}], [9, -6]);
 const [a] = await g.end([await g.act(g.ana, 'basket')]);
 assert.equal(a.phase, 'completed', JSON.stringify(a).slice(0, 300)); assert.equal(g.state('basket').fruit, 3);
});

test('a vessel on the ground is fetched from any distance', {timeout: 60000}, async t => {
 const g = await garden(t, (ax, az) => [{op: 'place', def: 'core/garden-planter@2', name: 'bed', p: [ax + 4.9, az + 3.9], state: {growth: 4, moisture: 1}}, {op: 'place', def: 'core/harvest-basket@1', name: 'basket', p: [ax + 1.5, az + 2.4]}], [9, -6]);
 const [a] = await g.end([await g.act(g.ana, 'basket')]);
 assert.equal(a.phase, 'completed', JSON.stringify(a).slice(0, 300)); assert.equal(g.state('basket').fruit, 3);
});

// The faculty alone, on a clock the test turns: a walk can outlast any grace, and an act that never touched says so.
test('the watch outlives a hold-up while the act is open, and only a contact makes a pick', {timeout: 60000}, async t => {
 const g = await garden(t, table), {model} = g.god, basket = g.id('basket'), bed = g.id('bed'), me = g.ana.entityId;
 const world = {tick: 5000, entities: {[me]: {human: {}, pose: {p: [g.ax + 2.5, 0, g.az + 2.8]}}, [basket]: {support: {kind: 'ground'}, pose: {p: [g.ax + 2.8, 0, g.az + 2.8]}, tags: []}}};
 let open = true; const commits = [];
 const gaveUp = [], h = createHarvest({model, version: () => 1, engine: {world, dt: 0.05}, commit: ops => { commits.push(ops); return {accepted: true}; }, log() {}, actOpen: () => open, actFail: (b, c, why) => gaveUp.push(why.code)});
 const capability = `object:${basket}:harvest`, run = n => { for (let i = 0; i < n; i++) { world.tick++; h.tick(); } };
 const plan = () => { const p = h.plan({entityId: me}, basket, 'harvest'); assert.ok(p?.steps?.length, JSON.stringify(p)); h.expect(me); };
 plan(); run(2000);
 assert.equal(h.watchingCount(), 1, 'an open act keeps its watch past the minute of grace, the vessel still on the table');
 world.entities[basket].support = {kind: 'in-hand', by: me, hand: 'right'}; run(10);
 assert.deepEqual(h.outcome(capability, me, false), null, 'stopped before any contact: the programme\'s own reason stands');
 assert.equal(h.outcome(capability, me, true).code, 'harvest.not-picked', 'the steps ended and no hand touched anything');
 world.entities[me].human.handActuator = {target: bed, at: [0, 0, 0], hand: 'left', hold: 0.7, startTick: 4990, actionId: 'old'}; run(40);
 assert.equal(commits.length, 0, 'a hand motion from before this act picks nothing'); assert.equal(h.watchingCount(), 1, 'and does not end the watch');
 world.entities[me].human.handActuator = {target: bed, at: [0, 0, 0], hand: 'left', hold: 0.7, startTick: world.tick, actionId: 'a1'}; run(40);
 assert.equal(commits.length, 1, 'the contact picked, long after the first minute'); assert.equal(h.outcome(capability, me, false), 'done', 'a hold cut short after the pick is still a pick');
 assert.equal(h.outcome(capability, me, true).code, 'harvest.not-picked', 'an outcome is read once');
 delete world.entities[me].human.handActuator; run(2); assert.equal(h.watchingCount(), 0, 'the hand is back: nothing watched');
 world.entities[basket].support = {kind: 'ground'}; plan(); run(3700);
 assert.deepEqual(gaveUp, ['harvest.fetch-blocked'], 'a fetch held up for two minutes ends by name, whatever walk holds it'); assert.equal(h.watchingCount(), 0);
 world.entities[basket].support = {kind: 'in-hand', by: me, hand: 'right'}; plan(); open = false; run(1300);
 assert.equal(h.watchingCount(), 0, 'an act that has closed loses its watch at the end of the grace, the vessel still held'); assert.equal(commits.length, 1);
});
