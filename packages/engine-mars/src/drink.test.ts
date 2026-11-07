import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf} from '@souls/engine-contract';
import {nativeCampDrinkFactory} from './drink-engine.ts';
import {marsFactory} from './engine.ts';
import {sampleTake} from '../../../mars/viewer/engine/take/replay.ts';
import {humanStaticClearance,humanStaticClearanceWithOverlay} from '../../../mars/viewer/engine/runtime/invariants.ts';
import {qualifiedSeatedDrink} from '../../../mars/viewer/engine/items/drink.ts';
async function setup(){const f=await nativeCampDrinkFactory(),e=f.create(f.genesis('drink-probe'));e.spawnHuman({id:'actor',soul:'native-fixture-not-product',label:'Native fixture'});return {f,e};}
async function holding(){const f=await setup(),p=f.e.perform({actor:'actor',label:'take water bowl',steps:[{verb:'mars:take_item',params:{item:'water-bowl',hand:'left'}}]});assert.equal(p.ok,true);for(let i=0;i<3000&&f.e.programOf('actor');i++)f.e.step();assert.equal(f.e.programOf('actor'),null);assert.equal((f.e.world.entities['water-bowl'] as any).support.kind,'in-hand');return f;}
test('finite water consumption follows actual mouth phases and original public hand/container state; moving snapshot restores every next tick',async()=>{
  const {f,e}=await holding(),at=[...e.world.entities.actor.pose.p],initial=(e.world.entities['water-bowl'] as any).contents.fraction;
  const p=e.perform({actor:'actor',label:'drink two sips',steps:[{verb:'mars:drink_water',params:{container:'water-bowl',sips:2}}]});assert.equal(p.ok,true);let restored:any,seen=false;
  for(let i=0;i<200&&e.programOf('actor');i++){
    e.step();if((e.world.entities.actor as any).human.activity==='drink'){seen=true;assert.deepEqual(e.world.entities.actor.pose.p,at);assert.ok((e.world.entities.actor as any).human.hands.left);}
    if(!restored&&(e.world.entities.actor as any).human.activity==='drink'){assert.equal(e.canSnapshot!(),true);restored=f.restore(e.snapshot());assert.equal(restored.stateHash(),e.stateHash());}
    else if(restored){restored.step();assert.equal(restored.stateHash(),e.stateHash());}
  }
  assert.equal(seen,true);assert.equal(e.programOf('actor'),null);assert.equal((e.world.entities['water-bowl'] as any).contents.fraction,initial-.25);assert.equal((e.world.entities.actor as any).human.activity,'idle');assert.deepEqual(e.runtime.violations,[]);
  let sampled=false;for(const pair of e.takeChunks!(-1)){assert.ok(e.takeScene!((pair.take as any).renderSceneRef.hash));for(let tick=pair.fromTick;tick<pair.toTick;tick++){const body=sampleTake(pair.take as any,(tick-pair.fromTick)*e.dt).entities.actor;if(body?.activity==='drink'){assert.ok(body.hands?.left);sampled=true;}}}assert.equal(sampled,true);
});
test('cancellation before a sip consumes nothing and lowers safely; after a sip preserves the consumed amount',async()=>{
  for(const afterSip of [false,true]){const {e}=await holding();const p=e.perform({actor:'actor',label:'cancel drink',steps:[{verb:'mars:drink_water',params:{container:'water-bowl',sips:2}}]});assert.equal(p.ok,true);
    for(let i=0;i<(afterSip?25:2);i++)e.step();const consumed=(e.world.entities['water-bowl'] as any).contents.fraction;assert.equal(consumed,afterSip?.875:1);const before=e.stateHash();e.stop(p.id);assert.notEqual(e.programOf('actor'),null,'safe hand return is still pending');assert.notEqual(e.stateHash(),before);
    for(let i=0;i<100&&e.programOf('actor');i++)e.step();assert.equal(e.programOf('actor'),null);assert.equal((e.world.entities['water-bowl'] as any).contents.fraction,consumed);assert.equal((e.world.entities.actor as any).human.activity,'idle');assert.deepEqual(e.runtime.violations,[]);
  }
});
test('wrong liquid, empty/unheld bowl, occupied other hand, water support and anatomy refuse without consumption; legacy reader does not advertise drink',async()=>{
  const {f,e}=await holding(),raw={actor:'actor',label:'negative',steps:[{verb:'mars:drink_water',params:{container:'water-bowl',sips:1}}]};
  const bowl=e.world.entities['water-bowl'] as any,actor=e.world.entities.actor as any;
  for(const bad of [()=>bowl.contents.food='stew',()=>bowl.contents.fraction=.05,()=>bowl.contents.fraction=NaN,()=>bowl.contents.fraction=1.1,()=>bowl.support={kind:'ground'},()=>actor.body={family:'floater',model:'fixture',radius:.35,hoverHeight:1.45},()=>actor.human.sleepPose={mat:'mat-1',standingFraction:0},()=>actor.human.shore={mode:'bed'},()=>actor.human.activity='walk']){
    const s=e.snapshot();bad();const before=structuredClone(e.world);assert.ok(e.canPerform(raw));assert.deepEqual(e.world,before);const restored=f.restore(s);Object.assign(e.world.entities['water-bowl'],restored.world.entities['water-bowl']);Object.assign(e.world.entities.actor,restored.world.entities.actor);delete actor.body;delete actor.human.sleepPose;delete actor.human.shore;
  }
  const spoon=e.world.entities['spoon-1'] as any,home=structuredClone(spoon.support);spoon.support={kind:'in-hand',by:'actor',hand:'right'};assert.match(e.canPerform(raw)!.code,/other-hand-occupied/);spoon.support=home;
  const legacy=await marsFactory();assert.equal(legacy.create(legacy.genesis('legacy')).describeVerbs().some(v=>v.verb==='mars:drink_water'),false);assert.throws(()=>legacy.restore(e.snapshot()),/physical binding/);
});
test('an existing supported seat and drink hand overlay coexist without a second root-motion writer',async()=>{
  const {e}=await holding(),sit=e.submit('sit',{actor:'actor',fixture:'class-seat-1'});
  for(let i=0;i<3000&&(e.world.entities.actor as any).human.activity!=='sit';i++)e.step();assert.equal((e.world.entities.actor as any).human.activity,'sit');
  const root=[...e.world.entities.actor.pose.p],drink=e.submit('drink_water',{actor:'actor',container:'water-bowl',sips:1});assert.notEqual(drink.status,'failed');let overlaid=false;
  for(let i=0;i<100&&e.runtime.liveIds().includes(drink.id);i++){e.step();assert.deepEqual(e.world.entities.actor.pose.p,root);if((e.world.entities.actor as any).human.activity==='drink'){assert.equal((e.world.entities.actor as any).human.baseActivity,'sit');overlaid=true;}}
  assert.equal(overlaid,true);assert.equal(e.runtime.records.get(drink.id)!.status,'completed');assert.ok(e.runtime.liveIds().includes(sit.id));assert.equal((e.world.entities.actor as any).human.activity,'sit');assert.equal((e.world.entities['water-bowl'] as any).contents.fraction,.875);assert.deepEqual(e.runtime.violations,[]);
});
test('a drink activity cannot forge a seated collision exception without the actual seat holder and occupied frame',async()=>{
  const {e}=await setup(),actor=e.world.entities.actor as any;
  actor.pose.p=[-4.5,0,-13.5];actor.human.activity='drink';actor.human.baseActivity='sit';
  const rt=(e as any).rt;assert.equal(qualifiedSeatedDrink(rt,actor),false);
  assert.ok(humanStaticClearance(rt).some(d=>d.code==='collision.human-static'));
  assert.ok(humanStaticClearanceWithOverlay(qualifiedSeatedDrink)(rt).some(d=>d.code==='collision.human-static'));
  assert.match(e.canPerform({actor:'actor',label:'fake seat',steps:[{verb:'mars:drink_water',params:{container:'water-bowl',sips:1}}]})!.code,/seat-unqualified|not-still|not-held/);
});
