import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {StaticBatchOwner} from '../src/rendering/StaticBatchOwner.ts';

function fixture(){const scene=new THREE.Scene(),root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),a=new THREE.Mesh(new THREE.BoxGeometry(),material),b=a.clone();b.position.x=3;root.add(a,b);scene.add(root);return{scene,root,material,a,b};}
async function microtasks(){for(let i=0;i<6;i++)await Promise.resolve();}

test('an ABA transform around incremental reuse cannot replace the old geometry content proof with new stamps',async()=>{
 const f=fixture(),other=f.root.clone();other.position.x=100;f.scene.add(other);const owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root,other],{generation:1});const live=[...owner.group.children];
 const messages:(()=>void)[]=[],original=globalThis.MessageChannel;
 class QueuedChannel{port1={onmessage:null as null|(()=>void),close(){}};port2={postMessage:()=>messages.push(()=>this.port1.onmessage?.()),close(){}};}
 globalThis.MessageChannel=QueuedChannel as unknown as typeof MessageChannel;
 try{
  f.root.position.x=5;let finished=false;const outcome=owner.prepare([f.root,other],{generation:2,incremental:true,sliceMs:0}).then(()=>null,error=>error).finally(()=>{finished=true;});
  messages.shift()!();await microtasks(); // first complete root captured at B
  f.root.position.x=0;messages.shift()!();await microtasks(); // current matrices become A after the second root
  messages.shift()!();await microtasks(); // the first cell reuses old geometry A
  f.root.position.x=5; // final validation sees B again
  for(let i=0;i<40&&!finished;i++){messages.shift()?.();await microtasks();}
  const error=await outcome;assert.match(error?.message??'resolved',/source-changed/);
  assert.equal(owner.inspection().generation,1);assert.deepEqual(owner.group.children,live);
  owner.withRender(()=>{assert.equal(f.a.visible,true,'accepted A must not be relabelled as current B');assert.equal(other.children[0].visible,false);});
 }finally{owner.dispose();for(const message of messages.splice(0))message();globalThis.MessageChannel=original;}
});

test('a failed candidate may bind reused content to a new root only in private wrappers',async()=>{
 const f=fixture(),outer=new THREE.Group();f.scene.add(outer);outer.add(f.root);const owner=new StaticBatchOwner(f.scene);
 await owner.prepare([outer],{generation:1,hideWholeRoots:true});
 const accepted=(owner as unknown as {batches:{sources:{root:THREE.Object3D}[]}[]}).batches,oldSources=accepted[0].sources;
 const other=f.root.clone();other.position.x=100;f.scene.add(other);(other.children[0] as THREE.Mesh).geometry=(other.children[0] as THREE.Mesh).geometry.clone();
 (other.children[0] as THREE.Mesh).geometry.clone=()=>{
  assert.equal((owner as unknown as {batches:unknown}).batches,accepted);assert.equal(accepted[0].sources,oldSources);assert.ok(oldSources.every(s=>s.root===outer));
  owner.withRender(()=>assert.equal(outer.visible,false));throw Error('later candidate failed');
 };
 await assert.rejects(owner.prepare([f.root,other],{generation:2,incremental:true,hideWholeRoots:true}),/later candidate failed/);
 assert.equal((owner as unknown as {batches:unknown}).batches,accepted);assert.equal(accepted[0].sources,oldSources);assert.ok(oldSources.every(s=>s.root===outer));owner.dispose();
});

test('a final cache miss after a later hook changes an earlier material cannot invoke a resolver again',async()=>{
 const f=fixture(),other=f.root.clone(),m=f.material.clone();m.roughness=.4;for(const o of other.children)(o as THREE.Mesh).material=m;other.position.x=100;f.scene.add(other);
 const owner=new StaticBatchOwner(f.scene);let attached=false,lateResolvers=0;
 m.customProgramCacheKey=()=>{if(attached)f.material.onBeforeCompile=()=>{};return 'stable';};
 const shaderMerge={material(material:THREE.Material){if(attached&&material===f.material){lateResolvers++;throw Error('late resolver');}return null;},attributes(){}};
 await owner.prepare([f.root,other],{generation:1,sharePlainMaterials:true,shaderMerge});const live=[...owner.group.children];
 owner.group.addEventListener('childadded',()=>{attached=true;});
 await assert.rejects(owner.prepare([f.root,other],{generation:2,sharePlainMaterials:true,shaderMerge}),/source-changed/);
 assert.equal(lateResolvers,0,'the final structural pass must fail closed on a missing cached resolution');assert.deepEqual(owner.group.children,live);owner.dispose();
});

for(const phase of ['attachment','final-key'] as const)for(const mutation of ['detach','material','geometry','attribute','transform','layers','cast','receive','order','frustum','range','render-hook'] as const)test(`candidate ${mutation} mutation by ${phase} cannot publish authority`,async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);let attached=false,changed=false,live:THREE.Object3D[]=[];
 const mutate=()=>{
  if(changed)return;changed=true;const candidate=owner.group.children.find(o=>!live.includes(o)) as THREE.Mesh;
  if(mutation==='detach')candidate.removeFromParent();else if(mutation==='material')candidate.material=f.material.clone();else if(mutation==='geometry')candidate.geometry=f.a.geometry;else if(mutation==='attribute')candidate.geometry.attributes.position.needsUpdate=true;else if(mutation==='transform')candidate.position.x=10;else if(mutation==='layers')candidate.layers.mask=0;else if(mutation==='cast')candidate.castShadow=!candidate.castShadow;else if(mutation==='receive')candidate.receiveShadow=!candidate.receiveShadow;else if(mutation==='order')candidate.renderOrder++;else if(mutation==='frustum')candidate.frustumCulled=!candidate.frustumCulled;else if(mutation==='range')candidate.geometry.setDrawRange(0,0);else candidate.onBeforeRender=()=>{};
 };
 f.material.customProgramCacheKey=()=>{if(attached&&phase==='final-key')mutate();return 'stable';};
 await owner.prepare([f.root],{generation:1});live=[...owner.group.children];let sourceDisposals=0;f.a.geometry.addEventListener('dispose',()=>sourceDisposals++);
 owner.group.addEventListener('childadded',()=>{attached=true;if(phase==='attachment')mutate();});
 await assert.rejects(owner.prepare([f.root],{generation:2}),/candidate-changed|attachment-changed/);
 assert.equal(changed,true);assert.equal(owner.inspection().generation,1);assert.deepEqual(owner.group.children,live);assert.equal(sourceDisposals,0);
 owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();assert.equal(sourceDisposals,0);
});

test('observational final resolvers publish one complete new set and retire only the prior owned geometry',async()=>{
 const f=fixture(),owner=new StaticBatchOwner(f.scene);let keys=0,sources=0,materials=0;
 f.material.customProgramCacheKey=()=>{keys++;return 'stable';};const shaderMerge={source(){sources++;return null;},material(){materials++;return null;},attributes(){}};
 await owner.prepare([f.root],{generation:1,shaderMerge});const old=owner.group.children[0] as THREE.Mesh;let disposed=0;old.geometry.addEventListener('dispose',()=>disposed++);
 await owner.prepare([f.root],{generation:2,shaderMerge});assert.equal(owner.inspection().generation,2);assert.equal(owner.group.children.length,1);assert.notEqual(owner.group.children[0],old);assert.equal(disposed,1);
 assert.ok(keys>0&&sources>0&&materials>0);owner.withRender(()=>assert.equal(f.a.visible,false));owner.dispose();
});

test('a current shared geometry stamp cannot validate a different source captured before its version changed',async()=>{
 const f=fixture(),other=f.root.clone(),m=f.material.clone();for(const o of other.children)(o as THREE.Mesh).material=m;other.position.x=100;f.scene.add(other);
 // The three-mesh second cell sorts first under the explicit benefit policy. Its current geometry stamp must not
 // make the earlier two-mesh cell's stale stamp pass through a per-geometry cache entry.
 const third=(other.children[0] as THREE.Mesh).clone();third.position.x=5;other.add(third);
 const owner=new StaticBatchOwner(f.scene);await owner.prepare([f.root,other],{generation:1});const live=[...owner.group.children];
 let changed=false;m.customProgramCacheKey=()=>{if(!changed){changed=true;f.a.geometry.attributes.position.needsUpdate=true;}return 'stable';};
 await assert.rejects(owner.prepare([f.root,other],{generation:2,budgetPolicy:'partial-cells/1'}),/source-changed/);
 assert.equal(changed,true);assert.equal(owner.inspection().generation,1);assert.deepEqual(owner.group.children,live);owner.dispose();
});
