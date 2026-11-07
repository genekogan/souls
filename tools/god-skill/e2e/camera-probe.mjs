#!/usr/bin/env node
// Camera probe with real input (Gene: "everything tilted/warped left on a small laptop; dragging rotates around a point
// that seems off screen"). Real Chrome (GPU), real mouse/wheel/keyboard events, signed in (dev name), at laptop sizes.
// After each action: the projection offset (setViewOffset), fov, where the orbit target lands on screen (NDC; 0,0 =
// centre) and the camera distance. Screenshots per size and step.
//   node tools/god-skill/e2e/camera-probe.mjs <worldUrl> [--sizes 1280x720,1366x768,1440x900] [--name gene] [--out dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findPlaywright } from '../lib/look.mjs';
import { chromeLease } from '../lib/chrome-lease.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const sizes = opt('sizes', '1280x720,1366x768,1440x900').split(',').map((s) => s.split('x').map(Number));
const out = resolve(opt('out', `.lane/camera-probe/${new Date().toISOString().replace(/[:.]/g, '-')}`));
mkdirSync(out, { recursive: true });
const pw = findPlaywright(); if (!pw) throw new Error('no playwright');
const release = await chromeLease('camera-probe');
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const report = [];
const measure = (page, tag) => page.evaluate((tag) => {
  const w = window.__soulsEntity; if (!w) return { tag, missing: true };
  const c = w.camera, t = w.controls.target, p = t.clone().project(c);
  return { tag, active: w.layer.active, view: c.view && c.view.enabled ? [Math.round(c.view.offsetX), Math.round(c.view.offsetY)] : 'off',
    fov: +c.fov.toFixed(1), targetNDC: [+p.x.toFixed(2), +p.y.toFixed(2)], dist: +c.position.distanceTo(t).toFixed(1),
    up: c.up.toArray().map((v) => +v.toFixed(2)), aspect: +c.aspect.toFixed(3),
    canvasCss: (() => { const r = w.renderer.domElement.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), +(r.width / r.height).toFixed(3)]; })(),
    buffer: [w.renderer.domElement.width, w.renderer.domElement.height], pixelRatio: w.renderer.getPixelRatio(), dpr: devicePixelRatio };
}, tag);
try {
  for (const [W, H] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(opt('dpr', '1')) });
    await ctx.addInitScript((name) => { try { localStorage.setItem('sim.dev', name); } catch {} }, opt('name', 'gene'));
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const t0 = Date.now(), timeline = [];
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); const m = await measure(page, `t+${((Date.now() - t0) / 1000).toFixed(1)}s`); timeline.push(m); if (m.active && Math.abs(m.targetNDC?.[0] ?? 9) < 0.02 && i > 4) break; }
    const shot = async (n) => page.screenshot({ path: resolve(out, `${W}x${H}-${n}.png`) });
    await shot('1-arrival');
    const steps = [await measure(page, 'arrival')];
    const cx = Math.round(W * 0.35), cy = Math.round(H * 0.55);
    await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 16, cy - k * 2); await page.mouse.up();
    await page.waitForTimeout(600); steps.push(await measure(page, 'drag right')); await shot('2-drag');
    await page.mouse.move(cx, cy); await page.mouse.wheel(0, -600); await page.waitForTimeout(800); steps.push(await measure(page, 'wheel in'));
    await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w'); await page.waitForTimeout(300); steps.push(await measure(page, 'hold W 1s'));
    await page.mouse.dblclick(Math.round(W * 0.3), Math.round(H * 0.7)); await page.waitForTimeout(2500); steps.push(await measure(page, 'double-click')); await shot('3-dblclick');
    await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 16, cy); await page.mouse.up();
    await page.waitForTimeout(600); steps.push(await measure(page, 'drag after double-click')); await shot('4-drag2');
    report.push({ size: `${W}x${H}`, timeline: timeline.filter((r, i, a) => i === 0 || JSON.stringify({ ...r, tag: 0 }) !== JSON.stringify({ ...a[i - 1], tag: 0 })), steps, errors });
    await ctx.close();
  }
} finally { await browser.close(); release(); }
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
for (const r of report) { console.log(`== ${r.size}`); for (const t of r.timeline) console.log('  ', JSON.stringify(t)); for (const s of r.steps) console.log('  ', JSON.stringify(s)); if (r.errors.length) console.log('  errors', r.errors); }
console.log('out', out);
