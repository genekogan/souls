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

// #437 W078: coffee on the tea faculty, made and served to another Soul. A coffee mug (core-coffee-mug@1) is the tea mug's
// faculty with data only: the same kettle, pour, hand-over, sips and rinse, its words and facts saying coffee. Ana makes a
// cup of coffee (the nearer tea mug is left alone) and a cup of tea (the coffee mug is left alone), offers Ben the coffee, he
// accepts and drinks it at the table, then rinses the mug. Refusals; an interrupted pour; the long tail (100 distant coffee
// mugs in every state add nothing); a second boot keeps the mug as it was. Plain words throughout, offer ids for refusals.
const out = process.env.SOUL_ACTIONS_OUT;
const r3 = (x) => Math.round(x * 1000) / 1000;
test('coffee: made on the tea faculty, served by hand, drunk to empty, rinsed clean', {timeout: 900000}, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'soul-actions-coffee-'));
 const report = {pass: false, contextBytes: {}, checks: [], words: {}, summaries: {}, drinks: {}, timeline: []};
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
  if (n === 0) for (const [k, name] of [['ana', 'Ana'], ['ben', 'Ben']]) { await invite(f, k); const row = await accept(f.host, f.souls.create('dev:' + k, {name, description: 'Coffee test'})); souls[k] = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await tick(); }
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

  // ---- context: absent; 100 coffee mugs in every state (coffee, part drunk, empty, clean) 120 m away; 20 at 17-24 m ----
  const absentHere = await here(ana), absent = size(absentHere);
  const t0 = W().tick, ox = ax > 0 ? ax - 24 : ax + 17, oz = az > 0 ? az - 24 : az + 17, far = [], mid = [];
  const mugState = (i) => [{tea: 1, brewedTick: t0}, {tea: 0.4, brewedTick: t0}, {tea: 0, brewedTick: t0}, {tea: 0, brewedTick: -1, bag: false}][i % 4];
  for (let i = 0; i < 20; i++) mid.push({op: 'place', def: 'core/coffee-mug@1', name: `mid-mug-${i}`, p: [ox + (i % 5) * 1.5, oz + Math.floor(i / 5) * 1.5], state: mugState(i)});
  for (let i = 0; i < 100; i++) far.push({op: 'place', def: 'core/coffee-mug@1', name: `far-mug-${i}`, p: [120 + (i % 10) * 0.75, 120 + Math.floor(i / 10) * 0.75], state: mugState(i)});
  const rf = god.act({ops: far}); assert.equal(rf.accepted, true, JSON.stringify(rf.failures?.slice(0, 3)));
  await tick(60);
  const distant = await bytes(ana), farIds = new Set(far.map((d) => id(d.name)));
  assert.equal(W().entities[id('far-mug-6')]?.support?.kind, 'ground', 'the distant mugs are really there');
  as(ana); assert.deepEqual(edge.capabilities(ana).filter((c) => c.object && farIds.has(c.object)).map((c) => c.id), [], 'no distant offers');
  assert.equal(distant, absent, '100 distant coffee mugs (coffee, part drunk, empty, clean) add 0 bytes');
  const rm = god.act({ops: mid}); assert.equal(rm.accepted, true); await tick(60);
  const midHere = await here(ana), midBytes = size(midHere);
  assert.equal(midBytes, absent, 'coffee mugs 17-24 m away add 0 bytes: ' + Object.keys(midHere).filter((k) => JSON.stringify(midHere[k]) !== JSON.stringify(absentHere[k])).join(','));
  const visits0 = w.bridge.tea.visits(); await tick(40);
  assert.equal(w.bridge.tea.visits(), visits0, 'no tea-faculty work per tick without an act');
  assert.equal(recoveries(), 0, 'the distant scene raised no engine fault');
  Object.assign(report.contextBytes, {absent, distant100: distant, mid20at17to24m: midBytes});
  report.checks.push('long tail: 100 distant coffee mugs in four states: +0 bytes, no offers; 20 at 17-24 m: +0; no per-tick visits');

  // ---- the kitchen: a counter with a hot full kettle, a tea mug nearest the kettle, two coffee mugs; the sink; a table ----
  const cx = ax, cz = az - 1.4, hot = W().tick;
  const sc = god.act({ops: [
   {op: 'place', def: 'core/counter@1', name: 'counter', p: [cx, cz]},
   {op: 'place', def: 'core/kettle@2', name: 'kettle', in: {parent: 'counter', slot: 'top'}, p: [0.3, 0.1], r: Math.PI / 2, state: {level: 1, heatTick: hot}},
   {op: 'place', def: 'core/cup@2', name: 'cup', in: {parent: 'counter', slot: 'top'}, p: [-0.12, 0.19]},
   {op: 'place', def: 'core/coffee-mug@1', name: 'mug', in: {parent: 'counter', slot: 'top'}, p: [-0.42, 0.19]},
   {op: 'place', def: 'core/coffee-mug@1', name: 'mug-two', in: {parent: 'counter', slot: 'top'}, p: [-0.72, 0.19]},
   {op: 'place', def: 'core/camp-sink@1', name: 'sink', p: [cx + 2.2, cz + 0.1], r: Math.PI / 2},
   {op: 'place', def: 'core/table@1', name: 'table', p: [cx - 2.4, cz + 1.8]}]});
  assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(60);
  const cap = (s, c) => { as(s); return edge.capabilities(s).find((x) => x.id === c); };
  const refused = (s, c, code, words) => { const x = cap(s, c); assert.ok(x && !x.available, c + ' should be refused ' + JSON.stringify(x)); assert.equal(x.blocked?.code, code, JSON.stringify(x)); if (words) assert.match(x.blocked.reason, words, JSON.stringify(x.blocked)); report.checks.push(`refused ${c.split(':').pop()} (${s.name}): ${code}: ${x.blocked.reason}`); };
  let retries = 0;
  const act = async (s, capability, want = true) => { let b; for (let k = 0; k < 20; k++) { as(s); const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability})})); b = await r.json(); if (b.code !== 'object.admission-failed') break; retries++; await tick(10); } assert.equal(b.accepted, want, capability + ' ' + JSON.stringify(b).slice(0, 700)); if (want) report.words[`${s.name}: ${capability}${report.words[`${s.name}: ${capability}`] ? ' (again)' : ''}`] = b.receipt?.capability ?? b.capability ?? b.resolved ?? b.receipt?.label ?? null; return b; };
  const phase = (s, r) => edge.receipt(s.soulId, r.receipt.id)?.phase;
  let lastKey = '';
  const sample = () => { const s = {tick: W().tick, mug: {tea: state('mug').tea, by: ent('mug')?.support?.by ?? null}, mug2: state('mug-two').tea, cup: state('cup').tea, sink: !!state('sink').on, ana: body(ana).human?.cupV1?.stage ?? body(ana).human?.wateringV1?.stage ?? body(ana).human?.activity, ben: body(ben).human?.cupV1?.stage ?? body(ben).human?.activity};
   const key = JSON.stringify({...s, tick: 0}); if (key !== lastKey) report.timeline.push(s); lastKey = key; return s; };
  const until = async (pairs, limit = 9000, each) => { for (let n = 0; n < limit; n++) { const s = sample(); each?.(s); const ph = pairs.map(([q, r]) => phase(q, r)); if (ph.every((p) => ['completed', 'failed', 'cancelled', 'replaced'].includes(p))) { pairs.forEach(([q, r], i) => assert.equal(ph[i], 'completed', `${q.name} ${r.receipt.id} ${ph[i]} ${JSON.stringify(edge.receipt(q.soulId, r.receipt.id)).slice(0, 600)}\n${w.logs.slice(-5).join('\n')}`)); return; } await tick(1); } assert.fail('timeout ' + JSON.stringify(pairs.map(([q, r]) => phase(q, r)))); };
  const done = async (s, words, each) => { const r = await act(s, words); await until([[s, r]], 9000, each); return edge.receipt(s.soulId, r.receipt.id); };
  const said = async (s, words, each) => { const b = await act(s, words); await until([[s, b]], 9000, each); const said = JSON.stringify(b).match(/"(?:summary|note|result)":"([^"]*)"/g); report.summaries[`${s.name}: ${words}`] = said; return {...edge.receipt(s.soulId, b.receipt.id), said: JSON.stringify(said)}; };
  const label = (s, n, a) => cap(s, `object:${id(n)}:${a}`)?.label;

  // ---- offers say what each mug makes ----
  assert.match(label(ana, 'mug', 'brew'), /^Make a cup of coffee \(/); assert.match(label(ana, 'cup', 'brew'), /^Make a cup of tea \(/);
  refused(ana, `object:${id('mug')}:drink`, 'tea.not-holding', /drink the coffee/);
  refused(ana, `object:${id('mug')}:wash`, 'tea.cup-clean');
  report.checks.push('labels: coffee mug "Make a cup of coffee", tea mug "Make a cup of tea"');

  // ---- "make a cup of coffee" brews a coffee mug, though the tea mug is nearer the kettle ----
  const cf = await said(ana, 'make a cup of coffee');
  assert.equal(state('mug').tea, 1, 'a cup of coffee'); assert.equal(state('cup').tea, 0, 'the tea mug is untouched'); assert.equal(state('mug-two').tea, 0);
  assert.match(cf.said, /Made a cup of coffee in counter\/mug/, cf.said);
  const brewed = state('mug').brewedTick; assert.ok(brewed > 0);
  assert.deepEqual(w.bridge.tea.facts(id('mug')), {coffee: 1}, 'a full coffee mug');
  const fullHere = await here(ana), fullRow = fullHere.objects.find((o) => o.id === id('mug'));
  assert.deepEqual(fullRow?.state, {coffee: 1}, 'the nearby row says coffee: ' + JSON.stringify(fullHere.objects));
  report.contextBytes.nearbyFull = size(fullHere); report.contextBytes.coffeeRow = JSON.stringify(fullRow).length; report.contextBytes.coffeeFact = JSON.stringify({state: fullRow.state}).length - 2;
  refused(ana, `object:${id('mug')}:brew`, 'tea.cup-full', /already has coffee in it/);

  // ---- "make a cup of tea" brews the tea mug, not the fresh coffee mug ----
  await said(ana, 'make a cup of tea');
  assert.equal(state('cup').tea, 1, 'a cup of tea'); assert.equal(state('mug-two').tea, 0, 'the fresh coffee mug is untouched');
  assert.deepEqual(w.bridge.tea.facts(id('cup')), {tea: 1}, 'the tea mug still says tea');
  report.checks.push('words pick the mug: "make a cup of coffee" -> mug (tea mug nearer the kettle untouched); "make a cup of tea" -> cup (coffee mug untouched)');

  // ---- Ana picks up the coffee, offers it to Ben; he accepts: one holder in every tick, the coffee unchanged ----
  await done(ana, `pick-up:${id('mug')}`); assert.equal(ent('mug').support.by, ana.entityId, 'Ana holds the coffee');
  const holders = new Set();
  const g = await act(ana, 'offer Ben the coffee'); await tick(5);
  const benOffer = await here(ben); assert.match(benOffer.me?.offer ?? '', /^Ana holds out the .+ for you: accept or decline \(\d+ s\)$/, JSON.stringify(benOffer.me));
  const a = await act(ben, 'accept');
  await until([[ana, g], [ben, a]], 9000, () => { const s = ent('mug').support; assert.equal(s.kind, 'in-hand', 'never out of hand'); holders.add(s.by); });
  assert.deepEqual([...holders], [ana.entityId, ben.entityId], 'one holder at a time: Ana, then Ben');
  assert.equal(state('mug').tea, 1); assert.equal(state('mug').brewedTick, brewed, 'same coffee through the hand-over');
  report.checks.push('hand-over: "offer Ben the coffee" + "accept": holders Ana then Ben, never none; coffee 1 and brewedTick unchanged');

  // ---- Ben drinks the coffee at the table, in sips at the lips ----
  const seen = [], dk = await act(ben, 'drink the coffee'); let motion = null;
  await until([[ben, dk]], 9000, (s) => { const m = body(ben).human?.cupV1; if (m) motion = m; const tea = state('mug').tea; if (!seen.length || seen.at(-1).tea !== tea) seen.push({tea, tick: s.tick, atLips: m ? cupFrame(m, (s.tick - m.startTick) * (f.host.engine.dt ?? 0.05)).atLips : null, pure: m ? drinkTea(m, (s.tick - m.startTick) * (f.host.engine.dt ?? 0.05)) : null}); });
  report.summaries['Ben: drink the coffee'] = JSON.stringify(dk).match(/"(?:summary|note)":"([^"]*)"/g); assert.match(report.summaries['Ben: drink the coffee'].join(' '), /Drank the coffee in ben\/mug/);
  const drops = seen.slice(1);
  assert.equal(seen[0].tea, 1); assert.equal(seen.at(-1).tea, 0, 'Ben drank it all'); assert.equal(drops.length, 5, 'five sips ' + JSON.stringify(seen));
  for (const d of drops) { assert.equal(d.atLips, true, 'each sip at the lips ' + JSON.stringify(d)); assert.equal(d.tea, d.pure, 'the written level is the pure function of drink time'); }
  report.drinks.ben = {sips: motion.sips, moments: cupEvents(motion).map((e) => r3(e.at)), steps: seen};
  refused(ben, `object:${id('mug')}:drink`, 'tea.cup-empty');
  report.checks.push('Ben drank the coffee: 5 sips, 1 -> 0, each at the lips and equal to drinkTea');

  // ---- empty on the table, rinsed clean at the sink ----
  await done(ben, 'put the mug on the table'); assert.equal(byName('mug').in.parent, id('table'));
  assert.deepEqual(w.bridge.tea.facts(id('mug')), {empty: true});
  await said(ben, 'wash the mug');
  assert.deepEqual([state('mug').tea, state('mug').brewedTick, state('mug').bag], [0, -1, false], 'clean: no coffee, no stain, no grounds');
  assert.deepEqual(w.bridge.tea.facts(id('mug')), {clean: true});
  refused(ben, `object:${id('mug')}:wash`, 'tea.cup-clean');
  refused(ana, `object:${id('mug')}:brew`, 'tea.no-bag', /has no coffee in it/);
  // a fresh coffee mug on the table, more than 2.5 m from the kettle
  const fm = god.act({ops: [{op: 'place', def: 'core/coffee-mug@1', name: 'mug-far', in: {parent: 'table', slot: 'top'}, p: [0.2, 0]}]}); assert.equal(fm.accepted, true); await tick(20);
  refused(ana, `object:${id('mug-far')}:brew`, 'tea.no-kettle', /no kettle within/);
  report.checks.push('rinsed: "wash the mug" -> tea 0, brewedTick -1, bag false; facts empty then clean');

  // ---- an interrupted pour leaves only what was poured ----
  const ip = await act(ana, 'make a cup of coffee'); let partial = null;
  for (let n = 0; n < 9000 && partial === null; n++) { sample(); const t = state('mug-two').tea; if (t > 0 && t < 0.9) partial = t; else await tick(1); }
  assert.ok(partial !== null, 'the pour reached mug-two');
  const stop = await act(ana, 'walk to the table');
  await until([[ana, stop]]); await tick(40);
  const left = state('mug-two').tea; report.interrupted = {first: partial, left, phase: phase(ana, ip)};
  assert.notEqual(phase(ana, ip), 'completed', 'the coffee act was interrupted');
  assert.ok(left > 0 && left < 1, 'only part of a cup: ' + left); assert.ok(state('mug-two').brewedTick >= 0);
  refused(ana, `object:${id('mug-two')}:brew`, 'tea.cup-full', /already has coffee in it/);
  report.checks.push(`interrupted pour: ${left} of a cup in mug-two, act ${phase(ana, ip)}`);

  assert.deepEqual(f.host.engine.runtime.violations, []);
  assert.equal(recoveries(), 0);
  report.final = {mug: {id: id('mug'), ...state('mug'), parent: byName('mug').in.parent}, mug2: {id: id('mug-two'), ...state('mug-two')}};
  report.retries = retries;
 } finally { w.close(); }

 // ---- second boot: the clean mug on the table, the part-filled mug on the counter ----
 w = await boot(1);
 try {
  const {god, tick} = w; await tick(20);
  const byName = (n) => [...god.model.entities.values()].find((e) => e.name === n);
  const m1 = byName('mug'), m2 = byName('mug-two');
  assert.equal(m1.id, report.final.mug.id); assert.equal(m1.in.parent, report.final.mug.parent);
  assert.deepEqual([m1.state.tea, m1.state.brewedTick, m1.state.bag], [report.final.mug.tea, report.final.mug.brewedTick, report.final.mug.bag]);
  assert.equal(m2.state.tea, report.final.mug2.tea);
  report.checks.push('second boot: same ids and states');
  report.pass = true;
 } finally { w.close(); rmSync(dir, {recursive: true, force: true}); }
 if (out) { mkdirSync(out, {recursive: true}); writeFileSync(out + '/summary.json', JSON.stringify(report, null, 1)); }
 console.log(JSON.stringify({...report, timeline: report.timeline.length}));
});
