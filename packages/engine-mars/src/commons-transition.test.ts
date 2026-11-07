import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory,marsCommonsTransitionFactory,GREEN_FIELD_WORLD,EDEN_COMMONS_WORLD } from './engine.ts';
import type { Engine } from '@souls/engine-contract';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
import type { RuntimeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';

async function setup(){const f=await marsCommonsTransitionFactory(),e=f.create(f.genesis('transition'));e.spawnHuman({id:'h',label:'Resident',soul:'s'});return {f,e};}
function adopt(e:Engine){const p=e.previewCommonsTransition!();assert.equal(p.ok,true,JSON.stringify(p));if(!p.ok)throw new Error('refused');e.adoptCommons!(p.transition);return p.transition;}

test('explicit commons checkpoint retains exact body, object progress, old region, records and next native action ID',async()=>{
  const {e}=await setup();
  (e.world as WorldState).entities.cup={id:'cup',def:'cup',kind:'component',pose:{p:[-10,0,-10],yaw:.2},support:{kind:'ground'},contents:{food:'water',fraction:.05},provenance:{origin:'design-edit',confidence:'hypothetical'}};
  const a=e.submit('walk_to',{actor:'h',x:-4,z:-4});for(let i=0;i<240;i++)e.step();assert.equal(a.status,'completed');
  const entities=structuredClone(e.world.entities),region=structuredClone(e.world.regions.field),records=structuredClone([...e.runtime.records]);
  const previous=(e.snapshot() as ReturnType<typeof e.snapshot>&{mars:RuntimeSnapshot}).mars;
  const p=e.previewCommonsTransition!();assert.equal(p.ok,true);assert.deepEqual(e.world.entities,entities);
  const oldRules=e.rulesVersion;adopt(e);assert.equal(e.rulesVersion,oldRules+'+commons/1');
  for(const id of Object.keys(entities))assert.deepEqual(e.world.entities[id],entities[id]);
  assert.deepEqual(e.world.regions.field,region);assert.deepEqual([...e.runtime.records],records);
  const after=(e.snapshot() as ReturnType<typeof e.snapshot>&{mars:RuntimeSnapshot}).mars;
  assert.equal(after.nextId,previous.nextId);assert.equal(after.idPrefix,previous.idPrefix);
  assert.equal(e.submit('face',{actor:'h',target:{point:[-3,-4]}}).id,`${previous.idPrefix??'a'}${previous.nextId}`);
  for(let i=0;i<10;i++)e.step();assert.deepEqual(e.runtime.violations,[]);
});

test('scene checkpoint seals a partial old take and keeps both original captures without a straddling chunk',async()=>{
  const {e}=await setup();for(let i=0;i<37;i++)e.step();
  const old=e.takeChunks!(-1)[0],hash=(old.take as {renderSceneRef:{hash:string}}).renderSceneRef.hash;
  const capture=e.takeScene!(hash);adopt(e);for(let i=0;i<25;i++)e.step();
  const chunks=e.takeChunks!(-1),before=chunks.filter(c=>c.toTick<=37),after=chunks.filter(c=>c.fromTick>=37);
  assert.deepEqual(before.map(c=>[c.fromTick,c.toTick]),[[0,20],[20,37]]);assert.deepEqual(after.map(c=>[c.fromTick,c.toTick]),[[37,57]]);
  assert.deepEqual(e.takeScene!(hash),capture);assert.deepEqual(chunks[0],old);
  assert.notEqual((after[0].take as {renderSceneRef:{hash:string}}).renderSceneRef.hash,hash);
  assert.equal(chunks.some(c=>c.fromTick<37&&c.toTick>37),false);
});

test('existing actor or named object at the new fixture refuses without shifting, deleting or replacing it',async()=>{
  const {e}=await setup();const move=e.submit('walk_to',{actor:'h',x:6,z:3});for(let i=0;i<240;i++)e.step();assert.equal(move.status,'completed');
  const before=e.stateHash(),p=e.previewCommonsTransition!();assert.equal(p.ok,false);if(!p.ok)assert.equal(p.diagnostic.code,'commons-transition.physical-conflict');assert.equal(e.stateHash(),before);
  const {e:other}=await setup();(other.world as WorldState).entities['commons-table']={id:'commons-table',def:'cup',kind:'component',pose:{p:[-10,0,-10],yaw:0},support:{kind:'ground'},provenance:{origin:'design-edit',confidence:'hypothetical'}};
  const conflict=other.previewCommonsTransition!();assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.diagnostic.code,'commons-transition.entity-collision');
  assert.equal(other.world.entities['commons-table'].def,'cup');
});

test('unfinished programs, stale physical source and forged transition refuse; default factory stays disabled',async()=>{
  const {e}=await setup();const p=e.previewCommonsTransition!();assert.equal(p.ok,true);if(!p.ok)return;
  assert.throws(()=>e.adoptCommons!({...p.transition,fromWorldHash:'0'.repeat(64)}),/stale-or-forged/);
  e.step();assert.throws(()=>e.adoptCommons!(p.transition),/stale-or-forged/);
  const rest=e.perform({actor:'h',label:'rest',steps:[{verb:'rest',params:{seconds:1}}]});
  assert.equal(e.previewCommonsTransition!().ok,false);e.stop(rest.id);
  const f=await marsFactory(GREEN_FIELD_WORLD),old=f.create(f.genesis('unchanged'));assert.equal(old.previewCommonsTransition!().ok,false);
});

test('transition reader restores either side exactly and ordinary/standalone/foreign scene readers stay fail-closed',async()=>{
  const {f,e}=await setup();const old=e.snapshot();adopt(e);const after=e.snapshot();
  assert.equal(f.restore(old).world.base.campus,'greenfield');assert.equal(f.restore(after).stateHash(),e.stateHash());
  const legacy=await marsFactory(GREEN_FIELD_WORLD);assert.equal(legacy.canReplayHistory!(e.rulesVersion),false);assert.throws(()=>legacy.restore(after),/commons layout differs/);
  const standalone=await marsFactory(EDEN_COMMONS_WORLD),born=standalone.create(standalone.genesis('other'));
  assert.throws(()=>f.restore(born.snapshot()),/snapshot-without-reader/);assert.throws(()=>f.create(born.world),/genesis-base/);
  assert.throws(()=>f.validateHistoryHead!(e,legacy.rulesVersion),/history-head-differs/);
  const copy=f.restore(after);for(let i=0;i<30;i++){copy.step();e.step();assert.equal(copy.stateHash(),e.stateHash());}
});
