/// <reference lib="webworker" />
// Snapshot parsing, first-load batches and resync deltas all share one baseline.
import { SnapshotWorkerSession } from './snapshot-worker-session.ts';
import type { DecoderRequest } from './snapshot-delta.ts';
const session = new SnapshotWorkerSession();
self.onmessage = (event: MessageEvent<DecoderRequest>) => (self as unknown as Worker).postMessage(session.handle(event.data));
