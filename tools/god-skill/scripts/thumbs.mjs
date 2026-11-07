#!/usr/bin/env node
// Render a thumbnail per def and store it (GET /v1/god/defs/<ref>/thumb.png serves it). Owner: L5.
//
//   node tools/god-skill/scripts/thumbs.mjs [--port 4999] [--q <query>] [--mesh] [--limit 40] [--only-missing] [--core]
//
// `--core` also writes worlds/core-assets/thumbs/<def hash>.png (committed; every box serves them).
//
// Starts a scratch world (fresh data dir; shares the box's ASSET_DIR unless --assets <dir>), places each
// def alone on a 40 m grid, frames it from the front-left at a distance fitted to its box, screenshots a
// 256 × 256 picture with the world page's shot mode, and POSTs it. Thumbnails are keyed by def hash, so
// every world on the box that has the same def shows the same picture. `--mesh` = every core mesh def;
// `--q` = whatever the catalog search returns; default: every core def with something to draw.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorld } from '../dev-world.mjs';
import { chromeLease } from '../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const port = Number(args.port ?? 4999), limit = Number(args.limit ?? 400);
const out = resolve(root, '.lane/thumbs'); mkdirSync(out, { recursive: true });
if (args.assets) process.env.ASSET_DIR = resolve(String(args.assets));
const { child, base } = await startWorld({ slug: 'thumbs', port, fresh: true, log: resolve(root, '.lane/thumbs.log') });
const stop = () => { try { child.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const api = async (path, { body, raw, headers = {}, token } = {}) => {
  const h = { authorization: `Bearer ${token ?? 'dev:admin'}`, ...headers }; if (body) h['content-type'] = 'application/json';
  const r = await fetch(base + path, { method: body || raw ? 'POST' : 'GET', headers: h, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const token = (await api('/v1/god/mint', { body: { label: 'thumbs' } })).data.token;
const god = (p, o = {}) => api(p, { ...o, token });

let defs = (await god(`/v1/god/defs?limit=500${args.q ? `&q=${encodeURIComponent(args.q)}` : ''}`)).data.defs;
defs = defs.filter((d) => d.make.kind !== 'none' && d.make.kind !== 'parts' && d.form === 'point' && !d.tags.includes('landform') && !d.components?.body);
if (args.mesh) defs = defs.filter((d) => d.make.kind === 'mesh');
if (args['only-missing']) defs = defs.filter((d) => !d.thumb);
defs = defs.slice(0, limit);
console.log(`thumbs: ${defs.length} defs`);

// place them all at once on a grid (one batch per 40 so a bad one refuses alone)
const GRID = 40, cols = Math.ceil(Math.sqrt(defs.length));
const big = (d) => Math.max(...d.size.box) > 10;
const bigIdx = new Map(defs.filter(big).map((d, k) => [d.name, k]));
const spot = (i) => (big(defs[i]) ? [260 + bigIdx.get(defs[i].name) * 120, 300] : [((i % cols) - cols / 2) * GRID, (Math.floor(i / cols) - cols / 2) * GRID]);
const placed = [];
for (let i = 0; i < defs.length; i += 40) {
  const chunk = defs.slice(i, i + 40);
  const ops = chunk.map((d, j) => ({ op: 'place', def: d.publicRef, name: `t${i + j}`, p: spot(i + j), mode: 'nudge', ...(d.anchor === 'float' ? { anchor: 'base' } : {}) }));
  const r = await god('/v1/god/act', { body: { ops, note: 'thumbs' } });
  if (r.data?.accepted) placed.push(...chunk.map((d, j) => ({ d, i: i + j })));
  else for (const [j, op] of ops.entries()) { const r1 = await god('/v1/god/act', { body: { ops: [op] } }); if (r1.data?.accepted) placed.push({ d: chunk[j], i: i + j }); else console.log(`  skip ${chunk[j].publicRef}: ${r1.data?.failures?.[0]?.code}`); }
}
const pose = async (name) => { const r = (await api(`/v1/world/entities/${name}`)).data; return r?.pose ? { ...r.pose, id: r.entity.id } : null; };

const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
const releaseChrome = await chromeLease('L5-thumbs');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 768, height: 768 } })).newPage();
page.setDefaultTimeout(900_000);
const first = placed[0];
const p0 = first ? await pose(`t${first.i}`) : { x: 0, y: 0, z: 0 };
await page.goto(`${base}?dev=1&shot=1&eye=${p0.x - 3},${p0.y + 2},${p0.z + 4}&at=${p0.x},${p0.y + 0.5},${p0.z}&settle=4000`, { waitUntil: 'domcontentloaded', timeout: 900_000 });
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 1_200_000, polling: 2000 });
let ok = 0;
for (const { d, i } of placed) {
  const p = await pose(`t${i}`); if (!p) continue;
  // wait until this entity's GLB (if any) has loaded
  await page.waitForFunction((name) => { let ready = true; window.__soulsEntity.layer.group.traverse((o) => { if (o.name === name && !o.getObjectByName('asset') && !o.getObjectByName('asset missing')) ready = false; }); return ready; }, `mesh ${d.name}`, { timeout: 60_000 }).catch(() => {});
  // frame what is drawn now (animals wander and kin hover away from their resting pose): the object's live
  // position and yaw, the def's box for its size (the mesh half fits the model to it), seen from its
  // front-left (front = +z in its own frame). The page keeps its camera 2 m or more away and its own lens,
  // so the picture is cropped around the object's projection from a fresh render and scaled to 256 × 256.
  const [bw, bh, bd] = d.size.box, sc = p.s ?? 1;
  const shot = await page.evaluate(async ([id, fb]) => {
    const s = window.__soulsEntity, dr = s.layer.drawn.get(id), o = dr && !dr.inst ? dr.obj : null;
    const c = o ? [o.position.x, o.position.y + fb.h / 2, o.position.z] : fb.at, yaw = o ? o.rotation.y : fb.yaw;
    const dist = Math.max(2.4, fb.r * 2.6), k = fb.flat ? [-0.35, 1.1, 0.55] : [-0.55, 0.42, 0.8], n = Math.hypot(...k), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const eye = [c[0] + (k[0] * cy + k[2] * sy) / n * dist, c[1] + k[1] / n * dist, c[2] + (-k[0] * sy + k[2] * cy) / n * dist];
    s.controls.target.set(c[0], c[1], c[2]); s.camera.position.set(eye[0], eye[1], eye[2]); s.camera.lookAt(s.controls.target); s.controls.update?.();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    // where the object is now on screen, with whatever camera the page settled on
    const cam = s.camera, cc = o ? [o.position.x, o.position.y + fb.h / 2, o.position.z] : c;
    const v = cam.position.clone().set(cc[0], cc[1], cc[2]), dcam = cam.position.distanceTo(v);
    v.project(cam);
    const src = s.renderer.domElement, W = src.width, H = src.height;
    const rpx = (fb.r / Math.max(0.01, dcam)) / Math.tan(cam.fov * Math.PI / 360) * (H / 2);
    const side = Math.max(40, Math.min(Math.min(W, H), rpx * 2.3));
    const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H;
    const x0 = Math.max(0, Math.min(W - side, px - side / 2)), y0 = Math.max(0, Math.min(H - side, py - side * 0.52));
    s.renderer.render(s.scene, cam);   // draw now, then copy in the same task (the drawing buffer is not preserved)
    const out = document.createElement('canvas'); out.width = out.height = 256;
    const g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, x0, y0, side, side, 0, 0, 256, 256);
    return { live: !!o, url: out.toDataURL('image/png'), side: Math.round(side) };
  }, [p.id, { at: [p.x, p.y + bh * sc / 2, p.z], h: bh * sc, r: Math.hypot(bw, bh, bd) * 0.5 * sc, yaw: p.yaw ?? 0, flat: bh < 0.15 * Math.max(bw, bd) }]);   // rugs, boards, plates: look down on them
  if (!shot.live) console.log(`  ${d.publicRef}: framed from the server pose (instanced or no live object)`);
  const png = Buffer.from(shot.url.split(',')[1], 'base64');
  writeFileSync(resolve(out, `${d.name}.png`), png);
  if (args.core && d.ref.startsWith('core-')) { mkdirSync(resolve(root, 'worlds/core-assets/thumbs'), { recursive: true }); writeFileSync(resolve(root, 'worlds/core-assets/thumbs', `${d.hash}.png`), png); }
  const put = await god(`/v1/god/defs/${d.publicRef}/thumb.png`, { raw: png, headers: { 'content-type': 'image/png' } });
  if (put.status === 200) ok++; else console.log(`  ${d.publicRef}: ${put.status} ${JSON.stringify(put.data)}`);
}
await browser.close(); releaseChrome();
console.log(`thumbs: ${ok}/${placed.length} stored (copies in ${out})`);
stop(); process.exit(0);
