import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldMeshLod,PHONE_MESH_LOD,workerSimplifier} from './WorldMeshLod.ts';
import type {AsyncSimplifier,LodInput,LodLevel} from './mesh-lod-core.ts';

type Request={id:number;input?:LodInput;ratios?:number[]};
type Reply={id:number;ready?:boolean;levels?:LodLevel[];error?:string};
class FakeWorker{
 onmessage:((event:{data:Reply})=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminated=0;failHandshake=false;failPost=false;posted:number[]=[];jobs=new Map<number,Request>();
 postMessage(message:Request,transfer:Transferable[]=[]){
  if(message.id===0){if(this.failHandshake)throw Error('handshake post failed');return;}
  if(this.failPost)throw Error('job post failed');
  const received=structuredClone(message,{transfer});this.posted.push(message.id);this.jobs.set(message.id,received);
 }
 ready(value=true){this.onmessage?.({data:{id:0,ready:value}});}
 reply(id:number,levels:LodLevel[]=[{index:new Uint32Array([0,1,2]),error:0,triangles:1}]){
  this.jobs.delete(id);const received=structuredClone(levels,{transfer:levels.map(l=>l.index.buffer)});this.onmessage?.({data:{id,levels:received}});
 }
 terminate(){this.terminated++;this.jobs.clear();}
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const input=():LodInput=>({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2]),parts:[]});
async function transport(t:TestContext){
 const worker=new FakeWorker(),world=new AbortController();t.after(()=>{world.abort();worker.onerror?.();});
 const loading=workerSimplifier(()=>worker as unknown as Worker,15000,world.signal);worker.ready();const service=(await loading)!;assert.ok(service);return{worker,world,service};
}
function submit(service:AsyncSimplifier){
 const job=service.reserve!();assert.ok(job);const copied=input(),promise=job.levels(copied,[.5],.1);void promise.catch(()=>{});return{job,promise,copied};
}
function geometry(copied:()=>void=()=>{}){
 const g=new THREE.PlaneGeometry(20,20,3,3).rotateX(-Math.PI/2);g.computeBoundingSphere();
 const array=g.attributes.position.array as Float32Array,original=array.slice;array.slice=function(start?:number,end?:number){copied();return original.call(this,start,end);};return g;
}
function view(){const camera=new THREE.PerspectiveCamera(45,1418/899,.1,2400);camera.position.set(0,20,600);camera.lookAt(0,0,0);camera.updateMatrixWorld();return camera;}
const options={...PHONE_MESH_LOD,minTriangles:1,rescanFrames:1};

test('construction failure and an already retired world create no worker',async()=>{
 assert.equal(await workerSimplifier(()=>{throw Error('unavailable');}),null);const world=new AbortController();world.abort();let made=0;
 assert.equal(await workerSimplifier(()=>{made++;return new FakeWorker() as unknown as Worker;},15000,world.signal),null);assert.equal(made,0);
});
test('handshake post failure settles immediately and terminates the startup worker',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const worker=new FakeWorker();worker.failHandshake=true;
 assert.equal(await workerSimplifier(()=>worker as unknown as Worker),null);assert.equal(worker.terminated,1);assert.equal(worker.onmessage,null);t.mock.timers.tick(15000);assert.equal(worker.terminated,1);
});
test('startup refusal, timeout, native errors and abort settle once; late ready cannot revive the worker',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const kind of ['refused','timeout','abort','error','messageerror']){
  const worker=new FakeWorker(),world=new AbortController(),pending=workerSimplifier(()=>worker as unknown as Worker,15000,world.signal),late=worker.onmessage!;
  if(kind==='refused')worker.ready(false);else if(kind==='timeout')t.mock.timers.tick(15000);else if(kind==='error')worker.onerror!();else if(kind==='messageerror')worker.onmessageerror!();else world.abort();
  assert.equal(await pending,null,kind);assert.equal(worker.terminated,1,kind);late({data:{id:0,ready:true}});world.abort();t.mock.timers.tick(15000);assert.equal(worker.terminated,1);
 }
});
test('fatal errors and world retirement terminate a ready worker and settle active jobs',async t=>{
 for(const kind of ['error','messageerror','abort'])await t.test(kind,async t=>{
  const{worker,world,service}=await transport(t),pending=service.levels(input(),[.5],1);void pending.catch(()=>{});const late=worker.onmessage!;
  if(kind==='error')worker.onerror!();else if(kind==='messageerror')worker.onmessageerror!();else world.abort();
  assert.equal(worker.terminated,1);await assert.rejects(pending);assert.equal(worker.onmessage,null);assert.equal(worker.onerror,null);assert.equal(worker.onmessageerror,null);
  late({data:{id:0,ready:true}});late({data:{id:worker.posted[0],levels:[]}});world.abort();assert.equal(worker.terminated,1);assert.equal(service.inspection().physical,0);assert.throws(()=>service.reserve!());
 });
});
test('direct transport calls cannot post more than two physical jobs while replies are withheld',async t=>{
 const{worker,service}=await transport(t);for(let n=0;n<100;n++)void service.levels(input(),[.5],1).catch(()=>{});
 assert.equal(worker.posted.length,2);assert.equal(worker.jobs.size,2);assert.equal(service.inspection().callbacks,2);
});
test('canceling posted work releases callbacks but retains physical admission until actual replies',async t=>{
 const{worker,service}=await transport(t),a=submit(service),b=submit(service);assert.equal(a.copied.positions.byteLength,0,'Only private copied input was transferred');a.job.cancel();b.job.cancel();await flush();
 for(let n=0;n<1000;n++)assert.equal(service.reserve!(),null);assert.deepEqual(service.inspection(),{physical:2,callbacks:0,tombstones:2,closed:false});
 worker.reply(worker.posted[0]);worker.reply(worker.posted[0]);assert.equal(service.inspection().physical,1);const current=submit(service);assert.equal(service.reserve!(),null);
 worker.reply(worker.posted[1]);worker.reply(worker.posted[2]);assert.deepEqual((await current.promise)[0].index,new Uint32Array([0,1,2]));assert.equal(service.inspection().physical,0);assert.equal(worker.terminated,0);
});
test('unused reservations, preparation/post failures and error replies release capacity exactly once',async t=>{
 const{worker,service}=await transport(t),unused=service.reserve!()!;unused.cancel();unused.cancel();assert.equal(service.inspection().physical,0);await assert.rejects(unused.levels(input(),[.5],1),{name:'AbortError'});
 worker.failPost=true;const failed=submit(service);await assert.rejects(failed.promise,/job post failed/);assert.equal(failed.copied.positions.byteLength,36);assert.equal(service.inspection().physical,0);assert.equal(service.inspection().callbacks,0);
 worker.failPost=false;const next=submit(service),id=worker.posted[0];worker.jobs.delete(id);worker.onmessage!({data:{id,error:'bad geometry'}});await assert.rejects(next.promise,/bad geometry/);assert.equal(service.inspection().physical,0);assert.equal(worker.terminated,0);
});
test('lost canceled replies occupy bounded slots without a new job timeout until world retirement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const{worker,world,service}=await transport(t),job=submit(service);job.job.cancel();await flush();t.mock.timers.tick(3600000);
 assert.equal(worker.terminated,0);assert.deepEqual(service.inspection(),{physical:1,callbacks:0,tombstones:1,closed:false});world.abort();assert.equal(worker.terminated,1);assert.equal(service.inspection().physical,0);
});
test('repeated mesh replacement cannot copy or submit more work while physical slots are occupied',async t=>{
 const{worker,service}=await transport(t),scene=new THREE.Scene(),camera=view();let copies=0;
 const meshes=[0,1].map(()=>new THREE.Mesh(geometry(()=>copies++),new THREE.MeshBasicMaterial()));scene.add(...meshes);scene.updateMatrixWorld(true);
 const lod=new WorldMeshLod(options,async()=>service);t.after(()=>lod.dispose());await flush();lod.apply(scene,camera,899);lod.restore();assert.equal(copies,2);
 for(let n=0;n<100;n++){for(const mesh of meshes)mesh.geometry=geometry(()=>copies++);lod.apply(scene,camera,899);lod.restore();await flush();}
 assert.equal(copies,2);assert.equal(worker.posted.length,2);assert.deepEqual(service.inspection(),{physical:2,callbacks:0,tombstones:2,closed:false});
 worker.reply(worker.posted[0]);lod.apply(scene,camera,899);lod.restore();assert.equal(copies,3);assert.equal(worker.posted.length,3);worker.reply(worker.posted[2]);await flush();lod.apply(scene,camera,899);assert.equal(lod.stats.coarser,1);lod.restore();
});
test('a replaced submitted mesh discards its old reply and attaches only the current result',async t=>{
 const{worker,service}=await transport(t),scene=new THREE.Scene(),camera=view(),mesh=new THREE.Mesh(geometry(),new THREE.MeshBasicMaterial());scene.add(mesh);scene.updateMatrixWorld(true);
 const lod=new WorldMeshLod(options,async()=>service);t.after(()=>lod.dispose());await flush();const original=mesh.geometry,source=Buffer.from(original.attributes.position.array.buffer).toString('hex');lod.apply(scene,camera,899);lod.restore();const oldId=worker.posted[0];
 const current=geometry();mesh.geometry=current;lod.apply(scene,camera,899);lod.restore();await flush();assert.equal(service.inspection().tombstones,1);const currentId=worker.posted[1];
 worker.reply(oldId);await flush();lod.apply(scene,camera,899);assert.equal(mesh.geometry,current);lod.restore();worker.reply(currentId);await flush();lod.apply(scene,camera,899);assert.notEqual(mesh.geometry,current);assert.equal(mesh.geometry.attributes.position,current.attributes.position);lod.restore();assert.equal(mesh.geometry,current);assert.equal(Buffer.from(original.attributes.position.array.buffer).toString('hex'),source);
});
test('disposing mesh LOD cancels callbacks; late replies preserve original geometry and source buffers',async t=>{
 const{worker,world,service}=await transport(t),scene=new THREE.Scene(),camera=view(),mesh=new THREE.Mesh(geometry(),new THREE.MeshBasicMaterial());scene.add(mesh);scene.updateMatrixWorld(true);
 const lod=new WorldMeshLod(options,async()=>service);await flush();const base=mesh.geometry,bytes=Buffer.from(base.attributes.position.array.buffer).toString('hex');lod.apply(scene,camera,899);lod.restore();lod.dispose();lod.dispose();await flush();assert.equal(service.inspection().callbacks,0);
 worker.reply(worker.posted[0]);await flush();lod.apply(scene,camera,899);assert.equal(mesh.geometry,base);assert.equal(Buffer.from(base.attributes.position.array.buffer).toString('hex'),bytes);world.abort();assert.equal(worker.terminated,1);
});
test('copy and synchronous submission throws do not consume the local in-flight allowance',async t=>{
 for(const failure of ['copy','submit'])await t.test(failure,async()=>{
  const scene=new THREE.Scene(),camera=view();let calls=0;const meshes=[0,1,2].map(i=>new THREE.Mesh(geometry(()=>{if(failure==='copy'&&i<2)throw Error('copy failed');}),new THREE.MeshBasicMaterial()));scene.add(...meshes);scene.updateMatrixWorld(true);
  const simplifier:AsyncSimplifier={isAsync:true,levels:()=>{calls++;if(failure==='submit'&&calls<3)throw Error('submit failed');return Promise.resolve([]);}};
  const lod=new WorldMeshLod(options,async()=>simplifier);await flush();lod.apply(scene,camera,899);lod.restore();assert.equal(calls,failure==='copy'?1:3);await flush();lod.dispose();
 });
});
test('copy failure releases its transport reservation before a later mesh submits',async t=>{
 const{worker,service}=await transport(t),scene=new THREE.Scene(),camera=view(),meshes=[0,1,2].map(i=>new THREE.Mesh(geometry(()=>{if(i<2)throw Error('copy failed');}),new THREE.MeshBasicMaterial()));scene.add(...meshes);scene.updateMatrixWorld(true);
 const lod=new WorldMeshLod(options,async()=>service);t.after(()=>lod.dispose());await flush();lod.apply(scene,camera,899);lod.restore();assert.equal(worker.posted.length,1);assert.equal(service.inspection().physical,1);assert.equal(service.inspection().callbacks,1);worker.reply(worker.posted[0]);await flush();
});
test('late loader resolution cannot revive a disposed mesh LOD consumer',async()=>{
 const scene=new THREE.Scene(),camera=view(),mesh=new THREE.Mesh(geometry(),new THREE.MeshBasicMaterial());scene.add(mesh);scene.updateMatrixWorld(true);let finish!:(simplifier:AsyncSimplifier)=>void,calls=0;
 const lod=new WorldMeshLod(options,()=>new Promise(resolve=>{finish=resolve;}));lod.dispose();finish({isAsync:true,levels:async()=>{calls++;return [];}});await flush();lod.apply(scene,camera,899);assert.equal(calls,0);assert.equal(mesh.geometry.attributes.position.count,16);
});
