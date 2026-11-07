// The original four generators (box, landform, lake, scatter), moved from world-compiler. Owner: L1.
// landform/1 also hosts the new landform kinds (cliff, terrace, channel) — L3 extends @souls/ground and this file's params.
import type { LandformBody } from '@souls/ground';
import { bounds2, n, rng } from './geom.ts';
import type { Generator, Vec2 } from './types.ts';

export const boxGen: Generator = {
  id: 'box/1', form: 'point', doc: 'A plain box (w × h × d). Placeholder for anything; top is a surface slot.',
  params: { w: { type: 'number', min: 0.05, max: 400, default: 1 }, h: { type: 'number', min: 0.05, max: 120, default: 1 }, d: { type: 'number', min: 0.05, max: 400, default: 1 }, color: { type: 'color', default: '#9a9a9a' } },
  physics({ params }) {
    const w = n(params.w, 1), h = n(params.h, 1), d = n(params.d, 1);
    return { box: [w, h, d], colliders: [{ c: [0, 0], half: [w / 2, d / 2], yaw: 0, y0: 0, y1: h }], slots: [{ id: 'top', kind: 'surface', p: [0, h, 0], yaw: 0, height: h, accepts: {}, capacity: 64 }], tris: 12 };
  },
};

export const landformGen: Generator = {
  id: 'landform/1', form: 'point', doc: 'Terrain: point → bump (hill, knoll, mountain); path → ridge; area → plateau (height > 0) or carve (height < 0).',
  params: { height: { type: 'number', min: -200, max: 400, default: 6 }, radius: { type: 'number', min: 1, max: 2000, default: 20 }, peak: { type: 'number', min: 0.25, max: 6, default: 1, doc: '1 round, 3 alpine' }, edge: { type: 'number', min: 0.5, max: 200, default: 8 } },
  physics({ params, shape }) {
    const h = n(params.height, 6), r = n(params.radius, 20), peak = n(params.peak, 1), edge = n(params.edge, 8);
    let landform: LandformBody;
    if (shape?.path) landform = { kind: 'ridge', path: shape.path, w: shape.width ?? r, h, peak };
    else if (shape?.area) landform = h < 0 ? { kind: 'carve', area: shape.area, bed: h, edge } : { kind: 'plateau', area: shape.area, h, edge };
    else landform = { kind: 'bump', c: [0, 0], r, h, peak };
    return { box: [2 * r, Math.abs(h), 2 * r], colliders: [], slots: [], landform, tris: 0 };
  },
};

export const lakeGen: Generator = {
  id: 'lake/1', form: 'area', doc: 'A lake or pond: carves a bed `depth` below `level` and fills it with water.',
  params: { depth: { type: 'number', min: 0.2, max: 60, default: 4 }, level: { type: 'number', min: -100, max: 400, default: -0.3 }, edge: { type: 'number', min: 0.5, max: 60, default: 6 } },
  physics({ params, shape }) {
    const depth = n(params.depth, 4), level = n(params.level, -0.3), edge = n(params.edge, 6);
    const area = shape?.area ?? ([[-10, -10], [10, -10], [10, 10], [-10, 10]] as Vec2[]);
    const bb = bounds2(area);
    return { box: [bb[2] - bb[0], depth, bb[3] - bb[1]], colliders: [], slots: [], landform: { kind: 'carve', area, bed: level - depth, edge }, water: { level, area }, tris: 0 };
  },
};

export const scatterGen: Generator = {
  id: 'scatter/1', form: 'area', doc: 'Simple scatter over an area (forest, meadow, garden). See scatter/2 for palettes and rules.',
  params: { density: { type: 'number', min: 0.001, max: 10, default: 0.05 }, minSpacing: { type: 'number', min: 0.2, max: 50, default: 2 }, radius: { type: 'number', min: 0.1, max: 10, default: 0.4 }, height: { type: 'number', min: 0.1, max: 60, default: 6 } },
  physics({ params, shape }) {
    const bb = bounds2(shape?.area ?? [[-5, -5], [5, 5]]);
    return { box: [bb[2] - bb[0], n(params.height, 6), bb[3] - bb[1]], colliders: [], slots: [], tris: 0 };
  },
};

/** Scatter points for an area; shared by server and viewer. Rejection sampling on a seeded PRNG. */
export function scatterPoints(area: Vec2[], density: number, minSpacing: number, seed: number, cap = 4000): Vec2[] {
  const [x0, z0, x1, z1] = bounds2(area);
  const want = Math.min(cap, Math.floor((x1 - x0) * (z1 - z0) * density));
  const out: Vec2[] = []; const rnd = rng(seed);
  const inside = (px: number, pz: number) => { let i = false; for (let a = 0, c = area.length - 1; a < area.length; c = a++) { const [xi, zi] = area[a], [xj, zj] = area[c]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) i = !i; } return i; };
  const ms2 = minSpacing * minSpacing;
  // grid hash for spacing checks (O(n) instead of O(n²))
  const cell = Math.max(minSpacing, 0.5), grid = new Map<string, Vec2[]>();
  for (let tries = 0; out.length < want && tries < want * 12; tries++) {
    const px = x0 + rnd() * (x1 - x0), pz = z0 + rnd() * (z1 - z0);
    if (!inside(px, pz)) continue;
    const gx = Math.floor(px / cell), gz = Math.floor(pz / cell);
    let ok = true;
    for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) for (const [qx, qz] of grid.get(`${gx + dx},${gz + dz}`) ?? []) if ((qx - px) ** 2 + (qz - pz) ** 2 < ms2) { ok = false; break; }
    if (!ok) continue;
    const pt: Vec2 = [px, pz]; out.push(pt);
    const k = `${gx},${gz}`; const list = grid.get(k); if (list) list.push(pt); else grid.set(k, [pt]);
  }
  return out;
}
