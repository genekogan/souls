#!/usr/bin/env node
// L11 e2e: the three parity demonstrators load from the homepage's New-world dialog.
//
//   node tools/god-skill/e2e/parity.mjs [--port 5188] [--range 5181-5187]
//
// Starts its own launcher (fresh data dir) on --port with children in --range, then as a person:
// opens the homepage, New world → the dialog lists eden-district, mars-camp and littlemartians-garden
// (with Empty plain and Hello hamlet); for each, names a world, picks the template, creates it,
// waits for the entity world to draw, checks the entity count against the template, and
// photographs it. One Chrome (real GPU) under the shared lease. Writes report.json + shots.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const port = Number(arg('port', 5188)), range = arg('range', '5181-5187');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, '.lane/e2e', `parity-${stamp}`); mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`;
const report = { port, range, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE_MS = 300000;

const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', join(out, 'launcher')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let llog = ''; launcher.stdout.on('data', (d) => { llog += d; }); launcher.stderr.on('data', (d) => { llog += d; });
process.on('exit', () => { try { launcher.kill(); } catch { /* gone */ } });
for (let i = 0; i < 600; i++) { try { if ((await fetch(`${origin}/__sim/templates.json`)).ok) break; } catch { /* booting */ } await sleep(100); }

async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 600); }
  const ok = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ms, ok, result: JSON.stringify(result ?? null).slice(0, 500), error });
  if (!ok) report.failures.push({ name, result: JSON.stringify(result ?? null).slice(0, 500), error });
  console.log(`${ok ? '✔' : '✖'} ${name} — ${ms} ms${ok ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 300)}`);
  return result;
}

const TEMPLATES = [
  ['littlemartians-garden', 'garden-proof', { eye: '0,26,60', at: '0,8,0' }],
  // mars-camp is retired from the dialog (hidden: true; MARSLIVED 2026-10-11): mars-two replaces it
  ['eden-district', 'district-proof', { eye: '68,23,48', at: '44,2,23' }],
];
const opsOf = (id) => JSON.parse(readFileSync(resolve(root, `worlds/templates/${id}.json`), 'utf8')).batches.reduce((n, b) => n + b.ops.filter((o) => o.op === 'place').length, 0);

const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
const release = await chromeLease('L11-parity-e2e');
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  page.setDefaultTimeout(PAGE_MS);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('dialog', (d) => d.dismiss());
  await step('templates.json lists the three demonstrators', async () => (await (await fetch(`${origin}/__sim/templates.json`)).json()), (j) => ['eden-district', 'mars-two', 'littlemartians-garden'].every((id) => JSON.stringify(j).includes(`"${id}"`)) && !JSON.stringify(j).includes('"mars-camp"'));
  for (const [id, name, view] of TEMPLATES) {
    await step(`New world → dialog → ${id}`, async () => {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-new-world]').first().click();
      await page.locator('[data-new-world-dialog]').waitFor();
      const listed = await page.locator('[data-template]').evaluateAll((els) => els.map((e) => e.getAttribute('data-template')));
      await page.locator('[data-world-name]').fill(name);
      await page.locator(`[data-template="${id}"]`).click();
      if (id === TEMPLATES[0][0]) { await page.screenshot({ path: join(out, '00-dialog.png') }); report.shots.push(join(out, '00-dialog.png')); }
      await page.locator('[data-create]').click();
      await page.waitForURL(/\/w\/[a-z0-9-]+\/\?dev=1&new=1/, { timeout: PAGE_MS });
      const slug = new URL(page.url()).pathname.split('/')[2];
      await page.waitForFunction(() => window.__soulsEntity?.layer?.active === true && window.__soulsEntity.layer.drawn?.size > 5, null, { timeout: PAGE_MS });
      const status = await (await fetch(`${origin}/w/${slug}/v1/god/status`, { headers: { authorization: 'Bearer dev:admin' } })).json();
      const drawn = await page.evaluate(() => window.__soulsEntity.layer.drawn.size);
      // the page's own camera, then the comparison view (Mars: roofs off, the camp rooms are open-topped)
      if (view.roofsOff) await page.evaluate(() => { globalThis.__buildingView = { hideRoofs: true }; });
      await page.addInitScript((off) => { globalThis.__buildingView = { hideRoofs: off }; }, !!view.roofsOff);
      await page.goto(`${origin}/w/${slug}/?dev=1&shot=1&eye=${view.eye}&at=${view.at}`, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: PAGE_MS });
      await sleep(1500);
      const file = join(out, `${id}.png`); await page.screenshot({ path: file }); report.shots.push(file);
      return { listed, slug, entities: status.entities, template: status.template, placeOps: opsOf(id), drawn };
    }, (r) => r.listed.includes(id) && r.entities >= r.placeOps * 0.9 && r.drawn > 5);
  }
  report.pageErrors = errors.slice(0, 5);
} finally { await browser?.close().catch(() => {}); release(); }
report.finishedAt = new Date().toISOString();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
writeFileSync(join(out, 'launcher.log'), llog);
console.log(`${report.steps.filter((s) => s.ok).length}/${report.steps.length} → ${out}`);
launcher.kill();
process.exit(report.failures.length ? 1 : 0);
