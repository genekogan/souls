// knowledge/1 (R13): knowledge at several scales. Near is detailed (here, unchanged), the district is summarised
// (people counted, busiest places, what is on — never who), far districts are names and directions only until the Soul
// has been there (then distance and the places it visited, remembered durably), `around` (look around / explore) shows
// more and finds secret places close by, and a place the world's creator marks secret is left off every listing until
// the Soul knows it. Fake minds; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from 'hono';
import {coreRef} from '@souls/world-compiler';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {fixture, invite, accept, factory} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';
import {PlaceKnowledge, edgeDistance} from './edge/perception/knowledge.ts';
import {mountSecretPlaceRoutes} from './edge/perception/secret-routes.ts';

const SCALE_KEYS = ['district', 'far', 'farMore'];
const strip = (h: Record<string, unknown>) => Object.fromEntries(Object.entries(h).filter(([k]) => !SCALE_KEYS.includes(k)));

test('edgeDistance: inside 0-ish, outside by the outline', () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(edgeDistance([15, 5], sq), 5); assert.equal(edgeDistance([5, 5], sq), 5); assert.equal(Math.round(edgeDistance([13, 14], sq)), 5);
});

test('knowledge at scales: district summary, far names, memory of visits, look around, secret places', {timeout: 300000}, async t => {
  const w = await coreAWorld(3); t.after(() => w.close());
  const [a, b, c] = w.souls, L = w.ledger;
  const here = async (s: typeof a) => {const r = await w.http(s, 'GET', '/v1/edge/here'); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.here;};
  const around = async (s: typeof a) => {const r = await w.http(s, 'GET', '/v1/edge/around'); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.around;};
  const caps = async (s: typeof a) => (await w.http(s, 'GET', '/v1/edge/capabilities')).body.capabilities as {id: string}[];

  // ---- near/district/far on the commons
  await w.put(a, [14, 14]); await w.put(b, [-20, 20]); await w.put(c, [30, 20]); await w.ticks(12);
  const h1 = await here(a), raw1 = JSON.stringify(h1), before = JSON.stringify(strip(h1));
  assert.equal(h1.me.place, 'field'); assert.equal(h1.district.name, 'Commons ground');
  assert.equal(h1.district.people, 1, 'B is out on the commons; C is in another district; I am not counted');
  assert.ok(!JSON.stringify(h1.district).includes(b.name), 'counts and place names only, never who');
  assert.ok(Array.isArray(h1.far) && h1.far.length === 6 && h1.farMore > 0, JSON.stringify(h1.far));
  const east1 = h1.far.find((x: string) => x.startsWith('Eden east'));
  assert.equal(east1, 'Eden east · E', 'never been there: a name and a direction only');
  assert.ok(h1.far.every((x: string) => x.split(' · ').length === 2), 'nothing visited yet');
  const added = raw1.length - before.length;
  t.diagnostic(`here frame ${before.length} chars (~${Math.ceil(before.length / 4)} tokens) before, ${raw1.length} (~${Math.ceil(raw1.length / 4)} tokens) with scales: +${added} chars (~${Math.ceil(added / 4)} tokens)`);
  assert.ok(added <= 420, `scales cost ${added} chars`);

  // ---- memory of visits: A walks (is put) into Eden east's housing, then comes back
  await w.put(a, [30, 20]); await w.ticks(12);
  assert.deepEqual(L.placePathOf(a.soulId).map(p => p.id), ['eden-housing', 'eden-east', 'eden']);
  const inEast = await here(a); assert.equal(inEast.district.name, 'Eden east'); assert.ok(inEast.district.people >= 1, 'C is out in Eden east');
  await w.put(a, [14, 14]); await w.ticks(12);
  const h2 = await here(a), east2 = h2.far.find((x: string) => x.startsWith('Eden east'));
  assert.match(east2, /^Eden east · E \d+m · been: /, east2); assert.ok(east2.includes(L.places.byId.get('eden-housing')!.name), east2);
  assert.ok(L.knowledge.memory(a.soulId).get('eden-east')!.visits >= 1);
  // durable: a fresh reader of the same database remembers
  assert.ok(new PlaceKnowledge(L).memory(a.soulId).has('eden-housing'), 'visits are stored, not only cached');
  // B never went: its far list still has the bare name
  assert.equal((await here(b)).far.find((x: string) => x.startsWith('Eden east')), 'Eden east · E');

  // ---- secret places: the deck north of A (≈15 m) and the park district
  const deck = L.places.byId.get('commons-deck')!;
  assert.ok((await caps(a)).some(x => x.id === 'walk:commons-deck'), 'public before');
  assert.ok(L.knowledge.setSecret('commons-deck', true) && L.knowledge.setSecret('region-park', true));
  const mapIds = L.map().map(p => p.id); assert.ok(!mapIds.includes('commons-deck') && !mapIds.includes('region-park') && !mapIds.some(id => id.startsWith('region-park.')), 'off the public map, with its insides');
  const boot = await w.app.request('/v1/edge/boot/places'); assert.equal(boot.status, 200); assert.ok(!(await boot.text()).includes('commons-deck'), 'off the boot catalogue');
  const st = await (await w.app.request('/v1/edge/boot/static')).text(); assert.ok(!st.includes('commons-deck') && !st.includes('Presentation deck'));
  const hs = await here(a), rawS = JSON.stringify(hs);
  assert.ok(!rawS.includes('commons-deck') && !rawS.includes(deck.name), 'not an exit, not named');
  assert.ok(!hs.far.some((x: string) => x.startsWith('Park with pond')) && hs.farMore === h2.farMore - 1, 'a secret district is not far-listed');
  assert.ok(!(await caps(a)).some(x => x.id.endsWith(':commons-deck')), 'no walk offered');
  const r1 = (await w.http(a, 'POST', '/v1/edge/act', {verb: 'walk', target: deck.name})).body;
  assert.equal(r1.accepted, false); assert.ok(!JSON.stringify(r1).includes('commons-deck'), JSON.stringify(r1));
  assert.ok(!/unwalkable|no walk reaches/.test(r1.reason ?? ''), 'a name never confirms a secret place exists: ' + r1.reason);
  const r2 = (await w.http(a, 'POST', '/v1/edge/act', {capability: 'walk:commons-deck'})).body; assert.equal(r2.accepted, false);

  // ---- look around: finds it (close enough), and remembers; B (not looking) still does not know
  const ar = await around(a), rawA = JSON.stringify(ar);
  assert.deepEqual(ar.found.map((x: any) => x.id), ['commons-deck'], rawA);
  assert.equal(ar.found[0].walk, 'walk:commons-deck', 'found, with the walk offered now');
  assert.ok(ar.places.some((p: any) => p.id === 'commons-deck' && p.secret === true && p.been === 'found' && p.walk === 'walk:commons-deck'), 'listed as a found secret, walkable now');
  assert.ok(ar.unvisited.every((x: string) => x.startsWith('walk:')), 'suggestions are offered walks');
  assert.ok(ar.places.length > 0 && ar.places.every((p: any) => p.dir && p.eta && typeof p.m === 'number'), JSON.stringify(ar.places));
  assert.ok(Array.isArray(ar.things) && ar.things.length > 0 && ar.people.some((x: string) => x.startsWith(b.name)), rawA);
  assert.ok(!rawA.includes('region-park'), 'the park is far: not found from here');
  t.diagnostic(`around frame ${rawA.length} chars (~${Math.ceil(rawA.length / 4)} tokens): ${ar.places.length} places, ${ar.people.length} people, ${ar.things.length} things`);
  assert.ok(rawA.length <= 4000, `around ${rawA.length} chars`);
  assert.equal((await around(a)).found, undefined, 'found once');
  assert.ok((await caps(a)).some(x => x.id === 'walk:commons-deck'), 'known now: the walk is offered');
  assert.ok(JSON.stringify((await here(a)).exits).includes('commons-deck'), 'and it is an exit again');
  assert.ok(!(await caps(c)).some(x => x.id.endsWith(':commons-deck')), 'C has not found it');
  assert.ok(!L.map().some(p => p.id === 'commons-deck'), 'still off the public map');

  // ---- unmarking makes it public again
  L.knowledge.setSecret('commons-deck', false);
  assert.ok((await caps(c)).some(x => x.id === 'walk:commons-deck') && L.map().some(p => p.id === 'commons-deck'));
  assert.deepEqual(L.knowledge.secrets().map(s => s.id), ['region-park']);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('god route: mark a place secret by id or name, list, refuse unknown and root', {timeout: 300000}, async t => {
  const w = await coreAWorld(1); t.after(() => w.close());
  const app = new Hono();
  app.onError((e, c) => c.json({ok: false, message: e.message}, 401));
  mountSecretPlaceRoutes(app, {ledger: w.ledger, requireGod: c => {if (c.req.header('authorization') !== 'Bearer god') throw new Error('not god');}});
  const call = async (method: string, body?: unknown, who = 'god') => {const r = await app.request('/v1/god/places/secret', {method, headers: {authorization: `Bearer ${who}`, 'content-type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}); return {status: r.status, body: await r.json() as any};};
  assert.equal((await call('GET', undefined, 'soul')).status, 401, 'god token only');
  assert.equal((await call('POST', {place: 'Presentation deck', secret: true})).body.place.id, 'commons-deck');
  assert.equal((await call('POST', {place: 'eden-housing'})).body.secret, true, 'secret defaults to true');
  assert.deepEqual((await call('GET')).body.secrets.map((s: any) => s.id), ['commons-deck', 'eden-housing']);
  assert.equal((await call('POST', {place: 'nowhere at all', secret: true})).status, 404);
  assert.equal((await call('POST', {place: 'eden', secret: true})).status, 400);
  assert.equal((await call('POST', {place: 'commons-deck', secret: false})).body.secret, false);
  assert.deepEqual(w.ledger.knowledge.secrets().map(s => s.id), ['eden-housing']);
});

test('god world: a secret place is not walked to by name (walk:<ref> offers, plain words, everyday synonyms)', {timeout: 300000}, async t => {
  const f = fixture(':memory:', factory, {durableClockV1: true});
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {}});
  const L = new EdgeLedger(f.host, f.db), bridge = installEngineBridge({host: f.host, god, edge: L, log: () => {}});
  const settle = async (n = 4) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  f.brain.quiesce(); t.after(() => {f.brain.quiesce(); f.host.stop(); f.db.close();});
  await settle(2);
  const built = god.act({ops: [
    {op: 'place', def: coreRef('plaza'), name: 'plaza', shape: {area: [[-8, -25], [8, -25], [8, -11], [-8, -11]]}},
    {op: 'place', def: coreRef('lawn'), name: 'grove', shape: {area: [[17, -23], [27, -23], [27, -13], [17, -13]]}},
    {op: 'place', def: coreRef('lawn'), name: 'orchard', shape: {area: [[-40, -40], [-28, -40], [-28, -28], [-40, -28]]}},
  ]}, 'a plaza, a grove beside it, an orchard') as {accepted: boolean};
  assert.equal(built.accepted, true, JSON.stringify(built));
  await settle(4); bridge.perceive.sync(true);
  await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'curious'})) as {id: string; entity_id: string; name: string; owner: string};
  await settle(3);
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  const act = async (capability: string) => await accept(f.host, L.act(soul, {capability})) as {accepted: boolean; code?: string; reason?: string; receipt?: {capability: string}};

  // god-world walks are walk:<ref> (nav.ts), their target the god place g-<ref>
  const caps0 = L.capabilities(soul);
  assert.deepEqual(caps0.find(c => c.id === 'walk:grove')?.target, {id: 'g-grove', kind: 'place'});
  assert.ok(caps0.find(c => c.id === 'walk:orchard')?.available, 'the orchard (an everyday word for a grove) is walkable');
  assert.ok(L.knowledge.setSecret('g-grove', true));
  assert.ok(!L.capabilities(soul).some(c => c.id.endsWith(':grove') || c.target?.id === 'g-grove'), 'no walk:grove, hang-out:grove …');

  // plain words: refused as any unknown name is — not walked to the field that holds it, not swapped for the orchard,
  // and nothing in the reply (note, reason, did_you_mean) names the grove beyond the words the Soul said
  const unknown = await act('walk to the zyzzyva');
  for (const words of ['walk to the grove', 'go to grove', 'hang out at the grove', 'walk to g-grove']) {
    const r = await act(words), leak = JSON.stringify(r).replaceAll(words, '');
    assert.equal(r.accepted, false, `${words}: ${JSON.stringify(r)}`);
    assert.equal(r.code, unknown.code, `${words}: refused like an unknown name: ${JSON.stringify(r)}`);
    assert.ok(!/grove/i.test(leak), `${words}: ${leak}`);
  }

  // found (by looking around): the same words reach it
  L.knowledge.find(soul.soulId, 'g-grove', f.host.engine.world.tick); L.invalidateBodies();
  const known = await act('walk to the grove');
  assert.equal(known.accepted, true, JSON.stringify(known)); assert.equal(known.receipt?.capability, 'walk:grove');
});
