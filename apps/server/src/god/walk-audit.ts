// Lane WALK (2026-10-21): the walkability audit the release gate runs (tools/test-harness/walk/walk-gate.test.mjs).
// It boots a world in-process exactly as main.ts does for the parts walkability reads (engine host, ground host, god model
// with its boot re-cut, edge ledger, engine bridge), then reports, per place (the top segment of a thing's path):
//   bad       walk goals, seats, berths and regions the engine's connectivity (lane NAV, connectivityV1/navCheckV1) calls
//             not walkable both ways from the main ground: nav.disconnected + nav.one-way + nav.no-standing-room
//   oneWay    the nav.one-way subset (reachable one way only)
//   goalless  named things GodNav finds no walk goal for at all (no standing room near them)
//   float     root things standing more than FLOAT_M above ground without full deck support
// Nothing here decides walkability itself: it only calls the code the server ships, so the gate measures what Souls get.
//
//   node apps/server/src/god/walk-audit.ts --db <world copy .db or .db.gz> [--name n] [--shard k/n] [--out part.json]
//   node apps/server/src/god/walk-audit.ts --genesis worlds/templates/eden-2026.json [--name n] [--shard k/n] [--out part.json]
// The world copy is never written: it is copied (or gunzipped) into a temporary directory first.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, renameSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir, homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Thing } from './nav.ts';

export const WALK_AUDIT_VERSION = 1;
export const FLOAT_M = 0.3;
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** One audit process's findings. A world is audited in `n` spatial shards (64 m cells, see shardOf) by separate processes
 *  so the gate step stays short; tools/test-harness/walk merges the parts. Shard 0 also measures floats. */
export type WalkPart = {
  schemaVersion: 1; version: number; name: string; worldId: string; shard: [number, number];
  dests: number; roots: number;
  /** [code, destination id, place] for every destination not walkable both ways */
  bad: [string, string, string][];
  /** [thing path, place]: named things GodNav finds no walk goal for */
  goalless: [string, string][];
  /** [root entry alias, canonical room, place]: blocked aliases retained for diagnosis, counted once under the room. */
  goallessAliases?: [string, string, string][];
  /** [path, metres above the ground, place] */
  floats: [string, number, string][];
  /** [code, use:<slot id>, place]: seats and beds a Soul cannot use (walk-use.ts; only worlds audited with --use) */
  unusable?: [string, string, string][];
  ms: Record<string, number>;
};
export const SHARD_CELL_M = 64;
export function shardOf(at: readonly number[], n: number): number {
  if (n <= 1) return 0;
  const i = Math.floor(at[0] / SHARD_CELL_M), j = Math.floor(at[1] / SHARD_CELL_M);
  return (((i * 73856093) ^ (j * 19349663)) >>> 0) % n;
}

/** GodNav's closed/single-room root entry is the same destination as that room. Only collapse
 * two null goals with this exact structural identity; an open root's approach is a distinct goal. */
export function goallessEntryAlias(t: Thing, byRef: ReadonlyMap<string, Thing>, hasGoal: (t: Thing) => boolean): string | undefined {
  if (t.kind !== 'building' || t.doorOpen || t.semanticPart || t.rooms?.length !== 1 || hasGoal(t)) return;
  const room = byRef.get(t.rooms[0]);
  if (!room || room.kind !== 'room' || room.semanticPart || room.id !== t.id || !room.room ||
      room.ref !== `${t.ref}/${room.room}` || hasGoal(room)) return;
  return room.ref;
}

type Booted = { name: string; worldId: string; host: any; god: any; bridge: any; engine: any; refused: [string, string, string][]; stop(): void };

/** Env as main.ts sees it on a production entity world with fake minds; set before the server modules load. */
function env(key: string, worldId: string, dir: string) {
  Object.assign(process.env, { WORLD_KEY: key, WORLD_ID: worldId, ENGINE: 'mars', BRAIN_MODE: 'fake', DEV_AUTH: '1', DATA_DIR: dir,
    ENABLE_WORLD_ENGINE: '1', SOUL_LIFECYCLE: '1', MIND_DRIVER: 'edge' });
}

export async function bootForWalk(o: { db?: string; genesis?: string; fuzz?: string; name?: string }): Promise<Booted> {
  const dir = mkdtempSync(join(tmpdir(), 'walk-audit-')), file = join(dir, 'sim.db');
  let worldId: string, seed: string;
  if (o.db) {
    if (o.db.endsWith('.gz')) writeFileSync(file, gunzipSync(readFileSync(o.db)));
    else new DatabaseSync(o.db, { readOnly: true }).exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const head = new DatabaseSync(file, { readOnly: true }).prepare('SELECT id, seed FROM worlds LIMIT 1').get() as { id: string; seed: string };
    worldId = head.id; seed = head.seed;
  } else { worldId = o.fuzz ? 'walk-fuzz-1' : 'walk-genesis-1'; seed = o.fuzz ? 'walk-fuzz' : 'walk-genesis'; }
  env(worldId.replace(/-\d+$/, ''), worldId, dir);
  const { Db } = await import('../db.ts'), { WorldHost } = await import('../world.ts'), mars = await import('@souls/engine-mars');
  const { loadGroundRecipes, GroundHost } = await import('./ground-host.ts'), { GodMode } = await import('./god.ts');
  const { EdgeLedger } = await import('../edge/ledger/ledger.ts'), { installEngineBridge } = await import('./engine-bridge.ts');
  const db = new Db(file);
  loadGroundRecipes(db, worldId);
  const factory = await mars.marsFactory({ ...mars.GREEN_FIELD_WORLD, safeCrewRemoval: true });
  const host = new WorldHost(db, factory, seed, 600, worldId); host.boot();
  const edge = new EdgeLedger(host, db);
  const fuzz = o.fuzz ? (await import(o.fuzz)).fuzzWorld() as FuzzWorld : undefined;
  const genesis = fuzz ? fuzz.genesis : o.genesis ? JSON.parse(readFileSync(o.genesis, 'utf8')) : undefined;
  const god = new GodMode(db, { genesis, worldId, ownerId: null, tick: () => host.engine.world.tick, emit: () => {} });
  new GroundHost(db, host, god); host.drainInputs();
  const bridge = installEngineBridge({ host, god, edge, log: () => {} });
  bridge.reconcile(); host.drainInputs();
  const refused = fuzz ? await buildFuzz(fuzz, god, host, bridge) : [];
  const name = o.name ?? (o.db ? basename(o.db).replace(/\.db(\.gz)?$/, '') : o.fuzz ? 'fuzz' : basename(o.genesis!).replace(/\.json$/, '') + '-genesis');
  // the copy is scratch: on the laptop it goes to the cleanup trash (lane rule: no rm), elsewhere the OS reaps tmp
  const trash = join(homedir(), '.Trash', 'eden-cleanup-20261020');
  const stop = () => { host.stop(); if (existsSync(trash)) try { renameSync(dir, join(trash, basename(dir))); } catch { /* left in tmp */ } };
  return { name, worldId, host, god, bridge, engine: host.engine as any, refused, stop };
}

/** tools/test-harness/walk/fuzz-world.mjs: a genesis for the terrain plus god batches, one per place, and the buildings to furnish. */
const FUZZ_CHUNK_OPS = 120;   // ops per commit
type FuzzWorld = { seed: string; genesis: unknown; build: { place: string; group?: string; ops: unknown[] }[]; furnish: string[] };
/** Build the fuzz world as a god does after the world exists: each place's batch, then `furnish <building>` (furnish.mjs) for
 *  each building, all through god.act with the engine bridge live (so commit-time checks and repairs run). A refused batch is
 *  scored as a bad destination of its place (`build.refused` / `furnish.refused`), never fatal, so one refusal cannot hide the rest. */
async function buildFuzz(f: FuzzWorld, god: any, host: any, bridge: any): Promise<[string, string, string][]> {
  const { furnishBatch } = await import('../../../../tools/god-skill/lib/furnish.mjs');
  const out: [string, string, string][] = [], placed = new Set<string>(), t0 = performance.now();
  const code = (r: any) => String(r.failures?.[0]?.code ?? 'unknown');
  // places go in chunks of whole places (each commit re-installs the ground, so one commit per place costs ~0.2 s each);
  // a refused chunk is retried place by place, so a refusal is scored against its own place only
  const chunks: FuzzWorld['build'][] = [];
  for (const b of f.build) { const c = chunks.at(-1); if (c && c[0].group === b.group && c.reduce((n, x) => n + x.ops.length, 0) + b.ops.length <= FUZZ_CHUNK_OPS) c.push(b); else chunks.push([b]); }
  for (const c of chunks) {
    const r = c.length > 1 ? god.act({ ops: c.flatMap((b) => b.ops) }, `fuzz ${c[0].place}..${c.at(-1)!.place}`) : null;
    if (process.env.WALK_FUZZ_TIMES && r && !r.accepted) console.error(`fuzz chunk ${c[0].place}: refused ${code(r)}`);
    if (r?.accepted) { for (const b of c) placed.add(b.place); host.drainInputs(); continue; }
    for (const b of c) {
      const r1 = god.act({ ops: b.ops }, `fuzz ${b.place}`);
      if (r1.accepted) placed.add(b.place); else out.push([`build.refused.${code(r1)}`, `build:${b.place}`, b.place]);
      host.drainInputs();
    }
  }
  const t1 = performance.now();
  for (const place of f.furnish) {
    if (!placed.has(place)) continue;
    const fb = furnishBatch(god.model, place);
    if (!fb.ops.length) continue;
    const r = god.act({ ops: fb.ops }, `furnish ${place}`);
    if (!r.accepted) out.push([`furnish.refused.${code(r)}`, `furnish:${place}`, place]);
    host.drainInputs();
  }
  const t2 = performance.now();
  bridge.reconcile(); host.drainInputs();
  if (process.env.WALK_FUZZ_TIMES) console.error(`fuzz build ${Math.round(t1 - t0)} ms, furnish ${Math.round(t2 - t1)} ms, reconcile ${Math.round(performance.now() - t2)} ms`);
  return out;
}

export async function walkAudit(w: Booted, shard: [number, number] = [0, 1], o: { use?: boolean } = {}): Promise<WalkPart> {
  const { unsupportedRootGap } = await import('./walk-floats.ts');
  const ms: Record<string, number> = {}, lap = (k: string, t: number) => { ms[k] = Math.round(performance.now() - t); };
  const m = w.god.model, e = w.engine, [k, n] = shard, mine = (at: readonly number[]) => shardOf(at, n) === k;
  const top = (path: string) => path.split('/')[0];
  const placeOf = (id: string) => {   // `walk:<path>`, `seat:<entity>#seat-1`, `berth:…`, `region:<id>`
    const ref = id.slice(id.indexOf(':') + 1), ent = ref.split('#')[0];
    return top(m.entities.has(ent) ? m.pathOf(ent) : ref);
  };
  let t = performance.now(); e.connectivityV1(); lap('labels', t);
  const dests: { id: string; p: [number, number]; level: number; tol?: number }[] = [], goalless: [string, string][] = [];
  t = performance.now();
  // in spatial order (32 m cells), so neighbouring goals share the engine's small fine-tile LRU (same answers, ~5x faster)
  const cell = (v: number) => Math.floor(v / 32);
  const allThings: Thing[] = [...w.bridge.nav.things()], byRef = new Map(allThings.map(th => [th.ref, th]));
  const goals = new Map<Thing, any>(), goalFor = (th: Thing) => {
    if (!goals.has(th)) goals.set(th, w.bridge.nav.goal(th, th.at));
    return goals.get(th);
  };
  const goallessAliases: [string, string, string][] = [];
  const things = allThings.filter((th: Thing) => mine(th.at))
    .sort((a: any, b: any) => cell(a.at[1]) - cell(b.at[1]) || cell(a.at[0]) - cell(b.at[0]) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  for (const th of things) {
    const g = goalFor(th);
    if (!g) {
      const canonical = goallessEntryAlias(th, byRef, t => !!goalFor(t)), place = placeOf(`walk:${th.ref}`);
      // The canonical room is scored in its own spatial shard, including when it differs from the root's shard.
      if (canonical) goallessAliases.push([th.ref, canonical, place]);
      else goalless.push([th.ref, place]);
    } else dests.push({ id: `walk:${th.ref}`, p: g.p, level: g.level });
  }
  lap('goals', t); t = performance.now();
  for (const x of e.navTargetsV1(mine)) dests.push({ id: `${x.kind}:${x.id}`, p: x.p, level: x.level, tol: x.tol });
  lap('targets', t); t = performance.now();
  const bad: [string, string, string][] = [];
  for (const v of e.navCheckV1(dests) as { id: string; ok: boolean; code?: string }[]) if (!v.ok) bad.push([v.code ?? 'nav.unknown', v.id, placeOf(v.id)]);
  if (k === 0) bad.push(...w.refused);   // fuzz world: a refused build or furnish batch is a bad destination of its place
  lap('check', t); t = performance.now();
  let unusable: [string, string, string][] | undefined;
  if (o.use) {
    const { useCheckFor } = await import('./walk-use.ts');
    unusable = useCheckFor(e, mine).filter((v) => !v.ok).map((v) => [v.code ?? 'use.unknown', `use:${v.id}`, placeOf(`use:${v.id}`)] as [string, string, string]);
    lap('use', t); t = performance.now();
  }
  const floats: [string, number, string][] = []; let roots = 0;
  if (k === 0) {
    for (const ent of m.entities.values()) {
      if (ent.in?.parent !== 'world') continue;
      const def = m.resolvedDef(ent.def); if (!def || def.components?.landform || def.layer === 'volume') continue;
      roots++;
      const gap = unsupportedRootGap(m, ent);
      if (gap > FLOAT_M) { const path = m.pathOf(ent.id); floats.push([path, Math.round(gap * 10) / 10, top(path)]); }
    }
  }
  lap('floats', t);
  const by = (a: string[], b: string[]) => (a.join('\t') < b.join('\t') ? -1 : 1);
  return { schemaVersion: 1, version: WALK_AUDIT_VERSION, name: w.name, worldId: w.worldId, shard, dests: dests.length, roots,
    bad: bad.sort(by), goalless: goalless.sort(by), goallessAliases: goallessAliases.sort(by), floats: floats.sort((a, b) => (a[0] < b[0] ? -1 : 1)), ...(unusable ? { unusable: unusable.sort(by) } : {}), ms };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(`--${k}`); return i < 0 ? undefined : a[i + 1]; };
  const db = arg('db'), genesis = arg('genesis'), fuzz = arg('fuzz'), out = arg('out'), sh = (arg('shard') ?? '0/1').split('/').map(Number) as [number, number];
  if (!(sh[1] >= 1 && sh[0] >= 0 && sh[0] < sh[1])) { console.error('--shard k/n with 0 <= k < n'); process.exit(2); }
  if ([db, genesis, fuzz].filter(Boolean).length !== 1) { console.error('usage: walk-audit.ts --db <copy.db|.db.gz> | --genesis <template.json> | --fuzz <fuzz-world.mjs> [--use] [--name n] [--shard k/n] [--out file]'); process.exit(2); }
  const t0 = performance.now();
  const w = await bootForWalk({ db: db && resolve(db), genesis: genesis && resolve(ROOT, genesis), fuzz: fuzz && resolve(ROOT, fuzz), name: arg('name') });
  const boot = Math.round(performance.now() - t0);
  const r = await walkAudit(w, sh, { use: a.includes('--use') }); r.ms = { boot, ...r.ms, total: Math.round(performance.now() - t0) };
  const text = JSON.stringify(r);
  if (out) { if (!existsSync(resolve(out, '..'))) mkdirSync(resolve(out, '..'), { recursive: true }); writeFileSync(out, text + '\n'); }
  else console.log(text);
  console.error(`walk-audit ${r.name} ${sh.join('/')}: dests ${r.dests} bad ${r.bad.length} goalless ${r.goalless.length} floats ${r.floats.length}${r.unusable ? ` unusable ${r.unusable.length}` : ''} ms ${JSON.stringify(r.ms)}`);
  w.stop(); process.exit(0);
}
