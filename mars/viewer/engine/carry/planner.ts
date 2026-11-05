// SE(2) formation planner (spec §11): hybrid-A* over (x, z, θ) with motion
// primitives a carrying crew can actually perform — forward, gentle arcs
// (radius grows with load length), slow in-place rotation about the load
// centre, short costly reverse. Every primitive is swept-checked
// (sweep.ts) for the whole formation: load cover discs + carrier bodies.
// Output: a dense trajectory of formation poses, shortcut-smoothed only where
// the smoothed motion passes the same swept checks. Deterministic.
import { angleDelta, datan2, dcos, dist2, dsin, type Vec2, hypot } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import { cellOf, latticeIndex, nearestBlocker, type LevelGrid } from '../spatial/grid.ts';
import type { Formation, SE2 } from './formation.ts';
import { distanceField, Heap, motionAt, motionEnd, motionSize, PLAN_MARGIN, sweep, type Hit, type Motion } from './sweep.ts';

export const HEADINGS = 32;
const DTH = (2 * Math.PI) / HEADINGS;
const BIN = 0.25; // m, position bin for the closed set
const STEP = 0.5; // m, straight primitive length
const EPS = 1.3; // heuristic weight (weighted A*; path is smoothed afterwards)
const GOAL_RADIUS = 1.0; // m, try a direct settle motion to the exact goal from here
const DETOUR = 15; // m beyond the start's grid distance that the search may wander

export type Trajectory = { poses: SE2[]; u: number[]; length: number; rotation: number; reverse: number };
export type PlanInput = {
  g: LevelGrid;
  f: Formation;
  starts: SE2[]; // all on one heading lattice (θ0, θ0 + π)
  goals: SE2[];
  labelOf: (id: string) => string;
  carrierNames?: string[];
  maxExpand?: number;
};
/** The bounded search's default pose budget: a failure that expanded more poses than this stopped there, unproven. */
export const PLAN_MAX_EXPAND = 150_000;
export type PlanOk = { ok: true; traj: Trajectory; start: number; goal: number; expanded: number; keyposes: number };
export type PlanFail = { ok: false; diagnostic: Diagnostic; expanded: number; stuck?: SE2; closest: number };

export const turnRadius = (f: Formation) => Math.max(1.5, 0.6 * f.length);

type Prim = { m: (q: SE2) => Motion; cost: number; dk: number; reverse?: boolean; name: string };

function primitives(f: Formation): Prim[] {
  const R = turnRadius(f);
  const fwd = (s: number) => (q: SE2): Motion => ({ kind: 'line', a: q, b: { x: q.x + s * dcos(q.th), z: q.z + s * dsin(q.th), th: q.th } });
  const rot = (d: number) => (q: SE2): Motion => ({ kind: 'line', a: q, b: { x: q.x, z: q.z, th: q.th + d } });
  const arc = (d: number) => (q: SE2): Motion => ({ kind: 'arc', a: q, R, dth: d });
  const rotCost = 0.3 + 1.5 * (f.length / 2) * DTH;
  return [
    { name: 'forward', m: fwd(STEP), cost: STEP, dk: 0 },
    { name: 'arc-left', m: arc(DTH), cost: 1.2 * R * DTH + 0.05, dk: 1 },
    { name: 'arc-right', m: arc(-DTH), cost: 1.2 * R * DTH + 0.05, dk: -1 },
    { name: 'rotate-left', m: rot(DTH), cost: rotCost, dk: 1 },
    { name: 'rotate-right', m: rot(-DTH), cost: rotCost, dk: -1 },
    { name: 'reverse', m: fwd(-STEP), cost: 3 * STEP + 0.2, dk: 0, reverse: true },
  ];
}

/** Direct straight motion a → b (uniform rotation) allowed for a crew: bounded curvature and crabbing. */
function directOk(f: Formation, a: SE2, b: SE2, settle: boolean): boolean {
  const d = hypot(b.x - a.x, b.z - a.z);
  const dth = Math.abs(angleDelta(a.th, b.th));
  if (d < 0.05) return settle ? dth <= 1.5 * DTH : true; // in-place rotation (swept-checked by caller)
  const phi = datan2(b.z - a.z, b.x - a.x);
  const mid = a.th + angleDelta(a.th, b.th) / 2;
  const crab = Math.abs(angleDelta(mid, phi));
  const crabR = Math.min(crab, Math.PI - crab);
  if (settle) return (d <= 0.6 || crabR <= 0.6) && dth <= d / turnRadius(f) + 1.5 * DTH;
  return crab <= 0.35 && dth <= d / turnRadius(f);
}

export function planCarry(inp: PlanInput): PlanOk | PlanFail {
  const { g, f, starts, goals } = inp;
  const base = starts[0].th;
  const kOf = (th: number) => (((Math.round(angleDelta(base, th) / DTH) % HEADINGS) + HEADINGS) % HEADINGS);
  const goalP: Vec2 = [goals[0].x, goals[0].z];
  const cellAt = (x: number, z: number) => cellOf(g, [x, z]);
  const field = distanceField(g, goalP, Math.max(0, f.loadDiscR - f.loadDiscSpacing / 2), cellAt(starts[0].x, starts[0].z), DETOUR);
  const fieldOk = starts.some((s) => Number.isFinite(field[cellAt(s.x, s.z)] ?? Infinity));
  const h = (x: number, z: number) => {
    if (!fieldOk) return hypot(x - goalP[0], z - goalP[1]);
    const c = cellAt(x, z);
    return c < 0 ? Infinity : field[c];
  };
  const prims = primitives(f);
  // closed-set bins on the global BIN lattice (origin-independent); bz0 only keeps keys unique
  const bz0 = latticeIndex(g.z0, BIN) - 1, nzb = Math.ceil((g.nz * g.cell) / BIN) + 3;
  const binKey = (q: SE2, k: number) => (latticeIndex(q.x, BIN) * nzb + latticeIndex(q.z, BIN) - bz0) * HEADINGS + k;
  // node storage
  const Q: SE2[] = [], K: number[] = [], G: number[] = [], P: number[] = [], M: (Motion | null)[] = [], ROOT: number[] = [];
  const best = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new Heap();
  const add = (q: SE2, k: number, gc: number, parent: number, m: Motion | null, root: number) => {
    const hv = h(q.x, q.z);
    if (!Number.isFinite(hv)) return;
    const key = binKey(q, k);
    if (closed.has(key) || (best.get(key) ?? Infinity) <= gc) return;
    best.set(key, gc);
    const id = Q.length;
    Q.push(q); K.push(k); G.push(gc); P.push(parent); M.push(m); ROOT.push(root);
    heap.push(id, gc + EPS * hv);
  };
  starts.forEach((s, i) => add(s, kOf(s.th), 0, -1, null, i));
  const goalK = goals.map((q) => kOf(q.th));
  const maxExpand = inp.maxExpand ?? PLAN_MAX_EXPAND;
  let expanded = 0, closest = -1, closestH = Infinity;
  let found: { node: number; goal: number; m: Motion } | null = null;
  while (heap.size && !found) {
    const id = heap.pop();
    const key = binKey(Q[id], K[id]);
    if (closed.has(key)) continue;
    closed.add(key);
    const q = Q[id];
    const hv = h(q.x, q.z);
    if (hv < closestH) { closestH = hv; closest = id; }
    if (++expanded > maxExpand) break;
    // settle: direct motion to the exact goal pose
    if (dist2([q.x, q.z], goalP) <= GOAL_RADIUS)
      for (let gi = 0; gi < goals.length && !found; gi++) {
        const dk = Math.abs(angleDelta(K[id] * DTH, goalK[gi] * DTH));
        if (dk > 1.5 * DTH) continue;
        const gq = { ...goals[gi], th: q.th + angleDelta(q.th, goals[gi].th) };
        if (!directOk(f, q, gq, true)) continue;
        const m: Motion = { kind: 'line', a: q, b: gq };
        if (!sweep(g, f, m)) found = { node: id, goal: gi, m };
      }
    if (found) break;
    for (const pr of prims) {
      const m = pr.m(q);
      if (sweep(g, f, m)) continue;
      const k = (K[id] + pr.dk + HEADINGS) % HEADINGS;
      const e = motionEnd(m);
      add({ x: e.x, z: e.z, th: base + k * DTH }, k, G[id] + pr.cost, id, m, ROOT[id]);
    }
  }
  if (!found) return failure(inp, field, fieldOk, Q, closest, expanded, h);
  // reconstruct keyposes + motions
  const chain: number[] = [];
  for (let i = found.node; i !== -1; i = P[i]) chain.push(i);
  chain.reverse();
  const keys: SE2[] = chain.map((i) => Q[i]);
  const motions: Motion[] = chain.slice(1).map((i) => M[i]!);
  keys.push(goals[found.goal]);
  motions.push(found.m);
  const traj = smooth(g, f, keys, motions);
  return { ok: true, traj, start: ROOT[found.node], goal: found.goal, expanded, keyposes: keys.length };
}

/** Greedy shortcutting: replace runs of primitives by one direct motion when it passes the same swept check. */
function smooth(g: LevelGrid, f: Formation, keys: SE2[], motions: Motion[]): Trajectory {
  const out: Motion[] = [];
  let i = 0;
  const n = keys.length - 1;
  while (i < n) {
    let j = n;
    for (; j >= i + 2; j--) {
      const b = { ...keys[j], th: keys[i].th + unwrap(keys, motions, i, j) };
      if (directOk(f, keys[i], b, false) && !sweep(g, f, { kind: 'line', a: keys[i], b })) break;
    }
    if (j >= i + 2) {
      out.push({ kind: 'line', a: keys[i], b: { ...keys[j], th: keys[i].th + unwrap(keys, motions, i, j) } });
      i = j;
    } else out.push(motions[i++]);
  }
  const poses: SE2[] = [keys[0]], u = [0];
  let length = 0, rotation = 0, reverse = 0;
  let th = keys[0].th;
  for (const m of out) {
    const seg: SE2[] = [];
    sweep(g, f, m, -1e9, seg);
    const sz = motionSize(m);
    length += sz.len;
    rotation += sz.rot;
    if (m.kind === 'line' && sz.len > 1e-6 && dcos(datan2(m.b.z - m.a.z, m.b.x - m.a.x) - m.a.th) < -0.5) reverse += sz.len;
    for (const q of seg) {
      const p = poses[poses.length - 1];
      th = p.th + angleDelta(p.th, q.th); // keep headings continuous for interpolation
      const dq = { x: q.x, z: q.z, th };
      u.push(u[u.length - 1] + hypot(dq.x - p.x, dq.z - p.z) + (f.length / 2) * Math.abs(dq.th - p.th));
      poses.push(dq);
    }
  }
  return { poses, u, length, rotation, reverse };
}

/** Heading change accumulated along motions i..j (keeps multi-turn direction). */
function unwrap(keys: SE2[], motions: Motion[], i: number, j: number) {
  let d = 0;
  for (let k = i; k < j; k++) d += angleDelta(keys[k].th, motionEnd(motions[k]).th) + angleDelta(motionEnd(motions[k]).th, keys[k + 1].th);
  return d;
}

function failure(inp: PlanInput, field: Float32Array, fieldOk: boolean, Q: SE2[], closest: number, expanded: number, h: (x: number, z: number) => number): PlanFail {
  const { g, f, goals } = inp;
  const fmt = (x: number, z: number) => `(${x.toFixed(1)}, ${z.toFixed(1)})`;
  const q = closest >= 0 ? Q[closest] : inp.starts[0];
  // Probe the way on: face along the steepest descent of the distance field
  // (the direction the route continues), then try to advance that way.
  let phi = q.th;
  if (fieldOk) {
    let bestV = h(q.x, q.z);
    for (let a = 0; a < 32; a++) {
      const t = (a / 32) * 2 * Math.PI;
      const v = h(q.x + dcos(t), q.z + dsin(t));
      if (v < bestV) { bestV = v; phi = t; }
    }
  } else phi = datan2(goals[0].z - q.z, goals[0].x - q.x);
  const along = Math.abs(angleDelta(q.th, phi)) <= Math.PI / 2 ? phi : phi + Math.PI;
  const qa: SE2 = { x: q.x, z: q.z, th: q.th + angleDelta(q.th, along) };
  const fwd = Math.abs(angleDelta(qa.th, phi)) < 1 ? 1.5 : -1.5;
  let verb = 'cannot turn toward the way on';
  let hit: Hit | null = sweep(g, f, { kind: 'line', a: q, b: qa });
  if (!hit) {
    verb = 'cannot get past';
    hit = sweep(g, f, { kind: 'line', a: qa, b: { x: qa.x + fwd * dcos(qa.th), z: qa.z + fwd * dsin(qa.th), th: qa.th } });
  }
  if (!hit)
    for (const pr of primitives(f)) {
      hit = sweep(g, f, pr.m(q));
      if (hit) { verb = pr.dk ? 'cannot turn' : 'cannot get past'; break; }
    }
  const d = hit ? f.discs[hit.disc] : null;
  const part = !d ? 'the formation' : d.part === 'load' ? 'the load' : `carrier ${inp.carrierNames?.[d.carrier!] ?? `#${d.carrier}`}`;
  const blocker = hit ? nearestBlocker(g, hit.p, 1.0) : undefined;
  const what = blocker ? `'${inp.labelOf(blocker)}'` : 'the edge of walkable ground';
  const remaining = hypot(q.x - goals[0].x, q.z - goals[0].z);
  const wide = 2 * Math.max(...f.discs.map((x) => Math.abs(x.c[1]) + x.r));
  const deg = Math.round(((((phi * 180) / Math.PI) % 360) + 360) % 360);
  const message =
    `the ${f.name} (${f.length.toFixed(1)} m; formation ${wide.toFixed(1)} m wide with ${f.crew} carriers) ${verb} at ${fmt(q.x, q.z)} (route heading ${deg}°): ${part} would intersect ${what}` +
    ` — the formation gets no closer than ${remaining.toFixed(1)} m to the target ${fmt(goals[0].x, goals[0].z)} (${expanded} poses searched)`;
  return {
    ok: false,
    expanded,
    stuck: q,
    closest: remaining,
    diagnostic: {
      code: 'carry.no-route',
      message,
      subjects: blocker ? [blocker] : [],
      at: hit ? [hit.p[0], 0, hit.p[1]] : [q.x, 0, q.z],
      // budget: a search that stopped there (expanded > budget) did not prove there is no way
      details: { stuck: q, blocker, part, expanded, budget: inp.maxExpand ?? PLAN_MAX_EXPAND, field: fieldOk ? 'grid' : 'euclidean' },
    },
  };
}

export { motionAt, PLAN_MARGIN };
