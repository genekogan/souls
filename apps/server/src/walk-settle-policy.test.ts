import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,MARS_2026_MAP} from '@souls/engine-mars';
import {Db} from './db.ts';
import {WorldHost,replayFromGenesis} from './world.ts';
import {kernelHash} from '@souls/kernel';
const {installWalkSettleWaitV1}=await import(new URL('../../../tools/core/multiworld/world-server.mjs',import.meta.url).href) as {
 installWalkSettleWaitV1(host:WorldHost,enabled:unknown,drive:<T>(p:Promise<T>)=>Promise<T>):Promise<{policy:string;worldId:string;seq:number;tick:number;alreadyAccepted:boolean}|undefined>;
};
const factory=await marsFactory({scene:'eden-camp',arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Grounds'},map:MARS_2026_MAP,disassemblyV1:true});
test('walk settle policy is accepted once, survives snapshots/genesis replay and native compaction',async()=>{
 const db=new Db(':memory:'),host=new WorldHost(db,factory,'settle-policy',1e9,'settle-policy');host.boot();
 try{
  const old=host.engine.snapshot() as any;assert.equal(Object.hasOwn(old.cfg,'walkSettleWaitV1'),false);assert.equal((host.engine as any).rt.services.walkSettleWaitV1,undefined);
  const base=host.enqueue('rules','fixture',{runtimePolicy:{sleepBlockTicks:321,quietSeatCourtesy:false}});host.drainInputs();await base;
  const acceptance=host.enableWalkSettleWaitV1();host.drainInputs();const fact=await acceptance;
  assert.equal(fact.kind,'rules');assert.deepEqual(fact.payload.runtimePolicy,{sleepBlockTicks:321,quietSeatCourtesy:false,walkSettleWaitV1:true});
  assert.notEqual(host.engine.stateHash(),old.stateHash,'accepted policy has canonical engine identity');
  const head=host.seq;assert.equal((await host.enableWalkSettleWaitV1()).seq,fact.seq);assert.equal(host.seq,head);
  for(let i=0;i<20;i++)host.tickOnce();host.saveSnapshot();
  const cold=new WorldHost(db,factory,host.seed,1e9,host.worldId);assert.equal(cold.boot().from,'snapshot');
  assert.equal(cold.engine.stateHash(),host.engine.stateHash());assert.equal((cold.engine as any).rt.services.walkSettleWaitV1,true);
  const replay=replayFromGenesis(factory,host.seed,db.events(host.worldId),host.engine.world.tick);
  assert.equal(replay.engine.stateHash(),host.engine.stateHash());assert.equal(kernelHash(replay.kernel),kernelHash(host.kernel));
  for(let i=0;i<20;i++){host.tickOnce();cold.tickOnce();assert.equal(cold.engine.stateHash(),host.engine.stateHash());}
  host.engine.beginQuiet!();assert.equal(host.engine.isQuiet!(),true);host.engine.compact!();
  assert.equal((host.engine as any).rt.services.walkSettleWaitV1,true);assert.equal((host.engine.snapshot() as any).cfg.walkSettleWaitV1,true);
  assert.deepEqual(host.engine.runtime.violations,[]);cold.stop();
 }finally{host.stop();db.close();}
});

test('native launcher opt-in refuses malformed flag and absent/false preserve history; true is idempotent',async()=>{
 const db=new Db(':memory:'),host=new WorldHost(db,factory,'settle-flag',1e9,'settle-flag');host.boot();
 const drive=async<T>(p:Promise<T>)=>{host.drainInputs();return p;};
 try{
  const before=host.seq,hash=host.engine.stateHash(),snapshot=JSON.stringify(host.engine.snapshot());
  assert.equal(await installWalkSettleWaitV1(host,undefined,drive),undefined);
  assert.equal(await installWalkSettleWaitV1(host,false,drive),undefined);
  await assert.rejects(installWalkSettleWaitV1(host,'true',drive),/world.walk-settle-wait-flag/);
  assert.equal(host.seq,before);assert.equal(host.engine.stateHash(),hash);assert.equal(JSON.stringify(host.engine.snapshot()),snapshot);
  await assert.rejects(installWalkSettleWaitV1(host,true,drive),/runtime-policy.walk-settle-base-required/);
  assert.equal(host.seq,before);assert.equal(host.engine.stateHash(),hash);assert.equal(JSON.stringify(host.engine.snapshot()),snapshot);
  const base=await drive(host.enqueue('rules','fixture',{runtimePolicy:{sleepBlockTicks:987,quietSeatCourtesy:false}}));
  const acceptedBase=structuredClone(host.extra.runtimePolicy);
  host.extra.runtimePolicy={sleepBlockTicks:0};const baseHead=host.seq,baseHash=host.engine.stateHash();
  assert.throws(()=>host.enableWalkSettleWaitV1(),/runtime-policy.walk-settle-base-required/);assert.equal(host.seq,baseHead);assert.equal(host.engine.stateHash(),baseHash);
  host.extra.runtimePolicy={sleepBlockTicks:123};
  assert.throws(()=>host.enableWalkSettleWaitV1(),/runtime-policy.accepted-base-fact-missing/);assert.equal(host.seq,baseHead);assert.equal(host.engine.stateHash(),baseHash);
  host.extra.runtimePolicy=acceptedBase;
  const first=await installWalkSettleWaitV1(host,true,drive);assert.equal(first?.alreadyAccepted,false);
  const head=host.seq,second=await installWalkSettleWaitV1(host,true,drive);
  assert.equal(second?.alreadyAccepted,true);assert.equal(second?.seq,first?.seq);assert.equal(host.seq,head);
  assert.equal((host.engine.snapshot() as any).cfg.walkSettleWaitV1,true);
  assert.equal((host.engine.snapshot() as any).cfg.sleepBlockTicks,base.payload.runtimePolicy.sleepBlockTicks);
  assert.deepEqual(host.extra.runtimePolicy,{sleepBlockTicks:987,quietSeatCourtesy:false,walkSettleWaitV1:true});
 }finally{host.stop();db.close();}
});
