import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { getRequestListener } from '@hono/node-server';
import { WebSocket } from 'ws';
import { marsFactory,EDEN_COMMONS_WORLD } from '@sim/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { ClockFrontiers } from './clock-frontier.ts';
import { config } from './config.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { Souls } from './souls.ts';
import { Hub } from './hub.ts';
import { buildApp } from './http.ts';

test('actual native TCP/Hono/anonymous Hub exposes only committed clocks and closes peers/generic503 after writer refusal',async t=>{
  const db=new Db(':memory:');const factory=await marsFactory(EDEN_COMMONS_WORLD);
  const host=new WorldHost(db,factory,'clock-wire',1e9,'clock-wire',{durableClockV1:true});host.boot();host.drainInputs();
  db.upsertUser({id:'PRIVATE_CLOCK_OWNER',role:'user',email:null,wallet:null});
  db.createSoul({id:'s_A',entityId:'h_A',worldId:host.worldId,owner:'PRIVATE_CLOCK_OWNER',name:'Alice',description:'Resident',native:false});
  const birth=host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'PRIVATE_CLOCK_OWNER',name:'Alice',description:'Resident'});host.drainInputs();await birth;
  const intent=host.enqueue('intent','owner',{soulId:'s_A',intent:{text:'PRIVATE_CLOCK_PURPOSE',agenda:[]}});host.drainInputs();await intent;
  const cfg={...config,worldId:host.worldId,worldKey:'eden',brainMode:'fake' as const,budgetUsdPerDay:0,
    typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:'',publicUrl:'http://127.0.0.1:4958'};
  const auth=new Auth(cfg,db),brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}});
  const souls=new Souls(host,db,brain,cfg);let app:ReturnType<typeof buildApp>;
  const server=createServer((req,res)=>getRequestListener(app.fetch)(req,res));
  const timers:ReturnType<typeof setInterval>[]=[],interval=globalThis.setInterval;
  const capture=t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);timers.push(timer);return timer;});
  const hub=new Hub(server,host,auth,db);capture.mock.restore();hub.brain=brain;
  app=buildApp({cfg,db,host,auth,hub,brain,souls});
  const sockets:WebSocket[]=[];
  t.after(async()=>{host.stop();for(const timer of timers)clearInterval(timer);for(const ws of sockets)ws.terminate();
    hub.wss.close();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();});
  await new Promise<void>(resolve=>server.listen(4958,'127.0.0.1',resolve));
  const ws=new WebSocket('ws://127.0.0.1:4958/ws');sockets.push(ws);const messages:any[]=[];
  ws.on('message',b=>messages.push(JSON.parse(String(b))));await once(ws,'open');
  // Subscribe before hello/ticks: scheduler turns do not prove socket delivery.
  const takesMessage=new Promise<void>((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(deadline);ws.off('message',onMessage);ws.off('error',onError);ws.off('close',onClose);};
    const finish=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
    const onMessage=(data:WebSocket.RawData)=>{try{const m=JSON.parse(String(data));if(m.t==='takes')finish();}catch{finish(new Error('anonymous WebSocket delivered invalid JSON'));}};
    const onError=(error:Error)=>finish(error),onClose=()=>finish(new Error('anonymous WebSocket closed before committed takes delivery'));
    const deadline=setTimeout(()=>finish(new Error('anonymous WebSocket committed takes were not delivered within 2000 ms')),2000);
    ws.on('message',onMessage);ws.on('error',onError);ws.on('close',onClose);t.after(cleanup);
  });
  void takesMessage.catch(()=>{});
  const greeting=once(ws,'message',{signal:AbortSignal.timeout(2000)});ws.send(JSON.stringify({t:'hello',proto:1}));await greeting;
  while(host.engine.world.tick<20)host.tickOnce();
  await takesMessage;
  const takes=messages.filter(m=>m.t==='takes');assert.ok(takes.length);assert.ok(takes.every(m=>m.serverTick<=new ClockFrontiers(db).read(host.worldId)!.tick));
  const response=await fetch('http://127.0.0.1:4958/healthz');assert.equal(response.status,200);assert.equal((await response.json() as any).tick,20);
  const row=new ClockFrontiers(db).read(host.worldId)!;
  // A real ordered pong fences the already-sent committed frames. Their late
  // arrival after close initiation must not be mislabeled as a failed-tick send.
  ws.send(JSON.stringify({t:'ping',n:1701}));
  const deadline=performance.now()+4000;
  while(!messages.some(m=>m.t==='pong'&&m.n===1701)){assert.ok(performance.now()<deadline,'actual wire fence timed out');await setImmediate();}
  const before=messages.length,closed=once(ws,'close');
  db.db.exec("CREATE TEMP TRIGGER refuse_clock_wire BEFORE UPDATE ON clock_frontiers_v1 BEGIN SELECT RAISE(ABORT,'PRIVATE_WRITER_DETAIL'); END");
  assert.throws(()=>host.tickOnce(),/PRIVATE_WRITER_DETAIL/);const close=await closed;assert.equal(close[0],1013);assert.equal(messages.length,before);
  const replies=[];
  for(const path of ['/healthz','/v1/scene','/v1/take','/v1/takes','/v1/world','/v1/debug/world','/v1/station-v2','/v1/me','/v1/agent/perceive']){
    const r=await fetch('http://127.0.0.1:4958'+path);assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');
    const value=await r.json();assert.deepEqual(value,{ok:false,code:'world-unavailable',message:'World temporarily unavailable.',...(path==='/healthz'?{halted:true,glitches:{total:1,byRule:{'durability.clock-frontier':{halt:1}}}}:{})});replies.push(value);
  }
  const late=new WebSocket('ws://127.0.0.1:4958/ws');sockets.push(late);const lateMessages:unknown[]=[];
  late.on('message',b=>lateMessages.push(String(b)));await once(late,'open');const lateClose=once(late,'close');
  late.send(JSON.stringify({t:'hello',proto:1}));assert.equal((await lateClose)[0],1013);assert.deepEqual(lateMessages,[]);
  const publicBytes=JSON.stringify({messages,replies,lateMessages});
  for(const marker of ['PRIVATE_CLOCK_OWNER','PRIVATE_CLOCK_PURPOSE','PRIVATE_WRITER_DETAIL','durable-clock-frontier/1',row.engineHash,row.kernelHash,row.headEventHash])assert.ok(!publicBytes.includes(marker),marker);
  assert.deepEqual(new ClockFrontiers(db).read(host.worldId),row);assert.equal(db.paidCost(),0);
});
