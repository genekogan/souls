import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import type {callTool,CompileOut} from '@souls/brain';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {readIntentArrivalsV1} from './intent-arrivals.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {setImmediate} from 'node:timers/promises';
import {buildApp} from './http.ts';
import {hashToken} from './auth.ts';
import {Hub} from './hub.ts';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {publicEvent,intentArrivalFactV1,intentArrivalPageV1Schema} from '@souls/protocol';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
test('private native arrival follows own canonical play before resting-tail interruption, without fulfilling purpose; model-free replay and current-owner read',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may explore.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();await invite(f,'alice');await invite(f,'bob');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic native arrival owner'}));f.brain.quiesce();
  const compilerCall:typeof callTool=async<T>()=>{const out:CompileOut={understood:true,agenda:[{card:'go to',target:'commons-bench-east'},{card:'go to',target:'commons-bench-west'}],alignment:{understanding:'Visit east and then west.',trigger:{kind:'now'}}};return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};};
  const brain=new Brain(f.host,f.db,{...f.brain.cfg,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',budgetUsdPerDay:.5},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{compilerCall,intentV2Choices:true});t.after(()=>brain.quiesce());
  await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await accept<unknown>(f.host,f.host.enableIntentArrivalsV1());const service=new IntentControlV2(f.host,brain,f.souls,{historyV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
  const server=createServer((_,response)=>response.end('synthetic-arrival')),hub=new Hub(server,f.host,f.auth,f.db,f.souls);hub.brain=brain;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert.ok(address&&typeof address!=='string');const ws=new WebSocket('ws://127.0.0.1:'+address.port+'/ws'),messages:any[]=[];ws.on('message',raw=>messages.push(JSON.parse(String(raw))));
  t.after(async()=>{ws.terminate();hub.wss.close();await new Promise<void>(resolve=>server.close(()=>resolve()));});await once(ws,'open');
  // Subscribe before hello/ticks/events: scheduler turns do not prove wire delivery.
  const arrivalBatch=new Promise<void>((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(deadline);ws.off('message',onMessage);ws.off('error',onError);ws.off('close',onClose);};
    const finish=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
    const onMessage=(data:WebSocket.RawData)=>{try{const m=JSON.parse(String(data));if(m.t==='batch'&&Array.isArray(m.log)&&m.log.some((e:any)=>e.kind==='intent-arrival-v1'))finish();}catch{finish(new Error('anonymous WebSocket delivered invalid JSON'));}};
    const onError=(error:Error)=>finish(error),onClose=()=>finish(new Error('anonymous WebSocket closed before native arrival batch'));
    const deadline=setTimeout(()=>finish(new Error('anonymous WebSocket native arrival batch was not delivered within 2000 ms')),2000);
    ws.on('message',onMessage);ws.on('error',onError);ws.on('close',onClose);t.after(cleanup);
  });
  void arrivalBatch.catch(()=>{});
  const welcome=once(ws,'message',{signal:AbortSignal.timeout(2000)});ws.send(JSON.stringify({t:'hello',proto:1}));await welcome;
  brain.mode='live';await accept(f.host,service.submit(scope,{contract:'soul-intent/2',requestId:'arrival-original',op:'upsert',words:'PRIVATE_ARRIVAL_WORDS Go to east and then west.'}));await accept(f.host,service.settled());brain.mode='fake';
  const receipt=service.lookup(scope,'arrival-original');assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')return;const ref={intentId:receipt.revision.intentId,version:receipt.revision.version};
  for(let i=0;i<1800&&readIntentArrivalsV1(service,scope).arrivals.length<2;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}f.host.drainInputs();
  const read=readIntentArrivalsV1(service,scope);assert.equal(read.arrivals.length,2);assert.deepEqual(read.arrivals.map(a=>a.play.target),['commons-bench-east','commons-bench-west']);
  for(const a of read.arrivals){assert.deepEqual(a.intent,ref);assert.equal(a.seq,a.play.seq+1);assert.equal(a.navigation.status,'completed');assert.ok(a.navigation.endedTick<=a.tick);assert.equal(intentArrivalFactV1(f.db.events(f.host.worldId,a.seq-1,1)[0]).seq,a.seq);}
  assert.equal(f.host.intentHistoryOf(row.id).intents[ref.intentId].status,'active');assert.ok(Object.values(f.host.intentHistoryOf(row.id).attempts).some(a=>a.phase==='interrupted'));assert.ok(!f.db.events(f.host.worldId).some(e=>e.kind==='intent-v2'&&e.payload.op==='resolve'));
  assert.ok(!JSON.stringify(f.db.events(f.host.worldId).map(publicEvent)).includes('PRIVATE_ARRIVAL_WORDS'));for(const e of f.db.events(f.host.worldId).filter(e=>e.kind==='intent-arrival-v1')){const p=publicEvent(e).payload;assert.deepEqual(Object.keys(p).sort(),['privateUpdate','soulId','worldId']);}
  const app=buildApp({cfg:brain.cfg,db:f.db,host:f.host,auth:f.auth,brain,souls:f.souls,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub,intentV2:service});
  const route='/v1/souls/'+row.id+'/intent-v2/arrivals',request=(path:string,token?:string)=>app.request(path,{headers:token?{authorization:'Bearer '+token}:{}});
  const own=await request(route,'dev:alice');assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'no-store');const page=intentArrivalPageV1Schema.parse(await own.json());assert.equal(page.arrivals.length,2);assert.equal(page.complete,true);
  const fixed=await request(route+'?throughSeq='+read.arrivals[0].seq,'dev:alice');assert.equal(fixed.status,200);assert.equal(intentArrivalPageV1Schema.parse(await fixed.json()).arrivals.length,1);
  assert.equal((await request(route+'?afterSeq=PRIVATE_BAD_QUERY','dev:bob')).status,404);assert.equal((await request(route+'?extra=PRIVATE','dev:alice')).status,400);assert.equal((await request(route+'?afterSeq=1&afterSeq=2','dev:alice')).status,400);assert.equal((await request(route)).status,401);
  const token='sim_SYNTHETIC_ARRIVAL_TOKEN';f.db.setSoulToken(row.id,hashToken(token),'synthetic');const agentScope=service.agentScope(token);
  const agent=await request('/v1/agent/intent-v2/arrivals',token);assert.equal(agent.status,200);assert.deepEqual(intentArrivalPageV1Schema.parse(await agent.json()).arrivals,page.arrivals);
  f.db.setSoulToken(row.id,hashToken('sim_SYNTHETIC_REPLACED_ARRIVAL'),'synthetic');assert.throws(()=>readIntentArrivalsV1(service,agentScope));assert.equal((await request('/v1/agent/intent-v2/arrivals',token)).status,401);
  for(let i=0;i<20;i++)f.host.tickOnce();await arrivalBatch;
  assert.ok(messages.some(m=>m.t==='batch'&&m.log?.some((e:any)=>e.kind==='intent-arrival-v1')));for(const m of messages)if(m.t==='batch')for(const e of m.log??[])if(e.kind==='intent-arrival-v1')assert.deepEqual(Object.keys(e.payload).sort(),['privateUpdate','soulId','worldId']);
  const publicViews=[];for(const path of ['/v1/log','/v1/kernel','/v1/world','/v1/debug/world','/v1/take','/v1/takes']){const reply=await app.request(path);assert.equal(reply.status,200);publicViews.push(await reply.json());}
  const publicText=JSON.stringify([...messages,...publicViews]);assert.ok(!publicText.includes('PRIVATE_ARRIVAL_WORDS'));assert.ok(!publicText.includes(ref.intentId));
  const first=read.arrivals[0],stored=f.db.db.prepare('SELECT owner_id,body_hash FROM intent_arrivals_v1 WHERE world_id=? AND attempt_id=?').get(f.host.worldId,first.attemptId) as {owner_id:string;body_hash:string};
  f.db.db.prepare('UPDATE intent_arrivals_v1 SET owner_id=?,body_hash=? WHERE world_id=? AND attempt_id=?').run('dev:bob','FOREIGN_CORRUPT',f.host.worldId,first.attemptId);
  assert.equal(readIntentArrivalsV1(service,scope).arrivals.length,1,'foreign-owner rows are excluded before private source decoding');
  f.db.db.prepare('UPDATE intent_arrivals_v1 SET owner_id=?,body_hash=? WHERE world_id=? AND attempt_id=?').run(stored.owner_id,'OWN_CORRUPT',f.host.worldId,first.attemptId);assert.throws(()=>readIntentArrivalsV1(service,scope),/publication reference/);
  const current=f.db.soul(row.id)!;f.db.db.prepare('UPDATE souls SET retired_at=1 WHERE id=?').run(row.id);assert.throws(()=>readIntentArrivalsV1(service,scope),error=>!String(error).includes('publication reference'));
  f.db.db.prepare('UPDATE souls SET retired_at=? WHERE id=?').run(current.retired_at,row.id);f.db.db.prepare('UPDATE intent_arrivals_v1 SET body_hash=? WHERE world_id=? AND attempt_id=?').run(stored.body_hash,f.host.worldId,first.attemptId);
  assert.throws(()=>service.ownerScope({userId:'dev:bob',expiresAt:Number.MAX_SAFE_INTEGER},row.id));assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  brain.quiesce();f.host.saveSnapshot(true);let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.deepEqual(h.extra.intentArrivalsV1,f.host.extra.intentArrivalsV1);h.stop();f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual(h.extra.intentArrivalsV1,f.host.extra.intentArrivalsV1);assert.equal(h.engine.stateHash(),f.host.engine.stateHash());h.stop();
});
