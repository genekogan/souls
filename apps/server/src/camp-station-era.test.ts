import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {hashOf,type Engine,type CampExpansionV1} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';
import {PROTO,stationLiveV2Schema,stationEraPageV1Schema,stationPhysicalTransitionV1,stationEndTick,publicEvent} from '@souls/protocol';
import {marsCampExpansionFactory,type MarsWorldConfig} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {WorldHost} from './world.ts';
import {Db} from './db.ts';
import {CandidateStationV1} from './station.ts';
import {CandidateStationV2} from './station-v2.ts';
import {buildApp} from './http.ts';
import {Hub} from './hub.ts';
const cfg:MarsWorldConfig={scene:'eden-camp',safeArrivalV1:true,safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Camp grounds'}};
const factory=await marsCampExpansionFactory(cfg);
async function setup(t:TestContext){
  const timers:ReturnType<typeof setInterval>[]=[],original=setInterval;t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=original(...args);timers.push(timer);return timer;});
  const dir=mkdtempSync(join(tmpdir(),'core-camp-station-')),path=join(dir,'world.sqlite'),f=fixture(path,factory,{durableClockV1:true});f.souls.enableLifecycle();
  t.after(()=>{timers.forEach(clearInterval);f.host.stop();f.db.close();rmSync(dir,{recursive:true,force:true});});
  await invite(f,'alice');const op=f.souls.acceptLifecycleCreate('dev:alice',{name:'Cedar',description:'Synthetic local owner station continuity'});
  for(let i=0;i<4;i++){f.host.drainInputs();await setImmediate();}assert.equal(f.souls.controlReady(f.db.soul(op.scope.soulId)!),true);
  const intent=await accept(f.host,f.request('/v1/souls/'+op.scope.soulId+'/intent',{intent:{goal:'rest',text:'PRIVATE_CAMP_STATION_OWNER_WORDS'}},'alice'));assert.equal(intent.status,200);
  f.host.minds.get(op.scope.soulId)!.nextEvalTick=1e9;
  await accept(f.host,new CandidateStationV1(f.host).record());const station=new CandidateStationV2(f.host);await accept(f.host,station.record());
  for(let i=0;i<37;i++){f.host.minds.get(op.scope.soulId)!.nextEvalTick=1e9;f.host.tickOnce();}f.host.drainInputs();
  return {...f,station,path,soulId:op.scope.soulId};
}
test('opt-in camp rules/era commits adjacently and preserves original cue/epoch, live/history boundaries and exact SQLite/genesis',async t=>{
  const f=await setup(t),h=f.host,original=h.stationHistoryV1()!,oldHash=hashOf(original),tick=h.engine.world.tick,cue=original.cues[0];
  const seen:any[]=[];h.listeners.push({onApplied:e=>{if(e.payload?.campExpansion||e.kind==='station-rules-era-v1')seen.push({seq:e.seq,kind:e.kind,head:h.stationPhysicalHeadV1()});}});
  await assert.rejects(h.adoptCampExpansion('world'),/station-era-reader-required/);
  const source=await accept(h,h.adoptCampExpansion('world',{stationEraV1:true}));const events=f.db.events(h.worldId),era=events.find(e=>e.kind==='station-rules-era-v1')!;assert.ok(era);assert.equal(era.seq,source.seq+1);
  assert.equal(era.payload.source.transitionHash,hashOf(source.payload.campExpansion));assert.equal(hashOf(h.stationHistoryV1()),oldHash);assert.ok(seen.every(s=>s.head.revision===1),'no listener sees a half-applied pair');
  const view=stationLiveV2Schema.parse(await accept(h,f.station.record()));assert.equal(view.station!.epoch,original.station.epoch);assert.equal(view.station!.genesisId,original.station.genesisId);assert.equal(view.cue!.cueId,cue.cueId);assert.equal(view.cue!.seed,cue.seed);assert.equal(view.physical!.revision,1);assert.equal(view.cuePhysical!.revision,0);
  assert.equal(hashOf(stationPhysicalTransitionV1(view.physical!.source!)),hashOf(source.payload.campExpansion));
  const oldView=f.station.history({...original.station,rulesVersion:original.station.rulesVersion},tick-1);assert.equal(oldView.physical!.revision,0);
  const at=f.station.history({...original.station,rulesVersion:h.engine.rulesVersion},tick);assert.equal(at.physical!.revision,1);assert.equal(at.cue!.cueId,cue.cueId);
  assert.throws(()=>f.station.history({...original.station,rulesVersion:h.engine.rulesVersion},tick-1));
  const page=stationEraPageV1Schema.parse(f.station.eraPage(original.station,0,64));assert.equal(page.eras.length,1);assert.ok('campExpansion' in page.eras[0].source);
  const app=buildApp({cfg:f.souls.cfg,db:f.db,host:h,auth:f.auth,brain:f.brain,souls:f.souls,
    hub:{clients:new Map(),refreshMe(){}} as unknown as Hub,stationV2:f.station});
  const liveResponse=await app.request('/v1/station-v2');assert.equal(liveResponse.status,200);assert.equal(liveResponse.headers.get('cache-control'),'no-store');assert.deepEqual(stationLiveV2Schema.parse(await liveResponse.json()),view);
  const query=new URLSearchParams({worldId:h.worldId,epoch:original.station.epoch});const erasResponse=await app.request('/v1/station-v2/eras?'+query);assert.equal(erasResponse.status,200);assert.deepEqual(stationEraPageV1Schema.parse(await erasResponse.json()),page);
  const historicalResponse=await app.request('/v1/station-v2/history?'+new URLSearchParams({...Object.fromEntries(query),rulesVersion:h.engine.rulesVersion,tick:String(tick)}));assert.equal(historicalResponse.status,200);assert.deepEqual(await historicalResponse.json(),at);
  assert.equal((await app.request('/v1/station-v2/eras?'+new URLSearchParams({worldId:'foreign',epoch:original.station.epoch}))).status,404);
  const server=createServer(),hub=new Hub(server,h,f.auth,f.db,f.souls,undefined,f.station),frames:any[]=[];hub.brain=f.brain;
  await new Promise<void>((r,reject)=>{server.once('error',reject);server.listen(4958,'127.0.0.1',r);});const ws=new WebSocket('ws://127.0.0.1:4958/ws');
  try{
    ws.on('message',data=>frames.push(JSON.parse(String(data))));await once(ws,'open');ws.send(JSON.stringify({t:'hello',proto:PROTO,stationContracts:['station-live/2']}));
    for(let i=0;i<100&&!frames.some(m=>m.t==='station-v2');i++)await new Promise<void>(r=>setTimeout(r,2));
    const welcome=frames.find(m=>m.t==='welcome'),stationFrame=frames.find(m=>m.t==='station-v2');assert.ok(welcome);assert.equal(welcome.you,null);assert.equal(welcome.stationContract,'station-live/2');assert.ok(stationFrame);assert.deepEqual(stationLiveV2Schema.parse(stationFrame.view),view);assert.equal(JSON.stringify(frames).includes('PRIVATE_CAMP'),false);
  }finally{ws.terminate();for(const peer of hub.wss.clients)peer.terminate();await new Promise<void>(r=>hub.wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));}
  const repeat=await h.adoptCampExpansion('world',{stationEraV1:true});assert.equal(repeat.seq,source.seq);assert.equal(f.db.events(h.worldId).filter(e=>e.kind==='station-rules-era-v1').length,1);
  h.saveSnapshot(true);const state={engine:h.engine.stateHash(),kernel:kernelHash(h.kernel),physical:hashOf(h.stationPhysicalHeadV1()),history:hashOf(h.stationHistoryV2())};
  const second=new Db(f.path);try{
    const boot=new WorldHost(second,factory,'native-owner-lifecycle',1e9,h.worldId,{durableClockV1:true});assert.equal(boot.boot().from,'snapshot');assert.deepEqual({engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel),physical:hashOf(boot.stationPhysicalHeadV1()),history:hashOf(boot.stationHistoryV2())},state);assert.equal(boot.minds.get(f.soulId)!.intent!.text,'PRIVATE_CAMP_STATION_OWNER_WORDS');assert.equal(new CandidateStationV2(boot).view().fresh,false);boot.stop();
    second.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(h.worldId);const genesis=new WorldHost(second,factory,'native-owner-lifecycle',1e9,h.worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel),physical:hashOf(genesis.stationPhysicalHeadV1()),history:hashOf(genesis.stationHistoryV2())},state);genesis.stop();
  }finally{second.close();}
  const publicFacts={worldId:h.worldId,source:{seq:source.seq,tick:source.tick,payload:source.payload},era:{seq:era.seq,tick:era.tick,payload:era.payload},view,oldView,at,page,anonymousFrames:frames};assert.equal(JSON.stringify(publicFacts).includes('PRIVATE_CAMP'),false);assert.equal(JSON.stringify(f.db.events(h.worldId).map(publicEvent)).includes('PRIVATE_CAMP'),false);assert.equal(f.db.paidCost(),0);
  const dir=new URL('../../../.e2e/camp-station-era/',import.meta.url);mkdirSync(dir,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',dir);writeFileSync(file,JSON.stringify({contract:'core-native-camp-station-era/1',publicFacts,state,headTick:h.engine.world.tick,paidUSD:0,sourceHash:hashOf(readFileSync(new URL(import.meta.url),'utf8')),limits:['Synthetic invited local owner/native/actualSQLite; no browser/audio/listener/World drawing/realAuth/release claim','Opt-in strict new physical-source case, consumer disposition pending; default carry refusal retained']},null,2)+'\n',{flag:'wx'});console.log('Actual public camp station era facts '+file.pathname);
});
test('era append failure rolls back the physical source, world header and original station as one transaction',async t=>{
  const f=await setup(t),before={engine:f.host.engine.stateHash(),seq:f.host.seq,header:f.db.world(f.host.worldId)!.rules_version,station:hashOf(f.host.stationHistoryV1())};
  f.db.db.exec("CREATE TRIGGER reject_camp_era BEFORE INSERT ON events WHEN NEW.kind='station-rules-era-v1' BEGIN SELECT RAISE(ABORT,'synthetic era append refusal'); END");
  await assert.rejects(accept(f.host,f.host.adoptCampExpansion('world',{stationEraV1:true})),/synthetic era append refusal/);
  assert.deepEqual({engine:f.host.engine.stateHash(),seq:f.host.seq,header:f.db.world(f.host.worldId)!.rules_version,station:hashOf(f.host.stationHistoryV1())},before);
  assert.equal(f.db.events(f.host.worldId).some(e=>e.payload?.campExpansion||e.kind==='station-rules-era-v1'),false);
});
test('postcommit native fold failure reconstructs both durable camp/era facts and retains private owner state without card filtering',async t=>{
  const f=await setup(t);f.host.saveSnapshot(true);const original=hashOf(f.host.stationHistoryV1());let faulted=false;
  const adopt=f.host.engine.adoptCampExpansionV1!.bind(f.host.engine);
  const target=f.host.engine as Engine&{adoptCampExpansionV1:(raw:CampExpansionV1)=>void};
  t.mock.method(target,'adoptCampExpansionV1',(raw:CampExpansionV1)=>{if(!faulted){faulted=true;throw new Error('synthetic postcommit native fold failure');}return adopt(raw);});
  const source=await accept(f.host,f.host.adoptCampExpansion('world',{stationEraV1:true}));assert.equal(faulted,true);
  const events=f.db.events(f.host.worldId),era=events.find(e=>e.kind==='station-rules-era-v1')!;assert.equal(era.seq,source.seq+1);assert.equal(f.host.stationPhysicalHeadV1()!.revision,1);assert.equal(f.db.world(f.host.worldId)!.rules_version,f.host.engine.rulesVersion);
  assert.equal(hashOf(f.host.stationHistoryV1()),original);assert.equal(f.host.minds.get(f.soulId)!.intent!.text,'PRIVATE_CAMP_STATION_OWNER_WORDS');assert.equal(events.some(e=>e.payload?.recovery),false);assert.equal(f.host.extra.cardFaults,undefined);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
test('genuine cue gap remains silent across camp upgrade; later cue derives current physics without resetting original epoch',async t=>{
  const f=await setup(t),original=f.host.stationHistoryV1()!,oldCue=original.cues[0];
  while(f.host.engine.world.tick<Math.ceil(stationEndTick(oldCue))+2){f.host.minds.get(f.soulId)!.nextEvalTick=1e9;f.host.tickOnce();}
  const tick=f.host.engine.world.tick;await accept(f.host,f.host.adoptCampExpansion('world',{stationEraV1:true}));
  const scope={...original.station,rulesVersion:f.host.engine.rulesVersion};assert.equal(f.station.history(scope,tick).cue,null);
  const next=await accept(f.host,f.station.record());assert.equal(next.cue!.contract,'station-cue/2');assert.equal(next.cue!.startTick,tick);assert.notEqual(next.cue!.seed,oldCue.seed);assert.equal(next.station!.epoch,original.station.epoch);assert.equal(next.cuePhysical!.revision,1);assert.deepEqual(next.cue!.observation,f.host.engine.gatheringObservation!());assert.equal(f.db.paidCost(),0);
});
