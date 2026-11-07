// A Soul in a furnished spot (more named things near than the walk offer shows) can still head for a big stand-alone
// structure across the camp, as it can for a building. Seen on Mars: from inside Mimos, `walk:freeside` (a mesh camp
// with no rooms, ~84 m away) was refused place.unwalkable because 120 nearer cups and chairs filled the offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('big stand-alone structures stay offered beyond the nearest-120 walk offers; small far things do not', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const benches = Array.from({ length: 130 }, (_, i) => ({ op: 'place', def: coreRef('bench'), name: `b-${i}`, p: [-20 + (i % 13) * 3.2, 14 + Math.floor(i / 13) * 2.6] }));
  const r = god.act({ ops: [
    ...benches,
    { op: 'place', def: 'core/mars-freeside@2', name: 'far-camp', p: [90, -10] },
    { op: 'place', def: coreRef('mars-vehicle-6'), name: 'far-car', p: [80, -40] },
  ] }, 'a furnished square and a shed across the field') as any;
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 800));
  await settle(3);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const walks = edge.capabilities(soul).filter((c) => c.verb === 'walk').map((c) => c.id);
  assert.ok(walks.filter((c) => c.startsWith('walk:b-')).length >= 100, 'the benches fill the offer');
  assert.ok(walks.includes('walk:far-camp'), `far-camp offered: ${walks.length} walks`);
  assert.ok(!walks.includes('walk:far-car'), 'a smaller far thing (a car) stays out of the offer');
});

// Lane M 2026-10-17, seen on Little Martians (Arium): from Madmaraca's court, 236 paving tiles and 96 exhibits are nearer
// than the Minarete court (an open 36 x 23 m court), so `walk:minarete-court` was refused place.unwalkable while
// `jog-around:minarete-court` was offered. Open-area places of court size stay offered; a far paving tile does not.
test('far open courts stay offered beyond the nearest-120 walk offers; small far tiles do not', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const benches = Array.from({ length: 130 }, (_, i) => ({ op: 'place', def: coreRef('bench'), name: `b-${i}`, p: [-20 + (i % 13) * 3.2, 14 + Math.floor(i / 13) * 2.6] }));
  const rect = (x: number, z: number, w: number, d: number) => ({ area: [[x, z], [x + w, z], [x + w, z + d], [x, z + d]] });
  const r = god.act({ ops: [
    ...benches,
    { op: 'place', def: coreRef('ground-paint'), name: 'far-court', shape: rect(80, -30, 36, 23), params: { material: 'dirt' } },
    { op: 'place', def: coreRef('ground-paint'), name: 'far-tile', shape: rect(80, 20, 8, 8), params: { material: 'dirt' } },
  ] }, 'a furnished square, a court and a tile across the field') as any;
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 800));
  await settle(3);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const walks = edge.capabilities(soul).filter((c) => c.verb === 'walk').map((c) => c.id);
  assert.ok(walks.filter((c) => c.startsWith('walk:b-')).length >= 100, 'the benches fill the offer');
  assert.ok(walks.includes('walk:far-court'), `far-court offered: ${walks.length} walks`);
  assert.ok(!walks.includes('walk:far-tile'), 'a far paving tile stays out of the offer');
});
