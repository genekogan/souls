import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadSnapshot, parsePieces, ENTRY_HEDGE_MS, SNAPSHOT_STALL_MS } from './snapshot-wire.ts';
import { entryPrefetchScript, entryWireUrl } from './snapshot-prefetch.ts';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const plain = '/w/fixture/v1/world/snapshot';
const sample = { contract: 'world/1', seq: 17, tick: 41, epoch: 'new', entities: [], defs: [], ground: { label: '☃😀' } };
const json = (x: unknown, headers?: Record<string, string>) => new Response(JSON.stringify(x), { headers });
function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const g = globalThis as unknown as { window: unknown; fetch: typeof fetch }, saved = { window: g.window, fetch: g.fetch };
  g.window = {}; t.after(() => { g.window = saved.window; g.fetch = saved.fetch; }); return g;
}
function hanging(signal: AbortSignal | null | undefined, aborted: () => void) {
  return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => { aborted(); reject(signal.reason); }, { once: true }));
}

test('both entry headers stall: cancel both, then exact plain fallback and original metadata', async t => {
  const g = setup(t), calls: string[] = []; let aborted = 0;
  g.fetch = (async (url, init) => { calls.push(String(url)); return String(url) === plain ? json(sample, { 'x-epoch': 'new' }) : hanging(init?.signal, () => aborted++); }) as typeof fetch;
  const promise = loadSnapshot(plain, new AbortController().signal, true); await flush();
  t.mock.timers.tick(ENTRY_HEDGE_MS); await flush(); assert.equal(calls.length, 2);
  t.mock.timers.tick(SNAPSHOT_STALL_MS); await flush(); const got = await promise;
  assert.deepEqual(got?.snap, sample); assert.equal(got?.response.headers.get('x-epoch'), 'new'); assert.equal(aborted, 2);
  assert.deepEqual(calls, [entryWireUrl(plain), entryWireUrl(plain), plain]);
  t.mock.timers.tick(60000); await flush(); assert.equal(calls.length, 3, 'no retry timer survives completion');
});

test('stalled wire body cancels its reader and falls back; stalled plain body rejects finitely', async t => {
  const g = setup(t); let cancelled = 0, calls = 0;
  g.fetch = (async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"seq":')); }, cancel() { cancelled++; } })); }) as typeof fetch;
  const outcome = loadSnapshot(plain, new AbortController().signal).then(() => 'unexpected', e => e);
  await flush(); t.mock.timers.tick(SNAPSHOT_STALL_MS); await flush(); assert.equal(calls, 2); assert.equal(cancelled, 1);
  t.mock.timers.tick(SNAPSHOT_STALL_MS); await flush(); assert.equal((await outcome).name, 'TimeoutError'); assert.equal(cancelled, 2);
});

test('slow progressing UTF-8 body survives several deadlines; zero bytes do not reset inactivity', async t => {
  const g = setup(t); let stream!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0;
  g.fetch = (async () => new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; }, cancel() { cancelled++; } }))) as typeof fetch;
  const promise = loadSnapshot(plain, new AbortController().signal); await flush();
  const bytes = new TextEncoder().encode('\ufeff'+JSON.stringify(sample));
  for (let i = 0; i < bytes.length; i += 9) { t.mock.timers.tick(7000); stream.enqueue(bytes.slice(i, i + 9)); await flush(); }
  stream.close(); await flush(); assert.deepEqual((await promise)?.snap, sample); assert.equal(cancelled, 0);
  let calls = 0; g.fetch = (async () => { calls++; return calls === 1 ? new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; } })) : json(sample); }) as typeof fetch;
  const zero = loadSnapshot(plain, new AbortController().signal); await flush();
  t.mock.timers.tick(SNAPSHOT_STALL_MS-1); stream.enqueue(new Uint8Array()); await flush(); t.mock.timers.tick(1); await flush();
  assert.deepEqual((await zero)?.snap, sample); assert.equal(calls, 2);
});

test('caller abort during headers or body rejects without plain fallback, and a new epoch loads independently', async t => {
  const g = setup(t); let calls = 0, cancelled = 0;
  for (const body of [false, true]) {
    const ctl = new AbortController();
    g.fetch = (async (_url, init) => { calls++; return body ? new Response(new ReadableStream({ cancel() { cancelled++; } })) : hanging(init?.signal, () => cancelled++); }) as typeof fetch;
    const outcome = loadSnapshot(plain, ctl.signal, true).then(() => null, e => e); await flush(); ctl.abort(); await flush();
    assert.equal((await outcome).name, 'AbortError');
  }
  assert.equal(calls, 2); assert.equal(cancelled, 2);
  g.fetch = (async () => json(sample)) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal))?.snap, sample);
  t.mock.timers.tick(60000); await flush(); assert.equal(calls, 2);
});

test('one failed wire part cancels its sibling body; mismatched references still use plain fallback', async t => {
  const g = setup(t), defs = 'a'.repeat(32), ground = 'b'.repeat(32); let cancelled = 0;
  g.fetch = (async url => {
    if (String(url) === plain) return json(sample);
    if (String(url).endsWith('/'+defs)) return new Response('missing', { status: 404 });
    if (String(url).endsWith('/'+ground)) return new Response(new ReadableStream({ cancel() { cancelled++; } }));
    return json({ defsRef: defs, groundRef: ground, entities: [] }, { 'x-defs-ref': defs, 'x-ground-ref': ground });
  }) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal))?.snap, sample); await flush(); assert.equal(cancelled, 1);
  g.fetch = (async url => String(url) === plain ? json(sample) : String(url).includes('/part/') ? json([]) : json({ defsRef: 'wrong', groundRef: ground }, { 'x-defs-ref': defs, 'x-ground-ref': ground })) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal))?.snap, sample);
});

test('inline prefetch controller adoption sends no duplicate and cancels unused parts without touching config', async t => {
  const g = setup(t), calls: string[] = [], aborted: string[] = [], ref = 'c'.repeat(32);
  const context: Record<string, unknown> = { location: { pathname: '/w/fixture' }, AbortController, __simSnapshotParts: [ref], fetch: (url: string, init?: RequestInit) => {
    calls.push(url); init?.signal?.addEventListener('abort', () => aborted.push(url));
    return url.includes('/snapshot') ? Promise.resolve(json(sample)) : hanging(init?.signal, () => {});
  } }; context.window = context; vm.runInNewContext(entryPrefetchScript(''), context); g.window = context;
  g.fetch = (async () => { throw Error('duplicate fetch'); }) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal, true))?.snap, sample);
  assert.deepEqual(calls, [entryWireUrl(plain), '/w/fixture/v1/config', '/w/fixture/v1/world/part/'+ref]);
  assert.ok(!aborted.includes(entryWireUrl(plain)), 'the consumed snapshot is released'); assert.ok(aborted.includes('/w/fixture/v1/world/part/'+ref)); assert.ok(!aborted.includes('/w/fixture/v1/config'));
});

test('old controller-less prefetch remains compatible; late losing body is cancelled', async t => {
  const g = setup(t); let resolve!: (r: Response) => void, cancelled = 0;
  g.window = { __simSnapshotPrefetch: { url: entryWireUrl(plain), response: new Promise<Response>(r => resolve = r) } };
  g.fetch = (async () => json(sample)) as typeof fetch;
  const promise = loadSnapshot(plain, new AbortController().signal, true); await flush(); t.mock.timers.tick(ENTRY_HEDGE_MS); await flush();
  assert.deepEqual((await promise)?.snap, sample);
  resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }))); await flush(); assert.equal(cancelled, 1);
});

test('plain headers are also bounded after wire failure; abort-ignoring fetch cannot hold logical completion', async t => {
  const g = setup(t); let calls = 0;
  g.fetch = (async () => { calls++; return calls === 1 ? new Response('', { status: 503 }) : new Promise<Response>(() => {}); }) as typeof fetch;
  const outcome = loadSnapshot(plain, new AbortController().signal).then(() => null, e => e); await flush();
  t.mock.timers.tick(SNAPSHOT_STALL_MS); await flush(); assert.equal((await outcome).name, 'TimeoutError'); assert.equal(calls, 2);
});

test('owned entry prefetch abort stops late part launch, and mismatched-page prefetch is discarded', async t => {
  const g = setup(t), calls: string[] = [], signals: AbortSignal[] = []; let answer!: (r: Response) => void;
  const context: Record<string, unknown> = { location: { pathname: '/w/fixture' }, AbortController, fetch: (url: string, init?: RequestInit) => {
    calls.push(url); if (init?.signal) signals.push(init.signal);
    return url.includes('snapshot') ? new Promise<Response>(r => answer = r) : Promise.resolve(json({}));
  } }; context.window = context; vm.runInNewContext(entryPrefetchScript(''), context); g.window = context;
  g.fetch = (async () => json(sample)) as typeof fetch;
  const promise = loadSnapshot(plain, new AbortController().signal, true); await flush(); t.mock.timers.tick(ENTRY_HEDGE_MS); await flush();
  assert.deepEqual((await promise)?.snap, sample); assert.equal(signals[0].aborted, true);
  answer(json({}, { 'x-defs-ref': 'a'.repeat(32), 'x-ground-ref': 'b'.repeat(32) })); await flush(); assert.equal(calls.length, 2, 'discarded batch cannot launch late parts');
  let discarded = 0; g.window = { __simSnapshotPrefetch: { url: '/w/old/v1/world/snapshot', response: Promise.resolve(json({epoch:'old'})), abort() { discarded++; } } };
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal, true))?.snap, sample); assert.equal(discarded, 1);
});

test('failed hedge headers cannot cancel a slower valid sibling; lone HTTP failure still falls back immediately', async t => {
  const g = setup(t); let answer!: (r: Response) => void, calls = 0, failedBodyCancelled = 0;
  g.fetch = (async () => { calls++; if (calls === 1) return new Promise<Response>(r => answer = r); if (calls === 2) return new Response(new ReadableStream({ cancel() { failedBodyCancelled++; } }), { status: 503 }); throw Error('plain fallback should not replace a pending valid wire'); }) as typeof fetch;
  const promise = loadSnapshot(plain, new AbortController().signal, true); await flush(); t.mock.timers.tick(ENTRY_HEDGE_MS); await flush();
  assert.equal(calls, 2); assert.equal(failedBodyCancelled, 1); answer(json(sample)); await flush(); assert.deepEqual((await promise)?.snap, sample);
  calls = 0; g.fetch = (async () => ++calls === 1 ? new Response('', { status: 404 }) : json(sample)) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal, true))?.snap, sample); assert.equal(calls, 2);
});


test('fully consumed wire winners release their fetch signals before parse and completion', async t => {
  const g = setup(t), defs = 'd'.repeat(32), ground = 'e'.repeat(32), signals: AbortSignal[] = [];
  const calls: string[] = []; let cancelled = 0, finishParse!: () => void;
  const wire = { ...sample, defsRef: defs, groundRef: ground };
  const response = (value: unknown, headers?: Record<string, string>) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, 7)); c.enqueue(bytes.slice(7)); c.close(); },
      cancel() { cancelled++; },
    }), { headers });
  };
  g.fetch = (async (url, init) => {
    calls.push(String(url)); signals.push(init!.signal!);
    return String(url).endsWith('/'+defs) ? response(sample.defs) : String(url).endsWith('/'+ground) ? response(sample.ground)
      : response(wire, { 'x-defs-ref': defs, 'x-ground-ref': ground, 'x-epoch': 'new' });
  }) as typeof fetch;
  const caller = new AbortController();
  const promise = loadSnapshot(plain, caller.signal, false, async pieces => {
    assert.equal(pieces.kind, 'wire');
    const snap = parsePieces(pieces);
    await new Promise<void>(resolve => finishParse = resolve);
    return snap;
  });
  await flush(); assert.equal(signals.length, 3); assert.ok(finishParse, 'all streams reached EOF before parse');
  assert.ok(signals.every(s => !s.aborted)); finishParse();
  const got = await promise;
  assert.deepEqual(got?.snap, sample); assert.equal(got?.response.headers.get('x-epoch'), 'new');
  assert.ok(signals.every(s => !s.aborted), 'successful transport cleanup must not abort completed fetches');
  caller.abort(); t.mock.timers.tick(60000); await flush();
  assert.ok(signals.every(s => !s.aborted)); assert.equal(cancelled, 0); assert.equal(calls.length, 3);
});

test('plain fallback retires failed request while preserving the consumed winner', async t => {
  const g = setup(t), signals: AbortSignal[] = []; let cancelled = 0;
  g.fetch = (async (_url, init) => {
    signals.push(init!.signal!);
    return signals.length === 1 ? new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 }) : json(sample);
  }) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal))?.snap, sample);
  assert.deepEqual(signals.map(s => s.aborted), [true, false]); assert.equal(cancelled, 1);
});

test('inline wire prefetch transfers the snapshot and each used part while cancelling unused parts', async t => {
  const g = setup(t), defs = 'a'.repeat(32), ground = 'b'.repeat(32), unused = 'c'.repeat(32);
  const calls: string[] = [], signals = new Map<string, AbortSignal>();
  const context: Record<string, unknown> = { location: { pathname: '/w/fixture' }, AbortController, __simSnapshotParts: [defs, ground, unused], fetch: (url: string, init?: RequestInit) => {
    calls.push(url); signals.set(url, init!.signal!);
    if (url.endsWith('/'+unused)) return hanging(init?.signal, () => {});
    const body = url.includes('/snapshot') ? { ...sample, defsRef: defs, groundRef: ground } : url.endsWith('/'+defs) ? sample.defs : url.endsWith('/'+ground) ? sample.ground : {};
    return Promise.resolve(json(body, url.includes('/snapshot') ? { 'x-defs-ref': defs, 'x-ground-ref': ground } : {}));
  } }; context.window = context; vm.runInNewContext(entryPrefetchScript(''), context); g.window = context;
  g.fetch = (async () => { throw Error('duplicate fetch'); }) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal, true))?.snap, sample);
  await flush();
  assert.equal(calls.length, 5); assert.equal(new Set(calls).size, 5, 'one request per snapshot, config and part');
  assert.deepEqual([...signals].filter(([, s]) => s.aborted).map(([url]) => url), ['/w/fixture/v1/world/part/'+unused]);
});


test('entry hedge aborts only the pending loser and releases the consumed winner', async t => {
  const g = setup(t), signals: AbortSignal[] = [];
  g.fetch = (async (_url, init) => {
    signals.push(init!.signal!);
    return signals.length === 1 ? hanging(init?.signal, () => {}) : json(sample);
  }) as typeof fetch;
  const promise = loadSnapshot(plain, new AbortController().signal, true); await flush();
  t.mock.timers.tick(ENTRY_HEDGE_MS); await flush();
  assert.deepEqual((await promise)?.snap, sample); assert.deepEqual(signals.map(s => s.aborted), [true, false]);
});

test('caller abort cancels an active body but only rejects parsing after its body has finished', async t => {
  const g = setup(t), signals: AbortSignal[] = []; let cancelled = 0, finishParse!: () => void;
  g.fetch = (async (_url, init) => { signals.push(init!.signal!); return new Response(new ReadableStream({ cancel() { cancelled++; } })); }) as typeof fetch;
  const active = new AbortController(), activeReason = new Error('left during download');
  const activeResult = loadSnapshot(plain, active.signal).then(() => null, e => e); await flush(); active.abort(activeReason);
  assert.equal(await activeResult, activeReason); assert.equal(signals[0].aborted, true); assert.equal(cancelled, 1);
  g.fetch = (async (_url, init) => { signals.push(init!.signal!); return json(sample); }) as typeof fetch;
  const parsing = new AbortController(), parsingReason = new Error('left during parse');
  const parsedResult = loadSnapshot(plain, parsing.signal, false, async pieces => {
    const snap = parsePieces(pieces); await new Promise<void>(resolve => finishParse = resolve); return snap;
  }).then(() => null, e => e);
  await flush(); assert.ok(finishParse); parsing.abort(parsingReason); finishParse();
  assert.equal(await parsedResult, parsingReason); assert.equal(signals[1].aborted, false, 'EOF already released the request');
  assert.equal(signals.length, 2, 'caller abort never starts plain fallback');
});

test('part failure cancels unfinished siblings while a consumed snapshot and plain winner stay released', async t => {
  const g = setup(t), defs = 'd'.repeat(32), ground = 'e'.repeat(32), signals: AbortSignal[] = [];
  let failPart!: (r: Response) => void, cancelled = 0;
  g.fetch = (async (url, init) => {
    signals.push(init!.signal!);
    if (String(url) === plain) return json(sample);
    if (String(url).endsWith('/'+defs)) return new Promise<Response>(resolve => failPart = resolve);
    if (String(url).endsWith('/'+ground)) return new Response(new ReadableStream({ cancel() { cancelled++; } }));
    return json({ ...sample, defsRef: defs, groundRef: ground }, { 'x-defs-ref': defs, 'x-ground-ref': ground });
  }) as typeof fetch;
  const promise = loadSnapshot(plain, new AbortController().signal); await flush();
  failPart(new Response('missing', { status: 404 }));
  assert.deepEqual((await promise)?.snap, sample);
  assert.deepEqual(signals.map(s => s.aborted), [false, true, true, false]); assert.equal(cancelled, 1);
});

test('controller-less cached prefetch consumes used parts once and cancels a late unused body', async t => {
  const g = setup(t), defs = 'a'.repeat(32), ground = 'b'.repeat(32), unused = 'c'.repeat(32);
  let answerUnused!: (r: Response) => void, cancelled = 0;
  g.window = { __simSnapshotPrefetch: {
    url: entryWireUrl(plain), response: Promise.resolve(json({ ...sample, defsRef: defs, groundRef: ground }, { 'x-defs-ref': defs, 'x-ground-ref': ground })),
    parts: { [defs]: Promise.resolve(json(sample.defs)), [ground]: Promise.resolve(json(sample.ground)), [unused]: new Promise<Response>(resolve => answerUnused = resolve) },
  } };
  g.fetch = (async () => { throw Error('duplicate fetch'); }) as typeof fetch;
  assert.deepEqual((await loadSnapshot(plain, new AbortController().signal, true))?.snap, sample);
  answerUnused(new Response(new ReadableStream({ cancel() { cancelled++; } }))); await flush();
  assert.equal(cancelled, 1); assert.equal((g.window as Record<string, unknown>).__simSnapshotPrefetch, undefined);
});
