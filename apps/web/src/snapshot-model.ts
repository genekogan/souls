import { WorldModel } from '@souls/world-compiler';

type Snapshot = Parameters<typeof WorldModel.fromSnapshot>[0];
/** Build the same lazy-index model as fromSnapshot, yielding between entity batches. The model stays private until
 * complete, so a renderer or socket diff can never observe missing parents/names. The lazy index uses the final set. */
export async function snapshotModel(snapshot: Snapshot, signal: AbortSignal, yieldTask: () => Promise<void>): Promise<WorldModel> {
  signal.throwIfAborted();
  const model = WorldModel.fromSnapshot({ ...snapshot, entities: [] }, undefined, undefined, { lazyIndex: true });
  let until = performance.now() + 6;
  for (let i = 0; i < snapshot.entities.length; i++) {
    model.insert(snapshot.entities[i]);
    if ((i & 255) === 255 && performance.now() >= until && i + 1 < snapshot.entities.length) {
      await yieldTask(); signal.throwIfAborted(); until = performance.now() + 6;
    }
  }
  return model;
}
