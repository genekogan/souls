import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { getRequestListener } from '@hono/node-server';
import WebSocket from 'ws';
import { Connection,type TransportReceipt,type PongReceipt,type ConnectionSession } from '@souls/client';
import { PROTO,stationLivePhaseV1,stationLivePhaseV2,stationPhaseAtTickV2,stationEndTick,
  stationEraPageV1Schema,stationHistoricalV2Schema,recordedTakeChunkSchema,type StationLiveV2,type StationLiveV1,type StationLiveContract } from '@souls/protocol';
import { hashOf } from '@souls/engine-contract';
import { marsFactory,marsCommonsTransitionFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { CandidateStationV1 } from './station.ts';
import { CandidateStationV2 } from './station-v2.ts';
import { Hub } from './hub.ts';
import { Auth } from './auth.ts';
import { Souls } from './souls.ts';
import { config } from './config.ts';
import { buildApp } from './http.ts';
import type { Brain } from './brain.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

async function accepted<T>(h:WorldHost,p:Promise<T>):Promise<T>{
  let done=false,value:T|undefined,error:unknown;p.then(v=>{value=v;done=true;},e=>{error=e;done=true;});
  for(let i=0;i<40&&!done;i++){h.drainInputs();await setImmediate();}
  if(!done)throw new Error('transport fixture sequencer stalled');if(error)throw error;return value!;
}
async function until(check:()=>boolean){const end=performance.now()+4000;while(!check()){
  assert.ok(performance.now()<end,'actual transport callback timed out');await setImmediate();}}
async function runtime(t:any,versions:('v1'|'v2')[]=['v1','v2']){
  const db=new Db(':memory:'),originalFactory=await marsFactory(GREEN_FIELD_WORLD);
  let h=new WorldHost(db,originalFactory,'transport-v2',1e9,'transport-v2');h.boot();
  db.upsertUser({id:'PRIVATE_TRANSPORT_OWNER',email:null,wallet:null,role:'user'});
  db.createSoul({id:'s_A',entityId:'h_A',worldId:h.worldId,owner:'PRIVATE_TRANSPORT_OWNER',name:'Alice',description:'Resident',native:false});
  void h.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'PRIVATE_TRANSPORT_OWNER',name:'Alice',description:'Resident'});h.tickOnce();
  void h.enqueue('intent','owner',{soulId:'s_A',intent:{goal:'rest',text:'PRIVATE_TRANSPORT_WORDS'},source:'web'});h.drainInputs();
  await accepted(h,new CandidateStationV1(h).record());h.saveSnapshot();
  h=new WorldHost(db,await marsCommonsTransitionFactory(),'transport-v2',1e9,'transport-v2');h.boot();
  const v1=new CandidateStationV1(h),v2=new CandidateStationV2(h);await accepted(h,v1.record());
  const cfg={...config,worldId:h.worldId,brainMode:'fake' as const,budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,
    privyAppId:'',privyAppSecret:'',marsWebDir:'/NO_CORE_TEST_WEB',webDir:'/NO_CORE_TEST_WEB'};
  const brain={camera:null,ticker:[],narratives:new Map(),mode:'fake',callsToday:0,spentToday:0,budget:0,inflight:new Set(),jevMsAvg:0,
    midContext:()=>({options:[]})} as unknown as Brain;
  const auth=new Auth(cfg,db),souls=new Souls(h,db,brain,cfg),server=createServer(),intervals:ReturnType<typeof setInterval>[]=[];
  const normal=globalThis.setInterval;let hub:Hub;
  globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>{const timer=normal(...args);intervals.push(timer);return timer;}) as typeof setInterval;
  try{hub=new Hub(server,h,auth,db,undefined,versions.includes('v1')?v1:undefined,versions.includes('v2')?v2:undefined);}
  finally{globalThis.setInterval=normal;}hub.brain=brain;
  const deps={cfg,db,host:h,auth,brain,souls,hub},app=buildApp({...deps,station:versions.includes('v1')?v1:undefined,stationV2:versions.includes('v2')?v2:undefined});
  server.on('request',getRequestListener(app.fetch));const connections:Connection[]=[],raw:WebSocket[]=[];
  t.after(async()=>{for(const c of connections)c.close();for(const s of raw)s.terminate();for(const timer of intervals)clearInterval(timer);
    for(const c of hub.clients)c.ws.terminate();await new Promise<void>(r=>hub.wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));db.close();});
  server.listen(TEST_PORT,'127.0.0.1');await once(server,'listening');
  function listener(offer?:StationLiveContract[]){
    const views:{view:StationLiveV2;receipt:TransportReceipt}[]=[],old:StationLiveV1[]=[],pongs:{message:unknown;receipt:PongReceipt}[]=[],errors:string[]=[],wire:unknown[]=[],sessions:unknown[]=[];
    let sockets=0;const c=new Connection(`ws://127.0.0.1:${TEST_PORT}/ws`,async()=>null,{
      onStationV2:(view,receipt)=>{if(view&&receipt)views.push({view,receipt});},onStation:view=>{if(view)old.push(view);},
      onPong:(message,receipt)=>pongs.push({message,receipt}),onError:code=>errors.push(code),onSession:s=>sessions.push(s)
    },url=>{sockets++;const ws=new WebSocket(url);ws.on('message',data=>wire.push(JSON.parse(data.toString())));return ws;},
    undefined,undefined,offer?{stationContracts:offer}:undefined);
    connections.push(c);c.connect();return {c,views,old,pongs,errors,wire,sessions,get sockets(){return sockets;}};
  }
  return {db,h,v1,v2,hub,app,deps,listener,raw};
}

for(const gap of [false,true])test(`actual negotiated TCP/Hub/Connection ${gap?'silent gap':'inside-cue'} checkpoint preserves V2 session and retained cue; V1 silences, late/reconnect bind current native head`,async t=>{
  const f=await runtime(t),{h,v1,v2}=f,original=v1.view(),cue=original.cue!,checkpointTick=gap?Math.ceil(stationEndTick(cue))+2:37;
  const old=f.listener(),a=f.listener(['station-live/2','station-live/1']);await until(()=>old.old.length>0&&a.views.length>0);
  assert.equal(old.c.stationContract,'station-live/1');assert.equal(a.c.stationContract,'station-live/2');
  const aSession=a.c.session!,oldSession=old.c.session!,epoch=original.station!.epoch;
  while(h.engine.world.tick<17)h.tickOnce();await accepted(h,v1.record());await until(()=>a.views.at(-1)!.view.anchor!.sourceTick===17);
  const b=f.listener(['station-live/2']);await until(()=>b.views.length>0);const bSession=b.c.session!;
  while(h.engine.world.tick<checkpointTick)h.tickOnce();
  if(!gap){await accepted(h,v1.record());await until(()=>a.views.at(-1)!.view.anchor?.sourceTick===checkpointTick);}
  const beforeBody=structuredClone(h.engine.world.entities.h_A),beforeCue=hashOf(cue);
  const event=await accepted(h,h.adoptCommons('world:checkpoint',{stationEraV1:true}));
  await until(()=>a.views.at(-1)!.view.physical!.revision===1&&b.views.at(-1)!.view.physical!.revision===1
    &&old.c.welcome!.rulesVersion===h.engine.rulesVersion&&old.c.station?.fresh===false);
  assert.equal(a.views.at(-1)!.view.anchor,null);assert.equal(b.views.at(-1)!.view.anchor,null);
  assert.deepEqual(a.c.session,aSession);assert.deepEqual(b.c.session,bSession);assert.ok(old.c.session!.generation>oldSession.generation);
  assert.equal(old.c.station!.fresh,false);assert.deepEqual(old.c.station!.cue,cue);assert.equal(stationLivePhaseV1(old.c.station,Date.now()),null);
  assert.equal(old.c.welcome!.rulesVersion,h.engine.rulesVersion);assert.equal(old.c.station!.station!.rulesVersion,original.station!.rulesVersion);
  assert.deepEqual(h.engine.world.entities.h_A,beforeBody);assert.equal(hashOf(cue),beforeCue);
  const scope={worldId:h.worldId,epoch,rulesVersion:h.engine.rulesVersion};
  const params=new URLSearchParams({...scope,tick:String(checkpointTick),sourceCutoffSeq:String(event.seq+1)});
  let response=await fetch(`http://127.0.0.1:${TEST_PORT}/v1/station-v2/history?`+params);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const cutoff=stationHistoricalV2Schema.parse(await response.json());assert.equal(cutoff.anchor,null);assert.equal(cutoff.physical!.revision,1);
  assert.deepEqual(cutoff.phase,gap?null:stationPhaseAtTickV2(cue,checkpointTick));assert.equal(cutoff.cue?.cueId??null,gap?null:cue.cueId);
  response=await fetch(`http://127.0.0.1:${TEST_PORT}/v1/station-v2/eras?`+new URLSearchParams({worldId:h.worldId,epoch,limit:'1'}));
  const page=stationEraPageV1Schema.parse(await response.json());assert.equal(page.eras.length,1);assert.equal(page.eras[0].fact.seq,event.seq+1);
  assert.equal(page.eras[0].source.seq,event.seq);assert.equal(page.nextAfterSeq,null);
  assert.equal(v2.eraPage({worldId:h.worldId,epoch},event.seq+1).eras.length,0);
  const current=await accepted(h,v2.record());await until(()=>a.views.at(-1)!.view.anchor?.revision===current.anchor!.revision&&b.views.at(-1)!.view.anchor?.revision===current.anchor!.revision);
  assert.deepEqual(a.c.session,aSession);assert.deepEqual(b.c.session,bSession);assert.deepEqual(a.views.at(-1)!.view,b.views.at(-1)!.view);
  if(!gap){assert.equal(current.cue!.cueId,cue.cueId);assert.equal(current.cue!.seed,cue.seed);}else{assert.notEqual(current.cue!.cueId,cue.cueId);assert.notEqual(current.cue!.seed,cue.seed);}
  // The recorder publishes completed chunks, not a fabricated zero-duration
  // capture on receipt of an era. Produce the first actual new-scene chunk.
  while(h.engine.world.tick<checkpointTick+21)h.tickOnce();
  const takes=h.engine.takeChunks!(-1).map(chunk=>recordedTakeChunkSchema.parse(chunk));
  const boundary=takes.find(c=>c.fromTick===checkpointTick&&c.take.rulesVersion===h.engine.rulesVersion);assert.ok(boundary,'actual new physical capture starts at checkpoint');
  assert.ok(boundary.take.renderSceneRef);assert.notEqual(boundary.take.renderSceneRef.hash,takes[0].take.renderSceneRef!.hash);
  for(const l of [a,b]){const probe=l.c.probe(()=>({t:'ping',n:1}));assert.ok(probe);await until(()=>l.pongs.length===1);
    assert.equal(l.pongs[0].receipt.sentAtMs,probe.sentAtMs);assert.ok(l.pongs[0].receipt.rttMs>=0&&l.pongs[0].receipt.rttMs<1000);}
  const serverNow=current.anchor!.serverTimeMs+250;
  assert.deepEqual(stationLivePhaseV2(a.views.at(-1)!.view,serverNow),stationLivePhaseV2(b.views.at(-1)!.view,serverNow));
  const late=f.listener(['station-live/2']);await until(()=>late.views.length>0);assert.deepEqual(late.views[0].view,current);
  a.c.close();assert.equal(a.c.stationV2,null);assert.equal(a.c.session,null);a.c.connect();await until(()=>a.sockets===2&&a.c.stationV2?.anchor?.revision===current.anchor!.revision);
  const resumed=a.c.session as ConnectionSession|null;assert.ok(resumed);
  assert.ok(resumed.generation>aSession.generation);assert.equal(resumed.epoch,aSession.epoch);assert.deepEqual(a.c.stationV2,current);
  assert.ok(a.c.probe(()=>({t:'ping',n:2})));await until(()=>a.pongs.length===2);
  while(h.engine.world.tick<Math.ceil(stationEndTick(current.cue!))+2)h.tickOnce();const next=await accepted(h,v2.record());
  await until(()=>b.c.stationV2?.cue?.cueId===next.cue!.cueId&&b.c.stationV2?.anchor?.revision===next.anchor!.revision);
  assert.equal(next.cue!.sequence,current.cue!.sequence+1);assert.notEqual(next.cue!.seed,current.cue!.seed);assert.equal(next.cue!.rulesVersion,h.engine.rulesVersion);
  assert.deepEqual(b.c.session,bSession);for(const l of [old,a,b,late]){assert.deepEqual(l.errors,[]);assert.equal(JSON.stringify(l.wire).includes('PRIVATE_TRANSPORT'),false);}
  assert.equal(f.db.paidCost(),0);assert.equal(h.minds.get('s_A')!.intent!.text,'PRIVATE_TRANSPORT_WORDS');
  t.diagnostic(JSON.stringify({kind:gap?'silence':'inside-cue',worldId:h.worldId,checkpointTick,physicalSeq:event.seq,eraSeq:event.seq+1,
    oldCueId:cue.cueId,currentCueId:current.cue!.cueId,nextCueId:next.cue!.cueId,currentPhysical:hashOf(current.physical),
    takeBoundary:{fromTick:boundary.fromTick,sceneHash:boundary.take.renderSceneRef.hash},sourceCutoff:cutoff.sourceCutoff,
    listeners:[a,b,late].map(l=>({sockets:l.sockets,initialReceipt:l.views[0].receipt,lastReceipt:l.views.at(-1)!.receipt,pongs:l.pongs})),
    phaseAtCommonServerTime:stationLivePhaseV2(current,serverNow),V1GenerationChanged:true,V2SessionPreserved:true,paidSpendUSD:0}));
});

test('actual routes are opt-in, no-overlap never downgrades, malformed capabilities and world/frontier/private queries refuse without writes',async t=>{
  const f=await runtime(t,['v1']),seq=f.h.seq,version=f.h.engine.rulesVersion,epoch=f.v1.view().station!.epoch;
  const unsupported=f.listener(['station-live/2']);await until(()=>unsupported.c.welcome!==null);
  assert.equal(unsupported.c.welcome!.stationContract,null);assert.equal(unsupported.c.stationV2,null);assert.equal(unsupported.old.length,0);
  for(const path of ['/v1/station-v2','/v1/station-v2/history','/v1/station-v2/eras']){
    const response=await fetch(`http://127.0.0.1:${TEST_PORT}`+path);assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');}
  const defaults=buildApp(f.deps);for(const path of ['/v1/station-v2','/v1/station-v2/history','/v1/station-v2/eras'])assert.equal((await defaults.request(path)).status,404);
  const candidate=buildApp({...f.deps,stationV2:f.v2});const q=new URLSearchParams({worldId:f.h.worldId,epoch,rulesVersion:version,tick:String(f.h.engine.world.tick)});
  const wrongHistory:Record<string,string>[]=[{worldId:'foreign'},{epoch:'0'.repeat(64)},{rulesVersion:'wrong'},{tick:'-1'},{tick:'NaN'},{sourceCutoffSeq:'-1'},
    {sourceCutoffSeq:String(seq+1)},{sourceCutoffSeq:'1'},{owner:'PRIVATE'}];
  for(const patch of wrongHistory)assert.equal((await candidate.request('/v1/station-v2/history?'+new URLSearchParams({...Object.fromEntries(q),...patch}))).status,404);
  const wrongPage:Record<string,string>[]=[{worldId:'foreign'},{epoch:'0'.repeat(64)},{afterSeq:'1'},{afterSeq:'-1'},{limit:'0'},{limit:'65'},{limit:'1e2'},
    {sourceCutoffSeq:'1'},{sourceCutoffSeq:String(seq+1)},{owner:'PRIVATE'}];
  for(const patch of wrongPage)assert.equal((await candidate.request('/v1/station-v2/eras?'+new URLSearchParams({worldId:f.h.worldId,epoch,...patch}))).status,404);
  const ws=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`),messages:any[]=[];f.raw.push(ws);ws.on('message',d=>messages.push(JSON.parse(d.toString())));await once(ws,'open');
  for(const stationContracts of [[],['station-live/2','station-live/2'],['station-live/3'],['station-live/1','station-live/2','station-live/1']])
    ws.send(JSON.stringify({t:'hello',proto:PROTO,stationContracts}));
  ws.send(JSON.stringify({t:'ping',n:777}));await until(()=>messages.some(m=>m.t==='pong'&&m.n===777));
  assert.equal(messages.some(m=>m.t==='welcome'),false);assert.equal(f.h.seq,seq);assert.equal(f.h.engine.rulesVersion,version);assert.equal(f.db.paidCost(),0);
});

test('Connection rejects unoffered/private V2, scope changes and skipped era; malformed progression requires a fresh welcome',async t=>{
  const fixture=JSON.parse((await import('node:fs')).readFileSync(new URL('../test/fixtures/station-era/native-station-era.v1.json',import.meta.url),'utf8')).journeys[0];
  class Socket{readyState=1;onopen:any;onclose:any;onmessage:any;onerror:any;sent:any[]=[];send(s:string){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}receive(m:unknown){this.onmessage?.({data:JSON.stringify(m)});}}
  for(const bad of [{...fixture.carried,owner:'PRIVATE'},{...fixture.carried,worldId:'foreign'},fixture.initial]){
    const s=new Socket(),errors:string[]=[],c=new Connection('ws://fixture',async()=>null,{onError:code=>errors.push(code)},()=>s,()=>1000,()=>100,
      {stationContracts:['station-live/2']});t.after(()=>c.close());c.connect();await s.onopen();
    s.receive({t:'welcome',proto:PROTO,build:'fixture',worldId:fixture.worldId,rulesVersion:fixture.rulesVersion,schema:'fixture',dt:.05,
      clockRate:1,serverTick:37,you:null,serverTime:1000,epoch:'fixture',stationContract:'station-live/2'});
    s.receive({t:'station-v2',view:fixture.carried});assert.ok(c.stationV2);s.receive({t:'station-v2',view:bad});assert.equal(c.stationV2,null);
    assert.equal(s.readyState,3);assert.equal(c.session,null);assert.equal(errors.at(-1),'station-v2.invalid');
  }
  assert.throws(()=>new Connection('ws://fixture',async()=>null,{},()=>new Socket(),undefined,undefined,{stationContracts:[]}));
  const s=new Socket(),errors:string[]=[],c=new Connection('ws://fixture',async()=>null,{onError:code=>errors.push(code)},()=>s,()=>1000,()=>100);
  t.after(()=>c.close());c.connect();await s.onopen();assert.equal(s.sent[0].stationContracts,undefined,'legacy hello remains byte-compatible');
  s.receive({t:'welcome',proto:PROTO,build:'fixture',worldId:fixture.worldId,rulesVersion:fixture.rulesVersion,schema:'fixture',dt:.05,
    clockRate:1,serverTick:37,you:null,serverTime:1000,epoch:'fixture',stationContract:'station-live/2'});
  assert.equal(errors.at(-1),'station.negotiation-invalid');assert.equal(c.stationContract,null);
  s.receive({t:'station-v2',view:fixture.carried});assert.equal(c.stationV2,null);assert.equal(s.readyState,3);
  class DeferredClose extends Socket{close(){this.readyState=2;}}
  const delayed=new DeferredClose(),d=new Connection('ws://fixture',async()=>null,{onStationV2:(view,receipt)=>{
    if(view)view.worldId='CONSUMER_MUTATION';if(receipt)receipt.session.worldId='CONSUMER_MUTATION';
  }},()=>delayed,()=>1000,()=>100,{stationContracts:['station-live/2']});
  t.after(()=>d.close());d.connect();await delayed.onopen();
  delayed.receive({t:'welcome',proto:PROTO,build:'fixture',worldId:fixture.worldId,rulesVersion:fixture.rulesVersion,schema:'fixture',dt:.05,
    clockRate:1,serverTick:37,you:null,serverTime:1000,epoch:'fixture',stationContract:'station-live/2'});
  delayed.receive({t:'station-v2',view:fixture.carried});assert.ok(d.stationV2);assert.equal(d.stationV2.worldId,fixture.worldId);
  assert.equal(d.session!.worldId,fixture.worldId);assert.ok(d.probe(()=>({t:'ping',n:1})));
  delayed.receive({t:'station-v2',view:{...fixture.carried,owner:'PRIVATE'}});assert.equal(d.session,null);
  delayed.receive({t:'station-v2',view:fixture.carried});assert.equal(d.stationV2,null);assert.equal(d.probe(()=>({t:'ping',n:2})),null);
});
