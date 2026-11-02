// Offline: node --import=./tools/test-harness/web-loader.mjs --test apps/web/test/skinned-world-vertices.test.ts
// PERF-PASSES: humans.ts eachSkinnedWorld (lying bodies resting on the ground, feet's lowest point) forms each bone's
// skinning matrix once per call; it must give bit-identical world positions to three's getVertexPosition +
// matrixWorld, on a real rig in an arbitrary pose, so a near body's resting height cannot change by even one ulp.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {eachSkinnedWorld,restNeed,computeBodySphere} from '../../../mars/viewer/app/engine-view/humans.ts';

async function rig(name:string){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1]}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);
 return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
}

for(const name of ['casual','punk','woman'])test(`eachSkinnedWorld equals getVertexPosition·matrixWorld bit for bit (${name}, posed, moved, scaled)`,async()=>{
 const scene=await rig(name),holder=new THREE.Group();holder.add(scene);
 let seed=7;const rnd=()=>((seed=Math.imul(seed,1103515245)+12345>>>0)/2**32)-.5;
 scene.traverse(o=>{if((o as THREE.Bone).isBone)o.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(),rnd(),rnd())));});
 holder.position.set(-144.2,3.7,159.5);holder.rotation.y=1.3;holder.scale.setScalar(1.07);holder.updateMatrixWorld(true);
 const meshes:THREE.SkinnedMesh[]=[];scene.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)meshes.push(o as THREE.SkinnedMesh);});
 assert.ok(meshes.length>0);
 const refs=meshes.map(mesh=>({mesh,idx:Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i).filter(i=>i%2===0)}));
 const want:number[]=[];for(const r of refs)for(const i of r.idx){const p=r.mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(r.mesh.matrixWorld);want.push(p.x,p.y,p.z);}
 const got:number[]=[];eachSkinnedWorld(refs,new THREE.Vector3(),p=>{got.push(p.x,p.y,p.z);});
 assert.equal(got.length,want.length);
 for(let k=0;k<want.length;k++)if(!Object.is(got[k],want[k]))assert.fail(`component ${k}: ${got[k]} !== ${want[k]}`);
 // a second call after the pose changes reads the new bone matrices (nothing stale from the first call)
 scene.traverse(o=>{if((o as THREE.Bone).isBone)o.rotateX(.2);});holder.updateMatrixWorld(true);
 const want2:number[]=[];for(const r of refs.slice(0,1))for(const i of r.idx.slice(0,500)){const p=r.mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(r.mesh.matrixWorld);want2.push(p.x,p.y,p.z);}
 const got2:number[]=[];eachSkinnedWorld([{mesh:refs[0].mesh,idx:refs[0].idx.slice(0,500)}],new THREE.Vector3(),p=>{got2.push(p.x,p.y,p.z);});
 assert.deepEqual(got2,want2);
 for(const m of meshes){
  m.computeBoundingSphere();const want=m.boundingSphere!.clone();m.boundingSphere=null;computeBodySphere.call(m);
  assert.deepEqual(m.boundingSphere,want,'first-draw local bounds equal Three exactly, without a world/local roundtrip');
 }
 const morph=meshes[0],delta=morph.geometry.attributes.position.clone();
 for(let i=0;i<delta.count;i++)delta.setXYZ(i,.01,-.02,.03);
 morph.geometry.morphAttributes.position=[delta];morph.geometry.morphTargetsRelative=true;morph.updateMorphTargets();morph.morphTargetInfluences![0]=.4;
 morph.computeBoundingSphere();const morphBounds=morph.boundingSphere!.clone();morph.boundingSphere=null;computeBodySphere.call(morph);
 assert.deepEqual(morph.boundingSphere,morphBounds,'morph targets retain the native vertex path and exact bounds');
});

test('restNeed: a lying body breathing for 120 poses rests exactly as high as a full pass over every sample would put it', async () => {
 const scene=await rig('casual'),holder=new THREE.Group();holder.add(scene);
 holder.position.set(12,0.1,-7);holder.rotation.set(0,.4,Math.PI/2);holder.updateMatrixWorld(true);
 const meshes:THREE.SkinnedMesh[]=[];scene.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)meshes.push(o as THREE.SkinnedMesh);});
 const body=meshes.map(mesh=>({mesh,idx:Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i).filter(i=>i%3===0)}));
 const bones:THREE.Bone[]=[];scene.traverse(o=>{if((o as THREE.Bone).isBone)bones.push(o as THREE.Bone);});
 const rest=bones.map(b=>b.quaternion.clone());
 const v={rig:{holder},surf:{foot:new Map(),hand:new Map(),body}} as unknown as Parameters<typeof restNeed>[0];
 let worst=0,full=0;
 for(let f=0;f<120;f++){
  // breathing: the spine and neck bones rock a few hundredths of a radian at 0.25 Hz (60 fps)
  bones.forEach((b,k)=>{b.quaternion.copy(rest[k]);if(/spine|neck|chest|head/i.test(b.name))b.rotateX(.03*Math.sin(f/60*2*Math.PI*.25+k));});
  holder.updateMatrixWorld(true);
  let want=-Infinity;eachSkinnedWorld(body,new THREE.Vector3(),p=>{want=Math.max(want,0.1+0.012-p.y);});
  const got=restNeed(v,'back',0.1,0.1);
  worst=Math.max(worst,Math.abs(got-want));if(got===want)full++;
 }
 assert.ok(worst===0,`the kept samples held the lowest point on every pose (worst ${worst} m, ${full}/120 exact)`);
});
