import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldRtsCamera,farLimit,clickPivotPose,CLICK_PIVOT_DELAY_MS,LOOK_BLEND_SECONDS,NEAR_LIMIT} from '../src/WorldRtsCamera.ts';
import {liftHorizon,BROADCAST_HORIZON_LIFT} from '../src/broadcast-horizon.ts';
import {manualCameraStep,MANUAL_FAR_LIMIT} from '../src/WorldNavigation.ts';
import {CAMERA_GROUND_MARGIN} from '../src/WorldCameraGround.ts';

/** A manual camera over a flat 2000 m ground plane at y = 0, looking down ~24° at a pivot 76 m away. */
function rig(opts:{mode?:'manual'|'broadcast'|'follow';extent?:readonly [number,number,number,number]|null}={}){
  const win=new EventTarget(),doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null as unknown,hidden:false,querySelector:()=>null});
  const canvas=Object.assign(new EventTarget(),{ownerDocument:doc,focus(){doc.activeElement=canvas;},setPointerCapture(){},hasPointerCapture(){return false;},
    getBoundingClientRect:()=>({left:0,top:0,width:1600,height:900})}) as unknown as HTMLCanvasElement;
  const scene=new THREE.Scene(),ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial());scene.add(ground);scene.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(45,16/9,.1,2400);camera.position.set(0,31,70);
  const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(0,0,0),maxPolarAngle:Math.PI}) as unknown as OrbitControls;
  camera.lookAt(controls.target);camera.updateMatrixWorld();canvas.focus();
  let mode=opts.mode??'manual',homes=0,takeovers=0;
  const rts=new WorldRtsCamera(canvas,camera,{controls:()=>controls,mode:()=>mode,takeOver:()=>{mode='manual';takeovers++;},scene:()=>scene,pickRoots:()=>[],
    extent:()=>opts.extent===undefined?[-200,-200,200,200]:opts.extent,home:()=>{homes++;}});
  const fire=(type:string,fields:Record<string,unknown>={},surface:EventTarget=canvas)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{clientX:800,clientY:450,deltaY:0,deltaMode:0,ctrlKey:false,code:'',key:'',button:0,pointerId:1,...fields});surface.dispatchEvent(e);return e;};
  const pitch=()=>{const d=camera.getWorldDirection(new THREE.Vector3());return Math.asin(d.y)*180/Math.PI;};
  const settle=(n=40)=>{for(let i=0;i<n;i++){rts.update(1/60);camera.lookAt(controls.target);}};
  return {canvas,camera,controls,rts,fire,pitch,settle,win,homes:()=>homes,takeovers:()=>takeovers,mode:()=>mode};
}

test('C1 zoom: wheel out to the far limit and back in keeps the chosen pitch exactly', () => {
  const f=rig();try{
    const p0=f.pitch();
    for(let i=0;i<60;i++){f.fire('wheel',{deltaY:100});f.settle(6);}
    f.settle(60);
    const far=f.camera.position.distanceTo(f.controls.target);
    assert.ok(Math.abs(far-farLimit([-200,-200,200,200]))<.5,`far ${far}`);
    assert.ok(Math.abs(f.pitch()-p0)<.05,`pitch out ${f.pitch()} vs ${p0}`);
    for(let i=0;i<90;i++){f.fire('wheel',{deltaY:-100});f.settle(6);}
    f.settle(60);
    assert.ok(Math.abs(f.pitch()-p0)<.05,`pitch in ${f.pitch()} vs ${p0}`);
    assert.ok(f.camera.position.y>=CAMERA_GROUND_MARGIN,'never below the ground margin');
    const near=f.camera.position.distanceTo(f.controls.target);assert.ok(near>=NEAR_LIMIT-1e-6&&near<6,`near ${near}`);
  }finally{f.rts.dispose();}
});

test('C1 zoom: a notch is about 12% of the distance, eased; Broadcast is taken over; Follow keeps OrbitControls', () => {
  const f=rig({mode:'broadcast'});try{
    const d0=f.camera.position.distanceTo(f.controls.target);f.fire('wheel',{deltaY:100});
    assert.equal(f.mode(),'manual');assert.equal(f.takeovers(),1);
    f.rts.update(1/60);const first=f.camera.position.distanceTo(f.controls.target);
    assert.ok(first>d0&&first<d0*1.06,'eased: the first frame takes only part of the step');
    f.settle(60);assert.ok(Math.abs(f.camera.position.distanceTo(f.controls.target)/d0-Math.exp(.12))<1e-3);
  }finally{f.rts.dispose();}
  const g=rig({mode:'follow'});try{const e=g.fire('wheel',{deltaY:100});assert.equal(e.defaultPrevented,false);g.settle(10);
    assert.ok(Math.abs(g.camera.position.distanceTo(g.controls.target)-Math.hypot(31,70))<1e-9);}finally{g.rts.dispose();}
});

test('C1 zoom: toward the ground under the cursor stops at the ground margin instead of re-tilting', () => {
  const f=rig();try{
    const p0=f.pitch();
    for(let i=0;i<200;i++){f.fire('wheel',{deltaY:-100,clientX:800,clientY:850});f.settle(4);}
    assert.ok(Math.abs(f.pitch()-p0)<.05,`same pitch ${f.pitch()} vs ${p0}`);
    assert.ok(f.camera.position.y>=CAMERA_GROUND_MARGIN-1e-6&&f.camera.position.y<CAMERA_GROUND_MARGIN+.5,`stopped just above the margin: ${f.camera.position.y}`);
  }finally{f.rts.dispose();}
});

test('C1 far limit follows the map size, between 320 m and MANUAL_FAR_LIMIT', () => {
  assert.equal(farLimit(null),320);assert.equal(farLimit([-50,-50,50,50]),320);
  assert.equal(farLimit([-256,-256,256,256]),640);assert.equal(farLimit([-900,-900,900,900]),MANUAL_FAR_LIMIT);
});

// Test ID kept from main; the assertions are the B1 design (the pivot is the clicked point, the eye never moves).
test('CAMERA-PIVOT math: the pivot becomes the clicked point; the eye keeps its offset (no turn, no jump)', () => {
  const eye=new THREE.Vector3(0,31,70);
  for(const point of [new THREE.Vector3(40,0,-25),new THREE.Vector3(-120,3.5,60),new THREE.Vector3(5,12,5)]){
    const to=clickPivotPose(eye,point);
    assert.deepEqual(to.pivot.toArray(),point.toArray());assert.deepEqual(to.eye.toArray(),eye.toArray(),'the eye is bit-identical');
  }
});

// Test ID kept from main; the assertions are the B1 design (pivot = clicked point, eye unmoved, 0.3 s re-aim).
test('CAMERA-PIVOT click: after the double-click window the camera glides so the clicked point is the pivot', async () => {
  const f=rig();const frame=(dt=1/60)=>{f.rts.update(dt);f.camera.lookAt(f.controls.target);f.rts.afterControls();f.camera.updateMatrixWorld();};
  try{
    for(const [x,y] of [[400,700],[1200,620]] as const){
      const eye=f.camera.position.clone(),from=f.rts.pivot.clone(),ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x/1600*2-1,-(y/900)*2+1),f.camera);const expected=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3())!;
      f.rts.clickPivot({clientX:x,clientY:y,pointerType:'mouse'});frame();
      assert.ok(f.rts.pivot.distanceTo(from)<1e-9,'nothing happens inside the double-click window');
      await new Promise(r=>setTimeout(r,CLICK_PIVOT_DELAY_MS+30));
      assert.ok(f.rts.pivot.distanceTo(expected)<.02,`pivot ${f.rts.pivot.toArray()} is the clicked point`);
      frame(LOOK_BLEND_SECONDS/2);assert.ok(Math.abs(f.rts.headLook.yaw)+Math.abs(f.rts.headLook.pitch)>0,'re-aiming, not snapped');
      for(let i=0;i<30;i++)frame();
      assert.deepEqual(f.camera.position.toArray(),eye.toArray(),'the eye never moves');
      const centre=new THREE.Raycaster();centre.setFromCamera(new THREE.Vector2(0,0),f.camera);assert.ok(centre.ray.distanceToPoint(f.rts.pivot)<1e-6,'the view re-aimed onto the pivot');
    }
  }finally{f.rts.dispose();}
});

test('CAMERA-PIVOT: Follow and Broadcast ignore a click', async () => {
  for(const mode of ['follow','broadcast'] as const){
    const f=rig({mode});try{
      const eye=f.camera.position.clone(),t=f.controls.target.clone();
      f.rts.clickPivot({clientX:400,clientY:700,pointerType:'mouse'});await new Promise(r=>setTimeout(r,CLICK_PIVOT_DELAY_MS+30));f.settle(30);
      assert.ok(f.controls.target.distanceTo(t)<1e-9&&f.camera.position.distanceTo(eye)<1e-9,mode);assert.equal(f.mode(),mode);
    }finally{f.rts.dispose();}
  }
});

test('C1: Home/H goes to the overview; WASD speed grows with height; the pivot stays over the map', () => {
  const f=rig();try{
    f.fire('keydown',{code:'KeyH'},f.win);assert.equal(f.homes(),1);f.fire('keydown',{code:'Home'},f.win);assert.equal(f.homes(),2);
    const w=new Set(['KeyW']);
    assert.ok(Math.abs((manualCameraStep(w,1).forward??0)-.1*3)<1e-9,'dt is capped at .1 s');
    assert.ok(Math.abs((manualCameraStep(w,.1,10).forward??0)-3)<1e-9);
    assert.ok(Math.abs((manualCameraStep(w,.1,.2).forward??0)-.3)<1e-9,'never slower than the base');
    // #660: the guard holds the eye one far limit (here 500 m) beyond the map, not the pivot 100 m out: a lost-camera guard
    f.controls.target.set(5000,0,0);f.camera.position.set(5000,31,70);f.rts.update(1/60);
    assert.equal(f.controls.target.x,700);assert.equal(f.camera.position.x,700);
  }finally{f.rts.dispose();}
});

test('C1 broadcast: the aim lifts toward the horizon by the tunable fraction, same eye and distance', () => {
  const eye=[0,10,0],at=[0,0,-10/Math.tan(25*Math.PI/180)],lifted=liftHorizon(eye,at);
  const d=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  assert.ok(Math.abs(d(eye,lifted)-d(eye,at))<1e-9);
  const pitch=Math.atan2(lifted[1]-eye[1],Math.hypot(lifted[0]-eye[0],lifted[2]-eye[2]))*180/Math.PI;
  assert.ok(Math.abs(pitch+25*(1-BROADCAST_HORIZON_LIFT))<1e-9,String(pitch));
  assert.deepEqual(liftHorizon(eye,[0,12,-5]),[0,12,-5],'an upward look is unchanged');
  assert.deepEqual(liftHorizon(eye,at,0),at);
});

test('#660: held WASD crosses the old wall (map edge + max(60 m, quarter map)) forward and sideways', () => {
  const f=rig();try{
    // the old wall for a [-200, 200] map sat at ±300 m; start 20 m inside it, then hold W, then D from a second position
    f.controls.target.set(0,0,-280);f.camera.position.set(0,31,-210);f.camera.lookAt(f.controls.target);f.settle(2);
    f.fire('keydown',{code:'KeyW',key:'w'},f.win);f.settle(600);f.fire('keyup',{code:'KeyW',key:'w'},f.win);f.settle(2);
    assert.ok(f.controls.target.z<-330,`forward passes the old wall: ${f.controls.target.z}`);
    f.controls.target.set(280,0,0);f.camera.position.set(280,31,70);f.camera.lookAt(f.controls.target);f.settle(2);
    f.fire('keydown',{code:'KeyD',key:'d'},f.win);f.settle(600);f.fire('keyup',{code:'KeyD',key:'d'},f.win);f.settle(2);
    assert.ok(f.controls.target.x>330,`sideways passes the old wall: ${f.controls.target.x}`);
  }finally{f.rts.dispose();}
});

test('#660: a pivot far ahead of the eye (a click near the horizon) never stops WASD nor moves the camera by itself', () => {
  const f=rig();try{
    // eye inside the map, pivot 650 m ahead (past the edge + far limit): nothing moves without input, then W walks
    f.camera.position.set(0,8,0);f.controls.target.set(0,0,-650);f.camera.lookAt(f.controls.target);f.settle(30);
    assert.equal(f.camera.position.z,0,'no input, no movement');
    f.fire('keydown',{code:'KeyW',key:'w'},f.win);f.settle(300);f.fire('keyup',{code:'KeyW',key:'w'},f.win);f.settle(2);
    assert.ok(f.camera.position.z<-10,`W walks the eye forward: ${f.camera.position.z}`);
  }finally{f.rts.dispose();}
});
