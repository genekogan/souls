import { test,type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { fixture,invite } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
async function local(t:TestContext){
  const f=fixture(':memory:',factory);f.souls.enableLifecycle();t.after(()=>f.db.close());await invite(f,'alice');await invite(f,'bob');await invite(f,'operator');
  f.db.db.prepare("UPDATE users SET role='admin' WHERE id='dev:operator'").run();
  const op=f.souls.acceptLifecycleCreate('dev:alice',{name:'Alice',description:'local private read fixture'});f.host.drainInputs();await delay(0);
  const soul=f.db.soul(op.scope.soulId)!;
  const ref=f.db.internPrompt('SYNTHETIC_PRIVATE_READ_MARKER');
  f.db.saveBrainCall(f.host.worldId,{tick:0,at:Date.now(),tier:'compile',subject:'local fixture',soulId:soul.id,model:'fake',mode:'fake',
    request:{system:[{text:ref}]},response:{},applied:{},ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0});
  return {...f,soul,ref};
}
async function heldAuth(t:TestContext,f:Awaited<ReturnType<typeof local>>,path:string,owner='operator'){
  const original=f.auth.userFromToken.bind(f.auth);let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve);
  t.mock.method(f.auth,'userFromToken',async(...args:Parameters<typeof original>)=>{const actual=await original(...args);entered();await hold;return actual;});
  const response=f.request(path,undefined,owner);await ready;return {response,release};
}
for(const route of ['dashboard','prompt'] as const)test(`candidate private ${route} denies admin role lost during actual Auth return`,async t=>{
  const f=await local(t),path=route==='prompt'?`/v1/prompt/${f.ref.$prompt}`:`/v1/souls/${f.soul.id}`,pending=await heldAuth(t,f,path);
  f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:operator'").run();pending.release();const r=await pending.response;
  assert.equal(r.status,route==='prompt'?404:403);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(!(await r.text()).includes('SYNTHETIC_PRIVATE_READ_MARKER'));assert.equal(f.db.paidCost(),0);
});
const routeOf=(f:Awaited<ReturnType<typeof local>>,name:string)=>name==='prompt'?`/v1/prompt/${f.ref.$prompt}`:name==='brain'||name==='me'?`/v1/${name}`:`/v1/souls/${f.soul.id}${name==='dashboard'?'':'/'+name}`;
const privateRoutes=['dashboard','timeline','deck','talk','perceive','mandate','brain','prompt','me'];
for(const route of privateRoutes.filter(r=>!['dashboard','prompt'].includes(r)))test(`candidate private ${route} uses the role current after Auth await`,async t=>{
  const f=await local(t),pending=await heldAuth(t,f,routeOf(f,route));f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:operator'").run();pending.release();const r=await pending.response;
  assert.equal(r.status,['brain','me'].includes(route)?200:403);assert.equal(r.headers.get('cache-control'),'no-store');
  const text=await r.text();assert.ok(!text.includes('SYNTHETIC_PRIVATE_READ_MARKER'));
  if(route==='brain')assert.deepEqual(JSON.parse(text),{calls:[]});
  if(route==='me'){const data=JSON.parse(text);assert.equal(data.me.role,'user');assert.deepEqual(data.souls,[]);assert.deepEqual(data.me.souls,[]);}
  assert.equal(f.db.paidCost(),0);
});
for(const route of privateRoutes)test(`candidate private ${route} rechecks invitation after Auth await`,async t=>{
  const f=await local(t),pending=await heldAuth(t,f,routeOf(f,route),'alice');f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();pending.release();const r=await pending.response;
  assert.equal(r.status,route==='me'?200:403);assert.equal(r.headers.get('cache-control'),'no-store');const text=await r.text();assert.ok(!text.includes('SYNTHETIC_PRIVATE_READ_MARKER'));
  if(route==='me'){const data=JSON.parse(text);assert.equal(data.me.invited,false);assert.deepEqual(data.souls,[]);assert.deepEqual(data.me.souls,[]);assert.deepEqual(data.lifecycleRequests.requests,[]);}
  assert.equal(f.db.paidCost(),0);
});
for(const route of ['dashboard','brain','prompt','me'])test(`candidate private ${route} denies an issuer deleted during Auth await`,async t=>{
  const f=await local(t),pending=await heldAuth(t,f,routeOf(f,route));f.db.db.prepare("DELETE FROM users WHERE id='dev:operator'").run();pending.release();const r=await pending.response;
  assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(!(await r.text()).includes('SYNTHETIC_PRIVATE_READ_MARKER'));assert.equal(f.db.paidCost(),0);
});
test('current admitted owner and invited admin retain all candidate private reads',async t=>{
  const f=await local(t);
  for(const owner of ['alice','operator'])for(const route of privateRoutes){const r=await f.request(routeOf(f,route),undefined,owner);assert.equal(r.status,200,`${owner}/${route}`);assert.equal(r.headers.get('cache-control'),'no-store');const text=await r.text();if(route==='prompt')assert.equal(text,'SYNTHETIC_PRIVATE_READ_MARKER');if(route==='brain')assert.equal(JSON.parse(text).calls.length,1);}
  assert.equal(f.db.paidCost(),0);
});
for(const change of ['retired','body','world'] as const)test(`candidate originating prompt and call list exclude own ${change} identity`,async t=>{
  const f=await local(t);
  if(change==='retired')f.souls.acceptLifecycleRetire('dev:alice',f.soul);
  if(change==='body')delete f.host.engine.world.entities[f.soul.entity_id];
  if(change==='world')f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run('other-local-world',f.soul.id);
  const p=await f.request(routeOf(f,'prompt'));assert.equal(p.status,404);assert.equal(p.headers.get('cache-control'),'no-store');
  const b=await f.request('/v1/brain');assert.equal(b.status,200);assert.deepEqual(await b.json(),{calls:[]});assert.equal(f.db.paidCost(),0);
});
test('candidate brain list excludes foreign-world calls even for current admin',async t=>{
  const f=await local(t),original=f.db.brainCalls(1)[0];f.db.saveBrainCall('other-local-world',{...original,subject:'FOREIGN_WORLD_CALL_MARKER'});
  for(const owner of ['alice','operator']){const r=await f.request('/v1/brain',undefined,owner),text=await r.text();assert.equal(r.status,200);assert.equal(JSON.parse(text).calls.length,1);assert.ok(!text.includes('FOREIGN_WORLD_CALL_MARKER'));}
  assert.equal(f.db.paidCost(),0);
});
test('pending reservation supplies receipts but no ordinary private read identity',async t=>{
  const f=await local(t),op=f.souls.acceptLifecycleCreate('dev:bob',{name:'Bob',description:'pending private read fixture'}),soul=f.db.soul(op.scope.soulId)!;
  const ref=f.db.internPrompt('SYNTHETIC_PENDING_READ_MARKER');f.db.saveBrainCall(f.host.worldId,{tick:0,at:Date.now(),tier:'compile',subject:'pending fixture',soulId:soul.id,model:'fake',mode:'fake',request:{system:[{text:ref}]},response:{},applied:{},ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0});
  assert.equal((await f.request(`/v1/souls/${soul.id}`,undefined,'bob')).status,409);
  assert.equal((await f.request(`/v1/prompt/${ref.$prompt}`,undefined,'bob')).status,404);
  const calls=await f.request('/v1/brain',undefined,'bob');assert.deepEqual(await calls.json(),{calls:[]});
  const me=await f.request('/v1/me',undefined,'bob'),data=await me.json() as {souls:unknown[];lifecycleRequests:{requests:{state:string}[]}};
  assert.deepEqual(data.souls,[]);assert.equal(data.lifecycleRequests.requests[0].state,'pending');assert.equal(f.host.engine.world.entities[soul.entity_id],undefined);assert.equal(f.db.paidCost(),0);
});
