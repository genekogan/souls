// Actual selected-Soul Auth/Hono/SQLite/native candidate, no paid compiler.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {getRequestListener} from '@hono/node-server';
import {marsFactory} from '@souls/engine-mars';
import {WorldHost} from './world.ts';
import {Db} from './db.ts';
import {Brain} from './brain.ts';
import {Souls} from './souls.ts';
import {Auth} from './auth.ts';
import {buildApp} from './http.ts';
import {IntentControlV2} from './intent-control.ts';
import {INTENT_V2,intentOwnerControlV2Schema,publicEvent} from '@souls/protocol';
import {intentNativeFixture,worldId} from '../test/intent-native-fixture.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

type Fixture=ReturnType<typeof intentNativeFixture>;
const get=async(f:Fixture,credential='dev:alice',id='s_A')=>f.app.request('/v1/souls/'+id,{headers:{authorization:'Bearer '+credential}});
async function denied(response:Response,status:number) {
  assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
  const value=await response.json();assert.equal(Object.hasOwn(value,'control'),false);
  assert.ok(!JSON.stringify(value).includes(INTENT_V2));return value;
}
const control={worldId,soulId:'s_A',ownerId:'dev:alice',intentContract:INTENT_V2};

test('strict control DTO accepts only exact scoped version, never credentials or readiness guesses',()=>{
  assert.deepEqual(intentOwnerControlV2Schema.parse(control),control);
  for(const bad of [{...control,intentContract:'soul-intent/1'},{...control,ownerId:''},{...control,soulId:'../other'},
    {...control,worldId:''},{...control,token:'sim_PRIVATE'},{...control,ready:true},{...control,requestId:'private'},
    {...control,intentContract:undefined}])assert.equal(intentOwnerControlV2Schema.safeParse(bad).success,false);
});

// LINK (Gene 2026-10-24): GET /v1/souls/:id now also carries the owner link state (agent.link) and the public now line;
// for a Soul no agent ever listened for, that is disconnected/never with no holder, and no now line.
const withLink=(dash:object)=>{const d=JSON.parse(JSON.stringify(dash));return {...d,agent:{...d.agent,link:{state:'disconnected',reason:'never',since:null,holder:null}},now:null};};
test('actual dashboard advertises only explicit candidate, is read-only and does not fork legacy output',async t=>{
  const off=intentNativeFixture(t,':memory:',false),legacy=await get(off);
  assert.equal(legacy.status,200);assert.deepEqual(await legacy.json(),withLink(off.souls.dashboard(off.db.soul('s_A')!)));
  assert.equal(legacy.headers.get('cache-control'),null);
  const f=intentNativeFixture(t),before=f.db.events(worldId),kernel=f.host.kernel,seq=f.host.seq;
  for(let i=0;i<2;i++) {
    const response=await get(f);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const {control:actual,...dashboard}=await response.json();assert.deepEqual(intentOwnerControlV2Schema.parse(actual),control);
    assert.deepEqual(dashboard,withLink(f.souls.dashboard(f.db.soul('s_A')!)));
  }
  assert.deepEqual(f.db.events(worldId),before);assert.equal(f.host.kernel,kernel);assert.equal(f.host.seq,seq);
  assert.equal(f.calls,0);assert.equal(f.db.paidCost(),0);
  for(const path of ['/v1/config','/v1/world','/v1/log','/v1/kernel','/v1/scene']) {
    const response=await f.app.request(path);assert.equal(response.status,200);assert.ok(!(await response.text()).includes('intentContract'),path);
  }
  assert.ok(!JSON.stringify(f.db.events(worldId).map(publicEvent)).includes('intentContract'));
});

test('operator viewing another owner receives no genuine-owner adapter; owning admin can receive it',async t=>{
  const f=intentNativeFixture(t),response=await get(f,'dev:admin');assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(Object.hasOwn(await response.json(),'control'),false);
  f.db.upsertUser({id:'dev:alice',role:'admin',email:null,wallet:null});
  const owned=await get(f);assert.equal(owned.status,200);assert.deepEqual((await owned.json()).control,control);
  assert.equal(f.calls,0);
});

test('agent/api scope cannot become a human web capability',t=>{
  const f=intentNativeFixture(t),owner=f.service.ownerScope({userId:'dev:alice',expiresAt:Infinity},'s_A','api');
  assert.equal(f.service.ownerControl(owner),undefined);
  const credential=f.souls.pairExchange(f.souls.pairCode(f.db.soul('s_A')!,`http://127.0.0.1:${TEST_PORT}`,f.db.user('dev:alice')!).code,'local capability fixture').token;
  assert.equal(f.service.ownerControl(f.service.agentScope(credential,'mcp')),undefined);
  assert.throws(()=>f.service.ownerScope({userId:'dev:alice',expiresAt:Date.now()-1},'s_A'),/sign in/);
});

test('actual unknown, foreign, non-owner and anonymous dashboard cannot advertise control',async t=>{
  const f=intentNativeFixture(t);
  await denied(await get(f,'dev:bob'),403);await denied(await get(f,'dev:alice','unknown'),404);
  await denied(await f.app.request('/v1/souls/s_A'),401);
  f.db.createWorld({id:'foreign',schema:f.host.engine.schema,rules_version:f.host.engine.rulesVersion,dt:f.host.engine.dt,seed:'other'});
  f.db.db.prepare("UPDATE souls SET world_id='foreign' WHERE id='s_A'").run();await denied(await get(f),404);
});

test('native body, Mind and kernel correspondence must still exist at capability read',async t=>{
  const f=intentNativeFixture(t),actor=f.host.engine.world.entities.h_A,mind=f.host.minds.get('s_A')!;
  delete f.host.engine.world.entities.h_A;await denied(await get(f),409);f.host.engine.world.entities.h_A=actor;
  f.host.minds.delete('s_A');await denied(await get(f),409);f.host.minds.set('s_A',mind);
  const old=f.host.kernel.things.s_A.traits.body;f.host.kernel.things.s_A.traits.body='wrong';
  await denied(await get(f),409);f.host.kernel.things.s_A.traits.body=old;
  const original=actor.human!.soul;actor.human!.soul='wrong';await denied(await get(f),409);actor.human!.soul=original;
  assert.deepEqual((await (await get(f)).json()).control,control);
  f.db.retireSoul('s_A');await denied(await get(f),404);
});

test('invitation loss while real authentication awaits is checked from current DB',async t=>{
  const f=intentNativeFixture(t),auth=f.auth.userFromToken.bind(f.auth);
  let reached!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>reached=r),held=new Promise<void>(r=>release=r);
  t.mock.method(f.auth,'userFromToken',async(...args:Parameters<typeof auth>)=>{const old=await auth(...args);reached();await held;return old;});
  const pending=get(f);await arrived;f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();release();
  await denied(await pending,403);assert.equal(f.calls,0);
});

test('stale authenticated admin role cannot inspect another owner after demotion',async t=>{
  const f=intentNativeFixture(t),auth=f.auth.userFromToken.bind(f.auth);
  let reached!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>reached=r),held=new Promise<void>(r=>release=r);
  t.mock.method(f.auth,'userFromToken',async(...args:Parameters<typeof auth>)=>{const old=await auth(...args);reached();await held;return old;});
  const pending=get(f,'dev:admin');await arrived;f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();release();
  await denied(await pending,403);
});

test('private dashboard serialization cannot return control after final authority loss',async t=>{
  const f=intentNativeFixture(t),read=f.service.ownerControl.bind(f.service);
  t.mock.method(f.service,'ownerControl',(...args:Parameters<typeof read>)=>{
    const ready=read(...args);assert.deepEqual(ready,control);
    f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();return ready;
  });
  await denied(await get(f),403);assert.equal(f.calls,0);
});

test('candidate follows actual installed lifecycle admission and pending retirement readiness',async t=>{
  const base=intentNativeFixture(t),cfg={...base.deps.cfg,anthropicKey:undefined};
  const factory=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],
    grounds:{id:'grounds',name:'grounds'},safeCrewRemoval:true});
  const db=new Db(':memory:');t.after(()=>db.close());
  db.upsertUser({id:'dev:alice',role:'user',email:null,wallet:null});db.setInvited('dev:alice','local');
  const host=new WorldHost(db,factory,'control-lifecycle',1e9,worldId);host.boot();
  const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}},{intentV2Choices:true});
  const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();
  const auth=new Auth(cfg,db);auth.devAuth=true;
  const service=new IntentControlV2(host,brain,souls),app=buildApp({...base.deps,db,host,brain,souls,auth,intentV2:service});
  const birth=souls.acceptLifecycleCreate('dev:alice',{name:'Arrival',description:'actual lifecycle control fixture'}),id=birth.scope.soulId;
  const read=async()=>app.request('/v1/souls/'+id,{headers:{authorization:'Bearer dev:alice'}});
  await denied(await read(),409);assert.ok(!host.minds.get(id));
  host.drainInputs();
  const admitted=await read();assert.equal(admitted.status,200);
  assert.deepEqual(intentOwnerControlV2Schema.parse((await admitted.json()).control),{worldId,soulId:id,ownerId:'dev:alice',intentContract:INTENT_V2});
  souls.acceptLifecycleRetire('dev:alice',db.soul(id)!);
  assert.ok(host.engine.world.entities[db.soul(id)!.entity_id],'native body still exists before pending retirement drains');
  assert.notEqual(db.soul(id)!.retired_at,null,'retirement acceptance already durably hides control');
  await denied(await read(),404);assert.equal(db.paidCost(),0);
  host.drainInputs();
});

test('two actual native owned Souls select distinct current scoped controls over TCP',async t=>{
  const f=intentNativeFixture(t);
  f.db.createSoul({id:'s_B',worldId,owner:'dev:bob',entityId:'h_B',name:'Bob',description:'local',native:false});
  void f.host.enqueue('birth','fixture',{soulId:'s_B',entityId:'h_B',owner:'dev:bob',name:'Bob',description:'local'});f.host.drainInputs();
  assert.ok(f.host.minds.get('s_B'));assert.ok(f.host.engine.world.entities.h_B);
  const server=createServer(getRequestListener(f.app.fetch));
  t.after(async()=>{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',resolve);});
  for(const [owner,soulId] of [['dev:alice','s_A'],['dev:bob','s_B']]) {
    const own=await fetch(`http://127.0.0.1:${TEST_PORT}/v1/souls/`+soulId,{headers:{authorization:'Bearer '+owner}});
    assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'no-store');
    assert.deepEqual(intentOwnerControlV2Schema.parse((await own.json()).control),{worldId,soulId,ownerId:owner,intentContract:INTENT_V2});
    const other=soulId==='s_A'?'s_B':'s_A';await denied(await fetch(`http://127.0.0.1:${TEST_PORT}/v1/souls/`+other,{headers:{authorization:'Bearer '+owner}}),403);
  }
  assert.equal(f.calls,0);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('a previously returned capability never authorizes mutation after invitation loss',async t=>{
  const f=intentNativeFixture(t),response=await get(f);assert.deepEqual((await response.json()).control,control);
  const before=f.db.events(worldId);f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  await denied(await f.post({contract:INTENT_V2,requestId:'capability-is-not-authority',op:'upsert',words:'go to the campfire'}),403);
  assert.deepEqual(f.db.events(worldId),before);assert.equal(f.calls,0);assert.equal(f.db.paidCost(),0);
});
