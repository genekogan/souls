// #1150 rung 3: when rung 2's replays fault too, the world goes back to its last clean state, keeps everything but
// decisions, and continues. A halt stays only for durability. The fault is real in every replay: a factory wrapper puts the
// bad step in each runtime at a fixed tick, as a bug in the engine would be.
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

const repair = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true, soulsRepairV1: true}), today = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
function faulted(base, control) {
  const wrap = (e) => { const rt = e.rt, fired = new WeakSet(); rt.invariants = [(r) => { if (r.tick === control.at && !fired.has(r)) { fired.add(r); return control.fault(r) ?? []; } return []; }, ...rt.invariants]; return e; };
  return {...base, create: (w) => wrap(base.create(w)), restore: (s) => wrap(base.restore(s))};
}
async function world(t, base = repair, path = ':memory:') {
  const control = {at: -1, fault() {}}, factory = faulted(base, control), f = fixture(path, factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry: true}), app = new Hono();
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => null});
  t.after(() => { try { comms.close(); f.host.stop(); f.db.close(); } catch { /* a restart test closed them itself */ } });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n && !f.host.paused; i++) { f.host.tickOnce(); await setImmediate(); if (!f.host.paused) f.host.drainInputs(); } };
  await tick();
  const souls = {};
  for (const name of ['Ada', 'Bo']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Last rung test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await tick();
  const [ax, , az] = f.host.engine.world.entities[souls.Ada.entityId].pose.p;
  assert.notEqual(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
  ]}).accepted, false);
  await tick(30);
  return {f, edge, god, comms, tick, souls, control, factory};
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = (w, s, input) => accept(w.f.host, w.edge.act(s, input));
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const byRung = (h) => Object.values(h.glitches.byRule).reduce((n, r) => { for (const [k, v] of Object.entries(r)) n[k] = (n[k] ?? 0) + v; return n; }, {});
const violate = (code, subjects) => () => [{code, message: 'forced', subjects}];

for (const rule of ['support.floating', 'beam.unseated', 'deck.unsupported', 'stair.unsupported', 'raise.dropped'])
  test(`L2 ${rule}, with every replay faulting: today a halt, now a rewind, and the world runs on`, async (t) => {
    t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
    const old = await world(t, today); old.control.fault = violate(rule, [old.souls.Ada.entityId]); old.control.at = old.f.host.engine.world.tick + 3; await old.tick(10);
    assert.equal(old.f.host.paused, true, 'it really halts today');
    const w = await world(t), {Ada, Bo} = w.souls, host = w.f.host;
    const walk = ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(10);
    const at = host.engine.world.tick + 3; w.control.fault = violate(rule, [Ada.entityId]); w.control.at = at; await w.tick(10);
    assert.equal(host.paused, false); assert.equal(host.engineFault, null); assert.equal(byRung(host).rewind, 1); assert.equal(byRung(host).halt ?? 0, 0);
    assert.ok(host.engine.world.tick >= at, 'ticks stay monotonic');
    const x = read(w, Ada, walk); assert.equal(x.phase, 'failed', JSON.stringify(x)); assert.equal(x.code, 'world.rewound'); assert.match(x.reason, /did not happen/);
    await w.tick(10); ok(await act(w, Ada, {capability: 'walk:yard'})); ok(await act(w, Bo, {capability: 'walk:shed'})); await w.tick(30);
    assert.equal(host.paused, false); assert.deepEqual(host.engine.runtime.violations.filter((v) => v.tick > at), []);
  });

test('L2 a thrown step, every replay throwing: a rewind, not a halt', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host; ok(await act(w, w.souls.Ada, {capability: 'walk:shed'})); await w.tick(10);
  w.control.fault = () => { throw new Error('fixture.engine-bug'); }; w.control.at = host.engine.world.tick + 3; await w.tick(10);
  assert.equal(host.paused, false); assert.equal(byRung(host).rewind, 1); assert.equal(byRung(host).halt ?? 0, 0);
});

test('L3 decisions are left out, and god edits and Souls are kept', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, {Ada} = w.souls;
  ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(5);
  const [x, , z] = host.engine.world.entities[w.souls.Bo.entityId].pose.p;
  assert.notEqual(w.god.act({ops: [{op: 'place', def: 'core/bowl@2', name: 'kept', p: [x + 2, z]}]}).accepted, false); await w.tick(5);
  const id = w.god.model.get('kept').id, tick = host.engine.world.tick + 3; w.control.fault = violate('support.floating', [Ada.entityId]); w.control.at = tick; await w.tick(10);
  assert.equal(byRung(host).rewind, 1); assert.ok(host.engine.world.entities[id], 'the god edit survives'); assert.equal(host.engine.programOf(Ada.entityId), null);
  const e = w.f.db.db.prepare("SELECT payload FROM events WHERE author='world:recovery' ORDER BY seq DESC").get(), r = JSON.parse(e.payload).recovery;
  assert.ok(r.lastRung); assert.equal(r.untilTick, tick); assert.equal(r.events.filter((x) => x.kind === 'decision').length, 0); assert.ok(r.events.some((x) => x.kind === 'world-edit'));
});

test('L4 what still fires is contained: counted once, no second fault, gone when it stops firing, and no key when empty', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, {Ada} = w.souls, eng = () => host.engine; let firing = true;
  await w.tick(5); const before = eng().stateHash();
  const wrapAlways = (e) => { const rt = e.rt; rt.invariants = [() => (firing ? [{code: 'support.floating', message: 'forced', subjects: ['g-standing']}] : []), ...rt.invariants]; };
  wrapAlways(eng()); const restore = w.factory.restore; w.factory.restore = (s) => { const e = restore(s); wrapAlways(e); return e; };
  assert.ok(before);
  w.f.host.factory.restore = w.factory.restore;
  await w.tick(20);
  assert.equal(host.paused, false); assert.deepEqual(eng().world.containedV1, [{code: 'support.floating', subjects: ['g-standing']}]); assert.equal(byRung(host).rewind, 1, 'counted once');
  firing = false; await w.tick(3);
  assert.equal('containedV1' in eng().world, false, 'off the list, and no key'); ok(await act(w, Ada, {capability: 'walk:shed'}));
});

test('L5 a second rung 3 before a new snapshot stays on the head: programmes stop, the rule is contained, the world runs on', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, {Ada} = w.souls; host.rewoundSinceSnapshot = true;
  const walk = ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(10);
  const tick = host.engine.world.tick; w.control.fault = violate('support.floating', [Ada.entityId]); w.control.at = tick + 3; await w.tick(10);
  assert.equal(host.paused, false); assert.equal(byRung(host).rewind, 1); assert.ok(host.engine.world.tick > tick, 'it stayed on the head');
  assert.equal(w.f.db.db.prepare("SELECT COUNT(*) n FROM events WHERE author='world:rewind'").get().n, 1);
  assert.equal(read(w, Ada, walk).code, 'world.rewound'); await w.tick(5); ok(await act(w, Ada, {capability: 'walk:yard'}));
});

for (const clean of [false, true])
  test(`L7 a ${clean ? 'clean' : 'crash'} restart after a rewind reaches the live state`, async (t) => {
    t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
    const dir = mkdtempSync(join(tmpdir(), 'last-rung-')), path = join(dir, 'world.db'), w = await world(t, repair, path), {Ada} = w.souls; let db2, h2;
    t.after(() => { try { h2?.stop(); db2?.close(); } catch { /* the first failure is the one that matters */ } rmSync(dir, {recursive: true, force: true}); });
    ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(10);
    w.control.fault = violate('support.floating', [Ada.entityId]); w.control.at = w.f.host.engine.world.tick + 3; await w.tick(30);
    assert.equal(byRung(w.f.host).rewind, 1);
    const hash = w.f.host.engine.stateHash(), tick = w.f.host.engine.world.tick;
    w.comms.close(); w.f.host.stop();
    if (clean) { w.f.host.drainInputs(); w.f.host.saveSnapshot(true); }
    w.f.db.close();
    db2 = new Db(path); h2 = new WorldHost(db2, w.factory, seed, 1e9, worldId, {durableClockV1: true}); h2.boot();
    assert.equal(h2.engine.world.tick, tick); assert.equal(h2.engine.stateHash(), hash); assert.equal(h2.paused, false);
  });

test('a durability failure still halts, and says so', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host; t.mock.method(host, 'persistClockFrontier', () => { throw new Error('fixture.disk-full'); });
  await assert.rejects(async () => { await w.tick(3); });
});
