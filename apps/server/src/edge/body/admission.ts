// BODY-v1: dependency-free GLB admission. Pure; stores nothing before validation succeeds.
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {bodyMotionProblem,type BodyMotion} from '../../../../../mars/viewer/engine/bodies/motion.ts';
import {QUADRUPED_TORSO,isActionProfile,type ActionProfile} from '../../../../../mars/viewer/engine/bodies/action-profile.ts';
/** quadruped-torso/1 support: the lower body stays inside the humanoid navigation disc (world/catalog.ts HUMAN_RADIUS). */
export const QUADRUPED_FOOTPRINT_RADIUS=.28;
/** quadruped-torso/1: the most distinct key times a standing clip (Idle, Standby_Loop, Dance_Loop) may have; each is measured. */
export const QUADRUPED_FOOTPRINT_KEYS=64;
/** quadruped-torso/1: the most vertex poses (skinned vertices × measured key times) the footprint check performs. */
export const QUADRUPED_FOOTPRINT_WORK=1_000_000;
import {rigWorldPoints,rigWorldMatrices} from './rig.ts';
export type BodyType='humanoid'|'ceramic'|'floater';
export type BodyManifest={type:BodyType;license:'CC0'|'owned';rightsConfirmed:true;rig?:'quaternius/1';name?:string;description?:string;motion?:BodyMotion;actionProfile?:ActionProfile};
export const BODY_LIMITS={bytes:4*1024*1024,triangles:10000,images:2,imageBytes:1024*1024,imageDimension:1024,nodes:512,accessors:1024,rigidDrawCalls:4,humanoidDrawCalls:16} as const;
export class BodyAdmissionError extends Error {readonly code:string;readonly details?:{field:string;measured:number;limit:number};constructor(code:string,message:string,details?:{field:string;measured:number;limit:number}){super(message);this.code=code;this.details=details;}}
const no=(code:string,message:string,details?:{field:string;measured:number;limit:number}):never=>{throw new BodyAdmissionError(code,message,details);};
const list=(x:unknown,k:string):any[]=>x===undefined?[]:Array.isArray(x)?x:no('body.invalid',`${k} must be an array`);
const nat=(n:unknown,k:string)=>Number.isSafeInteger(n)&&Number(n)>=0?Number(n):no('body.invalid',`${k} must be a nonnegative integer`);
const ref=(items:any[],i:unknown,k:string)=>{const n=nat(i,k);return items[n]??no('body.invalid',`${k} references missing data`);};
function imageDimensions(b:Buffer,mime:string):[number,number]{
 if(mime==='image/png'){
  if(b.length<33||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return no('body.image-invalid','Invalid PNG header');
  let p=8,w=0,h=0,depth=0,channels=0,ended=false,paletteRequired=false,palette=false;const data:Buffer[]=[];
  while(p+12<=b.length){const n=b.readUInt32BE(p),kind=b.toString('ascii',p+4,p+8);if(p+12+n>b.length)return no('body.image-invalid','Truncated PNG chunk');
   let crc=0xffffffff;for(const byte of b.subarray(p+4,p+8+n)){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==b.readUInt32BE(p+8+n))return no('body.image-invalid','Invalid PNG checksum');
   if(p===8){if(kind!=='IHDR'||n!==13)return no('body.image-invalid','Invalid PNG IHDR');w=b.readUInt32BE(p+8);h=b.readUInt32BE(p+12);depth=b[p+16];const color=b[p+17];paletteRequired=color===3;channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color]??0;
    if(!w||!h||w>BODY_LIMITS.imageDimension||h>BODY_LIMITS.imageDimension)return no('body.image-too-large','Texture dimensions exceed 1024×1024');
    if(!channels||![1,2,4,8,16].includes(depth)||(color===3&&depth===16)||([2,4,6].includes(color)&&depth<8)||b[p+18]!==0||b[p+19]!==0||b[p+20]!==0)return no('body.image-format','Unsupported PNG pixel/interlace layout');
   }else if(kind==='IHDR')return no('body.image-invalid','Duplicate PNG header');
   if(kind==='PLTE'){if(!n||n%3||n>768)return no('body.image-invalid','Invalid PNG palette');palette=true;}
   if(kind==='IDAT')data.push(b.subarray(p+8,p+8+n));p+=n+12;
   if(kind==='IEND'){if(n!==0||p!==b.length)return no('body.image-invalid','Invalid PNG ending');ended=true;break;}
  }
  if(!ended||!data.length||(paletteRequired&&!palette))return no('body.image-invalid','Incomplete PNG');const stride=Math.ceil(w*channels*depth/8)+1,expected=h*stride;let pixels:Buffer;
  try{pixels=inflateSync(Buffer.concat(data),{maxOutputLength:expected});}catch{return no('body.image-invalid','Invalid or excessive PNG pixel data');}
  if(pixels.length!==expected)return no('body.image-invalid','PNG pixel count does not match dimensions');for(let row=0;row<h;row++)if(pixels[row*stride]>4)return no('body.image-invalid','Invalid PNG row filter');return[w,h];
 }
 if(mime==='image/jpeg'){
  if(b.length<4||b[0]!==255||b[1]!==216)return no('body.image-invalid','Invalid JPEG header');
  let p=2,w=0,h=0,scan=false,scans=0,entropy=0,quant=false,huffman=false;const ids=new Set<number>();
  while(p<b.length){let marker:number;
   if(scan){while(p<b.length&&b[p]!==255){p++;entropy++;}if(p===b.length)break;p++;while(b[p]===255)p++;marker=b[p++];if(marker===0){entropy++;continue;}if(marker>=208&&marker<=215)continue;scan=false;}
   else{if(b[p++]!==255)return no('body.image-invalid','Invalid JPEG marker');while(b[p]===255)p++;marker=b[p++];}
   if(marker===217){if(p!==b.length||!w||!scans||!entropy||!quant||!huffman)return no('body.image-invalid','Incomplete JPEG image');return[w,h];}
   if(marker===216||marker===0||marker===undefined||p+2>b.length)return no('body.image-invalid','Invalid JPEG marker');
   const n=b.readUInt16BE(p);if(n<2||p+n>b.length)return no('body.image-invalid','Invalid JPEG segment');
   if([192,193,194].includes(marker)){if(w||n<11||b[p+2]!==8)return no('body.image-format','Unsupported JPEG frame');h=b.readUInt16BE(p+3);w=b.readUInt16BE(p+5);const count=b[p+7];if(![1,3,4].includes(count)||n!==8+count*3)return no('body.image-invalid','Invalid JPEG components');for(let j=0;j<count;j++)ids.add(b[p+8+j*3]);if(ids.size!==count)return no('body.image-invalid','Duplicate JPEG component');}
   else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))return no('body.image-format','Unsupported JPEG frame encoding');
   if(marker===219){let q=p+2;while(q<p+n){const precision=b[q++]>>>4;if(precision>1||q+64*(precision+1)>p+n)return no('body.image-invalid','Invalid JPEG quantization table');q+=64*(precision+1);}quant=true;}
   if(marker===196){let q=p+2;while(q<p+n){q++;if(q+16>p+n)return no('body.image-invalid','Invalid JPEG Huffman table');let count=0;for(let j=0;j<16;j++)count+=b[q++];if(q+count>p+n)return no('body.image-invalid','Truncated JPEG Huffman table');q+=count;}huffman=true;}
   if(marker===218){const count=b[p+2];if(!w||!count||count>ids.size||n!==6+2*count)return no('body.image-invalid','Invalid JPEG scan');for(let j=0;j<count;j++)if(!ids.has(b[p+3+j*2]))return no('body.image-invalid','Unknown JPEG scan component');scan=true;scans++;}
   p+=n;
  }
  return no('body.image-invalid','Incomplete JPEG image');
 }
 return no('body.image-format','Only embedded PNG and JPEG textures are supported');
}
/** Bind authored adapters into admitted bytes, preserving the existing byte-addressed store and moderation keys.
 * The local validator performs the identical, idempotent metadata transform. Geometry and source files are untouched. */
export function bindBodyDefinition(bytes:Buffer,raw:unknown):Buffer {
 const m=raw as BodyManifest|undefined;if(!m?.motion&&!m?.actionProfile)return bytes;
 const problem=m.motion?bodyMotionProblem(m.motion):null;if(problem)return no('body.motion',problem);
 if(bytes.length>BODY_LIMITS.bytes)return no('body.too-large','Body GLB exceeds 4 MiB');
 if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)return bytes;
 const n=bytes.readUInt32LE(12);if(n%4||20+n>bytes.length)return bytes;
 let j:any;try{j=JSON.parse(bytes.toString('utf8',20,20+n).trim());}catch{return bytes;}
 if(!j.asset||typeof j.asset!=='object'||Array.isArray(j.asset))return bytes;
 const fingerprint='body-definition/1 '+createHash('sha256').update(JSON.stringify({type:m.type,motion:m.motion,actionProfile:m.actionProfile,name:m.name,description:m.description})).digest('hex');
 if(j.asset.generator===fingerprint)return bytes;
 j.asset.generator=fingerprint;const json=Buffer.from(JSON.stringify(j)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
 const head=Buffer.from(bytes.subarray(0,20)),result=Buffer.concat([head,padded,bytes.subarray(20+n)]);result.writeUInt32LE(result.length,8);result.writeUInt32LE(padded.length,12);return result;
}
export function admitBodyGLB(bytes:Buffer,raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return no('body.manifest','Manifest is required');
 const m=raw as Record<string,unknown>;if(!['humanoid','ceramic','floater'].includes(String(m.type)))return no('body.type','Unknown body type');
 if(m.rightsConfirmed!==true||!['CC0','owned'].includes(String(m.license)))return no('body.rights','Confirm CC0 or ownership rights before uploading');
 for(const key of Object.keys(m))if(!['type','license','rightsConfirmed','rig','name','description','motion','actionProfile'].includes(key))return no('body.manifest',`Unknown manifest field ${key}`);
 for(const [key,max]of [['name',80],['description',240]] as const)if(m[key]!==undefined&&(typeof m[key]!=='string'||m[key].length<1||m[key].length>max))return no('body.manifest',`${key} must be 1–${max} characters`);
 if(m.motion!==undefined){if(m.type==='humanoid')return no('body.motion','Authored rigid motion requires ceramic or floater type');const p=bodyMotionProblem(m.motion);if(p)return no('body.motion',p);}
 if(m.actionProfile!==undefined&&(!isActionProfile(m.actionProfile)||m.type!=='humanoid'))return no('body.action-profile','Use rolling-gripper/1 or quadruped-torso/1 only with the canonical contact rig');
 const manifest=m as BodyManifest;
 bytes=bindBodyDefinition(bytes,manifest);
 if(bytes.length>BODY_LIMITS.bytes)return no('body.too-large','Body GLB exceeds 4 MiB');
 if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)return no('body.invalid','Expected a complete GLB 2.0 file');
 let json:any,bin:Buffer|undefined,p=12;
 while(p<bytes.length){if(p+8>bytes.length)return no('body.invalid','Truncated GLB chunk');const n=bytes.readUInt32LE(p),kind=bytes.readUInt32LE(p+4);p+=8;if(n%4||p+n>bytes.length)return no('body.invalid','Invalid GLB chunk length');if(kind===0x4e4f534a){if(json||p!==20)return no('body.invalid','Exactly one first JSON chunk is required');try{json=JSON.parse(bytes.toString('utf8',p,p+n).trim());}catch{return no('body.invalid','Invalid glTF JSON');}}else if(kind===0x004e4942){if(bin)return no('body.invalid','Duplicate binary chunk');bin=bytes.subarray(p,p+n);}else return no('body.extension','Unsupported GLB chunk');p+=n;}
 if(!json||json.asset?.version!=='2.0')return no('body.invalid','glTF asset.version must be 2.0');
 const pending=[json];let fields=0;while(pending.length){const x=pending.pop();if(typeof x==='number'&&!Number.isFinite(x))return no('body.invalid','Nonfinite glTF metadata');if(!x||typeof x!=='object')continue;if(++fields>50000)return no('body.too-complex','Too much glTF metadata');if(Array.isArray(x)){if(x.length>50000)return no('body.too-complex','Metadata array is too large');for(const v of x)pending.push(v);continue;}if(x.uri!==undefined)return no('body.external-resource','GLB must embed buffers and images; all URIs are refused');if(x.extensions&&Object.keys(x.extensions).some(k=>!['KHR_materials_unlit','KHR_texture_transform'].includes(k)))return no('body.extension','Unsupported glTF extension');for(const [k,v]of Object.entries(x))if(k!=='extras')pending.push(v);}
 if(list(json.extensionsUsed,'extensionsUsed').some(x=>!['KHR_materials_unlit','KHR_texture_transform'].includes(x)))return no('body.extension','Unsupported declared extension');
 if(list(json.extensionsRequired,'extensionsRequired').some(x=>!['KHR_materials_unlit','KHR_texture_transform'].includes(x)))return no('body.extension','Unsupported required extension');
 const buffers=list(json.buffers,'buffers');if(buffers.length!==1||!bin||nat(buffers[0].byteLength,'buffer.byteLength')>bin.length||bin.length-buffers[0].byteLength>3)return no('body.invalid','Exactly one embedded binary buffer is required');
 const views=list(json.bufferViews,'bufferViews'),accessors=list(json.accessors,'accessors');if(accessors.length>BODY_LIMITS.accessors)return no('body.too-complex','Too many accessors');
 for(const v of views){if(v.buffer!==0)return no('body.invalid','Buffer view must reference the embedded buffer');const start=nat(v.byteOffset??0,'bufferView.byteOffset'),n=nat(v.byteLength,'bufferView.byteLength');if(start+n>buffers[0].byteLength)return no('body.invalid','Buffer view exceeds binary data');if(v.byteStride!==undefined&&(nat(v.byteStride,'byteStride')<4||v.byteStride>252||v.byteStride%4))return no('body.invalid','Invalid accessor stride');}
 if(views.length>2048)return no('body.too-complex','Too many buffer views');
 const width:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},components:Record<number,number>={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
 let decodedValues=0;for(const a of accessors){if(a.count===0)return no('body.invalid','Empty accessors are unsupported');if(a.sparse)return no('body.extension','Sparse accessors are unsupported');const n=nat(a.count,'accessor.count'),size=components[a.componentType]*width[a.type];if(!Number.isFinite(size)||(['MAT2','MAT3'].includes(a.type)&&components[a.componentType]<4))return no('body.invalid','Invalid or unsupported accessor type');decodedValues+=n*width[a.type];if(decodedValues>4000000)return no('body.too-complex','Total decoded accessor data exceeds the budget');const v=ref(views,a.bufferView,'accessor.bufferView'),offset=nat(a.byteOffset??0,'accessor.byteOffset'),stride=v.byteStride??size;if(stride<size||offset+(n?stride*(n-1)+size:0)>v.byteLength)return no('body.invalid','Accessor exceeds its buffer view');if((offset+(v.byteOffset??0))%components[a.componentType])return no('body.invalid','Misaligned accessor');}
 let triangles=0,drawCalls=0;const meshes=list(json.meshes,'meshes');if(!meshes.length)return no('body.empty','Body must contain a visible mesh');
 for(const mesh of meshes)for(const p of list(mesh.primitives,'mesh.primitives')){drawCalls++;if((p.mode??4)!==4)return no('body.mesh-mode','Only triangle meshes are supported');const pos=ref(accessors,p.attributes?.POSITION,'POSITION');if(pos.type!=='VEC3'||pos.componentType!==5126||pos.count<3)return no('body.invalid','Mesh positions must be floating point VEC3');const indices=p.indices===undefined?null:ref(accessors,p.indices,'indices');if(indices&&(indices.type!=='SCALAR'||![5121,5123,5125].includes(indices.componentType)))return no('body.invalid','Invalid triangle indices');const n=indices?.count??pos.count;if(n%3)return no('body.invalid','Incomplete triangle');triangles+=n/3;if(triangles>BODY_LIMITS.triangles)return no('body.too-complex','Body exceeds 10,000 triangles',{field:'triangles',measured:triangles,limit:BODY_LIMITS.triangles});if(p.targets)return no('body.extension','Morph targets are unsupported');}
 const drawLimit=manifest.type==='humanoid'?BODY_LIMITS.humanoidDrawCalls:BODY_LIMITS.rigidDrawCalls;if(drawCalls>drawLimit)return no('body.too-complex','Too many mesh draw calls',{field:'drawCalls',measured:drawCalls,limit:drawLimit});
 const nodes=list(json.nodes,'nodes');if(nodes.length>BODY_LIMITS.nodes)return no('body.too-complex','Too many nodes');const parents=new Map<number,number>();
 for(let i=0;i<nodes.length;i++){const n=nodes[i];if(n.mesh!==undefined)ref(meshes,n.mesh,'node.mesh');for(const j of list(n.children,'node.children')){ref(nodes,j,'child');if(parents.has(j))return no('body.invalid','Node has multiple parents');parents.set(j,i);}}
 for(let i=0;i<nodes.length;i++){const seen=new Set<number>();for(let j:number|undefined=i;j!==undefined;j=parents.get(j)){if(seen.has(j))return no('body.invalid','Cyclic node graph');seen.add(j);}}
 for(const scene of list(json.scenes,'scenes'))for(const j of list(scene.nodes,'scene.nodes'))ref(nodes,j,'scene root');
 const images=list(json.images,'images');if(images.length>BODY_LIMITS.images)return no('body.too-complex','Too many textures');
 for(const image of images){const v=ref(views,image.bufferView,'image.bufferView');if(v.byteLength>BODY_LIMITS.imageBytes)return no('body.image-too-large','Texture exceeds 1 MiB');const start=v.byteOffset??0,[w,h]=imageDimensions(bin.subarray(start,start+v.byteLength),image.mimeType);if(!w||!h||w>BODY_LIMITS.imageDimension||h>BODY_LIMITS.imageDimension)return no('body.image-too-large','Texture dimensions exceed 1024×1024');}
 let instances=0,instanceTriangles=0;for(const n of nodes)if(n.mesh!==undefined){instances+=meshes[n.mesh].primitives.length;for(const p of meshes[n.mesh].primitives)instanceTriangles+=(p.indices===undefined?accessors[p.attributes.POSITION].count:accessors[p.indices].count)/3;}if(instanceTriangles>BODY_LIMITS.triangles)return no('body.too-complex','Instantiated body exceeds the triangle budget',{field:'triangles',measured:instanceTriangles,limit:BODY_LIMITS.triangles});if(instances>drawLimit)return no('body.too-complex','Too many instantiated mesh draw calls',{field:'drawCalls',measured:instances,limit:drawLimit});
 // Decode every accessor used by geometry/rig/clips. Bounds alone cannot stop NaNs or
 // out-of-range indices from reaching the renderer. Small fixed-size arrays stay capped by the GLB byte limit.
 const values=(a:any):number[]=>{const v=ref(views,a.bufferView,'accessor.bufferView'),n=nat(a.count,'accessor.count'),c=width[a.type],size=components[a.componentType],stride=v.byteStride??c*size,base=(v.byteOffset??0)+(a.byteOffset??0),out:number[]=[];
  const read:Record<number,(p:number)=>number>={5120:p=>bin!.readInt8(p),5121:p=>bin!.readUInt8(p),5122:p=>bin!.readInt16LE(p),5123:p=>bin!.readUInt16LE(p),5125:p=>bin!.readUInt32LE(p),5126:p=>bin!.readFloatLE(p)};
  for(let i=0;i<n;i++)for(let j=0;j<c;j++){const value=read[a.componentType](base+i*stride+j*size);if(!Number.isFinite(value))return no('body.invalid','Nonfinite accessor data');out.push(value);}return out;};
 for(const a of accessors){if(a.count>2000000)return no('body.too-complex','Accessor count is too large');values(a);}
 for(const mesh of meshes){if(!list(mesh.primitives,'mesh.primitives').length)return no('body.empty','Mesh has no primitives');for(const p of mesh.primitives){const pos=ref(accessors,p.attributes.POSITION,'POSITION');if(p.indices!==undefined&&values(ref(accessors,p.indices,'indices')).some(n=>n>=pos.count))return no('body.invalid','Mesh index exceeds vertex count');for(const i of Object.values(p.attributes)){const a=ref(accessors,i,'mesh attribute');if(a.count!==pos.count)return no('body.invalid','Vertex attributes must have matching counts');}if(p.material!==undefined)ref(list(json.materials,'materials'),p.material,'primitive.material');}}
 for(const n of nodes){if(n.skin!==undefined)ref(list(json.skins,'skins'),n.skin,'node.skin');for(const [k,length]of [['translation',3],['scale',3],['rotation',4],['matrix',16]] as const){if(n[k]!==undefined&&(!Array.isArray(n[k])||n[k].length!==length||n[k].some((v:unknown)=>typeof v!=='number'||!Number.isFinite(v))))return no('body.invalid','Invalid node transform');}if(n.matrix!==undefined&&['translation','scale','rotation'].some(k=>n[k]!==undefined))return no('body.invalid','Node matrix cannot be combined with TRS');}
 const textures=list(json.textures,'textures'),samplers=list(json.samplers,'samplers');for(const t of textures){ref(images,t.source,'texture.source');if(t.sampler!==undefined)ref(samplers,t.sampler,'texture.sampler');}
 const scanTextures=(x:any):void=>{if(!x||typeof x!=='object')return;if(x.index!==undefined&&('texCoord' in x||'scale' in x||'strength' in x))ref(textures,x.index,'texture.index');for(const [k,v]of Object.entries(x))if(/Texture$/.test(k)&&v&&typeof v==='object')ref(textures,(v as any).index,k);};for(const m of list(json.materials,'materials')){scanTextures(m);scanTextures(m.pbrMetallicRoughness);}
 const skins=list(json.skins,'skins'),animations=list(json.animations,'animations');if(skins.length>8||animations.length>64)return no('body.too-complex','Too many skins or clips');
 const scenes=list(json.scenes,'scenes');if(!scenes.length)return no('body.empty','A visible default scene is required');const active=ref(scenes,json.scene??0,'scene');const seen=new Set<number>(),todo=[...list(active.nodes,'scene.nodes')];while(todo.length){const i=todo.pop()!;if(seen.has(i))continue;seen.add(i);const n=ref(nodes,i,'scene.node');todo.push(...list(n.children,'node.children'));}if(![...seen].some(i=>nodes[i].mesh!==undefined))return no('body.empty','Default scene must contain a visible mesh');
 // The renderer normalizes the visible bind mesh. Bound transformed vertices,
 // including finite-but-enormous matrices, before that normalization can overflow.
 const matrix=rigWorldMatrices(nodes,parents),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 for(const i of seen){const node=nodes[i];if(node.mesh===undefined)continue;const m=matrix(i);if(m.some(v=>!Number.isFinite(v)))return no('body.mesh-bounds','Nonfinite visible mesh transform');for(const primitive of meshes[node.mesh].primitives){const vertices=values(accessors[primitive.attributes.POSITION]);for(let k=0;k<vertices.length;k+=3)for(let axis=0;axis<3;axis++){const v=m[axis]*vertices[k]+m[4+axis]*vertices[k+1]+m[8+axis]*vertices[k+2]+m[12+axis];if(!Number.isFinite(v)||Math.abs(v)>1e12)return no('body.mesh-bounds','Visible mesh transform exceeds the finite normalization budget');low[axis]=Math.min(low[axis],v);high[axis]=Math.max(high[axis],v);}}}
 const extent=high.map((v,i)=>v-low[i]);if(extent.some(v=>!Number.isFinite(v)||v>1e12)||extent[1]<=1e-9)return no('body.mesh-bounds','Visible mesh requires finite nonzero standing height');
 if(manifest.type==='humanoid'){
  if(manifest.rig!=='quaternius/1'||!skins.length)return no('body.rig','Humanoids require the canonical quaternius/1 rig');
  const normalize=(name:unknown)=>String(name??'').replace(/[\[\].:\/]/g,'');
  const canonical=['Root','Body','Hips','Abdomen','Torso','Chest','Neck','Head',...['L','R'].flatMap(side=>['Shoulder','UpperArm','LowerArm','Wrist','Middle1','Middle2','UpperLeg','LowerLeg','Foot'].map(n=>n+side))];
  const named=new Map<string,number>();for(let i=0;i<nodes.length;i++){const name=normalize(nodes[i].name);if(canonical.includes(name)){if(named.has(name))return no('body.rig',`Duplicate canonical bone ${name}`);named.set(name,i);}}
  for(const name of canonical)if(!named.has(name))return no('body.rig',`Missing canonical bone ${name}`);
  const parentNames:Record<string,string>={Body:'Root',Hips:'Body',Abdomen:'Hips',Torso:'Abdomen',Chest:'Torso',Neck:'Chest',Head:'Neck'};
  for(const side of ['L','R'])Object.assign(parentNames,{['Shoulder'+side]:'Chest',['UpperArm'+side]:'Shoulder'+side,['LowerArm'+side]:'UpperArm'+side,['Wrist'+side]:'LowerArm'+side,['Middle1'+side]:'Wrist'+side,['Middle2'+side]:'Middle1'+side,['UpperLeg'+side]:'Body',['LowerLeg'+side]:'UpperLeg'+side,['Foot'+side]:'Root'});
  for(const side of ['L','R'])if(parents.get(named.get('Foot'+side)!)!==named.get('Root'))return no('body.rig','Canonical feet must be direct Root children');
  for(const [child,parent]of Object.entries(parentNames)){let i=parents.get(named.get(child)!);const want=named.get(parent);while(i!==undefined&&i!==want)i=parents.get(i);if(i!==want)return no('body.rig',`Canonical ${child} must descend from ${parent}`);}
  const point=rigWorldPoints(nodes,parents),at=(name:string)=>point(named.get(name)!),span=(a:string,b:string)=>{const p=at(a),q=at(b);return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);};
  if(at('Head')[1]-(at('FootL')[1]+at('FootR')[1])/2<=1e-6||span('UpperArmL','UpperArmR')<=1e-6)return no('body.rig','Canonical humanoid must stand upright on +Y with nonzero shoulders');
  for(const side of ['L','R'])for(const [a,b]of [['UpperArm','LowerArm'],['LowerArm','Wrist'],['Wrist','Middle2'],['UpperLeg','LowerLeg'],['LowerLeg','Foot']])if(span(a+side,b+side)<=1e-6)return no('body.rig','Canonical limb chain has zero reach');
  // Match the renderer's fixed shoulder height and permanent arm fit in the bind
  // pose. The renderer repeats this guard after sampling Idle before displaying it.
  const shoulder=(at('UpperArmL')[1]+at('UpperArmR')[1])/2-low[1];if(shoulder*1.75/extent[1]<=1e-5)return no('body.rig','Canonical shoulder height must be positive');const scale=1.34/shoulder;
  for(const side of ['L','R']){const elbow=at('LowerArm'+side),wrist=at('Wrist'+side),finger=at('Middle2'+side),a=span('UpperArm'+side,'LowerArm'+side)*scale,fw=wrist.map((v,i)=>(v-elbow[i])*scale),palm=finger.map((v,i)=>(v-wrist[i])*scale/2);
   if(a<=1e-5||Math.hypot(...fw)<=1e-5||Math.hypot(...palm)<=1e-5)return no('body.rig','Canonical arm segments are too small after fitting');const length=(k:number)=>k*a+Math.hypot(...fw.map((v,i)=>k*v+palm[i]));if(length(.5)>.62||length(3)<.62)return no('body.rig','Canonical arm cannot fit the fixed 0.62 m reach');
  }
  const joints=new Set<number>();for(const skin of skins){const sj=list(skin.joints,'skin.joints');if(!sj.length||new Set(sj).size!==sj.length)return no('body.rig','Skin requires distinct joints');for(const j of sj){ref(nodes,j,'skin joint');joints.add(j);}if(skin.skeleton!==undefined)ref(nodes,skin.skeleton,'skin.skeleton');if(skin.inverseBindMatrices!==undefined){const a=ref(accessors,skin.inverseBindMatrices,'inverseBindMatrices');if(a.type!=='MAT4'||a.componentType!==5126||a.count!==sj.length)return no('body.rig','Invalid inverse bind matrices');}}
  for(const n of canonical)if(!joints.has(named.get(n)!))return no('body.rig',`Canonical bone ${n} is not a skin joint`);
  for(const node of nodes)if(node.mesh!==undefined&&node.skin!==undefined){const skin=skins[node.skin];for(const name of canonical)if(!skin.joints.includes(named.get(name)))return no('body.rig',`Used skin is missing canonical bone ${name}`);for(const p of meshes[node.mesh].primitives){const ja=ref(accessors,p.attributes.JOINTS_0,'JOINTS_0'),wa=ref(accessors,p.attributes.WEIGHTS_0,'WEIGHTS_0');if(ja.type!=='VEC4'||ja.normalized===true||![5121,5123].includes(ja.componentType)||wa.type!=='VEC4'||![5121,5123,5126].includes(wa.componentType)||(wa.componentType!==5126&&wa.normalized!==true)||values(ja).some(i=>i>=skin.joints.length))return no('body.rig','Invalid skin joint or weight attributes');const weights=values(wa),unit=wa.componentType===5121?255:wa.componentType===5123?65535:1;for(let i=0;i<weights.length;i+=4){const group=weights.slice(i,i+4).map(v=>v/unit);if(group.some(v=>v<0||v>1.0001)||Math.abs(group.reduce((a,b)=>a+b,0)-1)>.02)return no('body.rig','Skin weights must be normalized per vertex');}}}
  if(!nodes.some(n=>n.mesh!==undefined&&n.skin!==undefined))return no('body.rig','Humanoid mesh must use its admitted skin');
  for(const name of manifest.actionProfile?['Idle','Walk','Dance_Loop','Standby_Loop']:['Idle','Walk'])if(!animations.some(a=>a.name===name))return no('body.clips',`Missing ${name} clip`);
  for(const anim of animations){const channels=list(anim.channels,'animation.channels'),as=list(anim.samplers,'animation.samplers');if(!channels.length||!as.length)return no('body.clips','Animation requires channels and samplers');let positive=false;
   for(const channel of channels){const node=ref(nodes,channel.target?.node,'animation.target.node');void node;if(!['translation','rotation','scale'].includes(channel.target?.path))return no('body.clips','Unsupported animation target');const sampler=ref(as,channel.sampler,'animation.sampler');if(sampler.interpolation!==undefined&&!['LINEAR','STEP'].includes(sampler.interpolation))return no('body.clips','Only LINEAR/STEP clips are supported');const input=ref(accessors,sampler.input,'animation.input'),output=ref(accessors,sampler.output,'animation.output');if(input.type!=='SCALAR'||input.componentType!==5126||!input.count||output.componentType!==5126||output.count!==input.count||output.type!==(channel.target.path==='rotation'?'VEC4':'VEC3'))return no('body.clips','Invalid clip accessor');const times=values(input);if(times.some((v,i)=>v<0||(i>0&&v<=times[i-1])))return no('body.clips','Clip key times must increase and be nonnegative');positive ||= times[times.length-1]>0;}
   if(!positive)return no('body.clips','Clip must have positive finite duration');
   if(anim.name==='Walk')for(const side of ['L','R']){const c=channels.find(c=>c.target.node===named.get('Foot'+side)&&c.target.path==='translation');if(!c)return no('body.clips','Walk requires baked translation for both canonical feet');const v=values(accessors[as[c.sampler].output]);let low=Infinity,high=-Infinity;for(let i=2;i<v.length;i+=3){low=Math.min(low,v[i]);high=Math.max(high,v[i]);}if(high-low<=1e-6)return no('body.clips','Walk requires finite forward stride along Z');}
  }
  // Honest support for four legs: the renderer stands the body in its Idle pose (people.ts fit: Idle at 0.01 s, centred on
  // that pose's x/z box, scaled to the canonical shoulder height). In that pose, and in the standing Standby_Loop and
  // Dance_Loop it rests and dances in, every skinned vertex below the hips stays inside the disc the world navigates and
  // collides with. A longer body would hide legs outside the admitted clearance. The gait's stride is not bounded here.
  if(manifest.actionProfile===QUADRUPED_TORSO){
   const posed=(name:string,time:number)=>{const clip=animations.find((a:any)=>a.name===name);const animated=nodes.map((n:any)=>({...n}));
    if(clip)for(const ch of clip.channels){const smp=clip.samplers[ch.sampler],ts=values(accessors[smp.input]),w=ch.target.path==='rotation'?4:3,vs=values(accessors[smp.output]);let k=0;while(k<ts.length-2&&ts[k+1]<time)k++;
     const f=ts.length<2||smp.interpolation==='STEP'?0:Math.max(0,Math.min(1,(time-ts[k])/(ts[k+1]-ts[k]||1))),a=vs.slice(k*w,k*w+w),b=vs.slice(Math.min(k+1,ts.length-1)*w,Math.min(k+1,ts.length-1)*w+w);
     let v=a.map((x:number,j:number)=>x+((b[j]??x)-x)*f);if(w===4){const d=a.reduce((s:number,x:number,j:number)=>s+x*b[j],0);if(d<0)v=a.map((x:number,j:number)=>x+(-b[j]-x)*f);const n=Math.hypot(...v)||1;v=v.map((x:number)=>x/n);}
     animated[ch.target.node][ch.target.path]=v;delete animated[ch.target.node].matrix;}
    const world=rigWorldMatrices(animated,parents),out:number[][]=[];
    // Arms are not lower body (the renderer refits them to the fixed reach): a vertex led by an arm joint is not measured.
    const arm=new Set<number>();for(const side of ['L','R']){const top=named.get('Shoulder'+side)!;for(let j=0;j<nodes.length;j++)for(let k:number|undefined=j;k!==undefined;k=parents.get(k))if(k===top){arm.add(j);break;}}
    const ident=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    for(const i of seen){const node=nodes[i];if(node.mesh===undefined)continue;
     if(node.skin===undefined){const m=world(i);for(const p of meshes[node.mesh].primitives){const pos=values(accessors[p.attributes.POSITION]);for(let k=0;k<pos.length;k+=3)out.push([0,1,2].map(ax=>m[ax]*pos[k]+m[4+ax]*pos[k+1]+m[8+ax]*pos[k+2]+m[12+ax]).concat(0));}continue;}
     const skin=skins[node.skin],joints=skin.joints as number[],inv=skin.inverseBindMatrices===undefined?null:values(accessors[skin.inverseBindMatrices]);   // absent: identity (glTF)
     const skinning=joints.map((j,q)=>{const m=world(j),b=inv?inv.slice(q*16,q*16+16):ident;return Array.from({length:16},(_,e)=>{const row=e%4,col=Math.floor(e/4);let s=0;for(let r=0;r<4;r++)s+=m[r*4+row]*b[col*4+r];return s;});});
     for(const p of meshes[node.mesh].primitives){const pos=values(accessors[p.attributes.POSITION]),js=values(accessors[p.attributes.JOINTS_0]),wa=accessors[p.attributes.WEIGHTS_0],unit=wa.componentType===5121?255:wa.componentType===5123?65535:1,ws=values(wa).map((w:number)=>w/unit);
      for(let k=0;k<pos.length/3;k++){const r=[0,0,0];let armOnly=1;for(let q=0;q<4;q++){const wt=ws[k*4+q];if(!wt)continue;if(!arm.has(joints[js[k*4+q]]))armOnly=0;const m=skinning[js[k*4+q]];for(let ax=0;ax<3;ax++)r[ax]+=wt*(m[ax]*pos[k*3]+m[4+ax]*pos[k*3+1]+m[8+ax]*pos[k*3+2]+m[12+ax]);}out.push([...r,armOnly]);}}}
    return {out,hip:world(named.get('Hips')!)[13],shoulder:(world(named.get('UpperArmL')!)[13]+world(named.get('UpperArmR')!)[13])/2};};
   const idle=posed('Idle',.01);if(!idle.out.length)return no('body.footprint','A quadruped-torso/1 body needs a skinned mesh');
   const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const v of idle.out)for(let a=0;a<3;a++){if(v[a]<lo[a])lo[a]=v[a];if(v[a]>hi[a])hi[a]=v[a];}   // a loop: vertex count is not bounded by the triangle cap
   const cx=(lo[0]+hi[0])/2,cz=(lo[2]+hi[2])/2,fit=1.34/(idle.shoulder-lo[1]);
   if(!(fit>0&&Number.isFinite(fit)))return no('body.footprint','The Idle pose needs shoulders above its lowest point');
   // Throughout each standing clip: every key time of its samplers. A standing clip with more distinct key times than
   // QUADRUPED_FOOTPRINT_KEYS is refused by name rather than sampled (an unsampled key could hide a kick).
   const keyTimes=(name:string)=>{const clip=animations.find((a:any)=>a.name===name);if(!clip)return [0];const ts=new Set<number>();for(const smp of clip.samplers)for(const t of values(accessors[smp.input]))ts.add(t);
    if(ts.size>QUADRUPED_FOOTPRINT_KEYS)return no('body.too-complex',`${name} has ${ts.size} distinct key times; quadruped-torso/1 measures standing clips with at most ${QUADRUPED_FOOTPRINT_KEYS}`,{field:'footprintKeys',measured:ts.size,limit:QUADRUPED_FOOTPRINT_KEYS});
    return [...ts].sort((a,b)=>a-b);};
   // Bounded work: skinned vertices × measured poses. Admission is synchronous, so a body whose footprint would take more
   // than QUADRUPED_FOOTPRINT_WORK vertex skinnings to measure is refused by name instead of stalling the world.
   const plan=(['Idle','Standby_Loop','Dance_Loop'] as const).map(name=>[name,keyTimes(name)] as const),work=idle.out.length*plan.reduce((n,[,ts])=>n+ts.length,0);
   if(work>QUADRUPED_FOOTPRINT_WORK)return no('body.too-complex',`Measuring this body's standing footprint needs ${work} vertex poses; quadruped-torso/1 allows at most ${QUADRUPED_FOOTPRINT_WORK}`,{field:'footprintWork',measured:work,limit:QUADRUPED_FOOTPRINT_WORK});
   let reach=0,where='Idle';for(const [name,times] of plan)for(const t of times){const pose=posed(name,t);for(const v of pose.out)if(v[1]<pose.hip&&!v[3]){const d=Math.hypot(v[0]-cx,v[2]-cz)*fit;if(d>reach){reach=d;where=`${name} at ${Math.round(t*100)/100} s`;}}}
   if(reach>QUADRUPED_FOOTPRINT_RADIUS)return no('body.footprint',`In ${where} the lower body reaches ${reach.toFixed(3)} m from where the body stands; quadruped-torso/1 admits at most ${QUADRUPED_FOOTPRINT_RADIUS} m`,{field:'footprint',measured:Math.round(reach*1000)/1000,limit:QUADRUPED_FOOTPRINT_RADIUS});
  }
 }else if(skins.length||nodes.some(n=>n.skin!==undefined)||animations.length)return no('body.rigid','Ceramic and floater bodies must be rigid, without skins or animation clips');
 return{assetId:'body_'+createHash('sha256').update(bytes).digest('hex'),type:manifest.type,license:manifest.license,bytes:bytes.length,triangles,images:images.length,nodes:nodes.length,rig:manifest.type==='humanoid'?'quaternius/1':null,...(manifest.actionProfile?{actionProfile:manifest.actionProfile}:{}),...(manifest.motion?{motion:structuredClone(manifest.motion)}:{}),...(manifest.name?{name:manifest.name}:{}),...(manifest.description?{description:manifest.description}:{})};
}
