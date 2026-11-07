// Bounded cosmetic contact registry for known, actually loaded mesh representations.
import * as THREE from 'three';
import type {WorldModel,Entity,StoredDef} from '@souls/world-compiler';
import {sha256} from '../../../mars/viewer/engine/core/hash.ts';
import {meshStairFlight,stairGeometryDigest,type MeshStairProfile,type Triangle} from '../../../mars/viewer/app/engine-view/stair-mesh-profile.ts';
import {StairObservation,type SupplementalStair} from '../../../mars/viewer/app/engine-view/stair-frame.ts';
import manifest from '../../../mars/viewer/app/engine-view/stair-mesh-profiles.json' with {type:'json'};
const profiles=manifest.profiles as MeshStairProfile[];
type DrawnStair={obj:THREE.Object3D;settled?:boolean;removing?:boolean};
type Candidate={entity:Entity;def:StoredDef;pose:ReturnType<WorldModel['worldPose']>;nativeDef:string;profiles:MeshStairProfile[];lineage:Set<string>;definitions:Set<string>};
const point=new THREE.Vector3();
/** People are posed before the layer's existing end-of-frame diff/update pass.
 * Refuse metadata for that transition frame instead of reordering that pipeline. */
export function pendingStairDiff(seq:number,messages:readonly {kind?:string;seq?:unknown}[],affects:(m:unknown)=>boolean=()=>true):boolean{
  let through=seq;
  for(const m of messages){
    if(m.kind!=='world-diff')continue;
    if(typeof m.seq!=='number'||!Number.isSafeInteger(m.seq))return true;
    if(m.seq<=through)continue;
    if(m.seq!==through+1||affects(m))return true;
    through=m.seq;
  }
  return false;
}
/** Loaded source geometry in its base-centred, unscaled canonical frame.
 * Material merges and shadow proxies do not create extra physical support. */
export function loadedStairGeometry(asset:THREE.Object3D):Triangle[]{
  asset.updateWorldMatrix(true,true);
  const inverse=new THREE.Matrix4().copy(asset.matrixWorld).invert(),result:Triangle[]=[];
  asset.traverse(o=>{
    const mesh=o as THREE.Mesh;if(!mesh.isMesh||mesh.name==='shadow-proxy'||mesh.userData.shadowProxy||mesh instanceof THREE.InstancedMesh)return;
    const p=mesh.geometry.getAttribute('position'),idx=mesh.geometry.getIndex();if(!p)return;
    const matrix=new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),start=mesh.geometry.drawRange.start,count=Math.min(mesh.geometry.drawRange.count,(idx?.count??p.count)-start);
    for(let k=start;k+2<start+count;k+=3)result.push([0,1,2].map(j=>{point.fromBufferAttribute(p,idx?idx.getX(k+j):k+j).applyMatrix4(matrix);return [point.x,point.y,point.z];}) as Triangle);
  });
  return result;
}
/** Only the already supported seen-only building adapter, with no slot policy.
 * Matches catalog-adapter.assetIdFor's existing contract, independently tested. */
export function stairNativeDef(d:StoredDef,e:Entity,box:readonly number[],scale:number):string|null{
  if(d.slots.some(s=>s.kind==='seat'||s.kind==='bed')||(['seat','bed','carryable','surface','display','container','readable','workstation','instrument','boardGame','hover'] as const).some(k=>d.components[k])||d.tags.includes('fire'))return null;
  const text=`${d.hash}|${JSON.stringify(e.params??{})}|seen|${box.map(v=>Math.round(v*scale*10000)/10000).join(',')}`;
  return `ew:${d.ref.replace(/[^a-z0-9/@._-]/gi,'').slice(0,48)}:${sha256(text).slice(0,10)}`;
}
export class WorldEntityStairs{
  private observation=new StairObservation();
  private key:object|null=null;
  private candidates:Candidate[]=[];
  private loaded=new WeakMap<THREE.Object3D,{asset:THREE.Object3D;profile:MeshStairProfile|null;diagnostic:string|null}>();
  private notices=new Map<string,string>();
  diagnostics(){return [...this.notices].map(([entity,reason])=>({entity,reason}));}
  /** Uses the previously observed lineage, before an edit can delete/reparent it.
   * Normal Soul writebacks cannot erase a static fixture's lifetime evidence. */
  affectsDiff(message:unknown):boolean{
    const m=message as {ground?:unknown;defs?:{ref?:string;hash?:string}[];diff?:{upserts?:{id:string}[];removes?:string[];defs?:{ref?:string;hash?:string}[];tiles?:string[];world?:unknown;constants?:unknown}};
    const d=m?.diff;if(!d||typeof d!=='object'||Array.isArray(d)||m.ground!==undefined||d.world!==undefined||d.constants!==undefined||d.tiles?.length)return true;
    if([d.upserts,d.removes,d.defs,d.tiles,m.defs].some(v=>v!==undefined&&!Array.isArray(v)))return true;
    if(d.upserts?.some(e=>!e||typeof e.id!=='string')||d.removes?.some(id=>typeof id!=='string')||[...(m.defs??[]),...(d.defs??[])].some(d=>!d||typeof d.ref!=='string'||typeof d.hash!=='string'))return true;
    const ids=[...(d.upserts??[]).map(e=>e.id),...(d.removes??[])],defs=[...(m.defs??[]),...(d.defs??[])];
    return this.candidates.some(c=>ids.some(id=>c.lineage.has(id))||defs.some(d=>(!!d.ref&&c.definitions.has(d.ref))|| (!!d.hash&&c.definitions.has(d.hash))));
  }
  invalidateDiff(message:unknown){if(this.affectsDiff(message))this.clearObservation();}
  clearObservation(){this.observation.clear();}
  reset(){this.key=null;this.candidates=[];this.loaded=new WeakMap();this.notices.clear();this.clearObservation();}
  contacts(model:WorldModel,drawn:ReadonlyMap<string,DrawnStair>,ground:(x:number,z:number)=>number|null,nativeTick:number|null=null):SupplementalStair[]{
    const key=model.safetyCacheKey();
    if(this.key!==key){
      this.key=key;this.candidates=[];this.notices.clear();
      for(const e of model.entities.values()){
        const d=model.resolvedDef(e.def);if(d?.make.kind!=='mesh')continue;
        const make=d.make,matches=profiles.filter(p=>p.asset===make.asset);if(!matches.length)continue;
        if(make.lod1){this.notices.set(e.id,'stair.lod-representation-unqualified');continue;}
        const pose=model.worldPose(e),nativeDef=stairNativeDef(d,e,model.bake(d,e.params??{},e.seed??0,e.shape).box,pose.s);
        if(!nativeDef){this.notices.set(e.id,'stair.native-provenance-unsupported');continue;}
        if(Array.isArray(e.r)&&(e.r[1]||e.r[2])||Object.keys(e.params??{}).some(k=>['sx','sy','sz'].includes(k))){this.notices.set(e.id,'stair.nonuniform-or-tilted');continue;}
        const lineage=new Set([e.id,...model.ancestors(e.id)]),definitions=new Set<string>();
        for(const id of lineage){const parent=model.entities.get(id),def=parent&&model.resolvedDef(parent.def);if(def){definitions.add(def.ref);definitions.add(def.hash);}}
        this.candidates.push({entity:e,def:d,pose,nativeDef,profiles:matches,lineage,definitions});
      }
    }
    const contacts:SupplementalStair[]=[];
    for(const c of this.candidates){
      const d=drawn.get(c.entity.id);if(!d||d.removing||!d.settled){this.notices.set(c.entity.id,'stair.representation-unsettled');continue;}
      if(d.obj.position.distanceTo(new THREE.Vector3(c.pose.x,c.pose.y,c.pose.z))>.001||Math.abs(d.obj.rotation.y-c.pose.yaw)>.001||Math.abs(d.obj.rotation.x)>.001||Math.abs(d.obj.rotation.z)>.001||[d.obj.scale.x,d.obj.scale.y,d.obj.scale.z].some(s=>Math.abs(s-c.pose.s)>.001)){this.notices.set(c.entity.id,'stair.drawn-pose-mismatch');continue;}
      const asset=d.obj.getObjectByName('asset');if(!asset){this.notices.set(c.entity.id,'stair.representation-not-loaded');continue;}
      let shown=true;for(let o:THREE.Object3D|null=asset;o;o=o.parent){if(!o.visible){shown=false;break;}if(o===d.obj)break;}
      if(!shown){this.notices.set(c.entity.id,'stair.representation-hidden');continue;}
      let cached=this.loaded.get(d.obj);
      if(!cached||cached.asset!==asset){
        this.clearObservation();
        const geometry=stairGeometryDigest(loadedStairGeometry(asset)),profile=c.profiles.find(p=>p.geometry===geometry)??null;
        cached={asset,profile,diagnostic:profile?null:'stair.loaded-geometry-mismatch'};this.loaded.set(d.obj,cached);
      }
      if(!cached.profile){this.notices.set(c.entity.id,cached.diagnostic!);continue;}
      // The actual fitting scale belongs to the loaded representation, not an obsolete asset-index box.
      const p=cached.profile,fit=c.def.size.box[p.fitAxis]/p.extent[p.fitAxis];
      if(Math.abs(asset.scale.x-fit)>.0001||Math.abs(asset.scale.y-fit)>.0001||Math.abs(asset.scale.z-fit)>.0001){this.notices.set(c.entity.id,'stair.fit-mismatch');continue;}
      const f=meshStairFlight(p,`${c.entity.id}#${p.source.link}:${p.geometry.slice(0,12)}`,{...c.pose,s:c.pose.s*fit});if(!f)continue;
      // Lower approach is the existing terrain, not a fabricated GLB floor.
      const gx=f.o[0]+f.dir[0]*(f.supports![0].lo-.12*c.pose.s*fit),gz=f.o[1]+f.dir[1]*(f.supports![0].lo-.12*c.pose.s*fit),gy=ground(gx,gz);
      if(gy===null||Math.abs(gy-f.yBottom)>.025){this.notices.set(c.entity.id,'stair.lower-terrain-mismatch');continue;}
      this.notices.delete(c.entity.id);
      contacts.push({entity:c.entity.id,nativeDef:c.nativeDef,pose:{p:[c.pose.x,c.pose.y,c.pose.z],yaw:-c.pose.yaw},flight:f,geometry:p.geometry});
    }
    return this.observation.observe(contacts,nativeTick);
  }
}
