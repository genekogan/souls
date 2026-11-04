// Committed custom journey for runOwnedAttempt. All credentials and operational observations stay in ignored runs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CAN_GRIP, HOOK_PEG } from '../../packages/world-compiler/src/index.ts';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),exec=promisify(execFile);
const save=(paths,name,value)=>writeFileSync(join(paths.dir,name),JSON.stringify(value,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(base,path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(`${path}: ${r.status} ${JSON.stringify(d)}`);return d;}
async function cli(paths,...args){const cwd=join(paths.dir,'soul');mkdirSync(cwd,{recursive:true});const {stdout}=await exec(process.execPath,[join(ROOT,'tools/edge-skill/eden-agent.mjs'),...args],{cwd,env:{...process.env,EDEN_AGENT_NO_DASHBOARD:'1'},timeout:15000});return JSON.parse(stdout);}
const entities=s=>Array.isArray(s.entities)?s.entities:Object.values(s.entities??{});

export async function prepare({base,paths,arm,signal}){
 const baseline=arm==='baseline',owner=await api(base,'/v1/god/mint','dev:garden-proof',{label:'garden-proof'});
 await api(base,'/v1/god/env',owner.token,{timeOfDay:'12:00',timeScale:0,weather:{kind:'clear',wind:0}});
 await cli(paths,'register',base);const created=await cli(paths,'create-soul','Ana','A gardener demonstrating admitted native watering.');
 await cli(paths,'body','look','--set','frame=masc','preset=casual','height=1.75','build=1.0');
 const agent=JSON.parse(readFileSync(join(paths.dir,'soul/.eden-agent.json'),'utf8'));
 let body;for(let i=0;i<60;i++){signal.throwIfAborted();const w=await api(base,'/v1/debug/world');body=Object.values(w.entities).find(e=>e.label==='Ana'&&e.human);if(body)break;await pause(100);}if(!body)throw Error('native body not ready');
 const [x,,z]=body.pose.p,version=baseline?2:3;
 const admitted=await api(base,'/v1/god/act',owner.token,{ops:[
  {op:'place',def:'core/can-hook@1',tmp:'$hook',name:'can-hook',p:[x+1.8,z-1.5]},
  {op:'place',def:'core/watering-can@2',tmp:'$can',name:'watering-can',in:{parent:'$hook'},p:HOOK_PEG.map((v,i)=>v-CAN_GRIP[i]),r:Math.PI/2,state:{level:1}},
  {op:'place',def:`core/garden-planter@${version}`,tmp:'$bed',name:'rose-bed',p:[x+.6,z+2.6],state:{moisture:.1,growth:4,thirst:0,...(!baseline?{biologyEnabled:true,biologyHour:6,biologyWilt:.2,biologyTarget:1,biologyMoisture:.1,biologyGrowth:4}:{})}},
  {op:'place',def:`core/garden-planter@${version}`,tmp:'$control',name:'unflagged-bed',p:[x-1.2,z+2.6],state:{moisture:1,growth:4,thirst:0}}
 ]});if(!admitted.accepted)throw Error(JSON.stringify(admitted));
 const plantId=admitted.ids.$bed,controlId=admitted.ids.$control,canId=admitted.ids.$can;
 if(![plantId,controlId,canId].every(id=>typeof id==='string'&&id.length))throw Error('admitted fixture IDs missing');
 let near;for(let i=0;i<60;i++){signal.throwIfAborted();near=await api(base,'/v1/edge/here?include=doHere',agent.token);if(JSON.stringify(near).includes('rose-bed'))break;await pause(100);}
 const before=await api(base,'/v1/god/snapshot',owner.token),controlBefore=entities(before).find(e=>e.id===controlId)?.state;
 if(!controlBefore||controlBefore.moisture!==1||controlBefore.growth!==4)throw Error('unflagged control snapshot missing or inconsistent');
 const environment=await api(base,'/v1/world/env');if(environment.time?.paused!==true||environment.time.clock!=='12:00')throw Error('prepared clock is not paused noon');
 const far=await api(base,'/v1/god/act',owner.token,{ops:Array.from({length:100},(_,i)=>({op:'place',def:'core/garden-planter@2',name:`far-bed-${i}`,p:[x+120+i%10*2,z+120+Math.floor(i/10)*2],state:{moisture:1,growth:4,thirst:0}}))});if(!far.accepted)throw Error(JSON.stringify(far));
 await pause(500);const distant=await api(base,'/v1/edge/here?include=doHere',agent.token);
 const setup={base,arm,soulId:created.soul.id,actorId:body.id,plantId,controlId,canId,x,z,ownerToken:owner.token,agentToken:agent.token,controlBefore,
  hereBytes:{near:JSON.stringify(near.here).length,distant100:JSON.stringify(distant.here).length},initialWilt:baseline ? .35 : .2,clock:'prepared paused at noon; continuously admitted60s/world-day during filmed journey',preparedAtEpochMs:Date.now()};
 save(paths,'setup.json',setup);return setup;
}

// Observation-only tee of actual AudioContext destination output, retained from the accepted audio capture recipe.
function installAudioObserver(){
 const captures=[],byContext=new WeakMap(),connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;
 const ensure=ctx=>{let c=byContext.get(ctx);if(c)return c;const sink=ctx.createMediaStreamDestination(),chunks=[],recorder=new MediaRecorder(sink.stream,{mimeType:'audio/webm;codecs=opus'}),meta={sampleRate:ctx.sampleRate,stateAtStart:ctx.state,requestEpochMs:Date.now(),contextTimeAtStart:ctx.currentTime};c={ctx,sink,recorder,chunks,meta};captures.push(c);byContext.set(ctx,c);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstart=()=>{meta.startEventEpochMs=Date.now();};recorder.start(250);return c;};
 AudioNode.prototype.connect=function(destination,...args){const result=Reflect.apply(connect,this,[destination,...args]);if(destination===this.context.destination){const c=ensure(this.context);Reflect.apply(connect,this,[c.sink,...args]);}return result;};
 AudioNode.prototype.disconnect=function(...args){const result=Reflect.apply(disconnect,this,args),c=byContext.get(this.context);if(c&&args[0]===this.context.destination){try{Reflect.apply(disconnect,this,[c.sink,...args.slice(1)]);}catch{}}return result;};
 window.__proofAudioState=()=>captures.map(c=>({state:c.ctx.state,recorder:c.recorder.state,tracks:c.sink.stream.getAudioTracks().length,bytes:c.chunks.reduce((n,b)=>n+b.size,0)}));
 window.__proofAudioStop=async()=>{const out=[];for(const c of captures){c.meta.stopRequestEpochMs=Date.now();await new Promise(resolve=>{c.recorder.onstop=resolve;c.recorder.stop();});const blob=new Blob(c.chunks,{type:c.recorder.mimeType}),base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});out.push({meta:c.meta,mime:c.recorder.mimeType,bytes:blob.size,base64});}return out;};
}
export async function beforeNavigation({page,paths}){
 const setup=JSON.parse(readFileSync(join(paths.dir,'setup.json'),'utf8'));
 save(paths,'capture-origin.json',{videoStartEpochBoundsMs:[setup.preparedAtEpochMs,Date.now()],viewport:{width:1920,height:1080},capture:'Native video plus actual browser-output audio; no playback or listening inference.'});
 await page.addInitScript(installAudioObserver);
 // Enable the existing observation-only shot camera before app initialization. No actor/physics state is touched.
 await page.addInitScript(()=>{const u=new URL(location.href);if(u.pathname.includes('/w/')){u.searchParams.set('shot','1');history.replaceState(null,'',u);}});
 return async()=>{const audio=await page.evaluate(()=>window.__proofAudioStop?.()??[]);const tracks=[];for(const [i,a]of audio.entries()){if(a.bytes)writeFileSync(join(paths.dir,`raw-audio-${i}.webm`),Buffer.from(a.base64,'base64'));tracks.push({...a,base64:undefined,file:a.bytes?`raw-audio-${i}.webm`:null});}save(paths,'audio.json',tracks);if(!tracks.some(a=>a.bytes>0))throw Error('actual browser-output audio missing');};
}

// A default on label describes settings, not browser gesture unlock. Always use the actual control.
export async function enableProofSound(page,check){
 const sound=page.getByRole('button',{name:/^Sound is/}).first();
 if((await sound.getAttribute('aria-label')).startsWith('Sound is on:'))await sound.click();
 await page.getByRole('button',{name:'Sound is off: turn on'}).click();
 await page.getByRole('button',{name:'Sound is on: mute'}).waitFor();
 await page.waitForFunction(()=>globalThis.__edenSound?.state().ctx==='running',undefined,{timeout:8000});
 await page.waitForFunction(()=>globalThis.__proofAudioState?.().some(a=>a.state==='running'&&a.recorder==='recording'&&a.tracks>0&&a.bytes>0),undefined,{timeout:8000});
 const audio=await page.evaluate(()=>({sound:globalThis.__edenSound.state(),capture:globalThis.__proofAudioState()}));
 check('actual-audio-preflight',audio.sound.ctx==='running'&&!audio.sound.muted&&audio.capture.some(a=>a.state==='running'&&a.tracks>0&&a.bytes>0));
 return audio;
}

export const hasProofPourOutput=(frames,plantId)=>frames.some(f=>f.audio?.ctx==='running'&&f.audio.rms>0&&f.audio.pour?.some(v=>v.id.split('#')[0]===plantId&&v.gain>0));

export default async function journey({page,paths,fixture:s,check,signal}){
 const baseline=s.arm==='baseline',events=[],frames=[],errors=[];let sequence=0;
 const mark=async(phase,detail={})=>{events.push({sequence:++sequence,epochMs:Date.now(),phase,...detail});save(paths,'journey.json',events);await page.evaluate(({phase,arm,wilt})=>{const e=document.getElementById('garden-proof-caption');if(e)e.textContent=`${arm} | seeded partial wilt≈${wilt}\n60 real seconds/world day | continuous native clock\n${phase}`;},{phase,arm:s.arm,wilt:s.initialWilt});};
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(String(e)));
 await page.locator('[data-viewer-ready="true"]').waitFor({timeout:30000});
 await page.waitForFunction(()=>document.title==='ready');
 await page.evaluate(({x,z})=>globalThis.__simEntity.shotCamera([x+3.9,3.2,z+6.6],[x+.1,.8,z+1.2]),s);
 // The standard shot canvas covers overlays. Temporarily expose the real Sound button for its trusted UI gesture.
 await page.evaluate(()=>{globalThis.__simEntity.renderer.domElement.style.zIndex='0';});
 save(paths,'audio-preflight.json',await enableProofSound(page,check));
 await page.evaluate(({arm,initialWilt})=>{globalThis.__simEntity.renderer.domElement.style.zIndex='2147483000';const el=document.createElement('div');el.id='garden-proof-caption';el.style.cssText='position:fixed;left:18px;bottom:50px;z-index:2147483647;white-space:pre;background:rgba(0,0,0,.78);color:white;padding:10px 14px;font:18px monospace;pointer-events:none';el.textContent=`${arm} | seeded partial wilt≈${initialWilt}\n60 real seconds/world day | native continuous clock\nDRYING → REAL WATERING → REVIVING`;document.body.append(el);},s);
 check('distant-planters-here-bytes',s.hereBytes.near===s.hereBytes.distant100,JSON.stringify(s.hereBytes));
 const start=Date.now();await mark('DRYING · continuous clock begins',{initialWilt:s.initialWilt});
 const running=await api(s.base,'/v1/god/env',s.ownerToken,{timeScale:1440});check('admitted-clock',running.accepted===true);
 await page.evaluate(()=>{window.__gardenFrames=[];let last;const sample=t=>{if(last!==undefined)window.__gardenFrames.push(t-last);last=t;window.__gardenRaf=requestAnimationFrame(sample);};window.__gardenRaf=requestAnimationFrame(sample);});
 async function sample(){signal.throwIfAborted();const frame=await page.evaluate(({plantId,controlId,actorId,baseline})=>{
  const d=globalThis.__simEntity,layer=d?.layer,recorded=layer?.recordedPlanters?.group;
  const root=baseline?layer?.drawn?.get(plantId)?.obj:recorded?.getObjectByName('recorded planter '+plantId);
  const controlRoot=layer?.drawn?.get(controlId)?.obj,plants=root?.getObjectByName('plant growth'),controlPlants=controlRoot?.getObjectByName('plant growth'),f=d?.transportFrame?.();
  const project=(o,dy)=>{if(!o)return null;const v=new d.camera.position.constructor();o.getWorldPosition(v);v.y+=dy;return v.project(d.camera).toArray();};
  const audio=globalThis.__edenSound,state=audio?.state();
  return{audio:{ctx:state?.ctx,rms:audio?.level(),pour:state?.voices?.filter(v=>v.kind==='water'&&v.variant===3)},tick:f?.tick,dt:f?.dt,look:plants?.userData.look,controlLook:controlPlants?.userData.look,plantNdc:project(root,.6),controlNdc:project(controlRoot,.6),plantTopNdc:project(root,1.2),plantBottomNdc:project(root,.1),actor:f?.entities?.[actorId],stats:d?.stats?.(),camera:window.__shotCamera};
 },{...s,baseline});frames.push({epochMs:Date.now(),...frame});save(paths,'frames.json',frames);return frame;}
 const first=await sample();check('both-planters-visible',!!first.look&&!!first.controlLook&&[first.plantNdc,first.controlNdc].every(p=>p&&Math.abs(p[0])<.9&&Math.abs(p[1])<.9&&p[2]>-1&&p[2]<1));
 check('native-close-framing',Math.abs(first.plantTopNdc[1]-first.plantBottomNdc[1])*540>=100);await page.screenshot({path:join(paths.dir,'stage-drying.png')});
 while(Date.now()-start<6000){await sample();await page.waitForTimeout(250);}
 const dry=await sample();await mark('WATERING · real Soul input',{before:dry.look});
 const admission=await api(s.base,'/v1/edge/act',s.agentToken,{capability:`object:${s.plantId}:water`});check('native-water-admitted',admission.accepted===true,JSON.stringify(admission));await mark('WATERING · native action admitted',{receiptId:admission.receipt.id});
 let completed=false,contact=false,healthy=false,lastWilt=dry.look.w,progress=0;
 while(Date.now()-start<74000){
  const f=await sample(),receipt=(await api(s.base,`/v1/edge/receipts/${encodeURIComponent(admission.receipt.id)}`,s.agentToken)).receipt;
  check('native-receipt-active',!['failed','cancelled','replaced'].includes(receipt.phase),JSON.stringify(receipt));
  if(!contact&&f.look.m>dry.look.m+.1){contact=true;await mark(baseline?'REVIVAL · legacy immediate change':'REVIVING · gradual72h normalization',{look:f.look});await page.screenshot({path:join(paths.dir,'stage-contact.png')});if(!baseline)check('no-instant-revival',f.look.w>dry.look.w-.01,JSON.stringify({dry:dry.look,contact:f.look}));}
  if(receipt.phase==='completed'&&!completed){completed=true;await mark('REVIVING · native watering and return complete');}
  if(contact&&f.look.w<lastWilt-.0001)progress++;lastWilt=f.look.w;
  if(contact&&completed&&f.look.w<.005&&!healthy){healthy=true;await mark('HEALTHY · reached on continuous clock',{look:f.look});await page.screenshot({path:join(paths.dir,'stage-healthy.png')});}
  if(healthy&&(!baseline||Date.now()-start>=70000))break;
  await page.waitForTimeout(250);
 }
 check('actual-pour-output-observed',hasProofPourOutput(frames,s.plantId));
 check('actual-water-contact',contact);check('native-water-completed',completed);check('healthy-in-continuous-journey',healthy);
 if(!baseline)check('multiple-gradual-recovery-samples',progress>15,String(progress));
 const final=await api(s.base,'/v1/god/snapshot',s.ownerToken),controlAfter=entities(final).find(e=>e.id===s.controlId)?.state;
 check('unflagged-control-retained',!!controlAfter);
 if(!baseline)check('complete-unflagged-state-unchanged',JSON.stringify(controlAfter)===JSON.stringify(s.controlBefore));
 await page.waitForTimeout(1500);await sample();
 const intervals=await page.evaluate(()=>{cancelAnimationFrame(window.__gardenRaf);return window.__gardenFrames;});
 save(paths,'measurements.json',{arm:s.arm,hereBytes:s.hereBytes,frameIntervalsMs:intervals,events,initialLook:first.look,finalLook:frames.at(-1).look,controlBefore:s.controlBefore,controlAfter,consoleErrors:errors,realSeconds:(Date.now()-start)/1000});
 check('console-clean',errors.length===0,JSON.stringify(errors));await mark('HEALTHY · journey complete');
}
