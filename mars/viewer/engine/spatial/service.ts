// Spatial service: composes base static geometry with the current world's
// entities, keeps grids in sync (navigation epoch), and answers route /
// clearance queries. Construction mutates entities; the next query sees the
// new topology (spec §10 "construction must alter future navigation").
import { hashOf } from '../core/hash.ts';
import { dcos, dsin, hypot, rot2, type OBB2, type Vec2 } from '../core/math.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { CATALOG, def } from '../world/catalog.ts';
import { passRelevant } from '../world/relevant.ts';
import { buildStaticGrids, buildGrids, clearanceAt, gridsWithObstacles, StaticRaster, updateGrids, type GridSet, type LevelGrid } from './grid.ts';
import { findRoute, prepareCorridor, type Place, type RouteOpts, type RouteResult } from './path.ts';
import type { AgentProfile, Link, Obstacle, SpatialScene, Surface } from './types.ts';
import type { Profiler } from '../runtime/profile.ts';
import { sleepEnvelope, SLEEP_BODY_MARGIN } from '../activities/sleep.ts';
import { sceneForWorld, worldBaseId } from './edits.ts';
import { FINE_LRU_PAGED, GroundNav, PAGED_DIRECT_M, clusterRects, groundRoute, pagedRoute, rectOf, type TileRect } from './tiled.ts';
import type { GroundField } from './ground.ts';

/** Phases in which a component physically occupies space as a static obstacle. */
const STATIC_PHASES = new Set(['stored', 'reserved', 'staged', 'placed', 'installed', 'raising']);
/** Non-human entity that blocks walking where it stands: a static phase, or no phase and a catalog `obstacle` fixture (chair, bench, campfire). */
import { navTrustChecking, navTrustToken } from './nav-trust.ts';
const isStatic = (e: Entity) => e.kind !== 'human' && (e.phase ? STATIC_PHASES.has(e.phase) : CATALOG[e.def]?.obstacle === true);
/**
 * What sync's change test reads of one static entity: id, def, phase, pose (p, yaw, pitch, roll),
 * connections (socket / to / toSocket, flattened) and support kind — exactly the fields the old
 * `hashOf([id, def, phase, pose, connections ?? [], support?.kind ?? ''])` key hashed. Numbers are
 * compared with ===, which agrees with that key's JSON text (-0 = 0; undefined ≠ 0 for pitch/roll).
 * Actions mutate `pose.p` and push onto `connections` in place, so values are copied, not referenced.
 */
type NavSnap = { id: string; def: string; phase: string | undefined; x: number; y: number; z: number; yaw: number; pitch: number | undefined; roll: number | undefined; conn: string[]; support: string };

function navSnap(e: Entity, s?: NavSnap): NavSnap {
  const conn: string[] = [];
  if (e.connections) for (const c of e.connections) conn.push(c.socket, c.to, c.toSocket);
  const p = e.pose.p, support = e.support?.kind ?? '';
  if (!s) return { id: e.id, def: e.def, phase: e.phase, x: p[0], y: p[1], z: p[2], yaw: e.pose.yaw, pitch: e.pose.pitch, roll: e.pose.roll, conn, support };
  s.id = e.id; s.def = e.def; s.phase = e.phase; s.x = p[0]; s.y = p[1]; s.z = p[2];
  s.yaw = e.pose.yaw; s.pitch = e.pose.pitch; s.roll = e.pose.roll; s.conn = conn; s.support = support;
  return s;
}

function sameNav(s: NavSnap, e: Entity): boolean {
  const p = e.pose.p, pose = e.pose;
  if (s.id !== e.id || s.def !== e.def || s.phase !== e.phase || s.x !== p[0] || s.y !== p[1] || s.z !== p[2] || s.yaw !== pose.yaw || s.pitch !== pose.pitch || s.roll !== pose.roll || s.support !== (e.support?.kind ?? '')) return false;
  const cs = e.connections, conn = s.conn;
  if ((cs ? cs.length * 3 : 0) !== conn.length) return false;
  if (cs) for (let i = 0, k = 0; i < cs.length; i++, k += 3) {
    const c = cs[i];
    if (c.socket !== conn[k] || c.to !== conn[k + 1] || c.toSocket !== conn[k + 2]) return false;
  }
  return true;
}

/** Bounded memo of people-augmented grids (each holds full-size rasters). */
const AROUND_CACHE = 8;
/** Bounded memo of upper-level grids over tiles no paged window holds (levelAt): ~2 MB each. */
const OUTSIDE_LEVELS = 12;
/** routeAround: how far the start of a people-avoiding route may snap (path.ts RouteOpts.startTolerance). */
const AROUND_START_TOL = 1.0;
/** Height band a standing person blocks above their feet. */
const PERSON_H = 1.8;

/**
 * A temporary obstacle for gridsAround/routeAround: a person id (height from the world, or `y`) or `<entity>#i` load disc.
 * Footprint: a 0.3 m half-width square; with `half`, an octagon (that square and the same square turned 45°)
 * of that inradius, about as wide in every direction (the walker's squeezed people-replan).
 */
export type AroundPerson = { id: string; p: Vec2; y?: number; half?: number };

function aroundObstacle(world: WorldState, q: AroundPerson): { o: Obstacle; foot?: number }[] {
  const e = world.entities[q.id] ?? world.entities[q.id.split('#')[0]];
  const h = q.half ?? 0.3;
  // Sleep reserves the entire lie/rise union; crowd squeezing must not shrink it.
  const envelope = e?.human ? sleepEnvelope(e) : null;
  const sleeping = envelope ? { ...envelope, half: [envelope.half[0] + SLEEP_BODY_MARGIN, envelope.half[1] + SLEEP_BODY_MARGIN] as Vec2 } : null;
  const obbs = sleeping ? [sleeping] : [{ c: q.p, half: [h, h] as Vec2, yaw: 0 }, ...(q.half === undefined ? [] : [{ c: q.p, half: [h, h] as Vec2, yaw: Math.PI / 4 }])];
  if (q.y === undefined && e && e.kind !== 'human') {
    const f = entityFootprint(e);
    return obbs.map((obb) => ({ o: { id: q.id, obb, y0: f.y0, y1: f.y1, kind: 'solid' as const, label: `${e.label ?? e.id} (moving)` } }));
  }
  const foot = q.y ?? e?.pose.p[1] ?? 0;
  return obbs.map((obb) => ({ o: { id: q.id, obb, y0: foot, y1: foot + PERSON_H, kind: 'solid' as const, label: `person ${q.id}` }, foot }));
}

/** World-space box corners for an entity (handles yaw/pitch/roll). */
export function entityCorners(e: Entity): [number, number, number][] {
  const [sx, sy, sz] = def(e.def).size;
  const out: [number, number, number][] = [];
  const cy = dcos(e.pose.yaw), syw = dsin(e.pose.yaw);
  const cp = dcos(e.pose.pitch ?? 0), sp = dsin(e.pose.pitch ?? 0);
  const cr = dcos(e.pose.roll ?? 0), sr = dsin(e.pose.roll ?? 0);
  // local box: x∈[-sx/2,sx/2], y∈[0,sy] (origin at base centre), z∈[-sz/2,sz/2]
  for (const x of [-sx / 2, sx / 2]) for (const y of [0, sy]) for (const z of [-sz / 2, sz / 2]) {
    // roll about Z
    let X = x * cr - y * sr, Y = x * sr + y * cr, Z = z;
    // pitch about X
    const Y2 = Y * cp - Z * sp, Z2 = Y * sp + Z * cp;
    Y = Y2; Z = Z2;
    // yaw about Y (counter-clockwise from above in x/z): x' = x cos - z sin, z' = x sin + z cos
    const X3 = X * cy - Z * syw, Z3 = X * syw + Z * cy;
    X = X3; Z = Z3;
    out.push([e.pose.p[0] + X, e.pose.p[1] + Y, e.pose.p[2] + Z]);
  }
  return out;
}

/** Tight yaw-aligned ground footprint + vertical span of an entity. */
export function entityFootprint(e: Entity, pad = 0): { obb: OBB2; y0: number; y1: number } {
  const cs = entityCorners(e);
  let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y, z] of cs) {
    const l = rot2([x - e.pose.p[0], z - e.pose.p[2]], -e.pose.yaw);
    ax = Math.min(ax, l[0]); bx = Math.max(bx, l[0]); az = Math.min(az, l[1]); bz = Math.max(bz, l[1]);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const lc: Vec2 = [(ax + bx) / 2, (az + bz) / 2];
  const c = rot2(lc, e.pose.yaw);
  return { obb: { c: [e.pose.p[0] + c[0], e.pose.p[2] + c[1]], half: [(bx - ax) / 2 + pad, (bz - az) / 2 + pad], yaw: e.pose.yaw }, y0, y1 };
}

export type SceneContribution = { obstacles?: Obstacle[]; surfaces?: Surface[]; links?: Link[] };
/** Mars-specific construction semantics can contribute walkable decks / stairs (see construction/). */
export type Contributor = (world: WorldState, base: SpatialScene) => SceneContribution;

export class Spatial {
  base: SpatialScene;
  /** Identity of the static base this service represents (defaults to hashOf(base)). A crop of a
   *  campus is a performance view of the same base and shares the campus content hash. */
  baseId: string;
  cell: number;
  contributors: Contributor[];
  /** Route planner for route()/routeAround() (path.ts RouteOpts.planner); 'exact' unless opted in. */
  planner: 'exact' | 'corridor';
  /** routeAround proves unreachable goals early (path.ts RouteOpts.proveUnreachable); identical results either way. */
  proveUnreachable = true;
  /** Patch the previous grids on sync (grid.ts updateGrids, bit-identical) instead of rebuilding; default on. */
  incremental: boolean;
  scene!: SpatialScene;
  /** Lane P5 (cold boot): a flat-mode sync builds its grids when they are first read, from the inputs captured at that sync
   *  (the same pure build, so the same grids). A restored ground world syncs flat once in applySnapshot and then enters
   *  ground mode, which replaces those grids unread: ~0.2 s of an Eden 2026 boot was spent building them. */
  get grids(): GridSet { const f = this.gridsLater; if (f) { this.gridsLater = null; this.gridsNow = f(); } return this.gridsNow!; }
  set grids(g: GridSet) { this.gridsLater = null; this.gridsNow = g; }
  private gridsNow?: GridSet;
  private gridsLater: (() => GridSet) | null = null;
  epoch = 0;
  /** Paged-ground counters (cheap integers, read by the server's load stats): syncs, rebuilds because only the windows
   *  moved / because the static world changed, the ms those rebuilds took, and window grids built (and their ms). */
  readonly stats = { pagedSyncs: 0, pagedMoved: 0, pagedChanged: 0, pagedMs: 0, gridBuilds: 0, gridMs: 0, scans: 0, scanMs: 0, trusted: 0 };
  /** Diagnostic (SIM_L4_SCAN_SITES=1): scans per calling function (the first frame outside this file). */
  readonly scanSites: Map<string, number> | null = typeof process !== 'undefined' && (process as { env?: Record<string, string | undefined> }).env?.SIM_L4_SCAN_SITES === '1' ? new Map() : null;
  /** Snapshot restore: the navigation epoch the snapshot recorded, until the engine adopts it (adoptRestoredEpoch). */
  restoredEpoch?: number;
  /**
   * Snapshot restore: after the restoring engine rebuilt this world's derived scene (ground windows, world re-base), take
   * the captured epoch back. Those rebuilds describe the same static world the capture synced against, so the epoch must
   * not move: walkers compare it with their own (walk.ts) and would re-verify, re-key narrows and re-smooth mid-walk,
   * which a live world that kept running never does. Caches keyed by the epochs passed through here are dropped.
   */
  adoptRestoredEpoch(): void {
    const e = this.restoredEpoch;
    this.restoredEpoch = undefined;
    if (e === undefined || e === this.epoch) return;
    this.epoch = e;
    this.aroundCache.clear(); this.outside.clear(); this.narrowCache.clear();
  }
  /** Set by `rt.profile = true`: wall ms per method (spatial.route includes its spatial.sync). */
  prof?: Profiler;
  /** Navigation-relevant snapshot of the static entities (in world order) at the last rebuild. */
  private snaps: NavSnap[] = [];
  /** Rasters of the base obstacles (they lead every synced scene's obstacle list). */
  private raster: StaticRaster;

  /** The unedited source scene and its id (servicesFor), so a world edit (nav/1) can re-base this service in place. */
  source?: { scene: SpatialScene; id: string };
  /**
   * Ground mode (lane L8; worlds whose state carries `groundV1` only): level 0 is the terrain, tiled and windowed
   * (spatial/tiled.ts), heights come from the field, and routes are planned hierarchically. Absent: unchanged behaviour.
   */
  ground?: GroundNav;
  private groundDirty = false;
  /**
   * Paged ground (lane NAV; `ground.paged`): the windows the engine faces — one per cluster of nearby bodies and their
   * walk chunks (tiled.ts clusterRects) — with each one's grids (built when first faced) and scene (its bounds), and which
   * cluster each body's own neighbourhood lies in. `scene` / `grids` are the focused window's: the actor being stepped
   * (Runtime focuses it), or the body an invariant checks (`levelOf`).
   */
  private pages: { rects: TileRect[]; key: string; sets: (GridSet | null)[]; scenes: SpatialScene[]; all: SpatialScene } | null = null;
  private focusIdx = 0;
  private focusActor?: string;
  /** Paged: the bounds [x0, z0, x1, z1] (m) of what remains of every walk in progress (the ground bridge reads services.walkExecs). */
  pagedCover?: () => [number, number, number, number][];

  constructor(base: SpatialScene, opts: { cell?: number; contributors?: Contributor[]; baseId?: string; planner?: 'exact' | 'corridor'; incremental?: boolean; source?: { scene: SpatialScene; id: string } } = {}) {
    this.base = base;
    this.source = opts.source;
    this.baseId = opts.baseId ?? hashOf(base);
    this.cell = opts.cell ?? 0.1;
    this.contributors = opts.contributors ?? [];
    this.planner = opts.planner ?? 'exact';
    this.incremental = opts.incremental ?? true;
    this.raster = new StaticRaster(base.obstacles, base.bounds, this.cell);
  }

  /**
   * Re-base on the world's own static edits (nav/1 ground and solids) after a logged rules fact changed them: the
   * static raster is rebuilt once here, and the next sync rebuilds the grids and advances the navigation epoch, so
   * walkers replan. Returns false when nothing changed (or no source is known).
   */
  refreshForWorld(world: WorldState): boolean {
    if (!this.source) return false;
    const id = worldBaseId(this.source.id, world);
    if (id === this.baseId) return false;
    this.base = sceneForWorld(this.source.scene, world);
    this.baseId = id;
    this.raster = new StaticRaster(this.base.obstacles, this.base.bounds, this.cell);
    this.scene = undefined as unknown as SpatialScene;
    this.snaps = [];
    this.trustToken = -1;
    this.aroundCache.clear();
    this.narrowCache.clear();
    this.sync(world);
    return true;
  }

  /**
   * Stage B (lane B-spatial): the surfaces that are the ground field's own (not floors laid on it), when this service was
   * built from a static scene export (fromStaticScene): its base then holds every composed surface. Absent: the source
   * scene's (or base's) surfaces, as always.
   */
  ownSurfaces?: Set<string>;

  /**
   * Stage B (lane B-spatial): what the planner sees of the static world at the current navigation epoch, as plain data —
   * the composed scene lists in the planner's order (base, static entities in world order, contributions), the base
   * levels, and the ids of the ground's own surfaces. `Spatial.fromStaticScene` builds a service over exactly these
   * lists that needs no world entities. Syncs first. Pure read (the lists are shared, not copied: never mutate them).
   */
  staticScene(world: WorldState): StaticSceneV1 {
    this.sync(world);
    const sc = this.pages?.all ?? this.scene;
    return {
      v: 1, cell: this.cell, planner: this.planner, baseId: this.baseId, navEpoch: this.epoch, bounds: this.base.bounds,
      baseLevels: this.base.levels, levels: sc.levels, surfaces: sc.surfaces, obstacles: sc.obstacles, links: sc.links,
      own: [...(this.ownSurfaces ?? new Set((this.source?.scene ?? this.base).surfaces.map((x) => x.id)))],
      ground: this.ground ? { paged: this.ground.paged } : null,
    };
  }

  /**
   * Stage B (lane B-spatial): a service over a static scene export, with no world entities behind it (the read worker's
   * replica). Ground worlds pass the field the export names (the caller resolves its recipe). Sync it with a world that
   * holds bodies only: its composed lists are the export's, in the same order.
   */
  static fromStaticScene(s: StaticSceneV1, world: WorldState, field?: GroundField): Spatial {
    const sp = new Spatial(staticBase(s), { cell: s.cell, baseId: s.baseId, planner: s.planner });
    sp.ownSurfaces = new Set(s.own); sp.tileReads = true;
    if (s.ground) {
      if (!field) throw new Error('spatial.static-scene: a ground scene needs its field');
      sp.setGround(field, world, [], { paged: s.ground.paged });
    } else sp.sync(world);
    sp.epoch = s.navEpoch;
    return sp;
  }

  /**
   * Stage B (lane B-spatial): take a newer export of the same world in place (an epoch change): the next sync rebuilds
   * the scene, and the ground's tiles are rebuilt only where their content changed (tile caches are keyed by content).
   * The service's epoch becomes the export's. A different cell, planner or ground mode is not a rebase (false): build anew.
   */
  rebaseStatic(s: StaticSceneV1, world: WorldState): boolean {
    if (s.cell !== this.cell || s.planner !== this.planner || !s.ground !== !this.ground || (s.ground && s.ground.paged !== this.ground!.paged)) return false;
    this.base = staticBase(s);
    this.baseId = s.baseId;
    this.ownSurfaces = new Set(s.own);
    this.raster = new StaticRaster(this.base.obstacles, this.base.bounds, this.cell);
    this.scene = undefined as unknown as SpatialScene;
    this.pages = null;
    this.snaps = [];
    this.trustToken = -1;
    this.aroundCache.clear();
    this.narrowCache.clear();
    this.outside.clear();
    this.sync(world);
    this.epoch = s.navEpoch;
    return true;
  }

  /**
   * Enter (or leave, with null) ground mode on `field`, the window covering `points` (bodies, active goals). The next sync
   * rebuilds the grids and advances the navigation epoch, so walkers replan on the new ground.
   */
  setGround(field: GroundField | null, world: WorldState, points: Vec2[] = [], opts: { paged?: boolean } = {}): void {
    const prev = this.ground;
    this.ground = field ? new GroundNav(field, this.cell, opts) : undefined;
    this.pages = null;
    if (this.ground && !this.ground.paged) {
      if (prev?.window) this.ground.include(prev.window);
      for (const p of points) this.ground.include(rectOf([p]));
      if (!this.ground.window) this.ground.include(rectOf([[0, 0]]));
    }
    this.scene = undefined as unknown as SpatialScene;
    this.snaps = [];
    this.trustToken = -1;
    this.aroundCache.clear();
    this.narrowCache.clear();
    this.sync(world);
  }

  /** Ground mode: grow the window to cover `r` (resync on growth). False when the window would be too big. */
  groundInclude(world: WorldState, r: TileRect): boolean {
    const g = this.ground!;
    if (g.paged) return true;
    const res = g.include(r);
    if (res === 'too-big') return false;
    if (res === 'grown') { this.groundDirty = true; this.sync(world); }
    return true;
  }

  /** Inside readPass: the world whose sync is already done (and its entities object). */
  private held: { world: WorldState; entities: WorldState['entities'] } | null = null;
  /**
   * Run `fn`, a read of `world` that changes nothing the planner sees (no entity, body or walk in progress moves), with
   * one sync up front: every sync(world) inside it is answered "nothing changed" without walking the entities again
   * (lane L1: a Soul's first listing inside an Eden 2026 house synced ~3,500 times, 0.9 s). A sync still runs whenever
   * the scene is gone or the ground window grew (groundDirty), and for any other world.
   */
  readPass<T>(world: WorldState, fn: () => T): T {
    this.sync(world);
    const prev = this.held;
    this.held = { world, entities: world.entities };
    try {
      return fn();
    } finally {
      this.held = prev;
    }
  }

  /** Rebuild derived scene/grids iff navigation-relevant world content changed. */
  sync(world: WorldState): boolean {
    const h = this.held;
    if (h !== null) {
      if (h.world === world && h.entities === world.entities && this.scene && !this.groundDirty) return false;
      this.held = null;   // the planner now follows another world (or a changed one): real syncs until the pass ends
    }
    const p = this.prof;
    if (!p) return this.syncNow(world);
    const t0 = p.now();
    const rebuilt = this.syncNow(world);
    p.add(rebuilt ? 'spatial.sync.rebuild' : 'spatial.sync', p.now() - t0);
    return rebuilt;
  }

  private syncNow(world: WorldState): boolean {
    if (this.ground) return this.syncGround(world);
    if (!this.navChanged(world) && this.scene) return false;
    const obstacles: Obstacle[] = [...this.base.obstacles];
    const surfaces: Surface[] = [...this.base.surfaces];
    const links: Link[] = [...this.base.links];
    const levels = [...this.base.levels];
    for (const e of Object.values(world.entities)) {
      if (!isStatic(e)) continue;
      const f = entityFootprint(e);
      obstacles.push({ id: e.id, obb: f.obb, y0: f.y0, y1: f.y1, kind: 'component', label: e.label ?? def(e.def).label });
    }
    for (const c of this.contributors) {
      const r = c(world, this.base);
      if (r.obstacles) obstacles.push(...r.obstacles);
      if (r.surfaces) for (const s of r.surfaces) {
        surfaces.push(s);
        if (!levels.some((l) => l.id === s.level)) levels.push({ id: s.level, y: s.y, label: s.label ?? `level ${s.level}` });
      }
      if (r.links) links.push(...r.links);
    }
    const prev = this.scene;
    this.scene = { bounds: this.base.bounds, levels, surfaces, obstacles, links };
    // construction changes a few components: patch only their cells (and the clearance they can reach)
    // every input is captured now: the previous grids (themselves possibly not built yet), both scenes, cell and raster
    // (a second sync before any read builds the first one now: pending builds never chain)
    const before = this.incremental && prev ? this.grids : this.gridsNow, scene = this.scene, cell = this.cell, raster = this.raster, incremental = this.incremental, prof = this.prof, corridor = this.planner === 'corridor';
    const grids = () => (incremental && prev && updateGrids(before!, prev, scene, cell, raster)) || buildStaticGrids(scene, cell, raster, incremental);
    this.gridsLater = () => { const g = prof ? prof.time('spatial.sync.grids', grids) : grids(); if (corridor) prepareCorridor(g); return g; };
    this.epoch++;
    return true;
  }

  /** Ground mode sync: the same scene composition, grids from the tiled ground over the window (spatial/tiled.ts). */
  private syncGround(world: WorldState): boolean {
    const g = this.ground!;
    if (g.paged) return this.syncPaged(world);
    // every body on level 0 stays inside the window (a body outside it would read clearance 0)
    for (const id in world.entities) {
      const e = world.entities[id];
      if (e.kind !== 'human' || !e.human || (e.human.level ?? 0) !== 0) continue;
      const tx = Math.floor(e.pose.p[0] / 64), tz = Math.floor(e.pose.p[2] / 64), w = g.window;
      if (!w || tx < w[0] || tx > w[2] || tz < w[1] || tz > w[3]) { if (g.include(rectOf([[e.pose.p[0], e.pose.p[2]]])) === 'grown') this.groundDirty = true; }
    }
    if (!this.navChanged(world) && this.scene && !this.groundDirty) return false;
    this.groundDirty = false;
    const obstacles: Obstacle[] = [...this.base.obstacles];
    const surfaces: Surface[] = [...this.base.surfaces];
    const links: Link[] = [...this.base.links];
    const levels = this.base.levels.some((l) => l.id === 0) ? [...this.base.levels] : [{ id: 0, y: 0, label: 'ground' }, ...this.base.levels];
    for (const e of Object.values(world.entities)) {
      if (!isStatic(e)) continue;
      const f = entityFootprint(e);
      obstacles.push({ id: e.id, obb: f.obb, y0: f.y0, y1: f.y1, kind: 'component', label: e.label ?? def(e.def).label });
    }
    for (const c of this.contributors) {
      const r = c(world, this.base);
      if (r.obstacles) obstacles.push(...r.obstacles);
      if (r.surfaces) for (const s of r.surfaces) {
        surfaces.push(s);
        if (!levels.some((l) => l.id === s.level)) levels.push({ id: s.level, y: s.y, label: s.label ?? `level ${s.level}` });
      }
      if (r.links) links.push(...r.links);
    }
    this.scene = { bounds: g.bounds(), levels, surfaces, obstacles, links };
    // level-0 floors laid on the ground (not the source scene's own flat field): they raise the standing height
    const own = this.ownSurfaces ?? new Set((this.source?.scene ?? this.base).surfaces.map((x) => x.id));
    g.setFloors(surfaces.filter((x) => x.level === 0 && !own.has(x.id)));
    g.setSolids(obstacles);
    const grids = () => g.grids(this.scene);
    this.grids = this.prof ? this.prof.time('spatial.sync.grids', grids) : grids();
    if (this.planner === 'corridor') prepareCorridor(this.grids);
    this.epoch++;
    this.aroundCache.clear();
    return true;
  }

  /** Paged ground sync: the windows from the bodies and walk chunks now; rebuild when they or the static world changed. */
  private syncPaged(world: WorldState): boolean {
    const g = this.ground!, ext = g.extentTiles(), units: TileRect[] = [];
    const clip = (r: TileRect) => { const q: TileRect = [Math.max(r[0], ext[0]), Math.max(r[1], ext[1]), Math.min(r[2], ext[2]), Math.min(r[3], ext[3])]; if (q[0] <= q[2] && q[1] <= q[3]) units.push(q); };
    // (L1: the bodies are collected in navChanged's one pass over the entities; a capability listing syncs ~2000 times)
    // no scene = first sync or a re-base (refreshForWorld: new levels, wider raster). That changes the static world even
    // when no static entity did: an empty god world's only content is its world-edits, so `navChanged` alone would keep
    // the windows' old grids (no new floor, no new walls) until the next edit or a restart.
    const changed = this.navChanged(world, (e) => clip(rectOf([[e.pose.p[0], e.pose.p[2]]]))) || !this.scene;
    for (const b of this.pagedCover?.() ?? []) clip(rectOf([[b[0], b[1]], [b[2], b[3]]], 4));
    if (!units.length) clip(rectOf([[0, 0]]));
    const rects = this.pinnedPages ?? clusterRects(units), key = rects.map((r) => r.join(',')).join(';');
    this.stats.pagedSyncs++;
    if (!changed && this.pages && this.pages.key === key) return false;
    const t0 = performance.now();
    // L4: only the windows moved (no static change, same entity-physics contribution): the scene lists are the same, so the
    // last ones are kept (re-collecting every static footprint and contribution cost O(entities) per tile crossing).
    const physics = world.entityPhysicsV1?.hash;
    if (!changed && this.pages && this.pagesPhysics === physics) return this.pagedWindows(world, rects, key, { ...this.pages.all, bounds: g.boundsOf(rects[0]) }, false, t0);
    this.pagesPhysics = physics;
    const obstacles: Obstacle[] = [...this.base.obstacles];
    const surfaces: Surface[] = [...this.base.surfaces];
    const links: Link[] = [...this.base.links];
    const levels = this.base.levels.some((l) => l.id === 0) ? [...this.base.levels] : [{ id: 0, y: 0, label: 'ground' }, ...this.base.levels];
    for (const e of Object.values(world.entities)) {
      if (!isStatic(e)) continue;
      const f = entityFootprint(e);
      obstacles.push({ id: e.id, obb: f.obb, y0: f.y0, y1: f.y1, kind: 'component', label: e.label ?? def(e.def).label });
    }
    for (const c of this.contributors) {
      const r = c(world, this.base);
      if (r.obstacles) obstacles.push(...r.obstacles);
      if (r.surfaces) for (const s of r.surfaces) {
        surfaces.push(s);
        if (!levels.some((l) => l.id === s.level)) levels.push({ id: s.level, y: s.y, label: s.label ?? `level ${s.level}` });
      }
      if (r.links) links.push(...r.links);
    }
    const all: SpatialScene = { bounds: g.boundsOf(rects[0]), levels, surfaces, obstacles, links };
    if (changed) {
      const own = this.ownSurfaces ?? new Set((this.source?.scene ?? this.base).surfaces.map((x) => x.id));
      g.setFloors(surfaces.filter((x) => x.level === 0 && !own.has(x.id)));
      g.setSolids(obstacles);
    }
    return this.pagedWindows(world, rects, key, all, changed, t0);
  }
  /** Entity-physics hash the paged scene lists were last collected under. */
  private pagesPhysics: string | undefined;
  /** Paged: install the windows `rects` over the scene lists `all` (keeping the grids of unchanged rects when the static
   *  world did not change) and focus the stepped actor's window. */
  private pagedWindows(world: WorldState, rects: TileRect[], key: string, all: SpatialScene, changed: boolean, t0: number): boolean {
    const g = this.ground!;
    let tiles = 0;
    for (const r of rects) tiles += (r[2] - r[0] + 1) * (r[3] - r[1] + 1);
    g.fineMax = this.tileReads ? FINE_LRU_PAGED : Math.max(FINE_LRU_PAGED, tiles + 8); g.composedMax = this.tileReads ? 2 : rects.length + 4;
    // a window whose rect is unchanged keeps its grids when the static world did not change
    const old = !changed && this.pages ? new Map(this.pages.rects.map((r, i) => [r.join(','), this.pages!.sets[i]])) : null;
    this.pages = { rects, key, sets: rects.map((r) => old?.get(r.join(',')) ?? null), scenes: rects.map((r) => ({ ...all, bounds: g.boundsOf(r) })), all };
    // the navigation epoch moves with the static world only: windows hold the same tiles wherever they lie, so a walk's
    // corridor, smoothing and single-file passages (narrowId: window-independent names) stay valid when windows move
    if (changed) { this.epoch++; this.aroundCache.clear(); }
    if (this.tileReads) this.scene = this.pages.scenes[0];   // a tile-reading replica faces no window: no window grids
    else this.focusPage(this.focusActor && world.entities[this.focusActor] ? this.pageAt([world.entities[this.focusActor].pose.p[0], world.entities[this.focusActor].pose.p[2]]) : 0, true);
    if (changed) this.stats.pagedChanged++; else this.stats.pagedMoved++;
    this.stats.pagedMs += performance.now() - t0;
    return true;
  }

  /** Paged: the window holding `p` — the first whose rect holds p's whole neighbourhood, else the first holding p. */
  private pageAt(p: Vec2): number {
    const rs = this.pages!.rects, u = rectOf([p]), t = rectOf([p], 0);
    let any = -1;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (r[0] <= u[0] && r[1] <= u[1] && r[2] >= u[2] && r[3] >= u[3]) return i;
      if (any < 0 && r[0] <= t[0] && r[1] <= t[1] && r[2] >= t[2] && r[3] >= t[3]) any = i;
    }
    return any < 0 ? 0 : any;
  }

  private focusPage(i: number, force = false) {
    const pg = this.pages!;
    if (!force && i === this.focusIdx && this.grids === pg.sets[i]) return;
    this.focusIdx = i;
    let set = pg.sets[i];
    if (!set) {
      const build = () => this.ground!.gridsOver(pg.rects[i], pg.all), t0 = performance.now();
      set = pg.sets[i] = this.prof ? this.prof.time('spatial.sync.grids', build) : build();
      this.stats.gridBuilds++; this.stats.gridMs += performance.now() - t0;
      if (this.planner === 'corridor') prepareCorridor(set);
    }
    this.scene = pg.scenes[i];
    this.grids = set;
  }

  /** Paged ground: face the window of `actorId` (its body); other worlds: nothing. */
  focusOn(world: WorldState, actorId: string | undefined): void {
    if (!this.ground?.paged || !actorId) return;
    const e = world.entities[actorId];
    if (!e) return;
    this.focusActor = actorId;
    if (!this.pages) { this.sync(world); return; }
    this.focusPage(this.pageAt([e.pose.p[0], e.pose.p[2]]));
  }

  /** The grid of `level` that covers (x, z) (paged ground: that point's window, now faced); other worlds: level(id). */
  levelAt(id: number, p: Vec2) {
    if (this.ground?.paged && this.pages) {
      const i = this.pageAt(p), r = this.pages.rects[i], tx = Math.floor(p[0] / 64), tz = Math.floor(p[1] / 64);
      // a point no window holds (a recovery target, a far arrival, a far thing a Soul is offered): its own small window, the engine's focus unchanged
      if (tx < r[0] || tx > r[2] || tz < r[1] || tz > r[3]) return this.outsideLevel(id, p);
      if (this.tileReads) return this.ground!.levelOver(r, id, this.pages.all);
      this.focusPage(i);
    }
    return this.grids.levels.get(id);
  }

  /**
   * L1 (memory): clearance reads at points round `at` on `level`, exactly as `clearanceAt(levelAt(level, at), q)` — the same
   * values (0 off the grid) and the same window focus — but when no paged window holds `at` on level 0, the points are read
   * from the fine tiles of the composite levelAt would build (GroundNav.clearanceReader) instead of copying it. Null when
   * levelAt has no grid.
   */
  clearanceReader(level: number, at: Vec2): ((q: Vec2) => number) | null {
    if (level === 0 && this.ground?.paged && this.pages) {
      const r = this.pages.rects[this.pageAt(at)], tx = Math.floor(at[0] / 64), tz = Math.floor(at[1] / 64);
      if (tx < r[0] || tx > r[2] || tz < r[1] || tz > r[3]) return this.ground.clearanceReader(rectOf([at]), this.pages.all.obstacles);
      if (this.tileReads) return this.ground.clearanceReader(r, this.pages.all.obstacles);
    }
    const g = this.levelAt(level, at);
    return g ? (q) => clearanceAt(g, q) : null;
  }

  /** L1: `Math.min(clearanceAt(levelAt(level, at), q), cap)` for points round `at`, the same answers and window focus; off
   *  the paged windows on level 0 without building fine tiles (GroundNav.clearanceCapped). Null when levelAt has no grid. */
  clearanceCapped(level: number, at: Vec2, cap: number): ((q: Vec2) => number) | null {
    if (level === 0 && this.ground?.paged && this.pages) {
      const r = this.pages.rects[this.pageAt(at)], tx = Math.floor(at[0] / 64), tz = Math.floor(at[1] / 64);
      if (tx < r[0] || tx > r[2] || tz < r[1] || tz > r[3]) return this.ground.clearanceCapped(rectOf([at]), this.pages.all.obstacles, cap);
      if (this.tileReads) return this.ground.clearanceCapped(r, this.pages.all.obstacles, cap);
    }
    const g = this.levelAt(level, at);
    return g ? (q) => Math.min(clearanceAt(g, q), cap) : null;
  }
  /** L1: `clearanceAt(levelAt(level, at), q) >= t` (clearanceCapped at t). */
  clearTester(level: number, at: Vec2, t: number): ((q: Vec2) => boolean) | null {
    const read = this.clearanceCapped(level, at, t);
    return read ? (q) => read(q) >= t : null;
  }

  /**
   * The grid of `id` over the tile holding `p`, which no paged window holds. Building an upper level costs ~0.1 s (raster
   * and EDT) and a Soul's capability listing, a ring search or a slot check asks for the same few tiles again and again,
   * so each is built once per navigation epoch (the epoch moves whenever the static world does). Level 0 is already
   * memoised tile by tile (GroundNav.compose). Read-only, like every grid levelAt returns; same cells as a fresh build.
   */
  private outsideLevel(id: number, p: Vec2): LevelGrid | undefined {
    const rect = rectOf([p]), g = this.ground!, scene = this.pages!.all;
    if (id === 0) return g.levelOver(rect, 0, scene);
    const key = `${this.epoch}|${id}|${rect.join(',')}`, hit = this.outside.get(key);
    if (hit !== undefined) { this.outside.delete(key); this.outside.set(key, hit); return hit ?? undefined; }
    const built = g.levelOver(rect, id, scene);
    for (const k of this.outside.keys()) if (this.outside.size >= OUTSIDE_LEVELS || !k.startsWith(`${this.epoch}|`)) this.outside.delete(k);
    this.outside.set(key, built ?? null);
    return built;
  }
  private outside = new Map<string, LevelGrid | null>();

  /**
   * Stage B (lane B-spatial), paged ground: the windows the service faces now (shared: never mutate), or null. A read near
   * a window's edge answers from that window's grid (the parts of a ring search beyond it read as blocked), so a replica
   * holds the same windows to give the same answers.
   */
  pageRectsV1(): TileRect[] | null { return this.pages?.rects ?? null; }
  /** Stage B (lane B-spatial), paged ground: hold exactly these windows (another service's pageRectsV1) instead of the
   *  bodies' clusters; null returns to the clusters. Grids of windows whose rect is unchanged are kept. */
  pinPagesV1(rects: TileRect[] | null, world: WorldState): void {
    this.pinnedPages = rects ? rects.map((r) => [...r] as TileRect) : undefined;
    if (this.ground?.paged) this.sync(world);
  }
  private pinnedPages?: TileRect[];
  /**
   * Stage B (lane B-spatial), paged ground: answer a read inside a window from the ground's tiles over that window's rect
   * (GroundNav.clearanceReader / clearanceCapped / levelOver: exactly the window grid's values, 0 beyond its rect) instead
   * of composing the window's grids and facing it. For a replica that plans no routes (which window is faced never
   * matters to it): the window grids are the bulk of its memory. Off (the engine): unchanged.
   */
  tileReads = false;

  /** Paged ground diagnostics: the windows (tile rects) and the bytes their built grids hold. */
  pagesInfo(): { rects: TileRect[]; built: number; bytes: number } | null {
    if (!this.pages) return null;
    let bytes = 0, built = 0;
    for (const set of this.pages.sets) if (set) { built++; for (const g of set.levels.values()) bytes += g.free.byteLength + g.clearance.byteLength + g.nx * g.nz * 4; }
    return { rects: this.pages.rects, built, bytes };
  }

  /**
   * Whether any navigation-relevant field of the static entities (or their set / order) differs from
   * the last call; refreshes the snapshots. Allocation-free when nothing changed (~35k calls a run),
   * and changes exactly when the former sha256 key over the same fields would (planning.test.ts).
   */
  private navChanged(world: WorldState, onBody?: (e: Entity) => void): boolean {
    // S1 V7a: inside an invariant pass the tick's shared entity list (world/entity-list.ts: the for-in order this walks),
    // so a world with a body does not look ~4,900 entities up by key every tick; elsewhere the table itself.
    // S1 r2: only its relevant entities (world/relevant.ts): a plain fixture is neither static (no phase, not a catalogue
    // obstacle) nor a body, so the bodies and the static entities come in the same order as from the whole list.
    // L4: only nav-pure code ran since this table's last scan (nav-trust.ts): no static change; list the bodies again
    const token = navTrustToken();
    if (token >= 0 && this.trustToken === token && this.trustEntities === world.entities) {
      if (navTrustChecking() && this.navScan(world, onBody)) throw new Error('nav-trust: a static entity changed under a nav-pure step');
      else if (navTrustChecking()) { this.stats.trusted++; return false; }
      if (onBody) { const ents = world.entities, ids = this.bodyIds; for (let i = 0; i < this.bodyN; i++) onBody(ents[ids[i]]); }
      this.stats.trusted++;
      return false;
    }
    const t0 = performance.now(), changed = this.navScan(world, onBody);
    this.stats.scans++; this.stats.scanMs += performance.now() - t0;
    if (this.scanSites) {
      const f = (new Error().stack ?? '').split('\n').slice(2).find((l) => !l.includes('/spatial/service.ts')) ?? '?';
      const k = f.trim().replace(/^at /, '').replace(/\(.*\/([^/]+:\d+):\d+\)$/, '$1');
      this.scanSites.set(k, (this.scanSites.get(k) ?? 0) + 1);
    }
    this.trustToken = token; this.trustEntities = world.entities;
    return changed;
  }
  /** The nav-trust token of the last scan (-1: made while trust was closed) and the table it scanned. */
  private trustToken = -1;
  private trustEntities: WorldState['entities'] | null = null;
  /** The bodies the last scan met, in its order (a trusted sync lists them again for the windows). */
  private bodyIds: string[] = [];
  private bodyN = 0;
  private navScan(world: WorldState, onBody?: (e: Entity) => void): boolean {
    const shared = passRelevant(world);
    if (shared) {
      this.navN = 0; this.navChangedFlag = false; this.bodyN = 0;
      for (let i = 0; i < shared.length; i++) this.navVisit(shared[i], onBody);
    } else {
      this.navN = 0; this.navChangedFlag = false; this.bodyN = 0;
      const ents = world.entities;
      for (const id in ents) this.navVisit(ents[id], onBody);
    }
    const snaps = this.snaps, n = this.navN;
    if (snaps.length !== n) { snaps.length = n; this.navChangedFlag = true; }
    return this.navChangedFlag;
  }
  private navN = 0;
  private navChangedFlag = false;
  private navVisit(e: Entity, onBody?: (e: Entity) => void) {
    if (e.kind === 'human' && e.human) { this.bodyIds[this.bodyN++] = e.id; if (onBody) onBody(e); return; }
    if (!isStatic(e)) return;
    const snaps = this.snaps, s = snaps[this.navN];
    if (!s) { snaps.push(navSnap(e)); this.navChangedFlag = true; }
    else if (!sameNav(s, e)) { navSnap(e, s); this.navChangedFlag = true; }
    this.navN++;
  }

  /** route-reach/1 (#872): set by the engine from its accepted runtime policy (re-applied after every runtime rebuild). */
  routeReachV1 = false;
  route(world: WorldState, profile: AgentProfile, start: Place, goal: Place, opts?: RouteOpts): RouteResult {
    const o0 = this.planner === 'exact' ? opts : { planner: this.planner, ...opts }, o = this.routeReachV1 ? { ...o0, routeReachV1: true } : o0;
    if (this.ground) {
      this.sync(world);
      const run = () => groundRoute(this.ground!, this.scene, profile, start, goal, o ?? {}, (r) => this.groundInclude(world, r), () => this.grids);
      return this.prof ? this.prof.time('spatial.route', run) : run();
    }
    if (this.prof) return this.prof.time('spatial.route', () => (this.sync(world), findRoute(this.grids, this.scene, profile, start, goal, o)));
    this.sync(world);
    return findRoute(this.grids, this.scene, profile, start, goal, o);
  }

  level(id: number) {
    return this.grids.levels.get(id);
  }

  /**
   * Grids of `scene`, a variant of the synced scene (same bounds, the base obstacles leading, some
   * obstacles removed or appended, any subset of its levels), patched from the synced grids by
   * updateGrids — bit-identical to `buildGrids(scene, cell)` (grid-incremental.test.ts); a full
   * build when the diff is not a pure add / remove. Call after sync(world).
   */
  gridsFor(scene: SpatialScene): GridSet {
    const run = () => updateGrids(this.grids, this.scene, scene, this.cell, this.raster) ?? buildGrids(scene, this.cell, this.raster);
    return this.prof ? this.prof.time('spatial.gridsFor', run) : run();
  }

  private aroundCache = new Map<string, { scene: SpatialScene; grids: GridSet }>();
  /**
   * Grids of the current scene with the given standing people added as soft obstacles (for
   * replanning around them), built incrementally from the synced grids and memoised per
   * (epoch, ordered people, exact positions and heights).
   *
   * A person occupies [foot, foot + 1.8 m] where foot = their pose y (or `q.y`), and is rasterised
   * only into levels whose floor lies in [foot − 0.3, foot + 1.8) — the level they stand on, not a
   * deck overhead or the ground under a deck (review M3). Anything else in `people` (e.g. carried-
   * load discs `<entity>#i`) keeps its entity's real height band under the usual per-level rule.
   */
  gridsAround(world: WorldState, people: AroundPerson[]): { scene: SpatialScene; grids: GridSet } {
    if (this.prof) return this.prof.time('spatial.gridsAround', () => this.gridsAroundNow(world, people));
    return this.gridsAroundNow(world, people);
  }

  private gridsAroundNow(world: WorldState, people: AroundPerson[]): { scene: SpatialScene; grids: GridSet } {
    this.sync(world);
    const placed = people.flatMap((q) => aroundObstacle(world, q));
    const key = `${this.epoch}|${this.ground?.paged && this.pages ? `${this.pages.rects[this.focusIdx].join(',')}|` : ''}${placed.map(({ o, foot }) => `${o.id}@${o.obb.c[0]},${o.obb.c[1]},${o.obb.half[0]},${o.obb.half[1]},${o.obb.yaw},${o.y0},${o.y1},${foot ?? ''}`).join(';')}`;
    let hit = this.aroundCache.get(key);
    if (hit) {
      this.aroundCache.delete(key);
      this.aroundCache.set(key, hit);
      return hit;
    }
    const extra = placed.map((x) => x.o);
    // people as obstacles: 0.3 m half-width so corridors pass ≥ 0.58 m from them (the hard
    // separation guard is 0.54 m); the route start snaps within 0.5 m if someone stands close.
    // Rasterise level by level so each person lands only on the levels at their own height.
    const levels = new Map(this.grids.levels);
    for (const [id, g] of this.grids.levels) {
      const here: Obstacle[] = [];
      for (const { o, foot } of placed) {
        if (foot === undefined) here.push(o);
        // ground mode: level 0 is the terrain, not a flat floor at g.y; a person standing on it blocks there
        else if (this.ground && id === 0) { if (this.onGroundAt(o, foot)) here.push({ ...o, y0: -1e9, y1: 1e9 }); }
        else if (g.y >= foot - 0.3 && g.y < foot + PERSON_H) here.push({ ...o, y0: g.y, y1: g.y + PERSON_H });
      }
      if (here.length) levels.set(id, gridsWithObstacles({ cell: this.grids.cell, levels: new Map([[id, g]]) }, here).levels.get(id)!);
    }
    hit = { scene: { ...this.scene, obstacles: [...this.scene.obstacles, ...extra] }, grids: { cell: this.grids.cell, levels } };
    for (const k of this.aroundCache.keys()) if (this.aroundCache.size >= AROUND_CACHE || !k.startsWith(`${this.epoch}|`)) this.aroundCache.delete(k);
    this.aroundCache.set(key, hit);
    return hit;
  }

  /** One-off route treating standing people as temporary obstacles (a walker blocked by someone not moving). */
  routeAround(world: WorldState, profile: AgentProfile, start: Place, goal: Place, people: AroundPerson[], explainUnusable?: (linkId: string) => boolean): RouteResult {
    const run = () => {
      // paged ground: a far goal is approached a chunk at a time (the people only matter near the walker)
      let rest: Place | undefined;
      if (this.ground?.paged && start.level === 0 && goal.level === 0 && hypot(goal.p[0] - start.p[0], goal.p[1] - start.p[1]) > PAGED_DIRECT_M) {
        this.sync(world);
        const c = pagedRoute(this.ground, this.scene, profile, start, goal, this.routeReachV1 ? { routeReachV1: true } : {});
        if (!c.ok) return c;
        const end = c.route.rest ? (c.route.legs.at(-1) as { points?: Vec2[] } | undefined)?.points?.at(-1) : undefined;
        if (end) { rest = c.route.rest; goal = { level: 0, p: end }; }
      }
      const { scene, grids } = (this.ground && start.level === 0 && goal.level === 0 && this.groundAround(world, start, goal, people)) || this.gridsAround(world, people);
      // a people-avoidance replan fails often (walled in, a pocket cut off): prove it early (path.ts proveUnreachable);
      // a failure names the people / loads behind it (path.ts nameObstacles: the walker's fewer-obstacles fallback)
      const ids = new Set(people.map((q) => q.id));
      // and a walker standing between people (a gap in a ring) plans from the nearest standable spot up to
      // 1 m away (it steps out of the gap first) instead of failing 'route.start-blocked'
      const opts: RouteOpts = { proveUnreachable: this.proveUnreachable, explainUnusable, nameObstacles: (id) => ids.has(id), startTolerance: AROUND_START_TOL };
      if (this.planner !== 'exact') opts.planner = this.planner;
      const res = findRoute(grids, scene, profile, start, goal, opts);
      return rest && res.ok ? { ok: true as const, route: { ...res.route, rest } } : res;
    };
    return this.prof ? this.prof.time('spatial.routeAround', run) : run();
  }

  /**
   * Ground mode: a people-avoiding level-0 replan searches only the tiles around its start and goal (as the hierarchical
   * planner's hops do), so its route does not depend on how far the engine window has grown (live vs restored engines).
   */
  private groundAround(world: WorldState, start: Place, goal: Place, people: AroundPerson[]): { scene: SpatialScene; grids: GridSet } | null {
    this.sync(world);
    const g = this.ground!, r = rectOf([start.p, goal.p]);
    if (!this.groundInclude(world, r)) return null;
    const base = g.compose(r, this.scene.obstacles), placed = people.flatMap((q) => aroundObstacle(world, q));
    const here: Obstacle[] = [];
    for (const { o, foot } of placed) {
      if (foot === undefined) here.push(o);
      else if (this.onGroundAt(o, foot)) here.push({ ...o, y0: -1e9, y1: 1e9 });
    }
    const level = here.length ? gridsWithObstacles({ cell: this.cell, levels: new Map([[0, base]]) }, here).levels.get(0)! : base;
    return { scene: { ...this.scene, bounds: g.boundsOf(r), links: [], obstacles: [...this.scene.obstacles, ...placed.map((x) => x.o)] }, grids: { cell: this.cell, levels: new Map([[0, level]]) } };
  }

  /** Ground mode: whether a person whose feet are at `foot` stands on level 0 (the ground or a slab) at their obstacle's centre. */
  private onGroundAt(o: Obstacle, foot: number): boolean {
    const h = this.ground!.standY(o.obb.c[0], o.obb.c[1]);
    return foot >= h - 1.3 && foot < h + PERSON_H;
  }

  private narrowCache = new Map<string, Int32Array>();
  /**
   * Connected components of "single-file" cells: standable for radius r but
   * too tight for two agents to pass (clearance < 2r + margin). Each component
   * is a traffic resource that opposing walkers must take turns through.
   */
  narrow(level: number, r: number, margin = 0.15): Int32Array {
    const key = `${this.epoch}:${level}:${r}:${margin}`;
    let lab = this.narrowCache.get(key);
    if (lab) return lab;
    if (this.narrowCache.size > 16) this.narrowCache.clear();
    const g = this.grids.levels.get(level)!;
    // labels depend only on (clearance, nx, nz, r, margin): a construction step that flips no cell of
    // this level keeps its clearance array (grid.ts updateGrids), so its labels carry over unchanged
    const byArr = narrowLabels.get(g.clearance);
    const sub = `${g.nx}:${g.nz}:${r}:${margin}`;
    lab = byArr?.get(sub) ?? narrowComponents(g.clearance, g.nx, g.nz, r, margin);
    if (!byArr) narrowLabels.set(g.clearance, new Map([[sub, lab]]));
    else byArr.set(sub, lab);
    this.narrowCache.set(key, lab);
    return lab;
  }
}

/**
 * Paged ground: the single-file component (as narrow(): 4-connected cells with r ≤ clearance < 2r + margin) holding cell
 * `c` of the faced window's `level` grid, named by its first cell in global lattice order — the same name in every window
 * that holds the whole component, so walkers in different windows queue for the same passage. Flood-filled on demand
 * (memoised per grid) instead of labelling the whole window. Null when `c` is not single-file.
 */
export function narrowIdOf(g: LevelGrid, r: number, c: number, margin = 0.15): string | null {
  const cl = g.clearance, hi = 2 * r + margin, v = cl[c];
  if (!(v >= r && v < hi)) return null;
  let byR = narrowIds.get(cl);
  if (!byR) narrowIds.set(cl, (byR = new Map()));
  const sub = `${r}:${margin}`;
  let m = byR.get(sub);
  if (!m) byR.set(sub, (m = new Map()));
  const hit = m.get(c);
  if (hit !== undefined) return hit;
  const nx = g.nx, n = cl.length, cells = [c], seen = new Set([c]);
  let best = c;
  for (let q = 0; q < cells.length; q++) {
    const k = cells[q], i = k % nx;
    if (k < best) best = k;
    const nb = [i + 1 < nx ? k + 1 : -1, i > 0 ? k - 1 : -1, k + nx < n ? k + nx : -1, k >= nx ? k - nx : -1];
    for (const t of nb) { if (t < 0 || seen.has(t)) continue; const w = cl[t]; if (w >= r && w < hi) { seen.add(t); cells.push(t); } }
  }
  const id = `${g.ox + (best % nx)},${g.oz + Math.floor(best / nx)}`;
  for (const k of cells) m.set(k, id);
  return id;
}
const narrowIds = new WeakMap<Float32Array, Map<string, Map<number, string>>>();

/** narrow() labels per clearance array (never mutated after it is built; PLANNING_BUDGET.md §6). */
const narrowLabels = new WeakMap<Float32Array, Map<string, Int32Array>>();

/**
 * 4-connected components of the cells with r ≤ clearance < 2r + margin, numbered in the order of
 * their first cell in row-major scan (so the numbering does not depend on the flood order).
 */
export function narrowComponents(cl: Float32Array, nx: number, nz: number, r: number, margin: number): Int32Array {
  const n = nx * nz;
  const lab = new Int32Array(n).fill(-1);
  const hi = 2 * r + margin;
  const stack = narrowStack.length >= n ? narrowStack : (narrowStack = new Int32Array(n));
  let next = 0;
  for (let c = 0; c < n; c++) {
    if (lab[c] !== -1) continue;
    const v = cl[c];
    if (!(v >= r && v < hi)) continue;
    lab[c] = next;
    let top = 0;
    stack[top++] = c;
    while (top) {
      const k = stack[--top];
      const i = k % nx;
      let m: number, w: number;
      if (i + 1 < nx && lab[(m = k + 1)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
      if (i > 0 && lab[(m = k - 1)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
      if (k + nx < n && lab[(m = k + nx)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
      if (k >= nx && lab[(m = k - nx)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
    }
    next++;
  }
  return lab;
}
let narrowStack = new Int32Array(0);

/** Stage B (lane B-spatial): a synced service's static products at one navigation epoch (Spatial.staticScene). Plain
 *  data (structured-clone it: obstacle heights may be infinite). */
export type StaticSceneV1 = {
  v: 1; cell: number; planner: 'exact' | 'corridor'; baseId: string; navEpoch: number;
  bounds: SpatialScene['bounds']; baseLevels: SpatialScene['levels'];
  levels: SpatialScene['levels']; surfaces: Surface[]; obstacles: Obstacle[]; links: Link[];
  own: string[]; ground: { paged: boolean } | null;
};
/** The base a static export stands for: every composed list (the export's base levels stay separate, for levelOf reads). */
function staticBase(s: StaticSceneV1): SpatialScene {
  return { bounds: s.bounds, levels: s.levels, surfaces: s.surfaces, obstacles: s.obstacles, links: s.links };
}
/** Stage B (lane B-spatial): the engine's static scene export (MarsEngine.exportStaticScene): the service's static
 *  products plus what the engine adds — its static epoch counter (staticEpochV1), the ground recipe the field is baked from
 *  (opaque here; the replica registers it), the connectivity anchor (the world's arrival point on the ground), whether
 *  the engine is a physical binding (whose dry-ground read needs world state), the defs with seats, and the entity-physics hash the scene
 *  lists were collected under (they can change with it without a navigation epoch). */
export type StaticExportV1 = StaticSceneV1 & {
  epoch: number; recipeHash: string | null; recipe: unknown; arrival: Vec2; physical: boolean; physicsHash: string | null;
  /** Catalogue defs with a seat slot (god defs register into the catalogue at run time, so the worker cannot read it). */
  seatDefs: string[];
};
