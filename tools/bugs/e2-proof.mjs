#!/usr/bin/env node
// E2 bug-list proof in real Chrome (lane bugs, 2026-10-16). One fresh god world on the lane's port; the harness plays the
// god (eden-god CLI + the god env API, as a creator's agent does) and one Soul (the unchanged Soul CLI); the viewer is real
// Chrome (Metal GPU, shared Chrome lease) at dpr 1 and 2 with real clicks.
//   #8 rain: the god sets rain, then clear, then rain and back to the schedule ('auto'): seconds until rain stops drawing.
//   #7 Explore: the god's landmarks (a lido, a hall, the digger) show pictures, not the generic house icon; a card frames.
//   #5 pool: the lido is a sunken basin (terrain under the water is 1.6 m down); close-up via its Explore card.
//   #4 working parts: excavator arm and forklift forks move while switched on (sampled from the drawn pivots), close-ups.
//   #3 flee: Ana walks to a deer; the deer bolts away from her and later returns.
//
//   node tools/bugs/e2-proof.mjs [--port 5980] [--dpr 1,2] [--keep]
// Report + screenshots under .lane/e2-proof/<stamp>/.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const slug = 'e2-proof', port = Number(args.port ?? 5980);
if (port >= 4930 && port <= 4987) throw new Error('never bind the production ports');
const dprs = String(args.dpr ?? '1,2').split(',').map(Number);
const out = resolve(root, '.lane/e2-proof', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Bug Proof', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', ENABLE_WORLD_ENGINE: '1', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}` };
let server, serverLog = '';
async function boot() {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  writeFileSync(resolve(out, 'server.pid'), String(server.pid));
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { } await sleep(100); }
  throw new Error('world did not come up');
}
process.on('exit', () => { writeFileSync(resolve(out, 'server.log'), serverLog); if (!args.keep) try { server?.kill(); } catch { } });

let godToken = '';
async function api(path, { method, body, token } = {}) {
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 1200); }
  const ok = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ms, ok, result, error }); if (!ok) report.failures.push({ name, result, error });
  log(`${ok ? '✔' : '✖'} ${name} — ${ms} ms${ok ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 700)}`);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  return result;
}
const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const run = (bin, dir, ...argv) => new Promise((ok) => execFile(process.execPath, [bin, ...argv], { cwd: dir, timeout: 180_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1', EDEN_GOD_NO_LEASE: '1' } }, (e, so, se) => { const s = String(so); let d = null; try { d = JSON.parse(s.slice(s.indexOf('{'))); } catch { } ok({ code: e?.code ?? 0, raw: s + String(se), data: d }); }));
const godDir = resolve(out, 'god'); mkdirSync(godDir, { recursive: true });
const god = (...a) => run(GOD, godDir, ...a);
const soulDir = (n) => { const d = resolve(out, n.toLowerCase()); mkdirSync(d, { recursive: true }); return d; };
const soul = (n, ...a) => run(CLI, soulDir(n), ...a);
const godEnv = (body) => api('/v1/god/env', { body, token: godToken });

let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('(no @playwright/test)'); }
async function snap(page, name) { const f = resolve(out, `${name}.png`); await page.screenshot({ path: f }); report.shots.push(f); log(`  shot ${name}.png`); }
async function waitFor(fn, ms = 30000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await sleep(every); } return last; }
const rainNow = (page) => page.evaluate(() => { const a = window.__soulsLiving?.atmosphere?.(); return a ? { rain: a.state.rain, kind: a.kind, set: a.set } : null; });
// drawn things, read from the live scene (what the visitor's GPU draws)
const sceneRead = (page) => page.evaluate(() => {
  const s = window.__soulsEntity; if (!s) return null; const out = { boom: null, forks: null, deer: null };
  s.scene.traverse((o) => {
    if (o.name === 'role:boom') out.boom = +o.rotation.x.toFixed(4);
    if (o.name === 'role:forks') out.forks = +o.position.y.toFixed(4);
    if (o.userData?.rig?.species === 'deer') { const p = o.getWorldPosition(o.position.clone()); out.deer = [+p.x.toFixed(2), +p.z.toFixed(2)]; }
  });
  return out;
});

try {
  await boot(); log(`world ${base}`);
  await step('G0 the owner mints a god token', async () => { const r = await api('/v1/god/mint', { body: { label: 'e2-proof' }, token: 'dev:gene' }); godToken = r.data.token; writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken })); return !!godToken; }, (r) => r);
  const ana = await step('S0 Ana joins through the Soul CLI', async () => { await soul('Ana', 'register', base); const c = await soul('Ana', 'create-soul', 'Ana', 'Ana, who visits'); await sleep(2000); const h = await soul('Ana', 'here'); return { id: c.data?.soul?.id, pos: h.data?.me?.pos }; }, (r) => r.id && r.pos);
  const [ax, az] = ana?.pos ?? [0, 0];
  await step('G1 the god builds: a lido (swimming pool), a hall, a digger and a forklift (switched on), a deer 14 m from Ana', async () => {
    const cmds = [['place', 'swimming-pool', '--at', `${ax + 30},${az - 10}`, '--name', 'lido'], ['place', 'cottage', '--at', `${ax - 25},${az - 20}`, '--name', 'town-hall'],
      ['place', 'excavator', '--at', `${ax + 10},${az + 22}`, '--name', 'digger', '--state', '{"on":true}'], ['place', 'forklift', '--at', `${ax + 18},${az + 22}`, '--name', 'forklift', '--state', '{"on":true}'],
      ['place', 'deer', '--at', `${ax - 14},${az + 4}`, '--name', 'deer']];
    const res = []; for (const c of cmds) { const r = await god(...c); res.push({ cmd: c.slice(0, 2).join(' '), ok: r.code === 0 && !/REFUSED|Error/.test(r.raw ?? ''), out: (r.raw ?? '').slice(0, 300) }); }
    return { all: res.every((x) => x.ok), res };
  }, (r) => r.all);
  await step('W0 the lido carved its basin: ground under the water 1.6 m down, lawn just outside its deck untouched', async () => {
    const q = async (x, z) => (await api(`/v1/world/ground?x=${x}&z=${z}`)).data;
    return { centre: await q(ax + 30, az - 10), outside: await q(ax + 30 + 8.5, az - 10) };
  });

  if (chromium) for (const dpr of dprs) {
    const release = await chromeLease(`bugs-e2-proof-dpr${dpr}`).catch(() => null);
    if (!release) { log('(Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await godEnv({ timeOfDay: '11:00', weather: { kind: 'clear' } });
      await page.goto(`${base}?dev=1&atmos`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      await step(`V0[${d}] the world draws (entity layer, atmosphere live)`, async () => waitFor(async () => { const r = await rainNow(page), s = await sceneRead(page); return { ok: !!r && !!s && s.boom !== null && s.forks !== null && s.deer !== null, r, s }; }, 60000), (r) => r?.ok);

      // #8 rain
      for (const after of ['clear', 'auto']) {
        await step(`V8[${d}] rain stops promptly after the god sets ${after}`, async () => {
          await godEnv({ weather: { kind: 'rain', intensity: 0.8 } });
          const wet = await waitFor(async () => { const r = await rainNow(page); return { ok: r && r.rain > 0.6, ...r }; }, 60000);
          if (after === 'clear') await snap(page, `v8-raining-${d}`);
          await godEnv({ weather: { kind: after } }); const t0 = Date.now();
          const dry = await waitFor(async () => { const r = await rainNow(page); return { ok: r && r.rain < 0.01, ...r }; }, 120000, 250);
          const seconds = +((Date.now() - t0) / 1000).toFixed(1);
          if (after === 'clear') await snap(page, `v8-cleared-${seconds}s-${d}`);
          return { wet, dry, seconds };
        }, (r) => r.wet?.ok && r.dry?.ok && r.seconds < 20);
      }

      // #4 working parts, sampled from the drawn pivots
      await step(`V4[${d}] the digger's arm and the forklift's forks move while on`, async () => {
        const a = await sceneRead(page); await sleep(2500); const b = await sceneRead(page); await sleep(2500); const c = await sceneRead(page);
        return { a, b, c, boomMoves: new Set([a.boom, b.boom, c.boom]).size > 1, forksMove: new Set([a.forks, b.forks, c.forks]).size > 1 };
      }, (r) => r.boomMoves && r.forksMove);

      // #7 Explore pictures, then frame the lido and the digger by clicking their cards
      await step(`V7[${d}] Explore (real click) lists the god's landmarks with pictures`, async () => {
        await page.getByRole('button', { name: /^Explore /i }).first().click();
        const r = await waitFor(async () => { const n = await page.evaluate(() => ({ cards: document.querySelectorAll('.explore-locations button').length, pictures: document.querySelectorAll('.explore-locations .explore-picture img').length, labels: [...document.querySelectorAll('.explore-locations button span:last-child')].map((s) => s.textContent) })); return { ok: n.cards >= 3 && n.pictures >= 3, ...n }; }, 30000);
        await snap(page, `v7-explore-pictures-${d}`); await page.keyboard.press('Escape');
        return r;
      }, (r) => r?.ok);
      await step(`V5[${d}] click the lido's Explore card (real click): the camera frames the sunken basin`, async () => {
        await page.getByRole('button', { name: /^Explore /i }).first().click();
        await page.locator('.explore-locations button', { hasText: /^lido$/i }).first().click(); await sleep(4000);
        await snap(page, `v5-lido-basin-${d}`); return { dialogClosed: !(await page.locator('.explore-modal').isVisible().catch(() => false)) };
      }, (r) => r?.dialogClosed);
      // the digger and forklift are vehicles, not Explore landmarks: frame them with the camera for the close-ups
      const frame = (p, eye) => page.evaluate(([p, eye]) => { const s = window.__soulsEntity; s.controls.target.set(p[0], p[1], p[2]); s.camera.position.set(eye[0], eye[1], eye[2]); s.controls.update?.(); }, [p, eye]);
      await step(`V4c[${d}] close-ups: digger arm at two moments, forklift forks`, async () => {
        await frame([ax + 11, 1.6, az + 22], [ax + 4, 5.5, az + 32]); await sleep(1500); await snap(page, `v4-digger-arm-${d}`); const a = await sceneRead(page);
        await sleep(3500); await snap(page, `v4-digger-arm-later-${d}`); const b = await sceneRead(page);
        await frame([ax + 18, 1.2, az + 23], [ax + 22, 3, az + 28]); await sleep(1500); await snap(page, `v4-forklift-forks-${d}`);
        return { boom: [a.boom, b.boom] };
      }, (r) => r.boom[0] !== r.boom[1]);

      // #3 flee: Ana walks to the deer; the deer runs from her
      if (dpr === dprs[0]) await step(`V3[${d}] Ana walks to the deer: it bolts away from her, keeping its distance`, async () => {
        const before = (await sceneRead(page)).deer, acted = await soul('Ana', 'act', 'walk to the deer');
        const samples = [];
        for (let i = 0; i < 30; i++) { await sleep(1000); const s = await sceneRead(page), h = await soul('Ana', 'here'); const me = h.data?.me?.pos; samples.push({ deer: s.deer, ana: me, gap: s.deer && me ? +Math.hypot(s.deer[0] - me[0], s.deer[1] - me[1]).toFixed(2) : null }); if (i === 6) await snap(page, `v3-deer-fleeing-${d}`); }
        const moved = Math.max(...samples.map((x) => (x.deer && before ? Math.hypot(x.deer[0] - before[0], x.deer[1] - before[1]) : 0)));
        return { accepted: acted.data?.accepted ?? acted.raw.slice(0, 200), before, moved: +moved.toFixed(2), minGap: Math.min(...samples.map((x) => x.gap ?? 99)), samples: samples.filter((_, i) => i % 5 === 0) };
      }, (r) => r.moved > 3 && r.minGap > 2);
      await step(`V9[${d}] no page errors`, async () => errors, (e) => e.length === 0);
    } finally { await browser.close().catch(() => {}); release(); }
  }
} catch (e) { report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log(String(e?.stack ?? e)); }
report.endedAt = new Date().toISOString();
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
log(`\n${report.steps.filter((s) => s.ok).length}/${report.steps.length} steps ok; ${out}`);
process.exit(report.failures.length ? 1 : 0);
