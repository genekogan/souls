import test from 'node:test';
import assert from 'node:assert/strict';
import type { EngineSnapshot } from '@souls/engine-contract';
import type { RuntimeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import { MarsEngine, marsFactory, GREEN_FIELD_WORLD, type MarsWorldConfig } from './engine.ts';
import { commonsProvisionsFactory } from './commons-provisions-engine.ts';
import { commonsNewcomerResourcesFactory } from './newcomer-resources-engine.ts';
import { nativeSleepSnapshotFactoryV1 } from './sleep-snapshot-engine.ts';

type Snapshot = EngineSnapshot & { mars: RuntimeSnapshot; cfg: MarsWorldConfig;
  programs: { label: string; steps: { params: Record<string, unknown> }[] }[] };
function finish(steps: Generator<void, EngineSnapshot, void>): EngineSnapshot {
  let result = steps.next(), n = 0;
  while (!result.done) { assert.ok(++n < 100000); result = steps.next(); }
  return result.value;
}

test('adapter capture fixes policies, programs, clock and native hash before the world advances', async () => {
  const factory = await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true, safeArrivalV1: true,
    walkBlockV1: true, disassemblyV1: true, groundReclaimV1: true });
  const engine = factory.create(factory.genesis('deferred-snapshot'));
  assert.ok(engine instanceof MarsEngine);
  engine.spawnHuman({ id: 'a', label: 'Alice', soul: 's_A' });
  // A flat persisted field exceeds the emitter's 256-work quantum even when
  // this small Greenfield fixture has no other entities or active native verbs.
  const tags = engine.world.entities.a.tags ??= [];
  tags.push(...Array.from({ length: 700 }, (_, i) => `capture-fixture-${i}`));
  assert.equal(engine.perform({ actor: 'a', label: 'rest', steps: [{ verb: 'rest', params: { seconds: 10 } }] }).ok, true);
  engine.configureClock!({ origin: -20, dayTicks: 72000 });
  engine.configureRuntimePolicy!({ sleepBlockTicks: 1200, fixtureGroundGoalsV1: true,
    nativeArrivalWitnessV1: true, quietLandingCourtesyV1: true, walkSettleWaitV1: true });
  engine.beginQuiet!(); engine.step();
  const expected = engine.snapshot(), bytes = JSON.stringify(expected), capture = engine.captureSnapshot!();
  assert.equal(capture.tick, expected.tick); assert.equal(capture.stateHash, expected.stateHash);
  assert.equal(capture.stateHash, engine.stateHash()); assert.ok(Object.isFrozen(capture));
  const iterator = capture.steps(); assert.equal(iterator.next().done, false);
  tags[tags.length - 1] = 'changed after capture';
  engine.configureClock!({ origin: 700, dayTicks: 144000 });
  engine.configureRuntimePolicy!({ sleepBlockTicks: 300, quietLandingCourtesyV1: false });
  engine.endQuiet(); for (let i = 0; i < 3; i++) engine.step();
  const deferred = finish(iterator) as Snapshot;
  assert.equal(JSON.stringify(deferred), bytes);
  const synchronous = capture.finish() as Snapshot;
  assert.equal(JSON.stringify(synchronous), bytes);
  assert.equal(synchronous.programs.length, 1);
  synchronous.programs[0].label = 'mutated completion';
  synchronous.programs[0].steps[0].params.seconds = 999;
  synchronous.cfg.arrival[0] += 100;
  synchronous.mars.violations.push({ tick: 0, code: 'output', message: 'output only' });
  assert.equal(JSON.stringify(finish(capture.steps())), bytes);
  const reference = factory.restore(expected), restored = factory.restore(deferred);
  assert.equal(restored.stateHash(), capture.stateHash);
  for (let i = 0; i < 3; i++) {
    reference.step(); restored.step(); assert.equal(restored.stateHash(), reference.stateHash());
  }
});

test('deferred adapter completion retains nested newcomer and sleep base hashes from the same boundary', async () => {
  const factory = nativeSleepSnapshotFactoryV1(commonsNewcomerResourcesFactory(await commonsProvisionsFactory()));
  const engine = factory.create(factory.genesis('deferred-base-hashes'));
  const provisions = engine.previewCommonsProvisionsV1!(); assert.ok(provisions.ok);
  engine.adoptCommonsProvisionsV1!(provisions.transition);
  const newcomers = engine.previewCommonsNewcomerResourcesV1!([
    { matCenter: [-22, 28], mealPoint: [-22, 12.5] }, { matCenter: [-16, 28], mealPoint: [-16, 12.5] },
  ]); assert.ok(newcomers.ok);
  engine.adoptCommonsNewcomerResourcesV1!(newcomers.transition);
  const sleep = engine.previewNativeSleepSnapshotV1!(); assert.ok(sleep.ok);
  engine.adoptNativeSleepSnapshotV1!(sleep.transition);
  const expected = engine.snapshot(), capture = engine.captureSnapshot!(), rules = engine.rulesVersion;
  engine.configureClock!({ origin: -20, dayTicks: 72000 }); engine.step();
  for (const snapshot of [capture.finish(), finish(capture.steps())]) {
    assert.equal(JSON.stringify(snapshot), JSON.stringify(expected));
    const restored = factory.restore(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(restored.stateHash(), capture.stateHash); assert.equal(restored.rulesVersion, rules);
    const reference = factory.restore(expected);
    restored.step(); reference.step(); assert.equal(restored.stateHash(), reference.stateHash());
  }
});
