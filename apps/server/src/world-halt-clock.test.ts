import test from 'node:test';
import assert from 'node:assert/strict';
import type { Engine, EngineFactory } from '@sim/engine-contract';
import { marsFactory, GREEN_FIELD_WORLD } from '@sim/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';

// #1120: a fault that edge recovery cannot repair halts the world. The halted host may be half-replayed (its seq behind the
// log, its state matching no logged prefix), so nothing durable is written from it afterwards: ticks, drains and snapshots
// refuse, naming the fault, and the log and the clock frontier stay as they were. Only the adapter's step is faulted.
const native = await marsFactory(GREEN_FIELD_WORLD);
const worldId = 'halt-clock', seed = 'halt-clock';

function fixture() {
  const control = { fault: null as Error | null };
  const wrap = (engine: Engine) => {
    const step = engine.step.bind(engine);
    engine.step = () => { const fault = control.fault; control.fault = null; if (fault) throw fault; return step(); };
    engine.canSnapshot = () => false;   // no recovery baseline: the fault cannot be repaired, as when the replay faults again
    return engine;
  };
  const factory: EngineFactory = { ...native, create: (w) => wrap(native.create(w)), restore: (s) => wrap(native.restore(s)) };
  const db = new Db(':memory:'), host = new WorldHost(db, factory, seed, 1e9, worldId, { durableClockV1: true });
  host.boot(); host.drainInputs(); host.recoveryForEdge = true;
  return { db, host, control };
}
const frontierRow = (db: Db) => db.db.prepare('SELECT body FROM clock_frontiers_v1 WHERE world_id=?').get(worldId) as { body: string } | undefined;

test('#1120: a halted host refuses every later tick, drain and snapshot, naming the fault; the log and the frontier are unchanged', async (t) => {
  const { db, host, control } = fixture();
  t.after(() => { host.stop(); db.close(); });
  t.mock.method(console, 'error', () => {});
  host.tickOnce(); host.tickOnce();
  control.fault = new Error('fixture.unrepairable');
  host.tickOnce();
  assert.equal(host.paused, true);
  assert.match(host.engineFault!, /fixture\.unrepairable/);
  const seq = db.lastSeq(worldId), frontier = frontierRow(db)?.body, tick = host.engine.world.tick;
  for (const [name, run] of [['enqueue', () => host.enqueue('admin', 'test', { action: 'note' })], ['tickOnce', () => host.tickOnce()], ['drainInputs', () => host.drainInputs()], ['saveSnapshot', () => host.saveSnapshot(true)], ['resume', () => host.setPaused(false, 'admin')]] as const) {
    assert.throws(run, (e: Error) => e.message === 'clock-frontier.unavailable' && /engine\.halted: .*fixture\.unrepairable/.test(String((e.cause as Error)?.message)), name);
  }
  assert.equal(host.clockAvailable, false);
  assert.equal(db.lastSeq(worldId), seq, 'nothing appended to the log');
  assert.equal(frontierRow(db)?.body, frontier, 'the clock frontier is the one from before the fault');
  assert.equal(host.engine.world.tick, tick);
  assert.equal(host.paused, true, 'a refused resume leaves it paused');
});
