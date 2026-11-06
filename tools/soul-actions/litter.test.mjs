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

// #1088 (W065, #434): litter, and bins a Soul puts it in by hand: entry 42's container faculty with data only.
const out = process.env.SOUL_ACTIONS_OUT;
test('litter: pick up a wrapper and put it in a bin by plain words; the wheelie bin the same; full, does not fit, long tail', {timeout: 900000}, async t => {
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
 const act = async (words, accepted = true) => {const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})); const b = await r.json(); assert.equal(b.accepted, accepted, words + ' ' + JSON.stringify(b).slice(0, 500)); return b;};
 const finish = async (r, each = null, limit = 2400) => {for (let n = 0; n < limit; n++) {if (each) each(); const rc = edge.receipt(soul.soulId, r.receipt.id); if (['completed', 'failed', 'cancelled', 'replaced'].includes(rc?.phase)) return rc; await tick(1);} throw Error('timed out ' + r.receipt.capability);};
 const done = async (words, each = null) => {const r = await act(words), rc = await finish(r, each); assert.equal(rc.phase, 'completed', words + ' ' + JSON.stringify(rc).slice(0, 600)); return {...rc, capability: r.receipt.capability};};
 const refusals = {}, results = {};
 const refuse = async (words, code) => {const b = await act(words, false); refusals[words] = {code: b.code, reason: b.reason}; if (code) assert.equal(b.code, code, words + ' ' + JSON.stringify(b)); return b;};
 const resolved = async words => {const r = await (await app.request('/v1/edge/resolve', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})).json(); return r.resolve?.would?.capability ?? null;};
 const held = n => item(n).support?.kind === 'in-hand' && item(n).support.by === soul.entityId;
 // ---- L6: 100 distant bins, each holding a wrapper
 const distant = Array.from({length: 100}, (_, i) => [{op: 'place', def: 'core/bin@2', name: `distant-bin-${i}`, p: [120 + i % 10 * 2, 120 + Math.floor(i / 10) * 2]}, {op: 'place', def: 'core/wrapper@1', name: `distant-wrapper-${i}`, in: {parent: `distant-bin-${i}`, slot: 'in-1'}, p: [0, 0]}]).flat();
 ok(god.act({ops: distant})); await tick(45);
 const far = await here(), farIds = new Set(distant.map(d => id(d.name)));
 assert.equal(bytes(far), bytes(absent), '100 distant bins with litter add no bytes'); assert.ok(!JSON.stringify(far).includes('distant-'));
 assert.deepEqual(edge.capabilities(soul).filter(c => c.verb !== 'walk' && ((c.object && farIds.has(c.object)) || (c.target && farIds.has(c.target.id)))).map(c => c.id), [], 'no distant offers');

 const body = () => f.host.engine.world.entities[soul.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
 ok(god.act({ops: [
  {op: 'place', def: 'core/bin@2', name: 'bin', p: [ax + 1.6, az + 2.2], r: 0.4},
  {op: 'place', def: 'core/wheelie-bin@2', name: 'wheelie-bin', p: [ax - 2.2, az + 2.4], r: Math.PI},
  {op: 'place', def: 'core/wrapper@1', name: 'wrapper', p: [ax + 0.8, az + 0.9]},
  {op: 'place', def: 'core/wrapper@1', name: 'paper', p: [ax - 0.9, az + 0.8]},
  {op: 'place', def: 'core/book@1', name: 'book', p: [ax + 0.2, az - 1.0]},
 ]})); await tick(60);
 const binId = id('bin'), row = h => h.objects.find(o => o.id === binId), inside = (b = binId) => [...god.model.entities.values()].filter(e => e.in?.parent === b);

 // ---- L1: pick it up, put it in the bin
 results.pick = await done('pick up the wrapper'); assert.ok(held('wrapper'));
 results.binIt = await done('put the wrapper in the bin');
 assert.match(results.binIt.capability, new RegExp(`put-in:${binId}$`));
 assert.equal(item('wrapper').support.kind, 'resting-on'); assert.equal(item('wrapper').support.on, binId); assert.equal(ent('wrapper').in.parent, binId);
 assert.deepEqual(row(await here())?.state, {holds: ['wrapper']}, 'L3 nearby: what is in the bin');
 // ---- L1 words: "throw it away", "bin it", "throw the wrapper in the bin" are the same put-in
 for (const w of ['throw it away', 'throw away the wrapper', 'bin it', 'throw the wrapper in the bin', 'put the litter in the bin']) {
  ok(god.act({ops: [{op: 'place', def: 'core/wrapper@1', name: 'w2', p: [ax + 1.0, az + 1.2]}]})); await tick(30);
  if (inside().length >= 3) {ok(god.act({ops: inside().map(e => ({op: 'remove', id: e.id}))})); await tick(10);}
  await done(`pick-up:${id('w2')}`); const r = await done(w); assert.match(r.capability, new RegExp(`put-in:${binId}$`), w); assert.equal(item('w2').support.on, binId, w);
  ok(god.act({ops: [{op: 'remove', id: id('w2')}]})); await tick(10);
 }
 // ---- L5: the wheelie bin, the same code
 results.pick2 = await done('pick up the paper');
 results.wheelie = await done('put the paper in the wheelie bin'); assert.equal(item('paper').support.on, id('wheelie-bin'));
 // ---- L1 (amended): a thing is picked up by its name: a god that names it "litter" gets "pick up the litter"
 ok(god.act({ops: [{op: 'place', def: 'core/wrapper@1', name: 'litter', p: [ax + 0.9, az + 1.1]}]})); await tick(30);
 results.pickLitter = await done('pick up the litter'); assert.ok(held('litter'), results.pickLitter.capability);
 results.binScrap = await done('throw it away'); assert.equal(item('litter').support.on, binId);
 // ---- L4: a full bin, refused (it truly can't take another)
 {const free = ['in-1', 'in-2', 'in-3'].filter(s => !inside().some(e => e.in.slot === s)); ok(god.act({ops: free.map((slot, i) => ({op: 'place', def: 'core/wrapper@1', name: `fill-${i}`, in: {parent: 'bin', slot}, p: [0, 0]}))})); await tick(20);}
 ok(god.act({ops: [{op: 'place', def: 'core/wrapper@1', name: 'one-more', p: [ax + 1.0, az + 1.0]}]})); await tick(30);
 await done(`pick-up:${id('one-more')}`); await refuse(`put-in:${binId}`, 'container.full');
 // the words for a bin, with this one full, find a bin that has room: an answer, not a refusal
 results.wheelie2 = await done('put the wrapper in the bin'); assert.equal(item('one-more').support.on, id('wheelie-bin'), results.wheelie2.capability);
 // ---- L4: a book does not fit
 await done('pick up the book');
 {const b = await refuse('put the book in the bin', 'item.does-not-fit'); assert.match(b.reason, /does not fit in bin/);}
 const clone = factory.restore(f.host.engine.snapshot()); assert.equal(clone.stateHash(), f.host.engine.stateHash());
 assert.deepEqual(f.host.engine.runtime.violations, []);
 const report = {status: 'pass', hereBytes: {absent: bytes(absent), distant100BinsWithLitter: bytes(far)}, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {capability: v.capability, phase: v.phase}]))};
 if (out) {mkdirSync(out, {recursive: true}); writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2));}
 console.log(JSON.stringify(report));
});
