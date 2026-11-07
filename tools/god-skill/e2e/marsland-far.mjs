#!/usr/bin/env node
// marsland-far e2e (lane MARSLAND-FAR): what lies beyond the walkable edge, as library defs any god can place.
// One fresh 1200 m world (a cottage, a flag near the edge, a desert sky). The GOD places core/far-land@1 (salt-pan mosaic,
// the levee band, the wash, the delta, Highway 111 with its pole line, the Salton Sea) and core/panorama@1 (the ranges
// around Mars at their real distances) with the Mars data in marsland-far-data.mjs, unnamed, at the centre. Checks:
// both are admitted as decor; the camera still arrives framing what was built (not kilometres out); the green horizon
// ring is replaced and comes back when they are removed; the Soul's capabilities and map carry no giant "far land" thing;
// a Soul created and paired through the normal owner flow walks to the cottage and to the flag by the edge; screenshots
// N/E/S/W at eye height and from 100 m up, with draw calls, triangles and render time before/after.
//
//   node tools/god-skill/e2e/marsland-far.mjs [--port 5968] [--keep] [--no-shots]
//
// Harness from mars-two.mjs. Report under .lane/e2e-marsland-far/<stamp>/.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';
import { MARS_FAR_LAND, MARS_PANORAMA } from './marsland-far-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'far-e2e';
const port = Number(args.port ?? 5968);
const out = resolve(root, '.lane/e2e-marsland-far', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], samples: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- a fresh world: flat 1200 m playa, a cottage, a flag 520 m out, the Mars desert sky
const genesis = resolve(out, 'genesis.json');
writeFileSync(genesis, JSON.stringify({
  schema: 'genesis/1', name: 'Far e2e', description: 'A flat 1200 m playa to place the land beyond the edge on.', constants: { extent: 1200, ground: 'land' },
  state: { sky: { palette: 'mars-desert', sun: 0.8 }, weather: { clouds: 0.05, wind: 0.3, rain: 0 }, ground: { palette: 'desert' } },
  batches: [{ note: 'a place to stand', ops: [{ op: 'place', def: 'core/cottage@1', name: 'cottage', p: [0, 0] }, { op: 'place', def: 'core/flag@1', name: 'edge', p: [0, 520], state: { label: 'edge' } }] }],
}));
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: genesis };
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

// ---------- clients
let godToken = '', soulToken = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (as === 'soul') headers.authorization = `Bearer ${soulToken}`;
  else if (as && as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
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
async function until(fn, ms = 120000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await sleep(every); } return last; }
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const observe = async () => (await api('/v1/edge/observe', { as: 'soul' })).data;
const caps = async () => (await api('/v1/edge/capabilities', { as: 'soul' })).data.capabilities ?? [];
async function follow(acted, { maxS = 240 } = {}) {
  if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason, samples: [], end: null };
  const id = acted.receipt?.id, samples = []; let rec = acted.receipt; const t0 = Date.now();
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(); samples.push({ tick: o.tick, p: o.self.position, activity: o.self.activity });
    if (id) rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe();
  return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, samples, end: { p: o.self.position, activity: o.self.activity } };
}
const walked = (s) => s.reduce((l, x, i) => (i ? l + Math.hypot(x.p[0] - s[i - 1].p[0], x.p[2] - s[i - 1].p[2]) : 0), 0);

// ---------- the browser (one Chrome machine-wide via the lease)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
const shotUrl = ({ eye, at, wait = 1500 } = {}) => {
  const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(wait) });
  if (eye) q.set('eye', eye.join(',')); if (at) q.set('at', at.join(','));
  return `${base}?${q}`;
};
async function withPage(fn, dpr = 1) {
  const release = await chromeLease('marsland-far e2e').catch(() => null);
  if (!release) { log('  (chrome lease busy; browser checks skipped)'); return null; }
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
    return await fn(await ctx.newPage());
  } finally { if (browser) await browser.close().catch(() => { }); release(); }
}
async function load(page, opts) {
  await page.goto(shotUrl(opts), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 150_000 }).catch(() => log('  (shot not ready in 150 s; going on)'));
  await page.waitForTimeout(opts.extra ?? 3000);
}
/** What the view has: draw calls, triangles, a synced render time (20 renders, readPixels), the far land and panorama, the green ring. */
const probe = (page) => page.evaluate(() => {
  const E = window.__soulsEntity; if (!E) return null;
  const gl = E.renderer.getContext(), px = new Uint8Array(4), t0 = performance.now();
  for (let i = 0; i < 20; i++) { E.renderer.render(E.scene, E.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const renderMs = +((performance.now() - t0) / 20).toFixed(2);
  let far = null, pano = null, ring = null;
  E.scene.traverse((o) => { if (o.userData?.farLand) far = o.userData.farLand; if (o.userData?.panorama) pano = o.userData.panorama; if (o.name === 'entity-horizon') ring = o.visible; });
  const st = E.stats(), cam = E.camera.position.toArray(), tgt = E.controls?.target?.toArray?.() ?? null;
  return { draws: st.draws, tris: st.tris, renderMs, far, pano, ring, viewBounds: E.layer.viewBounds(), cam: cam.map((v) => +v.toFixed(1)), target: tgt?.map((v) => +v.toFixed(1)), camDist: tgt ? +Math.hypot(cam[0] - tgt[0], cam[1] - tgt[1], cam[2] - tgt[2]).toFixed(1) : null, err: E.layer.stats.lastError };
});
async function snap(page, name) {
  const file = resolve(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120_000 });
  report.shots.push({ name, file });
  log(`  📷 ${name}.png`);
}
const VIEWS = [
  { name: 'eye-N', eye: [0, 1.7, 60], at: [0, 1.7, -100] }, { name: 'eye-E', eye: [-60, 1.7, 0], at: [100, 1.7, 0] },
  { name: 'eye-S', eye: [0, 1.7, -60], at: [0, 1.7, 100] }, { name: 'eye-W', eye: [60, 1.7, 0], at: [-100, 1.7, 0] },
  { name: 'up100-N', eye: [0, 100, 550], at: [0, 85, 250] }, { name: 'up100-S', eye: [0, 100, -550], at: [0, 85, -250] },
];

try {
  const bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted in ${bootMs.toFixed(0)} ms`);
  await step('G0 the owner mints a god token; the clock is set to 14:20 (paused), clear desert weather', async () => {
    const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e marsland-far' } }); godToken = r.data.token;
    const e1 = await api('/v1/god/env', { body: { timeOfDay: '14:20', timeScale: 0 } }), e2 = await api('/v1/god/env', { body: { weather: { kind: 'manual', clouds: 0.05, wind: 0.3, rain: 0, fog: 0 } } });
    return { status: r.status, token: !!godToken, env: [e1.data?.accepted, e2.data?.accepted] };
  }, (r) => r.status === 200 && r.token && r.env.every(Boolean));

  let before = null;
  if (chromium) before = await step('B0 before: the arrival frames the cottage; the generic green horizon ring is drawn', () => withPage(async (page) => {
    await load(page, {}); const p = await probe(page); await snap(page, 'before-arrival');
    await load(page, VIEWS[0]); const n = await probe(page); await snap(page, 'before-eye-N');
    await load(page, VIEWS[4]); const u = await probe(page); await snap(page, 'before-up100-N');
    return { arrival: p, eyeN: n, up100N: u };
  }), (r) => r === null || (r.arrival?.ring === true && r.arrival.camDist < 120));

  const placed = await step('G1 the god places core/far-land@1 and core/panorama@1 (unnamed, at the centre) with the Mars data', async () => {
    const r = await act([{ op: 'place', def: 'core/far-land@1', p: [0, 0], params: MARS_FAR_LAND }, { op: 'place', def: 'core/panorama@1', p: [0, 0], params: MARS_PANORAMA }], 'the land beyond the edge, and the mountains around');
    const snap = (await api('/v1/god/snapshot')).data, ents = (snap.entities ?? []).filter((e) => /far-land|panorama/.test(e.def));
    return { accepted: r.data?.accepted, failures: r.data?.failures, ids: r.data?.ids, entities: ents.map((e) => ({ id: e.id, def: e.def, name: e.name ?? null })) };
  }, (r) => r.accepted && r.entities.length === 2);

  await step('G2 the library explains them: defs search finds both, scenery tags, decor layer, generator notes', async () => {
    const d = (await api('/v1/god/defs?q=mountains%20horizon')).data, list = d.defs ?? d.results ?? d;
    const names = (Array.isArray(list) ? list : []).map((x) => x.ref ?? x.name);
    const s = (await api('/v1/god/schema')).data, gens = JSON.stringify(s).match(/far-land\/1|panorama\/1/g) ?? [];
    return { found: names.filter((n) => /far-land|panorama/.test(n)), gens: [...new Set(gens)] };
  }, (r) => r.found.some((n) => /panorama/.test(n)) && r.gens.length === 2);

  if (chromium) await step('B1 after: the arrival still frames the cottage (not kilometres out); the far land and panorama are drawn and the green ring is not; costs', () => withPage(async (page) => {
    await load(page, {}); const p = await probe(page); await snap(page, 'after-arrival');
    const views = {};
    for (const v of VIEWS) { await load(page, v); views[v.name] = await probe(page); await snap(page, v.name); }
    report.samples.costs = { before: before && { eyeN: before.eyeN && { draws: before.eyeN.draws, tris: before.eyeN.tris, renderMs: before.eyeN.renderMs }, up100N: before.up100N && { draws: before.up100N.draws, tris: before.up100N.tris, renderMs: before.up100N.renderMs } }, after: { eyeN: { draws: views['eye-N'].draws, tris: views['eye-N'].tris, renderMs: views['eye-N'].renderMs }, up100N: { draws: views['up100-N'].draws, tris: views['up100-N'].tris, renderMs: views['up100-N'].renderMs } }, far: p.far, pano: p.pano };
    return { arrival: { camDist: p.camDist, viewBounds: p.viewBounds, ring: p.ring, far: p.far, pano: p.pano, err: p.err }, costs: report.samples.costs };
  }), (r) => r === null || (r.arrival.camDist < 120 && r.arrival.ring === false && r.arrival.far?.tris > 0 && r.arrival.pano?.tris > 0 && !r.arrival.err));

  if (chromium && !args['no-dpr2']) await step('B2 the same views at dpr 2 (N at eye height, S from 100 m)', () => withPage(async (page) => {
    for (const v of [VIEWS[0], VIEWS[5]]) { await load(page, v); await snap(page, `${v.name}@2x`); }
    return { ok: true };
  }, 2), (r) => r === null || r.ok);

  // ======================== SOUL
  let soul = null;
  await step('S0 an owner is invited and creates a Soul "Ana"; the owner pairs an agent, which gets a Soul token', async () => {
    const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
    await api('/v1/invite', { as: 'ana', body: { code: inv.data.code } });
    const s = await api('/v1/souls', { as: 'ana', body: { name: 'Ana', description: 'a Mars College resident who walks out to the edge of camp' } });
    soul = s.data.soul;
    const c = await api(`/v1/souls/${soul.id}/pair`, { as: 'ana', body: {} });
    const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'e2e marsland-far agent' } });
    soulToken = x.data.token;
    for (let i = 0; i < 60; i++) { const o = await observe(); if (o?.self?.position) return { soul: soul.id, token: !!soulToken, at: o.self.position }; await sleep(500); }
    return { soul: soul?.id, token: !!soulToken };
  }, (r) => r.token && r.at);

  await step('S1 her capabilities and what she observes carry no giant "far land"/"panorama" thing (unnamed scenery is not a place)', () => until(async () => {
    const c = await caps(), o = await observe(), text = JSON.stringify({ c: c.map((x) => [x.id, x.label]), o });
    return { ok: c.some((x) => x.id === 'walk:cottage') && !/far.?land|panorama/i.test(text), walks: c.filter((x) => x.id.startsWith('walk:')).map((x) => x.id), mentions: (text.match(/far.?land|panorama/gi) ?? []).length };
  }, 30000), (r) => r?.ok);

  await step('S2 she walks to the cottage (normal path finding over the playa)', async () => {
    const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: 'walk:cottage' } })).data; const r = await follow(a, { maxS: 240 });
    return { accepted: a.accepted, reason: a.reason, phase: r.phase, code: r.code, end: r.end, walked: +walked(r.samples).toFixed(1) };
  }, (r) => r.accepted && r.phase === 'completed');

  await step('S3 she walks out to the flag by the edge (520 m south; the far land is beyond it, not underfoot)', async () => {
    const c = (await caps()).find((x) => x.id === 'walk:edge' || /edge/.test(`${x.id} ${x.label}`) && x.id.startsWith('walk:'));
    const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: c?.id ?? 'walk:edge' } })).data; const r = await follow(a, { maxS: 600 });
    const end = r.end?.p; return { cap: c?.id, accepted: a.accepted, reason: a.reason, phase: r.phase, code: r.code, end, near: end ? +Math.hypot(end[0], end[2] - 520).toFixed(1) : null, maxY: Math.max(...r.samples.map((s) => s.p?.[1] ?? 0)) };
  }, (r) => r.accepted && r.phase === 'completed' && r.near < 12 && r.maxY < 1);

  await step('G3 removing the panorama keeps the ring hidden (far land still there); removing both brings the green ring back', async () => {
    const ents = ((await api('/v1/god/snapshot')).data.entities ?? []).filter((e) => /far-land|panorama/.test(e.def));
    const pano = ents.find((e) => /panorama/.test(e.def)), far = ents.find((e) => /far-land/.test(e.def));
    const r1 = await act([{ op: 'remove', id: pano.id }], 'no panorama');
    let ring1 = null, ring2 = null;
    if (chromium) ring1 = await withPage(async (page) => { await load(page, VIEWS[0]); return (await probe(page))?.ring; });
    const r2 = await act([{ op: 'remove', id: far.id }], 'no far land');
    if (chromium) ring2 = await withPage(async (page) => { await load(page, VIEWS[0]); const p = await probe(page); await snap(page, 'removed-eye-N'); return p?.ring; });
    return { removed: [r1.data?.accepted, r2.data?.accepted], ringWithFarLandOnly: ring1, ringWithNeither: ring2 };
  }, (r) => r.removed.every(Boolean) && (ring1Ok(r)));
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# marsland-far e2e — ${slug} — ${report.startedAt}`, '', `${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## costs', '```', JSON.stringify(report.samples.costs ?? null, null, 1), '```', '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
function ring1Ok(r) { return r.ringWithFarLandOnly === null || (r.ringWithFarLandOnly === false && r.ringWithNeither === true); }
