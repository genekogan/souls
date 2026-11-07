import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { soulLifecycleSchema,ownerLifecycleListSchema,type SoulLifecycle } from '@souls/protocol';
import { fixture,invite } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
function local(){const f=fixture(':memory:',factory);f.souls.enableLifecycle();return f;}
async function request(f:ReturnType<typeof fixture>,path:string,data?:unknown,owner='alice',method=data===undefined?'GET':'POST',optIn=false){
  return await f.app.request(path,{method,headers:{host:'127.0.0.1:4956',authorization:'Bearer dev:'+owner,
    ...(data===undefined?{}:{'content-type':'application/json'}),...(optIn?{'X-Sim-Lifecycle':'1'}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
}
async function drive<T>(f:ReturnType<typeof fixture>,promise:Promise<T>){
  let done=false;promise.then(()=>done=true,()=>done=true);const deadline=performance.now()+4000;
  while(!done&&performance.now()<deadline){f.host.drainInputs();await delay(10);}
  assert.ok(done,'actual HTTP request settles while the native host drains');return await promise;
}
async function receipt(response:Response){const value=await response.json() as {lifecycle:SoulLifecycle};return soulLifecycleSchema.parse(value.lifecycle);}
async function create(f:ReturnType<typeof fixture>,name='Alice',owner='alice'){
  const response=await request(f,'/v1/souls',{name,description:'local owner fixture'},owner,'POST',true);assert.equal(response.status,202);return receipt(response);
}
async function me(f:ReturnType<typeof fixture>,owner='alice'){return await (await request(f,'/v1/me',undefined,owner)).json() as {me:{souls:string[]};souls:{id:string}[];lifecycleRequests:{requests:SoulLifecycle[]}};}

test('actual opt-in HTTP pending is private and unplayable; admission refresh produces a strict usable identity',async t=>{
  const f=local();t.after(()=>f.db.close());await invite(f,'alice');await invite(f,'bob');
  const pending=await create(f);assert.equal(pending.state,'pending');assert.equal(pending.ready,false);assert.equal(f.host.engine.world.entities[pending.entityId],undefined);
  const before=await me(f);assert.deepEqual(before.souls,[]);assert.deepEqual(before.me.souls,[]);assert.equal(before.lifecycleRequests.requests[0].requestId,pending.requestId);
  for(const [path,data,method] of [[`/v1/souls/${pending.soulId}/pair`,{},'POST'],[`/v1/souls/${pending.soulId}/command`,{text:'wander'},'POST'],[`/v1/souls/${pending.soulId}`,undefined,'DELETE']] as const){
    const response=await request(f,path,data,'alice',method);assert.equal(response.status,409);assert.equal((await response.json() as {code:string}).code,'not-in-world');
  }
  assert.equal(f.souls.lifecycle!.journal.ownerPage(f.host.worldId,'dev:alice').operations.length,1);
  f.host.drainInputs();const response=await request(f,`/v1/lifecycle/${pending.requestId}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const admitted=await receipt(response);assert.equal(admitted.state,'admitted');assert.equal(admitted.ready,true);assert.ok(admitted.fact);
  const after=await me(f);assert.deepEqual(after.souls.map(s=>s.id),[pending.soulId]);assert.deepEqual(after.me.souls,[pending.soulId]);
  const pair=await request(f,`/v1/souls/${pending.soulId}/pair`,{},'alice','POST');assert.equal(pair.status,200);
  assert.equal(f.db.paidCost(),0);
});

test('actual private receipt/history reads use uniform foreign/unknown/world/ineligible404 and current admin role',async t=>{
  const f=local();t.after(()=>f.db.close());await invite(f,'alice');await invite(f,'bob');const pending=await create(f);
  const unknown='lc_'+'f'.repeat(32),foreignWorld='other-local';f.db.createWorld({id:foreignWorld,schema:'local',rules_version:factory.rulesVersion,dt:.05,seed:'other'});
  f.souls.lifecycle!.journal.acceptCreate({worldId:foreignWorld,soulId:'s_other',entityId:'h_other',owner:'dev:alice'},unknown,{name:'Other world',description:'private',native:false},()=>true);
  const failures=[await request(f,`/v1/lifecycle/${pending.requestId}`,undefined,'bob'),await request(f,`/v1/lifecycle/${unknown}`),await request(f,'/v1/lifecycle/not-valid'),await request(f,`/v1/lifecycle?cursor=lc1_${unknown}`),await request(f,'/v1/lifecycle?cursor='),await request(f,'/v1/lifecycle?owner=dev:alice',undefined,'bob')];
  for(const response of failures){assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{ok:false,code:'not-found',message:'no such lifecycle'});}
  assert.equal((await request(f,`/v1/lifecycle/${pending.requestId}`,undefined,'admin')).status,200);
  const page=await request(f,'/v1/lifecycle?owner=dev:alice',undefined,'admin');assert.equal(page.status,200);assert.equal(ownerLifecycleListSchema.parse(await page.json()).requests.length,1);
  f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();assert.equal((await request(f,`/v1/lifecycle/${pending.requestId}`,undefined,'admin')).status,404);
  f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();assert.equal((await request(f,`/v1/lifecycle/${pending.requestId}`)).status,404);assert.deepEqual((await me(f)).lifecycleRequests.requests,[]);
});

test('legacy create returns terminal success only; a real two-second unconfirmed wait returns503 with private refresh',async t=>{
  const f=local();t.after(()=>f.db.close());await invite(f,'alice');
  const ready=await drive(f,request(f,'/v1/souls',{name:'Confirmed',description:'local'}));assert.equal(ready.status,200);
  const legacy=await ready.json() as {ok:boolean;soul:{id:string;entityId:string}};assert.equal(legacy.ok,true);assert.ok(f.host.engine.world.entities[legacy.soul.entityId]);assert.equal(f.souls.controlReady(f.db.soul(legacy.soul.id)!),true);
  const start=performance.now(),pending=await request(f,'/v1/souls',{name:'Waiting',description:'local'});const elapsed=performance.now()-start;
  assert.equal(pending.status,503);assert.ok(elapsed>=1900&&elapsed<5000,'actual bounded real wait');assert.equal(pending.headers.get('cache-control'),'no-store');
  const result=await pending.json() as {ok:boolean;code:string;lifecycle:SoulLifecycle};assert.equal(result.ok,false);assert.equal(result.code,'lifecycle-pending');assert.equal(soulLifecycleSchema.parse(result.lifecycle).state,'pending');assert.equal(f.db.soulsOf('dev:alice').length,2);
  f.host.drainInputs();const recovered=await receipt(await request(f,`/v1/lifecycle/${result.lifecycle.requestId}`));assert.equal(recovered.ready,true);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='birth').length,2);
});

test('retirement acceptance and actual removal refresh preserve the saved birth fact and deny tokens/pair delivery',async t=>{
  const f=local();t.after(()=>f.db.close());await invite(f,'alice');const pending=await create(f);f.host.drainInputs();
  const birth=await receipt(await request(f,`/v1/lifecycle/${pending.requestId}`)),fact=structuredClone(birth.fact);
  const paired=await request(f,`/v1/souls/${birth.soulId}/pair`,{},'alice','POST'),pair=await paired.json() as {code:string};
  const exchanged=await request(f,'/v1/agent/pair',{code:pair.code,agent:'local'});assert.equal(exchanged.status,200);const token=(await exchanged.json() as {token:string}).token;assert.ok(f.souls.soulFromToken(token));
  const pendingPair=await request(f,`/v1/souls/${birth.soulId}/pair`,{},'alice','POST'),newCode=(await pendingPair.json() as {code:string}).code;
  const response=await request(f,`/v1/souls/${birth.soulId}`,undefined,'alice','DELETE',true);assert.equal(response.status,202);const retiring=await receipt(response);assert.equal(retiring.state,'retiring');assert.ok(f.host.engine.world.entities[birth.entityId]);assert.equal(f.souls.soulFromToken(token),null);
  assert.equal((await request(f,'/v1/agent/pair',{code:newCode,agent:'late'})).status,404);
  const accepted=await receipt(await request(f,`/v1/lifecycle/${birth.requestId}`));assert.deepEqual(accepted.fact,fact);assert.equal(accepted.revision,birth.revision+1);assert.equal(accepted.reason,'retirement-accepted');assert.deepEqual(accepted.allocation,{countsTowardLimit:false,reservesName:false});assert.equal(accepted.ready,false);
  assert.deepEqual((await me(f)).souls,[]);f.host.drainInputs();
  // The committed removal settles before the installer queues its terminal
  // checkpoint. Drain that separate acceptance without advancing world time.
  await delay(0);f.host.drainInputs();
  const removed=await receipt(await request(f,`/v1/lifecycle/${retiring.requestId}`));assert.equal(removed.state,'retired');assert.ok(removed.fact);assert.equal(f.host.engine.world.entities[birth.entityId],undefined);
  const historical=await receipt(await request(f,`/v1/lifecycle/${birth.requestId}`));assert.deepEqual(historical,accepted);
});

test('actual native refusal returns409/no birth, releases logical reservation and keeps private operation readable',async t=>{
  const bad=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true,arrival:[500,500],reference:[501,500]}),f=fixture(':memory:',bad);f.souls.enableLifecycle();t.after(()=>f.db.close());await invite(f,'alice');
  // arrival-search/1 admits an off-world arrival nearby; hold the search to "no ground" so this stays a genuine refusal
  (f.host.engine as unknown as {arrivalSearchV1():null}).arrivalSearchV1=()=>null;
  const response=await request(f,'/v1/souls',{name:'Unavailable',description:'local'},'alice','POST',true);assert.equal(response.status,409);const op=await receipt(response);assert.equal(op.state,'refused');assert.equal(f.db.events(f.host.worldId).some(e=>e.kind==='birth'),false);assert.equal(f.db.soulsOf('dev:alice').length,0);
  assert.deepEqual(await receipt(await request(f,`/v1/lifecycle/${op.requestId}`)),op);for(let i=0;i<40;i++)f.host.tickOnce();assert.equal(f.host.engine.world.tick,40);assert.equal(f.db.paidCost(),0);
});

test('concurrent local HTTP requests enforce hidden pending count and case-insensitive name atomically',async t=>{
  const f=local();t.after(()=>f.db.close());await invite(f,'alice');f.souls.cfg.maxSoulsPerUser=2;
  const names=await Promise.all([request(f,'/v1/souls',{name:'Alice',description:'local'},'alice','POST',true),request(f,'/v1/souls',{name:'alice',description:'local'},'alice','POST',true)]);assert.deepEqual(names.map(r=>r.status).sort(),[202,409]);
  const count=await Promise.all([request(f,'/v1/souls',{name:'Bob',description:'local'},'alice','POST',true),request(f,'/v1/souls',{name:'Carol',description:'local'},'alice','POST',true)]);assert.deepEqual(count.map(r=>r.status).sort(),[202,409]);
  assert.equal(f.db.soulsOf('dev:alice').length,2);assert.deepEqual((await me(f)).souls,[]);assert.equal((await me(f)).lifecycleRequests.requests.length,2);
});

test('valid legacy canonical identity remains usable without a fabricated operation; orphan row does not',async t=>{
  const f=fixture(':memory:',factory);t.after(()=>f.db.close());await invite(f,'alice');
  const old=await drive(f,request(f,'/v1/souls',{name:'Legacy',description:'local'}));assert.equal(old.status,200);const soul=(await old.json() as {soul:{id:string}}).soul;
  f.db.createSoul({id:'s_orphan',worldId:f.host.worldId,owner:'dev:alice',entityId:'h_orphan',name:'Orphan',description:'local',native:false});f.souls.enableLifecycle();
  assert.equal(f.souls.controlReady(f.db.soul(soul.id)!),true);assert.equal(f.souls.controlReady(f.db.soul('s_orphan')!),false);assert.equal((await request(f,`/v1/souls/${soul.id}/perceive`)).status,200);
  assert.equal((await request(f,'/v1/souls/s_orphan/perceive')).status,409);const refreshed=await me(f);assert.deepEqual(refreshed.souls.map(s=>s.id),[soul.id]);assert.deepEqual(refreshed.lifecycleRequests.requests,[]);
});

test('unsupported opt-in and malformed input accept no private operation or allocation',async t=>{
  const f=fixture(':memory:',factory);t.after(()=>f.db.close());await invite(f,'alice');
  assert.equal((await request(f,'/v1/souls',{name:'Disabled',description:'local'},'alice','POST',true)).status,400);
  assert.equal((await request(f,'/v1/lifecycle')).status,404);
  f.souls.enableLifecycle();
  const unsupported=await f.app.request('/v1/souls',{method:'POST',headers:{host:'127.0.0.1:4956',authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'2'},body:JSON.stringify({name:'Unsupported',description:'local'})});
  assert.equal(unsupported.status,400);
  assert.equal((await request(f,'/v1/souls',{name:'',description:'local'},'alice','POST',true)).status,400);
  assert.equal(f.db.soulsOf('dev:alice').length,0);
  assert.equal(f.souls.lifecycle!.journal.ownerPage(f.host.worldId,'dev:alice').operations.length,0);
});

test('invitation withdrawal fences pending admission and a stale legacy response; reinstatement reconciles the same identity',async t=>{
  const f=local();t.after(()=>f.db.close());await invite(f,'alice');
  const response=request(f,'/v1/souls',{name:'Authority',description:'local'});
  await delay(30);f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  assert.equal((await response).status,404);
  const pending=f.souls.lifecycle!.journal.ownerPage(f.host.worldId,'dev:alice').operations[0];assert.ok(pending);
  f.host.drainInputs();await delay(0);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='birth').length,0);
  assert.equal(f.souls.lifecycle!.faults.size,0);
  assert.equal(f.db.soulsOf('dev:alice').length,1);
  assert.equal((await request(f,`/v1/lifecycle/${pending.requestId}`)).status,404);
  f.db.setInvited('dev:alice','local-fixture-restored');f.souls.lifecycle!.pump();f.host.drainInputs();await delay(0);
  const admitted=await receipt(await request(f,`/v1/lifecycle/${pending.requestId}`));
  assert.equal(admitted.ready,true);assert.equal(admitted.soulId,pending.scope.soulId);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='birth').length,1);
});

test('real HTTP socket loss after durable pending acceptance recovers by private Me and exact receipt without a write retry',async t=>{
  const f=local();t.after(()=>f.db.close());await invite(f,'alice');let dropped=false;
  const server=createServer(getRequestListener(async (incoming,env)=>{
    const response=await f.app.fetch(incoming);
    if(!dropped&&incoming.method==='POST'&&new URL(incoming.url).pathname==='/v1/souls'&&response.status===202){
      dropped=true;env.incoming.socket.destroy();
    }
    return response;
  }));
  t.after(()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();}));
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  const headers={authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'};
  const lost=await fetch(origin+'/v1/souls',{method:'POST',headers,body:JSON.stringify({name:'Lost reply',description:'local'})}).then(()=>false,()=>true);
  assert.equal(dropped,true);assert.equal(lost,true);
  const refreshed=await fetch(origin+'/v1/me',{headers});assert.equal(refreshed.status,200);assert.equal(refreshed.headers.get('cache-control'),'no-store');
  const recovered=await refreshed.json() as {souls:unknown[];lifecycleRequests:unknown};assert.deepEqual(recovered.souls,[]);
  const page=ownerLifecycleListSchema.parse(recovered.lifecycleRequests);assert.equal(page.requests.length,1);
  const pending=page.requests[0];assert.equal(pending.state,'pending');f.host.drainInputs();await delay(0);
  const exact=await fetch(`${origin}/v1/lifecycle/${pending.requestId}`,{headers});const admitted=await receipt(exact);
  assert.equal(admitted.ready,true);assert.equal(admitted.soulId,pending.soulId);assert.equal(admitted.entityId,pending.entityId);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='birth').length,1);
  assert.equal(f.souls.lifecycle!.journal.ownerPage(f.host.worldId,'dev:alice').operations.length,1);
  assert.equal(JSON.stringify(f.db.events(f.host.worldId)).includes(pending.requestId),false);
  assert.equal(f.db.paidCost(),0);
});
