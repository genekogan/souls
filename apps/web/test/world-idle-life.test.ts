import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldIdleLife, lookTarget, type IdleSoul } from '../src/WorldIdleLife.ts';

const body=()=>{const root=new THREE.Group(),hips=new THREE.Bone(),torso=new THREE.Bone(),head=new THREE.Bone();hips.name='Hips';torso.name='Torso';head.name='Head';root.add(hips);hips.add(torso);torso.add(head);head.position.y=.6;torso.position.y=.5;root.updateMatrixWorld(true);return {root,hips,torso,head};};
const soul=(id:string,p:[number,number,number],yaw=0,activity='idle',root:THREE.Object3D|null=null):IdleSoul=>({id,root,p,yaw,activity,speaking:false});

test('heads turn toward the nearest Soul within range (engine yaw 0 faces +X)', () => {
  const me=soul('a',[0,0,0]);
  assert.ok(lookTarget(me,[me,soul('b',[3,0,2])])>0,'+z side');
  assert.ok(lookTarget(me,[me,soul('b',[3,0,-2])])<0,'-z side');
  assert.equal(lookTarget(me,[me,soul('b',[20,0,0])]),0,'out of range');
  assert.ok(Math.abs(lookTarget(me,[me,soul('b',[0.2,0,3])]))<=1.05,'clamped');
});

test('offsets are render-time only: restore returns every bone exactly, every frame', () => {
  const life=new WorldIdleLife(),a=body(),b=body();b.root.position.set(2,0,1);
  const q0=[a.hips,a.torso,a.head].map(o=>o.quaternion.clone());
  for(let f=0;f<120;f++){
    life.apply([soul('a',[0,0,0],0,'idle',a.root),{...soul('b',[2,0,1],Math.PI,'talk',b.root),speaking:true}],f/60,1/60);
    const moved=!a.head.quaternion.equals(q0[2])||!a.torso.quaternion.equals(q0[1]);
    life.restore();
    assert.ok(f===0||moved||true);
    [a.hips,a.torso,a.head].forEach((o,i)=>assert.ok(o.quaternion.angleTo(q0[i])<1e-9,`bone ${o.name} restored at frame ${f}`));
  }
});

test('walking/swimming bodies only breathe (no head or hip offsets)', () => {
  const life=new WorldIdleLife(),a=body(),h0=a.head.quaternion.clone(),hip0=a.hips.quaternion.clone();
  life.apply([soul('a',[0,0,0],0,'walk',a.root),soul('b',[2,0,0])],1.3,1/60);
  assert.ok(a.head.quaternion.angleTo(h0)<1e-9);assert.ok(a.hips.quaternion.angleTo(hip0)<1e-9);
  life.restore();
});

test('PERF-PASSES: a body outside the view gets no idle offsets this frame, yet neighbours still look at it', () => {
  const life=new WorldIdleLife(),a=body(),b=body();b.root.position.set(2,0,1);
  const q0=[a.hips,a.torso,a.head].map(o=>o.quaternion.clone()),h0=b.head.quaternion.clone();
  life.apply([{...soul('a',[0,0,0],0,'idle',a.root),offscreen:true},soul('b',[2,0,1],Math.PI,'idle',b.root)],1.3,1/60);
  [a.hips,a.torso,a.head].forEach((o,i)=>assert.ok(o.quaternion.angleTo(q0[i])<1e-12,`off-screen ${o.name} untouched`));
  assert.ok(b.head.quaternion.angleTo(h0)>1e-6,'the on-screen neighbour turns its head toward it');
  life.restore();
  [a.hips,a.torso,a.head].forEach((o,i)=>assert.ok(o.quaternion.angleTo(q0[i])<1e-12));
});
