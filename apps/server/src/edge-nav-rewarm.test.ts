// #901: after the first navigation build, a moving ride (a balloon, the carousel, the ferris wheel) invalidates the
// connectivity labels, and nothing in the tick loop warmed them again: until some read drained them, listings skipped
// offerWalk's cut check and offered the eden-house-3 kitchen roof (no stair reaches it) as available. The bridge's tick loop
// now polls the labels every 10 ticks and relabels cold ones in 10 ms slices, so with only ticks they are warm again soon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { bootEden } from '../test/eden-capabilities-timing.ts';
import type { EdgeCapability } from './edge/contract.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type NavV1 = { navWarmV1(ms: number): boolean };
type Cap = { id: string; available: boolean; blocked?: { code: string } };
/** Poll ticks plus slices: ~70-150 ms of relabel at 10 ms a tick, x3 for a loaded runner. */
const BOUND_TICKS = 10 + 45;

test('Eden 2026: labels a moving ride invalidated after the first build are warmed by the tick loop alone', { timeout: 900_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const E = w.host.engine as unknown as NavV1, nav = w.bridge.nav;
  assert.ok(E.navWarmV1(Infinity), 'the first build, drained');
  await w.settle(2);
  // rides move on their own schedule; when none moved within 40 ticks, the carousel is moved a hair, as its own step does
  for (let i = 0; i < 40 && E.navWarmV1(0); i++) w.host.tickOnce();
  const ents = w.host.engine.world.entities as Record<string, { pose: { p: number[] } }>;
  const ride = ['resort-carousel', 'resort-ferris-wheel', 'eden-balloon'].map((id) => ents[id]).find(Boolean);
  assert.ok(ride, 'Eden runs a ride'); if (E.navWarmV1(0)) ride.pose.p[0] += 0.01;
  assert.equal(E.navWarmV1(0), false, 'a moving ride invalidated the labels');
  // A1: only ticks (navWarmV1(0) is a poll: it never relabels)
  let ticks = 0;
  while (ticks < BOUND_TICKS && !E.navWarmV1(0)) { w.host.tickOnce(); ticks++; }
  t.diagnostic(`${E.navWarmV1(0) ? 'warm again' : 'still cold'} after ${ticks} ticks`);
  assert.equal(E.navWarmV1(0), true, `still cold after ${ticks} ticks with only the tick loop`);
  // A2: the listing reads warm labels: the house roof (its stair lands on the roof) available, the kitchen roof cut
  for (const ref of ['eden-house-3-kitchen/eden-house-3-kitchen-roof-planter-1', 'eden-house-3/eden-house-3-roof-planter-1']) {
    const caps: Cap[] = [];
    nav.walkRefOnDemand(w.soul, ref, caps as EdgeCapability[], new Map());
    const c = caps.find((x) => x.id === `walk:${ref}`); assert.ok(c, `offered walk:${ref}`);
    if (ref.includes('kitchen')) { assert.equal(c.available, false, 'no stair reaches the kitchen roof'); assert.equal(c.blocked?.code, 'route.unreachable'); }
    else assert.equal(c.available, true, 'the house roof has a stair');
  }
});
