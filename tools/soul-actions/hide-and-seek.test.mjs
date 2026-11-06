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
import {WorldModel, containerHidden} from '../../packages/world-compiler/src/index.ts';
import {TakeRecorder} from '../../mars/viewer/engine/take/recorder.ts';

// #435 (W068): a hiding place is a doorless container with one declared field (`hidden: true`): what is in it is never named,
// offered or drawn, and only a search finds it. A hand reaches in, taking what it finds or coming away with nothing.
const out = process.env.SOUL_ACTIONS_OUT;
test('hide and seek: hide, search empty and found, nothing told, words, refusals, clue, second place, persistence', {timeout: 600000}, async t => {
 const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
 const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
 const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
 t.after(() => {comms.close(); f.host.stop(); f.db.close();});
 const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
 installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
 const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
 const ok = r => {assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
 const souls = {};
 const join = async (key, name) => {await invite(f, key); const row = await accept(f.host, f.souls.create('dev:' + key, {name, description: 'Hide and seek test'})); souls[name] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick();};
 await tick(); await join('ana', 'Ana'); soul = souls.Ana;
 const here = async (who = soul) => {const prev = soul; soul = who; try {const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here;} finally {soul = prev;}};
 const bytes = h => JSON.stringify(h).length;
 const absent = await here();
 const ent = n => {const e = [...god.model.entities.values()].find(e => e.name === n); assert.ok(e, 'entity ' + n); return e;};
 // long tail: 100 distant stumps, each with a bowl hidden in it
 const distant = Array.from({length: 100}, (_, i) => [{op: 'place', def: 'core/hollow-stump@1', name: `distant-stump-${i}`, p: [120 + i % 10 * 2, 120 + Math.floor(i / 10) * 2]}, {op: 'place', def: 'core/bowl@2', name: `distant-bowl-${i}`, in: {parent: `distant-stump-${i}`, slot: 'in-1'}, p: [0, 0]}]).flat();
 ok(god.act({ops: distant})); await tick(45);
 const far = await here(), farIds = new Set(distant.map(d => ent(d.name).id));
 assert.equal(bytes(far), bytes(absent), '100 distant stumps with hidden bowls add no bytes');
 assert.ok(!JSON.stringify(far).includes('distant-'));
 assert.deepEqual(edge.capabilities(soul).filter(c => c.verb !== 'walk' && ((c.object && farIds.has(c.object)) || (c.target && farIds.has(c.target.id)))).map(c => c.id), [], 'no distant offers');
 const idle = new TakeRecorder(f.host.engine.rt, {rulesVersion: 'hide-and-seek-proof'}); await tick(4);
 assert.ok(!Object.keys(idle.finish().tracks).some(id => farIds.has(id)), 'no idle tracks for distant places or what is in them');

 const body = (s = soul) => f.host.engine.world.entities[s.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
 await join('ben', 'Ben');
 ok(god.act({ops: [
  {op: 'place', def: 'core/table@1', name: 'table', p: [ax + 2.4, az - 1.2]},
  {op: 'place', def: 'core/book@1', name: 'book', in: {parent: 'table', slot: 'top'}, p: [0.25, 0]},
  {op: 'place', def: 'core/bowl@2', name: 'bowl', in: {parent: 'table', slot: 'top'}, p: [-0.25, 0]},
  {op: 'place', def: 'core/lantern@3', name: 'lantern', in: {parent: 'table', slot: 'top'}, p: [0.55, 0.2], state: {on: false}},
  {op: 'place', def: 'core/hollow-stump@1', name: 'stump', p: [ax + 1, az + 2.6], r: Math.PI + 0.4}, // turned off the grid: the body's clearance at the rim is checked at an angle too
  {op: 'place', def: 'core/wall-niche@1', name: 'niche', p: [ax - 2, az + 3.4], r: Math.PI},
  {op: 'place', def: 'core/wall-niche@1', name: 'private-niche', p: [ax + 4.6, az + 3.4], r: Math.PI, access: 'private'},
  {op: 'place', def: 'core/wall-niche@1', name: 'spare', p: [ax - 5.2, az + 1], r: Math.PI / 2},
  {op: 'place', def: 'core/cup@2', name: 'anas-cup', in: {parent: 'spare', slot: 'in-1'}, p: [0, 0], owner: 'soul:Ana', access: 'private'},
  {op: 'place', def: 'core/notice-board@3', name: 'notes', p: [ax - 3, az - 2]}]}));
 await tick(60);
 const id = n => ent(n).id, item = n => f.host.engine.world.entities[id(n)], stumpId = id('stump'), nicheId = id('niche');
 const act = async (words, accepted = true, who = soul) => {const prev = soul; soul = who; try {const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability: words})})); const b = await r.json(); assert.equal(b.accepted, accepted, words + ' ' + JSON.stringify(b).slice(0, 500)); return b;} finally {soul = prev;}};
 const finish = async (r, who = soul, limit = 1600) => {let reach = null;
  for (let n = 0; n < limit; n++) {const ph = edge.receipt(who.soulId, r.receipt.id)?.phase; const hand = body(who).human?.hands?.right; if (hand && (!reach || hand[1] > reach[1])) reach = [...hand]; if (['completed', 'failed', 'cancelled', 'replaced'].includes(ph)) return {phase: ph, reach, receipt: edge.receipt(who.soulId, r.receipt.id)}; await tick(1);}
  throw Error('timed out ' + r.receipt.capability);};
 const done = async (words, who = soul) => {const r = await act(words, true, who); const x = await finish(r, who); assert.equal(x.phase, 'completed', words + ' ' + JSON.stringify(x.receipt).slice(0, 600)); return {...x, capability: r.receipt.capability};};
 const results = {}, refusals = {};
 const refuse = async (words, code, who = soul) => {const b = await act(words, false, who); refusals[words + (who === soul ? '' : ' (' + who.name + ')')] = {code: b.code, reason: b.reason}; if (code) assert.equal(b.code, code, words + ' ' + JSON.stringify(b)); return b;};
 const heldBy = who => Object.values(f.host.engine.world.entities).find(o => o.support?.kind === 'in-hand' && o.support.by === who.entityId)?.id ?? null;
 const tell = x => edge.receipt(x.receipt.soulId, x.receipt.id)?.outcome?.summary;
 const offer = (who, spot) => edge.capabilities(who).find(c => c.id === `search:${spot}`);
 const form = c => c.label.replace(/, \d+ m\)$/, ')');
 const row = (h, spot) => h.objects.find(o => o.id === spot);
 const told = (h, word) => JSON.stringify(h).toLowerCase().includes(word);

 // nothing to open; the search offer is there, whoever asks
 assert.ok(!edge.capabilities(soul).some(c => c.object === stumpId && ['open', 'close'].includes(c.action)), 'a stump has no door to open');
 await refuse('open the stump', 'capability.unknown');
 const emptyNear = await here(), emptyOffer = offer(soul, stumpId);
 assert.ok(emptyOffer?.available, 'offered ' + JSON.stringify(emptyOffer)); assert.equal(row(emptyNear, stumpId)?.state?.holds, undefined);

 // an empty search: a real walk and a reach, empty hands, and the outcome says so
 {const from = [...body(souls.Ben).pose.p], x = await done('search the stump', souls.Ben);
  assert.equal(x.capability, `search:${stumpId}`); assert.equal(heldBy(souls.Ben), null);
  assert.ok(Math.hypot(body(souls.Ben).pose.p[0] - from[0], body(souls.Ben).pose.p[2] - from[2]) > 0.5, 'walked up');
  assert.ok(x.reach && x.reach[1] > 1, 'the hand reached up over the rim ' + JSON.stringify(x.reach));
  assert.match(tell(x), /^You searched stump and came away with nothing\.$/, tell(x)); results.empty = {capability: x.capability, phase: x.phase, reach: x.reach, told: tell(x)};}

 // Ana hides the book
 results.anaPick = await done('pick up the book', souls.Ana);
 const put = await done('hide the book in the stump', souls.Ana);
 assert.equal(put.capability, `put-in:${stumpId}`);
 assert.equal(item('book').support.kind, 'resting-on'); assert.equal(item('book').support.on, stumpId); assert.equal(item('book').support.slot, 'in-1');
 assert.equal(ent('book').in.parent, stumpId); assert.equal(ent('book').in.slot, 'in-1'); assert.equal(heldBy(souls.Ana), null);
 results.hide = {capability: put.capability, phase: put.phase, support: item('book').support};
 await tick(12);
 // hidden from everyone, the hider included
 const book = id('book');
 for (const who of [souls.Ana, souls.Ben]) {
  const h = await here(who), caps = edge.capabilities(who);
  assert.ok(!told(h, 'book'), who.name + ' is told nothing: ' + JSON.stringify(h).slice(0, 400)); assert.equal(row(h, stumpId)?.state?.holds, undefined);
  assert.ok(!caps.some(c => c.target?.id === book || c.object === book || c.id.includes(book) || (c.id !== 'read:here' && /\bbook\b/i.test(c.label))), 'no offer names it: ' + JSON.stringify(caps.filter(c => /book/i.test(c.label + c.id)).map(c => c.id))); // read:here is any Soul's own reading
  const o = offer(who, stumpId); assert.ok(o?.available); assert.equal(form(o), form(emptyOffer), 'the offer reads the same, empty or not');
  await refuse('pick up the book', null, who); await refuse(`pick-up:${book}`, 'capability.unknown', who);
  const w = await refuse('walk to the book', null, who); assert.ok(!/\bbook\b/i.test(JSON.stringify([w.reason, w.did_you_mean])), 'nothing points at it: ' + JSON.stringify(w).slice(0, 300));
 }
 const hiddenNear = await here(souls.Ben);
 assert.ok(bytes(hiddenNear) - bytes(emptyNear) < 200, `nearby detail bounded: ${bytes(emptyNear)} -> ${bytes(hiddenNear)}`);

 // interrupted before the grasp: still hidden, the place unchanged
 {await done('walk to the notes', souls.Ben); const r = await act('search the stump', true, souls.Ben); const st = f.host.engine.world.entities[stumpId].pose.p; for (let n = 0; n < 600 && Math.hypot(body(souls.Ben).pose.p[0] - st[0], body(souls.Ben).pose.p[2] - st[2]) > 1.6; n++) await tick(1);
  await accept(f.host, edge.act(souls.Ben, {capability: 'stand:here'})); await tick(60);
  assert.equal(edge.receipt(souls.Ben.soulId, r.receipt.id).phase, 'replaced'); assert.equal(item('book').support.on, stumpId, 'still hidden'); assert.equal(ent('book').in.parent, stumpId); assert.equal(heldBy(souls.Ben), null); results.interrupted = 'book stayed hidden';}

 // the words for it (each is the search, stopped at once)
 for (const words of ['look in the stump', 'look inside the stump', 'search around here', 'search nearby', 'search for the book', 'take the book from the stump', 'search stump', `search:${stumpId}`, 'search the hollow stump', 'look in the hollow stump', 'search the tree stump', 'search the hiding place']) {
  const r = await act(words, true, souls.Ben); assert.equal(r.receipt.capability, `search:${stumpId}`, words); results[words] = r.receipt.capability;
  await accept(f.host, edge.act(souls.Ben, {capability: 'stand:here'})); await tick(40);
 }
 assert.equal(item('book').support.on, stumpId, 'none of them got as far as a grasp');

 // a clue is an ordinary pinned note (entry 19)
 const notes = id('notes');
 {const r = await accept(f.host, edge.act(souls.Ana, {capability: 'pin a note on the notes', params: {text: 'Look in the hollow stump'}})); assert.ok(r.accepted, JSON.stringify(r).slice(0, 400)); const x = await finish(r, souls.Ana); assert.equal(x.phase, 'completed', JSON.stringify(x.receipt).slice(0, 400)); await tick(20);
  const rd = await act('read the notes', true, souls.Ben), y = await finish(rd, souls.Ben); assert.equal(y.phase, 'completed'); await tick(5);
  const o = edge.receipt(souls.Ben.soulId, rd.receipt.id).outcome; assert.match(JSON.stringify(o), /Look in the hollow stump/); assert.match(JSON.stringify(o), /Ana/); results.clue = {learned: o.learned?.[0]?.fact, untrusted: o.untrusted};}

 // Ben finds it
 {const x = await done('search the stump', souls.Ben);
  assert.equal(x.capability, `search:${stumpId}`); assert.equal(heldBy(souls.Ben), book); assert.equal(item('book').support.kind, 'in-hand'); assert.equal(item('book').support.by, souls.Ben.entityId);
  assert.match(tell(x), /^You found book in stump\.$/, tell(x)); results.found = {capability: x.capability, phase: x.phase, told: tell(x)};}
 await tick(12); assert.equal(ent('book').in.parent, souls.Ben.entityId, 'the model follows');
 assert.ok(told(await here(souls.Ben), 'book'), 'in his hand he knows he has it');

 // refused: full hands (empty place or not, the same); a private place; what does not fit; a full place
 {const a = await refuse('search the niche', 'carry.hands-full', souls.Ben), b = await refuse('search the stump', 'carry.hands-full', souls.Ben); assert.match(a.reason, /Put down what you are holding/); assert.match(b.reason, /Put down what you are holding/);}
 await refuse('search the private niche', 'object.private', souls.Ben);
 assert.equal(offer(souls.Ben, id('private-niche')).blocked.code, 'object.private');
 await done('put the book on the table', souls.Ben);
 results.lantern = await done('pick up the lantern', souls.Ben);
 await refuse('hide the lantern in the stump', 'item.does-not-fit', souls.Ben);
 await done('put the lantern on the table', souls.Ben);

 // a thing this Soul may not take is as if it were not there: the same search, the same words, nothing moved
 {const cup = id('anas-cup'), spare = id('spare'); await done('walk to the spare', souls.Ben);
  const x = await done(`search:${spare}`, souls.Ben); assert.equal(heldBy(souls.Ben), null); assert.match(tell(x), /^You searched spare \(niche\) and came away with nothing\.$/, tell(x)); assert.equal(f.host.engine.world.entities[cup].support.on, spare, 'still there');
  await done('walk to the spare', souls.Ana); const y = await done(`search:${spare}`, souls.Ana); assert.equal(heldBy(souls.Ana), cup, 'its owner finds it'); results.privateThing = {ben: tell(x), ana: tell(y)};
  await done('walk to the stump', souls.Ana); await done('put the cup on the table', souls.Ana);}
 // another Soul's empty reach does not show in the offer, and a second seeker at an empty place ends with an outcome
 {await done('walk to the niche', souls.Ana); await done('walk to the niche', souls.Ben); const a = await act(`search:${nicheId}`, true, souls.Ana); let saw = null;
  for (let n = 0; n < 400 && !saw; n++) {if (body(souls.Ana).human?.handActuator?.target === nicheId) saw = offer(souls.Ben, nicheId); await tick(1);}
  assert.ok(saw?.available, 'still available during her reach: ' + JSON.stringify(saw)); const b = await act(`search:${nicheId}`, true, souls.Ben), xa = await finish(a, souls.Ana), xb = await finish(b, souls.Ben); assert.equal(xa.phase, 'completed');
  assert.equal(xb.phase, 'completed', 'the second seeker waits her turn, not refused: ' + JSON.stringify(xb.receipt).slice(0, 300)); assert.equal(xb.receipt.code ?? null, null);
  assert.match(xb.receipt.outcome.summary, /came away with nothing/, JSON.stringify(xb.receipt).slice(0, 300)); results.emptyTogether = {ana: xa.phase, ben: {phase: xb.phase, code: xb.receipt.code, told: xb.receipt.outcome.summary}};}

 // the second place, reached from the front, a different kind of thing
 results.bowlUp = await done('pick up the bowl', souls.Ana);
 const inNiche = await done('stash the bowl in the wall niche', souls.Ana);
 assert.equal(inNiche.capability, `put-in:${nicheId}`); assert.equal(item('bowl').support.on, nicheId); await tick(12);
 assert.ok(!told(await here(souls.Ben), 'bowl'), 'the niche says nothing of it');
 results.bookUp = await done('pick up the book', souls.Ana);
 await refuse(`put-in:${nicheId}`, 'container.full', souls.Ana); // the known limit: her hand finds it
 await done('put the book on the table', souls.Ana);
 {await done('walk to the niche', souls.Ben); const x = await done('look in the niche', souls.Ben); assert.equal(x.capability, `search:${nicheId}`); assert.equal(heldBy(souls.Ben), id('bowl')); assert.match(tell(x), /^You found bowl in niche\.$/, tell(x)); results.niche = {capability: x.capability, told: tell(x)};}
 await done('put the bowl on the table', souls.Ben);

 // two seekers at once: one gets it; never a duplicate, and the other's receipt ends honestly
 ok(god.act({ops: [{op: 'move', id: book, in: {parent: stumpId, slot: 'in-1'}, p: [0, 0], mode: 'strict'}]})); await tick(20);
 {const a = await act('search the stump', true, souls.Ana), b = await act('search the stump', true, souls.Ben), xa = await finish(a, souls.Ana), xb = await finish(b, souls.Ben);
  const holders = [souls.Ana, souls.Ben].filter(s => heldBy(s) === book); assert.equal(holders.length, 1, 'exactly one holds it: ' + JSON.stringify([xa.phase, xb.phase]));
  const loser = holders[0] === souls.Ana ? xb : xa; results.twoSeekers = {winner: holders[0].name, loser: {phase: loser.phase, code: loser.receipt.code, reason: loser.receipt.reason, told: loser.receipt.outcome?.summary}}; console.log(JSON.stringify(results.twoSeekers));
  assert.match(loser.receipt.outcome.summary, /nothing/, 'the other ends honestly: ' + JSON.stringify(results.twoSeekers.loser));
  assert.equal(loser.phase, 'completed', 'the other gets an answer, not a refusal: ' + JSON.stringify(results.twoSeekers.loser));
  assert.match(loser.receipt.outcome.summary, /^Someone else was searching stump too; you came away with nothing\.$/, loser.receipt.outcome.summary);
  await done('put the book on the table', holders[0]);}

 // persistence: hidden again, it stays in place and hidden after a restore; the engine checkpoint replays
 await done('pick up the book', souls.Ana); await done('hide the book in the stump', souls.Ana); await tick(12);
 const restored = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())), undefined, god.model.library);
 const rbook = [...restored.entities.values()].find(e => e.name === 'book'), rbox = restored.entities.get(rbook.in.parent);
 assert.equal(rbook.in.parent, stumpId); assert.ok(containerHidden(restored.resolvedDef(rbox.def)));
 const clone = factory.restore(f.host.engine.snapshot()); assert.equal(clone.stateHash(), f.host.engine.stateHash());
 for (let i = 0; i < 40; i++) {clone.step(); f.host.engine.step(); assert.equal(clone.stateHash(), f.host.engine.stateHash());}
 assert.deepEqual(f.host.engine.runtime.violations, []);
 const report = {status: 'pass', hereBytes: {absent: bytes(absent), distant100StumpsWithHiddenBowls: bytes(far), nearbyEmpty: bytes(emptyNear), nearbyHidden: bytes(hiddenNear)}, offerLabel: form(emptyOffer), results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v && v.receipt ? {capability: v.capability, phase: v.phase} : v])), refusals};
 if (out) {mkdirSync(out, {recursive: true}); writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2)); for (const [k, v] of Object.entries({absent, far, emptyNear, hiddenNear})) writeFileSync(`${out}/here-${k}.json`, JSON.stringify(v, null, 1));}
 console.log(JSON.stringify({hereBytes: report.hereBytes, results: report.results, refusals}));
});
