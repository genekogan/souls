// Lane B (camera, 2026-10-26): a real-input local walk of the camera changes on a fresh dev-auth world.
//  B3: clicking an owned Soul's chip from the overview and from close by flies to the Soul and follows it
//      (data-camera-shot becomes follow:<entity> within 3.5 s / 1.5 s).
//  B1: a plain click moves the pivot under the cursor and the eye stays where it is.
//  B2: arrows turn the head; pivot and eye stay where they are.
// Frame sequences of each go to --out. Local only (launcher --dev-auth on 127.0.0.1), fake minds, $0.
//   cd apps/web && npx vite build --base /worlds/ --outDir <web>
//   node apps/web/test/camera-chip-flight.browser.mjs --web <web> [--port 6840] [--range 6841-6843] [--out <dir>] [--mars-web <dir>]
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=new URL('../../../',import.meta.url).pathname;
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const web=arg('web');assert.ok(web,'--web <vite build --base /worlds/> is required');
const port=Number(arg('port','6840')),range=arg('range','6841-6843'),origin=`http://127.0.0.1:${port}`,BASE='/worlds';
const out=resolve(arg('out',`${root}.lane/camera-chip-flight/${new Date().toISOString().replace(/[:.]/g,'-')}`));mkdirSync(out,{recursive:true});
const {chromium}=createRequire(root+'mars/viewer/package.json')('@playwright/test');
const {chromeLease}=await import(root+'tools/god-skill/lib/chrome-lease.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={status:'running',checks:[],timings:{}};
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});console.log(`${ok?'PASS':'FAIL'} ${name}${detail===undefined?'':' '+JSON.stringify(detail)}`);return ok;};

const launcher=spawn(process.execPath,['tools/world-launcher/launcher.mjs','--port',String(port),'--range',range,'--data',join(out,'data'),'--base',BASE,
  '--web',resolve(web),'--dev-auth','--public-origin',origin,...(arg('mars-web')?['--mars-web',resolve(arg('mars-web'))]:[])],{cwd:root,stdio:['ignore','pipe','pipe']});
let log='';launcher.stdout.on('data',d=>{log+=d;});launcher.stderr.on('data',d=>{log+=d;});
const stop=()=>{try{launcher.kill('SIGTERM');}catch{}};process.on('exit',stop);for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>{stop();process.exit(130);});
const call=async(url,{as,body}={})=>{const r=await fetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(as?{authorization:`Bearer dev:${as}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};};
const CLI=resolve(root,'tools/edge-skill/eden-agent.mjs');
const agent=(folder,argv)=>new Promise((ok,bad)=>execFile(process.execPath,[CLI,...argv],{cwd:folder,timeout:300000,maxBuffer:4<<20},(e,so,se)=>e?bad(new Error(`${argv[0]}: ${String(se||e.message).slice(0,400)}`)):ok(so)));

let release=null,browser=null,page=null;
try{
  for(let i=0;i<90;i++){if(await fetch(`${origin}${BASE}/__sim/worlds.json`).then(r=>r.ok,()=>false))break;await sleep(1000);}
  const made=await call(`${origin}${BASE}/__sim/worlds`,{as:'camera',body:{name:`Camera ${Date.now()%100000}`}});
  const slug=made.data?.slug??made.data?.world?.slug??String(made.data?.url??'').match(/\/w\/([a-z][a-z0-9-]*)/)?.[1];
  assert.ok(made.status===201&&slug,`create world: ${made.status} ${JSON.stringify(made.data).slice(0,300)}`);
  const base=`${origin}${BASE}/w/${slug}`;report.world=base;
  for(let i=0;i<180;i++){const s=await call(`${base}/v1/config`).catch(()=>null);if(s?.status===200)break;await sleep(1000);}
  // two owned Souls of one dev owner (the agent folder's identity is that owner)
  const folder=mkdtempSync(join(tmpdir(),'camera-soul-'));await agent(folder,['register',base]);
  await agent(folder,['create-soul','Wren']);
  const owner=JSON.parse(readFileSync(join(folder,'.eden-agent.json'),'utf8')).identity;assert.ok(/^agent-[0-9a-f]+$/.test(owner));
  release=await chromeLease('camera-lane-b');
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
  await ctx.addInitScript(o=>{try{localStorage.setItem('sim.dev',o);localStorage.setItem('skipgc','t');}catch{}},owner);
  page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  const chip=page.locator('.my-souls>button').first();await chip.waitFor({state:'visible',timeout:180000});
  await page.waitForFunction(()=>!!globalThis.__soulsCamera,null,{timeout:120000});
  if(await page.locator('[data-god-modal][open]').count()){await page.keyboard.press('Escape');await sleep(400);}
  const canvas=page.locator('canvas[aria-label="Live 3D view of the world"]');
  const shot=()=>canvas.evaluate(c=>c.dataset.cameraShot??'');const cam=()=>page.evaluate(()=>globalThis.__soulsCamera);
  const frames=async(name,n,gap)=>{for(let i=0;i<n;i++){await page.screenshot({path:join(out,`${name}-${String(i).padStart(2,'0')}.png`)});await sleep(gap);}};
  const overview=async()=>{await page.evaluate(()=>(document.activeElement)?.blur?.());await page.keyboard.press('Home');await sleep(2500);};

  // B1: click-pivot from the overview
  await overview();let a=await cam();
  await page.mouse.click(820,520);await sleep(380);const framesClick=frames('b1-click-pivot',6,80);await framesClick;await sleep(300);let b=await cam();
  check('B1 a click moves the pivot',a&&b&&Math.hypot(...a.pivot.map((v,i)=>v-b.pivot[i]))>1,{before:a?.pivot,after:b?.pivot});
  check('B1 a click never moves the eye',a&&b&&Math.hypot(...a.p.map((v,i)=>v-b.p[i]))<.05,{before:a?.p,after:b?.p});

  // B2: arrows turn the head over the fixed pivot
  a=await cam();await page.keyboard.down('ArrowRight');await frames('b2-arrow-look',4,60);await page.keyboard.up('ArrowRight');await sleep(200);b=await cam();
  check('B2 arrows leave the pivot and the eye',a&&b&&a.pivot.every((v,i)=>v===b.pivot[i])&&a.p.every((v,i)=>v===b.p[i]),{a,b});
  check('B2 arrows turned the head',b&&Math.abs(b.look?.[0]??0)>.05,{look:b?.look});

  // B3: chip from the overview, then from close by
  for(const [label,limit] of [['overview',3500],['close',1500]]){
    if(label==='overview')await overview();
    else{await page.keyboard.down('KeyW');await sleep(250);await page.keyboard.up('KeyW');await sleep(600);}
    await page.evaluate(()=>{const c=document.querySelector('canvas[aria-label="Live 3D view of the world"]'),log=globalThis.__flightLog=[],t0=performance.now();let prev='',frames=0;globalThis.__clickAt=null;globalThis.__shotAfterClick=null;document.addEventListener('click',()=>{globalThis.__clickAt??=performance.now();},{capture:true,once:true});
      const tick=()=>{frames++;const s=c.dataset.cameraMode+' '+(c.dataset.cameraShot??'');if(s!==prev){log.push([Math.round(performance.now()-t0),frames,s]);prev=s;}if(/^follow:.+/.test(c.dataset.cameraShot??'')&&globalThis.__clickAt!=null&&globalThis.__shotAfterClick==null)globalThis.__shotAfterClick=performance.now()-globalThis.__clickAt;if(log.length<20&&performance.now()-t0<8000)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
    const before=await shot();const t0=Date.now();await chip.click();
    const seq=frames(`b3-chip-flight-${label}`,label==='overview'?8:5,label==='overview'?350:250);
    const ok=await page.waitForFunction(()=>/^follow:.+/.test(document.querySelector('canvas[aria-label="Live 3D view of the world"]')?.dataset.cameraShot??''),null,{timeout:limit+3000,polling:50}).then(()=>true,()=>false);
    const wall=Date.now()-t0;await seq;const ms=Math.round(await page.evaluate(()=>globalThis.__shotAfterClick??Infinity));report.timings[label+'Wall']=wall;report.timings[label]=ms;report.timings[label+'Log']=await page.evaluate(()=>globalThis.__flightLog);report.timings[label+'Eye']=await cam();
    check(`B3 chip from ${label} follows within ${limit} ms of the click`,ok&&ms<=limit,{ms,wall,before,after:await shot()});
  }
  check('no page errors',errors.length===0,errors.slice(0,5));
  report.status=report.checks.every(c=>c.ok)?'pass':'fail';
}catch(e){report.status='error';report.error=String(e?.stack??e).slice(0,1200);console.error(e);
  if(page){await page.screenshot({path:join(out,'error.png')}).catch(()=>{});report.page=await page.evaluate(()=>({url:location.href,dev:localStorage.getItem('sim.dev'),hud:document.querySelector('.hud-left')?.parentElement?.innerText?.slice(0,400)})).catch(()=>null);}}
finally{await browser?.close().catch(()=>{});release?.();stop();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,1));writeFileSync(join(out,'launcher.log'),log);}
console.log(`${report.status.toUpperCase()} ${out}`);process.exit(report.status==='pass'?0:1);
