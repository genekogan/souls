// Lane PERF-EDEN (2026-11-01): the page's polls (god status and inbox, edge items, visitors, Soul chips) kept their full
// rate in a hidden tab and when nothing changed; on souls.game/w/eden that was hundreds of requests in a few minutes,
// each parsed on the main thread between frames. Two small rules every poll shares:
//  - a hidden page does not poll; the next read happens when it is shown again (`whenVisible`);
//  - a poll whose answer did not change backs off (`Backoff`): ×1.5 per unchanged answer up to a cap, back to the base
//    delay on any change.
// Nothing here changes what a poll reads or how it applies the answer.
export const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Run `fn` now when the page is visible, else once it becomes visible. Returns a cancel. */
export function whenVisible(fn: () => void): () => void {
  if (!pageHidden()) { fn(); return () => {}; }
  const on = () => { if (!pageHidden()) { document.removeEventListener('visibilitychange', on); fn(); } };
  document.addEventListener('visibilitychange', on);
  return () => document.removeEventListener('visibilitychange', on);
}

export class Backoff {
  private delay: number;
  // explicit fields, not parameter properties: Node's strip-only TypeScript loader runs the tests
  private readonly base: number; private readonly max: number; private readonly factor: number;
  constructor(base: number, max: number, factor = 1.5) { this.base = base; this.max = max; this.factor = factor; this.delay = base; }
  /** The delay before the next poll, after an answer that `changed` or not. */
  next(changed: boolean): number { this.delay = changed ? this.base : Math.min(this.max, this.delay * this.factor); return this.delay; }
  get current() { return this.delay; }
  reset() { this.delay = this.base; }
}
