import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { kernelHash } from '@souls/kernel';
import { Db } from './db.ts';
import { WorldHost,replayFromGenesis } from './world.ts';

test('opt-in replay includes same-head birth/retirement in sequence order, without stepping or changing legacy default',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const host=new WorldHost(db,toyFactory,'inclusive-head',1e9);host.boot();host.drainInputs();
  const birth=host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'owner',name:'Alice',description:'local'});host.drainInputs();await birth;
  assert.equal(replayFromGenesis(toyFactory,'inclusive-head',db.events(host.worldId),0).engine.world.entities.h_A,undefined);
  const atBirth=replayFromGenesis(toyFactory,'inclusive-head',db.events(host.worldId),0,{includeHeadEvents:true});
  assert.equal(atBirth.engine.world.tick,0);assert.equal(atBirth.engine.stateHash(),host.engine.stateHash());assert.equal(kernelHash(atBirth.kernel),kernelHash(host.kernel));
  for(let i=0;i<8;i++)host.tickOnce();const removal=host.enqueue('retire','fixture',{soulId:'s_A',entityId:'h_A'});host.drainInputs();await removal;
  const legacy=replayFromGenesis(toyFactory,'inclusive-head',db.events(host.worldId),8),inclusive=replayFromGenesis(toyFactory,'inclusive-head',db.events(host.worldId),8,{includeHeadEvents:true});
  assert.ok(legacy.engine.world.entities.h_A);assert.equal(inclusive.engine.world.entities.h_A,undefined);assert.equal(inclusive.engine.world.tick,8);
  assert.equal(inclusive.engine.stateHash(),host.engine.stateHash());assert.equal(kernelHash(inclusive.kernel),kernelHash(host.kernel));
  host.tickOnce();const future=host.enqueue('birth','fixture',{soulId:'s_B',entityId:'h_B',owner:'owner',name:'Bob',description:'future'});host.drainInputs();await future;
  const bounded=replayFromGenesis(toyFactory,'inclusive-head',db.events(host.worldId),8,{includeHeadEvents:true});assert.equal(bounded.engine.world.entities.h_B,undefined);
});
