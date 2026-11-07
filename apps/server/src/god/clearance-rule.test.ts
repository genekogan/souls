// Lane BS1 (BUILDSAFE, 2026-10-21): the one clearance rule (@souls/generators clearance.ts) that plans, stairs, doors and
// furnishing use must say what the walk planner does. Three checks against the real raster (mars spatial/grid.ts):
// its constants are the planner's, its raster reading at a building's pose is the planner's cell for cell, and its exact
// widths (clearWay) always pass at any yaw and sub-cell offset while 0.1 m less does not always.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_R, PLAN_MARGIN, PLAN_R, NAV_CELL, clearWay, freeCellsAt, rasterOf, type WayBlocker, type Raster } from '@souls/generators';
import { buildGrids, clearanceAt } from '../../../../mars/viewer/engine/spatial/grid.ts';
import { PLAN_MARGIN as ENGINE_MARGIN } from '../../../../mars/viewer/engine/spatial/path.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { CONNECT_CLEAR } from '../../../../mars/viewer/engine/spatial/connectivity.ts';

type Vec2 = [number, number];
// generator convention (model.footprint): local (x, z) -> (x c + z s, -x s + z c); the engine's OBB yaw is its negative
const toW = (p: readonly number[], pose: { x: number; z: number; yaw: number }): Vec2 => { const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw); return [pose.x + p[0] * c + p[1] * s, pose.z - p[0] * s + p[1] * c]; };
function grid(blockers: WayBlocker[], pose: { x: number; z: number; yaw: number }) {
  const obstacles = blockers.map((b, i) => ({ id: `o${i}`, obb: { c: toW(b.c, pose), half: [b.half[0], b.half[1]] as Vec2, yaw: -(b.yaw + pose.yaw) }, y0: 0, y1: 2.4, ...(rasterOf(b) === 'centre' ? { raster: 'centre' as const } : {}) }));
  const scene = { bounds: [pose.x - 12, pose.z - 12, pose.x + 12, pose.z + 12] as [number, number, number, number], levels: [{ id: 0, y: 0, label: 'g' }],
    surfaces: [{ id: 'f', level: 0, y: 0, obb: { c: [pose.x, pose.z] as Vec2, half: [12, 12] as Vec2, yaw: 0 } }], obstacles, links: [] };
  return buildGrids(scene as never, NAV_CELL).levels.get(0)!;
}
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('the clearance rule uses the walk planner\'s body, margin and passable test', () => {
  assert.equal(BODY_R, HUMAN_RADIUS);
  assert.equal(PLAN_MARGIN, ENGINE_MARGIN);
  assert.equal(PLAN_R, CONNECT_CLEAR);
});

test('read at a building\'s pose, the rule walks exactly the cells the planner walks (walls by centre, pieces by touch)', () => {
  // a 5 x 4 m room with its four walls (0.12 m wall pieces, centre raster) and three turned pieces of furniture
  const room = { polygon: [[-2.5, -2], [2.5, -2], [2.5, 2], [-2.5, 2]] as Vec2[] };
  for (let k = 0; k < 12; k++) {
    const pose = { x: 30 + rnd() * 10, z: -20 + rnd() * 10, yaw: (rnd() - 0.5) * 2 * Math.PI };
    const blockers: WayBlocker[] = [
      { c: [0, -2.06], half: [2.62, 0.06], yaw: 0, tag: 'wall:f0:s' }, { c: [0, 2.06], half: [1.9, 0.06], yaw: 0, tag: 'wall:f0:n' },
      { c: [-2.56, 0], half: [0.06, 2.1], yaw: 0, tag: 'wall:f0:w' }, { c: [2.56, 0], half: [0.06, 2.1], yaw: 0, tag: 'wall:f0:e' },
      ...[0, 1, 2].map((): WayBlocker => ({ c: [(rnd() - 0.5) * 3.6, (rnd() - 0.5) * 2.8], half: [0.2 + rnd() * 0.5, 0.2 + rnd() * 0.4], yaw: (rnd() - 0.5) * Math.PI })),
    ];
    const g = grid(blockers, pose), mine = new Set(freeCellsAt(room, blockers, pose).map(([x, z]) => `${Math.floor(x / NAV_CELL)},${Math.floor(z / NAV_CELL)}`));
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    let n = 0;
    for (const key of mine) {
      const [i, j] = key.split(',').map(Number), p: Vec2 = [(i + 0.5) * NAV_CELL, (j + 0.5) * NAV_CELL];
      assert.ok(clearanceAt(g, p) >= PLAN_R - 1e-6, `pose ${k}: cell ${key} walked by the rule, clearance ${clearanceAt(g, p)} on the raster`);
    }
    for (let i = Math.floor((pose.x - 4) / NAV_CELL); i <= Math.floor((pose.x + 4) / NAV_CELL); i++) for (let j = Math.floor((pose.z - 4) / NAV_CELL); j <= Math.floor((pose.z + 4) / NAV_CELL); j++) {
      const p: Vec2 = [(i + 0.5) * NAV_CELL, (j + 0.5) * NAV_CELL], dx = p[0] - pose.x, dz = p[1] - pose.z, l: Vec2 = [dx * c - dz * s, dx * s + dz * c];
      if (Math.abs(l[0]) >= 2.5 || Math.abs(l[1]) >= 2) continue;   // outside the room
      if (clearanceAt(g, p) >= PLAN_R - 1e-6) { n++; assert.ok(mine.has(`${i},${j}`), `pose ${k}: cell ${i},${j} walked on the raster (clearance ${clearanceAt(g, p)}) but not by the rule`); }
    }
    assert.ok(n > 200, `pose ${k}: ${n} walked cells`);
  }
});

test('an exact gap of clearWay always passes on the raster, and 0.1 m less does not always', () => {
  // the same probe as team/scratch/t4/bs1/probe/gap.ts, on fewer poses: a gap in a wall line, bounded by walls or pieces
  const passes = (gap: number, a: Raster, b: Raster, yaw: number, off: Vec2) => {
    const pose = { x: 5 + off[0], z: 5 + off[1], yaw }, h = 0.3, bl: WayBlocker[] = [];
    const side = (r: Raster, sign: number) => {
      if (r === 'centre') bl.push({ c: [sign * (gap / 2 + 20), 0], half: [20, 0.06], yaw: 0, tag: 'wall:f0:x' });
      else bl.push({ c: [sign * (gap / 2 + h), 0], half: [h, h], yaw: 0 }, { c: [sign * (gap / 2 + 2 * h + 20), 0], half: [20, 0.06], yaw: 0, tag: 'wall:f0:x' });
    };
    side(a, -1); side(b, 1);
    const g = grid(bl, pose), seen = new Set<number>(), start = toW([0, -1.2], pose), goal = toW([0, 1.2], pose);
    const idx = (p: Vec2) => (Math.floor(p[1] / NAV_CELL) - g.oz) * g.nx + (Math.floor(p[0] / NAV_CELL) - g.ox);
    const ok = (q: number) => g.clearance[q] >= PLAN_R - 1e-6, st = [idx(start)], end = idx(goal);
    if (!ok(st[0])) return false;
    seen.add(st[0]);
    while (st.length) {
      const q = st.pop()!; if (q === end) return true;
      for (const m of [q + 1, q - 1, q + g.nx, q - g.nx]) if (m >= 0 && m < g.nx * g.nz && !seen.has(m) && ok(m)) { seen.add(m); st.push(m); }
    }
    return false;
  };
  const poses: [number, Vec2][] = [];
  for (const deg of [0, 10, 25, 45, 60, 80]) for (const off of [[0.003, 0.007], [0.047, 0.031], [0.071, 0.088], [0.025, 0.066]] as Vec2[]) poses.push([deg * Math.PI / 180, off]);
  for (const [a, b] of [['centre', 'centre'], ['centre', 'conservative'], ['conservative', 'conservative']] as [Raster, Raster][]) {
    const w = clearWay(a, b);
    for (const [yaw, off] of poses) assert.ok(passes(w, a, b, yaw, off), `${a}|${b} gap ${w.toFixed(2)} m at yaw ${yaw.toFixed(2)} off ${off}`);
    const dense: [number, Vec2][] = [];
    for (let deg = 0; deg <= 90; deg += 5) for (const off of [[0.003, 0.007], [0.047, 0.031], [0.071, 0.088], [0.025, 0.066], [0.09, 0.012], [0.058, 0.049]] as Vec2[]) dense.push([deg * Math.PI / 180, off]);
    assert.ok(dense.some(([yaw, off]) => !passes(w - 0.1, a, b, yaw, off)), `${a}|${b}: ${(w - 0.1).toFixed(2)} m passes everywhere: the rule is looser than it needs`);
  }
});
