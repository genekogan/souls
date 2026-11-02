// Lane PERF-SNAPSHOT (2026-11-01): a resync as a delta, not a rebuild. Eden 2026's /v1/world/snapshot is ~1.1 MB of
// wire JSON (5,000 things); a resync used to parse it on the main thread, build a new WorldModel and call draw on every
// thing (thawing every frozen one): one 130–150 ms task during play. Now the bytes go to a worker (snapshot-delta.worker.ts)
// that keeps the last snapshot it saw and sends back only what differs (diffSnapshots): on a quiet world nothing at all.
// Measured here (Node, this machine): parsing the wire snapshot is ~10 ms, expanding its columns ~20–40 ms, but a
// structured clone of the expanded snapshot is 30–45 ms, so a worker that handed the whole snapshot back would cost the
// main thread more than parsing it; only a small delta pays. Small first loads still parse here; large first loads
// parse in the worker and pull bounded batches of entities back (one message task per batch).
import { parsePieces, type SnapshotPieces } from './snapshot-wire.ts';

export type DeltaEntity = { id: string; def: string; in: { parent: string; slot?: string }; [k: string]: unknown };
export type DeltaDef = { ref: string; hash: string; [k: string]: unknown };
/** The plain snapshot as expandSnapshot gives it (the fields the delta reads). */
export type PlainSnapshot = {
  contract: string; seq: number; counter?: number; seed?: string; now?: number; constants: unknown; state: unknown; ground: unknown;
  defs: DeltaDef[]; entities: DeltaEntity[]; assetBytes?: Record<string, number>; builds?: unknown[]; buildsRev?: number; [k: string]: unknown;
};
export type SnapshotDelta = {
  contract: string; seq: number; counter?: number; now?: number; assetBytes?: Record<string, number>; builds?: unknown[]; buildsRev?: number;
  constants: unknown; state: unknown;
  /** The ground when it differs from the baseline or was asked for; else null. */
  ground: unknown;
  /** Defs the baseline did not have (by hash), in snapshot order. */
  defs: DeltaDef[];
  /** Every def ref of the snapshot with the hash it names, in snapshot order (an older revision of a ref comes before
   *  the active one, as WorldModel.fromSnapshot reads them: the last wins). */
  refs: [string, string][];
  /** Entities that differ from the baseline (or were asked for), in snapshot order. */
  upserts: DeltaEntity[];
  /** Ids the baseline (or the asked-for list) had that the snapshot lacks. */
  removes: string[];
  /** true: there was no baseline; `upserts` is the whole snapshot and anything else drawn is gone. */
  full: boolean;
  /** Entity counts: in the snapshot, and left out of `upserts` as unchanged. */
  total: number; unchanged: number;
};

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** What `next` changes against `prev` (null: everything). `touched` ids are reported whatever the baseline says (the
 *  caller changed them since: a socket diff it applied), as an upsert when the snapshot has them, else as a remove.
 *  `wantGround` returns the ground even when it equals the baseline's. Two snapshots from the same encoder write an
 *  unchanged entity identically, so entities compare by their JSON. */
export function diffSnapshots(prev: PlainSnapshot | null, next: PlainSnapshot, touched: Iterable<string> = [], wantGround = false): SnapshotDelta {
  const refs = next.defs.map((d) => [d.ref, d.hash] as [string, string]);
  const head = { contract: next.contract, seq: next.seq, counter: next.counter, now: next.now, assetBytes: next.assetBytes, builds: next.builds, buildsRev: next.buildsRev, constants: next.constants, state: next.state, refs, total: next.entities.length };
  if (!prev) return { ...head, ground: next.ground, defs: next.defs, upserts: next.entities, removes: [], full: true, unchanged: 0 };
  const had = new Map<string, DeltaEntity>(); for (const e of prev.entities) had.set(e.id, e);
  const ask = new Set(touched), ids = new Set<string>();
  const upserts: DeltaEntity[] = []; let unchanged = 0;
  for (const e of next.entities) {
    ids.add(e.id);
    const old = had.get(e.id);
    if (old && !ask.has(e.id) && JSON.stringify(old) === JSON.stringify(e)) { unchanged++; continue; }
    upserts.push(e);
  }
  const removes: string[] = [];
  for (const id of had.keys()) if (!ids.has(id)) removes.push(id);
  for (const id of ask) if (!ids.has(id) && !had.has(id)) removes.push(id);
  const known = new Set(prev.defs.map((d) => d.hash));
  const defs = next.defs.filter((d) => !known.has(d.hash));
  const ground = wantGround || !same(prev.ground, next.ground) ? next.ground : null;
  return { ...head, ground, defs, upserts, removes, full: false, unchanged };
}

/** The whole snapshot as a delta (no baseline). */
export const fullDelta = (snap: PlainSnapshot): SnapshotDelta => diffSnapshots(null, snap);

/** Avoid adding a worker round trip to small arrivals. Test/A-B override: ?snapshotWorker=0. */
export const INITIAL_WORKER_BYTES = 2 * 1024 * 1024;
/** One reply's structured clone is bounded independently of the world's population. */
export const INITIAL_ENTITY_BATCH = 256;
type Job = { ok: (d: DecoderReply) => void; no: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Decode = { kind: 'baseline' | 'delta' | 'initial'; pieces: SnapshotPieces; touched?: string[]; wantGround?: boolean };
type Pull = { kind: 'pull'; initial: number };
export type DecoderRequest = (Decode | Pull) & { id: number };
export type DecoderReply = { id: number; delta?: SnapshotDelta; snapshot?: PlainSnapshot; entities?: DeltaEntity[]; initial?: number; done?: boolean; error?: string };

/** The main thread's handle on the snapshot worker. Without workers (tests, a failed script) every call parses on the
 *  main thread and a delta is then the whole snapshot (fullDelta); nothing waits on a broken worker for long. */
export class SnapshotDecoder {
  private worker: Worker | null = null;
  private broken = false;
  private disposed = false;
  private next = 1;
  private readonly jobs = new Map<number, Job>();
  /** True once the worker has a baseline to diff against (else a delta is the whole snapshot). */
  hasBaseline = false;
  private readonly make: (() => Worker) | null;
  private readonly timeoutMs: number;
  constructor(make: (() => Worker) | null, timeoutMs = 20_000) { this.make = make; this.timeoutMs = timeoutMs; }
  private get(): Worker | null {
    if (this.broken || !this.make) return null;
    if (this.worker) return this.worker;
    try { this.worker = this.make(); } catch { this.broken = true; return null; }
    this.worker.onmessage = (ev: MessageEvent<DecoderReply>) => {
      const job = this.jobs.get(ev.data.id); if (!job) return; this.jobs.delete(ev.data.id); clearTimeout(job.timer);
      if (ev.data.error !== undefined) job.no(new Error(ev.data.error)); else job.ok(ev.data);
    };
    this.worker.onerror = () => this.fail(new Error('snapshot worker failed'));
    return this.worker;
  }
  private fail(error: Error) {
    this.broken = true; this.hasBaseline = false;
    try { this.worker?.terminate(); } catch { /* already gone */ }
    this.worker = null;
    for (const j of this.jobs.values()) { clearTimeout(j.timer); j.no(error); } this.jobs.clear();
  }
  private post(req: Decode | Pull, transfer = false): Promise<DecoderReply> | null {
    const w = this.get(); if (!w) return null;
    const id = this.next++;
    return new Promise<DecoderReply>((ok, no) => {
      const timer = setTimeout(() => { if (this.jobs.has(id)) this.fail(new Error('snapshot worker timed out')); }, this.timeoutMs);
      this.jobs.set(id, { ok, no, timer });
      // Baseline-only jobs can relinquish the bytes. Initial/delta jobs retain them: worker failure or timeout must
      // still be able to parse locally. Cloning raw bytes is cheap; cloning every expanded entity at once is not.
      const p = 'pieces' in req ? req.pieces : null;
      const buffers = transfer && p ? [p.body, ...(p.kind === 'wire' ? [p.defs, p.ground] : [])].flat().map(c => c.buffer).filter((b, i, a) => a.indexOf(b) === i) : [];
      try { w.postMessage({ id, ...req } satisfies DecoderRequest, buffers as Transferable[]); } catch (e) { this.jobs.delete(id); clearTimeout(timer); no(e as Error); }
    });
  }
  /** Parse on the main thread (the first load: nothing on the arrival's critical path) and give the worker the same
   *  bytes as its baseline; the chunks are transferred, so call this after nothing else needs them. */
  baselineFrom(pieces: SnapshotPieces): void {
    const p = this.post({ kind: 'baseline', pieces }, true);
    if (p) p.then(() => { if (!this.broken) this.hasBaseline = true; }, () => { this.hasBaseline = false; });
  }
  /** Large first loads parse/expand off-thread. Each pull clones at most INITIAL_ENTITY_BATCH records; the next
   * browser message is another task, so UI/socket work can run between batches. No partial snapshot escapes. */
  async initial(pieces: SnapshotPieces, signal?: AbortSignal): Promise<PlainSnapshot> {
    signal?.throwIfAborted();
    if (this.disposed) throw new Error('snapshot decoder disposed');
    if (pieces.body.reduce((n, c) => n + c.byteLength, 0) >= INITIAL_WORKER_BYTES) {
      const abort = () => this.fail(new Error('snapshot decode aborted'));
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const pending = this.post({ kind: 'initial', pieces });
        if (pending) {
          let reply = await pending;
          const snap = reply.snapshot, initial = reply.initial;
          if (!snap || initial === undefined) throw new Error('snapshot worker omitted initial header');
          while (!reply.done) {
            signal?.throwIfAborted();
            const next = this.post({ kind: 'pull', initial });
            if (!next) throw new Error('snapshot worker unavailable');
            reply = await next;
            if (!reply.entities || reply.initial !== initial) throw new Error('snapshot worker omitted entity batch');
            for (const e of reply.entities) snap.entities.push(e);
          }
          signal?.throwIfAborted();
          if (this.disposed) throw new Error('snapshot decoder disposed');
          this.hasBaseline = true; return snap;
        }
      } catch (error) {
        // Drops any partial worker stream as well. The unchanged input is still ours for the fallback below.
        this.fail(error instanceof Error ? error : new Error(String(error)));
        signal?.throwIfAborted();
        if (this.disposed) throw error;
      } finally { signal?.removeEventListener('abort', abort); }
    }
    const snap = parsePieces(pieces) as unknown as PlainSnapshot;
    this.baselineFrom(pieces); return snap;
  }
  dispose(): void { this.disposed = true; this.fail(new Error('snapshot decoder disposed')); }
  /** The delta of these bytes against the worker's baseline (the worker then keeps them as the next baseline). */
  async delta(pieces: SnapshotPieces, touched: string[], wantGround: boolean): Promise<SnapshotDelta> {
    const p = this.post({ kind: 'delta', pieces, touched, wantGround });
    if (p) { try { const { delta } = await p; if (delta) { this.hasBaseline = true; return delta; } } catch { /* main thread below */ } }
    return fullDelta(parsePieces(pieces) as unknown as PlainSnapshot);
  }
}
