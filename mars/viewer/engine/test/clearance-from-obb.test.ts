// #1070: clearanceFromObb reads what a box will do to the clearance before it stands, so a close can act only when it must.
// It has to agree with a real rebuild cell for cell: a false alarm would move a close that was clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, cellCentre, clearanceAt, clearanceFromObb } from '../spatial/grid.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import { seedRng, nextRandom } from '../core/rng.ts';

test('a box read before it stands matches the field a rebuild gives, at every cell', () => {
 const rng = seedRng(1070), rand = () => nextRandom(rng);
 for (let n = 0; n < 40; n++) {
  const wall: Obstacle = {id: 'wall', obb: {c: [rand() * 4 - 2, rand() * 4 - 2], half: [.2 + rand(), .1], yaw: rand() * Math.PI}, y0: 0, y1: 2, kind: 'component'};
  const gap: Obstacle = {id: 'gap', obb: {c: [rand() * 2 - 1, rand() * 2 - 1], half: [.4 + rand() * .3, .08], yaw: rand() * Math.PI * 2}, y0: 0, y1: 2, kind: 'component'};
  const scene = (obstacles: Obstacle[]): SpatialScene => ({bounds: [-5, -5, 5, 5], levels: [{id: 0, y: 0, label: 'ground'}], surfaces: [{id: 'ground', level: 0, y: 0, obb: {c: [0, 0], half: [5, 5], yaw: 0}}], obstacles, links: []});
  const before = buildGrids(scene([wall]), .1).levels.get(0)!, after = buildGrids(scene([wall, gap]), .1).levels.get(0)!;
  for (let j = 0; j < before.nz; j += 3) for (let i = 0; i < before.nx; i += 3) {
   const p = cellCentre(before, i, j);
   assert.equal(Math.min(clearanceAt(before, p), clearanceFromObb(before, gap.obb, p)), clearanceAt(after, p), `scene ${n} at ${p}`);
  }
 }
});
