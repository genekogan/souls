import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setImmediate,setTimeout as delay} from 'node:timers/promises';
import {getRequestListener} from '@hono/node-server';
import WebSocket from 'ws';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';
import {PROTO,intentReceiptV2Schema} from '@souls/protocol';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {Brain} from './brain.ts';
import {Hub} from './hub.ts';
import {IntentControlV2} from './intent-control.ts';
import {buildApp} from './http.ts';
import {stripWorldRequestPath} from './world-request-path.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
import {installEdenSteeringModeV1} from './eden-steering-mode.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();
async function until(ok:()=>boolean){const end=performance.now()+8000;while(!ok()&&performance.now()<end)await delay(10);assert.ok(ok(),'actual network condition arrives');}
test('actual owner REST safely wakes physical sleep; all sockets receive truthful native rise/walk and redacted private stop',async t=>{
 const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow their purposes and rest.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'alice');await invite(f,'bob');const alice=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic network sleeper'})),bob=await accept(f.host,f.souls.create('dev:bob',{name:'Bob',description:'Synthetic separate network owner'}));f.brain.quiesce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());
 const server=createServer(),timers:ReturnType<typeof setInterval>[]=[],originalInterval=setInterval;
 t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=originalInterval(...args);timers.push(timer);return timer;});
 server.on('upgrade',req=>{req.url=stripWorldRequestPath(req.url,f.brain.cfg.worldPath);});
 const hub=new Hub(server,f.host,f.auth,f.db,f.souls),brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:.5},{clients:()=>hub.clients.size,onCall:c=>hub.brainCall(c),onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true,compilerCall:async<T>(o:any)=>{
  const input=JSON.parse(o.messages[0].content);return {out:{kind:'plan',registryHash:input.registry.registryHash,goals:[{goal:'walk',bindingId:'walk:commons-bench-west'}],explanation:'Walk to the registered west bench.',trigger:{kind:'now'}} as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
 }}),service=new IntentControlV2(f.host,brain,f.souls,{historyV1:true,closedGoalsV1:true,registeredActivitiesV1:true}),app=buildApp({cfg:brain.cfg,db:f.db,host:f.host,auth:f.auth,brain,souls:f.souls,hub,intentV2:service}),listener=getRequestListener(app.fetch),clients:WebSocket[]=[];hub.brain=brain;
 server.on('request',(req,res)=>{req.url=stripWorldRequestPath(req.url,brain.cfg.worldPath);void listener(req,res);});
 t.after(async()=>{brain.quiesce();f.host.stop();for(const timer of timers)clearInterval(timer);for(const socket of clients)socket.terminate();for(const socket of hub.wss.clients)socket.terminate();await new Promise<void>(r=>hub.wss.close(()=>r()));if(server.listening)await new Promise<void>((r,reject)=>server.close(e=>e?reject(e):r()));f.db.close();});
 await installCommonsProvisionCards(f.host,brain);await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await installEdenSteeringModeV1(f.host,{closedGoalsV1:true,registeredActivitiesV1:true});
 await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:alice.id,entityId:alice.entity_id,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-1',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[0].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 const pose=()=> (f.host.engine.world as NativeWorld).entities[alice.entity_id].human?.sleepPose;
 for(let i=0;i<3000&&pose()?.standingFraction!==0;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(pose()?.standingFraction,0);
 await new Promise<void>((r,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',r);});
 const connect=async(owner?:string)=>{const socket=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/w/eden/ws`),messages:any[]=[];clients.push(socket);socket.on('message',data=>messages.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,...(owner?{token:'dev:'+owner}:{})}));await until(()=>messages.some(m=>m.t==='takes'));return {socket,messages};};
 const a=await connect('alice'),b=await connect('bob'),anon=await connect();assert.deepEqual(a.messages.find(m=>m.t==='welcome').you.souls,[alice.id]);assert.deepEqual(b.messages.find(m=>m.t==='welcome').you.souls,[bob.id]);assert.equal(anon.messages.find(m=>m.t==='welcome').you,null);
 const base=`http://127.0.0.1:${TEST_PORT}/w/eden`,path='/v1/souls/'+alice.id+'/intent-v2',headers={authorization:'Bearer dev:alice','content-type':'application/json'},canary='PRIVATE_WS_SLEEP_OWNER_20261006';
 f.host.clockRate=1;f.host.start();const before=performance.now(),response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({contract:'soul-intent/2',op:'upsert',requestId:'network-wake-west',words:canary+' go to commons-bench-west'})});assert.equal(response.status,202);
 let receipt:any;await until(()=>{receipt=service.lookup(service.ownerScope({userId:alice.owner,expiresAt:Number.MAX_SAFE_INTEGER},alice.id),'network-wake-west');return receipt.phase!=='received';});
 const lookup=await fetch(base+path+'/requests/network-wake-west',{headers});assert.equal(lookup.status,200);receipt=intentReceiptV2Schema.parse(await lookup.json());assert.equal(receipt.phase,'understood',JSON.stringify(receipt));assert.match(receipt.revision.interpretation.summary,/Wake safely first/);const ref=receipt.revision.intentId;
 await until(()=>f.host.engine.world.entities[alice.entity_id].human?.activity==='walk');
 const chunks=(v:{messages:any[]})=>v.messages.filter(m=>m.t==='takes').flatMap(m=>m.chunks),phase=(chunk:any)=>chunk.take.finalState.entities[alice.entity_id].human;
 await until(()=>[a,b,anon].every(v=>chunks(v).some(c=>{const n=phase(c).sleepPose?.standingFraction;return n>0&&n<1;})&&chunks(v).some(c=>phase(c).activity==='walk')));
 await until(()=>[a,b,anon].every(v=>v.messages.some(m=>m.t==='batch'&&m.log.some((e:any)=>e.kind==='intent-sleep-stop-v1'))));
 for(const v of [a,b,anon]){const stops=v.messages.filter(m=>m.t==='batch').flatMap(m=>m.log).filter((e:any)=>e.kind==='intent-sleep-stop-v1');assert.equal(stops.length,1);assert.deepEqual(stops[0].payload,{worldId:f.host.worldId,soulId:alice.id,privateUpdate:true});assert.ok(!JSON.stringify(stops[0]).includes(ref));}
 await until(()=>JSON.stringify(a.messages).includes(canary));for(const v of [b,anon]){assert.ok(!JSON.stringify(v.messages).includes(canary));assert.ok(!JSON.stringify(v.messages).includes(ref));}
 assert.equal((await fetch(base+path+'/requests/network-wake-west',{headers:{authorization:'Bearer dev:bob'}})).status,404);assert.equal((await fetch(base+path+'/capabilities')).status,401);assert.equal((await fetch(base+path+'/capabilities',{headers:{authorization:'Bearer dev:bob'}})).status,403);
 for(const route of ['/v1/world','/v1/log','/v1/kernel','/v1/take']){const r=await fetch(base+route);assert.equal(r.status,200);const text=JSON.stringify(await r.json());assert.ok(!text.includes(canary));assert.ok(!text.includes(ref));}
 assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,1);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic(`one fake-owner real REST/WS case, observed submission→received native walk/take <=${Math.ceil(performance.now()-before)}ms at requested rate1; not p50/p95, real-model or user/device SLA`);
});
