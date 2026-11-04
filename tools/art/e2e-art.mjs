#!/usr/bin/env node
// W6 + W7 proof on a fresh dev world (fake minds, $0): the creator builds a small gallery, the creator's agent and a
// resident's agent hang images and looping videos through tools/art/eden-art.mjs, a resident is refused someone
// else's slot, then real Chrome (through the shared lease) looks at it: videos play, hovering a piece shows its title
// and maker, the soundscape logs which sources play where, and the mute button survives a reload.
//
//   node tools/art/e2e-art.mjs --port 6031 --out .local/artsound/e2e [--media <dir>] [--keep]
// Needs apps/web/dist (pnpm --filter @sim/web build). Uses only its own port and data; stops only the server it started.
import { openAudio, setEffects, setMusic } from '../browser/world-controls.mjs';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from '../lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const port = Number(arg('port', 6031)), out = resolve(arg('out', scratchDir('artsound/e2e'))), media = resolve(arg('media', scratchDir('artsound/media')));
if (port >= 4930 && port <= 4990) throw new Error('never use the live ports');
const slug = 'artsound', base = `http://127.0.0.1:${port}/w/${slug}`;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], failures: [], shots: [], sound: {} };
const log = (s) => console.log(s);
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Art Sound', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', EDGE_FADING: '1', ENABLE_WORLD_ENGINE: '1', DATA_DIR: resolve(out, 'data'), ASSET_DIR: resolve(out, 'assets'), PUBLIC_URL: `http://127.0.0.1:${port}` };
let server = null, serverLog = '';
const stop = () => { try { server?.kill(); } catch { /* gone */ } };   // only the child this script spawned
process.on('exit', stop); process.on('SIGINT', () => process.exit(130));

async function api(path, { body, token } = {}) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 1200); }
  const ok = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ok, ms: Math.round(performance.now() - t0), result, error }); if (!ok) report.failures.push({ name, result, error });
  log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 600)}`);
  return result;
}
const run = (bin, dir, ...a) => new Promise((ok) => execFile(process.execPath, [bin, ...a], { cwd: dir, timeout: 180_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1', EDEN_GOD_NO_LEASE: '1' } }, (e, so, se) => ok({ code: e?.code ?? 0, out: String(so), err: String(se) })));
const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), AGENT = resolve(root, 'tools/edge-skill/eden-agent.mjs'), ART = resolve(root, 'tools/art/eden-art.mjs');
const godDir = resolve(out, 'god'), anaDir = resolve(out, 'ana'); mkdirSync(godDir); mkdirSync(anaDir);
const god = (...a) => run(GOD, godDir, ...a), ana = (...a) => run(AGENT, anaDir, ...a);
const art = (who, ...a) => run(ART, root, base, ...a, '--token-file', resolve(who === 'god' ? godDir : anaDir, who === 'god' ? '.eden-god.json' : '.eden-agent.json'));

try {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ } await sleep(100); }
  let godToken = '';
  await step('the owner mints a god token', async () => { const r = await api('/v1/god/mint', { body: { label: 'artsound' }, token: 'dev:gene' }); godToken = r.data.token; writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken })); return { status: r.status, ok: !!godToken }; }, (r) => r.ok);
  await step('the creator builds a gallery: two gallery walls, a picture frame, a screen, a fountain, benches', async () => {
    const cmds = [['place', 'plaza', '--rect', '0,0,22,16', '--name', 'plaza'], ['place', 'gallery-wall', '--at', '0,-5', '--name', 'gallery-north'], ['place', 'gallery-wall', '--at', '0,5', '--facing', 'gallery-north', '--name', 'gallery-south'],
      ['place', 'bench', '--at', '0,-1.5', '--facing', 'gallery-north', '--name', 'bench'], 
      ['place', 'picture-frame', '--at', '-6,0', '--facing', 'bench', '--name', 'easel'], ['place', 'screen', '--at', '7,0', '--facing', 'bench', '--name', 'cinema'], ['place', 'fountain', '--at', '0,14', '--name', 'fountain'], ['time', '11:00']];
    const res = []; for (const c of cmds) { const r = await god(...c); res.push({ cmd: c.join(' '), ok: r.code === 0 && !/REFUSED/.test(r.out), out: (r.out || r.err).slice(0, 160) }); }
    return { all: res.every((x) => x.ok), res };
  }, (r) => r.all);
  await step('a resident joins: Ana', async () => { await ana('register', base); const c = await ana('create-soul', 'Ana', 'Ana, a painter'); return { code: c.code, out: c.out.slice(0, 200) }; }, (r) => r.code === 0);
  const hung = [];
  const hang = async (who, frame, file, title, slot) => { const r = await art(who, 'hang', frame, resolve(media, file), '--title', title, ...(slot === undefined ? [] : ['--slot', String(slot)])); hung.push({ who, frame, file, slot, code: r.code, out: (r.out || r.err).trim() }); return r; };
  await step('the creator hangs an image and a looping video in the north gallery (local files uploaded by the CLI)', async () => {
    const a = await hang('god', 'gallery-north', 'plasma.png', 'Plasma Study', 0), b = await hang('god', 'gallery-north', 'life.mp4', 'Game of Life', 1), c = await hang('god', 'easel', 'swirl.jpg', 'Swirl');
    return { codes: [a.code, b.code, c.code], out: [a.out, b.out, c.out].map((s) => s.slice(0, 140)) };
  }, (r) => r.codes.every((c) => c === 0));
  await step('the resident hangs her own video and image in empty slots', async () => {
    const a = await hang('ana', 'gallery-north', 'mandel.mp4', 'Mandelbrot Zoom', 2), b = await hang('ana', 'gallery-north', 'study.png', 'Red Sun', 3), c = await hang('ana', 'cinema', 'life.mp4', 'Life, large');
    return { codes: [a.code, b.code, c.code], out: [a.out, b.out, c.out].map((s) => s.slice(0, 140)) };
  }, (r) => r.codes.every((c) => c === 0));
  await step('the resident is refused the creator\'s slot', async () => { const r = await hang('ana', 'gallery-north', 'study.png', 'Mine now', 0); return { code: r.code, out: (r.out + r.err).slice(0, 300) }; }, (r) => r.code !== 0 && /art\.not-yours/.test(r.out));
  const listed = await step('GET /v1/art lists every piece with its maker', async () => (await api('/v1/art')).data.displays, (d) => d?.find((x) => x.name === 'gallery-north')?.art.length === 4);
  report.art = listed;

  let chromium = null; try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('no @playwright/test'); }
  if (chromium) {
    const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
    const release = await chromeLease('artsound');
    try {
      for (const dpr of [2, 1]) {
        const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
        const look = (eye, at) => page.evaluate(([e, a]) => { const s = window.__simEntity; s.controls.target.set(...a); s.camera.position.set(...e); s.controls.update?.(); return true; }, [eye, at]);
        const shot = async (name) => { const f = resolve(out, `${name}-dpr${dpr}.png`); await page.screenshot({ path: f }); report.shots.push(f); };
        await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__simEntity?.layer?.active && window.__edenArt?.state().faces.length >= 4, null, { timeout: 180_000 });
        await page.waitForTimeout(4000);
        await page.mouse.click(640, 700);   // a real gesture: unlocks audio
        await page.keyboard.down('w'); await page.waitForTimeout(250); await page.keyboard.up('w');   // deliberate movement takes the camera over from Broadcast
        await page.waitForTimeout(1200);
        await look([1.4, 1.75, -1.2], [0, 1.55, -5]);   // beside the bench, so the resident does not block the view
        await page.waitForTimeout(5000);
        const st = await step(`dpr ${dpr}: the north gallery shows 4 pieces; both videos play`, () => page.evaluate(() => window.__edenArt.state()), (s) => s.videos.filter((v) => v.playing).length >= 2 && s.faces.filter((f) => f.frame && f.url).length >= 4);
        if (dpr === 2) report.videos = st?.videos;
        await shot('gallery');
        // hover the video in slot 1 with the real mouse: find where it is on screen
        const pt = await page.evaluate(() => { const s = window.__simEntity; let p = null; s.layer.group.traverse((o) => { if (o.userData?.art?.slot === 1 && o.userData.art.kind === 'video' && !p) { const v = o.getWorldPosition(new o.position.constructor()); v.project(s.camera); const r = s.renderer.domElement.getBoundingClientRect(); p = { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } }); return p; });
        if (pt) { await page.mouse.move(pt.x - 30, pt.y - 10); await page.mouse.move(pt.x, pt.y, { steps: 6 }); }
        await page.waitForTimeout(600);
        await step(`dpr ${dpr}: hovering a piece shows its title and maker`, () => page.evaluate(() => ({ hover: window.__edenArt.state().hover?.text ?? null, tip: document.querySelector('.eden-art-tooltip')?.hidden === false ? document.querySelector('.eden-art-tooltip').textContent : null })), (r) => /Game of Life — by the world's creator/.test(r.tip ?? ''));
        await shot('hover-video');
        const pt3 = await page.evaluate(() => { const s = window.__simEntity; let p = null; s.layer.group.traverse((o) => { if (o.userData?.art?.slot === 2 && !p) { const v = o.getWorldPosition(new o.position.constructor()); v.project(s.camera); const r = s.renderer.domElement.getBoundingClientRect(); p = { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } }); return p; });
        if (pt3) await page.mouse.move(pt3.x, pt3.y, { steps: 6 });
        await page.waitForTimeout(600);
        await step(`dpr ${dpr}: the resident's piece names her`, () => page.evaluate(() => document.querySelector('.eden-art-tooltip')?.textContent ?? null), (t) => /Mandelbrot Zoom — by Ana \(a resident\)/.test(t ?? ''));
        if (dpr === 2) await shot('hover-resident');
        if (dpr === 1) { await browser.close(); continue; }
        // ---- sound: which sources play where
        const where = async (name, eye, at, wait = 4000) => { await look(eye, at); await page.mouse.move(5, 5); await page.waitForTimeout(wait); const s = await page.evaluate(() => window.__edenSound.state()); report.sound[name] = { at: eye, ctx: s.ctx, muted: s.muted, voices: s.voices }; log(`   sound @${name}: ${s.voices.map((v) => `${v.kind}/${v.variant}(${v.source})`).join(' ')}`); return s; };
        await step('sound: in the gallery — wind, birds and the fountain behind, quiet master', () => where('gallery', [0, 1.7, 1], [0, 1.5, -5]), (s) => s.ctx === 'running' && s.voices.some((v) => v.kind === 'wind') && s.voices.some((v) => v.kind === 'birds') && s.volume <= 0.35);
        await step('sound: at the fountain — the fountain is the loudest object', () => where('fountain', [0, 1.7, 11.5], [0, 1, 14]), (s) => s.voices.some((v) => v.source === 'object' && v.kind === 'water'));
        await step('sound: walking at eye height — the visitor\'s own footsteps', async () => { await look([0, 1.7, 2], [0, 1.6, -5]); await page.keyboard.down('w'); await page.waitForTimeout(1500); const s0 = await page.evaluate(() => window.__edenSound.state()); await page.keyboard.up('w'); report.sound.walking = { voices: s0.voices }; return s0; }, (s) => s.heard.some((h) => h.id === 'me:steps'));
        await step('sound: at night — crickets instead of birds', async () => { await god('time', '23:30'); await page.waitForTimeout(6000); return where('night', [0, 1.7, 1], [0, 1.5, -5], 3000); }, (s) => s.voices.some((v) => v.kind === 'crickets') && !s.voices.some((v) => v.kind === 'birds'));
        await god('time', '11:00');
        report.soundLog = await page.evaluate(() => window.__edenSound.log());
        // the mute button: a real click, then a reload remembers it
        await setEffects(page, false);
        await page.waitForTimeout(500);
        await shot('muted-button');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__edenSound && !!document.querySelector('.navbar-audio .navbar-menu-trigger'), null, { timeout: 180_000 });
        await openAudio(page);
        await step('the effects switch remembers across a reload', () => page.evaluate(() => ({ muted: window.__edenSound.state().muted, checked: document.querySelector('.navbar-popover.navbar-audio [role="switch"]')?.getAttribute('aria-checked') })), (r) => r.muted === true && r.checked === 'false');
        await setEffects(page, true);
        await setMusic(page, true);
        await page.waitForTimeout(3000);
        await step('the independent music switch enables the score playlist', () => page.evaluate(() => ({music:window.__edenSound.state().music,playing:window.__edenMusic.state().playing})), (s) => s.music === true && !!s.playing);
        await browser.close();
      }
    } finally { release(); }
  }
} finally {
  report.hung = undefined;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200_000));
  log(`${report.steps.filter((s) => s.ok).length}/${report.steps.length} steps ok; report ${resolve(out, 'report.json')}`);
  stop();
  process.exit(report.failures.length ? 1 : 0);
}
