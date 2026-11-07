#!/usr/bin/env node
// VOCAB-MECH: what a viewer and a god agent download for a world with many types. Starts a scratch world, places one
// of every point def in the library on a grid (or --n of them), and measures:
//   the viewer's snapshot (GET /v1/world/snapshot) raw and as sent (gzip when the browser asks), its def share, the GLB
//   bytes the defs in use load (snapshot assetBytes), the number of distinct GLBs; the god's catalog (lines, json).
//   node tools/god-skill/scripts/vocab-payload.mjs [--port 5576] [--n 400] [--out .lane/payload.json]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startWorld } from '../dev-world.mjs';
import { chromeLease } from '../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const port = Number(args.port ?? 5576), n = Number(args.n ?? 400);
const { child, base } = await startWorld({ slug: 'payload', port, fresh: true, log: resolve(root, '.lane/payload.log') });
process.on('exit', () => { try { child.kill(); } catch { } });
const api = async (path, { body, token, headers = {} } = {}) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, buf, headers: r.headers }; };
const token = JSON.parse((await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'payload' } })).buf).token;
const defs = JSON.parse((await api('/v1/god/defs?limit=500', { token })).buf).defs
  .filter((d) => d.form === 'point' && d.make.kind !== 'none' && !d.tags.includes('landform') && !d.components?.body && !d.components?.landform && d.layer !== 'volume').slice(0, n);
let placed = 0, i = 0;
const cols = Math.ceil(Math.sqrt(defs.length)), step = Number(args.step ?? 14);
for (const d of defs) {
  const x = (i % cols - cols / 2) * step, z = (Math.floor(i / cols) - cols / 2) * step; i++;
  const r = JSON.parse((await api('/v1/god/act', { token, body: { ops: [{ op: 'place', def: d.publicRef, p: [x, z], mode: 'nudge' }] } })).buf);
  if (r.accepted) placed++;
}
const raw = await api('/v1/world/snapshot', { headers: { 'accept-encoding': 'identity' } }), gz = await api('/v1/world/snapshot', { headers: { 'accept-encoding': 'gzip' } });
const snap = JSON.parse(raw.buf), defsBytes = Buffer.byteLength(JSON.stringify(snap.defs)), glb = Object.values(snap.assetBytes ?? {}).reduce((a, b) => a + b, 0);
const cat = await api('/v1/god/catalog?format=lines&per=2000', { token }), catJson = await api('/v1/god/catalog?per=2000', { token });
const out = {
  at: new Date().toISOString(), types: defs.length, placed, entities: snap.entities.length, defsInUse: snap.defs.length,
  snapshot: { raw: raw.buf.length, sent: gz.buf.length, encoding: gz.headers.get('content-encoding') ?? 'identity', gzipIfCompressed: gzipSync(raw.buf).length, defs: defsBytes, entities: Buffer.byteLength(JSON.stringify(snap.entities)) },
  glb: { files: Object.keys(snap.assetBytes ?? {}).length, bytes: glb },
  catalog: { lines: cat.buf.length, json: catJson.buf.length, linesGzip: gzipSync(cat.buf).length, etag: cat.headers.get('etag') },
};
// the viewer in real Chrome: GLB bytes fetched in the first 20 s, lazy (default) vs ?assets=eager (as before)
if (!args['no-viewer']) {
  let chromium = null; try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { }
  const release = chromium ? await chromeLease('vocab-payload').catch(() => null) : null;
  if (release) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      out.viewer = {};
      for (const [mode, q] of [['eager', '&assets=eager'], ['lazy', '']]) {
        const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 } }), page = await ctx.newPage();
        let glb = 0, files = 0, snapBytes = null; const t0 = Date.now(); let firstDrawn = null;
        const seen = new Set();
        page.on('requestfinished', async (rq) => { const u = rq.url(); try { const z = await rq.sizes(); if (/\/assets\/[0-9a-f]{64}\.glb/.test(u) && !seen.has(u)) { seen.add(u); files++; glb += z.responseBodySize; } if (/\/v1\/world\/snapshot/.test(u)) snapBytes = { body: z.responseBodySize, headers: z.responseHeadersSize }; } catch { } });
        await page.goto(`${base}?dev=1${q}`, { waitUntil: 'domcontentloaded' });
        const at = {};
        for (const s of [5, 10, 20]) { await page.waitForTimeout(s * 1000 - (Date.now() - t0)).catch(() => {}); at[`${s}s`] = { glbMB: +(glb / 1e6).toFixed(1), files }; if (!firstDrawn) firstDrawn = await page.evaluate(() => window.__soulsEntity?.layer?.drawn?.size ?? null); }
        const bar = await page.evaluate(() => [...document.querySelectorAll('.viewer-arrival-progress span')].map((x) => x.textContent).join(' '));
        out.viewer[mode] = { ...at, drawnAt5s: firstDrawn, snapshotSentBytes: snapBytes, bar };
        await ctx.close();
      }
    } finally { await browser.close(); await release(); }
  }
}
console.log(JSON.stringify(out, null, 1));
if (args.out) writeFileSync(resolve(String(args.out)), JSON.stringify(out, null, 1));
process.exit(0);
