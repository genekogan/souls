import test from 'node:test';import assert from 'node:assert/strict';
import {handActuator,actuatorPoint,handActuatorFrame,handSwingSeconds,HAND_OPEN_ANGLE,HAND_REACH_SECONDS,HAND_RELEASE_SECONDS,HAND_IDLE_HANDOFF_SECONDS,type HandActuatorMotion} from '../social/hand-actuator.ts';
for(const side of [1,-1] as const)for(const radius of [.88,1.035,2])test(`held leaf clears its operator and walking speed: side ${side}, radius ${radius}`,()=>{
 const m:HandActuatorMotion={target:'door',at:[0,1,0],startTick:100,opening:{hinge:[-.5,0,0],yaw:0,radius,height:2.1,handleY:1.04,from:0,to:HAND_OPEN_ANGLE,side}};
 let prev=actuatorPoint(m.opening!,0).root,maximum=0;
 for(let n=1;n<200;n++){const t=n*.05,f=handActuatorFrame(m,t),a=actuatorPoint(m.opening!,f.angle),dx=a.root[0]+.5,dz=a.root[2],c=Math.cos(f.angle),s=Math.sin(f.angle),along=Math.max(0,Math.min(radius+.12,dx*c-dz*s));const d=Math.hypot(dx-along*c,dz+along*s);assert.ok(d>.40,'actual body point clears the independent line-segment leaf');maximum=Math.max(maximum,Math.hypot(a.root[0]-prev[0],a.root[2]-prev[2])/.05);prev=a.root;if(f.done)break;}
 assert.ok(maximum<=1.21,`physical speed ${maximum}`);
 const releaseAt=HAND_REACH_SECONDS+handSwingSeconds(m);assert.equal(handActuatorFrame(m,releaseAt).weight,1);const weights=[.1,.25,.4,.55,.69].map(t=>handActuatorFrame(m,releaseAt+t).weight);assert.ok(weights.every((k,i)=>k>0&&k<1&&(i===0||k<weights[i-1])));assert.equal(handActuatorFrame(m,releaseAt+HAND_RELEASE_SECONDS).weight,0);
});
test('light contact is held then lowered smoothly, not an activity-id reset',()=>{const m={target:'lamp',at:[0,1,0] as [number,number,number],startTick:0};assert.equal(handActuatorFrame(m,.64).contact,false);assert.equal(handActuatorFrame(m,.65).contact,true);assert.equal(handActuatorFrame(m,.65).weight,1);assert.ok(handActuatorFrame(m,1).weight>.1);assert.equal(handActuatorFrame(m,1.35).weight,0);});

import {Runtime} from '../runtime/runtime.ts';import {DEFAULT_INVARIANTS} from '../runtime/invariants.ts';import {Spatial} from '../spatial/service.ts';import {provingGround} from '../scenes/proving-ground.ts';import {emptyWorld,human,addAll} from '../world/factory.ts';
function fixture(){const scene=provingGround(),world=addAll(emptyWorld('proving-ground',scene),human('a',-6,-6)),registry=new Map([[handActuator.verb,handActuator]]);return {scene,registry,rt:new Runtime(world,registry,{spatial:new Spatial(scene)},DEFAULT_INVARIANTS)};}
test('mid-reach checkpoint restores the same hands, root, phase and terminal state tick for tick',()=>{const {rt,scene,registry}=fixture();const a=rt.submit('hand_actuator_v1',{actor:'a',target:'lamp',at:[-5.5,1.04,-6]});assert.equal(a.status,'executing');for(let i=0;i<8;i++)rt.step();const copy=Runtime.restore(rt.snapshot(),registry,{spatial:new Spatial(scene)},DEFAULT_INVARIANTS);for(let i=0;i<60;i++){rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());assert.deepEqual(copy.violations,[]);assert.deepEqual(rt.violations,[]);}assert.equal(a.status,'completed');assert.equal(rt.world.entities.a.human!.handActuator,undefined);});
test('cancelling a partly raised hand keeps a gradual release before native cancellation completes',()=>{const {rt}=fixture();const a=rt.submit('hand_actuator_v1',{actor:'a',target:'lamp',at:[-5.5,1.04,-6]});for(let i=0;i<5;i++)rt.step();rt.cancel(a.id);assert.ok(rt.isActive(a.id),'release owns the hand until it is down');const weights:number[]=[];while(rt.isActive(a.id)){rt.step();const m=rt.world.entities.a.human!.handActuator;if(m)weights.push(handActuatorFrame(m,(rt.tick-m.startTick)*.05).weight);}assert.ok(weights.length>=10);assert.ok(weights.every((w,i)=>i===0||w<=weights[i-1]));assert.equal(a.status,'cancelled');assert.equal(rt.world.entities.a.human!.hands,undefined);assert.deepEqual(rt.violations,[]);});

test('pre-contact cancellation never starts a delayed door swing',()=>{const m:HandActuatorMotion={target:'door',at:[0,1,0],startTick:0,abortedAt:.3,abortWeight:.45,opening:{hinge:[-.5,0,0],yaw:0,radius:.88,height:2.1,handleY:1.04,from:0,to:HAND_OPEN_ANGLE,side:1}};for(let t=.3;t<1.1;t+=.05){const f=handActuatorFrame(m,t);assert.equal(f.angle,0);assert.equal(f.contact,false);}});

test('after the arm reaches rest, idle variants fade in before the contact owner releases the body',()=>{const m={target:'lamp',at:[0,1,0] as [number,number,number],startTick:0};const end=HAND_REACH_SECONDS+HAND_RELEASE_SECONDS;assert.equal(handActuatorFrame(m,end).idleBlend,0);assert.equal(handActuatorFrame(m,end).armDown,true);assert.ok(handActuatorFrame(m,end+HAND_IDLE_HANDOFF_SECONDS/2).idleBlend>.45);assert.equal(handActuatorFrame(m,end+HAND_IDLE_HANDOFF_SECONDS).idleBlend,1);assert.equal(handActuatorFrame(m,end+HAND_IDLE_HANDOFF_SECONDS).done,true);});

test('an existing idle gesture fades during reach instead of disappearing at the first contact frame',()=>{const m={target:'window',at:[0,1.2,0] as [number,number,number],startTick:0};assert.equal(handActuatorFrame(m,0).idleWeight,1);assert.ok(handActuatorFrame(m,.05).idleWeight>.98);assert.ok(handActuatorFrame(m,.325).idleWeight>.45);assert.equal(handActuatorFrame(m,.65).idleWeight,0);assert.equal(handActuatorFrame(m,2.55).idleWeight,1);});

for(const side of [1,-1] as const)for(const radius of [.88,1.035,2])test(`natural door keeps torso facing portal and clears full leaf: side ${side}, radius ${radius}`,()=>{
 const {rt}=fixture(),opening={hinge:[-6,0,-6] as [number,number,number],yaw:0,radius,height:2.1,handleY:1.04,from:0,to:HAND_OPEN_ANGLE,side,bodyPolicy:'door-natural-v2' as const},a=rt.world.entities.a;rt.services.spatial=new Spatial({...provingGround(),obstacles:[]});a.pose.p=actuatorPoint(opening,0).root;a.pose.yaw=side===1?-Math.PI/2:Math.PI/2;const start=[...a.pose.p],r=rt.submit('hand_actuator_v1',{actor:'a',target:'door',at:[-6,1,-6],opening});let minClear=Infinity,maxTurn=0;
 for(let i=0;i<220&&rt.isActive(r.id);i++){rt.step();const motion=a.human!.handActuator;if(!motion)continue;const f=handActuatorFrame(motion,(rt.tick-motion.startTick)*.05),x=a.pose.p[0]+6,z=a.pose.p[2]+6,c=Math.cos(f.angle),s=Math.sin(f.angle),along=Math.max(0,Math.min(radius+.12,x*c-z*s));minClear=Math.min(minClear,Math.hypot(x-along*c,z+along*s));maxTurn=Math.max(maxTurn,Math.abs(a.pose.yaw-(side===1?-Math.PI/2:Math.PI/2)));}
 assert.equal(r.status,'completed');assert.ok(minClear>.355,'body capsule clears actual finite leaf, not just its infinite plane');assert.ok(maxTurn<Math.PI/6,'torso never follows the leaf through90degrees');if(side===1)assert.ok(a.pose.p[2]>start[2]+.5,'pull takes a real backward step');else assert.ok(a.pose.p[2]>start[2]+.5,'push takes a real forward step');assert.deepEqual(rt.violations,[]);
});

test('natural policy active door restores held contact and modest facing tick for tick',()=>{const f=fixture();f.scene.obstacles=[];f.rt.services.spatial=new Spatial(f.scene);const o={hinge:[-6,0,-6] as [number,number,number],yaw:0,radius:.88,height:2.1,handleY:1.04,from:0,to:HAND_OPEN_ANGLE,side:1 as const,bodyPolicy:'door-natural-v2' as const};f.rt.world.entities.a.pose.p=actuatorPoint(o,0).root;const r=f.rt.submit('hand_actuator_v1',{actor:'a',target:'door',at:[-6,1,-6],opening:o});for(let i=0;i<25;i++)f.rt.step();const copy=Runtime.restore(f.rt.snapshot(),f.registry,{spatial:new Spatial(f.scene)},DEFAULT_INVARIANTS);for(let i=0;i<150;i++){f.rt.step();copy.step();assert.equal(copy.stateHash(),f.rt.stateHash())}assert.equal(r.status,'completed');assert.deepEqual(f.rt.violations,[]);});

import {handClearanceStats} from '../social/hand-actuator.ts';
// M01: clearance reads obstacles near the operation once per scene, not every obstacle in the world every tick.
function doorWith(obstacles:{id:string;obb:{c:[number,number];half:[number,number];yaw:number};y0:number;y1:number;kind:'component'}[]){
 const f=fixture(),o={hinge:[-6,0,-6] as [number,number,number],yaw:0,radius:.88,height:2.1,handleY:1.04,from:0,to:HAND_OPEN_ANGLE,side:1 as const,bodyPolicy:'door-natural-v2' as const};
 f.rt.services.spatial=new Spatial({...provingGround(),obstacles});f.rt.world.entities.a.pose.p=actuatorPoint(o,0).root;
 return {...f,o,r:f.rt.submit('hand_actuator_v1',{actor:'a',target:'door',at:[-6,1,-6],opening:o})};
}
const box=(id:string,x:number,z:number,h=.1)=>({id,obb:{c:[x,z] as [number,number],half:[h,h] as [number,number],yaw:0},y0:0,y1:2,kind:'component' as const});
test('M01: 400 distant obstacles add no per-tick clearance work; the door still completes',()=>{
 const far=Array.from({length:400},(_,i)=>box('far'+i,20+(i%20)*2,20+Math.floor(i/20)*2));
 const v0=handClearanceStats.obstaclesVisited,b0=handClearanceStats.candidateBuilds,{rt,r}=doorWith([...far,box('door#leaf',-5.6,-6),box('door',-6,-6)]);let steps=0;
 while(rt.isActive(r.id)&&steps<300){rt.step();steps++;}
 assert.equal(r.status,'completed');assert.deepEqual(rt.violations,[]);
 assert.equal(handClearanceStats.obstaclesVisited-v0,0,'distant obstacles and the target leaf are never visited per tick');
 assert.equal(handClearanceStats.candidateBuilds-b0,1,'one candidate filter for an unchanged scene');
});
test('M01: a nearby obstacle in the operating path still refuses with the same step-blocked diagnostic',()=>{
 const o={hinge:[-6,0,-6] as [number,number,number],yaw:0,radius:.88,height:2.1,handleY:1.04,from:0,to:HAND_OPEN_ANGLE,side:1 as const,bodyPolicy:'door-natural-v2' as const};
 const end=actuatorPoint(o,HAND_OPEN_ANGLE).root,far=Array.from({length:200},(_,i)=>box('far'+i,30+i,30));
 const {rt,r}=doorWith([...far,box('crate',end[0],end[2],.15)]);while(rt.isActive(r.id))rt.step();
 assert.equal(r.status,'failed');assert.equal(r.diagnostic?.code,'contact.step-blocked');assert.deepEqual(r.diagnostic?.subjects,['a','crate']);
});

import {strokePoint} from '../social/hand-actuator.ts';
// Entry 13: a writing/wiping hand stays on the face, moves continuously and commits only when the stroke ends.
for(const kind of ['write','wipe'] as const)for(const lines of [1,3])test(`board ${kind} stroke (${lines} line) is continuous and commits at its end`,()=>{
 const stroke={kind,yaw:.4,width:.55,height:.3,lines,seconds:kind==='write'?1.2+1.6*lines:2.4},m:HandActuatorMotion={target:'board',at:[1,1.2,2],startTick:0,stroke};
 const end=HAND_REACH_SECONDS+stroke.seconds;assert.equal(handActuatorFrame(m,end-.05).contact,false,'no effect while still writing');assert.equal(handActuatorFrame(m,end).contact,true);
 let prev=strokePoint(m.at,stroke,0),maxSpeed=0;const n=Math.round(stroke.seconds/.05);
 for(let i=1;i<=n;i++){const p=strokePoint(m.at,stroke,i/n);maxSpeed=Math.max(maxSpeed,Math.hypot(p[0]-prev[0],p[1]-prev[1],p[2]-prev[2])/.05);prev=p;
  const dx=p[0]-1,dz=p[2]-2,off=dx*Math.sin(.4)+dz*Math.cos(.4);assert.ok(off>=-1e-9&&off<.04,'hand stays on (or just off) the face plane');assert.ok(Math.abs(p[1]-1.2)<=.2,'within the face height');}
 assert.ok(maxSpeed<1.8,`hand speed ${maxSpeed}`);
});
// #428: a stroke on a sloped page (a notebook on a lectern): tilt 0 is the upright stroke exactly; a tilted stroke stays on
// the face's plane (rows up the page, away from the writer), continuous, at handwriting speed
test('tilted write and wipe strokes lie on the sloped page',()=>{
 const at:[number,number,number]=[1,1.2,2],tilt=Math.PI/2-.3,yaw=.7;
 for(const kind of ['write','wipe'] as const){
  const up={kind,yaw,width:.2,height:.05,lines:1,seconds:2},sl={...up,tilt},flat={...up,tilt:0};
  // the page's normal: sin(tilt) up plus cos(tilt) toward the writer (out of the face along the yaw)
  const n=[Math.cos(tilt)*Math.sin(yaw),Math.sin(tilt),Math.cos(tilt)*Math.cos(yaw)];let prev=strokePoint(at,sl,0),maxSpeed=0,offPlane=0;
  for(let i=0;i<=40;i++){const u=i/40,a=strokePoint(at,up,u),b=strokePoint(at,flat,u),p=strokePoint(at,sl,u);assert.deepEqual(a,b,'tilt 0 = upright');
   offPlane=Math.max(offPlane,Math.abs((p[0]-at[0])*n[0]+(p[1]-at[1])*n[1]+(p[2]-at[2])*n[2]));if(i){maxSpeed=Math.max(maxSpeed,Math.hypot(p[0]-prev[0],p[1]-prev[1],p[2]-prev[2])/.05);}prev=p;}
  assert.ok(offPlane<=.036,`${kind}: within the stroke's lift of the page (${offPlane})`);assert.ok(maxSpeed<1.2,`${kind}: ${maxSpeed} m/s`);
 }
});
