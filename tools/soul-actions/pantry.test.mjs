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
import {WorldModel} from '../../packages/world-compiler/src/index.ts';
import {TakeRecorder} from '../../mars/viewer/engine/take/recorder.ts';

// #435 (W071): a pantry holds real things, one per place, and drawing from it is by hand. A fresh mug kept in it is not a
// counter cup; an apple and a bun are eaten from the hand, bite by bite, on entry 44's cup motion.
const out = process.env.SOUL_ACTIONS_OUT;
test('pantry: stock and draw by hand, food eaten bite by bite, a kept mug is not a counter cup, refusals, long tail', {timeout: 900000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => {comms.close(); f.host.stop(); f.db.close();});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 const bridge = installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 const ok = r => {assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
 await tick(); await invite(f, 'ana'); {const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Pantry test'})); soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};} await tick();
 const here = async () => {const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here;};
 const bytes = h => JSON.stringify({...h, tick: 0}).length;
 const absent = await here();
 const ent = n => {const e = [...god.model.entities.values()].find(e => e.name === n); assert.ok(e, 'entity ' + n); return e;}, id = n => ent(n).id, item = n => f.host.engine.world.entities[id(n)];
 // ---- P10: 100 distant pantries, each holding an apple
 const distant = Array.from({length: 100}, (_, i) => [{op: 'place', def: 'core/pantry@1', name: `distant-pantry-${i}`, p: [120 + i % 10 * 2, 120 + Math.floor(i / 10) * 2]}, {op: 'place', def: 'core/apple@1', name: `distant-apple-${i}`, in: {parent: `distant-pantry-${i}`, slot: 'in-1'}, p: [0, 0]}]).flat();
 ok(god.act({ops: distant})); await tick(45);
 const far = await here(), farIds = new Set(distant.map(d => id(d.name)));
 assert.equal(bytes(far), bytes(absent), '100 distant pantries with apples add no bytes');
 assert.ok(!JSON.stringify(far).includes('distant-'));
 assert.deepEqual(edge.capabilities(soul).filter(c => c.verb !== 'walk' && ((c.object && farIds.has(c.object)) || (c.target && farIds.has(c.target.id)))).map(c => c.id), [], 'no distant offers');
 const idle = new TakeRecorder(f.host.engine.rt, {rulesVersion: 'pantry-proof'}); await tick(4);
 assert.ok(!Object.keys(idle.finish().tracks).some(x => farIds.has(x)), 'no idle tracks for distant pantries or their things');
 const visits0 = bridge.tea?.visits?.() ?? 0, watching0 = bridge.tea?.watchingCount?.() ?? 0; await tick(10);
 assert.equal(bridge.tea?.visits?.() ?? 0, visits0, 'no per-tick work without an eat act'); assert.equal(watching0, 0);

 const body = () => f.host.engine.world.entities[soul.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
 ok(god.act({ops: [
  {op: 'place', def: 'core/pantry@1', name: 'pantry', p: [ax + 1, az + 2.6], r: Math.PI},
  {op: 'place', def: 'core/table@1', name: 'table', p: [ax + 2.4, az - 0.6]},
  {op: 'place', def: 'core/apple@1', name: 'apple', in: {parent: 'table', slot: 'top'}, p: [0.25, 0]},
  {op: 'place', def: 'core/bun@1', name: 'bun', in: {parent: 'table', slot: 'top'}, p: [-0.25, 0]},
  {op: 'place', def: 'core/book@1', name: 'book', in: {parent: 'table', slot: 'top'}, p: [0, 0.2]},
  {op: 'place', def: 'core/loaf@1', name: 'loaf', in: {parent: 'table', slot: 'top'}, p: [0, -0.2]},
 ]})); await tick(60);
 const pantryId = id('pantry'), row = h => h.objects.find(o => o.id === pantryId), inside = () => [...god.model.entities.values()].filter(e => e.in?.parent === pantryId);
 const act = async (words, accepted = true) => {const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})); const b = await r.json(); assert.equal(b.accepted, accepted, words + ' ' + JSON.stringify(b).slice(0, 500)); return b;};
 const finish = async (r, each = null, limit = 2400) => {for (let n = 0; n < limit; n++) {if (each) each(); const rc = edge.receipt(soul.soulId, r.receipt.id); if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) return rc; await tick(1);} throw Error('timed out ' + r.receipt.capability);};
 const done = async (words, each = null) => {const r = await act(words), rc = await finish(r, each); assert.equal(rc.phase, 'completed', words + ' ' + JSON.stringify(rc).slice(0, 600)); return {...rc, capability: r.receipt.capability};};
 const refusals = {}, results = {};
 const refuse = async (words, code) => {const b = await act(words, false); refusals[words] = {code: b.code, reason: b.reason}; if (code) assert.equal(b.code, code, words + ' ' + JSON.stringify(b)); return b;};
 const resolved = async words => {const r = await (await app.request('/v1/edge/resolve', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})).json(); return r.resolve?.would?.capability ?? null;};
 const held = n => item(n).support?.kind === 'in-hand' && item(n).support.by === soul.entityId;

 // ---- P6: the words for a food not in the hand; a pantry has no door
 assert.ok(!edge.capabilities(soul).some(c => c.object === pantryId && ['open', 'close'].includes(c.action)), 'a pantry has no door');
 assert.equal(row(await here())?.state?.holds, undefined, 'an empty pantry says nothing');

 // ---- P1: stocking by plain words
 await done('pick up the apple'); assert.ok(held('apple'));
 const holdingApple = await here();
 assert.deepEqual(holdingApple.objects.find(o => o.id === id('apple'))?.state, {bites: 3}, 'P4 a held food says its bites');
 results.stock = await done('stock the pantry with the apple');
 assert.match(results.stock.capability, new RegExp(`put-in:${pantryId}$`));
 assert.equal(item('apple').support.kind, 'resting-on'); assert.equal(item('apple').support.on, pantryId); assert.match(item('apple').support.slot, /^in-\d$/);
 assert.equal(ent('apple').in.parent, pantryId);
 const withApple = await here();
 assert.deepEqual(row(withApple)?.state, {holds: ['apple']}, 'P4 nearby: what is in the pantry, by name');
 assert.equal(withApple.objects.find(o => o.id === id('apple'))?.state, undefined, 'a whole apple put down says nothing');
 await done('pick up the bun'); results.putBun = await done('put the bun in the pantry'); assert.equal(item('bun').support.on, pantryId);
 assert.deepEqual([...row(await here()).state.holds].sort(), ['apple', 'bun']);
 // persists across a restored snapshot
 {const restored = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())), undefined, god.model.library), rget = n => [...restored.entities.values()].find(e => e.name === n);
  assert.equal(rget('apple').in.parent, pantryId); assert.equal(rget('apple').in.slot, ent('apple').in.slot);}

 // ---- P6: a loaf does not fit; a full pantry
 await done('pick up the loaf');
 {const b = await refuse('put the loaf in the pantry', 'item.does-not-fit'); assert.match(b.reason, /does not fit in pantry \(up to 0\.20 × 0\.28 × 0\.30 m\)/);}
 await done('put the loaf on the table');
 {const free = ['in-1', 'in-2', 'in-3', 'in-4'].filter(s => !inside().some(e => e.in.slot === s)); ok(god.act({ops: free.map((slot, i) => ({op: 'place', def: 'core/bowl@2', name: `fill-${i + 1}`, in: {parent: 'pantry', slot}, p: [0, 0]}))})); await tick(10);}
 await done('pick up the book');
 await refuse('put the book in the pantry', 'container.full');
 ok(god.act({ops: inside().filter(e => /^fill-/.test(e.name)).map(e => ({op: 'remove', id: e.id}))})); await tick(10);
 results.bookDown = await done('put the book on the table');

 // ---- P2: take it out, three bites at the lips; `left` moves only at each bite's moment
 results.take = await done('take the apple from the pantry');
 assert.equal(results.take.capability, `pick-up:${id('apple')}`); assert.ok(held('apple')); assert.ok(!inside().some(e => e.name === 'apple'));
 {const seen = [], hand = []; const r = await done('eat the apple', () => {const left = ent('apple').state?.left ?? 1; if (seen.at(-1)?.left !== left) {const m = body().human?.cupV1; seen.push({left, tick: f.host.engine.world.tick, sinceStart: m ? +((f.host.engine.world.tick - m.startTick) * 0.05).toFixed(2) : null});} if (body().human?.cupV1) hand.push(1);});
  assert.deepEqual(seen.map(s => s.left), [1, 0.667, 0.333, 0], 'left falls in thirds, once per bite: ' + JSON.stringify(seen));
  assert.ok(hand.length > 100, 'the cup motion ran'); results.eat = {capability: r.capability, summary: r.result?.summary ?? r.summary ?? null, bites: seen};
  assert.ok(JSON.stringify(r).includes('apple'), 'the receipt says what was eaten ' + JSON.stringify(r).slice(0, 400));}
 assert.ok(held('apple'), 'what is left stays in the hand');
 const eatenRow = await here();
 assert.deepEqual(eatenRow.objects.find(o => o.id === id('apple'))?.state, {eaten: true}, 'P4 then it says eaten');
 await refuse('eat the apple', 'food.eaten');
 results.down = await done('put the apple on the table'); assert.equal(item('apple').support.on, id('table'));
 assert.equal(ent('apple').state.left, 0, 'put down, still eaten');

 // ---- P7 and P9: the bun, a different def with no code naming it; a bite, an interrupted eat, a second eat
 results.takeBun = await done('take the bun out of the pantry'); assert.ok(held('bun'));
 assert.equal(await resolved('take a bite of the bun'), `object:${id('bun')}:bite`);
 for (const [w, a] of [['eat it', 'eat'], ['eat the bun', 'eat'], ['finish the bun', 'eat'], ['have the bun', 'eat'], ['eat', 'eat'], ['have a bite', 'bite'], ['bite the bun', 'bite']]) assert.equal(await resolved(w), `object:${id('bun')}:${a}`, w);
 assert.notEqual(await resolved('have a look'), `object:${id('bun')}:eat`); assert.notEqual(await resolved('eat the book'), `object:${id('book')}:eat`);
 assert.notEqual(await resolved('eat the book'), `object:${id('bun')}:eat`, 'a named thing that is not this food is not an eat of it');
 assert.deepEqual((await here()).objects.find(o => o.id === id('bun'))?.state, {bites: 2});
 // interrupted before the first bite's moment: nothing changes; it stays in the hand
 {const r = await act('eat the bun'); for (let n = 0; n < 200 && !body().human?.cupV1; n++) await tick(1); await tick(10);
  await accept(f.host, edge.act(soul, {capability: 'stand:here'})); const rc = await finish(r); assert.equal(rc.phase, 'replaced', JSON.stringify(rc).slice(0, 300));
  await tick(60); assert.equal(ent('bun').state?.left ?? 1, 1, 'interrupted before the bite: nothing eaten'); assert.ok(held('bun'), 'still in the hand');}
 // interrupted between bites: left is what the finished bites wrote
 {const r = await act('eat it'); for (let n = 0; n < 900 && (ent('bun').state?.left ?? 1) === 1; n++) await tick(1); assert.equal(ent('bun').state.left, 0.5); await tick(10);
  await accept(f.host, edge.act(soul, {capability: 'stand:here'})); const rc = await finish(r); assert.equal(rc.phase, 'replaced', JSON.stringify(rc).slice(0, 300));
  await tick(60); assert.equal(ent('bun').state.left, 0.5, 'interrupted between bites: the finished bite stands'); assert.ok(held('bun')); results.interrupted = {left: ent('bun').state.left, phase: rc.phase};}
 assert.deepEqual((await here()).objects.find(o => o.id === id('bun'))?.state, {bites: 1});
 results.finish = await done('finish the bun'); assert.equal(ent('bun').state.left, 0); assert.ok(held('bun'));
 results.bunDown = await done('put the bun on the table');
 // one bite means one
 ok(god.act({ops: [{op: 'place', def: 'core/apple@1', name: 'second-apple', in: {parent: 'table', slot: 'top'}, p: [0.4, 0.2]}]})); await tick(10);
 await done(`pick-up:${id('second-apple')}`);
 assert.equal(await resolved('have a bite'), `object:${id('second-apple')}:bite`);
 results.bite = await done('have a bite'); assert.equal(ent('second-apple').state.left, 0.667);
 assert.deepEqual((await here()).objects.find(o => o.id === id('second-apple'))?.state, {bites: 2});
 results.down2 = await done('put the apple on the table');

 // ---- P8: with no food held the old meanings stand
 assert.equal(await resolved('eat it') === `object:${id('second-apple')}:eat`, false, '"eat it" with nothing held is not the apple on the table');

 // ---- P2: a food not in the hand is taken first, from a table or the pantry, as one act; a bare word means the one in the hand
 results.eatFromTable = await done('eat the apple'); assert.equal(results.eatFromTable.capability, `object:${id('second-apple')}:eat`);
 assert.ok(held('second-apple')); assert.equal(ent('second-apple').state.left, 0);
 ok(god.act({ops: [{op: 'place', def: 'core/bun@1', name: 'kept-bun', in: {parent: 'pantry', slot: inside().length ? ['in-1', 'in-2', 'in-3', 'in-4'].find(s => !inside().some(e => e.in.slot === s)) : 'in-1'}, p: [0, 0]}]})); await tick(60);
 await refuse(`object:${id('kept-bun')}:eat`, 'tea.hands-full');
 await done('put the apple on the table');
 results.eatFromPantry = await done('eat the bun'); assert.equal(results.eatFromPantry.capability, `object:${id('kept-bun')}:eat`);
 assert.ok(held('kept-bun')); assert.equal(ent('kept-bun').state.left, 0); assert.ok(!inside().some(e => e.name === 'kept-bun'));
 await done('put the bun on the table');
 // in someone else's hand: this is the one food refusal that stays, with nothing left to eat
 ok(god.act({ops: [{op: 'place', def: 'core/apple@1', name: 'her-apple', in: {parent: 'table', slot: 'top'}, p: [0.1, 0.25]}]})); await tick(60);
 await invite(f, 'bea');
 {const r = await accept(f.host, f.souls.create('dev:bea', {name: 'Bea', description: 'Pantry test'})), bea = {soulId: r.id, entityId: r.entity_id, name: r.name, owner: r.owner}; await tick();
  const taken = await accept(f.host, edge.act(bea, {capability: `pick-up:${id('her-apple')}`})); assert.equal(taken.accepted, true, JSON.stringify(taken));
  for (let n = 0; n < 2400 && item('her-apple').support?.kind !== 'in-hand'; n++) await tick(1);
  assert.equal(item('her-apple').support.by, bea.entityId);}
 await refuse(`object:${id('her-apple')}:eat`, 'food.in-use');

 // ---- P3: a mug kept in the pantry is taken out, stood on the counter and used; only no mug at all stays a refusal
 ok(god.act({ops: [
  {op: 'place', def: 'core/table@1', name: 'counter', p: [ax - 2.2, az + 1.2]},
  {op: 'place', def: 'core/kettle@2', name: 'kettle', in: {parent: 'counter', slot: 'top'}, p: [0.3, 0], state: {level: 1}},
  {op: 'place', def: 'core/camp-sink@1', name: 'sink', p: [ax - 5, az + 1.2]},
 ]})); await tick(60);
 await refuse('pour the tea', 'tea.no-cup');
 const freeSlot = () => ['in-1', 'in-2', 'in-3', 'in-4'].find(s => !inside().some(e => e.in.slot === s));
 ok(god.act({ops: [{op: 'place', def: 'core/cup@2', name: 'mug', in: {parent: 'pantry', slot: freeSlot()}, p: [0, 0]}]})); await tick(60);
 assert.ok(inside().some(e => e.name === 'mug'));
 results.brew = await done('make a cup of tea'); assert.equal(results.brew.capability, `object:${id('mug')}:brew`);
 assert.equal(item('mug').support.on, id('counter'), 'the mug came out of the pantry onto the counter'); assert.equal(ent('mug').state.tea, 1, 'tea in the mug, by the faculty');
 assert.ok(!inside().some(e => e.name === 'mug'), 'and it is no longer in the pantry');
 // the kettle is hot now: "pour the tea" takes the next kept mug the same way, by the pour's own steps
 ok(god.act({ops: [{op: 'place', def: 'core/cup@2', name: 'mug-two', in: {parent: 'pantry', slot: freeSlot()}, p: [0, 0]}]})); await tick(60);
 results.pour = await done('pour the tea'); assert.equal(item('mug-two').support.on, id('counter')); assert.equal(ent('mug-two').state.tea, 1);
 // a mug behind a shut door or in a private pantry is not taken: those are other refusals' business
 ok(god.act({ops: [
  {op: 'place', def: 'core/drawer-chest@2', name: 'shut-chest', p: [ax - 2.2, az + 4], state: {open: false}},
  {op: 'place', def: 'core/cup@2', name: 'shut-mug', in: {parent: 'shut-chest', slot: 'in-1'}, p: [0, 0]},
 ]})); await tick(60);
 await refuse('pour the tea', 'tea.no-cup');
 ok(god.act({ops: [
  {op: 'place', def: 'core/pantry@1', name: 'private-pantry', p: [ax - 5, az + 4], access: 'private'},
  {op: 'place', def: 'core/cup@2', name: 'private-mug', in: {parent: 'private-pantry', slot: 'in-1'}, p: [0, 0]},
 ]})); await tick(60);
 await refuse('pour the tea', 'tea.no-cup');

 // ---- persistence and replay; a clean engine
 const clone = factory.restore(f.host.engine.snapshot()); assert.equal(clone.stateHash(), f.host.engine.stateHash());
 for (let i = 0; i < 40; i++) {clone.step(); f.host.engine.step(); assert.equal(clone.stateHash(), f.host.engine.stateHash());}
 assert.deepEqual(f.host.engine.runtime.violations, []);
 const brief = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v && v.phase ? {capability: v.capability, phase: v.phase} : v]));
 const report = {status: 'pass', hereBytes: {absent: bytes(absent), distant100PantriesWithApples: bytes(far), nearbyHolding: bytes(holdingApple), nearbyWithApple: bytes(withApple)}, rows: {withApple: row(withApple)}, results: brief, refusals};
 if (out) {mkdirSync(out, {recursive: true}); writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2));}
 console.log(JSON.stringify(report));
});
