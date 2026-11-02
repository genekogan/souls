import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrivalMark, whenArrivalCardGone } from './arrival-marks.ts';

test('?shot readiness waits for the card to be gone and faded, gives up at its bound, stops on abort', async (ctx) => {
  let t = 0; const now = () => t, wait = (fn: () => void) => { t += 50; setImmediate(fn); };
  assert.equal(await whenArrivalCardGone({ timeoutMs: 400, now, wait }), false, 'no card-done yet: bounded');
  const abort = new AbortController(); abort.abort();
  assert.equal(await whenArrivalCardGone({ signal: abort.signal, now, wait }), false);
  // The mark and waiter must share one clock. Reading the real clock after the
  // mark mixed elapsed wall time and floating-point steps into this deadline.
  ctx.mock.method(performance, 'now', now);
  arrivalMark('card-done');
  const start = t; assert.equal(await whenArrivalCardGone({ fadeMs: 300, now, wait }), true);
  assert.ok(t - start >= 300, 'after the fade');
});

test('LiveWorld sets __shotReady only after the card is gone', () => {
  const src = readFileSync(new URL('./LiveWorld.tsx', import.meta.url), 'utf8');
  const i = src.indexOf('await whenArrivalCardGone({signal:abort.signal});'), j = src.indexOf('__shotReady=true');
  assert.ok(i > 0 && j > i, 'the card wait comes before the ready flag');
});
