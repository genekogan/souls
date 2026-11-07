// L3: roads graded over a hill, auto-bridges, rivers snapped from a lake to a pond with flow and
// waterfalls, decks, scatter rules, pitch frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain, emptyGround, groundSchema, landformSchema, type Ground, type Landform } from '@souls/ground';
import { GENERATORS, arcLengths, areaFrame, centreLine, prepareDeck, prepareFor, prepareRoad, queryOf, scatter2Points, snapRiver, steepest, type TerrainQuery } from './index.ts';

function world(forms: Landform[], waters: Ground['waters'] = []) {
  const g = groundSchema.parse({ ...emptyGround(1000), landforms: forms, waters });
  const t = new Terrain(g);
  return { g, t, q: queryOf({ terrain: t, ground: () => g }) as TerrainQuery };
}
const withLandform = (g: Ground, l: Landform) => { const g2 = { ...g, landforms: [...g.landforms, landformSchema.parse(l)] }; return new Terrain(g2); };

test('road over a hill: prepareRoad caps the grade; the channel landform grades the ground under it', () => {
  const { g, q } = world([{ id: 'hill', kind: 'bump', c: [0, 0], r: 45, h: 14, peak: 1 }]);
  const path: [number, number][] = [[-70, 4], [-20, 0], [20, 2], [70, -3]];
  const raw = centreLine({ path }).map(([x, z]) => q.height(x, z));
  assert.ok(steepest(raw, centreLine({ path })) > 0.25, 'the hill is steeper than a road may be');
  const { grade } = prepareRoad(q, path, { width: 6, maxGrade: 0.08 });
  assert.ok(steepest(grade.h!, centreLine({ path })) <= 0.08 + 1e-6, `profile grade ${steepest(grade.h!, centreLine({ path }))}`);
  assert.ok(grade.cut! > 3, `cuts through the crest (${grade.cut} m)`);
  const b = GENERATORS['road/1'].physics({ params: { width: 6, maxGrade: 0.08, shoulder: 0.6, grade: grade as never }, args: {}, seed: 0, shape: { path } });
  assert.equal(b.landform?.kind, 'channel');
  const t2 = withLandform(g, { ...(b.landform as object), id: 'road' } as Landform);
  const c = centreLine({ path }), s = arcLengths(c);
  let worst = 0; for (let i = 1; i < c.length; i++) worst = Math.max(worst, Math.abs(t2.sample(c[i][0], c[i][1]) - t2.sample(c[i - 1][0], c[i - 1][1])) / (s[i] - s[i - 1]));
  assert.ok(worst < 0.1, `graded ground along the road ${worst.toFixed(3)}`);
  assert.ok(b.surfaces!.some((x) => x.tag === 'shoulder') && b.surfaces!.some((x) => x.tag === 'road'));
  // a stale grade (path changed) is ignored, with a note
  const stale = GENERATORS['road/1'].physics({ params: { maxGrade: 0.08, grade: grade as never }, args: {}, seed: 0, shape: { path: [[-70, 0], [70, 0]] } });
  assert.ok(!stale.landform && stale.notes!.some((x) => x.includes('stale')));
});

test('auto-bridge: a road across a river gets a span with a deck above the water and leaves the river bed alone', () => {
  const river = { id: 'r', path: [[0, -80], [0, 80]] as [number, number][], w: 8, level: -0.3 };
  const { q } = world([{ id: 'bed', kind: 'carve', path: river.path, w: 6, bed: -1.6, edge: 3 }], [river]);
  const path: [number, number][] = [[-40, 0], [40, 0]];
  const { grade } = prepareRoad(q, path, { width: 5, maxGrade: 0.08 });
  assert.equal(grade.spans!.length, 1);
  const sp = grade.spans![0];
  assert.ok(sp.from < 36 && sp.to > 44 && sp.y0 >= -0.3 + 1.4 - 1e-9, JSON.stringify(sp));
  const b = GENERATORS['road/1'].physics({ params: { width: 5, maxGrade: 0.08, grade: grade as never }, args: {}, seed: 0, shape: { path } });
  const decks = b.surfaces!.filter((x) => x.tag === 'bridge') as ({ abs?: boolean; y: number })[];
  assert.ok(decks.length >= 3 && decks.every((d) => d.abs && d.y > 1), 'deck quads at absolute heights above the water');
  assert.ok(b.colliders.filter((c) => c.tag === 'rail').length >= 2 * decks.length);
  const lf = b.landform as { strength?: number[] }; assert.ok(lf.strength!.some((v) => v === 0), 'grading off under the span');
  assert.ok(grade.fill! > 1, 'approach embankments');
});

test('river: snapRiver snaps the ends into a lake and a pond, flows downhill, falls over a cliff', () => {
  const lake = [[-120, -20], [-80, -20], [-80, 20], [-120, 20]] as [number, number][];
  const pond = [[80, -10], [100, -10], [100, 10], [80, 10]] as [number, number][];
  const { q } = world([
    { id: 'shelf', kind: 'plateau', area: [[-200, -100], [0, -100], [0, 100], [-200, 100]], h: 6, edge: 4 },
    { id: 'lake', kind: 'carve', area: lake, bed: 1, edge: 3 },
    { id: 'pond', kind: 'carve', area: pond, bed: -2, edge: 3 },
  ], [{ id: 'lake', area: lake, level: 5.6 }, { id: 'pond', area: pond, level: -0.3 }]);
  const r = snapRiver(q, [[-70, 0], [0, 4], [70, 0]], { width: 5 });
  assert.ok(r.path[0][0] < -80 && r.path[r.path.length - 1][0] > 80, `ends moved into the bodies: ${JSON.stringify([r.path[0], r.path[r.path.length - 1]])}`);
  const L = r.params.flow.levels;
  assert.equal(L[0], 5.6); assert.equal(L[L.length - 1], -0.3);
  for (let i = 1; i < L.length; i++) assert.ok(L[i] <= L[i - 1] + 1e-9, 'never flows uphill');
  assert.ok(r.params.flow.falls!.length >= 1, 'a waterfall where the shelf drops');
  assert.equal(r.params.flow.source, 'lake'); assert.equal(r.params.flow.mouth, 'pond');
  const b = GENERATORS['river/1'].physics({ params: { width: 5, depth: 1.2, banks: 'sand', bankWidth: 2, ...r.params } as never, args: {}, seed: 0, shape: { path: r.path } });
  const w = b.water as { levels?: number[]; level: number };
  assert.equal(w.levels!.length, L.length); assert.equal(w.level, -0.3);
  assert.equal(b.landform!.kind, 'channel');
  assert.ok(b.surfaces!.filter((x) => x.tag === 'shore').length === 2 && b.notes!.some((x) => x.startsWith('waterfall')));
  // prepareFor dispatches the same thing
  const p = prepareFor('river/1', q, { path: [[-70, 0], [0, 4], [70, 0]] }, { width: 5 });
  assert.deepEqual(p!.path, r.path);
});

test('pier and deck heights freeze above the water', () => {
  const lake = [[0, -20], [40, -20], [40, 20], [0, 20]] as [number, number][];
  const { q } = world([{ id: 'lake', kind: 'carve', area: lake, bed: -3, edge: 3 }], [{ id: 'lake', area: lake, level: -0.4 }]);
  const pier = prepareDeck(q, { path: [[-6, 0], [20, 0]] }, { height: 0.7 });
  assert.ok(Math.abs(pier.at.y! - 0.3) < 1e-9 || pier.at.y! > 0.3, `pier deck ${pier.at.y}`);
  const b = GENERATORS['pier/1'].physics({ params: { width: 2.4, height: 0.7, platform: 5, rails: true, at: pier.at as never }, args: {}, seed: 0, shape: { path: [[-6, 0], [20, 0]] } });
  assert.ok(b.surfaces!.every((s) => (s as { abs?: boolean }).abs && s.y === pier.at.y) && b.slots.length === 1);
});

test('scatter/2: reeds only by the water, rocks only on the steep, nothing on blocked ground', () => {
  const pond = [[-10, -10], [10, -10], [10, 10], [-10, 10]] as [number, number][];
  const { q } = world([
    { id: 'pond', kind: 'carve', area: pond, bed: -1.5, edge: 2 },
    { id: 'crag', kind: 'bump', c: [40, 0], r: 14, h: 12, peak: 2 },
  ], [{ id: 'pond', area: pond, level: -0.2 }]);
  const area = [[-30, -30], [60, -30], [60, 30], [-30, 30]] as [number, number][];
  const palette = [{ kind: 'reed', weight: 5, nearWater: 3, wet: 0.5 }, { kind: 'rock', weight: 3, minSlope: 0.5 }, { kind: 'oak', weight: 4, farWater: 6, maxSlope: 0.4 }];
  const blocked = (x: number, z: number) => x > 15 && x < 25 && z > -5 && z < 5;
  const pts = scatter2Points(area, { palette: palette as never, density: 0.08, cluster: 0.3, minSpacing: 1.2 }, 7, q, blocked);
  assert.ok(pts.length > 100, `${pts.length} points`);
  const near = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) - 10;
  for (const p of pts) {
    if (p.k === 0) assert.ok(near(p.x, p.z) <= 3.5, `reed at ${p.x},${p.z}`);
    if (p.k === 1) assert.ok(q.slope(p.x, p.z) >= 0.5);
    if (p.k === 2) assert.ok(q.slope(p.x, p.z) <= 0.4 && near(p.x, p.z) > 5);
    assert.ok(!blocked(p.x, p.z));
  }
  assert.ok(pts.some((p) => p.k === 0) && pts.some((p) => p.k === 1) && pts.some((p) => p.k === 2), 'all three species appear');
  assert.deepEqual(pts, scatter2Points(area, { palette: palette as never, density: 0.08, cluster: 0.3, minSpacing: 1.2 }, 7, q, blocked), 'deterministic');
});

test('pitch frame follows the long side; every L3 generator bakes with defaults', () => {
  const f = areaFrame([[0, 0], [10, 6], [4, 16], [-6, 10]]);
  assert.ok(Math.abs(f.hl - Math.hypot(10, 6) / 2) < 1e-6 || f.hl >= f.hw);
  const pitch = GENERATORS['pitch/1'].physics({ params: { sport: 'football' }, args: {}, seed: 0, shape: { area: [[-50, -32], [50, -32], [50, 32], [-50, 32]] } });
  assert.equal(pitch.colliders.filter((c) => c.tag === 'goal-post').length, 4);
  for (const id of ['cliff/1', 'terrace/1', 'channel/1', 'brush/1', 'shore/1', 'pier/1']) assert.ok(GENERATORS[id], id);
  const wall = GENERATORS['wall/1'].physics({ params: { height: 2, thickness: 0.4, gates: [{ at: 5, width: 2 }] as never }, args: {}, seed: 0, shape: { path: [[0, 0], [10, 0], [10, 10]] } });
  assert.equal(wall.openings!.length, 1); assert.equal(wall.colliders.length, 3);
});
