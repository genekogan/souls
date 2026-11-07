#!/usr/bin/env node
// Phone arrival profile: where the CPU goes between navigation and the arrival card closing.
// Same phone emulation as probe.mjs --mobile (390x844 dpr 3, touch, 4x CPU, cache off, optional --mbps link), plus a
// sampled V8 CPU profile from navigation to the card's ready signal. Writes arrival.cpuprofile (open in Chrome DevTools)
// and summary.json: self time by original source file and by function (via the build's source maps when served), the
// main-thread busy/idle split, the resource waterfall (start/end of each request) and the timing marks.
//   node tools/speed/profile-arrival.mjs <world-url> --out <dir> [--cpu 4] [--mbps 60] [--interval 250]
//   node tools/speed/profile-arrival.mjs <world-url> --out <dir> --analyze [--from ms] [--to ms]   (re-analyse a window)
//   --desktop: 1440x900 (or --size WxH) at --dpr (default 1), no touch, --cpu defaults to 1 and --mbps to 0 (unthrottled).
//   --stranger: no local dev sign-in (default signs in as dev:admin on lane ports).
//   --latency ms: added round trip with --mbps (default 40; ~150 is the laptop -> eden2 live path).
//   --warm: HTTP cache on; one untimed arrival first in the same context, then about:blank, then the timed load (the
//          returning visitor; a fresh document even for #hash URLs).
// Ports: lane ports only via SPEED_PORTS (the live 4930–4990 are always refused).
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { findPlaywright } from '../god-skill/lib/look.mjs';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (!url) { console.error('usage: profile-arrival.mjs <worldUrl> --out <dir>'); process.exit(2); }
const target = new URL(url), port = Number(target.port);
const lanePorts = (process.env.SPEED_PORTS ?? '').split(',').filter(Boolean).map(Number);
const live = args.includes('--live'); // read-only stranger load of the real site: https://sim.eden.art only, no dev flags
if (live ? target.origin !== 'https://sim.eden.art' : (!['localhost', '127.0.0.1'].includes(target.hostname) || (port >= 4930 && port <= 4990) || !(lanePorts.includes(port) || (port >= 5890 && port <= 5899)))) throw new Error('lane ports only (SPEED_PORTS), or --live for https://sim.eden.art');
const out = resolve(opt('out', '.lane/profile')); mkdirSync(out, { recursive: true });
const desktop = args.includes('--desktop'), warm = args.includes('--warm');
const cpu = Number(opt('cpu', desktop ? '1' : '4')), mbps = Number(opt('mbps', desktop ? '0' : '60')), interval = Number(opt('interval', '250'));
const [vw, vh] = (opt('size', desktop ? '1440x900' : '390x844')).split('x').map(Number), dpr = Number(opt('dpr', desktop ? '1' : '3'));
const pw = findPlaywright(); if (!pw) throw new Error('no playwright');

const INIT = `(() => {
  const P = window.__arr = { marks: {}, longtasks: [], stages: [] };
  try { performance.setResourceTimingBufferSize(20000); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const poll = setInterval(() => {
    const w = window.__soulsEntity;
    if (w?.layer?.active && P.marks.layerActive === undefined) P.marks.layerActive = performance.now();
    if (P.marks.live === undefined && [...document.querySelectorAll('.ok b, .ok')].some((e) => /\\bLive\\b/.test(e.textContent || ''))) P.marks.live = performance.now();
    if (w && P.marks.entity === undefined) P.marks.entity = performance.now();
    const ag = window.__arrivalGate; if (ag && P.marks.gatePlanned === undefined && ag.left().length) P.marks.gatePlanned = performance.now(); if (ag && P.marks.gatePlanned !== undefined && P.marks.gateClear === undefined && !ag.pending()) P.marks.gateClear = performance.now(); if (ag && P.marks.gatePlanned !== undefined) { const L = ag.left(); const k = L.length + ':' + L.slice(0, 4).map((x) => x.slice(0, 8)).join(','); if (P.stages.at(-1)?.[1] !== 'gate ' + k) P.stages.push([Math.round(performance.now()), 'gate ' + k]); }
    const st = window.__assetStages; if (st) { const n = {}; for (const v of Object.values(st)) n[v] = (n[v] ?? 0) + 1; const key = JSON.stringify(n); if (P.stages.at(-1)?.[1] !== key) P.stages.push([Math.round(performance.now()), key]); }
    const card = document.querySelector('.viewer-arrival'); if (card && P.marks.cardSeen === undefined) P.marks.cardSeen = performance.now();
    const ct = card ? (card.textContent || '').trim().slice(0, 48) : ''; if (ct && P.cardText !== ct) { P.cardText = ct; P.stages.push([Math.round(performance.now()), 'card ' + ct]); }
    if (P.marks.cardSeen !== undefined && P.marks.cardDone === undefined && (!card || card.getAttribute('data-done') === 'true')) { P.marks.cardDone = performance.now(); clearInterval(poll); }
  }, 25);
})();`;

let wsFrames = [];
let profile, marks, resources, longtasks, navStart, glbs = [], navAt = 0, stages = [], assetTimes = {}, assetWorker = null;
if (args.includes('--analyze')) { profile = JSON.parse(readFileSync(resolve(out, 'arrival.cpuprofile'), 'utf8')); ({ marks, resources, longtasks, navStart, glbs = [], stages = [] } = JSON.parse(readFileSync(resolve(out, 'meta.json'), 'utf8'))); }
else {
console.log('Waiting for speed Chrome lease');
const release = await chromeLease('speed', { waitMs: 2_700_000, staleMs: Infinity });
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: !desktop, hasTouch: !desktop });
  if (!live && !args.includes('--stranger')) await ctx.addInitScript(() => { try { localStorage.setItem('sim.dev', 'admin'); } catch {} });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  // GLB timing from the browser context (Playwright follows worker requests too; Resource Timing only sees the page's)
  ctx.on('requestfinished', (r) => { if (!/\.glb(\?|$)/.test(r.url())) return; const t = r.timing(); glbs.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), start: Math.round(t.startTime - navAt), end: Math.round(t.startTime + t.responseEnd - navAt), worker: (() => { try { r.frame(); return false; } catch { return true; } })() }); });
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Network.webSocketFrameReceived', (e) => { if (navAt) wsFrames.push([Date.now() - navAt, (e.response?.payloadData ?? '').length]); });
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: !warm });
  if (warm) { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 }); await page.waitForFunction(() => window.__arr?.marks.cardDone !== undefined, null, { timeout: 180_000, polling: 100 }); await page.waitForTimeout(8000); glbs.length = 0;
    // leave the document first: a second goto to a #hash URL is only a hash change in the same page (no reload), so the
    // timed marks would be the untimed first load's (research B, 2026-10-19)
    await page.goto('about:blank'); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (mbps > 0) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: Number(opt('latency', '40')), downloadThroughput: mbps * 125000, uploadThroughput: mbps * 125000 });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval });
  await cdp.send('Profiler.start');
  navAt = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => window.__arr?.marks.cardDone !== undefined, null, { timeout: 180_000, polling: 100 });
  ({ profile } = await cdp.send('Profiler.stop'));
  ({ marks, resources, longtasks, stages, assetTimes, assetWorker, navStart } = await page.evaluate(() => ({ marks: { ...window.__arr.marks, ...Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('sim:')).map((m) => [m.name, m.startTime])) }, longtasks: window.__arr.longtasks, stages: window.__arr.stages, assetTimes: window.__assetTimes ?? {}, assetWorker: window.__assetWorker ?? null, navStart: performance.timeOrigin,
    resources: performance.getEntriesByType('resource').map((e) => ({ name: e.name.replace(location.origin, ''), start: Math.round(e.startTime), end: Math.round(e.responseEnd), kb: Math.round((e.encodedBodySize || 0) / 1024) })) })));
} finally { await browser.close(); release(); }
writeFileSync(resolve(out, 'arrival.cpuprofile'), JSON.stringify(profile));
for (const g of glbs) if (!resources.some((r) => r.name === g.url && Math.abs(r.start - g.start) < 50)) resources.push({ name: g.url, start: g.start, end: g.end, kb: null, via: 'context' });
writeFileSync(resolve(out, 'meta.json'), JSON.stringify({ marks, resources, longtasks, navStart, glbs, stages, assetTimes, assetWorker, wsFrames }));
}

// ---- analysis: self time per node, mapped through source maps where the script has one
const pnpm = resolve(import.meta.dirname, '../../node_modules/.pnpm'), smj = readdirSync(pnpm).find((d) => d.startsWith('source-map-js@'));
const { SourceMapConsumer } = require(resolve(pnpm, smj, 'node_modules/source-map-js'));
const maps = new Map();
const consumer = async (scriptUrl) => {
  if (maps.has(scriptUrl)) return maps.get(scriptUrl);
  let c = null;
  if (/^https?:\/\/(127\.0\.0\.1|localhost):/.test(scriptUrl) && /\.js(\?|$)/.test(scriptUrl)) {
    try { const r = await fetch(scriptUrl.replace(/\?.*$/, '') + '.map'); if (r.ok) c = new SourceMapConsumer(await r.json()); } catch {}
  }
  maps.set(scriptUrl, c); return c;
};
const dt = new Map(); // node id -> self microseconds
const ids = profile.samples, deltas = profile.timeDeltas;
// --from / --to <ms> (profile clock): self/inclusive totals of that window only (e.g. --analyze --from 3400 for after the downloads)
const fromUs = Number(opt('from', '0')) * 1000, toUs = Number(opt('to', 'Infinity')) * 1000;
{ let t = 0; for (let i = 0; i < ids.length; i++) { t += deltas[i]; if (t < fromUs || t > toUs) continue; const next = i + 1 < deltas.length ? deltas[i + 1] : 0; dt.set(ids[i], (dt.get(ids[i]) ?? 0) + next); } }
const byFile = new Map(), byFn = new Map(), cats = { idle: 0, program: 0, gc: 0, js: 0 };
const keyOf = new Map();
for (const n of profile.nodes) {
  const self = dt.get(n.id) ?? 0;
  const f = n.callFrame;
  if (!self) { // still name it for the inclusive (call-tree) totals
    let file = f.url || '(native)', fn = f.functionName || '(anonymous)'; const c = f.url ? await consumer(f.url) : null;
    if (c && f.lineNumber >= 0) { const o = c.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber }); if (o.source) { file = o.source.replace(/^.*?(apps\/|packages\/|mars\/|node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?)/, '$1'); fn = (o.name || fn) + ':' + o.line; } }
    else file = file.replace(/^https?:\/\/[^/]+/, '');
    keyOf.set(n.id, file + ' ' + fn); continue;
  }
  if (f.functionName === '(idle)') { cats.idle += self; continue; }
  if (f.functionName === '(program)') { cats.program += self; continue; }
  if (f.functionName === '(garbage collector)') { cats.gc += self; continue; }
  cats.js += self;
  let file = f.url || '(native)', fn = f.functionName || '(anonymous)';
  const c = f.url ? await consumer(f.url) : null;
  if (c && f.lineNumber >= 0) { const o = c.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber }); if (o.source) { file = o.source.replace(/^.*?(apps\/|packages\/|mars\/|node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?)/, '$1'); fn = (o.name || fn) + ':' + o.line; } }
  else file = file.replace(/^https?:\/\/[^/]+/, '');
  byFile.set(file, (byFile.get(file) ?? 0) + self);
  const k = file + ' ' + fn; byFn.set(k, (byFn.get(k) ?? 0) + self); keyOf.set(n.id, k);
}
// inclusive: each function's share of samples with it anywhere on the stack (counted once per stack)
const inc = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
const walk = (id, onPath) => {
  const n = byId.get(id), k = keyOf.get(id), fresh = k && !onPath.has(k);
  if (fresh) onPath.add(k);
  let total = dt.get(id) ?? 0; for (const c of n.children ?? []) total += walk(c, onPath);
  if (fresh) { onPath.delete(k); inc.set(k, (inc.get(k) ?? 0) + total); }
  return total;
};
walk(profile.nodes[0].id, new Set());
for (const k of [...inc.keys()]) if (/^\(native\) \((root|program|idle|garbage collector)\)/.test(k)) inc.delete(k);
// timeline: per 500 ms of navigation time, the share of samples under each of the heaviest app functions
const parentOf = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
const appKeys = [...inc].filter(([k]) => /^(\.\.\/\.\.\/src|apps|packages|mars)\//.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k]) => k);
const timeline = [], bucketMs = Number(opt('bucket', '500'));  // --bucket <ms>: timeline resolution
{ let t = profile.startTime; const navUs = navStart !== undefined ? 0 : 0; void navUs;
  for (let i = 0; i < ids.length; i++) {
    t += deltas[i]; const b = Math.floor((t - profile.startTime) / (bucketMs * 1e3)); const row = timeline[b] ??= { atMs: b * bucketMs, busy: 0, samples: 0, hits: {} }; row.samples++;
    let id = ids[i]; const fn = byId.get(id).callFrame.functionName; if (fn === '(idle)' || fn === '(program)') continue; row.busy++;
    const seen = new Set(); while (id !== undefined) { const k = keyOf.get(id); if (k && appKeys.includes(k) && !seen.has(k)) { seen.add(k); row.hits[k] = (row.hits[k] ?? 0) + 1; } id = parentOf.get(id); }
  } }
const timelineRows = timeline.filter(Boolean).map((r) => ({ atMs: r.atMs, busyPct: Math.round(100 * r.busy / r.samples), top: Object.entries(r.hits).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k.replace(/^.*\//, '')} ${Math.round(100 * v / r.samples)}%`) }));
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v / 1000)]);
const ms = (v) => Math.round(v / 1000);
const summary = { url, cpu, mbps, desktop, warm, viewport: `${vw}x${vh}@${dpr}`, marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round(v)])), totalsMs: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, ms(v)])),
  longtaskMs: longtasks.reduce((n, l) => n + l[1], 0), longtasks, byFile: top(byFile, 40), byFunction: top(byFn, 60), inclusive: top(inc, 80), timeline: timelineRows,
  resources: resources.filter((r) => r.start <= (marks.cardDone ?? Infinity)).sort((a, b) => a.start - b.start) };
writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ marks: summary.marks, totalsMs: summary.totalsMs, longtaskMs: summary.longtaskMs }));
for (const [k, v] of summary.byFile.slice(0, 20)) console.log(String(v).padStart(6), 'ms', k);
console.log('--');
for (const [k, v] of summary.byFunction.slice(0, 30)) console.log(String(v).padStart(6), 'ms', k);
console.log('-- timeline (profile clock; starts just before navigation)');
for (const r of timelineRows) console.log(String(r.atMs).padStart(6), String(r.busyPct).padStart(3) + '%', r.top.join(' | '));
console.log('-- inclusive');
for (const [k, v] of summary.inclusive.slice(0, 50)) console.log(String(v).padStart(6), 'ms', k);
