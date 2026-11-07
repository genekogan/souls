// CW3 (#737) S2: request outcomes and latency at the admission seams, process/clock/inventory/activity/socket/disk
// series in live.json, and their /__sim/metrics names. Counters reconcile with a known request sequence.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {Hono} from 'hono';
import {Admission, admissionMiddleware, admissionPort, type PortDone} from './load/admission.ts';
import {histSlot, liveOf, newSharedLoad, observe, S, type LiveJson} from './load/shared.ts';
// @ts-expect-error untyped launcher module (plain .mjs)
import {metricsText, readLive} from '../../../tools/world-launcher/metrics.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const serving = () => { const a = newSharedLoad(); a[S.boot] = 4; return a; };   // boot phase index 4 = serving
const tick = () => new Promise<void>(r => setImmediate(r));
const rows = (text: string, name: string) => text.split('\n').filter(l => l.startsWith(`${name}{`) || l.startsWith(`${name} `));
const val = (text: string, name: string, labels: string) => { const l = rows(text, name).find(x => x.includes(labels)); return l === undefined ? undefined : Number(l.split(' ').at(-1)); };

test('middleware: a known request sequence reconciles with the counters, and answers are unchanged', async () => {
  const a = serving(), adm = new Admission({shared: a}), app = new Hono();
  app.use('*', admissionMiddleware(adm, () => 'green', c => c.req.header('authorization')?.replace(/^Bearer\s+/i, '')));
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  app.get('/v1/edge/here', async c => { if (c.req.query('hold')) await gate; return c.json({here: 1}); });
  app.post('/v1/edge/act', c => c.req.query('no') ? c.json({error: {code: 'act.refused'}}, 400) : c.req.query('boom') ? (() => { throw new Error('boom'); })() : c.json({ok: true}));
  const auth = (t: string, signal?: AbortSignal) => ({headers: {authorization: `Bearer ${t}`}, ...(signal ? {signal} : {})});
  const post = (t: string, q = '', signal?: AbortSignal) => app.request('/v1/edge/act' + q, {method: 'POST', ...auth(t, signal)});

  // reads: one completed, one held (in flight), one refused soul.busy behind it
  const ok = await app.request('/v1/edge/here', auth('sim_a'));
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), {here: 1}, 'the answer is the route\'s own');
  const held = app.request('/v1/edge/here?hold=1', auth('sim_a')); await tick();
  const busy = await app.request('/v1/edge/here', auth('sim_a'));
  assert.equal(busy.status, 429); assert.equal(((await busy.json()) as {error: {code: string}}).error.code, 'soul.busy');
  // acts: completed, rejected (a 400 from the route after it ran), failed (a throw -> 500)
  assert.equal((await post('sim_b')).status, 200);
  assert.equal((await post('sim_b', '?no=1')).status, 400);
  assert.equal((await post('sim_b', '?boom=1')).status, 500);
  // an act queued behind sim_a's held read (another Soul in flight, black: budget 0) whose client goes away is dropped
  adm.setLoadLevel('black');
  const ac = new AbortController(); const gone = post('sim_c', '', ac.signal);
  await new Promise(r => setTimeout(r, 30)); assert.equal(adm.queue.length, 1, 'queued');
  // the sweeper that notices is unref'd, so with nothing else alive this process would exit before it fires
  const alive = setInterval(() => {}, 50);
  ac.abort(); assert.equal((await gone).status, 499); clearInterval(alive);
  adm.setLoadLevel('green'); release(); assert.equal((await held).status, 200);

  const live = liveOf(a, 1, 1000), r = live.requests!, f = live.refused!;
  assert.deepEqual(r.read, {attempted: 3, started: 2, completed: 2, rejected: 0, failed: 0, dropped: 0});
  assert.deepEqual(r.act, {attempted: 4, started: 3, completed: 1, rejected: 1, failed: 1, dropped: 1});
  assert.equal(f.read['soul.busy'], 1); assert.equal(f.act['soul.busy'] + f.act['world.busy'] + f.act['soul.slow-down'] + f.act['world.crowded'], 0);
  for (const cls of ['read', 'act'] as const) {
    const refused = Object.values(f[cls]).reduce((x, y) => x + y, 0);
    assert.equal(r[cls].attempted, refused + r[cls].dropped + r[cls].started, `${cls}: attempted = refused + dropped + started (nothing in flight)`);
    assert.equal(r[cls].started, r[cls].completed + r[cls].rejected + r[cls].failed, `${cls}: started = completed + rejected + failed`);
    assert.equal(live.latency![`${cls}.queue`].counts.at(-1), r[cls].started, 'one queue sample per started request');
    assert.equal(live.latency![`${cls}.run`].counts.at(-1), r[cls].started, 'one run sample per started request');
  }
  const text = metricsText({now: 1000, worlds: [{slug: 'w', status: 'running', live}]});
  assert.equal(val(text, 'sim_world_requests_total', 'class="act",outcome="failed"'), 1);
  assert.equal(val(text, 'sim_world_requests_refused_total', 'class="read",code="soul.busy"'), 1);
  assert.equal(val(text, 'sim_world_request_run_seconds_count', 'class="read"'), 2);
  assert.equal(val(text, 'sim_world_request_queue_seconds_bucket', 'class="act",le="+Inf"'), 3);
  assert.ok(!/sim_[a-z]+|Bearer/.test(rows(text, 'sim_world_requests_total').join('\n').replace(/^sim_world_requests_total/gm, '')), 'no token or id in labels');
  adm.close();
});

test('histograms: fixed buckets, cumulative in live.json; sums in seconds; nothing grows per event', () => {
  const a = serving(); a[S.reqOn] = 1;
  const base = histSlot('read', 'queue');
  for (const ms of [1, 7, 40, 40, 900, 60_000]) observe(a, base, ms);
  observe(a, base, Number.NaN);   // not a sample
  const h = liveOf(a, 1, 1).latency!['read.queue'];
  assert.deepEqual(h.le, [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
  assert.deepEqual(h.counts, [1, 2, 2, 4, 4, 4, 4, 5, 5, 5, 5, 6]);
  assert.equal(h.sum, 60.988);
  assert.equal(a.length, S.size, 'fixed layout');
});

test('liveOf: absent until written (never a false 0); process, clock, inventory, activity, socket and disk blocks map to metrics', () => {
  const a = serving();
  const empty = liveOf(a, 1, 1000);
  for (const k of ['proc', 'clock', 'requests', 'latency', 'disk'] as const) assert.equal(empty[k], undefined, `${k} absent before it is written`);
  assert.equal(empty.inventory?.entities, undefined, 'no god model: entities unknown, not 0');
  a[S.procAt] = 1; a[S.cpuUserMs] = 1500; a[S.cpuSysMs] = 250; a[S.rssMb] = 200; a[S.externalMb] = 3; a[S.arrayBuffersMb] = 1;
  a[S.adminRate] = 1; a[S.clockRate] = 0.5; a[S.pace] = 0.25; a[S.tickMonoMs] = 1_700_000_000_123.4;
  a[S.soulsTotal] = 5; a[S.entities] = 321; a[S.viewers] = 2; a[S.awakeSoulSeconds] = 12.34; a[S.viewerSeconds] = 6;
  a[S.wsOpened] = 3; a[S.wsClosed] = 1; a[S.wsBytesSent] = 4096; a[S.wsBytesReceived] = 64;
  const live: LiveJson = liveOf(a, 1, 1000, {dbBytes: 1 << 20, walBytes: 4096, freeBytes: 1e9});
  assert.deepEqual(live.proc, {cpuUserSeconds: 1.5, cpuSystemSeconds: 0.25, rssMb: 200, externalMb: 3, arrayBuffersMb: 1});
  assert.deepEqual(live.clock, {adminRate: 1, rate: 0.5, pace: 0.25, monoMs: 1_700_000_000_123, state: 'running'});
  assert.deepEqual(live.inventory, {souls: 5, entities: 321, viewers: 2});
  const text = metricsText({now: 1000, worlds: [{slug: 'w', status: 'running', live}]});
  const want: [string, string, number][] = [['sim_world_process_cpu_seconds_total', 'mode="user"', 1.5], ['sim_world_process_resident_bytes', 'world="w"', 200 * 1048576],
    ['sim_world_clock_admin_rate', 'world="w"', 1], ['sim_world_clock_rate', 'world="w"', 0.5], ['sim_world_attention_pace', 'world="w"', 0.25],
    ['sim_world_souls_resident', 'world="w"', 5], ['sim_world_entities', 'world="w"', 321], ['sim_world_viewers', 'world="w"', 2],
    ['sim_world_awake_soul_seconds_total', 'world="w"', 12.3], ['sim_world_ws_connections_total', 'event="closed"', 1], ['sim_world_ws_sent_bytes_total', 'world="w"', 4096],
    ['sim_world_db_bytes', 'world="w"', 1 << 20], ['sim_world_wal_bytes', 'world="w"', 4096], ['sim_world_disk_free_bytes', 'world="w"', 1e9]];
  for (const [name, l, v] of want) assert.equal(val(text, name, l), v, name);
  a[S.clockState] = 1; assert.equal(liveOf(a, 1, 1000).clock?.state, 'paused');
  a[S.awakeSoulSeconds] = 1234567.8; assert.equal(val(metricsText({now: 1000, worlds: [{slug: 'w', status: 'running', live: liveOf(a, 1, 1000)}]}), 'sim_world_awake_soul_seconds_total', 'world="w"'), 1234567.8, 'a counter keeps its precision');
  assert.equal(rows(text, 'sim_world_requests_total').length, 0, 'no admission, no request series (unknown, not 0)');
});

async function freePort() { return await new Promise<number>((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as {port: number}).port; s.close(() => res(p)); }); }); }

test('a fake-mind world writes the S2 blocks; a real edge request is counted; the clock evidence advances', {timeout: 120_000}, async (t) => {
  mkdirSync(join(ROOT, '.local'), {recursive: true});
  const dir = mkdtempSync(join(ROOT, '.local', 'req-telemetry-')), port = await freePort();
  let child: ChildProcess | undefined, out = '';
  t.after(() => { try { child?.kill('SIGKILL'); } catch { /* gone */ } rmSync(dir, {recursive: true, force: true}); });
  const env = {PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOST: '127.0.0.1', PORT: String(port), WORLD_KEY: 'req-telemetry', WORLD_PATH: '/w/req-telemetry',
    PUBLIC_URL: `http://127.0.0.1:${port}/w/req-telemetry`, DATA_DIR: dir, DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: ''};
  child = spawn(process.execPath, ['apps/server/src/main.ts'], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout!.on('data', (b) => { out = (out + b).slice(-4000); }); child.stderr!.on('data', (b) => { out = (out + b).slice(-4000); });
  const until = async (ok: (l: LiveJson | null) => boolean, what: string) => {
    let live: LiveJson | null = null;
    for (let i = 0; i < 90 && !ok(live); i++) { if (child!.exitCode !== null) throw new Error(`world exited: ${out}`); await new Promise((r) => setTimeout(r, 1000)); live = readLive(dir); }
    assert.ok(ok(live), `${what}: ${JSON.stringify(live)}`); return live!;
  };
  const first = await until(l => !!l?.proc && !!l?.clock && !!l?.requests && !!l?.disk, 'S2 blocks never appeared');
  assert.ok(first.proc!.rssMb > 0 && first.proc!.cpuUserSeconds > 0);
  assert.equal(first.clock!.adminRate, 1); assert.ok(first.clock!.pace > 0 && first.clock!.pace <= 1);
  assert.equal(first.clock!.state, 'running');
  assert.ok((first.disk!.dbBytes ?? 0) > 0 && (first.disk!.freeBytes ?? 0) > 0, 'sim.db size and free disk read by the watchdog');
  assert.equal(typeof first.inventory!.souls, 'number'); assert.equal(typeof first.ws!.opened, 'number');
  // one real edge read with an unknown token: admitted (C2), run, answered by the route with a 4xx -> rejected
  const before = first.requests!.read;
  let status = 0;
  for (const base of ['', '/w/req-telemetry']) { const r = await fetch(`http://127.0.0.1:${port}${base}/v1/edge/here`, {headers: {authorization: 'Bearer sim_not_a_token'}}); await r.arrayBuffer(); if (r.status !== 404) { status = r.status; break; } }
  assert.ok(status >= 400 && status < 500, `edge read answered ${status}`);
  const after = await until(l => (l?.requests?.read.attempted ?? 0) > before.attempted, 'the request was never counted');
  assert.equal(after.requests!.read.started - before.started, 1); assert.equal(after.requests!.read.rejected - before.rejected, 1);
  // independent full-clock evidence: Δtick ÷ (Δmonotonic s × 20 ticks/s × admin rate), whatever the attention pace
  const ratio = (after.tick!.world - first.tick!.world) / (((after.clock!.monoMs - first.clock!.monoMs) / 1000) * 20 * after.clock!.adminRate);
  assert.ok(Number.isFinite(ratio) && ratio > 0, `full-clock ratio ${ratio}`);
  t.diagnostic(`full-clock ratio ${ratio.toFixed(3)} at pace ${after.clock!.pace} (attention pacing is CW6's correction, not measured here)`);
  const text = metricsText({now: Date.now(), worlds: [{slug: 'req-telemetry', status: 'running', live: after}]});
  for (const name of ['sim_world_process_cpu_seconds_total', 'sim_world_clock_admin_rate', 'sim_world_tick_sampled_seconds', 'sim_world_requests_total', 'sim_world_request_run_seconds_bucket', 'sim_world_db_bytes', 'sim_world_souls_resident', 'sim_world_ws_connections_total'])
    assert.ok(rows(text, name).length > 0, `${name} missing from /__sim/metrics`);
});

test('admissionPort: a reply that throws becomes an error reply, never an unhandled rejection', async () => {
  let handler: (m: unknown) => void = () => {};
  const sent: PortDone[] = [], port = {on: (_: 'message', f: (m: unknown) => void) => { handler = f; }, postMessage: (d: unknown) => { const x = d as PortDone; if ('result' in x) throw new Error('could not be cloned'); sent.push(x); }};
  const unhandled: unknown[] = [], on = (e: unknown) => unhandled.push(e); process.on('unhandledRejection', on);
  try {
    const stats = admissionPort(undefined, port, async () => ({result: {status: 200}}));
    handler({t: 'job', id: 7, key: 'k', god: false, route: null, payload: null});
    for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(sent, [{t: 'done', id: 7, error: 'could not be cloned'}]);
    assert.equal(stats.jobs, 1);
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', on); }
});
