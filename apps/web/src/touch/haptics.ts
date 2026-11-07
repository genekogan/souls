/** #893: a short vibration tick on a touch screen that supports it (Follow starts, a fly-to arrives); a no-op elsewhere. */
export const TICK_MS = 12;
export function hapticTick(nav: { vibrate?: (ms: number) => boolean } | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  coarse: () => boolean = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } }): boolean {
  try { return !!nav?.vibrate && coarse() ? nav.vibrate(TICK_MS) : false; } catch { return false; }
}
