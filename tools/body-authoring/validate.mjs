#!/usr/bin/env node
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {BODY_UPLOAD_POLICY,validateUpload} from './upload-validation.ts';
import {bindBodyDefinition,admitBodyGLB,BODY_LIMITS} from './admission.ts';
import {rollingActionProblem,ROLLING_ACTIONS} from './action-profile.ts';
import {MOTION_LIMITS} from './motion.ts';

/** Same normalization and admission as the world. Throws the world's own field/measured/limit errors. */
export function validateBody(model,definition){
 const bound=bindBodyDefinition(model,definition),normalized=validateUpload(bound,BODY_UPLOAD_POLICY),bytes=Buffer.from(normalized.bytes);
 return {admitted:admitBodyGLB(bytes,definition),bytes};
}

// Actions an agent commonly asks a body for. `edge` is the verb the profile rule is asked about.
const PROBE=[['go','go'],['stand','stand'],['turn','turn'],['look','look'],['speak','speak'],['rest','rest'],['wake','stand'],['dance','dance'],
 ['wave','wave'],['pick-up','pick-up'],['put-on','put-on'],['carry','pick-up'],['sit','sit'],['lie','lie'],['nap','nap'],['swim','swim'],['ride','ride'],['partner-dance','partner-dance'],['eat','eat'],['drink','drink']];
const CONTACT=new Set(['pick-up','put-on','carry','wave','sit','lie','nap','swim','ride','partner-dance','eat','drink']);
const RIGID_CORE=new Set(['go','stand','turn','look','speak','rest','wake']);
const imageSize=(b,mime)=>{if(mime==='image/png'&&b.length>=24)return [b.readUInt32BE(16),b.readUInt32BE(20)];
 for(let p=2;p+9<b.length;){if(b[p]!==0xff)break;const m=b[p+1],n=b.readUInt16BE(p+2);if(m>=0xc0&&m<=0xcf&&![0xc4,0xc8,0xcc].includes(m))return [b.readUInt16BE(p+7),b.readUInt16BE(p+5)];p+=2+n;}return [0,0];};

/** body-report/1: what the world will make of this body, from the same admission and profile rules. Never a frame rate or a contact result. */
export function bodyReport(admitted,bytes,manifest,contract=null){
 const n=bytes.readUInt32LE(12),j=JSON.parse(bytes.toString('utf8',20,20+n)),bin=bytes.subarray(28+n);
 const profile=manifest.actionProfile??(manifest.type==='humanoid'?'humanoid':'rigid'),skinned=(j.skins??[]).length>0;
 const clips=(j.animations??[]).map(a=>a.name),needClips=profile==='rigid'?[]:profile==='humanoid'?['Idle','Walk']:['Idle','Walk','Dance_Loop','Standby_Loop'];
 const adapters=manifest.motion?Object.keys(manifest.motion).filter(k=>k!=='contract'):[];
 const draws=(j.meshes??[]).reduce((s,m)=>s+m.primitives.length,0),images=(j.images??[]).map(im=>{const v=j.bufferViews[im.bufferView],b=bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),[w,h]=imageSize(b,im.mimeType);return {bytes:v.byteLength,width:w,height:h};});
 const drawLimit=manifest.type==='humanoid'?BODY_LIMITS.humanoidDrawCalls:BODY_LIMITS.rigidDrawCalls,dim=Math.max(0,...images.map(i=>Math.max(i.width,i.height))),imgBytes=Math.max(0,...images.map(i=>i.bytes));
 const budget=(field,measured,limit)=>({field,measured,limit,remaining:limit-measured});
 const geometryViews=new Set();for(const m of j.meshes??[])for(const p of m.primitives){for(const a of [p.indices,...Object.values(p.attributes)])if(a!==undefined)geometryViews.add(j.accessors[a].bufferView);}
 const geometryBytes=[...geometryViews].reduce((s,v)=>s+(j.bufferViews[v]?.byteLength??0),0),textureBytes=images.reduce((s,i)=>s+i.width*i.height*4,0);
 const rigidReason=contract?.profiles?.rigid?.otherPhysical?.reason??'This profile has no hands, seat, swim or ride adaptations.';
 const supported=[],refused=[];
 for(const [action,verb]of PROBE){let reason=null;
  if(profile==='rigid')reason=RIGID_CORE.has(action)?null:action==='dance'?(adapters.includes('dance')?null:'No motion.dance adapter was submitted.'):rigidReason;
  else if(profile==='rolling-gripper/1')reason=rollingActionProblem(verb,undefined,'edge');
  (reason?refused:supported).push(reason?{action,reason}:{action,proof:CONTACT.has(action)?'world-authoritative: support, reach and custody are decided in the world; a preview shows no contact':'world-authoritative movement and timing; the preview is visual only'});}
 const world=contract?{types:contract.types,typeAllowed:contract.types.includes(manifest.type)}:{types:null,typeAllowed:null,note:'contract.json not found next to validate.mjs; world policy unknown'};
 return {contract:'body-report/1',assetId:admitted.assetId,profile,world,
  requirements:{clips:{required:needClips,present:clips,missing:needClips.filter(c=>!clips.includes(c))},
   adapters:profile==='rigid'?{contract:'body-motion/1',required:['idle','move','rest'],optional:['dance'],present:adapters,fadeSeconds:MOTION_LIMITS.fadeSeconds}:{note:profile==='humanoid'?'existing canonical humanoid adapters':ROLLING_ACTIONS.rest},
   dimensions:profile==='rigid'?{fittedExtent:.7,navigationRadius:.35,hoverHeight:1.45,support:'ground navigation with a visual hover; not flight'}:{rig:'quaternius/1',shoulderHeight:1.34,armReach:.62,support:'canonical ground support and foot phase',contacts:'canonical hands (Middle2) are the contact points'}},
  actions:{supported,refused,unknown:'unsupported; requires an admitted adapter'},
  budgets:[budget('bytes',admitted.bytes,BODY_LIMITS.bytes),budget('triangles',admitted.triangles,BODY_LIMITS.triangles),budget('drawCalls',draws,drawLimit),budget('images',images.length,BODY_LIMITS.images),
   budget('imageBytes',imgBytes,BODY_LIMITS.imageBytes),budget('imageDimension',dim,BODY_LIMITS.imageDimension),budget('nodes',admitted.nodes,BODY_LIMITS.nodes),budget('accessors',(j.accessors??[]).length,BODY_LIMITS.accessors)],
  repeated:{estimate:true,method:'shared geometry and textures are counted once; triangles and draws scale with copies; texture bytes are RGBA8 from image dimensions without mipmaps; not measured GPU memory',
   copies:[1,5,20].map(c=>({copies:c,triangles:admitted.triangles*c,drawCalls:draws*c,geometryBytes,textureBytesRGBA8:textureBytes,skeletons:skinned?c:0}))},
  measured:{fps:null,contacts:null,note:'Local tools cannot measure frame rate or prove physical contact; walk the body in a world.'}};
}

/** A local page: the supplied body with idle/move/dance/rest/wake/interrupt, and its report. Visual only. */
export function previewPage(bytes,manifest,report){
 const data={glb:bytes.toString('base64'),manifest,report};
 return PREVIEW_HTML.replace('/*DATA*/null',JSON.stringify(data).replace(/</g,'\\u003c'));
}

const PREVIEW_HTML=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Body preview</title>
<style>body{margin:0;font:14px/1.4 system-ui,sans-serif;background:#f4f1ea;color:#222;display:flex;flex-wrap:wrap}#v{flex:1 1 480px;height:100vh;min-height:360px}aside{flex:0 1 380px;padding:12px 16px;height:100vh;overflow:auto;box-sizing:border-box}
.banner{background:#fff3cd;border:1px solid #d9b44a;padding:8px;border-radius:6px}button{margin:2px;padding:6px 10px;font:inherit}button.on{background:#333;color:#fff}li{margin:2px 0}.no{color:#8a2b1a}#state{font-weight:600}</style>
<div id="v"></div><aside><p class="banner"><b>Visual preview only.</b> This page plays the body's own clips or motion adapters on your computer. Ground support, collisions, reach, contacts, custody and interruption are decided by the world, and nothing here proves them.</p>
<h3 id="title"></h3><div id="buttons"></div><p>Now: <span id="state">idle</span></p><p id="log"></p><h4>Supported (world decides the effect)</h4><ul id="ok"></ul><h4>Refused, with reasons</h4><ul id="refused"></ul><h4>Budgets</h4><ul id="budgets"></ul></aside>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.186.1/build/three.module.js","three/addons/":"https://unpkg.com/three@0.186.1/examples/jsm/"}}</script>
<script type="module">
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const D=/*DATA*/null,R=D.report,M=D.manifest,rigid=R.profile==='rigid',el=id=>document.getElementById(id);
el('title').textContent=(M.name??'Body')+' — '+R.profile+' — '+R.assetId.slice(0,17)+'…';
for(const a of R.actions.supported){const li=document.createElement('li');li.textContent=a.action+': '+a.proof;el('ok').append(li);}
for(const a of R.actions.refused){const li=document.createElement('li');li.className='no';li.textContent=a.action+': '+a.reason;el('refused').append(li);}
for(const b of R.budgets){const li=document.createElement('li');li.textContent=b.field+': '+b.measured+' of '+b.limit;el('budgets').append(li);}
const host=el('v'),renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(devicePixelRatio);host.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color(0xdfe8ee);scene.add(new T.HemisphereLight(0xffffff,0x887766,2.2));const sun=new T.DirectionalLight(0xffffff,1.6);sun.position.set(3,6,4);scene.add(sun);
scene.add(new T.GridHelper(8,16,0x888888,0xbbbbbb));const camera=new T.PerspectiveCamera(40,1,.05,100);camera.position.set(2.6,2.2,3.6);const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,1,0);
const fit=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};addEventListener('resize',fit);fit();
const raw=Uint8Array.from(atob(D.glb),c=>c.charCodeAt(0)).buffer,gltf=await new GLTFLoader().parseAsync(raw,'');
const root=new T.Group(),body=gltf.scene;root.add(body);scene.add(root);
let mode='idle',dance=null,clock=0,last=performance.now(),mixer=null,acts={},current=null,phase=0;
if(rigid){const box=new T.Box3().setFromObject(body),size=box.getSize(new T.Vector3()),c=box.getCenter(new T.Vector3()),s=.7/Math.max(size.x,size.y,size.z);body.position.sub(c).multiplyScalar(s);body.scale.setScalar(s);}
else{mixer=new T.AnimationMixer(body);for(const clip of gltf.animations)acts[clip.name]=mixer.clipAction(clip);}
const clipFor=m=>m==='move'?'Walk':m==='dance'?'Dance_Loop':m==='rest'?'Standby_Loop':'Idle';
function play(m){if(rigid)return;const name=clipFor(m),a=acts[name]??acts.Idle;if(!acts[name]&&m!=='idle')note(m+': this file has no '+name+' clip; the world uses its shared humanoid adapter, which is not previewed here.');
 if(a===current)return;a.reset().play();if(current)current.crossFadeTo(a,.4,false);current=a;}
const note=t=>el('log').textContent=t;
const set=(m,why)=>{if(m==='dance'&&rigid&&!M.motion?.dance){note('dance: refused, no motion.dance adapter.');return;}
 if(rigid&&dance&&m!=='dance')dance.release=clock;if(rigid&&m==='dance')dance={since:clock,release:null};mode=m;el('state').textContent=m;play(m);if(why)note(why);
 document.querySelectorAll('#buttons button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));};
const buttons={Idle:()=>set('idle'),Move:()=>set('move'),Dance:()=>set('dance'),Rest:()=>set('rest',rigid?'rest: the rest adapter while settled on support.':'rest: upright standby in place.'),
 Wake:()=>set('idle','wake: rest ends; the body returns to idle in place.'),
 Interrupt:()=>{const from=mode;set('move','interrupt: '+from+' gives way to a new move with a 0.4 s fade. In the world the action queue decides whether and when this happens.');}};
for(const [k,f]of Object.entries(buttons)){const b=document.createElement('button');b.textContent=k;b.dataset.m=k.toLowerCase();b.onclick=f;el('buttons').append(b);}
const smooth=x=>{x=Math.min(1,Math.max(0,x));return x*x*(3-2*x);};
const sample=(a,t)=>{const w=2*Math.PI*t/a.period+phase;return {bob:a.bob*Math.sin(w),pitch:a.pitch*Math.sin(w+Math.PI/2),roll:a.roll*Math.sin(w*.999),yaw:a.yaw*Math.sin(w)};};
const mix=(a,b,w)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+(b[k]-a[k])*w]));
let angle=0,moveW=0;set('idle');
renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min(.1,(now-last)/1000);last=now;clock+=dt;
 moveW+=((mode==='move'?1:0)-moveW)*Math.min(1,dt/.4);angle+=dt*.4*moveW/1.5;root.position.set(Math.sin(angle)*1.5-0,0,Math.cos(angle)*1.5-1.5);root.rotation.y=angle+Math.PI/2*moveW;
 if(rigid){const mo=M.motion;let q=sample(mode==='rest'?mo.rest:mo.idle,clock);q=mix(q,sample(mo.move,clock),moveW);
  if(dance&&mo.dance){const w=dance.release===null?smooth((clock-dance.since)/.4):(1-smooth((clock-dance.release)/.4));q=mix(q,sample(mo.dance,clock),w);if(dance.release!==null&&clock-dance.release>.4)dance=null;}
  body.parent.position.y=1.45+q.bob;root.rotation.x=q.pitch;root.rotation.z=q.roll;root.rotation.y+=q.yaw;}
 else mixer.update(dt);orbit.update();renderer.render(scene,camera);});
</script>`;

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {
  const args=process.argv.slice(2),flags={report:false,preview:null},files=[];
  for(let i=0;i<args.length;i++){if(args[i]==='--report')flags.report=true;else if(args[i]==='--preview'){flags.preview=args[++i];if(!flags.preview)throw Error('--preview needs an output .html path');}else files.push(args[i]);}
  const [model,manifest]=files;if(!model||!manifest||files.length!==2)throw Error('usage: node validate.mjs body.glb manifest.json [--report] [--preview preview.html]');
  const definition=JSON.parse(readFileSync(manifest,'utf8')),{admitted,bytes}=validateBody(readFileSync(model),definition);
  const here=join(dirname(fileURLToPath(import.meta.url)),'contract.json'),contract=existsSync(here)?JSON.parse(readFileSync(here,'utf8')):null;
  const report=flags.report||flags.preview?bodyReport(admitted,bytes,definition,contract):undefined;
  if(flags.preview)writeFileSync(flags.preview,previewPage(bytes,definition,report));
  console.log(JSON.stringify({valid:true,admitted,...(flags.report?{report}:{}),...(flags.preview?{preview:flags.preview}:{})},null,2));
 } catch(e){console.error(JSON.stringify({valid:false,error:{code:e.code??'body.local-validation',message:e.message,...(e.details?{details:e.details}:{})}}));process.exitCode=1;}
}
