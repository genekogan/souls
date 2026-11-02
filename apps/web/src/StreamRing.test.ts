// Lane PERF-STREAM: the distance ring that decides what is built (StreamRing.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamRing, sectorsWithin, sectorDistance } from './StreamRing.ts';

test('things enter within inner, nearest first; leave only beyond outer (hysteresis)', () => {
  const ring = new StreamRing({ inner: 100, outer: 150, cell: 50, step: 0 });
  ring.set('a', 10, 0); ring.set('b', 90, 0); ring.set('c', 120, 0); ring.set('d', 400, 400);
  const first = ring.update(0, 0);
  assert.deepEqual(first, { enter: ['a', 'b'], leave: [] });
  assert.ok(ring.isWanted('a') && ring.isWanted('b') && !ring.isWanted('c') && !ring.isWanted('d'));
  // the camera moves 40 m towards c: b is now 50 m away, c 80 m (enters), a 50 m (stays)
  const second = ring.update(40, 0);
  assert.deepEqual(second, { enter: ['c'], leave: [] });
  // back to 130 m from a: a is between inner and outer, so it stays; move so that a is 160 m away: it leaves
  assert.deepEqual(ring.update(140, 0), { enter: [], leave: [] });
  const third = ring.update(170, 0);
  assert.deepEqual(third.leave, ['a']); assert.deepEqual(third.enter, []);
  assert.ok(!ring.isWanted('a') && ring.isWanted('b') && ring.isWanted('c'));
  // a whole far cell drops at once
  ring.set('d', 0, 0); assert.deepEqual(ring.update(170, 0, true).enter, []);   // d is 170 m away: not wanted
  ring.update(0, 0, true); assert.ok(ring.isWanted('d'));
  assert.deepEqual(ring.update(600, 600, true).leave.sort(), ['a', 'b', 'c', 'd']);
  assert.equal(ring.wanted.size, 0);
});

test('radius: a long shape is wanted when its reach is near; pinned things always; step gates updates', () => {
  const ring = new StreamRing({ inner: 100, outer: 150, cell: 96, step: 10 });
  ring.set('road', 500, 0, 450);   // reaches to x = 50
  ring.set('soul', 2000, 2000, 0, true);
  ring.set('shed', 2000, 2100, 0);
  const r = ring.update(0, 0);
  assert.deepEqual(r.enter, ['soul', 'road']);
  assert.ok(ring.isWanted('soul'));
  assert.deepEqual(ring.update(5, 0), { enter: [], leave: [] });   // under step: nothing re-evaluated
  assert.equal(ring.update(2000, 2000).leave.length, 1);          // the road left, the soul stays
  assert.ok(ring.isWanted('soul') && !ring.isWanted('road') && ring.isWanted('shed'));
  ring.delete('soul'); assert.ok(!ring.isWanted('soul') && !ring.has('soul'));
});

test('probe: a thing that arrives in a diff is wanted at once when it is near the last centre', () => {
  const ring = new StreamRing({ inner: 100, outer: 150, step: 0 });
  assert.equal(ring.probe('x'), false);
  ring.set('x', 20, 20); assert.equal(ring.probe('x'), false);   // no centre yet
  ring.update(0, 0);
  ring.set('y', 30, 0); assert.equal(ring.probe('y'), true); assert.ok(ring.isWanted('y'));
  ring.set('z', 300, 0); assert.equal(ring.probe('z'), false);
  // a wanted thing that moves far away stays wanted until the next update
  ring.set('y', 900, 0); assert.ok(ring.isWanted('y'));
  assert.deepEqual(ring.update(0, 0, true).leave, ['y']);
  assert.deepEqual(ring.within(0, 0, 50), ['x']);
});

test('sectors within a radius, nearest first, clipped to the extent', () => {
  const keys = sectorsWithin(10, 10, 300, 256, [-500, -500, 4500, 1500]);
  assert.equal(keys[0], '0,0');
  assert.ok(keys.includes('-1,-1') && keys.includes('1,0') && !keys.includes('1,1') && !keys.includes('2,0'));   // 1,1 is 348 m away, 2,0 502 m
  assert.ok(keys.includes('-2,0') && !keys.some((k) => k.startsWith('-3,')));   // -2 starts at -512 and holds the extent's edge (-500); -3 is outside
  assert.equal(sectorDistance('2,0', 10, 10, 256), 502);
  assert.equal(sectorDistance('0,0', 10, 10, 256), 0);
});

test('moving entries retain only occupied cells while preserving wanted state and shared cells', () => {
  const ring = new StreamRing({ inner: 10, outer: 20, cell: 8, step: 0 });
  ring.set('anchor', 0, 0); ring.set('moving', 1, 1);
  ring.update(0, 0); assert.equal(ring.cellCount, 1);
  for (let i = 1; i <= 1000; i++) {
    const x = i * 8, z = -i * 8;
    ring.set('moving', x, z);
    assert.equal(ring.cellCount, 2, 'old empty cells are removed, the anchor cell stays');
    assert.equal(ring.isWanted('moving'), true, 'moving preserves wanted state until update');
    assert.deepEqual(ring.within(x, z, 0), ['moving']);
    ring.set('moving', x + .25, z + .25, 1);
    assert.equal(ring.cellCount, 2, 'same-cell moves and radius changes do not retain another cell');
  }
  assert.deepEqual(ring.update(0, 0).leave, ['moving']);
  ring.set('moving', 1, 1); assert.equal(ring.cellCount, 1);
  assert.equal(ring.probe('moving'), true);
  ring.delete('moving'); assert.equal(ring.cellCount, 1);
  ring.delete('anchor'); assert.equal(ring.cellCount, 0);
  ring.clear(); assert.equal(ring.cellCount, 0);
});
