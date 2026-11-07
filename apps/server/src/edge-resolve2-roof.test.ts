// RESOLVE2 (2026-10-23, gate walk audit): a thing on a roof is reached on the roof (supportY), so a roof the ground has no
// stair to is honestly unreachable, and resolve must never offer it as available (the roof-bench walk 'completed' in the
// lobby). A roof whose stair lands on another patch of it (eden-house-3: planters on a strip a ridge parts from the stair's
// terrace) is reached at the nearest connected spot on that roof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { bootEden } from '../test/eden-capabilities-timing.ts';
import type { EdgeCapability } from './edge/contract.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Cap = { id: string; available: boolean; blocked?: { code: string } };
type NavV1 = { navWarmV1(ms: number): boolean; navCheckV1(xs: unknown[]): { ok: boolean }[] };

test('Eden 2026: roof things are offered available only when a stair from the ground reaches them', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const nav = w.bridge.nav, E = w.host.engine as unknown as NavV1;
  const thing = (ref: string) => nav.things().find((x: { ref?: string }) => x.ref === ref);
  // #882: the roof walk listed just after boot, before navigation is warm, caches a goal that skipped roofReach; once warm
  // (inside that entry's 50 ticks) the walk was refused as cut ("no stair or ramp") instead of made again
  const roofRef = 'eden-house-3/eden-house-3-roof-planter-1';
  assert.equal(E.navWarmV1(0), false, 'just after boot, navigation is still cold');
  nav.walkRefOnDemand(w.soul, roofRef, [], new Map());
  assert.ok(E.navWarmV1(Infinity));
  w.host.tickOnce();
  const stairRoof = thing(roofRef); assert.ok(stairRoof, 'eden-house-3 roof planter');
  const g = nav.goal(stairRoof, [0, 60]);
  assert.ok(g && g.level > 0, `on the roof: ${JSON.stringify(g)}`);
  assert.equal(E.navCheckV1([{ id: 'g', ...g }])[0].ok, true, 'reached up the roof stair');
  for (const ref of ['eden-house-3-kitchen/eden-house-3-kitchen-roof-planter-1', roofRef]) {
    const caps: Cap[] = [], plans = new Map();
    assert.ok(thing(ref), ref);
    nav.walkRefOnDemand(w.soul, ref, caps as EdgeCapability[], plans);
    const c = caps.find((x) => x.id === `walk:${ref}`); assert.ok(c, `offered walk:${ref}`);
    if (ref.includes('kitchen')) { assert.equal(c.available, false, 'no stair to the kitchen roof'); assert.equal(c.blocked?.code, 'route.unreachable'); }
    else assert.equal(c.available, true, 'the house roof has a stair');
  }
});
