#!/usr/bin/env node
// local-smoke — quick proof that the app works on this machine: boots an isolated world launcher, opens the world list
// and one world in headless Chromium, checks that a person is drawn, writes a summary, and tears everything down.
// The scenario it runs: e2e/scenarios/local-smoke.md. How to run it: docs/testing/e2e.md#local-smoke.
//
//   node e2e/local-smoke.mjs [--port N] [--out <dir>] [--clip] [--build] [--mars-web <dir>] [--keep-data] [--timeout-seconds N]
//
// --port      the launcher's port; its one world runs on the next two ports. Default: $E2E_PORT, else a free port.
// --out       the run directory. Default: .local/e2e/<UTC timestamp>/ (summary.json, shots/, launcher.log, clip).
// --clip      also record the whole browser session as one uncut, real-speed video (clip.webm; clip.mp4 with ffmpeg).
// --build     build what is missing first: the web app (apps/web/dist) and the viewer's static build (/modular).
// --mars-web  use this explicit complete static overlay; default: launcher selection, then MARS_WEB_DIR or viewer build.
// --keep-data keep the run's data dir (<out>/data); by default it is removed after a pass.
// Exit 0: pass. 1: a check failed. 2: a precondition is missing (the message says which command fixes it).
//
// Isolation: the launcher's worlds always run with fake minds (BRAIN_MODE=fake) and dev sign-in; data lives under the
// run directory; Chromium comes from PLAYWRIGHT_BROWSERS_PATH, /opt/pw-browsers, or this checkout's .e2e/browsers,
// never a personal profile. Teardown stops the launcher and the world processes by their exact PIDs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIO = 'local-smoke';
const WORLD = { name: 'Smoke Hamlet', template: 'hello-hamlet', slug: 'smoke-hamlet' };
const SOUL = { name: 'Ada', description: 'A smoke-test Soul who likes the pond.' };
const DEV = 'dev:smoke';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseArgs(argv, env = process.env) {
  const a = { port: null, out: null, clip: false, build: false, keepData: false, marsWeb: null, timeoutSeconds: 90 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { if (i + 1 >= argv.length) throw new UsageError(`${k} needs a value`); return argv[++i]; };
    if (k === '--port') a.port = v();
    else if (k === '--out') a.out = v();
    else if (k === '--clip') a.clip = true;
    else if (k === '--build') a.build = true;
    else if (k === '--keep-data') a.keepData = true;
    else if (k === '--mars-web') a.marsWeb = v();
    else if (k === '--timeout-seconds') a.timeoutSeconds = Number(v());
    else if (k === '-h' || k === '--help') a.help = true;
    else throw new UsageError(`unknown argument ${k}`);
  }
  if (a.port == null && env.E2E_PORT) a.port = env.E2E_PORT;
  if (a.port != null) a.port = checkPort(a.port);
  if (!(a.timeoutSeconds > 0)) throw new UsageError('--timeout-seconds must be a positive number');
  return a;
}

export class UsageError extends Error {}

/** A launcher port plus its two world ports, inside 1024–65533 and clear of the ports e2e/config.mjs reserves. */
export function checkPort(value, reserved = Object.values(config.ports)) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65533) throw new UsageError(`port ${value}: use an integer from 1024 to 65533`);
  const taken = [port, port + 1, port + 2].filter((p) => reserved.includes(p));
  if (taken.length) throw new UsageError(`port ${port}: ${taken.join(', ')} reserved by e2e/config.mjs for the client fixture`);
  return port;
}

export const portFree = (port) => new Promise((done) => {
  const s = createServer().once('error', () => done(false)).once('listening', () => s.close(() => done(true)));
  s.listen(port, '127.0.0.1');
});

/** A port whose next two ports are free too (the launcher and its world range). */
async function freePort() {
  for (let i = 0; i < 20; i++) {
    const port = await new Promise((done, fail) => { const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
    try { checkPort(port); } catch { continue; }
    if ((await portFree(port + 1)) && (await portFree(port + 2))) return port;
  }
  throw new Error('no free port with two free neighbours');
}

/** PLAYWRIGHT_BROWSERS_PATH when set, else /opt/pw-browsers (cloud images), else this checkout's .e2e/browsers. */
export function browsersDir(env = process.env, exists = existsSync) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  if (exists('/opt/pw-browsers')) return '/opt/pw-browsers';
  return join(ROOT, '.e2e/browsers');
}

const INSTALL = 'PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" pnpm --filter mars-campus-viewer exec playwright install chromium';
const BUILDS = [
  { what: 'the web app', file: 'apps/web/dist/index.html', args: ['--filter', '@sim/web', 'build'] },
];

/** Match launcher selection, then pin it with --mars-web so preflight and serving use the same directory. */
export function smokeMarsWeb(root, explicit, env = process.env, exists = existsSync) {
  return resolve(explicit ?? (exists(join(root, '.lane/mars-web')) ? join(root, '.lane/mars-web') : env.MARS_WEB_DIR ?? join(root, 'mars/viewer/dist/client')));
}

export function missingSmokeKit(marsWeb, exists = existsSync) {
  return ['modular/humanoid/kit.json', 'modular/environment/clips-ual.glb'].filter((p) => !exists(join(marsWeb, p)));
}

export function preflight(a, marsWeb, { root = ROOT, exists = existsSync, spawnCmd = spawnSync } = {}) {
  const missing = [];
  for (const b of BUILDS) {
    if (exists(join(root, b.file))) continue;
    if (!a.build) { missing.push(`${b.what} is not built (${b.file}): pnpm ${b.args.join(' ')}   (or pass --build)`); continue; }
    console.log(`[smoke] building ${b.what}: pnpm ${b.args.join(' ')}`);
    const r = spawnCmd('pnpm', b.args, { cwd: root, stdio: 'inherit' });
    if (r.status !== 0 || !exists(join(root, b.file))) missing.push(`building ${b.what} failed: pnpm ${b.args.join(' ')}`);
  }
  const viewer = join(root, 'mars/viewer/dist/client');
  if (missingSmokeKit(marsWeb, exists).length && marsWeb === viewer && a.build) {
    console.log('[smoke] building viewer static assets: pnpm build:viewer');
    spawnCmd('pnpm', ['build:viewer'], { cwd: root, stdio: 'inherit' });
  }
  const kit = missingSmokeKit(marsWeb, exists);
  if (kit.length) missing.push(`selected smoke overlay ${marsWeb} lacks ${kit.join(', ')}; pass --mars-web <complete isolated overlay> (or build the viewer and select it)`);
  const media = spawnCmd(process.execPath, ['tools/assets/pull.mjs', '--check', '--quiet', '--set', 'web,runtime'], { cwd: root, encoding: 'utf8' });
  if (media.status !== 0) missing.push('media is missing: pnpm assets:pull --set web,runtime');
  return missing;
}

async function loadChromium() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir();
  const { resolvePlaywright, launchArgs } = await import(pathToFileURL(join(ROOT, 'tools/playtest/lib/platform.mjs')).href);
  const pw = resolvePlaywright({ serverRoot: ROOT });
  if (!pw) throw new UsageError('Playwright not found: pnpm install --frozen-lockfile (mars/viewer depends on @playwright/test)');
  const args = launchArgs({ gpu: 'swiftshader' }).args;
  // Headless runs use the headless shell when it is the only build installed (`playwright install --only-shell`).
  const launch = () => pw.chromium.launch({ headless: true, args }).catch((e) => {
    if (/Executable doesn't exist|playwright install/i.test(String(e?.message))) throw new UsageError(`Chromium is not installed in ${process.env.PLAYWRIGHT_BROWSERS_PATH}: ${INSTALL}`);
    throw e;
  });
  return { launch, from: pw.from };
}

const git = (...args) => { const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${Math.round(ms / 1000)} s waiting for ${what}`);
    await sleep(200);
  }
}

async function api(base, path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${DEV}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`POST ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

/** Each step collects asserts; `check` records one and throws on a red one so the run stops there. */
function stepper(summary) {
  return {
    start(name) { const s = { n: summary.steps.length + 1, name, asserts: [], startedAt: new Date().toISOString() }; summary.steps.push(s); console.log(`[smoke] ${s.n}. ${name}`); return s; },
    check(s, kind, ok, detail) {
      s.asserts.push({ kind, ok: !!ok, detail });
      console.log(`[smoke]    ${ok ? 'ok  ' : 'FAIL'} ${kind}: ${detail}`);
      if (!ok) throw Object.assign(new Error(`${kind}: ${detail}`), { assertion: true });
    },
  };
}

// What the page reports about the drawn scene. Reads only; every action in the run is real input.
const SCENE_PROBE = (entityId) => {
  const e = window.__simEntity;
  if (!e?.scene) return { ready: false };
  let figure = null;
  e.scene.traverse((o) => {
    if (figure || o.name !== entityId) return;
    let skinned = 0, visible = true; o.traverse((c) => { if (c.isSkinnedMesh) skinned++; });
    for (let p = o; p; p = p.parent) if (!p.visible) visible = false;
    const v = new o.position.constructor(); o.getWorldPosition(v); v.project(e.camera);
    figure = { skinned, visible, ndc: [v.x, v.y, v.z].map((x) => Math.round(x * 100) / 100) };
  });
  const canvas = e.renderer?.domElement;
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  return { ready: true, residents: e.residents().length, figure, stats: e.stats(), webgl: !!gl && !gl.isContextLost() };
};

export async function run(a) {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const out = resolve(a.out ?? join(ROOT, '.local/e2e', stamp));
  const shots = join(out, 'shots'), data = join(out, 'data');
  mkdirSync(shots, { recursive: true });
  const rel = (p) => relative(ROOT, p) || '.';

  const summary = {
    id: SCENARIO, scenario: 'e2e/scenarios/local-smoke.md', status: 'running', commit: git('rev-parse', 'HEAD'),
    dirty: (git('status', '--porcelain', '--untracked-files=no') ?? '') !== '', startedAt: startedAt.toISOString(),
    node: process.version, platform: `${process.platform}-${process.arch}`, port: null, worldPorts: null, url: null,
    world: { ...WORLD }, soul: { ...SOUL }, dataDir: rel(data), fakeMinds: true, steps: [], timings: {},
    consoleErrors: [], pageErrors: [], failedRequests: [], cancelledRequests: [], httpErrors: [], screenshots: [], clip: null,
    processes: { launcher: null, worlds: [] }, teardown: null, error: null,
  };
  const write = () => writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const { start, check } = stepper(summary);

  let launcher = null, browser = null, context = null, page = null, tornDown = false;
  const teardown = async () => {
    if (tornDown) return; tornDown = true;
    const t = { browserClosed: false, launcherExit: null, worldsLeft: [], killed: [] };
    try { if (context) await context.close(); if (browser) await browser.close(); t.browserClosed = true; } catch (e) { t.browserError = String(e.message ?? e); }
    if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
      const exited = new Promise((r) => launcher.once('exit', (code, sig) => r(sig ?? code)));
      launcher.kill('SIGTERM');                                           // the launcher stops its worlds, then exits
      t.launcherExit = await Promise.race([exited, sleep(20_000).then(() => null)]);
      if (t.launcherExit === null && alive(launcher.pid)) { process.kill(launcher.pid, 'SIGKILL'); t.killed.push(launcher.pid); t.launcherExit = 'SIGKILL'; }
    } else if (launcher) t.launcherExit = launcher.signalCode ?? launcher.exitCode;
    for (const { pid } of summary.processes.worlds) {                    // only the exact PIDs this run started
      for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
      if (alive(pid)) { process.kill(pid, 'SIGKILL'); t.killed.push(pid); await sleep(200); }
      if (alive(pid)) t.worldsLeft.push(pid);
    }
    summary.teardown = t;
  };
  const onSignal = (sig) => { console.error(`[smoke] ${sig}: tearing down`); summary.status = 'aborted'; void teardown().then(() => { write(); process.exit(130); }); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);

  const t0 = Date.now();
  try {
    let s = start('Preconditions: builds, media and Chromium are in place');
    const marsWeb = smokeMarsWeb(ROOT, a.marsWeb);
    const missing = preflight(a, marsWeb);
    if (missing.length) { s.asserts.push({ kind: 'preflight', ok: false, detail: missing.join('; ') }); throw new UsageError(missing.join('\n')); }
    check(s, 'preflight', true, `web build, selected overlay ${marsWeb} character kit and web+runtime media present`);
    const { launch, from: pwFrom } = await loadChromium();
    browser = await launch();
    summary.browser = `chromium ${browser.version()}`;
    check(s, 'browser', true, `${summary.browser} from ${pwFrom}; browsers in ${rel(process.env.PLAYWRIGHT_BROWSERS_PATH)}`);

    s = start('Boot an isolated launcher with one fresh world and one Soul');
    const port = a.port ?? await freePort();
    summary.port = port; summary.worldPorts = [port + 1, port + 2];
    for (const p of [port, port + 1, port + 2]) if (!(await portFree(p))) throw new UsageError(`port ${p} is in use; pick another --port (the run needs it and the next two)`);
    const base = `http://127.0.0.1:${port}`;
    summary.url = `${base}/`;
    const logFd = openSync(join(out, 'launcher.log'), 'a');
    launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', `${port + 1}-${port + 2}`, '--data', data, '--eager', '0', '--mars-web', marsWeb],
      { cwd: ROOT, env: { ...process.env, BRAIN_MODE: 'fake' }, stdio: ['ignore', logFd, logFd] });
    summary.processes.launcher = launcher.pid;
    const health = await waitFor(async () => { if (launcher.exitCode !== null) throw new Error('launcher exited'); const r = await fetch(`${base}/__sim/healthz`); return r.ok && r.json(); }, 30_000, 'the launcher /__sim/healthz')
      .catch((e) => { throw new Error(`${e.message} (launcher exit ${launcher.exitCode ?? 'none'}; see ${rel(join(out, 'launcher.log'))})`); });
    summary.timings.launcherBootMs = Date.now() - t0;
    check(s, 'expect-api', health.ok && health.auth === 'dev', `GET /__sim/healthz ok, auth ${health.auth}, build ${health.build}`);
    const t1 = Date.now();
    const made = await api(base, '/__sim/worlds', { name: WORLD.name, template: WORLD.template });
    summary.timings.worldCreateMs = Date.now() - t1;
    summary.world.slug = made.slug;
    check(s, 'expect-api', made.world?.status === 'running', `POST /__sim/worlds → ${made.slug} (${made.world?.entities} entities, ${made.bootMs} ms boot)`);
    const soul = await api(base, `/w/${made.slug}/v1/souls`, SOUL);
    summary.soul = { ...SOUL, id: soul.soul.id, entityId: soul.soul.entityId };
    check(s, 'expect-api', !!soul.soul.entityId, `POST /w/${made.slug}/v1/souls → ${soul.soul.id} (body ${soul.soul.entityId})`);
    const diag = await fetch(`${base}/__sim/launcher`).then((r) => r.json());
    summary.processes.worlds = (diag.children ?? []).map((c) => ({ slug: c.slug, port: c.port, pid: c.pid }));
    check(s, 'processes', summary.processes.worlds.length === 1, `launcher pid ${launcher.pid}; world ${summary.processes.worlds.map((w) => `${w.slug} pid ${w.pid} :${w.port}`).join(', ')}`);
    write();

    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...(a.clip ? { recordVideo: { dir: join(out, 'video'), size: { width: 1280, height: 720 } } } : {}) });
    page = await context.newPage();
    const since = () => +((Date.now() - t0) / 1000).toFixed(2);
    page.on('console', (m) => { if (m.type() === 'error') summary.consoleErrors.push({ at: since(), text: m.text().slice(0, 500), url: m.location()?.url }); });
    page.on('pageerror', (e) => summary.pageErrors.push({ at: since(), text: String(e?.stack ?? e).slice(0, 800) }));
    // net::ERR_ABORTED is the page cancelling its own request (an AbortController superseding a fetch, as
    // WorldContextViews does): recorded, not a failure. Every other failure is.
    page.on('requestfailed', (r) => { const error = r.failure()?.errorText; (error === 'net::ERR_ABORTED' ? summary.cancelledRequests : summary.failedRequests).push({ at: since(), url: r.url(), error }); });
    page.on('response', (r) => { if (r.status() >= 400) summary.httpErrors.push({ at: since(), status: r.status(), url: r.url() }); });
    const clean = (st, from) => {
      const errs = [...summary.consoleErrors, ...summary.pageErrors].filter((e) => e.at >= from);
      const reqs = [...summary.failedRequests, ...summary.httpErrors].filter((e) => e.at >= from);
      check(st, 'expect-console', errs.length === 0, errs.length ? `${errs.length} error(s): ${errs[0].text.slice(0, 200)}` : 'no console or page errors');
      check(st, 'expect-network', reqs.length === 0, reqs.length ? `${reqs.length} failed request(s): ${reqs[0].url} ${reqs[0].error ?? reqs[0].status}` : 'no failed requests');
    };
    // A screenshot waits for a fresh frame; software GL on a small CI runner can take tens of seconds for one.
    const shot = async (name) => { const p = join(shots, name), ts = Date.now(); await page.screenshot({ path: p, timeout: 120_000 }); (summary.timings.screenshotMs ??= {})[name] = Date.now() - ts; summary.screenshots.push(rel(p)); };

    s = start('Open the world list');
    let from = since();
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    const card = page.locator(`a[href*="/w/${made.slug}/"]`).first();
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    check(s, 'expect', (await card.innerText()).includes(WORLD.name), `the world list shows "${WORLD.name}" with a link to /w/${made.slug}/`);
    await page.waitForLoadState('load');
    await sleep(500);
    await shot('1-world-list.png');
    clean(s, from);

    s = start('Enter the world from its card and wait for a person to be drawn');
    from = since();
    const t2 = Date.now();
    await card.click();                                                   // real input
    await page.waitForURL(new RegExp(`/w/${made.slug}/`), { timeout: 30_000 });
    check(s, 'expect-url', true, `${new URL(page.url()).pathname}${new URL(page.url()).search}`);
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
    const entityId = soul.soul.entityId;
    const drawn = await waitFor(async () => { const p = await page.evaluate(SCENE_PROBE, entityId); return p.ready && p.figure?.skinned > 0 && p; }, a.timeoutSeconds * 1000, `${SOUL.name}'s figure (${entityId}) in the scene`)
      .catch(async (e) => {
        await shot('2-world-failed.png').catch(() => {});
        const notice = await page.getByText(/could not be prepared/i).first().innerText({ timeout: 1000 }).catch(() => null);
        throw Object.assign(new Error(`${e.message}${notice ? `; the page says: ${notice.slice(0, 200)}` : ''}`), { assertion: true });
      });
    summary.timings.enterToPersonMs = Date.now() - t2;
    const prep = await page.getByText(/could not be prepared/i).count();
    check(s, 'expect', prep === 0, prep ? 'the page says the world could not be prepared' : 'no "could not be prepared" notice');
    check(s, 'expect', drawn.webgl, 'the world canvas has a live WebGL context');
    check(s, 'expect', drawn.residents >= 1 && drawn.figure.visible, `${drawn.residents} resident(s); ${SOUL.name}'s figure has ${drawn.figure.skinned} skinned meshes, visible`);
    summary.scene = drawn.stats;
    check(s, 'expect', drawn.stats.entities > 0 && drawn.stats.draws > 0, `scene drawn: ${drawn.stats.entities} entities, ${drawn.stats.draws} draw calls, ${drawn.stats.tris} triangles`);
    await sleep(1000);
    await shot('2-world.png');
    clean(s, from);

    s = start(`Find ${SOUL.name} through Explore and follow them`);
    from = since();
    const slow = a.timeoutSeconds * 1000;                                 // software GL can starve the page's main thread
    await page.getByRole('button', { name: /Explore/ }).click();
    const explore = page.getByRole('dialog', { name: /Explore/ });
    const search = explore.getByRole('searchbox', { name: /Search locations and Souls/ });
    await search.waitFor({ state: 'visible', timeout: slow });
    await search.click();
    await page.keyboard.type(SOUL.name, { delay: 60 });
    await waitFor(async () => (await search.inputValue()) === SOUL.name, slow, 'the Explore search to hold the typed name');
    await explore.getByRole('region', { name: /Souls in/ }).getByText(SOUL.name, { exact: true }).first().waitFor({ state: 'visible', timeout: slow });
    check(s, 'expect', true, `Explore lists ${SOUL.name} under "Souls in ${WORLD.name}"`);
    await page.keyboard.press('Enter');                                   // picks the first result, as a click would
    await page.getByText(new RegExp(`Following\\s*${SOUL.name}`)).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: slow });
    check(s, 'expect', true, `the "Following ${SOUL.name}" chip shows`);
    const framed = await waitFor(async () => { const p = await page.evaluate(SCENE_PROBE, entityId); const [x, y, z] = p.figure?.ndc ?? [9, 9, 9]; return Math.abs(x) < 0.9 && Math.abs(y) < 0.9 && z < 1 && p; }, slow, `${SOUL.name} in view`).catch(() => null);
    check(s, 'expect', !!framed, framed ? `${SOUL.name} is in frame (screen position ${framed.figure.ndc.slice(0, 2).join(', ')})` : `${SOUL.name} never came into view`);
    await sleep(1500);
    await shot('3-person.png');
    clean(s, from);

    summary.status = 'pass';
  } catch (e) {
    summary.status = e instanceof UsageError ? 'abort' : 'fail';
    summary.error = String(e?.message ?? e);
    if (!e.assertion) console.error(`[smoke] ${e instanceof UsageError ? 'precondition' : 'error'}: ${summary.error}`);
    if (page && summary.status === 'fail') {
      const p = join(shots, 'failure.png');
      if (await page.screenshot({ path: p, timeout: 60_000 }).then(() => true, () => false)) summary.screenshots.push(rel(p));
    }
  } finally {
    const video = page?.video?.();
    await teardown();
    if (a.clip && video) {
      const raw = await video.path().catch(() => null);
      if (raw && existsSync(raw)) {
        const mp4 = join(out, 'clip.mp4');
        const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', '-an', mp4]);
        if (ff.status === 0) { rmSync(join(out, 'video'), { recursive: true, force: true }); summary.clip = rel(mp4); }
        else { const webm = join(out, 'clip.webm'); spawnSync('mv', [raw, webm]); rmSync(join(out, 'video'), { recursive: true, force: true }); summary.clip = rel(webm); }
      }
    }
    if (summary.teardown && (summary.teardown.worldsLeft.length || (launcher && summary.teardown.launcherExit === null))) {
      summary.status = summary.status === 'pass' ? 'fail' : summary.status;
      summary.error = summary.error ?? `teardown left processes running: ${summary.teardown.worldsLeft.join(', ')}`;
    }
    summary.durationSec = +((Date.now() - t0) / 1000).toFixed(1);
    if (summary.status === 'pass' && !a.keepData) { rmSync(data, { recursive: true, force: true }); summary.dataDir = null; }
    write();
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  }
  const shotsList = existsSync(shots) ? readdirSync(shots).length : 0;
  console.log(`[smoke] ${summary.status.toUpperCase()} in ${summary.durationSec} s — ${rel(join(out, 'summary.json'))} (${shotsList} screenshots${summary.clip ? `, ${summary.clip}` : ''})`);
  if (summary.error && summary.status !== 'pass') console.log(`[smoke] ${summary.error}`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`[smoke] ${e.message}`); process.exit(2); }
  if (a.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  const summary = await run(a);
  process.exit(summary.status === 'pass' ? 0 : summary.status === 'abort' ? 2 : 1);
}
