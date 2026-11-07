import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import type { Souls } from './souls.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { registerEdgeComms } from './edge/comms/index.ts';
import type { EdgeSoul } from './edge/contract.ts';
import type { ObjectKind, ObjectRecord } from './edge/comms/objects/types.ts';
import type { RideState } from './edge/comms/objects/ride.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
type Carrier = {
  id: string; def: string; label: string; pose: { p: number[]; yaw: number };
  state: { phase: string; home: number[]; yaw: number; seats: Record<string, string | null>;
    route: { id: string; keys: { t: number; p: number[] }[] }; elapsed: number;
    departAtTick: number | null; flights: number; holding: boolean; waitTicks: number; phaseTick: number };
};
function carrier(id: string): Carrier {
  return { id, def: 'hot-air-balloon', label: id, pose: { p: [0, 0, 0], yaw: 0 },
    state: { phase: 'parked', home: [0, 0, 0], yaw: 0, seats: { left: null, right: null },
      route: { id: 'fixture-loop', keys: [{ t: 0, p: [0, 0, 0] }, { t: 60, p: [0, 0, 0] }] },
      elapsed: 0, departAtTick: null, flights: 0, holding: false, waitTicks: 900, phaseTick: 0 } };
}
function fixture(t: TestContext, legacy = false) {
  const db = new Db(':memory:'), host = new WorldHost(db, factory, 'ride-refresh', 1e9, 'ride-refresh');
  host.boot(); host.drainInputs();
  const ledger = new EdgeLedger(host, db), hook = host.listeners.at(-1)!.afterTick!;
  // Control only the native carrier boundary. The actual ledger afterTick/rideFrames/carrierView,
  // object kinds, SQLite transactions, logs and committed stream notifications all run unchanged.
  const first = carrier('native-one'), second = carrier('native-two');
  let native = [first, second], riderPhase = 'seated';
  t.mock.method(ledger as unknown as { carriersNative(): Carrier[] }, 'carriersNative', () => native);
  t.mock.method(ledger, 'aboard', (entity: string) => entity === 'body-rider' && first.state.seats.left
    ? { id: first.id, slot: 'left', riderPhase, phase: first.state.phase, label: first.label } : null);
  const soul: EdgeSoul = { soulId: 'rider', entityId: 'body-rider', owner: 'dev:rider', name: 'Rider' };
  db.db.prepare('INSERT INTO souls (id,world_id,owner,entity_id,name,description,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(soul.soulId, host.worldId, soul.owner, soul.entityId, soul.name, '', 0);
  // carrierView reads this identity map; no fake mind is scheduled or advanced by the host.
  host.mindByEntity.set(soul.entityId, soul as unknown as Parameters<typeof host.mindByEntity.set>[1]);
  const runtime = registerEdgeComms(new Hono(), { host, db, ledger, souls: {} as Souls, soul: () => soul },
    { sweepMs: 0, fetch: null, now: () => 1_800_000_000_000 });
  ledger.attachComms(runtime);
  const frames: Record<string, unknown>[] = [];
  runtime.onSpectator(m => frames.push(m));
  if (legacy) Object.defineProperty(runtime.objects, 'ofKind', { value: undefined, configurable: true });
  t.after(() => { runtime.close(); host.stop(); db.close(); });
  const addRide = (id: string, nativeId = first.id) => runtime.objects.create({ id, kind: 'ride', name: id,
    placeId: 'world', params: { carrier: nativeId } });
  const frame = (tick: number) => {
    assert.equal(tick % 20, 10, 'isolate the existing half-second ride cadence from other ledger sweeps');
    host.engine.world.tick = tick; hook(tick);
    assert.equal(db.db.isTransaction, false);
  };
  const change = (phase: string, aboard: boolean, leaving = false, holding = false) => {
    first.state.phase = phase; first.state.seats.left = aboard ? soul.entityId : null;
    first.state.holding = holding; first.state.departAtTick = phase === 'boarding' ? host.engine.world.tick + 900 : null;
    riderPhase = leaving ? 'leaving' : 'seated';
  };
  return { db, host, ledger, runtime, soul, frames, first, second, frame, change, addRide,
    onlyFirst: () => { native = [first]; } };
}
type Fixture = ReturnType<typeof fixture>;
function row(f: Fixture, id: string): ObjectRecord {
  const r = f.db.db.prepare('SELECT body FROM edge_comms_objects WHERE world_id=? AND id=?').get(f.host.worldId, id) as { body: string };
  return JSON.parse(r.body);
}
function rideRows(f: Fixture) {
  return (f.db.db.prepare("SELECT body FROM edge_comms_objects WHERE world_id=? AND kind='ride' ORDER BY id").all(f.host.worldId) as { body: string }[]).map(r => JSON.parse(r.body));
}
function logs(f: Fixture) {
  return f.db.db.prepare('SELECT object_id,version,action,tick FROM edge_comms_object_log WHERE world_id=? ORDER BY object_id,version').all(f.host.worldId);
}
function stream(f: Fixture) {
  return f.db.db.prepare('SELECT seq,kind,tick,body FROM edge_comms_stream WHERE world_id=? AND soul_id=? ORDER BY seq').all(f.host.worldId, f.soul.soulId);
}

test('real ledger ride frames preserve legacy ride projection, aliases and same-tick notifications', t => {
  const target = fixture(t), legacy = fixture(t, true);
  for (const f of [target, legacy]) {
    f.addRide('z-alias'); f.addRide('a-alias'); f.addRide('m-closed', f.second.id);
    f.onlyFirst();
  }
  const phases: [string, boolean, boolean, boolean][] = [
    ['boarding', true, false, false], ['aloft', true, false, false], ['aloft', true, false, true],
    ['landed', true, true, false], ['parked', false, false, false],
  ];
  for (const [i, phase] of phases.entries()) {
    for (const f of [target, legacy]) { f.change(...phase); f.frame(10 + i * 20); }
    assert.deepEqual(rideRows(target), rideRows(legacy));
    assert.deepEqual(logs(target), logs(legacy));
    assert.deepEqual(stream(target), stream(legacy));
    assert.deepEqual(target.frames, legacy.frames);
  }
  assert.equal((row(target, 'm-closed').state as RideState).phase, 'closed');
  const messages = target.frames.filter(m => m.objectKind === 'ride');
  for (const pattern of [/in the basket/, /lifts off/, /hovers/, /landed/, /out of the balloon/])
    assert.ok(messages.some(m => pattern.test(String(m.text))), `missing ${pattern}`);
  for (const tick of [10, 30, 50, 70, 90]) {
    const batch = target.frames.filter(m => m.tick === tick);
    assert.equal(batch[0]?.kind, 'ride', 'native spectator frame precedes projected object notifications');
    const ids = batch.filter(m => m.objectKind === 'ride').map(m => String(m.object));
    assert.deepEqual(ids, [...ids].sort(), 'arbitrary aliases retain sorted relative order');
  }
  const before = logs(target);
  target.frame(110); assert.deepEqual(logs(target), before, 'unchanged carrier state does not advance objects');
});

test('carrier changes do not advance unrelated kinds; their own read and full maintenance still do', t => {
  const f = fixture(t); f.addRide('ride-alias');
  let unrelatedVisits = 0;
  const counter: ObjectKind<{ n: number }> = { kind: 'unrelated', description: '', listed: true, roles: [], actions: {},
    schema: { n: { type: 'integer', visibility: 'public' } }, initial: () => ({ n: 0 }), rolesOf: () => [],
    advance: s => { unrelatedVisits++; return s.n ? null : { state: { n: 1 } }; } };
  f.runtime.objects.register(counter);
  f.runtime.objects.create({ id: 'unrelated', kind: counter.kind, name: 'Unrelated', placeId: 'world' });
  for (const id of ['calendar-read', 'calendar-timer']) f.runtime.objects.create({ id, kind: 'calendar-item', name: id,
    placeId: 'world', params: { startsAtTick: 10, durationTicks: 20 } });
  f.runtime.objects.create({ id: 'presentation', kind: 'presentation', name: 'Presentation', placeId: 'world',
    params: { startsAtTick: 10, doorsOpenTicks: 10, durationTicks: 20, capacity: 2 } });
  f.change('boarding', true); f.frame(10);
  assert.equal(unrelatedVisits, 0);
  assert.equal((row(f, 'calendar-read').state as { phase: string }).phase, 'upcoming');
  assert.equal((row(f, 'presentation').state as { phase: string }).phase, 'booking');
  f.runtime.objects.get('calendar-read', f.soul); f.runtime.objects.get('presentation', f.soul);
  assert.equal((row(f, 'calendar-read').state as { phase: string }).phase, 'happening');
  assert.equal((row(f, 'presentation').state as { phase: string }).phase, 'running');
  // Drain the same full object generator used by scheduled maintenance, without starting a timer.
  for (const _ of f.runtime.objects.sweepSteps()) assert.equal(f.db.db.isTransaction, false);
  assert.equal((row(f, 'calendar-timer').state as { phase: string }).phase, 'happening');
  assert.equal(unrelatedVisits, 1);
  f.host.engine.world.tick = 30; f.runtime.objects.sweep();
  assert.equal((row(f, 'calendar-read').state as { phase: string }).phase, 'over');
  assert.equal((row(f, 'presentation').state as { phase: string }).phase, 'ended');
});

test('ride refresh re-reads a later alias after an earlier committed notification replaces it', t => {
  const f = fixture(t); f.addRide('z-alias'); f.addRide('a-alias');
  let replaced = false;
  f.runtime.onSpectator(m => {
    if (m.object !== 'a-alias' || replaced) return;
    replaced = true;
    assert.equal(f.db.db.isTransaction, false);
    assert.equal(row(f, 'a-alias').version, 2);
    f.runtime.objects.remove('z-alias'); f.addRide('z-alias', f.second.id);
  });
  f.change('boarding', true); f.frame(10);
  assert.equal(replaced, true);
  assert.equal((row(f, 'z-alias').state as RideState).carrier, f.second.id);
  assert.equal((row(f, 'z-alias').state as RideState).phase, 'parked');
  assert.equal(f.frames.some(m => m.object === 'z-alias'), false, 'no stale advance of replaced alias');
});

test('a failed ride advance rolls back its log/state/events while earlier aliases stay committed', t => {
  const f = fixture(t); f.addRide('z-alias'); f.addRide('a-alias');
  f.db.db.exec("CREATE TRIGGER reject_ride_advance BEFORE INSERT ON edge_comms_object_log WHEN NEW.object_id='z-alias' AND NEW.action='advance' BEGIN SELECT RAISE(ABORT,'fixture ride log failure'); END");
  f.change('boarding', true); f.frame(10); // ledger's existing best-effort catch contains the failure
  assert.equal(row(f, 'a-alias').version, 2); assert.equal(row(f, 'z-alias').version, 1);
  assert.equal((row(f, 'z-alias').state as RideState).phase, 'parked');
  assert.equal(f.frames.some(m => m.object === 'a-alias'), true);
  assert.equal(f.frames.some(m => m.object === 'z-alias'), false);
  f.db.db.exec('DROP TRIGGER reject_ride_advance');
  f.runtime.objects.get('z-alias', f.soul);
  assert.equal((row(f, 'z-alias').state as RideState).phase, 'boarding', 'next own read catches up');
});

test('legacy object adapters still receive their synchronous full sweep', t => {
  const f = fixture(t, true); f.addRide('alias');
  f.runtime.objects.create({ id: 'calendar', kind: 'calendar-item', name: 'Calendar', placeId: 'world',
    params: { startsAtTick: 10, durationTicks: 20 } });
  f.change('boarding', true); f.frame(10);
  assert.equal((row(f, 'alias').state as RideState).phase, 'boarding');
  assert.equal((row(f, 'calendar').state as { phase: string }).phase, 'happening');
});
