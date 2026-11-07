import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authoredBoundaryDeclarationV1,hashOf} from '@souls/engine-contract';
import {stringifyTakeBoundaryWireV1,TAKE_BOUNDARY_WIRE_V1} from '@souls/protocol';
import {historyTakePage,historyTakePath} from '../src/WorldTakeTransport.ts';
import {sampleTake,replayFinalState} from '../../../mars/viewer/engine/take/replay.ts';

const fact={...authoredBoundaryDeclarationV1('history-ingress-fixture',Array.from({length:4},(_,i)=>({id:'wall-'+i,buildingId:'room',kind:'wall',c:[i*3,1,0],half:[.1,1,2],yaw:0}))),acceptedAtTick:1};
function chunk(startTick:number){
 const finalState={tick:startTick+20,entities:{a:{id:'a',def:'human',kind:'human',p:[1,0,2]}},authoredBoundariesV1:fact};
 return{fromTick:startTick,toTick:startTick+20,take:{schema:'mars-take/4',id:'take-'+startTick,baselineStateHash:hashOf('before-'+startTick),finalStateHash:hashOf(finalState),rulesVersion:'fixture/1',keyframeEvery:20,startTick,ticks:20,dt:.05,tracks:{a:[[0,0,0,2000,0],[20,1000,0,2000,0]]},changes:[[0,'a','present',true],[0,'a','activity','walk']],events:[],finalState}};
}
const response=()=>({serverTick:80,chunks:[chunk(40),chunk(0),chunk(20),chunk(20)],next:60});
function packed(){const wire=JSON.parse(stringifyTakeBoundaryWireV1(response()));assert.equal(wire.contract,TAKE_BOUNDARY_WIRE_V1,'fixture exercises an actual compressed dictionary');return wire;}
void test('actual history ingress accepts an old raw reply and restores exact complete endings before normal replay',()=>{
 const raw=response(),before=JSON.stringify(raw),old={chunks:raw.chunks,next:raw.next};const legacy=historyTakePage(old),encoded=historyTakePage(packed());
 assert.deepEqual(encoded,legacy);assert.deepEqual(encoded.chunks.map(c=>c.fromTick),[0,20,40]);assert.equal(encoded.next,60);assert.equal(JSON.stringify(raw),before);
 for(const take of encoded.chunks.map(c=>c.take)){assert.equal(hashOf(replayFinalState(take)),take.finalStateHash);assert.deepEqual(sampleTake(take,.4),sampleTake(legacy.chunks.find(c=>c.fromTick===take.startTick)!.take,.4));assert.deepEqual(take.finalState.authoredBoundariesV1,fact);}
});
void test('malformed or absent wire references fail synchronously before a partial history page can reach replay',()=>{
 const bad=packed();bad.payload.chunks[1].take.finalState.authoredBoundariesV1.$takeBoundaryFactV1='0'.repeat(64);assert.throws(()=>historyTakePage(bad),/take-boundary-wire.invalid: unknown reference/);
 const corrupt=packed();corrupt.facts[0].value.boxes[0].c[0]=99;assert.throws(()=>historyTakePage(corrupt),/take-boundary-wire.invalid:/);assert.deepEqual(historyTakePage(packed()).chunks.map(c=>c.fromTick),[0,20,40],'a failed page creates no cross-request dictionary fallback');
});
void test('paged history preserves prior sorting/dedup and pagination boundaries, with transport selection only',()=>{
 const url=new URL(historyTakePath(21.8,81.2,500),'http://fixture.test');assert.equal(url.pathname,'/v1/takes');assert.equal(url.searchParams.get('from'),'21');assert.equal(url.searchParams.get('to'),'82');assert.equal(url.searchParams.get('limit'),'120');assert.equal(url.searchParams.get('takeTransport'),TAKE_BOUNDARY_WIRE_V1);assert.ok(url.search.includes('take-boundary-facts%2F1'));
 const first=historyTakePage(packed()),nextResponse={serverTick:100,chunks:[chunk(80),chunk(60)],next:null},second=historyTakePage(JSON.parse(stringifyTakeBoundaryWireV1(nextResponse)));
 assert.equal(first.next,60);assert.equal(second.next,null);assert.deepEqual([...first.chunks,...second.chunks].map(c=>c.fromTick),[0,20,40,60,80]);
});
void test('hydrated history chunks own independent facts and preserve unchanged single-chunk raw fallback',()=>{
 const page=historyTakePage(packed());const a=page.chunks[0].take.finalState.authoredBoundariesV1 as typeof fact,b=page.chunks[1].take.finalState.authoredBoundariesV1 as typeof fact;a.boxes[0].c[0]=123;assert.equal(b.boxes[0].c[0],0);assert.equal(fact.boxes[0].c[0],0);
 const one={serverTick:20,chunks:[chunk(0)],next:null},wire=JSON.parse(stringifyTakeBoundaryWireV1(one));assert.equal(wire.t,undefined);assert.deepEqual(historyTakePage(wire),historyTakePage(one));
});
