// Lane PERF-STREAM (2026-11-02): which things are built, by distance from the camera. A world ten times Eden's size
// (50,000 things) cannot be drawn whole: the viewer builds only the things within `inner` metres of the camera and
// drops those beyond `outer` (hysteresis: a thing on the edge is never built and dropped every frame). Entries are
// kept in a grid of `cell` m cells, so an update around a point touches a few cells, not the world. Pure: no three.js,
// no DOM (unit tests: StreamRing.test.ts). WorldEntityLayer feeds it every root thing's pose (a building's furniture
// shares its building's entry) and asks it what to build or unload when the camera has moved.
export type RingEntry = { id: string; x: number; z: number; r: number; cell: Cell; wanted: boolean; pinned: boolean };
type Cell = { key: string; x0: number; z0: number; x1: number; z1: number; entries: Set<RingEntry>; maxR: number };
export type RingOptions = { inner: number; outer: number; cell?: number; /** the camera must move this far for `update` to re-evaluate (0: always). */ step?: number };

const rectDistance = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));

export class StreamRing {
  readonly inner: number;
  readonly outer: number;
  readonly cell: number;
  readonly step: number;
  private readonly entries = new Map<string, RingEntry>();
  private readonly cells = new Map<string, Cell>();
  private readonly wantedSet = new Set<string>();
  /** The last centre `update` evaluated around (null before the first). */
  centre: { x: number; z: number } | null = null;
  constructor(opts: RingOptions) {
    if (!(opts.outer >= opts.inner) || !(opts.inner > 0)) throw new Error(`StreamRing: outer (${opts.outer}) must be at least inner (${opts.inner}) > 0`);
    this.inner = opts.inner; this.outer = opts.outer; this.cell = opts.cell ?? 96; this.step = opts.step ?? Math.max(4, this.inner / 32);
  }
  get size() { return this.entries.size; }
  get wanted(): ReadonlySet<string> { return this.wantedSet; }
  has(id: string) { return this.entries.has(id); }
  isWanted(id: string) { return this.wantedSet.has(id); }
  entry(id: string): Readonly<RingEntry> | undefined { return this.entries.get(id); }

  /** Add or move a thing: its centre and the radius its picture reaches from it (a road's or wood's shape: half its
   *  diagonal). A moved thing keeps its wanted state until the next `update` (or `probe`). A pinned thing is always
   *  wanted (Souls' bodies, world-wide builders, the arrival spot). */
  set(id: string, x: number, z: number, r = 0, pinned = false) {
    let e = this.entries.get(id);
    if (e) {
      if (e.x === x && e.z === z && e.r === r && e.pinned === pinned) return;
      e.cell.entries.delete(e); e.x = x; e.z = z; e.r = r; e.pinned = pinned;
    } else { e = { id, x, z, r, cell: null as unknown as Cell, wanted: false, pinned }; this.entries.set(id, e); }
    const cell = this.cellAt(x, z); cell.entries.add(e); cell.maxR = Math.max(cell.maxR, r); e.cell = cell;
  }
  delete(id: string) {
    const e = this.entries.get(id); if (!e) return;
    e.cell.entries.delete(e); if (!e.cell.entries.size) this.cells.delete(e.cell.key);
    this.entries.delete(id); this.wantedSet.delete(id);
  }
  clear() { this.entries.clear(); this.cells.clear(); this.wantedSet.clear(); this.centre = null; }

  /** Whether a thing is within `inner` of the last centre (a thing that just arrived in a diff: build it now or not); it
   *  becomes wanted when it is. Unknown things and no centre yet: false. */
  probe(id: string): boolean {
    const e = this.entries.get(id); if (!e) return false;
    if (e.wanted) return true;
    if (!this.centre) return false;
    if (e.pinned || this.distance(e, this.centre.x, this.centre.z) <= this.inner) { e.wanted = true; this.wantedSet.add(id); return true; }
    return false;
  }
  /** Things within `distance` of a point, nearest first (diagnostics, tests). */
  within(x: number, z: number, distance: number): string[] {
    const out: [number, string][] = [];
    for (const cell of this.cells.values()) {
      if (rectDistance(x, z, cell.x0, cell.z0, cell.x1, cell.z1) - cell.maxR > distance) continue;
      for (const e of cell.entries) { const d = this.distance(e, x, z); if (d <= distance) out.push([d, e.id]); }
    }
    return out.sort((a, b) => a[0] - b[0]).map(([, id]) => id);
  }

  /** Re-evaluate around the camera. `enter`: things now wanted that were not (nearest first: build them in this order);
   *  `leave`: things that were wanted and are now beyond `outer` (unload them). Nothing happens (empty lists) when the
   *  camera has moved less than `step` since the last evaluation, unless `force`. */
  update(x: number, z: number, force = false): { enter: string[]; leave: string[] } {
    const enter: [number, string][] = [], leave: string[] = [];
    if (!force && this.centre && Math.hypot(x - this.centre.x, z - this.centre.z) < this.step) return { enter: [], leave };
    this.centre = { x, z };
    for (const cell of this.cells.values()) {
      const near = rectDistance(x, z, cell.x0, cell.z0, cell.x1, cell.z1) - cell.maxR;
      if (near > this.outer) {   // the whole cell is out: drop what it had
        for (const e of cell.entries) { if (e.pinned) { if (!e.wanted) { e.wanted = true; this.wantedSet.add(e.id); enter.push([0, e.id]); } } else if (e.wanted) { e.wanted = false; this.wantedSet.delete(e.id); leave.push(e.id); } }
        continue;
      }
      for (const e of cell.entries) {
        if (e.pinned) { if (!e.wanted) { e.wanted = true; this.wantedSet.add(e.id); enter.push([0, e.id]); } continue; }
        const d = this.distance(e, x, z);
        if (e.wanted) { if (d > this.outer) { e.wanted = false; this.wantedSet.delete(e.id); leave.push(e.id); } }
        else if (d <= this.inner) { e.wanted = true; this.wantedSet.add(e.id); enter.push([d, e.id]); }
      }
    }
    enter.sort((a, b) => a[0] - b[0]);
    return { enter: enter.map(([, id]) => id), leave };
  }

  private distance(e: RingEntry, x: number, z: number) { return Math.max(0, Math.hypot(e.x - x, e.z - z) - e.r); }
  private cellAt(x: number, z: number): Cell {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell), key = `${cx},${cz}`;
    let c = this.cells.get(key);
    if (!c) { c = { key, x0: cx * this.cell, z0: cz * this.cell, x1: (cx + 1) * this.cell, z1: (cz + 1) * this.cell, entries: new Set(), maxR: 0 }; this.cells.set(key, c); }
    return c;
  }
}

/** The terrain sectors (keys `sx,sz` of `sectorM` m squares) within `radius` of a point, nearest first, clipped to the
 *  ground's extent; and whether a sector is beyond `radius` (to drop it). Shared by the layer's sector streaming. */
export function sectorsWithin(x: number, z: number, radius: number, sectorM: number, extent: readonly [number, number, number, number]): string[] {
  const [bx0, bz0, bx1, bz1] = extent;
  const sx0 = Math.floor(bx0 / sectorM), sx1 = Math.ceil(bx1 / sectorM) - 1, sz0 = Math.floor(bz0 / sectorM), sz1 = Math.ceil(bz1 / sectorM) - 1;
  const out: [number, string][] = [];
  for (let sz = Math.max(sz0, Math.floor((z - radius) / sectorM)); sz <= Math.min(sz1, Math.floor((z + radius) / sectorM)); sz++)
    for (let sx = Math.max(sx0, Math.floor((x - radius) / sectorM)); sx <= Math.min(sx1, Math.floor((x + radius) / sectorM)); sx++) {
      const d = rectDistance(x, z, sx * sectorM, sz * sectorM, (sx + 1) * sectorM, (sz + 1) * sectorM);
      if (d <= radius) out.push([d, `${sx},${sz}`]);
    }
  return out.sort((a, b) => a[0] - b[0]).map(([, k]) => k);
}
export function sectorDistance(key: string, x: number, z: number, sectorM: number): number {
  const [sx, sz] = key.split(',').map(Number);
  return rectDistance(x, z, sx * sectorM, sz * sectorM, (sx + 1) * sectorM, (sz + 1) * sectorM);
}
