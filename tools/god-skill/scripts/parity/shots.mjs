#!/usr/bin/env node
// L11 side-by-side screenshots: each demonstrator world and the original world from the same eye.
//
//   node tools/god-skill/scripts/parity/shots.mjs <jobs.json> <outDir>
//
// jobs.json: [{ name, url, eye: [x,y,z], at: [x,y,z], original?: true, settle?: ms }]
// Demonstrators (entity worlds) use `?shot=1&eye=…&at=…` and wait for window.__shotReady; originals
// (the legacy Eden/Mars/LM scenes) are opened with `?shot=1`, then the camera is set through
// window.__soulsEntity.{camera,controls} once the scene has loaded. One Chrome (real GPU via Metal),
// under the shared Chrome lease, closed straight after.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const [jobsFile, outDir] = process.argv.slice(2);
const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });
const { chromeLease } = await import(resolve(root, 'tools/god-skill/lib/chrome-lease.mjs'));
const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
const release = await chromeLease('L11-parity');
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (const j of jobs) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
    page.setDefaultTimeout(300000);
    if (j.roofsOff) await page.addInitScript(() => { globalThis.__buildingView = { hideRoofs: true }; });   // building.mesh's roofs-off view
    const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    const sep = j.url.includes('?') ? '&' : '?';
    const t0 = Date.now();
    if (j.original) await page.route('**/*', (r) => (['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.abort()));   // read-only: originals may be live
    if (j.preset) {
      // a live original from an older build: pick its own Explore view by label (no camera handle there)
      await page.goto(`${j.url}`, { waitUntil: 'commit', timeout: 300000 });
      await page.waitForFunction(() => document.querySelector('canvas')?.dataset.sceneBinding === 'bound', null, { timeout: 180000 }).catch(() => {});
      await page.waitForTimeout(j.settle ?? 20000);
      const sel = await page.$('select'); if (!sel) throw new Error(`${j.name}: no place selector`);
      await sel.selectOption({ label: j.preset });
      await page.waitForTimeout(12000);
    } else if (j.original) {
      await page.goto(`${j.url}${sep}shot=1`, { waitUntil: 'commit', timeout: 300000 });
      for (let i = 0; i < 240; i++) { const ok = await page.evaluate(() => !!window.__soulsEntity?.camera).catch(() => false); if (ok) break; await page.waitForTimeout(500); }
      await page.waitForTimeout(j.settle ?? 20000);   // let the legacy scene stream its kits and GLBs
      await page.evaluate(({ eye, at }) => { const w = window.__soulsEntity; w.controls.target.set(...at); w.camera.position.set(...eye); w.camera.lookAt(...at); w.controls.update?.(); }, j);
      await page.waitForTimeout(3000);
    } else {
      await page.goto(`${j.url}${sep}shot=1&eye=${j.eye.join(',')}&at=${j.at.join(',')}${j.settle ? `&settle=${j.settle}` : ''}`, { waitUntil: 'commit', timeout: 300000 });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
      await page.waitForTimeout(1500);
    }
    if (j.probe) console.log(j.name, 'probe', JSON.stringify(await page.evaluate((names) => {
      const L = window.__soulsEntity?.layer; if (!L?.model) return 'no model';
      const out = {}; for (const e of L.model.entities.values()) if (names.includes(e.name)) { const d = L.drawn.get(e.id); const v = d?.obj.getWorldPosition(d.obj.position.clone()); let meshes = 0; d?.obj.traverse((o) => { if (o.isMesh) meshes++; }); out[e.name] = d ? { at: v.toArray().map((n) => +n.toFixed(2)), visible: d.obj.visible, meshes, scale: +d.obj.scale.x.toFixed(2) } : 'not drawn'; }
      return out;
    }, j.probe)));
    const file = resolve(outDir, `${j.name}.png`);
    await page.screenshot({ path: file });
    const title = await page.title();
    console.log(`${j.name}: ${file} (${((Date.now() - t0) / 1000).toFixed(0)} s, title ${title}${errors.length ? `, ${errors.length} page errors: ${errors[0]}` : ''})`);
    await page.context().close();
  }
} finally { await browser?.close().catch(() => {}); release(); }
