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

test('PERF-PASSES: a mesh inside a frozen thing keeps its world sphere while the freeze lasts; the same answers, and it follows a thaw and a move', () => {
  const s=scene(),detail=new WorldDistanceDetail(PHONE_DETAIL);
  // the far cup and the bench hang from "things" the layer froze: userData.frozenDrawn with a `frozen` list that a new freeze replaces
  const thing=new THREE.Group();s.root.add(thing);thing.add(s.far,s.bench);let frozen:{frozen?:unknown}={frozen:[]};thing.userData.frozenDrawn=frozen;s.root.updateMatrixWorld(true);
  detail.apply(s.root,s.camera,844);
  assert.equal(s.far.visible,false);assert.equal(s.bench.castShadow,false);assert.equal(s.near.visible,true);detail.restore();
  const cands=(detail as unknown as {candidates:{mesh:THREE.Mesh;w?:{list:unknown}}[]}).candidates;
  assert.ok(cands.find(c=>c.mesh===s.far)!.w&&cands.find(c=>c.mesh===s.far)!.w!.list===frozen.frozen,'the far cup cached its world sphere against the freeze');
  assert.equal(cands.find(c=>c.mesh===s.near)!.w,undefined,'a loose mesh caches nothing');
  // the thing thaws (its list goes), moves next to the camera, and freezes again with a new list: the cup is seen at its new place
  frozen.frozen=undefined;thing.position.set(0,0,195);s.root.updateMatrixWorld(true);
  detail.apply(s.root,s.camera,844);assert.equal(s.far.visible,true,'thawed: read from its matrix again');detail.restore();
  frozen={frozen:[]};thing.userData.frozenDrawn=frozen;detail.apply(s.root,s.camera,844);assert.equal(s.far.visible,true);assert.equal(cands.find(c=>c.mesh===s.far)!.w!.list,frozen.frozen,'cached against the new freeze');detail.restore();
  // while frozen the cache is trusted: the camera moving is still followed (distance is per frame)
  s.camera.position.set(0,2,400);s.root.updateMatrixWorld(true);detail.apply(s.root,s.camera,844);assert.equal(s.far.visible,false,'a 10 cm cup 205 m away');detail.restore();
});

test('shared ancestors are read once per apply, with current visibility and nearest freeze marker on every frame',()=>{
  const root=new THREE.Scene(),outer=new THREE.Group(),inner=new THREE.Group(),camera=new THREE.PerspectiveCamera(45,390/844,.1,2400);
  root.add(outer);outer.add(inner);camera.position.set(0,2,0);
  let shown=true,reads=0,freezeReads=0,mark:{frozen?:unknown}={frozen:[]};
  Object.defineProperty(outer,'visible',{get:()=>{reads++;return shown;},set:v=>{shown=v;},configurable:true});
  Object.defineProperty(outer.userData,'frozenDrawn',{get:()=>{freezeReads++;return mark;},configurable:true});
  const nested:unknown[]=[],meshes:THREE.Mesh[]=[];inner.userData.frozenDrawn={frozen:nested};
  for(let i=0;i<128;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.1,8,4),new THREE.MeshBasicMaterial());m.position.set(0,2,-200);m.castShadow=true;inner.add(m);meshes.push(m);}
  root.updateMatrixWorld(true);const detail=new WorldDistanceDetail(PHONE_DETAIL);
  const candidates=()=>((detail as unknown as {candidates:{w?:{list:unknown}}[]}).candidates);
  detail.apply(root,camera,844);assert.equal(reads,1);assert.equal(freezeReads,1);assert.ok(meshes.every(m=>!m.visible));assert.ok(candidates().every(c=>c.w?.list===nested),'nearest marker still wins');detail.restore();
  shown=false;reads=freezeReads=0;detail.apply(root,camera,844);assert.equal(reads,1);assert.ok(meshes.every(m=>m.visible),'hidden ancestor is skipped, without changing its children');detail.restore();
  shown=true;mark={};delete inner.userData.frozenDrawn;outer.position.z=195;root.updateMatrixWorld(true);reads=freezeReads=0;
  detail.apply(root,camera,844);assert.equal(reads,1);assert.equal(freezeReads,1);assert.ok(meshes.every(m=>m.visible&&m.castShadow));assert.ok(candidates().every(c=>!c.w),'thaw is seen on the next apply');detail.restore();
  mark={frozen:[]};detail.apply(root,camera,844);assert.ok(candidates().every(c=>c.w?.list===mark.frozen));detail.dispose();
});

test('ancestor memo preserves scan ownership and parent-mesh culling, then replaces ancestry at the next scan',()=>{
  const root=new THREE.Scene(),group=new THREE.Group(),hidden=new THREE.Group(),camera=new THREE.PerspectiveCamera(45,390/844,.1,2400);
  root.add(group,hidden);hidden.visible=false;camera.position.set(0,2,0);
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(.1,8,4),new THREE.MeshBasicMaterial()),child=new THREE.Mesh(new THREE.SphereGeometry(8,8,4),new THREE.MeshBasicMaterial());
  mesh.position.set(0,2,-200);mesh.castShadow=child.castShadow=true;mesh.add(child);group.add(mesh);root.updateMatrixWorld(true);
  const detail=new WorldDistanceDetail({...PHONE_DETAIL,rescanFrames:2});detail.apply(root,camera,844);
  assert.equal(mesh.visible,false);assert.equal(child.visible,true);assert.equal(child.castShadow,true,'child is skipped after its parent mesh is culled');detail.restore();
  hidden.add(mesh);root.updateMatrixWorld(true);detail.apply(root,camera,844);assert.equal(mesh.visible,false,'between scans, ancestry follows the existing candidate inventory');detail.restore();
  detail.apply(root,camera,844);assert.equal(mesh.visible,true,'new scan sees the hidden parent and skips the mesh');assert.equal(child.castShadow,true);detail.dispose();
  assert.equal((detail as unknown as {candidates:unknown[]}).candidates.length,0,'disposing releases the candidate-owned ancestor memo');
});
