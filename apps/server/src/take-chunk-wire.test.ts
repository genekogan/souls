// take-chunk-ref/1 (lane S2): the negotiated live take transport that leaves out what a take repeats from the previous
// one (old Eden: ~380 KB a chunk of boundaries, nav, regions, entities0, changes, tracks). Every decoded message must be
// JSON.stringify-identical (and deep-equal) to the raw one, over recorded original-world sessions; old peers see no change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {hashOf} from '@souls/engine-contract';
import {PROTO,TAKE_ENTITIES_WIRE_V1,TAKE_BOUNDARY_WIRE_V1,TAKE_CHUNKS_WIRE_V1,TakeChunksEncoderV1,hydrateTakeChunksV1,hydrateTakeEntitiesV1,hydrateTakeBoundaryWireV1,
 type TakeEntitiesStateV1,type TakeChunksStateV1} from '@souls/protocol';
import {Connection} from '@souls/client';
import {fixture} from '../test/native-owner-fixture.ts';
import {recordedToyFactory} from './toy-takes.ts';
import {Auth} from './auth.ts';
import {Hub} from './hub.ts';

/** Raw takes messages a stranger received from the original worlds on a local legacy-mode launcher (lane S2, 2026-10-18,
 *  compact copies of the cutover stage): old Eden 30 s, Mars and Little Martians 15 s. */
const recorded=(world:string):string[]=>brotliDecompressSync(readFileSync(new URL('../test/fixtures/old-world-takes/'+world+'.jsonl.br',import.meta.url))).toString('utf8').trim().split('\n');
const WORLDS=['eden','mars','littlemartians'];

const big=(n:number,tag:string)=>Array.from({length:n},(_,i)=>({i,tag,p:[i,i*2,i*3]}));
function chunk(tick:number,o:{tracks?:unknown;changes?:unknown;nav?:unknown;entities?:unknown;extra?:Record<string,unknown>}={}){
 const finalState:Record<string,unknown>={tick,entities:o.entities??{e0:{id:'e0',p:[1,2,3],tags:['a','b','c','d']}},navV1:o.nav??{solids:big(20,'nav')},regions:{r:big(5,'r')},env:{t:tick}};
 return {fromTick:tick-1,toTick:tick,take:{dt:.05,ticks:1,tracks:o.tracks??big(10,'tracks'),changes:o.changes??big(8,'changes'),...o.extra,finalState,finalStateHash:hashOf(finalState)}};
}
const takes=(serverTick:number,chunks:unknown[])=>({t:'takes',serverTick,chunks});
/** Takes that repeat, change one field, change key order, lose finalState, carry undefined and go missing. */
function stream(){
 const nav={solids:big(20,'nav2')};
 const reordered=chunk(9);const {finalStateHash,...rest}=reordered.take;reordered.take={finalStateHash,...rest} as typeof reordered.take;
 const withUndefined=chunk(11);(withUndefined.take as Record<string,unknown>).note=undefined;
 return [
  takes(1,[chunk(1),chunk(2)]),
  takes(3,[chunk(3)]),
  takes(4,[chunk(4,{tracks:big(10,'moved')}),chunk(5,{nav}),chunk(6,{nav,changes:[]})]),
  takes(7,[chunk(7,{extra:{entities0:big(30,'e0')}}),chunk(8,{extra:{entities0:big(30,'e0')}})]),
  takes(9,[reordered,chunk(10)]),
  takes(11,[withUndefined,chunk(12),{fromTick:12,toTick:13,take:{finalState:{tick:13}}},{fromTick:13,toTick:14,take:'opaque'}]),
  takes(14,[]),
  takes(15,[chunk(15),{fromTick:15,toTick:16,take:{dt:.05,ticks:1,tracks:big(10,'tracks'),changes:big(8,'changes'),finalState:'not a record'}}]),
  takes(16,[chunk(16)]),
 ];
}
/** Encode for one peer as the hub does (no other transport): `last` advances only for messages really sent. */
function encodeFor(enc:TakeChunksEncoderV1,peer:{last:number|null},m:any):any{
 const e=enc.encode(m,peer.last);if(!e)return JSON.parse(JSON.stringify(m));peer.last=e.last;
 return JSON.parse(JSON.stringify({t:'take-chunks',contract:TAKE_CHUNKS_WIRE_V1,ids:e.ids,same:e.same,payload:e.stream}));
}

test('round trip: every decoded takes message is JSON.stringify-identical and deep-equal; repeats are left out, changes travel',()=>{
 const ms=stream(),enc=new TakeChunksEncoderV1(),peer={last:null as number|null},state:TakeChunksStateV1={last:null};
 const wire=ms.map(m=>encodeFor(enc,peer,m));
 for(const [i,w] of wire.entries()){const back=hydrateTakeChunksV1(w,state);assert.equal(JSON.stringify(back),JSON.stringify(ms[i]),'message '+i);assert.deepEqual(back,JSON.parse(JSON.stringify(ms[i])));}
 // second chunk of the first message: everything repeated is left out, tick/env/hash/entities stay
 assert.deepEqual(wire[0].same[1],[1,['tracks','changes'],['navV1','regions']]);
 assert.deepEqual(Object.keys(wire[0].payload.chunks[1].take),['dt','ticks','finalState','finalStateHash']);
 assert.deepEqual(Object.keys(wire[0].payload.chunks[1].take.finalState),['tick','entities','env']);
 assert.deepEqual(wire[2].same[0],[3,['changes'],['navV1','regions']],'moved tracks travel');
 assert.deepEqual(wire[2].same[1],[4,['changes'],['regions']],'a new nav (and the old tracks again) travel');
 assert.equal(wire[3].same[0],null,'a new key order (entities0 added) travels whole');
 assert.deepEqual(wire[3].same[1],[7,['tracks','changes','entities0'],['navV1','regions']]);
 assert.equal(wire[4].same[0],null,'reordered take travels whole');
 assert.equal(wire[5].ids[0],null,'a take with an undefined value is not described');
 assert.deepEqual(wire[5].same[1],[10,['tracks','changes'],['navV1','regions']],'a null id leaves both sides where they were');
 assert.deepEqual([wire[5].ids[3],wire[5].same[3]],[null,null],'a non-object take is not described');
 assert.equal(wire[7].same[1],null,'finalState changed shape: whole');
 assert.equal(ms[6].chunks.length,0);assert.deepEqual(wire[6],ms[6],'a stream without takes is unchanged');
 // entities and finalState are never left out, and short values always travel
 for(const w of wire)for(const s of w.same??[])if(s){assert.ok(!s[1].includes('finalState')&&!s[2].includes('entities'));assert.ok(!s[1].includes('dt')&&!s[1].includes('ticks'));}
 // values shared between takes are frozen; the containers the client built are its own
 const s:TakeChunksStateV1={last:null},a=hydrateTakeChunksV1(encodeFor(new TakeChunksEncoderV1(),{last:null},ms[0]),s) as any;
 assert.equal(a.chunks[0].take.tracks,a.chunks[1].take.tracks);assert.ok(Object.isFrozen(a.chunks[1].take.tracks[3].p));assert.ok(Object.isFrozen(a.chunks[1].take.finalState.navV1.solids));
});

test('peers are independent and a dropped message leaves both sides in step',()=>{
 const ms=stream(),enc=new TakeChunksEncoderV1(),peers=[{last:null as number|null},{last:null as number|null}],states:TakeChunksStateV1[]=[{last:null},{last:null}];
 for(const [i,m] of ms.entries())for(const p of [0,1]){
  if(p===1&&(i===1||i===4)){enc.encode(m as any,peers[p].last);continue;} // encoded, never sent: last stays
  const back=hydrateTakeChunksV1(encodeFor(enc,peers[p],m),states[p]);assert.equal(JSON.stringify(back),JSON.stringify(m),`peer ${p} message ${i}`);
 }
});

test('decoder rejects unknown bases, foreign keys, wrong order and malformed envelopes without moving its state',()=>{
 const ms=stream(),enc=new TakeChunksEncoderV1(),peer={last:null as number|null},state:TakeChunksStateV1={last:null};
 hydrateTakeChunksV1(encodeFor(enc,peer,ms[0]),state);const before=state.last;assert.equal(before!.id,2);
 const good=encodeFor(enc,peer,ms[1]),bad=(f:(w:any)=>void)=>{const w=structuredClone(good);f(w);assert.throws(()=>hydrateTakeChunksV1(w,state),/take-chunk-wire.invalid/);assert.equal(state.last,before);};
 bad(w=>w.same[0][0]=99);
 bad(w=>w.same[0][1].push('finalState'));
 bad(w=>w.same[0][2].push('entities'));
 bad(w=>w.same[0][1].push('nowhere'));
 bad(w=>w.same[0][1].push('tracks'));
 bad(w=>{w.payload.chunks[0].take.tracks=[];});
 bad(w=>{const t=w.payload.chunks[0].take;w.payload.chunks[0].take={finalState:t.finalState,dt:t.dt,ticks:t.ticks,finalStateHash:t.finalStateHash};});
 bad(w=>{w.extra=1;});
 bad(w=>{w.contract='take-chunk-ref/9';});
 bad(w=>{w.ids.push(3);});
 bad(w=>{w.ids[0]=null;});
 bad(w=>{w.ids[0]=0;});
 bad(w=>{w.same[0]=[2,['tracks','tracks'],[]];});
 bad(w=>{w.same[0][2]=['__proto__'];});
 assert.equal(JSON.stringify(hydrateTakeChunksV1(good,state)),JSON.stringify(ms[1]),'the untouched message still decodes');
});

class Socket{readyState=1;onopen:any;onclose:any;onmessage:any;onerror:any;sent:any[]=[];closed=false;send(s:string){this.sent.push(JSON.parse(s));}close(){this.closed=true;}receive(m:unknown){this.onmessage?.({data:JSON.stringify(m)});}}
const welcome=(chunks:boolean)=>({t:'welcome',proto:PROTO,build:'fixture',worldId:'wire-world',rulesVersion:'fixture',schema:'fixture',dt:.05,clockRate:1,serverTick:0,you:null,serverTime:1000,epoch:'same',takeEntities:TAKE_ENTITIES_WIRE_V1,takeTransport:TAKE_BOUNDARY_WIRE_V1,...(chunks?{takeChunks:TAKE_CHUNKS_WIRE_V1}:{})});
for(const scenario of ['default','old-server','selected'] as const)test('client compatibility '+scenario,async t=>{
 const sockets:Socket[]=[],seen:unknown[]=[],errors:string[]=[],opt=scenario!=='default';
 const connection=new Connection('ws://fixture',async()=>null,{onTakes:m=>seen.push(m),onError:c=>errors.push(c)},()=>{const s=new Socket();sockets.push(s);return s;},()=>1000,()=>100,undefined,opt);
 t.after(()=>connection.close());connection.connect();const socket=sockets[0];await socket.onopen();
 assert.equal(socket.sent[0].takeChunks,opt?TAKE_CHUNKS_WIRE_V1:undefined);socket.receive(welcome(scenario==='selected'));
 const ms=stream(),enc=new TakeChunksEncoderV1(),peer={last:null as number|null};
 for(const m of ms.slice(0,5))socket.receive(scenario==='selected'?encodeFor(enc,peer,m):m);
 assert.equal(JSON.stringify(seen),JSON.stringify(ms.slice(0,5)));assert.deepEqual(errors,[]);
 if(scenario!=='selected'){socket.receive(encodeFor(new TakeChunksEncoderV1(),{last:null},ms[0]));assert.equal(errors.at(-1),'takes.transport-invalid');assert.equal(socket.closed,true);return;}
 // a new socket starts empty: a take that leaves out keys of the old socket's take closes it rather than guessing
 (connection as any).open();await sockets[1].onopen();sockets[1].receive(welcome(true));
 sockets[1].receive(encodeFor(enc,peer,ms[1]));assert.equal(errors.at(-1),'takes.transport-invalid');assert.equal(seen.length,5);
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
/** The client's decode chain (packages/client): take-chunks around take-entities around take-boundary-wire around takes. */
function decoder(){
 const entities:TakeEntitiesStateV1={last:null},chunks:TakeChunksStateV1={last:null};
 const boundary=(v:any)=>v?.t==='take-boundary-wire'?hydrateTakeBoundaryWireV1(v):v,ent=(v:any)=>v?.t==='take-entities'?hydrateTakeEntitiesV1(v,entities,boundary):boundary(v);
 return (m:any)=>m.t==='take-chunks'?hydrateTakeChunksV1(m,chunks,ent):ent(m);
}
const TAKE_TYPES=new Set(['takes','take-entities','take-boundary-wire','take-chunks']);

for(const world of WORLDS)test(`actual Hub, recorded ${world} session: every peer decodes the exact recording; old peers get it byte for byte`,async t=>{
 const lines=recorded(world),ms=lines.map(s=>JSON.parse(s));
 const f=await local(t,()=>ms[0].chunks);
 const v1={takeEntities:TAKE_ENTITIES_WIRE_V1,takeTransport:TAKE_BOUNDARY_WIRE_V1};
 const offers=[{},v1,{...v1,takeChunks:TAKE_CHUNKS_WIRE_V1},{takeChunks:TAKE_CHUNKS_WIRE_V1},{takeEntities:TAKE_ENTITIES_WIRE_V1,takeChunks:TAKE_CHUNKS_WIRE_V1},{...v1,takeChunks:'take-chunk-ref/9'}];
 const streams:{data:string;m:any}[][]=[],sockets:WebSocket[]=[];
 for(const offer of offers){
  const socket=new WebSocket('ws://127.0.0.1:'+f.port+'/ws'),messages:{data:string;m:any}[]=[];streams.push(messages);sockets.push(socket);
  const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('finite WS takes deadline')),5000);socket.on('message',data=>{const m=JSON.parse(String(data));messages.push({data:String(data),m});if(TAKE_TYPES.has(m.t)){clearTimeout(timer);resolve();}});socket.once('error',reject);});
  await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,...offer}));await ready;
  assert.equal(messages.find(x=>x.m.t==='welcome')!.m.takeChunks,'takeChunks' in offer&&offer.takeChunks===TAKE_CHUNKS_WIRE_V1?TAKE_CHUNKS_WIRE_V1:undefined);
 }
 // one message at a time behind a barrier, so no socket crosses the 1 MB queue rule and every peer gets every message
 for(const [n,m] of ms.slice(1).entries()){
  const barriers=sockets.map((socket,i)=>new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('finite WS barrier deadline '+i)),5000);
   const received=(data:unknown)=>{const x=JSON.parse(String(data));if(x.t==='pong'&&x.n===1000+n){clearTimeout(timer);socket.off('message',received);resolve();}};
   socket.on('message',received);
  }));
  f.hub.broadcast(m);f.hub.broadcast({t:'pong',n:1000+n,serverTime:0});await Promise.all(barriers);
 }
 const bytes=streams.map(s=>s.filter(x=>TAKE_TYPES.has(x.m.t)).slice(1).reduce((a,x)=>a+x.data.length,0));
 for(const [i,messages] of streams.entries()){
  const decode=decoder(),got=messages.filter(x=>TAKE_TYPES.has(x.m.t)).map(x=>decode(x.m));
  assert.equal(got.length,ms.length,'peer '+i);
  assert.equal(JSON.stringify(got[0].chunks),JSON.stringify(ms[0].chunks),'join takes, peer '+i);
  for(let k=1;k<ms.length;k++){assert.equal(JSON.stringify(got[k]),lines[k],`peer ${i} message ${k}`);assert.deepEqual(got[k],ms[k]);}
 }
 for(const i of [0]){const raw=streams[i].filter(x=>TAKE_TYPES.has(x.m.t)).slice(1);assert.ok(raw.every(x=>x.m.t==='takes'));assert.deepEqual(raw.map(x=>x.data),lines.slice(1),'unannounced peers: byte for byte');}
 assert.ok(!streams[1].some(x=>x.m.t==='take-chunks')&&!streams[5].some(x=>x.m.t==='take-chunks'),'v1 and unknown-contract peers never see take-chunks');
 assert.deepEqual(streams[5].filter(x=>TAKE_TYPES.has(x.m.t)).slice(1).map(x=>x.data),streams[1].filter(x=>TAKE_TYPES.has(x.m.t)).slice(1).map(x=>x.data),'an unknown take-chunks offer changes nothing');
 t.diagnostic(`${world}: after-join take bytes raw ${bytes[0]}, v1 ${bytes[1]}, chunks+v1 ${bytes[2]} (${(bytes[2]/bytes[1]*100).toFixed(1)}% of v1)`);
 if(world==='eden')assert.ok(bytes[2]<bytes[1]*.05,'old Eden: the repeated 380 KB stop travelling');
 else assert.ok(bytes[2]<=bytes[1]);
});

test('actual Hub + client: a kernel view that only moved its tick travels as kernel-tick and is restored exactly',async t=>{
 const ms=stream();const f=await local(t,()=>ms[0].chunks);
 const offers=[{takeEntities:TAKE_ENTITIES_WIRE_V1},{takeEntities:TAKE_ENTITIES_WIRE_V1,takeChunks:TAKE_CHUNKS_WIRE_V1}],streams:{data:string;m:any}[][]=[],sockets:WebSocket[]=[];
 for(const offer of offers){
  const socket=new WebSocket('ws://127.0.0.1:'+f.port+'/ws'),messages:{data:string;m:any}[]=[];streams.push(messages);sockets.push(socket);
  const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('finite WS takes deadline')),5000);socket.on('message',data=>{const m=JSON.parse(String(data));messages.push({data:String(data),m});if(TAKE_TYPES.has(m.t)){clearTimeout(timer);resolve();}});socket.once('error',reject);});
  await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,...offer}));await ready;
 }
 const view=f.host.kernelView() as any,later={...view,tick:view.tick+200},changed={...later,extra:1},noTick={...view,tick:'x'};
 const views=[view,later,later,changed,{...changed,tick:later.tick+200},view,noTick,noTick];
 const barriers=sockets.map((socket,i)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('barrier '+i)),3000);socket.on('message',d=>{const m=JSON.parse(String(d));if(m.t==='pong'&&m.n===5){clearTimeout(timer);resolve();}});}));
 for(const v of views)f.hub.broadcast({t:'kernel',view:v});f.hub.broadcast({t:'pong',n:5,serverTime:0});await Promise.all(barriers);
 const wire=streams[1].filter(x=>x.m.t==='kernel'||x.m.t==='kernel-tick').map(x=>x.m.t==='kernel-tick'?'tick':'full');
 assert.deepEqual(wire,['full','tick','tick','tick','full','tick','full','full','full'],'join kernel, then only what changed besides the tick travels');
 assert.ok(!streams[0].some(x=>x.m.t==='kernel-tick'),'v1 peers get every kernel whole');
 // the real client decode chain restores every message exactly
 const fake=new Socket(),seen:any[]=[],errors:string[]=[];
 const connection=new Connection('ws://fixture',async()=>null,{onKernel:v=>seen.push(v),onError:c=>errors.push(c)},()=>fake,()=>1000,()=>100,undefined,true);
 t.after(()=>connection.close());connection.connect();await fake.onopen();fake.receive(welcome(true));
 for(const x of streams[1])if(x.m.t==='kernel'||x.m.t==='kernel-tick')fake.onmessage({data:x.data});
 assert.deepEqual(errors,[]);
 assert.deepEqual(seen.map(v=>JSON.stringify(v)),streams[0].filter(x=>x.m.t==='kernel').map(x=>JSON.stringify(x.m.view)));
 assert.equal(JSON.stringify(seen.slice(1)),JSON.stringify(views));
 // a kernel-tick before any kernel on a socket closes it
 const fresh=new Socket(),errs:string[]=[];const c2=new Connection('ws://fixture',async()=>null,{onError:c=>errs.push(c)},()=>fresh,()=>1000,()=>100,undefined,true);
 t.after(()=>c2.close());c2.connect();await fresh.onopen();fresh.receive(welcome(true));fresh.receive({t:'kernel-tick',tick:5});
 assert.equal(errs.at(-1),'takes.transport-invalid');assert.equal(fresh.closed,true);
});
