#!/usr/bin/env node
// Lane HF (hotfix 2026-10-20, Gene): an agent's approval link (#approve/<id>) opened by the signed-in world god. The
// approval must be on screen and on top from the moment it appears until the person approves, refuses or closes it:
// nothing that loads later (Clerk settling, the owner's God Mode, the arrival card, the world) may hide or cover it.
// Before the fix it flashed while the page still saw an anonymous visitor, then vanished once the god's own status
// arrived (the god's approval card lived only inside the closed God modal).
//
// Clerk mode as production, no network, no keys: the launcher verifies a synthetic issuer (apps/server/test/clerk-fixture.ts)
// and the browser runs a test-only stand-in for clerk-js (window.Clerk before the app loads, signed in as user_gene,
// loading asynchronously like the real one). The approval is a real pending request made with the agent's own call
// (POST /v1/agent/approval/start, what `eden-agent.mjs create-soul` sends). Chrome lease, real GPU. The fourth scenario
// closes the card and checks the request is still pending; the last (lane PUX, Gene 2026-10-20c: the link path older
// agents still print shows the same top-right card) presses Approve: "Ana is being prepared by your agent. Please wait…"
// with a spinner, the card closes once the body is ready, and the camera follows Ana.
//
//   node tools/god-skill/e2e/approve-on-top.mjs --web <vite build --base /worlds/> [--mars-web <dir>] [--port 6650]
//        [--range 6651-6655] [--out <dir>]
// Exit 0 = every scenario passed. Writes <out>/report.json and PNGs.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../lib/chrome-lease.mjs');
const { chromium } = createRequire(`${root}/mars/viewer/package.json`)('@playwright/test');
const port = Number(args.port ?? 6650), range = typeof args.range === 'string' ? args.range : '6651-6655';
const origin = `http://127.0.0.1:${port}`, BASE = '/worlds';
const out = resolve(typeof args.out === 'string' ? args.out : `${root}/.lane/e2e-approve/${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });
if (typeof args.web !== 'string') { console.error('--web <vite build --base /worlds/> is required'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { origin, scenarios: [], failures: [] };

// ---------- the launcher in Clerk mode (synthetic issuer)
const { clerkKeys, ISSUER, PUBLISHABLE_KEY } = await import('../../../apps/server/test/clerk-fixture.ts');
const keys = await clerkKeys(origin);
const dir = mkdtempSync(join(tmpdir(), 'approve-clerk-'));
writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
writeFileSync(join(dir, 'clerk.env'), [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origin}`,
  `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${resolve(root, 'apps/server/test/clerk-jwks-preload.mjs')}`, ''].join('\n'));
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', join(out, 'data'), '--base', BASE,
  '--web', resolve(args.web), ...(typeof args['mars-web'] === 'string' ? ['--mars-web', resolve(args['mars-web'])] : []), '--auth-env', join(dir, 'clerk.env'), '--public-origin', origin],
{ cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
const stop = () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop); for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop(); process.exit(130); });

const token = (sub = 'user_gene') => keys.sign(sub);
async function call(url, { sub, body, method } = {}) {
  const r = await fetch(url, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(sub ? { authorization: `Bearer ${await token(sub)}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data };
}

// ---------- Clerk in the browser: the stand-in of tools/god-skill/e2e/fix-x-walkthrough.mjs, already signed in, and
// "loading" for a moment as the real clerk-js is (the page first renders as nobody, then the session arrives)
const STUB = `(() => {
  const KEY = 'stubClerk.user', listeners = new Set();
  const make = () => { const sub = window.Clerk && window.Clerk.loaded ? localStorage.getItem(KEY) : null;
    if (!sub) return { client: { sessions: [], signedInSessions: [], activeSessions: [], lastActiveSessionId: null }, session: null, user: null, organization: null };
    const user = { id: sub, firstName: 'Gene', primaryEmailAddress: { emailAddress: 'gene@example.test' }, emailAddresses: [], organizationMemberships: [] };
    const sid = 'sess_' + sub.replace(/[^A-Za-z0-9]/g, '');
    const session = { id: sid, status: 'active', user, actor: null, lastActiveToken: { jwt: { claims: { sub, sid, iss: 'https://clerk.example.test' } } }, factorVerificationAge: null,
      getToken: async () => window.__stubClerkMint(sub), checkAuthorization: () => true };
    return { client: { sessions: [session], signedInSessions: [session], activeSessions: [session], lastActiveSessionId: sid }, session, user, organization: null }; };
  let state = make();
  const emit = () => { state = make(); for (const l of listeners) l({ ...state }); };
  window.Clerk = { loaded: false, status: 'loading', version: 'stub', sdkMetadata: {}, instanceType: 'production', frontendApi: 'clerk.example.test', isSatellite: false,
    get client() { return state.client; }, get session() { return state.session; }, get user() { return state.user; }, get organization() { return null; },
    async load() { await new Promise((r) => setTimeout(r, 1200)); this.loaded = true; this.status = 'ready'; emit(); },
    addListener(l) { listeners.add(l); l({ ...state }); return () => listeners.delete(l); },
    on(event, handler) { if (event === 'status' && typeof handler === 'function') setTimeout(() => handler(this.status), 0); }, off() {}, __internal_getOption() {}, __internal_updateProps() {}, telemetry: { record() {} },
    openSignIn() {}, openSignUp() {}, closeSignIn() {}, async signOut() { localStorage.removeItem(KEY); emit(); },
    async setActive() {}, buildSignInUrl() { return location.href; }, buildSignUpUrl() { return location.href; }, redirectToSignIn() {} };
})();`;

/** One look at the page: is the approval there, visible, and the topmost thing at its centre? */
const probe = () => {
  const card = document.querySelector('[data-approval]');
  const godOpen = !!document.querySelector('[data-god-modal][open]');
  const loaded = window.__soulsEntity?.layer?.active === true && !document.querySelector('.viewer-arrival:not([data-done="true"])');
  if (!card) return { present: false, godOpen, loaded };
  const r = card.getBoundingClientRect(), cs = getComputedStyle(card);
  const visible = r.width > 20 && r.height > 20 && cs.visibility !== 'hidden' && +cs.opacity > 0.5 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const pts = [[r.left + r.width / 2, r.top + Math.min(r.height / 2, 40)], [r.left + 12, r.top + 12], [r.right - 12, r.top + 12]];
  const onTop = visible && pts.every(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && card.contains(e); });
  return { present: true, visible, onTop, godOpen, loaded, status: card.getAttribute('data-approval-status') || '', box: [r.left, r.top, r.width, r.height].map(Math.round), rightGap: Math.round(innerWidth - r.right), vw: innerWidth };
};

async function scenario(browser, { name, viewport, dpr, mobile, introSeen, dismiss, approve }, base, slug, id) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.exposeFunction('__stubClerkMint', (sub) => keys.sign(sub));
  await ctx.addInitScript(({ slug, introSeen }) => { try { localStorage.setItem('stubClerk.user', 'user_gene'); if (introSeen) localStorage.setItem(`sim.godIntro:${slug}`, '1'); } catch { /* storage off */ } }, { slug, introSeen });
  await ctx.addInitScript(STUB);
  await ctx.route(/clerk\.example\.test/, (r) => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  const t0 = Date.now(), samples = []; let firstAt = null, loadedAt = null, firstShot = false;
  // the link exactly as the server handed it to the agent (lane AU: never rebuilt here, so a lost /worlds/w/<slug> base fails)
  await page.goto(report.approvalURL, { waitUntil: 'commit' });
  // watch the whole load: every 300 ms until the world has drawn and the arrival card has gone, then 10 s more (cap 75 s)
  while (Date.now() - t0 < 75_000) {
    const s = await page.evaluate(probe).catch(() => ({ present: false, error: true })); s.t = Date.now() - t0; samples.push(s);
    if (s.present && firstAt === null) firstAt = s.t;
    if (s.present && !firstShot) { firstShot = true; await page.screenshot({ path: join(out, `${name}-1-first-seen.png`) }).catch(() => {}); }
    if (s.loaded && loadedAt === null) loadedAt = s.t;
    if (loadedAt !== null && s.t - loadedAt > 10_000) break;
    await sleep(300);
  }
  const end = await page.evaluate(probe);
  const owner = await page.locator('[data-god-open="owner"]').count();
  end.focus = await page.evaluate(() => document.activeElement?.matches('[data-approval-dialog]') ? 'dialog' : (document.activeElement?.tagName ?? '') + '.' + (document.activeElement?.className ?? ''));
  await page.screenshot({ path: join(out, `${name}-2-after-load.png`) });
  // after first appearing, was it ever gone or covered?
  const after = firstAt === null ? [] : samples.filter((s) => s.t >= firstAt);
  const lapses = after.filter((s) => !(s.present && s.onTop)).map((s) => ({ t: s.t, present: s.present, onTop: s.onTop, godOpen: s.godOpen }));
  const result = { name, viewport, dpr, mobile: !!mobile, introSeen: !!introSeen, firstAt, loadedAt, samples: samples.length, lapses: lapses.length, firstLapses: lapses.slice(0, 5), end, owner, godOpenedDuring: samples.some((s) => s.godOpen), errors };
  result.ok = firstAt !== null && lapses.length === 0 && end.present && end.onTop && end.status === 'pending' && owner > 0 && !/^BUTTON/.test(end.focus) && loadedAt !== null;
  if (dismiss && result.ok) {
    await page.locator('[data-approval-close]').click();
    await sleep(3000);
    const gone = await page.locator('[data-approval]').count();
    const server = await call(`${base}/v1/account/approvals/${id}`, { sub: 'user_gene' });
    result.dismiss = { gone: gone === 0, stillPending: server.data?.approval?.status === 'pending', hash: await page.evaluate(() => location.hash) };
    await page.screenshot({ path: join(out, `${name}-3-closed.png`) });
    result.ok = result.dismiss.gone && result.dismiss.stillPending;
  }
  if (approve && result.ok) {
    const topRight = end.rightGap <= 40 && end.box[1] <= 170 && end.box[0] > end.vw / 2;
    await page.evaluate(() => { const seen = window.__apSeen = []; new MutationObserver(() => { const p = document.querySelector('[data-approval-preparing]'); if (p) { const sp = p.querySelector('.ap-spinner'); seen.push({ text: p.textContent, spinner: !!sp && sp.getBoundingClientRect().width > 0 && getComputedStyle(sp).animationName === 'ap-spin' }); } }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); });
    await page.locator('[data-approve-agent]').click();
    await page.waitForSelector('[data-approval-preparing]', { timeout: 5_000 }).then(() => page.screenshot({ path: join(out, `${name}-3-preparing.png`) }), () => {});
    const gone = await page.waitForSelector('[data-approval]', { state: 'detached', timeout: 90_000 }).then(() => true, () => false);
    const server = (await call(`${base}/v1/account/approvals/${id}`, { sub: 'user_gene' })).data?.approval;
    const following = await page.waitForFunction((sid) => document.querySelector('[data-camera="follow"]')?.getAttribute('data-follow-soul') === sid, server?.soulId, { timeout: 30_000, polling: 250 }).then(() => true, () => false);
    await sleep(1500); await page.screenshot({ path: join(out, `${name}-4-following.png`) });
    const seen = await page.evaluate(() => window.__apSeen);
    result.approve = { topRight, preparing: seen.some((x) => x.text === 'Ana is being prepared by your agent. Please wait…' && x.spinner), gone, status: server?.status, soulId: server?.soulId, following, hash: await page.evaluate(() => location.hash) };
    result.ok = topRight && result.approve.preparing && gone && server?.status === 'ready' && following && !/^#approve/.test(result.approve.hash);
  }
  await ctx.close();
  console.log(`${result.ok ? '✔' : '✖'} ${name}${result.approve ? ' ' + JSON.stringify(result.approve) : ''}: first seen ${firstAt} ms, world drawn ${loadedAt} ms, lapses ${lapses.length}/${after.length}, end ${JSON.stringify({ present: end.present, onTop: end.onTop, status: end.status, godOpen: end.godOpen })}, owner UI ${owner}${result.dismiss ? ', closed ' + JSON.stringify(result.dismiss) : ''}`);
  return result;
}

let release = null, browser = null;
try {
  for (let i = 0; i < 60; i++) { if ((await fetch(`${origin}${BASE}/__sim/worlds.json`).then((r) => r.ok, () => false))) break; await sleep(1000); }
  const made = await call(`${origin}${BASE}/__sim/worlds`, { sub: 'user_gene', body: { name: `Approve ${Date.now() % 100000}` } });
  const slug = made.data?.slug ?? made.data?.world?.slug ?? String(made.data?.url ?? '').match(/\/w\/([a-z][a-z0-9-]*)/)?.[1];
  if (made.status !== 201 || !slug) throw new Error(`create world: ${made.status} ${JSON.stringify(made.data).slice(0, 300)}`);
  const base = `${origin}${BASE}/w/${slug}`;
  for (let i = 0; i < 120; i++) { const s = await call(`${base}/v1/god/status`, { sub: 'user_gene' }).catch(() => null); if (s?.status === 200) { report.you = s.data.you; break; } await sleep(1000); }
  if (!['owner', 'god'].includes(report.you)) throw new Error(`gene is not this world's god: ${report.you}`);
  // the agent's own call (eden-agent.mjs create-soul): a real pending approval for whoever signs in and opens the link
  const start = await call(`${base}/v1/agent/approval/start`, { body: { agentLabel: 'approve-on-top e2e', name: 'Ana', idempotencyKey: randomBytes(16).toString('hex'), pollSecret: randomBytes(32).toString('base64url') } });
  const id = start.data?.approval?.id;
  if (start.status !== 200 || !/^ap_[a-f0-9]{32}$/.test(id ?? '')) throw new Error(`approval start: ${start.status} ${JSON.stringify(start.data).slice(0, 300)}`);
  report.world = base; report.approval = id; report.approvalURL = start.data.approvalURL;
  // lane AU (hotfix 2026-10-20): 3.57 handed <origin>/#approve/<id> (the site root's world) for a /worlds/w/<slug> world
  if (report.approvalURL !== `${base}/#approve/${id}`) throw new Error(`approvalURL lost the world's base: ${report.approvalURL} (want ${base}/#approve/${id})`);
  release = await chromeLease('approve-on-top');
  browser = await chromium.launch({ channel: 'chrome', headless: !args.headed, args: ['--ignore-gpu-blocklist'] });
  const desk = { width: 1352, height: 780 }, phone = { width: 390, height: 844 };
  for (const sc of [
    { name: 'desktop-dpr1-returning-god', viewport: desk, dpr: 1, introSeen: true },
    { name: 'desktop-dpr2-new-god-intro', viewport: desk, dpr: 2, introSeen: false },
    { name: 'phone-dpr3-returning-god', viewport: phone, dpr: 3, mobile: true, introSeen: true },
    { name: 'desktop-dpr1-close', viewport: desk, dpr: 1, introSeen: true, dismiss: true },
    { name: 'desktop-dpr1-link-approve', viewport: desk, dpr: 1, introSeen: true, approve: true },
  ]) {
    const r = await scenario(browser, sc, base, slug, id); report.scenarios.push(r);
    if (!r.ok) report.failures.push(r.name);
  }
} catch (e) {
  report.failures.push('harness: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
  console.log('harness error', e);
} finally {
  if (browser) await browser.close().catch(() => {});
  release?.();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(out, 'launcher.log'), launcherLog);
  console.log(`\n${report.failures.length ? '✖ ' + report.failures.join(', ') : '✔ all scenarios'} — ${join(out, 'report.json')}`);
  stop();
  process.exit(report.failures.length ? 1 : 0);
}
