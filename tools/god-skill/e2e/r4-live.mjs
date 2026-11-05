#!/usr/bin/env node
// R4-LIVE acceptance ("ONE-WORLD"): a god builds a new world, two Souls live in it, and everything of /w/eden's living
// world works there — the broadcast camera (arrival, landmarks, the conversation two-shot), follow while the god builds,
// Souls steered by their agents, weather and time (the god's env setter: a storm at dusk, pause, night with lit lamps),
// Souls conversing, and a Soul lifted up when idle. One fresh world, the harness plays the god (eden-god CLI + HTTP) and
// the Souls (the unchanged Soul CLI); the viewer is real Chrome (GPU, Chrome lease) at dpr 1 and 2 with real clicks.
//
//   node tools/god-skill/e2e/r4-live.mjs [--port 5494] [--keep] [--dpr 1,2]
//
// Report + screenshots under .lane/e2e-r4-live/<stamp>/.
import { setCameraMode } from '../../browser/world-controls.mjs';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'one-world';
const port = Number(args.port ?? 5494);
if (port >= 4930 && port <= 4987) throw new Error('never bind the production ports');
const dprs = String(args.dpr ?? '1,2').split(',').map(Number);
const out = resolve(root, '.lane/e2e-r4-live', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world (launcher env: edge minds, Soul lifecycle, fading; fake minds, dev auth)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'One World', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', ENABLE_WORLD_ENGINE: '1', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
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
const brief = (r) => { try { const s = JSON.stringify(r); return s && s.length > 1600 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 10 ? `[${v.length} items]` : typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v))) : r; } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 1200); }
  const ok = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ok, ms, result: brief(result), error });
  if (!ok) report.failures.push({ name, result: brief(result), error });
  log(`${ok ? '✔' : '✖'} ${name} — ${ms} ms${ok ? '' : ' — ' + (error ?? JSON.stringify(brief(result))).slice(0, 600)}`);
  return result;
}

// ---------- the god CLI and the Souls' CLI (unchanged), each in its own folder
const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const run = (bin, dir, ...argv) => new Promise((ok) => execFile(process.execPath, [bin, ...argv], { cwd: dir, timeout: 180_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1', EDEN_GOD_NO_LEASE: '1' } }, (e, so, se) => { const s = String(so); let d = null; try { d = JSON.parse(s.slice(s.indexOf('{'))); } catch { } ok({ code: e?.code ?? 0, data: d, raw: d ? undefined : s.slice(0, 600), err: String(se).slice(0, 300) }); }));
const godDir = resolve(out, 'god'); mkdirSync(godDir, { recursive: true });
const soulDir = (n) => { const d = resolve(out, n.toLowerCase()); mkdirSync(d, { recursive: true }); return d; };
const souls = {};
const soul = (n, ...argv) => run(CLI, soulDir(n), ...argv);
const hereOf = async (n) => (await soul(n, 'here')).data;
const godEnv = (body) => api('/v1/god/env', { body, token: godToken });
const worldEnv = async () => (await api('/v1/world/env')).data;
const mins = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const near = (a, b, m) => Math.abs(((mins(a) - mins(b)) % 1440 + 1440 + 720) % 1440 - 720) <= m;

// ---------- the viewer: real Chrome (one lease for the whole visit), real input
let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test: viewer steps skipped)'); }
async function snap(page, name) { const file = resolve(out, `${name}.png`); await page.screenshot({ path: file }); report.shots.push(file); log(`  📷 ${name}.png`); }
const canvasState = (page) => page.evaluate(() => { const c = document.querySelector('canvas'); const l = window.__simLiving; return { mode: c?.dataset.cameraMode, shot: c?.dataset.cameraShot, buffer: c ? [c.width, c.height] : null, css: c ? [c.clientWidth, c.clientHeight] : null, lights: l?.lights ?? null, views: l?.broadcastViews?.() ?? null, atmos: (() => { const a = l?.atmosphere?.(); return a ? { profile: a.profile, set: a.set, active: a.active, kind: a.kind, rain: +a.state.rain.toFixed(2), cloud: +a.state.cloud.toFixed(2) } : null; })() }; });
async function waitFor(page, fn, ms = 30000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await page.waitForTimeout(every); } return last; }

// ================================================================ the scenario
try {
  await boot(); log(`▶ world "${slug}" on :${port}`);
  await step('G0 the owner mints a god token (the god CLI folder is set up)', async () => {
    const r = await api('/v1/god/mint', { body: { label: 'r4-live' }, token: 'dev:gene' }); godToken = r.data.token;
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken }));
    return { status: r.status, token: !!godToken };
  }, (r) => r.token);
  await step('G1 the god builds a village: plaza, fountain, benches, four lamp-posts, a sign, a furnished roundhouse, a pond', async () => {
    const cmds = [['place', 'plaza', '--rect', '0,-18,18,16', '--name', 'plaza'], ['place', 'fountain', '--at', '0,-20', '--name', 'fountain'], ['place', 'bench', '--near', 'fountain', '--count', '3', '--facing', 'fountain', '--dist', '3', '--name', 'plaza-bench'],
      ['place', 'lamp-post', '--at', '6,-13', '--name', 'lamp-ne'], ['place', 'lamp-post', '--at', '-6,-13', '--name', 'lamp-nw'], ['place', 'lamp-post', '--at', '6,-26', '--name', 'lamp-se'], ['place', 'lamp-post', '--at', '-6,-26', '--name', 'lamp-sw'],
      ['place', 'sign', '--at', '5,-9', '--facing', 's', '--state', '{"text":"Welcome to One World"}', '--name', 'welcome-sign'], ['place', 'roundhouse', '--at', '-20,-20', '--facing', 'fountain', '--name', 'moss-cottage'], ['furnish', 'moss-cottage'], ['place', 'pond', '--circle', '16,8,7', '--name', 'pond']];
    const res = []; for (const c of cmds) { const r = await run(GOD, godDir, ...c); res.push({ cmd: c.slice(0, 2).join(' '), ok: r.code === 0 && !/REFUSED/.test(r.raw ?? '') }); }
    return { all: res.every((x) => x.ok), res };
  }, (r) => r.all);
  await step('S0 two Souls join through the Soul CLI (register + create-soul): Ana and Ben', async () => {
    for (const n of ['Ana', 'Ben']) { await soul(n, 'register', base); const c = await soul(n, 'create-soul', n, `${n}, who lives in One World`); souls[n] = c.data?.soul?.id; }
    for (let i = 0; i < 60; i++) { const a = await hereOf('Ana'), b = await hereOf('Ben'); if (a?.me?.pos && b?.me?.pos) return { souls, ana: a.me.pos, ben: b.me.pos }; await sleep(500); }
    return { souls };
  }, (r) => r.ana && r.ben);

  await step('E1 env: the world follows the scheduled weather by default (GET /v1/world/env)', worldEnv, (e) => e?.contract === 'world-env/1' && e.weather.scheduled === true && e.time.timeScale === 24);
  await step('E2 the god sets a storm at dusk in one call (POST /v1/god/env): the clock jumps forward to 20:30, kind storm', async () => {
    const r = await godEnv({ timeOfDay: '20:30', weather: { kind: 'storm', intensity: 0.9 } }); await sleep(1500);
    return { accepted: r.data.accepted, env: await worldEnv() };
  }, (r) => r.accepted && near(r.env.time.clock, '20:30', 3) && r.env.weather.kind === 'storm' && r.env.weather.lightning > 0.8);
  await step('E3 Ana perceives it: `here` says thunderstorm, windy, dusk', async () => (await hereOf('Ana')), (h) => h?.weather?.sky === 'thunderstorm' && /dusk|night|evening/.test(h.light));
  await step('E4 the god pauses time (timeScale 0): the clock stands still; then real time (1); then the default (24)', async () => {
    await godEnv({ timeScale: 0 }); await sleep(1200); const a = (await worldEnv()).time.clock; await sleep(4000); const b = (await worldEnv()).time.clock;
    await godEnv({ timeScale: 24 }); await sleep(4000); const c = (await worldEnv()).time;
    return { a, b, resumed: c.clock, paused: c.paused };
  }, (r) => r.a === r.b && r.paused === false && r.resumed !== r.b);
  await step('E5 undo (the env is a god op in the ledger): the pause is undone, the storm stays', async () => { const u = await api('/v1/god/undo', { method: 'POST', token: godToken }); const e = await worldEnv(); return { accepted: u.data.accepted !== false, paused: e.time.paused, kind: e.weather.kind }; }, (r) => r.paused === true && r.kind === 'storm');
  await godEnv({ timeScale: 24 });

  if (chromium) for (const dpr of dprs) {
    const release = await chromeLease('r4-live-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      // every visit starts from the same world: a storm at dusk, Ben present
      await godEnv({ timeOfDay: '20:30', weather: { kind: 'storm', intensity: 0.9 } }); await soul('Ben', 'act', 'wave:here'); await sleep(1500);
      await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      await step(`V1[${d}] arrival: Souls live here, so the view opens in broadcast (as /w/eden); Retina canvas; storm drawn (profile world)`, async () => {
        const r = await waitFor(page, async () => { const s = await canvasState(page); return { ok: s.mode === 'broadcast' && !!s.shot && s.atmos?.active && s.atmos.kind === 'storm' && s.atmos.rain > 0.5, ...s }; }, 45000);
        await snap(page, `v1-arrival-storm-dusk-${d}`); return { ...r, errors };
      }, (r) => r?.ok && r.buffer[0] === r.css[0] * dpr && r.atmos.profile === 'world');
      await step(`V2[${d}] the god's lamps are lit at dusk (night light map + glow)`, async () => canvasState(page), (s) => s.lights >= 4);
      await step(`V3[${d}] broadcast has the god world's own establishing views (landmarks + tour)`, async () => canvasState(page), (s) => s.views >= 3);
      // follow Ana by real clicks while the god builds and her agent steers her
      await step(`V4[${d}] select Ana by her name tag, Follow (real clicks): the follow camera holds her`, async () => {
        await godEnv({ timeOfDay: '11:00', weather: { kind: 'clear' } });
        const tag = page.locator(`[data-soul-id="${souls.Ana}"]`).first();
        await waitFor(page, async () => ({ ok: !!(await tag.boundingBox().catch(() => null)) }), 30000);
        const f = page.getByRole('button', { name: /^follow$/i }).first();
        for (let i = 0; i < 6 && !(await f.isVisible().catch(() => false)); i++) { const b = await tag.boundingBox().catch(() => null); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(1200); }
        await f.click({ timeout: 10000 }); await page.waitForTimeout(2500);
        return canvasState(page);
      }, (s) => s.mode === 'follow' && /^follow:h_/.test(s.shot));
      await step(`V5[${d}] Ana's agent steers her (CLI act "walk to the fountain") while the god builds a bench and a lamp beside the path; the camera follows her through the edits`, async () => {
        const acted = await soul('Ana', 'act', 'walk to the fountain');
        const g1 = await run(GOD, godDir, 'place', 'bench', '--at', `${-3 + dpr},-6`, '--facing', 'n', '--name', `path-bench-${dpr}`);
        const g2 = await run(GOD, godDir, 'place', 'lamp-post', '--at', `${3 + dpr},-6`, '--name', `path-lamp-${dpr}`);
        let samples = [];
        for (let i = 0; i < 24; i++) {
          await page.waitForTimeout(700);
          const s = await page.evaluate(() => { const e = window.__simEntity; const t = e?.controls?.target; return { mode: document.querySelector('canvas')?.dataset.cameraMode, target: t ? [t.x, t.z] : null }; });
          const me = (await hereOf('Ana'))?.me?.pos; samples.push({ ...s, ana: me, gap: s.target && me ? +Math.hypot(s.target[0] - me[0], s.target[1] - me[1]).toFixed(2) : null });
          if (i === 8) await snap(page, `v5-following-ana-while-building-${d}`);
        }
        const h = await hereOf('Ana');
        return { accepted: acted.data?.accepted, godOk: g1.code === 0 && g2.code === 0, stillFollowing: samples.every((x) => x.mode === 'follow'), maxGap: Math.max(...samples.map((x) => x.gap ?? 99)), end: h?.me?.pos, samples: samples.slice(-3) };
      }, (r) => r.accepted && r.godOk && r.stillFollowing && r.maxGap < 3);
      await step(`V6[${d}] back to broadcast; Ana and Ben converse (Soul CLI converse): the director cuts to the conversation, bubbles carry their words`, async () => {
        // Real input: return directly from Following to Broadcast.
        await setCameraMode(page, 'broadcast'); await page.waitForTimeout(800);
        // Ben's agent walks him over to Ana (go-near:<Soul>): conversations are within earshot, as on /w/eden
        const went = await soul('Ben', 'act', `go-near:${souls.Ana}`);
        for (let i = 0; i < 40; i++) { const a = (await hereOf('Ana'))?.me?.pos, b = (await hereOf('Ben'))?.me?.pos; if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 3.5) break; await sleep(800); }
        const st = await soul('Ana', 'converse', 'start', souls.Ben, `Hello Ben (${d}), the storm has passed.`); const conv = st.data?.conversation?.id;
        await sleep(1500); await soul('Ben', 'converse', 'accept', conv);
        await soul('Ben', 'converse', 'say', conv, 'It lit up the whole plaza.'); await sleep(1500);
        await soul('Ana', 'converse', 'say', conv, 'Let us sit by the fountain.');
        const r = await waitFor(page, async () => { const s = await canvasState(page); const text = await page.evaluate(() => document.body.innerText); return { ok: /conversation/.test(s.shot ?? '') && /whole plaza|by the fountain/.test(text), shot: s.shot, mode: s.mode }; }, 30000);
        await snap(page, `v6-conversation-${d}`);
        await soul('Ana', 'converse', 'leave', conv);
        return { went: went.data?.accepted, start: st.data?.accepted ?? st.data?.code, conv, ...r };
      }, (r) => r?.ok);
      await step(`V7[${d}] Ben is left idle an hour (his activity clock moved back 61 min): he fades — the beam lifts him up`, async () => {
        const back = Date.now() - 61 * 60_000;
        execFileSync('sqlite3', [resolve(dataDir, 'sim.db'), `update edge_comms_activity set last_at=${back},contact_at=${back} where soul_id='${souls.Ben}'`]);
        let h; for (let i = 0; i < 20; i++) { await sleep(1000); h = await hereOf('Ben'); if (h?.me?.fade === 'gone') break; }
        await page.waitForTimeout(9000); await snap(page, `v7-ben-lifted-up-${d}`);
        const back2 = await soul('Ben', 'act', 'stand:here'); await sleep(1500); const after = await hereOf('Ben');
        return { faded: h?.me?.fade, posture: h?.me?.posture, reclaimedBy: back2.data?.receipt?.capability, after: after?.me?.fade };
      }, (r) => r.faded === 'gone' && r.after === 'green');
      await step(`V8[${d}] night falls (env 22:30, clear): lamps glow over the plaza`, async () => {
        await godEnv({ timeOfDay: '22:30', weather: { kind: 'clear' } });
        await page.getByRole('button', { name: /see everything|your camera|back to broadcast|broadcast/i }).first().isVisible().catch(() => false);
        await page.evaluate(() => { const e = window.__simEntity; if (e) { e.controls.target.set(0, 1, -18); e.camera.position.set(16, 12, 6); } });
        await page.waitForTimeout(6000); await snap(page, `v8-night-lamps-${d}`);
        return { env: (await worldEnv()).time.clock, ...(await canvasState(page)), errors };
      }, (r) => near(r.env, "22:30", 5) && r.lights >= 5 && !r.errors.length);
      await ctx.close();
    } finally { await browser.close().catch(() => { }); release(); }
  }
} catch (e) { report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('✖ harness', e); }
finally {
  report.finishedAt = new Date().toISOString(); report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1)); writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200_000));
  writeFileSync(resolve(out, 'REPORT.md'), `# R4-LIVE ONE-WORLD e2e — ${report.passed}/${report.total}\n\n${report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`).join('\n')}\n\nShots:\n${report.shots.map((f) => `- ${f}`).join('\n')}\n`);
  log(`\n${report.passed}/${report.total} — ${out}`);
  if (!args.keep) try { server?.kill(); } catch { }
  process.exit(report.failures.length ? 1 : 0);
}
