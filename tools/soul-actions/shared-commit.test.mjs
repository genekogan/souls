// PC05 (#684): a ready shared proposal commits atomically (one host decision with one native crew carry), its members'
// body acts are refused shared.busy while it runs, and every member's receipt ends together when it ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {SHARED_LAPSE} from '../../apps/server/src/edge/ledger/together.ts';

async function world(t, sharedCarry) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry}), app = new Hono(); let current;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => current});
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  const souls = {};
  for (const name of ['Ada', 'Bo', 'Cy', 'Fy']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Shared roles test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await tick();
  const E = f.host.engine.world.entities, pos = (s) => E[s.entityId].pose.p;
  const [ax, , az] = pos(souls.Ada);
  // the scene: Ada and Bo beside a loose shared-carry beam; the shed 8 m away; Fy a floater beside them; Cy uninvited nearby (the green field's ground cannot stand a body 100 m off, so
  // distance is tested with 100 loads 100 m away)
  // test setup only: stand the bodies where the scene needs them (a logged relocate, as the ledger's own step-clear)
  const at = async (s, x, z) => {
    await accept(f.host, f.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
    const q = f.host.engine.world.entities[s.entityId].pose.p; assert.ok(Math.hypot(q[0] - x, q[2] - z) < 3, `${s.name} stands at ${x},${z} (is ${q[0]},${q[2]}; program ${f.host.engine.programOf(s.entityId)})`);
  };
  await at(souls.Bo, ax, az + 3); await at(souls.Fy, ax - 1.5, az - 1.5);
  ok(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam2', p: [ax + 2, az - 2.5]},
    {op: 'place', def: 'core/rack-beam@1', name: 'old-beam', p: [ax - 1.5, az + 3]},
  ]}));
  await tick(60);
  const idOf = (n) => god.model.get(n).id;
  return {f, edge, god, app, comms, tick, souls, pos, idOf, at, setCurrent: (s) => { current = s; }};
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = async (w, s, input) => accept(w.f.host, w.edge.act(s, input));
const code = (r) => r.error?.code ?? r.code;
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);

test('PC05: commit atomically, refuse body acts shared.busy, release every member together', {timeout: 300000}, async (t) => {
  const w = await world(t, true), {Ada, Bo} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  assert.equal(inviteOf(w, id).shared.op, null); assert.equal(read(w, Bo, a).startedTick, null, 'acceptance is not start');
  for (let n = 0; n < 60 && inviteOf(w, id).state === 'pending'; n++) await w.tick(1);
  const inv = inviteOf(w, id), op = inv.shared.op;
  assert.equal(inv.state, 'committed', JSON.stringify([read(w, Ada, p), read(w, Bo, a)]));
  assert.equal(op.id, `op_${id}_r1`); assert.equal(op.programId, eng.programOf(Ada.entityId)); assert.equal(op.phase, 'started');
  for (const [s, r] of [[Ada, p], [Bo, a]]) {
    const x = read(w, s, r); assert.equal(x.phase, 'started', s.name); assert.equal(x.startedTick, op.committedTick, `${s.name} starts in the commit's tick`);
    assert.equal(x.shared.op, op.id); assert.equal(x.shared.phase, 'started');
  }
  const decisions = () => w.f.db.events(w.f.host.worldId).filter((e) => e.kind === 'decision' && String(e.payload?.trigger ?? '').startsWith('shared-commit:')).length;
  assert.equal(decisions(), 1);
  await w.edge.commitShared(id); await w.tick(2);
  assert.equal(decisions(), 1, 'a repeated commit attempt submits nothing'); assert.equal(inviteOf(w, id).shared.op.programId, op.programId);
  // busy: body acts are refused and replace nothing; reads still work
  const busy = await act(w, Bo, {capability: 'wave:here'});
  assert.equal(code(busy), 'shared.busy', JSON.stringify(busy)); assert.match(busy.reason, /hands and walking/);
  assert.equal(code(await act(w, Ada, {capability: 'wave:here'})), 'shared.busy');
  assert.deepEqual(w.edge.openReceipts(Bo.soulId).map((r) => r.id), [a.receipt.id], 'no receipt was created or replaced');
  assert.ok(w.edge.capabilities(Bo).length > 0, 'Bo can still read his options');
  for (let n = 0; n < 3000 && ['waiting', 'started'].includes(read(w, Ada, p).phase); n++) await w.tick(1);
  for (const [s, r] of [[Ada, p], [Bo, a]]) {const x = read(w, s, r); assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.shared.phase, 'ended'); assert.equal(x.shared.result, 'arrived');}
  assert.equal(inviteOf(w, id).state, 'closed'); assert.equal(E[beam].phase === 'carried', false);
  ok(await act(w, Bo, {capability: 'wave:here'}));
  assert.deepEqual(eng.runtime.violations, []);
});

const decisionsOf = (w) => w.f.db.events(w.f.host.worldId).filter((e) => e.kind === 'decision' && String(e.payload?.trigger ?? '').startsWith('shared-commit:'));
const until = async (w, done, max) => { for (let n = 0; n < max && !done(); n++) await w.tick(1); };

test('PC05: readiness is derived (away waits, back commits), expiry mid-carry ends nothing, speech and a third walk go on', {timeout: 300000}, async (t) => {
  const w = await world(t, true), {Ada, Bo, Cy} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}})), home = [...w.pos(Bo)], b = E[beam].pose.p;
  // Bo is moved 13 m from the load after accepting (a test relocate, not an act of his): every receipt waits and says why
  await w.at(Bo, b[0] - 13, b[2]); await w.tick(40);
  assert.equal(inviteOf(w, id).state, 'pending'); assert.equal(inviteOf(w, id).shared.op, null); assert.equal(decisionsOf(w).length, 0);
  for (const [s, r] of [[Ada, p], [Bo, a]]) {const x = read(w, s, r); assert.equal(x.phase, 'waiting'); assert.equal(x.code, 'shared.not-ready', s.name); assert.match(x.reason, /Bo is 1\d m from/, s.name);}
  for (const s of [Ada, Bo]) assert.equal(eng.programOf(s.entityId), null, `${s.name} runs nothing while not ready`);
  // hold until shortly before the proposal lapses, then Bo is moved back: the next check commits, and the carry outlives it
  const lapse = inviteOf(w, id).expiresTick;
  while (eng.world.tick < lapse - 100) await w.tick(20);
  assert.equal(inviteOf(w, id).state, 'pending');
  await w.at(Bo, home[0], home[2]);
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  const op = inviteOf(w, id).shared.op;
  assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, Ada, p))); assert.ok(op.committedTick < lapse);
  for (const [s, r] of [[Ada, p], [Bo, a]]) {const x = read(w, s, r); assert.equal(x.phase, 'started'); assert.equal(x.code, null, `${s.name}: the not-ready note is cleared`); assert.equal(x.startedTick, op.committedTick);}
  // streams during the operation: Bo talks and is heard, reads his receipt, and hears the start on his own stream
  w.setCurrent(Bo);
  const said = await (await accept(w.f.host, w.app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: 'Lift on three.'})}))).json();
  assert.ok(said.said?.heardBy >= 1, JSON.stringify(said));
  assert.ok(w.comms.streams.read(Bo.soulId, 0).events.some((e) => e.kind === 'shared.started'), 'Bo is told on his own stream');
  assert.ok(w.comms.streams.read(Ada.soulId, 0).events.some((e) => e.kind === 'shared.started'), 'Ada is told on hers');
  // a body act is refused shared.busy naming the operation; a third Soul's walk is unaffected
  const walk = w.edge.capabilities(Bo).find((c) => c.verb === 'walk' && c.available);
  const busy = await act(w, Bo, {capability: walk.id});
  assert.equal(code(busy), 'shared.busy'); assert.match(busy.reason, new RegExp(op.id));
  const cyFrom = [...w.pos(Cy)], cyWalk = ok(await act(w, Cy, {capability: w.edge.capabilities(Cy).find((c) => c.verb === 'walk' && c.available).id}));
  // the proposal's expiry passes mid-carry: nothing detaches, no receipt ends
  await until(w, () => eng.world.tick > lapse + 20, 200);
  assert.equal(inviteOf(w, id).state, 'committed', 'committed is outside the expiry sweep');
  for (const [s, r] of [[Ada, p], [Bo, a]]) assert.equal(read(w, s, r).phase, 'started', `${s.name} still carries past the lapse tick`);
  assert.equal(eng.programOf(Ada.entityId), op.programId);
  await until(w, () => read(w, Ada, p).phase !== 'started', 3000);
  for (const [s, r] of [[Ada, p], [Bo, a]]) assert.equal(read(w, s, r).phase, 'completed', s.name);
  assert.ok(Math.hypot(w.pos(Cy)[0] - cyFrom[0], w.pos(Cy)[2] - cyFrom[2]) > 1 || read(w, Cy, cyWalk).phase === 'completed', 'Cy walked throughout');
  assert.deepEqual(eng.runtime.violations, []);
});

test('PC05: races. accept vs withdraw or leave never commits; two proposals for one load commit exactly one; a permanent refusal fails all', {timeout: 300000}, async (t) => {
  const w = await world(t, true), {Ada, Bo, Cy, Fy} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const propose = async (s, to, mate, load = beam) => ok(await act(w, s, {capability: `carry-with:${load}`, params: {to, with: mate}}));
  // accept and withdraw before the check: closed, no decision, nobody runs
  let p = await propose(Ada, 'shed', 'Bo'), id = p.receipt.shared.invite;
  ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}})); ok(await act(w, Ada, {capability: `withdraw:${id}`}));
  await w.tick(60); assert.equal(inviteOf(w, id).state, 'closed'); assert.equal(inviteOf(w, id).shared.op, null);
  // accept and leave before the check: the same
  p = await propose(Ada, 'shed', 'Bo'); id = p.receipt.shared.invite;
  ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}})); ok(await act(w, Bo, {capability: `decline:${id}`}));
  await w.tick(60); assert.equal(inviteOf(w, id).state, 'closed'); assert.equal(inviteOf(w, id).shared.op, null);
  assert.equal(decisionsOf(w).length, 0); for (const s of [Ada, Bo]) assert.equal(eng.programOf(s.entityId), null, `${s.name} runs nothing`);
  // two proposals for the same load, both ready in the same check: exactly one commits, the other never half-starts
  const b = E[beam].pose.p; await w.at(Cy, b[0] + 2, b[2]); await w.at(Fy, b[0] + 2, b[2] + 2);
  const p1 = await propose(Ada, 'shed', 'Bo'), p2 = await propose(Cy, 'yard', 'Fy'), i1 = p1.receipt.shared.invite, i2 = p2.receipt.shared.invite;
  const a1 = ok(await act(w, Bo, {capability: `accept:${i1}`, params: {revision: 1}})), a2 = ok(await act(w, Fy, {capability: `accept:${i2}`, params: {revision: 1}}));
  await until(w, () => inviteOf(w, i1).state !== 'pending' || inviteOf(w, i2).state !== 'pending', 60); await w.tick(40);
  const states = [inviteOf(w, i1).state, inviteOf(w, i2).state];
  assert.equal(states.filter((x) => x === 'committed').length, 1, JSON.stringify(states)); assert.equal(decisionsOf(w).length, 1);
  const [won, lost] = states[0] === 'committed' ? [[i1, [[Ada, p1], [Bo, a1]]], [i2, [[Cy, p2], [Fy, a2]]]] : [[i2, [[Cy, p2], [Fy, a2]]], [i1, [[Ada, p1], [Bo, a1]]]];
  assert.equal(inviteOf(w, lost[0]).shared.op, null);
  for (const [s, r] of won[1]) assert.equal(read(w, s, r).phase, 'started', `${s.name} carries`);
  for (const [s, r] of lost[1]) {const x = read(w, s, r); assert.equal(x.phase, 'waiting', s.name); assert.equal(x.code, 'shared.not-ready'); assert.match(x.reason, /carried by someone else|cannot start yet/, s.name); assert.equal(eng.programOf(s.entityId), null);}
  assert.deepEqual(inviteOf(w, won[0]).shared.op.claims.at(-1), {entity: beam, by: inviteOf(w, won[0]).shared.op.id});
  await until(w, () => read(w, won[1][0][0], won[1][0][1]).phase !== 'started', 3000);
  for (const [s, r] of won[1]) assert.equal(read(w, s, r).phase, 'completed', s.name);
  // a permanent native refusal at the commit: every receipt fails with its diagnostic and nothing is lifted. The act
  // surface refuses an unreachable destination at the proposal (place.no-standing-room), so the native plan's answer is
  // stubbed for this one commit (a no-route found only at commit time, e.g. a wall placed after the proposal)
  const near = w.idOf('beam2'), before = [...E[near].pose.p], n0 = decisionsOf(w).length;
  const pf = await propose(Ada, 'yard', 'Bo', near), fid = pf.receipt.shared.invite, af = ok(await act(w, Bo, {capability: `accept:${fid}`, params: {revision: 1}}));
  const real = eng.canPerform.bind(eng); eng.canPerform = (x) => x.steps?.[0]?.verb === 'mars:carry' ? {code: 'carry.no-route', message: 'No route for the load.'} : real(x);
  try { await until(w, () => inviteOf(w, fid).state !== 'pending', 60); } finally { eng.canPerform = real; }
  assert.equal(inviteOf(w, fid).state, 'closed'); assert.equal(inviteOf(w, fid).shared.op, null); assert.equal(decisionsOf(w).length, n0, 'no decision was recorded');
  for (const [s, r] of [[Ada, pf], [Bo, af]]) {const x = read(w, s, r); assert.equal(x.phase, 'failed', s.name); assert.equal(x.code, 'carry.no-route', s.name); assert.match(x.reason, /nothing was lifted/);}
  assert.deepEqual(E[near].pose.p, before, 'the load did not move'); for (const s of [Ada, Bo]) assert.equal(eng.programOf(s.entityId), null);
  assert.deepEqual(eng.runtime.violations, []);
});
