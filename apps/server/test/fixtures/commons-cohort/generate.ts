// Bounded actual populated commons: invited local HTTP humans, synthetic compiler,
// fake native chooser, WAL SQLite, opted-in history and durable clock. No providers.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {hashOf} from '@souls/engine-contract';
import {INTENT_V2,intentReceiptV2Schema,intentHistoryPageV1Schema,intentAdmissionFactV2,publicEvent} from '@souls/protocol';
import type {CompileOut,callTool} from '@souls/brain';
import {Db} from '../../../src/db.ts';
import {WorldHost} from '../../../src/world.ts';
import {Brain} from '../../../src/brain.ts';
import {Souls} from '../../../src/souls.ts';
import {Auth} from '../../../src/auth.ts';
import {config} from '../../../src/config.ts';
import {buildApp} from '../../../src/http.ts';
import {IntentControlV2} from '../../../src/intent-control.ts';
import type {Hub} from '../../../src/hub.ts';
import {CandidateStationV1} from '../../../src/station.ts';
import {drainEdenThought} from '../../../src/eden-bootstrap.ts';

// stairLandingV1 (#509): the cohort models a new world, which adopts stair-landing-clearance/1; false keeps the
// pre-policy behaviour for the seeded regression's before arm.
export async function generateCommonsCohort(measuredTicks=3600,retryV1=false,diagnosticsV1=false,walkBlockV1=false,stairLandingV1=true){
  const dir=mkdtempSync(join(tmpdir(),'eden-commons-cohort-')),path=join(dir,'native.db'),db=new Db(path);
  const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true,walkBlockV1}),seed='commons-active-24',worldId='commons-active-24';
  const host=new WorldHost(db,factory,seed,1e9,worldId,{durableClockV1:true});host.boot();host.drainInputs();
  const programEvents:import('@souls/engine-contract').ProgramEvent[]=[];
  if(diagnosticsV1)host.listeners.push({onProgram:event=>programEvents.push(structuredClone(event))});
  const cfg={...config,worldId,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake' as const,budgetUsdPerDay:.5,
    publicUrl:'http://127.0.0.1:4957',typesafeKey:undefined,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',privyAppId:'',privyAppSecret:'',inviteRequired:true};
  let compilerCalls=0;
  const compilerCall:typeof callTool=async<T>(input:Parameters<typeof callTool>[0])=>{
    compilerCalls++;const text=JSON.stringify(input.messages),target=text.includes('go to the pavilion')?'commons-pavilion':text.includes('go to the presentation deck')?'commons-deck':'commons';
    const out:CompileOut={understood:true,agenda:[{card:'go to',target}],alignment:{understanding:'Walk to '+target+'.',trigger:{kind:'now'}}};
    return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
  };
  const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}},{compilerCall,intentV2Choices:true,intentV2Retries:retryV1});
  const compile=brain.compile.bind(brain);brain.compile=async(...args:Parameters<typeof compile>)=>{brain.mode='live';try{return await compile(...args);}finally{brain.mode='fake';}};
  const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();const auth=new Auth(cfg,db);auth.devAuth=true;
  const service=new IntentControlV2(host,brain,souls,{historyV1:true}),app=buildApp({cfg,db,host,auth,brain,souls,intentV2:service,hub:{refreshMe(){},clients:new Map()} as unknown as Hub});
  const request=async(route:string,owner:string,data?:unknown,extra?:Record<string,string>)=>app.request(route,{method:data?'POST':'GET',headers:{authorization:'Bearer dev:'+owner,...(data?{'content-type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});
  async function drive<T>(p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}assert.ok(done,'real canonical request settled');return p;}
  const residents:{owner:string;soulId:string;entityId:string;requestId:string;intentId:string;birth:number[];firstMotion?:number}[]=[];
  try{
    for(let i=0;i<6;i++){
      const issued=await request('/v1/admin','admin',{action:'invite',uses:1});assert.equal(issued.status,200);const {code}=await issued.json() as {code:string};
      assert.equal((await request('/v1/invite','cohort'+i,{code})).status,200);
    }
    await drive(host.enqueue('rules','fixture',{dayConfig:{origin:0,dayTicks:72000,customs:[]}}));
    if(stairLandingV1)await drive<unknown>(host.enableStairLandingClearanceV1());
    for(let i=0;i<24;i++){
      const owner='cohort'+Math.floor(i/4),created=await drive(request('/v1/souls',owner,{name:'Resident '+i,description:'local owned population'},{'X-Sim-Lifecycle':'1'}));assert.equal(created.status,202,await created.clone().text());
      const {lifecycle}=await created.json() as any;await setImmediate();host.drainInputs();await setImmediate();host.drainInputs();
      const received=await request('/v1/lifecycle/'+lifecycle.requestId,owner),state=await received.json() as any;assert.equal(state.lifecycle.state,'admitted');assert.equal(state.lifecycle.ready,true);
      residents.push({owner,soulId:lifecycle.soulId,entityId:lifecycle.entityId,requestId:'direction-'+i,intentId:'',birth:[...host.engine.world.entities[lifecycle.entityId].pose.p]});
    }
    const station=new CandidateStationV1(host);await drive(station.record());
    for(let i=0;i<residents.length;i++){
      const r=residents[i],words=i%3===0?'go to the pavilion':i%3===1?'go to the presentation deck':'go to the commons';
      const posted=await drive(request('/v1/souls/'+r.soulId+'/intent-v2',r.owner,{contract:INTENT_V2,requestId:r.requestId,op:'upsert',words:'PRIVATE_COHORT '+words}));assert.equal(posted.status,202,await posted.clone().text());await drive(service.settled());
      const receipt=intentReceiptV2Schema.parse(await (await request('/v1/souls/'+r.soulId+'/intent-v2/requests/'+r.requestId,r.owner)).json());assert.equal(receipt.phase,'understood');if(receipt.phase==='understood')r.intentId=receipt.revision.intentId;
    }
    const samples:{tick:number;moving:number;activePrograms:number;violations:number;seq:number}[]=[],timings:number[]=[];
    for(let i=0;i<measuredTicks;i++){
      const before=performance.now();host.tickOnce();timings.push(performance.now()-before);await setImmediate();
      for(const r of residents)if(r.firstMotion===undefined&&hashOf(host.engine.world.entities[r.entityId].pose.p)!==hashOf(r.birth))r.firstMotion=host.engine.world.tick;
      if(i%100===0)samples.push({tick:host.engine.world.tick,moving:residents.filter(r=>host.engine.world.entities[r.entityId].human?.activity==='walk').length,activePrograms:residents.filter(r=>host.engine.programOf(r.entityId)).length,violations:host.engine.runtime.violations.length,seq:host.seq});
    }
    brain.quiesce();host.stop();await drainEdenThought(host,brain,service);
    const admissions=retryV1?db.events(worldId).filter(e=>e.kind==='intent-admission-v2').map(e=>intentAdmissionFactV2(e).outcome):[];
    const nativePrograms=diagnosticsV1&&host.engine.canSnapshot?.()!==false?(host.engine.snapshot() as unknown as {programs?:unknown[]}).programs:undefined;
    const observationRows=diagnosticsV1?db.db.prepare('SELECT attempt_id,phase,observation_tick,published_seq FROM intent_observations_v2 WHERE world_id=? ORDER BY observation_tick,attempt_id,phase').all(worldId):undefined;
    const outcomes=residents.map(r=>({soulId:r.soulId,owner:r.owner,firstMotion:r.firstMotion??null,
      ...(retryV1?{attempts:Object.values(host.intentHistoryOf(r.soulId).attempts).filter(a=>a.intent.intentId===r.intentId),admissions:admissions.filter(a=>a.intent.intentId===r.intentId)}:{}),
      ...(diagnosticsV1?{currentProgram:host.engine.programOf(r.entityId),controllerRecords:Object.values(host.intentHistoryOf(r.soulId).attempts).filter(a=>a.intent.intentId===r.intentId&&'activityId' in a).map(a=>{
        const current=host.engine.programAction?.((a as any).activityId);return {attemptId:a.attemptId,activityId:(a as any).activityId,current,record:current?structuredClone(host.engine.runtime.records.get(current.action.id)):null};
      })}:{}),
      phases:Object.values(host.intentHistoryOf(r.soulId).attempts).filter(a=>a.intent.intentId===r.intentId).map(a=>a.phase),
      interpretedTarget:host.intentHistoryOf(r.soulId).intents[r.intentId].revision.interpretation.agenda[0]?.target,
      retainedActions:Object.values(host.intentHistoryOf(r.soulId).attempts).filter(a=>a.intent.intentId===r.intentId&&'activityId' in a).map(a=>({phase:a.phase,activityId:(a as any).activityId,currentNative:host.engine.programAction?.((a as any).activityId)??null})),
      activity:host.engine.world.entities[r.entityId].human?.activity,at:host.kernel.things[r.soulId]?.at,
      purposeStatus:host.intentHistoryOf(r.soulId).intents[r.intentId]?.status}));
    const head={tick:host.engine.world.tick,seq:host.seq,engine:host.engine.stateHash(),kernel:kernelHash(host.kernel),station:hashOf(host.stationHistoryV1()),histories:hashOf(residents.map(r=>host.intentHistoryOf(r.soulId))),life:hashOf(residents.map(r=>host.minds.get(r.soulId)!.life))};
    const diagnostics=diagnosticsV1?{programEvents,nativePrograms,observationRows}:undefined;
    const readerPages=[];
    for(const r of residents){let cursor:string|undefined,facts=0,pages=0,complete=false;do{
      const response=await request('/v1/souls/'+r.soulId+'/intent-v2/history'+(cursor?'?cursor='+cursor:''),r.owner);assert.equal(response.status,200);
      const p=intentHistoryPageV1Schema.parse(await response.json());assert.equal(p.state,'page');if(p.state!=='page')throw Error('unexpected source gap');
      facts+=p.events.length;pages++;complete=p.complete;cursor=p.nextCursor??undefined;assert.ok(pages<100,'bounded probe finishes all canonical pages');
    }while(cursor);readerPages.push({soulId:r.soulId,facts,pages,complete});}
    const foreign=await request('/v1/souls/'+residents[0].soulId+'/intent-v2/history','cohort1');assert.equal(foreign.status,404);
    assert.ok(!JSON.stringify(db.events(worldId).map(publicEvent)).includes('PRIVATE_COHORT'));
    // Reconstruct the durable moving head without Brain listeners/models. A
    // snapshot may be inadmissible while programs hold native activities.
    const snapshotSaved=host.saveSnapshot(true);host.stop();db.close();const reopenedDb=new Db(path);try{
    const boot=new WorldHost(reopenedDb,factory,seed,1e9,worldId,{durableClockV1:true}),restored=boot.boot();
    const reconstructed={tick:boot.engine.world.tick,seq:boot.seq,engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel),station:hashOf(boot.stationHistoryV1()),histories:hashOf(residents.map(r=>boot.intentHistoryOf(r.soulId))),life:hashOf(residents.map(r=>boot.minds.get(r.soulId)!.life))};
    assert.deepEqual(reconstructed,head);
    reopenedDb.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);
    const genesisBoot=new WorldHost(reopenedDb,factory,seed,1e9,worldId,{durableClockV1:true});const rebuilt=genesisBoot.boot();assert.equal(rebuilt.from,'genesis');
    assert.equal(genesisBoot.engine.stateHash(),head.engine);assert.equal(kernelHash(genesisBoot.kernel),head.kernel);
    assert.equal(hashOf(residents.map(r=>genesisBoot.intentHistoryOf(r.soulId))),head.histories);assert.equal(hashOf(residents.map(r=>genesisBoot.minds.get(r.soulId)!.life)),head.life);
    assert.equal(hashOf(genesisBoot.stationHistoryV1()),head.station);assert.equal(genesisBoot.engine.world.tick,head.tick);
    const sorted=[...timings].sort((a,b)=>a-b);
    return {contract:'core-commons-cohort-probe/1',worldId,rulesVersion:host.engine.rulesVersion,localHumanOwners:6,residents:24,compilerCalls,measuredTicks,
      head,outcomes,samples,readerPages,...(diagnosticsV1?{diagnostics}:{}),nativeViolations:host.engine.runtime.violations,snapshotSaved:snapshotSaved??null,restartFrom:restored.from,reconstruction:'exact',genesisReconstruction:'exact',
      timing:{meanMs:timings.reduce((a,b)=>a+b,0)/timings.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)},paid:reopenedDb.paidCost(),
      limits:['Synthetic compiler and fake local needs-aware chooser, no real people or providers','Bounded moving ticks/WAL file in same process; no process-crash/lifetime/capacity/device/combinedviewer qualification','Source frontier bounded200rows; initial private pages may legitimately require continuation']};
    }finally{reopenedDb.close();}
  }finally{brain.quiesce();host.stop();if(db.db.isOpen){await drainEdenThought(host,brain,service);db.close();}rmSync(dir,{recursive:true,force:true});}
}
