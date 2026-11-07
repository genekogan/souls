import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import WebSocket from 'ws';
import { Connection,type ClockProbe,type PongReceipt,type TransportReceipt,type ConnectionSession } from '@souls/client';
import { PROTO,type StationLiveV1,type ServerMsg } from '@souls/protocol';
import { marsFactory } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { CandidateStationV1 } from './station.ts';
import { Hub } from './hub.ts';
import type { Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import { acceptStationFixture } from '../test/fixtures/station/generate.ts';

const welcome=(worldId='client-world',epoch='process-1'):Extract<ServerMsg,{t:'welcome'}>=>({t:'welcome',proto:PROTO,build:'fixture',worldId,
  rulesVersion:'fixture-rules',schema:'fixture',dt:.05,clockRate:1,serverTick:0,you:null,serverTime:1000,epoch});
const empty:StationLiveV1={contract:'station-live/1',worldId:'client-world',station:null,cue:null,anchor:null,fresh:false};
class FakeSocket {
  readyState=1;onopen:any;onclose:any;onmessage:any;onerror:any;sent:unknown[]=[];
  send(s:string){this.sent.push(JSON.parse(s));}
  close(){this.readyState=3;this.onclose?.();}
  receive(m:unknown){this.onmessage?.({data:typeof m==='string'?m:JSON.stringify(m)});}
}
async function setup(t:any){
  const sockets:FakeSocket[]=[],stations:{view:StationLiveV1|null;receipt:TransportReceipt|null}[]=[],pongs:{message:unknown;receipt:PongReceipt}[]=[],sessions:(ConnectionSession|null)[]=[],errors:string[]=[];
  let mono=100,wall=10000;
  const c=new Connection('ws://fixture/ws',async()=>null,{onStation:(view,receipt)=>stations.push({view,receipt}),onPong:(message,receipt)=>pongs.push({message,receipt}),
    onSession:s=>sessions.push(s),onError:code=>errors.push(code)},()=>{const s=new FakeSocket();sockets.push(s);return s;},()=>wall,()=>mono);
  t.after(()=>c.close());c.connect();await sockets[0].onopen();sockets[0].receive(welcome());
  return {c,sockets,stations,pongs,sessions,errors,setMono:(v:number)=>{mono=v;},setWall:(v:number)=>{wall=v;}};
}

test('strict current-world station hook keeps detached public data and rejects malformed/private/foreign wrappers',async t=>{
  const f=await setup(t),ws=f.sockets[0];ws.receive({t:'station',view:empty});
  assert.equal(f.stations.length,1);assert.equal(f.stations[0].receipt!.receivedAtMs,100);assert.equal(f.stations[0].receipt!.session.worldId,'client-world');
  f.stations[0].view!.worldId='mutated-consumer';assert.equal(f.c.station!.worldId,'client-world');
  for(const bad of [{t:'station',view:{...empty,owner:'PRIVATE'}},{t:'station',view:{...empty,worldId:'other-world'}},{t:'station',view:empty,private:'PRIVATE'},
    {t:'station',view:{...empty,fresh:true}},{t:'station',view:{...empty,contract:'station-live/2'}}]){
    ws.receive(bad);assert.equal(f.c.station,null);assert.equal(f.stations.at(-1)!.view,null);
  }
  assert.equal(f.errors.filter(x=>x==='station.invalid').length,5);
  ws.receive('not JSON');assert.equal(f.errors.at(-1),'message.invalid');ws.receive({t:'future-addition',anything:1});ws.receive(null);
  assert.equal(f.c.stats.state,'open');
  const sent=ws.sent.length;assert.equal(f.c.probe(()=>({t:'ping',n:1,owner:'PRIVATE'} as any)),null);assert.equal(ws.sent.length,sent);
  assert.ok(f.c.probe(()=>({t:'ping',n:1})));
});

test('explicit pong receipt correlates the actual monotonic send boundary, consumes once and survives a wall-clock jump',async t=>{
  const f=await setup(t),ws=f.sockets[0];let builtAt:number|undefined;
  const probe=f.c.probe(at=>{builtAt=at;return {t:'ping',n:1};})!;
  assert.equal(builtAt,100);assert.equal(probe.sentAtMs,100);assert.equal(probe.automatic,false);assert.deepEqual(ws.sent.at(-1),{t:'ping',n:1});
  f.setWall(-1e9);f.setMono(125);ws.receive({t:'pong',n:1,serverTime:123456});
  assert.equal(f.pongs.length,1);assert.equal(f.pongs[0].receipt.rttMs,25);assert.equal(f.pongs[0].receipt.receivedAtMs,125);
  assert.equal(f.c.stats.rttMs,25);assert.deepEqual(f.pongs[0].receipt.session,probe.session);
  for(const bad of [{t:'pong',n:1,serverTime:123456},{t:'pong',n:7,serverTime:123456},{t:'pong',n:1,serverTime:Infinity},
    {t:'pong',n:1,serverTime:123456,owner:'PRIVATE'}])ws.receive(bad);
  assert.equal(f.pongs.length,1);assert.equal(f.c.probe(()=>({t:'ping',n:1})),null);
});

test('same-socket welcome and reconnect clear station/probes; old messages and recycled probe IDs cannot resurrect phase',async t=>{
  const f=await setup(t),ws=f.sockets[0];ws.receive({t:'station',view:empty});const p=f.c.probe(()=>({t:'ping',n:1}))!;
  ws.receive(welcome('client-world','process-2'));assert.equal(f.c.station,null);assert.equal(f.sessions.at(-2),null);
  assert.ok(f.c.session!.generation>p.session.generation);ws.receive({t:'pong',n:1,serverTime:1000});assert.equal(f.pongs.length,0);
  assert.equal(f.c.probe(()=>({t:'ping',n:1})),null);assert.ok(f.c.probe(()=>({t:'ping',n:2})));
  ws.close();assert.equal(f.c.session,null);assert.equal(f.c.probe(()=>({t:'ping',n:3})),null);
  ws.receive({t:'station',view:empty});ws.receive(welcome());assert.equal(f.c.session,null);
  f.c.connect();const fresh=f.sockets[1];await fresh.onopen();fresh.receive(welcome('client-world','process-3'));
  ws.receive({t:'pong',n:2,serverTime:1000});assert.equal(f.pongs.length,0);assert.ok(f.c.probe(()=>({t:'ping',n:3})));
  f.setMono(130);fresh.receive({t:'pong',n:3,serverTime:1000});assert.equal(f.pongs.length,1);
});

test('pending probes are bounded/expire, malformed builders do not send and clock regression invalidates transport',async t=>{
  const f=await setup(t),ws=f.sockets[0];
  for(let n=1;n<=16;n++)assert.ok(f.c.probe(()=>({t:'ping',n})));
  assert.equal(f.c.probe(()=>({t:'ping',n:17})),null);assert.equal(ws.sent.length,17); // hello + sixteen probes
  f.setMono(12101);assert.ok(f.c.probe(()=>({t:'ping',n:17})));ws.receive({t:'pong',n:1,serverTime:1000});assert.equal(f.pongs.length,0);
  for(const n of [-1,NaN,.5,Number.MAX_SAFE_INTEGER+1])assert.equal(f.c.probe(()=>({t:'ping',n})),null);
  f.setMono(12000);assert.equal(f.c.probe(()=>({t:'ping',n:18})),null);assert.equal(f.c.session,null);assert.equal(f.errors.at(-1),'clock.invalid');
});

test('replacing an open Connection closes its old socket and ignores late welcome/authentication messages',async t=>{
  const f=await setup(t),old=f.sockets[0];old.receive({t:'station',view:empty});
  f.c.connect();assert.equal(old.readyState,3);assert.equal(f.c.session,null);assert.equal(f.c.station,null);
  old.receive(welcome('other-world','obsolete'));assert.equal(f.c.session,null);
  await f.sockets[1].onopen();f.sockets[1].receive(welcome('client-world','replacement'));
  assert.equal(f.c.session!.epoch,'replacement');assert.equal(f.sockets.filter(s=>s.readyState===1).length,1);
});

test('automatic keepalive keeps measured RTT and a distinct probe namespace without confusing explicit clock samples',async t=>{
  const interval=globalThis.setInterval,callbacks:(()=>void)[]=[],tokens:ReturnType<typeof setInterval>[]=[];
  globalThis.setInterval=((fn:(...args:any[])=>void,delay?:number,...args:any[])=>{const token=interval(fn,delay,...args);tokens.push(token);callbacks.push(()=>fn(...args));return token;}) as typeof setInterval;
  t.after(()=>{globalThis.setInterval=interval;for(const token of tokens)clearInterval(token);});
  const f=await setup(t);globalThis.setInterval=interval;callbacks[0]();const ping=f.sockets[0].sent.at(-1) as {t:string;n:number};
  assert.equal(ping.t,'ping');assert.ok(ping.n<0);f.setMono(140);f.sockets[0].receive({t:'pong',n:ping.n,serverTime:1000});
  assert.equal(f.c.stats.rttMs,40);assert.equal(f.pongs[0].receipt.automatic,true);assert.ok(f.c.probe(()=>({t:'ping',n:1})));
});

test('actual local native Hub publishes station through one Connection and echoes its correlated clock probe',async t=>{
  const db=new Db(':memory:'),factory=await marsFactory(),host=new WorldHost(db,factory,'client-native-station',1e9,'client-native-station');host.boot();host.drainInputs();
  const station=new CandidateStationV1(host),expected=await acceptStationFixture(host,station.record()),server=createServer();
  const intervals:ReturnType<typeof setInterval>[]=[],original=globalThis.setInterval;let hub:Hub;
  globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>{const timer=original(...args);intervals.push(timer);return timer;}) as typeof setInterval;
  try{hub=new Hub(server,host,{userFromToken:async()=>null} as unknown as Auth,db,undefined,station);}finally{globalThis.setInterval=original;}
  hub.brain={camera:null,ticker:[],narratives:new Map(),mode:'fake',callsToday:0,spentToday:0,budget:0,inflight:new Set(),jevMsAvg:0} as unknown as Brain;
  let c:Connection|undefined,connections=0;const seen:{view:StationLiveV1;receipt:TransportReceipt}[]=[],pongs:{pong:Extract<ServerMsg,{t:'pong'}>;receipt:PongReceipt}[]=[],errors:string[]=[];
  t.after(async()=>{c?.close();for(const timer of intervals)clearInterval(timer);for(const client of hub.clients)client.ws.terminate();
    await new Promise<void>(resolve=>hub.wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();});
  server.listen(4958,'127.0.0.1');await once(server,'listening');
  c=new Connection('ws://127.0.0.1:4958/ws',async()=>null,{onStation:(view,receipt)=>{if(view&&receipt)seen.push({view,receipt});},
    onPong:(pong,receipt)=>pongs.push({pong,receipt}),onError:code=>errors.push(code)},url=>{connections++;return new WebSocket(url);});c.connect();
  async function until(check:()=>boolean){const limit=performance.now()+3000;while(!check()){assert.ok(performance.now()<limit,'actual Connection callback timed out');await setImmediate();}}
  await until(()=>seen.length>0);assert.deepEqual(seen[0].view,expected);assert.equal(seen[0].receipt.session.worldId,host.worldId);assert.equal(seen[0].receipt.session.epoch,hub.epoch);
  const probe:ClockProbe=c.probe(()=>({t:'ping',n:1}))!;assert.ok(probe);await until(()=>pongs.length>0);
  assert.equal(pongs[0].pong.n,1);assert.equal(pongs[0].receipt.sentAtMs,probe.sentAtMs);assert.ok(pongs[0].receipt.receivedAtMs>=probe.sentAtMs);
  assert.ok(Number.isSafeInteger(pongs[0].pong.serverTime));assert.ok(pongs[0].receipt.rttMs<1000);assert.equal(connections,1);assert.deepEqual(errors,[]);
  assert.equal(db.paidCost(),0);assert.equal(JSON.stringify({seen,pongs}).includes('PRIVATE'),false);
});

test('P1: before the join snapshot a slow link may stay silent up to 60 s; after it, 12 s of silence closes the socket',async t=>{
  const interval=globalThis.setInterval,callbacks:(()=>void)[]=[],tokens:ReturnType<typeof setInterval>[]=[];
  globalThis.setInterval=((fn:(...args:any[])=>void,delay?:number,...args:any[])=>{const token=interval(fn,delay,...args);tokens.push(token);callbacks.push(()=>fn(...args));return token;}) as typeof setInterval;
  t.after(()=>{globalThis.setInterval=interval;for(const token of tokens)clearInterval(token);});
  const f=await setup(t);const ws=f.sockets[0];
  f.setWall(10000+30_000);callbacks[0]();assert.equal(ws.readyState,1,'a 1.4 MB join snapshot still arriving: keep the socket');
  f.setWall(10000+61_000);callbacks[0]();assert.equal(ws.readyState,3,'a minute of silence before the snapshot: dead');
  f.c.connect();const fresh=f.sockets[1];await fresh.onopen();fresh.receive(welcome());
  fresh.receive({t:'snapshot',entities:{},regions:{},env:null,tick:1,seq:1,paths:[],souls:[]});
  f.setWall(10000+61_000+13_000);assert.equal(f.c.stats.snapshots,1);callbacks.at(-1)!();assert.equal(fresh.readyState,3,'after the snapshot the 12 s rule applies');
});
