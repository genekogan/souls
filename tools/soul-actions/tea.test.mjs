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
import {kettleHeat, KETTLE_CLOCK} from '../../packages/world-compiler/src/core-kit/tea.ts';

// Entry 43: making tea. Fill the kettle at the camp sink, put it on (heat from the switch contact's tick, a pure function of
// world time), pour a cup, carry the cup of tea to the table; "make a cup of tea" from a cold kettle as one act; refusals;
// the long tail (100 distant kettles and cups add nothing); a second boot keeps the cup of tea.
const out = process.env.SOUL_ACTIONS_OUT;
const r3 = (x) => Math.round(x * 1000) / 1000;
test('making tea: a real cup of tea from a kettle filled, boiled and poured by hand', {timeout: 900000}, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'soul-actions-tea-'));
 const report = {pass: false, contextBytes: {}, checks: [], timeline: []};
 const boot = async (n) => {
  const f = fixture(join(dir, 'world.db'), factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono(); let soul;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  const logs = [];
  const bridge = installEngineBridge({host: f.host, god, edge, log(m) { if (/tea|refused/.test(m)) logs.push(m); }, worldLore: false, worldClock: false});
  const tick = async (k = 5) => { for (let i = 0; i < k; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  if (n === 0) { await invite(f, 'ana'); const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Tea test'})); soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; }
  await tick();
  const close = () => { comms.close(); f.host.stop(); f.db.close(); };
  return {f, edge, app, god, bridge, soul, tick, logs, close};
 };
 let w = await boot(0);
 try {
  const {f, edge, app, god, soul, tick} = w;
  const here = async () => { const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here; };
  // bytes with the clock's own digits fixed (`tick` grows from 2 to 5 digits over a test; it is not the feature's)
  const size = (h) => JSON.stringify({...h, tick: 0}).length, bytes = async () => size(await here());
  const body = () => f.host.engine.world.entities[soul.entityId], [ax, az] = [body().pose.p[0], body().pose.p[2]];
  const byName = (n) => [...god.model.entities.values()].find((e) => e.name === n), id = (n) => byName(n).id, state = (n) => byName(n).state ?? {}, ent = (n) => f.host.engine.world.entities[id(n)];

  // ---- context: absent, then 100 distant kettles (half heating) and 100 cups (half holding tea), 17-24 m away ----
  const absentHere = await here(), absent = size(absentHere);
  // 100 of each 120 m away (entry 34's distance: no offers either), and 20 of each 17-24 m away, inside the sight radius
  // (30 m) where any object is offered: `here` must still not grow
  const t0 = f.host.engine.world.tick, ox = ax > 0 ? ax - 24 : ax + 17, oz = az > 0 ? az - 24 : az + 17, far = [], mid = [];
  for (let i = 0; i < 20; i++) { const x = ox + (i % 5) * 1.5, z = oz + Math.floor(i / 5) * 1.5;
   mid.push({op: 'place', def: 'core/kettle@3', name: `mid-kettle-${i}`, p: [x, z], state: {level: 1, heatTick: i % 2 ? t0 : -1}}, {op: 'place', def: 'core/cup@3', name: `mid-cup-${i}`, p: [x + 0.3, z], state: {tea: i % 2 ? 1 : 0, brewedTick: i % 2 ? t0 : -1}}); }
  for (let i = 0; i < 100; i++) { const x = 120 + (i % 10) * 0.75, z = 120 + Math.floor(i / 10) * 0.75;
   far.push({op: 'place', def: 'core/kettle@3', name: `far-kettle-${i}`, p: [x, z], state: {level: 1, heatTick: i % 2 ? t0 : -1}}, {op: 'place', def: 'core/cup@3', name: `far-cup-${i}`, p: [x + 0.3, z], state: {tea: i % 2 ? 1 : 0, brewedTick: i % 2 ? t0 : -1}}); }
  for (let i = 0; i < far.length; i += 100) { const r = god.act({ops: far.slice(i, i + 100)}); assert.equal(r.accepted, true, JSON.stringify(r.failures?.slice(0, 3))); }
  await tick(60);
  const distant = await bytes(), farIds = new Set(far.map((d) => id(d.name)));
  assert.equal(f.host.engine.world.entities[id('far-kettle-7')]?.support?.kind, 'ground', 'the distant things are really there');
  assert.deepEqual(edge.capabilities(soul).filter((c) => c.object && farIds.has(c.object)).map((c) => c.id), [], 'no distant offers');
  for (let i = 0; i < mid.length; i += 100) { const r = god.act({ops: mid.slice(i, i + 100)}); assert.equal(r.accepted, true, JSON.stringify(r.failures?.slice(0, 3))); }
  await tick(60);
  const midHere = await here(), midBytes = size(midHere), midIds = new Set(mid.map((d) => id(d.name)));
  report.contextBytes.mid20at17to24m = midBytes;
  report.midOffers = edge.capabilities(soul).filter((c) => c.object && midIds.has(c.object)).length;
  assert.equal(midBytes, absent, 'kettles and cups 17-24 m away add 0 bytes to here: ' + Object.keys(midHere).filter((k) => JSON.stringify(midHere[k]) !== JSON.stringify(absentHere[k])).map((k) => k + ' ' + JSON.stringify(absentHere[k]) + ' -> ' + JSON.stringify(midHere[k])).join(' | '));
  const visitsBefore = w.bridge?.tea?.visits?.() ?? 0;
  await tick(40);
  Object.assign(report.contextBytes, {absent, distant100: distant});
  assert.equal(distant, absent, 'distant kettles and cups add 0 bytes');

  // ---- the kitchen beside Ana: a counter with a kettle (empty) and two cups, the camp sink, a table ----
  const cx = ax, cz = az - 1.4;
  const sc = god.act({ops: [
   {op: 'place', def: 'core/counter@1', name: 'counter', p: [cx, cz]},
   {op: 'place', def: 'core/kettle@3', name: 'kettle', in: {parent: 'counter', slot: 'top'}, p: [0.3, 0.1], r: Math.PI / 2},
   {op: 'place', def: 'core/cup@3', name: 'cup', in: {parent: 'counter', slot: 'top'}, p: [-0.12, 0.19]},
   {op: 'place', def: 'core/cup@3', name: 'cup-two', in: {parent: 'counter', slot: 'top'}, p: [-0.42, 0.19]},
   {op: 'place', def: 'core/camp-sink@1', name: 'sink', p: [cx + 2.2, cz + 0.1], r: Math.PI / 2},
   {op: 'place', def: 'core/table@1', name: 'table', p: [cx - 2.6, cz + 1.6]}]});
  assert.equal(sc.accepted, true, JSON.stringify(sc.failures?.slice(0, 3))); await tick(60);
  assert.equal(w.bridge?.tea?.visits?.() ?? 0, visitsBefore, 'no tea work per tick without a tea act');
  report.checks.push('no per-tick tea visits with 100 distant kettles heating');
  const objOf = (h, n) => h.objects.find((o) => o.id === id(n));
  const near0 = await here();
  report.contextBytes.nearbyColdEmpty = size(near0);
  const cap = (c) => edge.capabilities(soul).find((x) => x.id === c);
  const act = async (capability, accepted = true) => { const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability})})); const b = await r.json(); assert.equal(b.accepted, accepted, capability + ' ' + JSON.stringify(b).slice(0, 600)); return b; };
  let last = '';
  const watch = async (r, limit = 6000) => { for (let n = 0; n < limit; n++) { const b = body(), k = ent('kettle'), s = {tick: f.host.engine.world.tick, sink: !!state('sink').on, level: state('kettle').level, heatTick: state('kettle').heatTick, tea: state('cup').tea, tea2: state('cup-two').tea, kettle: k?.support?.kind, on: k?.support?.on, motion: b.human?.wateringV1?.stage ?? (b.human?.handActuator ? 'switch' : undefined), activity: b.human?.activity, phase: edge.receipt(soul.soulId, r.receipt.id)?.phase};
    const key = JSON.stringify({...s, tick: 0}); if (key !== last) report.timeline.push(s); last = key;
    if (['completed', 'failed', 'cancelled', 'replaced'].includes(s.phase)) return s; await tick(1); } return {phase: 'timeout'}; };
  const done = async (c) => { const r = await act(c), e = await watch(r); assert.equal(e.phase, 'completed', c + ' ' + JSON.stringify(edge.receipt(soul.soulId, r.receipt.id)).slice(0, 500) + '\n' + JSON.stringify(report.timeline.slice(-5)) + '\n' + w.logs.slice(-5).join('\n')); return edge.receipt(soul.soulId, r.receipt.id); };
  const refused = (c, code) => { const x = cap(c); assert.ok(x && !x.available, c + ' should be refused ' + JSON.stringify(x)); assert.equal(x.blocked?.code, code, JSON.stringify(x)); report.checks.push(`refused ${c.split(':').pop()}: ${code}`); };

  // ---- refusals before anything ----
  refused(`object:${id('kettle')}:boil`, 'tea.kettle-empty');
  refused(`object:${id('kettle')}:pour`, 'tea.kettle-empty');

  // ---- fill the kettle ----
  const fill = await done(`object:${id('kettle')}:fill`);
  assert.equal(state('kettle').level, 1, 'filled'); assert.equal(state('sink').on, false, 'the tap is off again');
  assert.ok(report.timeline.some((s) => s.sink && s.motion === 'fill'), 'the tap ran while she held the kettle under it');
  assert.equal(ent('kettle').support.kind, 'resting-on'); assert.equal(byName('kettle').in.parent, id('counter'), 'back on the counter');
  assert.equal(state('kettle').heatTick, -1, 'fresh water is cold');
  report.checks.push('fill: tap on/off at the valve contacts, kettle level 1, back on the counter: ' + (fill.summary ?? fill.phase));
  refused(`object:${id('kettle')}:pour`, 'tea.kettle-cold');
  assert.deepEqual(objOf(await here(), 'kettle')?.state, {kettle: 'cold'}, 'a nearby cold kettle');

  // ---- put the kettle on: heatTick is the switch contact's tick ----
  const before = report.timeline.length;
  await done(`object:${id('kettle')}:boil`);
  const ht = state('kettle').heatTick, contact = report.timeline.slice(before).find((s) => s.heatTick >= 0);
  assert.ok(ht > 0 && contact && contact.motion === 'switch', 'heat starts at the switch contact ' + JSON.stringify(contact));
  const dt = f.host.engine.dt ?? 0.05;
  assert.equal(kettleHeat(state('kettle'), f.host.engine.world.tick, dt).phase, 'heating');
  refused(`object:${id('kettle')}:boil`, 'tea.kettle-on');
  refused(`object:${id('kettle')}:pour`, 'tea.not-boiled');
  const heating = await here(); assert.deepEqual(objOf(heating, 'kettle')?.state, {kettle: 'heating'});
  // wait for the boil: nothing is committed while it heats (the heat is a function of the tick)
  const editsBefore = god.model.editSeq ?? null;
  while (kettleHeat(state('kettle'), f.host.engine.world.tick, dt).phase === 'heating') await tick(10);
  assert.equal(r3((f.host.engine.world.tick - ht) * dt) >= KETTLE_CLOCK.heat, true);
  assert.equal(state('kettle').heatTick, ht, 'no commit at the boil');
  void editsBefore;
  const boiling = await here(), kRow = objOf(boiling, 'kettle');
  assert.deepEqual(kRow?.state, {kettle: 'boiling'}, 'a nearby Soul sees "the kettle is boiling"');
  report.contextBytes.nearbyBoiling = size(boiling);
  report.contextBytes.kettleRow = JSON.stringify(kRow).length; report.contextBytes.kettleFact = JSON.stringify({state: kRow.state}).length - 2;

  // ---- pour the tea ----
  const pour = await done(`object:${id('kettle')}:pour`);
  assert.equal(state('cup').tea, 1, 'a full cup of tea'); assert.ok(state('cup').brewedTick > ht, 'brewed after the boil');
  assert.ok(report.timeline.some((s) => s.motion === 'pour' && s.tea > 0 && s.tea < 1), 'the tea rose in steps while the stream ran');
  assert.equal(r3(state('kettle').level), r3(1 - 0.25 / 1.2), 'one cup out of the kettle');
  assert.equal(byName('kettle').in.parent, id('counter'), 'kettle back on the counter');
  report.checks.push('pour: tea in thirds while the stream ran, kettle level ' + r3(state('kettle').level) + ': ' + (pour.summary ?? pour.phase));
  const cupId = id('cup');
  refused(`object:${cupId}:brew`, 'tea.cup-full');

  // ---- the cup of tea is carried to the table and set down (entry 29's path) ----
  await done(`pick-up:${cupId}`);
  assert.equal(ent('cup').support.kind, 'in-hand'); assert.equal(state('cup').tea, 1, 'tea in hand');
  await done(`put-on:${id('table')}`);
  assert.equal(byName('cup').in.parent, id('table'), 'on the table'); assert.equal(id('cup'), cupId, 'same identity'); assert.equal(state('cup').tea, 1);
  const nearCup = await here(); const cupRow = objOf(nearCup, 'cup');
  assert.deepEqual(cupRow?.state, {tea: 1}, 'a nearby Soul sees a cup of tea (entry 44: how much, to one decimal)');
  report.contextBytes.cupRow = JSON.stringify(cupRow).length; report.contextBytes.cupFact = JSON.stringify({state: cupRow.state}).length - 2;
  report.checks.push('cup of tea carried and set on the table, same id, tea 1');

  // ---- "make a cup of tea" from a kettle that has gone cold: put on, wait, pour, as one act ----
  while (kettleHeat(state('kettle'), f.host.engine.world.tick, dt).phase !== 'cold') await tick(200);
  const lv = state('kettle').level;
  const brew = await done(`object:${id('cup-two')}:brew`);
  assert.equal(state('cup-two').tea, 1, 'the second cup');
  assert.ok(state('kettle').heatTick > ht, 'boiled again');
  assert.equal(r3(state('kettle').level), r3(lv - 0.25 / 1.2));
  report.checks.push('make a cup of tea from a cold kettle as one act: ' + (brew.summary ?? brew.phase));
  assert.deepEqual(f.host.engine.runtime.violations, []);
  report.final = {cup: {id: cupId, tea: state('cup').tea, parent: byName('cup').in.parent}, kettle: {...state('kettle')}, tick: f.host.engine.world.tick};
 } finally { w.close(); }

 // ---- second boot: the cup of tea is still on the table ----
 w = await boot(1);
 try {
  const {f, god, tick} = w; await tick(20);
  const byName = (n) => [...god.model.entities.values()].find((e) => e.name === n);
  const cup = byName('cup');
  assert.equal(cup.id, report.final.cup.id); assert.equal(cup.state.tea, 1); assert.equal(cup.in.parent, report.final.cup.parent);
  assert.equal(f.host.engine.world.entities[cup.id]?.support?.on, report.final.cup.parent, 'the engine has it on the table');
  assert.equal(byName('kettle').state.level, report.final.kettle.level);
  assert.ok(f.host.engine.world.tick >= report.final.tick, 'world time continues');
  report.checks.push('second boot: cup of tea on the table (same id), kettle level kept');
  report.pass = true;
 } finally { w.close(); rmSync(dir, {recursive: true, force: true}); }
 if (out) { mkdirSync(out, {recursive: true}); writeFileSync(out + '/summary.json', JSON.stringify(report, null, 1)); }
 console.log(JSON.stringify({...report, timeline: report.timeline.length}));
});
