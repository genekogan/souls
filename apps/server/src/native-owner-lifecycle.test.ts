// Baseline qualification and explicit fault reproductions; no runtime/policy fixes.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { setImmediate } from 'node:timers/promises';
import { kernelHash } from '@souls/kernel';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { Db } from './db.ts';
import { WorldHost, replayFromGenesis } from './world.ts';
import { fixture, factory, seed, worldId, invite, accept } from '../test/native-owner-fixture.ts';

function local(t:TestContext) {
  const dir=mkdtempSync(join(tmpdir(),'eden-core-owner-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'world.sqlite'),f=fixture(path); t.after(()=>f.db.close()); return {...f,path};
}
function bodyIds(host:WorldHost) { return Object.values(host.engine.world.entities).filter(e=>e.kind==='human').map(e=>e.id).sort(); }
async function create(f:ReturnType<typeof fixture>,owner:string,name:string) {
  const r=await accept(f.host,f.request('/v1/souls',{name,description:'local owner fixture'},owner));
  assert.equal(r.status,200); return (await r.json() as {soul:{id:string;entityId:string}}).soul;
}

test('two invited ordinary owners get actual native bodies, kernel links and private HTTP isolation',async t=>{
  const f=local(t);
  assert.equal((await f.request('/v1/souls',{name:'Before invite',description:'local'})).status,403);
  await invite(f,'alice');await invite(f,'bob');
  const a=await create(f,'alice','Alice'),b=await create(f,'bob','Bob');
  assert.deepEqual(bodyIds(f.host),[a.entityId,b.entityId].sort());
  for(const [owner,soul,other] of [['alice',a,b],['bob',b,a]] as const){
    const row=f.db.soul(soul.id)!; assert.equal(row.owner,`dev:${owner}`);assert.equal(row.native,0);
    assert.equal(f.host.engine.world.entities[soul.entityId].human!.soul,soul.id);
    assert.equal(f.host.kernel.things[soul.id].traits.body,soul.entityId);assert.ok(f.host.minds.has(soul.id));
    assert.equal((await f.request(`/v1/souls/${soul.id}/perceive`,undefined,owner)).status,200);
    for(const tail of ['','/perceive','/timeline','/mandate'])assert.equal((await f.request(`/v1/souls/${other.id}${tail}`,undefined,owner)).status,403);
    assert.equal((await f.request(`/v1/souls/${other.id}/command`,{text:'wander'},owner)).status,403);
    const me=await (await f.request('/v1/me',undefined,owner)).json() as {souls:{id:string}[]};assert.deepEqual(me.souls.map(s=>s.id),[soul.id]);
  }
  const p=f.host.engine.world.entities[a.entityId].pose.p,q=f.host.engine.world.entities[b.entityId].pose.p;
  assert.ok(Math.hypot(p[0]-q[0],p[2]-q[2])>=.8);assert.equal(f.db.paidCost(),0);
});

test('ordinary owner direction produces native movement; exact tick restart and model-free replay agree',async t=>{
  const f=local(t);await invite(f,'alice');const a=await create(f,'alice','Alice');
  const m=f.host.minds.get(a.id)!;m.nextEvalTick=1e9;
  const before=[...f.host.engine.world.entities[a.entityId].pose.p];
  const command=await accept(f.host,f.request(`/v1/souls/${a.id}/intent`,{intent:{goal:'wander',text:'wander in the field'}}));assert.equal(command.status,200);
  await f.brain.evaluate(m,'owner-fixture');f.host.drainInputs();m.nextEvalTick=1e9;
  for(let i=0;i<160;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
  assert.notDeepEqual(f.host.engine.world.entities[a.entityId].pose.p,before);
  assert.ok(f.db.events(worldId).some(e=>e.kind==='decision'&&e.payload.soulId===a.id));
  void f.host.enqueue('rules','fixture',{checkpoint:'exact lifecycle tick'});f.host.drainInputs();
  const restarted=new WorldHost(f.db,factory,seed,1e9,worldId);restarted.boot();
  assert.equal(restarted.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restarted.kernel),kernelHash(f.host.kernel));
  const replay=replayFromGenesis(factory,seed,f.db.events(worldId),f.host.engine.world.tick);
  assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(replay.kernel),kernelHash(f.host.kernel));assert.equal(f.db.paidCost(),0);
});

test('discarded completed create response refreshes one identity; same-name retry refuses rather than duplicates',async t=>{
  const f=local(t);await invite(f,'alice');
  // Deliberately discard the HTTP response, not an actual socket-disconnect test.
  assert.equal((await accept(f.host,f.request('/v1/souls',{name:'Alice',description:'local'}))).status,200);
  const me=await (await f.request('/v1/me')).json() as {souls:{id:string;entityId:string}[]};assert.equal(me.souls.length,1);
  const retry=await f.request('/v1/souls',{name:'alice',description:'local'});assert.equal(retry.status,409);
  assert.deepEqual(bodyIds(f.host),[me.souls[0].entityId]);assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);
});

test('actual local socket loss after accepted birth recovers identity by owner refresh and refuses duplicate retry',async t=>{
  const f=local(t);await invite(f,'alice');let dropped=false;
  const server=createServer(getRequestListener(async(request,env)=>{
    const response=await f.app.fetch(request);
    if(!dropped&&request.method==='POST'&&new URL(request.url).pathname==='/v1/souls'){
      dropped=true;env.incoming.socket.destroy(); // Real accepted HTTP reply never reaches the client.
    }
    return response;
  }));
  t.after(()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();}));
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  const headers={authorization:'Bearer dev:alice','content-type':'application/json'};
  const lost=fetch(origin+'/v1/souls',{method:'POST',headers,body:JSON.stringify({name:'Socket Alice',description:'local'})});
  let failure:unknown;await accept(f.host,lost.catch(error=>{failure=error;}));
  assert.ok(failure instanceof TypeError);assert.equal(dropped,true);
  const refreshed=await fetch(origin+'/v1/me',{headers});assert.equal(refreshed.status,200);
  const me=await refreshed.json() as {souls:{id:string;entityId:string}[]};assert.equal(me.souls.length,1);
  assert.deepEqual(bodyIds(f.host),[me.souls[0].entityId]);assert.equal(f.host.kernel.things[me.souls[0].id].traits.body,me.souls[0].entityId);
  const retry=await fetch(origin+'/v1/souls',{method:'POST',headers,body:JSON.stringify({name:'Socket Alice',description:'local'})});
  assert.equal(retry.status,409);assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);
});

for(const boundary of ['row','birth','applied','retire-row'])test(`actual process exit at ${boundary}: durable lifecycle baseline`,t=>{
  const dir=mkdtempSync(join(tmpdir(),'eden-core-owner-exit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'world.sqlite');const result=spawnSync(process.execPath,[new URL('../test/native-owner-exit.ts',import.meta.url).pathname,path,boundary],{encoding:'utf8',timeout:20_000});
  assert.equal(result.error,undefined);assert.equal(result.status,23,result.stderr);
  const db=new Db(path);t.after(()=>db.close());const births=db.events(worldId).filter(e=>e.kind==='birth');
  const row=db.db.prepare('SELECT * FROM souls').get() as {id:string;entity_id:string;retired_at:number|null};assert.ok(row);
  const restarted=new WorldHost(db,factory,seed,1e9,worldId);restarted.boot();
  if(boundary==='row'){
    assert.equal(births.length,0);assert.equal(bodyIds(restarted).length,0);assert.equal(db.soulsOf('dev:alice').length,1);
    assert.equal(restarted.minds.has(row.id),false); // Reproduced orphan: not safe admission.
  }else{
    assert.equal(births.length,1);assert.deepEqual(bodyIds(restarted),[row.entity_id]);assert.equal(restarted.minds.has(row.id),true);
    if(boundary==='retire-row'){
      assert.notEqual(row.retired_at,null);assert.equal(db.soulsOf('dev:alice').length,0);
      assert.equal(db.events(worldId).some(e=>e.kind==='retire'),false); // Retired row, replayed body remains.
    }else assert.equal(row.retired_at,null);
  }
  assert.equal(db.paidCost(),0);
});

test('genuine native arrival refusal after durable birth remains an unattributable fault on restart',async t=>{
  // Deliberately invalid physical arrival outside the actual greenfield domain.
  // This exercises the real placer, not population capacity or a mocked spawn throw.
  const bad=await marsFactory({...GREEN_FIELD_WORLD,arrival:[500,500],reference:[501,500]});
  const f=fixture(':memory:',bad);t.after(()=>f.db.close());await invite(f,'alice');
  // arrival-search/1 would name a spot nearby; hold it to "no ground" so the birth carries no hint and the placer refuses.
  // The restarted host needs no stub: replay never searches, it re-runs the recorded (hint-free) birth.
  (f.host.engine as unknown as {arrivalSearchV1():null}).arrivalSearchV1=()=>null;
  const creating=f.souls.create('dev:alice',{name:'Alice',description:'isolated refused arrival'});void creating;
  assert.throws(()=>f.host.drainInputs(),/Engine fault has no attributable card:.*no free standing room/);
  assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);assert.equal(bodyIds(f.host).length,0);
  const restarted=new WorldHost(f.db,bad,seed,1e9,worldId);assert.throws(()=>restarted.boot(),/no free standing room/);
  assert.equal(f.db.soulsOf('dev:alice').length,1);assert.equal(f.db.paidCost(),0);
});

test('completed retirement denies access, removes the native actor and survives restart without removing the other owner',async t=>{
  const f=local(t);await invite(f,'alice');await invite(f,'bob');const a=await create(f,'alice','Alice'),b=await create(f,'bob','Bob');
  const result=await accept(f.host,f.request(`/v1/souls/${a.id}`,undefined,'alice','DELETE'));assert.equal(result.status,200);
  for(let i=0;i<80&&f.host.engine.world.entities[a.entityId];i++)f.host.tickOnce();
  assert.deepEqual(bodyIds(f.host),[b.entityId]);assert.equal(f.host.minds.has(a.id),false);
  assert.equal((await f.request(`/v1/souls/${a.id}/perceive`)).status,404);
  assert.equal((await f.request(`/v1/souls/${b.id}/perceive`,undefined,'bob')).status,200);
  void f.host.enqueue('rules','fixture',{checkpoint:'retired lifecycle tick'});f.host.drainInputs();
  const restarted=new WorldHost(f.db,factory,seed,1e9,worldId);restarted.boot();
  assert.deepEqual(bodyIds(restarted),[b.entityId]);assert.equal(restarted.minds.has(a.id),false);
  assert.equal(restarted.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restarted.kernel),kernelHash(f.host.kernel));
});
