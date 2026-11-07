// PC04 (#683): a shared physical operation is proposed, accepted and left through ordinary together offers, each Soul
// against the same revision on its own stream. Nothing commits, claims or moves before every role is accepted (the
// commit itself is PC05, tools/soul-actions/shared-commit.test.mjs).
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
  return {f, edge, god, app, tick, souls, pos, idOf, at, setCurrent: (s) => { current = s; }};
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const caps = (w, s) => w.edge.capabilities(s);
const act = async (w, s, input) => accept(w.f.host, w.edge.act(s, input));
const code = (r) => r.error?.code ?? r.code;
const inviteOf = (w, id) => w.edge.together.invite(id);

test('PC04: propose, accept against the revision, and nothing moves before the acceptance', {timeout: 240000}, async (t) => {
  const w = await world(t, true), {Ada, Bo, Cy, Fy} = w.souls, beam = w.idOf('beam');
  // Fy is a floater (a body that cannot carry); Cy is not invited
  assert.equal(w.f.host.engine.assignBodyV1(Fy.entityId, {family: 'floater', type: 'floater', radius: 0.35, hoverHeight: 1.45}), true);
  const offer = caps(w, Ada).find((c) => c.id === `carry-with:${beam}`);
  assert.ok(offer?.available, JSON.stringify(caps(w, Ada).filter((c) => c.verb.startsWith('carry'))));
  assert.ok(offer.params.to && offer.params.with);
  const before = {Ada: [...w.pos(Ada)], Bo: [...w.pos(Bo)]};
  // propose (A1): a waiting receipt naming Bo; a shared invitation at revision 1
  const p = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}}));
  assert.equal(p.receipt.phase, 'waiting');
  assert.deepEqual(p.receipt.awaitingAnswer.waitingFor.map((g) => g.name), ['Bo']);
  const inv = inviteOf(w, p.receipt.shared.invite);
  assert.deepEqual(p.receipt.shared, {invite: inv.id, revision: 1, role: 'carrier', slot: 0, phase: 'pending'});
  assert.equal(inv.kind, 'shared'); assert.equal(inv.state, 'pending');
  assert.deepEqual(inv.shared.template, {id: 'carry', version: 1}); assert.equal(inv.shared.revision, 1);
  assert.deepEqual(inv.shared.load, {entity: beam, def: 'core-rack-beam@2', name: inv.shared.load.name});
  assert.equal(w.edge.places.byId.get(inv.shared.destination.place)?.name.toLowerCase(), 'shed');
  assert.deepEqual(inv.shared.roles, [{role: 'carrier', slot: 0, soulId: Ada.soulId}, {role: 'carrier', slot: 1, soulId: null}]);
  assert.deepEqual(inv.shared.crew, [1, 2]); assert.equal(inv.shared.cleanup, 'set-down-here'); assert.equal(inv.shared.op, null);
  // compact discovery (A3): only Bo is offered the acceptance; Ada, Cy and Fy get nothing extra
  const acc = caps(w, Bo).find((c) => c.id === `accept:${inv.id}`);
  assert.ok(acc?.params?.revision, 'Bo is offered accept with a revision');
  assert.deepEqual(caps(w, Ada).filter((c) => c.id.endsWith(inv.id)).map((c) => c.id), [`withdraw:${inv.id}`], 'Ada can only withdraw her own');
  for (const s of [Cy, Fy]) assert.ok(!caps(w, s).some((c) => c.id.endsWith(inv.id)), `${s.name} sees no offer of it`);
  // nobody accepts for Bo: Ada's and Cy's streams are refused, and Bo's receipt is his alone
  for (const s of [Ada, Cy]) assert.equal((await act(w, s, {capability: `accept:${inv.id}`, params: {revision: 1}})).accepted, false);
  // talking is not consent: Ada and Bo in one conversation, and Bo's answer is still open
  const converse = async (s, body) => { w.setCurrent(s); return (await accept(w.f.host, w.app.request('/v1/edge/converse', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}))).json(); };
  const cv = await converse(Ada, {op: 'start', with: [Bo.soulId], text: 'Carry the beam with me?'});
  assert.equal(cv.accepted, true, JSON.stringify(cv));
  assert.equal((await converse(Bo, {op: 'accept', conversation: cv.conversation?.id ?? cv.conversation})).accepted, true);
  ok(await converse(Bo, {op: 'say', conversation: cv.conversation?.id ?? cv.conversation, text: 'Yes, happy to.'}));
  assert.equal(inviteOf(w, inv.id).responses[Bo.soulId], undefined, 'a conversation, even a yes in it, is not an acceptance');
  // nothing moves through the proposal while a role is open: no programme, the same feet (PC05 commits once all accept)
  await w.tick(200);
  for (const s of [Ada, Bo]) {
    assert.equal(w.f.host.engine.programOf(s.entityId), null, `${s.name} runs nothing`);
    assert.ok(Math.hypot(w.pos(s)[0] - before[s.name][0], w.pos(s)[2] - before[s.name][2]) < 1e-6, `${s.name} did not move`);
  }
  // the revision is the agreement (A2): none, stale, then the current one; a repeat returns the same receipt
  assert.equal(code(await act(w, Bo, {capability: `accept:${inv.id}`})), 'capability.params');
  const stale = await act(w, Bo, {capability: `accept:${inv.id}`, params: {revision: 2}});
  assert.equal(code(stale), 'shared.revision-changed'); assert.match(stale.reason, /revision 1/);
  const a = ok(await act(w, Bo, {capability: `accept:${inv.id}`, params: {revision: 1}}));
  assert.equal(a.receipt.phase, 'waiting'); assert.deepEqual(a.receipt.shared, {invite: inv.id, revision: 1, role: 'carrier', slot: 1, phase: 'pending'});
  assert.equal((await act(w, Bo, {capability: `accept:${inv.id}`, params: {revision: 1}})).receipt.id, a.receipt.id);
  assert.equal(w.edge.receipt(Ada.soulId, a.receipt.id), null, 'Bo\'s receipt is read only by Bo');
  assert.equal(inviteOf(w, inv.id).guestReceipts[Bo.soulId], a.receipt.id);
  assert.equal(w.edge.receipt(Ada.soulId, p.receipt.id).awaitingAnswer, undefined, 'nobody is undecided');
  // acceptance is not start: until the next readiness check (no tick has passed) Bo's receipt waits and nothing runs
  assert.equal(w.edge.receipt(Bo.soulId, a.receipt.id).phase, 'waiting'); assert.equal(inviteOf(w, inv.id).shared.op, null);
  for (const s of [Ada, Bo]) assert.equal(w.f.host.engine.programOf(s.entityId), null, `${s.name} runs nothing yet`);
  // a floater cannot accept a carry; full hands cannot either
  const pf = ok(await act(w, Ada, {capability: `carry-with:${w.idOf('beam2')}`, params: {to: 'shed', with: 'Fy'}}));
  assert.equal(w.edge.receipt(Ada.soulId, p.receipt.id).code, 'shared.left', 'a new proposal of Ada\'s ended the first');
  assert.equal(w.edge.receipt(Bo.soulId, a.receipt.id).code, 'shared.left', 'and Bo was told by his own receipt');
  const fi = pf.receipt.shared.invite;
  assert.equal(code(await act(w, Fy, {capability: `accept:${fi}`, params: {revision: 1}})), 'body.unsupported');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('PC04: decline, leave, amend, expiry and other acts end shared receipts deterministically', {timeout: 300000}, async (t) => {
  const w = await world(t, true), {Ada, Bo} = w.souls, beam = w.idOf('beam');
  const propose = async (extra = {}) => ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo', ...extra}}));
  const read = (s, r) => w.edge.receipt(s.soulId, r.receipt?.id ?? r.id);
  // decline: nobody can fill the role, so the proposal closes and Ada's receipt ends
  let p = await propose(), id = p.receipt.shared.invite;
  ok(await act(w, Bo, {capability: `decline:${id}`}));
  assert.equal(inviteOf(w, id).state, 'closed'); assert.equal(read(Ada, p).phase, 'failed'); assert.equal(read(Ada, p).code, 'invite.declined');
  // leave after accepting: decline stays offered and ends Bo's receipt as left
  p = await propose(); id = p.receipt.shared.invite;
  let a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  assert.ok(caps(w, Bo).some((c) => c.id === `decline:${id}`), 'leave is offered after accepting');
  ok(await act(w, Bo, {capability: `decline:${id}`}));
  assert.equal(read(Bo, a).code, 'shared.left'); assert.equal(read(Ada, p).code, 'shared.left'); assert.equal(inviteOf(w, id).responses[Bo.soulId], 'left');
  // the host withdraws: every member's receipt ends, and the guest is told by his own
  p = await propose(); id = p.receipt.shared.invite;
  a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  ok(await act(w, Ada, {capability: `withdraw:${id}`}));
  for (const [s, r] of [[Ada, p], [Bo, a]]) assert.equal(read(s, r).code, 'invite.withdrawn', s.name);
  // another body act by the guest: left, never replaced
  p = await propose(); id = p.receipt.shared.invite;
  a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  ok(await act(w, Bo, {capability: 'wave:here'}));
  assert.equal(read(Bo, a).phase, 'failed'); assert.equal(read(Bo, a).code, 'shared.left');
  // another body act by the host closes the invitation, and every member's receipt ends left (PC02 coordinator test)
  p = await propose(); id = p.receipt.shared.invite;
  a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  ok(await act(w, Ada, {capability: 'wave:here'}));
  assert.equal(inviteOf(w, id).state, 'closed');
  for (const [s, r] of [[Ada, p], [Bo, a]]) {assert.equal(read(s, r).phase, 'failed'); assert.equal(read(s, r).code, 'shared.left', s.name);}
  assert.ok(!caps(w, Bo).some((c) => c.id.endsWith(id)), 'nothing left to answer');
  // amend: a new destination is revision 2; Bo's acceptance of revision 1 ends, and only revision 2 can be accepted
  p = await propose(); id = p.receipt.shared.invite;
  a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}}));
  const same = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo', invite: id}}));
  assert.equal(same.receipt.id, p.receipt.id, 'the same proposal again changes nothing');
  const am = ok(await act(w, Ada, {capability: `carry-with:${beam}`, params: {to: 'yard', with: 'Bo', invite: id}}));
  assert.equal(am.receipt.id, p.receipt.id, 'an amend answers with Ada\'s one shared receipt, not a new carry-with one');
  const amended = inviteOf(w, id);
  assert.equal(amended.shared.revision, 2); assert.match(amended.shared.changed, /destination/); assert.deepEqual(amended.responses, {});
  assert.equal(read(Bo, a).code, 'shared.revision-changed'); assert.equal(read(Ada, p).phase, 'waiting', 'Ada keeps her one receipt');
  assert.deepEqual(read(Ada, p).shared, {invite: id, revision: 2, role: 'carrier', slot: 0, phase: 'pending'}, 'the host\'s receipt follows the amend');
  assert.equal(code(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}})), 'shared.revision-changed');
  a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 2}}));
  // a changed load is revision 3; a crew that drops Bo (now Cy) is revision 4, and Bo's acceptance ends
  ok(await act(w, Ada, {capability: `carry-with:${w.idOf('beam2')}`, params: {to: 'yard', with: 'Bo', invite: id}}));
  assert.equal(inviteOf(w, id).shared.revision, 3); assert.match(inviteOf(w, id).shared.changed, /load/); assert.equal(read(Bo, a).code, 'shared.revision-changed');
  a = ok(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 3}}));
  ok(await act(w, Ada, {capability: `carry-with:${w.idOf('beam2')}`, params: {to: 'yard', with: 'Cy', invite: id}}));
  assert.equal(inviteOf(w, id).shared.revision, 4); assert.match(inviteOf(w, id).shared.changed, /crew/); assert.equal(read(Bo, a).code, 'shared.revision-changed');
  assert.ok(!caps(w, Bo).some((c) => c.id.endsWith(id)), 'Bo is no longer asked');
  a = ok(await act(w, w.souls.Cy, {capability: `accept:${id}`, params: {revision: 4}}));
  // PC05 would commit a ready crew; Cy is moved 13 m from the load (a test relocate, not an act) so it lapses unready
  const b2 = w.f.host.engine.world.entities[w.idOf('beam2')].pose.p; await w.at(w.souls.Cy, b2[0] - 13, b2[2]);
  const still = {Ada: [...w.pos(Ada)], Cy: [...w.pos(w.souls.Cy)]};
  await w.tick(40);
  assert.match(read(Ada, p).reason ?? '', /Cy is 1\d m from/, 'the host\'s receipt says who is not ready'); assert.equal(read(w.souls.Cy, a).code, 'shared.not-ready');
  // expiry: every open member receipt lapses; a late acceptance is refused
  await w.tick(SHARED_LAPSE * 20);
  assert.equal(inviteOf(w, id).state, 'closed');
  for (const [s, r] of [[Ada, p], [w.souls.Cy, a]]) assert.equal(read(s, r).code, 'invite.expired', s.name);
  for (const s of [Ada, w.souls.Cy]) {
    assert.equal(w.f.host.engine.programOf(s.entityId), null, `${s.name} runs nothing through expiry`);
    assert.ok(Math.hypot(w.pos(s)[0] - still[s.name][0], w.pos(s)[2] - still[s.name][2]) < 1e-6, `${s.name} did not move through expiry`);
  }
  const late = await act(w, w.souls.Cy, {capability: `accept:${id}`, params: {revision: 4}});
  assert.equal(late.accepted, false); assert.equal(code(late), 'invite.gone', JSON.stringify(late));
  // full hands: Bo holding the old one-hand beam cannot accept
  const old = w.idOf('old-beam'), pick = ok(await act(w, Bo, {capability: `pick-up:${old}`}));
  for (let n = 0; n < 2000 && ['waiting', 'started'].includes(read(Bo, pick).phase); n++) await w.tick(1);
  assert.equal(read(Bo, pick).phase, 'completed', JSON.stringify(read(Bo, pick)));
  p = await propose(); id = p.receipt.shared.invite;
  assert.equal(code(await act(w, Bo, {capability: `accept:${id}`, params: {revision: 1}})), 'hands.full');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('PC04: flag off offers nothing new; far loads add no offers', {timeout: 240000}, async (t) => {
  const off = await world(t, false), on = await world(t, true);
  // soul and entity ids differ between the two worlds; the offers are compared by verb, words and availability
  const strip = (cs) => JSON.stringify(cs.filter((c) => c.verb !== 'carry-with').map((c) => [c.verb, c.label, c.available, c.blocked?.code ?? null]));
  assert.ok(!caps(off, off.souls.Ada).some((c) => c.verb === 'carry-with'));
  assert.equal(strip(caps(off, off.souls.Ada)), strip(caps(on, on.souls.Ada)), 'flag on changes nothing but the carry-with offers');
  const r = await act(off, off.souls.Ada, {capability: `carry-with:${off.idOf('beam')}`, params: {to: 'shed', with: 'Bo'}});
  assert.equal(r.accepted, false);
  // 100 shared-carry loads 100 m away: no extra offers for Ada
  const [ax, , az] = on.pos(on.souls.Ada), n0 = caps(on, on.souls.Ada).filter((c) => c.verb === 'carry-with').length;
  ok(on.god.act({ops: Array.from({length: 100}, (_, i) => ({op: 'place', def: 'core/rack-beam@2', name: `far-${i}`, p: [ax + 100 + (i % 10) * 3, az + 100 + Math.floor(i / 10) * 3]}))}));
  await on.tick(40);
  assert.equal(caps(on, on.souls.Ada).filter((c) => c.verb === 'carry-with').length, n0);
});
