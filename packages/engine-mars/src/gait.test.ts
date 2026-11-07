import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,GREEN_FIELD_WORLD,EDEN_COMMONS_WORLD} from './engine.ts';
import {groundFact,groundField} from './ground-bridge.ts';
import {emptyGround} from '../../ground/src/index.ts';
import type {Engine} from '@souls/engine-contract';

async function setup(ground=false){const f=await marsFactory(GREEN_FIELD_WORLD),e=f.create(f.genesis('gaits'));
  if(ground){const g=emptyGround(128);g.landforms.push({id:'knoll',kind:'bump',c:[25,0],r:18,h:3,peak:1},{id:'pond',kind:'carve',area:[[-25,-8],[-15,-8],[-15,8],[-25,8]],bed:-.2,edge:1});g.waters.push({id:'pond',area:[[-25,-8],[-15,-8],[-15,8],[-25,8]],level:0});(e as Engine&{installGroundV1(f:unknown):unknown}).installGroundV1(groundFact(g,1));}
  e.spawnHuman({id:'h',label:'Runner',soul:'s'});return {e,f};}
function drive(e:Engine,to:[number,number],gait:string){const a=e.perform({actor:'h',label:gait,steps:[{verb:'walk_to',params:{to,gait}}]});assert.ok(a.ok,JSON.stringify(a));let max=0;const acts=new Set<string>();let end;
  for(let i=0;i<1600&&!end;i++){const out=e.step(),h=e.world.entities.h;max=Math.max(max,h.human!.speed??0);acts.add(h.human!.activity);end=out.programs.find(p=>p.id===a.id&&['completed','failed','cancelled'].includes(p.kind));}
  assert.equal(end?.kind,'completed',JSON.stringify(end));assert.deepEqual(e.runtime.violations,[]);return {max,acts};}

test('body language reaches native jog/run and retains the terminal verdict',async()=>{
  const {e}=await setup();const jog=drive(e,[25,0],'jog');assert.equal(jog.max,2.5);assert.ok(jog.acts.has('jog'));const run=drive(e,[-25,0],'run');assert.equal(run.max,4);assert.ok(run.acts.has('run'));assert.equal(e.programOf('h'),null);
});
test('ordinary Eden dry ground accepts a faster gait',async()=>{const f=await marsFactory(EDEN_COMMONS_WORLD),e=f.create(f.genesis('eden-run'));e.spawnHuman({id:'h',label:'Runner',soul:'s'});assert.ok(drive(e,[25,20],'run').acts.has('run'));});
test('world-engine terrain runs on dry slopes and refuses wading without moving the body',async()=>{
  const {e}=await setup(true);assert.ok(drive(e,[25,0],'run').acts.has('run'));const p=e.world.entities.h.pose.p,fact=(e.world as typeof e.world&{groundV1:{recipeHash:string}}).groundV1;assert.ok(Math.abs(p[1]-groundField(fact.recipeHash).height(p[0],p[2]))<1e-8);
  const at=[...p],a=e.perform({actor:'h',label:'unsafe wet jog',steps:[{verb:'walk_to',params:{to:[-20,0],gait:'jog'}}]});assert.equal(a.ok,false);assert.equal(a.diagnostic?.code,'gait.dry-ground-required');assert.deepEqual(e.world.entities.h.pose.p,at);assert.deepEqual(e.runtime.violations,[]);
});
test('invalid gait and floater gait refuse at admission',async()=>{const {e}=await setup();const invalid=e.perform({actor:'h',label:'bad gait',steps:[{verb:'walk_to',params:{to:[25,0],gait:'sprint'}}]});assert.equal(invalid.ok,false);assert.equal(invalid.diagnostic?.code,'gait.invalid');e.world.entities.h.body={family:'floater'};const no=e.perform({actor:'h',label:'floater run',steps:[{verb:'walk_to',params:{to:[25,0],gait:'run'}}]});assert.equal(no.ok,false);assert.equal(no.diagnostic?.code,'gait.unsupported-body');});
