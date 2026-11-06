// PC13 (#692): a crew raises a loose upright and holds it, on a real god world, through the same invitation, op and receipts
// as a shared carry (docs/design/shared-execution.md). What a stop or a departure does, what is refused before anyone is
// asked, a second proposal, a restart, speech and other Souls while it is held.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory as plainFactory, seed, worldId} from '../../apps/server/test/native-owner-fixture.ts';
import {marsFactory, GREEN_FIELD_WORLD} from '../../packages/engine-mars/src/engine.ts';
import {looseFramesHeld} from '../../packages/engine-mars/src/raise-hold.ts';
import {Db} from '../../apps/server/src/db.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldHost} from '../../apps/server/src/world.ts';

const STEP_MS = 50, UP_L = 3.6576;
// the shared raise's engine verb exists only behind the flag (engine.ts marsFactory), as the ledger's offers do
const factory = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
function mount(w, host, db, sharedCarry = true) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry, now: w.now}), app = new Hono();
  const comms = registerEdgeComms(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current}, {fading: true, beam: true, now: w.now, sweepMs: 0});
  edge.attachComms(comms); comms.fading.addHold((id) => edge.postureHold(id));
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  installEngineBridge({host, god, edge, log() {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god});
}
async function world(t, {names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve'], sharedCarry = true, extra = () => []} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc13-raise-')), path = join(dir, 'sim.db'), opts = {durableClockV1: true};
  const f = fixture(path, sharedCarry ? factory : plainFactory, opts); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000}, w = {f, path, opts, clock, now: () => clock.now, current: null, hosts: [f.host]};
  t.after(() => {try {w.comms?.close();} catch {} for (const h of w.hosts) try {h.stop();} catch {} try {if (w.db.db.isOpen) w.db.close();} catch {} rmSync(dir, {recursive: true, force: true});});
  mount(w, f.host, f.db, sharedCarry);
  w.tick = async (n = 5) => {for (let i = 0; i < n; i++) {clock.now += STEP_MS; w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  await w.tick();
  const souls = {};
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}-owner`, {name, description: 'Shared raise test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await w.tick();
  const E = () => w.host.engine.world.entities, [ax, , az] = E()[souls.Ada.entityId].pose.p;
  w.at = async (s, x, z) => {await accept(w.host, w.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));};
  await w.at(souls.Bo, ax, az + 3); await w.at(souls.Cy, ax + 3.5, az + 3); await w.at(souls.Dee, ax + 3.5, az - 1.5); await w.at(souls.Eve, ax - 9, az - 9);
  ok(w.god.act({ops: [{op: 'place', def: 'core/rack-upright@2', name: 'frame', p: [ax - 3, az + 5]}, {op: 'place', def: 'core/rack-beam@3', name: 'beam', p: [ax - 3, az - 2]}, ...extra(ax, az)]}));
  await w.tick(60);
  return Object.assign(w, {souls, ax, az, E, idOf: (n) => w.god.model.get(n).id});
}
const ok = (r) => {assert.notEqual(r.accepted, false, JSON.stringify(r)); return r;};
const act = async (w, s, input) => accept(w.host, w.edge.act(s, input));
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const until = async (w, done, max) => {for (let n = 0; n < max && !done(); n++) await w.tick(1);};
const streamOf = (w, s) => w.comms.streams.read(s.soulId, 0).events;
const offer = (w, s, id) => w.edge.capabilitiesPage(s, {all: true}).capabilities.find((c) => c.id === id);
const say = async (w, s, text) => {w.current = s; return (await accept(w.host, w.app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text})}))).json();};

/** Propose with `guests`, each accepts revision 1, the world commits. */
async function commit(w, host, guests, load) {
  const p = ok(await act(w, host, {capability: `raise-with:${load}`, params: {with: guests.map((g) => g.name).join(' and ')}})), id = p.receipt.shared.invite;
  assert.equal(read(w, host, p).phase, 'waiting');
  const accepts = [];
  for (const g of guests) accepts.push(ok(await act(w, g, {capability: `accept:${id}`, params: {revision: 1}})));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, host, p)));
  return {p, id, crew: [[host, p], ...guests.map((g, i) => [g, accepts[i]])], op: inviteOf(w, id).shared.op};
}
const phaseOf = (w, c) => w.host.engine.programAction?.(c.op.programId)?.action.phase;
/** Tick until the native phase, sampling: nothing teleports, and a tilted part is always held by its crew. */
async function runTo(w, c, load, phase, max = 3000) {
  const last = {};
  for (let n = 0; n < max && phaseOf(w, c) !== phase; n++) {await w.tick(1); sample(w, c, load, last);}
  assert.equal(phaseOf(w, c), phase, JSON.stringify(w.host.engine.programAction?.(c.op.programId)?.action));
  return last;
}
function sample(w, c, load, last) {
  const x = w.E()[load];
  if (x.pose.roll) {assert.equal(x.support?.kind, 'held', 'a tilted part is held'); for (const [s] of c.crew) assert.equal(w.E()[s.entityId].human.grip?.entity, load, `${s.name}'s hands are on it`);}
  for (const [id, q] of [[load, x.pose.p], ...c.crew.map(([s]) => [s.name, w.E()[s.entityId].pose.p])]) {
    if (last[id]) assert.ok(Math.hypot(q[0] - last[id][0], q[1] - last[id][1], q[2] - last[id][2]) < 0.25, `${id} moved no more than a step in a tick`);
    last[id] = [...q];
  }
}
async function toEnd(w, c, load, max = 4000) {const last = {}; for (let n = 0; n < max && inviteOf(w, c.id).shared.op.phase !== 'ended'; n++) {await w.tick(1); sample(w, c, load, last);} assert.equal(inviteOf(w, c.id).shared.op.phase, 'ended', JSON.stringify(inviteOf(w, c.id).shared.op));}
function freeAfter(w, c, load, pose) {
  const x = w.E()[load];
  assert.deepEqual(x.pose.p, pose.p); assert.ok(Math.abs(x.pose.yaw - pose.yaw) < 1e-12); assert.ok(!x.pose.roll, 'lying'); assert.deepEqual(x.support, {kind: 'ground'}); assert.equal(x.phase, 'staged'); assert.equal(x.reservedBy, undefined);
  for (const [s] of c.crew) {const h = w.E()[s.entityId].human; assert.equal(h.grip, undefined, `${s.name} let go`); assert.equal(h.task, undefined);}
}
const raised = (x) => Math.abs(Math.abs(x.pose.roll ?? 0) - Math.PI / 2) < 1e-9 && Math.abs(x.pose.p[1] - x.pose.p[1]) < 1;

for (const crew of [['Bo'], ['Bo', 'Cy'], ['Bo', 'Cy', 'Dee']]) test(`R1 R2 R4: a crew of ${crew.length + 1} raises it, holds it, and lowers it back where it lay`, {timeout: 300000}, async (t) => {
  const w = await world(t), frame = w.idOf('frame'), {Ada} = w.souls, start = structuredClone(w.E()[frame].pose);
  const o = offer(w, Ada, `raise-with:${frame}`); assert.equal(o?.available, true, JSON.stringify(o));
  const c = await commit(w, Ada, crew.map((n) => w.souls[n]), frame);
  await runTo(w, c, frame, 'hold'); await w.tick(40);
  const x = w.E()[frame]; assert.ok(raised(x), JSON.stringify(x.pose)); assert.equal(x.support.kind, 'held'); assert.equal(x.support.by.length, crew.length + 1);
  assert.ok(Math.abs(x.pose.p[1] - start.p[1] - UP_L / 2) < 0.03, `it stands on its base: ${JSON.stringify([start, x.pose])}`);
  for (const [s, r] of c.crew) {
    const seen = read(w, s, r); assert.equal(seen.phase, 'started'); assert.equal(seen.code, 'shared.holding'); assert.match(seen.reason, /stands, held by/); assert.equal(seen.shared.holding, true);
    assert.ok(streamOf(w, s).some((e) => e.kind === 'shared.holding'), `${s.name} is told`);
    assert.match(w.E()[s.entityId].human.grip.slot, /^column-/);
  }
  const stop = ok(await act(w, c.crew.at(-1)[0], {capability: `stop-carry:${c.op.id}`}));
  assert.equal(read(w, c.crew.at(-1)[0], stop).phase, 'completed'); assert.equal(inviteOf(w, c.id).shared.op.phase, 'stopping');
  await toEnd(w, c, frame);
  freeAfter(w, c, frame, start);
  assert.equal(inviteOf(w, c.id).shared.op.result, 'stopped');
  for (const [s, r] of c.crew) {const seen = read(w, s, r); assert.equal(seen.phase, 'completed'); assert.match(seen.reason, /lowered back where it lay/);}
  assert.equal(offer(w, Ada, `raise-with:${frame}`)?.available, true, 'it can be raised again');
});

test('R3: refused before anyone is asked; nothing moves', {timeout: 300000}, async (t) => {
  // a table standing over a second upright: its arc is blocked from either end
  const w = await world(t, {extra: (ax, az) => [{op: 'place', def: 'core/rack-upright@2', name: 'under', p: [ax + 5, az + 5]}, {op: 'place', def: 'core/work-table@1', name: 'over', p: [ax + 5, az + 5]}]}), frame = w.idOf('frame'), {Ada, Bo, Cy, Dee, Eve} = w.souls;
  const code = async (s, cap, params) => {const r = await act(w, s, {capability: cap, params}); assert.equal(r.accepted, false, JSON.stringify(r)); return r.code;};
  assert.ok(await code(Ada, `raise-with:${frame}`, {with: 'Ada'}), 'alone is refused');
  await w.at(Eve, w.ax - 1, w.az + 1); await w.tick(5);
  assert.equal(await code(Ada, `raise-with:${frame}`, {with: 'Bo, Cy, Dee and Eve'}), 'raise.crew-too-large');
  assert.equal(offer(w, Ada, `raise-with:${w.idOf('beam')}`), undefined, 'only an upright is raised');
  const params = await act(w, Ada, {capability: `raise-with:${frame}`}); assert.equal(params.code, 'capability.params');
  const under = await act(w, Cy, {capability: `raise-with:${w.idOf('under')}`, params: {with: 'Dee'}}); assert.equal(under.code, 'raise.arc-blocked', JSON.stringify(under)); assert.match(under.reason, /over is in the way/); assert.match(under.reason, /Nobody was asked/);
  assert.deepEqual(w.E()[frame].support, {kind: 'ground'});
  for (const s of [Ada, Bo, Cy, Dee]) assert.ok(!streamOf(w, s).some((e) => e.kind === 'invite'), `${s.name} was not asked`);
});

test('R7: repeats and a second proposal change nothing', {timeout: 300000}, async (t) => {
  const w = await world(t), frame = w.idOf('frame'), {Ada, Bo, Cy, Dee} = w.souls;
  const first = ok(await act(w, Ada, {capability: `raise-with:${frame}`, params: {with: 'Bo'}})), id = first.receipt.shared.invite;
  const again = ok(await act(w, Ada, {capability: `raise-with:${frame}`, params: {with: 'Bo', invite: id}})); assert.equal(again.receipt.id, first.receipt.id, 'the same proposal answers with its receipt');
  const a1 = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  const c = {id, op: inviteOf(w, id).shared.op, crew: [[Ada, first], [Bo, a1]]};
  await w.tick(3);
  // a second proposal on the claimed load
  const second = await act(w, Cy, {capability: `raise-with:${frame}`, params: {with: 'Dee'}}); assert.equal(second.accepted, false, JSON.stringify(second));
  await runTo(w, c, frame, 'hold');
  const s1 = ok(await act(w, Ada, {capability: `stop-carry:${c.op.id}`})), s2 = ok(await act(w, Ada, {capability: `stop-carry:${c.op.id}`})), s3 = ok(await act(w, Bo, {capability: `stop-carry:${c.op.id}`}));
  assert.equal(s2.receipt.id, s1.receipt.id); assert.equal(read(w, Bo, s3).code, 'shared.stop-asked');
  assert.equal(w.db.db.prepare("SELECT count(*) n FROM events WHERE kind='edge-stop'").get().n, 1, 'one logged stop');
  await toEnd(w, c, frame);
  const late = await act(w, Ada, {capability: `stop-carry:${c.op.id}`}); assert.equal(late.accepted, false); assert.equal(late.code, 'shared.not-running');
});

test('R5: someone under it keeps it held and is named; it comes down once they move', {timeout: 300000}, async (t) => {
  const w = await world(t), frame = w.idOf('frame'), {Ada, Bo, Eve} = w.souls, start = structuredClone(w.E()[frame].pose);
  const c = await commit(w, Ada, [Bo], frame); await runTo(w, c, frame, 'hold'); await w.tick(25);
  await w.at(Eve, start.p[0], start.p[2]); await w.tick(5);   // Eve stands where it would come down
  ok(await act(w, Bo, {capability: `stop-carry:${c.op.id}`})); await w.tick(30);
  assert.ok(raised(w.E()[frame]), 'still standing'); assert.equal(w.E()[frame].support.kind, 'held');
  const op = inviteOf(w, c.id).shared.op; assert.equal(op.phase, 'stopping'); assert.match(op.stop.unsafe ?? '', /Eve/, JSON.stringify(op));
  assert.match(read(w, Bo, c.crew[1][1]).reason, /cannot come down yet \(Eve is in the way\)/);
  await w.at(Eve, w.ax - 9, w.az - 9); await toEnd(w, c, frame);
  freeAfter(w, c, frame, start); assert.equal(inviteOf(w, c.id).shared.op.result, 'stopped');
});

test('R4: a stop during the raise and before the grip; a member going away', {timeout: 300000}, async (t) => {
  const w = await world(t), frame = w.idOf('frame'), {Ada, Bo} = w.souls, start = structuredClone(w.E()[frame].pose);
  const c1 = await commit(w, Ada, [Bo], frame); ok(await act(w, Bo, {capability: `stop-carry:${c1.op.id}`})); await toEnd(w, c1, frame);
  freeAfter(w, c1, frame, start); assert.match(read(w, Ada, c1.p).reason, /never lifted/);
  const c2 = await commit(w, Ada, [Bo], frame); await runTo(w, c2, frame, 'raise'); await w.tick(30); assert.ok(w.E()[frame].pose.roll, 'partly up');
  ok(await act(w, Ada, {capability: `stop-carry:${c2.op.id}`})); assert.match(read(w, Bo, c2.crew[1][1]).reason, /lower .* back where it lay/); await toEnd(w, c2, frame);
  freeAfter(w, c2, frame, start);
  // going away is a stop with a lowering (PC09)
  const c3 = await commit(w, Ada, [Bo], frame); await runTo(w, c3, frame, 'hold');
  w.clock.now += 13 * 3_600_000; for (const n of ['Ada', 'Cy', 'Dee', 'Eve']) w.comms.fading.touch(w.souls[n].soulId); w.comms.sweep(); await w.tick(5);
  const op3 = inviteOf(w, c3.id).shared.op; assert.equal(op3.stop?.away, true, JSON.stringify(op3)); assert.match(read(w, Ada, c3.p).reason, /Bo went away/);
  await toEnd(w, c3, frame); freeAfter(w, c3, frame, start);
});

test('R8: while held: speech, a member\'s act is shared.busy, another Soul is free; flag off: nothing offered', {timeout: 300000}, async (t) => {
  const w = await world(t), frame = w.idOf('frame'), {Ada, Bo, Cy} = w.souls;
  const c = await commit(w, Ada, [Bo], frame); await runTo(w, c, frame, 'hold');
  // a long hold: a minute of ticks, no guard or timeout ends it, and the world can still be saved
  await w.tick(1200); assert.ok(raised(w.E()[frame]), 'still standing'); assert.equal(w.host.engine.canSnapshot(), true);
  assert.equal(read(w, Ada, c.p).phase, 'started'); assert.ok(!w.db.db.prepare("SELECT count(*) n FROM events WHERE kind='edge-stop'").get().n, 'nothing stopped it');
  const spoken = await say(w, Bo, 'Got it, I have this side.'); assert.ok(spoken.said ?? spoken.id, JSON.stringify(spoken));
  const walk = w.edge.capabilities(Ada).find((x) => x.verb === 'walk' && x.available)?.id ?? 'walk:field';
  const busy = await act(w, Ada, {capability: walk}); assert.equal(busy.accepted, false); assert.equal(busy.code, 'shared.busy', JSON.stringify(busy)); assert.match(busy.reason, /committed to holding/); assert.equal(busy.alternatives[0].id, `stop-carry:${c.op.id}`);
  assert.equal(read(w, Ada, c.p).phase, 'started', 'the hold goes on');
  const free = w.edge.capabilities(Cy).find((x) => x.verb === 'walk' && x.available).id; const r = ok(await act(w, Cy, {capability: free})); assert.ok(['waiting', 'started', 'completed'].includes(read(w, Cy, r).phase));
  // the owner's plain "stop what you are doing" is the same safe stop, in any member's stream
  const stand = await act(w, Bo, {capability: 'stand:here'}); assert.equal(stand.accepted, true, JSON.stringify(stand)); assert.equal(inviteOf(w, c.id).shared.op.phase, 'stopping'); await toEnd(w, c, frame);
  const off = await world(t, {sharedCarry: false}); assert.equal(offer(off, off.souls.Ada, `raise-with:${off.idOf('frame')}`), undefined);
});

test('flag off: no raise_hold_v1 verb and no loose-frame invariant; on, both', async () => {
  const was = process.env.SIM_SHARED_CARRY; delete process.env.SIM_SHARED_CARRY;
  try {
    for (const [cfg, on] of [[GREEN_FIELD_WORLD, false], [{...GREEN_FIELD_WORLD, sharedCarryV1: false}, false], [{...GREEN_FIELD_WORLD, sharedCarryV1: true}, true]]) {
      const f = await marsFactory(cfg), e = f.create(f.genesis('flag'));
      assert.equal(e.describeVerbs().some((v) => v.verb === 'mars:raise_hold_v1'), on, JSON.stringify(cfg));
      assert.equal(e.rt.invariants.includes(looseFramesHeld), on, JSON.stringify(cfg));
    }
    // a journal or snapshot from a world with the flag is not replayed or restored without it, nor the other way round
    const off = await marsFactory(GREEN_FIELD_WORLD), on = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
    assert.ok(!off.rulesVersion.includes('+shared-raise/1') && on.rulesVersion.endsWith('+shared-raise/1+shared-beam/1'), on.rulesVersion);
    assert.equal(on.create(on.genesis('v')).rulesVersion, on.rulesVersion, 'the engine says what its factory registered');
    for (const [f, own, other] of [[off, off.rulesVersion, on.rulesVersion], [on, on.rulesVersion, off.rulesVersion]]) {
      assert.equal(f.canReplayHistory(own), true); assert.equal(f.canRestoreSnapshot(own), true);
      assert.equal(f.canReplayHistory(other), false, other); assert.equal(f.canRestoreSnapshot(other), false, other);
    }
    process.env.SIM_SHARED_CARRY = '1';   // the server's flag, read where no config names it (main.ts)
    const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis('flag'));
    assert.ok(e.describeVerbs().some((v) => v.verb === 'mars:raise_hold_v1') && e.rt.invariants.includes(looseFramesHeld));
    assert.equal(f.rulesVersion, on.rulesVersion);
  } finally {if (was === undefined) delete process.env.SIM_SHARED_CARRY; else process.env.SIM_SHARED_CARRY = was;}
});

/** A new process on the same database (shared-restart.test.mjs). `clean`: a final snapshot first; else only what was logged. */
async function restart(w, clean) {
  w.comms.close(); w.host.stop();
  if (clean) {w.host.drainInputs(); w.host.saveSnapshot(true);}
  w.db.close();
  const db = new Db(w.path), h = new WorldHost(db, factory, seed, 1e9, worldId, w.opts), boot = h.boot(); h.drainInputs();
  w.hosts.push(h); mount(w, h, db); await w.tick(5);
  return boot;
}
for (const clean of [true, false]) test(`R6: a ${clean ? 'clean' : 'crash'} restart while raising, holding and lowering`, {timeout: 300000}, async (t) => {
  const w = await world(t), frame = w.idOf('frame'), {Ada, Bo} = w.souls, start = structuredClone(w.E()[frame].pose);
  const c = await commit(w, Ada, [Bo], frame);
  await runTo(w, c, frame, 'raise'); await w.tick(20);
  const midRoll = w.E()[frame].pose.roll; assert.ok(midRoll, 'partly up');
  await restart(w, clean);
  assert.equal(inviteOf(w, c.id).shared.op.programId, c.op.programId); assert.equal(w.host.engine.programOf(w.E()[Ada.entityId].id), c.op.programId, 'the same programme');
  assert.equal(w.E()[frame].support.kind, 'held'); assert.ok(w.E()[frame].pose.roll, 'still partly up, never dropped');
  await runTo(w, c, frame, 'hold'); await w.tick(25);
  assert.equal(read(w, Bo, c.crew[1][1]).code, 'shared.holding');
  await restart(w, clean);
  assert.ok(raised(w.E()[frame]), 'standing across a restart'); assert.equal(read(w, Ada, c.p).phase, 'started'); assert.equal(read(w, Ada, c.p).shared.holding, true);
  await w.tick(60); assert.ok(raised(w.E()[frame]), 'still held, nothing ended it');
  const told = streamOf(w, Ada).filter((e) => e.kind === 'shared.holding').length; assert.ok(told <= 1, `said once: ${told}`);
  ok(await act(w, Bo, {capability: `stop-carry:${c.op.id}`})); await w.tick(30);
  assert.equal(phaseOf(w, c), 'set'); assert.ok(w.E()[frame].pose.roll);
  await restart(w, clean);
  assert.equal(inviteOf(w, c.id).shared.op.phase, 'stopping');
  await toEnd(w, c, frame);
  freeAfter(w, c, frame, start); assert.equal(inviteOf(w, c.id).shared.op.result, 'stopped');
  assert.equal(w.db.db.prepare("SELECT count(*) n FROM events WHERE kind='edge-stop'").get().n, 1, 'the stop is not logged twice');
});
