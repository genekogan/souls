/// <reference lib="webworker" />
// Lane PERF-SNAPSHOT: the world snapshot's bytes are parsed and expanded off the main thread, and only what changed since
// the last snapshot this worker saw goes back (snapshot-delta.ts). Messages: DecoderRequest -> DecoderReply.
import { parsePieces } from './snapshot-wire.ts';
import { diffSnapshots, type DecoderReply, type DecoderRequest, type PlainSnapshot } from './snapshot-delta.ts';

let baseline: PlainSnapshot | null = null;
self.onmessage = (ev: MessageEvent<DecoderRequest>) => {
  const { id, kind, pieces, touched, wantGround } = ev.data;
  const reply = (r: DecoderReply) => (self as unknown as Worker).postMessage(r);
  try {
    const snap = parsePieces(pieces) as unknown as PlainSnapshot;
    if (kind === 'baseline') { baseline = snap; reply({ id }); return; }
    const delta = diffSnapshots(baseline, snap, touched ?? [], !!wantGround);
    baseline = snap;
    reply({ id, delta });
  } catch (e) { reply({ id, error: String((e as Error)?.message ?? e) }); }
};
