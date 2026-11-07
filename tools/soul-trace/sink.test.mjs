import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSink} from './sink.mjs';

test('sink: one batch in flight, drain waits for it and the queue in order, overflow and failure are counted', async () => {
  const written = [], pending = [];
  const sink = createSink({target: 'x', append: (_t, data, _o, cb) => pending.push(() => { written.push(data); cb(null); }), limits: {queuedBytes: 64, exitBytes: 64, flushMs: 60000}});
  assert.equal(sink.push('a\n'), true);
  sink.flush();
  assert.equal(sink.inFlight, 1);
  sink.push('b\n'); sink.push('c\n');
  sink.flush();
  assert.equal(pending.length, 1, 'never two batches in flight');
  let drained = false;
  const d = sink.drain().then(() => { drained = true; });
  await new Promise(r => setImmediate(r));
  assert.equal(drained, false, 'drain waits for the in-flight batch');
  pending.shift()();
  pending.shift()();
  await d;
  assert.deepEqual(written, ['a\n', 'b\nc\n']);
  assert.equal(sink.push('x'.repeat(65)), false);
  assert.equal(sink.stats.dropped, 1);
  let failed = 0;
  const bad = createSink({target: 'x', append: (_t, _d, _o, cb) => setImmediate(cb, Error('EIO')), onFailure: () => failed++, limits: {queuedBytes: 64, exitBytes: 64, flushMs: 0}});
  bad.push('a\n'); bad.push('b\n');
  await bad.drain();
  assert.equal(failed, 1); assert.equal(bad.disabled, true); assert.equal(bad.stats.dropped, 2); assert.equal(bad.push('c\n'), false);
});
