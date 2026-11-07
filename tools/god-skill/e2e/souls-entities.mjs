#!/usr/bin/env node
// Souls among god-built things (lane L9; spec eden4/31 B2/B3, plan 33 §9 "e2e plays both parts").
// One scenario, two players over HTTP: the harness is the GOD (god token) and a SOUL (created and paired through
// the normal owner flow, acting through /v1/edge/*). The god builds a two-floor house with a chair upstairs and a
// bowl on a table; the Soul enters, climbs, sits; the god's attempt to remove the chair is refused naming the Soul;
// the Soul picks up the bowl (the journal shows the engine's move), puts it back; prays; the god answers; a closed
// door blocks the way in. Screenshots of the Soul inside with the roof hidden.
//
//   node tools/god-skill/e2e/souls-entities.mjs [--port 5172] [--keep]
//
// Starts its own server process on a fresh DATA_DIR (fake minds, DEV_AUTH). Report under .lane/e2e/souls-<stamp>/.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'souls-house';
const port = Number(args.port ?? 5172);
const out = resolve(root, '.lane/e2e', `souls-${stamp}`);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const t = () => performance.now();

// ---------- the world process (boot can be slow on a loaded machine: wait up to 5 minutes)
log(`▶ world "${slug}" on :${port}`);
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
let server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
const stop = () => { try { server.kill(); } catch { } };
async function restart() {
  const gone = new Promise((r) => server.once('exit', r)); server.kill('SIGTERM'); await gone;
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return true; } catch { } await wait(100); }
  return false;
}
process.on('exit', () => { if (!args.keep) stop(); });
const bootT = t();
let up = false;
for (let i = 0; i < 3000 && !up; i++) { try { up = (await fetch(`${base}/healthz`)).ok; } catch { } if (!up) await new Promise((r) => setTimeout(r, 100)); }
if (!up) { log('world did not come up'); writeFileSync(resolve(out, 'server.log'), serverLog); process.exit(1); }
log(`  booted in ${(t() - bootT).toFixed(0)} ms`);

// ---------- clients: god, owner (dev identity), Soul (its paired token)
let godToken = '', soulToken = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (as === 'soul') headers.authorization = `Bearer ${soulToken}`;
  else if (as && as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = summarize(result);
  report.steps.push({ name, ms: +ms.toFixed(1), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 400)}`);
  return result;
}
const summarize = (r) => { try { const s = JSON.stringify(r); return s && s.length > 1500 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 12 ? `[${v.length} items]` : v))) : r; } catch { return String(r); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 120000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await wait(every); } return last; }
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
// G1 "god rules": a dry run names who an edit would walk out; nothing moves.
const dryrun = (ops) => api('/v1/god/dryrun', { body: { ops } });
const wouldMove = (r, who) => r.data?.accepted === true && (r.data.wouldMove ?? []).some((m) => new RegExp(who).test(m.name));
const entity = async (path) => (await api(`/v1/world/entities/${path}`, { as: 'none' })).data;
const observe = async () => (await api('/v1/edge/observe', { as: 'soul' })).data;

// ---------- screenshots (Chrome via the viewer's Playwright), roofs hidden to see inside
let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
let browser = null, page = null, releaseChrome = null;
const lease = async () => { if (releaseChrome) return; try { const lib = [resolve(root, 'tools/god-skill/lib/chrome-lease.mjs')].find((f) => existsSync(f)); const { chromeLease } = await import(lib); releaseChrome = await chromeLease('L9-entities'); } catch { releaseChrome = () => {}; } };
async function closeBrowser() { if (browser) await browser.close().catch(() => { }); browser = null; page = null; releaseChrome?.(); releaseChrome = null; }
async function shot(name, { eye, at, wait: ms = 5000, hideRoofs = true } = {}) {
  if (!chromium) return;
  try {
    // one Chrome at a time across lanes (MERGES.md), on the real GPU (no swiftshader); ?shot=1 = clean canvas
    if (!browser) { await lease(); browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] }); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); }); page = await ctx.newPage(); }
    const q = new URLSearchParams({ dev: '1', shot: '1', ...(hideRoofs ? { hideRoofs: '1' } : {}) }); if (eye) q.set('eye', eye.join(',')); if (at) q.set('at', at.join(','));
    const t0 = t();
    await page.goto(`${base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (window).__shotReady === true, null, { timeout: 180000 }).catch(() => log('  (no __shotReady; shooting anyway)'));
    await page.waitForTimeout(ms); // people arrive over the take stream
    const state = await page.evaluate(() => { const w = window.__soulsEntity; return w ? { active: w.layer.active, drawn: w.layer.drawn?.size ?? null } : null; });
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: 120000 });
    report.shots.push({ name, file, state, ms: +(t() - t0).toFixed(0) });
    log(`  📷 ${name}.png ${JSON.stringify(state)}`);
  } catch (e) { log(`  (shot ${name} failed: ${String(e?.message ?? e).split('\n')[0]})`); }
}

const HOUSE = [10, 0];
const ids = {};
let soul = null;
try {
  // ================= GOD builds
  await step('G0 the owner mints a god token', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e god' } }); godToken = r.data.token; return r; }, (r) => r.status === 200 && !!godToken);
  // building/1 with its own rooms and stairs (L2) is furnished in its bedrooms; the lead's stub gets a flight
  await step('G1 the god builds a two-floor house with a door', () => act([
    { op: 'define', def: { schema: 'def/1', name: 'house2', version: 1, description: 'A two-floor house.', tags: ['building'], size: { box: [8, 6, 6] }, make: { kind: 'gen', gen: 'building/1' }, params: { floors: { type: 'int', min: 1, max: 6, default: 2 }, wall: { type: 'color', default: '#e9dcc3' } }, state: { doors: { type: 'json', default: {} } }, components: { foundation: { kind: 'none' } } } },
    { op: 'place', def: 'house2@1', name: 'house', p: HOUSE },
  ], 'two-floor house'), (r) => r.data?.accepted === true);
  const ownStairs = ((await api('/v1/god/query', { body: { entity: 'house' } })).data.entity?.links ?? []).length > 0;
  const at = ownStairs ? { chair: [-2, 0, 1], table: [2, 0, 1] } : { chair: [-2, 0, -1], table: [0, 0, -1.6] };
  await step(`G1 the god furnishes it: ${ownStairs ? 'its own stairs' : 'a flight of stairs'}, a chair upstairs, a table with a bowl`, () => act([
    ...(ownStairs ? [] : [
    { op: 'define', def: { schema: 'def/1', name: 'flight', version: 1, description: 'A straight flight of stairs.', tags: ['stairs'], size: { box: [1.1, 2.8, 3.2] }, make: { kind: 'gen', gen: 'stairs/1' }, params: { rise: { type: 'number', default: 2.8 }, run: { type: 'number', default: 3.2 }, width: { type: 'number', default: 1.1 } } } },
    { op: 'place', def: 'flight@1', name: 'stairs', in: { parent: 'house', slot: 'ground' }, p: [2.9, 0, 0] }]),
    { op: 'place', def: 'core/chair@1', name: 'chair', in: { parent: 'house', slot: 'floor-1' }, p: at.chair, r: 0 },
    { op: 'place', tmp: '$t', def: 'core/table@1', name: 'table', in: { parent: 'house', slot: 'floor-1' }, p: at.table },
    { op: 'place', def: 'core/bowl@1', name: 'bowl', in: { parent: '$t', slot: 'top' } },
    { op: 'place', def: 'core/bench@1', name: 'garden-bench', p: [4, 7], r: 3.14 },
  ], 'furnish the house'), (r) => r.data?.accepted === true);
  for (const p of ['house', 'house/stairs', 'house/chair', 'house/table', 'house/table/bowl']) ids[p] = (await entity(p)).entity?.id;
  await step('G2 reach: the lawn reaches the upper floor through the door and up the stairs', () => until(async () => { const r = (await api('/v1/god/query', { body: { reach: { from: [10, 9], to: 'house:floor-1' } } })).data.reach; return { ok: r?.reachable === true && r.levels?.includes(1), r }; }, 60000), (r) => r?.ok);

  // ================= a SOUL is born through the owner flow and paired
  await step('S0 an owner is invited and creates a Soul "Ana"', async () => {
    const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
    const ok = await api('/v1/invite', { as: 'ana', body: { code: inv.data.code } });
    const s = await api('/v1/souls', { as: 'ana', body: { name: 'Ana', description: 'a curious visitor who likes high windows' } });
    soul = s.data.soul; return { inv: inv.status, ok: ok.status, soul };
  }, (r) => r.soul?.id && r.soul?.entityId);
  await step('S0 the owner pairs an agent; the agent exchanges the code for a Soul token', async () => {
    const c = await api(`/v1/souls/${soul.id}/pair`, { as: 'ana', body: {} });
    const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'e2e soul agent' } });
    soulToken = x.data.token; return { code: !!c.data.code, token: !!soulToken };
  }, (r) => r.token);
  await step('S0 birth created the Soul\'s body entity with the engine\'s id', () => until(async () => { const e = await entity(soul.entityId); return { ok: e?.entity?.id === soul.entityId, def: e?.entity?.def, path: e?.path }; }, 30000), (r) => r?.ok);
  await step('S1 the Soul\'s capabilities name the god\'s chair, bowl and prayer', () => until(async () => { const c = (await api('/v1/edge/capabilities', { as: 'soul' })).data.capabilities ?? []; const want = [`sit:${ids['house/chair']}`, `pick-up:${ids['house/table/bowl']}`, 'pray']; return { ok: want.every((w) => c.some((x) => x.id === w)), ids: c.filter((x) => want.includes(x.id)).map((x) => `${x.id} — ${x.label}`) }; }, 30000), (r) => r?.ok);

  // ================= the Soul enters, climbs, sits
  await step('S2 the Soul sits on the god\'s chair upstairs (through the door, up the stairs)', async () => {
    const r = await api('/v1/edge/act', { as: 'soul', body: { capability: `sit:${ids['house/chair']}`, params: { seconds: 600 } } });
    if (r.data.accepted !== true) return { r: r.data };
    return until(async () => { const o = await observe(); const me = o?.self ?? o?.body ?? o; const s = JSON.stringify(o ?? {}); return { ok: /"activity":"sit"/.test(s) || /\bsit\b/.test(String(me?.activity ?? '')), receipt: r.data.receipt?.id, self: me && { activity: me.activity, level: me.level, at: me.at ?? me.pose } }; }, 180000, 1000);
  }, (r) => r?.ok);
  await shot('s2-seated-upstairs', { eye: [5, 13, 8], at: [9, 2.8, -1], wait: 10000 });
  await closeBrowser();
  await step('G3 a dry run of removing the chair names the Soul it would walk out (never refused)', () => dryrun([{ op: 'remove', id: 'house/chair' }]), (r) => wouldMove(r, 'Ana'));
  await step('G3 a dry run of removing the whole house names the Soul too', () => dryrun([{ op: 'remove', id: 'house' }]), (r) => wouldMove(r, 'Ana'));

  // ================= the Soul picks up the bowl and puts it back
  await step('S3 the Soul picks up the god\'s bowl; the entity world shows it in her hands', async () => {
    const r = await api('/v1/edge/act', { as: 'soul', body: { capability: `pick-up:${ids['house/table/bowl']}` } });
    if (r.data.accepted !== true) return { r: r.data };
    return until(async () => { const e = await entity(ids['house/table/bowl']); return { ok: e?.entity?.in?.parent === soul.entityId, in: e?.entity?.in }; }, 180000, 1000);
  }, (r) => r?.ok);
  await shot('s3-holding-bowl', { eye: [5, 13, 8], at: [10, 2.8, -1], wait: 10000 });
  await closeBrowser();
  await step('G4 the journal shows the engine\'s move (not undoable by the god)', async () => { const e = (await api('/v1/god/edits?limit=20')).data.edits; const m = e.find((x) => x.by === 'engine' && x.ops.some((o) => o.op === 'move' && o.id === ids['house/table/bowl'])); return { found: !!m, note: m?.note, undone: m?.undone, kind: m?.kind }; }, (r) => r.found && (r.kind === 'engine' || r.undone === 1));
  await step('G4 a dry run of taking the bowl away names the Soul holding it; the god cannot put things into her hands', async () => ({ dry: await dryrun([{ op: 'remove', id: ids['house/table/bowl'] }]), hands: await act([{ op: 'place', def: 'core/bowl@1', name: 'gift', in: { parent: soul.entityId, slot: 'carry' } }]) }), (r) => wouldMove(r.dry, 'Ana') && r.hands.data?.accepted === false && r.hands.data.failures?.[0]?.code === 'body.protected');
  await step('S4 the Soul puts the bowl on the table', async () => {
    const r = await api('/v1/edge/act', { as: 'soul', body: { capability: `put-on:${ids['house/table']}` } });
    if (r.data.accepted !== true) return { r: r.data };
    return until(async () => { const e = await entity(ids['house/table/bowl']); return { ok: e?.entity?.in?.parent === ids['house/table'], in: e?.entity?.in }; }, 120000, 1000);
  }, (r) => r?.ok);

  // ================= prayer and answer
  let prayerId = null;
  await step('S5 the Soul prays (a capability like any other)', async () => { const r = await api('/v1/edge/act', { as: 'soul', body: { capability: 'pray', params: { text: 'May this house have a garden by the door?' } } }); prayerId = r.data.result?.prayer; return r.data; }, (r) => r.accepted === true && !!prayerId);
  await step('G5 the prayer reaches the god; the god answers', async () => { const p = (await api('/v1/god/prayers')).data.prayers; const mine = p.find((x) => x.id === prayerId); const a = await act([{ op: 'answer', prayer: prayerId, text: 'Yes. Look south of the door tomorrow.' }]); return { seen: !!mine, from: mine?.soul_name, answered: a.data.accepted }; }, (r) => r.seen && r.from === 'Ana' && r.answered);
  await step('S5 the Soul reads the answer', async () => { const p = (await api('/v1/god/prayers/mine', { as: 'soul' })).data.prayers; return { answer: p.find((x) => x.id === prayerId)?.answer }; }, (r) => /garden|south/i.test(r.answer ?? '') || /Look south/.test(r.answer ?? ''));

  // ================= a closed door blocks the way in, opening it restores it
  await step('G6 the god closes the front door: the lawn can no longer reach inside', async () => { const a = await act([{ op: 'set', id: 'house', state: { doors: { 'front-door': 'closed' } } }]); const r = await until(async () => { const q = (await api('/v1/god/query', { body: { reach: { from: [10, 9], to: 'house:ground' } } })).data.reach; return { ok: q?.reachable === false, q }; }, 30000); return { a: a.data.accepted, r }; }, (r) => r.a && r.r?.ok);
  await step('G6 the god opens it again: reachable', async () => { const a = await act([{ op: 'set', id: 'house', state: { doors: { 'front-door': 'open' } } }]); const r = await until(async () => { const q = (await api('/v1/god/query', { body: { reach: { from: [10, 9], to: 'house:ground' } } })).data.reach; return { ok: q?.reachable === true, length: q?.length }; }, 30000); return { a: a.data.accepted, r }; }, (r) => r.a && r.r?.ok);
  await step('S6 the Soul sits again; the god moves the chair: she is walked out politely and told why', async () => {
    const r = await api('/v1/edge/act', { as: 'soul', body: { capability: `sit:${ids['house/chair']}`, params: { seconds: 600 } } });
    const s = await until(async () => { const o = JSON.stringify(await observe()); return { ok: /"activity":"sit"/.test(o) }; }, 120000, 1000);
    const g = await act([{ op: 'move', id: 'house/chair', p: [-1, 0, 0] }]);
    const told = await until(async () => { const o = await observe(); return { ok: (o?.notices ?? []).some((n) => n.kind === 'god-change' && /chair/.test(n.text)) }; }, 30000, 1000);
    return { accepted: r.data.accepted, seated: s?.ok, moved: (g.data.moved ?? []).map((m) => `${m.name} ${m.how}`), told: told?.ok };
  }, (r) => r.accepted && r.seated && r.moved.some((m) => /^Ana (walked|relocated)$/.test(m)) && r.told);
  await step('S7 restart the world process: Ana, her seat, the god\'s things and the house physics survive', async () => {
    const up2 = await restart(); if (!up2) return { up2 };
    const body = await entity(soul.entityId), bowl = await entity(ids['house/table/bowl']);
    const reach = await until(async () => { const q = (await api('/v1/god/query', { body: { reach: { from: [10, 9], to: 'house:floor-1' } } })).data.reach; return { ok: q?.reachable === true, q }; }, 60000);
    const o = await until(async () => { const x = await observe(); return { ok: !!x?.self, activity: x?.self?.activity, at: x?.self?.position }; }, 60000);
    const refused = await act([{ op: 'remove', id: soul.entityId }]);
    return { up2, body: body?.entity?.id === soul.entityId, bowlOnTable: bowl?.entity?.in?.parent === ids['house/table'], reach: reach?.ok, activity: o?.activity, at: o?.at, refused: refused.data.failures?.[0]?.code };
  }, (r) => r.up2 && r.body && r.bowlOnTable && r.reach && r.refused === 'body.protected');
  await shot('s6-inside-roof-hidden', { eye: [10, 16, 7], at: [10, 2.5, -0.5], wait: 10000 });
  await shot('s6-house-outside', { eye: [24, 9, 20], at: [10, 2, 0], wait: 4000, hideRoofs: false });
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  await closeBrowser();
  const ms = report.steps.map((s) => s.ms).sort((a, b) => a - b);
  report.summary = { steps: report.steps.length, failed: report.failures.length, p50: ms.length ? ms[Math.floor(ms.length / 2)] : null, max: ms.length ? ms[ms.length - 1] : null };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# souls among god-built things — ${slug} — ${report.startedAt}`, '', `${report.summary.steps} steps · ${report.summary.failed} failed · step p50 ${report.summary.p50} ms`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 200).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
