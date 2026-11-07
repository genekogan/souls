import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {publicEvent,intentSleepStopV1Schema} from '@souls/protocol';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {Brain} from './brain.ts';
import {WorldHost} from './world.ts';
import {IntentControlV2} from './intent-control.ts';
import {previewHumanSleepStopV1,withHumanSleepStopReadV1} from './human-sleep-transition.ts';
import {readHumanCapabilitiesV1} from './human-capabilities.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function setup(t:TestContext,codec=true,policy=true){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow directions and rest.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic sleeping owner'}));
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());if(codec)await accept(f.host,f.host.installNativeSleepSnapshotV1());f.brain.quiesce();
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:.5},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true,compilerCall:async<T>(input:any)=>{const data=JSON.parse(input.messages[0].content);return {out:{kind:'plan',registryHash:data.registry.registryHash,goals:[{goal:'walk',bindingId:'walk:commons-bench-west'}],explanation:'Walk to west bench.',trigger:{kind:'now'}} as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};}});
 t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});await installCommonsProvisionCards(f.host,brain);
 await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await accept<unknown>(f.host,f.host.enableIntentExecutionRetentionV1());await accept<unknown>(f.host,f.host.enableIntentNativeSequenceCompletionV1());if(policy)await accept<unknown>(f.host,f.host.enableIntentHumanSleepTransitionV1());
 await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:row.id,entityId:row.entity_id,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-1',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[0].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 const pose=()=> (f.host.engine.world as NativeWorld).entities[row.entity_id].human?.sleepPose;
 for(let i=0;i<3000&&pose()?.standingFraction!==0;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(pose()?.standingFraction,0);
 const service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const submit=async()=>{await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'wake-west',words:'go to commons-bench-west'}));await accept(f.host,service.settled());return service.lookup(scope,'wake-west');};
 return {...f,brain,row,pose,service,scope,submit};
}

test('profile native sleeping-body registry, repeated detached safety projections and actual compiler revalidation without live movement',async t=>{
 const f=await setup(t),m=f.host.minds.get(f.row.id)!,baseline=f.host.engine.stateHash(),old=f.host.engine.programOf(f.row.entity_id);
 type Metric={wallMs:number;snapshots:number;snapshotMs:number;restores:number;restoreMs:number;detachedSteps:number;detachedStepMs:number;hashes:number;hashMs:number};const results:Record<string,Metric>={};let stage:Metric|undefined;const metric=():Metric=>({wallMs:0,snapshots:0,snapshotMs:0,restores:0,restoreMs:0,detachedSteps:0,detachedStepMs:0,hashes:0,hashMs:0});
 const snapshot=f.host.engine.snapshot.bind(f.host.engine),hash=f.host.engine.stateHash.bind(f.host.engine),restore=f.host.factory.restore.bind(f.host.factory);
 t.mock.method(f.host.engine,'snapshot',()=>{const start=performance.now();try{return snapshot();}finally{if(stage){stage.snapshots++;stage.snapshotMs+=performance.now()-start;}}});
 t.mock.method(f.host.engine,'stateHash',()=>{const start=performance.now();try{return hash();}finally{if(stage){stage.hashes++;stage.hashMs+=performance.now()-start;}}});
 t.mock.method(f.host.factory,'restore',(...args:Parameters<typeof restore>)=>{const start=performance.now(),copy=restore(...args);if(stage){stage.restores++;stage.restoreMs+=performance.now()-start;}const step=copy.step.bind(copy);copy.step=()=>{const before=performance.now();try{return step();}finally{if(stage){stage.detachedSteps++;stage.detachedStepMs+=performance.now()-before;}}};return copy;});
 const measure=async<T>(name:string,read:()=>Promise<T>|T)=>{stage=metric();results[name]=stage;const start=performance.now();try{return await read();}finally{stage.wallMs=performance.now()-start;stage=undefined;}};
 const registry=await measure('oneRegistryRead',()=>readHumanCapabilitiesV1(f.host,m,{registeredActivitiesV1:true})),binding=registry.bindings.get('walk:commons-bench-west')!;assert.ok(binding);const program={actor:m.entityId,label:binding.label,steps:binding.steps};
 await measure('fiveIdenticalSafetyReads',()=>{for(let i=0;i<5;i++)assert.equal(previewHumanSleepStopV1(f.host,m,program),old);});assert.equal(results.fiveIdenticalSafetyReads.restores,5);assert.ok(results.fiveIdenticalSafetyReads.detachedSteps>0);
 await measure('oneSynchronousFiveSafetyRead',()=>withHumanSleepStopReadV1(f.host,m,preview=>{for(let i=0;i<5;i++)assert.equal(preview(program),old);assert.equal(preview({...program,actor:'foreign'}),null);assert.equal(preview({...program,steps:[{verb:'walk_to',params:{to:'missing-target'}}]}),null);assert.equal(preview(program),old);}));assert.equal(results.oneSynchronousFiveSafetyRead.restores,1);assert.equal(results.oneSynchronousFiveSafetyRead.detachedSteps,43);
 const compiled=await measure('actualCompileAndMint',()=>accept(f.host,f.brain.compileHumanGoalV1(m,'PRIVATE_PROFILE go to commons-bench-west',false,()=>true,()=>true,true)));assert.equal(compiled.kind,'planned',JSON.stringify(compiled));if(compiled.kind!=='planned')throw Error('no plan');await measure('oneWriterRevalidation',()=>compiled.revalidate?.());assert.equal(results.oneWriterRevalidation.restores,1);assert.equal(results.oneWriterRevalidation.detachedSteps,43);
 let expired!:(p:typeof program)=>string|null;withHumanSleepStopReadV1(f.host,m,preview=>{expired=preview;assert.equal(preview(program),old);});assert.equal(expired(program),null,'probe expires before any later writer/read');assert.throws(()=>withHumanSleepStopReadV1(f.host,m,()=>Promise.resolve(true)),/synchronous-read-required/);
 assert.equal(f.host.engine.stateHash(),baseline);assert.equal(f.host.engine.programOf(f.row.entity_id),old);assert.equal(f.pose()?.standingFraction,0);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,0);assert.equal(Object.keys(f.host.intentHistoryOf(f.row.id).attempts).length,0);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
 t.diagnostic(JSON.stringify({scope:'One real native sleeper; observational timers around actual snapshot/hash/factory restore/detached steps. Compiler uses synthetic transport, real validation/mint and direct writer revalidation. No live stop/movement/admission/provider; not an optimized latency claim.',metrics:results,unchangedSource:true,providerCalls:0}));
});
test('shared safety projection expires across reads and refuses source mutation during its synchronous boundary',async t=>{
 const f=await setup(t),m=f.host.minds.get(f.row.id)!,binding=readHumanCapabilitiesV1(f.host,m,{registeredActivitiesV1:true}).bindings.get('walk:commons-bench-west')!,program={actor:m.entityId,label:binding.label,steps:binding.steps},old=f.host.engine.programOf(m.entityId);let restores=0;const restore=f.host.factory.restore.bind(f.host.factory);t.mock.method(f.host.factory,'restore',(...args:Parameters<typeof restore>)=>{restores++;return restore(...args);});
 for(let i=0;i<2;i++)withHumanSleepStopReadV1(f.host,m,preview=>{assert.equal(preview(program),old);assert.equal(preview(program),old);});assert.equal(restores,2,'separate synchronous reads never share a detached engine');
 assert.throws(()=>withHumanSleepStopReadV1(f.host,m,preview=>{assert.equal(preview(program),old);f.host.tickOnce();assert.equal(preview(program),null,'source tick changes invalidate the in-scope projection');}),/preview-mutated-source/);assert.equal(restores,3);assert.equal(f.pose()?.standingFraction,0);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,0);assert.equal(f.db.paidCost(),0);
});

test('nested exact synchronous safety reads share different target checks but never cross exceptions, source changes or asynchronous scope exit',async t=>{
 const f=await setup(t),m=f.host.minds.get(f.row.id)!,registry=readHumanCapabilitiesV1(f.host,m,{registeredActivitiesV1:true}),west=registry.bindings.get('walk:commons-bench-west')!,east=registry.bindings.get('walk:commons-bench-east')!,old=f.host.engine.programOf(m.entityId),program=(b:typeof west)=>({actor:m.entityId,label:b.label,steps:b.steps});assert.ok(east);
 const restore=f.host.factory.restore.bind(f.host.factory);let restores=0;t.mock.method(f.host.factory,'restore',(...args:Parameters<typeof restore>)=>{restores++;return restore(...args);});
 const before=f.host.engine.stateHash();withHumanSleepStopReadV1(f.host,m,preview=>{assert.equal(preview(program(west)),old);withHumanSleepStopReadV1(f.host,m,nested=>{assert.equal(nested(program(east)),old);assert.equal(nested({...program(west),steps:[{verb:'walk_to',params:{to:'missing-target'}}]}),null);});assert.equal(preview(program(west)),old);});assert.equal(restores,1);assert.equal(f.host.engine.stateHash(),before);
 assert.throws(()=>withHumanSleepStopReadV1(f.host,m,preview=>{assert.equal(preview(program(west)),old);withHumanSleepStopReadV1(f.host,m,()=>{throw Error('nested read refused');});}),/nested read refused/);assert.equal(previewHumanSleepStopV1(f.host,m,program(east)),old);assert.equal(restores,3,'the failed outer scope does not leak its projection');
 assert.throws(()=>withHumanSleepStopReadV1(f.host,m,preview=>{assert.equal(preview(program(west)),old);f.host.tickOnce();withHumanSleepStopReadV1(f.host,m,nested=>assert.equal(nested(program(east)),null));}),/preview-mutated-source/);assert.equal(restores,4,'changed native state cannot reuse a projection');
 let expired!:(p:ReturnType<typeof program>)=>string|null;withHumanSleepStopReadV1(f.host,m,preview=>{expired=preview;assert.equal(preview(program(west)),old);});assert.equal(await Promise.resolve().then(()=>expired(program(east))),null);assert.equal(previewHumanSleepStopV1(f.host,m,program(east)),old);assert.equal(restores,6,'a fresh synchronous read after await restores independently');assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
