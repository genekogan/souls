#!/usr/bin/env node
// Local-only fixed-framing temporal diagnosis. Same scene/camera/quality and initial
// sun angle, comparing the ordinary advancing clock, paused clock, and no shadows.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {boot,stop,delay,ROOT} from '../mars-rotation/proof/lib.mjs';
import {openBrowser} from '../playtest/observer/browser.mjs';
const out=resolve(process.argv[2]),genesis=resolve(process.argv[3]);mkdirSync(out,{recursive:true});
let world,browser;
try{
 world=await boot({slug:'unified-temporal',port:4994,template:genesis,out:out+'/world'});
 browser=await openBrowser({serverRoot:ROOT,gpu:'metal'});
 const context=await browser.browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const results=[];
 for(const [i,mode]of (process.argv[4]??'moving,frozen,no-shadows').split(',').entries()){
  if(!['moving','frozen','no-shadows'].includes(mode))throw Error('unknown temporal condition');
  const r=await world.api('/v1/god/act',{body:{ops:[{op:'world',state:{time:{set:{hour:12,n:i+100},paused:mode==='frozen'},weather:{kind:'clear',clouds:0,wind:0,rain:0,fog:0}}}]}});
  if(!r.accepted)throw Error(JSON.stringify(r));
  await delay(1000);
  await page.goto(world.base+'/?shot=1&eye=-20,18,8&at=-14,1,-26',{timeout:120000});
  await page.waitForFunction(()=>window.__soulsEntity&&document.title==='ready',{timeout:120000});
  await delay(3000);
  const result=await page.evaluate(async mode=>{
   const{renderer,scene,camera,controls}=window.__soulsEntity;
   renderer.shadowMap.enabled=mode!=='no-shadows';
   const light=scene.children.find(x=>x.isDirectionalLight&&x.castShadow);
   const stream=renderer.domElement.captureStream(30),chunks=[],samples=[];
   const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:10000000});
   rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   const regions={roof:[530,250,270,100],panels:[520,470,240,110],ground:[50,300,180,180]};
   const measures=Object.fromEntries(Object.entries(regions).map(([name,[x,y,w,h]])=>[name,{x,y,w,h,pixels:new Uint8Array(w*h*4),sum:new Float64Array(w*h),sq:new Float64Array(w*h),last:null,n:0,delta:0,large:0,alpha:0}]));
   const gl=renderer.getContext();let readAt=0;
   const start=performance.now();let raf;
   function readback(){
    const ms=performance.now()-start;
    if(ms>4000&&ms-readAt>=32&&renderer.getRenderTarget()===null){readAt=ms;
     for(const m of Object.values(measures)){
      gl.readPixels(m.x,renderer.domElement.height-m.y-m.h,m.w,m.h,gl.RGBA,gl.UNSIGNED_BYTE,m.pixels);
      const values=new Float32Array(m.w*m.h);let d=0,large=0,alpha=0;
      for(let i=0;i<values.length;i++){const j=i*4,v=.2126*m.pixels[j]+.7152*m.pixels[j+1]+.0722*m.pixels[j+2];values[i]=v;m.sum[i]+=v;m.sq[i]+=v*v;alpha+=m.pixels[j+3];if(m.last){const diff=Math.abs(v-m.last[i]);d+=diff;if(diff>8)large++;}}
      m.delta+=d/values.length;m.large+=large/values.length;m.alpha+=alpha/values.length;m.last=values;m.n++;
     }
    }
   }
   // Read before the compositor clears a non-preserved drawing buffer. A separate
   // RAF can run before the app draw and produce misleading all-zero measurements.
   const render=renderer.render;let pending=false,reading=true;
   renderer.render=function(...args){const r=render.apply(this,args);if(!pending){pending=true;queueMicrotask(()=>{pending=false;if(reading)readback();});}return r;};
   function sample(){samples.push({ms:performance.now()-start,eye:camera.position.toArray(),at:controls.target.toArray(),sun:light.position.toArray(),target:light.target.position.toArray(),near:camera.near});raf=requestAnimationFrame(sample);}
   rec.start();sample();await new Promise(r=>setTimeout(r,20000));cancelAnimationFrame(raf);
   reading=false;renderer.render=render;
   await new Promise(r=>{rec.onstop=r;rec.stop();});stream.getTracks().forEach(t=>t.stop());
   const blob=new Blob(chunks,{type:'video/webm'}),bytes=new Uint8Array(await blob.arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   const rawMetrics=Object.fromEntries(Object.entries(measures).map(([k,m])=>[k,{frames:m.n,meanAlpha:m.alpha/m.n,meanAdjacentLumaDelta:m.delta/Math.max(1,m.n-1),fractionPixelsDeltaOver8:m.large/Math.max(1,m.n-1),meanTemporalStd:m.sum.reduce((n,v,i)=>n+Math.sqrt(Math.max(0,m.sq[i]/m.n-(v/m.n)**2)),0)/m.sum.length}]));
   if(Object.values(rawMetrics).some(m=>m.frames<100||m.meanAlpha<250))throw Error('invalid raw frame readback');
   return{video:btoa(binary),samples,rawMetrics,mode,stats:window.__soulsEntity.stats()};
  },mode);
  writeFileSync(out+'/'+mode+'.webm',Buffer.from(result.video,'base64'));delete result.video;
  writeFileSync(out+'/'+mode+'.json',JSON.stringify(result));
  await page.screenshot({path:out+'/'+mode+'.png'});results.push({mode,frames:result.samples.length,stats:result.stats,rawMetrics:result.rawMetrics});
  console.log(JSON.stringify(results.at(-1)));
 }
 writeFileSync(out+'/summary.json',JSON.stringify({results,errors},null,2));
}finally{await browser?.close();if(world)await stop(world);}
