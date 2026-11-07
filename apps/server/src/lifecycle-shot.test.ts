import { test,type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { fixture,invite } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
async function local(t:TestContext,candidate=true){
  const f=fixture(':memory:',factory);if(candidate)f.souls.enableLifecycle();await invite(f,'alice');await invite(f,'bob');
  const input={name:'Alice',description:'local shot fixture'};
  let soul;
  if(candidate){const op=f.souls.acceptLifecycleCreate('dev:alice',input);f.host.drainInputs();await delay(0);soul=f.db.soul(op.scope.soulId)!;}
  else {const creation=f.souls.create('dev:alice',input);f.host.drainInputs();soul=await creation;}
  t.after(()=>f.db.close());return {...f,soul};
}
async function heldShot(t:TestContext,f:Awaited<ReturnType<typeof local>>,owner='alice'){
  const original=f.brain.shotFor.bind(f.brain);let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve);
  t.mock.method(f.brain,'shotFor',async(...args:Parameters<typeof original>)=>{const actual=await original(...args);entered();await hold;return actual;});
  const response=f.request(`/v1/souls/${f.soul.id}/shot`,{},owner);await ready;return {response,release};
}
test('actual native fake shot returns its current owner a usable camera proposal',async t=>{
  const f=await local(t),result=await f.request(`/v1/souls/${f.soul.id}/shot`,{});assert.equal(result.status,200);
  assert.equal(result.headers.get('cache-control'),'no-store');const data=await result.json() as {ok:boolean;shot:{id:string;spec:unknown}};
  assert.equal(data.ok,true);assert.ok(data.shot.id);assert.ok(data.shot.spec);assert.equal(f.db.paidCost(),0);
});
test('actual HTTP shot held after native computation cannot deliver after logical retirement',async t=>{
  const f=await local(t),pending=await heldShot(t,f);f.souls.acceptLifecycleRetire('dev:alice',f.soul);assert.ok(f.host.engine.world.entities[f.soul.entity_id]);pending.release();
  const result=await pending.response;assert.equal(result.status,404);assert.equal(result.headers.get('cache-control'),'no-store');const data=await result.json() as {shot?:unknown};assert.equal(data.shot,undefined);assert.equal(f.db.paidCost(),0);
});
for(const changed of ['invite','admin-role','owner','world','body','user-deleted'] as const)test(`actual HTTP shot held after native computation denies current ${changed} mismatch`,async t=>{
  const f=await local(t),issuer=['admin-role','user-deleted'].includes(changed)?'admin':'alice',pending=await heldShot(t,f,issuer);
  switch(changed){
    case 'invite':f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();break;
    case 'admin-role':f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();break;
    case 'owner':f.db.db.prepare("UPDATE souls SET owner='dev:bob' WHERE id=?").run(f.soul.id);break;
    case 'world':f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run('other-local-world',f.soul.id);break;
    case 'body':delete f.host.engine.world.entities[f.soul.entity_id];break;
    case 'user-deleted':f.db.db.prepare("DELETE FROM users WHERE id='dev:admin'").run();break;
  }
  pending.release();const result=await pending.response;
  assert.equal(result.status,changed==='body'?409:changed==='user-deleted'?401:['invite','admin-role'].includes(changed)?403:404);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json() as {shot?:unknown}).shot,undefined);assert.equal(f.db.paidCost(),0);
});
test('invalid current invitation denies shot before invoking its generator',async t=>{
  const f=await local(t),shot=t.mock.method(f.brain,'shotFor',f.brain.shotFor.bind(f.brain));f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  const result=await f.request(`/v1/souls/${f.soul.id}/shot`,{});assert.equal(result.status,403);assert.equal(shot.mock.callCount(),0);assert.equal(f.db.paidCost(),0);
});
test('installer-absent actual native owner shot retains default response',async t=>{
  const f=await local(t,false),result=await f.request(`/v1/souls/${f.soul.id}/shot`,{});assert.equal(result.status,200);assert.ok((await result.json() as {shot:unknown}).shot);assert.equal(f.souls.lifecycle,undefined);assert.equal(f.db.paidCost(),0);
});
