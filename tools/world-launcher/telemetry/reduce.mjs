// CW4 (#738): reducing samples over time without lying. Pure.
//  counter  → increase (reset-aware: a value that went down started again from 0), resets, first/last
//  gauge    → min / mean / max / first / last / rise (sum of positive steps, e.g. tick progress), over answered samples only
//  quantile → max and last only: a p99 is never averaged
// Coverage counts answered samples against those expected at the cadence; a gap is absent, never zero.
import { kindOf, labelsOf } from './prom.mjs';

const K = { counter: 'c', gauge: 'g', quantile: 'q' };

/** Two answered samples are adjacent when no gap row lies between them and they are at most 2.5 intervals apart: only
 *  then does their step count towards a rate (covMs, covInc, covRise). Totals (inc, rise) keep every step. */
export const adjacent = (dt, everyMs) => dt > 0 && dt <= 2.5 * everyMs;

/** rows: [{t, ok, values: Map}] in time order → {from, to, everyMs, samples, gaps, expected, skewMaxMs, series}. */
export function reduceRows(rows, types, { from, to, everyMs }) {
  const series = {}, inRange = rows.filter((r) => r.t >= from && r.t < to);
  let samples = 0, gaps = 0, skewMaxMs = 0, broken = true;
  for (const r of inRange) {
    if (!r.ok) { gaps++; broken = true; continue; }
    samples++; if (r.skewMs != null) skewMaxMs = Math.max(skewMaxMs, Math.abs(r.skewMs));
    for (const [key, v] of r.values) {
      let s = series[key];
      if (!s) { const { name, labels } = labelsOf(key), kind = K[kindOf(name, labels, types)]; s = series[key] = kind === 'c' ? { k: 'c', inc: 0, resets: 0, first: v, last: v, n: 0, covInc: 0 } : kind === 'q' ? { k: 'q', max: v, last: v, n: 0 } : { k: 'g', min: v, max: v, sum: 0, n: 0, first: v, last: v, rise: 0, covRise: 0 }; s.firstT = r.t; s.covMs = 0; }
      const adj = s.n && !broken && s.lastT !== undefined && adjacent(r.t - s.lastT, everyMs);
      if (adj) s.covMs += r.t - s.lastT;
      if (s.k === 'c') { if (s.n) { const step = v >= s.last ? v - s.last : v; if (v < s.last) s.resets++; s.inc += step; if (adj) s.covInc += step; } s.last = v; }
      else if (s.k === 'q') { s.max = Math.max(s.max, v); s.last = v; }
      else { s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); s.sum += v; if (s.n && v > s.last) { s.rise += v - s.last; if (adj) s.covRise += v - s.last; } s.last = v; }
      s.n++; s.lastT = r.t;
    }
    broken = false;
  }
  return { from, to, everyMs, samples, gaps, expected: Math.round((to - from) / everyMs), skewMaxMs, series };
}

/** One closed hour of a fine file (store.mjs readHour) → its rollup line. */
export function reduceHour(hour, hourData, types, everyMs) {
  return { hour, restarts: hourData.restarts, ...reduceRows(hourData.rows, types, { from: hour, to: hour + 3_600_000, everyMs }) };
}

/** Two consecutive reductions (a before b) → one. Counter increases include the step across the boundary. */
export function merge(a, b) {
  if (!a) return b; if (!b) return a;
  const series = { ...a.series };
  for (const [key, y] of Object.entries(b.series)) {
    const x = series[key];
    if (!x) { series[key] = { ...y }; continue; }
    const dt = (y.firstT ?? 0) - (x.lastT ?? 0), adj = adjacent(dt, a.everyMs), t = { firstT: x.firstT, lastT: y.lastT, covMs: (x.covMs ?? 0) + (y.covMs ?? 0) + (adj ? dt : 0) };
    if (x.k === 'c') { const step = y.first >= x.last ? y.first - x.last : y.first; series[key] = { k: 'c', inc: x.inc + step + y.inc, covInc: (x.covInc ?? 0) + (y.covInc ?? 0) + (adj ? step : 0), resets: x.resets + y.resets + (y.first < x.last ? 1 : 0), first: x.first, last: y.last, n: x.n + y.n, ...t }; }
    else if (x.k === 'q') series[key] = { k: 'q', max: Math.max(x.max, y.max), last: y.last, n: x.n + y.n, ...t };
    else { const step = Math.max(0, y.first - x.last); series[key] = { k: 'g', min: Math.min(x.min, y.min), max: Math.max(x.max, y.max), sum: x.sum + y.sum, n: x.n + y.n, first: x.first, last: y.last, rise: x.rise + y.rise + step, covRise: (x.covRise ?? 0) + (y.covRise ?? 0) + (adj ? step : 0), ...t }; }
  }
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to), everyMs: a.everyMs, samples: a.samples + b.samples, gaps: a.gaps + b.gaps, expected: a.expected + b.expected,
    skewMaxMs: Math.max(a.skewMaxMs, b.skewMaxMs), restarts: (a.restarts ?? 0) + (b.restarts ?? 0), series };
}

/** A series' stats as plain numbers: mean over its own answered samples; coverage per series, not per range. */
export function view(s) {
  if (!s) return null;
  // perSecond: over covered time only (steps between adjacent answered samples), so a gap neither adds time nor inflates a rate
  const per = (x) => (s.covMs ? x / (s.covMs / 1000) : null);
  if (s.k === 'c') return { increase: s.inc, resets: s.resets, last: s.last, samples: s.n, perSecond: per(s.covInc ?? 0), coveredSeconds: (s.covMs ?? 0) / 1000 };
  if (s.k === 'q') return { max: s.max, last: s.last, samples: s.n };
  return { min: s.min, mean: s.n ? s.sum / s.n : null, max: s.max, last: s.last, rise: s.rise, risePerSecond: per(s.covRise ?? 0), samples: s.n, coveredSeconds: (s.covMs ?? 0) / 1000 };
}
