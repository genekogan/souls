import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

// #1070: a door in a walled yard at any turn. The gap turns solid only at the close's contact, so a close from the far side has
// to end clear of it. A Soul walks in and out through the door (closed behind her both ways), then shuts it by hand from each
// side. Every leg completes or fails by name; nothing recovers a fault, breaks an invariant or jumps. Each turn is a fresh world.
const defs = (process.env.YARD_DEFS ?? 'core/door@3,core/door@2').split(',');
const turns = (process.env.YARD_TURNS ?? '0,0.4,0.571,0.785,1.2,1.571,1.9,2.356,2.9,3.7,4.712,5.5,5.712').split(',').map(Number);
const once = async (ref, r) => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 try {
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await tick(); await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Yard test'})); await tick();
  soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: 'dev:ana'};
  const body = () => f.host.engine.world.entities[soul.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
  // the door 3 m ahead of her, the yard behind it, all turned about the door by r (local z runs into the yard)
  const c = Math.cos(r), s = Math.sin(r), o = [ax, az + 3], at = (x, z) => [+(o[0] + x * c + z * s).toFixed(3), +(o[1] - x * s + z * c).toFixed(3)];
  const placed = god.act({ops: [
   {op: 'place', def: 'core/garden-wall@1', name: 'walls', shape: {path: [at(-.6, 0), at(-4, 0), at(-4, 6), at(4, 6), at(4, 0), at(.6, 0)]}},
   {op: 'place', def: ref, name: 'door', p: o, r: r + Math.PI},
   {op: 'place', def: 'core/bench@1', name: 'inside-bench', p: at(1.5, 4), r},
   {op: 'place', def: 'core/floor-lamp@1', name: 'outside-lamp', p: at(0, -4)},
  ]});
  assert.equal(placed.accepted, true, JSON.stringify(placed)); await tick(45);
  const moved = [], out = [];
  const leg = async (capability, name) => {
   const a = await (await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability})}))).json();
   if (!a.accepted) {out.push([name, a.code]); return;}
   let was = [...body().pose.p], rc;
   for (let n = 0; n < 2400; n++) {
    rc = edge.receipt(soul.soulId, a.receipt.id); if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) break;
    await tick(1); moved.push(Math.hypot(body().pose.p[0] - was[0], body().pose.p[2] - was[2])); was = [...body().pose.p];
   }
   out.push([name, rc?.code ?? rc?.phase]); await tick(10);
  };
  const id = god.model.get('door').id;
  await leg('walk:inside-bench', 'in'); await leg('walk:outside-lamp', 'out');
  for (const side of ['outside', 'inside']) {
   await leg(side === 'inside' ? 'walk:inside-bench' : 'walk:outside-lamp', `to-${side}`);
   await leg(`object:${id}:open`, `open-${side}`); await leg(`object:${id}:close`, `close-${side}`);
  }
  assert.deepEqual(f.host.engine.runtime.violations, [], `${ref} r=${r}`);
  assert.equal(f.host.glitches.total, 0, `${ref} r=${r}: ${JSON.stringify(f.host.glitches.byRule)}`);
  assert.ok(Math.max(0, ...moved) < 0.2, `${ref} r=${r}: the body never jumps (${Math.max(...moved).toFixed(3)} m in a tick)`);
  return out;
 } finally {comms.close(); f.host.stop(); f.db.close();}
};

test('a door in a yard at every turn: walked through and shut from both sides', {timeout: 1200000}, async t => {
 for (const ref of defs) await t.test(ref, async () => {
  for (const r of turns) {
   const legs = await once(ref, r);
   if (process.env.YARD_LOG) console.log(ref, r, JSON.stringify(legs));
   for (const [name, code] of legs) {
    assert.notEqual(code, 'engine.fault-recovered', `${ref} r=${r} ${name}`);
    assert.ok(code === 'completed' || /^(contact|object|hand_actuator_v1|walk|place|capability)\.[a-z-]+$/.test(code ?? ''), `${ref} r=${r} ${name}: ${code}`);
   }
   assert.equal(legs.filter(([n, c]) => ['in', 'out'].includes(n) && c !== 'completed').length, 0, `${ref} r=${r}: ${JSON.stringify(legs)}`);
  }
 });
});
