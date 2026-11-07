import test from 'node:test';
import assert from 'node:assert/strict';
import { hashOf, physicalView } from '@souls/engine-contract';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';

test('native physical digest retains contract bytes through live changes and snapshot restore', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const engine = factory.create(factory.genesis('physical-digest'));
  engine.spawnHuman({ id: 'h_é🌍', label: 'Unicode', soul: 's_A' });
  engine.spawnHuman({ id: 'h_\ud800', label: 'Lone surrogate', soul: 's_B' });
  const first = engine.physicalHash();
  assert.equal(first, hashOf(physicalView(engine.world)));
  // Physical state includes pose/support and IDs, but excludes labels/tags.
  const body = engine.world.entities['h_é🌍'];
  body.label = 'different'; body.tags = ['different'];
  assert.equal(engine.physicalHash(), first);
  body.pose.p[0] = -0; body.pose.yaw = -.25;
  body.pose.p[2] += 1;
  const changed = engine.physicalHash();
  assert.equal(changed, hashOf(physicalView(engine.world)));
  assert.notEqual(changed, first);
  const restored = factory.restore(engine.snapshot());
  assert.equal(restored.physicalHash(), changed);
  restored.step();
  assert.equal(restored.physicalHash(), hashOf(physicalView(restored.world)));
});

test('native physical digest retains serializer refusal for non-finite physical data', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const engine = factory.create(factory.genesis('physical-refusal'));
  engine.spawnHuman({ id: 'h_A', label: 'Alice', soul: 's_A' });
  engine.world.entities.h_A.pose.p[0] = Infinity;
  assert.throws(() => hashOf(physicalView(engine.world)), /stableStringify: non-finite number/);
  assert.throws(() => engine.physicalHash(), /stableStringify: non-finite number/);
});
