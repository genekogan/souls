// F3 (rehearsal item 14): two Souls meeting face to face in a furnished roundhouse's doorway must pass within
// seconds — one yields or steps aside — instead of both waiting for minutes. (The face-to-face case itself is pinned in
// packages/engine-mars/src/doorway-passing.test.ts; this one runs the same crossing through the whole host.) Real host, sequencer, edge ledger,
// god compiler and engine bridge, as in nav.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('doorway: two Souls crossing a furnished roundhouse door in opposite directions both get through within seconds', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const r = god.act({ ops: [
    { op: 'place', def: coreRef('roundhouse'), name: 'rose-cottage', p: [-16, 0], r: Math.PI / 2 },
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [4, 0] },
  ] }, 'a cottage and a fountain') as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  const fu: any = runQuery(god.model, { furnish: { ref: 'rose-cottage' } }).furnish;
  assert.ok(fu.ops?.length, JSON.stringify(fu));
  assert.equal((god.act({ ops: fu.ops }, 'furnish') as any).accepted, true);
  await settle(3);
  const E = f.host.engine as any;
  const souls: any[] = [];
  for (const name of ['ana', 'ben']) {
    await invite(f, name);
    const row: any = await accept(f.host, f.souls.create(`dev:${name}`, { name, description: 'a guest' }));
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
  }
  await settle(3);
  const [ana, ben] = souls;
  const body = (s: any) => E.world.entities[s.entityId];
  const pos = (s: any) => body(s).pose.p.map((v: number) => +v.toFixed(2));
  const busy = (s: any) => (edge.observe(s, new Set()) as any).self.receipts.some((x: any) => !['completed', 'failed', 'refused', 'replaced', 'cancelled'].includes(x.phase ?? x.status));
  const run = async (n: number, until: () => boolean) => { let i = 0; for (; i < n; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); if (i > 40 && until()) break; } } await settle(2); return i; };
  const act = async (s: any, capability: string, params?: any) => { const a: any = await accept(f.host, edge.act(s, { capability, ...(params ? { params } : {}) })); assert.equal(a.accepted, true, JSON.stringify(a)); return a; };

  // Ana goes in; Ben goes to the fountain outside
  await act(ana, 'walk:rose-cottage/living');
  await act(ben, 'walk:fountain');
  const n0 = await run(6000, () => !busy(ana) && !busy(ben));
  void n0;
  const room = (s: any) => (runQuery(god.model, { where: [body(s).pose.p[0], body(s).pose.p[2]] }).where as any).room;
  assert.equal(room(ana)?.room, 'living', `Ana inside: ${pos(ana)}`);
  // now they cross: Ana out to the fountain, Ben in to the living room
  await act(ana, 'walk:fountain');
  await act(ben, 'walk:rose-cottage/living');
  const n1 = await run(6000, () => !busy(ana) && !busy(ben));
  assert.equal(room(ben)?.room, 'living', `Ben got in: ${pos(ben)}`);
  assert.ok(!room(ana), `Ana got out: ${pos(ana)}`);
  assert.ok(n1 < 1200, `both through within a minute of sim time (${n1} ticks)`);

});
