import type {WorldHost} from './world.ts';

/** Little Martians scene worlds: the old world (WORLD_KEY `littlemartians`, also its launcher fork) and the launcher's
 *  arium (slug `little-martians-arium`, as tools/world-launcher/op-souls.mjs names it). They are excluded from Soul
 *  features (Gene's standing rule), so edge startup does not turn on the stair-traffic rules there. */
export const LITTLE_MARTIANS_WORLD_KEYS: readonly string[] = Object.freeze(['littlemartians', 'little-martians-arium']);

/** The prospective runtime rules an edge world turns on at startup, in order. Each enable is idempotent (a world that
 *  already logged the rule queues nothing). The stair-traffic rules (occupiedLinkRoutingV1, concurrentLinkEgressV1,
 *  stairLandingClearanceV1) are not activated on the Little Martians worlds; every other world gets them in order. */
export async function enableEdgeRuntimeRules(host: WorldHost, worldKey: string): Promise<void> {
  await host.enableQuietStallReleaseV1();
  await host.enableYieldTimeoutV1?.();
  await host.enableSpreadV2?.();
  if (LITTLE_MARTIANS_WORLD_KEYS.includes(worldKey)) return;
  await host.enableOccupiedLinkRoutingV1?.();
  await host.enableConcurrentLinkEgressV1?.();
  await host.enableStairLandingClearanceV1?.();
}
