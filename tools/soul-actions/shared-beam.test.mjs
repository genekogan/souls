// PC14 (#693): on a real god world, two crews raise and hold two loose uprights (PC13), and two other Souls seat rack beams
// between them through the same invitation, op and receipts (docs/design/shared-execution.md). The frame's support is let
// go only once it stands on its own; a stop during a seating lowers the beam back; refusals before anyone is asked; the
// entity world keeps the joints; a restart keeps all of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory as plainFactory, seed, worldId} from '../../apps/server/test/native-owner-fixture.ts';
import {marsFactory, GREEN_FIELD_WORLD} from '../../packages/engine-mars/src/engine.ts';
import {Db} from '../../apps/server/src/db.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldHost} from '../../apps/server/src/world.ts';

const STEP_MS = 50, UP_L = 3.6576, UP_T = 0.0762, BEAM_L = 2.7432, D = BEAM_L + 2 * UP_T;
const factory = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
function mount(w, host, db, sharedCarry = true) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry, now: w.now}), app = new Hono();
  const comms = registerEdgeComms(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current}, {fading: true, beam: true, now: w.now, sweepMs: 0});
  edge.attachComms(comms); comms.fading.addHold((id) => edge.postureHold(id));
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  installEngineBridge({host, god, edge, log() {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god});
}
/** The bay: upright `fa` lies toward −x with its base at x0, `fb` toward +x with its base at x0 + D, so that standing their
 *  front faces are a beam's span apart; four beams lie in the bay, two under each column. */
async function world(t, {sharedCarry = true} = {}) {
  const names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay'];
  const dir = mkdtempSync(join(tmpdir(), 'pc14-beam-')), path = join(dir, 'sim.db'), opts = {durableClockV1: true};
  const f = fixture(path, sharedCarry ? factory : plainFactory, opts); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000}, w = {f, path, opts, clock, now: () => clock.now, current: null, hosts: [f.host]};
  t.after(() => {try {w.comms?.close();} catch {} for (const h of w.hosts) try {h.stop();} catch {} try {if (w.db.db.isOpen) w.db.close();} catch {} rmSync(dir, {recursive: true, force: true});});
  mount(w, f.host, f.db, sharedCarry);
  w.tick = async (n = 5) => {for (let i = 0; i < n; i++) {clock.now += STEP_MS; w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  await w.tick();
  const souls = {};
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}-owner`, {name, description: 'Shared beam test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await w.tick();
  const E = () => w.host.engine.world.entities, [ax, , az] = E()[souls.Ada.entityId].pose.p, x0 = ax + 4, z0 = az;
  w.at = async (s, x, z) => {await accept(w.host, w.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));};
  await w.at(souls.Ada, x0 + 0.6, z0 - 1.7); await w.at(souls.Bo, x0 + 0.6, z0 + 1.7);
  await w.at(souls.Cy, x0 + D - 0.6, z0 - 1.7); await w.at(souls.Dee, x0 + D - 0.6, z0 + 1.7);
  await w.at(souls.Eve, x0 + D / 2 - 0.5, z0 - 2.8); await w.at(souls.Fay, x0 + D / 2 + 0.5, z0 - 2.8);
  ok(w.god.act({ops: [
    {op: 'place', def: 'core/rack-upright@2', name: 'fa', p: [x0 - UP_L / 2, z0]}, {op: 'place', def: 'core/rack-upright@2', name: 'fb', p: [x0 + D + UP_L / 2, z0]},
    ...[-0.42, 0.42, -0.2, 0.2].map((dz, i) => ({op: 'place', def: 'core/rack-beam@3', name: `beam${i + 1}`, p: [x0 + D / 2, z0 + dz]}))]}));
  await w.tick(60);
  return Object.assign(w, {souls, ax, az, x0, z0, E, idOf: (n) => w.god.model.get(n).id});
}
const ok = (r) => {assert.notEqual(r.accepted, false, JSON.stringify(r)); return r;};
const act = async (w, s, input) => accept(w.host, w.edge.act(s, input));
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const until = async (w, done, max) => {for (let n = 0; n < max && !done(); n++) await w.tick(1);};
const offer = (w, s, id) => w.edge.capabilitiesPage(s, {all: true}).capabilities.find((c) => c.id === id);
const phaseOf = (w, c) => w.host.engine.programAction?.(c.op.programId)?.action.phase;
const standing = (x) => Math.abs(Math.abs(x.pose.roll ?? 0) - Math.PI / 2) < 1e-9;

/** Propose `cap` with `params`, each guest accepts revision 1, the world commits. */
async function commit(w, host, guests, cap, params) {
  const p = ok(await act(w, host, {capability: cap, params: {...params, with: guests.map((g) => g.name).join(' and ')}})), id = p.receipt.shared.invite;
  const accepts = [];
  for (const g of guests) accepts.push(ok(await act(w, g, {capability: `accept:${id}`, params: {revision: 1}})));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, host, p)));
  return {p, id, crew: [[host, p], ...guests.map((g, i) => [g, accepts[i]])], op: inviteOf(w, id).shared.op};
}
async function runTo(w, c, phase, max = 3000) {
  for (let n = 0; n < max && phaseOf(w, c) !== phase; n++) await w.tick(1);
  assert.equal(phaseOf(w, c), phase, JSON.stringify(w.host.engine.programAction?.(c.op.programId)?.action));
}
async function toEnd(w, c, max = 4000) {for (let n = 0; n < max && inviteOf(w, c.id).shared.op.phase !== 'ended'; n++) await w.tick(1); assert.equal(inviteOf(w, c.id).shared.op.phase, 'ended', JSON.stringify(inviteOf(w, c.id).shared.op));}
/** Both uprights raised and held: Ada and Bo hold fa, Cy and Dee hold fb. */
async function frames(w) {
  const {Ada, Bo, Cy, Dee} = w.souls;
  const a = await commit(w, Ada, [Bo], `raise-with:${w.idOf('fa')}`, {}), b = await commit(w, Cy, [Dee], `raise-with:${w.idOf('fb')}`, {});
  await runTo(w, a, 'hold'); await runTo(w, b, 'hold'); await w.tick(25);
  return {a, b};
}
/** Eve and Fay seat a beam in a column at a height. */
async function seat(w, beam, column, height) {
  const {Eve, Fay} = w.souls, id = w.idOf(beam);
  const o = offer(w, Eve, `connect-beam-with:${id}`); assert.equal(o?.available, true, JSON.stringify(o));
  const h = nearest(o, height);
  const c = await commit(w, Eve, [Fay], `connect-beam-with:${id}`, {column, height: h});
  await toEnd(w, c);
  assert.equal(inviteOf(w, c.id).shared.op.result, 'arrived', JSON.stringify(inviteOf(w, c.id).shared.op));
  for (const [s, r] of c.crew) assert.equal(read(w, s, r).phase, 'completed');
  return c;
}
/** The offered seat height nearest `h` (the ground under the bay sets the exact numbers). */
const nearest = (o, h) => {const e = [...o.params.height.description.matchAll(/\d+\.\d\d/g)].map((m) => +m[0]), best = [...e].sort((x, y) => Math.abs(x - h) - Math.abs(y - h))[0]; assert.ok(Math.abs(best - h) < 0.05, `${h} among ${e}`); return best;};
const hOf = (w, s, beam, h) => nearest(offer(w, s, `connect-beam-with:${w.idOf(beam)}`), h);
const joinsOf = (w, n) => w.god.model.get(n).joins ?? {};

test('R1 R2 R4: two held frames take four beams; the frame is let go only once it stands on its own', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Eve, Fay} = w.souls, fa = w.idOf('fa'), fb = w.idOf('fb');
  assert.equal(offer(w, Eve, `connect-beam-with:${w.idOf('beam1')}`), undefined, 'nothing to seat it in while the uprights lie');
  const {a, b} = await frames(w);
  const o = offer(w, Eve, `connect-beam-with:${w.idOf('beam1')}`);
  assert.equal(o?.available, true, JSON.stringify(o)); assert.deepEqual(o.params.column.enum, ['l', 'r']); assert.equal(o.params.height.type, 'number'); assert.ok([...o.label.matchAll(/\d+\.\d\d/g)].every((m) => +m[0] <= 2.07), o.label);
  assert.match(o.label, /^Seat beam1 between fa and fb with one other Soul, one at each end/);
  assert.equal(offer(w, Ada, `connect-beam-with:${w.idOf('beam1')}`)?.available, false, 'a Soul holding an upright has no hand free');

  const c1 = await seat(w, 'beam1', 'l', 0.76), x1 = w.E()[w.idOf('beam1')];
  assert.equal(x1.phase, 'installed'); assert.deepEqual(x1.support, {kind: 'connected', to: [fa, fb]});
  assert.equal(read(w, Eve, c1.p).code, 'shared.seated'); assert.match(read(w, Eve, c1.p).reason, /seated between fa and fb, in column l at 0\.\d\d m: both its ends are joined/);
  // the entity world keeps the joints, both halves, and the uprights standing
  await w.tick(20);
  const j = joinsOf(w, 'beam1'); assert.deepEqual(Object.values(j).map((x) => x.to).sort(), [fa, fb].sort(), JSON.stringify(j));
  for (const n of ['fa', 'fb']) {const e = w.god.model.get(n); assert.equal(Object.keys(e.joins ?? {}).length, 1, n); assert.ok(Array.isArray(e.r) && Math.abs(Math.abs(e.r[2]) - Math.PI / 2) < 0.002, `${n} stands in the entity world: ${JSON.stringify(e.r)}`);}

  // a stop now: the crew keeps holding, and says what is missing
  ok(await act(w, Ada, {capability: `stop-carry:${a.op.id}`})); await w.tick(30);
  assert.equal(w.E()[fa].support.kind, 'held'); assert.ok(standing(w.E()[fa]));
  const opA = inviteOf(w, a.id).shared.op; assert.equal(opA.phase, 'stopping'); assert.match(opA.stop.unsafe ?? '', /does not stand on its own yet/, JSON.stringify(opA));
  const why = read(w, Bo, a.crew[1][1]).reason; assert.match(why, /keep holding/); assert.match(why, /r column at 2 heights/); assert.match(why, /never lowered/);
  assert.match(why, /Ada and Bo keep holding fa: .*fa needs beams on its l column at 2 heights \(has 1\)/); assert.match(why, /until it stands on its own/);

  await seat(w, 'beam2', 'r', 0.76); await seat(w, 'beam3', 'l', 1.37);
  assert.equal(w.E()[fa].support.kind, 'held', 'three beams: not yet');
  await seat(w, 'beam4', 'r', 1.37);
  await toEnd(w, a);
  const A = w.E()[fa]; assert.equal(A.phase, 'installed'); assert.equal(A.support.kind, 'connected'); assert.equal(A.support.to.length, 4); assert.ok(standing(A));
  assert.equal(inviteOf(w, a.id).shared.op.result, 'stopped'); assert.match(read(w, Ada, a.p).reason, /stands on its own/);
  for (const s of [Ada, Bo]) assert.equal(w.E()[s.entityId].human.grip, undefined, `${s.name} let go`);
  assert.equal(w.E()[fb].support.kind, 'held', 'fb is still held by its own crew');
  ok(await act(w, Cy, {capability: `stop-carry:${b.op.id}`})); await toEnd(w, b);
  assert.equal(w.E()[fb].phase, 'installed'); assert.match(read(w, Cy, b.p).reason, /stands on its own/);
  await w.tick(30);
  assert.deepEqual((w.host.engine.rt?.violations ?? []).filter((v) => /^(beam|support|raise)\./.test(v.code)), [], 'no frame or beam invariant fired');
  for (const n of ['fa', 'fb']) assert.equal(Object.keys(joinsOf(w, n)).length, 4, `${n} has its four joints in the entity world`);
  for (const s of [Eve, Fay]) assert.equal(w.E()[s.entityId].human.grip, undefined);
});

test('R3 R6: refused before anyone is asked, and a beam on a claimed load or a taken seat', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Cy, Dee, Eve, Fay} = w.souls, beam = w.idOf('beam1');
  await frames(w);
  const code = async (s, cap, params) => {const r = await act(w, s, {capability: cap, params}); assert.equal(r.accepted, false, JSON.stringify(r)); return r;};
  assert.equal((await code(Eve, `connect-beam-with:${beam}`, {column: 'l', height: hOf(w, Eve, 'beam1', 0.76), with: 'Fay and Ada'})).code, 'beam.crew');
  assert.equal((await code(Eve, `connect-beam-with:${beam}`, {column: 'l', with: 'Fay'})).code, 'capability.params');
  assert.match((await code(Eve, `connect-beam-with:${beam}`, {column: 'l', height: 2.9, with: 'Fay'})).reason, /column l at /);
  assert.equal((await code(Ada, `connect-beam-with:${beam}`, {column: 'l', height: hOf(w, Eve, 'beam1', 0.76), with: 'Fay'})).code, 'carry.hands-full');
  // one proposal at a time on a load; a second is refused while the first is open or running
  const h76 = hOf(w, Eve, 'beam1', 0.76), first = ok(await act(w, Eve, {capability: `connect-beam-with:${beam}`, params: {column: 'l', height: h76, with: 'Fay'}})), id = first.receipt.shared.invite;
  ok(await act(w, Fay, {capability: `accept:${id}`, params: {revision: 1}})); await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  await w.tick(3);
  const second = await act(w, Fay, {capability: `connect-beam-with:${beam}`, params: {column: 'l', height: h76, with: 'Eve'}}); assert.equal(second.accepted, false, JSON.stringify(second));
  await toEnd(w, {id});
  // the seat it took is no longer offered to the next beam, nor can it be asked for
  const o2 = offer(w, Eve, `connect-beam-with:${w.idOf('beam3')}`); assert.ok(o2, 'beam3 is offered');
  const taken = await act(w, Eve, {capability: `connect-beam-with:${w.idOf('beam3')}`, params: {column: 'l', height: h76, with: 'Fay'}});
  assert.equal(taken.accepted, false); assert.match(taken.reason ?? '', /Choose a column and a seat height/);
  for (const s of [Cy, Dee]) assert.equal(w.E()[s.entityId].human.grip?.entity, w.idOf('fb'), 'the holders were never asked');
});

test('R5: a stop before the lift lets go; during the lift the beam comes back down where it lay', {timeout: 600000}, async (t) => {
  const w = await world(t), {Eve, Fay} = w.souls, beam = w.idOf('beam1');
  await frames(w);
  const start = structuredClone(w.E()[beam].pose);
  for (const when of ['approach', 'lift']) {
    const c = await commit(w, Eve, [Fay], `connect-beam-with:${beam}`, {column: 'l', height: hOf(w, Eve, 'beam1', 1.37)});
    await runTo(w, c, when); if (when === 'lift') {await w.tick(20); assert.ok(w.E()[beam].pose.p[1] > start.p[1] + 0.05, 'off the ground');}
    ok(await act(w, Fay, {capability: `stop-carry:${c.op.id}`}));
    assert.match(read(w, Eve, c.p).reason, when === 'lift' ? /lower .* back where it lay/ : /let go of it where it lies/);
    await toEnd(w, c);
    const x = w.E()[beam]; assert.deepEqual(x.pose, start, when); assert.deepEqual(x.support, {kind: 'ground'}); assert.equal(x.phase, 'staged'); assert.equal(x.connections, undefined);
    assert.equal(inviteOf(w, c.id).shared.op.result, 'stopped'); assert.match(read(w, Eve, c.p).reason, when === 'lift' ? /lowered back where it lay/ : /never lifted/);
    for (const s of [Eve, Fay]) assert.equal(w.E()[s.entityId].human.grip, undefined, `${when}: ${s.name} let go`);
    assert.deepEqual(joinsOf(w, 'beam1'), {}, 'no joint in the entity world');
  }
});

/** A new process on the same database. `clean`: a final snapshot first; else only what was logged. */
async function restart(w, clean) {
  w.comms.close(); w.host.stop();
  if (clean) {w.host.drainInputs(); w.host.saveSnapshot(true);}
  w.db.close();
  const db = new Db(w.path), h = new WorldHost(db, factory, seed, 1e9, worldId, w.opts), boot = h.boot(); h.drainInputs();
  w.hosts.push(h); mount(w, h, db); await w.tick(5);
  return boot;
}
for (const clean of [true, false]) test(`R7: a ${clean ? 'clean' : 'crash'} restart during the lift and after seating while held`, {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Eve} = w.souls, beam = w.idOf('beam1'), fa = w.idOf('fa');
  const {a} = await frames(w);
  const c = await commit(w, Eve, [w.souls.Fay], `connect-beam-with:${beam}`, {column: 'l', height: hOf(w, Eve, 'beam1', 0.76)});
  await runTo(w, c, 'lift'); await w.tick(15);
  await restart(w, clean);
  assert.equal(w.host.engine.programOf(w.E()[Eve.entityId].id), c.op.programId, 'the same programme');
  assert.equal(w.E()[beam].support.kind, 'held', 'still in their hands');
  await toEnd(w, c); assert.equal(inviteOf(w, c.id).shared.op.result, 'arrived');
  await w.tick(20);
  await restart(w, clean);
  assert.equal(w.E()[beam].phase, 'installed'); assert.deepEqual(w.E()[beam].connections.map((x) => x.to).sort(), [fa, w.idOf('fb')].sort());
  assert.equal(w.E()[fa].support.kind, 'held'); assert.ok(standing(w.E()[fa]), 'still standing, held');
  assert.equal(read(w, Ada, a.p).phase, 'started');
  assert.equal(Object.keys(joinsOf(w, 'beam1')).length, 2, 'the entity world kept both joints');
  ok(await act(w, Ada, {capability: `stop-carry:${a.op.id}`})); await w.tick(30);
  assert.equal(w.E()[fa].support.kind, 'held', 'one beam: kept held'); assert.equal(inviteOf(w, a.id).shared.op.phase, 'stopping');
});

test('R8: with the flag off nothing is offered', {timeout: 300000}, async (t) => {
  const w = await world(t, {sharedCarry: false});
  assert.equal(offer(w, w.souls.Eve, `connect-beam-with:${w.idOf('beam1')}`), undefined);
});
