// An open pavilion on a god's world is not a closed room: its plan is a roof on posts (core-pavilion says
// `place.enclosed: false`), so a Soul standing in it and one a few metres outside hear and perceive each other, and the
// pavilion is no Eyes occluder. A furnished roundhouse's living room stays enclosed (private speech, not seen from
// outside). A building/1 pavilion with no place component is open too: the same wall-less plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Hono } from 'hono';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { edgeSoulResolver, mountEdgeRoutes } from '../edge/routes.ts';
import { buildOccluders } from '../edge/eyes/sight.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('an open pavilion: inside and a few metres outside hear and perceive each other; a cottage room stays enclosed', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const r: any = god.act({ ops: [
    { op: 'define', def: { schema: 'def/1', name: 'bare-pavilion', make: { kind: 'gen', gen: 'building/1', args: { style: 'pavilion' } }, size: { box: [8, 4, 6] } } },
    { op: 'place', def: coreRef('pavilion'), name: 'bandstand', p: [20, -20] },
    { op: 'place', def: 'bare-pavilion@1', name: 'shelter', p: [-20, -20] },
    { op: 'place', def: coreRef('roundhouse'), name: 'moss-cottage', p: [-16, 14] },
    // a walled cafe whose place component leaves `enclosed` out (the def schema defaults it to false): still enclosed
    { op: 'define', def: { schema: 'def/1', name: 'walled-cafe', make: { kind: 'gen', gen: 'building/1', args: { style: 'cottage' } }, size: { box: [8, 4, 6] }, components: { place: { kind: 'cafe' } } } },
    { op: 'place', def: 'walled-cafe@1', name: 'cafe', p: [24, 16] },
    // a core pavilion given an explicit walled plan is no longer a roof on posts
    { op: 'place', def: coreRef('pavilion'), name: 'walled-stand', p: [-30, 30], params: { plan: { floors: [{ rooms: [{ id: 'hall', rect: [0, 0, 6, 6] }], exterior: [{ room: 'hall', wall: 's', kind: 'door' }] }] } } },
  ] }, 'a bandstand, a shelter and a cottage');
  assert.equal(r.accepted, true, JSON.stringify(r));
  const fr: any = god.act({ ops: (runQuery(god.model, { furnish: { ref: 'moss-cottage' } } as any) as any).furnish.ops }, 'furnish');
  assert.equal(fr.accepted, true, JSON.stringify(fr));
  await settle(4);
  bridge.perceive.sync(true);

  const map = new Map(edge.map().map((p: any) => [p.id, p]));
  const room = (id: string) => { const p: any = map.get(id); assert.ok(p, `${id} in the map: ${[...map.keys()].join(', ')}`); return p; };
  assert.equal(room('g-bandstand.pavilion').enclosed, false, 'core-pavilion says enclosed:false');
  assert.equal(room('g-shelter.pavilion').enclosed, false, 'a building/1 pavilion has no walls');
  assert.equal(room('g-moss-cottage.living').enclosed, true, 'an ordinary room stays enclosed');
  const cafeRooms = [...map.values()].filter((p: any) => String(p.id).startsWith('g-cafe.'));
  assert.ok(cafeRooms.length >= 1, 'the cafe has rooms'); for (const p of cafeRooms as any[]) assert.equal(p.enclosed, true, `${p.id}: a walled room stays enclosed whatever place.enclosed defaults to`);
  assert.equal(room('g-walled-stand.hall').enclosed, true, 'a pavilion with an explicit walled plan is enclosed');
  assert.match(room('g-bandstand.pavilion').description, /; open-sided, about /); assert.match(room('g-moss-cottage.living').description, /; indoors, about /);
  const occ = buildOccluders(edge.enclosurePlaces(), edge.spots);
  assert.equal(occ.buildings.some((b) => b.id === 'g-bandstand.pavilion' || b.id === 'g-shelter.pavilion'), false, 'an open pavilion blocks no sight');
  assert.ok(occ.buildings.some((b) => b.id === 'g-moss-cottage.living'), 'the cottage room still blocks sight');

  const app = new Hono();
  mountEdgeRoutes(app, { host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: edgeSoulResolver(f.host, f.souls, (c) => c.req.header('authorization')?.replace(/^Bearer /, '')) });
  const souls: { soulId: string; entityId: string; name: string; owner: string; token: string }[] = [];
  for (const name of ['ana', 'ben']) {
    await invite(f, name);
    const row: any = await accept(f.host, f.souls.create(`dev:${name}`, { name, description: 'a listener' }));
    const pair = f.souls.pairCode(f.db.soul(row.id)!, 'http://127.0.0.1:4958');
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner, token: f.souls.pairExchange(pair.code, 'scripted').token });
  }
  await settle(3);
  const E = f.host.engine as any, [ana, ben] = souls;
  const put = async (pos: [number, number][]) => { pos.forEach((p, i) => assert.equal(E.relocateHumanV1(souls[i].entityId, p), true, `relocate ${souls[i].name} to ${p}`)); await settle(3); };
  const say = async (s: (typeof souls)[number], text: string) => {
    const res = await app.request('/v1/edge/say', { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    assert.equal(res.status, 200, await res.clone().text());
    return ((await res.json()) as any).said;
  };
  const near = (s: (typeof souls)[number]) => edge.perceivedBodies(s.soulId, 12).map((b) => b.soulId);

  for (const [label, centre] of [['bandstand', [20, -20]], ['shelter', [-20, -20]]] as const) {
    // Ana in the middle of the pavilion, Ben ~6 m out on the open ground beside it
    await put([[centre[0], centre[1]], [centre[0], centre[1] + 6]]);
    assert.equal(edge.placePathOf(ana.soulId)[0]?.id, `g-${label}.pavilion`, `${label}: Ana stands in the pavilion`);
    assert.notEqual(edge.placePathOf(ben.soulId)[0]?.id, `g-${label}.pavilion`, `${label}: Ben stands outside it`);
    assert.equal(edge.enclosureOf(ana.soulId), null, `${label}: an open pavilion is no enclosure`);
    assert.deepEqual(near(ana), [ben.soulId], `${label}: Ana perceives Ben`);
    assert.deepEqual(near(ben), [ana.soulId], `${label}: Ben perceives Ana`);
    const a = await say(ana, 'Can you hear the music from there?'), b = await say(ben, 'Yes, every note.');
    assert.equal(a.channel.kind, 'earshot'); assert.equal(a.heardBy, 1, `${label}: Ben hears Ana`);
    assert.equal(b.channel.kind, 'earshot'); assert.equal(b.heardBy, 1, `${label}: Ana hears Ben`);
  }

  // the cottage: Ana in the living room, Ben ~6 m out from it; walls between them
  const living = room('g-moss-cottage.living'), c = living.center as [number, number];
  const outside = [c[0], c[1] + 9] as [number, number];
  await put([c, outside]);
  assert.equal(edge.enclosureOf(ana.soulId), 'g-moss-cottage.living', 'Ana is inside the room');
  assert.equal(edge.enclosureOf(ben.soulId), null, 'Ben is outdoors');
  assert.deepEqual(near(ana), []); assert.deepEqual(near(ben), []);
  const inRoom = await say(ana, 'Just me in here.');
  assert.equal(inRoom.channel.kind, 'enclosure'); assert.equal(inRoom.heardBy, 0, 'nobody outside hears the room');
  assert.equal((await say(ben, 'Anyone home?')).heardBy, 0, 'the room does not hear the yard');

  // the walled cafe (place component without `enclosed`): inside and ~6 m outside neither hear nor perceive each other
  const cafe = (cafeRooms[0] as any).center as [number, number];
  await put([cafe, [cafe[0], cafe[1] + 8]]);
  assert.equal(edge.enclosureOf(ana.soulId), (cafeRooms[0] as any).id, 'Ana is inside the cafe');
  assert.deepEqual(near(ana), []); assert.deepEqual(near(ben), []);
  const inCafe = await say(ana, 'Quiet in here.');
  assert.equal(inCafe.channel.kind, 'enclosure'); assert.equal(inCafe.heardBy, 0, 'nobody outside hears the cafe');
  assert.deepEqual(E.runtime.violations, []);
});
