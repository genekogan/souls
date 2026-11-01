import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldDistanceDetail} from './WorldDistanceDetail.ts';
import {PHONE_DETAIL,pickQualityTier} from './quality-tier.ts';

test('quality tier: phones get the phone tier, desktops and overrides as asked', () => {
  assert.equal(pickQualityTier({search:'',coarsePointer:true,screen:[390,844]}).tier,'phone');
  assert.equal(pickQualityTier({search:'',coarsePointer:true,screen:[1024,1366]}).tier,'full');   // a large tablet keeps full detail
  assert.equal(pickQualityTier({search:'',coarsePointer:false,screen:[390,844]}).tier,'full');    // a narrow desktop window is not a phone
  assert.equal(pickQualityTier({search:'',coarsePointer:true,screen:[1280,800],deviceMemory:2}).tier,'phone');
  assert.equal(pickQualityTier({search:'?quality=full',coarsePointer:true,screen:[390,844]}).tier,'full');
  assert.equal(pickQualityTier({search:'?quality=phone',coarsePointer:false,screen:[2560,1440]}).tier,'phone');
  const full=pickQualityTier({search:'',coarsePointer:false,screen:[1440,900]});
  assert.deepEqual([full.maxPixelRatio,full.shadowMapSize],[2,2048]);   // desktop: same pixels and shadows
  assert.ok(full.detail&&full.detail.minRadiusPx<=1,'desktop: distance detail under one CSS pixel (PERF-EDEN)');
  assert.equal(pickQualityTier({search:'?desktopDetail=0',coarsePointer:false,screen:[1440,900]}).detail,null);
});

function scene(){
  const root=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,390/844,0.1,2400);camera.position.set(0,2,0);camera.lookAt(0,2,-1);
  const box=(r:number,z:number,name:string)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(r,8,4),new THREE.MeshBasicMaterial());m.name=name;m.position.set(0,2,z);m.castShadow=true;root.add(m);return m;};
  const near=box(0.1,-5,'cup near'),far=box(0.1,-200,'cup far'),house=box(8,-200,'house far'),bench=box(1,-80,'bench mid');
  const body=new THREE.SkinnedMesh(new THREE.SphereGeometry(0.1,8,4),new THREE.MeshBasicMaterial());body.position.set(0,2,-300);root.add(body);
  const sky=box(0.1,-500,'sky');sky.frustumCulled=false;
  root.updateMatrixWorld(true);
  return {root,camera,near,far,house,bench,body,sky};
}

test('distance detail: far small meshes are not drawn and small far casters drop their shadow, render-time only', () => {
  const s=scene(),detail=new WorldDistanceDetail(PHONE_DETAIL);
  detail.apply(s.root,s.camera,844);
  // a 10 cm cup at 200 m is 0.2 px of radius on a phone: not drawn; the same cup at 5 m and an 8 m house at 200 m are
  assert.equal(s.far.visible,false);assert.equal(s.near.visible,true);assert.equal(s.house.visible,true);
  assert.equal(s.bench.visible,true);assert.equal(s.bench.castShadow,false);   // 1 m bench at 80 m: drawn, no shadow
  assert.equal(s.near.castShadow,true);assert.equal(s.house.castShadow,true);
  assert.equal(s.body.visible,true);assert.equal(s.sky.visible,true);         // bodies and unculled overlays untouched
  assert.equal(detail.stats.culled,1);assert.equal(detail.stats.shadowSkipped,1);
  detail.restore();
  assert.equal(s.far.visible,true);assert.equal(s.bench.castShadow,true);
});

test('distance detail: follows moving and scaled meshes and the camera', () => {
  const s=scene(),detail=new WorldDistanceDetail(PHONE_DETAIL);
  s.far.scale.setScalar(50);s.root.updateMatrixWorld(true);   // a 5 m object at 200 m is kept
  detail.apply(s.root,s.camera,844);assert.equal(s.far.visible,true);detail.restore();
  s.far.scale.setScalar(1);s.camera.position.set(0,2,-195);s.root.updateMatrixWorld(true);
  detail.apply(s.root,s.camera,844);assert.equal(s.far.visible,true);assert.equal(s.near.visible,false);detail.restore();
  assert.equal(s.near.visible,true);
});

test('far bodies stay drawn but stop casting shadows on phones; near bodies and desktops keep them', () => {
  const s=scene();s.body.castShadow=true;
  const nearBody=new THREE.SkinnedMesh(new THREE.SphereGeometry(0.4,8,4),new THREE.MeshBasicMaterial());nearBody.position.set(0,1,-10);nearBody.castShadow=true;s.root.add(nearBody);s.root.updateMatrixWorld(true);
  const phone=new WorldDistanceDetail(PHONE_DETAIL);phone.apply(s.root,s.camera,844);
  assert.equal(s.body.visible,true);assert.equal(s.body.castShadow,false);assert.equal(nearBody.castShadow,true);assert.equal(phone.stats.bodyShadowsSkipped,1);
  phone.restore();assert.equal(s.body.castShadow,true,'restored after the frame');
  // PERF-EDEN: the desktop tier too stops a body 300 m away from casting (beyond 60 m); the release-3.1 tier (?desktopDetail=1) keeps every body's shadow
  const desk=new WorldDistanceDetail(pickQualityTier({search:'',coarsePointer:false,screen:[1440,900]}).detail!);desk.apply(s.root,s.camera,900);
  assert.equal(s.body.castShadow,false);assert.equal(nearBody.castShadow,true);assert.equal(desk.stats.bodyShadowsSkipped,1);desk.restore();assert.equal(s.body.castShadow,true);
  const old=new WorldDistanceDetail(pickQualityTier({search:'?desktopDetail=1',coarsePointer:false,screen:[1440,900]}).detail!);old.apply(s.root,s.camera,900);
  assert.equal(s.body.castShadow,true);assert.equal(old.stats.bodyShadowsSkipped,0);old.restore();
});
