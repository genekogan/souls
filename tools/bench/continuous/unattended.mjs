#!/usr/bin/env node
// CW6 (#740): does a world's simulation advance at its configured rate with nobody there? A real launcher on an isolated
// data directory (fake minds, free ports) gets worlds, is restarted so none has been visited in its run, and then:
// `control` is attended (a request every 10 s), every other world is left completely alone (no socket, request or agent).
// The harness only reads each world's live.json file (passive: never a visitor) and compares actual ticks with the ticks
// due from its own monotonic clock at the admin rate (20 ticks/s × rate 1), independent of the attention pace and of
// the load monitor's clipped service ratio. At the end it visits each world once (the return) and reads the world logs
// for a clock catch-up jump.
//
//   node tools/bench/continuous/unattended.mjs --minutes 75 [--continuous] [--sleep-ms N --idle-exit-min M] [--out f.json]
//
// Without --continuous the launcher's idle policy (attention pace, freeze, exit) is in force: the contrast arm.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';

const ROOT = resolve(new URL('../../../', import.meta.url).pathname);
const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; }, has = (k) => argv.includes(`--${k}`);
const MINUTES = Number(flag('minutes') ?? 75), CONTINUOUS = has('continuous'), TICK_HZ = 20, RATE = 1, SAMPLE_MS = Number(flag('sample-ms') ?? 15_000), WINDOW_MS = Number(flag('window-ms') ?? 300_000);
const NAMES = (flag('worlds') ?? 'Control,Alone,Never').split(',');
const label = flag('label') ?? (CONTINUOUS ? 'continuous' : 'idle-policy');
const dir = join(ROOT, '.local', `cw6-${label}-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const free = (p) => new Promise((yes) => { const s = createServer(); s.once('error', () => yes(false)); s.listen(p, '127.0.0.1', () => s.close(() => yes(true))); });
async function range(n) { for (let t = 0; t < 200; t++) { const base = 20_000 + Math.floor(Math.random() * 20_000); let ok = true; for (let i = 0; i < n && ok; i++) ok = await free(base + i); if (ok) return base; } throw new Error('no free port range'); }

const log = (m) => console.log(`[${((performance.now() - T0) / 60_000).toFixed(1)} min] ${m}`);
let T0 = performance.now(), T0wall = Date.now(), launcher = null;
function start(port, lo, hi) {
  const args = ['tools/world-launcher/launcher.mjs', '--port', String(port), '--data', join(dir, 'data'), '--range', `${lo}-${hi}`, '--eager', '0', ...(CONTINUOUS ? ['--continuous'] : []),
    ...(flag('sleep-ms') ? ['--sleep-ms', flag('sleep-ms')] : []), ...(flag('idle-exit-min') ? ['--idle-exit-min', flag('idle-exit-min')] : [])];
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, BRAIN_MODE: 'fake', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', SIM_PREWARM: '0' };
  const c = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', (b) => { for (const l of String(b).split('\n')) if (/asleep|gave its memory|starting it|continuous|woke|could not|took|caught up/.test(l)) log(`launcher: ${l.trim()}`); });
  c.stderr.on('data', () => {});
  return c;
}
async function up(base) { for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/__sim/healthz`)).ok) return; } catch { /* not yet */ } await sleep(500); } throw new Error('launcher did not come up'); }
const stop = async (c) => { if (!c || c.exitCode !== null) return; c.kill('SIGTERM'); for (let i = 0; i < 100 && c.exitCode === null; i++) await sleep(100); if (c.exitCode === null) c.kill('SIGKILL'); };
const liveOf = (slug) => { try { return JSON.parse(readFileSync(join(dir, 'data', 'worlds', slug, 'live.json'), 'utf8')); } catch { return null; } };

async function main() {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const port = (await range(1)), lo = await range(2 * NAMES.length + 2), hi = lo + 2 * NAMES.length + 1, base = `http://127.0.0.1:${port}`;
  // 1. register the worlds (creation boots them), then restart the launcher: in its new run, nobody has visited any
  launcher = start(port, lo, hi); await up(base);
  const slugs = [];
  for (const name of NAMES) { const r = await fetch(`${base}/__sim/worlds`, { method: 'POST', body: JSON.stringify({ name }) }); const j = await r.json(); if (r.status !== 201) throw new Error(`create ${name}: ${r.status} ${JSON.stringify(j)}`); slugs.push(j.slug ?? j.world?.slug); }
  log(`created ${slugs.join(', ')}; restarting the launcher so none has been visited in its run`);
  await stop(launcher); await sleep(1000);
  T0 = performance.now(); T0wall = Date.now(); launcher = start(port, lo, hi); await up(base);
  const [control, ...alone] = slugs;
  // 2. the control is attended; the rest are left alone; live.json files are read (passive)
  const attend = setInterval(() => { fetch(`${base}/w/${control}/v1/config`).then((r) => r.arrayBuffer()).catch(() => {}); }, 10_000);
  const samples = Object.fromEntries(slugs.map((s) => [s, []]));
  const take = () => { const t = performance.now(); for (const s of slugs) { const l = liveOf(s); samples[s].push({ t: Math.round(t), pid: l?.pid ?? null, phase: l?.phase ?? null, tick: l?.tick?.world ?? null, at: l?.at ?? null }); } };
  const timer = setInterval(take, SAMPLE_MS); take();
  const load = [];
  const loadTimer = setInterval(() => load.push({ t: Math.round(performance.now() - T0), load1: loadavg()[0] }), 60_000);
  const endAt = T0 + MINUTES * 60_000;
  while (performance.now() < endAt) { await sleep(Math.min(60_000, endAt - performance.now())); const s = slugs.map((x) => `${x}=${samples[x].at(-1)?.tick ?? '-'}`).join(' '); log(`ticks ${s} (load ${loadavg()[0].toFixed(1)})`); }
  clearInterval(timer); clearInterval(attend); clearInterval(loadTimer); take();
  // 3. the return: one visit each; how long it takes, and whether the world clock jumped
  const back = {};
  for (const s of alone) { const t = performance.now(); let status = 0; try { const r = await fetch(`${base}/w/${s}/v1/config`, { signal: AbortSignal.timeout(120_000) }); status = r.status; await r.arrayBuffer(); } catch (e) { status = String(e.message); } back[s] = { status, ms: Math.round(performance.now() - t) }; }
  await sleep(3000);
  const logText = (s) => { const f = join(dir, 'data', 'logs', `${s}.log`); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
  // 4. verdict per world: windows of WINDOW_MS, actual ÷ due, the largest gap between tick advances, pid changes
  const out = { tool: 'cw6-unattended/1', label, continuous: CONTINUOUS, minutes: MINUTES, sampleMs: SAMPLE_MS, windowMs: WINDOW_MS, tickHz: TICK_HZ, rate: RATE, cores: cpus().length, load, worlds: {} };
  for (const s of slugs) {
    // from the world's first serving live.json of this launcher run (a file left by the previous run is not this process)
    const xs = samples[s].filter((x) => x.tick !== null && x.phase === 'serving' && x.at >= T0wall), windows = [];
    for (let i = 0, j = 0; i < xs.length; i = j) { while (j < xs.length && xs[j].t - xs[i].t < WINDOW_MS) j++; if (j >= xs.length) break; const a = xs[i], b = xs[j]; windows.push({ fromMin: +((a.t - T0) / 60_000).toFixed(1), ratio: +((b.tick - a.tick) / (((b.t - a.t) / 1000) * TICK_HZ * RATE)).toFixed(4), pidChanged: a.pid !== b.pid }); }
    let gap = 0, last = xs[0]; for (const x of xs) { if (x.tick > (last?.tick ?? -1)) { gap = Math.max(gap, x.t - last.t); last = x; } } gap = Math.max(gap, (xs.at(-1)?.t ?? 0) - (last?.t ?? 0));
    const first = xs[0], end = xs.at(-1), total = first && end ? (end.tick - first.tick) / (((end.t - first.t) / 1000) * TICK_HZ * RATE) : null;
    out.worlds[s] = { role: s === control ? 'control (attended)' : 'unattended', servingAfterS: first ? Math.round((first.t - T0) / 1000) : null, samples: xs.length, missing: samples[s].length - xs.length, pids: [...new Set(xs.map((x) => x.pid))].length, ratio: total === null ? null : +total.toFixed(4),
      minWindow: windows.length ? Math.min(...windows.map((w) => w.ratio)) : null, windowsBelow99: windows.filter((w) => w.ratio < 0.99).length, windows: windows.length, maxGapS: Math.round(gap / 1000), firstTick: first?.tick ?? null, lastTick: end?.tick ?? null,
      catchUpJumps: (logText(s).match(/\[clock\] caught up/g) ?? []).length, ...(back[s] ? { returnMs: back[s].ms, returnStatus: back[s].status } : {}) };
  }
  const ok = Object.values(out.worlds).every((w) => w.windowsBelow99 === 0 && w.windows > 0 && w.catchUpJumps === 0 && w.pids === 1);
  out.verdict = ok ? 'pass' : 'fail';
  const file = flag('out') ?? join(dir, 'result.json'); writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  log(`${out.verdict}: ${Object.entries(out.worlds).map(([s, w]) => `${s} ${w.role} ratio ${w.ratio} min window ${w.minWindow} gap ${w.maxGapS} s jumps ${w.catchUpJumps}`).join('; ')} -> ${file}`);
  await stop(launcher);
  if (!has('keep')) rmSync(join(dir, 'data'), { recursive: true, force: true });
  process.exitCode = ok ? 0 : 1;
}
main().catch(async (e) => { console.error(e); await stop(launcher); process.exitCode = 2; });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stop(launcher); process.exit(130); });
