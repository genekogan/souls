// G1 (tranche 2026-10-19): what Souls perceive of god edits catches up off the request path — coalesced, in slices, over
// the edited things and the objects within 12 m of the named ones among them. The catch-up must end where a whole pass
// ends: after each kind of edit (a named thing placed by others, moved away, renamed, a sign's words, a house moved with
// its things, a thing removed, an undo) the `built` objects' wanted states equal those of a forced whole pass, and the
// named things (nav.ts, descriptions reused per entity) equal a fresh derive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('G1: perception catches up incrementally, off the request path, and ends where a whole pass ends', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  // the comms objects (where `built` objects live) come with the edge routes
  const { Hono } = await import('hono');
  const { mountEdgeRoutes, edgeSoulResolver } = await import('../edge/routes.ts');
  const comms = mountEdgeRoutes(new Hono(), { host: f.host, db: f.db, souls: f.souls, soul: edgeSoulResolver(f.host, f.souls, () => undefined), ledger: edge } as never);
  t.after(() => comms.close());
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const P = bridge.perceive as any;
  const act = (ops: unknown[]) => { const r = god.act({ ops } as never) as any; assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  act([
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [0, 0] },
    { op: 'place', def: coreRef('bench'), name: 'bench-a', p: [4, 0] },
    { op: 'place', def: coreRef('bench'), name: 'bench-b', p: [40, 0] },
    { op: 'place', def: 'core-sign@1', name: 'notice', p: [-4, 2], state: { text: 'Welcome' } },
    { op: 'place', def: coreRef('roundhouse'), name: 'hut', p: [-20, 20] },
    { op: 'place', def: coreRef('lamp-post'), p: [6, 6] },
  ]);
  await settle(4);
  P.sync(true);
  assert.ok((P.desired as Map<string, unknown>).size >= 3, 'the fountain, the hut and the sign are built objects (benches are seats)');
  const wanted = () => JSON.stringify([...(P.desired as Map<string, unknown>).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const id = (name: string) => god.model.get(name)!.id;
  const check = async (label: string, ops: unknown[] | (() => void)) => {
    const runs = P.stats.runs;
    if (typeof ops === 'function') ops(); else act(ops);
    // the edit itself does none of the catch-up (it runs in the ticks after, a second after the last edit)
    assert.equal(P.stats.runs, runs, `${label}: no catch-up inside the edit`);
    assert.equal(P.pending(), true, `${label}: noted`);
    for (let i = 0; i < 120 && (P.pending() || P.stats.runs === runs); i++) await settle(1);
    assert.equal(P.pending(), false, `${label}: caught up within 120 ticks`);
    assert.equal(P.stats.lastFull, false, `${label}: an incremental catch-up`);
    // the named things (nav.ts), re-derived with each description reused where nothing it reads changed, equal a fresh derive
    const N = bridge.nav as any, kept = JSON.stringify(N.things()); N.memo.clear(); N.cache = null;
    assert.equal(kept, JSON.stringify(N.things()), `${label}: reused descriptions equal fresh ones`);
    const inc = wanted(), ids = P.stats.lastIds;
    P.sync(true);
    assert.equal(inc, wanted(), `${label}: the incremental catch-up equals a whole pass`);
    return ids;
  };
  const ids = await check('a named bench placed by the fountain', [{ op: 'place', def: coreRef('bench'), name: 'bench-c', p: [-3, -3] }]);
  assert.ok(ids < god.model.entities.size, `${ids} of ${god.model.entities.size}: only the edited and nearby things were recomputed`);
  await check('the fountain moved away from its benches', [{ op: 'move', id: id('fountain'), p: [30, 0] }]);
  await check('a bench renamed', [{ op: 'set', id: id('bench-a'), name: 'old-bench' }]);
  await check('the sign\'s words', [{ op: 'set', id: id('notice'), state: { text: 'Closed today' } }]);
  await check('the hut moved with what is in it', [{ op: 'move', id: id('hut'), p: [-2, 12] }]);
  await check('a bench removed', [{ op: 'remove', id: id('bench-b') }]);
  await check('undo', () => { assert.equal((god.undo() as any).accepted !== false, true); });
  const signs = [...(P.signs as Map<string, { text: string }>).values()].map((s) => s.text);
  assert.deepEqual(signs, ['Closed today']);
});
