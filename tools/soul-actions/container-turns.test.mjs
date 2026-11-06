import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {CORE_KIT, containerInside} from '../../packages/world-compiler/src/index.ts';

// A god places a storage def at any turn. At each one a Soul puts a thing in and takes it out, and the engine stays clean: no
// recovered fault, no violation. Every library def with an inside is covered without being listed, so a new one gets this too.
// (A body too close at the reach trips collision.human-static at some turns only: #435, #1063.)
// core/lockers@3 is frozen and does fault: #1063 removes this exclusion.
const KNOWN_FAULT = new Set(['core/lockers@3']);
const defs = CORE_KIT.filter(d => containerInside(d)).map(d => ({ref: `core/${d.name.replace(/^core-/, '')}@${d.version}`, door: !!d.state && Object.hasOwn(d.state, 'open')})).filter(d => !KNOWN_FAULT.has(d.ref));
const turns = [0, 0.4, 0.785, 1.2, 1.571, 1.9, 2.356, 2.9, 3.7, 4.712, 5.5];
for (const {ref, door} of defs) test(`${ref}: put in and take out at every turn`, {timeout: 900000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => {comms.close(); f.host.stop(); f.db.close();});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 await tick(); await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Turns test'})); soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
 const ent = n => [...god.model.entities.values()].find(e => e.name === n);
 const ok = r => {assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 400)); return r;};
 const b = f.host.engine.world.entities[soul.entityId], [ax, az] = [b.pose.p[0], b.pose.p[2]];
 ok(god.act({ops: [{op: 'place', def: 'core/table@1', name: 'table', p: [ax + 2.4, az - 1.2]}, {op: 'place', def: 'core/bowl@2', name: 'bowl', in: {parent: 'table', slot: 'top'}, p: [0, 0]}]})); await tick(40);
 const done = async capability => {const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability})})), a = await r.json(); assert.equal(a.accepted, true, capability + ' ' + JSON.stringify(a).slice(0, 400));
  for (let n = 0; n < 1600; n++) {const rc = edge.receipt(soul.soulId, a.receipt.id); if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) {assert.equal(rc.phase, 'completed', capability + ' ' + JSON.stringify(rc).slice(0, 400)); return rc;} await tick(1);} throw Error('timed out ' + capability);};
 const bowl = ent('bowl').id, table = ent('table').id, support = () => f.host.engine.world.entities[bowl].support;
 for (const [i, r] of turns.entries()) {
  const name = `spot-${i}`; ok(god.act({ops: [{op: 'place', def: ref, name, p: [ax + 1, az + 3], r, ...(door ? {state: {open: true}} : {})}]})); await tick(40); const spot = ent(name).id;
  await done(`pick-up:${bowl}`); await done(`put-in:${spot}`); assert.equal(support().on, spot, `r=${r}`);
  await tick(12); await done(`pick-up:${bowl}`); assert.equal(support().kind, 'in-hand', `r=${r}`);
  await done(`put-on:${table}`); await tick(12); ok(god.act({ops: [{op: 'remove', id: spot}]})); await tick(20);
 }
 assert.deepEqual(f.host.engine.runtime.violations, []);
});
