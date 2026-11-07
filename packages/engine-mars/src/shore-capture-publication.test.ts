import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeSceneCapturePublication,recordedTakeChunkSchema } from '../../protocol/src/index.ts';
import { hashOf,decodeShoreAppearanceSourceV1 } from '@souls/engine-contract';
import { takeIdOf } from '../../../mars/viewer/engine/take/recorder.ts';

test('frozen captured native shore publication pins exact bytes and both complete take/scene pairs',()=>{
  const bytes=readFileSync(new URL('../../../apps/server/test/fixtures/native-shore-capture/journeys.v1.json',import.meta.url));
  assert.equal(bytes.length,1002593);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'60f7b53faa422db22536518a5864b7d9b22deb68808085272297feb0674aecfa');
  const out=JSON.parse(bytes.toString());
  assert.equal(out.contract,'native-shore-capture-fixture/1');assert.equal(out.paidSpendUSD,0);assert.equal(out.journeys.length,2);
  const expected={shore:{ticks:604,hash:'ebbfb980ed98a96ed0f17c8858a288d44baa90c5195f7257fe65bc7c0a40d43d'},
    boat:{ticks:2900,hash:'dc9dc277fa37e0006edb9153ee6122e77706335af7d48d0a46a23770459818d8'}};
  for(const j of out.journeys){
    const kind=j.kind as keyof typeof expected;assert.ok(expected[kind]);
    const capture=decodeSceneCapturePublication(j.capture),chunk=recordedTakeChunkSchema.parse(j.chunk);
    assert.equal(capture.worldId,j.worldId);assert.equal(capture.ref.hash,expected[kind].hash);
    assert.equal(chunk.take.ticks,expected[kind].ticks);assert.deepEqual(chunk.take,j.recording.take);
    assert.deepEqual(chunk.take.renderSceneRef,capture.ref);assert.equal(chunk.take.rulesVersion,capture.ref.rulesVersion);
    assert.equal(chunk.take.schema,'mars-take/4');
    // The protocol also supports historical take schemas. This frozen native
    // recording has the current recorder shape, already equal to its decoded chunk.
    assert.equal(takeIdOf(j.recording.take),chunk.take.id);assert.deepEqual(capture.body.shore!.physicalBase,j.recording.physicalBase);
    const legacy=JSON.parse(readFileSync(new URL('../../../apps/server/test/fixtures/native-'+kind+'/journey.v1.json',import.meta.url),'utf8'));
    assert.equal(j.recording.finalStateHash,legacy.finalStateHash);assert.deepEqual(j.recording.inputs,legacy.inputs);
    const {id,renderSceneRef,...take}=chunk.take,{id:oldId,renderSceneRef:oldRef,...old}=legacy.take;
    assert.deepEqual(take,old);assert.equal(oldRef,undefined);assert.notEqual(id,oldId);
    if(kind==='boat'){
      const boat=capture.body.shore!.boat!;
      assert.deepEqual(boat.layout,j.recording.layout);
      assert.equal((decodeShoreAppearanceSourceV1(boat.appearance) as any).boat.id,boat.layout.boatId);
    }
    const before=hashOf(j);decodeSceneCapturePublication(j.capture);recordedTakeChunkSchema.parse(j.chunk);assert.equal(hashOf(j),before);
    assert.throws(()=>decodeSceneCapturePublication({...j.capture,body:{...j.capture.body,shore:{...j.capture.body.shore,privatePurpose:'PRIVATE'}}}));
    assert.throws(()=>decodeSceneCapturePublication({...j.capture,body:{...j.capture.body,shore:{...j.capture.body.shore,water:{...j.capture.body.shore.water,datumY:42}}}}));
  }
});
