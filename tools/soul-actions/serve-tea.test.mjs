import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {cupFrame, cupEvents, drinkTea} from '../../mars/viewer/engine/items/cup.ts';

// Entry 44: serving and sharing tea, drinking it, washing up. Ana makes a cup of tea and offers it to Ben (entry 41's
// hand-over); he accepts. Ana makes a second cup; both drink at the table at once, in sips (the tea a pure function of
// drink time, written at the sip moments, never by a per-tick scan); both mugs go on the table empty; Ben washes his at
// the camp sink and sets it down clean. Refusals; the long tail (100 distant mugs in every state add nothing); a second
// boot keeps the table as it was. Plain words throughout (the server's resolver), offer ids for refusals.
const out = process.env.SOUL_ACTIONS_OUT;
const r3 = (x) => Math.round(x * 1000) / 1000;
test('serve, share, drink and wash up: a real cup of tea from hand to hand to empty to clean', {timeout: 900000}, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'soul-actions-serve-tea-'));
 const report = {pass: false, contextBytes: {}, checks: [], words: {}, drinks: {}, timeline: []};
 const boot = async (n) => {
  const f = fixture(join(dir, 'world.db'), factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  const logs = [];
  const bridge = installEngineBridge({host: f.host, god, edge, log(m) { if (/tea|refused/.test(m)) logs.push(m); }, worldLore: false, worldClock: false});
  const tick = async (k = 5) => { for (let i = 0; i < k; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  const souls = {};
  if (n === 0) for (const [k, name] of [['ana', 'Ana'], ['ben', 'Ben']]) { await invite(f, k); const row = await accept(f.host, f.souls.create('dev:' + k, {name, description: 'Serve-tea test'})); souls[k] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick(); }
  await tick();
  const close = () => { comms.close(); f.host.stop(); f.db.close(); };
  return {f, edge, app, god, bridge, souls, tick, logs, close, as: (s) => { soul = s; }};
 };
 let w = await boot(0);
 try {
  const {f, edge, app, god, souls: {ana, ben}, tick, as} = w;
  const W = () => f.host.engine.world, body = (s) => W().entities[s.entityId], at = (s) => [body(s).pose.p[0], body(s).pose.p[2]];
  const here = async (s) => { as(s); const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here; };
  const size = (h) => JSON.stringify({...h, tick: 0}).length, bytes = async (s) => size(await here(s));
  const byName = (n) => [...god.model.entities.values()].find((e) => e.name === n), id = (n) => byName(n).id, state = (n) => byName(n).state ?? {}, ent = (n) => W().entities[id(n)];
  const put = async (s, x, z) => { await accept(f.host, f.host.enqueue('edge-relocate', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test placement'})); await tick(3); };
  const [ax, az] = at(ana);
  await put(ben, ax + 1.8, az + 0.6); await tick(20);
  const recoveries = () => f.db.events(f.host.worldId, 0).filter((e) => e.kind === 'rules' && e.payload?.recovery).length;

  // ---- context: absent; 100 mugs in every state (with tea, part drunk, empty, clean) and 100 kettles 120 m away; 20 + 20
  // at 17-24 m (inside the 30 m object-offer radius): `here` must not grow
  const absentHere = await here(ana), absent = size(absentHere), absentBen = await bytes(ben);
  const t0 = W().tick, ox = ax > 0 ? ax - 24 : ax + 17, oz = az > 0 ? az - 24 : az + 17, far = [], mid = [];
  const mugState = (i) => [{tea: 1, brewedTick: t0}, {tea: 0.4, brewedTick: t0}, {tea: 0, brewedTick: t0}, {tea: 0, brewedTick: -1, bag: false}][i % 4];
  for (let i = 0; i < 20; i++) { const x = ox + (i % 5) * 1.5, z = oz + Math.floor(i / 5) * 1.5;
   mid.push({op: 'place', def: 'core/kettle@2', name: `mid-kettle-${i}`, p: [x, z], state: {level: 1, heatTick: i % 2 ? t0 : -1}}, {op: 'place', def: 'core/cup@2', name: `mid-cup-${i}`, p: [x + 0.3, z], state: mugState(i)}); }
  for (let i = 0; i < 100; i++) { const x = 120 + (i % 10) * 0.75, z = 120 + Math.floor(i / 10) * 0.75;
   far.push({op: 'place', def: 'core/kettle@2', name: `far-kettle-${i}`, p: [x, z], state: {level: 1, heatTick: i % 2 ? t0 : -1}}, {op: 'place', def: 'core/cup@2', name: `far-cup-${i}`, p: [x + 0.3, z], state: mugState(i)}); }
  for (let i = 0; i < far.length; i += 100) { const r = god.act({ops: far.slice(i, i + 100)}); assert.equal(r.accepted, true, JSON.stringify(r.failures?.slice(0, 3))); }
  await tick(60);
  const distant = await bytes(ana), farIds = new Set(far.map((d) => id(d.name)));
  assert.equal(W().entities[id('far-cup-6')]?.support?.kind, 'ground', 'the distant mugs are really there');
  as(ana); assert.deepEqual(edge.capabilities(ana).filter((c) => c.object && farIds.has(c.object)).map((c) => c.id), [], 'no distant offers');
  assert.equal(distant, absent, '100 distant mugs (tea, part drunk, empty, clean) and kettles add 0 bytes');
  for (let i = 0; i < mid.length; i += 100) { const r = god.act({ops: mid.slice(i, i + 100)}); assert.equal(r.accepted, true); }
  await tick(60);
  const midHere = await here(ana), midBytes = size(midHere);
  assert.equal(midBytes, absent, 'mugs 17-24 m away add 0 bytes: ' + Object.keys(midHere).filter((k) => JSON.stringify(midHere[k]) !== JSON.stringify(absentHere[k])).join(','));
  const visits0 = w.bridge?.tea?.visits?.() ?? 0; await tick(40);
  assert.equal(w.bridge?.tea?.visits?.() ?? 0, visits0, 'no tea work per tick without a tea act');
  assert.equal(recoveries(), 0, 'the distant scene raised no engine fault');
  Object.assign(report.contextBytes, {absent, absentBen, distant100: distant, mid20at17to24m: midBytes});
  report.checks.push('long tail: 100 distant mugs in four states + 100 kettles: +0 bytes, no offers; 20+20 at 17-24 m: +0; no per-tick tea visits');

  // ---- the kitchen: a counter with a hot full kettle and two fresh mugs, the camp sink, a table ----
  const cx = ax, cz = az - 1.4;
  const hot = W().tick; // switched on as the kitchen is placed: "make a cup of tea" waits for the boil, then pours
  const sc = god.act({ops: [
   {op: 'place', def: 'core/counter@1', name: 'counter', p: [cx, cz]},
   {op: 'place', def: 'core/kettle@2', name: 'kettle', in: {parent: 'counter', slot: 'top'}, p: [0.3, 0.1], r: Math.PI / 2, state: {level: 1, heatTick: hot}},
   {op: 'place', def: 'core/cup@2', name: 'cup', in: {parent: 'counter', slot: 'top'}, p: [-0.12, 0.19]},
   {op: 'place', def: 'core/cup@2', name: 'cup-two', in: {parent: 'counter', slot: 'top'}, p: [-0.42, 0.19]},
   {op: 'place', def: 'core/camp-sink@1', name: 'sink', p: [cx + 2.2, cz + 0.1], r: Math.PI / 2},
   {op: 'place', def: 'core/table@1', name: 'table', p: [cx - 2.4, cz + 1.8]}]});
  assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(60);
  const cap = (s, c) => { as(s); return edge.capabilities(s).find((x) => x.id === c); };
  const refused = async (s, c, code, limit = 2000) => { let x; for (let n = 0; n < limit; n++) { x = cap(s, c); if (x && !x.available && x.blocked?.code === code) break; await tick(1); }   // #1077: bounded wait for perception (see offered)
   assert.ok(x && !x.available, c + ' should be refused ' + JSON.stringify(x)); assert.equal(x.blocked?.code, code, JSON.stringify(x)); report.checks.push(`refused ${c.split(':').pop()} (${s.name}): ${code}`); };
  let retries = 0;
  const act = async (s, capability, want = true) => { let b; for (let k = 0; k < 20; k++) { as(s); const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability})})); b = await r.json(); if (b.code !== 'object.admission-failed') break; retries++; await tick(10); } assert.equal(b.accepted, want, capability + ' ' + JSON.stringify(b).slice(0, 700)); if (want) report.words[`${s.name}: ${capability}`] = b.receipt?.capability ?? b.capability ?? b.resolved ?? b.receipt?.label ?? null; return b; };
  const phase = (s, r) => edge.receipt(s.soulId, r.receipt.id)?.phase;
  let lastKey = '';
  const sample = () => { const c = ent('cup'), c2 = ent('cup-two'), s = {tick: W().tick, cup: {tea: state('cup').tea, by: c?.support?.by ?? null, kind: c?.support?.kind}, cup2: {tea: state('cup-two').tea, by: c2?.support?.by ?? null}, sink: !!state('sink').on, ana: body(ana).human?.cupV1?.stage ?? body(ana).human?.activity, ben: body(ben).human?.cupV1?.stage ?? body(ben).human?.activity};
   const key = JSON.stringify({...s, tick: 0}); if (key !== lastKey) report.timeline.push(s); lastKey = key; return s; };
  const until = async (pairs, limit = 9000, each) => { for (let n = 0; n < limit; n++) { const s = sample(); each?.(s); const ph = pairs.map(([q, r]) => phase(q, r)); if (ph.every((p) => ['completed', 'failed', 'cancelled', 'replaced'].includes(p))) { pairs.forEach(([q, r], i) => assert.equal(ph[i], 'completed', `${q.name} ${r.receipt.id} ${ph[i]} ${JSON.stringify(edge.receipt(q.soulId, r.receipt.id)).slice(0, 600)}\n${w.logs.slice(-5).join('\n')}`)); return; } await tick(1); } assert.fail('timeout ' + JSON.stringify(pairs.map(([q, r]) => phase(q, r)))); };
  const done = async (s, words, each) => { const r = await act(s, words); await until([[s, r]], 9000, each); return edge.receipt(s.soulId, r.receipt.id); };
  // #1077: offers and their place labels come from background perception, which runs in wall-clock slices (PERCEIVE_SLICE_MS).
  // On a slow runner it can still show a mug where it was before it moved, and a plain-words act then resolves to the stale
  // offer. Wait, bounded, until what Ana is offered matches the world before acting on words.
  const offered = async (s, checks, limit = 2000) => { for (let n = 0; n < limit; n++) { as(s); if (checks.every(([c, want]) => (edge.capabilities(s).find((x) => x.id === c)?.available === true) === want)) return n; await tick(1); }
   assert.fail(`offers not settled within ${limit} ticks: ${JSON.stringify(checks.map(([c]) => [c, cap(s, c)?.available ?? null, cap(s, c)?.blocked?.code ?? null]))}`); };

  // ---- Ana makes a cup of tea and picks it up ----
  await refused(ana, `object:${id('cup')}:drink`, 'tea.cup-empty');
  await refused(ana, `object:${id('cup')}:wash`, 'tea.cup-clean'.replace('clean', 'clean'));
  await done(ana, 'make a cup of tea');
  assert.equal(state('cup').tea, 1, 'a cup of tea'); const brewed = state('cup').brewedTick; assert.ok(brewed > 0);
  await refused(ana, `object:${id('cup')}:wash`, 'tea.cup-not-empty');
  // #628: a full cup on the counter is drunk by taking it first (a step, not a refusal)
  { const d = cap(ana, `object:${id('cup')}:drink`); assert.equal(d?.available, true, JSON.stringify(d)); report.checks.push('drink offered with the cup on the counter'); }
  await done(ana, 'pick up the cup');
  assert.equal(ent('cup').support.by, ana.entityId, 'Ana holds the cup of tea');

  // ---- she offers it to Ben; he accepts: entry 41's hand-over, one holder in every tick, the tea unchanged ----
  const holders = new Set();
  const g = await act(ana, 'offer Ben the tea'); await tick(5);
  const benOffer = await here(ben); assert.match(benOffer.me?.offer ?? '', /^Ana holds out the .+ for you: accept or decline \(\d+ s\)$/, JSON.stringify(benOffer.me));
  report.contextBytes.benOffered = size(benOffer);
  const a = await act(ben, 'accept');
  await until([[ana, g], [ben, a]], 9000, () => { const s = ent('cup').support; assert.equal(s.kind, 'in-hand', 'never out of hand'); holders.add(s.by); });
  assert.equal(ent('cup').support.by, ben.entityId, 'Ben holds it now');
  assert.deepEqual([...holders], [ana.entityId, ben.entityId], 'one holder at a time: Ana, then Ben');
  assert.equal(state('cup').tea, 1); assert.equal(state('cup').brewedTick, brewed, 'same tea through the hand-over'); assert.equal(byName('cup').id, id('cup'));
  report.checks.push('hand-over: "offer Ben the tea" + "accept": holders Ana then Ben, never none; tea 1 and brewedTick unchanged');
  const benHolding = await here(ben), benCupRow = benHolding.objects.find((o) => o.id === id('cup'));
  report.contextBytes.benHoldingTea = size(benHolding); report.cupRowHolding = benCupRow ?? null;

  // ---- Ana makes a second cup and picks it up; both drink at the table at once ----
  await done(ana, 'make a cup of tea'); assert.equal(state('cup-two').tea, 1);
  // #628: she drinks it without picking it up first: the drink takes it from the counter as a step, not a refusal
  assert.notEqual(ent('cup-two').support.kind, 'in-hand');
  const v0 = w.bridge.tea.visits(), tk0 = W().tick;
  const da = await act(ana, `object:${id('cup-two')}:drink`), db = await act(ben, 'drink the tea');
  const seen = {ana: [], ben: []}, motion = {}, tableP = W().entities[id('table')].pose.p;
  let midHereBen = null;
  await until([[ana, da], [ben, db]], 9000, (s) => {
   for (const [k, q, cupName] of [['ana', ana, 'cup-two'], ['ben', ben, 'cup']]) {
    const m = body(q).human?.cupV1; if (m) motion[k] = m;
    const tea = state(cupName).tea, list = seen[k]; if (!list.length || list.at(-1).tea !== tea) list.push({tea, tick: s.tick, atLips: m ? cupFrame(m, (s.tick - m.startTick) * (f.host.engine.dt ?? 0.05)).atLips : null, pure: m ? drinkTea(m, (s.tick - m.startTick) * (f.host.engine.dt ?? 0.05)) : null});
   }
  });
  const ticks = W().tick - tk0, visits = w.bridge.tea.visits() - v0;
  for (const k of ['ana', 'ben']) {
   const list = seen[k], drops = list.slice(1);
   assert.equal(list[0].tea, 1); assert.equal(list.at(-1).tea, 0, k + ' drank it all');
   assert.equal(drops.length, 5, k + ' five sips ' + JSON.stringify(list));
   for (let i = 0; i < drops.length; i++) { assert.ok(drops[i].tea < (i ? drops[i - 1].tea : 1), 'tea only falls'); assert.equal(drops[i].atLips, true, 'each sip with the mug at the lips ' + JSON.stringify(drops[i])); assert.equal(drops[i].tea, drops[i].pure, 'the written tea is the pure function of drink time'); }
   const m = motion[k]; report.drinks[k] = {sips: m.sips, from: m.from, sip: m.sip, moments: cupEvents(m).map((e) => r3(e.at)), steps: list};
  }
  const pa = at(ana), pb = at(ben), apart = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
  assert.ok(apart >= 0.65, 'they stand apart at the table ' + apart);
  for (const p of [pa, pb]) assert.ok(Math.hypot(p[0] - tableP[0], p[1] - tableP[2]) < 1.2, 'at the table ' + JSON.stringify(p));
  assert.ok(visits <= 2 * ticks + 10, `tea visits only the two drinkers: ${visits} in ${ticks} ticks`);
  report.drinkAt = {ana: pa.map(r3), ben: pb.map(r3), apart: r3(apart), visits, ticks};
  report.checks.push(`both drank at the table at once: 5 sips each, tea 1 -> 0 in steps, each at the lips and equal to drinkTea; ${r3(apart)} m apart; ${visits} tea visits in ${ticks} ticks`);
  await refused(ben, `object:${id('cup')}:drink`, 'tea.cup-empty');

  // ---- part-drunk context: a sip from a fresh third cup would do; instead read Ben's here at a part-drunk state ----
  const nearRow = (h, n) => h.objects.find((o) => o.id === id(n));
  // ---- both mugs on the table, empty ----
  await done(ben, 'put the cup on the table'); await done(ana, 'put the cup on the table');
  assert.equal(byName('cup').in.parent, id('table')); assert.equal(byName('cup-two').in.parent, id('table'));
  const emptyHere = await here(ben), emptyRow = nearRow(emptyHere, 'cup') ?? nearRow(emptyHere, 'cup-two');
  assert.deepEqual(emptyRow?.state, {empty: true}, 'an empty mug says so: ' + JSON.stringify(emptyHere.objects));
  report.contextBytes.emptyRow = JSON.stringify(emptyRow).length; report.contextBytes.emptyFact = JSON.stringify({state: emptyRow.state}).length - 2;
  report.checks.push('both mugs set on the table empty; nearby {"empty":true}');

  // ---- Ben washes his mug at the sink and sets it down clean on the table ----
  const benCup = id('cup'); let ran = false;
  const wash = await done(ben, 'wash the cup', (s) => { if (s.sink && body(ben).human?.cupV1?.stage === 'wash') ran = true; });
  assert.ok(ran, 'the tap ran while he held the mug under it'); assert.equal(state('sink').on, false, 'the tap is off again');
  assert.equal(id('cup'), benCup, 'his own mug, the same id');
  assert.deepEqual([state('cup').tea, state('cup').brewedTick, state('cup').bag], [0, -1, false], 'clean: no tea, no stain, no bag');
  assert.equal(byName('cup').in.parent, id('table'), 'back on the table'); assert.equal(ent('cup').support.kind, 'resting-on');
  assert.deepEqual([state('cup-two').tea, state('cup-two').brewedTick >= 0], [0, true], "Ana's mug is still empty on the table");
  const cleanHere = await here(ben), cleanRow = nearRow(cleanHere, 'cup');
  report.contextBytes.cleanRow = cleanRow ? JSON.stringify(cleanRow).length : null; report.contextBytes.cleanFact = cleanRow ? JSON.stringify({state: cleanRow.state}).length - 2 : null;
  if (cleanRow) assert.deepEqual(cleanRow.state, {clean: true});
  report.checks.push('wash: "wash the cup" took it from the table, tap on/off at the valve, rinsed, back on the table clean: ' + (wash.summary ?? wash.phase));
  await refused(ben, `object:${benCup}:wash`, 'tea.cup-clean');
  await refused(ana, `object:${benCup}:brew`, 'tea.no-bag');

  // ---- a sip, and the nearby tea fact at a part-drunk level: Ana makes tea in the clean... no: in a fresh mug ----
  const s3 = god.act({ops: [{op: 'place', def: 'core/cup@2', name: 'cup-three', in: {parent: 'counter', slot: 'top'}, p: [0.0, 0.19]}]}); assert.equal(s3.accepted, true); await tick(20);
  await offered(ana, [[`object:${id('cup-three')}:brew`, true], [`object:${id('cup-two')}:brew`, false]]);
  await done(ana, 'make a cup of tea'); assert.equal(state('cup-three').tea, 1);
  await done(ana, `pick-up:${id('cup-three')}`); assert.equal(ent('cup-three').support.by, ana.entityId);
  await done(ana, 'have a sip'); assert.equal(state('cup-three').tea, 0.8, 'one sip');
  await done(ana, 'have a sip'); await done(ana, 'have a sip'); assert.equal(state('cup-three').tea, 0.4);
  await done(ana, 'put the cup on the table');
  const partHere = await here(ana), partRow = nearRow(partHere, 'cup-three');
  // here picks at most two things of a kind and six in all (entry 43's limit): with three mugs on the table the third may be
  // in `more`; its fact is then read from the same service here reads
  assert.deepEqual(w.bridge.tea.facts(id('cup-three')), {tea: 0.4}, 'a part-drunk mug');
  if (partRow) assert.deepEqual(partRow.state, {tea: 0.4});
  report.contextBytes.teaRow = partRow ? JSON.stringify(partRow).length : null; report.contextBytes.teaFact = JSON.stringify({state: {tea: 0.4}}).length - 2;
  report.hereObjectsAtPart = partHere.objects.map((o) => [o.name, o.state ?? null]);
  report.checks.push('"have a sip" x3: tea 1 -> 0.8 -> 0.6 -> 0.4; set on the table, nearby {"tea":0.4}');
  // #628 T2: with something else in hand, a tea act plans the put-down first instead of refusing. Plan level: a native
  // fixture has no ground to put it on (item.no-room); `held.ts` puts down the same way on a real world.
  await done(ana, `pick-up:${id('cup-two')}`); assert.equal(ent('cup-two').support.by, ana.entityId);
  for (const [thing, action] of [['kettle', 'fill'], ['cup-three', 'drink']]) {
   const p = w.bridge.tea.plan(ana, id(thing), action);
   assert.ok(p?.steps, `${action}: ${JSON.stringify(p)}`);
   assert.deepEqual(p.steps[0], {verb: 'mars:put_item', params: {item: id('cup-two'), surfaceSlot: 'ground'}}, `${action} puts the mug down first`);
  }
  report.checks.push('hands full: filling the kettle and drinking another cup each plan the held mug down first');
  await done(ana, 'put the cup on the table');
  assert.deepEqual(f.host.engine.runtime.violations, []);
  report.final = {cup: {id: benCup, ...state('cup'), parent: byName('cup').in.parent}, cup2: {id: id('cup-two'), ...state('cup-two'), parent: byName('cup-two').in.parent}, tick: W().tick};
  report.retries = retries;
 } finally { w.close(); }

 // ---- second boot: the table keeps its mugs, one clean, one empty ----
 w = await boot(1);
 try {
  const {f, god, tick} = w; await tick(20);
  const byName = (n) => [...god.model.entities.values()].find((e) => e.name === n);
  for (const k of ['cup', 'cup2']) { const want = report.final[k], e = byName(k === 'cup' ? 'cup' : 'cup-two');
   assert.equal(e.id, want.id); assert.equal(e.in.parent, want.parent); assert.equal(e.state.tea, want.tea); assert.equal(e.state.brewedTick, want.brewedTick); assert.equal(e.state.bag, want.bag);
   assert.equal(f.host.engine.world.entities[e.id]?.support?.on, want.parent, 'the engine has it on the table'); }
  report.checks.push('second boot: the clean mug and the empty mug on the table, same ids and states');
  report.pass = true;
 } finally { w.close(); rmSync(dir, {recursive: true, force: true}); }
 if (out) { mkdirSync(out, {recursive: true}); writeFileSync(out + '/summary.json', JSON.stringify(report, null, 1)); }
 console.log(JSON.stringify({...report, timeline: report.timeline.length}));
});
