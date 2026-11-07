// Lane REC: side-by-side real-input walk of local root-path old worlds, main e8 build vs root/reconcile build.
// Real Chrome (GPU), under the Chrome lease; dpr 1 and 2; drag, wheel, hold W, double-click, New Soul click.
//   node walk-old.mjs <outDir>
import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {createRequire} from 'node:module';
const {chromeLease}=await import(process.env.CHROME_LEASE_MODULE??'../god-skill/lib/chrome-lease.mjs');
const out=resolve(process.argv[2]);mkdirSync(out,{recursive:true});
const {chromium}=createRequire(new URL('../../mars/viewer/package.json', import.meta.url).pathname)('@playwright/test');
const builds=JSON.parse(process.env.WALK_BUILDS??'{"main":5411,"rec":5401}');  // label → first port of that build's eden/mars/littlemartians
const worlds=['eden','mars','littlemartians'];const W=1352,H=780;
const geometry=()=>{const c=document.querySelector('canvas[aria-label="Live 3D view of the world"]');const r=c?.getBoundingClientRect();return {window:[innerWidth,innerHeight],dpr:devicePixelRatio,canvasCss:r&&[Math.round(r.width),Math.round(r.height)],buffer:c&&[c.width,c.height]};};
const ui=()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 return {buttons:[...document.querySelectorAll('header button, header a, .hud-actions button, .hud-actions a, summary')].filter(vis).map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim().replace(/\s+/g,' ').slice(0,40)).sort(),
  godPanel:!!document.querySelector('.god-panel, [data-god-panel]'),simEntity:'__soulsEntity' in window,dialogs:document.querySelectorAll('[role=dialog]').length,
  arrival:!!document.querySelector('.viewer-arrival'),revealed:document.querySelector('.world-canvas-host')?.getAttribute('data-initial-revealed')??null,
  title:document.title};};
const cam=()=>globalThis.__soulsCamera??null;
const moved=(a,b,k)=>!!(a&&b)&&a[k].some((v,i)=>Math.abs(v-b[k][i])>0.01);
const release=await chromeLease('rec-old-worlds');const report=[];
try{for(const dpr of [1,2]){const browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
 try{for(const world of worlds)for(const [build,port0] of Object.entries(builds)){
  const port=port0+worlds.indexOf(world),tag=`${world}-dpr${dpr}-${build}`;const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:dpr});const page=await ctx.newPage();
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));page.on('request',r=>{const u=new URL(r.url());if(u.port===String(port))requests.push(u.pathname.replace(/\/assets\/.*/,'/assets/*'));});
  const t0=Date.now();await page.goto(`http://127.0.0.1:${port}/w/${world}`,{waitUntil:'domcontentloaded',timeout:120000});
  let state;for(;;){state=await page.evaluate(ui).catch(()=>null);if(state&&state.revealed==='true'&&!state.arrival)break;if(Date.now()-t0>150000){break;}await page.waitForTimeout(300);}
  const arrivalMs=Date.now()-t0;await page.waitForTimeout(1500);
  const run={tag,world,dpr,build,arrivalMs,geometry:await page.evaluate(geometry),ui:await page.evaluate(ui)};
  await page.screenshot({path:resolve(out,`${tag}-arrived.png`)});
  const a=await page.evaluate(cam);const cx=Math.round(W*.5),cy=Math.round(H*.55);
  await page.mouse.move(cx,cy);await page.mouse.down();for(let k=1;k<=10;k++)await page.mouse.move(cx+k*16,cy-k*2);await page.mouse.up();await page.waitForTimeout(700);const d=await page.evaluate(cam);
  await page.mouse.move(cx,cy);await page.mouse.wheel(0,-600);await page.waitForTimeout(900);const wh=await page.evaluate(cam);
  await page.keyboard.down('w');await page.waitForTimeout(1000);await page.keyboard.up('w');await page.waitForTimeout(400);const k=await page.evaluate(cam);
  await page.mouse.dblclick(Math.round(W*.42),Math.round(H*.68));await page.waitForTimeout(2500);const dc=await page.evaluate(cam);
  run.input={drag:moved(a,d,'p'),wheel:moved(d,wh,'p'),wasd:moved(wh,k,'p'),doubleClick:moved(k,dc,'pivot')};
  await page.screenshot({path:resolve(out,`${tag}-after-input.png`)});
  const ns=page.getByRole('button',{name:/new soul/i}).first();
  if(await ns.isVisible().catch(()=>false)){await ns.click();await page.waitForTimeout(1200);run.newSoul={dialogs:await page.evaluate(()=>document.querySelectorAll('[role=dialog]').length),hash:await page.evaluate(()=>location.hash)};await page.screenshot({path:resolve(out,`${tag}-new-soul.png`)});await page.keyboard.press('Escape');await page.waitForTimeout(500);run.newSoul.afterEscape=await page.evaluate(()=>document.querySelectorAll('[role=dialog]').length);}
  else run.newSoul=null;
  run.errors=errors;run.requests=[...new Set(requests)].sort();report.push(run);console.log(JSON.stringify({tag,arrivalMs,geom:run.geometry,input:run.input,newSoul:run.newSoul,buttons:run.ui.buttons,god:run.ui.godPanel,ent:run.ui.simEntity,errors:errors.length}));
  await ctx.close();}}
 finally{await browser.close();}}}
finally{release();}
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,1));
// side-by-side: same signature per world/dpr? (live Souls differ between two fake worlds: Soul ids are normalised;
// a drag or double-click that lands on a walking Soul can select it instead of moving the camera, on either build)
const sig=r=>JSON.stringify({geom:r.geometry,input:r.input,newSoul:r.newSoul&&{dialogs:r.newSoul.dialogs,afterEscape:r.newSoul.afterEscape},buttons:r.ui.buttons,god:r.ui.godPanel,ent:r.ui.simEntity,reqs:r.requests.filter(q=>!/\/edge\/public\/souls\//.test(q)),errors:r.errors.length});
for(const world of worlds)for(const dpr of [1,2]){const [bl,cl]=Object.keys(builds);const m=report.find(r=>r.world===world&&r.dpr===dpr&&r.build===bl),x=report.find(r=>r.world===world&&r.dpr===dpr&&r.build===cl);console.log(world,'dpr',dpr,m&&x&&sig(m)===sig(x)?'SAME':'DIFF');if(m&&x&&sig(m)!==sig(x))console.log(' main',sig(m),'\n rec ',sig(x));}
