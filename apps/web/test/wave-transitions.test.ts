import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf,type Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {HumanoidKit} from '../src/humanoid/compose.ts';
import {CHARACTER_WIRE} from '../../../mars/viewer/app/engine-view/character-wire.ts';
const DT=.05,ID='wave_boundary';
async function glb(file:string){
 const source=readFileSync(new URL('../../../mars/viewer/public/modular/environment/'+file,import.meta.url));
 const len=source.readUInt32LE(12),j=JSON.parse(source.subarray(20,20+len).toString()),bin=source.subarray(20+len);
 j.materials=j.materials?.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1]}}));delete j.textures;delete j.images;delete j.samplers;
 let json=Buffer.from(JSON.stringify(j));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const h=Buffer.from(source.subarray(0,20));h.writeUInt32LE(20+json.length+bin.length,8);h.writeUInt32LE(json.length,12);const b=Buffer.concat([h,json,bin]);
 return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
}
const templates=new Map<string,Template>();
async function views(rig:string){
 if(!templates.has(rig)){
  if(rig.startsWith('kit-')){const kit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(new URL('../../../mars/viewer/public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;});templates.set(rig,await kit.template({frame:rig.split('-')[1],preset:rig.split('-')[1]==='fem'?'woman':'casual',...(rig.endsWith('-low')?{height:1.65,build:.92}:rig.endsWith('-high')?{height:1.85,build:1.1}:{})} as never));}
  else{const wire=CHARACTER_WIRE[rig==='fallback'?'casual':rig as keyof typeof CHARACTER_WIRE],g=await glb(wire.mesh);g.animations=(await glb(wire.clips)).animations.filter(c=>rig!=='fallback'||c.name!=='Wave').map(c=>c.clone());templates.set(rig,templateFromGltf('wave-'+rig,g));}
 }
 const v=new HumanViews();v.setTemplates([templates.get(rig)!]);return v;
}
const dist=(a:number[],b:number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
for(const rig of (process.env.WAVE_RIGS??'casual,punk,woman,kit-masc,kit-fem,kit-masc-low,kit-masc-high,kit-fem-low,kit-fem-high,fallback').split(','))for(const start of [0, .35,1.1,10])for(const duration of [.1,.3,.8,2.4,5])for(const rest of [0,30])test(`wave ${rig} start ${start}s duration ${duration}s rest ${rest}s: full path <=0.08m/50ms`,async()=>{
 const v=await views(rig),end=start+duration,rows:{t:number;palms:number[][];weight:number}[]=[];
 for(let k=-10;k<=Math.round((duration+2.1)/DT);k++){
  const t=start+k*DT,active=k>=0&&t<end-1e-8;
  const f:SampledHuman={id:ID,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:active?'wave':'idle',restAge:k<0?rest:active?0:t-end,waveRestAge:rest+Math.max(0,t-start),...(active?{activityAge:k*DT,prevActivity:'idle'}:t>=end?{activityAge:t-end,prevActivity:'wave',prevWaveDuration:duration}:{})};
  v.setFrame([f],t);v.render(1);const state=(v as unknown as {views:Map<string,{rig:{extra:{wave:{getEffectiveWeight():number;isRunning():boolean;getClip():{duration:number}}}}}>}).views.get(ID)!;const w=state.rig.extra.wave;
  if(process.env.WAVE_DEBUG)console.log('frame',t-start,'clip',w?.getClip()?.duration,'w',w?.getEffectiveWeight(),v.bones(ID)[ID].arms.map(a=>a.palm));
  rows.push({t,palms:v.bones(ID)[ID].arms.map(a=>a.palm),weight:w?.isRunning()?w.getEffectiveWeight():0});
 }
 let max=0,at=0;for(let i=1;i<rows.length;i++)for(let j=0;j<2;j++){const d=dist(rows[i-1].palms[j],rows[i].palms[j]);if(d>max){max=d;at=rows[i].t-start;}}
 console.log(JSON.stringify({rig,start,duration,rest,maxPalmStep:max,at,firstWeight:rows.find(r=>Math.abs(r.t-start)<1e-8)!.weight}));
 assert.ok(max<=.08,`actual palm step ${max}m/50ms at ${at}s`);
 assert.equal(rows.find(r=>Math.abs(r.t-start)<1e-8)!.weight,0,'wave begins at zero attained weight');
});

import {TakePeople} from '../../../mars/viewer/app/engine-view/take-replay.ts';
import {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import {emptyWorld,human} from '../../../mars/viewer/engine/world/factory.ts';
import {TakeRecorder} from '../../../mars/viewer/engine/take/recorder.ts';
import {openGround} from '../../../mars/viewer/engine/test/frame-fixtures.ts';
import type {Take} from '../../../mars/viewer/engine/take/types.ts';
function recordedWave(duration:number){
 const scene=openGround(),w=emptyWorld('wave-history',scene),e=human(ID,0,0);w.entities[e.id]=e;
 const rt=new Runtime(w,new Map(),{spatial:new Spatial(scene)},[]),all=new TakeRecorder(rt,{rulesVersion:'wave-history'});let rec=new TakeRecorder(rt,{rulesVersion:'wave-history'});const chunks:Take[]=[];
 const start=17,end=start+Math.round(duration/DT);
 for(let k=0;k<160;k++){if(k===start)e.human!.activity='wave';if(k===end)e.human!.activity='idle';rt.step();if((k+1)%20===0){chunks.push(rec.finish());if(k<159)rec=new TakeRecorder(rt,{rulesVersion:'wave-history'});}}
 return{take:all.finish(),chunks};
}
for(const duration of [.1,.3,.8,2.4,5])test(`actual recorded wave ${duration}s: arbitrary seeks, chunks and attained release match full replay`,async()=>{
 await views('casual');const {take,chunks}=recordedWave(duration),full=new TakePeople(take),chunked=new TakePeople(chunks[0]);full.setTemplates([templates.get('casual')!]);chunked.setTemplates([templates.get('casual')!]);
 let max=0,prev:number[][]|undefined;
 for(let k=10;k<155;k++){
  const t=k*DT,c=chunks.find(c=>k>=c.startTick&&k<=c.startTick+c.ticks)!;full.show(t);chunked.setTake(c);chunked.setWaterHistory(chunks);chunked.show((k-c.startTick)*DT,t);
  const a=full.bones(ID)[ID].arms.map(a=>a.palm),b=chunked.bones(ID)[ID].arms.map(a=>a.palm);
  assert.ok(a.every((p,i)=>dist(p,b[i])<.0003),`chunk matches whole recording at tick${k}`);
  if(prev)for(let j=0;j<2;j++)max=Math.max(max,dist(prev[j],a[j]));prev=a;
  if(k%7===0){const fresh=new TakePeople(c);fresh.setTemplates([templates.get('casual')!]);fresh.setWaterHistory(chunks);fresh.show((k-c.startTick)*DT,t);const f=fresh.bones(ID)[ID].arms;assert.ok(a.every((p,i)=>dist(p,f[i].palm)<.0003),'fresh random seek matches sequential');}
 }
 console.log(JSON.stringify({recordedDuration:duration,fullPathMax:max}));assert.ok(max<=.08,`actual recorded full path ${max}m/50ms`);
});

function waveSequence(spans:[number,number][]){
 const scene=openGround(),w=emptyWorld('wave-reentry',scene),e=human(ID,0,0);w.entities[e.id]=e;
 const rt=new Runtime(w,new Map(),{spatial:new Spatial(scene)},[]),all=new TakeRecorder(rt,{rulesVersion:'wave-reentry'});let rec=new TakeRecorder(rt,{rulesVersion:'wave-reentry'});const chunks:Take[]=[];
 for(let k=0;k<240;k++){e.human!.activity=spans.some(([a,b])=>k>=a&&k<b)?'wave':'idle';rt.step();if((k+1)%20===0){chunks.push(rec.finish());if(k<239)rec=new TakeRecorder(rt,{rulesVersion:'wave-reentry'});}}
 return{take:all.finish(),chunks};
}
for(const rig of ['casual','woman','kit-masc','kit-fem','fallback'])for(const gap of [2,16,34])test(`rapid wave re-entry ${rig}, gap ${gap*DT}s: no lost outgoing pose, exact chunks and seeks`,async()=>{
 await views(rig);const {take,chunks}=waveSequence([[17,65],[65+gap,113+gap]]),full=new TakePeople(take),part=new TakePeople(chunks[0]);full.setTemplates([templates.get(rig)!]);part.setTemplates([templates.get(rig)!]);let max=0,prev:number[][]|undefined;
 for(let k=10;k<220;k++){
  const t=k*DT,c=chunks.find(c=>k>=c.startTick&&k<=c.startTick+c.ticks)!;full.show(t);part.setTake(c);part.setWaterHistory(chunks);part.show((k-c.startTick)*DT,t);
  const a=full.bones(ID)[ID].arms.map(a=>a.palm),b=part.bones(ID)[ID].arms.map(a=>a.palm);assert.ok(a.every((p,i)=>dist(p,b[i])<.0003),`rapid chunks equal at${k}`);
  if(prev)for(let j=0;j<2;j++)max=Math.max(max,dist(prev[j],a[j]));prev=a;
  if(k%13===0){const fresh=new TakePeople(c);fresh.setTemplates([templates.get(rig)!]);fresh.setWaterHistory(chunks);fresh.show((k-c.startTick)*DT,t);assert.ok(a.every((p,i)=>dist(p,fresh.bones(ID)[ID].arms[i].palm)<.0003),`rapid random seek equals sequential at${k}, ${rig}, gap${gap}: ${JSON.stringify(a.map((p,i)=>dist(p,fresh.bones(ID)[ID].arms[i].palm)))}`);}
 }
 console.log(JSON.stringify({rapidRig:rig,gap:gap*DT,fullPathMax:max}));assert.ok(max<=.08,`rapid full path ${max}m/50ms`);
});
for(const boundary of ['version','gap','ambiguous'])test(`wave history rejects ${boundary} predecessor without inheriting its wave`,()=>{
 const {chunks}=recordedWave(.1),own=structuredClone(chunks[1]),prev=structuredClone(chunks[0]);
 if(boundary==='version')prev.rulesVersion+='-foreign';
 if(boundary==='gap')prev.startTick--;
 const history=boundary==='ambiguous'?[prev,{...prev,id:prev.id+'-duplicate'},own]:[prev,own];
 const p=new TakePeople(own);p.setWaterHistory(history);const state=p as unknown as {waveActs:Map<string,unknown>;activityHistory(id:string,tick:number,act:string,w:number):SampledHuman};assert.equal(state.waveActs.size,0,'no compatible earlier wave crosses rejected boundary');
 assert.deepEqual(state.activityHistory(ID,1,'idle',0).waveSamples??[],[],'no foreign release is published to renderer');
});

test('never-wave forward history updates do not rescan older recorded changes after discovery',()=>{
 const {chunks}=waveSequence([]);let reads=0;const old=chunks[0],changes=old.changes;Object.defineProperty(old,'changes',{get(){reads++;return changes;}});
 const p=new TakePeople(chunks[5]);p.setWaterHistory(chunks);reads=0;p.setTake(chunks[6]);p.setWaterHistory(chunks);
 assert.equal(reads,0,'old unrelated change stream is cached, not scanned by every history update');
 assert.equal((p as unknown as {waveActs:Map<string,unknown>}).waveActs.size,0);
});

for(const owner of ['hands','grip','handHold','rps','heldItemsV1','on'])test(`recorded ${owner} owner cancels old wave tail through its later idle release`,()=>{
 const {take}=waveSequence([[17,65]]);const fixture=structuredClone(take);
 fixture.changes.push([70,ID,owner,owner==='hands'?{right:[100,1000,0]}:owner==='heldItemsV1'?{right:'fixture-item'}:owner==='on'?'fixture-seat':{with:'fixture-partner',entity:'fixture-item'}],[74,ID,owner,null]);fixture.changes.sort((a,b)=>a[0]-b[0]);
 const p=new TakePeople(fixture),h=p as unknown as {activityHistory(id:string,tick:number,act:string,w:number):SampledHuman};
 assert.ok(h.activityHistory(ID,68,'idle',0).waveSamples?.length,'tail exists before new owner');
 assert.deepEqual(h.activityHistory(ID,75,'idle',0).waveSamples??[],[],'old wave does not resume after owner clears');
});
