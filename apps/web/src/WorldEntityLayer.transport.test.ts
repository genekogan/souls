import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {registerHooks} from 'node:module';import {arrivalMark} from './arrival-marks.ts';
arrivalMark('card-done');
test('two-hand transport follows recorded native pose until persisted arrival, then releases override',async()=>{
 (globalThis as {location?:unknown}).location??=new URL('http://offline.invalid/w/fixture');
 const index=new URL('./gen-mesh/index.ts',import.meta.url).href,h=registerHooks({load(url,c,next){return url===index?{format:'module',shortCircuit:true,source:"export {meshFor} from './registry.ts';"}:next(url,c);}});
 const {WorldEntityLayer}=await import('./WorldEntityLayer.ts').finally(()=>h.deregister());const layer=new WorldEntityLayer(p=>p);layer.active=true;const a=layer as any;
 const entity={id:'load',name:'crate',def:'crate',in:{parent:'world'}},obj=new THREE.Group();a.thingsGroup.add(obj);a.model={entities:new Map([['load',entity]]),resolvedDef:()=>({tags:['upright-carry']}),ground:()=>({extent:[0,0,0,0]})};const zero=new THREE.Vector3();a.drawn.set('load',{obj,from:{p:zero,s:1},to:{p:zero.clone(),s:1},t0:0,dur:.001,defHash:'load',world:true,settled:true});
 const frame:any={body:{p:[0,0,0],yaw:0,state:{grip:{entity:'load'}}},load:{p:[3,.6,2],yaw:.8,state:{}}};
 layer.transportPoses(frame,['body']);layer.update(.016,30000);assert.deepEqual(obj.position.toArray(),[3,.6,2]);assert.ok(Math.abs(obj.rotation.y+.8)<1e-8);
 delete frame.body.state.grip;frame.load.p=[4,0,2];layer.transportPoses(frame,['body']);layer.update(.016,30016);assert.deepEqual(obj.position.toArray(),[4,0,2],'no snap back during final write-back lag');
 a.drawn.get('load').to.p.set(4,0,2);a.drawn.get('load').from.p.set(4,.07,2);frame.body.state.carryContactV1={item:'load'};layer.transportPoses(frame,['body']);layer.update(.016,30024);assert.equal(a.overrides.size,1,'release contact keeps native ownership even when world destination has arrived');assert.deepEqual(obj.position.toArray(),[4,0,2]);delete frame.body.state.carryContactV1;a.drawn.get('load').from.p.set(4,0,2);layer.transportPoses(frame,['body']);layer.update(.016,30032);assert.equal(a.transported.size,0);assert.equal(a.overrides.size,0);assert.deepEqual(obj.position.toArray(),[4,0,2]);
 // PC13 (#692): the recorded roll of a part being raised is drawn too, and let go of when the crew's hands leave it
 a.transported.clear();a.overrides.clear();a.overrideYaw.clear();obj.rotation.set(0,0,0);frame.body.state={grip:{entity:'load'}};frame.load={p:[3,1.8,2],yaw:.2,roll:1.1,state:{}};layer.transportPoses(frame,['body']);layer.update(.016,31000);assert.ok(Math.abs(obj.rotation.z-1.1)<1e-8,'turned');
 delete frame.body.state.grip;a.drawn.get('load').to.p.set(3,1.8,2);frame.load.roll=0;layer.transportPoses(frame,['body']);assert.equal(a.overrideRoll.has('load'),false);assert.equal(obj.rotation.z,0,'as the entity is');
 layer.dispose();
});
