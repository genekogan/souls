// todo lane (R4): fishing from a pond bank, feeding the koi, tending the garden beds. Ordinary resident commands, honest
// verdicts (no ducks here: refused, never swapped), visible pose state (activity + prop), exact replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kernelHash} from '@souls/kernel';
import {edenNavWorld, factory, WORLD_SPOTS} from '../test/eden-nav-fixture.ts';
import {WorldHost} from './world.ts';
import {activityCapabilities, loadSpots} from './edge/ledger/activities.ts';

async function world(n: number) {
  const w = await edenNavWorld(n, {cn5: true, spots: WORLD_SPOTS});
  const body = (s: {entityId: string}) => (w.engine.world.entities as any)[s.entityId];
  const act = async (s: typeof w.souls[number], capability: string, params?: object) => (await w.act(s, capability, params)) as any;
  const done = async (s: typeof w.souls[number], out: any, limit = 20 * 60 * 5, each?: () => void) => {await w.run([{soulId: s.soulId, id: out.receipt.id}], limit, each); return w.ledger.receipt(s.soulId, out.receipt.id)!;};
  const seen = (s: typeof w.souls[number], out: any, activity: string, limit?: number) => {let got: any = null; return done(s, out, limit, () => {const h = body(s).human; if (h.activity === activity) got ??= {base: h.baseActivity, prop: h.prop, at: [body(s).pose.p[0], body(s).pose.p[2]]};}).then(r => ({r, got}));};
  const replayExact = async () => {
    w.f.host.drainInputs(); w.f.host.saveSnapshot(true); const head = {engine: w.f.host.engine.stateHash(), kernel: kernelHash(w.f.host.kernel)};
    w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.f.host.worldId);
    const h = new WorldHost(w.f.db, await factory(), w.f.host.seed, 1e9, w.f.host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
    assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, 'replay exact'); h.stop();
  };
  return {...w, body, act, done, seen, replayExact};
}

test('leisure spots: World file loads with every fishing, feeding and garden spot accepted', () => {
  const out = loadSpots(WORLD_SPOTS); assert.deepEqual(out.refused, []);
  for (const id of ['fish-shore-1', 'feed-park-1', 'garden-bed-1']) assert.ok(out.data.spots.some(s => s.id === id), id);
});

test('leisure: go fishing, feed the koi, tend the beds; ducks are refused, not swapped', {timeout: 1800000}, async t => {
  const w = await world(3); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b, c] = w.souls;
  // fishing from the shore-pond bank
  const fish = await w.act(a, 'go fishing', {seconds: 6}); assert.equal(fish.accepted, true, JSON.stringify(fish)); assert.match(fish.resolved?.to, /^fish:fish-/);
  const f1 = await w.seen(a, fish, 'fish'); assert.equal(f1.r.phase, 'completed'); assert.equal(f1.got?.prop, 'rod');
  // ducks are not here: honest refusal naming the koi
  const duck = await w.act(b, 'feed the ducks'); assert.equal(duck.accepted, false); assert.match(duck.reason ?? duck.refusal?.reason ?? JSON.stringify(duck), /no ducks/i);
  // koi: fed at a marked bank, with bread in hand
  const koi = await w.act(b, 'feed the koi', {seconds: 6}); assert.equal(koi.accepted, true, JSON.stringify(koi)); assert.match(koi.resolved?.to, /^feed:feed-/);
  const f2 = await w.seen(b, koi, 'feed'); assert.equal(f2.r.phase, 'completed'); assert.equal(f2.got?.prop, 'bread');
  // garden beds in the gardens
  const garden = await w.act(c, 'do some gardening', {seconds: 6}); assert.equal(garden.accepted, true, JSON.stringify(garden)); assert.match(garden.resolved?.to, /^garden:garden-bed-/);
  const f3 = await w.seen(c, garden, 'garden'); assert.equal(f3.r.phase, 'completed'); assert.equal(f3.got?.prop, 'tool');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});

test('playground and lawn spots load: swings, see-saw ends (together), hammocks, picnic blanket', () => {
  const out = loadSpots(WORLD_SPOTS); assert.deepEqual(out.refused, []);
  const by = new Map(out.data.spots.map(s => [s.id, s]));
  for (const id of ['swing-1', 'swing-2', 'seesaw-west', 'seesaw-east', 'hammock-1', 'hammock-2', 'picnic-blanket-w', 'picnic-blanket-n']) assert.ok(by.has(id), id);
  assert.deepEqual(by.get('seesaw-east')!.together, {group: 'seesaw-playground', need: 1, wait: 150, alone: 'fail'});
  assert.deepEqual(loadSpots({contract: 'activity-spots/1', spots: [{...by.get('seesaw-west'), together: {group: 'bad group!', need: 1, wait: 150, alone: 'fail'}}]}).refused, ['spot seesaw-west']);
});

test('stargazing is offered only after dark, and says when the stars come out', () => {
  const data = loadSpots({contract: 'activity-spots/1', spots: []}).data;
  const w = (hour: number | null) => ({me: [0, 0] as [number, number], seated: false, clearance: () => 2, open: () => null, taken: () => false, enterable: () => true, seat: () => null,
    placeName: () => null, ancestors: () => [], groupSize: () => 0, clock: hour === null ? null : {hour, minute: 30}});
  const cap = (hour: number | null) => activityCapabilities(data, w(hour)).caps.find(c => c.id === 'stargaze:here')!;
  assert.equal(cap(22).available, true); assert.equal(cap(3).available, true);
  assert.equal(cap(9).available, false); assert.match(cap(9).blocked!.reason, /20:00 to 05:00.*09:30/);
  assert.equal(cap(null).blocked!.code, 'sky.no-clock');
});

test('leisure: swing, see-saw with a partner (alone: nobody came), hammock, picnic; stargazing refused by day', {timeout: 1800000}, async t => {
  const w = await world(4); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b, c, d] = w.souls;
  // a swing in the playground: seated at the swing's seat height, swinging
  const swing = await w.act(a, 'go on the swings', {seconds: 8}); assert.equal(swing.accepted, true, JSON.stringify(swing)); assert.match(swing.resolved?.to, /^swing:swing-/);
  const s1 = await w.seen(a, swing, 'swing'); assert.equal(s1.r.phase, 'completed'); assert.equal(s1.got?.base, 'sit');
  // see-saw: one end alone waits, then honestly fails; with someone on the other end both ride together and both complete
  const lone = await w.act(b, 'ride the see-saw', {seconds: 6}); assert.equal(lone.accepted, true, JSON.stringify(lone)); assert.match(lone.resolved?.to, /^seesaw:seesaw-/);
  const l1 = await w.done(b, lone); assert.equal(l1.phase, 'failed'); assert.match(JSON.stringify(l1), /Nobody came/);
  const p1 = await w.act(b, 'play on the see-saw', {seconds: 6}); assert.equal(p1.accepted, true, JSON.stringify(p1));
  const p2 = await w.act(c, 'see-saw', {seconds: 6}); assert.equal(p2.accepted, true, JSON.stringify(p2)); assert.notEqual(p2.resolved?.to, p1.resolved?.to);
  let together = 0; await w.run([{soulId: b.soulId, id: p1.receipt.id}, {soulId: c.soulId, id: p2.receipt.id}], 20 * 60 * 5, () => {if (w.body(b).human.activity === 'seesaw' && w.body(c).human.activity === 'seesaw') together++;});
  assert.equal(w.ledger.receipt(b.soulId, p1.receipt.id)!.phase, 'completed', JSON.stringify([w.ledger.receipt(b.soulId, p1.receipt.id), w.ledger.receipt(c.soulId, p2.receipt.id)])); assert.equal(w.ledger.receipt(c.soulId, p2.receipt.id)!.phase, 'completed'); assert.ok(together > 20 * 4, String(together));
  // a hammock: lying on the cloth (seat height), and a picnic on the blanket with food in hand
  const ham = await w.act(d, 'lie in a hammock', {seconds: 6}); assert.equal(ham.accepted, true, JSON.stringify(ham)); assert.match(ham.resolved?.to, /^hammock:hammock-/);
  const h1 = await w.seen(d, ham, 'hammock'); assert.equal(h1.r.phase, 'completed');
  const pic = await w.act(a, 'have a picnic', {seconds: 6}); assert.equal(pic.accepted, true, JSON.stringify(pic)); assert.match(pic.resolved?.to, /^picnic:picnic-blanket-/);
  const pc = await w.seen(a, pic, 'picnic'); assert.equal(pc.r.phase, 'completed'); assert.equal(pc.got?.prop, 'food'); assert.equal(pc.got?.base, 'sit');
  // eating at a picnic TABLE stays eating; stargazing in the morning is refused with the hours, never swapped
  const table = await w.act(c, 'eat lunch at the picnic table'); assert.doesNotMatch(String(table.resolved?.to ?? ''), /^picnic:/);
  const stars = await w.act(b, 'go stargazing'); assert.equal(stars.accepted, false); assert.match(stars.reason ?? JSON.stringify(stars), /stars come out from 20:00/);
  assert.equal((await w.act(b, 'swing by the cafe')).resolved?.to?.startsWith('swing:') ?? false, false);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});

test('bicycles: ride from the park-gate dock around the park and back, or to a place and back', {timeout: 1800000}, async t => {
  const w = await world(2); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b] = w.souls;
  const ride = await w.act(a, 'go for a bike ride around the park'); assert.equal(ride.accepted, true, JSON.stringify(ride)); assert.match(ride.resolved?.to, /^cycle-around:/);
  let seen = 0, fastest = 0, prev: number[] | null = null;
  const r = await w.done(a, ride, 20 * 60 * 8, () => {const e = w.body(a); if (e.human.activity === 'cycle') {seen++; if (prev) fastest = Math.max(fastest, Math.hypot(e.pose.p[0] - prev[0], e.pose.p[2] - prev[2]) * 20);} prev = [...e.pose.p];});
  assert.equal(r.phase, 'completed', JSON.stringify(r)); assert.ok(seen > 20 * 10, String(seen)); assert.ok(fastest > 3 && fastest <= 4.5 * 1.25 + 1e-6, String(fastest));
  // back at the dock afterwards
  const end = w.body(a).pose.p; assert.ok(Math.hypot(end[0] - 4.05, end[2] - 83.1) < 1, JSON.stringify(end));
  // to a place and back; "ride a skateboard" stays refused
  const to = await w.act(b, 'ride a bike to the commons'); assert.equal(to.accepted, true, JSON.stringify(to)); assert.match(to.resolved?.to, /^cycle:/);
  const sk = await w.act(a, 'ride a skateboard'); assert.equal(sk.accepted, false);
  // the seaside Ferris wheel and carousel are scenery: refused honestly, never a balloon or a walk instead
  for (const words of ['ride the ferris wheel', 'go on the carousel']) {const r = await w.act(b, words); assert.equal(r.accepted, false, words); assert.match(r.reason ?? '', /scenery for now/);}
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('group life: story circle needs a teller, book club, cooking together, yoga class, bandstand dance and a concert', {timeout: 1800000}, async t => {
  const w = await world(4); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b, c, d] = w.souls;
  const pair = async (x: typeof a, xw: string, y: typeof a, yw: string, verb: string, pose: string) => {
    const p = await w.act(x, xw, {seconds: 6}), q = await w.act(y, yw, {seconds: 6});
    for (const [r, words] of [[p, xw], [q, yw]] as const) {assert.equal(r.accepted, true, words + ' ' + JSON.stringify(r)); assert.match(r.resolved?.to, new RegExp('^' + verb + ':'), words + ' ' + JSON.stringify(r.resolved ?? r).slice(0, 500));}
    let both = 0; await w.run([{soulId: x.soulId, id: p.receipt.id}, {soulId: y.soulId, id: q.receipt.id}], 20 * 60 * 6, () => {if (w.body(x).human.activity === pose && w.body(y).human.activity === pose) both++;});
    for (const [s, r] of [[x, p], [y, q]] as const) assert.equal(w.ledger.receipt(s.soulId, r.receipt.id)!.phase, 'completed', `${verb}: ${JSON.stringify(w.ledger.receipt(s.soulId, r.receipt.id))}`);
    assert.ok(both >= 20 * 5, `${verb} together for ${both} ticks`);
  };
  // nobody is telling a story yet: joining the circle is refused, never swapped
  const early = await w.act(b, 'join the story circle'); assert.equal(early.accepted, false, JSON.stringify(early)); assert.match(early.reason ?? '', /Nobody is at/);
  const teller = await w.act(a, 'tell a story', {seconds: 6}); assert.equal(teller.accepted, true, JSON.stringify(teller)); assert.match(teller.resolved?.to, /^tell-story:/);
  await w.run([], 20 * 50);   // the teller walks to the circle
  const hear = await w.act(b, 'listen to a story', {seconds: 6}); assert.equal(hear.accepted, true, JSON.stringify(hear)); assert.match(hear.resolved?.to, /^hear-story:story-log-/);
  await w.run([{soulId: a.soulId, id: teller.receipt.id}, {soulId: b.soulId, id: hear.receipt.id}], 20 * 60 * 6);
  assert.equal(w.ledger.receipt(a.soulId, teller.receipt.id)!.phase, 'completed'); assert.equal(w.ledger.receipt(b.soulId, hear.receipt.id)!.phase, 'completed');
  await pair(c, 'cook together', d, 'cook with friends', 'cook-together', 'cook');
  await pair(a, 'join the book club', b, 'read with friends', 'book-club', 'read');
  await pair(c, 'join the yoga class', d, 'yoga class', 'yoga-class', 'yoga');
  // a dance on the bandstand and a concert may start alone after a short wait
  const dance = await w.act(a, 'dance on the bandstand', {seconds: 6}); assert.match(dance.resolved?.to, /^social-dance:bandstand-dance-/);
  const gig = await w.act(b, 'give a concert', {seconds: 6}); assert.match(gig.resolved?.to, /^(?:play-music|sing):stage-/, JSON.stringify(gig));
  assert.equal((await w.done(a, dance, 20 * 60 * 6)).phase, 'completed'); assert.equal((await w.done(b, gig, 20 * 60 * 6)).phase, 'completed');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});

test('upper-floors/1: a level-0 spot inside a building (a hotel lobby sofa) is walked to with its level from upstairs, plainly from the ground', () => {
  const spot = {id: 'lobby-sofa', place: 'lobby', activity: 'read', base: 'sit', at: [10, 10], faceTo: [11, 10], seatHeight: 0.45, level: 0, label: 'Lobby sofa'};
  const data = loadSpots({contract: 'activity-spots/1', spots: [spot]}).data;
  const w = (level: number) => ({me: [10, 12] as [number, number], level, seated: false, clearance: () => 2, open: () => null, taken: () => false, enterable: () => true, seat: () => null,
    placeName: () => null, ancestors: () => [], groupSize: () => 0, clock: null});
  const reach = (level: number) => activityCapabilities(data, w(level)).plans.get('read:lobby-sofa')!.steps.find(s => /walk_to/.test(s.verb))!;
  assert.deepEqual(reach(18), {verb: 'mars:walk_to', params: {x: 10, z: 10, level: 0}}, 'from the first floor: down the stairs, not across the floor above');
  assert.deepEqual(reach(0), {verb: 'walk_to', params: {to: [10, 10]}}, 'from the ground: unchanged');
});

test('SPOTS: a stand spot wedged against furniture walks to clear ground behind it; one with none near is not offered, wherever the Soul stands', () => {
  const spots = [{id: 'easel-a', place: 'studio', activity: 'paint', base: 'idle', at: [0, 0], faceTo: [0, -1], label: 'Easel A'},
    {id: 'easel-b', place: 'studio', activity: 'paint', base: 'idle', at: [20, 0], faceTo: [20, -1], label: 'Easel B'}];
  const data = loadSpots({contract: 'activity-spots/1', spots}).data;
  // easel A: 0.15 m of room at the spot (a table edge; no standing room within the walk's 0.35 m goal snap), open floor from 0.4 m back
  // easel B: in a corner, 0 at the spot and at most 0.15 m anywhere behind it
  const clearance = (x: number, z: number) => x < 10 ? (z >= 0.4 - 1e-9 ? 0.5 : 0.15) : (Math.abs(z - 0.4) < 0.25 ? 0.15 : 0);
  const w = (me: [number, number]) => ({me, seated: false, clearance, open: () => null, taken: () => false, enterable: () => true, seat: () => null,
    placeName: () => null, ancestors: () => [], groupSize: () => 0, clock: null});
  for (const me of [[5, 3], [20.5, 0]] as [number, number][]) {
    const {plans} = activityCapabilities(data, w(me));
    assert.deepEqual(plans.get('paint:easel-a')?.steps.find(s => /walk_to/.test(s.verb)), {verb: 'walk_to', params: {to: [0, 0.4]}}, `easel A from ${me}: from clear ground`);
    assert.equal(plans.has('paint:easel-b'), false, `easel B from ${me}: not offered (route.goal-blocked)`);
  }
});
test('SPOTS: a seat at a group someone is waiting in is offered past the nearest-N cap ("join them")', () => {
  const club = (id: string, x: number, group: string) => ({id, place: 'library', activity: 'book-club', base: 'sit', at: [x, 0], faceTo: [x, 1], seatHeight: 0.45, label: id,
    together: {group, need: 1, wait: 150, alone: 'fail'}});
  const data = {...loadSpots({contract: 'activity-spots/1', spots: [club('near', 2, 'g-near'), club('far', 40, 'g-far')]}).data, nearest: 1};   // as god/activity-spots.ts derives it
  const w = (waiting: string | null) => ({me: [0, 0] as [number, number], seated: false, clearance: () => 2, open: () => null, taken: () => false, enterable: () => true,
    seat: () => null, placeName: () => null, ancestors: () => [], groupSize: (g: string) => g === waiting ? 1 : 0, clock: null});
  const ids = (waiting: string | null) => activityCapabilities(data, w(waiting)).caps.filter(c => c.verb === 'book-club').map(c => c.id).sort();
  assert.deepEqual(ids(null), ['book-club:near'], 'nobody waiting: the nearest one only');
  assert.deepEqual(ids('g-far'), ['book-club:far', 'book-club:near'], 'someone waits at the far table: it is offered too');
  assert.match(activityCapabilities(data, w('g-far')).caps.find(c => c.id === 'book-club:far')!.label, /1 waiting on the other end, join them/);
});
