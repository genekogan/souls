import test from 'node:test';
import assert from 'node:assert/strict';
import { groundSchema, pointInPoly, waterLevelAt, type Ground, type Water } from '@sim/ground';
import { waterLevel } from './WorldEntityLayer.ts';

const ground = (waters: Water[], seaLevel?: number): Ground => groundSchema.parse({
  schema: 'ground/1', base: -20, extent: [-1000, -1000, 1000, 1000], landforms: [], waters, seaLevel,
});
const pond = (): Water => ({ id: 'pond', area: [[-2, -2], [2, -2], [2, 2], [-2, 2]], level: 12 });
const river = (): Water => ({ id: 'river', path: [[-8, 0], [0, 0], [8, 0]], w: 4, level: 2, levels: [2, 6, 10] });
const far = (): Water => ({ id: 'far', path: [[100, 100], [110, 100]], w: 2, level: 99 });

/** The pre-optimization wrapper, including the unrelated path branches that repeat a global query. */
function original(g: Ground, x: number, z: number): number | null {
  let level: number | null = null;
  for (const w of g.waters) if (w.area && pointInPoly(x, z, w.area)) level = w.level; else if (w.path && w.w) {
    const lv = waterLevelAt(g, x, z); if (lv !== null) level = lv;
  }
  return level ?? g.seaLevel ?? null;
}

test('water wrapper preserves path-before-area and path-after-area overwrites, including a far path and sea fallback', () => {
  // The wrapper includes this polygon edge, while the global area mask excludes it. A later, unrelated path
  // therefore overwrites the polygon with the global sea result. Filtering out far paths would change the answer.
  assert.equal(waterLevel(ground([far(), pond()], 7), -2, 0), 12);
  assert.equal(waterLevel(ground([pond(), far()], 7), -2, 0), 7);
  assert.equal(waterLevel(ground([far(), pond(), far()], 0), -2, 0), 0);
  assert.equal(waterLevel(ground([pond(), far()]), -2, 0), 12); // null must not overwrite
  assert.equal(waterLevel(ground([river(), pond()]), 0, 0), 12);
  assert.equal(waterLevel(ground([pond(), river()]), 0, 0), 6);
  assert.equal(waterLevel(ground([river()]), 0, 3), 6); // full width and sloping levels, unlike motion.waterAt
});

test('water wrapper agrees exactly with the old ordered oracle at negative coordinates, polygon edges and river end caps', () => {
  const shapes = [pond(), river(), far()];
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const coordinates = [-112, -100, -12.000000001, -12, -11.999999999, -8, -4.000000001, -4, -3.999999999, -2, -1e-10, 0, 1e-10, 2, 3, 3.999999999, 4, 4.000000001, 8, 12, 100, 112];
  for (const order of orders) for (const sea of [undefined, 0, -3]) {
    const g = ground(order.map(i => shapes[i]), sea);
    for (const x of coordinates) for (const z of coordinates) assert.equal(waterLevel(g, x, z), original(g, x, z), `${order}; sea=${sea}; (${x},${z})`);
  }
});

test('water wrapper retains polygon parity through a bridged interior and degenerate path segments', () => {
  const bridged: Water = { id: 'bridged', level: 5, area: [[-9, -9], [9, -9], [9, 9], [-9, 9], [-9, -9], [-3, -3], [-3, 3], [3, 3], [3, -3], [-3, -3], [-9, -9]] };
  const duplicate: Water = { id: 'duplicate', path: [[-6, -6], [-6, -6], [6, 6]], w: 2, level: 1, levels: [1, 4, 10] };
  const g = ground([duplicate, bridged, far()], -2);
  for (let x = -12; x <= 12; x += .5) for (let z = -12; z <= 12; z += .5) assert.equal(waterLevel(g, x, z), original(g, x, z));
});

test('water wrapper sees immediate in-place ground, water, path and area changes between calls', () => {
  const g = ground([river()]);
  const check = (x: number, z: number) => assert.equal(waterLevel(g, x, z), original(g, x, z));
  check(0, 3); assert.equal(waterLevel(g, 0, 3), 6);
  g.waters[0].w = 2; check(0, 3); assert.equal(waterLevel(g, 0, 3), null);
  g.seaLevel = -5; check(0, 3); assert.equal(waterLevel(g, 0, 3), -5);
  g.waters[0].w = 4; g.waters[0].levels![1] = 17; check(0, 3); assert.equal(waterLevel(g, 0, 3), 17);
  g.waters[0].path![1][1] = -10; check(0, 3);
  g.waters.push(pond()); check(0, 0); assert.equal(waterLevel(g, 0, 0), 12);
  g.waters[1].level = 23; check(0, 0); assert.equal(waterLevel(g, 0, 0), 23);
  g.waters[1].area![0][0] = 5; check(0, 0);
  g.waters.reverse(); check(-2, 0);
  g.waters.splice(0, g.waters.length, far()); check(0, 0); assert.equal(waterLevel(g, 0, 0), -5);
  g.waters.length = 0; delete g.seaLevel; check(0, 0); assert.equal(waterLevel(g, 0, 0), null);
});

test('water wrapper performs at most one whole-ground query per invocation, including a null result', () => {
  for (const sea of [undefined, 0, -5]) {
    const g = ground(Array.from({ length: 100 }, (_, i) => ({ ...far(), id: `far-${i}` })), sea);
    let iterations = 0;
    g.waters = new Proxy(g.waters, { get(target, key, receiver) {
      if (key === Symbol.iterator) iterations++;
      return Reflect.get(target, key, receiver);
    } });
    assert.equal(waterLevel(g, 0, 0), sea ?? null);
    assert.equal(iterations, 2, 'one outer pass and one global query, even with 100 path branches');
    iterations = 0; g.waters.push(pond());
    assert.equal(waterLevel(g, 0, 0), 12); assert.equal(iterations, 2);
    iterations = 0; g.waters.splice(0, 100);
    assert.equal(waterLevel(g, 0, 0), 12); assert.equal(iterations, 1, 'polygon-only calls do not query globally');
  }
});
