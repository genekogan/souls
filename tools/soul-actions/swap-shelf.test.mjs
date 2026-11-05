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

// #435 (W071): a swap shelf is entry 42's storage with data only: no door (no `open` state) and a `leftBy` record.
const out = process.env.SOUL_ACTIONS_OUT;
test('swap shelf: leave and take by plain words, no door, who left what, nearby only, refusals, persistence', {timeout: 600000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => {comms.close(); f.host.stop(); f.db.close();});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 const ok = r => {assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
 const souls = {};
 const join = async (key, name) => {await invite(f, key); const row = await accept(f.host, f.souls.create('dev:' + key, {name, description: 'Swap shelf test'})); souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();};
 await tick(); await join('ana', 'Ana'); soul = souls.Ana;
 const here = async (who = soul) => {const prev = soul; soul = who; try {const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here;} finally {soul = prev;}};
 const bytes = h => JSON.stringify(h).length;
 const absent = await here();
 const ent = n => {const e = [...god.model.entities.values()].find(e => e.name === n); assert.ok(e, 'entity ' + n); return e;};
 // 100 distant swap shelves, each with a bowl on it
 const distant = Array.from({length: 100}, (_, i) => [{op: 'place', def: 'core/swap-shelf@1', name: `distant-shelf-${i}`, p: [120 + i % 10 * 2, 120 + Math.floor(i / 10) * 2]}, {op: 'place', def: 'core/bowl@2', name: `distant-bowl-${i}`, in: {parent: `distant-shelf-${i}`, slot: 'in-1'}, p: [0, 0]}]).flat();
 ok(god.act({ops: distant})); await tick(45);
 const far = await here(), farIds = new Set(distant.map(d => ent(d.name).id));
 assert.equal(bytes(far), bytes(absent), '100 distant swap shelves with bowls add no bytes');
 assert.ok(!JSON.stringify(far).includes('distant-'));
 assert.deepEqual(edge.capabilities(soul).filter(c => c.verb !== 'walk' && ((c.object && farIds.has(c.object)) || (c.target && farIds.has(c.target.id)))).map(c => c.id), [], 'no distant offers');
 const idle = new TakeRecorder(f.host.engine.rt, {rulesVersion: 'swap-shelf-proof'}); await tick(4);
 assert.ok(!Object.keys(idle.finish().tracks).some(id => farIds.has(id)), 'no idle tracks for distant shelves or their things');

 const body = (s = soul) => f.host.engine.world.entities[s.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
 // nearby only: a shelf 6 m away (inside the 8 m take range, outside the 4 m facts range) offers its bowl without naming the leaver
 ok(god.act({ops: [{op: 'place', def: 'core/swap-shelf@1', name: 'mid-shelf', p: [ax - 6, az]}, {op: 'place', def: 'core/bowl@2', name: 'mid-bowl', in: {parent: 'mid-shelf', slot: 'in-2'}, p: [0, 0]}]})); await tick(20);
 ok(god.act({ops: [{op: 'set', id: ent('mid-shelf').id, state: {leftBy: `${ent('mid-bowl').id}=${souls.Ana.soulId}`}}]})); await tick(5);
 const midTake = edge.capabilities(soul).find(c => c.id === `pick-up:${ent('mid-bowl').id}`), mid = await here();
 assert.ok(midTake && !/left by/.test(midTake.label), 'a take 6 m away does not name the leaver: ' + midTake?.label);
 assert.ok(!JSON.stringify(mid).includes('left by'), 'nor does here, 6 m away');
 const midLabel = midTake.label; ok(god.act({ops: [{op: 'remove', id: ent('mid-shelf').id}]})); await tick(10);
 ok(god.act({ops: [
  {op: 'place', def: 'core/table@1', name: 'table', p: [ax + 2.4, az - 0.6]},
  {op: 'place', def: 'core/bowl@2', name: 'bowl', in: {parent: 'table', slot: 'top'}, p: [0.25, 0]},
  {op: 'place', def: 'core/lantern@3', name: 'lantern', in: {parent: 'table', slot: 'top'}, p: [-0.25, 0], state: {on: false}},
  {op: 'place', def: 'core/book@1', name: 'book', in: {parent: 'table', slot: 'top'}, p: [0, 0.2]},
  {op: 'place', def: 'core/swap-shelf@1', name: 'swap-shelf', p: [ax + 1, az + 2.6], r: Math.PI}]}));
 await tick(60);
 const id = n => ent(n).id, item = n => f.host.engine.world.entities[id(n)], shelfId = id('swap-shelf');
 const leftBy = () => String(ent('swap-shelf').state?.leftBy ?? '');
 const act = async (words, accepted = true, who = soul) => {const prev = soul; soul = who; try {const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})); const b = await r.json(); assert.equal(b.accepted, accepted, words + ' ' + JSON.stringify(b).slice(0, 500)); return b;} finally {soul = prev;}};
 const e0 = ent('swap-shelf'), wp = god.model.worldPose(e0), cy = Math.cos(wp.yaw), sy = Math.sin(wp.yaw), ins = containerInside(god.model.resolvedDef(e0.def));
 const local = p => [(p[0] - wp.x) * cy - (p[2] - wp.z) * sy, p[1] - wp.y, (p[0] - wp.x) * sy + (p[2] - wp.z) * cy];
 const finish = async (r, who = soul, watch = null, limit = 1600) => {
  const lip = {min: Infinity, at: null}, track = [];
  for (let n = 0; n < limit; n++) {
   if (watch) {const b = body(who), hand = b.human?.hands?.right, it = f.host.engine.world.entities[watch.item], held = it.support?.kind === 'in-hand', tr = b.human?.itemTransferV1;
    if (tr && hand) {const ph = held ? local(it.pose.p) : local(hand), drop = held ? 0 : 0.04, w = held ? Math.max(watch.isize[0], watch.isize[2]) / 2 : 0.05;
     track.push({tick: f.host.engine.world.tick, held, p: ph.map(v => +v.toFixed(4)), hand: local(hand).map(v => +v.toFixed(4))});
     // the front rail: the thing (or the empty hand) stays above it while it crosses the shelf's front
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
 const shelfRow = h => h.objects.find(o => o.id === shelfId);

 // no door: nothing to open, and an empty shelf says nothing
 assert.ok(!edge.capabilities(soul).some(c => c.object === shelfId && ['open', 'close'].includes(c.action)), 'a swap shelf has no door to open');
 await refuse('open the swap shelf', 'capability.unknown');
 const emptyNear = await here();
 // Ana leaves the bowl
 results.pickUp = await done('pick up the bowl');
 const holdingNear = await here();
 const putCap = edge.capabilities(soul).find(c => c.id === `put-in:${shelfId}`);
 assert.ok(putCap?.available, 'put-in offered at once, no open step ' + JSON.stringify(putCap));
 const put = await done('leave the bowl on the swap shelf', soul, {item: bowl, isize: bowlSize});
 assert.match(put.capability, new RegExp(`put-in:${shelfId}$`));
 assert.equal(item('bowl').support.kind, 'resting-on'); assert.equal(item('bowl').support.on, shelfId); assert.match(item('bowl').support.slot, /^in-\d$/);
 assert.equal(ent('bowl').id, bowl); assert.equal(ent('bowl').in.parent, shelfId);
 assert.ok(put.lip.min >= 0, 'the bowl passes over the front rail: ' + JSON.stringify(put.lip));
 const release = put.track.filter(s => !s.held)[0]; assert.ok(release && onShelf(release.hand), 'the hand lets go on the shelf ' + JSON.stringify(release));
 results.put = {lipMargin: +put.lip.min.toFixed(4), releaseHand: release.hand, samples: put.track.length};
 assert.equal(leftBy(), `${bowl}=${souls.Ana.soulId}`, 'the shelf records who left the bowl');
 const withBowl = await here();
 assert.deepEqual(shelfRow(withBowl)?.state, {holds: ['bowl (left by Ana)']}, 'nearby: what is on it and who left it');

 // Bea comes by: the take offer names who left it; she takes it
 await join('bea', 'Bea');
 const takeCap = edge.capabilities(souls.Bea).find(c => c.id === `pick-up:${bowl}`);
 assert.equal(takeCap?.available, true); assert.match(takeCap.label, /^Take swap-shelf\/bowl \(left by Ana\) out of swap-shelf /, takeCap?.label);
 const take = await done('take the bowl from the swap shelf', souls.Bea, {item: bowl, isize: bowlSize});
 assert.match(take.capability, new RegExp(`pick-up:${bowl}$`));
 assert.equal(item('bowl').support.kind, 'in-hand'); assert.equal(item('bowl').support.by, souls.Bea.entityId);
 assert.ok(take.lip.min >= 0, 'hand and bowl pass over the front rail: ' + JSON.stringify(take.lip));
 const grasp = take.track.find(s => s.held); assert.ok(grasp && onShelf(grasp.hand), 'the hand takes it on the shelf ' + JSON.stringify(grasp));
 results.take = {lipMargin: +take.lip.min.toFixed(4), graspHand: grasp.hand, samples: take.track.length};
 const afterTake = await here(souls.Bea);
 assert.equal(shelfRow(afterTake)?.state?.holds, undefined, 'the shelf is empty again');
 // interrupted before the release: the bowl stays in her hand, the shelf and its record unchanged
 {const before = leftBy(), r = await act('put the bowl in the swap shelf', true, souls.Bea); for (let n = 0; n < 600 && !body(souls.Bea).human?.itemTransferV1?.reachTick; n++) await tick(1); await tick(6);
  await accept(f.host, edge.act(souls.Bea, {capability: 'stand:here'})); await tick(60);
  assert.equal(edge.receipt(souls.Bea.soulId, r.receipt.id).phase, 'replaced'); assert.equal(item('bowl').support.kind, 'in-hand', 'interrupted: still in her hand');
  assert.equal(ent('bowl').in.parent, souls.Bea.entityId); assert.equal(leftBy(), before); results.interrupted = 'bowl stayed in hand; shelf and record unchanged';}
 // Bea leaves it again: the record names her now, and the taken-off entry is gone
 results.beaPut = await done('leave the bowl on the swap shelf', souls.Bea, {item: bowl, isize: bowlSize});
 assert.equal(leftBy(), `${bowl}=${souls.Bea.soulId}`);
 // refused: the lantern does not fit; then a full shelf
 results.lanternUp = await done('pick up the lantern');
 {const b = await refuse('put the lantern on the swap shelf', 'item.does-not-fit'); assert.match(b.reason, /\(0\.22 × 0\.45 × 0\.22 m\) does not fit in swap-shelf \(up to 0\.30 × 0\.28 × 0\.30 m\)/);}
 results.lanternDown = await done('put the lantern on the table');
 assert.equal(item('lantern').support.on, id('table'), '"on the table" is still a surface put');
 ok(god.act({ops: [{op: 'place', def: 'core/cup@2', name: 'cup', in: {parent: 'swap-shelf', slot: 'in-1'}, p: [0, 0]}, {op: 'place', def: 'core/cup@2', name: 'mug', in: {parent: 'swap-shelf', slot: 'in-2'}, p: [0, 0]}].filter(o => !(ent('bowl').in.slot === o.in.slot)).concat(ent('bowl').in.slot === 'in-3' ? [] : [{op: 'place', def: 'core/cup@2', name: 'mug2', in: {parent: 'swap-shelf', slot: 'in-3'}, p: [0, 0]}])})); await tick(20);
 const full = await here(souls.Bea);
 const holds = shelfRow(full)?.state?.holds ?? []; assert.equal(holds.length, 3, JSON.stringify(holds)); assert.ok(holds.includes('bowl (left by Bea)')); assert.ok(holds.filter(h => !/left by/.test(h)).length === 2, 'god-placed things have no leaver');
 results.bookUp = await done('pick up the book');
 await refuse('leave the book on the swap shelf', 'container.full');
 // a book (an item-kind word, as cups and letters are): its take names the shelf, so storage words resolve it, not the kind
 ok(god.act({ops: [{op: 'remove', id: [...god.model.entities.values()].find(e => e.in.parent === shelfId && e.name !== 'bowl').id}]})); await tick(10);
 results.bookPut = await done('leave the book on the swap shelf');
 assert.deepEqual(leftBy().split(',').sort(), [`${bowl}=${souls.Bea.soulId}`, `${id('book')}=${souls.Ana.soulId}`].sort(), 'the record: the bowl Bea left and the book Ana left');
 // "from Ana" names a Soul, not the shelf: the leaver in the take label is not container words
 {const prev = soul; soul = souls.Bea; try {const r = await (await app.request('/v1/edge/resolve', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: 'take the book from Ana'})})).json(); results.fromAna = r.resolve?.capability ?? r.resolve?.code ?? null; assert.notEqual(r.resolve?.capability, `pick-up:${id('book')}`, JSON.stringify(r).slice(0, 300));} finally {soul = prev;}}
 results.bookTake = await done('take the book from the swap shelf', souls.Bea);
 assert.equal(results.bookTake.capability, `pick-up:${id('book')}`); assert.equal(item('book').support.by, souls.Bea.entityId);
 assert.equal(leftBy(), `${bowl}=${souls.Bea.soulId}`, 'a thing taken off drops out of the record');

 // persistence: the world model keeps the contents and the record; the engine checkpoint replays
 const restored = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())), undefined, god.model.library);
 const rget = n => [...restored.entities.values()].find(e => e.name === n);
 assert.equal(rget('bowl').in.parent, shelfId); assert.equal(rget('swap-shelf').state.leftBy, leftBy());
 const clone = factory.restore(f.host.engine.snapshot()); assert.equal(clone.stateHash(), f.host.engine.stateHash());
 for (let i = 0; i < 40; i++) {clone.step(); f.host.engine.step(); assert.equal(clone.stateHash(), f.host.engine.stateHash());}
 assert.deepEqual(f.host.engine.runtime.violations, []);
 const brief = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v && v.phase ? {capability: v.capability, phase: v.phase, ...(Number.isFinite(v.lip?.min) ? {lipMargin: +v.lip.min.toFixed(4)} : {})} : v]));
 const report = {status: 'pass',
  hereBytes: {absent: bytes(absent), distant100ShelvesWithBowls: bytes(far), nearbyEmptyShelf: bytes(emptyNear), nearbyHolding: bytes(holdingNear), nearbyWithBowl: bytes(withBowl), nearbyFull: bytes(full)},
  rows: {withBowl: shelfRow(withBowl), full: shelfRow(full)}, takeLabel: takeCap.label, takeLabel6m: midLabel, leftBy: leftBy(), results: brief, refusals};
 if (out) {mkdirSync(out, {recursive: true}); writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2)); for (const [k, v] of Object.entries({absent, far, emptyNear, holdingNear, withBowl, full})) writeFileSync(`${out}/here-${k}.json`, JSON.stringify(v, null, 1)); writeFileSync(`${out}/tracks.json`, JSON.stringify({put: put.track, take: take.track}));}
 console.log(JSON.stringify({hereBytes: report.hereBytes, results: report.results, refusals}));
});
