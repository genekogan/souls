// Provision a local dev world from a server root (the SOUL3 integration worktree) and describe it in world.json.
// DESIGN §4.1. Only world.kind "dev" is supported at this stage; fork/template-eden2/live are refused.
import { spawn } from 'node:child_process';
import { openSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../lib/hash.mjs';
import { writeJson } from '../lib/jsonl.mjs';
import { sleep } from '../lib/clock.mjs';
import { seedSnapshot } from './snapshot-seed.mjs';
import { physicalSnapshotSha256 } from '../lib/physical-fixture.mjs';

export const RESERVED_KINDS = ['fork', 'template-eden2', 'live'];
export function assertKind(kind = 'dev') {
  if (kind === 'dev') return;
  if (RESERVED_KINDS.includes(kind)) throw new Error(`world.kind "${kind}" is reserved and not implemented at this stage; use "dev"`);
  throw new Error(`unknown world.kind "${kind}"`);
}

/** The environment §0 fixes for a dev world served from serverRoot. */
export function worldEnv(serverRoot) {
  const root = resolve(serverRoot);
  return {
    INVITE_REQUIRED: '0',
    EDGE_CONTROLLER_CLI_FILE: join(root, 'tools/world-launcher/soul/eden.mjs'),
    EDGE_CLI_FILE: join(root, 'tools/world-launcher/soul/eden-agent.mjs'),
    WEB_DIR: join(root, 'apps/web/dist'),
    // Not in DESIGN §0 but required: without these the world serves the 1.9 eden-agent.mjs guide (skill 1.9.5)
    // even though /eden.mjs is 2.0, and a seat following instructions.md would never touch eden.mjs.
    EDGE_SKILL_FILE: join(root, 'tools/world-launcher/soul/skill.md'),
    EDGE_INSTRUCTIONS_FILE: join(root, 'tools/world-launcher/soul/instructions.md'),
  };
}

export async function healthz(base) {
  try { const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(15000) }); return r.ok ? await r.json() : { ok: false, status: r.status }; }
  catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

async function served(base, path) {
  try {
    const r = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    const html = /^\s*<!doctype html/i.test(text);
    return r.ok && !html ? { ok: true, bytes: text.length, sha256: sha256(text), text } : { ok: false, status: r.status, html };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** Asset overlay for MARS_WEB_DIR, first that has modular/humanoid/kit.json: $PLAYTEST_MARS_WEB (a local overlay, e.g.
 *  the root worlds' immutable asset dir plus the humanoid kit mirrored from production), <serverRoot>/../mars-web (built from production URLs by arena/assets-overlay.mjs; the cloud runner's layout), then the
 *  server root's .lane/mars-web. Without an overlay the server proxies /modular and /browser to sim.mars.college. */
export function marsWebDir(serverRoot, { env = process.env, exists = existsSync } = {}) {
  const root = resolve(serverRoot);
  const cands = [env.PLAYTEST_MARS_WEB, join(root, '../mars-web')].filter(Boolean);
  return cands.find((d) => exists(join(d, 'modular/humanoid/kit.json'))) ?? join(root, '.lane/mars-web');
}

/** startWorld({serverRoot, slug, port, genesis, dataDir, log, fresh, onSpawn}) → {base, pid, build, healthz, child, dataDir} */
export async function startWorld({ serverRoot, slug, port, genesis, snapshot, dataDir, log, fresh = true, kind = 'dev', bootTimeoutMs = 900000, natives = false, onSpawn = null }) {
  assertKind(kind);
  const root = resolve(serverRoot);
  if (!existsSync(join(root, 'apps/server/src/main.ts'))) throw new Error(`no server under ${root}`);
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(slug ?? '')) throw new Error('slug: lowercase letters, digits, dashes');
  const env = worldEnv(root);
  for (const [k, v] of Object.entries(env)) if (k !== 'INVITE_REQUIRED' && !existsSync(v)) throw new Error(`${k} missing: ${v}`);
  const data = resolve(dataDir ?? join(root, `.lane/data-${slug}`));
  if (snapshot && !fresh) throw Error('snapshot seed requires a fresh isolated world');
  if (fresh) rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  const fixture = snapshot ? await seedSnapshot({snapshotPath:resolve(root,snapshot),dataDir:data,worldId:`${slug}-1`}) : null;
  if(fixture)writeJson(join(data,'fixture-seed.json'),fixture);
  const marsWeb = marsWebDir(root);
  // natives: scenario.world.natives seeds native residents (production worlds have them; dev worlds default to none).
  const base = `http://127.0.0.1:${port}/w/${slug}`;
  // The same environment tools/god-skill/dev-world.mjs sets, plus §0, with a boot wait long enough for a loaded
  // machine and a large genesis (dev-world.mjs gives up after 180 s; Eden 2026 under load 19 took longer).
  const worldEnvironment = { ...process.env, ...env, WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: natives ? '1' : '0', EDGE_FADING: '1', DATA_DIR: data, PUBLIC_URL: `http://127.0.0.1:${port}`, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), ...(genesis ? { GENESIS_FILE: resolve(root, genesis) } : {}) };
  if (log) mkdirSync(resolve(log, '..'), { recursive: true });
  const out = log ? openSync(resolve(log), 'a') : 'ignore';
  const child = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, env: worldEnvironment, stdio: ['ignore', out, out], detached: true });
  child.unref();
  onSpawn?.(child); // an owning lifecycle (tools/playtest/runs/) records the process before boot, so a cancel during boot can stop it
  const t0 = Date.now();
  let h = null;
  while (Date.now() - t0 < bootTimeoutMs) {
    if (child.exitCode != null) throw new Error(`world ${slug} exited during boot (code ${child.exitCode}); see ${log}`);
    try { const r = await fetch(`${base}/healthz`); if (r.ok) { h = await r.json(); break; } } catch { /* booting */ }
    await sleep(500);
  }
  if (!h) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } throw new Error(`world ${slug} did not come up on :${port} within ${Math.round(bootTimeoutMs / 1000)} s`); }
  if(fixture){
    // Health can answer before the first native reconciliation; validate after startup settles.
    await sleep(3000);
    try { const r=await fetch(`${base}/v1/world/snapshot`,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('snapshot unavailable after boot');const actual=physicalSnapshotSha256(await r.json());if(actual!==fixture.physicalSnapshotSha256)throw Error(`snapshot physical state changed during boot: expected ${fixture.physicalSnapshotSha256}, got ${actual}`); }
    catch(error){await stopWorld({pid:child.pid});throw error;}
  }
  return { fixture, base, pid: child.pid, build: h.build ?? null, healthz: h, bootMs: Date.now() - t0, child, dataDir: data, marsWebDir: marsWeb };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** SIGTERM the world's process group (dev-world spawns it detached when logging), wait, SIGKILL after graceMs. */
export async function stopWorld({ pid, graceMs = 10000 }) {
  if (!pid) return { stopped: false, reason: 'no pid' };
  const kill = (sig) => { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* gone */ } } };
  kill('SIGTERM');
  const end = Date.now() + graceMs;
  while (alive(pid) && Date.now() < end) await sleep(200);
  if (alive(pid)) { kill('SIGKILL'); await sleep(300); }
  return { stopped: !alive(pid) };
}

/** world.json: {kind, base, slug, port, pid, build, skill:{version, sha256}, cli:{eden.mjs, eden-agent.mjs, eden-god.mjs}, startedAt} */
export async function describeWorld({ base, slug, port, pid, build, kind = 'dev', startedAt }) {
  const fetchAll = () => Promise.all(['skill.md', 'eden.mjs', 'eden-agent.mjs', 'god/eden-god.mjs', 'instructions.md'].map((p) => served(base, p)));
  let got = await fetchAll();
  for (let i = 0; i < 2 && got.some((x) => x.error); i++) { await sleep(3000); got = await fetchAll(); } // a just-booted world on a loaded machine can be slow
  const [skill, eden, agent, god, instr] = got;
  const skillVersion = skill.ok ? (skill.text.match(/^\s*version:\s*"?([^"\s]+)/m)?.[1] ?? null) : null;
  const cliVersion = eden.ok ? (eden.text.match(/const VERSION = "([^"]+)"/)?.[1] ?? null) : null;
  return {
    kind, base, slug, port, pid, build,
    skill: { version: skillVersion, sha256: skill.sha256 ?? null },
    cli: { 'eden.mjs': eden.sha256 ?? null, 'eden.mjs.version': cliVersion, 'eden-agent.mjs': agent.sha256 ?? null, 'eden-god.mjs': god.sha256 ?? null },
    instructions: { sha256: instr.sha256 ?? null, mentionsEdenMjs: instr.ok ? /eden\.mjs/.test(instr.text.replace(/eden-agent\.mjs/g, '')) : null },
    startedAt,
  };
}

/** Convenience used by the smoke and playtest.mjs: start + describe + write world.json. */
export async function provision({ runDir, serverRoot, world }) {
  const startedAt = new Date().toISOString();
  const w = await startWorld({ serverRoot, slug: world.slug, port: world.port, genesis: world.genesis, snapshot:world.snapshot, natives:world.natives===true, kind: world.kind, dataDir: join(runDir, 'server', 'data'), log: join(runDir, 'server', 'world.log') });
  writeJson(join(runDir, 'server', 'healthz-before.json'), w.healthz);
  const desc = await describeWorld({ ...w, slug: world.slug, port: world.port, kind: world.kind ?? 'dev', startedAt });
  writeJson(join(runDir, 'world.json'), desc);
  return { ...desc, child: w.child };
}
