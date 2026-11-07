#!/usr/bin/env node
// Lane PERF probe: how smooth is a new world (entity layer) in real GPU Chrome, at laptop sizes and dpr 1/2.
// Per size x dpr: time to the first entity frame, to "Live", to settled (triangle count stable for 3 s);
// then a still window and an orbit window (real mouse drag) with rAF frame times (fps, p50/p95/p99, stalls),
// long tasks, renderer.render CPU (incl. shadow pass), sampled GPU time (EXT_disjoint_timer_query_webgl2),
// renderer.info (draw calls, triangles, programs, geometries, textures), scene counts and JS heap. One screenshot
// per configuration (after the still window). Chrome lease held for the whole run; machine load is recorded.
//   node tools/god-skill/e2e/perf-probe.mjs <worldUrl> [--sizes 1352x800,1440x900] [--dprs 1,2] [--seconds 6]
//        [--label before] [--out dir] [--name admin] [--settle-max 120] [--mbps 60]
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { findPlaywright } from '../lib/look.mjs';
import { chromeLease } from '../lib/chrome-lease.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && /^https?:/.test(a));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (!url) { console.error('usage: perf-probe.mjs <worldUrl> [--sizes WxH,..] [--dprs 1,2] [--seconds 6] [--label x] [--out dir]'); process.exit(2); }
const sizes = opt('sizes', '1352x800,1440x900').split(',').map((s) => s.split('x').map(Number));
const dprs = opt('dprs', '1,2').split(',').map(Number);
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

const release = await chromeLease('perf-probe');
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const results = [];
try {
  for (const [W, H] of sizes) for (const dpr of dprs) {
    const tag = `${W}x${H}@${dpr}`;
    const load0 = loadavg()[0];
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
    await ctx.addInitScript((name) => { try { localStorage.setItem('sim.dev', name); } catch {} }, opt('name', 'admin'));
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const mbps = Number(opt('mbps', '0'));   // --mbps N: emulate an N Mbit/s link (40 ms latency) to see loading as on the real network
    if (mbps > 0) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: mbps * 125000, uploadThroughput: mbps * 125000 }); }
    const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    const tNav = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    // settled: entity layer active, and the drawn triangle count unchanged for 3 s
    let lastTri = -1, stableSince = Date.now(), settledAt = null;
    for (;;) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(() => ({ active: !!window.__soulsEntity?.layer?.active, tri: window.__perf.lastInfo?.triangles ?? -1, marks: window.__perf.marks }));
      if (s.tri !== lastTri) { lastTri = s.tri; stableSince = Date.now(); }
      if (s.active && s.tri > 0 && Date.now() - stableSince > 3000) { settledAt = stableSince - tNav; break; }
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
    const still = await window_('still', () => page.waitForTimeout(seconds * 1000));
    const stats = await page.evaluate(sceneStats);
    await page.screenshot({ path: resolve(out, `${tag}.png`) });
    const cx = Math.round(W * 0.5), cy = Math.round(H * 0.55);
    const orbit = await window_('orbit', async () => {
      await page.mouse.move(cx - 200, cy); await page.mouse.down();
      const steps = Math.round(seconds * 30);
      for (let k = 0; k < steps; k++) { await page.mouse.move(cx - 200 + Math.round(400 * Math.sin(k / steps * Math.PI)), cy + Math.round(30 * Math.sin(k / 9))); await page.waitForTimeout(16); }
      await page.mouse.up();
    });
    const after = await page.evaluate(() => ({ info: window.__perf.lastInfo, gpuExt: window.__perf.gpuExt, installs: window.__perf.installs }));
    const r = { world: url, label, size: `${W}x${H}`, dpr, load1m: +load0.toFixed(1), timing, load, still, orbit, stats, afterOrbitInfo: after.info, gpuExt: after.gpuExt, rendererInstalls: after.installs, errors };
    results.push(r);
    console.log(`${tag} load ${r.load1m} | first ${timing.firstEntityFrameMs} live ${timing.liveMs} settled ${timing.settledMs} card ${timing.cardDoneMs} ms | load: max ${load.frameMax} >50:${load.over50} >100:${load.over100} lt ${load.longtaskMs}ms afterCard >50:${load.afterCard50} max ${load.afterCardMax} glb ${load.glbAtCard}/${load.glbAll} ${load.glbMBAtCard}/${load.glbMB}MB last ${load.lastGlbEndMs} | still ${still.fps} fps p50 ${still.frameP50} p95 ${still.frameP95} >50:${still.over50} cpu ${still.renderCpuP50}/${still.renderCpuP95} gpu ${still.gpuP50}/${still.gpuP95} | orbit ${orbit.fps} fps p95 ${orbit.frameP95} >50:${orbit.over50} gpu ${orbit.gpuP50}/${orbit.gpuP95} | draws ${stats.info?.calls} tris ${stats.info?.triangles} prog ${stats.programs} geo ${stats.geometries} tex ${stats.textures} meshes ${stats.visibleMeshes}/${stats.meshes} casters ${stats.casters} heap ${stats.heapMB} MB${errors.length ? ' errors ' + errors.length : ''}`);
    await ctx.close();
  }
} finally { await browser.close(); release(); }
writeFileSync(resolve(out, 'report.json'), JSON.stringify(results, null, 1));
console.log('out', out);
