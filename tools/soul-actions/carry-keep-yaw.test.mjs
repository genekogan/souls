// #1031: a Soul carrying a loose beam to a place behind it lifts facing the other way along it. The native lift used
// to turn the beam half a turn in her hands there; the server's loose carries now ask the native carry to keep the
// load's own heading (`keepYawV1`), so it rises, travels and is laid down without turning.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {entityFrame} from '../../mars/viewer/engine/carry/formation.ts';

const turn = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

test('#1031 a loose beam carried to a place behind the Soul is lifted, carried and laid down without turning in her hands', {timeout: 120000}, async (t) => {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  const ok = (r) => { assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  await tick(); await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Reversed lift test'}));
  soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
  const b = f.host.engine.world.entities[soul.entityId], ax = b.pose.p[0], az = b.pose.p[2];
  // the beam lies along +x just east of Ana; the yard is well west of her, behind the beam's west end
  ok(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 12, az - 3], [ax - 7, az - 3], [ax - 7, az + 3], [ax - 12, az + 3]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
  ]}));
  await tick(60);
  const id = god.model.get('beam').id, E = () => f.host.engine.world.entities, lying = entityFrame(E()[id]).q.th;
  const r = ok(await accept(f.host, edge.act(soul, {capability: 'carry the beam', params: {to: 'yard'}})));
  assert.equal(r.receipt.capability, `carry:${id}`);
  const seen = {liftTurn: 0, setDownTurn: 0, maxStep: 0, carried: 0, raised: 0, reversed: null};
  let prev = E()[id].pose.yaw ?? 0, from = {phase: null, yaw: 0};
  for (let k = 0; k < 3000; k++) {
    await tick(1);
    const load = E()[id], me = E()[soul.entityId], yaw = load.pose.yaw ?? 0, act = me.human?.activity;
    seen.maxStep = Math.max(seen.maxStep, turn(prev, yaw)); prev = yaw;
    seen.raised = Math.max(seen.raised, load.pose.p[1]);
    const phase = act === 'lift' || act === 'set-down' ? act : null;
    if (phase && from.phase !== phase) from = {phase, yaw};
    if (phase === 'lift') seen.liftTurn = Math.max(seen.liftTurn, turn(from.yaw, yaw));
    if (phase === 'set-down') seen.setDownTurn = Math.max(seen.setDownTurn, turn(from.yaw, yaw));
    if (act === 'carry') { seen.carried++; seen.reversed ??= turn(me.pose.yaw, lying) > Math.PI / 2; }
    const p = edge.receipt(soul.soulId, r.receipt.id)?.phase; if (['failed', 'completed', 'replaced'].includes(p)) break;
  }
  const done = edge.receipt(soul.soulId, r.receipt.id), end = E()[id];
  console.log(JSON.stringify({...seen, liftTurn: +seen.liftTurn.toFixed(4), setDownTurn: +seen.setDownTurn.toFixed(4), maxStep: +seen.maxStep.toFixed(4)}));
  assert.equal(done.phase, 'completed', JSON.stringify(done));
  assert.match(done.outcome.summary, /^Carried beam and laid it on the ground in Yard/, done.outcome.summary);
  assert.equal(seen.reversed, true, 'Ana lifted facing the other way along the beam (the case #1031 is about)');
  assert.ok(seen.carried > 40 && seen.raised > 0.5, `carried ${seen.carried} ticks, raised to ${seen.raised}`);
  assert.ok(seen.liftTurn < 0.05, `lift turn ${seen.liftTurn.toFixed(3)} rad`);
  assert.ok(seen.setDownTurn < 0.05, `set-down turn ${seen.setDownTurn.toFixed(3)} rad`);
  assert.ok(seen.maxStep < 0.2, `largest one-tick turn ${seen.maxStep.toFixed(3)} rad`);
  assert.ok(end.pose.p[0] > ax - 12 - 0.6 && end.pose.p[0] < ax - 7 + 0.6 && Math.abs(end.pose.p[1]) < 0.05, `laid on the ground in the yard (${end.pose.p})`);
  assert.ok(turn(entityFrame(end).q.th, lying) < 0.05, 'still lying the way round it lay');
  assert.deepEqual(f.host.engine.runtime.violations, []);
});
