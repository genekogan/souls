// Worker-only state, separated from its self.onmessage adapter so byte ownership and batch boundaries are testable.
import { parsePieces } from './snapshot-wire.ts';
import { diffSnapshots, INITIAL_ENTITY_BATCH, type DecoderReply, type DecoderRequest, type PlainSnapshot } from './snapshot-delta.ts';

export class SnapshotWorkerSession {
  private baseline: PlainSnapshot | null = null;
  private streams = new Map<number, { snapshot: PlainSnapshot; at: number }>();
  handle(request: DecoderRequest): DecoderReply {
    const { id, kind } = request;
    try {
      if (kind === 'pull') {
        const stream = this.streams.get(request.initial);
        if (!stream) throw new Error('snapshot stream expired');
        const entities = stream.snapshot.entities.slice(stream.at, stream.at + INITIAL_ENTITY_BATCH);
        stream.at += entities.length;
        const done = stream.at === stream.snapshot.entities.length;
        if (done) this.streams.delete(request.initial);
        return { id, initial: request.initial, entities, done };
      }
      const snapshot = parsePieces(request.pieces) as unknown as PlainSnapshot;
      if (kind === 'baseline') { this.baseline = snapshot; return { id }; }
      if (kind === 'initial') {
        this.baseline = snapshot;
        const entities = snapshot.entities.slice(0, INITIAL_ENTITY_BATCH), done = entities.length === snapshot.entities.length;
        if (!done) this.streams.set(id, { snapshot, at: entities.length });
        return { id, initial: id, snapshot: { ...snapshot, entities }, done };
      }
      const delta = diffSnapshots(this.baseline, snapshot, request.touched ?? [], !!request.wantGround);
      this.baseline = snapshot;
      return { id, delta };
    } catch (error) { return { id, error: String((error as Error)?.message ?? error) }; }
  }
}
