#!/usr/bin/env node
// Photograph a mars-two world from the named views (real GPU Chrome under the shared lease).
//   node tools/god-skill/scripts/mars-two/shots.mjs <world-url> <out-dir> [view…] [--dpr 2]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT } from './v3.mjs';
import { chromeLease } from '../../lib/chrome-lease.mjs';
const { chromium } = createRequire(join(ROOT, 'mars/viewer/package.json'))('@playwright/test');
// eye / at in mars-two coordinates (Mimos origin x 48, z 0; north is −z)
export const VIEWS = {
  overview: { eye: [125, 70, 95], at: [30, 0, -10] },
  campus: { eye: [70, 34, 40], at: [44, 0, 2] },
  mimos: { eye: [52.5, 9, 6.5], at: [46, 0.5, -2], roofs: true, cut: 2.6 },
  'mimos-floor': { eye: [47.6, 1.9, -0.2], at: [50.5, 0.6, 0.6] },
  'mimos-main': { eye: [46.0, 2.3, 0.4], at: [45.5, 0.9, -4.5] },
  kitchen: { eye: [38.5, 2.4, 1.2], at: [38.3, 1.0, -5] },
  'kitchen-top': { eye: [41, 11, 4.5], at: [40, 0.5, -2], roofs: true, cut: 2.6 },
  diner: { eye: [41.2, 2.2, -5.6], at: [43, 0.9, 1.0] },
  showers: { eye: [56, 6, -2], at: [50, 0.5, -8] },
  chiba: { eye: [70, 16, 30], at: [50, 2, 10] },
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
  const dpr = Number(flag('dpr', 1)); const [url, out, ...names] = args; mkdirSync(out, { recursive: true });
  const release = await chromeLease('mars-two shots');
  try {
    const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const page = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr })).newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    for (const name of names.length ? names : Object.keys(VIEWS)) {
      const v = VIEWS[name], q = new URLSearchParams({ shot: '1', eye: v.eye.join(','), at: v.at.join(','), settle: '1500', ...(v.roofs ? { hideRoofs: '1', cut: String(v.cut) } : {}) });
      const t0 = Date.now();
      await page.goto(`${url}?${q}`, { waitUntil: 'commit', timeout: 600000 });
      let st = {};
      for (let i = 0; i < 240; i++) {
        await page.waitForTimeout(1000);
        st = await page.evaluate(() => { const w = window.__soulsEntity; const drawn = w?.layer?.drawn ?? w?.layer?.objects; return { active: !!w?.layer?.active, drawn: drawn?.size ?? null, easing: w?.layer?.easing?.size ?? w?.layer?.easing ?? null, shot: !!window.__shotReady }; }).catch((e) => ({ err: String(e.message).slice(0, 80) }));
        if (st.shot && i > 8) break;
      }
      await page.waitForTimeout(3000);
      const file = join(out, `${name}${dpr !== 1 ? `@${dpr}x` : ''}.png`);
      await page.screenshot({ path: file });
      console.log(`${name}: ${file} (${Math.round((Date.now() - t0) / 1000)} s) ${JSON.stringify(st)}`);
    }
    if (errs.length) console.log('page errors:', errs.slice(0, 5));
    await b.close();
  } finally { release(); }
}
