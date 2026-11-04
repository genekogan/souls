// Focused unit tests for travel between worlds (M3; docs/sim/TRAVEL.md): two in-memory worlds joined by a fake
// launcher relay. The engine, minds and lifecycle are small fakes; the travel tables, passport and rules are real.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../db.ts';
import {appendLog, portableBody, siteRequestOk, Travel, TravelError, type BodyRef, type LogEntry, type Relay, type SiteWorld} from './travel.ts';
import {siblingBase} from './routes.ts';

type World = {slug: string; name: string; db: Db; travel: Travel; entities: Record<string, {body?: unknown}>; faded: string[]; arrived: string[]; down: boolean};

function site() {
  const worlds = new Map<string, World>();
  const relay: Relay = async (to, path, body: any) => {
    const w = worlds.get(to);
    if (!w || w.down) throw new Error('connect ECONNREFUSED');
    try {
      const T = w.travel;
      const data = path === '/v1/site/arrive' ? await T.arrive(body) : path === '/v1/site/where' ? T.where(body.traveller, body.at) : path === '/v1/site/where-is' ? T.whereIs(body.traveller)
        : path === '/v1/site/presence' ? T.presence(body.traveller) : path === '/v1/site/release' ? T.release(body.traveller, body.reason ?? '') : null;
      return data ? {status: 200, data} : {status: 404, data: {code: 'not-found'}};
    } catch (e) {
      if (e instanceof TravelError) return {status: e.status, data: {ok: false, code: e.code, message: e.message}};
      throw e;
    }
  };
  const list = async (): Promise<SiteWorld[]> => [...worlds.values()].map(w => ({slug: w.slug, name: w.name}));
  function world(slug: string, name: string, opts: {alone?: boolean; resolve?: (ref: string, owner: string) => BodyRef} = {}): World {
    const db = new Db(':memory:'), entities: Record<string, {body?: unknown}> = {}, minds = new Map<string, unknown>(), faded: string[] = [], arrived: string[] = [];
    const host = {worldId: `${slug}-world`, engine: {world: {entities}, bodyAssignmentProblemV1: () => null}, minds, quietBarrier: false,
      enqueueChecked: async (_k: string, _s: string, p: {entityId: string; body: unknown}, guard: () => true) => { guard(); entities[p.entityId] = {...entities[p.entityId], body: p.body}; }};
    let n = 0;
    const souls = {
      acceptLifecycleCreate(owner: string, input: {name: string; description?: string}) {
        const id = `s_${slug}${++n}`, entityId = `h_${slug}${n}`;
        db.createSoul({id, worldId: host.worldId, owner, entityId, name: input.name, description: input.description ?? '', native: true});
        entities[entityId] = {body: {kit: 'default'}}; minds.set(id, {});
        return {scope: {soulId: id}};
      },
      travelToken: (id: string) => `sim_${id}`,
      controlReady: () => true,
    };
    const fading = {enabled: true, depart: (id: string) => { faded.push(id); return true; }, arrive: (id: string) => { arrived.push(id); return true; }, addAway: () => {}};
    const w: World = {slug, name, db, entities, faded, arrived, down: false,
      travel: new Travel({host: host as never, db, souls: souls as never, fading, slug, name, site: opts.alone ? null : {worlds: list, relay}, sleep: async () => {}, ...(opts.resolve ? {resolveBodyRef: opts.resolve} : {})})};
    worlds.set(slug, w);
    return w;
  }
  return {world, worlds};
}
/** A resident born in `w` (owner + Soul row + body), as the native lifecycle would leave it. */
function born(w: World, owner: string, name: string, body: unknown = {kit: 'humanoid', look: {hair: 'bob', seed: 4242}}) {
  if (!w.db.user(owner)) w.db.upsertUser({id: owner, email: null, wallet: null, role: 'user'});
  const id = `s_${name.toLowerCase()}`, entityId = `h_${name.toLowerCase()}`;
  w.db.createSoul({id, worldId: `${w.slug}-world`, owner, entityId, name, description: `${name} of ${w.name}`, native: true});
  w.entities[entityId] = {body};
  return w.db.soul(id)!;
}
/** Either answer shape (a trip or a recall), for asserting on. */
const trip = (w: World, soul: Parameters<Travel['travel']>[0], to: string) => w.travel.travel(soul, to) as Promise<Record<string, any>>;
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof TravelError ? `${e.status} ${e.code}` : String(e); } };

test('portableBody keeps kit looks and presets, leaves uploaded bodies home', () => {
  assert.deepEqual(portableBody(undefined), {body: null, note: null});
  const look = {kit: 'humanoid', look: {hair: 'bob'}}, p = portableBody(look);
  assert.deepEqual(p, {body: look, note: null});
  assert.notEqual(p.body, look, 'a copy, never the live engine object');
  const up = portableBody({model: `body_${'a'.repeat(64)}`, modelUrl: '/w/alder/v1/edge/body/assets/x.glb'});
  assert.deepEqual(up, {body: {ref: `body_${'a'.repeat(64)}`}, note: null}, '#795: an admitted definition travels as a reference, never its home URL');
});

test('appendLog keeps the 20 most recent entries', () => {
  let log: LogEntry[] = [];
  for (let i = 0; i < 25; i++) log = appendLog(log, {at: i, kind: 'travel', from: 'a', fromName: 'A', to: 'b', toName: 'B'});
  assert.equal(log.length, 20);
  assert.equal(log[0].at, 5);
  assert.equal(log.at(-1)!.at, 24);
});

test('site requests need the exact key and never come through the public proxy', () => {
  const key = 'k'.repeat(64);
  assert.equal(siteRequestOk(undefined, key, undefined), false);
  assert.equal(siteRequestOk(key, undefined, undefined), false);
  assert.equal(siteRequestOk(key, 'x'.repeat(64), undefined), false);
  assert.equal(siteRequestOk(key, 'k', undefined), false);
  assert.equal(siteRequestOk(key, key, '203.0.113.9'), false);
  assert.equal(siteRequestOk(key, key, undefined), true);
});

test('siblingBase points at the other world of the same site', () => {
  assert.equal(siblingBase('http://127.0.0.1:6110/w/alder', 'alder', 'birch'), 'http://127.0.0.1:6110/w/birch');
  assert.equal(siblingBase('https://sim.example/w/alder', 'other', 'birch'), 'https://sim.example/w/birch');
});

test('a world running alone refuses travel; a fresh resident is present at home', async () => {
  const {world} = site(), a = world('alder', 'Alder', {alone: true}), ana = born(a, 'dev:ana', 'Ana');
  const st = a.travel.status(ana);
  assert.equal(st.home, 'alder'); assert.equal(st.state, 'present'); assert.equal(st.atHome, true); assert.equal(st.available, false); assert.equal(st.open, true);
  assert.equal(await code(a.travel.travel(ana, 'birch')), '503 travel.unavailable');
});

test('refusals before anything moves: bad body, unknown world, same world', async () => {
  const {world} = site(), a = world('alder', 'Alder'); world('birch', 'Birch');
  const ana = born(a, 'dev:ana', 'Ana');
  assert.equal(await code(a.travel.travel(ana, '')), '400 invalid');
  assert.equal(await code(a.travel.travel(ana, 'x'.repeat(81))), '400 invalid');
  assert.equal(await code(a.travel.travel(ana, 'nowhere')), '404 travel.unknown-world');
  assert.equal(await code(a.travel.travel(ana, 'Alder')), '409 travel.same-world');
  assert.equal(a.travel.inc(ana.id), undefined, 'no incarnation row is left behind');
  assert.equal(a.travel.status(ana).state, 'present');
});

test('travel: same name, owner and body arrive; origin puts the Soul away; home records where it is', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana');
  const r = await trip(a, ana, 'Birch');
  assert.equal(r.ok, true); assert.equal(r.to, 'birch'); assert.equal(r.created, true); assert.equal(r.name, 'Ana'); assert.equal(r.atHome, false); assert.equal(r.home, 'alder');
  assert.match(r.token!, /^sim_/);
  const there = b.db.soul(r.soulId)!;
  assert.equal(there.owner, 'dev:ana'); assert.equal(there.name, 'Ana'); assert.equal(there.world_id, 'birch-world');
  assert.deepEqual(b.entities[there.entity_id].body, a.entities[ana.entity_id].body, 'the carried look is worn');
  const st = b.travel.status(there);
  assert.equal(st.traveller, `alder/${ana.id}`); assert.equal(st.home, 'alder'); assert.equal(st.here, 'birch'); assert.equal(st.state, 'present'); assert.equal(st.log.at(-1)!.to, 'birch');
  assert.equal(a.travel.isAway(ana.id), true); assert.deepEqual(a.faded, [ana.id]);
  assert.equal(a.travel.status(ana).at, 'birch');
  assert.deepEqual(a.travel.whereIs(`alder/${ana.id}`), {ok: true, at: 'birch'});
  const v = b.travel.visitors();
  assert.deepEqual(v.visitors.map(x => [x.name, x.home]), [['Ana', 'alder']]);
  assert.equal(v.recent[0].kind, 'arrived');
  assert.equal(await code(a.travel.travel(ana, 'birch')), '409 travel.away', 'an away Soul acts where it is');
  // the token owner's view does not leak owners
  assert.equal(JSON.stringify(v).includes('dev:ana'), false);
});

test('a world that cannot resolve a carried reference keeps the default look and says why', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana', {model: `body_${'b'.repeat(64)}`});
  const r = await trip(a, ana, 'birch');
  assert.deepEqual(b.entities[b.db.soul(r.soulId)!.entity_id].body, {kit: 'default'}, 'the destination default look');
  assert.match(r.log.at(-1)!.note!, /body\.ref-unsupported/);
});

test('#795: a carried reference is resolved for its owner, pulled only when the body can change, and worn', async () => {
  const ref = `body_${'c'.repeat(64)}`, worn = {family: 'floater', type: 'ceramic', model: ref, modelUrl: `/w/birch/v1/edge/body/assets/${ref}.glb`};
  const calls: string[] = [];let ready = false;
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch', {resolve: (r, owner) => { calls.push(`resolve ${r} ${owner}`); return {ok: true, body: worn, fetch: async () => { calls.push(`fetch ready=${ready}`); return {ok: true}; }}; }});
  // the destination engine refuses a change until the arriving body is standing (the guard), then allows it
  const host = (b.travel as any).d.host;let checks = 0;host.engine.bodyAssignmentProblemV1 = () => { if (++checks > 3) { ready = true; return null; } return 'body.safe-standing-required'; };
  const ana = born(a, 'dev:ana', 'Ana', {model: ref, modelUrl: `/w/alder/v1/edge/body/assets/${ref}.glb`});
  const r = await trip(a, ana, 'birch');
  assert.deepEqual(b.entities[b.db.soul(r.soulId)!.entity_id].body, worn, 'the same definition, served by the destination');
  assert.deepEqual(calls, [`resolve ${ref} dev:ana`, 'fetch ready=true'], 'resolved for the owner; bytes fetched once, only after the guard passed');
  assert.equal(r.log.at(-1)!.note, undefined);
});

test('#795: a refused reference (unpublished, withdrawn, policy, unreachable) keeps the default look and names the code', async () => {
  for (const [code, fetchFails] of [['body.ref-unknown', false], ['body.withdrawn', false], ['body.world-policy', false], ['body.source-unavailable', true]] as const) {
    const ref = `body_${'d'.repeat(64)}`;let fetched = 0;
    const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch', {resolve: () => fetchFails ? {ok: true, body: {family: 'floater', type: 'ceramic', model: ref}, fetch: async () => { fetched++; return {ok: false, code, reason: 'unreachable'}; }} : {ok: false, code, reason: 'refused'}});
    const ana = born(a, 'dev:ana', 'Ana', {model: ref});
    const r = await trip(a, ana, 'birch');
    assert.equal(r.ok, true, 'travel itself is never refused because of the body');
    assert.deepEqual(b.entities[b.db.soul(r.soulId)!.entity_id].body, {kit: 'default'}, code);
    assert.match(r.log.at(-1)!.note!, new RegExp(code.replace('.', '\\.')), code);
    assert.equal(fetched, fetchFails ? 1 : 0);
  }
});

test('a closed world refuses newcomers; a resident can always leave and home never refuses its own', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana'), ben = born(a, 'dev:ben', 'Ben');
  const went = await trip(a, ana, 'birch');
  b.travel.setOpen(false); a.travel.setOpen(false);
  assert.equal(b.travel.open, false);
  assert.equal(await code(b.travel.travel(ben, 'birch')), '409 travel.same-world', 'sanity: Ben is not in Birch');
  assert.equal(await code(a.travel.travel(ben, 'birch')), '403 travel.closed');
  assert.equal(a.travel.status(ben).state, 'present'); assert.equal(a.travel.inc(ben.id), undefined, 'a refused first trip leaves no row');
  assert.equal(b.travel.visitors().recent[0].code, 'travel.closed');
  const back = await trip(b, b.db.soul(went.soulId)!, 'home');
  assert.equal(back.to, 'alder'); assert.equal(back.soulId, ana.id); assert.equal(back.returned, true); assert.equal(back.atHome, true);
  assert.equal(a.travel.status(ana).state, 'present'); assert.deepEqual(a.arrived, [ana.id]);
  assert.equal(b.travel.isAway(went.soulId), true);
  assert.equal(b.travel.visitors().visitors.length, 0);
  assert.deepEqual(a.travel.whereIs(`alder/${ana.id}`), {ok: true, at: 'alder'});
});

test('a return visit gets back the same local Soul (its history there continues)', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana');
  const first = await trip(a, ana, 'birch');
  await trip(b, b.db.soul(first.soulId)!, 'home');
  const again = await trip(a, a.db.soul(ana.id)!, 'birch');
  assert.equal(again.soulId, first.soulId); assert.equal(again.returned, true); assert.equal(again.created, false);
  assert.deepEqual(again.log.map((e: LogEntry) => `${e.kind}:${e.from}>${e.to}`), ['travel:alder>birch', 'travel:birch>alder', 'travel:alder>birch']);
  assert.equal(b.db.liveSouls('birch-world').length, 1, 'no second Ana in Birch');
});

test('home recalls its resident: the other world lets go; if it does not answer, home wins anyway', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana');
  const went = await trip(a, ana, 'birch');
  const r = await trip(a, a.db.soul(ana.id)!, 'home');
  assert.equal(r.recalled, true); assert.equal(r.released, 'released'); assert.equal(r.atHome, true);
  assert.equal(b.travel.isAway(went.soulId), true);
  await trip(a, a.db.soul(ana.id)!, 'birch');
  b.down = true;
  const r2 = await trip(a, a.db.soul(ana.id)!, 'home');
  assert.equal(r2.released, 'unreachable'); assert.equal(a.travel.status(ana).state, 'present');
  // Birch boots, asks home, and lets the stale visitor go
  b.down = false;
  assert.deepEqual(await b.travel.reconcile(), [`${went.soulId}: released`]);
  assert.equal(b.travel.isAway(went.soulId), true);
});

test('an unreachable destination leaves the Soul present where it was', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana');
  b.down = true;
  assert.equal(await code(a.travel.travel(ana, 'birch')), '503 travel.unreachable');
  assert.equal(a.travel.status(ana).state, 'present'); assert.equal(a.travel.inc(ana.id), undefined);
  assert.deepEqual(a.faded, []);
  assert.equal(a.travel.visitors().recent[0].code, 'travel.unreachable');
});

test('a name already taken at the destination is refused', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana');
  born(b, 'dev:other', 'Ana');
  assert.equal(await code(a.travel.travel(ana, 'birch')), '409 travel.name-taken');
  assert.equal(a.travel.status(ana).state, 'present');
});

test('arrivals check the passport and are idempotent by requestId', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch');
  assert.equal(await code(b.travel.arrive({} as never)), '400 invalid');
  const p = {contract: 'travel/1' as const, requestId: 'tr_' + 'c'.repeat(32), traveller: 'alder/s_ana', home: 'alder', homeSoulId: 's_ana', name: 'Ana', description: '', owner: 'dev:ana', body: null, bodyNote: null, from: 'alder', fromName: 'Alder', log: []};
  assert.equal(await code(b.travel.arrive({...p, traveller: 'alder/s_someone-else'})), '400 invalid', 'the traveller must be home/homeSoulId');
  const one = await b.travel.arrive(p), two = await b.travel.arrive(p);
  assert.equal(one.soulId, two.soulId); assert.equal(two.returned, true); assert.equal(b.db.liveSouls('birch-world').length, 1);
  assert.equal(await code(a.travel.arrive({...p, requestId: 'tr_' + 'd'.repeat(32)})), '410 travel.home-gone', 'home must still have the resident');
});

test('release never applies to a resident at home; where/where-is answer only for its own residents', async () => {
  const {world} = site(), a = world('alder', 'Alder'); world('birch', 'Birch');
  const ana = born(a, 'dev:ana', 'Ana');
  assert.deepEqual(a.travel.release(`alder/${ana.id}`, 'x'), {ok: true, released: false, state: null});
  assert.throws(() => a.travel.where('birch/s_x', 'alder'), TravelError);
  assert.throws(() => a.travel.whereIs('birch/s_x'), TravelError);
  assert.deepEqual(a.travel.whereIs(`alder/${ana.id}`), {ok: true, at: 'alder'});
});

test('reconcile settles a departure that was in flight when the origin stopped', async () => {
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch'), ana = born(a, 'dev:ana', 'Ana');
  const went = await trip(a, ana, 'birch');
  // pretend the origin crashed between "admitted" and "away"
  a.db.db.prepare("UPDATE travel_incarnations_v1 SET state='departing' WHERE soul_id=?").run(ana.id);
  assert.deepEqual(await a.travel.reconcile(), [`${ana.id}: away`]);
  assert.equal(a.travel.status(ana).state, 'away');
  // and the other way: the destination never admitted
  await trip(b, b.db.soul(went.soulId)!, 'home');
  a.db.db.prepare("UPDATE travel_incarnations_v1 SET state='departing', at='birch' WHERE soul_id=?").run(ana.id);
  assert.deepEqual(await a.travel.reconcile(), [`${ana.id}: stayed`]);
  assert.equal(a.travel.status(ana).state, 'present');
});

test('#795: a traveller in the default look arrives in it, also where an earlier visit left a carried body', async () => {
  const ref = `body_${'e'.repeat(64)}`, worn = {family: 'floater', type: 'ceramic', model: ref};
  const {world} = site(), a = world('alder', 'Alder'), b = world('birch', 'Birch', {resolve: () => ({ok: true, body: worn})});
  const ana = born(a, 'dev:ana', 'Ana', {model: ref});
  const first = await trip(a, ana, 'birch'), there = b.db.soul(first.soulId)!.entity_id;
  assert.deepEqual(b.entities[there].body, worn);
  await trip(b, b.db.soul(first.soulId)!, 'home');
  a.entities[ana.entity_id] = {body: null};   // at home the owner chose the default look
  const second = await trip(a, a.db.soul(ana.id)!, 'birch');
  assert.equal(second.soulId, first.soulId, 'the same incarnation returns');
  assert.equal(b.entities[there].body ?? null, null, 'the default look, not the body left from the first visit');
});
