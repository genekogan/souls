#!/usr/bin/env node
// Lane PUX (Gene 2026-10-20): the Soul request comes up in the window the person already has open, as a small card in the
// top right, with no navigation and no second tab. Real launcher in Clerk mode (synthetic issuer, as approve-on-top.mjs),
// the Soul CLI from source (tools/edge-skill/eden-agent.mjs) run in its own folders, Chrome lease, real GPU.
//   A  gene: the world page is open; New Soul shows a prompt whose link carries this window's code; the agent runs
//      `create-soul "Ana" --for CODE`; the card appears top right in the SAME page (no hash, no new page), with no agent
//      label outside its (i); Approve -> "Ana is being prepared by your agent. Please wait…" with a spinner -> the body is
//      ready -> the card closes itself and the camera follows Ana (Gene 2026-10-20c); the agent's `approval wait` ends paired.
//   B  ana: the request times out (its expiry is moved into the past in the test world's own DB: the server would take
//      15 min) -> "Timed out" + Ask again -> pending -> Approve -> the agent (approval wait through expiry) ends paired.
//   C  cy, phone dpr 3: the card on a phone, light and dark; Refuse -> "Refused"; the agent's request is cancelled.
//   A10 (R20 bug, 2026-10-21): after Approve, the new Soul's owner message box is there with no reload.
//   D  two tabs of the world: only the last one opened or touched holds the sound (audio-focus.ts).
// Shots of the pending card at desktop dpr 1 and 2 and phone, light and dark.
//
//   node tools/god-skill/e2e/approve-in-window.mjs --web <vite build --base /worlds/> [--port 6700] [--range 6701-6705] [--out <dir>]
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { clickNewSoulEntry } from './window-entry.mjs';
import { windowCheck, startWindowListener } from './window-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../lib/chrome-lease.mjs');
const { chromium } = createRequire(`${root}/mars/viewer/package.json`)('@playwright/test');
const port = Number(args.port ?? 6700), range = typeof args.range === 'string' ? args.range : '6701-6705';
const origin = `http://127.0.0.1:${port}`, BASE = '/worlds';
const out = resolve(typeof args.out === 'string' ? args.out : `${root}/.lane/e2e-approve-window/${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });
if (typeof args.web !== 'string') { console.error('--web <vite build --base /worlds/> is required'); process.exit(2); }
const CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { origin, steps: [], failures: [] };
const check = (name, ok, detail = {}) => { report.steps.push(windowCheck(name, ok, detail)); if (!ok) report.failures.push(name); console.log(`${ok ? '✔' : '✖'} ${name} ${JSON.stringify(detail).slice(0, 400)}`); return !!ok; };

// ---------- the launcher in Clerk mode (synthetic issuer)
const { clerkKeys, ISSUER, PUBLISHABLE_KEY } = await import('../../../apps/server/test/clerk-fixture.ts');
const keys = await clerkKeys(origin);
const dir = mkdtempSync(join(tmpdir(), 'approve-window-'));
writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
writeFileSync(join(dir, 'clerk.env'), [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origin}`,
  `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${resolve(root, 'apps/server/test/clerk-jwks-preload.mjs')}`, ''].join('\n'));
const dataDir = join(out, 'data');
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', dataDir, '--base', BASE,
  '--web', resolve(args.web), '--auth-env', join(dir, 'clerk.env'), '--public-origin', origin], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
const listeners = new Set();
const stop = () => { for (const listener of listeners) void listener.stop('harness-stop'); try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop); for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop(); process.exit(130); });

async function call(url, { sub, body } = {}) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(sub ? { authorization: `Bearer ${await keys.sign(sub)}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data };
}
/** The Soul CLI in its own folder, as an agent runs it. */
const agent = (folder, argv, timeout = 120_000) => new Promise((ok, bad) => execFile(process.execPath, [CLI, ...argv], { cwd: folder, timeout, maxBuffer: 4 << 20 }, (e, stdout, stderr) => e ? bad(new Error(`${argv[0]}: ${String(stderr || e.message).slice(0, 400)}`)) : ok(stdout)));
const json = (s) => { try { return JSON.parse(s); } catch { const m = String(s).match(/\{[\s\S]*\}\s*$/); return m ? JSON.parse(m[0]) : { raw: String(s).slice(0, 400) }; } };

// ---------- Clerk in the browser: the stand-in of approve-on-top.mjs, signed in as the context's account
const STUB = `(() => {
  const KEY = 'stubClerk.user', listeners = new Set();
  const make = () => { const sub = window.Clerk && window.Clerk.loaded ? localStorage.getItem(KEY) : null;
    if (!sub) return { client: { sessions: [], signedInSessions: [], activeSessions: [], lastActiveSessionId: null }, session: null, user: null, organization: null };
    const user = { id: sub, firstName: sub.slice(5), primaryEmailAddress: { emailAddress: sub + '@example.test' }, emailAddresses: [], organizationMemberships: [] };
    const sid = 'sess_' + sub.replace(/[^A-Za-z0-9]/g, '');
    const session = { id: sid, status: 'active', user, actor: null, lastActiveToken: { jwt: { claims: { sub, sid, iss: 'https://clerk.example.test' } } }, factorVerificationAge: null,
      getToken: async () => window.__stubClerkMint(sub), checkAuthorization: () => true };
    return { client: { sessions: [session], signedInSessions: [session], activeSessions: [session], lastActiveSessionId: sid }, session, user, organization: null }; };
  let state = make();
  const emit = () => { state = make(); for (const l of listeners) l({ ...state }); };
  window.Clerk = { loaded: false, status: 'loading', version: 'stub', sdkMetadata: {}, instanceType: 'production', frontendApi: 'clerk.example.test', isSatellite: false,
    get client() { return state.client; }, get session() { return state.session; }, get user() { return state.user; }, get organization() { return null; },
    async load() { await new Promise((r) => setTimeout(r, 600)); this.loaded = true; this.status = 'ready'; emit(); },
    addListener(l) { listeners.add(l); l({ ...state }); return () => listeners.delete(l); },
    on(event, handler) { if (event === 'status' && typeof handler === 'function') setTimeout(() => handler(this.status), 0); }, off() {}, __internal_getOption() {}, __internal_updateProps() {}, telemetry: { record() {} },
    openSignIn() {}, openSignUp() {}, closeSignIn() {}, async signOut() { localStorage.removeItem(KEY); emit(); },
    async setActive() {}, buildSignInUrl() { return location.href; }, buildSignUpUrl() { return location.href; }, redirectToSignIn() {} };
})();`;

async function context(browser, sub, { viewport, dpr, mobile, colorScheme } = {}) {
  const ctx = await browser.newContext({ viewport: viewport ?? { width: 1352, height: 780 }, deviceScaleFactor: dpr ?? 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: colorScheme ?? 'light' });
  await ctx.exposeFunction('__stubClerkMint', (s) => keys.sign(s));
  await ctx.addInitScript((sub) => { try { localStorage.setItem('stubClerk.user', sub); } catch { /* storage off */ } }, sub);
  await ctx.addInitScript(STUB);
  await ctx.route(/clerk\.example\.test/, (r) => r.abort());
  return ctx;
}
const loaded = () => window.__soulsEntity?.layer?.active === true && !document.querySelector('.viewer-arrival:not([data-done="true"])');
async function openWorld(ctx, base, errors) {
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  await page.goto(base + '/', { waitUntil: 'commit' });
  await page.waitForFunction(loaded, null, { timeout: 90_000, polling: 300 });
  return page;
}
/** The card, where it is, and whether it is the topmost thing at its corners. */
const where = () => {
  const card = document.querySelector('[data-approval]'); if (!card) return { present: false };
  const r = card.closest('dialog')?.getBoundingClientRect() ?? card.getBoundingClientRect();
  const pts = [[r.left + 14, r.top + 14], [r.right - 50, r.top + 14], [r.left + r.width / 2, r.bottom - 14]];
  const onTop = pts.every(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && (card.closest('dialog') ?? card).contains(e); });
  return { present: true, status: card.getAttribute('data-approval-status'), box: [r.left, r.top, r.width, r.height].map(Math.round), vw: innerWidth, vh: innerHeight, onTop, hash: location.hash,
    rightGap: Math.round(innerWidth - r.right), name: card.querySelector('[data-approval-name]')?.textContent ?? '', avatar: !!card.querySelector('.ap-avatar') };
};
// LINK 2026-10-24: on a phone (< 460 px) the Pairing card is the bottom sheet (canvas PhonePairing)
const topRight = (w) => w.present && w.onTop && w.rightGap <= 40 && (w.vw <= 460 ? w.box[1] + w.box[3] >= w.vh - 40 : w.box[1] <= 170) && (w.vw < 600 || w.box[0] > w.vw / 2);
async function windowCode(page) {
  const state = () => page.evaluate(() => ({clerkLoaded: !!window.Clerk?.loaded, clerkStatus: window.Clerk?.status,
    accountMenu: !!document.querySelector('summary.account-avatar'), explanation: !!document.querySelector('[data-new-soul-explain]'),
    currentURL: location.href, godOpen: !!document.querySelector('[data-god-modal][open]'),
    promptHref: document.querySelector('.bring-agent-prompt a')?.getAttribute('href') ?? null}));
  const attempt = {at: new Date().toISOString(), before: await state(), responses: []};
  (report.windowCodeAttempts ??= []).push(attempt);
  const response = r => {const path = new URL(r.url()).pathname;if (/\/v1\/account\//.test(path)) attempt.responses.push({at: Date.now(), path, status: r.status(), method: r.request().method()});};
  page.on('response', response);
  try {
    // World drawing can finish before the deferred auth bridge. This scenario is explicitly signed in.
    // Wait for its real account UI before New Soul; otherwise the correct signed-out explanation opens.
    await page.locator('summary.account-avatar').waitFor({state: 'visible', timeout: 20_000});
    attempt.signedIn = await state();
    await clickNewSoulEntry(page, (event, detail) => {
      if (event === 'entry') attempt.entry = detail;
      else (attempt.godDismissals ??= []).push({at: Date.now()});
    });
    const link = page.locator('.bring-agent-prompt a');
    await page.waitForFunction(() => /\?for=[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.querySelector('.bring-agent-prompt a')?.getAttribute('href') ?? ''), null, { timeout: 20_000 });
    const href = await link.getAttribute('href');
    return { href, code: href.match(/\?for=([A-Z2-9]{4}-[A-Z2-9]{4})$/)[1] };
  } catch (error) {
    attempt.failure = await state().catch(() => null);
    const stem = `window-code-failure-${report.windowCodeAttempts.length}`;
    await page.screenshot({path: join(out, stem+'.png')}).catch(() => {});
    writeFileSync(join(out, stem+'.txt'), await page.locator('body').innerText().catch(() => '(page unavailable)'));
    throw error;
  } finally {page.off('response', response);}
}
async function waitStatus(page, status, timeout = 60_000) { await page.waitForFunction((s) => document.querySelector('[data-approval]')?.getAttribute('data-approval-status') === s, status, { timeout, polling: 250 }); }
async function newAgent(base, name) { const folder = mkdtempSync(join(tmpdir(), `soul-${name}-`)); await agent(folder, ['register', base]); return folder; }
function worldDb() {
  const found = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(db|sqlite)$/.test(f)) found.push(p); } };
  walk(dataDir);
  for (const p of found) { try { const db = new DatabaseSync(p); db.exec('PRAGMA busy_timeout=5000'); const has = db.prepare("SELECT name FROM sqlite_master WHERE name='account_approvals_v1'").get(); if (has) return db; db.close(); } catch { /* not ours */ } }
  throw new Error('no world DB with account_approvals_v1 under ' + dataDir);
}
const shot = (page, name) => page.screenshot({ path: join(out, name + '.png') }).catch(() => {});

let release = null, browser = null; const errors = [];
try {
  for (let i = 0; i < 60; i++) { if ((await fetch(`${origin}${BASE}/__sim/worlds.json`).then((r) => r.ok, () => false))) break; await sleep(1000); }
  const made = await call(`${origin}${BASE}/__sim/worlds`, { sub: 'user_gene', body: { name: `Window ${Date.now() % 100000}` } });
  const slug = made.data?.slug ?? made.data?.world?.slug ?? String(made.data?.url ?? '').match(/\/w\/([a-z][a-z0-9-]*)/)?.[1];
  if (made.status !== 201 || !slug) throw new Error(`create world: ${made.status} ${JSON.stringify(made.data).slice(0, 300)}`);
  const base = `${origin}${BASE}/w/${slug}`; report.world = base;
  for (let i = 0; i < 120; i++) { const s = await call(`${base}/v1/god/status`, { sub: 'user_gene' }).catch(() => null); if (s?.status === 200) break; await sleep(1000); }
  release = await chromeLease('approve-in-window');
  browser = await chromium.launch({ channel: 'chrome', headless: !args.headed, args: ['--ignore-gpu-blocklist'] });

  // ---------- A: gene, desktop dpr 1 — in-window delivery, Approve -> Connected -> closes itself -> paired
  {
    const ctx = await context(browser, 'user_gene', { dpr: 1 });
    const page = await openWorld(ctx, base, errors);
    const { href, code } = await windowCode(page);
    check('A1 New Soul prompt links instructions.md?for=<this window code>', href === `${base}/instructions.md?for=${code}`, { href });
    await shot(page, 'A1-new-soul-prompt');
    const guide = await fetch(href).then((r) => r.text());
    check('A2 the instructions name create-soul --for CODE', guide.includes(`--for ${code}`), { has: guide.includes(code) });
    await page.keyboard.press('Escape');
    const urlBefore = page.url(), pagesBefore = ctx.pages().length;
    const folder = await newAgent(base, 'ana');
    const made = json(await agent(folder, ['create-soul', 'Ana', '--for', code]));
    report.createA = made;
    check('A3 the agent\'s request is delivered to the window', JSON.stringify(made).includes('window'), { made: JSON.stringify(made).slice(0, 300) });
    const waiting = agent(folder, ['approval', 'wait'], 300_000).then(json, (e) => ({ error: e.message }));
    const t0 = Date.now();
    await page.waitForSelector('[data-approval]', { timeout: 30_000 });
    const w = await page.evaluate(where);
    check('A4 the card appears top right in the same page, no navigation', topRight(w) && page.url() === urlBefore && ctx.pages().length === pagesBefore && w.status === 'pending' && w.name === 'Ana' && w.avatar, { ms: Date.now() - t0, ...w });
    await shot(page, 'A4-card-desktop-dpr1-light');
    await page.emulateMedia({ colorScheme: 'dark' }); await sleep(300); await shot(page, 'A4-card-desktop-dpr1-dark'); await page.emulateMedia({ colorScheme: 'light' });
    const id = JSON.stringify(made).match(/ap_[a-f0-9]{32}/)?.[0];
    const label = (await call(`${base}/v1/account/approvals/${id}`, { sub: 'user_gene' })).data?.approval?.agentLabel;
    const plain = await page.locator('[data-approval]').innerText();
    // LINK 2026-10-24 (spec §4): the card says "An agent calling itself <label> asks …" inline; the (i) toggle is gone
    check('A5a the label shows only as what the agent calls itself; no folder or approval-wait talk', !!label && plain.includes(`An agent calling itself ${label}`) && !/folder|approval wait|Connected|s_[A-Za-z0-9]/.test(plain), { plain, label });
    check('A5 the note line holds the agent name', (await page.locator('[data-approval-note]').innerText()).includes(label));
    await shot(page, 'A5-card-pairing');
    // what the card shows between Approve and the body (it can be short): recorded by an observer, not by polling
    await page.evaluate(() => { const seen = window.__apSeen = []; new MutationObserver(() => { const p = document.querySelector('[data-approval-preparing]'); if (p) { const sp = p.querySelector('.ap-spinner'); const r = sp?.getBoundingClientRect(); seen.push({ text: p.textContent, spinner: !!sp && r.width > 0 && getComputedStyle(sp).animationName === 'ap-spin', buttons: document.querySelectorAll('[data-approve-agent],[data-refuse-agent]').length }); } }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); });
    await page.locator('[data-approve-agent]').click();
    await page.waitForSelector('[data-approval-preparing]', { timeout: 5_000 }).then(() => shot(page, 'A6-preparing-light'), () => {});
    if (await page.locator('[data-approval-preparing]').count()) { await page.emulateMedia({ colorScheme: 'dark' }); await sleep(150); await shot(page, 'A6-preparing-dark'); await page.emulateMedia({ colorScheme: 'light' }); }
    const seen = await page.evaluate(() => window.__apSeen);
    check('A6 Approve -> "Ana is being prepared by your agent. Please wait…" with a spinner, no buttons', seen.some((x) => x.text === 'Ana is being prepared by your agent. Please wait…' && x.spinner && x.buttons === 0), { seen: seen.slice(-2) });
    const gone = await page.waitForSelector('[data-approval]', { state: 'detached', timeout: 90_000 }).then(() => true, () => false);
    const server = (await call(`${base}/v1/account/approvals/${id}`, { sub: 'user_gene' })).data?.approval;
    check('A7 the card closes itself once the body is ready', gone && server?.status === 'ready' && /^s_/.test(server?.soulId ?? ''), { gone, status: server?.status, soulId: server?.soulId });
    const following = await page.waitForFunction((sid) => document.querySelector('[data-camera="follow"]')?.getAttribute('data-follow-soul') === sid, server?.soulId, { timeout: 30_000, polling: 250 }).then(() => true, () => false);
    const chip = await page.evaluate(() => { const c = document.querySelector('[data-camera]'); return { mode: c?.getAttribute('data-camera'), soul: c?.getAttribute('data-follow-soul'), text: c?.textContent }; });
    check('A8 the camera follows the new Soul (follow target = its id)', following && chip.soul === server?.soulId && /Ana/.test(chip.text ?? ''), chip);
    await sleep(1500); await shot(page, 'A8-following-ana');
    // LINK: approval grants control; the message box belongs to Connected, reached by the CLI's first listen.
    const done = await waiting;
    report.waitA = done;
    if (done.paired !== true || done.soul?.id !== server?.soulId) throw Error('A10 fixture: approval wait did not grant this Soul');
    const urlA10 = page.url(), documentA10 = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate((sid) => { location.hash = '#soul/' + sid; }, server?.soulId);
    await page.waitForSelector('[data-soul-state="approved-waiting"]', { timeout: 20_000 });
    const beforeListen = await call(`${base}/v1/edge/owner/${server.soulId}/inbox`, {sub: 'user_gene'});
    const waitingLink = beforeListen.data?.inbox?.link;
    if (!check('A10a approved-waiting has no owner message box', beforeListen.status === 200 && waitingLink?.state === 'disconnected' && waitingLink?.reason === 'approved-waiting' && (await page.locator('[data-agent-message="soul"]').count()) === 0, {link: waitingLink})) throw Error('A10 fixture: expected approved-waiting before listen');
    const listener = startWindowListener(CLI, folder); listeners.add(listener);
    try {
      await page.waitForSelector('[data-soul-state="connected"]', { timeout: 20_000 });
      const afterListen = await call(`${base}/v1/edge/owner/${server.soulId}/inbox`, {sub: 'user_gene'});
      const connectedLink = afterListen.data?.inbox?.link;
      const connected = afterListen.status === 200 && connectedLink?.state === 'connected' && connectedLink?.reason === 'listening' && listener.running();
      check('A10b the same granted CLI is actively listening and Connected', connected, {link: connectedLink, listenerPid: listener.evidence.pid});
      // R20: retain the original selector,20s deadline and no-reload assertion; also verify document identity.
      const ownerBox = await page.waitForSelector('[data-agent-message="soul"]', { timeout: 20_000 }).then(() => true, () => false);
      const sameDocument = await page.evaluate(() => performance.timeOrigin) === documentA10;
      check('A10 the owner message box appears for the new Soul without a reload', ownerBox && connected && listener.running() && sameDocument && page.url().split('#')[0] === urlA10.split('#')[0], { ownerBox, sameDocument });
      await shot(page, 'A10-owner-box');
    } finally {
      report.listenA = await listener.stop(); listeners.delete(listener);
      check('A10c owned CLI listener stopped cleanly', !report.listenA.error && !report.listenA.forcedKill && report.listenA.stopReason === 'fixture-finished' && (report.listenA.code === 0 || report.listenA.signal === 'SIGTERM'), report.listenA);
    }
    const status = json(await agent(folder, ['status']).catch((e) => e.message));
    check('A8b the agent is paired', done.paired === true && done.soul?.name === 'Ana' && status.paired === true && status.soul === done.soul?.id && done.soul?.id === server?.soulId, { done: JSON.stringify(done).slice(0, 200), status: JSON.stringify(status).slice(0, 200) });
    await sleep(6000);
    check('A9 the card does not come back', (await page.locator('[data-approval]').count()) === 0);
    await ctx.close();
  }

  // ---------- B: ana, desktop dpr 2, dark — timed out -> Ask again -> Approve -> paired
  {
    const ctx = await context(browser, 'user_ana', { dpr: 2, colorScheme: 'dark' });
    const page = await openWorld(ctx, base, errors);
    const { code } = await windowCode(page); await page.keyboard.press('Escape');
    const folder = await newAgent(base, 'bea');
    const made = json(await agent(folder, ['create-soul', 'Bea', '--for', code]));
    const id = JSON.stringify(made).match(/ap_[a-f0-9]{32}/)?.[0];
    await page.waitForSelector('[data-approval]', { timeout: 30_000 });
    const w = await page.evaluate(where);
    check('B1 the card appears top right (dpr 2, dark)', topRight(w) && w.status === 'pending', w);
    await shot(page, 'B1-card-desktop-dpr2-dark');
    await page.emulateMedia({ colorScheme: 'light' }); await sleep(300); await shot(page, 'B1-card-desktop-dpr2-light'); await page.emulateMedia({ colorScheme: 'dark' });
    // the agent stopped polling 15 min ago: move the expiry into the past in this test world's DB
    const db = worldDb(); const changed = db.prepare("UPDATE account_approvals_v1 SET expires_at=? WHERE id=? AND status='pending'").run(Date.now() - 1000, id).changes; db.close();
    check('B2 test: the request\'s expiry moved into the past', changed === 1, { id });
    await waitStatus(page, 'expired', 20_000);
    check('B3 Timed out + Ask again', /Timed out/.test(await page.locator('[data-approval]').innerText()) && (await page.locator('[data-approval-renew]').count()) === 1);
    await shot(page, 'B3-timed-out');
    await page.locator('[data-approval-renew]').click();
    await waitStatus(page, 'pending', 15_000);
    check('B4 Ask again -> pending, same request', (await call(`${base}/v1/account/approvals/${id}`, { sub: 'user_ana' })).data?.approval?.status === 'pending');
    const waiting = agent(folder, ['approval', 'wait'], 300_000).then(json, (e) => ({ error: e.message }));
    await page.locator('[data-approve-agent]').click();
    await page.waitForSelector('[data-approval]', { state: 'detached', timeout: 90_000 });
    const done = await waiting;
    const status = json(await agent(folder, ['status']).catch((e) => e.message));
    check('B5 Approve after Ask again -> paired', done.paired === true && done.soul?.name === 'Bea' && status.paired === true, { done: JSON.stringify(done).slice(0, 200) });
    await ctx.close();
  }

  // ---------- C: cy, phone dpr 3 — the card on a phone; Refuse -> Refused, the request is cancelled
  {
    const ctx = await context(browser, 'user_cy', { viewport: { width: 390, height: 844 }, dpr: 3, mobile: true });
    const page = await openWorld(ctx, base, errors);
    const { code } = await windowCode(page); await page.keyboard.press('Escape');
    const folder = await newAgent(base, 'cy');
    const made = json(await agent(folder, ['create-soul', 'Cy', '--for', code]));
    const id = JSON.stringify(made).match(/ap_[a-f0-9]{32}/)?.[0];
    await page.waitForSelector('[data-approval]', { timeout: 30_000 });
    const w = await page.evaluate(where);
    const targets = await page.evaluate(() => [...document.querySelectorAll('[data-approval] button')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.width), Math.round(r.height)]; }));
    check('C1 the card on a phone: at the top, on top, 44 px targets', topRight(w) && targets.every(([, wd, h]) => wd >= 44 && h >= 44), { ...w, targets });
    await shot(page, 'C1-card-phone-light');
    await page.emulateMedia({ colorScheme: 'dark' }); await sleep(300); await shot(page, 'C1-card-phone-dark'); await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('[data-refuse-agent]').click();
    await waitStatus(page, 'cancelled', 15_000);
    check('C2 Refuse -> Refused; the request is cancelled', /Refused/.test(await page.locator('[data-approval]').innerText()) && (await call(`${base}/v1/account/approvals/${id}`, { sub: 'user_cy' })).data?.approval?.status === 'cancelled');
    await shot(page, 'C2-refused-phone');
    await page.locator('[data-approval-done]').click();
    check('C3 Close closes the refused card', await page.waitForSelector('[data-approval]', { state: 'detached', timeout: 5_000 }).then(() => true, () => false));
    await ctx.close();
  }

  // ---------- D: two tabs of the world: one sound
  {
    const ctx = await context(browser, 'user_gene', { dpr: 1 });
    const one = await openWorld(ctx, base, errors);
    const two = await openWorld(ctx, base, errors);
    const focus = (p) => p.evaluate(() => window.__edenAudioFocus?.audible() ?? null);
    const afterOpen = [await focus(one), await focus(two)];
    await one.bringToFront(); await one.mouse.click(30, 400); await sleep(300);
    const afterTouch = [await focus(one), await focus(two)];
    check('D1 one tab sounds: the newest, then the one touched', JSON.stringify(afterOpen) === '[false,true]' && JSON.stringify(afterTouch) === '[true,false]', { afterOpen, afterTouch });
    await ctx.close();
  }
  check('no page errors', errors.length === 0, { errors: errors.slice(0, 5) });
} catch (e) {
  report.failures.push('harness: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
  console.log('harness error', e);
} finally {
  await Promise.all([...listeners].map(listener => listener.stop('harness-finally')));
  if (browser) await browser.close().catch(() => {});
  release?.();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(out, 'launcher.log'), launcherLog);
  console.log(`\n${report.failures.length ? '✖ ' + report.failures.join(', ') : '✔ all steps'} — ${join(out, 'report.json')}`);
  stop();
  process.exit(report.failures.length ? 1 : 0);
}
