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
import {forgetMotion} from '../../mars/viewer/engine/runtime/invariants.ts';
import {kernelHash} from '../../apps/server/src/fold.ts';

const repair = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true, soulsRepairV1: true}), today = await marsFactory({...GREEN_FIELD_WORLD, sharedCarryV1: true});
function faulted(base, control) {
  const wrap = (e) => {
    const rt = e.rt, fired = new WeakSet(), step = e.step.bind(e);
    rt.invariants = [(r) => { if (r.tick === control.at && !fired.has(r)) { fired.add(r); return control.fault(r) ?? []; } if (control.every) return control.every(r) ?? []; return []; }, ...rt.invariants];
    e.step = () => { const o = step(); if (control.throwEvery || e.world.tick === control.throwAt) throw new Error('fixture.engine-bug'); return o; };   // after a whole step
    const clock = e.updateClock.bind(e), m = Object.create(e.m);
    m.stepCarriers = (...x) => { if (control.preThrow?.(e)) throw new Error('fixture.pre-tick-bug'); return Object.getPrototypeOf(m).stepCarriers(...x); }; e.m = m;   // before the tick moves
    e.updateClock = () => { if (control.midThrow?.(e)) throw new Error('fixture.mid-step-bug'); return clock(); };   // a real partial tick: actions and invariants ran, programmes didn't advance
    return e;
  };
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

// The god bridge walks a body clear of what a god places (#1066), so this is the backstop: the body is put inside a real table
// between ticks, as an edit that got past the bridge would, and it never moved itself.
test('L1 the world lands on a still body: it stands at the nearest free spot and is told, and nobody else loses anything', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const w = await world(t), host = w.f.host, {Ada, Bo} = w.souls, E = host.engine.world.entities, [x, y, z] = E[Bo.entityId].pose.p;
  ok(w.god.act({ops: [{op: 'place', def: 'core/table@1', name: 'over-him', p: [x + 4, z]}]})); await w.tick(5);
  const walk = ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(5);
  E[Bo.entityId].pose.p = [x + 4, y, z]; forgetMotion(host.engine.rt);
  await w.tick(1);
  const [nx, , nz] = E[Bo.entityId].pose.p, refusal = w.f.db.db.prepare("SELECT payload FROM events WHERE author='world:refusal'").all().map((e) => JSON.parse(e.payload).refusal);
  assert.ok(Math.hypot(nx - (x + 4), nz - z) > 0.3, 'moved clear of the table'); assert.equal(refusal.length, 1); assert.equal(refusal[0].relocated, true); assert.deepEqual(refusal[0].bodies, [Bo.entityId]);
  assert.deepEqual(byRung(host), {refusal: 1}); assert.deepEqual(host.engine.runtime.violations, []);
  assert.ok(w.comms.streams.read(Bo.soulId, 0).events.some((e) => e.kind === 'world.relocated'), 'he hears it');
  await w.tick(5); assert.equal(read(w, Ada, walk).phase, 'started', 'Ada walks on'); ok(await act(w, Bo, {capability: 'walk:yard'}));
});

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
  w.control.throwAt = host.engine.world.tick + 3; await w.tick(10);
  assert.equal(host.paused, false); assert.equal(byRung(host).rewind, 1); assert.equal(byRung(host).halt ?? 0, 0);
});

test('a step that throws every tick cannot rewind every tick', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, rows = () => w.f.db.db.prepare('SELECT COUNT(*) n FROM events').get().n, before = rows();
  w.control.throwEvery = true; await w.tick(60);
  assert.equal(host.paused, false); assert.equal(byRung(host).rewind <= 2, true, JSON.stringify(byRung(host))); assert.ok(rows() - before <= 3, `log grew by ${rows() - before}`);
  assert.equal(w.f.db.db.prepare("SELECT COUNT(*) n FROM events WHERE author='world:recovery'").get().n <= 1, true);
});

test('an invariant that throws every tick is contained once, and Souls still act', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, {Ada} = w.souls;
  w.control.every = () => { throw new Error('fixture.invariant-bug'); }; await w.tick(40);
  assert.equal(host.paused, false); assert.equal(byRung(host).rewind, 1); assert.deepEqual(host.engine.world.containedV1?.map((c) => c.code), ['engine.thrown']);
  const walk = ok(await act(w, Ada, {capability: 'walk:yard'})); await w.tick(400);
  assert.equal(read(w, Ada, walk).phase, 'completed'); assert.equal(byRung(host).rewind, 1);
});

test('a cancel that throws does not stop the rung', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, def = host.engine.rt.registry.get('walk_to'), cancel = def.cancel; t.after(() => { def.cancel = cancel; });
  ok(await act(w, w.souls.Ada, {capability: 'walk:shed'})); await w.tick(10);
  def.cancel = () => { throw new Error('fixture.cancel-bug'); }; host.recoveryCapture = null;
  await assert.doesNotReject(async () => { host.lastRewindTick = host.engine.world.tick; w.control.fault = violate('support.floating', [w.souls.Ada.entityId]); w.control.at = host.engine.world.tick + 2; await w.tick(6); });
  assert.equal(host.paused, false); assert.equal(byRung(host).halt ?? 0, 0); assert.equal(host.engine.programOf(w.souls.Ada.entityId), null);
});

test('one event that will not re-apply costs only itself, and the recipe says which', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, {Ada} = w.souls, [x, , z] = host.engine.world.entities[w.souls.Bo.entityId].pose.p;
  assert.notEqual(w.god.act({ops: [{op: 'place', def: 'core/bowl@2', name: 'kept', p: [x + 2, z]}]}).accepted, false); await w.tick(3);
  const bad = await accept(host, host.enqueue('rules', 'test', {note: 'will not re-apply'})), apply = host.apply.bind(host);
  host.apply = (e, r) => { if (r && e.seq === bad.seq) throw new Error('fixture.bad-event'); return apply(e, r); };
  w.control.fault = violate('support.floating', [Ada.entityId]); w.control.at = host.engine.world.tick + 2; await w.tick(6);
  const r = JSON.parse(w.f.db.db.prepare("SELECT payload FROM events WHERE author='world:recovery' ORDER BY seq DESC").get().payload).recovery;
  assert.deepEqual(r.lastRung.skipped, [bad.seq]); assert.ok(host.engine.world.entities[w.god.model.get('kept').id], 'the god edit still applied');
});

test('L4 a refusal while something is contained does not rewind anyone', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, {Ada} = w.souls; w.control.every = violate('support.floating', ['g-standing']); await w.tick(10);
  assert.equal(byRung(host).rewind, 1);
  ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(10);
  const rt = host.engine.rt; let done = false; rt.invariants = [(r) => { if (!done) { done = true; r.world.entities[Ada.entityId].pose.p[0] += 1; } return []; }, ...rt.invariants];
  await w.tick(3);
  assert.equal(byRung(host).refusal, 1); assert.equal(byRung(host).rewind, 1);
});

test('L6 a Soul whose walk finished since the baseline hears it did not happen, and one born in the window keeps its body', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host, {Ada, Bo} = w.souls;
  t.mock.method(host, 'snapshotHead', () => ({tick: 0, stateHash: ''}));
  const done = ok(await act(w, Bo, {capability: 'walk:yard'})); await w.tick(300); assert.equal(read(w, Bo, done).phase, 'completed');
  await invite(w.f, 'cy'); const cy = await accept(host, w.f.souls.create('dev:cy', {name: 'Cy', description: 'Born in the window'})); await w.tick(3);
  w.control.fault = violate('support.floating', [Ada.entityId]); w.control.at = host.engine.world.tick + 2; await w.tick(6);
  assert.equal(byRung(host).rewind, 1); assert.ok(w.comms.streams.read(Bo.soulId, 0).events.some((e) => e.kind === 'world.rewound'), 'Bo is told');
  assert.ok(host.engine.world.entities[cy.entity_id], 'the newcomer has a body'); assert.ok(host.minds.get(cy.id), 'and a mind');
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

for (const [why, arrange] of [['with no baseline', (h) => { h.recoveryBaseline = null; h.recoveryCapture = null; }], ['soon after the last one', (h) => { h.lastRewindTick = h.engine.world.tick; }]])
  test(`L5 ${why} it stays on the head: programmes stop, the rule is contained, the world runs on`, async (t) => {
    t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
    const w = await world(t), host = w.f.host, {Ada} = w.souls;
    const walk = ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(10); arrange(host);
    const tick = host.engine.world.tick; w.control.fault = violate('support.floating', [Ada.entityId]); w.control.at = tick + 3; await w.tick(10);
    assert.equal(host.paused, false); assert.equal(byRung(host).rewind, 1); assert.ok(host.engine.world.tick > tick, 'it stayed on the head');
    assert.equal(w.f.db.db.prepare("SELECT COUNT(*) n FROM events WHERE author='world:rewind'").get().n, 1);
    assert.equal(read(w, Ada, walk).code, 'world.rewound'); await w.tick(5); ok(await act(w, Ada, {capability: 'walk:yard'}));
  });

test('L5 a thrown step contained on the head still boots: the replay survives what the live tick survived', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'last-rung-')), path = join(dir, 'world.db'), w = await world(t, repair, path); let db2, h2;
  t.after(() => { try { h2?.stop(); db2?.close(); } catch { /* the first failure is the one that matters */ } rmSync(dir, {recursive: true, force: true}); });
  await w.tick(5); w.f.host.lastRewindTick = w.f.host.engine.world.tick; w.control.throwAt = w.f.host.engine.world.tick + 2; await w.tick(10);
  assert.equal(byRung(w.f.host).rewind, 1);
  const hash = w.f.host.engine.stateHash(), tick = w.f.host.engine.world.tick; w.comms.close(); w.f.host.stop(); w.f.db.close();
  db2 = new Db(path); h2 = new WorldHost(db2, w.factory, seed, 1e9, worldId, {durableClockV1: true}); h2.boot();
  assert.equal(h2.engine.world.tick, tick); assert.equal(h2.engine.stateHash(), hash);
});

for (const clean of [false, true])
  test(`L7 a ${clean ? 'clean' : 'crash'} restart after a rewind reaches the live state`, async (t) => {
    t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
    const dir = mkdtempSync(join(tmpdir(), 'last-rung-')), path = join(dir, 'world.db'), w = await world(t, repair, path), {Ada} = w.souls; let db2, h2;
    t.after(() => { try { h2?.stop(); db2?.close(); } catch { /* the first failure is the one that matters */ } rmSync(dir, {recursive: true, force: true}); });
    if (!clean) t.mock.method(w.f.host, 'snapshotHead', () => ({tick: 0, stateHash: ''}));   // no snapshot after it, so the boot replays the recipe
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

const quiet = (t) => { t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {}); };
const onDisk = (t) => { const dir = mkdtempSync(join(tmpdir(), 'last-rung-')); t.after(() => rmSync(dir, {recursive: true, force: true})); return join(dir, 'world.db'); };
const reboot = (t, w, path) => {
  w.comms.close(); w.f.host.stop(); w.f.db.close();
  const db2 = new Db(path), h2 = new WorldHost(db2, w.factory, seed, 1e9, worldId, {durableClockV1: true}); t.after(() => { try { h2.stop(); db2.close(); } catch { /* the first failure is the one that matters */ } });
  h2.boot(); return h2;
};
const rows = (w, where = '1') => w.f.db.db.prepare(`SELECT COUNT(*) n FROM events WHERE ${where}`).get().n;
// each fires at the ticks it was armed for, live and in every replay, as a bug in the engine would
const armed = (w) => { const at = w.control.ticks ??= new Set(); at.add(w.f.host.engine.world.tick + 2); return at; };
const faultOnce = {
  'a violation': async (w, s) => { const at = armed(w); w.control.every = (r) => at.has(r.tick) ? [{code: 'support.floating', message: 'forced', subjects: [s.entityId]}] : []; await w.tick(4); },
  'a thrown step': async (w) => { const at = armed(w); w.control.midThrow = (e) => at.has(e.world.tick); await w.tick(4); },
  'a throw before the tick moves': async (w) => { const at = armed(w); w.control.preThrow = (e) => at.has(e.world.tick); await w.tick(4); },
};
for (const [kind, once] of Object.entries(faultOnce))
  test(`L7 ${kind} again in the cooldown, with a Soul acting: the stop is written, and a crash restart reaches the same world`, async (t) => {
    quiet(t);
    const path = onDisk(t), w = await world(t, repair, path), host = w.f.host, {Ada, Bo} = w.souls;
    host.lastRewindTick = host.engine.world.tick;
    await once(w, Ada); assert.equal(rows(w, "author='world:rewind'"), 1);
    const walk = ok(await act(w, Bo, {capability: 'walk:shed'})); await w.tick(10); assert.ok(host.engine.programOf(Bo.entityId));
    await once(w, Ada); await w.tick(8);
    assert.equal(rows(w, "author='world:rewind'"), 2); assert.equal(host.engine.programOf(Bo.entityId), null);
    assert.equal(read(w, Bo, walk).code, 'world.rewound');
    const hash = host.engine.stateHash(), tick = host.engine.world.tick, h2 = reboot(t, w, path);
    assert.equal(h2.engine.world.tick, tick); assert.equal(h2.engine.stateHash(), hash); assert.equal(h2.engine.programOf(Bo.entityId), null);
  });

test('L7 a step that throws part way with a programme running: live and a crash restart agree, kernel too', async (t) => {
  quiet(t);
  const path = onDisk(t), w = await world(t, repair, path), host = w.f.host, {Bo} = w.souls;
  ok(await act(w, Bo, {capability: 'walk:shed'})); await w.tick(10);
  host.lastRewindTick = host.engine.world.tick; const at = host.engine.world.tick + 2; w.control.midThrow = (e) => e.world.tick === at; await w.tick(6);
  const hash = host.engine.stateHash(), kernel = kernelHash(host.kernel), tick = host.engine.world.tick, h2 = reboot(t, w, path);
  assert.equal(h2.engine.world.tick, tick); assert.equal(h2.engine.stateHash(), hash); assert.equal(kernelHash(h2.kernel), kernel);
});

test('L2 a step that throws before its tick moves still moves the clock, so the cooldown ends', async (t) => {
  quiet(t);
  const w = await world(t), host = w.f.host, t0 = host.engine.world.tick;
  w.control.preThrow = () => true; await w.tick(50);
  assert.equal(host.engine.world.tick, t0 + 50); assert.equal(host.paused, false); assert.equal(host.clockAvailable, true);
});

for (const [kind, key] of [['before its tick moves', 'preThrow'], ['part way through', 'midThrow']])
  test(`L2 a step that throws ${kind} on every tick for minutes: one named state, acts refused, no more rewinds, and a clean tick ends it`, async (t) => {
    quiet(t);
    const w = await world(t), host = w.f.host, {Ada, Bo} = w.souls;
    w.control[key] = () => true; await w.tick(20);
    const walk = ok(await act(w, Ada, {capability: 'walk:shed'})); await w.tick(200);
    assert.equal(read(w, Ada, walk).phase, 'failed'); assert.equal(read(w, Ada, walk).code, 'world.rewound');
    assert.match(host.stepFailing, /fixture\./); assert.equal(host.glitches.byRule['engine.step-failing'].halt, 1);
    const refused = await w.edge.act(Bo, {capability: 'walk:shed'}); assert.equal(refused.accepted, false); assert.equal(refused.code, 'world.step-failing'); assert.ok(refused.reason);
    const before = rows(w), recipes = rows(w, "author='world:recovery'"); await w.tick(2600);
    assert.equal(rows(w), before, 'nothing new to say'); assert.ok(recipes <= 1, `${recipes} recipes`);
    assert.equal(host.glitches.byRule['engine.step-failing'].halt, 1); assert.equal(host.paused, false); assert.equal(host.clockAvailable, true);
    w.control[key] = null; await w.tick(3);
    assert.equal(host.stepFailing, null); ok(await act(w, Bo, {capability: 'walk:shed'})); const x = host.engine.world.entities[Bo.entityId].pose.p[0]; await w.tick(10);
    assert.notEqual(host.engine.world.entities[Bo.entityId].pose.p[0], x, 'bodies move again');
  });

test('L7 a world whose every step fails keeps snapshotting, so what a restart must replay stays bounded', async (t) => {
  quiet(t);
  const path = onDisk(t), w = await world(t, repair, path), host = w.f.host;
  w.control.midThrow = () => true; await w.tick(400); assert.ok(host.stepFailing);
  const snap = () => w.f.db.latestSnapshot(host.worldId).tick, first = snap(); host.snapshotEvery = 100; await w.tick(150); for (let i = 0; i < 20; i++) await setImmediate();
  assert.ok(snap() > first, `snapshot stayed at ${first}`);
  reboot(t, w, path);
});

test('the rewind cooldown survives a restart', async (t) => {
  quiet(t);
  const path = onDisk(t), w = await world(t, repair, path), {Ada} = w.souls;
  w.control.fault = violate('support.floating', [Ada.entityId]); w.control.at = w.f.host.engine.world.tick + 2; await w.tick(5);
  const at = w.f.host.lastRewindTick; assert.ok(Number.isFinite(at));
  assert.equal(reboot(t, w, path).lastRewindTick, at);
});

test('L2 construction.unsafe-failure thrown from a step takes the same way down, and never a halt', async (t) => {
  quiet(t);
  const w = await world(t), host = w.f.host, at = host.engine.world.tick + 2;
  w.control.midThrow = (e) => { if (e.world.tick === at) throw new Error('construction.unsafe-failure: forced'); return false; }; await w.tick(6); w.control.midThrow = null; await w.tick(3);
  assert.equal(host.paused, false); assert.equal(byRung(host).rewind, 1); assert.equal(byRung(host).halt ?? 0, 0);
});

for (const [rung, why] of [['a rewind', 'support.floating'], ['a stop in place', 'beam.unseated']])
  test(`L2 ${rung} that can't be written is a named durability halt, not a crash`, async (t) => {
    quiet(t);
    const w = await world(t), host = w.f.host, {Ada} = w.souls;
    if (rung !== 'a rewind') host.lastRewindTick = host.engine.world.tick;
    t.mock.method(w.f.db, 'appendEvent', (_, e) => { if (e.kind === 'rules') throw new Error('fixture.disk-full'); });
    w.control.fault = violate(why, [Ada.entityId]); w.control.at = host.engine.world.tick + 2; await w.tick(4);
    assert.equal(host.paused, true); assert.equal(host.clockAvailable, false); assert.equal(host.glitches.byRule['durability.repair'].halt, 1);
  });

test('a durability failure still halts, and says so', async (t) => {
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const w = await world(t), host = w.f.host; t.mock.method(host, 'persistClockFrontier', () => { throw new Error('fixture.disk-full'); });
  await assert.rejects(async () => { await w.tick(3); }, /fixture\.disk-full/);
});
