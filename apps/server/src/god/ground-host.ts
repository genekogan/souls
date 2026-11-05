// Ground host (lane L8, spec <eden4>/31 B1): keeps the Soul engine standing
// on the entity world's ground. Every ground recipe the world ever had is kept
// content-addressed in `world_ground_recipes_v1`; on boot (before the engine
// replays) they are registered with the engine bridge, so a logged
// `groundV1 {recipeHash, editSeq}` rules fact always resolves. On every god
// commit that touches tiles (and once at start), the current recipe is stored
// and a new fact is logged; replay re-derives every height from the journal.
//
// It also offers Souls the ground's reference points through the edge:
// `walk:flag-<name>` for every god flag, `swim:<water>` for every water body
// (enter nearby reachable deep water; an explicit middle target is also offered).
import type { DatabaseSync } from 'node:sqlite';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type { Db } from '../db.ts';
import type { WorldHost } from '../world.ts';
import type { GodMode } from './god.ts';
import { groundFact, groundRecipe, registerGroundRecipe, standHeight } from '@sim/engine-mars';
import { groundRecipeHash, type Ground } from '@sim/ground';

export function ensureGroundTable(db: Db) {
  db.db.exec('CREATE TABLE IF NOT EXISTS world_ground_recipes_v1 (world_id TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY (world_id, hash)) WITHOUT ROWID');
}
/** Register every recipe this world has logged (call before the engine boots/replays). Returns how many. */
export function loadGroundRecipes(db: Db, worldId: string): number {
  ensureGroundTable(db);
  return registerGroundRecipes(db.db, worldId);
}
/** The registering half of loadGroundRecipes, on any connection: a release's pre-warm reads them read-only (standby.ts). */
export function registerGroundRecipes(conn: Pick<DatabaseSync, 'prepare'>, worldId: string): number {
  const rows = conn.prepare('SELECT hash, body FROM world_ground_recipes_v1 WHERE world_id=?').all(worldId) as { hash: string; body: string }[];
  for (const r of rows) { const h = registerGroundRecipe(JSON.parse(r.body) as Ground); if (h !== r.hash) throw new Error(`ground.recipe-hash-mismatch: stored ${r.hash}, computed ${h}`); }
  return rows.length;
}

type Engine = { world: { groundV1?: { recipeHash: string; nav?: string }; entities: Record<string, { kind: string; pose: { p: number[] } }> }; previewGroundV1?: (f: unknown) => { code: string } | null };

export class GroundHost {
  readonly db: Db; readonly host: WorldHost; readonly god: GodMode;
  /** The recipe hash of the last fact this host logged (pending or applied). */
  private logged: string | null = null;
  installs = 0;
  constructor(db: Db, host: WorldHost, god: GodMode) {
    this.db = db; this.host = host; this.god = god;
    ensureGroundTable(db);
    god.onCommit((c) => { if (c.diff.tiles.length || c.diff.world || c.diff.constants) this.sync(c.seq); });   // constants: the bounds grew (GOD-ENV)
    this.sync(god.model.editSeq);
    // A separate accepted fact preserves historical landings and cannot overwrite queued runtime policies.
    if (host.engine.groundReclaimEnabledV1?.() !== true) void host.enqueue('rules', 'god:ground', { groundReclaimV1: true, why: 'ground-reclaim/1: reclaimed Souls land on terrain or slab support from this point onward' });
  }
  private get engine(): Engine { return this.host.engine as unknown as Engine; }
  /** Store the current recipe and log a groundV1 fact when it differs from what the engine stands on. */
  sync(seq: number): string {
    const g = this.god.model.ground(), hash = groundRecipeHash(g);
    if (!groundRecipe(hash)) registerGroundRecipe(g);
    this.db.db.prepare('INSERT OR IGNORE INTO world_ground_recipes_v1 (world_id, hash, body) VALUES (?, ?, ?)').run(this.host.worldId, hash, JSON.stringify(g));
    // compare with the newest ground this host asked for (a fact may still be queued: A → B → A must log A again)
    // god worlds walk the whole ground (lane NAV: paged navigation); a world standing on the old 384 m window adopts it once
    // (NAV_PAGED=0: the old 384 m window, for comparison runs)
    const want = process.env.NAV_PAGED !== '0', paged = (this.engine.world.groundV1?.nav === 'paged/1') === want;
    const intended = this.logged ?? (paged ? this.engine.world.groundV1?.recipeHash : null) ?? null;
    if (intended === hash) return hash;
    if (!this.engine.previewGroundV1) throw new Error('ground.reader-required: this engine has no ground reader');
    this.logged = hash; this.installs++;
    void this.host.enqueue('rules', 'god:ground', { groundV1: groundFact(g, seq, { paged: process.env.NAV_PAGED !== '0' }), why: 'ground/1: Souls stand on the entity world\'s terrain (prospective; earlier history replays unchanged)' });
    return hash;
  }
  /** Ground height for a body standing at (x, z) on the current recipe (diagnostics, e2e). */
  heightAt(x: number, z: number): number | null {
    const h = this.engine.world.groundV1?.recipeHash; if (!h) return null;
    return standHeight(groundFieldOf(h), x, z);
  }
}
import { groundField as groundFieldOf } from '@sim/engine-mars';

// ---------------------------------------------------------------- edge capabilities

type Ledger=Pick<EdgeLedger,'worldProfile'>&Partial<Pick<EdgeLedger,'registerExactWalkProfile'>>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'flag';
const centroid = (pts: [number, number][]) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length] as [number, number]; };

/** F4 (#375): a named god flag as wayfinding sees it: its label, the walk that goes there, and where it stands. */
export type NamedFlagV1 = { name: string; walk: string; entity: string; at: [number, number] };
export function namedFlagsV1(god: GodMode): NamedFlagV1[] {
  const out: NamedFlagV1[] = [];
  for (const e of god.model.entities.values()) {
    if (!/^core[-/]flag@/.test(god.model.def(e.def)?.ref ?? e.def)) continue;
    const wp = god.model.worldPose(e), label = String(e.state?.label ?? e.name ?? e.id);
    out.push({ name: label, walk: `walk:flag-${slug(e.name ?? label)}`, entity: e.id, at: [Math.round(wp.x * 10) / 10, Math.round(wp.z * 10) / 10] });
  }
  return out;
}

/** Offer `walk:flag-<name>` and `swim:<water>` capabilities from the god world (chains any profile already installed). */
const DEEP_MIDDLE = new Map<string, boolean>();
/** B-facade (read worker): what main's swim offers read besides the god model, shipped with the delta: the ground recipe
 *  and the deep-middle answers main's engine gave (static per recipe and outline). */
export type GroundEnvV1 = { recipe: string | null; middles: Record<string, boolean> };
export function installGroundCapabilities(ledger: Ledger, god: GodMode, host: WorldHost, read?: () => GroundEnvV1 | undefined) {
  const offerFlags=(soul:Parameters<NonNullable<EdgeLedger['worldProfile']>>[0],caps:Parameters<NonNullable<EdgeLedger['worldProfile']>>[1],plans:Parameters<NonNullable<EdgeLedger['worldProfile']>>[2],only?:string)=>{
    const me=host.engine.world.entities[soul.entityId];if(!me)return;
    for (const e of god.model.entities.values()) {
      if (!/^core[-/]flag@/.test(god.model.def(e.def)?.ref ?? e.def)) continue;
      const wp = god.model.worldPose(e), label = String(e.state?.label ?? e.name ?? e.id), id = `walk:flag-${slug(e.name ?? label)}`;
      if ((only!==undefined&&id!==only)||caps.some((c) => c.id === id)) continue;
      caps.push({ id, verb: 'walk', label: `Walk to the flag "${label}" (${Math.round(Math.hypot(wp.x - me.pose.p[0], wp.z - me.pose.p[2]))} m)`, available: true, target: { id: e.id, kind: 'object' } });
      plans.set(id, { label: `Walk to ${label}`, steps: [{ verb: 'walk_to', params: { to: [wp.x, wp.z], standoff: 0.8 } }] });
    }
  };
  const prev = ledger.worldProfile;
  (ledger as { namedFlagsV1?: () => NamedFlagV1[] }).namedFlagsV1 = () => namedFlagsV1(god);   // F4: `around` and `map` name the flags
  if (!read) (ledger as { groundEnvV1?: () => GroundEnvV1 }).groundEnvV1 = () => ({ recipe: (host.engine.world as unknown as { groundV1?: { recipeHash: string } }).groundV1?.recipeHash ?? null, middles: Object.fromEntries(DEEP_MIDDLE) });
  ledger.worldProfile = (soul, caps, plans) => {
    prev?.(soul, caps, plans);
    const me = (host.engine.world.entities as Record<string, { pose: { p: number[] } }>)[soul.entityId];
    if (!me) return;
    offerFlags(soul,caps,plans);
    const env=read?.(),ground=god.model.ground(),recipe=read?env?.recipe??undefined:(host.engine.world as unknown as {groundV1?:{recipeHash:string}}).groundV1?.recipeHash,field=recipe&&!read?groundFieldOf(recipe):null;
    for (const w of ground.waters) {
      const pts = (w.area ?? w.path) as [number, number][], mid = centroid(pts), named = god.model.entities.get(w.id)?.name ?? w.id, id = `swim:${slug(named)}`;
      if (caps.some((c) => c.id === id)) continue;
      // Native travel validates a real bank and handles walking off a jetty;
      // an outline point can be many metres from the actual wetted shoreline.
      caps.push({ id, verb: 'swim', label: `Swim in ${named} (enter nearby reachable deep water)`, available: true, target: { id: w.id, kind: 'object' } });
      plans.set(id, { label: `Swim in ${named}`, steps: [{ verb: 'mars:swim_in', params: { water:w.id } }] });
      // L3 item 4: whether a water's centre is deep is static ground: asked once per recipe and outline, not per menu build
      const mkey=`${recipe}|${w.id}|${mid[0]},${mid[1]}`;let middle=DEEP_MIDDLE.get(mkey);
      if(middle===undefined&&read)middle=env?.middles[mkey]??false;
      else if(middle===undefined){middle=field?.waterId?.(mid[0],mid[1])===w.id&&field.medium(mid[0],mid[1])===2&&(host.engine as unknown as {deepWaterTargetV1?:(x:number,z:number)=>boolean}).deepWaterTargetV1?.(mid[0],mid[1])===true;DEEP_MIDDLE.set(mkey,middle);if(DEEP_MIDDLE.size>4096)DEEP_MIDDLE.delete(DEEP_MIDDLE.keys().next().value!);}
      caps.push({id:`${id}/middle`,verb:'swim',label:`Swim to the middle of ${named}`,available:middle,target:{id:w.id,kind:'object'},...(!middle?{blocked:{code:'swim.no-deep-middle',reason:'The centre point is not deep water in this body; choose its generic swim action.'}}:{})});
      if(middle)plans.set(`${id}/middle`,{label:`Swim to the middle of ${named}`,steps:[{verb:'mars:swim_in',params:{water:w.id,x:mid[0],z:mid[1]}}]});
    }
  };
  ledger.registerExactWalkProfile?.(ledger.worldProfile,prev,(soul,asked,caps,plans)=>{offerFlags(soul,caps,plans,asked);return true;});
}
