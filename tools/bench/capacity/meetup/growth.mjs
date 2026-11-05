// CW8 A2 (#955): resource growth over the activity window, with an explicit warm-up. Pure: samples in, numbers out; no
// I/O, no clock. meetup.mjs records the `res` samples (every 30 s); summarize() reduces them here; report.mjs prints them.
// A trend is what the residual window shows, never an extrapolation: a flat window says nothing about indefinite
// stability (CW6 #740 owns the unattended proof).

/** Per-world series a `res` sample carries (meetup.mjs), and which of them add up across worlds. */
export const WORLD_SERIES = Object.freeze(['rssMb', 'heapUsedMb', 'nonHeapMb', 'gcPct', 'queueDepth', 'threads', 'dbMb', 'walMb', 'shmMb', 'dataDirMb']);
export const ADDITIVE = Object.freeze(['rssMb', 'heapUsedMb', 'nonHeapMb', 'threads', 'dbMb', 'walMb', 'shmMb', 'dataDirMb']);
export const HOST_SERIES = Object.freeze(['telemetryMb', 'diskFreeMb']);
export const DEFAULT_WARMUP_MS = 10 * 60_000, EDGE_MS = 5 * 60_000, MIN_POINTS = 3;
/** Not exposed by the server: live.json carries the V8 heap only (apps/server/src/load/shared.ts). Never estimated. */
export const EXTERNAL = Object.freeze({ value: null, why: 'not exposed: live.json carries the V8 heap only; nonHeapMb (RSS - heap used) is shown instead and is only that' });

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));

/** One series [{t ms, v}] over the residual window → {n, spanMin, first, last, delta, slopePerHour, r2}. `first`/`last`
 *  are the medians of the window's first and last 5 minutes; the slope is ordinary least squares. Fewer than 3 points,
 *  or a window shorter than two edges, gives nulls (with `why`), never 0. */
export function trend(points, { edgeMs = EDGE_MS } = {}) {
  const p = points.filter((x) => Number.isFinite(x?.t) && Number.isFinite(x?.v)).sort((a, b) => a.t - b.t), n = p.length;
  const none = (why) => ({ n, spanMin: n ? r((p[n - 1].t - p[0].t) / 60_000, 1) : 0, first: null, last: null, delta: null, slopePerHour: null, r2: null, why });
  if (n < MIN_POINTS) return none('too few samples');
  const t0 = p[0].t, t1 = p[n - 1].t;
  if (t1 - t0 < 2 * edgeMs) return none('window shorter than two 5-minute edges');
  const first = median(p.filter((x) => x.t <= t0 + edgeMs).map((x) => x.v)), last = median(p.filter((x) => x.t >= t1 - edgeMs).map((x) => x.v));
  const mt = p.reduce((s, x) => s + x.t, 0) / n, mv = p.reduce((s, x) => s + x.v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (const x of p) { sxy += (x.t - mt) * (x.v - mv); sxx += (x.t - mt) ** 2; syy += (x.v - mv) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  return { n, spanMin: r((t1 - t0) / 60_000, 1), first: r(first), last: r(last), delta: r(last - first), slopePerHour: r(slope * 3_600_000, 3), r2: syy ? r((sxy * sxy) / (sxx * syy), 3) : null };
}

/** `res` samples ({t, worlds: {slug: {...WORLD_SERIES}}, telemetryMb, diskFreeMb}) and the activity window [t0, t1] →
 *  growth after the warm-up: per world, summed across worlds (additive series), the worst world's slope, and the host. */
export function growth(samples, { active, warmupMs = DEFAULT_WARMUP_MS, slugs } = {}) {
  const [a0, a1] = active ?? [];
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || a1 <= a0) return { warmupMin: r(warmupMs / 60_000, 1), residual: null, why: 'no activity window', external: EXTERNAL };
  const from = a0 + warmupMs, res = samples.filter((x) => x?.k === 'res' && x.t >= from && x.t <= a1);
  const names = slugs ?? [...new Set(res.flatMap((x) => Object.keys(x.worlds ?? {})))].sort();
  const series = (f) => res.map((x) => ({ t: x.t, v: f(x) })).filter((x) => x.v != null && Number.isFinite(x.v));
  const worlds = Object.fromEntries(names.map((w) => [w, Object.fromEntries(WORLD_SERIES.map((k) => [k, trend(series((x) => x.worlds?.[w]?.[k]))]))]));
  // a sum is taken only from samples where every world reported the series (a missing world never shrinks the total)
  const sum = Object.fromEntries(ADDITIVE.map((k) => [k, trend(series((x) => (names.length && names.every((w) => Number.isFinite(x.worlds?.[w]?.[k])) ? names.reduce((s, w) => s + x.worlds[w][k], 0) : null)))]));
  const worst = Object.fromEntries(WORLD_SERIES.map((k) => { const ws = names.map((w) => [w, worlds[w][k].slopePerHour]).filter(([, s]) => s != null); if (!ws.length) return [k, null]; const [w, s] = ws.reduce((m, x) => (x[1] > m[1] ? x : m)); return [k, { world: w, slopePerHour: s }]; }));
  const host = Object.fromEntries(HOST_SERIES.map((k) => [k, trend(series((x) => x[k]))]));
  return { warmupMin: r(warmupMs / 60_000, 1), residual: { fromMs: from - a0, toMs: a1 - a0, samples: res.length }, worlds, sum, worst, host, external: EXTERNAL };
}
