import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { soulLifecycleSchema,ownerLifecycleListSchema } from '@souls/protocol';
import { fixture,invite } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
async function local(){const f=fixture(':memory:',factory);f.souls.enableLifecycle();await invite(f,'alice');return f;}
async function admitted(f:Awaited<ReturnType<typeof local>>,name='Alice'){
  const op=f.souls.acceptLifecycleCreate('dev:alice',{name,description:'local'});f.host.drainInputs();await delay(0);assert.equal(f.souls.lifecycleReceipt('dev:alice',op.requestId).ready,true);return f.db.soul(op.scope.soulId)!;
}
function remove(f:Awaited<ReturnType<typeof local>>,soulId:string,optIn=false){return Promise.resolve(f.app.request(`/v1/souls/${soulId}`,{method:'DELETE',headers:{authorization:'Bearer dev:alice',...(optIn?{'X-Sim-Lifecycle':'1'}:{})}}));}
async function drain<T>(f:Awaited<ReturnType<typeof local>>,promise:Promise<T>){
  let done=false;promise.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){f.host.drainInputs();await delay(2);}assert.ok(done);return promise;
}

test('legacy retirement write200 requires actual native absence and durable terminal confirmation',async t=>{
  const f=await local();t.after(()=>f.db.close());const soul=await admitted(f),tick=f.host.engine.world.tick;
  const response=await drain(f,remove(f,soul.id));assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(f.host.engine.world.entities[soul.entity_id],undefined);
  const op=f.souls.lifecycleHistory('dev:alice').requests.find(op=>op.operation==='retire')!;assert.equal(op.state,'retired');assert.ok(op.fact);assert.equal(f.host.engine.world.tick,tick);
});

test('legacy retirement unconfirmed503 preserves retiring occupancy until real removal and confirmation',async t=>{
  const f=await local();t.after(()=>f.db.close());const soul=await admitted(f),started=performance.now();
  const response=await remove(f,soul.id);assert.equal(response.status,503);assert.ok(performance.now()-started>=1900);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json() as {ok:boolean;code:string;lifecycle:unknown};assert.equal(body.ok,false);assert.equal(body.code,'lifecycle-pending');const retiring=soulLifecycleSchema.parse(body.lifecycle);assert.equal(retiring.state,'retiring');assert.equal(retiring.fact,null);assert.ok(f.host.engine.world.entities[soul.entity_id]);
  f.host.drainInputs();await delay(0);f.host.drainInputs();await delay(0);
  const refreshed=await f.app.request(`/v1/lifecycle/${retiring.requestId}`,{headers:{authorization:'Bearer dev:alice'}});assert.equal(soulLifecycleSchema.parse((await refreshed.json() as {lifecycle:unknown}).lifecycle).state,'retired');assert.equal(f.host.engine.world.entities[soul.entity_id],undefined);
});

test('opted-in terminal create and retirement write200 reflect real sequenced completion before final reply',async t=>{
  const f=await local();t.after(()=>f.db.close());const create=f.souls.acceptLifecycleCreate.bind(f.souls),retire=f.souls.acceptLifecycleRetire.bind(f.souls),tick=f.host.engine.world.tick;
  t.mock.method(f.souls,'acceptLifecycleCreate',(...args:Parameters<typeof f.souls.acceptLifecycleCreate>)=>{const op=create(...args);f.host.drainInputs();return op;});
  const response=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Terminal Alice',description:'local'})});
  assert.equal(response.status,200);const birthBody=await response.json() as {lifecycle:unknown;ok?:unknown};assert.equal(birthBody.ok,undefined);const birth=soulLifecycleSchema.parse(birthBody.lifecycle);assert.equal(birth.state,'admitted');assert.equal(birth.ready,true);assert.ok(birth.fact);
  t.mock.method(f.souls,'acceptLifecycleRetire',(...args:Parameters<typeof f.souls.acceptLifecycleRetire>)=>{const op=retire(...args);f.host.drainInputs();queueMicrotask(()=>f.host.drainInputs());return op;});
  const deleted=await remove(f,birth.soulId,true);assert.equal(deleted.status,200);const deathBody=await deleted.json() as {lifecycle:unknown;ok?:unknown};assert.equal(deathBody.ok,undefined);const death=soulLifecycleSchema.parse(deathBody.lifecycle);assert.equal(death.state,'retired');assert.ok(death.fact);assert.equal(f.host.engine.world.entities[birth.entityId],undefined);assert.equal(f.host.engine.world.tick,tick);
});

test('actual HTTP history traverses21 native producer operations exactly once with authorized opaque cursor',async t=>{
  const f=await local();t.after(()=>f.db.close());await invite(f,'bob');
  for(let i=0;i<10;i++){
    const soul=await admitted(f,'History '+i);f.souls.acceptLifecycleRetire('dev:alice',soul);f.host.drainInputs();await delay(0);f.host.drainInputs();await delay(0);
  }
  await admitted(f,'History last');
  const first=await f.app.request('/v1/lifecycle',{headers:{authorization:'Bearer dev:alice'}});assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');const page=ownerLifecycleListSchema.parse(await first.json());assert.equal(page.requests.length,20);assert.ok(page.nextCursor);
  const second=await f.app.request('/v1/lifecycle?cursor='+page.nextCursor,{headers:{authorization:'Bearer dev:alice'}});assert.equal(second.status,200);const last=ownerLifecycleListSchema.parse(await second.json());assert.equal(last.requests.length,1);assert.equal(last.nextCursor,null);
  const ids=[...page.requests,...last.requests].map(op=>op.requestId);assert.equal(new Set(ids).size,21);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='birth').length,11);
  assert.equal((await f.app.request('/v1/lifecycle?cursor='+page.nextCursor,{headers:{authorization:'Bearer dev:bob'}})).status,404);
  const admin=await f.app.request('/v1/lifecycle?owner=dev:alice&cursor='+page.nextCursor,{headers:{authorization:'Bearer dev:admin'}});assert.equal(admin.status,200);assert.deepEqual(ownerLifecycleListSchema.parse(await admin.json()).requests.map(op=>op.requestId),last.requests.map(op=>op.requestId));
});
