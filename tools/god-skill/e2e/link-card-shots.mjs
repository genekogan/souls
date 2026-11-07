#!/usr/bin/env node
// LINK lane CARD (2026-10-24): headless shots of every Soul card state in a real local world (launcher in Clerk mode with a
// synthetic issuer, as approve-in-window.mjs). The server fields `link`, `body` and `now` (COMMON-LINK §2) are built by the
// parallel BODY/API lanes, so each state is set by rewriting the owner inbox and public Soul record responses in the browser
// (page.route); Pairing is the real flow (the CLI asks, the window shows it: forced up with no card open, inside an open card).
//   node tools/god-skill/e2e/link-card-shots.mjs --web <vite build --base /worlds/> [--port 6790] [--range 6791-6795] [--out <dir>]
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { scratchDir } from '../../lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../lib/chrome-lease.mjs');
const { chromium } = createRequire(`${root}/mars/viewer/package.json`)('@playwright/test');
const port = Number(args.port ?? 6790), range = typeof args.range === 'string' ? args.range : '6791-6795';
const origin = `http://127.0.0.1:${port}`, BASE = '/worlds';
const out = resolve(typeof args.out === 'string' ? args.out : scratchDir('link/card-shots'));
mkdirSync(out, { recursive: true });
if (typeof args.web !== 'string') { console.error('--web <vite build --base /worlds/> is required'); process.exit(2); }
const CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { origin, steps: [], failures: [] };
const check = (name, ok, detail = {}) => { report.steps.push({ name, ok: !!ok, ...detail }); if (!ok) report.failures.push(name); console.log(`${ok ? '✔' : '✖'} ${name} ${JSON.stringify(detail).slice(0, 400)}`); return !!ok; };

// ---------- the launcher in Clerk mode (synthetic issuer)
const { clerkKeys, ISSUER, PUBLISHABLE_KEY } = await import('../../../apps/server/test/clerk-fixture.ts');
const keys = await clerkKeys(origin);
const dir = mkdtempSync(join(tmpdir(), 'link-card-shots-'));
writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
writeFileSync(join(dir, 'clerk.env'), [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origin}`,
  `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${resolve(root, 'apps/server/test/clerk-jwks-preload.mjs')}`, ''].join('\n'));
const dataDir = mkdtempSync(join(tmpdir(), 'link-card-data-'));
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', dataDir, '--base', BASE,
  '--web', resolve(args.web), '--auth-env', join(dir, 'clerk.env'), '--public-origin', origin], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
const stop = () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop); for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop(); process.exit(130); });

async function call(url, { sub, body } = {}) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(sub ? { authorization: `Bearer ${await keys.sign(sub, { exp: Math.floor(Date.now() / 1000) + 900 })}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
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

async function windowCode(page) {
  await page.locator('button.bring-agent-open').first().click();
  const link = page.locator('.bring-agent-prompt a');
  await page.waitForFunction(() => /\?for=[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.querySelector('.bring-agent-prompt a')?.getAttribute('href') ?? ''), null, { timeout: 90_000 });
  const href = await link.getAttribute('href');
  return { href, code: href.match(/\?for=([A-Z2-9]{4}-[A-Z2-9]{4})$/)[1] };
}
async function newAgent(base, name) { const folder = mkdtempSync(join(tmpdir(), `soul-${name}-`)); await agent(folder, ['register', base]); return folder; }

const shot = (page, name) => page.screenshot({ path: join(out, name + '.png') }).catch((e) => console.log('shot failed', name, e.message));
const T = Date.now(), min = 60_000;
const connected = { state: 'connected', reason: 'listening', since: T - 28 * min, holder: { label: 'eden-agent 1.9.16', since: T - 28 * min } };
const off = (reason, since = T - 2 * 60 * min) => ({ state: 'disconnected', reason, since, holder: null });
const nowLine = { text: 'Heading to the pond to see if the koi are up.', at: T - 3 * min }, lastNow = { ...nowLine, at: T - 2 * 60 * min };
const latest = { id: 'm1', text: 'go to the pond', state: 'acknowledged', reply: null, result: 'Arrived at the pond.', outcome: 'done', sentAt: T - 5 * min };
const OWNER = {
  'connected': { link: connected, body: { state: 'awake', doing: null, since: T - 28 * min }, now: nowLine },
  'connected-open': { link: connected, body: { state: 'awake', doing: null, since: T - 28 * min }, now: nowLine, open: true },
  'connected-idle': { link: connected, body: { state: 'idle', doing: 'dozing', since: T - 40 * min }, now: { text: 'Watching the koi. Nothing to do for now.', at: T - 40 * min } },
  'disconnected-zombie': { link: off('stopped-listening', T - 10 * min), body: { state: 'zombie', doing: null, since: T - 10 * min }, now: lastNow },
  'disconnected-asleep': { link: off('stopped-listening'), body: { state: 'asleep', doing: null, since: T - 2 * 60 * min }, now: lastNow },
  'disconnected-replaced': { link: off('replaced', T - 50 * min), body: { state: 'zombie', doing: null, since: T - 50 * min }, now: lastNow },
  'disconnected-revoked': { link: off('revoked', T - 45 * min), body: { state: 'asleep', doing: null, since: T - 15 * min }, now: lastNow },
  'disconnected-never': { link: off('never', null), body: { state: 'asleep', doing: null, since: T - 5 * min }, now: null },
  'approved-waiting': { link: off('approved-waiting', Date.now() - 20_000), body: { state: 'awake', doing: 'standing', since: T }, now: null, fresh: true },
  'approved-waiting-late': { link: off('approved-waiting', T - 90_000), body: { state: 'awake', doing: 'standing', since: T }, now: null },
};
const VISITOR = {
  'visitor-awake': { body: { state: 'awake', doing: null, since: T - 28 * min }, now: nowLine },
  'visitor-idle': { body: { state: 'idle', doing: 'sitting', since: T - 12 * min }, now: { text: 'Watching the koi.', at: T - 12 * min } },
  'visitor-zombie': { body: { state: 'zombie', doing: null, since: T - 8 * min }, now: { text: 'Danced for ten minutes. Hello, field.', at: T - 60 * min } },
  'visitor-asleep': { body: { state: 'asleep', doing: null, since: T - 20 * 60 * min }, now: { text: 'Danced for ten minutes. Hello, field.', at: T - 21 * 60 * min } },
};
/** Rewrite the owner inbox and the public Soul record with the fixture `cur.f` (GETs only; sends pass through). */
async function rewrite(ctx, cur) {
  await ctx.route(/\/v1\/edge\/owner\/[^/]+\/inbox$/, async (route) => {
    if (route.request().method() !== 'GET' || !cur.f?.link) return route.continue();
    const r = await route.fetch(); const d = await r.json().catch(() => null);
    if (!d?.inbox) return route.fulfill({ response: r });
    const live = cur.f.link.state === 'connected';
    d.inbox = { ...d.inbox, link: { ...cur.f.link, ...(cur.f.fresh ? { since: cur.fresh } : {}) }, presence: live ? 'listening' : 'away', connected: live, latest: live ? latest : d.inbox.latest, queued: 0 };
    return route.fulfill({ response: r, json: d });
  });
  await ctx.route(/\/v1\/edge\/public\/souls\/[^/]+$/, async (route) => {
    const r = await route.fetch(); const d = await r.json().catch(() => null);
    if (!d || !cur.f) return route.fulfill({ response: r });
    return route.fulfill({ response: r, json: { ...d, body: cur.f.body, now: cur.f.now, self: { ...(d.self ?? {}), placePath: [{ name: cur.f.place ?? (cur.f.now ? 'the pond' : 'the commons') }] } } });
  });
}
async function openCard(page, sid) {
  await page.evaluate(() => { location.hash = '#watch'; }); await sleep(300);
  await page.evaluate((s) => { location.hash = '#soul/' + s; }, sid);
  await page.waitForSelector('article.soul-card', { timeout: 20_000 });
  await sleep(2600);   // the inbox answers within its 2 s poll; the record on mount
}
const views = [['desktop', { viewport: { width: 1440, height: 900 }, dpr: 1 }], ['phone', { viewport: { width: 390, height: 844 }, dpr: 2, mobile: true }]];
const report2 = { shots: [], checks: [] };
const note = (name, ok, detail) => { report2.checks.push({ name, ok: !!ok, ...detail }); console.log(`${ok ? '✔' : '✖'} ${name} ${JSON.stringify(detail ?? {}).slice(0, 300)}`); };

let release = null, browser = null; const errors = [];
try {
  for (let i = 0; i < 60; i++) { if ((await fetch(`${origin}${BASE}/__sim/worlds.json`).then((r) => r.ok, () => false))) break; await sleep(1000); }
  let made; for (let i = 0; i < 20; i++) { made = await call(`${origin}${BASE}/__sim/worlds`, { sub: 'user_gene', body: { name: `Link ${Date.now() % 100000}` } }); if (made.status !== 401) break; await sleep(10_000); }
  const slug = made.data?.slug ?? made.data?.world?.slug ?? String(made.data?.url ?? '').match(/\/w\/([a-z][a-z0-9-]*)/)?.[1];
  if (made.status !== 201 || !slug) throw new Error(`create world: ${made.status} ${JSON.stringify(made.data).slice(0, 300)}`);
  const base = `${origin}${BASE}/w/${slug}`;
  for (let i = 0; i < 120; i++) { const s = await call(`${base}/v1/god/status`, { sub: 'user_gene' }).catch(() => null); if (s?.status === 200) break; await sleep(1000); }
  release = await chromeLease('link-card-shots');
  browser = await chromium.launch({ channel: 'chrome', headless: !args.headed, args: ['--ignore-gpu-blocklist'] });
  let sid = null;
  for (const [view, opts] of views) {
    const ctx = await context(browser, 'user_gene', { ...opts });
    const cur = { f: null, fresh: 0 }; await rewrite(ctx, cur);
    const page = await openWorld(ctx, base, errors);
    // a new world's owner sees God Mode open by itself once (no agent yet): close it first
    await page.waitForSelector('dialog[open][data-god-modal]', { timeout: sid ? 12_000 : 30_000 }).catch(() => {});
    for (let i = 0; i < 4 && await page.evaluate(() => !!document.querySelector('dialog[open][data-god-modal]')); i++) { await page.keyboard.press('Escape'); await sleep(700); }
    const { code } = await windowCode(page); await page.keyboard.press('Escape'); await sleep(400);
    if (!sid) {
      // Pairing, forced up with no card open: a new Soul's request
      const folder = await newAgent(base, 'mickey');
      json(await agent(folder, ['create-soul', 'Mickey', '--for', code]));
      await page.waitForFunction(() => document.querySelector('[data-approval]')?.getAttribute('data-approval-status') === 'pending', null, { timeout: 30_000, polling: 250 });
      await sleep(500); await shot(page, `${view}-pairing-forced-up`);
      const waiting = agent(folder, ['approval', 'wait'], 300_000).then(json, (e) => ({ error: e.message }));
      await page.locator('[data-approve-agent]').click();
      await page.waitForSelector('[data-approval]', { state: 'detached', timeout: 90_000 });
      const done = await waiting; sid = done.soul?.id ?? null;
      note('approved: the agent is paired and the Soul exists', !!sid, { sid });
      report2.agentFolder = folder;
    }
    for (const [name, f] of Object.entries(OWNER)) {
      cur.f = f; cur.fresh = Date.now() - 15_000;
      await openCard(page, sid);
      if (f.open) { await page.locator('button.soul-link').click(); await page.getByRole('button', { name: /Pair another session/ }).click(); await sleep(300); }
      const state = await page.evaluate(() => document.querySelector('article.soul-card')?.getAttribute('data-soul-state'));
      note(`${view} ${name}: card state`, !!state, { state });
      await shot(page, `${view}-${name}`); report2.shots.push(`${view}-${name}`);
    }
    // Pairing inside an open card: a second session asks to take over while the card is open
    cur.f = OWNER.connected; await openCard(page, sid);
    const other = await newAgent(base, 'second');
    const asked = agent(other, ['pair-soul', sid, '--for', code]).then(json, (e) => ({ error: e.message }));
    const inCard = await page.waitForFunction(() => !!document.querySelector('.human-panel [data-approval][data-approval-status="pending"]'), null, { timeout: 30_000, polling: 250 }).then(() => true, () => false);
    const dialogs = await page.evaluate(() => document.querySelectorAll('dialog[open] [data-approval]').length);
    note(`${view} pairing in the open card, no second dialog`, inCard && dialogs === 0, { inCard, dialogs, asked: JSON.stringify(await Promise.race([asked, sleep(10).then(() => 'pending')])).slice(0, 120) });
    await sleep(500); await shot(page, `${view}-pairing-in-card`);
    // closing the panel leaves the request pending: it comes up forced, as the dialog
    await page.locator('#soul-panel .panel-close').click(); await sleep(800);
    const forced = await page.evaluate(() => document.querySelectorAll('dialog[open] [data-approval]').length);
    note(`${view} panel closed: the request is forced up as the dialog`, forced === 1, { forced });
    await shot(page, `${view}-pairing-after-close`);
    await page.locator('[data-refuse-agent]').click(); await sleep(800);
    await page.locator('[data-approval-done]').click().catch(() => {});
    // chips: connected / asleep / pairing rings at the top
    cur.f = OWNER['disconnected-asleep']; await sleep(16_000); await shot(page, `${view}-chip-asleep`);
    cur.f = OWNER.connected; await sleep(16_000); await shot(page, `${view}-chip-connected`);
    await ctx.close();
    // visitor
    const vctx = await context(browser, 'user_bob', { ...opts });
    const vcur = { f: null }; await rewrite(vctx, vcur);
    const vpage = await openWorld(vctx, base, errors);
    for (const [name, f] of Object.entries(VISITOR)) {
      vcur.f = f; await openCard(vpage, sid);
      const owner = await vpage.evaluate(() => !!document.querySelector('[data-agent-message], [data-reconnect], .soul-link'));
      note(`${view} ${name}: no owner controls`, !owner, {});
      await shot(vpage, `${view}-${name}`); report2.shots.push(`${view}-${name}`);
    }
    await vctx.close();
  }
} catch (e) { console.error(e); for (const c of browser?.contexts() ?? []) for (const p of c.pages()) await p.screenshot({ path: join(out, 'failure.png') }).catch(() => {}); report2.error = String(e?.stack ?? e).slice(0, 1200); }
finally {
  report2.pageErrors = errors.slice(0, 20);
  writeFileSync(join(out, 'shots-report.json'), JSON.stringify(report2, null, 1));
  await browser?.close().catch(() => {}); release?.(); stop();
  if (report2.error) console.log(launcherLog.slice(-3000));
  process.exit(report2.error || report2.checks.some((c) => !c.ok) ? 1 : 0);
}
