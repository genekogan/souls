import test from 'node:test';
import assert from 'node:assert/strict';
import type { Engine, EngineSnapshot, EngineCheckpoint, EngineCheckpointCapture, WorldState } from '@souls/engine-contract';
import type { RuntimeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import { MarsEngine, marsFactory, GREEN_FIELD_WORLD, type MarsWorldConfig } from './engine.ts';
import { commonsProvisionsFactory } from './commons-provisions-engine.ts';
import { commonsNewcomerResourcesFactory } from './newcomer-resources-engine.ts';
import { nativeSleepSnapshotFactoryV1 } from './sleep-snapshot-engine.ts';
import { physicalView, stableStringify } from '@souls/engine-contract';
import { createHash } from 'node:crypto';
import { captureGraphDeferred, capturedCanonicalRoot, prepareImmutableSnapshotData } from '../../../mars/viewer/engine/runtime/codec.ts';
import { capturedPhysicalHashSteps, capturePhysicalHashInput } from './checkpoint-hash.ts';
import { hashOf as nativeHash, stableStringify as nativeText } from '../../../mars/viewer/engine/core/hash.ts';

type Snapshot = EngineSnapshot & { mars: RuntimeSnapshot; cfg: MarsWorldConfig;
  programs: { label: string; steps: { params: Record<string, unknown> }[] }[] };
function checkpoint(engine: Engine): EngineCheckpointCapture {
  const capture = engine.captureCheckpoint!();
  assert.ok(!('stateHash' in capture), 'ordinary inert data retains deferred hashing');
  return capture;
}
function finish(steps: Generator<void, EngineCheckpoint, void>): EngineSnapshot {
  let result = steps.next(), n = 0;
  while (!result.done) { assert.ok(++n < 100000); result = steps.next(); }
  return result.value.snapshot;
}

test('checkpoint hashes fix policies, programs, clock and native hash before the world advances', async () => {
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
  const expected = engine.snapshot(), bytes = JSON.stringify(expected), capture = checkpoint(engine);
  assert.equal(capture.tick, expected.tick);
  assert.equal(expected.stateHash, engine.stateHash()); assert.ok(Object.isFrozen(capture));
  const physical = engine.physicalHash();
  const iterator = capture.steps(); assert.equal(iterator.next().done, false);
  tags[tags.length - 1] = 'changed after capture';
  engine.configureClock!({ origin: 700, dayTicks: 144000 });
  engine.configureRuntimePolicy!({ sleepBlockTicks: 300, quietLandingCourtesyV1: false });
  engine.endQuiet(); for (let i = 0; i < 3; i++) engine.step();
  const deferred = finish(iterator) as Snapshot;
  assert.equal(JSON.stringify(deferred), bytes);
  assert.equal(capture.finish().physicalHash, physical);
  const synchronous = capture.finish().snapshot as Snapshot;
  assert.equal(JSON.stringify(synchronous), bytes);
  assert.equal(synchronous.programs.length, 1);
  synchronous.programs[0].label = 'mutated completion';
  synchronous.programs[0].steps[0].params.seconds = 999;
  synchronous.cfg.arrival[0] += 100;
  synchronous.mars.violations.push({ tick: 0, code: 'output', message: 'output only' });
  assert.equal(JSON.stringify(finish(capture.steps())), bytes);
  const reference = factory.restore(expected), restored = factory.restore(deferred);
  assert.equal(restored.stateHash(), expected.stateHash);
  for (let i = 0; i < 3; i++) {
    reference.step(); restored.step(); assert.equal(restored.stateHash(), reference.stateHash());
  }
});

test('checkpoint deferred hashes retain nested newcomer and sleep base hashes from the same boundary', async () => {
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
  const expected = engine.snapshot(), capture = checkpoint(engine), rules = engine.rulesVersion;
  engine.configureClock!({ origin: -20, dayTicks: 72000 }); engine.step();
  for (const snapshot of [capture.finish().snapshot, finish(capture.steps())]) {
    assert.equal(JSON.stringify(snapshot), JSON.stringify(expected));
    const restored = factory.restore(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(restored.stateHash(), expected.stateHash); assert.equal(restored.rulesVersion, rules);
    const reference = factory.restore(expected);
    restored.step(); reference.step(); assert.equal(restored.stateHash(), reference.stateHash());
  }
});

test('captured physical projection matches legacy integer IDs, proto IDs, omissions and same-tick mutations', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD), engine = factory.create(factory.genesis('physical-projection'));
  const world = engine.world;
  engine.spawnHuman({ id: '2', label: 'Two', soul: 's_2' });
  engine.spawnHuman({ id: '10', label: 'Ten', soul: 's_10' });
  Object.defineProperty(world.entities, '__proto__', { value: structuredClone(world.entities['2']), enumerable: true, writable: true });
  Object.assign(world.entities['2'], JSON.parse('{"fixture":{"2":2,"10":10,"__proto__":{"ignored":true}},"absent":null}'));
  const region = { id: '2', kind: 'place', polygon: [[0, 0], [1, 0], [1, 1]], level: 0 };
  Object.assign(world.regions, { '2': region, '10': { ...region, id: '10' } });
  Object.defineProperty(world.regions, '__proto__', { value: { ...region, id: '__proto__' }, enumerable: true });
  const expected = createHash('sha256').update(stableStringify(physicalView(world))).digest('hex');
  const captured = capturedCanonicalRoot(captureGraphDeferred(world)), iterator = capturedPhysicalHashSteps(captured, 2);
  let result = iterator.next(), turns = 0;
  while (!result.done) {
    world.entities['2'].pose.p[0] += 1; world.regions['2'].polygon[0][0] += 1;
    turns++; result = iterator.next();
  }
  assert.ok(turns > 5); assert.equal(result.value, expected);
  assert.notEqual(engine.physicalHash(), expected);
});

test('adapter hash-domain failures are rejected before publishing a checkpoint ticket', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD), engine = factory.create(factory.genesis('invalid-checkpoint'));
  const live = engine as unknown as { cfg: { clock?: unknown } };
  live.cfg.clock = { origin: Infinity, dayTicks: 72000 };
  assert.throws(() => engine.captureCheckpoint!(), /non-finite/);
  const cycle: { self?: unknown } = {}; cycle.self = cycle; live.cfg.clock = cycle;
  assert.throws(() => engine.captureCheckpoint!(), RangeError);
});

test('all adapter base-hash variants use captured policy inputs, including lecture and office policy', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD), engine = factory.create(factory.genesis('policy-composition'));
  // Exercise the hash-composition seam directly, without claiming these stand-in
  // metadata facts are an accepted world-edit/restore fixture.
  const internals = engine as unknown as { lecturePlacement: unknown; sleepSnapshotActive: boolean; newcomerResources: unknown[]; foodDeliveries: unknown[] };
  internals.lecturePlacement = { id: 'hash-policy-fixture', nested: { side: 2 } };
  internals.sleepSnapshotActive = true;
  internals.newcomerResources = [{ id: 'hash-resource-fixture', placements: [1, 2] }];
  internals.foodDeliveries = [{ id: 'hash-delivery-fixture' }];
  Object.assign(engine.world, { officeStairGuardsV1: { version: 'office-hash-fixture' } });
  const expected = engine.snapshot(), capture = checkpoint(engine), iterator = capture.steps();
  assert.equal(iterator.next().done, false);
  internals.lecturePlacement = undefined; internals.sleepSnapshotActive = false;
  internals.newcomerResources = []; internals.foodDeliveries = [];
  Object.assign(engine.world, { officeStairGuardsV1: { version: 'changed-after-capture' } });
  assert.equal(JSON.stringify(finish(iterator)), JSON.stringify(expected));
  assert.equal(JSON.stringify(capture.finish().snapshot), JSON.stringify(expected));
});

test('native selected physics text and raw physical hash preserve their distinct rejection domains', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD), engine = factory.create(factory.genesis('physical-domain'));
  engine.spawnHuman({ id: 'a', label: 'Alice', soul: 's_A' });
  const facts = { levels: [0], byEntity: { a: { x: 1 } }, assets: {} };
  const physics = { version: 'entity-physics/1', hash: nativeHash(facts), ...facts };
  nativeText(physics);
  const copied = structuredClone(physics); copied.byEntity.a.x = Infinity;
  Object.assign(engine.world.entities.a, { hashFixture: copied });
  assert.doesNotThrow(() => engine.stateHash(), 'legacy native selected text hides the raw nonfinite field');
  assert.throws(() => engine.physicalHash(), /non-finite/);
  assert.throws(() => engine.captureCheckpoint!(), /non-finite/, 'physical-domain rejection still happens before ticket publication');
  copied.byEntity.a.x = 2;
  const expected = engine.snapshot(), physical = engine.physicalHash(), capture = checkpoint(engine);
  copied.byEntity.a.x = 3;
  const completed = capture.finish();
  assert.equal(JSON.stringify(completed.snapshot), JSON.stringify(expected)); assert.equal(completed.physicalHash, physical);
});


test('hidden native selector metadata returns legacy capture with the original getter effects and physical timing', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const make = () => {
    const engine = factory.create(factory.genesis('hidden-selector-adapter'));
    const log: string[] = [], fixture = { levels: [], byEntity: {}, assets: {} };
    engine.spawnHuman!({ id: 'a', label: 'Alice', soul: 's_A' });
    Object.defineProperties(fixture, {
      version: { get() { log.push('version'); engine.world.entities.a.pose.p[0] += 1; return 'entity-physics/1'; } },
      hash: { get() { log.push('hash'); return '0'.repeat(64); } },
    });
    Object.assign(engine.world, { fixture });
    return { engine, log };
  };
  const eager = make(), expected = eager.engine.captureSnapshot!(), expectedLog = [...eager.log];
  const deferred = make(), capture = deferred.engine.captureCheckpoint!();
  assert.ok('stateHash' in capture, 'exceptional source uses existing eager ticket shape');
  assert.deepEqual(deferred.log, expectedLog);
  assert.equal(capture.stateHash, expected.stateHash);
  assert.equal(deferred.engine.physicalHash(), eager.engine.physicalHash(), 'physical hash sees native getter side effects');
  const bytes = JSON.stringify(expected.finish());
  const calls = [...deferred.log]; deferred.engine.world.entities.a.pose.p[0] += 100;
  assert.equal(JSON.stringify(capture.finish()), bytes);
  const iterator = capture.steps(); let result = iterator.next(); while (!result.done) result = iterator.next();
  assert.equal(JSON.stringify(result.value), bytes); assert.deepEqual(deferred.log, calls);
});


test('selected physical proof never certifies omitted containers or loses raw aliases', () => {
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  const make = () => ({ base: {}, entities: {}, regions: {}, inventory: 'unlimited', rng: {} }) as unknown as WorldState;
  const prove = (world: WorldState) => capturePhysicalHashInput(capturedCanonicalRoot(captureGraphDeferred(world)));
  const world = make(), entity = { id: 'a', label: Infinity, tags: cycle, provenance: cycle, pose: { p: [0, 0, 0] } };
  Object.assign(world.entities, { a: entity });
  assert.doesNotThrow(() => prove(world), 'omitted nonfinite/cyclic metadata is not physical state');
  Object.assign(world.entities, { b: { id: 'b', raw: entity } });
  assert.throws(() => prove(world), /non-finite/, 'a later raw alias must validate the complete entity');
  delete world.entities.b;
  const region = { id: 'r', kind: 'place', polygon: [[0, 0]], level: 0, ignored: Infinity };
  Object.assign(world.regions, { r: region });
  assert.doesNotThrow(() => prove(world));
  Object.assign(world.entities, { b: { id: 'b', raw: region } });
  assert.throws(() => prove(world), /non-finite/, 'a projected region is not a raw-closure proof');
  delete world.entities.b;
  const skipped = { bad: Infinity };
  Object.defineProperty(world.entities, '__proto__', { value: skipped, enumerable: true, configurable: true });
  assert.doesNotThrow(() => prove(world), 'legacy entity-table assignment drops this ID');
  Object.assign(world.entities, { b: { id: 'b', raw: skipped } });
  assert.throws(() => prove(world), /non-finite/, 'another path to the skipped entity remains physical');
  const captured = capturedCanonicalRoot(captureGraphDeferred(world));
  skipped.bad = 0; prepareImmutableSnapshotData(skipped);
  assert.throws(() => capturePhysicalHashInput(captured), /non-finite/, 'late admission cannot replace captured values');
});

for (const accessor of [false, true]) test(`hidden physical region level retains legacy capture and read timing (accessor=${accessor})`, async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const make = () => {
    const engine = factory.create(factory.genesis('hidden-physical-level')), log: string[] = [];
    engine.spawnHuman({ id: 'a', label: 'Alice', soul: 's_A' });
    const region = { id: 'r', kind: 'place', polygon: [[0, 0], [1, 0], [0, 1]] };
    Object.defineProperty(region, 'level', accessor ? { get() {
      log.push('level'); engine.world.entities.a.pose.p[0] += 1; return 3;
    } } : { value: 3 });
    Object.assign(engine.world.regions, { r: region });
    return { engine, log };
  };
  const eager = make(), expected = eager.engine.captureSnapshot!();
  const deferred = make(), captured = deferred.engine.captureCheckpoint!();
  assert.ok('stateHash' in captured, 'hidden physical data requests the existing eager ticket shape');
  assert.deepEqual(eager.log, []); assert.deepEqual(deferred.log, [], 'fallback detection never invokes the getter');
  const expectedPhysical = eager.engine.physicalHash(), actualPhysical = deferred.engine.physicalHash();
  assert.equal(actualPhysical, expectedPhysical); assert.deepEqual(deferred.log, eager.log);
  assert.equal(JSON.stringify(captured.finish()), JSON.stringify(expected.finish()));
  const calls = [...deferred.log]; deferred.engine.world.entities.a.pose.p[0] += 100;
  const iterator = captured.steps(); let result = iterator.next(); while (!result.done) result = iterator.next();
  assert.equal(JSON.stringify(result.value), JSON.stringify(expected.finish()));
  assert.deepEqual(deferred.log, calls);
});


test('hidden omitted entity getter retains legacy physical destructuring effects', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const make = () => {
    const engine = factory.create(factory.genesis('hidden-physical-label')); let calls = 0;
    engine.spawnHuman({ id: 'a', label: 'Alice', soul: 's_A' });
    Object.defineProperty(engine.world.entities.a, 'label', { enumerable: false, configurable: true, get() {
      calls++; engine.world.entities.a.pose.p[0] += 1; return 'hidden label';
    } });
    return { engine, calls: () => calls };
  };
  const eager = make(), expected = eager.engine.captureSnapshot!();
  const deferred = make(), captured = deferred.engine.captureCheckpoint!();
  assert.ok('stateHash' in captured); assert.equal(eager.calls(), 0); assert.equal(deferred.calls(), 0);
  assert.equal(deferred.engine.physicalHash(), eager.engine.physicalHash());
  assert.equal(eager.calls(), 1); assert.equal(deferred.calls(), 1);
  assert.equal(JSON.stringify(captured.finish()), JSON.stringify(expected.finish()));
  assert.equal(deferred.calls(), 1);
});


test('hidden physical fallback precedes all native selection with alias eviction inside one hash', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const physics = (n: number) => {
    const facts = { levels: [n], byEntity: { a: { x: n } }, assets: {} };
    return { version: 'entity-physics/1', hash: nativeHash(facts), ...facts };
  };
  const good = physics(8100);
  const make = () => {
    const engine = factory.create(factory.genesis('hidden-physical-alias-eviction'));
    const bad = structuredClone(good); bad.byEntity.a.x = -1;
    // Insertion order differs from lexical order. The first alias uses warm H;
    // four intervening validated selections evict H before the second alias.
    const fixture = { z: bad, e: physics(8104), c: physics(8102), a: bad, d: physics(8103), b: physics(8101) };
    Object.assign(engine.world, { aAliasEviction: fixture }); // sorts before the engine's ordinary physics field
    const region = { id: 'r', kind: 'place', polygon: [[0, 0], [1, 0], [0, 1]] };
    Object.defineProperty(region, 'level', { value: 3 });
    Object.assign(engine.world.regions, { r: region });
    return { engine, fixture };
  };
  const eager = make(), deferred = make();
  const warm = () => { for (let i = 0; i < 5; i++) nativeText(physics(8200 + i)); nativeText(good); };
  warm(); const firstPass = nativeText(eager.fixture);
  assert.equal(JSON.parse(firstPass).a.byEntity.a.x, 8100);
  assert.equal(JSON.parse(firstPass).z.byEntity.a.x, -1);
  assert.notEqual(nativeText(eager.fixture), firstPass, 'a preliminary pin pass would observably alter the next eager hash');
  warm(); const expected = eager.engine.captureSnapshot!(), expectedPhysical = eager.engine.physicalHash();
  const bytes = JSON.stringify(expected.finish());
  warm(); const captured = deferred.engine.captureCheckpoint!();
  assert.ok('stateHash' in captured, 'hidden physical field selects the legacy ticket');
  assert.equal(captured.stateHash, expected.stateHash);
  assert.equal(deferred.engine.physicalHash(), expectedPhysical);
  assert.equal(JSON.stringify(captured.finish()), bytes);
  deferred.fixture.a.byEntity.a.x = -999; warm();
  const iterator = captured.steps(); let result = iterator.next(); while (!result.done) result = iterator.next();
  assert.equal(JSON.stringify(result.value), bytes, 'completion does not repeat native selection');
});
