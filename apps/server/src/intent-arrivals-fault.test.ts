import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import type {callTool,CompileOut} from '@souls/brain';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {setImmediate} from 'node:timers/promises';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
test('arrival journal failure rolls back its play pair and stops claiming clock progress; restart retries derived observation without a new decision',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may explore.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic atomic arrival owner'}));f.brain.quiesce();
  const compilerCall:typeof callTool=async<T>()=>{const out:CompileOut={understood:true,agenda:[{card:'go to',target:'commons-bench-west'}],alignment:{understanding:'Go west.',trigger:{kind:'now'}}};return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};};
  const brain=new Brain(f.host,f.db,{...f.brain.cfg,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',budgetUsdPerDay:.5},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{compilerCall,intentV2Choices:true});t.after(()=>brain.quiesce());await accept<unknown>(f.host,f.host.enableIntentArrivalsV1());
  const service=new IntentControlV2(f.host,brain,f.souls),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);brain.mode='live';await accept(f.host,service.submit(scope,{contract:'soul-intent/2',requestId:'atomic-original',op:'upsert',words:'Go to the west bench.'}));await accept(f.host,service.settled());brain.mode='fake';
  f.db.db.exec("CREATE TEMP TRIGGER fail_arrival BEFORE INSERT ON intent_arrivals_v1 BEGIN SELECT RAISE(ABORT,'fixture-arrival-journal-failure'); END");let failed=false;
  for(let i=0;i<1000&&!failed;i++){try{f.host.tickOnce();}catch(error){assert.match(String(error),/fixture-arrival-journal-failure/);failed=true;}if(i%10===0)await setImmediate();}
  assert.ok(failed);assert.equal(f.host.clockAvailable,false);assert.equal(f.host.paused,true);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='play'&&e.payload.card==='go to').length,0);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-arrival-v1').length,0);assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM intent_arrivals_v1').get()!.n,0);const decisions=f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length;
  brain.quiesce();f.db.db.exec('DROP TRIGGER fail_arrival');const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});h.boot();t.after(()=>h.stop());
  for(let i=0;i<1000&&!f.db.events(h.worldId).some(e=>e.kind==='intent-arrival-v1');i++){h.tickOnce();if(i%10===0)await setImmediate();}
  assert.equal(f.db.events(h.worldId).filter(e=>e.kind==='intent-arrival-v1').length,1);assert.equal(f.db.events(h.worldId).filter(e=>e.kind==='play'&&e.payload.card==='go to').length,1);assert.equal(f.db.events(h.worldId).filter(e=>e.kind==='decision').length,decisions);assert.equal(f.db.paidCost(),0);assert.deepEqual(h.engine.runtime.violations,[]);
});
