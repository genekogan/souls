import type { WorldState } from '@souls/engine-contract';
import { hashCanonicalSteps } from '../../../mars/viewer/engine/core/hash.ts';
import { assertCanonicalProjectionHashable, canonicalArray, canonicalEntries, canonicalGet, canonicalObject, canonicalTextSteps, type CanonicalValue, type CanonicalHashProjection } from '../../../mars/viewer/engine/runtime/codec.ts';

/** Direct physicalView reads include hidden root/region metadata. Detect it
 * without invoking getters; the adapter must retain the host's legacy physical
 * hash boundary for these exceptional objects, instead of an enumerable view. */
export function physicalHashNeedsLegacyCapture(world: WorldState): boolean {
  const hidden = (value: object, keys: readonly string[]) => keys.some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && !descriptor.enumerable;
  });
  if (hidden(world, ['base', 'entities', 'regions', 'inventory', 'rng'])) return true;
  // Object rest destructuring still reads omitted properties before dropping
  // them, including hidden getters and rows whose ID is later dropped.
  const entities = Object.getOwnPropertyDescriptor(world, 'entities')?.value;
  if (entities !== null && typeof entities === 'object') for (const id of Object.keys(entities)) {
    const entity = Object.getOwnPropertyDescriptor(entities, id)?.value;
    if (entity !== null && typeof entity === 'object' && hidden(entity, ['label', 'tags', 'provenance'])) return true;
  }
  const regions = Object.getOwnPropertyDescriptor(world, 'regions')?.value;
  if (regions === null || typeof regions !== 'object') return false;
  for (const id of Object.keys(regions)) {
    const region = Object.getOwnPropertyDescriptor(regions, id)?.value;
    if (region !== null && typeof region === 'object' && hidden(region, ['kind', 'polygon', 'level'])) return true;
  }
  return false;
}

/** The engine-contract physicalView, projected from owned shapes rather than a
 * later live world. Its legacy entity-table assignment drops an ID '__proto__';
 * region IDs instead remain lexical-order tuple values. */
export function* capturedPhysicalHashSteps(world: CanonicalValue, maxWork = 256): Generator<void, string, void> {
  const physical = yield* physicalProjectionSteps(world, maxWork);
  return yield* hashCanonicalSteps(canonicalTextSteps(physical, 'contract', maxWork));
}
const physicalProof: CanonicalHashProjection = { fields: [
  ['base'], ['entities', { values: { omit: ['label', 'tags', 'provenance'] }, skip: ['__proto__'] }],
  ['regions', { values: { fields: [['kind'], ['polygon'], ['level']] } }], ['inventory'], ['rng'],
] };
/** Preserve eager invalid-domain rejection using raw owned leaves. Projection
 * wrappers, tuples and sorting belong to completion, not the atomic boundary. */
export function capturePhysicalHashInput(world: CanonicalValue): CanonicalValue {
  assertCanonicalProjectionHashable(world, physicalProof);
  return world;
}
function* physicalProjectionSteps(world: CanonicalValue, maxWork: number): Generator<void, CanonicalValue, void> {
  let work = 0;
  const entities: [string, CanonicalValue][] = [];
  for (const [id, entity] of canonicalEntries(canonicalGet(world, 'entities'))) {
    const rest: [string, CanonicalValue][] = [];
    for (const [key, value] of canonicalEntries(entity)) {
      if (key !== 'label' && key !== 'tags' && key !== 'provenance') rest.push([key, value]);
      if (++work >= maxWork) { work = 0; yield; }
    }
    if (id !== '__proto__') entities.push([id, canonicalObject(rest)]);
  }
  const regions: [string, CanonicalValue][] = [];
  for (const entry of canonicalEntries(canonicalGet(world, 'regions'))) {
    regions.push(entry);
    if (++work >= maxWork) { work = 0; yield; }
  }
  // Region order is lexical even for integer-looking IDs (the result is an array).
  regions.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const tuples: CanonicalValue[] = [];
  for (const [id, region] of regions) {
    tuples.push(canonicalArray([id, canonicalGet(region, 'kind'), canonicalGet(region, 'polygon'), canonicalGet(region, 'level') ?? 0]));
    if (++work >= maxWork) { work = 0; yield; }
  }
  const physical = canonicalObject([
    ['base', canonicalGet(world, 'base')], ['entities', canonicalObject(entities)],
    ['regions', canonicalArray(tuples)], ['inventory', canonicalGet(world, 'inventory')], ['rng', canonicalGet(world, 'rng')],
  ]);
  yield;
  return physical;
}
