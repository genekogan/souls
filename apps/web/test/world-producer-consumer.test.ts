// Counterpart to exact Core producer pin eb1740d (locally adopted with -x).
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPresentationFixtures } from '../../server/test/fixtures/w.ts';
import { recordedTakeStreamSchema, scenePublicationSchema } from '@souls/protocol';
import { hashOf } from '@souls/engine-contract';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import { floaterBodiesOfTake } from '../../../mars/viewer/engine/bodies/index.ts';
import { validChunks, chunkAt, parseSceneInfo, WorldGeometry, mergeWindow, MAX_PAST_CHUNKS, recordingTick } from '../src/WorldGeometry.ts';

const fixtures = worldPresentationFixtures();
test('real four-world Core JSON fixtures feed the actual World decoder, geometry and historic lifecycle', async () => {
  for (const f of await fixtures) {
    const before = hashOf(f), stream = recordedTakeStreamSchema.parse(f.stream);
    scenePublicationSchema.parse(f.scene);
    const chunks = validChunks(stream.chunks), info = parseSceneInfo(f.scene);
    assert.equal(chunks.length, stream.chunks.length, f.key);
    const lifecycle = chunks.find(c => c.take.removed?.some(r => r.id === f.entityId))!;
    assert.ok(lifecycle.fromTick > 0);
    const remove = lifecycle.take.removed!.find(r => r.id === f.entityId)!;
    const wanted = lifecycle.fromTick + remove.t - 1;
    const picked = chunkAt(chunks, wanted)!;
    assert.equal(picked.exact, true);
    const localSeconds = (recordingTick(picked.chunk, wanted) - picked.chunk.take.startTick) * picked.chunk.take.dt;
    const frame = sampleTake(picked.chunk.take, localSeconds);
    assert.ok(frame.entities[f.entityId], f.key + ' historical actor exists');
    assert.equal(sampleTake(lifecycle.take, remove.t * lifecycle.take.dt).entities[f.entityId], undefined);
    assert.equal(floaterBodiesOfTake(lifecycle.take).size > 0, f.key === 'littlemartians');
    const geometry = new WorldGeometry(info.scene, info.ground);
    try {
      const publicViewerInput = JSON.stringify({ scene: info, chunks, frame, geometry: geometry.group.toJSON() });
      assert.equal(publicViewerInput.includes(f.marker), false, f.key + ' private marker never sent into viewer');
      assert.equal(JSON.stringify(f.owner).includes(f.marker), true, 'fixture actually contains private owner state');
      const replay = sampleTake(picked.chunk.take, localSeconds);
      assert.deepEqual(replay, frame);
    } finally { geometry.dispose(); }
    assert.equal(hashOf(f), before, 'consumer leaves producer/private fixture untouched');
  }
});

test('real producer duplicates, shared boundaries and gaps retain documented bounded sampling semantics', async () => {
  const f = (await fixtures).find(f => f.key === 'eden')!;
  const all = validChunks((f.stream as { chunks: unknown[] }).chunks);
  const [a,b,c] = all; assert.ok(c);
  assert.equal(chunkAt(all, b.fromTick)!.chunk, b, 'latest-start chunk owns the shared endpoint and its scene era');
  assert.equal(chunkAt([c,b,a], b.fromTick)!.chunk, b, 'boundary ownership is independent of input order');
  assert.equal(chunkAt(all, b.fromTick)!.exact, true);
  const deduped = validChunks([c,a,b,a]); assert.equal(deduped.length, all.length);
  const gap = chunkAt([a,c], b.fromTick + 5)!;
  assert.equal(gap.exact, false);
  assert.equal(recordingTick(gap.chunk, b.fromTick + 5), a.toTick, 'held image is labelled with recorded end, not missing requested tick');
  assert.equal(recordingTick(a,-5), a.fromTick);
  assert.equal(mergeWindow(all,all,25,2).length,2);
  assert.equal(mergeWindow(all,all,25).length <= MAX_PAST_CHUNKS,true);
});

test('actual World consumer refuses unknown schema, mismatched origin and nonfinite pose quanta', async () => {
  const good = validChunks(((await fixtures)[0].stream as { chunks: unknown[] }).chunks)[0];
  assert.equal(validChunks([{...good,fromTick:good.fromTick+1}]).length,0);
  assert.equal(validChunks([{...good,take:{...good.take,schema:'unqualified/9'}}]).length,0);
  assert.equal(validChunks([{...good,take:{...good.take,tracks:{a:[[0,NaN,0,0,0]]}}}]).length,0);
  assert.equal(validChunks([good]).length,1);
  for (const schema of ['mars-take/1','mars-take/2','mars-take/3']) {
    const take = { ...good.take, schema }; delete take.entities0; delete take.removed;
    assert.equal(validChunks([{ ...good, take }]).length,1, 'synthetic optional-shape compatibility only');
  }
});
