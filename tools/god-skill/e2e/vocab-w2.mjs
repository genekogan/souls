#!/usr/bin/env node
// VOCAB-W2 proof (harness copied from VOCAB-W1): vehicles, living things, water, utilities and the sound layer as a god
// and a viewer meet them. One fresh world, the god CLI:
//   G0 everyday words find the new types first; G1 the categories list them; G2 every type places by name (rows, variants,
//   a lake with boats and swans, paths: canal, drainage channel, boardwalk, stream; areas: wetland, reservoir);
//   G3 states (car door open, helicopter and plane started, crane on, fountain off, bell rung, speaker playing);
//   VIEWER (real Chrome, GPU): V1 draws everything, V2 a size-framed close-up of every type and variant,
//   S1 the sound layer: after a click the fountain, campfire, stream and songbird are heard near them and not far away;
//   switching the fountain off silences it; a speaker plays only while playing.
//
//   node tools/god-skill/e2e/vocab-w2.mjs [--port 5690] [--keep] [--dpr 1,2] [--no-viewer]
//
// Report under .lane/e2e-vocab-w2/<stamp>/ (report.json, REPORT.md, shots, every CLI read under reads/).
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
const slug = 'vocabw2', port = Number(args.port ?? 5690);
const dprs = String(args.dpr ?? '1').split(',').map(Number);
const out = resolve(root, '.lane/e2e-vocab-w2', stamp);
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

const GOD = resolve(root, 'tools/god-skill/eden-god.mjs');
const godDir = resolve(out, 'god-cli'); mkdirSync(godDir, { recursive: true });
const god = (...argv) => new Promise((ok) => execFile(process.execPath, [GOD, ...argv], { cwd: godDir, timeout: 180_000, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }, (err, stdout, stderr) => { writeFileSync(resolve(out, 'reads', `god-${argv[0]}-${Date.now()}.txt`), `$ eden-god ${argv.join(' ')}\n${stdout}${stderr}`); ok({ code: err?.code ?? 0, out: String(stdout), err: String(stderr).slice(0, 400) }); }));
const ent = async (name) => { const s = (await api('/v1/world/snapshot')).data; return (s.entities ?? []).find((e) => e.name === name); };
const ok = (g) => g.code === 0 && !/REFUSED|Error/i.test(g.out + g.err);
const ANIMALS = ['hedgehog', 'squirrel', 'badger', 'hamster', 'pigeon', 'parrot', 'frog', 'turtle', 'crab', 'butterfly', 'owl', 'heron', 'donkey'];
const ROWS = [
  { z: 30, gap: 3, names: ANIMALS, params: ['behavior=idle'] },
  { z: 45, gap: 6, names: ['birdbath', 'rain-barrel', 'transformer-box', 'generator', 'ev-charger', 'bollard-light', 'street-cabinet', 'dumpster', 'compost-heap', 'sound-emitter', 'bell', 'speaker', 'wind-chime', 'campfire', 'satellite-dish', 'cargo-bike', 'pram', 'motorbike', 'mine-cart', 'stepping-stones'] },
  { z: 70, gap: 14, names: ['family-car', 'pickup-truck', 'truck', 'excavator', 'fire-engine', 'caravan', 'small-plane', 'helicopter', 'locomotive', 'tiered-fountain', 'swimming-pool', 'watermill', 'streetlight', 'water-tank'] },
  { z: 110, gap: 30, names: ['crane', 'pylon', 'antenna-mast'] },
];
const LAKE = { x: 0, z: -70, w: 80, d: 34 };
const AFLOAT = [['motorboat', -30], ['narrowboat', -14], ['pedalo', 2], ['raft', 12], ['buoy', 22], ['swan', 30], ['otter', 34]];
const VARIANTS = [['family-car', 'variant=hatch'], ['family-car', 'variant=estate'], ['family-car', 'variant=taxi'], ['truck', 'variant=flatbed'], ['truck', 'variant=tanker'], ['motorbike', 'variant=scooter'],
  ['locomotive', 'variant=diesel'], ['tiered-fountain', 'variant=wall'], ['tiered-fountain', 'variant=jet'], ['swimming-pool', 'variant=round'], ['stepping-stones', 'variant=curve'], ['streetlight', 'variant=double'],
  ['streetlight', 'variant=modern'], ['streetlight', 'variant=solar'], ['satellite-dish', 'variant=large'], ['bollard-light', 'variant=square'], ['dumpster', 'variant=blue']];
const PATHS = [['canal', [[-60, -120], [60, -120]]], ['drainage-channel', [[-60, -132], [60, -132]]], ['boardwalk', [[-60, -140], [60, -140]]], ['stream', [[70, 0], [70, 40], [80, 70]]]];
const AREAS = [['wetland', '-50,-100,24,14'], ['reservoir', '40,-100,30,18']];
const FINDS = [['sedan', 'core/family-car@1'], ['lorry', 'core/truck@1'], ['digger', 'core/excavator@1'], ['chopper', 'core/helicopter@1'], ['houseboat', 'core/narrowboat@1'], ['swan boat', 'core/pedalo@1'],
  ['steam engine', 'core/locomotive@1'], ['tower crane', 'core/crane@1'], ['bakfiets', 'core/cargo-bike@1'], ['stroller', 'core/pram@1'], ['hedgehog', 'core/hedgehog@1'], ['tortoise', 'core/turtle@1'],
  ['water butt', 'core/rain-barrel@1'], ['lido', 'core/swimming-pool@1'], ['water wheel', 'core/watermill@1'], ['marsh', 'core/wetland@1'], ['ditch', 'core/drainage-channel@1'], ['duckboards', 'core/boardwalk@1'],
  ['transmission tower', 'core/pylon@1'], ['cell tower', 'core/antenna-mast@1'], ['charging point', 'core/ev-charger@1'], ['cobra head', 'core/streetlight@1'], ['bonfire', 'core/campfire@1'], ['loudspeaker', 'core/speaker@1'],
  ['wind chimes', 'core/wind-chime@1'], ['genset', 'core/generator@1'], ['water tank', 'core/water-tank@1']];
const CATS = ['vehicle.road', 'vehicle.cycle', 'vehicle.water', 'vehicle.air', 'vehicle.rail', 'living.wild', 'living.bird', 'living.pet', 'living.fish', 'water.feature', 'water.body', 'water.flow', 'water.shore', 'utility.power', 'utility.lighting', 'utility.comms', 'utility.waste', 'layer.sound'];
try {
  await boot();
  log(`▶ world "${slug}" on :${port}`);
  await step('G0 the god mints a token; every new type is found by its everyday word (synonyms)', async () => {
    const r = await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'e2e vocab-w2' } });
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: r.data.token }, null, 1));
    const res = []; for (const [q, want] of FINDS) { const g = await god('find', ...q.split(' ')); const top = g.out.split('\n')[1]?.split(' ')[0]; res.push({ q, top, ok: top === want }); }
    return { found: res.filter((x) => x.ok).length, miss: res.filter((x) => !x.ok) };
  }, (r) => r.found === FINDS.length);
  await step('G1 the categories list their types; `find --has comp:sound` finds the sound layer', async () => {
    const res = {}; for (const c of CATS) { const g = await god('catalog', '--category', c); res[c] = g.out.split('\n').filter((l) => /^core\//.test(l.trim())).length; }
    const s = await god('find', '--has', 'comp:sound'); res.sound = s.out.split('\n').filter((l) => /^core\//.test(l.trim())).length;
    return res;
  }, (r) => Object.entries(r).every(([k, n]) => n >= (k === 'sound' ? 10 : 2)));
  await step('G2 every type places by name (rows, variants, afloat on a lake, paths and areas)', async () => {
    const res = [], put = async (label, ...a) => { const g = await god(...a); res.push({ n: label, ok: ok(g), out: (g.out + g.err).slice(0, 200) }); };
    await put('lake', 'place', 'lake', '--rect', `${LAKE.x},${LAKE.z},${LAKE.w},${LAKE.d}`, '--name', 'lake', '--param', 'depth=2');
    for (const row of ROWS) { let x = -((row.names.length - 1) * row.gap) / 2; for (const n of row.names) { await put(n, 'place', n, '--at', `${x},${row.z}`, '--facing', 's', '--name', `show-${n}`, '--nudge', ...(row.params ?? []).flatMap((p) => ['--param', p])); x += row.gap; } }
    let x = -((VARIANTS.length - 1) * 12) / 2; for (const [n, p] of VARIANTS) { await put(`${n} ${p}`, 'place', n, '--at', `${x},10`, '--facing', 's', '--name', `var-${n}-${p.split('=')[1]}`, '--param', p, '--nudge'); x += 12; }
    for (const [n, dx] of AFLOAT) await put(`${n} afloat`, 'place', n, '--at', `${LAKE.x + dx},${LAKE.z}`, '--facing', 's', '--name', `show-${n}`, ...(['swan', 'otter'].includes(n) ? ['--param', 'radius=1', '--param', 'speed=0.1'] : []));
    for (const [n, path] of PATHS) await put(n, 'place', n, '--path', JSON.stringify(path), '--name', `path-${n}`);
    for (const [n, rect] of AREAS) await put(n, 'place', n, '--rect', rect, '--name', `area-${n}`);
    return { placed: res.filter((r) => r.ok).length, total: res.length, failed: res.filter((r) => !r.ok) };
  }, (r) => r.placed === r.total);
  await step('G3 states: car door open, helicopter/plane/crane started, fountain off then on, bell rung, speaker playing, dumpster open', async () => {
    const out = [];
    for (const [n, st] of [['show-family-car', '{"open":true}'], ['show-helicopter', '{"on":true}'], ['show-small-plane', '{"on":true}'], ['show-crane', '{"on":true}'], ['show-dumpster', '{"open":true}'], ['show-speaker', '{"playing":true}'], ['show-bell', '{"playing":true}']]) { const g = await god('set', n, '--state', st); out.push({ n, ok: ok(g), state: (await ent(n))?.state }); }
    return out;
  }, (r) => r.every((x) => x.ok && x.state));

  if (chromium && !args['no-viewer']) for (const dpr of dprs) {
    const release = await chromeLease('vocab-w2-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await god('time', '11:00'); await god('weather', '--kind', 'clear');
      await page.goto(`${base}?dev=1&assets=eager`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      const look = (eye, at) => page.evaluate(([e, a]) => { const s = window.__soulsEntity; if (!s) return false; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.controls.update?.(); return true; }, [eye, at]);
      const snap = async (name) => { const f = resolve(out, `${name}-${d}.png`); await page.screenshot({ path: f }); report.shots.push(f); log(`  📷 ${name}-${d}.png`); };
      const drawn = () => page.evaluate(() => { const L = window.__soulsEntity?.layer; return L ? { active: !!L.active, drawn: L.drawn?.size ?? null } : null; });
      const snapE = async () => (await api('/v1/world/snapshot')).data.entities ?? [];
      const posOf = (es, name) => { const e = es.find((x) => x.name === name); return e ? (e.p ?? [0, 0, 0]) : null; };
      await step(`V1[${d}] the viewer draws every new type (no page errors)`, async () => {
        let s; for (let i = 0; i < 90; i++) { s = await drawn(); if (s?.active && s.drawn > 60) break; await sleep(1000); }
        await sleep(4000);
        for (let i = 0; i < 3 && (await page.evaluate(() => document.querySelector('canvas')?.dataset.cameraMode)) !== 'manual'; i++) { await setCameraMode(page, 'manual'); await sleep(600); }
        return { ...s, errors };
      }, (r) => r?.active && !r.errors.length);
      if (dpr === dprs[0]) await step(`S1[${d}] the sound layer: heard near, silent far; off silences; the speaker only while playing`, async () => {
        await page.mouse.click(676, 390);   // the gesture that unlocks audio
        await page.evaluate(() => window.__edenSound?.unlock?.());
        const es = await snapE(), st = () => page.evaluate(() => window.__edenSound?.state());
        const near = async (name, dy = 2) => { const p = posOf(es, name); await look([p[0] + 2, (p.length === 3 ? p[1] : 0) + dy, p[2] + 3], [p[0], 0.5, p[2]]); await sleep(900); const s = await st(); return { ctx: s.ctx, heard: s.heard.map((h) => `${h.kind}:${h.gain.toFixed(2)}`).join(' '), voices: s.voices.length, id: es.find((x) => x.name === name)?.id, ids: s.heard.map((h) => h.id) }; };
        const r = { emitters: (await st())?.emitters?.length };
        r.fountain = await near('show-tiered-fountain'); r.campfire = await near('show-campfire'); r.bird = await near('show-sound-emitter'); r.speaker = await near('show-speaker');
        const sp = posOf(es, 'path-stream'); await look([72, 3, 22], [70, 0, 20]); await sleep(900); r.stream = (await st()).heard.map((h) => h.kind);
        await look([0, 300, 900], [0, 0, 0]); await sleep(900); r.far = (await st()).heard.length;
        await god('set', 'show-tiered-fountain', '--state', '{"on":false}'); await sleep(2600); r.fountainOff = await near('show-tiered-fountain');
        await god('set', 'show-tiered-fountain', '--state', '{"on":true}'); await god('set', 'show-speaker', '--state', '{"playing":false}'); await sleep(2600); r.speakerOff = await near('show-speaker');
        void sp; return r;
      }, (r) => r.emitters >= 10 && r.fountain.ids.includes(r.fountain.id) && r.campfire.ids.includes(r.campfire.id) && r.bird.ids.includes(r.bird.id) && r.speaker.ids.includes(r.speaker.id) && r.stream.includes('stream') && r.far === 0 && !r.fountainOff.ids.includes(r.fountainOff.id) && !r.speakerOff.ids.includes(r.speakerOff.id));
      await step(`V2[${d}] a close-up of every new type and variant framed by its size; the lake, the paths and areas`, async () => {
        await page.evaluate(() => { const t = [...document.querySelectorAll('*')].find((e) => e.textContent?.trim().startsWith('Join this world as a Soul') && e.children.length < 3); let n = t; while (n && n.parentElement && getComputedStyle(n).position !== 'fixed' && getComputedStyle(n).position !== 'absolute') n = n.parentElement; if (n) n.style.display = 'none'; });
        const sizes = {}; for (const line of String((await api('/v1/god/catalog?format=lines&per=2000', { token: JSON.parse(readFileSync(resolve(godDir, '.eden-god.json'), 'utf8')).token })).data).split('\n')) { const m = /^(core\/[\w-]+)@1 \[[^\]]+\] ([\d.]+)×([\d.]+)×([\d.]+)m/.exec(line.trim()); if (m) sizes[m[1].slice(5)] = [+m[2], +m[3], +m[4]]; }
        const snap0 = await snapE();
        const names = [...ROWS.flatMap((r) => r.names.map((n) => [`show-${n}`, n])), ...AFLOAT.map(([n]) => [`show-${n}`, n]), ...VARIANTS.map(([n, p]) => [`var-${n}-${p.split('=')[1]}`, n])];
        const missing = [];
        for (const [en, n] of names) {
          const e = snap0.find((x) => x.name === en); if (!e) { missing.push(en); continue; }
          const [w, h, dd] = sizes[n] ?? [2, 2, 2], R = Math.max(w, h, dd, 0.25), dist = R * 1.25 + 0.3, p = e.p ?? [0, 0, 0], py = p.length === 3 ? p[1] : 0, pz = p.length === 3 ? p[2] : p[1];
          await look([p[0] + dist * 0.55, py + h * 0.55 + dist * 0.45, pz + dist], [p[0], py + h * 0.4, pz]); await sleep(1100); await snap(`c-${en}`);
        }
        await look([0, 30, -30], [0, 0, -70]); await sleep(2000); await snap('lake');
        await look([0, 14, -112], [0, 0, -132]); await sleep(2000); await snap('paths');
        await look([-50, 14, -84], [-50, 0, -100]); await sleep(2000); await snap('wetland');
        await look([40, 25, -75], [40, 0, -100]); await sleep(2000); await snap('reservoir');
        await look([82, 10, 10], [70, 0, 30]); await sleep(2000); await snap('stream');
        { const es = snap0.filter((x) => /streetlight/.test(x.name ?? '')); for (const e of es) { const p = e.p; await look([p[0] + 4, 9.5, (p.length === 3 ? p[2] : p[1]) + 5], [p[0], 7.6, p.length === 3 ? p[2] : p[1]]); await sleep(1000); await snap(`top-${e.name}`); } }
        return { errors, missing, sized: Object.keys(sizes).length };
      }, (r) => !r.errors.length && !r.missing.length);
    } finally { await browser.close(); await release(); }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const ok = report.steps.filter((s) => s.ok).length;
  writeFileSync(resolve(out, 'REPORT.md'), [`# VOCAB-W2 e2e ${stamp}`, `${ok}/${report.steps.length} steps passed on :${port}`, '', ...report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`), '', '## Shots', ...report.shots.map((f) => `- ${f}`)].join('\n') + '\n');
  log(`\n${ok}/${report.steps.length} passed — ${out}`);
  if (!args.keep) { try { server?.kill(); } catch { } }
  process.exit(report.failures.length ? 1 : 0);
}
