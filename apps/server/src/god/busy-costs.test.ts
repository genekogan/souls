// S2 (tranche 2026-10-19): the per-request costs of a busy Eden 2026 (residents listing what they can do while a god edits)
// were cut without changing a single answer. Incremental == full, through the real host, compiler, engine bridge and ledger:
// - a Soul's whole capability listing read inside one engine read pass (activities' clearance reads, near items' standing
//   points, seats, layers; one planner sync and one list of bodies) equals the listing read call by call, with the room
//   goals it kept per navigation epoch equal to fresh ones, after each kind of edit (a seat placed, a chair moved, an item
//   put down, a sign's words changed, a seat removed);
// - a sign's words (an edit that moves no navigation) re-route no room; a moved wall does;
// - the activity spots keep their last derive while the places catch up in slices (no whole places derive inside the
//   request), and once the catch-up ends they equal a fresh derive over fresh places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { GodActivitySpots } from './activity-spots.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('S2: listings read in one pass equal call-by-call listings; room goals kept per nav epoch; spots wait for the places', { timeout: 900000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {}, worldLore: true });
  // the comms objects (where `built` objects live: the catch-up needs them) come with the edge routes
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
    { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' }, p: [0, 0, 0] },
    { op: 'place', def: 'core-sign@1', name: 'notice', p: [-3, -3], state: { text: 'Welcome' } },
    { op: 'place', def: coreRef('roundhouse'), name: 'hut', p: [20, 0] },
  ]);
  await settle(3);
  const souls: any[] = [];
  for (const name of ['Ana', 'Bo']) {
    await invite(f, name.toLowerCase());
    const row: any = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, { name, description: 'a resident' }));
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner }); await settle(3);
  }
  const P = bridge.perceive as any, N = bridge.nav as any, L = edge as any, E = f.host.engine as any;
  const caughtUp = async () => { for (let i = 0; i < 200 && (P.pending() || (bridge as any).perceiveRunning); i++) await settle(1); assert.equal(P.pending(), false, 'caught up'); };
  await caughtUp();
  const rooms = N.things().filter((x: any) => x.kind === 'room' && x.entry);
  assert.ok(rooms.length > 0, 'the hut has a room with a front door');
  const list = (s: any) => { L.capCache.clear(); N.goals.clear(); return JSON.stringify(edge.capabilities(s)); };
  /** The reference: every read on its own (no read pass), every goal and room goal computed afresh. */
  const reference = (s: any) => {
    const pass = E.readPassV1; E.readPassV1 = undefined;
    try { N.rooms.clear(); return list(s); } finally { delete E.readPassV1; assert.equal(E.readPassV1, pass); }
  };
  const compare = (label: string) => {
    for (const s of souls) {
      const kept = list(s), fresh = reference(s);
      assert.ok(kept.includes('"read:') || kept.includes('read.'), `${label}: ${s.name} is offered reading`);
      assert.equal(kept, fresh, `${label}: ${s.name}'s listing read in one pass equals the call-by-call listing`);
    }
  };
  compare('start');
  const id = (name: string) => ([...god.model.entities.values()] as any[]).find((e) => e.name === name)!.id as string;
  // a room goal is routed once per navigation epoch: count the reach checks
  let reaches = 0; const reach = E.reachV1; E.reachV1 = function (...a: unknown[]) { reaches++; return reach.apply(this, a); };
  t.after(() => { delete E.reachV1; });
  for (const s of souls) list(s);
  const steps: [string, () => unknown[], boolean][] = [
    ['a bench placed', () => [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [2, -4] }], true],
    ['the sign rewritten', () => [{ op: 'set', id: 'notice', state: { text: 'Tea at five' } }], false],
    ['the armchair moved', () => [{ op: 'move', id: id('reading-chair'), p: [7, 3] }], true],
    ['a second bowl put down', () => [{ op: 'place', def: coreRef('bowl'), name: 'bowl-2', p: [1, 4] }], true],
    ['the bench removed', () => [{ op: 'remove', id: id('bench') }], true],
  ];
  for (const [label, ops, moves] of steps) {
    const ep = E.navEpochV1(), r0 = reaches, spots0 = bridge.activitySpots.data(), places0 = (bridge as any).places.stats.derives;
    act(ops());
    // while the places catch up, a read keeps the spots it has (no whole places derive inside the request)
    assert.equal(P.pending(), true, `${label}: noted`);
    assert.equal(bridge.activitySpots.data(), spots0, `${label}: the spots are kept while the places catch up`);
    assert.equal((bridge as any).places.stats.derives, places0, `${label}: no places derive inside the read`);
    await caughtUp();
    // the next read derives them; they equal a fresh derive over fresh places
    const spots = bridge.activitySpots.data(), fresh = new GodActivitySpots((bridge.activitySpots as any).h);
    (bridge as any).places.sync(true);
    assert.equal(JSON.stringify(spots), JSON.stringify(fresh.data()), `${label}: the spots after the catch-up equal a fresh derive`);
    for (const s of souls) list(s);
    if (moves) assert.notEqual(E.navEpochV1(), ep, `${label}: the static world moved`);
    else { assert.equal(E.navEpochV1(), ep, `${label}: nothing navigable moved`); assert.equal(reaches, r0, `${label}: no room re-routed`); }
    compare(label);
  }
  assert.ok(reaches > 0, 'room goals were routed');
});
