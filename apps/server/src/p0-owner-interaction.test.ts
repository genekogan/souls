import {HUMAN_PROFILE} from '../../../mars/viewer/engine/spatial/types.ts';
import {SHORE_POLICY} from '../../../mars/viewer/engine/locomotion/shore.ts';
// P0 October 6: exact saved Alice failures. "go to the classroom" was refused
// while she slept during quiet renewal; "go for a swim in the pond" had no
// registered swim binding and the model plan failed schema. Fake minds, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES,edenLectureFactoryV1,edenGroundFactoryV1,commonsNewcomerResourcesFactory} from '@souls/engine-mars';
import {readFileSync,writeFileSync} from 'node:fs';
import type {SoulRow} from './db.ts';
import {installEdenSteeringModeV1} from './eden-steering-mode.ts';
import {humanCompilerOutputV1Schema,type ActionRecord} from '@souls/engine-contract';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
import {basicHumanGoalV1,readHumanCapabilitiesV1} from './human-capabilities.ts';
import {normalizeModelOutputV1} from './human-compiler.ts';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function setup(t:TestContext,start:'standing'|'asleep'){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow directions and rest.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic owner'}));
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());f.brain.quiesce();
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true});
 t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});await installCommonsProvisionCards(f.host,brain);
 await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await accept<unknown>(f.host,f.host.enableIntentExecutionRetentionV1());await accept<unknown>(f.host,f.host.enableIntentNativeSequenceCompletionV1());await accept<unknown>(f.host,f.host.enableIntentHumanSleepTransitionV1());
 const body=()=>(f.host.engine.world as NativeWorld).entities[row.entity_id];
 if(start==='asleep'){
  await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:row.id,entityId:row.entity_id,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-1',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[0].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  for(let i=0;i<3000&&body().human?.sleepPose?.standingFraction!==0;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(body().human?.sleepPose?.standingFraction,0);
 }
 const service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const submit=async(requestId:string,words:string)=>{await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId,words}));await accept(f.host,service.settled());return service.lookup(scope,requestId);};
 const mind=()=>f.host.minds.get(row.id)!;
 const attempts=(intentId:string)=>Object.values(f.host.intentHistoryOf(row.id).attempts).filter(a=>a.intent.intentId===intentId);
 return {...f,brain,row,body,service,scope,submit,mind,attempts};
}
async function run(f:Awaited<ReturnType<typeof setup>>,ticks:number,until:()=>boolean){for(let i=0;i<ticks&&!until();i++){f.host.tickOnce();if(i%20===0)await setImmediate();}return until();}

test('asleep during quiet renewal: walk is accepted with the specific condition, waits, then natively walks and completes',async t=>{
 const f=await setup(t,'asleep');const day=f.host.living!.lastDay;
 await accept(f.host,f.host.enqueue('rules','world',{quiet:true,day,why:'overdue quiet checkpoint'}));assert.equal(f.host.quietBarrier,true);
 const before=f.host.engine.stateHash(),receipt=await f.submit('p0-classroom-equivalent','go to commons-bench-west');
 assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
 assert.match(receipt.revision.interpretation.summary,/Alice is asleep while Eden quietly renews before first light/);assert.match(receipt.revision.interpretation.summary,/Walk to /);
 assert.equal(f.host.engine.stateHash(),before,'acceptance must not move or wake the sleeper');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,0);
 const intentId=receipt.revision.intentId;
 assert.ok(await run(f,20000,()=>!f.host.quietBarrier),'renewal finishes on its own');
 assert.ok(await run(f,4000,()=>f.attempts(intentId).some(a=>a.phase==='completed')),JSON.stringify(f.attempts(intentId)));
 const done=f.attempts(intentId).find(a=>a.phase==='completed')!;assert.ok(done.tick>0);
 const bench=(f.host.engine.world as NativeWorld).entities['commons-bench-west'];if(bench){const p=f.body().pose.p;assert.ok(Math.hypot(p[0]-bench.pose.p[0],p[2]-bench.pose.p[2])<4,'arrived near the named target');}
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic(`accepted during quiet; completed tick=${done.tick}`);
});

test('asleep without quiet: wake-first path still used (no regression)',async t=>{
 const f=await setup(t,'asleep'),receipt=await f.submit('wake','go to commons-bench-west');assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('no plan');
 assert.match(receipt.revision.interpretation.summary,/^Wake safely first/);
 assert.ok(await run(f,300,()=>f.body().human?.activity==='walk'));assert.equal(f.db.paidCost(),0);
});

test('seated and moving starting states: walk is accepted, body safely transitions and arrives',async t=>{
 for(const [start,words] of [['seated','go to shore-bank'],['moving','go to commons-bench-west'],['seated','go for a swim in the pond']] as const)await t.test(start+': '+words,async child=>{
  const f=await setup(child,'standing');
  const steps=start==='seated'?[{verb:'sit',params:{on:'commons-bench-west',seconds:600}}]:[{verb:'walk_to',params:{to:'shore-bank'}}];
  await accept(f.host,f.host.enqueue('decision','fixture:'+start,{soulId:f.row.id,entityId:f.row.entity_id,option:start,label:start,steps,reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  assert.ok(await run(f,3000,()=>start==='seated'?f.body().human?.activity==='sit':f.body().human?.activity==='walk'),'fixture reached '+start);
  const receipt=await f.submit('go-'+start,words);
  assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
  const intentId=receipt.revision.intentId;
  assert.ok(await run(f,6000,()=>f.attempts(intentId).some(a=>a.phase==='completed')),JSON.stringify({summary:receipt.revision.interpretation.summary,attempts:f.attempts(intentId)}));
  assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
  child.diagnostic(`${start}: ${receipt.revision.interpretation.summary}`);
 });
});

test('exact swim words: supported pond binding, native admission/start/completion with actual swimming',async t=>{
 const f=await setup(t,'standing'),receipt=await f.submit('p0-swim','go for a swim in the pond');
 assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
 assert.deepEqual(receipt.revision.interpretation.humanGoalPlan?.kind==='planned'&&receipt.revision.interpretation.humanGoalPlan.goals,[{goal:'activity',bindingId:'activity:swim:shore-water'}]);
 const intentId=receipt.revision.intentId,seen=new Set<string>(),water={swim:0,tread:0};
 assert.ok(await run(f,8000,()=>{const a=f.body().human?.activity;if(a)seen.add(a);if(a==='swim'||a==='tread')water[a]++;return f.attempts(intentId).some(x=>x.phase==='completed');}),JSON.stringify({attempts:f.attempts(intentId),seen:[...seen]}));
 assert.ok(water.swim>=water.tread,'mostly moving swim, not treading in place: '+JSON.stringify(water));t.diagnostic('in-water ticks '+JSON.stringify(water));
 assert.ok(seen.has('swim'),'body actually swam: '+[...seen].join(','));
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('activities observed: '+[...seen].join(','));
});

test('swim paraphrases and classroom phrasing resolve without a model; unsafe forms do not',async t=>{
 const f=await setup(t,'standing'),read=readHumanCapabilitiesV1(f.host,f.mind(),{registeredActivitiesV1:true});
 for(const words of ['go for a swim in the pond','Go swimming.','take a dip in the pond','swim','please go for a swim now','have a swim in the water','go to the pond for a swim','swim in the lake']){
  const out=basicHumanGoalV1(words,read,false);assert.deepEqual(out?.goal,{goal:'activity',bindingId:'activity:swim:shore-water'},words);
 }
 assert.match(basicHumanGoalV1('swim in the lake',read,false)!.note!,/lake here is scenery/);
 assert.equal(basicHumanGoalV1('swim in the lake',read,true),null,'strict other water is not silently substituted');
 for(const words of ["don't swim",'swim tomorrow','swim when it is warm'])assert.equal(basicHumanGoalV1(words,read,false)?.goal?.goal==='activity',false,words);
 for(const words of ['head to commons-bench-west','walk over to commons-bench-west','go back to commons-bench-west'])assert.equal(basicHumanGoalV1(words,read,false)?.goal?.goal,'walk',words);
});

test('model plan missing optional structure is normalized; no_action extras dropped; future words still refused later',()=>{
 const hash='a'.repeat(64);
 assert.equal(humanCompilerOutputV1Schema.safeParse({kind:'plan',goals:[{goal:'activity',bindingId:'activity:swim:shore-water'}],explanation:'Swim.'}).success,false,'raw missing registryHash fails');
 const plan=humanCompilerOutputV1Schema.parse(normalizeModelOutputV1({kind:'plan',goals:[{goal:'activity',bindingId:'activity:swim:shore-water'}],explanation:'Swim.'},hash));
 assert.equal(plan.kind,'plan');if(plan.kind==='plan'){assert.deepEqual(plan.trigger,{kind:'now'});assert.equal(plan.registryHash,hash);}
 assert.equal(humanCompilerOutputV1Schema.safeParse(normalizeModelOutputV1({kind:'no_action',reason:'needs_clarification',explanation:'Which?',trigger:{kind:'now'},goals:[]},hash)).success,true);
 assert.equal(humanCompilerOutputV1Schema.safeParse(normalizeModelOutputV1({kind:'plan',goals:[{goal:'swim'}],explanation:'x'},hash)).success,false,'unknown goal still fails');
});

test('G414 own-request diagnostics: strict scoped DTO with canonical attempts; foreign and anonymous get nothing',async t=>{
 const {ownRequestDiagnosticsV1Schema}=await import('./own-request-diagnostics.ts');
 const f=await setup(t,'standing'),receipt=await f.submit('diag-swim','go for a swim in the pond');assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('no plan');
 await run(f,8000,()=>f.attempts(receipt.revision.intentId).some(a=>a.phase==='completed'));
 const app=buildApp({cfg:{...f.brain.cfg,build:'p0-test-build'},db:f.db,host:f.host,auth:f.auth,brain:f.brain,souls:f.souls,intentV2:f.service,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub}),path=(id:string)=>`/v1/souls/${f.row.id}/intent-v2/requests/${id}/diagnostics`,get=(id:string,auth?:string)=>app.request(path(id),auth?{headers:{authorization:auth}}:{});
 const res=await get('diag-swim','Bearer dev:alice');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');const dto=ownRequestDiagnosticsV1Schema.parse(await res.json());
 assert.equal(dto.stage,'understood');assert.equal(dto.words,'go for a swim in the pond');assert.equal(dto.soulId,f.row.id);assert.equal(dto.entityId,f.row.entity_id);assert.equal(dto.source.ownerId,'dev:alice');
 assert.equal(dto.resolution?.goal,'activity');assert.equal(dto.resolution?.bindingId,'activity:swim:shore-water');assert.equal(dto.resolution?.destination,'Swim in the supported pond');
 assert.deepEqual(['accepted','started','completed'].map(p=>dto.attempts?.some(a=>a.phase===p)),[true,true,true],JSON.stringify(dto.attempts));
 assert.ok(dto.server.createdAt>0&&dto.server.updatedAt>=dto.server.createdAt);assert.equal(dto.server.build,'p0-test-build');
 const text=JSON.stringify(dto);for(const secret of ['sim_','apiKey','anthropic','raw','reasoning'])assert.ok(!text.includes(secret),secret);
 const refused=await f.submit('diag-unknown','teleport me to the moon base');assert.equal(refused.phase,'refused');
 const r=ownRequestDiagnosticsV1Schema.parse(await (await get('diag-unknown','Bearer dev:alice')).json());assert.equal(r.stage,'refused');assert.ok(r.code);assert.ok(r.validation||r.unavailable?.some(u=>u.field==='validation'));
 await invite(f,'bob');assert.equal((await get('diag-swim','Bearer dev:bob')).status,404);
 assert.ok([401,404].includes((await get('diag-swim')).status));assert.equal((await get('no-such','Bearer dev:alice')).status,404);
 if(process.env.P0_DIAGNOSTICS_OUT)(await import('node:fs')).writeFileSync(process.env.P0_DIAGNOSTICS_OUT,JSON.stringify({scope:{worldId:f.host.worldId,soulId:f.row.id,ownerId:'dev:alice',entityId:f.row.entity_id},understood:dto,refused:r}));
 t.diagnostic(JSON.stringify({unavailable:dto.unavailable?.map(u=>u.field),refusedCode:r.code}));
});

// Lecture fixture copied from eden-lecture-owner-control.test.ts (same factory/installs).
async function lectureSetup(t:any,nativeContext=false,pond?:{skipSoul:(soulId:string)=>boolean}){const factory=nativeSleepSnapshotFactoryV1(edenLectureFactoryV1(commonsNewcomerResourcesFactory(await edenGroundFactoryV1(await retainedCommonsShoreFactory({socialEdenV1:true,foodDeliveryV1:true}))))),f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();f.souls.cfg.maxSoulsPerUser=9;f.souls.enableLifecycle();await invite(f,'operator');await invite(f,'other');const rows:SoulRow[]=[];for(let i=0;i<9;i++){
  if(!pond){rows.push(await accept(f.host,f.souls.create('dev:operator',{name:'Owned class '+i,description:'Synthetic same human owner lecture roster'})));continue;}
  // Existing lifecycle journal seam pins identity without mocking auth/randomness.
  // Consecutive public labels are chosen before the single qualification attempt.
  const soulId='s_pond_'+String(i).padStart(2,'0'),entityId='h_pond_'+String(i).padStart(2,'0'),requestId='lc_'+String(i+1).padStart(32,'0');
  const runner=f.souls.lifecycle!,scope={worldId:f.host.worldId,soulId,entityId,owner:'dev:operator'};
  runner.journal.acceptCreate(scope,requestId,{name:'Owned class '+i,description:'Synthetic same human owner lecture roster',native:false},()=>true);runner.pump();
  for(let j=0;j<50&&!f.souls.controlReady(f.db.soul(soulId)!);j++){await setImmediate();f.host.drainInputs();runner.pump();}
  const row=f.db.soul(soulId)!;assert.equal(f.souls.controlReady(row),true,'fixed lifecycle birth is physically admitted');assert.equal(runner.faults.size,0);rows.push(row);
 }for(const method of ['installCommonsProvisionsV1','installCommonsKitchenV1','installRetainedCommonsShoreV1'] as const)await accept<unknown>(f.host,f.host[method]());const layout=JSON.parse(readFileSync(new URL('../../../packages/engine-mars/src/fixtures/newcomer-layout.world-alternative.v2.json',import.meta.url),'utf8'));await accept(f.host,f.host.installCommonsNewcomerResourcesV1(layout.placements));await accept(f.host,f.host.installNativeSleepSnapshotV1());await accept(f.host,f.host.installEdenGroundV1());await accept(f.host,f.host.installEdenLectureV1({worldEast:'world-v2',id:'eden-classroom-1',origin:[42,-6],yaw:0,audienceSeats:20,lesson:'Learn from a world with a memory.'}));
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true,nativeActivityContextV1:nativeContext,...(pond?{skipMind:m=>pond.skipSoul(m.soulId)}:{})}),service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true});await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await installEdenSteeringModeV1(f.host,{closedGoalsV1:true,registeredActivitiesV1:true});const leader=f.host.minds.get(rows[0].id)!;t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});return {...f,brain,service,leader,rows,factory};}
// (busy lecture-preparation case removed with the central readiness-offer cards in the edge vacuum pass)

async function pondOwnerPrograms(t:TestContext){
 const originalIntents=new Map<string,string>();let evaluationHost:ReturnType<typeof fixture>['host']|undefined;
 const f=await lectureSetup(t,false,{skipSoul:soulId=>{const intentId=originalIntents.get(soulId);return !intentId||!evaluationHost||Object.values(evaluationHost.intentHistoryOf(soulId).attempts).some(a=>a.intent.intentId===intentId&&a.phase==='completed');}});evaluationHost=f.host;const scopeOf=(row:SoulRow)=>f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const body=(row:SoulRow)=>(f.host.engine.world as NativeWorld).entities[row.entity_id];
 const tick=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%10===0)await setImmediate();}return until();};
 // Match main.ts and tools/core/edge-server.mjs before any pond setup/owner programmes.
 await accept<unknown>(f.host,f.host.enableQuietStallReleaseV1());
 await accept<unknown>(f.host,f.host.enableYieldTimeoutV1());
 const host=f.rows[1];
 await accept(f.host,f.host.enqueue('decision','fixture:bank-gathering',{soulId:host.id,entityId:host.entity_id,option:'host a gathering@shore-bank',label:'host a gathering at the bank',steps:[{verb:'walk_to',params:{to:'shore-bank'}},{verb:'gather',params:{at:'shore-bank',seconds:600}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 assert.ok(await tick(4000,()=>{const p=body(host).pose.p;return Math.hypot(p[0]+37.5,p[2])<2&&body(host).human?.activity!=='walk';}),'host stands at the bank centre: '+JSON.stringify(body(host).pose.p));
 const swimmers=f.rows.slice(2,6),ids:string[]=[];
 const originalStarts=swimmers.map(row=>({soulId:row.id,entityId:row.entity_id,position:body(row).pose.p.slice()}));
 for(const row of swimmers){await accept(f.host,f.service.submit(scopeOf(row),{contract:'soul-intent/2',op:'upsert',requestId:'swim-'+row.id,words:'go for a swim'}));await accept(f.host,f.service.settled());const r=f.service.lookup(scopeOf(row),'swim-'+row.id);assert.equal(r.phase,'understood',JSON.stringify(r));if(r.phase!=='understood')throw Error('no plan');ids.push(r.revision.intentId);originalIntents.set(row.id,r.revision.intentId);await f.brain.evaluate(f.host.minds.get(row.id)!,'new-intent-v2');f.host.drainInputs();}
 const intervals:{tick:number;soulId:string;activity:string;activityId:string|null;original:boolean}[]=[];const lastActivity=new Map<string,string>();
 const originalProgram=(row:SoulRow)=>{const execution=f.host.unfinishedHumanGoalExecutionV1(row.id);return execution?.intent.intentId===originalIntents.get(row.id)?execution:null;};
 const swam=new Map<string,boolean>(),checkedGoals=new Set<string>();let goalAdmissions=0,minimumGoalSpacing=Infinity;
 const pond=f.host.engine.world.regions['shore-water'].polygon,insidePond=(x:number,z:number)=>{let inside=false;for(let i=0,j=pond.length-1;i<pond.length;j=i++){const a=pond[i],b=pond[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
 const moveGoal=(record:ActionRecord)=>{if(record.parent||!['commons_shore_travel','shore_travel','walk_to'].includes(record.verb)||!record.params||typeof record.params!=='object'||Array.isArray(record.params))return null;const p=record.params as Record<string,unknown>;return typeof p.actor==='string'&&typeof p.x==='number'&&typeof p.z==='number'?{actor:p.actor,x:p.x,z:p.z}:null;};
 const checkAdmittedGoals=()=>{const live=new Set(f.host.engine.runtime.liveIds());for(const record of f.host.engine.runtime.records.values()){
  if(checkedGoals.has(record.id)||!live.has(record.id))continue;const goal=moveGoal(record),row=goal?swimmers.find(row=>row.entity_id===goal.actor):undefined;if(!goal||!row||!insidePond(goal.x,goal.z))continue;
  const pending=f.host.minds.get(row.id)?.pending,action=pending?f.host.engine.programAction?.(pending.program):null,card=pending?f.host.kernel.vocab.cards[pending.card]:undefined,step=action&&card?[...card.approach,...card.during][action.step]:undefined;
  if(action?.action.id!==record.id||!['pond/1','pond-lap/1'].includes(String(step?.params?.spread)))continue;checkedGoals.add(record.id);goalAdmissions++;

  const distances=Object.values(f.host.engine.world.entities).filter(e=>e.human&&e.id!==goal.actor).map(e=>Math.hypot(goal.x-e.pose.p[0],goal.z-e.pose.p[2]));
  for(const other of f.host.engine.runtime.records.values()){if(!live.has(other.id))continue;const target=moveGoal(other);if(target&&target.actor!==goal.actor)distances.push(Math.hypot(goal.x-target.x,goal.z-target.z));}
  const spacing=Math.min(...distances);minimumGoalSpacing=Math.min(minimumGoalSpacing,spacing);assert.ok(spacing>=1.4-1e-9,'new pond destination is spaced from other bodies and admitted goals '+JSON.stringify({tick:f.host.engine.world.tick,goal,spacing}));
 }};
 let most=0,ps:number[][]=[],peakTick=0,peakActivities:string[]=[],minimumConcurrent=Infinity,minimumTreading=Infinity;const completed=()=>swimmers.every((row,i)=>Object.values(f.host.intentHistoryOf(row.id).attempts).some(x=>x.intent.intentId===ids[i]&&x.phase==='completed'));const ok=await tick(14000,()=>{checkAdmittedGoals();for(const r of swimmers){const activity=body(r).human?.activity??'',execution=originalProgram(r),key=activity+':'+(execution?.activityId??'none');if(lastActivity.get(r.id)!==key){intervals.push({tick:f.host.engine.world.tick,soulId:r.id,activity,activityId:execution?.activityId??null,original:!!execution});lastActivity.set(r.id,key);}if(activity==='swim'&&execution)swam.set(r.id,true);}const inWater=swimmers.filter(r=>['tread','swim'].includes(body(r).human?.activity??'')),originalInWater=inWater.filter(r=>originalProgram(r));for(let i=0;i<inWater.length;i++)for(let j=i+1;j<inWater.length;j++){const a=body(inWater[i]),b=body(inWater[j]),distance=Math.hypot(a.pose.p[0]-b.pose.p[0],a.pose.p[2]-b.pose.p[2]);minimumConcurrent=Math.min(minimumConcurrent,distance);if(a.human?.activity==='tread'&&b.human?.activity==='tread')minimumTreading=Math.min(minimumTreading,distance);}if(originalInWater.length>most){most=originalInWater.length;ps=originalInWater.map(r=>[...body(r).pose.p]);peakTick=f.host.engine.world.tick;peakActivities=originalInWater.map(r=>body(r).human!.activity);}return most>=3&&completed();});
 t.diagnostic(JSON.stringify({fixture:'commons-approach',originalStarts,headTick:f.host.engine.world.tick,peakOriginalSwimmers:most,peakTick,peakActivities,peakPositions:ps,minimumConcurrent,minimumTreading,goalAdmissions,minimumGoalSpacing,intervals,attempts:swimmers.map(row=>({soulId:row.id,attempts:Object.values(f.host.intentHistoryOf(row.id).attempts)})),blockedActions:[...f.host.engine.runtime.records.values()].filter(r=>r.status==='blocked').map(r=>({id:r.id,verb:r.verb,params:r.params,diagnostic:r.diagnostic})),decisions:f.db.events(f.host.worldId).filter(e=>e.kind==='decision'&&swimmers.some(row=>row.id===e.payload.soulId)).map(e=>({tick:e.tick,payload:e.payload}))}));
 assert.ok(ok,'original owner water peak='+most+'; all four must naturally complete; measured peak='+most+' '+swimmers.map((r,i)=>body(r).human?.activity+'@'+body(r).pose.p.map(v=>v.toFixed(1)).join(',')+' '+Object.values(f.host.intentHistoryOf(r.id).attempts).filter(x=>x.intent.intentId===ids[i]).map(x=>x.phase+':'+x.tick+(('reason' in x)?':'+x.reason:'')).join('|')).join(' ;; '));
 assert.ok(most>=3,'at least three ORIGINAL owner programmes swim concurrently');
 // Spread endpoints are 1.4m apart, but swimming/turning/obstruction stops use the native swept-capsule bound.
 // Check every concurrent-water tick, rather than one arbitrary first-peak position during transit.
 const physicalSeparation=2*SHORE_POLICY.radius+.02;assert.ok(Number.isFinite(minimumConcurrent)&&minimumConcurrent>=physicalSeparation-1e-9,'native swimmer capsules never overlap '+JSON.stringify({minimumConcurrent,physicalSeparation,peakTick,peakActivities,positions:ps}));
 assert.ok(goalAdmissions>=4,'each swimmer has a separately admitted spaced pond destination');assert.equal(swam.size,4,'all four actually swam');t.diagnostic('peak simultaneous swimmers '+most);assert.ok(Math.hypot(body(host).pose.p[0]+37.5,body(host).pose.p[2])<2,'gathering host was not displaced');
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('four simultaneous swimmers at '+JSON.stringify(ps.map(p=>[p[0],p[2]])));
}

test('pond is multi-occupant: a bank gathering does not block it and four Souls swim, at least three at once, in spaced spots',{timeout:300000},async t=>pondOwnerPrograms(t));

test('a place takes many bodies: someone at the classroom centre does not lock it; four arrive spaced',{timeout:300000},async t=>{
 const f=await lectureSetup(t),scopeOf=(row:SoulRow)=>f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const body=(row:SoulRow)=>(f.host.engine.world as NativeWorld).entities[row.entity_id];
 const tick=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%10===0)await setImmediate();}return until();};
 const region=f.host.engine.world.regions['eden-classroom-1'] as {polygon:[number,number][]},mid=region.polygon.reduce((a,p)=>[a[0]+p[0]/region.polygon.length,a[1]+p[1]/region.polygon.length],[0,0]);
 const parked=f.rows[1];
 await accept(f.host,f.host.enqueue('decision','fixture:stand-at-centre',{soulId:parked.id,entityId:parked.entity_id,option:'stand at the centre',label:'stand at the centre',steps:[{verb:'walk_to',params:{to:'eden-classroom-1'}},{verb:'rest',params:{seconds:600}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 assert.ok(await tick(4000,()=>Math.hypot(body(parked).pose.p[0]-mid[0],body(parked).pose.p[2]-mid[1])<1&&body(parked).human?.activity!=='walk'),'a body occupies the classroom centre');
 const walkers=f.rows.slice(2,6),ids:string[]=[];
 for(const row of walkers){await accept(f.host,f.service.submit(scopeOf(row),{contract:'soul-intent/2',op:'upsert',requestId:'class-'+row.id,words:'go to the classroom'}));await accept(f.host,f.service.settled());const r=f.service.lookup(scopeOf(row),'class-'+row.id);assert.equal(r.phase,'understood',JSON.stringify(r));if(r.phase!=='understood')throw Error('no plan');ids.push(r.revision.intentId);await f.brain.evaluate(f.host.minds.get(row.id)!,'new-intent-v2');f.host.drainInputs();}
 // This owner-arrival fixture stops unrelated fake autonomous choices after all four decisions are accepted.
 // Already accepted native programmes and their truthful intent completion still run on WorldHost ticks.
 f.brain.quiesce();
 const checkedGoals=new Set<string>();let minimumGoalSpacing=Infinity,minimumPhysicalSpacing=Infinity;
 let firstBelowNominalDiameter:unknown=null,worstSpacingCapture:unknown=null;
 const captureSpacing=(a:SoulRow,b:SoulRow,distance:number)=>{
  const active=new Set(f.host.engine.runtime.liveIds()),pair=[a,b].map(row=>{
   const e=body(row),pending=f.host.minds.get(row.id)?.pending,card=pending?f.host.kernel.vocab.cards[pending.card]:undefined;
   return {soulId:row.id,entityId:row.entity_id,name:row.name,pose:structuredClone(e.pose),bodyFamily:e.body?.family??'human',human:{level:e.human?.level,activity:e.human?.activity,speed:e.human?.speed,task:e.human?.task},program:f.host.engine.programOf(row.entity_id),
    acceptedWalkPlan:card?structuredClone([...card.approach,...card.during]):null,
    activeWalkRecords:[...f.host.engine.runtime.records.values()].filter(r=>active.has(r.id)&&r.params&&typeof r.params==='object'&&!Array.isArray(r.params)&&(r.params as {actor?:unknown}).actor===row.entity_id).map(r=>({id:r.id,parent:r.parent,verb:r.verb,status:r.status,params:structuredClone(r.params)}))};
  });
  return {tick:f.host.engine.world.tick,distance,nominalProfileDiameter:2*HUMAN_PROFILE.radius,existingNativeIntrusionBound:2*HUMAN_PROFILE.radius-.02,pair};
 };
 const sample=()=>{
  const entities=[...walkers,parked].map(body);
  for(let i=0;i<entities.length;i++)for(let j=i+1;j<entities.length;j++){
   const distance=Math.hypot(entities[i].pose.p[0]-entities[j].pose.p[0],entities[i].pose.p[2]-entities[j].pose.p[2]);
   if(distance<minimumPhysicalSpacing){minimumPhysicalSpacing=distance;worstSpacingCapture=captureSpacing([...walkers,parked][i],[...walkers,parked][j],distance);}
   if(firstBelowNominalDiameter===null&&distance<2*HUMAN_PROFILE.radius-1e-9)firstBelowNominalDiameter=captureSpacing([...walkers,parked][i],[...walkers,parked][j],distance);
  }
  const active=new Set(f.host.engine.runtime.liveIds());
  for(const record of f.host.engine.runtime.records.values()){
   if(checkedGoals.has(record.id)||record.parent||record.verb!=='walk_to'||!active.has(record.id)||!record.params||typeof record.params!=='object'||Array.isArray(record.params))continue;
   const q=record.params as Record<string,unknown>,row=walkers.find(r=>r.entity_id===q.actor);if(!row||typeof q.x!=='number'||typeof q.z!=='number')continue;
   const pending=f.host.minds.get(row.id)?.pending,action=pending?f.host.engine.programAction?.(pending.program):null,card=pending?f.host.kernel.vocab.cards[pending.card]:undefined,step=action&&card?[...card.approach,...card.during][action.step]:undefined;
   if(action?.action.id!==record.id||step?.params?.spread!=='region/1')continue;
   const x=q.x,z=q.z,distances=Object.values(f.host.engine.world.entities).filter(e=>e.human&&e.id!==q.actor).map(e=>Math.hypot(x-e.pose.p[0],z-e.pose.p[2]));
   for(const other of f.host.engine.runtime.records.values())if(other.id!==record.id&&active.has(other.id)&&!other.parent&&other.verb==='walk_to'&&other.params&&typeof other.params==='object'&&!Array.isArray(other.params)){const p=other.params as Record<string,unknown>;if(p.actor!==q.actor&&typeof p.x==='number'&&typeof p.z==='number')distances.push(Math.hypot(x-p.x,z-p.z));}
   const spacing=Math.min(...distances);minimumGoalSpacing=Math.min(minimumGoalSpacing,spacing);checkedGoals.add(record.id);assert.ok(spacing>=1-1e-9,'each admitted classroom destination is spaced from other bodies and pending goals '+JSON.stringify({tick:f.host.engine.world.tick,actor:q.actor,x,z,spacing}));
  }
 };
 const done=()=>{sample();return walkers.every((row,i)=>Object.values(f.host.intentHistoryOf(row.id).attempts).some(a=>a.intent.intentId===ids[i]&&a.phase==='completed'));};
 assert.ok(await tick(12000,done),walkers.map((r,i)=>body(r).human?.activity+'@'+body(r).pose.p.map(v=>v.toFixed(1)).join(',')+' '+Object.values(f.host.intentHistoryOf(r.id).attempts).filter(x=>x.intent.intentId===ids[i]).map(x=>x.phase+':'+x.tick+(('reason' in x)?':'+x.reason:'')).join('|')).join(' ;; '));
 // MOVEMENT.md §2/limitations documents the published standing-people hard
 // layer as 2r minus 0.02 m. This is a legacy proxy-separation test, not proof
 // of full nominal-diameter or skinned-body nonintersection. Preserve replay.
 const nominalDiameter=2*HUMAN_PROFILE.radius,nativeStandingSeparation=nominalDiameter-.02;
 const physicalDiagnostic={nominalDiameterComparison:{diameter:nominalDiameter,minimumGap:minimumPhysicalSpacing-nominalDiameter,meetsNominalDiameter:minimumPhysicalSpacing>=nominalDiameter-1e-9},documentedNativeStandingSeparation:nativeStandingSeparation,goalAdmissions:checkedGoals.size,minimumGoalSpacing,minimumPhysicalSpacing,firstBelowNominalDiameter,worstSpacingCapture,randomBirthIdsRetained:walkers.map(r=>({soulId:r.id,entityId:r.entity_id}))};
 t.diagnostic('classroom physical spacing '+JSON.stringify(physicalDiagnostic));
 if(process.env.P0_SPACING_DIAGNOSTIC_FILE)writeFileSync(process.env.P0_SPACING_DIAGNOSTIC_FILE,JSON.stringify(physicalDiagnostic,null,2)+'\n',{flag:'wx'});
 assert.ok(checkedGoals.size>=4,'all four have separately admitted classroom destinations');assert.ok(minimumPhysicalSpacing>=nativeStandingSeparation-1e-9,'documented legacy native standing separation holds on every transit tick '+JSON.stringify({minimumPhysicalSpacing,nativeStandingSeparation,nominalDiameter}));
 t.diagnostic(JSON.stringify({goalAdmissions:checkedGoals.size,minimumGoalSpacing,minimumPhysicalSpacing}));
 const ps=[...walkers,parked].map(r=>body(r).pose.p);t.diagnostic(JSON.stringify({tick:f.host.engine.world.tick,positions:ps,activities:[...walkers,parked].map(r=>body(r).human?.activity)}));for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert.ok(Math.hypot(ps[i][0]-ps[j][0],ps[i][2]-ps[j][2])>=.9,'spaced bodies '+JSON.stringify({i,j,distance:Math.hypot(ps[i][0]-ps[j][0],ps[i][2]-ps[j][2]),positions:ps}));
 assert.ok(Math.hypot(body(parked).pose.p[0]-mid[0],body(parked).pose.p[2]-mid[1])<1,'parked body not displaced');
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('classroom arrivals at '+JSON.stringify(walkers.map(r=>[+body(r).pose.p[0].toFixed(1),+body(r).pose.p[2].toFixed(1)])));
});
