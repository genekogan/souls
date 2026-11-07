import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {commonsProvisionsFactory} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
const factory=await commonsProvisionsFactory();
test('actual native target loss blocks the first typed step without advancing to its meal',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow their purposes.']));
 for(let i=0;i<4;i++)f.host.tickOnce();await invite(f,'alice');
 const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic failed sequence owner'}));
 f.brain.quiesce();await accept(f.host,f.host.installCommonsProvisionsV1());
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:.5},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true,compilerCall:async<T>(o:any)=>{
  const input=JSON.parse(o.messages[0].content),walk=input.registry.goals.find((g:any)=>g.id==='walk').bindings.find((b:any)=>b.id==='walk:commons-bench-west'&&b.available),meal=input.registry.goals.find((g:any)=>g.id==='eat').bindings.find((b:any)=>b.available);
  assert.ok(walk);assert.ok(meal);
  return {out:{kind:'plan',registryHash:input.registry.registryHash,goals:[{goal:'walk',bindingId:walk.id},{goal:'eat',bindingId:meal.id}],explanation:'Walk to the west bench, then eat my meal.',trigger:{kind:'now'}} as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
 }});
 t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});await installCommonsProvisionCards(f.host,brain);
 await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await accept<unknown>(f.host,f.host.enableIntentExecutionRetentionV1());await accept<unknown>(f.host,f.host.enableIntentNativeSequenceCompletionV1());
 const service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'walk-then-meal',words:'Walk to commons-bench-west, then eat my meal.'}));await accept(f.host,service.settled());
 const receipt=service.lookup(scope,'walk-then-meal');assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no typed plan');
 const ref={intentId:receipt.revision.intentId,version:receipt.revision.version};
 await brain.evaluate(f.host.minds.get(row.id)!,'new-intent-v2');f.host.drainInputs();
 assert.ok(f.host.engine.programOf(row.entity_id));brain.quiesce();
 // Deliberate ephemeral native fault after real admission, before lowering.
 // It is not a canonical world edit and does not qualify reconstruction.
 assert.ok(f.host.engine.world.entities['commons-bench-west']);f.host.engine.removeEntity('commons-bench-west');
 for(let i=0;i<10&&f.host.engine.programOf(row.entity_id);i++)f.host.tickOnce();f.host.drainInputs();
 const history=f.host.intentHistoryOf(row.id),attempts=Object.values(history.attempts);
 assert.equal(attempts.length,1);assert.equal(attempts[0].phase,'blocked');assert.equal(attempts[0].evidence.kind,'controller');
 assert.equal(f.host.intentSequenceStepV1(row.id,ref),0);assert.equal(history.intents[ref.intentId].status,'active');
 assert.equal((f.host.engine.world.entities['commons-bowl-1'] as any).contents.fraction,1);
 assert.equal(f.host.unfinishedHumanGoalExecutionV1(row.id),null);assert.equal(f.db.paidCost(),0);
});
for(const interrupted of [false,true])test(interrupted?'new owner direction interrupts typed sequence without declaring its old native step complete':'typed sequence advances after actual native rest completion, then eats; semantic play alone is not completion',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow their purposes.']));for(let i=0;i<4;i++)f.host.tickOnce();await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic typed two-step owner'}));await accept(f.host,f.host.installCommonsProvisionsV1());f.brain.quiesce();const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:.5},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true,compilerCall:async<T>(o:any)=>{const input=JSON.parse(o.messages[0].content),meal=input.registry.goals.find((g:any)=>g.id==='eat').bindings.find((b:any)=>b.available);return {out:{kind:'plan',registryHash:input.registry.registryHash,goals:[{goal:'rest',seconds:2},{goal:'eat',bindingId:meal.id}],explanation:'Rest first, then eat my actual meal.',trigger:{kind:'now'}} as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};}});t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});await installCommonsProvisionCards(f.host,brain);await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await accept<unknown>(f.host,f.host.enableIntentExecutionRetentionV1());await accept<unknown>(f.host,f.host.enableIntentNativeSequenceCompletionV1());const service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'rest-then-meal',words:'Rest briefly, then eat my meal.'}));await accept(f.host,service.settled());const receipt=service.lookup(scope,'rest-then-meal');assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')return;const ref={intentId:receipt.revision.intentId,version:receipt.revision.version},first=receipt.revision.interpretation.agenda[0].card;for(let i=0;i<30&&!f.db.events(f.host.worldId).some(e=>e.kind==='play'&&e.payload.card===first);i++){f.host.tickOnce();await setImmediate();}assert.equal(f.host.engine.bodyResting?.(row.entity_id),true);assert.equal(f.host.intentSequenceStepV1(row.id,ref),0,'early semantic PLAY must not declare the bounded native interval complete');
 if(interrupted){await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'new-owner-rest',words:'rest'}));await accept(f.host,service.settled());assert.equal(service.lookup(scope,'new-owner-rest').phase,'understood');await brain.evaluate(f.host.minds.get(row.id)!,'new-intent-v2');f.host.drainInputs();for(let i=0;i<3;i++)f.host.tickOnce();assert.equal(f.host.intentSequenceStepV1(row.id,ref),0);assert.equal((f.host.engine.world.entities['commons-bowl-1'] as any).contents.fraction,1);assert.ok(f.db.events(f.host.worldId).some(e=>e.kind==='intent-controller-v2'&&e.payload.intent.intentId===ref.intentId&&e.payload.phase==='interrupted'));return;}
 let ate=false;for(let i=0;i<3000&&!ate;i++){f.host.tickOnce();if(i%10===0)await setImmediate();ate=(f.host.engine.world.entities['commons-bowl-1'] as any).contents.fraction===0&&!f.host.minds.get(row.id)!.pending;}assert.ok(ate);assert.equal(f.host.intentSequenceStepV1(row.id,ref),2);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);brain.quiesce();f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(h.intentSequenceStepV1(row.id,ref),2);h.stop();}
});
