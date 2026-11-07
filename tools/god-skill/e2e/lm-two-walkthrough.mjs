#!/usr/bin/env node
// Lane LM walkthrough (copied from lane X's fix-x-walkthrough.mjs): a person signs in on the /worlds launcher in Clerk
// mode, creates "Little Martians (Arium)" from the New-world dialog (template littlemartians-two) and is its god at
// birth; real Chrome (lease), real input at a chosen device pixel ratio (--dpr 1|2); looks around the Arium with the
// keyboard, mouse and wheel; pairs a god agent that places library defs (core/lm-*) by name; joins as a Soul.
// Clerk in the browser: a test-only stand-in for clerk-js (window.Clerk, defined before the app loads, so the real
// ClerkProvider/useAuth run unchanged) whose session tokens are minted by the synthetic issuer the launcher's worlds
// verify (fix-x-clerk-keys.mjs). Sign-in is a real click in a modal; the signed-in user lives in this origin's
// localStorage, so it carries from page to page like Clerk's own session. Needs a running launcher in that mode, e.g.
//   node tools/god-skill/e2e/fix-x-clerk-keys.mjs init http://127.0.0.1:5114
//   node tools/world-launcher/launcher.mjs --port 5114 --range 5115-5120 --data <dir> --base /worlds --web <vite build --base /worlds/>
//        --auth-env <abs>/.lane/fixx/clerk/clerk.env --public-origin http://127.0.0.1:5114
//   node tools/god-skill/e2e/fix-x-walkthrough.mjs --origin http://127.0.0.1:5114 --base /worlds [--out dir] [--headed]
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';
import { sign } from './fix-x-clerk-keys.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const origin = args.origin ?? 'http://127.0.0.1:5114', BASE = (args.base ?? '/worlds').replace(/\/+$/, '');
const DPR = Number(args.dpr ?? 1), TEMPLATE = args.template ?? 'littlemartians-two';
const out = args.out ?? `${root}/.lane/lm-two-walk/dpr${DPR}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(`${root}/mars/viewer/package.json`)('@playwright/test');
const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = []; let failed = 0;
const check = (name, ok, data) => { report.push({ name, ok: !!ok, data }); if (!ok) failed++; console.log(`${ok ? '✔' : '✖'} ${name}`, data === undefined ? '' : JSON.stringify(data).slice(0, 400)); };
const sh = (cwd, line, timeout = 180_000) => exec('bash', ['-c', line], { cwd, timeout, maxBuffer: 8 << 20 }).then((r) => r.stdout.trim());

const STUB = `(() => {
  const KEY = 'stubClerk.user', listeners = new Set();
  const make = () => { const sub = localStorage.getItem(KEY);
    if (!sub) return { client: { sessions: [], signedInSessions: [], activeSessions: [], lastActiveSessionId: null }, session: null, user: null, organization: null };
    const user = { id: sub, firstName: 'Gene', primaryEmailAddress: { emailAddress: 'gene@example.test' }, emailAddresses: [], organizationMemberships: [] };
    const session = { id: 'sess_' + sub.replace(/[^A-Za-z0-9]/g, ''), status: 'active', user, actor: null, lastActiveToken: { jwt: { claims: { sub, sid: 'sess_' + sub.replace(/[^A-Za-z0-9]/g, ''), iss: 'https://clerk.example.test' } } }, factorVerificationAge: null,
      getToken: async () => window.__stubClerkMint(sub), checkAuthorization: () => true };
    return { client: { sessions: [session], signedInSessions: [session], activeSessions: [session], lastActiveSessionId: session.id }, session, user, organization: null }; };
  let state = make();
  const emit = () => { state = make(); for (const l of listeners) l({ ...state }); };
  const modal = () => { if (document.querySelector('[data-stub-clerk]')) return; const d = document.createElement('div'); d.dataset.stubClerk = '1';
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.4);display:grid;place-items:center';
    d.innerHTML = '<div style="background:#fff;color:#111;padding:24px;border-radius:12px;font:15px system-ui"><p>Sign in (test Clerk)</p><button data-stub-clerk-continue style="font:15px system-ui;padding:8px 14px">Continue as gene</button></div>';
    d.querySelector('button').onclick = () => { localStorage.setItem(KEY, 'user_gene'); d.remove(); emit(); }; document.body.append(d); };
  window.Clerk = { loaded: false, status: 'loading', version: 'stub', sdkMetadata: {}, instanceType: 'production', frontendApi: 'clerk.example.test', isSatellite: false,
    get client() { return state.client; }, get session() { return state.session; }, get user() { return state.user; }, get organization() { return null; },
    async load() { this.loaded = true; this.status = 'ready'; },
    addListener(l) { listeners.add(l); l({ ...state }); return () => listeners.delete(l); },
    on(event, handler) { if (event === 'status' && typeof handler === 'function') setTimeout(() => handler(this.status), 0); }, off() {}, __internal_getOption() {}, __internal_updateProps() {}, telemetry: { record() {} },
    openSignIn() { modal(); }, openSignUp() { modal(); }, closeSignIn() {}, async signOut() { localStorage.removeItem(KEY); emit(); },
    async setActive() {}, buildSignInUrl() { return location.href; }, buildSignUpUrl() { return location.href; }, redirectToSignIn() { modal(); } };
})();`;

const release = await chromeLease('lane-lm-two walkthrough');
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed, args: ['--ignore-gpu-blocklist'] });
let pairing = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: DPR });
  await ctx.exposeFunction('__stubClerkMint', (sub) => sign(sub, origin));
  await ctx.addInitScript(STUB);
  await ctx.route(/clerk\.example\.test/, (r) => r.abort());
  const page = await ctx.newPage(); page.setDefaultTimeout(120_000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); const consoleLines = []; page.on('console', (m) => consoleLines.push(m.type() + ': ' + m.text().slice(0, 300)));
  const shot = async (name) => { const f = join(out, name + '.png'); await page.screenshot({ path: f }); return f; };

  // 1. homepage → sign in once
  await page.goto(`${origin}${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-home-signin]').waitFor();
  await shot('01-home-signed-out');
  await page.locator('[data-home-signin]').click();
  await page.locator('[data-stub-clerk-continue]').click();
  await page.locator('[data-signed-in]').waitFor({ timeout: 30_000 }).catch(async (e) => { console.log('debug', await page.evaluate(() => ({ user: window.Clerk.user?.id, loaded: window.Clerk.loaded, text: document.body.innerText.slice(0, 300) })), errors, consoleLines.slice(-8)); throw e; });
  check('homepage: one sign-in shows the person signed in', true, { text: await page.locator('[data-signed-in]').innerText() });
  await shot('02-home-signed-in');
  // 2. New world → the world page shows them signed in (no second sign-in)
  await page.locator('[data-new-world]').click();
  await page.locator('[data-world-name]').fill(`Arium ${Date.now() % 100000}`);
  const offered = await page.locator(`[data-template="${TEMPLATE}"]`).count();
  check(`the New-world dialog offers the ${TEMPLATE} template`, offered === 1, { offered, text: (await page.locator(`[data-template="${TEMPLATE}"]`).innerText().catch(() => '')).slice(0, 160) });
  await page.locator(`[data-template="${TEMPLATE}"]`).click();
  await shot('02b-new-world-template');
  await Promise.all([page.waitForURL(/\/w\/[a-z]/, { timeout: 180_000, waitUntil: 'commit' }), page.locator('[data-create]').click()]);
  const url = page.url(), slug = url.match(/\/w\/([a-z][a-z0-9-]*)/)[1], base = `${origin}${BASE}/w/${slug}`;
  await page.locator('[data-god-panel]').waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => window.__soulsEntity?.layer?.active === true && window.__soulsCamera, null, { timeout: 120_000 });
  await sleep(4000);
  const panel = await page.locator('[data-god-panel]').innerText();
  const signinButtons = await page.locator('[data-signin], [data-join-signin]').count();
  const step = async (n) => page.locator(`[data-step="${n}"]`).getAttribute('data-done').catch(() => null);
  const steps = (await page.locator('[data-checklist] li').allInnerTexts().catch(() => [])).slice(0, 2);
  const you = await page.evaluate(async (b) => { const t = await window.Clerk.session.getToken(); const r = await fetch(b + '/v1/god/status', { headers: { authorization: 'Bearer ' + t } }); return (await r.json()).you; }, base);
  check('world page: Clerk mounted and the homepage session is seen (checklist: signed in + claimed; owner; no Sign in button)', steps[0]?.startsWith('✓') && /Sign in/.test(steps[0]) && steps[1]?.startsWith('✓') && signinButtons === 0 && you === 'owner' && /Sign out/.test(await page.locator('body').innerText()),
    { url, signinButtons, steps, you, clerkMounted: await page.evaluate(() => window.Clerk.loaded) });
  const st = await page.evaluate(async ([b, o, base0, sl]) => {
    const w = (await (await fetch(`${o}${base0}/__sim/worlds.json`)).json()).worlds.find((x) => x.slug === sl);
    const mad = await (await fetch(b + '/v1/world/entities/madmaraca')).json();
    const c = document.querySelector('canvas');
    return { entities: w?.entities, template: w?.template, madmaraca: mad?.entity?.def, dpr: window.devicePixelRatio, canvas: c && { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } };
  }, [base, origin, BASE, slug]);
  check('the new world is the Arium world (the template\'s 432 things; Madmaraca is the library def core/lm-madmaraca@1); canvas drawn at the pixel ratio', st.entities >= 432 && st.template === TEMPLATE && /lm-madmaraca/.test(st.madmaraca ?? '') && st.dpr === DPR && Math.abs(st.canvas.w - st.canvas.cssW * DPR) <= 2, st);
  await shot('03-world-signed-in');
  // 3. camera with real input
  const cam = () => page.evaluate(() => { const c = window.__soulsCamera; return { p: c.p, t: c.pivot, d: +Math.hypot(c.p[0] - c.pivot[0], c.p[1] - c.pivot[1], c.p[2] - c.pivot[2]).toFixed(2) }; });
  const moved = (a, b) => +Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]).toFixed(2);
  const cx = 450, cy = 520; let a = await cam();
  // a 270 m world is framed whole at entity-arrival's ARRIVAL_MAX (110 m), by design (lane X); never the old 320 m limit
  check('camera arrives framing the world (≤ 110 m, not at the 320 m limit)', a.d <= 110.5, a);
  await page.keyboard.down('w'); await sleep(1000); await page.keyboard.up('w'); await sleep(300); let b = await cam();
  check('W (no click first) moves the camera forward', moved(a, b) > 2, { moved: moved(a, b), a: a.p, b: b.p });
  await page.mouse.click(cx, cy); a = await cam(); await page.keyboard.down('a'); await sleep(800); await page.keyboard.up('a'); await sleep(300); b = await cam();
  check('A after a click on the world strafes', moved(a, b) > 1.5, { moved: moved(a, b) });
  a = await cam(); await page.mouse.dblclick(560, 600); await sleep(1600); b = await cam();
  check('double-click flies to the ground under the pointer', moved(a, b) > 2 && b.d <= 16.5, { moved: moved(a, b), pivot: b.t, d: b.d });
  a = await cam(); await page.mouse.move(cx, cy); for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -150); await sleep(80); } await sleep(800); b = await cam();
  check('wheel zooms in (distance shrinks)', b.d < a.d - 1, { from: a.d, to: b.d });
  a = await cam(); for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 150); await sleep(80); } await sleep(800); b = await cam();
  check('wheel zooms out (distance grows)', b.d > a.d + 1, { from: a.d, to: b.d });
  a = await cam(); const samples = []; await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx + i * 20, cy); await sleep(50); samples.push(await cam()); } await page.mouse.up();
  const pivotDrift = Math.max(...samples.map((s) => Math.hypot(s.t[0] - a.t[0], s.t[1] - a.t[1], s.t[2] - a.t[2])));
  const distSpread = Math.max(...samples.map((s) => s.d)) - Math.min(...samples.map((s) => s.d));
  check('orbit drag circles a fixed pivot at a constant distance', pivotDrift < 0.1 && distSpread < 0.1 && moved(a, samples.at(-1)) > 2, { pivotDrift: +pivotDrift.toFixed(3), distSpread: +distSpread.toFixed(3), d: a.d, moved: moved(a, samples.at(-1)) });
  await shot('04-after-camera');
  // typing in a panel input does not move the camera
  // 4. god pairing: the agent asks, the person approves in the panel (real click)
  const skill = await (await fetch(`${base}/SKILL.md`)).text();
  const sect = (t) => { const i = skill.indexOf(`\n## ${t}\n`); if (i < 0) return ''; const rest = skill.slice(i + 1); const e = rest.slice(3).search(/\n(---|## )/); return e < 0 ? rest : rest.slice(0, e + 3); };
  const lineOf = (text, re) => text.split('\n').find((l) => re.test(l)) ?? null, bare = (l) => l.replace(/\s+#.*$/, '');
  const godDir = mkdtempSync(join(tmpdir(), 'fixx-god-'));
  await sh(godDir, bare(lineOf(sect('God mode'), /^test -f eden-god\.mjs \|\| curl /)));
  await exec(process.execPath, ['eden-god.mjs', 'register', base], { cwd: godDir });
  pairing = spawn(process.execPath, ['eden-god.mjs', 'pair'], { cwd: godDir, stdio: ['ignore', 'pipe', 'pipe'] });
  let pairOut = ''; pairing.stdout.on('data', (d) => { pairOut += d; });
  const pairExit = new Promise((r) => pairing.once('exit', (c) => r(c)));
  await page.locator('[data-tab="start"]').click().catch(() => {});
  await page.locator('[data-approve]').first().waitFor({ timeout: 60_000 });
  await shot('05-pairing-code');
  await page.locator('[data-approve]').first().click();
  const pexit = await Promise.race([pairExit, sleep(40_000).then(() => 'timeout')]);
  const token = (() => { try { return JSON.parse(readFileSync(join(godDir, '.eden-god.json'), 'utf8')).token ?? ''; } catch { return ''; } })();
  check('god pairing: the code appears in the panel, Approve (click) pairs the agent', pexit === 0 && token.startsWith('god_'), { exit: pexit, out: pairOut.split('\n').slice(-2).join(' ').slice(0, 160) });
  const found = await exec(process.execPath, ['eden-god.mjs', 'defs', 'madmaraca'], { cwd: godDir }).then((r) => r.stdout, (e) => String(e.message));
  const built = await exec(process.execPath, ['eden-god.mjs', 'place', 'lm-verdelis', '--at', '-110,40', '--name', 'gods-verdelis'], { cwd: godDir }).then((r) => r.stdout.trim().split('\n')[0], (e) => String(e.message).slice(0, 200));
  check('the paired agent finds the Arium art in the library and places Verdelis by name (compositional)', /lm-madmaraca/.test(found) && /verdelis|placed|ok/i.test(built), { found: found.split('\n').slice(0, 2).join(' ').slice(0, 200), built });
  await sleep(2500); await shot('06-after-pair-build');
  // 5. Join as a Soul (same signed-in person): #join → name → line → the agent asks → approval link → Approve (click)
  await page.goto(`${base}/#join`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-join]').waitFor({ timeout: 120_000 });
  if (!(await page.locator('[data-join-form]').isVisible())) await page.locator('summary', { hasText: 'Live here yourself' }).click();  // the owner's own Soul sits behind this disclosure
  await page.locator('[data-join-form]').waitFor({ timeout: 30_000 });
  // typing W/A/S/D into a panel input types letters and leaves the camera alone
  await page.waitForFunction(() => !!window.__soulsCamera, null, { timeout: 60_000 });
  const before = await cam(); await page.locator('[data-soul-name]').click(); await page.keyboard.type('wasd', { delay: 120 }); await sleep(500);
  const after = await cam(), typed = await page.locator('[data-soul-name]').inputValue();
  check('typing w/a/s/d in a panel input types them and does not move the camera', typed === 'wasd' && moved(before, after) < 0.01, { typed, moved: moved(before, after) });
  await page.locator('[data-soul-name]').fill('Gene');
  await page.locator('[data-join-go]').click();
  const line = await page.locator('[data-join-prompt]').innerText();
  await shot('07-join-line');
  const soulDir = mkdtempSync(join(tmpdir(), 'fixx-soul-')), soul = sect('Soul mode');
  await sh(soulDir, bare(lineOf(soul, /^test -f eden-agent\.mjs \|\| curl /)));
  await sh(soulDir, bare(lineOf(soul, /^node eden-agent\.mjs register /)));
  const created = JSON.parse(await sh(soulDir, bare(lineOf(soul, /^node eden-agent\.mjs create-soul /)).replace('"<name>"', '"Gene"')));
  check('the Soul CLI asks for approval with a link on this /worlds world', created.approvalURL?.startsWith(`${base}/#approve/ap_`), { approvalURL: created.approvalURL });
  const waiting = sh(soulDir, bare(lineOf(soul, /^node eden-agent\.mjs approval wait/)), 300_000).then((s) => JSON.parse(s), (e) => ({ error: String(e.message).slice(0, 300) }));
  // the person opens the link their agent printed: a new tab (same browser, so the same Clerk session)
  const tab = await ctx.newPage(); tab.setDefaultTimeout(120_000); tab.on('pageerror', (e) => errors.push(e.message));
  await tab.goto(created.approvalURL, { waitUntil: 'domcontentloaded' });
  await tab.locator('[data-approve-agent]').waitFor({ timeout: 120_000 });
  await tab.screenshot({ path: join(out, '08-approval-card.png') });
  await tab.locator('[data-approve-agent]').click();
  const waited = await Promise.race([waiting, sleep(120_000).then(() => ({ error: 'timeout' }))]);
  const status = JSON.parse(await sh(soulDir, 'node eden-agent.mjs status'));
  check('Join as Soul: Approve (click) on the approval link connects the agent to a new Soul', waited.status === 'ready' && status.paired === true, { line: line.slice(0, 120), waited, soul: status.soul });
  await sleep(3000); await tab.screenshot({ path: join(out, '09-after-join.png') });
  check('no page errors', errors.length === 0, errors.slice(0, 3));
} catch (e) { check('walkthrough threw', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
  try { const pg = browser.contexts()[0].pages()[0]; await pg.screenshot({ path: join(out, 'fail.png') }); console.log('url', pg.url(), (await pg.evaluate(() => document.body.innerText)).slice(0, 600)); } catch { } }
finally {
  try { pairing?.kill(); } catch { }
  writeFileSync(join(out, 'walkthrough.json'), JSON.stringify(report, null, 2));
  await browser.close().catch(() => {}); release();
  console.log(`${failed ? '✖' : '✔'} ${report.length - failed}/${report.length} — ${out}`);
  process.exit(failed ? 1 : 0);
}
