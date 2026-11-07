// PC06 (#685): the first consensual two-Soul beam carry on the PC02 §7 fixture (docs/design/shared-execution.md). One
// authoritative load-and-crew trajectory, a route preflight before anyone is asked, the solo refusal naming the shared
// carry, and ordinary life (speech, a third Soul's walk, walks afterwards, a solo carry) around it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

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
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Shared carry test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await tick();
  const E = f.host.engine.world.entities, pos = (s) => E[s.entityId].pose.p;
  const [ax, , az] = pos(souls.Ada);
  // test setup only: stand the bodies where the scene needs them (a logged relocate, as the ledger's own step-clear)
  const at = async (s, x, z) => {
    await accept(f.host, f.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
    const q = f.host.engine.world.entities[s.entityId].pose.p; assert.ok(Math.hypot(q[0] - x, q[2] - z) < 3, `${s.name} stands at ${x},${z}`);
  };
  await at(souls.Bo, ax, az + 3); await at(souls.Fy, ax - 1.5, az - 1.5); await at(souls.Cy, ax - 3, az - 5);
  // the §7 scene: Ada and Bo beside a loose shared-carry beam on open level-0 ground, the shed about 8 m away, a yard
  // the other way; a walled pen a person can step into but the beam cannot be laid down in; a 38 kg upright frame
  ok(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam2', p: [ax + 2, az - 2.5]},
    {op: 'place', def: 'core/rack-upright@1', name: 'frame', p: [ax - 4, az + 5]},
    {op: 'place', def: 'core/garden-wall@1', name: 'pen-wall', shape: {path: [[ax + 1, az + 6], [ax + 1, az + 8.2], [ax + 3.2, az + 8.2], [ax + 3.2, az + 6], [ax + 2.6, az + 6]]}},
    {op: 'place', def: 'core/zone@1', name: 'pen', shape: {area: [[ax + 1.4, az + 6.4], [ax + 2.8, az + 6.4], [ax + 2.8, az + 7.8], [ax + 1.4, az + 7.8]]}},
    // a court roomy enough to lay the beam in, whose only way in is a gate a person walks through but the crew's formation does not
    {op: 'place', def: 'core/garden-wall@1', name: 'court-wall', shape: {path: [[ax - 5, az - 6], [ax - 5, az - 11], [ax - 11, az - 11], [ax - 11, az - 6], [ax - 6.1, az - 6]]}},
    {op: 'place', def: 'core/zone@1', name: 'court', shape: {area: [[ax - 10.4, az - 10.4], [ax - 5.6, az - 10.4], [ax - 5.6, az - 6.6], [ax - 10.4, az - 6.6]]}},
    // a walled garden with no way in at all, for nobody
    {op: 'place', def: 'core/garden-wall@1', name: 'vault-wall', shape: {path: [[ax + 5, az - 6], [ax + 5, az - 11], [ax + 11, az - 11], [ax + 11, az - 6], [ax + 5, az - 6]]}},
    {op: 'place', def: 'core/zone@1', name: 'vault', shape: {area: [[ax + 5.6, az - 10.4], [ax + 10.4, az - 10.4], [ax + 10.4, az - 6.6], [ax + 5.6, az - 6.6]]}},
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
const until = async (w, done, max) => { for (let n = 0; n < max && !done(); n++) await w.tick(1); };
const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const flat = (p) => Math.hypot(p[0], p[2]);
const GRIPS = {g0: -1.09728, g1: 1.09728};   // core-rack-beam@2's grips for a crew of two (packages/world-compiler/src/core-kit/authoring/work.mjs)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

test('PC06: one consensual beam carry on the §7 fixture, one trajectory for the load and its crew, ordinary life around it', {timeout: 600000}, async (t) => {
  const w = await world(t, true), {Ada, Bo, Cy} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const shed = w.edge.places.byId.get(w.god.model.get('shed').id)?.polygon ?? w.god.model.get('shed').shape.area;
  const lying = E[beam].pose.p[1];
  // Cy, uninvited, starts a walk to the yard before anything is agreed
  const cyWalk = ok(await act(w, Cy, {capability: w.edge.capabilities(Cy).find((c) => c.verb === 'walk' && /yard/i.test(c.label) && c.available)?.id ?? w.edge.capabilities(Cy).find((c) => c.verb === 'walk' && c.available).id}));
  // normal tools: Ada proposes, Bo accepts revision 1; the world commits on its own check
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  const op = inviteOf(w, id).shared.op; assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, Ada, p)));
  // one authoritative trajectory: sample the world every tick until the operation ends
  const crew = [[Ada, p], [Bo, a]], last = {}, slots = new Set();
  let both = 0, lifted = 0, maxReach = 0, maxStep = 0, maxLoadStep = 0, cyDoneDuring = false, spoke = false;
  for (let n = 0; n < 4000 && read(w, Ada, p).phase === 'started'; n++) {
    await w.tick(1);
    const b = E[beam].pose.p, g = crew.map(([s]) => E[s.entityId].human?.grip);
    for (const [s] of crew) { const q = E[s.entityId].pose.p; if (last[s.name]) maxStep = Math.max(maxStep, flat(sub(q, last[s.name]))); last[s.name] = [...q]; }
    if (last.beam) maxLoadStep = Math.max(maxLoadStep, flat(sub(b, last.beam))); last.beam = [...b];
    if (g.every((x) => x?.entity === beam)) {
      both++; for (const x of g) slots.add(x.slot);
      const qa = E[Ada.entityId].pose.p, qb = E[Bo.entityId].pose.p, mid = [(qa[0] + qb[0]) / 2, 0, (qa[2] + qb[2]) / 2];
      // each carrier stays within reach of their own grip (the def's two-carrier grips, ±1.097 m along the beam)
      const yaw = E[beam].pose.yaw ?? 0;
      for (const [i, [s]] of crew.entries()) {
        const lx = GRIPS[g[i].slot], at = [b[0] + Math.cos(yaw) * lx, 0, b[2] - Math.sin(yaw) * lx], d = flat(sub(E[s.entityId].pose.p, at));
        maxReach = Math.max(maxReach, d); assert.ok(d < 1, `${s.name} is ${d.toFixed(2)} m from grip ${g[i].slot} (tick ${eng.world.tick})`);
      }
      assert.ok(flat(sub(b, mid)) < 0.75, `the beam stays between its carriers (tick ${eng.world.tick}: ${flat(sub(b, mid)).toFixed(2)} m)`);
      if (b[1] > lying + 0.3) lifted++;
    }
    if (!cyDoneDuring && read(w, Cy, cyWalk).phase === 'completed') cyDoneDuring = read(w, Ada, p).phase === 'started';
    if (!spoke && lifted > 20) {
      w.setCurrent(Bo); spoke = true;
      const said = await (await accept(w.f.host, w.app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: 'Nearly there.'})}))).json();
      assert.ok(said.said?.heardBy >= 1, `Bo is heard mid-carry: ${JSON.stringify(said)}`);
    }
  }
  t.diagnostic(`carry: ${both} ticks held by both on grips ${[...slots].join(', ')}, ${lifted} lifted, carriers at most ${maxReach.toFixed(2)} m from their grips; largest step carrier ${maxStep.toFixed(3)} m, load ${maxLoadStep.toFixed(3)} m; committed tick ${op.committedTick}, ended tick ${eng.world.tick}`);
  assert.ok(both > 40, `both carriers held the beam together (${both} ticks)`); assert.equal(slots.size, 2, 'on two distinct grips'); assert.deepEqual(crew.map(([s]) => E[s.entityId].human?.grip?.slot ?? null), [null, null]);
  assert.ok(lifted > 20, `the beam was off the ground while carried (${lifted} ticks)`);
  assert.ok(maxStep < 0.5 && maxLoadStep < 0.5, `nothing jumped: largest carrier step ${maxStep.toFixed(2)} m, load step ${maxLoadStep.toFixed(2)} m per tick`);
  assert.ok(spoke, 'Bo spoke mid-carry');
  for (const [s, r] of crew) { const x = read(w, s, r); assert.equal(x.phase, 'completed', s.name); assert.equal(x.shared.result, 'arrived'); assert.equal(x.shared.op, op.id); }
  const b = E[beam].pose.p; assert.equal(E[beam].support?.kind, 'ground'); assert.ok(Math.abs(b[1] - lying) < 0.05, 'the beam lies on the ground again');
  assert.ok(inside(shed, b[0], b[2]), `the beam lies in the shed (${b[0].toFixed(1)}, ${b[2].toFixed(1)})`);
  for (const [s] of crew) assert.equal(E[s.entityId].human.grip ?? null, null, `${s.name}'s hands are free`);
  assert.ok(cyDoneDuring, `Cy's walk, started before the commit, completed while the carry ran (${read(w, Cy, cyWalk).phase})`);
  // ordinary life afterwards: each member walks again, and a solo carry of the other beam works with the flag on
  for (const s of [Ada, Bo]) {
    const walk = ok(await act(w, s, {capability: w.edge.capabilities(s).find((c) => c.verb === 'walk' && c.available).id}));
    await until(w, () => !['waiting', 'started'].includes(read(w, s, walk).phase), 1500);
    assert.equal(read(w, s, walk).phase, 'completed', `${s.name} walks again: ${JSON.stringify(read(w, s, walk))}`);
  }
  const beam2 = w.idOf('beam2'), solo = ok(await act(w, Cy, {capability: `carry:${beam2}`, params: {to: 'yard'}}));
  await until(w, () => !['waiting', 'started'].includes(read(w, Cy, solo).phase), 3000);
  assert.equal(read(w, Cy, solo).phase, 'completed', `the solo carry of a beam still works: ${JSON.stringify(read(w, Cy, solo))}`);
  assert.deepEqual(eng.runtime.violations, []);
});

test('PC06: preflight. An impossible destination is refused before anyone is asked; the solo refusal names carry-with', {timeout: 300000}, async (t) => {
  const w = await world(t, true), {Ada, Bo, Fy} = w.souls, beam = w.idOf('beam'), frame = w.idOf('frame'), eng = w.f.host.engine;
  const streamKinds = (s) => w.comms.streams.read(s.soulId, 0).events.map((e) => e.kind);
  // the pen: a person can step in, the beam cannot be laid down there. Refused with the planner's code, nobody asked
  const r = await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'pen', with: 'Bo'}});
  assert.equal(code(r), 'carry.target-blocked', JSON.stringify(r));
  assert.match(r.reason, /beam cannot be laid down in pen \(it would overlap pen-wall.*\)\. Nobody was asked/i, r.reason);
  assert.equal(w.edge.together.invitesFor(Bo.soulId).length, 0, 'no invitation exists'); assert.ok(!streamKinds(Bo).includes('invite'), 'Bo was not asked');
  assert.deepEqual(w.edge.openReceipts(Ada.soulId), [], 'no receipt was opened');
  // a court the beam fits in but the crew's formation cannot get through the gate of: carry.clearance, named
  const court = await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'court', with: 'Bo'}});
  // PC07 (#686): the planner stops at its pose budget on this open level, so it is said as a bounded search, with its closest try
  assert.equal(code(court), 'carry.search-exhausted', JSON.stringify(court)); assert.match(court.reason, /cannot get it to court \(the carrying formation would hit court-wall.*\); each could walk there alone\. That does not prove/i, court.reason);
  assert.doesNotMatch(court.reason, /\b[he]_[0-9a-f]{6,}/, 'no entity ids in the reason');
  // a garden nobody can enter: no route at all, never a proposal
  const vault = await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'vault', with: 'Bo'}});
  assert.equal(code(vault), 'carry.search-exhausted', JSON.stringify(vault)); assert.match(vault.reason, /cannot get it to vault \(the carrying formation would hit vault-wall/i);
  assert.equal(w.edge.together.invitesFor(Bo.soulId).length, 0);
  // Bo busy walking does not hide the verdict: the planner is asked alone, without anyone's programme
  const boWalk = ok(await act(w, Bo, {capability: 'walk:yard'})); await w.tick(2); assert.ok(eng.programOf(Bo.entityId), 'Bo is walking');
  const busy = await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'pen', with: 'Bo'}});
  assert.equal(code(busy), 'carry.target-blocked', JSON.stringify(busy)); assert.equal(w.edge.together.invitesFor(Bo.soulId).length, 0, 'busy Bo was not asked either');
  await until(w, () => !['waiting', 'started'].includes(read(w, Bo, boWalk).phase), 1500); await w.at(Bo, w.pos(Ada)[0], w.pos(Ada)[2] + 3);
  // transient blockers are not decided here: Cy standing at the shed's centre, or a loose beam lying there, still lets Ada ask
  const shed = w.god.model.get('shed').shape.area, mid = [shed.reduce((a, q) => a + q[0], 0) / shed.length, shed.reduce((a, q) => a + q[1], 0) / shed.length];
  await w.at(w.souls.Cy, mid[0], mid[1]);
  let q = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})); ok(await act(w, Ada, {capability: `withdraw:${q.receipt.shared.invite}`}));
  await w.at(w.souls.Cy, mid[0] - 6, mid[1] - 6);
  ok(w.god.act({ops: [{op: 'place', def: 'core/rack-beam@2', name: 'beam3', p: mid}]})); await w.tick(5);
  q = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})); ok(await act(w, Ada, {capability: `withdraw:${q.receipt.shared.invite}`}));
  // a possible proposal, then an amend to the pen: refused, and the open proposal is unchanged
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const amend = await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'pen', with: 'Bo', invite: id}});
  assert.equal(code(amend), 'carry.target-blocked', JSON.stringify(amend));
  assert.equal(inviteOf(w, id).state, 'pending'); assert.equal(inviteOf(w, id).shared.revision, 1); assert.equal(inviteOf(w, id).shared.destination.name, 'Shed');
  ok(await act(w, Ada, {capability: `withdraw:${id}`}));
  // bodies: a floater cannot propose (PC04 covers acceptance)
  assert.equal(eng.assignBodyV1(Fy.entityId, {family: 'floater', type: 'floater', radius: 0.35, hoverHeight: 1.45}), true);
  const fy = await act(w, Fy, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Ada'}}); assert.equal(code(fy), 'body.unsupported', JSON.stringify(fy));
  // the solo refusal of a load that needs two names the shared carry; acting it is refused before any motion
  const solo = w.edge.capabilities(Ada).find((c) => c.id === `carry:${frame}`);
  assert.equal(solo?.available, false); assert.equal(solo.blocked.code, 'carry.crew-too-small'); assert.match(solo.blocked.reason, new RegExp(`carry-with:${frame}`));
  assert.ok(w.edge.capabilities(Ada).some((c) => c.id === `carry-with:${frame}`), 'and that carry-with is on offer');
  assert.equal(code(await act(w, Ada, {capability: `carry:${frame}`, params: {to: 'yard'}})), 'carry.crew-too-small');
  assert.equal(eng.programOf(Ada.entityId), null);
  assert.deepEqual(eng.runtime.violations, []);
});

test('PC06: with the flag off (the default) the solo refusal is unchanged and nothing shared is offered', {timeout: 300000}, async (t) => {
  const w = await world(t, undefined), {Ada} = w.souls, frame = w.idOf('frame');
  const solo = w.edge.capabilities(Ada).find((c) => c.id === `carry:${frame}`);
  assert.equal(solo.blocked.code, 'carry.crew-too-small'); assert.doesNotMatch(solo.blocked.reason, /carry-with/);
  assert.ok(!w.edge.capabilities(Ada).some((c) => c.verb === 'carry-with'));
});

