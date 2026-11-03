#!/usr/bin/env node
// MARSLAND-NEAR acceptance: the desert near-field as library pieces any god can place. One fresh 600 m world; the
// harness plays the god (eden-god CLI) and a Soul (the unchanged Soul CLI). The god finds the tyre defs in the
// catalog, turns the ground to the pale `playa` palette, places an elliptical tyre ring (tire-ring/1), creosote scrub
// (desert-scrub/1, denser to the south-east), tyre tracks, and a loose tyre and bush by the arrival. The Soul walks
// from the arrival across the ring (in over the tyres, out the far side: decor, no colliders) past the scrub to a flag.
// The viewer is real Chrome (GPU, Chrome lease): Ana inside the ring, looked at, and the ring from the air.
//
//   node tools/god-skill/e2e/marsland-near.mjs [--port 5962] [--keep] [--dpr 1,2]
//
// Report + screenshots under .lane/e2e-marsland-near/<stamp>/.
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
const slug = 'marsland-near';
const port = Number(args.port ?? 5962);
if (port < 5960 || port > 5964) throw new Error('MARSLAND-NEAR owns ports 5960–5964');
const dprs = String(args.dpr ?? '1,2').split(',').map(Number);
const out = resolve(root, '.lane/e2e-marsland-near', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const genesisFile = resolve(out, 'genesis.json');
writeFileSync(genesisFile, JSON.stringify({ schema: 'genesis/1', name: 'near-field', constants: { extent: 600 }, state: { sky: { palette: 'mars-desert', sun: 0.8 } }, batches: [] }));
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Near Field', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', ENABLE_WORLD_ENGINE: '1', GENESIS_FILE: genesisFile, DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
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
const okText = (r) => r.code === 0 && !/REFUSED|error/i.test(r.raw);
const snapshot = async () => (await api('/v1/god/snapshot', { token: godToken })).data;

let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test: viewer steps skipped)'); }
async function snap(page, name) { const file = resolve(out, `${name}.png`); await page.screenshot({ path: file }); report.shots.push(file); log(`  📷 ${name}.png`); }
async function waitFor(page, fn, ms = 30000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await page.waitForTimeout(every); } return last; }
const look = (page, eye, at) => page.evaluate(([e, a]) => { const s = window.__simEntity; if (!s) return false; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.controls.update?.(); return true; }, [eye, at]);

// the ring: centre, semi-axes (x, z); `inside` < 1 within the ellipse
const RING = { c: [-80, 0], rx: 40, rz: 70 };
const ell = (p) => ((p[0] - RING.c[0]) / RING.rx) ** 2 + ((p[1] - RING.c[1]) / RING.rz) ** 2;
const FLAG = [-160, 8];

try {
  await boot(); log(`▶ world "${slug}" on :${port}`);
  await step('G0 the owner mints a god token', async () => {
    const r = await api('/v1/god/mint', { body: { label: 'near' }, token: 'dev:gene' }); godToken = r.data.token;
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken }));
    return { status: r.status, token: !!godToken };
  }, (r) => r.token);
  let start;
  await step('S0 a Soul joins through the Soul CLI: Ana stands at the arrival', async () => {
    await ana('register', base); await ana('create-soul', 'Ana', 'Ana, who walks the playa');
    for (let i = 0; i < 60; i++) { const h = await hereOf(); if (h?.me?.pos) { start = h.me.pos; return { pos: h.me.pos }; } await sleep(500); }
    return {};
  }, (r) => r.pos);
  await step('F1 the god finds the desert pieces in the catalog (find tire, find creosote)', async () => {
    const a = await god('find', 'tire'), b = await god('find', 'creosote');
    return { tire: /core\/tire-ring@1/.test(a.raw) && /core\/tire@1/.test(a.raw) && /core\/tire-line@1/.test(a.raw), creosote: /core\/creosote@1/.test(b.raw) && /core\/desert-scrub@1/.test(b.raw), raw: a.raw.slice(0, 500) };
  }, (r) => r.tire && r.creosote);
  await step('P1 the god turns the ground to the pale playa (world op: ground.palette = playa)', async () => {
    const r = await god('act', JSON.stringify({ ops: [{ op: 'world', state: { ground: { palette: 'playa' } } }] }));
    return { out: r.raw.slice(0, 200), palette: (await snapshot()).state?.ground?.palette };
  }, (r) => r.palette === 'playa');
  await step(`P2 the god places a tyre ring (tire-ring, rx ${RING.rx} × rz ${RING.rz} m) west of the arrival`, async () => {
    const r = await god('place', 'tire-ring', '--at', RING.c.join(','), '--param', `rx=${RING.rx}`, '--param', `rz=${RING.rz}`, '--name', 'tire-ring');
    const d = await god('describe', 'tire-ring');
    return { ok: okText(r), out: r.raw.slice(0, 240), describe: d.raw.slice(0, 600), tyres: Number(/(\d+) tyres in the ring/.exec(d.raw)?.[1] ?? 0) };
  }, (r) => r.ok && r.tyres > 100);
  await step('P3 the god places scrub over the whole world (denser to the south-east), tyre tracks in and around the ring, a loose tyre and a bush by the arrival', async () => {
    const a = await god('place', 'desert-scrub', '--rect', '0,0,560,560', '--param', 'toward=se', '--param', 'density=0.003', '--name', 'scrub');
    const b = await god('place', 'tire-tracks', '--rect', `${RING.c[0]},0,130,190`, '--param', 'count=50', '--name', 'ring-tracks');
    const c = await god('place', 'tire', '--at', '-12,6', '--param', 'pose=flat', '--name', 'loose-tire');
    const d = await god('place', 'creosote', '--at', '-10,10', '--param', 'height=1.3', '--name', 'bush');
    const f = await god('flag', 'Far side', '--at', FLAG.join(','));
    const s = await snapshot(), names = new Set(s.entities.map((e) => e.name));
    return { ok: [a, b, c, d, f].every(okText), outs: [a, b, c, d, f].map((x) => x.raw.slice(0, 160)), have: ['scrub', 'ring-tracks', 'loose-tire', 'bush'].every((n) => names.has(n)) };
  }, (r) => r.ok && r.have);
  let walk;
  await step('W1 Ana\'s agent sends her to the far-side flag (her straight line crosses the tyre ring twice)', async () => {
    const caps = (await ana('capabilities')).raw; const a = await ana('act', 'walk:flag-far-side');
    return { offered: /walk:flag-far-side/.test(caps), accepted: a.data?.accepted, act: a.raw.slice(0, 200), from: start };
  }, (r) => r.offered && r.accepted === true);
  walk = await step('W2 Ana walks in over the tyres, across the ring, out the far side and past the scrub to the flag without getting stuck', async () => {
    const t0 = Date.now(); let h, last = null, stillSince = Date.now(), longestStill = 0, arrivedAt = null, wasInside = false, crossings = 0, prevIn = null; const path = [];
    while (Date.now() - t0 < 10 * 60_000) {
      h = await hereOf(); const p = h?.me?.pos;
      if (p) {
        path.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
        const inside = ell(p) < 1; if (prevIn !== null && inside !== prevIn) crossings++; prevIn = inside; if (inside) wasInside = true;
        const moving = !last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.2;
        if (Math.hypot(p[0] - FLAG[0], p[1] - FLAG[1]) < 4 && h?.me?.activity?.kind !== 'walk') { arrivedAt = p; break; }
        if (moving) stillSince = Date.now(); else longestStill = Math.max(longestStill, Date.now() - stillSince);
        last = p;
      }
      await sleep(1000);
    }
    // the scrub she passed (the same deterministic points the viewer draws; viewer-side exclusions aside)
    const { scrubPoints } = await import(resolve(root, 'packages/generators/src/desert.ts'));
    const e = (await snapshot()).entities.find((x) => x.name === 'scrub');
    const pts = scrubPoints(e.shape.area, e.params ?? {}, e.seed ?? 0).filter((q) => q.k <= 2);
    const near = new Set(); for (const p of path) pts.forEach((q, i) => { if (Math.hypot(q.x - p[0], q.z - p[1]) < 8) near.add(i); });
    return { arrivedAt, seconds: Math.round((Date.now() - t0) / 1000), crossings, wasInside, longestStillMs: longestStill, bushesWithin8m: near.size, samples: path.length, path: path.filter((_, i) => i % 5 === 0) };
  }, (r) => r.arrivedAt && r.wasInside && r.crossings >= 2 && r.longestStillMs <= 5000);
  if (chromium) for (const dpr of dprs) {
    const release = await chromeLease('marsland-near-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await god('time', '11:00'); await god('weather', '--kind', 'clear');
      await page.goto(`${base}?dev=1&weather=off`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      await step(`V1[${d}] the ring, the scrub and Ana on the playa (real Chrome)`, async () => {
        await waitFor(page, async () => ({ ok: await page.evaluate(() => !!window.__simEntity?.layer?.active) }), 60000);
        await setCameraMode(page, 'manual'); await page.waitForTimeout(500);
        await page.locator('button[aria-label="collapse"]').first().click().catch(() => {});
        await page.waitForTimeout(3000);
        const stats = await page.evaluate(() => { const g = window.__simEntity?.layer?.group; let ring = 0, scrub = 0, draws = 0; g?.traverse((o) => { if (o.isInstancedMesh && /^tire-ring/.test(o.name)) ring = o.count; if (o.isInstancedMesh && /^scrub:/.test(o.name)) { scrub += o.count; draws++; } }); return { ring, scrub, scrubDraws: draws }; });
        const p = (await hereOf())?.me?.pos ?? FLAG;
        await look(page, [p[0] + 14, 6, p[1] + 12], [p[0] - 2, 0.8, p[1] - 1]); await page.waitForTimeout(4000); await snap(page, `v1-ana-at-the-flag-${d}`);
        await look(page, [RING.c[0] + 30, 3, RING.c[1] + 60], [RING.c[0] - 20, 0.3, RING.c[1] + 20]); await page.waitForTimeout(3000); await snap(page, `v2-tyres-close-${d}`);
        await look(page, [RING.c[0] + 150, 90, RING.c[1] + 120], [RING.c[0], 0, RING.c[1]]); await page.waitForTimeout(3000); await snap(page, `v3-ring-from-the-air-${d}`);
        return { pos: p, errors, stats };
      }, (r) => !r.errors.length && r.stats.ring > 100 && r.stats.scrub > 100 && r.stats.scrubDraws <= 5);
      await ctx.close();
    } finally { await browser.close().catch(() => { }); release(); }
  }
} catch (e) { report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('✖ harness', e); }
finally {
  report.finishedAt = new Date().toISOString(); report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1)); writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200_000));
  writeFileSync(resolve(out, 'REPORT.md'), `# MARSLAND-NEAR e2e — ${report.passed}/${report.total}\n\n${report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`).join('\n')}\n\nShots:\n${report.shots.map((f) => `- ${f}`).join('\n')}\n`);
  log(`\n${report.passed}/${report.total} — ${out}`);
  if (!args.keep) try { server?.kill(); } catch { }
  process.exit(report.failures.length ? 1 : 0);
}
