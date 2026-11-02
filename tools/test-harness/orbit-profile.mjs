#!/usr/bin/env node
// Lane PERF-EVENTLOOP (2026-11-02): where the main thread goes during an orbit, per frame, by source function.
// Opens a world URL in real headless Chrome (the shared Chrome lease, like phone-probe.mjs), waits for the picture to settle
// (revealed, draw calls and triangles unchanged for 3 s), then records a CDP CPU profile (100 µs sampling) over a touch orbit
// of `--seconds`, counts the rAF frames meanwhile, and maps every sample to its original source through the build's source
// maps (`--dist <dir>` holds the served assets/*.js.map; build with `vite build --sourcemap`). Reports, per frame: the
// inclusive time of WorldEntityLayer.update, cull and decideCuts, renderer.render, the whole sampled main thread, and the
// top self-time functions under update.
//   node tools/test-harness/orbit-profile.mjs <url> --dist apps/web/dist [--seconds 10] [--size 1418x899] [--dpr 1]
//        [--cpu 1] [--label head] [--out dir] [--settle-max 180]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { findPlaywright } from '../god-skill/lib/look.mjs';
import { settleKey } from './frame-cadence.mjs';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
// source-map-js is vite's own dependency: resolve it from where vite lives (pnpm puts a package's dependencies beside it)
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { SourceMapConsumer } = createRequire(webRequire.resolve('vite'))('source-map-js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const url = args.find((a) => /^https?:/.test(a)); if (!url) { console.error('usage: orbit-profile.mjs <url> --dist <dir>'); process.exit(2); }
{ const p = Number(new URL(url).port); if (p >= 4930 && p <= 4987) throw new Error(`refusing live-world port ${p}`); }
const dist = resolve(opt('dist', 'apps/web/dist')), seconds = Number(opt('seconds', '10')), label = opt('label', 'run');
const [W, H] = opt('size', '1418x899').split('x').map(Number), dpr = Number(opt('dpr', '1')), cpu = Number(opt('cpu', '1')), settleMax = Number(opt('settle-max', '180'));
const out = resolve(opt('out', `.lane/profile/${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`)); mkdirSync(out, { recursive: true });
const pw = findPlaywright(); if (!pw) throw new Error('no playwright');

const INIT = `(() => { const P = window.__orbit = { frames: 0, perFrame: [], draws: 0, tris: 0, recording: false, updates: [] };
  const tick = () => { if (P.recording) P.frames++; if (P.draws) { P.perFrame.push([P.draws, P.tris]); if (P.perFrame.length > 600) P.perFrame.shift(); } P.draws = 0; P.tris = 0; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const wrap = (proto) => { if (!proto || proto.__orbitWrapped) return; proto.__orbitWrapped = true;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) { const orig = proto[name]; if (!orig) continue; proto[name] = function (...a) { P.draws++; const n = name.startsWith('drawElements') ? a[1] : a[2], instances = name === 'drawElementsInstanced' ? a[4] : name === 'drawArraysInstanced' ? a[3] : 1; if (a[0] === 4) P.tris += (n || 0) * instances / 3; return orig.apply(this, a); }; } };
  wrap(window.WebGL2RenderingContext?.prototype); wrap(window.WebGLRenderingContext?.prototype); })();`;

const release = await chromeLease('orbit-profile');
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--explicitly-allowed-ports=6000'] });
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, hasTouch: true });
  await ctx.addInitScript((name) => { try { localStorage.setItem('sim.dev', name); } catch {} }, 'admin');
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const tNav = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  let last = '', stableSince = Date.now(), settledAt = null;
  for (;;) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => ({ frames: window.__orbit.perFrame.splice(0), rev: document.querySelector('.world-canvas-host')?.getAttribute('data-initial-revealed') === 'true' && !document.querySelector('.viewer-arrival:not([data-done="true"])') })).catch(() => null);
    if (!s) continue;
    const key = settleKey(s.frames); if (key !== last) { last = key; stableSince = Date.now(); }
    if (s.rev && key !== null && Date.now() - stableSince > 3000) { settledAt = stableSince - tNav; break; }
    if (Date.now() - tNav > settleMax * 1000) break;
  }
  const entityCount = await page.evaluate(() => window.__simEntity?.layer?.entityCount ?? null);
  const loop = await page.evaluate(() => window.__simEntity?.layer?.loopStats ?? null);
  // the orbit (the probe's gesture: one finger across the middle, then a pinch) under the profiler
  const cx = Math.round(W / 2), cy = Math.round(H * 0.5);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await page.evaluate(() => {
    const p = window.__orbit, layer = window.__simEntity?.layer;
    if (!layer) throw new Error('entity layer not available');
    const update = layer.update;
    layer.update = function (...args) { const t = performance.now(); try { return update.apply(this, args); } finally { if (p.recording) p.updates.push(performance.now() - t); } };
    p.frames = 0; p.recording = true;
  });
  await cdp.send('Profiler.start'); const t0 = Date.now();
  const steps = Math.round(seconds * 40);
  await touch('touchStart', [[cx - 120, cy]]);
  for (let k = 1; k <= steps; k++) { await touch('touchMove', [[cx - 120 + Math.round(240 * Math.sin(k / steps * Math.PI)), cy + Math.round(20 * Math.sin(k / 7))]]); await page.waitForTimeout(25); }
  await touch('touchEnd', []);
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let k = 1; k <= 20; k++) { await touch('touchMove', [[cx - 40 - k * 4, cy], [cx + 40 + k * 4, cy]]); await page.waitForTimeout(25); }
  await touch('touchEnd', []);
  const { profile } = await cdp.send('Profiler.stop'); const wallMs = Date.now() - t0;
  const frames = await page.evaluate(() => { window.__orbit.recording = false; return window.__orbit.frames; });
  const updateTimes = await page.evaluate(() => window.__orbit.updates);
  await page.screenshot({ path: resolve(out, 'orbit.png') });
  writeFileSync(resolve(out, 'profile.cpuprofile'), JSON.stringify(profile));
  await ctx.close();

  // source-map every node's call frame: (original file, function name); the map's own name for the frame, else the minified one
  const maps = new Map();
  const consumer = (u) => { const m = /\/assets\/([^/?#]+\.js)/.exec(u); if (!m) return null; if (!maps.has(m[1])) { const p = resolve(dist, 'assets', m[1] + '.map'); maps.set(m[1], existsSync(p) ? new SourceMapConsumer(JSON.parse(readFileSync(p, 'utf8'))) : null); } return maps.get(m[1]); };
  const where = (cf) => { const c = consumer(cf.url); if (!c) return { file: cf.url.replace(/^.*\//, '') || '(native)', name: cf.functionName || '(anonymous)' }; const o = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber }); const file = o.source ? o.source.replace(/^.*?\/(apps|packages|mars|node_modules)\//, '$1/') : cf.url.replace(/^.*\//, ''); return { file, name: o.name || cf.functionName || '(anonymous)' }; };
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const key = new Map(); const keyOf = (id) => { let k = key.get(id); if (!k) { const w = where(nodes.get(id).callFrame); k = { ...w, id: `${w.file}:${w.name}` }; key.set(id, k); } return k; };
  const self = new Map(), incl = new Map(), underUpdate = new Map(); let total = 0;
  const isLayer = (k, name) => k.file.endsWith('WorldEntityLayer.ts') && k.name === name;
  const marks = { update: (k) => isLayer(k, 'update'), cull: (k) => isLayer(k, 'cull'), decideCuts: (k) => isLayer(k, 'decideCuts'), render: (k) => k.name === 'render' && /three/.test(k.file) && !/Pass|Composer/.test(k.file), gc: (k) => k.name === '(garbage collector)', idle: (k) => k.name === '(idle)' || k.name === '(program)' };
  const deltas = profile.timeDeltas, samples = profile.samples;
  for (let i = 0; i < samples.length; i++) {
    const dt = (deltas[i] ?? 0) / 1000; if (dt <= 0) continue; const id = samples[i]; const k = keyOf(id);
    if (marks.idle(k)) continue; total += dt;
    self.set(k.id, (self.get(k.id) ?? 0) + dt);
    const seen = new Set(); let inUpdate = false;
    for (let p = id; p !== undefined; p = parent.get(p)) { const pk = keyOf(p); for (const [m, test] of Object.entries(marks)) if (test(pk) && !seen.has(m)) { seen.add(m); incl.set(m, (incl.get(m) ?? 0) + dt); } if (marks.update(pk)) inUpdate = true; }
    if (inUpdate) underUpdate.set(k.id, (underUpdate.get(k.id) ?? 0) + dt);
  }
  const perFrame = (ms) => +(ms / Math.max(1, frames)).toFixed(3);
  const top = (m, n = 12) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => ({ fn: k, msPerFrame: perFrame(ms), ms: +ms.toFixed(1) }));
  const sortedUpdates = [...updateTimes].sort((a, b) => a - b);
  const updateQuantile = (p) => sortedUpdates.length ? +sortedUpdates[Math.min(sortedUpdates.length - 1, Math.ceil(sortedUpdates.length * p) - 1)].toFixed(3) : null;
  const updateTiming = { frames: updateTimes.length, mean: updateTimes.length ? +(updateTimes.reduce((a, b) => a + b, 0) / updateTimes.length).toFixed(3) : null, p50: updateQuantile(0.5), p95: updateQuantile(0.95), p99: updateQuantile(0.99), max: updateQuantile(1) };
  const r = { url, label, frames, wallMs, fps: +(frames * 1000 / wallMs).toFixed(1), entityCount, loopStats: loop, settledMs: settledAt, updateTiming, sampledMsPerFrame: perFrame(total),
    perFrame: Object.fromEntries(Object.keys(marks).filter((m) => m !== 'idle').map((m) => [m, perFrame(incl.get(m) ?? 0)])),
    topSelf: top(self), topUnderUpdate: top(underUpdate), errors };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(r, null, 2));
  console.log(`${label}: ${frames} frames in ${wallMs} ms (${r.fps} fps) | per frame: update ${r.perFrame.update} ms, cull ${r.perFrame.cull}, decideCuts ${r.perFrame.decideCuts}, render ${r.perFrame.render}, gc ${r.perFrame.gc}, sampled ${r.sampledMsPerFrame} | things ${entityCount} loop ${JSON.stringify(loop)}${errors.length ? ' errors ' + errors.length : ''}`);
  for (const t of r.topUnderUpdate.slice(0, 8)) console.log(`   under update: ${t.msPerFrame} ms/frame  ${t.fn}`);
  console.log(`   ${out}`);
} finally { await browser.close(); await release(); }
