// #1150 rung 1 on a shared carry: a carrier or a load that would break a rule refuses the whole crew and the load in one
// tick. Cleanup is the carry's own set-down, the load is never dropped, every member's receipt says why, and the world
// neither rewinds nor pauses. A test invariant runs first in the end-of-tick pass, so what it does lands as a bad step would.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, seed, worldId} from '../../apps/server/test/native-owner-fixture.ts';
import {Db} from '../../apps/server/src/db.ts';
import {WorldHost} from '../../apps/server/src/world.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {marsFactory, GREEN_FIELD_WORLD} from '../../packages/engine-mars/src/engine.ts';
import {forgetMotion} from '../../mars/viewer/engine/runtime/invariants.ts';
import {carriedPose, carrierSpots} from '../../mars/viewer/engine/carry/formation.ts';

const repair = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true, soulsRepairV1: true}), today = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});

/** A trigger reintroduced: the bad step lands at a fixed tick in every runtime this factory makes, so it is there in each
 *  replay too, as a bug in the engine would be. Once per runtime, or the refusal's own second pass would take the step again. */
function triggered(base, control) {
  const wrap = (e) => { const rt = e.rt, fired = new WeakSet(); rt.invariants = [(r) => { if (r.tick === control.at && !fired.has(r)) { fired.add(r); control.step(r); } return []; }, ...rt.invariants]; return e; };
  return {...base, create: (w) => wrap(base.create(w)), restore: (s) => wrap(base.restore(s))};
}

async function world(t, factory = repair, path = ':memory:') {
  const f = fixture(path, factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry: true}), app = new Hono();
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => null});
  t.after(() => { try { comms.close(); f.host.stop(); f.db.close(); } catch { /* a restart test closed them itself */ } });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n && !f.host.paused; i++) { f.host.tickOnce(); await setImmediate(); if (!f.host.paused) f.host.drainInputs(); } };
  await tick();
  const souls = {};
  for (const name of ['Ada', 'Bo', 'Cy', 'Dee', 'Eve']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Refusal test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await tick();
  const E = f.host.engine.world.entities, [ax, , az] = E[souls.Ada.entityId].pose.p;
  const at = (s, x, z) => accept(f.host, f.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
  await at(souls.Bo, ax, az + 3); await at(souls.Cy, ax - 3, az - 5); await at(souls.Dee, ax + 5, az + 7); await at(souls.Eve, ax + 7, az + 7);
  assert.notEqual(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'pen', shape: {area: [[ax + 3, az + 12], [ax + 9, az + 12], [ax + 9, az + 15], [ax + 3, az + 15]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam2', p: [ax + 6, az + 8]},
  ]}).accepted, false);
  await tick(60);
  return {f, edge, god, comms, tick, souls, E, at, ax, az, beam: god.model.get('beam').id, beam2: god.model.get('beam2').id};
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = (w, s, input) => accept(w.f.host, w.edge.act(s, input));
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const force = (w, fn) => { const rt = w.f.host.engine.rt; let done = false; rt.invariants = [(r) => { if (done) return []; done = true; return fn(r) ?? []; }, ...rt.invariants]; };

/** Ada and Bo commit the carry; returns once the load is on its way (carried, and it has moved). */
async function carrying(w) {
  const {Ada, Bo} = w.souls, p = ok(await act(w, Ada, {capability: `carry-with:${w.beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  const from = [...w.E[w.beam].pose.p];
  for (let n = 0; n < 2000 && !(w.E[w.beam].phase === 'carried' && Math.hypot(w.E[w.beam].pose.p[0] - from[0], w.E[w.beam].pose.p[2] - from[2]) > 1); n++) await w.tick(1);
  assert.equal(w.E[w.beam].phase, 'carried');
  return {p, a, id};
}
async function refused(w, t, r, rule) {
  const {Ada, Bo} = w.souls, host = w.f.host, E = w.E, inv = () => w.edge.together.invite(r.id);
  let unsupported = 0, n = 0;
  for (; n < 1500 && inv().shared.op.phase !== 'ended'; n++) { await w.tick(1); if (E[w.beam].phase !== 'carried' && E[w.beam].support?.kind !== 'ground') unsupported++; }
  t.diagnostic(`ended after ${n} ticks: ${JSON.stringify(read(w, Ada, r.p))}`);
  assert.equal(host.paused, false); assert.equal(host.engineFault, null); assert.deepEqual(host.engine.runtime.violations, []);
  assert.equal(w.f.db.db.prepare("SELECT COUNT(*) n FROM events WHERE author='world:recovery'").get().n, 0, 'no rewind');
  assert.equal(unsupported, 0, 'the load is always carried or lying on the ground'); assert.equal(E[w.beam].support?.kind, 'ground');
  for (const [s, rc] of [[Ada, r.p], [Bo, r.a]]) {
    const x = read(w, s, rc); assert.equal(x.phase, 'failed', JSON.stringify(x)); assert.equal(x.code, `world.refused:${rule}`); assert.match(x.reason, /Nothing else changed/);
    assert.equal(E[s.entityId].human.grip ?? null, null, `${s.name}'s hands are free`);
  }
  const events = w.f.db.db.prepare("SELECT payload FROM events WHERE author='world:refusal'").all().map((e) => JSON.parse(e.payload).refusal);
  assert.equal(events.length, 1); assert.equal(events[0].rule, rule);
  assert.deepEqual([...events[0].bodies].sort(), [Ada.entityId, Bo.entityId, w.beam].sort(), 'the crew and the load together');
  assert.equal(host.glitches.byRule[rule].refusal, 1);
  for (const s of [Ada, Bo]) ok(await act(w, s, {capability: 'walk:yard'}));
  await w.tick(20); assert.deepEqual(host.engine.runtime.violations, []);
}

// These two forge the violation, so they prove the crew and the receipts, not the carry's own state: the step-driven scenes below do that.
test('the load would hit something: the whole crew and the load stop together, set down, and both Souls go free', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const w = await world(t), r = await carrying(w), {Ada, Bo} = w.souls;
  const before = [Ada.entityId, Bo.entityId, w.beam].map((id) => [...w.E[id].pose.p]);
  force(w, () => [{code: 'carry.load-static', message: 'forced', subjects: [w.beam]}]);
  w.f.host.tickOnce();
  [Ada.entityId, Bo.entityId, w.beam].forEach((id, i) => assert.ok(Math.hypot(w.E[id].pose.p[0] - before[i][0], w.E[id].pose.p[2] - before[i][2]) < 0.1, `${id} did not jump`));
  await refused(w, t, r, 'carry.load-static');
});

test('a carrier would walk into something: its partner and the load stop with it', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const w = await world(t), r = await carrying(w);
  force(w, () => [{code: 'collision.human-static', message: 'forced', subjects: [w.souls.Bo.entityId]}]);
  await refused(w, t, r, 'collision.human-static');
});

test('a walker refused for walking into a carried load is free on its next turn, and its receipt says why', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const w = await world(t), {Cy} = w.souls;
  const walk = ok(await act(w, Cy, {capability: 'walk:shed'})); await w.tick(10);
  force(w, () => [{code: 'collision.human-load', message: 'forced', subjects: [Cy.entityId, w.beam]}]);
  await w.tick(2);
  const x = read(w, Cy, walk); assert.equal(x.phase, 'failed', JSON.stringify(x)); assert.equal(x.code, 'world.refused:collision.human-load'); assert.match(x.reason, /carried load/);
  ok(await act(w, Cy, {capability: 'walk:yard'})); await w.tick(20); assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

const rungs = (host) => Object.values(host.glitches.byRule).reduce((n, r) => ({refusal: n.refusal + (r.refusal ?? 0), repair: n.repair + (r.recovery ?? 0) + (r.halt ?? 0)}), {refusal: 0, repair: 0});
/** Eve walks to the yard through whatever happens, and the tick her walk ended is the measure of "as if nothing happened". */
async function eveWalks(w, ticks) { const walk = ok(await act(w, w.souls.Eve, {capability: 'walk:yard'})); return async () => { await w.tick(ticks); return w.f.host.paused ? null : read(w, w.souls.Eve, walk); }; }

// A walker labelled `wait` at walking speed (#1120). Every replay reaches the same step, so today's recovery cannot repair it.
const detourLabel = (w, control) => (r) => { const h = r.world.entities[w.soul].human; h.activity = 'wait'; h.speed = 0.9; };
async function detourArm(t, base, on) {
  const control = {at: -1, step() {}}, w = await world(t, triggered(base, control)), {Cy} = w.souls;
  const walk = ok(await act(w, Cy, {capability: 'walk:shed'})), done = await eveWalks(w, 700);
  await w.tick(20);
  if (on) { control.step = detourLabel({soul: Cy.entityId}); control.at = w.f.host.engine.world.tick + 2; }
  const eve = await done();
  return {w, walk, eve};
}
test('A1 the #1120 label: today it rewinds or halts; refused, the world runs on and an unrelated walk ends on the same tick', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const old = await detourArm(t, today, true);
  assert.ok(rungs(old.w.f.host).repair > 0, 'the reintroduced trigger really is a fault today'); t.diagnostic(`today: paused ${old.w.f.host.paused}, ${JSON.stringify(old.w.f.host.glitches.byRule)}`);
  const clean = await detourArm(t, repair, false), now = await detourArm(t, repair, true), host = now.w.f.host;
  assert.equal(host.paused, false); assert.equal(host.engineFault, null); assert.deepEqual(rungs(host), {refusal: 1, repair: 0});
  const x = read(now.w, now.w.souls.Cy, now.walk); assert.equal(x.phase, 'failed', JSON.stringify(x)); assert.equal(x.code, 'world.refused:motion.overspeed');
  assert.equal(now.eve.phase, 'completed'); assert.equal(now.eve.endedTick, clean.eve.endedTick, 'Eve lost nothing');
  ok(await act(now.w, now.w.souls.Cy, {capability: 'walk:yard'}));
});

/** The running carry of `item`, from the runtime. */
const carryOf = (rt, item) => [...rt.live.values()].find((l) => l.rec.verb === 'carry' && l.exec.p?.item === item);
/** Point a carry's remaining route from `q` along `dir` for `length` m, as a stale route would be: the steps after this are the action's own. */
const aim = (ex, q, dir, length) => { ex.p.traj = {...ex.p.traj, poses: [q, {x: q.x + dir[0] * length, z: q.z + dir[1] * length, th: q.th}], u: [0, length]}; ex.u = 0; ex.i = 0; };

// The crews meet by the carry's own steps. Crew 1 stands still mid-carry (a stopped load); crew 2's route is laid so that its
// carrier walks into that load. Crew 2 is started with `perform`, and the route is laid by hand: no real scene has been
// found that does this, so this is the rule break, not the scene that first produced it.
async function twoCrews(t, base) {
  const w = await world(t, base), {Ada, Bo, Cy, Dee} = w.souls, host = w.f.host;
  await w.at(Cy, w.ax + 3, w.az + 7); await w.tick(5);
  const r = await carrying(w), rt = host.engine.rt, ex1 = carryOf(rt, w.beam).exec;
  const held = {u: ex1.u, i: ex1.i, q: {...ex1.q}, poses: [Ada.entityId, Bo.entityId, w.beam].map((id) => [id, structuredClone(w.E[id].pose)])};
  const hold = (x) => { const ex = carryOf(x, w.beam)?.exec; if (ex?.phase === 'move') { Object.assign(ex, {u: held.u, i: held.i, q: {...held.q}, v: 0}); for (const [id, pose] of held.poses) x.world.entities[id].pose = structuredClone(pose); } return []; };
  let laid = false;
  const lay = (x) => {
    const ex = carryOf(x, w.beam2)?.exec; if (laid || ex?.phase !== 'move') return []; laid = true;
    const E = x.world.entities, c = E[w.beam].pose.p, yaw = E[w.beam].pose.yaw, f = ex.p.f; let n = [-Math.sin(yaw), Math.cos(yaw)];
    if ((ex.q.x - c[0]) * n[0] + (ex.q.z - c[2]) * n[1] < 0) n = [-n[0], -n[1]];
    const d = [-n[0], -n[1]], s0 = carrierSpots(f, {x: 0, z: 0, th: 0})[0], th = Math.atan2(d[1], d[0]) - Math.atan2(s0[1], s0[0]), off = carrierSpots(f, {x: 0, z: 0, th})[0];
    const q = {x: c[0] + n[0] * 0.9 - off[0], z: c[2] + n[1] * 0.9 - off[1], th};
    aim(ex, q, d, 3); ex.v = 0.3; E[w.beam2].pose = carriedPose(f, q, ex.p.levelY);
    carrierSpots(f, q).forEach((p, i) => { E[ex.p.crew[i]].pose = {p: [p[0], ex.p.levelY, p[1]], yaw: th}; }); ex.q = q; forgetMotion(x); return [];
  };
  rt.invariants = [hold, lay, ...rt.invariants];
  const from = w.E[w.beam2].pose.p, adm = host.engine.perform({actor: Cy.entityId, label: 'carry', steps: [{verb: 'mars:carry', params: {crew: [Cy.entityId, Dee.entityId], item: w.beam2, to: {x: from[0] + 3, z: from[2] + 6, yaw: 0}}}]});
  assert.equal(adm.ok, true, JSON.stringify(adm));
  for (let n = 0; n < 900 && !laid; n++) await w.tick(1);
  assert.ok(laid); return {w, r, adm};
}
test('A1 two crews: a carrier walks into a stopped load by its own step. Today a rewind; refused, one refusal, and its crew backs off and sets down', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const old = await twoCrews(t, today); await old.w.tick(160);
  assert.ok(rungs(old.w.f.host).repair > 0, 'today it is a fault'); t.diagnostic(`today: paused ${old.w.f.host.paused}, ${JSON.stringify(old.w.f.host.glitches.byRule)}`);
  const {w} = await twoCrews(t, repair), host = w.f.host, E = w.E, walk = ok(await act(w, w.souls.Eve, {capability: 'walk:yard'})), ends = [], rtStep = host.engine.step.bind(host.engine);
  host.engine.step = () => { const o = rtStep(); ends.push(...o.programs.filter((p) => p.kind !== 'step')); return o; };
  let unsupported = 0;
  for (let n = 0; n < 700 && !(ends.length && E[w.beam2].support?.kind === 'ground'); n++) { await w.tick(1); if (E[w.beam2].phase !== 'carried' && E[w.beam2].support?.kind !== 'ground') unsupported++; }
  await w.tick(400);
  const refusals = w.f.db.db.prepare("SELECT payload FROM events WHERE author='world:refusal'").all().map((e) => JSON.parse(e.payload).refusal);
  t.diagnostic(`refusals ${JSON.stringify(refusals.map((r) => [r.tick, r.rule, r.bodies.length]))}; ends ${JSON.stringify(ends.map((e) => [e.tick, e.kind, e.code]))}`);
  assert.equal(host.paused, false); assert.equal(host.engineFault, null); assert.deepEqual(rungs(host), {refusal: 1, repair: 0}); assert.deepEqual(host.engine.runtime.violations, []);
  assert.equal(refusals[0].rule, 'collision.human-load'); assert.deepEqual([...refusals[0].bodies].sort(), [w.souls.Cy.entityId, w.souls.Dee.entityId, w.beam2].sort(), 'only the crew that moved');
  const end = ends.find((e) => e.actor === w.souls.Cy.entityId); assert.equal(end?.kind, 'failed'); assert.equal(end.code, 'world.refused:collision.human-load');
  assert.equal(unsupported, 0); assert.equal(E[w.beam2].support?.kind, 'ground', 'it lies on the ground'); assert.equal(E[w.beam].phase, 'carried', 'the stopped crew is untouched');
  assert.equal(E[w.souls.Cy.entityId].human.grip ?? null, null); assert.equal(read(w, w.souls.Eve, walk).phase, 'completed');
});

test('a load driven through a real box by its own step: refused once, the crew backs along its route and sets down clear', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const w = await world(t), {Ada, Bo} = w.souls, r = await carrying(w), rt = w.f.host.engine.rt, ex = carryOf(rt, w.beam).exec, dir = [Math.cos(ex.q.th), Math.sin(ex.q.th)];
  ok(w.god.act({ops: [{op: 'place', def: 'core/box@1', name: 'crate', p: [ex.q.x + dir[0] * 5, ex.q.z + dir[1] * 5]}]})); await w.tick(1);
  const sp = rt.services.spatial; sp.sync(rt.world); aim(ex, {...ex.q}, dir, 9);
  const inv = () => w.edge.together.invite(r.id); let at = null, n = 0;
  for (; n < 700 && inv().shared.op.phase !== 'ended'; n++) { ex.epoch = sp.epoch; await w.tick(1); if (ex.retreatTo !== undefined) at ??= {u: ex.u, q: {...ex.q}}; }
  assert.equal(w.f.host.paused, false); assert.deepEqual(rungs(w.f.host), {refusal: 1, repair: 0}); assert.deepEqual(w.f.host.engine.runtime.violations, []);
  for (const [s, rc] of [[Ada, r.p], [Bo, r.a]]) { const x = read(w, s, rc); assert.equal(x.phase, 'failed', JSON.stringify(x)); assert.equal(x.code, 'world.refused:carry.load-static'); }
  assert.ok(at, 'the crew backed off'); assert.equal(w.E[w.beam].support?.kind, 'ground');
  assert.ok(Math.hypot(w.E[w.beam].pose.p[0] - at.q.x, w.E[w.beam].pose.p[2] - at.q.z) > 0.5, 'set down behind where it was refused');
  for (const s of [Ada, Bo]) ok(await act(w, s, {capability: 'walk:yard'}));
});

test('one bad tick that names a whole crew is one refusal of its programme', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const w = await world(t), {Ada, Bo} = w.souls, r = await carrying(w), eng = w.f.host.engine;
  force(w, () => [Ada.entityId, Bo.entityId, w.beam].map((id) => ({code: 'motion.teleport', message: 'forced', subjects: [id]})));
  w.f.host.tickOnce();
  assert.deepEqual([...eng.programs.values()].map((p) => p.refusalsV1?.length), [1]);
  force(w, () => [{code: 'collision.human-static', message: 'forced', subjects: [Bo.entityId]}]);
  w.f.host.tickOnce(); await w.tick(1); assert.equal(rungs(w.f.host).repair, 0, 'a second refusal is still a refusal');
});

for (const clean of [false, true])
  test(`A4 a ${clean ? 'clean' : 'crash'} restart reaches the state the live world had, and the log says what was refused`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    const dir = mkdtempSync(join(tmpdir(), 'refuse-restart-')), path = join(dir, 'world.db'), control = {at: -1, step() {}}, factory = triggered(repair, control);
    const w = await world(t, factory, path), {Cy} = w.souls; let db2, h2;
    t.after(() => { try { h2?.stop(); db2?.close(); } catch { /* the first failure is the one that matters */ } rmSync(dir, {recursive: true, force: true}); });
    ok(await act(w, Cy, {capability: 'walk:shed'})); await w.tick(20);
    control.step = detourLabel({soul: Cy.entityId}); control.at = w.f.host.engine.world.tick + 2;
    await w.tick(40); assert.equal(rungs(w.f.host).refusal, 1);
    const hash = w.f.host.engine.stateHash(), tick = w.f.host.engine.world.tick;
    w.comms.close(); w.f.host.stop();
    if (clean) { w.f.host.drainInputs(); w.f.host.saveSnapshot(true); }
    w.f.db.close();
    const lines = []; t.mock.method(console, 'warn', (l) => lines.push(String(l)));
    db2 = new Db(path); h2 = new WorldHost(db2, factory, seed, 1e9, worldId, {durableClockV1: true}); h2.boot();
    assert.equal(h2.engine.world.tick, tick); assert.equal(h2.engine.stateHash(), hash); assert.equal(h2.paused, false);
    assert.equal(db2.db.prepare("SELECT COUNT(*) n FROM events WHERE author='world:refusal'").get().n, 1);
    assert.deepEqual(lines.filter((l) => /refusal count differs/.test(l)), []);
    assert.equal(h2.glitches.byRule['motion.overspeed'].refusal, 1, 'the count survives a restart');
  });

test('A4 a log whose refusals differ from the replay is reported and boots anyway', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'refuse-count-')), path = join(dir, 'world.db');
  const w = await world(t, repair, path); let db2, h2;
  t.after(() => { try { h2?.stop(); db2?.close(); } catch { /* the first failure is the one that matters */ } rmSync(dir, {recursive: true, force: true}); });
  await accept(w.f.host, w.f.host.enqueue('rules', 'world:refusal', {refusal: {tick: 1, rule: 'motion.teleport', bodies: [], programs: [], poses: {}}}));
  const hash = w.f.host.engine.stateHash();
  w.comms.close(); w.f.host.stop(); w.f.db.close();
  const lines = []; t.mock.method(console, 'warn', (l) => lines.push(String(l)));
  db2 = new Db(path); h2 = new WorldHost(db2, repair, seed, 1e9, worldId, {durableClockV1: true}); h2.boot();
  assert.equal(h2.engine.stateHash(), hash); assert.ok(lines.some((l) => /refusal count differs on replay: logged 1, replayed 0/.test(l)), lines.join());
});
