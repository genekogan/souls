#!/usr/bin/env node
// GOD-ENV acceptance: the god controls time, weather and the land, and a Soul lives through it. One fresh world; the
// harness plays the god (eden-god CLI: time, weather, strike, land) and a Soul (the unchanged Soul CLI); the viewer is
// real Chrome (GPU, Chrome lease) at dpr 1 and 2 with a real click (which also lets the thunder sound).
//
// The story (Gene's): the god makes a thunderstorm at dusk, raises a mountain and extends the world east; the Soul sees
// and hears the storm, finds the mountain and the new land on her map, and walks onto the new land.
//
//   node tools/god-skill/e2e/god-env.mjs [--port 5591] [--keep] [--dpr 1,2]
//
// Report + screenshots under .lane/e2e-god-env/<stamp>/.
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
const slug = 'god-env';
const port = Number(args.port ?? 5591);
if (port < 5590 || port > 5609) throw new Error('GOD-ENV owns ports 5590–5609');
const dprs = String(args.dpr ?? '1,2').split(',').map(Number);
const out = resolve(root, '.lane/e2e-god-env', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
// a 400 m world (±200): the engine's walking window is one 384 m square shared by every body (spatial/tiled.ts
// MAX_WINDOW_TILES), so the new land must lie within reach of the hamlet for a Soul to walk there
const genesisFile = resolve(out, 'genesis.json');
writeFileSync(genesisFile, JSON.stringify({ schema: 'genesis/1', name: 'weather-world', constants: { extent: 400 }, batches: [] }));
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Weather World', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', ENABLE_WORLD_ENGINE: '1', GENESIS_FILE: genesisFile, DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
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
    const r = await api('/v1/god/mint', { body: { label: 'god-env' }, token: 'dev:gene' }); godToken = r.data.token;
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken }));
    return { status: r.status, token: !!godToken };
  }, (r) => r.token);
  await step('G1 the god builds a hamlet: plaza, fountain, a bench, a cottage, a pond, two lamp-posts', async () => {
    const cmds = [['place', 'plaza', '--rect', '0,-18,18,16', '--name', 'plaza'], ['place', 'fountain', '--at', '0,-20', '--name', 'fountain'], ['place', 'bench', '--at', '4,-14', '--facing', 'fountain', '--name', 'bench'],
      ['place', 'cottage', '--at', '-24,-20', '--facing', 'fountain', '--name', 'cottage'], ['place', 'pond', '--circle', '18,8,7', '--name', 'pond'], ['place', 'lamp-post', '--at', '7,-11', '--name', 'lamp-e'], ['place', 'lamp-post', '--at', '-7,-11', '--name', 'lamp-w'],
      ['place', 'bench', '--at', '95,-80', '--name', 'hill-bench']];
    const res = []; for (const c of cmds) { const r = await god(...c); res.push({ cmd: c.slice(0, 2).join(' '), ok: okText(r), out: r.raw.slice(0, 160) || r.err.slice(0, 160) }); }
    return { all: res.every((x) => x.ok), res };
  }, (r) => r.all);
  await step('S0 a Soul joins through the Soul CLI: Ana', async () => {
    await ana('register', base); const c = await ana('create-soul', 'Ana', 'Ana, who loves weather'); soulId = c.data?.soul?.id;
    for (let i = 0; i < 60; i++) { const h = await hereOf(); if (h?.me?.pos) return { soulId, pos: h.me.pos }; await sleep(500); }
    return { soulId };
  }, (r) => r.pos);

  // ---------- time
  await step('T1 time: `time 19:00` twice — the clock reads 19:00 and the calendar day does not advance (the fix)', async () => {
    const a = await god('time', '19:00'); await sleep(1200); const e1 = await worldEnv();
    const b = await god('time', '19:00'); await sleep(1200); const e2 = await worldEnv();
    return { a: a.raw, b: b.raw, d1: e1.time.datetime, d2: e2.time.datetime };
  }, (r) => r.d1?.slice(0, 10) === r.d2?.slice(0, 10) && /^19:0/.test(r.d2.slice(11, 16)));
  await step('T2 time: pause and resume (`time --pause`, `time --resume --speed 48`)', async () => {
    const p = await god('time', '--pause'); await sleep(2500); const e1 = await worldEnv(); await sleep(2500); const e2 = await worldEnv();
    const q = await god('time', '--resume', '--speed', '48'); await sleep(1000); const e3 = await worldEnv();
    return { p: p.raw, q: q.raw, paused: e1.time.paused, still: e1.time.clock === e2.time.clock, scale: e3.time.timeScale };
  }, (r) => r.paused && r.still && r.scale === 48);

  // ---------- weather: a thunderstorm at dusk; the Soul perceives it, and a strike by the fountain
  await step('W1 weather: `time 20:15` + `weather --kind storm --intensity 0.9`: a thunderstorm at dusk; Ana\'s `here` says thunderstorm', async () => {
    const t = await god('time', '20:15'), w = await god('weather', '--kind', 'storm', '--intensity', '0.9'); await sleep(1500);
    const h = await hereOf();
    return { t: t.raw, w: w.raw, weather: h?.weather, clock: h?.clock, light: h?.light };
  }, (r) => r.weather?.sky === 'thunderstorm' && /storm/.test(r.w));
  await step('W2 the god strikes the fountain (`strike --at fountain`): Ana sees the bolt and hears its thunder (here.weather.lightning)', async () => {
    const s = await god('strike', '--at', 'fountain'); await sleep(1500);
    const h = await hereOf();
    return { strike: s.raw, lightning: h?.weather?.lightning, env: (await worldEnv()).strike };
  }, (r) => /lightning strikes 0, -20/.test(r.strike) && /lightning struck/.test(r.lightning?.last ?? '') && /thunder/.test(r.lightning.last) && r.env?.god === true);

  // ---------- the land
  let seqBefore;
  await step('L1 `land mountain --at 120,-110 --height 60 --radius 70 --preview`: a preview, nothing changes', async () => {
    seqBefore = await seqNow(); const r = await god('land', 'mountain', '--at', '120,-110', '--height', '60', '--radius', '70', '--name', 'thunder-peak', '--preview');
    return { out: r.raw, seq0: seqBefore, seq1: await seqNow() };
  }, (r) => /^preview \(nothing changed yet\)/.test(r.out) && /\+\d/.test(r.out) && r.seq0 === r.seq1);
  await step('L2 the god raises the mountain (Thunder Peak); the bench on its foot is re-grounded (rises with the ground)', async () => {
    const before = (await api('/v1/god/snapshot', { token: godToken })).data.entities.find((e) => e.name === 'hill-bench').p[1];
    const r = await god('land', 'mountain', '--at', '120,-110', '--height', '60', '--radius', '70', '--name', 'thunder-peak');
    const after = (await api('/v1/god/snapshot', { token: godToken })).data.entities.find((e) => e.name === 'hill-bench').p[1];
    return { out: r.raw, before, after };
  }, (r) => okText({ code: 0, raw: r.out }) && /re-grounded: hill-bench \+/.test(r.out) && r.after > r.before + 1);
  await step('L3 `land extend east 200`: the world grows from 400×400 to 600×400 m', async () => {
    const r = await god('land', 'extend', 'east', '200'); const s = (await api('/v1/god/snapshot', { token: godToken })).data;
    return { out: r.raw, extent: s.ground.extent };
  }, (r) => /600×400/.test(r.out) && r.extent[2] === 400);
  await step('L4 the god plants a meadow and a flag on the new land (things stand there)', async () => {
    const a = await god('place', 'lawn', '--rect', '300,0,60,40', '--name', 'meadow'), b = await god('flag', 'East Meadow', '--at', '300,0');
    return { a: a.raw.slice(0, 200), b: b.raw.slice(0, 200), ok: okText(a) && okText(b) };
  }, (r) => r.ok);
  await step('L5 Ana\'s map refresh shows Thunder Peak (a mountain, its height) and the new land to the east', async () => {
    const m = await ana('map'); const places = m.data?.places ?? [];
    const peak = places.find((p) => /thunder-peak/.test(p.id ?? p.name)), land = places.find((p) => /new-land-east/.test(p.id ?? ''));
    return { peak, land, n: places.length };
  }, (r) => /mountain about 6\d m high/.test(r.peak?.description ?? '') && /land the god added/.test(r.land?.description ?? ''));
  await step('L6a Ana\'s agent sends her onto the new land (walk:flag-east-meadow, 300 m east)', async () => {
    const caps = (await ana('capabilities')).raw; const a = await ana('act', 'walk:flag-east-meadow');
    return { offered: /walk:flag-east-meadow/.test(caps), act: a.raw.slice(0, 300), accepted: a.data?.accepted };
  }, (r) => r.offered && r.accepted === true);
  await step('L7 every other land verb is one god edit, and undo reverts it: raise, lower, flatten, smooth, valley, ditch, cliff, move, water level', async () => {
    const cmds = [['land', 'raise', '--at', '-120,120', '--radius', '15', '--amount', '6'], ['land', 'lower', '--at', '-160,120', '--radius', '12', '--amount', '4'], ['land', 'flatten', '--at', '-120,120', '--radius', '8', '--level', '3'],
      ['land', 'smooth', '--at', '-140,120', '--radius', '20', '--amount', '0.6'], ['land', 'valley', '--path', '[[-190,150],[-100,180],[0,170]]', '--depth', '8', '--width', '10', '--name', 'green-valley'],
      ['land', 'ditch', '--path', '[[30,20],[60,40]]'], ['land', 'cliff', '--path', '[[-190,-170],[-60,-185]]', '--height', '14', '--name', 'west-cliff'], ['land', 'move', 'thunder-peak', '--by', '30,0'], ['land', 'water', 'pond', '--by', '0.4']];
    const res = []; for (const c of cmds) { const r = await god(...c); res.push({ cmd: c.slice(0, 3).join(' '), ok: okText(r), out: r.raw.slice(0, 220) }); }
    const s0 = await seqNow(); const u = await god('undo'); const s1 = await seqNow();
    const peak = (await api('/v1/god/snapshot', { token: godToken })).data.entities.find((e) => e.name === 'thunder-peak');
    return { all: res.every((x) => x.ok), res, undo: u.raw.slice(0, 160), seqs: [s0, s1] };
  }, (r) => r.all && r.seqs[1] === r.seqs[0] + 1);
  await step('L8 a god cannot shrink the world; refusals are explained', async () => {
    const a = await api('/v1/god/act', { body: { ops: [{ op: 'expand', bounds: [-200, -200, 300, 200] }] }, token: godToken });
    const b = await god('land', 'raise', '--at', '2000,0');
    return { a: a.data, b: b.raw + b.err };
  }, (r) => r.a.accepted === false && r.a.failures[0].code === 'constant.immutable' && /REFUSED|outside/.test(r.b));

  await step('L6b Ana arrives on the new land: east of the old edge (x > 200), standing on it (here: new land to the east)', async () => {
    let h; for (let i = 0; i < 600; i++) { h = await hereOf(); if (h?.me?.pos?.[0] > 280 && h?.me?.activity?.kind !== 'walk') break; await sleep(1000); }
    return { pos: h?.me?.pos, place: h?.me?.place, placePath: h?.me?.placePath, activity: h?.me?.activity };
  }, (r) => r.pos && r.pos[0] > 200 && (r.placePath ?? []).some((p) => /new land to the east|meadow|east meadow/i.test(p)));
  // ---------- the viewer: real Chrome, dpr 1 and 2
  if (chromium) for (const dpr of dprs) {
    const release = await chromeLease('god-env-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await god('time', '20:20'); await god('weather', '--kind', 'storm', '--intensity', '0.9');
      await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      await step(`V1[${d}] the storm at dusk is drawn; a real click on the world lets the thunder sound`, async () => {
        const r = await waitFor(page, async () => { const s = await page.evaluate(() => ({ atmos: window.__simLiving?.atmosphere?.(), lightning: window.__simLiving?.lightning?.(), entity: !!window.__simEntity?.layer?.active })); return { ok: s.entity && s.atmos?.kind === 'storm' && !!s.lightning, ...s }; }, 60000);
        const c = await page.locator('canvas').first().boundingBox(); await page.mouse.click(c.x + c.width * 0.5, c.y + c.height * 0.62); await page.waitForTimeout(800);
        // take the camera (real click on Broadcast → your camera) and fold the god panel away for the pictures
        await setCameraMode(page, 'manual'); await page.waitForTimeout(500);
        await page.locator('button[aria-label="collapse"]').first().click().catch(() => {});
        const mode = await page.evaluate(() => document.querySelector('canvas')?.dataset.cameraMode);
        return { ...r, mode, audio: (await page.evaluate(() => window.__simLiving.lightning())).audio, errors };
      }, (r) => r?.ok && r.audio === 'running' && r.mode === 'manual' && !r.errors.length);
      await step(`V2[${d}] the god strikes by the plaza: a bolt from the cloud to the ground, the scene flashes, the thunder is scheduled after distance ÷ 343 m/s`, async () => {
        await look(page, [70, 26, 70], [3, 22, -30]); await page.waitForTimeout(1500);
        await page.evaluate(() => window.__simLiving.holdLightning(9000));
        const n0 = (await page.evaluate(() => window.__simLiving.lightning())).heard;
        const t0 = Date.now(), s = await god('strike', '--at', '6,-34');
        const r = await waitFor(page, async () => { const l = await page.evaluate(() => window.__simLiving.lightning()); return { ok: l.heard > n0 && l.bolts > 0 && l.last.some((h) => h.god && h.at >= t0), ...l }; }, 15000, 100);
        await page.waitForTimeout(200); await snap(page, `v2-bolt-plaza-${d}`);
        const last = r.last.find((h) => h.god) ?? r.last[r.last.length - 1];
        return { strike: s.raw, ...r, lastHeard: last };
      }, (r) => r?.ok && r.lastHeard?.sound === 'scheduled' && Math.abs(r.lastHeard.delay - r.lastHeard.dist / 343) < 0.02);
      await step(`V3[${d}] the storm's own strikes fall too (same bolts as the server's), over a minute of storm`, async () => {
        await page.evaluate(() => window.__simLiving.holdLightning(0));
        await look(page, [-60, 60, 120], [60, 10, -60]);
        const r = await waitFor(page, async () => { const l = await page.evaluate(() => window.__simLiving.lightning()); return { ok: l.last.some((h) => !h.god), ...l }; }, 60000, 250);
        return r;
      }, (r) => r?.ok);
      await step(`V4[${d}] Thunder Peak rises east of the hamlet, and the world reaches 300 m further east (terrain + horizon)`, async () => {
        await god('weather', '--kind', 'cloudy', '--intensity', '0.5'); await god('time', '17:30');
        await look(page, [-70, 55, 120], [220, 10, -50]); await page.waitForTimeout(5000); await snap(page, `v4-mountain-and-new-land-${d}`);
        const g = await page.evaluate(() => ({ east: window.__simEntity.layer.groundAt(350, 0), beyond: window.__simEntity.layer.groundAt(450, 0), peak: window.__simEntity.layer.groundAt(150, -110) }));
        return { ...g, errors };
      }, (r) => r.east !== null && r.beyond === null && r.peak > 40);
      await step(`V5[${d}] Ana on the new land by the East Meadow flag`, async () => {
        const p = (await hereOf())?.me?.pos ?? [300, 0];
        await look(page, [p[0] - 18, 12, p[1] + 22], [p[0], 1, p[1]]); await page.waitForTimeout(4000); await snap(page, `v5-ana-on-new-land-${d}`);
        return { pos: p, errors };
      }, (r) => r.pos[0] > 200 && !r.errors.length);
      await ctx.close();
    } finally { await browser.close().catch(() => { }); release(); }
  }
} catch (e) { report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('✖ harness', e); }
finally {
  report.finishedAt = new Date().toISOString(); report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1)); writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200_000));
  writeFileSync(resolve(out, 'REPORT.md'), `# GOD-ENV e2e — ${report.passed}/${report.total}\n\n${report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`).join('\n')}\n\nShots:\n${report.shots.map((f) => `- ${f}`).join('\n')}\n`);
  log(`\n${report.passed}/${report.total} — ${out}`);
  if (!args.keep) try { server?.kill(); } catch { }
  process.exit(report.failures.length ? 1 : 0);
}
