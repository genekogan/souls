import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {StaticBatchOwner} from '../src/rendering/StaticBatchOwner.ts';

function fixture(){
 const scene=new THREE.Scene(),root=new THREE.Group(),material=new THREE.MeshStandardMaterial();
 const a=new THREE.Mesh(new THREE.BoxGeometry(),material),b=new THREE.Mesh(new THREE.BoxGeometry(),material);b.position.x=3;root.add(a,b);scene.add(root);
 return {scene,root,material,a,b};
}

test('pending and aborted preparation keep the accepted shader binding',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene),oldMaterial=f.material.clone(),nextMaterial=f.material.clone();
 const oldShader={material:()=>oldMaterial,attributes(){}},nextShader={material:()=>nextMaterial,attributes(){}};
 await owner.prepare([f.root],{generation:1,shaderMerge:oldShader});const live=[...owner.group.children];
 const abort=new AbortController(),pending=owner.prepare([f.root],{generation:2,shaderMerge:nextShader,sliceMs:0,signal:abort.signal});
 try{owner.withRender(()=>{assert.equal(f.a.visible,false,'pending shader policy must not invalidate the accepted batch');assert.equal(owner.inspection().usedLastRender,1);});}
 finally{abort.abort();await assert.rejects(pending,{name:'AbortError'});}
 assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);
 owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();oldMaterial.dispose();nextMaterial.dispose();
});

test('non-abort preparation failure retains the accepted set in both synchronous and sliced modes',async()=>{
 for(const sliceMs of [undefined,0]){
  const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1,hideWholeRoots:true});const live=[...owner.group.children];let disposed=0;
  (live[0] as THREE.Mesh).geometry.addEventListener('dispose',()=>disposed++);
  const clone=f.a.geometry.clone;f.a.geometry.clone=()=>{throw Error('copy failed');};
  await assert.rejects(owner.prepare([f.root],{generation:2,sliceMs}),/copy failed/);f.a.geometry.clone=clone;
  assert.equal(disposed,0,'failure must not retire accepted geometry');assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);
  owner.withRender(()=>{assert.equal(f.root.visible,false,'accepted root policy survives failure');assert.equal(owner.inspection().usedLastRender,1);});owner.dispose();
 }
});

test('obsolete owned plain materials are disposed after each accepted replacement',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);let sourceDisposals=0,retired=0;f.material.addEventListener('dispose',()=>sourceDisposals++);
 await owner.prepare([f.root],{generation:1,sharePlainMaterials:true});
 for(let generation=2;generation<=12;generation++){
  const previous=(owner.group.children[0] as THREE.Mesh).material as THREE.Material;previous.addEventListener('dispose',()=>retired++);
  f.material.roughness=generation/20;await owner.prepare([f.root],{generation,sharePlainMaterials:true});
  assert.equal(retired,generation-1,'each superseded owned material is released instead of retained until world teardown');
  assert.notEqual((owner.group.children[0] as THREE.Mesh).material,previous);assert.equal(sourceDisposals,0);
 }
 owner.dispose();assert.equal(sourceDisposals,0);
});

test('candidate material allocation is released after failure without disposing live or source materials',async(ctx)=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1,sharePlainMaterials:true});const live=owner.group.children[0] as THREE.Mesh,liveMaterial=live.material;
 const c=new THREE.Mesh(new THREE.BoxGeometry(),f.material),d=new THREE.Mesh(new THREE.BoxGeometry(),f.material);c.position.x=100;d.position.x=103;f.root.add(c,d);
 const disposed:THREE.Material[]=[],dispose=THREE.Material.prototype.dispose;ctx.mock.method(THREE.Material.prototype,'dispose',function(this:THREE.Material){disposed.push(this);dispose.call(this);});
 const geometries:THREE.BufferGeometry[]=[],disposeGeometry=THREE.BufferGeometry.prototype.dispose;ctx.mock.method(THREE.BufferGeometry.prototype,'dispose',function(this:THREE.BufferGeometry){geometries.push(this);disposeGeometry.call(this);});
 const position=c.geometry.attributes.position as THREE.BufferAttribute,clone=position.clone;position.clone=()=>{throw Error('later copy failed');};
 for(let generation=2;generation<=5;generation++){
  f.material.roughness=generation/10;await assert.rejects(owner.prepare([f.root],{generation,sharePlainMaterials:true,sliceMs:0}),/later copy failed/);
  assert.equal(disposed.length,generation-1,'failed candidate releases its newly owned material');assert.ok(!disposed.includes(liveMaterial as THREE.Material));assert.ok(!disposed.includes(f.material));assert.equal(owner.group.children[0],live);
  assert.equal(geometries.length,4*(generation-1),'two completed copies, one failed plain copy and one built batch are released per failure');assert.ok(!geometries.includes(live.geometry));assert.ok([f.a,f.b,c,d].every(m=>!geometries.includes(m.geometry)));
 }
 position.clone=clone;owner.dispose();assert.ok(!disposed.includes(f.material));
});

test('retirement callbacks see only the new accepted set and cannot reset it during commit',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});const old=owner.group.children[0] as THREE.Mesh;
 let callbacks=0;old.geometry.addEventListener('dispose',()=>{
  callbacks++;assert.equal(owner.inspection().generation,2,'new metadata is published before old disposal');assert.ok(!owner.group.children.includes(old),'retired meshes detach before callbacks');
  assert.throws(()=>owner.reset(),/commit|unavailable/);throw Error('retirement listener failed');
 });
 await owner.prepare([f.root],{generation:2});assert.equal(callbacks,1);assert.equal(owner.inspection().cleanupError,'retirement listener failed');assert.equal(owner.inspection().generation,2);assert.equal(owner.group.children.length,1);assert.notEqual(owner.group.children[0],old);
 owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();
});

test('an attachment callback failure rolls back only candidate meshes',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});const live=[...owner.group.children];
 const fail=()=>{throw Error('attachment listener failed');};owner.group.addEventListener('childadded',fail);
 try{await assert.rejects(owner.prepare([f.root],{generation:2,sliceMs:0}),/attachment listener failed/);}
 finally{owner.group.removeEventListener('childadded',fail);}
 assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();
});

test('a newer reentrant preparation wins without the obsolete candidate clearing its state',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});const derived=f.material.clone();let newer:Promise<unknown>|undefined;
 const shaderMerge={material:()=>derived,attributes(){newer??=owner.prepare([f.root],{generation:3});}};
 await assert.rejects(owner.prepare([f.root],{generation:2,shaderMerge}),{name:'AbortError'});await newer;
 assert.equal(owner.inspection().generation,3);assert.equal(owner.group.children.length,1);owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();derived.dispose();
});

test('an attachment listener cannot silently detach the candidate or start a reentrant commit',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});const live=[...owner.group.children];let reentrant:Promise<unknown>|undefined,attempted=false;
 const detach=()=>{if(!attempted){attempted=true;reentrant=owner.prepare([f.root],{generation:3});}owner.group.children.at(-1)?.removeFromParent();};owner.group.addEventListener('childadded',detach);
 try{await assert.rejects(owner.prepare([f.root],{generation:2}),/attachment-changed/);await assert.rejects(reentrant!,/unavailable/);}
 finally{owner.group.removeEventListener('childadded',detach);}
 assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();
});

test('retirement detaches every old batch and continues disposal after listener failures',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene),c=f.a.clone(),d=f.b.clone();c.position.x=100;d.position.x=103;f.root.add(c,d);
 await owner.prepare([f.root],{generation:1,sharePlainMaterials:true});const old=[...owner.group.children] as THREE.Mesh[];assert.equal(old.length,2);
 const seen:THREE.Object3D[][]=[];let geometries=0,materials=0;
 for(const mesh of old)mesh.geometry.addEventListener('dispose',()=>{geometries++;seen.push([...owner.group.children]);throw Error('old geometry listener');});
 (old[0].material as THREE.Material).addEventListener('dispose',()=>{materials++;throw Error('old material listener');});
 f.material.roughness=.3;await owner.prepare([f.root],{generation:2,sharePlainMaterials:true});
 assert.equal(geometries,2);assert.equal(materials,1);assert.equal(owner.inspection().cleanupError,'old geometry listener');assert.ok(seen.every(children=>children.length===2&&children.every(m=>!old.includes(m as THREE.Mesh))));
 const accepted=[...owner.group.children] as THREE.Mesh[];let finalGeometries=0,finalMaterials=0;
 for(const mesh of accepted)mesh.geometry.addEventListener('dispose',()=>{finalGeometries++;throw Error('final geometry listener');});
 (accepted[0].material as THREE.Material).addEventListener('dispose',()=>{finalMaterials++;throw Error('final material listener');});
 owner.dispose();assert.equal(finalGeometries,2);assert.equal(finalMaterials,1);assert.equal(owner.group.parent,null);assert.equal(owner.group.children.length,0);owner.dispose();assert.equal(finalGeometries,2);
});

test('working geometry budget includes the accepted set and counts incremental reuse once',async()=>{
 const f=fixture(),estimate=2*(Object.values(f.a.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+f.a.geometry.index!.count*4);
 const owner=new StaticBatchOwner(f.scene,{maxMergedBytes:estimate,maxWorkingBytes:2*estimate});await owner.prepare([f.root],{generation:1});const live=owner.group.children[0] as THREE.Mesh,bytes=owner.inspection().mergedBytes;let retired=0;live.geometry.addEventListener('dispose',()=>retired++);
 await assert.rejects(owner.prepare([f.root],{generation:2,sliceMs:0}),/geometry-budget/);assert.equal(owner.group.children[0],live);assert.equal(retired,0);
 await owner.prepare([f.root],{generation:3,incremental:true});assert.equal(owner.group.children[0],live);assert.equal(owner.inspection().reusedBatches,1);assert.equal(owner.inspection().workingGeometryPeakBytes,bytes);
 await owner.prepare([f.root],{generation:4,budgetPolicy:'partial-cells/1'});assert.equal(owner.inspection().batches,0);assert.equal(owner.inspection().budgetSkippedMeshes,2);assert.equal(owner.inspection().workingGeometryPeakBytes,bytes);assert.equal(retired,1);
 owner.withRender(()=>{assert.equal(f.root.visible,true);assert.equal(f.a.visible,true);assert.equal(f.b.visible,true);});owner.dispose();
});

function growingCells(){
 const f=fixture(),e=f.b.clone(),c=f.a.clone(),d=f.b.clone();e.position.x=6;c.position.x=100;d.position.x=103;f.root.add(e,c,d);
 const limits={maxMergedBytes:4400,maxWorkingBytes:20000},owner=new StaticBatchOwner(f.scene,limits);
 return {...f,e,c,d,limits,owner};
}

for(const budgetPolicy of [undefined,'partial-cells/1'] as const)test(`incremental merged-byte budget covers a later reused cell (${budgetPolicy??'strict'})`,async()=>{
 const f=growingCells(),{owner}=f;await owner.prepare([f.root],{generation:1});const live=[...owner.group.children];assert.equal(owner.inspection().batches,2);assert.equal(owner.inspection().mergedBytes,4200);
 // The three-source changed cell still has the better calls-saved/byte ratio, so partial-cell sorting keeps it first.
 f.a.geometry=new THREE.SphereGeometry(1,8,3);
 if(budgetPolicy===undefined){
  await assert.rejects(owner.prepare([f.root],{generation:2,incremental:true}),/geometry-budget/);assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);
  owner.withRender(()=>{assert.equal(f.a.visible,true);assert.equal(f.e.visible,true);assert.equal(f.c.visible,false);});
 }else{
  await owner.prepare([f.root],{generation:2,incremental:true,budgetPolicy});assert.equal(owner.inspection().batches,1);assert.equal(owner.inspection().batchedMeshes,3);assert.equal(owner.inspection().budgetSkippedMeshes,2);assert.equal(owner.inspection().reusedBatches,0);
  owner.withRender(()=>{assert.equal(f.a.visible,false);assert.equal(f.e.visible,false);assert.equal(f.c.visible,true);assert.equal(f.d.visible,true);});
 }
 assert.ok(owner.inspection().mergedBytes<=f.limits.maxMergedBytes);assert.ok(owner.inspection().workingGeometryPeakBytes<=f.limits.maxWorkingBytes);owner.dispose();
});

test('incremental merged-byte budget control reuses unchanged cells once and refuses growth after reuse',async()=>{
 const f=growingCells(),{owner}=f;await owner.prepare([f.root],{generation:1});const live=[...owner.group.children];
 f.root.remove(f.a,f.b,f.e);f.root.add(f.a,f.b,f.e); // The unchanged two-source cell now comes first.
 await owner.prepare([f.root],{generation:2,incremental:true});assert.equal(owner.inspection().reusedBatches,2);assert.equal(owner.inspection().workingGeometryPeakBytes,4200);assert.deepEqual(owner.group.children,live);
 f.a.geometry=new THREE.SphereGeometry(1,8,3);await assert.rejects(owner.prepare([f.root],{generation:3,incremental:true}),/geometry-budget/);assert.equal(owner.inspection().generation,2);assert.deepEqual(owner.group.children,live);owner.dispose();
});

test('a newer preparation waits for obsolete private copies to release across a real yield',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene),derived=f.material.clone();await owner.prepare([f.root],{generation:1});let newer:Promise<unknown>|undefined,disposed=false,startedAfterRelease=false,generationDuringStart:number|null=null;
 const replacement={material:()=>derived,attributes(){startedAfterRelease=disposed;}};
 const obsolete={material:()=>derived,attributes(copy:THREE.BufferGeometry){copy.addEventListener('dispose',()=>{disposed=true;});newer=owner.prepare([f.root],{generation:3,shaderMerge:replacement});generationDuringStart=owner.inspection().generation;}};
 await assert.rejects(owner.prepare([f.root],{generation:2,shaderMerge:obsolete,sliceMs:0}),{name:'AbortError'});await newer;
 assert.equal(generationDuringStart,1,'the replacement does not publish while an obsolete candidate still owns copies');assert.equal(startedAfterRelease,true,'private candidate allocations never overlap');assert.equal(owner.inspection().generation,3);owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();derived.dispose();
});

for(const budgetPolicy of [undefined,'partial-cells/1'] as const)test(`post-adapter geometry workspace is checked before merge (${budgetPolicy??'strict'})`,async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene,{maxMergedBytes:5000,maxWorkingBytes:7000}),derived=f.material.clone();await owner.prepare([f.root],{generation:1});const live=[...owner.group.children];let copies=0,disposed=0;
 const shaderMerge={material:()=>derived,attributes(copy:THREE.BufferGeometry){copies++;copy.addEventListener('dispose',()=>disposed++);for(let i=0;i<3;i++)copy.setAttribute('extra'+i,new THREE.BufferAttribute(new Float32Array(copy.attributes.position.count*4),4));}};
 if(budgetPolicy===undefined){await assert.rejects(owner.prepare([f.root],{generation:2,shaderMerge}),/geometry-budget/);assert.deepEqual(owner.group.children,live);assert.equal(owner.inspection().generation,1);}
 else{await owner.prepare([f.root],{generation:2,shaderMerge,budgetPolicy});assert.equal(owner.inspection().batches,0);assert.equal(owner.inspection().budgetSkippedMeshes,2);owner.withRender(()=>assert.equal(f.a.visible,true));}
 assert.equal(copies,2);assert.equal(disposed,copies);owner.dispose();derived.dispose();
});

test('failed predecessor and aborted queued preparation release the latch for the newest request',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene),derived=f.material.clone();await owner.prepare([f.root],{generation:1});const abort=new AbortController();let cancelled:Promise<void>|undefined,newest:Promise<unknown>|undefined,disposed=false,newestAfterRelease=false;
 const shaderMerge={material:()=>derived,attributes(copy:THREE.BufferGeometry){
  copy.addEventListener('dispose',()=>{disposed=true;});cancelled=assert.rejects(owner.prepare([f.root],{generation:3,signal:abort.signal,sliceMs:0}),{name:'AbortError'});abort.abort();
  newest=owner.prepare([f.root],{generation:4,shaderMerge:{material:()=>derived,attributes(){newestAfterRelease=disposed;}}});throw Error('predecessor copy failed');
 }};
 await assert.rejects(owner.prepare([f.root],{generation:2,shaderMerge,sliceMs:0}),/predecessor copy failed/);await cancelled;await newest;
 assert.equal(newestAfterRelease,true);assert.equal(owner.inspection().generation,4);assert.equal(owner.inspection().preparing,false);owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();derived.dispose();
});

test('reset and disposal cancel both active and queued preparations without leaving a latch',async()=>{
 for(const dispose of [false,true]){
  const f=fixture(),owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root],{generation:1});
  const active=assert.rejects(owner.prepare([f.root],{generation:2,sliceMs:0}),{name:'AbortError'}),queued=assert.rejects(owner.prepare([f.root],{generation:3}),{name:'AbortError'});
  assert.equal(owner.inspection().preparing,true);if(dispose)owner.dispose();else owner.reset();await Promise.all([active,queued]);assert.equal(owner.inspection().preparing,false);assert.equal(owner.inspection().generation,null);
  if(!dispose){await owner.prepare([f.root],{generation:4});assert.equal(owner.inspection().generation,4);owner.dispose();}
 }
});

test('an oversized adapter return is rejected and its known allocation peak is reported honestly',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene,{maxMergedBytes:5000,maxWorkingBytes:7000}),derived=f.material.clone();await owner.prepare([f.root],{generation:1});const live=[...owner.group.children],accepted=owner.inspection().mergedBytes;let known=0,disposed=0;
 const shaderMerge={material:()=>derived,attributes(copy:THREE.BufferGeometry){copy.addEventListener('dispose',()=>disposed++);for(let i=0;i<100;i++)copy.setAttribute('extra'+i,new THREE.BufferAttribute(new Float32Array(copy.attributes.position.count*4),4));known=accepted+Object.values(copy.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(copy.index?.array.byteLength??0);}};
 await assert.rejects(owner.prepare([f.root],{generation:2,shaderMerge}),/geometry-budget/);assert.deepEqual(owner.group.children,live);assert.equal(disposed,1);assert.ok(known>7000);assert.equal(owner.inspection().workingGeometryPeakBytes,known,'admission checks cannot prevent arbitrary allocation inside an adapter callback');assert.equal(owner.inspection().preparing,false);owner.dispose();derived.dispose();
});
