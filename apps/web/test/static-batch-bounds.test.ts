import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {StaticBatchOwner} from '../src/rendering/StaticBatchOwner.ts';
import {frozenMatrixWorld} from '../src/rendering/FrozenMatrixWorld.ts';

function fixture(){
 const scene=new THREE.Scene(),root=new THREE.Group(),material=new THREE.MeshStandardMaterial();
 const a=new THREE.Mesh(new THREE.BoxGeometry(),material),b=a.clone();b.position.x=3;root.add(a,b);scene.add(root);
 return {scene,root,material,a,b};
}

test('complete-root prefix keeps a complete first root when the next exceeds the mesh cap; strict still rejects',async()=>{
 const f=fixture(),later=f.root.clone();later.position.x=100;f.scene.add(later);const owner=new StaticBatchOwner(f.scene,{maxMeshes:3});
 await assert.rejects(owner.prepare([f.root,later],{generation:1}),/mesh-budget/);
 await assert.rejects(owner.prepare([f.root,later],{generation:1,budgetPolicy:'partial-cells/1'}),/mesh-budget/,'a geometry-byte policy does not permit partial source selection');
 await owner.prepare([f.root,later],{generation:2,sourcePolicy:'complete-roots/1',hideWholeRoots:true});
 assert.equal(owner.inspection().batches,1);assert.equal(owner.inspection().sourceTruncated,true);assert.equal(owner.inspection().roots,1);
 owner.withRender(()=>{assert.equal(f.root.visible,false);assert.equal(later.visible,true);assert.ok(later.children.every(o=>o.visible));});owner.dispose();
});

test('input limit counts duplicate records before deduplication and never reads the tail',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene,{maxRootInputs:4});let read=0;
 const roots=new Proxy(Array.from({length:64},()=>f.root),{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key)){read++;assert.ok(Number(key)<4,'input tail was read');}return Reflect.get(target,key,receiver);}});
 await owner.prepare(roots,{generation:1,sourcePolicy:'complete-roots/1'});
 assert.equal(read,8,'four visits plus four final input identity checks');assert.equal(owner.inspection().rootInputs,4);assert.equal(owner.inspection().sourceTruncated,true);assert.equal(owner.inspection().batchedMeshes,2);owner.dispose();
});

test('a node cap never traverses the unrelated scene or an oversized root tail',async()=>{
 const f=fixture(),unrelated=new THREE.Group();f.scene.add(unrelated);unrelated.updateMatrixWorld=()=>{throw Error('unselected scene traversal');};
 const giant=new THREE.Group();for(let i=0;i<40;i++)giant.add(new THREE.Group());f.scene.add(giant);
 let read=0;giant.children=new Proxy(giant.children,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key)){read++;assert.ok(Number(key)<12,'oversized child tail was read');}return Reflect.get(target,key,receiver);}});
 const owner=new StaticBatchOwner(f.scene,{maxNodes:12});await owner.prepare([f.root,giant],{generation:1,sourcePolicy:'complete-roots/1'});
 assert.equal(owner.inspection().batchedMeshes,2);assert.ok(read<=12);assert.equal(owner.inspection().sourceTruncated,true);
 owner.withRender(()=>{assert.equal(f.a.visible,false);assert.equal(giant.visible,true);});owner.dispose();
});

test('old validation revokes whole-root hiding without entering a newly grown branch',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1,hideWholeRoots:true});
 owner.withRender(()=>assert.equal(f.root.visible,false),1);
 const grown=new THREE.Group();f.root.add(grown);grown.updateWorldMatrix=()=>{throw Error('new branch matrix walk');};
 grown.children=new Proxy([],{get(target,key,receiver){if(key===Symbol.iterator||typeof key==='string'&&/^\d+$/.test(key))throw Error('new branch children read');return Reflect.get(target,key,receiver);}});
 owner.withRender(()=>{assert.equal(f.root.visible,true);assert.equal(grown.visible,true);assert.equal(f.a.visible,false);assert.equal(owner.inspection().usedLastRender,1);},2);owner.dispose();
});

for(const change of ['attribute','topology','matrix'] as const)test(`a source ${change} mutation after a real MessageChannel pause keeps the previous accepted set`,async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});const live=[...owner.group.children],clone=f.a.geometry.clone;let changed=false;
 f.a.geometry.clone=function(){const copy=clone.call(this);queueMicrotask(()=>{changed=true;if(change==='attribute')this.attributes.position.needsUpdate=true;else if(change==='topology')f.root.add(new THREE.Group());else f.root.position.x=5;});return copy;};
 await assert.rejects(owner.prepare([f.root],{generation:2,sliceMs:0}),/source-changed/);
 assert.equal(changed,true);assert.equal(owner.inspection().generation,1);assert.deepEqual(owner.group.children,live);f.a.geometry.clone=clone;owner.dispose();
});

test('a giant first root yields no partial batch and every bounded counter stops at its ceiling',async()=>{
 const f=fixture();for(let i=0;i<100;i++)f.root.add(new THREE.Group());const owner=new StaticBatchOwner(f.scene,{maxNodes:8});
 await owner.prepare([f.root],{generation:1,sourcePolicy:'complete-roots/1'});const state=owner.inspection();
 assert.equal(state.batches,0);assert.equal(state.roots,0);assert.equal(state.sourceTruncated,true);
 assert.ok(state.sourceNodes+state.ancestorNodes<=8);assert.ok(state.topologyLinks<=8);assert.ok(state.matrixUpdates<=4*8);
 owner.withRender(()=>assert.ok(f.root.visible&&f.a.visible&&f.b.visible));
 await assert.rejects(owner.prepare([f.root],{generation:2}),/node-budget/);assert.equal(owner.inspection().generation,1);owner.dispose();
});

test('strict input overflow preserves accepted geometry and explicit duplicate-prefix selection reuses it',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene,{maxRootInputs:2});await owner.prepare([f.root],{generation:1});const accepted=owner.group.children[0];
 await assert.rejects(owner.prepare([f.root,f.root,f.root],{generation:2}),/input-budget/);assert.equal(owner.group.children[0],accepted);
 await owner.prepare([f.root,f.root,f.root],{generation:3,sourcePolicy:'complete-roots/1',incremental:true});
 assert.equal(owner.group.children[0],accepted);assert.equal(owner.inspection().rootInputs,2);assert.equal(owner.inspection().reusedBatches,1);owner.dispose();
});

test('overlapping roots in either order visit each subtree once and never duplicate or omit a draw',async()=>{
 for(const innerFirst of [true,false]){
  const f=fixture(),inner=new THREE.Group(),c=f.a.clone(),d=f.b.clone();inner.add(c,d);f.root.add(inner);
  const owner=new StaticBatchOwner(f.scene,{maxNodes:10});
  f.root.traverse=inner.traverse=()=>{throw Error('recursive traversal is forbidden');};
  await owner.prepare(innerFirst?[inner,f.root,inner]:[f.root,inner,f.root],{generation:1,hideWholeRoots:true});
  assert.equal(owner.inspection().batchedMeshes,4);assert.equal(owner.inspection().sourceMeshes,4);assert.equal(owner.inspection().rootInputs,3);
  owner.withRender(()=>{const drawn=new Set<THREE.Object3D>();f.scene.traverseVisible(o=>drawn.add(o));for(const m of [f.a,f.b,c,d])assert.equal(drawn.has(m),false);assert.equal(owner.inspection().usedLastRender,1);});
  for(const o of [f.root,inner,f.a,f.b,c,d])assert.equal(o.visible,true);owner.dispose();
 }
});

test('long and cyclic ancestor chains fail within the work allowance without invoking any recursive matrix method',async()=>{
 const f=fixture();let parent:THREE.Object3D=f.scene;
 for(let i=0;i<30;i++){const next=new THREE.Group();parent.add(next);parent=next;}parent.add(f.root);
 const owner=new StaticBatchOwner(f.scene,{maxNodes:8});await owner.prepare([f.root],{generation:1,sourcePolicy:'complete-roots/1'});
 assert.equal(owner.inspection().batches,0);assert.equal(owner.inspection().ancestorNodes,8);assert.equal(owner.inspection().matrixUpdates,0);
 const a=new THREE.Group(),b=new THREE.Group();a.parent=b;b.parent=a;f.root.parent=a;
 await assert.rejects(owner.prepare([f.root],{generation:2}),/source-cycle/);assert.equal(owner.inspection().generation,1);
 a.parent=b.parent=null;f.root.parent=parent;owner.dispose();
});

test('frozen descendants follow a moved parent and retain exact scene-relative geometry',async()=>{
 const f=fixture();f.scene.position.set(10,2,-4);f.root.position.set(2,1,0);f.a.position.set(1,0,0);f.scene.updateMatrixWorld(true);
 for(const o of [f.a,f.b]){o.updateMatrix();o.matrixAutoUpdate=false;}f.root.updateMatrixWorld=frozenMatrixWorld;
 const owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});f.root.position.x=7;
 owner.withRender(()=>assert.equal(owner.group.visible,false),2);
 await owner.prepare([f.root],{generation:2});const batch=owner.group.children[0] as THREE.Mesh;
 const positions=batch.geometry.attributes.position,source=f.a.geometry.attributes.position;
 for(let i=0;i<source.count;i++){assert.ok(Math.abs(positions.getX(i)-(source.getX(i)+8))<1e-6);assert.ok(Math.abs(positions.getY(i)-(source.getY(i)+1))<1e-6);assert.equal(positions.getZ(i),source.getZ(i));}
 assert.equal(f.a.matrixWorld.elements[12],18,'the native third force argument updates a frozen child under a moved parent');
 owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();
});

test('manual local and manual world matrices are preserved, including children of a manual-world parent',async()=>{
 const f=fixture();f.scene.position.x=10;f.root.matrixAutoUpdate=false;f.root.matrix.makeTranslation(4,0,0);
 f.a.matrixAutoUpdate=false;f.a.matrix.makeTranslation(2,0,0);f.b.matrixWorldAutoUpdate=false;f.b.matrixWorld.makeTranslation(21,0,0);
 const owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});
 assert.equal(f.a.matrixWorld.elements[12],16);assert.equal(f.b.matrixWorld.elements[12],21);assert.equal(owner.inspection().batches,1);
 const manual=f.b.matrixWorld.clone();owner.withRender(()=>assert.equal(f.a.visible,false));assert.ok(f.b.matrixWorld.equals(manual));
 f.root.matrixWorldAutoUpdate=false;f.root.matrixWorld.makeTranslation(50,0,0);await owner.prepare([f.root],{generation:2});
 assert.equal(f.a.matrixWorld.elements[12],52);assert.equal(f.b.matrixWorld.elements[12],21);assert.equal(f.root.matrixWorld.elements[12],50);owner.dispose();
});

test('unsupported matrix hooks keep their complete root on originals and never run during preparation',async()=>{
 for(const hook of ['updateWorldMatrix','updateMatrix','updateMatrixWorld'] as const){
  const f=fixture(),other=f.root.clone();other.position.x=100;f.scene.add(other);let calls=0;
  f.a[hook]=()=>{calls++;throw Error('unsupported hook invoked');};const owner=new StaticBatchOwner(f.scene);
  await owner.prepare([f.root,other],{generation:1});assert.equal(calls,0);assert.equal(owner.inspection().batchedMeshes,2);
  owner.withRender(()=>{assert.equal(f.a.visible,true);assert.equal(other.children[0].visible,false);});assert.equal(calls,0);owner.dispose();
 }
});

test('same-length child replacement revokes coverage and reparenting never follows a new giant ancestor chain',async()=>{
 const f=fixture(),old=new THREE.Group();old.visible=false;f.root.add(old);const owner=new StaticBatchOwner(f.scene);
 await owner.prepare([f.root],{generation:1,hideWholeRoots:true});owner.withRender(()=>assert.equal(f.root.visible,false),1);
 const replacement=new THREE.PointLight();replacement.parent=f.root;f.root.children[2]=replacement;
 replacement.updateWorldMatrix=()=>{throw Error('replacement subtree visited');};
 owner.withRender(()=>{assert.equal(f.root.visible,true);assert.equal(f.a.visible,false);assert.equal(replacement.visible,true);},2);
 const giant=new THREE.Group();giant.updateWorldMatrix=()=>{throw Error('new ancestry visited');};f.root.parent=giant;
 owner.withRender(()=>{assert.equal(owner.group.visible,false);assert.equal(f.a.visible,true);},3);f.root.parent=f.scene;owner.dispose();
});

for(const change of ['attribute-array','index-array','program','plain-colour','input-array'] as const)test(`final checks reject ${change} mutations across real pauses`,async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene),roots=[f.root];let key='one';f.material.customProgramCacheKey=()=>key;
 const plain=change==='plain-colour';await owner.prepare(roots,{generation:1,sharePlainMaterials:plain});const live=[...owner.group.children];
 const attribute=f.a.geometry.attributes.position as THREE.BufferAttribute,clone=plain?attribute.clone:f.a.geometry.clone;let changed=false;
 const mutate=()=>{changed=true;if(change==='attribute-array')attribute.array=new Float32Array(attribute.array);else if(change==='index-array')f.a.geometry.index!.array=new Uint16Array(f.a.geometry.index!.array);else if(change==='program')key='two';else if(change==='plain-colour')f.material.color.set('red');else roots[0]=new THREE.Group();};
 if(plain)attribute.clone=function(){const copy=(clone as typeof attribute.clone).call(this);queueMicrotask(mutate);return copy;};
 else f.a.geometry.clone=function(){const copy=(clone as typeof f.a.geometry.clone).call(this);queueMicrotask(mutate);return copy;};
 await assert.rejects(owner.prepare(roots,{generation:2,sliceMs:0,sharePlainMaterials:plain}),/source-changed/);assert.equal(changed,true);assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);owner.dispose();
});

test('a later final material hook cannot publish an earlier source mutated by that hook',async()=>{
 const f=fixture(),other=new THREE.Group(),material=f.material.clone(),c=new THREE.Mesh(new THREE.BoxGeometry(),material),d=c.clone();c.position.x=100;d.position.x=103;other.add(c,d);f.scene.add(other);
 const owner=new StaticBatchOwner(f.scene);let attached=false;material.customProgramCacheKey=()=>{if(attached)f.a.position.x=4;return 'stable';};
 await owner.prepare([f.root,other],{generation:1});const live=[...owner.group.children];
 const onAdd=()=>{attached=true;};owner.group.addEventListener('childadded',onAdd);
 await assert.rejects(owner.prepare([f.root,other],{generation:2}),/source-changed/);assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);owner.group.removeEventListener('childadded',onAdd);owner.dispose();
});

test('matrix work stays linear in saved nodes across many real yields and excludes discarded roots at validation',async()=>{
 const f=fixture(),later=new THREE.Group();for(let i=0;i<25;i++)later.add(new THREE.Group());f.scene.add(later);
 let calls=0;for(const o of [f.scene,f.root,f.a,f.b,later,...later.children]){const multiply=o.matrixWorld.multiplyMatrices;o.matrixWorld.multiplyMatrices=function(a,b){calls++;return multiply.call(this,a,b);};}
 const owner=new StaticBatchOwner(f.scene,{maxNodes:12});await owner.prepare([f.root,later],{generation:1,sourcePolicy:'complete-roots/1',sliceMs:0});
 assert.equal(owner.inspection().sourceTruncated,true);assert.ok(calls<=4*12);calls=0;
 owner.withRender(()=>assert.equal(f.a.visible,false),1);assert.equal(calls,3,'only the accepted root and two source matrices multiply during validation');
 calls=0;owner.withRender(()=>assert.equal(f.a.visible,false),1);assert.equal(calls,0,'unchanged trusted revision skips the bounded validation');owner.dispose();
});

test('a source enlarged after a real yield is rejected before cloning the changed geometry',async()=>{
 const f=fixture();f.b.geometry=f.b.geometry.clone();const owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});const live=[...owner.group.children];
 const clone=f.a.geometry.clone;let tailCopies=0;
 f.a.geometry.clone=function(){const copy=clone.call(this);queueMicrotask(()=>f.b.geometry.setAttribute('extra',new THREE.Float32BufferAttribute(new Float32Array(300),3)));return copy;};
 f.b.geometry.clone=function(){tailCopies++;throw Error('changed geometry was cloned');};
 await assert.rejects(owner.prepare([f.root],{generation:2,sliceMs:0}),/source-changed/);assert.equal(tailCopies,0);assert.deepEqual(owner.group.children,live);owner.dispose();
});

test('repeated bounded failures preserve one accepted set and never dispose source geometry',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene,{maxNodes:10});await owner.prepare([f.root],{generation:1,sharePlainMaterials:true});const live=[...owner.group.children];
 let disposed=0;f.a.geometry.addEventListener('dispose',()=>disposed++);const giant=new THREE.Group();for(let i=0;i<30;i++)giant.add(new THREE.Group());f.scene.add(giant);
 for(let generation=2;generation<=10;generation++){
  await assert.rejects(owner.prepare([f.root,giant],{generation,sharePlainMaterials:true}),/node-budget/);
  assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);assert.equal(owner.inspection().preparing,false);assert.equal(disposed,0);
  owner.withRender(()=>assert.equal(f.a.visible,false));
 }
 owner.dispose();assert.equal(disposed,0);assert.equal(owner.group.children.length,0);
});
