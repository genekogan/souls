#!/usr/bin/env node
// record.mjs — record one uncut, real-speed Playwright clip of a journey, then (when ffmpeg is present) burn in a
// scrub bar and a timecode and write an mp4. Never edits, speeds up or cuts the recording.
//
//   node .claude/skills/proof/record.mjs --url <url> --out <file.mp4> [--viewport desktop|phone]
//        [--max-seconds N] [--steps <file.mjs>] [--settle-seconds N] [--from-load] [--time-of-day <h|HH:MM|keep>]
//
// The clip starts at arrival: the world is on screen and the arrival card is gone, so the take opens on the world
// (one uncut, real-speed take from there; the sidecar's `start` is "arrival" and its `arrived` mark is 0). --from-load
// records from page creation instead, for a journey whose subject is loading or arrival, or a page that is not a world.
// --time-of-day: on a local world URL (127.0.0.1/localhost …/w/<slug>) the world is set to that hour with its clock paused
//          before the page opens (default 12, midday; the god env route as the dev owner, one entry in the world's god
//          history; the clock stays paused afterwards). `keep` leaves the clock alone (use it for god history/undo proofs).
// --arrival-seconds: how long the page may take to arrive before the take starts (default 120). A page that never
//          shows a world fails (exit 1) with a still of where it stuck (<out>.open-failed.png) and a sidecar.
//
// --steps: an ES module whose default export is `async (page, { url, viewport, mark }) => {}`. It drives the journey
//          with real input (page.mouse / page.keyboard / page.touchscreen / locator clicks). `mark('label')` records a
//          chapter time in the sidecar. Without --steps the page is loaded and watched for --settle-seconds.
// --max-seconds: hard cap on the clip. Default: the first `max_seconds:` in docs/process/PROOF-POLICY.yml, else 60.
//          If the journey runs past it the clip is cut at the cap and the script exits 3: shorten the journey.
// Writes <out> (mp4, or .webm when ffmpeg is missing) and <out>.json (url, viewport, duration, marks, console errors,
// commit). Browsers: PLAYWRIGHT_BROWSERS_PATH when set, else /opt/pw-browsers when present.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export function parseArgs(argv) {
  const a = { viewport: 'desktop', settleSeconds: 8, fromLoad: false, timeOfDay: '12', arrivalSeconds: 120 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { if (i + 1 >= argv.length) throw Error(`${k} needs a value`); return argv[++i]; };
    if (k === '--url') a.url = v();
    else if (k === '--out') a.out = v();
    else if (k === '--viewport') a.viewport = v();
    else if (k === '--max-seconds') a.maxSeconds = Number(v());
    else if (k === '--steps') a.steps = v();
    else if (k === '--settle-seconds') a.settleSeconds = Number(v());
    else if (k === '--from-load') a.fromLoad = true;
    else if (k === '--time-of-day') a.timeOfDay = v();
    else if (k === '--arrival-seconds') a.arrivalSeconds = Number(v());
    else if (k === '-h' || k === '--help') { a.help = true; }
    else throw Error(`unknown arg ${k}`);
  }
  return a;
}

function policyMaxSeconds() {
  try {
    const m = readFileSync(join(ROOT, 'docs/process/PROOF-POLICY.yml'), 'utf8').match(/max_seconds:\s*(\d+)/);
    if (m) return { value: Number(m[1]), from: 'docs/process/PROOF-POLICY.yml' };
  } catch { /* no policy file yet */ }
  return { value: 60, from: 'default' };
}

const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
const git = (...args) => { const r = run('git', ['-C', ROOT, ...args]); return r.status === 0 ? r.stdout.trim() : null; };

// Shared with the run cameras (#888): the arrival predicate, mid-page recording and the world-time route.
async function clipTools() {
  const p = (f) => join(ROOT, f);
  if (!existsSync(p('tools/playtest/lib/arrival.mjs'))) return null;
  const [arrival, setup] = await Promise.all([import(pathToFileURL(p('tools/playtest/lib/arrival.mjs')).href), import(pathToFileURL(p('tools/playtest/runs/setup.mjs')).href)]);
  return { ...arrival, ...setup };
}

async function loadChromium() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  const platform = join(ROOT, 'tools/playtest/lib/platform.mjs');
  if (existsSync(platform)) {
    const p = await import(pathToFileURL(platform).href);
    const pw = p.resolvePlaywright({ serverRoot: ROOT });
    if (pw) return { chromium: pw.chromium, args: p.launchArgs({ gpu: 'swiftshader' }).args, from: pw.from };
  }
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    try { const m = await import(name); const chromium = m.chromium ?? m.default?.chromium; if (chromium) return { chromium, args: ['--enable-unsafe-swiftshader'], from: name }; } catch { /* next */ }
  }
  throw Error('Playwright not found: run `pnpm install --frozen-lockfile` (mars/viewer depends on @playwright/test) or install playwright globally');
}

function burnIn(src, dst, { width, height, durationSec }) {
  const D = Math.max(durationSec, 0.1).toFixed(2);
  const bar = `[0:v]drawbox=x=0:y=ih-30:w=iw:h=30:color=black@0.55:t=fill[bg];` +
    `color=c=0xffc400:s=${width}x6:r=25[bar];[bg][bar]overlay=x='-w+W*t/${D}':y=H-6:shortest=1`;
  const text = `,drawtext=text='%{pts\\:hms} / ${D}s':x=8:y=h-26:fontsize=16:fontcolor=white`;
  const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', '-an'];
  for (const graph of [bar + text, bar]) {           // drawtext needs a font; retry without it
    for (const codec of [enc, ['-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an']]) {
      const r = run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-filter_complex', graph, ...codec, dst]);
      if (r.status === 0) return { ok: true, timecode: graph !== bar };
    }
  }
  return { ok: false };
}

/** worldTimePlan({url, timeOfDay}, tools) → {base, time} to set, or {why} when the clock is left alone. Throws on an
 *  invalid --time-of-day. */
export function worldTimePlan(a, tools) {
  if (a.timeOfDay === 'keep') return { why: 'keep' };
  if (!tools) return { why: 'tools/playtest not in this checkout' };
  const req = tools.worldTimeRequest({ timeOfDay: /^\d+(\.\d+)?$/.test(a.timeOfDay) ? Number(a.timeOfDay) : a.timeOfDay });
  if (req.errors.length) throw Error(`--time-of-day: ${req.errors[0].message.replace('world.timeOfDay ', '')}`);
  const base = tools.worldBase(a.url);
  return base ? { base, time: req.time } : { why: 'not a local world URL' };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.url || !a.out) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 23).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(a.help ? 0 : 2); }
  const vp = VIEWPORTS[a.viewport];
  if (!vp) throw Error('--viewport must be desktop or phone');
  const cap = a.maxSeconds > 0 ? { value: a.maxSeconds, from: '--max-seconds' } : policyMaxSeconds();
  const steps = a.steps ? (await import(pathToFileURL(resolve(a.steps)).href)).default : null;
  if (a.steps && typeof steps !== 'function') throw Error(`${a.steps} must default-export async (page, ctx) => {}`);

  const out = resolve(a.out); mkdirSync(dirname(out), { recursive: true });
  const tools = await clipTools();
  // World time first (#888), before the page opens: a local world is shown at midday with its clock paused.
  const plan = worldTimePlan(a, tools);
  let worldTime = { requested: plan.time ?? a.timeOfDay, applied: false, why: plan.why ?? null };
  if (plan.base) {
    const r = await tools.applyWorldTime({ base: plan.base, time: plan.time, note: 'proof recorder world time (#888)' });
    worldTime = { requested: plan.time, applied: r.ok, ...(r.ok ? { clock: r.applied } : { why: r.error }) };
    if (!r.ok) console.error(`warn: world time not set (${r.error}); the clip shows the world's own clock`);
  }
  const work = mkdtempSync(join(tmpdir(), 'proof-'));
  const { chromium, args, from } = await loadChromium();
  const browser = await chromium.launch({ headless: true, args });
  const { width, height } = vp.viewport;
  // Arrival start needs a mid-page recording (page.screencast); without it this Playwright records from page creation.
  let context = await browser.newContext({ ...vp, ...(a.fromLoad ? { recordVideo: { dir: work, size: { width, height } } } : {}) });
  let page = await context.newPage(), startFallback = null;
  if (!a.fromLoad && !tools?.canScreencast(page)) {
    await context.close(); startFallback = tools ? 'page.screencast unavailable in this Playwright: recorded from page creation' : 'tools/playtest not in this checkout: recorded from page creation';
    context = await browser.newContext({ ...vp, recordVideo: { dir: work, size: { width, height } } }); page = await context.newPage();
  }
  const screencast = !a.fromLoad && !startFallback ? join(work, 'arrival.webm') : null;
  let t0 = Date.now(), startedAt = new Date(t0).toISOString();
  const marks = [], consoleErrors = [];
  const mark = (label) => marks.push({ label: String(label), atSec: +((Date.now() - t0) / 1000).toFixed(2) });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 500)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e?.message ?? e).slice(0, 500)}`));

  let truncated = false, stepError = null, capTimer = null;
  const capped = new Promise((r) => { capTimer = () => setTimeout(() => { truncated = true; r(); }, cap.value * 1000); });
  const journey = (async () => {
    if (screencast) {
      // Loading is not in the clip: open the page, wait for the world, then start the one take.
      await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: a.arrivalSeconds * 1000 });
      await page.waitForFunction(tools.worldArrived, null, { timeout: a.arrivalSeconds * 1000 })
        .catch(() => { throw Error(`the page never arrived on a world in ${a.arrivalSeconds} s (world on screen, arrival card gone); for a page that is not a world, or a journey about loading, pass --from-load`); });
      ({ startedAt } = await tools.startScreencast(page, { path: screencast, size: { width, height } }));
      t0 = Date.parse(startedAt); capTimer();
      mark('arrived');
    } else {
      capTimer();
      mark('goto');
      // From load, the arrival is still marked (in the background) so the preview GIF and readers can find it.
      if (tools) page.waitForFunction(tools.worldArrived, null, { timeout: cap.value * 1000 }).then(() => mark('arrived'), () => {});
      await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: cap.value * 1000 });
    }
    if (steps) await steps(page, { url: a.url, viewport: a.viewport, mark });
    else await page.waitForTimeout(Math.min(a.settleSeconds, cap.value) * 1000);
    await page.waitForTimeout(800);                    // let the last frame land
  })().catch((e) => { stepError = String(e?.stack ?? e).slice(0, 2000); });
  await Promise.race([journey, capped]);
  if (stepError && screencast && !marks.length) {
    // Never arrived: no take was started. Keep a still of where it stuck and a sidecar saying so.
    const still = `${out.replace(/\.[^./]*$/, '')}.open-failed.png`;
    const shot = await page.screenshot({ path: still, timeout: 15000 }).then(() => basename(still), () => null);
    await context.close(); await browser.close(); rmSync(work, { recursive: true, force: true });
    writeFileSync(`${out}.json`, JSON.stringify({ file: null, url: a.url, viewport: a.viewport, start: 'arrival', startRequested: 'arrival', arrived: false, openFailedShot: shot, worldTime, stepError, consoleErrors,
      commit: git('rev-parse', 'HEAD'), recordedAt: new Date().toISOString() }, null, 2) + '\n');
    console.error(stepError); process.exit(1);
  }
  const durationSec = +((Date.now() - t0) / 1000).toFixed(2);
  const video = screencast ? null : page.video();
  if (screencast) await page.screencast.stop();
  await context.close();
  const videoSec = (Date.now() - t0) / 1000;           // the recording runs from its start (arrival or page creation) to close
  const raw = screencast ?? await video.path();
  await browser.close();

  let file = out, burned = null;
  if (has('ffmpeg')) {
    if (extname(out) !== '.mp4') file = out.replace(/\.[^./]*$/, '') + '.mp4';
    burned = burnIn(raw, file, { width, height, durationSec: videoSec });
    if (!burned.ok) { file = file.replace(/\.mp4$/, '.webm'); copyFileSync(raw, file); }
  } else {
    file = out.replace(/\.[^./]*$/, '') + '.webm';
    copyFileSync(raw, file);
  }
  rmSync(work, { recursive: true, force: true });

  const meta = {
    file: basename(file), url: a.url, viewport: a.viewport, size: `${width}x${height}`, durationSec, maxSeconds: cap.value,
    start: screencast ? 'arrival' : 'load', startRequested: a.fromLoad ? 'load' : 'arrival', ...(startFallback ? { startFallback } : {}), startedAt, worldTime,
    maxSecondsFrom: cap.from, truncated, stepsFile: a.steps ?? null, stepError, marks, consoleErrors,
    scrubBar: !!burned?.ok, timecode: !!burned?.timecode, playwright: from,
    commit: git('rev-parse', 'HEAD'), dirty: (git('status', '--porcelain') ?? '') !== '', recordedAt: new Date().toISOString(),
  };
  writeFileSync(`${file}.json`, JSON.stringify(meta, null, 2) + '\n');
  console.log(`${file}  ${durationSec}s ${a.viewport} from ${meta.start}${meta.scrubBar ? ' +scrub bar' : ' (raw: no ffmpeg or ffmpeg failed)'}  console errors: ${consoleErrors.length}`);
  console.log(`${file}.json`);
  if (stepError) { console.error(`steps failed: ${stepError}`); process.exit(1); }
  if (truncated) { console.error(`journey ran past ${cap.value}s (${cap.from}); clip cut at the cap: shorten the journey`); process.exit(3); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
