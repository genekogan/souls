#!/usr/bin/env node
// CW6 (#740 A2/A3): matched-tick engine-state check for a world that ran with nobody there. The live world saved its
// state at each periodic snapshot: the engine hash, and the host body with the minds and their timed needs. The
// reference is the server's own replay, offline. It restores the run's starting snapshot S0 in a copy of the world's
// database and applies exactly the logged inputs: the same seed, the same events at the same ticks. It steps the engine
// tick by tick with the boot replay's per-tick function: engine.step, the minds' needs, program outcomes. At every
// live snapshot tick, the reference must equal the live world.
//
// What this proves: the state the world held at each tick is the deterministic simulation of S0 plus its logged inputs,
// every tick of it. Nothing changed the world outside the log, and the stroll, the body rule and the needs advanced tick
// by tick. A logged day-clock catch-up (a jump that simulates nothing) is a failure here, although it replays.
// What it does not prove on its own: the pace. A throttled or frozen world also replays exactly; it just reaches fewer
// ticks. Whether the clock kept its configured rate comes from unattended.mjs: ticks against monotonic time, gaps and
// pids, and the ticks per wall second of the world's own wall-timed body-rule moves, per arm against the control.
// The kernel and `extra` are not compared: live ticks sweep the kernel, but the non-durable boot replay does not.
// The verifier reads copies only; it never opens a port or touches a running world.
//
//   node tools/bench/continuous/matched-tick.mjs --db <copy of sim.db> --world-id <id> --snapshots <dir of <tick>.json>
//
// Each snapshot file is a captured row: { tick, seq, stateHash, at, body } (body = the snapshot JSON the world saved).
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../../', import.meta.url);
const mod = (p) => import(new URL(p, ROOT).href);

/** The engine factory a launcher world's child builds (main.ts plainFactory: ENGINE=mars, a world key that is not a known
 *  world, SOUL_LIFECYCLE=1 and ENABLE_WORLD_ENGINE=1 from children.mjs defaultCommand). */
async function launcherFactory() {
  const mars = await mod('packages/engine-mars/src/index.ts');
  return mars.marsFactory({ ...mars.GREEN_FIELD_WORLD, safeCrewRemoval: true });
}

/** A copy of the database whose only snapshot is S0 and whose log ends at S0, so a boot restores S0 and replays nothing. */
function startCopy(dbFile, s0, worldId, Db) {
  const dir = mkdtempSync(join(tmpdir(), 'cw6-matched-'));
  try { return startIn(dir, dbFile, s0, worldId, Db); } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}
function startIn(dir, dbFile, s0, worldId, Db) {
  for (const ext of ['', '-wal', '-shm']) if (existsSync(dbFile + ext)) copyFileSync(dbFile + ext, join(dir, 'sim.db' + ext));
  const db = new Db(join(dir, 'sim.db')), raw = db.db;
  raw.prepare('DELETE FROM snapshots WHERE world_id = ?').run(worldId);
  raw.prepare('INSERT INTO snapshots (world_id, tick, seq, state_hash, physical_hash, rules_version, snapshot, at) VALUES (?,?,?,?,?,?,?,?)')
    .run(worldId, s0.tick, s0.seq, s0.stateHash, s0.physicalHash ?? '', s0.rulesVersion, JSON.stringify(s0.body), s0.at ?? 0);
  raw.prepare('DELETE FROM events WHERE world_id = ? AND seq > ?').run(worldId, s0.seq);
  return { dir, db };
}

/** What a sample shows of the timed and autonomous state: each Soul body's place and activity, and its needs. */
function observe(host) {
  const souls = [];
  for (const m of host.minds.values()) {
    const e = host.engine.world.entities[m.entityId];
    souls.push({ soulId: m.soulId, pos: e ? [+(e.pose.p[0]).toFixed(3), +(e.pose.p[2]).toFixed(3)] : null, activity: e?.human?.activity ?? null,
      program: host.engine.programOf?.(m.entityId) ?? null, needs: m.life?.needs ? Object.fromEntries(Object.entries(m.life.needs).map(([k, v]) => [k, +v.toFixed(4)])) : null, doing: m.doing });
  }
  return souls;
}

/**
 * Replays from samples[0] (S0) through every later sample and compares. Returns { samples: [...], events, verdict }.
 * `events` is the log after S0, summarised by kind and author (the inputs the unattended world received, all of them its
 * own: body-rule moves, program outcomes; an agent or viewer input would show here).
 */
export async function verifyMatchedTicks({ dbFile, worldId, samples }) {
  const [{ Db }, { WorldHost }, { loadGroundRecipes }, { stableStringify }] = await Promise.all([
    mod('apps/server/src/db.ts'), mod('apps/server/src/world.ts'), mod('apps/server/src/god/ground-host.ts'), mod('packages/engine-contract/src/index.ts')]);
  const ordered = [...samples].sort((a, b) => a.tick - b.tick || a.seq - b.seq);
  const [s0, ...rest] = ordered;
  if (!s0 || !rest.length) return { verdict: 'fail', fails: ['fewer than two snapshots'], samples: [] };
  const out = [], fails = [], byKind = {}, inputs = [];
  let src = [], copy = null;
  try {
    // the log after S0, from the run's own (copied) database
    { const d = new Db(dbFile); try { src = d.events(worldId, s0.seq); } finally { d.close(); } }
    for (const e of src) {
      inputs.push({ seq: e.seq, tick: e.tick, at: e.at, kind: e.kind, author: e.author.replace(/s_[A-Za-z0-9_-]+/, 's_*'), trigger: e.payload?.trigger ?? null, label: e.payload?.label ?? null, why: e.payload?.why ?? null, receipt: !!e.payload?.receipt, own: worldOwn(e) });
      // a day-clock catch-up replays exactly, but it is the jump that substitutes for simulation
      if (e.kind === 'rules' && (e.payload?.dayConfig || /caught up/.test(e.payload?.why ?? ''))) fails.push(`day-clock catch-up logged at tick ${e.tick} (seq ${e.seq})`);
    }
    copy = startCopy(dbFile, s0, worldId, Db);
    const db = copy.db;
    loadGroundRecipes(db, worldId);
    const host = new WorldHost(db, await launcherFactory(), 'sim-genesis-1', 20 * 60 * 5, worldId);
    const boot = host.boot();
    if (boot.from !== 'snapshot' || host.engine.world.tick !== s0.tick) throw new Error(`boot did not restore S0 (${boot.from}, tick ${host.engine.world.tick} vs ${s0.tick})`);
    if (host.engine.stateHash() !== s0.stateHash) fails.push(`S0 restore hash differs at tick ${s0.tick}`);
    // the boot replay's per-tick function (WorldHost.boot stepReplay; launcher worlds have no durable clock frontier)
    const step = () => { const r = host.engine.step(); host.advanceLives(); host.afterPrograms(r.programs, true); };
    let i = 0;
    for (const s of rest) {
      for (; i < src.length && src[i].seq <= s.seq; i++) {
        const e = src[i];
        if (e.tick < host.engine.world.tick) throw new Error(`event ${e.seq} at tick ${e.tick} is behind the replay (${host.engine.world.tick})`);
        while (host.engine.world.tick < e.tick) step();
        host.apply(e, true); host.seq = e.seq;
        const key = `${e.kind}:${e.author.replace(/s_[A-Za-z0-9_-]+/, 's_*')}${e.payload?.trigger ? `:${e.payload.trigger}` : ''}`, k = (byKind[key] ??= { count: 0, firstTick: e.tick, lastTick: e.tick, labels: {} });
        k.count++; k.lastTick = e.tick; const label = e.payload?.label; if (label) k.labels[label] = (k.labels[label] ?? 0) + 1;
      }
      if (s.tick < host.engine.world.tick) { fails.push(`snapshot at tick ${s.tick} is behind the replay`); continue; }
      while (host.engine.world.tick < s.tick) step();
      const ref = host.engine.stateHash(), live = s.stateHash;
      const minds = (b) => stableStringify((b.minds ?? []).map((m) => ({ soulId: m.soulId, life: m.life ?? null, energy: m.energy, doing: m.doing, pending: m.pending ?? null })));
      const hostState = host.captureHostState();
      const mindsEqual = minds(hostState) === minds(s.body);
      const row = { tick: s.tick, seq: s.seq, at: s.at, engineEqual: ref === live, mindsEqual, live: live.slice(0, 16), ref: ref.slice(0, 16), souls: observe(host) };
      if (!row.engineEqual) fails.push(`engine state differs at tick ${s.tick}`);
      if (!mindsEqual) fails.push(`minds (needs) differ at tick ${s.tick}`);
      out.push(row);
    }
    host.stop?.();
  } catch (e) { fails.push(String(e?.message ?? e)); }
  finally { if (copy) { try { copy.db.close(); } catch { /* closed */ } rmSync(copy.dir, { recursive: true, force: true }); } }
  return { verdict: fails.length ? 'fail' : 'pass', fails, from: { tick: s0.tick, seq: s0.seq, stateHash: s0.stateHash.slice(0, 16) }, samples: out, events: { total: src.length, byKind }, inputs };
}

/** An input the world made itself, with nobody there: the presence rule's moves and stops (edge/ledger/body-rule.ts via
 *  ledger.ts: decisions with trigger edge-body or edge-ambient, an edge-stop with why 'body' and no receipt), the ledger
 *  stepping a body out of a solid footprint, and the world's own rules. Anything else came from an agent, a viewer, the
 *  god or an operator. */
export function worldOwn(e) {
  const p = e.payload ?? {};
  if (/^(world|system)/.test(e.author)) return true;
  if (!/^edge:s_/.test(e.author)) return false;
  if (e.kind === 'decision') return p.trigger === 'edge-body' || p.trigger === 'edge-ambient';
  if (e.kind === 'edge-stop') return p.why === 'body' && !p.receipt;
  if (e.kind === 'edge-relocate') return /solid footprint/.test(p.why ?? '');
  return false;
}

/** Captured snapshot rows from a directory of <tick>.json files. */
export const readSamples = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = process.argv.slice(2), f = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  if (!f('db') || !f('world-id') || !f('snapshots')) { console.error('usage: matched-tick.mjs --db <sim.db copy> --world-id <id> --snapshots <dir>'); process.exit(2); }
  const r = await verifyMatchedTicks({ dbFile: f('db'), worldId: f('world-id'), samples: readSamples(f('snapshots')) });
  console.log(JSON.stringify(r, null, 1)); process.exitCode = r.verdict === 'pass' ? 0 : 1;
}
