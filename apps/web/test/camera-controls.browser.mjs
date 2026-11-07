// VF2/VF3: one "your camera" (RTS style), Broadcast as an on/off pill in the top bar, Follow from the Soul card, and one
// camera help card from the header. Fresh fake Eden with DEV_AUTH on 127.0.0.1:4960 (owner tools behind the
// local auth UI). Fake world, $0.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../../../',import.meta.url).pathname,base='http://127.0.0.1:4960';
assert.equal((await(await fetch(base+'/w/eden/v1/config')).json()).devAuth,true);
process.env.PLAYWRIGHT_BROWSERS_PATH??=root+'.e2e/browsers';
const {chromium}=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url))('@playwright/test');
const run=root+'.e2e/runs/app-camera-controls-'+new Date().toISOString().replaceAll(':','-');mkdirSync(run,{recursive:true});
writeFileSync(run+'/source.txt',execFileSync('git',['rev-parse','HEAD'],{cwd:root})+'\n'+execFileSync('git',['status','--short'],{cwd:root}));
const checks=[],errors=[];const check=(name,value)=>{assert.ok(value,name);checks.push({name,pass:true});};
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});let page,status='fail';
const data=k=>page.locator('.viewer-history').getAttribute('data-viewer-'+k);
const mode=m=>page.waitForFunction(m=>document.querySelector('.viewer-history')?.dataset.viewerMode===m,m,{timeout:30000});
const cam=()=>page.evaluate(()=>globalThis.__soulsCamera);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
try{
 const context=await browser.newContext({viewport:{width:1200,height:850}});
 await context.addInitScript(()=>{localStorage.setItem('sim.dev','admin');localStorage.setItem('sim.authUi','1');});
 assert.equal((await context.request.post(base+'/w/eden/v1/admin',{headers:{authorization:'Bearer dev:admin'},data:{action:'clock_rate',rate:4}})).status(),200);
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/w/eden?rewind=1');
 await page.locator('[data-viewer-status]').filter({hasText:'Live'}).waitFor({timeout:120000});
 const broadcast=page.locator('.viewer-broadcast');
 check('Broadcast is an on/off pill beside Live in the top bar; no camera mode menu',await broadcast.getAttribute('aria-pressed')==='true'&&await page.getByRole('radiogroup').count()===0&&await data('mode')==='broadcast');
 // Help card: × (glyph centre), Escape and clicking outside all close it.
 const open=async()=>{await page.getByRole('button',{name:'Camera controls',exact:true}).click();await page.getByRole('dialog',{name:'Camera'}).waitFor();};
 await open();const help=page.getByRole('dialog',{name:'Camera'});
 check('One help card shows mouse and keyboard controls',await help.getByRole('heading',{name:'Mouse'}).isVisible()&&await help.getByRole('heading',{name:'Keyboard'}).isVisible()&&await help.getByText('zoom toward the pointer',{exact:true}).isVisible());
 const x=await help.getByRole('button',{name:'Close',exact:true}).boundingBox();
 check('The whole × is its button (glyph centre hits it; 44 px target)',await page.evaluate(([cx,cy])=>!!document.elementFromPoint(cx,cy)?.closest('.camera-help-close'),[x.x+x.width/2,x.y+x.height/2])&&x.width>=44);
 await page.mouse.click(x.x+x.width/2,x.y+x.height/2);await help.waitFor({state:'hidden'});check('Clicking the × glyph closes the help',true);
 await open();await page.keyboard.press('Escape');await help.waitFor({state:'hidden'});check('Escape closes the help',true);
 await open();await page.mouse.click(20,420);await help.waitFor({state:'hidden'});check('Clicking outside closes the help',true);
 // Keys take the camera from Broadcast and pan across the ground, keeping height.
 await page.locator('body').click({position:{x:5,y:5}}).catch(()=>{});
 const before=await cam();await page.keyboard.down('KeyD');await page.waitForTimeout(700);await page.keyboard.up('KeyD');await mode('manual');
 await page.waitForTimeout(600);const after=await cam();
 check('A move key hands the camera over and pans it (radius kept, pivot re-anchored to the ground)',dist(before.p,after.p)>1&&Math.abs(dist(after.p,after.pivot)-dist(before.p,before.pivot))<dist(before.p,before.pivot)*.6+3);
 check('Broadcast pill turns into "Back to broadcast"',await broadcast.getAttribute('aria-pressed')==='false'&&await page.getByRole('button',{name:'Back to broadcast',exact:true}).isVisible());
 await page.keyboard.down('KeyE');await page.waitForTimeout(400);await page.keyboard.up('KeyE');await page.keyboard.down('KeyR');await page.waitForTimeout(300);await page.keyboard.up('KeyR');
 check('Q/E rotate and R/F raise around the pivot',dist((await cam()).p,after.p)>.5);
 await broadcast.click();await mode('broadcast');check('Back to broadcast returns the camera',await broadcast.getAttribute('aria-pressed')==='true');
 const canvas=page.locator('canvas'),box=await canvas.boundingBox();
 await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6+60,box.y+box.height*.5+10,{steps:6});
 check('Dragging shows the pivot marker',(await cam()).marker===true);await page.mouse.up();await mode('manual');check('A drag takes the camera from Broadcast',true);
 const z0=await cam();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.6);for(let i=0;i<4;i++)await page.mouse.wheel(0,-120);await page.waitForTimeout(2500);
 const z1=await cam();check(`Scroll zooms the camera in (moved ${dist(z1.p,z0.p).toFixed(2)} m, height ${z0.p[1]} -> ${z1.p[1]})`,dist(z1.p,z0.p)>.5&&z1.p[1]<=z0.p[1]+.05);
 await page.mouse.dblclick(box.x+box.width*.5,box.y+box.height*.55);await page.waitForTimeout(1200);check('Double-click flies to the point (no errors, your camera)',await data('mode')==='manual');
 // Follow lives on the Soul card.
 await page.getByRole('button',{name:'Your Soul',exact:true}).click();await page.locator('#soul-panel').waitFor({state:'visible'});
 await page.locator('#soul-panel .soul-follow').click();await mode('follow');
 check('Follow from the Soul card: chip "Following Eden ×" and the card shows Following',await page.locator('.viewer-following').innerText().then(t=>/Following\s+Eden/.test(t))&&await page.locator('#soul-panel .soul-follow').getAttribute('aria-pressed')==='true');
 await page.mouse.move(box.x+box.width*.3,box.y+box.height*.45);await page.mouse.down();await page.mouse.move(box.x+box.width*.3+40,box.y+box.height*.45+8,{steps:4});await page.mouse.up();
 check('Dragging while following orbits and keeps Follow',await data('mode')==='follow');
 await page.locator('body').click({position:{x:5,y:300}}).catch(()=>{});await page.keyboard.down('KeyW');await page.waitForTimeout(300);await page.keyboard.up('KeyW');await mode('manual');
 check('A move key ends Follow',true);
 await page.locator('#soul-panel .soul-follow').click();await mode('follow');await page.getByRole('button',{name:'Stop following',exact:true}).click();await mode('manual');
 check('The × on the Following chip ends Follow',await page.locator('.viewer-following').count()===0);
 // History still works beside the new chrome.
 await page.waitForFunction(()=>Number(document.querySelector('.viewer-history')?.dataset.viewerTick)>=1300,null,{timeout:90000});
 await page.getByRole('button',{name:'Back 1 min',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.viewer-history')?.dataset.viewerPresentation==='history',null,{timeout:60000});
 await page.getByRole('button',{name:'Return to live',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.viewer-history')?.dataset.viewerPresentation==='live');
 await page.screenshot({path:run+'/desktop-camera.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Close panel',exact:true}).click().catch(()=>{});await page.waitForTimeout(600);
 const bar=await page.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e||e.closest('[hidden]'))return null;const b=e.getBoundingClientRect();return b.width?b:null;};
  const hit=(a,b)=>a&&b&&a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom;const items=[r('.viewer-status'),r('.viewer-camera-chip'),r('.dialogue-dock.closed'),r('.bring-agent-open'),r('.hud-camera'),r('.eden-tour')];
  const ok=items.every((a,i)=>items.every((b,j)=>i>=j||!hit(a,b)))&&items.every(a=>!a||(a.left>=0&&a.right<=innerWidth&&a.bottom<innerHeight/3));return ok&&!!r('.hud-camera')&&!!r('.bring-agent-open')&&document.documentElement.scrollWidth<=innerWidth;});
 check('Phone: the top bar (status, camera chip, conversations, New Soul, camera button) has no overlaps and nothing sits at the bottom',bar);
 await page.getByRole('button',{name:'Camera controls',exact:true}).click();
 check('Phone: the help card shows touch gestures',await page.getByRole('dialog',{name:'Camera'}).getByRole('heading',{name:'Touch'}).isVisible());
 const dialog=await page.getByRole('dialog',{name:'Camera'}).boundingBox();check('Phone: help card fits the screen',dialog.x>=0&&dialog.x+dialog.width<=390&&dialog.y>=0&&dialog.y+dialog.height<=844);
 await page.screenshot({path:run+'/phone-help.png'});await page.keyboard.press('Escape');
 writeFileSync(run+'/app.yml',await page.locator('body').ariaSnapshot());
 check('No page errors',errors.length===0);status='pass';
}catch(error){if(page){await page.screenshot({path:run+'/failure.png'}).catch(()=>{});writeFileSync(run+'/failure.yml',await page.locator('body').ariaSnapshot().catch(()=>''));}writeFileSync(run+'/failure.txt',String(error));throw error;
}finally{await browser.close();writeFileSync(run+'/summary.json',JSON.stringify({status,checks,errors,limits:['fake local world','software WebGL timings','phone viewport is not physical device qualification']},null,2));console.log(run+' '+status+' '+checks.length+' checks');}
