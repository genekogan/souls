// Phone arrival (lane d3) cached the Idle standing box per template look and dropped a redundant whole-model matrix
// update per walk sample. Templates (walk/jog/sprint/run speeds, arm fits) and spawned bodies' placement must equal what
// the uncached code measured on the three canonical character GLBs (golden values recorded from trunk 32a8ed40).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type * as THREE from 'three';
import {createRig,templateFromGltf,templateFromGltfAsync} from '../../../mars/viewer/app/engine-view/people.ts';
import {HumanViews} from '../../../mars/viewer/app/engine-view/humans.ts';

async function load(name:string){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
export async function measure(build:typeof templateFromGltf|typeof templateFromGltfAsync=templateFromGltf){
 const out:Record<string,unknown>={};
 for(const name of ['casual','punk','woman']){
  const t=await build(name,await load(name)) as unknown as Record<string,unknown>;
  const bodies=[0,1].map(()=>{const r=createRig(t as never);return [...r.model.position.toArray(),...r.model.scale.toArray()];});
  out[name]={walkSpeed:t.walkSpeed,forward:t.forward,jogSpeed:t.jogSpeed,sprintSpeed:t.sprintSpeed,runSpeed:t.runSpeed,bodyScale:t.bodyScale,arms:t.arms,bodies};
 }
 return out;
}
const GOLDEN=JSON.parse(readFileSync(new URL('./people-template-golden.json',import.meta.url),'utf8'));
test('character templates and spawned bodies equal the uncached measurements exactly',async()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(await measure())),GOLDEN);
});
test('task-sliced character fitting preserves every template and spawned-body golden value',async()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(await measure(templateFromGltfAsync))),GOLDEN);
});
test('cancelled fitting does not mutate the source rig',async()=>{
 const gltf=await load('casual'),before=JSON.stringify(gltf.scene.toJSON()),abort=new AbortController();abort.abort();
 await assert.rejects(templateFromGltfAsync('casual',gltf,undefined,abort.signal),{name:'AbortError'});
 assert.equal(JSON.stringify(gltf.scene.toJSON()),before);
});

type Refs={mesh:THREE.SkinnedMesh;idx:number[]}[];
type MeasuredBody={rig:{model:THREE.Object3D};dims:{lieHip:number};surf:{body:Refs;foot:Map<number,Refs>;hand:Map<number,Refs>}};
const measuredBodies=(v:HumanViews)=>(v as unknown as {views:Map<string,MeasuredBody>}).views;
const surfaceRows=(v:MeasuredBody)=>[...v.surf.body,...[...v.surf.foot.values(),...v.surf.hand.values()].flat()];
test('reused standing measurements keep every surface bound to its own actor and survive the first actor leaving',async()=>{
 const template=templateFromGltf('casual',await load('casual')),view=new HumanViews();view.setTemplates([template]);
 const actor=(id:string)=>({id,p:[0,0,0] as [number,number,number],yaw:0,walk:0,walkDist:0});
 view.setFrame([actor('a')],0);view.render(1);view.setFrame([actor('a'),actor('b')],1);
 const a=measuredBodies(view).get('a')!,b=measuredBodies(view).get('b')!,ar=surfaceRows(a),br=surfaceRows(b);
 assert.deepEqual(b.dims,a.dims);assert.equal(br.length,ar.length);assert.ok(br.length>0);
 for(let i=0;i<br.length;i++){assert.deepEqual(br[i].idx,ar[i].idx);assert.notEqual(br[i].idx,ar[i].idx);assert.notEqual(br[i].mesh,ar[i].mesh);assert.equal(b.rig.model.getObjectById(br[i].mesh.id),br[i].mesh);}
 ar[0].idx[0]=-1;view.setFrame([actor('b'),actor('c')],2);const c=measuredBodies(view).get('c')!;
 assert.deepEqual(surfaceRows(c).map(r=>r.idx),br.map(r=>r.idx),'cached indices never alias an actor-owned array');
 for(const r of surfaceRows(c))assert.equal(c.rig.model.getObjectById(r.mesh.id),r.mesh);
 view.clear();
});
test('standing shape measurements refresh after a source geometry attribute changes',async()=>{
 const gltf=await load('casual'),template=templateFromGltf('casual',gltf),view=new HumanViews();view.setTemplates([template]);
 const actor=(id:string)=>({id,p:[0,0,0] as [number,number,number],yaw:0,walk:0,walkDist:0});
 view.setFrame([actor('before')],0);const before=measuredBodies(view).get('before')!.dims.lieHip;view.clear();
 gltf.scene.traverse(o=>{const m=o as THREE.SkinnedMesh;if(!m.isSkinnedMesh)return;const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,p.getZ(i)+.1);p.needsUpdate=true;});
 view.setFrame([actor('after')],1);assert.notEqual(measuredBodies(view).get('after')!.dims.lieHip,before);view.clear();
});

const arrivalActor=(id:string,p:[number,number,number]=[0,0,0])=>({id,p,yaw:0,walk:0,walkDist:0});
test('one animation budget is shared by repeated updates and separate people owners',async()=>{
 const template=templateFromGltf('casual',await load('casual')),a=new HumanViews(),b=new HumanViews();for(const view of[a,b])view.setTemplates([template]);
 try{
  const budget={remaining:1},frame=[arrivalActor('a'),arrivalActor('b')];
  a.setFrame(frame,0,{},budget);a.setFrame(frame,0,{},budget);b.setFrame([arrivalActor('c')],0,{},budget);
  assert.equal(a.group.children.length,1);assert.equal(b.group.children.length,0);assert.equal(budget.remaining,0);
  const next={remaining:1};b.setFrame([arrivalActor('c')],1,{},next);a.setFrame(frame,1,{},next);
  assert.equal(a.group.children.length,1);assert.equal(b.group.children.length,1,'the next animation frame admits its next owner');
 }finally{a.clear();b.clear();}
});
test('budgeted arrivals keep existing actors on the current pose and never queue removed people',async()=>{
 const view=new HumanViews();view.setTemplates([templateFromGltf('casual',await load('casual'))]);
 try{
  view.setFrame([arrivalActor('a'),arrivalActor('b')],0,{},{remaining:1});view.render(1);const a=view.bodyObject('a')!;
  assert.ok(a);assert.equal(view.bodyObject('b'),null);
  view.setFrame([arrivalActor('b'),arrivalActor('a',[4,0,2])],1,{},{remaining:0});view.render(1);
  assert.equal(view.bodyObject('a'),a);assert.deepEqual(a.position.toArray(),[4,0,2]);assert.equal(view.bodyObject('b'),null);
  view.setFrame([arrivalActor('c',[8,0,3]),arrivalActor('a',[5,0,2])],2,{},{remaining:1});view.render(1);
  assert.ok(view.bodyObject('c'));assert.equal(view.bodyObject('b'),null);assert.deepEqual(a.position.toArray(),[5,0,2]);
  view.setFrame([],3,{},{remaining:1});assert.equal(view.group.children.length,0);
 }finally{view.clear();}
});
test('a deferred replacement keeps its old body moving until the replacement can be created',async()=>{
 const casual=templateFromGltf('casual',await load('casual')),punk=templateFromGltf('punk',await load('punk')),view=new HumanViews();
 view.setTemplates([casual]);view.setBodyTemplates(new Map([['replacement',punk]]));
 try{
  view.setFrame([arrivalActor('a')],0);view.render(1);const old=view.bodyObject('a')!;
  view.setFrame([{...arrivalActor('a',[5,0,7]),bodyModel:'replacement'}],1,{},{remaining:0});view.render(1);
  assert.equal(view.bodyObject('a'),old);assert.equal(old.parent,view.group);assert.deepEqual(old.position.toArray(),[5,0,7]);
  view.setFrame([{...arrivalActor('a',[6,0,8]),bodyModel:'replacement'}],2,{},{remaining:1});view.render(1);
  assert.notEqual(view.bodyObject('a'),old);assert.equal(old.parent,null);assert.deepEqual(view.bodyObject('a')!.position.toArray(),[6,0,8]);
  assert.equal((measuredBodies(view).get('a')!.rig as unknown as {template:typeof punk}).template,punk);
 }finally{view.clear();}
});
test('budgeted final rigs and exact posed skin bounds equal unlimited random-access creation',async()=>{
 const templates=await Promise.all(['casual','punk','woman'].map(async name=>templateFromGltf(name,await load(name))));
 const bounded=new HumanViews(),immediate=new HumanViews(),frame=templates.map((t,i)=>({...arrivalActor(String(i),[i*3,.2*i,-i]),yaw:i*.4,bodyModel:t.name}));
 for(const view of[bounded,immediate])view.setBodyTemplates(new Map(templates.map(t=>[t.name,t])));
 try{
  for(let i=0;i<frame.length;i++){bounded.setFrame(frame,7.25,{},{remaining:1});assert.equal(bounded.group.children.length,i+1);}
  immediate.setFrame(frame,7.25);assert.equal(immediate.group.children.length,frame.length,'the default remains unlimited');
  for(const view of[bounded,immediate])view.render(1);
  const snapshot=(view:HumanViews)=>[...measuredBodies(view)].map(([id,v])=>{
   const nodes:unknown[]=[];v.rig.model.updateWorldMatrix(true,true);v.rig.model.traverse(o=>{const m=o as THREE.SkinnedMesh;if(m.isSkinnedMesh)m.computeBoundingSphere();nodes.push({name:o.name,p:o.position.toArray(),q:o.quaternion.toArray(),scale:o.scale.toArray(),world:o.matrixWorld.toArray(),...(m.isSkinnedMesh?{sphere:[...m.boundingSphere!.center.toArray(),m.boundingSphere!.radius]}:{})});});
   return{id,dims:v.dims,nodes,surfaces:surfaceRows(v).map(r=>({name:r.mesh.name,idx:r.idx}))};
  });
  const actual=snapshot(bounded),expected=snapshot(immediate);assert.deepEqual(actual,expected);
  const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');assert.equal(hash(actual),hash(expected));console.log('rig-budget-final-sha256 '+hash(actual));
 }finally{bounded.clear();immediate.clear();}
});
