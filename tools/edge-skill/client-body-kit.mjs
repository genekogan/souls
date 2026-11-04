// body kit <dir> (lane #719): one command that prepares a local body-authoring directory from the paired world.
// It copies the world's own contract, skill and dependency-free validator modules (the same files the world serves
// under /body-authoring/) and writes one starter source. It never writes the Soul token or any credential: the kit
// files are public and are fetched without authorization. Upload and selection stay in the paired folder.
import {existsSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const KIT_FILES=['SKILL.md','contract.json','validate.mjs','admission.ts','rig.ts','motion.ts','action-profile.ts','upload-validation.ts','upload.mjs','example.json'];
export const STARTERS=['rigid','humanoid','rolling'];
const USAGE='usage: body kit <dir> [--starter rigid|humanoid|rolling] [--seed N] [--force]';
/** The world's canonical CC0 contact rig (Quaternius), served with the web client's media. */
export const HUMANOID_SOURCE='/modular/environment/animated-casual.glb';

export function parseKitArgs(args){
 const out={dir:undefined,starter:'rigid',seed:1,force:false};
 for(let i=0;i<args.length;i++){const a=args[i];
  if(a==='--force')out.force=true;
  else if(a==='--starter'){out.starter=args[++i];if(!STARTERS.includes(out.starter))throw Error('--starter must be rigid, humanoid or rolling');}
  else if(a==='--seed'){out.seed=Number(args[++i]);if(!Number.isInteger(out.seed)||out.seed<0||out.seed>2**31)throw Error('--seed needs a whole number');}
  else if(a.startsWith('--')||out.dir!==undefined)throw Error(USAGE);
  else out.dir=a;}
 if(!out.dir)throw Error(USAGE);return out;
}

const sha=b=>createHash('sha256').update(b).digest('hex');
function glb(json,bin){
 const j=Buffer.from(JSON.stringify(json)),jp=Buffer.alloc(Math.ceil(j.length/4)*4,32);j.copy(jp);
 const bp=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(bp);
 const head=Buffer.alloc(12);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(12+8+jp.length+8+bp.length,8);
 const ch=(n,k)=>{const c=Buffer.alloc(8);c.writeUInt32LE(n,0);c.writeUInt32LE(k,4);return c;};
 return Buffer.concat([head,ch(jp.length,0x4e4f534a),jp,ch(bp.length,0x004e4942),bp]);
}
function readGLB(bytes){
 if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67)throw Error('Starter source is not a GLB file');
 const n=bytes.readUInt32LE(12),json=JSON.parse(bytes.toString('utf8',20,20+n)),p=20+n,bn=bytes.readUInt32LE(p);
 return {json,bin:bytes.subarray(p+8,p+8+bn)};
}

/** An original faceted sculpture: a seeded, jittered icosphere with per-face palette colours. One draw, 80 triangles. */
export function rigidStarterGLB(seed=1){
 let s=seed>>>0||1;const rnd=()=>{s=(s+0x6d2b79f5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
 const g=(1+Math.sqrt(5))/2,v=[[-1,g,0],[1,g,0],[-1,-g,0],[1,-g,0],[0,-1,g],[0,1,g],[0,-1,-g],[0,1,-g],[g,0,-1],[g,0,1],[-g,0,-1],[-g,0,1]].map(p=>{const l=Math.hypot(...p);return p.map(x=>x/l);});
 let f=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
 const mid=new Map(),m=(a,b)=>{const k=a<b?a+','+b:b+','+a;if(!mid.has(k)){const p=v[a].map((x,i)=>(x+v[b][i])/2),l=Math.hypot(...p);v.push(p.map(x=>x/l));mid.set(k,v.length-1);}return mid.get(k);};
 f=f.flatMap(([a,b,c])=>{const ab=m(a,b),bc=m(b,c),ca=m(c,a);return [[a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]];});
 const r=v.map(()=>.85+.3*rnd()),palette=[[.85,.55,.35],[.35,.6,.75],[.9,.82,.6],[.55,.7,.45]].map(c=>c.map(x=>Math.min(1,x*(.8+.4*rnd()))));
 const pos=[],nrm=[],col=[];
 for(const face of f){const p=face.map(i=>[v[i][0]*.3*r[i],v[i][1]*.36*r[i]+.36,v[i][2]*.3*r[i]]);
  const e1=p[1].map((x,i)=>x-p[0][i]),e2=p[2].map((x,i)=>x-p[0][i]),n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]],l=Math.hypot(...n)||1;
  const c=palette[Math.floor(rnd()*palette.length)];for(const q of p){pos.push(...q);nrm.push(...n.map(x=>x/l));col.push(...c);}}
 const P=new Float32Array(pos),N=new Float32Array(nrm),C=new Float32Array(col),count=P.length/3;
 const lo=[0,1,2].map(a=>Math.min(...pos.filter((_,i)=>i%3===a))),hi=[0,1,2].map(a=>Math.max(...pos.filter((_,i)=>i%3===a)));
 const bin=Buffer.concat([Buffer.from(P.buffer),Buffer.from(N.buffer),Buffer.from(C.buffer)]);
 return glb({asset:{version:'2.0',generator:'body kit rigid starter'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Sculpture',mesh:0}],
  materials:[{name:'Palette',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.8}}],
  meshes:[{name:'Sculpture',primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},material:0}]}],
  buffers:[{byteLength:bin.length}],bufferViews:[0,1,2].map(i=>({buffer:0,byteOffset:i*P.byteLength,byteLength:P.byteLength,target:34962})),
  accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min:lo,max:hi},{bufferView:1,componentType:5126,count,type:'VEC3'},{bufferView:2,componentType:5126,count,type:'VEC3'}]},bin);
}

/** Keep only the named clips and the data they and the skinned mesh use; geometry, skin and rig bytes are unchanged. */
export function keepClips(bytes,keep){
 const {json,bin}=readGLB(bytes);
 json.animations=(json.animations??[]).filter(a=>keep.includes(a.name));
 for(const name of keep)if(!json.animations.some(a=>a.name===name))throw Error(`Starter source has no ${name} clip`);
 const used=new Set(),mark=i=>{if(i!==undefined)used.add(i);};
 for(const mesh of json.meshes??[])for(const p of mesh.primitives){mark(p.indices);Object.values(p.attributes).forEach(mark);for(const t of p.targets??[])Object.values(t).forEach(mark);}
 for(const skin of json.skins??[])mark(skin.inverseBindMatrices);
 for(const a of json.animations)for(const s of a.samplers){mark(s.input);mark(s.output);}
 const acc=[...used].sort((a,b)=>a-b),accAt=new Map(acc.map((o,i)=>[o,i])),viewSet=new Set(acc.map(i=>json.accessors[i].bufferView).filter(v=>v!==undefined));
 for(const im of json.images??[])if(im.bufferView!==undefined)viewSet.add(im.bufferView);
 const views=[...viewSet].sort((a,b)=>a-b),viewAt=new Map(),parts=[];let off=0;
 json.bufferViews=views.map((o,i)=>{viewAt.set(o,i);const v=json.bufferViews[o],pad=(4-off%4)%4;if(pad){parts.push(Buffer.alloc(pad));off+=pad;}
  parts.push(bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));const out={...v,buffer:0,byteOffset:off};off+=v.byteLength;return out;});
 json.accessors=acc.map(o=>{const a={...json.accessors[o]};if(a.bufferView!==undefined)a.bufferView=viewAt.get(a.bufferView);return a;});
 const A=i=>i===undefined?undefined:accAt.get(i);
 for(const mesh of json.meshes??[])for(const p of mesh.primitives){if(p.indices!==undefined)p.indices=A(p.indices);for(const k of Object.keys(p.attributes))p.attributes[k]=A(p.attributes[k]);for(const t of p.targets??[])for(const k of Object.keys(t))t[k]=A(t[k]);}
 for(const skin of json.skins??[])if(skin.inverseBindMatrices!==undefined)skin.inverseBindMatrices=A(skin.inverseBindMatrices);
 for(const a of json.animations)for(const s of a.samplers){s.input=A(s.input);s.output=A(s.output);}
 for(const im of json.images??[])if(im.bufferView!==undefined)im.bufferView=viewAt.get(im.bufferView);
 const out=Buffer.concat(parts,off);json.buffers=[{byteLength:out.length}];
 return glb(json,out);
}

const MOTION={contract:'body-motion/1',idle:{period:4,bob:.035,pitch:.025,roll:.035,yaw:.05},move:{period:3.2,bob:.025,pitch:.12,roll:.025,yaw:.02},rest:{period:5,bob:.015,pitch:.012,roll:.015,yaw:.02},dance:{period:.95,bob:.045,pitch:.16,roll:.24,yaw:.32}};
async function bytesAt(url,fetchImpl){
 const r=await fetchImpl(url,{signal:AbortSignal.timeout(90_000)});if(!r.ok)throw Error(`kit: ${new URL(url).pathname} answered HTTP ${r.status}`);
 return Buffer.from(await r.arrayBuffer());
}

/** The starter source for one choice. `origin` and `authoring` are public world URLs; no credential is sent. */
export async function starterSource(starter,{origin,world=origin,info,seed,fetchImpl}){
 if(starter==='rigid')return {model:rigidStarterGLB(seed),manifest:{type:'ceramic',license:'CC0',rightsConfirmed:true,name:'Kit sculpture '+seed,description:'An original faceted sculpture from the body kit. It glides, rests and dances in place; no hands.',motion:structuredClone(MOTION)},
  source:'generated locally by the body kit (original, CC0)'};
 if(starter==='humanoid')return {model:keepClips(await bytesAt(world+HUMANOID_SOURCE,fetchImpl).catch(()=>bytesAt(origin+HUMANOID_SOURCE,fetchImpl)),['Idle','Walk']),manifest:{type:'humanoid',rig:'quaternius/1',license:'CC0',rightsConfirmed:true,name:'Kit humanoid',description:'The canonical CC0 contact rig with its Idle and Walk clips, ready for local restyling.'},
  source:'the world\'s canonical CC0 humanoid ('+HUMANOID_SOURCE+'), reduced to Idle and Walk'};
 const pip=(info.presets??[]).find(p=>p.id==='pip');if(!pip?.body?.modelUrl)throw Error('kit: this world does not offer the shared rolling robot; choose --starter rigid or humanoid');
 return {model:await bytesAt(origin+pip.body.modelUrl,fetchImpl),manifest:{type:'humanoid',rig:'quaternius/1',license:'owned',rightsConfirmed:true,actionProfile:'rolling-gripper/1',name:'Kit rolling robot',description:'A rolling robot variant started from the shared Pip source. Wheels, grippers and an upright standby.'},
  source:'the shared Pip rolling robot (repository source, MIT); check with your human that your variant is yours to upload'};
}

/** body kit <dir>: fetch the world-effective kit, write one starter, validate it locally. Returns a plain report. */
export async function bodyKit(args,{load,call,fetchImpl=fetch,runValidate=defaultValidate}){
 const opts=parseKitArgs(args),dir=resolve(opts.dir),state=load();
 if(!state.world)throw Error('Run this from a paired Soul folder (node eden-agent.mjs register <world-url>)');
 const r=await call('/v1/edge/body');if(r.status!==200)throw Error(`kit: body discovery answered HTTP ${r.status}`);
 const info=r.data,origin=new URL(state.world).origin;
 if(!info.available||!info.authoring?.skill)throw Error('kit: this world does not admit uploaded bodies');
 const wanted=opts.starter==='rigid'?'ceramic':'humanoid';if(!(info.types??[]).includes(wanted))throw Error(`kit: this world does not admit ${wanted} bodies; choose another --starter`);
 const authoring=origin+info.authoring.skill.replace(/\/SKILL\.md$/,'');
 const targets=[...KIT_FILES,'body.glb','manifest.json','kit.json'];
 if(existsSync(dir)&&!opts.force){const clash=targets.filter(f=>existsSync(join(dir,f)));if(clash.length)throw Error(`kit: ${opts.dir} already has ${clash.join(', ')}; nothing was changed (use --force to replace, or choose a new directory)`);}
 const files={};for(const f of KIT_FILES)files[f]=await bytesAt(authoring+'/'+f,fetchImpl);
 const start=await starterSource(opts.starter,{origin,world:state.world.replace(/\/$/,''),info,seed:opts.seed,fetchImpl});
 mkdirSync(dir,{recursive:true});
 for(const [f,b]of Object.entries(files))writeFileSync(join(dir,f),b);
 writeFileSync(join(dir,'body.glb'),start.model);writeFileSync(join(dir,'manifest.json'),JSON.stringify(start.manifest,null,1)+'\n');
 const kit={kit:'body-kit/1',authoring,starter:opts.starter,source:start.source,files:Object.fromEntries(Object.entries(files).map(([f,b])=>[f,'sha256:'+sha(b)])),body:'sha256:'+sha(start.model)};
 writeFileSync(join(dir,'kit.json'),JSON.stringify(kit,null,1)+'\n');
 const validation=runValidate(dir);
 return {kit:opts.dir,starter:opts.starter,source:start.source,files:readdirSync(dir).sort(),validation,
  recover:{current:info.body?.model??'humanoid',uploads:(info.uploads??[]).map(u=>({assetId:u.assetId,name:u.name??null,type:u.type})),select:'node eden-agent.mjs body set <assetId or preset>'},
  next:[`cd ${opts.dir} && node validate.mjs body.glb manifest.json --report`,`node validate.mjs body.glb manifest.json --preview preview.html (open it in a browser)`,
   `from the paired folder: node eden-agent.mjs body upload ${join(opts.dir,'body.glb')} --manifest ${join(opts.dir,'manifest.json')}`,'node eden-agent.mjs body set <returned assetId>']};
}
function defaultValidate(dir){
 const r=spawnSync(process.execPath,['validate.mjs','body.glb','manifest.json'],{cwd:dir,encoding:'utf8',timeout:60_000});
 const text=(r.status===0?r.stdout:r.stderr).trim();let out;try{out=JSON.parse(text);}catch{out={valid:false,error:{code:'kit.validate',message:text.slice(0,300)}};}
 return out.valid?{valid:true,assetId:out.admitted.assetId,triangles:out.admitted.triangles,bytes:out.admitted.bytes}:out;
}
