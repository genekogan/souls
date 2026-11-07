import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import type {callTool,CompileOut} from '@souls/brain';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {WorldHost} from './world.ts';
import {LivingWorld} from './living.ts';
import {setImmediate} from 'node:timers/promises';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
test('end-gathering then travel advances on its own bound canonical play and reaches the native target and retains original purpose',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may explore.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
  await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited sequence owner'}));
  await accept(f.host,f.souls.setIntent(row,{goal:'gather',target:'commons'},'web'));
  for(let i=0;i<250&&!f.host.kernel.things[row.id].states.hosting;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}for(let i=0;i<30;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}f.host.drainInputs();
  const group=Object.values(f.host.kernel.links).find(l=>l.from===row.id&&l.kind==='hosts')!.to;assert.ok(group);f.brain.quiesce();
  const compilerCall:typeof callTool=async<T>()=>{const out:CompileOut={understood:true,agenda:[{card:'end the gathering',target:group},{card:'go to',target:'commons-bench-west'}],alignment:{understanding:'Go to the east bench, then the west bench.',trigger:{kind:'now'}}};return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};};
  const brain=new Brain(f.host,f.db,{...f.brain.cfg,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',budgetUsdPerDay:.5},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{compilerCall,intentV2Choices:true});t.after(()=>brain.quiesce());
  await accept<unknown>(f.host,f.host.enableIntentSequencesV1());const service=new IntentControlV2(f.host,brain,f.souls,{historyV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
  brain.mode='live';const received=await accept(f.host,service.submit(scope,{contract:'soul-intent/2',requestId:'sequence-original',op:'upsert',words:'End the gathering and then go to the west bench.'}));await accept(f.host,service.settled());brain.mode='fake';
  const result=service.lookup(scope,'sequence-original');assert.equal(result.phase,'understood');if(result.phase!=='understood')return;const ref={intentId:result.revision.intentId,version:result.revision.version};
  for(let i=0;i<2000&&f.host.intentSequenceStepV1(row.id,ref)<2;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}f.host.drainInputs();

  assert.equal(f.host.intentSequenceStepV1(row.id,ref),2);const own=f.db.soulEvents(f.host.worldId,row.id,200).filter(e=>e.kind==='play'&&e.payload.card==='go to');assert.deepEqual(own.map(e=>e.payload.target),['commons-bench-west']);
  const attempts=Object.values(f.host.intentHistoryOf(row.id).attempts);assert.equal(attempts.filter(a=>a.intent.intentId===ref.intentId).length,2);assert.equal(f.host.intentHistoryOf(row.id).intents[ref.intentId].revision.words,result.revision.words);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  brain.quiesce();f.host.saveSnapshot(true);let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.equal(h.intentSequenceStepV1(row.id,ref),2);h.stop();f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.equal(h.intentSequenceStepV1(row.id,ref),2);assert.equal(h.engine.stateHash(),f.host.engine.stateHash());h.stop();
});
