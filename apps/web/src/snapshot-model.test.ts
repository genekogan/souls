import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, coreLibrary, type Entity } from '@sim/world-compiler';
import { snapshotModel } from './snapshot-model.ts';

function snapshot() {
  const original = new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'model' });
  original.library = coreLibrary(); original.adopt('core/barrel@1');
  original.seq = 1024; original.editSeq = 9;
  for (let i = 0; i < 1024; i++) original.insert({ id: `e_${String(i).padStart(4, '0')}`, name: `barrel-${i}`, def: 'core/barrel@1', in: { parent: i % 2 ? 'e_0000' : 'world' }, p: [i, 0, 0], r: 0, s: 1, params: {}, seed: 1, by: 'fixture', born: 0, v: 1 } satisfies Entity);
  return original.snapshot();
}

test('sliced loading preserves model records, ref bindings, names, children and lazy index behavior', async t => {
  const snap = snapshot(), ordinary = WorldModel.fromSnapshot(snap, undefined, undefined, { lazyIndex: true });
  let clock = 0, yields = 0; t.mock.method(performance, 'now', () => clock += 10);
  const sliced = await snapshotModel(snap, new AbortController().signal, async () => { yields++; });
  assert.equal(yields, 3); assert.deepEqual(sliced.snapshot(), ordinary.snapshot());
  assert.deepEqual(sliced.children, ordinary.children); assert.deepEqual(sliced.names, ordinary.names);
  assert.equal(sliced.get('barrel-0/barrel-1')?.id, ordinary.get('barrel-0/barrel-1')?.id);
  assert.equal(sliced.hasIndex, false); assert.equal(ordinary.hasIndex, false);
  // The lazy index is built from the populated model, even though its constructor received no entities.
  assert.deepEqual([...sliced.solidRegionCounts()], [...ordinary.solidRegionCounts()]);
  assert.deepEqual([...sliced.entities.keys()].map(id => sliced.footprintsOf(id)), [...ordinary.entities.keys()].map(id => ordinary.footprintsOf(id)));
  assert.ok(sliced.footprintsOf('e_0000').length > 0);
  assert.equal(sliced.hasIndex, true);
});

test('an abort between insertion slices rejects instead of publishing a partial model', async t => {
  let clock = 0; t.mock.method(performance, 'now', () => clock += 10);
  const controller = new AbortController(); let yields = 0;
  await assert.rejects(snapshotModel(snapshot(), controller.signal, async () => { yields++; controller.abort(); }), { name: 'AbortError' });
  assert.equal(yields, 1);
});
