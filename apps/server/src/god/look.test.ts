import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { LOOK_LIMITS, LookQueue, drawableEntities, lookSchema, mountLookRoutes, type LookRenderer } from './look.ts';
import { PipeCDP, renderLook, pngSize, sweepLookProfiles } from './look-renderer.ts';
import { readyExpression, captureExpression } from './look-page.ts';

// These renderer tests use real lock acquisition even when Chrome is stubbed.
// Keep their slot isolated from live worlds and explicit on Linux.
let renderLockDir: string, previousRenderLockDir: string | undefined;
before(() => {
  previousRenderLockDir = process.env.SIM_RENDER_LOCK_DIR;
  renderLockDir = mkdtempSync(join(tmpdir(), 'souls-look-test-lock-'));
  process.env.SIM_RENDER_LOCK_DIR = renderLockDir;
});
after(() => {
  if (previousRenderLockDir === undefined) delete process.env.SIM_RENDER_LOCK_DIR;
  else process.env.SIM_RENDER_LOCK_DIR = previousRenderLockDir;
  rmSync(renderLockDir, { recursive: true, force: true });
});

const shot = { eye: [0, 10, 20], at: [0, 0, 0] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
function fixture(t: { after(fn: () => void): void }, renderer?: LookRenderer) {
  const db = new Db(':memory:'); t.after(() => db.close());
  const opts = { worldId: 'looks', ownerId: 'dev:owner', tick: () => 0, emit: () => {} };
  const god = new GodMode(db, opts), other = new GodMode(db, { ...opts, worldId: 'other' });
  const mint = (g: GodMode, label: string) => g.mintFor({ id: 'dev:owner', role: 'user' }, label);
  const a = mint(god, 'a'), b = mint(god, 'b'), wrong = mint(other, 'wrong');
  const app = new Hono(), renders: unknown[] = [];
  const requireGod = (c: Context) => { if (!god.godIdentity(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))) throw new ApiError(401, 'unauthorized', 'god token required'); };
  mountLookRoutes(app, { requireGod, worldUrl: 'http://127.0.0.1:5368/w/looks', entities: () => god.model.entities.size, renderer: renderer ?? (async (...args) => { renders.push(args.slice(0, 3)); return png; }) });
  app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code, message: e.message, ...e.extra }, e.status as 400) : c.json({ message: String(e) }, 500));
  const request = (token?: string, body: unknown = shot, raw?: string) => app.request('/v1/god/look', { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', 'x-forwarded-host': 'attacker.invalid' }, body: raw ?? JSON.stringify(body) });
  return { god, a, b, wrong, request, renders };
}

test('look authenticates scoped tokens before parsing; per-token 20/min limits precede render', async t => {
  const f = fixture(t);
  for (const token of [undefined, 'invalid', f.wrong]) assert.equal((await f.request(token, {}, '{')).status, 401);
  for (let i = 0; i < LOOK_LIMITS.perMinute; i++) {
    const response = await f.request(f.a);
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  }
  const limited = await f.request(f.a);
  assert.equal(limited.status, 429); const data = await limited.json() as { code: string; retry_after: number };
  assert.equal(data.code, 'rate-limited'); assert.ok(data.retry_after > 0);
  assert.equal((await f.request(f.b)).status, 200); assert.equal(f.renders.length, 21);
  assert.equal(f.god.model.editSeq, 0, 'a look never edits the world');
  assert.equal((f.renders[0] as unknown[])[0], 'http://127.0.0.1:5368/w/looks', 'forwarded host cannot control renderer URL');
});

test('look rejects malformed/oversized/untrusted parameters and counts invalid requests', async t => {
  const f = fixture(t);
  const invalid = [null, {}, { ...shot, eye: [0, 1] }, { ...shot, at: [0, 10, 20] },
    { ...shot, width: 1601 }, { ...shot, height: 1001 }, { ...shot, width: 0 }, { ...shot, width: 1.5 },
    { ...shot, span: -1 }, { ...shot, hour: '24:00' }, { ...shot, weather: '../other' }, { ...shot, cut: '2' },
    { ...shot, hideRoofs: 1 }, { ...shot, worldUrl: 'https://attacker.invalid' }, { ...shot, expect: 0 },
  ];
  for (const body of invalid) {
    const r = await f.request(f.a, body); assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((await r.json() as { code: string }).code, 'look.invalid');
  }
  assert.equal((await f.request(f.a, {}, '{')).status, 400);
  assert.equal(f.renders.length, 0);
  for (let i = invalid.length + 1; i < LOOK_LIMITS.perMinute; i++) await f.request(f.a, {});
  assert.equal((await f.request(f.a)).status, 429);
  assert.equal(lookSchema.safeParse({ ...shot, span: Infinity }).success, false);
  assert.equal(lookSchema.safeParse({ ...shot, eye: [NaN, 1, 2] }).success, false);
});

test('look passes all supported camera/preview settings and server entity count to renderer', async t => {
  const f = fixture(t), settings = { ...shot, hideRoofs: true, cut: 2, span: 20, hour: '21:30', weather: 'rain', width: 1600, height: 1000 };
  assert.equal((await f.request(f.a, settings)).status, 200);
  assert.deepEqual(f.renders[0], ['http://127.0.0.1:5368/w/looks', settings, f.god.model.entities.size]);
});

test('look returns the actual PNG size even when it differs from the requested dimensions', async t => {
  const f = fixture(t);
  const response = await f.request(f.a, { ...shot, width: 1024, height: 640 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-look-size'), '1x1');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(pngSize(png), '1x1');
});

test('look still refuses malformed, truncated or zero-size PNGs', async t => {
  const zero = Buffer.from(png); zero.writeUInt32BE(0, 16);
  const wrongChunk = Buffer.from(png); wrongChunk.write('IDAT', 12);
  for (const invalid of [Buffer.from('not a PNG'), png.subarray(0, 24), zero, wrongChunk]) {
    const f = fixture(t, async () => invalid);
    const response = await f.request(f.a);
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { code: string }).code, 'look.failed');
    assert.equal(response.headers.get('x-look-size'), null);
  }
});

test('look propagates actionable host unavailability and is mounted behind normal god auth', async t => {
  const f = fixture(t, async () => { throw new ApiError(503, 'look.unavailable', 'Install Google Chrome on the world host'); });
  const r = await f.request(f.a); assert.equal(r.status, 503); assert.match((await r.json() as { message: string }).message, /Install Google Chrome/);
  const app = new Hono();
  mountGodRoutes(app, { god: f.god, worldName: 'Looks', requireUser: async () => { throw new Error('unused'); }, soulFromBearer: () => null, baseOf: () => 'https://attacker.invalid', limitIp: () => {} });
  app.onError((e, c) => c.json({ code: (e as ApiError).code }, (e as ApiError).status as 400));
  assert.equal((await app.request('/v1/god/look', { method: 'POST', body: JSON.stringify(shot) })).status, 401);
  const unconfigured = await app.request('/v1/god/look', { method: 'POST', headers: { authorization: `Bearer ${f.a}` }, body: JSON.stringify(shot) });
  assert.equal(unconfigured.status, 503); assert.equal((await unconfigured.json() as { code: string }).code, 'look.unavailable');
});

test('look queue serializes across tokens, bounds waiting work and recovers after render failure', async () => {
  const queue = new LookQueue(1000, 1), started: number[] = [], gate = deferred();
  let active = 0, high = 0;
  const run = (n: number) => queue.run(async () => { started.push(n); high = Math.max(high, ++active); try { if (n === 1) { await gate.promise; throw new Error('failed first'); } return png; } finally { active--; } });
  const first = assert.rejects(run(1), /failed first/), second = run(2);
  await assert.rejects(run(3), (e: ApiError) => e.code === 'look.busy' && e.status === 429);
  assert.deepEqual(started, [1]); gate.resolve(); await first; assert.deepEqual(await second, png);
  assert.deepEqual(started, [1, 2]); assert.equal(high, 1);
  assert.deepEqual(await run(4), png);
});

test('active timeout aborts renderer but retains serial slot until disposal; queued timeout never starts', async () => {
  const queue = new LookQueue(30, 2), disposed = deferred(); let aborted = false, queuedStarted = false;
  const first = queue.run(async signal => { await new Promise<void>(r => signal.addEventListener('abort', () => { aborted = true; r(); }, { once: true })); await disposed.promise; return png; });
  const second = queue.run(async () => { queuedStarted = true; return png; });
  await Promise.all([assert.rejects(first, (e: ApiError) => e.code === 'look.timeout'), assert.rejects(second, (e: ApiError) => e.code === 'look.timeout')]);
  assert.equal(aborted, true); assert.equal(queuedStarted, false);
  const third = queue.run(async () => png); disposed.resolve(); assert.deepEqual(await third, png);
});

test('disconnected queued requests are removed without rendering and release queue capacity', async () => {
  const queue = new LookQueue(1000, 1), gate = deferred(), ac = new AbortController(); let called = false;
  const first = queue.run(async () => { await gate.promise; return png; });
  const cancelled = queue.run(async () => { called = true; return png; }, ac.signal);
  ac.abort(); await assert.rejects(cancelled, (e: ApiError) => e.code === 'look.cancelled');
  await assert.rejects(queue.run(async () => png, ac.signal), (e: ApiError) => e.code === 'look.cancelled');
  const third = queue.run(async () => png); gate.resolve(); await first; await third; assert.equal(called, false);
});

test('CDP pipe correlates fragmented/coalesced replies, events and disconnect errors', async () => {
  const input = new PassThrough(), output = new PassThrough(), cdp = new PipeCDP(input, output), events: string[] = [];
  cdp.onEvent = method => events.push(method);
  const a = cdp.send('Browser.getVersion'), b = cdp.send('Page.enable', {}, 'page');
  const requests = input.read().toString().split('\0').filter(Boolean).map(JSON.parse);
  assert.equal(requests[1].sessionId, 'page');
  output.write('{"id":2,"result":{}'); output.write('}\0{"method":"Page.loaded","params":{}}\0{"id":1,"result":{"product":"Chrome"}}\0');
  assert.deepEqual(await b, {}); assert.deepEqual(await a, { product: 'Chrome' }); assert.deepEqual(events, ['Page.loaded']);
  const failed = cdp.send('missing'); output.write('{"id":3,"error":{"message":"unknown method"}}\0'); await assert.rejects(failed, /unknown method/);
  const pending = cdp.send('pending'); cdp.close(new Error('disconnected')); await assert.rejects(pending, /disconnected/); await assert.rejects(cdp.send('after'), /disconnected/);
});

test('renderer refuses external configuration or a host without Chrome before opening any page', async () => {
  const settings = lookSchema.parse(shot);
  for (const url of ['https://example.invalid', 'http://localhost:5368', 'http://127.0.0.1:5368?url=other']) await assert.rejects(renderLook(url, settings, 0, new AbortController().signal), (e: ApiError) => e.code === 'look.unavailable');
  const previous = process.env.GOD_LOOK_CHROME; process.env.GOD_LOOK_CHROME = '/does-not-exist/w2-chrome';
  try { await assert.rejects(renderLook('http://127.0.0.1:5368/w/looks', settings, 0, new AbortController().signal), (e: ApiError) => e.code === 'look.unavailable' && /No Google Chrome executable.*local browser.*Never change/.test(e.message)); }
  finally { if (previous === undefined) delete process.env.GOD_LOOK_CHROME; else process.env.GOD_LOOK_CHROME = previous; }
});

test('server page scripts require readiness/count/easing and preserve local span, roofs, clipping and camera checks', async () => {
  class Vector {
    values: number[] = [0, 0, 0];
    set(...values: number[]) { this.values = values; }
    toArray() { return this.values; }
  }
  const roof = { visible: true, name: 'roof' }, camera = { fov: 45, aspect: 1.6, near: 0.1, far: 10, position: new Vector(), lookAt() {}, updateProjectionMatrix() {} };
  let drift = false, captured = 0;
  const target = new Vector(), layer = { active: true, now: 4000, drawn: new Map([['house', { t0: 0, dur: 1 }]]) };
  const canvas = { width: 1024, height: 640, style: {}, children: [], parentElement: null, toDataURL: () => { captured++; return 'data:image/png;base64,' + png.toString('base64'); } };
  const context = vm.createContext({ window: { __shotReady: true, __simEntity: { camera, controls: { target, update() {} }, layer, scene: { fog: { near: 1, far: 10 }, traverse(fn: (o: unknown) => void) { fn(roof); } } } },
    document: { title: 'ready', querySelector: () => canvas, querySelectorAll: () => [canvas] }, performance: { now: () => 4000 },
    requestAnimationFrame: (fn: () => void) => fn(), setTimeout: (fn: () => void) => { if (drift) target.set(9, 9, 9); fn(); },
  });
  assert.equal(vm.runInContext(readyExpression(4), context).ready, false, 'server entity count guards early captures');
  layer.now = 500; assert.equal(vm.runInContext(readyExpression(1), context).ready, false, 'wait until easing finishes'); layer.now = 4000;
  assert.equal(vm.runInContext(readyExpression(1), context).ready, true);
  const settings = lookSchema.parse({ ...shot, span: 40, hideRoofs: true, cut: 1 });
  assert.match(await vm.runInContext(captureExpression(settings), context), /^data:image\/png/);
  const required = 20 / Math.tan(Math.PI / 8) * 1.05;
  assert.ok(Math.abs(Math.hypot(...camera.position.toArray()) - required) < 1e-8);
  assert.ok(Math.abs(camera.far - required * 3) < 1e-8); assert.equal(roof.visible, true, 'roof visibility restored after capture');
  drift = true; await assert.rejects(vm.runInContext(captureExpression(settings), context), /camera changed/); assert.equal(captured, 1);
  drift = false; await assert.rejects(vm.runInContext(captureExpression(lookSchema.parse({ eye: [0, 0, 0.05], at: [0, 0, 0] })), context), /near clipping/);
});

test('lookrace: the page pins the camera through the viewer, captures the pinned (ground-lifted, > 320 m) eye and never refuses while the viewer holds it', async () => {
  class Vector {
    values: number[] = [0, 0, 0];
    set(...values: number[]) { this.values = values; }
    toArray() { return [...this.values]; }
  }
  const camera = { fov: 45, aspect: 1.6, near: 0.1, far: 2400, position: new Vector(), lookAt() {}, updateProjectionMatrix() {} }, target = new Vector();
  // The live viewer's interactive camera rules (orbit max distance 320 m, never underground) as the render loop applies them
  // every frame; the pin (shotCamera) lifts once and is then re-applied after them, as LiveWorld does in ?shot=1 pages.
  const ground = 50; let pin: { eye: number[]; at: number[]; lifted: number } | null = null, calls = 0;
  const shotCamera = (eye: number[], at: number[]) => { calls++; const lifted = Math.max(0, ground + 1.2 - eye[1]); pin = { eye: [eye[0], eye[1] + lifted, eye[2]], at: [...at], lifted }; camera.position.set(...pin.eye); target.set(...pin.at); return pin; };
  const viewerFrame = () => {
    const p = camera.position.toArray(), t = target.toArray(), d = Math.hypot(...p.map((v, i) => v - t[i]));
    if (d > 320) camera.position.set(...p.map((v, i) => t[i] + (v - t[i]) * 320 / d));            // OrbitControls.maxDistance
    const q = camera.position.toArray(); if (q[1] < ground + 1.2) camera.position.set(q[0], ground + 1.2, q[2]); // camera ground clamp
    if (pin) { camera.position.set(...pin.eye); target.set(...pin.at); }                              // lookrace pin
  };
  const canvas = { width: 1024, height: 640, style: {}, children: [], parentElement: null, toDataURL: () => 'data:image/png;base64,' + png.toString('base64') };
  const context = vm.createContext({ window: { __shotReady: true, __simEntity: { camera, controls: { target, update: viewerFrame }, shotCamera, layer: { active: true }, scene: { fog: null, traverse() {} } } },
    document: { title: 'ready', querySelector: () => canvas, querySelectorAll: () => [canvas] }, performance: { now: () => 0 },
    requestAnimationFrame: (fn: () => void) => { viewerFrame(); fn(); }, setTimeout: (fn: () => void) => { for (let i = 0; i < 48; i++) viewerFrame(); fn(); },
  });
  for (const look of [{ eye: [0, 168.2, 457.2], at: [0, 0.4, 150] }, { eye: [167.8, 20, 150], at: [80, 67.6, 150] }, { eye: [-75.8, 80, 40], at: [-60, 60, 40] }, { eye: [204.5, 158.3, 334.5], at: [0, 0.3, 130] }]) {
    assert.match(await vm.runInContext(captureExpression(lookSchema.parse(look)), context), /^data:image\/png/, `no refusal for ${JSON.stringify(look)}`);
    assert.deepEqual(camera.position.toArray(), pin!.eye, 'the captured camera is the pinned one');
    if (look.eye[1] > ground + 1.2) assert.deepEqual(pin!.eye, look.eye, 'an eye above the ground is captured exactly as requested, even beyond 320 m');
    else assert.ok(pin!.lifted > 0 && camera.position.toArray()[1] === ground + 1.2, 'an underground eye is lifted once, then held');
  }
  assert.equal(calls, 4);
  // Without the pin (an older viewer) the same 457 m request is still caught and refused, never captured from the wrong camera.
  delete (context.window as { __simEntity: { shotCamera?: unknown } }).__simEntity.shotCamera; pin = null;
  await assert.rejects(vm.runInContext(captureExpression(lookSchema.parse({ eye: [0, 168.2, 457.2], at: [0, 0.4, 150] })), context), /camera changed/);
});

test('renderer drives the full CDP pipe lifecycle and disposes its owned process/profile with a stub host', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'w2-cdp-host-')), executable = join(dir, 'chrome'), transcript = join(dir, 'requests.jsonl');
  const previous = process.env.GOD_LOOK_CHROME;
  t.after(() => { if (previous === undefined) delete process.env.GOD_LOOK_CHROME; else process.env.GOD_LOOK_CHROME = previous; rmSync(dir, { recursive: true, force: true }); });
  // A real child and real fd 3/4 transport, with just the browser protocol stubbed.
  const source = `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(transcript)}, JSON.stringify({method: 'test.started', params: {pid: process.pid, profile: process.argv.find(a => a.startsWith('--user-data-dir=')).split('=').slice(1).join('=')}}) + '\\n');
let buffer = '', evaluations = 0;
const input = fs.createReadStream(null, {fd: 3});
input.on('data', b => { buffer += b; for (;;) {
  const end = buffer.indexOf('\\0'); if (end < 0) break;
  const m = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
  fs.appendFileSync(${JSON.stringify(transcript)}, JSON.stringify(m) + '\\n');
  if (m.method === 'Runtime.evaluate' && ++evaluations === 1) { fs.writeSync(4, JSON.stringify({id: m.id, error: {message: 'Execution context was destroyed'}}) + '\\0'); continue; }
  let result = {};
  if (m.method === 'Target.createTarget') result = {targetId: 'world'};
  if (m.method === 'Target.attachToTarget') result = {sessionId: 'world-page'};
  if (m.method === 'Runtime.evaluate') result = {result: {value: m.params.expression.startsWith('(async') ? ${JSON.stringify('data:image/png;base64,' + png.toString('base64'))} : {ready: true, drawn: 1}}};
  fs.writeSync(4, JSON.stringify({id: m.id, result}) + '\\0');
  if (m.method === 'Fetch.enable') for (const [requestId, url] of [['own', 'http://127.0.0.1:5368/asset'], ['foreign', 'https://example.invalid/asset']]) fs.writeSync(4, JSON.stringify({method: 'Fetch.requestPaused', sessionId: 'world-page', params: {requestId, request: {url}}}) + '\\0');
} });`;
  writeFileSync(executable, source, { mode: 0o700 }); process.env.GOD_LOOK_CHROME = executable;
  const settings = lookSchema.parse({ ...shot, width: 1024, height: 640, hideRoofs: true, cut: 2, span: 10, hour: '21:00', weather: 'rain' });
  const rendered = await renderLook('http://127.0.0.1:5368/w/looks', settings, 1, AbortSignal.timeout(30_000));
  assert.deepEqual(rendered, png, 'a valid 1x1 PNG is returned even when the renderer requested 1024x640');
  const messages = readFileSync(transcript, 'utf8').trim().split('\n').map(s => JSON.parse(s));
  const owned = messages.find(m => m.method === 'test.started').params;
  assert.equal(existsSync(owned.profile), false, 'temporary Chrome profile removed');
  assert.throws(() => process.kill(owned.pid, 0), { code: 'ESRCH' }, 'owned Chrome process has exited');
  assert.deepEqual(messages.find(m => m.method === 'Emulation.setDeviceMetricsOverride').params, { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
  const navigation = new URL(messages.find(m => m.method === 'Page.navigate').params.url);
  assert.equal(navigation.pathname, '/w/looks'); assert.equal(navigation.searchParams.get('eye'), '0,10,20');
  for (const [key, value] of Object.entries({ shot: '1', hour: '21:00', weather: 'rain', hideRoofs: '1', cut: '2' })) assert.equal(navigation.searchParams.get(key), value);
  assert.ok(messages.some(m => m.method === 'Page.addScriptToEvaluateOnNewDocument' && m.params.source.includes('preserveDrawingBuffer')));
  assert.ok(messages.some(m => m.method === 'Fetch.continueRequest' && m.params.requestId === 'own'));
  assert.ok(messages.some(m => m.method === 'Fetch.failRequest' && m.params.requestId === 'foreign'));
  assert.ok(messages.filter(m => m.method === 'Runtime.evaluate').length >= 4);
  // A stuck host still exits and loses its temporary profile at the request deadline.
  writeFileSync(executable, source.replace("input.on('data', b => {", "input.on('data', b => { return;"), { mode: 0o700 });
  const deadline = new AbortController();
  const stopped = assert.rejects(renderLook('http://127.0.0.1:5368/w/looks', settings, 1, AbortSignal.any([deadline.signal, AbortSignal.timeout(30_000)])), { name: 'TimeoutError' });
  // Wait for the child handshake before firing the deadline: a fixed 300 ms also measured Node startup under load.
  const until = Date.now() + 25_000; // a loaded host (load ~70) measured >4 s Node startup
  while (readFileSync(transcript, 'utf8').split('\n').filter(s => s.includes('test.started')).length < 2 && Date.now() < until) await new Promise(r => setTimeout(r, 10));
  deadline.abort(new DOMException('test render deadline', 'TimeoutError')); await stopped;
  const timedOut = JSON.parse(readFileSync(transcript, 'utf8').trim().split('\n').at(-1)!);
  assert.equal(timedOut.method, 'test.started');
  assert.equal(existsSync(timedOut.params.profile), false); assert.throws(() => process.kill(timedOut.params.pid, 0), { code: 'ESRCH' });
});

test('server normalizes every accepted hour format before rendering', async t => {
  const f = fixture(t);
  for (const [input, expected] of [['7', '07:00'], ['07', '07:00'], ['7:05', '07:05'], ['21:30', '21:30']]) {
    assert.equal((await f.request(f.a, { ...shot, hour: input })).status, 200);
    assert.equal((f.renders.at(-1) as any[])[1].hour, expected);
  }
});

test('a malformed CDP event rejects pending work without escaping the stream callback', async () => {
  const input = new PassThrough(), output = new PassThrough(), cdp = new PipeCDP(input, output);
  cdp.onEvent = () => { throw Error('malformed event URL'); };
  const rejected = assert.rejects(cdp.send('waiting'), /malformed event URL/);
  assert.doesNotThrow(() => output.write(JSON.stringify({ method: 'Fetch.requestPaused', params: {} }) + '\0'));
  await rejected; await assert.rejects(cdp.send('after'), /malformed event URL/);
});

test('failed Chrome startup distinguishes an existing executable and logs exit code/signal', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'h1-look-start-')), executable = join(dir, 'chrome');
  const previous = process.env.GOD_LOOK_CHROME, original = console.error, logs: string[] = [];
  console.error = (...args) => logs.push(args.join(' ')); process.env.GOD_LOOK_CHROME = executable;
  t.after(() => { console.error = original; if (previous === undefined) delete process.env.GOD_LOOK_CHROME; else process.env.GOD_LOOK_CHROME = previous; rmSync(dir, { recursive: true, force: true }); });
  for (const source of ['process.exit(23)', "process.kill(process.pid, 'SIGTERM')"]) {
    writeFileSync(executable, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
    await assert.rejects(renderLook('http://127.0.0.1:5368', lookSchema.parse(shot), 0, AbortSignal.timeout(30_000)), (e: ApiError) => e.code === 'look.unavailable' && /executable failed to start.*local browser.*Never change/.test(e.message));
  }
  assert.ok(logs.some(s => s.includes('code=23 signal=null')), logs.join('\n'));
  assert.ok(logs.some(s => s.includes('code=null signal=SIGTERM')), logs.join('\n'));
});

test('startup profile sweep reclaims dead owners and old legacy dirs, preserving live/recent/unrelated dirs', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'h1-profile-sweep-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dead = 'sim-god-look-2147483647-ABC123', live = `sim-god-look-${process.pid}-ABC123`, old = 'sim-god-look-Old123', recent = 'sim-god-look-New123', other = 'other-profile';
  for (const name of [dead, live, old, recent, other]) mkdirSync(join(dir, name));
  utimesSync(join(dir, old), new Date(0), new Date(0));
  await sweepLookProfiles(dir);
  assert.equal(existsSync(join(dir, dead)), false); assert.equal(existsSync(join(dir, old)), false);
  for (const name of [live, recent, other]) assert.equal(existsSync(join(dir, name)), true, name);
});

test('r2.1 remote looks expect only drawable entities: resident bodies and prefab containers are never in layer.drawn', () => {
  const defs: Record<string, { make: { kind: string }; components: { body?: unknown } }> = {
    body: { make: { kind: 'none' }, components: { body: { rig: 'humanoid' } } }, set: { make: { kind: 'parts' }, components: {} },
    lamp: { make: { kind: 'gen' }, components: {} }, chair: { make: { kind: 'mesh' }, components: {} } };
  const entities = new Map(['body', 'body', 'body', 'set', 'lamp', 'gone'].map((def, i) => [`e${i}`, { def }]));
  assert.equal(drawableEntities({ entities, resolvedDef: ref => defs[ref] }), 1, '3 bodies + 1 thing waits for the thing, not 60% of 6');
  entities.set('e9', { def: 'chair' }); assert.equal(drawableEntities({ entities, resolvedDef: ref => defs[ref] }), 2);
  const god = new GodMode(new Db(':memory:'), { worldId: 'r21', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
  assert.equal(drawableEntities(god.model), 0, 'the real model satisfies the helper type');
});
