#!/usr/bin/env node
// Lane phones (V4): how a world behaves on a phone, in real GPU Chrome with mobile emulation.
// Emulates a 390×844 phone at dpr 3 (touch, mobile viewport, Android Chrome UA) with the CPU throttled 4×, opens each
// world URL and records: time to the first drawn frame, to the arrival card closing, to settled (draw calls and triangles
// of each frame mode unchanged for 3 s; frame-cadence.mjs); then a still window and a touch-orbit window (real touch events) with rAF frame times (p50/p95);
// draw calls and triangles per frame; an estimate of GPU memory (bytes uploaded to textures, buffers and renderbuffers,
// plus the canvas' own buffers); JS heap; and a readability audit of the text drawn over the 3D view (name tags, speech,
// buttons: font size in CSS px, the smallest touch target). It instruments WebGL itself, so it measures any build
// (main included) without hooks in the app. One screenshot after the still window and one after the orbit.
//   node tools/test-harness/phone-probe.mjs <url> [<url> ...] [--label before] [--out dir] [--seconds 6]
//        [--cpu 4] [--size 390x844] [--dpr 3] [--settle-max 120] [--mbps 0] [--name admin]
// Runs under the shared Chrome lease. Never point it at the live worlds (4930–4970).
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { findPlaywright } from '../god-skill/lib/look.mjs';
import { frameModes, settleKey } from './frame-cadence.mjs';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const urls = args.filter((a, i) => /^https?:/.test(a) && !(i > 0 && args[i - 1].startsWith('--')));
if (!urls.length) { console.error('usage: phone-probe.mjs <url> [...] [--label x] [--out dir]'); process.exit(2); }
for (const u of urls) { const p = Number(new URL(u).port); if (p >= 4930 && p <= 4987) throw new Error(`refusing live-world port ${p}`); }
const [W, H] = opt('size', '390x844').split('x').map(Number);
const dpr = Number(opt('dpr', '3')), cpu = Number(opt('cpu', '4')), seconds = Number(opt('seconds', '6')), settleMax = Number(opt('settle-max', '120'));
const label = opt('label', 'run');
const out = resolve(opt('out', `.lane/phone/${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
mkdirSync(out, { recursive: true });
const pw = findPlaywright(); if (!pw) throw new Error('no playwright');
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

// In-page instrumentation installed before the app: rAF frame times, per-frame draw calls/triangles, and bytes uploaded
// to GL objects (textures by level and format, buffers, renderbuffers), tracked per object so deletes are subtracted.
const INIT = `(() => {
  const P = window.__phone = { frames: [], perFrame: [], recording: true, firstDraw: null, draws: 0, tris: 0, tex: 0, buf: 0, rb: 0, texCount: 0, contexts: 0 };
  P.gpu = []; let qPending = [], qOpen = null;
  const gpuTick = () => { if (!P.gl) { const c = document.querySelector('canvas[aria-label="Live 3D view of the world"]'); const g = c?.getContext('webgl2'); const e = g?.getExtension('EXT_disjoint_timer_query_webgl2'); if (e) { P.gl = g; P.timer = e; } } const gl = P.gl, ext = P.timer; if (!gl || !ext) return; try {
    if (qOpen) { gl.endQuery(ext.TIME_ELAPSED_EXT); qPending.push(qOpen); qOpen = null; }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    qPending = qPending.filter((q) => { if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true; if (!disjoint && P.recording) P.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); return false; });
    if (qPending.length < 4) { qOpen = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qOpen); } P.gpuState = { pending: qPending.length, disjoint }; } catch (err) { P.gpuErr = String(err).slice(0, 120); } };
  const tick = (t) => { gpuTick(); if (P.recording) P.frames.push(t); if (P.draws) { P.perFrame.push([P.draws, P.tris]); if (P.perFrame.length > 600) P.perFrame.shift(); } P.lastDraws = P.draws; P.lastTris = P.tris; P.draws = 0; P.tris = 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const bpp = (fmt, type, gl) => {
    const T = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2, 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x84FA: 4, 0x8C3B: 4, 0x8C3E: 4, 0x8368: 4 };
    const packed = { 0x8033: 1, 0x8034: 1, 0x8363: 1, 0x84FA: 1, 0x8C3B: 1, 0x8C3E: 1, 0x8368: 1 };
    const C = { 0x1903: 1, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x8227: 2, 0x8228: 1, 0x1907: 3, 0x1908: 4, 0x8D94: 1, 0x8228: 1, 0x8D98: 3, 0x8D99: 4, 0x1902: 1, 0x84F9: 1 };
    const sized = { 0x8229: 1, 0x822B: 2, 0x8051: 3, 0x8058: 4, 0x8C41: 3, 0x8C43: 4, 0x881A: 8, 0x8814: 16, 0x881B: 6, 0x8815: 12, 0x822D: 2, 0x822E: 4, 0x822F: 4, 0x8230: 8, 0x81A5: 2, 0x81A6: 4, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8D62: 2, 0x8056: 2, 0x8057: 2, 0x8059: 4, 0x8C3A: 4, 0x8C3D: 4 };
    if (sized[fmt]) return sized[fmt];
    if (packed[type]) return T[type];
    return (C[fmt] || 4) * (T[type] || 1);
  };
  const wrap = (proto) => {
    if (!proto || proto.__phoneWrapped) return; proto.__phoneWrapped = true;
    const bound = new WeakMap();   // gl → {tex: Map(target→tex), buf: Map(target→buf), rb}
    const st = (gl) => { let s = bound.get(gl); if (!s) { s = { unit: 0, tex: new Map(), buf: new Map(), rb: null, texSizes: new WeakMap(), bufSizes: new WeakMap(), rbSizes: new WeakMap() }; bound.set(gl, s); } return s; };
    const o = (name, fn) => { const orig = proto[name]; if (orig) proto[name] = function (...a) { try { fn.call(this, a); } catch {} return orig.apply(this, a); }; };
    const after = (name, fn) => { const orig = proto[name]; if (orig) proto[name] = function (...a) { const r = orig.apply(this, a); try { fn.call(this, a, r); } catch {} return r; }; };
    o('activeTexture', function (a) { st(this).unit = a[0]; });
    o('bindTexture', function (a) { st(this).tex.set(st(this).unit + ':' + a[0], a[1]); });
    const texAdd = (gl, target, level, bytes) => {
      const s = st(gl); const tgt = (target >= 0x8515 && target <= 0x851A) ? 0x8513 : target; const tex = s.tex.get(s.unit + ':' + tgt); if (!tex) return;
      let m = s.texSizes.get(tex); if (!m) { m = new Map(); s.texSizes.set(tex, m); P.texCount++; }
      const key = target + ':' + level; P.tex += bytes - (m.get(key) || 0); m.set(key, bytes);
    };
    o('texImage2D', function (a) {
      let w, h, fmt, type;
      if (a.length >= 8) { w = a[3]; h = a[4]; fmt = a[2]; type = a[7]; } else { const src = a[5]; w = src?.naturalWidth || src?.videoWidth || src?.displayWidth || src?.width || 0; h = src?.naturalHeight || src?.videoHeight || src?.displayHeight || src?.height || 0; fmt = a[2]; type = a[4]; }
      texAdd(this, a[0], a[1], w * h * bpp(fmt, type, this));
    });
    o('texStorage2D', function (a) { const [target, levels, fmt, w, h] = a; const b = bpp(fmt, 0, this); for (let l = 0; l < levels; l++) { const n = Math.max(1, w >> l) * Math.max(1, h >> l) * b; if (target === 0x8513) for (let f = 0; f < 6; f++) texAdd(this, 0x8515 + f, l, n); else texAdd(this, target, l, n); } });
    o('texImage3D', function (a) { texAdd(this, a[0], a[1], a[3] * a[4] * a[5] * bpp(a[2], a[8], this)); });
    o('texStorage3D', function (a) { const [target, levels, fmt, w, h, d] = a; const b = bpp(fmt, 0, this); for (let l = 0; l < levels; l++) texAdd(this, target, l, Math.max(1, w >> l) * Math.max(1, h >> l) * (target === 0x8C1A ? d : Math.max(1, d >> l)) * b); });
    o('compressedTexImage2D', function (a) { const data = a[6]; texAdd(this, a[0], a[1], data?.byteLength ?? (typeof a[6] === 'number' ? a[6] : 0)); });
    o('deleteTexture', function (a) { const s = st(this); const m = s.texSizes.get(a[0]); if (m) { for (const v of m.values()) P.tex -= v; s.texSizes.delete(a[0]); P.texCount--; } });
    o('bindBuffer', function (a) { st(this).buf.set(a[0], a[1]); });
    o('bufferData', function (a) { const s = st(this); const buf = s.buf.get(a[0]); if (!buf) return; const n = typeof a[1] === 'number' ? a[1] : (a[1]?.byteLength ?? 0); P.buf += n - (s.bufSizes.get(buf) || 0); s.bufSizes.set(buf, n); });
    o('deleteBuffer', function (a) { const s = st(this); const n = s.bufSizes.get(a[0]); if (n) { P.buf -= n; s.bufSizes.delete(a[0]); } });
    o('bindRenderbuffer', function (a) { st(this).rb = a[1]; });
    const rbStore = function (samples, fmt, w, h) { const s = st(this); if (!s.rb) return; const n = w * h * bpp(fmt, 0, this) * Math.max(1, samples); P.rb += n - (s.rbSizes.get(s.rb) || 0); s.rbSizes.set(s.rb, n); };
    o('renderbufferStorage', function (a) { rbStore.call(this, 1, a[1], a[2], a[3]); });
    o('renderbufferStorageMultisample', function (a) { rbStore.call(this, a[1], a[2], a[3], a[4]); });
    o('deleteRenderbuffer', function (a) { const s = st(this); const n = s.rbSizes.get(a[0]); if (n) { P.rb -= n; s.rbSizes.delete(a[0]); } });
    const draw = (count, inst, mode) => { if (P.firstDraw === null) P.firstDraw = performance.now(); P.draws++; if (mode === 4) P.tris += (count / 3) * (inst || 1); };
    o('drawElements', function (a) { draw(a[1], 1, a[0]); });
    o('drawArrays', function (a) { draw(a[2], 1, a[0]); });
    o('drawElementsInstanced', function (a) { draw(a[1], a[4], a[0]); });
    o('drawArraysInstanced', function (a) { draw(a[2], a[3], a[0]); });
    o('drawRangeElements', function (a) { draw(a[3], 1, a[0]); });
  };
  wrap(window.WebGL2RenderingContext?.prototype); wrap(window.WebGLRenderingContext?.prototype);
  const ext = WebGL2RenderingContext.prototype.getExtension;
  WebGL2RenderingContext.prototype.getExtension = function (n) { const e = ext.call(this, n); if (e && n === 'WEBGL_multi_draw' && !e.__phone) { e.__phone = true; const md = e.multiDrawElementsWEBGL; if (md) e.multiDrawElementsWEBGL = function (mode, counts, co, type, offs, oo, dc) { for (let i = 0; i < dc; i++) { P.draws++; if (mode === 4) P.tris += counts[co + i] / 3; } return md.apply(this, arguments); }; } return e; };
})();`;

// The text drawn over the view: name tags (CSS2D), speech, buttons. Font size in CSS px, the smallest touch target, and
// what is off-screen or overlapping. 12 CSS px is the floor most phone guidance treats as readable; 44 px touch targets.
const AUDIT = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const textNodes = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || !vis(el)) continue; const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue; textNodes.push({ t: t.slice(0, 40), fs: parseFloat(getComputedStyle(el).fontSize), el }); }
  const fsHist = {}; for (const x of textNodes) { const k = Math.round(x.fs); fsHist[k] = (fsHist[k] || 0) + 1; }
  const small = textNodes.filter((x) => x.fs < 12).map((x) => `${x.fs}px ${x.t}`).slice(0, 15);
  const labelsHost = [...document.querySelectorAll('[data-soul-id]')].filter(vis);
  const tags = labelsHost.map((e) => ({ fs: parseFloat(getComputedStyle(e).fontSize), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }));
  const controls = [...document.querySelectorAll('button, a[href], summary, input, select, [role=button]')].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  const tiny = controls.map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((c) => Math.min(c.w, c.h) < 32);
  const offscreen = controls.filter((e) => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24));
  const canvas = document.querySelector('canvas[aria-label="Live 3D view of the world"]'); const cr = canvas?.getBoundingClientRect();
  const dock = document.querySelector('.dialogue-dock, [data-dialogue-dock]'); const dr = dock && vis(dock) ? dock.getBoundingClientRect() : null;
  return { viewport: [innerWidth, innerHeight], docScroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], canvasCss: cr ? [Math.round(cr.width), Math.round(cr.height)] : null, buffer: canvas ? [canvas.width, canvas.height] : null, textNodes: textNodes.length, fontSizes: fsHist, smallText: small, nameTags: tags.length, nameTagFont: tags[0]?.fs ?? null, controls: controls.length, smallTargets: tiny.slice(0, 15), smallTargetCount: tiny.length, offscreenControls: offscreen, dock: dr ? [Math.round(dr.left), Math.round(dr.top), Math.round(dr.width), Math.round(dr.height)] : null };
};

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))].toFixed(1); };
const summarize = (frames, ms) => { const iv = frames.slice(1).map((t, i) => t - frames[i]); return { fps: +(iv.length * 1000 / Math.max(1, frames.at(-1) - frames[0])).toFixed(1), p50: q(iv, 0.5), p95: q(iv, 0.95), max: iv.length ? +Math.max(...iv).toFixed(0) : null, over50: iv.filter((x) => x > 50).length, over100: iv.filter((x) => x > 100).length, ms }; };

const release = await chromeLease('phones-probe');
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-precise-memory-info', '--explicitly-allowed-ports=6000'] });
const results = [];
try {
  for (const [ui, url] of urls.entries()) {
    const tag = `${new URL(url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-${label}-${new URL(url).searchParams.get('quality') ?? 'auto'}-${ui}`;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: UA });
    await ctx.addInitScript((name) => { try { localStorage.setItem('sim.dev', name); } catch {} }, opt('name', 'admin'));
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    const mbps = Number(opt('mbps', '0'));
    if (mbps > 0) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: mbps * 125000, uploadThroughput: mbps * 125000 }); }
    const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    const load0 = +loadavg()[0].toFixed(1), tNav = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const navOffset = await page.evaluate(() => performance.timeOrigin) - tNav;
    let last = '', stableSince = Date.now(), settledAt = null, revealedAt = null;
    for (;;) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(() => ({ frames: window.__phone.perFrame.splice(0), rev: document.querySelector('.world-canvas-host')?.getAttribute('data-initial-revealed') === 'true' && !document.querySelector('.viewer-arrival:not([data-done="true"])') })).catch(() => null);
      if (!s) continue;
      if (s.rev && revealedAt === null) revealedAt = Date.now() - tNav;
      const key = settleKey(s.frames); if (key !== last) { last = key; stableSince = Date.now(); }
      if (s.rev && key !== null && Date.now() - stableSince > 3000) { settledAt = stableSince - tNav; break; }
      if (Date.now() - tNav > settleMax * 1000) break;
    }
    const firstDraw = await page.evaluate(() => window.__phone.firstDraw);
    const win = async (during) => {
      await page.evaluate(() => { const P = window.__phone; P.frames = []; P.perFrame = []; P.gpu = []; P.recording = true; });
      const t0 = Date.now(); await during(); const ms = Date.now() - t0;
      const d = await page.evaluate(() => { const P = window.__phone; P.recording = false; return { frames: P.frames, perFrame: P.perFrame, gpu: P.gpu }; });
      // drawsP50/trisP50k: the base frames' median (a p50 over alternating base and shadow frames was either by parity)
      const m = frameModes(d.perFrame);
      return { ...summarize(d.frames, ms), drawsP50: m.base?.draws ?? null, trisP50k: m.base ? +(m.base.tris / 1000).toFixed(1) : null, drawsPeak: m.peak?.draws ?? null, trisPeakK: m.peak ? +(m.peak.tris / 1000).toFixed(1) : null, peakShare: m.peakShare, drawsMean: m.meanDraws, drawsMax: d.perFrame.length ? Math.max(...d.perFrame.map((x) => x[0])) : null, gpuP50: q(d.gpu, 0.5), gpuP95: q(d.gpu, 0.95), gpuN: d.gpu.length };
    };
    const still = await win(() => page.waitForTimeout(seconds * 1000));
    // Who draws two frames (one of each mode at a 2-frame cadence), by pass (shadow camera or the view) and owner (the scene path's first three names), with the
    // entity world's own counters: tells a batch, pool or freeze still forming from the periodic shadow pass.
    const drawOwners = await page.evaluate(async () => {
      const w = window.__simEntity; if (!w?.renderer) return null;
      const key = (o) => { const path = []; for (let p = o; p && p !== w.scene; p = p.parent) path.unshift(p.name || p.userData?.kind || p.type); return path.slice(0, 3).join(' / '); };
      const r = w.renderer, orig = r.renderBufferDirect, frame = {}; let on = false;
      r.renderBufferDirect = function (camera, scene, geometry, material, object) { if (on) { const k = (camera.isOrthographicCamera ? 'shadow ' : camera.isPerspectiveCamera ? 'main ' : 'other ') + key(object), n = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0; const e = frame[k] ??= [0, 0]; e[0]++; e[1] += Math.round(n / 3 * (object.isInstancedMesh ? object.count : 1)); } return orig.apply(this, arguments); };
      try { for (let n = 0; n < 3; n++) await new Promise((res) => requestAnimationFrame(() => { on = n < 2; res(); })); } finally { r.renderBufferDirect = orig; }
      const sorted = Object.entries(frame).sort((a, b) => b[1][0] - a[1][0]), passes = {};
      for (const [k, [d, t]] of sorted) { const e = passes[k.split(' ')[0]] ??= [0, 0]; e[0] += d; e[1] += t; }
      return { passes, owners: Object.fromEntries(sorted.slice(0, 40)), stats: w.stats?.() ?? null };
    }).catch((e) => String(e));
    const mem = await page.evaluate(() => { const P = window.__phone; const c = document.querySelector('canvas[aria-label="Live 3D view of the world"]'); const fb = c ? c.width * c.height * (4 + 4) * 4 + c.width * c.height * 4 * 2 : 0; return { texMB: +(P.tex / 1048576).toFixed(1), textures: P.texCount, bufMB: +(P.buf / 1048576).toFixed(1), rbMB: +(P.rb / 1048576).toFixed(1), canvasMB: +(fb / 1048576).toFixed(1), totalMB: +((P.tex + P.buf + P.rb + fb) / 1048576).toFixed(1), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, quality: window.__simQuality?.tier ?? null, detail: window.__simQuality?.detail?.() ?? null, lod: window.__simQuality?.lod?.() ?? null, standIns: window.__simQuality?.standIns?.() ?? null, gpuState: P.gpuState ?? null, gpuErr: P.gpuErr ?? null, gpuGl: !!P.gl }; });
    const audit = await page.evaluate(AUDIT);
    await page.screenshot({ path: resolve(out, `${tag}-still.png`) });
    // one-finger touch orbit across the middle of the view, then a two-finger pinch in
    const cx = Math.round(W / 2), cy = Math.round(H * 0.5);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const orbit = await win(async () => {
      const steps = Math.round(seconds * 20);
      await touch('touchStart', [[cx - 120, cy]]);
      for (let k = 1; k <= steps; k++) { await touch('touchMove', [[cx - 120 + Math.round(240 * Math.sin(k / steps * Math.PI)), cy + Math.round(20 * Math.sin(k / 7))]]); await page.waitForTimeout(25); }
      await touch('touchEnd', []);
      await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
      for (let k = 1; k <= 20; k++) { await touch('touchMove', [[cx - 40 - k * 4, cy], [cx + 40 + k * 4, cy]]); await page.waitForTimeout(25); }
      await touch('touchEnd', []);
    });
    const camMoved = await page.evaluate(() => JSON.stringify(window.__simCamera ?? null));
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(out, `${tag}-orbit.png`) });
    // Speech: the first resident (fake mind) says a line through the edge API; then the bubbles and tags are audited.
    let speech = null;
    if (args.includes('--speak')) {
      const base = url.split('?')[0].replace(/\/$/, ''), owner = { authorization: 'Bearer dev:admin' };
      const mine = (await (await ctx.request.get(base + '/v1/me', { headers: owner })).json().catch(() => null))?.souls ?? [];
      const soul = mine.find((s) => s.name === 'Phone probe') ?? mine[0];
      let speechTap = 'no avatar button';
      if (soul) {
        const pair = await (await ctx.request.post(`${base}/v1/souls/${soul.id}/pair`, { headers: owner, data: {} })).json();
        const cred = await (await ctx.request.post(base + '/v1/agent/pair', { data: { code: pair.code, agent: 'phones-probe' } })).json();
        const open = page.locator(`[aria-label="Open ${soul.name}"]`).first();
        const collapse = page.getByRole('button', { name: 'collapse', exact: true });
        if (await collapse.count()) await collapse.first().tap({ timeout: 4000 }).catch(() => {});
        if (await open.count()) speechTap = await open.tap({ timeout: 4000, trial: true }).then(() => 'avatar tappable', () => 'avatar covered by another control');
        // Frame the speaker at a phone-chat distance (entity worlds expose the camera): the tag's anchor is the head.
        speechTap += ' / ' + await page.evaluate((id) => { const w = window.__simEntity; let at = null; (w?.labelScene ?? w?.scene)?.traverse((o) => { if (o.isCSS2DObject && o.element?.dataset?.soulId === id) at = o.position.clone(); }); if (!at) return 'speaker not found'; w.controls.target.copy(at); w.camera.position.set(at.x + 5, at.y + 2.5, at.z + 7); w.camera.lookAt(at); w.controls.update?.(); return 'framed'; }, soul.id);
        await page.waitForTimeout(2000);
        const said = await ctx.request.post(base + '/v1/edge/say', { headers: { authorization: `Bearer ${cred.token}` }, data: { text: 'Hello from this phone. Can you read these two lines while walking through the world?' } });
        await page.waitForFunction(() => [...document.querySelectorAll('.dialogue-popup')].some((e) => !e.hidden && e.getClientRects().length), null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(600);
        speech = await page.evaluate(() => ({ bubbles: [...document.querySelectorAll('.dialogue-popup, .dialogue-popping, .dialogue-dock')].filter((e) => e.getClientRects().length && !e.hidden).map((e) => { const b = e.getBoundingClientRect(); return { cls: e.className.slice(0, 40), text: (e.textContent || '').slice(0, 60), font: getComputedStyle(e).fontSize, box: [b.x, b.y, b.width, b.height].map(Math.round), clipped: e.scrollHeight > e.clientHeight + 1 }; }) }));
        speech.sayStatus = said.status(); speech.sayBody = (await said.text()).slice(0, 160); speech.avatarTap = speechTap;
        await page.screenshot({ path: resolve(out, `${tag}-speech.png`) });
      } else speech = { unverified: 'no resident' };
    }
    const r = { url, label, size: `${W}x${H}`, dpr, cpu, load1m: load0, timing: { firstDrawMs: firstDraw === null ? null : Math.round(firstDraw + navOffset), revealedMs: revealedAt, settledMs: settledAt }, still, drawOwners, orbit, mem, audit, speech, camMoved: camMoved !== 'null' ? 'tracked' : 'n/a', errors };
    results.push(r);
    console.log(`${tag} load ${load0} | first ${r.timing.firstDrawMs} revealed ${revealedAt} settled ${settledAt} ms | still ${still.fps}fps p50 ${still.p50} p95 ${still.p95} >50:${still.over50} draws ${still.drawsP50} tris ${still.trisP50k}k${still.drawsPeak ? ` (${still.peakShare} of frames ${still.drawsPeak} / ${still.trisPeakK}k)` : ''} gpu ${still.gpuP50}/${still.gpuP95}ms | orbit ${orbit.fps}fps p50 ${orbit.p50} p95 ${orbit.p95} draws ${orbit.drawsP50} gpu ${orbit.gpuP50}/${orbit.gpuP95}ms | gpu ~${mem.totalMB}MB (tex ${mem.texMB} ×${mem.textures}, buf ${mem.bufMB}, rb ${mem.rbMB}, canvas ${mem.canvasMB}) heap ${mem.heapMB}MB quality ${mem.quality} ${mem.detail ? `culled ${mem.detail.culled}/${mem.detail.candidates} noshadow ${mem.detail.shadowSkipped} ${mem.detail.cpuMs.toFixed(2)}ms` : ""}${mem.lod ? ` lod ${mem.lod.coarser}/${mem.lod.ready}/${mem.lod.meshes} tris ${Math.round(mem.lod.triangles / 1000)}k of ${Math.round(mem.lod.fullTriangles / 1000)}k ${mem.lod.cpuMs.toFixed(2)}ms build ${Math.round(mem.lod.buildMs)}ms` : ''}${mem.standIns ? ` cards ${mem.standIns.cards}/${mem.standIns.cards + mem.standIns.near} saved ${Math.round(mem.standIns.trianglesSaved / 1000)}k ${mem.standIns.cpuMs.toFixed(2)}ms` : ''} | text<12px ${audit.smallText.length} tags ${audit.nameTags}@${audit.nameTagFont}px targets<32 ${audit.smallTargetCount}${errors.length ? ' errors ' + errors.length : ''}`);
    await ctx.close();
  }
} finally { await browser.close(); release(); }
writeFileSync(resolve(out, 'report.json'), JSON.stringify(results, null, 1));
console.log('out', out);
