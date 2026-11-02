// Per-frame draw calls and triangles come in modes when the app spreads work over frames: a desktop redraws the sun's
// shadow map every 2nd frame and a phone every 3rd (apps/web/src/quality-tier.ts), so the series alternates between base
// frames and shadow frames (Eden 2026 still view: 253 / 339 draws). A p50 of a 50/50 series, or one sampled frame, is
// either mode by parity; that was the probe's intermittent "high-draw state". These read the modes instead.

/** Two frames are one mode when their draw counts are within this share of the smaller (moving people, a lamp's level). */
export const MODE_SPREAD = 0.05;

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.ceil(s.length / 2) - 1]; };

/** `frames`: [draws, triangles] per drawn frame. `base`: the median of the frames without the periodic extra pass,
 *  `peak`: of the frames with it (null when the series has one mode), `peakShare`: how many frames carry it. */
export function frameModes(frames) {
  const drawn = frames.filter(([d]) => d > 0);
  if (!drawn.length) return { base: null, peak: null, peakShare: 0, meanDraws: null, frames: 0 };
  const draws = drawn.map(([d]) => d), lo = Math.min(...draws), hi = Math.max(...draws), mid = (lo + hi) / 2;
  const split = hi - lo > lo * MODE_SPREAD, low = split ? drawn.filter(([d]) => d <= mid) : drawn, high = split ? drawn.filter(([d]) => d > mid) : [];
  const mode = (set) => set.length ? { draws: median(set.map(([d]) => d)), tris: median(set.map(([, t]) => t)) } : null;
  return { base: mode(low), peak: mode(high), peakShare: +(high.length / drawn.length).toFixed(2), meanDraws: +(draws.reduce((n, d) => n + d, 0) / drawn.length).toFixed(1), frames: drawn.length };
}

/** The probe's settle key for the frames drawn since its last poll: settled = this key unchanged for 3 s. It names both
 *  modes, so an alternating series is as stable as a flat one, and a batch, freeze or pool still forming changes it. */
export function settleKey(frames) {
  const m = frameModes(frames);
  if (!m.base) return null;
  return `${m.base.draws}:${Math.round(m.base.tris / 1000)}|${m.peak ? `${m.peak.draws}:${Math.round(m.peak.tris / 1000)}` : '-'}`;
}
