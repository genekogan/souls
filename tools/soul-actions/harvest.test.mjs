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
import {dryingOps} from '../../apps/server/src/god/garden.ts';
import {handActuatorFrame} from '../../mars/viewer/engine/social/hand-actuator.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';

// #438 W085/W086: picking from a growing planter into a vessel held in one hand. Ana says "pick the tomatoes": she takes the
// basket from the garden table, walks to the fruiting bed and picks with her free hand; at the contact the bed is flowering
// and the basket holds three tomatoes. She puts the basket on the counter. "pick flowers for the vase" is the same faculty
// with the vase's data: the flowering bed goes back to leafy and the vase holds a bunch. Refusals, an interrupted pick, the
// regrowth, the long tail (100 distant baskets and vases add nothing) and a restored snapshot. Plain words throughout.
const out = process.env.SOUL_ACTIONS_OUT;
test('harvest: tomatoes into the basket, flowers into the vase, at the hand contact; refusals; long tail', {timeout: 600000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 const logs = [];
 const bridge = installEngineBridge({host: f.host, god, edge, log(m) { if (/harvest|refused/.test(m)) logs.push(m); }, worldLore: false, worldClock: false});
 const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
 await tick();
 const join = async (k, name) => { await invite(f, k); const row = await accept(f.host, f.souls.create('dev:' + k, {name, description: 'Harvest test'})); await tick(); return {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; };
 const ana = await join('ana', 'Ana'), ben = await join('ben', 'Ben');
 const W = () => f.host.engine.world, body = s => W().entities[s.entityId], as = s => { soul = s; };
 const here = async s => { as(s); const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here; };
 const size = h => JSON.stringify({...h, tick: 0}).length;
 const byName = n => [...god.model.entities.values()].find(e => e.name === n), id = n => byName(n).id, state = n => byName(n).state ?? {}, ent = n => W().entities[id(n)];
 const report = {status: 'fail', hereBytes: {}, words: {}, summaries: {}, refusals: {}, checks: []};
 const [ax, az] = [body(ana).pose.p[0], body(ana).pose.p[2]];
 await accept(f.host, f.host.enqueue('edge-relocate', `edge:${ben.soulId}`, {soulId: ben.soulId, entityId: ben.entityId, to: [ax + 3.5, az - 1.5], why: 'test placement'})); await tick(20);

 // ---- the long tail: 100 baskets and vases in every state 120 m away add nothing ----
 const absentHere = await here(ana), absent = size(absentHere);
 const vstate = i => i % 2 ? [{flowers: 3}, {flowers: 0}][i % 4 >> 1] : [{fruit: 3}, {fruit: 6}, {fruit: 0}][i % 3];
 const far = Array.from({length: 100}, (_, i) => ({op: 'place', def: i % 2 ? 'core/flower-vase@1' : 'core/harvest-basket@1', name: `far-${i}`, p: [120 + (i % 10) * 0.8, 120 + Math.floor(i / 10) * 0.8], state: vstate(i)}));
 const rf = god.act({ops: far}); assert.equal(rf.accepted, true, JSON.stringify(rf.failures?.slice(0, 3))); await tick(60);
 const farHere = await here(ana), distant = size(farHere), farIds = new Set(far.map(d => id(d.name)));
 assert.equal(distant, absent, '100 distant baskets and vases add 0 bytes');
 as(ana); assert.deepEqual(edge.capabilities(ana).filter(c => c.object && farIds.has(c.object)).map(c => c.id), [], 'no distant offers');
 const visits0 = bridge.harvest.visits(); await tick(40); assert.equal(bridge.harvest.visits(), visits0, 'no harvest work per tick without an act');
 Object.assign(report.hereBytes, {absent, distant100: distant});
 report.checks.push('long tail: 100 distant baskets and vases (with tomatoes, full, empty; with flowers, empty): +0 bytes, no offers; no per-tick visits');

 // ---- the garden: a fruiting bed, a leafy bed, a garden table with the basket and the vase, a counter ----
 const sc = god.act({ops: [
  {op: 'place', def: 'core/garden-planter@2', name: 'bed', p: [ax, az + 2.6], state: {growth: 4, moisture: 1}},
  {op: 'place', def: 'core/garden-planter@2', name: 'bed-two', p: [ax + 4, az + 2.6], state: {growth: 2, moisture: 1}},
  {op: 'place', def: 'core/garden-planter@2', name: 'private-bed', p: [ax + 7, az + 2.6], access: 'private', state: {growth: 4, moisture: 1}},
  {op: 'place', def: 'core/harvest-basket@1', name: 'full-basket', p: [ax - 4.5, az - 1.5], state: {fruit: 6}},
  {op: 'place', def: 'core/table@1', name: 'garden-table', p: [ax - 2.2, az + 0.6]},
  {op: 'place', def: 'core/harvest-basket@1', name: 'basket', in: {parent: 'garden-table', slot: 'top'}, p: [0.2, 0.1]},
  {op: 'place', def: 'core/flower-vase@1', name: 'vase', in: {parent: 'garden-table', slot: 'top'}, p: [-0.25, 0.1]},
  {op: 'place', def: 'core/counter@1', name: 'counter', p: [ax + 2.2, az - 0.4]}]});
 assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(60);
 const cap = (s, c) => { as(s); return edge.capabilities(s).find(x => x.id === c); };
 const refused = (s, c, code, words) => { const x = cap(s, c); assert.ok(x && !x.available, c + ' should be refused ' + JSON.stringify(x)); assert.equal(x.blocked?.code, code, JSON.stringify(x)); if (words) assert.match(x.blocked.reason, words, JSON.stringify(x.blocked)); report.refusals[`${s.name} ${code}`] = x.blocked.reason; };
 const basketPick = `object:${id('basket')}:harvest`, vasePick = `object:${id('vase')}:harvest`;
 assert.match(cap(ana, basketPick)?.label ?? '', /^Pick the ripe tomatoes into the basket/);
 assert.match(cap(ana, vasePick)?.label ?? '', /^Pick flowers for the vase/);
 assert.equal(cap(ana, basketPick).available, true, JSON.stringify(cap(ana, basketPick)));
 refused(ana, vasePick, 'harvest.not-ripe', /Nothing in bed is ready .*: it is fruiting, and flowers are picked when it is flowering/);
 const nearHere = await here(ana); report.hereBytes.nearby = size(nearHere);
 assert.ok(!JSON.stringify(nearHere).includes('"fruit"') && !JSON.stringify(nearHere).includes('"flowers"'), 'an empty basket and vase say nothing');
 let retries = 0;
 const act = async (s, capability, want = true) => { let b; for (let k = 0; k < 20; k++) { as(s); const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability})})); b = await r.json(); if (b.code !== 'object.admission-failed') break; retries++; await tick(10); } assert.equal(b.accepted, want, capability + ' ' + JSON.stringify(b).slice(0, 400)); return b; };
 const phase = (s, b) => edge.receipt(s.soulId, b.receipt.id)?.phase;
 // a picking act to its end; the tick the planter changed and the tick of the hand's recorded contact
 const pick = async (s, words, watch) => {
  const b = await act(s, words); report.words[`${s.name}: ${words}`] = b.capability ?? b.receipt?.capability;
  let changed = null, contact = null; const before = state(watch).growth;
  for (let n = 0; n < 9000; n++) { const m = body(s).human?.handActuator; if (m && contact === null && handActuatorFrame(m, (W().tick - m.startTick) * f.host.engine.dt).contact) contact = W().tick; if (changed === null && state(watch).growth !== before) changed = W().tick; if (['completed', 'failed', 'cancelled', 'replaced'].includes(phase(s, b))) break; await tick(1); }
  const rc = edge.receipt(s.soulId, b.receipt.id); assert.equal(rc.phase, 'completed', JSON.stringify(rc).slice(0, 600));
  report.summaries[`${s.name}: ${words}`] = JSON.stringify(b).match(/"summary":"([^"]*)"/)?.[1] ?? rc.outcome?.summary;
  return {changed, contact, rc, b};
 };
 const done = async (s, words) => { const b = await act(s, words); report.words[`${s.name}: ${words}`] = b.capability ?? b.receipt?.capability; for (let n = 0; n < 9000 && !['completed', 'failed', 'cancelled', 'replaced'].includes(phase(s, b)); n++) await tick(1); assert.equal(phase(s, b), 'completed', words); };

 // ---- an interrupted pick changes nothing: she has the basket, the hand is on its way, she is told to stand ----
 const ib = await act(ana, 'pick the tomatoes'); let reaching = false;
 for (let n = 0; n < 9000 && !reaching; n++) { const m = body(ana).human?.handActuator; if (m && m.target === id('bed')) reaching = true; else await tick(1); }
 assert.ok(reaching, 'the hand started for the bed');
 const stop = await act(ana, 'stand:here'); for (let n = 0; n < 400 && !['completed', 'failed', 'cancelled', 'replaced'].includes(phase(ana, stop)); n++) await tick(1); await tick(40);
 assert.notEqual(phase(ana, ib), 'completed', 'the pick was interrupted');
 assert.equal(state('bed').growth, 4, 'the bed keeps its tomatoes'); assert.equal(state('basket').fruit ?? 0, 0, 'no tomatoes appear');
 assert.equal(ent('basket').support?.by, ana.entityId, 'she still holds the basket');
 assert.equal(bridge.harvest.watchingCount(), 0, 'the interrupted act is no longer watched, though she holds the basket');
 report.checks.push(`interrupted before the contact (${phase(ana, ib)}): the bed stays fruiting, the basket empty`);

 // ---- "pick the tomatoes": from the basket in her hand, at the contact ----
 const p1 = await pick(ana, 'pick the tomatoes', 'bed');
 assert.equal(state('bed').growth, 3, 'the bed is flowering'); assert.equal(state('basket').fruit, 3, 'three tomatoes in the basket');
 assert.ok(p1.contact !== null && p1.changed !== null && p1.changed >= p1.contact, `the bed changed at the contact (contact ${p1.contact}, changed ${p1.changed})`);
 assert.equal(ent('basket').support?.by, ana.entityId); assert.equal(ent('basket').support?.hand, 'right');
 assert.match(report.summaries['Ana: pick the tomatoes'] ?? '', /Picks 3 tomatoes from bed into .*basket at the hand's touch/);
 assert.equal(state('private-bed').growth, 4, 'the private bed, though fruiting, was not picked');
 assert.deepEqual(bridge.harvest.facts(id('basket')), {fruit: 3});
 const fullHere = await here(ana), row = fullHere.objects?.find(o => o.id === id('basket')), bedRow = fullHere.objects?.find(o => o.id === id('bed'));
 report.hereBytes.nearbyWithTomatoes = size(fullHere); report.basketRow = row ?? null; report.bedRow = bedRow ?? null;
 assert.deepEqual(row?.state, {fruit: 3}, 'nearby, the basket says fruit: 3');
 assert.equal(bedRow?.state?.stage, 'flowering', 'nearby, the bed says flowering');
 // the only fruiting bed left is someone else's and private: it is named, never picked
 refused(ana, basketPick, 'object.private', /private-bed is not yours and private/);
 refused(ana, `object:${id('full-basket')}:harvest`, 'harvest.vessel-full', /already holds 6 tomatoes and has no room for more/);
 refused(ben, basketPick, 'harvest.vessel-held', /Someone else is holding/);
 report.checks.push('pick: the bed fruiting -> flowering and the basket 0 -> 3 at the hand contact, not before; then refused: nothing ripe; Ben: in someone else\'s hand');

 await tick(5); assert.equal(bridge.harvest.watchingCount(), 0, 'after the pick nothing is watched, though she holds the basket');
 const v1 = bridge.harvest.visits(); await tick(40); assert.equal(bridge.harvest.visits(), v1, 'no per-tick work after the pick');
 // ---- the regrowth: the existing daily pass grows the moist bed back to fruiting ----
 const grow = dryingOps(god.model, 1).find(o => o.id === id('bed'));
 assert.equal(grow?.state?.growth, 4, 'a day later the moist bed is fruiting again ' + JSON.stringify(grow));
 report.checks.push('regrowth: the daily pass (garden.ts) takes the picked bed from flowering to fruiting again');

 // ---- "put the basket on the counter" ----
 await done(ana, 'put the basket on the counter');
 assert.equal(ent('basket').support?.kind, 'resting-on'); assert.equal(ent('basket').support?.on, id('counter')); assert.equal(state('basket').fruit, 3, 'the tomatoes stay in it');

 // ---- "pick flowers for the vase": the same faculty, the vase's data; the bed is flowering now ----
 assert.equal(cap(ana, vasePick).available, true, JSON.stringify(cap(ana, vasePick)));
 const p2 = await pick(ana, 'pick flowers for the vase', 'bed');
 assert.equal(state('bed').growth, 2, 'the bed is leafy'); assert.equal(state('vase').flowers, 3, 'a bunch in the vase');
 assert.ok(p2.contact !== null && p2.changed >= p2.contact, 'at the contact');
 assert.equal(state('bed-two').growth, 2, 'the other bed is untouched');
 refused(ana, vasePick, 'harvest.vessel-full', /already holds 3 flowers and has no room for more/);
 const vaseRow = (await here(ana)).objects?.find(o => o.id === id('vase')); report.vaseRow = vaseRow ?? null;
 assert.deepEqual(vaseRow?.state, {flowers: 3}, 'nearby, the vase says flowers: 3');
 await done(ana, 'put the vase on the table');
 assert.equal(ent('vase').support?.on, id('garden-table')); assert.equal(state('vase').flowers, 3);
 report.checks.push('flowers: the vase from the table, the bed flowering -> leafy and the vase 0 -> 3 at the contact; full refused; set back on the table with its flowers');

 // ---- hands full: Ben holds the vase; the basket (room for 3 more) is refused to him ----
 await done(ben, 'pick up the vase');
 refused(ben, basketPick, 'harvest.hands-full', /You are holding .*vase; put it down first/);

 // ---- persistence ----
 const restored = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())), undefined, god.model.library);
 assert.equal([...restored.entities.values()].find(e => e.name === 'basket').state.fruit, 3); assert.equal([...restored.entities.values()].find(e => e.name === 'vase').state.flowers, 3); assert.equal(restored.get('bed').state.growth, 2);
 report.checks.push('persistence: a restored snapshot keeps the basket\'s tomatoes, the vase\'s flowers and the bed\'s stage');
 assert.deepEqual(f.host.engine.runtime.violations, []);
 report.status = 'pass'; report.retries = retries; report.logs = logs.slice(0, 20);
 if (out) { mkdirSync(out, {recursive: true}); writeFileSync(`${out}/harvest.json`, JSON.stringify(report, null, 2)); }
 console.log(JSON.stringify(report));
});

// "pick the tomatoes from the rose bed" picks from the rose bed, not the nearer ripe one; a planter by a name nobody has, or
// one not ripe, is refused by name and nothing changes.
test('harvest: two ripe beds, the named one is picked', {timeout: 300000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
 await tick(); await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Harvest two beds'}));
 soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();
 const W = () => f.host.engine.world, me = W().entities[soul.entityId].pose.p, [ax, az] = [me[0], me[2]];
 const byName = n => [...god.model.entities.values()].find(e => e.name === n), state = n => byName(n).state ?? {};
 const sc = god.act({ops: [
  {op: 'place', def: 'core/garden-planter@2', name: 'near-bed', p: [ax + 1.5, az + 2.4], state: {growth: 4, moisture: 1}},
  {op: 'place', def: 'core/garden-planter@2', name: 'rose-bed', p: [ax - 3.5, az + 4.4], state: {growth: 4, moisture: 1}},
  {op: 'place', def: 'core/garden-planter@2', name: 'herb-bed', p: [ax + 5.5, az + 2.4], state: {growth: 2, moisture: 1}},
  {op: 'place', def: 'core/table@1', name: 'garden-table', p: [ax - 1.2, az - 1.4]},
  {op: 'place', def: 'core/harvest-basket@1', name: 'basket', in: {parent: 'garden-table', slot: 'top'}, p: [0.2, 0.1]}]});
 assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(60);
 const act = async (capability) => { const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability})})); return r.json(); };
 const nothing = () => assert.deepEqual([state('near-bed').growth, state('rose-bed').growth, state('herb-bed').growth, state('basket').fruit ?? 0], [4, 4, 2, 0], 'nothing changed');
 // with nothing ripe anywhere, a planter by a name nobody has is refused for that name, not for the nearest bed's stage
 assert.equal(god.act({ops: [{op: 'set', id: 'near-bed', state: {growth: 3}}, {op: 'set', id: 'rose-bed', state: {growth: 3}}]}).accepted, true); await tick(5);
 const none = await act('pick the tomatoes from the shed'); assert.equal(none.accepted, false); assert.match(JSON.stringify(none), /no garden planter called \\"shed\\"/, JSON.stringify(none).slice(0, 300));
 assert.equal(god.act({ops: [{op: 'set', id: 'near-bed', state: {growth: 4}}, {op: 'set', id: 'rose-bed', state: {growth: 4}}]}).accepted, true); await tick(5);
 const no = await act('pick the tomatoes from the shed'); assert.equal(no.accepted, false, JSON.stringify(no).slice(0, 300));
 assert.match(JSON.stringify(no), /no garden planter called \\"shed\\"/, JSON.stringify(no).slice(0, 300)); nothing();
 const unripe = await act('pick the tomatoes from the herb bed'); assert.equal(unripe.accepted, false, JSON.stringify(unripe).slice(0, 300));
 assert.match(JSON.stringify(unripe), /Nothing in herb-bed is ready/, JSON.stringify(unripe).slice(0, 300)); nothing();
 const b = await act('pick the tomatoes from the rose bed'); assert.equal(b.accepted, true, JSON.stringify(b).slice(0, 400));
 assert.match(JSON.stringify(b), /from rose-bed/, 'the summary names the rose bed');
 for (let n = 0; n < 9000 && !['completed', 'failed', 'cancelled', 'replaced'].includes(edge.receipt(soul.soulId, b.receipt.id)?.phase); n++) await tick(1);
 assert.equal(edge.receipt(soul.soulId, b.receipt.id).phase, 'completed', JSON.stringify(edge.receipt(soul.soulId, b.receipt.id)).slice(0, 400));
 assert.equal(state('rose-bed').growth, 3, 'the named bed was picked'); assert.equal(state('near-bed').growth, 4, 'the nearer ripe bed keeps its tomatoes');
 assert.equal(state('basket').fruit, 3);
 // "from the bed" names no planter in particular (no planter is called that): the nearest ripe one, as before
 const g = await act('pick some tomatoes from the bed'); assert.equal(g.accepted, true, JSON.stringify(g).slice(0, 400)); assert.match(JSON.stringify(g), /from near-bed/);
 for (let n = 0; n < 9000 && !['completed', 'failed', 'cancelled', 'replaced'].includes(edge.receipt(soul.soulId, g.receipt.id)?.phase); n++) await tick(1);
 assert.equal(edge.receipt(soul.soulId, g.receipt.id).phase, 'completed'); assert.equal(state('near-bed').growth, 3); assert.equal(state('basket').fruit, 6);
 assert.deepEqual(W().runtime?.violations ?? f.host.engine.runtime.violations, []);
 if (out) { mkdirSync(out, {recursive: true}); writeFileSync(`${out}/harvest-two-beds.json`, JSON.stringify({status: 'pass', refused: [no.code, unripe.code], picked: 'rose-bed', near: state('near-bed').growth}, null, 1)); }
});

// review of #1022: a plan that takes the vessel on the way gets the answer a pick-up gets, so a basket for sale stays on the table
test('harvest: a basket for sale is refused as a pick-up is, and nothing is taken', {timeout: 120000}, async t => {
 const was = process.env.LAYERS; process.env.LAYERS = '1'; t.after(() => { if (was === undefined) delete process.env.LAYERS; else process.env.LAYERS = was; });
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => { comms.close(); f.host.stop(); f.db.close(); });
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
 await tick(); await invite(f, 'ana');
 const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Harvest test'})); await tick();
 soul = {soulId: row.id, entityId: row.entity_id ?? row.entityId, name: 'Ana', owner: 'dev:ana'};
 const p = f.host.engine.world.entities[soul.entityId].pose.p, [ax, az] = [p[0], p[2]];
 assert.equal(god.act({ops: [
  {op: 'place', def: 'core/garden-planter@2', name: 'bed', p: [ax + 2, az], state: {growth: 4, moisture: 1}},
  {op: 'place', def: 'core/table@1', name: 'stall', p: [ax, az + 2]},
  {op: 'place', def: 'core/harvest-basket@1', name: 'basket', in: {parent: 'stall', slot: 'top'}, p: [0, 0], price: {amount: 3}}]}).accepted, true);
 await tick(45);
 const ent = () => [...god.model.entities.values()].find(e => e.name === 'basket'), basket = ent().id, offer = edge.capabilities(soul).find(c => c.id === `object:${basket}:harvest`);
 const take = edge.capabilities(soul).find(c => c.id === `pick-up:${basket}`);
 assert.equal(take?.blocked?.code, 'object.for-sale', JSON.stringify(take));
 const r = await (await app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: offer.id, strict: true})})).json();
 const code = r.accepted ? edge.receipt(soul.soulId, r.receipt.id).code : r.code;
 assert.equal(code, 'object.for-sale', JSON.stringify(r).slice(0, 300));
 await tick(30); assert.equal(Number(ent().state?.fruit ?? 0), 0, 'nothing picked');
});
