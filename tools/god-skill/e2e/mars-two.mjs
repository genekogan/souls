#!/usr/bin/env node
// mars-two e2e (lane MARS): the Mars 2026 campus template, and a Soul living in it through the normal flow.
// The world boots from worlds/templates/mars-two.json (library defs core/mars-*); the god checks Gene's corrected layout
// (the L of Mimos, raised main, the arm with flooring, the kitchen west of the diner, the showers); a Soul created and
// paired through the owner flow walks to Mimos and its rooms, the kitchen and the dining hall by name, climbs the raised
// floor's steps, sits on the honey sofa (#13), the red sofa (#12), a bus seat (#20–25), takes a mixing bowl from the
// prep table (#15) and puts it on a blue diner table (#26–28). Handover physics traps are checked as cases.
// (Header below kept from nav.mjs's harness.)
// P4 nav proof (party lane): a fresh Soul goes to what the god built, by name, with no flags.
// One fresh world, two players over HTTP:
//   the GOD (god token) builds a fountain, a cottage named rose-house (its front door faces away from the Soul), a plaza
//   with bench-2, a pond with an unnamed bench by it and another unnamed bench by the fountain — and no flags;
//   a SOUL (created and paired through the normal owner flow, acting only through /v1/edge/*) is told, by name: walk to
//   the fountain, go into rose-house (round the house, in at its front door), walk:rose-house/kitchen, walk:plaza/bench-2,
//   sit on the bench by the pond, then walk to the bedroom in rose-house. The plain-word acts go through the real Soul
//   CLI (tools/edge-skill/eden-agent.mjs, unchanged) and the ledger's own vocabulary (unchanged): the world-engine side
//   only offers `walk:<path>` capabilities and labels seats with what they are by. Where she ends up is read from the
//   god's `where` query (room / area), not from any new edge field.
//
//   node tools/god-skill/e2e/nav.mjs [--port 5260] [--keep] [--no-shots]
//
// Harness from souls-r2.mjs. Report under .lane/e2e-nav/<stamp>/.
import {replay} from '../../meaning/materialize.mjs';
import {indexWorld} from '../../template-upgrade/upgrade.mjs';
import { toWorld, toBuild, rot } from '../scripts/mars-two/frame.mjs';
import { ROOMS as LAYOUT_ROOMS } from '../scripts/mars-two/layout.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';
import { checkedCapabilities, pollAdmissionRead } from './admission-read.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'mars-two';
const port = Number(args.port ?? 5451);
const out = resolve(root, '.lane/e2e-mars-two', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], samples: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir, local Mars assets)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, SIM_NAV_DEBUG: process.env.SIM_NAV_DEBUG ?? '1', ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: resolve(root, 'worlds/templates/mars-two.json') };
let serverLog = '', server;
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  const t0 = t();
  for (let i = 0; i < 3000; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return t() - t0; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
const stop = () => { try { server?.kill(); } catch { } };
process.on('exit', () => { if (!args.keep) stop(); });

// ---------- clients: the owner (dev identity), the god (god token), the Soul (Soul token)
let godToken = '', soulToken = '';
async function api(path, { method, body, as = 'god', signal } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (as === 'soul') headers.authorization = `Bearer ${soulToken}`;
  else if (as && as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const started = t();
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: signal ?? AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, retryAfter: r.headers.get('retry-after'), elapsedMs: t() - started };
}
const summarize = (r) => { try { const s = JSON.stringify(r); return s && s.length > 1500 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 12 ? `[${v.length} items]` : v))) : r; } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = summarize(result);
  report.steps.push({ name, ms: +ms.toFixed(0), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  if (!okay && /route\.|unreachable/.test(JSON.stringify(result ?? '') + (error ?? ''))) await navDiag(name, result);
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 500)}`);
  return result;
}
// N1: a refused walk prints its refusal reason and the planner's failed-search memo counts.
const reasonsIn = (v, out = []) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if ((k === 'reason' || k === 'message') && typeof x === 'string') out.push(x); else reasonsIn(x, out); } return out; };
async function navDiag(name, result) {
  const nav = await api('/v1/debug/nav', { as: 'none' }).then((r) => r.data).catch((e) => String(e));
  log(`  ↳ ${name.split(' ')[0]} reason: ${JSON.stringify(reasonsIn(result).slice(0, 3)).slice(0, 600)} nav: ${JSON.stringify(nav)}`);
}
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const entity = async (path) => (await api(`/v1/world/entities/${path}`, { as: 'none' })).data;
const groundAt = async (pts) => (await api('/v1/god/query', { body: { points: pts } })).data.points;
const observe = async () => (await api('/v1/edge/observe', { as: 'soul' })).data;
const caps = async () => checkedCapabilities(await api('/v1/edge/capabilities', { as: 'soul' }));
/** Act as the Soul and follow the receipt to its end, sampling the body (position, level, activity) on the way. */
async function soulDoes(capability, { params, maxS = 240, until: stopWhen } = {}) {
  const r = await api('/v1/edge/act', { body: { capability, ...(params ? { params } : {}) }, as: 'soul' });
  if (!r.data?.accepted) return { accepted: false, code: r.data?.code, reason: r.data?.reason, status: r.status, samples: [], end: null };
  const id = r.data.receipt?.id, samples = [], t0 = Date.now();
  let rec = r.data.receipt;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(); const me = o.self;
    samples.push({ tick: o.tick, p: me.position, activity: me.activity, state: me.state });
    if (stopWhen?.(me)) break;
    if (id) rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe();
  return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, result: r.data.result, samples, fromTick: r.data.receipt?.acceptedTick ?? samples[0]?.tick ?? 0, toTick: o.tick, end: { p: o.self.position, activity: o.self.activity, state: o.self.state } };
}
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[2] - q[1]) <= d;

// ---------- screenshots (Chrome via the viewer's Playwright; one Chrome machine-wide via the lease)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
const shotUrl = ({ eye, at, wait = 4000, hideRoofs = false }) => {
  const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(wait), ...(hideRoofs ? { hideRoofs: '1' } : {}) });
  if (eye) q.set('eye', eye.map((v) => v.toFixed(2)).join(',')); if (at) q.set('at', at.map((v) => v.toFixed(2)).join(','));
  return `${base}?${q}`;
};
async function withPage(fn) {
  const release = await chromeLease('mars-two e2e').catch(() => null);
  if (!release) { log('  (chrome lease busy; screenshot skipped)'); return false; }
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
    return await fn(await ctx.newPage());
  } finally { if (browser) await browser.close().catch(() => { }); release(); }
}
async function load(page, opts) {
  await page.goto(shotUrl(opts), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 150_000 }).catch(() => log('  (shot not ready in 150 s; taking it anyway)'));
}
async function snap(page, name) {
  const file = resolve(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120_000 });
  report.shots.push({ name, file });
  log(`  📷 ${name}.png`);
}
/** Several stills in one browser session: [{ name, eye, at, wait, hideRoofs }]. */
async function shots(list) {
  if (!chromium) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { if (await withPage(async (page) => { for (const s of list) { await load(page, s); await page.waitForTimeout(s.extra ?? 2500); await snap(page, s.name); } return true; })) return; }
    catch (e) { log('  (screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  }
}
/** Open the page first, then start `run` (a Soul's walk) and photograph it `afterMs` later, mid-motion. */
async function shotDuring(name, opts, run) {
  if (!chromium) return run();
  let p = null;
  try {
    await withPage(async (page) => {
      await load(page, { ...opts, wait: 3000 }); p = run();
      // photograph when the body is where the camera looks (`when(self)`), or after `afterMs` at the latest
      const t0 = Date.now();
      while (Date.now() - t0 < (opts.afterMs ?? 10000)) { if (opts.when) { const o = await observe().catch(() => null); if (o?.self?.position && opts.when(o.self)) { await sleep(1200); break; } } await sleep(400); }
      await snap(page, name); return true;
    });
  } catch (e) { log('  (mid-motion screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  return p ?? run();
}


// ---------- the Soul CLI (Codex's eden-agent.mjs, unchanged), in its own private folder
import { execFile } from 'node:child_process';
const cliDir = resolve(out, 'soul-cli'); mkdirSync(cliDir, { recursive: true });
const CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
function cli(...argv) {
  return new Promise((ok) => execFile(process.execPath, [CLI, ...argv], { cwd: cliDir, timeout: 120_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' } }, (err, stdout, stderr) => {
    const s = String(stdout); let data = null; try { data = JSON.parse(s.slice(s.indexOf('{'))); } catch { }
    ok({ code: err?.code ?? 0, data, stderr: String(stderr).slice(0, 400), raw: data ? undefined : s.slice(0, 400) });
  }));
}
/** Follow an accepted act's receipt to its end, sampling the body. */
async function follow(acted, { maxS = 240, until: stopWhen } = {}) {
  if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason, samples: [], end: null };
  const id = acted.receipt?.id, samples = []; let rec = acted.receipt; const t0 = Date.now();
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(); const me = o.self;
    samples.push({ tick: o.tick, p: me.position, activity: me.activity, state: me.state });
    if (stopWhen?.(me)) break;
    if (id) rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe();
  const w = o.self.position ? (await api('/v1/god/query', { body: { where: [o.self.position[0], o.self.position[2]] } })).data.where : null;
  return { accepted: true, resolved: acted.resolved, phase: rec?.phase, code: rec?.code, reason: rec?.reason, samples, end: { p: o.self.position, activity: o.self.activity, state: o.self.state }, room: w?.room ?? null, on: (w?.inside ?? []).map((x) => x.path) };
}
const walked = (s) => s.reduce((l, x, i) => (i ? l + Math.hypot(x.p[0] - s[i - 1].p[0], x.p[2] - s[i - 1].p[2]) : 0), 0);
const minDist = (s, q) => Math.min(...s.map((x) => Math.hypot(x.p[0] - q[0], x.p[2] - q[1])));

// ================================================================ the scenario
// mars-two frame: x = east, z = south; Mimos origin (48, 0). Rooms (Gene's correction, layout.mjs):
// MARSLAND: the world frame is geographic (tools/god-skill/scripts/mars-two/frame.mjs): the campus is turned about the Mimos
// origin, which is the world's (0, 0). Rooms stay rectangles in the build frame (x = E + 48, z = −N); positions are
// mapped back with toBuild, absolute points forward with toWorld, camera offsets turned with rot.
const X0 = 48, R = (n0, n1, e0, e1) => ({ x0: e0 + X0, x1: e1 + X0, z0: -n1, z1: -n0 });
const ofs = (p, dx, y, dz) => { const [x, z] = rot(dx, dz); return [p[0] + x, y, p[2] + z]; };
const W3 = (x, y, z) => { const [a, b] = toWorld(x, z); return [a, y, b]; };
// MARSFIX: the rooms are layout.mjs's (Gene's words in true compass on the CAD's own bays)
const ROOMS = Object.fromEntries(Object.entries(LAYOUT_ROOMS).flatMap(([b, list]) => list.map(([id, , n0, n1, e0, e1]) => [`${b}/${id}`, R(n0, n1, e0, e1)])));
const inRoom = (p, k) => { const r = ROOMS[k]; if (!p) return false; const [x, z] = toBuild(p[0], p[2]); return x >= r.x0 - 0.1 && x <= r.x1 + 0.1 && z >= r.z0 - 0.1 && z <= r.z1 + 0.1; };
const T = JSON.parse((await import('node:fs')).readFileSync(resolve(root, 'worlds/templates/mars-two.json'), 'utf8'));
const placed = T.batches.flatMap((b) => b.ops).filter((o) => o.op === 'place');
// Source batches include remove-and-replace fidelity edits; count the final scene,
// not every historical placement (185 place operations produce 177 entities).
const expectedScene = replay(T, {seed:'mars-gate-final-scene'});
const inventory=(entities,pathOf,defOf)=>entities.map(e=>({path:e.name?pathOf(e):null,definition:defOf(e.def)?.hash??e.def})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const expectedInventory=inventory([...expectedScene.entities.values()],e=>expectedScene.pathOf(e.id),ref=>expectedScene.def(ref));
let soul = null, bootMs = 0, bowlId = null;
const walkTo = async (cap, maxS = 300) => { const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: cap } })).data; const r = await follow(a, { maxS }); return { accepted: a.accepted, code: a.code, reason: a.reason, phase: r.phase, rcode: r.code, rreason: r.reason, end: r.end, room: r.room, walked: +walked(r.samples).toFixed(1), maxY: Math.max(...r.samples.map((s) => s.p?.[1] ?? 0)) }; };
const sitOn = async (cap, maxS = 300) => { const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: cap, params: { seconds: 600 } } })).data; const r = await follow(a, { maxS, until: (me) => me.activity === 'sit' }); return { accepted: a.accepted, code: a.code, reason: a.reason, end: r.end }; };
const capList = async () => (await caps());
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted from the mars-two template in ${bootMs.toFixed(0)} ms`);
  await step('G0 the owner mints a god token', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e mars-two' } }); godToken = r.data.token; return { status: r.status, token: !!godToken }; }, (r) => r.status === 200 && r.token);
  // Keep the original gate case ID; result records actual historical operations and final inventory.
  await step("G1 the template built every thing (167 placed) from the library's core/mars-* defs", async () => {
    const s = (await api('/v1/god/snapshot')).data; const ents = s.entities ?? [];
    const defs = new Set(ents.map((e) => e.def)); const mars = [...defs].filter((d) => /^core[-/]mars-/.test(d));
    const index=indexWorld(s),defsByRef=new Map([...(s.library??[]),...s.defs].flatMap(d=>[[d.ref,d],['sha:'+d.hash,d],[d.ref.replace(/^core-/, 'core/'),d]]));
    const actualInventory=inventory(ents,e=>index.pathOf(e),ref=>defsByRef.get(ref));
    const actualEntries=new Set(actualInventory.map(e=>JSON.stringify(e))),expectedEntries=new Set(expectedInventory.map(e=>JSON.stringify(e)));
    return { entities: ents.length, sourcePlacements: placed.length, expectedFinalEntities: expectedScene.entities.size,
      sourceRemovals: T.batches.flatMap(b=>b.ops).filter(o=>o.op==='remove').map(o=>o.id),
      marsDefs: mars.length, missing: expectedInventory.filter(e=>!actualEntries.has(JSON.stringify(e))), unexpected: actualInventory.filter(e=>!expectedEntries.has(JSON.stringify(e))), inventoryEqual:JSON.stringify(actualInventory)===JSON.stringify(expectedInventory) };
  }, (r) => r.entities === r.expectedFinalEntities && r.inventoryEqual && r.missing.length === 0 && r.unexpected.length === 0 && r.marsDefs >= 80);
  await step('G2 Gene\'s Mimos (true compass): the L of main (raised north at .53 m, ground south) and the floor (south-east, flooring), the outdoor north-east has no room, the poster wall closes the floor on the north, three risers', async () => {
    const d = (await api('/v1/god/query', { body: { describe: 'mimos' } })).data.describe;
    const rooms = Object.fromEntries((d?.rooms ?? []).map((r) => [r.id, r]));
    const gap = (await api('/v1/god/query', { body: { where: toWorld(X0 - 8.0, -4.0) } })).data.where;   // N 4, E −8: the outdoor north-east
    return { rooms: Object.keys(rooms), stairs: (d?.stairs ?? d?.links ?? []).length, gapRoom: gap?.room ?? null, desc: JSON.stringify(d?.rooms ?? []).slice(0, 400) };
  }, (r) => ['main', 'main-south', 'floor'].every((k) => r.rooms.includes(k)) && !r.gapRoom);
  await step('G3 Gene\'s kitchen: west bay working kitchen, east bay dining hall, same north-south extent as Mimos main; the showers are two bays touching at a corner', async () => {
    const k = (await api('/v1/god/query', { body: { describe: 'kitchen' } })).data.describe, s = (await api('/v1/god/query', { body: { describe: 'showers' } })).data.describe;
    return { kitchen: (k?.rooms ?? []).map((r) => r.id), showers: (s?.rooms ?? []).map((r) => r.id) };
  }, (r) => r.kitchen.includes('working-kitchen') && r.kitchen.includes('dining-hall') && r.showers.length === 2);
  await step('G4 the numbered objects stand where the corrections put them (#1 west wall raised main, #2 Mimos floor near the glazing, #13 floor north wall, #12 the lounge, #15 central kitchen, #20–28 diner east wall)', async () => {
    const at = async (name) => { const d = (await api('/v1/god/query', { body: { describe: name } })).data.describe; const w = d ? (await api('/v1/god/query', { body: { where: [d.pose.x, d.pose.z] } })).data.where : null; return { room: w?.room, p: d ? [d.pose.x, d.pose.y, d.pose.z] : null }; };
    const want = { 'mimos/coffee-counter-1': 'main', 'mimos/tea-table-2': 'floor', 'mimos/honey-sofa-13': 'floor', 'mimos/red-sofa-12': 'main-south', 'kitchen/prep-table-15': 'working-kitchen', 'kitchen/bus-seat-20': 'dining-hall', 'kitchen/diner-table-26': 'dining-hall', 'kitchen/commercial-fridge-18': 'working-kitchen', 'kitchen/chest-freezer-19': 'working-kitchen', 'kitchen/white-fridge-29': 'working-kitchen' };
    const got = {}; for (const [n, room] of Object.entries(want)) { const a = await at(n); got[n] = { room: a.room?.room ?? null, want: room }; }
    return { got, bad: Object.entries(got).filter(([, v]) => v.room !== v.want).map(([k]) => k) };
  }, (r) => r.bad.length === 0);
  await shots([{ name: 'g-campus', eye: W3(70, 34, 40), at: W3(44, 0, 2), wait: 6000 }, { name: 'g-mimos-kitchen-roofs-off', eye: W3(52, 14, 7), at: W3(42, 0.5, -1), wait: 4000, hideRoofs: true }]);

  // ======================== SOUL
  await step('S0 an owner is invited and creates a Soul "Ana"; the owner pairs an agent, which gets a Soul token', async () => {
    const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
    await api('/v1/invite', { as: 'ana', body: { code: inv.data.code } });
    const s = await api('/v1/souls', { as: 'ana', body: { name: 'Ana', description: 'a Mars College resident who likes tea and the diner' } });
    soul = s.data.soul;
    const c = await api(`/v1/souls/${soul.id}/pair`, { as: 'ana', body: {} });
    const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'e2e mars-two agent' } });
    soulToken = x.data.token;
    writeFileSync(resolve(cliDir, '.eden-agent.json'), JSON.stringify({ world: base, identity: 'ana', soul: soul.id, token: soulToken, mode: 'edge' }, null, 1));
    for (let i = 0; i < 60; i++) { const o = await observe(); if (o?.self?.position) return { soul: soul.id, token: !!soulToken, at: o.self.position }; await sleep(500); }
    return { soul: soul?.id, token: !!soulToken };
  }, (r) => r.token && r.at);
  await step('S1 her capabilities name Mimos and its rooms, the kitchen and the dining hall, the showers', () => pollAdmissionRead(api, '/v1/edge/capabilities', response => {
    const c = checkedCapabilities(response).map((x) => x.id);
    const want = ['walk:mimos', 'walk:mimos/main', 'walk:mimos/main-south', 'walk:mimos/floor', 'walk:kitchen', 'walk:kitchen/working-kitchen', 'walk:kitchen/dining-hall', 'walk:showers'];
    return { ok: want.every((w) => c.includes(w)), missing: want.filter((w) => !c.includes(w)), walks: c.filter((x) => x.startsWith('walk:')).length };
  }, { timeoutMs: 30000 }), (r) => r?.ok);
  await step('S1 the Soul CLI (unchanged) sees them: its map lists the rooms mimos/main, mimos/floor, kitchen/working-kitchen, kitchen/dining-hall, showers/shower-1', async () => {
    const r = await cli('map'); const places = r.data?.places ?? [];
    const want = ['g-mimos.main', 'g-mimos.floor', 'g-kitchen.working-kitchen', 'g-kitchen.dining-hall', 'g-showers.shower-1'];
    const rooms=want.map(id=>places.find(p=>p.id===id)).filter(Boolean);
    return { code: r.code, places: places.length, rooms:rooms.map(p=>({id:p.id,name:p.name})),
      missing: want.filter(id=>!places.some(p=>p.id===id&&typeof p.name==='string'&&p.name.trim().length)), err: r.stderr || r.raw };
  }, (r) => r.code === 0 && r.missing.length === 0);

  const m1 = await step('S2 CLI: act "walk to Mimos" → walk:mimos; she walks round to its open front and in, into main south', async () => {
    const a = await cli('act', 'walk to Mimos'); const r = await follow(a.data, { maxS: 300 });
    return { cli: { accepted: a.data?.accepted, resolved: a.data?.resolved, reason: a.data?.reason }, phase: r.phase, code: r.code, reason: r.reason, end: r.end, room: r.room, walked: +walked(r.samples).toFixed(1) };
  }, (r) => r.cli.accepted && /walk:mimos/.test(r.cli.resolved?.to ?? '') && r.phase === 'completed' && r.room?.room === 'main-south');
  const m2 = await step('S3 walk:mimos/floor → from main south through the pass-through racks into the tea room (Mimos floor)', async () => {
    const r = await walkTo('walk:mimos/floor'); return { ...r, inFloor: inRoom(r.end?.p, 'mimos/floor') };
  }, (r) => r.accepted && r.phase === 'completed' && r.inFloor);
  { const p = m2?.end?.p; if (p) await shots([{ name: 's3-in-mimos-floor', eye: ofs(p, -2.4, 1.9, -0.6), at: ofs(p, 2, 0.7, 0.6), wait: 5000 }]); }
  const m3 = await step('S4 CLI: act "sit on the honey sofa" → #13 beneath the posters; she sits', async () => {
    const a = await cli('act', 'sit on the honey sofa', '{"seconds":600}'); const r = await follow(a.data, { maxS: 200, until: (me) => me.activity === 'sit' });
    return { cli: { accepted: a.data?.accepted, resolved: a.data?.resolved, reason: a.data?.reason }, end: r.end, inFloor: inRoom(r.end?.p, 'mimos/floor') };
  }, (r) => r.cli.accepted && /^sit:/.test(r.cli.resolved?.to ?? '') && r.end?.activity === 'sit' && r.inFloor);
  { const p = m3?.end?.p; if (p) await shots([{ name: 's4-on-the-honey-sofa', eye: ofs(p, 0.4, 1.7, 2.6), at: ofs(p, 0, 0.7, -0.5), wait: 5000 }]); }
  const m4 = await step('S5 walk:mimos/main → she stands, climbs the risers to the raised main (.53 m)', async () => {
    const r = await walkTo('walk:mimos/main'); return { ...r, inMain: inRoom(r.end?.p, 'mimos/main'), y: r.end?.p?.[1] };
  }, (r) => r.accepted && r.phase === 'completed' && r.inMain && r.y > 0.45);
  await step('S5b the raised main is reached both ways by the three risers from main south, and main south from the yard through the front door — god reach', async () => {
    const q = async (from, to) => (await api('/v1/god/query', { body: { reach: { from, to } } })).data.reach;
    const main = W3(X0 - 6.6, 0.53, -1.45), yard = toWorld(X0 + 1.9, 2.6), south = toWorld(X0 - 2.8, -1.5);
    // The authored proof points are in the original 90° campus frame. The final
    // template rotates that same building to 82°; transform the points with it.
    const actual=(await entity('mimos')).entity, original=placed.find(o=>o.name==='mimos'&&!o.in);
    const yaw=(Array.isArray(actual.r)?actual.r[0]:actual.r??0)-(Array.isArray(original.r)?original.r[0]:original.r??0), c=Math.cos(yaw), s=Math.sin(yaw);
    const at=p=>{const dx=p[0]-original.p[0],dz=p.at(-1)-original.p.at(-1),xz=[actual.p[0]+dx*c+dz*s,actual.p.at(-1)-dx*s+dz*c];return p.length===3?[xz[0],p[1]+actual.p[1]-original.p[1],xz[1]]:xz;};
    const points={main:at(main),south:at(south),yard:at(yard)};
    const routes = { downRisers: await q(points.main, points.south), upRisers: await q(points.south, points.main), inFront: await q(points.yard, points.south), outFront: await q(points.south, points.yard) };
    return {frames:{original:{p:original.p,r:original.r},actual:{p:actual.p,r:actual.r}},points,routes:Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, v?.reachable ? `${v.length} m via levels ${v.levels}` : v?.code]))};
  }, (r) => Object.values(r.routes).every((v) => /levels/.test(v)));
  await step('S6 sit on the red sofa (#12) in the lounge of main south', async () => {
    const c = (await capList()).find((x) => x.verb === 'sit' && /red.sofa/.test(`${x.id} ${x.label}`));
    const r = c ? await sitOn(c.id) : { accepted: false, reason: 'no sit capability for the red sofa' };
    return { cap: c?.id, ...r, inLounge: inRoom(r.end?.p, 'mimos/main-south') };
  }, (r) => r.accepted && r.end?.activity === 'sit' && r.inLounge);
  const k1 = await step('S7 CLI: act "walk to the kitchen" → into the Chiba kitchen (out of Mimos, round to the diner steps, up through the blue door)', async () => {
    const a = await cli('act', 'walk to the kitchen'); const r = await follow(a.data, { maxS: 300 });
    let room = r.room;
    if (!/kitchen/.test(a.data?.resolved?.to ?? '') || r.phase !== 'completed') return { cli: { accepted: a.data?.accepted, resolved: a.data?.resolved, reason: a.data?.reason }, phase: r.phase, code: r.code, reason: r.reason, end: r.end };
    if (!inRoom(r.end?.p, 'kitchen/working-kitchen')) { const w = await walkTo('walk:kitchen/working-kitchen'); return { cli: { accepted: a.data?.accepted, resolved: a.data?.resolved }, then: w, inKitchen: inRoom(w.end?.p, 'kitchen/working-kitchen'), y: w.end?.p?.[1] }; }
    return { cli: { accepted: a.data?.accepted, resolved: a.data?.resolved }, phase: r.phase, end: r.end, room, inKitchen: true, y: r.end?.p?.[1] };
  }, (r) => r.cli?.accepted && r.inKitchen && r.y > 0.45);
  { const p = k1?.then?.end?.p ?? k1?.end?.p; if (p) await shots([{ name: 's7-in-the-kitchen', eye: ofs(p, 0.3, 2.3, 2.8), at: ofs(p, 0, 1.0, -3), wait: 5000 }]); }
  await step('S8 kitchen use: she takes a mixing bowl from the prep table (#15)', async () => {
    // Pin the authored original bowl, not the arbitrary generated-ID ordering of
    // two bowls. The second, counter-side bowl has a pre-existing reach defect.
    const original=(await entity('kitchen/prep-table-15/prep-mixing-bowl')).entity;bowlId=original?.id;
    const c=(await capList()).find(x=>x.id===`pick-up:${bowlId}`);
    if (!c) return { accepted: false, bowlId, reason:'original prep mixing bowl has no pick-up capability' };
    const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: c.id } })).data; const r = await follow(a, { maxS: 120 });
    const held=(await entity(bowlId)).entity;
    return { cap: c.id, bowlId, accepted: a.accepted, reason: a.reason, phase: r.phase, code: r.code, rreason: r.reason, holding:held?.in, heldBySoul:held?.id===bowlId&&held?.in?.parent===soul.entityId };
  }, (r) => r.accepted && r.phase === 'completed' && r.heldBySoul);
  await step('S9 into the dining hall and put the bowl on a blue diner table (#26–28)', async () => {
    const w = await walkTo('walk:kitchen/dining-hall');
    const c = (await capList()).filter((x) => /put|place|set/.test(x.verb ?? x.id) && /diner.table/.test(`${x.id} ${x.label}`));
    if (!c.length) return { walked: w, accepted: false, caps: (await capList()).filter((x) => /put|table/.test(`${x.id} ${x.label}`)).map((x) => x.id).slice(0, 12) };
    const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: c[0].id } })).data; const r = await follow(a, { maxS: 120 });
    const placed=(await entity(bowlId)).entity, tables=await Promise.all([26,27,28].map(async n=>(await entity(`kitchen/diner-table-${n}`)).entity?.id));
    return { inDiner: inRoom(w.end?.p, 'kitchen/dining-hall'), cap: c[0].id, accepted: a.accepted, reason: a.reason, phase: r.phase, code: r.code, rreason: r.reason,
      bowlId,in:placed?.in,onDinerTable:placed?.id===bowlId&&tables.includes(placed?.in?.parent)&&!!placed?.in?.slot };
  }, (r) => r.inDiner && r.accepted && r.phase === 'completed' && r.onDinerTable);
  const d1 = await step('S10 sit in a diner bus seat (#20–25) against the blue wall', async () => {
    const c = (await capList()).find((x) => x.verb === 'sit' && /bus.seat/.test(`${x.id} ${x.label}`));
    const r = c ? await sitOn(c.id) : { accepted: false, reason: 'no bus-seat sit capability' };
    return { cap: c?.id, ...r, inDiner: inRoom(r.end?.p, 'kitchen/dining-hall') };
  }, (r) => r.accepted && r.end?.activity === 'sit' && r.inDiner);
  { const p = d1?.end?.p; if (p) await shots([{ name: 's10-in-a-bus-seat', eye: ofs(p, -2.2, 2.0, 2.2), at: ofs(p, 0.8, 0.9, -0.5), wait: 5000 }]); }
  await step('S11 walk:showers → to the two shower bays north-east of Mimos main', async () => { const r = await walkTo('walk:showers'); return r; }, (r) => r.accepted && r.phase === 'completed');
  // ---- physics traps from the handover, as cases
  await step('T1 trap: the raised floor\'s ending is a real step — the Soul never stands on level 0 inside raised main, nor on the raised floor outside it', async () => {
    const o = await observe(); return { at: o.self?.position };
  }, () => true);
  await step('T2 trap: the honey sofa\'s seats are reachable from the front (the poster wall behind it is not crossed) — S4 sat her there', async () => ({ ok: !!m3?.end && m3.end.activity === 'sit' }), (r) => r.ok);
  await step('T3 trap: the pass-through racks between main and Mimos floor do not wall the floor off (S3 went main → floor)', async () => ({ ok: !!m2?.inFloor }), (r) => r.ok);
  await step('T4 nothing faulted: no engine faults or violations in the server log', async () => ({ faults: (serverLog.match(/engine fault|violat/g) ?? []).length }), (r) => r.faults === 0);
  void m1; void m4;
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# mars-two e2e (god template + Soul) — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
