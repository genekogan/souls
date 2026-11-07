import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { marsFactory,marsCommonsTransitionFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { hashOf } from '@souls/engine-contract';
import { kernelHash } from '@souls/kernel';
import { stationLivePhaseV1,stationLivePhaseV2,stationPhaseAtTickV2,stationEndTick,publicEvent,makeStationCueV2,
  stationLiveV2Schema,stationHistoricalV2Schema,recordedTakeChunkSchema,decodeSceneCapturePublication } from '@souls/protocol';
import { WorldHost } from './world.ts';
import { Db } from './db.ts';
import { CandidateStationV1 } from './station.ts';
import { CandidateStationV2 } from './station-v2.ts';
async function accepted<T>(host:WorldHost,promise:Promise<T>):Promise<T>{
  let done=false,error:unknown,value:T|undefined;promise.then(v=>{value=v;done=true;},e=>{error=e;done=true;});
  for(let i=0;i<30&&!done;i++){host.drainInputs();await setImmediate();}
  if(!done)throw new Error('station fixture sequencer did not settle');if(error)throw error;return value!;
}
async function setup(t:any){
  const dir=mkdtempSync(join(tmpdir(),'core-station-era-')),path=join(dir,'world.sqlite');let db=new Db(path);
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const legacy=await marsFactory(GREEN_FIELD_WORLD),factory=await marsCommonsTransitionFactory();
  let host=new WorldHost(db,legacy,'station-era',1e9,'station-era');host.boot();
  db.upsertUser({id:'PRIVATE_ERA_OWNER',email:null,wallet:null,role:'user'});
  db.createSoul({id:'s_A',entityId:'h_A',worldId:host.worldId,owner:'PRIVATE_ERA_OWNER',name:'Alice',description:'Resident',native:false});
  void host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'PRIVATE_ERA_OWNER',name:'Alice',description:'Resident'});host.tickOnce();
  void host.enqueue('intent','owner',{soulId:'s_A',intent:{goal:'rest',text:'PRIVATE_ERA_WORDS'},source:'web'});host.drainInputs();
  await accepted(host,new CandidateStationV1(host).record());host.saveSnapshot();
  host=new WorldHost(db,factory,'station-era',1e9,'station-era');host.boot();
  return {factory,path,get db(){return db;},get host(){return host;},
    reopen(){db.close();db=new Db(path);host=new WorldHost(db,factory,'station-era',1e9,'station-era');return host.boot();}};
}

test('actual SQLite inside-cue checkpoint retains original bytes/body/owner/direction; old V1 silences and new V2 anchor carries the beat',async t=>{
  const f=await setup(t),h=f.host,old=new CandidateStationV1(h);await accepted(h,old.record());
  while(h.engine.world.tick<37)h.tickOnce();
  const oldState=h.stationHistoryV1()!,original=hashOf(oldState),cue=oldState.cues.at(-1)!;
  const facts=f.db.db.prepare("SELECT seq,payload FROM events WHERE world_id=? AND kind IN ('station-epoch-v1','station-cue-v1','station-anchor-v1') ORDER BY seq").all(h.worldId);
  const body=structuredClone(h.engine.world.entities.h_A),beforeSeq=h.seq;let observations=0;
  h.listeners.push({onApplied:e=>{if(e.kind==='rules'&&e.payload.commonsTransition||e.kind==='station-rules-era-v1'){
    assert.equal(h.stationPhysicalHeadV1()!.revision,1);assert.equal(h.stationPhysicalHeadV1()!.effectiveTick,37);observations++;}}});
  const checkpoint=await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));
  assert.equal(checkpoint.seq,beforeSeq+1);assert.equal(h.seq,checkpoint.seq+1);assert.equal(observations,2);
  assert.equal(hashOf(h.stationHistoryV1()),original);assert.deepEqual(h.engine.world.entities.h_A,body);
  assert.equal(h.minds.get('s_A')!.owner,'PRIVATE_ERA_OWNER');assert.equal(h.minds.get('s_A')!.intent!.text,'PRIVATE_ERA_WORDS');
  assert.equal(old.view().fresh,false);assert.deepEqual(old.view().cue,cue);assert.equal(stationLivePhaseV1(old.view(),Date.now()),null);
  await assert.rejects(old.record(),/unavailable/);
  const v2=new CandidateStationV2(h);assert.equal(v2.view().anchor,null);assert.equal(v2.view().fresh,false);
  const view=await accepted(h,v2.record());assert.equal(view.fresh,true);assert.equal(view.cue!.cueId,cue.cueId);
  assert.equal(view.anchor!.contract,'station-anchor/2');assert.equal(view.physical!.revision,1);assert.equal(view.cuePhysical!.revision,0);
  assert.deepEqual(stationLivePhaseV2(view,view.anchor!.serverTimeMs),stationPhaseAtTickV2(cue,37));
  assert.deepEqual(v2.history(oldState.station,36).physical!.revision,0);
  assert.equal(v2.history({...oldState.station,rulesVersion:h.engine.rulesVersion},37).physical!.revision,1);
  assert.throws(()=>v2.history({...oldState.station,rulesVersion:oldState.station.rulesVersion},37),/physical reader/);
  assert.throws(()=>v2.history({...oldState.station,rulesVersion:h.engine.rulesVersion},38),/cutoff/);
  const beforeAnchor=v2.history({...oldState.station,rulesVersion:h.engine.rulesVersion},37,checkpoint.seq+1);
  assert.equal(beforeAnchor.anchor,null,'same-tick anchor beyond exact row frontier cannot be borrowed');
  assert.deepEqual(f.db.db.prepare("SELECT seq,payload FROM events WHERE world_id=? AND kind IN ('station-epoch-v1','station-cue-v1','station-anchor-v1') ORDER BY seq").all(h.worldId),facts);
  assert.equal(JSON.stringify(view).includes('PRIVATE_ERA_'),false);assert.equal(f.db.paidCost(),0);
  const hash=h.engine.stateHash(),kernel=kernelHash(h.kernel),station=hashOf(h.stationHistoryV2()),head=hashOf(h.stationPhysicalHeadV1());h.saveSnapshot();
  assert.equal(f.reopen().from,'snapshot');assert.equal(f.host.engine.stateHash(),hash);assert.equal(hashOf(f.host.stationHistoryV2()),station);
  assert.equal(new CandidateStationV2(f.host).view().fresh,false);
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(h.worldId);assert.equal(f.reopen().from,'genesis');
  assert.equal(f.host.engine.stateHash(),hash);assert.equal(kernelHash(f.host.kernel),kernel);assert.equal(hashOf(f.host.stationPhysicalHeadV1()),head);
  assert.equal(hashOf(f.host.stationHistoryV2()),station);assert.equal(f.host.minds.get('s_A')!.intent!.text,'PRIVATE_ERA_WORDS');
});
test('checkpoint in a genuine finite silent gap creates no cue; subsequent V2 cue uses current native observation, original epoch and a new seed',async t=>{
  const f=await setup(t),h=f.host,old=h.stationHistoryV1()!,cue=old.cues.at(-1)!;
  while(h.engine.world.tick<Math.ceil(stationEndTick(cue))+2)h.tickOnce();
  const tick=h.engine.world.tick,original=hashOf(old);
  await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));
  const v2=new CandidateStationV2(h),scope={...old.station,rulesVersion:h.engine.rulesVersion};
  assert.equal(v2.history(scope,tick).cue,null);assert.equal(v2.view().fresh,false);assert.equal(h.stationHistoryV2()!.cues.length,1);
  const body=h.engine.stateHash(),view=await accepted(h,v2.record());
  assert.equal(h.engine.stateHash(),body);assert.equal(view.cue!.contract,'station-cue/2');assert.equal(view.cue!.startTick,tick);
  assert.notEqual(view.cue!.cueId,cue.cueId);assert.notEqual(view.cue!.seed,cue.seed);assert.equal(view.station!.epoch,old.station.epoch);
  assert.deepEqual(view.cue!.observation,h.engine.gatheringObservation!());assert.equal(view.cuePhysical!.revision,1);
  assert.equal(v2.history({...old.station,rulesVersion:old.station.rulesVersion},tick-1).cue,null);
  assert.equal(hashOf(h.stationHistoryV1()),original);assert.equal(f.db.paidCost(),0);
});
test('same-tick old-origin cue is legitimate only before the adjacent checkpoint; a later stale-origin proposal is refused',async t=>{
  const f=await setup(t),h=f.host,old=h.stationHistoryV1()!,cue=old.cues[0];
  assert.equal(cue.startTick,h.engine.world.tick);
  const checkpoint=await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));
  const sourceCue=f.db.events(h.worldId).find(e=>e.kind==='station-cue-v1')!;
  assert.equal(cue.startTick,checkpoint.tick);assert.ok(sourceCue.seq<checkpoint.seq);
  const view=await accepted(h,new CandidateStationV2(h).record());assert.equal(view.cue!.cueId,cue.cueId);assert.equal(view.anchor!.beat,0);
  while(h.engine.world.tick<Math.ceil(stationEndTick(cue)))h.tickOnce();
  const tick=h.engine.world.tick,stale=makeStationCueV2({contract:'station-cue/2',worldId:h.worldId,epoch:old.station.epoch,
    rulesVersion:old.station.rulesVersion,eraRevision:0,dtSeconds:h.engine.dt,pins:cue.pins,sequence:2,pieceId:'starfield',bpm:60,
    seed:cue.seed+1,startTick:tick,cycleCount:4,energy:0,observation:{...cue.observation,tick},
    transition:{previousCueId:cue.cueId,previousEndTick:stationEndTick(cue),nextStartTick:tick,fadeOutBeats:0,fadeInBeats:0}});
  const seq=h.seq;await assert.rejects(accepted(h,h.enqueueChecked('station-cue-v2','fixture',stale,()=>true)),/physical reader/);assert.equal(h.seq,seq);
});
test('postcommit live fold failure restores both exact durable facts without filtering them as a card fault',async t=>{
  const f=await setup(t),h=f.host;while(h.engine.world.tick<37)h.tickOnce();
  const original=h.engine.adoptCommons!.bind(h.engine);h.engine.adoptCommons=transition=>{original(transition);throw new Error('INJECTED_POSTCOMMIT_FOLD');};
  const seq=h.seq;const checkpoint=await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));
  assert.equal(checkpoint.seq,seq+1);assert.equal(h.seq,seq+2);assert.equal(h.stationPhysicalHeadV1()!.revision,1);
  assert.equal(f.db.events(h.worldId).filter(e=>e.payload?.recovery).length,0);assert.deepEqual(h.engine.runtime.violations,[]);
  assert.equal(h.minds.get('s_A')!.intent!.text,'PRIVATE_ERA_WORDS');
});
for(const kind of ['station-rules-era-v1','header'])test(`writer refusal at ${kind} rolls back physical event, era and header without listeners or body change`,async t=>{
  const f=await setup(t),h=f.host,before=hashOf({state:h.stationHistoryV1(),native:h.engine.stateHash()}),seq=h.seq,version=h.engine.rulesVersion;
  let applied=0;h.listeners.push({onApplied:()=>applied++});
  f.db.db.exec(kind==='header'?"CREATE TEMP TRIGGER refusal BEFORE UPDATE OF rules_version ON worlds BEGIN SELECT RAISE(ABORT,'ERA_REFUSAL'); END":
    "CREATE TEMP TRIGGER refusal BEFORE INSERT ON events WHEN NEW.kind='station-rules-era-v1' BEGIN SELECT RAISE(ABORT,'ERA_REFUSAL'); END");
  await assert.rejects(accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true})),/ERA_REFUSAL/);
  assert.equal(h.seq,seq);assert.equal(applied,0);assert.equal(f.db.world(h.worldId)!.rules_version,version);
  assert.equal(hashOf({state:h.stationHistoryV1(),native:h.engine.stateHash()}),before);
  assert.equal(f.db.events(h.worldId).some(e=>e.payload?.commonsTransition||e.kind==='station-rules-era-v1'),false);
  f.db.db.exec('DROP TRIGGER refusal');await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));assert.equal(h.stationPhysicalHeadV1()!.revision,1);
});
for(const phase of ['before-event','after-event','after-era','after-header','after-commit','after-physical'])
test(`real worker exit ${phase} leaves exactly neither or both canonical facts/header and replays without models`,async t=>{
  const f=await setup(t),h=f.host,original=hashOf(h.stationHistoryV1()),body=structuredClone(h.engine.world.entities.h_A),seq=h.seq,version=h.engine.rulesVersion;
  const worker=new Worker(new URL('../test/fixtures/station-era-worker.ts',import.meta.url),{workerData:{path:f.path,phase},execArgv:[]});
  t.after(()=>worker.terminate());assert.equal((await once(worker,'exit'))[0],23);
  const committed=['after-commit','after-physical'].includes(phase),events=f.db.events(h.worldId);
  assert.equal(events.filter(e=>e.payload?.commonsTransition).length,committed?1:0);assert.equal(events.filter(e=>e.kind==='station-rules-era-v1').length,committed?1:0);
  assert.equal(events.at(-1)!.seq,seq+(committed?2:0));assert.equal(f.db.world(h.worldId)!.rules_version,version+(committed?'+commons/1':''));
  f.reopen();assert.equal(hashOf(f.host.stationHistoryV1()),original);assert.deepEqual(f.host.engine.world.entities.h_A,body);
  assert.equal(f.host.stationPhysicalHeadV1()!.revision,committed?1:0);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
test('missing era/source fails closed even from a snapshot; malformed/private V2 and separately queued eras never append',async t=>{
  const f=await setup(t),h=f.host;await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));
  const station=new CandidateStationV2(h),view=await accepted(h,station.record()),seq=h.seq;
  for(const payload of [{...view.anchor!,revision:view.anchor!.revision+1,privateWords:'PRIVATE'},
    {...view.anchor!,revision:view.anchor!.revision+1,physicalEraRevision:0},
    {...view.anchor!,revision:view.anchor!.revision+1,dtSeconds:.1},
    {...view.anchor!,revision:view.anchor!.revision+1,epoch:hashOf('foreign')}]){
    await assert.rejects(accepted(h,h.enqueueChecked('station-anchor-v2','fixture',payload,()=>true)));assert.equal(h.seq,seq);
    assert.throws(()=>publicEvent({seq:1,tick:1,kind:'station-anchor-v2',payload:{...payload,privateWords:'PRIVATE'},author:'PRIVATE',at:1}));
  }
  await assert.rejects(accepted(h,h.enqueueChecked('station-rules-era-v1','fixture',view.physical!.era!.payload,()=>true)),/committed with/);
  assert.equal(h.seq,seq);h.saveSnapshot();const era=view.physical!.era!;
  f.db.db.prepare('DELETE FROM events WHERE world_id=? AND seq=?').run(h.worldId,era.seq);
  assert.throws(()=>f.reopen(),/canonical physical\/era pair/);
  f.db.appendEvent(h.worldId,{seq:era.seq,tick:era.tick,kind:'station-rules-era-v1',payload:era.payload,author:'world:station',at:1});
  f.db.db.prepare('DELETE FROM events WHERE world_id=? AND seq=?').run(h.worldId,era.payload.source.seq);
  assert.throws(()=>f.reopen(),/canonical physical\/era pair/);
});
test('changed canonical physical source or changed era dt is refused by native genesis replay',async t=>{
  for(const change of ['physical-source','era-dt']){
    const f=await setup(t),h=f.host;await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));
    const head=h.stationPhysicalHeadV1()!,seq=change==='physical-source'?head.source!.seq:head.era!.seq,event=f.db.events(h.worldId,seq-1,1)[0];
    if(change==='physical-source')event.payload.commonsTransition.fromWorldHash='0'.repeat(64);else event.payload.dtSeconds=.1;
    f.db.db.prepare('UPDATE events SET payload=? WHERE world_id=? AND seq=?').run(JSON.stringify(event.payload),h.worldId,seq);
    f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(h.worldId);
    assert.throws(()=>f.reopen());assert.equal(f.db.paidCost(),0);
  }
});
test('changed durable header dt refuses a queued checkpoint before any physical or era append',async t=>{
  const f=await setup(t),h=f.host,seq=h.seq,body=h.engine.stateHash();
  const request=h.adoptCommons('world:checkpoint',{stationEraV1:true});
  f.db.db.prepare('UPDATE worlds SET dt=? WHERE id=?').run(.1,h.worldId);
  await assert.rejects(accepted(h,request),/header-dt-moved/);assert.equal(h.seq,seq);assert.equal(h.engine.stateHash(),body);
  assert.equal(f.db.events(h.worldId).some(e=>e.kind==='station-rules-era-v1'||e.payload?.commonsTransition),false);
  assert.throws(()=>h.stationPhysicalHeadV1(),/header dt/);
});
test('frozen actual inside-cue and silence publication binds source/era/body captures, next actual gathering and exact producer bytes',()=>{
  const bytes=readFileSync(new URL('../test/fixtures/station-era/native-station-era.v1.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'a5796652cea6ce131215b7509885450d0ddc25dc3eed4c1457349266ca84128b');
  const f=JSON.parse(bytes.toString());assert.equal(f.journeys.length,2);assert.equal(bytes.includes(Buffer.from('PRIVATE_STATION_ERA')),false);
  for(const j of f.journeys){
    for(const key of ['pending','carried','next'])stationLiveV2Schema.parse(j[key]);for(const history of j.history)stationHistoricalV2Schema.parse(history);
    assert.deepEqual(j.bodyBefore,j.bodyAfter);assert.equal(j.oldView.fresh,false);assert.equal(j.pending.anchor,null);
    assert.equal(j.physical.era.seq,j.physical.source.seq+1);assert.equal(j.physical.source.tick,j.checkpointTick);assert.equal(j.physical.era.tick,j.checkpointTick);
    assert.equal(j.physical.era.payload.source.transitionHash,hashOf(j.physical.source.commonsTransition));
    for(const scene of j.scenes)decodeSceneCapturePublication({worldId:j.worldId,...scene});for(const chunk of j.pairedTakes)recordedTakeChunkSchema.parse(chunk);
    const boundary=j.pairedTakes.find((c:any)=>c.fromTick===j.checkpointTick);assert.ok(boundary);assert.equal(boundary.take.rulesVersion,j.rulesVersion);
    assert.notEqual(boundary.take.renderSceneRef.hash,j.pairedTakes[0].take.renderSceneRef.hash);
    assert.equal(j.reconstruction.snapshot,'exact');assert.equal(j.reconstruction.genesis,'exact');assert.equal(j.paidSpendUSD,0);
  }
  const inside=f.journeys[0];assert.equal(inside.carried.cue.cueId,inside.initial.cue.cueId);assert.equal(inside.carried.cue.seed,inside.initial.cue.seed);
  assert.equal(inside.next.cue.pieceId,'zoning-board');assert.equal(inside.next.cue.observation.situation,'gathering');assert.equal(inside.next.cue.observation.largestCommonTargetMembers,2);
  assert.equal(inside.next.cue.observation.rulesVersion,inside.rulesVersion);assert.equal(inside.next.cue.observation.tick,2564);
  const gap=f.journeys[1].history.at(-1);assert.equal(gap.cue,null);assert.equal(gap.anchor,null);assert.equal(gap.phase,null);
  // This immutable recording was made at 8748afe (e1139e8 before the public-history rewrite), not at every later transport edit.
  // Current execution is qualified separately; do not relabel its frozen source.
  for(const [path,sha] of Object.entries(f.producer))assert.equal(createHash('sha256').update(execFileSync('git',
    ['show',`8748afe468211a59598822e92ae15ac37f9e9547:${path}`],{cwd:new URL('../../../',import.meta.url)})).digest('hex'),sha);
});
