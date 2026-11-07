// #1090: the drawn climb onto a high seat is continuous: the sit blend follows the take's own clock from the sit-down into
// the sit, over the engine's transition time for that seat's rise; a standard seat keeps today's 0.4 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seatBlend } from './humans.ts';
import { sitDuration, SEAT_STANDARD_TOP } from '../../engine/social/actions.ts';

test('seat blend: continuous from the sit-down into the sit on a 1.6 m and a 2.06 m seat; 0.4 s on a standard one', () => {
  for (const seat of [1.6, 2.06]) {
    const dur = sitDuration(Math.hypot(0.5, seat - SEAT_STANDARD_TOP)), down = 0.6 * dur;   // the engine's sit-down ends before the blend
    let prev = 0, maxStep = 0;
    for (let t = 0; t <= dur + 0.5; t += 0.05) {
      const w = t < down ? seatBlend('sit-down', 'sit-down', t, 'idle', undefined, seat) : seatBlend('sit', 'sit', t - down, 'sit-down', down, seat);
      assert.ok(w >= prev - 1e-9, `${seat} m: never back down (${w} after ${prev} at ${t.toFixed(2)} s)`);
      maxStep = Math.max(maxStep, w - prev); prev = w;
    }
    assert.equal(prev, 1, `${seat} m: fully seated`);
    assert.ok(maxStep <= 0.05 / Math.max(0.4, dur) + 1e-6, `${seat} m: no jump (${maxStep} per 50 ms over ${dur} s)`);
    let up = 1; for (let t = 0; t <= dur; t += 0.05) { const w = seatBlend('sit-down', 'stand-up', t, 'sit', 5, seat); assert.ok(w <= up + 1e-9); up = w; }
  }
  assert.equal(seatBlend('sit-down', 'sit-down', 0.2, 'idle', undefined, 0.45), 0.5, 'a standard seat blends over 0.4 s as before');
  assert.equal(seatBlend('sit', 'sit', undefined, undefined, undefined, 1.6), 1, 'no clock: as before');
});
