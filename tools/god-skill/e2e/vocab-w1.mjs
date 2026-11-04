#!/usr/bin/env node
// VOCAB-MECH proof (harness copied by VOCAB-W1): the catalogue as a god and a Soul meet it. One fresh world (launcher env: edge minds), the god CLI
// and the UNCHANGED Soul CLI (tools/edge-skill/eden-agent.mjs):
//   the GOD finds things by words, synonyms, category and interface (`find`, `catalog`, `recommend`, `taxonomy`), builds
//   with the new types and their params (a glazed door, a worn fireplace, a phone box, a corner shop found as "bodega", a
//   café terrace set, cones stretched and under construction) and reads one back (`defs`);
//   Soul ANA sees the door, the fire and the phone box with their state in `observe`, is offered their actuators as
//   capabilities, opens the door by words ("open the blue door"), is refused locking an open door, closes and locks it,
//   is refused opening it locked, puts out the fire; each change is in the world (GET /v1/world/entities/<id>);
//   the VIEWER (real Chrome, GPU) draws it: the open door, the fire out, stretch/warp/condition looks (screenshots).
//
//   node tools/god-skill/e2e/vocab-mech.mjs [--port 5574] [--keep] [--dpr 1,2] [--no-viewer]
//
// Report under .lane/e2e-vocab/<stamp>/ (report.json, REPORT.md, shots, every CLI read under reads/).
import { setCameraMode } from '../../browser/world-controls.mjs';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = 'vocabw1', port = Number(args.port ?? 5650);
const dprs = String(args.dpr ?? '1').split(',').map(Number);
const out = resolve(root, '.lane/e2e-vocab-w1', stamp);
mkdirSync(resolve(out, 'reads'), { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], failures: [], shots: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test: viewer steps skipped)'); }

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', EDGE_FADING: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', MAX_SOULS_PER_USER: '10', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}` };
let serverLog = '', server;
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
process.on('exit', () => { if (!args.keep) try { server?.kill(); } catch { } });

async function api(path, { method, body, token } = {}) {
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = performance.now() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = (() => { try { const s = JSON.stringify(result); return s && s.length > 3000 ? JSON.parse(JSON.stringify(result, (k, v) => (Array.isArray(v) && v.length > 16 ? `[${v.length} items]` : typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + '…' : v))) : result; } catch { return String(result); } })();
  report.steps.push({ name, ms: Math.round(ms), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 700)}`);
  return result;
}

const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const godDir = resolve(out, 'god-cli'); mkdirSync(godDir, { recursive: true });
const god = (...argv) => new Promise((ok) => execFile(process.execPath, [GOD, ...argv], { cwd: godDir, timeout: 180_000, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }, (err, stdout, stderr) => { writeFileSync(resolve(out, 'reads', `god-${argv[0]}-${Date.now()}.txt`), `$ eden-god ${argv.join(' ')}\n${stdout}${stderr}`); ok({ code: err?.code ?? 0, out: String(stdout), err: String(stderr).slice(0, 400) }); }));
const ent = async (name) => { const s = (await api('/v1/world/snapshot')).data; return (s.entities ?? []).find((e) => e.name === name); };
const ok = (g) => g.code === 0 && !/REFUSED|Error/i.test(g.out + g.err);
// VOCAB-W1 types, in showcase rows: [name, spacing, extra params]
const ROWS = [
  { z: 30, gap: 4, eye: [0, 2.2, 6], names: ['ball', 'kite', 'teddy', 'toy-blocks', 'hoop', 'book', 'book-stack', 'newspaper', 'scroll', 'map', 'letter', 'litter', 'leaf-litter', 'region-marker', 'cairn', 'sandwich-board', 'puddle', 'spawn-point', 'dartboard'] },
  { z: 50, gap: 7, eye: [0, 4, 10], names: ['pool-table', 'chess-table', 'foosball', 'arcade-cabinet', 'bookcase', 'seesaw', 'boulder', 'debris-pile', 'excavation-pit', 'cave-mouth', 'chimney-stack', 'awning', 'solar-panels', 'rail-signal', 'buffer-stop'] },
  { z: 80, gap: 15, eye: [0, 9, 26], names: ['grain-silo', 'factory-chimney', 'power-substation', 'windmill', 'storage-tank', 'gable-roof', 'hip-roof', 'flat-roof', 'dome-roof', 'station-platform', 'tram-stop', 'tram-car', 'level-crossing', 'rail-track'] },
  { z: 125, gap: 32, eye: [0, 18, 42], names: ['warehouse', 'factory', 'workshop', 'smithy', 'depot'] },
  { z: -55, gap: 9, eye: [0, 4, 10], names: ['potted-plant', 'window-box', 'hanging-basket', 'statue', 'memorial', 'traffic-light', 'road-sign', 'milestone', 'lantern-post', 'floodlight', 'string-lights', 'stairs', 'ramp',
    'hammock', 'cot', 'crib', 'spade', 'rake', 'watering-can', 'broom', 'manhole', 'hand-pump', 'drain-grate', 'van', 'bus', 'tractor'] },
  { z: -100, gap: 32, eye: [0, 18, 42], names: ['town-hall', 'library', 'school', 'clinic', 'fire-station', 'post-office', 'museum'] },
];
// variants and states, a row of their own
const VARIANTS = [['boulder', 'variant=flat'], ['boulder', 'variant=split'], ['boulder', 'variant=tall'], ['ball', 'variant=beach'], ['ball', 'variant=rubber'], ['book', 'variant=open'], ['newspaper', 'variant=open'],
  ['gable-roof', 'variant=thatch'], ['gable-roof', 'variant=metal'], ['dome-roof', 'variant=onion'], ['grain-silo', 'variant=twin'], ['storage-tank', 'variant=water'], ['litter', 'variant=cans'], ['bookcase', 'variant=half'], ['awning', 'variant=scalloped'], ['awning', 'posts=true'], ['level-crossing', 'sx=1'], ['hip-roof', 'variant=slate'],
  ['road-sign', 'variant=give-way'], ['road-sign', 'variant=speed'], ['road-sign', 'variant=warning'], ['potted-plant', 'variant=palm'], ['potted-plant', 'variant=cactus'], ['potted-plant', 'variant=flowering'],
  ['lantern-post', 'variant=double'], ['statue', 'variant=bust'], ['van', 'variant=ice-cream'], ['stairs', 'variant=timber'], ['broom', 'variant=push']];
const AREAS = ['gravel-patch', 'sand-patch', 'mud-patch', 'snow-patch', 'dirt-patch', 'cobbles', 'paving', 'beach-strip', 'wheat-field', 'litter-scatter', 'allotments', 'flower-garden'];
const FINDS = [['smokestack', 'core/factory-chimney@1'], ['teeter-totter', 'core/seesaw@1'], ['streetcar', 'core/tram-car@1'], ['billiards', 'core/pool-table@1'], ['forge', 'core/smithy@1'],
  ['railroad crossing', 'core/level-crossing@1'], ['hipped roof', 'core/hip-roof@1'], ['photovoltaic', 'core/solar-panels@1'], ['cobblestones', 'core/cobbles@1'], ['hula hoop', 'core/hoop@1'],
  ['teddy bear', 'core/teddy@1'], ['envelope', 'core/letter@1'], ['rubble', 'core/debris-pile@1'], ['a-board', 'core/sandwich-board@1'], ['grotto', 'core/cave-mouth@1'],
  ['stoplight', 'core/traffic-light@1'], ['fairy lights', 'core/string-lights@1'], ['shovel', 'core/spade@1'], ['city hall', 'core/town-hall@1'], ['teeter-totter', 'core/seesaw@1'], ['camp bed', 'core/cot@1']];
const CATS = ['building.industrial', 'transport.rail', 'component.roof', 'terrain.ground', 'furniture.game', 'object.toy', 'object.media', 'layer.marker', 'layer.litter',
  'vegetation.potted', 'building.civic', 'public.monument', 'transport.sign', 'utility.lighting', 'component.access', 'furniture.bed', 'object.tool', 'utility.water', 'vehicle.road', 'public.park'];

try {
  await boot();
  log(`▶ world "${slug}" on :${port}`);
  await step('G0 the god mints a token; every new type is found by its everyday word (synonyms)', async () => {
    const r = await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'e2e vocab-w1' } });
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: r.data.token }, null, 1));
    const res = []; for (const [q, want] of FINDS) { const g = await god('find', ...q.split(' ')); const top = g.out.split('\n')[1]?.split(' ')[0]; res.push({ q, top, ok: top === want }); }
    return { found: res.filter((x) => x.ok).length, miss: res.filter((x) => !x.ok) };
  }, (r) => r.found === FINDS.length);
  await step('G1 the categories that were empty now list types (catalog by category)', async () => {
    const res = {}; for (const c of CATS) { const g = await god('catalog', '--category', c); res[c] = g.out.split('\n').filter((l) => /^core\//.test(l.trim())).length; }
    return res;
  }, (r) => Object.values(r).every((n) => n >= 3));
  await step('G2 every type places by name (showcase rows, variants, area presets)', async () => {
    const res = [];
    for (const row of ROWS) { let x = -((row.names.length - 1) * row.gap) / 2; for (const n of row.names) { const g = await god('place', n, '--at', `${x},${row.z}`, '--facing', 's', '--name', `show-${n}`, '--nudge'); res.push({ n, ok: ok(g), out: (g.out + g.err).slice(0, 160) }); x += row.gap; } }
    let x = -((VARIANTS.length - 1) * 8) / 2; for (const [n, p] of VARIANTS) { const g = await god('place', n, '--at', `${x},10`, '--facing', 's', '--name', `var-${n}-${p.split('=')[1]}`, '--param', p, '--nudge'); res.push({ n: `${n} ${p}`, ok: ok(g), out: (g.out + g.err).slice(0, 160) }); x += 8; }
    x = -((AREAS.length - 1) * 14) / 2; for (const n of AREAS) { const g = await god('place', n, '--rect', `${x},-20,12,12`, '--name', `area-${n}`); res.push({ n, ok: ok(g), out: (g.out + g.err).slice(0, 160) }); x += 14; }
    // a little railway: straight, straight, curve, with the tram on it
    for (const [i, v] of ['straight', 'straight', 'curve-left'].entries()) { const g = await god('place', 'rail-track', '--at', `90,${-40 + i * 8}`, '--facing', 's', '--name', `line-${i}`, '--param', `variant=${v}`); res.push({ n: `rail ${v}`, ok: ok(g), out: (g.out + g.err).slice(0, 160) }); }
    const g = await god('place', 'tram-car', '--at', '90,-32', '--facing', 's', '--name', 'line-tram'); res.push({ n: 'tram on line', ok: ok(g), out: (g.out + g.err).slice(0, 160) });
    return { placed: res.filter((r) => r.ok).length, total: res.length, failed: res.filter((r) => !r.ok) };
  }, (r) => r.placed === r.total);
  await step('G3 states the viewer draws: crossing barriers up, tram door open, windmill and arcade switched off', async () => {
    const out = [];
    for (const [n, st] of [['show-level-crossing', '{"open":true}'], ['line-tram', '{"open":true}'], ['show-windmill', '{"on":false}'], ['show-arcade-cabinet', '{"on":false}'], ['show-rail-signal', '{"on":false}']]) { const g = await god('set', n, '--state', st); out.push({ n, ok: ok(g), state: (await ent(n))?.state }); }
    return out;
  }, (r) => r.every((x) => x.ok && x.state));

  if (chromium && !args['no-viewer']) for (const dpr of dprs) {
    const release = await chromeLease('vocab-w1-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await god('time', '11:00'); await god('weather', '--kind', 'clear');
      await page.goto(`${base}?dev=1&assets=eager`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      const look = (eye, at) => page.evaluate(([e, a]) => { const s = window.__simEntity; if (!s) return false; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.controls.update?.(); return true; }, [eye, at]);
      const snap = async (name) => { const f = resolve(out, `${name}-${d}.png`); await page.screenshot({ path: f }); report.shots.push(f); log(`  📷 ${name}-${d}.png`); };
      const drawn = () => page.evaluate(() => { const L = window.__simEntity?.layer; return L ? { active: !!L.active, drawn: L.drawn?.size ?? null, err: L.stats?.lastError ?? null } : null; });
      await step(`V1[${d}] the viewer draws every new type (no page errors)`, async () => {
        let s; for (let i = 0; i < 90; i++) { s = await drawn(); if (s?.active && s.drawn > 60) break; await sleep(1000); }
        await sleep(4000);
        for (let i = 0; i < 3 && (await page.evaluate(() => document.querySelector('canvas')?.dataset.cameraMode)) !== 'manual'; i++) { await setCameraMode(page, 'manual'); await sleep(600); }
        return { ...s, errors };
      }, (r) => r?.active && !r.errors.length);
      await step(`V2[${d}] a close-up of every new type, its variants and areas, framed by its size; the little railway`, async () => {
        await page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (/^Join this world as a Soul/.test(el.textContent?.trim() ?? '') && getComputedStyle(el).position === 'fixed') el.style.display = 'none'; const t = [...document.querySelectorAll('*')].find((e) => e.textContent?.trim().startsWith('Join this world as a Soul') && e.children.length < 3); let n = t; while (n && n.parentElement && getComputedStyle(n).position !== 'fixed' && getComputedStyle(n).position !== 'absolute') n = n.parentElement; if (n) n.style.display = 'none'; });
        const sizes = {}; for (const line of String((await api('/v1/god/catalog?format=lines&per=2000', { token: JSON.parse(readFileSync(resolve(godDir, '.eden-god.json'), 'utf8')).token })).data).split('\n')) { const m = /^(core\/[\w-]+)@1 \[[^\]]+\] ([\d.]+)×([\d.]+)×([\d.]+)m/.exec(line.trim()); if (m) sizes[m[1].slice(5)] = [+m[2], +m[3], +m[4]]; }
        const snap0 = (await api('/v1/world/snapshot')).data.entities ?? [];
        const names = [...ROWS.flatMap((r) => r.names.map((n) => [`show-${n}`, n])), ...VARIANTS.map(([n, p]) => [`var-${n}-${p.split('=')[1]}`, n])];
        const missing = [];
        for (const [en, n] of names) {
          const e = snap0.find((x) => x.name === en); if (!e) { missing.push(en); continue; }
          const [w, h, dd] = sizes[n] ?? [2, 2, 2], R = Math.max(w, h, dd, 0.5), dist = R * 1.25 + 0.6, p = e.p ?? e.position ?? [0, 0, 0];
          await look([p[0] + dist * 0.55, p[1] + h * 0.55 + dist * 0.45, p[2] + dist], [p[0], p[1] + h * 0.4, p[2]]); await sleep(1100); await snap(`c-${en}`);
        }
        for (let k = 0; k < 3; k++) { const x = -56 + k * 56; await look([x, 22, 10], [x, 0, -20]); await sleep(2000); await snap(`areas-${k + 1}`); }
        await look([102, 6, -20], [90, 1, -30]); await sleep(1600); await snap('railway');
        await look([97, 3, -26], [90, 1.6, -32]); await sleep(1600); await snap('tram-door');
        { const lx = -((AREAS.length - 1) * 14) / 2 + AREAS.indexOf('litter-scatter') * 14; await look([lx + 1, 2.5, -13], [lx, 0, -20]); } await sleep(1600); await snap('litter-scatter');
        return { errors, missing, sized: Object.keys(sizes).length };
      }, (r) => !r.errors.length && !r.missing.length);
    } finally { await browser.close(); await release(); }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const ok = report.steps.filter((s) => s.ok).length;
  writeFileSync(resolve(out, 'REPORT.md'), [`# VOCAB-W1 e2e ${stamp}`, `${ok}/${report.steps.length} steps passed on :${port}`, '', ...report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`), '', '## Shots', ...report.shots.map((f) => `- ${f}`)].join('\n') + '\n');
  log(`\n${ok}/${report.steps.length} passed — ${out}`);
  if (!args.keep) { try { server?.kill(); } catch { } }
  process.exit(report.failures.length ? 1 : 0);
}
