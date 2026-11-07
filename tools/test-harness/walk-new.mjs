// Lane REC: real-input walk of a NEW world under the /worlds prefix, served by the launcher from root/reconcile.
// Home → New world (real clicks/typing) → world page: canvas geometry at dpr 1 and 2, drag/wheel/W/double-click,
// God panel, Join as a Soul line. Chrome lease, real GPU. node walk-new.mjs <origin> <outDir>
import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {createRequire} from 'node:module';
import {startV7ClerkFixture} from './v7-clerk-fixture.mjs';
const {chromeLease}=await import(process.env.CHROME_LEASE_MODULE??'../god-skill/lib/chrome-lease.mjs');
const [origin,outArg]=process.argv.slice(2);const out=resolve(outArg);mkdirSync(out,{recursive:true});
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
// The release walk exercises account-backed New Soul, so use production-shaped verified auth.
// A manually supplied dev launcher remains supported when --web is omitted.
const {chromium}=createRequire(new URL('../../mars/viewer/package.json', import.meta.url).pathname)('@playwright/test');
const W=1352,H=780,report={origin,runs:[]};
const geometry=()=>{const c=document.querySelector('canvas[aria-label="Live 3D view of the world"]');const r=c?.getBoundingClientRect();return {window:[innerWidth,innerHeight],dpr:devicePixelRatio,canvasCss:r&&[Math.round(r.width),Math.round(r.height)],buffer:c&&[c.width,c.height]};};
const cam=()=>{const e=window.__soulsEntity;if(!e)return null;const p=e.camera.position,t=e.controls.target;return {p:[p.x,p.y,p.z],pivot:[t.x,t.y,t.z],view:e.camera.view?.enabled?[Math.round(e.camera.view.offsetX),Math.round(e.camera.view.offsetY)]:null};};
const moved=(a,b,k)=>!!(a&&b)&&a[k].some((v,i)=>Math.abs(v-b[k][i])>0.01);
let release=null,worldUrl=null,fixture=null;
try{fixture=arg('--web')?await startV7ClerkFixture({origin,out,web:arg('--web'),marsWeb:arg('--mars-web')}):null;release=await chromeLease('rec-new-world');
try{for(const dpr of [1,2]){const browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
 try{const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:dpr});if(fixture)await fixture.prepareContext(ctx);else await ctx.addInitScript(()=>{try{localStorage.setItem('sim.dev','rec-gaia');}catch{}});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname);});const run={dpr};
  if(!worldUrl){await page.goto(origin+'/worlds/',{waitUntil:'domcontentloaded'});if(fixture)await page.locator('[data-signed-in="1"]').waitFor({state:'visible',timeout:20000});await page.locator('[data-new-world]').first().click();
   await page.locator('[data-world-name]').fill('Rec Hollow '+Date.now().toString(36).slice(-4));await page.locator('[data-god-name]').fill('Gaia').catch(()=>{});
   await page.screenshot({path:resolve(out,`home-new-world-dpr${dpr}.png`)});await page.locator('[data-create]').click();
   await page.waitForURL(/\/worlds\/w\/[a-z0-9-]+/,{timeout:120000});worldUrl=page.url().split('#')[0];run.created=worldUrl;}
  else await page.goto(worldUrl,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__soulsEntity&&!!document.querySelector('[data-god-panel],[data-god-panel-toggle],[data-god-open]'),null,{timeout:120000});
  await page.waitForTimeout(3000);run.geometry=await page.evaluate(geometry);
  run.header=await page.evaluate(()=>[...document.querySelectorAll('.hud-actions button, .hud-actions a, .hud-actions summary')].map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30)));
  await page.screenshot({path:resolve(out,`world-arrived-dpr${dpr}.png`)});
  // G4: the owner's God modal opens by itself on desktop (GodPanel's remembered choice defaults to open) and covers the
  // canvas, so the input checks below would test the modal: close it first (it is reopened from the God button below)
  if(await page.locator('[data-god-modal][open]').count()){await page.keyboard.press('Escape');await page.waitForTimeout(400);}
  const a=await page.evaluate(cam);const cx=Math.round(W*.45),cy=Math.round(H*.6);
  await page.mouse.move(cx,cy);await page.mouse.down();for(let k=1;k<=10;k++)await page.mouse.move(cx+k*16,cy-k*2);await page.mouse.up();await page.waitForTimeout(700);const d=await page.evaluate(cam);
  await page.mouse.move(cx,cy);await page.mouse.wheel(0,-600);await page.waitForTimeout(900);const wh=await page.evaluate(cam);
  await page.keyboard.down('w');await page.waitForTimeout(1000);await page.keyboard.up('w');await page.waitForTimeout(400);const k=await page.evaluate(cam);
  await page.mouse.dblclick(Math.round(W*.42),Math.round(H*.68));await page.waitForTimeout(2500);const dc=await page.evaluate(cam);
  run.input={drag:moved(a,d,'p'),wheel:moved(d,wh,'p'),wasd:moved(wh,k,'p'),doubleClick:moved(k,dc,'p'),viewOffset:dc?.view};
  // Join as a Soul (God panel → Join section), real typing and click
  const toggle=page.locator('[data-god-panel-toggle]');if(await toggle.isVisible().catch(()=>false))await toggle.click();
  // G4: the owner's God controls are one God modal (the God button right of Explore); open it unless it opened by itself
  const godBtn=page.locator('[data-god-open="owner"]');if(await godBtn.isVisible().catch(()=>false)&&!(await page.locator('[data-god-modal][open]').count()))await godBtn.click();
  const joinTab=page.locator('[data-tab="souls"], [data-tab="join"]').first();if(await joinTab.isVisible().catch(()=>false))await joinTab.click();
  const live=page.locator('summary', {hasText:/Live here yourself/}).first();await live.waitFor({state:'visible',timeout:15000}).catch(()=>{});if(await live.isVisible().catch(()=>false))await live.click();
  const nameBox=page.locator('[data-soul-name]').first();
  if(await nameBox.isVisible().catch(()=>false)){await nameBox.click();await page.keyboard.type('Ana');await page.locator('[data-join-go]').first().click();await page.waitForTimeout(800);run.joinLine=await page.locator('[data-join-line]').first().innerText().catch(()=>null);}
  else{// G5: the owner's own Soul starts from New Soul (beside the avatar), not a Souls tab in God Mode
   await page.keyboard.press('Escape');await page.waitForTimeout(300);
   const ns=page.locator('.bring-agent-open').first();if(!(await ns.isVisible().catch(()=>false)))await page.locator('summary.account-avatar').first().click().catch(()=>{});
   if(await ns.isVisible().catch(()=>false)){await ns.click();run.joinLine=await page.locator('.bring-agent-prompt').first().innerText({timeout:15000}).catch(()=>null);}
   if(!run.joinLine)run.joinLine='(join form not visible)';}
  await page.screenshot({path:resolve(out,`world-join-dpr${dpr}.png`)});
  run.errors=errors;report.runs.push(run);console.log(JSON.stringify({...run,joinLine:run.joinLine?.slice(0,140)}));await ctx.close();}
 finally{await browser.close();}}}
finally{release?.();}
}finally{await fixture?.stop();}
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,1));
