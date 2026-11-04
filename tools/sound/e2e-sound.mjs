#!/usr/bin/env node
// Release 3.1 soundscape proof in real Chrome (shared Chrome lease, Metal GPU): a fresh dev world built from the
// eden-district template plus a wood, a windy knoll with flags and a flower bed; the camera visits each place by day and
// the pond and wood by night, and records which sources play there (`__edenSound.state()`), the output level, and that
// mute silences it. Fake minds, no paid generation, no production data. Only stops the server it started.
//
//   node tools/sound/e2e-sound.mjs --port 6341 --out .local/r31v/sound [--dprs 1,2]
import { openAudio, setEffects } from '../browser/world-controls.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from '../lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const port = Number(arg('port', 6341)), out = resolve(arg('out', scratchDir('r31v/sound')));
const dprs = String(arg('dprs', '1,2')).split(',').map(Number);
if (port < 6340 || port > 6359) throw new Error('lane V ports are 6340–6359');
const slug = 'soundscape', base = `http://127.0.0.1:${port}/w/${slug}`;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], failures: [], places: {}, shots: [] };
const log = (s) => console.log(s);
async function step(name, fn, expect) {
  let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).slice(0, 1200); }
  const ok = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ok, result, error }); if (!ok) report.failures.push({ name, error, result });
  log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 500)}`);
  return result;
}

// ---- the world: eden-district + a wood, a high knoll with flags, a flower bed
const genesis = JSON.parse(readFileSync(resolve(root, 'worlds/templates/eden-district.json'), 'utf8'));
genesis.name = 'Soundscape proof';
genesis.batches.push({ note: 'r31v soundscape additions', ops: [
  { op: 'place', def: 'core/woodland@1', name: 'north-wood', shape: { area: [[-30, 50], [30, 50], [30, 95], [-30, 95]] } },
  { op: 'place', def: 'core/pine@1', name: 'wood-pine-1', p: [-10, 60] }, { op: 'place', def: 'core/pine@1', name: 'wood-pine-2', p: [12, 72] },
  { op: 'place', def: 'core/tree@1', name: 'wood-oak-1', p: [0, 66] }, { op: 'place', def: 'core/birch@1', name: 'wood-birch-1', p: [-18, 80] },
  { op: 'place', def: 'core/knoll@1', name: 'windy-knoll', p: [0, -110], params: { height: 15, radius: 34 } },
  { op: 'place', def: 'core/flag@1', name: 'knoll-flag-1', p: [-2, -110] }, { op: 'place', def: 'core/flag@1', name: 'knoll-flag-2', p: [3, -108] },
  { op: 'place', def: 'core/flower-bed@1', name: 'beds-1', p: [0, 6] }, { op: 'place', def: 'core/flower-bed@1', name: 'beds-2', p: [3, 6] },
] });
const genesisFile = resolve(out, 'genesis.json'); writeFileSync(genesisFile, JSON.stringify(genesis, null, 1));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', EDGE_FADING: '1', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: genesisFile, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}) };
let server = null, serverLog = '';
const stop = () => { try { server?.kill(); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => process.exit(130));
const admin = (path, body) => fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.text() }));

try {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ } await sleep(100); }
  await step('server up with the soundscape world', async () => (await fetch(`${base}/healthz`)).status, (s) => s === 200);
  let godToken = '';
  await step('mint a god token (for the clock)', async () => { const r = await fetch(base + '/v1/god/mint', { method: 'POST', headers: { authorization: 'Bearer dev:gene', 'content-type': 'application/json' }, body: JSON.stringify({ label: 'r31v-sound' }) }); const j = await r.json(); godToken = j.token; return { status: r.status, ok: !!godToken }; }, (r) => r.ok);
  const godDir = resolve(out, 'god'); mkdirSync(godDir, { recursive: true }); writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken }));
  const god = (...a) => new Promise((ok) => { const p = spawn(process.execPath, [resolve(root, 'tools/god-skill/eden-god.mjs'), ...a], { cwd: godDir, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1', EDEN_GOD_NO_LEASE: '1' } }); let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; }); p.on('exit', (code) => ok({ code, out: o.slice(0, 300) })); });
  await step('daytime', () => god('time', '11:00'), (r) => r.code === 0);
  await step('two residents arrive (fake minds)', async () => [await admin('/v1/souls', { name: 'Ana', description: 'probe resident' }), await admin('/v1/souls', { name: 'Ben', description: 'probe resident' })].map((r) => r.status), (s) => s.every((x) => x < 300));

  const chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium;
  const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
  const release = await chromeLease('r31v-sound');
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      for (const dpr of dprs) {
        const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr })).newPage();
        const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
        await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__simEntity?.layer?.model && !!window.__edenSound, null, { timeout: 180_000 });
        await sleep(4000);
        const before = await page.evaluate(() => window.__edenSound.state().ctx);
        await step(`dpr ${dpr}: no audio before a gesture`, () => before, (s) => s === 'none');
        await page.mouse.click(720, 450); await page.keyboard.down('w'); await sleep(250); await page.keyboard.up('w');   // a gesture; takes the camera from Broadcast
        const look = (eye, at) => page.evaluate(([e, a]) => { const s = window.__simEntity; s.controls.target.set(...a); s.camera.position.set(...e); s.controls.update?.(); return true; }, [eye, at]);
        const ground = (x, z) => page.evaluate(([x, z]) => window.__simEntity.layer.groundAt?.(x, z) ?? 0, [x, z]);
        const where = async (name, x, z, toward, wait = 3500) => {
          const g = await ground(x, z); await look([x, g + 1.7, z], [toward[0], g + 1.4, toward[1]]); await sleep(wait);
          const s = await page.evaluate(() => ({ ...window.__edenSound.state(), level: window.__edenSound.level() }));
          const row = { at: [x, +g.toFixed(1), z], ctx: s.ctx, world: s.world, level: s.level, voices: s.voices.map((v) => `${v.kind}/${v.variant} ${v.source} ${v.id} g${v.gain}`) };
          if (dpr === dprs[0]) report.places[name] = row;
          log(`   ${name} @${x},${z} exp ${s.world.exposure} level ${s.level}: ${s.voices.map((v) => `${v.kind}/${v.variant}`).join(' ')}`);
          return s;
        };
        const kinds = (s) => new Set(s.voices.map((v) => v.kind));
        if (dpr === dprs[0]) {
          await step('plaza fountain: water + its drip + pigeons, plaza trees rustle', () => where('fountain', 75, 16, [75, 19]), (s) => s.ctx === 'running' && s.voices.filter((v) => v.kind === 'water').length >= 2 && s.voices.some((v) => v.id.endsWith('#2') && v.kind === 'birds') && kinds(s).has('leaves') && s.level > 0);
          await step('pond shore by day: waves, the ducks, the reeds', () => where('pond-day', -45, 3, [-53, 0]), (s) => kinds(s).has('waves') && kinds(s).has('waterfowl'));
          await step('in the wood: the trees rustle as one voice, birds sing up in its trees', () => where('wood', 0, 70, [10, 75]), (s) => s.voices.filter((v) => v.kind === 'leaves').length >= 1 && s.voices.some((v) => v.id.startsWith('amb:birds') && v.kind === 'birds') && s.world.trees > 0);
          await step('flower beds: bees by day', () => where('flowers', 1.5, 3, [1.5, 6]), (s) => kinds(s).has('bees'));
          const street = await step('between the houses: sheltered', () => where('street', 43, 21, [60, 21]), (s) => s.ctx === 'running');
          await step('on the knoll: exposed — more wind, gusts, flags flapping', () => where('knoll', 1, -116, [0, -104]), (s) => s.world.exposure > (street?.world.exposure ?? 1) && s.voices.some((v) => v.id === 'amb:gusts') && kinds(s).has('flag'));
          // residents: wherever they stand together, chatter (fake minds may wander; recorded, not required)
          report.places.residents = await page.evaluate(() => window.__simEntity.residents());
          await page.screenshot({ path: resolve(out, `day-knoll-dpr${dpr}.png`) }); report.shots.push(`day-knoll-dpr${dpr}.png`);
          await step('a resident speaking: a murmur of her voice where she stands', async () => {
            const me = await (await fetch(base + '/v1/me', { headers: { authorization: 'Bearer dev:admin' } })).json();
            const ana = me.souls?.find((x) => x.name === 'Ana'); if (!ana) return { error: 'no Ana' };
            const pair = await (await fetch(base + `/v1/souls/${ana.id}/pair`, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: '{}' })).json();
            const cred = await (await fetch(base + '/v1/agent/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pair.code, agent: 'r31v-sound' }) })).json();
            const pos = (await page.evaluate(() => window.__simEntity.residents())).find((r) => r.id === ana.id)?.p ?? [0, 0, 0];
            const g = await ground(pos[0] + 6, pos[2] + 6); await look([pos[0] + 6, g + 1.7, pos[2] + 6], [pos[0], g + 1.4, pos[2]]);
            let hit = null, said = 0;
            for (let t0 = Date.now(); Date.now() - t0 < 40000 && !hit;) {
              if (Date.now() - t0 >= said * 8000) { await fetch(base + '/v1/edge/say', { method: 'POST', headers: { authorization: `Bearer ${cred.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: `Listen, the wind is up on the knoll today, and the ducks are loud at the pond (${said}).` }) }); said++; }
              await sleep(500); const st = await page.evaluate(() => window.__edenSound.state()); hit = st.voices.find((v) => v.id === `res:talk:${ana.id}`) ?? null;
            }
            const st = await page.evaluate(() => ({ voices: window.__edenSound.state().voices.map((v) => `${v.kind}/${v.variant} ${v.id} g${v.gain}`), level: window.__edenSound.level() }));
            report.places.speaking = { at: pos, ...st }; log(`   speaking: ${st.voices.join(' | ')}`);
            return { hit, said };
          }, (r) => !!r.hit);
          await step('mute silences the output; unmute brings it back', async () => {
            await setEffects(page, false); await sleep(1200); const off = await page.evaluate(() => window.__edenSound.level());
            await setEffects(page, true); await sleep(1500); const on = await page.evaluate(() => window.__edenSound.level());
            return { off, on };
          }, (r) => r.off === 0 && r.on > 0);
          await step('night', () => god('time', '23:30'), (r) => r.code === 0);
          await sleep(7000);
          await step('pond by night: frogs at the water and in the reeds, crickets, no birds or ducks', () => where('pond-night', -45, 3, [-53, 0], 4000), (s) => kinds(s).has('frogs') && !kinds(s).has('birds') && !kinds(s).has('waterfowl') && !kinds(s).has('bees'));
          await step('wood by night: leaves and crickets, no birds', () => where('wood-night', 0, 70, [10, 75]), (s) => kinds(s).has('leaves') && !kinds(s).has('birds'));
          await step('flower beds by night: no bees', () => where('flowers-night', 1.5, 3, [1.5, 6]), (s) => !kinds(s).has('bees'));
          report.log = await page.evaluate(() => window.__edenSound.log());
          await step('back to day', () => god('time', '11:00'), (r) => r.code === 0);
          await sleep(5000);
        }
        // The navbar audio menu at this DPR, at the fountain.
        const g = await ground(75, 12); await look([75, g + 2.2, 10], [75, g + 1, 19]); await sleep(2500);
        await page.screenshot({ path: resolve(out, `fountain-dpr${dpr}.png`) }); report.shots.push(`fountain-dpr${dpr}.png`);
        await openAudio(page); await page.getByRole('dialog', { name: 'Audio', exact: true }).screenshot({ path: resolve(out, `toggle-dpr${dpr}.png`) }); report.shots.push(`toggle-dpr${dpr}.png`);
        await step(`dpr ${dpr}: no page errors`, () => errors, (e) => e.length === 0);
        await page.context().close();
      }
      // A phone: the first tap unlocks audio; the navbar effects switch is tappable and silences effects.
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
        const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
        await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__simEntity?.layer?.model && !!window.__edenSound, null, { timeout: 180_000 }); await sleep(4000);
        const before = await page.evaluate(() => window.__edenSound.state().ctx);
        await page.touchscreen.tap(195, 600); await sleep(3000);
        const after = await page.evaluate(() => ({ ctx: window.__edenSound.state().ctx, level: window.__edenSound.level(), voices: window.__edenSound.state().voices.length }));
        await step('phone: no audio before the first tap; the tap starts it', () => ({ before, ...after }), (r) => r.before === 'none' && r.ctx === 'running' && r.level > 0);
        await page.locator('.navbar-audio .navbar-menu-trigger').tap();
        const effects = page.getByRole('switch', { name: /^Sound effects / });
        const box = await effects.boundingBox();
        await effects.tap(); await sleep(1200);
        const muted = await page.evaluate(() => ({ muted: window.__edenSound.state().muted, level: window.__edenSound.level() }));
        await step('phone: the navbar effects switch has a 44 px target, stays in the viewport and mutes on tap', () => ({ box, ...muted }), (r) => r.muted && r.level === 0 && r.box && r.box.height >= 44 && r.box.x >= 0 && r.box.x + r.box.width <= 390 && r.box.y + r.box.height <= 844);
        await page.screenshot({ path: resolve(out, 'phone-dpr3.png') }); report.shots.push('phone-dpr3.png');
        await effects.tap();
        await step('phone: no page errors', () => errors, (e) => e.length === 0);
        await ctx.close();
      }
    } finally { await browser.close(); }
  } finally { release(); }
} catch (e) { report.failures.push({ name: 'run', error: String(e?.stack ?? e) }); log(String(e?.stack ?? e)); }
finally {
  writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200_000));
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  log(`${report.steps.filter((s) => s.ok).length}/${report.steps.length} ok; report ${resolve(out, 'report.json')}`);
  stop();
}
