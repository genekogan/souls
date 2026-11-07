import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CORE_KIT, WorldModel, applyBatch, coreRef, hashOf } from '@souls/world-compiler';
import { GodLayers, type LayersHost } from './layers.ts';
import { Objects } from '../edge/comms/objects/framework.ts';
import { calendarKind } from '../edge/comms/objects/calendar.ts';
import { ensureCommsSchema } from '../edge/comms/store.ts';
import type { CommsCore } from '../edge/comms/core.ts';

function fixture() {
  const db = new DatabaseSync(':memory:'); ensureCommsSchema(db);
  let model = new WorldModel({ constants: { extent: 400, ground: 'land' }, seed: 'calendar-removal' });
  for (const def of CORE_KIT) model.defineDef(def, 'core', 0);
  const engine = { world: { tick: 0, entities: {} } };
  let objects: Objects, layers: GodLayers, learnMs: number | undefined;
  const clock = { origin: 0, dayTicks: 72000 };
  const reload = () => {
    model = WorldModel.fromSnapshot(model.snapshot());
    objects = new Objects({ db, worldId: 'calendar-fixture', now: () => 1000, tick: () => engine.world.tick, nameOf: (id: string) => id } as CommsCore);
    objects.register(calendarKind);
    layers = new GodLayers({ model, engine, living: () => clock, calendarLearnMs: learnMs,
      edge: { comms: { objects } } as unknown as LayersHost['edge'], engineAct: () => { throw new Error('no clock-driven state edits expected'); }, log: (message) => { throw new Error(message); } });
  };
  const god = (ops: unknown[]) => { const r = applyBatch(model, { ops }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  const calendar = () => objects.all().filter((o) => o.kind === 'calendar-item');
  reload();
  return { db, god, reload, calendar, clock, engine, get model() { return model; }, set learnMs(v: number | undefined) { learnMs = v; }, get objects() { return objects; }, get layers() { return layers; } };
}
const event = { name: 'tea', label: 'Tea with neighbours', at: '07:00', minutes: 60 };

test('calendar: removing the only event removes its generated entries across reload, idempotently; native entries survive', () => {
  const f = fixture();
  try {
    for (const [id, proposedBy] of [['cal-native', 'Ana'], ['cal-g0123456789ab', 'steward'], ['cal-steward', 'the god of this world']]) {
      f.objects.create({ id, kind: 'calendar-item', name: 'Native gathering', placeId: 'world', params: { title: 'Native gathering', proposedBy, startsAtTick: 3000, durationTicks: 500 } });
    }
    const native = f.calendar();
    f.god([{ op: 'place', def: coreRef('bench'), name: 'tea-bench', p: [0, 0], schedule: { events: [event] } }]);
    assert.equal(f.layers.step().posted, 1);
    const added = f.calendar().find((o) => !native.some((n) => n.id === o.id)); assert.ok(added);
    f.reload(); assert.equal(f.layers.step().posted, 0, 'reload keeps the existing occurrence');
    f.god([{ op: 'set', id: 'tea-bench', schedule: null }]);
    f.reload();
    assert.equal(f.layers.active(), true, 'the last removed schedule still needs cleanup after restart');
    assert.deepEqual(f.layers.step(), { changed: 0, posted: 0 });
    assert.deepEqual(f.calendar(), native, 'stale derived entries disappear; native objects and their state remain identical');
    assert.deepEqual(f.layers.step(), { changed: 0, posted: 0 }, 'repeat cleanup is a no-op');
    f.reload(); assert.deepEqual(f.calendar(), native, 'cleanup persists');
    assert.equal(f.layers.active(), false, 'no layer work remains');
  } finally { f.db.close(); }
});

test('calendar: removing one event or its entity preserves an unrelated scheduled event and its state', () => {
  const f = fixture();
  try {
    f.god([{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0], schedule: { events: [event, { ...event, name: 'music', label: 'Music', at: '08:00' }] } }]);
    assert.equal(f.layers.step().posted, 2);
    const music = f.calendar().find((o) => o.name === 'Music'); assert.ok(music);
    f.god([{ op: 'set', id: 'bench', schedule: { events: [{ ...event, name: 'music', label: 'Music', at: '08:00' }] } }]);
    f.reload(); f.layers.step();
    assert.deepEqual(f.calendar(), [music]);
    f.god([{ op: 'remove', id: 'bench' }]);
    f.reload(); assert.equal(f.layers.active(), true); f.layers.step();
    assert.deepEqual(f.calendar(), []);
  } finally { f.db.close(); }
});


test('calendar: re-adding a removed event recreates the occurrence without discarding its audit log', () => {
  const f = fixture();
  try {
    f.god([{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0], schedule: { events: [event] } }]);
    f.layers.step(); const before = f.calendar()[0];
    f.god([{ op: 'set', id: 'bench', schedule: null }]); f.layers.step();
    assert.deepEqual(f.calendar(), []);
    f.god([{ op: 'set', id: 'bench', schedule: { events: [event] } }]);
    assert.equal(f.layers.step().posted, 1);
    const after = f.calendar()[0]; assert.equal(after.id, before.id); assert.equal(after.version, before.version + 1);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM edge_comms_object_log WHERE object_id=? AND action='create'").get(before.id)?.n, 2);
  } finally { f.db.close(); }
});

test('calendar: a clock-speed change preserves surviving occurrences and their state after reload', () => {
  const f = fixture();
  try {
    f.engine.world.tick = 72000; // next day, 06:00
    f.god([{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0], schedule: { events: [event] } }]);
    f.layers.step(); const before = f.calendar()[0];
    f.clock.dayTicks = 1000; f.clock.origin = 71000; // same current date/time; prior future ticks now map differently
    f.reload(); f.layers.step();
    assert.deepEqual(f.calendar().find(o => o.id === before.id), before);
  } finally { f.db.close(); }
});


test('calendar: entries created before provenance metadata still survive reload and are removed with their event', () => {
  const f = fixture();
  try {
    f.god([{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0], schedule: { events: [event] } }]);
    f.layers.step(); const before = f.calendar()[0];
    const params = f.objects.creationParams(before.id)!; delete params.godSchedule;
    f.db.prepare("UPDATE edge_comms_object_log SET params=? WHERE object_id=? AND action='create'").run(JSON.stringify(params), before.id);
    f.reload(); f.layers.step(); assert.deepEqual(f.calendar(), [before]);
    f.god([{ op: 'set', id: 'bench', schedule: null }]); f.reload(); f.layers.step();
    assert.deepEqual(f.calendar(), []);
  } finally { f.db.close(); }
});

test('calendar (L4 item 0): steady steps read no bodies or creation logs; a restart backlog is classified over several steps, pruning only once all are known', () => {
  const f = fixture();
  try {
    // 600 past occurrences of a live event and 600 of a removed one, written as postCalendar writes them
    f.god([{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0], schedule: { events: [event] } }]);
    f.layers.step();
    const live = f.model.get('bench')!.id;
    for (let i = 0; i < 1200; i++) {
      const entity = i < 600 ? live : 'gone-thing', date = new Date(Date.UTC(2020, 0, 1) + i * 86400_000).toISOString().slice(0, 10);
      const id = `cal-g${hashOf([entity, 'tea', date]).slice(0, 12)}`;
      f.objects.create({ id, kind: 'calendar-item', name: 'Tea', placeId: 'world', params: { godSchedule: { entity, event: 'tea', date }, title: 'Tea', proposedBy: 'the god of this world', startsAtTick: 3000, durationTicks: 500 } });
    }
    f.learnMs = 0; f.reload();
    const o = f.objects as unknown as Record<string, (...a: unknown[]) => unknown>, calls = { creationParams: 0, ofKind: 0 };
    for (const k of ['creationParams', 'ofKind'] as const) { const fn = o[k].bind(f.objects); o[k] = (...a: unknown[]) => { calls[k]++; return fn(...a); }; }
    let steps = 0;
    while (f.calendar().length > 601 && steps < 200) { f.layers.step(); steps++; if (steps === 1) assert.equal(f.calendar().length, 1201, 'nothing pruned before every id is classified'); }
    assert.ok(steps > 1, `the backlog took ${steps} steps (budgeted)`);
    assert.equal(f.calendar().length, 601, 'the removed event\'s occurrences go, the live ones and today\'s stay');
    assert.ok(calls.creationParams <= 1201, `each id's creation log read once (${calls.creationParams})`);
    const before = { ...calls };
    for (let i = 0; i < 5; i++) assert.deepEqual(f.layers.step(), { changed: 0, posted: 0 });
    assert.deepEqual(calls, before, 'steady steps read no bodies or creation logs');
  } finally { f.db.close(); }
});
