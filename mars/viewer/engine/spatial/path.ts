// Global route planning (spec §10): multi-level A* over clearance grids with
// explicit contextual links (stairs) — the Recast/Detour "navmesh + off-mesh
// connection" pattern expressed on rasters. Routes are corridors: polylines
// whose every segment has a guaranteed clearance ≥ agent radius, so the mover
// can smooth inside them and never needs collision sliding to make progress.
import { add2, dist2, pointInObb, rot2, sub2, type Vec2, hypot } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import { cellOf, centreOf, gridContentKeys, latticeCentre, nearestBlocker, segmentClearance, type GridSet, type LevelGrid } from './grid.ts';
import type { AgentProfile, Link, SpatialScene } from './types.ts';

export type Place = { level: number; p: Vec2 };
export type WalkLeg = { kind: 'walk'; level: number; points: Vec2[]; minClearance: number };
export type LinkLeg = { kind: 'link'; link: Link; ascending: boolean };
export type Leg = WalkLeg | LinkLeg;
/** `rest` (paged ground worlds only, spatial/tiled.ts pagedRoute): the route is a first chunk; the walk goes on to `rest`. */
export type Route = { legs: Leg[]; length: number; expanded: number; rest?: Place };
export type RouteResult = { ok: true; route: Route } | { ok: false; diagnostic: Diagnostic };

const SQ2 = Math.SQRT2;
export const PLAN_MARGIN = 0.06; // m
const COMFORT = 0.9; // m of clearance beyond which there is no wall penalty
const WALL_PENALTY = 1.2;

type LinkEdge = { link: Link; ascending: boolean; toLevel: number; toCell: number; cost: number; approach: Vec2 };

/** Where to stand before traversing a link, facing along its heading (no side entry). */
export function linkApproach(link: Link, ascending: boolean, back = 0.7): { entry: Place; approach: Vec2; exit: Place } {
  const dir = rot2([1, 0], link.heading), own = ascending ? link.approach?.from : link.approach?.to;
  if (ascending) return { entry: link.from, approach: own ?? sub2(link.from.p, [dir[0] * back, dir[1] * back]), exit: link.to };
  return { entry: link.to, approach: own ?? add2(link.to.p, [dir[0] * back, dir[1] * back]), exit: link.from };
}

export type RouteOpts = {
  goalTolerance?: number;
  allowUnusableLinks?: boolean;
  maxExpand?: number;
  /**
   * 'exact' (default): full-grid A*. 'corridor': coarse-to-fine — A* on a 0.5 m max-clearance grid
   * picks a corridor, then the same fine A* runs restricted to cells within CORRIDOR_HALO of it;
   * any failure falls back to the exact search (so failures and their diagnostics are identical).
   * Faster on long routes but NOT guaranteed to return the exact route (docs/engineering/PLANNING_BUDGET.md).
   */
  planner?: 'exact' | 'corridor';
  /**
   * Early exit for failing searches (people-avoidance replans, `Spatial.routeAround`): a reverse flood
   * from the goal runs alongside the A*, one cell per expansion. If it runs out of cells without meeting
   * the start, the goal is unreachable and the search returns the same `null` (→ the same diagnostic) the
   * full expansion would have, without expanding the start's whole component. Only when the grid has no
   * more cells than `maxExpand` (so 'route.search-limit' cannot be the answer). Results are identical
   * with or without it (engine/test/walk-perf.test.ts).
   */
  proveUnreachable?: boolean;
  /**
   * A failure is normally explained by a second, successful search with unusable links allowed
   * ('route.link-unusable' naming the unfinished stairs it would need). With this predicate, that
   * search runs only if some unusable link of the scene passes it; otherwise the failure stays
   * 'route.unreachable'. For callers that only read the named links (the walker's people-avoidance
   * replan compares them with its obstacle ids): pass the ids they compare against.
   */
  explainUnusable?: (linkId: string) => boolean;
  /**
   * Name the temporary obstacles behind a failure (`Spatial.routeAround` passes its people / load ids):
   * scene obstacles passing this predicate are added, sorted, to the diagnostic's `subjects` when they
   * - crowd the start (route.start-blocked) or the goal (route.goal-blocked) within the snap distance;
   * - border the region the failed search exhausted (route.unreachable / route.link-unusable): the start's
   *   side, or the goal's side when `proveUnreachable` ran out first, i.e. the people walling it in;
   * - stand at the foot of a stair whose far end lies in that region (the link was dropped because its
   *   approach had no room).
   * A structural failure (geometry, an unfinished stair) names none of them. Routes are unaffected.
   */
  nameObstacles?: (id: string) => boolean;
  /**
   * How far (m) the start may snap to the nearest standable cell (default 0.5). The nearest cell is the
   * same whatever the tolerance whenever one lies within it, so a larger value only turns some
   * 'route.start-blocked' failures into routes (`Spatial.routeAround`: a walker standing in a gap between
   * people steps out of it first).
   */
  startTolerance?: number;
  /**
   * route-reach/1 (#872, prospective runtime policy `routeReachV1`; absent on every earlier history): the paged planner
   * retries a hop the fine search could not finish on a window one ground tile wider before refusing, and plans a far
   * walk from an upper floor down to the ground a chunk at a time instead of refusing it `ground.too-far`.
   */
  routeReachV1?: boolean;
};

/** Corridor planner: coarse cell size (m) and fine-search halo around the coarse path (m). */
export const CORRIDOR_CELL = 0.5;
export const CORRIDOR_HALO = 1.5;

/** A link direction prepare() dropped for lack of room at its approach (recorded only with `nameObstacles`). */
type Dropped = { level: number; at: Vec2[]; farLevel: number; far: Vec2 };
/**
 * Search ids: level index k's cell c is B[k] + c (B = running sum of the level grids' cell counts). Levels of one GridSet
 * may cover different extents of the global lattice (L1: a paged window's upper floors span their own floors, not the
 * window), so a search's workspace is the levels' cells, not levels × the ground's. Equal-sized levels give B[k] = k·N,
 * the ids as before. `fullTotal` = levels × the first level's cells (what the old layout spanned) keeps the size-gated
 * choices (reverse flood, failed-search memo) exactly as they were.
 */
type Layout = { B: number[]; Ns: number[]; total: number; fullTotal: number };
function layoutOf(grids: GridSet, lvIds: number[]): Layout {
  const B: number[] = [], Ns: number[] = [];
  let total = 0;
  for (const id of lvIds) { const g = grids.levels.get(id)!, n = g.nx * g.nz; B.push(total); Ns.push(n); total += n; }
  return { B, Ns, total, fullTotal: lvIds.length * (Ns[0] ?? 0) };
}
/** The level index of search id `id` (`hint`: a likely index, e.g. the last one). */
function lvOf(L: Layout, id: number, hint = 0): number {
  const { B, Ns } = L;
  if (id >= B[hint] && id < B[hint] + Ns[hint]) return hint;
  let lo = 0, hi = B.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (B[m] <= id) lo = m; else hi = m - 1; }
  return lo;
}
type Prep = Layout & { r: number; lvIds: number[]; idxOf: Map<number, number>; gs: LevelGrid; gg: LevelGrid; sLv: number; gLv: number; s: number; gt: number; edges: Map<number, LinkEdge[]>; dropped?: Dropped[] };
type Found = { goalId: number; chain: number[]; viaLink: Map<number, LinkEdge>; expanded: number };

export function findRoute(grids: GridSet, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts = {}): RouteResult {
  const prep = prepare(grids, scene, profile, start, goal, opts);
  if ('ok' in prep) return prep;
  if (opts.planner === 'corridor') {
    const r = corridorRoute(grids, scene, profile, start, goal, opts, prep);
    if (r) return r;
  }
  const found = search(grids, prep, opts, null);
  if (!found) {
    const { r } = prep;
    // (before any other search reuses the scratch the failed one left its region in)
    const named = opts.nameObstacles ? regionObstacles(grids, scene, prep, opts.nameObstacles) : [];
    if (!opts.allowUnusableLinks && scene.links.some((l) => !l.usable && (!opts.explainUnusable || opts.explainUnusable(l.id)))) {
      const alt = findRoute(grids, scene, profile, start, goal, { ...opts, allowUnusableLinks: true, planner: 'exact' });
      if (alt.ok) {
        const needed = alt.route.legs.filter((l): l is LinkLeg => l.kind === 'link' && !l.link.usable).map((l) => l.link);
        return fail(
          'route.link-unusable',
          `no usable route: it would require ${needed.map((l) => `${l.kind} ${l.id} (${l.reason ?? 'not usable'})`).join(', ')}`,
          goal,
          [...needed.map((l) => l.id), ...named],
        );
      }
    }
    const by = named.length ? ` (walled in by ${named.join(', ')})` : '';
    return fail('route.unreachable', `no route from level ${start.level} (${fmt(start.p)}) to level ${goal.level} (${fmt(goal.p)}) for a ${r} m-radius agent${by}`, goal, named.length ? named : undefined);
  }
  if ('ok' in found) return found;
  return assemble(grids, prep, start, goal, found, found.expanded);
}

/**
 * The planner's test for one link edge (prepare): may a body (planning radius r, body radius `radius`) leave grid `ge` by
 * this link end and arrive on grid `gx`? `ca` = the approach cell on ge, `cx` = the standing cell it lands on (snapped
 * within 0.4 m of the far end's approach). Shared with the connectivity audit (connectivity.ts): both read links alike.
 */
export function linkEdgeTest(link: Link, ascending: boolean, ge: LevelGrid, gx: LevelGrid, r: number, radius: number): { ok: boolean; ca: number; cx: number; approach: Vec2; far: Vec2 } {
  const own = linkApproach(link, ascending), entry = own.entry;
  const far = linkApproach(link, !ascending).approach;
  let approach = own.approach, ca = cellOf(ge, approach);
  const cx = snap(gx, far, r, 0.4);
  // An approach point whose own cell is short of room departs from the roomiest-nearest standing cell next to it (one
  // cell, 0.15 m) instead (lane RAIL): a stair head in a corridor at 45 deg to the grid has a ridge of cells with room
  // one cell wide, so a point on the corridor's centre line can fall on a cell beside it (hillside-home-1: 0.31 m where
  // 0.34 is needed) and the way down was refused while arriving, which snaps within 0.4 m, was not: one-way upstairs.
  // A cell with room keeps its point, so every link that passed before is read exactly as before.
  // The same goes for a stair foot in an alcove (lane WALK2): the point 0.7 m back from eden-house-3/4's kitchen stairs
  // falls 0.2 m off the stove beside the flight (0.15 m of room) while the alcove's middle has 0.7 m, so the stairs were
  // never climbed. Departure searches within 0.4 m, as arrival snaps (cx); the approach-to-entry segment test still holds.
  if (ca >= 0 && ge.clearance[ca] < r) { const s = snap(ge, approach, r, 0.4); if (s >= 0) { ca = s; approach = centreOf(ge, s); } }
  // Leaving a level by a link: the approach-to-entry segment needs room for the body itself. Arriving by the same link
  // only snaps to standing room near the far approach (cx), so a stricter departure test (0.9 x the planning radius)
  // let wider bodies climb past furniture beside a stair top and then strand them up there (Eden 2026 tower: top-entry
  // clearance 0.311 m, a 0.289 m body needed 0.314). Body radius on both sides keeps every link reversible.
  // A nearby clear arrival cell cannot excuse a blocked physical landing. The
  // climber reaches exit.p before walking toward that cell; snapping past a table
  // here used to admit a route which collided at the bottom of the flight.
  const bodyClearance = Math.min(r * 0.9, radius);
  const ok = ca >= 0 && ge.clearance[ca] >= r && cx >= 0
    && segmentClearance(ge, approach, entry.p) >= bodyClearance
    && segmentClearance(gx, centreOf(gx, cx), own.exit.p) >= bodyClearance;
  return { ok, ca, cx, approach, far };
}

/** Snap start/goal and build the contextual link edges; a failure is the final diagnostic. */
function prepare(grids: GridSet, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts): Prep | RouteResult {
  // plan with a margin above the body radius: corridor clearance is sampled at cell centres, and
  // the walker's continuous position may sit up to half a cell off them
  const r = profile.radius + PLAN_MARGIN;
  const lvIds = [...grids.levels.keys()].sort((a, b) => a - b);
  const idxOf = new Map(lvIds.map((l, i) => [l, i]));
  const L = layoutOf(grids, lvIds);
  const gs = grids.levels.get(start.level), gg = grids.levels.get(goal.level);
  if (!gs || !gg) return fail('route.unknown-level', `level ${!gs ? start.level : goal.level} does not exist`);
  const s = snap(gs, start.p, r, opts.startTolerance ?? 0.5);
  const near = (g: LevelGrid, p: Vec2, tol: number) => (opts.nameObstacles ? obstaclesNear(scene, g, p, r + tol + grids.cell, opts.nameObstacles) : undefined);
  if (s < 0)
    return fail('route.start-blocked', `start (${fmt(start.p)}) on level ${start.level} is not standable${blk(gs, start.p)}`, start, near(gs, start.p, opts.startTolerance ?? 0.5));
  const gt = snap(gg, goal.p, r, opts.goalTolerance ?? 0.35);
  if (gt < 0)
    return fail('route.goal-blocked', `destination (${fmt(goal.p)}) on level ${goal.level} has no standing room for a ${r} m-radius agent${blk(gg, goal.p)}`, goal, near(gg, goal.p, opts.goalTolerance ?? 0.35));

  // contextual link edges
  const edges = new Map<number, LinkEdge[]>();
  const dropped: Dropped[] | undefined = opts.nameObstacles ? [] : undefined;
  for (const link of scene.links) {
    if (!link.usable && !opts.allowUnusableLinks) continue;
    if (link.width < 2 * r) continue;
    for (const ascending of [true, false]) {
      const { entry, approach, exit } = linkApproach(link, ascending);
      const ge = grids.levels.get(entry.level), gx = grids.levels.get(exit.level);
      if (!ge || !gx) continue;
      const { ok, ca, cx, far, approach: from } = linkEdgeTest(link, ascending, ge, gx, r, profile.radius);
      if (!ok) {
        dropped?.push({ level: entry.level, at: [approach, entry.p], farLevel: exit.level, far });
        continue;
      }
      const len = dist2(from, entry.p) + pathLen(link.path) + dist2(exit.p, centreOf(gx, cx));
      const id = L.B[idxOf.get(entry.level)!] + ca;
      const list = edges.get(id) ?? [];
      list.push({ link, ascending, toLevel: exit.level, toCell: cx, cost: len * 1.25, approach: from });
      edges.set(id, list);
    }
  }
  return { ...L, r, lvIds, idxOf, gs, gg, sLv: idxOf.get(start.level)!, gLv: idxOf.get(goal.level)!, s, gt, edges, dropped };
}

/**
 * The A* core. Search state lives in reused, generation-stamped scratch (no per-call 10 MB
 * allocation + fill): gScore/came of a cell are valid iff stamp === gen, closed iff shut === gen.
 * Unmasked, the expansion order, relaxation arithmetic and heap order (key, then insertion) are
 * exactly the reference A*'s, so routes are bit-identical (engine/test/planning.test.ts vs
 * engine/test/path-reference.ts). `mask` (cells with mask.stamp === mask.gen) restricts the search.
 * Returns null when the goal is unreachable, a diagnostic when the expansion limit is hit.
 */
function search(grids: GridSet, prep: Prep, opts: RouteOpts, mask: { stamp: Uint32Array; gen: number } | null): Found | RouteResult | null {
  const { r, lvIds, idxOf, B, gg, s, gt, edges, sLv, gLv, total } = prep;
  const S = scratchFor(total);
  const gen = S.gen;
  const { gScore, came, pos, stamp, shut } = S;
  const viaLink = new Map<number, LinkEdge>();
  const heap = S.heap;
  heap.reset(pos);
  const Ls = lvIds.map((id) => grids.levels.get(id)!);
  const startId = B[sLv] + s, goalId = B[gLv] + gt;
  const goalC = centreOf(gg, gt);
  const gx0 = goalC[0], gz0 = goalC[1];
  // octile distance from a cell centre to the goal cell centre (same float ops as centreOf)
  const hAt = (g: LevelGrid, i: number, j: number) => {
    const dx = Math.abs(latticeCentre(g.ox + i, g.cell) - gx0), dz = Math.abs(latticeCentre(g.oz + j, g.cell) - gz0);
    return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz);
  };
  const h = (lv: number, c: number) => {
    const g = Ls[lv];
    return hAt(g, c % g.nx, Math.floor(c / g.nx));
  };
  const ms = mask?.stamp, mg = mask?.gen ?? 0;
  const maxExpand = opts.maxExpand ?? 4_000_000;
  const memo = !mask && !opts.nameObstacles ? strandedKey(grids, prep) : null, side = memo ? stranded.get(memo) : undefined;
  if (side && side.size <= maxExpand && !(side.cells[goalId >> 3] & (1 << (goalId & 7)))) { strandedHits++; return null; }
  stamp[startId] = gen;
  gScore[startId] = 0;
  came[startId] = -1;
  heap.push(startId, h(sLv, s), false);
  let expanded = 0;
  const hasEdges = edges.size > 0;
  let rev = opts.proveUnreachable && !mask && startId !== goalId && (prep.fullTotal <= maxExpand || passableCells(Ls, r, maxExpand) <= maxExpand) ? reverseFlood(S, prep, Ls, startId, goalId) : null;
  let lv = 0;
  while (heap.size) {
    if (rev) {
      const st = rev.step();
      if (st < 0) { failRegion = { cells: S.rseen!, gen }; return null; } // the goal's side ran out of cells: the A* could only exhaust the start's side
      if (st > 0) rev = null; // the start can reach the goal: the A* decides as always
    }
    const cur = heap.pop();
    if (shut[cur] === gen) continue; // (a closed cell re-queued by a relaxation, as in the reference)
    shut[cur] = gen;
    if (cur === goalId) break;
    if (++expanded > maxExpand) return fail('route.search-limit', `route search exceeded ${maxExpand} expansions`);
    lv = lvOf(prep, cur, lv);
    const base = B[lv], c = cur - base;
    const g = Ls[lv];
    const nx = g.nx, nz = g.nz, cl = g.clearance, gc = gScore[cur];
    const straight = g.cell, diag = SQ2 * g.cell;
    const ci = c % nx, cj = (c - ci) / nx;
    for (let dj = -1; dj <= 1; dj++) {
      const nj = cj + dj;
      if (nj < 0 || nj >= nz) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di;
        if (ni < 0 || ni >= nx) continue;
        const n = nj * nx + ni;
        const cn = cl[n];
        if (!(cn >= r)) continue;
        if (di && dj && (!(cl[cj * nx + ni] >= r) || !(cl[nj * nx + ci] >= r))) continue; // no corner cutting
        const nid = base + n;
        if (ms && ms[nid] !== mg) continue;
        const w = 1 + (cn < COMFORT ? (WALL_PENALTY * (COMFORT - cn)) / COMFORT : 0);
        const t = gc + (di && dj ? diag : straight) * w;
        const fresh = stamp[nid] !== gen;
        if (fresh || t < gScore[nid]) {
          stamp[nid] = gen;
          gScore[nid] = t;
          came[nid] = cur;
          if (viaLink.size) viaLink.delete(nid);
          heap.push(nid, t + hAt(g, ni, nj), !fresh && pos[nid] >= 0);
        }
      }
    }
    if (!hasEdges) continue;
    for (const e of edges.get(cur) ?? []) {
      const tl = idxOf.get(e.toLevel)!;
      const nid = B[tl] + e.toCell;
      if (ms && ms[nid] !== mg) continue;
      const t = gc + e.cost;
      const fresh = stamp[nid] !== gen;
      if (fresh || t < gScore[nid]) {
        stamp[nid] = gen;
        gScore[nid] = t;
        came[nid] = cur;
        viaLink.set(nid, e);
        heap.push(nid, t + h(tl, e.toCell), !fresh && pos[nid] >= 0);
      }
    }
  }
  if (shut[goalId] !== gen) { failRegion = { cells: shut, gen }; if (memo) remember(memo, shut, gen, total, expanded, prep.fullTotal); return null; }
  const chain: number[] = [];
  for (let id = goalId; id !== -1; id = came[id]) chain.push(id);
  chain.reverse();
  return { goalId, chain, viaLink, expanded };
}

/**
 * Engine P4: the start's side of a failed exhaustive search. An unmasked A* that runs out of cells has closed exactly the
 * cells its start reaches (passability and link edges do not depend on the goal), so a later goal outside that set on the
 * same level grids (by identity, or the content key their builder gave them: grid.ts gridContentKeys), radius, start cell
 * and link edges fails the same way (null) without searching again, as long as that side fits the call's expansion limit. A Soul's capabilities try up to 14 standing points in each room the stairs do not
 * reach (Eden 2026: ~0.8 s each). Grids are never mutated after they are built, so they are told apart by identity.
 */
/**
 * L1: the search can close at most the cells a body of radius r stands on (each expansion closes one; links land on
 * standing room), so when they number no more than `maxExpand`, 'route.search-limit' cannot be the answer either and
 * the reverse flood is as exact as on a small grid. A paged window over a canal-row house has 11 floors, ~4.4 M cells
 * (over the limit) of which ~1.4 M are standing room. Counted once per grid content (grids are never mutated), up to `cap`.
 */
const PASSABLE_KEEP = 64;
const passableOf = new Map<string, number>();
function passableCells(Ls: LevelGrid[], r: number, cap: number): number {
  let n = 0;
  for (const g of Ls) {
    const key = `${serialOf(g)}|${r}`;
    let k = passableOf.get(key);
    if (k === undefined) {
      k = 0; const cl = g.clearance;
      for (let i = 0; i < cl.length; i++) if (cl[i] >= r) k++;
      if (passableOf.size >= PASSABLE_KEEP) passableOf.delete(passableOf.keys().next().value!);
      passableOf.set(key, k);
    }
    n += k; if (n > cap) return n;
  }
  return n;
}
const gridSerials = new WeakMap<LevelGrid, number>();
let gridSerialNext = 0;
const serialOf = (g: LevelGrid) => { const c = gridContentKeys.get(g); if (c) return c; let k = gridSerials.get(g); if (k === undefined) gridSerials.set(g, (k = ++gridSerialNext)); return `#${k}`; };
const STRANDED_MAX = 8, STRANDED_BYTES = 48 * 1024 * 1024, STRANDED_CELLS = 64 * 1024 * 1024;
const stranded = new Map<string, { cells: Uint8Array; size: number }>();
let strandedBytes = 0, strandedHits = 0;
/** Numeric diagnostics of the failed-search memo (tests, status). */
export function strandedMetrics() { return { entries: stranded.size, bytes: strandedBytes, hits: strandedHits }; }
function strandedKey(grids: GridSet, prep: Prep): string {
  let k = `${prep.r}|${prep.sLv}:${prep.s}|${prep.lvIds.map((id) => `${id}:${serialOf(grids.levels.get(id)!)}`).join(',')}|`;
  for (const [from, list] of prep.edges) for (const e of list) k += `${from}>${e.toLevel}:${e.toCell};`;
  return k;
}
function remember(key: string, shut: Uint32Array, gen: number, total: number, size: number, fullTotal = total) {
  if (fullTotal > STRANDED_CELLS) return;
  const cells = new Uint8Array((total + 7) >> 3);
  for (let i = 0; i < total; i++) if (shut[i] === gen) cells[i >> 3] |= 1 << (i & 7);
  const old = stranded.get(key); if (old) { strandedBytes -= old.cells.byteLength; stranded.delete(key); }
  stranded.set(key, { cells, size }); strandedBytes += cells.byteLength;
  while (stranded.size > STRANDED_MAX || strandedBytes > STRANDED_BYTES) {
    const k = stranded.keys().next().value!;
    strandedBytes -= stranded.get(k)!.cells.byteLength; stranded.delete(k);
  }
}

/** The region the last failed `search` exhausted: cells with cells[id] === gen (the start's side, or the goal's side). */
let failRegion: { cells: Uint32Array; gen: number } | null = null;

/** Obstacles passing `want` whose footprint grown by `grow` covers p, at the height of level grid g (the gridsAround rule). */
function obstaclesNear(scene: SpatialScene, g: LevelGrid, p: Vec2, grow: number, want: (id: string) => boolean): string[] | undefined {
  const out = new Set<string>();
  for (const o of scene.obstacles) if (want(o.id) && atHeight(o, g) && pointInObb(p, o.obb, grow)) out.add(o.id);
  return out.size ? [...out].sort() : undefined;
}
const atHeight = (o: { y0: number; y1: number }, g: LevelGrid) => g.y >= o.y0 - 0.3 && g.y < o.y1;

/**
 * `nameObstacles` for a failed search (see RouteOpts). An obstacle is named when it separates the
 * exhausted region from other free space: its footprint grown by a body radius + 0.5 m covers, on
 * a level at its height, both a cell of the region and a passable cell outside it (a person standing in
 * open ground next to the region is not named). A dropped stair is named by the obstacles at its
 * approach when exactly one of its ends is in the region. Cost: the obstacles' footprints, not the grid.
 */
function regionObstacles(grids: GridSet, scene: SpatialScene, prep: Prep, want: (id: string) => boolean): string[] {
  const reg = failRegion;
  failRegion = null;
  if (!reg) return [];
  const { lvIds, B, r } = prep;
  // (+ 0.5 m: a small pocket's passable cells can sit ~0.9 m from an obstacle that closes it, e.g. the
  // people level with a goal in a ring, whose diagonal neighbours are nearer)
  const grow = r + 0.5;
  /** Visit the cells of level lv whose centres lie in the obstacle box / disc; stop when `f` returns true. */
  const cells = (g: LevelGrid, c: Vec2, ext: number, inside: (q: Vec2) => boolean, f: (n: number) => boolean) => {
    const cl = g.cell;
    const i0 = Math.max(0, Math.floor((c[0] - ext) / cl) - g.ox), i1 = Math.min(g.nx - 1, Math.floor((c[0] + ext) / cl) - g.ox);
    const j0 = Math.max(0, Math.floor((c[1] - ext) / cl) - g.oz), j1 = Math.min(g.nz - 1, Math.floor((c[1] + ext) / cl) - g.oz);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (inside([latticeCentre(g.ox + i, cl), latticeCentre(g.oz + j, cl)]) && f(j * g.nx + i)) return true;
    return false;
  };
  const out = new Set<string>();
  for (const o of scene.obstacles) {
    if (!want(o.id) || out.has(o.id)) continue;
    const ext = Math.abs(o.obb.half[0]) + Math.abs(o.obb.half[1]) + grow; // bounds the grown box at any yaw
    let inR = false, outside = false;
    for (let lv = 0; lv < lvIds.length && !(inR && outside); lv++) {
      const g = grids.levels.get(lvIds[lv])!;
      if (!atHeight(o, g)) continue;
      cells(g, o.obb.c, ext, (q) => pointInObb(q, o.obb, grow), (n) => {
        if (reg.cells[B[lv] + n] === reg.gen) inR = true;
        else if (g.clearance[n] >= r) outside = true;
        return inR && outside;
      });
    }
    if (inR && outside) out.add(o.id);
  }
  const touches = (level: number, p: Vec2) => {
    const lv = prep.idxOf.get(level), g = grids.levels.get(level);
    return lv !== undefined && !!g && cells(g, p, r + 0.6, (q) => dist2(q, p) <= r + 0.6, (n) => reg.cells[B[lv] + n] === reg.gen);
  };
  for (const d of prep.dropped ?? []) {
    if (touches(d.level, d.at[0]) === touches(d.farLevel, d.far)) continue;
    const g = grids.levels.get(d.level)!;
    for (const p of d.at) for (const id of obstaclesNear(scene, g, p, r + 0.5, want) ?? []) out.add(id);
  }
  return [...out].sort();
}

/**
 * Reverse flood from the goal over exactly the moves `search` makes, backwards: a cell X is entered
 * from a neighbour Y when X is passable, Y is passable or the start, and (diagonals) both corner cells
 * are passable; a link edge F → X is entered from F. The A* only ever expands the start and passable
 * cells, so "the flood ran out without meeting the start" ⇔ "the A* would exhaust without the goal".
 * `step()` visits one cell: −1 exhausted without the start, 1 met the start, 0 not decided yet.
 */
function reverseFlood(S: Scratch, prep: Prep, Ls: LevelGrid[], startId: number, goalId: number) {
  const { r, B, idxOf, edges } = prep;
  if (!S.rseen || S.rseen.length !== S.total) { S.rseen = new Uint32Array(S.total); S.rq = new Int32Array(S.total); }
  const seen = S.rseen, q = S.rq!, gen = S.gen;
  let into: Map<number, number[]> | null = null;
  if (edges.size) {
    into = new Map();
    for (const [from, list] of edges)
      for (const e of list) {
        const to = B[idxOf.get(e.toLevel)!] + e.toCell;
        const l = into.get(to);
        if (l) l.push(from);
        else into.set(to, [from]);
      }
  }
  let head = 0, tail = 0, lvHint = 0;
  seen[goalId] = gen;
  q[tail++] = goalId;
  return {
    step(): number {
      if (head === tail) return -1;
      const x = q[head++];
      const lv = (lvHint = lvOf(prep, x, lvHint)), base = B[lv], c = x - base;
      const g = Ls[lv];
      const nx = g.nx, nz = g.nz, cl = g.clearance;
      if (cl[c] >= r) {
        const xi = c % nx, xj = (c - xi) / nx;
        for (let dj = -1; dj <= 1; dj++) {
          const yj = xj + dj;
          if (yj < 0 || yj >= nz) continue;
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const yi = xi + di;
            if (yi < 0 || yi >= nx) continue;
            if (di && dj && (!(cl[yj * nx + xi] >= r) || !(cl[xj * nx + yi] >= r))) continue;
            const y = base + yj * nx + yi;
            if (y === startId) return 1;
            if (seen[y] === gen || !(cl[yj * nx + yi] >= r)) continue;
            seen[y] = gen;
            q[tail++] = y;
          }
        }
      }
      const from = into?.get(x);
      if (from)
        for (const y of from) {
          if (y === startId) return 1;
          if (seen[y] === gen) continue;
          seen[y] = gen;
          q[tail++] = y;
        }
      return head === tail ? -1 : 0;
    },
  };
}

/** Cell chain → legs (string-pulled walk legs + link legs). */
function assemble(grids: GridSet, prep: Prep, start: Place, goal: Place, found: Found, expanded: number): RouteResult {
  const { r, lvIds, B, gg, gt } = prep;
  const { chain, viaLink } = found;
  const goalC = centreOf(gg, gt);
  const legs: Leg[] = [];
  let pts: Vec2[] = [start.p];
  let curLv = start.level;
  for (let k = 1; k < chain.length; k++) {
    const id = chain[k];
    const e = viaLink.get(id);
    const lvk = lvOf(prep, id), g = grids.levels.get(lvIds[lvk])!;
    if (e) {
      // A running route owns its geometry; scene contributors may replace or edit links later.
      const link = structuredClone(e.link);
      const { entry, exit } = linkApproach(link, e.ascending);
      pts.push(e.approach, entry.p);
      legs.push(walkLeg(grids.levels.get(curLv)!, pts, r));
      legs.push({ kind: 'link', link, ascending: e.ascending });
      pts = [exit.p];
      curLv = e.toLevel;
    } else pts.push(centreOf(g, id - B[lvk]));
  }
  // a snapped goal (its own cell has no standing room) ends at the snapped standable cell centre, never
  // at the raw goal (review H2); walk_to reports the snap distance
  const end = gt === cellOf(gg, goal.p) ? goal.p : goalC;
  if (dist2(end, pts[pts.length - 1]) > 1e-9 || pts.length === 1) pts.push(end);
  legs.push(walkLeg(grids.levels.get(curLv)!, pts, r, true));
  const length = legs.reduce((s, l) => s + (l.kind === 'walk' ? pathLen2(l.points) : pathLen(l.link.path)), 0);
  return { ok: true, route: { legs, length, expanded } };
}

/**
 * Coarse-to-fine: A* over a max-clearance coarse grid (optimistic: a coarse cell is open if any of
 * its fine cells is, so every fine route has a coarse image) between the fine start/goal cells,
 * then the fine A* restricted to fine cells within CORRIDOR_HALO of that coarse path. null (→ the
 * exact search) whenever either stage fails, so only successful routes can differ from 'exact'.
 */
function corridorRoute(grids: GridSet, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts, prep: Prep): RouteResult | null {
  const f = Math.max(2, Math.round(CORRIDOR_CELL / grids.cell));
  const coarse = coarseGrids(grids, f);
  const cPrep = prepare(coarse, scene, profile, { level: start.level, p: centreOf(prep.gs, prep.s) }, { level: goal.level, p: centreOf(prep.gg, prep.gt) }, { ...opts, goalTolerance: 0 });
  if ('ok' in cPrep) return null;
  const cFound = search(coarse, cPrep, opts, null);
  if (!cFound || 'ok' in cFound) return null;
  const { B, lvIds } = prep;
  const S = scratchFor(prep.total);
  if (!S.mask) S.mask = new Uint32Array(S.total);
  if (S.maskGen >= 0xfffffffe) { S.maskGen = 0; S.mask.fill(0); }
  const mgen = ++S.maskGen;
  const k = Math.ceil(CORRIDOR_HALO / (f * grids.cell));
  for (const id of cFound.chain) {
    const lv = lvOf(cPrep, id), c = id - cPrep.B[lv];
    const cg = coarse.levels.get(lvIds[lv])!, g = grids.levels.get(lvIds[lv])!;
    // coarse lattice cell K covers fine lattice cells K·f … K·f + f − 1 (see coarseGrids)
    const ci = cg.ox + (c % cg.nx), cj = cg.oz + Math.floor(c / cg.nx);
    const i0 = Math.max(0, (ci - k) * f - g.ox), i1 = Math.min(g.nx, (ci + k + 1) * f - g.ox);
    const j0 = Math.max(0, (cj - k) * f - g.oz), j1 = Math.min(g.nz, (cj + k + 1) * f - g.oz);
    for (let j = j0; j < j1; j++) for (let i = i0, row = B[lv] + j * g.nx; i < i1; i++) S.mask[row + i] = mgen;
  }
  const found = search(grids, prep, opts, { stamp: S.mask, gen: mgen });
  if (!found || 'ok' in found) return null;
  return assemble(grids, prep, start, goal, found, cFound.expanded + found.expanded);
}

/** Build (memoise) the corridor planner's coarse grids now, e.g. at grid-rebuild time instead of inside the first route. */
export function prepareCorridor(grids: GridSet) {
  coarseGrids(grids, Math.max(2, Math.round(CORRIDOR_CELL / grids.cell)));
}

/**
 * Max-clearance coarsening (factor f) of every level, memoised per fine LevelGrid. Lattice-aligned:
 * coarse lattice cell K (cell f·cell) covers fine lattice cells K·f … K·f + f − 1, so the blocks do
 * not depend on the fine grid's origin.
 */
const coarseCache = new WeakMap<LevelGrid, Map<number, LevelGrid>>();
function coarseGrids(grids: GridSet, f: number): GridSet {
  const levels = new Map<number, LevelGrid>();
  for (const [id, g] of grids.levels) {
    let byF = coarseCache.get(g);
    if (!byF) coarseCache.set(g, (byF = new Map()));
    let cg = byF.get(f);
    if (!cg) {
      const ox = Math.floor(g.ox / f), oz = Math.floor(g.oz / f);
      const nx = g.nx ? Math.floor((g.ox + g.nx - 1) / f) - ox + 1 : 0, nz = g.nz ? Math.floor((g.oz + g.nz - 1) / f) - oz + 1 : 0;
      const clearance = new Float32Array(nx * nz), free = new Uint8Array(nx * nz);
      for (let j = 0; j < g.nz; j++)
        for (let i = 0, cj = (Math.floor((g.oz + j) / f) - oz) * nx; i < g.nx; i++) {
          const v = g.clearance[j * g.nx + i], c = cj + Math.floor((g.ox + i) / f) - ox;
          if (v > clearance[c]) clearance[c] = v;
          if (g.free[j * g.nx + i]) free[c] = 1;
        }
      cg = { level: g.level, y: g.y, cell: g.cell * f, nx, nz, ox, oz, x0: ox * g.cell * f, z0: oz * g.cell * f, free, clearance, blockers: new Map() };
      byF.set(f, cg);
    }
    levels.set(id, cg);
  }
  return { cell: grids.cell * f, levels };
}

/** String-pull a cell path keeping every shortcut's clearance ≥ radius. Endpoints are preserved. */
function walkLeg(g: LevelGrid, raw: Vec2[], r: number, _final = false): WalkLeg {
  // (a snapped goal already arrives here as its cell centre; see findRoute)
  const pts = raw.filter((p, i) => i === 0 || i === raw.length - 1 || dist2(p, raw[i - 1]) > 1e-9);
  const out: Vec2[] = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && segmentClearance(g, pts[a], pts[b]) < r) b--;
    out.push(pts[b]);
    a = b;
  }
  let minClearance = Infinity;
  for (let i = 1; i < out.length; i++) minClearance = Math.min(minClearance, segmentClearance(g, out[i - 1], out[i]));
  return { kind: 'walk', level: g.level, points: out, minClearance };
}

/** The planner's snap: the cell at p when its clearance is >= r, else the nearest such cell within tol (-1: none). */
export function snap(g: LevelGrid, p: Vec2, r: number, tol: number): number {
  const c = cellOf(g, p);
  if (c >= 0 && g.clearance[c] >= r) return c;
  if (c < 0) return -1;
  const k = Math.ceil(tol / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  let best = -1, bd = Infinity;
  for (let j = cj - k; j <= cj + k; j++)
    for (let i = ci - k; i <= ci + k; i++) {
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      const n = j * g.nx + i;
      if (g.clearance[n] < r) continue;
      const d = (i - ci) ** 2 + (j - cj) ** 2;
      if (d < bd && d * g.cell * g.cell <= tol * tol) { bd = d; best = n; }
    }
  return best;
}

const pathLen = (p: [number, number, number][]) => p.slice(1).reduce((s, q, i) => s + hypot(q[0] - p[i][0], q[1] - p[i][1], q[2] - p[i][2]), 0);
const pathLen2 = (p: Vec2[]) => p.slice(1).reduce((s, q, i) => s + dist2(q, p[i]), 0);
const fmt = (p: Vec2) => `${p[0].toFixed(2)}, ${p[1].toFixed(2)}`;
const blk = (g: LevelGrid, p: Vec2) => {
  const b = nearestBlocker(g, p);
  return b ? ` (blocked by ${b})` : cellOf(g, p) >= 0 && !g.free[cellOf(g, p)] ? ' (no floor here)' : '';
};
function fail(code: string, message: string, at?: Place, subjects?: string[]): RouteResult {
  return { ok: false, diagnostic: { code, message, subjects, at: at ? [at.p[0], 0, at.p[1]] : undefined } };
}

/**
 * Deterministic indexed binary min-heap over cell ids, ordered by (key, insertion order) — a total
 * order. A push-duplicates heap (the reference) pops each queued cell at the minimum of its
 * entries; later entries are stale no-ops. So `push` of an already queued cell re-keys it in place
 * to (key, fresh order) only when key is strictly lower, and otherwise leaves it — the sequence of
 * effective pops is exactly the reference A*'s.
 * `pos[cell]` (−1 = not queued) is only meaningful for cells stamped in the current search.
 */
class Heap {
  private k = new Float64Array(1024);
  private v = new Int32Array(1024);
  private o = new Float64Array(1024);
  private n = 0;
  size = 0;
  pos: Int32Array = new Int32Array(0);
  reset(pos: Int32Array) {
    this.size = 0;
    this.n = 0;
    this.pos = pos;
  }
  /** Insert `val`, or re-key it if `queued` (caller knows pos[val] is current). */
  push(val: number, key: number, queued: boolean) {
    const ord = this.n++;
    let i: number;
    if (queued) {
      i = this.pos[val];
      // a lower g can round to the same f: the older (smaller-order) entry is then the one that
      // pops first in the reference, so the cell keeps its place
      if (!(key < this.k[i])) return;
    } else {
      if (this.size === this.k.length) this.grow();
      i = this.size++;
    }
    const k = this.k, v = this.v, o = this.o, pos = this.pos;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] < key || (k[p] === key && o[p] < ord)) break;
      k[i] = k[p]; v[i] = v[p]; o[i] = o[p]; pos[v[i]] = i;
      i = p;
    }
    k[i] = key; v[i] = val; o[i] = ord; pos[val] = i;
  }
  pop(): number {
    const k = this.k, v = this.v, o = this.o, pos = this.pos;
    const top = v[0];
    pos[top] = -1;
    const last = --this.size;
    if (last > 0) {
      const key = k[last], val = v[last], ord = o[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= last) break;
        let m = l;
        const r = l + 1;
        if (r < last && (k[r] < k[l] || (k[r] === k[l] && o[r] < o[l]))) m = r;
        if (key < k[m] || (key === k[m] && ord < o[m])) break;
        k[i] = k[m]; v[i] = v[m]; o[i] = o[m]; pos[v[i]] = i;
        i = m;
      }
      k[i] = key; v[i] = val; o[i] = ord; pos[val] = i;
    }
    return top;
  }
  private grow() {
    const n = this.k.length * 2;
    const k = new Float64Array(n), v = new Int32Array(n), o = new Float64Array(n);
    k.set(this.k); v.set(this.v); o.set(this.o);
    this.k = k; this.v = v; this.o = o;
  }
}

/** Reusable search workspaces keyed by search size (fine + coarse grids of the last scenes).
 *  findRoute is not reentrant while searching; its only recursion runs after its search is done. */
type Scratch = { total: number; gen: number; gScore: Float64Array; came: Int32Array; pos: Int32Array; stamp: Uint32Array; shut: Uint32Array; heap: Heap; mask?: Uint32Array; maskGen: number; rseen?: Uint32Array; rq?: Int32Array };
const scratches = new Map<number, Scratch>();
const SCRATCHES = 3;
/** Numeric diagnostics: search workspaces kept and their bytes. */
export function scratchMetrics() { let bytes = 0; for (const sc of [...scratches.values(), ...(bigScratch ? [bigScratch] : [])]) for (const v of Object.values(sc)) if (ArrayBuffer.isView(v)) bytes += v.byteLength; return { entries: scratches.size + (bigScratch ? 1 : 0), bytes, totals: [...scratches.keys(), ...(bigScratch ? [bigScratch.total] : [])] }; }
/** E-life (memory): a workspace costs ~28 bytes a cell; one for a 4×4-tile window (16.4 M cells) is ~450 MB. Only
 *  workspaces up to this many cells are kept for reuse; a bigger search gets a fresh one that is freed after it (Eden
 *  2026 kept 403 MB of workspaces after one resident's first capabilities). Search results are unchanged. */
export const SCRATCH_KEEP_CELLS = 2_500_000;
/** L1: one workspace bigger than SCRATCH_KEEP_CELLS is kept for the next big search (any size up to its own: ids and
 *  generations do not care), and let go after BIG_IDLE small searches in a row. A Soul's first look inside a multi-storey
 *  house runs ~30 room-reach searches over ~4 M cells each; each used to get (and free) a fresh ~110 MB workspace. */
let bigScratch: Scratch | null = null, smallRun = 0;
const BIG_IDLE = 400;
/** Let the big workspace go now (a host calls this after a burst of reads, e.g. a Soul's capability listing). */
export function releaseBigScratch() { bigScratch = null; smallRun = 0; }
function newScratch(total: number): Scratch {
  return { total, gen: 0, gScore: new Float64Array(total), came: new Int32Array(total), pos: new Int32Array(total), stamp: new Uint32Array(total), shut: new Uint32Array(total), heap: new Heap(), maskGen: 0 };
}
function scratchFor(total: number): Scratch {
  let sc = scratches.get(total);
  if (total > SCRATCH_KEEP_CELLS) {
    smallRun = 0;
    if (!bigScratch || bigScratch.total < total) bigScratch = newScratch(total);
    sc = bigScratch;
  } else {
    if (bigScratch && ++smallRun > BIG_IDLE) bigScratch = null;
    if (!sc) {
      sc = newScratch(total);
      if (scratches.size >= SCRATCHES) scratches.delete(scratches.keys().next().value!);
      scratches.set(total, sc);
    }
  }
  if (sc.gen >= 0xfffffffe) {
    sc.gen = 0;
    sc.stamp.fill(0);
    sc.shut.fill(0);
    sc.rseen?.fill(0);
  }
  sc.gen++;
  return sc;
}
