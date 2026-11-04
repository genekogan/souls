// PC05 (#684): a ready shared proposal commits atomically (one host decision with one native crew carry), its members'
// body acts are refused shared.busy while it runs, and every member's receipt ends together when it ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {SHARED_LAPSE} from '../../apps/server/src/edge/ledger/together.ts';

async function world(t, sharedCarry) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry}), app = new Hono(); let current;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => current});
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  const souls = {};
  for (const name of ['Ada', 'Bo', 'Cy', 'Fy']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Shared roles test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await tick();
  const E = f.host.engine.world.entities, pos = (s) => E[s.entityId].pose.p;
  const [ax, , az] = pos(souls.Ada);
  // the scene: Ada and Bo beside a loose shared-carry beam; the shed 8 m away; Fy a floater beside them; Cy uninvited nearby (the green field's ground cannot stand a body 100 m off, so
  // distance is tested with 100 loads 100 m away)
  // test setup only: stand the bodies where the scene needs them (a logged relocate, as the ledger's own step-clear)
  const at = async (s, x, z) => {
    await accept(f.host, f.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
    const q = f.host.engine.world.entities[s.entityId].pose.p; assert.ok(Math.hypot(q[0] - x, q[2] - z) < 3, `${s.name} stands at ${x},${z} (is ${q[0]},${q[2]}; program ${f.host.engine.programOf(s.entityId)})`);
  };
  await at(souls.Bo, ax, az + 3); await at(souls.Fy, ax - 1.5, az - 1.5);
  ok(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam2', p: [ax + 2, az - 2.5]},
    {op: 'place', def: 'core/rack-beam@1', name: 'old-beam', p: [ax - 1.5, az + 3]},
  ]}));
  await tick(60);
  const idOf = (n) => god.model.get(n).id;
  return {f, edge, god, app, tick, souls, pos, idOf, at, setCurrent: (s) => { current = s; }};
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = async (w, s, input) => accept(w.f.host, w.edge.act(s, input));
const code = (r) => r.error?.code ?? r.code;
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);

test('PC05: commit atomically, refuse body acts shared.busy, release every member together', {timeout: 300000}, async (t) => {
  const w = await world(t, true), {Ada, Bo} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  assert.equal(inviteOf(w, id).shared.op, null); assert.equal(read(w, Bo, a).startedTick, null, 'acceptance is not start');
  for (let n = 0; n < 60 && inviteOf(w, id).state === 'pending'; n++) await w.tick(1);
  const inv = inviteOf(w, id), op = inv.shared.op;
  assert.equal(inv.state, 'committed', JSON.stringify([read(w, Ada, p), read(w, Bo, a)]));
  assert.equal(op.id, `op_${id}_r1`); assert.equal(op.programId, eng.programOf(Ada.entityId)); assert.equal(op.phase, 'started');
  for (const [s, r] of [[Ada, p], [Bo, a]]) {
    const x = read(w, s, r); assert.equal(x.phase, 'started', s.name); assert.equal(x.startedTick, op.committedTick, `${s.name} starts in the commit's tick`);
    assert.equal(x.shared.op, op.id); assert.equal(x.shared.phase, 'started');
  }
  const decisions = () => w.f.db.events(w.f.host.worldId).filter((e) => e.kind === 'decision' && String(e.payload?.trigger ?? '').startsWith('shared-commit:')).length;
  assert.equal(decisions(), 1);
  await w.edge.commitShared(id); await w.tick(2);
  assert.equal(decisions(), 1, 'a repeated commit attempt submits nothing'); assert.equal(inviteOf(w, id).shared.op.programId, op.programId);
  // busy: body acts are refused and replace nothing; reads still work
  const busy = await act(w, Bo, {capability: 'wave:here'});
  assert.equal(code(busy), 'shared.busy', JSON.stringify(busy)); assert.match(busy.reason, /hands and walking/);
  assert.equal(code(await act(w, Ada, {capability: 'wave:here'})), 'shared.busy');
  assert.deepEqual(w.edge.openReceipts(Bo.soulId).map((r) => r.id), [a.receipt.id], 'no receipt was created or replaced');
  assert.ok(w.edge.capabilities(Bo).length > 0, 'Bo can still read his options');
  for (let n = 0; n < 3000 && ['waiting', 'started'].includes(read(w, Ada, p).phase); n++) await w.tick(1);
  for (const [s, r] of [[Ada, p], [Bo, a]]) {const x = read(w, s, r); assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.shared.phase, 'ended'); assert.equal(x.shared.result, 'arrived');}
  assert.equal(inviteOf(w, id).state, 'closed'); assert.equal(E[beam].phase === 'carried', false);
  ok(await act(w, Bo, {capability: 'wave:here'}));
  assert.deepEqual(eng.runtime.violations, []);
});
