import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {WorldModel,type Entity} from '@souls/world-compiler';
import {mergeStatic} from './gen-mesh/static-merge.ts';
import {WorldEntityStairs,loadedStairGeometry,stairNativeDef,pendingStairDiff} from './WorldEntityStairs.ts';
import {stairGeometryDigest,type MeshStairProfile} from '../../../mars/viewer/app/engine-view/stair-mesh-profile.ts';
import manifest from '../../../mars/viewer/app/engine-view/stair-mesh-profiles.json' with {type:'json'};
import {assetIdFor} from '../../../packages/engine-mars/src/catalog-adapter.ts';
const root=new URL('../../../',import.meta.url),profiles=manifest.profiles as MeshStairProfile[];
async function loaded(profile:MeshStairProfile,merge=true){
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 // Geometry-only parser: textures are irrelevant and no network, DOM or renderer is used.
 loader.register(parser=>{const get=parser.getDependency.bind(parser);parser.getDependency=(kind,index)=>kind==='texture'?Promise.resolve(null):get(kind,index);return{name:'offline-geometry-only'};});
 const b=readFileSync(new URL(profile.source.mesh,root)),g=await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
 if(merge)mergeStatic(g.scene,false);
 const bounds=new THREE.Box3().setFromObject(g.scene,true),centre=bounds.getCenter(new THREE.Vector3());g.scene.position.set(-centre.x,-bounds.min.y,-centre.z);
 const asset=new THREE.Group();asset.name='asset';asset.add(g.scene);return asset;
}
test('actual Three decoder and material merge preserve each verified representation digest',async()=>{
 for(const p of profiles)for(const merged of [false,true]){
  const asset=await loaded(p,merged);assert.equal(stairGeometryDigest(loadedStairGeometry(asset)),p.geometry);
  asset.scale.setScalar(1.3);asset.position.set(8,2,-3);asset.rotation.y=.7;
  assert.equal(stairGeometryDigest(loadedStairGeometry(asset)),p.geometry,'fitting/placement is outside source digest');
 }
});
test('loaded registry admits matching geometry; revision, removal, resync and changed representation invalidate it',async()=>{
 const p=profiles[1],model=new WorldModel({constants:{ground:'land',extent:64},seed:'stairs'});
 const d=model.defineDef({schema:'def/1',name:'test-mimos',version:1,description:'exact source mesh',form:'point',make:{kind:'mesh',asset:p.asset,footprint:'ded8451db3e217609bff9bbdcab84a861225990b9a5cf5cac039cd693d62fa9c'},size:{box:[15.553,6.465,7.919]},slots:[],components:{},tags:['building'],params:{},state:{},actions:[],layer:'solid'},'test',0);
 const e={id:'mimos',def:'sha:'+d.hash,in:{parent:'world'},p:[1,-p.bottom,3],r:.7,anchor:'base',params:{},by:'test',born:0,v:1} as Entity;model.insert(e);
 const asset=await loaded(p),fit=d.size.box[0]/p.extent[0];asset.scale.setScalar(fit);const obj=new THREE.Group();obj.position.set(1,-p.bottom,3);obj.rotation.y=.7;obj.add(asset);
 const drawn=new Map([['mimos',{obj,settled:true,removing:false}]]),registry=new WorldEntityStairs();
 const get=()=>registry.contacts(model,drawn,()=>fit*p.bottom-p.bottom);
 assert.equal(get().length,1);assert.equal(get()[0].flight.treads.length,3);
 const facts={ref:d.ref,hash:d.hash,box:d.size.box,slots:[],components:{}};
 assert.equal(stairNativeDef(d,e,d.size.box,1),assetIdFor(facts,JSON.stringify(e.params)+'|seen'));
 asset.visible=false;assert.equal(get().length,0);asset.visible=true;assert.equal(get().length,1);
 drawn.get('mimos')!.removing=true;assert.equal(get().length,0);drawn.get('mimos')!.removing=false;
 drawn.get('mimos')!.settled=false;assert.equal(get().length,0);drawn.get('mimos')!.settled=true;
 const changed=await loaded(p);changed.scale.setScalar(fit);const mesh=changed.getObjectByProperty('isMesh',true) as THREE.Mesh;mesh.geometry=mesh.geometry.clone();mesh.geometry.attributes.position.setX(0,mesh.geometry.attributes.position.getX(0)+.02);
 obj.remove(asset);obj.add(changed);assert.equal(get().length,0);assert.equal(registry.diagnostics()[0].reason,'stair.loaded-geometry-mismatch');
 obj.remove(changed);obj.add(asset);assert.equal(get().length,1);
 model.delete(e.id);assert.equal(get().length,0);model.insert(e);registry.reset();assert.equal(get().length,1);
 assert.equal(registry.contacts(model,drawn,()=>2).length,0,'mismatched lower terrain is not snapped');
 const timed=(tick:number)=>registry.contacts(model,drawn,()=>fit*p.bottom-p.bottom,tick);
 assert.equal(timed(400)[0].observedSinceTick,400);assert.equal(timed(410)[0].observedSinceTick,400);
 registry.clearObservation();assert.equal(timed(420)[0].observedSinceTick,420,'resync/history gate clears lifetime');
 const reloaded=await loaded(p);reloaded.scale.setScalar(fit);obj.remove(asset);obj.add(reloaded);
 assert.equal(timed(430)[0].observedSinceTick,430,'even equal geometry from a newly loaded representation starts a new epoch');
 const diff=(upserts:{id:string}[]=[],removes:string[]=[],defs:{ref:string;hash:string}[]=[])=>({kind:'world-diff',diff:{upserts,removes,defs,tiles:[]}});
 registry.invalidateDiff(diff([{id:'unrelated-soul'}]));assert.equal(timed(440)[0].observedSinceTick,430,'ordinary Soul writeback preserves fixture eligibility');
 registry.invalidateDiff(diff([{id:e.id}],[e.id]));assert.equal(timed(450)[0].observedSinceTick,450,'equal delete/reinsert invalidates');
 const {hash:_h,ref:_r,born:_b,by:_by,...rawParent}=d;
 const parentDef=model.defineDef({...rawParent,name:'test-stair-parent',make:{kind:'mesh',asset:'f'.repeat(64)}},'test',0);
 const parent={...e,id:'stair-parent',def:'sha:'+parentDef.hash,in:{parent:'world'},p:[0,0,0],r:0} as Entity;
 model.insert(parent);model.delete(e.id);model.insert({...e,in:{parent:parent.id}});registry.clearObservation();
 assert.equal(timed(460)[0].observedSinceTick,460);
 assert.equal(registry.affectsDiff(diff([{id:parent.id}])),true,'old ancestor pose is a fixture dependency');
 registry.invalidateDiff(diff([],[],[{ref:parentDef.ref,hash:parentDef.hash}]));assert.equal(timed(470)[0].observedSinceTick,470,'ancestor definition is a fixture dependency');
 registry.invalidateDiff({diff:{world:{day:2}}});assert.equal(timed(480)[0].observedSinceTick,480,'world/terrain change remains conservative');
});
test('pending fixture edits clear contacts before the existing layer update pass',()=>{
 assert.equal(pendingStairDiff(10,[{kind:'world-diff',seq:11}]),true);
 assert.equal(pendingStairDiff(10,[{kind:'world-diff',seq:9},{kind:'world-diff',seq:10},{kind:'world-build',seq:11}]),false);
 assert.equal(pendingStairDiff(10,[{kind:'world-diff',seq:11},{kind:'world-diff',seq:12}],()=>false),false,'contiguous unrelated writebacks do not starve admission');
 assert.equal(pendingStairDiff(10,[{kind:'world-diff',seq:12}],()=>false),true,'sequence gap resets all observations');
 assert.equal(pendingStairDiff(10,[{kind:'world-diff',seq:NaN}],()=>false),true,'malformed sequence cannot certify stability');
});
