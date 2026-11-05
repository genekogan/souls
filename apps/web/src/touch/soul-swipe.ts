/** #892 one tap follows, a swipe switches. While a touch screen follows a Soul, a fast one-finger horizontal flick goes to the
 * next (left) or previous (right) Soul here; a slower drag is still Follow's orbit. The order is a ring made on a swipe only
 * (never per frame): the followed Soul first, then the others by the director's interest score, then by distance from the
 * followed Soul. Later swipes walk the same ring, so left, left, right visits three different Souls and comes back. */
import { candidates, type DirectorBody, type DirectorInput } from '../WorldDirector.ts';

/** A swipe travels more than SWIPE_MIN_PX sideways, at least SWIPE_RATIO times its vertical travel, within SWIPE_MAX_MS. */
export const SWIPE_MIN_PX = 60, SWIPE_RATIO = 2, SWIPE_MAX_MS = 400;
/** A ring older than this (since its last swipe) is made again on the next swipe. */
export const RING_FRESH_MS = 20_000;

/** +1 next (a flick to the left), -1 previous (to the right), 0 not a swipe. */
export function swipeStep(dx: number, dy: number, ms: number): 1 | -1 | 0 {
  if (!(ms >= 0 && ms <= SWIPE_MAX_MS) || Math.abs(dx) <= SWIPE_MIN_PX || Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export type SwipeSoul = { id: string; entityId: string; p: readonly number[]; activity?: string };

/** The director's interest in each body: the best score of any candidate it is a member of (0 when none). */
export function interestScores(bodies: readonly DirectorBody[], speaking: DirectorInput['speaking'], now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of candidates({ bodies, speaking, now, landmarks: [], arrivals: new Map() }))
    for (const id of c.members) out.set(id, Math.max(out.get(id) ?? 0, c.score));
  return out;
}
/** The followed Soul first, then the others by interest (high first), then distance from the followed Soul (near first). */
export function soulRing(followed: string, souls: readonly SwipeSoul[], score: ReadonlyMap<string, number>): string[] {
  const from = souls.find(s => s.id === followed);
  if (!from) return [];
  const far = (s: SwipeSoul) => Math.hypot(s.p[0] - from.p[0], s.p[2] - from.p[2]);
  const rest = souls.filter(s => s.id !== followed).sort((a, b) =>
    (score.get(b.entityId) ?? 0) - (score.get(a.entityId) ?? 0) || far(a) - far(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [followed, ...rest.map(s => s.id)];
}

/** Walks one ring across swipes; makes it again when it went stale. */
export class SoulSwipe {
  private ring: string[] | null = null;
  private at = -Infinity;
  /** The Soul to follow for this swipe, or null when no other Soul is here. `make` builds a fresh ring (only called here). */
  step(followed: string, present: readonly string[], dir: 1 | -1, now: number, make: () => string[]): string | null {
    const here = new Set(present);
    const stale = !this.ring || now - this.at > RING_FRESH_MS || !this.ring.includes(followed)
      || this.ring.length !== here.size || this.ring.some(id => !here.has(id));
    if (stale) this.ring = make();
    this.at = now;
    const ring = this.ring!;
    if (ring.length < 2) return null;
    const i = ring.indexOf(followed);
    return i < 0 ? null : ring[(i + dir + ring.length) % ring.length];
  }
  reset() { this.ring = null; this.at = -Infinity; }
}
