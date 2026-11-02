#!/usr/bin/env node
// The God modal end to end, as an owner and their coding agent use it (B8, round 9). It replaces the V6-launcher meetup
// flow, which Z3 retired when G5 made God Mode one view with no tabs. A world made by this checkout's launcher under /worlds,
// owned by dev:gene, is walked in real Chrome:
//   A not connected: God Mode opens by itself; the Connect block names this world's SKILL.md; Copy puts the line on the clipboard
//   B pairing: the agent (eden-god.mjs from this checkout, in a fresh folder) registers and pairs; Approve in God Mode pairs it
//   C connected: `listen --follow` turns the pill green and the Connect block goes
//   D a command typed in the box reaches the agent and shows in the log; the agent builds, then acks it: Done, with the reply
//   E Undo takes the build out, Redo puts it back
//   F weather: Rain is one press
//   G Forsake world: hand-on needs a second explicit click (the link is made, then cancelled); Archive stays disabled until
//     the world's address is typed; Back returns; nothing was archived
//   H the agent goes away: the Connect block comes back
//
//   node tools/god-skill/e2e/launcher.mjs [--port 5877] [--range 5878-5879] [--web .lane/web-worlds] [--mars-web .lane/mars-web]
//                                         [--out <dir>] [--dpr 1] [--keep]
// Starts its own launcher on a fresh data dir (fake minds, dev auth, $0). --web is a web build made with --base /worlds/.
// Writes report.json and screenshots to --out (default .lane/e2e-launcher/<stamp>). Needs Google Chrome (real GPU, the
// Chrome lease: CHROME_LEASE_MODULE or lib/chrome-lease.mjs). V7 runs it (tools/test-harness/v7-walks.sh).
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeEdit, observeWeather } from './edit-observation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const port = Number(args.port ?? 5877), range = typeof args.range === 'string' ? args.range : '5878-5879', dpr = Number(args.dpr ?? 1);
const web = resolve(root, typeof args.web === 'string' ? args.web : '.lane/web-worlds');
const marsWeb = resolve(root, typeof args['mars-web'] === 'string' ? args['mars-web'] : '.lane/mars-web');
const out = resolve(typeof args.out === 'string' ? args.out : resolve(root, '.lane/e2e-launcher', stamp));
mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`;
const report = { port, range, dpr, web, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], pageErrors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
let page = null;
async function check(name, ok, data = {}) {
  report.steps.push({ name, ok: !!ok, ...data });
  if (!ok) {
    if (!report.failures.length && page) { const file = join(out, 'first-failure.png'); await page.screenshot({ path: file, timeout: 5000 }).then(() => report.shots.push(file), () => {}); }
    report.failures.push({ name, ...data });
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(data).slice(0, 400)}`);
  save();
}
async function shot(name) { const file = join(out, `${name}.png`); await page.screenshot({ path: file, timeout: 30_000 }); report.shots.push(file); }

// ---------- the launcher (own process, own data, fake minds)
const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', BRAIN_MODE: 'fake', SEED_NATIVES: '0' };
const logFd = openSync(join(out, 'launcher.log'), 'a');
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', join(out, 'data'), '--base', '/worlds', '--web', web, '--mars-web', marsWeb, '--dev-auth'], { cwd: root, env, stdio: ['ignore', logFd, logFd] });
const stopLauncher = () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', () => { if (!args.keep) stopLauncher(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopLauncher(); process.exit(130); });
for (let i = 0; ; i++) { try { if ((await fetch(`${origin}/worlds/__sim/healthz`)).ok) break; } catch { /* starting */ } if (i > 600) throw new Error(`no launcher on ${origin} (see ${out}/launcher.log)`); await sleep(100); }

// ---------- a new world owned by dev:gene (the agent is NOT paired)
const owner = { authorization: 'Bearer dev:gene', 'content-type': 'application/json' };
const made = await fetch(`${origin}/worlds/__sim/worlds`, { method: 'POST', headers: owner, body: JSON.stringify({ name: `God Modal ${stamp.slice(11, 16).replace('-', '')}`, template: 'empty', godName: 'Gaia' }) });
const world = await made.json(); if (made.status !== 201) throw new Error(`create ${made.status} ${JSON.stringify(world)}`);
const slug = world.slug, base = `${origin}/worlds/w/${slug}`;
const st = await (await fetch(`${base}/v1/god/status`, { headers: owner })).json();
if (st.you !== 'owner') { const c = await fetch(`${base}/v1/god/claim`, { method: 'POST', headers: owner, body: '{}' }); if (!c.ok) throw new Error(`claim ${c.status}`); }
report.slug = slug; report.base = base; save();

// ---------- the agent's folder: the CLI from this checkout
const folder = mkdtempSync(join(tmpdir(), 'god-agent-'));
writeFileSync(join(folder, 'eden-god.mjs'), readFileSync(resolve(root, 'tools/god-skill/eden-god.mjs')));
const cliEnv = { ...process.env, EDEN_GOD_NO_LEASE: '1', EDEN_GOD_WARM: '0' };
const cli = (...a) => new Promise((ok) => execFile(process.execPath, ['eden-god.mjs', ...a], { cwd: folder, env: cliEnv, timeout: 180_000 }, (err, so, se) => ok({ code: err?.code ?? 0, out: String(so) + String(se) })));
const snapshot = async () => (await fetch(`${base}/v1/world/snapshot`)).json();

// ---------- the browser (the owner)
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../lib/chrome-lease.mjs');
const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
const releaseLease = await chromeLease('god-modal-e2e');
// Real GPU (Metal) headless Chrome; swiftshader starves on this shared machine.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
let listen = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1352, height: 820 }, deviceScaleFactor: dpr });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await ctx.addInitScript(() => { try { localStorage.setItem('sim.dev', 'gene'); } catch { /* storage off */ } });
  page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (e) => report.pageErrors.push(String(e.message).slice(0, 200)));
  const modal = page.locator('[data-god-modal][open]');
  const openGod = async () => {
    // the God button toggles, and God opens by itself once for a new owner: check before each press
    for (let i = 0; i < 4 && !(await modal.count()); i++) {
      if (await page.locator('[data-god-open]').isVisible().catch(() => false)) await page.locator('[data-god-open]').click().catch(() => {});
      else { await page.locator('.hud-more').click().catch(() => {}); await page.locator('[data-more="god"]').click({ timeout: 2000 }).catch(() => {}); }
      await modal.waitFor({ timeout: 2000 }).catch(() => {});
    }
  };
  const note = async (re, ms = 10_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await page.locator('[data-god-modal] .gm-note').innerText().catch(() => ''); if (re.test(t)) return t; await sleep(150); } return ''; };

  await page.goto(`${base}/?dev=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-god-open="owner"]').waitFor({ state: 'attached', timeout: 120_000 });
  await page.waitForFunction(() => window.__simEntity?.layer?.active === true, null, { timeout: 120_000 });
  await modal.waitFor({ timeout: 10_000 }).catch(() => {});
  const openedByItself = (await modal.count()) > 0;
  await openGod(); await sleep(800);

  // A. not connected
  const head = await page.locator('[data-god-modal] .gm-head').innerText();
  const line = await page.locator('[data-connect-line]').getAttribute('data-connect-line');
  const link = page.locator('[data-skill-link]');
  await check('A1 God Mode opens by itself for a new owner: one view (no tabs), the Connect block, no agent', openedByItself && /^God Mode/.test(head.trim()) && (await page.locator('[data-god-modal] [role="tablist"], [data-god-modal] [data-tab]').count()) === 0 && (await page.locator('[data-connect]').count()) === 1, { head: head.replace(/\s+/g, ' ') });
  await check('A2 the Connect line names this world\'s SKILL.md; the link opens it in a new tab', line === `Read ${base}/SKILL.md and follow its God mode section to control this world.` && (await link.getAttribute('href')) === `${base}/SKILL.md` && (await link.getAttribute('target')) === '_blank', { line });
  await page.locator('[data-connect-copy]').click(); await sleep(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ERR ' + e.message);
  await check('A3 Copy puts exactly that line on the clipboard', clip === line && /Copied/.test(await page.locator('[data-connect-copy]').innerText()), { clip });
  const skill = await (await fetch(`${base}/SKILL.md`)).text();
  await check('A4 the linked SKILL.md has a God mode section', /God mode/.test(skill), { bytes: skill.length });
  await shot('01-not-connected');

  // B. pairing
  const reg = await cli('register', base);
  const pairing = cli('pair', 'god-modal-e2e');
  await page.locator('[data-god-modal] [data-approve]').first().waitFor({ timeout: 60_000 });
  await shot('02-pairing-request');
  await page.locator('[data-god-modal] [data-approve]').first().click();
  const paired = await pairing;
  const token = (() => { try { return JSON.parse(readFileSync(join(folder, '.eden-god.json'), 'utf8')).token ?? ''; } catch { return ''; } })();
  await check('B1 the agent registers and pairs; Approve in God Mode pairs it', reg.code === 0 && paired.code === 0 && token.startsWith(`god_${slug}-`), { register: reg.out.slice(-120), pair: paired.out.slice(-160) });

  // C. connected
  listen = spawn(process.execPath, ['eden-god.mjs', 'listen', '--follow'], { cwd: folder, env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const heard = []; listen.stdout.on('data', (d) => { for (const l of String(d).split('\n')) if (l.trim()) heard.push(l); });
  await page.locator('[data-agent-pill="connected"]').waitFor({ timeout: 30_000 }).catch(() => {});
  await sleep(1500);
  await check('C1 listening: the pill says connected and the Connect block is gone', (await page.locator('[data-agent-pill="connected"]').count()) === 1 && (await page.locator('[data-connect]').count()) === 0);
  await shot('03-connected');

  // D. a command: typed in the box, shown in the log, heard by the agent, built, acked
  const box = page.locator('[data-god-modal] textarea');
  await box.click(); await box.fill('Put a bench by the path, facing west.'); await box.press('Enter');
  const logged = await page.locator('[data-god-modal] .gm-ticket', { hasText: 'Put a bench by the path' }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  let msg = null;
  for (let i = 0; i < 150 && !msg; i++) {
    for (const l of heard) { try { const j = JSON.parse(l); const m = j.inbox?.latest ?? j.latest ?? j; if (m?.id && /bench/.test(m.text ?? '')) msg = m; } catch { /* a progress line */ } }
    if (!msg) await sleep(200);
  }
  const waiting = await page.locator('[data-god-modal] .gm-ticket').first().getAttribute('data-status').catch(() => null);
  await check('D1 the command shows in the log and reaches the listening agent', logged && !!msg, { msg: msg?.id ?? null, status: waiting });
  const placed = await cli('place', 'bench', '--at', '6,6', '--name', 'e2e-bench');
  const acked = await cli('ack', msg?.id ?? 'none', 'Placed a bench by the path.');
  await page.locator('[data-god-modal] .gm-ticket[data-status="done"]').first().waitFor({ timeout: 20_000 }).catch(() => {});
  const ticket = await page.locator('[data-god-modal] .gm-ticket').first().innerText().catch(() => '');
  const benchIn = async () => (await snapshot()).entities.some((e) => e.name === 'e2e-bench');
  await check('D2 the agent builds it and acks it: the log says Done with the reply', placed.code === 0 && acked.code === 0 && await benchIn() && /Done/.test(ticket) && /Placed a bench/.test(ticket), { place: placed.out.slice(-120), ack: acked.out.slice(-120), ticket: ticket.replace(/\s+/g, ' ') });
  await shot('04-command-done');

  // E. Undo/Redo: correlate each accepted edit with public seq, keeping immediate
  // authoritative state separate from bounded convergence of the cached public URL.
  const benches = (await snapshot()).entities.filter(e => e.name === 'e2e-bench');
  if (benches.length !== 1) throw new Error('E1 requires exactly one original bench');
  const entity = { id: benches[0].id, name: benches[0].name };
  const observeButton = action => observeEdit({ snapshotUrl: `${base}/v1/world/snapshot`, entity, present: action === 'redo',
    pageErrors: () => report.pageErrors,
    action: async () => {
      const pending = page.waitForResponse(r => r.url() === `${base}/v1/god/${action}` && r.request().method() === 'POST');
      await page.locator(`[data-${action}]`).click();
      const response = await pending; return { status: response.status(), body: await response.json() };
    } });
  const undoObservation = await observeButton('undo'), undo = await note(/Undid edit/);
  await shot('05-undo');
  const redoObservation = await observeButton('redo'), redo = await note(/Redid edit/);
  await check('E1 Undo takes the same bench out; Redo puts it back: authoritative state and bounded cache convergence',
    !!undo && !!redo && undoObservation.ok && redoObservation.ok && report.pageErrors.length === 0,
    { entity, undo, redo, undoObservation, redoObservation });

  // F. weather
  const weatherObservation = await observeWeather({ snapshotUrl: `${base}/v1/world/snapshot`,
    weather: { kind: 'rain', rain: 0.8, intensity: 0.8 }, pageErrors: () => report.pageErrors,
    action: async () => {
      const pending = page.waitForResponse(r => r.url() === `${base}/v1/god/env` && r.request().method() === 'POST');
      await page.locator('[data-weather-kind="rain"]').click();
      const response = await pending; return { status: response.status(), body: await response.json() };
    } });
  const rain = await note(/Rain\./);
  await check('F1 weather: Rain is one press and the world rains', !!rain && weatherObservation.ok && report.pageErrors.length === 0,
    { rain, weatherObservation });
  await shot('06-rain');

  // G. Forsake world: confirmations
  await page.locator('[data-forsake-open]').click();
  await page.locator('[data-god-modal] [data-section="forsake"]').waitFor({ timeout: 5000 });
  const fhead = await page.locator('[data-god-modal] .gm-head').innerText();
  await check('G1 Forsake world takes the modal over: its own head with a back chevron, no command box', /Forsake world/.test(fhead) && (await page.locator('[data-forsake-back]').count()) === 1 && (await page.locator('[data-god-modal] textarea').count()) === 0, { head: fhead.replace(/\s+/g, ' ') });
  await shot('07-forsake');
  await page.locator('[data-ops-transfer]').click();
  const confirmShown = await page.locator('[data-ops-transfer-confirm]').count();
  await page.locator('[data-god-modal] .gm-danger-confirm .gm-quiet').click();
  const confirmGone = (await page.locator('[data-ops-transfer-confirm]').count()) === 0 && (await page.locator('[data-ops-transfer]').count()) === 1;
  await check('G2 Hand it on asks a second, explicit time; Cancel takes it back', confirmShown === 1 && confirmGone);
  await page.locator('[data-ops-transfer]').click(); await page.locator('[data-ops-transfer-confirm]').click();
  const handOn = await page.locator('[data-ops-link="transfer"] code').innerText({ timeout: 15_000 }).catch(() => '');
  await shot('08-hand-on-link');
  await page.locator('[data-ops-cancel]').click().catch(() => {});
  const cancelled = await page.locator('.gm-danger-note').innerText({ timeout: 10_000 }).catch(() => '');
  await check('G3 confirmed, the hand-on link is made; Cancel voids it', /^http/.test(handOn) && /cancelled/i.test(cancelled), { handOn: handOn.slice(0, 120), cancelled });
  await page.locator('[data-ops-confirm]').fill('wrong');
  const disabledWrong = await page.locator('[data-ops-archive]').isDisabled();
  await page.locator('[data-ops-confirm]').fill(slug);
  const enabledRight = await page.locator('[data-ops-archive]').isEnabled();
  await check('G4 Archive stays disabled until the world\'s address is typed', disabledWrong && enabledRight);
  await shot('09-archive-typed');
  await page.locator('[data-ops-confirm]').fill('');
  await page.locator('[data-forsake-back]').click();
  await page.locator('[data-god-modal] [data-section="agent"]').waitFor({ timeout: 5000 });
  const live = (await fetch(`${base}/healthz`)).ok, listed = (await (await fetch(`${origin}/worlds/__sim/worlds.json`)).json());
  await check('G5 Back returns to God Mode; nothing was archived', (await page.locator('[data-god-modal] textarea').count()) === 1 && live && JSON.stringify(listed).includes(slug), { live });

  // H. the agent goes away
  listen.kill(); listen = null;
  // God poll-start lease lasts 75 s; allow its expiry plus the owner UI poll.
  await page.locator('[data-connect]').waitFor({ timeout: 90_000 }).catch(() => {});
  await check('H1 the agent goes away: the pill says away and the Connect block is back', (await page.locator('[data-connect]').count()) === 1 && (await page.locator('[data-agent-pill="away"]').count()) === 1);
  await shot('10-away');
  await check('Z no page errors', report.pageErrors.length === 0, { errors: report.pageErrors });
} catch (e) {
  await check('harness', false, { error: String(e?.stack ?? e).slice(0, 600) });
} finally {
  listen?.kill();
  report.finishedAt = new Date().toISOString();
  report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  save();
  await browser.close().catch(() => {});
  releaseLease();
  console.log(`\n${report.passed}/${report.total} checks passed${report.failures.length ? `, ${report.failures.length} failed` : ''} — ${out}`);
  if (!args.keep) stopLauncher();
  process.exit(report.failures.length ? 1 : 0);
}
