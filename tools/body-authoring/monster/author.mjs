#!/usr/bin/env node
// Agent-local example: an original compact monster on the canonical CC0 contact rig (quaternius/1).
// Original geometry is rigidly skinned to the canonical bones; the canonical Idle and Walk clips are kept as they are,
// so the world's existing humanoid adapters (walk, dance, rest, seats, hands) apply unchanged. No new abilities.
// The GLB is generated from the repository's published animated-casual.glb and is never checked in.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'mars/viewer/package.json'));
const T=await import(pathToFileURL(require.resolve('three').replace('/build/three.cjs','/build/three.module.js')).href);

export const MONSTER_MANIFEST={type:'humanoid',license:'owned',rightsConfirmed:true,rig:'quaternius/1',name:'Grumble the monster',
 description:'A stocky moss-green monster with mismatched horns, a toothy grin and big clawed hands that can carry things.'};

export function authorMonster({source=join(root,'mars/viewer/public/modular/environment/animated-casual.glb'),out}={}){
 const src=readFileSync(resolve(source)),size=src.readUInt32LE(12),original=JSON.parse(src.toString('utf8',20,20+size)),binary=src.subarray(28+size);
 if(original.nodes?.[61]?.name!=='Root'||original.skins?.[0]?.joints?.length!==62)throw Error('Use the repository canonical animated-casual.glb source; this example is not a general rig converter.');
 const nodes=structuredClone(original.nodes.slice(0,62));nodes.push({name:'GrumbleRig',children:[61]});
 const index=name=>{const i=nodes.findIndex(n=>n.name===name);if(i<0)throw Error('Missing canonical joint '+name);return i;};
 const parents=new Map();nodes.forEach((n,i)=>(n.children??[]).forEach(c=>parents.set(c,i)));
 const cache=new Map(),matrix=i=>{if(cache.has(i))return cache.get(i);const n=nodes[i],m=new T.Matrix4().compose(new T.Vector3(...n.translation??[0,0,0]),new T.Quaternion(...n.rotation??[0,0,0,1]),new T.Vector3(...n.scale??[1,1,1]));if(parents.has(i))m.premultiply(matrix(parents.get(i)));cache.set(i,m);return m;};
 const point=name=>new T.Vector3().setFromMatrixPosition(matrix(index(name)));
 const joints=original.skins[0].joints,joint=name=>joints.indexOf(index(name));
 const palette={moss:'#5f8f3e',belly:'#c9d48a',dark:'#2c3a22',horn:'#efe2c2',horn2:'#b98f5a',eye:'#ffd24a',pupil:'#1b1b1b',tooth:'#fffaf0',claw:'#3a2f2a',mouth:'#5a1f2a'};
 const positions=[],normals=[],colours=[],jointIds=[],weights=[];
 function part(geometry,p,color,bone,rotation=[0,0,0],scale=[1,1,1]){const g=geometry.index?geometry.toNonIndexed():geometry;g.scale(...scale);g.rotateX(rotation[0]);g.rotateY(rotation[1]);g.rotateZ(rotation[2]);g.translate(...p);g.computeVertexNormals();
  const c=new T.Color(palette[color]),pos=g.getAttribute('position'),nor=g.getAttribute('normal'),j=joint(bone);if(j<0)throw Error('Bone is not a skin joint: '+bone);
  for(let i=0;i<pos.count;i++){positions.push(pos.getX(i),pos.getY(i),pos.getZ(i));normals.push(nor.getX(i),nor.getY(i),nor.getZ(i));colours.push(c.r,c.g,c.b);jointIds.push(j,0,0,0);weights.push(1,0,0,0);}}
 const sphere=(p,r,color,bone,scale)=>part(new T.SphereGeometry(r,10,7),p,color,bone,[0,0,0],scale);
 const box=(p,dim,color,bone,rotation)=>part(new T.BoxGeometry(...dim),p,color,bone,rotation);
 function limb(a,b,r,color,bone,r2=r){const d=b.clone().sub(a),g=new T.CylinderGeometry(r2,r,d.length(),9);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize()));part(g,a.clone().add(b).multiplyScalar(.5).toArray(),color,bone);}
 function cone(p,r,h,color,bone,rotation){part(new T.ConeGeometry(r,h,8),p,color,bone,rotation);}
 const hips=point('Hips'),chest=point('Chest'),head=point('Head');
 // A round belly and broad chest; the silhouette stays inside the canonical body width so seats and doors still fit.
 sphere([hips.x,hips.y+.1,hips.z+.02],.24,'moss','Hips',[1.05,1.05,.9]);sphere([hips.x,hips.y+.06,hips.z+.12],.13,'belly','Hips',[1,1,.5]);
 sphere([chest.x,chest.y-.04,chest.z],.21,'moss','Chest',[1.15,1,.9]);sphere([chest.x,chest.y-.06,chest.z+.12],.12,'belly','Chest',[1.1,1,.45]);
 for(const [x,y]of [[-.08,.08],[.06,.12],[0,-.02]])sphere([chest.x+x,chest.y+y,chest.z-.17],.04,'dark','Chest');      // back spines
 // Head: a wide face, uneven eyes, mismatched horns and a toothy grin.
 const h=[head.x,head.y+.12,head.z+.02];sphere(h,.17,'moss','Head',[1.15,.95,1]);
 sphere([h[0]-.07,h[1]+.04,h[2]+.14],.05,'eye','Head');sphere([h[0]-.07,h[1]+.04,h[2]+.185],.022,'pupil','Head');
 sphere([h[0]+.075,h[1]+.055,h[2]+.13],.038,'eye','Head');sphere([h[0]+.075,h[1]+.055,h[2]+.165],.017,'pupil','Head');
 box([h[0],h[1]-.07,h[2]+.15],[.17,.045,.04],'mouth','Head');for(const x of [-.06,-.02,.025,.065])cone([h[0]+x,h[1]-.055,h[2]+.17],.012,.035,'tooth','Head',[Math.PI,0,0]);
 cone([h[0]-.13,h[1]+.17,h[2]],.05,.22,'horn','Head',[0,0,.45]);cone([h[0]+.13,h[1]+.13,h[2]],.045,.14,'horn2','Head',[.2,0,-.7]);
 // Arms and big clawed hands: the palm sits on the canonical Wrist→Middle2 contact, so held items meet visible hands.
 for(const side of ['L','R']){
  const [shoulder,elbow,wrist,finger]=['UpperArm.','LowerArm.','Wrist.','Middle2.'].map(n=>point(n+side)),palm=wrist.clone().lerp(finger,.5);
  sphere(shoulder.toArray(),.075,'moss','UpperArm.'+side);limb(shoulder,elbow,.075,'moss','UpperArm.'+side,.06);limb(elbow,wrist,.06,'moss','LowerArm.'+side,.055);
  sphere(palm.toArray(),.06,'moss','Wrist.'+side,[1,.8,1]);
  const axis=finger.clone().sub(wrist).normalize();for(const k of [-1,0,1]){const tip=palm.clone().addScaledVector(axis,.06).add(new T.Vector3(0,0,k*.03));cone(tip.toArray(),.012,.04,'claw','Wrist.'+side,[0,0,side==='L'?-Math.PI/2:Math.PI/2]);}
 }
 // Short sturdy legs ending in wide feet on the canonical foot joints; the feet keep the canonical walk phase.
 for(const side of ['L','R']){const [hip,knee,foot]=['UpperLeg.','LowerLeg.','Foot.'].map(n=>point(n+side));
  limb(hip,knee,.11,'moss','UpperLeg.'+side,.095);limb(knee,foot.clone().setY(foot.y+.08),.085,'moss','LowerLeg.'+side,.095);
  box([foot.x,foot.y+.04,foot.z+.04],[.13,.08,.2],'dark','Foot.'+side);for(const x of [-.035,0,.035])cone([foot.x+x,foot.y+.02,foot.z+.15],.014,.04,'claw','Foot.'+side,[Math.PI/2,0,0]);}
 // A stubby tail on the hips, curling to one side.
 limb(new T.Vector3(hips.x,hips.y,hips.z-.15),new T.Vector3(hips.x+.06,hips.y-.08,hips.z-.32),.06,'moss','Hips',.025);
 // GLB: original nodes, the canonical skin with fresh inverse binds, the canonical Idle and Walk clips, one skinned mesh.
 const gltf={asset:{version:'2.0',generator:'Grumble agent-local monster authoring example'},nodes,skins:[],scenes:[{nodes:[62]}],scene:0,meshes:[],
  materials:[{name:'Grumble palette',pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.75}}],accessors:[],bufferViews:[],buffers:[],animations:[]},chunks=[];let offset=0;
 const view=buffer=>{const i=gltf.bufferViews.length;gltf.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length});chunks.push(buffer,Buffer.alloc((4-buffer.length%4)%4));offset+=Math.ceil(buffer.length/4)*4;return i;};
 const accessor=(data,type,componentType=5126,extra={})=>{const i=gltf.accessors.length;gltf.accessors.push({bufferView:view(Buffer.from(data.buffer,data.byteOffset,data.byteLength)),componentType,count:data.length/({SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[type]),type,...extra});return i;};
 const copied=new Map(),copy=i=>{if(!copied.has(i)){const a=original.accessors[i],v=original.bufferViews[a.bufferView],start=v.byteOffset??0;const k=gltf.accessors.length;gltf.accessors.push({...a,bufferView:view(binary.subarray(start,start+v.byteLength))});copied.set(i,k);}return copied.get(i);};
 for(const name of ['Idle','Walk']){const clip=structuredClone(original.animations.find(a=>a.name===name));for(const s of clip.samplers){s.input=copy(s.input);s.output=copy(s.output);}gltf.animations.push(clip);}
 const unique=new Map(),indices=[],compact={p:[],n:[],c:[],j:[],w:[]};
 for(let i=0;i<positions.length/3;i++){const key=[...positions.slice(i*3,i*3+3),...normals.slice(i*3,i*3+3),...colours.slice(i*3,i*3+3),jointIds[i*4]].map(v=>v.toFixed(5)).join(',');let k=unique.get(key);
  if(k===undefined){k=unique.size;unique.set(key,k);compact.p.push(...positions.slice(i*3,i*3+3));compact.n.push(...normals.slice(i*3,i*3+3));compact.c.push(...colours.slice(i*3,i*3+3));compact.j.push(...jointIds.slice(i*4,i*4+4));compact.w.push(...weights.slice(i*4,i*4+4));}indices.push(k);}
 const lo=[0,1,2].map(a=>Math.min(...compact.p.filter((_,i)=>i%3===a))),hi=[0,1,2].map(a=>Math.max(...compact.p.filter((_,i)=>i%3===a)));
 const attrs={POSITION:accessor(new Float32Array(compact.p),'VEC3',5126,{min:lo,max:hi}),NORMAL:accessor(new Float32Array(compact.n),'VEC3'),COLOR_0:accessor(new Float32Array(compact.c),'VEC3'),JOINTS_0:accessor(new Uint16Array(compact.j),'VEC4',5123),WEIGHTS_0:accessor(new Float32Array(compact.w),'VEC4')};
 gltf.meshes.push({name:'Grumble original monster geometry',primitives:[{attributes:attrs,indices:accessor(new Uint16Array(indices),'SCALAR',5123),material:0}]});
 const inverse=[];for(const i of joints)inverse.push(...matrix(i).clone().invert().elements);gltf.skins.push({joints,skeleton:61,inverseBindMatrices:accessor(new Float32Array(inverse),'MAT4')});
 const mesh=nodes.length;nodes.push({name:'Grumble',mesh:0,skin:0});nodes[62].children.push(mesh);
 gltf.buffers=[{byteLength:offset}];
 const jb=Buffer.from(JSON.stringify(gltf)),json=Buffer.alloc(Math.ceil(jb.length/4)*4,32);jb.copy(json);const bin=Buffer.concat(chunks),bytes=Buffer.alloc(28+json.length+bin.length);
 bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);bytes.writeUInt32LE(bin.length,20+json.length);bytes.writeUInt32LE(0x004e4942,24+json.length);bin.copy(bytes,28+json.length);
 const manifest=structuredClone(MONSTER_MANIFEST);
 if(out){out=resolve(out);mkdirSync(out,{recursive:true});writeFileSync(join(out,'body.glb'),bytes);writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,1)+'\n');}
 return {bytes,manifest,stats:{body:'Grumble',bytes:bytes.length,triangles:indices.length/3,drawCalls:1,images:0,joints:joints.length,clips:gltf.animations.map(c=>c.name)}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(authorMonster({source:process.argv[2],out:process.argv[3]??join(root,'.local/monster-authored')}).stats));
