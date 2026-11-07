// Actual owner HTTP/SQLite/native compiler path; synthetic model output only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {INTENT_V2,intentReceiptV2Schema} from '@souls/protocol';
import type {CompileOut} from '@souls/brain';
import {intentNativeFixture} from '../test/intent-native-fixture.ts';
const proposed=(target:string|null):CompileOut=>({understood:true,agenda:[{card:'go to',target}],alignment:{understanding:'Walk to the pavilion.',trigger:{kind:'now'}}});
type F=ReturnType<typeof intentNativeFixture>;
async function drive<T>(f:F,p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){f.host.drainInputs();await setImmediate();}assert.ok(done);return p;}

test('ordinary retained direction refuses invented destination without broadening, minting or native motion',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true,proposed('pavilion')),initial=f.host.engine.stateHash(),decks=JSON.stringify(f.host.kernel.decks),cards=JSON.stringify(f.host.kernel.vocab.cards);
  const response=await drive(f,f.post({contract:INTENT_V2,requestId:'unresolved-place',op:'upsert',words:'go to the pavilion'}));assert.equal(response.status,202);await drive(f,f.service.settled());
  const terminal=intentReceiptV2Schema.parse(await (await f.lookup('unresolved-place')).json());assert.equal(terminal.phase,'refused');
  assert.equal(f.calls,1);assert.equal(Object.keys(f.host.intentHistoryOf('s_A').intents).length,0);assert.equal(Object.keys(f.host.intentHistoryOf('s_A').attempts).length,0);
  assert.equal(f.host.engine.stateHash(),initial);assert.equal(JSON.stringify(f.host.kernel.decks),decks);assert.equal(JSON.stringify(f.host.kernel.vocab.cards),cards);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision'||e.kind==='intent-admission-v2'||e.kind==='intent-controller-v2').length,0);assert.equal(f.db.paidCost(),0);
  const retry=await drive(f,f.post({contract:INTENT_V2,requestId:'unresolved-place',op:'upsert',words:'go to the pavilion'}));assert.equal(retry.status,200);assert.equal(f.calls,1);assert.deepEqual(intentReceiptV2Schema.parse(await retry.json()),terminal);
});

test('known exact destination remains understood; an explicit any-target model choice remains distinct',async t=>{
  for(const target of ['campfire',null])await t.test(String(target),async child=>{
    const f=intentNativeFixture(child,':memory:',true,false,proposed(target));await drive(f,f.post({contract:INTENT_V2,requestId:'known',op:'upsert',words:target?'go to the campfire':'go somewhere nice'}));await drive(f,f.service.settled());
    const receipt=intentReceiptV2Schema.parse(await (await f.lookup('known')).json());assert.equal(receipt.phase,'understood');if(receipt.phase==='understood')assert.equal(receipt.revision.interpretation.agenda[0].target,target);assert.equal(f.db.paidCost(),0);
  });
});

test('default legacy compiler repair remains unchanged while retained output rejects ambiguous future ownership',async t=>{
  const f=intentNativeFixture(t,':memory:',true,false,proposed('imaginary-place'));
  const legacy=await drive(f,f.brain.compile(f.mind,'go to the pavilion now',true));assert.equal(legacy?.ok,true);if(legacy?.ok)assert.equal(legacy.agenda[0].target,null);
  for(const name of ['Rob','Rowan']){const owner='dev:bob',soulId='s_'+name,entityId='h_'+name;f.db.createSoul({id:soulId,worldId:f.host.worldId,owner,entityId,name,description:'fixture',native:false});await drive(f,f.host.enqueue('birth','fixture',{soulId,entityId,owner,name,description:'fixture'}));}
  const failed=await drive(f,f.brain.compile(f.mind,"go to Rob's or Rowan's party",'intent-v2'));assert.equal(failed?.ok,false);assert.equal(f.db.paidCost(),0);
  const associated=await drive(f,f.brain.compile(f.mind,"go to Rob's party",'intent-v2'));assert.equal(associated?.ok,true);if(associated?.ok)assert.deepEqual(associated.agenda,[{card:'go to',target:null,of:'s_Rob'}]);
});
