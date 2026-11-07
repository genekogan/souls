// GODLIST (tranche perf 2026-10-22): the first Soul listing after a god edit no longer derives the activity spots
// itself. Once the edit is caught up with, the bridge derives them in a tick (only when a listing read them since the
// last such derive), and the listing then reads the same spots a fresh derive gives. levelAt's floors are bucketed
// (FloorCells): the same answer as a scan of every floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { pointInObb, type OBB2 } from '../../../../mars/viewer/engine/core/math.ts';
import { fixture, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge, FloorCells } from './engine-bridge.ts';
import { GodActivitySpots } from './activity-spots.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('FloorCells.some == a scan of every floor (rotated, huge, degenerate floors; points on and off them)', () => {
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const floors: { id: string; obb: OBB2 }[] = [];
  for (let i = 0; i < 400; i++) floors.push({ id: `f${i}`, obb: { c: [rnd() * 300 - 150, rnd() * 300 - 150], half: [rnd() * 8, rnd() * 8], yaw: rnd() * 7 - 3.5 } });
  floors.push({ id: 'huge', obb: { c: [0, 0], half: [5000, 3], yaw: 0.3 } }, { id: 'flat', obb: { c: [7.5, -2], half: [0, 0], yaw: 0 } });
  const cells = new FloorCells(); for (const f of floors) cells.add(f.id, f.obb);
  const skip = new Set(['f3', 'f17', 'huge']);
  let checked = 0, hits = 0;
  for (let i = 0; i < 20000; i++) {
    const at: [number, number] = i % 4 === 0 ? (() => { const f = floors[i % floors.length].obb, a = rnd() * 6.3, r = Math.hypot(f.half[0], f.half[1]) + 0.6 * rnd() * 1.6; return [f.c[0] + Math.cos(a) * r, f.c[1] + Math.sin(a) * r] as [number, number]; })() : [rnd() * 340 - 170, rnd() * 340 - 170];
    for (const without of [null, skip]) {
      const ok = (f: { id: string; obb: OBB2 }) => !without?.has(f.id) && pointInObb(at, f.obb, 0.6);
      const want = floors.some(ok); hits += +want; checked++;
      assert.equal(cells.some(at[0], at[1], ok), want, `${at} ${without ? 'without some' : ''}`);
    }
  }
  assert.ok(hits > 1000 && hits < checked, `a mix of hits and misses (${hits}/${checked})`);
  assert.equal(cells.some(NaN, 0, (f) => pointInObb([NaN, 0], f.obb, 0.6)), false);
});

test('GODLIST: activity spots derived in a tick after a caught-up god edit equal a fresh derive; no reader, no derive', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {}, worldLore: true });
  const { Hono } = await import('hono');
  const { mountEdgeRoutes, edgeSoulResolver } = await import('../edge/routes.ts');
  const comms = mountEdgeRoutes(new Hono(), { host: f.host, db: f.db, souls: f.souls, soul: edgeSoulResolver(f.host, f.souls, () => undefined), ledger: edge } as never);
  t.after(() => comms.close());
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const act = (ops: unknown[]) => { const r = god.act({ ops } as never) as any; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r; };
  act([
    { op: 'place', def: coreRef('bookcase'), name: 'books', p: [6, 0] },
    { op: 'place', def: coreRef('armchair'), name: 'reading-chair', p: [6, 2.5], r: Math.PI },
    { op: 'place', def: coreRef('campfire'), name: 'fire', p: [-6, 0] },
    { op: 'place', def: coreRef('table'), tmp: '$t', name: 'table', p: [0, 6] },
    { op: 'place', def: coreRef('roundhouse'), name: 'hut', p: [20, 0] },
  ]);
  const P = bridge.perceive as any, S = bridge.activitySpots;
  const caughtUp = async () => { for (let i = 0; i < 200 && (P.pending() || (bridge as any).perceiveRunning); i++) await settle(1); assert.equal(P.pending(), false, 'caught up'); await settle(6); };
  await caughtUp();
  // nobody has read the spots yet: the tick derives nothing
  assert.equal(S.stats.derives, 0, 'no reader, no derive');
  const first = S.data(); assert.equal(S.stats.derives, 1);
  const fresh = (label: string) => { const ref = new GodActivitySpots((S as any).h); (bridge as any).places.sync(true); assert.equal(JSON.stringify(S.data()), JSON.stringify(ref.data()), `${label}: equals a fresh derive`); };
  fresh('start');
  for (const [label, ops] of [
    ['a bench placed', [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [2, -4] }]],
    ['a second bench by the fire', [{ op: 'place', def: coreRef('bench'), name: 'bench-2', p: [-6, 2.5] }]],
  ] as const) {
    const n: number = S.stats.derives;
    act(ops as unknown as unknown[]);
    await caughtUp();
    assert.equal(S.stats.derives, n + 1, `${label}: derived once in a tick, before any read`);
    const read = S.data();
    assert.equal(S.stats.derives, n + 1, `${label}: the read takes the warmed spots`);
    assert.notEqual(read, first);
    fresh(label);
  }
  // an edit nobody reads the spots after: one warm derive, then none until a reader comes back
  const n = S.stats.derives;
  act([{ op: 'place', def: coreRef('bench'), name: 'bench-3', p: [-2, -6] }]); await caughtUp();
  assert.equal(S.stats.derives, n + 1, 'the read before it asked for one more');
  act([{ op: 'place', def: coreRef('bench'), name: 'bench-4', p: [-4, -6] }]); await caughtUp();
  assert.equal(S.stats.derives, n + 1, 'unread since: not derived again');
  S.data(); assert.equal(S.stats.derives, n + 2, 'the reader derives it');
});

test('L4 item 6: a served world derives the spots in tick slices; reads meanwhile keep the old spots; the result equals a fresh derive', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {}, worldLore: true });
  const { Hono } = await import('hono');
  const { mountEdgeRoutes, edgeSoulResolver } = await import('../edge/routes.ts');
  const comms = mountEdgeRoutes(new Hono(), { host: f.host, db: f.db, souls: f.souls, soul: edgeSoulResolver(f.host, f.souls, () => undefined), ledger: edge } as never);
  t.after(() => comms.close());
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const act = (ops: unknown[]) => { const r = god.act({ ops } as never) as any; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r; };
  const ops: unknown[] = [];
  for (let i = 0; i < 12; i++) ops.push({ op: 'place', def: coreRef('bookcase'), name: `books-${i}`, p: [i * 6, 0] }, { op: 'place', def: coreRef('armchair'), name: `chair-${i}`, p: [i * 6, 2.5], r: Math.PI }, { op: 'place', def: coreRef('bench'), name: `bench-${i}`, p: [i * 6, -5] });
  act(ops);
  const P = bridge.perceive as any, S = bridge.activitySpots as any;
  const caughtUp = async () => { for (let i = 0; i < 200 && (P.pending() || (bridge as any).perceiveRunning); i++) await settle(1); assert.equal(P.pending(), false, 'caught up'); };
  await caughtUp();
  // served-world behaviour, with the smallest slice (one step of the derive per tick)
  S.h.sliced = () => true; (bridge as any).perceiveDial = { sliceMs: 0, settle: 20 };
  let slices = 0; const warm = S.warm.bind(S); S.warm = (ms: number) => { if (S.deriving() || !S.cache) slices++; return warm(ms); };
  for (let i = 0; i < 400 && (!S.cache || S.deriving()); i++) await settle(1);
  assert.ok(S.cache && !S.deriving(), 'the boot spots are warmed unasked');
  assert.ok(slices > 2, `in slices (${slices})`);
  const fresh = (label: string) => { const ref = new GodActivitySpots({ ...S.h, sliced: () => false }); (bridge as any).places.sync(true); assert.equal(JSON.stringify(S.data()), JSON.stringify(ref.data()), `${label}: equals a fresh derive`); };
  fresh('boot');
  const before = S.data(), n = S.stats.derives;
  act([{ op: 'place', def: coreRef('bench'), name: 'late-bench', p: [3, 8] }]);
  await caughtUp();
  assert.equal(S.data(), before, 'a read before the sliced derive ends keeps the spots it has');
  slices = 0;
  for (let i = 0; i < 400 && (S.stats.derives === n || S.deriving()); i++) await settle(1);
  assert.equal(S.stats.derives, n + 1, 'derived once');
  assert.ok(slices > 2, `in slices (${slices})`);
  assert.notEqual(S.data(), before);
  fresh('after an edit');
});
