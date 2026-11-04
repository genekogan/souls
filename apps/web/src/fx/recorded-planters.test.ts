import test from 'node:test';
import assert from 'node:assert/strict';
import '../gen-mesh/kit.mesh.ts';
import {coreLibrary} from '@sim/world-compiler';
import {RecordedPlanters} from './recorded-planters.ts';
import {WorldEntityLayer} from '../WorldEntityLayer.ts';
import * as THREE from 'three';

test('fresh recorded planter geometry, pose and biology survive current-world removal or edits',()=>{
  const def=coreLibrary().get('core/garden-planter@3')!;
  const {by:_by,born:_born,hash:_hash,ref:_ref,...definition}=def;
  const id='e_history1',anchor={biologyEnabled:true,biologyHour:0,biologyWilt:1,biologyTarget:0,biologyMoisture:1,biologyGrowth:2};
  const render={defHash:def.hash,params:{wood:'#ab4528'},seed:17,scale:1.5};
  const take={tracks:{[id]:[]},entities0:{[id]:{plantBiology:anchor}},finalState:{entities:{},plantRenderDefsV1:{[def.hash]:definition}}};
  // This reader has never loaded a God snapshot. Current removal/moves/defs cannot influence its picture.
  const view=new RecordedPlanters();view.setTake(take);
  const frame={[id]:{p:[3,2,7],yaw:.3,state:{plantBiology:anchor,plantRenderV1:render}}};
  const clock={origin:0,dayTicks:72000};
  assert.deepEqual([...view.update(frame,0,clock)],[id]);
  const mesh=view.group.children[0],plants=mesh.getObjectByName('plant growth')!;
  assert.deepEqual(mesh.position.toArray(),[3,2,7]);assert.equal(mesh.rotation.y,-.3);assert.equal(mesh.scale.x,1.5);
  assert.equal((plants.userData.look as {w:number}).w,1);
  view.update(frame,108000,clock);assert.equal((plants.userData.look as {w:number}).w,.5);
  view.update(frame,216000,clock);assert.equal((plants.userData.look as {w:number}).w,0);
  view.update(frame,0,clock);assert.equal((plants.userData.look as {w:number}).w,1,'backward seek is independent');
  const other={...frame,[id]:{...frame[id],p:[9,0,1],yaw:1,state:{...frame[id].state,plantRenderV1:{...render,scale:.75}}}};
  view.update(other,108000,clock);assert.deepEqual(view.group.children[0].position.toArray(),[9,0,1]);assert.equal(view.group.children.length,1);
  view.update({},108000,clock);assert.equal(view.group.children.length,0,'absence/removal has no ghost');
  view.update(frame,108000,clock);assert.equal(view.group.children.length,1,'fresh past seek restores the old picture');
  view.dispose();assert.equal(view.group.children.length,0);
});
test('unflagged worlds have no recorded planter frame reads',()=>{
  const view=new RecordedPlanters();view.setTake({tracks:{},finalState:{entities:{}}});
  const entities=new Proxy({}, {ownKeys(){throw Error('unflagged entity scan');},get(){throw Error('unflagged entity read');}});
  assert.equal(view.update(entities,100,{origin:0,dayTicks:72000}).size,0);view.dispose();
});
test('historical absence hides a current original and invalidates its cached batches',()=>{
  const layer=Object.create(WorldEntityLayer.prototype) as WorldEntityLayer;
  const original=new THREE.Group(),id='e_prebirth';
  Object.assign(layer,{recordedPlanters:new RecordedPlanters(),group:new THREE.Group(),drawn:new Map([[id,{obj:original,frozen:true}]]),currentRecordedPlantIds:new Set([id]),hiddenRecordedPlants:new Set(),plantTweens:new Map(),staticRevision:0});
  layer.setPlantTake({tracks:{},finalState:{entities:{}}});
  layer.plantFrame({},0,{origin:0,dayTicks:72000},true);
  assert.equal(original.visible,false,'a current planter cannot leak into its prebirth history');assert.equal(layer.staticRevision,1,'old batch and shadow ownership invalidated');
  layer.plantFrame({},1,{origin:0,dayTicks:72000},true);assert.equal(layer.staticRevision,1,'unchanged ownership costs no repeated invalidation');
  layer.plantFrame({},2,{origin:0,dayTicks:72000},false);assert.equal(original.visible,true);assert.equal(layer.staticRevision,2,'returning live restores the original through the same invalidation');
});
test('disabled recorded planters stay frozen without per-frame entity reads',()=>{
  const def=coreLibrary().get('core/garden-planter@3')!,{by:_by,born:_born,hash:_hash,ref:_ref,...definition}=def;
  const id='e_frozen1',anchor={biologyEnabled:false,biologyHour:12,biologyWilt:.4,biologyTarget:0,biologyMoisture:.8,biologyGrowth:2};
  const view=new RecordedPlanters();view.setTake({tracks:{},finalState:{entities:{[id]:{plantBiology:anchor,plantRenderV1:{defHash:def.hash,params:{},seed:0,scale:1},pose:{p:[1,0,2],yaw:0}}},plantRenderDefsV1:{[def.hash]:definition},plantStaticIdsV1:[id]}});
  const unread=new Proxy({}, {ownKeys(){throw Error('disabled entity scan');},get(){throw Error('disabled entity read');}});
  assert.ok(view.update(unread,1e8,{origin:0,dayTicks:72000}).has(id));
  assert.equal(view.group.children[0].getObjectByName('plant growth')!.userData.look.w,.4);
  view.dispose();
});
