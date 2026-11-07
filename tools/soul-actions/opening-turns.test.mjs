import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {isContactActuator} from '../../apps/server/src/god/contact-actuator.ts';
import {CORE_KIT} from '../../packages/world-compiler/src/index.ts';

// #1070: a god places a door, gate, window, locker or drawer at any turn. At each one a Soul opens and closes it and the engine
// stays clean: done, or refused by name, with no recovered fault and no violation. Every def with a hand contact to open is
// covered without being listed, so a new one gets this too. Each turn is a fresh world, so a fault at one cannot blur the next.
const defs = CORE_KIT.filter(d => d.actions?.some(a => a.name === 'open' && isContactActuator(d, a)) && d.actions.some(a => a.name === 'close')).map(d => `core/${d.name.replace(/^core-/, '')}@${d.version}`);
const turns = [0, 0.4, 0.571, 0.785, 1.2, 1.571, 1.9, 2.356, 2.9, 3.7, 4.712, 5.5, 5.712];
const once = async (ref, r) => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 try {
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await tick(); await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Turns test'})); soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
  const b = f.host.engine.world.entities[soul.entityId], [ax, az] = [b.pose.p[0], b.pose.p[2]];
  if (!god.act({ops: [{op: 'place', def: ref, name: 'thing', p: [ax + 1, az + 3], r}]}).accepted) return [];
  await tick(45);
  const out = [], moved = [];
  for (const action of ['open', 'close']) {
   const capability = `object:${god.model.get('thing').id}:${action}`;
   const a = await (await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability, strict: true})}))).json();
   if (!a.accepted) {out.push(a.code); continue;}
   let was = [...b.pose.p], rc;
   for (let n = 0; n < 1600; n++) {
    rc = edge.receipt(soul.soulId, a.receipt.id); if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) break;
    await tick(1); moved.push(Math.hypot(b.pose.p[0] - was[0], b.pose.p[2] - was[2])); was = [...b.pose.p];
   }
   out.push(rc?.code ?? rc?.phase); await tick(10);
  }
  assert.deepEqual(f.host.engine.runtime.violations, [], `${ref} r=${r}`);
  assert.equal(f.host.glitches.total, 0, `${ref} r=${r}: ${JSON.stringify(f.host.glitches.byRule)}`);
  assert.ok(Math.max(0, ...moved) < 0.2, `${ref} r=${r}: the body never jumps (${Math.max(...moved).toFixed(3)} m in a tick)`);
  return out;
 } finally {comms.close(); f.host.stop(); f.db.close();}
};

test('open and close at every turn: done or refused by name, never a recovered fault', {timeout: 900000}, async t => {
 assert.ok(defs.length >= 10, `found ${defs.length} defs`);
 for (const ref of defs) await t.test(ref, async () => {
  for (const r of turns) for (const code of await once(ref, r)) {
   assert.notEqual(code, 'engine.fault-recovered', `${ref} r=${r}`);
   assert.ok(code === 'completed' || /^(contact|object|hand_actuator_v1)\.[a-z-]+$/.test(code ?? ''), `${ref} r=${r}: ${code}`);
   if (/^core\/(door|gate)@/.test(ref)) assert.equal(code, 'completed', `${ref} r=${r}`);
  }
 });
});
