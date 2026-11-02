import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel } from '@sim/world-compiler';
import { waterLevelAt, type Ground, type Water } from '@sim/ground';
import { surroundings, waterAt } from './motion.ts';

function world(waters: Water[], seaLevel?: number) {
  const model = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'motion-water' });
  model.ground().waters = structuredClone(waters); model.ground().seaLevel = seaLevel;
  return model;
}
const river = (): Water => ({ id: 'river', path: [[-8, 0], [0, 0], [8, 0]], w: 4, level: 2, levels: [2, 6, 10] });
const pond = (): Water => ({ id: 'pond', area: [[-2, -2], [2, -2], [2, 2], [-2, 2]], level: 12 });
const far = (): Water => ({ id: 'far', path: [[100, 100], [110, 100]], w: 2, level: 99 });

/** Exact previous motion kernel, including ordered overwrites, half widths, constant levels and NaN propagation. */
function original(g: Ground, x: number, z: number): number | null {
  let level: number | null = null;
  for (const w of g.waters) {
    let inside = false;
    if (w.area) for (let i = 0, j = w.area.length - 1; i < w.area.length; j = i++) {
      const [xi, zi] = w.area[i], [xj, zj] = w.area[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (w.area && inside) level = w.level;
    else if (w.path && w.w) {
      let best = Infinity;
      for (let i = 1; i < w.path.length; i++) {
        const [ax, az] = w.path[i - 1], [bx, bz] = w.path[i];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      if (best < w.w / 2) level = w.level;
    }
  }
  return level ?? (g.seaLevel !== undefined ? g.seaLevel : null);
}
const check = (m: WorldModel, x: number, z: number) => assert.equal(waterAt(m, x, z), original(m.ground(), x, z), `query ${x},${z}`);

test('motion water retains half width, strict end caps, constant levels and last matching water', () => {
  const m = world([river()]);
  assert.equal(waterAt(m, 0, 1.999999999), 2); assert.equal(waterAt(m, 0, 2), null);
  assert.equal(waterAt(m, 10, 0), null); assert.equal(waterAt(m, 9.999999999, 0), 2);
  assert.equal(waterLevelAt(m.ground(), 0, 3), 6); assert.equal(waterAt(m, 0, 3), null);
  m.ground().waters.push(pond()); assert.equal(waterAt(m, 0, 0), 12);
  m.ground().waters.reverse(); assert.equal(waterAt(m, 0, 0), 2);
  m.ground().seaLevel = -7; assert.equal(waterAt(m, 1000, 1000), -7);
});

test('motion water matches the previous oracle over negative edges, degenerate segments, bridges and water order', () => {
  const bridged: Water = { id: 'bridge', level: 5, area: [[-9, -9], [9, -9], [9, 9], [-9, 9], [-9, -9], [-3, -3], [-3, 3], [3, 3], [3, -3], [-3, -3], [-9, -9]] };
  const duplicate: Water = { id: 'duplicate', path: [[-6, -6], [-6, -6], [6, 6]], w: 2, level: 1 };
  for (const waters of [[river(), pond(), far()], [pond(), far(), river()], [duplicate, bridged, river()], [bridged, duplicate], [{ ...pond(), ...river(), area: pond().area }]]) {
    for (const sea of [undefined, 0, -3]) {
      const m = world(waters, sea);
      for (let x = -12; x <= 12; x += .5) for (let z = -12; z <= 12; z += .5) check(m, x, z);
    }
  }
});

test('motion water preserves rounding at large coordinates and uses exhaustive arithmetic outside the bounded domain', () => {
  for (const offset of [0, -(2 ** 40), 2 ** 40 - 8, 2 ** 40, 2 ** 41, 1e100, 1e200]) for (const width of [2 ** -20, 2, 2 ** 20, 2 ** 41]) {
    const m = world([{ id: 'diagonal', path: [[offset, offset], [offset + 8, offset + 3]], w: width, level: 7 }], -1);
    for (const d of [-width, -width / 2 - 1e-9, -width / 2, -width / 2 + 1e-9, 0, width / 2 - 1e-9, width / 2, width / 2 + 1e-9, width]) {
      check(m, offset + d, offset); check(m, offset + 8 + d, offset + 3); check(m, offset + 4, offset + 1.5 + d);
    }
  }
});

test('nonfinite segments retain NaN poisoning even when another segment is near, and invalid widths/queries retain old results', () => {
  for (const bad of [NaN, Infinity, -Infinity, 1e200]) for (const reverse of [false, true]) {
    const path: [number, number][] = [[-8, 0], [8, 0], [bad, 100], [100, 100]];
    if (reverse) path.reverse();
    const m = world([{ id: 'mixed', path, w: 4, level: 7 }], -1);
    for (const [x, z] of [[0, 0], [100, 100], [NaN, 0], [Infinity, 0], [0, -Infinity]]) check(m, x, z);
  }
  for (const width of [0, -2, NaN, Infinity, -Infinity, Number.MIN_VALUE]) {
    const m = world([{ ...river(), w: width }]); check(m, 0, 0); check(m, 1000, 1000);
  }
  const poisoned = world([{ id: 'mixed', path: [[-8, 0], [8, 0], [NaN, 0]], w: 4, level: 7 }], -1);
  assert.equal(waterAt(poisoned, 0, 0), -1, 'a near early segment cannot short-circuit a later NaN');
});

test('immediate in-place points, widths, levels, order, areas and sea edits plus setWater remain visible to retained surroundings', () => {
  const m = world([river()]), s = surroundings(m, [0, 0], 12, 'land', new Set());
  const at = () => check(m, 0, 0);
  at(); assert.equal(s.free(0, 0, .1), false);
  m.ground().waters[0].path!.forEach(p => { p[1] += 100; }); at(); assert.equal(s.free(0, 0, .1), true);
  m.ground().waters[0].w = 300; at(); assert.equal(s.free(0, 0, .1), false);
  m.ground().waters[0].level = -10; at(); assert.equal(s.free(0, 0, .1), true);
  m.ground().waters.push(pond()); at(); assert.equal(waterAt(m, 0, 0), 12);
  m.ground().waters.reverse(); at(); assert.equal(waterAt(m, 0, 0), -10);
  m.ground().waters.splice(1); m.ground().waters[0].area!.forEach(p => { p[0] += 100; }); at();
  m.ground().seaLevel = 20; at(); assert.equal(s.free(0, 0, .1), false);
  delete m.ground().seaLevel; at(); assert.equal(s.free(0, 0, .1), true);
  m.setWater(river(), 'river'); at(); assert.equal(s.free(0, 0, .1), false);
  m.setWater(null, 'river'); at(); assert.equal(s.free(0, 0, .1), true);
});

test('distant current segments avoid hypot work without a persistent water cache', () => {
  const m = world(Array.from({ length: 1000 }, (_, i) => ({ id: `far-${i}`, path: [[1000 + i, 1000], [1010 + i, 1010]] as [number, number][], w: 4, level: 2 })));
  const hypot = Math.hypot; let calls = 0; Math.hypot = (...values) => { calls++; return hypot(...values); };
  try {
    const expected = original(m.ground(), 0, 0), oldCalls = calls; calls = 0;
    assert.equal(waterAt(m, 0, 0), expected);
    assert.ok(calls < oldCalls / 20, `${calls} hypot calls vs old ${oldCalls}`);
    for (let i = 0; i < 20; i++) {
      const w = m.ground().waters[i]; w.path = [[-8, 0], [8, 0]]; w.level = i;
      assert.equal(waterAt(m, 0, 0), i, 'an edited far segment is tested on the next query');
    }
  } finally { Math.hypot = hypot; }
});
