import test from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { recordedToyFactory } from './toy-takes.ts';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';

test('Toy recording preserves original motion, outputs, hashes and exact restart', () => {
  const plain = toyFactory.create(toyFactory.genesis('recording-proof'));
  let observed = recordedToyFactory.create(recordedToyFactory.genesis('recording-proof'));
  for (const engine of [plain, observed]) {
    engine.spawnHuman({ id: 'person', label: 'Person', soul: 's_person' });
    engine.perform({ actor: 'person', label: 'walk across Toy', steps: [{ verb: 'walk_to', params: { to: [8, 24] } }] });
  }
  let poses = 0;
  for (let i = 0; i < 800; i++) {
    assert.deepEqual(observed.step(), plain.step());
    assert.equal(observed.stateHash(), plain.stateHash());
    assert.equal(observed.physicalHash(), plain.physicalHash());
    if (i === 199) {
      const snap = observed.snapshot(); assert.deepEqual(snap, plain.snapshot());
      observed = recordedToyFactory.restore(snap);
    }
    const chunk = observed.takeChunks!(-1).at(-1);
    if (chunk?.toTick === observed.world.tick) {
      const take = chunk.take as Take;
      assert.deepEqual(sampleTake(take, take.ticks * take.dt).entities.person.p,
        plain.world.entities.person.pose.p.map(n => Math.round(n * 1000) / 1000));
      assert.deepEqual(take.finalState, plain.world); poses++;
    }
  }
  assert.ok(poses >= 30, 'actual moving and settled server recordings');
  assert.equal(observed.takeChunks!(-1).length, 12, 'bounded hot recording window');
  assert.deepEqual(observed.runtime.violations, []);
});
