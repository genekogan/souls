import test from 'node:test';
import assert from 'node:assert/strict';
import { frameModes, settleKey } from './frame-cadence.mjs';

// Eden 2026's still view on a desktop: base frames 253 draws / 1,592k triangles, every 2nd frame adds the shadow pass.
const BASE = [253, 1_592_406], SHADOW = [339, 2_546_300];
const alternating = (n, first) => Array.from({ length: n }, (_, i) => (i % 2 === 0) === (first === 'base') ? BASE : SHADOW);

test('an alternating series reads the same whichever frame it starts on and however many frames it has', () => {
  for (const [n, first] of [[480, 'base'], [480, 'shadow'], [481, 'base'], [481, 'shadow'], [479, 'shadow']]) {
    const m = frameModes(alternating(n, first));
    assert.deepEqual(m.base, { draws: 253, tris: 1_592_406 });
    assert.deepEqual(m.peak, { draws: 339, tris: 2_546_300 });
    assert.ok(Math.abs(m.peakShare - 0.5) < 0.01);
  }
});

test('a phone cadence (shadow every 3rd frame) and a flat series', () => {
  const phone = Array.from({ length: 300 }, (_, i) => i % 3 === 0 ? SHADOW : BASE);
  assert.equal(frameModes(phone).base.draws, 253); assert.equal(frameModes(phone).peak.draws, 339); assert.equal(frameModes(phone).peakShare, 0.33);
  const flat = Array.from({ length: 100 }, (_, i) => [250 + (i % 3), 1_590_000 + i]);   // within MODE_SPREAD: one mode
  assert.equal(frameModes(flat).peak, null); assert.equal(frameModes(flat).base.draws, 251);
});

test('the settle key is stable across polls of an alternating series and changes while batches still form', () => {
  // polls every 250 ms see ~15 frames, starting on either mode
  const polls = [alternating(15, 'base'), alternating(15, 'shadow'), alternating(14, 'base'), alternating(16, 'shadow')];
  assert.equal(new Set(polls.map(settleKey)).size, 1);
  // the old rule (the last frame's draws) changed from poll to poll on the same view
  assert.equal(new Set(polls.map((f) => f.at(-1)[0])).size, 2);
  const unbatched = alternating(15, 'base').map(([d, t]) => [d + 270, t + 600_000]);   // a not-yet-batched state
  assert.notEqual(settleKey(unbatched), settleKey(polls[0]));
  assert.equal(settleKey([]), null); assert.equal(settleKey([[0, 0]]), null);
});
