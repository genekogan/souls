#!/usr/bin/env node
// CW7 (#741): inventory versus activity. Three orthogonal axes (report.mjs AXES) on one designated eden-2026 world:
// distant placed inventory 5,000 vs 10,000, active Souls 0/5/10 of 10 registered, and the designated world alone vs
// with 9 quiet ticking worlds beside it. Each world is booted directly with the checkout's own launcher command and
// production decoration (fake minds, Eyes off), in an isolated data dir under the run. Tools-only; never gated, never
// on Modal; indicative unless run on the qualifying executor (--qualifying-executor --quiet-host).
//
//   node tools/bench/capacity/slopes/slopes.mjs [--axis inventory,activity,quiet] [--repeats 1] [--out <dir>]
//        [--root <checkout>] [--port 4600] [--heap-mb 2048] [--quiet-worlds 9] [--warm-s 30] [--quiet-s 60]
//        [--active-s 180] [--probe-n 20] [--cpu-prof] [--slice "<command prefix>"] [--host-class laptop]
//        [--quiet-host] [--qualifying-executor] [--short]
//
// Per arm and repeat: <out>/<arm>-r<k>/{result.json, calls.jsonl, live.jsonl, world.log, profile-*.cpuprofile}.
// <out>/{receipt.json, results.json, REPORT.md}. No host name, user, home path or token in receipt/results/REPORT.
import { spawn, execFileSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, freemem, platform, arch, totalmem } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { FIXTURES, DEMAND, rng, outcomeOf } from '../meetup/workload.mjs';
import { withDistantInventory } from './inventory.mjs';
import { AXES, ACTS, PROBE_ROUTES, SLOPES, cores, probeRoute, activeWindow, liveWindow, summarizeProfile, reportText } from './report.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; }, flag = (k) => argv.includes(`--${k}`);
const ROOT = resolve(opt('root', new URL('../../../..', import.meta.url).pathname)), SHORT = flag('short');
const PORT = Number(opt('port', 4600)), INSPECT = PORT + 50, HEAP_MB = Number(opt('heap-mb', 2048)), REPEATS = Number(opt('repeats', 1));
const QUIET_N = Number(opt('quiet-worlds', 9)), PROBE_N = Number(opt('probe-n', SHORT ? 5 : 20)), PROF = flag('cpu-prof'), SLICE = opt('slice', '');
const WARM_S = Number(opt('warm-s', SHORT ? 10 : 30)), QUIET_S = Number(opt('quiet-s', SHORT ? 20 : 60)), ACTIVE_S = Number(opt('active-s', SHORT ? 40 : 180));
const HOST_CLASS = opt('host-class', 'laptop'), QUIET = flag('quiet-host'), QUALIFYING = flag('qualifying-executor') && QUIET;
const AXIS_LIST = opt('axis', 'inventory,activity,quiet').split(',');
for (const a of AXIS_LIST) if (!AXES[a]) throw new Error(`--axis ${a}: inventory | activity | quiet`);
const OUT = resolve(opt('out', join(ROOT, '.local/bench/slopes', new Date().toISOString().replace(/[:.]/g, '-'))));
const { defaultCommand } = await import(pathToFileURL(join(ROOT, 'tools/world-launcher/children.mjs')).href);
const { decorateCommand } = await import(pathToFileURL(join(ROOT, 'tools/world-launcher/production.mjs')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const mono = () => performance.now();
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const rel = (p) => relative(ROOT, p) || '.';
mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); appendFileSync(join(OUT, 'slopes.log'), s + '\n'); };
const MARS_WEB = join(ROOT, 'mars/viewer/dist'), KIT = join(ROOT, 'apps/web/dist/kit-contract.json');
for (const [p, fix] of [[MARS_WEB, 'pnpm build:viewer'], [KIT, 'pnpm --filter @sim/web build']]) if (!existsSync(p)) throw new Error(`missing ${rel(p)}: run \`${fix}\` in the checkout`);

// ------------------------------------------------------------------ process facts (Linux /proc, else ps)
const CLK_TCK = Number(sh('getconf', ['CLK_TCK']) ?? 100) || 100;
function proc(pid) {   // {t, cpuS, rssMb} | null
  const t = mono();
  try {
    const st = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '), rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return { t, cpuS: (Number(st[11]) + Number(st[12])) / CLK_TCK, rssMb: rss ? Number(rss[1]) / 1024 : null };
  } catch { /* not Linux */ }
  const line = sh('ps', ['-o', 'time=,rss=', '-p', String(pid)]); if (!line) return null;
  const [tm, rss] = line.trim().split(/\s+/), parts = tm.replace(/^(\d+)-/, (_, d) => `${d * 24}:`).split(':').map(Number);
  return { t, cpuS: parts.reduce((s, x) => s * 60 + x, 0), rssMb: Number(rss) / 1024 };
}
const sumProc = (ps) => (ps.every(Boolean) ? { t: ps[0].t, cpuS: ps.reduce((s, p) => s + p.cpuS, 0), rssMb: ps.reduce((s, p) => s + p.rssMb, 0) } : null);
// Soul server processes on the host that are not this run's (the qualify workflow's quiet check reads result.json `load`)
const otherSouls = (own = []) => (sh('pgrep', ['-f', 'apps/server/src/main.ts']) ?? '').split('\n').map(Number).filter((p) => p && !own.includes(p)).length;
const nodePid = (pid) => { for (let p = pid, k = 0; p && k < 4; k++) { if (/node/.test(sh('ps', ['-o', 'comm=', '-p', String(p)]) ?? '')) return p; p = Number((sh('pgrep', ['-P', String(p)]) ?? '').split('\n')[0]) || null; } return pid; };

// ------------------------------------------------------------------ worlds
async function getJ(url, ms = 5000) { const t = mono(); try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return { status: r.status, j: await r.json().catch(() => null), ms: mono() - t }; } catch { return { status: 0, j: null, ms: mono() - t }; } }
async function bootWorld(dir, { slug, templateFile, port, inspect }) {
  const data = join(dir, 'data'), library = join(dir, 'library'); mkdirSync(data, { recursive: true }); mkdirSync(library, { recursive: true });
  const soul = (f) => join(ROOT, 'tools/world-launcher/soul', f), origin = `http://127.0.0.1:${port}`;
  const base = defaultCommand({ slug, dataDir: data, name: `Slopes ${slug}`, templateFile }, port,
    { publicOrigin: origin, marsWebDir: MARS_WEB, root: ROOT, libraryDir: library, soulControllerCliFile: soul('eden.mjs'), soulCliFile: soul('eden-agent.mjs'), soulSkillFile: soul('skill.md'), soulInstructionsFile: soul('instructions.md') });
  const { cmd: node, args, env } = decorateCommand(base, { devAuth: true, publicOrigin: origin, base: '', worldHeapMb: HEAP_MB, build: 'dev' });
  Object.assign(env, { MIND_DRIVER: 'edge', BRAIN_MODE: 'fake' });
  for (const k of Object.keys(env)) if (k.startsWith('EDGE_EYES')) delete env[k];   // no renders (Eyes off)
  const cmd = [...(SLICE ? SLICE.split(/\s+/) : []), node, ...(inspect ? [`--inspect=127.0.0.1:${inspect}`] : []), ...args];
  writeFileSync(join(dir, 'world-command.json'), JSON.stringify({ cmd: cmd.map((x) => String(x).split(ROOT).join('.')), env: Object.fromEntries(Object.entries(env).filter(([k]) => !/KEY|TOKEN|SECRET/.test(k)).map(([k, v]) => [k, String(v).split(ROOT).join('.')])) }, null, 1));
  const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let wlog = ''; const wl = (b) => { wlog = (wlog + b).slice(-20000); appendFileSync(join(dir, 'world.log'), b); };
  child.stdout.on('data', wl); child.stderr.on('data', wl);
  const t0 = mono(); let up = false;
  while (!up && mono() - t0 < 900_000) { if (child.exitCode != null) throw new Error(`${slug} exited at boot (${child.exitCode}): ${wlog.trim().split('\n').slice(-6).join(' | ').split(ROOT).join('.')}`); up = (await getJ(`${origin}/healthz`, 3000)).j?.ok; if (!up) await sleep(1000); }
  if (!up) throw new Error(`${slug} did not answer /healthz in 15 min`);
  const bootS = (mono() - t0) / 1000;
  // settled: the boot's perceive catch-up logged, or 30 s up with three calm ticks; cap 300 s
  for (let calm = 0, tc = mono(); !/perceive catch-up/.test(wlog) && mono() - tc < 300_000 && !(mono() - tc > 30_000 && calm >= 3);) { await sleep(1000); const h = (await getJ(`${origin}/healthz`)).j; calm = h?.ok && h.tickMs?.avg < 25 ? calm + 1 : 0; }
  return { slug, child, pid: nodePid(child.pid), data, origin, bootS: +bootS.toFixed(1), settledS: +((mono() - t0) / 1000).toFixed(1) };
}
async function stopWorld(w) {
  if (!w?.child || w.child.exitCode != null) return;
  w.child.kill('SIGTERM'); for (let k = 0; k < 60 && w.child.exitCode == null; k++) await sleep(500);
  if (w.child.exitCode == null) { w.child.kill('SIGKILL'); await sleep(500); }
}
const LIVE = new Set();   // worlds this process started and has not stopped yet (stopped on SIGINT/SIGTERM too)
const liveOf = (w) => { try { return JSON.parse(readFileSync(join(w.data, 'live.json'), 'utf8')); } catch { return null; } };

// ------------------------------------------------------------------ the inspector: CPU profiles of the main thread
async function inspector(port) {
  const list = (await getJ(`http://127.0.0.1:${port}/json/list`)).j, ws = new WebSocket(list[0].webSocketDebuggerUrl), wait = new Map(); let id = 0;
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); wait.get(m.id)?.(m); wait.delete(m.id); };
  const send = (method, params = {}) => new Promise((ok) => { const i = ++id; wait.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 1000 });
  return { start: () => send('Profiler.start'), stop: async () => (await send('Profiler.stop')).result?.profile ?? null, close: () => ws.close() };
}

// ------------------------------------------------------------------ Souls (the checkout's own CLI, dev identity)
function runCli(dir, args, ms) {
  return new Promise((done) => {
    const p = spawn(process.execPath, ['eden.mjs', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }); let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-500); }); p.stdout.resume();
    const k = setTimeout(() => p.kill('SIGKILL'), ms); p.on('exit', (code) => { clearTimeout(k); done({ code, err: err.trim().split('\n').at(-1) ?? '' }); });
  });
}
/** The CLI wants a world URL of the form …/w/<slug>; a directly booted world has no such prefix. A loopback proxy in
 *  this process strips it, for joining only (the measured calls go straight to the world). */
async function joinProxy(w, port) {
  const prefix = `/w/${w.slug}`, target = new URL(w.origin);
  const srv = createServer((req, res) => {
    const path = req.url.startsWith(prefix) ? req.url.slice(prefix.length) || '/' : req.url;
    const up = httpRequest({ host: target.hostname, port: target.port, method: req.method, path, headers: { ...req.headers, host: target.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
  });
  await new Promise((ok) => srv.listen(port, '127.0.0.1', ok));
  return { url: `http://localhost:${port}${prefix}`, close: () => new Promise((ok) => srv.close(ok)) };
}
async function joinSoul(run, w, i) {
  const dir = join(run.dir, 'souls', `s${i}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'eden.mjs'), Buffer.from(await (await fetch(`${w.origin}/eden.mjs`)).arrayBuffer()));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ identity: `agent-slopes-${run.id}-${i}` }) + '\n', { mode: 0o600 });
  const reg = await runCli(dir, ['register', run.joinUrl], 60_000); if (reg.code) log(`soul ${i} register: ${reg.code} ${reg.err.split(ROOT).join('.')}`);
  const token = () => { try { return JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8')).token ?? null; } catch { return null; } };
  for (const t0 = mono(); !token() && mono() - t0 < 120_000;) { const r = await runCli(dir, ['create', `Slope${i}`], 150_000); if (!token()) { log(`soul ${i} create: ${r.code} ${r.err.split(ROOT).join('.')}`); await sleep(2000); } }
  if (!token()) throw new Error(`soul ${i} did not join`);
  return { i, token: token(), address: `198.51.100.${i + 1}` };
}
function requestOf(route, n, run) {
  const act = (capability) => ['POST', '/v1/edge/act', { capability, params: {}, clientRef: `${run.id}-${run.seq++}` }];
  if (route === 'here') return ['GET', '/v1/edge/here?include=doHere'];
  if (route === 'observe') return ['GET', '/v1/edge/observe'];
  if (route === 'capabilities') return ['GET', '/v1/edge/capabilities'];
  if (route === 'resolve') return ['POST', '/v1/edge/resolve', { capability: ['sit down', 'wave', 'look around'][n % 3], params: {} }];
  const a = ACTS[n % ACTS.length];
  return a === 'say' ? ['POST', '/v1/edge/say', { text: 'hello from the slopes bench' }] : act(a);
}
// The CLI's etiquette (as the meetup bench): a designed busy answer is waited out for its Retry-After, up to 3 times;
// the waits are inside the call's time and counted (busyWaits, waitMs, refusals by code).
const BUSY = /\b(world\.busy|world\.crowded|world\.starting|soul\.busy|soul\.slow-down|rate-limited|client\.rate|account\.rate)\b/;
async function call(run, w, s, route, n) {
  const [method, path, body] = requestOf(route, n, run), t = mono(), key = route === 'act' && !body.capability ? `${run.id}-${run.seq++}` : null;
  let status = 0, code = null, d = null, bytes = 0, busy = 0, waitMs = 0; const refusals = [];
  for (;;) {
    try {
      const r = await fetch(`${w.origin}${path}`, { method, headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', 'x-forwarded-for': s.address, ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
      const text = await r.text(); bytes = Buffer.byteLength(text); status = r.status; try { d = JSON.parse(text); } catch { d = null; } code = d?.error?.code ?? d?.code ?? null;
      if ((status === 429 || status === 503) && BUSY.test(String(code)) && busy < 3) { busy++; refusals.push(code); const ra = Number(r.headers.get('retry-after')), w0 = mono(); await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** busy); waitMs += mono() - w0; continue; }
    } catch (e) { status = e?.name === 'TimeoutError' ? -1 : 0; }
    break;
  }
  const accepted = route === 'resolve' ? d?.resolve?.ok : d?.accepted;
  return { route, ms: Math.round(mono() - t), bytes, status, outcome: outcomeOf({ status, code, accepted }), ...(code ? { code } : {}), ...(busy ? { busyWaits: busy, waitMs: Math.round(waitMs), refusals } : {}) };
}

// ------------------------------------------------------------------ one arm
async function oneRun(arm, rep) {
  const dir = join(OUT, `${arm.id}-r${rep}`); mkdirSync(dir, { recursive: true });
  const run = { id: `${arm.id}r${rep}`, dir, seq: 0 }, worlds = [], samples = [], calls = [], otherBefore = otherSouls();
  const src = JSON.parse(readFileSync(join(ROOT, 'worlds/templates/eden-2026.json'), 'utf8')), inv = arm.placed ? withDistantInventory(src, arm.placed) : { template: src, added: 0, own: null, region: null };
  const templateFile = join(dir, 'template.json'); writeFileSync(templateFile, JSON.stringify(inv.template));
  const placed = inv.template.batches.reduce((s, b) => s + b.ops.filter((o) => o.op === 'place').length, 0);
  try {
    log(`${run.id}: boot designated world (${placed} placed${inv.added ? `, ${inv.added} distant` : ''})`);
    const W = await bootWorld(join(dir, 'w0'), { slug: 'sw0', templateFile, port: PORT, inspect: PROF ? INSPECT : 0 }); worlds.push(W); LIVE.add(W);
    const quietN = arm.quiet ? Math.min(arm.quiet, QUIET_N) : 0;
    for (let q = 1; q <= quietN; q++) { const f = FIXTURES[q]; log(`${run.id}: boot quiet world ${q} (${f.template})`); const qw = await bootWorld(join(dir, `w${q}`), { slug: `sq${q}`, templateFile: join(ROOT, 'worlds/templates', `${f.template}.json`), port: PORT + q, inspect: 0 }); worlds.push(qw); LIVE.add(qw); }
    const souls = [], jp = await joinProxy(W, PORT + 40); run.joinUrl = jp.url;
    for (let i = 0; i < arm.registered; i += 4) souls.push(...await Promise.all(Array.from({ length: Math.min(4, arm.registered - i) }, (_, k) => joinSoul(run, W, i + k))));
    await jp.close();
    log(`${run.id}: ${souls.length} Souls joined; warm-up ${WARM_S} s`);
    let sampling = true;
    const sampler = (async () => { while (sampling) { const l = liveOf(W); samples.push({ t: mono(), live: l, w: proc(W.pid), q: worlds.length > 1 ? sumProc(worlds.slice(1).map((x) => proc(x.pid))) : null }); await sleep(2000); } })();
    await sleep(WARM_S * 1000);
    const mark = (k) => ({ k, t: mono(), w: proc(W.pid), q: worlds.length > 1 ? sumProc(worlds.slice(1).map((x) => proc(x.pid))) : null });
    const m = { quiet0: mark('quiet0') }; await sleep(QUIET_S * 1000); m.quiet1 = mark('quiet1');
    const quietCores = cores(m.quiet0.w, m.quiet1.w);
    // the probe: PROBE_N serial calls per route, one at a time, rotating over the registered Souls (each has its own
    // CPU budget: one Soul alone runs out of it at 10,000 objects and is told soul.slow-down), nothing else active
    const prof = PROF ? await inspector(INSPECT) : null, profiles = {};
    if (prof) await prof.start();
    const probe = {};
    for (const route of PROBE_ROUTES) {
      const a = proc(W.pid), cs = []; for (let n = 0; n < PROBE_N; n++) cs.push(await call(run, W, souls[n % souls.length], route, n)); const b = proc(W.pid);
      probe[route] = probeRoute(cs, { cpuS: a && b ? b.cpuS - a.cpuS : null, spanMs: b.t - a.t, quietCores });
      for (const c of cs) appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ phase: 'probe', ...c }) + '\n');
    }
    if (prof) { const p = await prof.stop(); writeFileSync(join(dir, 'profile-probe.cpuprofile'), JSON.stringify(p)); profiles.probe = summarizeProfile(p, ROOT); }
    // the active window: `active` Souls at CW1's per-Soul rates, one call at a time, from seeded offsets
    if (prof) await prof.start();
    m.active0 = mark('active0'); const t0 = m.active0.t, end = t0 + ACTIVE_S * 1000, R = rng(`${SLOPES}|${arm.id}`); let offered = 0;
    const plan = souls.slice(0, arm.active).map((s) => { const ops = [], ro = R() * DEMAND.readEveryMs, ao = R() * DEMAND.actEveryMs; let n = Math.floor(R() * 6);
      for (let t = ro; t < ACTIVE_S * 1000; t += DEMAND.readEveryMs) ops.push({ at: t, route: DEMAND.readMix[n++ % DEMAND.readMix.length] });
      for (let t = ao, k = 0; t < ACTIVE_S * 1000; t += DEMAND.actEveryMs) ops.push({ at: t, route: 'act', n: k++ });
      offered += ops.length; return { s, ops: ops.sort((a, b) => a.at - b.at) }; });
    await Promise.all(plan.map(async ({ s, ops }) => { for (const [k, op] of ops.entries()) { await sleep(t0 + op.at - mono()); if (mono() >= end) break;
      const late = Math.max(0, Math.round(mono() - (t0 + op.at))), c = await call(run, W, s, op.route, op.n ?? k); c.lateMs = late; calls.push(c); appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ phase: 'active', ...c }) + '\n'); } }));
    await sleep(end - mono()); m.active1 = mark('active1');
    if (prof) { const p = await prof.stop(); writeFileSync(join(dir, 'profile-active.cpuprofile'), JSON.stringify(p)); profiles.active = summarizeProfile(p, ROOT); prof.close(); }
    sampling = false; await sampler;
    for (const x of samples) appendFileSync(join(dir, 'live.jsonl'), JSON.stringify({ t: Math.round(x.t), live: x.live, w: x.w, q: x.q }) + '\n');
    const inWin = (a, b) => samples.filter((x) => x.t >= a.t && x.t <= b.t);
    const win = (a, b, k) => ({ cores: cores(a[k], b[k]) == null ? null : +cores(a[k], b[k]).toFixed(3), rssMbMax: Math.round(Math.max(0, ...inWin(a, b).map((x) => x[k]?.rssMb ?? 0))) });
    const dbBytes = (() => { try { return statSync(join(W.data, 'sim.db')).size; } catch { return null; } })();
    const result = {
      arm, rep, facts: { placed, distantAdded: inv.added, region: inv.region, residentSouls: liveOf(W)?.souls ?? null },
      boot: { seconds: W.bootS, settledS: W.settledS, dbMb: dbBytes == null ? null : +(dbBytes / 2 ** 20).toFixed(1), quietWorlds: worlds.slice(1).map((x) => ({ slug: x.slug, bootS: x.bootS })) },
      windows: { quiet: win(m.quiet0, m.quiet1, 'w'), active: win(m.active0, m.active1, 'w') },
      quietWorlds: worlds.length > 1 ? { n: worlds.length - 1, ...win(m.active0, m.active1, 'q') } : null,
      probe, active: activeWindow(calls, { cpuS: m.active0.w && m.active1.w ? m.active1.w.cpuS - m.active0.w.cpuS : null, spanMs: m.active1.t - m.active0.t, quietCores, offered }),
      live: { quiet: liveWindow(inWin(m.quiet0, m.quiet1).map((x) => x.live).filter(Boolean)), active: liveWindow(inWin(m.active0, m.active1).map((x) => x.live).filter(Boolean)) },
      profiles, load: { otherSoulsProcessesBefore: otherBefore, otherSoulsProcessesAfter: otherSouls(worlds.map((x) => x.pid)) }, host: { loadavg: loadavg().map((x) => +x.toFixed(2)), freeMemMb: Math.round(freemem() / 2 ** 20) },
    };
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 1) + '\n');
    log(`${run.id}: quiet ${result.windows.quiet.cores} cores, active ${result.windows.active.cores} cores, ${result.active.served}/${offered} served, probe CPU-ms ${PROBE_ROUTES.map((k) => `${k} ${probe[k].cpuMsPerCall}`).join(', ')}`);
    return result;
  } finally { for (const w of worlds.reverse()) { await stopWorld(w); LIVE.delete(w); } }
}

// ------------------------------------------------------------------ main
const commit = sh('git', ['-C', ROOT, 'rev-parse', 'HEAD']), dirty = !!sh('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no']);
const receipt = { slopes: SLOPES, at: new Date().toISOString(), indicative: !QUALIFYING, source: { commit, dirty, bench: sh('git', ['rev-parse', 'HEAD']) },
  host: { class: HOST_CLASS, platform: platform(), arch: arch(), cores: cpus().length, memGiB: Math.round(totalmem() / 2 ** 30), quietDeclared: QUIET, loadavgStart: loadavg().map((x) => +x.toFixed(2)) },
  axes: AXIS_LIST, repeats: REPEATS, windows: { warmS: WARM_S, quietS: QUIET_S, activeS: ACTIVE_S, probeN: PROBE_N }, quietWorldsCap: QUIET_N, cpuProfile: PROF, slice: SLICE ? 'given' : null,
  coverage: ['fake minds; server delivery only, no model latency', 'acts never move a Soul (attention, gesture, say): walk planning (#454) is not exercised', 'Eyes (rendering) off; no browser viewers; no launcher proxy',
    'CPU is the whole world process (worker threads included); per-call CPU is an upper bound (tick variation inside it)', 'no counters for rows examined, plan builds or invalidations: the CPU profile attributes cost to functions instead',
    ...(QUIET_N < 9 ? [`quiet axis capped at ${QUIET_N} quiet worlds (--quiet-worlds), not 9`] : [])] };
writeFileSync(join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 1) + '\n');
const results = [];
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { log(`interrupted (${sig}): stopping ${LIVE.size} world(s)`); await Promise.all([...LIVE].map(stopWorld)); process.exit(130); });
for (let rep = 1; rep <= REPEATS; rep++) for (const axis of AXIS_LIST) for (const arm of AXES[axis]) {
  try { results.push(await oneRun(arm, rep)); } catch (e) { log(`${arm.id}-r${rep} failed: ${String(e.message).split(ROOT).join('.')}`); results.push({ arm, rep, error: String(e.message).split(ROOT).join('.') }); }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1) + '\n');
}
receipt.host.loadavgEnd = loadavg().map((x) => +x.toFixed(2)); writeFileSync(join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 1) + '\n');
writeFileSync(join(OUT, 'REPORT.md'), reportText(receipt, results.filter((x) => !x.error)));
log(`done: ${rel(join(OUT, 'REPORT.md'))}`);
