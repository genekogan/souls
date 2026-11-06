// Harness check H-a (server-reliability tranche, L6): a playtest's verdicts are about the product only if the world was
// ticking at its nominal rate while the Souls played. From /healthz at provision and at close: tick service =
// ticks run / ticks due (20 per wall-clock s, TICK_MS 50; a dilated clock, clockRate < 1, is the starvation itself). Below 0.8 the run is marked infrastructure-invalid:
// a starved host, not a product result (docs/process/lessons.md).
export const H_A_MIN_SERVICE = 0.8;
export const NOMINAL_TICKS_PER_S = 20;

/** before/after: healthz bodies with `at` (ms) added by the harness. → {service, valid, ticks, seconds, reason?} */
export function tickValidity(before, after, min = H_A_MIN_SERVICE) {
  if (!before?.ok || !after?.ok || !Number.isFinite(before.tick) || !Number.isFinite(after.tick) || !Number.isFinite(before.at) || !Number.isFinite(after.at))
    return { valid: null, reason: 'healthz before/after missing: tick service not measured' };
  const seconds = (after.at - before.at) / 1000, ticks = after.tick - before.tick;
  if (before.paused || after.paused) return { valid: null, ticks, seconds, reason: 'world paused at provision or close: tick service not judged' };
  if (seconds < 10) return { valid: null, ticks, seconds, reason: 'run shorter than 10 s: tick service not judged' };
  const service = +(ticks / (seconds * NOMINAL_TICKS_PER_S)).toFixed(3);
  const clockRate = after.clockRate ?? null;
  return service >= min ? { valid: true, service, ticks, seconds, clockRate } : { valid: false, service, ticks, seconds, clockRate, reason: `tick service ${service} < ${min}: the world was starved; verdicts reflect the host, not the product` };
}

// H-a per request (#371): a request's verdict is about the product only if the world kept ticking while that request's
// window was open. The rate comes from the request's own samples (world-truth `tick` + wall time `t`), sentAt..cutoffAt:
// at least two samples at least 2 s apart, else null (not judged). Below 15 ticks/s the window is unscorable (world stalled).
export const MIN_WINDOW_TICKS_PER_S = 15;
export const MIN_WINDOW_SPAN_S = 2;
// H-f: a window the run's end (or a quota stop) cut before its budget elapsed is unscorable too (window truncated).
export const TRUNCATING_CUTOFFS = new Set(['run-end', 'quota']);

/** Ticks per wall-clock second over the samples in sentAt..cutoffAt; null with fewer than 2 samples or under 2 s apart. */
export function windowTickRate(ev) {
  const a = Date.parse(ev?.sentAt ?? ''), b = Date.parse(ev?.cutoffAt ?? '') || Infinity;
  const s = (ev?.samples ?? []).map((x) => ({ tick: x?.tick, ms: Date.parse(x?.t ?? '') })).filter((x) => Number.isFinite(x.tick) && Number.isFinite(x.ms) && (!Number.isFinite(a) || x.ms >= a) && x.ms <= b).sort((x, y) => x.ms - y.ms);
  if (s.length < 2) return null;
  const sec = (s.at(-1).ms - s[0].ms) / 1000;
  if (sec < MIN_WINDOW_SPAN_S) return null;
  return Math.round(((s.at(-1).tick - s[0].tick) / sec) * 100) / 100;
}

/** Whether one request's window can be scored → {scorable, rate, reason: 'stalled'|'truncated'|null, detail}. */
export function windowValidity(ev, { min = MIN_WINDOW_TICKS_PER_S } = {}) {
  const rate = windowTickRate(ev);
  if (rate != null && rate < min) return { scorable: false, rate, reason: 'stalled', detail: `unscorable (world stalled): ${rate} ticks/s in the request window` };
  if (TRUNCATING_CUTOFFS.has(ev?.cutoffReason)) {
    const start = Date.parse(ev.budgetStartAt ?? ev.sentAt ?? ''), end = Date.parse(ev.cutoffAt ?? '');
    const open = Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 1000 : null;
    if (!Number.isFinite(ev.budgetSec) || open == null || open < ev.budgetSec) return { scorable: false, rate, reason: 'truncated', detail: 'unscorable (window truncated by run end)' };
  }
  return { scorable: true, rate, reason: null, detail: null };
}
