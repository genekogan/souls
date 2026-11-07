// G1: a warm look keeper, so a new user's first look is as fast as any later one.
//
// `pair` (at its start, while the owner approves), `listen` and `status` start the look keeper in the background
// when it is not running; other authenticated commands restart it when it has gone (idle, memory, crash), unless
// `look --stop` stopped it. Starting it never waits: one detached `look-keeper` process fetches Playwright through
// npx when needed (once per machine), opens the world in headless Google Chrome, and outlives the command.
// A look that comes while it is still starting goes to the world's own renderer when the world has one, else waits
// for the keeper. The keeper stays while this folder's listener runs (its heartbeat file) and watches its memory.
//
// Only folders a human paired (a token and no dev identity) warm up by default: tests and dev folders that `mint`
// never start background browsers. EDEN_GOD_WARM=1 forces it on, EDEN_GOD_WARM=0 off.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { atomicWrite, load, save, sleep } from './state.mjs';
import { holder, liveness, lockStatus, parseHolder } from './locks.mjs';
import { chromeCandidates } from './remote-look.mjs';

import { godFile } from './seat.mjs';
export const WARM = '.eden-god.warm.json', LISTENER = '.eden-god.listen.json', KEEPER = '.eden-god.look.json';
export const LISTEN_BEAT_MS = 20_000;
const STARTING_MS = 5 * 60_000, FAILED_RETRY_MS = 10 * 60_000, REMOTE_RETRY_MS = 60 * 60_000;
const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const pidAlive = (pid) => { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const readWarm = () => read(godFile(WARM));
/** Merges into the marker (so `pwFrom`, the Playwright folder the keeper found, survives phase changes). */
export const writeWarm = (patch) => { try { atomicWrite(godFile(WARM), JSON.stringify({ ...(readWarm() ?? {}), ...patch, at: Date.now() })); } catch { /* best effort */ } };

/** Does this folder warm up? (a human-paired folder on a machine that has Google Chrome where Playwright looks) */
export function warmEnabled(state = (() => { try { return load(); } catch { return {}; } })(), env = process.env, chrome = () => { const c = chromeCandidates(); return !c || c.some(existsSync); }) {
  if (env.EDEN_GOD_WARM === '0' || env.EDEN_GOD_LOOK === 'remote') return false;
  if (!state?.world) return false;
  if (env.EDEN_GOD_WARM === '1') return true;
  if (env.NODE_TEST_CONTEXT) return false; // a CLI run by node --test: no background browsers
  return !!state.token && !state.identity && chrome();
}

/** 'ready' (a live keeper on this world) · 'warming' · 'failed' · 'stopped' · 'other' (a keeper on another world) · 'none' */
export function warmStatus(world, now = Date.now()) {
  const k = read(godFile(KEEPER));
  if (k && !lockStatus(parseHolder(k.holder), k.heartbeatAt ?? 0).stale) return k.world === world ? 'ready' : 'other';
  const w = readWarm();
  if (!w || (w.world && w.world !== world)) return 'none';
  if (w.phase === 'stopped') return 'stopped';
  if (w.phase === 'failed') return now - (w.at ?? 0) < FAILED_RETRY_MS ? 'failed' : 'none';
  if (w.phase === 'ready') return 'none'; // it was ready, and its keeper has gone
  const h = parseHolder(w.holder), live = h ? liveness(h) === 'alive' : pidAlive(w.pid);
  return live && now - (w.at ?? 0) < STARTING_MS ? 'warming' : 'none';
}

/** Start the keeper in the background unless it runs, is starting, failed recently or was stopped (force: also after a stop). */
export function startWarm(world, cliPath, { force = false, spawnFn = spawn } = {}) {
  const st = warmStatus(world);
  if (st === 'ready' || st === 'warming' || st === 'other' || st === 'failed' || (st === 'stopped' && !force)) return st;
  try {
    const child = spawnFn(process.execPath, [cliPath, 'look-keeper', world, '0', '--warm'], { detached: true, stdio: 'ignore', cwd: process.cwd(), env: process.env });
    child.on?.('error', () => {});
    child.unref?.();
    if (!child.pid) return 'none';
    const cur = readWarm(); if (!(cur?.pid === child.pid)) writeWarm({ world, pid: child.pid, holder: undefined, phase: 'starting', error: undefined, reason: undefined });
    return 'started';
  } catch { return 'none'; }
}

/** The commands' hook: never throws, never waits. */
export function autoWarm(cliPath, { force = false, pairing = false } = {}) {
  // pairing: the token arrives only when the owner approves; the keeper needs none, so it starts now
  try { const s = load(); if (warmEnabled(pairing ? { ...s, token: s.token ?? 'pairing' } : s)) return startWarm(s.world, cliPath, { force }); } catch { /* never hold a command up */ }
  return 'off';
}

/** The listener's heartbeat: the keeper stays while it is fresh. */
export function listenerBeat() { try { atomicWrite(godFile(LISTENER), JSON.stringify({ holder: holder('eden-god listen'), at: Date.now() })); } catch { /* best effort */ } }
export const listenerAt = () => read(godFile(LISTENER))?.at ?? 0;

/** Whether the world's own renderer is worth trying (it said look.unavailable within the hour: no). */
export const remoteKnownUnavailable = (s = load(), now = Date.now()) => s.remoteLook?.ok === false && now - (s.remoteLook.at ?? 0) < REMOTE_RETRY_MS;
export const markRemote = (ok) => { try { save({ remoteLook: { ok, at: Date.now() } }); } catch { /* best effort */ } };

/** Pick how an ordinary look is taken: 'keeper' (warm), 'cold' (today's one-shot Chrome), or { shot } from the world's
 * renderer while the keeper is still starting. Waits for a starting keeper at most until 15 s before the deadline. */
export async function lookRoute({ world, cliPath, single, deadlineAt, signal, remote, wait = sleep, now = Date.now }) {
  if (!warmEnabled()) return 'cold';
  let st = warmStatus(world);
  if (st === 'ready') return 'keeper';
  if (st === 'none') st = startWarm(world, cliPath) === 'started' ? 'warming' : warmStatus(world);
  if (st !== 'warming') return 'cold';
  if (single && !remoteKnownUnavailable()) {
    try { const shot = await remote(); markRemote(true); return { shot }; }
    catch (e) {
      signal?.throwIfAborted();
      if (/look\.unavailable|503/.test(String(e.message))) markRemote(false);
    }
  }
  while (now() < deadlineAt - 15_000) {
    signal?.throwIfAborted();
    st = warmStatus(world);
    if (st === 'ready') return 'keeper';
    if (st !== 'warming') return 'cold';
    await wait(250);
  }
  return 'cold';
}

/** Resident memory (MB) of the Chrome whose command line holds `--remote-debugging-port=<port>`, with all its children. */
export function treeRssMb(psText, port) {
  const rows = psText.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] }));
  const roots = rows.filter((r) => r.cmd.includes(`--remote-debugging-port=${port}`) && !rows.some((p) => p.pid === r.ppid && p.cmd.includes(`--remote-debugging-port=${port}`)));
  if (!roots.length) return null;
  const kids = new Map(); for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  let kb = 0; const seen = new Set(), stack = [...roots];
  while (stack.length) { const r = stack.pop(); if (seen.has(r.pid)) continue; seen.add(r.pid); kb += r.rss; stack.push(...(kids.get(r.pid) ?? [])); }
  return Math.round(kb / 1024);
}

export const removeWarm = () => rmSync(godFile(WARM), { force: true });
