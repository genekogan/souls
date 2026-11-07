// take-entities-ref/1 (lane L3e): the negotiated live take transport that sends each chunk's entity table only when it
// changes. Every decoded message must be JSON.stringify-identical to the raw one; old peers must see no change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {hashOf} from '@souls/engine-contract';
import {PROTO,TAKE_ENTITIES_WIRE_V1,TAKE_BOUNDARY_WIRE_V1,TakeEntitiesEncoderV1,hydrateTakeEntitiesV1,hydrateTakeBoundaryWireV1,type TakeEntitiesStateV1} from '@souls/protocol';
import {Connection} from '@souls/client';
import {fixture} from '../test/native-owner-fixture.ts';
import {recordedToyFactory} from './toy-takes.ts';
import {Auth} from './auth.ts';
import {Hub,joinLogEvent} from './hub.ts';

type Table=Record<string,unknown>;
const entity=(id:string,x:number)=>({id,kind:'person',pose:{p:[x,0,2],yaw:.5},tags:['a','b'],nested:{deep:{v:x}}});
const tableOf=(n:number,shift=0):Table=>{const t:Table={};for(let i=0;i<n;i++)t['e'+i]=entity('e'+i,i+shift);return t;};
function chunk(tick:number,entities:unknown){
 const finalState={tick,entities};
 return {fromTick:tick-1,toTick:tick,take:{dt:.05,ticks:1,tracks:[],finalState,finalStateHash:hashOf(finalState)}};
}
const takes=(serverTick:number,chunks:unknown[])=>({t:'takes',serverTick,chunks});

/** A stream of takes messages whose tables repeat, change one entity, add, delete, reorder and go missing. */
function stream(){
 const a=tableOf(60),aCopy=JSON.parse(JSON.stringify(a)),b={...a,e3:entity('e3',99)},c={...b,e60:entity('e60',1)};
 const d:Table={...c};delete d.e10;const reordered:Table={e1:a.e1,e0:a.e0,...Object.fromEntries(Object.entries(a).slice(2))};
 const moved=tableOf(60,7),sneaky={$takeEntitiesRefV1:1};
 return [
  takes(1,[chunk(1,a),chunk(2,a)]),
  takes(3,[chunk(3,aCopy)]),
  takes(4,[chunk(4,b),chunk(5,c),chunk(6,d)]),
  takes(7,[chunk(7,reordered),chunk(8,moved)]),
  takes(9,[chunk(9,sneaky),chunk(10,moved),{fromTick:10,toTick:11,take:{finalState:{tick:11}}}]),
  takes(12,[]),
  takes(13,[chunk(13,{e0:a.e0,__proto__x:1}),chunk(14,d)]),
 ];
}
/** Encode as the hub does for one peer: `last` advances only for sent messages. */
function encodeFor(enc:TakeEntitiesEncoderV1,peer:{last:number|null},m:any){const e=enc.encode(m,peer.last);if(!e)return JSON.parse(JSON.stringify(m));peer.last=e.last;return JSON.parse(JSON.stringify(e.envelope));}

test('round trip: every decoded takes message is JSON.stringify-identical; repeats travel as refs and small edits as patches',()=>{
 const enc=new TakeEntitiesEncoderV1(),peer={last:null as number|null},state:TakeEntitiesStateV1={last:null};
 let raw=0,wire=0;const kinds:string[]=[];
 for(const m of stream()){
  const before=JSON.stringify(m),w=encodeFor(enc,peer,m),out=hydrateTakeEntitiesV1(w,state);
  assert.equal(JSON.stringify(out),before);assert.equal(JSON.stringify(m),before,'encoder never mutates the source');
  raw+=before.length;wire+=JSON.stringify(w).length;
  if(w.t==='take-entities')w.payload.chunks.forEach((c:any,i:number)=>{const e=c.take?.finalState?.entities;kinds.push(w.ids[i]===null?(e?'raw':'none'):e.$takeEntitiesRefV1?'ref':e.$takeEntitiesPatchV1?'patch':'full');});
  else kinds.push('raw-message');
 }
 assert.deepEqual(kinds,['full','ref','ref','patch','patch','patch','full','full','raw','ref','none','raw-message','full','full']);
 assert.ok(wire<raw*.6,`wire ${wire} vs raw ${raw}`);
});

test('a key inserted mid-table (a new soul or edit) travels as a patch with its index, exactly',()=>{
 const a=tableOf(60),mid:Table={};for(const [k,v] of Object.entries(a)){mid[k]=v;if(k==='e20')mid.h_new=entity('h_new',5);}
 const enc=new TakeEntitiesEncoderV1(),peer={last:null as number|null},s:TakeEntitiesStateV1={last:null};
 for(const m of [takes(1,[chunk(1,a)]),takes(2,[chunk(2,mid)])]){const w=encodeFor(enc,peer,m);assert.equal(JSON.stringify(hydrateTakeEntitiesV1(w,s)),JSON.stringify(m));if(m.serverTick===2)assert.deepEqual(w.payload.chunks[0].take.finalState.entities.$takeEntitiesPatchV1.ins,[[21,'h_new']]);}
});

test('peers are independent, a dropped message leaves both sides in step, and decoded tables are frozen and shared',()=>{
 const enc=new TakeEntitiesEncoderV1(),ms=stream(),late={last:null as number|null},early={last:null as number|null};
 const sEarly:TakeEntitiesStateV1={last:null},sLate:TakeEntitiesStateV1={last:null};
 for(const m of ms){const before=JSON.stringify(m);assert.equal(JSON.stringify(hydrateTakeEntitiesV1(encodeFor(enc,early,m),sEarly)),before);}
 // a peer that joins late (and one whose first messages were dropped) starts with a full table
 for(const m of ms.slice(3)){const before=JSON.stringify(m);assert.equal(JSON.stringify(hydrateTakeEntitiesV1(encodeFor(enc,late,m),sLate)),before);}
 const s:TakeEntitiesStateV1={last:null},out:any=hydrateTakeEntitiesV1(encodeFor(enc,{last:null},ms[0]),s);
 assert.equal(out.chunks[0].take.finalState.entities,out.chunks[1].take.finalState.entities);
 assert.ok(Object.isFrozen(out.chunks[0].take.finalState.entities.e0.pose.p));
});

test('decoder rejects unknown refs, wrong bases, malformed envelopes and patch size mismatches without moving its state',()=>{
 const enc=new TakeEntitiesEncoderV1(),ms=stream(),peer={last:null as number|null};
 const first=encodeFor(enc,peer,ms[0]),second=encodeFor(enc,peer,ms[2]);
 const bads:any[]=[
  second,                                                     // ref without the table it names
  {...first,extra:1},{...first,contract:'take-entities-ref/2'},{...first,ids:[1]},{...first,ids:[0,1]},
  {...first,payload:{...first.payload,t:'brain'}},
 ];
 for(const bad of bads){const s:TakeEntitiesStateV1={last:null};assert.throws(()=>hydrateTakeEntitiesV1(bad,s),/take-entities-wire.invalid/);assert.equal(s.last,null);}
 const s:TakeEntitiesStateV1={last:null};hydrateTakeEntitiesV1(first,s);const was=s.last;
 const patched=encodeFor(enc,{last:was!.id},ms[2]);assert.ok(JSON.stringify(patched).includes('$takeEntitiesPatchV1'));
 const size=JSON.parse(JSON.stringify(patched));size.payload.chunks[0].take.finalState.entities.$takeEntitiesPatchV1.n++;
 assert.throws(()=>hydrateTakeEntitiesV1(size,s),/patch size/);assert.equal(s.last,was);
 const based=JSON.parse(JSON.stringify(patched));based.payload.chunks[0].take.finalState.entities.$takeEntitiesPatchV1.base=999;
 assert.throws(()=>hydrateTakeEntitiesV1(based,s),/patch shape/);assert.equal(s.last,was);
 assert.equal(JSON.stringify(hydrateTakeEntitiesV1(patched,s)),JSON.stringify(ms[2]),'the intact patch still applies');
 const other={t:'takes',chunks:[]};assert.equal(hydrateTakeEntitiesV1(other,s),other,'other messages pass through');
});

test('joinLogEvent slims only world-edit payloads and keeps the row identity',()=>{
 const edit={seq:4,tick:9,author:'god',kind:'world-edit',payload:{contract:'world-edit/1',seq:2,hash:'h',physics:{big:'x'.repeat(1000)},assets:[1,2]}};
 const slim=joinLogEvent(edit);
 assert.deepEqual(slim,{seq:4,tick:9,author:'god',kind:'world-edit',payload:{contract:'world-edit/1',seq:2,hash:'h',omitted:'physics and assets (in the world state; GET /v1/log for the full event)'}});
 assert.equal(edit.payload.physics.big.length,1000,'source event unchanged');
 const say={seq:5,kind:'say',payload:{text:'hi'}};assert.equal(joinLogEvent(say),say);
 const bare={seq:6,kind:'world-edit'};assert.equal(joinLogEvent(bare),bare);
});

class Socket{readyState=1;onopen:any;onclose:any;onmessage:any;onerror:any;sent:any[]=[];closed=false;send(s:string){this.sent.push(JSON.parse(s));}close(){this.closed=true;}receive(m:unknown){this.onmessage?.({data:JSON.stringify(m)});}}
const welcome=(entities:boolean,boundary=false)=>({t:'welcome',proto:PROTO,build:'fixture',worldId:'wire-world',rulesVersion:'fixture',schema:'fixture',dt:.05,clockRate:1,serverTick:0,you:null,serverTime:1000,epoch:'same',...(entities?{takeEntities:TAKE_ENTITIES_WIRE_V1}:{}),...(boundary?{takeTransport:TAKE_BOUNDARY_WIRE_V1}:{})});
for(const scenario of ['default','old-server','selected'] as const)test('client compatibility '+scenario,async t=>{
 const sockets:Socket[]=[],seen:unknown[]=[],errors:string[]=[],opt=scenario!=='default';
 const connection=new Connection('ws://fixture',async()=>null,{onTakes:m=>seen.push(m),onError:c=>errors.push(c)},()=>{const s=new Socket();sockets.push(s);return s;},()=>1000,()=>100,undefined,opt);
 t.after(()=>connection.close());connection.connect();const socket=sockets[0];await socket.onopen();
 assert.equal(socket.sent[0].takeEntities,opt?TAKE_ENTITIES_WIRE_V1:undefined);socket.receive(welcome(scenario==='selected'));
 const ms=stream(),enc=new TakeEntitiesEncoderV1(),peer={last:null as number|null};
 for(const m of ms.slice(0,4))socket.receive(scenario==='selected'?encodeFor(enc,peer,m):m);
 assert.equal(JSON.stringify(seen),JSON.stringify(ms.slice(0,4)));assert.deepEqual(errors,[]);
 if(scenario!=='selected'){socket.receive(encodeFor(new TakeEntitiesEncoderV1(),{last:null},ms[0]));assert.equal(errors.at(-1),'takes.transport-invalid');assert.equal(socket.closed,true);return;}
 // a reference to a table this socket never received closes the socket rather than guessing
 socket.receive({t:'take-entities',contract:TAKE_ENTITIES_WIRE_V1,ids:[42],payload:takes(20,[chunk(20,{$takeEntitiesRefV1:42})])});
 assert.equal(errors.at(-1),'takes.transport-invalid');assert.equal(socket.closed,true);assert.equal(seen.length,4);
});

test('client keeps decode state per socket: a new socket starts empty',async t=>{
 const sockets:Socket[]=[],seen:any[]=[],errors:string[]=[];
 const connection=new Connection('ws://fixture',async()=>null,{onTakes:m=>seen.push(m),onError:c=>errors.push(c)},()=>{const s=new Socket();sockets.push(s);return s;},()=>1000,()=>100,undefined,true);
 t.after(()=>connection.close());connection.connect();await sockets[0].onopen();sockets[0].receive(welcome(true));
 const ms=stream(),enc=new TakeEntitiesEncoderV1();
 sockets[0].receive(encodeFor(enc,{last:null},ms[0]));assert.equal(seen.length,1);
 (connection as any).open();await sockets[1].onopen();sockets[1].receive(welcome(true));
 const ref=encodeFor(enc,{last:1},ms[1]);sockets[1].receive(ref);
 assert.equal(errors.at(-1),'takes.transport-invalid','the old socket\'s table is not visible to the new one');
 assert.equal(seen.length,1);
});

async function local(t:any,chunks:()=>unknown[]){
 const f=fixture(':memory:',recordedToyFactory),auth=new Auth(f.souls.cfg,f.db),server=createServer(),intervals:ReturnType<typeof setInterval>[]=[];
 const interval=setInterval;t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);intervals.push(timer);return timer;});
 const hub=new Hub(server,f.host,auth,f.db);hub.brain=f.brain;
 t.mock.method(f.host.engine,'takeChunks',()=>chunks() as any);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 t.after(async()=>{for(const timer of intervals)clearInterval(timer);for(const socket of hub.wss.clients)socket.terminate();await new Promise<void>(resolve=>hub.wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();});
 return {...f,auth,hub,port};
}

test('actual Hub: legacy, entities and entities+boundary sockets side by side get identical takes per serverTick',async t=>{
 const ms=stream();const f=await local(t,()=>ms[0].chunks);
 const offers=[{},{takeEntities:TAKE_ENTITIES_WIRE_V1},{takeEntities:TAKE_ENTITIES_WIRE_V1,takeTransport:TAKE_BOUNDARY_WIRE_V1},{takeEntities:'take-entities-ref/9'}];
 const streams:any[][]=[],sockets:WebSocket[]=[];
 for(const offer of offers){
  const socket=new WebSocket('ws://127.0.0.1:'+f.port+'/ws'),messages:any[]=[];streams.push(messages);sockets.push(socket);
  const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('finite WS takes deadline')),2000);socket.on('message',data=>{const m=JSON.parse(String(data));messages.push(m);if(m.t==='takes'||m.t==='take-entities'||m.t==='take-boundary-wire'){clearTimeout(timer);resolve();}});socket.once('error',reject);});
  await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,...offer}));await ready;
  assert.equal(messages.find(m=>m.t==='welcome').takeEntities,'takeEntities' in offer&&offer.takeEntities===TAKE_ENTITIES_WIRE_V1?TAKE_ENTITIES_WIRE_V1:undefined);
 }
 const barriers=sockets.map((socket,i)=>new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('finite WS barrier deadline '+i)),3000);
  const received=(data:unknown)=>{const m=JSON.parse(String(data));if(m.t==='pong'&&m.n===772){clearTimeout(timer);socket.off('message',received);resolve();}};
  socket.on('message',received);
 }));
 for(const m of ms.slice(1))f.hub.broadcast(m as any);f.hub.broadcast({t:'pong',n:772,serverTime:0});await Promise.all(barriers);
 const decoded=streams.map((messages,i)=>{
  const s:TakeEntitiesStateV1={last:null};
  return messages.filter(m=>m.t==='takes'||m.t==='take-entities'||m.t==='take-boundary-wire').map(m=>JSON.stringify(m.t==='take-boundary-wire'?hydrateTakeBoundaryWireV1(m):hydrateTakeEntitiesV1(m,s,p=>(p as any)?.t==='take-boundary-wire'?hydrateTakeBoundaryWireV1(p):p)));
 });
 assert.equal(decoded[0].length,ms.length);
 for(let i=1;i<decoded.length;i++)assert.deepEqual(decoded[i],decoded[0],'stream '+i);
 assert.deepEqual(decoded[0].slice(1),ms.slice(1).map(m=>JSON.stringify(m)));
 assert.ok(streams[1].some(m=>m.t==='take-entities'&&JSON.stringify(m).includes('$takeEntitiesRefV1')));
 for(const i of [0,3]){assert.ok(!streams[i].some(m=>m.t==='take-entities'),'unannounced peers see raw takes');assert.deepEqual(streams[i].filter(m=>m.t==='takes').slice(1).map(m=>JSON.stringify(m)),ms.slice(1).map(m=>JSON.stringify(m)));}
});

test('queue rule: the join set and the first takes after it survive >1 MB queued; later takes and other messages drop',t=>{
 const hub=Object.create(Hub.prototype) as any;hub.host={clockAvailable:true,worldId:'w'};hub.takeEntities=new TakeEntitiesEncoderV1();hub.lifecycleSouls=null;
 const sent:any[]=[],ws={readyState:1,bufferedAmount:2_000_000,send:(s:string)=>sent.push(JSON.parse(s)),close(){}};
 const c:any={ws,sent:0,joinSend:true,awaitingTakes:true};
 const m=stream()[0];
 assert.equal(hub.send(c,{t:'snapshot',reason:'join'}),true);assert.equal(hub.send(c,{t:'log',events:[]}),true);
 assert.equal(hub.send(c,{...m,chunks:[]}),true,'join takes sent even when empty');
 c.joinSend=false;
 assert.equal(hub.send(c,{t:'stats',stats:{}}),false,'outside the join set a backed-up socket drops');
 assert.equal(c.awaitingTakes,true,'an empty takes message is not a usable first chunk');
 assert.equal(hub.send(c,m),true,'the first takes with a chunk after a join is kept');assert.equal(c.awaitingTakes,false);
 assert.equal(hub.send(c,m),false,'later takes drop while backed up');
 ws.bufferedAmount=0;assert.equal(hub.send(c,m),true);
 assert.deepEqual(sent.map(x=>x.t),['snapshot','log','takes','takes','takes']);
 t.diagnostic('sent '+sent.length);
});

test('D6: batches reach a socket still backed up by its join set (a dropped batch is a seq gap and a 1.4 MB resync); stats drop',()=>{
 const hub=Object.create(Hub.prototype) as any;hub.host={clockAvailable:true,worldId:'w'};hub.lifecycleSouls=null;
 const sent:any[]=[],ws={readyState:1,bufferedAmount:2_000_000,send:(s:string)=>sent.push(JSON.parse(s)),close(){}};
 hub.clients=new Set([{ws,sent:0,ready:true}]);
 hub.broadcast({t:'batch',seq:7,fromTick:1,toTick:2,paths:[],changes:[],log:[],souls:[],removedSouls:[]});
 hub.broadcast({t:'stats',stats:{}});
 assert.deepEqual(sent.map(x=>[x.t,x.seq]),[['batch',7]]);
});
