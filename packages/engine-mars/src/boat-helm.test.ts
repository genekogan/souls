import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf,nativeBoatControlsV1Schema} from '@souls/engine-contract';
import {connectedCommonsBoatFixture} from './connected-boat.ts';
import {connectedCommonsBoatFactory,connectedCommonsHelmFactory} from './connected-boat-engine.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
const finish=(rt:Runtime,id:string)=>{for(let i=0;i<3500&&rt.isActive(id);i++)rt.step();assert.equal(rt.records.get(id)!.status,'completed',JSON.stringify(rt.records.get(id)));};
async function seated(){const f=await connectedCommonsBoatFixture({helmV1:true}),w=f.genesis('native-voluntary-helm');w.entities.alice=f.human('alice',14,4);w.entities.bob=f.human('bob',15,4);const rt=f.create(w);
  for(const [actor,slot] of [['alice','seat0'],['bob','seat1']]){finish(rt,rt.submit('commons_shore_travel',{actor,x:f.layout.bank[0],z:f.layout.bank[2]}).id);finish(rt,rt.submit('boat_board',{actor,slot}).id);}return {f,rt};}
test('seats grant no helm; explicit take/release is single, one native step, and a pure local cue is not a grant',async()=>{
  const {f,rt}=await seated(),s=()=>rt.world.entities[f.policy.boatId].boat!;assert.deepEqual(s().pilotIds,[]);const before=hashOf(rt.snapshot().data),cue=nativeBoatControlsV1Schema.parse(f.helmControls!(rt,'alice'));assert.equal(cue.take.available,true);assert.equal(cue.release.available,false);assert.equal(cue.holder,null);assert.equal(hashOf(rt.snapshot().data),before);
  const a=rt.submit('boat_take_helm',{actor:'alice'});assert.equal(a.status,'executing');assert.deepEqual(s().pilotIds,[]);assert.equal(rt.submit('boat_take_helm',{actor:'bob'}).diagnostic?.code,'boat.helm-busy');rt.step();assert.equal(a.status,'completed');assert.deepEqual(s().pilotIds,['alice']);assert.deepEqual(rt.holder('boat-helm:'+f.policy.boatId),[]);
  assert.equal(f.helmControls!(rt,'bob')!.take.reason!.code,'boat.helm-held');assert.equal(rt.submit('boat_release_helm',{actor:'bob'}).diagnostic?.code,'boat.helm-not-held');assert.deepEqual(s().pilotIds,['alice']);finish(rt,rt.submit('boat_release_helm',{actor:'alice'}).id);assert.deepEqual(s().pilotIds,[]);finish(rt,rt.submit('boat_take_helm',{actor:'bob'}).id);assert.deepEqual(s().pilotIds,['bob']);assert.deepEqual(rt.violations,[]);
});
test('cancel before acquisition never grants; pending native helm graph resumes exactly and cannot regrant on cancelled replay',async()=>{
  const {f,rt}=await seated();const take=rt.submit('boat_take_helm',{actor:'alice'}),copy=f.restore(rt.snapshot());rt.cancel(take.id);copy.cancel(take.id);rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());assert.equal(hashOf(copy.snapshot().data),hashOf(rt.snapshot().data));assert.deepEqual(rt.world.entities[f.policy.boatId].boat!.pilotIds,[]);
  const next=rt.submit('boat_take_helm',{actor:'bob'}),saved=f.restore(rt.snapshot());rt.step();saved.step();assert.equal(next.status,'completed');assert.equal(saved.stateHash(),rt.stateHash());assert.equal(hashOf(saved.snapshot().data),hashOf(rt.snapshot().data));assert.deepEqual(rt.violations,[]);
});
test('underway helm changes refuse; ordinary departure revokes the actual capability and another seated passenger can take it',async()=>{
  const {f,rt}=await seated();finish(rt,rt.submit('boat_take_helm',{actor:'alice'}).id);const go=rt.submit('boat_travel',{actor:'alice',x:-56,z:8});rt.step();assert.equal(rt.submit('boat_release_helm',{actor:'alice'}).diagnostic?.code,'boat.helm-underway');assert.equal(rt.submit('boat_take_helm',{actor:'bob'}).diagnostic?.code,'boat.helm-underway');finish(rt,go.id);finish(rt,rt.submit('boat_travel',{actor:'alice',x:f.layout.boatDockPosition[0],z:f.layout.boatDockPosition[2]}).id);
  const leave=rt.submit('boat_leave',{actor:'alice',slot:'seat0'});assert.deepEqual(rt.world.entities[f.policy.boatId].boat!.pilotIds,[]);assert.equal(rt.submit('boat_take_helm',{actor:'bob'}).diagnostic?.code,'boat.helm-busy');finish(rt,leave.id);finish(rt,rt.submit('boat_take_helm',{actor:'bob'}).id);assert.deepEqual(rt.violations,[]);
});
test('fresh helm physics refuses old bindings/graphs, hides remote controls and rejects invented availability',async()=>{
  const f=await connectedCommonsBoatFixture({helmV1:true}),old=await connectedCommonsBoatFixture();assert.throws(()=>f.create(old.genesis()),/physical base/);assert.throws(()=>old.create(f.genesis()),/physical base/);const w=f.genesis();w.entities.h=f.human('h',14,4);const rt=f.create(w);assert.equal(f.helmControls!(rt,'h'),null);assert.equal(f.helmControls!(rt,'unknown'),null);
  const plain=await connectedCommonsBoatFactory(),helm=await connectedCommonsHelmFactory();assert.equal(plain.canReplayHistory!(helm.rulesVersion),false);assert.equal(helm.canReplayHistory!(plain.rulesVersion),false);assert.throws(()=>helm.restore(plain.create(plain.genesis('fences')).snapshot()),/binding-differs/);
  const {f:near,rt:r}=await seated(),cue=near.helmControls!(r,'alice')!;assert.equal(nativeBoatControlsV1Schema.safeParse({...cue,take:{available:true,reason:{code:'invented',message:'not granted'}}}).success,false);assert.equal(nativeBoatControlsV1Schema.safeParse({...cue,owner:'not-a-public-field'}).success,false);assert.deepEqual(r.violations,[]);
});

test('fresh adapter permits only its own passenger helm and revokes that native capability when retirement begins',async()=>{
  const native=await connectedCommonsBoatFixture({helmV1:true}),f=await connectedCommonsHelmFactory(),e=f.create(f.genesis('self-only'));e.spawnHuman({id:'h',label:'Hypothetical native fixture',soul:'fixture'});
  for(const step of [{verb:'walk_to',params:{to:[native.layout.bank[0],native.layout.bank[2]]}},{verb:'mars:boat_board',params:{slot:'seat0'}}]){const p=e.perform({actor:'h',label:'native fixture',steps:[step]});assert.ok(p.ok);for(let i=0;i<3500&&e.programOf('h');i++)e.step();assert.equal(e.programOf('h'),null);}
  const hash=e.stateHash(),foreign=e.perform({actor:'h',label:'not a voluntary other-body request',steps:[{verb:'mars:boat_take_helm',params:{actor:'other'}}]});assert.equal(foreign.ok,false);assert.equal(foreign.diagnostic!.code,'boat.helm-self-only');assert.equal(e.stateHash(),hash);
  for(const step of [{verb:'mars:boat_travel',params:{actor:'other',x:-56,z:8}},{verb:'mars:boat_board',params:{actor:'other',slot:'seat1'}},{verb:'mars:boat_leave',params:{actor:'other',slot:'seat0'}}]){
    const p=e.perform({actor:'h',label:'foreign body refused',steps:[step]});assert.equal(p.ok,false);assert.equal(p.diagnostic!.code,'boat.self-only');assert.equal(e.stateHash(),hash);
  }
  const take=e.perform({actor:'h',label:'take helm',steps:[{verb:'mars:boat_take_helm',params:{}}]});assert.ok(take.ok);for(let i=0;i<10&&e.programOf('h');i++)e.step();assert.equal(e.observeBoatControls!('h')!.holder,'h');assert.equal(e.observeBoatControls!('h')!.release.available,true);
  e.removeEntity('h');assert.ok(e.world.entities.h);assert.equal(e.observeBoatControls!('h')!.holder,null);assert.equal(e.observeBoatControls!('h')!.take.reason!.code,'boat.helm-retiring');assert.equal(e.perform({actor:'h',label:'stale take',steps:[{verb:'mars:boat_take_helm',params:{}}]}).diagnostic!.code,'boat.helm-retiring');
  const copy=f.restore(e.snapshot());for(let i=0;i<1800&&e.world.entities.h;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}assert.equal(e.world.entities.h,undefined);assert.deepEqual(e.runtime.violations,[]);
});
