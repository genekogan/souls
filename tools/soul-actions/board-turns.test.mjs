import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {CORE_KIT} from '../../packages/world-compiler/src/index.ts';

// A god places a writable board at any turn. At each one a Soul does the board's hand action and the engine stays clean: no
// recovered fault, no violation. Every hand-writable def is covered without being listed, so a new one gets this too. Each turn
// is a fresh world, so a fault at one turn cannot blur the next. (A stroke's step to the board stopped at the invariant's
// clearance only at some turns before #1063.)
const PARAMS = {write: {text: 'Hello'}, mark: {square: 'centre'}, vote: {choice: 'yes'}, sign: undefined};
const paramsOf = (d, action) => action !== 'pin' ? PARAMS[action] : d.name === 'core-poster-wall' ? {title: 'A talk'} : {text: 'Wanted: a ladder'};
const defs = CORE_KIT.filter(d => d.tags?.includes('hand-writable')).map(d => ({ref: `core/${d.name.replace(/^core-/, '')}@${d.version}`, action: d.actions[0].name, params: paramsOf(d, d.actions[0].name), state: d.name === 'core-poll-board' ? {text: 'yes\nno'} : undefined}));
const turns = [0, 0.4, 0.785, 1.2, 1.571, 1.9, 2.356, 2.9, 3.7, 4.712, 5.5];
const once = async ({ref, action, params, state}, r) => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 try {
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await tick(); await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Turns test'})); soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
  const b = f.host.engine.world.entities[soul.entityId], [ax, az] = [b.pose.p[0], b.pose.p[2]];
  const placed = god.act({ops: [{op: 'place', def: ref, name: 'board', p: [ax + 1, az + 3], r, ...(state ? {state} : {})}]}); assert.equal(placed.accepted, true, JSON.stringify(placed).slice(0, 300)); await tick(40);
  const capability = `object:${god.model.get('board').id}:${action}`, sent = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability, ...(params ? {params} : {})})})), a = await sent.json();
  assert.equal(a.accepted, true, `r=${r} ${JSON.stringify(a).slice(0, 300)}`);
  for (let n = 0; n < 1600; n++) {
   const rc = edge.receipt(soul.soulId, a.receipt.id);
   if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) {assert.equal(rc.phase, 'completed', `r=${r} ${JSON.stringify(rc).slice(0, 300)}`); break;}
   assert.notEqual(n, 1599, `r=${r} timed out`); await tick(1);
  }
  assert.deepEqual(f.host.engine.runtime.violations, [], `r=${r}`);
 } finally {comms.close(); f.host.stop(); f.db.close();}
};
for (const d of defs) test(`${d.ref}: ${d.action} at every turn`, {timeout: 300000}, async () => {
 for (const r of turns) await once(d, r);
});
