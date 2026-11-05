// PC07 (#686): whole-formation geometry before and during a shared carry (docs/design/shared-execution.md §2, §7). The
// preflight refuses a turn the formation cannot make, a load the crew cannot take hold of, and reports a bounded planner
// search as exhaustion; once lifted, a native hold-up (people in the way, a route construction cut) is reported to every
// member as `blocked` with its blocker, a replan to the same place is a detour, and a lasting blockage keeps the load
// held (nobody lets go on a timeout) until the way is clear again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

async function world(t, sharedCarry = true) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry}), app = new Hono(); let current;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => current});
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  const souls = {};
  for (const name of ['Ada', 'Bo', 'Cy']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Shared blockage test'}));
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
  await at(souls.Bo, ax, az + 3); await at(souls.Cy, ax - 3, az - 5);
  // the §7 scene: Ada and Bo beside a loose shared-carry beam on open level-0 ground, the shed about 8 m away; a spot
  // `mid` on the way; a walled room `nook` whose only way in is a corridor with a right-angle bend a person walks
  // through; a second beam lying with walls just beyond its ends, where nobody can stand at its grips
  const X0 = ax - 2, Z0 = az + 13, bx = ax + 3, bz = az + 7;
  ok(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 10, az - 2], [ax - 7, az - 2], [ax - 7, az + 2], [ax - 10, az + 2]]}},
    {op: 'place', def: 'core/zone@1', name: 'mid', shape: {area: [[ax + 4.6, az + 0.2], [ax + 5.4, az + 0.2], [ax + 5.4, az + 1], [ax + 4.6, az + 1]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    {op: 'place', def: 'core/garden-wall@1', name: 'nook-wall', shape: {path: [[X0 + 1.4, Z0], [X0 + 5, Z0], [X0 + 5, Z0 + 5], [X0, Z0 + 5], [X0, Z0 - 4], [X0 + 6, Z0 - 4]]}},
    {op: 'place', def: 'core/garden-wall@1', name: 'bend-wall', shape: {path: [[X0 + 1.4, Z0 - 0.45], [X0 + 1.4, Z0 - 2.6], [X0 + 6, Z0 - 2.6]]}},
    {op: 'place', def: 'core/zone@1', name: 'nook', shape: {area: [[X0 + 0.6, Z0 + 0.6], [X0 + 4.4, Z0 + 0.6], [X0 + 4.4, Z0 + 4.4], [X0 + 0.6, Z0 + 4.4]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'inner', p: [X0 + 2.5, Z0 + 2.5]},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam3', p: [bx, bz]},
    {op: 'place', def: 'core/garden-wall@1', name: 'end-wall-a', shape: {path: [[bx - 1.45, bz - 1.2], [bx - 1.45, bz + 1.2]]}},
    // a walled garden with no way in at all, for nobody
    {op: 'place', def: 'core/garden-wall@1', name: 'vault-wall', shape: {path: [[ax + 5, az - 6], [ax + 5, az - 11], [ax + 11, az - 11], [ax + 11, az - 6], [ax + 5, az - 6]]}},
    {op: 'place', def: 'core/zone@1', name: 'vault', shape: {area: [[ax + 5.6, az - 10.4], [ax + 10.4, az - 10.4], [ax + 10.4, az - 6.6], [ax + 5.6, az - 6.6]]}},
    {op: 'place', def: 'core/garden-wall@1', name: 'end-wall-b', shape: {path: [[bx + 1.45, bz - 1.2], [bx + 1.45, bz + 1.2]]}},
  ]}));
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

/** Commit Ada and Bo's carry of the beam to the shed with normal tools; then sample the world every tick until it ends.
 *  `during(ctx)` runs each tick (ctx: native phase, tick, the op). Asserts no teleport for the crew or the load. */
async function carry(w, t, during, max = 6000) {
  const {Ada, Bo} = w.souls, beam = w.idOf('beam'), eng = w.f.host.engine, E = eng.world.entities;
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  const op0 = inviteOf(w, id).shared.op; assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, Ada, p)));
  const crew = [[Ada, p], [Bo, a]], last = {}, seen = {phases: new Set(), opPhases: new Set(), codes: new Set(), maxStep: 0, maxLoadStep: 0, start: [...E[beam].pose.p]};
  for (let n = 0; n < max && ['waiting', 'started'].includes(read(w, Ada, p).phase); n++) {
    await w.tick(1);
    const rec = eng.programAction?.(op0.programId), phase = rec?.action.phase, op = inviteOf(w, id).shared.op;
    if (phase) seen.phases.add(phase); seen.opPhases.add(op.phase);
    const rc = read(w, Ada, p).code; if (rc) seen.codes.add(rc);
    for (const [s] of crew) { const q = E[s.entityId].pose.p; if (last[s.name]) seen.maxStep = Math.max(seen.maxStep, flat(sub(q, last[s.name]))); last[s.name] = [...q]; }
    const b = E[beam].pose.p; if (last.beam) seen.maxLoadStep = Math.max(seen.maxLoadStep, flat(sub(b, last.beam))); last.beam = [...b];
    await during?.({phase, tick: eng.world.tick, op, p, a, id, beam, E, n});
  }
  const end = inviteOf(w, id).shared.op;
  t.diagnostic(`native phases ${[...seen.phases].join(',')}; op phases ${[...seen.opPhases].join(',')}; codes ${[...seen.codes].join(',')}; largest step carrier ${seen.maxStep.toFixed(3)} m, load ${seen.maxLoadStep.toFixed(3)} m; op ${JSON.stringify({phase: end.phase, result: end.result, blocks: end.blocks, detours: end.detours})}`);
  assert.ok(seen.maxStep < 0.1, `no carrier teleports (${seen.maxStep.toFixed(3)} m)`); assert.ok(seen.maxLoadStep < 0.1, `the load never jumps (${seen.maxLoadStep.toFixed(3)} m)`);
  return {p, a, id, op: end, seen, crew};
}

test('PC07 A1: a turn the formation cannot make, a load nobody can take hold of, a bounded search; nobody is asked', {timeout: 300000}, async (t) => {
  const w = await world(t), {Ada, Bo} = w.souls, beam = w.idOf('beam'), beam3 = w.idOf('beam3'), inner = w.idOf('inner'), eng = w.f.host.engine;
  const asked = () => w.edge.together.invitesFor(Bo.soulId).length > 0 || streamOf(w, Bo).some((e) => e.kind === 'invite');
  const nobody = (r, what) => { assert.ok(!asked(), `${what}: Bo was not asked`); assert.deepEqual(w.edge.openReceipts(Ada.soulId), [], `${what}: no receipt`); };
  // a load the crew cannot take hold of: walls just beyond its ends leave no room to stand at its grips
  const stuck = await act(w, Ada, {capability: `carry-with:${beam3}`, params: {to: 'shed', with: 'Bo'}});
  assert.equal(code(stuck), 'carry.pickup-blocked', JSON.stringify(stuck)); assert.match(stuck.reason, /cannot take hold of beam3 where it lies: there is no room to stand at its grips \(end-wall-[ab] wall is in the way\)\. Nobody was asked; choose another load\.$/i, stuck.reason); nobody(stuck, 'pickup');
  // a bounded search: a walled garden nobody can enter; the planner stops at its pose budget, which is said as such
  const vault = await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'vault', with: 'Bo'}});
  assert.equal(code(vault), 'carry.search-exhausted', JSON.stringify(vault)); assert.match(vault.reason, /searched 150001 poses without finding a way.*vault-wall.*does not prove there is no way, but nobody was asked/i, vault.reason); nobody(vault, 'vault');
  // a proven no-route: a beam in a small closed box. The planner's search from inside it is small and ends without a way,
  // and nobody can walk into the sealed vault either: carry.no-route, not exhaustion
  const bx0 = w.ax - 7.5, bz0 = w.az + 3.5;
  ok(w.god.act({ops: [
    {op: 'place', def: 'core/rack-beam@2', name: 'boxed', p: [bx0 + 2.5, bz0 + 2.5]},
    {op: 'place', def: 'core/garden-wall@1', name: 'box-wall', shape: {path: [[bx0, bz0], [bx0 + 5, bz0], [bx0 + 5, bz0 + 5], [bx0, bz0 + 5], [bx0, bz0]]}},
  ]}));
  await w.tick(20);
  const boxed = await act(w, Ada, {capability: `carry-with:${w.idOf('boxed')}`, params: {to: 'vault', with: 'Bo'}});
  assert.equal(code(boxed), 'carry.no-route', JSON.stringify(boxed));
  assert.match(boxed.reason, /^2 people carrying boxed cannot get it to vault \(the carrying formation would hit box-wall wall\)\. Nobody was asked; choose another place\.$/i, boxed.reason);
  assert.doesNotMatch(boxed.reason, /does not prove|each could walk/i); nobody(boxed, 'boxed');
  // the server's shared preflight asks with holdCutV1 (its details give the search size and budget); a carry without it is unchanged
  const proof = eng.previewMarsVerbV1('carry', {crew: [Ada.entityId, Bo.entityId], item: w.idOf('boxed'), to: {x: w.ax + 8, z: w.az - 8.5, yaw: 0}, holdCutV1: true});
  assert.equal(eng.previewMarsVerbV1('carry', {crew: [Ada.entityId, Bo.entityId], item: w.idOf('boxed'), to: {x: w.ax + 8, z: w.az - 8.5, yaw: 0}}).details, undefined, 'no details without the opt-in');
  assert.equal(proof?.code, 'carry.no-route'); assert.ok(proof.details.expanded <= proof.details.budget, `a proof, not a budget (${proof.details.expanded} of ${proof.details.budget})`);
  // a turn the formation cannot make: the beam lies in the nook, whose only way out is a corridor with a right-angle bend.
  // Each person walks out alone; the planner proves (a small search) the carrying formation cannot turn the corner
  await w.at(Ada, w.ax + 5, w.az + 9); await w.at(Bo, w.ax + 6, w.az + 9.6);
  const native = eng.previewMarsVerbV1('carry', {crew: [Ada.entityId, Bo.entityId], item: inner, to: {x: w.ax + 8.5, z: w.az, yaw: 0}, holdCutV1: true});
  assert.equal(native?.code, 'carry.clearance'); assert.match(native.message, /cannot turn .*'bend-wall wall'.*\((\d+) poses searched\)/, native.message);
  assert.ok(native.details.expanded <= native.details.budget, 'a proof, not a budget');
  const turn = await act(w, Ada, {capability: `carry-with:${inner}`, params: {to: 'shed', with: 'Bo'}});
  assert.equal(code(turn), 'carry.clearance', JSON.stringify(turn)); assert.match(turn.reason, /cannot get it to shed \(the carrying formation would hit bend-wall.*\); each could walk there alone\. Nobody was asked/i, turn.reason); nobody(turn, 'bend');
  t.diagnostic(`refusals: ${[stuck, vault, boxed, turn].map((r) => `${r.code}: ${r.reason}`).join(' | ')}`);
});

const shedOf = (w) => w.edge.places.byId.get(w.god.model.get('shed').id)?.polygon ?? w.god.model.get('shed').shape.area;
const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
/** Both members' receipts completed `arrived` for the same op, the beam lies in the shed, and their hands are free. */
function arrived(w, r) {
  const E = w.f.host.engine.world.entities, b = E[w.idOf('beam')].pose.p;
  for (const [s, rc] of r.crew) { const x = read(w, s, rc); assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.shared.result, 'arrived'); assert.equal(x.code, null); assert.equal(x.reason, null); assert.equal(E[s.entityId].human.grip ?? null, null); }
  assert.equal(E[w.idOf('beam')].support?.kind, 'ground'); assert.ok(inside(shedOf(w), b[0], b[2]), `the beam lies in the shed (${b[0].toFixed(1)}, ${b[2].toFixed(1)})`);
}

test('PC07 A2/A3a: Cy walks into the way after lift; the crew holds the beam and waits, every member is told, then it goes on', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy} = w.souls; let walk = null, during = null;
  await w.at(Cy, w.ax + 5, w.az + 3.4);   // beside the way, not on it
  const r = await carry(w, t, async (c) => {
    if (!walk && c.phase === 'move') walk = ok(await act(w, Cy, {capability: 'walk:mid'}));   // after lift, into the formation's way
    if (!during && c.op.phase === 'blocked') during = {op: structuredClone(c.op), bo: read(w, Bo, c.a), ada: read(w, Ada, c.p), tick: c.tick};
  });
  assert.ok(during, 'the operation was blocked while Cy stood in the way');
  assert.equal(during.op.blocked.code, 'carry.path-occupied'); assert.equal(during.op.blocked.blocker, 'Cy');
  for (const x of [during.bo, during.ada]) {
    assert.equal(x.phase, 'started', 'a hold-up never ends a member\'s receipt'); assert.equal(x.code, 'carry.path-occupied');
    assert.match(x.reason, /^Ada and Bo hold beam and wait for Cy to move out of the way to Shed; the carry goes on once Cy moves\.$/, x.reason);
    assert.equal(x.shared.phase, 'blocked'); assert.equal(x.shared.blocked.blocker, 'Cy');
  }
  for (const s of [Ada, Bo]) { const kinds = streamOf(w, s).map((e) => e.kind); assert.ok(kinds.indexOf('shared.blocked') > kinds.indexOf('shared.started') && kinds.indexOf('shared.resumed') > kinds.indexOf('shared.blocked'), `${s.name} is told: ${kinds.join(',')}`); }
  assert.equal(r.op.blocks?.length, 1, JSON.stringify(r.op)); const [blk] = r.op.blocks;
  assert.deepEqual([blk.code, blk.blocker, !!blk.lasting], ['carry.path-occupied', 'Cy', false]); assert.ok(blk.toTick > blk.fromTick);
  arrived(w, r);
  assert.deepEqual(read(w, Bo, r.a).shared.blocks, r.op.blocks, 'the interval stays in the receipt afterwards');
  assert.equal(read(w, Cy, walk).phase, 'completed', `Cy's own walk completes: ${JSON.stringify(read(w, Cy, walk))}`);
  t.diagnostic(`blocked ${blk.toTick - blk.fromTick} ticks by Cy; Bo told: ${streamOf(w, Bo).filter((e) => e.kind.startsWith('shared.')).map((e) => e.kind).join(', ')}`);
});

test('PC07 A2/A3b: a wall built across the route after lift; the crew takes another way to the agreed place', {timeout: 600000}, async (t) => {
  const w = await world(t), {ax, az} = w, {Bo} = w.souls; let placed = false;
  const r = await carry(w, t, async (c) => {
    if (!placed && c.phase === 'move') { placed = true; ok(w.god.act({ops: [{op: 'place', def: 'core/garden-wall@1', name: 'cut', shape: {path: [[ax + 5.6, az - 1.4], [ax + 5.6, az + 2.6]]}}]})); }
  });
  assert.ok(placed); assert.ok(r.seen.phases.has('replan'), 'the native carry replanned from where it was');
  assert.equal(r.op.detours, 1, JSON.stringify(r.op)); assert.equal(read(w, Bo, r.a).shared.detours, 1);
  assert.deepEqual(read(w, Bo, r.a).shared.revision, 1, 'the same agreed revision: load, crew and destination unchanged');
  arrived(w, r);
});

test('PC07 A2/A3c: a ring of wall closes the way on and the way back; the crew holds the beam (lasting, no timeout), life goes on, and it carries on once the wall is gone', {timeout: 900000}, async (t) => {
  const w = await world(t), {ax, az} = w, {Ada, Bo, Cy} = w.souls, lying = w.f.host.engine.world.entities[w.idOf('beam')].pose.p[1];
  let placed = 0, removed = 0, held = null, lasting = null, spoke = null, cyWalk = null, maxDrift = 0, liftedHeld = 0;
  const r = await carry(w, t, async (c) => {
    if (!placed && c.phase === 'move') { placed = c.tick; ok(w.god.act({ops: [{op: 'place', def: 'core/garden-wall@1', name: 'ring', shape: {path: [[ax - 1, az - 1.3], [ax + 6, az - 1.3], [ax + 6, az + 4.8], [ax - 1, az + 4.8], [ax - 1, az - 1.3]]}}]})); }
    if (c.op.phase === 'blocked' && !removed) {
      const b = c.E[c.beam].pose.p, g = [Ada, Bo].map((s) => c.E[s.entityId].human?.grip);
      held ??= {at: [...b], tick: c.tick, bo: read(w, Bo, c.a)};
      maxDrift = Math.max(maxDrift, flat(sub(b, held.at)));
      if (c.E[c.beam].support?.kind === 'held' && b[1] > lying + 0.3 && g.every((x) => x?.entity === c.beam)) liftedHeld++;
      if (!cyWalk) cyWalk = ok(await act(w, Cy, {capability: 'walk:yard'}));   // an unrelated Soul's walk, outside the ring
      if (!spoke && c.tick - held.tick > 40) { w.setCurrent(Bo); spoke = await (await accept(w.f.host, w.app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: 'We are boxed in.'})}))).json(); }
      if (c.op.blocked?.lasting && !lasting) lasting = {tick: c.tick, op: structuredClone(c.op), bo: read(w, Bo, c.a), ada: read(w, Ada, c.p), cy: read(w, Cy, cyWalk)};
      if (lasting && c.tick - lasting.tick > 40) { removed = c.tick; ok(w.god.act({ops: [{op: 'remove', id: w.idOf('ring')}]})); }
    }
  }, 9000);
  assert.ok(held && lasting && removed, `blocked ${!!held}, lasting ${!!lasting}, removed ${!!removed}`);
  // truthful supported blockage: the native code, the wall named, the load held where it is (not set down, not back to the start)
  assert.equal(held.bo.code, 'carry.route-blocked'); assert.match(held.bo.reason, /^The way to Shed is now blocked by ring wall and there is no other way from here; Ada and Bo hold beam where they are \(it stays supported\); clearing ring wall lets the carry go on\.$/, held.bo.reason);
  assert.equal(lasting.op.blocked.code, 'carry.route-blocked'); assert.ok(lasting.tick - lasting.op.blocked.fromTick >= 600, 'lasting after 30 s');
  for (const x of [lasting.bo, lasting.ada]) { assert.equal(x.phase, 'started'); assert.match(x.reason, /It has lasted 30 s; nobody lets go on a timeout, and clearing ring wall lets the carry go on\.$/, x.reason); }
  assert.ok(liftedHeld > 600, `the beam stayed held off the ground by both grips while blocked (${liftedHeld} ticks)`);
  assert.ok(maxDrift < 0.3, `held where they were, no return to the start (drift ${maxDrift.toFixed(2)} m)`);
  assert.ok(spoke?.said?.heardBy >= 1, `Bo is heard while blocked: ${JSON.stringify(spoke)}`);
  assert.equal(lasting.cy.phase, 'completed', `Cy's unrelated walk completed while the crew was held: ${JSON.stringify(lasting.cy)}`);
  for (const s of [Ada, Bo]) { const k = streamOf(w, s).map((e) => e.kind); assert.equal(k.filter((x) => x === 'shared.blocked').length, 2, `${s.name}: told blocked, then lasting (${k.join(',')})`); assert.ok(k.includes('shared.resumed')); }
  // the wall removed: the crew rechecks the changed scene and carries on, on its own route
  assert.deepEqual(r.op.blocks.map((b) => [b.code, b.blocker, b.lasting ?? false]), [['carry.route-blocked', 'ring wall', true]]);
  assert.ok(r.op.blocks[0].toTick >= removed && r.op.blocks[0].toTick - removed < 40, `resumed promptly after the wall went (${r.op.blocks[0].toTick - removed} ticks)`);
  arrived(w, r);
  t.diagnostic(`blocked ${r.op.blocks[0].toTick - r.op.blocks[0].fromTick} ticks (lasting at ${lasting.tick - lasting.op.blocked.fromTick}); held ${liftedHeld} ticks off the ground, drift ${maxDrift.toFixed(2)} m; Bo heard by ${spoke.said.heardBy}`);
});

test('PC07 A2: the destination walled in after lift on open ground; the replan stops at its pose budget, said as no proof, and it carries on once the wall is gone', {timeout: 900000}, async (t) => {
  const w = await world(t), {ax, az} = w, {Bo} = w.souls; let placed = 0, held = null, removed = 0;
  const r = await carry(w, t, async (c) => {
    if (!placed && c.phase === 'move') { placed = c.tick; ok(w.god.act({ops: [{op: 'place', def: 'core/garden-wall@1', name: 'seal', shape: {path: [[ax + 6.4, az - 2.6], [ax + 10.6, az - 2.6], [ax + 10.6, az + 2.6], [ax + 6.4, az + 2.6], [ax + 6.4, az - 2.6]]}}]})); }
    if (c.op.phase === 'blocked' && !held) held = {tick: c.tick, op: structuredClone(c.op), bo: read(w, Bo, c.a)};
    if (held && !removed && c.tick - held.tick > 20) { removed = c.tick; ok(w.god.act({ops: [{op: 'remove', id: w.idOf('seal')}]})); }
  });
  assert.ok(held && removed, `blocked ${!!held}, removed ${!!removed}`);
  assert.equal(held.bo.code, 'carry.route-blocked'); assert.equal(held.op.blocked.blocker, 'seal wall');
  assert.match(held.bo.reason, /^The way to Shed is now blocked by seal wall; a search of \d+ poses found no other way from here, which does not prove there is none; Ada and Bo hold beam where they are \(it stays supported\); clearing seal wall lets the carry go on\.$/, held.bo.reason);
  assert.doesNotMatch(held.bo.reason, /there is no other way/);
  assert.deepEqual(r.op.blocks.map((b) => [b.code, b.blocker]), [['carry.route-blocked', 'seal wall']]);
  arrived(w, r);
  t.diagnostic(`held ${removed - held.tick} ticks; reason: ${held.bo.reason}`);
});
