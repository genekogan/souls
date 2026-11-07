import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');

export function safeLocalUrl(value) {
  const u=new URL(value);
  if(!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password||!/^https?:$/.test(u.protocol)||Number(u.port)<5900||Number(u.port)>5909)
    throw Error('parity browser accepts only localhost ports 5900–5909');
  return u;
}

export function observeClockSource(source) {
  // Observe the real Daylight.update input, without changing a time, light or material.
  const at=source.indexOf('this.daylightFactor=null');
  if(at<0)return null;
  const start=source.lastIndexOf('update(',at),head=source.slice(start,start+80);
  const match=/^update\(([A-Za-z_$][\w$]*)\)\{/.exec(head);
  if(!match||!source.slice(start,at).includes('this.key'))throw Error('Daylight observer signature changed');
  const offset=start+match[0].length;
  return {source:source.slice(0,offset)+`globalThis.__parityRenderedDatetime=${match[1]};`+source.slice(offset),sha256:createHash('sha256').update(source).digest('hex')};
}

// Test instrumentation only: Three's supported devtools observer sees both engines.
// Pin cameras just before rendering, so old broadcast logic cannot silently reframe a pair.
function observeThree() {
  globalThis.__parityFrames=0;
  globalThis.__THREE_DEVTOOLS__={dispatchEvent(e){
    const r=e.detail;
    if(!r?.isWebGLRenderer||r.__parityWrapped)return;
    r.__parityWrapped=true;const render=r.render;
    r.render=function(scene,camera,...args){
      if(camera?.isPerspectiveCamera&&scene?.isScene){
        const p=globalThis.__parityPose;
        if(p){camera.position.fromArray(p.eye);camera.lookAt(...p.at);camera.fov=45;camera.aspect=innerWidth/innerHeight;camera.clearViewOffset();camera.updateProjectionMatrix();camera.updateMatrixWorld();}
        globalThis.__parityView={scene,camera,renderer:r};globalThis.__parityFrames++;
      }
      return render.call(this,scene,camera,...args);
    };
  }};
}

function inspectView() {
  const w=globalThis.__parityView;if(!w)return null;
  const {scene,camera,renderer}=w,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  const lights=[];scene.traverse(o=>{if(o.isLight&&o.visible)lights.push({type:o.type,color:o.color.toArray(),intensity:o.intensity,
    p:o.getWorldPosition(o.position.clone()).toArray(),...(o.groundColor?{groundColor:o.groundColor.toArray()}:{}),distance:o.distance??null});});
  lights.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {frames:globalThis.__parityFrames,datetime:globalThis.__parityRenderedDatetime,eye:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,viewOffset:camera.view?.enabled??false,
    background:scene.background?.isColor?scene.background.toArray():null,
    fog:scene.fog?{color:scene.fog.color.toArray(),near:scene.fog.near??null,far:scene.fog.far??null,density:scene.fog.density??null}:null,
    lights,pixelRatio:renderer.getPixelRatio(),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],
    gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
    entityCount:globalThis.__soulsEntity?.layer?.entityCount??null,
    sceneBinding:renderer.domElement.dataset.sceneBinding??null};
}

export async function captureVisual({root,oldUrl,candidateUrl,poses,outDir,setHour,timeout=180000,sampleHours=true}) {
  safeLocalUrl(oldUrl);safeLocalUrl(candidateUrl);mkdirSync(outDir,{recursive:true});
  const {chromium}=createRequire(resolve(root,'mars/viewer/package.json'))('@playwright/test');
  const release=await chromeLease('parity');let browser;
  const stop=()=>{void Promise.resolve(browser?.close()).finally(()=>{release();process.exit(130);});};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const report={status:'UNKNOWN',pairs:[],hourly:[],errors:[],input:[],policy:'exact RGB; no pixel threshold; missing pose/DPR/hour closes gate'};
  const activePages=[];
  try {
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
    for(const dpr of [1,2]){
      const context=await browser.newContext({viewport:{width:960,height:640},deviceScaleFactor:dpr,reducedMotion:'reduce'});
      await context.addInitScript(observeThree);
      await context.route('**/*.js',async route=>{
        const response=await route.fetch();const source=await response.text();
        const observed=observeClockSource(source);
        if(observed){report.clockObserver={kind:'read-only Daylight.update input observer in browser response',sourceSha256:observed.sha256};await route.fulfill({response,body:observed.source});}
        else await route.fulfill({response});
      });
      const pages=[];
      for(const [side,url]of [['old',oldUrl],['candidate',candidateUrl]]){
        const page=await context.newPage();activePages.push(page);page.setDefaultTimeout(timeout);
        page.on('pageerror',e=>report.errors.push({side,dpr,error:String(e).slice(0,400)}));
        page.on('response',r=>{if(r.status()>=400){const row={side,dpr,status:r.status(),url:r.url().replace(/\?.*/, '')};if(r.status()===404&&row.url.endsWith('/v1/worldmeta'))(report.optionalProbes??=[]).push(row);else report.errors.push(row);}});
        await page.goto(`${url}?shot=1&dpr=fixed`,{waitUntil:'domcontentloaded',timeout});
        await page.waitForFunction(()=>globalThis.__parityView&&(globalThis.__soulsEntity?.layer?.active===true||document.querySelector('canvas')?.dataset.sceneBinding==='bound'),null,{timeout});
        await page.waitForSelector('.world-canvas-host[data-initial-revealed="true"]',{state:'visible',timeout});
        await page.waitForTimeout(3000);
        (report.readiness??=[]).push({side,dpr,state:await page.evaluate(inspectView)});
        // Real spectator input is recorded, before calibrated stills. No world action or sign-in.
        await page.mouse.move(480,320);await page.mouse.down();await page.mouse.move(510,330,{steps:4});await page.mouse.up();
        await page.keyboard.press('w');
        report.input.push({side,dpr,drag:[480,320,510,330],key:'w'});pages.push(page);
      }
      for(const p of poses){
        const pair={name:p.name,kind:p.kind,dpr,hour:p.hour,eye:p.eye,at:p.at};
        try{
          pair.clockCalibration=await setHour(p.hour);
          for(let i=0;i<pages.length;i++){
            const page=pages[i];await page.bringToFront();
            const cameraPose=p[i?'candidate':'old']??p;
            await page.evaluate(p=>{globalThis.__parityPose=p;},cameraPose);
            const before=await page.evaluate(()=>globalThis.__parityFrames);
            await page.waitForFunction(n=>globalThis.__parityFrames>n+2,before);
            await page.waitForFunction(h=>{const d=globalThis.__parityRenderedDatetime;if(typeof d!=='string')return false;const hour=Number(d.slice(11,13))+Number(d.slice(14,16))/60;return Math.abs(hour-h)<.05;},p.hour,{timeout:20000});
            await page.waitForTimeout(1200);
            const state=await page.evaluate(inspectView);
            if(/swiftshader|llvmpipe/i.test(state.gpu))throw Error(`software GPU refused: ${state.gpu}`);
            if(state.buffer[0]!==960*dpr||state.buffer[1]!==640*dpr)throw Error('drawing buffer does not match requested DPR');
            if(state.viewOffset||state.fov!==45||state.eye.some((v,k)=>Math.abs(v-cameraPose.eye[k])>1e-6))throw Error('camera calibration mismatch');
            const side=i?'candidate':'old';pair[side]={file:resolve(outDir,`${p.name}-dpr${dpr}-${side}.png`),pose:cameraPose,state};
            await page.locator('canvas').first().screenshot({path:pair[side].file,timeout});
          }
          const output=resolve(outDir,`${p.name}-dpr${dpr}-pair.png`);
          Object.assign(pair,JSON.parse(execFileSync('python3',[resolve(root,'tools/parity/image-diff.py'),pair.old.file,pair.candidate.file,output],{encoding:'utf8'})));
        }catch(e){pair.status='UNKNOWN';pair.error=String(e);}
        report.pairs.push(pair);console.log(`visual ${p.name} DPR${dpr}: ${pair.status} ${pair.meanAbsoluteError??pair.error??''}`);
        writeFileSync(resolve(outDir,'visual.json'),JSON.stringify(report,null,2));
      }
      if(dpr===1&&sampleHours)for(let hour=0;hour<24;hour++){
        const calibration=await setHour(hour);const row={hour,calibration};
        for(let i=0;i<pages.length;i++){
          await pages[i].bringToFront();const before=await pages[i].evaluate(()=>globalThis.__parityFrames);
          await pages[i].waitForFunction(h=>{const d=globalThis.__parityRenderedDatetime;return typeof d==='string'&&Math.abs(Number(d.slice(11,13))+Number(d.slice(14,16))/60-h)<.05;},hour);
          await pages[i].waitForFunction(n=>globalThis.__parityFrames>n+2,before);
          const state=await pages[i].evaluate(inspectView);
          row[i?'candidate':'old']={datetime:state.datetime,background:state.background,lights:state.lights,fog:state.fog};
        }
        row.status=JSON.stringify(row.old)===JSON.stringify(row.candidate)?'PASS':'FAIL';report.hourly.push(row);
      }
      await context.close();
    }
  }catch(e){report.errors.push({error:String(e)});for(const [i,page]of activePages.entries())if(!page.isClosed()){
    await page.screenshot({path:resolve(outDir,`capture-error-${i}.png`),timeout:10000}).catch(()=>{});
    report.errors.push(await page.evaluate(()=>({url:location.href,title:document.title,headings:[...document.querySelectorAll('h1,h2,[data-initial-stage]')].map(e=>e.textContent?.slice(0,200))})).catch(()=>({diagnostic:'unavailable'})));
  }}
  finally{await browser?.close().catch(()=>{});release();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
  const expectedHours=sampleHours?24:0;
  const coverage=report.pairs.length===poses.length*2&&report.pairs.every(x=>x.old&&x.candidate)&&report.hourly.length===expectedHours;
  report.status=report.pairs.some(p=>p.status==='FAIL')||report.hourly.some(p=>p.status==='FAIL')?'FAIL':coverage&&!report.errors.length&&report.pairs.every(p=>p.status==='PASS')&&report.hourly.every(p=>p.status==='PASS')?'PASS':'UNKNOWN';
  report.coverage={expectedPairs:poses.length*2,actualPairs:report.pairs.length,expectedHours,actualHours:report.hourly.length};
  writeFileSync(resolve(outDir,'visual.json'),JSON.stringify(report,null,2));return report;
}
