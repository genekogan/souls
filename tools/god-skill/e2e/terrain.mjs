#!/usr/bin/env node
// L3 e2e: terrain, paths, water and ecology built the way a god agent would, through the god API,
// with the skill-side prepare steps (prepareFor) freezing grades, river flow and deck heights from
// the world the agent sees. Checks the numbers against the world and photographs every piece:
//   a graded road over a hill (T junction with a street), a river from a lake on a shelf over a
//   waterfall, under an auto-bridge, into a pond; a radial plaza; a football pitch; a pier into the
//   lake; a forest edge with reeds by the water and rocks on the cliff; walls, hedges, fences,
//   power line; ground palettes.
//
//   node tools/god-skill/e2e/terrain.mjs [--port 4995] [--keep] [--no-shots]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const { WorldModel } = await import(resolve(root, 'packages/world-compiler/src/index.ts'));
const G = await import(resolve(root, 'packages/generators/src/index.ts'));
const terrainKit = JSON.parse(readFileSync(resolve(root, 'packages/world-compiler/src/core-kit/terrain.json'), 'utf8'));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((x) => x.length));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : `terrain-${stamp.slice(11, 19).replace(/-/g, '').toLowerCase()}`;
const port = Number(args.port ?? 4995);
const out = resolve(root, '.lane/e2e-terrain', stamp); mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], numbers: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();

// ---------- the world process
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}` };
const server = spawn('node', ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', () => { if (!args.keep) stop(); });
for (let i = 0; i < 600; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) break; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)); }
log(`▶ world "${slug}" on :${port}`);

let token = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god' && token) headers.authorization = `Bearer ${token}`;
  if (as === 'owner') headers.authorization = 'Bearer dev:admin';
  let r;
  for (let attempt = 0; ; attempt++) {
    // a reused keep-alive socket can be reset by a busy server before the request is read: retry that once
    try { r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }); break; }
    catch (e) { if (attempt >= 2) throw e; await new Promise((res) => setTimeout(res, 300)); }
  }
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = result && typeof result === 'object' ? JSON.stringify(result.data ?? result).slice(0, 400) : String(result);
  report.steps.push({ name, ms: +ms.toFixed(1), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? brief).slice(0, 400)}`);
  return result;
}
const accepted = (r) => r.status === 200 && r.data?.accepted === true;
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const snapshot = async () => (await api('/v1/world/snapshot', { as: 'none' })).data;
/** The skill's mirror: a WorldModel from the snapshot (ground, defs, entities). */
const mirror = async () => { const s = await snapshot(); return { s, w: WorldModel.fromSnapshot({ constants: s.constants, state: s.state, seed: s.seed ?? 'mirror', seq: s.counter ?? 0, editSeq: s.seq, defs: s.defs, entities: s.entities, ground: s.ground }) }; };
const genOf = (w, ref) => { const d = w.resolvedDef(ref); return d?.make?.kind === 'gen' ? d.make.gen : null; };
/** Place a path/area thing the way the skill does: prepare from the mirror, then send explicit params and shape. */
async function placePrepared(def, name, shape, params = {}) {
  const { w } = await mirror();
  const p = G.prepareFor(genOf(w, def), G.queryOf(w), shape, params);
  const sh = p?.path ? { ...shape, path: p.path } : shape;
  return act([{ op: 'place', def, name, shape: sh, params: { ...params, ...(p?.params ?? {}) } }], `place ${name}`);
}

// ---------- screenshots
let chromium = null, browser = null, page = null, releaseLease = null;
const glErrors = []; // WebGL shader/program errors from the page (a broken shader hides every mesh using it)
const { chromeLease } = await import(resolve(root, 'tools/god-skill/lib/chrome-lease.mjs'));
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
async function shot(name, eye, at, wait = 5000) {
  if (!chromium) return;
  const t0 = t();
  try {
    // one Chrome at a time across lanes (MERGES.md 08:25), on the real GPU (Metal), not swiftshader (08:55)
    if (!browser) { releaseLease = await chromeLease('terrain'); browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] }); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); }); page = await ctx.newPage(); page.setDefaultTimeout(180000); page.on('console', (m) => { if (m.type() === 'error' && /shader|WebGLProgram|GL_INVALID/i.test(m.text())) glErrors.push(m.text().slice(0, 300)); }); }
    if (!page.url().startsWith(base)) { await page.goto(`${base}?dev=1&shot=1&eye=${eye.join(',')}&at=${at.join(',')}`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await page.waitForFunction(() => window.__shotReady === true || (window.__soulsEntity?.layer?.active && document.title === 'ready'), null, { timeout: 180000 }).catch(() => {}); await page.waitForTimeout(Math.max(wait, 8000)); }
    // a clean picture: hide every overlay (panels, banners, buttons) that is not on the canvas's own ancestor chain
    await page.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return; for (let el = c; el && el !== document.body; el = el.parentElement) for (const sib of el.parentElement?.children ?? []) if (sib !== el && !sib.contains(c) && sib.tagName !== 'SCRIPT') sib.style.visibility = 'hidden'; });
    await page.evaluate(([e, a]) => { const w = window.__soulsEntity; if (!w) return; w.controls.target.set(a[0], a[1], a[2]); w.camera.position.set(e[0], e[1], e[2]); w.camera.lookAt(w.controls.target); w.controls.update?.(); }, [eye, at]);
    await page.waitForTimeout(wait);
    const state = await page.evaluate(() => { const w = window.__soulsEntity; return w ? { active: w.layer.active, drawn: w.layer.drawn?.size ?? null, err: w.layer.stats?.lastError ?? null } : null; });
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: 180000 });
    report.shots.push({ name, file, state, ms: +(t() - t0).toFixed(0) });
    log(`  📷 ${name}.png ${JSON.stringify(state)} ${(t() - t0).toFixed(0)} ms`);
  } catch (e) { log(`  (shot ${name} failed: ${String(e?.message ?? e).split('\n')[0]})`); report.shots.push({ name, error: String(e?.message ?? e).split('\n')[0] }); }
}

// ================================================================ scene
try {
  await step('T0 mint a god token', async () => { const r = await api('/v1/god/mint', { as: 'owner', body: { label: 'terrain-e2e' } }); token = r.data.token; return r; }, (r) => r.status === 200 && !!token);
  await step('T0 terrain kit available (define what the core kit lacks)', async () => {
    const s = await snapshot(); const have = new Set(s.defs.map((d) => d.ref));
    const missing = terrainKit.filter((d) => !have.has(`${d.name}@${d.version ?? 1}`));
    if (!missing.length) return { defined: 0, kit: terrainKit.length };
    const r = await act(missing.map((def) => ({ op: 'define', def })), 'terrain kit');
    return { defined: missing.length, accepted: r.data?.accepted, failures: r.data?.failures };
  }, (r) => r.defined === 0 || r.accepted === true);
  const R = (n) => `core/${n}@1`;
  const lakeArea = [[-170, -60], [-110, -75], [-88, -32], [-100, 8], [-160, 15]];
  const pondArea = [[70, 30], [100, 25], [112, 50], [95, 72], [70, 62]];

  await step('T1 landforms: a 4 m cliff (shelf to the west), a hill, a lake on the shelf, a pond below', () => act([
    { op: 'place', def: R('cliff'), name: 'west-cliff', shape: { path: [[-60, -200], [-60, 200]] }, params: { height: 4, face: 3, shelf: 320, back: 30, side: 1 } },
    { op: 'place', def: R('hill'), name: 'hill', p: [0, -80], params: { height: 16, radius: 55 } },
    { op: 'place', def: R('lake'), name: 'lake', shape: { area: lakeArea }, params: { level: 3.7, depth: 3, edge: 6 } },
    { op: 'place', def: R('pond'), name: 'pond', shape: { area: pondArea }, params: { level: -0.3, depth: 1.5, edge: 3 } },
  ], 'landforms'), accepted);
  await step('T1 the shelf stands 4 m above the plain, the hill 16 m', async () => { const { w } = await mirror(); return { shelf: +w.terrain.sample(-120, 60).toFixed(2), plain: +w.terrain.sample(40, 60).toFixed(2), hill: +w.terrain.sample(0, -80).toFixed(2), face: +w.terrain.slope(-60, 60).toFixed(2) }; }, (r) => Math.abs(r.shelf - 4) < 0.05 && Math.abs(r.plain) < 0.05 && r.hill > 15 && r.face > 0.8);

  // the river: snapped into the lake and the pond, falling over the cliff
  const riverRes = await step('T2 river from the lake over the cliff to the pond (snapRiver)', () => placePrepared(R('river'), 'river', { path: [[-98, -16], [-60, -6], [-20, 6], [30, 24], [76, 46]] }, { width: 6, depth: 1.3, banks: 'sand', bankWidth: 2.5 }), accepted);
  await step('T2 the river flows: levels from 3.7 down to −0.3, never uphill, a waterfall at the cliff, ends in lake and pond', async () => {
    const { s, w } = await mirror(); const e = s.entities.find((x) => x.name === 'river'); const f = e.params.flow;
    const lake = s.entities.find((x) => x.name === 'lake'), pond = s.entities.find((x) => x.name === 'pond');
    let up = 0; for (let i = 1; i < f.levels.length; i++) if (f.levels[i] > f.levels[i - 1] + 1e-9) up++;
    const water = s.ground.waters.find((x) => x.id === e.id);
    report.numbers.river = { points: f.levels.length, from: f.levels[0], to: f.levels.at(-1), falls: f.falls, levelsInGround: !!water?.levels };
    const mid = G.riverLine(e.shape)[Math.floor(f.levels.length / 2)];
    return { from: f.levels[0], to: f.levels.at(-1), up, falls: f.falls.length, source: f.source === lake.id, mouth: f.mouth === pond.id, bed: +(w.terrain.sample(mid[0], mid[1]) - f.levels[Math.floor(f.levels.length / 2)]).toFixed(2), groundLevels: !!water?.levels };
  }, (r) => r.from === 3.7 && r.to === -0.3 && r.up === 0 && r.falls >= 1 && r.source && r.mouth && r.bed < -0.5);
  void riverRes;

  // the graded road over the hill, bridging the river; a street T-junction; a footpath
  await step('T3 a cobbled road over the hill and across the river (graded, auto-bridged)', () => placePrepared(R('road'), 'high-road', { path: [[0, -175], [6, -120], [0, -70], [-4, -25], [0, 25], [6, 85]] }, { width: 6, maxGrade: 0.08 }), accepted);
  const roadNums = await step('T3 the ground along the road stays under 8 % (+ tile tolerance); one bridge over the river', async () => {
    const { s, w } = await mirror(); const e = s.entities.find((x) => x.name === 'high-road'), g = e.params.grade;
    const c = G.centreLine(e.shape), sl = G.arcLengths(c); let worst = 0, worstAt = 0;
    const inSpan = (q) => g.spans.some((sp) => q >= sp.from - 3 && q <= sp.to + 3);
    for (let i = 1; i < c.length; i++) { if (inSpan(sl[i])) continue; const d = Math.abs(w.terrain.sample(c[i][0], c[i][1]) - w.terrain.sample(c[i - 1][0], c[i - 1][1])) / (sl[i] - sl[i - 1]); if (d > worst) { worst = d; worstAt = sl[i]; } }
    const raw = G.steepest(c.map(([x, z]) => w.terrain.sample(x, z)), c);
    report.numbers.road = { length: +sl.at(-1).toFixed(1), worstGrade: +worst.toFixed(3), worstAt: +worstAt.toFixed(0), cut: g.cut, fill: g.fill, spans: g.spans };
    return { worst: +worst.toFixed(3), spans: g.spans.length, cut: g.cut, fill: g.fill, deck: g.spans[0]?.y0, raw: +raw.toFixed(3) };
  }, (r) => r.worst < 0.1 && r.spans === 1 && r.cut > 2);
  await step('T3 an asphalt street tees into the road; a gravel footpath to the pond', async () => {
    const a = await placePrepared(R('street'), 'street', { path: [[0, -34], [50, -42], [100, -38], [150, -26]] }, { width: 7 });
    const b = await placePrepared(R('footpath'), 'pond-path', { path: [[60, -40], [70, -10], [82, 18]] }, { width: 1.8 });
    const c = await placePrepared(R('road'), 'cross-lane', { path: [[-46, 62], [6, 64], [56, 70]] }, { width: 5, material: 'cobble', maxGrade: 0.08 });
    return { a: a.data?.accepted, b: b.data?.accepted, c: c.data?.accepted, fa: a.data?.failures, fb: b.data?.failures, fc: c.data?.failures };
  }, (r) => r.a && r.b && r.c);
  await step('T3 the river stays open under the roads: its bed lies below the water at every point outside the lake and pond', async () => {
    const { s, w } = await mirror(); const e = s.entities.find((x) => x.name === 'river'), lv = e.params.flow.levels, c = G.riverLine(e.shape);
    const inPoly = (x, z, poly) => { let o = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) o = !o; } return o; };
    let worst = -Infinity, worstAt = null;
    for (let i = 0; i < c.length; i++) { const [x, z] = c[i]; if (inPoly(x, z, lakeArea) || inPoly(x, z, pondArea)) continue; const d = w.terrain.sample(x, z) - lv[i]; if (d > worst) { worst = d; worstAt = [+x.toFixed(1), +z.toFixed(1)]; } }
    report.numbers.riverOpen = { worstBedAboveWater: +worst.toFixed(2), at: worstAt };
    return { worst: +worst.toFixed(2), at: worstAt };
  }, (r) => r.worst < -0.3);

  // areas: plaza, pitch, pier, deck
  await step('T4 a radial plaza with a kerb, a garden wall with a gate behind it', () => act([
    { op: 'place', def: R('plaza'), name: 'plaza', shape: { area: [[22, -30], [56, -34], [58, -8], [24, -6]] }, params: { material: 'cobble', pattern: 'radial', size: 0.7 } },
    { op: 'place', def: R('garden-wall'), name: 'plaza-wall', shape: { path: [[20, -2], [60, -4]] }, params: { height: 1.6, gates: [{ at: 20, width: 2.4 }] } },
  ], 'plaza'), accepted);
  await step('T4 a football pitch with a picket fence; a herringbone brick square', () => act([
    { op: 'place', def: R('football-pitch'), name: 'pitch', shape: { area: [[40, 90], [140, 90], [140, 154], [40, 154]] } },
    { op: 'place', def: R('fence'), name: 'pitch-fence', shape: { path: [[40, 86], [140, 86]] }, params: { style: 'picket' } },
    { op: 'place', def: R('plaza'), name: 'brick-square', shape: { area: [[-40, 40], [-20, 40], [-20, 58], [-40, 58]] }, params: { material: 'brick', pattern: 'herringbone', size: 0.5 } },
  ], 'pitch'), accepted);
  await step('T4 a pier from the north shore out into the lake (prepareDeck)', () => placePrepared(R('pier'), 'pier', { path: [[-132, 28], [-131, 2]] }, { width: 2.4, height: 0.7, platform: 5 }), accepted);
  await step('T4 the pier deck stands 0.7 m above the lake', async () => { const { s } = await mirror(); const e = s.entities.find((x) => x.name === 'pier'); report.numbers.pier = e.params.at; return { y: e.params.at?.y }; }, (r) => Math.abs(r.y - 4.4) < 0.05);

  // ecology, boundaries, shores
  await step('T5 a forest edge over the cliff and by the river; reeds round the pond; a sand shore round the lake', () => act([
    { op: 'place', def: R('woodland'), name: 'west-wood', shape: { area: [[-82, -140], [-14, -140], [-14, -4], [-82, -4]] }, params: { density: 0.05, cluster: 0.45, minSpacing: 2.2 }, seed: 11 },
    { op: 'place', def: R('reedbed'), name: 'pond-reeds', shape: { area: [[62, 18], [120, 18], [120, 80], [62, 80]] }, seed: 5 },
    { op: 'place', def: R('shore'), name: 'lake-shore', shape: { area: lakeArea }, params: { material: 'sand', width: 3, inner: 1.5 } },
    { op: 'place', def: R('hedge'), name: 'street-hedge', shape: { path: [[20, -52], [130, -46]] }, params: { flowers: true, gates: [{ at: 50, width: 2 }] } },
    { op: 'place', def: R('power-line'), name: 'power', shape: { path: [[10, -62], [80, -60], [150, -45]] } },
  ], 'ecology'), accepted);
  await step('T5 scatter rules hold: reeds within 4 m of water, rocks on the cliff face, trees off the shore and off the road', async () => {
    const { s, w } = await mirror(); const e = s.entities.find((x) => x.name === 'west-wood'); const pal = G.paletteOf(e.params);
    const q = G.queryOf(w); const pts = G.scatter2Points(e.shape.area, e.params, e.seed, q);
    const by = {}; for (const p of pts) { const k = pal[p.k].kind; (by[k] ??= []).push(p); }
    const reedFar = (by.reed ?? []).filter((p) => G.distToWater(q, p.x, p.z, 60) > 4.01).length;
    const rockFlat = (by.rock ?? []).filter((p) => q.slope(p.x, p.z) < 0.45).length;
    const treeWet = ['oak', 'pine', 'birch'].flatMap((k) => by[k] ?? []).filter((p) => G.distToWater(q, p.x, p.z, 60) < 3).length;
    const counts = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length]));
    report.numbers.scatter = { total: pts.length, counts, reedFar, rockFlat, treeWet };
    return { total: pts.length, counts, reedFar, rockFlat, treeWet };
  }, (r) => r.total > 200 && (r.counts.reed ?? 0) > 5 && (r.counts.rock ?? 0) > 5 && r.reedFar === 0 && r.rockFlat === 0 && r.treeWet === 0);

  // brushes and terraces (scales of edit)
  await step('T6 terrain brushes: raise a mound, smooth it, flatten a pad; a stepped terrace on the hill’s far side', async () => {
    const r = await act([
      { op: 'place', def: R('brush'), name: 'mound', p: [-30, 90], params: { op: 'raise', radius: 10, amount: 3 } },
      { op: 'place', def: R('brush'), name: 'soften', p: [-30, 90], params: { op: 'smooth', radius: 14, amount: 1 } },
      { op: 'place', def: R('terrace'), name: 'hill-terraces', shape: { area: [[15, -130], [55, -130], [55, -90], [15, -90]] }, params: { step: 3, riser: 0.45, edge: 4, label: 'vine terraces' } },
    ], 'brushes');
    const { w } = await mirror();
    return { accepted: r.data?.accepted, failures: r.data?.failures, mound: +w.terrain.sample(-30, 90).toFixed(2), moundOff: +w.terrain.sample(0, 90).toFixed(2), terrace: [w.terrain.sample(30, -110), w.terrain.sample(31, -110)].map((v) => +v.toFixed(2)) };
  }, (r) => r.accepted && r.mound > 0.8 && Math.abs(r.moundOff) < 0.05);
  await step('T6 undo the brushes group restores the ground', async () => { const before = (await mirror()).w.terrain.sample(-30, 90); const u = await api('/v1/god/undo', { method: 'POST' }); const after = (await mirror()).w.terrain.sample(-30, 90); await api('/v1/god/redo', { method: 'POST' }); return { u: u.data?.accepted, before: +before.toFixed(2), after: +after.toFixed(2) }; }, (r) => r.u && Math.abs(r.after) < 0.05 && r.before > 0.8);

  await step('T8 courts: tennis (fenced), basketball, volleyball, petanque', () => act([
    { op: 'place', def: R('tennis-court'), name: 'tennis', shape: { area: [[70, -150], [106, -150], [106, -132], [70, -132]] } },
    { op: 'place', def: R('pitch'), name: 'basketball', shape: { area: [[112, -150], [142, -150], [142, -134], [112, -134]] }, params: { sport: 'basketball' } },
    { op: 'place', def: R('pitch'), name: 'volleyball', shape: { area: [[70, -124], [88, -124], [88, -114], [70, -114]] }, params: { sport: 'volleyball' } },
    { op: 'place', def: R('pitch'), name: 'petanque', shape: { area: [[94, -124], [110, -124], [110, -119], [94, -119]] }, params: { sport: 'petanque' } },
  ], 'courts'), accepted);
  await step('T8 a stream with pebble banks and a wooden footbridge across it (prepareBridge)', async () => {
    const a = await placePrepared(R('stream'), 'stream', { path: [[176, -112], [168, -70], [172, -30], [166, 10]] }, { width: 2.5 });
    const b = await placePrepared(R('footbridge'), 'footbridge', { path: [[163, -50], [177, -50.5]] }, { width: 1.8 });
    const { s } = await mirror(); const fb = s.entities.find((x) => x.name === 'footbridge');
    return { a: a.data?.accepted, b: b.data?.accepted, at: fb?.params?.at, fa: a.data?.failures, fb: b.data?.failures };
  }, (r) => r.a && r.b && r.at);

  const { s: snapNow } = await mirror();
  const span = snapNow.entities.find((x) => x.name === 'high-road')?.params?.grade?.spans?.[0];
  const road = snapNow.entities.find((x) => x.name === 'high-road');
  const bridgeAt = span ? G.subPath(G.centreLine(road.shape), G.arcLengths(G.centreLine(road.shape)), (span.from + span.to) / 2, (span.from + span.to) / 2 + 0.1)[0] : [0, 8];
  const fall = snapNow.entities.find((x) => x.name === 'river')?.params?.flow?.falls?.[0];
  const fallAt = fall ? G.riverLine(snapNow.entities.find((x) => x.name === 'river').shape)[fall.i] : [-60, -6];
  report.numbers.cameras = { bridgeAt, fallAt };

  await shot('t1-overview', [-170, 150, 210], [0, 0, -10], 8000);
  await shot('t2-road-over-hill', [70, 38, -150], [0, 8, -85]);
  await shot('t3-bridge', [bridgeAt[0] + 22, 9, bridgeAt[1] + 18], [bridgeAt[0], 1.5, bridgeAt[1]]);
  await shot('t4-waterfall', [fallAt[0] + 16, 9, fallAt[1] - 14], [fallAt[0], 2.5, fallAt[1]]);
  await shot('t5-plaza-junction', [6, 22, -58], [36, 0, -24]);
  await shot('t6-pitch', [90, 55, 40], [90, 0, 120]);
  await shot('t7-pier', [-112, 11, 46], [-131, 3.5, 12]);
  await shot('t8-forest-edge', [-8, 24, -28], [-55, 2, -60]);
  await shot('t9-pond-reeds', [118, 14, 20], [90, 0, 48]);
  await shot('t11-courts', [106, 32, -88], [106, 0, -134]);
  await shot('t12-footbridge', [156, 7, -38], [170, 0.5, -50]);
  await shot('t13-street-junction', [-22, 14, -18], [4, 0, -36]);
  await shot('t14-crossing', [22, 16, 82], [5, 0, 64]);
  await shot('t15-path-tee', [74, 8, -52], [61, 0, -40]);
  await step('T7 ground palette: desert', async () => { const r = await act([{ op: 'world', state: { ground: { palette: 'desert' } } }], 'palette'); return { accepted: r.data?.accepted, failures: r.data?.failures }; }, (r) => r.accepted);
  await shot('t10-desert-palette', [-170, 150, 210], [0, 0, -10], 6000);
  if (chromium) await step('T9 the page compiled every shader (no WebGL errors)', async () => ({ errors: glErrors.length, first: glErrors[0] }), (r) => r.errors === 0);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('harness error', e);
} finally {
  if (browser) await browser.close().catch(() => {});
  releaseLease?.();
  report.summary = { steps: report.steps.length, failed: report.failures.length, shots: report.shots.filter((s) => s.file).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# terrain e2e — ${slug} — ${report.startedAt}`, '', `${report.summary.steps} steps · ${report.summary.failed} failed · ${report.summary.shots} shots`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? s.result).slice(0, 200).replace(/\|/g, '/')} |`), '', '## numbers', '```json', JSON.stringify(report.numbers, null, 1), '```', '', '## shots', ...report.shots.map((s) => `- ${s.name}: ${s.file ? '`' + s.file + '`' : 'failed: ' + s.error} ${s.state ? JSON.stringify(s.state) : ''}`)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed, ${report.summary.shots} shots. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
