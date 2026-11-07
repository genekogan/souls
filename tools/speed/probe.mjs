#!/usr/bin/env node
// Speed lane probe: new worlds in real GPU Chrome, at desktop DPR 1/2 or CPU-throttled phone DPR 3.
// Per size x DPR: time to first entity frame, "Live", and fully loaded/quiet settling;
// then a still window and an orbit window (real mouse drag) with rAF frame times (fps, p50/p95/p99, stalls),
// long tasks, renderer.render CPU (incl. shadow pass), sampled GPU time (EXT_disjoint_timer_query_webgl2),
// renderer.info (draw calls, triangles, programs, geometries, textures), scene counts and JS heap. One screenshot
// per configuration (after the still window). Chrome lease held for the whole run; machine load is recorded.
//   node tools/speed/probe.mjs <worldUrl> [--sizes 1440x900] [--dprs 1,2] [--seconds 6] [--mobile] [--cpu 4]
//        [--label before] [--out dir] [--name admin] [--settle-max 120] [--mbps 60]
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { findPlaywright } from '../god-skill/lib/look.mjs';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
import { textureStorage } from './texture-storage.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && /^https?:/.test(a));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (!url) { console.error('usage: probe.mjs <worldUrl> [--sizes WxH,..] [--dprs 1,2] [--mobile] [--cpu 4] [--seconds 6] [--label x] [--out dir]'); process.exit(2); }
const sizes = opt('sizes', args.includes('--mobile') ? '390x844' : '1440x900').split(',').map((s) => s.split('x').map(Number));
const dprs = opt('dprs', args.includes('--mobile') ? '3' : '1,2').split(',').map(Number);
const seconds = Number(opt('seconds', '6')), settleMax = Number(opt('settle-max', '120'));
const label = opt('label', 'run');
const out = resolve(opt('out', `.lane/perf/${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
mkdirSync(out, { recursive: true });
const pw = findPlaywright(); if (!pw) throw new Error('no playwright');

// In-page instrumentation, installed before the app runs.
const INIT = `(() => {
  try { performance.setResourceTimingBufferSize(20000); } catch {}
  const P = window.__perf = { frames: [], longtasks: [], marks: {}, render: [], gpu: [], recording: true, installed: false };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const tick = (t) => { if (P.recording) P.frames.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const poll = setInterval(() => {
    const w = window.__soulsEntity;
    if (w && P.renderer !== w.renderer) {
      P.renderer = w.renderer; P.installs = (P.installs || 0) + 1;
      const r = w.renderer, orig = r.render.bind(r), gl = r.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); P.gpuExt = !!ext; let pending = [], n = 0;
      r.render = (s, c) => {
        let q = null;
        if (ext && P.recording && n++ % 4 === 0 && !gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
        const t0 = performance.now(); const res = orig(s, c); const dt = performance.now() - t0;
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
        if (ext && pending.length) { const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT); pending = pending.filter((pq) => { if (!disjoint && !gl.getQueryParameter(pq, gl.QUERY_RESULT_AVAILABLE)) return true; if (!disjoint) P.gpu.push(gl.getQueryParameter(pq, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(pq); return false; }); }
        if (P.recording) P.render.push(dt);
        P.lastInfo = { calls: r.info.render.calls, triangles: r.info.render.triangles, points: r.info.render.points, lines: r.info.render.lines };
        if (w.layer.active && P.marks.firstEntityFrame === undefined && r.info.render.calls > 0) P.marks.firstEntityFrame = performance.now();
        return res;
      };
    }
    if (P.marks.live === undefined && [...document.querySelectorAll('.ok b, .ok')].some((e) => /\\bLive\\b/.test(e.textContent || ''))) P.marks.live = performance.now();
    if (w?.layer?.active && P.marks.layerActive === undefined) P.marks.layerActive = performance.now();
    const card = document.querySelector('.viewer-arrival'); if (card) P.sawCard = true;
    if (P.sawCard && P.marks.cardDone === undefined && (!card || card.getAttribute('data-done') === 'true')) P.marks.cardDone = performance.now();
  }, 50);
})();`;

const sceneStats = () => {
  const w = window.__soulsEntity, r = w.renderer, P = window.__perf;
  let meshes = 0, visibleMeshes = 0, casters = 0, instanced = 0, instances = 0, skinned = 0, lights = 0, shadowLights = [];
  w.scene.traverse((o) => {
    if (o.isMesh) { meshes++; let v = true; for (let p = o; p; p = p.parent) if (!p.visible) { v = false; break; } if (v) { visibleMeshes++; if (o.castShadow) casters++; } if (o.isInstancedMesh) { instanced++; instances += o.count; } if (o.isSkinnedMesh) skinned++; }
    if (o.isLight) { lights++; if (o.castShadow) shadowLights.push({ type: o.type, map: o.shadow.mapSize.toArray(), cam: o.shadow.camera.isOrthographicCamera ? [o.shadow.camera.left, o.shadow.camera.right, o.shadow.camera.top, o.shadow.camera.bottom, o.shadow.camera.far] : null }); }
  });
  const entityMeshes = (() => { let n = 0, c = 0; w.layer.group.traverse((o) => { if (o.isMesh) { let v = true; for (let p = o; p; p = p.parent) if (!p.visible) { v = false; break; } if (v) { n++; if (o.castShadow) c++; } } }); return { visible: n, casters: c }; })();
  return { info: P.lastInfo, programs: r.info.programs?.length ?? null, geometries: r.info.memory.geometries, textures: r.info.memory.textures, meshes, visibleMeshes, casters, instanced, instances, skinned, lights, shadowLights, entityMeshes, layer: w.stats(), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, buffer: [r.domElement.width, r.domElement.height], pixelRatio: r.getPixelRatio(), shadowType: r.shadowMap.type, shadowOn: r.shadowMap.enabled };
};
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))].toFixed(2); };
const summarize = (frames, render, gpu, longtasks, ms) => {
  const iv = frames.slice(1).map((t, i) => t - frames[i]);
  return { fps: +(iv.length * 1000 / Math.max(1, frames.at(-1) - frames[0])).toFixed(1), frameP50: q(iv, 0.5), frameP95: q(iv, 0.95), frameP99: q(iv, 0.99), frameMax: iv.length ? +Math.max(...iv).toFixed(1) : null, over50: iv.filter((x) => x > 50).length, over100: iv.filter((x) => x > 100).length, renderCpuP50: q(render, 0.5), renderCpuP95: q(render, 0.95), gpuP50: q(gpu, 0.5), gpuP95: q(gpu, 0.95), gpuSamples: gpu.length, longtasks: longtasks.length, longtaskMs: Math.round(longtasks.reduce((n, l) => n + l[1], 0)), windowMs: ms };
};

const mobile = args.includes('--mobile'), throttle = Number(opt('cpu', mobile ? '4' : '1'));
const target = new URL(url);
// SPEED_PORTS="6342,6343" lets another lane probe its own fixtures (never the live 4930–4970).
const lanePorts = (process.env.SPEED_PORTS ?? '').split(',').filter(Boolean).map(Number);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || !((Number(target.port) >= 5890 && Number(target.port) <= 5899) || lanePorts.includes(Number(target.port))) || (Number(target.port) >= 4930 && Number(target.port) <= 4990)) throw new Error('speed probe only accepts lane ports 5890–5899 (or SPEED_PORTS) on localhost');
console.log('Waiting for speed Chrome lease');
const release = await chromeLease('speed', { waitMs: Number(opt('lease-wait', '2700000')), staleMs: Infinity });
console.log('Speed Chrome lease acquired');
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const results = [];
try {
  for (const [W, H] of sizes) for (const dpr of dprs) {
    const tag = `${W}x${H}@${dpr}`;
    const load0 = loadavg()[0];
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript((name) => { try { localStorage.setItem('sim.dev', name); } catch {} }, opt('name', 'admin'));
    await ctx.addInitScript(INIT);
    await ctx.addInitScript(`window.__textureStorage = ${textureStorage.toString()};`);
    const page = await ctx.newPage();
    const pendingGlbs = new Set(); let lastGlbActivity = Date.now();
    page.on('request', (r) => { if (/\.glb(\?|$)/.test(r.url())) { pendingGlbs.add(r); lastGlbActivity = Date.now(); } });
    const ended = (r) => { if (pendingGlbs.delete(r)) lastGlbActivity = Date.now(); };
    page.on('requestfinished', ended); page.on('requestfailed', ended);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    let networkBytes = 0, glbWireBytes = 0;
    const glbRequestIds = new Set();
    cdp.on('Network.responseReceived', (e) => { if (/\.glb(\?|$)/.test(e.response.url)) glbRequestIds.add(e.requestId); });
    cdp.on('Network.loadingFinished', (e) => { networkBytes += e.encodedDataLength; if (glbRequestIds.has(e.requestId)) glbWireBytes += e.encodedDataLength; });
    const mbps = Number(opt('mbps', '0'));   // --mbps N: emulate an N Mbit/s link (40 ms latency) to see loading as on the real network
    if (mbps > 0) { await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: mbps * 125000, uploadThroughput: mbps * 125000 }); }
    const requestsFailed = [];
    page.on('response', r => { if (r.status() >= 400 && new URL(r.url()).hostname === target.hostname) requestsFailed.push({ url: r.url(), status: r.status() }); });
    page.on('requestfailed', r => requestsFailed.push({ url: r.url(), failure: r.failure()?.errorText }));
    let phase = 'load';
    const errors = [], errorDetails = [], consoleErrors = [];
    page.on('pageerror', (e) => { errors.push(String(e).slice(0, 300)); if(errorDetails.length<1000) errorDetails.push({phase,stack:e.stack??String(e)}); });
    page.on('console', m => { if(m.type()==='error'&&consoleErrors.length<40) consoleErrors.push({phase,text:m.text()}); });
    console.log(`${tag} navigating ${url}`);
    const tNav = Date.now();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    if (!(response?.headers()['content-type'] ?? '').includes('text/html')) throw new Error('Fixture has no web SPA: build the web app before starting its server');
    // settled: entity layer active, and the drawn triangle count unchanged for 3 s
    let lastTri = -1, stableSince = Date.now(), settledAt = null;
    for (;;) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(() => ({ active: !!window.__soulsEntity?.layer?.active, tri: window.__perf.lastInfo?.triangles ?? -1, marks: window.__perf.marks, unfinished: Object.values(window.__assetStages ?? {}).filter((s) => s !== 'done').length, queue: window.__soulsLoadQueueStats?.() ?? null }));
      if (s.tri !== lastTri) { lastTri = s.tri; stableSince = Date.now(); }
      if (s.active && s.tri > 0 && !s.unfinished && !(s.queue?.pending || s.queue?.activeCopies || s.queue?.active) && !pendingGlbs.size && Date.now() - lastGlbActivity > 7000 && Date.now() - stableSince > 3000) { settledAt = Date.now() - tNav; break; }
      if (Date.now() - tNav > settleMax * 1000) break;
    }
    const marks = await page.evaluate(() => window.__perf.marks);
    const ld = await page.evaluate(() => { const P = window.__perf; const f0 = P.marks.firstEntityFrame ?? 0; const fr = P.frames.filter((t) => t >= f0); const res = performance.getEntriesByType('resource').filter((e) => /\.glb(\?|$)/.test(e.name)); const cut = (t) => res.filter((e) => e.responseEnd <= t); const bytes = (a) => +(a.reduce((n, e) => n + (e.encodedBodySize || e.transferSize || 0), 0) / 1e6).toFixed(1); const cd = P.marks.cardDone ?? 0; const iv = fr.slice(1).map((t, i) => [t, t - fr[i]]).filter(([t]) => t > cd); const after = { over50: iv.filter((x) => x[1] > 50).length, max: iv.length ? Math.round(Math.max(...iv.map((x) => x[1]))) : null }; return { after, frames: fr, longtasks: P.longtasks.filter((l) => l[0] >= f0), glbAll: res.length, glbMB: bytes(res), glbAtCard: cut(cd).length, glbMBAtCard: bytes(cut(cd)), lastGlbEnd: res.length ? Math.round(Math.max(...res.map((e) => e.responseEnd))) : null }; });
    const load = { ...summarize(ld.frames, [], [], ld.longtasks, 0), afterCard50: ld.after.over50, afterCardMax: ld.after.max, glbAll: ld.glbAll, glbMB: ld.glbMB, glbAtCard: ld.glbAtCard, glbMBAtCard: ld.glbMBAtCard, lastGlbEndMs: ld.lastGlbEnd };
    const nav = await page.evaluate(() => performance.timeOrigin);
    const timing = { firstEntityFrameMs: marks.firstEntityFrame ? Math.round(marks.firstEntityFrame) : null, liveMs: marks.live ? Math.round(marks.live) : null, layerActiveMs: marks.layerActive ? Math.round(marks.layerActive) : null, settledMs: settledAt, cardDoneMs: marks.cardDone ? Math.round(marks.cardDone) : null, navOffsetMs: Math.round(nav - tNav) };
    const window_ = async (name, during) => {
      await page.evaluate(() => { const P = window.__perf; P.frames = []; P.render = []; P.gpu = []; P.lt0 = performance.now(); P.recording = true; });
      const t0 = Date.now(); await during(); const ms = Date.now() - t0;
      const d = await page.evaluate(() => { const P = window.__perf; P.recording = false; return { frames: P.frames, render: P.render, gpu: P.gpu, longtasks: P.longtasks.filter((l) => l[0] >= P.lt0) }; });
      return summarize(d.frames, d.render, d.gpu, d.longtasks, ms);
    };
    phase = 'still';
    const still = await window_('still', () => page.waitForTimeout(seconds * 1000));
    const stats = await page.evaluate(sceneStats);
    stats.assets = await page.evaluate(() => { const w=window.__soulsEntity, stages=window.__assetStages??{}, shas=new Set(); const m=w.layer.model; if(m)for(const e of m.entities.values()){const d=m.resolvedDef(e.def);if(d?.make?.kind==='mesh'&&d.make.asset)shas.add(d.make.asset);} return {expected:shas.size,done:[...shas].filter(s=>stages[s]==='done').length,missing:[...shas].filter(s=>stages[s]!=='done')}; });
    stats.textureStorage = await page.evaluate(() => window.__textureStorage(window.__soulsEntity.scene));
    stats.gpuRenderer = await page.evaluate(() => { const gl = window.__soulsEntity.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
    if (/swiftshader|llvmpipe|software/i.test(stats.gpuRenderer)) throw new Error(`Hardware GPU required: ${stats.gpuRenderer}`);
    await page.screenshot({ path: resolve(out, `${tag}.png`) });
    const cx = Math.round(W * 0.5), cy = Math.round(H * 0.55);
    phase = 'orbit';
    const orbit = await window_('orbit', async () => {
      const point = (k, steps) => ({x:cx - Math.min(200, W*.3) + Math.round(Math.min(400, W*.6)*Math.sin(k/steps*Math.PI)),y:cy+Math.round(30*Math.sin(k/9))});
      const steps = Math.round(seconds*30);
      if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(0,steps)]});
      else { const p=point(0,steps); await page.mouse.move(p.x,p.y); await page.mouse.down(); }
      for(let k=0;k<steps;k++) { const p=point(k,steps); if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p]}); else await page.mouse.move(p.x,p.y); await page.waitForTimeout(16); }
      if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); else await page.mouse.up();
    });
    const after = await page.evaluate(() => ({ info: window.__perf.lastInfo, gpuExt: window.__perf.gpuExt, installs: window.__perf.installs }));
    const ui = await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth, buttons: [...document.querySelectorAll('button')].filter(e => e.getClientRects().length).map(e => { const r=e.getBoundingClientRect(); return {text:e.getAttribute('aria-label')||e.title||e.textContent?.slice(0,80), box:[r.x,r.y,r.width,r.height]}; }), bubbleRules: [...document.querySelectorAll('.dialogue-popup, .dialogue-popping')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent?.slice(0,120),font:getComputedStyle(e).fontSize,box:[e.getBoundingClientRect().width,e.getBoundingClientRect().height]})) }));
    const measuredNetwork = { cdpEncodedBytes: networkBytes, glbEncodedBytes: glbWireBytes, note: 'CDP loadingFinished transfer bytes through load/still/orbit; fresh context and cache disabled; excludes ongoing WebSocket stream' };
    let phoneControls = null, phoneInput = null, speechCheck = null;
    try {
    if (mobile) {
      phase = 'phone-controls';
      const control = page.getByRole('button', { name: 'Camera controls', exact: true });
      if (await control.count()) {
        await control.tap();
        const dialog = page.getByRole('dialog', { name: 'Camera', exact: true });
        phoneControls = { opens: await dialog.isVisible(), touchHelp: await dialog.getByRole('heading', { name: 'Touch', exact: true }).isVisible(), box: await dialog.boundingBox() };
        await page.screenshot({ path: resolve(out, `${tag}-controls.png`) });
        await page.keyboard.press('Escape');
      }
    }
    if (mobile) {
      phase = 'phone-touch';
      const beforeTouch = await page.evaluate(() => window.__soulsEntity.camera.position.toArray());
      const ty = Math.round(H*.65), tx = Math.round(W*.45);
      await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:tx,y:ty}] });
      for(let k=1;k<=12;k++){ await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:tx+k*5,y:ty-k*2}] }); await page.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
      await page.waitForTimeout(300);
      const afterTouch = await page.evaluate(() => window.__soulsEntity.camera.position.toArray());
      phoneInput = { touchDragMovedM: Math.hypot(...afterTouch.map((v,i)=>v-beforeTouch[i])) };
      // This fixture speech is an explicit API action with fake minds, after the timing windows.
      // Pairing credentials stay in memory and are never written to evidence.
      const base = new URL(url); base.search='';
      const ownerHeaders = { authorization:'Bearer dev:admin' };
      const me = await (await ctx.request.get(base.href+'/v1/me',{headers:ownerHeaders})).json();
      const soul = me.souls?.find(s=>s.name==='Phone probe');
      if(soul) {
        phase = 'phone-explore';
        const exploreHit = await page.evaluate(() => { const e=document.querySelector('.explore-open'), b=e.getBoundingClientRect(), hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2); return {centerTappable:!!hit?.closest('.explore-open'),interceptor:hit?.closest('button')?.className??hit?.tagName}; });
        phoneInput.explore = exploreHit;
        if(exploreHit.centerTappable) await page.locator('.explore-open').tap({timeout:3000});
        else await page.keyboard.press('Control+k');
        await page.getByRole('searchbox',{name:'Search locations and Souls',exact:true}).fill('Phone probe');
        await page.locator('.explore-soul').filter({hasText:'Phone probe'}).tap();
        const follow = page.locator('#soul-panel .soul-follow');
        phase = 'phone-follow';
        if(await follow.count()) await follow.tap();
        const close = page.getByRole('button',{name:'Close panel',exact:true});
        if(await close.count()) await close.tap();
        await page.waitForTimeout(1200);
        phase = 'phone-speech';
        const pair = await (await ctx.request.post(base.href+`/v1/souls/${soul.id}/pair`,{headers:ownerHeaders,data:{}})).json();
        const credential = await (await ctx.request.post(base.href+'/v1/agent/pair',{data:{code:pair.code,agent:'speed-phone-fixture'}})).json();
        const said = await ctx.request.post(base.href+'/v1/edge/say',{headers:{authorization:`Bearer ${credential.token}`},data:{text:'Hello from this phone. Can you read these two lines while walking through the world?'}});
        const saidBody=await said.json();
        const speechStart=Date.now();
        let speechObserved=false;
        // The slow fixture clock plays 30 ticks (~15 wall seconds) behind the server.
        while(Date.now()-speechStart<30000) {
          if(await page.locator('.dialogue-popup').count()) { speechObserved=true; break; }
          await page.waitForTimeout(200);
        }
        speechCheck = await page.evaluate(() => ({ bubbles:[...document.querySelectorAll('.dialogue-popup')].filter(e=>e.getClientRects().length&&!e.hidden).map(e=>{const b=e.getBoundingClientRect();return {text:e.textContent,font:getComputedStyle(e).fontSize,box:[b.x,b.y,b.width,b.height],clipped:e.scrollHeight>e.clientHeight};}) }));
        speechCheck.sayStatus = said.status();
        speechCheck.tick = saidBody.said?.tick;
        speechCheck.viewerTick = await page.locator('[data-viewer-tick]').getAttribute('data-viewer-tick');
        speechCheck.observedAfterMs = speechObserved ? Date.now()-speechStart : null;
        speechCheck.waitedMs = Date.now()-speechStart;
        speechCheck.accessVia = phoneInput.explore.centerTappable ? 'Explore touch' : 'Explore keyboard shortcut; touch button blocked';
        if(!speechCheck.bubbles.length) speechCheck.unverified='No visible live speech popup';
        await page.screenshot({path:resolve(out,`${tag}-speech.png`)});
      } else speechCheck = {unverified:'Start a fixture with one owned resident named Phone probe to test real speech.'};
    }
    } catch (error) { speechCheck={...speechCheck,error:String(error).split('\n')[0]}; await page.screenshot({path:resolve(out,`${tag}-ui-error.png`)}); }
    const r = { world: url, phoneControls, phoneInput, speechCheck, mobile, cpuThrottle: throttle, network: measuredNetwork, ui, label, size: `${W}x${H}`, dpr, load1m: +load0.toFixed(1), timing, load, still, orbit, stats, afterOrbitInfo: after.info, gpuExt: after.gpuExt, rendererInstalls: after.installs, settled: settledAt !== null && stats.assets.missing.length === 0, queue: await page.evaluate(() => window.__soulsLoadQueueStats?.()), requestsFailed, errors, errorDetails, consoleErrors };
    results.push(r);
    writeFileSync(resolve(out, 'report.json'), JSON.stringify(results, null, 1));
    console.log(`${tag} load ${r.load1m} | first ${timing.firstEntityFrameMs} live ${timing.liveMs} settled ${timing.settledMs} card ${timing.cardDoneMs} ms | load: max ${load.frameMax} >50:${load.over50} >100:${load.over100} lt ${load.longtaskMs}ms afterCard >50:${load.afterCard50} max ${load.afterCardMax} glb ${load.glbAtCard}/${load.glbAll} ${load.glbMBAtCard}/${load.glbMB}MB last ${load.lastGlbEndMs} | still ${still.fps} fps p50 ${still.frameP50} p95 ${still.frameP95} >50:${still.over50} cpu ${still.renderCpuP50}/${still.renderCpuP95} gpu ${still.gpuP50}/${still.gpuP95} | orbit ${orbit.fps} fps p95 ${orbit.frameP95} >50:${orbit.over50} gpu ${orbit.gpuP50}/${orbit.gpuP95} | draws ${stats.info?.calls} tris ${stats.info?.triangles} prog ${stats.programs} geo ${stats.geometries} tex ${stats.textures} meshes ${stats.visibleMeshes}/${stats.meshes} casters ${stats.casters} heap ${stats.heapMB} MB${errors.length ? ' errors ' + errors.length : ''}`);
    await ctx.close();
  }
} finally { await browser.close(); release(); writeFileSync(resolve(out, 'report.json'), JSON.stringify(results, null, 1)); }
writeFileSync(resolve(out, 'report.json'), JSON.stringify(results, null, 1));
console.log('out', out);
