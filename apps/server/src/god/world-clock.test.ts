// F3 (rehearsal item 17): a god's world keeps time. The clock starts with the world (a logged dayConfig, as the live
// worlds' LivingWorld does), advances with ticks (Eyes' env.datetime and observe's world.time), follows the god's
// time.dayTicks, and a change of dayTicks keeps the time of day continuous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { clockConfig } from './world-clock.ts';
import { biologyAt, biologyOf, biologyHourAt } from '@sim/world-compiler';
import { Db } from '../db.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('clockConfig keeps the phase when dayTicks changes', () => {
  const c = clockConfig(100_000, 24_000, { origin: 28_000, dayTicks: 72_000 }).dayConfig; // 1 day of 72000 elapsed
  assert.equal((100_000 - c.origin) / c.dayTicks, 1);
  assert.deepEqual(clockConfig(500, 72_000).dayConfig, { origin: 500, dayTicks: 72_000, customs: [] });
});

test('God same-day backward time edits reevaluate an existing biology anchor', { timeout: 60000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {}, worldClock: true });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  const act = (ops: any[]) => assert.equal((god.act({ ops }) as any).accepted, true);
  await settle();
  // Establish the native qualification fixture at 36 elapsed world hours (18:00 on day 1).
  await accept(f.host, f.host.enqueue('rules', 'fixture', { dayConfig: { origin: f.host.engine.world.tick - 108000, dayTicks: 72000, customs: [] } }));
  await settle();
  act([{ op: 'place', def: 'core/garden-planter@3', name: 'clock-bed', p: [20, 20], state: {
    biologyEnabled: true, biologyHour: 24, biologyWilt: 1 / 3, biologyTarget: 1, biologyMoisture: 2 / 3, biologyGrowth: 2,
  } }]);
  await settle();
  const bed = () => god.model.get('clock-bed')!;
  const native = f.host.engine as typeof f.host.engine & { plantClockV1(): { origin: number; dayTicks: number; pausedAtTick?: number } };
  const look = () => biologyAt(biologyOf(bed().state, god.model.resolvedDef(bed().def)!)!, biologyHourAt(f.host.engine.world.tick, native.plantClockV1()));
  assert.ok(Math.abs(look().w - .5) < .001);
  const anchor = bed().state!.biologyHour;
  act([{ op: 'world', state: { time: { dayTicks: 72000, set: { hour: 12, n: 1 } } } }]);
  await settle();
  assert.ok(Math.abs(look().w - 5 / 12) < .001, 'actual God set back to noon reevaluates at 30h; attained wilt is not frozen');
  assert.equal(bed().state!.biologyHour, anchor, 'setting the clock does not silently materialize a new anchor');
  act([{ op: 'world', state: { time: { dayTicks: 72000, paused: true, set: { hour: 12, n: 1 } } } }]);
  await settle();
  const paused = look();
  await settle(100);
  assert.deepEqual(look(), paused, 'actual God pause freezes biology at the captured pause tick');
});

test('restored God policy preview, freeze and resume persist one ordered atomic diff', (t) => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const emitted: any[] = [], options = { worldId: 'biology-policy', ownerId: 'dev:admin', tick: () => 100, emit: (e: any) => emitted.push(e) };
  const first = new GodMode(db, options);
  assert.equal(first.act({ ops: [{ op: 'place', def: 'core/garden-planter@3', name: 'bed', p: [20, 20], state: {
    biologyEnabled: true, biologyHour: 24, biologyWilt: 1 / 3, biologyTarget: 1, biologyMoisture: 2 / 3, biologyGrowth: 2, pouring: true,
  } }] }).accepted, true);
  // Recreate the actual SQL-backed owner service before its first policy edit. No policy-map bootstrap is needed.
  const restored = new GodMode(db, options); restored.biologyHour = () => 36;
  const id = restored.model.get('bed')!.id, seq = restored.model.editSeq;
  const ops = [{ op: 'set', id, state: { biologyEnabled: false } }];
  assert.equal(restored.dryrun({ ops }).accepted, true);
  const preview = restored.preview({ ops }); assert.equal(preview.accepted, true);
  assert.equal(restored.model.get(id)!.state!.pouring, true, 'planning never mutates the live model');
  const pictured = restored.getPreview(preview.id!)!.diff.upserts.find(e => e.id === id)!.state!;
  assert.equal(pictured.biologyWilt, .5); assert.equal(pictured.pouring, false);
  const beforeEvents = emitted.length;
  assert.equal(restored.act({ preview: preview.id }).accepted, true);
  assert.equal(restored.model.editSeq, seq + 1);
  assert.deepEqual(emitted.slice(beforeEvents).filter(e => e.kind === 'world-diff').map(e => e.seq), [seq + 1]);
  assert.deepEqual(restored.model.get(id)!.state, pictured, 'preview and committed freeze agree at the same hour');
  const resumed = new GodMode(db, options); resumed.biologyHour = () => 72;
  assert.equal(resumed.model.get(id)!.state!.pouring, false, 'freeze and cleanup survive SQL restore');
  assert.equal(resumed.act({ ops: [{ op: 'set', id, state: { biologyEnabled: true } }] }).accepted, true);
  assert.equal(resumed.model.get(id)!.state!.biologyHour, 72);
  assert.equal(resumed.model.get(id)!.state!.biologyWilt, .5, 'resume does not catch up for disabled hours');
  resumed.biologyHour = () => 96;
  assert.equal(resumed.undo().accepted, true);
  assert.equal(resumed.model.get(id)!.state!.biologyEnabled, false);
  assert.ok(Math.abs(Number(resumed.model.get(id)!.state!.biologyWilt) - 5 / 6) < 1e-9, 'undoing enable freezes the currently attained curve');
  resumed.biologyHour = () => 120;
  const planned = resumed.preflightUndo([resumed.store.redoable()!]);
  assert.equal(planned.ok, true);
  if (planned.ok) {
    assert.equal(planned.model.get(id)!.state!.biologyHour, 120);
    assert.ok(Math.abs(Number(planned.model.get(id)!.state!.biologyWilt) - 5 / 6) < 1e-9, 'group inverse preflight resumes frozen progress');
  }
  assert.equal(resumed.redo().accepted, true);
  assert.equal(resumed.model.get(id)!.state!.biologyHour, 120);
  assert.ok(Math.abs(Number(resumed.model.get(id)!.state!.biologyWilt) - 5 / 6) < 1e-9, 'redo resumes without disabled-time catch-up');
});

test('a god world\'s clock runs, and follows the god\'s time.dayTicks', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {}, worldClock: true });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(3);
  assert.equal(f.host.living?.dayTicks, 72000, 'the clock started with the world');
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'a guest' }));
  const ana = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle(3);
  const env = () => (f.host.engine.world as any).env.datetime as string;
  const clock = () => (edge.observe(ana, new Set()) as any).world.time?.clock as string;
  const d0 = env(), c0 = clock();
  assert.ok(c0, 'observe shows the time');
  for (let i = 0; i < 1500; i++) f.host.tickOnce(); // 75 s real = 30 world minutes at one day per hour
  await settle(1);
  assert.notEqual(env(), d0, 'env.datetime advanced');
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  assert.ok(Math.abs(mins(clock()) - mins(c0) - 30) <= 1, `about 30 world minutes passed: ${c0} → ${clock()}`);

  // the god speeds the day up threefold: same time of day, then three times as fast
  const before = clock();
  assert.equal((god.act({ ops: [{ op: 'world', state: { time: { dayTicks: 24000 } } }] }, 'faster days') as any).accepted, true);
  await settle(3);
  assert.equal(f.host.living?.dayTicks, 24000);
  assert.ok(Math.abs(mins(clock()) - mins(before)) <= 1, `continuous: ${before} → ${clock()}`);
  const c1 = clock();
  for (let i = 0; i < 500; i++) f.host.tickOnce();
  await settle(1);
  assert.ok(Math.abs(mins(clock()) - mins(c1) - 30) <= 1, `30 world minutes in 500 ticks: ${c1} → ${clock()}`);
});
