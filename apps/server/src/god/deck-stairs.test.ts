// A raised deck is a floor residents climb onto. Harvest 2026-10-18 (library stair-ramp-ladder, SKIPPED.md): a deck/1
// 1.6 m up and a stairs/1 flight of the same rise against its edge: `reach` up the stairs failed "level 1 has no standing
// room" (the deck was a level-0 slab at 1.6 m, the flight's head a level of its own with only its head tread), and the
// deck's rails closed every edge, so even a stair onto the slab could not be walked back down. Now a deck high enough
// for rails is a level of its own, the rail opens where another thing's stair lands on it, and nobody is routed under
// a deck too low to stand beneath.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {fixture, factory, invite, accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost} from './ground-host.ts';
import {VerifyUse} from './verify-use.ts';
import {runQuery} from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(t: TestContext, {ground = false} = {}) {
  const w = fixture(':memory:', factory, {durableClockV1: true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  if (ground) new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  const verify = new VerifyUse(w.host, w.souls, god, edge);
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close();});
  const settle = async (n = 4) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  const drive = async <T>(work: Promise<T>, ms = 60_000): Promise<T> => {
    let done = false; void work.then(() => {done = true;}, () => {done = true;});
    const deadline = performance.now() + ms;
    while (!done && performance.now() < deadline) {for (let i = 0; i < 4; i++) w.host.tickOnce(); await new Promise(r => setTimeout(r, 1));}
    assert.ok(done, 'bounded probe walk'); return work;
  };
  const until = async (pred: () => boolean, n = 6000) => {
    for (let i = 0; i < n && !pred(); i++) {w.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); w.host.drainInputs();}}
    await settle(2); return pred();
  };
  const reach = (from: unknown, to: unknown) => runQuery(god.model, {reach: {from, to}} as any).reach as any;
  return {...w, god, edge, bridge, verify, settle, drive, until, reach};
}

const STAIR = {schema: 'def/1', name: 'deck-stair', version: 1, description: 'A straight wooden stair 1.6 m up.', tags: ['stairs'], form: 'point', size: {box: [1.1, 1.6, 2.4]},
  make: {kind: 'gen', gen: 'stairs/1'}, params: {rise: {type: 'number', min: 0.3, max: 12, default: 1.6}, run: {type: 'number', min: 0.5, max: 20, default: 2.4}}};
/** The harvest repro: a 6×4 deck 1.6 m up around (0, -5) and the flight against its south edge (head at z −3). */
const DECK_AND_STAIR = {ops: [
  {op: 'define', def: STAIR},
  {op: 'place', def: coreRef('deck'), name: 'deck', shape: {area: [[-3, -7], [3, -7], [3, -3], [-3, -3]]}, params: {height: 1.6}},
  {op: 'place', def: 'deck-stair@1', name: 'stair', p: [0, -1.8]},
]};

for (const ground of [false, true]) {
  test(`a stair onto a 1.6 m deck: the deck is a floor, the rail opens at the stair head, a resident walks up and back down${ground ? ' (ground world)' : ''}`, {timeout: 180_000}, async t => {
    const w = world(t, {ground}); await w.settle(2);
    const r = w.god.act(DECK_AND_STAIR as any) as any;
    assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600));
    await w.settle();
    const E = w.host.engine as any, ep = E.world.entityPhysicsV1;
    const deck = ep.byEntity[w.god.model.get('deck')!.id], stair = ep.byEntity[w.god.model.get('stair')!.id];
    const floor = deck.surfaces[0], flight = stair.links[0];
    assert.ok(floor.level > 0 && Math.abs(floor.y - 1.6) < 0.01, `the deck is a floor of its own at 1.6 m: ${JSON.stringify(floor)}`);
    assert.equal(flight.to.level, floor.level, 'the flight lands on the deck floor');
    // the south rail (along z = −3) is cut round the head (x = 0); the other three edges keep theirs
    const rails = deck.solids.filter((o: any) => o.label.endsWith(' rail'));
    const southPieces = rails.filter((o: any) => Math.abs(o.obb.c[1] + 3) < 0.05);
    assert.equal(southPieces.length, 2, `south rail in two pieces: ${JSON.stringify(southPieces)}`);
    for (const o of southPieces) assert.ok(Math.abs(o.obb.c[0]) - o.obb.half[0] >= 0.69, `clear of the 1.1 m flight: ${JSON.stringify(o.obb)}`);
    assert.equal(rails.length, 5, 'three whole rails and the cut one');
    assert.ok(deck.solids.some((o: any) => o.id.endsWith('#under') && o.y1 < 1.6 && o.y0 < 0), 'nobody stands under a 1.6 m deck');
    // the planner: up, along the deck and back down, and the deck as a named end
    const up = w.reach([0, 2], [0, 1.6, -5]), down = w.reach([2, 1.6, -6], [0, 2]), named = w.reach([0, 2], 'deck');
    assert.equal(up.reachable, true, JSON.stringify(up));
    assert.equal(down.reachable, true, JSON.stringify(down));
    assert.equal(named.reachable, true, JSON.stringify(named));
    assert.equal(named.to.level, floor.level, `the deck's end is on its floor: ${JSON.stringify(named.to)}`);
    assert.ok(up.levels.includes(floor.level) && up.length > 5, JSON.stringify(up));
    // the ground under the deck is not a place to stand (head room 1.6 m), the ground round it is
    assert.equal(w.reach([0, 2], [0, -5]).reachable, false, 'not under the deck');
    assert.equal(w.reach([0, 2], [5, -5]).reachable, true, 'round the deck');
    // describe says where the flight's top is and that it walks onto a floor; a flight a metre short of the deck says not
    const notes = (runQuery(w.god.model, {describe: 'stair'}).describe as any).notes as string[];
    assert.ok(notes.some(n => /^stairs flight: foot at 0,-0\.6 \(y 0\), top at 0,-3 \(y 1\.6\) toward n; walked up onto the floor/.test(n)), notes.join(' | '));
    // the physical probe walks from outside up the stairs onto the deck
    const got = await w.drive(w.verify.run({target: 'deck', uses: ['enter'], timeoutMs: 60_000})) as any;
    assert.equal(got.ok, true, JSON.stringify(got).slice(0, 900));
    assert.equal(got.uses[0].use, 'enter'); assert.equal(got.uses[0].ok, true);
    // and a resident walks up onto the deck and back down to the lawn
    await invite(w, 'dee');
    const row: any = await accept(w.host, w.souls.create('dev:dee', {name: 'Dee', description: 'likes a view'}));
    await w.settle(3);
    await accept(w.host, w.host.enqueue('edge-relocate', 'test:start', {soulId: row.id, entityId: row.entity_id, to: [1, 3], why: 'start on the lawn'}));
    const walk = async (x: number, z: number, level: number) => {
      await accept(w.host, w.host.enqueue('decision', `test:${row.id}`, {soulId: row.id, entityId: row.entity_id, option: 'test:walk', label: 'walk', steps: [{verb: 'mars:walk_to', params: {x, z, level}}], reevalTicks: 1e9, fallback: false, trigger: 'test:walk'}));
      const b = () => E.world.entities[row.entity_id];
      return w.until(() => (b().human.level ?? 0) === level && Math.hypot(b().pose.p[0] - x, b().pose.p[2] - z) < 0.6 && b().human.activity !== 'walk');
    };
    const b = () => E.world.entities[row.entity_id];
    assert.ok(await walk(1.5, -5.5, floor.level), `on the deck: ${JSON.stringify(b().pose.p)} level ${b().human.level}`);
    assert.ok(Math.abs(b().pose.p[1] - 1.6) < 0.1, `standing at the deck's height: ${b().pose.p[1]}`);
    assert.ok(await walk(1, 3, 0), `back on the lawn: ${JSON.stringify(b().pose.p)} level ${b().human.level}`);
    assert.ok(Math.abs(b().pose.p[1]) < 0.1);
    assert.deepEqual(E.runtime.violations, []);
  });
}

test('a deck with no stair is not walked onto; removing the stair closes the rail again; a low deck stays a ground slab', {timeout: 120_000}, async t => {
  const w = world(t, {ground: true}); await w.settle(2);
  assert.equal((w.god.act(DECK_AND_STAIR as any) as any).accepted, true);
  await w.settle();
  const E = w.host.engine as any, deckId = w.god.model.get('deck')!.id, stairId = w.god.model.get('stair')!.id;
  assert.equal(w.reach([0, 2], [0, 1.6, -5]).reachable, true);
  assert.equal((w.god.act({ops: [{op: 'move', id: stairId, p: [0, -0.8]}]} as any) as any).accepted, true);
  await w.settle();
  const short = ((runQuery(w.god.model, {describe: 'stair'}).describe as any).notes as string[]).find(n => n.startsWith('stairs flight'));
  assert.match(short ?? '', /top at 0,-2 \(y 1\.6\) toward n; NOT walkable up onto a floor 1\.2 m past the top \(route\.[a-z-]+\): put the top on the edge of a deck/, short);
  assert.equal((w.god.act({ops: [{op: 'remove', id: stairId}]} as any) as any).accepted, true);
  await w.settle();
  const rails = E.world.entityPhysicsV1.byEntity[deckId].solids.filter((o: any) => o.label.endsWith(' rail'));
  assert.equal(rails.length, 4, 'the rail is whole again');
  assert.equal(w.reach([0, 2], [0, 1.6, -5]).reachable, false, 'no way up without the stair');
  // a 0.3 m deck has no rails and is the ground's own slab: stepped straight onto
  assert.equal((w.god.act({ops: [{op: 'place', def: coreRef('deck'), name: 'low', shape: {area: [[10, -2], [14, -2], [14, 2], [10, 2]]}, params: {height: 0.3}}]} as any) as any).accepted, true);
  await w.settle();
  const low = E.world.entityPhysicsV1.byEntity[w.god.model.get('low')!.id];
  assert.equal(low.surfaces[0].level, 0); assert.equal(low.solids, undefined);
  const on = w.reach([8, 0], 'low');
  assert.equal(on.reachable, true, JSON.stringify(on));
});

test('a turned deck and a turned flight: the gap opens on the right rail, up and down', {timeout: 120_000}, async t => {
  const w = world(t, {ground: true}); await w.settle(2);
  // a 6 m square deck round (20, 0) turned so one edge faces n = (sin 0.5, cos 0.5); the flight (yaw 0.5) climbs into it there
  const r = 0.5, n: [number, number] = [Math.sin(r), Math.cos(r)], tg: [number, number] = [n[1], -n[0]], C: [number, number] = [20, 0];
  const P = (a: number, b: number): [number, number] => [C[0] + n[0] * a + tg[0] * b, C[1] + n[1] * a + tg[1] * b];
  const res = w.god.act({ops: [
    {op: 'define', def: STAIR},
    {op: 'place', def: coreRef('deck'), name: 'deck', shape: {area: [P(3, 3), P(3, -3), P(-3, -3), P(-3, 3)]}, params: {height: 1.6}},
    {op: 'place', def: 'deck-stair@1', name: 'stair', p: P(4.2, 0), r},
    // a second flight under the deck whose head reaches deck height just inside the opposite edge: it does not come from
    // off the deck, so it opens no rail
    {op: 'place', def: 'deck-stair@1', name: 'inner', p: P(-1.5, 0), r},
  ]} as any) as any;
  assert.equal(res.accepted, true, JSON.stringify(res).slice(0, 500));
  await w.settle();
  const E = w.host.engine as any, deck = E.world.entityPhysicsV1.byEntity[w.god.model.get('deck')!.id];
  const rails = deck.solids.filter((o: any) => o.label.endsWith(' rail')), head = P(3, 0);
  t.diagnostic(`rails ${JSON.stringify(rails.map((o: any) => [o.obb.c, o.obb.half, o.obb.yaw]))}`);
  const inner = E.world.entityPhysicsV1.byEntity[w.god.model.get('inner')!.id].links[0];
  assert.ok(Math.abs(inner.to.y - 1.6) < 0.05 && inner.to.level === deck.surfaces[0].level, `the inner flight's head is at the deck: ${JSON.stringify(inner.to)}`);
  assert.equal(rails.length, 5, 'one rail cut in two');
  // no remaining rail covers the head of the flight
  for (const o of rails) {
    const dx = head[0] - o.obb.c[0], dz = head[1] - o.obb.c[1], u = [Math.cos(o.obb.yaw), Math.sin(o.obb.yaw)];
    const along = Math.abs(dx * u[0] + dz * u[1]), across = Math.abs(-dx * u[1] + dz * u[0]);
    assert.ok(!(across < 0.3 && along < o.obb.half[0] + 0.55), `rail ${JSON.stringify(o.obb)} still crosses the head ${head}`);
  }
  const far = P(9, 0), mid = P(-1, -1);
  const up = w.reach(far, [mid[0], 1.6, mid[1]]), down = w.reach([mid[0], 1.6, mid[1]], far);
  assert.equal(up.reachable, true, JSON.stringify(up)); assert.equal(down.reachable, true, JSON.stringify(down));
});
