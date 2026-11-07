// The toy world: a 100×100 m plane with a campfire, benches, a kiosk and a gate.
// Stand-in for the Mars campus; same WorldState shape.
import { seedRng, type Entity, type Provenance, type Region, type WorldState } from '@souls/engine-contract';

export const TOY_SCHEMA = 'sim-toy-world/1';
export const TOY_RULES_VERSION = 'sim-toy/1+activities/1';
export const HALF = 50; // metres
export const WALK_SPEED_MM_S = 1350;
export const START_DATETIME = '2026-10-01T08:00:00';

const prov: Provenance = { origin: 'canonical', confidence: 'hypothetical' };
const fixture = (id: string, def: string, label: string, x: number, z: number, seats: number): Entity => ({
  id, def, kind: 'fixture', label, pose: { p: [x, 0, z], yaw: 0 }, provenance: prov, seats,
});
const square = (r: number): [number, number][] => [[-r, -r], [r, -r], [r, r], [-r, r]];

export function genesis(seed: string): WorldState {
  const entities: Record<string, Entity> = {};
  for (const f of [
    fixture('campfire', 'campfire', 'the campfire', 0, 0, 12),
    fixture('bench-1', 'bench', 'the north bench', 0, -12, 3),
    fixture('bench-2', 'bench', 'the east bench', 12, 0, 3),
    fixture('bench-3', 'bench', 'the far bench', -38, 30, 3),
    fixture('bench-4', 'bench', 'the orchard bench', 35, -34, 3),
    fixture('kiosk', 'kiosk', 'the kiosk', -14, -6, 4),
    fixture('gate', 'gate', 'the gate', 0, 46, 0),
  ]) entities[f.id] = f;
  const regions: Record<string, Region> = {
    center: { id: 'center', label: 'the center', kind: 'place', polygon: square(18), provenance: prov },
    ring: { id: 'ring', label: 'the outer ring', kind: 'walkable', polygon: square(HALF), provenance: prov },
  };
  return {
    schema: TOY_SCHEMA,
    base: { campus: 'toy', staticHash: 'toy-static-1' },
    tick: 0,
    entities,
    regions,
    env: { datetime: START_DATETIME, weather: { clouds: 0.2, rain: 0, wind: 0.1, dust: 0, wet: 0 } },
    inventory: 'unlimited',
    rng: seedRng(seed),
  };
}
