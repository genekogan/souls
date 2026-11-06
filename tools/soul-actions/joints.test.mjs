// PC12 (#691): a god-built bay of loose uprights and beams on a live server. The entity world holds the reciprocal joints
// and the engine mirrors them as its own connections (installed, a beam supported by what its ends join, the upright's
// stand passed as its roll); a Soul is refused carrying a joined beam before any motion, naming what holds it, and a
// free beam is still carried; a restart (clean or crash, durable clock) brings back the same graph in both; a world
// without connectors sends the engine exactly what it did before.
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
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldHost} from '../../apps/server/src/world.ts';
import {entityCorners} from '../../mars/viewer/engine/spatial/service.ts';

const IN = 0.0254, T = 3 * IN, UP_L = 12 * 0.3048, BEAM_L = 9 * 0.3048, BEAM_H = 4 * IN, ZC = 2 * 0.3048 - 1.5 * IN, GAP = 0.001;
const seat = (i) => 12 * IN + 6 * IN * i;
/** Two uprights standing face to face and four beams at seats 4 and 12, joined, with A's base centre at (x0, z0). */
function bay(x0, z0, name = 'bay') {
  const bx = x0 - 2 * T - BEAM_L - 2 * GAP, ops = [
    {op: 'place', tmp: '$a', name: `${name}-upright-a`, def: 'core/rack-upright@2', p: [x0, UP_L / 2, z0], r: [0, 0, Math.PI / 2], anchor: 'center'},
    {op: 'place', tmp: '$b', name: `${name}-upright-b`, def: 'core/rack-upright@2', p: [bx, UP_L / 2, z0], r: [Math.PI, 0, Math.PI / 2], anchor: 'center'},
  ];
  for (const i of [4, 12]) for (const [dz, aSide, bSide] of [[-ZC, 'l', 'r'], [ZC, 'r', 'l']]) {
    const t = `$b${i}${aSide}`;
    ops.push({op: 'place', tmp: t, name: `${name}-beam-${i}${aSide}`, def: 'core/rack-beam@3', p: [x0 - T - GAP - BEAM_L / 2, seat(i) - BEAM_H / 2, z0 + dz], r: 0, anchor: 'center'});
    ops.push({op: 'connect', a: {id: t, connector: 'end-r'}, b: {id: '$a', connector: `front-${aSide}-${i}`}});
    ops.push({op: 'connect', a: {id: t, connector: 'end-l'}, b: {id: '$b', connector: `front-${bSide}-${i}`}});
  }
  return ops;
}
function mount(w, host, db) {
  const edge = new EdgeLedger(host, db, undefined, {ambient: false, sharedCarry: w.sharedCarry ?? true}), app = new Hono();
  const comms = mountEdgeRoutes(app, {host, db, souls: w.f.souls, ledger: edge, soul: () => w.soul});
  const god = new GodMode(db, {worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {}});
  installEngineBridge({host, god, edge, log() {}, worldLore: false, worldClock: false});
  Object.assign(w, {host, db, edge, comms, god});
}
async function world(t, sharedCarry = true) {
  const dir = mkdtempSync(join(tmpdir(), 'pc12-joints-')), path = join(dir, 'sim.db'), opts = {durableClockV1: true};
  const f = fixture(path, factory, opts); f.brain.quiesce();
  const w = {f, path, opts, hosts: [f.host], sharedCarry};
  t.after(() => { try { w.comms?.close(); } catch {} for (const h of w.hosts) try { h.stop(); } catch {} try { if (w.db.db.isOpen) w.db.close(); } catch {} rmSync(dir, {recursive: true, force: true}); });
  mount(w, f.host, f.db);
  w.tick = async (n = 5) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  await w.tick(); await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Joints test'}));
  w.soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await w.tick();
  [w.ax, , w.az] = f.host.engine.world.entities[w.soul.entityId].pose.p;
  w.idOf = (n) => w.god.model.get(n).id;
  return w;
}
async function restart(w, clean) {
  w.comms.close(); w.host.stop();
  if (clean) { w.host.drainInputs(); w.host.saveSnapshot(true); }
  w.db.close();
  const db = new Db(w.path), h = new WorldHost(db, factory, seed, 1e9, worldId, w.opts), boot = h.boot(); h.drainInputs();
  w.hosts.push(h); mount(w, h, db);
  return boot;
}
const ok = (r) => { assert.notEqual(r.accepted, false, JSON.stringify(r)); return r; };
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
/** The graph as the entity world holds it, and as the engine mirrors it (connections, phase, support, pose). */
const graph = (w) => {
  const model = [...w.god.model.entities.values()].filter((e) => e.joins).map((e) => [e.id, e.joins]).sort();
  const ents = w.host.engine.world.entities;
  const engine = model.map(([id]) => [id, {connections: ents[id].connections, phase: ents[id].phase, support: ents[id].support, pose: ents[id].pose}]);
  return {model, engine};
};
const worldEdits = (w) => w.db.db.prepare("SELECT payload FROM events WHERE kind='world-edit' ORDER BY seq").all().map((r) => r.payload);

test('PC12 A1c/A1d/A3c: the engine mirrors the joints; a joined beam is refused before motion, a free beam is carried; nothing changes without connectors', {timeout: 180000}, async (t) => {
  const w = await world(t);
  // long tail: a scene of things without connectors (zone, the older loose beam, a pallet rack) sends no joint data
  ok(w.god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[w.ax + 5, w.az - 3], [w.ax + 10, w.az - 3], [w.ax + 10, w.az + 3], [w.ax + 5, w.az + 3]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'old-beam', p: [w.ax - 4, w.az + 6]},
    {op: 'place', def: 'core/pallet-rack@1', name: 'rack', p: [w.ax - 12, w.az - 10]},
  ]}));
  await w.tick(30);
  const plain = worldEdits(w);
  assert.ok(plain.length > 0 && plain.every((p) => !/"connections"|"roll"|"connected"/.test(p)), 'no joint data for a world without connectors');
  const plainBytes = plain.reduce((n, p) => n + p.length, 0);
  // the bay a few metres from Ana, and a free beam on the ground beside her
  const built = ok(w.god.act({ops: [...bay(w.ax - 2, w.az - 4), {op: 'place', def: 'core/rack-beam@3', name: 'free-beam', p: [w.ax + 2, w.az + 1.5]}]}));
  await w.tick(30);
  const bayBytes = worldEdits(w).slice(plain.length).reduce((n, p) => n + p.length, 0);
  t.diagnostic(`world-edit bytes: scene without connectors ${plainBytes}; the bay (6 parts, 8 joints) and a free beam ${bayBytes}`);
  const ents = w.host.engine.world.entities, A = w.idOf('bay-upright-a'), B = w.idOf('bay-upright-b');
  for (const u of [A, B]) {
    const e = ents[u];
    assert.equal(e.phase, 'installed'); assert.deepEqual(e.support, {kind: 'ground'});
    assert.ok(near(e.pose.roll, Math.PI / 2), `standing: roll ${e.pose.roll}`);
    const ys = entityCorners(e).map((c) => c[1]);
    assert.ok(near(Math.min(...ys), 0, 0.03) && near(Math.max(...ys), UP_L, 0.03), `the engine's box stands 0..${UP_L.toFixed(2)} m: ${Math.min(...ys)}..${Math.max(...ys)}`);
    assert.equal(e.connections.length, 4);
  }
  for (const i of [4, 12]) for (const s of ['l', 'r']) {
    const id = w.idOf(`bay-beam-${i}${s}`), e = ents[id], m = w.god.model.entities.get(id);
    assert.equal(e.phase, 'installed');
    assert.deepEqual(e.support, {kind: 'connected', to: [...new Set(Object.entries(m.joins).sort().map(([, j]) => j.to))]});
    assert.deepEqual([...e.connections].sort((a, b) => a.socket < b.socket ? -1 : 1), Object.entries(m.joins).map(([c, j]) => ({socket: c, to: j.to, toSocket: j.at})).sort((a, b) => a.socket < b.socket ? -1 : 1));
    for (const c of e.connections) assert.ok(ents[c.to].connections.some((x) => x.socket === c.toSocket && x.to === id && x.toSocket === c.socket), 'reciprocal in the engine');
    assert.ok(near(e.pose.p[1], seat(i) - BEAM_H / 2), `held at its seat height (${e.pose.p[1]})`);
    assert.equal(m.in.parent, 'world');
  }
  void built;
  // a Soul: the joined beam is offered unavailable, carry.joined names both uprights; acting it is refused and nothing moves
  const caps = () => w.edge.capabilities(w.soul), joined = w.idOf('bay-beam-4l');
  const jc = caps().find((c) => c.id === `carry:${joined}`);
  assert.equal(jc?.available, false, JSON.stringify(jc)); assert.equal(jc.blocked.code, 'carry.joined');
  assert.match(jc.blocked.reason, /is joined to bay upright a and bay upright b \(end-r to front-l-4, end-l to front-r-4\)/);
  const before = structuredClone(ents[joined].pose);
  const refused = await accept(w.host, w.edge.act(w.soul, {capability: `carry:${joined}`, params: {to: 'yard'}}));
  assert.equal(refused.accepted, false); assert.equal(refused.error?.code ?? refused.code, 'carry.joined', JSON.stringify(refused));
  // the engine refuses it too, on its own: an installed part is not a load lying on the ground
  const native = w.host.engine.previewMarsVerbV1('carry', {crew: [w.soul.entityId], item: joined, to: {x: w.ax + 7, z: w.az, yaw: 0}});
  assert.equal(native?.code, 'carry.item-unavailable', JSON.stringify(native));
  await w.tick(20); assert.deepEqual(ents[joined].pose, before);
  // the free beam of the same revision is still carried to the yard
  const free = w.idOf('free-beam'), fc = caps().find((c) => c.id === `carry:${free}`);
  assert.ok(fc?.available, JSON.stringify(fc));
  const r = ok(await accept(w.host, w.edge.act(w.soul, {capability: `carry:${free}`, params: {to: 'yard'}})));
  for (let k = 0; k < 3000; k++) { const p = w.edge.receipt(w.soul.soulId, r.receipt.id)?.phase; if (['failed', 'completed', 'replaced'].includes(p)) break; await w.tick(1); }
  assert.equal(w.edge.receipt(w.soul.soulId, r.receipt.id).phase, 'completed');
  assert.deepEqual(ents[joined].pose, before, 'the bay never moved');
});

for (const clean of [true, false]) test(`PC12 A2c: a ${clean ? 'clean' : 'crash'} restart brings back the same graph in the entity world and the engine`, {timeout: 120000}, async (t) => {
  const w = await world(t);
  ok(w.god.act({ops: bay(w.ax - 2, w.az - 4)}));
  await w.tick(30);
  // a released joint too: the god takes one beam off (both ends) and lays it on the ground, so the graph has history
  const off = w.idOf('bay-beam-12r');
  ok(w.god.act({ops: [{op: 'disconnect', a: {id: off, connector: 'end-l'}}, {op: 'disconnect', a: {id: off, connector: 'end-r'}}, {op: 'move', id: off, p: [w.ax + 3, w.az + 3], r: 0}]}));
  await w.tick(30);
  const g = graph(w);
  assert.equal(g.model.length, 5, 'two uprights and three joined beams');
  assert.equal(w.host.engine.world.entities[off].connections, undefined); assert.equal(w.host.engine.world.entities[off].phase, 'staged');
  const boot = await restart(w, clean); await w.tick(10);
  t.diagnostic(`boot ${JSON.stringify(boot).slice(0, 160)}`);
  assert.deepEqual(graph(w), g, 'the same joints, connections, phases, supports and poses');
  // still refused after the boot, and the god's refusals still hold
  const u = w.idOf('bay-upright-a');
  const removed = w.god.act({ops: [{op: 'remove', id: u}]});
  assert.equal(removed.accepted, false); assert.equal(removed.failures[0].code, 'support.none');
});

const kitBox = (b, shapes) => ({make: {kind: 'gen', gen: 'kit/2', args: {shapes}}, size: {box: b}});
/** A god's own kit: a small carryable post (one hole) and a rail that bears on two of them. */
const postKit = (x, z) => [
  {op: 'define', def: {schema: 'def/1', name: 'lift-post', version: 1, tags: ['post'], ...kitBox([0.1, 1.2, 0.1], [{kind: 'box', at: [0, 0.6, 0], size: [0.1, 1.2, 0.1]}]),
    components: {carryable: {mass: 1, grips: 1}, connectors: [{id: 'hole', kind: 'peg-hole', at: [0.05, 1.0, 0], mates: ['peg']}]}}},
  {op: 'define', def: {schema: 'def/1', name: 'lift-rail', version: 1, tags: ['shelf'], ...kitBox([1.0, 0.05, 0.3], [{kind: 'box', at: [0, 0.025, 0], size: [1.0, 0.05, 0.3]}]),
    components: {connectors: [{id: 'west', kind: 'peg', at: [-0.5, 0.025, 0], mates: ['peg-hole'], bears: true}, {id: 'east', kind: 'peg', at: [0.5, 0.025, 0], mates: ['peg-hole'], bears: true}]}}},
  {op: 'place', tmp: '$w', name: 'post-w', def: 'lift-post@1', p: [x - 0.55, z], r: 0}, {op: 'place', tmp: '$e', name: 'post-e', def: 'lift-post@1', p: [x + 0.55, z], r: Math.PI},
  {op: 'place', tmp: '$s', name: 'rail', def: 'lift-rail@1', p: [x, 1.0 - 0.025, z], r: 0, anchor: 'center'},
  {op: 'connect', a: {id: '$s', connector: 'west'}, b: {id: '$w', connector: 'hole'}}, {op: 'connect', a: {id: '$s', connector: 'east'}, b: {id: '$e', connector: 'hole'}},
];

test('PC12 review: a small joined part is not picked up off its joints; once disconnected it is', {timeout: 180000}, async (t) => {
  const w = await world(t);
  ok(w.god.act({ops: postKit(w.ax + 1.2, w.az)})); await w.tick(30);
  const post = w.idOf('post-w'), cap = () => w.edge.capabilities(w.soul).find((c) => c.id === `pick-up:${post}`);
  assert.equal(cap()?.available, false, JSON.stringify(cap())); assert.equal(cap().blocked.code, 'carry.joined');
  assert.match(cap().blocked.reason, /post w is joined to rail \(hole to west\)/);
  const before = structuredClone(w.host.engine.world.entities[post].pose);
  const refused = await accept(w.host, w.edge.act(w.soul, {capability: `pick-up:${post}`}));
  assert.equal(refused.accepted, false, JSON.stringify(refused).slice(0, 300)); assert.equal(refused.code, 'carry.joined');
  await w.tick(20);
  assert.deepEqual(w.host.engine.world.entities[post].pose, before, 'nothing moved'); assert.notEqual(w.host.engine.world.entities[post].support?.kind, 'in-hand');
  assert.equal(w.god.model.entities.get(post).joins.hole.to, w.idOf('rail'));
  // disconnected (and the rail lifted off with it, so nothing hangs): offered and picked up as before
  ok(w.god.act({ops: [{op: 'disconnect', a: {id: post, connector: 'hole'}}, {op: 'remove', id: w.idOf('rail')}]})); await w.tick(30);
  assert.equal(cap()?.available, true, JSON.stringify(cap()));
});

test('PC12 review: with SIM_SHARED_CARRY off the world-edit carries no joint fields; the entity world still refuses a joined part', {timeout: 180000}, async (t) => {
  const w = await world(t, false);
  const n0 = worldEdits(w).length;
  ok(w.god.act({ops: [...bay(w.ax - 2, w.az - 4), ...postKit(w.ax + 1.2, w.az)]})); await w.tick(30);
  const edits = worldEdits(w).slice(n0);
  assert.ok(edits.length > 0 && edits.every((p) => !/"connections"|"roll"|"connected"/.test(p)), 'no joint fields in world-edit/1 with the flag off');
  const ents = w.host.engine.world.entities, beam = w.idOf('bay-beam-4l');
  assert.equal(ents[beam].connections, undefined);
  assert.ok(Object.keys(w.god.model.entities.get(beam).joins).length === 2, 'the entity world keeps the joints');
  const caps = w.edge.capabilities(w.soul);
  assert.equal(caps.find((c) => c.id === `carry:${beam}`)?.blocked?.code, 'carry.joined');
  assert.equal(caps.find((c) => c.id === `pick-up:${w.idOf('post-w')}`)?.blocked?.code, 'carry.joined');
});
