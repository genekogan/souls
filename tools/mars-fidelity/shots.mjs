#!/usr/bin/env node
// Local-only matched-camera proof. The shared real Chrome lease belongs to lane mars.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromeLease} from '../god-skill/lib/chrome-lease.mjs';
import { scratchDir } from '../lib/paths.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),flag=(k,d)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1];};
const base=flag('base','http://127.0.0.1:5860/w/mars-fidelity'),phase=flag('phase','before'),mode=flag('mode','assets'),out=flag('out',scratchDir('mars'));
const u=new URL(base);if(!['127.0.0.1','localhost'].includes(u.hostname)||+u.port<5860||+u.port>5869)throw Error('Proof accepts only mars local ports5860–5869');
mkdirSync(out,{recursive:true});
const {chromium}=createRequire(join(root,'mars/viewer/package.json'))('@playwright/test');
export const VIEWS={
 lounge:{eye:[.6,2.1,-34.2],at:[.4,.7,-27.2]},
 group:{eye:[1.3,7,-32],at:[1.3,0,-31.8],roofs:true},
 drape:{eye:[2.5,3.2,-17],at:[2,1.3,-30]},
 gallery:{eye:[-17.5,4.6,-24.5],at:[-20.5,4.6,-24]},
 portrait:{eye:[-18,4.2,-23.8],at:[-20.44,4,-23.9]},
};
const release=await chromeLease('mars');let browser;const rows=[];let failure;
try{
 for(const dpr of flag('dpr',null)?[Number(flag('dpr'))]:[1,2])for(const dust of ['dust','review'].includes(mode)?['clear','faint','heavy']:['clear']){
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:dpr});
  const page=await ctx.newPage();page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|ERROR/.test(m.text()))errors.push(m.text().slice(0,300));});
  const q=new URLSearchParams({dev:'1',shot:'1',settle:'1500',dust,eye:'15,3,5',at:'-5,2,-35'});
  console.log('load',dpr,dust);
  await page.goto(base+'?'+q,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.__shotReady===true&&window.__soulsEntity?.layer?.active,null,{polling:250,timeout:90000}).catch(async e=>{writeFileSync(join(out,`${phase}-readiness-dpr${dpr}.json`),JSON.stringify({errors,url:page.url(),body:await page.locator('body').innerText({timeout:5000}).catch(()=>'(unresponsive)')},null,2));throw e;});
  await page.waitForTimeout(2000);
  const initial=await page.evaluate(()=>window.__soulsEntity.camera.position.toArray());
  await page.mouse.click(600,500);await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');
  const moved=await page.evaluate(p=>Math.hypot(...window.__soulsEntity.camera.position.toArray().map((v,i)=>v-p[i])),initial);
  if(moved<.2)throw Error('real W input did not move camera');
  const assetViews=flag('views',null)?JSON.parse(readFileSync(flag('views'),'utf8')):VIEWS;
  const dustViews={['dust-'+dust]:{eye:[15,3,5],at:[-5,2,-35]}};
  const views=mode==='review'?{...(dust==='clear'?assetViews:{}),...dustViews}:mode==='dust'?dustViews:assetViews;
  for(const [name,v]of Object.entries(views)){
   await page.evaluate(v=>{const w=window.__soulsEntity;w.controls.target.set(...v.at);w.camera.position.set(...v.eye);w.controls.update();window.__buildingView??={};window.__buildingView.hideRoofs=!!v.roofs;},v);
   await page.waitForTimeout(1400);
   const info=await page.evaluate(()=>({stats:window.__soulsEntity.stats(),dust:window.__soulsLiving?.atmosphere().dust,canvas:{width:document.querySelector('canvas').width,height:document.querySelector('canvas').height},gpu:(()=>{const gl=window.__soulsEntity.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER);})()}));
   if(info.canvas.width!==1280*dpr)throw Error('wrong canvas DPR');
   if(name.startsWith('dust-')&&(info.dust?.kind!==dust||Math.abs(info.dust?.intensity-({clear:0,faint:.035,heavy:.4}[dust]))>1e-6))throw Error('dust state mismatch '+JSON.stringify(info.dust));
   if(errors.length)throw Error('browser errors '+errors.join('\n'));
   const file=join(out,`${phase}-${name}-dpr${dpr}.png`);await page.screenshot({path:file,timeout:30000});
   rows.push({name,phase,dpr,file,view:v,inputMoved:moved,...info,errors:[...errors]});console.log('shot',name,dpr);
  }
  await ctx.close();await browser.close();browser=null;
 }
}catch(e){failure=String(e.stack??e);throw e;}
finally{await browser?.close().catch(()=>{});release();writeFileSync(join(out,`${phase}-${mode}-shots${flag('dpr',null)?'-dpr'+flag('dpr'):''}.json`),JSON.stringify({status:failure?'fail':'pass',failure,rows},null,2)+'\n');}
