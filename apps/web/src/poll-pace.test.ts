import test from 'node:test';
import assert from 'node:assert/strict';
import { Backoff, whenVisible } from './poll-pace.ts';

test('Backoff grows ×1.5 on unchanged answers to the cap and returns to base on a change', () => {
  const b = new Backoff(6000, 30000);
  assert.equal(b.next(false), 9000); assert.equal(b.next(false), 13500); assert.equal(b.next(false), 20250); assert.equal(b.next(false), 30000); assert.equal(b.next(false), 30000);
  assert.equal(b.next(true), 6000);
});
test('whenVisible runs at once outside a browser (no document)', () => { let ran = 0; whenVisible(() => ran++); assert.equal(ran, 1); });
