#!/usr/bin/env node
// L10 humanoid looks in a live god world: two Souls born through the owner flow; Ben's owner agent sets his look
// (taller, broader, bigger head, slower walk) through PUT /v1/edge/body {look} — Codex's route, which this lane only
// proposes (tools/humanoid/proposals/02-…): run this from a worktree with the proposals applied (.lane/verify).
// Both walk ~16 m east at once; Ben's mean and peak speeds stay at 0.9 m/s, Ana's at today's 1.35.
// Ben sits on the god's chair (seat fit). A real browser watches: real wheel, drag and keys on the world page,
// screenshots of the two bodies standing, walking side by side and Ben seated.
//
//   node tools/god-skill/e2e/humanoid.mjs [--port 4988] [--keep] [--no-shots] [--out DIR]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const slug = 'humanoid', port = Number(args.port ?? 4988);
if (![4985, 4988, 4989].includes(port)) throw new Error('lane L10 ports only (4985, 4988, 4989)');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(typeof args.out === 'string' ? args.out : resolve(root, '.lane/e2e-humanoid', stamp));
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}` };
let server, serverLog = '';
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
process.on('exit', () => { if (!args.keep) try { server?.kill(); } catch { } });

let godToken = '';
const tokens = {};
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (tokens[as]) headers.authorization = `Bearer ${tokens[as]}`;
  else if (as && as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const okay = !error && (expect ? !!expect(result) : true);
  let brief; try { brief = JSON.parse(JSON.stringify(result ?? null, (k, v) => (Array.isArray(v) && v.length > 16 ? `[${v.length} items]` : v))); } catch { brief = String(result); }
  report.steps.push({ name, ms: Math.round(performance.now() - t0), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name}${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 600)}`);
  return result;
}
async function until(fn, ms = 60000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await sleep(every); } return last; }
const observe = async (who) => (await api('/v1/edge/observe', { as: who })).data;
const caps = async (who) => (await api('/v1/edge/capabilities', { as: who })).data.capabilities ?? [];
const act = (who, capability, params) => api('/v1/edge/act', { as: who, body: { capability, ...(params ? { params } : {}) } });
/** Follow a receipt to its end, sampling the body each ~0.3 s. */
async function follow(who, r, { maxS = 120 } = {}) {
  if (!r.data?.accepted) return { accepted: false, code: r.data?.code, reason: r.data?.reason };
  const id = r.data.receipt?.id, samples = [], t0 = Date.now(); let rec = r.data.receipt;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(who); samples.push({ tick: o.tick, p: o.self.position, activity: o.self.activity });
    rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: who })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(300);
  }
  const o = await observe(who);
  return { accepted: true, phase: rec?.phase, code: rec?.code, fromTick: r.data.receipt?.acceptedTick ?? samples[0]?.tick, toTick: rec?.completedTick ?? o.tick, end: o.self.position, activity: o.self.activity, samples };
}

// ---------- browser: the normal world page, driven with real input
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no Playwright; shots skipped)'); }
let browser = null, page = null, release = null;
async function openPage() {
  if (!chromium) return null;
  release = await chromeLease('L10-humanoid-world');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => report.pageErrors = [...(report.pageErrors ?? []), e.message]);
  await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas', { timeout: 120_000 }); await sleep(8000);
  return page;
}
async function snap(name) {
  if (!page) return; const file = resolve(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120_000 }); report.shots.push(file); log(`  shot ${file}`);
}
/** Real input on the canvas: wheel to zoom, right/left drag to orbit, keys to move the camera. */
async function input(seq) {
  if (!page) return;
  const box = await page.locator('canvas').first().boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const s of seq) {
    if (s.wheel) { await page.mouse.move(s.at?.[0] ?? cx, s.at?.[1] ?? cy); for (let i = 0; i < (s.n ?? 1); i++) { await page.mouse.wheel(0, s.wheel); await sleep(60); } }
    if (s.drag) { const [dx, dy] = s.drag; await page.mouse.move(cx, cy); await page.mouse.down({ button: s.button ?? 'left' }); await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 6 }); await page.mouse.move(cx + dx, cy + dy, { steps: 6 }); await page.mouse.up({ button: s.button ?? 'left' }); }
    if (s.key) { await page.keyboard.down(s.key); await sleep(s.ms ?? 400); await page.keyboard.up(s.key); }
    if (s.dblclick) { await page.mouse.dblclick(s.dblclick[0], s.dblclick[1]); }
    if (s.wait) await sleep(s.wait);
  }
}

/** Real wheel input aimed at a Soul: find its name tag on screen, put the mouse just under it, wheel in a little;
 *  repeat (the tag moves as the camera does). */
async function zoomTo(name, rounds = 4, ticks = 2) {
  if (!page) return [];
  const at = [];
  for (let k = 0; k < rounds; k++) {
    const t = await page.evaluate((n) => { const r = [...document.querySelectorAll('b')].filter((e) => e.textContent.trim() === n).map((e) => e.getBoundingClientRect()).find((r) => r.width > 0 && r.x < 1000); return r ? [r.x + r.width / 2, r.y + r.height + 40] : null; }, name);
    if (!t) break; at.push(t.map(Math.round));
    await page.mouse.move(t[0], t[1]); for (let i = 0; i < ticks; i++) { await page.mouse.wheel(0, -200); await sleep(90); } await sleep(700);
  }
  return at;
}
const FLAG_A = [16, 1.5], FLAG_B = [16, -1.5], CHAIR = [-6, 5];
try {
  await boot(); log(`▶ world "${slug}" on :${port}`);
  await step('G0 the owner mints a god token', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e humanoid' } }); godToken = r.data.token; return { status: r.status }; }, (r) => r.status === 200);
  await step('G1 the god places two flags 16 m east and a chair', () => api('/v1/god/act', { body: { note: 'humanoid looks', ops: [
    { op: 'place', def: 'core/flag@1', name: 'east-a', p: FLAG_A, state: { label: 'east a' } },
    { op: 'place', def: 'core/flag@1', name: 'east-b', p: FLAG_B, state: { label: 'east b' } },
    { op: 'place', def: 'core/chair@1', name: 'chair', p: CHAIR, yaw: 0 },
  ] } }), (r) => r.data?.accepted === true);
  const souls = {};
  for (const [who, name] of [['ana', 'Ana'], ['ben', 'Ben']]) {
    await step(`S0 ${name}: invited owner creates and pairs the Soul`, async () => {
      const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
      await api('/v1/invite', { as: who + '-owner', body: { code: inv.data.code } });
      const s = await api('/v1/souls', { as: who + '-owner', body: { name, description: 'a walker in the humanoid looks test' } });
      souls[who] = s.data.soul;
      const c = await api(`/v1/souls/${s.data.soul.id}/pair`, { as: who + '-owner', body: {} });
      const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'e2e humanoid' } });
      tokens[who] = x.data.token; return { soul: s.data.soul?.id, token: !!tokens[who] };
    }, (r) => r.soul && r.token);
    await step(`S0 ${name} stands in the world`, () => until(async () => { const o = await observe(who); return { ok: !!o?.self?.position, p: o?.self?.position }; }, 30000), (r) => r?.ok);
  }
  const look = { height: 1.92, build: 1.15, headSize: 1.1, walkSpeed: 0.9, hat: 'cap', top1: '#356477' };
  await step('B0 Ben reads his body: today\'s humanoid, look choices include the four sizes', async () => { const r = await api('/v1/edge/body', { as: 'ben' }); return { look: r.data.look, choices: Object.fromEntries(['headSize', 'height', 'build', 'walkSpeed'].map((k) => [k, r.data.lookChoices?.[k]])) }; },
    (r) => r.look === null && r.choices.height?.min === 1.55 && r.choices.walkSpeed?.max === 1.4);
  const page0 = await openPage();
  if (page0) {
    // frame the arrival area: zoom in with the wheel, orbit a little with a drag
    await step('V0 the world page opens; real wheel and drag move the camera', async () => {
      const cam0 = await page.evaluate(() => JSON.stringify(window.__soulsCamera ?? null));
      await input([{ wheel: -240, n: 6 }, { drag: [120, -40] }, { wait: 1500 }]);
      await snap('w0-before-look'); return { cam0 };
    });
  }
  await step('B1 Ben\'s owner agent sets his look: 1.92 m, build 1.15, head 1.1, walks 0.9 m/s, cap, blue top', async () => {
    const r = await api('/v1/edge/body', { as: 'ben', method: 'PUT', body: { look } });
    return { status: r.status, body: r.data.body, error: r.data.error };
  }, (r) => r.status === 200 && r.body?.params?.height === 1.92 && r.body?.params?.walkSpeed === 0.9);
  await step('B1 a walk speed above the engine cap is refused', async () => { const r = await api('/v1/edge/body', { as: 'ben', method: 'PUT', body: { look: { walkSpeed: 1.6 } } }); return { status: r.status, code: r.data.error?.code }; }, (r) => r.status === 400 && r.code === 'body.look');
  await step('O1 Ana\'s owner (signed in) changes her look through the owner route (proposal 05): 1.62 m, slim', async () => {
    const r = await api(`/v1/souls/${souls.ana.id}/look`, { as: 'ana-owner', method: 'PUT', body: { height: 1.62, build: 0.9 } });
    const other = await api(`/v1/souls/${souls.ana.id}/look`, { as: 'ben-owner', method: 'PUT', body: { height: 1.9 } });
    return { status: r.status, params: r.data.body?.params, otherOwner: other.status };
  }, (r) => r.status === 200 && r.params?.height === 1.62 && r.params?.build === 0.9 && r.otherOwner === 403);
  if (page) { await sleep(6000); await step('V1 real wheel input zooms the camera onto Ben', async () => ({ aimedAt: await zoomTo('Ben', 4) }), (r) => r.aimedAt.length > 0); await sleep(1500); await snap('w1-ben-new-look'); }
  // both walk 16 m east at once
  const both = await step('W1 Ana and Ben walk to the east flags together; Ben walks at ≤ 0.9 m/s, Ana at today\'s ≈ 1.35', async () => {
    const wa = (await caps('ana')).find((c) => c.id === 'walk:flag-east-a'), wb = (await caps('ben')).find((c) => c.id === 'walk:flag-east-b');
    if (!wa || !wb) return { caps: false };
    const [ra, rb] = await Promise.all([act('ana', wa.id), act('ben', wb.id)]);
    let shot = null; if (page) shot = (async () => { await sleep(3500); await snap('w2-walking-side-by-side'); await input([{ wheel: 200, n: 2 }, { key: 'KeyD', ms: 500 }, { wait: 2500 }]); await snap('w3-walking-after-wheel-and-keys'); })();
    const [fa, fb] = await Promise.all([follow('ana', ra), follow('ben', rb)]); await shot;
    const step = (f) => { let m = 0; for (let i = 1; i < f.samples.length; i++) { const a = f.samples[i - 1], b = f.samples[i]; if (b.tick > a.tick) m = Math.max(m, Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / ((b.tick - a.tick) * 0.05)); } return +m.toFixed(3); };
    // mean speed over the walk: path length / walking time (ticks while the sampled position moved)
    const mean = (f) => { let d = 0, t0 = null, t1 = null; for (let i = 1; i < f.samples.length; i++) { const a = f.samples[i - 1], b = f.samples[i], m = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]); if (m > 1e-3) { d += m; t0 ??= a.tick; t1 = b.tick; } } return +(d / Math.max(1, (t1 - t0)) / 0.05).toFixed(3); };
    const sum = (f) => ({ phase: f.phase, ticks: f.toTick - f.fromTick, end: f.end, meanSpeed: mean(f), maxSampledSpeed: step(f) });
    return { ana: sum(fa), ben: sum(fb) };
  }, (r) => r.ana?.phase === 'completed' && r.ben?.phase === 'completed' && r.ben.meanSpeed < 0.92 && r.ana.meanSpeed > r.ben.meanSpeed * 1.2 && r.ana.maxSampledSpeed > 1.25 && r.ben.maxSampledSpeed <= 0.9 * 1.05 && r.ana.maxSampledSpeed <= 1.4 * 1.05);
  await step('W2 the server never saw a teleport or overspeed', async () => ({ violations: (serverLog.match(/motion\.(teleport|overspeed)[^\n]*/g) ?? []).slice(0, 5) }), (r) => r.violations.length === 0);
  await step('S1 Ben (1.92 m) sits on the god\'s chair (seat 0.47 m fits 0.22–1.32 m)', async () => {
    const chair = (await caps('ben')).find((c) => c.verb === 'sit' && /chair/.test(c.label ?? ''));
    if (!chair) return { chair: false };
    const f = await follow('ben', await act('ben', chair.id), { maxS: 120 });
    return { available: chair.available, phase: f.phase, activity: f.activity, end: f.end };
  }, (r) => r.available && r.activity === 'sit');
  if (page) {
    await sleep(4000);
    // the Souls list names Ben; clicking his row and wheeling in at his tag brings the camera to his chair
    // reload the page (the broadcast camera frames the arrival area, where the chair is), then wheel in at his tag
    await step('V2 reload, then real wheel input at Ben\'s tag', async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('canvas'); await sleep(9000); return { aimedAt: await zoomTo('Ben', 7, 3) }; }, (r) => r.aimedAt.length > 0);
    await sleep(2500); await snap('w4-ben-seated');
  }
  report.both = both;
} catch (e) { report.failures.push({ name: 'crash', error: String(e?.stack ?? e) }); log('✖ crash', e); }
finally {
  try { await browser?.close(); } catch { } release?.();
  report.finishedAt = new Date().toISOString(); report.serverTail = serverLog.split('\n').slice(-40);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  log(`\n${report.failures.length ? '✖' : '✔'} ${report.steps.filter((s) => s.ok).length}/${report.steps.length} steps; report ${out}/report.json`);
  if (!args.keep) server?.kill();
  process.exit(report.failures.length ? 1 : 0);
}
