// M01 (Soul Actions maintenance): unrelated world edits keep the 2 Hz lamp-pool gate, a lamp switch still repaints on
// its own frame, halos refresh from known publishers without a scene walk, and a held door leaf is written only when its
// depicted angle changes.
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {registerHooks} from 'node:module';
import {WorldModel,coreLibrary,applyBatch} from '@souls/world-compiler';
import {GodWorldLiving} from './world-env.ts';
import {handActuatorFrame,HAND_OPEN_ANGLE,HAND_REACH_SECONDS,type HandActuatorMotion} from '../../../mars/viewer/engine/social/hand-actuator.ts';

async function fixture(){
 (globalThis as {location?:unknown}).location??=new URL('http://offline.invalid/w/fixture');
 const index=new URL('./gen-mesh/index.ts',import.meta.url).href;
 const hook=registerHooks({load(url,ctx,next){return url===index?{format:'module',shortCircuit:true,source:"export {meshFor} from './registry.ts';"}:next(url,ctx);}});
 const {WorldEntityLayer}=await import('./WorldEntityLayer.ts').finally(()=>hook.deregister());await import('./gen-mesh/kit.mesh.ts');
 const model=new WorldModel({constants:{ground:'land',extent:350},seed:'m01'});model.library=coreLibrary();
 const r=applyBatch(model,{ops:[{op:'place',def:'core/floor-lamp@2',name:'lamp',p:[3,0]},{op:'place',def:'core/door@2',name:'door',p:[-3,0]}]},'god',1);assert.equal(r.result.accepted,true,JSON.stringify(r.result));
 const layer=new WorldEntityLayer(p=>p),inner=layer as unknown as {model:WorldModel;draw:(e:unknown,ease:boolean)=>void;drawn:Map<string,{obj:THREE.Object3D}>;now:number};inner.model=model;layer.active=true;(layer as unknown as {seq:number}).seq=0;inner.now=1000;
 const lamp=model.get('lamp')!,door=model.get('door')!;inner.draw(lamp,false);inner.draw(door,false);
 const living=new GodWorldLiving(layer);living.update(1000,0);
 const diff=(seq:number,e:typeof lamp,state:Record<string,unknown>)=>({type:'edge',kind:'world-diff',seq,by:'god',diff:{upserts:[{...e,state:{...e.state,...state}}],removes:[],defs:[],tiles:[]}});
 return {model,layer,inner,lamp,door,living,diff};
}

test('M01: unrelated edits wait for the 2 Hz pool gate; a lamp switch still repaints on the same frame',async()=>{
 const f=await fixture();const scans=f.living.scans,lightSeq=f.layer.lightSeq;assert.equal(f.living.lights,1);
 for(let i=1;i<=5;i++){f.layer.applyEdge([f.diff(i,f.door,{open:i%2===1})]);f.living.update(1000+i*16,0);}
 assert.equal(f.layer.lightSeq,lightSeq,'a door edit is not lamp-relevant');assert.equal(f.living.scans,scans,'five unrelated edits inside 500 ms: no full entity scan');
 f.living.update(1600,0);assert.equal(f.living.scans,scans+1,'the gated scan still follows unrelated edits (main behaviour)');
 f.layer.applyEdge([f.diff(6,f.lamp,{on:false})]);assert.equal(f.layer.lightSeq,lightSeq+1);
 f.living.update(1616,0);assert.equal(f.living.scans,scans+2,'lamp switch: immediate scan');assert.equal(f.living.lights,0,'pool gone on that frame');
 f.living.dispose();
});

test('M01: a held leaf is written only when its depicted angle changes, and ends at the swing angle',async()=>{
 const f=await fixture(),stats=f.layer.stats,leaf=()=>f.inner.drawn.get(f.door.id)!.obj.getObjectByName('role:door')!;
 const m:HandActuatorMotion={target:f.door.id,at:[-3,1,0],startTick:100,opening:{hinge:[-3.5,0,0],yaw:0,radius:.88,height:2.1,handleY:1.04,from:0,to:HAND_OPEN_ANGLE,side:1,bodyPolicy:'door-natural-v2'}};
 const entities={a:{state:{handActuator:m}},b:{state:{}}},w0=stats.leafWrites;
 f.layer.drawHandActuators(entities,100,.05);f.layer.drawHandActuators(entities,100,.05);assert.equal(stats.leafWrites-w0,1,'same depicted tick twice: one write');
 for(let t=101;t<100+HAND_REACH_SECONDS/.05;t++)f.layer.drawHandActuators(entities,t,.05);assert.equal(stats.leafWrites-w0,1,'reach: the leaf has not moved, no writes');
 let writes=stats.leafWrites,t=113;for(;t<200;t++){const before=handActuatorFrame(m,(t-1-100)*.05).angle,now=handActuatorFrame(m,(t-100)*.05).angle;f.layer.drawHandActuators(entities,t,.05);assert.equal(stats.leafWrites-writes,now===before?0:1);writes=stats.leafWrites;assert.equal(leaf().rotation.y,now);}
 assert.ok(Math.abs(leaf().rotation.y-HAND_OPEN_ANGLE)<1e-9,'release/idle keep the opened angle');
 f.inner.draw({...f.door,state:{...f.door.state,open:true}},false);f.layer.drawHandActuators(entities,t,.05);assert.ok(Math.abs(leaf().rotation.y-HAND_OPEN_ANGLE)<1e-9,'a redrawn leaf gets the depicted angle');
 f.living.dispose();
});

test('M01: a switched publisher refreshes halos without walking the scene; a detached one still triggers a full collect',async()=>{
 (globalThis as {location?:unknown}).location??=new URL('http://offline.invalid/w/fixture');const {createWorldAtmosphere}=await import('./WorldAtmosphere.ts');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),source=new THREE.Group(),other=new THREE.Group();
 source.userData.edenLightSources=[[0,0,0,'lamp',1],[3,0,0,'lamp',1]];other.userData.edenLightSources=[[9,0,0,'lamp',1]];scene.add(source,other);
 for(let i=0;i<500;i++)scene.add(new THREE.Object3D());
 const atmosphere=createWorldAtmosphere(scene),frame=(seconds:number)=>atmosphere.update({seconds,dt:1/30,clock:'2026-10-15T21:00:00',daylight:0,camera,eden:true,profile:'world',reducedMotion:true});
 try{
  frame(0);const halos=scene.getObjectByName('atmosphere: lamp glow') as THREE.InstancedMesh,collects=atmosphere.inspect().lightCollects,refreshes=atmosphere.inspect().lightRefreshes;assert.equal(halos.count,3);
  source.userData.edenLightSources=[[0,0,0,'lamp',1]];frame(.01);assert.equal(halos.count,2);
  assert.equal(atmosphere.inspect().lightCollects,collects,'no scene walk for a switch');assert.equal(atmosphere.inspect().lightRefreshes,refreshes+1);
  frame(.02);assert.equal(atmosphere.inspect().lightRefreshes,refreshes+1,'unchanged frames do nothing');
  other.removeFromParent();frame(.03);assert.equal(halos.count,1);assert.equal(atmosphere.inspect().lightCollects,collects+1,'a detached publisher: full collect');
 }finally{atmosphere.dispose();}
});
