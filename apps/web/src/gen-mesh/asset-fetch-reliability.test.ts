import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { SRC } from './asset-fetch.ts';
import { DeferredLoadQueue } from './lazy-assets.ts';

type Message = { id: number; url?: string; cancel?: boolean; images?: boolean; cdn?: { url: string; bytes: number; sha256: string }; [key: string]: unknown };
type Reply = { id: number; buffer?: ArrayBuffer; images?: [number, Pick<ImageBitmap, 'close'>][]; loaded?: number; total?: number | null; error?: string; status?: number; cdn?: boolean };
type Fetcher = (url: string, init: RequestInit, clock: Clock) => Promise<Response>;
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
class Clock {
  now = 0; next = 1; timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number) => { const id = this.next++; this.timers.set(id, { at: this.now + ms, fn }); return id; };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  async tick(ms: number) {
    const until = this.now + ms;
    for (;;) {
      const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > until) break;
      this.now = first[1].at; this.timers.delete(first[0]); first[1].fn(); await flush();
    }
    this.now = until; await flush();
  }
}
function runtime(fetcher: Fetcher, onMessage?: (m: Reply) => void, extras: Record<string, unknown> = {}) {
  const clock = new Clock(), reports: Reply[] = [], requests: { url: string; signal: AbortSignal }[] = [];
  const self = { onmessage: null as unknown as (ev: { data: Message }) => Promise<void>, postMessage: (m: Reply) => { reports.push(m); onMessage?.(m); } };
  const context = vm.createContext({ self, AbortController, DOMException, Response, ReadableStream, Uint8Array, DataView, TextDecoder, Blob, crypto,
    Date: { now: () => clock.now }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    fetch: (url: string, init: RequestInit) => { requests.push({ url, signal: init.signal! }); return fetcher(url, init, clock); }, ...extras });
  vm.runInContext(SRC, context);
  return { clock, reports, requests, send: (data: Message) => self.onmessage({ data }), pending: () => vm.runInContext('running.size', context) as number };
}
const origin = 'https://fixture.invalid/assets/model.glb', cdnUrl = 'https://cdn.invalid/model.glb';
const bytes = new Uint8Array([1, 2, 3, 4]);
const cdn = { url: cdnUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const response = () => new Response(bytes.slice());
const terminal = (w: ReturnType<typeof runtime>) => w.reports.filter(m => m.error !== undefined || m.buffer !== undefined);
// The worker checks CDN bytes with WebCrypto, whose digest completes on Node's thread pool: outside the fake clock and
// outside any fixed number of event-loop turns, so under load it can land after flush(). This digest is always slower
// than flush(), which makes that ordering the only one, and settled() waits for it in real time without advancing fake time.
const slowDigest = { subtle: { digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
  await new Promise(resolve => setTimeout(resolve, 20)); return crypto.subtle.digest(algorithm, data);
} } };
async function settled(w: ReturnType<typeof runtime>) {
  for (const end = Date.now() + 5000; !terminal(w).length && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 1));
}
function clean(w: ReturnType<typeof runtime>) { assert.equal(w.pending(), 0, 'worker job released'); assert.equal(w.clock.timers.size, 0, 'all transport timers released'); }

test('worker headers queued behind six healthy page bodies survive a20s native connection wait', async () => {
  let occupied = 6, admitted = 0, bodyCloses = 0;
  const waiting: (() => void)[] = [];
  const w = runtime((_url, init) => new Promise(resolve => {
    const admit = () => { admitted++; resolve(response()); };
    waiting.push(admit);
    init.signal!.addEventListener('abort', () => { const i = waiting.indexOf(admit); if (i >= 0) waiting.splice(i, 1); }, { once: true });
  }));
  // Page-owned responses occupy the same six native HTTP connections. Each still receives positive bytes.
  const pages = Array.from({ length: 6 }, () => new Response(new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(bytes.slice(0, 1));
    for (const at of [5000, 10000, 15000]) w.clock.setTimeout(() => c.enqueue(bytes.slice(0, 1)), at);
    w.clock.setTimeout(() => { c.close(); bodyCloses++; occupied--; while (occupied < 6 && waiting.length) { occupied++; waiting.shift()!(); } }, 20_000);
  } })).arrayBuffer());
  void w.send({ id: 99, url: origin }); await flush(); await w.clock.tick(20_000); await Promise.all(pages); await flush();
  assert.equal(bodyCloses, 6); assert.equal(w.requests.length, 2, 'original plus four-second hedge waited for native slots');
  assert.equal(admitted, 1, 'the winner cancels its queued sibling before that request is admitted');
  assert.equal(terminal(w).length, 1); assert.equal(terminal(w)[0].error, undefined);
  assert.deepEqual(new Uint8Array(terminal(w)[0].buffer!), bytes); clean(w);
});

test('both original headers hang even ignoring abort: bounded error at64s, both requests cancelled and late bodies released', async () => {
  const finish: ((r: Response) => void)[] = []; let cancelled = 0;
  const w = runtime(() => new Promise(resolve => finish.push(resolve)));
  let done = false; void w.send({ id: 1, url: origin }).then(() => { done = true; }); await flush();
  await w.clock.tick(3999); assert.equal(w.requests.length, 1);
  await w.clock.tick(1); assert.equal(w.requests.length, 2);
  await w.clock.tick(55_999); assert.equal(done, false); assert(w.requests.every(r => !r.signal.aborted));
  await w.clock.tick(1); assert.equal(done, false); assert.equal(w.requests[0].signal.aborted, true);
  await w.clock.tick(4000); assert.equal(done, true); assert.match(String(terminal(w)[0].error), /headers stalled/);
  assert(w.requests.every(r => r.signal.aborted)); clean(w);
  for (const f of finish) f(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await flush(); assert.equal(cancelled, 2); assert.equal(terminal(w).length, 1); clean(w);
});

test('CDN and original header hangs exhaust bounded CDN fallback and terminate once', async () => {
  const w = runtime(() => new Promise(() => {})); void w.send({ id: 2, url: origin, cdn }); await flush();
  await w.clock.tick(128_000);
  assert.equal(w.requests.length, 4); assert.equal(terminal(w).length, 1); assert.match(String(terminal(w)[0].error), /headers stalled/);
  assert(w.requests.every(r => r.signal.aborted)); clean(w);
});

test('a fast origin404 hedge cannot defeat valid slower CDN headers; failed bodies are cancelled', async () => {
  let badBodyCancelled = 0;
  const w = runtime((url, _init, clock) => url === cdnUrl
    ? new Promise(resolve => clock.setTimeout(() => resolve(response()), 5000))
    : Promise.resolve(new Response(new ReadableStream({ cancel() { badBodyCancelled++; } }), { status: 404 })), undefined, { crypto: slowDigest });
  void w.send({ id: 3, url: origin, cdn }); await flush(); await w.clock.tick(4000);
  assert.equal(terminal(w).length, 0); await w.clock.tick(1000); await settled(w);
  assert.equal(terminal(w).length, 1); assert.equal(terminal(w)[0].cdn, true); assert.deepEqual([...new Uint8Array(terminal(w)[0].buffer as ArrayBuffer)], [...bytes]);
  assert.equal(badBodyCancelled, 1); clean(w);
});

test('HTTP status is preserved when the original fails without a usable sibling', async () => {
  const w = runtime(async () => new Response(null, { status: 404 })); await w.send({ id: 4, url: origin });
  assert.equal(terminal(w)[0].status, 404); assert.match(String(terminal(w)[0].error), /HTTP 404/); clean(w);
});

test('slow positive body progress survives beyond total stall duration with byte-exact output', async () => {
  const w = runtime((_url, _init, clock) => Promise.resolve(new Response(new ReadableStream({ start(c) {
    c.enqueue(bytes.slice(0, 1)); clock.setTimeout(() => c.enqueue(bytes.slice(1, 2)), 10_000);
    clock.setTimeout(() => c.enqueue(bytes.slice(2, 3)), 20_000); clock.setTimeout(() => { c.enqueue(bytes.slice(3)); c.close(); }, 30_000);
  } }))));
  void w.send({ id: 5, url: origin }); await flush(); await w.clock.tick(30_000);
  assert.equal(w.requests.length, 1); assert.equal(w.requests[0].signal.aborted, false);
  assert.deepEqual([...new Uint8Array(terminal(w)[0].buffer as ArrayBuffer)], [...bytes]); clean(w);
});

test('empty chunks do not extend a body stall; hung readers are explicitly cancelled before the retry succeeds', async () => {
  let cancelled = 0, n = 0;
  const w = runtime((_url, _init, clock) => {
    if (n++) return Promise.resolve(response());
    return Promise.resolve(new Response(new ReadableStream({ start(c) {
      c.enqueue(bytes.slice(0, 1)); clock.setTimeout(() => c.enqueue(new Uint8Array()), 11_000);
    }, cancel() { cancelled++; } })));
  });
  void w.send({ id: 6, url: origin }); await flush(); await w.clock.tick(12_000);
  assert.equal(w.requests.length, 2); assert.equal(cancelled, 1); assert.equal(w.requests[0].signal.aborted, true);
  assert.deepEqual([...new Uint8Array(terminal(w)[0].buffer as ArrayBuffer)], [...bytes]); clean(w);
});

test('per-job cancellation aborts both pending headers without a retry or a late report', async () => {
  const w = runtime(() => new Promise(() => {})); void w.send({ id: 7, url: origin }); await flush(); await w.clock.tick(4000);
  await w.send({ id: 7, cancel: true }); await flush();
  assert.equal(w.requests.length, 2); assert(w.requests.every(r => r.signal.aborted)); assert.equal(w.reports.length, 0); clean(w);
});

test('cancellation during a reader wait cancels its body exactly once and releases every timer', async () => {
  let cancelled = 0;
  const w = runtime(async () => new Response(new ReadableStream({ cancel() { cancelled++; } })));
  void w.send({ id: 8, url: origin }); await flush(); const reports = w.reports.length;
  await w.send({ id: 8, cancel: true }); await flush();
  assert.equal(w.requests.length, 1); assert.equal(cancelled, 1); assert.equal(w.reports.length, reports); clean(w);
});

test('cancellation during image decode releases the job and closes late bitmaps without delivery', async () => {
  const raw = JSON.stringify({ buffers: [{ byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4 }], images: [{ bufferView: 0, mimeType: 'image/png' }] });
  const json = new TextEncoder().encode(raw.padEnd(Math.ceil(raw.length / 4) * 4, ' '));
  const glb = new ArrayBuffer(20 + json.length + 8 + 4), dv = new DataView(glb);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.byteLength, true);
  dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4E4F534A, true); new Uint8Array(glb, 20, json.length).set(json);
  dv.setUint32(20 + json.length, 4, true); dv.setUint32(24 + json.length, 0x004E4942, true);
  let finish: ((bitmap: { close: () => void }) => void) | undefined, closed = 0;
  const w = runtime(async () => new Response(glb), undefined, { createImageBitmap: () => new Promise(resolve => { finish = resolve; }) });
  void w.send({ id: 9, url: origin, images: true }); await flush(); assert(finish);
  await w.send({ id: 9, cancel: true }); clean(w);
  finish({ close() { closed++; } }); await flush(); assert.equal(closed, 1); assert.equal(terminal(w).length, 0); clean(w);
});

class WorkerDouble {
  static latest: WorkerDouble; static sourceFetch: Fetcher = async () => response();
  onmessage: ((e: { data: Reply }) => void) | null = null; onerror: (() => void) | null = null;
  posted: Message[] = []; terminated = 0; w: ReturnType<typeof runtime>;
  constructor() { WorkerDouble.latest = this; this.w = runtime((...args) => WorkerDouble.sourceFetch(...args), m => queueMicrotask(() => this.onmessage?.({ data: m }))); }
  postMessage(m: Message) { this.posted.push(m); void this.w.send(m); }
  terminate() { this.terminated++; this.w.clock.timers.clear(); }
}

test('page bridge: timeout releases queue slot; predispatch/active cancellation is isolated; worker failure settles all jobs', async () => {
  Object.assign(globalThis, { Worker: WorkerDouble });
  const { fetchInWorker } = await import('./asset-fetch.ts');
  WorkerDouble.sourceFetch = async url => url.includes('hung') ? new Promise(() => {}) : response();
  const queue = new DeferredLoadQueue(1), completed: string[] = [], failed: unknown[] = [];
  queue.add('hung', { priority: () => [0, 0], start: () => fetchInWorker(origin + '?hung')!.catch(e => { failed.push(e); throw e; }) });
  queue.add('good', { priority: () => [0, 1], start: () => fetchInWorker(origin + '?good')!.then(() => completed.push('good')) });
  queue.pump(); await flush(); const w = WorkerDouble.latest;
  assert.equal(queue.stats().active, 1); assert.equal(completed.length, 0);
  await w.w.clock.tick(64_000); assert.equal(failed.length, 1); assert.deepEqual(completed, ['good']);
  assert.deepEqual(queue.stats(), { active: 0, pending: 0 }); clean(w.w);

  const early = new AbortController(), posted = w.posted.length;
  const p0 = fetchInWorker(origin + '?early', early.signal)!; const rejected0 = assert.rejects(p0, { name: 'AbortError' }); early.abort(); await rejected0; await flush();
  assert.equal(w.posted.length, posted, 'cancel before manifest dispatch never starts a worker job');
  WorkerDouble.sourceFetch = async () => new Promise(() => {});
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { setAssetLoader, loadAsset, assetFailed } = await import('./gltf-assets.ts');
  const loader = new GLTFLoader(); let ended = 0, errored = 0;
  loader.manager.onLoad = () => { ended++; }; loader.manager.onError = () => { errored++; };
  const release = setAssetLoader(loader), sha = '9'.repeat(64);
  const owned = loadAsset(sha), rejectedOwned = assert.rejects(owned, { name: 'AbortError' });
  await flush(); loader.manager.abort(); await rejectedOwned; await flush();
  assert.equal(w.w.pending(), 0); assert.equal(ended, 1); assert.equal(errored, 1); assert.equal(assetFailed(sha), false); release();
  const a = new AbortController(), p1 = fetchInWorker(origin + '?a', a.signal)!, p2 = fetchInWorker(origin + '?b')!;
  const rejected1 = assert.rejects(p1, { name: 'AbortError' }); await flush(); const active = w.posted.filter(m => m.url).slice(-2); a.abort(); await rejected1; await flush();
  assert.equal(w.w.pending(), 1, 'only the cancelled job leaves'); assert.equal(w.posted.at(-1)!.id, active[0].id); assert.equal(w.posted.at(-1)!.cancel, true);
  let closed = 0; w.onmessage!({ data: { id: active[0].id, buffer: bytes.buffer, images: [[0, { close() { closed++; } }]] } }); assert.equal(closed, 1, 'late transferred bitmap is closed');
  const p3 = fetchInWorker(origin + '?c')!; const rejected = [p2, p3].map(p => assert.rejects(p, (e: Error & { unavailable?: boolean }) => e.unavailable === true));
  await flush(); w.onerror!(); await Promise.all(rejected); assert.equal(w.terminated, 1);
  assert.equal(fetchInWorker(origin + '?after-failure'), null, 'subsequent requests use ordinary FileLoader');
});
