// Serialized child proof: an uncontained async/timer exception must not kill the
// parent test runner. Only local fake minds, an in-memory DB and port4958.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { PROTO,type ServerMsg } from '@souls/protocol';
import { fixture,invite } from './native-owner-fixture.ts';
import { Auth } from '../src/auth.ts';
import { Hub } from '../src/hub.ts';
const [boundary,damaged]=process.argv.slice(2);assert.ok(['hello','periodic','broadcast','refresh'].includes(boundary));assert.ok(['body','event_hash'].includes(damaged));
const f=fixture(':memory:',await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true}));f.souls.enableLifecycle();await invite(f,'alice');await invite(f,'bob');
const operations=[];for(const owner of ['alice','bob']){const op=f.souls.acceptLifecycleCreate('dev:'+owner,{name:owner,description:'local fault containment'});f.host.drainInputs();await delay(0);operations.push(op);}
const auth=new Auth(f.souls.cfg,f.db);auth.devAuth=true;const server=createServer(),timers:ReturnType<typeof setInterval>[]=[],interval=globalThis.setInterval;
let periodic:(()=>void)|undefined;
globalThis.setInterval=((callback:()=>void,ms:number,...args:unknown[])=>{if(ms===2000)periodic=callback;const timer=interval(callback,ms,...args);timers.push(timer);return timer;}) as typeof setInterval;
const hub=new Hub(server,f.host,auth,f.db,f.souls);hub.brain=f.brain;globalThis.setInterval=interval;
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(4958,'127.0.0.1',resolve);});
const notices:string[]=[];const stderr=console.error;console.error=(...args:unknown[])=>{notices.push(String(args[0]));};
async function until(ready:()=>boolean){const deadline=performance.now()+4000;while(!ready()&&performance.now()<deadline)await delay(2);assert.ok(ready(),'actual local callback/socket reaches its expected boundary');}
async function connect(owner:string|null,ready=true){
  const socket=new WebSocket('ws://127.0.0.1:4958/ws'),messages:ServerMsg[]=[];socket.on('message',data=>messages.push(JSON.parse(String(data))));await once(socket,'open');
  socket.send(JSON.stringify({t:'hello',proto:PROTO,...(owner?{token:'dev:'+owner}:{})}));if(ready)await until(()=>messages.some(m=>m.t==='takes'));return {socket,messages};
}
try {
 const bob=await connect('bob'),anon=await connect(null),alice=boundary!=='hello'?await connect('alice'):null;
 f.db.db.prepare(`UPDATE lifecycle_operations_v1 SET ${damaged}=? WHERE request_id=?`).run(damaged==='body'?'{}':'0'.repeat(64),operations[0].requestId);
 const affected=alice??await connect('alice',false);
 // Periodic fault uses the real registered two-second timer, not a direct call.
 if(boundary==='periodic')assert.ok(periodic);
 if(boundary==='broadcast')hub.broadcast({t:'stats',stats:hub.stats()});
 if(boundary==='refresh')hub.refreshMe('dev:alice');
 await until(()=>affected.socket.readyState===WebSocket.CLOSED);
 assert.ok(affected.messages.some(m=>m.t==='error'&&m.code==='private-view-unavailable'),'affected viewer gets generic visible failure');
 assert.equal(affected.messages.some(m=>m.t==='brain'),false);assert.equal(affected.messages.some(m=>m.t==='welcome'&&m.you!==null),boundary!=='hello');
 assert.equal(notices.length,1,'one operator invariant notice, no quiet refusal');assert.equal(notices[0],'[hub] private view invariant failed');
 assert.ok(f.host.engine.world.entities[operations[0].scope.entityId]);assert.ok(f.host.engine.world.entities[operations[1].scope.entityId]);
 for(let i=0;i<10;i++)f.host.tickOnce();assert.ok(periodic);periodic();hub.broadcast({t:'pong',n:601,serverTime:Date.now()});
 await until(()=>[bob,anon].every(v=>v.messages.some(m=>m.t==='pong'&&m.n===601)));
 for(const viewer of [bob,anon]){assert.equal(viewer.socket.readyState,WebSocket.OPEN);assert.ok(viewer.messages.some(m=>m.t==='batch'));assert.ok(viewer.messages.filter(m=>m.t==='stats').length>=2);}
 const encoded=JSON.stringify([...affected.messages,...bob.messages,...anon.messages]);assert.equal(encoded.includes(operations[0].requestId),false);assert.equal(encoded.includes('event_hash'),false);
 const state=f.db.db.prepare('SELECT state FROM lifecycle_operations_v1 WHERE request_id=?').get(operations[0].requestId) as {state:string};assert.equal(state.state,'complete','corruption is not rewritten into normal refusal');assert.equal(f.db.paidCost(),0);
 console.log(JSON.stringify({boundary,damaged,contained:true,visibleNotice:true,otherViewersAlive:true,canonicalBodiesIntact:true,paid:0}));
} finally {
 console.error=stderr;for(const timer of timers)clearInterval(timer);for(const socket of hub.wss.clients)socket.terminate();await new Promise<void>(resolve=>hub.wss.close(()=>resolve()));await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));f.db.close();
}
