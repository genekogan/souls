// W8 whole-map "sits on the ground" check, real Chrome: loads a world with ?survey=seats and fails (exit 1) when any drawn
// seat floats or is buried. Never point it at a live port (4930-4970).   node seat-survey.mjs <port> <out.json> [query]
import {writeFileSync} from 'node:fs';import {createRequire} from 'node:module';import {chromeLease} from '../god-skill/lib/chrome-lease.mjs';
const [port,out,extra='']=process.argv.slice(2);if(+port>=4930&&+port<=4970)throw Error('live port: refused');const {chromium}=createRequire(new URL('../../mars/viewer/package.json',import.meta.url).pathname)('@playwright/test');
const release=await chromeLease('waterold');try{const b=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});try{
 const page=await (await b.newContext({viewport:{width:1280,height:760}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,300)));
 await page.goto(`http://127.0.0.1:${port}/w/${process.env.WORLD??'eden'}?survey=seats${extra?'&'+extra:''}`,{waitUntil:'domcontentloaded',timeout:120000});
 let r=null;const t0=Date.now();while(Date.now()-t0<240000){r=await page.evaluate(()=>globalThis.__soulsSeatSurvey??null);if(r)break;await page.waitForTimeout(2000);}
 writeFileSync(out,JSON.stringify({errors,survey:r},null,1));const v={};for(const f of Array.isArray(r)?r:[])v[f.verdict]=(v[f.verdict]??0)+1;console.log(JSON.stringify({n:Array.isArray(r)?r.length:r,v,errors:errors.slice(0,3)}));
}finally{await b.close();}}finally{release();}
const bad=JSON.parse((await import('node:fs')).readFileSync(out,'utf8')).survey;if(!Array.isArray(bad)||!bad.length||bad.some(f=>f.verdict!=='ok'))process.exitCode=1;
