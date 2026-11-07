import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {hashOf,authoredBoundaryDeclarationV1} from '@souls/engine-contract';
import {PROTO,TAKE_BOUNDARY_WIRE_V1,TAKE_BOUNDARY_WIRE_LIMITS,stringifyTakeBoundaryWireV1,hydrateTakeBoundaryWireV1} from '@souls/protocol';
import {Connection} from '@souls/client';
import {fixture} from '../test/native-owner-fixture.ts';
import {recordedToyFactory} from './toy-takes.ts';
import {Auth} from './auth.ts';
import {Hub} from './hub.ts';
import {buildApp} from './http.ts';

const boundary=(revision='a',acceptedAtTick=1)=>({...authoredBoundaryDeclarationV1(revision,[{id:'wall',buildingId:'room',kind:'wall',c:[1,2,3],half:[1,2,3],yaw:0,collision:'solid'}]),acceptedAtTick});
function chunk(tick:number,fact:unknown=boundary()){
 const finalState={tick,entities:{person:{pose:{p:[1,2,3]}}},...(fact===null?{}:{authoredBoundariesV1:fact})};
 return {fromTick:tick-1,toTick:tick,take:{dt:.05,ticks:1,tracks:[{id:'person',samples:[[1,2,3]]}],chapters:[{endingHash:hashOf(finalState)}],renderSceneRef:{hash:hashOf('scene-'+tick)},finalState,finalStateHash:hashOf(finalState)}};
}
const message=()=>({t:'takes',serverTick:8,chunks:[chunk(1),chunk(2),chunk(3),chunk(4),chunk(5,boundary('b',5)),chunk(6,boundary('b',5)),chunk(7,boundary('b',5)),chunk(8,null)],more:true});
const packed=(m:unknown=message())=>JSON.parse(stringifyTakeBoundaryWireV1(m));

test('lossless multi-scene/history message preserves complete ending/chapter hashes and canonical input',()=>{
 const m=message(),before=JSON.stringify(m),wire=packed(m),decoded:any=hydrateTakeBoundaryWireV1(wire);
 assert.equal(wire.facts.length,2);assert.deepEqual(decoded,m);assert.equal(JSON.stringify(decoded),before);assert.equal(JSON.stringify(m),before);
 for(let i=0;i<m.chunks.length;i++)assert.equal(hashOf(decoded.chunks[i].take.finalState),m.chunks[i].take.finalStateHash);
 assert.notEqual(decoded.chunks[0].take.finalState.authoredBoundariesV1,decoded.chunks[1].take.finalState.authoredBoundariesV1);
 (decoded as any).chunks[0].take.finalState.authoredBoundariesV1.boxes[0].c[0]=99;
 assert.equal((decoded as any).chunks[1].take.finalState.authoredBoundariesV1.boxes[0].c[0],1);assert.equal((m.chunks[0].take.finalState.authoredBoundariesV1 as any).boxes[0].c[0],1);
 assert.deepEqual(hydrateTakeBoundaryWireV1(packed(m)),m,'no global mutable dictionary cache');
 const absent={serverTick:0,chunks:[]};assert.equal(stringifyTakeBoundaryWireV1(absent),JSON.stringify(absent));assert.equal(hydrateTakeBoundaryWireV1(absent),absent);
});

test('strict dictionary rejects corrupted same-header geometry, unknown/mismatched keys and unsafe shapes',()=>{
 const bads:(()=>any)[]=[
 ()=>{const w=packed();w.facts[0].value.boxes[0].c[0]++;return w;},
 ()=>{const w=packed();w.facts[0].key='0'.repeat(64);return w;},
 ()=>{const w=packed();w.payload.chunks[0].take.finalState.authoredBoundariesV1.$takeBoundaryFactV1='0'.repeat(64);return w;},
 ()=>{const w=packed();w.facts.push(w.facts[0]);return w;},
 ()=>{const w=packed();w.facts[0].key='__proto__';return w;},
 ()=>{const w=packed();w.payload.chunks[0].take.finalState.authoredBoundariesV1.extra=true;return w;},
 ()=>{const w=packed();w.extra=true;return w;},
 ()=>{const w=packed();w.payload.chunks[0].take.finalState=null;return w;},
 ()=>{const w=packed();w.facts=Array(TAKE_BOUNDARY_WIRE_LIMITS.facts+1).fill(w.facts[0]);return w;},
 ()=>{const w=packed();w.contract='future';return w;},
 ()=>{const w=packed();w.payload.t='brain';return w;},
 ()=>{const w=packed();w.payload.chunks=[];return w;},
 ()=>{const w=packed();w.payload.chunks=Array(TAKE_BOUNDARY_WIRE_LIMITS.chunks+1).fill(w.payload.chunks[0]);return w;},
 ()=>{const w=packed();w.facts[0].value.boxes[0].id='x'.repeat(201);return w;},
 ];
 for(const bad of bads)assert.throws(()=>hydrateTakeBoundaryWireV1(bad()),/take-boundary-wire.invalid/);
 const m=message();(m.chunks[1].take.finalState.authoredBoundariesV1 as any).boxes[0].c[0]=99;
 assert.throws(()=>stringifyTakeBoundaryWireV1(m),/noncanonical authored fact/,'same source header must not hide changed boxes');
 const x=boundary(),reordered={acceptedAtTick:x.acceptedAtTick,boxes:x.boxes,sourceHash:x.sourceHash,sourceRevision:x.sourceRevision,version:x.version};
 assert.throws(()=>stringifyTakeBoundaryWireV1({serverTick:2,chunks:[chunk(1,x),chunk(2,reordered)]}),/different fact bytes/,'equal stable hash may not silently reorder original JSON bytes');
});

class Socket{readyState=1;onopen:any;onclose:any;onmessage:any;onerror:any;sent:any[]=[];closed=false;send(s:string){this.sent.push(JSON.parse(s));}close(){this.closed=true;}receive(m:unknown){this.onmessage?.({data:JSON.stringify(m)});}}
const welcome=(selected=false)=>({t:'welcome',proto:PROTO,build:'fixture',worldId:'wire-world',rulesVersion:'fixture',schema:'fixture',dt:.05,clockRate:1,serverTick:0,you:null,serverTime:1000,epoch:'same',...(selected?{takeTransport:TAKE_BOUNDARY_WIRE_V1}:{})});
for(const scenario of ['default','old-server','selected'] as const)test('client compatibility '+scenario,async t=>{
 const socket=new Socket(),seen:unknown[]=[],errors:string[]=[],opt=scenario!=='default';
 const connection=new Connection('ws://fixture',async()=>null,{onTakes:m=>seen.push(m),onError:c=>errors.push(c)},()=>socket,()=>1000,()=>100,undefined,opt);
 t.after(()=>connection.close());connection.connect();await socket.onopen();
 assert.equal(socket.sent[0].takeTransport,opt?TAKE_BOUNDARY_WIRE_V1:undefined);socket.receive(welcome(scenario==='selected'));
 const m=message();socket.receive(scenario==='selected'?packed(m):m);assert.deepEqual(seen,[m]);assert.deepEqual(errors,[]);
 if(scenario==='selected'){
  const bad=packed();bad.payload.chunks[0].take.finalState.authoredBoundariesV1.$takeBoundaryFactV1='0'.repeat(64);socket.receive(bad);
 }else socket.receive(packed());
 assert.equal(errors.at(-1),'takes.transport-invalid');assert.equal(socket.closed,true);assert.equal(seen.length,1);
});

async function local(t:any){
 const f=fixture(':memory:',recordedToyFactory),auth=new Auth(f.souls.cfg,f.db),server=createServer(),intervals:ReturnType<typeof setInterval>[]=[];
 const interval=setInterval;t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);intervals.push(timer);return timer;});
 const hub=new Hub(server,f.host,auth,f.db);hub.brain=f.brain;
 const m=message();t.mock.method(f.host.engine,'takeChunks',()=>m.chunks as any);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 t.after(async()=>{for(const timer of intervals)clearInterval(timer);for(const socket of hub.wss.clients)socket.terminate();await new Promise<void>(resolve=>hub.wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();});
 return {...f,auth,hub,port,m};
}

test('actual Hub hello negotiates explicitly and leaves old/raw clients and persistence input unchanged',async t=>{
 const f=await local(t),streams:any[][]=[],sockets:WebSocket[]=[];
 for(const selected of [false,true]){
  const socket=new WebSocket('ws://127.0.0.1:'+f.port+'/ws'),messages:any[]=[];streams.push(messages);sockets.push(socket);
  const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('finite WS takes deadline')),2000);socket.on('message',data=>{const m=JSON.parse(String(data));messages.push(m);if(m.t==='takes'||m.t==='take-boundary-wire'){clearTimeout(timer);resolve();}});socket.once('error',reject);});
  await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,...(selected?{takeTransport:TAKE_BOUNDARY_WIRE_V1}:{})}));await ready;
  assert.equal(messages.find(m=>m.t==='welcome').takeTransport,selected?TAKE_BOUNDARY_WIRE_V1:undefined);
  const takes=messages.find(m=>m.t=== (selected?'take-boundary-wire':'takes'));assert.deepEqual((hydrateTakeBoundaryWireV1(takes) as any).chunks,f.m.chunks);
 }
 const before=JSON.stringify(f.m);
 // Model the public recipient projection and prove neither raw nor packed
 // serialization can see the pre-projection marker.
 const original=(f.hub as any).privateMessage.bind(f.hub);
 t.mock.method(f.hub as any,'privateMessage',(client:any,m:any)=>{const publicMessage=original(client,m);if(publicMessage?.t!=='takes')return publicMessage;const {syntheticPrivate,...safe}=publicMessage;return safe;});
 const barriers=sockets.map(socket=>new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off('message',received);reject(new Error('finite WS barrier deadline'));},2000);
  const received=(data:unknown)=>{const m=JSON.parse(String(data));if(m.t==='pong'&&m.n===771){clearTimeout(timer);socket.off('message',received);resolve();}};
  socket.on('message',received);
 }));
 for(const messages of streams)messages.length=0;
 f.hub.broadcast({...f.m,syntheticPrivate:'MUST-BE-SCRUBBED'} as any);f.hub.broadcast({t:'pong',n:771,serverTime:0});await Promise.all(barriers);
 assert.deepEqual(streams[0][0],f.m);assert.deepEqual(hydrateTakeBoundaryWireV1(streams[1][0]),f.m);
 assert.equal(JSON.stringify(f.m),before);
});

test('actual public HTTP history/live takes negotiate only the exact query; original full chunks stay unchanged',async t=>{
 const f=await local(t),app=buildApp({cfg:{...f.souls.cfg,takesPersist:true},db:f.db,host:f.host,auth:f.auth,hub:f.hub,brain:f.brain,souls:f.souls,takes:{read:async()=>({chunks:f.m.chunks,more:true})} as any});
 const before=JSON.stringify(f.m.chunks);
 for(const path of ['/v1/takes','/v1/take'])for(const offer of ['', '?takeTransport=unknown','?takeTransport='+encodeURIComponent(TAKE_BOUNDARY_WIRE_V1)]){
  const response=await app.request(path+offer);assert.equal(response.status,200);const result:any=await response.json();
  assert.equal(result.t,offer.endsWith(encodeURIComponent(TAKE_BOUNDARY_WIRE_V1))?'take-boundary-wire':undefined);assert.deepEqual((hydrateTakeBoundaryWireV1(result) as any).chunks,f.m.chunks);
 }
 assert.equal(JSON.stringify(f.m.chunks),before);
});
