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
const defs = CORE_KIT.filter(d => d.tags?.includes('hand-writable')).map(d => ({ref: `core/${d.name.replace(/^core-/, '')}@${d.version}`, action: d.actions[0].name, params: paramsOf(d, d.actions[0].name), state: d.name === 'core-poll-board' ? {text: 'yes\nno'} : undefined, then: ['erase', 'unsign', 'unpin'].find(n => d.actions[1]?.name === n && !d.actions[1].params)}));
const turns = [0, 0.4, 0.785, 1.2, 1.571, 1.9, 2.356, 2.9, 3.7, 4.712, 5.5];
const once = async ({ref, action, params, state, then}, r, {off = [0, 0], nb, expect = 'completed'} = {}) => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 try {
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await tick(); await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Turns test'})); soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
  const b = f.host.engine.world.entities[soul.entityId], [ax, az] = [b.pose.p[0], b.pose.p[2]];
  const [px, pz] = [ax + 1 + off[0], az + 3 + off[1]], placed = god.act({ops: [{op: 'place', def: ref, name: 'board', p: [px, pz], r, ...(state ? {state} : {})}, ...(nb ? [{op: 'place', def: nb.def, name: 'nb', p: [px + Math.sin(r) * nb.out + Math.cos(r) * nb.side, pz + Math.cos(r) * nb.out - Math.sin(r) * nb.side], r}] : [])]}); assert.equal(placed.accepted, true, JSON.stringify(placed).slice(0, 300)); await tick(40);
  const run = async (name, ps, want) => {
   const capability = `object:${god.model.get('board').id}:${name}`, sent = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability, ...(ps ? {params: ps} : {})})})), a = await sent.json();
   assert.equal(a.accepted, true, `r=${r} ${JSON.stringify(a).slice(0, 300)}`);
   for (let n = 0; n < 1600; n++) {
    const rc = edge.receipt(soul.soulId, a.receipt.id);
    if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) {assert.equal(rc.code ?? rc.phase, want, `r=${r} ${name} ${JSON.stringify(rc).slice(0, 300)}`); return;}
    await tick(1);
   }
   assert.fail(`r=${r} ${name} timed out`);
  };
  await run(action, params, expect);
  if (then) {await tick(20); await run(then, undefined, 'completed');}
  assert.deepEqual(f.host.engine.runtime.violations, [], `r=${r}`);
 } finally {comms.close(); f.host.stop(); f.db.close();}
};
for (const d of defs) test(`${d.ref}: ${d.action}${d.then ? ` then ${d.then}` : ''} at every turn`, {timeout: 300000}, async () => {
 for (const r of turns) await once(d, r);
});
// A neighbour moves the raster. Once held, a stroke stays held: its next step can read clear again, and taking it would cover the
// held distance in one tick (motion.overspeed). The exact-geometry refusal is still asked first, of the step the stroke wants.
const whiteboard = defs.find(d => d.ref === 'core/whiteboard@1');
test('a stroke held beside a neighbour does not jump', {timeout: 300000}, () => once(whiteboard, 3.927, {off: [0.037, 0.061], nb: {def: 'core/lamp-post@1', out: 0.8, side: 0.3}}));
test('a stroke with no room beside a neighbour still refuses by name', {timeout: 300000}, () => once({...whiteboard, then: undefined}, 3.927, {off: [0.037, 0.061], nb: {def: 'core/lamp-post@1', out: 0.5, side: 0.3}, expect: 'contact.step-blocked'}));
