// PC11 (#690): carrying is a general material capability, not a beam script. A table-shaped load (core-work-table@1,
// 75 kg: three carriers by mass, room for four) and crews of three and four go through the same PC04–PC10 invitation,
// op and receipts as the two-Soul beam (docs/design/shared-execution.md). Also here: what a declined or departed guest
// of a larger crew means for the host, refusals before anyone is asked or moves, interruptions and a restart with a
// crew of three, ordinary solo handling with the flag on, and a check that the shared code names no def, load or Soul.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory, seed, worldId} from '../../apps/server/test/native-owner-fixture.ts';
import {Db} from '../../apps/server/src/db.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldHost} from '../../apps/server/src/world.ts';

const HOUR = 3_600_000, STEP_MS = 50;
// core-work-table@1's grips in its own frame (+x along the top, z across): packages/world-compiler/src/core-kit/authoring/work.mjs
const TABLE = {kg: 75, grips: {3: [[-1.1, 0.38], [-1.1, -0.38], [1.1, 0]], 4: [[-1.1, 0.38], [-1.1, -0.38], [1.1, 0.38], [1.1, -0.38]]}};

/** Mount the edge on a host as the server does: the ledger with the flag on, Comms with fading, the god's bridge. */
function mount(w, host, db) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry: true, now: w.now}), app = new Hono();
  const comms = registerEdgeComms(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.current}, {fading: true, beam: true, now: w.now, sweepMs: 0});
  edge.attachComms(comms); comms.fading.addHold((id) => edge.postureHold(id));
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  installEngineBridge({host, god, edge, log() {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, app, comms, god});
}
/** A fake-mind world on a file database (so it can restart). `names`: the Souls, each with their own owner; `scene`
 *  places the table, the destinations and the rest relative to the first Soul. */
async function world(t, {names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve', 'Fy'], scene = defaultScene} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc11-crew-')), path = join(dir, 'sim.db'), opts = {durableClockV1: true};
  const f = fixture(path, factory, opts); f.brain.quiesce();
  const clock = {now: 1_700_000_000_000};
  const w = {f, path, opts, clock, now: () => clock.now, current: null, hosts: [f.host]};
  t.after(() => { try { w.comms?.close(); } catch {} for (const h of w.hosts) try { h.stop(); } catch {} try { if (w.db.db.isOpen) w.db.close(); } catch {} rmSync(dir, {recursive: true, force: true}); });
  mount(w, f.host, f.db);
  w.tick = async (n = 5) => { for (let i = 0; i < n; i++) { clock.now += STEP_MS; w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  await w.tick();
  const souls = {};
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}-owner`, {name, description: 'Shared crew test'}));
    souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  }
  await w.tick();
  const E = () => w.host.engine.world.entities, [ax, , az] = E()[souls[names[0]].entityId].pose.p;
  w.at = async (s, x, z) => {
    await accept(w.host, w.host.enqueue('edge-relocate', `test:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test setup'}));
    const q = E()[s.entityId].pose.p; assert.ok(Math.hypot(q[0] - x, q[2] - z) < 3, `${s.name} stands at ${x},${z}`);
  };
  await scene(w, souls, names, ax, az);
  await w.tick(60);
  return Object.assign(w, {souls, ax, az, E, idOf: (n) => w.god.model.get(n).id});
}
/** The §7 scene with the table: the crew beside it on open level-0 ground, the shed about 8 m away, a yard the other way;
 *  the 38 kg upright and a 19 kg beam; a toolbox; Eve and Fy (later a floater) a little way off. */
async function defaultScene(w, souls, names, ax, az) {
  const [, b, c, d, e, f] = names.map((n) => souls[n]);
  await w.at(b, ax, az + 3); await w.at(c, ax + 3.5, az + 3); await w.at(d, ax + 3.5, az - 1.5); await w.at(e, ax - 4, az - 4); await w.at(f, ax - 2, az - 6);
  ok(w.god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2.5], [ax + 11, az - 2.5], [ax + 11, az + 2.5], [ax + 7, az + 2.5]]}},
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax - 11, az - 2.5], [ax - 7, az - 2.5], [ax - 7, az + 2.5], [ax - 11, az + 2.5]]}},
    {op: 'place', def: 'core/work-table@1', name: 'table', p: [ax + 2, az + 1.5]},
    {op: 'place', def: 'core/rack-upright@1', name: 'frame', p: [ax - 3, az + 6]},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax - 3, az - 2]},
    {op: 'place', def: 'core/toolbox@1', name: 'toolbox', p: [ax + 1, az - 3]},
  ]}));
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const act = async (w, s, input) => accept(w.host, w.edge.act(s, input));
const code = (r) => r.error?.code ?? r.code;
const inviteOf = (w, id) => w.edge.together.invite(id);
const read = (w, s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
const until = async (w, done, max) => { for (let n = 0; n < max && !done(); n++) await w.tick(1); };
const flat = (p) => Math.hypot(p[0], p[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const streamOf = (w, s) => w.comms.streams.read(s.soulId, 0).events;
const events = (w, kind) => w.db.db.prepare('SELECT seq, payload FROM events WHERE kind=? ORDER BY seq').all(kind).map((r) => ({seq: r.seq, ...JSON.parse(r.payload)}));
const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const walkOf = (w, s, to = null) => w.edge.capabilities(s).find((c) => c.verb === 'walk' && c.available && (!to || c.id === `walk:${to}`))?.id ?? w.edge.capabilities(s).find((c) => c.verb === 'walk' && c.available).id;
const say = async (w, s, text) => { w.current = s; return (await accept(w.host, w.app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text})}))).json(); };
const walked = async (w, s, to) => {
  const r = ok(await act(w, s, {capability: walkOf(w, s, to)}));
  await until(w, () => !['waiting', 'started'].includes(read(w, s, r).phase), 1500);
  assert.equal(read(w, s, r).phase, 'completed', `${s.name} walks: ${JSON.stringify(read(w, s, r))}`);
};

/** Propose `load` to `to` with `guests` in ordinary words, every guest accepts revision 1, and the world commits. */
async function commit(w, host, guests, load, to, words) {
  const p = ok(await act(w, host, {capability: `carry-with:${load}`, params: {to, with: words ?? guests.map((g) => g.name).join(' and ')}})), id = p.receipt.shared.invite;
  const accepts = [];
  for (const g of guests) accepts.push(ok(await act(w, g, {capability: `accept:${id}`, params: {revision: 1}})));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  assert.equal(inviteOf(w, id).state, 'committed', JSON.stringify(read(w, host, p)));
  return {p, id, crew: [[host, p], ...guests.map((g, i) => [g, accepts[i]])], op: inviteOf(w, id).shared.op};
}
/** Sample the world every tick until the op ends: no carrier or load step over 0.1 m (nothing teleports or drops), the
 *  load always carried or lying on the ground, and while every member holds it each stands within reach of their own
 *  grip. `during(ctx)` runs each tick. */
async function carry(w, t, c, load, grips, during, max = 8000) {
  const E = w.E(), eng = w.host.engine, last = {}, slots = new Set();
  const seen = {held: 0, lifted: 0, maxReach: 0, maxStep: 0, maxLoadStep: 0, unsupported: 0, phases: [], turn: 0}, lying = {y: E[load].pose.p[1], yaw: E[load].pose.yaw ?? 0};
  for (let n = 0; n < max && inviteOf(w, c.id).shared.op.phase !== 'ended'; n++) {
    await w.tick(1);
    const x = w.E()[load], b = x.pose.p, g = c.crew.map(([s]) => w.E()[s.entityId].human?.grip);
    const phase = eng.programAction?.(c.op.programId)?.action.phase; if (phase && seen.phases.at(-1) !== phase) seen.phases.push(phase);
    for (const [s] of c.crew) { const q = w.E()[s.entityId].pose.p; if (last[s.name]) seen.maxStep = Math.max(seen.maxStep, flat(sub(q, last[s.name]))); last[s.name] = [...q]; }
    if (last.load) seen.maxLoadStep = Math.max(seen.maxLoadStep, flat(sub(b, last.load)), Math.abs(b[1] - last.load[1])); last.load = [...b];
    if (x.phase !== 'carried' && x.support?.kind !== 'ground') seen.unsupported++;
    // the native lift and set-down interpolate the load's pose; a crew that lifts facing the other way along the load
    // turns it half a turn in their hands meanwhile (a pre-existing native limit, reported in #690), so reach is checked
    // outside those two transitions and the turn is measured
    if (phase === 'lift' || phase === 'set-down') { seen.turn = Math.max(seen.turn, Math.abs(Math.atan2(Math.sin((x.pose.yaw ?? 0) - lying.yaw), Math.cos((x.pose.yaw ?? 0) - lying.yaw)))); }
    if (grips && g.every((h) => h?.entity === load) && phase !== 'lift' && phase !== 'set-down') {
      seen.held++; for (const h of g) slots.add(h.slot);
      // the grips in world space as the engine turns them (mars/viewer/engine/core/math.ts rot2); they are the formation's: its heading is the load's long axis either way round (a box turned half a turn is
      // the same box), so a grip is reached in the frame the crew formed in, which is the same for all of them
      const yaw = x.pose.yaw ?? 0, frame = (th) => c.crew.map(([s], i) => { const [lx, lz] = grips[Number(g[i].slot.slice(1))], cs = Math.cos(th), sn = Math.sin(th); return flat(sub(w.E()[s.entityId].pose.p, [b[0] + cs * lx - sn * lz, 0, b[2] + sn * lx + cs * lz])); });
      const ds = [frame(yaw), frame(yaw + Math.PI)].sort((p, q) => Math.max(...p) - Math.max(...q))[0];
      for (const [i, [s]] of c.crew.entries()) {
        const d = ds[i];
        seen.maxReach = Math.max(seen.maxReach, d); assert.ok(d < 1, `${s.name} is ${d.toFixed(2)} m from grip ${g[i].slot} (tick ${eng.world.tick}; yaw ${yaw.toFixed(2)}, load ${b.map((v) => v.toFixed(2))}, body ${w.E()[s.entityId].pose.p.map((v) => v.toFixed(2))})`);
      }
      if (b[1] > lying.y + 0.3) seen.lifted++;
    }
    await during?.({n, phase, op: inviteOf(w, c.id).shared.op, x});
  }
  t.diagnostic(`native phases ${seen.phases.join(',')}; held by all ${seen.held} ticks on ${[...slots].sort().join(',')}, lifted ${seen.lifted}; carriers at most ${seen.maxReach.toFixed(2)} m from their grips; load turned up to ${seen.turn.toFixed(2)} rad in a lift or set-down; largest step ${seen.maxStep.toFixed(3)} m, load ${seen.maxLoadStep.toFixed(3)} m`);
  assert.ok(seen.maxStep < 0.1, `no carrier teleports (${seen.maxStep.toFixed(3)} m)`); assert.ok(seen.maxLoadStep < 0.1, `the load never jumps or drops (${seen.maxLoadStep.toFixed(3)} m)`);
  assert.equal(seen.unsupported, 0, 'the load is always carried or lying on the ground');
  return {...seen, slots, end: inviteOf(w, c.id).shared.op};
}
const arrived = (w, c, place, load) => {
  for (const [s, r] of c.crew) { const x = read(w, s, r); assert.equal(x.phase, 'completed', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.shared.result, 'arrived'); assert.equal(x.shared.op, c.op.id); }
  const x = w.E()[load], poly = w.god.model.get(place).shape.area;
  assert.equal(x.support?.kind, 'ground'); assert.equal(x.reservedBy ?? null, null, 'the load claim is gone');
  assert.ok(inside(poly, x.pose.p[0], x.pose.p[2]), `it lies in ${place} (${x.pose.p[0].toFixed(1)}, ${x.pose.p[2].toFixed(1)})`);
  for (const [s] of c.crew) assert.equal(w.E()[s.entityId].human.grip ?? null, null, `${s.name}'s hands are free`);
};

test('PC11 A1a/A1b/A4b: a crew of three carries the 75 kg table through ordinary words; talk, a refused competing claim and an unrelated walk around it', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Eve} = w.souls, table = w.idOf('table'), eng = w.host.engine;
  // the def: a new immutable revision whose handling is data (crew 3–4 by mass, grips at its legs), carried level on its legs
  const def = w.god.model.def('core/work-table@1');
  assert.deepEqual(def.components.carryable.handling.crew, [3, 4]); assert.equal(def.components.carryable.mass, TABLE.kg); assert.ok(def.tags.includes('shared-carry'));
  const lying = structuredClone(w.E()[table].pose);
  // the solo carry says it needs three, by mass, and names the shared carry (the agent's discovery)
  const solo = w.edge.capabilities(Ada).find((c) => c.id === `carry:${table}`);
  assert.equal(solo.available, false); assert.equal(solo.blocked.code, 'carry.crew-too-small'); assert.match(solo.blocked.reason, /75 kg\) needs 3 carriers; one person carries at most 30 kg/); assert.match(solo.blocked.reason, new RegExp(`carry-with:${table}`));
  assert.match(w.edge.capabilities(Ada).find((c) => c.id === `carry-with:${table}`).label, /3–4 carriers/);
  // Eve, uninvited, starts a walk to the yard before anything is agreed
  const eveWalk = ok(await act(w, Eve, {capability: walkOf(w, Eve, 'yard')}));
  // ordinary words: "Bo and Cy"; each guest's offer names everyone else asked; the waiting note says who is undecided
  const p = ok(await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo and Cy'}})), id = p.receipt.shared.invite;
  assert.equal(p.receipt.awaitingAnswer.note, 'Invitation sent; Bo and Cy have not accepted yet. Nothing shared has started.');
  assert.match(w.edge.capabilities(Bo).find((c) => c.id === `accept:${id}`).label, /carry table to Shed with Ada and Cy \(revision 1/);
  assert.match(w.edge.capabilities(Cy).find((c) => c.id === `accept:${id}`).label, /with Ada and Bo \(revision 1/);
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  assert.equal(read(w, Ada, p).awaitingAnswer.note, 'Invitation sent; Cy has not accepted yet. Nothing shared has started.');
  const b = ok(await act(w, Cy, {capability: `accept:${id}`, params: {revision: 1}}));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  const c = {p, id, crew: [[Ada, p], [Bo, a], [Cy, b]], op: inviteOf(w, id).shared.op};
  // one op, three receipts started in the commit tick, three distinct slots
  assert.equal(inviteOf(w, id).state, 'committed');
  for (const [s, r] of c.crew) { const x = read(w, s, r); assert.equal(x.phase, 'started', s.name); assert.equal(x.startedTick, c.op.committedTick); assert.equal(x.shared.op, c.op.id); }
  assert.deepEqual(c.crew.map(([s, r]) => read(w, s, r).shared.slot), [0, 1, 2]);
  assert.match(streamOf(w, Cy).find((e) => e.kind === 'shared.started').text, /^The shared carry started: Ada, Bo and Cy carry table to Shed\./);
  let spoke = null, competing = null, eveTalk = null, eveDoneDuring = false;
  const seen = await carry(w, t, c, table, TABLE.grips[3], async ({x}) => {
    if (!spoke && x.phase === 'carried' && x.pose.p[1] > lying.p[1] + 0.3) {
      spoke = await say(w, Bo, 'Watch the legs.');
      // a competing claim mid-carry: Eve (not in the crew) is refused before anything moves, and can still talk
      const offer = w.edge.capabilities(Eve).find((k) => k.id === `carry-with:${table}`);
      competing = {offer: offer ? {available: offer.available, code: offer.blocked?.code} : null, solo: await act(w, Eve, {capability: `carry:${table}`, params: {to: 'yard'}}), shared: await act(w, Eve, {capability: `carry-with:${table}`, params: {to: 'yard', with: 'Dee and Fy'}})};
      eveTalk = await say(w, Eve, 'That looks heavy.');
    }
    if (!eveDoneDuring && read(w, Eve, eveWalk).phase === 'completed') eveDoneDuring = inviteOf(w, id).shared.op.phase !== 'ended';
  });
  assert.ok(seen.held > 40, `all three held the table together (${seen.held} ticks)`); assert.equal(seen.slots.size, 3, 'on three distinct grips');
  assert.ok(seen.lifted > 20, `the table was off the ground while carried (${seen.lifted} ticks)`);
  assert.ok(spoke?.said?.heardBy >= 1, `Bo is heard mid-carry: ${JSON.stringify(spoke)}`);
  t.diagnostic(`competing: ${JSON.stringify({offer: competing.offer, solo: code(competing.solo), shared: code(competing.shared)})}`);
  assert.equal(competing.solo.accepted, false); assert.equal(competing.shared.accepted, false);
  assert.ok(['carry.in-use', 'carry.crew-too-small'].includes(code(competing.solo)), code(competing.solo)); assert.equal(code(competing.shared), 'carry.in-use', competing.shared.reason);
  assert.ok(eveTalk?.said?.heardBy >= 1, 'Eve talks after her refusal');
  assert.equal(w.edge.together.invitesFor(w.souls.Dee.soulId).length, 0, 'nobody was asked by the refused claim');
  assert.ok(eveDoneDuring, `Eve's walk, started before the commit, completed while the carry ran (${read(w, Eve, eveWalk).phase})`);
  arrived(w, c, 'shed', table);
  const end = w.E()[table].pose; assert.ok(!end.pitch && !end.roll, 'the table stands on its legs'); assert.ok(Math.abs(end.p[1] - lying.p[1]) < 0.05, 'on the ground');
  for (const s of [Ada, Bo, Cy]) await walked(w, s, 'yard');
  assert.deepEqual(eng.runtime.violations, []);
});

test('PC11 A1c: a crew of four carries the table (one at each leg); a crew of three carries the upright', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Dee} = w.souls, table = w.idOf('table'), frame = w.idOf('frame');
  const c = await commit(w, Ada, [Bo, Cy, Dee], table, 'shed', 'Bo, Cy and Dee');
  const seen = await carry(w, t, c, table, TABLE.grips[4]);
  assert.ok(seen.held > 40); assert.equal(seen.slots.size, 4, 'on four distinct grips');
  arrived(w, c, 'shed', table);
  for (const [s, dx] of [[Bo, -1], [Cy, -4], [Dee, -6]]) await w.at(s, w.ax + dx, w.az + 8);
  const u = await commit(w, Bo, [Cy, Dee], frame, 'yard');
  await carry(w, t, u, frame, null);
  arrived(w, u, 'yard', frame);
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('PC11 A2b: crew, mass, body and reach refusals come before anyone is asked or moves', {timeout: 300000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Dee, Eve, Fy} = w.souls, table = w.idOf('table'), eng = w.host.engine;
  const noneAsked = () => { for (const s of [Bo, Cy, Dee, Eve, Fy]) assert.equal(w.edge.together.invitesFor(s.soulId).length, 0, `${s.name} was not asked`); };
  const two = await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo'}});
  assert.equal(code(two), 'carry.crew-too-small'); assert.equal(two.reason, 'table needs at least 3 carriers (75 kg; one person carries at most 30 kg); ask 2 Souls to carry it with you.');
  const five = await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo, Cy, Dee and Eve'}});
  assert.equal(code(five), 'carry.crew-too-large'); assert.match(five.reason, /at most 4 carriers/);
  assert.equal(code(await act(w, Ada, {capability: `carry:${table}`, params: {to: 'shed'}})), 'carry.crew-too-small');
  noneAsked(); assert.deepEqual(w.edge.openReceipts(Ada.soulId), []);
  // reach: a host more than 10 m from the load cannot propose, and a guest that far cannot accept
  await w.at(Eve, w.ax - 12, w.az - 6);
  const far = await act(w, Eve, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo and Cy'}});
  assert.equal(code(far), 'shared.too-far', JSON.stringify(far)); noneAsked();
  const p = ok(await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo, Cy and Eve'}})), id = p.receipt.shared.invite;
  const tooFar = await act(w, Eve, {capability: `accept:${id}`, params: {revision: 1}});
  assert.equal(code(tooFar), 'shared.too-far', JSON.stringify(tooFar)); assert.match(tooFar.reason, /walk within 10 m/);
  ok(await act(w, Ada, {capability: `withdraw:${id}`}));
  // body: a floater can neither propose nor accept
  assert.equal(eng.assignBodyV1(Fy.entityId, {family: 'floater', type: 'floater', radius: 0.35, hoverHeight: 1.45}), true);
  await w.at(Fy, w.ax - 1, w.az + 4);
  assert.equal(code(await act(w, Fy, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo and Cy'}})), 'body.unsupported');
  const q = ok(await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo, Cy and Fy'}}));
  assert.equal(code(await act(w, Fy, {capability: `accept:${q.receipt.shared.invite}`, params: {revision: 1}})), 'body.unsupported');
  ok(await act(w, Ada, {capability: `withdraw:${q.receipt.shared.invite}`}));
  for (const s of [Ada, Bo, Cy, Fy]) assert.equal(eng.programOf(s.entityId), null, `${s.name} never moved`);
  assert.deepEqual(eng.runtime.violations, []);
});

test('PC11 A2a: other Souls, owners, placement, yaw and destination end the same way; the shared code names no def, load or Soul', {timeout: 600000}, async (t) => {
  const names = ['Ines', 'Jun', 'Kai'];
  const w = await world(t, {names, scene: async (w, souls, n, ax, az) => {
    await w.at(souls.Jun, ax - 2, az - 3); await w.at(souls.Kai, ax + 1, az - 5);
    ok(w.god.act({ops: [
      {op: 'place', def: 'core/zone@1', name: 'dock', shape: {area: [[ax - 3, az - 14], [ax + 2, az - 14], [ax + 2, az - 10], [ax - 3, az - 10]]}},
      {op: 'place', def: 'core/work-table@1', name: 'bench', p: [ax - 1, az - 2.5], r: 0.9 + 8 * Math.PI},
    ]}));
  }});
  const {Ines, Jun, Kai} = w.souls, bench = w.idOf('bench');
  const turned = w.E()[bench].pose.yaw ?? 0; assert.ok(Math.abs(turned) > 7, `placed four turns and a bit round (${turned})`);
  const c = await commit(w, Kai, [Ines, Jun], bench, 'dock', 'Ines and Jun');
  const seen = await carry(w, t, c, bench, TABLE.grips[3]);
  assert.equal(seen.slots.size, 3);
  arrived(w, c, 'dock', bench);
  assert.deepEqual(new Set([Ines, Jun, Kai].map((s) => s.owner)).size, 3, 'three owners');
  // the shared ledger, the bridge and the ledger's receipt view branch on no def, load or Soul name (code only, not comments)
  for (const f of ['apps/server/src/edge/ledger/together.ts', 'apps/server/src/god/engine-bridge.ts', 'apps/server/src/edge/ledger/ledger.ts']) {
    const code = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')).join('\n');
    assert.doesNotMatch(code, /['"`](?:core[-/])?(?:work-table|rack-upright|rack-beam|plywood-sheet)\b/, `${f} names a load def`);
    assert.doesNotMatch(code, /['"`](?:Ada|Bo|Cy|Dee)['"`]/, `${f} names a Soul`);
  }
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('PC11 A3a: Cy (the third carrier) stops the table carry mid-move; set down safely, one stop, all three free', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy} = w.souls, table = w.idOf('table'), start = structuredClone(w.E()[table].pose.p);
  const c = await commit(w, Ada, [Bo, Cy], table, 'shed');
  let stop = null, again = null;
  await carry(w, t, c, table, TABLE.grips[3], async ({phase, x}) => {
    if (!stop && phase === 'move' && flat(sub(x.pose.p, start)) > 2) { stop = await act(w, Cy, {capability: `stop-carry:${c.op.id}`}); again = await act(w, Bo, {capability: `stop-carry:${c.op.id}`}); }
  });
  assert.equal(stop.accepted, true, JSON.stringify(stop)); assert.equal(stop.receipt.code, 'shared.stop-requested');
  assert.equal(again.receipt?.code, 'shared.stop-asked', 'a second stop changes nothing');
  assert.equal(events(w, 'edge-stop').filter((e) => e.programId === c.op.programId).length, 1, 'one logged stop');
  for (const [s, r] of c.crew) { const x = read(w, s, r); assert.equal(x.phase, 'completed', s.name); assert.equal(x.code, 'shared.stopped'); assert.equal(x.shared.stop.name, 'Cy'); assert.match(x.reason, /Ada, Bo and Cy have let go/); }
  const x = w.E()[table]; assert.equal(x.support?.kind, 'ground'); assert.equal(x.reservedBy ?? null, null); assert.ok(!x.pose.pitch && !x.pose.roll, 'on its legs');
  for (const s of [Ada, Bo, Cy]) await walked(w, s, 'yard');
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('PC11 A3b: Bo goes away mid-move with a crew of three; his fade is his stop, held and set down for all three', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Eve} = w.souls, table = w.idOf('table'), start = structuredClone(w.E()[table].pose.p);
  const c = await commit(w, Ada, [Bo, Cy], table, 'shed');
  let faded = null;
  await carry(w, t, c, table, TABLE.grips[3], async ({phase, x}) => {
    if (faded === null && phase === 'move' && flat(sub(x.pose.p, start)) > 2) {
      // Bo's agent is gone past the fading clock and the 12 h hold an accepted carry gives; the others are not
      w.clock.now += 13 * HOUR; for (const s of [Ada, Cy, Eve]) w.comms.fading.touch(s.soulId); w.comms.sweep();
      faded = w.edge.faded.has(Bo.soulId);
    }
  });
  assert.equal(faded, true, 'Bo faded mid-move');
  assert.deepEqual(events(w, 'edge-stop').filter((e) => e.programId === c.op.programId).map((e) => e.why), ['shared.away']);
  for (const [s, r] of c.crew) {
    const x = read(w, s, r); assert.equal(x.code, 'shared.stopped', `${s.name}: ${JSON.stringify(x)}`); assert.equal(x.shared.stop.by, Bo.soulId); assert.equal(x.shared.stop.away, true);
    assert.match(x.reason, /^Stopped because Bo went away/);
  }
  const x = w.E()[table]; assert.equal(x.support?.kind, 'ground'); assert.equal(x.reservedBy ?? null, null);
  for (const s of [Ada, Cy]) await walked(w, s, 'yard');
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('PC11 A3c: a server restart mid-carry with a crew of three keeps the op and its receipts; it ends arrived', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy} = w.souls, table = w.idOf('table'), start = structuredClone(w.E()[table].pose.p);
  const c = await commit(w, Ada, [Bo, Cy], table, 'shed');
  for (let n = 0; n < 3000 && !(w.host.engine.programAction?.(c.op.programId)?.action.phase === 'move' && flat(sub(w.E()[table].pose.p, start)) > 2); n++) await w.tick(1);
  const before = c.crew.map(([s, r]) => read(w, s, r)), at = structuredClone(w.E()[table].pose.p);
  // the server's own shutdown (stop, drain, snapshot), then a new process on the same database
  w.comms.close(); w.host.stop(); w.host.drainInputs(); w.host.saveSnapshot(true); w.db.close();
  const db = new Db(w.path), h = new WorldHost(db, factory, seed, 1e9, worldId, w.opts); h.boot(); h.drainInputs(); w.hosts.push(h); mount(w, h, db);
  const after = c.crew.map(([s, r]) => read(w, s, r));
  assert.deepEqual(after.map((x) => [x.id, x.phase, x.shared.op]), before.map((x) => [x.id, 'started', c.op.id]), 'the same receipts, still started, the same op');
  assert.ok(flat(sub(w.E()[table].pose.p, at)) < 0.1, 'the table is where it was'); assert.equal(w.E()[table].phase, 'carried');
  const stale = await act(w, Cy, {capability: `accept:${c.id}`, params: {revision: 1}});
  assert.equal(stale.accepted, false); assert.equal(code(stale), 'shared.busy');
  await carry(w, t, c, table, null);
  arrived(w, c, 'shed', table);
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('PC11 A3d/A4b: one of four declines while the rest meet the minimum; everyone is told who and how; the host revises it and it commits', {timeout: 600000}, async (t) => {
  const w = await world(t), {Ada, Bo, Cy, Dee} = w.souls, table = w.idOf('table');
  const p = ok(await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo, Cy and Dee'}})), id = p.receipt.shared.invite;
  const a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  ok(await act(w, Dee, {capability: `decline:${id}`}));
  await w.tick(30);
  // Cy has not answered yet: the host hears both that Cy is undecided and that Dee is out
  let host = read(w, Ada, p);
  assert.equal(host.phase, 'waiting'); assert.equal(inviteOf(w, id).state, 'pending');
  assert.equal(host.awaitingAnswer.note, 'Invitation sent; Cy has not accepted yet. Nothing shared has started.');
  assert.equal(host.code, 'shared.not-ready');
  assert.equal(host.reason, `Not started: Dee declined, so this revision of the carry of table cannot start as asked. To carry it with Bo and Cy, amend this proposal: act carry-with:${table} with {"to": "Shed", "with": "Bo and Cy", "invite": "${id}"} (a new revision they accept again); or ask someone else in their place the same way.`);
  const c1 = ok(await act(w, Cy, {capability: `accept:${id}`, params: {revision: 1}}));
  await w.tick(30);
  assert.equal(inviteOf(w, id).state, 'pending', 'a revision with a declined role never starts');
  for (const [s, r] of [[Bo, a], [Cy, c1]]) { const x = read(w, s, r); assert.equal(x.code, 'shared.not-ready'); assert.match(x.reason, /^Not started: Dee declined.*Ada can ask again without them/); }
  // the owner revises during the open proposal: the three who agreed, and the yard instead of the shed
  const amend = ok(await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'yard', with: 'Bo and Cy', invite: id}}));
  assert.equal(amend.receipt.id, p.receipt.id, 'the amend answers with the host\'s one receipt');
  assert.equal(inviteOf(w, id).shared.revision, 2); host = read(w, Ada, p); assert.equal(host.code, null, 'the old revision\'s note is gone');
  for (const [s, r] of [[Bo, a], [Cy, c1]]) assert.equal(read(w, s, r).code, 'shared.revision-changed');
  assert.ok(streamOf(w, Dee).some((e) => e.kind === 'invite.closed'), 'Dee is told it no longer includes her');
  const stale = await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}});
  assert.equal(code(stale), 'shared.revision-changed', 'a stale accept of revision 1 is refused');
  const a2 = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 2}})), c2 = ok(await act(w, Cy, {capability: `accept:${id}`, params: {revision: 2}}));
  await until(w, () => inviteOf(w, id).state !== 'pending', 60);
  assert.equal(inviteOf(w, id).state, 'committed');
  const c = {id, crew: [[Ada, p], [Bo, a2], [Cy, c2]], op: inviteOf(w, id).shared.op};
  await carry(w, t, c, table, TABLE.grips[3]);
  arrived(w, c, 'yard', table);
  // a guest who accepts and then does something else has left: the same note, in the words "left"
  await w.at(Dee, w.ax - 7, w.az + 1); await w.at(Bo, w.ax - 8, w.az + 2); await w.at(Cy, w.ax - 7, w.az - 1); await w.at(Ada, w.ax - 9, w.az);
  const q = ok(await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo, Cy and Dee'}})), qid = q.receipt.shared.invite;
  for (const s of [Bo, Cy, Dee]) ok(await act(w, s, {capability: `accept:${qid}`, params: {revision: 1}}));
  ok(await act(w, Dee, {capability: walkOf(w, Dee, 'shed')}));
  await w.tick(30);
  assert.match(read(w, Ada, q).reason ?? '', /^Not started: Dee left, so this revision/);
  // fewer than the minimum after a decline closes it at once, as for two (sharedViable)
  ok(await act(w, Ada, {capability: `withdraw:${qid}`}));
  const r = ok(await act(w, Ada, {capability: `carry-with:${table}`, params: {to: 'shed', with: 'Bo and Cy'}}));
  ok(await act(w, Cy, {capability: `decline:${r.receipt.shared.invite}`})); await w.tick(5);
  assert.equal(read(w, Ada, r).phase, 'failed'); assert.equal(read(w, Ada, r).code, 'invite.declined');
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('PC11 A3e: ordinary solo handling still works with the flag on (a one-hand toolbox, a solo beam carry)', {timeout: 300000}, async (t) => {
  const w = await world(t), {Ada, Bo} = w.souls, toolbox = w.idOf('toolbox'), beam = w.idOf('beam');
  const pick = ok(await act(w, Ada, {capability: `pick-up:${toolbox}`}));
  await until(w, () => !['waiting', 'started'].includes(read(w, Ada, pick).phase), 600);
  assert.equal(read(w, Ada, pick).phase, 'completed', JSON.stringify(read(w, Ada, pick)));
  assert.equal(w.E()[toolbox].support?.kind, 'in-hand');
  const down = w.edge.capabilities(Ada).find((c) => c.verb === 'put-down' && c.available);
  assert.ok(down, `a put-down is offered: ${w.edge.capabilities(Ada).filter((c) => /put|drop|set/.test(c.verb)).map((c) => c.id).join(', ')}`);
  const put = ok(await act(w, Ada, {capability: down.id}));
  await until(w, () => !['waiting', 'started'].includes(read(w, Ada, put).phase), 600);
  assert.equal(read(w, Ada, put).phase, 'completed', JSON.stringify(read(w, Ada, put))); assert.notEqual(w.E()[toolbox].support?.kind, 'in-hand');
  const solo = ok(await act(w, Bo, {capability: `carry:${beam}`, params: {to: 'yard'}}));
  await until(w, () => !['waiting', 'started'].includes(read(w, Bo, solo).phase), 3000);
  assert.equal(read(w, Bo, solo).phase, 'completed', `the solo carry of the beam still works: ${JSON.stringify(read(w, Bo, solo))}`);
  assert.deepEqual(w.host.engine.runtime.violations, []);
});
