import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldRenderedVisibility} from '../src/WorldRenderedVisibility.ts';

const pose={position:[0,0,6],target:[0,0,-6],fov:50};
const subject={anchor:{p:[0,0,-6],yaw:0,points:[[0,0,-6]]}};
function stock(roots:THREE.Object3D[]){
 for(const root of roots)root.updateWorldMatrix(true,true);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,0,-6),new THREE.Vector3(0,0,1),.06,11.92);
 return ray.intersectObjects(roots,true).some(hit=>{
  for(let p:THREE.Object3D|null=hit.object;p;p=p.parent)if(!p.visible)return false;
  if(hit.object.userData.cameraTransparent===true)return false;
  const materials=(hit.object as THREE.Mesh).material,m=Array.isArray(materials)?materials[hit.face?.materialIndex??0]:materials;
  return !!m&&m.visible&&(!m.transparent||m.opacity>=.5);
 })?0:1;
}
function score(v:WorldRenderedVisibility,roots:THREE.Object3D[]){v.prepareFresh(roots);const value=v.score(pose,['anchor'],subject);assert.equal(value,stock(roots));return value;}
function fixture(){const root=new THREE.Group(),geometry=new THREE.PlaneGeometry(4,4,24,24),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);geometry.computeBoundingSphere();geometry.computeBoundingBox();root.add(mesh);return{root,geometry,material,mesh};}
// Inspect geometry identity only to prove expensive accelerator reuse/disposal;
// truth assertions always compare the current answer to stock THREE raycasts.
function caches(v:WorldRenderedVisibility){return (v as unknown as {instances:{cache:Map<THREE.Object3D,unknown>;meshCells:Map<THREE.Object3D,unknown>}}).instances;}

test('a repeated static speech query avoids rebuilding triangle buckets, without changing its answer',()=>{
 // Bucket building creates one indexed cell geometry per bucket (setIndex); counted instead of vertex reads since the
 // build reads plain position arrays directly (lane L3, phone arrival).
 const {root,geometry,material}=fixture(),v=new WorldRenderedVisibility(),setIndex=THREE.BufferGeometry.prototype.setIndex;
 let built=0;THREE.BufferGeometry.prototype.setIndex=function(this:THREE.BufferGeometry,i:Parameters<typeof setIndex>[0]){built++;return setIndex.call(this,i);};
 try{
  v.prepareFresh([root]);built=0;const first=v.score(pose,['anchor'],subject),builtCells=built;
  v.prepareFresh([root]);built=0;const second=v.score(pose,['anchor'],subject),rebuiltCells=built;
  assert.equal(first,stock([root]));assert.equal(second,first);assert.ok(builtCells>1,`cells built ${builtCells}`);assert.equal(rebuiltCells,0,`cells rebuilt ${rebuiltCells}`);
  console.log(JSON.stringify({staticTriangleCellsBuilt:{first:builtCells,retained:rebuiltCells},scope:'geometry query work only; not frame-time/FPS'}));
 }finally{THREE.BufferGeometry.prototype.setIndex=setIndex;}
 v.reset();geometry.dispose();material.dispose();
});

test('fresh speech decisions reuse static triangle cells, while opacity/visibility authority is current',()=>{
 const {root,geometry,material,mesh}=fixture(),v=new WorldRenderedVisibility();
 assert.equal(score(v,[root]),0);const cells=caches(v).meshCells.get(mesh);assert.ok(cells);
 assert.equal(score(v,[root]),0);assert.equal(caches(v).meshCells.get(mesh),cells);
 material.transparent=true;material.opacity=.1;assert.equal(score(v,[root]),1);assert.equal(caches(v).meshCells.get(mesh),cells);
 material.opacity=1;assert.equal(score(v,[root]),0);mesh.visible=false;assert.equal(score(v,[root]),1);assert.equal(caches(v).meshCells.has(mesh),false);
 mesh.visible=true;assert.equal(score(v,[root]),0);material.side=THREE.FrontSide;assert.equal(score(v,[root]),1);
 v.reset();geometry.dispose();material.dispose();
});

test('fresh speech batches discard old semantic decisions even when root and camera identities are unchanged',()=>{
 const {root,geometry,material,mesh}=fixture(),v=new WorldRenderedVisibility();
 v.prepareFresh([root]);const clearPose={position:[10,0,6],target:[10,0,-6],fov:50},points={anchor:{p:[10,0,-6],yaw:0,points:[[10,0,-6]]}};
 assert.equal(v.seen(clearPose,['anchor'],points),1);mesh.position.x=10;
 v.prepareFresh([root]);assert.equal(v.seen(clearPose,['anchor'],points),0,'a previous clear sightline cannot authorize the next batch');
 v.reset();geometry.dispose();material.dispose();
});

test('matrix bits, world pose, geometry replacement and instance count revalidate against stock',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(2,2,.3),material=new THREE.MeshBasicMaterial(),mesh=new THREE.InstancedMesh(geometry,material,8);
 for(let i=0;i<8;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i?20+i:0,0,0));geometry.computeBoundingSphere();mesh.computeBoundingSphere();root.add(mesh);const v=new WorldRenderedVisibility();
 assert.equal(score(v,[root]),0);const cache=caches(v).cache.get(mesh);assert.ok(cache);
 assert.equal(score(v,[root]),0);assert.equal(caches(v).cache.get(mesh),cache);
 mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(12,0,0));mesh.computeBoundingSphere();assert.equal(score(v,[root]),1);assert.notEqual(caches(v).cache.get(mesh),cache);
 mesh.position.x=-12;assert.equal(score(v,[root]),0);mesh.position.x=0;
 const replacement=new THREE.BoxGeometry(3,3,.4);replacement.computeBoundingSphere();mesh.geometry=replacement;mesh.setMatrixAt(0,new THREE.Matrix4());mesh.computeBoundingSphere();assert.equal(score(v,[root]),0);
 mesh.count=0;mesh.computeBoundingSphere();assert.equal(score(v,[root]),1);
 v.reset();geometry.dispose();replacement.dispose();material.dispose();
});

test('vertex/index versions and drawRange expire triangle cells; replaced bounds match stock without rebuilding',()=>{
 const {root,geometry,material,mesh}=fixture(),v=new WorldRenderedVisibility();
 assert.equal(score(v,[root]),0);const first=caches(v).meshCells.get(mesh);
 const position=geometry.attributes.position;for(let i=0;i<position.count;i++)position.setX(i,position.getX(i)+10);position.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();assert.equal(score(v,[root]),1);assert.equal(caches(v).meshCells.get(mesh),first,'whole-mesh rejection needs no eager cell rebuild');
 for(let i=0;i<position.count;i++)position.setX(i,position.getX(i)-10);position.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();assert.equal(score(v,[root]),0);assert.ok(caches(v).meshCells.get(mesh)!==first,'visible changed vertices rebuild before use');
 geometry.index!.needsUpdate=true;const previous=caches(v).meshCells.get(mesh);assert.equal(score(v,[root]),0);assert.ok(caches(v).meshCells.get(mesh)!==previous);
 geometry.setDrawRange(0,0);assert.equal(score(v,[root]),1);geometry.setDrawRange(0,Infinity);assert.equal(score(v,[root]),0);
 const retained=caches(v).meshCells.get(mesh);geometry.boundingBox=new THREE.Box3(new THREE.Vector3(8,-2,-.1),new THREE.Vector3(12,2,.1));assert.equal(score(v,[root]),1);assert.equal(caches(v).meshCells.get(mesh),retained);
 geometry.computeBoundingBox();assert.equal(score(v,[root]),0);v.reset();geometry.dispose();material.dispose();
});

test('removed descendants, replaced roots and teardown release all cached geometry references',()=>{
 const a=fixture(),b=fixture(),v=new WorldRenderedVisibility();score(v,[a.root]);assert.ok(caches(v).meshCells.has(a.mesh));
 a.root.remove(a.mesh);assert.equal(score(v,[a.root]),1);assert.equal(caches(v).meshCells.size,0);
 a.root.add(a.mesh);score(v,[a.root]);score(v,[b.root]);assert.equal(caches(v).meshCells.has(a.mesh),false);assert.ok(caches(v).meshCells.has(b.mesh));
 v.reset();assert.equal(caches(v).meshCells.size,0);assert.equal(caches(v).cache.size,0);assert.equal(v.score(pose,['anchor'],subject),1);
 for(const f of[a,b]){f.geometry.dispose();f.material.dispose();}
});

test('custom raycasts retain stock behavior after a cache was created',()=>{
 const {root,geometry,material,mesh}=fixture(),v=new WorldRenderedVisibility();score(v,[root]);let calls=0;
 mesh.raycast=()=>{calls++;};assert.equal(score(v,[root]),1);assert.equal(calls,2,'accelerated and stock queries both delegate the custom implementation');
 mesh.raycast=THREE.Mesh.prototype.raycast;assert.equal(score(v,[root]),0);v.reset();geometry.dispose();material.dispose();
});

test('PERF-PASSES: scores inside one evaluate() share a single bounds pass over the occluders, with the same answers',()=>{
 const {root,geometry,material}=fixture(),v=new WorldRenderedVisibility(),stats=(v as unknown as {instances:{stats:{boundsPasses:number}}}).instances.stats;
 const clearPose={position:[10,0,6],target:[10,0,-6],fov:50},clearSubject={anchor:{p:[10,0,-6],yaw:0,points:[[10,0,-6]]}};
 v.prepareFresh([root]);stats.boundsPasses=0;
 const separate=[v.score(pose,['anchor'],subject),v.score(clearPose,['anchor'],clearSubject),v.score(pose,['anchor'],subject)];
 assert.equal(stats.boundsPasses,3,'each score outside an evaluation takes its own pass');
 v.prepareFresh([root]);stats.boundsPasses=0;
 const shared=v.evaluate(()=>[v.score(pose,['anchor'],subject),v.score(clearPose,['anchor'],clearSubject),v.score(pose,['anchor'],subject)]);
 assert.equal(stats.boundsPasses,1,'one pass for the batch');
 assert.deepEqual(shared,separate);assert.deepEqual(separate,[0,1,0]);
 // a custom raycast among the objects (no instance caches) still shares the pass
 const odd=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());odd.position.set(30,0,0);odd.raycast=()=>{};root.add(odd);
 v.prepareFresh([root]);stats.boundsPasses=0;
 assert.deepEqual(v.evaluate(()=>[v.score(pose,['anchor'],subject),v.score(clearPose,['anchor'],clearSubject)]),[0,1]);assert.equal(stats.boundsPasses,1);
 v.reset();geometry.dispose();material.dispose();
});

test('PERF-PASSES: object bounds match Sphere.applyMatrix4 for scaled, rotated and non-finite matrices',()=>{
 const v=new WorldRenderedVisibility(),root=new THREE.Group();
 const g=new THREE.BoxGeometry(2,1,3);g.computeBoundingSphere();
 const a=new THREE.Mesh(g,new THREE.MeshBasicMaterial());a.position.set(3,-2,7);a.scale.set(2,.5,1.5);a.rotation.set(.3,1.1,-.7);
 const b=new THREE.Mesh(g,new THREE.MeshBasicMaterial());b.position.set(Infinity,0,0);
 root.add(a,b);root.updateMatrixWorld(true);
 v.prepareFresh([root]);
 const inner=(v as unknown as {instances:{bounds:Float64Array;boundsObjects:THREE.Object3D[]}}).instances;
 const [bounds,order]=v.evaluate(()=>[Float64Array.from(inner.bounds),[...inner.boundsObjects]] as const);
 const expect=new THREE.Sphere().copy(g.boundingSphere!).applyMatrix4(a.matrixWorld);
 const i=order.indexOf(a);assert.ok(i>=0&&order.indexOf(b)>=0);
 assert.ok(Math.abs(bounds[i*4]-expect.center.x)<1e-9&&Math.abs(bounds[i*4+1]-expect.center.y)<1e-9&&Math.abs(bounds[i*4+2]-expect.center.z)<1e-9,'centre');
 assert.ok(Math.abs(bounds[i*4+3]-(expect.radius*(1+1e-6)+1e-6))<1e-9,'radius');
 assert.ok(Number.isNaN(bounds[order.indexOf(b)*4+3]),'a non-finite matrix: never pre-rejected');
 v.reset();g.dispose();
});


test('visibility refresh respects frozen subtrees while updating live meshes before a draw',()=>{
 const root=new THREE.Group(),frozen=new THREE.Group(),geometry=new THREE.PlaneGeometry(4,4),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 const still=new THREE.Mesh(geometry,material),live=new THREE.Mesh(geometry,material);still.position.x=12;frozen.add(still);root.add(frozen,live);
 root.updateMatrixWorld(true);frozen.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;});
 const before=still.matrixWorld.clone();let frozenVisits=0,descendantVisits=0;
 frozen.updateMatrixWorld=()=>{frozenVisits++;};
 const update=still.updateMatrixWorld;still.updateMatrixWorld=function(force){descendantVisits++;update.call(this,force);};
 const v=new WorldRenderedVisibility();v.prepareFresh([root]);assert.equal(v.score(pose,['anchor'],subject),0);
 live.position.x=12;
 assert.equal(v.evaluate(()=>v.score(pose,['anchor'],subject)),1,'the live mesh moves before renderer.render');
 assert.equal(frozenVisits,2,'both refreshes use the frozen root contract');assert.equal(descendantVisits,0,'frozen descendants are not walked');assert.deepEqual(still.matrixWorld.elements,before.elements);
 v.reset();geometry.dispose();material.dispose();
});

test('visibility refresh updates ancestors and descendants through a root with a fixed local matrix',()=>{
 const scene=new THREE.Group(),{root,geometry,material,mesh}=fixture();scene.add(root);root.position.x=-3;root.updateMatrix();root.matrixAutoUpdate=false;
 const v=new WorldRenderedVisibility();v.prepareFresh([root]);assert.equal(v.score(pose,['anchor'],subject),1);
 scene.position.x=12;mesh.position.x=-9;
 assert.equal(v.evaluate(()=>v.score(pose,['anchor'],subject)),0);assert.equal(mesh.matrixWorld.elements[12],0);
 const actual=mesh.matrixWorld.clone();scene.updateMatrixWorld(true);assert.deepEqual(mesh.matrixWorld.elements,actual.elements,'the same world pose as renderer traversal');
 v.reset();geometry.dispose();material.dispose();
});

test('visibility refresh preserves manually supplied world matrices and updates their children',()=>{
 const {root,geometry,material,mesh}=fixture(),manual=new THREE.Group();root.remove(mesh);root.add(manual);manual.add(mesh);
 manual.matrixWorldAutoUpdate=false;manual.matrixWorld.makeTranslation(12,0,0);manual.position.x=40;mesh.position.x=-12;
 const v=new WorldRenderedVisibility();v.prepareFresh([root]);assert.equal(v.score(pose,['anchor'],subject),0);assert.equal(manual.matrixWorld.elements[12],12);
 manual.matrixWorld.makeTranslation(24,0,0);
 assert.equal(v.evaluate(()=>v.score(pose,['anchor'],subject)),1);assert.equal(manual.matrixWorld.elements[12],24);assert.equal(mesh.matrixWorld.elements[12],12);
 v.reset();geometry.dispose();material.dispose();
});

test('visible mesh collection prunes hidden branches, checks root ancestors and deduplicates overlapping roots',()=>{
 const {root,geometry,material,mesh}=fixture(),parent=new THREE.Group(),hidden=new THREE.Group(),transparent=new THREE.Mesh(geometry,material);parent.add(root);root.add(hidden,transparent);hidden.visible=false;transparent.userData.cameraTransparent=true;
 const hiddenMesh=new THREE.Mesh(geometry,material);hidden.add(hiddenMesh);const v=new WorldRenderedVisibility(),objects=()=>[...(v as unknown as {objects:THREE.Object3D[]}).objects];
 v.prepareFresh([root,mesh]);assert.deepEqual(objects(),[mesh]);assert.equal(v.score(pose,['anchor'],subject),stock([root]));
 parent.visible=false;v.prepareFresh([root,mesh]);assert.deepEqual(objects(),[]);assert.equal(v.score(pose,['anchor'],subject),stock([root]));
 parent.visible=true;hidden.visible=true;v.prepareFresh([root,hidden]);assert.deepEqual(objects(),[mesh,hiddenMesh]);assert.equal(v.score(pose,['anchor'],subject),stock([root]));
 v.reset();geometry.dispose();material.dispose();
});
