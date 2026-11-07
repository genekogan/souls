#!/usr/bin/env node
// GODUI acceptance (Gene, 2026-10-11): the owner's lightning bolt right of Explore on a new world. Real Chrome (GPU,
// Chrome lease) at dpr 1 and 2, real clicks: the owner opens the bolt, pairs a god agent (the eden-god CLI) through it,
// presses Rain, Lightning and Haze (the sky changes, the bolt is drawn, each is a ledger edit); a visitor sees no bolt;
// the old world /w/eden shows no bolt either.
//
//   node tools/god-skill/e2e/godui.mjs [--port 5842] [--dpr 1,2] [--keep]
//
// Report + screenshots under .lane/e2e-godui/<stamp>/.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const port = Number(args.port ?? 5842);
if (port < 5830 || port > 5848) throw new Error('GODUI owns ports 5830–5849');
const dprs = String(args.dpr ?? '1,2').split(',').map(Number);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, '.lane/e2e-godui', stamp); mkdirSync(out, { recursive: true });
const report = { port, steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const marsWeb = resolve(root, '.lane/mars-web');
const servers = []; let serverLog = '';
async function boot(slug, p) {
  const dataDir = resolve(out, 'data-' + slug);
  const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(p), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${p}` };
  const s = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env }); servers.push(s);
  s.stdout.on('data', (d) => { serverLog += d; }); s.stderr.on('data', (d) => { serverLog += d; });
  const base = `http://127.0.0.1:${p}/w/${slug}`;
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch { } await sleep(100); }
  throw new Error(`${slug} did not come up`);
}
process.on('exit', () => { if (!args.keep) for (const s of servers) try { s.kill(); } catch { } });
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 1200); }
  const ok = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ok, ms, result, error }); if (!ok) report.failures.push({ name, result, error });
  log(`${ok ? '✔' : '✖'} ${name} — ${ms} ms${ok ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 700)}`);
  return result;
}
const chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium;
async function snap(page, name) { const file = resolve(out, `${name}.png`); await page.screenshot({ path: file }); report.shots.push(file); log(`  📷 ${name}.png`); }
async function until(page, fn, ms = 30000, every = 250) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await page.waitForTimeout(every); } return last; }
const atmos = (page) => page.evaluate(() => ({ a: window.__soulsLiving?.atmosphere?.(), l: window.__soulsLiving?.lightning?.() }));

try {
  for (const dpr of dprs) {
    const d = `dpr${dpr}`, slug = `godui-${dpr}`;
    const base = await boot(slug, port + dpr - 1);
    const claim = await fetch(`${base}/v1/god/claim`, { method: 'POST', headers: { authorization: 'Bearer dev:gene', 'content-type': 'application/json' }, body: '{}' });
    if (!claim.ok) throw new Error('claim ' + claim.status);
    const release = await chromeLease('godui-e2e');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const owner = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await owner.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await owner.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await page.goto(`${base}/?dev=1`, { waitUntil: 'domcontentloaded' });
      // G4 (2026-10-20): the bolt is now the God button (data-god-open) and its controls are sections of one God modal
      const godSection = async (section) => {
        for (let i = 0; i < 3 && !(await page.locator('[data-god-modal][open]').count()); i++) {
          await page.locator('[data-god-open]').click({ timeout: 2000 }).catch(() => {});
          await page.locator('[data-god-modal][open]').waitFor({ timeout: 2000 }).catch(() => {});
        }
        await page.locator(`[data-god-modal] [data-tab="${section}"]`).click();
        await page.locator(`[data-god-modal] [data-section="${section}"]`).waitFor();
        return page.locator('[data-god-modal]').innerText();
      };
      await step(`B1[${d}] the owner sees the bolt right of Explore and opens its panel (pairing line + Rain/Lightning/Haze)`, async () => {
        await page.locator('[data-god-open="owner"]').waitFor({ timeout: 90_000 });
        await page.waitForFunction(() => window.__soulsEntity?.layer?.active === true, null, { timeout: 90_000 }); await sleep(2500);
        const ex = await page.locator('.explore-open').boundingBox(), bolt = await page.locator('[data-god-open]').boundingBox();
        await page.locator('button[aria-label="collapse"]').first().click().catch(() => {});
        const text = (await godSection('agent')) + (await godSection('world'));
        const startTab = await godSection('start');
        await snap(page, `b1-owner-panel-${d}`);
        return { right: Math.round(bolt.x - (ex.x + ex.width)), sameRow: Math.abs((bolt.y + bolt.height / 2) - (ex.y + ex.height / 2)) < 4, line: /SKILL\.md and follow its God mode section/.test(text), buttons: ['Rain', 'Lightning', 'Haze'].every((b) => text.includes(b)), lineInGodPanel: /follow its God mode section/.test(startTab) };
      }, (r) => r.right >= 0 && r.right < 24 && r.sameRow && r.line && r.buttons && !r.lineInGodPanel);
      await step(`B2[${d}] a god agent pairs through the bolt panel: its code appears there, Approve, the CLI holds god mode`, async () => {
        const folder = resolve(out, 'agent-' + dpr); mkdirSync(folder, { recursive: true });
        writeFileSync(resolve(folder, 'eden-god.mjs'), readFileSync(resolve(root, 'tools/god-skill/eden-god.mjs')));
        const cli = (...a) => new Promise((ok) => { const p = spawn(process.execPath, ['eden-god.mjs', ...a], { cwd: folder, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }); let s = ''; p.stdout.on('data', (x) => { s += x; }); p.stderr.on('data', (x) => { s += x; }); p.on('exit', (code) => ok({ code, s })); });
        await cli('register', base);
        await page.keyboard.press('Escape');   // panel closed: a new request opens it by itself
        const pairing = cli('pair', 'godui-agent');
        await page.locator('[data-god-modal][open] [data-approve]').first().waitFor({ timeout: 30_000 });
        await snap(page, `b2-pairing-code-${d}`);
        await page.locator('[data-god-modal] [data-approve]').first().click();
        const done = await Promise.race([pairing, sleep(30_000).then(() => ({ code: 'timeout' }))]);
        const state = JSON.parse(readFileSync(resolve(folder, '.eden-god.json'), 'utf8'));
        await page.locator('[data-god-modal] [data-next-step="pair"]').waitFor({ state: 'detached', timeout: 15_000 });
        return { exit: done.code, token: state.token?.slice(0, 12) };
      }, (r) => r.exit === 0 && r.token?.startsWith('god_godui'));
      const press = async (kind) => { const s0 = (await (await fetch(`${base}/v1/world/seq`)).json()).seq; await godSection('world'); await page.locator(`[data-weather-kind="${kind}"]`).click(); await page.locator('[data-god-modal] .gp-ok').waitFor({ timeout: 10_000 }); return s0; };
      const look = () => page.evaluate(() => { const s = window.__soulsEntity; s.controls.target.set(0, 4, 0); s.camera.position.set(55, 28, 55); s.controls.update?.(); });
      await step(`W1[${d}] Rain: the sky rains (one ledger edit, like the CLI's)`, async () => {
        await look(); const s0 = await press('rain');
        const r = await until(page, async () => { const x = await atmos(page); return { ok: x.a?.kind === 'rain' && x.a.state.rain > 0.3, kind: x.a?.kind, rain: x.a?.state.rain }; }, 20000);
        await page.waitForTimeout(3500); await snap(page, `w1-rain-${d}`);
        const seq = (await (await fetch(`${base}/v1/world/seq`)).json()).seq;
        return { ...r, edits: seq - s0 };
      }, (r) => r.ok && r.edits === 1);
      await step(`W2[${d}] Lightning: a storm, and one strike near the view's centre (the bolt is drawn)`, async () => {
        await page.evaluate(() => window.__soulsLiving.holdLightning(15000));
        const t0 = Date.now(); const s0 = await press('lightning');
        const r = await until(page, async () => { const x = await atmos(page); const g = x.l?.last?.find((h) => h.god && h.at >= t0); return { ok: x.a?.kind === 'storm' && !!g && x.l.bolts > 0, kind: x.a?.kind, bolts: x.l?.bolts, god: g }; }, 20000, 100);
        await page.waitForTimeout(150); await snap(page, `w2-lightning-${d}`);
        const seq = (await (await fetch(`${base}/v1/world/seq`)).json()).seq;
        return { ...r, near: r.god ? Math.hypot(r.god.x, r.god.z) : null, edits: seq - s0 };   // the view centre was (0, 0)
      }, (r) => r.ok && r.near !== null && r.near < 1 && r.edits === 2);
      await step(`W3[${d}] Haze: fog closes in`, async () => {
        await page.evaluate(() => window.__soulsLiving.holdLightning(0));
        const s0 = await press('haze');
        const r = await until(page, async () => { const x = await atmos(page); return { ok: x.a?.kind === 'fog' && x.a.state.fog > 0.3, kind: x.a?.kind, fog: x.a?.state.fog }; }, 20000);
        await page.waitForTimeout(4000); await snap(page, `w3-haze-${d}`);
        const seq = (await (await fetch(`${base}/v1/world/seq`)).json()).seq;
        const edits = (await (await fetch(`${base}/v1/god/edits?limit=5`, { headers: { authorization: `Bearer ${JSON.parse(readFileSync(resolve(out, 'agent-' + dpr, '.eden-god.json'), 'utf8')).token}` } })).json()).edits;
        return { ...r, edits: seq - s0, ledger: edits.slice(0, 4).map((e) => `${e.seq} ${e.note}`), errors };
      }, (r) => r.ok && r.edits === 1 && !r.errors.length);
      const visitor = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await visitor.addInitScript(() => { localStorage.setItem('sim.dev', 'ben'); });
      const vp = await visitor.newPage(); await vp.goto(`${base}/?dev=1`, { waitUntil: 'domcontentloaded' });
      await step(`V1[${d}] a signed-in visitor sees Explore and no bolt`, async () => {
        await vp.locator('.explore-open').waitFor({ timeout: 90_000 }); await sleep(6000);
        await snap(vp, `v1-visitor-${d}`);
        return { bolt: await vp.locator('[data-god-open="owner"]').count() };
      }, (r) => r.bolt === 0);
      await visitor.close(); await owner.close();
    } finally { await browser.close().catch(() => {}); release(); }
  }
  // the old world: /w/eden keeps e8's header (no bolt), even for a signed-in person
  const eden = await boot('eden', port + 3);
  const release = await chromeLease('godui-e2e');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
    const page = await ctx.newPage(); await page.goto(`${eden}/?dev=1`, { waitUntil: 'domcontentloaded' });
    await step('E1 /w/eden: no bolt', async () => {
      await page.locator('.explore-open').waitFor({ timeout: 120_000 }); await sleep(5000);
      await snap(page, 'e1-eden');
      return { bolt: await page.locator('[data-god-open]').count(), godPanel: await page.locator('[data-god-panel]').count() };
    }, (r) => r.bolt === 0 && r.godPanel === 0);
  } finally { await browser.close().catch(() => {}); release(); }
} catch (e) { report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('✖ harness', e); }
finally {
  report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1)); writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200_000));
  writeFileSync(resolve(out, 'REPORT.md'), `# GODUI e2e — ${report.passed}/${report.total}\n\n${report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`).join('\n')}\n\nShots:\n${report.shots.map((f) => `- ${f}`).join('\n')}\n`);
  log(`\n${report.passed}/${report.total} — ${out}`);
  if (!args.keep) for (const s of servers) try { s.kill(); } catch { }
  process.exit(report.failures.length ? 1 : 0);
}
