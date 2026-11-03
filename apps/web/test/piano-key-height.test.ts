import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,eachSkinnedWorld,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf,type Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {pianoNotes,pianoHands} from '../../../mars/viewer/app/engine-view/piano-score.ts';
import * as THREE from 'three';
import {CHARACTER_WIRE} from '../../../mars/viewer/app/engine-view/character-wire.ts';
import {HumanoidKit} from '../src/humanoid/compose.ts';
const RIGS=(process.env.HG_RIGS??'casual,wire-casual,wire-punk,wire-woman,kit-masc,kit-fem').split(',');

const DT=.05;
const tpls:Record<string,Template>={};
/** A GLB with its textures stripped (node has no image decoder). */
async function glb(file:string){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/${file}`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 if(json.materials)json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
/** `name`: a source GLB (casual/punk/woman), or `wire-<name>`: the mesh + shared clips files the live client loads
 *  (people.ts loadTemplates; character-wire.ts), whose hands rest in other poses. */
async function views(name='casual',height=1.75){
 const key=name+'-'+height;
 if(!tpls[key]){
  if(name.startsWith('kit-')){const kit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(new URL('../../../mars/viewer/public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;});tpls[key]=await kit.template({frame:name.slice(4) as 'masc'|'fem',preset:name==='kit-fem'?'woman':'casual',height} as never);}
  else if(name.startsWith('wire-')){const w=CHARACTER_WIRE[name.slice(5) as keyof typeof CHARACTER_WIRE],g=await glb(w.mesh);g.animations=(await glb(w.clips)).animations.map(c=>c.clone());g.scene.userData.humanoid={look:{height}};tpls[key]=templateFromGltf(key,g);}
  else {const g=await glb(`animated-${name}.glb`);g.scene.userData.humanoid={look:{height}};tpls[key]=templateFromGltf(key,g);}
 }
 const v=new HumanViews();v.setTemplates([tpls[key]]);return v;
}

type HandRefs={mesh:THREE.SkinnedMesh;idx:number[]}[];
const refsByHolder=new WeakMap<THREE.Object3D,HandRefs>();
function handSkin(holder:THREE.Object3D){
 const cached=refsByHolder.get(holder);if(cached)return cached;const refs:HandRefs=[];
 holder.traverse(o=>{const m=o as THREE.SkinnedMesh;if(!m.isSkinnedMesh)return;const si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;if(!si||!sw)return;
  const hand:boolean[]=[];for(let i=0;i<si.count;i++){let k=0;for(let j=1;j<4;j++)if(sw.getComponent(i,j)>sw.getComponent(i,k))k=j;hand[i]=/^(Wrist|Thumb|Index|Middle|Ring|Pinky)/.test(m.skeleton.bones[si.getComponent(i,k)]?.name??'');}
  const ix=m.geometry.index,points=new Set<number>();for(let i=0;i+2<(ix?.count??si.count);i+=3){const tri=[0,1,2].map(j=>ix?ix.getX(i+j):i+j);if(tri.some(j=>hand[j]))tri.forEach(j=>points.add(j));}if(points.size)refs.push({mesh:m,idx:[...points]});
 });refsByHolder.set(holder,refs);return refs;
}
// Bind the overlay to the actual immutable piano geometry and admitted bench.
const defs=JSON.parse(readFileSync(new URL('../../../packages/world-compiler/src/core-kit/furniture.json',import.meta.url),'utf8'));
const piano=defs.find((d:{name:string})=>d.name==='core-piano');
const keys=piano.make.args.shapes.filter((s:{tint:string})=>s.tint==='keys'||s.tint==='black');
const KEYS=Math.max(...keys.map((s:{at:number[];size:number[]})=>s.at[1]+s.size[1]/2)),BENCH=piano.slots.find((s:{id:string})=>s.id==='bench').p[1];
for(const rig of RIGS)for(const height of [1.65,1.75,1.85])for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const floor of [0,.6])test(`piano key contact (${rig},${height}m,yaw${yaw},floor${floor}): score-struck fingers on keys without knee dip`,async()=>{
 const v=await views(rig,height),id='piano_height',forward=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
 let maxStrikeError=0,minClearance=Infinity,maxDrop=0,maxKneel=0,samples=0,maxSkinPenetration=-Infinity,minPalmDown=Infinity,minThumbRadial=Infinity,maxReach=0,maxGoalError=0,skinSamples=0,worstSkin:{p:number[];depth:number;top:number}|null=null;
 for(const note of pianoNotes(id,100,108))for(const age of [0,.09,.2]){
  const t=note.t+age,f:SampledHuman={id,p:[0,floor,0],yaw,walk:0,walkDist:0,activity:'play-piano',baseActivity:'sit',seatHeight:BENCH,activityAge:10};
  v.setFrame([f],t);v.render(1);
  const holder=(v as unknown as {views:Map<string,{rig:{holder:THREE.Object3D}}>}).views.get(id)!.rig.holder,side=note.hand===0?'L':'R';
  const tips=['Index','Middle','Ring','Pinky'].map(name=>holder.getObjectByName(name+'4'+side)!.getWorldPosition(new THREE.Vector3()));
  const press=pianoHands(id,t)[note.hand].press,b=v.bones(id)[id];let thisSkinGap=Infinity;
  minClearance=Math.min(minClearance,...tips.map(p=>p.y-floor-KEYS));maxDrop=Math.max(maxDrop,b.pose.drop);maxKneel=Math.max(maxKneel,b.pose.kneel);samples++;
  const P=(name:string)=>holder.getObjectByName(name+side)!.getWorldPosition(new THREE.Vector3());
  const wrist=P('Wrist'),middle=P('Middle2'),fwd=middle.clone().sub(wrist).normalize(),across=P('Index2').sub(P('Pinky2'));across.addScaledVector(fwd,-across.dot(fwd)).normalize();
  const normal=side==='R'?fwd.clone().cross(across).normalize():across.clone().cross(fwd).normalize(),thumbRadial=P('Thumb3').sub(middle).dot(across);
  minPalmDown=Math.min(minPalmDown,-normal.y);minThumbRadial=Math.min(minThumbRadial,thumbRadial);
  for(const arm of b.arms){maxReach=Math.max(maxReach,new THREE.Vector3(...arm.shoulder).distanceTo(new THREE.Vector3(...arm.palm))/arm.len);maxGoalError=Math.max(maxGoalError,arm.err??0);}
  eachSkinnedWorld(handSkin(holder),new THREE.Vector3(),q=>{const depth=q.dot(forward),lateral=q.x*-forward.z+q.z*forward.x;if(depth>=.47&&depth<=.63&&Math.abs(lateral)<=.65){const top=depth>=.555&&depth<=.625?KEYS:.7925;if((lateral<0)===(side==='L'))thisSkinGap=Math.min(thisSkinGap,q.y-floor-top);if(floor+top-q.y>maxSkinPenetration){maxSkinPenetration=floor+top-q.y;worstSkin={p:q.toArray(),depth,top};}skinSamples++;}});
  assert.ok(tips.every(p=>p.dot(forward)>.46&&p.dot(forward)<.64),'fingers stay over actual keyboard depth');
  const error=Math.abs(thisSkinGap-(.002+.028*(1-press)));maxStrikeError=Math.max(maxStrikeError,error);assert.ok(error<.006,`${rig} ${side} score phase${age}: skin gap${thisSkinGap}, error${error}`);
 }
 const skinRefs=(v as unknown as {views:Map<string,{surf:{hand:Map<number,{idx:number[]}[]>}}>}).views.get(id)!.surf.hand;
 const runtimeHandVertices=[1,-1].map(side=>(skinRefs.get(side)??[]).reduce((n,r)=>n+r.idx.length,0));
 console.log(JSON.stringify({rig,height,yaw,floor,runtimeHandVertices,keySurface:KEYS,bench:BENCH,samples,maxStrikeError,minClearance,maxDrop,maxKneel,maxSkinPenetration,minPalmDown,minThumbRadial,maxReach,maxGoalError,skinSamples,worstSkin}));
 assert.ok(skinSamples>0,'actual full hand skin overlaps keyboard');assert.ok(maxSkinPenetration<=.006,`skin penetrates key surface by ${maxSkinPenetration}`);assert.ok(minPalmDown>.95,'both palms face down');assert.ok(minThumbRadial>0,'both thumbs stay on radial side');assert.ok(maxReach<=.98,'attained arm reach remains clamped');assert.ok(maxGoalError<.006,'actual palms attain the fitted goal');
 assert.equal(maxKneel,0,'seated piano has no kneel');assert.ok(maxDrop<=.03,'no knee dip');assert.ok(minClearance>=-.002,'no finger below key surface');
});

for(const rig of RIGS)for(const duration of [.1,.4,4])for(const activity of ['play-piano','play-music'])test(`piano arm boundaries (${rig},${duration}s,${activity}): early stop and seated return stay within .08 m per 50 ms and replay identically`,async()=>{
 const v=await views(rig),id='piano_boundary',stop=2000+Math.round(duration/.05);let prev:number[][]|null=null,worst=0,at=0,snapshot:{f:SampledHuman;t:number;palms:number[][]}|null=null;
 for(let k=1960;k<=stop+30;k++){
  const t=k*.05,playing=k>=2000&&k<stop,after=k>=stop;
  const f:SampledHuman={id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:playing?activity:'sit',baseActivity:playing?'sit':undefined,seatHeight:BENCH,...(playing?{instrument:'piano',activityAge:(k-2000)*.05,prevActivity:'sit'}:after?{activityAge:(k-stop)*.05,prevActivity:activity,prevBaseActivity:'sit',prevActivityDuration:duration,prevInstrument:'piano'}:{activityAge:20})};
  v.setFrame([f],t);v.render(1);const palms=v.bones(id)[id].arms.map(a=>a.palm);
  if(prev)for(let i=0;i<2;i++){const step=Math.hypot(...palms[i].map((x,j)=>x-prev![i][j]));if(step>worst){worst=step;at=t;}}prev=palms;
  if(k===stop+2)snapshot={f,t,palms};
 }
 const fresh=await views(rig);fresh.setFrame([snapshot!.f],snapshot!.t);fresh.render(1);const replay=fresh.bones(id)[id].arms.map(a=>a.palm);
 const replayError=Math.max(...replay.map((p,i)=>Math.hypot(...p.map((x,j)=>x-snapshot!.palms[i][j]))));
 console.log(JSON.stringify({rig,duration,activity,boundaryMaxPalmStep:worst,at,replayError}));assert.ok(worst<=.08,`piano boundary palm step ${worst} m at${at}s`);assert.ok(replayError<1e-6,'random access preserves attained entry weight at stop');
});

import {TakePeople} from '../../../mars/viewer/app/engine-view/take-replay.ts';
import {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import {emptyWorld,human} from '../../../mars/viewer/engine/world/factory.ts';
import {TakeRecorder} from '../../../mars/viewer/engine/take/recorder.ts';
import {openGround} from '../../../mars/viewer/engine/test/frame-fixtures.ts';
for(const activity of ['play-piano','play-music'])test(`recorded early piano stop (${activity}): take history retains duration/instrument and random access matches`,async()=>{
 const scene=openGround(),w=emptyWorld('piano-entry',scene),e=human('piano_take',0,0);w.entities[e.id]=e;e.human!.activity='sit';e.human!.seatHeight=BENCH;
 const rt=new Runtime(w,new Map(),{spatial:new Spatial(scene)},[]),rec=new TakeRecorder(rt,{rulesVersion:'piano-entry'});
 for(let k=0;k<50;k++){if(k===20){e.human!.activity=activity;e.human!.baseActivity='sit';e.human!.instrument='piano';}if(k===22){e.human!.activity='sit';delete e.human!.baseActivity;delete e.human!.instrument;}rt.step();}
 const take=rec.finish(),tpl=(await views('wire-woman') as unknown as {templates:Template[]}).templates;
 const sequential=new TakePeople(take);sequential.setTemplates(tpl);for(let k=0;k<=25;k++)sequential.show(k*.05);
 const fresh=new TakePeople(take);fresh.setTemplates(tpl);fresh.show(25*.05);
 const view=(fresh as unknown as {humans:{views:Map<string,{prevDuration?:number;prevInstrument?:string}>}}).humans.views.get(e.id)!;
 assert.ok(Math.abs(view.prevDuration!-.1)<1e-9,'recorded two-tick piano entry duration');assert.equal(view.prevInstrument,'piano');
 const a=sequential.bones(e.id)[e.id].arms,b=fresh.bones(e.id)[e.id].arms;
 assert.ok(a.every((arm,i)=>Math.hypot(...arm.palm.map((x,j)=>x-b[i].palm[j]))<1e-6),'fresh post-interruption replay equals sequential playback');
});

test('unrelated recorded drums: no piano instrument-history arrays or previous-duration metadata',async()=>{
 const scene=openGround(),w=emptyWorld('drum-history',scene),e=human('drummer',0,0);w.entities[e.id]=e;e.human!.activity='sit';
 const rt=new Runtime(w,new Map(),{spatial:new Spatial(scene)},[]),rec=new TakeRecorder(rt,{rulesVersion:'drum-history'});
 for(let k=0;k<30;k++){if(k===10){e.human!.activity='play-music';e.human!.baseActivity='sit';e.human!.instrument='drums';}if(k===12){e.human!.activity='sit';delete e.human!.baseActivity;delete e.human!.instrument;}rt.step();}
 const people=new TakePeople(rec.finish());people.setTemplates((await views('wire-woman') as unknown as {templates:Template[]}).templates);people.show(1);
 const state=people as unknown as {acts:Map<string,{it?:number[];iv?:unknown[]}>;humans:{views:Map<string,{prevDuration?:number;prevInstrument?:string}>}};
 assert.equal(state.acts.get(e.id)?.it,undefined);assert.equal(state.acts.get(e.id)?.iv,undefined);
 assert.equal(state.humans.views.get(e.id)?.prevDuration,undefined);assert.equal(state.humans.views.get(e.id)?.prevInstrument,undefined);
});
