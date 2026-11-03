// Production mode for the world launcher (lane P3): what changes when the launcher serves
// sim.eden.art from eden2 instead of a laptop. Plain functions, no I/O beyond reading
// /proc/meminfo and renaming a log; launcher.mjs and children.mjs call them.
//
//   - slugs never collide with the worlds the existing release serves (EXISTING_WORLDS);
//   - a world cap (registered) and a running cap, plus a free-memory floor, so eden2 stays healthy;
//   - children get edge minds, fake brain, no model keys, and either dev auth (staging on
//     localhost only) or Clerk from the --auth-env file, which children load by path
//     (`node --env-file=<path>`, added by children.mjs defaultCommand; P1).
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { freemem } from 'node:os';
import { isAbsolute } from 'node:path';

/**
 * World keys the existing release answers under /w/<key> on sim.eden.art (the laptop proxy
 * `tools/core/multiworld/proxy.mjs` KEYS, and the server's KNOWN_WORLD_KEYS). Caddy keeps
 * `/w/<key>*` for that release, so a launcher slug may neither equal nor start with one of them.
 */
export const EXISTING_WORLDS = Object.freeze(['eden', 'mars', 'littlemartians', 'toy']);

/**
 * Root paths already used by the site (proxy, app and launcher): a --base may not be one.
 * `/w` holds worlds; `/ops` the private overview; the rest app/static content, snapshots and redirects.
 */
export const TAKEN_PREFIXES = Object.freeze(['/w', '/l', '/assets', '/__sim', '/v1', '/mcp', '/ws', '/browser', '/modular', '/engine', '/models',
  '/history', '/2020', '/data', '/mars-assets', '/world-assets', '/lab', '/studio', '/buildings', '/skill.md', '/healthz', '/ops']);

/** True when a slug could be routed to the existing release by a `/w/<key>*` path glob. */
export const shadowsExisting = (slug) => EXISTING_WORLDS.some((k) => slug === k || slug.startsWith(k));

/** Free memory the kernel could hand out now, in MB (Linux MemAvailable; elsewhere os.freemem()). */
export function memAvailableMb() {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch { /* not Linux */ }
  return Math.round(freemem() / 2 ** 20);
}

/** Memory a world's pre-warmed (standby) process needs beside its running one: measured 230-240 MB for a new world and
 *  for the eden/mars forks (Node 22, code loaded, nothing opened), plus margin for the launcher's own overlap. */
export const PREWARM_MB = 768;
/** MB left under this process's cgroup v2 memory.high/memory.max (systemd MemoryHigh/MemoryMax of the unit), or null
 *  when there is no such limit (not Linux, cgroup v1, unlimited). The world processes share the unit's cgroup.
 *  memory.current also counts the page cache of the files the unit read (its SQLite databases, its code); the inactive
 *  part of it (memory.stat inactive_file) is what the kernel reclaims first when the unit nears its limit, so it is room
 *  (G9 lane Z1b: on eden2 the legacy unit's ~220 MB of it put eden and mars 3-5 MB short of a pre-warm, boot cold). */
/** Reads /proc and /sys files; SIM_PROC_ROOT=<dir> reads them under <dir> instead (a rig's fake cgroup: Z1b proved the
 *  pre-warm gate on a laptop with it). */
const sysRead = (f) => readFileSync(`${process.env.SIM_PROC_ROOT ?? ''}${f}`, 'utf8');
export function cgroupHeadroomMb(read = sysRead) {
  try {
    const line = read('/proc/self/cgroup').split('\n').find((l) => l.startsWith('0::'));
    if (!line) return null;
    const dir = `/sys/fs/cgroup${line.slice(3).trim().replace(/\/$/, '')}`;
    let limit = Infinity;
    for (const f of ['memory.high', 'memory.max']) { const v = read(`${dir}/${f}`).trim(); if (v !== 'max' && Number(v) > 0) limit = Math.min(limit, Number(v)); }
    if (limit === Infinity) return null;
    let reclaimable = 0;
    try { reclaimable = Number(read(`${dir}/memory.stat`).match(/^inactive_file (\d+)$/m)?.[1] ?? 0); } catch { /* no stat: count it all */ }
    return Math.round((limit - Number(read(`${dir}/memory.current`).trim()) + reclaimable) / 2 ** 20);
  } catch { return null; }
}
/** Why a release handover must not pre-warm a world now (null: it may). A second process of the world beside the first
 *  must fit under the unit's memory limit (over MemoryHigh the unit is throttled, over MemoryMax a world is killed) and in
 *  the host's available memory above the launcher's floor. Without room the world boots cold, as before pre-warm. */
export function prewarmBlocked(minFreeMb = 0, { needMb = Number(process.env.SIM_PREWARM_NEED_MB ?? PREWARM_MB), read } = {}) {
  const room = cgroupHeadroomMb(read);
  if (room !== null && room < needMb) return `the unit is ${room} MB under its memory limit; pre-warm needs ${needMb}`;
  let free = null;
  try { const m = (read ?? sysRead)('/proc/meminfo').match(/^MemAvailable:\s+(\d+)\s+kB/m); if (m) free = Math.round(Number(m[1]) / 1024); } catch { /* not Linux: no host check (macOS free memory excludes its cache) */ }
  if (free !== null && free < minFreeMb + needMb) return `the server has ${free} MB available; pre-warm needs ${minFreeMb + needMb}`;
  return null;
}

/**
 * Normalise and check the launcher's production settings. Throws with a reason a human can act on.
 * @param {{ devAuth?: boolean, publicOrigin?: string, authEnvFile?: string, maxWorlds?: number, maxRunning?: number,
 *           minFreeMb?: number, worldHeapMb?: number, range?: [number, number] }} cfg
 */
export function productionSettings(cfg, origin) {
  const devAuth = cfg.devAuth ?? !cfg.authEnvFile;
  const publicOrigin = (cfg.publicOrigin ?? origin).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) throw new Error(`launcher: public origin must be scheme://host[:port], got ${publicOrigin}`);
  if (devAuth && publicOrigin.startsWith('https://')) throw new Error('launcher: dev auth on a public https origin is refused (staging stays on localhost)');
  if (devAuth && cfg.authEnvFile) throw new Error('launcher: choose dev auth or an auth env file, not both');
  if (!devAuth && !cfg.authEnvFile) throw new Error('launcher: without dev auth an --auth-env file is required (the Clerk settings)');
  if (cfg.authEnvFile && (!isAbsolute(cfg.authEnvFile) || !existsSync(cfg.authEnvFile))) throw new Error(`launcher: auth env file must be an existing absolute path: ${cfg.authEnvFile}`);
  const range = cfg.range ?? [0, -1];
  const ports = range[1] - range[0] + 1;
  const maxRunning = cfg.maxRunning ?? ports;
  const maxWorlds = cfg.maxWorlds ?? 200;
  for (const [k, v] of Object.entries({ maxRunning, maxWorlds })) if (!Number.isInteger(v) || v < 1) throw new Error(`launcher: ${k} must be a positive integer`);
  if (ports > 0 && maxRunning > ports) throw new Error(`launcher: maxRunning ${maxRunning} exceeds the ${ports} child ports`);
  const base = (cfg.base ?? '').replace(/\/+$/, '');
  if (base && !/^\/[a-z][a-z0-9-]{0,31}$/.test(base)) throw new Error(`launcher: base must be one path segment like /worlds, got ${cfg.base}`);
  if (base && TAKEN_PREFIXES.includes(base)) throw new Error(`launcher: base ${base} belongs to the existing release`);
  return {
    base, devAuth, publicOrigin, authEnvFile: cfg.authEnvFile ?? null, maxWorlds, maxRunning,
    minFreeMb: cfg.minFreeMb ?? 0, worldHeapMb: cfg.worldHeapMb ?? 0,
  };
}

/**
 * glibc malloc settings for every world process (lane L1, measured on Linux, node 22). glibc raises its mmap threshold to
 * the size of each big block freed, so the nav engine's multi-MB typed arrays (tiles, grids, search workspaces) are later
 * carved out of the heap, which then never shrinks: a world's RSS stays a few hundred MB above what it holds. Eden 2026
 * with one resident: 1011 MB default, 717 MB with a fixed 256 kB threshold (big blocks go back to the OS when freed), a
 * 1 MB trim threshold and two arenas. A value the world's environment already sets wins.
 */
export const WORLD_MALLOC_ENV = Object.freeze({ MALLOC_ARENA_MAX: '2', MALLOC_MMAP_THRESHOLD_: '262144', MALLOC_TRIM_THRESHOLD_: '1048576' });

/**
 * Wrap a child command with the production settings. The env is the child's whole environment
 * (children never inherit the launcher's), so what is set here is final; the --auth-env file
 * (passed by defaultCommand as `node --env-file`) only fills names this env leaves unset.
 */
export function decorateCommand({ cmd, args, env }, s) {
  const out = { ...env };
  // $0 model spend, always: the world runs no Soul or god mind; owners' agents do (/v1/edge, /v1/god).
  Object.assign(out, { MIND_DRIVER: 'edge', BRAIN_MODE: 'fake', ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '' });
  if (s.devAuth) out.DEV_AUTH = '1'; else out.DEV_AUTH = '0';
  out.PUBLIC_URL = s.publicOrigin;
  if (out.WORLD_KEY) out.WORLD_PATH = `${s.base ?? ''}/w/${out.WORLD_SLUG ?? out.WORLD_KEY}`;
  // this release's identity, not a BUILD_ID that a shared settings file may carry for another release
  if (s.build && s.build !== 'dev') out.BUILD_ID = s.build;
  if (s.worldHeapMb) out.NODE_OPTIONS = `--max-old-space-size=${s.worldHeapMb}`;
  for (const [k, v] of Object.entries(WORLD_MALLOC_ENV)) if (out[k] === undefined) out[k] = v;
  return { cmd, args, env: out };
}

/** Keep one previous child log (`<slug>.log.1`) once the current one passes maxBytes. */
export function rotateLog(file, maxBytes = 20 * 2 ** 20) {
  try { if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`); } catch { /* no log yet */ }
}
