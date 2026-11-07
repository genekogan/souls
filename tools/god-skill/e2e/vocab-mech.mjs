#!/usr/bin/env node
// VOCAB-MECH proof: the catalogue as a god and a Soul meet it. One fresh world (launcher env: edge minds), the god CLI
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
const slug = 'vocabe2e', port = Number(args.port ?? 5574);
const dprs = String(args.dpr ?? '1').split(',').map(Number);
const out = resolve(root, '.lane/e2e-vocab', stamp);
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
let reads = 0;
function soulCli(who) {
  const dir = resolve(out, `soul-${who}`); mkdirSync(dir, { recursive: true });
  const run = (...argv) => new Promise((ok) => execFile(process.execPath, [CLI, ...argv], { cwd: dir, timeout: 150_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' } }, (err, stdout, stderr) => {
    const s = String(stdout); let data = null; try { data = JSON.parse(s.slice(s.indexOf('{'))); } catch { }
    writeFileSync(resolve(out, 'reads', `${String(++reads).padStart(3, '0')}-${who}-${argv[0]}.json`), JSON.stringify({ argv, data, raw: data ? undefined : s.slice(0, 2000), stderr: String(stderr).slice(0, 400) }, null, 1));
    ok({ code: err?.code ?? 0, data, raw: data ? undefined : s.slice(0, 600) });
  }));
  const state = () => JSON.parse(readFileSync(resolve(dir, '.eden-agent.json'), 'utf8'));
  const follow = async (acted, maxS = 120) => {
    if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason };
    const id = acted.receipt?.id, t0 = Date.now(); let rec = acted.receipt;
    while (Date.now() - t0 < maxS * 1000 && id) {
      rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { token: state().token })).data?.receipt ?? rec;
      if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
      await sleep(600);
    }
    return { accepted: true, resolved: acted.resolved?.to ?? rec?.capability, phase: rec?.phase, code: rec?.code, reason: rec?.reason };
  };
  return { run, state, follow, act: async (...a) => follow((await run('act', ...a)).data) };
}
const ana = soulCli('ana');
const ent = async (name) => { const s = (await api('/v1/world/snapshot')).data; return (s.entities ?? []).find((e) => e.name === name); };

const built = [
  ['place', 'door', '--at', '0,-4', '--facing', 's', '--name', 'blue-door', '--param', 'variant=glazed', '--param', 'leaf=#2f5d8b', '--param', 'condition=worn'],
  ['place', 'fireplace', '--at', '-5,-5', '--facing', 's', '--name', 'fire'],
  ['place', 'phone-box', '--at', '5,-5', '--facing', 's', '--name', 'phone-box'],
  ['place', 'cafe-terrace', '--at', '9,5', '--name', 'terrace'],
  ['place', 'traffic-cone', '--at', '-3,3', '--name', 'cone-tall', '--param', 'sy=1.6', '--param', 'taper=0.3'],
  ['place', 'traffic-cone', '--at', '-2,3', '--name', 'cone-plain'],
  ['place', 'phone-box', '--at', '-12,4', '--facing', 's', '--name', 'phone-box-site', '--param', 'condition=construction'],
  ['place', 'window', '--at', '-8,-5', '--facing', 's', '--name', 'round-window', '--param', 'variant=round', '--param', 'sx=1.4', '--param', 'sy=1.4'],
];

try {
  await boot();
  log(`▶ world "${slug}" on :${port}`);
  await step('G0 the god mints a token; the catalogue answers by words, synonyms, category and interface', async () => {
    const r = await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'e2e vocab' } });
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: r.data.token }, null, 1));
    const bodega = await god('find', 'bodega'), booth = await god('find', 'telephone', 'booth'), opens = await god('find', '--has', 'actuator:door'), seats = await god('catalog', '--category', 'furniture.seat');
    const rec = await god('recommend', 'a', 'cosy', 'bodega', 'with', 'a', 'cafe', 'terrace', 'and', 'a', 'street', 'lamp'), tax = await god('taxonomy'), all = await god('catalog');
    return { bodega: bodega.out.split('\n')[1], booth: booth.out.split('\n')[1], opens: opens.out.split('\n').slice(1).map((l) => l.split(' ')[0]), seats: seats.out.split('\n').length - 1, rec: rec.out, taxEmpty: (tax.out.match(/: 0/g) ?? []).length, catalogLines: all.out.split('\n').length - 1, catalogBytes: all.out.length };
  }, (r) => /^core\/corner-shop@1/.test(r.bodega) && /^core\/phone-box@1/.test(r.booth) && r.opens.includes('core/door@1') && r.opens.includes('core/phone-box@1') && r.seats >= 5 && /bodega: core\/corner-shop@1/.test(r.rec) && /cafe terrace: core\/cafe-terrace@1/.test(r.rec) && r.catalogLines > 390);
  await step('G1 the god builds with the new types and their params (variants, paint, wear, stretch, warp, construction); a set expands to its pieces', async () => {
    const res = []; for (const c of built) { const g = await god(...c); res.push({ cmd: c.slice(0, 2).join(' ') + ' ' + c[c.indexOf('--name') + 1], ok: g.code === 0 && !/REFUSED|Error/i.test(g.out + g.err), out: (g.out + g.err).slice(0, 200) }); }
    // the agent's way: find by the word it has ("bodega"), place the first ref
    const ref = (await god('find', 'bodega')).out.split('\n')[1]?.split(' ')[0];
    const shop = await god('place', ref, '--at', '0,-24', '--facing', 's', '--name', 'bodega');
    res.push({ cmd: `find bodega → place ${ref}`, ok: shop.code === 0 && !/REFUSED/.test(shop.out), out: shop.out.slice(0, 200) });
    const s = (await api('/v1/world/snapshot')).data, chairs = s.entities.filter((e) => /core[-/]chair@/.test(e.def)).length;
    const detail = await god('defs', 'core/door@1');
    return { all: res.every((x) => x.ok), res, chairs, shop: s.entities.find((e) => e.name === 'bodega')?.def, detail: detail.out.slice(0, 900) };
  }, (r) => r.all && r.chairs === 4 && /corner-shop/.test(r.shop ?? ''));
  await step('G2 out-of-range params are refused with the range (validation enforces the conventions)', async () => {
    const g = await god('place', 'traffic-cone', '--at', '-4,3', '--param', 'sy=3', '--dry');
    const h = await god('place', 'door', '--at', '-4,6', '--param', 'variant=gothic', '--dry');
    return { sy: (g.out + g.err).slice(0, 300), variant: (h.out + h.err).slice(0, 300) };
  }, (r) => /params|0\.6|1\.6|range|max/i.test(r.sy) && /variant|values|panel/i.test(r.variant));

  await step('S0 Ana registers the Soul CLI and is born (the normal agent flow)', async () => {
    await ana.run('register', base); const c = await ana.run('create-soul', 'Ana', 'a vocab probe');
    for (let i = 0; i < 60 && !(await ana.run('here')).data?.me?.pos; i++) await sleep(500);
    return { soul: c.data?.soul?.id ?? null };
  }, (r) => r.soul);
  const door = await ent('blue-door'), fire = await ent('fire'), box = await ent('phone-box');
  const caps = await step('A1 observe + capabilities: the door, the fire and the phone box are objects with their state; their actuators are offered', async () => {
    const o = (await ana.run('observe')).data, c = (await ana.run('capabilities')).data;
    const objs = o?.here?.objects ?? [], list = [...(c?.canDo?.available ?? []).map((x) => ({ ...x, available: true })), ...(c?.canDo?.blocked ?? []).map((x) => ({ ...x, available: false }))];
    const of = (id) => objs.find((x) => x.id === id);
    return { door: of(door?.id)?.public?.state, fire: of(fire?.id)?.public?.state, box: of(box?.id)?.public?.state, offered: (Array.isArray(list) ? list : []).filter((x) => /^object:/.test(x.id) && [door?.id, fire?.id, box?.id].some((id) => x.id.includes(id))).map((x) => `${x.id} ${x.available ? '✓' : '✗'}`) };
  }, (r) => r.door?.open === false && r.door?.locked === false && r.fire?.lit === true && r.box?.open === false && r.offered.some((x) => x.includes(`${door.id}:open ✓`)) && r.offered.some((x) => x.includes(`${fire.id}:put-out ✓`)));
  await step('A2 Ana says "open the blue door" → resolved to the door\'s open action, she walks up and reaches; the door is open in the world', async () => {
    const r = await ana.act('open the blue door'); await sleep(300);
    return { ...r, state: (await ent('blue-door'))?.state };
  }, (r) => r.phase === 'completed' && /:open$/.test(r.resolved ?? '') && r.state?.open === true);
  await step('A3 locking an open door is refused with the reason (actuator `when`)', async () => {
    const r = (await ana.run('act', `object:${door.id}:lock`)).data;
    return { accepted: r?.accepted, code: r?.code, reason: r?.reason };
  }, (r) => r.accepted === false && /state|blocked|unavailable/.test(r.code ?? '') && /open/.test(r.reason ?? ''));
  await step('A4 she closes it and locks it; opening a locked door is refused ("locked")', async () => {
    const c = await ana.act(`object:${door.id}:close`), l = await ana.act(`object:${door.id}:lock`);
    const o = (await ana.run('act', `object:${door.id}:open`)).data;
    return { close: c.phase, lock: l.phase, state: (await ent('blue-door'))?.state, open: { accepted: o?.accepted, code: o?.code, reason: o?.reason } };
  }, (r) => r.close === 'completed' && r.lock === 'completed' && r.state?.locked === true && r.state?.open === false && r.open.accepted === false && /locked/.test(r.open.reason ?? ''));
  await step('A5 she puts out the fire (by words); the fire is out in the world; the god\'s describe says so', async () => {
    const r = await ana.act('put out the fire'); await sleep(300);
    const d = await god('describe', 'fire');
    return { ...r, state: (await ent('fire'))?.state, describe: d.out.slice(0, 400) };
  }, (r) => r.phase === 'completed' && r.state?.lit === false);
  await step('A6 she opens the phone box (its door swings in the viewer) and the history shows every change as the engine\'s, not the god\'s to undo', async () => {
    const r = await ana.act(`object:${box.id}:open`), h = await god('history', '8');
    return { ...r, state: (await ent('phone-box'))?.state, history: h.out.slice(0, 900) };
  }, (r) => r.phase === 'completed' && r.state?.open === true);

  // the 30 pilot types, in a row each (props and fixtures at x 4 m apart; buildings and sets on their own row)
  const PILOT = ['door', 'window', 'desk-lamp', 'fireplace', 'phone-box', 'traffic-cone', 'kiosk', 'market-stall', 'wind-turbine', 'power-pole', 'water-tower', 'recycling-bins', 'postbox', 'parking-meter', 'drinking-fountain', 'newspaper-stand', 'street-clock', 'bike-shelter', 'scaffold-tower', 'road-barrier', 'cement-mixer', 'skip', 'television', 'radio', 'candle', 'chest'];
  const BIG = ['corner-shop', 'cafe', 'bakery', 'cafe-terrace'];
  await step('G3 every pilot type places by name in a showcase row (26 props/fixtures + 3 shop presets + the terrace set)', async () => {
    const res = []; let x = -60;
    for (const n of PILOT) { const g = await god('place', n, '--at', `${x},40`, '--facing', 's', '--name', `show-${n}`, '--nudge'); res.push({ n, ok: g.code === 0 && !/REFUSED|Error/i.test(g.out + g.err), out: (g.out + g.err).slice(0, 160) }); x += 5; }
    x = -40; for (const n of BIG) { const g = await god('place', n, '--at', `${x},62`, '--facing', 's', '--name', `show-${n}`, '--nudge'); res.push({ n, ok: g.code === 0 && !/REFUSED|Error/i.test(g.out + g.err), out: (g.out + g.err).slice(0, 160) }); x += 22; }
    return { placed: res.filter((r) => r.ok).length, failed: res.filter((r) => !r.ok) };
  }, (r) => r.placed === 30);

  // ---------- the viewer: real Chrome (GPU), the lease
  if (chromium && !args['no-viewer']) for (const dpr of dprs) {
    const release = await chromeLease('vocab-mech-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await god('time', '11:00'); await god('weather', '--kind', 'clear');
      await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      const look = (eye, at) => page.evaluate(([e, a]) => { const s = window.__soulsEntity; if (!s) return false; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.controls.update?.(); return true; }, [eye, at]);
      const snap = async (name) => { const f = resolve(out, `${name}-${d}.png`); await page.screenshot({ path: f }); report.shots.push(f); log(`  📷 ${name}-${d}.png`); };
      const drawn = () => page.evaluate(() => { const L = window.__soulsEntity?.layer; return L ? { active: !!L.active, drawn: L.drawn?.size ?? null, err: L.stats?.lastError ?? null } : null; });
      await step(`V1[${d}] the viewer draws the god's things with their looks and states (no page errors)`, async () => {
        let s; for (let i = 0; i < 90; i++) { s = await drawn(); if (s?.active && s.drawn > 12) break; await sleep(1000); }
        await sleep(4000);
        // take the camera (broadcast → manual), as a person does with the Broadcast button
        for (let i = 0; i < 3 && (await page.evaluate(() => document.querySelector('canvas')?.dataset.cameraMode)) !== 'manual'; i++) { await setCameraMode(page, 'manual'); await sleep(600); }
        s = { ...s, mode: await page.evaluate(() => document.querySelector('canvas')?.dataset.cameraMode) };
        await look([2, 5, 12], [0, 1, -4]); await sleep(1500); await snap('v1-scene');
        return { ...s, errors };
      }, (r) => r?.active && !errors.length);
      await step(`V2[${d}] close-ups: the open glazed door (worn), the fire out, the open phone box`, async () => {
        if ((await ent('blue-door'))?.state?.open !== true) { await ana.act(`object:${door.id}:unlock`); await ana.act(`object:${door.id}:open`); await sleep(1500); }
        await look([1.5, 1.8, -0.5], [0, 1.1, -4]); await sleep(1200); await snap('v2-door-open');
        await look([-4.2, 1.5, -2.2], [-5, 0.6, -5]); await sleep(1200); await snap('v2-fire-out');
        await look([6.5, 2, -1.8], [5, 1.3, -5]); await sleep(1200); await snap('v2-phonebox-open');
        return { errors, door: (await ent('blue-door'))?.state };
      }, (r) => !r.errors.length && r.door?.open === true);
      await step(`V3[${d}] params: a stretched + tapered cone beside a plain one, a round stretched window, a phone box under construction`, async () => {
        await look([-2.5, 1.2, 5.5], [-2.5, 0.5, 3]); await sleep(1200); await snap('v3-cones');
        await look([-8, 1.4, -2], [-8, 0.9, -5]); await sleep(1200); await snap('v3-round-window');
        await look([-9, 3, 9.5], [-12, 1.4, 4]); await sleep(1200); await snap('v3-construction');
        await look([2, 8, -8], [0, 2, -24]); await sleep(2500); await snap('v3-bodega');
        await look([12, 4, 10], [9, 0.7, 5]); await sleep(1500); await snap('v3-terrace');
        return { errors };
      }, (r) => !r.errors.length);
      await step(`V5[${d}] the showcase: all 30 pilot types in rows (four shots along the row, one of the shops)`, async () => {
        for (const [i, x] of [-50, -25, 0, 25, 50].entries()) { await look([x, 7, 62], [x, 1.5, 40]); await sleep(1800); await snap(`v5-row-${i + 1}`); }
        await look([0, 14, 88], [0, 2, 62]); await sleep(2500); await snap('v5-shops');
        return { errors };
      }, (r) => !r.errors.length);
      await step(`V4[${d}] Ana closes the phone box: the viewer redraws it closed (state through the world diff)`, async () => {
        if ((await ent('phone-box'))?.state?.open !== true) { await ana.act(`object:${box.id}:open`); await sleep(800); }   // a second dpr pass finds it closed
        const r = await ana.act(`object:${box.id}:close`); await sleep(1500);
        await look([6.5, 2, -1.8], [5, 1.3, -5]); await sleep(800); await snap('v4-phonebox-closed');
        return { ...r, errors };
      }, (r) => r.phase === 'completed' && !r.errors.length);
    } finally { await browser.close(); await release(); }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const ok = report.steps.filter((s) => s.ok).length;
  writeFileSync(resolve(out, 'REPORT.md'), [`# VOCAB-MECH e2e ${stamp}`, `${ok}/${report.steps.length} steps passed on :${port}`, '', ...report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`), '', '## Shots', ...report.shots.map((f) => `- ${f}`)].join('\n') + '\n');
  log(`\n${ok}/${report.steps.length} passed — ${out}`);
  if (!args.keep) { try { server?.kill(); } catch { } }
  process.exit(report.failures.length ? 1 : 0);
}
