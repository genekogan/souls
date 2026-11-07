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
import {installCommonsProvisionCards} from './commons-provisions.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function setup(t:TestContext,codec=true,policy=true,nativeProgramAllowed?:NonNullable<ConstructorParameters<typeof Brain>[4]>['nativeProgramAllowed']){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow directions and rest.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic sleeping owner'}));
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());if(codec)await accept(f.host,f.host.installNativeSleepSnapshotV1());f.brain.quiesce();
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true,nativeProgramAllowed});
 t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});await installCommonsProvisionCards(f.host,brain);
 await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await accept<unknown>(f.host,f.host.enableIntentExecutionRetentionV1());await accept<unknown>(f.host,f.host.enableIntentNativeSequenceCompletionV1());if(policy)await accept<unknown>(f.host,f.host.enableIntentHumanSleepTransitionV1());
 await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:row.id,entityId:row.entity_id,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-1',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[0].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 const pose=()=> (f.host.engine.world as NativeWorld).entities[row.entity_id].human?.sleepPose;
 for(let i=0;i<3000&&pose()?.standingFraction!==0;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(pose()?.standingFraction,0);
 const service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const submit=async()=>{await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'wake-west',words:'go to commons-bench-west'}));await accept(f.host,service.settled());return service.lookup(scope,'wake-west');};
 return {...f,brain,row,pose,service,scope,submit};
}
test('typed owner direction safely rises from actual physical sleep then walks; private stop and SQLite replay remain exact',async t=>{
 const f=await setup(t),old=f.host.engine.programOf(f.row.entity_id),receipt=await f.submit();assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
 const ref={intentId:receipt.revision.intentId,version:receipt.revision.version},published=f.host.engine.world.tick;
 assert.equal(f.pose()?.standingFraction,0,'publication must not move the sleeper');assert.equal(f.host.engine.programOf(f.row.entity_id),old);
 let walking=false,firstRise:number|undefined;
 for(let i=0;i<150&&!walking;i++){f.host.tickOnce();await setImmediate();if(firstRise===undefined&&(f.pose()?.standingFraction??1)>0)firstRise=f.host.engine.world.tick;walking=f.host.engine.world.entities[f.row.entity_id].human?.activity==='walk';}
 assert.ok(walking);assert.ok(firstRise!>published&&firstRise!-published<=5);assert.equal(f.pose(),undefined);assert.equal(f.host.pendingHumanSleepTransitionV1(f.row.id),false);
 const stops=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1');assert.equal(stops.length,1);assert.deepEqual(intentSleepStopV1Schema.parse(stops[0].payload).intent,ref);
 assert.deepEqual(publicEvent(stops[0]).payload,{worldId:f.host.worldId,soulId:f.row.id,privateUpdate:true});assert.ok(!JSON.stringify(publicEvent(stops[0])).includes(ref.intentId));
 for(const path of ['/v1/log','/v1/kernel','/v1/take']){const response=await f.app.request(path);assert.equal(response.status,200);assert.ok(!JSON.stringify(await response.json()).includes(ref.intentId));}
 f.brain.quiesce();f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},history=f.host.intentHistoryOf(f.row.id);
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.deepEqual(h.intentHistoryOf(f.row.id),history);h.stop();}
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);t.diagnostic(`publication=${published}; first native rise=${firstRise}; walking=${f.host.engine.world.tick}; simulation ticks only, no real-user latency promise`);
});
test('withdrawal ahead of the private stop prevents waking; withdrawal during rise finishes safety without starting the withdrawn walk',async t=>{
 for(const afterStop of [false,true])await t.test(afterStop?'during rise':'before stop',async child=>{
  const f=await setup(child),receipt=await f.submit();assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('no plan');
  if(afterStop){await f.brain.evaluate(f.host.minds.get(f.row.id)!,'new-intent-v2');f.host.drainInputs();for(let i=0;i<5;i++)f.host.tickOnce();assert.ok((f.pose()?.standingFraction??0)>0);assert.ok((f.pose()?.standingFraction??1)<1);f.host.saveSnapshot(true);for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.equal(h.engine.stateHash(),f.host.engine.stateHash());assert.equal(h.pendingHumanSleepTransitionV1(f.row.id),true);h.stop();}}
  await accept(f.host,f.service.submit(f.scope,{contract:'soul-intent/2',op:'withdraw',requestId:'withdraw-walk',edit:{intentId:receipt.revision.intentId,expectedVersion:receipt.revision.version}}));await accept(f.host,f.service.settled());
  for(let i=0;i<100;i++){f.host.tickOnce();await setImmediate();assert.notEqual(f.host.engine.world.entities[f.row.entity_id].human?.activity,'walk');}
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,afterStop?1:0);assert.equal(Object.keys(f.host.intentHistoryOf(f.row.id).attempts).length,0);assert.equal(f.service.lookup(f.scope,'withdraw-walk').phase,'withdrawn');if(afterStop)assert.equal(f.pose(),undefined);else assert.equal(f.pose()?.standingFraction,0);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 });
});
// P0 2026-10-06: a supported goal blocked only by sleep is accepted and waits with the specific condition; no stop, wake or pose change.
for(const [codec,policy] of [[false,true],[true,false]])test(`missing ${codec?'prospective transition policy':'active native sleep codec'} accepts with an explicit asleep wait and no stop`,async t=>{
 const f=await setup(t,codec,policy),before=f.host.engine.stateHash(),old=f.host.engine.programOf(f.row.entity_id),receipt=await f.submit();assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase==='understood')assert.match(receipt.revision.interpretation.summary,/Alice is asleep and will get up as soon as it is safe to rise/);assert.equal(f.host.engine.stateHash(),before);assert.equal(f.host.engine.programOf(f.row.entity_id),old);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,0);assert.equal(f.db.paidCost(),0);
});
test('duplicate and stale prepared stops are fenced before log append or live changes',async t=>{
 const f=await setup(t),receipt=await f.submit();assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('no plan');const ref={intentId:receipt.revision.intentId,version:receipt.revision.version},card=f.host.kernel.vocab.cards[receipt.revision.interpretation.agenda[0].card],program={actor:f.row.entity_id,label:card.name,steps:[...card.approach,...card.during]};
 const prefix=JSON.stringify(f.db.events(f.host.worldId)),head=f.host.engine.stateHash();
 const stale=f.host.enqueueHumanSleepStopV1(f.row.id,ref,program,()=>{throw Error('synthetic denied authority');}),refusal=assert.rejects(stale);f.host.drainInputs();await refusal;assert.equal(JSON.stringify(f.db.events(f.host.worldId)),prefix);assert.equal(f.host.engine.stateHash(),head);
 const unrelated=f.host.enqueueHumanSleepStopV1(f.row.id,ref,{...program,label:'unrelated programme'},()=>true),wrong=assert.rejects(unrelated);f.host.drainInputs();await wrong;assert.equal(JSON.stringify(f.db.events(f.host.worldId)),prefix);assert.equal(f.host.engine.stateHash(),head);
 const first=f.host.enqueueHumanSleepStopV1(f.row.id,ref,program,()=>true),duplicate=f.host.enqueueHumanSleepStopV1(f.row.id,ref,program,()=>true),both=Promise.allSettled([first,duplicate]);f.host.drainInputs();const outcomes=await both;assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,1);assert.equal(f.pose()?.standingFraction,0,'stop initiates native rise; acceptance does not force a pose');assert.equal(f.db.paidCost(),0);
});
test('new standing context prevents a stale older-purpose safe stop without changing the actual sleeper',async t=>{
 const f=await setup(t);await accept<unknown>(f.host,f.host.enableIntentPurposeEvidenceV1());await accept<unknown>(f.host,f.host.enableIntentPurposeRecallV1());await accept<unknown>(f.host,f.host.enableIntentRetainedChoiceV1());
 const receipt=await f.submit();assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('no walk plan');const ref={intentId:receipt.revision.intentId,version:receipt.revision.version},card=f.host.kernel.vocab.cards[receipt.revision.interpretation.agenda[0].card],program={actor:f.row.entity_id,label:card.name,steps:[...card.approach,...card.during]};
 const newer=await accept(f.host,f.service.publisher.receive(f.scope,{contract:'soul-intent/2',op:'upsert',requestId:'new-optional-rest',words:'Prefer quiet company when possible.'}));assert.ok(newer.reservation.created);await accept(f.host,f.service.publisher.publish(f.scope,newer.reservation,{summary:'An optional preference for quiet company.',agenda:[{card:'rest',target:null}],trigger:{kind:'none'}}));
 const m=f.host.minds.get(f.row.id)!,prefix=JSON.stringify(f.db.events(f.host.worldId)),head=f.host.engine.stateHash(),sleeping=f.host.engine.programOf(f.row.entity_id);assert.equal(f.brain.midContext(m,'new-intent-v2').actingPurpose,undefined);
 const stale=f.host.enqueueHumanSleepStopV1(f.row.id,ref,program,()=>true),rejected=assert.rejects(stale);f.host.drainInputs();await rejected;assert.equal(JSON.stringify(f.db.events(f.host.worldId)),prefix);assert.equal(f.host.engine.stateHash(),head);assert.equal(f.host.engine.programOf(f.row.entity_id),sleeping);assert.equal(f.pose()?.standingFraction,0);assert.equal(f.host.intentSequenceStepV1(f.row.id,ref),0);assert.equal(f.db.paidCost(),0);
 f.brain.quiesce();f.host.saveSnapshot(true);for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.equal(h.engine.stateHash(),head);assert.deepEqual(h.intentHistoryOf(f.row.id),f.host.intentHistoryOf(f.row.id));h.stop();}
});


test('pending native safe rise omits unused options, makes no new choice and resumes full options immediately when the programme changes',async t=>{
 const f=await setup(t),receipt=await f.submit();assert.equal(receipt.phase,'understood');const m=f.host.minds.get(f.row.id)!;
 const original=f.brain.midContext.bind(f.brain),calls:{deferred:boolean;options:number}[]=[];t.mock.method(f.brain,'midContext',(...args:Parameters<Brain['midContext']>)=>{const ctx=original(...args);calls.push({deferred:args[2]===true,options:ctx.options.length});return ctx;});
 const firstDecisions=f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,firstCalls=f.db.brainCalls(100).length,restore=f.host.factory.restore.bind(f.host.factory);let restores=0;t.mock.method(f.host.factory,'restore',(...args:Parameters<typeof restore>)=>{restores++;return restore(...args);});
 await f.brain.evaluate(m,'new-intent-v2');assert.equal(restores,1,'Brain preview and immediate enqueue share only one synchronous projection');f.host.drainInputs();assert.equal(restores,2,'queued acceptance independently rechecks a fresh native projection');assert.equal(f.host.pendingHumanSleepTransitionV1(m.soulId),true);assert.deepEqual(calls,[{deferred:true,options:0}]);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,firstDecisions);assert.equal(f.db.brainCalls(100).length,firstCalls);
 const before=f.host.engine.stateHash(),decisions=f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,brainCalls=f.db.brainCalls(100).length;
 await f.brain.evaluate(m,'new-intent-v2');f.host.drainInputs();assert.equal(calls.at(-1)?.deferred,true);assert.equal(calls.at(-1)?.options,0);assert.equal(f.host.engine.stateHash(),before);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,decisions);assert.equal(f.db.brainCalls(100).length,brainCalls);
 for(let i=0;i<120&&f.host.pendingHumanSleepTransitionV1(m.soulId);i++){m.nextEvalTick=1e9;f.host.tickOnce();}
 assert.equal(f.host.pendingHumanSleepTransitionV1(m.soulId),false);await f.brain.evaluate(m,'new-intent-v2');f.host.drainInputs();assert.ok(calls.some(c=>!c.deferred&&c.options>0),'a real changed native programme restores the full option read');assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
test('private mandatory recall overflow still refuses choice during pending safe rise even when unused options are omitted',async t=>{
 const f=await setup(t),receipt=await f.submit();assert.equal(receipt.phase,'understood');const m=f.host.minds.get(f.row.id)!;await f.brain.evaluate(m,'new-intent-v2');f.host.drainInputs();assert.equal(f.host.pendingHumanSleepTransitionV1(m.soulId),true);
 await accept<unknown>(f.host,f.host.enableIntentPurposeEvidenceV1());await accept<unknown>(f.host,f.host.enableIntentPurposeRecallV1());
 for(let i=0;i<13;i++)await accept(f.host,f.service.publisher.receive(f.scope,{contract:'soul-intent/2',op:'upsert',requestId:'pending-mandatory-'+i,words:'MANDATORY_PENDING_'+i+' '+('Retain this strict constraint. '.repeat(20)),strict:true}).then(r=>{assert.ok(r.reservation.created);return f.service.publisher.publish(f.scope,r.reservation,{summary:'A retained strict purpose.',agenda:[{card:'rest',target:null}],trigger:{kind:'none'}});}));
 const ctx=f.brain.midContext(m,'timer',true);assert.equal(ctx.options.length,0);assert.equal(ctx.purposeRecall?.state,'overflow');const count=f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length;await f.brain.evaluate(m,'timer');f.host.drainInputs();assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,count);assert.equal(f.host.pendingHumanSleepTransitionV1(m.soulId),true);assert.equal(f.db.brainCalls(100,{soulIds:[m.soulId]}).filter(c=>c.model==='private-recall/1').length,1);assert.equal(f.db.paidCost(),0);
});

test('a refused native sleep-stop preview immediately restores the full registry rather than choosing from missing options',async t=>{
 const f=await setup(t,false,true),receipt=await f.submit();assert.equal(receipt.phase,'understood');const m=f.host.minds.get(f.row.id)!,original=f.brain.midContext.bind(f.brain),canPerform=f.host.engine.canPerform.bind(f.host.engine);let checks=0;const calls:{deferred:boolean;options:ReturnType<Brain['midContext']>['options'];checks:number}[]=[];
 t.mock.method(f.host.engine,'canPerform',(...args:Parameters<typeof f.host.engine.canPerform>)=>{checks++;return canPerform(...args);});
 t.mock.method(f.brain,'midContext',(...args:Parameters<Brain['midContext']>)=>{const before=checks,ctx=original(...args);calls.push({deferred:args[2]===true,options:ctx.options,checks:checks-before});return ctx;});
 const at=`${f.host.engine.world.tick}|${f.host.seq}`;await f.brain.evaluate(m,'new-intent-v2');f.host.drainInputs();
 // The oracle read comes after the fallback: menuWorldOf's LiveFeasibility caches verdicts per (tick, log seq), so reading it
 // first would serve the fallback's checks from that cache and the engine-level count below would be 0 (gate 7caf912a7).
 assert.equal(`${f.host.engine.world.tick}|${f.host.seq}`,at,'the refused preview changed neither tick nor log seq');const expected=original(m,'new-intent-v2').options;
 assert.equal(calls[0]?.deferred,true);assert.deepEqual(calls[0]?.options,[]);assert.equal(calls[1]?.deferred,false);assert.deepEqual(calls[1].options,expected);assert.ok(calls[1].checks>0,'the fallback actually runs native feasibility checks even when the sleeping body cannot use any option');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,0);assert.equal(f.pose()?.standingFraction,0);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('deferred safe-wake fallback reconstructs options before native participant admission and cannot choose a denied programme',async t=>{
 let checks=0;const f=await setup(t,true,true,()=>{checks++;return false;}),receipt=await f.submit();assert.equal(receipt.phase,'understood');const m=f.host.minds.get(f.row.id)!;
 await f.brain.evaluate(m,'new-intent-v2');f.host.drainInputs();assert.equal(f.host.pendingHumanSleepTransitionV1(m.soulId),true);assert.equal(checks,0,'a native safe-wake return makes no candidate choice');
 for(let i=0;i<120&&f.host.pendingHumanSleepTransitionV1(m.soulId);i++){m.nextEvalTick=1e9;f.host.tickOnce();}
 assert.equal(f.host.pendingHumanSleepTransitionV1(m.soulId),false);const original=f.brain.midContext.bind(f.brain),expected=original(m,'new-intent-v2').options;assert.ok(expected.length>0,'the now-standing actor has actual available native choices');
 const reads:boolean[]=[];t.mock.method(f.brain,'midContext',(...args:Parameters<Brain['midContext']>)=>{reads.push(args[2]===true);return original(...args);});
 const head=f.host.engine.stateHash(),events=f.db.events(f.host.worldId).length,calls=f.db.brainCalls(100).length;
 await f.brain.evaluate(m,'new-intent-v2');f.host.drainInputs();assert.deepEqual(reads,[true,false]);assert.equal(checks,expected.length,'every reconstructed candidate passes through native participant admission');assert.equal(f.host.engine.stateHash(),head);assert.equal(f.db.events(f.host.worldId).length,events);assert.equal(f.db.brainCalls(100).length,calls,'denied options never reach reflex/model choice');assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
