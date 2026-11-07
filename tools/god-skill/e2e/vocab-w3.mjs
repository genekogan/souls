#!/usr/bin/env node
// VOCAB-W3 proof: furnished buildings as a god and Souls meet them (harness after vocab-w1.mjs). One fresh world (edge
// minds), the god CLI and the UNCHANGED Soul CLI (tools/edge-skill/eden-agent.mjs):
//   the GOD finds every type by an everyday word; the building categories list them; `place <type>` puts down a
//   furnished building in ONE op (its contents land in its rooms, each its own entity) with its LAYERS defaults
//   (opening hours, owner placeholder, prices on counters) which the god can override;
//   Souls ANA and BEN walk into a sample of them and use a slot: sit at the café table, on the sofa at home, in a pew,
//   at a school desk, in the theatre stalls, on a hospital bed's edge; Ana buys a coffee at the café counter (wallets
//   move); Ben opens a police cell door;
//   the VIEWER (real Chrome, GPU) draws each building outside and in (cutaway per floor) at dpr 1 and 2.
//
//   node tools/god-skill/e2e/vocab-w3.mjs [--port 5750] [--keep] [--dpr 1,2] [--no-viewer] [--no-souls] [--only cafe,house]
//
// Report under .lane/e2e-vocab-w3/<stamp>/ (report.json, REPORT.md, shots, every CLI read under reads/).
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
const slug = 'vocabw3', port = Number(args.port ?? 5750);
const dprs = String(args.dpr ?? '1').split(',').map(Number);
const out = resolve(root, '.lane/e2e-vocab-w3', stamp);
mkdirSync(resolve(out, 'reads'), { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], failures: [], shots: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test: viewer steps skipped)'); }
const W3 = JSON.parse(readFileSync(resolve(root, 'packages/world-compiler/src/core-kit/vocab-w3.json'), 'utf8'));
const defOf = (n) => W3.find((d) => d.name === `core-${n}`);

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
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = performance.now() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = (() => { try { const s = JSON.stringify(result); return s && s.length > 4000 ? JSON.parse(JSON.stringify(result, (k, v) => (Array.isArray(v) && v.length > 40 ? `[${v.length} items]` : typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + '…' : v))) : result; } catch { return String(result); } })();
  report.steps.push({ name, ms: Math.round(ms), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 900)}`);
  return result;
}

const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const godDir = resolve(out, 'god-cli'); mkdirSync(godDir, { recursive: true });
let reads = 0;
const god = (...argv) => new Promise((ok) => execFile(process.execPath, [GOD, ...argv], { cwd: godDir, timeout: 180_000, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }, (err, stdout, stderr) => { writeFileSync(resolve(out, 'reads', `${String(++reads).padStart(3, '0')}-god-${argv[0]}.txt`), `$ eden-god ${argv.join(' ')}\n${stdout}${stderr}`); ok({ code: err?.code ?? 0, out: String(stdout), err: String(stderr).slice(0, 400) }); }));
const okG = (g) => g.code === 0 && !/REFUSED|Error/i.test(g.out + g.err);
function soulCli(who) {
  const dir = resolve(out, `soul-${who}`); mkdirSync(dir, { recursive: true });
  const run = (...argv) => new Promise((ok) => execFile(process.execPath, [CLI, ...argv], { cwd: dir, timeout: 150_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' } }, (err, stdout, stderr) => {
    const s = String(stdout); let data = null; try { data = JSON.parse(s.slice(s.indexOf('{'))); } catch { }
    writeFileSync(resolve(out, 'reads', `${String(++reads).padStart(3, '0')}-${who}-${argv[0]}.json`), JSON.stringify({ argv, data, raw: data ? undefined : s.slice(0, 2000), stderr: String(stderr).slice(0, 400) }, null, 1));
    ok({ code: err?.code ?? 0, data, raw: data ? undefined : s.slice(0, 400) });
  }));
  const token = () => JSON.parse(readFileSync(resolve(dir, '.eden-agent.json'), 'utf8')).token;
  return { run, token };
}
const snapshot = async () => (await api('/v1/world/snapshot')).data;
const until = async (fn, ms = 20_000, every = 700) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v?.ok) return v; await sleep(every); } return v; };

// the types, in rows near the origin (Souls use the first rows); [name, x, z]
const ROWS = [
  { z: 30, names: ['cafe', 'house', 'church', 'school', 'theatre', 'hospital', 'police-station', 'bar'] },
  { z: -30, names: ['corner-shop', 'restaurant', 'bank', 'office-block', 'garage', 'petrol-station', 'supermarket', 'mall'] },
  { z: 90, names: ['apartment-block', 'townhouse-row', 'cabin', 'mansion', 'dormitory', 'hotel', 'mobile-home', 'library'] },
  { z: -95, names: ['town-hall', 'fire-station', 'prison', 'museum', 'campground', 'cemetery', 'playground', 'sports-court-set'] },
];
const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const PLACED = [];
// rows centred on the origin (Souls are born near 0,0; walk:<place> is offered within ~100 m)
for (const r of ROWS) { const ns = r.names.filter((n) => !only || only.has(n)); const tot = ns.reduce((a, n) => a + defOf(n).size.box[0] + 8, -8); let x = -tot / 2; for (const n of ns) { const w = defOf(n).size.box[0]; PLACED.push({ n, x: x + w / 2, z: r.z }); x += w + 8; } }
if (!only || only.has('stadium')) PLACED.push({ n: 'stadium', x: 0, z: 190 });
const FINDS = [['block of flats', 'apartment-block'], ['pub', 'bar'], ['gas station', 'petrol-station'], ['firehouse', 'fire-station'], ['gaol', 'prison'], ['loo', 'toilet'], ['gondola', 'shop-shelving'],
  ['vitrine', 'display-case'], ['tombstone', 'gravestone'], ['grandstand', 'bleachers'], ['tip-up seats', 'theatre-seats'], ['trailer home', 'mobile-home'], ['manor', 'mansion'], ['playhouse', 'theatre'],
  ['graveyard', 'cemetery'], ['campsite', 'campground'], ['play area', 'playground'], ['diner', 'restaurant'], ['condo', 'apartment-block'], ['hostel', 'dormitory'], ['swivel chair', 'office-chair'],
  ['bodega', 'corner-shop'], ['coffee shop', 'cafe'], ['sanatorium', 'hospital'], ['precinct', 'police-station'], ['log cabin', 'cabin'], ['terraced houses', 'townhouse-row'], ['motel', 'hotel'],
  ['superstore', 'supermarket'], ['shopping centre', 'mall'], ['auto repair', 'garage'], ['headquarters', 'office-block'], ['vault', 'vault-door'], ['pupil desk', 'school-desk'], ['whiteboard', 'wall-board'], ['petrol pump', 'fuel-pump']];

try {
  await boot();
  log(`▶ world "${slug}" on :${port}`);
  await step('G0 the god mints a token; every new type is found first by an everyday word (find)', async () => {
    const r = await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'e2e vocab-w3' } });
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: r.data.token }, null, 1));
    const res = []; for (const [q, want] of FINDS) { const g = await god('find', ...q.split(' ')); const top = g.out.split('\n')[1]?.trim().split(' ')[0]; res.push({ q, top, ok: top === `core/${want}@1` }); }
    return { found: res.filter((x) => x.ok).length, of: FINDS.length, miss: res.filter((x) => !x.ok) };
  }, (r) => r.found === r.of);
  await step('G1 the building categories list the furnished types (catalog --category)', async () => {
    const res = {}; for (const c of ['building.residential', 'building.commercial', 'building.civic', 'furniture.bath', 'public.sport']) { const g = await god('catalog', '--category', c); res[c] = g.out.split('\n').filter((l) => /^core\//.test(l.trim())).length; }
    return res;
  }, (r) => r['building.residential'] >= 8 && r['building.commercial'] >= 10 && r['building.civic'] >= 8 && r['furniture.bath'] >= 4 && r['public.sport'] >= 4);
  await step('G2 each type is ONE place op: the building lands with its furniture in its rooms and its LAYERS defaults', async () => {
    await god('expand', '600');
    const res = [];
    for (const p of PLACED) { const g = await god('place', p.n, '--at', `${p.x},${p.z}`, '--facing', 's', '--name', p.n); res.push({ n: p.n, ok: okG(g), out: okG(g) ? undefined : (g.out + g.err).slice(0, 300) }); }
    const s = await snapshot(), ents = s.entities ?? [];
    for (const r of res) {
      const b = ents.find((e) => e.name === r.n && e.in?.parent === 'world'); const d = defOf(r.n);
      const kids = b ? ents.filter((e) => e.in?.parent === b.id) : [];
      const all = b ? (function count(id) { const k = ents.filter((e) => e.in?.parent === id); return k.length + k.reduce((n, e) => n + count(e.id), 0); })(b.id) : 0;
      Object.assign(r, { children: kids.length, all, want: (d.contents ?? d.make?.parts ?? []).length, schedule: !!b?.schedule, owner: b?.owner ?? null, prices: ents.filter((e) => e.price && (e.in?.parent === b?.id || kids.some((k) => k.id === e.in?.parent))).map((e) => `${e.name}:${e.price.amount}${e.price.service ? ` ${e.price.service}` : ''}`) });
    }
    return { placed: res.filter((r) => r.ok && r.all >= r.want).length, total: res.length, entities: ents.length, res };
  }, (r) => r.placed === r.total);
  await step('G3 the defaults read back and the god overrides them (cafe hours → 06:00–14:00; house owner → group:smiths, private)', async () => {
    const a = await god('layers'), h = await god('hours', 'cafe', '--open', '06:00-14:00');
    const o = await god('own', 'house', 'group:smiths', '--private');
    const s = await snapshot(), cafe = s.entities.find((e) => e.name === 'cafe' && e.in?.parent === 'world'), house = s.entities.find((e) => e.name === 'house' && e.in?.parent === 'world');
    const back = await god('own', 'house', 'god', '--public');
    return { layers: a.out.split('\n').slice(0, 12), setOk: okG(h) && okG(o) && okG(back), cafeHours: cafe?.schedule?.open?.[0], houseOwner: house?.owner, houseAccess: house?.access };
  }, (r) => r.setOk && r.cafeHours?.from === '06:00' && r.houseOwner === 'group:smiths' && r.houseAccess === 'private');

  if (!args['no-souls']) {
    const ana = soulCli('ana'), ben = soulCli('ben');
    await step('S0 two owners register the Soul CLI and create Souls Ana and Ben; the god gives them coins', async () => {
      const o = {};
      for (const [who, cli, name] of [['ana', ana, 'Ana'], ['ben', ben, 'Ben']]) { await cli.run('register', base); const c = await cli.run('create-soul', name, 'a furnished-buildings probe'); o[who] = c.data?.soul?.id ?? null; }
      await until(async () => ({ ok: !!(await ana.run('here')).data?.me?.pos }), 40_000);
      const cur = await god('currency', 'coins'), g1 = await god('give', 'Ana', '10'), g2 = await god('give', 'Ben', '10');
      return { ...o, coins: okG(cur) && okG(g1) && okG(g2), anaAt: (await ana.run('here')).data?.me?.pos };
    }, (r) => r.ana && r.ben && r.coins);
    const ents = (await snapshot()).entities ?? [];
    const childOf = (bn, pred) => { const b = ents.find((e) => e.name === bn && e.in?.parent === 'world'); if (!b) return null; const desc = []; const walk = (id) => { for (const e of ents.filter((x) => x.in?.parent === id)) { desc.push(e); walk(e.id); } }; walk(b.id); return desc.find(pred) ?? null; };
    const observe = async (cli) => (await api('/v1/edge/observe', { token: cli.token() })).data;
    const caps = async (cli) => (await api('/v1/edge/observe?include=capabilities', { token: cli.token() })).data?.capabilities ?? [];
    /** walk into a room of a building; rooms are offered only within ~80 m (nav ROOMS_WITHIN), so from farther away the
     *  Soul first walks toward the building (any of its offered entries), as a player would, then into the room */
    const goRoom = async (cli, b, room) => {
      let walk = (await cli.run('act', `walk:${b}/${room}`)).data;
      if (walk?.accepted) return walk;
      const near = (await caps(cli)).find((c) => c.available && (c.id === `walk:${b}` || c.id.startsWith(`walk:${b}/`)));
      if (!near) return walk;
      await cli.run('act', near.id, '{}', '--force'); await cli.run('wait', '120');
      await until(async () => ({ ok: (await caps(cli)).some((c) => c.id === `walk:${b}/${room}` && c.available) }), 90_000, 1500);
      return (await cli.run('act', `walk:${b}/${room}`, '{}', '--force')).data;
    };
    /** walk into the building, then sit on the piece (its own sit capability), then stand up */
    const sitIn = async (cli, b, pred, label) => {
      const seat = childOf(b, pred); if (!seat) return { b, label, error: 'no such piece' };
      // a furnished building is offered room by room (walk:<building>/<room>): walk into the piece's room, wait to arrive
      const room = seat.in?.slot ?? ents.find((e) => e.id === seat.in?.parent)?.in?.slot;
      const walk = await goRoom(cli, b, room);
      await cli.run('wait', '120');
      await until(async () => ({ ok: (await caps(cli)).some((c) => c.id === `sit:${seat.id}`) }), 90_000, 1500);
      const cap = (await caps(cli)).find((c) => c.id === `sit:${seat.id}`);
      const act = (await cli.run('act', `sit:${seat.id}`, '{"seconds":30}', '--force')).data;
      const sat = await until(async () => { const o = await observe(cli); const me = o?.self ?? o?.me ?? o; return { ok: /"activity":"sit"/.test(JSON.stringify(o ?? {})), activity: me?.activity, at: me?.position ?? me?.pos }; }, 150_000, 1500);
      await cli.run('act', 'stand:here', '{}', '--force').catch(() => {}); await cli.run('wait', '30');
      return { b, label, seat: seat.name, walk: walk?.accepted ?? walk?.code, offered: cap ? cap.label : null, accepted: act?.accepted ?? act?.code, sat: !!sat?.ok, activity: sat?.activity };
    };
    await step('S1 Ana walks into the café and sits at a table; then buys a coffee at the counter (wallets move)', async () => {
      const r = await sitIn(ana, 'cafe', (e) => /^cafe-chair/.test(e.name), 'a café chair');
      const counter = childOf('cafe', (e) => e.name === 'cafe-counter');
      const offer = (await caps(ana)).find((c) => c.id === `buy:${counter?.id}`);

      const before = (await api('/v1/world/layers/me', { token: ana.token() })).data?.wallet;
      const buy = (await ana.run('act', `buy:${counter?.id}`)).data;
      const after = (await api('/v1/world/layers/me', { token: ana.token() })).data?.wallet;
      return { ...r, buyOffer: offer?.label, buy: buy?.accepted ?? buy?.code ?? buy, bought: buy?.result?.bought ?? buy?.receipt?.result?.bought, before, after };
    }, (r) => r.sat && r.accepted === true && r.buy === true && JSON.stringify(r.after) !== JSON.stringify(r.before));
    const SITS = [[ana, 'house', (e) => e.name === 'living-sofa', 'the living-room sofa'], [ana, 'church', (e) => /^nave-pew/.test(e.name), 'a pew'],
      [ben, 'school', (e) => /^classroom-1-chair/.test(e.name), 'a pupil\'s chair'], [ben, 'hospital', (e) => /^reception-wait/.test(e.name), 'a waiting bench in reception']];
    for (const [cli, b, pred, label] of SITS) await step(`S2 ${cli === ana ? 'Ana' : 'Ben'} walks into the ${b} and sits on ${label}`, () => sitIn(cli, b, pred, label), (r) => r.sat && r.accepted === true);
    await step('S3 Ben walks to the police station and opens a cell door (an actuator inside a furnished building); the world records it', async () => {
      const bars = childOf('police-station', (e) => /^cell-\d-bars|cell-bars/.test(e.name) || /-bars$/.test(e.name));
      // the cell is closed off by its own bars: open them from the office side
      await ben.run('act', 'walk:police-station/office');
      await until(async () => { const h = (await ben.run('here')).data?.me; return { ok: /police-station\/office|g-police-station\.office/.test(JSON.stringify(h?.placePath ?? h?.place ?? '')) }; }, 120_000, 2000);
      const r = (await ben.run('act', `object:${bars?.id}:open`, '{}', '--force')).data;
      const st = await until(async () => { const e = (await api(`/v1/world/entities/${bars?.id}`)).data?.entity; return { ok: e?.state?.open === true, state: e?.state }; }, 60_000, 1500);
      return { bars: bars?.name, act: r?.accepted ?? r?.code, open: st?.ok, state: st?.state };
    }, (r) => r.open);
    // SOULFIX: a bed offers sleep:<bed> (Eden's nap posture on the mattress); then the Soul gets up and walks on
    await step('S5 Ana walks into the house bedroom and sleeps in the bed; she gets up and walks on', async () => {
      const bed = childOf('house', (e) => /^bedroom(-\d)?-bed$/.test(e.name)); if (!bed) return { error: 'no bed' };
      await goRoom(ana, 'house', bed.in?.slot ?? 'bedroom'); await ana.run('wait', '120');
      await until(async () => ({ ok: (await caps(ana)).some((c) => c.id === `sleep:${bed.id}` && c.available) }), 90_000, 1500);
      const cap = (await caps(ana)).find((c) => c.id === `sleep:${bed.id}`);
      const act = (await ana.run('act', `sleep:${bed.id}`, '{"seconds":20}', '--force')).data;
      const slept = await until(async () => { const o = await observe(ana); return { ok: /"activity":"nap"/.test(JSON.stringify(o ?? {})) }; }, 120_000, 1500);
      await ana.run('wait', '30');
      const on = (await ana.run('act', 'walk:house/living', '{}', '--force')).data;
      return { offered: cap?.label, lieOffered: (await caps(ana)).some((c) => c.id === `lie:${bed.id}`), accepted: act?.accepted ?? act?.code, slept: !!slept?.ok, walkOn: on?.accepted ?? on?.code };
    }, (r) => r.accepted === true && r.slept && r.walkOn === true);
    // SOULFIX: furniture upstairs (hospital ward, floor 1) is offered as its storey and reached by the stairs; Ben gets up and walks on
    await step('S6 Ben walks upstairs into a hospital ward and sits on the visitor chair; he gets up and walks on', async () => {
      const r = await sitIn(ben, 'hospital', (e) => /^ward-\d-chair|^ward.*chair/.test(e.name) || (e.name.startsWith('chair') && /ward/.test(JSON.stringify(e.in ?? {}))), 'a ward chair');
      const on = (await ben.run('act', 'walk:hospital/corridor', '{}', '--force')).data;
      return { ...r, walkOn: on?.accepted ?? on?.code };
    }, (r) => r.sat && r.accepted === true && /floor 1/.test(r.offered ?? '') && r.walkOn === true);
    // last: a seated Soul in a full row of theatre seats may not get up again (see the report)
    await step('S4 Ben walks into the theatre and sits in the stalls', () => sitIn(ben, 'theatre', (e) => /^auditorium-row/.test(e.name), 'the stalls'), (r) => r.sat && r.accepted === true);

  }

  if (chromium && !args['no-viewer']) for (const dpr of dprs) {
    const release = await chromeLease('vocab-w3-e2e').catch(() => null);
    if (!release) { log('  (Chrome lease busy: viewer steps skipped)'); break; }
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'gene'); });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      await god('time', '11:00'); await god('weather', '--kind', 'clear');
      await page.goto(`${base}?dev=1&assets=eager`, { waitUntil: 'domcontentloaded' });
      const d = `dpr${dpr}`;
      const look = (eye, at) => page.evaluate(([e, a]) => { const s = window.__soulsEntity; if (!s) return false; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.controls.update?.(); return true; }, [eye, at]);
      const view = (v) => page.evaluate((x) => { globalThis.__buildingView = x; }, v);
      const snap = async (name) => { const f = resolve(out, `${name}-${d}.png`); await page.screenshot({ path: f }); report.shots.push(f); log(`  📷 ${name}-${d}.png`); };
      const drawn = () => page.evaluate(() => { const L = window.__soulsEntity?.layer; return L ? { active: !!L.active, drawn: L.drawn?.size ?? null, err: L.stats?.lastError ?? null } : null; });
      await step(`V1[${d}] the viewer draws the town (no page errors)`, async () => {
        let s; for (let i = 0; i < 120; i++) { s = await drawn(); if (s?.active && s.drawn > 300) break; await sleep(1000); }
        await sleep(5000);
        for (let i = 0; i < 3 && (await page.evaluate(() => document.querySelector('canvas')?.dataset.cameraMode)) !== 'manual'; i++) { await setCameraMode(page, 'manual'); await sleep(600); }
        await page.evaluate(() => { const t = [...document.querySelectorAll('*')].find((e) => e.textContent?.trim().startsWith('Join this world as a Soul') && e.children.length < 3); let n = t; while (n && n.parentElement && getComputedStyle(n).position !== 'fixed' && getComputedStyle(n).position !== 'absolute') n = n.parentElement; if (n) n.style.display = 'none'; });
        return { ...s, errors };
      }, (r) => r?.active && !r.errors.length);
      await step(`V2[${d}] each type outside, then cut away floor by floor (roofs off) to show its furnished rooms`, async () => {
        const n0 = report.shots.length;
        for (const p of PLACED) {
          const def = defOf(p.n), [w, h, dd] = def.size.box, R = Math.max(w, dd);
          await view({ hideRoofs: false, cut: null }); await look([p.x + R * 0.7, h * 0.6 + R * 0.45, p.z + R * 1.05], [p.x, h * 0.3, p.z]); await sleep(1300); await snap(`out-${p.n}`);
          const floors = def.params?.plan?.default?.floors?.length ?? 0;
          for (let k = 0; k < floors; k++) { const fh = def.params.floorHeight?.default ?? 3; await view({ hideRoofs: true, cut: k }); await look([p.x + R * 0.18, k * fh + R * 0.95, p.z + R * 0.62], [p.x, k * fh, p.z - R * 0.04]); await sleep(1300); await snap(`in-${p.n}-f${k}`); }
        }
        await view({ hideRoofs: false, cut: null });
        // eye level inside a few main rooms
        for (const [n, eye, at] of [['cafe', [2.8, 1.6, 2.4], [-2, 1.0, -1.5]], ['church', [0, 1.7, 7.5], [0, 1.2, -5]], ['school', [-1, 1.6, 5.4], [-5, 1.0, 1.5]], ['theatre', [0, 1.8, 2.5], [0, 1.4, -9]], ['bar', [3.6, 1.6, 3.4], [-2, 1.0, -1]], ['house', [3.4, 1.6, 3.4], [-2, 0.8, 0]]]) {
          const p = PLACED.find((q) => q.n === n); if (!p) continue;
          await look([p.x + eye[0], eye[1], p.z + eye[2]], [p.x + at[0], at[1], p.z + at[2]]); await sleep(1500); await snap(`eye-${n}`);
        }
        return { shots: report.shots.length - n0, errors };
      }, (r) => !r.errors.length && r.shots > PLACED.length);
    } finally { await browser.close(); await release(); }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const okN = report.steps.filter((s) => s.ok).length;
  writeFileSync(resolve(out, 'REPORT.md'), [`# VOCAB-W3 e2e ${stamp}`, `${okN}/${report.steps.length} steps passed on :${port}`, '', ...report.steps.map((s) => `- ${s.ok ? '✔' : '✖'} ${s.name} (${s.ms} ms)`), '', '## Shots', ...report.shots.map((f) => `- ${f}`)].join('\n') + '\n');
  log(`\n${okN}/${report.steps.length} passed — ${out}`);
  if (!args.keep) { try { server?.kill(); } catch { } }
  process.exit(report.failures.length ? 1 : 0);
}
