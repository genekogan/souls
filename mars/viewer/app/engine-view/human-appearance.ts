// World-owned loader-to-clone provenance. No names/colours infer a material role.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
export type AppearancePrimitive={source:THREE.SkinnedMesh;node:string;meshIndex:number;primitiveIndex:number;slot:number;originalMaterial:THREE.Material};
export type TemplateAppearance={template:'casual'|'punk'|'woman';sourceAssetSHA:string;primitives:readonly AppearancePrimitive[]};
export type ActorAppearance={template:TemplateAppearance['template'];sourceAssetSHA:string;bindings:readonly {node:string;meshIndex:number;primitiveIndex:number;slot:number;mesh:THREE.SkinnedMesh;originalMaterial:THREE.Material}[]};

/** Caller has hashed the fetched original bytes. Unknown assets retain Simple. */
export async function collectTemplateAppearance(gltf:GLTF,template:string,sourceAssetSHA:string):Promise<TemplateAppearance|undefined>{
 if(template!=='casual'&&template!=='punk'&&template!=='woman')return;
 const {HUMAN_ASSETS}=await import('./content/details/human-presets/presets.mjs');
 const asset=HUMAN_ASSETS[template];if(sourceAssetSHA!==asset.sha256)return;
 const primitives:AppearancePrimitive[]=[],seen=new Set<string>();let failed=false;
 gltf.scene.traverse(object=>{
  if(!(object instanceof THREE.SkinnedMesh))return;
  if(Array.isArray(object.material)){failed=true;return;}
  // Installed loader emits primitive indices; its GLTFReference declaration
  // omits that optional field. Actual loaded counterpart verifies this shape.
  const mesh=gltf.parser.associations.get(object) as {meshes?:number;primitives?:number}|undefined,material=gltf.parser.associations.get(object.material);
  let ancestor:THREE.Object3D|null=object,node:number|undefined;
  while(ancestor){const n=gltf.parser.associations.get(ancestor)?.nodes;if(Number.isInteger(n)){node=n;break;}ancestor=ancestor.parent;}
  const expected=asset.primitives.find(p=>p.nodeIndex===node&&p.mesh===mesh?.meshes&&p.primitive===mesh?.primitives&&p.material===material?.materials);
  if(!expected){failed=true;return;}
  const key=expected.node+':'+expected.mesh+':'+expected.primitive;
  if(seen.has(key)){failed=true;return;}seen.add(key);
  primitives.push(Object.freeze({source:object,node:expected.node,meshIndex:expected.mesh,primitiveIndex:expected.primitive,slot:expected.material,originalMaterial:object.material}));
 });
 if(failed||primitives.length!==asset.primitives.length)return;
 return Object.freeze({template,sourceAssetSHA,primitives:Object.freeze(primitives)});
}

/** SkeletonUtils clones retain hierarchy order; parser associations do not.
 * Transfer explicit source records before fitting adds any actor-only children. */
export function transferActorAppearance(sourceRoot:THREE.Object3D,cloneRoot:THREE.Object3D,appearance:TemplateAppearance|undefined):ActorAppearance|undefined{
 if(!appearance)return;
 const lookup=new Map<THREE.Object3D,THREE.Object3D>();let failed=false;
 const pair=(source:THREE.Object3D,clone:THREE.Object3D)=>{
  if(source.type!==clone.type||source.children.length!==clone.children.length){failed=true;return;}
  lookup.set(source,clone);source.children.forEach((child,i)=>pair(child,clone.children[i]));
 };pair(sourceRoot,cloneRoot);if(failed)return;
 const bindings=[];
 for(const p of appearance.primitives){const mesh=lookup.get(p.source);
  if(!(mesh instanceof THREE.SkinnedMesh)||mesh.geometry!==p.source.geometry||mesh.material!==p.originalMaterial||mesh.skeleton===p.source.skeleton)return;
  bindings.push(Object.freeze({node:p.node,meshIndex:p.meshIndex,primitiveIndex:p.primitiveIndex,slot:p.slot,mesh,originalMaterial:p.originalMaterial}));
 }
 return Object.freeze({template:appearance.template,sourceAssetSHA:appearance.sourceAssetSHA,bindings:Object.freeze(bindings)});
}

type AppearanceHandle=Extract<ReturnType<typeof import('./content/details/human-presets/adapter.ts').prepareHumanPreset>,{attach:unknown}>;
/** Retained explicitly for caller recovery; a foreign material is never overwritten. */
const quarantinedAppearances=new Set<HumanActorAppearance>();
export class HumanActorAppearance{
 private active=true;
 private epoch=0;
 private token={};
 private handle:AppearanceHandle|undefined;
 private state='simple';
 private presetId:string|null=null;
 readonly ready:Promise<void>;
 private readonly root:THREE.Object3D;
 private readonly appearance:ActorAppearance|undefined;
 private readonly soulKey:unknown;
 constructor(root:THREE.Object3D,appearance:ActorAppearance|undefined,soulKey:unknown){this.root=root;this.appearance=appearance;this.soulKey=soulKey;
  this.ready=this.start().catch(()=>{this.release();});
 }
 private async start(){
  if(!this.appearance||typeof this.soulKey!=='string')return;
  this.state='pending';
  const [{socialPresetForSoul,SOCIAL_PRESET_VERSION},{prepareHumanPreset}]=await Promise.all([
   import('./content/details/human-presets/presets.mjs'),import('./content/details/human-presets/adapter.ts')]);
  if(!this.active)return;
  const preset=socialPresetForSoul(this.soulKey,this.appearance.template,SOCIAL_PRESET_VERSION,this.appearance.sourceAssetSHA);
  if(preset.quality!=='InertPreset'){this.state='simple';return;}
  const epoch=this.epoch,token=this.token;
  const handle=prepareHumanPreset({presetId:preset.id,presetVersion:preset.version,sourceAssetSHA:this.appearance.sourceAssetSHA,root:this.root,bindings:this.appearance.bindings,
   owner:{epoch,alive:()=>this.active,currentEpoch:()=>this.epoch,actorToken:token,currentActorToken:()=>this.token}});
  if(!('attach'in handle)){this.state='simple';return;}
  this.handle=handle;
  if(!this.active||!handle.attach()){this.release();return;}
  this.presetId=preset.id;this.state='attached';
 }
 private release(){
  if(this.handle&&!this.handle.detach()){this.state='quarantined';quarantinedAppearances.add(this);return false;}
  this.handle=undefined;quarantinedAppearances.delete(this);this.presetId=null;this.state=this.active?'simple':'retired';return true;
 }
 retire(){this.active=false;this.epoch++;return this.release();}
 snapshot(){return {state:this.state,presetId:this.presetId,template:this.appearance?.template??null,ownedMaterials:this.handle?.snapshot().ownedMaterialCount??0};}
}
export function humanAppearanceQuarantineCount(){return quarantinedAppearances.size;}
/** Only a caller that has resolved foreign references should request recovery. */
export function recoverHumanAppearances(){for(const owner of Array.from(quarantinedAppearances))owner.retire();return quarantinedAppearances.size;}
