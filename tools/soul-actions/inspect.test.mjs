import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

// CTRL-2 (#1094): a three-level drill costs three calls and no caps read; a far thing adds nothing to `here`.
test('inspect drills place -> object -> item, and here groups its offers', {timeout: 300000}, async (t) => {
 const dir = mkdtempSync(join(tmpdir(), 'soul-inspect-'));
 const f = fixture(join(dir, 'world.db'), factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 t.after(() => {comms.close(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
 const tick = async (k = 5) => {for (let i = 0; i < k; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 await tick(); await invite(f, 'ana');
 const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Inspect test'}));
 soul = {soulId: row.id, entityId: row.entityId ?? row.entity_id, name: 'Ana', owner: 'dev:ana'};
 await tick();
 const W = () => f.host.engine.world, [ax, az] = [W().entities[soul.entityId].pose.p[0], W().entities[soul.entityId].pose.p[2]];
 const here = async () => (await (await app.request('/v1/edge/here?include=doHere')).json()).here;
 const inspect = async (id, q = '') => {const r = await app.request(`/v1/edge/inspect/${encodeURIComponent(id)}${q}`); return {status: r.status, body: await r.json()};};
 const before = await here(), bytes = (h) => JSON.stringify({...h, tick: 0}).length;
 assert.ok(before.offers && typeof before.offers === 'object', 'here has grouped offers');
 assert.ok(JSON.stringify(before.offers).length <= 500, 'within its budget');

 const far = []; for (let i = 0; i < 100; i++) far.push({op: 'place', def: 'core/table@1', name: `far-${i}`, p: [100 + (i % 10) * 2, 100 + Math.floor(i / 10) * 2]});
 assert.equal(god.act({ops: far}).accepted, true); await tick(30);
 assert.deepEqual((await here()).offers, before.offers, '100 far tables change nothing');
 assert.equal(bytes(await here()), bytes(before), 'and add 0 bytes');

 const sc = god.act({ops: [
  {op: 'place', def: 'core/counter@1', name: 'counter', p: [ax, az - 1.4]},
  {op: 'place', def: 'core/kettle@2', name: 'kettle', in: {parent: 'counter', slot: 'top'}, p: [0.3, 0.1], state: {level: 1, heatTick: -1}},
 ]});
 assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(40);
 const id = (n) => [...god.model.entities.values()].find((e) => e.name === n).id;

 const grouped = (await here()).offers;
 for (const [verb, g] of Object.entries(grouped)) if (g && g.count) assert.ok(g.count >= g.nearest.length && g.nearest.length <= 3, verb + JSON.stringify(g));
 // A4: each level's ids come from the level above: place -> counter -> kettle, three calls and no caps read
 const named = (list, name) => list?.find((c) => c.name === name)?.id;
 const place = edge.placeIdOf?.(soul.soulId) ?? (await here()).me.place;
 const level1 = await inspect(place);
 assert.equal(level1.status, 200, JSON.stringify(level1.body)); assert.equal(level1.body.inspect.kind, 'place');
 assert.equal(named(level1.body.inspect.contents, 'counter'), id('counter'), 'the place lists what stands in it, nearest first');
 assert.ok(!level1.body.inspect.contents.some((c) => c.id === id('kettle') || c.id === soul.entityId), 'not what rests on a thing, and no bodies');
 assert.ok(JSON.stringify(level1.body.inspect).length <= 4096, 'within the default budget');
 // A5: the whole world's own 100 far tables overflow the default; `more` counts exactly what `all=1` adds
 const root = [...edge.places.byId.values()].find((p) => p.parent === null);
 const small = (await inspect(root.id)).body.inspect, every = (await inspect(root.id, '?all=1')).body.inspect;
 assert.ok(small.contents.length > 1 && small.more?.contents > 0, JSON.stringify(small.more));
 assert.ok(Buffer.byteLength(JSON.stringify(small)) <= 4096, 'within the default budget with the far tables counted, not listed');
 assert.ok(!every.more && every.contents.length === small.contents.length + small.more.contents, 'all=1 lists what the default left out');
 assert.deepEqual(small.contents.slice(0, 1).map((c) => c.id), every.contents.slice(0, 1).map((c) => c.id), 'nearest first in both');
 const counter = await inspect(id('counter'));
 assert.equal(counter.status, 200); assert.equal(named(counter.body.inspect.contents, 'counter/kettle'), id('kettle'));
 const kettle = await inspect(id('kettle'));
 assert.equal(kettle.status, 200); assert.ok(kettle.body.inspect.offers.some((o) => /fill|pick-up|boil/.test(o.id)), JSON.stringify(kettle.body.inspect.offers));
 assert.ok(JSON.stringify(kettle.body).length <= 4200, 'within the default budget');

 // A4: the library: place -> shelf -> book, then the book's own offer
 const shelved = god.act({ops: [
  {op: 'place', def: 'core/swap-shelf@1', name: 'shelf', p: [ax + 1.6, az - 0.4]},
  {op: 'place', def: 'core/book@1', name: 'atlas', in: {parent: 'shelf', slot: 'in-2'}, p: [0, 0]},
 ]}); assert.equal(shelved.accepted, true, JSON.stringify(shelved.failures?.slice(0, 3))); await tick(40);
 const shelfId = named((await inspect(place)).body.inspect.contents, 'shelf'); assert.equal(shelfId, id('shelf'));
 const shelf = await inspect(shelfId); assert.equal(shelf.body.inspect.kind, 'object');
 const bookId = named(shelf.body.inspect.contents, 'shelf/atlas'); assert.equal(bookId, id('atlas'));
 const book = await inspect(bookId); assert.equal(book.body.inspect.kind, 'item', JSON.stringify(book.body.inspect));
 assert.ok(book.body.inspect.offers.some((o) => o.id === `pick-up:${bookId}` && o.available), JSON.stringify(book.body.inspect.offers));

 // A1: a thing kept out of sight is unknown, and its container doesn't list it
 assert.equal(god.act({ops: [
  {op: 'place', def: 'core/hollow-stump@1', name: 'stump', p: [ax - 2, az + 1.6]},
  {op: 'place', def: 'core/bowl@2', name: 'bowl', in: {parent: 'stump', slot: 'in-1'}, p: [0, 0]},
 ]}).accepted, true); await tick(40);
 const stump = await inspect(id('stump')); assert.equal(stump.status, 200);
 assert.ok(!stump.body.inspect.contents?.some((c) => c.id === id('bowl')), 'a hiding place does not list what is in it');
 assert.equal((await inspect(id('bowl'))).status, 404, 'and the thing in it is unknown');

 // A1: a secret place, and what stands in it, stay unknown until found
 assert.equal(god.act({ops: [
  {op: 'place', def: 'core/zone@1', name: 'grotto', shape: {area: [[ax + 20, az - 3], [ax + 26, az - 3], [ax + 26, az + 3], [ax + 20, az + 3]]}},
  {op: 'place', def: 'core/table@1', name: 'altar', p: [ax + 23, az]},
 ]}).accepted, true); await tick(40);
 const grotto = [...edge.places.byId.values()].find((p) => p.name.toLowerCase() === 'grotto');
 assert.ok(grotto, 'the zone is a place'); assert.equal((await inspect(grotto.id)).status, 200, 'not secret yet');
 assert.equal((await inspect(id('altar'))).status, 200);
 assert.equal(edge.knowledge.setSecret(grotto.id, true), true);
 for (const hidden of [grotto.id, id('altar')]) {
  const r = await inspect(hidden); assert.equal(r.status, 404, hidden); assert.equal(r.body.error.code, 'capability.unknown');
 }
 const parent = await inspect(grotto.parent);
 assert.ok(!parent.body.inspect.parts?.some((c) => c.id === grotto.id) && !parent.body.inspect.contents?.some((c) => c.id === id('altar')), 'its parent does not give it away');
 edge.knowledge.find(soul.soulId, grotto.id, f.host.engine.world.tick);
 assert.equal((await inspect(grotto.id)).status, 200, 'found, it is known'); assert.equal((await inspect(id('altar'))).status, 200);

 const me = await inspect(soul.soulId); assert.equal(me.body.inspect.kind, 'soul');
 for (const k of ['receipts', 'events', 'self', 'placePath']) assert.ok(!(k in me.body.inspect.state), `a Soul's ${k} is not a public fact`);
 const none = await inspect('no-such-thing-at-all'); assert.equal(none.status, 404); assert.equal(none.body.error.code, 'capability.unknown');
});

// #681 A7: a shared operation reads as what it is, to its members only, from proposal to running
test('inspect shows a shared operation to its members: template, load, roles, readiness, offers', {timeout: 300000}, async (t) => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false, sharedCarry: true}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 t.after(() => {comms.close(); f.host.stop(); f.db.close();});
 const tick = async (k = 5) => {for (let i = 0; i < k; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 await tick();
 const souls = {};
 for (const name of ['Ada', 'Bo', 'Cy']) {
  await invite(f, name.toLowerCase());
  const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'Inspect test'}));
  souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
 }
 await tick();
 const {Ada, Bo, Cy} = souls, E = f.host.engine.world.entities, [ax, , az] = E[Ada.entityId].pose.p;
 await accept(f.host, f.host.enqueue('edge-relocate', `test:${Bo.soulId}`, {soulId: Bo.soulId, entityId: Bo.entityId, to: [ax, az + 3], why: 'test setup'}));
 assert.equal(god.act({ops: [
  {op: 'place', def: 'core/zone@1', name: 'shed', shape: {area: [[ax + 7, az - 2], [ax + 10, az - 2], [ax + 10, az + 2], [ax + 7, az + 2]]}},
  {op: 'place', def: 'core/rack-beam@2', name: 'beam', p: [ax + 2, az + 1.5]},
 ]}).accepted, true); await tick(60);
 const beam = god.model.get('beam').id;
 const inspect = async (who, id) => {soul = who; const r = await app.request(`/v1/edge/inspect/${encodeURIComponent(id)}`); return {status: r.status, body: await r.json()};};
 const p = await accept(f.host, edge.act(Ada, {capability: `carry-with:${beam}`, params: {to: 'shed', with: 'Bo'}}));
 assert.equal(p.receipt.phase, 'waiting', JSON.stringify(p));
 const id = p.receipt.shared.invite;

 const mine = (await inspect(Ada, id)).body.inspect;
 assert.equal(mine.kind, 'shared'); assert.deepEqual(mine.state.template, {id: 'carry', version: 1}); assert.equal(mine.state.revision, 1);
 assert.equal(mine.state.load.id, beam); assert.equal(mine.state.destination.name.toLowerCase(), 'shed'); assert.equal(mine.state.phase, 'proposed');
 assert.deepEqual(mine.members.map((m) => [m.name, m.slot, m.accepted]), [['Ada', 0, true], ['Bo', null, false]]);
 assert.ok(mine.offers.some((o) => o.id === `withdraw:${id}`), 'the host can withdraw');
 assert.ok(mine.offers.some((o) => o.id === `carry-with:${beam}` && o.params?.to), 'and amend, with its schema');
 const his = (await inspect(Bo, id)).body.inspect;
 const acc = his.offers.find((o) => o.id === `accept:${id}`); assert.equal(acc?.params?.revision?.type, 'integer', JSON.stringify(his.offers));
 assert.ok(his.offers.some((o) => o.id === `decline:${id}`));
 const other = await inspect(Cy, id); assert.equal(other.status, 404, 'not a member: unknown'); assert.equal(other.body.error.code, 'capability.unknown');

 assert.equal((await accept(f.host, edge.act(Bo, {capability: `accept:${id}`, params: {revision: 1}}))).accepted, true);
 const accepted = (await inspect(Ada, id)).body.inspect;
 assert.deepEqual(accepted.members.map((m) => [m.name, m.slot, m.accepted]), [['Ada', 0, true], ['Bo', 1, true]]);
 assert.ok(accepted.members.every((m) => typeof m.ready === 'boolean'), 'readiness per member');

 for (let i = 0; i < 40 && edge.together.invite(id).state === 'pending'; i++) await tick(10);
 const op = edge.together.invite(id).shared.op; assert.ok(op, 'it committed');
 const running = (await inspect(Bo, op.id)).body.inspect;
 assert.equal(running.id, id, 'the operation id reads the same session'); assert.equal(running.state.op, op.id); assert.ok(['started', 'blocked', 'stopping'].includes(running.state.phase), running.state.phase);
 assert.ok(running.offers.some((o) => o.id === `stop-carry:${op.id}`), JSON.stringify(running.offers));
});
