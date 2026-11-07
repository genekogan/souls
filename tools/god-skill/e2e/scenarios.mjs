#!/usr/bin/env node
// End-to-end scenarios for god mode (Gene, 2026-10-10): create a named world,
// then build / move / modify / remove things quickly the way a client agent
// would, timing every batch, checking the server's answer against the world,
// and photographing the result. Writes a report under .lane/e2e/<stamp>/.
//
//   node tools/god-skill/e2e/scenarios.mjs [--port 4991] [--slug e2e-<stamp>] [--keep] [--no-shots]
//
// Starts its own server process on a fresh DATA_DIR (fake minds, DEV_AUTH),
// so it never touches a running world. Screenshots need Google Chrome.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromeLease } from '../lib/chrome-lease.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : `e2e-${stamp.slice(5, 16).toLowerCase()}`;
const port = Number(args.port ?? 4991);
const out = resolve(root, '.lane/e2e', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], timings: [], failures: [] };
const log = (...a) => { console.log(...a); };
const t = () => performance.now();

// ---------- the world process
log(`▶ creating world "${slug}" on :${port}`);
const marsWeb = resolve(root, '.lane/mars-web');
const server = spawn('node', ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` } });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
const stop = () => { try { server.kill(); } catch { } };
process.on('exit', () => { if (!args.keep) stop(); });
const bootT = t();
for (let i = 0; i < 1200; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) break; } catch { } await new Promise((r) => setTimeout(r, 100)); }
const bootMs = t() - bootT;
log(`  booted in ${bootMs.toFixed(0)} ms`);

// ---------- a tiny client (what the skill does)
let token = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god' && token) headers.authorization = `Bearer ${token}`;
  if (as === 'owner') headers.authorization = 'Bearer dev:admin';
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = t();
  let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.message ?? e); }
  const ms = t() - t0;
  const okay = !error && (expect ? expect(result) : true);
  report.steps.push({ name, ms: +ms.toFixed(1), ok: okay, result: summarize(result), error });
  report.timings.push(ms);
  if (!okay) report.failures.push({ name, result: summarize(result), error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(summarize(result)).slice(0, 300))}`);
  return result;
}
const summarize = (r) => { if (!r || typeof r !== 'object') return r; const d = r.data ?? r; if (d && typeof d === 'object') { const { ids: _i, ...rest } = d; if (rest.entities) rest.entities = rest.entities.length; if (rest.defs) rest.defs = rest.defs.length; if (rest.tiles && typeof rest.tiles === 'object') rest.tiles = Object.keys(rest.tiles).length; if (rest.library) rest.library = rest.library.length; return rest; } return d; };
const accepted = (r) => r.status === 200 && r.data?.accepted === true;
const refusedWith = (code) => (r) => r.status === 200 && r.data?.accepted === false && r.data.failures?.[0]?.code === code;
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const snapshot = async () => (await api('/v1/world/snapshot', { as: 'none' })).data;
const find = (snap, name) => snap.entities.find((e) => e.name === name);

// ---------- screenshots (Chrome via the viewer's Playwright)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
let browser = null, page = null, releaseChrome = () => {};
async function shot(name, { eye, at, wait = 6000 } = {}) {
  if (!chromium) return;
  if (!browser) { try { releaseChrome = await chromeLease('e2e-' + slug); browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] }); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); }); page = await ctx.newPage(); page.setDefaultTimeout(120000); } catch (e) { log('  (Chrome unavailable: ' + e.message.split('\n')[0] + ')'); chromium = null; return; } }
  const q = new URLSearchParams({ dev: '1' }); if (eye) q.set('eye', eye.join(',')); if (at) q.set('at', at.join(','));
  const t0 = t();
  if (!page.url().startsWith(base)) { await page.goto(`${base}?${q}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(Math.max(wait, 20000)); }
  else { if (eye && at) await page.evaluate(([e, a]) => { const w = window.__soulsEntity; if (!w) return; w.controls.target.set(a[0], a[1], a[2]); w.camera.position.set(e[0], e[1], e[2]); w.camera.lookAt(w.controls.target); }, [eye, at]); await page.waitForTimeout(wait); }
  const state = await page.evaluate(() => { const w = window.__soulsEntity; return w ? { active: w.layer.active, drawn: w.layer.drawn?.size ?? null, sectors: w.layer.sectors?.size ?? null } : null; });
  const file = resolve(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 180000 });
  report.shots.push({ name, file, state, ms: +(t() - t0).toFixed(0) });
  log(`  📷 ${name}.png ${JSON.stringify(state)}`);
}

// ================================================================ scenarios
try {
  // S0: the god claims the new world
  await step('S0 mint god token for the new world', async () => { const r = await api('/v1/god/mint', { as: 'owner', body: { label: 'e2e' } }); token = r.data.token; return r; }, (r) => r.status === 200 && typeof r.data.token === 'string');
  await step('S0 empty world snapshot', snapshot, (s) => s.entities.length === 0 && s.constants.extent === 1000);
  await shot('s0-empty', { eye: [-120, 60, 160], at: [0, 0, 0], wait: 4000 });

  // S1: terrain, as one quick batch, then a second batch right behind it
  await step('S1 mountains east, lake west, hill north', () => act([
    { op: 'place', def: 'core/mountain@1', name: 'east-range', shape: { path: [[320, -260], [360, 260]], width: 150 }, params: { height: 200, peak: 2.5 } },
    { op: 'place', def: 'core/lake@1', name: 'west-lake', shape: { area: [[-280, -60], [-190, -110], [-150, 0], [-230, 70]] }, params: { depth: 6, level: -0.4 } },
    { op: 'place', def: 'core/hill@1', name: 'north-hill', p: [-40, -260], params: { height: 35, radius: 120 } },
  ], 'S1 terrain'), accepted);
  await step('S1 knoll and a pond right after', () => act([
    { op: 'place', def: 'core/knoll@1', name: 'knoll', p: [40, 10], params: { height: 5, radius: 22 } },
    { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-30, 40], [-10, 36], [-4, 52], [-24, 58]] } },
  ], 'S1 knoll'), accepted);
  await step('S1 terrain is real: mountain high, lake deep, knoll raised', async () => { const s = await snapshot(); return { lf: s.ground.landforms.length, waters: s.ground.waters.length }; }, (r) => r.lf >= 5 && r.waters === 2);

  // S2: build a hamlet quickly (cottage with furniture, benches, lamps, fountain, trees, meadow, garden)
  await step('S2 cottage on the knoll with furniture inside and a bench out front', () => act([
    { op: 'place', tmp: '$c', def: 'core/cottage@1', name: 'cottage', p: [48, 10], r: 1.2 },
    { op: 'place', tmp: '$t', def: 'core/table@1', name: 'table', in: { parent: '$c' }, p: [0, 0, 0] },
    { op: 'place', def: 'core/chair@1', name: 'chair-1', in: { parent: '$c' }, p: [1.0, 0, 0], r: -1.57 },
    { op: 'place', def: 'core/chair@1', name: 'chair-2', in: { parent: '$c' }, p: [-1.0, 0, 0], r: 1.57 },
    { op: 'place', def: 'core/bowl@1', name: 'bowl', in: { parent: '$t', slot: 'top' } },
    { op: 'place', def: 'core/bench@1', name: 'bench', in: { parent: '$c' }, p: [0, 0, 5] },
  ], 'S2 cottage'), accepted);
  await step('S2 square: fountain, four lamp posts, four benches', () => act([
    { op: 'place', def: 'core/fountain@1', name: 'fountain', p: [0, -40] },
    ...[[-8, -48], [8, -48], [-8, -32], [8, -32]].map((p, i) => ({ op: 'place', def: 'core/lamp-post@1', name: `lamp-${i + 1}`, p })),
    ...[[-6, -40, 1.57], [6, -40, -1.57], [0, -46, 0], [0, -34, 3.14]].map(([x, z, r], i) => ({ op: 'place', def: 'core/bench@1', name: `square-bench-${i + 1}`, p: [x, z], r })),
  ], 'S2 square'), accepted);
  await step('S2 trees, a meadow and a garden', () => act([
    ...[[20, -20], [25, -60], [-30, -70], [70, -30], [-60, 10]].map((p, i) => ({ op: 'place', def: 'core/tree@1', name: `tree-${i + 1}`, p, s: 0.8 + i * 0.1 })),
    { op: 'place', def: 'core/forest@1', name: 'woods', shape: { area: [[-80, 70], [60, 70], [60, 150], [-80, 150]] } },
    { op: 'place', def: 'core/meadow@1', name: 'meadow', shape: { area: [[80, -10], [160, -10], [160, 60], [80, 60]] } },
    { op: 'place', def: 'core/garden@1', name: 'garden', shape: { area: [[52, 20], [64, 20], [64, 28], [52, 28]] } },
  ], 'S2 green'), accepted);
  await step('S2 everything is where the god put it', async () => { const s = await snapshot(); const c = find(s, 'cottage'), b = find(s, 'bowl'), tbl = find(s, 'table'); return { n: s.entities.length, cottageY: c?.p?.[1], bowlOnTable: b?.in?.parent === tbl?.id && b?.in?.slot === 'top', pad: s.ground.landforms.some((l) => l.id === `${c?.id}:pad`) }; }, (r) => r.n === 28 && r.cottageY > 0.3 && r.bowlOnTable && r.pad);
  await shot('s2-hamlet', { eye: [-90, 70, 130], at: [20, 0, -10], wait: 7000 });
  await shot('s2-cottage-close', { eye: [30, 14, 40], at: [48, 2, 10], wait: 2500 });

  // S3: move things (a bench closer, the cottage with everything in it, a nudge out of a collision)
  await step('S3 move the bench closer to the door', () => act([{ op: 'move', id: 'cottage/bench', p: [0, 0, 3.8] }]), accepted);
  const before = find(await snapshot(), 'bowl');
  await step('S3 move the whole cottage 12 m east; its furniture and bowl ride along', () => act([{ op: 'move', id: 'cottage', p: [60, 10], r: 0.9 }]), accepted);
  await step('S3 the bowl is still on the table in the moved cottage', async () => { const s = await snapshot(); const b = find(s, 'bowl'), c = find(s, 'cottage'); return { same: b.in.parent === before.in.parent, cottageX: c.p[0], pads: s.ground.landforms.filter((l) => l.id.endsWith(':pad')).length }; }, (r) => r.same && r.cottageX === 60 && r.pads === 1);
  await step('S3 placing a bench inside the fountain is refused with a suggestion', () => act([{ op: 'place', def: 'core/bench@1', name: 'bad-bench', p: [0.5, -40] }]), (r) => refusedWith('overlap.solid')(r) && !!r.data.failures[0].suggest);
  await step('S3 the same bench with nudge is accepted beside the fountain', () => act([{ op: 'place', def: 'core/bench@1', name: 'nudged-bench', p: [0.5, -40], mode: 'nudge' }]), accepted);
  await shot('s3-moved', { eye: [-20, 40, 70], at: [40, 2, -10], wait: 4000 });

  // S4: modify (recolor, resize via params, rename, sky, constitution)
  await step('S4 paint the cottage blue and widen it', () => act([{ op: 'set', id: 'cottage', state: { paint: '#3366cc' }, params: { w: 10 } }]), accepted);
  await step('S4 rename a lamp, turn it off', () => act([{ op: 'set', id: 'lamp-1', name: 'corner-lamp', state: { on: false } }]), accepted);
  await step('S4 sky and constitution', () => act([{ op: 'world', state: { sky: { palette: 'clear-day', sun: 0.8 }, constitution: '# e2e world\nPrayers answered in order of arrival.' } }]), accepted);
  await step('S4 changes landed', async () => { const s = await snapshot(); const c = find(s, 'cottage'); return { paint: c.state?.paint, w: c.params?.w, lamp: !!find(s, 'corner-lamp'), con: s.state.constitution.startsWith('# e2e') }; }, (r) => r.paint === '#3366cc' && r.w === 10 && r.lamp && r.con);
  await step('S4 unknown state field is refused', () => act([{ op: 'set', id: 'cottage', state: { roof: 'tin' } }]), refusedWith('state.invalid'));
  await step('S4 placing outside the world is refused; expanding fixes it', async () => { const r1 = await act([{ op: 'place', def: 'core/rock@1', name: 'far-rock', p: [700, 0] }]); const r2 = await act([{ op: 'expand', extent: 2000 }, { op: 'place', def: 'core/rock@1', name: 'far-rock', p: [700, 0] }]); return { r1, r2 }; }, (r) => refusedWith('extent.outside')(r.r1) && accepted(r.r2));

  // S5: remove, undo, redo
  const n0 = (await snapshot()).entities.length;
  await step('S5 remove the square (fountain + lamps + benches) in one batch', () => act([{ op: 'remove', id: 'fountain' }, ...[1, 2, 3, 4].map((i) => ({ op: 'remove', id: i === 1 ? 'corner-lamp' : `lamp-${i}` })), ...[1, 2, 3, 4].map((i) => ({ op: 'remove', id: `square-bench-${i}` })), { op: 'remove', id: 'nudged-bench' }]), accepted);
  await step('S5 undo brings the square back exactly', async () => { const r = await api('/v1/god/undo', { method: 'POST' }); const s = await snapshot(); return { r, n: s.entities.length, lampOff: find(s, 'corner-lamp')?.state?.on === false }; }, (x) => accepted(x.r) && x.n === n0 && x.lampOff);
  await step('S5 redo removes it again; undo twice restores', async () => { const a = await api('/v1/god/redo', { method: 'POST' }); const n1 = (await snapshot()).entities.length; const b = await api('/v1/god/undo', { method: 'POST' }); const n2 = (await snapshot()).entities.length; return { a, b, n1, n2 }; }, (x) => accepted(x.a) && x.n1 === n0 - 10 && accepted(x.b) && x.n2 === n0);
  await step('S5 remove the cottage removes its furniture and its terrace', async () => { const r = await act([{ op: 'remove', id: 'cottage' }]); const s = await snapshot(); return { r, bowl: !!find(s, 'bowl'), pads: s.ground.landforms.filter((l) => l.id.endsWith(':pad')).length }; }, (x) => accepted(x.r) && !x.bowl && x.pads === 0);
  await step('S5 undo restores cottage, furniture, bowl on table, terrace', async () => { const r = await api('/v1/god/undo', { method: 'POST' }); const s = await snapshot(); const b = find(s, 'bowl'), tbl = find(s, 'table'); return { r, bowlOnTable: b?.in?.parent === tbl?.id, pads: s.ground.landforms.filter((l) => l.id.endsWith(':pad')).length }; }, (x) => accepted(x.r) && x.bowlOnTable && x.pads === 1);
  await shot('s5-restored', { eye: [-90, 70, 130], at: [20, 0, -10], wait: 5000 });

  // S6: a burst — 40 small placements as fast as the agent can send them
  await step('S6 burst: 40 rocks and trees, one request each', async () => { const ms = []; for (let i = 0; i < 40; i++) { const t0 = t(); const r = await act([{ op: 'place', def: i % 2 ? 'core/rock@1' : 'core/tree@1', name: `burst-${i}`, p: [-120 + (i % 10) * 6, 100 + Math.floor(i / 10) * 8], mode: 'nudge' }]); ms.push(t() - t0); if (!accepted(r)) return { fail: r.data }; } ms.sort((a, b) => a - b); return { p50: +ms[20].toFixed(1), p95: +ms[38].toFixed(1), max: +ms[39].toFixed(1) }; }, (r) => !r.fail && r.p95 < 250);
  await step('S6 one batch of 40 at once', () => act(Array.from({ length: 40 }, (_, i) => ({ op: 'place', def: 'core/tree@1', name: `grove-${i}`, p: [120 + (i % 8) * 5, 100 + Math.floor(i / 8) * 5], s: 0.7 + (i % 5) * 0.1 }))), accepted);

  // S8: flags as reference points — from the API, then from the website (Alt+click → prompt → placed)
  await step('S8 drop a flag "camp" and build relative to it', async () => {
    const r1 = await act([{ op: 'place', def: 'core/flag@1', name: 'camp', p: [-60, -60], state: { label: 'camp' } }]);
    const s1 = await snapshot(); const f = find(s1, 'camp'); const at = [f.p[0] + 8, f.p[f.p.length - 1]];
    const r2 = await act([{ op: 'place', def: 'core/bench@1', name: 'camp-bench', p: at }]);
    const s2 = await snapshot(); const b = find(s2, 'camp-bench');
    return { r1, r2, flagAt: [f.p[0], f.p[2]], benchAt: [b?.p?.[0], b?.p?.[2]] };
  }, (r) => accepted(r.r1) && accepted(r.r2) && r.benchAt[0] === r.flagAt[0] + 8);
  // G5 (Gene 2026-10-20b): flags are switched off on the page (apps/web/src/god-ui/features.ts): no ⚑ button, Alt+click places nothing
  if (chromium && page) await step('S8 flags are switched off on the website: no flag button, Alt+click on the ground places nothing', async () => {
    const n0 = (await snapshot()).entities.length;
    let dialogSeen = null; page.once('dialog', (d) => { dialogSeen = d.message(); void d.dismiss(); });
    await page.locator('canvas').first().click({ position: { x: 640, y: 420 }, modifiers: ['Alt'] });
    await page.waitForTimeout(2500);
    return { n: (await snapshot()).entities.length - n0, button: await page.locator('[data-flag-button]').count(), dialogSeen };
  }, (r) => r.n === 0 && r.button === 0 && !r.dialogSeen);
  await shot('s8-flags', { eye: [-110, 40, -10], at: [-60, 2, -60], wait: 4000 });

  // S7: restart — everything survives
  await step('S7 restart the world process; state identical', async () => {
    const a = await snapshot();
    stop(); await new Promise((r) => setTimeout(r, 800));
    const again = spawn('node', ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` } });
    again.stdout.on('data', (d) => { serverLog += d; }); again.stderr.on('data', (d) => { serverLog += d; });
    process.on('exit', () => { if (!args.keep) try { again.kill(); } catch { } });
    for (let i = 0; i < 1200; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) break; } catch { } await new Promise((r) => setTimeout(r, 100)); }
    const b = await snapshot();
    const same = JSON.stringify(a.entities) === JSON.stringify(b.entities) && JSON.stringify(a.ground) === JSON.stringify(b.ground) && a.seq === b.seq;
    const god = await api('/v1/god/snapshot');
    return { same, n: b.entities.length, seq: b.seq, tokenStillValid: god.status === 200 };
  }, (r) => r.same && r.tokenStillValid);
  await shot('s7-after-restart', { eye: [-160, 110, 220], at: [20, 0, 20], wait: 20000 });
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  if (browser) await browser.close().catch(() => { });
  releaseChrome();
  const ms = [...report.timings].sort((a, b) => a - b);
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), p50: ms.length ? +ms[Math.floor(ms.length / 2)].toFixed(1) : null, p95: ms.length ? +ms[Math.floor(ms.length * 0.95)].toFixed(1) : null, max: ms.length ? +ms[ms.length - 1].toFixed(1) : null, totalMs: +report.timings.reduce((a, b) => a + b, 0).toFixed(0) };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# god-mode e2e — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · step p50 ${report.summary.p50} ms · p95 ${report.summary.p95} ms · max ${report.summary.max} ms`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 160)} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\` ${JSON.stringify(s.state)}`)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  // a remote run (Modal) keeps only stdout: on a failure, the server's last lines say why (S7's restart refused its snapshot)
  if (report.summary.failed) log(`--- server log (last 30 lines) ---\n${serverLog.split('\n').slice(-30).join('\n')}\n---`);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed; p50 ${report.summary.p50} ms, p95 ${report.summary.p95} ms. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
