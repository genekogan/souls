// srv-load: in-world admission (LOAD-CONTRACT §2, §2b, §3): classes, one heavy request per Soul, writes before reads,
// the god's reserve, deadlines, dead clients, budgets and cool-down, the world-total frame budget, the busy signal.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {Admission, admissionMiddleware, classify, FRAME_BUDGET_MS, frameBudgetMs, type RouteClass, type Ticket} from './load/admission.ts';
import type {Level} from './load/shared.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

const tick = () => new Promise(r => setTimeout(r, 2));
const route = (method: string, path: string) => classify(method, path)!;
function fixture() {
  let now = 1000; const adm = new Admission({now: () => now, yieldTurn: () => new Promise(() => {})});
  const ran: string[] = [];
  /** A request whose handler costs `cost` ms of (fake) time. */
  const ask = (key: string, r: RouteClass, cost = 5, extra: {closed?: () => boolean; hintMs?: number} = {}) => {
    const t = adm.request({key, god: r.god, route: r, ...extra}) as Ticket;
    const out = {t, result: undefined as unknown};
    if ('turn' in t) void t.turn.then(v => { out.result = v; if (v === 'run') { ran.push(`${key}:${r.id}`); now += cost; t.done(); } });
    else out.result = t.refusal;
    return out;
  };
  return {adm, ran, ask, advance: (ms: number) => { now += ms; }, get now() { return now; }};
}

test('classes: C0 control, C1 writes, C2 personal reads, C3 public reads; everything else passes through', () => {
  const c = (m: string, p: string) => classify(m, p)?.cls ?? null;
  assert.equal(c('GET', '/healthz'), 'C0'); assert.equal(c('GET', '/v1/config'), 'C0');
  for (const p of ['/v1/edge/here', '/v1/edge/observe', '/v1/edge/capabilities', '/v1/edge/view', '/v1/edge/objects/abc']) assert.equal(c('GET', p), 'C2', p);
  assert.equal(c('GET', '/v1/edge/around'), 'C1', 'around records what it finds: a write');
  assert.equal(c('POST', '/v1/edge/resolve'), 'C2');
  for (const p of ['/v1/edge/act', '/v1/edge/say', '/v1/edge/converse', '/v1/edge/plan', '/v1/edge/objects/x1/act']) assert.equal(c('POST', p), 'C1', p);
  assert.equal(c('PATCH', '/v1/edge/plan/p1'), 'C1');
  for (const p of ['/v1/edge/map', '/v1/edge/rides', '/v1/edge/items', '/v1/edge/platforms', '/v1/world/snapshot']) assert.equal(c('GET', p), 'C3', p);
  for (const p of ['/v1/edge/inbox/listen', '/v1/edge/wait', '/v1/edge/receipts/r1', '/v1/edge/events', '/v1/edge/view/status', '/v1/god/stream', '/v1/god/status']) assert.equal(c('GET', p), null, p);
  assert.equal(c('POST', '/v1/edge/inbox/m1/result'), null);
  assert.deepEqual([c('POST', '/v1/god/act'), c('POST', '/v1/god/preview'), c('POST', '/v1/god/query'), c('GET', '/v1/god/mirror')], ['C1', 'C1', 'C2', 'C2']);
  assert.deepEqual([c('POST', '/v1/god/pair/start'), c('POST', '/v1/god/claim'), c('POST', '/v1/god/pray')], [null, null, null]);
  assert.equal(route('POST', '/v1/god/act').god, true); assert.equal(route('POST', '/v1/god/act').deadlineMs, 30_000);
  assert.equal(route('POST', '/v1/edge/act').deadlineMs, 20_000); assert.equal(route('GET', '/v1/edge/here').deadlineMs, 8_000);
});

test('one heavy request per Soul: the second concurrent one is refused soul.busy at once; others are not affected', async () => {
  const f = fixture();
  const a = f.ask('A', route('GET', '/v1/edge/here')), b = f.ask('A', route('POST', '/v1/edge/act')), c = f.ask('B', route('GET', '/v1/edge/here'));
  assert.equal((b.result as {code: string}).code, 'soul.busy'); assert.equal((b.result as {status: number}).status, 429);
  await tick(); await tick();
  assert.deepEqual([a.result, c.result], ['run', 'run']);
  assert.equal(f.adm.outstanding.size, 0);
  const d = f.ask('A', route('GET', '/v1/edge/here')); await tick(); assert.equal(d.result, 'run', 'free again once answered');
});

test('dispatch order: writes before reads, FIFO across Souls, the god served within its reserve', async () => {
  const f = fixture();
  // a request in flight (alone in a calm world it ran inline), so everything after it queues
  const blocker = f.adm.request({key: 'X', god: false, route: route('GET', '/v1/edge/here')}) as {done: () => void};
  f.ask('A', route('GET', '/v1/edge/here')); f.ask('B', route('GET', '/v1/edge/observe')); f.ask('C', route('POST', '/v1/edge/act'));
  f.ask('god', route('POST', '/v1/god/act')); f.ask('D', route('POST', '/v1/edge/say'));
  blocker.done(); await tick(); await tick();
  assert.deepEqual(f.ran, ['god:god:act', 'C:edge:act', 'D:edge:say', 'A:edge:here', 'B:edge:observe']);
});

test('god reserve: under contention the god gets about a quarter of the request time, and is never starved', async () => {
  const f = fixture(); let god = 0, souls = 0;
  for (let round = 0; round < 40; round++) {
    for (const k of ['A', 'B', 'C', 'D', 'god']) if (!f.adm.outstanding.has(k)) f.ask(k, route('POST', k === 'god' ? '/v1/god/act' : '/v1/edge/act'), 10);
    await tick(); f.advance(200); await f.adm.drain();
  }
  for (const r of f.ran) if (r.startsWith('god:')) god++; else souls++;
  assert.ok(god >= 0.2 * (god + souls) && god <= 0.4 * (god + souls), `god ${god} souls ${souls}`);
});

test('deadline: a job that can no longer be answered in time is answered world.busy without running; a closed client is dropped', async () => {
  const f = fixture();
  f.adm.setLoadLevel('black');   // budget 0: nothing runs
  const act = f.ask('A', route('POST', '/v1/edge/act'), 5, {hintMs: 3000});
  let gone = false; const read = f.ask('B', route('POST', '/v1/edge/say'), 5, {closed: () => gone});
  await tick();
  assert.equal(act.result, undefined); assert.equal(read.result, undefined);
  gone = true; f.advance(100); await new Promise(r => setTimeout(r, 120));
  assert.equal(read.result, 'dropped'); assert.equal(f.adm.shed.dropped, 1);
  f.advance(2800); await new Promise(r => setTimeout(r, 120));
  assert.deepEqual(act.result, {status: 503, code: 'world.busy', retryAfterS: 15, message: 'the world is too busy to answer this in time'});
  assert.deepEqual(f.ran, [], 'nothing ran'); assert.equal(f.adm.outstanding.size, 0); assert.equal(f.adm.shed.acts, 1);
  f.adm.close();
});

test('black: personal reads are shed at once, acts wait for their deadline answer', () => {
  const f = fixture(); f.adm.setLoadLevel('black');
  const r = f.ask('A', route('GET', '/v1/edge/here'));
  assert.equal((r.result as {code: string}).code, 'world.busy');
  f.adm.close();
});

test('budget: under contention a read over its Soul budget gets soul.slow-down + Retry-After; 3 impolite in a minute → 60 s cool-down', async () => {
  const f = fixture();
  // alone in a calm world A is never slowed, but its bucket is still charged: here learns ~500 ms, A spends its 2 s
  for (let i = 0; i < 12; i++) { const x = f.ask('A', route('GET', '/v1/edge/here'), 500); await tick(); await tick(); assert.equal(x.result, 'run'); f.advance(1000); }
  f.adm.setLoadLevel('red');   // budgets bind at red even for one Soul
  const slow: {retryAfterS: number; code: string}[] = [];
  // the first refusal is polite (A was given no Retry-After yet); the next three ignore the one they were given: 3 strikes
  // (re-pinned by srv-admission-calib: strikes count only impolite requests)
  for (let i = 0; i < 4; i++) { const x = f.ask('A', route('GET', '/v1/edge/here')); if (typeof x.result === 'object') slow.push(x.result as never); }
  assert.equal(slow.length, 4, JSON.stringify(slow)); assert.equal(slow[0].code, 'soul.slow-down'); assert.ok(slow[0].retryAfterS >= 1);
  const cooled = f.ask('A', route('POST', '/v1/edge/act'));
  assert.deepEqual([(cooled.result as {code: string}).code, (cooled.result as {retryAfterS: number}).retryAfterS], ['soul.slow-down', 60], 'cooled: even acts wait out the minute');
  f.advance(5000); const other = f.ask('B', route('GET', '/v1/edge/here')); await tick();
  assert.equal(other.result, 'run', 'another Soul is not affected');
  f.advance(61_000); f.adm.setLoadLevel('green');
  const back = f.ask('A', route('GET', '/v1/edge/here')); await tick();
  assert.equal(back.result, 'run');
  f.adm.close();
});

test('a Soul alone in a calm world is never slowed by its budget (no quiet-case regression)', async () => {
  const f = fixture();
  // back to back it is paced by the world-total frame budget (200 ms jobs, 25 of 50 ms), never refused
  for (let i = 0; i < 30; i++) { const x = f.ask('A', route('GET', '/v1/edge/here'), 200); await tick(); await tick(); assert.equal(x.result, 'run', `request ${i}`); f.advance(400); }
  f.adm.close();
});

test('world-total frame budget: 100 Souls within their own budgets still get at most budget/50 of the thread', async () => {
  for (const level of ['green', 'amber', 'red'] as Level[]) {
    let now = 0, spent = 0; const adm = new Admission({now: () => now, yieldTurn: () => new Promise(() => {})});
    adm.setLoadLevel(level);
    const queueAll = () => { for (let i = 0; i < 100; i++) { const k = `S${i}`; if (adm.outstanding.has(k)) continue; const t = adm.request({key: k, god: false, route: route('POST', '/v1/edge/act')}); if ('turn' in t) void t.turn.then(v => { if (v === 'run') { now += 4; spent += 4; t.done(); } }); } };
    // 2 s of wall time in 10 ms steps; the dispatcher may run whenever it likes
    for (let step = 0; step < 200; step++) { queueAll(); await adm.drain(); now += 10; }
    const share = spent / now, cap = ({green: 25, amber: 15, red: 8} as Record<string, number>)[level] / 50;
    assert.ok(share <= cap + 0.03, `${level}: requests took ${(100 * share).toFixed(1)} % of the thread (cap ${(100 * cap).toFixed(0)} %)`);
    assert.ok(share >= cap * 0.6, `${level}: the budget is used (${(100 * share).toFixed(1)} %)`);
    adm.close();
  }
});

test('busy signal: X-Sim-Load on every edge answer; refusals carry Retry-After and the world block in world words', async () => {
  let level: Level = 'green';
  const adm = new Admission(), app = new Hono();
  app.use('*', admissionMiddleware(adm, () => level, c => c.req.header('authorization')?.replace(/^Bearer\s+/i, '')));
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  app.get('/v1/edge/here', async c => { await gate; return c.json({here: 1}); });
  app.get('/v1/edge/map', c => c.json({places: []}));
  app.get('/v1/edge/wait', c => c.json({}, 429));
  const auth = {headers: {authorization: 'Bearer sim_a_1'}};
  const first = app.request('/v1/edge/here', auth);
  await tick();
  const second = await app.request('/v1/edge/here', auth);
  assert.equal(second.status, 429); assert.equal(second.headers.get('retry-after'), '1'); assert.equal(second.headers.get('x-sim-load'), 'green');
  assert.deepEqual(await second.json(), {contract: 'eden-edge/1', error: {code: 'soul.busy', message: 'a previous request from this Soul is still being answered'}, world: {load: 'green', retry_after_s: 1}});
  release(); const ok = await first;
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('x-sim-load'), 'green'); assert.deepEqual(await ok.json(), {here: 1});
  level = 'amber';
  const pub = await app.request('/v1/edge/map'); assert.equal(pub.headers.get('x-sim-load'), 'amber');
  const other = await app.request('/v1/edge/wait', auth);
  assert.equal(other.status, 429); assert.equal(other.headers.get('retry-after'), '2', 'every refusal at amber+ carries Retry-After');
  level = 'black'; adm.setLoadLevel('black');
  const shed = await app.request('/v1/edge/here', auth);
  assert.equal(shed.status, 503); const body = await shed.json() as {error: {code: string}; world: {load: string; note: string}};
  assert.equal(body.error.code, 'world.busy'); assert.equal(body.world.load, 'black');
  assert.ok(!/\b(should|try|please|wait)\b/i.test(body.world.note), 'a world fact, not advice');
  adm.close();
});

test('x-sim-account: an opaque tag of the token\'s account on every Soul-token answer, the same for all its Souls', async () => {
  const adm = new Admission(), app = new Hono();
  const owners: Record<string, string> = {sim_a_1: 'acct_one', sim_b_1: 'acct_one', sim_c_1: 'acct_two'};
  app.use('*', admissionMiddleware(adm, () => 'green', c => c.req.header('authorization')?.replace(/^Bearer\s+/i, ''), t => owners[t]));
  app.get('/v1/edge/here', c => c.json({}));
  app.get('/v1/edge/inbox/listen', c => c.json({}));
  const tag = async (path: string, token?: string) => (await app.request(path, token ? {headers: {authorization: `Bearer ${token}`}} : {})).headers.get('x-sim-account');
  const a = await tag('/v1/edge/here', 'sim_a_1'), b = await tag('/v1/edge/inbox/listen', 'sim_b_1'), c = await tag('/v1/edge/here', 'sim_c_1');
  assert.ok(a && /^[A-Za-z0-9_-]{16}$/.test(a)); assert.equal(a, b, 'same account, same tag'); assert.notEqual(a, c);
  assert.ok(!a!.includes('acct'), 'never the raw id');
  assert.equal(await tag('/v1/edge/here', 'sim_unknown'), null); assert.equal(await tag('/v1/edge/here'), null);
  adm.close();
});

test('over real HTTP: a queued POST whose body was read still runs; a client that hung up while queued is dropped unrun', async t => {
  const {createServer} = await import('node:http'); const {getRequestListener} = await import('@hono/node-server');
  const adm = new Admission(), app = new Hono(); let ran = 0;
  app.use('*', admissionMiddleware(adm, () => 'green', c => c.req.header('authorization')?.slice(7)));
  app.post('/v1/edge/act', async c => { ran++; return c.json({got: await c.req.json()}); });
  const server = createServer(getRequestListener(app.fetch)); await new Promise<void>(r => server.listen(TEST_PORT, '127.0.0.1', r));
  t.after(() => { server.close(); adm.close(); });
  const post = (token: string, signal?: AbortSignal) => fetch(`http://127.0.0.1:${TEST_PORT}/v1/edge/act`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({verb: 'go'}), signal});
  adm.setLoadLevel('black');   // budget 0: acts queue (and would wait for their deadline)
  const ok = post('sim_a'); const ac = new AbortController(); const gone = post('sim_b', ac.signal).catch(() => null);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(adm.queue.length, 2, 'both queued');
  ac.abort(); await gone; await new Promise(r => setTimeout(r, 250));
  assert.equal(adm.shed.dropped, 1, 'the hung-up one is dropped'); assert.equal(adm.queue.length, 1);
  adm.setLoadLevel('green');
  const res = await ok; assert.equal(res.status, 200); assert.deepEqual(await res.json(), {got: {verb: 'go'}});
  assert.equal(ran, 1);
});

test('a read that cannot start before its deadline is answered world.busy at once (not after the wait); acts still queue', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) { f.ask('L' + i, route('GET', '/v1/edge/here'), 1000); await tick(); f.advance(3000); }   // here costs ~1 s
  const blocker = f.adm.request({key: 'X', god: false, route: route('GET', '/v1/edge/observe')}) as {done: () => void};
  for (let i = 0; i < 6; i++) f.ask('Q' + i, route('GET', '/v1/edge/here'), 1000);   // 6 s of reads queued = 12 s at 25 of 50 ms
  const late = f.ask('Z', route('GET', '/v1/edge/here'));
  assert.equal((late.result as {code: string}).code, 'world.busy'); assert.ok((late.result as {retryAfterS: number}).retryAfterS >= 8);
  const act = f.ask('Y', route('POST', '/v1/edge/act'));
  assert.equal(act.result, undefined, 'the act queues');
  blocker.done(); f.adm.close();
});

const LEVELS4: Level[] = ['green', 'amber', 'red', 'black'];
const r1 = (x: number) => Math.round(10 * x) / 10;
test('frame budget from the measured quiet tick (srv-admission-calib): production 23/15/8/0, a 35 ms box 9/6/3/0', () => {
  assert.deepEqual(LEVELS4.map(l => r1(frameBudgetMs(l, 12))), [22.8, 15, 7.6, 0], 'production (tick 12 ms): ≈ today');
  assert.deepEqual(LEVELS4.map(l => r1(frameBudgetMs(l, 35))), [9, 6, 3, 0], 'a box ticking at 35 ms');
  assert.deepEqual(LEVELS4.map(l => frameBudgetMs(l, 0)), [25, 15, 8, 0], 'not measured yet: the caps (today)');
  assert.deepEqual(LEVELS4.map(l => frameBudgetMs(l, 5)), [25, 15, 8, 0], 'the laptop: capped at today');
  assert.deepEqual(LEVELS4.map(l => frameBudgetMs(l, 60)), [2, 1, 0.5, 0], 'a tick that fills the frame: the floor, so the world still answers');
  assert.deepEqual(LEVELS4.map(l => frameBudgetMs(l, Number.NaN)), [25, 15, 8, 0]);
  for (const q of [0, 8, 12, 20, 35, 45, 49, 80]) for (const l of LEVELS4) assert.ok(frameBudgetMs(l, q) <= FRAME_BUDGET_MS[l], `${l}@${q}: never above today`);
});

test('world-total frame budget follows the quiet tick: at 12 ms and at 35 ms, requests take at most budget/50 of the thread', async () => {
  for (const quiet of [12, 35]) for (const level of ['green', 'amber', 'red'] as Level[]) {
    let now = 0, spent = 0; const adm = new Admission({now: () => now, yieldTurn: () => new Promise(() => {}), quietTickMs: () => quiet});
    adm.setLoadLevel(level);
    const queueAll = () => { for (let i = 0; i < 100; i++) { const k = `S${i}`; if (adm.outstanding.has(k)) continue; const t = adm.request({key: k, god: false, route: route('POST', '/v1/edge/act')}); if ('turn' in t) void t.turn.then(v => { if (v === 'run') { now += 2; spent += 2; t.done(); } }); } };
    for (let step = 0; step < 200; step++) { queueAll(); await adm.drain(); now += 10; }
    const share = spent / now, cap = frameBudgetMs(level, quiet) / 50;
    assert.equal(adm.frameBudget(), frameBudgetMs(level, quiet));
    assert.ok(share <= cap + 0.03, `${level}@${quiet}: requests took ${(100 * share).toFixed(1)} % of the thread (cap ${(100 * cap).toFixed(1)} %)`);
    assert.ok(share >= cap * 0.6, `${level}@${quiet}: the budget is used (${(100 * share).toFixed(1)} %)`);
    adm.close();
  }
});

/** n Souls, each asking a `costMs` read every `periodMs` (staggered) and honouring every Retry-After, for `durMs` of
 *  fake time on one thread (requests advance the clock by their cost). Counts what each Soul was refused. */
async function soak(o: {quiet: number; n: number; costMs?: number; periodMs?: number; durMs?: number; level?: Level; polite?: boolean}) {
  const {quiet, n, costMs = 150, periodMs = 4000, durMs = 240_000, level = 'green', polite = true} = o;
  let now = 0; const adm = new Admission({now: () => now, yieldTurn: () => new Promise(() => {}), quietTickMs: () => quiet});
  adm.setLoadLevel(level);
  const next = Array.from({length: n}, (_, i) => i * periodMs / n), codes: Record<string, number> = {}; let ran = 0;
  for (; now < durMs; now += 50) {
    for (let i = 0; i < n; i++) {
      if (now < next[i] || adm.outstanding.has('S' + i)) continue;
      const t = adm.request({key: 'S' + i, god: false, route: route('GET', '/v1/edge/here')});
      if ('refusal' in t) { codes[t.refusal.code] = (codes[t.refusal.code] ?? 0) + 1; next[i] = now + (polite ? t.refusal.retryAfterS * 1000 : 500); continue; }
      next[i] = now + periodMs;
      void t.turn.then(v => { if (v === 'run') { now += costMs; ran++; t.done(); } else codes[(v as {code?: string}).code ?? String(v)] = 1 + (codes[(v as {code?: string}).code ?? String(v)] ?? 0); });
    }
    await adm.drain(); await Promise.resolve();
  }
  adm.close();
  return {codes, ran, cooled: adm.shed.cooled, adm};
}

test('per-Soul refill tied to the frame budget: the Souls\' buckets together never refill faster than the budget', () => {
  for (const quiet of [0, 12, 35, 48]) for (const level of LEVELS4) for (const awake of [1, 2, 3, 6, 12, 24, 50, 100]) {
    let now = 0; const adm = new Admission({now: () => now, quietTickMs: () => quiet}); adm.setLoadLevel(level);
    for (let i = 0; i < awake; i++) { const t = adm.request({key: 'S' + i, god: false, route: route('POST', '/v1/edge/act')}); if ('turn' in t) { t.done(); } now += 1; }
    assert.equal(adm.active(), awake);
    const each = adm.refillPerS(), budgetPerS = 20 * frameBudgetMs(level, quiet);
    assert.ok(awake * each <= budgetPerS + 1e-9, `${level}@${quiet} awake ${awake}: ${awake} × ${each} > ${budgetPerS}`);
    assert.ok(each <= 200);
    if (awake * 200 >= budgetPerS) assert.ok(Math.abs(awake * each - budgetPerS) < 1e-9, 'a crowd shares the whole budget');
    adm.close();
  }
  const g = new Admission({quietTickMs: () => 35}); assert.equal(g.refillPerS(true), 125, 'the god reserve is unchanged'); g.setLoadLevel('amber'); assert.equal(g.refillPerS(true), 62.5); g.close();
});

test('production numbers (tick 12 ms): 12 Souls each get a 150 ms read every 4 s at green, never told to slow down', async () => {
  const at = new Admission({quietTickMs: () => 12}); assert.ok(456 / 12 >= 150 / 4); at.close();
  const r = await soak({quiet: 12, n: 12});
  assert.equal(r.codes['soul.slow-down'] ?? 0, 0, JSON.stringify(r.codes)); assert.equal(r.cooled, 0);
  assert.ok(r.ran >= 12 * 240 / 4 * 0.9, `reads answered: ${r.ran}`);
});

test('a 35 ms box: 4 Souls fit (budget 9 ms/frame = 180 ms/s); 12 are refused with Retry-After, within the budget, never cooled', async () => {
  const four = await soak({quiet: 35, n: 4});
  assert.deepEqual(four.codes, {}, JSON.stringify(four.codes)); assert.ok(four.ran >= 4 * 240 / 4 * 0.9, String(four.ran));
  // 12 × 37.5 ms/s of demand against 180 ms/s: the buckets refill exactly what the dispatcher can serve, so the honest
  // capacity shows as the queue's world.busy (Retry-After), not as strikes and not as request time taken from the tick
  const twelve = await soak({quiet: 35, n: 12});
  assert.ok(Object.values(twelve.codes).reduce((x, y) => x + y, 0) > 0, 'over capacity: refused with Retry-After ' + JSON.stringify(twelve.codes));
  assert.equal(twelve.cooled, 0, 'honest Souls are never cooled');
  assert.ok(twelve.ran * 150 <= 180 * 240 * 1.05 + 2000 * 12, `requests stayed within the budget's throughput: ${twelve.ran} reads`);
});

test('strikes only for impolite requests: a Soul that honours every Retry-After is never cooled; one that ignores it is, in 3', async () => {
  // production numbers at green (budget 22.8 ms/frame = 456 ms/s); B holds a request in flight (contention), and A keeps
  // asking for 400 ms reads: the dispatcher could serve A 456 ms/s, its bucket refills 200 ms/s, so A is over budget
  for (const polite of [true, false]) {
    let now = 0; const adm = new Admission({now: () => now, yieldTurn: () => new Promise(() => {}), quietTickMs: () => 12});
    const hold = adm.request({key: 'B', god: false, route: route('GET', '/v1/edge/here')}); assert.ok('turn' in hold);
    let at = 0, ran = 0, refused = 0, cooledAt = -1, strikesBeforeCool = 0;
    for (; now < 600_000; now += 100) {
      if (now < at || adm.outstanding.has('A')) { await adm.drain(); continue; }
      const t = adm.request({key: 'A', god: false, route: route('GET', '/v1/edge/here')});
      if ('refusal' in t) {
        refused++;
        if (t.refusal.retryAfterS === 60 && /in a minute/.test(t.refusal.message) && cooledAt < 0) { cooledAt = now; strikesBeforeCool = refused - 1; }
        at = now + (polite ? t.refusal.retryAfterS * 1000 : 200);
      } else { at = now; void t.turn.then(v => { if (v === 'run') { now += 400; ran++; t.done(); } }); }
      await adm.drain(); await Promise.resolve();
    }
    adm.close();
    if (polite) { assert.equal(adm.shed.cooled, 0, `polite: never cooled (${refused} refusals, ${ran} reads)`); assert.ok(refused > 0 && ran > 0, `over budget and still served: ${refused} refused, ${ran} ran`); }
    else { assert.ok(adm.shed.cooled > 0, 'impolite: cooled'); assert.equal(strikesBeforeCool, 4, 'one polite refusal, then 3 impolite → the cool-down'); }
  }
});
