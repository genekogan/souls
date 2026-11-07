import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { probeNativeHumanBirth } from './birth.ts';
import type { Engine } from '@souls/engine-contract';
const factory=await marsFactory(GREEN_FIELD_WORLD);
const request={id:'h_new',label:'New',soul:'s_new'};
function saved(e:Engine){return {hash:e.stateHash(),world:JSON.stringify(e.world),records:JSON.stringify([...e.runtime.records]),scene:JSON.stringify(e.renderScene?.()),takes:JSON.stringify(e.takeChunks?.(-1))};}

test('detached native placement matches actual spawn with existing occupants and preserves all live evidence',()=>{
  const e=factory.create(factory.genesis('birth-probe'));
  e.spawnHuman({id:'h_A',label:'Alice',soul:'s_A'});e.spawnHuman({id:'h_B',label:'Bob',soul:'s_B'});
  const before=saved(e),snapshot=e.snapshot();
  const result=probeNativeHumanBirth(e,factory,request);assert.equal(result.outcome,'ready');
  for(let i=0;i<8;i++)assert.deepEqual(probeNativeHumanBirth(e,factory,request),result);
  assert.deepEqual(saved(e),before);assert.deepEqual(e.snapshot(),snapshot);
  assert.equal(Object.hasOwn(e.world.entities,'h_new'),false);
  e.spawnHuman(request);assert.ok('position'in result);assert.deepEqual(e.world.entities.h_new.pose.p,result.position);
  assert.equal(e.world.entities.h_new.human!.soul,'s_new');assert.deepEqual(e.runtime.violations,[]);
});

test('actual unavailable arrival gets detached refusal without an authoritative body or changed RNG',async()=>{
  const f=await marsFactory({...GREEN_FIELD_WORLD,arrival:[500,500],reference:[501,500]});const e=f.create(f.genesis('bad-arrival')),before=saved(e);
  const result=probeNativeHumanBirth(e,f,request);assert.equal(result.outcome,'unavailable');
  assert.ok('diagnostic'in result);assert.equal(result.diagnostic.code,'birth.arrival-unavailable');assert.deepEqual(saved(e),before);
  assert.throws(()=>e.spawnHuman(request),/no free standing room/);assert.equal(e.world.entities.h_new,undefined);
});

test('identity reuse distinguishes matching body from conflicting body without inheriting legacy blind id reuse',()=>{
  const e=factory.create(factory.genesis('identity'));e.spawnHuman(request);const before=saved(e);
  assert.equal(probeNativeHumanBirth(e,factory,request).outcome,'existing');
  for(const change of [{soul:'s_else'},{label:'Other'}]){
    const result=probeNativeHumanBirth(e,factory,{...request,...change});assert.equal(result.outcome,'unavailable');assert.ok('diagnostic'in result);assert.equal(result.diagnostic.code,'birth.identity-conflict');
  }
  assert.deepEqual(saved(e),before);
});

test('strict bounded internal input rejects malformed/private fields before any native state access',()=>{
  const e=factory.create(factory.genesis('validation')),before=saved(e);
  for(const raw of [{...request,owner:'private'},{...request,id:''},{...request,soul:'x'.repeat(97)},{...request,label:'x'.repeat(81)},{...request,id:3},null])assert.throws(()=>probeNativeHumanBirth(e,factory,raw));
  assert.deepEqual(saved(e),before);assert.throws(()=>probeNativeHumanBirth(e,{...factory,rulesVersion:'wrong'},request),/matching native/);
});

test('resumable native walk is preserved and continues identically after detached probe',()=>{
  const e=factory.create(factory.genesis('walking'));e.spawnHuman({id:'h_A',label:'Alice',soul:'s_A'});
  const walking=e.perform({actor:'h_A',label:'walk',steps:[{verb:'walk_to',params:{to:[12,0,5]}}]});assert.equal(walking.ok,true);
  for(let i=0;i<40;i++)e.step();assert.equal(e.world.entities.h_A.human!.activity,'walk');assert.equal(e.canSnapshot!(),true);
  const before=saved(e),control=factory.restore(e.snapshot());assert.equal(probeNativeHumanBirth(e,factory,request).outcome,'ready');assert.deepEqual(saved(e),before);
  for(let i=0;i<80;i++){e.step();control.step();}assert.equal(e.stateHash(),control.stateHash());
});

test('actually non-resumable native sleep defers without serializing or disturbing the sleeper',async()=>{
  const f=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
  const e=f.create(f.genesis('sleeping'));e.spawnHuman({id:'h_A',label:'Alice',soul:'s_A'});
  assert.equal(e.perform({actor:'h_A',label:'sleep',steps:[{verb:'mars:sleep',params:{mat:'mat-1',duration:600}}]}).ok,true);
  for(let i=0;i<1800&&e.world.entities.h_A.human!.activity!=='sleep';i++)e.step();assert.equal(e.world.entities.h_A.human!.activity,'sleep');assert.equal(e.canSnapshot!(),false);
  const before=saved(e),result=probeNativeHumanBirth(e,f,request);assert.equal(result.outcome,'deferred');assert.ok('diagnostic'in result);assert.equal(result.diagnostic.code,'birth.checkpoint-required');assert.deepEqual(saved(e),before);
});

test('checkpoint corruption and unexpected native faults propagate instead of becoming ordinary arrival refusal',()=>{
  const e=factory.create(factory.genesis('faults')),before=saved(e);
  const advanced={...factory,restore:(snapshot:Parameters<typeof factory.restore>[0])=>{const copy=factory.restore(snapshot);copy.step();return copy;}};
  assert.throws(()=>probeNativeHumanBirth(e,advanced,request),/did not restore exactly/);assert.deepEqual(saved(e),before);
  const original=e.snapshot.bind(e);e.snapshot=()=>{throw new Error('isolated unexpected codec invariant');};
  assert.throws(()=>probeNativeHumanBirth(e,factory,request),/unexpected codec invariant/);assert.deepEqual(saved(e),before);e.snapshot=original;
});
