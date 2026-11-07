import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {Connection} from '../../../packages/client/src/index.ts';
import {PROTO,meLiveMessageV1Schema,type ServerMsg} from '@souls/protocol';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {fixture} from '../test/native-owner-fixture.ts';
import {Auth} from './auth.ts';
import {Hub} from './hub.ts';
import {buildApp} from './http.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();
const native=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
async function until(f:()=>boolean,ms=3000){const end=performance.now()+ms;while(!f()&&performance.now()<end)await delay(2);assert.ok(f(),'actual scoped WS authority arrives');}
async function local(t:TestContext){
  const f=fixture(':memory:',native);f.souls.enableLifecycle();const auth=new Auth(f.souls.cfg,f.db);auth.devAuth=true;const server=createServer();
  const timers:any[]=[],realInterval=setInterval;t.mock.method(globalThis,'setInterval',(...a:Parameters<typeof setInterval>)=>{const x=realInterval(...a);timers.push(x);return x;});
  const hub=new Hub(server,f.host,auth,f.db,f.souls);hub.brain=f.brain;const app=buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,auth,brain:f.brain,souls:f.souls,hub});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',resolve);});const connections:Connection[]=[];
  t.after(async()=>{for(const c of connections)c.close();for(const x of timers)clearInterval(x);for(const ws of hub.wss.clients)ws.terminate();await new Promise<void>(r=>hub.wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));f.host.stop();f.db.close();});
  const request=(path:string,owner:string,data?:unknown,method=data?'POST':'GET',extra:Record<string,string>={})=>app.request(path,{method,headers:{authorization:'Bearer dev:'+owner,...(data?{'content-type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});
  const connect=async(owner:string|null)=>{const frames:ServerMsg[]=[],updates:any[]=[],sessions:any[]=[];let welcomes=0;
    const c=new Connection(`ws://127.0.0.1:${TEST_PORT}/ws`,async()=>owner?'dev:'+owner:null,{onWelcome(){welcomes++;},onMe:(me,scope)=>updates.push({me,scope}),onSession:s=>sessions.push(s)},url=>{const ws=new WebSocket(url);ws.on('message',d=>frames.push(JSON.parse(String(d))));return ws;});
    connections.push(c);c.connect();await until(()=>c.replica.ready);return {c,frames,updates,sessions,get welcomes(){return welcomes;}};
  };
  const invite=async(owner:string)=>{const response=await request('/v1/admin','admin',{action:'invite',uses:1});assert.equal(response.status,200);const {code}=await response.json() as any;assert.equal((await request('/v1/invite',owner,{code})).status,200);};
  return {...f,auth,hub,request,connect,invite};
}
test('real native WS/SDK receives normal invite, actual ready-owned admission, retire and revoke without rewelcome or replica/clock reset',async t=>{
  const f=await local(t),alice=await f.connect('alice'),bob=await f.connect('bob'),anon=await f.connect(null);assert.equal(alice.c.me!.invited,false);assert.equal(alice.c.me!.souls.length,0);
  const session=alice.c.session!,scope=alice.c.meSession!,snapshots=alice.c.stats.snapshots;await f.invite('alice');await until(()=>alice.c.me!.invited);assert.equal(alice.c.meSession!.revision,2);
  const created=await f.request('/v1/souls','alice',{name:'Cedar',description:'A local invited human-owned Soul'},'POST',{'X-Sim-Lifecycle':'1'});assert.equal(created.status,202);const {lifecycle}=await created.json() as any;assert.equal(lifecycle.ready,false);assert.ok(!alice.c.me!.souls.includes(lifecycle.soulId));
  f.host.drainInputs();await delay(0);f.host.drainInputs();await delay(0);assert.equal(f.souls.controlReady(f.db.soul(lifecycle.soulId)!),true);
  // Existing normal stats/authority refresh must publish readiness; no harness
  // refreshMe/rehello/private Me or body/ownership injection at this boundary.
  await until(()=>alice.c.me!.souls.includes(lifecycle.soulId));const httpMe=await (await f.request('/v1/me','alice')).json() as any;assert.deepEqual(alice.c.me!.souls,httpMe.souls.map((s:any)=>s.id));assert.ok(f.host.engine.world.entities[lifecycle.entityId]);const admitted=f.souls.lifecycleReceipt('dev:alice',lifecycle.requestId);
  const marker='private-alice@local.invalid';f.db.db.prepare("UPDATE users SET email=? WHERE id='dev:alice'").run(marker);f.hub.refreshMe('dev:alice');await until(()=>alice.c.me!.email===marker);
  assert.equal(JSON.stringify(bob.frames).includes(marker),false);assert.equal(JSON.stringify(anon.frames).includes(marker),false);assert.equal(bob.c.me!.userId,'dev:bob');assert.deepEqual(bob.c.me!.souls,[]);assert.equal(anon.c.me,null);
  const retired=await f.request('/v1/souls/'+lifecycle.soulId,'alice',{},'DELETE',{'X-Sim-Lifecycle':'1'});assert.equal(retired.status,202);assert.ok(f.host.engine.world.entities[lifecycle.entityId]);await until(()=>alice.c.me!.souls.length===0);
  f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();await until(()=>alice.c.me!.invited===false);
  assert.equal(alice.welcomes,1);assert.equal(alice.c.stats.snapshots,snapshots);assert.deepEqual(alice.c.session,session);assert.equal(alice.c.meSession!.connectionId,scope.connectionId);assert.equal(alice.sessions.length,1);
  const views=alice.frames.filter(m=>m.t==='me').map(m=>meLiveMessageV1Schema.parse(m).view);assert.ok(views.length>=5);for(let i=0;i<views.length;i++){assert.equal(views[i].revision,i+2);assert.equal(views[i].userId,'dev:alice');assert.equal(views[i].worldId,f.host.worldId);assert.equal(views[i].connectionId,scope.connectionId);}
  assert.throws(()=>f.hub.broadcast({t:'me',view:views.at(-1)!}),/directly/);assert.equal(anon.frames.some(m=>m.t==='me'),false);assert.equal(f.db.paidCost(),0);
  const dir=new URL('../../../.e2e/me-live/',import.meta.url);mkdirSync(dir,{recursive:true});const out=new URL('native-'+new Date().toISOString().replaceAll(':','-')+'.json',dir);
  writeFileSync(out,JSON.stringify({contract:'core-native-me-live-probe/1',worldId:f.host.worldId,initialWelcome:alice.frames.find(m=>m.t==='welcome'),pending:lifecycle,admitted,privateUpdates:views,transport:{before:session,after:alice.c.session,welcomes:alice.welcomes,snapshotsBefore:snapshots,snapshotsAfter:alice.c.stats.snapshots,authorityScope:alice.c.meSession},foreignPrivateMarkerAbsent:true,anonymousMeMessages:0,realWS:true,actualHonoRoutes:true,nativeSDK:true,paidUSD:0,limits:['Localdev-auth/native/no actual browser/realAuth/combined04 qualification','Readiness delivered through original2s authority/stat refresh, not rehello or injectedMe','This artifact contains synthetic private authority; not a public recording']},null,2)+'\n',{flag:'wx'});t.diagnostic('Actual native private Me proof: '+out.pathname);
});
test('deleted current identity clears private authority while public transport survives, with no implicit restored identity',async t=>{
  const f=await local(t),alice=await f.connect('alice'),bob=await f.connect('bob'),session=alice.c.session!;f.db.db.prepare("DELETE FROM users WHERE id='dev:alice'").run();f.hub.refreshMe('dev:alice');await until(()=>alice.c.me===null);assert.equal(alice.c.stats.state,'open');assert.deepEqual(alice.c.session,session);assert.equal(bob.c.me!.userId,'dev:bob');assert.equal(bob.c.stats.state,'open');
  assert.ok(alice.frames.some(m=>m.t==='me'&&m.view.me===null));assert.ok(alice.updates.some(u=>u.me===null));await f.auth.userFromToken('dev:alice');f.hub.refreshMe('dev:alice');await delay(20);assert.equal(alice.c.me,null,'a recreated user row does not reauthenticate the old socket');
});
test('late first authentication and closed-socket authentication cannot override a newer hello identity',async t=>{
  const f=await local(t);await f.invite('alice');await f.invite('bob');const original=f.auth.userFromToken.bind(f.auth);let entered=false,release!:()=>void;let hold=new Promise<void>(r=>release=r);
  t.mock.method(f.auth,'userFromToken',async (token:string|null|undefined)=>{if(token==='dev:alice'){const u=await original(token);entered=true;await hold;return u;}return original(token);});
  const ws=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`),frames:ServerMsg[]=[];ws.on('message',d=>frames.push(JSON.parse(String(d))));await once(ws,'open');ws.send(JSON.stringify({t:'hello',proto:PROTO,token:'dev:alice'}));await until(()=>entered);await delay(3100);ws.send(JSON.stringify({t:'hello',proto:PROTO,token:'dev:bob'}));await until(()=>frames.some(m=>m.t==='welcome'&&m.you?.userId==='dev:bob'));release();await delay(20);
  assert.equal(frames.some(m=>m.t==='welcome'&&m.you?.userId==='dev:alice'),false);f.hub.refreshMe('dev:alice');await delay(10);assert.equal(frames.some(m=>m.t==='me'&&m.view.me?.userId==='dev:alice'),false);ws.close();await once(ws,'close');
  entered=false;hold=new Promise<void>(r=>release=r);const closed=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);await once(closed,'open');closed.send(JSON.stringify({t:'hello',proto:PROTO,token:'dev:alice'}));await until(()=>entered);closed.close();await once(closed,'close');release();await delay(10);assert.equal(f.hub.clients.size,0);
});
test('a controlled slow private channel closes instead of silently dropping authority, without affecting another viewer',async t=>{
  const f=await local(t),alice=await f.connect('alice'),bob=await f.connect('bob'),serverClient=[...f.hub.clients].find(c=>c.me?.userId==='dev:alice')!;
  Object.defineProperty(serverClient.ws,'bufferedAmount',{get:()=>1_000_001,configurable:true});f.db.db.prepare("UPDATE users SET email='changed@local.invalid' WHERE id='dev:alice'").run();f.hub.refreshMe('dev:alice');await until(()=>alice.c.stats.state==='closed');assert.equal(alice.c.me,null);assert.equal(alice.c.meSession,null);assert.equal(bob.c.stats.state,'open');assert.equal(bob.c.me!.userId,'dev:bob');alice.c.close();
});
test('a stale server private world scope closes before publishing authority and preserves another current viewer',async t=>{
  const f=await local(t),alice=await f.connect('alice'),bob=await f.connect('bob'),c=[...f.hub.clients].find(c=>c.me?.userId==='dev:alice')!,before=alice.frames.length;
  c.meScope!.worldId='controlled-foreign-world';f.db.db.prepare("UPDATE users SET email='must-not-publish@local.invalid' WHERE id='dev:alice'").run();f.hub.refreshMe('dev:alice');await until(()=>alice.c.stats.state==='closed');assert.equal(alice.c.me,null);assert.equal(JSON.stringify(alice.frames.slice(before)).includes('must-not-publish'),false);assert.equal(bob.c.stats.state,'open');alice.c.close();
});
