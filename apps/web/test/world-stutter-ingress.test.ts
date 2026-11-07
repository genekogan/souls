import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureRenderScene} from '@souls/engine-contract/scene-capture';
import {recordedTakeChunkSchema} from '@souls/protocol';
import {ownLiveChunk,ownedLiveChunk} from '../src/owned-live-chunks.ts';
import {validChunks,chunkAt} from '../src/WorldGeometry.ts';
import {sampleTake} from '../../../mars/viewer/engine/take/replay.ts';
import {recordedBody} from '../../../mars/viewer/app/engine-view/recorded-body.ts';
import {optionalAppearanceProfilesForVerifiedCapture,ALL_OPTIONAL_APPEARANCE_PROFILES} from '../src/optional-appearance-profiles.ts';
import {CURRENT_UNDERSTORY_CAPTURE_HASHES,LIVE_NATIVE_SOCIAL_CAPTURE_HASHES,inspectCurrentProvisionsUnderstory} from '../../../mars/viewer/app/engine-view/content/environment/current-provisions-understory/current.mjs';
const body={family:'floater',type:'ceramic',model:'verdelis',radius:.5,hoverHeight:1};
const fixture=(from=0)=>({fromTick:from,toTick:from+20,take:{schema:'mars-take/4',id:'t'+from,baselineStateHash:'start',finalStateHash:'end',rulesVersion:'test/1',keyframeEvery:5,startTick:from,ticks:20,dt:.05,tracks:{a:[[0,0,0,0,0],[20,2000,0,0,0]]},changes:[[0,'a','present',true],[0,'a','body',null],[10,'a','body',body],[18,'a','body',null]],events:[],entities0:{a:{body:null}},finalState:{entities:{a:{body:null}}}}});
test('owned ingress retains actual old parsed moment when a new window arrives; mutable input remains fresh',()=>{
 const raw=fixture(),first=ownLiveChunk(raw)!;assert.ok(first);assert.deepEqual(first,recordedTakeChunkSchema.parse(raw));
 const before=validChunks([first]);const next=ownLiveChunk(fixture(20))!;const after=validChunks([first,next]);
 assert.equal(after[0],before[0]);assert.equal(chunkAt(after,5)!.chunk,before[0]);assert.equal(chunkAt(after,25)!.chunk,after[1]);
 assert.equal(ownedLiveChunk(raw),null);assert.notEqual(validChunks([raw])[0],validChunks([raw])[0]);
 assert.notEqual(ownLiveChunk(raw),first,'mutable caller is not a cache key');
});
test('detached frozen data isolates producer mutations and retains recorded body/null boundary animation',()=>{
 const raw=fixture(),owned=ownLiveChunk(raw)!;assert.ok(Object.isFrozen(owned.take.changes));
 const at=(tick:number)=>recordedBody(null,sampleTake(owned.take as never,tick*.05).entities.a.state);
 assert.equal(at(5),null);assert.deepEqual(at(15),body);assert.equal(at(19),null);
 raw.take.tracks.a[1][1]=9000;raw.take.changes[2][3]={...body,model:'changed'} as never;
 assert.equal(sampleTake(owned.take as never,1).entities.a.p[0],2);
 assert.deepEqual(at(15),body);const changed=ownLiveChunk(raw)!;assert.notEqual(changed,owned);assert.equal(sampleTake(changed.take as never,1).entities.a.p[0],9);
});
test('new capture/version/body chunks are independently parsed; malformed and forged frozen values never gain brand',()=>{
 const raw=fixture(),old=ownLiveChunk(raw)!;const changed={...raw,take:{...raw.take,rulesVersion:'test/2',renderSceneRef:{contract:'render-scene-ref/1',rulesVersion:'test/2',hash:'b'.repeat(64)}}};
 const current=ownLiveChunk(changed)!;assert.notEqual(current,old);assert.equal(current.take.rulesVersion,'test/2');
 changed.take.renderSceneRef.rulesVersion='wrong';assert.equal(ownLiveChunk(changed),null);
 assert.equal(ownLiveChunk({fromTick:0,toTick:21,take:raw.take}),null);
 assert.equal(ownedLiveChunk(Object.freeze(fixture())),null);
});
test('wire ownership rejects hostile data without evaluating getters or retaining mutable aliases',()=>{
 let reads=0;const raw=fixture();Object.defineProperty(raw.take.finalState.entities,'hostile',{enumerable:true,get(){reads++;throw Error('getter');}});
 assert.equal(ownLiveChunk(raw),null);assert.equal(reads,0);
 const hidden=fixture();Object.defineProperty(hidden.take.finalState.entities.a,'hidden',{value:{nested:[1]},enumerable:false});const owned=ownLiveChunk(hidden)!;assert.ok(Object.isFrozen((owned.take.finalState.entities.a as {hidden:{nested:unknown}}).hidden.nested));
 const proxy=new Proxy(fixture(),{getOwnPropertyDescriptor(){throw Error('proxy');}});assert.equal(ownLiveChunk(proxy),null);
});
test('verified capture alone enables incompatible-profile fast rejection; forged hash/world/body uses full guard path',()=>{
 const capture=captureRenderScene('test/1',{scene:{bounds:[-1,-1,1,1],levels:[],surfaces:[],obstacles:[],links:[]}}),publication={worldId:'world',...capture};
 assert.deepEqual(optionalAppearanceProfilesForVerifiedCapture(publication,'world',capture.ref),{understory:false,nativeSocial:false});
 assert.equal(optionalAppearanceProfilesForVerifiedCapture(publication,'other',capture.ref),ALL_OPTIONAL_APPEARANCE_PROFILES);
 publication.body.scene={bounds:[-2,-1,1,1]};assert.equal(optionalAppearanceProfilesForVerifiedCapture(publication,'world',capture.ref),ALL_OPTIONAL_APPEARANCE_PROFILES);
 for(const hash of CURRENT_UNDERSTORY_CAPTURE_HASHES){
  const forged={...publication,ref:{...capture.ref,hash}};
  assert.equal(optionalAppearanceProfilesForVerifiedCapture(forged,'world',forged.ref),ALL_OPTIONAL_APPEARANCE_PROFILES,'eligible hash alone cannot bypass guards');
 }
 assert.equal(CURRENT_UNDERSTORY_CAPTURE_HASHES.length,5);assert.deepEqual(LIVE_NATIVE_SOCIAL_CAPTURE_HASHES,[CURRENT_UNDERSTORY_CAPTURE_HASHES[3],CURRENT_UNDERSTORY_CAPTURE_HASHES[4]]);
 const hostile=Object.defineProperty({},'ref',{get(){throw Error('getter must not execute');}});
 assert.throws(()=>inspectCurrentProvisionsUnderstory(hostile,null,{enabled:true}),/Current accessor refused/);
});
test('malformed/accessor/proxy capture or reference uses full original guards without invoking getters',()=>{
 let reads=0;const ref={contract:'render-scene-ref/1',rulesVersion:'known'};Object.defineProperty(ref,'hash',{get(){reads++;return 'a'.repeat(64);}});
 assert.equal(optionalAppearanceProfilesForVerifiedCapture(null,'world',ref),ALL_OPTIONAL_APPEARANCE_PROFILES);assert.equal(reads,0);
 assert.equal(optionalAppearanceProfilesForVerifiedCapture(new Proxy({},{getOwnPropertyDescriptor(){throw Error('proxy');}}),'world',{}),ALL_OPTIONAL_APPEARANCE_PROFILES);
 assert.equal(optionalAppearanceProfilesForVerifiedCapture({},'world',{hash:'invalid'}),ALL_OPTIONAL_APPEARANCE_PROFILES);
});
