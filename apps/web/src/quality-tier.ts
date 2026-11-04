// Lane phones (V4): one quality tier per page, picked automatically. A phone (touch-first, short side ≤ 820 CSS px)
// gets the `phone` tier; everything else stays `full`, exactly as before. `?quality=phone|full` overrides for tests and
// for anyone who wants to compare. The tier only changes how the view is drawn (pixel ratio, shadow map, distance
// detail, far stand-ins), never what the world is.
export type QualityTier = 'phone' | 'full';
export type QualitySettings = {
  tier: QualityTier;
  /** Why this tier was chosen (shown in the probe and diagnostics). */
  reason: string;
  /** Upper bound for the drawing-buffer pixels per CSS pixel. */
  maxPixelRatio: number;
  /** Sun shadow map edge in texels. */
  shadowMapSize: number;
  /** Render-time distance detail; null leaves every mesh drawn as before. */
  detail: DistanceDetailOptions | null;
  /** P1 phones: the sun's shadow map is redrawn every n-th frame (1 = every frame). The shadow pass was ~4.5 ms of an
   *  ~18.6 ms frame for Eden 2026 at phone settings (M3 Max 1x; a 4x-throttled phone pays four times that). */
  shadowEvery: number;
  /** Lane PERF-EDEN (2026-11-01): settled, still things of an entity world keep their pose (no per-frame matrix walk) and
   *  are frustum / sub-pixel culled at render time (WorldEntityLayer.freeze/cull). Was phone-only: on Eden 2026 the
   *  desktop tier rewrote ~4,800 poses a frame and culled nothing. */
  freezeStill: boolean;
  /** Bodies (Souls, kin) are posed every frame within `nearM` metres of the eye, every 2nd frame to `farM`, every 4th
   *  beyond, every 8th when outside the view (HumanViews.viewer). The pose is the skinned body's IK, gestures and
   *  library clips: 68 bodies on Eden 2026 each cost it every frame wherever the camera looked. */
  bodies: BodyDetailOptions;
  /** Lane PERF-BAKED-SHADOWS (2026-11-02): still things cast into a cached sun shadow map that is redrawn only when the sun
   *  turns, the view steps or a still thing changes (rendering/SunShadowCache.ts); the per-frame map draws only what moves.
   *  Desktop only (a second shadow lookup per pixel); `?bakedShadows=0` turns it off. */
  bakedShadows: boolean;
};
export type BodyDetailOptions = { nearM: number; farM: number };
export const DESKTOP_BODIES: BodyDetailOptions = Object.freeze({ nearM: 40, farM: 90 });
export const PHONE_BODIES: BodyDetailOptions = Object.freeze({ nearM: 25, farM: 60 });
export type DistanceDetailOptions = {
  /** Meshes whose bounding sphere projects smaller than this many CSS pixels (radius) are not drawn. */
  minRadiusPx: number;
  /** Shadow casters stop casting beyond near + perMetre·radius metres (as WorldShadowDetail does for the Eden expansion). */
  shadowNear: number; shadowPerMetre: number; shadowMaxRadius: number;
  /** Bodies (Souls, kin) further than this many metres stop casting shadows (Infinity: never). */
  standInDistance: number;
  /** Rescan the scene for candidates every n frames. */
  rescanFrames: number;
};
export const PHONE_SHADOW_EVERY = 3;
/** Preserve the baseline phone drawing-buffer cap; `?phoneDpr=` overrides for measurements. */
export const PHONE_PIXEL_RATIO = 1.5;
export const PHONE_DETAIL: DistanceDetailOptions = Object.freeze({ minRadiusPx: 1.25, shadowNear: 24, shadowPerMetre: 14, shadowMaxRadius: 6, standInDistance: 38, rescanFrames: 90 });
/** Release 3.1: desktops get only the invisible part of distance detail — meshes under half a CSS pixel of radius are
 *  not drawn, small casters far away stop casting — and mesh LOD at half a pixel of error. No flat cards, same pixel
 *  ratio and shadow map. `?desktopDetail=0` turns it off. */
export const DESKTOP_DETAIL: DistanceDetailOptions = Object.freeze({ minRadiusPx: 0.5, shadowNear: 60, shadowPerMetre: 30, shadowMaxRadius: 6, standInDistance: Infinity, rescanFrames: 90 });
/** Lane PERF-EDEN (2026-11-01, measured on souls.game/w/eden: ~4,400 shadow casters, ~1,500 draws + a shadow pass of
 *  as many again, 36 fps on an M3 Pro): meshes under one CSS pixel of radius are not drawn, small casters stop casting
 *  beyond 40 m + 20 m per metre of radius (a chair at 50 m, a bench group at 80 m), bodies beyond 60 m cast no shadow,
 *  and the sun's shadow map is redrawn every other frame (`?shadowEvery=1` restores every frame, `?desktopDetail=1` the
 *  release-3.1 values, `?desktopDetail=0` no distance detail at all, as before). */
export const DESKTOP_DETAIL_FAST: DistanceDetailOptions = Object.freeze({ minRadiusPx: 1, shadowNear: 40, shadowPerMetre: 20, shadowMaxRadius: 6, standInDistance: 60, rescanFrames: 90 });
export const DESKTOP_SHADOW_EVERY = 2;

export type QualityEnvironment = { search: string; coarsePointer: boolean; screen: readonly [number, number]; deviceMemory?: number };
export function pickQualityTier(env: QualityEnvironment): QualitySettings {
  const forced = new URLSearchParams(env.search).get('quality');
  const shortSide = Math.min(env.screen[0], env.screen[1]);
  const [tier, reason]: [QualityTier, string] = forced === 'phone' || forced === 'full' ? [forced, `?quality=${forced}`]
    : env.coarsePointer && shortSide > 0 && shortSide <= 820 ? ['phone', `touch screen, short side ${shortSide}px`]
    : env.coarsePointer && env.deviceMemory !== undefined && env.deviceMemory <= 2 ? ['phone', `touch device with ${env.deviceMemory} GB`]
    : ['full', 'desktop or large screen'];
  const q = new URLSearchParams(env.search), num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) && v > 0 ? v : d; };
  // P1 phones: ?phoneMinPx= / ?phoneShadowNear= / ?phoneShadowEvery= / ?phoneDpr= tune the phone tier for measurements
  return tier === 'phone'
    ? { tier, reason, maxPixelRatio: num('phoneDpr', PHONE_PIXEL_RATIO), shadowMapSize: 1024, shadowEvery: Math.round(num('phoneShadowEvery', PHONE_SHADOW_EVERY)), freezeStill: true, bodies: PHONE_BODIES, bakedShadows: false,
      detail: q.has('phoneMinPx') || q.has('phoneShadowNear') ? { ...PHONE_DETAIL, minRadiusPx: num('phoneMinPx', PHONE_DETAIL.minRadiusPx), shadowNear: num('phoneShadowNear', PHONE_DETAIL.shadowNear) } : PHONE_DETAIL }
    : { tier, reason, maxPixelRatio: 2, shadowMapSize: 2048, shadowEvery: q.get('desktopDetail') === '0' ? 1 : Math.round(num('shadowEvery', DESKTOP_SHADOW_EVERY)), freezeStill: q.get('freezeStill') !== '0', bodies: DESKTOP_BODIES, bakedShadows: q.get('bakedShadows') !== '0' && q.get('freezeStill') !== '0',
      detail: q.get('desktopDetail') === '0' ? null : q.get('desktopDetail') === '1' ? DESKTOP_DETAIL : DESKTOP_DETAIL_FAST };
}

/** The page's tier (browser only). */
export function browserQuality(): QualitySettings {
  if (typeof window === 'undefined') return pickQualityTier({ search: '', coarsePointer: false, screen: [0, 0] });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return pickQualityTier({ search: typeof location === 'undefined' ? '' : location.search, coarsePointer: coarse, screen: typeof screen === 'undefined' ? [0, 0] : [screen.width, screen.height], deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory });
}
/** P1 phones: the progressive first build's radius in metres (null = everything first, as on desktop and in pictures).
 *  `?nearM=` overrides (0 or 'all' = everything first). */
export const PHONE_NEAR_M = 35;
export function progressiveNearM(): number | null {
  const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const k = q.get('nearM'); if (k === 'all' || k === '0') return null;
  if (k !== null && Number.isFinite(Number(k)) && Number(k) > 0) return Number(k);
  return q.has('shot') || browserQuality().tier !== 'phone' ? null : PHONE_NEAR_M;
}
