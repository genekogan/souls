// Resource-free control/observation regressions; these injected cases are not browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {enableProofSound,beforeNavigation,hasProofPourOutput} from './garden-revival-proof.mjs';
import {WATERING_CAN} from '../../packages/world-compiler/src/core-kit/watering-can.ts';
import {emittersOf} from '../../apps/web/src/gen-mesh/sound-plan.ts';
function control(t,{muted=false,record=true,running=true}={}){
 let clicks=0;const previous={sound:globalThis.__edenSound,capture:globalThis.__proofAudioState};
 const state=()=>({muted,ctx:clicks&&running?'running':'none'});
 globalThis.__edenSound={state};globalThis.__proofAudioState=()=>clicks&&record?[{state:state().ctx,recorder:'recording',tracks:1,bytes:64}]:[];
 t.after(()=>{globalThis.__edenSound=previous.sound;globalThis.__proofAudioState=previous.capture;});
 const label=()=>muted?'Sound is off: turn on':'Sound is on: mute';
 const page={getByRole(role,{name}){const matching=()=>typeof name==='string'?name===label():name.test(label());
  const button={first:()=>button,getAttribute:async()=>label(),click:async()=>{assert.ok(matching());clicks++;muted=!muted;},waitFor:async()=>assert.ok(matching())};return button;},
  waitForFunction:async fn=>assert.ok(fn(),'audio readiness must be observed'),evaluate:async fn=>fn()};
 return{page,clicks:()=>clicks};
}
for(const muted of [false,true])test(`real sound control unlocks even when initial label is ${muted?'off':'on'}`,async t=>{
 const f=control(t,{muted}),checks=[];const audio=await enableProofSound(f.page,(key,ok)=>checks.push({key,ok}));
 assert.equal(f.clicks(),muted?1:2);assert.equal(audio.sound.muted,false);assert.equal(audio.sound.ctx,'running');assert.deepEqual(checks,[{key:'actual-audio-preflight',ok:true}]);
});
for(const missing of ['context','tracks'])test(`an on label cannot qualify missing actual ${missing}`,async t=>{
 const f=control(t,{running:missing!=='context',record:missing!=='tracks'});let qualified=false;
 await assert.rejects(enableProofSound(f.page,()=>{qualified=true;}),/audio readiness must be observed/);assert.equal(qualified,false);
});
test('cleanup preserves an empty audio diagnostic then refuses qualification',async t=>{
 const parent=resolve('.e2e/418');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'audio-regression-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'setup.json'),JSON.stringify({preparedAtEpochMs:Date.now()}));
 const previous=globalThis.window;globalThis.window={__proofAudioStop:async()=>[]};t.after(()=>{globalThis.window=previous;});
 const stop=await beforeNavigation({paths:{dir},page:{addInitScript:async()=>{},evaluate:async fn=>fn()}});
 await assert.rejects(stop(),/actual browser-output audio missing/);assert.deepEqual(JSON.parse(readFileSync(join(dir,'audio.json'))),[]);
});

test('pour output is associated with the actual planter emitter, not the carried can',()=>{
 for(const version of [2,3]){
  const planter=WATERING_CAN.find(d=>d.name==='core-garden-planter'&&d.version===version),can=WATERING_CAN[0];
  const model={entities:new Map([['bed',{id:'bed',def:'planter',in:{parent:'world'},state:{pouring:true}}],['can',{id:'can',def:'can',in:{parent:'world'}}]]),
   resolvedDef:ref=>ref==='planter'?planter:can,worldPose:()=>({x:0,y:0,z:0,s:1}),terrain:{sample:()=>0}};
  const pour=emittersOf(model).filter(e=>e.spec.kind==='water'&&e.spec.variant===3).map(e=>({id:e.id,kind:e.spec.kind,variant:e.spec.variant,gain:.5}));
  assert.equal(pour.length,1);assert.equal(pour[0].id,'bed');
  const frames=[{audio:{ctx:'running',rms:.03,pour}}];
  assert.equal(hasProofPourOutput(frames,'bed'),true);assert.equal(hasProofPourOutput(frames,'can'),false);
  frames[0].audio.rms=0;assert.equal(hasProofPourOutput(frames,'bed'),false);
 }
});
