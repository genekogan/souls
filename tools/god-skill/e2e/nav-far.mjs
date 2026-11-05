#!/usr/bin/env node
// NAV acceptance (lane NAV): Souls walk the whole world. One fresh 1000 m world; the harness plays the god (eden-god CLI)
// and a Soul (the unchanged Soul CLI). The god extends the world 800 m east and builds a hut there, 950 m from the
// arrival — far past the old 384 m walking window — and the Soul walks from the arrival to the hut in one walk, without
// stopping. The viewer is real Chrome (GPU, Chrome lease): Ana by the hut, looked at.
//
//   node tools/god-skill/e2e/nav-far.mjs [--port 5671] [--keep] [--dpr 1,2]
//
// Report + screenshots under .lane/e2e-nav-far/<stamp>/.
import { setCameraMode } from '../../browser/world-controls.mjs';
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = 'nav-far';
const port = Number(args.port ?? 5671);
if (port < 5670 || port > 5689) throw new Error('NAV owns ports 5670–5689');
const dprs = String(args.dpr ?? '1').split(',').map(Number);
const out = resolve(root, '.lane/e2e-nav-far', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
// a 1000 m world (±500); the god extends it 800 m east, so the hut stands ~950 m from the arrival
const genesisFile = resolve(out, 'genesis.json');
writeFileSync(genesisFile, JSON.stringify({ schema: 'genesis/1', name: 'far-world', constants: { extent: 1000 }, batches: [] }));
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Far World', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', ENABLE_WORLD_ENGINE: '1', GENESIS_FILE: genesisFile, DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
let server, serverLog = '';
async function boot() {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { } await sleep(100); }
  throw new Error('world did not come up');
}
process.on('exit', () => { if (!args.keep) try { server?.kill(); } catch { } });

let godToken = '';
async function api(path, { method, body, token } = {}) {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const brief = (r) => { try { const s = JSON.stringify(r); return s && s.length > 2400 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 12 ? `[${v.length} items]` : typeof v === 'string' && v.length > 400 ? v.slice(0, 400) + '…' : v))) : r; } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 1200); }
  const ok = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ok, ms, result: brief(result), error });
  if (!ok) report.failures.push({ name, result: brief(result), error });
  log(`${ok ? '✔' : '✖'} ${name} — ${ms} ms${ok ? '' : ' — ' + (error ?? JSON.stringify(brief(result))).slice(0, 700)}`);
  return result;
}

const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const run = (bin, dir, ...argv) => new Promise((ok) => execFile(process.execPath, [bin, ...argv], { cwd: dir, timeout: 180_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1', EDEN_GOD_NO_LEASE: '1' } }, (e, so, se) => { const s = String(so); let d = null; try { d = JSON.parse(s.slice(s.indexOf('{'))); } catch { } ok({ code: e ? e.code ?? 1 : 0, raw: s.trim(), err: String(se).trim(), data: d }); }));
const godDir = resolve(out, 'god'); mkdirSync(godDir, { recursive: true });
const anaDir = resolve(out, 'ana'); mkdirSync(anaDir, { recursive: true });
const god = (...argv) => run(GOD, godDir, ...argv);
const ana = (...argv) => run(CLI, anaDir, ...argv);
const hereOf = async () => (await ana('here')).data;
const worldEnv = async () => (await api('/v1/world/env')).data;
const seqNow = async () => (await api('/v1/world/seq')).data?.seq;
const okText = (r) => r.code === 0 && !/REFUSED/.test(r.raw);
let soulId = null;

let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test: viewer steps skipped)'); }
async function snap(page, name) { const file = resolve(out, `${name}.png`); await page.screenshot({ path: file }); report.shots.push(file); log(`  📷 ${name}.png`); }
async function waitFor(page, fn, ms = 30000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await page.waitForTimeout(every); } return last; }
const look = (page, eye, at) => page.evaluate(([e, a]) => { const s = window.__simEntity; if (!s) return false; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.controls.update?.(); return true; }, [eye, at]);

try {
  await boot(); log(`▶ world "${slug}" on :${port}`);
  await step('G0 the owner mints a god token', async () => {
    const r = await api('/v1/god/mint', { body: { label: 'nav' }, token: 'dev:gene' }); godToken = r.data.token;
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken }));
    return { status: r.status, token: !!godToken };
  }, (r) => r.token);
  let start;
  await step('S0 a Soul joins through the Soul CLI: Ana stands at the arrival', async () => {
    await ana('register', base); const c = await ana('create-soul', 'Ana', 'Ana, who walks far'); soulId = c.data?.soul?.id;
    for (let i = 0; i < 60; i++) { const h = await hereOf(); if (h?.me?.pos) { start = h.me.pos; return { soulId, pos: h.me.pos }; } await sleep(500); }
    return { soulId };
  }, (r) => r.pos);
  await step('L1 `land extend east 800`: the world grows from 1000×1000 to 1800×1000 m', async () => {
    const r = await god('land', 'extend', 'east', '800'); const s = (await api('/v1/god/snapshot', { token: godToken })).data;
    return { out: r.raw, extent: s.ground.extent };
  }, (r) => /1800×1000/.test(r.out) && r.extent[2] === 1300);
  let hut;
  await step('L2 the god builds a hut on the new land, 950 m east, and plants a flag at its door', async () => {
    let a = await god('place', 'hut', '--at', '950,12', '--facing', '0,12', '--name', 'east-hut');
    if (!okText(a)) a = await god('place', 'roundhouse', '--at', '950,12', '--facing', '0,12', '--name', 'east-hut');
    const b = await god('flag', 'Far Hut', '--at', '942,12');
    hut = (await api('/v1/god/snapshot', { token: godToken })).data.entities.find((e) => e.name === 'east-hut');
    return { a: a.raw.slice(0, 220), b: b.raw.slice(0, 200), ok: okText(a) && okText(b), hut: hut && { def: hut.def, p: hut.p } };
  }, (r) => r.ok && r.hut);
  await step('W1 Ana\'s agent sends her to the hut (walk:flag-far-hut, ~950 m: beyond the old 384 m window)', async () => {
    const caps = (await ana('capabilities')).raw; const a = await ana('act', 'walk:flag-far-hut');
    return { offered: /walk:flag-far-hut/.test(caps), act: a.raw.slice(0, 300), accepted: a.data?.accepted, from: start };
  }, (r) => r.offered && r.accepted === true);
  await step('W2 Ana walks the whole way in one walk: past the old window (x > 400) on the way, never standing still for more than 5 s, and arrives by the hut', async () => {
    const t0 = Date.now(); let h, last = null, stillSince = Date.now(), longestStill = 0, farthest = -1e9, samples = 0, arrivedAt = null;
    while (Date.now() - t0 < 25 * 60_000) {
      h = await hereOf(); const p = h?.me?.pos; samples++;
      if (p) {
        farthest = Math.max(farthest, p[0]);
        const moving = !last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.2;
        const d = Math.hypot(p[0] - 942, p[1] - 12);
        if (d < 4 && h?.me?.activity?.kind !== 'walk') { arrivedAt = p; break; }
        if (moving) stillSince = Date.now(); else longestStill = Math.max(longestStill, Date.now() - stillSince);
        last = p;
      }
      await sleep(1000);
    }
    return { arrivedAt, seconds: Math.round((Date.now() - t0) / 1000), farthest, longestStillMs: longestStill, samples, place: h?.me?.placePath, activity: h?.me?.activity };
  }, (r) => r.arrivedAt && r.farthest > 900 && r.longestStillMs <= 5000);
  if (chromium) for (const dpr of dprs) {
    const release = await chromeLease('nav-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await god('time', '16:30'); await god('weather', '--kind', 'clear');
      await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      await step(`V1[${d}] Ana by the far hut on the new land (real Chrome)`, async () => {
        await waitFor(page, async () => ({ ok: await page.evaluate(() => !!window.__simEntity?.layer?.active) }), 60000);
        await setCameraMode(page, 'manual'); await page.waitForTimeout(500);
        await page.locator('button[aria-label="collapse"]').first().click().catch(() => {});
        const p = (await hereOf())?.me?.pos ?? [942, 12];
        await look(page, [p[0] - 16, 9, p[1] + 14], [p[0] + 4, 1.5, p[1] - 1]); await page.waitForTimeout(5000); await snap(page, `v1-ana-at-far-hut-${d}`);
        await look(page, [p[0] - 120, 60, p[1] + 90], [p[0] - 20, 0, p[1]]); await page.waitForTimeout(4000); await snap(page, `v2-new-land-wide-${d}`);
        return { pos: p, errors };
      }, (r) => r.pos[0] > 900 && !r.errors.length);
      await ctx.close();
    } finally { await browser.close().catch(() => { }); release(); }
  }
} catch (e) { report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('✖ harness', e); }
finally {
  report.finishedAt = new Date().toISOString(); report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1)); writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200_000));
  writeFileSync(resolve(out, 'REPORT.md'), `# NAV far-walk e2e — ${report.passed}/${report.total}\n\n${report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`).join('\n')}\n\nShots:\n${report.shots.map((f) => `- ${f}`).join('\n')}\n`);
  log(`\n${report.passed}/${report.total} — ${out}`);
  if (!args.keep) try { server?.kill(); } catch { }
  process.exit(report.failures.length ? 1 : 0);
}
