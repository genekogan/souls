#!/usr/bin/env node
// L4 e2e: a dog trots around a yard and a duck family swims on a pond, in a real world through the
// god API and the real viewer. Proof of motion is read from the viewer itself (creature positions
// at two moments a few seconds apart) and photographed (two shots per scene). Also: the library
// search finds the duck, and the dog never stands inside the yard's furniture.
//
//   node tools/god-skill/e2e/creatures.mjs [--port 4997] [--keep]
// Writes .lane/e2e/creatures-<stamp>/{REPORT.md,report.json,*.png}. Fake minds, $0.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const port = Number(flag('port', 4997)), slug = 'creatures';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, '.lane/e2e', `creatures-${stamp}`); mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);

// ---- a fresh world process (small extent: cheap to render on a loaded laptop)
const dataDir = resolve(out, 'data'); mkdirSync(dataDir, { recursive: true });
const genesis = resolve(out, 'genesis.json');
writeFileSync(genesis, JSON.stringify({ schema: 'genesis/1', name: 'Creatures e2e', constants: { extent: 240, ground: 'land' }, state: { sky: { palette: 'clear-day', sun: 0.75 } }, batches: [] }));
const marsWeb = resolve(root, '.lane/mars-web');
const server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: genesis } });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
process.on('exit', () => { if (!argv.includes('--keep')) try { server.kill(); } catch { } });
for (let i = 0; i < 1500; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { } await new Promise((r) => setTimeout(r, 200)); }

let token = '';
async function api(path, body, auth) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth ?? token}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return { status: r.status, data: JSON.parse(t) } } catch { return { status: r.status, data: t }; }
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e); }
  const ok = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ms: Math.round(performance.now() - t0), ok, result, error });
  if (!ok) report.failures.push({ name, result, error });
  log(`${ok ? '✔' : '✖'} ${name}${ok ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 400)}`);
  return result;
}
const accepted = (r) => r.status === 200 && r.data?.accepted === true;

let browser = null, release = () => {};
const { chromeLease } = await import(new URL('../lib/chrome-lease.mjs', import.meta.url).href);
try {
  await step('mint a god token', async () => { const r = await api('/v1/god/mint', { label: 'creatures-e2e' }, 'dev:admin'); token = r.data.token; return !!token; }, (x) => x);
  await step('library search: defs?q=duck finds the kit duck first', async () => { const r = await api('/v1/god/defs?q=duck'); return { first: r.data.defs?.[0]?.ref, n: r.data.count }; }, (r) => r.first === 'core-duck@1');
  await step('library search: defs?q=dog finds the dog', async () => { const r = await api('/v1/god/defs?q=dog'); return { refs: r.data.defs?.slice(0, 3).map((d) => d.ref) }; }, (r) => r.refs?.includes('core-dog@1'));

  // the yard: a table, two chairs and a bench as obstacles; a dog trotting about it
  await step('build a yard with furniture and a dog that wanders in it', () => api('/v1/god/act', { group: 'yard', note: 'dog yard', ops: [
    { op: 'place', tmp: '$t', def: 'core/table@1', name: 'yard-table', p: [-30, 0] },
    { op: 'place', def: 'core/chair@1', name: 'yard-chair-1', p: [-31.2, 0], r: 1.57 },
    { op: 'place', def: 'core/chair@1', name: 'yard-chair-2', p: [-28.8, 0], r: -1.57 },
    { op: 'place', def: 'core/bench-seat@1', name: 'yard-bench', p: [-30, 3.5] },
    { op: 'place', def: 'core/dog@1', name: 'rex', p: [-27, -2.5], params: { behavior: 'wander', radius: 5, speed: 1.3 } },
    { op: 'place', def: 'core/cat@1', name: 'tabby', p: [-33, 2.5], params: { behavior: 'wander', radius: 3, speed: 0.6 } },
  ] }), accepted);
  // the pond: a duck family (a drake placed on the water + a herd of ducklings), and koi under the surface
  await step('dig a pond; a duck and four ducklings swim on it, two koi below', () => api('/v1/god/act', { group: 'pond', note: 'duck pond', ops: [
    { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[18, -8], [34, -9], [37, 4], [22, 8], [16, 1]] }, params: { depth: 1.2, level: -0.15 } },
    { op: 'place', def: 'core/duck@1', name: 'mother-duck', p: [26, -1], params: { behavior: 'swim', radius: 5, speed: 0.45 } },
    { op: 'place', def: 'core/animals@1', name: 'ducklings', shape: { area: [[20, -5], [32, -6], [33, 3], [21, 5]] }, params: { species: 'duck', count: 4, scale: 0.5, speed: 0.5 } },
    { op: 'place', def: 'core/koi@1', name: 'koi-1', p: [28, 2], params: { radius: 3 } },
  ] }), accepted);

  // ---- the viewer
  const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
  release = await chromeLease('L4-creatures-e2e');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage(); page.setDefaultTimeout(600000);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await step('open the world in the viewer (patient: the laptop is loaded)', async () => {
    await page.goto(`${base}?dev=1&shot=1&eye=-25.5,2.4,-6.8&at=-29,0.3,-0.8`, { waitUntil: 'commit', timeout: 300000 });
    // the page may remount its entity layer once after the first snapshot: wait until one stays up
    let steady = 0;
    for (let i = 0; i < 900; i++) { const ok = await page.evaluate(() => { const w = window.__soulsEntity; return !!w?.layer?.active && !!w.layer.model && w.layer.drawn?.size > 5; }).catch(() => false); steady = ok ? steady + 1 : 0; if (steady >= 5) return true; await page.waitForTimeout(1000); }
    return false;
  }, (x) => x);
  await page.waitForTimeout(4000);   // ease-in of the placed things (2.5 s) and first motion frames
  const where = async (names) => { for (let i = 0; i < 120; i++) { const r = await whereOnce(names).catch(() => null); if (r) return r; await page.waitForTimeout(500); } throw new Error('viewer lost its entity layer'); };
  const whereOnce = (names) => page.evaluate((names) => {
    const w = window.__soulsEntity, out = {}; if (!w?.layer?.model) return null;
    const snap = [...w.layer.model.entities.values()];
    for (const n of names) {
      const e = snap.find((x) => x.name === n); const d = e && w.layer.drawn.get(e.id); if (!d) { out[n] = null; continue; }
      if (d.obj.userData.tick) out[n] = d.obj.children.filter((c) => c.userData.rig).map((c) => [c.position.x, c.position.y, c.position.z]);
      else out[n] = [[d.obj.position.x, d.obj.position.y, d.obj.position.z]];
    }
    return out;
  }, names);
  const look = (eye, at) => page.evaluate(([e, a]) => { const w = window.__soulsEntity; w.controls.target.set(...a); w.camera.position.set(...e); w.camera.lookAt(w.controls.target); }, [eye, at]);
  const shot = async (name) => { const file = resolve(out, `${name}.png`); await page.screenshot({ path: file, timeout: 600000 }); report.shots.push({ name, file }); log(`  📷 ${name}.png`); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

  // yard: two looks a few seconds apart
  await look([-25.5, 2.4, -6.8], [-29, 0.3, -0.8]);
  const y0 = await where(['rex', 'tabby']); await shot('yard-1');
  await page.waitForTimeout(5000);
  const y1 = await where(['rex', 'tabby']); await shot('yard-2');
  await step('the dog moved between the two looks (trotting, feet on the ground)', () => ({ moved: y0.rex && y1.rex ? +dist(y0.rex[0], y1.rex[0]).toFixed(2) : null, y: y1.rex?.[0]?.[1] }), (r) => r.moved > 0.2 && Math.abs(r.y) < 0.6);
  // sample the dog for a while: never inside the table or chairs
  await step('the dog never stands inside the yard furniture (40 samples over 20 s)', async () => {
    let inside = 0, maxR = 0; const home = [-27, -2.5];
    for (let i = 0; i < 40; i++) { const p = (await where(['rex'])).rex?.[0]; if (p) { if (Math.abs(p[0] + 30) < 0.75 && Math.abs(p[2]) < 0.5) inside++; maxR = Math.max(maxR, Math.hypot(p[0] - home[0], p[2] - home[1])); } await page.waitForTimeout(500); }
    return { inside, maxR: +maxR.toFixed(2) };
  }, (r) => r.inside === 0 && r.maxR <= 5.6);

  // pond
  await look([25.5, 2.6, 6.5], [26, -0.2, -0.8]);
  await page.waitForTimeout(2000);
  const p0 = await where(['mother-duck', 'ducklings', 'koi-1']); await shot('pond-1');
  await page.waitForTimeout(5000);
  const p1 = await where(['mother-duck', 'ducklings', 'koi-1']); await shot('pond-2');
  // swimmers rest between legs: also compare with a third look 15 s later (the largest displacement counts)
  await page.waitForTimeout(15000);
  const p2 = await where(['mother-duck', 'ducklings', 'koi-1']);
  for (const k of ['mother-duck', 'ducklings']) if (p2[k] && p0[k]) p1[k] = p1[k].map((q, i) => (dist(p2[k][i], p0[k][i]) > dist(q, p0[k][i]) ? p2[k][i] : q));
  await step('the duck family swims: the mother and the ducklings moved, all afloat on the pond', () => {
    const mother = p0['mother-duck'] && p1['mother-duck'] ? dist(p0['mother-duck'][0], p1['mother-duck'][0]) : null;
    const kids = (p1.ducklings ?? []).map((q, i) => dist(q, p0.ducklings[i]));
    const afloat = [...(p1.ducklings ?? []), ...(p1['mother-duck'] ?? [])].every((q) => q[1] < 0.1 && q[1] > -0.6);
    return { mother: mother && +mother.toFixed(2), kidsMoved: kids.filter((d) => d > 0.05).length, n: kids.length, afloat };
  }, (r) => r.mother > 0.1 && r.kidsMoved >= 2 && r.n === 4 && r.afloat);
  await step('no page errors', () => errors, (e) => e.length === 0);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('harness error', e);
} finally {
  if (browser) await browser.close().catch(() => { });
  release();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# creatures e2e — ${report.startedAt}`, '', `${report.steps.length} steps · ${report.failures.length} failed`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 200)} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.failures.length ? '✖' : '✔'} ${report.steps.length} steps, ${report.failures.length} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!argv.includes('--keep')) server.kill();
  process.exit(report.failures.length ? 1 : 0);
}
