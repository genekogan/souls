import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeGatheringObservationV1Schema, type Engine } from '@souls/engine-contract';
import { marsFactory } from './engine.ts';

const factory=await marsFactory();
function setup(){
  const e=factory.create(factory.genesis('public-gathering-fixture'));
  for(const id of ['a','b'])e.spawnHuman({id,label:`Fake ${id}`,soul:`fake-soul-${id}`});
  return e;
}
const read=(e:Engine)=>e.gatheringObservation!();
function settled(e:Engine,ids:string[]){
  for(let n=0;n<1200&&!ids.every(id=>e.runtime.records.get(id)?.phase==='gathered');n++)e.step();
  for(const id of ids)assert.equal(e.runtime.records.get(id)?.phase,'gathered',JSON.stringify(e.runtime.records.get(id)?.diagnostic));
  assert.deepEqual(e.runtime.violations,[]);
}
function together(){const e=setup(),r=e.submit('campfire_circle',{actors:['a','b'],fire:'fire'});assert.equal(r.status,'executing');settled(e,[r.id]);return {e,r};}

test('nearby idle bodies and a requested gathering are ordinary until actual settled occupied slots',()=>{
  const e=setup();assert.ok(Math.hypot(e.world.entities.a.pose.p[0]-e.world.entities.b.pose.p[0],e.world.entities.a.pose.p[2]-e.world.entities.b.pose.p[2])<2);
  assert.equal(read(e).situation,'ordinary');assert.equal(read(e).largestCommonTargetMembers,0);
  const r=e.submit('campfire_circle',{actors:['a','b'],fire:'fire'});
  assert.equal(read(e).situation,'ordinary');e.step();assert.equal(read(e).situation,'ordinary');
  settled(e,[r.id]);assert.equal(read(e).situation,'gathering');assert.equal(read(e).largestCommonTargetMembers,2);
});

test('separate body-language gatherings at one actual target combine, including holds after program completion',()=>{
  const e=setup(),programs=['a','b'].map(actor=>e.perform({actor,label:'private-label-not-a-classifier',steps:[{verb:'gather',params:{at:'fire',seconds:.5}}]}));
  assert.ok(programs.every(p=>p.ok));
  for(let n=0;n<1200&&programs.some(p=>['a','b'].some(a=>e.programOf(a)===p.id));n++)e.step();
  assert.equal(e.programOf('a'),null);assert.equal(e.programOf('b'),null);
  assert.equal(read(e).situation,'gathering');assert.equal(read(e).largestCommonTargetMembers,2);
  assert.deepEqual(e.runtime.violations,[]);
});

test('different gathering targets and direct seats do not invent one shared gathering',()=>{
  const e=setup(),a=e.submit('gather',{actors:['a'],fixture:'bench-s'}),b=e.submit('campfire_circle',{actors:['b'],fire:'fire'});
  settled(e,[a.id,b.id]);assert.equal(read(e).situation,'ordinary');assert.equal(read(e).largestCommonTargetMembers,1);
  const seats=setup();const sa=seats.submit('sit',{actor:'a',fixture:'bench-s'}),sb=seats.submit('sit',{actor:'b',fixture:'bench-s'});
  assert.equal(sa.status,'executing');assert.equal(sb.status,'executing');
  for(let n=0;n<1200&&[sa,sb].some(r=>r.phase!=='occupied');n++)seats.step();
  assert.equal(sa.phase,'occupied');assert.equal(sb.phase,'occupied');assert.equal(read(seats).largestCommonTargetMembers,0);
});

test('actual member departure reduces the count immediately; parent cancellation clears the observation',()=>{
  const {e,r}=together();assert.equal(read(e).largestCommonTargetMembers,2);
  const stand=e.submit('stand',{actor:'a'});assert.notEqual(stand.status,'failed');
  for(let n=0;n<40&&stand.status!=='completed';n++)e.step();
  assert.equal(stand.status,'completed');assert.equal(read(e).situation,'ordinary');assert.equal(read(e).largestCommonTargetMembers,1);
  e.cancel(r.id);assert.equal(read(e).largestCommonTargetMembers,0);
});

test('regional audience is outside fixture-only revision and read never rebuilds navigation',()=>{
  const e=setup(),r=e.submit('gather',{actors:['a','b'],region:'lawn'});settled(e,[r.id]);
  const hash=e.stateHash(),snapshot=JSON.stringify(e.snapshot()),sp=(e as any).rt.services.spatial,epoch=sp.epoch;
  const sync=sp.sync;sp.sync=()=>{throw new Error('observation rebuilt navigation');};
  try{assert.equal(read(e).sourceRevision,'settled-native-gather-fixtures/1');assert.equal(read(e).largestCommonTargetMembers,0);}
  finally{sp.sync=sync;}
  assert.equal(sp.epoch,epoch);assert.equal(e.stateHash(),hash);assert.equal(JSON.stringify(e.snapshot()),snapshot);
});

test('current actor/task/slot/physical position must corroborate a live occupied child',()=>{
  const {e}=together(),child=[...e.runtime.records.values()].find(r=>r.verb==='take_slot'&&(r.params as any).actor==='a')!;
  const h=e.world.entities.a.human!,task=h.task;delete h.task;assert.equal(read(e).largestCommonTargetMembers,1);h.task=task;
  const slot=(child.params as any).slot;(child.params as any).slot='bench-s#wrong';assert.equal(read(e).largestCommonTargetMembers,1);(child.params as any).slot=slot;
  const p=e.world.entities.a.pose.p[0];e.world.entities.a.pose.p[0]+=1;assert.equal(read(e).largestCommonTargetMembers,1);e.world.entities.a.pose.p[0]=p;
  const activity=h.activity;h.activity='stand-up';assert.equal(read(e).largestCommonTargetMembers,1);h.activity=activity;
  child.status='cancelled';assert.equal(read(e).largestCommonTargetMembers,1);child.status='executing';assert.equal(read(e).largestCommonTargetMembers,2);
});

test('snapshot and independent genesis command replay reproduce observation without models or mutation',()=>{
  const {e}=together(),before=read(e),hash=e.stateHash(),snapshot=JSON.stringify(e.snapshot()),base=JSON.stringify(e.renderScene?.());
  for(let i=0;i<32;i++)assert.deepEqual(read(e),before);
  assert.equal(e.stateHash(),hash);assert.equal(JSON.stringify(e.snapshot()),snapshot);assert.equal(JSON.stringify(e.renderScene?.()),base);
  const restored=factory.restore(JSON.parse(snapshot));assert.deepEqual(read(restored),before);
  const replay=together();assert.equal(replay.e.stateHash(),hash);assert.deepEqual(read(replay.e),before);
  for(let i=0;i<25;i++){e.step();restored.step();replay.e.step();assert.equal(restored.stateHash(),e.stateHash());assert.equal(replay.e.stateHash(),e.stateHash());assert.deepEqual(read(restored),read(e));}
});

test('strict public observation excludes private inputs and returns detached whitelisted fields',()=>{
  const {e}=together();
  Object.defineProperty(e.world.entities.a.human!,'soul',{get(){throw new Error('private Soul field accessed');},configurable:true});
  Object.defineProperty(e.world.entities.a,'label',{get(){throw new Error('label interpreted');},configurable:true});
  const out=read(e),json=JSON.stringify(out);assert.equal(out.situation,'gathering');
  for(const marker of ['fake-soul','actor','owner','principal','label','intent','seed','stationEpoch','cueId','fire'])assert.ok(!json.includes(marker));
  out.largestCommonTargetMembers=0;assert.equal(read(e).largestCommonTargetMembers,2);
  assert.throws(()=>nativeGatheringObservationV1Schema.parse({...read(e),words:'private'}));
  assert.throws(()=>nativeGatheringObservationV1Schema.parse({...read(e),situation:'ordinary'}));
  assert.throws(()=>nativeGatheringObservationV1Schema.parse({...read(e),dtSeconds:NaN}));
});
