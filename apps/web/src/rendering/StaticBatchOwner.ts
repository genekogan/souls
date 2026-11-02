import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Derived draw geometry only. Callers provide explicitly static roots, never
 * the whole animated scene. Original objects remain the picking/export authority. */
export type StaticBatchLimits={cellSize:number;maxMeshes:number;maxNodes:number;maxMergedBytes:number;maxWorkingBytes:number;maxMeshesPerBatch:number};
export const STATIC_BATCH_LIMITS:StaticBatchLimits=Object.freeze({cellSize:24,maxMeshes:8192,maxNodes:65536,maxMergedBytes:32*1024*1024,maxWorkingBytes:64*1024*1024,maxMeshesPerBatch:64});
/** `sharePlainMaterials`: untextured opaque MeshStandardMaterials that differ only in colour share one derived material
 * per cell, the colour baked into vertex colours (the multiply the shader did; gen-mesh/static-merge.ts does the same per
 * loaded file). `hideWholeRoots`: a root whose every drawable is batched is hidden whole during the draw (three.js walks one
 * object instead of its subtree) rather than mesh by mesh. `incremental`: batches whose sources are the same, unchanged meshes as last time keep their merged
 * geometry (PERF-BATCH: a thaw or a new thing re-merges one cell, not a world). */
/** PERF-BATCH: how a caller merges meshes whose material patches its shader with per-object inputs: `material(m)` gives
 * the derived material a merged batch of `m` draws with (null: never merge `m`), `attributes(copy, mesh, toBatch)` adds
 * to a source geometry copy, still in the source's own frame, whatever that derived material reads per vertex. */
// PERF-BATCH round 2: `source` names the material a mesh is bucketed, derived and validated by when its own material is a
// per-object variant of it (a steady lamp glow swaps quantized-level variants of one base; the merged batch tracks the level).
export type StaticShaderMerge={material(m:THREE.Material):THREE.Material|null;attributes(copy:THREE.BufferGeometry,mesh:THREE.Mesh,toBatch:THREE.Matrix4,derived:THREE.Material):void;source?(mesh:THREE.Mesh):THREE.Material|null};
const materialOf=(mesh:THREE.Mesh,shaderMerge?:StaticShaderMerge):THREE.Material=>shaderMerge?.source?.(mesh)??mesh.material as THREE.Material;
export type StaticBatchPreparation={generation:number;signal?:AbortSignal;budgetPolicy?:'partial-cells/1';sharePlainMaterials?:boolean;incremental?:boolean;hideWholeRoots?:boolean;shaderMerge?:StaticShaderMerge;
 /** PERF-LOAD: give the main thread back after this many ms of work (one cell at a time); the old batches keep drawing
  *  until the new set is complete, and a newer generation started meanwhile makes this one obsolete. */
 sliceMs?:number};
type AttributeStamp={name:string;attribute:THREE.BufferAttribute;version:number};
type MaterialProgram={compile:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey'];value:string};
type MergedMaterial=THREE.Material|null|false;  // false: a custom material factory threw
type Source={mesh:THREE.Mesh;root:THREE.Object3D;geometry:THREE.BufferGeometry;material:THREE.Material;matrix:number[];attributes:AttributeStamp[];index:THREE.BufferAttribute|null;indexVersion:number;materialVersion:number;program:MaterialProgram;layers:number;cast:boolean;receive:boolean;order:number;frustum:boolean;bounds:readonly number[];plain:string|null};
type Batch={mesh:THREE.Mesh;sources:Source[];bytes:number;key:string;okay:boolean};
type RootInfo={batches:Batch[];whole:boolean};
const meshBefore=THREE.Object3D.prototype.onBeforeRender,meshAfter=THREE.Object3D.prototype.onAfterRender,shadowBefore=THREE.Object3D.prototype.onBeforeShadow,shadowAfter=THREE.Object3D.prototype.onAfterShadow,materialBefore=THREE.Material.prototype.onBeforeRender,compile=THREE.Material.prototype.onBeforeCompile;
const visible=(o:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(!p.visible)return false;return true;};
const within=(o:THREE.Object3D,root:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(p===root)return true;return false;};
type ValidationWindow={materials:Map<THREE.Material,boolean>;paths:Map<THREE.Object3D,boolean>;geometries:Map<THREE.BufferGeometry,boolean>;programs:Map<THREE.Material,MaterialProgram|null>;derived:Map<THREE.Material,MergedMaterial>};
const validationWindow=():ValidationWindow=>({materials:new Map(),paths:new Map(),geometries:new Map(),programs:new Map(),derived:new Map()});
function mergedMaterial(m:THREE.Material,shaderMerge:StaticShaderMerge|undefined,cache?:Map<THREE.Material,MergedMaterial>):MergedMaterial{
 if(cache?.has(m))return cache.get(m)!;let result:MergedMaterial;try{result=shaderMerge?.material(m)??null;}catch{result=false;}cache?.set(m,result);return result;
}
function materialProgram(m:THREE.Material,cache:Map<THREE.Material,MaterialProgram|null>){
 if(cache.has(m))return cache.get(m)!;let result:MaterialProgram|null=null;try{const compile=m.onBeforeCompile,key=m.customProgramCacheKey,value=key.call(m);if(typeof value==='string')result={compile,key,value};}catch{/* An exotic source keeps its original draw; other cells remain usable. */}cache.set(m,result);return result;
}
function materialCurrent(s:Source,rendered:THREE.Material,cache:ValidationWindow,shaderMerge?:StaticShaderMerge){
 const current=materialProgram(s.material,cache.programs);if(!current||current.compile!==s.program.compile||current.key!==s.program.key||current.value!==s.program.value)return false;
 let shared=s.plain===null&&s.material===rendered;if(s.plain===null){const derived=mergedMaterial(s.material,shaderMerge,cache.derived);if(derived===false||(derived??s.material)!==rendered)return false;shared=shared&&derived===null;}
 // Three renders transparent DoubleSide in two passes, incrementing version for BackSide/FrontSide and restoring
 // DoubleSide afterwards. A batch using this exact live material sees its current state too. Copied/plain/derived
 // materials still require the original version; hook/key changes or a newly derived variant always invalidate.
 return s.material.version===s.materialVersion||shared&&s.material.version>s.materialVersion;
}
// A patched shader merges only when the patch is a class's own (`userData.batchSafeShader`: it reads nothing per
// object) or when the caller derives a merged variant for it (`shaderMerge`).
// `userData.batchSafePatch` declares an instance patch that reads nothing per object; `userData.batchTransparent` lets a
// transparent material merge per cell (its panes blend the same in any order).
const shaderOkay=(m:THREE.Material,shaderMerge?:StaticShaderMerge,derived?:Map<THREE.Material,MergedMaterial>)=>m.onBeforeCompile===compile||m.userData.batchSafeShader===true&&m.onBeforeCompile===Object.getPrototypeOf(m).onBeforeCompile||m.userData.batchSafePatch===true||!!mergedMaterial(m,shaderMerge,derived);
const opaqueOkay=(m:THREE.Material)=>!m.transparent&&m.opacity===1&&m.depthWrite||m.userData.batchTransparent===true;
function materialEligible(m:THREE.Material,cache?:Map<THREE.Material,boolean>,shaderMerge?:StaticShaderMerge,derived?:Map<THREE.Material,MergedMaterial>){
 const known=cache?.get(m);if(known!==undefined)return known;
 const surface=m as THREE.MeshPhysicalMaterial;
 const result=!(m as THREE.ShaderMaterial).isShaderMaterial&&!(m as THREE.RawShaderMaterial).isRawShaderMaterial&&!(surface.transmission>0)&&!surface.displacementMap&&!(surface.normalMap&&surface.normalMapType===THREE.ObjectSpaceNormalMap)&&m.visible&&opaqueOkay(m)&&m.depthTest&&m.blending===THREE.NormalBlending&&shaderOkay(m,shaderMerge,derived)&&m.onBeforeRender===materialBefore&&!Object.values(m).some(v=>(v as {isVideoTexture?:boolean}|null)?.isVideoTexture);
 cache?.set(m,result);return result;
}
function eligible(mesh:THREE.Mesh,root:THREE.Object3D,materials?:Map<THREE.Material,boolean>,pathValidated=false,geometryValidated=false,matrixValidated=false,shaderMerge?:StaticShaderMerge,derived?:Map<THREE.Material,MergedMaterial>){
 // PERF-BATCH: `userData.rangeHook` marks hooks that only ever narrow the draw range (a building's storey cut); the
 // caller promises, through its trusted revision, that the range is full while the mesh is batched.
 if(mesh.constructor!==THREE.Mesh||mesh.children.length||mesh.raycast!==THREE.Mesh.prototype.raycast||mesh.userData.rangeHook!==true&&(mesh.onBeforeRender!==meshBefore||mesh.onAfterRender!==meshAfter||mesh.onBeforeShadow!==shadowBefore||mesh.onAfterShadow!==shadowAfter)||mesh.customDepthMaterial||mesh.customDistanceMaterial||Array.isArray(mesh.material))return false;
 if(!pathValidated)for(let p:THREE.Object3D|null=mesh;p;p=p.parent){if(p.animations.length||p.userData.dynamicScreen||p.userData.renderDynamic||p.userData.kind==='context_person')return false;if(p===root)break;}
 const m=materialOf(mesh,shaderMerge),g=mesh.geometry;
 if(!materialEligible(m,materials,shaderMerge,derived))return false;
 if(!geometryValidated&&!geometryEligible(g))return false;
 return matrixValidated||mesh.matrixWorld.elements.every(Number.isFinite)&&mesh.matrixWorld.determinant()>1e-12;
}
function geometryEligible(g:THREE.BufferGeometry){const pos=g.attributes.position;
 if(!pos||pos.itemSize!==3||!(pos.array instanceof Float32Array)||g.drawRange.start!==0||g.drawRange.count!==Infinity||Object.keys(g.morphAttributes).length)return false;
 for(const a of Object.values(g.attributes))if((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)return false;
 return !(g.attributes.normal&&!(g.attributes.normal.array instanceof Float32Array)||g.attributes.tangent&&!(g.attributes.tangent.array instanceof Float32Array));
}
// This cache lives for one synchronous window only. It never survives a change
// to visibility, hierarchy or material between frames. Static root membership is
// checked separately so reparenting within the scene cannot retain authority.
function pathCurrent(o:THREE.Object3D,cache:Map<THREE.Object3D,boolean>):boolean{
 const known=cache.get(o);if(known!==undefined)return known;
 const okay=o.visible&&!o.animations.length&&!o.userData.dynamicScreen&&!o.userData.renderDynamic&&o.userData.kind!=='context_person'&&(!o.parent||pathCurrent(o.parent,cache));cache.set(o,okay);return okay;
}
const geometryBytes=(g:THREE.BufferGeometry)=>Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?.array.byteLength??0);
const estimatedBytes=(g:THREE.BufferGeometry)=>Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?g.index.count*4:0);
/** A plain merged vertex is position, normal and colour (36 bytes); a 32-bit index per source index or vertex. */
const estimatedPlainBytes=(g:THREE.BufferGeometry)=>g.attributes.position.count*36+(g.index?g.index.count:g.attributes.position.count)*4;
const bounds=(g:THREE.BufferGeometry)=>[...(g.boundingBox?[g.boundingBox.min.x,g.boundingBox.min.y,g.boundingBox.min.z,g.boundingBox.max.x,g.boundingBox.max.y,g.boundingBox.max.z]:[]),...(g.boundingSphere?[g.boundingSphere.center.x,g.boundingSphere.center.y,g.boundingSphere.center.z,g.boundingSphere.radius]:[]),g.boundingBox?1:0,g.boundingSphere?1:0];
function boundsCurrent(g:THREE.BufferGeometry,b:readonly number[]){const box=g.boundingBox,sphere=g.boundingSphere;let i=0;if(!!box!==!!b[b.length-2]||!!sphere!==!!b[b.length-1])return false;if(box&&(box.min.x!==b[i++]||box.min.y!==b[i++]||box.min.z!==b[i++]||box.max.x!==b[i++]||box.max.y!==b[i++]||box.max.z!==b[i++]))return false;return !sphere||sphere.center.x===b[i++]&&sphere.center.y===b[i++]&&sphere.center.z===b[i++]&&sphere.radius===b[i++];}
function source(mesh:THREE.Mesh,root:THREE.Object3D,plain:string|null,material:THREE.Material,program:MaterialProgram):Source{return{mesh,root,geometry:mesh.geometry,material,matrix:[...mesh.matrixWorld.elements],attributes:Object.entries(mesh.geometry.attributes).map(([name,a])=>({name,attribute:a as THREE.BufferAttribute,version:(a as THREE.BufferAttribute).version})),index:mesh.geometry.index,indexVersion:mesh.geometry.index?.version??0,materialVersion:material.version,program,layers:mesh.layers.mask,cast:casts(mesh),receive:mesh.receiveShadow,order:mesh.renderOrder,frustum:mesh.frustumCulled,bounds:bounds(mesh.geometry),plain};}
function unchanged(s:Source,scene:THREE.Scene,cache:ValidationWindow,rendered:THREE.Material,shaderMerge?:StaticShaderMerge){const m=s.mesh,g=m.geometry;
 if(!within(s.root,scene)||!within(m,s.root)||!pathCurrent(m,cache.paths)||!eligible(m,s.root,cache.materials,true,true,true,shaderMerge,cache.derived)||g!==s.geometry||materialOf(m,shaderMerge)!==s.material||!materialCurrent(s,rendered,cache,shaderMerge)||m.layers.mask!==s.layers||casts(m)!==s.cast||m.receiveShadow!==s.receive||m.renderOrder!==s.order||m.frustumCulled!==s.frustum||!m.matrixWorld.elements.every((n,i)=>n===s.matrix[i]))return false;
 let geometryCurrent=cache.geometries.get(g);if(geometryCurrent===undefined){geometryCurrent=geometryEligible(g)&&Object.keys(g.attributes).length===s.attributes.length&&s.attributes.every(a=>g.attributes[a.name]===a.attribute&&a.attribute.version===a.version)&&g.index===s.index&&(g.index?.version??0)===s.indexVersion&&boundsCurrent(g,s.bounds);cache.geometries.set(g,geometryCurrent);}return geometryCurrent;
}
// PERF-BATCH: `userData.batchSafeShader` on a material says its shader patch reads nothing per object (the kit's
// surfaces: per-vertex shape metres), so its meshes may merge. A plain material is an untextured, opaque, unclipped MeshStandardMaterial (no subclass: the kit's surface
// and vertex-glow materials patch the shader). Its signature is everything the shader reads but the colour, which the
// merged vertices carry instead (white material × vertex colour = colour × 1: the same multiply, in linear space).
const MAPS=['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','alphaMap','bumpMap','lightMap','displacementMap','envMap'] as const;
function plainSignature(m:THREE.Material,cache:Map<THREE.Material,string|null>):string|null{
 const known=cache.get(m);if(known!==undefined)return known;
 const s=m as THREE.MeshStandardMaterial;
 const sig=m.constructor!==THREE.MeshStandardMaterial||s.transparent||s.opacity!==1||!s.depthWrite||s.onBeforeCompile!==compile||s.wireframe||s.alphaTest!==0||s.alphaHash||s.alphaToCoverage||s.clippingPlanes||s.stencilWrite||MAPS.some(k=>s[k])?null:
  ['plain',s.side,s.shadowSide,s.roughness,s.metalness,s.emissive.r,s.emissive.g,s.emissive.b,s.emissiveIntensity,s.flatShading,s.polygonOffset,s.polygonOffsetFactor,s.polygonOffsetUnits,s.envMapIntensity,s.dithering,s.toneMapped,s.fog,s.depthFunc,s.colorWrite,s.forceSinglePass,s.premultipliedAlpha,s.precision,s.vertexColors?1:0,JSON.stringify(s.defines??null)].join('|');
 cache.set(m,sig);return sig;
}
function derivedPlainMaterial(from:THREE.MeshStandardMaterial){
 const d=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,side:from.side,shadowSide:from.shadowSide,roughness:from.roughness,metalness:from.metalness,emissive:from.emissive.clone(),emissiveIntensity:from.emissiveIntensity,flatShading:from.flatShading,polygonOffset:from.polygonOffset,polygonOffsetFactor:from.polygonOffsetFactor,polygonOffsetUnits:from.polygonOffsetUnits,envMapIntensity:from.envMapIntensity,dithering:from.dithering,toneMapped:from.toneMapped,fog:from.fog,depthFunc:from.depthFunc,colorWrite:from.colorWrite,forceSinglePass:from.forceSinglePass,premultipliedAlpha:from.premultipliedAlpha,precision:from.precision});
 d.defines=from.defines?{...from.defines}:d.defines;d.name='Derived static material';return d;
}
/** The source geometry with only position, normal (computed when absent) and the material colour × its vertex colour. */
function plainCopy(s:Source){
 const g=s.geometry,n=g.attributes.position.count,copy=new THREE.BufferGeometry();
 copy.setAttribute('position',g.attributes.position.clone());
 if(g.attributes.normal)copy.setAttribute('normal',g.attributes.normal.clone());else copy.computeVertexNormals();
 const base=(s.material as THREE.MeshStandardMaterial).color,vc=(s.material as THREE.MeshStandardMaterial).vertexColors?g.attributes.color:undefined,color=new Float32Array(n*3);
 for(let i=0;i<n;i++){const o=i*3;if(vc&&vc.itemSize>=3){color[o]=base.r*vc.getX(i);color[o+1]=base.g*vc.getY(i);color[o+2]=base.b*vc.getZ(i);}else{color[o]=base.r;color[o+1]=base.g;color[o+2]=base.b;}}
 copy.setAttribute('color',new THREE.BufferAttribute(color,3));
 if(g.index)copy.setIndex(g.index.clone());
 return copy;
}
// lane PERF-MATERIALS: a mesh whose shadow a generated shadow proxy draws (`userData.shadowProxied`, castShadow off) casts
// from its batch instead: the cell batch is the cheaper caster, and the proxy stands down while its casters are batched.
const casts=(m:THREE.Mesh)=>m.castShadow||m.userData.shadowProxied===true;
const inert=(o:THREE.Object3D)=>o.constructor===THREE.Object3D||o.constructor===THREE.Group;

/** One macrotask's pause: a posted message, not a clamped timer. */
const yieldMain=()=>new Promise<void>(resolve=>{if(typeof MessageChannel==='undefined'){setTimeout(resolve,0);return;}const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();resolve();};c.port2.postMessage(0);});

export class StaticBatchOwner{
 readonly group=new THREE.Group();private scene:THREE.Scene;private limits:StaticBatchLimits;private batches:Batch[]=[];private roots:THREE.Object3D[]=[];private rootInfo=new Map<THREE.Object3D,RootInfo>();private disposed=false;private rendering=false;private generation:number|null=null;private latestGeneration=-1;private fallback=0;private used=0;private validationCpuMs=0;private restoreCpuMs=0;private prepareCpuMs=0;private sourceNodes=0;private sourceMeshes=0;private preparationError:string|null=null;private budgetSkippedMeshes=0;private budgetSkippedBatches=0;private workingGeometryPeakBytes=0;private callsSaved=0;private validatedRevision:number|null=null;private validatedLastRender=false;private reusedBatches=0;private sourceMaterials=0;private wholeRootsHidden=0;private sharedMaterials=new Map<string,THREE.MeshStandardMaterial>();private shaderMerge:StaticShaderMerge|undefined;
 constructor(scene:THREE.Scene,limits:Partial<StaticBatchLimits>={}){this.scene=scene;this.limits={...STATIC_BATCH_LIMITS,...limits};if(Object.values(this.limits).some(n=>!Number.isFinite(n)||n<=0)||!Number.isInteger(this.limits.maxMeshes)||!Number.isInteger(this.limits.maxNodes)||!Number.isInteger(this.limits.maxMeshesPerBatch)||this.limits.maxWorkingBytes<this.limits.maxMergedBytes)throw Error('static-batches.invalid-limits');this.group.name='Derived static render batches';this.group.visible=false;scene.add(this.group);}
 private release(batches:Batch[]){for(const batch of batches){batch.mesh.geometry.dispose();batch.mesh.removeFromParent();}}
 /** Forget the live set without disposing it (an incremental preparation reuses or releases its batches). */
 private retire(){this.batches=[];this.roots=[];this.rootInfo.clear();this.generation=null;this.validatedRevision=null;this.callsSaved=this.used=this.fallback=0;}
 private clear(){this.release(this.batches);this.batches=[];this.roots=[];this.rootInfo.clear();this.generation=null;this.validatedRevision=null;this.callsSaved=this.used=this.fallback=0;}
 private preparation=0;
 reset(){if(this.rendering)throw Error('static-batches.reset-during-render');this.preparation++;this.clear();}
 async prepare(roots:readonly THREE.Object3D[],{generation,signal,budgetPolicy,sharePlainMaterials=false,incremental=false,hideWholeRoots=false,shaderMerge,sliceMs}:StaticBatchPreparation){
  if(this.disposed||this.rendering)throw Error('static-batches.unavailable');if(budgetPolicy!==undefined&&budgetPolicy!=='partial-cells/1')throw Error('static-batches.invalid-budget-policy');if(!Number.isSafeInteger(generation)||generation<0)throw Error('static-batches.invalid-generation');if(generation<this.latestGeneration)throw Error('static-batches.obsolete-generation');if(signal?.aborted)throw new DOMException('Obsolete render preparation','AbortError');this.latestGeneration=generation;
  // Sliced: the current batches stay live until the new set commits; built cells join the group only then.
  const preparation=++this.preparation,sliced=sliceMs!==undefined,previous=incremental||sliced?new Map(this.batches.map(b=>[b.key,b])):new Map<string,Batch>(),next:Batch[]=[],built:Batch[]=[];if(!sliced){if(incremental)this.retire();else this.clear();}let sliceStart=performance.now();const window=validationWindow();
  const obsolete=()=>this.disposed||signal?.aborted||preparation!==this.preparation;
  const breathe=()=>{if(obsolete())throw new DOMException('Obsolete render preparation','AbortError');if(!sliced||performance.now()-sliceStart<sliceMs)return null;return yieldMain().then(()=>{for(const cache of Object.values(window))cache.clear();signatures.clear();sliceStart=performance.now();if(obsolete())throw new DOMException('Obsolete render preparation','AbortError');});};
  this.budgetSkippedMeshes=this.budgetSkippedBatches=this.workingGeometryPeakBytes=this.reusedBatches=0;this.shaderMerge=shaderMerge;
  const prepareStart=performance.now(),options=this.limits,buckets=new Map<string,Source[]>(),seen=new Set<THREE.Object3D>(),signatures=new Map<THREE.Material,string|null>(),materials=new Set<THREE.Material>();let nodes=0,meshes=0,retained=0;this.preparationError=null;this.scene.updateMatrixWorld(true);
  try{
   for(const root of new Set(roots)){if(sliced){const pause=breathe();if(pause)await pause;}if(root===this.scene||!within(root,this.scene))throw Error('static-batches.unregistered-root');root.updateWorldMatrix(true,true);root.traverse(o=>{if(seen.has(o))return;seen.add(o);if(++nodes>options.maxNodes)throw Error('static-batches.node-budget');if(!(o as THREE.Mesh).isMesh||!visible(o)||!eligible(o as THREE.Mesh,root,undefined,false,false,false,shaderMerge,window.derived))return;if(++meshes>options.maxMeshes)throw Error('static-batches.mesh-budget');const m=o as THREE.Mesh,g=m.geometry,material=materialOf(m,shaderMerge),program=materialProgram(material,window.programs);if(!program)return;const signature=sharePlainMaterials?plainSignature(material,signatures):null,plain=signature!==null,attributes=plain?'plain':Object.entries(g.attributes).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(','),p=new THREE.Vector3().setFromMatrixPosition(m.matrixWorld),key=[signature??(mergedMaterial(material,shaderMerge,window.derived)||material).uuid  /* PERF-BATCH round 2: sources whose merged material is shared bucket together */,Math.floor(p.x/options.cellSize),Math.floor(p.z/options.cellSize),attributes,!!g.index,m.layers.mask,casts(m),m.receiveShadow,m.renderOrder,m.frustumCulled].join('|');materials.add(material);const bucket=buckets.get(key)??[];bucket.push(source(m,root,signature,material,program));buckets.set(key,bucket);});}
   const inverseScene=this.scene.matrixWorld.clone().invert(),candidates:{part:Source[];estimate:number;order:number;key:string}[]=[];
   // Bucket insertion follows source traversal, spatial cell, material and draw
   // state. Keep this stable order for equal benefit/byte ratios; UUIDs never
   // determine prioritization. Strict preparation retains its original order.
   for(const [bucketKey,sources] of buckets)for(let i=0;i<sources.length;i+=options.maxMeshesPerBatch){const part=sources.slice(i,i+options.maxMeshesPerBatch);if(part.length>=2)candidates.push({part,estimate:part.reduce((n,s)=>n+(s.plain?estimatedPlainBytes(s.geometry):estimatedBytes(s.geometry)),0),order:candidates.length,key:bucketKey+'#'+part.map(s=>s.mesh.uuid).join(',')});}
   if(budgetPolicy==='partial-cells/1')candidates.sort((a,b)=>(b.part.length-1)/Math.max(1,b.estimate)-(a.part.length-1)/Math.max(1,a.estimate)||a.order-b.order);
   for(const {part,estimate,key} of candidates){if(sliced){const pause=breathe();if(pause)await pause;}if(signal?.aborted)throw new DOMException('Obsolete render preparation','AbortError');
    const old=incremental?previous.get(key):undefined;if(old&&old.sources.every(s=>unchanged(s,this.scene,window,old.mesh.material as THREE.Material,shaderMerge))){previous.delete(key);next.push(old);retained+=old.bytes;this.reusedBatches++;continue;}
    if(retained+estimate>options.maxMergedBytes||retained+2*estimate>options.maxWorkingBytes){if(budgetPolicy==='partial-cells/1'){this.budgetSkippedMeshes+=part.length;this.budgetSkippedBatches++;continue;}throw Error('static-batches.geometry-budget');}this.workingGeometryPeakBytes=Math.max(this.workingGeometryPeakBytes,retained+2*estimate);const copies:THREE.BufferGeometry[]=[];let merged:THREE.BufferGeometry|null=null;const plain=part[0].plain;
    const derived=plain?null:mergedMaterial(part[0].material,shaderMerge,window.derived);if(derived===false)continue;
    try{for(const s of part){if(sliced){const pause=breathe();if(pause)await pause;}const copy=plain?plainCopy(s):s.geometry.clone();copies.push(copy);const toBatch=new THREE.Matrix4().multiplyMatrices(inverseScene,s.mesh.matrixWorld);if(derived)shaderMerge!.attributes(copy,s.mesh,toBatch,derived);copy.applyMatrix4(toBatch);}if(sliced){const pause=breathe();if(pause)await pause;}merged=mergeGeometries(copies,false);}finally{for(const g of copies)g.dispose();}
    if(!merged)continue;const bytes=geometryBytes(merged);if(retained+bytes>options.maxMergedBytes){merged.dispose();throw Error('static-batches.geometry-budget');}merged.computeBoundingBox();merged.computeBoundingSphere();const first=part[0];let material=derived??first.material;if(plain){let shared=this.sharedMaterials.get(plain);if(!shared){shared=derivedPlainMaterial(first.material as THREE.MeshStandardMaterial);this.sharedMaterials.set(plain,shared);}material=shared;}const mesh=new THREE.Mesh(merged,material);mesh.name='Derived static cell';mesh.castShadow=first.cast;mesh.receiveShadow=first.receive;mesh.renderOrder=first.order;mesh.frustumCulled=first.frustum;mesh.layers.mask=first.layers;const batch={mesh,sources:part,bytes,key,okay:false};next.push(batch);built.push(batch);retained+=bytes;
   }
   if(sliced){if(obsolete()||this.rendering)throw new DOMException('Obsolete render preparation','AbortError');this.retire();}
   this.release([...previous.values()]);previous.clear();for(const b of built)this.group.add(b.mesh);this.batches=next;built.length=0;
   // PERF-BATCH: a root whose every drawable is in a batch is hidden whole while its batches draw, so three.js walks
   // one object instead of its subtree (a lamp with a light, or a thing with a sprite, hides mesh by mesh).
   const batched=new Set<THREE.Mesh>();for(const batch of this.batches){for(const s of batch.sources){batched.add(s.mesh);const info=this.rootInfo.get(s.root)??{batches:[],whole:true};if(!info.batches.includes(batch))info.batches.push(batch);this.rootInfo.set(s.root,info);}}
   for(const [root,info] of this.rootInfo){const walk=(o:THREE.Object3D):boolean=>{if(!o.visible)return true;if(!inert(o)&&!batched.has(o as THREE.Mesh)&&o.userData.shadowProxy!==true)return false  /* a generated shadow proxy: its batched casters cast */;for(const c of o.children)if(!walk(c))return false;return true;};info.whole=hideWholeRoots&&walk(root);}
   this.roots=[...new Set(roots)];this.generation=generation;this.sourceMaterials=materials.size;return{generation,status:'ready' as const};
  }catch(error){if(sliced){this.release(built);if(error instanceof DOMException&&error.name==='AbortError')throw error  /* obsolete: the live set stays */;}else this.release([...next,...previous.values()]);this.clear();this.preparationError=error instanceof Error?error.message:'static-batches.prepare-failed';throw error;}finally{if(preparation===this.preparation){this.prepareCpuMs=performance.now()-prepareStart;this.sourceNodes=nodes;this.sourceMeshes=meshes;}}
 }
 /** Semantic originals stay unchanged outside this synchronous draw window.
  * Any changed/detached/dynamic/partly-hidden bucket uses original meshes.
  * With `revision` (PERF-BATCH), sources are validated only when it differs from the last validated one: the caller
  * promises to change it before anything under its roots moves, hides, shows, is added or removed. */
 withRender<T>(draw:()=>T,revision?:number):T{
  if(this.disposed||!this.batches.length)return draw();if(this.rendering)throw Error('static-batches.nested-render');this.rendering=true;const start=performance.now(),hidden:THREE.Object3D[]=[];this.used=this.fallback=this.callsSaved=this.wholeRootsHidden=0;
  try{
   const validate=revision===undefined||revision!==this.validatedRevision;this.validatedLastRender=validate;
   if(validate){const cache=validationWindow();for(const root of this.roots)root.updateWorldMatrix(true,true);for(const batch of this.batches)batch.okay=batch.sources.every(s=>unchanged(s,this.scene,cache,batch.mesh.material as THREE.Material,this.shaderMerge));this.validatedRevision=revision??null;}
   const whole=new Set<THREE.Object3D>();for(const [root,info] of this.rootInfo)if(info.whole&&info.batches.every(b=>b.okay))whole.add(root);
   for(const batch of this.batches){batch.mesh.visible=batch.okay;if(!batch.okay){this.fallback++;continue;}this.used++;this.callsSaved+=batch.sources.length-1;for(const s of batch.sources){if(whole.has(s.root))continue;s.mesh.visible=false;hidden.push(s.mesh);}}
   for(const root of whole){root.visible=false;hidden.push(root);}this.wholeRootsHidden=whole.size;
   this.group.visible=this.used>0;this.validationCpuMs=performance.now()-start;return draw();}
  finally{const restoreStart=performance.now();for(const o of hidden)o.visible=true;this.group.visible=false;this.rendering=false;this.restoreCpuMs=performance.now()-restoreStart;}
 }
 inspection(){return{generation:this.generation,batches:this.batches.length,batchedMeshes:this.batches.reduce((n,b)=>n+b.sources.length,0),callsSavedLastRender:this.callsSaved,mergedBytes:this.batches.reduce((n,b)=>n+b.bytes,0),usedLastRender:this.used,fallbackLastRender:this.fallback,roots:this.roots.length,sourceNodes:this.sourceNodes,sourceMeshes:this.sourceMeshes,budgetSkippedMeshes:this.budgetSkippedMeshes,budgetSkippedBatches:this.budgetSkippedBatches,workingGeometryPeakBytes:this.workingGeometryPeakBytes,prepareCpuMs:this.prepareCpuMs,validationCpuMs:this.validationCpuMs,restoreCpuMs:this.restoreCpuMs,preparationError:this.preparationError,validatedLastRender:this.validatedLastRender,reusedBatches:this.reusedBatches,sourceMaterials:this.sourceMaterials,batchMaterials:new Set(this.batches.map(b=>b.mesh.material)).size,wholeRootsHidden:this.wholeRootsHidden};}
 dispose(){if(this.rendering)throw Error('static-batches.dispose-during-render');if(this.disposed)return;this.disposed=true;this.clear();for(const m of this.sharedMaterials.values())m.dispose();this.sharedMaterials.clear();this.group.removeFromParent();}
}
