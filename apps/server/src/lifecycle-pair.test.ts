import { test,type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { fixture,invite } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
async function local(t:TestContext,candidate=true){
  const f=fixture(':memory:',factory);if(candidate)f.souls.enableLifecycle();await invite(f,'alice');await invite(f,'bob');
  const input={name:'Alice',description:'local pairing fixture'};let soul;
  if(candidate){const op=f.souls.acceptLifecycleCreate('dev:alice',input);f.host.drainInputs();await delay(0);soul=f.db.soul(op.scope.soulId)!;}
  else {const creation=f.souls.create('dev:alice',input);f.host.drainInputs();soul=await creation;}
  t.after(()=>f.db.close());return {...f,soul};
}
async function start(f:Awaited<ReturnType<typeof local>>){
  const result=await f.request('/v1/agent/pair/start',{agent:'local'});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  return await result.json() as {user_code:string;poll_token:string};
}
async function approve(f:Awaited<ReturnType<typeof local>>,pair:Awaited<ReturnType<typeof start>>,owner='alice'){
  return f.request('/v1/pair/approve',{code:pair.user_code,soulId:f.soul.id},owner);
}
async function poll(f:Awaited<ReturnType<typeof local>>,pair:Awaited<ReturnType<typeof start>>){return f.request('/v1/agent/pair/poll',{poll_token:pair.poll_token});}
test('actual owner approval delivers one usable agent credential and never redelivers',async t=>{
  const f=await local(t),pair=await start(f),pending=await poll(f,pair);assert.equal(pending.status,200);assert.equal((await pending.json() as {status:string}).status,'pending');
  assert.equal((await approve(f,pair)).status,200);const delivered=await poll(f,pair);assert.equal(delivered.status,200);assert.equal(delivered.headers.get('cache-control'),'no-store');
  const value=await delivered.json() as {status:string;token:string};assert.equal(value.status,'approved');assert.equal(f.souls.soulFromToken(value.token)!.id,f.soul.id);assert.equal((await poll(f,pair)).status,404);
  assert.equal(JSON.stringify(f.db.events(f.host.worldId)).includes(value.token),false);assert.equal(f.db.paidCost(),0);
});
test('admin-approved pending credential cannot be delivered after the actual owner loses invitation',async t=>{
  const f=await local(t),pair=await start(f);assert.equal((await approve(f,pair,'admin')).status,200);f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  const result=await poll(f,pair);assert.equal(result.status,404);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json() as {token?:unknown}).token,undefined);assert.equal(f.db.paidCost(),0);
});
for(const changed of ['retire','invite','admin-role','owner','world','body','rotate','deleted-issuer'] as const)test(`actual approved pairing poll denies current ${changed} mismatch without a token`,async t=>{
  const f=await local(t),pair=await start(f),issuer=['admin-role','deleted-issuer'].includes(changed)?'admin':'alice';assert.equal((await approve(f,pair,issuer)).status,200);
  switch(changed){
    case 'retire':f.souls.acceptLifecycleRetire('dev:alice',f.soul);assert.ok(f.host.engine.world.entities[f.soul.entity_id]);break;
    case 'invite':f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();break;
    case 'admin-role':f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();break;
    case 'owner':f.db.db.prepare("UPDATE souls SET owner='dev:bob' WHERE id=?").run(f.soul.id);break;
    case 'world':f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run('other-local-world',f.soul.id);break;
    case 'body':delete f.host.engine.world.entities[f.soul.entity_id];break;
    case 'rotate':f.souls.pairExchange(f.souls.pairCode(f.soul,'http://127.0.0.1:4959',f.db.user('dev:alice')!).code,'rotated');break;
    case 'deleted-issuer':f.db.db.prepare("DELETE FROM users WHERE id='dev:admin'").run();break;
  }
  const result=await poll(f,pair);assert.equal(result.status,404);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json() as {token?:unknown}).token,undefined);
  assert.equal((await poll(f,pair)).status,404);assert.equal(f.db.paidCost(),0);
});
for(const route of ['approve','exchange'] as const)test(`actual admin ${route} cannot mint for a currently uninvited owner`,async t=>{
  const f=await local(t),pair=route==='approve'?await start(f):f.souls.pairCode(f.soul,'http://127.0.0.1:4959',f.db.user('dev:admin')!);
  f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();assert.equal(f.db.soul(f.soul.id)!.token_hash,null);
  const result=route==='approve'?await approve(f,pair as Awaited<ReturnType<typeof start>>,'admin'):await f.request('/v1/agent/pair',{code:(pair as {code:string}).code,agent:'local'});
  assert.equal(result.status,route==='approve'?403:404);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json() as {token?:unknown}).token,undefined);assert.equal(f.db.soul(f.soul.id)!.token_hash,null);
});
test('actual owner-code exchange delivers usable current credential once, while foreign approval denies',async t=>{
  const f=await local(t),pair=await start(f);assert.equal((await approve(f,pair,'bob')).status,403);assert.equal(f.db.soul(f.soul.id)!.token_hash,null);
  const issued=await f.request(`/v1/souls/${f.soul.id}/pair`,{});assert.equal(issued.status,200);assert.equal(issued.headers.get('cache-control'),'no-store');const code=(await issued.json() as {code:string}).code;
  const exchange=await f.request('/v1/agent/pair',{code,agent:'local'});assert.equal(exchange.status,200);assert.equal(exchange.headers.get('cache-control'),'no-store');const token=(await exchange.json() as {token:string}).token;assert.equal(f.souls.soulFromToken(token)!.id,f.soul.id);
  assert.equal((await f.request('/v1/agent/pair',{code,agent:'again'})).status,404);assert.equal(JSON.stringify(f.db.events(f.host.worldId)).includes(token),false);assert.equal(f.db.paidCost(),0);
});
test('pending logical body cannot issue or approve credentials and GET poll delivers existing approved shape',async t=>{
  const f=await local(t),pair=await start(f),pending=f.souls.acceptLifecycleCreate('dev:alice',{name:'Pending',description:'local'});
  assert.equal((await f.request(`/v1/souls/${pending.scope.soulId}/pair`,{})).status,409);
  assert.equal((await f.request('/v1/pair/approve',{code:pair.user_code,soulId:pending.scope.soulId})).status,409);assert.equal(f.db.soul(pending.scope.soulId)!.token_hash,null);
  assert.equal((await approve(f,pair)).status,200);const result=await f.request('/v1/agent/pair/poll?poll_token='+encodeURIComponent(pair.poll_token));assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json() as {status:string}).status,'approved');
});
test('installer-absent native pairing preserves owner approval, poll and code exchange',async t=>{
  const f=await local(t,false),pair=await start(f);assert.equal((await approve(f,pair)).status,200);
  const polled=await poll(f,pair);assert.equal(polled.status,200);assert.equal(f.souls.soulFromToken((await polled.json() as {token:string}).token)!.id,f.soul.id);
  const code=f.souls.pairCode(f.soul,'http://127.0.0.1:4959',f.db.user('dev:alice')!).code,result=await f.request('/v1/agent/pair',{code,agent:'legacy'});
  assert.equal(result.status,200);assert.equal(f.souls.soulFromToken((await result.json() as {token:string}).token)!.id,f.soul.id);assert.equal(f.souls.lifecycle,undefined);assert.equal(f.db.paidCost(),0);
});
