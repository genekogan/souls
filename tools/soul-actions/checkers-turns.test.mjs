import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

// A god places a checkers board at any turn. At each one, in a fresh world, a Soul opens with a move and wipes the board, at several
// positions, with no recovered fault and no violation. A body too close trips collision.human-static at some turns only (#1063).
const turns = [0, 0.4, 0.785, 1.2, 1.571, 1.9, 2.356, 2.9, 3.7, 4.712, 5.5];
const once = async (r, off) => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 try {
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await tick(); await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Turns test'})); soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
  const b = f.host.engine.world.entities[soul.entityId];
  const placed = god.act({ops: [{op: 'place', def: 'core/checkers-board@1', name: 'checkers', p: [b.pose.p[0] + 1 + off[0], b.pose.p[2] + 3 + off[1]], r}]}); assert.equal(placed.accepted, true, JSON.stringify(placed).slice(0, 300)); await tick(40);
  const id = god.model.get('checkers').id;
  const run = async (action, params) => {
   const sent = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: `object:${id}:${action}`, ...(params ? {params} : {})})})), a = await sent.json();
   assert.equal(a.accepted, true, `r=${r} off=${off} ${JSON.stringify(a).slice(0, 300)}`);
   for (let n = 0; n < 1600; n++) {
    const rc = edge.receipt(soul.soulId, a.receipt.id);
    if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) {assert.equal(rc.phase, 'completed', `r=${r} off=${off} ${action} ${JSON.stringify(rc).slice(0, 300)}`); return;}
    await tick(1);
   }
   assert.fail(`r=${r} off=${off} ${action} timed out`);
  };
  await run('move', {from: 'c3', to: 'd4'}); await tick(20); await run('erase');
  assert.deepEqual(f.host.engine.runtime.violations, [], `r=${r} off=${off}`);
 } finally {comms.close(); f.host.stop(); f.db.close();}
};
for (const off of [[0, 0], [0.37, 0.11], [0.13, 0.29]]) test(`core/checkers-board@1: move and wipe at every turn, offset ${off}`, {timeout: 300000}, async () => {
 for (const r of turns) await once(r, off);
});
