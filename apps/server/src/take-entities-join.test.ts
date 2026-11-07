// take-entities-join/1 (lane W1, slim join step 1): a peer that announces it gets each snapshot with `entitiesTable`, its
// entity table's id, and the join's first take refers to that table instead of carrying a second full copy (Eden 2026:
// 1.44 MB). Decoded takes must stay JSON.stringify-identical to the raw ones; peers that did not announce it see no change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {hashOf} from '@souls/engine-contract';
import {PROTO,TAKE_ENTITIES_WIRE_V1,TAKE_ENTITIES_JOIN_V1,TAKE_BOUNDARY_WIRE_V1,TAKE_CHUNKS_WIRE_V1,TakeEntitiesEncoderV1,adoptSnapshotTableV1,hydrateTakeEntitiesV1,hydrateTakeBoundaryWireV1,hydrateTakeChunksV1,type TakeEntitiesStateV1,type TakeChunksStateV1} from '@souls/protocol';
import {Connection} from '@souls/client';
import {COLUMNS_V1,isPackedColumnsV1,unpackColumnsV1} from '@souls/protocol';
import {helloMessage} from '../../../packages/client/src/hello.ts';
import {fixture} from '../test/native-owner-fixture.ts';
import {recordedToyFactory} from './toy-takes.ts';
import {Auth} from './auth.ts';
import {Hub} from './hub.ts';

type Table=Record<string,any>;
const entity=(id:string,x:number)=>({id,kind:'person',pose:{p:[x,0,2],yaw:.5},human:{activity:'idle'},tags:['a','b']});
const tableOf=(n:number,shift=0):Table=>{const t:Table={};for(let i=0;i<n;i++)t['e'+i]=entity('e'+i,i+shift);return t;};
function chunk(tick:number,entities:unknown){
 const finalState={tick,entities};
 return {fromTick:tick-1,toTick:tick,take:{dt:.05,ticks:1,tracks:[],finalState,finalStateHash:hashOf(finalState)}};
}
const takes=(serverTick:number,chunks:unknown[])=>({t:'takes',serverTick,chunks});
const snapshot=(entities:Table)=>({t:'snapshot',reason:'join',tick:5,seq:1,viewHash:'v',entities,regions:{},env:{},paths:[],souls:[]});

test('protocol: a registered snapshot table is the base of the next take (reference or patch), restored exactly',()=>{
 const enc=new TakeEntitiesEncoderV1(),table=tableOf(200);
 const reg=enc.register(structuredClone(table))!;
 assert.equal(reg.json,JSON.stringify(table));
 // the same table again (another object) is the same id; a take with it is a reference
 assert.equal(enc.register(structuredClone(table))!.id,reg.id);
 const same=takes(6,[chunk(6,structuredClone(table))]),moved=takes(7,[chunk(7,{...table,e3:entity('e3',99)})]);
 const e1=enc.encode(same as any,reg.id)!;
 assert.ok(JSON.stringify(e1.envelope).includes('"$takeEntitiesRefV1":'+reg.id));
 const e2=enc.encode(moved as any,reg.id)!;
 assert.ok(JSON.stringify(e2.envelope).includes('$takeEntitiesPatchV1'));
 assert.ok(JSON.stringify(e2.envelope).length<JSON.stringify(moved).length/10);
 // client: adopt the snapshot's table, then the replica mutates its own objects; the takes restore exactly
 for(const [m,e] of [[same,e1],[moved,e2]] as const){
  const state:TakeEntitiesStateV1={last:null},wire=JSON.parse(JSON.stringify({...snapshot(table),entitiesTable:reg.id}));
  const s=adoptSnapshotTableV1(wire,state) as any;
  assert.equal('entitiesTable' in s,false);assert.equal(state.last!.id,reg.id);assert.ok(Object.isFrozen((state.last!.table as Table).e0.pose.p));
  s.entities.e0.pose.p[0]=1234;delete s.entities.e1;s.entities.e3.human.activity='walk';
  assert.equal(JSON.stringify(hydrateTakeEntitiesV1(JSON.parse(JSON.stringify(e.envelope)),state)),JSON.stringify(m));
 }
 // tables that cannot be referenced travel without an id
 assert.equal(enc.register({$takeEntitiesRefV1:1}),null);
 assert.equal(enc.register([1,2]),null);
 assert.equal(enc.register(Object.create(null)),null);
 // malformed ids and tables are rejected and leave the state as it was
 const state:TakeEntitiesStateV1={last:null};
 for(const bad of [{...snapshot(table),entitiesTable:0},{...snapshot(table),entitiesTable:'1'},{...snapshot(table),entitiesTable:1.5},{...snapshot(table),entities:[1],entitiesTable:1}])
  assert.throws(()=>adoptSnapshotTableV1(bad as any,state),/take-entities-wire.invalid/);
 assert.equal(state.last,null);
});

test('hello: a transport-capable Connection announces take-entities-join/1 after its other take contracts',()=>{
 assert.deepEqual(Object.keys(helloMessage({takeBoundaryTransport:true})),['t','proto','takeTransport','takeEntities','takeChunks','takeEntitiesJoin','snapshotColumns']);
 assert.equal((helloMessage({takeBoundaryTransport:true}) as any).takeEntitiesJoin,TAKE_ENTITIES_JOIN_V1);
 assert.equal((helloMessage({}) as any).takeEntitiesJoin,undefined);
});

class Socket{readyState=1;onopen:any;onclose:any;onmessage:any;onerror:any;sent:any[]=[];closed=false;send(s:string){this.sent.push(JSON.parse(s));}close(){this.closed=true;}receive(m:unknown){this.onmessage?.({data:JSON.stringify(m)});}}
const welcome=(join:boolean)=>({t:'welcome',proto:PROTO,build:'fixture',worldId:'wire-world',rulesVersion:'fixture',schema:'fixture',dt:.05,clockRate:1,serverTick:0,you:null,serverTime:1000,epoch:'same',
 takeEntities:TAKE_ENTITIES_WIRE_V1,...(join?{takeEntitiesJoin:TAKE_ENTITIES_JOIN_V1}:{})});
for(const scenario of ['negotiated','not-echoed'] as const)test('client: snapshot table '+scenario,async t=>{
 const sockets:Socket[]=[],seen:unknown[]=[],errors:string[]=[];
 const connection=new Connection('ws://fixture',async()=>null,{onTakes:m=>seen.push(m),onError:c=>errors.push(c)},()=>{const s=new Socket();sockets.push(s);return s;},()=>1000,()=>100,undefined,true);
 t.after(()=>connection.close());connection.connect();const socket=sockets[0];await socket.onopen();
 assert.equal(socket.sent[0].takeEntitiesJoin,TAKE_ENTITIES_JOIN_V1);
 socket.receive(welcome(scenario==='negotiated'));
 const table=tableOf(50),enc=new TakeEntitiesEncoderV1(),reg=enc.register(table)!,m=takes(6,[chunk(6,structuredClone(table))]);
 socket.receive({...snapshot(table),entitiesTable:reg.id});
 if(scenario==='not-echoed'){assert.equal(errors.at(-1),'takes.transport-invalid');assert.equal(socket.closed,true);assert.equal(connection.replica.ready,false);return;}
 const r=connection.replica as any;assert.equal(r.ready,true);assert.equal('entitiesTable' in r.entities,false);
 assert.equal(JSON.stringify(r.entities),JSON.stringify(table));
 // the replica's entities are its own (mutable) objects; the take's table is the frozen copy
 r.entities.e0.human.activity='walk';
 socket.receive(enc.encode(m as any,reg.id)!.envelope);
 assert.deepEqual(errors,[]);assert.equal(JSON.stringify(seen),JSON.stringify([m]));
});

async function local(t:any,chunks:(f:any)=>unknown[]){
 const f=fixture(':memory:',recordedToyFactory),auth=new Auth(f.souls.cfg,f.db),server=createServer(),intervals:ReturnType<typeof setInterval>[]=[];
 const interval=setInterval;t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);intervals.push(timer);return timer;});
 const hub=new Hub(server,f.host,auth,f.db);hub.brain=f.brain;
 t.mock.method(f.host.engine,'takeChunks',()=>chunks(f) as any);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 t.after(async()=>{for(const timer of intervals)clearInterval(timer);for(const socket of hub.wss.clients)socket.terminate();await new Promise<void>(resolve=>hub.wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();});
 return {...f,auth,hub,port};
}

test('actual Hub: a join peer gets its first take as a reference to the snapshot table; other peers are unchanged',async t=>{
 // the live engine's take tables are the replica's entities (Eden 2026: the same 4,501 entries); the toy's are mirrored here
 const f=await local(t,f=>[chunk(f.host.engine.world.tick,structuredClone(f.host.engine.world.entities))]);
 assert.ok(Object.keys(f.host.engine.world.entities).length>0);
 const all={takeTransport:TAKE_BOUNDARY_WIRE_V1,takeEntities:TAKE_ENTITIES_WIRE_V1,takeChunks:TAKE_CHUNKS_WIRE_V1};
 const offers=[{},all,{...all,takeEntitiesJoin:TAKE_ENTITIES_JOIN_V1},{takeEntities:TAKE_ENTITIES_WIRE_V1,takeEntitiesJoin:TAKE_ENTITIES_JOIN_V1},{takeEntitiesJoin:TAKE_ENTITIES_JOIN_V1},{...all,takeEntitiesJoin:'take-entities-join/9'}];
 const joined=offers.map(o=>(o as any).takeEntities===TAKE_ENTITIES_WIRE_V1&&(o as any).takeEntitiesJoin===TAKE_ENTITIES_JOIN_V1);
 const out:{raw:string[];snapshot:any;takes:string[]}[]=[];
 for(const offer of offers){
  const socket=new WebSocket('ws://127.0.0.1:'+f.port+'/ws'),raw:string[]=[];
  const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('finite WS takes deadline')),2000);socket.on('message',data=>{const s=String(data);raw.push(s);if(/^\{"t":"(takes|take-entities|take-boundary-wire|take-chunks)"/.test(s)){clearTimeout(timer);resolve();}});socket.once('error',reject);});
  await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,...offer}));await ready;socket.close();
  // decode as the Connection does
  const ents:TakeEntitiesStateV1={last:null},chunkState:TakeChunksStateV1={last:null};let snap:any=null;const decoded:string[]=[];
  const boundary=(v:any)=>v?.t==='take-boundary-wire'?hydrateTakeBoundaryWireV1(v):v,entities=(v:any)=>v?.t==='take-entities'?hydrateTakeEntitiesV1(v,ents,boundary):boundary(v);
  for(const s of raw){let m=JSON.parse(s);
   if(m.t==='welcome')assert.equal(m.takeEntitiesJoin,joined[out.length]?TAKE_ENTITIES_JOIN_V1:undefined,'welcome echo '+out.length);
   if(m.t==='snapshot'){assert.equal('entitiesTable' in m,joined[out.length],'snapshot table id '+out.length);if(m.entitiesTable!==undefined)m=adoptSnapshotTableV1(m,ents);snap=m;}
   else if(m.t==='take-chunks')m=hydrateTakeChunksV1(m,chunkState,entities);else m=entities(m);
   if(m.t==='takes')decoded.push(JSON.stringify(m));}
  out.push({raw,snapshot:snap,takes:decoded});
 }
 for(let i=0;i<offers.length;i++){
  assert.equal(JSON.stringify(out[i].snapshot.entities),JSON.stringify(out[0].snapshot.entities),'snapshot entities '+i);
  assert.deepEqual(out[i].takes,out[0].takes,'decoded takes '+i);
  const firstTake=out[i].raw.find(s=>/^\{"t":"(takes|take-entities|take-boundary-wire|take-chunks)"/.test(s))!;
  assert.equal(firstTake.includes('"$takeEntitiesRefV1"'),joined[i],'first take is a reference '+i);
 }
 const bytes=(i:number)=>out[i].raw.reduce((n,s)=>n+s.length,0),table=JSON.stringify(out[0].snapshot.entities).length;
 assert.ok(bytes(1)-bytes(2)>table*0.9,`the join set is one table smaller (${bytes(1)} vs ${bytes(2)}, table ${table})`);
});

test('actual Hub: a resync snapshot re-bases a join peer; a moved entity then travels as a patch',async t=>{
 let moved=false;
 const f=await local(t,f=>{const e=structuredClone(f.host.engine.world.entities);if(moved){const id=Object.keys(e)[0];e[id]={...e[id],movedForTest:true};}return [chunk(f.host.engine.world.tick,e)];});
 const socket=new WebSocket('ws://127.0.0.1:'+f.port+'/ws'),raw:string[]=[];socket.on('message',d=>raw.push(String(d)));
 await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,takeEntities:TAKE_ENTITIES_WIRE_V1,takeEntitiesJoin:TAKE_ENTITIES_JOIN_V1}));
 const until=async(ok:()=>boolean)=>{for(let i=0;i<200&&!ok();i++)await new Promise(r=>setTimeout(r,10));assert.ok(ok());};
 await until(()=>raw.some(s=>s.startsWith('{"t":"take-entities"')));
 await new Promise(r=>setTimeout(r,2100));socket.send(JSON.stringify({t:'resync',reason:'test'}));
 await until(()=>raw.filter(s=>s.startsWith('{"t":"snapshot"')).length===2);
 moved=true;f.hub.broadcast({t:'takes',serverTick:f.host.engine.world.tick,chunks:f.host.engine.takeChunks!(0) as any});
 await until(()=>raw.filter(s=>s.startsWith('{"t":"take-entities"')).length===2);socket.close();
 const ents:TakeEntitiesStateV1={last:null},ids:number[]=[];let last:any;
 for(const s of raw){const m=JSON.parse(s);if(m.t==='snapshot'){ids.push(m.entitiesTable);adoptSnapshotTableV1(m,ents);}if(m.t==='take-entities')last=hydrateTakeEntitiesV1(m,ents);}
 assert.equal(ids.length,2);assert.ok(ids.every(id=>Number.isSafeInteger(id)));
 assert.ok(raw.filter(s=>s.startsWith('{"t":"take-entities"')).at(-1)!.includes('$takeEntitiesPatchV1'));
 assert.equal(Object.values(last.chunks[0].take.finalState.entities as Table)[0].movedForTest,true);
});

test('actual Hub: columns/1 peers get the join snapshot table in the column form, restored exactly and smaller',async t=>{
 const f=await local(t,f=>[chunk(f.host.engine.world.tick,structuredClone(f.host.engine.world.entities))]);
 const all={takeTransport:TAKE_BOUNDARY_WIRE_V1,takeEntities:TAKE_ENTITIES_WIRE_V1,takeChunks:TAKE_CHUNKS_WIRE_V1,takeEntitiesJoin:TAKE_ENTITIES_JOIN_V1};
 const offers=[all,{...all,snapshotColumns:COLUMNS_V1},{snapshotColumns:COLUMNS_V1},{...all,snapshotColumns:'columns/9'}],packed=[false,true,true,false];
 const out:{snap:string;raw:number;takes:string[]}[]=[];
 for(const [i,offer] of offers.entries()){
  const socket=new WebSocket('ws://127.0.0.1:'+f.port+'/ws'),raw:string[]=[];
  const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('finite WS takes deadline')),2000);socket.on('message',data=>{const s=String(data);raw.push(s);if(/^\{"t":"(takes|take-entities|take-boundary-wire|take-chunks)"/.test(s)){clearTimeout(timer);resolve();}});socket.once('error',reject);})
  await once(socket,'open');socket.send(JSON.stringify({t:'hello',proto:PROTO,...offer}));await ready;socket.close();
  const ents:TakeEntitiesStateV1={last:null},chunkState:TakeChunksStateV1={last:null};let snap='',size=0;const takes:string[]=[];
  const boundary=(v:any)=>v?.t==='take-boundary-wire'?hydrateTakeBoundaryWireV1(v):v,entities=(v:any)=>v?.t==='take-entities'?hydrateTakeEntitiesV1(v,ents,boundary):boundary(v);
  for(const s of raw){let m=JSON.parse(s);
   if(m.t==='snapshot'){size=s.length;assert.equal(isPackedColumnsV1(m.entities),packed[i],'column form '+i);if(isPackedColumnsV1(m.entities))m.entities=unpackColumnsV1(m.entities);if(m.entitiesTable!==undefined)m=adoptSnapshotTableV1(m,ents);const {reason:_r,...rest}=m;snap=JSON.stringify(rest);}
   else if(m.t==='take-chunks')m=hydrateTakeChunksV1(m,chunkState,entities);else m=entities(m);
   if(m.t==='takes')takes.push(JSON.stringify(m));}
  out.push({snap,raw:size,takes});
 }
 for(let i=1;i<offers.length;i++){assert.equal(out[i].snap,out[0].snap,'decoded snapshot '+i);if((offers[i] as {takeEntities?:string}).takeEntities)assert.deepEqual(out[i].takes,out[0].takes,'decoded takes '+i);}
 assert.ok(out[1].raw<out[0].raw,`the column form is smaller (${out[1].raw} vs ${out[0].raw})`);
});
