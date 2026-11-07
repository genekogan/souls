import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashOf } from '@souls/engine-contract';
import { recordedTakeHistorySchema, recordedTakeChunkSchema, scenePublicationSchema, decodeSceneCapturePublication } from '@souls/protocol';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import { takeIdOf } from '../../../mars/viewer/engine/take/recorder.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import { generateDryCommons, COMMONS_ENTITY, COMMONS_PRIVATE } from '../test/fixtures/dry-commons/generate.ts';

const fixture=JSON.parse(readFileSync(new URL('../test/fixtures/dry-commons/flat-commons.v1.json',import.meta.url),'utf8'));

test('owned native flat commons decision reproduces serialized anonymous scene/takes after SQLite close/reopen and model-free replay',async()=>{
  assert.deepEqual(await generateDryCommons(),fixture);
  scenePublicationSchema.parse(fixture.scene);recordedTakeHistorySchema.parse(fixture.stream);
  assert.equal(fixture.stream.serverTick,200);assert.equal(fixture.stream.next,null);
  assert.equal(fixture.stream.chunks.length,10);assert.equal(fixture.captures.length,1);
  assert.deepEqual(fixture.scene.scene.bounds,[-30,-30,30,30]);assert.deepEqual(fixture.scene.scene.obstacles,[]);
  assert.deepEqual(fixture.scene.scene.links,[]);assert.deepEqual(fixture.scene.scene.levels,[{id:0,y:0,label:'green field'}]);
  assert.equal(fixture.snapshot.entities[COMMONS_ENTITY].human.soul,fixture.actor.soulId);
  assert.equal(fixture.kernel.things[fixture.actor.soulId].traits.body,COMMONS_ENTITY);
  assert.equal(JSON.stringify(fixture).includes(COMMONS_PRIVATE),false);
  assert.equal(fixture.paid,0);assert.equal(fixture.faultCount,0);assert.deepEqual(fixture.violations,[]);
  assert.equal(fixture.reconstruction.snapshot,'exact');assert.equal(fixture.reconstruction.inclusiveGenesis,'exact');
  assert.equal(fixture.reconstruction.movingNativeCheckpoint.tick,40);
  assert.equal(fixture.reconstruction.movingNativeCheckpoint.continuation,'exact at every tick');
});

test('runtime-free takes retain the birth boundary and native roots at every recorded integer tick without rewriting scene or movement',()=>{
  const before=JSON.stringify(fixture),chunks=fixture.stream.chunks as {fromTick:number;toTick:number;take:Take}[];
  for(let i=0;i<chunks.length;i++){
    const chunk=chunks[i];recordedTakeChunkSchema.parse(chunk);assert.equal(chunk.fromTick,i*20);assert.equal(chunk.toTick,(i+1)*20);
    assert.equal(takeIdOf(chunk.take),chunk.take.id);assert.equal(hashOf(chunk.take.finalState),chunk.take.finalStateHash);
    const capture=fixture.captures.find((c:any)=>c.ref.hash===chunk.take.renderSceneRef!.hash);
    assert.ok(capture);decodeSceneCapturePublication(capture);assert.equal(capture.worldId,fixture.worldId);
    assert.equal(chunk.take.rulesVersion,capture.ref.rulesVersion);assert.equal(fixture.scene.renderSceneRef.hash,capture.ref.hash);
  }
  let moved=0;
  for(const actual of fixture.positions){
    const chunk=chunks.find(c=>actual.tick>=c.fromTick&&actual.tick<c.toTick)??chunks.at(-1)!;
    const sample=sampleTake(chunk.take,(actual.tick-chunk.fromTick)*chunk.take.dt).entities[COMMONS_ENTITY];
    if(actual.tick===0){assert.equal(sample,undefined,'recorder has not yet published the canonical birth');
      assert.deepEqual(fixture.initialSnapshot.entities[COMMONS_ENTITY].pose.p,actual.p);continue;}
    assert.ok(sample,`body at tick ${actual.tick}`);
    for(let axis=0;axis<3;axis++)assert.ok(Math.abs(sample.p[axis]-actual.p[axis])<=.0045,`4.5mm pose bound tick${actual.tick} axis${axis}`);
    assert.equal(actual.p[1],0);assert.equal(sample.p[1],0);
    if(actual.activity==='walk')moved++;
  }
  assert.ok(moved>20,'actual native walk frames, not assigned doing text');
  assert.deepEqual(fixture.positions[0].p,[14,0,4]);
  const end=fixture.positions.at(-1).p;assert.ok(Math.hypot(end[0]-9,end[2]-5)<.1);
  assert.ok(Math.hypot(end[0]-14,end[2]-4)>5);
  assert.equal(JSON.stringify(fixture),before,'take/scene replay cannot mutate its inputs');
});
