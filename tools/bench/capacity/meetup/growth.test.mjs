// CW8 A2 (#955): the growth reducer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTERNAL, growth, trend } from './growth.mjs';

const MIN = 60_000, line = (n, f, step = 30_000) => Array.from({ length: n }, (_, i) => ({ t: i * step, v: f(i * step) }));

test('trend: OLS slope per hour, edge medians, R²; never extrapolated', () => {
  const t = trend(line(121, (ms) => 100 + ms / MIN));   // +1 per minute over 60 min
  assert.equal(t.n, 121); assert.equal(t.spanMin, 60); assert.equal(t.slopePerHour, 60); assert.equal(t.r2, 1);
  assert.equal(t.first, 102.5); assert.equal(t.last, 157.5); assert.equal(t.delta, 55);   // medians of the first and last 5 min
  const flat = trend(line(121, () => 42));
  assert.equal(flat.slopePerHour, 0); assert.equal(flat.delta, 0); assert.equal(flat.r2, null, 'no variance: R² is undefined, not 1');
  const noisy = trend(line(121, (ms) => 50 + ((ms / 30_000) % 2 ? 5 : -5)));
  assert.ok(Math.abs(noisy.slopePerHour) < 1 && noisy.r2 < 0.05);
});

test('trend: too few samples or too short a window gives nulls with a reason, never 0', () => {
  for (const pts of [[], line(2, () => 1), line(20, () => 1)]) {   // 20 × 30 s = 9.5 min < two 5-minute edges
    const t = trend(pts); assert.equal(t.slopePerHour, null); assert.equal(t.delta, null); assert.ok(t.why);
  }
  assert.equal(trend([{ t: 0, v: 1 }, { t: 1, v: NaN }, { t: 2, v: null }]).n, 1, 'non-numbers are not samples');
});

test('growth: the warm-up is cut, per world and summed, the worst world named, host series, external never estimated', () => {
  const A0 = 1_000_000, mk = (i) => ({ k: 'res', t: A0 + i * 30_000, telemetryMb: 1 + i * 0.01, diskFreeMb: 5000 - i,
    worlds: { a: { rssMb: i < 20 ? 900 : 500 + i, heapUsedMb: 200, threads: 12 }, b: { rssMb: 400, heapUsedMb: 100 + 2 * i, threads: 12 } } });
  const samples = [...Array.from({ length: 141 }, (_, i) => mk(i)), { k: 'proc', t: A0 + 1 }, { k: 'res', t: A0 + 99 * MIN, worlds: { a: { rssMb: 1e6 } } }];
  const g = growth(samples, { active: [A0, A0 + 70 * MIN], warmupMs: 10 * MIN });
  assert.equal(g.warmupMin, 10); assert.deepEqual(g.residual, { fromMs: 10 * MIN, toMs: 70 * MIN, samples: 121 }, 'after the warm-up, inside the window');
  assert.equal(g.worlds.a.rssMb.slopePerHour, 120, 'the warm-up spike (first 10 min) is not in the trend');
  assert.equal(g.worlds.b.heapUsedMb.slopePerHour, 240); assert.equal(g.worlds.a.heapUsedMb.slopePerHour, 0);
  assert.equal(g.sum.heapUsedMb.slopePerHour, 240); assert.equal(g.sum.threads.first, 24); assert.equal(g.sum.threads.slopePerHour, 0);
  assert.deepEqual(g.worst.heapUsedMb, { world: 'b', slopePerHour: 240 });
  assert.equal(g.worlds.a.dbMb.slopePerHour, null, 'an unreported series is unknown, not flat'); assert.equal(g.sum.dbMb.slopePerHour, null); assert.equal(g.worst.dbMb, null);
  assert.equal(g.host.telemetryMb.slopePerHour, 1.2); assert.equal(g.host.diskFreeMb.slopePerHour, -120);
  assert.deepEqual(g.external, EXTERNAL); assert.equal(g.external.value, null);
});

test('growth: a world missing from a sample never shrinks the sum; no window gives no growth', () => {
  const s = Array.from({ length: 121 }, (_, i) => ({ k: 'res', t: i * 30_000, worlds: i % 10 ? { a: { rssMb: 100 }, b: { rssMb: 100 } } : { a: { rssMb: 100 } } }));
  const g = growth(s, { active: [0, 60 * MIN], warmupMs: 0 });
  assert.equal(g.sum.rssMb.first, 200); assert.equal(g.sum.rssMb.slopePerHour, 0); assert.equal(g.sum.rssMb.n, 108);
  assert.equal(growth(s, { active: [5, 5] }).residual, null);
  assert.equal(growth(s, {}).why, 'no activity window');
});

test('report: the growth table states the warm-up and residual window, and says why a series is unknown', async () => {
  const { growthLines } = await import('./report.mjs');
  const s = Array.from({ length: 141 }, (_, i) => ({ k: 'res', t: i * 30_000, telemetryMb: null, diskFreeMb: 9000, worlds: { a: { rssMb: 500 + i, heapUsedMb: 200, gcPct: 1, queueDepth: 0, threads: 12 } } }));
  const text = growthLines(growth(s, { active: [0, 70 * MIN] })).join('\n');
  assert.match(text, /first 10 min of the activity window are left out/); assert.match(text, /Residual window: 10–70 min, 121 samples/);
  assert.match(text, /\| RSS MB \(sum\) \| 525 → 635 \| 110 \| 120 \| 1 \| a \(120\) \|/);
  assert.match(text, /\| sim\.db MB \(sum\) \| — \(too few samples\) \|/); assert.match(text, /External memory: not exposed/);
  assert.match(growthLines(growth(s, {})).join('\n'), /No growth: no activity window/);
});
