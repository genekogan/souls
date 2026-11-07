// Lane W1: the world server writes the page's /v1/config into <head> (apps/server/src/inline-config.ts), so the app
// mounts without waiting for that GET (~0.5 s of a warm live arrival: one round trip, behind the snapshot).
export const INLINE_CONFIG_GLOBAL = '__simConfig';

/** The inline config's Clerk satellite setting, without taking the config: the page's first phase asks before the app runs. */
export function inlineClerkSatellite(): boolean {
  const c = (typeof window === 'undefined' ? null : (window as unknown as Record<string, unknown>))?.[INLINE_CONFIG_GLOBAL] as { clerkSatellite?: unknown } | null | undefined;
  return !!c && typeof c === 'object' && !!c.clerkSatellite;
}

/** The page's inline config as the response /v1/config would have given, at most once per page (a retry fetches). */
export function takeInlineConfig(): Promise<Response> | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, unknown> | null;
  const c = w?.[INLINE_CONFIG_GLOBAL];
  if (!w || c === null || typeof c !== 'object') return null;
  delete w[INLINE_CONFIG_GLOBAL];
  return Promise.resolve(new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } }));
}
