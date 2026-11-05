/** #893: when the first-run touch hint may show (see hints.tsx). */
export const HINT_KEY = 'sim.touch-hints', HINT_MS = 3000, HINT_DRAG_PX = 12, HINT_FADE_MS = 400;

/** Whether this page may show the hint at all (before any touch). */
export function hintsAllowed(o: { search: string; webdriver: boolean; coarse: boolean; seen: boolean }): boolean {
  const q = new URLSearchParams(o.search);
  if (!o.coarse || o.seen || q.has('shot')) return false;
  return !o.webdriver || q.get('hints') === '1';
}
