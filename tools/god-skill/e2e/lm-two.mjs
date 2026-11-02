#!/usr/bin/env node
// Lane LM: littlemartians-two — the Arium-era Little Martians world (lm/map 953613972438) rebuilt in god mode.
// One fresh world booted from worlds/templates/littlemartians-two.json (GENESIS_FILE, as the launcher does) with an
// EMPTY asset directory, so every model resolves through the library (core/lm-*@1) and the repo asset index.
//   G  the template's 468 entities; all 113 lm/map places resolve to an entity, a room or a flag; every library GLB is
//      served byte-exact; the library is compositional (a god finds and places core/lm-* defs anywhere).
//   S  two fresh Souls through the normal owner flow (invite → create → pair → Soul token; only /v1/edge/*):
//      Ana tours the Arium: Ceramic Commons → Madmaraca court → Grotto of Painted Worlds → up the ramp to the
//      Tharsis Overlook → the scan courts. Ben goes to the Minarete Sky Court, through Minarete's original ground arch,
//      then through the Celadon beacon's arch; he prays and the god answers.
//   Shots (Chrome lease, real GPU) of the Souls in the world.
//
//   node tools/god-skill/e2e/lm-two.mjs [--port 5473] [--keep] [--no-shots]
// Report under .lane/e2e-lm-two/<stamp>/.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';
import { edgeRead, observation } from './edge-observation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = 'littlemartians-two';
const port = Number(args.port ?? 5473);
const TEMPLATE = resolve(root, 'worlds/templates/littlemartians-two.json');
const out = resolve(root, '.lane/e2e-lm-two', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, template: 'worlds/templates/littlemartians-two.json', startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], souls: {}, samples: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Little Martians (Arium)', ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, ASSET_DIR: resolve(out, 'assets'), PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: TEMPLATE };
let serverLog = '', server;
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  const t0 = t();
  for (let i = 0; i < 3000; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return t() - t0; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
const stop = () => { try { server?.kill(); } catch { } };
process.on('exit', () => { if (!args.keep) stop(); });

// ---------- clients: owners (dev identities), the god (god token), the Souls (Soul tokens)
let godToken = '';
async function api(path, { method, body, as = 'god', timeoutMs = 120_000 } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (typeof as === 'object' && as?.token) headers.authorization = `Bearer ${as.token}`;
  else if (as && as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, retryAfter: r.headers.get('retry-after') };
}
const summarize = (r) => { try { const s = JSON.stringify(r); return s && s.length > 1500 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 12 ? `[${v.length} items]` : v))) : r; } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = summarize(result);
  report.steps.push({ name, ms: +ms.toFixed(0), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 500)}`);
  return result;
}
async function until(fn, ms = 120000, every = 500) { const deadline = Date.now() + ms; let last; while (Date.now() < deadline) { last = await fn(deadline); if (last?.ok) return last; await sleep(every); } return last; }
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const entity = async (path) => (await api(`/v1/world/entities/${path}`, { as: 'none' })).data;
const groundAt = async (pts) => (await api('/v1/god/query', { body: { points: pts } })).data.points;
const describe = async (ref) => (await api('/v1/god/query', { body: { describe: ref } })).data.describe;
const read = (path, s, deadline) => edgeRead(timeoutMs => api(path, { as: s, timeoutMs }), { deadline });
const observe = async (s, deadline) => observation(await read('/v1/edge/observe', s, deadline));
const caps = async (s, deadline) => (await read('/v1/edge/capabilities', s, deadline)).data.capabilities ?? [];
const xz = (p) => [p[0], p[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (p, q, d) => dist(xz(p), q) <= d;
/** Act as a Soul and follow the receipt to its end, sampling the body (position, activity) on the way. */
async function soulDoes(s, capability, { params, maxS = 300, until: stopWhen } = {}) {
  const t0 = Date.now();
  const deadline = t0 + maxS * 1000;
  const r = await api('/v1/edge/act', { body: { capability, ...(params ? { params } : {}) }, as: s });
  if (!r.data?.accepted) return { accepted: false, code: r.data?.code, reason: r.data?.reason, status: r.status, samples: [], end: null, ms: Date.now() - t0 };
  const id = r.data.receipt?.id, samples = [];
  let rec = r.data.receipt;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(s, deadline); const me = o.self;
    samples.push({ ms: Date.now() - t0, tick: o.tick, p: me.position, activity: me.activity, state: me.state });
    if (stopWhen?.(me)) break;
    if (id) rec = (await read(`/v1/edge/receipts/${encodeURIComponent(id)}`, s, deadline)).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe(s, deadline);
  // path length walked vs the straight line (an odd route shows as a high ratio)
  let walked = 0; for (let i = 1; i < samples.length; i++) walked += dist(xz(samples[i].p), xz(samples[i - 1].p));
  const straight = samples.length ? dist(xz(samples[0].p), xz(o.self.position)) : 0;
  return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, result: r.data.result, samples, ms: Date.now() - t0, walked: +walked.toFixed(1), straight: +straight.toFixed(1), end: { p: o.self.position, activity: o.self.activity, state: o.self.state } };
}
/** The longest time a body stood still (≤ 5 cm between samples) while its walk was still running. */
const longestStall = (samples) => { let best = 0, from = null; for (let i = 1; i < samples.length; i++) { const still = dist(xz(samples[i].p), xz(samples[i - 1].p)) < 0.05 && samples[i].activity !== 'sit'; if (still) { from ??= samples[i - 1].ms; best = Math.max(best, samples[i].ms - from); } else from = null; } return best; };

// ---------- screenshots (Chrome via the viewer's Playwright; one Chrome machine-wide via the lease)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
const shotUrl = ({ eye, at, wait = 4000, hideRoofs = false }) => {
  const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(wait), ...(hideRoofs ? { hideRoofs: '1' } : {}) });
  if (eye) q.set('eye', eye.map((v) => v.toFixed(2)).join(',')); if (at) q.set('at', at.map((v) => v.toFixed(2)).join(','));
  return `${base}?${q}`;
};
async function withPage(fn) {
  const release = await chromeLease('lane-lm-two e2e').catch(() => null);
  if (!release) { log('  (chrome lease busy; screenshot skipped)'); return false; }
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { (report.pageErrors ??= []).push(String(e).slice(0, 300)); });
    return await fn(page);
  } finally { if (browser) await browser.close().catch(() => { }); release(); }
}
async function load(page, opts) {
  await page.goto(shotUrl(opts), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 150_000 }).catch(() => log('  (shot not ready in 150 s; taking it anyway)'));
}
async function snap(page, name) {
  const file = resolve(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120_000 });
  report.shots.push({ name, file });
  log(`  📷 ${name}.png`);
}
/** Several stills in one browser session: [{ name, eye, at, wait, hideRoofs }]. */
async function shots(list) {
  if (!chromium) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { if (await withPage(async (page) => { for (const s of list) { await load(page, s); await page.waitForTimeout(s.extra ?? 2500); await snap(page, s.name); } return true; })) return; }
    catch (e) { log('  (screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  }
}
/** Open the page first, then start `run` (the Souls' walks) and photograph it mid-motion, `afterMs` later. */
async function shotDuring(name, opts, run) {
  if (!chromium) return run();
  let p = null;
  try {
    await withPage(async (page) => {
      await load(page, { ...opts, wait: 3000 }); p = run();
      await sleep(opts.afterMs ?? 15000);
      await snap(page, name); return true;
    });
  } catch (e) { log('  (mid-motion screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  return p ?? run();
}

// ================================================================ the scenario

// ================================================================ the scenario (template coordinates, metres)
// Ceramic Commons around (0, 22) with the Arium's black/chalk floor north of it (z −9..15); Madmaraca (−45, −20),
// Minarete (42, −20) and the Celadon beacon (0, −37) with 2 m ground arches running north–south; the grotto vault
// (26..64, 38..58) with its doorway on the north side; the Tharsis Overlook plateau (−8..8, 62..78) at 8 m, its ramp
// from (0, 31); the scan courts south of z 81.
const genesis = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
const placeOps = genesis.batches.reduce((n, b) => n + b.ops.filter((o) => o.op === 'place').length, 0);
const library = JSON.parse(readFileSync(resolve(root, 'packages/world-compiler/src/core-kit/littlemartians.json'), 'utf8'));
const FLAG = Object.fromEntries(genesis.batches.flatMap((b) => b.ops).filter((o) => o.def === 'core/flag@1').map((o) => [o.name, o.p]));
const PEOPLE = [
  { key: 'ana', name: 'Ana', description: 'walks the Arium slowly, looking at every glaze' },
  { key: 'ben', name: 'Ben', description: 'likes doorways, arches and the shade inside them' },
];
const souls = {};
let bootMs = 0;
const record = (who, what, r) => { (report.souls[who] ??= []).push({ what, ms: r?.ms, phase: r?.phase, code: r?.code, walked: r?.walked, straight: r?.straight, stallMs: r?.samples ? longestStall(r.samples) : undefined, end: r?.end?.p }); };
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted from littlemartians-two.json in ${bootMs.toFixed(0)} ms (empty asset dir)`);
  await step('G0 the owner mints a god token', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e lm-two' } }); godToken = r.data.token; return { status: r.status, token: !!godToken }; }, (r) => r.status === 200 && r.token);
  // the count is in the result, not the step name: a template edit (3.2: + the grotto approach landform, 432 -> 433) must not rename the assertion
  await step('G0 the world is the template: one entity per place op', async () => ({ count: Number(/(\d+) entities/.exec(serverLog)?.[1] ?? -1), placeOps }), (r) => r.count === placeOps);
  await step('G1 all 113 lm/map places resolve (old ids kept): an entity, a building room, or the arrival flag', async () => {
    const missing = [];
    const rooms = {};
    for (const p of genesis.places) {
      const ref = p.entity.replace(/^flag:/, '');
      const [bldg, room] = ref.split('/');
      if (room && !ref.startsWith('flag')) { rooms[bldg] ??= ((await describe(bldg))?.rooms ?? []).map((r) => r.id); if (!rooms[bldg].includes(room)) missing.push(p.id); continue; }
      if (!(await entity(ref))?.entity) missing.push(p.id);
    }
    return { places: genesis.places.length, missing };
  }, (r) => r.places === 113 && !r.missing.length);
  // byte-exact = the source, or its smaller wire rendition (worlds/core-assets/renditions.json, lane W3b) under the source sha
  const renditions = JSON.parse(readFileSync(resolve(root, 'worlds/core-assets/renditions.json'), 'utf8')).renditions;
  await step(`G1 every library model (${library.filter((d) => d.make.kind === 'mesh').length} GLBs) is served byte-exact from an empty asset dir`, async () => {
    const bad = [];
    for (const d of library.filter((x) => x.make.kind === 'mesh')) {
      const r = await fetch(`${base}/assets/${d.make.asset}.glb`); const b = Buffer.from(await r.arrayBuffer()), h = createHash('sha256').update(b).digest('hex');
      if (!r.ok || (h !== d.make.asset && h !== renditions[d.make.asset]?.sha)) bad.push(d.name);
    }
    return { bad };
  }, (r) => !r.bad.length);
  await step('G2 the library is compositional: defs?q=madmaraca → core/lm-madmaraca@1; a god places Verdelis, a glazed plant and the Fey Castle scan in open ground', async () => {
    const hits = (await api('/v1/god/defs?q=madmaraca')).data.defs.map((d) => d.publicRef);
    const r = await act([{ op: 'place', def: 'core/lm-verdelis@1', name: 'new-verdelis', p: [-110, 40] }, { op: 'place', def: 'core/lm-glazed-plant@1', name: 'new-plant', p: [-106, 40] }, { op: 'place', def: 'core/lm-scan-fey-castle@1', name: 'new-castle', p: [-120, 60] }], 'compose');
    return { first: hits[0], accepted: r.data?.accepted, failures: r.data?.failures };
  }, (r) => r.first === 'core/lm-madmaraca@1' && r.accepted === true);

  for (const who of PEOPLE) {
    await step(`S0 an owner is invited and creates a Soul "${who.name}"; an agent pairs and gets a Soul token`, async () => {
      const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
      const ok = await api('/v1/invite', { as: who.key, body: { code: inv.data.code } });
      const s = await api('/v1/souls', { as: who.key, body: { name: who.name, description: who.description } });
      const soul = s.data.soul;
      const c = soul ? await api(`/v1/souls/${soul.id}/pair`, { as: who.key, body: {} }) : null;
      const x = c ? await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: `e2e lm-two ${who.key}` } }) : null;
      souls[who.key] = { ...who, soul, token: x?.data?.token };
      return { soul, token: !!x?.data?.token };
    }, (r) => r.soul?.id && r.token);
  }
  const S = (k) => ({ token: souls[k].token });
  await step('S1 both are born on the ground; their capabilities name the places (flags, the arches)', () => until(async (deadline) => {
    const at = {}, missing = {};
    const want = ['walk:flag-ceramic-commons', 'walk:flag-madmaraca-gallery', 'walk:flag-grotto-of-painted-worlds', 'walk:flag-overlook-summit', 'walk:flag-scan-courts', 'walk:flag-minarete-sky-court', 'pray'];
    for (const k of Object.keys(souls)) {
      const o = await observe(S(k), deadline); at[k] = o?.self?.position;
      const c = (await caps(S(k), deadline)).map((x) => x.id); const m = want.filter((w) => !c.includes(w)); if (m.length) missing[k] = m;
      report.caps ??= {}; report.caps[k] = c.filter((x) => x.startsWith('walk:')).slice(0, 80);
    }
    return { ok: Object.values(at).every(Boolean) && !Object.keys(missing).length, at, missing };
  }, 60000), (r) => r?.ok);
  const capFor = async (k, re) => (await caps(S(k))).find((c) => re.test(c.id))?.id;

  // ---- Ana tours the Arium (her walks), Ben walks the arches, at the same time
  const tour = ['ceramic-commons', 'madmaraca-gallery', 'grotto-of-painted-worlds', 'overlook-summit', 'scan-courts'];
  const anaTour = async () => { const res = []; for (const f of tour) { const r = await soulDoes(S('ana'), `walk:flag-${f}`, { maxS: 360 }); record('ana', `walk to ${f}`, r); res.push([f, r]); } return res; };
  const benWalk = async () => {
    const res = [];
    const r0 = await soulDoes(S('ben'), 'walk:flag-minarete-sky-court', { maxS: 300 }); record('ben', 'walk to the Minarete Sky Court', r0); res.push(['minarete-sky-court', r0]);
    for (const n of ['minarete-passage', 'celadon-passage']) {
      const cap = await capFor('ben', new RegExp(`^walk:${n}$`)) ?? `walk:${n}`;
      const r = await soulDoes(S('ben'), cap, { maxS: 300 }); record('ben', `walk into ${n}`, r); res.push([n, r]);
    }
    return res;
  };
  const both = await shotDuring('s2-walking-overview', { eye: [0, 95, 125], at: [0, 0, 0], afterMs: 25000 }, () => Promise.all([anaTour(), benWalk()]));
  const [anaRes, benRes] = both;
  const brief = (r, goal) => ({ phase: r.phase, code: r.code, reason: r.reason, s: +(r.ms / 1000).toFixed(1), walked: r.walked, end: r.end?.p?.map((v) => +v.toFixed(2)), off: goal && r.end ? +dist(xz(r.end.p), goal).toFixed(2) : null, stallS: +(longestStall(r.samples) / 1000).toFixed(1) });
  for (const [f, r] of anaRes) await step(`S2 Ana walks to ${f}`, async () => { report.samples[`ana-${f}`] = r.samples; return brief(r, FLAG[f]); }, (b) => b.phase === 'completed' && b.off !== null && b.off < 3);
  await step('S2 on the overlook Ana stands on the plateau, 8 m up (she climbed the ramp)', async () => { const r = anaRes.find(([f]) => f === 'overlook-summit')[1]; const top = Math.max(...r.samples.map((s) => s.p[1])); return { top: +top.toFixed(2), endY: r.end?.p?.[1] }; }, (r) => r.top > 5.5);
  const [, b0] = benRes[0];
  await step('S3 Ben walks to the Minarete Sky Court', async () => brief(b0, FLAG['minarete-sky-court']), (b) => b.phase === 'completed' && b.off < 3);
  for (const [n, r] of benRes.slice(1)) {
    const centre = n === 'minarete-passage' ? [42, -20] : [0, -37];
    await step(`S3 Ben walks into ${n === 'minarete-passage' ? "Minarete's" : "the Celadon beacon's"} original ground arch (inside the scan, x within 1 m of its axis)`, async () => {
      report.samples[`ben-${n}`] = r.samples;
      const inside = r.samples.filter((s) => Math.abs(s.p[0] - centre[0]) < 1.0 && Math.abs(s.p[2] - centre[1]) < 6).length;
      return { ...brief(r, centre), samplesInsideArch: inside };
    }, (b) => b.phase === 'completed' && b.off < 2.5 && b.samplesInsideArch >= 1);
  }
  let prayerId = null;
  await step('S4 Ben prays inside the arch', async () => { const r = await api('/v1/edge/act', { as: S('ben'), body: { capability: 'pray', params: { text: 'May the beacon keep its glaze through the dust season.' } } }); prayerId = r.data.result?.prayer; return r.data; }, (r) => r.accepted === true && !!prayerId);
  await step('G4 the god answers; Ben reads it', async () => {
    await act([{ op: 'answer', prayer: prayerId, text: 'It will. The kin polish it at dawn.' }]);
    const p = (await api('/v1/god/prayers/mine', { as: S('ben') })).data.prayers; return { answer: p.find((x) => x.id === prayerId)?.answer };
  }, (r) => /kin polish/.test(r.answer ?? ''));

  const pos = {}; for (const k of Object.keys(souls)) pos[k] = (await observe(S(k))).self.position;
  const close = (p, dx, dz, h = 3) => ({ eye: [p[0] + dx, p[1] + h, p[2] + dz], at: [p[0], p[1] + 0.9, p[2]] });
  await shots([
    { name: 'overview-souls', eye: [0, 95, 125], at: [0, 0, 0], wait: 8000 },
    { name: 'ana-in-the-scan-courts', ...close(pos.ana, 4, 7), wait: 8000 },
    { name: 'ben-in-the-celadon-arch', ...close(pos.ben, 0.5, 9, 2), wait: 8000 },
    { name: 'compose-new-verdelis-plant-castle', eye: [-108, 5, 26], at: [-113, 2, 48], wait: 8000 },
  ]);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const soulRows = Object.entries(report.souls).flatMap(([k, rows]) => rows.map((r) => `| ${k} | ${r.what} | ${r.phase ?? '—'} | ${r.ms != null ? (r.ms / 1000).toFixed(1) : '—'} | ${r.walked ?? '—'} / ${r.straight ?? '—'} | ${r.stallMs != null ? (r.stallMs / 1000).toFixed(1) : '—'} |`));
  const md = [`# littlemartians-two with fresh Souls — ${report.startedAt}`, '', `template ${report.template} · boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## Souls', '| soul | did | phase | s | walked / straight m | longest stall s |', '|---|---|---|---:|---|---:|', ...soulRows, '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
