#!/usr/bin/env node
// Buildings e2e (lane L2; spec <eden4>/29 WP2, 33 §5): a fresh world where the god builds a
// two-floor furnished cottage, a hall and a lighthouse; checks rooms, stairs and doors through
// /v1/god/query; is refused a table through a wall and a house with a sealed room; sets a furnished
// cottage from one floor to two keeping its furniture, undoes it; and photographs outside views and
// the interior view (?hideRoofs=1). Report under .lane/e2e-buildings/<stamp>/.
//
//   node tools/god-skill/e2e/buildings.mjs [--port 4993] [--keep] [--no-shots]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldModel } from '../../../packages/world-compiler/src/index.ts';
import { furnishBatch } from '../lib/furnish.mjs';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((x) => x.length));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = `bld-${stamp.slice(11, 19).replace(/-/g, '')}`;
const port = Number(args.port ?? 4993);
const out = resolve(root, '.lane/e2e-buildings', stamp);
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const t = () => performance.now();
const log = (...a) => console.log(...a);

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}` };
const server = spawn('node', ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
process.on('exit', () => { if (!args.keep) try { server.kill(); } catch { } });
const bootT = t();
for (let i = 0; i < 1200; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) break; } catch { } await new Promise((r) => setTimeout(r, 100)); }
log(`▶ world ${slug} on :${port} booted in ${((t() - bootT) / 1000).toFixed(1)} s`);

let token = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god' && token) headers.authorization = `Bearer ${token}`;
  if (as === 'owner') headers.authorization = 'Bearer dev:admin';
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e); }
  const ok = !error && (expect ? !!expect(result) : true);
  const brief = summarize(result);
  report.steps.push({ name, ms: +(t() - t0).toFixed(1), ok, result: brief, error });
  if (!ok) report.failures.push({ name, result: brief, error });
  log(`${ok ? '✔' : '✖'} ${name} — ${(t() - t0).toFixed(0)} ms${ok ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 400)}`);
  return result;
}
const summarize = (r) => { try { return JSON.parse(JSON.stringify(r, (k, v) => (k === 'ids' ? undefined : v)).slice(0, 4000)); } catch { return String(r).slice(0, 2000); } };
const accepted = (r) => r?.status === 200 && r.data?.accepted === true;
const act = (ops, note, group) => api('/v1/god/act', { body: { ops, note, ...(group ? { group } : {}) } });
const snapshot = async () => (await api('/v1/world/snapshot', { as: 'none' })).data;
const query = async (entity) => (await api('/v1/god/query', { body: { entity } })).data.entity;
const mirror = async () => { const s = (await api('/v1/god/snapshot')).data; return WorldModel.fromSnapshot({ constants: s.constants, state: s.state, seed: s.seed ?? slug, seq: s.counter ?? 0, editSeq: s.seq, defs: [...s.defs, ...(s.library ?? [])], entities: s.entities, ground: s.ground }); };

// ---------- screenshots (the viewer's Playwright, Chrome, swiftshader); generous timeouts under load
let chromium = null, browser = null, page = null, lastUrl = '', releaseChrome = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
async function shot(name, { eye, at, q = {} }) {
  if (!chromium) return;
  const t0 = t();
  try {
    if (!browser) { releaseChrome = await chromeLease('buildings-e2e'); browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] }); const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } }); await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); }); page = await ctx.newPage(); }
    // one page load; the interior view switches live (window.__buildingView) so views do not reload
    if (!lastUrl) {
      lastUrl = `${base}?${new URLSearchParams({ dev: '1', eye: eye.join(','), at: at.join(',') })}`;
      await page.goto(lastUrl, { waitUntil: 'commit', timeout: 300000 });
      await page.waitForFunction(() => window.__soulsEntity?.layer?.active && window.__soulsEntity.layer.drawn?.size > 0, null, { timeout: 900000, polling: 5000 });
      await page.waitForFunction(() => !document.querySelector('.viewer-arrival'), null, { timeout: 300000, polling: 3000 }).catch(() => {});
      await page.waitForTimeout(8000);
      await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (b.textContent.trim() === '×') b.click(); }).catch(() => {});
    }
    await page.evaluate(([e, a, v]) => { window.__buildingView = v; const w = window.__soulsEntity; w.controls.target.set(a[0], a[1], a[2]); w.camera.position.set(e[0], e[1], e[2]); w.camera.lookAt(w.controls.target); w.controls.update?.(); }, [eye, at, { hideRoofs: q.hideRoofs === '1', cut: q.cut !== undefined ? Number(q.cut) : null }]);
    await page.waitForTimeout(4000);
    const state = await page.evaluate(() => { const w = window.__soulsEntity; let tris = 0, draws = 0; w.layer.group.traverse((o) => { if (o.isMesh && o.parent?.parent?.name === 'building-canonical') { draws++; tris += o.geometry.attributes.position.count / 3; } }); return { drawn: w.layer.drawn?.size, lastError: w.layer.stats.lastError, buildingDraws: draws, buildingTris: Math.round(tris) }; });
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: 300000 });
    report.shots.push({ name, file, state, ms: +(t() - t0).toFixed(0) });
    log(`  📷 ${name}.png ${JSON.stringify(state)} (${((t() - t0) / 1000).toFixed(0)} s)`);
  } catch (e) { report.shots.push({ name, error: String(e).slice(0, 300) }); log(`  (shot ${name} failed: ${String(e).split('\n')[0]})`); }
}

// ================================================================ scenario
const FLOOR1_Y = 2.8 + 0.1;
try {
  await step('B0 mint god token', async () => { const r = await api('/v1/god/mint', { as: 'owner', body: { label: 'e2e-buildings' } }); token = r.data.token; return r; }, (r) => r.status === 200 && !!token);

  await step('B1 build a two-floor cottage with porch and balcony, a hall and a lighthouse', () => act([
    { op: 'place', def: 'core/cottage@1', name: 'house', p: [0, 0], params: { floors: 2, porch: 1.6, balcony: true } },
    { op: 'place', def: 'core/hall@1', name: 'hall', p: [30, 0], r: -0.3 },
    { op: 'place', def: 'core/lighthouse@1', name: 'lighthouse', p: [-26, 6] },
    { op: 'place', def: 'core/cottage@1', name: 'cot', p: [0, 26], params: { material: 'stone', wall: '#d9d2c3', roofColor: '#4f5a60' } },
  ], 'B1 buildings', 'buildings'), accepted);

  const house = await step('B2 query the cottage: rooms on two floors, stairs 0→1, a front door, all reachable', () => query('house'), (e) =>
    e.rooms.filter((r) => r.floor === 0).length >= 2 && e.rooms.filter((r) => r.floor === 1).length >= 2 && e.links.some((l) => l.kind === 'stairs' && l.from === 0 && l.to === 1) &&
    e.openings.some((o) => o.id === 'front-door' && o.kind === 'door') && e.openings.filter((o) => o.kind === 'window').length >= 6 && e.notes.some((n) => /reachable from outside: all/.test(n)) && !e.notes.some((n) => n.startsWith('violation')));
  await step('B2 query the hall and the lighthouse: one big room; a helix up five floors to the lantern', async () => ({ hall: await query('hall'), lh: await query('lighthouse') }), ({ hall, lh }) =>
    hall.rooms.some((r) => r.id === 'hall') && hall.openings.some((o) => o.id === 'front-door') && lh.links.length === 4 && lh.rooms.length === 5 && lh.rooms[4].id === 'lantern' && lh.slots.some((s) => s.id === 'balcony') && lh.notes.some((n) => /reachable from outside: all 5/.test(n)));

  const furnished = await step('B3 furnish the cottage (recipe cottage, dry-run then commit)', async () => {
    const f = furnishBatch(await mirror(), 'house');
    const dry = await api('/v1/god/preview', { body: { ops: f.ops } });
    const r = await act(f.ops, 'B3 furnish', 'furnish');
    return { notes: f.notes, dropped: f.dropped, n: f.ops.length, dry: dry.data?.accepted, r: r.data };
  }, (x) => x.n >= 5 && x.dry === true && x.r?.accepted === true);
  await step('B3 furniture in an upstairs room stands on floor 1; downstairs on floor 0', async () => {
    const s = await snapshot(), m = await mirror(), h = s.entities.find((e) => e.name === 'house');
    const kids = s.entities.filter((e) => e.in.parent === h.id);
    const bedroom = kids.find((e) => e.in.slot === 'bedroom' || e.in.slot === 'bedroom-2'), kitchen = kids.find((e) => e.in.slot === 'kitchen');
    const yb = m.worldPose(m.get(bedroom.id)).y - h.p[1], yk = m.worldPose(m.get(kitchen.id)).y - h.p[1];
    return { kids: kids.length, bedroom: bedroom?.name, yb: +yb.toFixed(3), yk: +yk.toFixed(3) };
  }, (x) => x.kids >= 5 && Math.abs(x.yb - FLOOR1_Y) < 0.02 && Math.abs(x.yk - 0.1) < 0.02);

  await step('B4 a table pushed through the front wall is refused, naming the wall', () => act([{ op: 'place', def: 'core/table@1', name: 'bad-table', in: { parent: 'cot', slot: 'living' }, p: [-0.5, 0, 2.6] }]), (r) => r.status === 200 && r.data.accepted === false && r.data.failures[0].code === 'overlap.solid' && /wall/.test(r.data.failures[0].detail));
  await step('B4 the same table inside the room is accepted', () => act([{ op: 'place', def: 'core/table@1', name: 'ok-table', in: { parent: 'cot', slot: 'living' }, p: [0.4, 0, 0.8] }]), accepted);
  await step('B4 a house whose store room has no door is refused (architecture: room.unreachable)', () => act([{ op: 'place', def: 'core/cottage@1', name: 'sealed', p: [40, 30], params: { w: 10, d: 8, plan: { floors: [{ rooms: [{ id: 'kitchen', rect: [0, 0, 4, 6] }, { id: 'living', rect: [4, 0, 10, 8] }, { id: 'store', rect: [0, 6, 4, 8] }], doors: [{ between: ['kitchen', 'living'] }], exterior: [{ room: 'living', wall: 's', kind: 'door' }] }] } } }]), (r) => r.status === 200 && r.data.accepted === false && r.data.failures[0].code === 'architecture' && /store/.test(r.data.failures[0].detail));

  // the one-floor stone cottage: furnish it, then add a floor
  const before = await step('B5 furnish the one-floor cottage', async () => { const f = furnishBatch(await mirror(), 'cot'); const r = await act(f.ops, 'B5 furnish cot'); return { r: r.data, n: f.ops.length }; }, (x) => x.r?.accepted && x.n >= 4);
  const kidsOf = async (name) => { const s = await snapshot(); const c = s.entities.find((e) => e.name === name); return { c, kids: s.entities.filter((e) => e.in.parent === c.id).map((e) => ({ name: e.name, slot: e.in.slot, p: e.p })) }; };
  const k1 = await kidsOf('cot');
  await step('B5 set floors 1 → 2: the furniture stays (kitchen and living exactly where they were)', async () => {
    const r = await act([{ op: 'set', id: 'cot', params: { floors: 2 } }], 'B5 add a floor', 'floors');
    const k2 = await kidsOf('cot'), q = await query('cot');
    const same = k1.kids.filter((k) => k.slot === 'kitchen' || k.slot === 'living').every((k) => JSON.stringify(k2.kids.find((x) => x.name === k.name)?.p) === JSON.stringify(k.p));
    return { r: r.data, n1: k1.kids.length, n2: k2.kids.length, same, floors: [...new Set(q.rooms.map((x) => x.floor))].length, slotsOk: k2.kids.every((k) => !k.slot || q.slots.some((s) => s.id === k.slot)) };
  }, (x) => x.r?.accepted && x.n1 === x.n2 && x.same && x.floors === 2 && x.slotsOk);
  await step('B5 undo: back to one floor, the same furniture', async () => { const r = await api('/v1/god/undo', { method: 'POST' }); const q = await query('cot'); const k = await kidsOf('cot'); return { r: r.data, floors: [...new Set(q.rooms.map((x) => x.floor))].length, n: k.kids.length }; }, (x) => x.r?.accepted !== false && x.floors === 1 && x.n === k1.kids.length);
  await step('B6 move the furnished cottage; everything rides along', async () => { const r = await act([{ op: 'move', id: 'house', p: [4, -4], r: 0.4 }]); const k = await kidsOf('house'); return { r: r.data, n: k.kids.length }; }, (x) => x.r?.accepted && x.n >= 5);

  // pictures, framed on where things stand now: outside, the lighthouse, the hall, roofs off, the ground floor cut, a camera in the living room
  const m = await mirror();
  const W = (name, lx, ly, lz) => { const e = m.get(name), p = m.worldPose(e), c = Math.cos(p.yaw), sn = Math.sin(p.yaw); return [+(p.x + lx * c + lz * sn).toFixed(2), +(p.y + ly).toFixed(2), +(p.z - lx * sn + lz * c).toFixed(2)]; };
  const slot = (id) => m.slotsOf(m.get('house')).find((x) => x.id === id).p;
  const living = slot('living'), kitchen = slot('kitchen');
  await shot('b-outside', { eye: W('house', -9, 6, 14), at: W('house', 0, 2.5, 0) });
  await shot('b-lighthouse', { eye: W('lighthouse', 12, 9, 18), at: W('lighthouse', 0, 8, 0) });
  await shot('b-hall-cottage', { eye: W('hall', -14, 9, 22), at: W('hall', -8, 2, 6) });
  await shot('b-roofs-off', { eye: W('house', -5, 15, 11), at: W('house', 0, 2, 0), q: { hideRoofs: '1' } });
  await shot('b-cut-ground', { eye: W('house', -5, 13, 10), at: W('house', 0, 0, 0), q: { hideRoofs: '1', cut: '0' } });
  await shot('b-inside', { eye: W('house', living[0] + 1.6, 1.65, living[2] + 2.0), at: W('house', kitchen[0], 1.0, kitchen[2] - 0.5) });
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('harness error', e);
} finally {
  if (browser) await browser.close().catch(() => { });
  releaseChrome?.();
  report.summary = { steps: report.steps.length, failed: report.failures.length, shots: report.shots.filter((s) => s.file).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  writeFileSync(resolve(out, 'REPORT.md'), [`# buildings e2e — ${slug} — ${report.startedAt}`, '', `${report.summary.steps} steps · ${report.summary.failed} failed · ${report.summary.shots} shots`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 200).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: ${s.file ? '`' + s.file + '` ' + JSON.stringify(s.state) : 'failed ' + s.error}`)].join('\n'));
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed, ${report.summary.shots} shots. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) try { server.kill(); } catch { }
  process.exit(report.summary.failed ? 1 : 0);
}
