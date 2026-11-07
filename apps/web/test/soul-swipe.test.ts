import test from 'node:test';
import assert from 'node:assert/strict';
import { swipeStep, soulRing, interestScores, SoulSwipe, RING_FRESH_MS, SWIPE_MAX_MS } from '../src/touch/soul-swipe.ts';

// #892: a fast one-finger flick switches Souls; a slow or vertical drag is Follow's orbit.
test('swipe: a fast sideways flick only; left is next, right is previous', () => {
  assert.equal(swipeStep(-120, 10, 200), 1);
  assert.equal(swipeStep(120, -10, 200), -1);
  assert.equal(swipeStep(-50, 0, 100), 0, 'too short');
  assert.equal(swipeStep(-120, 70, 200), 0, 'too diagonal');
  assert.equal(swipeStep(-200, 0, SWIPE_MAX_MS + 1), 0, 'a slow drag still orbits');
});

const souls = [
  { id: 's_a', entityId: 'a', p: [0, 0, 0] },
  { id: 's_b', entityId: 'b', p: [30, 0, 0] },
  { id: 's_c', entityId: 'c', p: [5, 0, 0] },
  { id: 's_d', entityId: 'd', p: [9, 0, 0] },
];

test('ring: followed first, then interest, then distance from the followed Soul', () => {
  assert.deepEqual(soulRing('s_a', souls, new Map()), ['s_a', 's_c', 's_d', 's_b']);
  assert.deepEqual(soulRing('s_a', souls, new Map([['b', 9]])), ['s_a', 's_b', 's_c', 's_d']);
  assert.deepEqual(soulRing('s_x', souls, new Map()), []);
});

test('interest: the director candidates rank a speaker above an idle body', () => {
  const bodies = souls.map(s => ({ id: s.entityId, p: s.p }));
  const score = interestScores(bodies, new Map([['d', { thread: 't1', at: 10 }]]), 10);
  assert.ok((score.get('d') ?? 0) > (score.get('a') ?? 0));
  assert.equal(soulRing('s_a', souls, score)[1], 's_d');
});

test('swipes walk one ring: left, left, right is three different Souls; made only on a swipe', () => {
  const swipe = new SoulSwipe(), ids = souls.slice(0, 3).map(s => s.id);
  let made = 0;
  const make = (from: string) => () => { made++; return soulRing(from, souls.slice(0, 3), new Map()); };
  const b = swipe.step('s_a', ids, 1, 0, make('s_a'));
  const c = swipe.step(b!, ids, 1, 1000, make(b!));
  const back = swipe.step(c!, ids, -1, 2000, make(c!));
  assert.deepEqual([b, c, back], ['s_c', 's_b', 's_c']);
  assert.equal(new Set(['s_a', b, c]).size, 3);
  assert.equal(made, 1, 'the ring is made once for the run');
  swipe.step('s_a', ids, 1, 2000 + RING_FRESH_MS + 1, make('s_a'));
  assert.equal(made, 2, 'a stale ring is made again');
  swipe.step('s_a', [...ids, 's_d'], 1, 2000 + RING_FRESH_MS + 2, make('s_a'));
  assert.equal(made, 3, 'a new Soul here makes it again');
});

test('one Soul: a swipe goes nowhere', () => {
  const swipe = new SoulSwipe();
  assert.equal(swipe.step('s_a', ['s_a'], 1, 0, () => ['s_a']), null);
});
