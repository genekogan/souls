// Tiled ground navigation (spec <eden4>/31 B1, lane L8): Spatial for big
// worlds. Only worlds whose state carries `groundV1` (entity worlds) use it.
//
//  - Coarse: 1 m media cells over the whole extent (walk / wade / swim / steep /
//    outside), from the ground field's per-tile media rasters. Coarse A* across
//    tiles decides whether a destination is reachable on foot at all, names what
//    is in the way (a cliff, deep water) precisely, and cuts long routes into hops.
//  - Fine: the engine's ordinary 0.1 m walk rasters and exact clearance fields,
//    built lazily per 64 m tile (with a 2 m apron so clearance is exact to 2 m
//    across tile seams) and kept in an LRU. A tile is rebuilt only when the ground
//    recipe or an obstacle reaching it changes.
//  - The engine-facing level-0 grid is a lattice-aligned composite of the tiles of
//    a *window* that always covers every body and every active route; it only grows.
//    Each hop is planned with the existing planner (findRoute) on a composite of
//    just that hop's tiles, so a route never depends on how far the window has grown.
import { datan2, dcos, dsin, hypot, obbCorners, pointInObb, type Vec2 } from '../core/math.ts';
import { BODY_HEIGHT, STEP, buildGrids, buildGridsOverFloors, edt, gridContentKeys, latticeCentre, latticeIndex, latticeOf, obbRange, rasterObb, type GridSet, type LevelGrid } from './grid.ts';
import { findRoute, linkApproach, type Leg, type Place, type RouteOpts, type RouteResult, type WalkLeg } from './path.ts';
import type { AgentProfile, Obstacle, SpatialScene, Surface } from './types.ts';
import { GROUND_TILE_M, G_OUTSIDE, G_STEEP, G_SWIM, G_WADE, G_WALK, MEDIUM_NAMES, coarseMedium, type GroundField } from './ground.ts';

/** Apron (m) around each fine tile: clearance is exact up to this distance across tile seams. */
export const FINE_APRON_M = 2;
/** Fine tiles kept (each 640 × 640 cells, ~2.9 MB). */
export const FINE_LRU = 24;
/** Paged: fine tiles kept at least (Spatial.syncPaged); a Soul's capabilities read ~30 tiles round it in one sweep, which
 *  a smaller LRU misses on every pass (engine P4). */
export const FINE_LRU_PAGED = 24;   // L1: was 48 (E-life: a nearby sweep read ~37 tiles); point reads off the windows no longer
                                    // build tiles (clearTester), so a listing builds ~20; 24 keeps them (2.9 MB each, -69 MB)
/** levelOver: floor keys memoised per scene before the memo starts over. */
const LEVEL_KEYS_MAX = 512;
/** Paged: bytes of upper-floor grids kept over windows (GroundNav.floorsOver); a 2-tile window's floor is ~7 MB. */
export const FLOORS_OVER_BYTES = 64 * 1024 * 1024;   // E-life (memory): was 192 MB; Eden 2026 used 105 MB after one resident
/** L1: point reads off the windows classify cells in blocks of this many cells a side (680-cell apron'd tile rasters = 10 × 10
 *  blocks of 4.6 kB), and keep this many blocks (~7 MB). */
export const FREE_BLOCK = 68;
export const FREE_BLOCKS = 1536;
/** Largest window (tiles per side): 6 × 64 m = 384 m. Routes needing more are refused ('ground.too-far'). */
export const MAX_WINDOW_TILES = 6;
/** Longest hop (m along the coarse path) planned by the fine planner at once. */
export const HOP_M = 48;

export type TileRect = [tx0: number, tz0: number, tx1: number, tz1: number];
type FineTile = { key: string; free: Uint8Array; clearance: Float32Array; blk: Int16Array; ids: string[] };
const CLASSIFY_ROWS = 16;
function drain<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

const tileOf = (v: number) => Math.floor(v / GROUND_TILE_M);
/** Margin (m) a window keeps around what it must cover: a neighbouring tile joins only when a point is this close to it. */
export const WINDOW_MARGIN_M = 12;
/** Tile rect covering points grown by `marginM` metres. */
export function rectOf(points: Vec2[], marginM = WINDOW_MARGIN_M): TileRect {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of points) { const ta = tileOf(x - marginM), tb = tileOf(z - marginM), tc = tileOf(x + marginM), td = tileOf(z + marginM); if (ta < a) a = ta; if (tb < b) b = tb; if (tc > c) c = tc; if (td > d) d = td; }
  return [a, b, c, d];
}
const unionRect = (p: TileRect | null, q: TileRect): TileRect => (p ? [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])] : q);
const rectBounds = (r: TileRect): [number, number, number, number] => [r[0] * GROUND_TILE_M, r[1] * GROUND_TILE_M, (r[2] + 1) * GROUND_TILE_M, (r[3] + 1) * GROUND_TILE_M];

/** Grid-relevant identity of an obstacle (as grid.ts obstacleKey). */
const obstacleKey = (o: Obstacle) => `${o.id}|${o.obb.c[0]},${o.obb.c[1]},${o.obb.half[0]},${o.obb.half[1]},${o.obb.yaw}|${o.y0},${o.y1}${o.raster ? `|${o.raster}` : ''}`;
function fnv(s: string, h = 0x811c9dc5): number { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; }

/**
 * LevelGrid.blockers over a composite: per-cell indices into an id table (diagnostics only). The table is filled from the
 * tiles on first use (most composites are never asked), so composing costs only the copies of `free` and `clearance`.
 */
class ComposedBlockers extends Map<number, string> {
  private _cells: Int32Array | null = null; private ids: string[] = []; private n = 0; private fill: (() => { cells: Int32Array; ids: string[] }) | null;
  constructor(fill: () => { cells: Int32Array; ids: string[] }) { super(); this.fill = fill; }
  private get cells(): Int32Array {
    if (!this._cells) { const f = this.fill!(); this.fill = null; this._cells = f.cells; this.ids = f.ids; for (let i = 0; i < f.cells.length; i++) if (f.cells[i] >= 0) this.n++; }
    return this._cells;
  }
  override get size() { void this.cells; return this.n; }
  override get(i: number) { const k = this.cells[i]; return k >= 0 ? this.ids[k] : undefined; }
  override has(i: number) { return this.cells[i] >= 0; }
  override set(i: number, id: string): this { const cells = this.cells; let k = this.ids.indexOf(id); if (k < 0) { k = this.ids.length; this.ids.push(id); } if (cells[i] < 0) this.n++; cells[i] = k; return this; }
  override delete(i: number) { const cells = this.cells; if (!(cells[i] >= 0)) return false; cells[i] = -1; this.n--; return true; }
  override clear() { this.cells.fill(-1); this.n = 0; }
  override *entries(): MapIterator<[number, string]> { const cells = this.cells; for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) yield [i, this.ids[cells[i]]]; }
  override *keys(): MapIterator<number> { for (const [i] of this.entries()) yield i; }
  override *values(): MapIterator<string> { for (const [, v] of this.entries()) yield v; }
  override [Symbol.iterator]() { return this.entries(); }
  override forEach(fn: (v: string, k: number, m: Map<number, string>) => void, thisArg?: unknown) { for (const [k, v] of this.entries()) fn.call(thisArg, v, k, this); }
}

/**
 * Decks (lane A-souls, R2): a level-0 floor slab that lies more than FLOOR_RISE above the ground under it somewhere — a
 * bridge over a river, a pier over a lake, a raised platform — is ground in its own right: where it covers a cell (and
 * lies on or above the ground there), the walker's height is the deck's, the medium is walk (never water or steep), and
 * obstacles (rails) are measured from the deck. The overlay is a GroundField over the recipe's field, so the coarse
 * media, the fine rasters, swimming and settling all see the same thing. No decks: the recipe's field itself.
 * 80/20: the ground under a deck is not walkable separately (one height per cell), and a deck's open sides are entered
 * as from any neighbouring cell — the generators put rails on the open sides of bridges and piers.
 */
export function deckedField(base: GroundField, decks: Surface[], key: string): GroundField {
  // numeric 8 m cell keys (L1: deckY runs for every fine cell of a nav tile; string keys were a third of its cost)
  const bk = (i: number, j: number) => (i + 1048576) * 2097152 + (j + 1048576);
  // The exact pointInObb/rot2 arithmetic, with the deterministic trig shared by every point.
  // Keep the surface live as before; a caller mutating yaw must not leave a stale basis.
  type Deck = { surface: Surface; yaw: number; c: number; s: number };
  const buckets = new Map<number, Deck[]>(), cellsOf: [number, number][] = [];
  for (const s of decks) {
    const deck: Deck = { surface: s, yaw: s.obb.yaw, c: dcos(-s.obb.yaw), s: dsin(-s.obb.yaw) };
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const [x, z] of obbCorners(s.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
    for (let j = Math.floor(az / 8); j <= Math.floor(bz / 8); j++) for (let i = Math.floor(ax / 8); i <= Math.floor(bx / 8); i++) {
      const k = bk(i, j), l = buckets.get(k); if (l) l.push(deck); else { buckets.set(k, [deck]); cellsOf.push([i, j]); }
    }
  }
  const deckY = (x: number, z: number): number | null => {
    const l = buckets.get(bk(Math.floor(x / 8), Math.floor(z / 8))); if (!l) return null;
    let y = -Infinity, g = NaN;
    for (const d of l) {
      const s = d.surface; if (!(s.y > y)) continue;
      const o = s.obb;
      if (!Object.is(d.yaw, o.yaw)) { d.yaw = o.yaw; d.c = dcos(-o.yaw); d.s = dsin(-o.yaw); }
      const dx = x - o.c[0], dz = z - o.c[1];
      if (Math.abs(dx * d.c - dz * d.s) <= o.half[0] + 0 && Math.abs(dx * d.s + dz * d.c) <= o.half[1] + 0) {
        if (g !== g) g = base.height(x, z); if (s.y >= g - 0.05) y = s.y;
      }
    }
    return y === -Infinity ? null : y;
  };
  const tiles = new Map<string, Uint8Array>();
  return {
    id: `${base.id}|decks:${key}`, extent: base.extent, wadeMax: base.wadeMax, maxSlope: base.maxSlope,
    height: (x, z) => deckY(x, z) ?? base.height(x, z),
    waterLevel: (x, z) => (deckY(x, z) === null ? base.waterLevel(x, z) : null),
    medium: (x, z) => (deckY(x, z) === null ? base.medium(x, z) : G_WALK),
    mediaTile: (tx, tz) => {
      const k = `${tx},${tz}`; let m = tiles.get(k); if (m) return m;
      m = base.mediaTile(tx, tz);
      const x0 = tx * GROUND_TILE_M, z0 = tz * GROUND_TILE_M;
      if (buckets.size && cellsOf.some(([i, j]) => i * 8 < x0 + GROUND_TILE_M && i * 8 + 8 > x0 && j * 8 < z0 + GROUND_TILE_M && j * 8 + 8 > z0)) {
        m = m.slice();
        for (let j = 0; j < GROUND_TILE_M; j++) for (let i = 0; i < GROUND_TILE_M; i++) if (deckY(x0 + i + 0.5, z0 + j + 0.5) !== null) m[j * GROUND_TILE_M + i] = G_WALK;
      }
      tiles.set(k, m);
      return m;
    },
  };
}

let navSerials = 0;

export class GroundNav {
  /** The recipe's field; `field` is it, or it overlaid with decks (setFloors). */
  readonly base: GroundField;
  field: GroundField;
  readonly cell: number;
  /** Fine cells per tile edge (640 at 0.1 m). */
  readonly per: number;
  readonly apron: number;
  /** Tiles the engine-facing grids cover (inclusive); grows only. */
  window: TileRect | null = null;
  /** Counters for tests and the status page. */
  stats = { fineBuilds: 0, fineHits: 0, composites: 0, coarseExpanded: 0, levelBuilds: 0, floorBuilds: 0, floorHits: 0 };
  private fine = new Map<string, FineTile>();
  private composed = new Map<string, LevelGrid>();
  /**
   * Paged: upper-floor grids, keyed by what they are built from (floorKey: the level, the crop of its floors the rect
   * holds, and the surfaces and in-band obstacles reaching that crop), least recently used first out past
   * FLOORS_OVER_BYTES. A Soul's capabilities read the same far rooms' floors many times (engine P4); grids are never
   * mutated, so shared. S2 (tranche 2026-10-19): kept until their inputs change, not dropped by every static change, and
   * shared by every window that holds the whole floor: windows move with the bodies, and each new window rect rebuilt
   * every house floor in it (~12% of a busy Eden 2026).
   */
  private floorsOver = new Map<string, { g: LevelGrid | undefined; bytes: number }>();
  private floorsOverBytes = 0;
  /** levelOver: floor keys per scene and `rect|level` (null = no floor of that level reaches the rect). */
  private levelKeys = new WeakMap<SpatialScene, Map<string, string | null>>();
  /** This nav and a serial per floor it built, naming memoised floors (gridContentKeys): a kept floor keeps its name. */
  private readonly serial = ++navSerials;
  private floorsGen = 0;
  /** Each tile's relevant obstacles and key per (never mutated) obstacle list, as compose reads them per window. */
  private tileKeys = new WeakMap<Obstacle[], Map<string, { rel: Obstacle[]; key: string }>>();
  /**
   * Paged navigation (lane NAV, worlds whose ground fact says `nav: 'paged/1'`): no single grow-only window. The engine
   * faces a set of small windows (Spatial clusters, one per group of nearby bodies and their current walk chunks), routes
   * are planned a chunk (one coarse hop) at a time, and the tile caches are sized to what the windows hold. Off: as before.
   */
  readonly paged: boolean;
  /** Fine tiles kept (paged: at least the windows' tiles); composites kept. */
  fineMax = FINE_LRU;
  composedMax = 4;

  constructor(field: GroundField, cell = 0.1, opts: { paged?: boolean } = {}) {
    this.base = this.field = field; this.cell = cell; this.paged = !!opts.paged;
    this.per = Math.round(GROUND_TILE_M / cell);
    if (Math.abs(this.per * cell - GROUND_TILE_M) > 1e-9) throw new Error('ground: the cell must divide the 64 m tile');
    this.apron = Math.round(FINE_APRON_M / cell);
  }

  /** Level-0 floors laid over the ground (a house's ground-floor slab, a deck at grade), bucketed by 8 m cell. */
  private floors = new Map<string, Surface[]>();
  /** Floor slabs at most this far above the ground there raise the standing height to the slab (m). */
  static FLOOR_RISE = 0.5;
  private deckKey = '';
  setFloors(surfaces: Surface[]) {
    // decks first (they change the field the floors below are measured on)
    const b = this.base, decks = surfaces.filter((s) => [s.obb.c as Vec2, ...obbCorners(s.obb)].some(([x, z]) => s.y > b.height(x, z) + GroundNav.FLOOR_RISE));
    const key = decks.length ? fnv(decks.map((s) => `${s.id}:${s.y}:${s.obb.c}:${s.obb.half}:${s.obb.yaw}`).join('|')).toString(16) : '';
    if (key !== this.deckKey) { this.deckKey = key; this.field = key ? deckedField(b, decks, key) : b; this.composed.clear(); }
    this.floors.clear();
    for (const s of surfaces) {
      let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
      for (const [x, z] of obbCorners(s.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
      for (let j = Math.floor(az / 8); j <= Math.floor(bz / 8); j++) for (let i = Math.floor(ax / 8); i <= Math.floor(bx / 8); i++) {
        const k = `${i},${j}`, l = this.floors.get(k); if (l) l.push(s); else this.floors.set(k, [s]);
      }
    }
  }
  /** Large solids (both half-extents ≥ 1.25 m, in the body band above the ground) as coarse 1 m blockers, bucketed by 8 m cell. */
  private solids = new Map<string, Obstacle[]>();
  static SOLID_MIN_HALF = 1.25;
  setSolids(obstacles: Obstacle[]) {
    this.solids.clear();
    for (const o of obstacles) {
      if (Math.min(o.obb.half[0], o.obb.half[1]) < GroundNav.SOLID_MIN_HALF) continue;
      const h = this.field.height(o.obb.c[0], o.obb.c[1]);
      if (o.y1 <= h + STEP || o.y0 >= h + BODY_HEIGHT) continue;
      let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
      for (const [x, z] of obbCorners(o.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
      for (let j = Math.floor(az / 8); j <= Math.floor(bz / 8); j++) for (let i = Math.floor(ax / 8); i <= Math.floor(bx / 8); i++) {
        const k = `${i},${j}`, l = this.solids.get(k); if (l) l.push(o); else this.solids.set(k, [o]);
      }
    }
  }
  /** Whether the 1 m cell centred at (x, z) lies well inside a large solid (0.75 m in from its edge). */
  coarseSolid(x: number, z: number): boolean {
    if (!this.solids.size) return false;
    const l = this.solids.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`);
    if (l) for (const o of l) if (pointInObb([x, z], { c: o.obb.c, half: [o.obb.half[0] - 0.75, o.obb.half[1] - 0.75], yaw: o.obb.yaw })) return true;
    return false;
  }

  /** Where a body's feet are on level 0 at (x, z): the ground, or a floor slab laid on it (within FLOOR_RISE above). */
  standY(x: number, z: number): number {
    let h = this.field.height(x, z);
    if (!this.floors.size) return h;
    const l = this.floors.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`);
    if (l) { const g = h; for (const s of l) if (s.y > h && s.y >= g - 0.05 && s.y <= g + GroundNav.FLOOR_RISE && pointInObb([x, z], s.obb)) h = s.y; }
    return h;
  }

  /** Grow the window to cover `r`: 'same' | 'grown' | 'too-big' (then nothing changes). */
  include(r: TileRect): 'same' | 'grown' | 'too-big' {
    const ext = this.extentTiles(), q: TileRect = [Math.max(r[0], ext[0]), Math.max(r[1], ext[1]), Math.min(r[2], ext[2]), Math.min(r[3], ext[3])];
    if (q[0] > q[2] || q[1] > q[3]) return 'same';
    const next = unionRect(this.window, q);
    if (this.window && next.every((v, k) => v === this.window![k])) return 'same';
    if (next[2] - next[0] + 1 > MAX_WINDOW_TILES || next[3] - next[1] + 1 > MAX_WINDOW_TILES) return 'too-big';
    this.window = next;
    return 'grown';
  }
  extentTiles(): TileRect { const e = this.field.extent; return [tileOf(e[0]), tileOf(e[1]), tileOf(e[2] - 1e-6), tileOf(e[3] - 1e-6)]; }
  bounds(): [number, number, number, number] { return rectBounds(this.window ?? [0, 0, 0, 0]); }
  boundsOf(r: TileRect): [number, number, number, number] { return rectBounds(r); }

  // ---------------------------------------------------------------- fine tiles

  private relevant(obstacles: Obstacle[], tx: number, tz: number, boxes: Float64Array): Obstacle[] {
    const pad = FINE_APRON_M + this.cell, x0 = tx * GROUND_TILE_M - pad, z0 = tz * GROUND_TILE_M - pad, x1 = x0 + GROUND_TILE_M + 2 * pad, z1 = z0 + GROUND_TILE_M + 2 * pad;
    const out: Obstacle[] = [];
    for (let k = 0; k < obstacles.length; k++) if (boxes[4 * k + 2] >= x0 && boxes[4 * k] <= x1 && boxes[4 * k + 3] >= z0 && boxes[4 * k + 1] <= z1) out.push(obstacles[k]);
    return out;
  }
  private keyOf(tx: number, tz: number, rel: Obstacle[]): string {
    let h = fnv(`${this.field.id}|${tx},${tz}|${rel.length}`), h2 = 0x050c5d1f;
    for (const o of rel) { const k = obstacleKey(o); h = fnv(k, h); h2 = fnv(k, h2 ^ 0x9e3779b9); }
    return `${tx},${tz}:${h.toString(16)}${h2.toString(16)}`;
  }

  /**
   * The walk raster (1 = free) of the cells [i0, i0 + ni) × [j0, j0 + nj) of a tile's apron'd raster (origin ox, oz; M × M
   * cells): ground media, then obstacles in the body band above the ground there. fineTile classifies its whole raster
   * with it; a point test (clearTester) only the cells round a point, with the same coarse window and clipping, so the
   * cells are identical. `blk` / `ids` (whole raster only) name what blocks each cell.
   */
  private classify(ox: number, oz: number, M: number, rel: Obstacle[], i0: number, j0: number, ni: number, nj: number, blk?: Int16Array, ids?: string[]): Uint8Array {
    return drain(this.classifySteps(ox, oz, M, rel, i0, j0, ni, nj, blk, ids));
  }
  /** Rows retain the original visitation order and one obstacle id table across all slices. */
  private *classifySteps(ox: number, oz: number, M: number, rel: Obstacle[], i0: number, j0: number, ni: number, nj: number, blk?: Int16Array, ids?: string[]): Generator<void, Uint8Array> {
    const { cell, field } = this;
    const free = new Uint8Array(ni * nj);
    // coarse media around the apron'd tile (1 m cells), and which cells touch water — evaluated as first needed
    const c0x = Math.floor(latticeCentre(ox, cell)) - 1, c0z = Math.floor(latticeCentre(oz, cell)) - 1;
    const cw = Math.floor(latticeCentre(ox + M - 1, cell)) + 2 - c0x;
    const coarse = new Uint8Array(cw * cw).fill(255), wet = new Uint8Array(cw * cw).fill(255);
    const cm = (k: number) => { let c = coarse[k]; if (c === 255) c = coarse[k] = coarseMedium(field, c0x + (k % cw) + 0.5, c0z + Math.floor(k / cw) + 0.5); return c; };
    const wetAt = (k: number) => {
      let w = wet[k]; if (w !== 255) return w;
      const i = k % cw, j = Math.floor(k / cw); w = 0;
      for (let dj = -1; dj <= 1 && !w; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= cw || b >= cw) continue;
        const c = cm(b * cw + a); if (c === G_WADE || c === G_SWIM) { w = 1; break; }
      }
      return (wet[k] = w);
    };
    for (let j = 0; j < nj; j++) {
      const z = latticeCentre(oz + j0 + j, cell), cj = Math.floor(z) - c0z;
      for (let i = 0; i < ni; i++) {
        const x = latticeCentre(ox + i0 + i, cell), ci = Math.floor(x) - c0x, k = j * ni + i, ck = cj * cw + ci, c = cm(ck);
        if (c === G_OUTSIDE) { if (blk) blk[k] = 0; continue; }
        if (c === G_STEEP) { if (blk) blk[k] = 1; continue; }
        if (wetAt(ck)) {
          const lvl = field.waterLevel(x, z);
          if (lvl !== null && lvl - field.height(x, z) > field.wadeMax + 1e-4) { if (blk) blk[k] = 2; continue; }
        }
        free[k] = 1;
      }
      if ((j + 1) % CLASSIFY_ROWS === 0 || j + 1 === nj) yield;
    }
    // obstacles in the body band above the ground at each cell (first listed names the cell, as stampLevel)
    const whole = i0 === 0 && j0 === 0 && ni === M && nj === M, boxes = whole ? null : boxesOf(rel);
    const bx0 = latticeCentre(ox + i0, cell) - cell, bz0 = latticeCentre(oz + j0, cell) - cell, bx1 = latticeCentre(ox + i0 + ni - 1, cell) + cell, bz1 = latticeCentre(oz + j0 + nj - 1, cell) + cell;
    for (let n = 0; n < rel.length; n++) {
      if (boxes && (boxes[4 * n + 2] < bx0 || boxes[4 * n] > bx1 || boxes[4 * n + 3] < bz0 || boxes[4 * n + 1] > bz1)) continue;
      const o = rel[n];
      let idx = -1;
      const visit = (g: number) => {
        const k = (Math.floor(g / M) - j0) * ni + (g % M) - i0;
        if (!free[k]) return;
        const x = latticeCentre(ox + (g % M), cell), z = latticeCentre(oz + Math.floor(g / M), cell), h = field.height(x, z);
        if (o.y1 <= h + STEP || o.y0 >= h + BODY_HEIGHT) return;
        if (blk && ids) { if (idx < 0) { idx = ids.length; ids.push(o.id); if (idx > 32000) throw new Error('ground: too many obstacles in one tile'); } blk[k] = idx; }
        free[k] = 0;
      };
      const [a, b, lo, hi] = obbRange(o.obb, ox, oz, cell, M, M);
      const x0 = Math.max(a, i0), x1 = Math.min(b, i0 + ni - 1), z1 = Math.min(hi, j0 + nj - 1);
      if (x0 > x1) continue;
      for (let z = Math.max(lo, j0); z <= z1; z += CLASSIFY_ROWS) {
        rasterObb(o.obb, ox, oz, cell, M, M, visit, o.raster !== 'centre', [x0, x1, z, Math.min(z1, z + CLASSIFY_ROWS - 1)]);
        yield;
      }
    }
    return free;
  }

  /** One tile's fine level-0 raster: ground media, then obstacles in the body band above the ground there, then the exact EDT. */
  fineTile(tx: number, tz: number, rel: Obstacle[], key = this.keyOf(tx, tz, rel), keep = true): FineTile {
    return drain(this.fineTileSteps(tx, tz, rel, key, keep));
  }
  /** A resumable cold tile. No partial raster enters the cache; synchronous callers drain the same builder.
   * The caller must abandon an unfinished iterator if its field or obstacle inputs change (NavConnectivity checks epochs).
   * EDT, crop and a cold GroundField.mediaTile remain atomic, so this is not a hard wall-time bound. */
  *fineTileSteps(tx: number, tz: number, rel: Obstacle[], key = this.keyOf(tx, tz, rel), keep = true): Generator<void, FineTile> {
    const hit = this.fine.get(key);
    // keep = false reads a hit without refreshing it: the audit's sweep must not age the tiles the engine's windows use
    if (hit) { if (keep) { this.fine.delete(key); this.fine.set(key, hit); } this.stats.fineHits++; return hit; }
    this.stats.fineBuilds++;
    const { per, apron: A, cell } = this;
    const M = per + 2 * A, ox = tx * per - A, oz = tz * per - A;
    const blk = new Int16Array(M * M).fill(-1), ids: string[] = ['ground:outside', 'ground:steep', 'ground:water'];
    const free = yield* this.classifySteps(ox, oz, M, rel, 0, 0, M, M, blk, ids);
    const clear = edt(free, M, M, cell);
    yield;
    // crop to the tile
    const t: FineTile = { key, free: new Uint8Array(per * per), clearance: new Float32Array(per * per), blk: new Int16Array(per * per), ids };
    for (let j = 0; j < per; j++) {
      const src = (j + A) * M + A;
      t.free.set(free.subarray(src, src + per), j * per);
      t.clearance.set(clear.subarray(src, src + per), j * per);
      t.blk.set(blk.subarray(src, src + per), j * per);
    }
    // keep = false (the connectivity audit labelling every tile once): a miss is built and handed back without evicting the
    // tiles the engine's windows are using
    if (!keep) return t;
    this.fine.set(key, t);
    while (this.fine.size > this.fineMax) this.fine.delete(this.fine.keys().next().value!);
    return t;
  }

  /** A tile's relevant obstacles and content key for an (never mutated) obstacle list, memoised per list (also read by
   *  the connectivity audit, connectivity.ts, to relabel only the tiles whose content changed). */
  tileEntry(tx: number, tz: number, obstacles: Obstacle[]): { rel: Obstacle[]; key: string } {
    let known = this.tileKeys.get(obstacles);
    if (!known) this.tileKeys.set(obstacles, (known = new Map()));
    const k = `${this.field.id}|${obstacles.length}|${tx},${tz}`;
    let t = known.get(k);
    if (!t) { const rel = this.relevant(obstacles, tx, tz, boxesOf(obstacles)); known.set(k, (t = { rel, key: this.keyOf(tx, tz, rel) })); }
    return t;
  }

  /**
   * L1 (memory): level-0 clearance at points, as `clearanceAt(compose(r, obstacles), q)` reads them — the same cells (a
   * composite is its tiles' cells side by side), 0 outside `r` — but read from the fine tiles themselves: no composite is
   * copied. A Soul's capability listing reads single points round hundreds of far places; each used to compose (copy) the
   * 1–4 tiles round the point (Eden 2026: ~730 composites, gigabytes copied per listing).
   */
  clearanceReader(r: TileRect, obstacles: Obstacle[]): (q: Vec2) => number {
    const { per, cell } = this;
    let last: FineTile | null = null, ltx = NaN, ltz = NaN;
    return (q) => {
      const I = latticeIndex(q[0], cell), J = latticeIndex(q[1], cell), tx = Math.floor(I / per), tz = Math.floor(J / per);
      if (tx < r[0] || tx > r[2] || tz < r[1] || tz > r[3]) return 0;
      if (tx !== ltx || tz !== ltz) { const t = this.tileEntry(tx, tz, obstacles); last = this.fineTile(tx, tz, t.rel, t.key); ltx = tx; ltz = tz; }
      return last!.clearance[(J - tz * per) * per + (I - tx * per)];
    };
  }

  /**
   * L1 (speed/memory): level-0 clearance at points capped at `cap` — exactly `Math.min(clearanceAt(compose(r, obstacles), q),
   * cap)` (0 outside `r`) — without building fine tiles: a cached tile is read; otherwise only the cells within reach of q
   * are looked at. Dry walkable ground with no obstacle near q is clear past the reach; else those cells are classified
   * (classify, as q's tile would) and the nearest blocked centre gives the very value edt stores (squared distances are
   * exact integers; edtRows' formula, rounded to float32). Tile edges and the raster's border pads lie farther than the
   * reach (the apron), so they never decide. A Soul's capability listing tests standing room at hundreds of far points (whole
   * areas for stroll stops); it used to build ~150 fine tiles (~45 ms each) for that.
   */
  clearanceCapped(r: TileRect, obstacles: Obstacle[], cap: number): (q: Vec2) => number {
    const { per, apron: A, cell, field } = this, R = Math.floor(cap / cell + 0.5) + 1;
    if (!(cap > 0) || R + 1 > A) { const read = this.clearanceReader(r, obstacles); return (q) => Math.min(read(q), cap); }
    const M = per + 2 * A;
    return (q) => {
      const I = latticeIndex(q[0], cell), J = latticeIndex(q[1], cell), tx = Math.floor(I / per), tz = Math.floor(J / per);
      if (tx < r[0] || tx > r[2] || tz < r[1] || tz > r[3]) return 0;
      const te = this.tileEntry(tx, tz, obstacles), hit = this.fine.get(te.key);
      if (hit) return Math.min(hit.clearance[(J - tz * per) * per + (I - tx * per)], cap);
      // dry, gentle ground and no obstacle near: every cell within the reach is free (no medium or obstacle blocks one)
      const x0 = latticeCentre(I - R, cell), z0 = latticeCentre(J - R, cell), x1 = latticeCentre(I + R, cell), z1 = latticeCentre(J + R, cell);
      let dry = true;
      for (let cz = Math.floor(z0) - 1; cz <= Math.floor(z1) + 1 && dry; cz++) for (let cx = Math.floor(x0) - 1; cx <= Math.floor(x1) + 1; cx++) if (coarseMedium(field, cx + 0.5, cz + 0.5) !== G_WALK) { dry = false; break; }
      if (dry) {
        const boxes = boxesOf(te.rel), bx0 = x0 - cell, bz0 = z0 - cell, bx1 = x1 + cell, bz1 = z1 + cell;
        let near = false;
        for (let k = 0; k < te.rel.length; k++) if (!(boxes[4 * k + 2] < bx0 || boxes[4 * k] > bx1 || boxes[4 * k + 3] < bz0 || boxes[4 * k + 1] > bz1)) { near = true; break; }
        if (!near) return cap;
      }
      // the cells round q, classified in blocks of q's tile raster (kept: neighbouring reads share them)
      const ox = tx * per - A, oz = tz * per - A, ci = I - ox, cj = J - oz;
      const freeAt = (i: number, j: number) => { const b = this.freeBlock(te.key, ox, oz, M, te.rel, Math.floor(i / FREE_BLOCK), Math.floor(j / FREE_BLOCK)); return b[(j % FREE_BLOCK) * FREE_BLOCK + (i % FREE_BLOCK)]; };
      if (!freeAt(ci, cj)) return 0;
      let best = Infinity;
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (!freeAt(ci + i, cj + j)) { const d2 = i * i + j * j; if (d2 < best) best = d2; }
      if (best > R * R) return cap;
      return Math.min(Math.fround(Math.max(0, Math.sqrt(best) * cell - cell / 2)), cap);
    };
  }
  /** Free-cell blocks of tiles' apron'd rasters (FREE_BLOCK² cells each, as classify gives them), least recently used out. */
  private freeBlocks = new Map<string, Uint8Array>();
  private freeBlock(key: string, ox: number, oz: number, M: number, rel: Obstacle[], bi: number, bj: number): Uint8Array {
    const k = `${key}|${bi},${bj}`, hit = this.freeBlocks.get(k);
    if (hit) return hit;
    const b = this.classify(ox, oz, M, rel, bi * FREE_BLOCK, bj * FREE_BLOCK, FREE_BLOCK, FREE_BLOCK);
    this.freeBlocks.set(k, b);
    if (this.freeBlocks.size > FREE_BLOCKS) for (const old of this.freeBlocks.keys()) { this.freeBlocks.delete(old); if (this.freeBlocks.size <= FREE_BLOCKS * 0.75) break; }
    return b;
  }
  /** `clearanceAt(compose(r, obstacles), q) >= t` (clearanceCapped at t). */
  clearTester(r: TileRect, obstacles: Obstacle[], t: number): (q: Vec2) => boolean {
    const read = this.clearanceCapped(r, obstacles, t);
    return (q) => read(q) >= t;
  }

  /** Level-0 grid over a tile rect: the fine tiles side by side on the global lattice (the last few are memoised). */
  compose(r: TileRect, obstacles: Obstacle[]): LevelGrid {
    const tiles: { tx: number; tz: number; rel: Obstacle[]; key: string }[] = [];
    for (let tz = r[1]; tz <= r[3]; tz++) for (let tx = r[0]; tx <= r[2]; tx++) { const t = this.tileEntry(tx, tz, obstacles); tiles.push({ tx, tz, rel: t.rel, key: t.key }); }
    const ckey = r.join(',') + '|' + tiles.map((t) => t.key).join(';');
    const memo = this.composed.get(ckey);
    if (memo) { this.composed.delete(ckey); this.composed.set(ckey, memo); return memo; }
    const { per, cell } = this, ntx = r[2] - r[0] + 1, ntz = r[3] - r[1] + 1, nx = ntx * per, nz = ntz * per;
    const free = new Uint8Array(nx * nz), clearance = new Float32Array(nx * nz), parts: { ft: { blk: Int16Array; ids: string[] }; gx: number; gz: number }[] = [];
    for (const t of tiles) {
      const ft = this.fineTile(t.tx, t.tz, t.rel, t.key), gx = (t.tx - r[0]) * per, gz = (t.tz - r[1]) * per;
      parts.push({ ft: { blk: ft.blk, ids: ft.ids }, gx, gz });
      for (let j = 0; j < per; j++) {
        const dst = (gz + j) * nx + gx, src = j * per;
        free.set(ft.free.subarray(src, src + per), dst);
        clearance.set(ft.clearance.subarray(src, src + per), dst);
      }
    }
    // blocker ids per cell, in the same order as before (tiles row-major, each tile's own table), built when first read
    const fillBlockers = () => {
      const cells = new Int32Array(nx * nz).fill(-1), ids: string[] = [], idOf = new Map<string, number>();
      for (const { ft, gx, gz } of parts) {
        const map = ft.ids.map((id) => { let k = idOf.get(id); if (k === undefined) { k = ids.length; ids.push(id); idOf.set(id, k); } return k; });
        for (let j = 0; j < per; j++) { const dst = (gz + j) * nx + gx, src = j * per; for (let i = 0; i < per; i++) { const b = ft.blk[src + i]; if (b >= 0) cells[dst + i] = map[b]; } }
      }
      return { cells, ids };
    };
    const ox = r[0] * per, oz = r[1] * per;
    const lat = latticeOf(rectBounds(r), cell);
    if (lat.ox !== ox || lat.oz !== oz || lat.nx !== nx || lat.nz !== nz) throw new Error('ground: tile lattice mismatch');
    const grid: LevelGrid = { level: 0, y: 0, cell, nx, nz, ox, oz, x0: ox * cell, z0: oz * cell, free, clearance, blockers: new ComposedBlockers(fillBlockers) };
    this.stats.composites++;
    gridContentKeys.set(grid, `compose|${cell}|${ckey}`);
    this.composed.set(ckey, grid);
    while (this.composed.size > this.composedMax) this.composed.delete(this.composed.keys().next().value!);
    return grid;
  }

  /** All levels over the window: level 0 composed from tiles; upper levels (decks, floors) as ordinary flat grids. */
  grids(scene: SpatialScene): GridSet {
    const levels = new Map<number, LevelGrid>();
    levels.set(0, this.compose(this.window!, scene.obstacles));
    const upper = scene.levels.filter((l) => l.id !== 0);
    if (upper.length) for (const [id, g] of buildGrids({ ...scene, levels: upper }, this.cell).levels) levels.set(id, g);
    return { cell: this.cell, levels };
  }

  /**
   * Paged: all levels over a tile rect, on the global lattice — level 0 composed from tiles over the rect, each upper
   * level (a deck, a floor) that has a surface reaching the rect built over its own floors there (L1: a grid the size of
   * those floors, not of the rect; cells beyond it read as no floor, as before).
   */
  gridsOver(r: TileRect, scene: SpatialScene): GridSet {
    const levels = new Map<number, LevelGrid>(), b = rectBounds(r);
    levels.set(0, this.compose(r, scene.obstacles));
    const upper = scene.levels.filter((l) => l.id !== 0 && scene.surfaces.some((s) => s.level === l.id && touches(s.obb, b)));
    for (const l of upper) if (!levels.has(l.id)) levels.set(l.id, this.floorOver(r, scene, l.id)!);
    return { cell: this.cell, levels };
  }

  /** `gridsOver(r, scene).levels.get(id)` without building the window's other floors (a far point's own level):
   *  level 0 composed from tiles; an upper level only when a surface of it reaches the rect, memoised (floorOver). */
  levelOver(r: TileRect, id: number, scene: SpatialScene): LevelGrid | undefined {
    if (id === 0) return this.compose(r, scene.obstacles);
    // B-facade: the floor's key per (scene, rect, level), memoised: a tile-reading replica's ring search asks the same few
    // tiles again and again, and the key scans every surface and obstacle (a scene's lists are never mutated)
    let m = this.levelKeys.get(scene);
    if (!m || m.size > LEVEL_KEYS_MAX) this.levelKeys.set(scene, (m = new Map()));
    const rk = `${r.join(',')}|${id}`;
    let key = m.get(rk);
    if (key === undefined) {
      const b = rectBounds(r);
      key = scene.surfaces.some((s) => s.level === id && touches(s.obb, b)) ? floorKey(scene, scene.levels.filter((l) => l.id === id), id, b, this.cell) : null;
      m.set(rk, key);
    }
    if (key === null) return undefined;
    this.stats.levelBuilds++;
    return this.floorOver(r, scene, id, key);
  }

  /** Paged: one upper level over a tile rect, as buildGrids builds it among the window's floors (each level is rasterised
   *  on its own; buildGridsOverFloors only crops to its floors, bit-identical), memoised (floorsOver). */
  private floorOver(r: TileRect, scene: SpatialScene, id: number, known?: string): LevelGrid | undefined {
    const same = scene.levels.filter((l) => l.id === id), bounds = rectBounds(r), key = known ?? floorKey(scene, same, id, bounds, this.cell), hit = this.floorsOver.get(key);
    if (hit) { this.floorsOver.delete(key); this.floorsOver.set(key, hit); this.stats.floorHits++; return hit.g; }
    this.stats.floorBuilds++;
    const g = buildGridsOverFloors({ ...scene, bounds, levels: same }, this.cell).levels.get(id);
    if (g) gridContentKeys.set(g, `floor|${this.serial}.${++this.floorsGen}|${r.join(',')}|${id}`);
    const bytes = g ? g.free.byteLength + g.clearance.byteLength + g.nx * g.nz * 4 : 0;
    this.floorsOver.set(key, { g, bytes }); this.floorsOverBytes += bytes;
    while (this.floorsOverBytes > FLOORS_OVER_BYTES && this.floorsOver.size > 1) {
      const k = this.floorsOver.keys().next().value!;
      this.floorsOverBytes -= this.floorsOver.get(k)!.bytes; this.floorsOver.delete(k);
    }
    return g;
  }

  // ---------------------------------------------------------------- coarse routing

  /**
   * A* over 1 m cells (8-connected, no corner cutting) inside `box` (cells), with a cost per medium
   * (Infinity = impassable). Returns cell-centre waypoints from start to goal, or null.
   */
  coarsePath(from: Vec2, to: Vec2, cost: readonly number[], marginM = 48, maxExpand = 600_000, blocked?: (x: number, z: number) => boolean): Vec2[] | null {
    const e = this.field.extent;
    const bx0 = Math.max(Math.floor(e[0]), Math.floor(Math.min(from[0], to[0]) - marginM)), bz0 = Math.max(Math.floor(e[1]), Math.floor(Math.min(from[1], to[1]) - marginM));
    const bx1 = Math.min(Math.ceil(e[2]) - 1, Math.floor(Math.max(from[0], to[0]) + marginM)), bz1 = Math.min(Math.ceil(e[3]) - 1, Math.floor(Math.max(from[1], to[1]) + marginM));
    const W = bx1 - bx0 + 1, H = bz1 - bz0 + 1;
    if (W <= 0 || H <= 0) return null;
    const idx = (x: number, z: number) => (Math.floor(z) - bz0) * W + (Math.floor(x) - bx0);
    const s = idx(from[0], from[1]), g = idx(to[0], to[1]);
    if (s < 0 || g < 0 || s >= W * H || g >= W * H) return null;
    const med = new Uint8Array(W * H).fill(255);
    const m = (k: number) => { let v = med[k]; if (v === 255) { const x = bx0 + (k % W) + 0.5, z = bz0 + Math.floor(k / W) + 0.5; v = med[k] = (blocked ? blocked(x, z) : this.coarseSolid(x, z)) ? G_SOLID : coarseMedium(this.field, x, z); } return v; };
    const gs = new Float64Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), shut = new Uint8Array(W * H);
    const gxC = g % W, gzC = Math.floor(g / W);
    const h = (k: number) => { const dx = Math.abs((k % W) - gxC), dz = Math.abs(Math.floor(k / W) - gzC); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
    const heap = new MinHeap();
    gs[s] = 0; heap.push(s, h(s));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (shut[cur]) continue; shut[cur] = 1;
      if (cur === g) break;
      if (++expanded > maxExpand) break;
      const ci = cur % W, cj = Math.floor(cur / W);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        // the goal's own 1 m cell is always enterable: the fine check already admitted the exact point (a cell's centre may
        // read steep or deep where the goal itself, at its edge, is fine)
        const n = nj * W + ni, c = n === g && (!blocked || m(n) !== G_SOLID) ? Math.min(cost[m(n)], 2) : cost[m(n)];
        if (!(c < Infinity)) continue;
        if (di && dj && (!(cost[m(cj * W + ni)] < Infinity) || !(cost[m(nj * W + ci)] < Infinity))) continue;
        const t = gs[cur] + (di && dj ? Math.SQRT2 : 1) * c;
        if (t < gs[n]) { gs[n] = t; came[n] = cur; heap.push(n, t + h(n)); }
      }
    }
    this.stats.coarseExpanded += expanded;
    if (!shut[g]) return null;
    const cellsOut: number[] = [];
    for (let k = g; k >= 0; k = came[k]) cellsOut.push(k);
    cellsOut.reverse();
    return cellsOut.map((k) => [bx0 + (k % W) + 0.5, bz0 + Math.floor(k / W) + 0.5] as Vec2);
  }
}

/** Whether an obb's bounding box meets the bounds [x0, z0, x1, z1]. */
function touches(o: { c: Vec2; half: Vec2; yaw: number }, b: [number, number, number, number]): boolean {
  let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
  for (const [x, z] of obbCorners(o)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
  return bx >= b[0] && ax <= b[2] && bz >= b[1] && az <= b[3];
}

/**
 * Paged windows: unit rects (a body's neighbourhood, a walker's chunk) merged while two share a tile and their union
 * stays ≤ `max` tiles a side. Canonical: sorted first, then merged greedily, so the same set of units always gives the
 * same windows (live and restored engines agree).
 */
export function clusterRects(units: TileRect[], max = MAX_WINDOW_TILES): TileRect[] {
  const cmp = (p: TileRect, q: TileRect) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2] || p[3] - q[3];
  const rs = units.map((u) => [...u] as TileRect).sort(cmp).filter((u, i, a) => i === 0 || cmp(u, a[i - 1]) !== 0);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < rs.length && !merged; i++) for (let j = i + 1; j < rs.length; j++) {
      const p = rs[i], q = rs[j];
      if (p[0] > q[2] || q[0] > p[2] || p[1] > q[3] || q[1] > p[3]) continue;
      const u = unionRect(p, q);
      if (u[2] - u[0] + 1 > max || u[3] - u[1] + 1 > max) continue;
      rs[i] = u; rs.splice(j, 1); merged = true; break;
    }
  }
  return rs.sort(cmp);
}

/** Obstacle bounding boxes, memoised per (never mutated) obstacle list: compose reads them for every window (engine P4). */
const boxesMemo = new WeakMap<Obstacle[], { n: number; b: Float64Array }>();
/** Grid-relevant identity of an obstacle / a surface (what a floor's raster reads), memoised per (never mutated) object. */
const inputKeys = new WeakMap<object, string>();
const obbKey = (o: Obstacle['obb']) => `${o.c[0]},${o.c[1]},${o.half[0]},${o.half[1]},${o.yaw}`;
const obstacleInput = (o: Obstacle) => { let k = inputKeys.get(o); if (k === undefined) inputKeys.set(o, (k = `${o.id}|${obbKey(o.obb)}|${o.y0},${o.y1}`)); return k; };
const surfaceInput = (s: Surface) => { let k = inputKeys.get(s); if (k === undefined) inputKeys.set(s, (k = `${s.id}|${s.level}|${obbKey(s.obb)}`)); return k; };
/**
 * S2: everything `buildGridsOverFloors({ ...scene, bounds, levels: same }, cell).levels.get(id)` reads, as a string. That
 * grid is the crop (on the global lattice) of the level's surfaces within `bounds`' lattice, rasterised and transformed
 * on the crop alone (out of it = blocked): so it is fixed by the levels' heights, the crop, and, in scene order, the
 * level's surfaces and the obstacles in a level's body band whose boxes (grown by two cells: a conservative raster touches
 * at most one cell beyond) reach the crop. Two rects holding the same whole floor share it (floor-over-incremental.test.ts).
 */
function floorKey(scene: SpatialScene, same: SpatialScene['levels'], id: number, bounds: [number, number, number, number], cell: number): string {
  const { ox, oz, nx, nz } = latticeOf(bounds, cell), sb = boxesOf(scene.surfaces as unknown as Obstacle[]);   // surfaces' OBB boxes, memoised per list
  let crop: [number, number, number, number] | null = null;
  for (const s of scene.surfaces) {
    if (s.level !== id) continue;
    const q = obbRange(s.obb, ox, oz, cell, nx, nz);
    if (q[0] > q[1] || q[2] > q[3]) continue;
    crop = crop ? [Math.min(crop[0], q[0]), Math.max(crop[1], q[1]), Math.min(crop[2], q[2]), Math.max(crop[3], q[3])] : q;
  }
  const levels = same.map((l) => `${l.id}@${l.y}`).join(',');
  // no floor reaches the rect: one blocked cell at the lattice origin
  if (!crop || !same.length) return `${cell}|${levels}|none@${ox},${oz}`;
  const g = [ox + crop[0], ox + crop[1], oz + crop[2], oz + crop[3]], m = 2 * cell;
  const x0 = g[0] * cell - m, x1 = (g[1] + 1) * cell + m, z0 = g[2] * cell - m, z1 = (g[3] + 1) * cell + m;
  const reaches = (b: Float64Array, k: number) => b[4 * k + 2] >= x0 && b[4 * k] <= x1 && b[4 * k + 3] >= z0 && b[4 * k + 1] <= z1;
  const out: string[] = [`${cell}|${levels}|${g.join(',')}`];
  for (let k = 0; k < scene.surfaces.length; k++) { const s = scene.surfaces[k]; if (s.level === id && reaches(sb, k)) out.push('s' + surfaceInput(s)); }
  const ob = boxesOf(scene.obstacles);
  for (let k = 0; k < scene.obstacles.length; k++) {
    const o = scene.obstacles[k];
    if (!reaches(ob, k) || !same.some((l) => !(o.y1 <= l.y + STEP || o.y0 >= l.y + BODY_HEIGHT))) continue;
    out.push('o' + obstacleInput(o));
  }
  return out.join(';');
}

/** Per obstacle its world AABB [minX, minZ, maxX, maxZ] (4 floats each), memoised per (never mutated) list. */
export function boxesOf(obstacles: Obstacle[]): Float64Array {
  const hit = boxesMemo.get(obstacles);
  if (hit && hit.n === obstacles.length) return hit.b;
  const b = new Float64Array(obstacles.length * 4);
  boxesMemo.set(obstacles, { n: obstacles.length, b });
  obstacles.forEach((o, k) => {
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const [x, z] of obbCorners(o.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
    b[4 * k] = ax; b[4 * k + 1] = az; b[4 * k + 2] = bx; b[4 * k + 3] = bz;
  });
  return b;
}

class MinHeap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(pri);
    while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= pri) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = pri;
  }
  pop(): number {
    const k = this.k, v = this.v, top = k[0], lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i, mv = lv; if (l < n && v[l] < mv) { m = l; mv = v[l]; } if (r < n && v[r] < mv) { m = r; mv = v[r]; } if (m === i) break; k[i] = k[m]; v[i] = v[m]; i = m; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// ---------------------------------------------------------------- hierarchical route

/** Coarse code of a 1 m cell inside a large solid (coarse routing only; never in a media tile). */
export const G_SOLID = 5;
/** Costs per medium for walking (walk, wade, swim, steep, outside, solid). Dry ground is preferred to the shallows. */
export const WALK_COST = [1, 2, Infinity, Infinity, Infinity, Infinity] as const;
/** Costs for explaining a refused walk: what is the cheapest thing in the way. */
const EXPLAIN_COST = [1, 2, 8, 60, Infinity, Infinity] as const;
/** Costs for swimming: water first, the shallows and a little dry ground to step in and out. */
export const SWIM_COST = [3, 1.5, 1, Infinity, Infinity, Infinity] as const;

const fmt = (p: Vec2) => `${p[0].toFixed(1)}, ${p[1].toFixed(1)}`;
const failR = (code: string, message: string, at?: Place): RouteResult => ({ ok: false, diagnostic: { code, message, subjects: [], ...(at ? { at: [at.p[0], 0, at.p[1]] as [number, number, number] } : {}) } });

/** Why a body cannot be (or stand) at a point on the ground, or null. */
export function groundGoalIssue(f: GroundField, p: Vec2, place = 'destination'): RouteResult | null {
  const m = f.medium(p[0], p[1]);
  if (m === G_OUTSIDE) return failR('ground.outside', `the ${place} (${fmt(p)}) lies beyond the edge of the world`);
  if (m === G_SWIM) { const lvl = f.waterLevel(p[0], p[1]) ?? 0; return failR('ground.deep-water', `the ${place} (${fmt(p)}) is in water ${(lvl - f.height(p[0], p[1])).toFixed(1)} m deep (wading stops at ${f.wadeMax} m); swim there instead`); }
  if (m === G_STEEP) return failR('ground.steep', `the ${place} (${fmt(p)}) is on ground steeper than ${slopeDeg(f.maxSlope)}° (a cliff); no footing there`);
  return null;
}
const slopeDeg = (s: number) => Math.round((datan2(s, 1) * 180) / Math.PI);

/** The hierarchical walk planner for ground worlds. `include` grows the engine window (false: too big). */
export function groundRoute(nav: GroundNav, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts, include: (r: TileRect) => boolean, windowGrids: () => GridSet): RouteResult {
  if (nav.paged) return pagedRoute(nav, scene, profile, start, goal, opts);
  const f = nav.field;
  if (start.level !== 0 || goal.level !== 0) {
    if (!include(rectOf([start.p, goal.p]))) return failR('ground.too-far', `(${fmt(goal.p)}) is too far to plan in one walk; walk part of the way first`, goal);
    return findRoute(windowGrids(), scene, profile, start, goal, opts);
  }
  const goalIssue = groundGoalIssue(f, goal.p);
  if (goalIssue) return goalIssue;
  const sm = f.medium(start.p[0], start.p[1]);
  if (sm === G_SWIM) return failR('ground.in-water', `you are swimming (${fmt(start.p)}); swim to the shore before walking`, start);
  // the coarse search looks 48 m around the straight line first, then wider (a way round a long cliff)
  const path = nav.coarsePath(start.p, goal.p, WALK_COST) ?? nav.coarsePath(start.p, goal.p, WALK_COST, 160, 2_000_000);
  if (!path) {
    const d = groundLinkDetour(nav, scene, profile, start, goal, opts, (r) => (include(r) ? windowGrids() : null), false);
    if (d) return d;
    const alt = nav.coarsePath(start.p, goal.p, EXPLAIN_COST, 96);
    if (alt) for (const q of alt) {
      const m = coarseMedium(f, q[0], q[1]);
      if (m === G_STEEP) return failR('ground.cliff', `no footpath to (${fmt(goal.p)}): ground steeper than ${slopeDeg(f.maxSlope)}° (a cliff) is in the way at (${fmt(q)})`, { level: 0, p: q });
      if (m === G_SWIM) return failR('ground.deep-water', `no footpath to (${fmt(goal.p)}): water deeper than ${f.wadeMax} m is in the way at (${fmt(q)}); swim across or go round`, { level: 0, p: q });
    }
    return failR('ground.unreachable', `no way on foot from (${fmt(start.p)}) to (${fmt(goal.p)})`, goal);
  }
  // hops along the coarse path, each planned by the fine planner on just its own tiles
  // hop ends as coarse path indices (path.length = the goal itself)
  const ends: number[] = [];
  let acc = 0;
  for (let k = 1; k < path.length; k++) {
    acc += hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    if (acc >= HOP_M && k < path.length - 4) { ends.push(k); acc = 0; }
  }
  ends.push(path.length);
  const legs: Leg[] = [];
  let from: Place = start, length = 0, expanded = 0, prev = 0;
  for (let h = 0; h < ends.length; h++) {
    const hop = (k: number): RouteResult | 'too-far' => {
      const last = k >= path.length, target: Place = { level: 0, p: last ? goal.p : path[k] };
      const r = rectOf([from.p, target.p, ...path.slice(prev + 1, Math.min(k, path.length - 1) + 1)]);
      if (!include(r)) return 'too-far';
      const grids: GridSet = { cell: nav.cell, levels: new Map([[0, nav.compose(r, scene.obstacles)]]) };
      return findRoute(grids, { ...scene, bounds: rectBounds(r), links: [] }, profile, from, target, last ? opts : { ...opts, goalTolerance: 2.5 });
    };
    let res = hop(ends[h]);
    // BS3 (b): an intermediate waypoint no fine route reaches (inside an enterable building the coarse path runs through):
    // retry waypoints along the coarse path between this hop's start and the next hop's end, first that plans wins
    if (res !== 'too-far' && !res.ok && ends[h] < path.length) {
      for (const kk of hopRetries(ends[h], path.length, res.diagnostic.code, true, prev + 1)) {
        if (kk >= (ends[h + 1] ?? path.length) && kk < path.length) continue;
        const t = hop(kk);
        if (t !== 'too-far' && t.ok) { res = t; ends[h] = kk; if (kk >= path.length) ends.length = h + 1; break; }
      }
    }
    if (res === 'too-far') return failR('ground.too-far', `(${fmt(goal.p)}) is too far to walk to in one go; walk part of the way first`, goal);
    if (!res.ok) return res;
    prev = Math.min(ends[h], path.length - 1);
    for (const leg of res.route.legs) appendLeg(legs, leg);
    length += res.route.length; expanded += res.route.expanded;
    const end = (res.route.legs.at(-1) as WalkLeg | undefined)?.points.at(-1);
    from = { level: 0, p: end ?? (ends[h] >= path.length ? goal.p : path[ends[h]]) };
  }
  return { ok: true, route: { legs, length, expanded } };
}

/** A same-level flight's ends this close (m) to the start or the goal are tried when the coarse ground search finds no way. */
export const LINK_DETOUR_M = 60;
/**
 * door-stairs/1 (lane SW): the coarse ground search walks no links, so a goal (or a start) on a hillside pocket that only a
 * level-0 -> level-0 flight joins to the paths (a door landing above a bank, a terrace) had no route although the fine
 * planner walks that flight. Only when the coarse search found nothing: the nearest usable ground flights (both ends on
 * level 0, an end within LINK_DETOUR_M of the start or the goal) whose near approach the coarse search reaches from the
 * start and whose far approach reaches the goal. Close enough, one fine route over a window holding both and the flight
 * (links kept); farther, paged: walk toward the flight (the route carries `rest`, the real goal, so the walker plans on
 * through the flight); unpaged: the whole window when it may grow that far. Null: no flight helps (the old diagnostic).
 */
function groundLinkDetour(nav: GroundNav, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts, gridsFor: (r: TileRect) => GridSet | null, paged: boolean): RouteResult | null {
  const near = (p: Vec2) => Math.min(hypot(p[0] - start.p[0], p[1] - start.p[1]), hypot(p[0] - goal.p[0], p[1] - goal.p[1]));
  const cands = scene.links
    .filter((l) => l.usable && l.from.level === 0 && l.to.level === 0 && Math.min(near(l.from.p), near(l.to.p)) <= LINK_DETOUR_M)
    .sort((a, b) => Math.min(near(a.from.p), near(a.to.p)) - Math.min(near(b.from.p), near(b.to.p)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 4);
  for (const link of cands) for (const ascending of [true, false]) {
    const p = linkApproach(link, ascending).approach, q = linkApproach(link, !ascending).approach;
    if (!nav.coarsePath(start.p, p, WALK_COST) || !nav.coarsePath(q, goal.p, WALK_COST)) continue;
    const pts = [start.p, goal.p, p, q];
    if (hypot(goal.p[0] - start.p[0], goal.p[1] - start.p[1]) <= PAGED_DIRECT_M || !paged) {
      const r = rectOf(pts), grids = gridsFor(r);
      if (!grids) continue;
      const res = findRoute(grids, paged ? { ...scene, bounds: rectBounds(r) } : scene, profile, start, goal, opts);
      if (res.ok) return res;
      continue;
    }
    // far, standing by the flight: up (or down) it to its far approach, then on to the goal
    if (hypot(p[0] - start.p[0], p[1] - start.p[1]) <= PAGED_DIRECT_M) {
      const r = rectOf([start.p, p, q]), grids = gridsFor(r);
      if (!grids) continue;
      const res = findRoute(grids, { ...scene, bounds: rectBounds(r) }, profile, start, { level: 0, p: q }, { ...opts, goalTolerance: 2.5 });
      if (res.ok) return { ok: true, route: { ...res.route, length: res.route.length + hypot(goal.p[0] - q[0], goal.p[1] - q[1]), rest: goal } };
      continue;
    }
    // far: the first chunk toward the flight's near approach; the walker follows on to the goal (through the flight)
    const res = pagedRoute(nav, scene, profile, start, { level: 0, p }, { ...opts, goalTolerance: 2.5 }, true);
    if (!res.ok) continue;
    return { ok: true, route: { ...res.route, length: res.route.length + hypot(goal.p[0] - p[0], goal.p[1] - p[1]), rest: goal } };
  }
  return null;
}

/** Paged: start and goal this close (m) are routed in one go (any levels); farther, a chunk at a time on level 0. */
export const PAGED_DIRECT_M = 72;

/**
 * Paged planner (lane NAV): the coarse path proves the whole way (and names what is in the way, as groundRoute), but only
 * its first hop is planned fine; the route then carries `rest` (the real goal) and the walker plans the next chunk before
 * it reaches the end of this one. A goal on another level is approached on level 0 until it is within PAGED_DIRECT_M.
 */
export function pagedRoute(nav: GroundNav, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts, detouring = false): RouteResult {
  const f = nav.field, direct = hypot(goal.p[0] - start.p[0], goal.p[1] - start.p[1]) <= PAGED_DIRECT_M;
  if (start.level !== 0 || goal.level !== 0) {
    if (direct) { const r = rectOf([start.p, goal.p]); return findRoute(nav.gridsOver(r, scene), { ...scene, bounds: rectBounds(r) }, profile, start, goal, opts); }
    if (start.level !== 0) return (opts.routeReachV1 ? upperChunk(nav, scene, profile, start, goal, opts) : null) ?? failR('ground.too-far', `(${fmt(goal.p)}) is too far to plan from an upper floor; walk down first`, goal);
  } else {
    const goalIssue = groundGoalIssue(f, goal.p);
    if (goalIssue) return goalIssue;
  }
  const sm = f.medium(start.p[0], start.p[1]);
  if (sm === G_SWIM) return failR('ground.in-water', `you are swimming (${fmt(start.p)}); swim to the shore before walking`, start);
  const path = nav.coarsePath(start.p, goal.p, WALK_COST) ?? nav.coarsePath(start.p, goal.p, WALK_COST, 160, 2_000_000);
  if (!path) {
    if (start.level === 0 && goal.level === 0 && !detouring) {
      const d = groundLinkDetour(nav, scene, profile, start, goal, opts, (r) => nav.gridsOver(r, scene), true);
      if (d) return d;
    }
    const alt = nav.coarsePath(start.p, goal.p, EXPLAIN_COST, 96);
    if (alt) for (const q of alt) {
      const m = coarseMedium(f, q[0], q[1]);
      if (m === G_STEEP) return failR('ground.cliff', `no footpath to (${fmt(goal.p)}): ground steeper than ${slopeDeg(f.maxSlope)}° (a cliff) is in the way at (${fmt(q)})`, { level: 0, p: q });
      if (m === G_SWIM) return failR('ground.deep-water', `no footpath to (${fmt(goal.p)}): water deeper than ${f.wadeMax} m is in the way at (${fmt(q)}); swim across or go round`, { level: 0, p: q });
    }
    return failR('ground.unreachable', `no way on foot from (${fmt(start.p)}) to (${fmt(goal.p)})`, goal);
  }
  // the first hop (as groundRoute cuts them); the last one ends at the goal itself
  let acc = 0, k0 = 1;
  for (; k0 < path.length; k0++) { acc += hypot(path[k0][0] - path[k0 - 1][0], path[k0][1] - path[k0 - 1][1]); if (acc >= HOP_M && k0 < path.length - 4) break; }
  const hop = (k: number, margin = WINDOW_MARGIN_M) => {
    const last = k >= path.length && goal.level === 0, target: Vec2 = last ? goal.p : path[Math.min(k, path.length - 1)];
    const r = rectOf([start.p, target, ...path.slice(1, k + 1)], margin);
    const grids: GridSet = { cell: nav.cell, levels: new Map([[0, nav.compose(r, scene.obstacles)]]) };
    return { k, last, res: findRoute(grids, { ...scene, bounds: rectBounds(r), links: [] }, profile, start, { level: 0, p: target }, last ? opts : { ...opts, goalTolerance: 2.5 }) };
  };
  let h = hop(k0);
  // BS3 (b): the coarse path runs through enterable buildings (only big solids are coarse-solid), so the hop's waypoint can
  // lie in a shop where no fine route ends (eden-2026: the jetty -> chapel walk stopped in old-town-north-arcade-1); a few
  // waypoints further along or back along the same coarse path are tried before the walk fails
  if (!h.res.ok && !h.last) for (const kk of hopRetries(k0, path.length, h.res.diagnostic.code, goal.level === 0)) { const t = hop(kk); if (t.res.ok) { h = t; break; } }
  // route-reach/1 (#872): the fine route can need ground outside a window cut WINDOW_MARGIN_M round the coarse path (a
  // fence or a building's walls the coarse path crosses: the way round leaves the tile). One tile wider, once, before refusing.
  if (!h.res.ok && opts.routeReachV1 && HOP_RETRY_CODES.has(h.res.diagnostic.code)) { const t = hop(h.k, WINDOW_MARGIN_M + GROUND_TILE_M); if (t.res.ok) h = t; }
  const { k, last, res } = h;
  if (!res.ok || last) return res;
  // length: this chunk's, plus the coarse path's remainder (an estimate of the whole walk, e.g. routeEstimateV1)
  let more = 0;
  for (let j = Math.min(k, path.length - 1) + 1; j < path.length; j++) more += hypot(path[j][0] - path[j - 1][0], path[j][1] - path[j - 1][1]);
  return { ok: true, route: { ...res.route, length: res.route.length + more, rest: goal } };
}

/** Distances (m along the line to the goal) of the ground points route-reach/1 tries as the end of an upper floor's first chunk. */
const UPPER_CHUNK_M = [60, 48, 36, 24, 12, 0];
/**
 * route-reach/1 (#872): a far walk from an upper floor. The first chunk is planned in one window from where the body
 * stands, down the building's own stairs, to a standable ground point toward the goal (the farthest of UPPER_CHUNK_M
 * that a fine route reaches and from which a coarse footpath goes on to the goal); the route carries `rest`, and the
 * walker plans on from the ground, as every paged walk does. Null (the old refusal) when no such chunk exists.
 */
function upperChunk(nav: GroundNav, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts): RouteResult | null {
  const d = hypot(goal.p[0] - start.p[0], goal.p[1] - start.p[1]); if (!(d > 0)) return null;
  const u: Vec2 = [(goal.p[0] - start.p[0]) / d, (goal.p[1] - start.p[1]) / d];
  for (const m of UPPER_CHUNK_M) {
    const p: Vec2 = [start.p[0] + u[0] * m, start.p[1] + u[1] * m];
    if (groundGoalIssue(nav.field, p)) continue;
    if (!nav.coarsePath(p, goal.p, WALK_COST)) continue;
    const r = rectOf([start.p, p]);
    const res = findRoute(nav.gridsOver(r, scene), { ...scene, bounds: rectBounds(r) }, profile, start, { level: 0, p }, { ...opts, goalTolerance: 2.5 });
    if (!res.ok) continue;
    return { ok: true, route: { ...res.route, length: res.route.length + hypot(goal.p[0] - p[0], goal.p[1] - p[1]), rest: goal } };
  }
  return null;
}

/** BS3 (b): a fine hop to coarse waypoint `k` failed with `code`: the other waypoint indices to try, nearest first (one
 *  past the end = the goal itself when `goalOk`). Only for an unreachable waypoint, never a blocked start. */
const HOP_RETRY = [12, 24, -12, -24];
const HOP_RETRY_CODES = new Set(['route.unreachable', 'route.goal-blocked', 'route.search-limit']);
export function hopRetries(k: number, n: number, code: string, goalOk: boolean, lo = 1): number[] {
  if (!HOP_RETRY_CODES.has(code)) return [];
  const out: number[] = [];
  for (const d of HOP_RETRY) {
    let kk = k + d;
    if (kk >= n - 1) kk = goalOk ? n : n - 1;
    if (kk < lo || kk === k || out.includes(kk)) continue;
    out.push(kk);
  }
  return out;
}

function appendLeg(legs: Leg[], leg: Leg) {
  const prev = legs.at(-1);
  if (prev?.kind === 'walk' && leg.kind === 'walk' && prev.level === leg.level) {
    const a = prev.points.at(-1)!, b = leg.points[0];
    const pts = a[0] === b[0] && a[1] === b[1] ? leg.points.slice(1) : leg.points;
    legs[legs.length - 1] = { ...prev, points: [...prev.points, ...pts], minClearance: Math.min(prev.minClearance, leg.minClearance) };
  } else legs.push(leg);
}

export { MEDIUM_NAMES, G_WALK, G_WADE, G_SWIM, G_STEEP, G_OUTSIDE };
