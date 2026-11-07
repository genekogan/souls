#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {boot,addSoul,follow,stop,delay,ROOT} from '../mars-rotation/proof/lib.mjs';
import {openBrowser} from '../playtest/observer/browser.mjs';
const out=resolve(process.argv[2]),genesis=resolve(process.argv[3]);mkdirSync(out,{recursive:true});
let world,browser;
try{
 world=await boot({slug:'unified-follow',port:4994,template:genesis,out:out+'/world'});
 await addSoul(world,'Follow Journey');
 browser=await openBrowser({serverRoot:ROOT,gpu:'metal'});
 const cam=await browser.openCamera({base:world.base,kind:'follow',soulId:world.soulRec.id});
 if(!cam.follow.ok)throw Error(JSON.stringify(cam.follow));
 const page=cam.page;
 page.on('console',msg=>{if(msg.type()==='error')console.log('browser-error '+msg.text().slice(0,300));});
 await page.evaluate(()=>{
  window.__followProof={stage:'settling',frames:[],feet:[],footAt:0};
  function frame(timestamp=performance.now()){const w=window.__soulsEntity,p=window.__followProof;if(!p)return;
   if(w){const d=document.querySelector('.viewer-history')?.dataset;p.frames.push({at:timestamp,stage:p.stage,eye:w.camera.position.toArray(),target:w.controls.target.toArray(),distance:w.camera.position.distanceTo(w.controls.target),near:w.camera.near,mode:d?.viewerMode,residents:w.residents()});}
   if(w&&performance.now()-p.footAt>250){p.footAt=performance.now();w.scene.traverse(o=>{if(!o.isSkinnedMesh||o.name!=='shoes')return;let visible=true,parent=o;while(parent){visible&&=parent.visible;parent=parent.parent;}const v=o.position.clone();let minY=Infinity,maxY=-Infinity;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);}p.feet.push({at:p.footAt,stage:p.stage,visible,minY,maxY,residents:w.residents(),bones:o.skeleton.bones.filter(b=>/Foot/.test(b.name)).map(b=>({name:b.name,y:b.matrixWorld.elements[13]}))});});}
   requestAnimationFrame(frame);
  }frame();
 });
 const stage=async name=>{console.log(name);await page.evaluate(name=>window.__followProof.stage=name,name);};
 await delay(8000);await stage('idle');await delay(10000);await cam.shot(out+'/idle.png');
 await page.evaluate(()=>window.__soulsEntity.renderer.domElement.dataset.followProof='true');
 const canvas=page.locator('canvas[data-follow-proof]'),box=await canvas.boundingBox(),x=box.x+box.width*.45,y=box.y+box.height*.55;
 console.log(JSON.stringify(await page.evaluate(({x,y})=>({hit:document.elementFromPoint(x,y)?.tagName,canvas:window.__soulsEntity.renderer.domElement===document.elementFromPoint(x,y),controls:{enabled:window.__soulsEntity.controls.enabled,zoom:window.__soulsEntity.controls.enableZoom,rotate:window.__soulsEntity.controls.enableRotate}}),{x,y})));
 await stage('wheel');await page.mouse.move(x,y);await page.mouse.wheel(0,-350);await delay(2500);await cam.shot(out+'/wheel.png');
 await stage('drag');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+140,y-45,{steps:15});await page.mouse.up();await delay(2000);await cam.shot(out+'/drag.png');
 await stage('pinch');
 const cdp=await cam.context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-35,y,id:1},{x:x+35,y,id:2}]});
 for(let d=40;d<=90;d+=10)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-d,y,id:1},{x:x+d,y,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(2500);await cam.shot(out+'/pinch.png');
 const bodies=await page.evaluate(()=>{const out=[];window.__soulsEntity.scene.traverse(o=>{if(o.isSkinnedMesh){let p=o;const chain=[];while(p){chain.push({name:p.name,type:p.type,visible:p.visible,p:p.position.toArray(),scale:p.scale.toArray()});p=p.parent;}out.push({name:o.name,visible:o.visible,frustumCulled:o.frustumCulled,chain,bones:o.skeleton.bones.filter(b=>/Head|Foot|Hips/.test(b.name)).map(b=>({name:b.name,world:b.matrixWorld.elements.slice(12,15)}))});}});return out;});writeFileSync(out+'/bodies.json',JSON.stringify(bodies,null,2));
 const receipts=[];
 for(const [name,cap,options]of [['chiba-entry','walk:chiba',{}],['presenter-seat','sit:presenter-timber-box',{params:{seconds:1},seated:true}],['mimos-entry','walk:mimos',{}],['study-seat','sit:mimos/study-chair-4',{params:{seconds:1},seated:true}]]){
  await stage(name);const r=await follow(world,cap,{timeout:120000,...options});receipts.push(r);console.log(JSON.stringify(r));await delay(2500);await cam.shot(out+'/'+name+'.png');
 }
 await stage('seated-settle');await delay(20000);await stage('seated-idle');await delay(10000);
 const proof=await page.evaluate(()=>{const p=window.__followProof;delete window.__followProof;return p;});
 const summarize=name=>{const frames=proof.frames.filter(f=>f.stage===name),a=frames.slice(30),dist=a.map(f=>f.distance),steps=a.slice(1).map((f,i)=>Math.hypot(...f.eye.map((v,j)=>v-a[i].eye[j])));return{name,frames:frames.length,min:Math.min(...dist),max:Math.max(...dist),first:dist[0],last:dist.at(-1),maxFrameStep:Math.max(0,...steps),maxFrameStepAt60:Math.max(0,...steps.map((step,i)=>step*1000/Math.max(1,a[i+1].at-a[i].at)/60)),follow:frames.every(f=>f.mode==='follow')};};
 const summary={follow:cam.follow,stages:[...new Set(proof.frames.map(f=>f.stage))].map(summarize),receipts,errors:cam.errors};
 writeFileSync(out+'/frames.json',JSON.stringify(proof));writeFileSync(out+'/feet.json',JSON.stringify(proof.feet,null,2));
 const frames=name=>proof.frames.filter(f=>f.stage===name),last=name=>frames(name).at(-1),offset=f=>f.eye.map((v,i)=>v-f.target[i]),angle=(a,b)=>Math.acos(Math.min(1,Math.max(-1,a.reduce((n,v,i)=>n+v*b[i],0)/Math.hypot(...a)/Math.hypot(...b))));
 summary.checks={allFollow:summary.stages.every(s=>s.follow),idleStable:summary.stages.filter(s=>['idle','seated-idle'].includes(s.name)).every(s=>s.max-s.min<.01),wheel:Math.abs(last('wheel').distance-last('idle').distance)>.2,drag:angle(offset(last('wheel')),offset(last('drag')))>.05,pinch:Math.abs(last('pinch').distance-last('drag').distance)>.2,allJourneys:receipts.every(r=>r.ok),visibleFeet:proof.feet.length>50&&proof.feet.filter(f=>f.stage!=='settling').every(f=>f.visible&&Number.isFinite(f.minY)&&Number.isFinite(f.maxY)),feetAboveFloors:proof.feet.every(f=>f.minY-(f.residents[0]?.p[1]??f.minY)>=-.01),automaticGlide:summary.stages.filter(s=>['chiba-entry','presenter-seat','mimos-entry','study-seat','seated-settle'].includes(s.name)).every(s=>s.maxFrameStepAt60<.35),noPageErrors:cam.errors.length===0};
 writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 assert.ok(Object.values(summary.checks).every(Boolean),JSON.stringify(summary.checks));
}finally{await browser?.close();if(world)await stop(world);}
