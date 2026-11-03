#!/usr/bin/env node
// Agent-local example: original geometry/dance, with the published CC0 canonical contact rig and foot phase.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'mars/viewer/package.json'));
const T=await import(pathToFileURL(require.resolve('three').replace('/build/three.cjs','/build/three.module.js')).href);
const {RoundedBoxGeometry}=await import(pathToFileURL(require.resolve('three').replace('/build/three.cjs','/examples/jsm/geometries/RoundedBoxGeometry.js')).href);
const source=resolve(process.argv[2]??join(root,'mars/viewer/public/modular/environment/animated-casual.glb'));
const out=resolve(process.argv[3]??join(root,'.local/robot-authored'));mkdirSync(out,{recursive:true});
const bytes=readFileSync(source),size=bytes.readUInt32LE(12),original=JSON.parse(bytes.toString('utf8',20,20+size)),binary=bytes.subarray(28+size);
if(original.nodes?.[61]?.name!=='Root'||original.skins?.[0]?.joints?.length!==62||original.skins[0].joints.some(i=>i<0||i>=62))throw Error('Use the repository canonical animated-casual.glb source; this example is not a general rig converter.');
const nodes=structuredClone(original.nodes.slice(0,62));nodes.push({name:'PipRig',children:[61]});
const index=name=>{const i=nodes.findIndex(n=>n.name===name);if(i<0)throw Error('Missing canonical joint '+name);return i;};
const parents=new Map();nodes.forEach((n,i)=>(n.children??[]).forEach(c=>parents.set(c,i)));
const matrices=new Map();function matrix(i){if(matrices.has(i))return matrices.get(i);const n=nodes[i],m=new T.Matrix4().compose(new T.Vector3(...n.translation??[0,0,0]),new T.Quaternion(...n.rotation??[0,0,0,1]),new T.Vector3(...n.scale??[1,1,1]));if(parents.has(i))m.premultiply(matrix(parents.get(i)));matrices.set(i,m);return m;}
const point=name=>new T.Vector3().setFromMatrixPosition(matrix(index(name)));
const wheelRadius=.205,wheelY=wheelRadius,rootZ=point('Root').z;
const wheels=['WheelL','WheelR'].map((name,i)=>{const n=nodes.length;nodes.push({name,translation:[i===0?.212:-.212,wheelY,0]});nodes[61].children.push(n);parents.set(n,61);return n;});
const joints=[...original.skins[0].joints,...wheels],joint=name=>joints.indexOf(index(name));
const positions=[],normals=[],colours=[],jointIds=[],weights=[];
const palette={gold:'#e6ad51',cream:'#fff1c9',dark:'#243943',rubber:'#283339',steel:'#71949c',cyan:'#85e2eb',blue:'#153c54',white:'#ffffff',pink:'#ef8c91'};
function part(geometry,p,color,bone,rotation=[0,0,0]){const g=geometry.index?geometry.toNonIndexed():geometry;g.rotateX(rotation[0]);g.rotateY(rotation[1]);g.rotateZ(rotation[2]);g.translate(...p);const c=new T.Color(palette[color]??color),pos=g.getAttribute('position'),nor=g.getAttribute('normal'),j=typeof bone==='number'?joints.indexOf(bone):joint(bone);if(j<0)throw Error('Unbound part');for(let i=0;i<pos.count;i++){positions.push(pos.getX(i),pos.getY(i),pos.getZ(i));normals.push(nor.getX(i),nor.getY(i),nor.getZ(i));colours.push(c.r,c.g,c.b);jointIds.push(j,0,0,0);weights.push(1,0,0,0);}geometry.dispose();if(g!==geometry)g.dispose();}
const box=(p,dim,color,bone='Root',radius=.025)=>part(new RoundedBoxGeometry(...dim,1,radius),p,color,bone);
const sphere=(p,r,color,bone)=>part(new T.SphereGeometry(r,12,8),p,color,bone);
function strut(a,b,r,color,bone){const delta=b.clone().sub(a),g=new T.CylinderGeometry(r,r,delta.length(),10);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));part(g,a.clone().add(b).multiplyScalar(.5).toArray(),color,bone);}
// Low stable chassis; the wheels are the only visible ground contact. No visible human legs or feet.
box([0,.32,rootZ],[.37,.19,.38],'gold','Root',.04);box([0,.405,rootZ],[.27,.06,.28],'cream');
strut(new T.Vector3(0,.43,rootZ),new T.Vector3(0,.92,rootZ),.055,'steel','Root');
for(let side=0;side<2;side++){
 const x=side===0?.212:-.212,bone=wheels[side];part(new T.CylinderGeometry(wheelRadius,wheelRadius,.10,24),[x,wheelY,rootZ],'rubber',bone,[0,0,Math.PI/2]);
 const outside=x+(side===0?.056:-.056);part(new T.CylinderGeometry(.115,.115,.018,16),[outside,wheelY,rootZ],'cream',bone,[0,0,Math.PI/2]);
 // Asymmetric spokes and treads make rotation readable on camera.
 box([outside,wheelY+.045,rootZ],[.02,.13,.035],'gold',bone,.008);
 for(let i=0;i<12;i++){const angle=i*Math.PI/6;part(new T.BoxGeometry(.105,.025,.035),[x,wheelY+Math.cos(angle)*(wheelRadius-.0135),rootZ+Math.sin(angle)*(wheelRadius-.0135)],'steel',bone,[angle,0,0]);}
}
// Rounded mustard torso, cream instrument panel, cyan indicator and a little pixel heart.
box([0,1.16,.045],[.40,.43,.33],'gold','Chest',.065);
box([0,1.16,.221],[.28,.28,.025],'cream','Chest',.035);
box([-.067,1.225,.240],[.095,.036,.014],'dark','Chest',.006);
box([-.067,1.225,.25],[.055,.018,.012],'cyan','Chest',.004);
for(const [x,y]of [[0,1],[2,1],[0,0],[1,0],[2,0],[1,-1]])box([.035+x*.025,1.15+y*.025,.244],[.024,.024,.018],'pink','Chest',.004);
for(const x of [-.11,.11])sphere([x,1.035,.23],.018,'steel','Chest');
strut(new T.Vector3(0,1.38,.045),new T.Vector3(0,1.58,.045),.045,'steel','Neck');
// Binocular face: large blue lenses, sloping eyelids, small white highlights.
box([0,1.63,.055],[.46,.17,.15],'gold','Head',.04);
for(const side of [-1,1]){
 const x=side*.125;part(new T.CylinderGeometry(.137,.137,.13,24),[x,1.642,.125],'dark','Head',[Math.PI/2,0,side*.12]);
 part(new T.CylinderGeometry(.108,.108,.012,24),[x,1.642,.197],'cyan','Head',[Math.PI/2,0,0]);
 part(new T.CylinderGeometry(.083,.083,.016,24),[x,1.643,.207],'blue','Head',[Math.PI/2,0,0]);
 sphere([x-.023,1.676,.22],.022,'white','Head');sphere([x+.027,1.616,.222],.009,'cyan','Head');
 box([x,1.763,.14],[.20,.026,.12],'gold','Head',.01);
}
// Canonical arm and palm geometry makes actual engine hand targets coincide with visible grippers.
for(const side of ['L','R']){
 const names=['UpperArm.','LowerArm.','Wrist.','Middle2.'].map(n=>n+side),[shoulder,elbow,wrist,finger]=names.map(point),palm=wrist.clone().lerp(finger,.5);
 sphere(shoulder.toArray(),.065,'steel','UpperArm.'+side);strut(shoulder,elbow,.043,'gold','UpperArm.'+side);sphere(elbow.toArray(),.052,'dark','LowerArm.'+side);strut(elbow,wrist,.037,'steel','LowerArm.'+side);
 sphere(wrist.toArray(),.047,'gold','Wrist.'+side);strut(wrist,palm,.035,'gold','Wrist.'+side);
 const axis=finger.clone().sub(wrist).normalize(),jaw=palm.clone().addScaledVector(axis,.022);
 for(const sign of [-1,1]){const center=jaw.clone().add(new T.Vector3(0,0,sign*.047));box(center.toArray(),[.085,.035,.024],'cream',sign===1?'Middle1.'+side:'Thumb1.'+side,.008);sphere(center.clone().addScaledVector(axis,.025).toArray(),.022,'dark',sign===1?'Middle1.'+side:'Thumb1.'+side);}
}
// Compact GLB writer: retain only the two source clips' accessors, then add original mesh and authored dance.
const gltf={asset:{version:'2.0',generator:'Pip agent-local robot authoring example'},nodes,skins:[],scenes:[{nodes:[62]}],scene:0,meshes:[],materials:[{name:'Pip palette',pbrMetallicRoughness:{metallicFactor:.18,roughnessFactor:.46}}],accessors:[],bufferViews:[],buffers:[],animations:[]},chunks=[];let offset=0;
function view(data){const buffer=Buffer.from(data.buffer??data,data.byteOffset??0,data.byteLength??data.length),i=gltf.bufferViews.length;gltf.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length});chunks.push(buffer,Buffer.alloc((4-buffer.length%4)%4));offset+=Math.ceil(buffer.length/4)*4;return i;}
const accessorCache=new Map();
function accessor(data,type,componentType=5126,extra={}){const signature=createHash('sha256').update(Buffer.from(data.buffer,data.byteOffset,data.byteLength)).update(JSON.stringify([type,componentType,extra])).digest('hex');if(accessorCache.has(signature))return accessorCache.get(signature);const count=data.length/({SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[type]),i=gltf.accessors.length;gltf.accessors.push({bufferView:view(data),componentType,count,type,...extra});accessorCache.set(signature,i);return i;}
const oldAccessors=new Map();function copyAccessor(i){if(oldAccessors.has(i))return oldAccessors.get(i);const a=original.accessors[i],v=original.bufferViews[a.bufferView],start=v.byteOffset??0,vi=view(binary.subarray(start,start+v.byteLength)),next=gltf.accessors.length;gltf.accessors.push({...a,bufferView:vi});oldAccessors.set(i,next);return next;}
for(const name of ['Idle','Walk']){const clip=structuredClone(original.animations.find(a=>a.name===name));for(const s of clip.samplers){s.input=copyAccessor(s.input);s.output=copyAccessor(s.output);}gltf.animations.push(clip);}
const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i++) {mins[i%3]=Math.min(mins[i%3],positions[i]);maxs[i%3]=Math.max(maxs[i%3],positions[i]);}
const unique=new Map(),indices=[],compact={positions:[],normals:[],colours:[],jointIds:[],weights:[]};
for(let i=0;i<positions.length/3;i++){const key=[...positions.slice(i*3,i*3+3),...normals.slice(i*3,i*3+3),...colours.slice(i*3,i*3+3),jointIds[i*4]].map(v=>v.toFixed(6)).join(',');let n=unique.get(key);if(n===undefined){n=unique.size;unique.set(key,n);for(const [name,width]of [['positions',3],['normals',3],['colours',3],['jointIds',4],['weights',4]])compact[name].push(...({positions,normals,colours,jointIds,weights}[name].slice(i*width,i*width+width)));}indices.push(n);}
const attrs={POSITION:accessor(new Float32Array(compact.positions),'VEC3',5126,{min:mins,max:maxs}),NORMAL:accessor(new Float32Array(compact.normals),'VEC3'),COLOR_0:accessor(new Float32Array(compact.colours),'VEC3'),JOINTS_0:accessor(new Uint16Array(compact.jointIds),'VEC4',5123),WEIGHTS_0:accessor(new Float32Array(compact.weights),'VEC4')};
gltf.meshes.push({name:'Pip original robot geometry',primitives:[{attributes:attrs,indices:accessor(new Uint16Array(indices),'SCALAR',5123),material:0}]});
const inverse=[];for(const i of joints)inverse.push(...matrix(i).clone().invert().elements);gltf.skins.push({joints,skeleton:61,inverseBindMatrices:accessor(new Float32Array(inverse),'MAT4')});
const mesh=nodes.length;nodes.push({name:'Pip',mesh:0,skin:0});nodes[62].children.push(mesh);
function addTrack(clip,node,path,times,values){const input=accessor(new Float32Array(times),'SCALAR',5126,{min:[times[0]],max:[times.at(-1)]}),output=accessor(new Float32Array(values),path==='rotation'?'VEC4':'VEC3');const sampler=clip.samplers.length;clip.samplers.push({input,output,interpolation:'LINEAR'});const prior=clip.channels.find(c=>c.target.node===node&&c.target.path===path);if(prior)prior.sampler=sampler;else clip.channels.push({sampler,target:{node,path}});}
function valuesAtFirst(clip,channel){const s=clip.samplers[channel.sampler],a=gltf.accessors[s.output],v=gltf.bufferViews[a.bufferView],data=Buffer.concat(chunks),n=channel.target.path==='rotation'?4:3;return Array.from({length:n},(_,i)=>data.readFloatLE(v.byteOffset+(a.byteOffset??0)+i*4));}
// Idle is deliberate stillness; Walk retains the canonical foot phase, with restrained mechanical arms.
const idle=gltf.animations[0],walk=gltf.animations[1];for(const channel of [...idle.channels]){const first=valuesAtFirst(idle,channel);addTrack(idle,channel.target.node,channel.target.path,[0,2],[...first,...first]);if(!['Foot.L','Foot.R'].includes(nodes[channel.target.node].name))addTrack(walk,channel.target.node,channel.target.path,[0,1],[...first,...first]);}
// Match the canonical distance clock to one wheel circumference per clip: no backwards tread or loop seam.
const walkDuration=4/3,rawData=Buffer.concat(chunks);
const readArray=i=>{const a=gltf.accessors[i],v=gltf.bufferViews[a.bufferView],width=a.type==='SCALAR'?1:3;return Array.from({length:a.count*width},(_,k)=>rawData.readFloatLE(v.byteOffset+(a.byteOffset??0)+k*4));};
const feet=['Foot.L','Foot.R'].map(name=>{const channel=walk.channels.find(c=>c.target.node===index(name)&&c.target.path==='translation'),sampler=walk.samplers[channel.sampler];return {node:index(name),times:readArray(sampler.input),values:readArray(sampler.output)};});
const at=(foot,t)=>{let i=0;while(i<foot.times.length-2&&foot.times[i+1]<t)i++;const k=Math.max(0,Math.min(1,(t-foot.times[i])/(foot.times[i+1]-foot.times[i])));return [0,1,2].map(axis=>foot.values[i*3+axis]+(foot.values[(i+1)*3+axis]-foot.values[i*3+axis])*k);};
const velocities=[];let previous;for(let n=0;n<=120;n++){const t=n*walkDuration/120,p=feet.map(foot=>at(foot,t)),side=p[0][1]<p[1][1]?0:1;if(previous&&previous.side===side)velocities.push((p[side][2]-previous.z)/(walkDuration/120));previous={side,z:p[side][2]};}velocities.sort((a,b)=>a-b);const stanceSpeed=Math.abs(velocities[Math.floor(velocities.length/2)]);if(!(stanceSpeed>.2))throw Error('Canonical forward foot phase is unavailable');
const strideScale=2*Math.PI*wheelRadius/(walkDuration*stanceSpeed);for(const foot of feet)addTrack(walk,foot.node,'translation',foot.times,foot.values.map((v,i)=>i%3===2?v*strideScale:v));
const wheelTimes=Array.from({length:17},(_,i)=>i*walkDuration/16),wheelValues=wheelTimes.flatMap(t=>new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),2*Math.PI*t/walkDuration).toArray());for(const wheel of wheels){addTrack(idle,wheel,'rotation',[0,2],[0,0,0,1,0,0,0,1]);addTrack(walk,wheel,'rotation',wheelTimes,wheelValues);}
const dance={name:'Dance_Loop',channels:[],samplers:[]};for(const channel of idle.channels){const v=valuesAtFirst(idle,channel);addTrack(dance,channel.target.node,channel.target.path,[0,4],[...v,...v]);}
const times=Array.from({length:33},(_,i)=>i/8);for(const [name,turns]of [['Chest',1],['Head',-2]]){const node=index(name),base=new T.Quaternion(...nodes[node].rotation??[0,0,0,1]),values=times.flatMap(t=>base.clone().premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),turns*2*Math.PI*t/4)).toArray());addTrack(dance,node,'rotation',times,values);}gltf.animations.push(dance);
// Drop superseded channels and unused source data; no authoring-only buffers enter the upload.
const used=new Set(Object.values(attrs));used.add(gltf.meshes[0].primitives[0].indices);used.add(gltf.skins[0].inverseBindMatrices);
for(const clip of gltf.animations){const samplers=[],map=new Map();for(const channel of clip.channels){const old=channel.sampler;if(!map.has(old)){map.set(old,samplers.length);const sample=clip.samplers[old];samplers.push(sample);used.add(sample.input);used.add(sample.output);}channel.sampler=map.get(old);}clip.samplers=samplers;}
const data=Buffer.concat(chunks),accessors=[...used].sort((a,b)=>a-b),remap=new Map(accessors.map((n,i)=>[n,i])),oldViews=gltf.bufferViews,views=new Map();gltf.bufferViews=[];chunks.splice(0);offset=0;
gltf.accessors=accessors.map(i=>{const a={...gltf.accessors[i]},vi=a.bufferView;if(!views.has(vi)){const v=oldViews[vi];views.set(vi,view(data.subarray(v.byteOffset,v.byteOffset+v.byteLength)));}a.bufferView=views.get(vi);return a;});
for(const key of Object.keys(attrs))attrs[key]=remap.get(attrs[key]);gltf.meshes[0].primitives[0].indices=remap.get(gltf.meshes[0].primitives[0].indices);gltf.skins[0].inverseBindMatrices=remap.get(gltf.skins[0].inverseBindMatrices);for(const clip of gltf.animations)for(const sampler of clip.samplers){sampler.input=remap.get(sampler.input);sampler.output=remap.get(sampler.output);}
gltf.buffers=[{byteLength:offset}];const jsonBytes=Buffer.from(JSON.stringify(gltf)),json=Buffer.alloc(Math.ceil(jsonBytes.length/4)*4,32);jsonBytes.copy(json);const bin=Buffer.concat(chunks),result=Buffer.alloc(28+json.length+bin.length);result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);result.writeUInt32LE(bin.length,20+json.length);result.writeUInt32LE(0x004e4942,24+json.length);bin.copy(result,28+json.length);
const manifest={type:'humanoid',license:'owned',rightsConfirmed:true,rig:'quaternius/1',name:'Pip the rolling robot',description:'A locally authored wheeled robot with visible canonical-contact grippers and a counter-rotating torso/head dance.'};writeFileSync(join(out,'pip.glb'),result);writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({body:'Pip',bytes:result.length,triangles:positions.length/9,drawCalls:1,images:0,joints:joints.length,clips:gltf.animations.map(c=>c.name)}));
