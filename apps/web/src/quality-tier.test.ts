import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickQualityTier, PHONE_DETAIL, PHONE_NEAR_M, PHONE_SHADOW_EVERY, PHONE_PIXEL_RATIO, PHONE_BODIES, progressiveNearM, DESKTOP_SHADOW_EVERY, DESKTOP_DETAIL_FAST, DESKTOP_DETAIL, DESKTOP_BODIES } from './quality-tier.ts';

const phone = { search: '', coarsePointer: true, screen: [390, 844] as const };
test('a touch phone gets the phone tier: capped pixels, small shadow map, shadow every few frames', () => {
  const q = pickQualityTier(phone);
  assert.equal(q.tier, 'phone'); assert.equal(q.maxPixelRatio, PHONE_PIXEL_RATIO); assert.equal(PHONE_PIXEL_RATIO, 1.5); assert.equal(q.shadowMapSize, 1024);
  assert.equal(q.bodies, PHONE_BODIES);
  assert.equal(q.shadowEvery, PHONE_SHADOW_EVERY); assert.equal(q.detail, PHONE_DETAIL);
});
test('a desktop redraws the shadow map every other frame, freezes still things and poses far bodies less often (PERF-EDEN); ?shadowEvery=1 restores every frame', () => {
  const q = pickQualityTier({ search: '', coarsePointer: false, screen: [1440, 900] });
  assert.equal(q.tier, 'full'); assert.equal(q.shadowEvery, DESKTOP_SHADOW_EVERY); assert.equal(q.freezeStill, true); assert.equal(q.detail, DESKTOP_DETAIL_FAST); assert.equal(q.bodies, DESKTOP_BODIES);
  assert.equal(pickQualityTier({ search: '?shadowEvery=1', coarsePointer: false, screen: [1440, 900] }).shadowEvery, 1);
  assert.equal(pickQualityTier({ search: '?freezeStill=0', coarsePointer: false, screen: [1440, 900] }).freezeStill, false);
  const old = pickQualityTier({ search: '?desktopDetail=1', coarsePointer: false, screen: [1440, 900] }); assert.equal(old.detail, DESKTOP_DETAIL);
  const off = pickQualityTier({ search: '?desktopDetail=0', coarsePointer: false, screen: [1440, 900] }); assert.equal(off.detail, null); assert.equal(off.shadowEvery, 1);
});
test('phone knobs come from the URL for measurements; bad values keep the defaults', () => {
  const q = pickQualityTier({ ...phone, search: '?phoneShadowEvery=1&phoneMinPx=3&phoneDpr=1' });
  assert.equal(q.shadowEvery, 1); assert.equal(q.maxPixelRatio, 1); assert.equal(q.detail?.minRadiusPx, 3); assert.equal(q.detail?.shadowNear, PHONE_DETAIL.shadowNear);
  assert.equal(pickQualityTier({ ...phone, search: '?phoneShadowEvery=x' }).shadowEvery, PHONE_SHADOW_EVERY);
  assert.equal(pickQualityTier({ ...phone, search: '?phoneDpr=x' }).maxPixelRatio, 1.5);
  assert.equal(pickQualityTier({ ...phone, search: '?quality=full' }).tier, 'full');
});
test('progressive first build: a phone draws within PHONE_NEAR_M first; desktop, ?shot and ?nearM=all draw everything first', () => {
  const g = globalThis as { location?: unknown; window?: unknown; matchMedia?: unknown; screen?: unknown };
  const saved = { location: g.location, window: g.window, matchMedia: g.matchMedia, screen: g.screen };
  const at = (search: string, coarse: boolean) => { g.window = {}; g.location = { search }; g.matchMedia = () => ({ matches: coarse }); g.screen = { width: 390, height: 844 }; return progressiveNearM(); };
  try {
    assert.equal(at('', true), PHONE_NEAR_M);
    assert.equal(at('', false), null);
    assert.equal(at('?shot=1', true), null);
    assert.equal(at('?nearM=all', true), null);
    assert.equal(at('?nearM=80', false), 80);
  } finally { Object.assign(g, saved); }
});
