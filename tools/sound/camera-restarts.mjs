#!/usr/bin/env node
// Lane S3 (2026-10-20, Gene: "moving the camera manually leads to music and sounds restarting constantly"): drives
// 60 s of real manual camera moves (mouse drags, wheel zoom, WASD) in Chrome on a fresh dev world, with sound and music
// on, and counts how often each source (re)starts. A restart = a source id starting again after its first start.
// Also records the wind voices heard and the music playlist's start/stop/advance events when the page has them.
// Fake minds, no paid generation, no production data. Only stops the server it started.
//
//   node tools/sound/camera-restarts.mjs --port 6731 --out <dir> [--web <dist dir>] [--seconds 60] [--phone 1] [--track-s 25]
// --track-s shortens each playlist piece on the page (to watch the playlist advance during the drags).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const port = Number(arg('port', 6731)), out = resolve(arg('out', '/tmp/s3-camera'));
const web = arg('web', ''), seconds = Number(arg('seconds', 60)), phone = arg('phone', '1') === '1', trackS = Number(arg('track-s', 0));
const slug = arg('slug', 'soundcam'), template = arg('template', 'eden-district');
const base = `http://127.0.0.1:${port}/w/${slug}`;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);
const report = { web: web || 'apps/web/dist', seconds, runs: {} };

const genesis = JSON.parse(readFileSync(resolve(root, `worlds/templates/${template}.json`), 'utf8'));
genesis.name = 'Sound camera proof';
genesis.batches.push({ note: 's3 additions: a wood, a windy knoll with flags, a flower bed', ops: [
  { op: 'place', def: 'core/woodland@1', name: 'north-wood', shape: { area: [[-30, 50], [30, 50], [30, 95], [-30, 95]] } },
  { op: 'place', def: 'core/pine@1', name: 'wood-pine-1', p: [-10, 60] }, { op: 'place', def: 'core/tree@1', name: 'wood-oak-1', p: [0, 66] },
  { op: 'place', def: 'core/knoll@1', name: 'windy-knoll', p: [0, -110], params: { height: 15, radius: 34 } },
  { op: 'place', def: 'core/flag@1', name: 'knoll-flag-1', p: [-2, -110] },
  { op: 'place', def: 'core/flower-bed@1', name: 'beds-1', p: [0, 6] },
] });
const genesisFile = resolve(out, 'genesis.json'); writeFileSync(genesisFile, JSON.stringify(genesis, null, 1));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', EDGE_FADING: '1', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: genesisFile, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), ...(web ? { WEB_DIR: resolve(web) } : {}) };
let server = null, serverLog = '';
const stop = () => { try { server?.kill(); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => process.exit(130));

// what the page reports: per-source starts (sound layer log) and the music player's events, when present
const snapshot = (page) => page.evaluate(() => {
  const s = window.__edenSound, m = window.__edenMusic;
  const st = s?.state?.() ?? null;
  return { ctx: st?.ctx ?? 'none', muted: st?.muted, music: st?.music, level: s?.level?.() ?? 0,
    voices: (st?.voices ?? []).map((v) => `${v.kind}/${v.variant} ${v.id}`), starts: s?.log?.() ?? [], events: s?.events?.() ?? null,
    musicState: m?.state?.() ?? null, musicLog: m?.log?.() ?? null };
});
function count(rows) {
  const by = new Map(); for (const r of rows) by.set(r.id, (by.get(r.id) ?? 0) + 1);
  const restarts = [...by.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, starts: n }));
  return { sources: by.size, starts: rows.length, restartsTotal: restarts.reduce((a, r) => a + r.starts - 1, 0), restarted: restarts.sort((a, b) => b.starts - a.starts).slice(0, 15) };
}

async function drive(page, w, h, touch) {
  // 60 s of manual camera: orbit drags, pans, zoom in/out by wheel, walk with WASD; fast and slow moves
  const t0 = Date.now(); let i = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const k = i++ % 6, cx = w / 2, cy = h / 2;
    if (touch) {
      // phone: one-finger drags via CDP touch events
      const cdp = await page.context().newCDPSession(page);
      const pts = []; const dx = (k % 2 ? -1 : 1) * w * 0.35, dy = (k % 3 - 1) * h * 0.12;
      for (let s = 0; s <= 12; s++) pts.push([cx + (dx * s) / 12, cy + (dy * s) / 12]);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); await sleep(30); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
      await sleep(250);
      continue;
    }
    if (k === 0 || k === 3) {   // orbit drag
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let s = 1; s <= 15; s++) { await page.mouse.move(cx + (k ? -1 : 1) * s * 22, cy + s * 4); await sleep(25); }
      await page.mouse.up();
    } else if (k === 1) {        // pan (right drag)
      await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' });
      for (let s = 1; s <= 15; s++) { await page.mouse.move(cx + s * 18, cy - s * 10); await sleep(25); }
      await page.mouse.up({ button: 'right' });
    } else if (k === 2) {        // zoom out, then in
      await page.mouse.move(cx, cy); for (let s = 0; s < 8; s++) { await page.mouse.wheel(0, 240); await sleep(40); }
      await sleep(300); for (let s = 0; s < 8; s++) { await page.mouse.wheel(0, -240); await sleep(40); }
    } else {                     // walk
      const key = k === 4 ? 'w' : 'a'; await page.keyboard.down(key); await sleep(900); await page.keyboard.up(key);
    }
    await sleep(200);
  }
}

try {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ } await sleep(100); }
  log(`server ${(await fetch(`${base}/healthz`)).status}`);
  const chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium;
  const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
  const release = await chromeLease('s3-camera');
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] });
    try {
      const configs = [['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }]];
      if (phone) configs.push(['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]);
      for (const [name, opts] of configs) {
        const page = await (await browser.newContext(opts)).newPage();
        const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
        const t0 = Date.now();
        await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__soulsEntity?.layer?.model && !!window.__edenSound, null, { timeout: 180_000 });
        const ready = Date.now() - t0;
        await sleep(3000);
        // the gesture that unlocks audio (a tap on the world), then music on
        if (name === 'phone') await page.touchscreen.tap(195, 500); else await page.mouse.click(720, 450);
        await sleep(500);
        await page.evaluate((ts) => { window.__edenSound.music(true); if (ts) window.__edenMusic?.trackSeconds(ts); }, trackS);
        await sleep(6000);
        // start low in the wood, among trees, birds and the visitor's own steps (an overhead camera hears little)
        await page.evaluate(() => { const s = window.__soulsEntity, g = s.layer.groundAt?.(0, 70) ?? 0; s.controls.target.set(10, g + 1.4, 75); s.camera.position.set(0, g + 1.7, 70); s.controls.update?.(); });
        await sleep(2000);
        const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
        const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
        const levels = []; const sampler = setInterval(() => { page.evaluate(() => window.__edenMusic?.level?.() ?? 0).then((v) => levels.push(v), () => {}); }, 3000);
        const before = await snapshot(page);
        const n0 = before.starts.length;
        await drive(page, opts.viewport.width, opts.viewport.height, name === 'phone');
        clearInterval(sampler);
        await sleep(1500);
        const after = await snapshot(page);
        // main-thread cost of the playing music: 15 s still with music on, then 15 s with it off
        const idle = async () => { const a = await task(); await sleep(15000); return +((await task() - a) / 15 * 100).toFixed(1); };
        const cpuOn = await idle(); await page.evaluate(() => window.__edenSound.music(false)); await sleep(1000); const cpuOff = await idle();
        await page.evaluate(() => window.__edenSound.music(true)); await cdp.detach();
        const during = after.starts.slice(n0);
        const musicDuring = (after.musicLog ?? []).filter((e) => e.t >= (before.musicLog?.at(-1)?.t ?? 0) && !before.musicLog?.includes(e));
        const windHeard = after.voices.filter((v) => v.startsWith('wind/'));
        const windStarts = during.filter((r) => r.kind === 'wind').length;
        const musicVoiceStarts = during.filter((r) => r.kind === 'music').length;
        const mlog = (after.musicLog ?? []).slice((before.musicLog ?? []).length);
        const playerStarts = mlog.filter((e) => e.ev === 'start').length;
        const advances = mlog.filter((e) => e.ev === 'stop' && e.reason === 'end').length;
        const musicRestarts = mlog.filter((e) => e.ev === 'stop' && e.reason !== 'end').length;   // anything but a piece ending
        // each restart with what stopped it and how long it had been gone (a source left > LINGER and came back is fair)
        const evs = after.events ?? [], again = [];
        evs.forEach((e, i) => { if (e.ev !== 'start' || e.reason !== 'again' || e.t < (before.events?.at(-1)?.t ?? 0)) return; const prev = evs.slice(0, i).reverse().find((x) => x.id === e.id && x.ev === 'stop'); again.push({ id: e.id, goneMs: prev ? e.t - prev.t : null, stoppedBy: prev?.reason ?? null }); });
        const quickRestarts = again.filter((r) => r.stoppedBy !== 'out of hearing').length;
        const soundingSamples = `${levels.filter((v) => v > 0.001).length}/${levels.length}`;
        report.runs[name] = { readyMs: ready, ctx: after.ctx, level: after.level, voicesNow: after.voices, during: count(during), windStarts, windHeard, musicVoiceStarts,
          playerStartsDuring: playerStarts, again, quickRestarts, advances, musicRestarts, soundingSamples, piecesPlayed: [...new Set((after.musicLog ?? []).filter((e) => e.ev === 'start').map((e) => e.piece))], mainThreadPctMusicOn: cpuOn, mainThreadPctMusicOff: cpuOff, musicState: after.musicState, musicLog: after.musicLog, errors };
        log(`${name}: ctx ${after.ctx} level ${after.level}; ${during.length} starts during drags, restarts ${report.runs[name].during.restartsTotal} (quick, not after leaving hearing: ${quickRestarts}); wind starts ${windStarts}, wind heard ${windHeard.length}; music-voice starts ${musicVoiceStarts}; player starts ${playerStarts}, advances ${advances}, music restarts ${musicRestarts}, music sounding ${soundingSamples}; main thread ${cpuOn}% on / ${cpuOff}% off; errors ${errors.length}`);
        await page.screenshot({ path: resolve(out, `${name}.png`) });
        await page.context().close();
      }
    } finally { await browser.close(); }
  } finally { release(); }
} catch (e) { report.error = String(e?.stack ?? e); log(report.error); }
finally {
  writeFileSync(resolve(out, 'server.log'), serverLog.slice(-100_000));
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  log(`report ${resolve(out, 'report.json')}`);
  stop();
}
