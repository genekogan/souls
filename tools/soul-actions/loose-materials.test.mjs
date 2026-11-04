// PC03 (#682): loose construction materials keep the native materials' handling and move through the native carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {CATALOG} from '../../mars/viewer/engine/world/catalog.ts';
import {formationFor} from '../../mars/viewer/engine/carry/formation.ts';
import {coreLibrary} from '../../packages/world-compiler/src/index.ts';

// each new def against the native material it carries: native grips are mapped into the def frame (+x along)
const NATIVE = {'core-rack-beam@2': 'beam-9ft', 'core-rack-upright@1': 'upright-12ft', 'core-plywood-sheet@1': 'plywood-4x8'};
const along = (native, g) => native.category === 'rack-upright' ? [g.local[1] - native.size[1] / 2, g.local[2], -g.local[0]] : g.local;
const size = (native) => native.category === 'rack-upright' ? [native.size[1], native.size[2], native.size[0]] : native.size;
const near = (a, b, msg) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-3, `${msg}: ${a} vs ${b}`));

test('loose materials are new immutable revisions carrying the native handling; core-rack-beam@1 is byte-identical', () => {
  const lib = coreLibrary();
  for (const [ref, id] of Object.entries(NATIVE)) {
    const d = lib.get(ref), n = CATALOG[id], h = d.components.carryable.handling;
    assert.ok(d, ref);
    near(d.size.box, size(n), `${ref} size`);
    assert.equal(d.components.carryable.mass, n.massKg, `${ref} mass`);
    assert.deepEqual(h.crew, n.handling.carryCrew, `${ref} crew`);
    assert.equal(h.height, n.handling.carryHeight, `${ref} hand height`);
    assert.equal(h.pose, n.category === 'rack-upright' ? 'flat' : n.handling.carryPose, `${ref} pose`);
    for (let k = h.crew[0]; k <= h.crew[1]; k++) {
      assert.equal(h.grips[k]?.length, n.handling.grips[k].length, `${ref} grips for ${k}`);
      h.grips[k].forEach((g, i) => near(g, along(n, n.handling.grips[k][i]), `${ref} grip ${k}.${i}`));
    }
    assert.ok(d.tags.includes('loose-material') && d.tags.includes('shared-carry'));
  }
  const old = JSON.parse(execFileSync('git', ['show', 'df69a3ca:packages/world-compiler/src/core-kit/work.json'], {encoding: 'utf8'}));
  const now = lib.get('core-rack-beam@1'), was = old.find((d) => d.name === 'core-rack-beam');
  assert.equal(now.components.carryable.mass, was.components.carryable.mass);
  assert.equal(now.components.carryable.handling, undefined);
  assert.deepEqual(now.size.box, was.size.box);
  // the frozen revision's content hash is the one on main at df69a3ca
  assert.equal(now.hash, '8e6154af4d4d047880f4221c0bb287011aa61e0418d6c2d25a47b05a3fd59505');
});

test('a light loose material is carried solo with both hands by the native carry; a heavy one names its crew and is refused before motion', {timeout: 120000}, async (t) => {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  const ok = (r) => { assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  await tick(); await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Loose material test'}));
  soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
  const b = f.host.engine.world.entities[soul.entityId], ax = b.pose.p[0], az = b.pose.p[2];
  ok(god.act({ops: [
    {op: 'place', def: 'core/zone@1', name: 'yard', shape: {area: [[ax + 5, az - 3], [ax + 10, az - 3], [ax + 10, az + 3], [ax + 5, az + 3]]}},
    {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
    {op: 'place', def: 'core/plywood-sheet@1', name: 'sheet', p: [ax + 2, az - 2]},
    {op: 'place', def: 'core/rack-upright@1', name: 'frame', p: [ax - 3, az]},
    {op: 'place', def: 'core/rack-beam@1', name: 'old-beam', p: [ax - 1, az + 3]},
  ]}));
  await tick(60);
  const caps = () => edge.capabilities(soul), idOf = (n) => god.model.get(n).id;
  const finish = async (r) => { for (let n = 0; n < 3000; n++) { const p = edge.receipt(soul.soulId, r.receipt.id)?.phase; if (['failed', 'completed', 'replaced'].includes(p)) break; await tick(1); } return edge.receipt(soul.soulId, r.receipt.id); };
  // the old revision keeps its one-hand pick-up; the new materials are never one-hand items
  // independent of the def's own numbers: the adapted asset's carrier formation equals the native material's for every
  // crew size (along the load and side), so a crew stands where it would at the engine's own beam, frame or sheet
  for (const [n, nat] of [['beam', 'beam-9ft'], ['frame', 'upright-12ft'], ['sheet', 'plywood-4x8']]) {
    const adapted = f.host.engine.world.entities[idOf(n)].def, [lo, hi] = CATALOG[nat].handling.carryCrew;
    for (let k = lo; k <= hi; k++) formationFor(adapted, k).carriers.forEach((c, i) => {
      const w = formationFor(nat, k).carriers[i];
      assert.ok(Math.abs(c.along - w.along) < 1e-3 && c.side === w.side, `${n} crew ${k} slot ${i}: ${JSON.stringify(c)} vs ${JSON.stringify(w)}`);
    });
  }
  // the new materials are recorded native transports (the viewer draws their carried pose); the old one-hand beam is not
  for (const n of ['beam', 'sheet', 'frame']) assert.ok(f.host.engine.world.entities[idOf(n)].tags.includes('entity-world-transport'), n);
  assert.ok(!f.host.engine.world.entities[idOf('old-beam')].tags.includes('entity-world-transport'));
  assert.ok(caps().some((c) => c.id === `pick-up:${idOf('old-beam')}`), 'core-rack-beam@1 keeps its one-hand path');
  for (const n of ['beam', 'sheet', 'frame']) assert.ok(!caps().some((c) => c.id === `pick-up:${idOf(n)}`), `${n} is not a one-hand item`);
  // heavy: offered, unavailable, names the crew; acting it is refused and nothing moves
  const frame = idOf('frame'), fc = caps().find((c) => c.id === `carry:${frame}`), before = structuredClone(f.host.engine.world.entities[frame].pose);
  assert.equal(fc?.available, false); assert.equal(fc.blocked.code, 'carry.crew-too-small'); assert.match(fc.blocked.reason, /needs 2 carriers/);
  const refused = await accept(f.host, edge.act(soul, {capability: `carry:${frame}`, params: {to: 'yard'}}));
  assert.equal(refused.accepted, false); assert.equal(refused.error?.code ?? refused.code, 'carry.crew-too-small', JSON.stringify(refused));
  await tick(20); assert.deepEqual(f.host.engine.world.entities[frame].pose, before);
  // light: two-hand native carry to the yard, raised on the way, laid inside it
  const runs = [];
  for (const n of ['beam', 'sheet']) {
    const id = idOf(n), c = caps().find((x) => x.id === `carry:${id}`);
    assert.ok(c?.available, JSON.stringify(caps().filter((x) => x.verb === 'carry')));
    // the beam goes through the words an owner's agent would use; the world resolves them to the carry offer
    const r = ok(await accept(f.host, edge.act(soul, {capability: n === 'beam' ? 'carry the beam' : `carry:${id}`, params: {to: 'yard'}})));
    assert.equal(r.receipt.capability, `carry:${id}`);
    let raised = 0, crewed = false;
    for (let k = 0; k < 3000; k++) {
      const load = f.host.engine.world.entities[id];
      raised = Math.max(raised, load.pose.p[1]); crewed ||= load.phase === 'carried' && f.host.engine.world.entities[soul.entityId].human?.grip?.entity === id;
      const p = edge.receipt(soul.soulId, r.receipt.id)?.phase; if (['failed', 'completed', 'replaced'].includes(p)) break;
      await tick(1);
    }
    const done = await finish(r), end = f.host.engine.world.entities[id];
    assert.equal(done.phase, 'completed', JSON.stringify(done));
    assert.match(done.outcome.summary, new RegExp(`^Carried ${n} and laid it on the ground in Yard`), done.outcome.summary);
    assert.ok(crewed, `${n} was carried by Ana (native support)`);
    assert.ok(raised > 0.5, `${n} rose to hand height (${raised})`);
    assert.ok(end.pose.p[0] > ax + 5 - 0.6 && end.pose.p[0] < ax + 10 + 0.6, `${n} laid in the yard (${end.pose.p})`);
    assert.ok(Math.abs(end.pose.p[1]) < 0.05, `${n} lies on the ground`);
    runs.push({n, raised: +raised.toFixed(3), end: end.pose.p.map((v) => +v.toFixed(2))});
    if (n === 'beam') { ok(god.act({ops: [{op: 'move', id, p: [ax + 12, az + 4]}]})); await tick(25); }
  }
  // the god model holds where the native carry left them (the write-back), so a save/reload keeps it
  const sheet = idOf('sheet'), wp = god.model.worldPose(god.model.get('sheet')), eng = f.host.engine.world.entities[sheet].pose.p;
  assert.ok(Math.hypot(wp.x - eng[0], wp.z - eng[2]) < 0.05, `model ${wp.x},${wp.z} vs engine ${eng}`);
  assert.deepEqual(f.host.engine.runtime.violations, []);
  console.log(JSON.stringify({runs}));
});
