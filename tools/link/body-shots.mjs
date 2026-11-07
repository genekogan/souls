#!/usr/bin/env node
// LINK BODY (2026-10-24) local proof in real Chrome: one fresh hello-hamlet world with the body clocks shortened (dev only,
// SIM_BODY_KNOBS), four Souls through the unchanged Soul CLI over real HTTP:
//   Ana keeps a listen open (awake) · Ben never listens (zombie, shuffling) · Cy never listens (asleep, lying down)
//   · Di swims into the pond and then stops listening (asleep, floating at the surface).
// Checks each body's public state (/v1/world/souls `body`) and photographs each one close up, then wakes Cy with a listen
// and photographs it standing. Report + shots under .lane/body-shots/<stamp>/.
//   node tools/link/body-shots.mjs [--port 5991] [--keep]
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const slug = 'body-shots', port = Number(args.port ?? 5991);
if (port >= 4930 && port <= 4987) throw new Error('never bind the production ports');
const out = resolve(root, '.lane/body-shots', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KNOBS = { sleepGraceMs: 8000, zombieWanderMs: 150000, zombieStepMinMs: 4000, zombieStepMaxMs: 8000, idleStartMs: 600000 };
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Body Shots', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', ENABLE_WORLD_ENGINE: '1', GENESIS_FILE: resolve(root, 'worlds/templates/hello-hamlet.json'), SIM_BODY_KNOBS: JSON.stringify(KNOBS), DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}` };
let server, serverLog = '';
const children = [];
process.on('exit', () => { writeFileSync(resolve(out, 'server.log'), serverLog); for (const c of children) try { c.kill(); } catch { } if (!args.keep) try { server?.kill(); } catch { } });
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 1200); }
  const ok = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ms, ok, result, error }); if (!ok) report.failures.push({ name, result, error });
  log(`${ok ? '✔' : '✖'} ${name} — ${ms} ms${ok ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 700)}`);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  return result;
}
const CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const soulDir = (n) => { const d = resolve(out, n.toLowerCase()); mkdirSync(d, { recursive: true }); return d; };
const cliEnv = { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' };
const soul = (n, ...a) => new Promise((ok) => execFile(process.execPath, [CLI, ...a], { cwd: soulDir(n), timeout: 180_000, env: cliEnv }, (e, so, se) => { const s = String(so); let d = null; try { d = JSON.parse(s.slice(s.indexOf('{'))); } catch { } ok({ code: e?.code ?? 0, data: d, out: s.slice(0, 600), err: String(se).slice(0, 600) }); }));
const listenFollow = (n) => { const c = spawn(process.execPath, [CLI, 'listen', '--follow'], { cwd: soulDir(n), env: cliEnv, stdio: 'ignore' }); children.push(c); return c; };
const bodies = async () => { const r = await fetch(`${base}/v1/world/souls`); const j = await r.json(); return Object.fromEntries(j.souls.map((s) => [s.name, s])); };
async function waitFor(fn, ms = 60000, every = 1000) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await sleep(every); } return last; }

server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
await step('world boots (hello-hamlet, body clocks shortened)', async () => { for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return true; } catch { } await sleep(100); } return false; }, (r) => r);

const names = ['Ana', 'Ben', 'Cy', 'Di'];
const join = (n) => step(`${n} joins through the Soul CLI`, async () => { await soul(n, 'register', base); const c = await soul(n, 'create-soul', n, `${n}, a body test`); return { id: c.data?.soul?.id ?? c.data?.soulId ?? null, out: c.out.slice(0, 200) }; }, (r) => r.id);
for (const n of ['Ana', 'Cy', 'Di']) await join(n);
listenFollow('Ana');
await step('Di swims into the pond (listening while it acts)', async () => { const l = listenFollow('Di'); const r = await soul('Di', 'act', 'swim in the pond'); await sleep(25000); const h = await soul('Di', 'here'); l.kill(); return { act: r.data?.receipt?.phase ?? r.out.slice(0, 300), pos: h.data?.me?.pos, state: h.data?.me?.state }; }, (r) => r.act);
await join('Ben');
await step('Ben turns zombie (no listen for SLEEP_GRACE); Ana stays awake', async () => waitFor(async () => { const b = await bodies(); return { ok: b.Ben?.body?.state === 'zombie' && b.Ana?.body?.state === 'awake', b: Object.fromEntries(names.map((n) => [n, b[n]?.body])) }; }, 60000), (r) => r?.ok);

let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('(no @playwright/test)'); }
async function frame(page, name) {
  await page.evaluate((nm) => { const el = [...document.querySelectorAll('.world-name-tag')].find((e) => e.querySelector('b')?.textContent === nm); el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }, name);
  await sleep(2500);
}
async function snap(page, name) { const f = resolve(out, `${name}.png`); await page.screenshot({ path: f }); report.shots.push(f); log(`  shot ${name}.png`); }
const tags = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.world-name-tag')].map((e) => [e.querySelector('b')?.textContent, [...e.children].slice(1, 2).map((c) => c.style.display === 'none' ? '' : c.textContent)[0]])));
if (chromium && !args['no-viewer']) {
  const release = await chromeLease('link-body-shots').catch(() => null);
  if (!release) log('(Chrome lease busy: viewer steps skipped)');
  else {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); localStorage.setItem('skipgc', 't'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
      await step('viewer draws the four Souls', async () => waitFor(async () => { const t = await tags(page); return { ok: names.every((n) => n in t), t }; }, 90000), (r) => r?.ok);
      await sleep(2000);
      const dump = () => page.evaluate(() => { const out = []; const s = window.__soulsEntity?.scene, cam = window.__soulsEntity?.camera; s?.traverse((o) => { if (o.isSkinnedMesh && o.name === 'head') { let chain = true, a = o; while (a) { if (!a.visible) chain = false; a = a.parent; } const p = new o.position.constructor(); const hb = o.skeleton?.bones.find((b) => b.name === 'Head'); hb?.getWorldPosition(p); out.push({ chain, head: [p.x, p.y, p.z].map((v) => Math.round(v * 10) / 10), nanBones: o.skeleton?.bones.filter((b) => !Number.isFinite(b.matrixWorld.elements[12])).length }); } }); return { cam: cam ? [cam.position.x, cam.position.y, cam.position.z].map((v) => Math.round(v * 10) / 10) : null, out, residents: window.__soulsEntity?.residents?.().map((r) => ({ id: r.id, p: r.p.map((v) => Math.round(v * 10) / 10) })) }; });
      if (args.debug) report.debug = await page.evaluate(() => { const out = []; const s = window.__soulsEntity?.scene; s?.traverse((o) => { if (o.isSkinnedMesh) { const e = o.matrixWorld.elements; let root = o; while (root.parent && root.parent !== s) root = root.parent; out.push({ name: o.name, vis: o.visible, nan: e.some((v) => !Number.isFinite(v)), pos: [e[12], e[13], e[14]].map((v) => Math.round(v * 10) / 10), root: root.name, bones: o.skeleton?.bones.filter((b) => !Number.isFinite(b.quaternion.x)).length }); } }); return out.slice(0, 40); });
      await step('zombie: Ben shuffles, arms forward, tag "Zombie"', async () => { await frame(page, 'Ben'); await snap(page, 'zombie-ben'); if (args.debug) { report.debugZombie = await dump(); for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400); await sleep(1500); await snap(page, 'zombie-ben-wide'); } await sleep(3000); await snap(page, 'zombie-ben-2'); return { tags: await tags(page), body: (await bodies()).Ben?.body }; }, (r) => r.tags.Ben === 'Zombie');
      await step('asleep: Cy lies down where it stands, tag "Asleep"', async () => { const r = await waitFor(async () => { const b = await bodies(); return { ok: b.Cy?.body?.state === 'asleep', body: b.Cy?.body }; }, 200000); await sleep(9000); await frame(page, 'Cy'); await snap(page, 'asleep-cy'); return { ...r, tags: await tags(page) }; }, (r) => r?.ok && r.tags.Cy === 'Asleep');
      await step('floating: Di asleep in the pond, laid back at the surface', async () => { const r = await waitFor(async () => { const b = await bodies(); return { ok: b.Di?.body?.state === 'asleep', body: b.Di?.body, p: b.Di?.p }; }, 90000); await frame(page, 'Di'); await snap(page, 'floating-di'); return r; }, (r) => r?.ok);
      await step('awake: Ana (listening) stands as usual, plain name tag', async () => { await frame(page, 'Ana'); await snap(page, 'awake-ana'); return { tags: await tags(page), body: (await bodies()).Ana?.body }; }, (r) => r.body?.state === 'awake' && !['Zombie', 'Asleep'].includes(r.tags.Ana));
      await step('wake: a listen stands Cy up in place', async () => { listenFollow('Cy'); const r = await waitFor(async () => { const b = await bodies(); return { ok: b.Cy?.body?.state === 'awake', body: b.Cy?.body }; }, 30000, 500); await sleep(3500); await frame(page, 'Cy'); await snap(page, 'woken-cy'); if (args.debug) report.debugWoken = await dump(); return { ...r, tags: await tags(page) }; }, (r) => r?.ok && !['Zombie', 'Asleep'].includes(r.tags.Cy));
      report.pageErrors = errors;
    } finally { await browser.close(); release(); }
  }
}
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
log(`${report.failures.length ? '✖' : '✔'} ${report.steps.length - report.failures.length}/${report.steps.length} steps; report ${resolve(out, 'report.json')}`);
process.exit(report.failures.length ? 1 : 0);
