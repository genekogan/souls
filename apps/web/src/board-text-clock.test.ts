// Entry 13: a Soul's board text, like a lamp, waits for the depicted contact tick; owner edits stay immediate.
import test from 'node:test';import assert from 'node:assert/strict';
import {WorldModel,coreLibrary,applyBatch} from '@souls/world-compiler';import {lightDiffAhead} from './light-diff-clock.ts';
test('engine board text waits for the depicted stroke end; owner text does not',()=>{
 const model=new WorldModel({constants:{ground:'land',extent:350},seed:'board'});model.library=coreLibrary();
 assert.equal(applyBatch(model,{ops:[{op:'place',def:'core/whiteboard@1',name:'wb',p:[0,0]},{op:'place',def:'core/chalkboard@1',name:'cb',p:[3,0]}]},'god',1).result.accepted,true);
 const wb=model.get('wb')!,cb=model.get('cb')!,msg=(e:typeof wb,by:string)=>({by,tick:200,diff:{upserts:[{...e,state:{...e.state,text:'hello'}}]}});
 assert.equal(lightDiffAhead(model,msg(wb,'engine'),199),true);assert.equal(lightDiffAhead(model,msg(wb,'engine'),200),false);
 assert.equal(lightDiffAhead(model,msg(wb,'god'),0),false,'owner edits stay immediate');assert.equal(lightDiffAhead(model,msg(cb,'engine'),0),false,'frozen v1 sign is not a contact board');
});
