#!/usr/bin/env node
// XP8 faces e2e: a real world server on the lane's port and real headless Chrome, with a network log of every request
// the page makes.
//
//   node tools/god-skill/e2e/faces.mjs [--port 5367] [--keep]
//
// Starts its own world (fresh DATA_DIR and ASSET_DIR, fake minds) and, as a god agent would over HTTP:
//  F1 uploads one PNG to this world's asset store;
//  F2 is refused a kit whose face shows an external image, and a shop decal on a slot it does not have;
//  F3 defines and places the menu board (one kit, text faces), the stained-glass window (one face) and the mosaic;
//  F4 shows the uploaded PNG on a two-sided poster kit and on a shop decal beside a painted sign and a gable mosaic;
//  F5 opens the world in Chrome; every request to a host other than 127.0.0.1/localhost is aborted (never contacted)
//     and logged; checks the faces are drawn and the image came from this world's /assets/;
//  F6 zero external image requests in the network log.
// Writes .lane/e2e/faces-<stamp>/{report.json,network-log.json,*.png}; the test world's data/ and assets/ are deleted
// when the run ends (--keep leaves the server running and both folders in place).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const port = Number(args.port ?? 5367), slug = 'faces-e2e';
const out = resolve(root, '.lane/e2e', `faces-${stamp}`); mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const fixtures = JSON.parse(readFileSync(resolve(root, 'packages/generators/src/fixtures/faces-kits.json'), 'utf8'));
const report = { port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);

// ---------- world
const server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1', DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: resolve(out, 'data'), ASSET_DIR: resolve(out, 'assets'), PUBLIC_URL: `http://127.0.0.1:${port}` } });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
process.on('exit', () => { if (!args.keep) try { server.kill(); } catch { /* gone */ } });
let up = false;
for (let i = 0; i < 1200 && !up; i++) { try { up = (await fetch(`${base}/healthz`)).ok; } catch { /* booting */ } if (!up) await new Promise((r) => setTimeout(r, 100)); }
if (!up) { console.error(serverLog.slice(-2000)); throw new Error(`world did not come up on :${port}`); }

let token = '';
async function api(path, { method, body } = {}) {
  const h = { authorization: `Bearer ${token || 'dev:admin'}` };
  if (body && !(body instanceof FormData)) h['content-type'] = 'application/json';
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: h, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* not json */ }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e); }
  const okay = !error && (expect ? !!expect(result) : true), brief = JSON.stringify(result?.data ?? result ?? null)?.slice(0, 600);
  report.steps.push({ name, ms: Math.round(performance.now() - t0), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name}${okay ? '' : ' — ' + (error ?? brief).slice(0, 600)}`);
  return result;
}
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const accepted = (r) => r.status === 200 && r.data?.accepted === true;

/** A small real PNG (a framed sunset) so the asset store measures and serves it. */
function png(w = 64, h = 48) {
  const rows = [];
  for (let y = 0; y < h; y++) { const row = [0]; for (let x = 0; x < w; x++) { const edge = x < 3 || y < 3 || x >= w - 3 || y >= h - 3, sun = Math.hypot(x - w * 0.68, y - h * 0.38) < 8; row.push(...(edge ? [90, 60, 40] : sun ? [250, 214, 120] : y > h * 0.62 ? [60, 110, 70] : [120 + y * 2, 150, 210 - y])); } rows.push(Buffer.from(row)); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- browser with a network log
let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { try { chromium = createRequire(resolve(root, 'package.json'))('playwright').chromium; } catch { log('  (no playwright; browser steps skipped)'); } }
const network = [], pageErrors = [];
let browser = null, page = null, releaseChrome = null;
const loopback = (url) => { try { const u = new URL(url); return !/^https?:$/.test(u.protocol) || ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname); } catch { return false; } };
async function look(name, eye, at, settle = 4000) {
  if (!chromium) return null;
  if (!page) {
    releaseChrome = await chromeLease('Y2-faces-e2e', { waitMs: 20 * 60_000 }); // one Chrome per machine, shared by every lane
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    page.setDefaultTimeout(600_000);
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    // Never contact another host: abort it and log the attempt.
    await page.route('**/*', (route) => { const r = route.request(), ok = loopback(r.url()); network.push({ url: r.url(), type: r.resourceType(), blocked: !ok }); return ok ? route.continue() : route.abort(); });
    await page.goto(`${base}?dev=1&shot=1&eye=${eye.join(',')}&at=${at.join(',')}&settle=3000`, { waitUntil: 'domcontentloaded', timeout: 600_000 });
    await page.waitForFunction(() => document.title === 'ready' || document.title === 'no-entity-world', null, { timeout: 900_000, polling: 1000 });
  }
  await page.evaluate(([e, a]) => { const s = window.__soulsEntity; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.camera.lookAt(s.controls.target); s.controls.update?.(); }, [eye, at]);
  await page.waitForTimeout(settle);
  const state = await page.evaluate(() => {
    const faces = {}, images = [];
    window.__soulsEntity.scene.traverse((o) => {
      const kind = o.isMesh && o.material?.userData?.face; if (!kind) return;
      faces[kind] = (faces[kind] ?? 0) + (o.isInstancedMesh ? o.count : 1);
      const img = o.material.map?.image; if (kind === 'image') images.push({ src: img?.currentSrc ?? img?.src ?? null, loaded: !!(img?.naturalWidth || img?.width) });
    });
    // Decals measured in their building's own frame against the slot each names (slot.p + at along the wall).
    const decals = [], m = window.__soulsEntity.layer.model, shop = m?.get('bakery');
    window.__soulsEntity.scene.updateMatrixWorld(true);
    window.__soulsEntity.scene.traverse((o) => {
      if (o.name !== 'building-decal') return;
      let root = o; while (root.parent && root.name !== 'building') root = root.parent;
      const pos = o.geometry.attributes.position, c = root.position.clone().set(0, 0, 0), v = c.clone(), toRoot = root.matrixWorld.clone().invert().multiply(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) c.add(v.fromBufferAttribute(pos, i).applyMatrix4(toRoot));
      c.divideScalar(pos.count || 1);
      decals.push({ face: o.material.userData.face, at: [c.x, c.y, c.z].map((v) => Math.round(v * 1000) / 1000) });
    });
    const slots = shop ? Object.fromEntries(m.slotsOf(shop).map((s) => [s.id, { p: s.p, yaw: s.yaw }])) : {};
    return { faces, images, decals, slots, decalParams: shop?.params?.decals ?? null, stats: window.__soulsEntity.stats(), lastError: window.__soulsEntity.layer.stats?.lastError ?? null };
  });
  const file = resolve(out, `${name}.png`); await page.screenshot({ path: file });
  report.shots.push({ name, file, state, errors: [...pageErrors] });
  log(`  shot ${name}.png faces ${JSON.stringify(state.faces)}`);
  return state;
}

try {
  await step('F0 mint a god token', async () => { const r = await api('/v1/god/mint', { body: { label: 'faces-e2e' } }); token = r.data?.token ?? ''; return r; }, (r) => r.status === 200 && token.startsWith('god_'));
  const form = new FormData(); form.set('file', new Blob([png()], { type: 'image/png' }), 'sunset.png');
  const upload = await step('F1 upload one PNG to this world', () => api('/v1/god/assets', { body: form }), (r) => r.status === 200 && /^\/assets\/[0-9a-f]{64}\.png$/.test(r.data?.asset?.url ?? ''));
  const image = upload?.data?.asset?.url;
  await step('F2 an external face image is refused (params.invalid, field, fix)', () => act([{ op: 'define', def: { schema: 'def/1', name: 'tracker-poster', layer: 'decor', size: { box: [1, 1.4, 0.1] }, make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes: [{ kind: 'box', at: [0, 0.7, 0], size: [1, 1.4, 0.04], faces: [{ image: 'https://example.invalid/pixel.png' }] }] } } } }]),
    (r) => r.data?.accepted === false && r.data.failures?.[0]?.code === 'params.invalid' && r.data.failures[0].field === 'make.args.shapes.0.faces.0.image' && /POST \/v1\/god\/assets/.test(r.data.failures[0].fix));
  await step('F2 a decal on a slot the shop lacks is refused', () => act([{ op: 'place', def: 'core/shop@1', name: 'nowhere-shop', p: [40, 40], params: { decals: [{ slot: 'facade-f9-s-1', w: 1, h: 1, text: 'X' }] } }]),
    (r) => r.data?.accepted === false && r.data.failures?.[0]?.field === 'params.decals.0.slot');
  const kits = [[fixtures.menuBoard, [0, 10]], [fixtures.stainedGlassWindow, [4, 10]], [fixtures.mosaicMedallion, [8, 10]]];
  for (const [def, p] of kits) await step(`F3 define and place ${def.name}`, () => act([{ op: 'define', def }, { op: 'place', def: `${def.name}@1`, name: def.name, p }]), accepted);
  await step('F4 a two-sided poster kit shows the uploaded image', () => act([{ op: 'define', def: { schema: 'def/1', name: 'poster', layer: 'decor', size: { box: [1, 1.6, 0.1] }, make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes: [{ kind: 'box', at: [0, 1, 0], size: [1, 1.2, 0.04], color: '#5e412b', faces: [{ image }, { side: 'back', image }] }, { kind: 'box', at: [0, 0.2, 0], size: [0.06, 0.4, 0.06], color: '#5e412b' }] } } } }, { op: 'place', def: 'poster@1', name: 'poster', p: [-4, 10] }]), accepted);
  await step('F4 a shop with a painted sign, a gable mosaic and the image as a decal', () => act([{ op: 'place', def: 'core/shop@1', name: 'bakery', p: [0, -8], params: { decals: [...fixtures.shopDecals, { slot: 'facade-f1-s-1', w: 1.1, h: 0.8, at: [2, 0.1], image }] } }]), accepted);

  const views = [['menu-board', [0, 1.5, 12.6], [0, 1.25, 10]], ['stained-glass-window', [4, 1.7, 14.5], [4, 1.6, 10]], ['poster', [-4, 1.2, 12.4], [-4, 1, 10]], ['mosaic', [8, 2.4, 12], [8, 0, 10]], ['shop-decals', [3.5, 3.6, 8], [0, 4, -3.5]]];
  const states = [];
  for (const [name, eye, at] of views) states.push(await look(name, eye, at));
  const last = states.at(-1);
  if (chromium) {
    await step('F5 the page draws every face (3 text + 2 image on kits, 1 stained glass, 1+1 mosaic, decals: 1 text + 1 image)', async () => last, (s) => s && s.faces.text >= 4 && s.faces['stained-glass'] >= 1 && s.faces.mosaic >= 2 && s.faces.image >= 3 && !s.lastError);
    await step('F5 every shop decal sits on the wall slot it names (building frame, within 2 cm)', async () => {
      const misses = (last.decalParams ?? []).map((d) => {
        const s = last.slots[d.slot], [ax, ay] = d.at ?? [0, 0], want = [s.p[0] + Math.cos(s.yaw) * ax, s.p[1] + ay, s.p[2] - Math.sin(s.yaw) * ax];
        const err = Math.min(...last.decals.map((x) => Math.hypot(x.at[0] - want[0], x.at[1] - want[1], x.at[2] - want[2])));
        return { slot: d.slot, want: want.map((v) => Math.round(v * 1000) / 1000), err: Math.round(err * 1000) / 1000 };
      });
      return { decals: last.decals, misses };
    }, (r) => r.misses.length === 3 && r.decals.length === 3 && r.misses.every((x) => x.err < 0.02));
    await step('F5 face images loaded from this world\'s /assets/', async () => last.images, (imgs) => imgs.length >= 3 && imgs.every((i) => i.loaded && new URL(i.src).pathname === `/w/${slug}${image}`));
    const external = network.filter((n) => !loopback(n.url)), externalImages = external.filter((n) => n.type === 'image' || /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(n.url));
    const assetImages = network.filter((n) => new URL(n.url).pathname === `/w/${slug}${image}`);
    report.network = { requests: network.length, external: external.length, externalHosts: [...new Set(external.map((n) => new URL(n.url).host))], externalImages: externalImages.length, assetImages: assetImages.length };
    await step('F6 zero external image requests in the network log; the face image is a same-origin world asset', async () => report.network, (n) => n.externalImages === 0 && n.assetImages >= 1);
  }
} finally {
  writeFileSync(resolve(out, 'network-log.json'), JSON.stringify(network, null, 1) + '\n');
  report.finishedAt = new Date().toISOString(); report.ok = report.failures.length === 0; report.pageErrors = pageErrors;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  try { await browser?.close(); } catch { /* closed */ }
  releaseChrome?.();
  if (!args.keep) {
    // Stop our own world, then delete its DB and asset copies (contract: test worlds are deleted).
    if (server.exitCode === null && server.signalCode === null) await new Promise((r) => { server.once('exit', r); server.kill(); setTimeout(r, 10_000); });
    for (const dir of ['data', 'assets']) rmSync(resolve(out, dir), { recursive: true, force: true });
    report.cleaned = ['data', 'assets'].every((dir) => !existsSync(resolve(out, dir)));
    writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  log(`${report.ok ? 'PASS' : 'FAIL'} ${report.steps.filter((s) => s.ok).length}/${report.steps.length} — ${out}`);
  if (!report.ok && existsSync(out)) writeFileSync(resolve(out, 'server.log'), serverLog);
  process.exitCode = report.ok ? 0 : 1;
}
