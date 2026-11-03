// M05 #636: a reachable 0.93 m control uses standing contact, including tall rigs whose hips sit above it.
// Existing Entry33 standing drop bound stays 0.03 m; no arm stretch or movement authority is added.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {HumanoidKit} from '../src/humanoid/compose.ts';
import {washTimes,type CupMotion} from '../../../mars/viewer/engine/items/cup.ts';
import {HAND_REACH_SECONDS} from '../../../mars/viewer/engine/social/hand-actuator.ts';

const DT=.05;
async function template(name:string,height?:number){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 // a composed core/humanoid@2 look scales the whole body by height / 1.75 (people.ts bodyScaleOf)
 if(height)gltf.scene.userData.humanoid={look:{height}};
 return templateFromGltf(`${name}-${height??1.75}`,gltf);
}
/** The drawn posture over a body-relative reach, including an optional translated root/heading (idle variety off): the worst drop / kneel /
 *  rise, and the assigned right palm's distance at contact. The actuator's own clock eases the hand back down. */
function reach(v:HumanViews,id:string,local:[number,number,number],root:[number,number,number]=[0,0,0],yaw=0){
 const at:[number,number,number]=[root[0]+Math.cos(yaw)*local[0]-Math.sin(yaw)*local[2],root[1]+local[1],root[2]+Math.sin(yaw)*local[0]+Math.cos(yaw)*local[2]];
 const t0=100,start=Math.round(t0/DT);let drop=0,kneel=0,rise=0,bend=0,err=Infinity,soleError=0,palmStep=0;let previous:number[]|undefined;
 for(let t=t0-.2;t<=t0+HAND_REACH_SECONDS+.8;t+=DT){const tt=+t.toFixed(4);
  const f:SampledHuman=tt<t0?{id,p:root,yaw,walk:0,walkDist:0,activity:'idle',restAge:0}
   :{id,p:root,yaw,walk:0,walkDist:0,activity:'operate',restAge:0,hands:{right:at},handActuator:{target:'switch',at,startTick:start},handActuatorTime:tt};
  v.setFrame([f],tt);v.render(1);const b=v.bones(id)[id];
  const rp=b.arms.find(a=>a.side==='right')!.palm;if(previous)palmStep=Math.max(palmStep,Math.hypot(...rp.map((x,i)=>x-previous![i])));previous=rp;
  soleError=Math.max(soleError,...b.soles.map(y=>Math.abs(y-root[1])));
  drop=Math.max(drop,b.pose.drop);kneel=Math.max(kneel,b.pose.kneel);rise=Math.max(rise,b.pose.rise);bend=Math.max(bend,b.pose.bend);
  if(Math.abs(tt-t0-HAND_REACH_SECONDS)<DT/2)err=Math.hypot(...b.arms.find(a=>a.side==='right')!.palm.map((x,i)=>x-at[i]));}
 return {drop,kneel,rise,bend,err,soleError,palmStep};
}

for(const name of ['casual','punk','woman'])for(const height of [1.65,1.67,1.7,1.75,1.8,1.85])for(const forward of [.35,.55]){
 test(`rest-height valve ${name} height ${height} forward ${forward}: supported standing contact`,async()=>{
  const v=new HumanViews();v.setTemplates([await template(name,height)]);
  const r=reach(v,`h_rest_${name}_${height}_${forward}`,[forward,.93,0]);
  console.log(JSON.stringify({case:'rest-height',name,height,forward,...r}));
  assert.ok(r.drop<=.03&&r.kneel===0,`unnecessary dip: ${JSON.stringify(r)}`);
  assert.ok(r.err<=.02,`actual palm contact within 2 cm: ${JSON.stringify(r)}`);
  assert.ok(r.palmStep<=.08,`unchanged M04 palm step ${r.palmStep}`);
  assert.ok(r.soleError<=.03,`feet remain supported: ${JSON.stringify(r)}`);
 });
}

for(const frame of ['masc','fem'] as const)test(`composed ${frame} tall look: rotated elevated standing contact`,async()=>{
 const kit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(new URL('../../../mars/viewer/public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;});
 const tpl=await kit.template({frame,preset:frame==='masc'?'casual':'woman',height:1.85,build:1.1});
 const v=new HumanViews();v.setTemplates([tpl]);const r=reach(v,`h_kit_${frame}`,[.55,.93,0],[7,1.4,-3],1.2);
 console.log(JSON.stringify({case:'composed-elevated',frame,...r}));assert.ok(r.drop<=.03&&r.kneel===0,JSON.stringify(r));assert.ok(r.err<=.02,JSON.stringify(r));assert.ok(r.soleError<=.03,JSON.stringify(r));assert.ok(r.palmStep<=.08,JSON.stringify(r));
});
for(const name of ['casual','punk','woman'])for(const height of [1.65,1.85])test(`existing cup wash hold ${name} ${height}: assigned hand contact`,async()=>{
 const v=new HumanViews();v.setTemplates([await template(name,height)]);const id=`h_cup_${name}_${height}`;
 const m:CupMotion={item:'mug',hand:'right',stage:'wash',face:0,startTick:2000,cupYaw:0,spin:0,hold:[.35,.795,.17],valve:[.35,1.14,0],seconds:1.6};
 let error=0,drop=0,soleError=0;
 for(let k=0;k<=Math.ceil(washTimes(m).end/DT);k++){const t=100+k*DT;v.setFrame([{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'wash',restAge:0,cup:m,cupTime:t}],t);v.render(1);const b=v.bones(id)[id],right=b.arms.find(a=>a.side==='right')!;
  if(right.target)error=Math.max(error,Math.hypot(...right.palm.map((x,i)=>x-right.target![i])));drop=Math.max(drop,b.pose.drop);soleError=Math.max(soleError,...b.soles.map(Math.abs));
 }
 console.log(JSON.stringify({case:'cup-wash',name,height,error,drop,soleError}));assert.ok(error<=.12,`unchanged contact tolerance ${error}`);assert.ok(soleError<=.03,`supported soles ${soleError}`);
});
