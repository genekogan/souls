// PC15 (#694): on a real god world, a deck goes onto a rack bay: crews of two set 2x4 joists onto the step ledges of the
// bay's beams and lay a plywood sheet across five of them, through the same invitation, op and receipts as the other
// shared operations (docs/design/shared-execution.md). The sheet's top is a floor only once it is laid; a Soul who built
// none of it walks onto it; a removal that would drop someone or something is refused.
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

/** A stable bay a god builds: two uprights standing face to face, step beams (@4) at seat 0 (12 in) on both columns and
 *  beams at seat 14 (8 ft, over a head on the deck) above them, all joined; upright a's base centre at (x0, z0), the bay toward −x. */
export function bay(x0, z0, name = 'bay') {
  const bx = x0 - 2 * T - BEAM_L - 2 * GAP, ops = [
    {op: 'place', tmp: '$a', name: `${name}-upright-a`, def: 'core/rack-upright@2', p: [x0, UP_L / 2, z0], r: [0, 0, Math.PI / 2], anchor: 'center'},
    {op: 'place', tmp: '$b', name: `${name}-upright-b`, def: 'core/rack-upright@2', p: [bx, UP_L / 2, z0], r: [Math.PI, 0, Math.PI / 2], anchor: 'center'},
  ];
  for (const i of [0, 14]) for (const [dz, aSide, bSide] of [[-ZC, 'l', 'r'], [ZC, 'r', 'l']]) {
    const t = `$b${i}${aSide}`;
    ops.push({op: 'place', tmp: t, name: `${name}-beam-${i}${aSide}`, def: 'core/rack-beam@4', p: [x0 - T - GAP - BEAM_L / 2, seat(i) - BEAM_H / 2, z0 + dz], r: 0, anchor: 'center'});
    ops.push({op: 'connect', a: {id: t, connector: 'end-r'}, b: {id: '$a', connector: `front-${aSide}-${i}`}});
    ops.push({op: 'connect', a: {id: t, connector: 'end-l'}, b: {id: '$b', connector: `front-${bSide}-${i}`}});
  }
  return ops;
}
/** The bay's middle (x) and the low beams' names: `l` at z0 − ZC (its bay face is `b`), `r` at z0 + ZC (face `a`). */
const bayMid = (x0) => x0 - T - GAP - BEAM_L / 2;
/** A god sets joist k (0..4) on the low beams' ledges, and (with sheet) lays the sheet on all five. */
function godDeck(x0, z0, name = 'bay', ks = [0, 1, 2, 3, 4], sheet = true) {
  const xm = bayMid(x0), ops = [];
  for (const k of ks) {
    ops.push({op: 'place', tmp: `$j${k}`, name: `${name}-joist-${k}`, def: 'core/deck-joist@1', p: [xm + (k - 2) * SPAN, seat(0) - BEAM_H / 2 + LEDGE_Y, z0], r: Math.PI / 2, anchor: 'center'});
    ops.push({op: 'connect', a: {id: `$j${k}`, connector: 'end-r'}, b: {id: `${name}-beam-0l`, connector: `joist-b-${k}`}});
    ops.push({op: 'connect', a: {id: `$j${k}`, connector: 'end-l'}, b: {id: `${name}-beam-0r`, connector: `joist-a-${k}`}});
  }
  if (sheet) {
    ops.push({op: 'place', tmp: '$s', name: `${name}-sheet`, def: 'core/plywood-sheet@2', p: [xm, seat(0) - BEAM_H / 2 + LEDGE_Y + JOIST_H, z0], r: 0, anchor: 'center'});
    for (const k of [0, 1, 2, 3, 4]) ops.push({op: 'connect', a: {id: '$s', connector: `on-${k}`}, b: {id: `${name}-joist-${k}`, connector: 'top'}});
  }
  return ops;
}

function mount(w, host, db, sharedCarry = true) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry, now: w.now}), app = new Hono();
  const comms = registerEdgeComms(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current}, {fading: true, beam: true, now: w.now, sweepMs: 0});
  edge.attachComms(comms); comms.fading.addHold((id) => edge.postureHold(id));
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  const bridge = installEngineBridge({host, god, edge, log: process.env.DECK_LOG ? (m) => console.log("[bridge]", m) : () => {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god, bridge});
}
async function world(t, {sharedCarry = true, names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve']} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc15-deck-')), path = join(dir, 'sim.db'), opts = {durableClockV1: true};
  const f = fixture(path, sharedCarry ? factory : plainFactory, opts); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000}, w = {f, path, opts, clock, now: () => clock.now, current: null, hosts: [f.host]};
  t.after(() => {try {w.comms?.close();} catch {} for (const h of w.hosts) try {h.stop();} catch {} try {if (w.db.db.isOpen) w.db.close();} catch {} rmSync(dir, {recursive: true, force: true});});
  mount(w, f.host, f.db, sharedCarry);
  w.tick = async (n = 5) => {for (let i = 0; i < n; i++) {clock.now += STEP_MS; w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  await w.tick();
  const souls = {};
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}-owner`, {name, description: 'Shared deck test'}));
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
/** A stable bay (god-built), five loose joists lying in it under their seats and a loose sheet lying beside it; the crews
 *  stand outside the bay's long sides, Eve further off. */
async function site(t, opts = {}) {
  const w = await world(t, opts), x0 = w.ax + 6, z0 = w.az, xm = bayMid(x0);
  ok(w.god.act({ops: [...bay(x0, z0),
    ...[0, 1, 2, 3, 4].map((k) => ({op: 'place', def: 'core/deck-joist@1', name: `joist-${k}`, p: [xm + (k - 2) * SPAN, z0], r: Math.PI / 2})),
    {op: 'place', def: 'core/plywood-sheet@2', name: 'sheet', p: [xm, z0 + 1.7], r: 0}]}));
  await w.tick(40);
  Object.assign(w, {x0, z0, xm});
  await home(w); await w.at(w.souls.Eve, xm, z0 - 4); await w.tick(5);
  return w;
}
/** The crews step back out to where they started (a crew done with one joist stands where the next one's crew would). */
async function home(w) {
  const {Ada, Bo, Cy, Dee} = w.souls;
  await w.at(Ada, w.xm - 0.8, w.z0 - 1.6); await w.at(Bo, w.xm - 0.8, w.z0 + 2.9); await w.at(Cy, w.xm + 0.8, w.z0 - 1.6); await w.at(Dee, w.xm + 0.8, w.z0 + 2.9);
  await w.tick(5);
}
/** A crew sets joist k at its offered position. */
async function setJoist(w, host, guest, k) {
  const id = w.idOf(`joist-${k}`), o = offer(w, host, `install-joist-with:${id}`);
  assert.equal(o?.available, true, JSON.stringify(o));
  const at = +((k - 2) * SPAN).toFixed(2);
  return commit(w, host, [guest], `install-joist-with:${id}`, {at});
}
/** All five joists, two crews at a time, then the sheet. */
async function buildDeck(w, {sheet = true, rounds = [[0, 1], [2, 3], [4]]} = {}) {
  const {Ada, Bo, Cy, Dee} = w.souls;
  for (const [a, b] of rounds) {
    const cs = [await setJoist(w, Ada, Bo, a), ...(b !== undefined ? [await setJoist(w, Cy, Dee, b)] : [])];
    for (const c of cs) {await toEnd(w, c); assert.equal(inviteOf(w, c.id).shared.op.result, 'arrived', JSON.stringify(inviteOf(w, c.id).shared.op));}
    await home(w);
  }
  await w.tick(20);
  if (!sheet) return null;
  const c = await commit(w, Ada, [Bo], `lay-sheet-with:${w.idOf('sheet')}`, {});
  await toEnd(w, c); assert.equal(inviteOf(w, c.id).shared.op.result, 'arrived', JSON.stringify(inviteOf(w, c.id).shared.op));
  await w.tick(20);
  return c;
}

test('PC15 R4 R7 (god-built): the sheet is a floor only once laid on all five joists, and a Soul walks onto it', {timeout: 240000}, async (t) => {
  const w = await world(t, {names: ['Ada']});
  const x0 = w.ax + 6, z0 = w.az, xm = bayMid(x0);
  ok(w.god.act({ops: [...bay(x0, z0), {op: 'place', def: 'core/zone@1', name: 'deck', shape: {area: [[xm - 0.5, z0 - 0.3], [xm + 0.5, z0 - 0.3], [xm + 0.5, z0 + 0.3], [xm - 0.5, z0 + 0.3]]}}]}));
  await w.tick(30);
  ok(w.god.act({ops: godDeck(x0, z0, 'bay', [0, 1, 2, 3, 4], false)}));
  await w.tick(30);
  const half = w.god.act({ops: [{op: 'place', tmp: '$s', name: 'bay-sheet', def: 'core/plywood-sheet@2', p: [xm, seat(0) - BEAM_H / 2 + LEDGE_Y + JOIST_H, z0], r: 0, anchor: 'center'},
    ...[0, 1, 2, 3].map((k) => ({op: 'connect', a: {id: '$s', connector: `on-${k}`}, b: {id: `bay-joist-${k}`, connector: 'top'}}))]});
  assert.equal(half.accepted, false, 'a sheet on four of its five joists hangs: refused'); assert.match(JSON.stringify(half), /support\.none/);
  const before = await walkTo(w, w.souls.Ada, 'deck');
  const yb = w.E()[w.souls.Ada.entityId].pose.p[1];
  t.diagnostic(`walk before the sheet: ${before.phase} ${before.code ?? ''} at ${w.E()[w.souls.Ada.entityId].pose.p}`);
  ok(w.god.act({ops: [{op: 'place', name: 'bay-sheet', def: 'core/plywood-sheet@2', p: [xm, z0 + 3], r: 0}]}));
  await w.tick(30);
  const sheet = w.idOf('bay-sheet');
  assert.deepEqual(floorsOf(w, sheet), [], 'no floor while loose');
  ok(w.god.act({ops: [{op: 'move', id: sheet, in: {parent: 'world'}, p: [xm, seat(0) - BEAM_H / 2 + LEDGE_Y + JOIST_H, z0], r: 0, anchor: 'center'},
    ...[0, 1, 2, 3, 4].map((k) => ({op: 'connect', a: {id: sheet, connector: `on-${k}`}, b: {id: w.idOf(`bay-joist-${k}`), connector: 'top'}}))]}));
  await w.tick(30);
  t.diagnostic(`laid: ${JSON.stringify(floorsOf(w, sheet))}`);
  t.diagnostic(`links: ${JSON.stringify(w.host.engine.world.entityPhysicsV1.byEntity[sheet].links)}`);
  t.diagnostic(`levels: ${JSON.stringify(w.host.engine.world.entityPhysicsV1.levels)}`);
  const eng = w.host.engine; t.diagnostic(`reach: ${JSON.stringify(eng.reachV1?.({p: [xm, z0 + 2], level: 0}, {p: [xm, z0], level: 1}))} standable: ${JSON.stringify(eng.standableNearV1?.([xm, z0], 1, undefined, 0.4, 24))}`);
  await w.at(w.souls.Ada, xm, z0 - 3);
  await w.tick(10);
  t.diagnostic(`walks: ${JSON.stringify(w.edge.capabilities(w.souls.Ada).filter((c) => c.verb === 'walk').map((c) => [c.id, c.label]))}`);
  { const th = w.bridge.nav.thing('bay-sheet'); t.diagnostic(`thing: ${JSON.stringify(th)} goal: ${JSON.stringify(th && w.bridge.nav.goal(th, [xm, z0 - 3]))} levelAt: ${w.bridge.levelAt(xm, z0, 0.403)}`); }
  const after = await walkTo(w, w.souls.Ada, 'bay-sheet');
  const pa = w.E()[w.souls.Ada.entityId].pose.p;
  t.diagnostic(`walk after: ${JSON.stringify(after).slice(0, 1500)} at ${pa} level ${w.E()[w.souls.Ada.entityId].human?.level}`);
});

test('PC15 R1 R2 R4 R7 R8: two crews set five joists, a sheet is laid across them, a Soul who built none of it walks on; removing it under her is refused', {timeout: 900000}, async (t) => {
  const w = await site(t), {Ada, Bo, Eve} = w.souls, sheet = w.idOf('sheet');
  // R1: joists offered with their free positions; no sheet offer while there is nothing to lay it on
  const o = offer(w, Ada, `install-joist-with:${w.idOf('joist-0')}`);
  assert.equal(o?.available, true, JSON.stringify(o)); assert.match(o.label, /^Set joist-0 across the bay onto bay-beam-0[lr] and bay-beam-0[lr] with one other Soul/);
  assert.deepEqual([...o.params.at.description.matchAll(/-?\d+\.\d\d/g)].map((m) => +m[0]), [-1.22, -0.61, 0, 0.61, 1.22]);
  assert.equal(offer(w, Ada, `lay-sheet-with:${sheet}`), undefined);
  assert.deepEqual(floorsOf(w, sheet), [], 'a loose sheet is no floor');

  const c0 = await setJoist(w, Ada, Bo, 0);
  await runTo(w, c0, 'lift'); await w.tick(10);
  const j0 = w.E()[w.idOf('joist-0')]; assert.equal(j0.support.kind, 'held'); assert.deepEqual(j0.support.by.sort(), [Ada.entityId, Bo.entityId].sort());
  for (const s of [Ada, Bo]) assert.equal(w.E()[s.entityId].human.grip?.entity, j0.id, `${s.name} has a hand on it`);
  await toEnd(w, c0); await home(w);
  assert.equal(read(w, Ada, c0.p).code, 'shared.seated'); assert.match(read(w, Ada, c0.p).reason, /is set across the bay onto .* -1\.22 m from its middle: both its ends rest on the beams' ledges/);
  const J0 = w.E()[w.idOf('joist-0')]; assert.equal(J0.phase, 'installed'); assert.equal(J0.support.kind, 'connected'); assert.equal(J0.connections.length, 2);
  for (const c of J0.connections) assert.ok(w.E()[c.to].connections.some((x) => x.to === J0.id && x.socket === c.toSocket && x.toSocket === c.socket), 'reciprocal in the engine');
  assert.ok(Math.abs(J0.pose.p[1] - (seat(0) - BEAM_H / 2 + LEDGE_Y)) < 1e-3, `on the ledges: ${J0.pose.p[1]}`);
  await w.tick(20);
  assert.equal(Object.keys(joinsOf(w, 'joist-0')).length, 2, 'the entity world keeps both joints');

  await buildDeck(w, {sheet: false, rounds: [[1, 3], [2, 4]]});   // two crews at once, a joist apart
  assert.equal(offer(w, Ada, `install-joist-with:${w.idOf('joist-0')}`), undefined, 'an installed joist is not offered again');
  const lo = offer(w, Ada, `lay-sheet-with:${sheet}`); assert.equal(lo?.available, true, JSON.stringify(lo)); assert.match(lo.label, /^Lay sheet across the 5 joists from joist-[04] to joist-[04]/);
  const cs = await commit(w, Ada, [Bo], `lay-sheet-with:${sheet}`, {});
  await runTo(w, cs, 'lift'); await w.tick(10);
  assert.deepEqual(floorsOf(w, sheet), [], 'no floor while it is in their hands');
  await toEnd(w, cs);
  assert.match(read(w, Ada, cs.p).reason, /is laid across the joists from joist-[04] to joist-[04]: it bears on every joist under it, and its top is a floor now/);
  await w.tick(30);
  const f = floorsOf(w, sheet); assert.equal(f.length, 1, JSON.stringify(f)); assert.ok(f[0].level > 0 && Math.abs(f[0].y - (seat(0) - BEAM_H / 2 + LEDGE_Y + JOIST_H + PLY_T)) < 0.002, JSON.stringify(f));
  assert.equal(Object.keys(joinsOf(w, 'sheet')).length, 5, 'the sheet bears on all five in the entity world');
  assert.deepEqual((w.host.engine.rt?.violations ?? []).filter((v) => /^(beam|support|deck)\./.test(v.code)), [], 'no frame, beam or deck invariant fired');

  // R7: Eve, who built none of it, walks onto it
  const walk = await walkTo(w, Eve, 'sheet');
  const E = w.E()[Eve.entityId]; assert.equal(walk.phase, 'completed', JSON.stringify(walk));
  assert.equal(E.human.level, f[0].level); assert.ok(Math.abs(E.pose.p[1] - f[0].y) < 0.01, `stands on the deck: ${E.pose.p}`);
  // R8: nothing under her is taken away: the sheet, a joist, a beam
  for (const op of [{op: 'remove', id: 'sheet'}, {op: 'move', id: 'sheet', in: {parent: 'world'}, p: [w.xm, w.z0 + 4], r: 0}, {op: 'disconnect', a: {id: 'sheet', connector: 'on-2'}}, {op: 'remove', id: 'joist-2'}, {op: 'remove', id: 'bay-beam-0l'}]) {
    const r = w.god.act({ops: [op]}); assert.equal(r.accepted, false, JSON.stringify(op)); assert.equal(r.failures[0].code, 'deck.occupied', JSON.stringify(r)); assert.match(r.failures[0].detail, /Eve is standing on sheet/);
  }
  // a Soul is never offered to take an installed part
  for (const n of ['joist-2', 'sheet']) {const c = offer(w, Ada, `carry:${w.idOf(n)}`); assert.ok(!c?.available, `${n}: ${JSON.stringify(c)}`);}
  // once she is off it, the support rule still refuses taking a joist from under the sheet
  ok(await act(w, Eve, {capability: 'walk:field'})); await until(w, () => (w.E()[Eve.entityId].human.level ?? 0) === 0, 2000); await w.tick(40);
  const r = w.god.act({ops: [{op: 'remove', id: 'joist-2'}]}); assert.equal(r.accepted, false); assert.equal(r.failures[0].code, 'support.none', JSON.stringify(r));
});
