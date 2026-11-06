// PC16 (#695): on a real god world, stairs go up to a rack deck that no step reaches: two Souls set a stair flight up
// against the bay's outer beam, its header on the beam's ledge, through the same invitation, op and receipts as the
// other shared operations (docs/design/shared-execution.md); one Soul sets its five treads one by one. The flight is a
// stairs link from the ground to the deck that is walked only once every tread is in; a Soul who built none of it walks
// up; a removal that would drop someone is refused.
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

const STEP_MS = 50, IN = 0.0254, T = 3 * IN, UP_L = 12 * 0.3048, BEAM_L = 9 * 0.3048, BEAM_H = 4 * IN, ZC = 2 * 0.3048 - 1.5 * IN, GAP = 0.001;
const SPAN = 24 * IN, LEDGE_Y = BEAM_H - 1.625 * IN, JOIST_H = 3.5 * IN, PLY_T = 0.75 * IN;
const seat = (i) => 12 * IN + 6 * IN * i;
const factory = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
const LOW = 4, HIGH = 18, LEDGE_AT = seat(LOW) - BEAM_H / 2 + LEDGE_Y, DECK_Y = LEDGE_AT + JOIST_H + PLY_T;

/** A stable bay a god builds: two uprights standing face to face, step beams (@4) at seat 0 (12 in) on both columns and
 *  beams at seat 14 (8 ft, over a head on the deck) above them, all joined; upright a's base centre at (x0, z0), the bay toward −x. */
/** The bay's middle (x). */
const bayMid = (x0) => x0 - T - GAP - BEAM_L / 2;
function mount(w, host, db, sharedCarry = true) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry, now: w.now}), app = new Hono();
  const comms = registerEdgeComms(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current}, {fading: true, beam: true, now: w.now, sweepMs: 0});
  edge.attachComms(comms); comms.fading.addHold((id) => edge.postureHold(id));
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  const bridge = installEngineBridge({host, god, edge, log: process.env.STAIRS_LOG ? (m) => console.log("[bridge]", m) : () => {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god, bridge});
}
async function world(t, {sharedCarry = true, names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve']} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc16-stairs-')), path = join(dir, 'sim.db'), opts = {durableClockV1: true};
  const f = fixture(path, sharedCarry ? factory : plainFactory, opts); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000}, w = {f, path, opts, clock, now: () => clock.now, current: null, hosts: [f.host]};
  t.after(() => {try {w.comms?.close();} catch {} for (const h of w.hosts) try {h.stop();} catch {} try {if (w.db.db.isOpen) w.db.close();} catch {} rmSync(dir, {recursive: true, force: true});});
  mount(w, f.host, f.db, sharedCarry);
  w.tick = async (n = 5) => {for (let i = 0; i < n; i++) {clock.now += STEP_MS; w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  await w.tick();
  const souls = {};
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}-owner`, {name, description: 'Shared stairs test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await w.tick();
  const E = () => w.host.engine.world.entities, [ax, , az] = E()[souls.Ada.entityId].pose.p;
  w.at = async (s, x, z) => {await accept(w.host, w.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));};
  return Object.assign(w, {souls, ax, az, E, idOf: (n) => w.god.model.get(n).id});
}
const ok = (r) => {assert.notEqual(r.accepted, false, JSON.stringify(r)); return r;};
const act = async (w, s, input) => accept(w.host, w.edge.act(s, input));
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const until = async (w, done, max) => {for (let n = 0; n < max && !done(); n++) await w.tick(1);};
const floorsOf = (w, id) => w.host.engine.world.entityPhysicsV1?.byEntity?.[id]?.surfaces ?? [];
const inviteOf = (w, id) => w.edge.together.invite(id);
const offer = (w, s, id) => w.edge.capabilitiesPage(s, {all: true}).capabilities.find((c) => c.id === id);
const phaseOf = (w, c) => w.host.engine.programAction?.(c.op.programId)?.action.phase;
const joinsOf = (w, n) => w.god.model.get(n).joins ?? {};
async function walkTo(w, s, place) {
  const cap = w.edge.capabilities(s).find((c) => c.verb === 'walk' && c.id === `walk:${place}`);
  assert.ok(cap?.available, JSON.stringify(w.edge.capabilities(s).filter((c) => c.verb === 'walk').map((c) => [c.id, c.label, c.available])));
  const r = ok(await act(w, s, {capability: cap.id}));
  await until(w, () => ['completed', 'failed', 'replaced'].includes(read(w, s, r)?.phase), 3000);
  return read(w, s, r);
}
/** Propose `cap` with `params`, the guest accepts revision 1, the world commits. */
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
/** The stock a god pre-delivers (R10): a stable bay with step beams (@5) at seat 4 and beams at seat 18 (heads clear the
 *  deck) on both columns, all joined; five joists on the low beams' ledges and a sheet on them (the deck, top 1.03 m);
 *  a loose stair flight standing beside the bay's +z side; five loose treads lying by it. Upright a's base centre at
 *  (x0, z0), the bay toward −x. */
export function stock(x0, z0, {flight = true, treads = true} = {}) {
  const bx = x0 - 2 * T - BEAM_L - 2 * GAP, xm = bayMid(x0), ops = [
    {op: 'place', tmp: '$a', name: 'bay-upright-a', def: 'core/rack-upright@2', p: [x0, UP_L / 2, z0], r: [0, 0, Math.PI / 2], anchor: 'center'},
    {op: 'place', tmp: '$b', name: 'bay-upright-b', def: 'core/rack-upright@2', p: [bx, UP_L / 2, z0], r: [Math.PI, 0, Math.PI / 2], anchor: 'center'},
  ];
  for (const i of [LOW, HIGH]) for (const [dz, aSide, bSide] of [[-ZC, 'l', 'r'], [ZC, 'r', 'l']]) {
    const t = `$b${i}${aSide}`;
    ops.push({op: 'place', tmp: t, name: `bay-beam-${i}${aSide}`, def: 'core/rack-beam@5', p: [xm, seat(i) - BEAM_H / 2, z0 + dz], r: 0, anchor: 'center'});
    ops.push({op: 'connect', a: {id: t, connector: 'end-r'}, b: {id: '$a', connector: `front-${aSide}-${i}`}});
    ops.push({op: 'connect', a: {id: t, connector: 'end-l'}, b: {id: '$b', connector: `front-${bSide}-${i}`}});
  }
  for (const k of [0, 1, 2, 3, 4]) {
    ops.push({op: 'place', tmp: `$j${k}`, name: `bay-joist-${k}`, def: 'core/deck-joist@1', p: [xm + (k - 2) * SPAN, LEDGE_AT, z0], r: Math.PI / 2, anchor: 'center'});
    ops.push({op: 'connect', a: {id: `$j${k}`, connector: 'end-r'}, b: {id: `$b${LOW}l`, connector: `joist-b-${k}`}});
    ops.push({op: 'connect', a: {id: `$j${k}`, connector: 'end-l'}, b: {id: `$b${LOW}r`, connector: `joist-a-${k}`}});
  }
  ops.push({op: 'place', tmp: '$s', name: 'bay-sheet', def: 'core/plywood-sheet@2', p: [xm, LEDGE_AT + JOIST_H, z0], r: 0, anchor: 'center'});
  for (const k of [0, 1, 2, 3, 4]) ops.push({op: 'connect', a: {id: '$s', connector: `on-${k}`}, b: {id: `$j${k}`, connector: 'top'}});
  if (flight) ops.push({op: 'place', def: 'core/stair-flight@1', name: 'flight', p: [xm + 1.7, z0 + 2.6], r: Math.PI / 2});
  if (treads) for (const i of [1, 2, 3, 4, 5]) ops.push({op: 'place', def: 'core/stair-tread@1', name: `tread-${i}`, p: [xm - 1.5, z0 + 1.3 + 0.4 * i], r: 0});
  return ops;
}
const linkOf = (w, id) => (w.host.engine.world.entityPhysicsV1?.byEntity?.[id]?.links ?? []).find((l) => l.kind === 'stairs');
/** The stock, the crews outside the bay's +z side, Eve further off, Cy by the treads. */
async function site(t, opts = {}) {
  const w = await world(t, opts), x0 = w.ax + 6, z0 = w.az, xm = bayMid(x0);
  ok(w.god.act({ops: stock(x0, z0, opts)}));
  await w.tick(40);
  Object.assign(w, {x0, z0, xm});
  await home(w);
  return w;
}
async function home(w) {
  const {Ada, Bo, Cy, Eve} = w.souls;
  await w.at(Ada, w.xm + 0.6, w.z0 + 3.6); await w.at(Bo, w.xm + 2.8, w.z0 + 3.6); await w.at(Cy, w.xm - 2.4, w.z0 + 2.4); await w.at(Eve, w.xm + 3.5, w.z0 + 5);
  await w.tick(5);
}
/** Ada and Bo set the flight at its middle seat, and step back. */
async function hang(w) {
  const {Ada, Bo} = w.souls, c = await commit(w, Ada, [Bo], `install-flight-with:${w.idOf('flight')}`, {at: 0});
  await toEnd(w, c); assert.equal(inviteOf(w, c.id).shared.op.result, 'arrived', JSON.stringify(inviteOf(w, c.id).shared.op));
  await w.at(Ada, w.xm + 1.6, w.z0 + 4); await w.at(Bo, w.xm + 2.6, w.z0 + 4); await w.tick(20);
  return c;
}
/** Cy sets tread i (the lowest missing) by its offer. */
async function setTread(w, i) {
  const {Cy} = w.souls, id = w.idOf(`tread-${i}`), o = offer(w, Cy, `install-tread:${id}`);
  assert.equal(o?.available, true, JSON.stringify(o));
  const r = ok(await act(w, Cy, {capability: o.id}));
  await until(w, () => ['completed', 'failed', 'replaced'].includes(read(w, Cy, r)?.phase), 3000);
  assert.equal(read(w, Cy, r).phase, 'completed', JSON.stringify(read(w, Cy, r)));
  await w.tick(15);
  return o;
}

test('PC16 R1 R2 R4 R5: two Souls set the flight, one Soul its five treads; walked only once every tread is in; a Soul who built none of it walks up onto the deck', {timeout: 900000}, async (t) => {
  const w = await site(t), {Ada, Bo, Cy, Eve} = w.souls, flight = w.idOf('flight'), sheet = w.idOf('bay-sheet');
  const f = floorsOf(w, sheet); assert.equal(f.length, 1); assert.ok(f[0].level > 0 && Math.abs(f[0].y - DECK_Y) < 0.003, JSON.stringify(f));
  assert.equal(w.host.engine.world.entityPhysicsV1.byEntity[sheet].links, undefined, 'a deck 1.03 m up has no step');
  assert.equal(linkOf(w, flight), undefined, 'a loose flight is no stairs');
  const walkCap = () => w.edge.capabilities(Eve).find((c) => c.id === 'walk:bay-sheet');
  const before = walkCap(); assert.equal(before?.available, false, JSON.stringify(before)); t.diagnostic(`before the stairs: ${JSON.stringify(before.blocked)}`);
  // R1: offered with its free positions on the deck's outer beam; no tread offered before the flight hangs
  const o = offer(w, Ada, `install-flight-with:${flight}`);
  assert.equal(o?.available, true, JSON.stringify(o)); assert.match(o.label, /^Set flight up against bay-beam-4r with one other Soul, its header on the beam's ledge/);
  assert.deepEqual([...o.params.at.description.matchAll(/-?\d+\.\d\d/g)].map((m) => +m[0]), [-1.22, -0.61, 0, 0.61, 1.22]);
  assert.equal(offer(w, Cy, `install-tread:${w.idOf('tread-1')}`), undefined);
  // R2: they take hold and lift it in
  const c = await commit(w, Ada, [Bo], `install-flight-with:${flight}`, {at: 0});
  await runTo(w, c, 'lift'); await w.tick(10);
  const F0 = w.E()[flight]; assert.equal(F0.support.kind, 'held'); assert.deepEqual(F0.support.by.sort(), [Ada.entityId, Bo.entityId].sort());
  for (const s of [Ada, Bo]) assert.equal(w.E()[s.entityId].human.grip?.entity, flight, `${s.name} has a hand on it`);
  await toEnd(w, c); await w.at(Ada, w.xm + 1.6, w.z0 + 4); await w.at(Bo, w.xm + 2.6, w.z0 + 4); await w.tick(30);
  assert.equal(read(w, Ada, c.p).code, 'shared.seated'); assert.match(read(w, Ada, c.p).reason, /is set up against bay-beam-4r, 0\.00 m from its middle: its header hangs on the beam's ledge and its foot stands on the ground/);
  const F = w.E()[flight]; assert.equal(F.phase, 'installed'); assert.deepEqual(F.support, {kind: 'connected', to: [w.idOf('bay-beam-4r')]});
  assert.ok(Math.abs(F.pose.p[1]) < 0.01, `its foot on the ground: ${F.pose.p}`);
  assert.deepEqual(joinsOf(w, 'flight'), {hook: {to: w.idOf('bay-beam-4r'), at: 'joist-b-2'}}, 'the entity world keeps the joint');
  // R4: a stairs link, there but not walked: no treads
  let l = linkOf(w, flight); assert.ok(l, 'a hanging flight is a stairs link');
  assert.equal(l.usable, false); assert.equal(l.reason, 'treads 1–5 missing'); assert.equal(l.to.level, f[0].level); assert.ok(Math.abs(l.to.y - DECK_Y) < 0.01, JSON.stringify(l.to));
  // the menu's connectivity may not be warm yet; either it says so, or the walk itself is refused naming the stairs' reason
  const half = walkCap();
  if (half?.available) {
    const r = await act(w, Eve, {capability: half.id}); t.diagnostic(`walk with the treads missing: ${JSON.stringify(r).slice(0, 400)}`);
    assert.equal(r.accepted, false, JSON.stringify(r)); assert.equal(r.code, 'route.link-unusable'); assert.match(r.reason, /The way there needs stairs that are not finished: treads 1–5 missing\./);
  } else assert.match(JSON.stringify(half.blocked), /treads 1–5 missing|no stair or ramp/, JSON.stringify(half));
  assert.equal(w.E()[Eve.entityId].human.level ?? 0, 0, 'still on the ground');
  // R1 R2: Cy sets the treads, bottom up
  for (const i of [1, 2, 3]) { const to = await setTread(w, i); assert.match(to.label, new RegExp(`^Set tread-${i} into flight as tread ${i}`)); }
  l = linkOf(w, flight); assert.equal(l.usable, false); assert.equal(l.reason, 'treads 4, 5 missing');
  for (const i of [4, 5]) await setTread(w, i);
  for (const i of [1, 2, 3, 4, 5]) { const tr = w.E()[w.idOf(`tread-${i}`)]; assert.equal(tr.phase, 'installed'); assert.deepEqual(tr.support, {kind: 'connected', to: [flight]}); }
  assert.equal(Object.keys(joinsOf(w, 'flight')).length, 6, 'the hook and five tread seats joined in the entity world');
  l = linkOf(w, flight); assert.equal(l.usable, true, JSON.stringify(l)); assert.equal(l.reason, undefined);
  assert.deepEqual((w.host.engine.rt?.violations ?? []).filter((v) => /^(beam|support|deck|stair)\./.test(v.code)), [], 'no frame, deck or stair invariant fired');
  // R5: Eve walks up the stairs onto the deck
  const up = await walkTo(w, Eve, 'bay-sheet');
  const E = w.E()[Eve.entityId]; assert.equal(up.phase, 'completed', JSON.stringify(up));
  assert.equal(E.human.level, f[0].level); assert.ok(Math.abs(E.pose.p[1] - f[0].y) < 0.01, `stands on the deck: ${E.pose.p}`);
  // a Soul is never offered to take an installed flight or tread
  for (const n of ['flight', 'tread-3']) {const x = offer(w, Ada, `carry:${w.idOf(n)}`); assert.ok(!x?.available, `${n}: ${JSON.stringify(x)}`);}
});

test('PC16 R6: nothing is taken from under someone on the stairs; the support rule keeps a hanging flight\'s beam', {timeout: 900000}, async (t) => {
  const w = await site(t), {Eve} = w.souls, flight = w.idOf('flight');
  await hang(w); for (const i of [1, 2, 3, 4, 5]) await setTread(w, i);
  // Eve on her way up: caught on the flight
  const cap = w.edge.capabilities(Eve).find((c) => c.id === 'walk:bay-sheet'); ok(await act(w, Eve, {capability: cap.id}));
  const F = w.E()[flight], on = () => { const p = w.E()[Eve.entityId].pose.p, dx = p[0] - F.pose.p[0], dz = p[2] - F.pose.p[2], c = Math.cos(F.pose.yaw), s = Math.sin(F.pose.yaw); return Math.abs(dx * c + dz * s) < 0.6 && Math.abs(-dx * s + dz * c) < 0.4 && p[1] > 0.2; };
  await until(w, on, 3000); assert.ok(on(), `Eve on the flight: ${w.E()[Eve.entityId].pose.p}`);
  for (const op of [{op: 'remove', id: 'tread-3'}, {op: 'disconnect', a: {id: 'tread-3', connector: 'seat'}}, {op: 'move', id: 'flight', in: {parent: 'world'}, p: [w.xm + 3, w.z0 + 4], r: 0}, {op: 'remove', id: 'flight'}]) {
    const r = w.god.act({ops: [op]}); assert.equal(r.accepted, false, JSON.stringify(op)); assert.equal(r.failures[0].code, 'stair.occupied', JSON.stringify(r)); assert.match(r.failures[0].detail, /Eve is on flight/);
  }
  await until(w, () => (w.E()[Eve.entityId].human.level ?? 0) > 0 && !on(), 3000); await w.tick(10);
  // off it (on the deck): a tread may go; the stairs are no longer walked, and say why
  ok(w.god.act({ops: [{op: 'remove', id: 'tread-3'}]})); await w.tick(30);
  const l = linkOf(w, flight); assert.equal(l.usable, false); assert.equal(l.reason, 'tread 3 missing');
  // the beam a flight hangs on is not taken away (PC12's support rule)
  const r = w.god.act({ops: [{op: 'remove', id: 'bay-beam-4r'}]}); assert.equal(r.accepted, false); assert.match(JSON.stringify(r.failures), /support\.none|deck\.occupied/);
});

test('PC16 R3: refused before anyone is asked: wrong crew, a position with no free seat, full hands, a beam that does not fit, someone where it goes', {timeout: 600000}, async (t) => {
  const w = await site(t), {Ada, Bo, Cy, Eve} = w.souls, flight = w.idOf('flight'), cap = `install-flight-with:${flight}`, eng = w.host.engine;
  const refused = async (s, c, params) => {const r = await act(w, s, {capability: c, params}); assert.equal(r.accepted, false, JSON.stringify(r)); return r;};
  assert.equal((await refused(Ada, cap, {at: 0, with: 'Bo and Cy'})).code, 'stair.crew');
  assert.match((await refused(Ada, cap, {at: 0.3, with: 'Bo'})).reason, /Choose where along the beam flight goes \(at: metres from the beam's middle\): -1\.22, -0\.61, 0\.00, 0\.61, 1\.22/);
  const beam = w.idOf('bay-beam-4r'), crew = [Ada.entityId, Bo.entityId];
  assert.equal(eng.previewMarsVerbV1('install_flight_v1', {crew, flight, beam, seat: 'joist-b-2'}), null, 'the plan is clear');
  assert.equal(eng.previewMarsVerbV1('install_flight_v1', {crew, flight, beam, seat: 'joist-a-2'})?.code, 'stair.occupied', 'the bay side holds a joist');
  assert.equal(eng.previewMarsVerbV1('install_flight_v1', {crew, flight, beam: w.idOf(`bay-beam-${HIGH}r`), seat: 'joist-b-2'})?.code, 'stair.rise', 'a beam at another height does not fit');
  // someone standing where it goes: refused before anyone is asked
  await w.at(Eve, w.xm, w.z0 + 1.3); await w.tick(5);
  assert.equal(eng.previewMarsVerbV1('install_flight_v1', {crew, flight, beam, seat: 'joist-b-2'})?.code, 'stair.site-occupied');
  const busy = await refused(Ada, cap, {at: 0, with: 'Bo'}); assert.equal(busy.code, 'stair.site-occupied', JSON.stringify(busy)); assert.match(busy.reason, /Nobody was asked/);
  await home(w);
  // a tread before the flight hangs: not offered; the engine names it
  assert.equal(eng.previewMarsVerbV1('install_tread_v1', {crew: [Cy.entityId], tread: w.idOf('tread-1'), flight, index: 1})?.code, 'tread.no-stair');
});

test('PC16 R7: a stop before the lift lets go; during it the flight or a tread comes back down where it was; nothing joined, no stairs', {timeout: 900000}, async (t) => {
  const w = await site(t), {Ada, Bo, Cy} = w.souls, id = w.idOf('flight'), start = structuredClone(w.E()[id].pose);
  for (const when of ['approach', 'lift']) {
    const c = await commit(w, Ada, [Bo], `install-flight-with:${id}`, {at: 0});
    await runTo(w, c, when); if (when === 'lift') {const moved = () => Math.hypot(...w.E()[id].pose.p.map((v, i) => v - start.p[i])) > 0.1; await until(w, moved, 400); assert.ok(moved(), `on its way: ${w.E()[id].pose.p}`); assert.equal(w.E()[id].support.kind, 'held');}
    ok(await act(w, Bo, {capability: `stop-carry:${c.op.id}`}));
    await toEnd(w, c);
    const x = w.E()[id]; assert.deepEqual(x.pose, start, when); assert.deepEqual(x.support, {kind: 'ground'}); assert.equal(x.phase, 'staged'); assert.equal(x.connections, undefined);
    assert.equal(inviteOf(w, c.id).shared.op.result, 'stopped');
    for (const s of [Ada, Bo]) assert.equal(w.E()[s.entityId].human.grip, undefined, `${when}: ${s.name} let go`);
    await w.tick(20);
    assert.deepEqual(joinsOf(w, 'flight'), {}); assert.equal(linkOf(w, id), undefined);
    assert.equal([...w.god.model.entities.values()].filter((e) => e.name === 'flight').length, 1, 'one part, no copy');
    await home(w);
  }
  // a tread stopped in the air (its receipt ends) comes back down where it lay
  await hang(w);
  const tid = w.idOf('tread-1'), t0 = structuredClone(w.E()[tid].pose), o = offer(w, Cy, `install-tread:${tid}`);
  const r = ok(await act(w, Cy, {capability: o.id}));
  await until(w, () => w.E()[tid].pose.p[1] > t0.p[1] + 0.05, 3000);
  ok(await act(w, Cy, {capability: 'stop'}));
  await until(w, () => !['started', 'running', 'waiting'].includes(read(w, Cy, r)?.phase), 3000); await w.tick(80);
  const x = w.E()[tid]; assert.deepEqual(x.pose, t0, JSON.stringify(read(w, Cy, r))); assert.equal(x.phase, 'staged'); assert.deepEqual(joinsOf(w, 'tread-1'), {});
  assert.deepEqual((w.host.engine.rt?.violations ?? []).filter((v) => /^(beam|support|deck|stair)\./.test(v.code)), []);
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
for (const clean of [true, false]) test(`PC16 R8: a ${clean ? 'clean' : 'crash'} restart during the flight's lift and after its treads are in keeps the programme, joints and stairs`, {timeout: 900000}, async (t) => {
  const w = await site(t), {Ada, Bo} = w.souls, flight = w.idOf('flight');
  const c = await commit(w, Ada, [Bo], `install-flight-with:${flight}`, {at: 0});
  await runTo(w, c, 'lift'); await w.tick(15);
  await restart(w, clean);
  assert.equal(w.host.engine.programOf(Ada.entityId), c.op.programId, 'the same programme');
  assert.equal(w.E()[flight].support.kind, 'held', 'still in their hands');
  await toEnd(w, c); assert.equal(inviteOf(w, c.id).shared.op.result, 'arrived');
  await w.at(Ada, w.xm + 1.6, w.z0 + 4); await w.at(Bo, w.xm + 2.6, w.z0 + 4); await w.tick(20);
  for (const i of [1, 2, 3, 4, 5]) await setTread(w, i);
  const before = linkOf(w, flight); assert.equal(before.usable, true);
  await restart(w, clean); await w.tick(20);
  assert.equal(w.E()[flight].phase, 'installed'); assert.equal(w.E()[flight].connections.length, 6);
  assert.deepEqual(linkOf(w, flight), before, 'the same stairs');
  assert.equal([...w.god.model.entities.values()].filter((e) => e.name === 'flight').length, 1, 'one flight');
});

test('PC16 R11: with the flag off nothing is offered and the rules version has no stairs suffix', {timeout: 300000}, async (t) => {
  const w = await site(t, {sharedCarry: false});
  assert.equal(offer(w, w.souls.Ada, `install-flight-with:${w.idOf('flight')}`), undefined);
  assert.doesNotMatch(w.host.engine.rulesVersion ?? '', /shared-stairs/);
  assert.match(factory.rulesVersion, /\+shared-raise\/1\+shared-beam\/1\+shared-deck\/1\+shared-stairs\/1$/);
});
