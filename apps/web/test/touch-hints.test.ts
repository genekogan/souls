import test from 'node:test';
import assert from 'node:assert/strict';
import { hintsAllowed } from '../src/touch/hints-policy.ts';
import { hapticTick, TICK_MS } from '../src/touch/haptics.ts';

// #893 A2/A3: only touch screens, once per device, never under ?shot or automation unless ?hints=1 asks for it.
test('hints: touch screens only, once per device', () => {
  assert.equal(hintsAllowed({ search: '', webdriver: false, coarse: true, seen: false }), true);
  assert.equal(hintsAllowed({ search: '', webdriver: false, coarse: false, seen: false }), false, 'desktop');
  assert.equal(hintsAllowed({ search: '', webdriver: false, coarse: true, seen: true }), false, 'remembered');
});
test('hints: ?shot and automation never; ?hints=1 beats webdriver only', () => {
  assert.equal(hintsAllowed({ search: '?shot=1', webdriver: false, coarse: true, seen: false }), false);
  assert.equal(hintsAllowed({ search: '', webdriver: true, coarse: true, seen: false }), false);
  assert.equal(hintsAllowed({ search: '?hints=1', webdriver: true, coarse: true, seen: false }), true);
  assert.equal(hintsAllowed({ search: '?hints=1&shot=1', webdriver: true, coarse: true, seen: false }), false);
  assert.equal(hintsAllowed({ search: '?hints=1', webdriver: true, coarse: true, seen: true }), false);
  assert.equal(hintsAllowed({ search: '?hints=1', webdriver: false, coarse: false, seen: false }), false);
});
test('haptics: a short tick on touch screens that vibrate, nothing elsewhere', () => {
  const calls: number[] = [], nav = { vibrate: (ms: number) => { calls.push(ms); return true; } };
  assert.equal(hapticTick(nav, () => true), true); assert.deepEqual(calls, [TICK_MS]);
  assert.equal(hapticTick(nav, () => false), false); assert.equal(hapticTick({}, () => true), false); assert.equal(hapticTick(undefined, () => true), false);
  assert.equal(calls.length, 1);
});
