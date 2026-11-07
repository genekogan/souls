import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldModel, containerInside} from '../../packages/world-compiler/src/index.ts';
import {TakeRecorder} from '../../mars/viewer/engine/take/recorder.ts';

// Entry 42: things put into a drawer or a locker by hand and taken out again (by the same Soul or another one with access).
const out = process.env.SOUL_ACTIONS_OUT;
test('storage inside containers: words, refusals, real contents, lip-clear arcs, another Soul, persistence, bounded perception', {timeout: 600000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => {comms.close(); f.host.stop(); f.db.close();});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 const ok = r => {assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
 const souls = {};
 const join = async (key, name) => {await invite(f, key); const row = await accept(f.host, f.souls.create('dev:' + key, {name, description: 'Storage test'})); souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();};
 await tick(); await join('ana', 'Ana'); soul = souls.Ana;
 const here = async () => {const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here;};
 const bytes = h => JSON.stringify(h).length;
 const absent = await here();
 // 100 distant chests, half open, each with a bowl kept inside
 const distant = Array.from({length: 100}, (_, i) => [{op: 'place', def: 'core/drawer-chest@3', name: `distant-chest-${i}`, p: [120 + i % 10 * 2, 120 + Math.floor(i / 10) * 2], state: {open: i % 2 === 0}}, {op: 'place', def: 'core/bowl@2', name: `distant-bowl-${i}`, in: {parent: `distant-chest-${i}`, slot: 'in-1'}, p: [0, 0]}]).flat();
 ok(god.act({ops: distant})); await tick(45);
 const ent = n => {const e = [...god.model.entities.values()].find(e => e.name === n); assert.ok(e, 'entity ' + n); return e;};
 const far = await here(), farIds = new Set(distant.map(d => ent(d.name).id));
 assert.equal(bytes(far), bytes(absent), '100 distant chests with bowls inside add no bytes');
 assert.ok(!JSON.stringify(far).includes('distant-'));
 const farCaps = edge.capabilities(soul);
 assert.deepEqual(farCaps.filter(c => c.verb !== 'walk' && ((c.object && farIds.has(c.object)) || (c.target && farIds.has(c.target.id)))).map(c => c.id), [], 'no distant offers (walks to named things are the existing catalogue, counted apart)');
 assert.ok(!farCaps.some(c => c.verb === 'walk' && /distant-bowl-(\d*[13579])\b/.test(c.id)), 'a bowl kept in a shut chest is not even a walk target');
 assert.equal(f.host.engine.world.entities[ent('distant-bowl-0').id].support.slot, 'in-1', 'god-placed contents rest inside in the engine');
 const idle = new TakeRecorder(f.host.engine.rt, {rulesVersion: 'storage-proof'}); await tick(4);
 assert.ok(!Object.keys(idle.finish().tracks).some(id => farIds.has(id)), 'no idle tracks for distant contents');

 const body = (s = soul) => f.host.engine.world.entities[s.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
 ok(god.act({ops: [
  {op: 'place', def: 'core/table@1', name: 'table', p: [ax + 2.4, az - 0.6]},
  {op: 'place', def: 'core/bowl@2', name: 'bowl', in: {parent: 'table', slot: 'top'}, p: [0.25, 0]},
  {op: 'place', def: 'core/lantern@3', name: 'lantern', in: {parent: 'table', slot: 'top'}, p: [-0.25, 0], state: {on: false}},
  {op: 'place', def: 'core/drawer-chest@3', name: 'chest', p: [ax + 1, az + 2.6], r: Math.PI},
  {op: 'place', def: 'core/lockers@3', name: 'locker', p: [ax - 2.2, az + 2.6], r: Math.PI},
  {op: 'place', def: 'core/drawer-chest@3', name: 'private-chest', p: [ax + 4.5, az + 2.6], r: Math.PI, access: 'private', state: {open: true}}]}));
 await tick(60);
 const id = n => ent(n).id, state = n => ent(n).state ?? {}, item = n => f.host.engine.world.entities[id(n)];
 const act = async (words, accepted = true, who = soul) => {const prev = soul; soul = who; try {const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})); const b = await r.json(); assert.equal(b.accepted, accepted, words + ' ' + JSON.stringify(b).slice(0, 500)); return b;} finally {soul = prev;}};
 // chest-local frame (+z out of its front); the engine samples every tick while a transfer runs
 const frame = n => {const e = ent(n), wp = god.model.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return {wp, ins: containerInside(god.model.resolvedDef(e.def)), local: p => [(p[0] - wp.x) * c - (p[2] - wp.z) * s, p[1] - wp.y, (p[0] - wp.x) * s + (p[2] - wp.z) * c]};};
 const finish = async (r, who = soul, watch = null, limit = 1600) => {
  const lip = {min: Infinity, at: null}, size = watch?.size, half = size ? Math.max(size[0], size[2]) / 2 : 0.05, track = [];
  for (let n = 0; n < limit; n++) {
   if (watch) {const b = body(who), fr = watch.fr, hand = b.human?.hands?.right, it = f.host.engine.world.entities[watch.item], held = it.support?.kind === 'in-hand', t = b.human?.itemTransferV1;
    if (t && hand) {const ph = held ? fr.local(it.pose.p) : fr.local(hand), drop = held ? 0 : 0.04, w = held ? Math.max(watch.isize[0], watch.isize[2]) / 2 : 0.05;
     track.push({tick: f.host.engine.world.tick, reach: t.reachTick !== undefined, held, p: ph.map(v => +v.toFixed(4)), hand: fr.local(hand).map(v => +v.toFixed(4))});
     // the lip rule holds while the hand goes in and comes out (reach / withdraw), across the container's mouth (its x span)
     if (t.reachTick !== undefined && Math.abs(ph[0] - watch.mouthX) <= watch.mouthHalf + w && ph[2] + w >= fr.ins.face - 0.02 && ph[2] - w <= fr.ins.face) {const m = ph[1] - drop - fr.ins.lip; if (m < lip.min) {lip.min = m; lip.at = {tick: f.host.engine.world.tick, held, p: ph};}}}}
   const ph = edge.receipt(who.soulId, r.receipt.id)?.phase; if (['completed', 'failed', 'cancelled', 'replaced'].includes(ph)) return {phase: ph, lip, track, receipt: edge.receipt(who.soulId, r.receipt.id)};
   await tick(1);
  }
  throw Error('timed out ' + r.receipt.capability);
 };
 const done = async (words, who = soul, watch = null) => {const r = await act(words, true, who); const x = await finish(r, who, watch); assert.equal(x.phase, 'completed', words + ' ' + JSON.stringify(x.receipt).slice(0, 600)); return {...x, capability: r.receipt.capability};};
 const results = {}, refusals = {};
 const refuse = async (words, code, who = soul) => {const b = await act(words, false, who); refusals[words + (who === soul ? '' : ' (' + who.name + ')')] = {code: b.code, reason: b.reason}; if (code) assert.equal(b.code, code, words + ' ' + JSON.stringify(b)); return b;};
 const bowl = id('bowl'), bowlSize = [0.25, 0.1, 0.25], chest = frame('chest'), locker = frame('locker');
 const insideDrawer = h => Math.abs(h[0]) <= 0.4 && h[2] >= 0.13 && h[2] <= 0.55 && h[1] >= 1.0 && h[1] <= 1.21;

 // Ana takes the bowl from the table; the drawer is shut
 results.pickUp = await done('pick up the bowl');
 assert.equal(item('bowl').support.kind, 'in-hand');
 await refuse('put the bowl in the drawer', 'container.closed');
 results.open = await done('open the drawer');
 assert.equal(state('chest').open, true);
 const holdingNear = await here();
 const putCap = edge.capabilities(soul).find(c => c.id === `put-in:${id('chest')}`);
 assert.ok(putCap?.available, 'put-in offered while holding near the open chest ' + JSON.stringify(edge.capabilities(soul).filter(c => /put|pick/.test(c.verb)).map(c => [c.id, c.label, c.available, c.blocked?.code])));
 // in: up over the drawer front and down to its place; the same bowl rests inside
 const put = await done('put the bowl in the drawer', soul, {item: bowl, fr: chest, isize: bowlSize, mouthX: 0, mouthHalf: 0.42});
 assert.match(put.capability, new RegExp(`put-in:${id('chest')}$`));
 assert.equal(item('bowl').support.kind, 'resting-on'); assert.equal(item('bowl').support.on, id('chest')); assert.equal(item('bowl').support.slot, 'in-1');
 assert.equal(ent('bowl').id, bowl); assert.equal(ent('bowl').in.parent, id('chest')); assert.equal(ent('bowl').in.slot, 'in-1');
 assert.ok(put.lip.min >= 0, 'the bowl passes over the drawer front: ' + JSON.stringify(put.lip));
 const release = put.track.filter(s => !s.held)[0]; assert.ok(release && insideDrawer(release.hand), 'the hand lets go inside the drawer ' + JSON.stringify(release));
 results.put = {lipMargin: +put.lip.min.toFixed(4), releaseHand: release.hand, samples: put.track.length};
 const openWith = await here(), row = openWith.objects.find(o => o.id === id('chest'));
 assert.deepEqual(row?.state, {open: true, holds: ['bowl']}, 'the open drawer shows what is in it');
 results.close = await done('close the drawer');
 const shut = await here(), shutText = JSON.stringify(shut);
 assert.deepEqual(shut.objects.find(o => o.id === id('chest'))?.state, {open: false}, 'a shut chest shows only that it is shut');
 assert.ok(!shutText.includes(bowl) && !shutText.includes('holds'), 'nothing about the bowl while the drawer is shut');
 assert.ok(!edge.capabilities(soul).some(c => c.target?.id === bowl), 'no offer for the hidden bowl');
 await refuse('take the bowl out of the chest', 'container.closed');

 // Bea, another Soul with access, opens it and takes Ana's bowl out
 await join('bea', 'Bea');
 await refuse('open the private chest', 'object.private', souls.Bea);
 results.beaOpen = await done('open the drawer', souls.Bea);
 const take = await done('take the bowl out of the chest', souls.Bea, {item: bowl, fr: chest, isize: bowlSize, mouthX: 0, mouthHalf: 0.42});
 assert.match(take.capability, new RegExp(`pick-up:${bowl}$`));
 assert.equal(item('bowl').support.kind, 'in-hand'); assert.equal(item('bowl').support.by, souls.Bea.entityId);
 assert.ok(take.lip.min >= 0, 'hand and bowl pass over the drawer front: ' + JSON.stringify(take.lip));
 const grasp = take.track.find(s => s.held); assert.ok(grasp && insideDrawer(grasp.hand), 'the hand takes it inside the drawer ' + JSON.stringify(grasp));
 results.take = {lipMargin: +take.lip.min.toFixed(4), graspHand: grasp.hand, samples: take.track.length};
 await refuse('put the bowl in the private chest', 'object.private', souls.Bea);
 // interrupted before the release: the bowl stays in her hand, the drawer stays empty
 {const r = await act('put the bowl in the drawer', true, souls.Bea); for (let n = 0; n < 600 && !body(souls.Bea).human?.itemTransferV1?.reachTick; n++) await tick(1); await tick(6);
  await accept(f.host, edge.act(souls.Bea, {capability: 'stand:here'})); await tick(60);
  assert.equal(edge.receipt(souls.Bea.soulId, r.receipt.id).phase, 'replaced'); assert.equal(item('bowl').support.kind, 'in-hand', 'interrupted: still in her hand');
  assert.equal(ent('bowl').in.parent, souls.Bea.entityId); results.interrupted = 'bowl stayed in hand, drawer empty';}
 // contention: Ana cannot shut the drawer on Bea's hand
 {const r = await act('put the bowl in the drawer', true, souls.Bea); for (let n = 0; n < 600 && !body(souls.Bea).human?.itemTransferV1?.reachTick; n++) await tick(1);
  await refuse(`object:${id('chest')}:close`, 'container.in-use');   // (exact id: the private chest is open too, so the words alone are ambiguous while both refuse)
  const x = await finish(r, souls.Bea); assert.equal(x.phase, 'completed'); assert.equal(item('bowl').support.on, id('chest'));}

 // the lantern: too tall for the drawer, kept in the locker instead (same mechanism, a hinged door and a shelf)
 results.lanternUp = await done('pick up the lantern');
 await refuse('put the lantern in the drawer', 'item.does-not-fit');
 await refuse('put the lantern in the locker', 'container.closed');
 results.lockerOpen = await done('open the locker');
 const lantern = id('lantern'), lanternSize = [0.22, 0.453, 0.22];
 const inLocker = await done('put the lantern in the locker', soul, {item: lantern, fr: locker, isize: lanternSize, mouthX: -0.3, mouthHalf: 0.135});
 assert.equal(item('lantern').support.on, id('locker')); assert.equal(ent('lantern').in.slot, 'in-1');
 assert.ok(inLocker.lip.min >= 0, 'the lantern passes over the shelf edge: ' + JSON.stringify(inLocker.lip));
 const lockRelease = inLocker.track.filter(s => !s.held)[0], inCompartment = h => h[0] >= -0.435 && h[0] <= -0.165 && h[2] >= -0.21 && h[2] <= 0.236 && h[1] >= 1.05 && h[1] <= 1.76;
 assert.ok(lockRelease && inCompartment(lockRelease.hand), 'the hand lets go inside the locker ' + JSON.stringify(lockRelease));
 results.locker = {lipMargin: +inLocker.lip.min.toFixed(4), releaseHand: lockRelease.hand};
 const lockerOpen = await here();
 assert.deepEqual(lockerOpen.objects.find(o => o.id === id('locker'))?.state, {open: true, locked: false, holds: ['lantern']});
 results.lockerClose = await done('close the locker');
 const lockerShut = await here();
 {const txt = JSON.stringify(lockerShut), i = txt.indexOf(lantern); assert.ok(i < 0, 'a lantern in a shut locker is not seen: ' + txt.slice(Math.max(0, i - 400), i + 200));}
 // a lit light is not put away (fixture: switched on by the world, as a lamp left lit)
 results.lockerReopen = await done('open the locker');
 results.lanternOut = await done('take the lantern out of the locker', soul, {item: lantern, fr: locker, isize: lanternSize, mouthX: -0.3, mouthHalf: 0.135});
 ok(god.act({ops: [{op: 'set', id: lantern, state: {on: true}}]})); await tick(5);
 await refuse('put the lantern in the locker', 'item.lit');
 ok(god.act({ops: [{op: 'set', id: lantern, state: {on: false}}]})); await tick(5);
 results.lanternBack = await done('put the lantern in the locker', soul, {item: lantern, fr: locker, isize: lanternSize, mouthX: -0.3, mouthHalf: 0.135});
 results.close2 = await done('close the drawer', souls.Bea);

 // persistence: the world model and the engine checkpoint keep the contents
 const restored = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())), undefined, god.model.library);
 const rget = n => [...restored.entities.values()].find(e => e.name === n);
 assert.equal(rget('bowl').id, bowl); assert.equal(rget('bowl').in.parent, id('chest')); assert.equal(rget('bowl').in.slot, 'in-1'); assert.equal(rget('lantern').in.parent, id('locker'));
 const clone = factory.restore(f.host.engine.snapshot()); assert.equal(clone.stateHash(), f.host.engine.stateHash());
 for (let i = 0; i < 40; i++) {clone.step(); f.host.engine.step(); assert.equal(clone.stateHash(), f.host.engine.stateHash());}
 assert.equal(clone.world.entities[bowl].support.on, id('chest'));
 assert.deepEqual(f.host.engine.runtime.violations, []);
 const brief = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v && v.phase ? {capability: v.capability, phase: v.phase, ...(Number.isFinite(v.lip?.min) ? {lipMargin: +v.lip.min.toFixed(4)} : {})} : v]));
 const report = {status: 'pass',
  hereBytes: {absent: bytes(absent), distant100ChestsWithBowls: bytes(far), nearbyHoldingAtOpenDrawer: bytes(holdingNear), nearbyOpenDrawerWithBowl: bytes(openWith), nearbyShutDrawerWithBowl: bytes(shut), nearbyOpenLockerWithLantern: bytes(lockerOpen), nearbyShutLocker: bytes(lockerShut)},
  rows: {openWithBowl: row, shut: shut.objects.find(o => o.id === id('chest')), lockerOpen: lockerOpen.objects.find(o => o.id === id('locker'))}, results: brief, refusals,
  checks: ['plain words: put the bowl in the drawer / take the bowl out of the chest', 'refusals with reasons: closed, does not fit, private, lit, in use', 'same entity id in and out; engine resting-on <container>#in-1 and model in.parent/slot',
   'the bowl and the hand pass over the drawer front (lip margin >= 0) and let go / grasp inside the drawer', 'another Soul (Bea) opens it and takes the bowl out', 'interruption before release keeps it in hand',
   'the lantern does not fit the drawer and is kept on the locker shelf (hinged door, same mechanism)', 'shut contents never in here, offers or objects', '100 distant chests with bowls: +0 bytes, no offers, no tracks', 'world-model snapshot and engine checkpoint keep the contents', 'zero native violations']};
 if (out) {mkdirSync(out, {recursive: true}); writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2)); for (const [k, v] of Object.entries({absent, far, holdingNear, openWith, shut, lockerOpen, lockerShut})) writeFileSync(`${out}/here-${k}.json`, JSON.stringify(v, null, 1)); writeFileSync(`${out}/tracks.json`, JSON.stringify({put: put.track, take: take.track, locker: inLocker.track}));}
 console.log(JSON.stringify({hereBytes: report.hereBytes, results: report.results}));
});
