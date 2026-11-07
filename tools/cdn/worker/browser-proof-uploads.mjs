#!/usr/bin/env node
// browser-proof-uploads.mjs — local real-Chrome proof that a god upload loads through the pull-through Worker (lane CDN4).
//
//   SIM_ASSETS_CDN_ENABLED=1 SIM_ASSETS_CDN_ORIGIN=http://127.0.0.1:6561 pnpm --filter @souls/web exec vite build --base /worlds/ --outDir <web>
//   node tools/cdn/worker/browser-proof-uploads.mjs serve --web-dir <web> --out <dir> &     # world 6560, Worker 6561, page 6562
//   node tools/cdn/worker/browser-proof-uploads.mjs check --out <dir>                      # takes the `cdn` Chrome lease
//
// serve: a fresh local /worlds world `upload-proof` (dev auth mints a local god token, fake minds); a god upload of a cow GLB made unique (a new
// node name, so its sha is in no manifest), defined and placed at the arrival. The Worker stand-in runs the real handler
// (god-uploads.js) with an in-memory R2 and the page server as its origin; it only rewrites Access-Control-Allow-Origin to
// the loopback page origin (the real Worker names https://sim.eden.art). `check` loads the page in real Chrome:
//   miss (dpr 1)    the upload comes from the Worker (x-eden-cdn miss), the page never asks the origin for it;
//   hit (dpr 2)     a fresh context: x-eden-cdn hit (stored by the miss);
//   off (dpr 1)     ?godcdn=0: no Worker request, the origin serves it;
//   down (dpr 1)    the Worker refuses connections: one failed attempt, then the origin;
//   corrupt (dpr 2) the Worker answers 200 with wrong bytes of the right length: the hash check falls back to the origin.
// Every scenario must draw the model (its asset stage reaches `done`) with no page errors.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { startWorld } from '../../god-skill/dev-world.mjs';
import { findPlaywright } from '../../god-skill/lib/look.mjs';
import { chromeLease } from '../../god-skill/lib/chrome-lease.mjs';
import { handle } from './god-uploads.js';
import { FakeR2 } from './fake-r2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2), mode = args[0];
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const out = resolve(opt('out', resolve(dirname(fileURLToPath(import.meta.url)), '../../../.local/cdn/browser-proof-uploads')));
const WORLD = 6560, CDN = 6561, PAGE = 6562, slug = 'upload-proof', prefix = '/worlds';
const page = `http://127.0.0.1:${PAGE}`, cdnBase = `http://127.0.0.1:${CDN}`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
mkdirSync(out, { recursive: true });

/** The cow GLB with one node renamed: a valid, unique upload (its sha is in no manifest). */
function uniqueGlb() {
  const index = JSON.parse(readFileSync(resolve(root, 'worlds/core-assets/index.json'), 'utf8'));
  const [, record] = Object.entries(index.assets).find(([, a]) => a.name === 'cow-pack');
  const glb = readFileSync(resolve(root, record.path));
  const jl = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jl).toString('utf8'));
  json.nodes[0].name = `${json.nodes[0].name ?? 'node'}-cdn4-${randomBytes(6).toString('hex')}`;
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = glb.subarray(20 + jl), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + js.length + rest.length, 8); head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, js, rest]);
}

if (mode === 'serve') {
  const webDir = resolve(opt('web-dir', `${out}/web`));
  const genesis = resolve(out, 'genesis.json');
  writeFileSync(genesis, JSON.stringify({ schema: 'genesis/1', name: 'CDN4 upload proof', constants: { extent: 300, ground: 'land' }, state: { constitution: 'Local CDN4 proof. Fake minds only.' }, batches: [{ note: 'arrival', ops: [
    { op: 'place', def: 'core/flag@1', name: 'arrival', p: [0, 4], state: { label: 'CDN4 proof' } },
  ] }] }));
  process.env.WEB_DIR = webDir; process.env.WORLD_PATH = `${prefix}/w/${slug}`;
  const { child } = await startWorld({ slug, port: WORLD, data: resolve(out, 'world-data'), genesis, fresh: true, log: resolve(out, 'world.log') });
  let cdn, proxy, mode = 'up';
  const r2 = new FakeR2(), stats = { pulls: 0, served: [] };
  try {
    const upstreamPath = (path) => path.startsWith(prefix + '/') && !path.startsWith(prefix + '/w/') ? path.slice(prefix.length) : path;
    proxy = createServer(async (req, res) => {
      try {
        const m = /^\/__fixture\/cdn\/(up|down|corrupt)$/.exec(req.url ?? '');
        if (m) { mode = m[1]; if (mode === 'down') { cdn.closeAllConnections(); await new Promise((y) => cdn.close(y)); } else if (!cdn.listening) await new Promise((y, n) => cdn.once('error', n).listen(CDN, '127.0.0.1', y)); res.end(mode); return; }
        if (req.url === '/__fixture/cdn/stats') { res.end(JSON.stringify({ ...stats, stored: [...r2.objects.keys()] })); return; }
        const response = await fetch(`http://127.0.0.1:${WORLD}${upstreamPath(req.url)}`, { method: req.method, headers: { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req, duplex: 'half', signal: AbortSignal.timeout(30_000) });
        const headers = Object.fromEntries(response.headers); delete headers['content-encoding']; delete headers['content-length'];
        res.writeHead(response.status, headers);
        if (response.body) for await (const chunk of response.body) res.write(chunk);
        res.end();
      } catch (error) { res.writeHead(502).end(String(error)); }
    });
    proxy.on('upgrade', (req, socket, head) => {
      const upstream = connect(WORLD, '127.0.0.1', () => {
        const headers = req.rawHeaders.reduce((all, v, i) => i % 2 ? all : all + v + ': ' + req.rawHeaders[i + 1] + '\r\n', '');
        upstream.write(`${req.method} ${upstreamPath(req.url)} HTTP/${req.httpVersion}\r\n${headers}\r\n`); if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
      upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
    });
    await new Promise((y, n) => proxy.once('error', n).listen(PAGE, '127.0.0.1', y));
    const env = { ASSETS: r2 };   // the strict R2 stand-in (fake-r2.mjs)
    cdn = createServer(async (req, res) => {
      const waits = [];
      const r = await handle(new Request(`https://assets.eden.art${req.url}`, { method: req.method }), env, { waitUntil: (p) => waits.push(p) },
        { origin: page, caches: null, fetch: (u, init) => { stats.pulls++; return fetch(u, init); } });
      let body = req.method === 'HEAD' ? null : Buffer.from(await r.arrayBuffer());
      if (mode === 'corrupt' && body && r.status === 200) body = Buffer.alloc(body.length, 0);
      const headers = Object.fromEntries(r.headers);
      if (headers['access-control-allow-origin']) headers['access-control-allow-origin'] = page;   // the only change from the real Worker
      stats.served.push({ path: req.url, status: r.status, worker: headers['x-eden-cdn'], mode });
      res.writeHead(r.status, headers); res.end(body ?? undefined);
      await Promise.all(waits);
    });
    await new Promise((y, n) => cdn.once('error', n).listen(CDN, '127.0.0.1', y));
    // The god upload, defined and placed at the arrival (dev auth: the local owner is god).
    const api = `${page}${prefix}/w/${slug}`;
    const minted = await (await fetch(`${api}/v1/god/mint`, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: JSON.stringify({ label: 'cdn4-proof' }) })).json();
    assert.match(minted.token ?? '', /^god_/, 'a local god token (dev auth)');
    const god = { authorization: `Bearer ${minted.token}` };
    const up = await fetch(`${api}/v1/god/assets?name=cdn4-cow&height=1.6&define=1`, { method: 'POST', headers: { ...god, 'content-type': 'model/gltf-binary' }, body: uniqueGlb() });
    const upBody = await up.json();
    assert.equal(up.status, 200, JSON.stringify(upBody).slice(0, 400));
    const asset = upBody.asset, def = upBody.def;
    const placed = await fetch(`${api}/v1/god/act`, { method: 'POST', headers: { ...god, 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ op: 'place', def: `${def.name}@${def.version}`, name: 'cdn4-cow', p: [0, 0] }], note: 'cdn4 proof' }) });
    assert.equal(placed.status, 200, (await placed.text()).slice(0, 400));
    const manifest = JSON.parse(readFileSync(resolve(root, 'apps/web/src/cdn-manifest.json'), 'utf8'));
    assert.ok(!Object.values(manifest.assets).some((a) => a.sha256 === asset.sha || a.of === asset.sha), 'the upload is in no manifest');
    const snap = await (await fetch(`${api}/v1/world/snapshot`)).json();
    assert.equal(snap.assetBytes?.[asset.sha], asset.bytes, 'the snapshot sizes the upload');
    writeFileSync(resolve(out, 'ready.json'), JSON.stringify({ pid: process.pid, worldPid: child.pid, page, sha: asset.sha, bytes: asset.bytes, def: def.name }, null, 2));
    console.log(JSON.stringify({ ready: true, sha: asset.sha, bytes: asset.bytes, pid: process.pid }));
    const close = () => { child.kill('SIGTERM'); cdn?.close(); proxy?.close(); setTimeout(() => process.exit(0), 1000).unref(); };
    process.once('SIGTERM', close); process.once('SIGINT', close);
  } catch (error) { child.kill('SIGTERM'); cdn?.close(); proxy?.close(); throw error; }
} else if (mode === 'check') {
  const ready = JSON.parse(readFileSync(resolve(out, 'ready.json'), 'utf8')), s = ready.sha;
  const cdnUrl = `${cdnBase}/w/${slug}/assets/${s}.glb`, originUrl = `${page}${prefix}/w/${slug}/assets/${s}.glb`;
  const release = await chromeLease('cdn');
  const { chromium } = findPlaywright();
  const report = { at: new Date().toISOString(), sha: s, bytes: ready.bytes, runs: [] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    for (const [scenario, dpr, fixture, query] of [['miss', 1, 'up', ''], ['hit', 2, 'up', ''], ['off', 1, 'up', '&godcdn=0'], ['down', 1, 'down', ''], ['corrupt', 2, 'corrupt', '']]) {
      await fetch(`${page}/__fixture/cdn/${fixture}`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
      const p = await context.newPage(), responses = [], failed = [], errors = [];
      await p.route('**/*', (route) => { const u = new URL(route.request().url()); return ['blob:', 'data:'].includes(u.protocol) || u.hostname === '127.0.0.1' ? route.continue() : route.abort(); });
      p.on('response', (r) => { if (r.url().includes(s)) responses.push({ url: r.url(), status: r.status(), worker: r.headers()['x-eden-cdn'] ?? null }); });
      p.on('requestfailed', (r) => { if (r.url().includes(s)) failed.push({ url: r.url(), error: r.failure()?.errorText }); });
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${page}${prefix}/w/${slug}?dev=1&weather=clear&at=0,1,0&eye=4,3,6${query}`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction((x) => globalThis.__assetStages?.[x] === 'done', s, { timeout: 90_000 });
      await p.waitForTimeout(1500);
      const worker = await p.evaluate(() => globalThis.__assetWorker);
      const fromCdn = responses.filter((r) => r.url === cdnUrl), fromOrigin = responses.filter((r) => r.url === originUrl && r.status === 200);
      if (scenario === 'miss' || scenario === 'hit') {
        assert.equal(fromCdn.length, 1, `${scenario}: one Worker request`); assert.equal(fromCdn[0].status, 200);
        assert.equal(fromCdn[0].worker, scenario, `${scenario}: x-eden-cdn`);
        assert.equal(fromOrigin.length, 0, `${scenario}: the page never asked the origin`);
        assert.ok(worker.cdn > 0, `${scenario}: the asset worker delivered from the CDN`);
      } else if (scenario === 'off') {
        assert.equal(fromCdn.length + failed.filter((f) => f.url === cdnUrl).length, 0, 'off: no Worker request'); assert.equal(fromOrigin.length, 1);
      } else {
        assert.equal(fromOrigin.length, 1, `${scenario}: origin fallback`);
        assert.ok(scenario === 'down' ? failed.some((f) => f.url === cdnUrl) : fromCdn.length === 1, `${scenario}: the Worker was tried first`);
        assert.equal(worker.cdn, 0);
      }
      assert.deepEqual(errors, []);
      const shot = resolve(out, `${scenario}-dpr${dpr}.png`);
      await p.screenshot({ path: shot });
      report.runs.push({ scenario, dpr, responses, failed, worker, errors, shot, result: 'PASS' });
      console.log(JSON.stringify({ scenario, dpr, cdn: fromCdn.map((r) => `${r.status} ${r.worker}`), origin: fromOrigin.length, workerCdn: worker.cdn, result: 'PASS' }));
      await context.close();
    }
    report.stand_in = await (await fetch(`${page}/__fixture/cdn/stats`)).json();
    assert.equal(report.stand_in.pulls, 1, 'the Worker pulled from the origin exactly once (the miss)');
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL'; report.failure = String(error);
    await browser?.contexts().at(-1)?.pages().at(-1)?.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally { await browser?.close(); release(); writeFileSync(resolve(out, 'proof.json'), JSON.stringify(report, null, 2)); }
} else throw Error('usage: browser-proof-uploads.mjs serve --web-dir <built /worlds app> [--out dir] | check [--out dir]');
