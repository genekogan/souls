// Per-level walkability rasters + exact Euclidean clearance fields.
// Deterministic, allocation-light and pure TS so it runs in the Durable
// Object as well as the browser. Rebuilt (or patched) when construction
// changes the scene.
import { hashOf } from '../core/hash.ts';
import { obbCorners, obbOverlapAt, pointInObb, type OBB2, type Vec2, hypot } from '../core/math.ts';
import type { Level, Obstacle, SpatialScene, Surface } from './types.ts';

export type LevelGrid = {
  level: number;
  y: number;
  cell: number;
  nx: number;
  nz: number;
  /**
   * Global lattice index of cell column 0 / row 0: cell (i, j) of every grid is lattice cell
   * (ox + i, oz + j), spanning [(ox + i)·cell, (ox + i + 1)·cell) in x. Grids of different bounds
   * (a crop vs the whole campus) share the lattice, so the same physical cell has bit-identical
   * centres everywhere. Convert only with cellOf / centreOf / cellCentre (world ↔ cell).
   */
  ox: number;
  oz: number;
  /** ox·cell, oz·cell: the grid's world-space corner, for display only (never derive cells from it). */
  x0: number;
  z0: number;
  /** 1 = floor present and free of obstacles at body height. */
  free: Uint8Array;
  /** Distance (m) from cell centre to the nearest non-free cell (0 on blocked cells). */
  clearance: Float32Array;
  /** Obstacle id blocking each cell (for diagnostics), absent when free/void. A dense BlockerMap for grids built here. */
  blockers: Map<number, string>;
};

export type GridSet = { cell: number; levels: Map<number, LevelGrid> };
type PackedBlockers = { cells: Uint16Array | Int32Array; ids: string[]; count: number };

/**
 * LevelGrid.blockers as a dense per-cell table: a Map<number, string> whose entries live in an
 * Int32Array of indices into an append-only id table, so a grid patch copies 4 bytes per cell
 * (a memcpy) instead of rebuilding a hash map of every blocked cell. Iterates in cell order.
 */
export class BlockerMap extends Map<number, string> {
  private cells: Int32Array;
  private ids: string[];
  private index: Map<string, number>;
  private count: number;

  constructor(n: number, from?: BlockerMap, independent = false) {
    super();
    // copies share the id table: it only grows, and indices already written never change
    this.cells = from ? from.cells.slice() : new Int32Array(n).fill(-1);
    this.ids = from ? independent ? from.ids.slice() : from.ids : [];
    this.index = from ? independent ? new Map(from.index) : from.index : new Map();
    this.count = from ? from.count : 0;
  }

  copy(): BlockerMap {
    return new BlockerMap(this.cells.length, this);
  }

  /** A derived-geometry template must not share even its append-only dictionary with a runtime. */
  detachedCopy(): BlockerMap { return new BlockerMap(this.cells.length, this, true); }

  /** Estimated retained cells + every append-only dictionary/index entry, including unused ids. */
  retainedStorageBytes(): number {
    let bytes = this.cells.byteLength + this.ids.length * 8 + this.index.size * 72;
    for (const id of this.ids) bytes += id.length * 2;
    return bytes;
  }

  /** (boot keep, lane t4-mem) The cell table as index + 1 in 16 bits when the id table allows (0: no blocker), else as
   *  is; with the id table and count, BlockerMap.unpack rebuilds an equal map. */
  pack(): PackedBlockers {
    if (this.ids.length >= 0xffff) return { cells: this.cells, ids: this.ids, count: this.count };
    const cells = new Uint16Array(this.cells.length);
    for (let i = 0; i < cells.length; i++) cells[i] = this.cells[i] + 1;
    return { cells, ids: this.ids, count: this.count };
  }

  static unpack(p: PackedBlockers): BlockerMap {
    const m = new BlockerMap(0), n = p.cells.length;
    if (p.cells instanceof Uint16Array) { m.cells = new Int32Array(n); for (let i = 0; i < n; i++) m.cells[i] = p.cells[i] - 1; }
    else m.cells = p.cells.slice();
    m.ids = p.ids; m.index = new Map(p.ids.map((id, k) => [id, k])); m.count = p.count;
    return m;
  }

  override get size(): number {
    return this.count;
  }

  override get(i: number): string | undefined {
    const k = this.cells[i];
    return k >= 0 ? this.ids[k] : undefined;
  }

  override has(i: number): boolean {
    return this.cells[i] >= 0;
  }

  override set(i: number, id: string): this {
    if (!Number.isInteger(i) || i < 0 || i >= this.cells.length) throw new RangeError(`BlockerMap: cell ${i} outside 0..${this.cells.length - 1}`);
    let k = this.index.get(id);
    if (k === undefined) { k = this.ids.length; this.ids.push(id); this.index.set(id, k); }
    if (this.cells[i] < 0) this.count++;
    this.cells[i] = k;
    return this;
  }

  override delete(i: number): boolean {
    if (!(this.cells[i] >= 0)) return false;
    this.cells[i] = -1;
    this.count--;
    return true;
  }

  override clear() {
    this.cells.fill(-1);
    this.count = 0;
  }

  override *entries(): MapIterator<[number, string]> {
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] >= 0) yield [i, this.ids[this.cells[i]]];
  }

  override *keys(): MapIterator<number> {
    for (const [i] of this.entries()) yield i;
  }

  override *values(): MapIterator<string> {
    for (const [, id] of this.entries()) yield id;
  }

  override [Symbol.iterator](): MapIterator<[number, string]> {
    return this.entries();
  }

  override forEach(fn: (id: string, i: number, map: Map<number, string>) => void, thisArg?: unknown) {
    for (const [i, id] of this.entries()) fn.call(thisArg, id, i, this);
  }
}

/**
 * The global cell lattice: lattice cell k spans [k·cell, (k + 1)·cell) and has centre (k + 0.5)·cell.
 * Every world ↔ cell conversion in the engine goes through these two functions, so a coordinate
 * never depends on a grid's origin (only an integer index offset does).
 */
export const latticeIndex = (x: number, cell: number) => Math.floor(x / cell);
export const latticeCentre = (k: number, cell: number) => (k + 0.5) * cell;

/** Lattice extent covering `bounds`: first lattice cell (ox, oz) and cell counts. */
export function latticeOf(bounds: readonly [number, number, number, number], cell: number): { ox: number; oz: number; nx: number; nz: number } {
  const [minX, minZ, maxX, maxZ] = bounds;
  const ox = latticeIndex(minX, cell), oz = latticeIndex(minZ, cell);
  return { ox, oz, nx: Math.max(0, Math.ceil(maxX / cell) - ox), nz: Math.max(0, Math.ceil(maxZ / cell) - oz) };
}

export const BODY_HEIGHT = 1.8;
export const STEP = 0.22;

/**
 * Memoised rasters of a fixed obstacle list (a static base scene, e.g. the 2.7k campus obstacles):
 * per level height, the index of the first listed obstacle covering each cell (conservative
 * raster, −1 none). buildGrids given this `prefix` skips re-rasterising those obstacles when they
 * lead `scene.obstacles` — same free cells and blockers, since obstacles only clear cells and the
 * first one to clear a floor cell names it.
 */
export class StaticRaster {
  readonly obstacles: Obstacle[];
  readonly bounds: [number, number, number, number];
  readonly cell: number;
  private byY = new Map<number, Int32Array>();

  constructor(obstacles: Obstacle[], bounds: [number, number, number, number], cell: number) {
    this.obstacles = obstacles.slice(); // snapshot: fits() compares element identity
    this.bounds = bounds;
    this.cell = cell;
  }

  /** Whether `scene` (at `cell`) starts with exactly these obstacles on the same raster. */
  fits(scene: SpatialScene, cell: number): boolean {
    if (cell !== this.cell || scene.obstacles.length < this.obstacles.length || scene.bounds.some((b, k) => b !== this.bounds[k])) return false;
    for (let k = 0; k < this.obstacles.length; k++) if (scene.obstacles[k] !== this.obstacles[k]) return false;
    return true;
  }

  firstCover(y: number): Int32Array {
    const m = this.byY.get(y);
    if (m) return m;
    const cell = this.cell;
    const { ox, oz, nx, nz } = latticeOf(this.bounds, cell);
    const cover = new Int32Array(nx * nz).fill(-1);
    this.obstacles.forEach((o, k) => {
      if (o.y1 <= y + STEP || o.y0 >= y + BODY_HEIGHT) return;
      rasterObb(o.obb, ox, oz, cell, nx, nz, (i) => { if (cover[i] < 0) cover[i] = k; }, o.raster !== 'centre');
    });
    if (this.byY.size >= 8) this.byY.delete(this.byY.keys().next().value!);
    this.byY.set(y, cover);
    return cover;
  }
}

export function buildGrids(scene: SpatialScene, cell = 0.1, prefix?: StaticRaster, keepColumns = false): GridSet {
  const lat = latticeOf(scene.bounds, cell);
  const levels = new Map<number, LevelGrid>();
  const pre = prefix?.fits(scene, cell) ? prefix : undefined;
  for (const lv of scene.levels) levels.set(lv.id, buildLevel(scene, lv, cell, levelLattice(scene, lv, cell, lat), lv.crop ? undefined : pre, keepColumns));
  return { cell, levels };
}

/**
 * The lattice extent of one level's grid: the scene's, or (upper-floors/1, Level.crop) the cells of its crop rectangle that
 * lie inside the scene bounds. Same global lattice either way, so a cell has the same centre in every grid; outside a crop
 * there is no floor (clearance reads 0 there, as off any grid). The static obstacle prefix covers the scene extent only, so
 * a cropped level rasterises every obstacle itself (a building's few hundred cells).
 */
export function levelLattice(scene: SpatialScene, lv: Level, cell: number, lat = latticeOf(scene.bounds, cell)): Lattice {
  if (!lv.crop) return lat;
  const [a, b, c, d] = lv.crop, [x0, z0, x1, z1] = scene.bounds;
  const crop = latticeOf([Math.max(a, x0), Math.max(b, z0), Math.min(c, x1), Math.min(d, z1)], cell);
  return { ox: crop.ox, oz: crop.oz, nx: Math.max(1, crop.nx), nz: Math.max(1, crop.nz) };
}

/**
 * Content keys of grids whose builder can name what they hold (tiled.ts: a composite's tile keys, a memoised floor's
 * static generation), so per-grid memos (path.ts, a failed search's side) survive a rebuild of the same content.
 */
export const gridContentKeys = new WeakMap<LevelGrid, string>();

/**
 * `buildGrids(scene, cell)` (no prefix, no columns), each level rasterised and transformed only over the cells its own
 * surfaces reach: a free cell has a floor under its centre, so every cell outside that crop is blocked in the full grid
 * too, and the exact EDT (out-of-grid = blocked) reads the same distances on the crop. L1: each level's grid now *is*
 * that crop (its own ox/oz/nx/nz on the global lattice; a level no surface reaches is one blocked cell), so a cell
 * outside it reads as before (cellOf −1: no floor, clearance 0). A paged window's upper floors (a few houses in a 128–384 m
 * window) used to hold the window's area each (Eden 2026 canal row: 11 levels × 1.6 M cells, 155 MB, and route searches
 * over all of them); free, clearance and blockers of every crop cell are bit-identical to buildGrids (grid-floor-crop.test.ts).
 */
export function buildGridsOverFloors(scene: SpatialScene, cell = 0.1): GridSet {
  const lat = latticeOf(scene.bounds, cell), { ox, oz, nx, nz } = lat;
  const levels = new Map<number, LevelGrid>();
  for (const lv of scene.levels) {
    let crop: Rect | null = null;
    for (const s of scene.surfaces) {
      if (s.level !== lv.id) continue;
      const r = obbRange(s.obb, ox, oz, cell, nx, nz);
      if (r[0] > r[1] || r[2] > r[3]) continue;
      crop = crop ? [Math.min(crop[0], r[0]), Math.max(crop[1], r[1]), Math.min(crop[2], r[2]), Math.max(crop[3], r[3])] : r;
    }
    const [i0, i1, j0, j1] = crop ?? [0, 0, 0, 0], cw = i1 - i0 + 1, ch = j1 - j0 + 1;
    const sub: Lattice = { ox: ox + i0, oz: oz + j0, nx: cw, nz: ch };
    const free = new Uint8Array(cw * ch), blockers = new BlockerMap(cw * ch);
    if (crop) stampLevel(scene, lv, cell, sub, undefined, free, blockers);
    const clearance = crop ? edt(free, cw, ch, cell) : new Float32Array(cw * ch);
    levels.set(lv.id, { level: lv.id, y: lv.y, cell, nx: cw, nz: ch, ox: sub.ox, oz: sub.oz, x0: sub.ox * cell, z0: sub.oz * cell, free, clearance, blockers });
  }
  return { cell, levels };
}

// Only immutable raster/EDT products are retained, never a Spatial, world, route,
// body, reservation or permission. Every caller receives independent storage.
const STATIC_GRID_CACHE_LIMIT = 64 * 1024 * 1024;
const staticGridReads = new Map<string, { grids: GridSet; bytes: number }>();
let staticGridReadDepth = 0, staticGridReadBytes = 0, staticGridReadHits = 0, staticGridReadMisses = 0;
/** Internal numeric-only diagnostics; no world or geometry references escape. */
export function staticGridReadCacheMetrics() { return { entries: staticGridReads.size, estimatedBytes: staticGridReadBytes, hits: staticGridReadHits, misses: staticGridReadMisses, maxBytes: STATIC_GRID_CACHE_LIMIT, maxEntries: 8 }; }
/** Opt-in for the synchronous portion of a detached geometry read. */
export function withStaticGridReadCache<T>(read: () => T): T {
  staticGridReadDepth++;
  try { return read(); } finally { staticGridReadDepth--; }
}
/** G9 lane Z1b: a release's standby process (apps/server/src/standby.ts) rehearses its world's restore before the go and
 *  builds that world's static grids inside keepStaticGridsForBoot; the boot after the go then takes them, by the same
 *  exact-geometry key as the read cache, instead of rebuilding them in its first tick (~0.8 s of /w/eden's pause on a
 *  laptop). Each kept set is handed out once (its owner is the boot's engine from then on; the rehearsed engine never
 *  ticked); a different scene builds as before, and after BOOT_GRID_TRIES builds without a match the rest are dropped. */
const bootGrids = new Map<string, PackedGrids>(), BOOT_GRID_TRIES = 4;
let keepingForBoot = false, bootGridMisses = 0, bootStore: BootGridStore | null = null, bootNames = 0;
/** Where a standby keeps its packed boot grids until the go: a file beside the world's database (apps/server/src/standby.ts),
 *  so the standby process does not hold them while the world's running process still serves. `take` reads and removes it. */
export type BootGridStore = { put(name: string, parts: Uint8Array[]): void; take(name: string): Uint8Array | null; drop(name: string): void };
export function keepStaticGridsForBoot(build: () => void, store?: BootGridStore): number {
  dropBootGrids();
  keepingForBoot = true; bootStore = store ?? null;
  try { build(); } finally { keepingForBoot = false; }
  bootGridMisses = 0;
  return bootGrids.size;
}
function dropBootGrids() { for (const p of bootGrids.values()) if (p.file) bootStore?.drop(p.file.name); bootGrids.clear(); }

/** (lane t4-mem) A kept set waits packed: clearance as the squared cell distance of its EDT in 16 bits (every cell checked
 *  against the exact metres it expands to; free is then clearance > 0), blockers as 16-bit indices, no column pass (it is
 *  recomputed when first needed: columnsFor). Eden: 272 MB as built, 67 MB packed, and that in a file when a store is given. */
type Part = Uint8Array | Uint16Array | Int32Array | Float32Array;
type PackedLevel = { base: Omit<LevelGrid, 'free' | 'clearance' | 'blockers'>; columns: boolean;
  q?: number; table?: Float32Array; clearance?: number; free?: number; blockers: { cells: number; ids: string[]; count: number } | Map<number, string> };
type PackedGrids = { cell: number; levels: [number, PackedLevel][]; parts: Part[] | null; file: { name: string; layout: [Kind, number, number][]; bytes: number; nonce: Float64Array } | null };
type Kind = 'u8' | 'u16' | 'i32' | 'f32';
const KINDS = { u8: Uint8Array, u16: Uint16Array, i32: Int32Array, f32: Float32Array };
const kindOf = (x: Part): Kind => (x instanceof Uint16Array ? 'u16' : x instanceof Int32Array ? 'i32' : x instanceof Float32Array ? 'f32' : 'u8');

function packLevel(g: LevelGrid, parts: Part[]): PackedLevel {
  const { free, clearance, blockers, ...base } = g, n = free.length, half = g.cell / 2;
  let packedBlockers: PackedLevel['blockers'] = blockers;
  if (blockers instanceof BlockerMap) { const b = blockers.pack(); packedBlockers = { cells: parts.push(b.cells) - 1, ids: b.ids, count: b.count }; }
  const p: PackedLevel = { base, columns: COLUMNS.has(g), blockers: packedBlockers };
  const q = new Uint16Array(n);
  let max = 0, fits = true;
  for (let i = 0; i < n && fits; i++) {
    const c = clearance[i];
    if (c === 0) continue;
    const r = (c + half) / g.cell, d = Math.round(r * r);
    if (d < 1 || d > 0xffff) fits = false; else { q[i] = d; if (d > max) max = d; }
  }
  const table = new Float32Array(max + 1);
  for (let d = 1; d <= max; d++) table[d] = Math.max(0, Math.sqrt(d) * g.cell - half);   // edtRows' exact expression
  for (let i = 0; i < n && fits; i++) if (table[q[i]] !== clearance[i] || free[i] !== (q[i] ? 1 : 0)) fits = false;
  if (fits) { p.q = parts.push(q) - 1; p.table = table; }
  else { p.clearance = parts.push(clearance) - 1; p.free = parts.push(free) - 1; }
  return p;
}
function unpackLevel(p: PackedLevel, part: (k: number) => Part, owned: boolean): LevelGrid {
  const n = p.base.nx * p.base.nz;
  let free: Uint8Array, clearance: Float32Array;
  if (p.q !== undefined) {
    const q = part(p.q) as Uint16Array, t = p.table!;
    free = new Uint8Array(n); clearance = new Float32Array(n);
    for (let i = 0; i < n; i++) { const d = q[i]; if (d) { free[i] = 1; clearance[i] = t[d]; } }
  } else {
    clearance = part(p.clearance!) as Float32Array; free = part(p.free!) as Uint8Array;
    if (!owned) { clearance = clearance.slice(); free = free.slice(); }
  }
  const b = p.blockers, blockers = b instanceof Map ? b : BlockerMap.unpack({ cells: part(b.cells) as Uint16Array | Int32Array, ids: b.ids, count: b.count });
  const g: LevelGrid = { ...p.base, free, clearance, blockers };
  if (p.columns) LAZY_COLUMNS.add(g);
  return g;
}
function packGrids(grids: GridSet): PackedGrids {
  const parts: Part[] = [], levels: [number, PackedLevel][] = [];
  for (const [id, g] of grids.levels) levels.push([id, packLevel(g, parts)]);
  const packed: PackedGrids = { cell: grids.cell, levels, parts, file: null };
  if (bootStore) {
    // [nonce][part 0][part 1]…, each on an 8-byte boundary so every part reads back as a typed view of the one buffer
    const nonce = new Float64Array([Math.random(), Date.now()]), bytes: Uint8Array[] = [new Uint8Array(nonce.buffer)], layout: [Kind, number, number][] = [];
    let at = 16;
    for (const x of parts) {
      layout.push([kindOf(x), at, x.length]); bytes.push(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
      const pad = (8 - (x.byteLength % 8)) % 8; if (pad) bytes.push(new Uint8Array(pad));
      at += x.byteLength + pad;
    }
    const name = String(bootNames++);
    try { bootStore.put(name, bytes); packed.file = { name, layout, bytes: at, nonce }; packed.parts = null; } catch { bootStore.drop(name); /* no room on disk: they wait here */ }
  }
  return packed;
}
function unpackGrids(p: PackedGrids): GridSet | null {
  let part: (k: number) => Part = (k) => p.parts![k], owned = true;
  if (p.file) {
    const f = p.file, read = bootStore?.take(f.name);
    if (!read || read.byteLength !== f.bytes) return null;
    const b = read.byteOffset % 8 ? read.slice() : read, head = new Float64Array(b.buffer, b.byteOffset, 2);
    if (head[0] !== f.nonce[0] || head[1] !== f.nonce[1]) return null;   // not the file this process wrote
    part = (k) => { const [kind, at, length] = f.layout[k]; return new KINDS[kind](b.buffer as ArrayBuffer, b.byteOffset + at, length); };
    owned = false;
  }
  const levels = new Map<number, LevelGrid>();
  for (const [id, l] of p.levels) levels.set(id, unpackLevel(l, part, owned));
  return { cell: p.cell, levels };
}
function detachedGrids(grids: GridSet): GridSet {
  const levels = new Map<number, LevelGrid>();
  for (const [id, g] of grids.levels) {
    const blockers = g.blockers instanceof BlockerMap ? g.blockers.detachedCopy() : new Map(g.blockers);
    const copy = { ...g, free: g.free.slice(), clearance: g.clearance.slice(), blockers };
    const cols = COLUMNS.get(g); if (cols) COLUMNS.set(copy, cols.slice());
    levels.set(id, copy);
  }
  return { cell: grids.cell, levels };
}
function gridStorageBytes(grids: GridSet): number {
  let bytes = 0;
  for (const g of grids.levels.values()) {
    bytes += g.free.byteLength + g.clearance.byteLength + (COLUMNS.get(g)?.byteLength ?? 0);
    if (g.blockers instanceof BlockerMap) bytes += g.blockers.retainedStorageBytes();
    else for (const id of g.blockers.values()) bytes += 80 + id.length * 2;
  }
  return bytes;
}
/** Spatial.sync's complete assembled static geometry only. Dynamic people/around
 * grids are deliberately excluded; profiles and permissions are checked later.
 * Exact ordered geometry includes nav edits, contributor output and height bands. */
export function buildStaticGrids(scene: SpatialScene, cell = 0.1, prefix?: StaticRaster, keepColumns = false): GridSet {
  if (keepingForBoot) {
    const key = hashOf({ format: 'static-grid-read/1', scene, cell, keepColumns, step: STEP, bodyHeight: BODY_HEIGHT }), grids = buildGrids(scene, cell, prefix, keepColumns);
    bootGrids.set(key, packGrids(grids));   // the rehearsed engine that asked for them is thrown away unticked
    return grids;
  }
  if (!staticGridReadDepth) {
    if (bootGrids.size) {
      const key = hashOf({ format: 'static-grid-read/1', scene, cell, keepColumns, step: STEP, bodyHeight: BODY_HEIGHT }), kept = bootGrids.get(key);
      if (kept) { bootGrids.delete(key); const grids = unpackGrids(kept); if (grids) return grids; }
      else if (++bootGridMisses >= BOOT_GRID_TRIES) dropBootGrids();
    }
    return buildGrids(scene, cell, prefix, keepColumns);
  }
  const key = hashOf({ format: 'static-grid-read/1', scene, cell, keepColumns, step: STEP, bodyHeight: BODY_HEIGHT });
  const cached = staticGridReads.get(key);
  if (cached) {
    staticGridReadHits++;
    staticGridReads.delete(key); staticGridReads.set(key, cached);
    return detachedGrids(cached.grids);
  }
  staticGridReadMisses++;
  const grids = buildGrids(scene, cell, prefix, keepColumns), bytes = gridStorageBytes(grids);
  if (bytes <= STATIC_GRID_CACHE_LIMIT / 2) {
    while (staticGridReads.size >= 8 || staticGridReadBytes + bytes > STATIC_GRID_CACHE_LIMIT) {
      const oldest = staticGridReads.keys().next().value!;
      staticGridReadBytes -= staticGridReads.get(oldest)!.bytes; staticGridReads.delete(oldest);
    }
    staticGridReads.set(key, { grids: detachedGrids(grids), bytes }); staticGridReadBytes += bytes;
  }
  return grids;
}

type Lattice = ReturnType<typeof latticeOf>;

function buildLevel(scene: SpatialScene, lv: Level, cell: number, lat: Lattice, pre: StaticRaster | undefined, keepColumns: boolean): LevelGrid {
  const { ox, oz, nx, nz } = lat;
  const free = new Uint8Array(nx * nz);
  const blockers = new BlockerMap(nx * nz);
  stampLevel(scene, lv, cell, lat, pre, free, blockers);
  const cols = new Float64Array(nx * nz);
  const g: LevelGrid = { level: lv.id, y: lv.y, cell, nx, nz, ox, oz, x0: ox * cell, z0: oz * cell, free, clearance: edt(free, nx, nz, cell, cols), blockers };
  if (keepColumns) COLUMNS.set(g, cols);
  return g;
}

/** Cell rectangle [i0, i1, j0, j1] (inclusive). */
type Rect = [number, number, number, number];

/**
 * The per-level raster rule of buildGrids: floor cells from the level's surfaces, then the first
 * listed obstacle in the body band clears each floor cell and names it. With `clip`, only the cells
 * of that rectangle are recomputed (reset, then the same rule over the same list order) — each cell
 * depends only on the items covering it, so the result equals the full raster there.
 */
function stampLevel(scene: SpatialScene, lv: Level, cell: number, lat: Lattice, pre: StaticRaster | undefined, free: Uint8Array, blockers: Map<number, string>, clip?: Rect) {
  const { ox, oz, nx, nz } = lat;
  if (clip) for (let j = clip[2]; j <= clip[3]; j++) for (let i = clip[0], c = j * nx + clip[0]; i <= clip[1]; i++, c++) { free[c] = 0; blockers.delete(c); }
  for (const s of scene.surfaces) if (s.level === lv.id) rasterObb(s.obb, ox, oz, cell, nx, nz, (i) => (free[i] = 1), false, clip);
  if (pre) {
    const cover = pre.firstCover(lv.y);
    const [i0, i1, j0, j1] = clip ?? [0, nx - 1, 0, nz - 1];
    for (let j = j0; j <= j1; j++)
      for (let i = j * nx + i0, e = j * nx + i1; i <= e; i++) if (cover[i] >= 0 && free[i]) { blockers.set(i, pre.obstacles[cover[i]].id); free[i] = 0; }
  }
  for (let k = pre ? pre.obstacles.length : 0; k < scene.obstacles.length; k++) {
    const o = scene.obstacles[k];
    if (o.y1 <= lv.y + STEP || o.y0 >= lv.y + BODY_HEIGHT) continue; // below step height or overhead
    rasterObb(o.obb, ox, oz, cell, nx, nz, (i) => {
      if (free[i]) blockers.set(i, o.id);
      free[i] = 0;
    }, o.raster !== 'centre', clip);
  }
}

/** Column pass (squared vertical distance to the nearest blocked cell) of each LevelGrid built with `keepColumns`. */
const COLUMNS = new WeakMap<LevelGrid, Float64Array>();
/** Grids handed over from a standby's kept set (packed without their column pass): it is recomputed on first use. */
const LAZY_COLUMNS = new WeakSet<LevelGrid>();
function columnsFor(g: LevelGrid): Float64Array | undefined {
  let cols = COLUMNS.get(g);
  if (!cols && LAZY_COLUMNS.has(g)) { cols = columnsOf(g.free, g.nx, g.nz); COLUMNS.set(g, cols); LAZY_COLUMNS.delete(g); }
  return cols;
}

/** Grid-relevant identity of an obstacle / surface (what the raster reads). */
const obstacleKey = (o: Obstacle) => `${o.id}|${o.obb.c[0]},${o.obb.c[1]},${o.obb.half[0]},${o.obb.half[1]},${o.obb.yaw}|${o.y0},${o.y1}${o.raster ? `|${o.raster}` : ''}`;
const surfaceKey = (s: Surface) => `${s.id}|${s.level}|${s.obb.c[0]},${s.obb.c[1]},${s.obb.half[0]},${s.obb.half[1]},${s.obb.yaw}`;

/** Items only in `a` or only in `b` by key; null when keys repeat or the shared items changed relative order. */
function diffByKey<T>(a: T[], b: T[], key: (x: T) => string, ordered: boolean): { gone: T[]; added: T[] } | null {
  const ka = a.map(key), kb = b.map(key);
  const sa = new Set(ka), sb = new Set(kb);
  if (sa.size !== ka.length || sb.size !== kb.length) return null;
  if (ordered) {
    const ca = ka.filter((k) => sb.has(k)), cb = kb.filter((k) => sa.has(k));
    for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return null;
  }
  return { gone: a.filter((_, i) => !sb.has(ka[i])), added: b.filter((_, i) => !sa.has(kb[i])) };
}

/**
 * `buildGrids(scene, cell, prefix, true)` computed from the grids of the previous scene, touching
 * only what changed (bit-identical free / clearance / blockers; engine/test/grid-incremental.test.ts).
 * Both scenes must lead with `prefix`'s obstacles. Obstacles and surfaces are diffed by id + raster
 * geometry; each level re-rasterises the cell rectangles of the changed items only, then patches the
 * clearance (patchClearance). A new level, or a level whose height moved, is built in full; an
 * untouched level is reused as is. Returns null (caller rebuilds) if the diff is not a pure add /
 * remove: repeated keys or reordered shared obstacles (the first cover names the blocker).
 */
export function updateGrids(prev: GridSet, prevScene: SpatialScene, scene: SpatialScene, cell: number, prefix?: StaticRaster): GridSet | null {
  if (prev.cell !== cell || prevScene.bounds.some((b, k) => b !== scene.bounds[k])) return null;
  const pre = prefix?.fits(scene, cell) ? prefix : undefined;
  if (!pre !== !prefix?.fits(prevScene, cell)) return null;
  if (new Set(scene.levels.map((l) => l.id)).size !== scene.levels.length) return null;
  const p = pre ? pre.obstacles.length : 0;
  const obs = diffByKey(prevScene.obstacles.slice(p), scene.obstacles.slice(p), obstacleKey, true);
  const surf = diffByKey(prevScene.surfaces, scene.surfaces, surfaceKey, false);
  if (!obs || !surf) return null;
  const sceneLat = latticeOf(scene.bounds, cell);
  const changedObs = [...obs.gone, ...obs.added], changedSurf = [...surf.gone, ...surf.added];
  const levels = new Map<number, LevelGrid>();
  for (const lv of scene.levels) {
    const old = prev.levels.get(lv.id), lat = levelLattice(scene, lv, cell, sceneLat), { ox, oz, nx, nz } = lat, lvPre = lv.crop ? undefined : pre;
    if (!old || old.y !== lv.y || old.nx !== nx || old.nz !== nz || old.ox !== ox || old.oz !== oz) {
      levels.set(lv.id, buildLevel(scene, lv, cell, lat, lvPre, true));
      continue;
    }
    const rects: Rect[] = [];
    for (const s of changedSurf) if (s.level === lv.id) pushRect(rects, obbRange(s.obb, ox, oz, cell, nx, nz));
    for (const o of changedObs) if (!(o.y1 <= lv.y + STEP || o.y0 >= lv.y + BODY_HEIGHT)) pushRect(rects, obbRange(o.obb, ox, oz, cell, nx, nz));
    if (!rects.length) {
      levels.set(lv.id, old);
      continue;
    }
    const free = old.free.slice(), blockers = copyBlockers(old.blockers, nx * nz);
    for (const r of rects) stampLevel(scene, lv, cell, lat, lvPre, free, blockers, r);
    let ci0 = nx, ci1 = -1, cj0 = nz, cj1 = -1; // bounding box of cells whose free bit flipped
    for (const [i0, i1, j0, j1] of rects)
      for (let j = j0; j <= j1; j++)
        for (let i = i0, c = j * nx + i0; i <= i1; i++, c++)
          if (free[c] !== old.free[c]) { if (i < ci0) ci0 = i; if (i > ci1) ci1 = i; if (j < cj0) cj0 = j; if (j > cj1) cj1 = j; }
    const cols = columnsFor(old) ?? columnsOf(old.free, nx, nz);
    const g: LevelGrid = { ...old, free, blockers };
    if (ci1 >= 0) {
      const patched = patchClearance(old, free, cols, [ci0, ci1, cj0, cj1]);
      g.clearance = patched.clearance;
      COLUMNS.set(g, patched.cols);
    } else COLUMNS.set(g, cols);
    levels.set(lv.id, g);
  }
  return { cell, levels };
}

/** Writable copy of a blockers map (a BlockerMap copies its cell table). */
function copyBlockers(b: Map<number, string>, n: number): Map<number, string> {
  if (b instanceof BlockerMap) return b.copy();
  const out = new BlockerMap(n);
  for (const [i, id] of b) out.set(i, id);
  return out;
}

function pushRect(rects: Rect[], r: Rect) {
  if (r[0] <= r[1] && r[2] <= r[3]) rects.push(r);
}

function columnsOf(free: Uint8Array, nx: number, nz: number): Float64Array {
  const cols = new Float64Array(nx * nz);
  edtColumns(free, nx, nz, cols, 0, nx - 1);
  return cols;
}

/**
 * Exact clearance of `free` given the previous grid `old` (its clearance and column pass `cols`),
 * where every cell whose free bit differs lies in `box` = [i0, i1, j0, j1].
 *
 * Columns: only columns i0..i1 changed, so the column pass is redone there (full height) and kept
 * elsewhere. Rows: a cell p outside B_r = box grown by r cells keeps its distance if its old
 * distance d(p) < dist(p, box) — its old nearest blocked cell was not freed, and every newly
 * blocked cell is farther. d is 1-Lipschitz and the square B_r contains the Euclidean r-offset of
 * the box, so d(p) ≤ M + |p − p'| < r + |p − p'| ≤ dist(p, box), where p' is the projection of p
 * onto B_r's boundary and M the largest old distance on that boundary: it suffices that M < r.
 * r grows until it holds, then the row pass is redone (full width, exact) on B_r's rows only.
 * The squared distances are exact integers, so the result is bit-identical to a full EDT.
 */
function patchClearance(old: LevelGrid, free: Uint8Array, oldCols: Float64Array, box: Rect): { clearance: Float32Array; cols: Float64Array } {
  const { nx, nz, cell } = old;
  const [i0, i1, j0, j1] = box;
  const cols = oldCols.slice();
  edtColumns(free, nx, nz, cols, i0, i1);
  // old distance in cells from the stored clearance (float32), rounded up so the bound stays safe
  const d = (c: number) => (old.free[c] ? (old.clearance[c] / cell + 0.5) * (1 + 1e-5) + 1e-6 : 0);
  let r = 1;
  while (j0 - r > 0 || j1 + r < nz - 1) {
    const a0 = Math.max(0, i0 - r), a1 = Math.min(nx - 1, i1 + r), b0 = Math.max(0, j0 - r), b1 = Math.min(nz - 1, j1 + r);
    let m = 0;
    if (j0 - r >= 0) for (let i = a0; i <= a1; i++) m = Math.max(m, d((j0 - r) * nx + i));
    if (j1 + r < nz) for (let i = a0; i <= a1; i++) m = Math.max(m, d((j1 + r) * nx + i));
    if (i0 - r >= 0) for (let j = b0; j <= b1; j++) m = Math.max(m, d(j * nx + i0 - r));
    if (i1 + r < nx) for (let j = b0; j <= b1; j++) m = Math.max(m, d(j * nx + i1 + r));
    if (m < r) break;
    r = Math.max(r + 1, Math.ceil(m));
  }
  const clearance = old.clearance.slice();
  edtRows(free, cols, nx, cell, clearance, Math.max(0, j0 - r), Math.min(nz - 1, j1 + r));
  return { clearance, cols };
}

/**
 * `base` (built by buildGrids from some scene) with `extra` obstacles appended to that scene.
 * Bit-identical to rebuilding: obstacles only ever clear cells, so copy the base rasters, stamp
 * the extras with the same rule and order, and redo the exact EDT — windowed (patchClearance) when
 * the base level kept its column pass (Spatial's synced grids), in full otherwise. Rasterising the
 * base obstacles (thousands on the campus) dominates buildGrids; this skips it.
 */
export function gridsWithObstacles(base: GridSet, extra: Obstacle[]): GridSet {
  const levels = new Map<number, LevelGrid>();
  for (const [id, g] of base.levels) {
    let free: Uint8Array | null = null;
    let blockers = g.blockers;
    let ci0 = g.nx, ci1 = -1, cj0 = g.nz, cj1 = -1;
    for (const o of extra) {
      if (o.y1 <= g.y + STEP || o.y0 >= g.y + BODY_HEIGHT) continue;
      rasterObb(o.obb, g.ox, g.oz, g.cell, g.nx, g.nz, (i) => {
        if (!(free ?? g.free)[i]) return;
        if (!free) { free = g.free.slice(); blockers = copyBlockers(g.blockers, g.nx * g.nz); }
        blockers.set(i, o.id);
        free[i] = 0;
        const ci = i % g.nx, cj = (i - ci) / g.nx;
        if (ci < ci0) ci0 = ci; if (ci > ci1) ci1 = ci; if (cj < cj0) cj0 = cj; if (cj > cj1) cj1 = cj;
      }, o.raster !== 'centre');
    }
    if (!free) { levels.set(id, g); continue; }
    const cols = columnsFor(g);
    const clearance = cols ? patchClearance(g, free, cols, [ci0, ci1, cj0, cj1]).clearance : edt(free, g.nx, g.nz, g.cell);
    levels.set(id, { ...g, free, blockers, clearance });
  }
  return { cell: base.cell, levels };
}

/** The cell rectangle rasterObb scans for `o` (may be empty: i0 > i1 or j0 > j1); a superset of the covered cells. */
export function obbRange(o: OBB2, ox: number, oz: number, cell: number, nx: number, nz: number): Rect {
  const cs = obbCorners(o);
  let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
  for (const [x, z] of cs) { ax = Math.min(ax, x); az = Math.min(az, z); bx = Math.max(bx, x); bz = Math.max(bz, z); }
  return [Math.max(0, latticeIndex(ax, cell) - ox), Math.min(nx - 1, latticeIndex(bx, cell) + 1 - ox), Math.max(0, latticeIndex(az, cell) - oz), Math.min(nz - 1, latticeIndex(bz, cell) + 1 - oz)];
}

/**
 * Visit cells covered by the OBB. `conservative` (obstacles): every cell the OBB
 * touches, so thin panels are never lost between cell centres. Otherwise
 * (floors): only cells whose centre lies inside, so floors never grow.
 * `clip` restricts the visit to a cell rectangle (same per-cell test).
 */
export function rasterObb(o: OBB2, ox: number, oz: number, cell: number, nx: number, nz: number, fn: (i: number) => void, conservative = false, clip?: Rect) {
  let [i0, i1, j0, j1] = obbRange(o, ox, oz, cell, nx, nz);
  if (clip) { i0 = Math.max(i0, clip[0]); i1 = Math.min(i1, clip[1]); j0 = Math.max(j0, clip[2]); j1 = Math.min(j1, clip[3]); }
  if (i0 > i1 || j0 > j1) return;
  // conservative: obbOverlap(o, the cell's box) with o's corners and the axes computed once (same answers, engine P4)
  const overlaps = conservative ? obbOverlapAt(o, [cell / 2 - 1e-9, cell / 2 - 1e-9], 0) : null;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const p: Vec2 = [latticeCentre(ox + i, cell), latticeCentre(oz + j, cell)];
      if (overlaps ? overlaps(p) : pointInObb(p, o, 1e-9)) fn(j * nx + i);
    }
}

const INF = 1e20;

/** Felzenszwalb–Huttenlocher 1-D lower envelope: d[q] = min_p (q − p)² + f[p] over q < len. */
function envelope(f: Float64Array, d: Float64Array, v: Int32Array, zb: Float64Array, len: number) {
  let k = 0;
  v[0] = 0; zb[0] = -INF; zb[1] = INF;
  for (let q = 1; q < len; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= zb[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; zb[k] = s; zb[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < len; q++) { while (zb[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

const scratch = (n: number) => ({ f: new Float64Array(n), d: new Float64Array(n), v: new Int32Array(n), zb: new Float64Array(n + 1) });

/** Column pass for columns i0..i1: g = squared distance (cells) to the nearest blocked cell in the column; blocked pads at j = −1 and nz. */
function edtColumns(free: Uint8Array, nx: number, nz: number, g: Float64Array, i0: number, i1: number) {
  const { f, d, v, zb } = scratch(nz + 2);
  const len = nz + 2;
  for (let i = i0; i <= i1; i++) {
    f[0] = 0; f[len - 1] = 0;
    for (let j = 0; j < nz; j++) f[j + 1] = free[j * nx + i] ? INF : 0;
    envelope(f, d, v, zb, len);
    for (let j = 0; j < nz; j++) g[j * nx + i] = d[j + 1];
  }
}

/** Row pass for rows j0..j1 over the column pass g (pads at i = −1 and nx), written as metres into `out`. */
function edtRows(free: Uint8Array, g: Float64Array, nx: number, cell: number, out: Float32Array, j0: number, j1: number) {
  const { f, d, v, zb } = scratch(nx + 2);
  const len = nx + 2;
  for (let j = j0; j <= j1; j++) {
    f[0] = 0; f[len - 1] = 0;
    for (let i = 0; i < nx; i++) f[i + 1] = g[j * nx + i];
    envelope(f, d, v, zb, len);
    // distance from centre to nearest blocked *centre*, minus half a cell ≈ distance to blocked cell edge
    for (let i = 0; i < nx; i++) out[j * nx + i] = free[j * nx + i] ? Math.max(0, Math.sqrt(d[i + 1]) * cell - cell / 2) : 0;
  }
}

/** Felzenszwalb–Huttenlocher exact squared EDT, returned as metres. Out-of-grid counts as blocked. `g` receives the column pass. */
export function edt(free: Uint8Array, nx: number, nz: number, cell: number, g = new Float64Array(nx * nz)): Float32Array {
  edtColumns(free, nx, nz, g, 0, nx - 1);
  const out = new Float32Array(nx * nz);
  edtRows(free, g, nx, cell, out, 0, nz - 1);
  return out;
}

/** World point → cell index of `g` (−1 outside). Origin-independent: the lattice cell of p, offset by (ox, oz). */
export const cellOf = (g: LevelGrid, p: Vec2) => {
  const i = latticeIndex(p[0], g.cell) - g.ox, j = latticeIndex(p[1], g.cell) - g.oz;
  return i < 0 || j < 0 || i >= g.nx || j >= g.nz ? -1 : j * g.nx + i;
};
/** Centre of cell (i, j) of `g`: the lattice centre, bit-identical in every grid containing that cell. */
export const cellCentre = (g: LevelGrid, i: number, j: number): Vec2 => [latticeCentre(g.ox + i, g.cell), latticeCentre(g.oz + j, g.cell)];
export const centreOf = (g: LevelGrid, idx: number): Vec2 => cellCentre(g, idx % g.nx, Math.floor(idx / g.nx));

/** Bilinear-free clearance lookup at a point (cell sample). Outside grid → 0. */
export function clearanceAt(g: LevelGrid, p: Vec2): number {
  const c = cellOf(g, p);
  return c < 0 ? 0 : g.clearance[c];
}

/** #1070: what `p` will read from `o` alone once `o` stands: its conservative raster and edt's own expression, so it matches
 *  the clearance a rebuild gives, not the exact distance. Infinity when `o` touches no cell of this grid. */
export function clearanceFromObb(g: LevelGrid, o: OBB2, p: Vec2): number {
  const c = cellOf(g, p); if (c < 0) return 0;
  const ci = c % g.nx, cj = Math.floor(c / g.nx); let best = Infinity;
  rasterObb(o, g.ox, g.oz, g.cell, g.nx, g.nz, (i) => { const dx = i % g.nx - ci, dz = Math.floor(i / g.nx) - cj, d = dx * dx + dz * dz; if (d < best) best = d; }, true);
  return best === Infinity ? Infinity : Math.fround(Math.max(0, Math.sqrt(best) * g.cell - g.cell / 2));
}

/** Minimum clearance sampled along a segment (step ≤ half a cell). */
export function segmentClearance(g: LevelGrid, a: Vec2, b: Vec2): number {
  const len = hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  let m = Infinity;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const c = clearanceAt(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (c < m) m = c;
    if (m <= 0) break;
  }
  return m;
}

/** Nearest blocker id around a point (diagnostics: "blocked by east wall"). */
export function nearestBlocker(g: LevelGrid, p: Vec2, radius = 1.5): string | undefined {
  const c = cellOf(g, p);
  if (c < 0) return undefined;
  const r = Math.ceil(radius / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  let best: string | undefined, bd = Infinity;
  for (let j = Math.max(0, cj - r); j <= Math.min(g.nz - 1, cj + r); j++)
    for (let i = Math.max(0, ci - r); i <= Math.min(g.nx - 1, ci + r); i++) {
      const id = g.blockers.get(j * g.nx + i);
      if (id) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = id; } }
    }
  return best;
}
