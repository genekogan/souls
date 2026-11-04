#!/usr/bin/env node
// Agent-local example (#723): an original compact centaur foal on the canonical CC0 contact rig (quaternius/1), declared
// quadruped-torso/1. The canonical legs are the forelegs; two extra hind-leg chains sit behind them and replay the same
// side's foreleg track half a stride later, so diagonal pairs (left fore with right hind) move together: a walk, with no
// solver, retargeting or new support model. The torso, arms and hands are the canonical ones, so the world's existing
// hand adapters and contacts apply unchanged. Support stays the humanoid navigation disc: the whole lower body is
// authored inside it (owner admission refuses body.footprint otherwise). The GLB is generated from the repository's
// published animated-casual.glb and is never checked in.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'mars/viewer/package.json'));
const T=await import(pathToFileURL(require.resolve('three').replace('/build/three.cjs','/build/three.module.js')).href);

export const CENTAUR_MANIFEST={type:'humanoid',license:'owned',rightsConfirmed:true,rig:'quaternius/1',actionProfile:'quadruped-torso/1',name:'Juniper the centaur foal',
 description:'A compact chestnut centaur foal in a green vest, with a dark mane, white socks and hands that can carry things. Walks on four legs and rests standing.'};
/** Hind hips and hooves sit this far behind the forelegs (m, before the renderer's shoulder fit). */
export const HIND_OFFSET=.24;
const LEG=['UpperLeg','LowerLeg','Foot'],HIND={UpperLeg:'HindUpperLeg',LowerLeg:'HindLowerLeg',Foot:'HindFoot'};

export function authorCentaur({source=join(root,'mars/viewer/public/modular/environment/animated-casual.glb'),out,hindOffset=HIND_OFFSET}={}){
 const src=readFileSync(resolve(source)),size=src.readUInt32LE(12),original=JSON.parse(src.toString('utf8',20,20+size)),binary=src.subarray(28+size);
 if(original.nodes?.[61]?.name!=='Root'||original.skins?.[0]?.joints?.length!==62)throw Error('Use the repository canonical animated-casual.glb source; this example is not a general rig converter.');
 const nodes=structuredClone(original.nodes.slice(0,62));nodes.push({name:'JuniperRig',children:[61]});
 const index=name=>{const i=nodes.findIndex(n=>n.name===name);if(i<0)throw Error('Missing joint '+name);return i;};
 // Hind chains: hip under Body, knee under the hip, hoof under Root (canonical feet are Root children), offset straight back.
 // Body and Root carry no bind rotation in the canonical rig, so a world offset is the same local offset.
 for(const n of [index('Body'),index('Root')])if(Math.abs((nodes[n].rotation??[0,0,0,1])[1])>1e-5||(nodes[n].scale??[1,1,1]).some(s=>Math.abs(s-1)>1e-5))throw Error('Canonical Body/Root bind transform changed');
 const back=t=>[t[0],t[1],t[2]-hindOffset];
 for(const side of ['L','R']){
  const fore=LEG.map(n=>nodes[index(n+'.'+side)]),[hip,knee,hoof]=LEG.map(n=>nodes.length+LEG.indexOf(n));
  nodes.push({name:HIND.UpperLeg+'.'+side,rotation:fore[0].rotation,scale:fore[0].scale,translation:back(fore[0].translation),children:[knee]});
  nodes.push({name:HIND.LowerLeg+'.'+side,rotation:fore[1].rotation,scale:fore[1].scale,translation:fore[1].translation});
  nodes.push({name:HIND.Foot+'.'+side,rotation:fore[2].rotation,translation:back(fore[2].translation)});
  nodes[index('Body')].children.push(hip);nodes[index('Root')].children.push(hoof);
 }
 const parents=new Map();nodes.forEach((n,i)=>(n.children??[]).forEach(c=>parents.set(c,i)));
 const cache=new Map(),matrix=i=>{if(cache.has(i))return cache.get(i);const n=nodes[i],m=new T.Matrix4().compose(new T.Vector3(...n.translation??[0,0,0]),new T.Quaternion(...n.rotation??[0,0,0,1]),new T.Vector3(...n.scale??[1,1,1]));if(parents.has(i))m.premultiply(matrix(parents.get(i)));cache.set(i,m);return m;};
 const point=name=>new T.Vector3().setFromMatrixPosition(matrix(index(name)));
 const joints=[...original.skins[0].joints,...['L','R'].flatMap(side=>LEG.map(n=>index(HIND[n]+'.'+side)))],joint=name=>joints.indexOf(index(name));
 const palette={coat:'#a0603a',coatDark:'#7a4428',sock:'#f2e8d8',hoof:'#2e2622',mane:'#3a2418',skin:'#e2b48e',vest:'#4f7d58',vestDark:'#33553c',belt:'#6b4a2a',eye:'#1d1d1d',cheek:'#e79a86',buckle:'#e3c065'};
 const positions=[],normals=[],colours=[],jointIds=[];
 function part(geometry,p,color,bone,rotation=[0,0,0],scale=[1,1,1]){const g=geometry.index?geometry.toNonIndexed():geometry;g.scale(...scale);g.rotateX(rotation[0]);g.rotateY(rotation[1]);g.rotateZ(rotation[2]);g.translate(...p);g.computeVertexNormals();
  const c=new T.Color(palette[color]),pos=g.getAttribute('position'),nor=g.getAttribute('normal'),j=joint(bone);if(j<0)throw Error('Bone is not a skin joint: '+bone);
  for(let i=0;i<pos.count;i++){positions.push(pos.getX(i),pos.getY(i),pos.getZ(i));normals.push(nor.getX(i),nor.getY(i),nor.getZ(i));colours.push(c.r,c.g,c.b);jointIds.push(j);}}
 const sphere=(p,r,color,bone,scale,w=10,h=7)=>part(new T.SphereGeometry(r,w,h),p,color,bone,[0,0,0],scale);
 const box=(p,dim,color,bone,rotation)=>part(new T.BoxGeometry(...dim),p,color,bone,rotation);
 function limb(a,b,r,color,bone,r2=r,seg=8){const d=b.clone().sub(a),g=new T.CylinderGeometry(r2,r,d.length(),seg);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize()));part(g,a.clone().add(b).multiplyScalar(.5).toArray(),color,bone);}
 const body=point('Body'),hips=point('Hips'),chest=point('Chest'),head=point('Head'),neck=point('Neck'),zf=point('UpperLeg.L').z,zh=zf-hindOffset;
 // Horse barrel: a rounded body between the fore and hind hips, its top just under the human waist. Skinned to Body.
 const barrelY=body.y-.07,mid=(zf+zh)/2;
 sphere([body.x,barrelY,mid],.5,'coat','Body',[.27,.32,.4],14,10);
 sphere([body.x,barrelY-.09,mid+.02],.4,'coatDark','Body',[.3,.2,.42],12,8);      // belly shade
 sphere([body.x,barrelY+.07,zf+.05],.14,'coat','Body',[1,1.1,.8]);                     // withers, into the human waist
 sphere([body.x,barrelY+.04,zh+.01],.13,'coat','Body',[1.05,1.1,.85]);                     // haunches
 // A short tail, falling close behind the haunches.
 limb(new T.Vector3(body.x,barrelY+.06,zh-.09),new T.Vector3(body.x,barrelY-.18,zh-.11),.03,'mane','Body',.045);
 // Four legs: thigh to knee on the hip bone, cannon to fetlock on the knee bone, sock and hoof on the foot.
 for(const side of ['L','R'])for(const prefix of ['','Hind']){
  const up=prefix?HIND.UpperLeg:'UpperLeg',low=prefix?HIND.LowerLeg:'LowerLeg',ft=prefix?HIND.Foot:'Foot',[hip,knee,foot]=[up,low,ft].map(n=>point(n+'.'+side));
  limb(hip.clone().setY(hip.y-.12),knee,.045,'coat',up+'.'+side,.06);
  sphere(knee.toArray(),.05,'coat',low+'.'+side);
  limb(knee,foot.clone().setY(foot.y+.12),.038,'coat',low+'.'+side,.045);
  limb(foot.clone().setY(foot.y+.13),foot.clone().setY(foot.y+.055),.045,'sock',ft+'.'+side,.04);
  part(new T.CylinderGeometry(.045,.055,.055,10),[foot.x,foot.y+.028,foot.z+.01],'hoof',ft+'.'+side);
 }
 // Human torso: waist out of the withers, a green vest with a belt, bare arms, a round friendly head with a mane of hair.
 limb(new T.Vector3(hips.x,hips.y-.02,hips.z),point('Torso'),.12,'vest','Abdomen',.11);
 box([hips.x,hips.y+.05,hips.z+.01],[.24,.05,.2],'belt','Abdomen');box([hips.x,hips.y+.05,hips.z+.11],[.05,.04,.012],'buckle','Abdomen');
 sphere([chest.x,chest.y-.06,chest.z],.17,'vest','Chest',[1.05,1.15,.8]);
 box([chest.x,chest.y-.04,chest.z+.125],[.025,.24,.03],'vestDark','Chest');
 limb(neck.clone().setY(neck.y-.03),head,.045,'skin','Neck',.04);
 const h=[head.x,head.y+.11,head.z+.02];sphere(h,.12,'skin','Head',[1,1.08,1],12,9);
 sphere([h[0],h[1]+.05,h[2]-.02],.125,'mane','Head',[1.05,.85,1.05],12,8);            // hair cap
 limb(new T.Vector3(h[0],h[1]+.02,h[2]-.09),new T.Vector3(h[0],h[1]-.16,h[2]-.12),.035,'mane','Head',.05);   // ponytail
 for(const s of [-1,1]){sphere([h[0]+s*.042,h[1]+.005,h[2]+.105],.016,'eye','Head');sphere([h[0]+s*.07,h[1]-.035,h[2]+.09],.022,'cheek','Head',[1,.6,.4]);
  part(new T.ConeGeometry(.03,.07,6),[h[0]+s*.1,h[1]+.1,h[2]-.01],'mane','Head',[0,0,-s*.5]);}                     // little horse ears
 sphere([h[0],h[1]-.025,h[2]+.12],.015,'skin','Head');
 // Arms and hands: the palm sits on the canonical Wrist→Middle2 contact, so held items meet visible hands.
 for(const side of ['L','R']){
  const [shoulder,elbow,wrist,finger]=['UpperArm.','LowerArm.','Wrist.','Middle2.'].map(n=>point(n+side)),palm=wrist.clone().lerp(finger,.5);
  sphere(shoulder.toArray(),.055,'vest','UpperArm.'+side);limb(shoulder,elbow,.045,'skin','UpperArm.'+side,.05);limb(elbow,wrist,.035,'skin','LowerArm.'+side,.042);
  sphere(palm.toArray(),.045,'skin','Wrist.'+side,[1,.75,1]);
  const axis=finger.clone().sub(wrist).normalize();sphere(palm.clone().addScaledVector(axis,.05).toArray(),.025,'skin','Middle1.'+side,[1,.7,1]);
 }
 // Clips: the canonical Idle and Walk with hind tracks added; an authored standing dance and upright standby.
 const decode=i=>{const a=original.accessors[i],v=original.bufferViews[a.bufferView],at=(v.byteOffset??0)+(a.byteOffset??0),width={VEC4:4,VEC3:3,SCALAR:1}[a.type],out=new Float32Array(a.count*width),stride=v.byteStride;
  const size={5126:4,5122:2,5120:1,5123:2,5121:1}[a.componentType],step=stride??size*width;
  for(let e=0;e<a.count;e++)for(let k=0;k<width;k++){const p=at+e*step+k*size;out[e*width+k]=a.componentType===5126?binary.readFloatLE(p):a.componentType===5122?Math.max(binary.readInt16LE(p)/32767,-1):a.componentType===5120?Math.max(binary.readInt8(p)/127,-1):a.componentType===5123?binary.readUInt16LE(p)/65535:binary.readUInt8(p)/255;}return Array.from(out);};
 const canonical=name=>{const a=original.animations.find(x=>x.name===name);return {name,tracks:a.channels.map(c=>{const s=a.samplers[c.sampler];return {node:c.target.node,path:c.target.path,times:decode(s.input),values:decode(s.output),interpolation:s.interpolation??'LINEAR'};})};};
 const width=path=>path==='rotation'?4:3;
 const sample=(track,t)=>{const n=width(track.path),ts=track.times;if(t<=ts[0])return track.values.slice(0,n);if(t>=ts.at(-1))return track.values.slice(-n);let i=0;while(ts[i+1]<t)i++;const k=(t-ts[i])/(ts[i+1]-ts[i]),a=track.values.slice(i*n,i*n+n),b=track.values.slice((i+1)*n,(i+1)*n+n);
  if(track.path==='rotation')return new T.Quaternion(...a).slerp(new T.Quaternion(...b),k).toArray();return a.map((v,j)=>v+(b[j]-v)*k);};
 const delta=path=>path==='translation'?[0,0,-hindOffset]:null;
 function addHind(clip,shiftFraction){
  const duration=Math.max(...clip.tracks.map(t=>t.times.at(-1)));
  for(const side of ['L','R'])for(const n of LEG){const fore=index(n+'.'+side),hind=index(HIND[n]+'.'+side);
   for(const track of clip.tracks.filter(t=>t.node===fore)){
    const offset=(n==='LowerLeg'?null:delta(track.path)),shift=duration*shiftFraction,times=track.times.slice();
    const values=times.flatMap(t=>{const v=sample(track,shift?((t+shift)%duration):t);return offset?v.map((x,i)=>x+offset[i]):v;});
    clip.tracks.push({node:hind,path:track.path,times,values,interpolation:track.interpolation});}}
  return clip;}
 const idle=addHind(canonical('Idle'),0),walk=addHind(canonical('Walk'),.5);
 const still=(name,seconds)=>({name,tracks:idle.tracks.map(t=>{const v=sample(t,0);return {node:t.node,path:t.path,times:[0,seconds],values:[...v,...v],interpolation:'LINEAR'};})});
 const rest=(clip,name)=>{const t=clip.tracks.find(t=>t.node===index(name)&&t.path==='rotation');if(t)return t;const n={node:index(name),path:'rotation',times:[0,1],values:[...nodes[index(name)].rotation??[0,0,0,1],...nodes[index(name)].rotation??[0,0,0,1]],interpolation:'LINEAR'};clip.tracks.push(n);return n;};
 const turn=(clip,name,frames)=>{const t=rest(clip,name),base=new T.Quaternion(...t.values.slice(0,4));t.times=frames.map(f=>f[0]);t.values=frames.flatMap(([,axis,angle])=>base.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(...axis),angle)).toArray());};
 // Dance: in place on four planted hooves; the torso sways, the head bobs and the forearms pump in turn.
 const dance=still('Dance_Loop',4),beats=Array.from({length:17},(_,i)=>i/4);
 turn(dance,'Torso',beats.map(t=>[t,[0,1,0],.3*Math.sin(t*Math.PI)]));turn(dance,'Head',beats.map(t=>[t,[1,0,0],.15*Math.sin(t*Math.PI*2)]));
 turn(dance,'LowerArm.L',beats.map(t=>[t,[0,0,1],-.45-.45*Math.sin(t*Math.PI*2)]));turn(dance,'LowerArm.R',beats.map(t=>[t,[0,0,1],.45-.45*Math.sin(t*Math.PI*2)]));
 // Standby: upright on the same four hooves, head lowered, forearms folded, a slow breath in the chest.
 const standby=still('Standby_Loop',4);turn(standby,'Head',[[0,[1,0,0],.45],[4,[1,0,0],.45]]);turn(standby,'Chest',[[0,[1,0,0],.05],[2,[1,0,0],.09],[4,[1,0,0],.05]]);
 turn(standby,'LowerArm.L',[[0,[0,0,1],-.8],[4,[0,0,1],-.8]]);turn(standby,'LowerArm.R',[[0,[0,0,1],.8],[4,[0,0,1],.8]]);
 const clips=[idle,walk,dance,standby];
 // GLB: original nodes, the canonical skin plus hind joints with fresh inverse binds, the clips, one skinned mesh.
 const gltf={asset:{version:'2.0',generator:'Juniper agent-local centaur authoring example'},nodes,skins:[],scenes:[{nodes:[62]}],scene:0,meshes:[],
  materials:[{name:'Juniper palette',pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.8}}],accessors:[],bufferViews:[],buffers:[],animations:[]},chunks=[];let offset=0;
 const view=buffer=>{const i=gltf.bufferViews.length;gltf.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length});chunks.push(buffer,Buffer.alloc((4-buffer.length%4)%4));offset+=Math.ceil(buffer.length/4)*4;return i;};
 const shared=new Map(),accessor=(data,type,componentType=5126,extra={})=>{const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength),key=type+componentType+JSON.stringify(extra)+bytes.toString('base64');if(shared.has(key))return shared.get(key);
  const i=gltf.accessors.length;gltf.accessors.push({bufferView:view(bytes),componentType,count:data.length/({SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[type]),type,...extra});shared.set(key,i);return i;};
 for(const clip of clips){const anim={name:clip.name,channels:[],samplers:[]};for(const t of clip.tracks){const input=accessor(new Float32Array(t.times),'SCALAR',5126,{min:[t.times[0]],max:[t.times.at(-1)]}),output=accessor(new Float32Array(t.values),t.path==='rotation'?'VEC4':'VEC3');
  anim.channels.push({sampler:anim.samplers.length,target:{node:t.node,path:t.path}});anim.samplers.push({input,output,interpolation:t.interpolation});}gltf.animations.push(anim);}
 const unique=new Map(),indices=[],compact={p:[],n:[],c:[],j:[],w:[]};
 for(let i=0;i<positions.length/3;i++){const key=[...positions.slice(i*3,i*3+3),...normals.slice(i*3,i*3+3),...colours.slice(i*3,i*3+3),jointIds[i]].map(v=>v.toFixed(5)).join(',');let k=unique.get(key);
  if(k===undefined){k=unique.size;unique.set(key,k);compact.p.push(...positions.slice(i*3,i*3+3));compact.n.push(...normals.slice(i*3,i*3+3));compact.c.push(...colours.slice(i*3,i*3+3));compact.j.push(jointIds[i],0,0,0);compact.w.push(1,0,0,0);}indices.push(k);}
 const lo=[0,1,2].map(a=>Math.min(...compact.p.filter((_,i)=>i%3===a))),hi=[0,1,2].map(a=>Math.max(...compact.p.filter((_,i)=>i%3===a)));
 const attrs={POSITION:accessor(new Float32Array(compact.p),'VEC3',5126,{min:lo,max:hi}),NORMAL:accessor(new Float32Array(compact.n),'VEC3'),COLOR_0:accessor(new Float32Array(compact.c),'VEC3'),JOINTS_0:accessor(new Uint16Array(compact.j),'VEC4',5123),WEIGHTS_0:accessor(new Float32Array(compact.w),'VEC4')};
 gltf.meshes.push({name:'Juniper original centaur geometry',primitives:[{attributes:attrs,indices:accessor(new Uint16Array(indices),'SCALAR',5123),material:0}]});
 const inverse=[];for(const i of joints)inverse.push(...matrix(i).clone().invert().elements);gltf.skins.push({joints,skeleton:61,inverseBindMatrices:accessor(new Float32Array(inverse),'MAT4')});
 const mesh=nodes.length;nodes.push({name:'Juniper',mesh:0,skin:0});nodes[62].children.push(mesh);
 gltf.buffers=[{byteLength:offset}];
 const jb=Buffer.from(JSON.stringify(gltf)),json=Buffer.alloc(Math.ceil(jb.length/4)*4,32);jb.copy(json);const bin=Buffer.concat(chunks),bytes=Buffer.alloc(28+json.length+bin.length);
 bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);bytes.writeUInt32LE(bin.length,20+json.length);bytes.writeUInt32LE(0x004e4942,24+json.length);bin.copy(bytes,28+json.length);
 // Lower-body reach from the x/z centre the renderer stands the body on (bind pose, before its shoulder fit).
 const cx=(lo[0]+hi[0])/2,cz=(lo[2]+hi[2])/2;let reach=0;for(let i=0;i<compact.p.length;i+=3)if(compact.p[i+1]<hips.y)reach=Math.max(reach,Math.hypot(compact.p[i]-cx,compact.p[i+2]-cz));
 const manifest=structuredClone(CENTAUR_MANIFEST);
 if(out){out=resolve(out);mkdirSync(out,{recursive:true});writeFileSync(join(out,'body.glb'),bytes);writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,1)+'\n');}
 return {bytes,manifest,stats:{body:'Juniper',bytes:bytes.length,triangles:indices.length/3,drawCalls:1,images:0,joints:joints.length,clips:gltf.animations.map(c=>c.name),lowerBodyReach:+reach.toFixed(3),hindOffset}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(authorCentaur({source:process.argv[2],out:process.argv[3]??join(root,'.local/centaur-authored')}).stats));
