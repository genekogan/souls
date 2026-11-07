// Release 3.8 stranger walk (from r37 walk.mjs; adds a still pair 8 s apart for sky/weather motion) (+ WS frame sizes) on the LIVE site (lane R, evening run): real Chrome (lease, Metal GPU), real mouse/wheel/keys,
// dpr 1 and 2, no ?shot. Per world: time to arrival, drag-orbit, wheel-zoom, arrow keys, then Explore picks (typed search).
//   node walk.mjs <outDir> <worldUrl>=<pick1|pick2|...> ...      (PHONE=1: 390x844 touch; DPRS=1,2 default; PICK2=1: a second pick shot)
// Run by ship.sh after every release (was team/scratch/t4/r/walk319.mjs).
// The wheel step keeps the eye in open space (lane RR, 2026-10-20): five blind notches in took the eye to the 2 m near limit
// whenever the broadcast camera arrived close (/w/eden: 13 m from the pivot -> 3.2 m, 2.4 m above the ground), and the
// orbit shot showed a wall or a roof (walks 3.46, 3.47, 3.51, 3.53). Now it zooms in a notch at a time only while the eye
// stays ORBIT_MIN_DIST from the pivot and ORBIT_MIN_HEIGHT above the ground (window.__soulsCamera / __soulsCameraGround), and
// zooms out when it arrived closer than that (one notch out and back when it is already right); a page without those
// diagnostics keeps the five notches. entry.orbit records it.
export const ORBIT_MIN_DIST = 25, ORBIT_MIN_HEIGHT = 10, NOTCH = 240, MAX_IN = 5, MAX_OUT = 8;
export const NOTCH_FACTOR = Math.exp(-NOTCH * .0012);   // the camera's ZOOM_PER_PIXEL (apps/web/src/WorldRtsCamera.ts): 0.75 per notch
/** Next wheel notch for an eye d m from its pivot, h m above the ground (h null: unknown): 'in', 'out' or null (stop). */
export function zoomStep(d, h, zin) {
  const open = (dd, hh) => dd >= ORBIT_MIN_DIST && (hh == null || hh >= ORBIT_MIN_HEIGHT);
  if (zin < MAX_IN && open(d * NOTCH_FACTOR, h == null ? null : h * NOTCH_FACTOR)) return 'in';
  return open(d, h) ? null : 'out';
}
import { mkdirSync, writeFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; import { loadavg } from 'node:os';
import { chromium as playwrightChromium, lease } from './browser.mjs';
const eye = (p) => p.evaluate(() => { const c = globalThis.__soulsCamera, g = globalThis.__soulsCameraGround; if (!c?.p || !c.pivot) return null;
  return { d: +Math.hypot(c.p[0] - c.pivot[0], c.p[1] - c.pivot[1], c.p[2] - c.pivot[2]).toFixed(1), h: g?.ground == null ? null : +(c.p[1] - g.ground).toFixed(1) }; }).catch(() => null);
async function zoomOpen(p) {
  const o = { start: await eye(p), in: 0, out: 0 };
  if (!o.start) { for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -NOTCH); await p.waitForTimeout(120); } o.in = 5; o.blind = true; return o; }
  let s = o.start;
  for (let step; s && (step = zoomStep(s.d, s.h, o.in)) && o.out < MAX_OUT;) {
    if (step === 'in') o.in++; else o.out++;
    await p.mouse.wheel(0, step === 'in' ? -NOTCH : NOTCH); await p.waitForTimeout(400); s = await eye(p);
  }
  // already at the right distance: still turn the wheel (one notch out, one back in), as a stranger would
  if (s && !o.in && !o.out) { for (const dy of [NOTCH, -NOTCH]) { await p.mouse.wheel(0, dy); await p.waitForTimeout(400); } o.in = o.out = 1; s = await eye(p); }
  o.end = s; o.open = !!s && s.d >= ORBIT_MIN_DIST && (s.h == null || s.h >= ORBIT_MIN_HEIGHT); return o;
}
if (process.argv[1] !== fileURLToPath(import.meta.url)) { /* imported (tests): no walk */ } else {
const [out, ...specs] = process.argv.slice(2); mkdirSync(out, { recursive: true }); const chromium = playwrightChromium();
const release = await lease('ship-walk'); let b; const log = [];
const slugOf = (u) => { const x = new URL(u); return (x.pathname.split('/').filter(Boolean).pop() ?? 'root') + (x.search ? '-' + x.search.replace(/\W+/g, '') : ''); };
try {
  b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (const spec of specs) {
    const [url, picks = ''] = spec.split('='); const slug = slugOf(url);
    for (const dpr of (process.env.DPRS ?? '1,2').split(',').map(Number)) {
      const ctx = await b.newContext(process.env.PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr }); const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push('pageerror ' + String(e).slice(0, 200)));
      p.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 160)); });
      p.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url().slice(0, 140)); });
      const entry = { slug, dpr, picks: [], sockets: [], resync: 0, snap: [] }; log.push(entry);
      p.on('websocket', (ws) => { entry.sockets.push(ws.url().slice(0, 120)); ws.on('framereceived', (f) => { if (typeof f.payload === 'string' && /resync/.test(f.payload.slice(0, 400))) entry.resync++; }); });
      p.on('response', async (r) => { if (/mesh\.glb|clips-[a-z-]*\.glb|animated-[0-9]+\.glb/.test(r.url())) entry.snap.push(r.status() + ' ' + r.url().split('/').pop().slice(0, 40)); if (r.url().includes('/v1/world/snapshot')) entry.snap.push(r.status() + ' ' + r.url().split('/v1/world/')[1].slice(0, 40) + ' ' + (r.headers()['cache-control'] ?? '') + ' ' + (r.headers()['content-encoding'] ?? '')); });
      const frames = []; const sz = (x) => typeof x === 'string' ? Buffer.byteLength(x) : x.length;
      p.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push({ t: Date.now(), n: sz(f.payload), h: typeof f.payload === 'string' ? f.payload.slice(0, 48) : 'bin' })));
      entry.worldmeta = []; p.on('request', (q) => { if (q.url().includes('/v1/worldmeta')) entry.worldmeta.push(q.url().slice(0, 140)); });
      p.on('websocket', (ws) => ws.on('framereceived', (f) => { if (typeof f.payload === 'string' && f.payload.includes('"welcome"') && !entry.welcome) entry.welcome = f.payload.slice(0, 300);
        if (typeof f.payload === 'string') { const m = f.payload.match(/^\{"t":"([a-z-]+)"/); if (m) { entry.types ??= {}; entry.types[m[1]] = (entry.types[m[1]] ?? 0) + 1; } } }));
      entry.load1 = +loadavg()[0].toFixed(1);   // PF2: this laptop's 1-min load at the walk (checks.mjs notes slow arrivals under load)
      const t0 = Date.now(); await p.goto(url, { waitUntil: 'domcontentloaded' });
      try {
        await p.waitForSelector('.world-viewport canvas', { timeout: 120000 });
        await p.waitForFunction(() => !document.querySelector('.viewer-arrival-stage'), null, { timeout: 180000 });
        entry.arrivalMs = Date.now() - t0;
      } catch (e) { entry.arrivalErr = String(e).slice(0, 160); }
      await p.waitForTimeout(4000); await p.screenshot({ path: `${out}/${slug}-1-arrive-dpr${dpr}.png` });
      await p.waitForTimeout(8000); await p.screenshot({ path: `${out}/${slug}-1b-still8s-dpr${dpr}.png` });
      entry.text = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
      const c = await p.locator('.world-viewport canvas').first().boundingBox().catch(() => null);
      if (c) {
        const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
        await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 260, cy + 40, { steps: 20 }); await p.mouse.up(); await p.waitForTimeout(1200);
        entry.orbit = await zoomOpen(p);
        await p.mouse.click(cx, cy); for (const k of ['ArrowUp', 'ArrowUp', 'ArrowLeft']) { await p.keyboard.down(k); await p.waitForTimeout(400); await p.keyboard.up(k); }
        await p.waitForTimeout(2000); await p.screenshot({ path: `${out}/${slug}-2-orbit-zoom-keys-dpr${dpr}.png` });
      }
      for (const pick of picks.split('|').filter(Boolean)) {
        const r = { pick };
        try {
          await p.getByText(/^Explore/).first().click({ timeout: 6000 }); await p.waitForTimeout(700);
          await p.keyboard.type(pick, { delay: 50 }); await p.waitForTimeout(1000);
          r.options = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.innerText.trim()).filter(Boolean).slice(0, 40).join(' | ').slice(0, 600));
          const btn = p.getByRole('button', { name: new RegExp(pick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
          await btn.click({ timeout: 6000 }); await p.waitForTimeout(6000);
          await p.screenshot({ path: `${out}/${slug}-3-${pick.replace(/\W+/g, '-')}-dpr${dpr}.png` }); r.ok = true; if (process.env.PICK2) { await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/${slug}-3-${pick.replace(/\W+/g, '-')}-b-dpr${dpr}.png` }); }
        } catch (e) { r.err = String(e).slice(0, 160); await p.keyboard.press('Escape').catch(() => {}); }
        entry.picks.push(r);
      }
      { const ta = t0 + (entry.arrivalMs ?? 0) + 3000; const rem = ta + 10000 - Date.now(); if (rem > 0) await p.waitForTimeout(rem); const win = frames.filter((f) => f.t >= ta && f.t < ta + 10000);
        const big = [...frames].sort((x, y) => y.n - x.n)[0]; const bigW = [...win].sort((x, y) => y.n - x.n)[0];
        entry.ws = { framesTotal: frames.length, bytesTotal: frames.reduce((s, f) => s + f.n, 0), maxFrame: big?.n, maxFrameHead: big?.h,
          win10s: { frames: win.length, bytes: win.reduce((s, f) => s + f.n, 0), maxFrame: bigW?.n, maxFrameHead: bigW?.h } }; }
      entry.errors = [...new Set(errs)].slice(0, 15);
      await ctx.close();
      console.log(JSON.stringify({ slug, dpr, worldmeta: entry.worldmeta.length, chunks: /take-chunk-ref/.test(entry.welcome ?? ''), types: entry.types, arrivalMs: entry.arrivalMs, arrivalErr: entry.arrivalErr, picks: entry.picks.map((x) => `${x.pick}:${x.ok ? 'ok' : 'FAIL'}`), errors: entry.errors.length, errList: entry.errors.slice(0, 4), sockets: entry.sockets.length, resync: entry.resync, orbit: entry.orbit && `${entry.orbit.blind ? 'blind ' : ''}${entry.orbit.in} in/${entry.orbit.out} out, eye ${entry.orbit.end?.d ?? '?'} m from pivot, ${entry.orbit.end?.h ?? '?'} m up`, snap: entry.snap, ws: { total: entry.ws?.framesTotal, max: entry.ws?.maxFrame, maxHead: entry.ws?.maxFrameHead } }));
    }
  }
} finally { await b?.close(); release(); writeFileSync(`${out}/walk.json`, JSON.stringify(log, null, 1)); }
}
