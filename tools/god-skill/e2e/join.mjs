#!/usr/bin/env node
// Join as a Soul, end to end, on a launcher world (lane P2, GENE-DECISIONS §3 "any Soul can join any world").
//
// --mode clerk (default; the production path, proven with a synthetic Clerk issuer, no network, no keys):
//   the launcher runs every world on Clerk with edge minds, no invitations and native Soul arrivals, serving ONE skill
//   (/SKILL.md: God mode + Soul mode) and the PUBLISHED Soul CLI and skill as is (--soul-cli/--soul-skill);
//   gaia makes the world (god at birth); her agent installs the god CLI as God mode says, pairs, gaia approves, it builds;
//   ana's agent follows Soul mode with the published CLI: register → create-soul → an approval link → ana (signed in)
//   approves it → approval wait → connected; it walks to the plaza, sits on the god's bench, prays; the god answers;
//   ana's agent reads the answer. Isolation: ben cannot approve ana's request; dev tokens are nobody; no direct births.
// --mode dev: the same world flow on dev sign-in (the agent makes its own Soul), plus the panel in Chrome
//   (Chrome lease, real GPU): a stranger's Join section, ben's line for his agent, his agent joins, the god's Souls tab.
//
//   node tools/god-skill/e2e/join.mjs [--mode clerk|dev] [--base /worlds] [--port 5225] [--range 5226-5229] [--keep] [--no-shots]
//        [--soul-cli <eden-agent.mjs>] [--soul-skill <SKILL.md>]   (default: the launcher's pinned copies, tools/world-launcher/soul/)
//   Soul mode installs the current Soul CLI, eden.mjs (2.x, served by every launcher world); the retained legacy
//   eden-agent.mjs (--soul-cli) is still served at /eden-agent.mjs for existing folders and checked byte for byte (#976).
//
// Report under .lane/e2e-join/<stamp>-<mode>/ (report.json, REPORT.md, PNGs). $0: edge minds, fake brain.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const MODE = args.mode === 'dev' ? 'dev' : 'clerk';
const SOUL_DIR = fileURLToPath(new URL('../../world-launcher/soul/', import.meta.url));
const SOUL_CLI = resolve(typeof args['soul-cli'] === 'string' ? args['soul-cli'] : `${SOUL_DIR}eden-agent.mjs`);
const SOUL_CONTROLLER = `${SOUL_DIR}eden.mjs`;   // the launcher always serves its pinned eden.mjs (launcher.mjs SOUL.controllerCli)
const SOUL_SKILL = resolve(typeof args['soul-skill'] === 'string' ? args['soul-skill'] : `${SOUL_DIR}skill.md`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const port = Number(args.port ?? 5225);
const range = typeof args.range === 'string' ? args.range : '5226-5229';
const out = resolve(root, '.lane/e2e-join', `${stamp}-${MODE}${typeof args.base === 'string' ? '-base' : ''}`);
mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`;
/** The launcher's path prefix (production: /worlds). */
const BASE = typeof args.base === 'string' ? args.base.replace(/\/+$/, '') : '';
const report = { mode: MODE, base: BASE, port, range, soulCli: SOUL_CLI, soulSkill: SOUL_SKILL, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = promisify(execFile);
const PAGE_MS = Number(args['page-ms'] ?? 600_000);

const brief = (r) => { try { return JSON.parse(JSON.stringify(r ?? null, (k, v) => (typeof v === 'string' && v.length > 400 ? v.slice(0, 400) + '…' : v))); } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e).split('\n').slice(0, 3).join(' | '); }
  const ms = t() - t0, ok = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ms: Math.round(ms), ok, result: brief(result), error });
  if (!ok) report.failures.push({ name, result: brief(result), error });
  console.log(`${ok ? '✔' : '✖'} ${name} — ${(ms / 1000).toFixed(1)} s${ok ? '' : ' — ' + (error ?? JSON.stringify(brief(result))).slice(0, 500)}`);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return result;
}
const until = async (what, fn, ms = 60_000, every = 500) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last?.ok ?? last) return last; } catch (e) { last = String(e.message); } await sleep(every); } throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 300)})`); };

// ---------- sign-in: Clerk (synthetic issuer, as tools/world-launcher/launcher-auth.test.mjs) or dev names
let sign = null; const launchArgs = [];
if (MODE === 'clerk') {
  const { clerkKeys, ISSUER, PUBLISHABLE_KEY } = await import('../../../apps/server/test/clerk-fixture.ts');
  const keys = await clerkKeys(origin); sign = keys.sign;
  const dir = mkdtempSync(join(tmpdir(), 'join-clerk-'));
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  writeFileSync(join(dir, 'clerk.env'), [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origin}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${resolve(root, 'apps/server/test/clerk-jwks-preload.mjs')}`, ''].join('\n'));
  launchArgs.push('--auth-env', join(dir, 'clerk.env'), '--public-origin', origin);
}
/** A person's bearer: a fresh Clerk session token (they expire in 60 s), or their dev name. */
const tokenOf = async (who) => (who ? (sign ? await sign(`user_${who}`) : `dev:${who}`) : null);

// ---------- the launcher (own process, own data dir)
const dataDir = resolve(out, 'data');
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', dataDir, '--eager', '0', '--soul-cli', SOUL_CLI, '--soul-skill', SOUL_SKILL, ...(BASE ? ['--base', BASE] : []), ...launchArgs], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
const cleanup = () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', () => { if (!args.keep) cleanup(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });

let slug = '', base = '';
async function api(path, { who, token, method, body } = {}) {
  const bearer = token ?? await tokenOf(who);
  const r = await fetch((path.startsWith('/__sim') ? origin + BASE : base) + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const folder = (who) => mkdtempSync(join(tmpdir(), `join-${who}-`));
const sh = (cwd, line, timeout = 120_000) => exec('bash', ['-c', line], { cwd, timeout, maxBuffer: 8 << 20 }).then((r) => r.stdout.trim(), (e) => { throw new Error(`${line.slice(0, 80)}… → ${String(e.stderr || e.message).trim().slice(0, 400)}`); });
const node = (cwd, file, ...a) => exec(process.execPath, [file, ...a], { cwd, timeout: 180_000, maxBuffer: 8 << 20 }).then((r) => r.stdout.trim(), (e) => { throw new Error(`${file} ${a.join(' ')} → ${String(e.stdout || '').slice(0, 300)} ${String(e.stderr || e.message).trim().slice(0, 300)}`); });
const soulCli = (cwd, ...a) => node(cwd, 'eden.mjs', ...a).then((s) => JSON.parse(s));
/** What a body is doing: eden.mjs passes the world's { kind } through; a plain string is taken as is. */
const doing = (me) => me?.activity?.kind ?? me?.activity;
const godCli = (cwd, ...a) => node(cwd, 'eden-god.mjs', ...a);

// ---------- the one skill: its sections and the commands they give
let skill = '';
/** The text of one `## <title>` section (up to the next `---` rule or `## `). */
const section = (title) => { const i = skill.indexOf(`\n## ${title}\n`); if (i < 0) return ''; const rest = skill.slice(i + 1); const end = rest.slice(3).search(/\n(---|## )/); return end < 0 ? rest : rest.slice(0, end + 3); };
const lineOf = (text, re) => text.split('\n').find((l) => re.test(l)) ?? null;
const bare = (l) => l.replace(/\s+#.*$/, '');

/** A person's agent follows Soul mode: install the CLI, register with this world, ask for the Soul; under Clerk the
 *  person approves the link it prints, then `approval wait`. Returns the folder and what each step said. */
async function soulAgentJoins(who, name) {
  const soul = section('Soul mode'), dir = folder(who), said = {};
  const install = lineOf(soul, /^test -f eden\.mjs \|\| curl /), register = lineOf(soul, /^node eden\.mjs register /), create = lineOf(soul, /^node eden\.mjs create /), wait = lineOf(soul, /^node eden\.mjs approval wait/);
  if (!install || !register || !create || !wait) throw new Error('Soul mode does not give install/register/create/approval wait');
  await sh(dir, bare(install));
  said.version = (await sh(dir, 'node eden.mjs help')).split('\n')[0];
  said.register = JSON.parse(await sh(dir, bare(register)));
  said.create = JSON.parse(await sh(dir, bare(create).replace('"<name>"', JSON.stringify(name))));
  if (said.create.approvalURL) {
    const id = said.create.approvalURL.match(/#approve\/(ap_[a-f0-9]{32})$/)?.[1];
    said.link = said.create.approvalURL;
    said.view = (await api(`/v1/account/approvals/${id}`, { who })).data.approval;
    said.approve = (await api(`/v1/account/approvals/${id}/approve`, { who, body: {} })).data.approval?.status;
    // the request is now bound to the approving account: anyone else is refused
    const other = await api(`/v1/account/approvals/${id}/approve`, { who: who === 'ben' ? 'ana' : 'ben', body: {} }), peek = await api(`/v1/account/approvals/${id}`, { who: who === 'ben' ? 'ana' : 'ben' });
    said.isolation = { otherApproves: other.status, otherReads: peek.status };
    said.wait = JSON.parse(await sh(dir, bare(wait), 300_000));
  }
  said.status = await soulCli(dir, 'status');
  return { dir, ...said };
}
/** act, then poll (bounded) until the receipt is terminal; returns the last receipt and the body. */
async function soulDoes(dir, capability, params, { maxS = 240, stop } = {}) {
  const a = await soulCli(dir, 'act', capability, ...(params ? [JSON.stringify(params)] : []));
  if (!a.accepted) return { accepted: false, code: a.code, reason: a.reason };
  const t0 = Date.now(); let rec = a.receipt, me = null;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await soulCli(dir, 'observe'); me = o.self ?? o.me;   // eden.mjs passes the world's observe through (self)
    if (stop?.(me)) break;
    const r = await soulCli(dir, 'receipt'); rec = r?.phase ? r : rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(1500);
  }
  return { accepted: true, phase: rec?.phase, code: rec?.code, me };
}

let chromium = null;
if (MODE === 'dev' && !args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { console.log('  (no @playwright/test; screenshots skipped)'); }

const ids = {};
let gaiaDir = '', ana = null;
try {
  await step('L0 the published Soul CLIs and skill are at hand (pinned copies)', async () => ({ cli: existsSync(SOUL_CLI), skill: existsSync(SOUL_SKILL), bytes: existsSync(SOUL_CLI) ? readFileSync(SOUL_CLI).length : 0 }), (r) => r.cli && r.skill);
  await until('the launcher', async () => (await fetch(`${origin}${BASE}/__sim/worlds.json`)).ok, 60_000);
  const worldName = `Join Party ${stamp.slice(11, 16).replace('-', '')}`;
  await step(`L1 gaia makes a new world (Empty plain)${MODE === 'clerk' ? ', signed in with Clerk: the god at birth' : ''}`, async () => {
    const r = await api('/__sim/worlds', { who: MODE === 'clerk' ? 'gaia' : null, body: { name: worldName, template: 'empty' } });
    slug = r.data.slug; base = `${origin}${r.data.world?.basePath ?? `${BASE}/w/${slug}`}`;
    if (MODE === 'dev') await api('/v1/god/mint', { who: 'gaia', body: { label: 'browser' } });
    return { status: r.status, slug, base, you: (await api('/v1/god/status', { who: 'gaia' })).data.you };
  }, (r) => r.slug && r.you === 'owner' && r.base === `${origin}${BASE}/w/${r.slug}`);
  await step('L2 launcher worlds: edge minds, no invitations, native arrivals; the published Soul CLI and skill served as is', async () => {
    const cfg = (await api('/v1/config')).data, edge = await api('/v1/edge/schema');
    const cli = await (await fetch(`${base}/eden-agent.mjs`)).text(), controller = await (await fetch(`${base}/eden.mjs`)).text(), soulSkill = await (await fetch(`${base}/skill.md`)).text(), instr = await (await fetch(`${base}/instructions.md`)).text();
    return { auth: cfg.authProvider, devAuth: cfg.devAuth, accountApproval: cfg.accountApproval?.contract ?? null, inviteRequired: cfg.inviteRequired, edge: edge.status, cliSame: cli === readFileSync(SOUL_CLI, 'utf8') && controller === readFileSync(SOUL_CONTROLLER, 'utf8'), skillVersion: soulSkill.match(/version: "([\d.]+)"/)?.[1],
      skillHere: !/\{\{/.test(soulSkill) && (soulSkill.includes(`This world is **${base}**`) || /^\s*version:\s*"2\./m.test(soulSkill)), instructions: instr.startsWith(`# Create a Soul in ${worldName}`) && instr.includes(`World: ${base}`) && !/\{\{/.test(instr) };
  }, (r) => r.inviteRequired === false && r.edge === 200 && r.cliSame && /^(1\.9(\.\d+)?|2\.\d+\.\d+)$/.test(r.skillVersion ?? '') && r.skillHere && r.instructions && (MODE === 'dev' ? r.devAuth === true : r.auth === 'clerk' && r.devAuth === false && r.accountApproval === 'account-soul-approval/1'));
  await step('K1 ONE skill at /SKILL.md: God mode and Soul mode, each alone; Soul mode points at this world\'s CLI copy and Soul skill', async () => {
    skill = await (await fetch(`${base}/SKILL.md`)).text();
    const god = section('God mode'), soul = section('Soul mode');
    const links = await Promise.all(['/god/SKILL.md', '/god/eden-god.mjs', '/skill.md', '/eden.mjs', '/eden-agent.mjs'].map(async (p) => [p, (await fetch(base + p)).status]));
    return { name: skill.includes(`"${worldName}"`), filled: !/\{\{/.test(skill), godInstall: !!lineOf(god, /eden-god\.mjs \|\| curl -fsSO .*\/god\/eden-god\.mjs/), soulInstall: lineOf(soul, /eden\.mjs \|\| curl/)?.includes(`${base}/eden.mjs`), soulSkill: soul.includes(`${base}/skill.md`), godAlone: !/eden-agent/.test(god), soulAlone: !/eden-god/.test(soul), links: Object.fromEntries(links) };
  }, (r) => r.name && r.filled && r.godInstall && r.soulInstall && r.soulSkill && r.godAlone && r.soulAlone && Object.values(r.links).every((s) => s === 200));

  // ======================== the god
  await step('G1 gaia\'s agent follows God mode: installs eden-god.mjs, registers, pairs; gaia approves the code in the panel', async () => {
    const god = section('God mode'); gaiaDir = folder('gaia');
    await sh(gaiaDir, bare(lineOf(god, /^test -f eden-god\.mjs \|\| curl /)));
    await godCli(gaiaDir, 'register', base);
    const pairing = spawn(process.execPath, ['eden-god.mjs', 'pair'], { cwd: gaiaDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const done = new Promise((r) => pairing.once('exit', (code) => r(code)));
    const pending = await until('the pairing request in the panel', async () => (await api('/v1/god/status', { who: 'gaia' })).data.pending?.[0], 30_000);
    const ok = await api('/v1/god/pair/approve', { who: 'gaia', body: { code: pending.code } });
    const exit = await Promise.race([done, sleep(30_000).then(() => 'timeout')]);
    return { approve: ok.status, exit, token: JSON.parse(readFileSync(join(gaiaDir, '.eden-god.json'), 'utf8')).token?.startsWith(`god_${slug}-1_`) };
  }, (r) => r.approve === 200 && r.exit === 0 && r.token);
  // G5: the CLI's flag verb is switched off; a flag placed through act stays a place Souls walk to (the page hides it)
  await step('G2 the god builds: a plaza flag, a bench facing it, a cottage, a garden flag', async () => {
    for (const a of [['act', JSON.stringify({ ops: [{ op: 'place', def: 'core/flag@1', name: 'plaza', p: [0, 12], state: { label: 'plaza' } }] })], ['place', 'bench', '--at', '3,12', '--name', 'bench', '--facing', 'w'], ['place', 'cottage', '--at', '-14,-8', '--name', 'cottage'], ['act', JSON.stringify({ ops: [{ op: 'place', def: 'core/flag@1', name: 'garden', p: [-10, 6], state: { label: 'garden' } }] })]]) await godCli(gaiaDir, ...a);
    const snap = (await api('/v1/world/snapshot')).data;
    for (const n of ['bench', 'cottage', 'plaza', 'garden']) ids[n] = snap.entities.find((e) => e.name === n)?.id;
    return { ids };
  }, (r) => Object.values(r.ids).every(Boolean));

  // ======================== ana joins: her agent follows Soul mode with the published CLI
  if (MODE === 'clerk') {
    await step('V0 no shortcuts: a direct POST /v1/souls is refused (approval required, as live); dev tokens are nobody', async () => {
      const direct = await api('/v1/souls', { who: 'ana', body: { name: 'Shortcut' } });
      const dev = await api('/v1/souls', { token: 'dev:ana', body: { name: 'Devvy' } }), devAgent = await api('/v1/me', { token: 'dev:agent-' + 'a'.repeat(24) });
      return { direct: direct.data.code, dev: dev.status, devAgent: devAgent.status, you: (await api('/v1/god/status', { who: 'ana' })).data.you };
    }, (r) => r.direct === 'approval-required' && r.dev === 401 && r.devAgent === 401 && r.you === 'visitor');
  }
  await step(`A0 ana's agent: install, register, create "Ana"${MODE === 'clerk' ? ' → an approval link → ana approves on the world page → approval wait → connected' : ' (a local world: no approval)'}`, async () => {
    ana = await soulAgentJoins('ana', 'Ana');
    return ana;
  }, (r) => r.status.paired === true && /^s_/.test(r.status.soul?.id ?? r.status.soul ?? '') && (MODE === 'dev' || (r.link?.startsWith(`${base}/#approve/ap_`) && r.view?.status === 'pending' && r.view?.mode === 'create' && ['creating', 'ready'].includes(r.approve) && r.wait?.status === 'ready' && r.isolation?.otherApproves === 403 && r.isolation?.otherReads === 403)));
  await step('A1 the Soul is ana\'s: /v1/me lists it for her (and not for ben); her capabilities offer the god\'s things', async () => {
    const mine = (await api('/v1/me', { who: MODE === 'clerk' ? 'ana' : null, token: MODE === 'dev' ? null : undefined })).data;
    const ben = MODE === 'clerk' ? (await api('/v1/me', { who: 'ben' })).data : null;
    const c = JSON.stringify(await soulCli(ana.dir, 'caps', '--all'));
    const want = ['walk:flag-plaza', 'walk:flag-garden', `sit:${ids.bench}`, '"pray"'];
    return { mine: MODE === 'clerk' ? mine.souls?.map((s) => s.name) : 'n/a (dev: the agent\'s own identity)', ben: ben?.souls?.length ?? null, missing: want.filter((w) => !c.includes(w)) };
  }, (r) => !r.missing.length && (MODE === 'dev' || (r.mine.includes('Ana') && r.ben === 0)));
  await step('A2 she walks to the plaza flag (act → completed receipt)', () => soulDoes(ana.dir, 'walk:flag-plaza'), (r) => r.accepted && r.phase === 'completed');
  await step('A3 she sits on the god\'s bench', () => soulDoes(ana.dir, `sit:${ids.bench}`, { seconds: 600 }, { stop: (me) => doing(me) === 'sit' }), (r) => r.accepted && doing(r.me) === 'sit');
  await step('A4 she prays', () => soulCli(ana.dir, 'act', 'pray', JSON.stringify({ text: 'May the plaza have a fountain?' })), (r) => r.accepted === true);
  await step('G3 the god reads the prayer (eden-god prayers) and answers it', async () => {
    const list = await godCli(gaiaDir, 'prayers');
    const id = (await api('/v1/god/prayers', { token: JSON.parse(readFileSync(join(gaiaDir, '.eden-god.json'), 'utf8')).token })).data.prayers?.find((p) => p.soul_name === 'Ana')?.id;
    const ans = await godCli(gaiaDir, 'answer', id, 'Yes: look to the plaza tomorrow.');
    return { listed: /Ana/.test(list) && /fountain/.test(list), id, answer: ans.split('\n')[0] };
  }, (r) => r.listed && r.id);
  await step('A5 her agent reads the answer with Soul mode\'s command (the token is never printed)', async () => {
    const line = lineOf(section('Soul mode'), /^node -e 'const s=JSON\.parse\(require\("fs"\)\.readFileSync\("\.eden-agent\.json"/);
    if (!line) throw new Error('Soul mode gives no command to read answers');
    const said = await sh(ana.dir, line), token = JSON.parse(readFileSync(join(ana.dir, '.eden-agent.json'), 'utf8')).token;
    return { said: JSON.parse(said), leaked: said.includes(token) };
  }, (r) => r.said.some((p) => /fountain/.test(p.text) && /plaza tomorrow/.test(p.answer ?? '')) && !r.leaked);
  await step('W0 who lives here: /v1/world/souls lists Ana, active, at the bench', async () => { const s = (await api('/v1/world/souls')).data.souls; return { n: s.length, ana: s.find((x) => x.name === 'Ana') }; }, (r) => r.ana?.active && r.ana.p && Math.hypot(r.ana.p[0] - 3, r.ana.p[2] - 12) < 3);

  // ======================== the panel in Chrome (dev sign-in: a browser cannot hold a synthetic Clerk session)
  if (chromium) {
    const release = await chromeLease('join-e2e');
    let browser = null;
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
      const shot = async (page, name) => { const file = join(out, `${name}.png`); await page.screenshot({ path: file, timeout: PAGE_MS }); report.shots.push(file); console.log(`  📷 ${name}.png`); };
      const open = async (who, hash = '') => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await ctx.addInitScript((n) => { try { if (n) localStorage.setItem('sim.dev', n); localStorage.setItem('sim.godPanel.open', '1'); } catch { } }, who);
        const page = await ctx.newPage(); page.setDefaultTimeout(PAGE_MS);
        page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
        await page.goto(`${base}/?dev=1${hash}`, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
        await page.locator('.hud-actions').waitFor({ timeout: PAGE_MS });
        await page.waitForFunction(() => window.__simEntity?.layer?.active === true, null, { timeout: PAGE_MS }).catch(() => {});
        await page.evaluate(() => { const w = window.__simEntity; if (!w) return; w.controls.target.set(-2, 1, 8); w.camera.position.set(-16, 11, 30); w.camera.lookAt(w.controls.target); }).catch(() => {});
        await sleep(3500);
        // #join also opens New Soul's copy-the-prompt dialog (e8's, on every world; lane UXFIX): note it, close it
        const dialog = page.locator('.bring-agent');
        page.newSoulDialog = await dialog.isVisible() ? (await dialog.innerText()).replace(/\s+/g, ' ') : null;
        if (page.newSoulDialog) { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); }
        return page;
      };
      // G4/G5: open the God Mode modal if it is not (God may open by itself a moment later: the button toggles, so check before each press); one view, no tabs
      const godOpen = async (page) => {
        for (let i = 0; i < 3 && !(await page.locator('[data-god-modal][open]').count()); i++) {
          await page.locator('[data-god-open]').click({ timeout: 2000 }).catch(() => {});
          await page.locator('[data-god-modal][open]').waitFor({ timeout: 2000 }).catch(() => {});
        }
        await page.locator('[data-god-modal] [data-section="agent"]').waitFor();
      };
      await step('P0 a stranger (not signed in) on #join gets e8\'s New Soul dialog and no god-panel card (lane UXFIX2)', async () => {
        const page = await open(null, '#join');
        await sleep(2500);
        const card = await page.locator('[data-god-panel]').count(), text = await page.locator('body').innerText();
        await shot(page, '01-anonymous-join'); await page.context().close();
        return { card, dialog: page.newSoulDialog, joinCard: /Join this world as a Soul|Souls here/.test(text) };
      }, (r) => r.card === 0 && !r.joinCard && r.dialog?.includes(`${base}/instructions.md`));
      let benLine = '';
      const benPage = await open('ben', '#join');
      await step('P1 ben, signed in, opens the shared #join link: New Soul\'s one line for his agent (no card, no form)', async () => {
        benLine = benPage.newSoulDialog ?? '';
        const card = await benPage.locator('[data-god-panel]').count();
        await shot(benPage, '02-ben-join');
        return { benLine, card };
      }, (r) => r.card === 0 && r.benLine.includes(`${base}/instructions.md`) && r.benLine.includes(worldName));
      await step('P2 ben\'s agent reads the instructions, follows Soul mode, and walks to the garden', async () => {
        const url = benLine.match(/(\S+\/instructions\.md)/)?.[1];
        if (url !== `${base}/instructions.md`) throw new Error('the line does not name this world\'s instructions');
        const instr = await (await fetch(url)).text();
        if (!instr.includes(`${base}/skill.md`)) throw new Error('the instructions do not point at this world\'s skill');
        skill = await (await fetch(`${base}/SKILL.md`)).text();
        const r = await soulAgentJoins('ben', 'Ben');
        const walk = await soulDoes(r.dir, 'walk:flag-garden');
        const souls = (await api('/v1/world/souls')).data.souls.map((x) => x.name);
        await shot(benPage, '04-ben-joined');
        return { paired: r.status.paired, walk: walk.phase, souls };
      }, (r) => r.paired && r.walk === 'completed' && r.souls.includes('Ben'));
      await benPage.context().close();
      await step('P3 the god sees both Souls in Explore (the Souls tab is gone, G5; the link to share is in the account menu); clicking Ana flies to her', async () => {
        const page = await open('gaia');
        const link = await page.locator('[data-join-link]').getAttribute('data-join-link', { timeout: 60_000 });  // the account menu's "Copy invite link" (lane UXFIX)
        await page.locator('button.explore-open:not(.god-open)').first().click();
        const explore = page.locator('[aria-labelledby="explore-souls"]');
        await explore.waitFor({ timeout: 60_000 });
        await page.waitForFunction(() => /Ben/.test(document.querySelector('[aria-labelledby="explore-souls"]')?.textContent ?? ''), null, { timeout: 30_000 });
        const text = await explore.innerText();
        await shot(page, '05-god-explore-souls');
        const errors = page.errors; await page.context().close();
        return { link, souls: ['Ana', 'Ben'].filter((n) => text.includes(n)), errors };
      }, (r) => r.link === `${base}/#join` && r.souls.includes('Ana') && r.souls.includes('Ben') && !r.errors.length);
      await step('P4 God Mode names the one skill: the Connect line copies "Read <SKILL.md> and follow its God mode section" and links the file', async () => {
        const page = await open('gaia');
        await godOpen(page);   // G4: the owner's God controls are one God modal (the God button right of Explore)
        await page.locator('[data-god-modal] [data-connect]').waitFor({ timeout: 60_000 });   // shown once the agent is away (its last call over 30 s ago)
        const href = await page.locator('[data-god-modal] [data-skill-link]').getAttribute('href');
        const line = await page.locator('[data-god-modal] [data-connect-line]').getAttribute('data-connect-line');
        const target = await page.locator('[data-god-modal] [data-skill-link]').getAttribute('target');
        await shot(page, '06-god-connect-one-skill'); await page.context().close();
        return { href, line, target };
      }, (r) => r.href === `${base}/SKILL.md` && r.target === '_blank' && r.line === `Read ${base}/SKILL.md and follow its God mode section to control this world.`);
      await step('P5 an approval link opens the approval card (signed out: it asks to sign in; the request stays pending)', async () => {
        const page = await open(null, '#approve/ap_' + '0'.repeat(32));
        await page.locator('[data-approval]').waitFor({ timeout: 60_000 });
        const text = await page.locator('[data-approval]').innerText();
        await shot(page, '07-approval-card-signed-out'); await page.context().close();
        return { text };
      }, (r) => /Sign in/.test(r.text));
    } finally { if (browser) await browser.close().catch(() => {}); release(); }
  }
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  console.log('harness error', e);
} finally {
  report.summary = { mode: MODE, steps: report.steps.length, failed: report.failures.length, slug };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'launcher.log'), launcherLog);
  const md = [`# Join as a Soul (lane P2, ${MODE}) — ${slug} — ${report.startedAt}`, '', `${report.summary.steps} steps · ${report.summary.failed} failed · Soul CLI ${SOUL_CLI}`, '', '| step | s | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${(s.ms / 1000).toFixed(1)} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((f) => `- \`${f}\``)].join('\n');
  writeFileSync(join(out, 'REPORT.md'), md);
  console.log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${join(out, 'REPORT.md')}`);
  if (!args.keep) cleanup();
  process.exit(report.summary.failed ? 1 : 0);
}
