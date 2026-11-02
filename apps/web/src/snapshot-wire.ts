// Lane W3 (2026-10-19): the viewer's world snapshot on the wire (server: apps/server/src/god/snapshot-wire.ts).
// `?defs=ref` returns the snapshot without its defs, ground and default-valued entity params; defs and ground come as
// content-addressed, immutable parts (/v1/world/part/<ref>: one download per browser, shared by every world and visit
// with the same set). expandSnapshot puts it back together exactly as the plain snapshot, so WorldModel.fromSnapshot
// and everything after it see no difference. Any failure falls back to the plain snapshot.
import { isPackedColumnsV1, unpackColumnsV1 } from '@sim/protocol/columns-v1';
import { entryWireUrl, takeSnapshotPrefetchBatch, type PrefetchRequest } from './snapshot-prefetch.ts';

type Spec = Record<string, { default?: unknown } | undefined>;
type Def = { name?: string; version?: number; params?: Spec };
type Entity = { def?: string; params?: Record<string, unknown> };
export type WireBody = Record<string, unknown> & { defsRef?: string; groundRef?: string; paramsDefaulted?: boolean; entities?: Entity[] | { $columnsV1: unknown } };

/** The plain snapshot from its wire pieces (params back in their def's order, as the server writes them). */
export function expandSnapshot(body: WireBody, defs: Def[], ground: unknown): Record<string, unknown> {
  const { defsRef: _d, groundRef: _g, paramsDefaulted, entities: wired = [], ...rest } = body;
  // columns/1 (lane JOINSET, `cols=1`): the entities in the column form, put back exactly first
  const entities = (isPackedColumnsV1(wired) ? unpackColumnsV1(wired) : wired) as Entity[];
  const specs = new Map(defs.map((d) => [`${d.name}@${d.version}`, d.params ?? {}]));
  const full = !paramsDefaulted ? entities : entities.map((e) => {
    const spec = e.def ? specs.get(e.def) : undefined; if (!e.params || !spec) return e;
    const params: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(spec)) { if (k in e.params) params[k] = e.params[k]; else if (s && typeof s === 'object' && 'default' in s) params[k] = s.default; }
    for (const [k, v] of Object.entries(e.params)) if (!(k in params)) params[k] = v;
    return { ...e, params };
  });
  return { ...rest, ground, defs, entities: full };
}

/** A first page-entry request is hedged after four seconds. Each request also has an inactivity bound. */
export const ENTRY_HEDGE_MS = 4_000;

/** Header wait and body inactivity, not a total download deadline. */
export const SNAPSHOT_STALL_MS = 12_000;
const stalled = () => new DOMException('Snapshot transport stalled', 'TimeoutError');
const cancelBody = (r: Response) => { void r.body?.cancel().catch(() => {}); };

/** Each wire/plain attempt owns its requests. A failed part cancels siblings before plain fallback starts. */
async function withTransport<T>(caller: AbortSignal, work: (transport: {
  headers(url: string, prefetch?: PrefetchRequest | null, hedge?: boolean): Promise<Response>;
  chunks(response: Response): Promise<Uint8Array[]>;
}) => Promise<T>): Promise<T> {
  caller.throwIfAborted();
  const controller = new AbortController(), signal = controller.signal, cancels = new Set<() => void>(), requests = new WeakMap<Response, () => void>();
  const close = () => { controller.abort(caller.aborted ? caller.reason : new DOMException('Snapshot attempt completed', 'AbortError')); for (const cancel of cancels) cancel(); cancels.clear(); };
  caller.addEventListener('abort', close, { once: true });
  const request = (url: string, prefetch?: PrefetchRequest | null) => {
    const own = new AbortController();
    const source = prefetch ?? { response: Promise.resolve().then(() => { own.signal.throwIfAborted(); return fetch(url, { signal: own.signal }); }), abort: () => own.abort() };
    let response: Response | undefined, ended = false, cancelled = false, rejectWait: (e: unknown) => void = () => {};
    const cancel = () => { if (cancelled) return; cancelled = true; cancels.delete(cancel); source.abort?.(); if (response) cancelBody(response); rejectWait(signal.aborted ? signal.reason : new DOMException('Snapshot request cancelled', 'AbortError')); };
    cancels.add(cancel);
    const promise = new Promise<Response>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: unknown, value?: Response) => {
        if (ended) return; ended = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
        if (value) resolve(value); else reject(error);
      };
      rejectWait = error => finish(error);
      timer = setTimeout(() => { finish(stalled()); cancel(); }, SNAPSHOT_STALL_MS);
      signal.addEventListener('abort', cancel, { once: true });
      source.response.then(r => { response = r; if (ended) { cancelBody(r); return; } requests.set(r, cancel); finish(undefined, r); }, e => finish(e));
      if (signal.aborted) cancel();
    });
    return { promise, cancel };
  };
  try {
    const result = await work({
      headers(url, prefetch, hedge = false) {
        if (!hedge) return request(url, prefetch).promise;
        return new Promise<Response>((resolve, reject) => {
          const tasks = [request(url, prefetch)]; let done = false, pending = 1;
          const timer = setTimeout(() => { if (done) return; pending++; const next = request(url); tasks.push(next); listen(next); }, ENTRY_HEDGE_MS);
          const fail = (error: unknown) => { if (--pending === 0 && !done) { done = true; clearTimeout(timer); reject(error); } };
          const listen = (task: ReturnType<typeof request>) => { task.promise.then(r => {
            if (done) { task.cancel(); return; }
            // A failed hedge must not cancel a still-pending valid response. Before a hedge exists, fail immediately.
            if (!r.ok) { task.cancel(); fail(new Error(`snapshot ${r.status}`)); return; }
            done = true; clearTimeout(timer); for (const other of tasks) if (other !== task) other.cancel(); resolve(r);
          }, fail); };
          listen(tasks[0]);
        });
      },
      chunks(response) {
        signal.throwIfAborted();
        if (!response.body) return Promise.reject(new SyntaxError('Unexpected end of JSON input'));
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        return new Promise((resolve, reject) => {
          let finished = false, timer: ReturnType<typeof setTimeout>;
          const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
          const fail = (error: unknown) => { if (finished) return; finished = true; cleanup(); reject(error); void reader.cancel(error).catch(() => {}); };
          const aborted = () => fail(signal.reason);
          const arm = () => { clearTimeout(timer); timer = setTimeout(() => fail(stalled()), SNAPSHOT_STALL_MS); };
          signal.addEventListener('abort', aborted, { once: true }); arm();
          void (async () => {
            try {
              for (;;) {
                const { done, value } = await reader.read(); if (finished) return;
                if (done) break;
                if (value.byteLength) { chunks.push(value); arm(); }
              }
              // EOF releases this winner before parsing; attempt cleanup still cancels every unfinished request.
              const cancel = requests.get(response); if (cancel) cancels.delete(cancel); requests.delete(response);
              finished = true; cleanup(); resolve(chunks);
            } catch (error) { fail(error); } finally { reader.releaseLock(); }
          })();
        });
      },
    });
    caller.throwIfAborted(); return result;
  } finally { caller.removeEventListener('abort', close); close(); }
}

/** A snapshot's bytes as they came off the wire, before any JSON work (lane PERF-SNAPSHOT: parsed by parsePieces here or
 *  in snapshot-delta.worker.ts). The wire form carries its two parts and the refs the headers named. */
export type SnapshotPieces =
  | { kind: 'wire'; body: Uint8Array[]; defs: Uint8Array[]; ground: Uint8Array[]; defsRef: string; groundRef: string }
  | { kind: 'plain'; body: Uint8Array[] };
export function decodeText(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder(); let text = '';
  for (const c of chunks) text += decoder.decode(c, { stream: true });
  return text + decoder.decode();
}
/** The plain snapshot from its bytes: exactly what `response.json()` of the plain snapshot would give (expandSnapshot
 *  for the wire form). Throws when the pieces do not fit together (the caller then takes the plain snapshot). */
export function parsePieces(pieces: SnapshotPieces): Record<string, unknown> {
  if (pieces.kind === 'plain') {
    const snap = JSON.parse(decodeText(pieces.body)) as Record<string, unknown>;
    if ('defsRef' in snap) throw Error('Snapshot part headers missing');
    return snap;
  }
  const body = JSON.parse(decodeText(pieces.body)) as WireBody, defs = JSON.parse(decodeText(pieces.defs)) as unknown, ground = JSON.parse(decodeText(pieces.ground)) as unknown;
  if (body.defsRef !== pieces.defsRef || body.groundRef !== pieces.groundRef || !Array.isArray(defs)) throw Error('Snapshot part references mismatch');
  return expandSnapshot(body, defs as Def[], ground);
}

export type Loaded<T = Record<string, unknown>> = { snap: T; response: Response };
/** Preserve exact wire references/response metadata; transport failure falls back once to the bounded plain request.
 *  `parse` turns the bytes into what the caller wants (default: the plain snapshot, on this thread). */
export async function loadSnapshot<T = Record<string, unknown>>(plainUrl: string, signal: AbortSignal, first = false, parse: (pieces: SnapshotPieces) => T | Promise<T> = parsePieces as unknown as (pieces: SnapshotPieces) => T): Promise<Loaded<T> | null> {
  const plain = () => withTransport(signal, async t => { const r = await t.headers(plainUrl); return r.ok ? { snap: await parse({ kind: 'plain', body: await t.chunks(r) }), response: r } : null; });
  const url = first ? entryWireUrl(plainUrl) : `${plainUrl}?defs=ref&cols=1`;
  const batch = first ? takeSnapshotPrefetchBatch(url) : null;
  try {
    return await withTransport(signal, async t => {
      const r = await t.headers(url, batch?.request, first);
      if (!r.ok) throw Error(`snapshot ${r.status}`);
      const defsRef = r.headers.get('x-defs-ref'), groundRef = r.headers.get('x-ground-ref');
      if (!defsRef || !groundRef) return { snap: await parse({ kind: 'plain', body: await t.chunks(r) }), response: r };
      const part = async (ref: string) => { const p = await t.headers(plainUrl.replace(/\/v1\/world\/snapshot$/, `/v1/world/part/${ref}`), batch?.part(ref), first); if (!p.ok) throw Error(`part ${p.status}`); return t.chunks(p); };
      const [body, defs, ground] = await Promise.all([t.chunks(r), part(defsRef), part(groundRef)]);
      return { snap: await parse({ kind: 'wire', body, defs, ground, defsRef, groundRef }), response: r };
    });
  } catch (error) {
    signal.throwIfAborted();
    // Close entry prefetch ownership before falling back, including any unused HTML-predicted parts.
    batch?.close(); return plain();
  } finally { batch?.close(); }
}
