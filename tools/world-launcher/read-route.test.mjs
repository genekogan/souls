// node --test tools/world-launcher/read-route.test.mjs — Stage B (lane B-port, LOAD-CONTRACT §4 readPort): C2 reads to a
// world's read workers. Fake worlds (fake-world.mjs: a read worker thread when SIM_READ_WORKER=1) on lane B-port's ports
// only: two launchers (on, off) and their children on a free block of ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { readWorkersOf } from './registry.mjs';
import { requestClass } from './flood.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(10);

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`not within ${ms} ms: ${what}`); await sleep(25); } };
const TOKEN = { authorization: 'Bearer sim_s_reader_secret' };

async function launcher({ port, range, on, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'b-port-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const hits = join(dir, 'hits.log'); writeFileSync(hits, '');
  const command = (w, p) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(p), DATA_DIR: w.dataDir, FAKE_LIVE: '1', FAKE_LIVE_MS: '100', FAKE_EDGE: '1', FAKE_HITS: hits, ...env } });
  const L = await openLauncher({ port, range, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false, publicOrigin: 'http://sim.test', devAuth: true, guard: false,
    readWorkerEnv: on ? { SIM_READ_WORKER: '1' } : {} });
  const base = `http://127.0.0.1:${port}`;
  const make = async (name) => { const r = await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); assert.equal(r.status, 201); return (await r.json()).slug; };
  const call = async (slug, path, init = {}) => { const t0 = performance.now(); const r = await fetch(`${base}/w/${slug}${path}`, { ...init, headers: { ...TOKEN, ...(init.headers ?? {}) } }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* not json */ } return { status: r.status, headers: r.headers, text, body, ms: performance.now() - t0 }; };
  const hit = () => readFileSync(hits, 'utf8').split('\n').filter(Boolean);
  return { L, base, make, call, hit, dir };
}
const advertised = (L, slug) => until(() => { try { return JSON.parse(readFileSync(join(L.registry.worldDir(slug), 'live.json'), 'utf8')).readPort; } catch { return null; } }, 5000, 'readPort in live.json');

test('registry readWorkers: explicit wins (0 = off, capped at 4), else SIM_READ_WORKER=1 → 1', () => {
  assert.equal(readWorkersOf({}, {}), 0); assert.equal(readWorkersOf({}, { SIM_READ_WORKER: '1' }), 1);
  assert.equal(readWorkersOf({ readWorkers: 0 }, { SIM_READ_WORKER: '1' }), 0); assert.equal(readWorkersOf({ readWorkers: 3 }, {}), 3);
  assert.equal(requestClass('/v1/edge/around'), 'C1', 'around is a write, as in-world admission says'); assert.equal(requestClass('/v1/edge/here'), 'C2');
  assert.equal(readWorkersOf({ readWorkers: 9 }, {}), 4); assert.equal(readWorkersOf({ readWorkers: 'x' }, { SIM_READ_WORKER: '1' }), 1);
});

test('flag off: no read env reaches the world, and even an advertised readPort is ignored (everything to main)', async () => {
  const { L, make, call, hit } = await launcher({ port: P0 + 8, range: [P0 + 6, P0 + 7], on: false });
  try {
    const plain = await make('Plain');
    assert.deepEqual((await call(plain, '/read-env')).body, { SIM_READ_WORKER: null, SIM_READ_WORKERS: null, SIM_READ_PORTS: null, SIM_READ_MODE: null });
    // a world that starts read workers on its own (forced by its command env) is still not routed to
    const forced = await launcher({ port: P0 + 9, range: [P0 + 4, P0 + 5], on: false, env: { SIM_READ_WORKER: '1' } });
    try {
      const slug = await forced.make('Forced'); await advertised(forced.L, slug);
      for (const path of ['/v1/edge/here', '/v1/edge/capabilities', '/v1/edge/observe', '/healthz/read']) {
        const r = await forced.call(slug, path);
        assert.notEqual(r.headers.get('x-sim-read'), 'worker', `${path} stayed on main`);
      }
      assert.deepEqual(forced.hit().filter((h) => h.startsWith('/v1/edge/') || h.startsWith('/healthz/read')), ['/v1/edge/here', '/v1/edge/capabilities', '/v1/edge/observe', '/healthz/read']);
      assert.equal((await fetch(`${forced.base}/__sim/metrics`).then((r) => r.text())).includes('sim_world_read_routed_total'), false, 'no read metrics for a world without read workers');
    } finally { await forced.L.close(); }
    assert.ok(hit().includes('/read-env'));
  } finally { await L.close(); }
});

test('flag on (subset): here/capabilities to the worker, the rest to main; fallback on error/5xx/timeout; metrics', async () => {
  const { L, base, make, call, hit } = await launcher({ port: P0 + 9, range: [P0, P0 + 3], on: true });
  try {
    const slug = await make('Readers');
    const env = (await call(slug, '/read-env')).body;
    assert.equal(env.SIM_READ_WORKER, '1'); assert.equal(env.SIM_READ_WORKERS, '1'); assert.equal(env.SIM_READ_PORTS, String(P0 + 3), 'the read port comes from the range top'); assert.equal(env.SIM_READ_MODE, '2', 'mode 2 (B-facade) unless the launcher says SIM_READ_MODE=1');
    assert.equal(await advertised(L, slug), P0 + 3);
    assert.deepEqual(L.pool.status(slug).readPorts, [P0 + 3]);
    const to = async (path, init) => { const r = await call(slug, path, init); return r.body?.from ?? (r.headers.get('x-sim-read') === 'worker' ? 'worker' : String(r.status)); };
    assert.equal(await to('/v1/edge/here'), 'worker');
    assert.equal(await to('/v1/edge/capabilities'), 'worker');
    assert.equal(await to('/healthz/read'), 'worker');
    assert.equal(await to('/v1/edge/here?include=doHere'), 'main', 'a query the subset does not serve');
    assert.equal(await to('/v1/edge/observe'), 'main', 'not in the subset');
    assert.equal(await to('/v1/edge/around'), 'main', 'around is C1');
    assert.equal((await call(slug, '/v1/edge/act', { method: 'POST', body: '{}' })).status, 404, 'C1 to main (the fake has no act)');
    assert.ok(hit().includes('/v1/edge/act'));
    const worker = (await call(slug, '/v1/edge/here')).body;
    assert.equal(worker.auth, TOKEN.authorization, 'the token reaches the worker');
    // fallback, once, counted: a dropped connection, a 500, no answer in 2 s
    for (const m of ['error', '500']) { await call(slug, `/read-fail?m=${m}`); assert.equal(await to('/v1/edge/here'), 'main', m); }
    await call(slug, '/read-fail?m=slow');
    const slow = await call(slug, '/v1/edge/here');
    assert.equal(slow.body?.from, 'main', slow.status + ' ' + slow.text); assert.ok(slow.ms >= 1900 && slow.ms < 2900, `timeout fallback after ${Math.round(slow.ms)} ms`);
    await call(slug, '/read-fail?m=ok'); await sleep(50);
    assert.equal(await to('/v1/edge/here'), 'worker');
    const m = await fetch(`${base}/__sim/metrics`).then((r) => r.text());
    const val = (name) => Number(new RegExp(`^${name}\\{world="${slug}"\\} (\\S+)$`, 'm').exec(m)?.[1]);
    assert.equal(val('sim_world_read_fallback_total'), 3);
    assert.equal(Number(new RegExp(`^sim_world_read_routed_total\\{world="${slug}",level="green"\\} (\\S+)$`, 'm').exec(m)?.[1]), 8);
    assert.equal(val('sim_world_read_workers'), 1); assert.equal(val('sim_world_read_lag_gens'), 0);
  } finally { await L.close(); }
});

test('the worker answers through the launcher while the main thread is held for 2 s', async () => {
  const { L, make, call } = await launcher({ port: P0 + 9, range: [P0, P0 + 3], on: true });
  try {
    const slug = await make('Busy'); await advertised(L, slug);
    await call(slug, '/busy?ms=2000'); await sleep(60);
    const t0 = performance.now(), here = [], health = [];
    while (performance.now() - t0 < 1500) { here.push(await call(slug, '/v1/edge/here')); health.push(await call(slug, '/healthz/read')); await sleep(100); }
    const main = await call(slug, '/healthz');   // the main thread, after the hold
    assert.ok(here.length >= 5 && here.every((r) => r.status === 200 && r.body.from === 'worker'), JSON.stringify(here.map((r) => r.status)));
    assert.ok(health.every((r) => r.status === 200 && r.body.from === 'worker'));
    const worst = Math.max(...here.map((r) => r.ms), ...health.map((r) => r.ms));
    assert.ok(worst < 200, `slowest worker answer during the hold ${Math.round(worst)} ms`);
    assert.ok(performance.now() - t0 >= 1500 && main.status === 200);
    console.log(`# busy 2 s: ${here.length} here + ${health.length} healthz/read through the launcher, all from the worker, slowest ${worst.toFixed(1)} ms`);
  } finally { await L.close(); }
});

test('full mode (B-facade route set): observe and view to the worker too, with queries; around still to main; readWorkers 0 turns a world off', async () => {
  const { L, make, call } = await launcher({ port: P0 + 9, range: [P0, P0 + 3], on: true, env: { FAKE_READ_MODE: 'full' } });
  try {
    const slug = await make('Full'); await advertised(L, slug);
    for (const p of ['/v1/edge/here?include=doHere', '/v1/edge/observe', '/v1/edge/view?alt=only', '/v1/edge/capabilities?all=1']) assert.equal((await call(slug, p)).body.from, 'worker', p);
    // lane B-serve: a view's picture (main's render worker) and a gaze (an attention write) are main's
    for (const p of ['/v1/edge/view', '/v1/edge/view?mode=map', '/v1/edge/view?alt=only&gaze=left']) assert.notEqual((await call(slug, p)).body?.from, 'worker', p);
    assert.equal((await call(slug, '/v1/edge/around')).body.from, 'main');
    const off = await make('Off');
    const op = await fetch(`http://127.0.0.1:${P0 + 9}/__sim/op/set-read-workers`, { method: 'POST', body: JSON.stringify({ slug: off, readWorkers: 0 }) });
    assert.equal(op.status, 200); assert.equal((await op.json()).readWorkers, 0);
    assert.equal((await fetch(`http://127.0.0.1:${P0 + 9}/__sim/op/set-read-workers`, { method: 'POST', body: JSON.stringify({ slug: off, readWorkers: 7 }) })).status, 400);
    assert.equal(readWorkersOf(L.registry.get(off), { SIM_READ_WORKER: '1' }), 0);
    assert.equal((await call(off, '/v1/edge/here')).body.from, 'main', 'off from the registry: routed to main at once');
  } finally { await L.close(); }
});

test('at red/black a read the workers answer is routed to them, not shed (lag ≤ 2 gens); around is C1 (never shed as a read)', async () => {
  const { L, base, make, call } = await launcher({ port: P0 + 9, range: [P0, P0 + 3], on: true });
  try {
    const slug = await make('Hot'); await advertised(L, slug);
    await call(slug, '/level?l=red'); await call(slug, '/healthz');   // the next answer carries X-Sim-Load: red
    const here = await call(slug, '/v1/edge/here');
    assert.equal(here.status, 200); assert.equal(here.body.from, 'worker', 'red: routed, not shed');
    const q = await call(slug, '/v1/edge/here?include=doHere');
    assert.equal(q.status, 503); assert.equal(q.body.code, 'world.busy', 'red: a read the subset worker does not answer is still shed');
    assert.equal((await call(slug, '/v1/edge/observe')).status, 503);
    assert.equal((await call(slug, '/v1/edge/around')).body?.from, 'main', 'around is C1: not shed at red');
    // a worker more than 2 gens behind: shed as before; caught up: routed again
    await call(slug, '/read-lag?n=5'); await sleep(1300);
    assert.equal((await call(slug, '/v1/edge/here')).status, 503, 'red + lagging worker: shed');
    await call(slug, '/level?l=black'); await call(slug, '/read-lag?n=2'); await call(slug, '/healthz'); await sleep(1300);
    assert.equal((await call(slug, '/v1/edge/capabilities')).body?.from, 'worker', 'black + lag 2: routed');
    const m = await fetch(`${base}/__sim/metrics`).then((r) => r.text());
    const by = (lv) => Number(new RegExp(`^sim_world_read_routed_total\\{world="${slug}",level="${lv}"\\} (\\S+)$`, 'm').exec(m)?.[1]);
    assert.equal(by('red'), 1); assert.equal(by('black'), 1);
  } finally { await L.close(); }
});

test('world budget (lane B-serve): reads the workers answer are exempt; what reaches main counts (a fallback, a worker relay); registry override', async () => {
  const { L, base, make, call } = await launcher({ port: P0 + 9, range: [P0, P0 + 3], on: true, env: { FAKE_READ_MODE: 'full' } });
  try {
    const slug = await make('Budget'); await advertised(L, slug);
    const set = await fetch(`${base}/__sim/op/set-limits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, limits: { worldBudgetRps: 1, accountHeavyPerMin: 6000 } }) });
    assert.equal(set.status, 200); assert.equal((await set.json()).limits.worldBudgetRps, 1);
    const busy = (r) => r.status === 503 && r.body?.code === 'world.busy';
    // 30 worker reads at once: none refused, though the world's budget is 1/s (burst 2)
    const reads = await Promise.all(Array.from({ length: 30 }, (_, i) => call(slug, ['/v1/edge/here', '/v1/edge/observe', '/v1/edge/capabilities', '/v1/edge/view?alt=only'][i % 4])));
    assert.ok(reads.every((r) => r.status === 200 && r.body.from === 'worker'), JSON.stringify(reads.map((r) => r.status)));
    // C2 reads to main (a view's picture) still take it: the burst of 2, then world.busy
    const main = []; for (let i = 0; i < 3; i++) main.push(await call(slug, '/v1/edge/view'));
    assert.ok(!busy(main[0]) && !busy(main[1]), JSON.stringify(main.map((r) => r.status))); assert.ok(busy(main[2]), 'the third main read in a second is refused ' + JSON.stringify(main.map((r) => [r.status, r.body])));
    // a worker fallback (a 500) is main's work: charged, and refused when the budget is spent
    await sleep(2100); await call(slug, '/read-fail?m=500');
    const fb = []; for (let i = 0; i < 3; i++) fb.push(await call(slug, '/v1/edge/here'));
    assert.deepEqual(fb.map((r) => busy(r) ? 'busy' : r.body?.from), ['main', 'main', 'busy']);
    // a worker that relays main's answer (no x-sim-read: worker): counted after the fact (never refused), so main's next read waits
    await call(slug, '/read-fail?m=relay'); await sleep(2100);
    const rel = []; for (let i = 0; i < 3; i++) rel.push(await call(slug, '/v1/edge/here'));
    assert.ok(rel.every((r) => r.status === 200 && r.body.from === 'main-via-worker'), JSON.stringify(rel.map((r) => r.status)));
    assert.ok(busy(await call(slug, '/v1/edge/view')), 'the relayed reads spent the budget');
    await call(slug, '/read-fail?m=ok');
    const m = await fetch(`${base}/__sim/metrics`).then((r) => r.text()), val = (name) => Number(new RegExp(`^${name}\\{world="${slug}"\\} (\\S+)$`, 'm').exec(m)?.[1]);
    assert.equal(val('sim_world_read_main_answered_total'), 3); assert.equal(val('sim_world_read_fallback_refused_total'), 1); assert.equal(val('sim_world_read_fallback_total'), 3);
  } finally { await L.close(); }
});
