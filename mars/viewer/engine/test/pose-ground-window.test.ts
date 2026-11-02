import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {Spatial} from '../spatial/service.ts';
import {clearanceAt} from '../spatial/grid.ts';
import {poseV1} from '../social/pose.ts';
import {walkTo} from '../locomotion/walk.ts';
import {addAll,emptyWorld,human} from '../world/factory.ts';
import type {SpatialScene} from '../spatial/types.ts';
import type {GroundField} from '../spatial/ground.ts';
import type {ActionDef} from '../actions/types.ts';
function fixture(paged=false) {
  const scene:SpatialScene={bounds:paged?[-1024,-1024,1024,1024]:[-10,-10,10,10],levels:[{id:0,y:0,label:'ground'}],surfaces:paged?[]:[{id:'floor',level:0,y:0,obb:{c:[0,0],half:[10,10],yaw:0}}],obstacles:paged?[]:[-.5,.5].map((x,i)=>({id:'wall'+i,obb:{c:[x,0],half:[.1,5],yaw:0},y0:0,y1:2})),links:[]};
  const world=addAll(emptyWorld('pose-ground',scene),human('dancer',paged?800:.05,paged?0:.05),...(paged?[human('distant',0,0)]:[]));
  const spatial=new Spatial(scene,{cell:paged?.25:.1});spatial.sync(world);
  if(paged){const flat:GroundField={id:'pose-flat',extent:scene.bounds,wadeMax:.6,maxSlope:1,height:()=>0,waterLevel:()=>null,medium:()=>0,mediaTile:()=>new Uint8Array(4096)};spatial.setGround(flat,world,[[0,0],[800,0]],{paged:true});spatial.focusOn(world,'distant');}
  const registry=new Map<string,ActionDef>([[poseV1.verb,poseV1],[walkTo.verb,walkTo]]);
  return {world,spatial,rt:new Runtime(world,registry,{spatial},[])};
}
const plan=(rt:Runtime,activity='dance')=>poseV1.plan(rt,{actor:'dancer',activity,seconds:2});
test('pose admission queries its own paged ground even when another actor was read last',()=>{
  for(const activity of ['dance','sit-ground','lie']){
    const f=fixture(true),before=f.rt.stateHash();
    assert.equal(clearanceAt(f.spatial.level(0)!,[800,0]),0,'focused distant window cannot answer this point');
    assert.equal(plan(f.rt,activity).ok,true,activity+' on clear local ground');
    assert.equal(f.rt.stateHash(),before,'clearance query leaves canonical state unchanged');
    const builds=f.spatial.stats.gridBuilds;
    for(let i=0;i<5;i++)assert.equal(plan(f.rt,activity).ok,true);
    assert.equal(f.spatial.stats.gridBuilds,builds,'known ground is not rebuilt');
  }
});
test('solo dance needs ordinary standing space and never changes its root',()=>{
  const f=fixture(),at=[...f.world.entities.dancer.pose.p],clearance=clearanceAt(f.spatial.level(0)!,[.05,.05]);
  assert.ok(clearance>=.28&&clearance<.38,'fixture distinguishes standing from the old extra pose margin');
  assert.equal(walkTo.plan(f.rt,{actor:'dancer',x:.05,z:1.05}).ok,true,'ordinary walking fits');
  assert.equal(plan(f.rt).ok,true,'dance fits the standing body');
  const action=f.rt.submit('pose_v1',{actor:'dancer',activity:'dance',seconds:2});
  for(let i=0;i<45;i++){f.rt.step();assert.deepEqual(f.world.entities.dancer.pose.p,at);}
  assert.equal(action.status,'completed');
  assert.equal(plan(f.rt,'lie').ok,false,'lying still needs its larger envelope');
});
test('dance keeps physical obstacle, support, seating and movement refusals',()=>{
  const blocked=fixture();blocked.world.entities.dancer.pose.p[0]=.5;
  const wall=plan(blocked.rt);assert.equal(wall.ok,false);if(!wall.ok){assert.equal(wall.diagnostic.code,'pose.no-room');assert.match(wall.diagnostic.message,/standing room.*obstacle/);}
  const unsupported=fixture();unsupported.world.entities.dancer.human!.level=99;
  assert.equal(plan(unsupported.rt).ok,false,'unknown support level has no clearance reader');
  const seated=fixture();seated.world.entities.dancer.human!.activity='sit';
  const seat=plan(seated.rt);assert.equal(seat.ok,false);if(!seat.ok)assert.equal(seat.diagnostic.code,'pose.seated');
  const moving=fixture();moving.rt.submit('walk_to',{actor:'dancer',x:.05,z:1.05});
  const walk=plan(moving.rt);assert.equal(walk.ok,false);if(!walk.ok)assert.equal(walk.diagnostic.code,'pose.not-still');
  for(const key of ['riding','on','shore','carrier','sleepPose','boatPassenger']){
    const f=fixture();Object.assign(f.world.entities.dancer.human!,{[key]:'occupied-fixture'});
    const r=plan(f.rt);assert.equal(r.ok,false,key);if(!r.ok)assert.equal(r.diagnostic.code,'pose.occupied-support');
  }
});
test('paged query order and a cold recreated engine have the same dance continuation',()=>{
  const a=fixture(true),b=fixture(true);b.spatial.clearanceReader(0,[800,0])!([800,0]);
  for(const f of [a,b]){assert.equal(plan(f.rt).ok,true);f.rt.submit('pose_v1',{actor:'dancer',activity:'dance',seconds:2});}
  for(let tick=0;tick<45;tick++){a.rt.step();b.rt.step();assert.equal(a.rt.stateHash(),b.rt.stateHash());}
});
