// CN5 (Gene 2026-10-07): World's event kit, computers, gym and park games become native activities at World's spots —
// use a computer, bench press / weights / pull-ups / dips, sing at a microphone, play the drums on the stage (up its ramp),
// listen from the amphitheatre steps, and choreographed pétanque, frisbee and volleyball (the world keeps the turns).
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {kernelHash} from '@souls/kernel';
import {HUMAN_RADIUS} from '../../../mars/viewer/engine/world/catalog.ts';
import {edenNavWorld, factory, inSolid, CN5_SPOTS} from '../test/eden-nav-fixture.ts';
import {WorldHost} from './world.ts';
import {loadSpots, gameCourts} from './edge/ledger/activities.ts';

async function world(n: number) {
  const w = await edenNavWorld(n, {cn5: true});
  const body = (s: {entityId: string}) => (w.engine.world.entities as any)[s.entityId];
  const act = async (s: typeof w.souls[number], capability: string, params?: object) => {const out: any = await w.act(s, capability, params); assert.equal(out.accepted, true, capability + ' ' + JSON.stringify(out)); return out;};
  const inside: string[] = [];
  const watch = () => {for (const s of w.souls) {const e = body(s); if (!e?.human || (e.human.level ?? 0) !== 0) continue; for (const q of w.spec!.solids) if (inSolid(e.pose.p[0], e.pose.p[2], q, HUMAN_RADIUS * 0.5)) inside.push(`${s.name} in ${q.id}`);}};
  /** Run until the receipt ends; `each` sees every tick. Returns the receipt. */
  const done = async (s: typeof w.souls[number], out: any, limit = 20 * 60 * 5, each?: () => void) => {await w.run([{soulId: s.soulId, id: out.receipt.id}], limit, () => {watch(); each?.();}); return w.ledger.receipt(s.soulId, out.receipt.id)!;};
  const replayExact = async () => {
    w.f.host.drainInputs(); w.f.host.saveSnapshot(true); const head = {engine: w.f.host.engine.stateHash(), kernel: kernelHash(w.f.host.kernel)};
    w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.f.host.worldId);
    const h = new WorldHost(w.f.db, await factory(), w.f.host.seed, 1e9, w.f.host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
    assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, 'replay exact'); h.stop();
  };
  const ticks = async (n: number) => {for (let i = 0; i < n; i++) {w.f.host.tickOnce(); watch(); if (i % 20 === 0) {await setImmediate(); w.f.host.drainInputs();}}};
  return {...w, body, act, done, inside, replayExact, ticks};
}

test('cn5 spots: every World spot and platform is accepted (no refused kinds)', () => {
  const out = loadSpots(CN5_SPOTS);
  assert.deepEqual(out.refused, []);
  for (const id of ['stage-mic-1', 'stage-mic-2', 'amph-mic', 'amph-seat-2-1', 'amph-seat-3-6', 'pc-office-1', 'gym-bench-press', 'sport-petanque-1', 'sport-frisbee-2', 'sport-volleyball-4']) assert.ok(out.data.spots.some(s => s.id === id), id);
  assert.equal(out.data.platforms.length, 5);
  const courts = gameCourts(out.data.spots, {clearance: () => 1});
  // Soul Actions entry 7 (frisbee clearance, accepted 2026-10-30): a frisbee court with two authored ends is a pair plus one
  // broad triangle corner (3 places, maxPlayers 3) under the clear-v1 flight policy, no longer padded to six like the other games.
  assert.deepEqual(courts.map(c => [c.activity, c.slots.length]), [['play-frisbee', 3], ['play-petanque', 6], ['play-volleyball', 6]]);
  const frisbee = courts.find(c => c.game.kind === 'frisbee')!;
  assert.equal(frisbee.game.flightPolicy, 'clear-v1'); assert.equal(frisbee.maxPlayers, 3); assert.equal(frisbee.slots[2].id, 'sport-frisbee-1.triangle');
  assert.deepEqual(courts.find(c => c.game.kind === 'volleyball')!.game.net, [18, 111, 18, 121], 'the net halfway between the sides');
});

test('cn5 activities: use a computer, the gym (bench press, weights, pull-ups, dips), drums on the stage, sing and listen at the amphitheatre', {timeout: 1800000}, async t => {
  const w = await world(3); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b, c] = w.souls;
  const seen = (s: typeof a, out: any, activity: string, limit?: number) => {let got: any = null; return w.done(s, out, limit, () => {const h = w.body(s).human; if (h.activity === activity) got ??= {base: h.baseActivity, prop: h.prop, seatHeight: h.seatHeight, instrument: h.instrument, at: [w.body(s).pose.p[0], w.body(s).pose.p[2]]};}).then(r => {assert.equal(r.phase, 'completed', JSON.stringify(r)); assert.ok(got, `${activity} seen`); return got;});};
  // a computer: the nearest free one, seated at the desk height
  const pc = await w.act(a, 'use a computer', {seconds: 6}); assert.match(pc.resolved?.to, /^use-computer:pc-/);
  const pcPose = await seen(a, pc, 'use-computer'); t.diagnostic('computer ' + JSON.stringify({to: pc.resolved.to, pcPose}));
  assert.equal(pcPose.base, 'sit'); assert.equal(pcPose.seatHeight, 0.57);
  // the outdoor gym in the park
  const bench = await w.act(b, 'do a bench press', {seconds: 5}); assert.equal(bench.resolved?.to, 'bench-press:gym-bench-press');
  const benchPose = await seen(b, bench, 'bench-press'); assert.equal(benchPose.seatHeight, 0.49, 'lying on the bench top');
  assert.ok(Math.hypot(benchPose.at[0] + 4.75, benchPose.at[1] - 85) < 0.3, 'on the bench');
  const weights = await w.act(b, 'lift weights', {seconds: 5}); assert.equal(weights.resolved?.to, 'lift-weights:gym-weights');
  assert.equal((await seen(b, weights, 'lift-weights')).prop, 'dumbbell');
  const pull = await w.act(b, 'do some pull-ups', {seconds: 5}); assert.match(pull.resolved?.to, /^pull-ups:gym-pull-ups-/); await seen(b, pull, 'pull-ups');
  const dips = await w.act(b, 'dips', {seconds: 5}); assert.equal(dips.resolved?.to, 'dips:gym-dips'); await seen(b, dips, 'dips');
  // the drums on the performance stage: up its ramp (the deck's edges are walled except at the ramp)
  const drums = await w.act(c, 'play the drums', {seconds: 6}); assert.equal(drums.resolved?.to, 'play-music:stage-drums');
  let viaRamp = false; const drumPose = await seen(c, drums, 'play-music', 20 * 60 * 5);
  t.diagnostic('drums ' + JSON.stringify(drumPose));
  assert.equal(drumPose.instrument, 'drums'); assert.equal(drumPose.seatHeight, 0.88); assert.ok(Math.hypot(drumPose.at[0] - 92, drumPose.at[1] + 31.65) < 0.3, 'at the drum kit');
  const down = await w.act(c, 'walk:eden-amphitheatre');
  await w.done(c, down, 20 * 60 * 5, () => {const p = w.body(c).pose.p; if (p[1] === 0 && p[0] > 91 && p[0] < 93 && p[2] > -27.5 && p[2] < -25) viaRamp = true;});
  assert.ok(viaRamp, 'came down the ramp');
  const sing = await w.act(c, 'sing at the amphitheatre', {seconds: 5}); assert.equal(sing.resolved?.to, 'sing:amph-mic'); await seen(c, sing, 'sing');
  const listen = await w.act(a, 'listen to the concert', {seconds: 5}); assert.match(listen.resolved?.to, /^listen:amph-seat-/);
  const lp = await seen(a, listen, 'listen', 20 * 60 * 5); assert.equal(lp.base, 'sit'); assert.ok([0.32, 0.48].includes(lp.seatHeight));
  assert.deepEqual(w.inside.slice(0, 5), [], 'no footprint crossings');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});

test('cn5 games: pétanque (two, then a third joins and one leaves), frisbee pair with a held frisbee, volleyball rally across the net; turns agree on every body; exact replay', {timeout: 1800000}, async t => {
  const w = await world(4); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b, c, d] = w.souls, h = (s: typeof a) => w.body(s).human;
  // pétanque: two players at the throwing end, the world keeps the turns
  for (const s of [a, b, c]) assert.equal((await w.done(s, await w.act(s, 'walk:region-park.playground'))).phase, 'completed');
  const pa = await w.act(a, 'play petanque', {seconds: 900}), pb = await w.act(b, 'play pétanque', {seconds: 900});
  assert.match(pa.resolved?.to, /^play-petanque:sport-petanque-/); assert.match(pb.resolved?.to, /^play-petanque:sport-petanque-/); assert.notEqual(pa.resolved.to, pb.resolved.to);
  const throwers: string[] = []; let agree = 0, ends = 0, both = false;
  const enough = Object.assign(new Error('enough'), {enough: true}), until = (e: any) => {if (!e.enough) throw e;};
  await w.run([{soulId: a.soulId, id: pa.receipt.id}], 20 * 60 * 5, () => {
    const ga = h(a).game, gb = h(b).game; if (!ga || !gb || ga.waiting || gb.waiting) return;
    both = true; assert.deepEqual([ga.turn, ga.from, ga.players], [gb.turn, gb.from, gb.players], 'both bodies agree on the turn'); agree++;
    if (throwers.at(-1) !== `${ga.turn}:${ga.from}`) throwers.push(`${ga.turn}:${ga.from}`);
    if (ga.lastWinner && ga.end! > ends) ends = ga.end!;
    if (throwers.length >= 10 && ends >= 1) throw enough;
  }).catch(until);
  t.diagnostic('petanque ' + JSON.stringify({agree, throwers: throwers.slice(0, 10), ends, game: h(a).game}));
  assert.ok(both && agree > 100, 'the game ran');
  const order = throwers.slice(0, 6).map(x => x.split(':')[1]); assert.ok(order.every((x, i) => i === 0 || x !== order[i - 1]), 'turns alternate: ' + order.join(' '));
  assert.ok(ends >= 1 && h(a).game.jack, 'an end was won');
  // a third player joins (an extra place beside the throwing end), then the first leaves; the game goes on
  const pc = await w.act(c, 'play petanque', {seconds: 900}); assert.match(pc.resolved?.to, /^play-petanque:sport-petanque-\d\.p\d$/);
  await w.run([{soulId: c.soulId, id: pc.receipt.id}], 20 * 60 * 3, () => {if (h(c).game?.players?.length === 3) throw enough;}).catch(until);
  assert.equal(h(c).game.players.length, 3, 'three playing');
  await w.act(a, 'stand up');
  await w.ticks(400);
  assert.equal(h(b).game.players.length, 2, 'two left playing'); assert.ok(!h(b).game.players.includes(a.entityId));
  for (const s of [b, c]) await w.act(s, 'stand up');
  // frisbee: d picks up a frisbee in the park; with c they throw back and forth (d starts: it is d's frisbee)
  assert.equal((await w.done(d, await w.act(d, 'walk:region-park.playground'))).phase, 'completed');
  const pick = await w.act(d, 'pick up a frisbee'); assert.equal((await w.done(d, pick)).phase, 'completed'); assert.equal(h(d).holding, 'frisbee');
  const fd = await w.act(d, 'throw a frisbee', {seconds: 60}), fc = await w.act(c, 'play frisbee', {seconds: 60});
  const flights: string[] = []; let held = 0;
  await w.run([{soulId: d.soulId, id: fd.receipt.id}], 20 * 60 * 4, () => {
    const g = h(d).game; if (!g || g.waiting) return;
    const key = `${g.from}>${g.to}`; if (flights.at(-1) !== key) flights.push(key);
    if (h(d).prop === 'frisbee' && h(c).prop === 'frisbee') assert.fail('one frisbee');
    if (h(d).prop === 'frisbee' || h(c).prop === 'frisbee') held++;
  });
  t.diagnostic('frisbee ' + JSON.stringify({flights: flights.slice(0, 6), held, ends: [w.body(c).pose.p, w.body(d).pose.p].map(p => [p[0].toFixed(1), p[2].toFixed(1)])}));
  assert.ok(flights.length >= 6, 'back and forth'); assert.equal(flights[0].split('>')[0], d.entityId, 'the frisbee owner throws first');
  // entry 7: both ends stand clear of the pond's rim and the bench by the flight margin (z 117.25 and 126.5, was 116.5 and 127)
  assert.ok(Math.abs(w.body(c).pose.p[2] - w.body(d).pose.p[2]) > 9, 'at the two ends of the lawn');
  assert.equal(h(d).holding, 'frisbee', 'the frisbee is still d\'s');
  // volleyball: two players across the net, the rally alternates sides
  const va = await w.act(a, 'play volleyball', {seconds: 40}), vb = await w.act(b, 'play beach volleyball', {seconds: 40});
  const side = (s: typeof a) => w.body(s).pose.p[0] < 18 ? 'W' : 'E', hits: string[] = [];
  await w.run([{soulId: a.soulId, id: va.receipt.id}, {soulId: b.soulId, id: vb.receipt.id}], 20 * 60 * 4, () => {const g = h(a).game; if (g && !g.waiting && hits.at(-1) !== `${g.turn}:${g.from}`) hits.push(`${g.turn}:${g.from}`);});
  t.diagnostic('volleyball ' + JSON.stringify({sides: [side(a), side(b)], hits: hits.slice(0, 6)}));
  assert.notEqual(side(a), side(b), 'one each side of the net');
  assert.ok(hits.length >= 6 && hits.slice(0, 6).every((x, i) => i === 0 || x.split(':')[1] !== hits[i - 1].split(':')[1]), 'the rally crosses the net every hit');
  assert.deepEqual(w.inside.slice(0, 5), [], 'no footprint crossings');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});

test('cn5 acceptance: a picnic seat inside its table box is used from just behind it; a gesture far off offers go-near; the brisk balloon loop', {timeout: 900000}, async t => {
  const {carrierEntity, setCarrierRoute} = await import('../../../mars/viewer/engine/vehicles/carrier.ts');
  const e: any = carrierEntity({id: 'b1', def: 'hot-air-balloon', at: [-20, -9], yaw: Math.PI, route: 'eden-commons-loop'}, 0);
  assert.equal(setCarrierRoute({entities: {b1: e}}, 'b1', 'eden-commons-loop-brisk'), true);
  assert.equal(e.carrier.route.id, 'eden-commons-loop-brisk'); assert.equal(e.carrier.route.keys.at(-1).t, 672, '11.2 min');
  e.carrier.phase = 'aloft'; assert.equal(setCarrierRoute({entities: {b1: e}}, 'b1', 'eden-commons-loop'), false, 'never mid-flight');
  const w = await world(2); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b] = w.souls;
  const eat = await w.act(a, 'eat:picnic-1-south-w', {seconds: 5}); let sat: any = null;
  const r = await w.done(a, eat, 20 * 60 * 5, () => {const h = w.body(a).human; if (h.activity === 'eat') sat ??= {base: h.baseActivity, at: [w.body(a).pose.p[0], w.body(a).pose.p[2]]};});
  t.diagnostic('picnic ' + JSON.stringify({r: r.phase, code: r.code, sat}));
  assert.equal(r.phase, 'completed', JSON.stringify(r)); assert.equal(sat?.base, 'sit'); assert.ok(Math.hypot(sat.at[0] - 54.55, sat.at[1] + 21.78) < 1, 'at the picnic table');
  // b is far off (tens of metres): a hug offers go-near first
  const hug: any = await import('../test/native-owner-fixture.ts').then(m => m.accept(w.f.host, w.ledger.act(b, {capability: 'hug ' + a.name})));
  if (!hug.accepted) {assert.match(hug.code, /gesture.too-far|soul.not-in-sight/); assert.ok(hug.did_you_mean?.length, JSON.stringify(hug));}
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});
