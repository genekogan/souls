import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { toyFactory } from '@souls/engine-toy';
import { marsFactory } from '@souls/engine-mars';
import type { Engine, EngineFactory } from '@souls/engine-contract';
import { INTENT_V2, intentAdmissionPayloadV2Schema, intentAdmissionFactV2, intentControllerFactV2, intentControllerPayloadV2Schema, publicEvent, type DecisionPayload } from '@souls/protocol';
import { Db } from './db.ts';
import { WorldHost, StaleIntentAttempt, IntentAdmissionDeferred, PersistedIntentAdmissionFault } from './world.ts';
import { IntentPublisher } from './intent-publisher.ts';
import { IntentRequests, type IntentRequestScope } from './intent-requests.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Hub } from './hub.ts';
import { Souls } from './souls.ts';
import { buildApp } from './http.ts';

const native=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
async function accept<T>(host:WorldHost,promise:Promise<T>){host.drainInputs();return promise;}
async function fixture(t:TestContext,factory:EngineFactory=native,durable=false){
  const dir=durable?mkdtempSync(join(tmpdir(),'core-admission-')):null,path=dir?join(dir,'world.db'):':memory:';
  const db=new Db(path);t.after(()=>{db.close();if(dir)rmSync(dir,{recursive:true,force:true});});
  db.upsertUser({id:'owner',role:'user',email:null,wallet:null});db.setInvited('owner','fixture');
  const host=new WorldHost(db,factory,'admission-fixture',1e9,'admission-world');host.boot();
  db.createSoul({id:'s_A',entityId:'h_A',worldId:host.worldId,owner:'owner',name:'Alice',description:'fixture',native:false});
  await accept(host,host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'owner',name:'Alice',description:'fixture'}));
  const scope:IntentRequestScope={worldId:host.worldId,soulId:'s_A',source:{kind:'owner',ownerId:'owner',principalId:'PRIVATE_PRINCIPAL',channel:'web'},currentAuthority:()=>true};
  const store=new IntentRequests(db),publisher=new IntentPublisher(host,store);
  const request=await accept(host,publisher.receive(scope,{contract:INTENT_V2,op:'upsert',requestId:'purpose',words:'PRIVATE_WORDS go to the campfire'}));assert.ok(request.reservation.created);
  const result=await accept(host,publisher.publish(scope,request.reservation,{summary:'PRIVATE_MEANING Walk to the fire.',agenda:[{card:'go to',target:'campfire'}],trigger:{kind:'now'}}));
  assert.equal(result.receipt?.phase,'understood');const revision=result.receipt!.phase==='understood'?result.receipt.revision:null;assert.ok(revision);
  const ref={intentId:revision.intentId,version:revision.version};
  const decision:DecisionPayload={soulId:'s_A',entityId:'h_A',option:'go:campfire',label:'go to campfire',steps:[{verb:'walk_to',params:{to:'campfire',standoff:1.5}}],card:'go to',target:'campfire',approachLen:1,reevalTicks:1e9,fallback:false,trigger:'new-intent-v2'};
  return {db,host,scope,publisher,store,ref,decision,path,factory};
}

test('native admission is explicitly associated, private, and unchanged by model-free log and snapshot readers',async t=>{
  const f=await fixture(t);
  const decision=await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
  const e=f.db.events(f.host.worldId).find(e=>e.kind==='intent-admission-v2');assert.ok(e);
  const out=intentAdmissionFactV2(e).outcome;assert.equal(out.phase,'accepted');
  assert.equal(out.evidence.seq,decision.seq);assert.equal(out.evidence.tick,decision.tick);assert.deepEqual(out.intent,f.ref);
  assert.equal(out.activityId,f.host.engine.programOf('h_A'));assert.equal(f.host.engine.world.tick,0,'no engine tick was needed to report admission');
  assert.equal(f.host.intentHistoryOf('s_A').intents[f.ref.intentId].status,'active');
  const publicText=JSON.stringify(f.db.events(f.host.worldId).map(publicEvent));
  for(const marker of ['PRIVATE_WORDS','PRIVATE_MEANING','PRIVATE_PRINCIPAL',f.ref.intentId,out.attemptId])assert.ok(!publicText.includes(marker),marker);
  assert.ok(!JSON.stringify(f.host.kernelView()).includes(f.ref.intentId));
  const expected=f.host.intentHistoryOf('s_A'),hash=f.host.engine.stateHash();
  const replay=new WorldHost(f.db,f.factory,'admission-fixture',1e9,f.host.worldId);assert.equal(replay.boot().from,'genesis');
  assert.deepEqual(replay.intentHistoryOf('s_A'),expected);assert.equal(replay.engine.stateHash(),hash);
  replay.saveSnapshot(true);const restarted=new WorldHost(f.db,f.factory,'admission-fixture',1e9,f.host.worldId);assert.equal(restarted.boot().from,'snapshot');
  assert.deepEqual(restarted.intentHistoryOf('s_A'),expected);assert.equal(restarted.engine.stateHash(),hash);assert.equal(f.db.paidCost(),0);
});

test('a real native refusal records blocked admission, never accepted or started',async t=>{
  const f=await fixture(t);f.decision.steps=[{verb:'walk_to',params:{to:[400,400]}}];
  const decision=await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
  const e=f.db.events(f.host.worldId).find(e=>e.kind==='intent-admission-v2');assert.ok(e);
  const out=intentAdmissionFactV2(e).outcome;assert.equal(out.phase,'blocked');assert.equal(out.evidence.seq,decision.seq);
  assert.ok(out.phase==='blocked' && out.reason.length);assert.equal(f.host.engine.programOf('h_A'),null);
  assert.equal(f.host.intentHistoryOf('s_A').intents[f.ref.intentId].status,'active');assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('later withdrawal, owner change and legacy will each prevent a prepared purpose attempt before logging',async t=>{
  for(const change of ['withdraw','owner','legacy'] as const)await t.test(change,async child=>{
    const f=await fixture(child);let changeAccepted:Promise<unknown>|undefined;
    if(change==='withdraw'){
      const r=await accept(f.host,f.publisher.receive(f.scope,{contract:INTENT_V2,requestId:'withdraw',op:'withdraw',edit:{intentId:f.ref.intentId,expectedVersion:f.ref.version}}));assert.ok(r.reservation.created);
      changeAccepted=f.publisher.publish(f.scope,r.reservation);
    }else if(change==='legacy'){
      changeAccepted=f.host.enqueue('intent','fixture',{soulId:'s_A',intent:{agenda:[{card:'rest',target:null}],text:'rest here'},source:'web'});
    }else if(change==='owner')f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('other','s_A');
    const queued=f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true);
    const rejected=assert.rejects(queued,StaleIntentAttempt);f.host.drainInputs();await rejected;
    if(changeAccepted)await changeAccepted;
    assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision'||e.kind==='intent-admission-v2').length,0);assert.equal(f.host.engine.programOf('h_A'),null);
  });
});

test('private admission origins and progress claims cannot be supplied in its strict payload',()=>{
  const p={contract:INTENT_V2,worldId:'w',soulId:'s',intent:{intentId:'i',version:1},attemptId:'a',activityId:'p1',decision:{seq:1,tick:0,entityId:'h'},phase:'accepted'};
  assert.ok(intentAdmissionPayloadV2Schema.safeParse(p).success);
  for(const field of [{seq:2},{tick:0},{evidence:{seq:1,tick:0,kind:'controller'}},{phase:'started'},{phase:'completed'},{source:{ownerId:'other'}}])assert.ok(!intentAdmissionPayloadV2Schema.safeParse({...p,...field}).success);
  assert.throws(()=>intentAdmissionFactV2({kind:'intent-admission-v2',seq:1,tick:0,payload:p}),/must follow/);
  assert.throws(()=>intentAdmissionFactV2({kind:'intent-admission-v2',seq:2,tick:0,payload:{...p,decision:{seq:1,tick:2,entityId:'h'}}}),/future/);
});

test('an admission write failure rolls back both facts without touching the live native program, counter, take or Mind',async t=>{
  const f=await fixture(t),append=f.db.appendEvent.bind(f.db);
  const hash=f.host.engine.stateHash(),snapshot=JSON.stringify(f.host.engine.snapshot()),mind=structuredClone(f.host.minds.get('s_A')),seq=f.host.seq;
  f.db.appendEvent=(world,event)=>{if(event.kind==='intent-admission-v2')throw new Error('fixture writer failure');append(world,event);};
  const queued=f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true),rejected=assert.rejects(queued,/fixture writer failure/);
  f.host.drainInputs();await rejected;assert.equal(f.host.engine.programOf('h_A'),null);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision'||e.kind==='intent-admission-v2').length,0);assert.deepEqual(f.host.intentHistoryOf('s_A').attempts,{});
  assert.equal(f.host.seq,seq);assert.equal(f.host.engine.stateHash(),hash);assert.equal(JSON.stringify(f.host.engine.snapshot()),snapshot);assert.deepEqual(f.host.minds.get('s_A'),mind);
  f.db.appendEvent=append;const restarted=new WorldHost(f.db,f.factory,'admission-fixture',1e9,f.host.worldId);restarted.boot();
  assert.equal(restarted.engine.stateHash(),f.host.engine.stateHash());assert.deepEqual(restarted.intentHistoryOf('s_A').attempts,{});
  const retried=await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));assert.equal(retried.seq,seq+1);
  assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts).length,1,'only the later explicit reconsideration committed');
});

test('native preview is detached and read-only; observers see neither fact before commit and both before live perform',async t=>{
  const f=await fixture(t,native,true),observer=new Db(f.path);t.after(()=>observer.close());
  const program={actor:f.decision.entityId,label:f.decision.label,steps:f.decision.steps};
  const snapshot=JSON.stringify(f.host.engine.snapshot()),hash=f.host.engine.stateHash();
  const predicted=f.host.engine.previewAdmission!(program);assert.equal(predicted.ok,true);
  const mutated=f.host.engine.previewAdmission!(program);mutated.id='forged';mutated.ok=false;
  assert.deepEqual(f.host.engine.previewAdmission!(program),predicted);
  assert.equal(f.host.engine.stateHash(),hash);assert.equal(JSON.stringify(f.host.engine.snapshot()),snapshot);
  const append=f.db.appendEvent.bind(f.db),perform=f.host.engine.perform.bind(f.host.engine),seen:string[]=[];
  f.db.appendEvent=(world,event)=>{append(world,event);if(event.kind==='decision'||event.kind==='intent-admission-v2'){
    assert.equal(observer.events(world).filter(e=>e.kind==='decision'||e.kind==='intent-admission-v2').length,0,'other connection never sees a partial transaction');
    assert.equal(JSON.stringify(f.host.engine.snapshot()),snapshot,'preview/write cannot cancel or start live work');seen.push(event.kind);
  }};
  f.host.engine.perform=p=>{
    const pair=observer.events(f.host.worldId).filter(e=>e.kind==='decision'||e.kind==='intent-admission-v2');assert.equal(pair.length,2);
    assert.equal(pair[1].payload.activityId,predicted.id);assert.equal(pair[1].seq,pair[0].seq+1);assert.equal(pair[1].tick,pair[0].tick);
    return perform(p);
  };
  const applied:string[]=[];f.host.listeners.push({onApplied:e=>{if(e.kind==='decision'||e.kind==='intent-admission-v2'){
    assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'accepted');assert.equal(f.host.engine.programOf('h_A'),predicted.id);applied.push(e.kind);
  }}});
  await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
  assert.deepEqual(seen,['decision','intent-admission-v2']);assert.deepEqual(applied,seen);assert.equal(f.db.paidCost(),0);
});

test('fallback engines defer unsafe or inexact checkpoint preview without creating a decision or changing their body',async t=>{
  for(const mode of ['non-resumable','wrong-hash'] as const)await t.test(mode,async child=>{
    const f=await fixture(child,toyFactory),hash=f.host.engine.stateHash(),seq=f.host.seq,restore=f.host.factory.restore;
    if(mode==='non-resumable')f.host.engine.canSnapshot=()=>false;
    else f.host.factory={...f.host.factory,restore:snapshot=>{const trial=restore(snapshot);trial.stateHash=()=> 'inexact';return trial;}};
    const queued=f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true),rejected=assert.rejects(queued,IntentAdmissionDeferred);
    f.host.drainInputs();await rejected;assert.equal(f.host.seq,seq);assert.equal(f.host.engine.stateHash(),hash);assert.equal(f.host.engine.programOf('h_A'),null);
    assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision'||e.kind==='intent-admission-v2').length,0);
  });
});

test('two queued native choices reserve separate ordered pairs and retain the replaced attempt before the next controller tick',async t=>{
  const f=await fixture(t),seq=f.host.seq;
  const one=f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true);
  const two=f.host.enqueueIntentDecision('brain:reflex',{...f.decision,label:'second go to campfire'},f.ref,()=>true);
  f.host.drainInputs();const [first,second]=await Promise.all([one,two]);
  assert.equal(first.seq,seq+1);assert.equal(second.seq,seq+3);assert.equal(f.host.seq,seq+4);
  const admissions=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-admission-v2');assert.equal(admissions.length,2);
  assert.notEqual(admissions[0].payload.activityId,admissions[1].payload.activityId);assert.equal(f.host.engine.programOf('h_A'),admissions[1].payload.activityId);
  f.host.tickOnce();const attempts=f.host.intentHistoryOf('s_A').attempts;
  assert.equal(attempts[admissions[0].payload.attemptId].phase,'interrupted');assert.equal(attempts[admissions[1].payload.attemptId].phase,'started');
  const replay=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);replay.boot();assert.deepEqual(replay.intentHistoryOf('s_A'),f.host.intentHistoryOf('s_A'));assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());
});

test('committed preview/live mismatch is contained as a physical fault and never retries an already durable pair',async t=>{
  const f=await fixture(t);f.host.saveSnapshot(true);
  const perform=f.host.engine.perform.bind(f.host.engine);
  f.host.engine.perform=program=>({...perform(program),id:'wrong-live-id'});
  const queued=f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true),rejected=assert.rejects(queued,PersistedIntentAdmissionFault);
  f.host.drainInputs();await rejected;
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-admission-v2').length,1);
  assert.ok(f.db.events(f.host.worldId).some(e=>e.payload?.recovery));assert.equal(f.host.engine.programOf('h_A'),null);
  assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'accepted','recorded admission is historical, not current execution after recovery');
  const replay=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);replay.boot();assert.deepEqual(replay.intentHistoryOf('s_A'),f.host.intentHistoryOf('s_A'));assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());
});

test('legacy unassociated decisions stay honestly unassociated after restart; no purpose is inferred or reissued',async t=>{
  const f=await fixture(t);await accept(f.host,f.host.enqueue('decision','brain:reflex',f.decision));
  const replay=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);replay.boot();
  assert.deepEqual(replay.intentHistoryOf('s_A').attempts,{});assert.equal(replay.engine.programOf('h_A'),f.host.engine.programOf('h_A'));
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-admission-v2').length,0);
});

test('physical recovery retains historical admission while excluding its failed physical decision',async t=>{
  const wrap=(engine:Engine)=>{let armed=false;const perform=engine.perform.bind(engine),step=engine.step.bind(engine);
    engine.perform=program=>{if(program.label==='admission fault')armed=true;return perform(program);};
    engine.step=()=>{if(armed)throw new Error('fixture physical failure');return step();};return engine;};
  const factory={...toyFactory,create:world=>wrap(toyFactory.create(world)),restore:snapshot=>wrap(toyFactory.restore(snapshot))} satisfies EngineFactory;
  const f=await fixture(t,factory);f.host.saveSnapshot(true);
  const decision={...f.decision,label:'admission fault',option:'rest',card:'rest',target:null,approachLen:0,steps:[{verb:'rest',params:{seconds:1}}]};
  await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',decision,f.ref,()=>true));const expected=f.host.intentHistoryOf('s_A');
  f.host.tickOnce();const recovery=f.db.events(f.host.worldId).find(e=>e.payload?.recovery);assert.ok(recovery);
  assert.ok(!recovery.payload.recovery.events.some((e:any)=>e.kind==='decision'));assert.ok(recovery.payload.recovery.events.some((e:any)=>e.kind==='intent-admission-v2'));
  assert.deepEqual(f.host.intentHistoryOf('s_A'),expected);assert.equal(f.host.engine.programOf('h_A'),null,'historical admission is not current execution');
  const restarted=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);restarted.boot();assert.deepEqual(restarted.intentHistoryOf('s_A'),expected);
});

for(const phase of ['before-fact','after-fact','before-apply','after-apply'] as const)test(`real native worker termination ${phase} preserves the atomic decision/admission boundary`,async t=>{
  const f=await fixture(t,native,true),worker=new Worker(new URL('../test/fixtures/intent-admission-worker.ts',import.meta.url),{workerData:{path:f.path,phase},execArgv:[]});
  t.after(()=>worker.terminate());const code=await new Promise<number>((resolve,reject)=>{worker.once('error',reject);worker.once('exit',resolve);});assert.equal(code,23);
  const restarted=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);restarted.boot();
  const committed=phase==='before-apply'||phase==='after-apply';
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,committed?1:0);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-admission-v2').length,committed?1:0);
  assert.equal(!!restarted.engine.programOf('h_A'),committed);
  const attempts=Object.values(restarted.intentHistoryOf('s_A').attempts);assert.equal(attempts.length,committed?1:0);
  if(committed){assert.equal(attempts[0].phase,'accepted');assert.equal(restarted.engine.programOf('h_A'),attempts[0].activityId);
    restarted.tickOnce();assert.equal(Object.values(restarted.intentHistoryOf('s_A').attempts)[0].phase,'started');}
  const second=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);second.boot();assert.deepEqual(second.intentHistoryOf('s_A'),restarted.intentHistoryOf('s_A'));
  assert.equal(second.engine.stateHash(),restarted.engine.stateHash());assert.equal(f.db.paidCost(),0);
});

test('an actual executing native action establishes start and terminal program establishes completion through snapshot continuation',async t=>{
  const f=await fixture(t),will=f.host.intentWillSeqOf('s_A');
  await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
  const program=f.host.engine.programOf('h_A')!;assert.equal(f.host.engine.programAction?.(program),null,'admission precedes lowering/execution');
  f.host.tickOnce();const observed=f.host.engine.programAction?.(program);assert.ok(observed);assert.equal(observed.action.status,'executing');
  const hash=f.host.engine.stateHash(),snapshot=JSON.stringify(f.host.engine.snapshot());
  const copy=f.host.engine.programAction!(program)!;copy.action.status='failed';copy.action.verb='mutated';copy.actor='other';
  assert.equal(f.host.engine.programAction!(program)!.action.status,'executing');assert.equal(f.host.engine.stateHash(),hash);assert.equal(JSON.stringify(f.host.engine.snapshot()),snapshot,'observer cannot alter checkpoint data');
  const started=f.db.events(f.host.worldId).find(e=>e.kind==='intent-controller-v2');assert.ok(started);assert.equal(started.payload.phase,'started');
  assert.equal(started.payload.observation.action.id,observed.action.id);assert.equal(started.payload.observation.actor,'h_A');
  assert.equal(f.host.intentWillSeqOf('s_A'),will,'actual progress is not a new human intention');
  f.host.saveSnapshot(true);const resumed=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);assert.equal(resumed.boot().from,'snapshot');
  const attempt=intentControllerFactV2(started).outcome.attemptId;
  for(let i=0;i<2000 && resumed.intentHistoryOf('s_A').attempts[attempt].phase!=='completed';i++)resumed.tickOnce();
  assert.equal(resumed.intentHistoryOf('s_A').attempts[attempt].phase,'completed');assert.equal(resumed.engine.programOf('h_A'),null);
  assert.deepEqual(resumed.extra.intentActivityBindingsV2,{},'terminal bindings leave the per-tick observation index');
  assert.equal(resumed.intentHistoryOf('s_A').intents[f.ref.intentId].status,'active','native program completion does not fulfil a broader purpose');
  const facts=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.deepEqual(facts.map(e=>e.payload.phase),['started','completed']);
  for(const e of facts){assert.equal(e.payload.admissionSeq,started.payload.admissionSeq);assert.ok(!JSON.stringify(publicEvent(e)).includes(f.ref.intentId));assert.ok(!JSON.stringify(publicEvent(e)).includes(observed.action.id));}
  resumed.saveSnapshot(true);f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  const replayed=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);assert.equal(replayed.boot().from,'genesis');
  assert.deepEqual(replayed.intentHistoryOf('s_A'),resumed.intentHistoryOf('s_A'));assert.equal(replayed.engine.stateHash(),resumed.engine.stateHash());
  assert.deepEqual(resumed.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
  t.diagnostic(`actual native start=${started.tick}; completion=${facts[1].tick}; one start across snapshot; paid=$0`);
});

test('native step callback before refused lowering produces no false start, while wait-only completion remains explicitly unobserved',async t=>{
  await t.test('target disappears',async child=>{
    const f=await fixture(child);await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
    const events:any[]=[];f.host.listeners.push({onProgram:e=>events.push(e)});f.host.engine.removeEntity('campfire');f.host.tickOnce();
    assert.ok(events.some(e=>e.kind==='step'));assert.ok(events.some(e=>e.kind==='failed'));
    const facts=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.deepEqual(facts.map(e=>e.payload.phase),['blocked']);
    assert.equal(intentControllerFactV2(facts[0]).outcome.evidence.kind,'controller');
  });
  await t.test('wait only',async child=>{
    const f=await fixture(child),decision={...f.decision,card:undefined,steps:[{verb:'rest',params:{seconds:0.5}}]};
    await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',decision,f.ref,()=>true));const program=f.host.engine.programOf('h_A')!;
    for(let i=0;i<15;i++){f.host.tickOnce();assert.equal(f.host.engine.programAction?.(program),null);}
    assert.equal(f.host.engine.programOf('h_A'),null);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2').length,0);
    assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'accepted','no executing-action evidence, no fabricated completion');
  });
});

test('actual cancellation after withdrawal or a newer edit preserves the old physical terminal observation',async t=>{
  for(const change of ['withdraw','edit','before-start'] as const)await t.test(change,async child=>{
    const f=await fixture(child);await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
    const program=f.host.engine.programOf('h_A')!;if(change!=='before-start')f.host.tickOnce();
    const request=await accept(f.host,f.publisher.receive(f.scope,change==='edit'
      ?{contract:INTENT_V2,requestId:'edit',op:'upsert',edit:{intentId:f.ref.intentId,expectedVersion:1},words:'PRIVATE_NEW optional rest'}
      :{contract:INTENT_V2,requestId:'withdraw',op:'withdraw',edit:{intentId:f.ref.intentId,expectedVersion:1}}));assert.ok(request.reservation.created);
    await accept(f.host,f.publisher.publish(f.scope,request.reservation,change==='edit'?{summary:'Rest optionally.',agenda:[{card:'rest',target:null}],trigger:{kind:'none'}}:undefined));
    // Producer proof: withdrawal itself is not yet a physical cancellation adapter.
    f.host.engine.stop(program);f.host.tickOnce();
    const attempts=Object.values(f.host.intentHistoryOf('s_A').attempts);assert.equal(attempts.length,1);assert.equal(attempts[0].phase,'interrupted');assert.deepEqual(attempts[0].intent,f.ref);
    const entry=f.host.intentHistoryOf('s_A').intents[f.ref.intentId];assert.equal(entry.status,change==='edit'?'active':'withdrawn');assert.equal(entry.revision.version,change==='edit'?2:1);
    const facts=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.deepEqual(facts.map(e=>e.payload.phase),change==='before-start'?['interrupted']:['started','interrupted']);
    assert.deepEqual(f.host.engine.runtime.violations,[]);
  });
});

test('controller persistence failure reports history uncertainty without physical recovery, fabricated completion or repeated error',async t=>{
  const f=await fixture(t);await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));f.host.tickOnce();
  const append=f.db.appendEvent.bind(f.db),error=console.error,messages:string[]=[];t.after(()=>{f.db.appendEvent=append;console.error=error;});
  console.error=(...args)=>messages.push(args.map(String).join(' '));
  f.db.appendEvent=(world,event)=>{if(event.kind==='intent-controller-v2' && event.payload.phase==='completed')throw new Error('PRIVATE_WRITER_DETAIL');append(world,event);};
  for(let i=0;i<2000 && f.host.engine.programOf('h_A');i++)f.host.tickOnce();for(let i=0;i<20;i++)f.host.tickOnce();
  assert.equal(f.host.engine.programOf('h_A'),null);assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'started');
  assert.equal(messages.length,1);assert.ok(!messages[0].includes('PRIVATE_WRITER_DETAIL'));
  assert.ok(!f.db.events(f.host.worldId).some(e=>e.payload?.recovery));assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.equal(f.db.paidCost(),0);
});

test('controller schema requires actual executing-action or exact terminal kind, and future origins are refused',()=>{
  const p={contract:INTENT_V2,worldId:'w',soulId:'s',intent:{intentId:'i',version:1},attemptId:'a',activityId:'p1',admissionSeq:2,phase:'started',observation:{tick:1,actor:'h',action:{id:'x',verb:'walk_to',status:'executing'}}};
  assert.ok(intentControllerPayloadV2Schema.safeParse(p).success);
  assert.ok(!intentControllerPayloadV2Schema.safeParse({...p,observation:{...p.observation,action:{...p.observation.action,status:'requested'}}}).success);
  assert.ok(!intentControllerPayloadV2Schema.safeParse({...p,phase:'completed'}).success);
  assert.throws(()=>intentControllerFactV2({kind:'intent-controller-v2',seq:3,tick:0,payload:p}),/future/);
});

test('actual native controller facts stay private through public Hono routes, anonymous WebSocket and takes',async t=>{
  const f=await fixture(t),cfg={...config,worldId:f.host.worldId,brainMode:'fake' as const,typesafeKey:undefined,anthropicKey:undefined,budgetUsdPerDay:0,privyAppId:'',privyAppSecret:''};
  f.host.minds.get('s_A')!.nextEvalTick=1e9;
  const auth=new Auth(cfg,f.db);auth.devAuth=true;
  const server=createServer((_,res)=>res.end('fixture')),hub=new Hub(server,f.host,auth,f.db);
  const brain=new Brain(f.host,f.db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}});hub.brain=brain;
  const souls=new Souls(f.host,f.db,brain,cfg),app=buildApp({cfg,db:f.db,host:f.host,auth,hub,brain,souls});
  await new Promise<void>(resolve=>server.listen(4954,'127.0.0.1',resolve));
  const ws=new WebSocket('ws://127.0.0.1:4954/ws'),messages:any[]=[];ws.on('message',data=>messages.push(JSON.parse(String(data))));
  t.after(async()=>{ws.terminate();hub.wss.close();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  await once(ws,'open');const welcome=once(ws,'message');ws.send(JSON.stringify({t:'hello',proto:1}));await welcome;
  // Subscribe before admission/ticks: scheduler turns do not prove socket delivery.
  const controllerBatch=new Promise<void>((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(deadline);ws.off('message',onMessage);ws.off('error',onError);ws.off('close',onClose);};
    const finish=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
    const onMessage=(data:WebSocket.RawData)=>{try{const m=JSON.parse(String(data));if(m.t==='batch'&&Array.isArray(m.log)&&m.log.some((e:any)=>e.kind==='intent-controller-v2'))finish();}catch{finish(new Error('anonymous WebSocket delivered invalid JSON'));}};
    const onError=(error:Error)=>finish(error),onClose=()=>finish(new Error('anonymous WebSocket closed before the controller batch'));
    const deadline=setTimeout(()=>finish(new Error('anonymous WebSocket controller batch was not delivered within 2000 ms')),2000);
    ws.on('message',onMessage);ws.on('error',onError);ws.on('close',onClose);t.after(cleanup);
  });
  await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));for(let i=0;i<350;i++)f.host.tickOnce();
  await controllerBatch;
  assert.ok(messages.some(m=>m.t==='batch' && m.log.some((e:any)=>e.kind==='intent-controller-v2')));
  const native=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.deepEqual(native.map(e=>e.payload.phase),['started','completed']);
  for(const path of ['/v1/log','/v1/kernel','/v1/world','/v1/debug/world','/v1/take','/v1/takes']){const response=await app.request(path);assert.equal(response.status,200);messages.push(await response.json());}
  const text=JSON.stringify(messages);for(const marker of ['PRIVATE_WORDS','PRIVATE_MEANING','PRIVATE_PRINCIPAL',f.ref.intentId])assert.ok(!text.includes(marker),marker);
  for(const message of messages)if(message.t==='batch')for(const e of message.log)if(e.kind==='intent-controller-v2')assert.deepEqual(Object.keys(e.payload).sort(),['op','privateUpdate','seq','soulId','tick','worldId']);
  assert.equal(f.db.paidCost(),0);
});

for(const phase of ['before-fact','after-fact'] as const)test(`real native worker termination ${phase} of controller start replays one program and its actual evidence`,async t=>{
  const f=await fixture(t,native,true);await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
  const worker=new Worker(new URL('../test/fixtures/intent-controller-worker.ts',import.meta.url),{workerData:{path:f.path,phase},execArgv:[]});t.after(()=>worker.terminate());
  assert.equal(await new Promise<number>((resolve,reject)=>{worker.once('error',reject);worker.once('exit',resolve);}),24);
  const restarted=new WorldHost(f.db,native,'admission-fixture',1e9,f.host.worldId);restarted.boot();
  // Append now belongs to the publication transaction. Either exit rolls back
  // the fact, while the earlier captured observation survives separately.
  const out=Object.values(restarted.intentHistoryOf('s_A').attempts)[0];assert.equal(out.phase,'accepted');
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2').length,0);
  const captured=f.db.db.prepare('SELECT observation_tick,published_seq FROM intent_observations_v2').get()!;
  assert.equal(captured.observation_tick,1);assert.equal(captured.published_seq,null);
  restarted.tickOnce();assert.equal(Object.values(restarted.intentHistoryOf('s_A').attempts)[0].phase,'started');
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2').length,1);assert.equal(restarted.engine.programAction?.(out.activityId!)?.action.status,'executing');
  assert.equal(f.db.paidCost(),0);
});
