// Entry 37: a radio's stations are pure functions of (station, depicted world seconds); the needle and the tuning knob
// follow the station on the hand's clock, the panel light and the dial glow while it is on.
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {WorldModel,coreLibrary,applyBatch,contactStateKey} from '@souls/world-compiler';import {meshFor} from './gen-mesh/registry.ts';import './gen-mesh/kit.mesh.ts';import {MaterialLib} from './gen-mesh/materials.ts';
import {beginOpeningMotion,stepOpeningMotion,NEEDLE_SWEEP_MS} from './opening-motion.ts';import {lightDiffAhead} from './light-diff-clock.ts';
import {RADIO_STATIONS,stationEvents,tuneMix,TUNE,TALK_TURN} from './gen-mesh/radio-stations.ts';
import {RADIO_STATIONS as DEF_STATIONS} from '../../../packages/world-compiler/src/core-kit/hand-music.ts';
import {RADIO_NEEDLE_STEP} from './gen-mesh/vocab-look.ts';

const key=(e:{t:number;kind:string})=>`${e.t.toFixed(4)}:${e.kind}:${JSON.stringify(e)}`;
test('stations: the same events for every viewer and every radio on the station; windows compose; three distinct streams',()=>{
 assert.deepEqual([...RADIO_STATIONS],[...DEF_STATIONS],'the dial order is the def\'s station enum');
 for(const s of RADIO_STATIONS){
  const all=stationEvents(s,300,316);assert.ok(all.length>30,`${s}: a real stream (${all.length})`);
  assert.deepEqual(all.map(key),stationEvents(s,300,316).map(key),'a pure function of world time');
  assert.deepEqual(stationEvents(s,300,308).concat(stationEvents(s,308,316)).map(key),all.map(key),'scheduling windows cannot change or repeat an event');
  assert.ok(all.every(e=>e.t>=300&&e.t<316));
 }
 const kinds=(s:string)=>[...new Set(stationEvents(s,0,30).map(e=>e.kind))].sort().join(',');
 assert.equal(kinds('quiet piano'),'key');assert.equal(kinds('dance band'),'bass,hat,kick,lead,snare');assert.equal(kinds('evening talk'),'syl');
 // the piano is slower than the band: its notes sit on a 0.4 s grid
 assert.ok(stationEvents('quiet piano',0,30).every(e=>Math.abs(e.t/0.4-Math.round(e.t/0.4))<1e-6));
 // talk: two voices take turns, with a breath at the end of each turn and gaps between words
 const talk=stationEvents('evening talk',700,700+TALK_TURN*4) as {t:number;f0:number}[];
 const turns=[0,1,2,3].map(i=>talk.filter(e=>e.t>=700+i*TALK_TURN&&e.t<700+(i+1)*TALK_TURN));
 const voice=(xs:{f0:number}[])=>xs.reduce((a,e)=>a+e.f0,0)/xs.length;
 assert.ok(Math.abs(voice(turns[0])-voice(turns[1]))>50,'a lower and a higher voice alternate');
 const gaps=talk.slice(1).map((e,i)=>e.t-talk[i].t);assert.ok(gaps.filter(g=>g>0.3).length>=4,'gaps between words');assert.ok(Math.max(...gaps)>0.7,'a breath between turns');
});
test('tuning: the old station fades, static covers the gap, the new station locks in',()=>{
 assert.deepEqual(tuneMix(-0.1),{from:1,static:0,to:0});
 const at=(s:number)=>tuneMix(s);
 assert.equal(at(TUNE.fromOut).from,0);assert.equal(at(0.2).static,1);assert.equal(at(TUNE.toIn).to,0);assert.equal(at(TUNE.toLocked).to,1);assert.equal(at(TUNE.staticOut).static,0);
 for(let s=0;s<=1;s+=0.01){const m=at(s);assert.ok(m.from+m.static+m.to>0.45,`never silent mid-tune (${s.toFixed(2)})`);}
 assert.ok(NEEDLE_SWEEP_MS/1000>=TUNE.staticOut-0.05&&NEEDLE_SWEEP_MS/1000<=TUNE.toLocked+0.1,'the needle sweeps while the static plays');
});
function fixture(){const model=new WorldModel({constants:{ground:'land'},seed:'radio'});model.library=coreLibrary();const r=applyBatch(model,{ops:[{op:'place',def:'core/radio@2',name:'radio',p:[0,0]}]},'god',1);assert.equal(r.result.accepted,true);const e=model.get('radio')!,def=model.resolvedDef(e.def)!;
 const draw=(on:boolean,station:string)=>meshFor(def)!.build({def,entity:{...e,state:{...e.state,on,station}},params:Object.fromEntries(Object.entries(def.params).flatMap(([k,v])=>v.default===undefined?[]:[[k,v.default]])),args:def.make.kind==='gen'?def.make.args??{}:{},baked:model.bake(def,e.params??{},e.seed??0),model,materials:new MaterialLib(),tint:(k,fallback)=>def.palette?.[k??'']??fallback})!;return {model,e,def,draw};}
const glowing=(o:THREE.Object3D)=>{let n=0;o.traverse(c=>{const m=(c as THREE.Mesh).material as THREE.MeshStandardMaterial|undefined;if((c as THREE.Mesh).isMesh&&m?.emissive&&m.emissiveIntensity>0&&m.emissive.getHex()!==0)n++;});return n;};
test('radio: the needle sits at its station\'s mark and sweeps there on a change; the knob turns; the panel lights while on',()=>{
 const f=fixture();assert.equal(contactStateKey(f.def,'change-station'),'on');
 const a=f.draw(true,'quiet piano'),b=f.draw(true,'dance band'),c=f.draw(true,'evening talk');
 const nx=(o:THREE.Object3D)=>o.getObjectByName('role:needle')!.position.x,kz=(o:THREE.Object3D)=>o.getObjectByName('role:knob')!.rotation.z;
 assert.ok(Math.abs(nx(b)-0.11)<1e-9,'the middle station at the dial centre');assert.ok(Math.abs(nx(a)-(0.11-RADIO_NEEDLE_STEP))<1e-9);assert.ok(Math.abs(nx(c)-(0.11+RADIO_NEEDLE_STEP))<1e-9);
 assert.ok(kz(a)===0&&kz(b)<-1&&kz(c)<kz(b),'the tuning knob turns further for each station');
 // the station change waits for the depicted contact like on/off does
 const msg={by:'engine',tick:200,diff:{upserts:[{...f.e,state:{...f.e.state,on:false,station:'dance band'}}]}};assert.equal(lightDiffAhead(f.model,msg,199),true);assert.equal(lightDiffAhead(f.model,msg,200),false);
 const tween=beginOpeningMotion(b,a,1000)!;assert.ok(tween,'a station change tweens');assert.equal(nx(b),nx(a),'starts where the needle was');
 let last=nx(b),steps=0;for(let t=1000;t<=1000+NEEDLE_SWEEP_MS;t+=50){stepOpeningMotion(tween,t);const d=nx(b)-last;assert.ok(d>=-1e-12&&d<RADIO_NEEDLE_STEP*0.2,`a sweep, not a jump (${d})`);last=nx(b);steps++;}
 assert.ok(Math.abs(nx(b)-0.11)<1e-9,'locks at the mark');assert.equal(stepOpeningMotion(tween,1000+NEEDLE_SWEEP_MS+50),false);assert.ok(steps>=15);
 assert.equal(beginOpeningMotion(f.draw(true,'dance band'),b,3000),undefined,'no idle tween');
 const lit=f.draw(true,'dance band'),glow=lit.getObjectByName('kit:glow') as THREE.Mesh;assert.equal(glowing(lit),1,'one glow draw while on');
 glow.geometry.computeBoundingBox();const bb=glow.geometry.boundingBox!;assert.ok(bb.min.y<1.13&&bb.max.y>1.28,`the glow holds the dial window and the panel light (${bb.min.y.toFixed(3)}..${bb.max.y.toFixed(3)})`);
 assert.equal(glowing(f.draw(false,'dance band')),0,'dark while off');
});
