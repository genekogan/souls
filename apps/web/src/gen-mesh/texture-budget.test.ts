import test, { type TestContext } from 'node:test'; import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { captureTexturePreparation, compileModel, compileObject, compileSceneAsync, setTextureRenderer, uploadTextures, waitForPrograms, warmReadyProgramMetadata, warmSceneChange } from './texture-budget.ts';
// production 2026-10-11: three's compileAsync threw "Cannot read properties of undefined (reading 'isReady')" in its own
// timer when LiveWorld re-mounted mid-compile (old renderer disposed: its material properties have no currentProgram)
test('a material without a program (disposed renderer) resolves, never throws', async () => {
  const r = { properties: { get: () => ({}) } };
  await waitForPrograms(r, new Set([{}, {}]), () => true, 1000);
});
test('waits for programs to be ready, then resolves', async () => {
  let ready = false; const r = { properties: { get: () => ({ currentProgram: { isReady: () => ready } }) } };
  let done = false; const p = waitForPrograms(r, new Set([{}]), () => true, 5000).then(() => { done = true; });
  await new Promise((res) => setTimeout(res, 50)); assert.equal(done, false);
  ready = true; await p; assert.equal(done, true);
});
test('stops when the renderer is replaced, when it throws, or at the timeout', async () => {
  let current = true; const never = { properties: { get: () => ({ currentProgram: { isReady: () => false } }) } };
  const a = waitForPrograms(never, new Set([{}]), () => current, 10_000); current = false; await a;
  await waitForPrograms({ properties: { get: () => { throw new Error('disposed'); } } }, new Set([{}]), () => true, 10_000);
  const t0 = Date.now(); await waitForPrograms(never, new Set([{}]), () => true, 100); assert.ok(Date.now() - t0 < 1000);
});

// 3.32/3.33 phones: a material disposed while the whole scene compiles (LiveWorld, the initial gate, Eyes, the expansion)
test('compileSceneAsync: a material disposed mid-compile, or a compile that throws, still resolves', async () => {
  let ready = false; const m1 = {}, m2 = {};
  const props = new Map<object, unknown>([[m1, { currentProgram: { isReady: () => ready } }], [m2, { currentProgram: { isReady: () => false } }]]);
  const r = { compile: () => new Set([m1, m2]), properties: { get: (m: object) => props.get(m) ?? {} } };
  let done = false; const p = compileSceneAsync(r as never, {} as never, {} as never, 5000).then(() => { done = true; });
  await new Promise((res) => setTimeout(res, 40)); assert.equal(done, false);
  props.delete(m2); ready = true; await p;   // m2 disposed: no program to wait for
  await compileSceneAsync({ compile: () => { throw Error('lost context'); }, properties: { get: () => ({}) } } as never, {} as never, {} as never);
});

// B2: the shared bolt light's programs are linked before the light is in a drawn frame
test('warmSceneChange: compiles with the change in, takes it out before returning, resolves once linked', async () => {
  assert.equal(await warmSceneChange(() => {}, () => {}), false);   // no renderer handed over: nothing compiled
  const log: string[] = []; let ready = false; const m = {};
  const r = { compile: () => { log.push('compile'); return new Set([m]); }, properties: { get: () => ({ currentProgram: { isReady: () => ready } }) } };
  setTextureRenderer(r as never, {} as never, {} as never);
  let done: boolean | null = null; const p = warmSceneChange(() => log.push('add'), () => log.push('remove')).then((v) => { done = v; });
  assert.deepEqual(log, ['add', 'compile', 'remove']);
  await new Promise((res) => setTimeout(res, 40)); assert.equal(done, null);
  ready = true; await p; assert.equal(done, true);
  const r2 = { compile: () => { throw Error('lost context'); }, properties: { get: () => ({}) } }; log.length = 0;
  setTextureRenderer(r2 as never, {} as never, {} as never);
  assert.equal(await warmSceneChange(() => log.push('add'), () => log.push('remove')), false); assert.deepEqual(log, ['add', 'remove']);
  setTextureRenderer(null);
});

function frames(t: TestContext) {
  const pending = new Map<number, FrameRequestCallback>(); let next = 0;
  const raf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'), caf = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  globalThis.requestAnimationFrame = fn => { pending.set(++next, fn); return next; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  t.after(() => {
    setTextureRenderer(null);
    if (raf) Object.defineProperty(globalThis, 'requestAnimationFrame', raf); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    if (caf) Object.defineProperty(globalThis, 'cancelAnimationFrame', caf); else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  });
  return { pending, flush() { const callbacks = [...pending.values()]; pending.clear(); for (const fn of callbacks) fn(performance.now()); } };
}
function model() {
  const scene = new THREE.Group(), texture = new THREE.Texture({ width: 1024, height: 1024 });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture, normalMap: texture })));
  return { scene } as GLTF;
}
function renderer(log: string[], name: string) {
  return { initTexture: () => { log.push(name + ':upload'); }, compile: () => { log.push(name + ':compile'); return new Set([{}]); }, properties: { get: () => ({ currentProgram: { isReady: () => true } }) } } as unknown as THREE.WebGLRenderer;
}

test('leaving settles queued uploads, cancels their frame and releases scene references', async t => {
  const raf = frames(t), log: string[] = [], release = setTextureRenderer(renderer(log, 'A'), new THREE.Scene(), new THREE.Camera());
  const owner = captureTexturePreparation()!;
  let settled = 0; const a = uploadTextures(model()).then(() => { settled++; }), b = uploadTextures(model()).then(() => { settled++; });
  assert.equal(raf.pending.size, 1);
  const stale = [...raf.pending.values()][0];
  release(); release(); await Promise.all([a, b]);
  assert.equal(settled, 2); assert.equal(raf.pending.size, 0);
  assert.equal(captureTexturePreparation(), null);
  assert.deepEqual([owner.renderer, owner.scene, owner.camera], [null, null, null]);
  stale(0); assert.deepEqual(log, []);
});

test('replacement and an older release preserve only the new mount, including the same renderer', async t => {
  const raf = frames(t), log: string[] = [], r = renderer(log, 'shared');
  const releaseA = setTextureRenderer(r), ownerA = captureTexturePreparation(), a = uploadTextures(model());
  const releaseB = setTextureRenderer(r), ownerB = captureTexturePreparation(), b = uploadTextures(model());
  assert.notEqual(ownerA, ownerB);
  releaseA(); releaseA(); await a;
  assert.equal(captureTexturePreparation(), ownerB); assert.equal(raf.pending.size, 1);
  raf.flush(); await b; assert.deepEqual(log, ['shared:upload']);
  releaseB(); assert.equal(captureTexturePreparation(), null);
});

test('late preparation keeps its original lifetime and does not upload or compile in the next view', async t => {
  const raf = frames(t), log: string[] = [];
  const release = setTextureRenderer(renderer(log, 'A'), new THREE.Scene(), new THREE.Camera()), old = captureTexturePreparation();
  release(); setTextureRenderer(renderer(log, 'B'), new THREE.Scene(), new THREE.Camera());
  await compileModel(model(), old); await uploadTextures(model(), old);
  assert.deepEqual(log, []); assert.equal(raf.pending.size, 0);
  await compileModel(model()); const b = uploadTextures(model()); raf.flush(); await b;
  assert.deepEqual(log, ['B:compile', 'B:upload']);
});

test('release immediately stops program polling and a canceled scene warmup reports false', async t => {
  frames(t); let reads = 0;
  const r = { compile: () => new Set([{}]), properties: { get: () => { reads++; return { currentProgram: { isReady: () => false } }; } } } as unknown as THREE.WebGLRenderer;
  const release = setTextureRenderer(r, new THREE.Scene(), new THREE.Camera());
  const compiling = compileObject(model().scene), log: string[] = [];
  const warming = warmSceneChange(() => log.push('add'), () => log.push('remove'));
  const before = reads; release();
  await compiling; assert.equal(await warming, false); assert.deepEqual(log, ['add', 'remove']);
  await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(reads, before);
});

test('empty uploads and renderer upload failures settle without stranding later work', async t => {
  const raf = frames(t), log: string[] = [], r = renderer(log, 'A');
  r.initTexture = () => { throw Error('context lost'); }; setTextureRenderer(r);
  await uploadTextures({ scene: new THREE.Group() } as GLTF);
  assert.equal(raf.pending.size, 0);
  const a = uploadTextures(model()); raf.flush(); await a;
  setTextureRenderer(null); await uploadTextures(model()); assert.equal(raf.pending.size, 0);
});

test('replacement inside a texture upload keeps the next mount on its own single cancellable frame', async t => {
  const raf = frames(t), log: string[] = [], a = renderer(log, 'A');
  let b!: Promise<void>, releaseB!: () => void;
  a.initTexture = () => {
    log.push('A:upload'); releaseB = setTextureRenderer(renderer(log, 'B'));
    b = uploadTextures(model());
  };
  setTextureRenderer(a); const first = uploadTextures(model());
  raf.flush(); await first;
  assert.deepEqual(log, ['A:upload']); assert.equal(raf.pending.size, 1);
  releaseB(); await b; assert.equal(raf.pending.size, 0);
});

test('release inside a program lookup stops the current poll before further renderer reads', async t => {
  frames(t); let reads = 0, readyCalls = 0, release!: () => void;
  const r = { compile: () => new Set([{}, {}]), properties: { get: () => { reads++; release(); return { currentProgram: { isReady: () => { readyCalls++; return false; } } }; } } } as unknown as THREE.WebGLRenderer;
  release = setTextureRenderer(r, new THREE.Scene(), new THREE.Camera());
  await warmSceneChange(() => {}, () => {});
  assert.equal(reads, 1); assert.equal(readyCalls, 0);
  await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(reads, 1);
});

test('replacement during texture traversal cannot enqueue a dead owner ahead of the new view', async t => {
  const raf = frames(t), log: string[] = []; setTextureRenderer(renderer(log, 'A'));
  const g = model(); let b!: Promise<void>;
  Object.defineProperty((g.scene.children[0] as THREE.Mesh).material, 'callbackTexture', { enumerable: true, get() {
    setTextureRenderer(renderer(log, 'B')); b = uploadTextures(model()); return new THREE.Texture();
  } });
  await uploadTextures(g); assert.equal(raf.pending.size, 1);
  raf.flush(); await b; assert.deepEqual(log, ['B:upload']); assert.equal(raf.pending.size, 0);
});

test('a scene change that releases its view is removed without compiling the disposed renderer', async t => {
  frames(t); const log: string[] = [], release = setTextureRenderer(renderer(log, 'A'), new THREE.Scene(), new THREE.Camera());
  const warmed = await warmSceneChange(() => { log.push('add'); release(); }, () => log.push('remove'));
  assert.equal(warmed, false); assert.deepEqual(log, ['add', 'remove']);
});

function metadataTasks(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
  const pending: (() => void)[] = [], closed: boolean[][] = [];
  let task = 0;
  class Channel {
    port1: { onmessage: (() => void) | null; close: () => void };
    port2: { postMessage: () => void; close: () => void };
    constructor() {
      const state = [false, false]; closed.push(state);
      this.port1 = { onmessage: null, close: () => { state[0] = true; } };
      this.port2 = { close: () => { state[1] = true; }, postMessage: () => pending.push(() => {
        if (!state.some(Boolean)) this.port1.onmessage?.();
      }) };
    }
  }
  Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, writable: true, value: Channel });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'MessageChannel', descriptor); else Reflect.deleteProperty(globalThis, 'MessageChannel');
  });
  return { pending, closed, get task() { return task; }, async flush() {
    const next = pending.shift(); assert.ok(next, 'one real task must be queued'); task++; next(); await Promise.resolve();
  } };
}
function metadataRenderer(programs: object[], parallel = true) {
  return { extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' && parallel }, info: { programs } } as unknown as THREE.WebGLRenderer;
}

test('metadata: one distinct ready program per task, no attribute second pass or unready/missing readiness', async t => {
  const tasks = metadataTasks(t), log: number[] = [];
  const ready = () => ({ program: {}, isReady: () => true, getUniforms: () => log.push(tasks.task), getAttributes: () => assert.fail('uniforms already builds both caches') });
  const a = ready(), b = ready(), unready = { ...ready(), isReady: () => false };
  const missing = { program: {}, getUniforms: () => assert.fail('missing readiness is not ready') };
  const r = metadataRenderer([a, a, unready, missing, b]);
  const work = warmReadyProgramMetadata(r, () => true);
  assert.deepEqual(log, []); assert.equal(tasks.pending.length, 1);
  await tasks.flush(); assert.deepEqual(log, [1]);
  await tasks.flush(); await tasks.flush(); assert.deepEqual(log, [1]);
  // A late program is left for the next preparation/draw, not an unbounded arrival queue.
  r.info.programs!.push(ready() as never);
  await tasks.flush(); await work; assert.deepEqual(log, [1, 4]);
  assert.ok(tasks.closed.every(ports => ports.every(Boolean)));
});

test('metadata: lack of KHR cannot turn an unconditional isReady into a synchronous native link', async t => {
  const tasks = metadataTasks(t), r = metadataRenderer([], false);
  Object.defineProperty(r.info, 'programs', { get: () => assert.fail('must not inspect or force programs without KHR') });
  await warmReadyProgramMetadata(r, () => true);
  assert.equal(tasks.pending.length, 0);
});

test('metadata: removed/destroyed programs and readiness-time disposal are skipped, local failures do not strand peers', async t => {
  const tasks = metadataTasks(t), calls: string[] = [];
  const p = (name: string) => ({ program: {} as object | undefined, isReady: () => true, getUniforms: () => calls.push(name) });
  const removed = p('removed'), destroyed = p('destroyed'), during = p('during'), failed = p('failed'), good = p('good');
  const r = metadataRenderer([removed, destroyed, during, failed, good]);
  during.isReady = () => { during.program = undefined; return true; };
  failed.getUniforms = () => { throw Error('context lost for this program'); };
  const work = warmReadyProgramMetadata(r, () => true);
  r.info.programs!.splice(0, 1); destroyed.program = undefined;
  for (let i = 0; i < 5; i++) await tasks.flush();
  await work; assert.deepEqual(calls, ['good']);
  assert.ok(tasks.closed.every(ports => ports.every(Boolean)));
});

test('metadata: pre-abort performs no renderer reads; aborting a pending task closes ports and settles without dispatch', async t => {
  const tasks = metadataTasks(t), abort = new AbortController(); abort.abort();
  const unreadable = new Proxy({}, { get: () => assert.fail('aborted renderer must not be read') });
  await warmReadyProgramMetadata(unreadable as never, () => true, abort.signal);
  const pendingAbort = new AbortController(); let calls = 0;
  const work = warmReadyProgramMetadata(metadataRenderer([{ program: {}, isReady: () => true, getUniforms: () => calls++ }]), () => true, pendingAbort.signal);
  assert.equal(tasks.pending.length, 1); pendingAbort.abort(); await work;
  assert.equal(calls, 0); assert.ok(tasks.closed.every(ports => ports.every(Boolean)));
  await tasks.flush(); assert.equal(calls, 0);
});

test('metadata: release/replacement inside readiness or metadata stops before any later renderer/program read', async t => {
  const tasks = metadataTasks(t); frames(t);
  for (const phase of ['ready', 'metadata']) {
    let calls = 0, readyCalls = 0;
    const programs = [0, 1].map(() => ({ program: {}, isReady: () => { readyCalls++; return true; }, getUniforms: () => { calls++; } }));
    const r = metadataRenderer(programs), release = setTextureRenderer(r), owner = captureTexturePreparation()!;
    const replace = () => {
      // A new mount on the same renderer must invalidate the old token as well.
      setTextureRenderer(r);
      Object.defineProperty(r, 'info', { get: () => assert.fail('released renderer must not be read again'), configurable: true });
    };
    if (phase === 'ready') programs[0].isReady = () => { readyCalls++; replace(); return true; };
    else programs[0].getUniforms = () => { calls++; replace(); };
    const work = warmReadyProgramMetadata(r, () => captureTexturePreparation() === owner, owner.abort.signal);
    await tasks.flush(); await work; release();
    assert.equal(readyCalls, 1); assert.equal(calls, phase === 'ready' ? 0 : 1);
    assert.equal(tasks.pending.length, 0);
  }
});

test('compileSceneAsync: abort skips compilation or stops a pending timeout poll without more property reads', async () => {
  let compiles = 0, reads = 0;
  const r = { compile: () => { compiles++; return new Set([{}]); }, properties: { get: () => { reads++; return { currentProgram: { isReady: () => false } }; } } };
  const already = new AbortController(); already.abort();
  await compileSceneAsync(r as never, {} as never, {} as never, 10_000, already.signal);
  assert.equal(compiles, 0); assert.equal(reads, 0);
  const abort = new AbortController(), work = compileSceneAsync(r as never, {} as never, {} as never, 10_000, abort.signal);
  assert.equal(reads, 1); abort.abort(); await work;
  await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(compiles, 1); assert.equal(reads, 1);
});

test('metadata: a compile timeout leaves unready links untouched while other ready programs can warm', async t => {
  const tasks = metadataTasks(t), calls: string[] = [];
  const unready = { program: {}, isReady: () => false, getUniforms: () => assert.fail('timeout must not force a link') };
  const ready = { program: {}, isReady: () => true, getUniforms: () => calls.push('ready') };
  const r = Object.assign(metadataRenderer([unready, ready]), { compile: () => new Set([{}]), properties: { get: () => ({ currentProgram: unready }) } });
  await compileSceneAsync(r as never, {} as never, {} as never, 1);
  const work = warmReadyProgramMetadata(r, () => true);
  await tasks.flush(); await tasks.flush(); await work; assert.deepEqual(calls, ['ready']);
});

test('metadata: real MessageChannel tasks let a queued cancellation stop work between programs', async () => {
  const abort = new AbortController(), calls: string[] = [];
  const a = { program: {}, isReady: () => true, getUniforms: () => { calls.push('first'); queueMicrotask(() => abort.abort()); } };
  const b = { program: {}, isReady: () => true, getUniforms: () => calls.push('second') };
  await warmReadyProgramMetadata(metadataRenderer([a, b]), () => true, abort.signal);
  assert.deepEqual(calls, ['first']);
});

test('metadata: constructor/post failures use timer tasks, close partial ports and remove abort listeners', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'MessageChannel', descriptor); else Reflect.deleteProperty(globalThis, 'MessageChannel'); });
  for (const phase of ['constructor', 'post']) {
    const abort = new AbortController(), closed: string[] = [], calls: number[] = [];
    const listeners = () => getEventListeners(abort.signal, 'abort').length;
    class FailedChannel {
      port1 = { close: () => closed.push('port1'), onmessage: null };
      port2 = { close: () => closed.push('port2'), postMessage: () => { throw Error('post failed'); } };
      constructor() { if (phase === 'constructor') throw Error('constructor failed'); }
    }
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, writable: true, value: FailedChannel });
    const p = () => ({ program: {}, isReady: () => true, getUniforms: () => calls.push(listeners()) });
    const work = warmReadyProgramMetadata(metadataRenderer([p(), p()]), () => true, abort.signal);
    // Even the fallback must yield a real task, not collapse multiple programs into this microtask checkpoint.
    await Promise.resolve(); assert.deepEqual(calls, []); assert.equal(listeners(), 1);
    await work; assert.deepEqual(calls, [0, 0]); assert.equal(listeners(), 0);
    assert.deepEqual(closed, phase === 'post' ? ['port1', 'port2', 'port1', 'port2'] : []);
    abort.abort(); assert.deepEqual(calls, [0, 0]);
  }
});
