import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, coreLibrary, applyBatch, biologyAt, biologyOf, anchorBiology, waterBiology, biologyHourAt } from '../../packages/world-compiler/src/index.ts';
import { dryingOps, enabledPlanters, gardenStats } from '../../apps/server/src/god/garden.ts';
import { clockConfig } from '../../apps/server/src/god/world-clock.ts';
import { plantLookOf } from '../../apps/web/src/fx/plant-growth.ts';

const close = (a,b) => assert.ok(Math.abs(a-b)<1e-10, `${a} != ${b}`);
function fixture() {
  const model = new WorldModel({constants:{ground:'land',extent:300},seed:'garden-revival'}); model.library=coreLibrary();
  const apply = ops => {const r=applyBatch(model,{ops},'god',model.editSeq+1).result;assert.equal(r.accepted,true,JSON.stringify(r));};
  const place = (name,version,state={}) => {apply([{op:'place',name,def:`core/garden-planter@${version}`,p:[model.entities.size*2,0],state}]);return model.get(name);};
  return {model,apply,place};
}
test('unflagged complete state stays unchanged and has no biological visits',()=>{
  const f=fixture();for(const v of [1,2,3])f.place(`old-${v}`,v,{moisture:1});
  const before=f.model.snapshot();gardenStats.planterVisits=0;
  assert.deepEqual(enabledPlanters(f.model),[]);assert.deepEqual(dryingOps(f.model,10,240),[]);
  assert.equal(gardenStats.planterVisits,0);assert.deepEqual(f.model.snapshot(),before);
  for(const e of f.model.entities.values())assert.equal(waterBiology(e.state,f.model.resolvedDef(e.def),240,1),null);
});
test('admitted activation, mirrored72h curve and continuous growth use world hours',()=>{
  const f=fixture(),e=f.place('opted',3,{biologyEnabled:true,moisture:1,growth:1});const def=f.model.resolvedDef(e.def);
  const a=anchorBiology(e.state,def,10);f.apply([{op:'set',id:e.id,state:a}]);
  close(biologyAt(a,46).w,.5);close(biologyAt(a,82).w,1);close(biologyAt(a,22).g,1.5);
  const wet=waterBiology({...a,moisture:0},def,82,1);f.apply([{op:'set',id:e.id,state:wet}]);
  close(plantLookOf(wet,def,82).w,1);close(plantLookOf(wet,def,118).w,.5);close(plantLookOf(wet,def,154).w,0);
  close(plantLookOf(wet,def,190).w,.5);close(plantLookOf(wet,def,226).w,1);
  for(let h=0;h<=72;h+=3)close(biologyAt(a,10+h).w+biologyAt(wet,82+h).w,1);
});
test('three soil impulses preserve pending recovery; .9 debt saturation fully revives',()=>{
  const f=fixture(),e=f.place('dry',3,{biologyEnabled:true,moisture:.1,growth:2,thirst:3});const def=f.model.resolvedDef(e.def);
  let state={...e.state,...anchorBiology(e.state,def,0)};
  const targets=[];for(const [hour,dose] of [[0,.3],[1,.3],[2,.3]]) {state={...state,...waterBiology(state,def,hour,dose)};targets.push(state.biologyTarget);}
  close(targets[0],.7);close(targets[1],.4);assert.equal(targets[2],0);assert.equal(state.moisture,1);
  close(biologyAt(biologyOf(state,def),2).w,1-2/72);
  close(biologyAt(biologyOf(state,def),2+state.biologyWilt*72).w,0);
  const saved=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(f.model.snapshot())),undefined,f.model.library);
  f.apply([{op:'set',id:e.id,state}]);const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(f.model.snapshot())),undefined,f.model.library);
  assert.deepEqual(restored.get('dry').state,state);assert.ok(saved.get('dry'));
});
test('partial abort, repeated watering and daily materialisation preserve recovery',()=>{
  const f=fixture(),e=f.place('partial',3,{biologyEnabled:true,moisture:0,growth:2,thirst:3});const def=f.model.resolvedDef(e.def);
  let state={...e.state,...anchorBiology(e.state,def,0)};
  state={...state,...waterBiology(state,def,0,.2)};close(state.biologyTarget,.8);
  // An abort delivers no further dose: target remains .8 and drying starts after14.4h.
  close(biologyAt(biologyOf(state,def),7.2).w,.9);close(biologyAt(biologyOf(state,def),14.4).w,.8);
  close(biologyAt(biologyOf(state,def),21.6).w,.9);
  state={...state,...waterBiology(state,def,7.2,.2)};close(state.biologyTarget,.6);close(state.biologyWilt,.9);
  f.apply([{op:'set',id:e.id,state}]);f.apply(dryingOps(f.model,1,12));
  const after=biologyOf(f.model.get('partial').state,def);close(after.biologyTarget,.6);
  close(biologyAt(after,28.8).w,.6);close(biologyAt(after,36).w,.7);
});
test('clock pause/rate/forward/backward edits and restart evaluate recorded anchors',()=>{
  const f=fixture(),e=f.place('clock',3,{biologyEnabled:true,moisture:1});const def=f.model.resolvedDef(e.def);
  const anchor=anchorBiology(e.state,def,0),old={origin:0,dayTicks:72000};
  const tick=36000,hour=biologyHourAt(tick,old);close(hour,12);
  const faster=clockConfig(tick,36000,old).dayConfig;close(biologyHourAt(tick,faster),hour);
  const slower=clockConfig(tick,144000,old).dayConfig;close(biologyHourAt(tick,slower),hour);assert.equal(slower.origin,-36000);
  const paused={origin:Math.round(tick-hour/24*2**40),dayTicks:2**40,pausedAtTick:tick};
  close(biologyHourAt(tick,paused),biologyHourAt(tick+1e8,paused));
  close(biologyAt(anchor,24).w,1/3);close(biologyAt(anchor,6).w,1/12);
  const transition=waterBiology({...e.state,...anchor},def,24,1);
  close(biologyAt(transition,12).w,transition.biologyWilt);
  f.apply([{op:'set',id:e.id,state:transition}]);const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(f.model.snapshot())),undefined,f.model.library);
  assert.deepEqual(biologyAt(biologyOf(restored.get('clock').state,def),30),biologyAt(transition,30));
  f.apply([{op:'set',id:e.id,state:{biologyEnabled:false}}]);const before=structuredClone(f.model.get('clock').state);
  assert.deepEqual(dryingOps(f.model,10,300),[]);assert.deepEqual(f.model.get('clock').state,before);
});
