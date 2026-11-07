// PC10 (#689): a shared carry across a server restart (docs/design/shared-execution.md §3). A restart is a new process
// on the same database: clean (stop, drain, snapshot, as the server's own shutdown does) or a crash (no snapshot). On a
// durable-clock world the boot replays to the last persisted tick, so both resume exactly. Nothing new is serialized:
// the native carry rides the engine snapshot and the operation rides its invitation row. After the boot the op, its
// claims, the load and both receipts are what they were, and the carry ends as an unrestarted one does. The stop's
// event and its journal are one transaction, so a stopping op is never asked to stop again. A world restored to before
// an op's end (no durable clock) does not silently carry the load again; a gone programme ends the op visibly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory, seed, worldId} from '../../apps/server/test/native-owner-fixture.ts';
import {Db} from '../../apps/server/src/db.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldHost} from '../../apps/server/src/world.ts';
import {kernelHash} from '../../packages/kernel/src/index.ts';

/** Mount the edge on a host as the server does (ledger, routes, the god's bridge). `fading`: Comms with fading (the
 *  beam on or off) and the LINK body rule, as a server with SIM_BEAM and agents' presence runs it. */
function mount(w, host, db) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry: true}), app = new Hono(), deps = {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current};
  let comms;
  if (w.fading) {
    comms = registerEdgeComms(app, deps, {fading: true, beam: w.fading.beam, sweepMs: 0}); edge.attachComms(comms);
    comms.fading.addHold((id) => edge.postureHold(id));
    edge.attachPresence({soulPresence: () => ({listening: true, at: Date.now()})});
  } else comms = mountEdgeRoutes(app, deps);
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  installEngineBridge({host, god, edge, log() {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god});
}
async function world(t, {durable = true, fading = null} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc10-restart-')), path = join(dir, 'sim.db'), opts = durable ? {durableClockV1: true} : undefined;
  const f = fixture(path, factory, opts); f.brain.quiesce();
  const w = {f, path, opts, fading, current: null, hosts: [f.host], comms: null};
  t.after(() => { try { w.comms?.close(); } catch {} for (const h of w.hosts) try { h.stop(); } catch {} try { if (w.db.db.isOpen) w.db.close(); } catch {} rmSync(dir, {recursive: true, force: true}); });
  mount(w, f.host, f.db);
  w.tick = async (n = 5) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  await w.tick();
  const souls = {};
  for (const name of ['Ada', 'Bo', 'Cy']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Shared restart test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await w.tick();
  const [ax, , az] = f.host.engine.world.entities[souls.Ada.entityId].pose.p;
  for (const [s, x, z] of [[souls.Bo, ax, az + 3], [souls.Cy, ax - 3, az - 5]]) await accept(f.host, f.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
  // the §7 scene: Ada and Bo beside a loose shared-carry beam on open level-0 ground, the shed about 8 m away
  assert.notEqual(w.god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
  ]}).accepted, false);
  await w.tick(60);
  return Object.assign(w, {souls, ax, az, idOf: (n) => w.god.model.get(n).id});
}
/** A new process on the same database. Clean: stop, drain, snapshot (the server's shutdown). Crash: nothing more. */
async function restart(w, clean, offline) {
  w.comms.close(); w.host.stop();
  if (clean) { w.host.drainInputs(); w.host.saveSnapshot(true); }
  offline?.(w.db); w.db.close();
  const db = new Db(w.path), h = new WorldHost(db, factory, seed, 1e9, worldId, w.opts), boot = h.boot(); h.drainInputs();
  w.hosts.push(h); mount(w, h, db);
  return boot;
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = async (w, s, input) => accept(w.host, w.edge.act(s, input));
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const streamOf = (w, s) => w.comms.streams.read(s.soulId, 0).events;
const count = (w, sql) => Number(w.db.db.prepare(sql).get().n);
const decisions = (w, op) => count(w, `SELECT COUNT(*) n FROM events WHERE kind='decision' AND payload LIKE '%shared-commit:${op}%'`);
const stops = (w) => w.db.db.prepare("SELECT payload FROM events WHERE kind='edge-stop'").all().map((r) => JSON.parse(r.payload)).filter((p) => p.programId);
const checkpoints = (w) => count(w, "SELECT COUNT(*) n FROM events WHERE kind='rules' AND payload LIKE '%unsnappable-head%'");
const flat = (p) => Math.hypot(p[0], p[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const view = (x) => ({id: x.id, phase: x.phase, code: x.code ?? null, programId: x.programId ?? null, shared: x.shared});

/** Commit Ada and Bo's carry of the beam to the shed. Sample every tick, across the restart too, until the op ends.
 *  `stopWhen(ctx)`: Bo asks to stop; `restartWhen(ctx)`: the restart (once). Asserts no teleport, no unsupported load. */
async function carry(w, t, {restartWhen, clean = true, stopWhen = () => false, afterRestart, offline, max = 6000}) {
  const {Ada, Bo} = w.souls, beam = w.idOf('beam');
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}, clientRef: 'ada-carry'})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}, clientRef: 'bo-accept'}));
  for (let n = 0; n < 60 && inviteOf(w, id).state === 'pending'; n++) await w.tick(1);
  assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, Ada, p)));
  const op0 = inviteOf(w, id).shared.op, crew = [[Ada, p], [Bo, a]], last = {}, seen = {phases: [], maxStep: 0, maxLoadStep: 0, unsupported: 0};
  let stop = null, before = null, after = null, boot = null;
  for (let n = 0; n < max && inviteOf(w, id).shared.op.phase !== 'ended'; n++) {
    await w.tick(1);
    const E = w.host.engine.world.entities, phase = w.host.engine.programAction?.(op0.programId)?.action.phase, op = inviteOf(w, id).shared.op;
    if (phase && seen.phases.at(-1) !== phase) seen.phases.push(phase);
    for (const [s] of crew) { const q = E[s.entityId].pose.p; if (last[s.name]) seen.maxStep = Math.max(seen.maxStep, flat(sub(q, last[s.name]))); last[s.name] = [...q]; }
    const b = E[beam].pose.p; if (last.beam) seen.maxLoadStep = Math.max(seen.maxLoadStep, flat(sub(b, last.beam)), Math.abs(b[1] - last.beam[1])); last.beam = [...b];
    if (E[beam].phase !== 'carried' && E[beam].support?.kind !== 'ground') seen.unsupported++;
    const ctx = {phase, op, n, stop, E, beam};
    if (!stop && op.phase !== 'ended' && stopWhen(ctx)) stop = ok(await act(w, Bo, {capability: `stop-carry:${op.id}`, clientRef: 'bo-stop'}));
    if (!before && op.phase !== 'ended' && restartWhen({...ctx, stop})) {
      w.host.drainInputs();
      before = {phase, tick: w.host.engine.world.tick, inv: inviteOf(w, id), receipts: crew.map(([s, r]) => view(read(w, s, r))), stop: stop && view(read(w, Bo, stop)),
        snap: w.host.engine.canSnapshot?.() !== false, hash: {engine: w.host.engine.stateHash(), kernel: kernelHash(w.host.kernel)}, held: E[beam].phase, decisions: decisions(w, op0.id), stops: stops(w).length};
      boot = await restart(w, clean, offline);
      const E2 = w.host.engine.world.entities;
      after = {tick: w.host.engine.world.tick, inv: inviteOf(w, id), receipts: crew.map(([s, r]) => view(read(w, s, r))), stop: stop && view(read(w, Bo, stop)),
        hash: {engine: w.host.engine.stateHash(), kernel: kernelHash(w.host.kernel)}, held: E2[beam].phase, phase: w.host.engine.programAction?.(op0.programId)?.action.phase};
      await afterRestart?.({p, a, id, op: inviteOf(w, id).shared.op});
    }
  }
  const end = inviteOf(w, id).shared.op;
  t.diagnostic(`native phases ${seen.phases.join(',')}; restart (${clean ? 'clean' : 'crash'}, boot from ${boot?.from}) in ${before?.phase} at tick ${before?.tick}; largest step carrier ${seen.maxStep.toFixed(3)} m, load ${seen.maxLoadStep.toFixed(3)} m; op ${JSON.stringify({phase: end.phase, result: end.result, code: end.code, stop: end.stop?.name})}`);
  assert.ok(before, 'the restart happened mid-carry');
  assert.ok(seen.maxStep < 0.1, `no carrier teleports, across the restart too (${seen.maxStep.toFixed(3)} m)`); assert.ok(seen.maxLoadStep < 0.1, `the load never jumps or drops (${seen.maxLoadStep.toFixed(3)} m)`);
  assert.equal(seen.unsupported, 0, 'the load is always carried or lying on the ground');
  return {p, a, id, op0, op: end, crew, stop, before, after, boot, beam, seen};
}
/** A1/A2: the restored world and journal are the ones before the restart. */
function restored(w, r) {
  const {before: b, after: x} = r;
  assert.equal(x.tick, b.tick, 'the clock resumes at the same tick');
  assert.deepEqual(x.hash, b.hash, 'the same engine and kernel state');
  assert.deepEqual(x.inv, b.inv, 'the same invitation: op id, revision, claims, load, stop');
  assert.deepEqual(x.receipts, b.receipts, 'both members keep the same receipts');
  assert.deepEqual(x.stop, b.stop, 'the stop receipt is the same');
  assert.equal(x.held, b.held, 'the load is where it was (held or lying)');
  assert.equal(x.phase, b.phase, 'the native carry is in the same phase');
  assert.equal(x.inv.shared.op.claims.length, 3, 'the claims are kept');
  assert.equal(b.decisions, 1);
}
/** A2: one decision, one stop at most, the ending the same as without a restart. */
function ended(w, r, result, stopEvents = r.stop ? 1 : 0) {
  const E = w.host.engine.world.entities, ends = new Set();
  assert.equal(decisions(w, r.op.id), 1, 'exactly one carry decision');
  assert.equal(stops(w).length, stopEvents, 'no stop is asked again after the restart');
  assert.equal(count(w, "SELECT COUNT(*) n FROM edge_receipts_v1 WHERE code='receipt.lost-on-restart'"), 0, 'no receipt was lost');
  assert.equal(r.op.id, r.op0.id); assert.equal(r.op.programId, r.op0.programId); assert.equal(r.op.result, result);
  for (const [s, rc] of r.crew) {
    const x = read(w, s, rc); ends.add(x.endedTick);
    assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.shared.result, result); assert.equal(x.shared.op, r.op.id);
    assert.equal(E[s.entityId].human.grip ?? null, null, `${s.name}'s hands are free`);
  }
  assert.equal(ends.size, 1, 'both receipts end in the same tick');
  assert.equal(E[r.beam].support?.kind, 'ground', 'the beam lies on the ground'); assert.equal(E[r.beam].reservedBy ?? null, null, 'the load claim is gone');
}

// A clean restart on a world without the durable clock: the engine cannot snapshot a running carry, so the shutdown
// logs its checkpoint (`unsnappable-head`) and the boot replays to it. A crash on a durable-clock world replays to the
// last persisted tick. Both resume exactly; neither needs a serializer.
for (const phase of ['gather', 'lift', 'move', 'set-down']) for (const clean of [true, false]) {
  test(`PC10 A1/A2: a ${clean ? 'clean restart (no durable clock)' : 'crash (durable clock)'} during ${phase} restores the carry exactly; it arrives`, {timeout: 300000}, async (t) => {
    const w = await world(t, {durable: !clean});
    const r = await carry(w, t, {clean, restartWhen: (c) => c.phase === phase && (phase !== 'move' || c.n % 7 === 3)});
    assert.equal(r.before.snap, false, 'a running carry has no exact snapshot (the checkpoint is deferred)');
    assert.equal(r.boot.from, 'genesis');
    if (clean) assert.equal(checkpoints(w), 1, 'the clean shutdown logged its checkpoint for the replay');
    restored(w, r); ended(w, r, 'arrived');
  });
}

for (const clean of [true, false]) test(`PC10 A1/A2b/A3: a ${clean ? 'clean restart (no durable clock)' : 'crash (durable clock)'} during the stop's cleanup resumes it; the stop is not asked again; stopped`, {timeout: 300000}, async (t) => {
  const w = await world(t, {durable: !clean}), {Bo} = w.souls;
  let replay = null;
  const r = await carry(w, t, {clean, stopWhen: (c) => c.phase === 'move' && c.n > 40, restartWhen: (c) => !!c.stop && c.op.phase === 'stopping', afterRestart: async ({op}) => {
    // the same stop, retried after the boot with its clientRef: the original receipt, nothing logged or written
    const receipts0 = count(w, 'SELECT COUNT(*) n FROM edge_receipts_v1');
    replay = ok(await act(w, Bo, {capability: `stop-carry:${op.id}`, clientRef: 'bo-stop'}));
    assert.equal(count(w, 'SELECT COUNT(*) n FROM edge_receipts_v1'), receipts0, 'no new receipt'); assert.equal(stops(w).length, 1);
  }});
  assert.equal(r.before.stops, 1, 'the stop was logged with its journal');
  assert.equal(r.before.inv.shared.op.phase, 'stopping'); assert.equal(r.before.stop.phase, 'completed'); assert.equal(r.before.stop.code, 'shared.stop-requested');
  assert.equal(replay.receipt.id, r.stop.receipt.id, 'the stop replay is the same receipt');
  if (clean) assert.equal(checkpoints(w), 1);
  restored(w, r); ended(w, r, 'stopped');
  for (const [s, rc] of r.crew) assert.equal(read(w, s, rc).code, 'shared.stopped');
});

test('PC10 A2b: the stop event and its journal are one transaction; two stops in one drain log one; a failed journal logs nothing', {timeout: 300000}, async (t) => {
  const w = await world(t), {Ada, Bo} = w.souls, beam = w.idOf('beam');
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  for (let n = 0; n < 200 && w.host.engine.programAction?.(inviteOf(w, id).shared.op?.programId ?? '')?.action.phase !== 'move'; n++) await w.tick(1);
  const op = inviteOf(w, id).shared.op; assert.equal(op.phase, 'started');
  // a journal that fails rolls the event back with it: nothing is logged, the op is unchanged, no receipt is written
  const real = w.edge.together.sharedStopping.bind(w.edge.together), receipts = () => count(w, 'SELECT COUNT(*) n FROM edge_receipts_v1');
  const n0 = receipts(); w.edge.together.sharedStopping = () => { throw new Error('journal fault (test)'); };
  const failed = await act(w, Bo, {capability: `stop-carry:${op.id}`});
  w.edge.together.sharedStopping = real;
  assert.equal(failed.accepted, false); assert.equal(failed.code, 'state.changed');
  assert.equal(stops(w).length, 0, 'no stop event without its journal'); assert.equal(receipts(), n0, 'no stop receipt'); assert.equal(inviteOf(w, id).shared.op.phase, 'started');
  assert.ok(w.host.engine.programAction?.(op.programId), 'the carry goes on');
  // two members ask in the same drain: one event; the second is answered as already asked
  const both = [w.edge.act(Bo, {capability: `stop-carry:${op.id}`}), w.edge.act(Ada, {capability: `stop-carry:${op.id}`})];
  const [b, a] = await Promise.all(both.map((x) => accept(w.host, x)));
  ok(b); ok(a);
  assert.equal(stops(w).length, 1, 'one stop event'); assert.equal(b.receipt.code, 'shared.stop-requested'); assert.equal(a.receipt.code, 'shared.stop-asked'); assert.match(a.receipt.reason, /^Bo already asked to stop/);
  const now = inviteOf(w, id).shared.op; assert.equal(now.phase, 'stopping'); assert.equal(now.stop.receipt, b.receipt.id, 'the journal names the logged stop');
  for (let n = 0; n < 2000 && inviteOf(w, id).shared.op.phase !== 'ended'; n++) await w.tick(1);
  assert.equal(inviteOf(w, id).shared.op.result, 'stopped'); assert.equal(stops(w).length, 1);
  t.diagnostic(`failed journal -> ${failed.code}; then ${stops(w).length} stop event, Ada's answer ${a.receipt.code}`);
});

test('PC10 A3: after a restart, retries agree with the world: clientRef replays, a stale accept is busy, then not-running', {timeout: 300000}, async (t) => {
  const w = await world(t), {Ada, Bo} = w.souls, seenAfter = {};
  const r = await carry(w, t, {clean: true, restartWhen: (c) => c.phase === 'move' && c.n % 7 === 3, afterRestart: async ({p, a, id, op}) => {
    const beam = w.idOf('beam'), seq0 = count(w, 'SELECT MAX(seq) n FROM events'), receipts0 = count(w, 'SELECT COUNT(*) n FROM edge_receipts_v1');
    seenAfter.carry = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}, clientRef: 'ada-carry'}));
    seenAfter.accept = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}, clientRef: 'bo-accept'}));
    seenAfter.stale = await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}});
    seenAfter.walk = await act(w, Ada, {capability: w.edge.capabilities(Ada).find((c) => c.verb === 'walk' && c.available).id});
    assert.equal(seenAfter.carry.receipt.id, p.receipt.id, 'carry-with replay: the same receipt'); assert.equal(seenAfter.accept.receipt.id, a.receipt.id, 'accept replay: the same receipt');
    assert.equal(seenAfter.carry.receipt.phase, 'started'); assert.equal(seenAfter.carry.receipt.shared.op, op.id);
    assert.equal(seenAfter.stale.accepted, false); assert.equal(seenAfter.stale.code, 'shared.busy'); assert.equal(seenAfter.walk.code, 'shared.busy');
    for (let i = 0; i < 3; i++) await w.tick(1);
    assert.equal(count(w, 'SELECT COUNT(*) n FROM edge_receipts_v1'), receipts0, 'no new receipt');
    assert.equal(count(w, `SELECT COUNT(*) n FROM events WHERE seq > ${seq0} AND kind IN ('decision','edge-stop')`), 0, 'no decision or stop since the retries');
  }});
  restored(w, r); ended(w, r, 'arrived');
  // after the end: the same receipts read arrived, a stop is not-running, an accept is gone
  for (const [s, rc] of r.crew) { const x = read(w, s, rc); assert.equal(x.phase, 'completed'); assert.equal(x.shared.result, 'arrived'); }
  const late = await act(w, Bo, {capability: `stop-carry:${r.op.id}`}); assert.equal(late.code, 'shared.not-running');
  const gone = await act(w, Bo, {capability: `accept:${r.id}`, params: {revision: 1}}); assert.equal(gone.code, 'invite.gone'); assert.match(gone.reason, /has ended \(arrived\)/);
  assert.equal(decisions(w, r.op.id), 1);
  t.diagnostic(`after restart: stale accept ${seenAfter.stale.code}, walk ${seenAfter.walk.code}; after end: stop ${late.code}, accept ${gone.code}`);
});

test('PC10 A3b(i): a world restored to before the op started ends it for every member, saying so', {timeout: 300000}, async (t) => {
  const w = await world(t, {durable: false});
  // a backup older than the commit: the commit's event and everything after it are gone, the journal still has the op
  let commitSeq = null;
  const r = await carry(w, t, {clean: false, restartWhen: (c) => c.phase === 'lift', offline: (db) => {
    commitSeq = db.db.prepare("SELECT MIN(seq) s FROM events WHERE kind='decision' AND payload LIKE '%shared-commit:%'").get().s;
    db.db.prepare('DELETE FROM events WHERE seq >= ?').run(commitSeq); db.db.prepare('DELETE FROM snapshots').run();
  }}).catch((e) => e);
  // the helper's checks of a restored carry do not hold here; the op itself is what this test reads
  assert.ok(commitSeq, 'the commit was logged');
  const id = w.db.db.prepare("SELECT invite_id FROM edge_invites_v1 WHERE body LIKE '%\"op\":{%'").get().invite_id;
  for (let n = 0; n < 200 && inviteOf(w, id).shared.op.phase !== 'ended'; n++) await w.tick(1);
  const op = inviteOf(w, id).shared.op;
  assert.equal(op.phase, 'ended'); assert.equal(op.code, 'shared.ended');
  for (const s of [w.souls.Ada, w.souls.Bo]) {
    const rid = w.db.db.prepare("SELECT receipt_id FROM edge_receipts_v1 WHERE soul_id=? AND capability LIKE '%' AND (capability LIKE 'carry-with:%' OR capability LIKE 'accept:%')").get(s.soulId).receipt_id, x = w.edge.receipt(s.soulId, rid);
    assert.equal(x.phase, 'failed', s.name); assert.equal(x.code, 'shared.ended'); assert.match(x.reason, /restored to a moment before the shared carry of beam started/);
    assert.ok(streamOf(w, s).some((e) => e.kind === 'receipt' && e.receipt?.id === rid && e.receipt.code === 'shared.ended'), `${s.name}'s stream is told`);
  }
  assert.equal(w.host.engine.programAction?.(op.programId) ?? null, null, 'nothing is carried');
  t.diagnostic(`restored before the commit: ${r instanceof Error ? 'no carry ran on' : 'carry ran'}; op ${op.code}`);
});

test('PC10 A3b(ii): a world restored to before an op ended does not carry it again silently', {timeout: 300000}, async (t) => {
  const w = await world(t, {durable: false}), {Ada, Bo} = w.souls, beam = w.idOf('beam');
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  for (let n = 0; n < 6000 && inviteOf(w, id).shared.op?.phase !== 'ended'; n++) await w.tick(1);
  const op = inviteOf(w, id).shared.op; assert.equal(op.result, 'arrived');
  // a crash on a world without the durable clock: the boot replays only to the last logged event, before the end
  const lines = []; t.mock.method(console, 'error', (...a) => lines.push(a.join(' ')));
  const boot = await restart(w, false), tick = w.host.engine.world.tick;
  assert.ok(tick < op.endedTick, `restored to tick ${tick}, before the end at ${op.endedTick}`);
  assert.equal(w.host.engine.programOf(Ada.entityId), op.programId, 'the engine replays the ended op\'s programme');
  for (let n = 0; n < 2000 && w.host.engine.programOf(Ada.entityId) === op.programId; n++) await w.tick(1);
  const stop = stops(w).filter((x) => x.why === 'shared.restored');
  assert.equal(stop.length, 1, 'its programme is stopped once, logged'); assert.equal(stop[0].programId, op.programId);
  for (const [s, rc] of [[Ada, p], [Bo, a]]) {
    const x = read(w, s, rc); assert.equal(x.phase, 'completed'); assert.equal(x.shared.result, 'arrived', 'the ended receipt keeps its truth');
    assert.ok(streamOf(w, s).some((e) => e.kind === 'shared.restored' && /restored to a moment before the shared carry of beam ended/.test(e.text)), `${s.name} is told`);
  }
  assert.ok(lines.some((l) => l.includes(op.id) && /restored to tick .* before this carry ended/.test(l)), 'an operator line is logged');
  const E = w.host.engine.world.entities;
  assert.equal(E[beam].support?.kind, 'ground', 'the beam lies on the ground'); assert.equal(decisions(w, op.id), 1, 'no new carry decision');
  for (const s of [Ada, Bo]) assert.equal(E[s.entityId].human.grip ?? null, null, `${s.name}'s hands are free`);
  t.diagnostic(`crash rewound to tick ${tick} (boot from ${boot.from}), end was ${op.endedTick}; replayed programme stopped by one logged edge-stop`);
});

test('PC10 A3c: the LINK migration after a restart does not relocate a member of a running carry', {timeout: 300000}, async (t) => {
  const w = await world(t, {fading: {beam: true}}), {Bo} = w.souls;
  let relocates = null;
  const r = await carry(w, t, {clean: true, restartWhen: (c) => c.phase === 'move' && c.n % 7 === 3, offline: (db) => {
    // Bo was taken by the beam while the crew carried (his receipt stays open, PC09); the server comes back without it
    db.db.prepare("UPDATE edge_comms_activity SET colour='gone' WHERE world_id=? AND soul_id=?").run(worldId, Bo.soulId);
    w.fading = {beam: false};
    relocates = Number(db.db.prepare("SELECT MAX(seq) s FROM events").get().s);
  }, afterRestart: () => {
    // where Bo stands is not in any place for the migration's first sweep, so only the crew keeps him where he is
    const places = w.edge.places, real = places.containing.bind(places), until = w.host.engine.world.tick + 60;
    places.containing = (...a) => w.host.engine.world.tick < until ? [] : real(...a);
  }});
  const moved = w.db.db.prepare("SELECT payload FROM events WHERE kind='edge-relocate' AND seq > ?").all(relocates).map((x) => JSON.parse(x.payload));
  assert.deepEqual(moved.filter((x) => x.soulId === Bo.soulId), [], 'Bo is not relocated out of the crew');
  assert.equal(count(w, `SELECT COUNT(*) n FROM edge_comms_activity WHERE soul_id='${Bo.soulId}' AND colour='gone'`), 0, 'the migration did run (Bo is back)');
  // the restarted ledger re-learns that Bo was gone: his fade is his stop (PC09), once; the crew sets the beam down
  assert.equal(r.op.stop?.away, true); assert.equal(r.op.stop?.name, 'Bo');
  ended(w, r, r.op.result, 1); assert.match(r.op.result, /^stopped/);
});

test('PC10 A3b: a world restored to before a stop (an older backup than the journal) is asked to stop again; it ends stopped', {timeout: 300000}, async (t) => {
  const w = await world(t, {durable: false});
  const r = await carry(w, t, {clean: false, stopWhen: (c) => c.phase === 'move' && c.n > 40, restartWhen: (c) => !!c.stop && c.op.phase === 'stopping', offline: (db) => {
    const seq = db.db.prepare("SELECT MIN(seq) s FROM events WHERE kind='edge-stop' AND payload LIKE '%shared.stop%'").get().s;
    db.db.prepare('DELETE FROM events WHERE seq >= ?').run(seq); db.db.prepare('DELETE FROM snapshots').run();
  }}).catch((e) => e);
  // the bodies are back where the older world had them, so the helper's restored-carry checks do not hold here
  assert.ok(r instanceof Error && /teleports|restored/.test(r.message) || r?.op, String(r?.message ?? ''));
  const id = w.db.db.prepare("SELECT invite_id FROM edge_invites_v1 WHERE body LIKE '%\"op\":{%'").get().invite_id;
  for (let n = 0; n < 3000 && inviteOf(w, id).shared.op.phase !== 'ended'; n++) await w.tick(1);
  const op = inviteOf(w, id).shared.op;
  assert.equal(stops(w).length, 1, 'the stop is logged again, once'); assert.equal(op.result, 'stopped'); assert.equal(op.stop.name, 'Bo');
  t.diagnostic(`restored before the stop: re-stopped once, ${op.result}`);
});
