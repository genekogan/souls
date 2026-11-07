// P7b lever E1: index.html's two-phase loader (phased-entry.ts) and the head script's decision (snapshot-prefetch.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PHASE2_FALLBACK_MS, PHASE2_FILL, PHASE2_GLOBAL, SOCKET_FALLBACK_MS, phasedLoaderScript, rewritePhasedHtml } from './phased-entry.ts';
import { phasedEntryWanted } from './snapshot-prefetch.ts';
import { pickQualityTier } from './quality-tier.ts';
import { earlyArrivalWanted } from './early-arrival.ts';

const HTML = `<head>
    <script>prefetch()</script>
    <script type="module" crossorigin src="/worlds/assets/main-A.js"></script>
    <link rel="modulepreload" crossorigin href="/worlds/assets/three-B.js">
    <link rel="modulepreload" crossorigin href="/worlds/assets/react-C.js">
    <link rel="modulepreload" crossorigin href="/worlds/assets/Shell-D.js">
    <link rel="stylesheet" crossorigin href="/worlds/assets/main.css">
  </head>`;

/** Run the loader against a recording document; returns the tags it added, in order, and the window. */
function runLoader(js: string, phased: boolean) {
  const added: { tag: string; url: string; el: Record<string, unknown> }[] = [], timers: (() => void)[] = [];
  const win: Record<string, unknown> = { __soulsPhased: phased, __soulsOpenSocket: () => { added.push({ tag: 'socket', url: '', el: {} }); } };
  const document = { createElement: (tag: string) => ({ tag }), head: { appendChild: (el: Record<string, unknown>) => { added.push({ tag: el.type === 'module' ? 'entry' : String(el.rel), url: String(el.src ?? el.href), el }); } } };
  vm.runInNewContext(js, { window: win, document, setTimeout: (f: () => void) => timers.push(f) });
  return { added, win, timers };
}

test('rewritePhasedHtml: one loader in place of the module script and preloads; phase one = the early entry and its imports', () => {
  const out = rewritePhasedHtml(HTML, 'assets/main-A.js', 'assets/early-E.js', ['assets/three-B.js']);
  assert.doesNotMatch(out, /<script type="module"|<link rel="modulepreload"/);
  assert.match(out, /<link rel="stylesheet" crossorigin href="\/worlds\/assets\/main.css">/, 'stylesheets stay');
  assert.ok(out.indexOf('prefetch()') < out.indexOf('__soulsPhase2'), 'after the head script');
  const js = /<script>(\(function\(\)\{var d=document[\s\S]*?)<\/script>/.exec(out)![1];
  // one phase (desktop, old world): main first, then the early entry, socket with main
  const one = runLoader(js, false);
  assert.deepEqual(one.added.map((a) => `${a.tag} ${a.url}`), ['modulepreload /worlds/assets/react-C.js', 'modulepreload /worlds/assets/Shell-D.js', 'entry /worlds/assets/main-A.js', 'socket ', 'modulepreload /worlds/assets/three-B.js', 'entry /worlds/assets/early-E.js']);
  assert.equal(one.added[2].el.crossOrigin, '', 'crossorigin as Vite wrote it (no second fetch)');
  // two phases: the early entry only, then the rest once phase two is called (once)
  const two = runLoader(js, true);
  assert.deepEqual(two.added.map((a) => a.url), ['/worlds/assets/three-B.js', '/worlds/assets/early-E.js']);
  (two.win[PHASE2_GLOBAL] as () => void)(); (two.win[PHASE2_GLOBAL] as () => void)(); two.timers.forEach((f) => f());
  assert.deepEqual(two.added.slice(2).map((a) => `${a.tag} ${a.url}`), ['modulepreload /worlds/assets/react-C.js', 'modulepreload /worlds/assets/Shell-D.js', 'entry /worlds/assets/main-A.js', 'socket ']);
  // P7d: phase two's downloads first (held entry); t4-phone: no socket yet, then at the early renderer's fill the entry's
  // download and the socket, the entry itself at the next plain call or the fallback
  const held = runLoader(js, true), call = held.win[PHASE2_GLOBAL] as (h?: true | string) => void; call(true); call(true);
  assert.deepEqual(held.added.slice(2).map((a) => `${a.tag} ${a.url}`), ['modulepreload /worlds/assets/react-C.js', 'modulepreload /worlds/assets/Shell-D.js']);
  call(PHASE2_FILL); call(PHASE2_FILL);
  assert.deepEqual(held.added.slice(4).map((a) => `${a.tag} ${a.url}`), ['modulepreload /worlds/assets/main-A.js']);
  // t4-phone3: the socket opens once the entry has downloaded (its join after the entry on the link)
  (held.added[4].el.onload as () => void)();
  assert.deepEqual(held.added.slice(5).map((a) => `${a.tag} ${a.url}`), ['socket ']);
  held.timers.forEach((f) => f()); call();
  assert.deepEqual(held.added.slice(6).map((a) => `${a.tag} ${a.url}`), ['entry /worlds/assets/main-A.js']);
  // t4-phone3: phase two's entry downloads once its other downloads are in and the arrival gate (nearest models) is clear
  const auto = runLoader(js, true), go = auto.win[PHASE2_GLOBAL] as (h?: true | string) => void; go(true);
  let pending = true; const subs: (() => void)[] = [];
  auto.win.__arrivalGate = { pending: () => pending, subscribe: (f: () => void) => { subs.push(f); return () => { subs.length = 0; }; } };
  (auto.added[2].el.onload as () => void)();
  assert.equal(auto.added.length, 4, 'one of two preloads in: nothing more');
  (auto.added[3].el.onerror as () => void)();
  assert.equal(auto.added.length, 4, 'all in, near models still coming: nothing more');
  pending = false; subs.forEach((f) => f());
  assert.deepEqual(auto.added.slice(4).map((a) => `${a.tag} ${a.url}`), ['modulepreload /worlds/assets/main-A.js'], 'gate clear: the entry downloads');
  go(PHASE2_FILL); go();
  assert.deepEqual(auto.added.slice(5).map((a) => `${a.tag} ${a.url}`), ['entry /worlds/assets/main-A.js'], 'the run waits for the download; still no socket');
  (auto.added[5].el.onload as () => void)(); (auto.added[4].el.onload as () => void)();
  assert.deepEqual(auto.added.slice(6).map((a) => `${a.tag} ${a.url}`), ['socket '], 'the socket once');
  // the early entry failing to load starts phase two
  const fail = runLoader(js, true); (fail.added[1].el.onerror as () => void)();
  assert.equal(fail.added.filter((a) => a.tag === 'entry').length, 2);
  assert.throws(() => rewritePhasedHtml(HTML.replace('main-A', 'other-A'), 'assets/main-A.js', 'assets/early-E.js', []), /expected one module script/);
  assert.match(phasedLoaderScript({ entry: 'e', preloads: [] }, { entry: 'm', preloads: [] }), new RegExp(`setTimeout\\(two,${PHASE2_FALLBACK_MS}\\)`));
});

test('PF2: a late snapshot no longer holds the socket: it opens by itself within 2.5 s, phase two by 8 s', () => {
  const added: string[] = [], timers: { f: () => void; ms: number }[] = [];
  const win: Record<string, unknown> = { __soulsPhased: true, __soulsOpenSocket: () => { added.push('socket'); } };
  const document = { createElement: (tag: string) => ({ tag }), head: { appendChild: (el: Record<string, unknown>) => { added.push(`${el.type === 'module' ? 'entry' : el.rel} ${el.src ?? el.href}`); } } };
  const entries: Record<string, unknown>[] = [];
  const doc2 = { ...document, head: { appendChild: (el: Record<string, unknown>) => { if (el.src === '/e.js') entries.push(el); document.head.appendChild(el); } } };
  vm.runInNewContext(phasedLoaderScript({ entry: '/e.js', preloads: [] }, { entry: '/m.js', preloads: ['/r.js'] }), { window: win, document: doc2, setTimeout: (f: () => void, ms: number) => { timers.push({ f, ms }); } });
  const until = (ms: number) => { const due = timers.filter((t) => t.ms <= ms); timers.splice(0, timers.length, ...timers.filter((t) => t.ms > ms)); due.forEach((t) => t.f()); };
  // the snapshot never reports in (__soulsPhase2 is not called): live answers in ~0.3-0.6 s, a stalled one held it 15 s
  assert.ok(SOCKET_FALLBACK_MS <= 2_500 && PHASE2_FALLBACK_MS <= 8_000);
  until(2_500);
  assert.deepEqual(added, ['entry /e.js'], 't4-phone3: the 2.5 s count from the early entry\'s load (a phone\'s link was still bringing phase one)');
  (entries[0].onload as () => void)();
  until(2_500);
  assert.deepEqual(added, ['entry /e.js', 'socket'], 'the socket alone, phase two\'s downloads and entry still wait');
  until(8_000);
  assert.deepEqual(added, ['entry /e.js', 'socket', 'modulepreload /r.js', 'entry /m.js'], 'phase two by the fallback, the socket once');
  (win[PHASE2_GLOBAL] as () => void)();
  assert.equal(added.length, 4, 'the snapshot coming later changes nothing');
});

test('t4-phone: once the snapshot has answered, the socket waits for the fill (or phase two), not for 2.5 s', async () => {
  const added: string[] = [], timers: { f: () => void; ms: number }[] = [];
  const win: Record<string, unknown> = { __soulsPhased: true, __soulsOpenSocket: () => { added.push('socket'); }, __soulsSnapshotPrefetch: { response: Promise.resolve({}) } };
  const els: Record<string, unknown>[] = [];
  const document = { createElement: (tag: string) => ({ tag }), head: { appendChild: (el: Record<string, unknown>) => { els.push(el); added.push(`${el.type === 'module' ? 'entry' : el.rel} ${el.src ?? el.href}`); } } };
  vm.runInNewContext(phasedLoaderScript({ entry: '/e.js', preloads: [] }, { entry: '/m.js', preloads: ['/r.js'] }), { window: win, document, setTimeout: (f: () => void, ms: number) => { timers.push({ f, ms }); } });
  await new Promise((r) => setImmediate(r));   // the snapshot's answer
  timers.filter((t) => t.ms <= SOCKET_FALLBACK_MS).forEach((t) => t.f());
  assert.deepEqual(added, ['entry /e.js'], 'no socket at the 2.5 s fallback: its join would share the poster\'s link');
  const call = win[PHASE2_GLOBAL] as (h?: true | string) => void;
  call(true); assert.deepEqual(added.slice(1), ['modulepreload /r.js'], 'held: downloads only');
  call(PHASE2_FILL); assert.deepEqual(added.slice(2), ['modulepreload /m.js'], 'fill: the entry downloads');
  (els[2].onload as () => void)(); assert.deepEqual(added.slice(3), ['socket'], 't4-phone3: the socket opens once it is in');
  timers.filter((t) => t.ms === PHASE2_FALLBACK_MS).forEach((t) => t.f());
  assert.deepEqual(added.slice(4), ['entry /m.js'], 'the entry runs (once), the socket stays one');
  // without the fill (the early renderer gave up or never came), phase two's plain call opens it
  const a2: string[] = [], t2: { f: () => void; ms: number }[] = [];
  const w2: Record<string, unknown> = { __soulsPhased: true, __soulsOpenSocket: () => { a2.push('socket'); }, __soulsSnapshotPrefetch: { response: Promise.resolve({}) } };
  vm.runInNewContext(phasedLoaderScript({ entry: '/e.js', preloads: [] }, { entry: '/m.js', preloads: [] }), { window: w2, document: { createElement: (tag: string) => ({ tag }), head: { appendChild: (el: Record<string, unknown>) => { a2.push(`${el.type === 'module' ? 'entry' : el.rel} ${el.src ?? el.href}`); } } }, setTimeout: (f: () => void, ms: number) => { t2.push({ f, ms }); } });
  await new Promise((r) => setImmediate(r));
  (w2[PHASE2_GLOBAL] as (h?: true) => void)(true); (w2[PHASE2_GLOBAL] as () => void)();
  // t4-phone3: no other downloads and no arrival gate, so the entry downloads at the held call; the socket waits for it
  assert.deepEqual(a2, ['entry /e.js', 'modulepreload /m.js', 'entry /m.js']);
});

test('phasedEntryWanted = the early layer\'s gate (lever D on the page\'s tier) for a new world', () => {
  const searches = ['', '?early=0', '?early=1', '?quality=phone', '?quality=full', '?shot', '?shot&early=1', '?earlyLayer=0', '?phased=0', '?quality=phone&early=0'];
  for (const search of searches) for (const coarse of [false, true]) for (const screen of [[390, 844], [820, 1180], [1440, 900], [0, 0]] as const) for (const mem of [undefined, 2, 8]) {
    const tier = pickQualityTier({ search, coarsePointer: coarse, screen, deviceMemory: mem }).tier, q = new URLSearchParams(search);
    const want = q.get('earlyLayer') !== '0' && q.get('phased') !== '0' && earlyArrivalWanted(tier, true, search, q.has('shot'));
    assert.equal(phasedEntryWanted(search, coarse, screen[0], screen[1], mem), want, `${search} ${coarse} ${screen} ${mem}`);
  }
});
