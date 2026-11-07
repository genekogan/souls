import { test,type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { PROTO,type BrainCall,type ServerMsg } from '@souls/protocol';
import { fixture,invite,accept } from '../test/native-owner-fixture.ts';
import { WorldHost,replayFromGenesis } from './world.ts';
import { kernelHash } from '@souls/kernel';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import { Auth } from './auth.ts';
import { Hub } from './hub.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
async function local(t:TestContext,install=true){
  const f=fixture(':memory:',factory);if(install)f.souls.enableLifecycle();await invite(f,'alice');await invite(f,'bob');
  const auth=new Auth(f.souls.cfg,f.db);auth.devAuth=true;const server=createServer();
  const timers:ReturnType<typeof setInterval>[]=[],interval=setInterval;
  t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);timers.push(timer);return timer;});
  const hub=new Hub(server,f.host,auth,f.db,install?f.souls:undefined);hub.brain=f.brain;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',resolve);});
  t.after(async()=>{for(const timer of timers)clearInterval(timer);for(const socket of hub.wss.clients)socket.terminate();await new Promise<void>(resolve=>hub.wss.close(()=>resolve()));await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));f.db.close();});
  const connect=async(owner:string|null)=>{
    const socket=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`),messages:ServerMsg[]=[];
    socket.on('message',data=>messages.push(JSON.parse(String(data)) as ServerMsg));await once(socket,'open');
    socket.send(JSON.stringify({t:'hello',proto:PROTO,...(owner?{token:'dev:'+owner}:{})}));
    await until(()=>messages.some(m=>m.t==='takes'));return {socket,messages};
  };
  return {...f,auth,hub,connect};
}
async function until(ready:()=>boolean){const deadline=performance.now()+2000;while(!ready()&&performance.now()<deadline)await delay(2);assert.ok(ready(),'actual WS frame arrives');}
function call(soulId:string,marker:string):BrainCall{return {id:1,tick:0,at:Date.now(),tier:'compile',subject:'Alice',soulId,model:'local-fixture',request:{syntheticPrivate:marker},response:null,applied:null,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,mode:'fake'};}
async function born(f:Awaited<ReturnType<typeof local>>,owner='alice'){
  const op=f.souls.acceptLifecycleCreate('dev:'+owner,{name:owner,description:'local'});f.host.drainInputs();await delay(0);
  const soul=f.db.soul(op.scope.soulId)!;assert.equal(f.souls.controlReady(soul),true);return {op,soul};
}
async function delivered(f:Awaited<ReturnType<typeof local>>,viewers:Awaited<ReturnType<typeof f.connect>>[],n:number){
  f.hub.broadcast({t:'pong',n,serverTime:Date.now()});await until(()=>viewers.every(v=>v.messages.some(m=>m.t==='pong'&&m.n===n)));
}

test('actual WS welcome omits pending logical Soul allocation from usable Me and public replica',async t=>{
  const f=await local(t),op=f.souls.acceptLifecycleCreate('dev:alice',{name:'Alice',description:'local'}),viewer=await f.connect('alice');
  const welcome=viewer.messages.find(m=>m.t==='welcome');assert.ok(welcome&&welcome.t==='welcome');assert.deepEqual(welcome.you!.souls,[]);
  const snapshot=viewer.messages.find(m=>m.t==='snapshot');assert.ok(snapshot&&snapshot.t==='snapshot');assert.equal(snapshot.souls.some(s=>s.id===op.scope.soulId),false);assert.equal(snapshot.entities[op.scope.entityId],undefined);
  const pendingMarker='synthetic-private-before-admission';f.hub.brainCall(call(op.scope.soulId,pendingMarker));await delivered(f,[viewer],106);assert.equal(JSON.stringify(viewer.messages).includes(pendingMarker),false);
  f.host.drainInputs();await delay(0);const admittedMarker='synthetic-private-after-admission';f.hub.brainCall(call(op.scope.soulId,admittedMarker));await delivered(f,[viewer],107);assert.ok(JSON.stringify(viewer.messages).includes(admittedMarker),'same socket becomes usable after actual admission');
  assert.equal(JSON.stringify(viewer.messages).includes(op.requestId),false);
});

test('actual WS private broadcast rechecks an admin downgrade instead of cached role',async t=>{
  const f=await local(t),op=f.souls.acceptLifecycleCreate('dev:alice',{name:'Alice',description:'local'});f.host.drainInputs();await delay(0);const admin=await f.connect('admin');
  f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();const offset=admin.messages.length,marker='synthetic-private-after-admin-downgrade';f.hub.brainCall(call(op.scope.soulId,marker));
  f.hub.broadcast({t:'stats',stats:f.hub.stats()},c=>c.me?.role==='admin');f.hub.broadcast({t:'stats',stats:f.hub.stats()},c=>c.me?.role!=='admin');f.hub.broadcast({t:'pong',n:77,serverTime:Date.now()});
  await until(()=>admin.messages.slice(offset).some(m=>m.t==='pong'&&m.n===77));const frames=admin.messages.slice(offset);assert.equal(JSON.stringify(frames).includes(marker),false);
  const stats=frames.filter(m=>m.t==='stats');assert.equal(stats.length,1);assert.equal('budget' in stats[0].stats.brain,false);assert.equal('costToday' in stats[0].stats.brain,false);
});

test('actual WS sends only the current owner private calls, with world calls reserved for admin',async t=>{
  const f=await local(t),{soul}=await born(f);await born(f,'bob');
  const alice=await f.connect('alice'),bob=await f.connect('bob'),anon=await f.connect(null),admin=await f.connect('admin'),viewers=[alice,bob,anon,admin];
  const marker='synthetic-private-owner-call',worldMarker='synthetic-private-world-call';
  f.hub.brainCall(call(soul.id,marker));f.hub.brainCall(call('',worldMarker));await delivered(f,viewers,101);
  assert.ok(JSON.stringify(alice.messages).includes(marker));assert.equal(JSON.stringify(alice.messages).includes(worldMarker),false);
  for(const v of [bob,anon]){assert.equal(JSON.stringify(v.messages).includes(marker),false);assert.equal(JSON.stringify(v.messages).includes(worldMarker),false);}
  assert.ok(JSON.stringify(admin.messages).includes(marker));assert.ok(JSON.stringify(admin.messages).includes(worldMarker));assert.equal(f.db.paidCost(),0);
});

for(const changed of ['invite','owner','world','body'] as const)test(`actual WS private delivery rechecks current ${changed}`,async t=>{
  const f=await local(t),{soul}=await born(f),alice=await f.connect('alice'),bob=await f.connect('bob');
  switch(changed){
    case 'invite':f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();break;
    case 'owner':f.db.db.prepare("UPDATE souls SET owner='dev:bob' WHERE id=?").run(soul.id);break;
    case 'world':f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run('other-local-world',soul.id);break;
    case 'body':delete f.host.engine.world.entities[soul.entity_id];break;
  }
  const marker='synthetic-private-after-'+changed,offset=alice.messages.length;f.hub.brainCall(call(soul.id,marker));await delivered(f,[alice,bob],102);
  assert.equal(JSON.stringify(alice.messages.slice(offset)).includes(marker),false);
  // A row-only ownership rewrite disagrees with canonical birth/Mind and grants
  // neither account control; this fixture is not a supported transfer API.
  assert.equal(JSON.stringify(bob.messages).includes(marker),false);
});

test('actual WS current user deletion drops private calls and administrator spend',async t=>{
  const f=await local(t),{soul}=await born(f),admin=await f.connect('admin'),before=admin.messages.find(m=>m.t==='stats');
  assert.ok(before&&before.t==='stats'&&'budget' in before.stats.brain);
  f.db.db.prepare("DELETE FROM users WHERE id='dev:admin'").run();const offset=admin.messages.length,marker='synthetic-private-after-user-deletion';
  f.hub.brainCall(call(soul.id,marker));f.hub.broadcast({t:'stats',stats:f.hub.stats()});await delivered(f,[admin],103);
  const frames=admin.messages.slice(offset);assert.equal(JSON.stringify(frames).includes(marker),false);
  const stats=frames.find(m=>m.t==='stats');assert.ok(stats&&stats.t==='stats');assert.equal('costToday' in stats.stats.brain,false);assert.equal('budget' in stats.stats.brain,false);
});

test('actual WS initial private history uses current ownership and fresh role after async authentication',async t=>{
  const f=await local(t),{soul}=await born(f),marker='synthetic-private-history';f.db.saveBrainCall(f.host.worldId,call(soul.id,marker));
  const stale=f.db.user('dev:admin')!,original=f.auth.userFromToken.bind(f.auth);
  let authenticated=false,release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
  t.mock.method(f.auth,'userFromToken',async(token:string|undefined|null)=>{if(token==='dev:admin'){authenticated=true;await hold;return stale;}return original(token);});
  const pending=f.connect('admin');await until(()=>authenticated);f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();release();
  const admin=await pending,alice=await f.connect('alice'),bob=await f.connect('bob'),anon=await f.connect(null);
  assert.equal(JSON.stringify(admin.messages).includes(marker),false);assert.ok(JSON.stringify(alice.messages).includes(marker));
  for(const v of [bob,anon])assert.equal(JSON.stringify(v.messages).includes(marker),false);
  const welcome=admin.messages.find(m=>m.t==='welcome');assert.ok(welcome&&welcome.t==='welcome');assert.equal(welcome.you!.role,'user');
  const stats=admin.messages.find(m=>m.t==='stats');assert.ok(stats&&stats.t==='stats');assert.equal('budget' in stats.stats.brain,false);
});

test('actual WS logical retirement revokes private delivery before physical cleanup without hiding public body',async t=>{
  const f=await local(t),{soul,op}=await born(f),alice=await f.connect('alice'),anon=await f.connect(null);
  const retirement=f.souls.acceptLifecycleRetire('dev:alice',soul),marker='synthetic-private-after-retire',offset=alice.messages.length;
  assert.ok(f.host.engine.world.entities[soul.entity_id],'canonical body remains before queued retirement');
  f.hub.brainCall(call(soul.id,marker));f.hub.broadcast({t:'snapshot',reason:'local retirement requested',...f.host.snapshotView()});await delivered(f,[alice,anon],104);
  assert.equal(JSON.stringify(alice.messages.slice(offset)).includes(marker),false);
  const publicSnapshot=anon.messages.filter(m=>m.t==='snapshot').at(-1)!;assert.ok(publicSnapshot&&publicSnapshot.t==='snapshot');assert.ok(publicSnapshot.entities[soul.entity_id]);assert.ok(publicSnapshot.souls.some(s=>s.id===soul.id));
  const reconnect=await f.connect('alice'),welcome=reconnect.messages.find(m=>m.t==='welcome');assert.ok(welcome&&welcome.t==='welcome');assert.deepEqual(welcome.you!.souls,[]);
  for(const v of [alice,anon,reconnect]){const encoded=JSON.stringify(v.messages);assert.equal(encoded.includes(op.requestId),false);assert.equal(encoded.includes(retirement.requestId),false);}
});

test('actual WS public departure takes preserve canonical mappings, surviving peer and model-free restore without private words',async t=>{
  const f=await local(t),alice=await born(f),bob=await born(f,'bob');
  const privateWords='synthetic-private-intent-context';
  await accept(f.host,f.souls.setIntent(alice.soul,{goal:'wander',note:privateWords},'web'));
  const rule=await accept(f.host,f.souls.steer(bob.soul,{words:'rest if you feel like it'},'web'));assert.equal(rule.ok,true);
  assert.ok(JSON.stringify(f.db.events(f.host.worldId)).includes(privateWords),'actual accepted private input is present in canonical log');
  const anon=await f.connect(null);for(let i=0;i<25;i++)f.host.tickOnce();
  const retirement=f.souls.acceptLifecycleRetire('dev:alice',alice.soul),requested=structuredClone(f.host.snapshotView());
  assert.ok(requested.entities[alice.soul.entity_id]);assert.ok(requested.souls.some(s=>s.id===alice.soul.id));
  f.hub.broadcast({t:'snapshot',reason:'local retirement requested',...requested});
  f.host.drainInputs();await delay(0);f.host.drainInputs();await delay(0);
  assert.equal(f.souls.lifecycleReceipt('dev:alice',retirement.requestId).state,'retired');
  const committed=structuredClone(f.host.snapshotView());assert.equal(committed.entities[alice.soul.entity_id],undefined);assert.equal(committed.souls.some(s=>s.id===alice.soul.id),false);assert.ok(committed.entities[bob.soul.entity_id]);assert.ok(committed.souls.some(s=>s.id===bob.soul.id));
  f.hub.broadcast({t:'snapshot',reason:'local retirement committed',...committed});for(let i=25;i<40;i++)f.host.tickOnce();
  await delivered(f,[anon],105);
  const chunks=f.host.engine.takeChunks!(-1);assert.equal(chunks.length,2);
  const first=chunks[0].take as Take,last=chunks.at(-1)!.take as Take;
  assert.ok(first.finalState.entities[alice.soul.entity_id]);assert.equal(last.finalState.entities[alice.soul.entity_id],undefined);assert.ok(last.finalState.entities[bob.soul.entity_id]);
  const wireChunks=anon.messages.flatMap(m=>m.t==='takes'?m.chunks:[]);assert.deepEqual(wireChunks,chunks,'actual broadcast publishes unmodified native chunks');
  assert.ok(anon.messages.some(m=>m.t==='batch'&&m.removedSouls.includes(alice.soul.id)));assert.equal(anon.messages.some(m=>m.t==='brain'),false);
  const encoded=JSON.stringify({frames:anon.messages,requested,committed,chunks});
  for(const forbidden of [privateWords,'rest if you feel like it',alice.op.requestId,bob.op.requestId,retirement.requestId,'dev:alice','dev:bob','token_hash','invited_by','lifecycle_operations_v1'])assert.equal(encoded.includes(forbidden),false,`public transport excludes ${forbidden}`);
  // Boot resumes to the last durable tick, not arbitrary uncheckpointed wall
  // progress. Capture the same tick40 head before comparing restart hashes.
  const checkpoint=f.host.saveSnapshot(true);assert.ok(!checkpoint.pending);assert.equal(checkpoint.tick,40);
  const restored=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId);restored.boot();assert.equal(restored.engine.world.tick,40);
  const replay=replayFromGenesis(factory,'native-owner-lifecycle',f.db.events(f.host.worldId),40,{includeHeadEvents:true});
  assert.equal(restored.engine.stateHash(),f.host.engine.stateHash());assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restored.kernel),kernelHash(f.host.kernel));assert.equal(kernelHash(replay.kernel),kernelHash(f.host.kernel));assert.equal(f.db.paidCost(),0);
  // Explicit opt-in artifact capture for World's C095 review. Never persist DB,
  // private operations, canonical private log, Minds, accounts or credentials.
  const output=process.env.SIM_PUBLIC_LIFECYCLE_FIXTURE;
  if(output){
    const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
    const bundle={format:'sim-public-lifecycle-fixture/1',scope:'isolated short native departure; no occupied-crew/capacity/live proof',source:{commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hubSha256:sha(readFileSync(new URL('./hub.ts',import.meta.url))),testSha256:sha(readFileSync(new URL('./lifecycle-ws.test.ts',import.meta.url)))},identity:{worldId:f.host.worldId,rulesVersion:factory.rulesVersion,schema:f.host.engine.schema,seed:'native-owner-lifecycle',headTick:40,headStateHash:f.host.engine.stateHash(),headKernelHash:kernelHash(f.host.kernel),restoreStateHash:restored.engine.stateHash(),replayStateHash:replay.engine.stateHash(),includeHeadEvents:true},actors:{departing:{soulId:alice.soul.id,entityId:alice.soul.entity_id},surviving:{soulId:bob.soul.id,entityId:bob.soul.entity_id}},requested,committed,chunks,publicFrames:anon.messages};
    writeFileSync(output,JSON.stringify(bundle,null,2)+'\n');
  }
});

test('actual WS installer-absent default Hub retains usable ordinary authentication and public join',async t=>{
  const f=await local(t,false),alice=await f.connect('alice'),anon=await f.connect(null);
  const welcome=alice.messages.find(m=>m.t==='welcome');assert.ok(welcome&&welcome.t==='welcome');assert.equal(welcome.you!.userId,'dev:alice');assert.equal(welcome.you!.invited,true);
  assert.ok(anon.messages.some(m=>m.t==='snapshot'));assert.equal(f.souls.lifecycle,undefined);assert.equal(f.db.paidCost(),0);
});
