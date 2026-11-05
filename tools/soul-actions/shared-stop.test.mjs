// PC08 (#687): stopping a running shared carry safely (docs/design/shared-execution.md §3 "Stopping", §2 results). Any
// member acts `stop-carry:<op>`; the stop is logged as `edge-stop` naming the op's programme; the native cancel is the
// only cleanup (walkers stop, a grasp lets go, a lift is lowered back, a move is set down where it is if the ground is
// clear, else the crew carries on along its validated route to the first clear spot). The claims stay until the load is
// set down; both members' receipts then end together `completed` with `shared.result: 'stopped'` (or
// `stopped-at-destination`), never `arrived`, and each Soul is free on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

async function world(t, extra = () => []) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry: true}), app = new Hono(); let current;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => current});
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  const souls = {};
  for (const name of ['Ada', 'Bo', 'Cy']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Shared stop test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await tick();
  const E = f.host.engine.world.entities, pos = (s) => E[s.entityId].pose.p;
  const [ax, , az] = pos(souls.Ada);
  const at = async (s, x, z) => {
    await accept(f.host, f.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
    const q = f.host.engine.world.entities[s.entityId].pose.p; assert.ok(Math.hypot(q[0] - x, q[2] - z) < 3, `${s.name} stands at ${x},${z}`);
  };
  await at(souls.Bo, ax, az + 3); await at(souls.Cy, ax - 3, az - 5);
  // the §7 scene: Ada and Bo beside a loose shared-carry beam on open level-0 ground, the shed about 8 m away
  assert.notEqual(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    ...extra(ax, az),
  ]}).accepted, false);
  await tick(60);
  const idOf = (n) => god.model.get(n).id;
  return {f, edge, god, app, comms, tick, souls, pos, idOf, at, ax, az, setCurrent: (s) => { current = s; }};
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = async (w, s, input) => accept(w.f.host, w.edge.act(s, input));
const code = (r) => r.error?.code ?? r.code;
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const until = async (w, done, max) => { for (let n = 0; n < max && !done(); n++) await w.tick(1); };
const flat = (p) => Math.hypot(p[0], p[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const streamOf = (w, s) => w.comms.streams.read(s.soulId, 0).events;
const stops = (w) => w.f.db.db.prepare("SELECT payload FROM events WHERE kind='edge-stop'").all().map((r) => JSON.parse(r.payload)).filter((p) => p.programId);
const post = async (w, s, path, body) => { w.setCurrent(s); return (await accept(w.f.host, w.app.request(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}))).json(); };
const get = async (w, s, path) => { w.setCurrent(s); return (await accept(w.f.host, w.app.request(path))).json(); };

/** Commit Ada and Bo's carry of the beam to the shed; sample every tick until the op ends. `when(ctx)` says when Bo asks
 *  to stop (ctx: native phase, the op, n); `during(ctx)` runs each tick after. Asserts no teleport and no unsupported load. */
async function carry(w, t, when, during, max = 6000) {
  const {Ada, Bo} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  const op0 = inviteOf(w, id).shared.op; assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, Ada, p)));
  const crew = [[Ada, p], [Bo, a]], last = {}, seen = {phases: [], opPhases: new Set(), maxStep: 0, maxLoadStep: 0, start: [...E[beam].pose.p], unsupported: 0};
  let stop = null, stopPhase = null;
  for (let n = 0; n < max && inviteOf(w, id).shared.op.phase !== 'ended'; n++) {
    await w.tick(1);
    const rec = eng.programAction?.(op0.programId), phase = rec?.action.phase, op = inviteOf(w, id).shared.op;
    if (phase && seen.phases.at(-1) !== phase) seen.phases.push(phase); seen.opPhases.add(op.phase);
    for (const [s] of crew) { const q = E[s.entityId].pose.p; if (last[s.name]) seen.maxStep = Math.max(seen.maxStep, flat(sub(q, last[s.name]))); last[s.name] = [...q]; }
    const b = E[beam].pose.p; if (last.beam) seen.maxLoadStep = Math.max(seen.maxLoadStep, flat(sub(b, last.beam)), Math.abs(b[1] - last.beam[1])); last.beam = [...b];
    // supported: carried by the crew, or lying on the ground; never anything else
    if (E[beam].phase !== 'carried' && E[beam].support?.kind !== 'ground') seen.unsupported++;
    const ctx = {phase, tick: eng.world.tick, op, p, a, id, beam, E, n, stop};
    if (!stop && op.phase !== 'ended' && when(ctx)) { stopPhase = phase; stop = ok(await act(w, Bo, {capability: `stop-carry:${op.id}`})); ctx.stop = stop; }
    await during?.(ctx);
  }
  const end = inviteOf(w, id).shared.op;
  t.diagnostic(`native phases ${seen.phases.join(',')}; stop asked in ${stopPhase}; op phases ${[...seen.opPhases].join(',')}; largest step carrier ${seen.maxStep.toFixed(3)} m, load ${seen.maxLoadStep.toFixed(3)} m; op ${JSON.stringify({phase: end.phase, result: end.result, stop: end.stop, code: end.code})}`);
  assert.ok(seen.maxStep < 0.1, `no carrier teleports (${seen.maxStep.toFixed(3)} m)`); assert.ok(seen.maxLoadStep < 0.1, `the load never jumps or drops (${seen.maxLoadStep.toFixed(3)} m)`);
  assert.equal(seen.unsupported, 0, 'the load is always carried or lying on the ground');
  return {p, a, id, op: end, seen, crew, stop, stopPhase, beam};
}
const shedOf = (w) => w.edge.places.byId.get(w.god.model.get('shed').id)?.polygon ?? w.god.model.get('shed').shape.area;
const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
/** Both receipts ended in the same tick, `completed`, with the same op, result and stop; hands free; the beam on the ground. */
function stopped(w, r, result) {
  const E = w.f.host.engine.world.entities, ends = new Set();
  for (const [s, rc] of r.crew) {
    const x = read(w, s, rc); ends.add(x.endedTick);
    assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.code, 'shared.stopped'); assert.equal(x.shared.result, result, `${s.name}: ${x.reason}`);
    assert.equal(x.shared.op, r.op.id); assert.equal(x.shared.stop.by, w.souls.Bo.soulId); assert.equal(x.shared.stop.name, 'Bo'); assert.match(x.reason, /^Stopped at Bo's request/);
    assert.equal(E[s.entityId].human.grip ?? null, null, `${s.name}'s hands are free`);
    assert.ok(streamOf(w, s).some((e) => e.kind === 'shared.stopping'), `${s.name} hears the stop`);
    assert.ok(streamOf(w, s).some((e) => e.kind === 'shared.stopped' && e.result === result), `${s.name} hears it set down`);
  }
  assert.equal(ends.size, 1, 'both receipts end in the same tick');
  assert.equal(E[r.beam].support?.kind, 'ground', 'the beam lies on the ground'); assert.equal(E[r.beam].reservedBy ?? null, null, 'the load claim is gone');
  assert.equal(r.op.phase, 'ended'); assert.equal(r.op.result, result);
}

test('PC08 A1/A3: a stop mid-move sets the beam down short of the shed; both are told, then free on their own', {timeout: 300000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy} = w.souls;
  let busy = null, said = null, looked = null, again = null, ada2 = null, held = null;
  const cyWalk = ok(await act(w, Cy, {capability: w.edge.capabilities(Cy).find((c) => c.verb === 'walk' && c.available).id}));
  const r = await carry(w, t, (c) => c.phase === 'move' && c.n > 0 && flat(sub(c.E[c.beam].pose.p, [w.ax + 2, 0, w.az + 1.5])) > 2, async (c) => {
    if (!c.stop || c.op.phase === 'ended') return;
    // the stop acknowledged at once: its own receipt completed in the same tick, the member's shared receipt untouched
    if (!held) {
      held = c.op;
      const s = read(w, Bo, c.stop); assert.equal(s.phase, 'completed'); assert.equal(s.code, 'shared.stop-requested'); assert.match(s.reason, /^Bo asked to stop .*set beam down where they are if the ground there is clear/);
      for (const [m, rc] of [[Ada, c.p], [Bo, c.a]]) { const x = read(w, m, rc); assert.equal(x.phase, 'started', `${m.name} still carrying`); assert.equal(x.code, 'shared.stopping'); assert.equal(x.shared.phase, 'stopping'); }
      assert.equal(stops(w).length, 1); assert.equal(stops(w)[0].programId, c.op.programId, 'the stop names the op programme');
      assert.ok(!w.edge.capabilities(Bo).some((x) => x.id === `stop-carry:${c.op.id}`), 'no second stop is offered');
      // repeats: Bo's again is the same receipt; Ada's is her own, saying it was asked; still one stop event
      again = ok(await act(w, Bo, {capability: `stop-carry:${c.op.id}`})); assert.equal(again.receipt.id, c.stop.receipt.id);
      ada2 = ok(await act(w, Ada, {capability: `stop-carry:${c.op.id}`})); assert.equal(ada2.receipt.phase, 'completed'); assert.equal(ada2.receipt.code, 'shared.stop-asked'); assert.match(ada2.receipt.reason, /^Bo already asked to stop/);
      assert.equal(stops(w).length, 1, 'a repeat logs nothing');
      // the claims stay while it is set down: a body act is refused, talking and looking work
      busy = await act(w, Ada, {capability: w.edge.capabilities(Ada).find((x) => x.verb === 'walk' && x.available).id});
      said = await post(w, Bo, '/v1/edge/say', {text: 'Setting it down.'}); looked = await get(w, Ada, '/v1/edge/here');
    }
  });
  assert.equal(r.stopPhase, 'move');
  assert.equal(code(busy), 'shared.busy'); assert.match(busy.reason, /setting beam down safely with Bo \(Bo asked to stop/);
  assert.ok(said.said?.heardBy >= 1, JSON.stringify(said)); assert.ok(looked && !looked.error, 'Ada can look around');
  stopped(w, r, 'stopped');
  const b = w.f.host.engine.world.entities[r.beam].pose.p;
  assert.ok(!inside(shedOf(w), b[0], b[2]), `the beam lies short of the shed (${b[0].toFixed(1)}, ${b[2].toFixed(1)})`);
  assert.ok(flat(sub(b, r.seen.start)) > 1.5, 'it was carried part of the way');
  assert.equal(stops(w).length, 1);
  // after release: each acts on its own; nothing was resumed for them
  assert.deepEqual(w.edge.openReceipts(Ada.soulId), []); assert.deepEqual(w.edge.openReceipts(Bo.soulId), []);
  const boWalk = ok(await act(w, Bo, {capability: w.edge.capabilities(Bo).find((x) => x.verb === 'walk' && x.available).id}));
  const adaSit = ok(await act(w, Ada, {capability: w.edge.capabilities(Ada).find((x) => (x.verb === 'sit-ground' || x.verb === 'sit') && x.available).id}));
  await until(w, () => read(w, Bo, boWalk).phase !== 'started' && read(w, Bo, boWalk).phase !== 'waiting', 1200);
  assert.equal(read(w, Bo, boWalk).phase, 'completed'); assert.notEqual(read(w, Ada, adaSit).phase, 'failed');
  assert.equal(read(w, Cy, cyWalk).phase, 'completed', 'the unrelated walk completed');
  // a stop after the end, and from a non-member, is refused and changes nothing
  const late = await act(w, Bo, {capability: `stop-carry:${r.op.id}`}); assert.equal(code(late), 'shared.not-running', JSON.stringify(late));
  const cy = await act(w, Cy, {capability: `stop-carry:${r.op.id}`}); assert.equal(code(cy), 'shared.not-member', JSON.stringify(cy));
  const none = await act(w, Cy, {capability: 'stop-carry:op_inv_nope_r1'}); assert.equal(code(none), 'shared.unknown-op');
  assert.equal(stops(w).length, 1);
  t.diagnostic(`stop: ${read(w, Bo, r.stop).reason} | end: ${read(w, Ada, r.p).reason}`);
});

test('PC08 A1: a stop before contact lets go where it lies; during the lift it is lowered back where it lay', {timeout: 300000}, async (t) => {
  for (const at of ['gather', 'reach', 'lift']) {
    const w = await world(t), r = await carry(w, t, (c) => c.phase === at);
    assert.equal(r.stopPhase, at);
    stopped(w, r, 'stopped');
    const b = w.f.host.engine.world.entities[r.beam].pose.p;
    assert.ok(flat(sub(b, r.seen.start)) < 0.05, `${at}: the beam lies where it lay (${flat(sub(b, r.seen.start)).toFixed(3)} m)`);
    assert.match(read(w, w.souls.Ada, r.p).reason, at === 'lift' ? /beam was lowered back where it lay/ : /beam was never lifted/);
    if (at !== 'lift') assert.ok(!r.seen.phases.includes('lift'), `${at}: nothing was lifted`);
  }
});

test('PC08 A1: a stop while it is set down at the shed finishes that set-down: stopped-at-destination', {timeout: 300000}, async (t) => {
  const w = await world(t), r = await carry(w, t, (c) => c.phase === 'set-down');
  assert.equal(r.stopPhase, 'set-down');
  stopped(w, r, 'stopped-at-destination');
  const b = w.f.host.engine.world.entities[r.beam].pose.p; assert.ok(inside(shedOf(w), b[0], b[2]));
  assert.doesNotMatch(read(w, w.souls.Ada, r.p).reason, /arrived/);
});

test('PC08 A2: where the ground under the beam is not clear, the crew carries on to the first clear spot', {timeout: 300000}, async (t) => {
  // a second beam lies along the way, low enough to step on and carry over, but nothing can be laid on top of it
  const w = await world(t, (ax, az) => [{op: 'place', def: 'core/rack-beam@2', name: 'low', p: [ax + 5, az + 0.85]}]);
  let unsafe = null;
  const r = await carry(w, t, (c) => c.phase === 'move' && Math.abs(c.E[c.beam].pose.p[0] - c.E[w.idOf('low')].pose.p[0]) < 0.3, async (c) => {
    if (c.stop && !unsafe && c.op.stop?.unsafe) { unsafe = {reason: read(w, w.souls.Ada, c.p).reason, phase: c.op.phase}; }
  });
  assert.equal(r.stopPhase, 'move');
  assert.ok(unsafe, 'the refused set-down is said');
  assert.equal(unsafe.phase, 'stopping'); assert.match(unsafe.reason, /beam cannot be set down here \(it would overlap low\).*carry on along the agreed way to shed and set it down at the first clear spot/i);
  assert.ok(streamOf(w, w.souls.Bo).some((e) => e.kind === 'shared.stopping' && e.deferred), 'Bo is told the crew carries on');
  const result = r.op.result; assert.ok(result === 'stopped' || result === 'stopped-at-destination', result);
  stopped(w, r, result);
  assert.match(read(w, w.souls.Ada, r.p).reason, /the first clear spot on the way/);
  t.diagnostic(`unsafe: ${unsafe.reason} | end: ${read(w, w.souls.Ada, r.p).reason}`);
});

test('PC08 A2: held up while carrying on to a clear spot is a blocked hold-up with the claims kept, then back to stopping', {timeout: 300000}, async (t) => {
  // the low beam under the stop point sends the crew on; Cy stands just ahead in the way until the hold-up is reported
  const w = await world(t, (ax, az) => [{op: 'place', def: 'core/rack-beam@2', name: 'low', p: [ax + 5, az + 0.85]}]), {Cy} = w.souls;
  let placed = false, blockedAt = null, held = null, back = false, gone = false;
  const r = await carry(w, t, (c) => c.phase === 'move' && Math.abs(c.E[c.beam].pose.p[0] - c.E[w.idOf('low')].pose.p[0]) < 0.3, async (c) => {
    if (!c.stop || c.op.phase === 'ended') return;
    if (!placed) { placed = true; const b = c.E[c.beam].pose.p; await w.at(Cy, b[0] + 2.1, b[2]); }
    if (c.op.phase === 'blocked' && !held) { held = {op: c.op, reason: read(w, w.souls.Ada, c.p).reason, code: read(w, w.souls.Ada, c.p).code}; blockedAt = c.tick; }
    if (held && !gone && c.tick - blockedAt > 30) { gone = true; await w.at(Cy, w.ax - 4, w.az - 6); }
    if (held && c.op.phase === 'stopping') back = true;
  });
  assert.ok(held, 'the hold-up while stopping is reported');
  assert.equal(held.op.claims.length, 3, 'the claims stay while held up'); assert.ok(held.op.stop, 'still a stop');
  assert.equal(held.code, 'carry.path-occupied'); assert.match(held.reason, /wait for Cy to move out of the way.*Bo asked to stop; the load is set down once the crew can move to a clear spot\./);
  assert.ok(back, 'back to stopping, never started');
  const order = [...r.seen.opPhases]; assert.deepEqual(order.slice(0, 2), ['started', 'stopping']);
  assert.ok(r.op.blocks?.some((x) => x.code === 'carry.path-occupied'), 'the interval is kept');
  stopped(w, r, r.op.result);
  t.diagnostic(`held: ${held.reason}`);
});

test('PC08 A1: the logged stop replays by its programme; an old edge-stop without one replays by the body', {timeout: 300000}, async (t) => {
  const w = await world(t), r = await carry(w, t, (c) => c.phase === 'move' && c.n > 40);
  stopped(w, r, 'stopped');
  // the fold: a programId event stops exactly that programme; without it, the body's own programme (unchanged)
  const {foldEvent} = await import('../../apps/server/src/fold.ts');
  const calls = [], engine = {stop: (id, o) => calls.push(o?.untilSafe ? `${id} safe` : id), programOf: (e) => `p_of_${e}`};
  const k = structuredClone(w.f.host.kernel);
  foldEvent(engine, k, {kind: 'edge-stop', tick: 0, payload: {entityId: 'e_host', programId: 'p_op'}}, {});
  foldEvent(engine, k, {kind: 'edge-stop', tick: 0, payload: {entityId: 'e_body'}}, {});
  assert.deepEqual(calls, ['p_op safe', 'p_of_e_body']);
});
