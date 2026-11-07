// SOULFIX2: every room of every VOCAB-W3 furnished building is reachable from the street by a Soul's body, through the
// real host, compiler and Soul engine: the stairs can be stepped onto and off (their ends are clear of walls and of the
// furniture), no door opens onto a flight or beside a stairwell, and every room upstairs is reached by its stairs.
// A room counts as reached when any clear spot inside it is (furniture may fill its middle, as nav's room goals allow).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const BUILDINGS = ['house', 'apartment-block', 'townhouse-row', 'cabin', 'mansion', 'dormitory', 'hotel', 'mobile-home', 'corner-shop', 'supermarket', 'restaurant', 'cafe', 'bar', 'bank',
  'office-block', 'mall', 'garage', 'petrol-station', 'school', 'hospital', 'library', 'town-hall', 'police-station', 'fire-station', 'church', 'prison', 'theatre', 'museum'];
// a cell locked by its own closed bars is closed off by design (a Soul opens the bars: vocab-w3 e2e S3)
const LOCKED = new Set(['police-station:cell-1']);

async function world() {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  return { ...f, god, settle };
}

test('furnished buildings: every room of every furnished type is reachable from the street', { timeout: 900000 }, async (t) => {
  const bad: string[] = [];
  let rooms = 0;
  for (const n of process.env.SOULFIX2_ONLY?.split(',') ?? BUILDINGS) {
    const w = await world();
    try {
      w.brain.quiesce();
      await w.settle(2);
      const p: [number, number] = [0, 6], street: [number, number] = [0, -19];
      const r: any = w.god.act({ ops: [{ op: 'place', def: coreRef(n), name: n, p }] });
      assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600));
      await w.settle(3);
      const E = w.host.engine as any, b = w.god.model.get(n)!, def = w.god.model.resolvedDef(b.def)!;
      const baked: any = w.god.model.bake(def, b.params ?? {}, b.seed ?? 0, (b as any).shape), wp = w.god.model.worldPose(b);
      const cs = Math.cos(wp.yaw), sn = Math.sin(wp.yaw);
      for (const room of baked.rooms ?? []) {
        rooms++;
        const q = runQuery(w.god.model, { reach: { from: street, to: `${n}:${room.id}` } }).reach as any;
        let ok = !!q?.reachable;
        if (!ok && q?.to) {
          const xs = room.polygon.map((v: number[]) => v[0]), zs = room.polygon.map((v: number[]) => v[1]);
          for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs) && !ok; x += 0.5) for (let z = Math.min(...zs) + 0.3; z < Math.max(...zs) && !ok; z += 0.5) {
            const at = [wp.x + x * cs + z * sn, wp.z - x * sn + z * cs];
            if (E.clearanceAtV1(at[0], at[1], q.to.level) >= 0.41) ok = E.reachV1({ p: street, level: 0 }, { p: at, level: q.to.level }).ok;
          }
        }
        if (!ok && !LOCKED.has(`${n}:${room.id}`)) bad.push(`${n}:${room.id} (${q?.code ?? q?.detail})`);
      }
    } finally { w.brain.quiesce(); w.host.stop(); w.db.close(); }
  }
  t.diagnostic(`${rooms} rooms checked`);
  assert.deepEqual(bad, []);
});
