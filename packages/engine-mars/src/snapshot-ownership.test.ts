import test from 'node:test';
import assert from 'node:assert/strict';
import type { EngineSnapshot } from '@souls/engine-contract';
import type { RuntimeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import { MarsEngine, marsFactory, GREEN_FIELD_WORLD, type MarsWorldConfig } from './engine.ts';
import { commonsProvisionsFactory } from './commons-provisions-engine.ts';
import { commonsNewcomerResourcesFactory } from './newcomer-resources-engine.ts';
import { nativeSleepSnapshotFactoryV1 } from './sleep-snapshot-engine.ts';

type Snapshot = EngineSnapshot & {
  mars: RuntimeSnapshot;
  cfg: MarsWorldConfig;
  leaving: string[];
  programs: { label: string; steps: { params: Record<string, unknown> }[] }[];
};

test('native snapshot owns the graph and adapter metadata in both directions, including a running program', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD), engine = factory.create(factory.genesis('snapshot-ownership'));
  engine.spawnHuman({ id: 'a', label: 'Alice', soul: 's_A' });
  assert.equal(engine.perform({ actor: 'a', label: 'rest', steps: [{ verb: 'rest', params: { seconds: 10 } }] }).ok, true);
  engine.step();
  const snapshot = engine.snapshot() as Snapshot, original = structuredClone(snapshot);
  assert.equal(snapshot.programs.length, 1);
  assert.equal(snapshot.stateHash, engine.stateHash());

  // Mutating the returned native graph or adapter fields cannot change the live engine.
  (snapshot.mars.data as { world: { tick: number } }).world.tick += 100;
  snapshot.mars.violations.push({ tick: 0, code: 'fixture', message: 'snapshot only' });
  snapshot.programs[0].steps[0].params.seconds = 1;
  snapshot.programs[0].label = 'changed snapshot';
  snapshot.cfg.arrival[0] += 100;
  snapshot.leaving.push('a');
  assert.deepEqual(engine.snapshot(), original);

  // Conversely, live adapter/world changes leave an earlier checkpoint unchanged.
  const captured = engine.snapshot(), capturedBytes = JSON.stringify(captured);
  engine.configureClock!({ origin: -20, dayTicks: 72000 });
  engine.configureRuntimePolicy!({ sleepBlockTicks: 1200, quietLandingCourtesyV1: true });
  for (let i = 0; i < 3; i++) engine.step();
  assert.equal(JSON.stringify(captured), capturedBytes);
  const restored = factory.restore(captured);
  assert.equal(restored.stateHash(), captured.stateHash);
  assert.equal(restored.world.tick, captured.tick);
});

test('snapshot hashes keep prospective adapter policies and clock state and never reuse a previous capture hash', async () => {
  const factory = await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true, safeArrivalV1: true,
    walkBlockV1: true, disassemblyV1: true, groundReclaimV1: true });
  const engine = factory.create(factory.genesis('snapshot-policies'));
  assert.ok(engine instanceof MarsEngine);
  engine.configureClock!({ origin: -20, dayTicks: 72000 });
  engine.configureRuntimePolicy!({ sleepBlockTicks: 1200, fixtureGroundGoalsV1: true,
    nativeArrivalWitnessV1: true, quietLandingCourtesyV1: true, walkSettleWaitV1: true });
  engine.beginQuiet!();
  const first = engine.snapshot() as Snapshot;
  assert.equal(first.stateHash, engine.stateHash());
  assert.equal(factory.restore(first).stateHash(), first.stateHash);
  engine.endQuiet();
  engine.step();
  const second = engine.snapshot() as Snapshot;
  assert.notEqual(second.stateHash, first.stateHash);
  assert.notEqual(second.mars.stateHash, first.mars.stateHash);
  assert.equal(second.stateHash, engine.stateHash());
  const restored = factory.restore(second);
  for (let i = 0; i < 3; i++) {
    engine.step(); restored.step();
    assert.equal(restored.stateHash(), engine.stateHash());
  }
});

test('captured native hash retains nested newcomer and sleep policy base hashes through restore', async () => {
  const factory = nativeSleepSnapshotFactoryV1(commonsNewcomerResourcesFactory(await commonsProvisionsFactory()));
  const engine = factory.create(factory.genesis('snapshot-base-hashes'));
  const provisions = engine.previewCommonsProvisionsV1!(); assert.ok(provisions.ok);
  engine.adoptCommonsProvisionsV1!(provisions.transition);
  const newcomers = engine.previewCommonsNewcomerResourcesV1!([
    { matCenter: [-22, 28], mealPoint: [-22, 12.5] },
    { matCenter: [-16, 28], mealPoint: [-16, 12.5] },
  ]); assert.ok(newcomers.ok);
  engine.adoptCommonsNewcomerResourcesV1!(newcomers.transition);
  const sleep = engine.previewNativeSleepSnapshotV1!(); assert.ok(sleep.ok);
  engine.adoptNativeSleepSnapshotV1!(sleep.transition);
  for (let i = 0; i < 2; i++) {
    const snapshot = engine.snapshot();
    assert.equal(snapshot.stateHash, engine.stateHash());
    const restored = factory.restore(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(restored.stateHash(), snapshot.stateHash);
    assert.equal(restored.rulesVersion, engine.rulesVersion);
    engine.step(); restored.step();
    assert.equal(restored.stateHash(), engine.stateHash());
  }
});
