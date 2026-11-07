import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateInstalledCommons } from '../test/fixtures/dry-commons/generate-installed.ts';
import { parseRenderSceneCapture, commonsSceneMetadataV1Schema } from '@souls/engine-contract';
import { decodeSceneCapturePublication, recordedTakeHistorySchema, scenePublicationSchema } from '@souls/protocol';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import { takeIdOf } from '../../../mars/viewer/engine/take/recorder.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';

test('owned native commons journey publishes original take/support captures and reconstructs from SQLite and genesis',async()=>{
 const f=await generateInstalledCommons();
 assert.deepEqual(f,JSON.parse(readFileSync(new URL('../test/fixtures/dry-commons/installed-commons.v1.json',import.meta.url),'utf8')));
 assert.equal(f.contract,'core-installed-commons-fixture/1');assert.equal(f.positions.length,1461);
 assert.equal(f.reconstruction.snapshot,'exact');assert.equal(f.reconstruction.hostGenesis,'exact');assert.equal(f.reconstruction.inclusiveGenesis,'exact');
 assert.deepEqual(f.checkpoints.map((c:{activity:string})=>c.activity),['walk','sit','climb-up','climb-down']);
 assert.equal(f.faultCount,0);assert.equal(f.paid,0);assert.deepEqual(f.violations,[]);
 for(const c of f.captures){const {worldId,...capture}=c;assert.equal(worldId,f.worldId);assert.deepEqual(parseRenderSceneCapture(capture),capture);assert.match(c.ref.rulesVersion,/\+commons\/1$/);}
 assert.equal(f.stream.chunks.length,73);assert.equal(f.stream.next,null);
 assert.deepEqual(f.positions[220].p,[9,0,5]);assert.equal(f.positions[720].activity,'sit');
 assert.deepEqual(f.positions[1100].p,[9,.24,-1.8]);assert.equal(f.positions[1100].level,1);assert.deepEqual(f.positions[1460].p,[9,0,5]);
 assert.equal(JSON.stringify({scene:f.scene,stream:f.stream,captures:f.captures,snapshot:f.snapshot,kernel:f.kernel}).includes('PRIVATE_INSTALLED_COMMONS'),false);
});

test('frozen installed commons recording remains source-independent and address-bound to the physical layout',()=>{
 const path=new URL('../test/fixtures/dry-commons/installed-commons.v1.json',import.meta.url),bytes=readFileSync(path),f=JSON.parse(bytes.toString());
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'47280a18bebe7a587e08dbe4da4f6d3b67ef30a300cba582fd4557639383fadf');
 assert.equal(f.producer.worldSource,'9b6db72fc2dcf45a762d7ce8e4db0b71d0418ea8');
 assert.deepEqual(f.scene.scene.commons.layout.map((p:{id:string})=>p.id),['commons-pavilion','commons-platform','commons-bench-west','commons-bench-east','commons-table']);
 for(const capture of f.captures){const {worldId,...body}=capture;assert.equal(worldId,f.worldId);parseRenderSceneCapture(body);}
 const refs=new Set(f.captures.map((c:{ref:{hash:string}})=>c.ref.hash));
 for(const chunk of f.stream.chunks)assert.ok(refs.has(chunk.take.renderSceneRef.hash));
 assert.equal(f.actor.owner,'fake-local human association verified in SQLite');
 assert.deepEqual(commonsSceneMetadataV1Schema.parse(f.scene.scene.commons),f.scene.scene.commons);
 for(const malformed of [
  {...f.scene.scene.commons,privateJournal:'private'},
  {...f.scene.scene.commons,layout:[...f.scene.scene.commons.layout,{...f.scene.scene.commons.layout[0]}]},
  {...f.scene.scene.commons,layout:f.scene.scene.commons.layout.map((p:object,i:number)=>i? p:{...p,p:[9,NaN,-5]})},
 ])assert.equal(commonsSceneMetadataV1Schema.safeParse(malformed).success,false);
 scenePublicationSchema.parse(f.scene);recordedTakeHistorySchema.parse(f.stream);
 for(const capture of f.captures)decodeSceneCapturePublication(capture);
 const chunks=f.stream.chunks as {fromTick:number;toTick:number;take:Take}[];
 for(const chunk of chunks)assert.equal(takeIdOf(chunk.take),chunk.take.id);
 for(const actual of f.positions){
  const chunk=chunks.find(c=>actual.tick>=c.fromTick&&actual.tick<c.toTick)??chunks.at(-1)!;
  const sample=sampleTake(chunk.take,(actual.tick-chunk.fromTick)*chunk.take.dt).entities[f.actor.entityId];
  if(actual.tick===0){assert.equal(sample,undefined);continue;}
  assert.ok(sample,`native body at${actual.tick}`);
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs(sample.p[axis]-actual.p[axis])<=.0045,`native recorded root ${actual.tick}, axis${axis}`);
 }
 // Scene changes must not silently replace the earlier empty Greenfield take.
 const old=JSON.parse(readFileSync(new URL('../test/fixtures/dry-commons/flat-commons.v1.json',import.meta.url),'utf8'));
 assert.notEqual(f.captures[0].ref.hash,old.captures[0].ref.hash);
 assert.equal(old.scope.includes('no commons-kit installation'),true);
});
