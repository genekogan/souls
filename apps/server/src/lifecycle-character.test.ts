import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelHash } from '@souls/kernel';
import { WorldHost,replayFromGenesis } from './world.ts';
import { lifecycleBodyReady,projectLifecycle } from './lifecycle-runner.ts';
import { fixture,settle,factory,seed,worldId,scope,requestId,input } from '../test/lifecycle-native-fixture.ts';

const character='Curious about rivers, keeps careful notes and welcomes neighbours.';
function change(host:WorldHost){return host.enqueue('rules','world',{soulId:scope.soulId,character,why:'local canonical character proof'});}

test('canonical character update preserves admitted readiness and birth evidence while real correspondence mismatches deny',async t=>{
  const f=fixture();t.after(()=>f.db.close());f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);
  const original=f.journal.get(scope,requestId)!,receipt=structuredClone(projectLifecycle(f.host,original));assert.equal(receipt.ready,true);
  const stored=f.db.db.prepare('SELECT body,body_hash FROM lifecycle_operations_v1 WHERE world_id=? AND request_id=?').get(worldId,requestId);
  for(let i=0;i<7;i++)f.host.tickOnce();const updating=change(f.host);f.host.drainInputs();await updating;
  const row=f.db.soul(scope.soulId)!,mind=f.host.minds.get(scope.soulId)!,thing=f.host.kernel.things[scope.soulId],body=f.host.engine.world.entities[scope.entityId];
  assert.equal(row.description,character);assert.equal(mind.description,character);assert.equal(thing.traits.about,character);
  assert.equal(lifecycleBodyReady(f.host,original),true);const current=projectLifecycle(f.host,original);assert.equal(current.ready,true);assert.deepEqual(current.fact,receipt.fact);assert.equal(current.revision,receipt.revision);
  assert.deepEqual(f.journal.get(scope,requestId),original);assert.equal(original.description,input.description);
  assert.deepEqual(f.db.db.prepare('SELECT body,body_hash FROM lifecycle_operations_v1 WHERE world_id=? AND request_id=?').get(worldId,requestId),stored);
  const birth=f.db.events(worldId).find(e=>e.kind==='birth')!;assert.equal(birth.payload.description,input.description);assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);
  const mismatch=(mutate:()=>void,restore:()=>void)=>{mutate();assert.equal(lifecycleBodyReady(f.host,original),false);assert.equal(projectLifecycle(f.host,original).ready,false);restore();assert.equal(lifecycleBodyReady(f.host,original),true);};
  mismatch(()=>f.db.db.prepare('UPDATE souls SET description=? WHERE id=?').run(input.description,scope.soulId),()=>f.db.db.prepare('UPDATE souls SET description=? WHERE id=?').run(character,scope.soulId));
  mismatch(()=>{mind.description=input.description;},()=>{mind.description=character;});
  mismatch(()=>{thing.traits.about=input.description;},()=>{thing.traits.about=character;});
  mismatch(()=>{mind.owner='other';},()=>{mind.owner=scope.owner;});
  mismatch(()=>{mind.entityId='h_other';},()=>{mind.entityId=scope.entityId;});
  mismatch(()=>{body.human!.soul='s_other';},()=>{body.human!.soul=scope.soulId;});
  mismatch(()=>{thing.traits.body='h_other';},()=>{thing.traits.body=scope.entityId;});
  mismatch(()=>{body.label='Wrong name';},()=>{body.label=input.name;});
  mismatch(()=>{f.host.mindByEntity.delete(scope.entityId);},()=>{f.host.mindByEntity.set(scope.entityId,mind);});
  const restart=new WorldHost(f.db,factory,seed,1e9,worldId);restart.boot();assert.equal(lifecycleBodyReady(restart,original),true);assert.equal(restart.minds.get(scope.soulId)!.description,character);
  assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));
  const replay=replayFromGenesis(factory,seed,f.db.events(worldId),f.host.engine.world.tick,{includeHeadEvents:true});assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(replay.kernel),kernelHash(f.host.kernel));assert.equal(replay.kernel.things[scope.soulId].traits.about,character);assert.equal(f.db.paidCost(),0);
});

test('canonical character change between recorded birth and private completion remains recoverably admitted',async t=>{
  const f=fixture();t.after(()=>f.db.close());f.journal.acceptCreate(scope,requestId,input,()=>true);f.runner.pump();
  const updating=change(f.host);f.host.drainInputs();await updating;assert.equal(f.journal.get(scope,requestId)!.state,'recorded');assert.equal(f.db.soul(scope.soulId)!.description,character);
  await settle(f);assert.equal(f.runner.faults.size,0);const admitted=f.journal.get(scope,requestId)!;assert.equal(admitted.state,'complete');assert.equal(projectLifecycle(f.host,admitted).ready,true);
  assert.equal(admitted.description,input.description);assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);
  const restart=new WorldHost(f.db,factory,seed,1e9,worldId);restart.boot();assert.equal(lifecycleBodyReady(restart,admitted),true);assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));assert.equal(f.db.paidCost(),0);
});
