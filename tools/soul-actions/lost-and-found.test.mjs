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
import {WorldModel, containerInside, containerClaims} from '../../packages/world-compiler/src/index.ts';
import {TakeRecorder} from '../../mars/viewer/engine/take/recorder.ts';

// #435 (W072): a lost-and-found is the swap shelf's storage with data only: no door, a `leftBy` record (who found and
// handed in each thing) and a declared owner claim (`claim: "owner"`): a thing with an owner of its own goes back only to them.
const out = process.env.SOUL_ACTIONS_OUT;
test('lost-and-found: hand in, owner claim, finder named nearby only, group and unowned things, refusals, persistence', {timeout: 600000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => {comms.close(); f.host.stop(); f.db.close();});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 const ok = r => {assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
 const souls = {};
 const join = async (key, name) => {await invite(f, key); const row = await accept(f.host, f.souls.create('dev:' + key, {name, description: 'Lost-and-found test'})); souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();};
 await tick(); await join('ana', 'Ana'); soul = souls.Ana;
 const here = async (who = soul) => {const prev = soul; soul = who; try {const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here;} finally {soul = prev;}};
 const bytes = h => JSON.stringify(h).length;
 const absent = await here();
 const ent = n => {const e = [...god.model.entities.values()].find(e => e.name === n); assert.ok(e, 'entity ' + n); return e;};
 // 100 distant lost-and-founds, each holding a bowl that is Ana's
 const distant = Array.from({length: 100}, (_, i) => [{op: 'place', def: 'core/lost-and-found@1', name: `distant-lf-${i}`, p: [120 + i % 10 * 2, 120 + Math.floor(i / 10) * 2]}, {op: 'place', def: 'core/bowl@2', name: `distant-bowl-${i}`, in: {parent: `distant-lf-${i}`, slot: 'in-1'}, p: [0, 0], owner: 'soul:Ana'}]).flat();
 ok(god.act({ops: distant})); await tick(45);
 const far = await here(), farIds = new Set(distant.map(d => ent(d.name).id));
 assert.equal(bytes(far), bytes(absent), '100 distant lost-and-founds with owned bowls add no bytes');
 assert.ok(!JSON.stringify(far).includes('distant-'));
 assert.deepEqual(edge.capabilities(soul).filter(c => c.verb !== 'walk' && ((c.object && farIds.has(c.object)) || (c.target && farIds.has(c.target.id)))).map(c => c.id), [], 'no distant offers');
 const idle = new TakeRecorder(f.host.engine.rt, {rulesVersion: 'lost-and-found-proof'}); await tick(4);
 assert.ok(!Object.keys(idle.finish().tracks).some(id => farIds.has(id)), 'no idle tracks for distant boxes or their things');
 assert.ok(containerClaims(god.model.resolvedDef(ent('distant-lf-0').def)), 'the def declares the owner claim');

 const body = (s = soul) => f.host.engine.world.entities[s.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
 await join('ben', 'Ben');
 // nearby only: a box 6 m away (inside the 8 m take range, outside the 4 m facts range) names no finder
 ok(god.act({ops: [{op: 'place', def: 'core/lost-and-found@1', name: 'mid-lf', p: [ax - 6, az]}, {op: 'place', def: 'core/bowl@2', name: 'mid-bowl', in: {parent: 'mid-lf', slot: 'in-2'}, p: [0, 0], owner: 'soul:Ana'}]})); await tick(20);
 ok(god.act({ops: [{op: 'set', id: ent('mid-lf').id, state: {leftBy: `${ent('mid-bowl').id}=${souls.Ben.soulId}`}}]})); await tick(5);
 const midAna = edge.capabilities(souls.Ana).find(c => c.id === `pick-up:${ent('mid-bowl').id}`), midBen = edge.capabilities(souls.Ben).find(c => c.id === `pick-up:${ent('mid-bowl').id}`), mid = await here();
 assert.ok(midAna?.available && !/found by|Ana's|yours/.test(midAna.label), 'a take 6 m away names nobody: ' + midAna?.label);
 assert.ok(midBen && !midBen.available && midBen.blocked.code === 'item.not-yours' && !/Ben|handed/.test(midBen.blocked.reason), 'refused 6 m away without the finder: ' + JSON.stringify(midBen?.blocked));
 assert.ok(!JSON.stringify(mid).includes('found by'), 'nor does here, 6 m away');
 const midLabel = midAna.label, midRefusal = midBen.blocked; ok(god.act({ops: [{op: 'remove', id: ent('mid-lf').id}]})); await tick(10);
 ok(god.act({ops: [
  {op: 'place', def: 'core/table@1', name: 'table', p: [ax + 2.4, az - 0.6]},
  {op: 'place', def: 'core/bowl@2', name: 'bowl', in: {parent: 'table', slot: 'top'}, p: [0.25, 0], owner: 'soul:Ana'},
  {op: 'place', def: 'core/lantern@3', name: 'lantern', in: {parent: 'table', slot: 'top'}, p: [-0.25, 0], state: {on: false}},
  {op: 'place', def: 'core/lost-and-found@1', name: 'lost-and-found', p: [ax + 1, az + 2.6], r: Math.PI}]}));
 await tick(60);
 const id = n => ent(n).id, item = n => f.host.engine.world.entities[id(n)], boxId = id('lost-and-found');
 const leftBy = () => String(ent('lost-and-found').state?.leftBy ?? '');
 const act = async (words, accepted = true, who = soul) => {const prev = soul; soul = who; try {const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})); const b = await r.json(); assert.equal(b.accepted, accepted, words + ' ' + JSON.stringify(b).slice(0, 500)); return b;} finally {soul = prev;}};
 const e0 = ent('lost-and-found'), wp = god.model.worldPose(e0), cy = Math.cos(wp.yaw), sy = Math.sin(wp.yaw), ins = containerInside(god.model.resolvedDef(e0.def));
 const local = p => [(p[0] - wp.x) * cy - (p[2] - wp.z) * sy, p[1] - wp.y, (p[0] - wp.x) * sy + (p[2] - wp.z) * cy];
 const finish = async (r, who = soul, watch = null, limit = 1600) => {
  const lip = {min: Infinity, at: null}, track = [];
  for (let n = 0; n < limit; n++) {
   if (watch) {const b = body(who), hand = b.human?.hands?.right, it = f.host.engine.world.entities[watch.item], held = it.support?.kind === 'in-hand', tr = b.human?.itemTransferV1;
    if (tr && hand) {const ph = held ? local(it.pose.p) : local(hand), drop = held ? 0 : 0.04, w = held ? Math.max(watch.isize[0], watch.isize[2]) / 2 : 0.05;
     track.push({tick: f.host.engine.world.tick, held, p: ph.map(v => +v.toFixed(4)), hand: local(hand).map(v => +v.toFixed(4))});
     if (tr.reachTick !== undefined && Math.abs(ph[0]) <= 0.47 + w && ph[2] + w >= ins.face - 0.02 && ph[2] - w <= ins.face) {const m = ph[1] - drop - ins.lip; if (m < lip.min) {lip.min = m; lip.at = {tick: f.host.engine.world.tick, held, p: ph};}}}}
   const ph = edge.receipt(who.soulId, r.receipt.id)?.phase; if (['completed', 'failed', 'cancelled', 'replaced'].includes(ph)) return {phase: ph, lip, track, receipt: edge.receipt(who.soulId, r.receipt.id)};
   await tick(1);
  }
  throw Error('timed out ' + r.receipt.capability);
 };
 const done = async (words, who = soul, watch = null) => {const r = await act(words, true, who); const x = await finish(r, who, watch); assert.equal(x.phase, 'completed', words + ' ' + JSON.stringify(x.receipt).slice(0, 600)); return {...x, capability: r.receipt.capability};};
 const results = {}, refusals = {};
 const refuse = async (words, code, who = soul) => {const b = await act(words, false, who); refusals[words + (who === soul ? '' : ' (' + who.name + ')')] = {code: b.code, reason: b.reason}; if (code) assert.equal(b.code, code, words + ' ' + JSON.stringify(b)); return b;};
 const bowl = id('bowl'), bowlSize = [0.25, 0.1, 0.25], onShelf = h => Math.abs(h[0]) <= 0.47 && h[2] >= -0.19 && h[2] <= ins.face && h[1] >= 1.0 && h[1] <= 1.45;
 const row = h => h.objects.find(o => o.id === boxId);

 // no door: nothing to open
 assert.ok(!edge.capabilities(soul).some(c => c.object === boxId && ['open', 'close'].includes(c.action)), 'a lost-and-found has no door to open');
 await refuse('open the lost and found', 'capability.unknown');
 const emptyNear = await here();
 // Ben finds Ana's bowl on the table and hands it in
 results.benPickUp = await done('pick up the bowl', souls.Ben);
 assert.equal(ent('bowl').owner, 'soul:Ana', 'carrying it does not change whose it is');
 const putCap = edge.capabilities(souls.Ben).find(c => c.id === `put-in:${boxId}`);
 assert.ok(putCap?.available, 'put-in offered at once, no open step ' + JSON.stringify(putCap));
 const put = await done('put the bowl in the lost and found', souls.Ben, {item: bowl, isize: bowlSize});
 assert.match(put.capability, new RegExp(`put-in:${boxId}$`));
 assert.equal(item('bowl').support.kind, 'resting-on'); assert.equal(item('bowl').support.on, boxId); assert.match(item('bowl').support.slot, /^in-\d$/);
 assert.equal(ent('bowl').in.parent, boxId); assert.equal(ent('bowl').owner, 'soul:Ana', 'still Ana\'s');
 assert.ok(put.lip.min >= 0, 'the bowl passes over the front rail: ' + JSON.stringify(put.lip));
 const release = put.track.filter(s => !s.held)[0]; assert.ok(release && onShelf(release.hand), 'the hand lets go on the shelf ' + JSON.stringify(release));
 results.put = {lipMargin: +put.lip.min.toFixed(4), releaseHand: release.hand, samples: put.track.length};
 assert.equal(leftBy(), `${bowl}=${souls.Ben.soulId}`, 'the record names who handed it in');
 // Ben, the finder, sees whose it is and that he found it; his own take is refused
 const benNear = await here(souls.Ben);
 assert.deepEqual(row(benNear)?.state, {holds: ["bowl (Ana's, found by Ben)"]}, 'nearby: whose it is and who found it');
 const benTake = edge.capabilities(souls.Ben).find(c => c.id === `pick-up:${bowl}`);
 assert.equal(benTake?.available, false); assert.equal(benTake.blocked.code, 'item.not-yours'); assert.match(benTake.label, /^Take lost-and-found\/bowl \(Ana's, found by Ben\) out of lost-and-found \(shelf\) /, benTake.label);
 {const b = await refuse('take the bowl from the lost and found', 'item.not-yours', souls.Ben); assert.match(b.reason, /bowl is Ana's; you handed it in\. Only Ana can claim it from lost-and-found \(shelf\)\./, b.reason);}
 assert.equal(item('bowl').support.on, boxId, 'a refused take changes nothing'); assert.equal(leftBy(), `${bowl}=${souls.Ben.soulId}`);
 // Ana: told it is hers and who found it; the take is hers
 const anaNear = await here(souls.Ana);
 assert.deepEqual(row(anaNear)?.state, {holds: ['bowl (yours, found by Ben)']});
 const anaTake = edge.capabilities(souls.Ana).find(c => c.id === `pick-up:${bowl}`);
 assert.equal(anaTake?.available, true); assert.match(anaTake.label, /^Take lost-and-found\/bowl \(yours, found by Ben\) out of lost-and-found \(shelf\) /, anaTake.label);
 // interrupted before the grasp: the bowl stays on the shelf, the record unchanged
 {const before = leftBy(), r = await act('take my bowl from the lost and found', true, souls.Ana); for (let n = 0; n < 600 && !body(souls.Ana).human?.itemTransferV1?.reachTick; n++) await tick(1);
  await accept(f.host, edge.act(souls.Ana, {capability: 'stand:here'})); await tick(60);
  assert.equal(edge.receipt(souls.Ana.soulId, r.receipt.id).phase, 'replaced'); assert.equal(item('bowl').support.on, boxId, 'interrupted: still on the shelf');
  assert.equal(ent('bowl').in.parent, boxId); assert.equal(leftBy(), before); results.interrupted = 'bowl stayed on the shelf; record unchanged';}
 const claim = await done('take my bowl from the lost and found', souls.Ana, {item: bowl, isize: bowlSize});
 assert.equal(claim.capability, `pick-up:${bowl}`);
 assert.equal(item('bowl').support.kind, 'in-hand'); assert.equal(item('bowl').support.by, souls.Ana.entityId); assert.equal(ent('bowl').owner, 'soul:Ana');
 assert.ok(claim.lip.min >= 0, 'hand and bowl pass over the front rail: ' + JSON.stringify(claim.lip));
 const grasp = claim.track.find(s => s.held); assert.ok(grasp && onShelf(grasp.hand), 'the hand takes it on the shelf ' + JSON.stringify(grasp));
 results.claim = {lipMargin: +claim.lip.min.toFixed(4), graspHand: grasp.hand, samples: claim.track.length};
 assert.equal(leftBy(), '', 'a claimed thing drops out of the record');
 assert.equal(row(await here(souls.Ana))?.state?.holds, undefined, 'the shelf is empty again');

 results.anaPutsBowlDown = await done('put the bowl on the table', souls.Ana);
 // the same mechanism, a second case: a thing the bakers own goes to a baker; a thing nobody owns is anyone's
 // (god-set relationships are a LAYERS=1 opt-in; only the membership is set with it on)
 {const was = process.env.LAYERS; process.env.LAYERS = '1'; try {ok(god.act({ops: [{op: 'relate', a: 'soul:Ben', rel: 'member-of', b: 'group:bakers'}]}));} finally {if (was === undefined) delete process.env.LAYERS; else process.env.LAYERS = was;}}
 ok(god.act({ops: [
  {op: 'place', def: 'core/cup@2', name: 'apron-cup', in: {parent: 'lost-and-found', slot: 'in-1'}, p: [0, 0], owner: 'group:bakers'},
  {op: 'place', def: 'core/book@1', name: 'book', in: {parent: 'lost-and-found', slot: 'in-2'}, p: [0, 0]}]})); await tick(20);
 const cup = id('apron-cup');
 const groupRow = row(await here(souls.Ana))?.state?.holds ?? [];
 assert.deepEqual(groupRow.sort(), ["apron-cup (the bakers')", 'book'], 'god-placed: no finder; a group owner by its name; nobody\'s: no note');
 const cupAna = edge.capabilities(souls.Ana).find(c => c.id === `pick-up:${cup}`), cupBen = edge.capabilities(souls.Ben).find(c => c.id === `pick-up:${cup}`);
 assert.equal(cupAna?.available, false); assert.equal(cupAna.blocked.code, 'item.not-yours'); assert.match(cupAna.blocked.reason, /the bakers'\. Only the bakers can claim it/);
 assert.equal(cupBen?.available, true, 'a member of the owning group may take it');
 results.unowned = await done('take the book from the lost and found', souls.Ana);
 assert.equal(item('book').support.by, souls.Ana.entityId, 'a thing nobody owns is anyone\'s');
 results.baker = await done('take the cup from the lost and found', souls.Ben);
 assert.equal(item('apron-cup').support.by, souls.Ben.entityId);
 results.anaBookDown = await done('put the book on the table', souls.Ana);

 // refused: the lantern does not fit; then a full box
 results.lanternUp = await done('pick up the lantern', souls.Ana);
 {const b = await refuse('put the lantern in the lost and found', 'item.does-not-fit', souls.Ana); assert.match(b.reason, /\(0\.22 × 0\.45 × 0\.22 m\) does not fit in lost-and-found \(shelf\) \(up to 0\.30 × 0\.28 × 0\.30 m\)/);}
 results.lanternDown = await done('put the lantern on the table', souls.Ana);
 ok(god.act({ops: ['in-1', 'in-2', 'in-3'].map((slot, i) => ({op: 'place', def: 'core/cup@2', name: `found-cup-${i}`, in: {parent: 'lost-and-found', slot}, p: [0, 0]}))})); await tick(20);
 const full = await here(souls.Ben);
 assert.equal(row(full)?.state?.holds?.length, 3);
 results.bowlUp = await done('pick up the bowl', souls.Ana);
 await refuse('put the bowl in the lost and found', 'container.full', souls.Ana);
 // Ana hands her own bowl in: the record names her; her claim is hers
 ok(god.act({ops: [{op: 'remove', id: id('found-cup-0')}]})); await tick(10);
 results.ownHandIn = await done('put the bowl in the lost and found', souls.Ana);
 assert.ok(leftBy().split(',').includes(`${bowl}=${souls.Ana.soulId}`));
 assert.ok((row(await here(souls.Ana))?.state?.holds ?? []).includes('bowl (yours, found by Ana)'));

 // persistence: the world model keeps the contents, the record and whose the bowl is; the engine checkpoint replays
 const restored = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())), undefined, god.model.library);
 const rget = n => [...restored.entities.values()].find(e => e.name === n);
 assert.equal(rget('bowl').in.parent, boxId); assert.equal(rget('bowl').owner, 'soul:Ana'); assert.equal(rget('lost-and-found').state.leftBy, leftBy());
 const clone = factory.restore(f.host.engine.snapshot()); assert.equal(clone.stateHash(), f.host.engine.stateHash());
 for (let i = 0; i < 40; i++) {clone.step(); f.host.engine.step(); assert.equal(clone.stateHash(), f.host.engine.stateHash());}
 assert.deepEqual(f.host.engine.runtime.violations, []);
 const brief = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v && v.phase ? {capability: v.capability, phase: v.phase, ...(Number.isFinite(v.lip?.min) ? {lipMargin: +v.lip.min.toFixed(4)} : {})} : v]));
 const report = {status: 'pass',
  hereBytes: {absent: bytes(absent), distant100BoxesWithOwnedBowls: bytes(far), nearbyEmpty: bytes(emptyNear), nearbyBen: bytes(benNear), nearbyAna: bytes(anaNear), nearbyFull: bytes(full)},
  rows: {ben: row(benNear), ana: row(anaNear), group: groupRow, full: row(full)}, labels: {ben: benTake.label, ana: anaTake.label, mid6m: midLabel}, mid6mRefusal: midRefusal, leftBy: leftBy(), results: brief, refusals};
 if (out) {mkdirSync(out, {recursive: true}); writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2)); for (const [k, v] of Object.entries({absent, far, emptyNear, benNear, anaNear, full})) writeFileSync(`${out}/here-${k}.json`, JSON.stringify(v, null, 1)); writeFileSync(`${out}/tracks.json`, JSON.stringify({put: put.track, claim: claim.track}));}
 console.log(JSON.stringify({hereBytes: report.hereBytes, results: report.results, refusals}));
});
