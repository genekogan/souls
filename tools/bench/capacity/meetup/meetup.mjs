#!/usr/bin/env node
// CW1 (#735): run the 50-Soul / 10-world meetup workload (workload.mjs) through the checkout's own launcher, on
// isolated fake-mind data, and write a sanitized receipt, every call's record and a report. Read README.md
// ("Meetup workload") first. Tools-only; never gated, never on Modal; indicative unless run on the qualifying executor.
//
//   node tools/bench/capacity/meetup/meetup.mjs [--profile even|meetup|even,meetup] [--seed cw1] [--repeats 1]
//        [--out .local/bench/meetup/<stamp>] [--root <checkout>] [--port 4400] [--range 4401-4430] [--heap-mb 2048]
//        [--host-class laptop] [--quiet-host] [--short] [--browser] [--join-concurrency 4]
//        [--active-min 20] [--warmup-min 10] [--telemetry]
//
// --short: the same shape with 1 min quiet / 3 min activity (a smoke, never a measuring window).
// --quiet-host: the operator asserts the host runs nothing else; without it every number is labelled not-quiet.
// --browser: one real browser (Playwright Chromium, headless) holds world 0's page for the whole run.
// --active-min N (CW8 A2, #955): an activity window of N minutes (20-240; default 20, the CW2 schedule unchanged), the same
//   per-Soul rates, the meetups repeated in every 20-min block. --warmup-min: the start of the window the growth trends
//   leave out (default 10). --telemetry: run the launcher's telemetry collector beside it, into <run>/telemetry.
// Per run: <out>/<profile>-r<k>/{receipt.json, ops.jsonl, samples.jsonl, result.json, REPORT.md, launcher/, souls/}.
// The receipt holds no host name, user, home path or token; souls/ holds tokens and stays local (.local is ignored).
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, loadavg, platform, arch, release, totalmem } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { FIXTURES, PROFILES, DEMAND, TICK_HZ, WORKLOAD, LOAD_FAILURES, phases, souls as soulsOf, schedule, scheduleId, scheduleCounts, account, outcomeOf, quantiles, clockWindow, rng } from './workload.mjs';
import { report, verdictReport, OBJECTIVES } from './report.mjs';
import { probe, threads, between, hotThreads, resourceSample } from './host.mjs';
import { verdict, headroom, evidence } from './verdict.mjs';
import { growth as growthOf } from './growth.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; }, flag = (k) => argv.includes(`--${k}`);
const ROOT = resolve(opt('root', new URL('../../../..', import.meta.url).pathname)), SHORT = flag('short'), SEED = opt('seed', 'cw1');
const PORT = Number(opt('port', 4400)), RANGE = opt('range', `${PORT + 1}-${PORT + 30}`), HEAP_MB = Number(opt('heap-mb', 2048));
const PROFILE_LIST = opt('profile', 'even,meetup').split(','), REPEATS = Number(opt('repeats', 1)), JOIN_PAR = Number(opt('join-concurrency', 4));
const HOST_CLASS = opt('host-class', 'laptop'), QUIET = flag('quiet-host'), BROWSER = flag('browser');
// --qualifying-executor: the operator asserts this is the isolated production-class executor (#736); with --quiet-host,
// a full-length run, both profiles and two repeats, the verdict may say `passes`. Nothing else ever can.
const QUALIFYING = flag('qualifying-executor');
// --slice "<prefix>": run the launcher (so its worlds) under this command, e.g. a systemd-run scope with CPU and memory
// limits; the driver stays outside the allocation. Recorded in the receipt.
const SLICE = opt('slice', '');
const OUT = resolve(opt('out', join(ROOT, '.local/bench/meetup', new Date().toISOString().replace(/[:.]/g, '-'))));
if (flag('active-min') && !/^\d+$/.test(opt('active-min') ?? '')) throw new Error('--active-min needs whole minutes, 20 to 240');
const ACTIVE_MIN = flag('active-min') ? Number(opt('active-min')) : null, WARMUP_MS = Number(opt('warmup-min', 10)) * 60_000, TELEMETRY = flag('telemetry');
if (!(WARMUP_MS >= 0)) throw new Error('--warmup-min: minutes, 0 or more');
const PH = phases(SHORT, ACTIVE_MIN), WARM_MS = SHORT ? 20_000 : 60_000, DRAIN_MS = 30_000, BASE = `http://127.0.0.1:${PORT}`;
for (const p of PROFILE_LIST) if (!PROFILES[p]) throw new Error(`--profile ${p}: even | meetup`);
const { SOUL_CEILINGS } = await import(pathToFileURL(join(ROOT, 'tools/world-launcher/flood.mjs')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const mono = () => performance.now();
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const rel = (p) => relative(ROOT, p) || '.';
const clean = (t) => String(t).split(ROOT).join('.');   // error text in results: repository-relative paths only
mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); appendFileSync(join(OUT, 'meetup.log'), s + '\n'); };

// ------------------------------------------------------------------ preflight: what the worlds need to boot
const MARS_WEB = join(ROOT, 'mars/viewer/dist'), KIT = join(ROOT, 'apps/web/dist/kit-contract.json');
for (const [p, fix] of [[MARS_WEB, 'pnpm build:viewer'], [KIT, 'pnpm --filter @sim/web build']]) if (!existsSync(p)) throw new Error(`missing ${rel(p)}: run \`${fix}\` in the checkout (templates with kit contract 2 refuse genesis without it)`);

// ------------------------------------------------------------------ host and process facts (no names, users or paths)
const CLK_TCK = Number(sh('getconf', ['CLK_TCK']) ?? 100) || 100;
function procStats(pids) {   // {pid: {cpuS, rssMb}}
  const out = {};
  for (const pid of pids) {
    try {
      const st = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '), rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
      out[pid] = { cpuS: (Number(st[11]) + Number(st[12])) / CLK_TCK, rssMb: rss ? Number(rss[1]) / 1024 : null };
    } catch { /* not Linux: ps below */ }
  }
  const rest = pids.filter((p) => !out[p]);
  if (rest.length) for (const line of (sh('ps', ['-o', 'pid=,time=,rss=', '-p', rest.join(',')]) ?? '').split('\n')) {
    const [pid, t, rss] = line.trim().split(/\s+/); if (!pid) continue;
    const parts = t.replace(/^(\d+)-/, (_, d) => `${d * 24}:`).split(':').map(Number);
    out[pid] = { cpuS: parts.reduce((s, x) => s * 60 + x, 0), rssMb: Number(rss) / 1024 };
  }
  return out;
}
const RES_EVERY_MS = 30_000;   // CW8 A2 (#955): resourceSample (host.mjs) cadence
const otherSouls = (own) => (sh('pgrep', ['-f', 'apps/server/src/main.ts']) ?? '').split('\n').map(Number).filter((p) => p && !own.includes(p)).length;
const hostFacts = () => ({ loadavg: loadavg().map((x) => +x.toFixed(2)), freeMemMb: Math.round(freemem() / 2 ** 20) });

// ------------------------------------------------------------------ the launcher with ten worlds
function children(ldata) { try { return JSON.parse(readFileSync(join(ldata, 'children.json'), 'utf8')); } catch { return {}; } }
async function getJ(url, { headers = {}, ms = 5000 } = {}) {
  const t = mono();
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) }); return { status: r.status, j: await r.json().catch(() => null), rttMs: mono() - t, headers: r.headers }; }
  catch { return { status: 0, j: null, rttMs: mono() - t }; }
}
const LAUNCHER_ENV = { SIM_UNWATCHED_PACE: '1', SIM_WORLD_IDLE_EXIT_MIN: '0', SIM_PREWARM: '0' };
const LAUNCHER_ARGS = (ldata) => ['--port', String(PORT), '--data', ldata, '--range', RANGE, '--public-origin', `http://localhost:${PORT}`, '--world-heap-mb', String(HEAP_MB),
  '--mars-web', MARS_WEB, '--eager', String(FIXTURES.length), '--max-running', String(FIXTURES.length), '--sleep-ms', '0'];
async function bootLauncher(dir, run) {
  // a launcher already on the port would silently take the run's place: refuse instead
  if ((await getJ(`${BASE}/__sim/healthz`, { ms: 2000 })).status !== 0) throw new Error(`port ${PORT} is already serving; stop that launcher or pass --port`);
  const ldata = join(dir, 'launcher'); mkdirSync(ldata, { recursive: true });
  const rows = FIXTURES.map((f) => ({ slug: f.slug, name: `Meetup ${f.slug}`, template: f.template, port: null, createdAt: 0, unlisted: true, worldHeapMb: HEAP_MB }));
  writeFileSync(join(ldata, 'worlds.json'), JSON.stringify({ schema: 'world-launcher-registry/1', worlds: rows }, null, 2) + '\n');
  // no Eyes, no model keys, no secrets reach the launcher (its children never inherit the rest anyway)
  const env = { ...process.env, ...LAUNCHER_ENV }; for (const k of Object.keys(env)) if (k.startsWith('EDGE_EYES') || /KEY|TOKEN|SECRET/.test(k)) delete env[k];
  const cmd = [...(SLICE ? SLICE.split(/\s+/) : []), process.execPath, join(ROOT, 'tools/world-launcher/launcher.mjs'), ...LAUNCHER_ARGS(ldata)];
  const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  run.launcher = { child, ldata };   // owned from now on: an interrupt during boot stops it too
  child.stdout.on('data', (b) => appendFileSync(join(dir, 'launcher.log'), b)); child.stderr.on('data', (b) => appendFileSync(join(dir, 'launcher.log'), b));
  const t0 = mono(), up = new Map();
  while (up.size < FIXTURES.length && mono() - t0 < 900_000) {
    if (child.exitCode != null) throw new Error(`launcher exited at boot (${child.exitCode}); see ${rel(join(dir, 'launcher.log'))}`);
    for (const f of FIXTURES) if (!up.has(f.slug)) { const h = await getJ(`${BASE}/w/${f.slug}/healthz`, { ms: 3000 }); if (h.status === 200 && h.j?.ok) up.set(f.slug, +((mono() - t0) / 1000).toFixed(1)); }
    if (up.size < FIXTURES.length) await sleep(1000);
  }
  if (up.size < FIXTURES.length) throw new Error(`worlds not up after 15 min: ${FIXTURES.filter((f) => !up.has(f.slug)).map((f) => f.slug).join(', ')}`);
  return Object.assign(run.launcher, { bootS: Object.fromEntries(up) });
}
function adminRate(ldata, slug) {   // the configured admin rate, from the world's own database (read-only)
  const py = "import sqlite3,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nprint(','.join(str(r[0]) for r in c.execute('select clock_rate from worlds')))";
  const v = sh('python3', ['-c', py, join(ldata, 'worlds', slug, 'sim.db')]);
  const rates = (v ?? '').split(',').filter((x) => x.trim() !== '').map(Number).filter(Number.isFinite);
  return rates.length === 1 ? rates[0] : null;
}
async function launcherView() {
  const d = (await getJ(`${BASE}/__sim/health?json=1`)).j;
  return Object.fromEntries((d?.worlds ?? []).filter((x) => FIXTURES.some((f) => f.slug === x.slug)).map((x) => [x.slug, { status: x.status, restarts: x.restarts ?? 0, refused: x.refused ?? null, lastExit: x.lastExit ?? null }]));
}
async function stopAll(run) {
  run.stopped = true;
  // the telemetry collector is told first (it checks for a stop after each 15 s scrape) and awaited after the launcher
  const T = run.telemetry; let telemetry = null; try { T?.kill('SIGTERM'); } catch { /* gone */ }
  for (const ws of run.sockets) try { ws.close(); } catch { /* closed */ }
  for (const a of [...run.aborts, ...run.opAborts]) try { a.abort(); } catch { /* done */ }
  for (const p of run.procs ?? []) try { p.kill('SIGKILL'); } catch { /* gone */ }   // CLI calls still in flight (join)
  const browserPid = run.browser?.process?.()?.pid ?? null;
  try { await run.browser?.close(); } catch { /* gone */ }
  const L = run.launcher; if (!L) return null;
  const pids = Object.values(children(L.ldata)).map((k) => k.pid).filter(Boolean);
  try { L.child.kill('SIGTERM'); } catch { /* gone */ }
  for (let i = 0; i < 60 && L.child.exitCode == null; i++) await sleep(500);
  const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
  for (let i = 0; i < 20 && pids.some(alive); i++) await sleep(500);
  const survivors = pids.filter(alive); for (const p of survivors) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
  if (L.child.exitCode == null) try { L.child.kill('SIGKILL'); } catch { /* gone */ }
  if (T) { for (let i = 0; i < 40 && T.exitCode == null && T.signalCode == null; i++) await sleep(500);   // up to 20 s, then SIGKILL
    const killed = T.exitCode == null && T.signalCode == null; if (killed) try { T.kill('SIGKILL'); } catch { /* gone */ }
    telemetry = { exitCode: T.exitCode, signal: T.signalCode, killed, earlyExit: run.telemetryEarlyExit ?? null }; }
  await sleep(1000);
  // the recorded world pids, the launcher, the browser and any process still naming this run's data are checked again
  // after the kill (world processes get their data dir from the environment, so the pid list is the real check)
  const owned = [...pids, L.child.pid, ...(browserPid ? [browserPid] : []), ...(T?.pid ? [T.pid] : [])].filter(alive), named = (sh('pgrep', ['-f', L.ldata]) ?? '').split('\n').filter(Boolean).length;
  return { launcherExited: L.child.exitCode != null, launcherExitCode: L.child.exitCode, worldPids: pids.length, survivedSigterm: survivors.length, browserPid: !!browserPid, ownedAliveAfter: owned.length, straysAfter: owned.length + named, ...(telemetry ? { telemetry } : {}) };
}

// ------------------------------------------------------------------ Souls: join with the CLI, then raw HTTP with its etiquette
function runCli(dir, args, ms, procs) {
  return new Promise((done) => {
    const t = mono(), p = spawn(process.execPath, ['eden.mjs', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }); procs?.add(p);
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-1000); }); p.stdout.resume();
    const k = setTimeout(() => p.kill('SIGKILL'), ms);
    p.on('exit', (code) => { clearTimeout(k); procs?.delete(p); done({ code, ms: Math.round(mono() - t), err: clean(err.trim().split('\n').at(-1) ?? '').slice(0, 200) }); });
  });
}
async function joinSoul(run, s) {
  const dir = join(run.dir, 'souls', `s${s.i}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'eden.mjs'), Buffer.from(await (await fetch(`${BASE}/w/${s.slug}/eden.mjs`)).arrayBuffer()));
  // the account grouping: Souls of one account share the CLI's dev identity (one person, several Souls)
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ identity: `agent-${createHash('sha256').update(`${SEED}|${s.account}`).digest('hex').slice(0, 24)}` }) + '\n', { mode: 0o600 });
  const t0 = mono(), tries = [];
  tries.push({ cmd: 'register', ...(await runCli(dir, ['register', `http://localhost:${PORT}/w/${s.slug}`], 60_000, run.procs)) });
  const token = () => { try { return JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8')).token ?? null; } catch { return null; } };
  // the same name on every try until the folder holds a token or 120 s pass (Soul CLI 2.5.3 resumes its own create)
  while (!token() && mono() - t0 < 120_000) { tries.push({ cmd: 'create', ...(await runCli(dir, ['create', `Meet${s.i}`], 150_000, run.procs)) }); if (!token()) await sleep(2000); }
  s.token = token(); try { s.soulId = JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8')).soul ?? null; } catch { s.soulId = null; }
  s.joinMs = Math.round(mono() - t0); s.joinTries = tries.map(({ cmd, code, ms, err }) => ({ cmd, code, ms, ...(code ? { err } : {}) }));
  return s;
}
const headersOf = (s) => ({ authorization: `Bearer ${s.token}`, 'content-type': 'application/json', 'x-forwarded-for': s.address });
const BUSY = /\b(world\.busy|world\.crowded|world\.starting|soul\.busy|soul\.slow-down|rate-limited|client\.rate|account\.rate)\b/;
function refusalTag(code, d) { return `${d?.slug ? 'launcher' : 'world'}:${code}`; }
const RESOLVE = ['sit down', 'wave', 'look around', 'go for a walk'], LOOK = ['look left', 'look right'], GESTURE = ['wave', 'nod', 'clap', 'cheer', 'bow'];
function requestOf(run, s, op) {
  const W = run.worlds[s.world], act = (capability) => ['POST', '/v1/edge/act', { capability, params: {}, clientRef: `${run.id}-${op.id}` }];
  switch (op.kind) {
    case 'observe': return ['GET', '/v1/edge/observe'];
    case 'here': return ['GET', '/v1/edge/here?include=doHere'];
    case 'capabilities': return ['GET', '/v1/edge/capabilities'];
    case 'resolve': return ['POST', '/v1/edge/resolve', { capability: RESOLVE[op.pick % RESOLVE.length], params: {} }];
    case 'walk': return act(`walk:${W.places[op.pick % W.places.length]}`);
    case 'meetup': return act(`walk:${W.meetup}`);
    case 'attention': return act(LOOK[op.pick % LOOK.length]);
    case 'gesture': return act(GESTURE[op.pick % GESTURE.length]);
    case 'stand': return act('stand');
    case 'shared': { const mates = run.souls.filter((x) => x.world === s.world && x.i !== s.i && x.soulId), m = mates.find((x) => x.k > s.k) ?? mates[0];
      const verbs = W.sharedVerbs.length ? W.sharedVerbs : DEMAND.sharedVerbs;
      return act(m ? `${verbs[op.pick % verbs.length]}:${m.soulId}` : 'wave'); }
    case 'accept': return act(op.capability);
    case 'say': return ['POST', '/v1/edge/say', { text: 'hello from the meetup workload' }];
    default: throw new Error(`op kind ${op.kind}`);
  }
}
// One call with the CLI's etiquette: up to 3 waits of a designed busy answer's Retry-After, up to 6 tries with full
// jitter when nothing answers; deadline 60 s for a read, 90 s for an act. Every wait is inside the call's time.
async function perform(run, s, op, jitter) {
  const [method, path, body] = requestOf(run, s, op), deadline = op.cls === 'act' ? 90_000 : 60_000, t = mono(), ac = new AbortController(); run.opAborts.add(ac);
  const headers = { ...headersOf(s), ...(op.kind === 'say' ? { 'idempotency-key': `${run.id}-${op.id}` } : {}) };
  let status = 0, code = null, d = null, busy = 0, failed = 0, waitMs = 0; const refusals = [];
  try {
    for (;;) {
      const left = deadline - (mono() - t); if (left <= 0 || run.cut) { status = -1; break; }
      try {
        const r = await fetch(`${BASE}/w/${s.slug}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([ac.signal, AbortSignal.timeout(Math.min(left, 40_000))]) });
        d = await r.json().catch(() => null); status = r.status; code = d?.error?.code ?? d?.code ?? null;
        if ((status === 429 || status === 503) && BUSY.test(String(code))) {
          refusals.push(refusalTag(code, d));
          if (busy < 3) { busy++; const ra = Number(r.headers.get('retry-after')), w0 = mono(); await sleep(Math.min(left, (ra > 0 ? ra * 1000 : 1000 * 2 ** busy) * (1 + 0.2 * jitter()))); waitMs += mono() - w0; continue; }
        }
        break;
      } catch {
        if (mono() - t >= deadline || run.cut) { status = -1; break; }
        if (++failed >= 6) { status = 0; break; }
        await sleep(Math.min(deadline - (mono() - t), jitter() * Math.min(60_000, 1000 * 2 ** (failed - 1))));
      }
    }
  } finally { run.opAborts.delete(ac); }
  const accepted = op.kind === 'resolve' ? d?.resolve?.ok : d?.accepted;
  const rec = { ...(body?.capability && op.cls === 'act' ? { capability: body.capability.replace(/:s_[\w-]+$/, ':<soul>') } : {}), status, outcome: outcomeOf({ status, code, accepted }), ...(busy ? { busyWaits: busy, waitMs: Math.round(waitMs) } : {}), ...(failed ? { netFailures: failed } : {}), ...(refusals.length ? { refusals } : {}) };
  if (rec.outcome === 'gameplay-refused') { rec.code = d?.code ?? d?.resolve?.code ?? null; rec.reason = clean(String(d?.reason ?? d?.resolve?.reason ?? '')).replace(/s_[\w-]+/g, '<soul>').slice(0, 160); }
  if (rec.outcome === 'error') rec.code = `${status} ${code ?? ''}`.trim();
  if (d?.receipt?.id) { rec.receipt = d.receipt.id; rec.phase = d.receipt.phase; }
  return rec;
}
// The Soul's one event stream (/v1/edge/wait: speech, arrivals and its receipt.* phases with server tick and time)
function holdStream(run, s) {
  (async () => {
    let cursor = 'c_0', attempt = 0;
    while (!run.stopped) {
      const ac = new AbortController(); run.aborts.add(ac);
      try {
        const r = await fetch(`${BASE}/w/${s.slug}/v1/edge/wait?timeout=50&after=${encodeURIComponent(cursor)}`, { headers: headersOf(s), signal: AbortSignal.any([ac.signal, AbortSignal.timeout(65_000)]) });
        const d = await r.json().catch(() => ({})), recv = Date.now();   // same clock as the server's event `at`
        run.stream.responses++; if (r.status !== 200) run.stream.non200[r.status] = (run.stream.non200[r.status] ?? 0) + 1;
        if (d?.gap) run.stream.gaps++;
        if (Array.isArray(d?.events)) { run.stream.events += d.events.length; if (d.events.length) run.stream.batches.push(d.events.length); }
        for (const e of d?.events ?? []) if (e.kind === 'invite' && e.invite?.accept && run.marks.active && !run.cut) {
          // reactive demand: this Soul accepts the invitation from its own stream, in arrival order, one call at a time
          const atMs = Math.round(mono() - run.marks.active); s.reactive.push({ id: `s${s.i}-r${s.reactive.n++}`, soul: s.i, world: s.world, cls: 'act', kind: 'accept', capability: e.invite.accept, atMs, burst: null, reactive: true, delivery: Math.round(recv - e.at) });
        } else if (e.kind === 'receipt' && e.receipt?.id) {
          let x = run.receipts.get(e.receipt.id); if (!x) run.receipts.set(e.receipt.id, x = { soul: s.i, events: [] });
          x.events.push({ phase: e.receipt.phase, at: e.at, tick: e.tick, recv, startedTick: e.receipt.startedTick, endedTick: e.receipt.endedTick, code: e.receipt.code });
        }
        cursor = d?.cursor ?? cursor;
        if (r.status === 429 || r.status >= 500) { const ra = Number(r.headers.get('retry-after')); await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** Math.min(5, attempt++)); } else attempt = 0;
      } catch { if (!run.stopped) { run.stream.failures++; await sleep(1000 * 2 ** Math.min(5, attempt++)); } }
      finally { run.aborts.delete(ac); }
    }
  })();
}
async function viewerHello() {
  try { const { anonymousHello } = await import(pathToFileURL(join(ROOT, 'packages/client/src/hello.ts')).href); return anonymousHello(false); } catch { return JSON.stringify({ t: 'hello' }); }
}
function viewer(run, slug, hello) {   // one lightweight viewer subscription per world
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/w/${slug}/ws`), v = run.viewers[slug] ??= { opens: 0, closes: 0, bytes: 0, messages: 0 };
  ws.onopen = () => { v.opens++; try { ws.send(hello); } catch { /* closed */ } };
  ws.onmessage = (m) => { v.messages++; v.bytes += typeof m.data === 'string' ? m.data.length : m.data.byteLength ?? m.data.size ?? 0; };
  ws.onclose = () => { v.closes++; if (!run.stopped) setTimeout(() => viewer(run, slug, hello), 2000); };
  run.sockets.push(ws);
}
async function realBrowser(run) {   // the one real-browser path: world 0's page, held for the run, screenshots at phase marks
  try {
    // the playtest harness's own resolver (a global playwright, else mars/viewer's) and Chromium args
    const pf = await import(pathToFileURL(join(ROOT, 'tools/playtest/lib/platform.mjs')).href), pw = pf.resolvePlaywright(); pf.browsersPath();
    if (!pw) throw new Error('no Playwright found (tools/playtest/lib/platform.mjs resolvePlaywright)');
    const b = run.browser = await pw.chromium.launch({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, args: pf.launchArgs({ gpu: 'swiftshader' }).args }), page = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const st = run.browserStats = { ws: 0, frames: 0, bytes: 0, errors: 0, shots: [] };
    page.on('websocket', (ws) => { st.ws++; ws.on('framereceived', (f) => { st.frames++; st.bytes += f.payload?.length ?? 0; }); });
    page.on('pageerror', () => { st.errors++; });
    await page.goto(`http://localhost:${PORT}/w/${FIXTURES[0].slug}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    run.shot = async (name) => { try { const f = join(run.dir, 'browser', `${name}.png`); mkdirSync(join(run.dir, 'browser'), { recursive: true }); await page.screenshot({ path: f }); st.shots.push(name); } catch { /* best effort */ } };
    return { ok: true };
  } catch (e) { run.browserStats = { unavailable: clean(String(e.message).split('\n')[0]).slice(0, 200) }; return { ok: false }; }
}

// ------------------------------------------------------------------ one run
async function oneRun(profile, rep) {
  const dir = join(OUT, `${profile}-r${rep}`); mkdirSync(dir, { recursive: true });
  const ss = soulsOf(profile).map((s) => Object.assign(s, { reactive: Object.assign([], { n: 0 }) })), ops = schedule(profile, SEED, PH), opsBySoul = ss.map((s) => ops.filter((o) => o.soul === s.i));
  const run = { id: createHash('sha256').update(`${SEED}|${profile}|${rep}|${Date.now()}`).digest('hex').slice(0, 10), dir, stopped: false, cut: false, sockets: [], procs: new Set(), aborts: new Set(), opAborts: new Set(), viewers: {},
    souls: ss, receipts: new Map(), stream: { responses: 0, events: 0, batches: [], gaps: 0, failures: 0, non200: {} }, worlds: [], samples: [], marks: {}, epochs: {}, probes: {} };
  const tag = `${profile} r${rep}`, mark = (name) => { run.marks[name] = mono(); run.epochs[name] = Date.now(); log(`${tag}: ${name}`);
    // the allocation the worlds live in (the launcher's cgroup; its children share it) and each world's threads, per mark
    if (run.launcher) { const k = children(run.launcher.ldata); run.probes[name] = { t: mono(), alloc: probe(run.launcher.child.pid), driver: probe('self'),
      threads: Object.fromEntries(FIXTURES.map((f) => [f.slug, k[f.slug]?.pid ? threads(k[f.slug].pid) : null])) }; } };
  const receipt = {
    workload: WORKLOAD, profile, rep, seed: SEED, short: SHORT, at: new Date().toISOString(),
    measurement: { hostClass: HOST_CLASS, quiet: QUIET, label: QUIET ? 'operator-declared quiet host' : 'not-quiet', qualifyingExecutor: QUALIFYING, qualifies: QUALIFYING && QUIET && !SHORT,
      why: QUALIFYING && QUIET && !SHORT ? 'operator-declared quiet qualifying executor; the verdict also needs both profiles twice' : 'qualifying numbers come from #736 on the isolated production-class executor (--qualifying-executor --quiet-host), two matched repeats' },
    source: { sha: sh('git', ['-C', ROOT, 'rev-parse', 'HEAD']), dirty: !!sh('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no']), node: process.version, cliVersion: /const VERSION = "([^"]+)"/.exec(readFileSync(join(ROOT, 'tools/world-launcher/soul/eden.mjs'), 'utf8'))?.[1] ?? null },
    host: { os: `${platform()} ${release()}`, arch: arch(), cpu: cpus()[0]?.model ?? null, cores: cpus().length, memGb: Math.round(totalmem() / 2 ** 30) },
    fixtures: FIXTURES.map((f, w) => { const p = join(ROOT, 'worlds/templates', `${f.template}.json`), t = JSON.parse(readFileSync(p, 'utf8'));
      return { slug: f.slug, template: f.template, sha256: sha256(p), bytes: readFileSync(p).length, batches: t.batches?.length ?? 0, souls: PROFILES[profile][w] }; }),
    configuration: { launcherEnv: LAUNCHER_ENV, launcherArgs: LAUNCHER_ARGS('<run>/launcher').map((a) => (a.startsWith(ROOT) ? rel(a) : a)), heapMb: HEAP_MB, slice: SLICE || null, soulCeilings: SOUL_CEILINGS, auth: 'dev identities (DEV_AUTH=1, the launcher default without --auth-env)', brain: 'BRAIN_MODE=fake (launcher child default)', eyes: 'off (EDGE_EYES* removed from the launcher environment)',
      telemetry: TELEMETRY ? 'the launcher\'s collector (tools/world-launcher/telemetry.mjs collect) on its loopback /__sim/metrics, every 15 s, into <run>/telemetry' : 'off (--telemetry)',
      resources: { everyS: RES_EVERY_MS / 1000, growthWarmupMs: WARMUP_MS } },
    workloadDefinition: { demand: DEMAND, phases: { joinThenWarmMs: WARM_MS, ...PH }, scheduleSha256: scheduleId(ops), counts: scheduleCounts(ops),
      accounts: Object.entries(ss.reduce((m, s) => (m[s.account] = (m[s.account] ?? 0) + 1, m), {})).filter(([, n]) => n > 1).map(([a, n]) => ({ account: a, souls: n })),
      sharedAddresses: Object.entries(ss.reduce((m, s) => (m[s.address] = (m[s.address] ?? 0) + 1, m), {})).filter(([, n]) => n > 1).map(([a, n]) => ({ address: a, souls: n })) },
    coverage: { streamPerSoul: '/v1/edge/wait long-poll (receipt.*, speech, arrivals); the owner-message listen (inbox/listen) is not held: the workload sends no owner messages',
      viewers: `${FIXTURES.length} anonymous WebSocket viewers, one per world`, realBrowser: BROWSER ? 'Playwright Chromium, headless, world 0' : 'not run (--browser)',
      imageRendering: 'not exercised: Eyes off; renderer CPU/RSS and render latency are an unqualified capability for #736',
      legs: 'loopback HTTP and WebSocket through the launcher proxy (dev auth); TLS, the public proxy, Clerk sign-in and the real network are not exercised. The launcher runs with --public-origin http://localhost:<port> while listening on 127.0.0.1, so it applies its behind-a-proxy rules: the per-Soul X-Forwarded-For addresses are honoured and the per-address ceilings apply, as in production behind the proxy',
      sharedActions: 'invitations (high-five, handshake, hug, dance-with) to the next Soul in the same world, accepted by that Soul\'s driver from its own stream as reactive demand',
      notCovered: ['god authoring/import/export', 'travel between worlds', 'conversations (converse) and plans'] },
  };
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt, null, 1));
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const cpu0 = process.cpuUsage(), otherBefore = otherSouls([]), host0 = hostFacts();
  let cleanup = null;
  let stopping = false;   // a second Ctrl-C does not cut the cleanup short
  const onSig = async () => { if (stopping) return; stopping = true; log(`${tag}: interrupted; stopping owned processes`); cleanup = await stopAll(run); writeFileSync(join(dir, 'cleanup.json'), JSON.stringify(cleanup)); process.exit(130); };
  process.on('SIGINT', onSig); process.on('SIGTERM', onSig);
  try {
    mark('boot');
    await bootLauncher(dir, run); mark('up');
    const kids = () => children(run.launcher.ldata), ownPids = () => FIXTURES.map((f) => kids()[f.slug]?.pid).filter(Boolean);
    const rates = Object.fromEntries(FIXTURES.map((f) => [f.slug, adminRate(run.launcher.ldata, f.slug)]));
    log(`${tag}: ten worlds up (${JSON.stringify(run.launcher.bootS)}); admin rates ${JSON.stringify(rates)}`);
    // samplers: per-world /healthz every second (tick + monotonic time + round trip), processes every 2 s, host every 5 s
    const write = (x) => { run.samples.push(x); appendFileSync(join(dir, 'samples.jsonl'), JSON.stringify(x) + '\n'); };
    const hz = setInterval(() => { for (const f of FIXTURES) getJ(`${BASE}/w/${f.slug}/healthz`, { ms: 5000 }).then((h) => { const t = mono() - h.rttMs / 2;
      write({ k: 'hz', w: f.slug, t: Math.round(t), rttMs: Math.round(h.rttMs), ok: h.status === 200 && !!h.j?.ok, tick: h.j?.tick, clockRate: h.j?.clockRate, paused: h.j?.paused, level: h.j?.load?.level, tickP99Ms: h.j?.load?.tickP99Ms, queue: h.j?.load?.queue?.depth, loopP99Ms: h.j?.load?.loopP99Ms }); }); }, 1000);
    const pr = setInterval(() => { const k = kids(), pids = [run.launcher.child.pid, ...ownPids()], st = procStats(pids);
      write({ k: 'proc', t: Math.round(mono()), launcher: st[run.launcher.child.pid] ?? null, worlds: Object.fromEntries(FIXTURES.map((f) => [f.slug, k[f.slug]?.pid ? { pid: k[f.slug].pid, ...(st[k[f.slug].pid] ?? {}) } : null])),
        driver: { cpuS: +((process.cpuUsage().user + process.cpuUsage().system) / 1e6).toFixed(2), rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), lagP99Ms: +(lag.percentile(99) / 1e6).toFixed(1), lagMaxMs: +(lag.max / 1e6).toFixed(1) } }); lag.reset(); }, 2000);
    const ho = setInterval(() => { const a = probe(run.launcher.child.pid);
      write({ k: 'host', t: Math.round(mono()), ...hostFacts(), cgroupMemMb: a.memoryCurrentMb, cgroupSwapMb: a.swapCurrentMb, psiCpuSome10: a.pressure.cpu?.some?.avg10 ?? null, psiMemSome10: a.pressure.memory?.some?.avg10 ?? null }); }, 5000);
    // resources (CW8 A2): heap, GC, queue, threads and disk per world every 30 s, from the world's own files and /proc
    const rs = setInterval(() => { const k = kids(), st = procStats(ownPids());
      write({ k: 'res', t: Math.round(mono()), ...resourceSample({ ldata: run.launcher.ldata, worlds: FIXTURES.map((f) => ({ slug: f.slug, pid: k[f.slug]?.pid ?? null, rssMb: st[k[f.slug]?.pid]?.rssMb ?? null })), telemetryDir: TELEMETRY ? join(dir, 'telemetry') : null }) }); }, RES_EVERY_MS);
    run.timers = [hz, pr, ho, rs];
    if (TELEMETRY) {   // the collector reads the launcher's Prometheus text, built from live.json: it never wakes a world
      const t = spawn(process.execPath, [join(ROOT, 'tools/world-launcher/telemetry.mjs'), 'collect', '--url', `${BASE}/__sim/metrics`, '--dir', join(dir, 'telemetry')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      t.stdout.on('data', (b) => appendFileSync(join(dir, 'telemetry.log'), b)); t.stderr.on('data', (b) => appendFileSync(join(dir, 'telemetry.log'), b)); run.telemetry = t;
      t.on('exit', (code, signal) => { if (!run.stopped) { run.telemetryEarlyExit = { code, signal, atS: +((mono() - run.marks.boot) / 1000).toFixed(1) }; log(`${tag}: telemetry collector exited early (${code ?? signal}); see telemetry.log`); } });
    }
    // join (timed, not a measuring window)
    mark('join');
    for (let i = 0; i < ss.length; i += JOIN_PAR) await Promise.all(ss.slice(i, i + JOIN_PAR).map((s) => joinSoul(run, s)));
    const missing = ss.filter((s) => !s.token);
    log(`${tag}: joined ${ss.length - missing.length}/${ss.length} Souls${missing.length ? ` (missing ${missing.map((s) => s.i).join(',')})` : ''}`);
    // per world: the meetup place and walk targets, from a joined Soul's own menu (setup reads, not measured)
    for (const [w, f] of FIXTURES.entries()) {
      const s = ss.find((x) => x.world === w && x.token), r = rng(`${SEED}|${f.slug}|places`);
      const caps = s ? (await getJ(`${BASE}/w/${f.slug}/v1/edge/capabilities?all=1`, { headers: headersOf(s), ms: 60_000 })).j?.capabilities ?? [] : [];
      const places = caps.filter((c) => c.verb === 'walk' && c.available && c.id.startsWith('walk:')).map((c) => c.id.slice(5)).sort();
      const pick = Array.from({ length: Math.min(8, places.length) }, () => places[Math.floor(r() * places.length)]);
      // shared actions this world offers (its menu's verbs); a template without them falls back to the full list, and
      // the world's refusal is then a classified gameplay refusal
      const verbs = new Set(caps.map((c) => c.verb)), sharedVerbs = DEMAND.sharedVerbs.filter((v) => verbs.has(v));
      run.worlds[w] = { slug: f.slug, sharedVerbs, placesInMenu: places.length, places: pick.length ? pick : ['here'], meetup: places.length ? places[Math.floor(r() * places.length)] : 'here' };
    }
    const hello = await viewerHello();
    for (const s of ss) if (s.token) holdStream(run, s);
    for (const f of FIXTURES) viewer(run, f.slug, hello);
    const browser = BROWSER ? await realBrowser(run) : null;
    mark('warm'); await sleep(WARM_MS);
    mark('quiet'); await run.shot?.('quiet'); await sleep(PH.quietMs);
    // activity: the fixed schedule, one call at a time per Soul, in order; late calls are overdue, never dropped
    const views = { beforeActive: await launcherView() };
    mark('active'); const t0 = run.marks.active, records = [], reactive = []; run.reactiveRecords = reactive;
    const opsFile = join(dir, 'ops.jsonl');
    const shots = PH.meetupsMs.map((m, b) => setTimeout(() => run.shot?.(`meetup${b + 1}`), m + 2500));
    const loops = ss.filter((s) => s.token).map(async (s) => {
      const jitter = rng(`${SEED}|jitter|${s.i}`), closed = () => mono() - t0 >= PH.activeMs || run.cut;
      const send = async (op) => {
        const issuedAt = mono() - t0, r = await perform(run, s, op, jitter), doneAt = mono() - t0;
        const rec = { id: op.id, soul: s.i, world: s.world, kind: op.kind, cls: op.cls, burst: op.burst, atMs: op.atMs, issuedAt: Math.round(issuedAt), doneAt: Math.round(doneAt), ...(op.reactive ? { reactive: true, inviteDeliveryMs: op.delivery } : {}), ...r };
        (op.reactive ? reactive : records).push(rec); appendFileSync(opsFile, JSON.stringify(rec) + '\n');
      };
      for (const op of opsBySoul[s.i]) {
        // invitations this Soul received go first, in arrival order; the scheduled call waits for its time
        for (;;) { while (s.reactive.length && !closed()) await send(s.reactive.shift()); const left = t0 + op.atMs - mono(); if (left <= 0 || closed()) break; await sleep(Math.min(250, left)); }
        if (closed()) return;   // the window closed: the rest of this Soul's queue is unissued
        await send(op);
      }
      while (!closed()) { while (s.reactive.length && !closed()) await send(s.reactive.shift()); await sleep(250); }
    });
    await sleep(PH.activeMs);
    mark('drain');
    await Promise.race([Promise.all(loops), sleep(DRAIN_MS)]); run.cut = true; for (const a of run.opAborts) try { a.abort(); } catch { /* done */ }
    await Promise.race([Promise.all(loops), sleep(5000)]);
    await run.shot?.('end');
    views.afterActive = await launcherView();
    for (const t of run.timers) clearInterval(t); shots.forEach(clearTimeout);
    const cpu1 = process.cpuUsage(cpu0), driverCpuS = (cpu1.user + cpu1.system) / 1e6, host1 = hostFacts();
    cleanup = await stopAll(run); const otherAfter = otherSouls([]);   // after the stop: none of these are ours
    const result = summarize({ profile, rep, ss, ops, records, run, rates, views, cleanup, browser, driverCpuS, load: { before: host0, after: host1, otherSoulsProcessesBefore: otherBefore, otherSoulsProcessesAfter: otherAfter } });
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 1));
    writeFileSync(join(dir, 'REPORT.md'), report(receipt, result));
    log(`${tag}: done; ${JSON.stringify(result.headline)}`);
    return result;
  } catch (e) {
    log(`${tag}: FAILED ${e.message}`);
    for (const t of run.timers ?? []) clearInterval(t);
    cleanup ??= await stopAll(run);
    const failed = { profile, rep, failed: clean(e.message), cleanup, joined: ss.filter((s) => s.token).length, marks: Object.keys(run.marks) };
    writeFileSync(join(dir, 'result.json'), JSON.stringify(failed, null, 1));
    return failed;
  } finally { process.off('SIGINT', onSig); process.off('SIGTERM', onSig); lag.disable(); }
}

// ------------------------------------------------------------------ summary (every number keeps its sample count)
function summarize({ profile, rep, ss, ops, records, run, rates, views, cleanup, browser, driverCpuS, load }) {
  const t0 = run.marks.active, rel0 = (m) => m - t0, hz = run.samples.filter((x) => x.k === 'hz'), procs = run.samples.filter((x) => x.k === 'proc');
  const accounting = account(ops, records);
  // reactive demand (accepting invitations): offered = invitations received during the window; never in the fixed schedule
  const rx = run.reactiveRecords ?? [], rxLeft = ss.reduce((n, s) => n + s.reactive.length, 0), rxOut = {}; for (const r of rx) rxOut[r.outcome] = (rxOut[r.outcome] ?? 0) + 1;
  const reactiveDemand = { offered: rx.length + rxLeft, issued: rx.length, unissued: rxLeft, outcomes: rxOut, e2eMs: quantiles(rx.map((r) => r.doneAt - r.atMs)), inviteDeliveryMs: quantiles(rx.map((r) => r.inviteDeliveryMs)),
    gameplayCodes: rx.filter((r) => r.outcome === 'gameplay-refused').reduce((m, r) => (m[r.code] = (m[r.code] ?? 0) + 1, m), {}) };
  // receipts: action start (first started/terminal phase, server time) and delivery (stream receipt − server time)
  // an invitation starts only when the partner accepts (a social wait, not processing): its start is reported apart
  const start = { all: [] }, sharedStart = [], delivery = { all: [] }, activity = { all: [] }, never = {};
  for (const r of [...records, ...rx].filter((x) => x.receipt)) {
    const ev = run.receipts.get(r.receipt)?.events ?? [], first = ev.find((e) => e.phase === 'started') ?? ev.find((e) => ['completed', 'failed', 'replaced'].includes(e.phase));
    const w = `w${r.world}`; for (const m of [start, delivery, activity]) m[w] ??= [];
    // server `at` is wall-clock ms: anchored to the wall clock read at the activity mark, not to performance.timeOrigin
    if (first) { const v = (first.at - run.epochs.active) - r.atMs; if (r.kind === 'shared') sharedStart.push(v); else { start.all.push(v); start[w].push(v); } }
    else never[r.phase ?? 'none'] = (never[r.phase ?? 'none'] ?? 0) + 1;
    for (const e of ev) { const v = e.recv - e.at; delivery.all.push(v); delivery[w].push(v); }
    const end = ev.find((e) => e.endedTick != null && e.startedTick != null); if (end) { const v = (end.endedTick - end.startedTick) / TICK_HZ * 1000; activity.all.push(v); activity[w].push(v); }
  }
  const q = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, quantiles(v.map(Math.round))]));
  // clock: per world per declared window, against the admin rate from the world's database
  const win = { quiet: [run.marks.quiet, run.marks.active], active: [run.marks.active, run.marks.drain], ...Object.fromEntries(PH.meetupsMs.map((m, b) => [`meetup${b + 1}`, [t0 + m, t0 + m + 10_000]])) };
  const clock = Object.fromEntries(FIXTURES.map((f) => { const s = hz.filter((x) => x.w === f.slug && x.ok); return [f.slug, Object.fromEntries(Object.entries(win).map(([n, [from, to]]) => [n, clockWindow(s, { from, to, rate: rates[f.slug] ?? 1 })]))]; }));
  const hzMiss = Object.fromEntries(FIXTURES.map((f) => [f.slug, hz.filter((x) => x.w === f.slug && !x.ok).length]));
  const levels = Object.fromEntries(FIXTURES.map((f) => { const m = {}; for (const x of hz.filter((y) => y.w === f.slug && y.t >= run.marks.quiet && y.level)) m[x.level] = (m[x.level] ?? 0) + 1; return [f.slug, m]; }));
  const paused = hz.filter((x) => x.paused).length, dilated = hz.filter((x) => x.clockRate != null && x.clockRate < (rates[x.w] ?? 1)).length;
  // resources: per world CPU share and RSS per window; launcher; driver
  const rate = (a, b, get) => (a && b && get(a) != null && get(b) != null ? (get(b) - get(a)) / ((b.t - a.t) / 1000) : null);
  const inW = (x, [from, to]) => x.t >= from && x.t <= to;
  const resources = Object.fromEntries(['quiet', 'active'].map((n) => { const p = procs.filter((x) => inW(x, win[n])), a = p[0], b = p.at(-1);
    return [n, { worlds: Object.fromEntries(FIXTURES.map((f) => [f.slug, { cpuCores: +(rate(a, b, (x) => x.worlds[f.slug]?.cpuS) ?? NaN).toFixed(3), rssMbMax: Math.round(Math.max(0, ...p.map((x) => x.worlds[f.slug]?.rssMb ?? 0))) }])),
      launcherCpuCores: +(rate(a, b, (x) => x.launcher?.cpuS) ?? NaN).toFixed(3), launcherRssMbMax: Math.round(Math.max(0, ...p.map((x) => x.launcher?.rssMb ?? 0))),
      driverCpuCores: +(rate(a, b, (x) => x.driver.cpuS) ?? NaN).toFixed(3), driverRssMbMax: Math.max(0, ...p.map((x) => x.driver.rssMb)), driverLagP99MsMax: Math.max(0, ...p.map((x) => x.driver.lagP99Ms)), driverLagMaxMs: Math.max(0, ...p.map((x) => x.driver.lagMaxMs)) }]; }));
  const pidChanges = Object.fromEntries(FIXTURES.map((f) => [f.slug, new Set(procs.map((x) => x.worlds[f.slug]?.pid).filter(Boolean)).size - 1]));
  const restarts = Object.fromEntries(FIXTURES.map((f) => [f.slug, (views.afterActive?.[f.slug]?.restarts ?? 0)]));
  const gameplay = {}; for (const r of [...records, ...rx].filter((x) => x.outcome === 'gameplay-refused')) gameplay[`${r.kind}:${r.code}`] = (gameplay[`${r.kind}:${r.code}`] ?? 0) + 1;
  const refusalTags = {}; for (const r of [...records, ...rx]) for (const t of r.refusals ?? []) refusalTags[t] = (refusalTags[t] ?? 0) + 1;
  const all = (c) => accounting[`all|${c}`] ?? {}, minRatio = (n) => Math.min(...FIXTURES.map((f) => clock[f.slug][n].ratio ?? 0));
  const headline = {
    joined: ss.filter((s) => s.token).length, readE2eP95Ms: all('read').e2eMs?.p95, readE2eP99Ms: all('read').e2eMs?.p99, actE2eP95Ms: all('act').e2eMs?.p95, actE2eP99Ms: all('act').e2eMs?.p99,
    actionStartP95Ms: quantiles(start.all).p95, deliveryP95Ms: quantiles(delivery.all).p95, overdue: (all('read').overdue ?? 0) + (all('act').overdue ?? 0), unissued: (all('read').unissued ?? 0) + (all('act').unissued ?? 0),
    loadFailures: (all('read').loadFailures ?? 0) + (all('act').loadFailures ?? 0) + LOAD_FAILURES.reduce((n, k) => n + (reactiveDemand.outcomes[k] ?? 0), 0), reactiveUnissued: reactiveDemand.unissued,
    actsWithoutStart: Object.values(never).reduce((a, b) => a + b, 0), unissuedJoinFailed: ops.filter((o) => !ss[o.soul].token).length, clockMinQuiet: minRatio('quiet'), clockMinActive: minRatio('active'), restarts: Object.values(restarts).reduce((a, b) => a + b, 0),
    cleanup: cleanup && cleanup.launcherExited && cleanup.straysAfter === 0 ? 'clean' : 'NOT CLEAN', label: QUIET ? 'quiet-declared' : 'not-quiet',
  };
  // #736: allocation, headroom and hot threads over the active window; objectives as booleans for the verdict
  const P = run.probes, act = P.active, end = P.drain, secs = act && end ? (end.t - act.t) / 1000 : null, alloc = between(act?.alloc, end?.alloc, secs);
  const hostRows = run.samples.filter((x) => x.k === 'host' && inW(x, win.active)), memPeak = Math.max(...hostRows.map((x) => x.cgroupMemMb ?? -1), end?.alloc?.memoryPeakMb ?? -1);
  const used = FIXTURES.reduce((n, f) => n + (resources.active.worlds[f.slug]?.cpuCores || 0), 0) + (resources.active.launcherCpuCores || 0);
  const cpusetCores = (end?.alloc?.cpuset ?? '').split(',').filter(Boolean).reduce((n, r) => { const [a, b] = r.split('-').map(Number); return n + (b == null ? 1 : b - a + 1); }, 0) || null;
  const room = headroom({ quotaCores: end?.alloc?.cpuMax?.quotaCores ?? null, cpusetCores, hostCores: cpus().length, usedCores: used, memMaxMb: end?.alloc?.memoryMaxMb ?? null, memPeakMb: memPeak >= 0 ? memPeak : null });
  const hotW = Object.fromEntries(FIXTURES.map((f) => [f.slug, hotThreads(act?.threads?.[f.slug], end?.threads?.[f.slug], secs, CLK_TCK)]));
  const O = OBJECTIVES, rd = (k) => accounting[k]?.e2eMs ?? {}, sq = (k) => quantiles(start[k] ?? []);
  const meets = (x, p95, p99) => (x.n ? x.p95 <= p95 && x.p99 <= p99 : null), dq = quantiles(delivery.all);
  const objectives = { read: meets(rd('all|read'), O.readP95Ms, O.readP99Ms), actionStart: meets(sq('all'), O.actStartP95Ms, O.actStartP99Ms), delivery: meets(dq, O.deliveryP95Ms, O.deliveryP99Ms),
    clock: minRatio('quiet') >= O.clockMin && minRatio('active') >= O.clockMin, failures: headline.loadFailures === 0 && headline.overdue === 0 && headline.unissued === 0, restarts: headline.restarts === 0 && paused === 0 && dilated === 0 };
  const qualification = { profile, rep, qualifying: { executor: QUALIFYING, quiet: QUIET, short: SHORT }, objectives, headroom: room, cpuUsedCores: +used.toFixed(3),
    ...evidence({ hostRows, alloc }),   // swap, steal, throttling and pressure; unreadable stays null (unknown), never 0
    allocation: { supported: !!end?.alloc?.supported, cpuMax: end?.alloc?.cpuMax ?? null, cpuset: end?.alloc?.cpuset ?? null, memoryMaxMb: end?.alloc?.memoryMaxMb ?? null, memoryPeakMb: memPeak >= 0 ? memPeak : null, swapMaxMb: end?.alloc?.swapMaxMb ?? null, cgroupCpuCores: alloc?.cgroupCpuCores ?? null, throttledSecondsPerSecond: alloc?.throttledSecondsPerSecond ?? null,
      driverSameCgroup: !!end && end.alloc?.supported && JSON.stringify(end.alloc.cpuMax) === JSON.stringify(end.driver?.cpuMax) && end.alloc.memoryMaxMb === end.driver?.memoryMaxMb },
    worlds: Object.fromEntries(FIXTURES.map((f, w) => { const r = rd(`w${w}|read`), st = sq(`w${w}`), c = clock[f.slug];
      return [f.slug, { mainCores: hotW[f.slug]?.mainCores ?? null, hottestCores: hotW[f.slug]?.hottest?.cores ?? null, hottestThread: hotW[f.slug]?.hottest?.name ?? null, cpuCores: resources.active.worlds[f.slug]?.cpuCores ?? null,
        loopP99MsMax: Math.max(0, ...hz.filter((x) => x.w === f.slug && inW(x, win.active)).map((x) => x.loopP99Ms ?? 0)), queueMax: Math.max(0, ...hz.filter((x) => x.w === f.slug && inW(x, win.active)).map((x) => x.queue ?? 0)),
        met: (meets(r, O.readP95Ms, O.readP99Ms) ?? true) && (meets(st, O.actStartP95Ms, O.actStartP99Ms) ?? true) && (c.active.ratio ?? 0) >= O.clockMin }]; })) };
  const grown = growthOf(run.samples, { active: [run.marks.active, run.marks.drain], warmupMs: WARMUP_MS, slugs: FIXTURES.map((f) => f.slug) });
  return { profile, rep, headline, qualification, growth: grown, marksS: Object.fromEntries(Object.entries(run.marks).map(([k, v]) => [k, +((v - run.marks.boot) / 1000).toFixed(1)])), bootS: run.launcher.bootS, rates,
    join: { ms: quantiles(ss.filter((s) => s.joinMs != null).map((s) => s.joinMs)), failed: ss.filter((s) => !s.token).map((s) => ({ soul: s.i, tries: s.joinTries })), retries: ss.reduce((n, s) => n + Math.max(0, (s.joinTries?.length ?? 1) - 2), 0) },
    worlds: run.worlds.map((w) => ({ slug: w.slug, placesInMenu: w.placesInMenu, meetup: w.meetup, sharedVerbs: w.sharedVerbs })), accounting, reactiveDemand, actionStartMs: q(start), sharedActionStartMs: quantiles(sharedStart.map(Math.round)), receiptDeliveryMs: q(delivery), plannedActivityMs: q(activity), actsWithoutStart: never,
    stream: { ...run.stream, batches: quantiles(run.stream.batches) }, viewers: run.viewers, browser: BROWSER ? { ...browser, ...run.browserStats } : null,
    clock, healthzMisses: hzMiss, levels, pausedSamples: paused, dilatedSamples: dilated, resources, worldPidChanges: pidChanges, launcher: views, restarts, gameplayRefusals: gameplay, refusalTags,
    driverCpuS: +driverCpuS.toFixed(1), load, cleanup };
}

// ------------------------------------------------------------------ main
log(`meetup workload ${WORKLOAD}: ${PROFILE_LIST.join(',')} x${REPEATS}${SHORT ? ' (short smoke)' : ''}, seed ${SEED}, ${QUIET ? 'quiet host declared' : 'NOT QUIET: indicative only'}; out ${rel(OUT)}`);
const results = [];
for (let rep = 1; rep <= REPEATS; rep++) for (const p of PROFILE_LIST) results.push(await oneRun(p, rep));
const V = verdict(results.map((r) => r.qualification ?? { profile: r.profile, rep: r.rep, failed: r.failed }));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ verdict: V, runs: results.map((r) => ({ profile: r.profile, rep: r.rep, failed: r.failed, headline: r.headline, qualification: r.qualification, cleanup: r.cleanup })) }, null, 1));
writeFileSync(join(OUT, 'VERDICT.md'), verdictReport(V, results));
log(`verdict: ${V.verdict}${V.qualifies ? '' : ' (indicative only)'}; ${V.reasons.join(' | ')}`);
log(`done: ${rel(join(OUT, 'summary.json'))}`);
process.exit(results.some((r) => r.failed) ? 1 : 0);
