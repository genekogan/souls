import test from 'node:test';
import assert from 'node:assert/strict';
import {Connection} from '@souls/client';

function rig(t:import('node:test').TestContext,getToken:()=>Promise<string|null>){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});t.mock.method(Math,'random',()=>0);
 const made:any[]=[],urls:string[]=[];
 const conn=new Connection('ws://world.invalid/ws?world=fixture',getToken,{},url=>{
  urls.push(url);const ws={readyState:0,sent:[] as string[],send(s:string){this.sent.push(s);},close(){this.readyState=3;},onopen:null as any,onclose:null as any,onmessage:null as any,onerror:null as any};made.push(ws);return ws;
 });
 conn.connect();t.after(()=>conn.close());
 return{conn,made,urls,retry:async()=>{made.at(-1).onclose({code:1001});await Promise.resolve();t.mock.timers.tick(150);}};
}

test('anonymous reconnect says hello in URL and does not send a duplicate frame',async t=>{
 const r=rig(t,async()=>null);await r.retry();assert.equal(r.made.length,2);
 const u=new URL(r.urls[1]),hello=JSON.parse(u.searchParams.get('hello')!);
 assert.equal(u.searchParams.get('world'),'fixture');assert.equal(hello.t,'hello');assert.equal(hello.token,undefined);
 r.made[1].readyState=1;await r.made[1].onopen();assert.deepEqual(r.made[1].sent,[]);
});

test('authenticated reconnect keeps its credential in a frame and never a URL',async t=>{
 const r=rig(t,async()=>'fixture-secret');await r.retry();assert.equal(r.urls[1],r.urls[0]);
 r.made[1].readyState=1;await r.made[1].onopen();assert.equal(JSON.parse(r.made[1].sent[0]).token,'fixture-secret');
});

test('sign-in while anonymous upgrade waits replaces it before authenticated hello',async t=>{
 let token:string|null=null;const r=rig(t,async()=>token);await r.retry();token='fixture-new-identity';
 r.made[1].readyState=1;await r.made[1].onopen();assert.equal(r.made.length,3);assert.equal(r.made[1].readyState,3);assert.deepEqual(r.made[1].sent,[]);assert.equal(r.urls[2],r.urls[0]);
 r.made[2].readyState=1;await r.made[2].onopen();assert.equal(JSON.parse(r.made[2].sent[0]).token,token);
});

test('slow token lookup does not delay reconnect; close cancels pending reconnect',async t=>{
 const r=rig(t,()=>new Promise(()=>{}));await r.retry();assert.equal(r.made.length,2);assert.equal(r.urls[1],r.urls[0]);
 r.made[1].onclose({code:1001});r.conn.close();t.mock.timers.tick(10000);assert.equal(r.made.length,2);
});

test('anonymous resume URL preserves sequence and epoch',async t=>{
 const r=rig(t,async()=>null);
 r.made[0].onmessage({data:JSON.stringify({t:'welcome',proto:1,build:'fixture',worldId:'fixture',rulesVersion:'fixture',schema:'fixture',dt:.05,clockRate:1,serverTick:0,you:null,serverTime:1000,epoch:'prior-process'})});
 r.conn.replica.ready=true;r.conn.replica.seq=23;await r.retry();
 const hello=JSON.parse(new URL(r.urls[1]).searchParams.get('hello')!);assert.equal(hello.since,23);assert.equal(hello.epoch,'prior-process');
});

test('failed prefetch retains frame hello and never prevents reconnect',async t=>{
 const r=rig(t,async()=>{throw Error('fixture auth unavailable');});await r.retry();assert.equal(r.made.length,2);assert.equal(r.urls[1],r.urls[0]);
});
