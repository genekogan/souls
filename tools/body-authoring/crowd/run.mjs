#!/usr/bin/env node
// Resource comparisons run under contention; wall-clock timings require an explicit --timings and a quiet host.
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {readFileSync,existsSync,statSync,mkdirSync,writeFileSync,createReadStream} from 'node:fs';
import {cpus,loadavg} from 'node:os';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {portFree,checkPort} from '../../../e2e/local-smoke.mjs';
import {resolvePlaywright,launchArgs} from '../../playtest/lib/platform.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out=resolve(process.env.CROWD_OUT??'.local/body-crowd');
const require=createRequire(join(root,'apps/web/package.json'));
mkdirSync(out,{recursive:true});
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const threeDir=dirname(dirname(require.resolve('three')));
const media=resolve(process.env.CROWD_MEDIA??'.lane/mars-web');
const models=resolve(process.env.CROWD_MARTIANS??'worlds/littlemartians/characters');
const {pipBytes}=await import('../../../apps/server/src/edge/body/pip.ts');
const timings=process.argv.includes('--timings');
let pip,port=9290;
while(!await portFree(port))port++;
checkPort(port);
const origin='http://127.0.0.1:'+port,errors=[];
const report={schema:'body-crowd/1',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 fixture:'actual HumanViews/FloaterView; synthetic sampled frames; fixed camera and lighting; no shadows or world simulation',
 viewport:'1280x720',errors,resources:[],runs:[],proof:null};
const server=await createServer({root:dirname(fileURLToPath(import.meta.url)),configFile:false,logLevel:'error',cacheDir:join(out,'vite-cache'),
 resolve:{alias:[{find:/^three$/,replacement:join(threeDir,'build/three.module.js')},
  {find:/^three\/addons\/(.*)$/,replacement:threeDir+'/examples/jsm/$1'},
  {find:/^three\/(.*)$/,replacement:threeDir+'/$1'}]},
 server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[root,threeDir,media,models]}},
 plugins:[{name:'body-fixtures',configureServer(s){s.middlewares.use(async(req,res,next)=>{
  const path=new URL(req.url,origin).pathname;let base,rel;
  if(path==='/fixtures/pip.glb'){
   try{pip??=await pipBytes();res.setHeader('Content-Type','model/gltf-binary');res.setHeader('Content-Length',pip.length);res.end(pip);}
   catch{res.statusCode=503;res.end('Pip fixture unavailable');}return;
  }
  if(path.startsWith('/fixtures/martians/')){base=models;rel=path.slice('/fixtures/martians/'.length);}
  else if(path.startsWith('/fixtures/draco/')){base=join(media,'draco');rel=path.slice('/fixtures/draco/'.length);}
  else if(path.startsWith('/modular/environment/')){base=join(media,'modular/environment');rel=path.slice('/modular/environment/'.length);}
  else return next();
  const file=resolve(base,decodeURIComponent(rel));
  if(!file.startsWith(base+sep)||!existsSync(file)||!statSync(file).isFile()){res.statusCode=404;res.end('Fixture asset missing');return;}
  res.setHeader('Content-Type',({'.glb':'model/gltf-binary','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'})[extname(file)]??'application/octet-stream');
  res.setHeader('Content-Length',statSync(file).size);createReadStream(file).pipe(res);
 });}}]});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
async function quiet(){
 const before=cpus().map(c=>c.times);await sleep(1500);
 const after=cpus().map(c=>c.times);let total=0,idle=0;
 after.forEach((t,i)=>{const prior=before[i];for(const k of Object.keys(t))total+=t[k]-prior[k];idle+=t.idle-prior.idle;});
 return{idleFraction:idle/total,normalizedLoad:loadavg()[0]/after.length};
}
async function ready(page){await page.waitForFunction(()=>window.__bodyCrowd?.ready&&!window.__bodyCrowd.changing,undefined,{timeout:60000});}
async function select(page,arm,mode){
 await page.locator('#arm').selectOption(arm);await page.locator('#mode').selectOption(mode);await page.locator('#show').click();await ready(page);
 const found=await page.evaluate(()=>window.__bodyCrowd.errors);if(found.length)throw Error('Fixture error: '+found.join('; '));
}
async function open(context,budget='budgeted'){
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(origin+(budget==='full'?'?tex=full':''),{waitUntil:'domcontentloaded'});await ready(page);
 // Read the actual backend, but retain only its class; device/GPU identifiers do not belong in public proof.
 const mode=await page.evaluate(()=>{
  const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
  const name=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'';
  return !name?'unverified':/swiftshader|llvmpipe|software/i.test(name)?'software':'hardware';
 });
 report.rendererMode??=mode;assert.equal(mode,report.rendererMode,'renderer backend changed during run');return page;
}
const cases=[['none','budgeted'],['humanoid','budgeted'],['martians','full'],['martians','budgeted'],['pip','budgeted']];
try{
 await server.listen();const pw=resolvePlaywright({serverRoot:root});
 const launch=launchArgs({gpu:'metal'});report.launchBackend=launch.gpu;
 browser=await pw.chromium.launch({headless:true,args:launch.args});
 // Counts are deterministic resources, not timing observations. Fresh contexts isolate each model/cache arm.
 for(let repeat=0;repeat<2;repeat++)for(const [arm,budget] of repeat?[...cases].reverse():cases){
  const ctx=await browser.newContext({viewport:{width:1280,height:720}}),p=await open(ctx,budget);
  let firstResources;
  for(const mode of ['idle','active','distant']){
   await select(p,arm,mode);const result=await p.evaluate(()=>window.__bodyCrowd.inspect());
   if(firstResources===undefined)firstResources=result.resources;else assert.deepEqual(result.resources,firstResources,'mode changes must reuse downloaded model/clip bytes');
   if(mode!=='distant')assert.equal(result.drawCalls,arm==='none'?1:arm==='humanoid'?215:21);
   if(arm==='none')assert.equal(result.drawnTriangles,2);
   report.resources.push({repeat:repeat+1,arm,textureBudget:budget,mode,...result});
   if(repeat===0&&mode==='idle')await p.screenshot({path:join(out,arm+'-'+budget+'.png')});
  }
  await ctx.close();
 }
 const martian=budget=>report.resources.find(x=>x.arm==='martians'&&x.textureBudget===budget&&x.mode==='idle');
 assert.ok(martian('budgeted').costs.textureRgbaBytes<martian('full').costs.textureRgbaBytes*.2,'texture budget must reduce decoded texture estimate by at least 80%');
 assert.equal(martian('budgeted').drawnTriangles,martian('full').drawnTriangles,'texture fitting must preserve geometry');
 report.cacheReuse='pass: idle/active/distant resource entries identical in every fresh-context arm';
 report.quiet=await quiet();
 report.timings={status:'pending',reason:'resource-only run requested; clean wall-clock measurements remain unqualified'};
 if(timings){
  if(report.quiet.idleFraction<.7||report.quiet.normalizedLoad>.75){report.timings={status:'pending',reason:'host did not meet quiet threshold'};}
  else{
   for(let repeat=0;repeat<2;repeat++)for(const [arm,budget] of repeat?[...cases].reverse():cases){
    // Reject a timing arm if other work has started since the initial quiet sample.
    const before=await quiet();if(before.idleFraction<.7||before.normalizedLoad>.75)throw Error('Host became busy during timing arms; timings are incomplete');
    const ctx=await browser.newContext({viewport:{width:1280,height:720}}),p=await open(ctx,budget);
    for(const mode of ['idle','active','distant']){
     await select(p,arm,mode);const n=await p.evaluate(()=>window.__bodyCrowd.reports.length);await p.locator('#measure').click();
     await p.waitForFunction(n=>window.__bodyCrowd.reports.length>n,n,{timeout:60000});
     report.runs.push({repeat:repeat+1,...await p.evaluate(()=>window.__bodyCrowd.reports.at(-1))});
    }
    await ctx.close();
   }
   report.timings={status:'pass',reason:'two repeats per arm, host quiet at arm admission; CPU frame and render submission timings, not GPU timer queries'};
  }
 }
 // Record separately, so video encoding cannot contaminate timing measurements. One context, uncut, real speed.
 const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:join(out,'video'),size:{width:1280,height:720}}});
 const page=await open(context),video=page.video(),marks=[],start=performance.now();
 for(const [arm,mode] of [['none','idle'],['humanoid','active'],['martians','active'],['pip','active'],['pip','distant']]){
  await select(page,arm,mode);marks.push({arm,mode,seconds:(performance.now()-start)/1000});await page.waitForTimeout(2000);
 }
 await context.close();report.proof={file:await video.path(),uncut:true,realSpeed:true,marks};
 assert.equal(errors.length,0,'browser errors');report.status='resources-pass';
}catch(e){report.status='fail';report.error=e.message;console.error(e.message);process.exitCode=1;}
finally{
 if(browser)await browser.close();await server.close();report.teardown=true;
 writeFileSync(join(out,'summary.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,errors:errors.length,resourceCases:report.resources.length,timingRuns:report.runs.length,timings:report.timings,teardown:true}));
}
