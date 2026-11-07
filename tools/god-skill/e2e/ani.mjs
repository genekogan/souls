#!/usr/bin/env node
// ANI e2e: horses give way to a Soul standing in their pasture (Gene 2026-10-20: "the horses just walk right through
// the souls"). A fresh world, one Soul born through the normal owner flow, five horses and a herd of four grazing
// round where she stands. Two pages watch the same seconds side by side (animals are a pure function of wall-clock
// time, so both see the same routines): one with ?giveway=0 (before) and one as shipped (after). Each samples every
// frame: the horses' drawn footprints (a rectangle of the horse's box, turned by its yaw) against the Soul's disc,
// and counts overlap frames. Shots: desktop 1280x800 dpr 1 and phone 390x844 dpr 2, before/after pairs taken at a
// moment a horse overlaps her in the before page.
//
//   node tools/god-skill/e2e/ani.mjs [--port 6770] [--secs 60] [--keep]
// Writes .lane/e2e/ani-<stamp>/{report.json,*.png}. Fake minds, $0.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const port = Number(flag('port', 6770)), secs = Number(flag('secs', 60)), slug = 'ani';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, '.lane/e2e', `ani-${stamp}`); mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], samples: {} };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = resolve(out, 'data'); mkdirSync(dataDir, { recursive: true });
const genesis = resolve(out, 'genesis.json');
writeFileSync(genesis, JSON.stringify({ schema: 'genesis/1', name: 'Pasture e2e', constants: { extent: 240, ground: 'land' }, state: { sky: { palette: 'clear-day', sun: 0.75 } }, batches: [] }));
const marsWeb = resolve(root, '.lane/mars-web');
const server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Pasture', ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, GENESIS_FILE: genesis } });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
process.on('exit', () => { if (!argv.includes('--keep')) try { server.kill(); } catch { } });

let godToken = '';
async function api(path, { body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (typeof as === 'object') headers.authorization = `Bearer ${as.token}`;
  else if (as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
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
const save = () => writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));

let browser = null, release = () => {};
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../lib/chrome-lease.mjs');
try {
  await step('the world comes up', async () => { for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return true; } catch { } await sleep(100); } return false; }, (x) => x);
  await step('mint a god token', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'ani-e2e' } }); godToken = r.data.token; return !!godToken; }, (x) => x);
  const soul = await step('an owner creates a Soul "Mira"; an agent pairs; she is born and stands still', async () => {
    const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
    await api('/v1/invite', { as: 'mira-owner', body: { code: inv.data.code } });
    const s = (await api('/v1/souls', { as: 'mira-owner', body: { name: 'Mira', description: 'stands in the pasture watching the horses' } })).data.soul;
    const c = await api(`/v1/souls/${s.id}/pair`, { as: 'mira-owner', body: {} });
    const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'ani e2e' } });
    for (let i = 0; i < 60; i++) { const o = (await api('/v1/edge/observe', { as: { token: x.data.token } })).data; if (o?.self?.position) return { id: s.id, p: o.self.position }; await sleep(500); }
    return null;
  }, (r) => r?.p);
  const [sx, , sz] = soul.p;
  // five horses whose wander discs are centred round her, and a herd of four in a square on her: their walks cross her spot
  await step('a pasture round her: five horses and a herd of four', async () => api('/v1/god/act', { body: { group: 'pasture', note: 'horses', ops: [
    ...[0, 1, 2, 3, 4].map((i) => ({ op: 'place', def: 'core/horse@1', name: `horse-${i}`, p: [sx + Math.cos(i * 1.2566) * 2.5, sz + Math.sin(i * 1.2566) * 2.5], params: { behavior: 'wander', radius: 5, speed: 1.2 } })),
    { op: 'place', def: 'core/animals@1', name: 'herd', shape: { area: [[sx - 6, sz - 6], [sx + 6, sz - 6], [sx + 6, sz + 6], [sx - 6, sz + 6]] }, params: { species: 'horse', count: 4, behavior: 'wander', speed: 1.3 } },
  ] } }), (r) => r.status === 200 && r.data?.accepted === true);

  const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
  release = await chromeLease('t4-ani-e2e');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  const eye = `${(sx - 8).toFixed(1)},4.5,${(sz - 8).toFixed(1)}`, at = `${sx.toFixed(1)},0.6,${sz.toFixed(1)}`;
  const open = async (label, extra, viewport, dpr) => {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: dpr })).newPage(); page.setDefaultTimeout(600000);
    page.on('pageerror', (e) => report.failures.push({ name: `${label} pageerror`, error: String(e).slice(0, 300) }));
    await page.goto(`${base}?dev=1&shot=1&eye=${eye}&at=${at}${extra}`, { waitUntil: 'commit', timeout: 300000 });
    let steady = 0;
    for (let i = 0; i < 900 && steady < 5; i++) { const ok = await page.evaluate(() => { const w = window.__soulsEntity; return !!w?.layer?.active && !!w.layer.model && w.layer.drawn?.size >= 6; }).catch(() => false); steady = ok ? steady + 1 : 0; await page.waitForTimeout(1000); }
    return page;
  };
  /** In the page: every frame for `ms`, each horse's footprint (its box turned by its yaw) against her disc (r 0.3 m). */
  const watch = (page, ms) => page.evaluate(([ms, sx, sz]) => new Promise((done) => {
    const w = window.__soulsEntity, horses = [];
    for (const d of w.layer.drawn.values()) { if (d.obj.userData.rig) horses.push(d.obj); for (const c of d.obj.children) if (c.userData.rig) horses.push(c); }
    const v = new (horses[0].position.constructor)();
    let frames = 0, overlapFrames = 0, minGap = Infinity, frameMs = [];
    const t0 = performance.now(); let last = t0;
    const tick = () => {
      const now = performance.now(); frameMs.push(now - last); last = now; frames++;
      let any = false;
      for (const h of horses) {
        h.getWorldPosition(v); const m = h.matrixWorld.elements, yaw = Math.atan2(m[8], m[10]), s = Math.hypot(m[8], m[9], m[10]);
        const rig = h.userData.rig, halfL = rig.length * 0.5 * (rig.scale ?? s) , halfW = 0.24 * (rig.scale ?? s);
        const dx = sx - v.x, dz = sz - v.z, c = Math.cos(yaw), sn = Math.sin(yaw);
        const along = dx * sn + dz * c, side = dx * c - dz * sn;   // into the horse's frame (it faces +z)
        const ox = Math.max(0, Math.abs(along) - halfL), oz = Math.max(0, Math.abs(side) - halfW), gap = Math.hypot(ox, oz) - 0.3;
        minGap = Math.min(minGap, gap); if (gap < 0) any = true;
      }
      if (any) overlapFrames++;
      if (now - t0 < ms) requestAnimationFrame(tick); else { frameMs.sort((a, b) => a - b); done({ horses: horses.length, frames, overlapFrames, minGap: +minGap.toFixed(3), frameP50: +frameMs[frameMs.length >> 1].toFixed(1) }); }
    };
    requestAnimationFrame(tick);
  }), [ms, sx, sz]);
  const overlapNow = (page) => page.evaluate(([sx, sz]) => {
    const w = window.__soulsEntity, hs = []; for (const d of w.layer.drawn.values()) { if (d.obj.userData.rig) hs.push(d.obj); for (const c of d.obj.children) if (c.userData.rig) hs.push(c); }
    const v = new (hs[0].position.constructor)(); let best = Infinity;
    for (const h of hs) { h.getWorldPosition(v); best = Math.min(best, Math.hypot(v.x - sx, v.z - sz)); }
    return best;
  }, [sx, sz]);

  for (const [name, viewport, dpr] of [['desktop', { width: 1280, height: 800 }, 1], ['phone', { width: 390, height: 844 }, 2]]) {
    const before = await open(`${name} before`, '&giveway=0', viewport, dpr), after = await open(`${name} after`, '', viewport, dpr);
    await before.waitForTimeout(3000);
    const watched = await step(`${name}: the same ${secs} s watched before (?giveway=0) and after`, async () => {
      const [b, a] = await Promise.all([watch(before, secs * 1000), watch(after, secs * 1000)]);
      return { before: b, after: a };
    }, (r) => r.after.overlapFrames === 0 && r.after.horses >= 9);
    report.samples[name] = watched;
    // a before/after pair at a moment a horse is on her in the before page
    await step(`${name}: before/after shots while a horse is on top of her (before)`, async () => {
      for (let i = 0; i < 480; i++) {
        if ((await overlapNow(before)) < 0.6) {
          const fb = resolve(out, `${name}-before.png`), fa = resolve(out, `${name}-after.png`);
          await Promise.all([before.screenshot({ path: fb }), after.screenshot({ path: fa })]);
          report.shots.push(fb, fa); return { shot: true, at: i };
        }
        await before.waitForTimeout(250);
      }
      return { shot: false };
    }, (r) => r.shot);
    await before.context().close(); await after.context().close();
    save();
  }
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
} finally {
  await browser?.close().catch(() => {}); release();
  report.ok = report.failures.length === 0; report.finishedAt = new Date().toISOString(); save();
  if (!report.ok) writeFileSync(resolve(out, 'server.log'), serverLog.slice(-20000));
  log(`${report.ok ? 'PASS' : 'FAIL'} — ${out}`);
  if (!argv.includes('--keep')) server.kill();
  process.exit(report.ok ? 0 : 1);
}
