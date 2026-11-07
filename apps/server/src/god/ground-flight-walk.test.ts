// A flight whose two ends both stand on the ground (level 0 -> level 0: up a bank onto a raised terrace). Lane SW found
// that on ground worlds, paged and unpaged, the walk planner never used one: a level-0 -> level-0 walk goes through the
// coarse ground search, which walks no links, so a god-placed stairs/1 up a bank was never walked although connectivity
// (and the nav audit) counted it as joining the terrace to the ground. Fixed in mars/viewer/engine/spatial/tiled.ts
// groundLinkDetour: only when the coarse search finds no way, the nearest usable ground flights are tried.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {fixture, factory, invite, accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost} from './ground-host.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
function world(t: TestContext, paged: boolean) {
  const was = process.env.NAV_PAGED;
  process.env.NAV_PAGED = paged ? '1' : '0';
  const w = fixture(':memory:', factory, {durableClockV1: true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); if (was === undefined) delete process.env.NAV_PAGED; else process.env.NAV_PAGED = was;});
  const settle = async (n = 4) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  const until = async (pred: () => boolean, n = 12000) => {
    for (let i = 0; i < n && !pred(); i++) {w.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); w.host.drainInputs();}}
    await settle(2); return pred();
  };
  const act = (ops: any[]) => {const r = god.act({ops}) as any; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
  return {...w, god, bridge, settle, until, act, E: w.host.engine as any};
}

const STAIR = {schema: 'def/1', name: 'bank-stair', version: 1, description: 'A straight stone flight 1.6 m up a bank.', tags: ['stairs'], form: 'point', size: {box: [1.2, 1.6, 2.4]},
  make: {kind: 'gen', gen: 'stairs/1'}, params: {rise: {type: 'number', min: 0.3, max: 12, default: 1.6}, run: {type: 'number', min: 0.5, max: 20, default: 2.4},
    width: {type: 'number', min: 0.6, max: 6, default: 1.2}, material: {type: 'enum', values: ['wood', 'stone', 'metal'], default: 'stone'}},
  components: {foundation: {kind: 'none'}}};

const BENCH: Vec2 = [25, 0], LAWN: Vec2 = [25, 10];
/** The terrace (10 x 10 m, 1.6 m up; its top ends at z = 4, its bank falls to the ground by z = 5) and the flight up its
 *  north bank: foot on the ground at z 6, head 0.4 m inside the terrace top's edge (z 3.6), the treads set into the bank
 *  below it. Both ends are on level 0. */
const TERRACE = [{op: 'place', def: coreRef('plateau'), name: 'terrace', shape: {area: [[20, -5], [30, -5], [30, 5], [20, 5]]}, params: {height: 1.6, edge: 1}}];
const FLIGHT = [{op: 'define', def: STAIR}, {op: 'place', def: 'bank-stair@1', name: 'bank-stair', p: [25, 4.8]}];

for (const paged of [true, false]) {
  test(`a god's stairs/1 up a bank onto a terrace: walked up and back down (${paged ? 'paged' : 'unpaged'} ground)`, {timeout: 300_000}, async t => {
    const w = world(t, paged); await w.settle(2);
    assert.equal(w.E.world.groundV1?.nav === 'paged/1', paged, 'the ground navigates as asked');
    w.act(TERRACE); await w.settle(4);
    const g = (p: Vec2) => w.god.model.terrain.sample(p[0], p[1]);
    assert.ok(Math.abs(g(BENCH) - 1.6) < 0.01 && Math.abs(g(LAWN)) < 0.01, 'a terrace 1.6 m above the lawn');
    assert.equal(w.E.reachV1({p: LAWN}, {p: BENCH}).ok, false, 'no walk onto the terrace without a flight');
    w.act(FLIGHT); await w.settle(4);
    const flight = w.E.world.entityPhysicsV1.byEntity[w.god.model.get('bank-stair')!.id].links[0];
    assert.ok(flight?.usable, 'the flight is a usable link');
    assert.equal(flight.from.level, 0); assert.equal(flight.to.level, 0, 'both ends on the ground (level 0)');
    // the planner: up the flight and back down, near (one window) and from 80 m away (paged: a chunk toward the flight)
    for (const [a, b] of [[LAWN, BENCH], [BENCH, LAWN], [[25, 80] as Vec2, BENCH], [BENCH, [25, 80] as Vec2]] as [Vec2, Vec2][]) {
      const r = w.E.reachV1({p: a}, {p: b});
      assert.equal(r.ok, true, `${a} -> ${b}: ${JSON.stringify(r)}`);
    }
    // a resident walks from the lawn up the flight onto the terrace and back down, and up again from 80 m away
    await invite(w, 'dee');
    const row: any = await accept(w.host, w.souls.create('dev:dee', {name: 'Dee', description: 'likes a view'}));
    await w.settle(3);
    const b = () => w.E.world.entities[row.entity_id];
    const at = (p: Vec2) => Math.hypot(b().pose.p[0] - p[0], b().pose.p[2] - p[1]) < 0.6;
    const walk = async (p: Vec2) => {
      await accept(w.host, w.host.enqueue('decision', `test:${row.id}`, {soulId: row.id, entityId: row.entity_id, option: 'test:walk', label: 'walk', steps: [{verb: 'mars:walk_to', params: {x: p[0], z: p[1], level: 0}}], reevalTicks: 1e9, fallback: false, trigger: 'test:walk'}));
      return w.until(() => at(p) && b().human.activity !== 'walk');
    };
    const relocate = (p: Vec2) => accept(w.host, w.host.enqueue('edge-relocate', 'test:start', {soulId: row.id, entityId: row.entity_id, to: p, why: 'start here'}));
    await relocate(LAWN); await w.settle(2);
    assert.ok(at(LAWN) && Math.abs(b().pose.p[1]) < 0.1, `on the lawn: ${JSON.stringify(b().pose.p)}`);
    assert.ok(await walk(BENCH), `up on the terrace: ${JSON.stringify(b().pose.p)}`);
    assert.ok(Math.abs(b().pose.p[1] - 1.6) < 0.1, `standing at the terrace's height: ${b().pose.p[1]}`);
    assert.ok(await walk(LAWN), `back down on the lawn: ${JSON.stringify(b().pose.p)}`);
    assert.ok(Math.abs(b().pose.p[1]) < 0.1, `at the lawn's height: ${b().pose.p[1]}`);
    await relocate([25, 80]); await w.settle(2);
    assert.ok(await walk(BENCH), `up on the terrace from 80 m away: ${JSON.stringify(b().pose.p)}`);
    assert.ok(Math.abs(b().pose.p[1] - 1.6) < 0.1, `standing at the terrace's height: ${b().pose.p[1]}`);
  });
}

// Routes the coarse ground search already finds are planned exactly as before the detour: these hashes are the routes'
// bytes on 3.59.4 (37a5017b4, no detour), on the open lawn, round the terrace's foot, along its top and 80-150 m away
// (paged: chunked with `rest`), with the flight in place. The detour runs only when the coarse search finds no way.
const SAME: [Vec2, Vec2][] = [[[25, 10], [40, 10]], [[15, 0], [35, 0]], [[25, -10], [25, 10]], [[22, -2], [28, 3]], [[25, 2], [22, -3]],
  [[0, 0], [60, 60]], [[25, 80], [25, 12]], [[-60, -40], [70, 40]], [[100, 0], [-30, 20]], [[18, 6.5], [32, 6.5]]];
const GOLDEN: Record<string, string> = {paged: 'd680d57d10576e8cb7a612f2c84e6f24d9e27f05f37fbdd718a4de112679a114', unpaged: '3e8ac78ca93ad2212bcf3c2208edfe86e2bbd9e86702466a6fe9d6a41a967f3c'};
for (const paged of [true, false]) {
  test(`routes the coarse search already finds are byte-identical to 3.59.4 (${paged ? 'paged' : 'unpaged'} ground)`, {timeout: 300_000}, async t => {
    const w = world(t, paged); await w.settle(2);
    w.act(TERRACE); w.act(FLIGHT); await w.settle(4);
    const {HUMAN_PROFILE} = await import('../../../../mars/viewer/engine/spatial/types.ts');
    const {createHash} = await import('node:crypto');
    const spatial = w.E.rt.services.spatial, h = createHash('sha256');
    for (const [a, b] of SAME) {
      const r = spatial.route(w.E.rt.world, HUMAN_PROFILE, {level: 0, p: a}, {level: 0, p: b}, {proveUnreachable: true});
      assert.equal(r.ok, true, `${a} -> ${b}: ${JSON.stringify(r).slice(0, 300)}`);
      h.update(JSON.stringify(r.route)); h.update('\n');
    }
    const got = h.digest('hex');
    if (process.env.GLINK_PRINT) console.log('GOLDEN', paged ? 'paged' : 'unpaged', got);
    assert.equal(got, GOLDEN[paged ? 'paged' : 'unpaged']);
  });
}
