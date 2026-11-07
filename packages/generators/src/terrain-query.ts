// Shared helpers for L3's path and area generators: the terrain query that prepare-steps read
// (grading, auto-bridges, river snapping, deck heights), Catmull-Rom smoothing, arc lengths,
// ribbons. Owner: L3. Pure and deterministic (+ − × ÷ and sqrt only), so the server, the skill
// and the viewer derive the same centre lines.
//
// Height conventions for world-frame (path / area form) generators, binding for Stage B:
//   - Surface.y and LocalOBB.y0/y1 are metres ABOVE THE GROUND at that point (roads, lawns, walls,
//     fences, hedges drape on the terrain), unless the record carries `abs: true`, in which case
//     they are absolute world heights (bridge decks, piers, decks over water, their rails).
//   - Ground is the only height source: absolute heights are frozen from the ground by a prepare
//     step (prepareRoad / snapRiver / prepareDeck) into the entity's params, never re-invented.
import { waterLevelAt, type Ground, type Water } from '@souls/ground';
import type { LocalOBB, Surface, Vec2 } from './types.ts';

/** What prepare-steps need from a world: the WorldModel (server, skill mirror, viewer) satisfies it via `queryOf`. */
export type TerrainQuery = {
  height(x: number, z: number): number;
  slope(x: number, z: number): number;
  waterLevel(x: number, z: number): number | null;
  waters: Water[];
};
export function queryOf(model: { terrain: { sample(x: number, z: number): number; slope(x: number, z: number): number }; ground(): Ground }): TerrainQuery {
  const g = model.ground();
  return { height: (x, z) => model.terrain.sample(x, z), slope: (x, z) => model.terrain.slope(x, z), waterLevel: (x, z) => waterLevelAt(g, x, z), waters: g.waters };
}

/** sqrt(x² + z²) with exact ops (Math.hypot is not guaranteed bit-identical across engines). */
export const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);

export type AbsSurface = Surface & { abs?: boolean };
export type AbsOBB = LocalOBB & { abs?: boolean };

/** Uniform Catmull-Rom through the control points, resampled to ≈ `step` m (≤ maxPts points). Two points stay a line. */
export function smoothPath(ctrl: Vec2[], step = 2, maxPts = 400): Vec2[] {
  if (ctrl.length < 2) return ctrl.slice();
  let total = 0; for (let i = 1; i < ctrl.length; i++) total += hyp(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
  const st = Math.max(step, total / (maxPts - 1));
  const out: Vec2[] = [ctrl[0]];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const len = hyp(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.round(len / st));
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
/** Cumulative arc length at each point. */
export function arcLengths(p: Vec2[]): number[] { const out = [0]; for (let i = 1; i < p.length; i++) out.push(out[i - 1] + hyp(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return out; }
/** Unit tangent and left normal at each point (central differences). */
export function frames(p: Vec2[]): { t: Vec2; n: Vec2 }[] {
  return p.map((_, i) => {
    const a = p[Math.max(0, i - 1)], c = p[Math.min(p.length - 1, i + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1]; const l = hyp(dx, dz) || 1; dx /= l; dz /= l;
    return { t: [dx, dz] as Vec2, n: [-dz, dx] as Vec2 };
  });
}
/** Offset each point along its left normal: d > 0 left, < 0 right. */
export function offsetAlong(p: Vec2[], d: number): Vec2[] { return frames(p).map(({ n }, i) => [p[i][0] + n[0] * d, p[i][1] + n[1] * d] as Vec2); }
/** Closed polygon of a band between two offsets (a ≥ b), e.g. a road (w/2, −w/2) or a bank (w/2 + 3, w/2). */
export function band(p: Vec2[], a: number, b: number): Vec2[] { return [...offsetAlong(p, a), ...offsetAlong(p, b).reverse()]; }
/** Sub-polyline between arc lengths s0 and s1 (interpolated ends). */
export function subPath(p: Vec2[], s: number[], s0: number, s1: number): Vec2[] {
  const at = (q: number): Vec2 => { for (let i = 1; i < p.length; i++) if (s[i] >= q || i === p.length - 1) { const k = s[i] - s[i - 1] ? (q - s[i - 1]) / (s[i] - s[i - 1]) : 0; return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k]; } return p[0]; };
  const out: Vec2[] = [at(s0)]; for (let i = 0; i < p.length; i++) if (s[i] > s0 && s[i] < s1) out.push(p[i]); out.push(at(s1)); return out;
}
/** Linear interpolation of per-point values at arc length q. */
export function valueAt(vals: number[], s: number[], q: number): number {
  if (q <= 0) return vals[0];
  for (let i = 1; i < s.length; i++) if (s[i] >= q) { const k = s[i] - s[i - 1] ? (q - s[i - 1]) / (s[i] - s[i - 1]) : 0; return vals[i - 1] + (vals[i] - vals[i - 1]) * k; }
  return vals[vals.length - 1];
}
/** A short, stable signature of a control path: prepared params are valid only for the path they were computed on. */
export function pathSig(p: Vec2[]): string { let h = 2166136261; const s = p.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(';'); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); }
export const round2 = (v: number) => Math.round(v * 100) / 100;
/** Moving average over a window of `win` metres (points spaced by arc length). */
export function movingAverage(vals: number[], s: number[], win: number): number[] {
  return vals.map((_, i) => { let sum = 0, n = 0; for (let j = i; j >= 0 && s[i] - s[j] <= win / 2; j--) { sum += vals[j]; n++; } for (let j = i + 1; j < vals.length && s[j] - s[i] <= win / 2; j++) { sum += vals[j]; n++; } return sum / n; });
}
/** Distance from a point to the nearest water edge (0 inside water), up to `cap`. */
export function distToWater(q: TerrainQuery, x: number, z: number, cap = 200): number {
  if (q.waterLevel(x, z) !== null && (q.waterLevel(x, z) as number) > q.height(x, z)) return 0;
  let best = cap;
  for (const w of q.waters) {
    if (w.area) { for (let i = 0, j = w.area.length - 1; i < w.area.length; j = i++) best = Math.min(best, distSeg(x, z, w.area[j], w.area[i])); }
    else if (w.path && w.w) { for (let i = 1; i < w.path.length; i++) best = Math.min(best, Math.max(0, distSeg(x, z, w.path[i - 1], w.path[i]) - w.w / 2)); }
  }
  return best;
}
export function distSeg(px: number, pz: number, a: Vec2, b: Vec2): number {
  const vx = b[0] - a[0], vz = b[1] - a[1], n = vx * vx + vz * vz; let t = n ? ((px - a[0]) * vx + (pz - a[1]) * vz) / n : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return hyp(px - (a[0] + vx * t), pz - (a[1] + vz * t));
}
