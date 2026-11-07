#!/usr/bin/env node
// Capacity bench (server-reliability tranche, lane L6). Metrics and arms are frozen in METRICS.md (v1); read it first.
// One fresh world per (arm, repeat), fake minds only ($0), scripted Souls running the world's own eden.mjs.
//
//   node tools/bench/capacity/bench.mjs --root <sim checkout> --fixture <compact sim.db | genesis:eden-2026> --out <dir>
//        [--arms n1,n6,n12,n24,incident,hostile] [--repeats 2] [--port 5151] [--heap-mb 768] [--host-label laptop]
//        [--slice "systemd-run --scope -p AllowedCPUs=6-7 -p MemoryMax=4G --uid=simworlds --gid=simworlds"]
//        [--world-user simworlds] [--world-key eden-2026] [--world-id <id; default: read from the fixture>] [--short]
//        [--cli <eden.mjs the world serves; default the root's own>]
//        [--via-launcher [--child-range 5154-5155]]   the world runs under the root's own launcher on --port (its proxy and ceilings in
//        the path); the launcher's data dir is <run>/launcher with one worlds.json row for the fixture; heap from the world's live.json
//        when it writes one (no --inspect: the launcher builds the child command), else RSS only; hostile Souls each send their own
//        X-Forwarded-For (the launcher is told it is behind a proxy, as on eden2); the world serves the root's own CLI
//
//   Stage B (METRICS.md v2, lane B-soak; --via-launcher only):
//        [--load stageb] [--read-worker off,on] [--read-workers 1] [--cli-souls 3] [--viewers 6] [--world-budget-rps 200]
//        [--oracle-rate 0.01] [--join-concurrency 8] [--cpus 6-7]
//        --load stageb: the Stage B mix (a read every 3-5 s, an act every 15-30 s, one listener per Soul); the first
//        --cli-souls Souls run the real CLI, the rest are raw-HTTP Souls in this process with the CLI's own requests and
//        retry etiquette (so N = 100 is not 200 Node processes). --read-worker off,on runs every arm once per mode (arm
//        keys n24@off, n24@on): on = registry readWorkers = --read-workers, the launcher passes SIM_READ_MODE=2.
//        --world-budget-rps: the world's registry limits.worldBudgetRps (the launcher's default 10 C1/C2 rps for the
//        whole world would refuse most of N >= 50's reads before they reach main or a worker). --cpus (Linux): the world
//        process and all its threads (tick thread + read workers) pinned with taskset as soon as its pid is known
//        (the launcher stays outside); --world-user: the launcher (so the world) runs as that user.
// Writes <out>/<arm>-r<k>/{result.json,commands.jsonl,world.log}, <out>/receipt.json and <out>/REPORT.md (report.mjs).
// The fixture's per-run copy is deleted after each run; the fixture itself is never written.
import { spawn, execFile, execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, homedir, loadavg, release, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { report } from './report.mjs';
const sh0 = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'ok'; } catch { return null; } };
const ROOT0 = resolve((() => { const i = process.argv.indexOf('--root'); return i < 0 ? new URL('../../..', import.meta.url).pathname : process.argv[i + 1]; })());
const { defaultCommand } = await import(pathToFileURL(join(ROOT0, 'tools/world-launcher/children.mjs')).href);
const { decorateCommand } = await import(pathToFileURL(join(ROOT0, 'tools/world-launcher/production.mjs')).href);

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; }, flag = (k) => argv.includes(`--${k}`);
const ROOT = resolve(opt('root', new URL('../../..', import.meta.url).pathname)), OUT = resolve(opt('out', 'bench-out'));
const FIXTURE = opt('fixture', 'genesis:eden-2026'), ARMS = opt('arms', 'n1,n6,n12,n24,incident,hostile').split(','), REPEATS = Number(opt('repeats', 2));
const VIA = flag('via-launcher'), CHILD_RANGE = opt('child-range', `${Number(opt('port', 5151)) + 1}-${Number(opt('port', 5151)) + 2}`);
const PORT = Number(opt('port', 5151)), INSPECT = PORT + 1, HEAP_MB = Number(opt('heap-mb', 768)), HOST_LABEL = opt('host-label', 'laptop');
const SLICE = opt('slice', ''), WORLD_USER = opt('world-user', ''), SLUG = opt('world-key', 'eden-2026'), SHORT = flag('short'), ENGINE = opt('engine', 'mars');
const MARS_WEB = opt('mars-web', join(ROOT, 'mars/viewer/dist'));
const CLI_FILE = resolve(opt('cli', join(ROOT, 'tools/world-launcher/soul/eden.mjs')));
if (VIA && CLI_FILE !== resolve(join(ROOT, 'tools/world-launcher/soul/eden.mjs'))) throw new Error('--via-launcher: the launcher serves its own root\'s eden.mjs; drop --cli');
if (VIA && SLICE) throw new Error('--via-launcher with --slice is not built yet (the slice would wrap the launcher, not the world); use --cpus');
const LOAD = opt('load', 'v1'), RW_MODES = opt('read-worker', '').split(',').filter(Boolean), RW_N = Number(opt('read-workers', 1)), CLI_SOULS = Number(opt('cli-souls', 3));
const VIEWERS = Number(opt('viewers', 6)), BUDGET = ((b) => (b === 'default' ? '' : b))(opt('world-budget-rps', LOAD === 'stageb' ? '200' : '')), ORACLE_RATE = Number(opt('oracle-rate', 0.01)), JOIN_PAR = Number(opt('join-concurrency', LOAD === 'stageb' ? 4 : 1)), CPUS = opt('cpus', '');
// r3 (2026-10-31): the active windows start only once the world has been green for GREEN_HOLD_S (Souls connected and listening,
// no commands), at most GREEN_GATE_S after the join; eden2 5fed735da ran its windows inside the join storm's red tail
const GREEN_GATE_S = Number(opt('green-gate-s', LOAD === 'stageb' ? 300 : 0)), GREEN_HOLD_S = Number(opt('green-hold-s', 20));
if (!['v1', 'stageb'].includes(LOAD)) throw new Error('--load v1|stageb');
if ((RW_MODES.length || LOAD === 'stageb' || CPUS) && !VIA) throw new Error('--load stageb, --read-worker and --cpus run through the launcher: add --via-launcher');
if (RW_MODES.some((m) => m !== 'on' && m !== 'off')) throw new Error('--read-worker off|on|off,on');
if (CPUS && !sh0('taskset', ['-V'])) throw new Error('--cpus needs Linux taskset');
const MODES = RW_MODES.length ? RW_MODES : [null];
const PH = SHORT ? { warm: 10, idle: 10, active: 20, calib: 5 } : { warm: 60, idle: 30, active: 120, calib: 20 };
const TICK_HZ = 20, BUSY = /\b(world\.busy|world\.crowded|world\.starting|soul\.busy|soul\.slow-down|rate-limited|client\.rate|account\.rate)\b/;
const TARGETS = ['the bandstand', 'the commons', 'the pond', 'the classroom', 'the orchard', 'the kitchen', 'the garden', 'the plaza'];
const SEARCH = ['bench', 'seat', 'door', 'book', 'table'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); appendFileSync(join(OUT, 'bench.log'), s + '\n'); };

// ------------------------------------------------------------------ host facts and fixture
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const sha256File = (p) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const genesis = FIXTURE.startsWith('genesis:') ? join(ROOT, 'worlds/templates', `${FIXTURE.slice(8)}.json`) : null;
const fixtureFile = genesis ?? resolve(FIXTURE);
if (!existsSync(fixtureFile)) throw new Error(`no fixture at ${fixtureFile}`);
function worldIdOf(db) {   // the most common world_id in the fixture (a compact copy keeps the live world's id)
  const py = "import sqlite3,sys,collections\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);n=collections.Counter()\nfor (t,) in c.execute(\"select name from sqlite_master where type='table'\"):\n  cols=[r[1] for r in c.execute(f'pragma table_info(\"{t}\")')]\n  if 'world_id' in cols:\n    for (w,k) in c.execute(f'select world_id,count(*) from \"{t}\" group by world_id'): n[w]+=k\nprint(n.most_common(1)[0][0] if n else '')";
  return sh('python3', ['-c', py, db]) || null;
}
const WORLD_ID = opt('world-id', genesis ? `${SLUG}-bench` : worldIdOf(fixtureFile));
if (VIA && WORLD_ID !== `${SLUG}-1`) throw new Error(`--via-launcher: the launcher names the world ${SLUG}-1 but the fixture's world is ${WORLD_ID}`);
const BASE = `http://127.0.0.1:${PORT}/w/${SLUG}`;
const host = {
  label: HOST_LABEL, indicative: HOST_LABEL !== 'eden2-slice', hostname: hostname(), cpu: cpus()[0]?.model, cores: cpus().length, kernel: release(), node: process.version,
  slice: SLICE || null, heapMb: HEAP_MB, sourceSha: sh('git', ['-C', ROOT, 'rev-parse', 'HEAD']), sourceDirty: !!sh('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no']),
  benchSha: sh('git', ['-C', new URL('.', import.meta.url).pathname, 'rev-parse', 'HEAD']),
  cli: CLI_FILE, cliSha256: await sha256File(CLI_FILE), cliVersion: /const VERSION = "([^"]+)"/.exec(readFileSync(CLI_FILE, 'utf8'))?.[1] ?? null,
  fixture: FIXTURE, fixtureSha256: await sha256File(fixtureFile), worldId: WORLD_ID, worldKey: SLUG, engine: ENGINE, phases: PH,
  viaLauncher: VIA ? { port: PORT, childRange: CHILD_RANGE, publicOrigin: `http://localhost:${PORT}` } : null,
  load: LOAD, ...(LOAD === 'stageb' ? { stageb: { cliSouls: CLI_SOULS, viewers: VIEWERS, worldBudgetRps: BUDGET ? Number(BUDGET) : null, oracleRate: ORACLE_RATE, joinConcurrency: JOIN_PAR } } : {}),
  readWorker: RW_MODES.length ? { modes: RW_MODES, workers: RW_N, mode: process.env.SIM_READ_MODE === '1' ? 1 : 2 } : null, cpus: CPUS || null, worldUser: WORLD_USER || null,
};

// ------------------------------------------------------------------ the world process
const CLK_TCK = Number(sh('getconf', ['CLK_TCK']) ?? 100) || 100;
function procStats(pid) {   // {cpuS, rssMb}
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return { cpuS: (Number(stat[11]) + Number(stat[12])) / CLK_TCK, rssMb: rss ? Number(rss[1]) / 1024 : null };
  } catch {
    const out = sh('ps', ['-o', 'time=,rss=', '-p', String(pid)]); if (!out) return null;
    const [t, rss] = out.trim().split(/\s+/), parts = t.split(':').map(Number);
    const cpuS = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    return { cpuS, rssMb: Number(rss) / 1024 };
  }
}
async function inspector() {   // Runtime.getHeapUsage only
  const list = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (wait.delete(i)) r(null); }, 5000); });
  return { heapMb: async () => { const d = await call('Runtime.getHeapUsage'); return d?.result ? d.result.usedSize / 2 ** 20 : null; }, close: () => ws.close() };
}

async function bootWorld(dir, opts = {}) { return VIA ? bootLauncher(dir, opts) : bootDirect(dir, opts); }
async function bootDirect(dir, { settle = true } = {}) {
  const data = join(dir, 'data'); mkdirSync(data, { recursive: true });
  if (!genesis) copyFileSync(fixtureFile, join(data, 'sim.db'));
  if (WORLD_USER) sh('chown', ['-R', `${WORLD_USER}:${WORLD_USER}`, dir]);
  // the launcher's own world command and production decoration, from the checkout under test (never a hand-made env):
  // ENGINE, ENABLE_WORLD_ENGINE, SOUL_LIFECYCLE, fading, unwatched pace, malloc env, fake brain, no model keys
  const soul = (f) => join(ROOT, 'tools/world-launcher/soul', f);
  // GENESIS_FILE as on the live world (the template of the same key), library dir in the run's scratch
  const template = genesis ?? (existsSync(join(ROOT, 'worlds/templates', `${SLUG}.json`)) ? join(ROOT, 'worlds/templates', `${SLUG}.json`) : undefined);
  const library = join(dir, 'library'); mkdirSync(library, { recursive: true });
  const base = defaultCommand({ slug: SLUG, dataDir: data, name: 'Capacity bench', ...(template ? { templateFile: template } : {}) }, PORT,
    { publicOrigin: `http://127.0.0.1:${PORT}`, marsWebDir: MARS_WEB, root: ROOT, libraryDir: library, soulControllerCliFile: CLI_FILE, soulCliFile: soul('eden-agent.mjs'), soulSkillFile: soul('skill.md'), soulInstructionsFile: soul('instructions.md') });
  const { cmd: node, args, env } = decorateCommand(base, { devAuth: true, publicOrigin: `http://127.0.0.1:${PORT}`, base: '', worldHeapMb: HEAP_MB, build: 'dev' });
  if (WORLD_ID) env.WORLD_ID = WORLD_ID;
  Object.assign(env, { MIND_DRIVER: 'edge', BRAIN_MODE: 'fake' });
  for (const k of Object.keys(env)) if (k.startsWith('EDGE_EYES')) delete env[k];   // no renders in the bench (Eyes off)
  const cmd = [...(SLICE ? SLICE.split(/\s+/) : []), node, `--inspect=127.0.0.1:${INSPECT}`, ...args];
  writeFileSync(join(dir, 'world-command.json'), JSON.stringify({ cmd, env: Object.fromEntries(Object.entries(env).filter(([k]) => !/KEY|TOKEN|SECRET/.test(k))) }, null, 1));
  const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let wlog = ''; const wl = (b) => { wlog = (wlog + b).slice(-20000); appendFileSync(join(dir, 'world.log'), b); };
  child.stdout.on('data', wl); child.stderr.on('data', wl);
  const t0 = now(); let up = false;
  while (!up && now() - t0 < 900_000) { if (child.exitCode != null) throw new Error(`world exited at boot (${child.exitCode}); ${dir}/world.log ends:\n${wlog.trim().split('\n').slice(-12).join('\n')}`); up = (await healthz()).ok; if (!up) await sleep(1000); }
  if (!up) throw new Error('world did not answer /healthz in 15 min');
  const bootS = (now() - t0) / 1000, tc = now();
  await settleWorld(() => wlog, settle, tc);
  const pids = (sh('pgrep', ['-f', `inspect=127.0.0.1:${INSPECT}`]) ?? '').split('\n').map(Number).filter(Boolean);
  const pid = pids.find((x) => /node/.test(sh('ps', ['-o', 'comm=', '-p', String(x)]) ?? '')) ?? child.pid;   // the node process, not systemd-run
  return { child, pid, data, bootS, catchUpS: (now() - tc) / 1000 };
}
// settled = the boot's perceive catch-up logged, or (it logs only when slow) 30 s up with three calm ticks; cap 300 s
async function settleWorld(wlog, settle, tc) {
  for (let calm = 0; settle && !/perceive catch-up/.test(wlog()) && now() - tc < 300_000 && !(now() - tc > 30_000 && calm >= 3); ) { await sleep(1000); const x = await healthz(); calm = x.ok && x.tickMs?.avg < 25 ? calm + 1 : 0; }
}
// --via-launcher: the root's own launcher (its proxy, flood guard and, from R1, the Soul API ceilings) in front of the world
async function bootLauncher(dir, { settle = true, rw = null } = {}) {
  const ldata = join(dir, 'launcher'), data = join(ldata, 'worlds', SLUG); mkdirSync(data, { recursive: true });
  if (!genesis) copyFileSync(fixtureFile, join(data, 'sim.db'));
  const template = genesis ? FIXTURE.slice(8) : existsSync(join(ROOT, 'worlds/templates', `${SLUG}.json`)) ? SLUG : 'empty';
  // Stage B: the registry fields op.mjs set-read-workers / set-limits write (readWorkers 0 = off even if the env says 1)
  const row = { slug: SLUG, name: 'Capacity bench', template, port: null, createdAt: Date.now(), unlisted: true, worldHeapMb: HEAP_MB,
    ...(rw ? { readWorkers: rw === 'on' ? RW_N : 0 } : {}), ...(BUDGET ? { limits: { worldBudgetRps: Number(BUDGET) } } : {}) };
  writeFileSync(join(ldata, 'worlds.json'), JSON.stringify({ schema: 'world-launcher-registry/1', worlds: [row] }, null, 2) + '\n');
  mkdirSync(join(dir, 'home'), { recursive: true });
  if (WORLD_USER) sh('chown', ['-R', `${WORLD_USER}:${WORLD_USER}`, dir]);
  const args = [join(ROOT, 'tools/world-launcher/launcher.mjs'), '--port', String(PORT), '--data', ldata, '--range', CHILD_RANGE, '--public-origin', `http://localhost:${PORT}`,
    '--world-heap-mb', String(HEAP_MB), '--mars-web', MARS_WEB, '--eager', '1'];
  // the launcher's environment: no Eyes, no handover pre-warm (one world, one port pair); children never inherit the rest
  const env = { ...process.env, SIM_PREWARM: '0', ...(WORLD_USER ? { HOME: join(dir, 'home'), USER: WORLD_USER, LOGNAME: WORLD_USER } : {}) }; for (const k of Object.keys(env)) if (k.startsWith('EDGE_EYES') || /KEY|TOKEN|SECRET/.test(k)) delete env[k];
  if (rw) { delete env.SIM_READ_WORKER; if (rw === 'on') env.SIM_READ_MODE = process.env.SIM_READ_MODE === '1' ? '1' : '2'; else delete env.SIM_READ_MODE; }   // the registry row decides on/off
  const ids = WORLD_USER ? { uid: Number(sh('id', ['-u', WORLD_USER])), gid: Number(sh('id', ['-g', WORLD_USER])) } : {};
  writeFileSync(join(dir, 'world-command.json'), JSON.stringify({ launcher: [process.execPath, ...args], ...ids, readMode: env.SIM_READ_MODE ?? null, cpus: CPUS || null, registry: JSON.parse(readFileSync(join(ldata, 'worlds.json'), 'utf8')) }, null, 1));
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], ...ids });
  let llog = ''; const ll = (b) => { llog = (llog + b).slice(-20000); appendFileSync(join(dir, 'launcher.log'), b); };
  child.stdout.on('data', ll); child.stderr.on('data', ll);
  const wlogFile = join(ldata, 'logs', `${SLUG}.log`), wlog = () => { try { return readFileSync(wlogFile, 'utf8').slice(-20000); } catch { return ''; } };
  const t0 = now(); let up = false;
  const pins = [];
  while (!up && now() - t0 < 900_000) { if (child.exitCode != null) throw new Error(`launcher exited at boot (${child.exitCode}); ${dir}/launcher.log ends:\n${llog.trim().split('\n').slice(-12).join('\n')}`); pinWorld(ldata, pins); up = (await healthz()).ok; if (!up) await sleep(CPUS ? 250 : 1000); }
  if (!up) throw new Error(`world did not answer /healthz through the launcher in 15 min; ${wlogFile}`);
  const bootS = (now() - t0) / 1000, tc = now();
  await settleWorld(wlog, settle, tc);
  const w = { child, launcherPid: child.pid, data, ldata, wlogFile, bootS, catchUpS: (now() - tc) / 1000, pins, rw };
  pinWorld(ldata, pins);
  Object.defineProperty(w, 'pid', { get: () => worldPid(ldata) ?? child.pid });   // the world's node process; a restart changes it
  return w;
}
// --cpus: the world process and every thread it has (tick thread, read workers, libuv) on those CPUs; threads made later
// inherit the mask from the thread that makes them. Re-applied when the launcher restarts the world (a new pid).
function pinWorld(ldata, pins) {
  const pid = CPUS ? worldPid(ldata) : null; if (!pid || pins.some((p) => p.pid === pid)) return;
  const out = sh('taskset', ['-a', '-p', '-c', CPUS, String(pid)]);
  let allowed = null; try { allowed = /Cpus_allowed_list:\s*(\S+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? null; } catch { /* not Linux */ }
  pins.push({ pid, at: now(), ok: out != null, allowed });
}
function worldRec(ldata) { try { return JSON.parse(readFileSync(join(ldata, 'children.json'), 'utf8'))[SLUG] ?? null; } catch { return null; } }
function worldPid(ldata) { try { return JSON.parse(readFileSync(join(ldata, 'children.json'), 'utf8'))[SLUG]?.pid ?? null; } catch { return null; } }
function liveHeapMb(w) {   // LOAD-CONTRACT §4 live.json (a world that writes one); fresh within 10 s, else null
  try { const v = JSON.parse(readFileSync(join(w.data, 'live.json'), 'utf8')); const at = v.at > 1e12 ? v.at : v.at * 1000; return now() - at < 10_000 && Number.isFinite(v.heap?.usedMb) ? v.heap.usedMb : null; } catch { return null; }
}
async function launcherView() {   // the launcher's health page JSON for this world (limits, refusal counts, restarts), loopback
  try { const d = await (await fetch(`http://127.0.0.1:${PORT}/__sim/health?json=1`, { signal: AbortSignal.timeout(5000) })).json(); const x = (d.worlds ?? []).find((y) => y.slug === SLUG) ?? null;
    return x ? { status: x.status, restarts: x.restarts, limits: x.limits ?? null, refused: x.refused ?? null, lastExit: x.lastExit ?? null } : null; } catch { return null; }
}
async function stopWorld(w) {
  if (w.launcherPid) {   // the launcher stops its world; the world is killed by pid only if it outlives the launcher
    const wp = worldPid(w.ldata);
    try { process.kill(w.launcherPid, 'SIGTERM'); } catch { /* gone */ }
    for (let i = 0; i < 60 && w.child.exitCode == null; i++) await sleep(500);
    if (w.child.exitCode == null) try { process.kill(w.launcherPid, 'SIGKILL'); } catch { /* gone */ }
    if (wp) { for (let i = 0; i < 20; i++) { try { process.kill(wp, 0); } catch { break; } await sleep(500); } try { process.kill(wp, 'SIGKILL'); } catch { /* gone */ } }
    const trash = join(homedir(), '.Trash', 'eden-cleanup-20261020'); mkdirSync(trash, { recursive: true });
    try { renameSync(join(w.ldata, 'worlds'), join(trash, `bench-${Date.now()}-worlds`)); } catch { sh('mv', [join(w.ldata, 'worlds'), join(trash, `bench-${Date.now()}-worlds`)]); }
    return;
  }
  try { process.kill(w.pid, 'SIGTERM'); } catch { /* gone */ }
  for (let i = 0; i < 40 && w.child.exitCode == null; i++) await sleep(500);
  if (w.child.exitCode == null) try { process.kill(w.pid, 'SIGKILL'); } catch { /* gone */ }
  // the per-run fixture copy goes (moved to the trash dir beside it, per the no-rm rule; R empties it)
  const trash = join(homedir(), '.Trash', 'eden-cleanup-20261020'); mkdirSync(trash, { recursive: true });
  try { renameSync(w.data, join(trash, `bench-${Date.now()}-data`)); } catch { sh('mv', [w.data, join(trash, `bench-${Date.now()}-data`)]); }
}
async function healthz(timeoutMs = 5000) {
  const t = now();
  try { const r = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(timeoutMs) }); const d = r.ok ? await r.json() : null; return { ok: !!d, ms: now() - t, tick: d?.tick, tickMs: d?.tickMs, ...(d?.load ? { level: d.load.level, service5s: d.load.service5s, loopP99Ms: d.load.loopP99Ms, queueOldestMs: d.load.queue?.oldestMs ?? null, tickP99Ms: d.load.tickP99Ms, baselineMs: d.load.loopBaselineMs } : {}) }; }
  catch { return { ok: false, ms: timeoutMs, tick: null }; }
}

// ------------------------------------------------------------------ scripted Souls
const CLASS = { here: 'C2', observe: 'C2', caps: 'C2', resolve: 'C2', around: 'C2', act: 'C1', say: 'C1', listen: 'C0' };
function runCli(soul, args, deadlineMs, rec) {
  return new Promise((done) => {
    const t = now(), p = spawn(process.execPath, ['eden.mjs', ...args], { cwd: soul.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', out = '', killed = false; p.stderr.on('data', (d) => { err = (err + d).slice(-2000); }); p.stdout.on('data', (d) => { if (args[0] === 'act') out = (out + d).slice(0, 2000); });
    const k = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, deadlineMs);
    p.on('exit', (code) => {
      clearTimeout(k);
      // an act the world answers `accepted: false` is a refusal, whatever the exit code (#1093: words would refuse every act)
      const outcome = killed ? 'timeout' : /"accepted":\s*false/.test(out) ? 'refused' : code === 0 ? 'ok' : /unreachable/.test(err) ? 'unreachable' : BUSY.test(err) ? 'refused' : 'error';
      const r = { soul: soul.i, cmd: args[0], cls: CLASS[args[0]] ?? 'C0', at: t, ms: now() - t, code, outcome, ...(outcome === 'refused' && out ? { refusal: /"code":\s*"([^"]+)"/.exec(out)?.[1], target: args[1] } : {}), ...(outcome === 'error' ? { err: err.trim().split('\n').at(-1)?.slice(0, 200) } : {}) };
      rec?.(r); done(r);
    });
  });
}
async function join_(run, i) {
  const dir = join(run.dir, 'souls', `s${i}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'eden.mjs'), Buffer.from(await (await fetch(`${BASE}/eden.mjs`)).arrayBuffer()));
  const soul = { i, dir };
  const a = await runCli(soul, ['register', BASE], 60_000);
  // v3 (srv-cli-lifecycle): the SAME name on every try, until the folder holds a token or 120 s pass. Soul CLI 2.5.3
  // waits itself (up to 120 s) for a create the world is still finishing (503 lifecycle-pending) and a re-run of the same
  // create resumes that Soul, also after a lost answer (409 name-taken by this folder's own create). v2's fresh name per
  // try left a half-made Soul behind on every late create and added load (eden2 B-soak r3: every N=50/100 arm).
  const token = () => { try { return JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8')).token ?? null; } catch { return null; } };
  const t0 = now(); let b;
  for (let k = 0; ; k++) {
    b = await runCli(soul, ['create', `Bench${i}`], 150_000);
    if (token() || now() - t0 >= 120_000) break;
    run.joinRetries = (run.joinRetries ?? 0) + 1; log(`soul ${i} create try ${k + 1}: ${b.outcome} ${b.err ?? ''}`); await sleep(2000);
  }
  if (!token()) throw new Error(`soul ${i} create: ${b.outcome} ${b.err ?? ''} (${a.outcome})`);
  soul.token = JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8')).token;
  return soul;
}
// What `go to <target>` reads as in this world, through the CLI's own resolve. Empty is an error: the bench would measure refusals.
let WALK_IDS = [];
async function learnWalkIds(soul) {
  const read = (words) => new Promise((done) => execFile(process.execPath, ['eden.mjs', 'resolve', words], { cwd: soul.dir, timeout: 60_000 }, (_e, out) => { try { const d = JSON.parse(out); done({ id: d.candidates?.find((c) => c.available)?.id ?? null, why: d.code ?? null }); } catch { done({ id: null, why: String(out).slice(0, 80) }); } }));
  // one after another, as an agent would: the world's read limits are not what this measures
  const ids = new Set(), misses = [];
  for (const t of TARGETS) { const r = await read(`go to ${t}`); if (r.id) ids.add(r.id); else misses.push(`${t}: ${r.why ?? 'no available candidate'}`); }
  WALK_IDS = [...ids];
  if (!WALK_IDS.length) throw new Error(`no offered id for any of ${TARGETS.join(', ')}: the act load would only measure refusals (${misses.join('; ')})`);
  log(`act load walks to: ${WALK_IDS.join(', ')}${misses.length ? `; no id for ${misses.join('; ')}` : ''}`);
}
const MINUTE = ['here', 'observe', 'here', 'observe', 'here', 'observe', 'caps', 'caps', 'resolve', 'resolve', 'around', 'act', 'act', 'say'];
function argsFor(op, n) {
  if (op === 'caps') return ['caps', '--search', pick(SEARCH)];
  if (op === 'resolve') return ['resolve', pick(TARGETS)];
  // CTRL-1 (#1093): the served CLI acts on offered ids only; the ids are read from the world once, before the load starts
  if (op === 'act') return n % 3 === 2 ? ['act', 'sit:here'] : ['act', pick(WALK_IDS)];
  if (op === 'say') return ['say', 'hello from the capacity bench'];
  return [op];
}
// the old user script tonight: up to 6 tries, 15 s apart, on any non-zero exit
async function oldWrapper(soul, args, deadline, rec, stop) {
  for (let i = 0; i < 6; i++) { const r = await runCli(soul, args, deadline, rec); if (r.code === 0 || stop()) return r; await sleep(15_000); }
}
function soulLoop(run, soul, wrap) {
  let n = 0;
  return (async () => {
    while (!run.stopped) {
      const plan = [...MINUTE].sort(() => Math.random() - 0.5), gap = 60_000 / plan.length;
      for (const op of plan) {
        if (run.stopped) return;
        const t = now(), args = argsFor(op, n++), deadline = CLASS[op] === 'C1' ? 90_000 : 60_000;
        if (run.mode !== 'idle') await (wrap ? oldWrapper(soul, args, deadline, run.rec, () => run.stopped) : runCli(soul, args, deadline, run.rec));
        await sleep(Math.max(0, gap * (0.7 + 0.6 * Math.random()) - (now() - t)));
      }
    }
  })();
}
function holdListen(run, soul) {   // the harness keeps one listen per Soul; restarts it 1 s after it exits
  soul.listens = 0;
  const start = () => {
    if (run.stopped) return;
    const p = spawn(process.execPath, ['eden.mjs', 'listen'], { cwd: soul.dir, stdio: ['ignore', 'ignore', 'pipe'] });
    // M9 counts a listen once it has stayed up 3 s (holding a long-poll), not one that exits at once ("already listening")
    let counted = false; const c = setTimeout(() => { counted = true; soul.listens++; run.maxListens[soul.i] = Math.max(run.maxListens[soul.i] ?? 0, soul.listens); }, 3000);
    run.procs.add(p);
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    p.on('exit', (code) => { clearTimeout(c); if (counted) soul.listens--; run.procs.delete(p); run.listenExits.push({ soul: soul.i, code, superseded: /superseded/.test(err), already: /already listening/.test(err) }); if (p === soul.held) setTimeout(() => { if (!run.stopped) soul.held = start(); }, 1000); });
    return p;
  };
  soul.held = start();
  return start;   // the incident arm calls this to relaunch without stopping the old one
}
function waitStream(run, soul) {   // C0 long-poll, in-process (no CLI process per Soul)
  (async () => {
    let cursor = 'c_0';
    while (!run.stopped) {
      try { const r = await fetch(`${BASE}/v1/edge/wait?timeout=55&after=${encodeURIComponent(cursor)}`, { headers: { authorization: `Bearer ${soul.token}` }, signal: AbortSignal.timeout(65_000) }); const d = await r.json().catch(() => ({})); cursor = d.cursor ?? cursor; if (!r.ok) await sleep(5000); }
      catch { await sleep(5000); }
    }
  })();
}
function viewer(run, hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/w/${SLUG}/ws`);
  ws.onopen = () => { try { ws.send(hello); } catch { /* closed */ } };
  ws.onmessage = (m) => { run.wsBytes += typeof m.data === 'string' ? m.data.length : m.data.byteLength ?? 0; };
  ws.onclose = () => { if (!run.stopped) setTimeout(() => viewer(run, hello), 2000 * (0.5 + Math.random())); };
  run.sockets.push(ws);
}
function hostile(run, soul) {   // 4 parallel loops that ignore Retry-After and retry at once
  const H = { authorization: `Bearer ${soul.token}`, ...(VIA ? { 'x-forwarded-for': `10.66.0.${soul.i + 1}` } : {}) };   // via the launcher: one address per hostile Soul
  const reqs = [
    () => fetch(`${BASE}/v1/edge/here?include=doHere`, { headers: H, signal: AbortSignal.timeout(30_000) }),
    () => fetch(`${BASE}/v1/edge/capabilities`, { headers: H, signal: AbortSignal.timeout(30_000) }),
    () => fetch(`${BASE}/v1/edge/act`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ capability: `go to ${pick(TARGETS)}` }), signal: AbortSignal.timeout(30_000) }),
    () => fetch(`${BASE}/v1/edge/say`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hostile bench' }), signal: AbortSignal.timeout(30_000) }),
  ];
  for (let k = 0; k < 4; k++) (async () => {
    let j = k;
    while (!run.stopped) {
      if (run.mode === 'idle') { await sleep(200); continue; }
      const t = now();
      try { const r = await reqs[j++ % 4](); const d = await r.json().catch(() => ({})); const code = d?.error?.code ?? d?.code;
        run.hostile[r.ok ? 'ok' : (r.status === 429 || r.status === 503) && BUSY.test(String(code)) ? 'refused' : r.status >= 500 ? 'error5xx' : 'other4xx']++; }
      catch { run.hostile.failed++; }
      run.hostile.ms.push(now() - t);
      await new Promise((r) => setImmediate(r));
    }
  })();
}

// ------------------------------------------------------------------ Stage B load (METRICS.md v2): raw-HTTP Souls, worker stats, oracle sample
// A raw Soul sends exactly the CLI's requests (eden.mjs here/observe/caps --search/resolve/around/act/say) with its retry
// etiquette (6 tries with full jitter on no answer; up to 3 waits of the stated Retry-After on a designed busy answer), one
// command at a time, from its own X-Forwarded-For address. Its time is the request's wall time incl. those waits (no CLI start).
const SB_READS = ['here', 'observe', 'caps', 'here', 'resolve', 'observe', 'around'];
const RAW = {
  here: () => ['GET', '/v1/edge/here?include=doHere'], observe: () => ['GET', '/v1/edge/observe'], caps: () => ['GET', '/v1/edge/capabilities?all=1'],
  around: () => ['GET', '/v1/edge/around'], resolve: () => ['POST', '/v1/edge/resolve', { capability: pick(TARGETS), params: {} }],
  act: (n) => ['POST', '/v1/edge/act', { capability: n % 3 === 2 ? 'sit down' : `go to ${pick(TARGETS)}`, params: {} }], say: () => ['POST', '/v1/edge/say', { text: 'hello from the capacity bench' }],
};
const rawHeaders = (soul) => ({ authorization: `Bearer ${soul.token}`, 'content-type': 'application/json', 'x-forwarded-for': `10.77.${soul.i >> 8}.${(soul.i & 255) + 1}` });
// who refused and why: the launcher's ceilings answer with the world's slug in the body (load:<level> / ramp / boot from
// the message), the world's own admission (soul.busy, soul.slow-down, world.busy past a deadline) without it
function refusalTag(status, code, d) {
  const m = String(d?.message ?? ''), by = d?.slug ? 'launcher' : 'world';
  const why = by === 'launcher' ? (/\((red|black)\)/.exec(m)?.[1] ? `load:${/\((red|black)\)/.exec(m)[1]}` : /restarted/.test(m) ? 'ramp' : /starting/.test(m) ? 'boot' : 'ceiling') : '';
  return `${by}:${code}${why ? `:${why}` : ''}`;
}
async function rawCmd(run, soul, op, n) {
  const [method, path, body] = RAW[op](n), cls = CLASS[op], deadline = cls === 'C1' ? 90_000 : 60_000, t = now();
  const headers = { ...rawHeaders(soul), ...(method === 'POST' && op !== 'resolve' ? { 'idempotency-key': `${soul.i}-${t}-${n}` } : {}) };
  let status = 0, code = null, worker = false, cpuMs = null, busy = 0, failed = 0, waitMs = 0, level = null; const refusals = [];
  for (;;) {
    const left = deadline - (now() - t); if (left <= 0) { status = -1; break; }
    try {
      const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(Math.min(left, cls === 'C2' ? 25_000 : 40_000)) });
      const d = await r.json().catch(() => ({})); status = r.status; code = d?.error?.code ?? d?.code ?? null;
      worker = r.headers.get('x-sim-read-cpu-ms') != null; cpuMs = worker ? Number(r.headers.get('x-sim-read-cpu-ms')) : null; level = r.headers.get('x-sim-load') ?? level;
      if ((status === 429 || status === 503) && BUSY.test(String(code))) refusals.push(refusalTag(status, code, d));
      if ((status === 429 || status === 503) && BUSY.test(String(code)) && busy < 3) { busy++; const ra = Number(r.headers.get('retry-after')), w0 = now(); await sleep(Math.min(left, (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** busy) * (1 + 0.2 * Math.random()))); waitMs += now() - w0; continue; }
      break;
    } catch (e) {
      if (now() - t >= deadline) { status = -1; break; }
      if (++failed >= 6) { status = 0; break; }
      await sleep(Math.min(deadline - (now() - t), Math.random() * Math.min(60_000, 1000 * 2 ** (failed - 1))));
    }
  }
  const outcome = status === -1 ? 'timeout' : status >= 200 && status < 300 ? 'ok' : status === 0 ? 'unreachable' : (status === 429 || status === 503) && BUSY.test(String(code)) ? 'refused' : 'error';
  const r = { soul: soul.i, cmd: op, cls, at: t, ms: now() - t, code: status, outcome, raw: true, ...(worker ? { worker: true, cpuMs } : {}), ...(busy ? { busyWaits: busy, waitMs: Math.round(waitMs) } : {}), ...(refusals.length ? { refusals } : {}), ...(level ? { level } : {}), ...(outcome === 'error' ? { err: `${status} ${code ?? ''}` } : {}) };
  run.rec?.(r);
  if (op !== 'act' && op !== 'say' && run.oracle && Math.random() < ORACLE_RATE) oracleSample(run, soul).catch(() => {});
  return r;
}
function sbLoop(run, soul, wrap) {   // a read every 3-5 s, an act every 15-30 s (every 4th a say), one command at a time
  let nr = Math.floor(Math.random() * SB_READS.length), na = 0, nextRead = now() + Math.random() * 4000, nextAct = now() + 5000 + Math.random() * 25_000;
  return (async () => {
    while (!run.stopped) {
      const due = Math.min(nextRead, nextAct); if (now() < due) { await sleep(Math.min(1000, due - now())); continue; }
      const isAct = nextAct <= nextRead, t = now();
      if (isAct) nextAct = t + 15_000 + Math.random() * 15_000; else nextRead = t + 3000 + Math.random() * 2000;
      if (run.mode === 'idle') continue;
      const op = isAct ? (na % 4 === 3 ? 'say' : 'act') : SB_READS[nr++ % SB_READS.length], n = isAct ? na++ : nr;
      if (soul.cli) { const args = argsFor(op, n), deadline = CLASS[op] === 'C1' ? 90_000 : 60_000; await (wrap ? oldWrapper(soul, args, deadline, run.rec, () => run.stopped) : runCli(soul, args, deadline, run.rec)); }
      else await rawCmd(run, soul, op, n);
    }
  })();
}
function rawListen(run, soul) {   // the CLI's listen loop, in process: one held 50 s long-poll, backs off on busy/errors
  (async () => {
    let attempt = 0;
    run.maxListens[soul.i] = 1;
    while (!run.stopped) {
      try {
        const r = await fetch(`${BASE}/v1/edge/inbox/listen?timeoutMs=50000`, { headers: rawHeaders(soul), signal: AbortSignal.timeout(60_000) });
        await r.json().catch(() => ({}));
        if (r.status === 409) run.listenExits.push({ soul: soul.i, code: 409, superseded: true });
        if (r.status === 429 || r.status >= 500) { const ra = Number(r.headers.get('retry-after')); await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.random() * 1000 * 2 ** Math.min(6, attempt++)); } else attempt = 0;
      } catch { await sleep(Math.random() * 1000 * 2 ** Math.min(6, attempt++)); }
    }
  })();
}
async function getJ(url, headers = {}, ms = 5000) {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) }); return { status: r.status, headers: r.headers, j: await r.json().catch(() => null) }; } catch { return { status: 0, j: null }; }
}
// the read pool as the bench sees it: ports from children.json (else live.json), each worker's own /healthz/read
function readPorts(w) { const rec = worldRec(w.ldata); if (rec?.readPorts?.length) return rec.readPorts; try { return JSON.parse(readFileSync(join(w.data, 'live.json'), 'utf8')).read?.ports ?? []; } catch { return []; } }
async function workerStats(w) {
  const out = [];
  for (const port of readPorts(w)) { const r = await getJ(`http://127.0.0.1:${port}/healthz/read`, {}, 2000); const d = r.j;
    out.push(d ? { port, ok: !!d.ok, served: d.served ?? 0, forwarded: d.forwarded ?? 0, lagGens: d.lagGens ?? null, mode: d.mode ?? null, threadCpuMs: d.read?.threadCpuMs ?? null, fallbacks: d.read?.fallbacks ?? null, ready: d.read?.ready ?? null } : { port, ok: false }); }
  return out;
}
async function launcherReadMetrics() {   // sim_world_read_routed_total / _fallback_total (launcher loopback /__sim/metrics), summed over labels
  try { const t = await (await fetch(`http://127.0.0.1:${PORT}/__sim/metrics`, { signal: AbortSignal.timeout(5000) })).text(), sum = (name) => t.split('\n').filter((l) => l.startsWith(name)).reduce((s, l) => s + (Number(l.trim().split(/\s+/).at(-1)) || 0), 0);
    return { routed: sum('sim_world_read_routed_total'), fallback: sum('sim_world_read_fallback_total') }; } catch { return null; }
}
// B-facade's HTTP cross-thread compare (a harness script kept outside the repo): main's own `here` on the world's port, then the
// worker's on its port, same Soul, a few ms apart; field-compared when both answer at the same tick and the worker computed
// its answer itself (x-sim-read-cpu-ms). `here` is the one read a mode-2 worker computes over HTTP; it forwards the rest to main.
function diffFields(a, b, path = '', out = [], max = 50) {   // = apps/server/src/split/read-oracle.ts diffFields
  if (out.length >= max || Object.is(a, b)) return out;
  const ao = a !== null && typeof a === 'object', bo = b !== null && typeof b === 'object';
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b)) { out.push({ path: path || '.', live: a, replica: b }); return out; }
  if (Array.isArray(a)) { for (let i = 0; i < Math.max(a.length, b.length); i++) { if (i >= a.length || i >= b.length) { out.push({ path: `${path}[${i}]`, live: a[i], replica: b[i] }); break; } diffFields(a[i], b[i], `${path}[${i}]`, out, max); } return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (a[k] === undefined && b[k] === undefined) continue; diffFields(a[k], b[k], path ? `${path}.${k}` : k, out, max); }
  return out;
}
async function oracleSample(run, soul) {
  const o = run.oracle, rec = worldRec(o.w.ldata), ports = readPorts(o.w); if (!rec?.port || !ports.length) { o.skipped++; return; }
  const H = { authorization: `Bearer ${soul.token}` }, path = `/w/${SLUG}/v1/edge/here?include=doHere`;
  const a = await getJ(`http://127.0.0.1:${rec.port}${path}`, H, 30_000), b = await getJ(`http://127.0.0.1:${pick(ports)}${path}`, H, 30_000);
  o.sampled++;
  if (a.status !== 200 || b.status !== 200 || b.headers?.get?.('x-sim-read-cpu-ms') == null) { o.notServed++; return; }
  if (a.j?.tick !== b.j?.tick) { o.tickMoved++; return; }
  const strip = (j) => { const { inbox: _i, ...rest } = j; return rest; }, d = diffFields(strip(a.j), strip(b.j)); o.compared++;
  if (!d.length) { o.equal++; return; }
  const k = d[0].path.replace(/\[\d+\]/g, '[]'); o.paths[k] = (o.paths[k] ?? 0) + 1; if (o.examples.length < 3) o.examples.push(d.slice(0, 3).map((x) => ({ path: x.path, live: JSON.stringify(x.live)?.slice(0, 120), replica: JSON.stringify(x.replica)?.slice(0, 120) })));
}

// ------------------------------------------------------------------ one run
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
async function oneRun(arm, rep, mode = null) {
  const key = mode ? `${arm}@${mode}` : arm, dir = join(OUT, `${arm}${mode ? `-${mode}` : ''}-r${rep}`); mkdirSync(dir, { recursive: true });
  const N = arm.startsWith('n') ? Number(arm.slice(1)) : 6, hello = await helloText(), SB = LOAD === 'stageb', cliN = !SB ? N : arm === 'incident' ? N : Math.min(N, CLI_SOULS);
  const run = { dir, stopped: false, mode: 'join', procs: new Set(), sockets: [], wsBytes: 0, maxListens: {}, listenExits: [], hostile: { ok: 0, refused: 0, error5xx: 0, other4xx: 0, failed: 0, ms: [] }, rec: null };
  const cmds = [], health = [], heap = [], proc = [], wstats = [];
  const loadBefore = loadavg();
  log(`${key} r${rep}: boot`);
  const w = await bootWorld(dir, { rw: mode });
  log(`${key} r${rep}: up ${w.bootS.toFixed(1)} s, catch-up ${w.catchUpS.toFixed(1)} s, pid ${w.pid}${w.pins?.length ? `, cpus ${w.pins.at(-1).allowed ?? CPUS}` : ''}`);
  run.oracle = mode === 'on' ? { w, sampled: 0, compared: 0, equal: 0, tickMoved: 0, notServed: 0, skipped: 0, paths: {}, examples: [] } : null;
  const insp = VIA ? null : await inspector().catch(() => null);
  let phase = 'join';
  run.rec = (r) => { r.phase = phase; cmds.push(r); appendFileSync(join(dir, 'commands.jsonl'), JSON.stringify(r) + '\n'); };
  const sampler = setInterval(async () => { const h = await healthz(); health.push({ at: now(), phase, ...h }); }, 1000);
  const sampler2 = setInterval(async () => { const p = procStats(w.pid), hm = insp ? await insp.heapMb() : VIA ? liveHeapMb(w) : null, lp = w.launcherPid ? procStats(w.launcherPid) : null;
    if (w.pins) pinWorld(w.ldata, w.pins);
    proc.push({ at: now(), phase, ...p, heapMb: hm, ...(lp ? { launcherCpuS: lp.cpuS, launcherRssMb: lp.rssMb } : {}) }); }, 2000);
  const sampler3 = mode === 'on' ? setInterval(async () => { wstats.push({ at: now(), phase, workers: await workerStats(w) }); }, 2000) : null;
  const souls = [];
  try {
    const tj = now();
    for (let i = 0; i < N; i += JOIN_PAR) souls.push(...await Promise.all(Array.from({ length: Math.min(JOIN_PAR, N - i) }, (_, k) => join_(run, i + k))));
    souls.forEach((s) => { s.cli = s.i < cliN; }); run.joinS = (now() - tj) / 1000;
    log(`${key} r${rep}: ${N} Souls joined (${cliN} CLI, ${N - cliN} raw)`);
    if (cliN) await learnWalkIds(souls.find((s) => s.cli));
    const relaunch = souls.map((s) => s.cli ? holdListen(run, s) : (rawListen(run, s), () => {}));
    if (SB) for (let v = 0; v < VIEWERS; v++) viewer(run, hello); else for (const s of souls) { waitStream(run, s); viewer(run, hello); }
    run.mode = 'idle'; const loops = souls.map((s) => SB ? sbLoop(run, s, arm === 'incident') : soulLoop(run, s, arm === 'incident'));
    if (GREEN_GATE_S > 0) { phase = 'gate'; run.gate = await greenGate(health); log(`${key} r${rep}: ${run.gate.ok ? `green for ${GREEN_HOLD_S} s after ${run.gate.waitedS} s` : `NOT green after ${run.gate.waitedS} s (levels ${JSON.stringify(run.gate.levels)}); windows start anyway, labelled`}`); }
    const relauncher = arm === 'incident' ? setInterval(() => { for (let i = 0; i < 3; i++) relaunch[i](); }, 20_000) : null;
    const window = async (name, s, m) => { phase = name; run.mode = m; const m0 = mode ? await launcherReadMetrics() : null, t = now(); await sleep(s * 1000); const m1 = mode ? await launcherReadMetrics() : null;
      return { name, from: t, to: now(), ...(m0 && m1 ? { routed: m1.routed - m0.routed, fallback: m1.fallback - m0.fallback } : {}) }; };
    // warm-up (load on), idle (load off), then two active windows
    run.mode = 'active'; if (arm === 'hostile') for (const s of souls) hostile(run, s);
    const windows = [await window('warm', PH.warm, 'active'), await window('idle', PH.idle, 'idle'), await window('activeA', PH.active, 'active'), await window('activeB', PH.active, 'active')];
    if (relauncher) clearInterval(relauncher);
    run.stopped = true; phase = 'drain';
    await Promise.race([Promise.all(loops), sleep(20_000)]);
    let calibration = null;
    if (arm === 'n1') calibration = await calibrate(souls[0], w, proc, windows.find((x) => x.name === 'idle'), (p) => { phase = p; });
    const result = summarize({ arm, rep, N, w, windows, cmds, health, proc, run, calibration, loadBefore, loadAfter: loadavg() });
    if (SB) Object.assign(result, stagebSummary({ key, mode, cliN, windows, cmds, proc, wstats, run, w }));
    if (VIA) result.launcher = await launcherView();
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 1));
    log(`${key} r${rep}: ${JSON.stringify(result.headline)}${result.stageb ? ` ${JSON.stringify(result.stageb.headline)}` : ''}`);
    return result;
  } finally {
    run.stopped = true; clearInterval(sampler); clearInterval(sampler2); if (sampler3) clearInterval(sampler3); insp?.close();
    for (const p of run.procs) try { p.kill('SIGTERM'); } catch { /* gone */ }
    for (const s of run.sockets) try { s.close(); } catch { /* closed */ }
    await stopWorld(w);
  }
}
async function greenGate(health) {   // waits (Souls idle) until every /healthz sample of the last GREEN_HOLD_S s says green
  const t = now();
  for (;;) {
    await sleep(1000);
    const from = now() - GREEN_HOLD_S * 1000, tail = health.filter((x) => x.at >= Math.max(t, from));
    if (now() - t >= GREEN_HOLD_S * 1000 && tail.length >= GREEN_HOLD_S / 2 && tail.every((x) => x.ok && (x.level ?? 'green') === 'green')) return { ok: true, waitedS: +((now() - t) / 1000).toFixed(1) };
    if (now() - t >= GREEN_GATE_S * 1000) return { ok: false, waitedS: +((now() - t) / 1000).toFixed(1), levels: levelShare(health.filter((x) => x.at >= t)) };
  }
}
function levelShare(h) { const out = {}; const k = h.filter((x) => x.level); for (const x of k) out[x.level] = (out[x.level] ?? 0) + 1; for (const l in out) out[l] = +(out[l] / k.length).toFixed(3); return k.length ? out : null; }
async function helloText() {
  try { const { anonymousHello } = await import(pathToFileURL(join(ROOT, 'packages/client/src/hello.ts')).href); return anonymousHello(false); }
  catch { return JSON.stringify({ t: 'hello' }); }
}
async function calibrate(soul, w, proc, idleWin, setPhase) {   // M7: CPU-s per request class, 20 serial requests each, one Soul
  const idle = proc.filter((p) => p.at >= idleWin.from && p.at <= idleWin.to && p.cpuS != null);
  const idleRate = idle.length > 1 ? (idle.at(-1).cpuS - idle[0].cpuS) / ((idle.at(-1).at - idle[0].at) / 1000) : 0;
  const out = { idleCpuSPerS: idleRate };
  for (const op of ['here', 'observe', 'caps', 'resolve', 'around', 'act', 'say']) {
    setPhase(`calib-${op}`);
    const a = procStats(w.pid), t = now(), ms = [];
    let refused = 0;
    for (let i = 0; i < PH.calib; i++) { const r = await runCli(soul, argsFor(op, i), 60_000); ms.push(r.ms); if (r.outcome === 'refused') { refused++; log(`calibration act refused: ${r.target} ${r.refusal}`); } }
    const b = procStats(w.pid), el = (now() - t) / 1000;
    out[op] = { cpuSPerReq: +(((b.cpuS - a.cpuS) - idleRate * el) / PH.calib).toFixed(4), p50Ms: pct(ms, 0.5), ...(refused ? { refused } : {}) };
  }
  return out;
}
function summarize({ arm, rep, N, w, windows, cmds, health, proc, run, calibration, loadBefore, loadAfter }) {
  const win = (name) => windows.find((x) => x.name === name), inW = (x, wd) => x.at >= wd.from && x.at <= wd.to;
  const perWindow = {};
  for (const name of ['idle', 'activeA', 'activeB']) {
    const wd = win(name), h = health.filter((x) => inW(x, wd)), hk = h.filter((x) => x.ok && x.tick != null), p = proc.filter((x) => inW(x, wd) && x.cpuS != null);
    const anyRaw = cmds.some((x) => x.raw), sel = (x) => LOAD !== 'stageb' || !anyRaw || x.raw;   // v2: the raw Souls' request times (no CLI start-up)
    const c = cmds.filter((x) => inW(x, wd)), C1 = c.filter((x) => x.cls === 'C1' && x.outcome !== 'timeout' && sel(x)), C2 = c.filter((x) => x.cls === 'C2' && x.outcome !== 'timeout' && sel(x));
    const secs = (wd.to - wd.from) / 1000, ticks = hk.length > 1 ? hk.at(-1).tick - hk[0].tick : null, tspan = hk.length > 1 ? (hk.at(-1).at - hk[0].at) / 1000 : null;
    const outcomes = {}; for (const x of c) { outcomes[x.cls] ??= {}; outcomes[x.cls][x.outcome] = (outcomes[x.cls][x.outcome] ?? 0) + 1; }
    perWindow[name] = {
      seconds: secs, tickService: ticks != null ? +(ticks / (tspan * TICK_HZ)).toFixed(3) : null,
      healthzP99Ms: pct(h.map((x) => x.ms), 0.99), healthzWithin1s: h.length ? +(h.filter((x) => x.ok && x.ms <= 1000).length / h.length).toFixed(3) : null,
      actP99Ms: pct(C1.map((x) => x.ms), 0.99), readP99Ms: pct(C2.map((x) => x.ms), 0.99), actP50Ms: pct(C1.map((x) => x.ms), 0.5), readP50Ms: pct(C2.map((x) => x.ms), 0.5),
      cpuSPerS: p.length > 1 ? +((p.at(-1).cpuS - p[0].cpuS) / ((p.at(-1).at - p[0].at) / 1000)).toFixed(3) : null,
      ...(p.length > 1 && p[0].launcherCpuS != null ? { launcherCpuSPerS: +((p.at(-1).launcherCpuS - p[0].launcherCpuS) / ((p.at(-1).at - p[0].at) / 1000)).toFixed(3) } : {}),
      rssMbMean: p.length ? +(p.reduce((s, x) => s + x.rssMb, 0) / p.length).toFixed(1) : null,
      heapMbMean: p.filter((x) => x.heapMb != null).length ? +(p.filter((x) => x.heapMb != null).reduce((s, x) => s + x.heapMb, 0) / p.filter((x) => x.heapMb != null).length).toFixed(1) : null,
      commands: c.length, outcomes,
      levels: levelShare(h), service5sMin: h.some((x) => x.service5s != null) ? Math.min(...h.filter((x) => x.service5s != null).map((x) => x.service5s)) : null,
      tickP99MaxMs: h.some((x) => x.tickP99Ms != null) ? Math.max(...h.filter((x) => x.tickP99Ms != null).map((x) => x.tickP99Ms)) : null,
      queueOldestMaxMs: h.some((x) => x.queueOldestMs != null) ? Math.max(...h.filter((x) => x.queueOldestMs != null).map((x) => x.queueOldestMs)) : null,
    };
  }
  // M5 wedge: longest span after boot with no healthz answer
  let gap = 0, last = health[0]?.at ?? 0; for (const h of health) { if (h.ok) { gap = Math.max(gap, h.at - last); last = h.at; } } gap = Math.max(gap, (health.at(-1)?.at ?? last) - last);
  const heaps = proc.map((x) => x.heapMb).filter((x) => x != null), heapPeak = heaps.length ? Math.max(...heaps) : null, rssPeak = Math.max(0, ...proc.map((x) => x.rssMb ?? 0));
  const worse = (k, hi) => { const a = perWindow.activeA[k], b = perWindow.activeB[k]; if (a == null) return b; if (b == null) return a; return hi ? Math.max(a, b) : Math.min(a, b); };
  const all = cmds.filter((x) => x.phase !== 'join'), timeouts = all.filter((x) => x.outcome === 'timeout').length;
  const headline = { N, tickService: worse('tickService', false), healthzP99Ms: worse('healthzP99Ms', true), actP99Ms: worse('actP99Ms', true), readP99Ms: worse('readP99Ms', true),
    heapPeakMb: heapPeak == null ? null : +heapPeak.toFixed(1), heapPeakPctCap: heapPeak == null ? null : +(100 * heapPeak / HEAP_MB).toFixed(1), rssPeakMb: +rssPeak.toFixed(1), wedge: gap >= 30_000, longestHealthzGapS: +(gap / 1000).toFixed(1),
    timeouts, idleCpuSPerS: perWindow.idle.cpuSPerS, activeCpuSPerS: worse('cpuSPerS', true), idleRssMb: perWindow.idle.rssMbMean, idleHeapMb: perWindow.idle.heapMbMean,
    maxListenersPerSoul: Math.max(0, ...Object.values(run.maxListens)), listenSuperseded: run.listenExits.filter((x) => x.superseded).length, listenAlready: run.listenExits.filter((x) => x.already).length };
  const h = run.hostile; const hostile = arm === 'hostile' ? { ok: h.ok, refused: h.refused, error5xx: h.error5xx, other4xx: h.other4xx, failed: h.failed, requests: h.ms.length, p99Ms: pct(h.ms, 0.99) } : undefined;
  return { arm, rep, N, bootS: w.bootS, catchUpS: w.catchUpS, headline, windows: perWindow, ...(hostile ? { hostile } : {}), ...(calibration ? { calibration } : {}), wsBytes: run.wsBytes, loadBefore, loadAfter };
}

// METRICS.md v2 extras per window (worse of the active windows in the headline): raw/CLI split, per-read p99, the
// worker's share, fallbacks, worker vs main CPU, the oracle sample
function stagebSummary({ key, mode, cliN, windows, cmds, proc, wstats, run, w }) {
  const inW = (x, wd) => x.at >= wd.from && x.at <= wd.to, per = {};
  for (const wd of windows.filter((x) => x.name !== 'warm')) {
    const c = cmds.filter((x) => inW(x, wd) && x.outcome !== 'timeout'), raw = c.filter((x) => x.raw), cli = c.filter((x) => !x.raw);
    // r3: p99/p50 = wall time incl. designed Retry-After waits and final refusals (as before); okP99 = answered (2xx) only,
    // with the waits before the answer taken out (the world's/launcher's service time as the Soul saw it)
    const okMs = (v) => v.filter((x) => x.outcome === 'ok').map((x) => x.ms - (x.waitMs ?? 0));
    const byKind = {}; for (const k of ['here', 'observe', 'caps', 'resolve', 'around', 'act', 'say']) { const v = raw.filter((x) => x.cmd === k); if (v.length) byKind[k] = { n: v.length, p50: pct(v.map((x) => x.ms), 0.5), p99: pct(v.map((x) => x.ms), 0.99), ok: v.filter((x) => x.outcome === 'ok').length, okP50: pct(okMs(v), 0.5), okP99: pct(okMs(v), 0.99), refused: v.filter((x) => x.outcome === 'refused').length, ...(k === 'here' ? { onWorker: v.filter((x) => x.worker).length } : {}) }; }
    const refusalsByTag = {}; for (const x of raw) for (const tag of x.refusals ?? []) refusalsByTag[tag] = (refusalsByTag[tag] ?? 0) + 1;
    const all = cmds.filter((x) => inW(x, wd)), rawC2 = all.filter((x) => x.raw && x.cls === 'C2');
    const p = proc.filter((x) => inW(x, wd) && x.cpuS != null), procCpu = p.length > 1 ? (p.at(-1).cpuS - p[0].cpuS) / ((p.at(-1).at - p[0].at) / 1000) : null;
    let served = 0, forwarded = 0, wcpu = 0, wspan = 0, lagMax = 0, restarts = 0;
    const ws = wstats.filter((x) => inW(x, wd));
    if (ws.length > 1) {
      const ports = new Set(ws.flatMap((x) => x.workers.map((y) => y.port)));
      for (const port of ports) {
        const seq = ws.map((x) => ({ at: x.at, s: x.workers.find((y) => y.port === port && y.ok) })).filter((x) => x.s);
        for (let i = 1; i < seq.length; i++) { const a = seq[i - 1].s, b = seq[i].s; if (b.served < a.served || (b.threadCpuMs ?? 0) < (a.threadCpuMs ?? 0)) { restarts++; continue; }   // a restarted worker: its counters start over
          served += b.served - a.served; forwarded += b.forwarded - a.forwarded; wcpu += (b.threadCpuMs ?? 0) - (a.threadCpuMs ?? 0); }
        if (seq.length > 1) wspan = Math.max(wspan, (seq.at(-1).at - seq[0].at) / 1000);
        for (const x of seq) lagMax = Math.max(lagMax, x.s.lagGens ?? 0);
      }
    }
    const workerCpu = mode === 'on' && wspan ? wcpu / 1000 / wspan : mode === 'on' ? null : 0;
    per[wd.name] = {
      rawReadP99Ms: pct(raw.filter((x) => x.cls === 'C2').map((x) => x.ms), 0.99), rawReadP50Ms: pct(raw.filter((x) => x.cls === 'C2').map((x) => x.ms), 0.5), rawActP99Ms: pct(raw.filter((x) => x.cls === 'C1').map((x) => x.ms), 0.99),
      cliReadP99Ms: pct(cli.filter((x) => x.cls === 'C2').map((x) => x.ms), 0.99), cliActP99Ms: pct(cli.filter((x) => x.cls === 'C1').map((x) => x.ms), 0.99),
      rawReadOkP99Ms: pct(okMs(raw.filter((x) => x.cls === 'C2')), 0.99), rawReadOkP50Ms: pct(okMs(raw.filter((x) => x.cls === 'C2')), 0.5), rawActOkP99Ms: pct(okMs(raw.filter((x) => x.cls === 'C1')), 0.99),
      rawReadWaitedShare: rawC2.length ? +(rawC2.filter((x) => x.busyWaits).length / rawC2.length).toFixed(3) : null, refusalsByTag,
      byKind, readsPerS: +(rawC2.length / ((wd.to - wd.from) / 1000)).toFixed(2), rawReadRefusedShare: rawC2.length ? +(rawC2.filter((x) => x.outcome === 'refused').length / rawC2.length).toFixed(3) : null,
      timeouts: all.filter((x) => x.outcome === 'timeout').length, errors: all.filter((x) => x.outcome === 'error' || x.outcome === 'unreachable').length,
      ...(mode ? { routed: wd.routed ?? null, fallbacks: wd.fallback ?? null } : {}),
      ...(mode === 'on' ? { workerServed: served, workerForwarded: forwarded, workerServedShare: served + forwarded ? +(served / (served + forwarded)).toFixed(3) : null, workerRestarts: restarts, lagGensMax: lagMax } : {}),
      processCpuSPerS: procCpu == null ? null : +procCpu.toFixed(3), workerCpuSPerS: workerCpu == null ? null : +workerCpu.toFixed(3), mainCpuSPerS: procCpu == null || workerCpu == null ? null : +(procCpu - workerCpu).toFixed(3),
    };
  }
  const A = per.activeA ?? {}, B = per.activeB ?? {}, worse = (k, hi) => { const v = [A[k], B[k]].filter((x) => x != null); return v.length ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
  const sum = (k) => [A[k], B[k]].some((x) => x != null) ? (A[k] ?? 0) + (B[k] ?? 0) : null, o = run.oracle;
  const kinds = {}; for (const k of ['here', 'observe', 'caps', 'resolve', 'around', 'act', 'say']) { const v = [A.byKind?.[k]?.p99, B.byKind?.[k]?.p99].filter((x) => x != null); if (v.length) kinds[k] = Math.max(...v); }
  const hereN = (A.byKind?.here?.n ?? 0) + (B.byKind?.here?.n ?? 0), hereW = (A.byKind?.here?.onWorker ?? 0) + (B.byKind?.here?.onWorker ?? 0);
  return { stageb: { key, mode, cliSouls: cliN, joinS: run.joinS ?? null, joinRetries: run.joinRetries ?? 0, windows: per, pins: w.pins ?? null,
    gate: run.gate ?? null,
    headline: { rawReadOkP99Ms: worse('rawReadOkP99Ms', true), rawActOkP99Ms: worse('rawActOkP99Ms', true), rawReadWaitedShare: worse('rawReadWaitedShare', true), rawReadP99Ms: worse('rawReadP99Ms', true), rawActP99Ms: worse('rawActP99Ms', true), cliReadP99Ms: worse('cliReadP99Ms', true), cliActP99Ms: worse('cliActP99Ms', true), readP99ByKind: kinds,
      readsPerS: worse('readsPerS', false), rawReadRefusedShare: worse('rawReadRefusedShare', true), timeouts: sum('timeouts'), errors: sum('errors'),
      routed: sum('routed'), fallbacks: sum('fallbacks'), workerServedShare: worse('workerServedShare', false), hereOnWorkerShare: mode === 'on' && hereN ? +(hereW / hereN).toFixed(3) : null,
      workerRestarts: sum('workerRestarts'), lagGensMax: worse('lagGensMax', true), processCpuSPerS: worse('processCpuSPerS', true), workerCpuSPerS: worse('workerCpuSPerS', true), mainCpuSPerS: worse('mainCpuSPerS', true),
      idleProcessCpuSPerS: per.idle?.processCpuSPerS ?? null, idleWorkerCpuSPerS: per.idle?.workerCpuSPerS ?? null,
      oracle: o ? { rate: ORACLE_RATE, sampled: o.sampled, compared: o.compared, equal: o.equal, tickMoved: o.tickMoved, notServed: o.notServed, skipped: o.skipped, paths: o.paths, examples: o.examples } : null } } };
}

// ------------------------------------------------------------------ main
const startup = []; for (let i = 0; i < 10; i++) { const t = now(); execFileSync(process.execPath, [CLI_FILE, 'version'], { stdio: 'ignore' }); startup.push(now() - t); }
host.cliStartupMedianMs = pct(startup, 0.5);
log(`bench: ${ARMS.join(',')} x${REPEATS} on ${HOST_LABEL}${host.indicative ? ' (INDICATIVE)' : ''}, source ${host.sourceSha?.slice(0, 9)}, fixture ${host.fixtureSha256.slice(0, 12)}, world ${WORLD_ID}`);
// preflight: boot the fixture once, 10 s up and answering, so a bad setup fails in seconds, not after every arm
{
  const dir = join(OUT, 'preflight'); mkdirSync(dir, { recursive: true });
  let w;
  try {
    const t = now(); w = await bootWorld(dir, { settle: false, rw: MODES.at(-1) });   // the last mode (on, when on is run): a world that will not boot with its workers fails here await sleep(10_000);
    const h = await healthz(); if (!h.ok || w.child.exitCode != null) throw new Error(`world not answering 10 s after boot; ${dir}/world.log`);
    log(`preflight ok: up ${w.bootS.toFixed(1)} s, tick ${h.tick}, ${((now() - t) / 1000).toFixed(0)} s`);
  } catch (e) { log(`PREFLIGHT FAILED: ${e.message}`); if (w) await stopWorld(w); process.exit(1); }
  await stopWorld(w);
}
const results = [];
const KEYS = ARMS.flatMap((a) => MODES.map((m) => (m ? `${a}@${m}` : a)));
for (let rep = 1; rep <= REPEATS; rep++) for (const arm of ARMS) for (const mode of MODES) {   // a pair (off, on) back to back: drift hits both sides
  const key = mode ? `${arm}@${mode}` : arm;
  try { const r = await oneRun(arm, rep, mode); r.key = key; r.mode = mode; results.push(r); } catch (e) { log(`${key} r${rep}: FAILED ${e.message}`); results.push({ arm, key, mode, rep, failed: String(e.message) }); }
}
const receipt = { v: LOAD === 'stageb' ? 2 : 1, metrics: `tools/bench/capacity/METRICS.md ${LOAD === 'stageb' ? 'v2 (Stage B)' : 'v1'}`, at: new Date().toISOString(), host, arms: KEYS, repeats: REPEATS,
  results: results.map((r) => ({ arm: r.key ?? r.arm, rep: r.rep, failed: r.failed, headline: r.headline, ...(r.stageb ? { stageb: r.stageb.headline } : {}) })) };
writeFileSync(join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 1));
writeFileSync(join(OUT, 'REPORT.md'), report(receipt, results));
log(`done: ${join(OUT, 'REPORT.md')}`);
process.exit(0);
