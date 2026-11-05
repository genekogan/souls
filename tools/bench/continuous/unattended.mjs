#!/usr/bin/env node
// CW6 (#740): does a world's simulation advance at its configured rate with nobody there? A real launcher on an isolated
// data directory (fake minds, free ports) gets worlds, is restarted so none has been visited in its run, and then:
// `control` is attended (a viewer WebSocket kept open, as a page does), `alone` is visited once (one request) at the
// start and then left alone, and `never` is never visited at all (no socket, request or agent).
// The harness only reads each world's live.json file (passive: never a visitor) and compares actual ticks with the ticks
// due from its own monotonic clock at the admin rate (20 ticks/s × rate 1), independent of the attention pace and of
// the load monitor's clipped service ratio. At the end it visits each world once (the return) and reads the world logs
// for a clock catch-up jump.
//
//   node tools/bench/continuous/unattended.mjs --minutes 75 [--continuous] [--sleep-ms N --idle-exit-min M] [--out f.json]
//
// Without --continuous the launcher's idle policy (attention pace, freeze, exit) is in force: the contrast arm.
//
// --souls (A2/A3, matched ticks): before the restart each world gets one Soul, made by an agent with the world's own CLI,
// which starts one stroll (`wander:here`) and then goes away for good (the CLI is one-shot: no listen stays open). In the
// run the body is left to the world's own timed and autonomous behaviour: the stroll's RNG legs, the presence rule
// (edge/ledger/body-rule.ts: a disconnected body shuffles every 20-60 s, then lies down asleep after 30 min) and the
// minds' needs. The harness copies each periodic snapshot row (tick, engine hash, host body) from the world's database,
// read-only, as it appears, into <dir>/snapshots. After the stop, matched-tick.mjs replays the run offline from its
// first snapshot with the logged inputs and compares the engine and the minds at every snapshot tick: the state is the
// simulation of every tick, with nothing outside the log and no day-clock catch-up. The pace is judged per arm against
// the control: ticks against monotonic time (above), no input from outside the world during the measurement, and the
// ticks per wall second of the body rule's own wall-timed moves (20 × rate when the clock keeps its configured rate; a
// throttled world logs them fewer ticks apart). The agent's own `here` and `caps` after the run must show the current
// tick and the same capabilities as before (nothing was traded for the pass).
//
// --clip <world> --clip-dir <dir> [--clip-steps f.mjs] (A4): an uncut real-speed browser clip of that world after its
// Soul starts strolling in the setup run (the browser then closes), and one more as the world's first browser visit of
// the measured run, after the measurement and the return reads. Recorded with .claude/skills/proof/record.mjs.
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, openSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import { anonymousHello } from '../../../packages/client/src/hello.ts';
import { verifyMatchedTicks } from './matched-tick.mjs';

const ROOT = resolve(new URL('../../../', import.meta.url).pathname);
const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; }, has = (k) => argv.includes(`--${k}`);
const MINUTES = Number(flag('minutes') ?? 75), CONTINUOUS = has('continuous'), TICK_HZ = 20, RATE = 1 /* worlds are created at the default admin rate 1 */, SAMPLE_MS = Number(flag('sample-ms') ?? 15_000), WINDOW_MS = Number(flag('window-ms') ?? 300_000);
const NAMES = (flag('worlds') ?? 'Control,Alone,Never').split(','), SOULS = has('souls'), WANDER_S = Number(flag('wander-s') ?? 600), CLIP = flag('clip'), out0 = {};
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

// one Soul per world, made and given one stroll by an agent with the world's own CLI (one-shot calls; nothing stays open)
async function soulOf(base, slug) {
  const sd = join(dir, 'souls', slug); mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, 'eden.mjs'), Buffer.from(await (await fetch(`${base}/eden.mjs`)).arrayBuffer()));
  const cli = (...a) => execFileSync(process.execPath, ['eden.mjs', ...a], { cwd: sd, encoding: 'utf8', timeout: 180_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } });
  cli('register', `${base}/w/${slug}`);
  const made = /"id": "(s_[A-Za-z0-9_-]+)"/.exec(cli('create', `Walker ${slug}`))?.[1];
  if (!made) throw new Error(`${slug}: the Soul was not created`);
  const act = cli('act', 'wander:here', JSON.stringify({ seconds: WANDER_S }));
  (out0.agentBefore ??= {})[slug] = { capsTotal: Number(/"total": (\d+)/.exec(cli('caps'))?.[1] ?? NaN) };
  return `Soul ${made} created; act wander:here ${WANDER_S} s -> ${act.trim().split('\n').filter((l) => /status|accepted|ok|code/.test(l)).slice(0, 3).join(' ').replace(/\s+/g, ' ')}`;
}
// one uncut clip of a world page (record.mjs); the browser is closed when it returns
function clip(base, slug, phase) {
  if (!slug) throw new Error(`--clip ${CLIP}: no such world`);
  const file = join(resolve(flag('clip-dir') ?? join(dir, 'clips')), `${phase}.mp4`); mkdirSync(join(file, '..'), { recursive: true });
  const t = performance.now();
  execFileSync(process.execPath, [join(ROOT, '.claude/skills/proof/record.mjs'), '--url', `${base}/w/${slug}`, '--out', file, '--viewport', 'desktop', ...(flag('clip-steps') ? ['--steps', resolve(flag('clip-steps'))] : ['--settle-seconds', '30'])],
    { cwd: ROOT, stdio: ['ignore', openSync(file.replace(/\.mp4$/, '.log'), 'w'), openSync(file.replace(/\.mp4$/, '.log'), 'a')], timeout: 300_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) } });
  (out0.clips ??= []).push({ phase, world: slug, file: relative(ROOT, file), startedMin: +((t - T0) / 60_000).toFixed(2), tookS: Math.round((performance.now() - t) / 1000) });
  log(`clip ${phase} of ${slug} -> ${file}`);
}
// the agent's own reads after the measurement: the tick it is told and the capabilities it is offered (M4)
function agentRead(slug) {
  const sd = join(dir, 'souls', slug), cli = (...a) => { try { return execFileSync(process.execPath, ['eden.mjs', ...a], { cwd: sd, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } }); } catch (e) { return String(e.stdout ?? e.message); } };
  const here = cli('here'), caps = cli('caps'), live = liveOf(slug)?.tick?.world ?? null;
  return { hereTick: Number(/"tick": (\d+)/.exec(here)?.[1] ?? NaN), liveTick: live, activity: /"activity": \{\s*"kind": "([^"]+)"/.exec(here)?.[1] ?? null, posture: /"posture": "([^"]+)"/.exec(here)?.[1] ?? null, now: /"now": "([^"]+)"/.exec(here)?.[1] ?? null, capsTotal: Number(/"total": (\d+)/.exec(caps)?.[1] ?? NaN) };
}
// each periodic snapshot row a world saves (it keeps only its latest 5), copied as it appears; read-only, never a visitor
const snaps = {};
function captureSnapshots(slug) {
  if (!SOULS) return true;
  const file = join(dir, 'data', 'worlds', slug, 'sim.db'); if (!existsSync(file)) return false;
  const have = (snaps[slug] ??= {}), keep = join(dir, 'snapshots', slug); mkdirSync(keep, { recursive: true });
  let db; try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT world_id, tick, seq, state_hash, physical_hash, rules_version, snapshot, at FROM snapshots WHERE world_id = ? AND tick = ?');
    for (const { world_id: w, tick } of db.prepare('SELECT world_id, tick FROM snapshots').all()) {
      if (have[tick]) continue;
      const r = row.get(w, tick); if (!r) continue;   // pruned between the two reads: kept rows are 20 s+ apart, the next pass has the next one
      have[tick] = { worldId: r.world_id, tick: r.tick, seq: r.seq, stateHash: r.state_hash, physicalHash: r.physical_hash, rulesVersion: r.rules_version, at: r.at, body: JSON.parse(r.snapshot) };
      writeFileSync(join(keep, `${tick}.json`), JSON.stringify(have[tick]));   // re-verifiable later: matched-tick.mjs --snapshots
    }
    return true;
  } catch (e) { log(`snapshot read ${slug}: ${e.message} (the next pass reads it)`); return false; } finally { try { db?.close(); } catch { /* closed */ } }
}

async function main() {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const port = (await range(1)), lo = await range(2 * NAMES.length + 2), hi = lo + 2 * NAMES.length + 1, base = `http://127.0.0.1:${port}`;
  // 1. register the worlds (creation boots them), then restart the launcher: in its new run, nobody has visited any
  launcher = start(port, lo, hi); await up(base);
  const slugs = [];
  for (const name of NAMES) { const r = await fetch(`${base}/__sim/worlds`, { method: 'POST', body: JSON.stringify({ name }) }); const j = await r.json(); if (r.status !== 201) throw new Error(`create ${name}: ${r.status} ${JSON.stringify(j)}`); slugs.push(j.slug ?? j.world?.slug); }
  if (SOULS) for (const s of slugs) log(`${s}: ${await soulOf(base, s)}`);
  if (CLIP) clip(base, slugs[NAMES.indexOf(CLIP)], 'before');
  log(`created ${slugs.join(', ')}; restarting the launcher so none has been visited in its run`);
  await stop(launcher); await sleep(1000);
  // S0: the state each world stopped with, which its boot restores
  for (const s of slugs) if (SOULS && !captureSnapshots(s) && !captureSnapshots(s)) throw new Error(`${s}: could not read the snapshot its boot restores (S0)`);
  const s0Tick = Object.fromEntries(slugs.map((s) => [s, Math.max(-1, ...Object.keys(snaps[s] ?? {}).map(Number))]));
  T0 = performance.now(); T0wall = Date.now(); launcher = start(port, lo, hi); await up(base);
  const [control, ...alone] = slugs;
  // 2. the control has a viewer socket open (reopened if it closes); `alone` gets one request; live.json is read (passive)
  let viewer = null, viewerOpens = 0, attending = true;
  const watch = () => { if (!attending) return; viewerOpens++; viewer = new WebSocket(`ws://127.0.0.1:${port}/w/${control}/ws?hello=${encodeURIComponent(anonymousHello(false))}`); viewer.onclose = () => setTimeout(watch, 1000); viewer.onerror = () => {}; viewer.onmessage = () => {}; };
  watch();
  if (alone[0]) { const r = await fetch(`${base}/w/${alone[0]}/v1/world/snapshot`).catch(() => null); await r?.arrayBuffer(); log(`visited ${alone[0]} once (${r?.status ?? 'no answer'})`); }
  const samples = Object.fromEntries(slugs.map((s) => [s, []]));
  // t is the harness's monotonic time of the file's own write (read time minus the file's age, at most one write
  // interval), so the 2 s write cadence does not add 2 s of error per window; a file older than that (a frozen or exited
  // world) is read as the world's state now, so its stall shows instead of hiding behind its old timestamp
  const take = () => { for (const s of slugs) { const l = liveOf(s), now = performance.now(), age = l?.at ? Math.max(0, Date.now() - l.at) : 0; samples[s].push({ t: Math.round(now - (age <= 2500 ? age : 0)), read: Math.round(now), pid: l?.pid ?? null, phase: l?.phase ?? null, tick: l?.tick?.world ?? null, at: l?.at ?? null }); } };
  const timer = setInterval(take, SAMPLE_MS); take();
  const snapTimer = SOULS ? setInterval(() => { for (const s of slugs) captureSnapshots(s); }, 30_000) : null;
  const load = [];
  const loadTimer = setInterval(() => load.push({ t: Math.round(performance.now() - T0), load1: loadavg()[0] }), 60_000);
  const endAt = T0 + MINUTES * 60_000;
  while (performance.now() < endAt) { await sleep(Math.min(60_000, endAt - performance.now())); const s = slugs.map((x) => `${x}=${samples[x].at(-1)?.tick ?? '-'}`).join(' '); log(`ticks ${s} (load ${loadavg()[0].toFixed(1)})`); }
  clearInterval(timer); clearInterval(loadTimer); if (snapTimer) clearInterval(snapTimer); take(); attending = false; const endWall = Date.now(); try { viewer?.close(); } catch { /* gone */ }
  // 3. the return: one visit each; how long it takes, and whether the world clock jumped
  const back = {};
  for (const s of alone) { const t = performance.now(); let status = 0; try { const r = await fetch(`${base}/w/${s}/v1/world/snapshot`, { signal: AbortSignal.timeout(120_000) }); status = r.status; await r.arrayBuffer(); } catch (e) { status = String(e.message); } back[s] = { status, ms: Math.round(performance.now() - t) }; }
  await sleep(3000);
  if (CLIP) clip(base, slugs[NAMES.indexOf(CLIP)], 'return');
  if (SOULS) out0.agentAfter = Object.fromEntries(slugs.map((s) => [s, agentRead(s)]));
  const logText = (s) => { const f = join(dir, 'data', 'logs', `${s}.log`); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
  // 4. verdict per world: windows of WINDOW_MS, actual ÷ due, the largest gap between tick advances, pid changes
  const out = { tool: 'cw6-unattended/1', label, continuous: CONTINUOUS, minutes: MINUTES, sampleMs: SAMPLE_MS, windowMs: WINDOW_MS, tickHz: TICK_HZ, rate: RATE, cores: cpus().length, load, worlds: {} };
  for (const s of slugs) {
    // from the world's first serving live.json of this launcher run (a file left by the previous run is not this process)
    const xs = samples[s].filter((x) => x.tick !== null && x.phase === 'serving' && x.at >= T0wall), windows = [];
    // consecutive windows; the tail shorter than a window still counts once it spans a minute
    for (let i = 0, j = 0; i < xs.length - 1; i = j) { while (j < xs.length && xs[j].t - xs[i].t < WINDOW_MS) j++; if (j >= xs.length) { j = xs.length - 1; if (xs[j].t - xs[i].t < 60_000) break; } const a = xs[i], b = xs[j]; windows.push({ fromMin: +((a.t - T0) / 60_000).toFixed(1), ratio: +((b.tick - a.tick) / (((b.t - a.t) / 1000) * TICK_HZ * RATE)).toFixed(4), pidChanged: a.pid !== b.pid }); }
    let gap = 0, last = xs[0]; for (const x of xs) { if (x.tick > (last?.tick ?? -1)) { gap = Math.max(gap, x.t - last.t); last = x; } } gap = Math.max(gap, (xs.at(-1)?.t ?? 0) - (last?.t ?? 0));
    const first = xs[0], end = xs.at(-1), total = first && end ? (end.tick - first.tick) / (((end.t - first.t) / 1000) * TICK_HZ * RATE) : null;
    out.worlds[s] = { role: s === control ? 'control (attended)' : 'unattended', servingAfterS: first ? Math.round((first.t - T0) / 1000) : null, samples: xs.length, missing: samples[s].length - xs.length, pids: [...new Set(xs.map((x) => x.pid))].length, ratio: total === null ? null : +total.toFixed(4),
      minWindow: windows.length ? Math.min(...windows.map((w) => w.ratio)) : null, windowsBelow99: windows.filter((w) => w.ratio < 0.99).length, windows: windows.length, maxGapS: Math.round(gap / 1000), firstTick: first?.tick ?? null, lastTick: end?.tick ?? null,
      catchUpJumps: (logText(s).match(/\[clock\] caught up/g) ?? []).length, ...(back[s] ? { returnMs: back[s].ms, returnStatus: back[s].status } : {}) };
    const w = out.worlds[s];
    // pass: every window and the whole run >= 0.99, no gap over two samples + 5 s, one process, no clock jump, and the
    // return answered by the world (any status under 500) within 5 s
    w.fails = [w.windows > 0 ? null : 'no window', w.windowsBelow99 === 0 ? null : `${w.windowsBelow99} window(s) < 0.99`, (w.ratio ?? 0) >= 0.99 ? null : `run ratio ${w.ratio}`,
      w.maxGapS <= (2 * SAMPLE_MS) / 1000 + 5 ? null : `gap ${w.maxGapS} s`, w.pids === 1 ? null : `${w.pids} pids`, w.catchUpJumps === 0 ? null : 'clock catch-up',
      !back[s] || (typeof back[s].status === 'number' && back[s].status < 500 && back[s].ms <= 5000) ? null : `return ${back[s].status} in ${back[s].ms} ms`].filter(Boolean);
  }
  out.viewerOpens = viewerOpens; Object.assign(out, out0);
  // 5. matched ticks: the stop saves one more snapshot per world; then each world's run is replayed offline and compared
  await stop(launcher);
  if (SOULS) for (const s of slugs) {
    captureSnapshots(s);
    const src = join(dir, 'data', 'worlds', s, 'sim.db'), copy = join(dir, 'copies', s); mkdirSync(copy, { recursive: true });
    for (const ext of ['', '-wal', '-shm']) if (existsSync(src + ext)) copyFileSync(src + ext, join(copy, 'sim.db' + ext));
    const w = out.worlds[s], rows = Object.values(snaps[s] ?? {}).filter((x) => x.tick >= s0Tick[s]);
    let r; try { r = await verifyMatchedTicks({ dbFile: join(copy, 'sim.db'), worldId: rows[0]?.worldId, samples: rows }); }
    catch (e) { r = { verdict: 'fail', fails: [`verifier threw: ${e.message}`], samples: [], inputs: [], from: null }; }   // the time series is still written
    // the snapshots this world saved in this launcher run after S0, as minutes from the start; `unattended` = saved before
    // the measurement ended (the stop snapshot comes after the return reads and is compared, but not counted)
    const runSamples = r.samples.map((x) => ({ ...x, min: x.at ? +((x.at - T0wall) / 60_000).toFixed(1) : null, unattended: !!x.at && x.at <= endWall }));
    const during = runSamples.filter((x) => x.unattended), minMatched = Number(flag('min-matched') ?? Math.max(2, Math.floor(MINUTES / 5) - 1));
    const inputs = r.inputs ?? [], measured = inputs.filter((e) => e.at >= T0wall && e.at <= endWall);
    // the world's own inputs: the presence rule's moves (trigger edge-body) and the world's own rules; anything else
    // during the measurement came from an agent, a viewer or an operator
    const external = measured.filter((e) => e.trigger !== 'edge-body' && !/^(world|system)/.test(e.author));
    const body = measured.filter((e) => e.trigger === 'edge-body'), b0 = body[0], b1 = body.at(-1);
    const asleep = body.find((e) => e.label === 'Sleeping');
    w.matched = { verdict: r.verdict, fails: r.fails, from: r.from, compared: runSamples.length, unattendedCompared: during.length, minMatched, spanTicks: during.length && r.from ? during.at(-1).tick - r.from.tick : 0, samples: runSamples, events: r.events,
      external: external.length,
      bodyRule: { moves: body.length, labels: Object.fromEntries([...new Set(body.map((e) => e.label))].map((l) => [l, body.filter((e) => e.label === l).length])),
        // a wall-timed effect: its logged ticks advance 20 × rate per wall second when the clock keeps its rate
        ticksPerWallS: b0 && b1 && b1.at > b0.at ? +((b1.tick - b0.tick) / ((b1.at - b0.at) / 1000)).toFixed(3) : null,
        movesPer1000Ticks: b0 && b1 && b1.tick > b0.tick ? +((body.length - 1) / ((b1.tick - b0.tick) / 1000)).toFixed(3) : null,
        asleep: asleep ? { tick: asleep.tick, min: +((asleep.at - T0wall) / 60_000).toFixed(1), ticksAfterS0: r.from ? asleep.tick - r.from.tick : null } : null } };
    if (r.verdict !== 'pass') w.fails.push(...r.fails.map((f) => `matched: ${f}`));
    if (during.length < minMatched) w.fails.push(`matched: ${during.length} unattended snapshot(s), fewer than ${minMatched}`);
    if (external.length) w.fails.push(`${external.length} input(s) from outside the world during the measurement`);
    const tps = w.matched.bodyRule.ticksPerWallS;
    if (tps === null || Math.abs(tps / (TICK_HZ * RATE) - 1) > 0.02) w.fails.push(`body-rule moves ${tps} ticks per wall second, not ${TICK_HZ * RATE} ± 2 %`);
    const a = out.agentBefore?.[s], z = out.agentAfter?.[s];
    w.agent = { capsBefore: a?.capsTotal ?? null, capsAfter: z?.capsTotal ?? null, hereTick: z?.hereTick ?? null, liveTick: z?.liveTick ?? null, posture: z?.posture ?? null };
    if (!(a?.capsTotal > 0) || a.capsTotal !== z?.capsTotal) w.fails.push(`capabilities ${a?.capsTotal} before, ${z?.capsTotal} after`);
    if (!(Math.abs((z?.hereTick ?? NaN) - (z?.liveTick ?? NaN)) <= 100)) w.fails.push(`the agent was told tick ${z?.hereTick}, the world was at ${z?.liveTick}`);
  }
  // the unattended arms against the control: the same tick rate of the world's own wall-timed moves
  if (SOULS) { const c = out.worlds[control]?.matched?.bodyRule?.ticksPerWallS; for (const s of alone) { const x = out.worlds[s].matched?.bodyRule?.ticksPerWallS; out.worlds[s].matched.vsControl = c && x ? +(x / c).toFixed(4) : null; if (!(c && x && Math.abs(x / c - 1) <= 0.02)) out.worlds[s].fails.push(`body-rule tick rate ${x} vs control ${c}`); } }
  out.samples = Object.fromEntries(slugs.map((s) => [s, samples[s].map(({ read, pid, phase, tick, at }) => ({ t: read - Math.round(T0), pid, phase, tick, at }))]));   // raw reads (ms from the start), for re-judging
  const ok = Object.values(out.worlds).every((w) => w.fails.length === 0);
  if (SOULS) out.souls = { wanderS: WANDER_S, agent: 'one CLI create and one act per world before the restart; no listen, no agent request after it' };
  out.verdict = ok ? 'pass' : 'fail';
  const file = flag('out') ?? join(dir, 'result.json'); writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  log(`${out.verdict}: ${Object.entries(out.worlds).map(([s, w]) => `${s} ${w.role} ratio ${w.ratio} min window ${w.minWindow} gap ${w.maxGapS} s jumps ${w.catchUpJumps}`).join('; ')} -> ${file}`);
  if (!has('keep')) for (const d of ['data', 'copies', 'souls']) rmSync(join(dir, d), { recursive: true, force: true });   // snapshots/ and result.json stay
  process.exitCode = ok ? 0 : 1;
}
main().catch(async (e) => { console.error(e); await stop(launcher); process.exitCode = 2; });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stop(launcher); process.exit(130); });
