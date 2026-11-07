import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf,type Engine,type ProgramEvent} from '@souls/engine-contract';
import {connectedCommonsBoatFactory} from './connected-boat-engine.ts';
import {connectedCommonsBoatFixture} from './connected-boat.ts';
import {connectedCommonsShoreFactory} from './connected-shore-engine.ts';
import type {Entity as NativeEntity} from '../../../mars/viewer/engine/world/types.ts';
const boatState=(w:Engine['world'],id:string)=>(w.entities[id] as unknown as NativeEntity).boat!;
const graph=(s:any)=>{const {eventCursor,...mars}=s.mars;return {...s,mars};};
function finish(e:Engine,id:string,limit=3500,copy?:Engine,actor='h'){const events:ProgramEvent[]=[];for(let i=0;i<limit&&e.programOf(actor);i++){events.push(...e.step().programs);if(copy){copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.equal(hashOf(graph(copy.snapshot())),hashOf(graph(e.snapshot())));}}assert.equal(e.programOf(actor),null);assert.equal(events.filter(a=>a.id===id&&a.kind==='completed').length,1,JSON.stringify(events));return events;}
async function seated(){const native=await connectedCommonsBoatFixture(),f=await connectedCommonsBoatFactory(),e=f.create(f.genesis('passenger-removal'));e.spawnHuman({id:'h',label:'Hypothetical native fixture',soul:'fixture'});
  const walk=e.perform({actor:'h',label:'approach bank',steps:[{verb:'walk_to',params:{to:[native.layout.bank[0],native.layout.bank[2]]}}]});assert.ok(walk.ok);finish(e,walk.id);
  const board=e.perform({actor:'h',label:'board',steps:[{verb:'mars:boat_board',params:{slot:'seat0'}}]});assert.ok(board.ok);finish(e,board.id);return {native,f,e};}
test('fresh connected adapter retains a retiring seated body until its actual supported dock exit ends',async()=>{
  const {native,f,e}=await seated();const at=[...e.world.entities.h.pose.p];e.removeEntity('h');assert.ok(e.world.entities.h,'seated body cannot be deleted');assert.deepEqual(e.world.entities.h.pose.p,at);assert.equal(boatState(e.world,native.policy.boatId).passengers.seat0,'h');
  const copy=f.restore(e.snapshot());for(let i=0;i<1800&&e.world.entities.h;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.equal(hashOf(graph(copy.snapshot())),hashOf(graph(e.snapshot())));}
  assert.equal(e.world.entities.h,undefined);assert.deepEqual(boatState(e.world,native.policy.boatId).passengers,{});assert.deepEqual(e.runtime.violations,[]);
});

test('removal during committed boarding waits through the real cancelled path and actual exit, restoring the full moving graph',async()=>{
  const native=await connectedCommonsBoatFixture(),f=await connectedCommonsBoatFactory(),e=f.create(f.genesis('boarding-removal'));e.spawnHuman({id:'h',label:'Hypothetical native fixture',soul:'fixture'});
  const walk=e.perform({actor:'h',label:'bank',steps:[{verb:'walk_to',params:{to:[native.layout.bank[0],native.layout.bank[2]]}}]});finish(e,walk.id);
  const p=e.perform({actor:'h',label:'board',steps:[{verb:'mars:boat_board',params:{slot:'seat0'}}]});assert.ok(p.ok);for(let i=0;i<80;i++)e.step();assert.equal((e.world.entities.h.human as any).boatPassenger.phase,'boarding');
  const at=[...e.world.entities.h.pose.p];e.removeEntity('h');assert.ok(e.world.entities.h);assert.deepEqual(e.world.entities.h.pose.p,at);assert.equal(e.programOf('h'),p.id);const copy=f.restore(e.snapshot()),events:ProgramEvent[]=[];
  for(let i=0;i<1800&&e.world.entities.h;i++){events.push(...e.step().programs);copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.equal(hashOf(graph(copy.snapshot())),hashOf(graph(e.snapshot())));}
  assert.equal(events.filter(a=>a.id===p.id&&a.kind==='cancelled').length,1);assert.equal(e.world.entities.h,undefined);assert.deepEqual(boatState(e.world,native.policy.boatId).passengers,{});assert.deepEqual(e.runtime.violations,[]);
});

test('retiring a passenger does not cancel another pilot trip; absence waits for actual return and dock exit',async()=>{
  const native=await connectedCommonsBoatFixture(),f=await connectedCommonsBoatFactory(),w=f.genesis('underway-removal');w.entities.pilot=native.human('pilot',15,4);boatState(w,native.policy.boatId).pilotIds=['pilot'];const e=f.create(w);e.spawnHuman({id:'h',label:'Hypothetical native guest',soul:'fixture'});
  for(const [actor,slot] of [['h','seat0'],['pilot','seat1']]){const walk=e.perform({actor,label:'bank',steps:[{verb:'walk_to',params:{to:[native.layout.bank[0],native.layout.bank[2]]}}]});assert.ok(walk.ok);finish(e,walk.id,3500,undefined,actor);const board=e.perform({actor,label:'board',steps:[{verb:'mars:boat_board',params:{slot}}]});assert.ok(board.ok);finish(e,board.id,3500,undefined,actor);}
  const go=e.perform({actor:'pilot',label:'hypothetical explicit pilot trip',steps:[{verb:'mars:boat_travel',params:{x:-56,z:8}}]});assert.ok(go.ok);for(let i=0;i<50;i++)e.step();e.removeEntity('h');assert.ok(e.world.entities.h);assert.equal(e.programOf('pilot'),go.id);const copy=f.restore(e.snapshot());finish(e,go.id,3500,copy,'pilot');
  for(let i=0;i<100;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.equal(hashOf(graph(copy.snapshot())),hashOf(graph(e.snapshot())));}assert.ok(e.world.entities.h);assert.equal((e.world.entities.h.human as any).boatPassenger.phase,'seated');assert.equal([...e.runtime.records.values()].filter(r=>r.verb==='boat_leave').length,0);
  const back={actor:'pilot',label:'return',steps:[{verb:'mars:boat_travel',params:{x:native.layout.boatDockPosition[0],z:native.layout.boatDockPosition[2]}}]};const a=e.perform(back),b=copy.perform(back);assert.ok(a.ok&&b.ok);assert.equal(a.id,b.id);finish(e,a.id,3500,copy,'pilot');
  for(let i=0;i<1800&&e.world.entities.h;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.equal(hashOf(graph(copy.snapshot())),hashOf(graph(e.snapshot())));}assert.equal(e.world.entities.h,undefined);assert.equal(boatState(e.world,native.policy.boatId).passengers.seat1,'pilot');assert.equal((e.world.entities.pilot.human as any).boatPassenger.phase,'seated');assert.deepEqual(e.runtime.violations,[]);
});

test('fresh boat adapter fences old shore identity/config and preserves empty pilot genesis and addressed captures',async()=>{
  const f=await connectedCommonsBoatFactory(),old=await connectedCommonsShoreFactory(),e=f.create(f.genesis('fences')),shore=old.create(old.genesis('fences'));
  assert.equal(f.canReplayHistory!(old.rulesVersion),false);assert.equal(old.canReplayHistory!(f.rulesVersion),false);assert.throws(()=>f.restore(shore.snapshot()),/binding-differs/);assert.throws(()=>old.restore(e.snapshot()),/binding-differs/);assert.throws(()=>f.create(shore.world),/physical base differs/);
  const bad=e.snapshot() as any;bad.cfg.walkBlockV1=false;assert.throws(()=>f.restore(bad),/policy-differs/);const tampered=e.snapshot();tampered.stateHash='0'.repeat(64);assert.throws(()=>f.restore(tampered),/state-differs/);
  const boat=Object.values(e.world.entities).find(v=>(v as unknown as NativeEntity).boat)!;assert.deepEqual(boatState(e.world,boat.id).pilotIds,[]);assert.ok(e.describeVerbs().some(v=>v.verb==='mars:boat_board'));assert.ok(f.rulesVersion.length<=200);for(let i=0;i<25;i++)e.step();assert.ok(e.takeChunks!(0).length);const s=e.snapshot();assert.equal(f.restore(s).stateHash(),e.stateHash());
  for(const c of e.takeChunks!(0)){const t=c.take as any,scene=e.takeScene!(t.renderSceneRef.hash)!;assert.equal(t.rulesVersion,f.rulesVersion);assert.equal(scene.body.shore!.physicalBase.staticHash,e.world.base.staticHash);assert.equal(scene.body.shore!.rulesVersion,f.rulesVersion);}assert.deepEqual(e.runtime.violations,[]);
});
