import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {ownerLifecycleCapabilitySchema,ownerLifecycleListSchema,soulLifecycleSchema} from '@souls/protocol';
import {fixture,invite} from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});

test('lifecycle capability is absent without actual installer/invitation and cannot invent a successful write',async t=>{
  const f=fixture(':memory:',factory);t.after(()=>f.db.close());await invite(f,'alice');
  const legacy=await f.request('/v1/me');assert.equal(legacy.status,200);assert.equal((await legacy.json() as any).lifecycleCapability,undefined);
  const rejected=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Alice',description:'local'})});
  assert.equal(rejected.status,400);assert.equal((await rejected.json() as any).code,'lifecycle-unavailable');assert.equal(f.db.soulsOf('dev:alice').length,0);
  f.souls.enableLifecycle();const response=await f.request('/v1/me',undefined,'bob');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json() as any;
  assert.equal(data.lifecycleCapability,undefined);assert.deepEqual(ownerLifecycleListSchema.parse(data.lifecycleRequests).requests,[]);
  const unsigned=await f.app.request('/v1/me');assert.equal(unsigned.status,401);assert.equal(unsigned.headers.get('cache-control'),'no-store');assert.equal((await unsigned.json() as any).lifecycleCapability,undefined);
});

test('actual invited owner receives selected-host capability, pending response and genuinely ready private refresh',async t=>{
  const f=fixture(':memory:',factory);f.souls.enableLifecycle();t.after(()=>f.db.close());await invite(f,'alice');await invite(f,'bob');
  f.souls.cfg.worldId='different-config-world';
  const before=await f.request('/v1/me');assert.equal(before.headers.get('cache-control'),'no-store');const data=await before.json() as any;
  const cap=ownerLifecycleCapabilitySchema.parse(data.lifecycleCapability);assert.equal(cap.worldId,f.host.worldId);assert.equal(cap.userId,data.me.userId);assert.equal(cap.userId,'dev:alice');assert.deepEqual(data.souls,[]);
  const create=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json',[cap.optIn.header]:cap.optIn.value},body:JSON.stringify({name:'Capability Alice',description:'local owner'})});
  assert.equal(create.status,202);assert.equal(create.headers.get('cache-control'),'no-store');const reply=await create.json() as any;assert.equal(reply.ok,undefined);assert.equal(reply.soul,undefined);const op=soulLifecycleSchema.parse(reply.lifecycle);assert.equal(op.worldId,cap.worldId);assert.equal(op.ready,false);assert.equal(op.state,'pending');assert.equal(f.host.engine.world.entities[op.entityId],undefined);
  const pending=await f.request('/v1/me');const waiting=await pending.json() as any;assert.deepEqual(waiting.souls,[]);assert.deepEqual(ownerLifecycleCapabilitySchema.parse(waiting.lifecycleCapability),cap);
  f.host.drainInputs();const refreshed=await f.request('/v1/lifecycle/'+op.requestId);const ready=soulLifecycleSchema.parse((await refreshed.json() as any).lifecycle);assert.equal(ready.state,'admitted');assert.equal(ready.ready,true);assert.ok(ready.fact);assert.ok(f.host.engine.world.entities[op.entityId]);assert.equal(f.db.soul(op.soulId)!.owner,cap.userId);
  const bob=await f.request('/v1/me',undefined,'bob'),other=await bob.json() as any;assert.equal(ownerLifecycleCapabilitySchema.parse(other.lifecycleCapability).userId,'dev:bob');assert.deepEqual(ownerLifecycleListSchema.parse(other.lifecycleRequests).requests,[]);assert.equal((await f.request('/v1/lifecycle/'+op.requestId,undefined,'bob')).status,404);assert.equal(f.db.paidCost(),0);
  for(const path of ['/v1/config','/v1/world','/v1/debug/world','/v1/scene','/v1/kernel','/v1/log','/v1/takes','/v1/take']){const response=await f.app.request(path);assert.equal(response.status,200,path);const text=await response.text();assert.ok(!text.includes('owner-lifecycle-capability/1'),path);assert.ok(!text.includes(op.requestId),path);}
});

for(const change of ['uninvited','deleted'] as const)test(`lifecycle capability rechecks current owner after actual Auth await: ${change}`,async t=>{
  const f=fixture(':memory:',factory);f.souls.enableLifecycle();t.after(()=>f.db.close());await invite(f,'alice');
  let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r),original=f.auth.userFromToken.bind(f.auth);
  t.mock.method(f.auth,'userFromToken',async(...args:Parameters<typeof original>)=>{const u=await original(...args);entered();await hold;return u;});
  const pending=f.request('/v1/me');await ready;if(change==='deleted')f.db.db.prepare("DELETE FROM users WHERE id='dev:alice'").run();else f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();release();
  const response=await pending;assert.equal(response.status,change==='deleted'?401:200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json() as any;assert.equal(data.lifecycleCapability,undefined);if(change==='uninvited'){assert.equal(data.me.invited,false);assert.deepEqual(data.souls,[]);assert.deepEqual(ownerLifecycleListSchema.parse(data.lifecycleRequests).requests,[]);}
});

test('lifecycle capability strict codec rejects wrong era, authority extras, headers and malformed identities',()=>{
  const valid={contract:'owner-lifecycle-capability/1',worldId:'eden-local',userId:'dev:alice',receiptContract:'soul-lifecycle/1',historyContract:'owner-lifecycle-list/1',optIn:{header:'X-Sim-Lifecycle',value:'1'}};
  assert.ok(ownerLifecycleCapabilitySchema.safeParse(valid).success);
  for(const invalid of [{...valid,contract:'owner-lifecycle-capability/2'},{...valid,ready:true},{...valid,userId:''},{...valid,worldId:'x'.repeat(129)},{...valid,optIn:{header:'X-Sim-Lifecycle',value:'2'}},{...valid,optIn:{...valid.optIn,token:'not-a-credential'}}])assert.equal(ownerLifecycleCapabilitySchema.safeParse(invalid).success,false);
});
