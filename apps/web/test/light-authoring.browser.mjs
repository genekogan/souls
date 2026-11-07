#!/usr/bin/env node
// L1's real-look/performance measure. Requires an isolated fake world named l1 on 127.0.0.1:5363,
// current web dist, Node 22.20 and an already installed Playwright + Chrome. No downloads or remote requests.
// EDEN_GOD_NO_NPX=1 node apps/web/test/light-authoring.browser.mjs
// The two light fixtures are one undoable edit, removed in finally. No motion-test entities are needed.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findPlaywright, chromeLease } from '../../../tools/god-skill/lib/look.mjs';
const base='http://127.0.0.1:5363/w/l1';
const out=resolve(`.e2e/runs/l1-light-motion-${new Date().toISOString().replace(/[:.]/g,'-')}`);mkdirSync(out,{recursive:true});
process.env.EDEN_GOD_NO_NPX='1';
const pw=findPlaywright();if(!pw)throw Error('Playwright must already be installed; downloads are disabled');
const release=await chromeLease('L1 light-motion verification');let browser,token,edited=false;
const report={status:'blocked',errors:[],blockedOrigins:[],measures:{}};
const post=async(path,body,auth=token)=>{const r=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
try{
 browser=await pw.chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist','--disable-background-networking','--disable-sync','--proxy-server=http://127.0.0.1:5363','--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 report.status='fail';
 const context=await browser.newContext({viewport:{width:1352,height:800},deviceScaleFactor:1});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5363')return route.continue();report.blockedOrigins.push(u.origin);return route.abort();});
 await context.routeWebSocket('**/*',route=>{const u=new URL(route.url());if(u.hostname==='127.0.0.1'&&u.port==='5363')route.connectToServer();else route.close();});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 const goto=async(at,eye)=>{await page.goto(`${base}?dev=1&shot=1&hour=21:00&weather=clear&at=${at}&eye=${eye}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__shotReady&&window.__soulsEntity?.layer?.active,{},{timeout:60000});await page.waitForTimeout(2500);};
 await goto('106,1,21','135,26,60');
 await page.screenshot({path:out+'/nightmarket-21.png'});
 report.measures.nightmarket=await page.evaluate(()=>new Promise(resolve=>{const frames=[],t0=performance.now();const tick=t=>{frames.push(t);if(t-t0<6000)return requestAnimationFrame(tick);const dt=frames.slice(1).map((x,i)=>x-frames[i]).sort((a,b)=>a-b);resolve({fps:1000*(frames.length-1)/(frames.at(-1)-frames[0]),p50:dt[Math.floor(dt.length*.5)],p95:dt[Math.floor(dt.length*.95)],frames:frames.length});};requestAnimationFrame(tick);}));
 const mint=await post('/v1/god/mint',{label:'L1 light smoke'},'dev:admin');assert.equal(mint.world,'l1-1');token=mint.token;
 const def={schema:'def/1',name:'l1-offset-lantern',tags:['lamp','decor'],layer:'decor',size:{box:[9,3.2,.6]},make:{kind:'gen',gen:'kit/2',args:{shapes:[{kind:'box',at:[0,.15,0],size:[.6,.3,.6],color:'#4888bb',collide:false},{kind:'box',at:[4,3,0],size:[8,.08,.08],color:'#555555',collide:false},{kind:'sphere',at:[8,3,0],r:.2,segments:6,color:'#ffe9c4',glow:1,collide:false}]}},components:{light:{at:[8,3,0],range:4,pattern:'pulse'}}};
 const result=await post('/v1/god/act',{group:'l1-light-smoke',ops:[{op:'define',def},{op:'place',def:'l1-offset-lantern@1',name:'l1-offset-lantern',p:[230,250]},{op:'place',def:'core/twinkle-lights@1',name:'l1-eight-bulbs',p:[235,262]}]});assert.equal(result.accepted,true,JSON.stringify(result));edited=true;
 await goto('235,1,255','249,17,278');
 const marks=await page.evaluate(()=>window.__soulsEntity.scene.getObjectByName('god-world lights (presentation)').userData.edenLightSources);
 assert.ok(marks.some(m=>Math.abs(m[0]-238)<.01&&Math.abs(m[2]-250)<.01),'offset pool must be under the bulb, beyond the old z=190 map edge');
 await page.screenshot({path:out+'/offset-and-twinkle-21.png'});await page.waitForTimeout(750);await page.screenshot({path:out+'/offset-and-twinkle-next.png'});
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(800);await page.screenshot({path:out+'/reduced-motion-21.png'});
 report.measures.offset={pool:[238,250],origin:[230,250],bulb:[238,3,250],anchorVerified:true};
 assert.equal(report.errors.filter(e=>/WebGLProgram|shader|GL_INVALID/i.test(e)).length,0,'no shader errors');
 assert.equal(report.errors.length,0,'the full replay must render without missing assets or runtime errors');
 assert.ok(report.measures.nightmarket.fps>=59,'night market must sustain approximately 60 fps');
 report.status='pass';report.visualReview='Inspect the PNGs: pool under offset bulb; eight bulbs glow and change gently; reduced motion holds steady.';
}catch(e){report.error=String(e.message);process.exitCode=1;}
finally{
 if(edited){try{const undo=await post('/v1/god/undo?group=l1-light-smoke',{});report.cleanup=undo.accepted===true;if(!report.cleanup){report.status='fail';process.exitCode=1;}}catch(e){report.cleanupError=String(e.message);report.status='fail';process.exitCode=1;}}
 await browser?.close().catch(()=>{});release();writeFileSync(out+'/summary.json',JSON.stringify(report,null,2)+'\n');
 writeFileSync(out+'/index.html',`<!doctype html><meta charset="utf-8"><title>L1 light and motion proof</title><h1>${report.status}</h1><pre>${JSON.stringify(report,null,2).replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre>`+['nightmarket-21','offset-and-twinkle-21','offset-and-twinkle-next','reduced-motion-21'].map(n=>`<p>${n}</p><img style="max-width:100%" src="${n}.png">`).join(''));
 console.log(JSON.stringify({out,...report}));
}
