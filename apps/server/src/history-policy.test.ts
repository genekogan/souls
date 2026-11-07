import { test,type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import type { EngineFactory } from '@souls/engine-contract';
import { kernelHash } from '@souls/kernel';
import { fixture,invite,accept } from '../test/native-owner-fixture.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
const legacy=await marsFactory(GREEN_FIELD_WORLD),candidate=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
const seed='local-history-policy',worldId='local-policy-world';
function history(t:TestContext,factory:EngineFactory,snapshot=true){
  const db=new Db(':memory:');t.after(()=>db.close());const host=new WorldHost(db,factory,seed,1e9,worldId);host.boot();host.drainInputs();
  for(let i=0;i<20;i++)host.tickOnce();void host.enqueue('rules','fixture',{checkpoint:'policy boundary'});host.drainInputs();if(snapshot)host.saveSnapshot(true);
  return {db,host};
}
function retained(db:Db){return JSON.stringify(['worlds','events','snapshots','souls','lifecycle_operations_v1','take_chunks','render_scene_captures'].map(table=>db.db.prepare(`SELECT * FROM ${table}`).all()));}
for(const direction of ['upgrade','rollback'] as const)test(`boot refuses unqualified ${direction} instead of rebuilding recorded history under another removal policy`,t=>{
  const original=direction==='upgrade'?legacy:candidate,target=direction==='upgrade'?candidate:legacy,f=history(t,original),before=retained(f.db);
  const inspected={...target,genesis:t.mock.fn(target.genesis),create:t.mock.fn(target.create),restore:t.mock.fn(target.restore)};
  assert.throws(()=>new WorldHost(f.db,inspected,seed,1e9,worldId).boot(),/history rules are incompatible/);
  for(const method of [inspected.genesis,inspected.create,inspected.restore])assert.equal(method.mock.callCount(),0);
  assert.equal(retained(f.db),before);assert.equal(f.db.paidCost(),0);
  const resumed=new WorldHost(f.db,original,seed,1e9,worldId);assert.equal(resumed.boot().from,'snapshot');
  assert.equal(resumed.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(resumed.kernel),kernelHash(f.host.kernel));assert.equal(retained(f.db),before);
});
for(const direction of ['upgrade','rollback'] as const)test(`no snapshot cannot bypass ${direction} history policy`,t=>{
  const original=direction==='upgrade'?legacy:candidate,target=direction==='upgrade'?candidate:legacy,f=history(t,original,false),before=retained(f.db);
  assert.equal(f.db.latestSnapshot(worldId),null);assert.throws(()=>new WorldHost(f.db,target,seed,1e9,worldId).boot(),/history rules are incompatible/);
  assert.equal(retained(f.db),before);assert.equal(f.db.paidCost(),0);
});
test('matching world metadata cannot hide an incompatible latest checkpoint',t=>{
  const f=history(t,legacy);f.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=?').run(candidate.rulesVersion,worldId);const before=retained(f.db);
  assert.throws(()=>new WorldHost(f.db,candidate,seed,1e9,worldId).boot(),/history rules are incompatible/);assert.equal(retained(f.db),before);
});
test('future or duplicated removal policy is not silently interpreted as current policy',()=>{
  for(const factory of [legacy,candidate])for(const version of [legacy.rulesVersion+'+crew-removal/2',candidate.rulesVersion+'+crew-removal/1'])assert.equal(factory.canReplayHistory!(version),false);
  assert.equal(legacy.canReplayHistory!(legacy.rulesVersion),true);assert.equal(candidate.canReplayHistory!(candidate.rulesVersion),true);
});
for(const [name,factory] of [['legacy',legacy],['candidate',candidate]] as const)test(`actual owned ${name} checkpoint restarts with unchanged body, history and hashes`,async t=>{
  const f=fixture(':memory:',factory);t.after(()=>f.db.close());await invite(f,'alice');let soulId:string;
  if(name==='candidate'){f.souls.enableLifecycle();const op=f.souls.acceptLifecycleCreate('dev:alice',{name:'Alice',description:'local policy checkpoint'});f.host.drainInputs();await delay(0);soulId=op.scope.soulId;}
  else {const soul=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'local policy checkpoint'}));soulId=soul.id;}
  const mind=f.host.minds.get(soulId)!;mind.nextEvalTick=1e9;for(let i=0;i<20;i++)f.host.tickOnce();f.host.saveSnapshot(true);
  const before=retained(f.db),hash=f.host.engine.stateHash(),kh=kernelHash(f.host.kernel),row=f.db.soul(soulId)!;
  const restarted=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId);assert.equal(restarted.boot().from,'snapshot');
  assert.equal(restarted.engine.stateHash(),hash);assert.equal(kernelHash(restarted.kernel),kh);assert.equal(restarted.seq,f.host.seq);
  assert.deepEqual(restarted.engine.world.entities[row.entity_id],f.host.engine.world.entities[row.entity_id]);assert.equal(restarted.minds.get(soulId)!.owner,'dev:alice');
  assert.equal(retained(f.db),before);assert.equal(f.db.paidCost(),0);
});
test('factory without a history hook retains the existing explicit genesis replay behavior',t=>{
  const f=history(t,legacy),{canReplayHistory:_unused,...existing}=candidate;
  assert.equal(new WorldHost(f.db,existing,seed,1e9,worldId).boot().from,'genesis');assert.equal(f.db.paidCost(),0);
});
