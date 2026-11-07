import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { toyFactory } from '@souls/engine-toy';
import { kernelHash } from '@souls/kernel';
import { Db } from './db.ts';
import { WorldHost, type SnapshotBody } from './world.ts';

test('deferred snapshot persists its captured body despite later changes to every live owner', async t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const host = new WorldHost(db, toyFactory, 'snapshot-ownership', 1e9); host.boot();
  void host.enqueue('birth', 'fixture', { soulId: 's_A', entityId: 'h_A', name: 'Alice', description: 'fixture', owner: 'owner' });
  host.tickOnce();
  host.extra.fixture = { values: [1] }; host.counts.fixture = 1;
  const expected: SnapshotBody = { runtime: host.engine.snapshot(), minds: structuredClone([...host.minds.values()]),
    seq: host.seq, extra: structuredClone(host.extra), kernel: structuredClone(host.kernel), counts: { ...host.counts } };
  const physicalHash = host.engine.physicalHash(), result = host.saveSnapshot(false);
  assert.equal(db.latestSnapshot(host.worldId), null, 'the write is deferred');
  host.engine.world.entities.h_A.pose.p[0] += 1;
  host.minds.get('s_A')!.recent.push('after capture');
  host.kernel.things.s_A.traits.about = 'after capture';
  (host.extra.fixture as { values: number[] }).values.push(2);
  host.counts.fixture++;
  void host.enqueue('admin', 'fixture', { action: 'after capture' }); host.drainInputs();
  await setImmediate();
  const stored = db.latestSnapshot(host.worldId)!;
  assert.deepEqual(stored.body, JSON.parse(JSON.stringify(expected)));
  assert.equal(stored.seq, expected.seq);
  assert.equal(stored.tick, result.tick);
  assert.equal(stored.stateHash, expected.runtime.stateHash);
  assert.equal((db.db.prepare('SELECT physical_hash FROM snapshots WHERE world_id=?').get(host.worldId) as { physical_hash: string }).physical_hash, physicalHash);
  assert.equal(toyFactory.restore(stored.body.runtime).stateHash(), expected.runtime.stateHash);
  // Recovery also owns the original captured state, even after the deferred writer ran.
  const baseline = (host as unknown as { recoveryBaseline: SnapshotBody }).recoveryBaseline;
  assert.deepEqual(baseline, expected);
});

test('a deferred older snapshot restores through later accepted input to the durable frontier', async t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const make = () => new WorldHost(db, toyFactory, 'snapshot-frontier', 1e9, 'snapshot-frontier', { durableClockV1: true });
  const host = make(); host.boot(); host.tickOnce();
  const captured = host.saveSnapshot(false), capturedSeq = host.seq;
  void host.enqueue('birth', 'fixture', { soulId: 's_A', entityId: 'h_A', name: 'Alice', description: 'fixture', owner: 'owner' });
  host.tickOnce(); host.tickOnce();
  const head = { tick: host.engine.world.tick, seq: host.seq, engine: host.engine.stateHash(), kernel: kernelHash(host.kernel) };
  await setImmediate();
  const stored = db.latestSnapshot(host.worldId)!;
  assert.equal(stored.tick, captured.tick); assert.equal(stored.seq, capturedSeq);
  assert.ok(stored.tick < head.tick); assert.ok(stored.seq < head.seq);
  const restored = make(); assert.equal(restored.boot().from, 'snapshot');
  assert.equal(restored.engine.world.tick, head.tick); assert.equal(restored.seq, head.seq);
  assert.equal(restored.engine.stateHash(), head.engine); assert.equal(kernelHash(restored.kernel), head.kernel);
});
