// Lane L3h: the entry prefetch (index.html's inline head script) sends exactly the GET WorldEntityLayer.start used to
// send, once, and start takes it instead of fetching again.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { registerHooks } from 'node:module';
import { entryPrefetchScript, OLD_WORLD_KEYS, PREFETCH_GLOBAL, takeSnapshotPrefetch, takePartPrefetch, worldKeyFrom } from './snapshot-prefetch.ts';

// world-path.ts's key before this lane (inline in that file): the shared worldKeyFrom must give the same key
const keyBefore = (pathname: string, base: string) => (base && pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname).match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/)?.[1] ?? 'toy';
const PATHS = ['/', '/w/eden-2026', '/w/eden-2026/', '/w/eden-2026/#god', '/w/mars-two/x', '/w/eden', '/w/mars/', '/w/littlemartians', '/w/toy',
  '/w/Eden-2026', '/w/2026', '/w/a', '/w/' + 'a'.repeat(32), '/w/' + 'a'.repeat(33), '/worlds/w/eden-2026', '/worlds/w/mars', '/worlds/', '/worldsx/w/x-1', '/w/x_y'];

/** Run the inline script as the browser would (classic script, global window), with a recording fetch. */
function runEntry(base: string, pathname: string) {
  const calls: unknown[][] = [];
  const ctx: Record<string, unknown> = { location: { pathname }, fetch: (...a: unknown[]) => { calls.push(a); return Promise.resolve(new Response('{}')); } };
  ctx.window = ctx;
  vm.runInNewContext(entryPrefetchScript(base), ctx);
  return { calls, left: ctx[PREFETCH_GLOBAL] as { url: string; response: Promise<Response> } | undefined };
}

test('entry script: one plain GET of this new world\'s snapshot URL (the layer\'s exact URL), none on old worlds', () => {
  for (const base of ['', '/worlds']) for (const pathname of PATHS) {
    const key = worldKeyFrom(pathname, base), apiUrl = `${base}/w/${key}/v1/world/snapshot?defs=ref&cols=1`;  // = world-path apiPath('/v1/world/snapshot') in W3's wire form
    assert.equal(key, keyBefore(pathname, base), `${base} ${pathname}: same world key as before`);
    const { calls, left } = runEntry(base, pathname);
    if (OLD_WORLD_KEYS.includes(key)) { assert.equal(calls.length, 0, `${base} ${pathname}: old world, no prefetch`); assert.equal(left, undefined); continue; }
    assert.deepEqual(calls, [[apiUrl], [`${base}/w/${key}/v1/config`]], `${base} ${pathname}: the snapshot and config GETs, no init (fetch defaults = the page's requests)`);
    assert.equal(left?.url, apiUrl);
  }
});

test('entry script: a failed prefetch leaves no unhandled rejection and still hands the failure to its taker', async () => {
  const ctx: Record<string, unknown> = { location: { pathname: '/w/eden-2026' }, fetch: () => Promise.reject(new TypeError('offline')) };
  ctx.window = ctx;
  let unhandled = 0; const on = () => { unhandled++; }; process.on('unhandledRejection', on);
  try {
    vm.runInNewContext(entryPrefetchScript(''), ctx);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandled, 0);
    await assert.rejects((ctx[PREFETCH_GLOBAL] as { response: Promise<Response> }).response, /offline/);  // start's try/catch returns, as a failed fetch did
  } finally { process.off('unhandledRejection', on); }
});

test('takeSnapshotPrefetch: the matching URL once; a mismatch or a second take gets null', () => {
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g; g.window ??= g;
  try {
    const response = Promise.resolve(new Response('{}'));
    g[PREFETCH_GLOBAL] = { url: '/w/a/v1/world/snapshot', response };
    assert.equal(takeSnapshotPrefetch('/w/a/v1/world/snapshot'), response);
    assert.equal(takeSnapshotPrefetch('/w/a/v1/world/snapshot'), null);
    g[PREFETCH_GLOBAL] = { url: '/w/a/v1/world/snapshot', response };
    assert.equal(takeSnapshotPrefetch('/w/b/v1/world/snapshot'), null);
    assert.equal(g[PREFETCH_GLOBAL], undefined);
  } finally { delete g[PREFETCH_GLOBAL]; if (!hadWindow) delete g.window; }
});

test('WorldEntityLayer.start takes the entry response (no second request); a later start fetches afresh', async () => {
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g, realFetch = globalThis.fetch;
  (g as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  g.window ??= g;
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hooks.deregister());
  const fetched: string[] = [];
  globalThis.fetch = (async (u: string) => { fetched.push(String(u)); return Response.json({ contract: 'not-world' }); }) as typeof fetch;
  try {
    const layer = new WorldEntityLayer((p) => '/w/fixture' + p), entry = new Response(JSON.stringify({ contract: 'not-world' }));
    g[PREFETCH_GLOBAL] = { url: '/w/fixture/v1/world/snapshot?defs=ref&cols=1', response: Promise.resolve(entry) };
    await layer.start(new AbortController().signal);
    assert.deepEqual(fetched, [], 'start sent no request of its own');
    assert.equal(entry.bodyUsed, true, 'start read the entry response');
    await layer.start(new AbortController().signal);
    assert.deepEqual(fetched, ['/w/fixture/v1/world/snapshot?defs=ref&cols=1'], 'a re-mount (new epoch) takes a fresh snapshot, as before');
  } finally { globalThis.fetch = realFetch; delete g[PREFETCH_GLOBAL]; if (!hadWindow) delete g.window; }
});

// The page's second snapshot request (GodPanel's flags, on every edit, for every viewer) now reads the layer's copy.
test('GodPanel flags: flagRefsOf over the layer\'s entities = the old snapshot derivation; entitiesAt waits for the edit', async () => {
  const g = globalThis as Record<string, unknown>; (g as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const { flagRefsOf } = await import('./god-ui/god-api.ts');
  type E = { id: string; name?: string; def: string; p?: number[]; state?: { label?: string }; in: { parent: string } };
  const before = (es: E[]) => es.filter((e) => /^core[-/]flag@/.test(e.def) && e.in.parent === 'world' && Array.isArray(e.p)).map((e) => {
    const p = e.p!; return { id: e.id, name: e.name ?? e.id, label: e.state?.label ?? e.name ?? e.id, p: p.length === 3 ? [p[0], p[1], p[2]] : [p[0], 0, p[1]] };
  });
  const es: E[] = [
    { id: 'e1', name: 'camp', def: 'core/flag@1', p: [1, 2, 3], state: { label: 'Camp' }, in: { parent: 'world' } },
    { id: 'e2', def: 'core-flag@2', p: [4, 5], in: { parent: 'world' } },
    { id: 'e3', name: 'held', def: 'core/flag@1', p: [0, 0, 0], in: { parent: 'e9' } },
    { id: 'e4', name: 'bench', def: 'core/bench@1', p: [0, 0, 0], in: { parent: 'world' } },
    { id: 'e5', name: 'nowhere', def: 'core/flag@1', in: { parent: 'world' } },
  ];
  assert.deepEqual(flagRefsOf(es), before(es));
  assert.equal(flagRefsOf(es).length, 2);
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hooks.deregister());
  const layer = new WorldEntityLayer((p) => p);
  assert.equal(layer.entitiesAt(0), null, 'no picture yet: GodPanel waits, then falls back to the snapshot');
});

// Lane W1: the socket at page entry, adopted by useSouls's Connection.
import { CONFIG_GLOBAL, OPEN_SOCKET_GLOBAL, SOCKET_GLOBAL, takeBootSocket, takeConfigPrefetch, entrySnapshotUrl, entryWireUrl } from './snapshot-prefetch.ts';
import { anonymousHello, Connection } from '@souls/client';

class FakeWS { static made: FakeWS[] = []; readyState = 0; sent: string[] = []; closed = false; onopen: any; onmessage: any; onclose: any; onerror: any; url: string;
  constructor(url: string) { this.url = url; FakeWS.made.push(this); }
  send(s: string) { this.sent.push(s); } close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); } recv(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); } }

function runEntryWithSocket(pathname: string, hello: string, extra: Record<string, unknown> = {}) {
  FakeWS.made = []; const timers: (() => void)[] = [];
  const ctx: Record<string, unknown> = { location: { pathname, protocol: 'https:', host: 'sim.test' }, fetch: () => Promise.resolve(new Response('{}')), WebSocket: FakeWS, setTimeout: (f: () => void) => { timers.push(f); }, ...extra };
  ctx.window = ctx;
  vm.runInNewContext(entryPrefetchScript('/worlds', OLD_WORLD_KEYS, hello), ctx);
  return { ctx, timers };
}

// P7: the hello now rides in the socket's URL (`says the given hello on open` is kept as the gate's test id)
test('entry socket: opened at entry for new worlds only, says the given hello on open, queues what arrives, closes unadopted after 20 s', () => {
  const hello = anonymousHello(true);
  const { ctx, timers } = runEntryWithSocket('/worlds/w/eden-2026/', hello);
  const boot = ctx[SOCKET_GLOBAL] as { url: string; queue: unknown[]; sent: boolean; ws: FakeWS };
  assert.equal(FakeWS.made.length, 1); assert.equal(boot.url, 'wss://sim.test/worlds/w/eden-2026/ws');
  assert.equal(boot.ws.url, `wss://sim.test/worlds/w/eden-2026/ws?hello=${encodeURIComponent(hello)}`); assert.equal(boot.sent, true);
  boot.ws.open(); assert.deepEqual(boot.ws.sent, [], 'nothing sent from the open event');
  boot.ws.recv({ t: 'welcome' }); assert.equal(boot.queue.length, 1);
  timers.forEach((f) => f()); assert.equal(boot.ws.closed, true);
  runEntryWithSocket('/worlds/w/mars/', hello); assert.equal(FakeWS.made.length, 0, 'old worlds open nothing');
  const plain = runEntry('/worlds', '/worlds/w/eden-2026/'); assert.equal(plain.calls.length, 2, 'no hello given: no socket (and no throw without WebSocket)');
});

test('entry socket: adopted socket keeps the identical anonymous hello and replays the queue; a different hello reopens at once', async () => {
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g; g.window ??= g;
  try {
    for (const token of [null, 'dev:someone']) {
      const { ctx } = runEntryWithSocket('/worlds/w/eden-2026/', anonymousHello(true));
      const boot = ctx[SOCKET_GLOBAL] as { ws: FakeWS }; boot.ws.open();
      boot.ws.recv({ t: 'welcome', proto: 1, worldId: 'w', epoch: 'e1', dt: 0.05, clockRate: 1, serverTick: 1, you: null, serverTime: 0, build: 'dev', takeTransport: 'take-boundary-facts/1', takeEntities: 'take-entities-ref/1', takeChunks: 'take-chunk-ref/1' });
      boot.ws.recv({ t: 'snapshot', reason: 'join', tick: 1, seq: 5, viewHash: '', entities: {}, regions: {}, env: null, paths: [], souls: [] });
      boot.ws.recv({ t: 'log', events: [] });
      g[SOCKET_GLOBAL] = ctx[SOCKET_GLOBAL];
      const seen: string[] = []; const fresh: FakeWS[] = [];
      const conn = new Connection('wss://sim.test/worlds/w/eden-2026/ws', async () => token, { onLog: () => seen.push('log') }, (u) => { const w = new FakeWS(u); fresh.push(w); return w as never; }, undefined, undefined, undefined, true);
      const taken = takeBootSocket('wss://sim.test/worlds/w/eden-2026/ws'); assert.ok(taken); conn.adopt(taken as never);
      assert.equal(takeBootSocket('wss://sim.test/worlds/w/eden-2026/ws'), null, 'taken once');
      conn.connect();
      assert.deepEqual(seen, ['log'], 'the queued message reached the handlers');
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(conn.replica.seq, 5, 'the queued snapshot reached the replica');
      if (token === null) { assert.equal(fresh.length, 0, 'same hello (its queued snapshot does not count as a replica it said hello with): the entry socket is kept'); assert.deepEqual(boot.ws.sent, [], 'no second hello (the first was in the URL)'); }
      else { assert.equal(fresh.length, 1, 'signed in: a fresh socket at once'); assert.equal(boot.ws.closed, true); fresh[0].open(); await new Promise((r) => setTimeout(r, 5)); assert.match(fresh[0].sent[0], /"token":"dev:someone"/); }
      conn.close();
    }
  } finally { delete g[SOCKET_GLOBAL]; if (!hadWindow) delete g.window; }
});

test('config prefetch is taken once for its URL; entrySnapshotUrl keys the URL with the page\'s snapshot key', () => {
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g; g.window ??= g;
  try {
    const response = Promise.resolve(new Response('{}'));
    g[CONFIG_GLOBAL] = { url: '/w/a/v1/config', response };
    assert.equal(takeConfigPrefetch('/w/b/v1/config'), null); assert.equal(takeConfigPrefetch('/w/a/v1/config'), null, 'gone after a mismatch');
    g[CONFIG_GLOBAL] = { url: '/w/a/v1/config', response }; assert.equal(takeConfigPrefetch('/w/a/v1/config'), response);
    assert.equal(entrySnapshotUrl('/w/a/v1/world/snapshot'), '/w/a/v1/world/snapshot');
    g.__simSnapshotKey = '3.0.0.0'; assert.equal(entrySnapshotUrl('/w/a/v1/world/snapshot'), '/w/a/v1/world/snapshot?v=3.0.0.0');
  } finally { delete g[CONFIG_GLOBAL]; delete g.__simSnapshotKey; if (!hadWindow) delete g.window; }
});

test('entry script: with the server-named snapshot key it prefetches the keyed URL (the one start takes)', () => {
  const calls: unknown[][] = [];
  const ctx: Record<string, unknown> = { location: { pathname: '/worlds/w/eden-2026/' }, fetch: (...a: unknown[]) => { calls.push(a); return Promise.resolve(new Response('{}')); }, __simSnapshotKey: '9.1.0.0' };
  ctx.window = ctx; vm.runInNewContext(entryPrefetchScript('/worlds'), ctx);
  assert.deepEqual(calls[0], ['/worlds/w/eden-2026/v1/world/snapshot?defs=ref&cols=1&v=9.1.0.0']);
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g; g.window ??= g;
  try { g.__simSnapshotKey = '9.1.0.0'; assert.equal(entryWireUrl('/worlds/w/eden-2026/v1/world/snapshot'), calls[0][0]); } finally { delete g.__simSnapshotKey; if (!hadWindow) delete g.window; }
});

test('W3 entry script: the wire snapshot\'s part headers start the part fetches; takePartPrefetch hands each over once', async () => {
  const calls: string[] = [];
  const ctx: Record<string, unknown> = { location: { pathname: '/w/eden-2026' }, fetch: (u: string) => { calls.push(u); return Promise.resolve(new Response('{}', { headers: u.includes('snapshot') ? { 'x-defs-ref': 'a'.repeat(32), 'x-ground-ref': 'b'.repeat(32) } : {} })); } };
  ctx.window = ctx;
  vm.runInNewContext(entryPrefetchScript(''), ctx);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.filter((u) => /snapshot|part/.test(u)), ['/w/eden-2026/v1/world/snapshot?defs=ref&cols=1', `/w/eden-2026/v1/world/part/${'a'.repeat(32)}`, `/w/eden-2026/v1/world/part/${'b'.repeat(32)}`]);
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g; g.window ??= g;
  try {
    g[PREFETCH_GLOBAL] = ctx[PREFETCH_GLOBAL];
    assert.ok(takeSnapshotPrefetch('/w/eden-2026/v1/world/snapshot?defs=ref&cols=1'));
    assert.ok(takePartPrefetch('a'.repeat(32))); assert.equal(takePartPrefetch('a'.repeat(32)), null);
  } finally { delete g[PREFETCH_GLOBAL]; if (!hadWindow) delete g.window; }
});

test('P7 entry script: parts the HTML names leave before the snapshot answers, once each; a part only the headers name follows', async () => {
  const calls: string[] = []; let answer!: (r: Response) => void;
  const ctx: Record<string, unknown> = { location: { pathname: '/w/eden-2026' }, __simSnapshotParts: ['a'.repeat(32), 'c'.repeat(32), 'not-a-ref'],
    fetch: (u: string) => { calls.push(u); return u.includes('snapshot') ? new Promise<Response>((r) => { answer = r; }) : Promise.resolve(new Response('{}')); } };
  ctx.window = ctx;
  vm.runInNewContext(entryPrefetchScript(''), ctx);
  assert.deepEqual(calls.filter((u) => /part/.test(u)), [`/w/eden-2026/v1/world/part/${'a'.repeat(32)}`, `/w/eden-2026/v1/world/part/${'c'.repeat(32)}`], 'before the snapshot answered; a malformed ref is ignored');
  answer(new Response('{}', { headers: { 'x-defs-ref': 'a'.repeat(32), 'x-ground-ref': 'b'.repeat(32) } }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.filter((u) => /part/.test(u)).map((u) => u.slice(-32)), ['a'.repeat(32), 'c'.repeat(32), 'b'.repeat(32)]);
});

// lane PAIR-UI: an #approve link may be handed to an open tab of the world, so its page opens no world socket at entry
test('entry socket: an #approve link opens no world socket (a full boot opens its own)', () => {
  const loc = { pathname: '/worlds/w/eden-2026/', protocol: 'https:', host: 'sim.test' };
  runEntryWithSocket(loc.pathname, anonymousHello(true), { location: { ...loc, hash: '#approve/ap_0123456789abcdef' } });
  assert.equal(FakeWS.made.length, 0);
  const phased = runEntryWithSocket(loc.pathname, anonymousHello(true), { location: { ...loc, hash: '#approve/ap_0123456789abcdef', search: '?early=1' }, URLSearchParams, screen: { width: 390, height: 844 }, navigator: {} });
  assert.equal(typeof phased.ctx[OPEN_SOCKET_GLOBAL], 'function', 'phased entry');
  const open = phased.ctx[OPEN_SOCKET_GLOBAL] as (() => void) | undefined; open?.(); assert.equal(FakeWS.made.length, 0, 'phased second phase too');
  runEntryWithSocket(loc.pathname, anonymousHello(true), { location: { ...loc, hash: '#soul/s_1' } });
  assert.equal(FakeWS.made.length, 1);
});


test('renamed Eden uses its inline runtime kind for prefetch, while legacy Eden stays unchanged', () => {
  for (const worldEngine of [true, false]) {
    const calls: unknown[][] = [];
    const ctx: Record<string, unknown> = { location: { pathname: '/w/eden/' }, __simConfig: { worldEngine }, fetch: (...a: unknown[]) => { calls.push(a); return Promise.resolve(new Response('{}')); } };
    ctx.window = ctx; vm.runInNewContext(entryPrefetchScript(''), ctx);
    assert.equal(calls.length, worldEngine ? 2 : 0);
    if (worldEngine) assert.equal(calls[0]![0], '/w/eden/v1/world/snapshot?defs=ref&cols=1');
  }
});
