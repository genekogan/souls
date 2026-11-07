// node --test tools/world-launcher/shed.test.mjs — lane srv-shed (LOAD-CONTRACT §2b, decision 7, Gene 2026-10-31 13:40Z):
// shedding follows the world's level, not a count; long-polls over their ceiling are held, not bounced; refusals carry
// words. Fake worlds on a free block of ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { listenTimeoutMs, soulCeilings, SOUL_CEILINGS } from './flood.mjs';
import { metricsText } from './metrics.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(8);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const soulReq = (tok, m = 'GET', ip) => ({ method: m, headers: { authorization: `Bearer sim_s_${tok}_x`, ...(ip ? { 'x-forwarded-for': ip } : {}) } });

/** Stage B mix (tools/bench/capacity/bench.mjs --load stageb): a read every 3–5 s, an act every 15–30 s, one listener
 *  per Soul, every Soul from its own address, no read workers (every read is main's: the budget's worst case). */
function stageB(c, { n, seconds, slug = 'w', level = 'green', stepMs = 50, clock, rnd = mulberry(7), sync = false }) {
  const out = { requests: 0, refused: {}, listens: [] };
  const souls = Array.from({ length: n }, (_, i) => ({ i, ip: `10.0.${i >> 8}.${i & 255}`, read: sync ? 0 : rnd() * 4000, act: sync ? 0 : rnd() * 22_500 }));
  for (const s of souls) { const l = c.check(soulReq(`s${s.i}`, 'GET', s.ip), slug, '/v1/edge/wait', true, { level }); assert.ok(l && !l.refuse && !l.hold, 'one listener per Soul is admitted'); out.listens.push(l); }
  const end = clock.t + seconds * 1000;
  for (; clock.t < end; clock.t += stepMs) {
    for (const s of souls) {
      for (const [k, path, m, every] of [['read', '/v1/edge/here', 'GET', () => 3000 + rnd() * 2000], ['act', '/v1/edge/act', 'POST', () => 15_000 + rnd() * 15_000]]) {
        if (clock.t < s[k]) continue;
        s[k] = clock.t + every(); out.requests++;
        const r = c.check(soulReq(`s${s.i}`, m, s.ip), slug, path, true, { level });
        if (r?.refuse) { const key = `${r.refuse.body.code}/${r.refuse.body.limit?.scope}`; out.refused[key] = (out.refused[key] ?? 0) + 1; } else r?.release();
      }
    }
  }
  out.listens.forEach((l) => l.release());
  return out;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('N=100 Stage B mix at the shipped defaults: the world budget never trips (it is a safety ceiling; the level sheds first)', () => {
  const clock = { t: 0 }, c = soulCeilings({ now: () => clock.t, log: () => {} });
  const r = stageB(c, { n: 100, seconds: 600, clock });
  console.log(`# stageb N=100, 600 s, no read workers: ${r.requests} heavy requests (${(r.requests / 600).toFixed(1)}/s vs budget ${SOUL_CEILINGS.worldBudgetRps}/s), refused ${JSON.stringify(r.refused)}`);
  assert.deepEqual(r.refused, {});
  // the worst burst: every Soul reads and acts in the same 50 ms (a reconnect wave after a restart): 200 at once, within the 2 s burst
  const w = stageB(c, { n: 100, seconds: 1, clock, sync: true, slug: 'w2' });
  assert.deepEqual(w.refused, {}, 'a synchronised wave of 100 Souls');
  // where it would first trip (sustained): the budget is 200/s, the mix ~0.3/s per Soul, so a few hundred Souls more than N=100
  const trips = [300, 600, 800].map((n) => { const cl = { t: 0 }, cc = soulCeilings({ now: () => cl.t, log: () => {} }); return [n, stageB(cc, { n, seconds: 120, clock: cl, stepMs: 100 }).refused['world.busy/world'] ?? 0]; });
  console.log(`# stageb: budget refusals in 120 s by N: ${trips.map(([n, k]) => `N=${n}: ${k}`).join(', ')}`);
  assert.equal(trips[0][1], 0, 'N=300 is still under the budget');
});

test('listen holds: over the ceiling it waits for a slot (served on release), refused only after the hold or at once at red/black', async () => {
  const c = soulCeilings({ log: () => {}, limitsFor: () => ({ soulListen: 1, listenHoldMs: 300, listenHeldMax: 2 }) });
  const listen = (tok, opts = {}) => c.check(soulReq(tok), 'w', '/v1/edge/inbox/listen', false, { deadlineMs: 25_000, ...opts });
  const a = listen('a'); assert.ok(a.cls === 'listen' && !a.hold);
  const b = listen('a'); assert.ok(b.hold, 'held, not refused');
  const pb = b.hold(); await sleep(40); a.release();
  const got = await pb; assert.ok(got && !got.refuse && got.cls === 'listen', 'served once the slot freed');
  // nothing frees: refused after the hold, with words and retryAfterMs; the code stays soul.busy
  const s0 = performance.now(), late = await listen('a').hold(), waited = performance.now() - s0;
  assert.equal(late.refuse.status, 429); assert.equal(late.refuse.body.code, 'soul.busy');
  assert.ok(waited >= 280 && waited < 1000, `${waited} ms`);
  assert.match(late.refuse.body.message, /^This Soul already holds 1 listening connections .*wait 5 s/); assert.equal(late.refuse.body.retryAfterMs, 5000);
  // at red/black: refused at once (no hold)
  for (const level of ['red', 'black']) { const r = listen('a', { level }); assert.equal(r.refuse?.body.code, 'soul.busy', level); assert.match(r.refuse.body.message, new RegExp(`very busy: ${level}`)); }
  // at most listenHeldMax held at once per world: past it, refused at once
  const h1 = listen('a').hold(), h2 = listen('a').hold(), third = listen('a');
  assert.equal(third.refuse?.body.code, 'soul.busy');
  got.release(); const one = await Promise.race([h1, h2]); assert.ok(one && !one.refuse); one.release();
  await Promise.all([h1, h2]).then((xs) => xs.forEach((x) => x.release?.()));
  // the client hung up while held: answered with nothing, counted as gone
  const keep = listen('a'); assert.ok(!keep.hold); const g = await listen('a').hold(() => true); assert.equal(g, null); keep.release();
  const st = c.held('w');
  assert.equal(st.served, 3); assert.equal(st.refused, 1); assert.equal(st.gone, 1); assert.equal(st.ended, 5); assert.equal(st.now, 0); assert.ok(st.seconds > 0.3);
  assert.equal(c.refused('w')['soul.busy'], 4, 'after the hold, red, black, past the held cap');
  // metrics
  const m = metricsText({ worlds: [{ slug: 'w', status: 'running', listenHeld: st }] });
  assert.match(m, /sim_world_listen_held_total\{world="w",outcome="served"\} 3/); assert.match(m, /sim_world_listen_held_seconds_count\{world="w"\} 5/);
  assert.match(m, /# TYPE sim_world_listen_held_seconds summary\nsim_world_listen_held_seconds_sum\{world="w"\} /);
});

test('listen holds: the oldest listener on the key is released first once it is past its own deadline (+5 s grace)', async () => {
  let t = 0; const c = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ soulListen: 2, listenHoldMs: 500 }) });
  const evicted = [];
  const listen = (name, deadlineMs, onEvict) => { const r = c.check(soulReq('k'), 'w', '/v1/edge/wait', false, { deadlineMs, evict: () => { evicted.push(name); onEvict?.(); } }); return r; };
  const old = listen('old', 1000, () => setTimeout(() => old.release(), 20)), young = listen('young', 55_000);
  t += 3000;   // old asked for 1 s: past its deadline only after its 5 s grace
  const early = listen('x', 25_000); assert.ok(early.hold); assert.deepEqual(evicted, []);
  t += 3500;   // 6.5 s: old is past 1 s + 5 s; young is not
  const r = await early.hold(); assert.ok(r && !r.refuse, JSON.stringify(r?.refuse?.body)); assert.deepEqual(evicted, ['old']);
  // a listener released synchronously frees its slot within the same check
  const c2 = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ soulListen: 1 }) });
  const first = c2.check(soulReq('q'), 'w', '/v1/edge/inbox/listen', false, { deadlineMs: 0, evict: () => first.release() });
  t += 6000; const next = c2.check(soulReq('q'), 'w', '/v1/edge/inbox/listen', false, { deadlineMs: 25_000 }); assert.ok(next && !next.hold && !next.refuse);
  young.release(); r.release(); next.release();
  assert.equal(listenTimeoutMs('/v1/edge/wait', '?timeout=10'), 10_000); assert.equal(listenTimeoutMs('/v1/edge/wait', ''), 25_000);
  assert.equal(listenTimeoutMs('/v1/edge/inbox/listen', '?timeoutMs=50000'), 50_000); assert.equal(listenTimeoutMs('/v1/edge/inbox/listen', '?timeoutMs=999999'), 55_000);
});

test('refusals carry words: every ceiling refusal has a message a person can read and retryAfterMs; the codes are kept', () => {
  let t = 0; const c = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ ipPer10s: 1, worldBudgetRps: 1, accountHeavyPerMin: 4, listenHoldMs: 0, soulListen: 1 }) });
  const bodies = [];
  c.check(soulReq('a', 'GET', '1.1.1.1'), 'w', '/v1/edge/receipts/r', true).release(); bodies.push(c.check(soulReq('a', 'GET', '1.1.1.1'), 'w', '/v1/edge/receipts/r', true).refuse.body);
  c.check(soulReq('b', 'POST'), 'w', '/v1/edge/act', false).release(); c.check(soulReq('c', 'POST'), 'w', '/v1/edge/act', false).release(); bodies.push(c.check(soulReq('d', 'POST'), 'w', '/v1/edge/act', false).refuse.body);
  t += 10_000; const l = c.check(soulReq('e'), 'w', '/v1/edge/wait', false); bodies.push(c.check(soulReq('e'), 'w', '/v1/edge/wait', false).refuse.body); l.release();
  t += 10_000; for (let i = 0; i < 2; i++) c.check(soulReq(`f${i}`), 'w2', '/v1/edge/here', false).release(); bodies.push(c.check(soulReq('f2'), 'w2', '/v1/edge/here', false).refuse.body);
  bodies.push(c.chargeWorld('w2').refuse.body);
  assert.deepEqual(bodies.map((b) => b.code), ['client.rate', 'world.busy', 'soul.busy', 'world.busy', 'world.busy']);
  for (const b of bodies) {
    assert.ok(/^[A-Z][^;]+ (wait|slow down for) \d+ s/.test(b.message), b.message);
    assert.ok(Number.isInteger(b.retryAfterMs) && b.retryAfterMs >= 1000 && b.retry_after >= 1, JSON.stringify(b));
    assert.ok(b.limit?.scope, JSON.stringify(b));
  }
});

function launcherWith(P, range, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'srv-shed-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), FAKE_EDGE: '1' } });
  return openLauncher({ port: P, range, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false, publicOrigin: 'http://sim.test', devAuth: true, ...extra });
}

test('through the launcher: 20 polite Souls at green are never refused nor slowed; 100 Souls (Stage B mix): amber hints, red refuses C2 by level, the budget never', async () => {
  const P = P0, base = `http://127.0.0.1:${P}`;
  const L = await launcherWith(P, [P0 + 1, P0 + 3]);
  const listens = [];
  try {
    const { slug } = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Shedder' }) })).json();
    await (await fetch(`${base}/w/${slug}/v1/config`)).arrayBuffer();
    const setLevel = async (l) => { await (await fetch(`${base}/w/${slug}/level?l=${l}`)).arrayBuffer(); await (await fetch(`${base}/w/${slug}/healthz`)).arrayBuffer(); };
    const call = (i, path, method = 'GET') => fetch(`${base}/w/${slug}${path}`, { method, headers: { authorization: `Bearer sim_s_soul${i}_secret`, 'x-forwarded-for': `198.51.${i >> 8}.${i & 255}` } })
      .then(async (r) => ({ path, status: r.status, hint: r.headers.get('x-sim-hint'), body: r.status >= 400 && r.status !== 404 ? await r.json().catch(() => null) : (await r.arrayBuffer(), null) }));
    /** n Souls, each with one listener, then the Stage B mix (a read every 3–5 s, an act every 15–30 s) for `ms`. */
    const phase = async (n, ms, from = 0) => {
      const out = [], t0 = Date.now(), rnd = mulberry(n + ms);
      await Promise.all(Array.from({ length: n }, async (_, k) => {
        const i = from + k; let nextRead = rnd() * 3000, nextAct = rnd() * 15_000;
        while (Date.now() - t0 < ms) {
          const at = Date.now() - t0;
          if (at >= nextRead) { out.push(await call(i, '/v1/edge/here')); nextRead = at + 3000 + rnd() * 2000; }
          else if (at >= nextAct) { out.push(await call(i, '/v1/edge/act', 'POST')); nextAct = at + 15_000 + rnd() * 15_000; }
          else await sleep(Math.min(nextRead, nextAct) - at);
        }
      }));
      return out;
    };
    const listen = (i) => { listens.push(fetch(`${base}/w/${slug}/v1/edge/inbox/listen?timeoutMs=50000`, { headers: { authorization: `Bearer sim_s_soul${i}_secret`, 'x-forwarded-for': `198.51.${i >> 8}.${i & 255}` } }).then((r) => r.status).catch(() => 'closed')); };
    // (a) 20 polite Souls at green: never refused, never slowed
    for (let i = 0; i < 20; i++) listen(i);
    const polite = await phase(20, 5000);
    assert.ok(polite.length >= 20, `${polite.length} calls`);
    assert.ok(polite.every((r) => r.status === 404 || r.status === 200), JSON.stringify(polite.find((r) => r.status !== 404 && r.status !== 200)));
    assert.ok(polite.every((r) => !r.hint), 'no slow-down hint at green');
    // (b) 100 Souls at green, amber, red
    for (let i = 20; i < 100; i++) listen(i);
    const green = await phase(100, 4000);
    await setLevel('amber'); const amber = await phase(100, 4000);
    await setLevel('red'); const red = await phase(100, 4000);
    const reads = (rs) => rs.filter((r) => r.path === '/v1/edge/here'), acts = (rs) => rs.filter((r) => r.path === '/v1/edge/act');
    const refused = (rs) => rs.filter((r) => r.status === 429 || r.status === 503);
    console.log(`# launcher stageb: polite 20 -> ${polite.length} calls, 0 refused; N=100 green ${green.length} (${refused(green).length} refused), amber ${amber.length} (${refused(amber).length} refused, ${reads(amber).filter((r) => r.hint).length}/${reads(amber).length} reads hinted), red ${red.length} (${refused(red).length} refused: ${[...new Set(refused(red).map((r) => `${r.body?.code}/${r.body?.limit?.scope}`))]})`);
    assert.equal(refused(green).length, 0); assert.ok(green.every((r) => !r.hint));
    assert.equal(refused(amber).length, 0, 'amber: served');
    assert.ok(reads(amber).length > 0 && reads(amber).every((r) => r.hint === 'soul.slow-down'), 'amber: every C2 read carries the hint');
    assert.ok(acts(amber).every((r) => !r.hint), 'amber: acts carry no hint');
    assert.ok(reads(red).length > 0 && reads(red).every((r) => r.status === 503 && r.body?.code === 'world.busy' && r.body.limit?.scope === 'load:red'), `red: C2 refused by the level: ${JSON.stringify(reads(red).filter((r) => r.body?.limit?.scope !== 'load:red'))}`);
    assert.ok(reads(red).every((r) => /^The world is very busy \(red\)/.test(r.body.message) && r.body.retryAfterMs === 2000));
    assert.ok(acts(red).every((r) => r.status === 404), 'red: C1 still goes to the world');
    assert.ok(![...polite, ...green, ...amber, ...red].some((r) => r.body?.limit?.scope === 'world'), 'the world budget never tripped');
    // healthz (public): the refusals by world and code, for sim-watch
    const h = await (await fetch(`${base}/__sim/healthz`, { headers: { 'x-forwarded-for': '203.0.113.5' } })).json();
    assert.equal(h.refused[slug]['world.busy'], reads(red).length); assert.equal(h.refused[slug]['client.rate'], undefined);
    await setLevel('green');
  } finally {
    // the 100 listens are still open: their GETs are retried when the world stops under them, and a closing launcher
    // must not boot it again (it did: an orphan world no one stopped)
    await L.close(); await Promise.all(listens); await sleep(500);
    assert.ok([...L.pool.kids.values()].every((k) => !['starting', 'running'].includes(k.status)), JSON.stringify([...L.pool.kids.values()].map((k) => k.status)));
  }
});

test('through the launcher: a listen over its ceiling is held and served when the stale listener is released; at red it is refused at once', async () => {
  const P = P0 + 4, base = `http://127.0.0.1:${P}`;
  const L = await launcherWith(P, [P0 + 5, P0 + 7], { soulLimits: { soulListen: 1 } });
  try {
    const { slug } = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Holder' }) })).json();
    await (await fetch(`${base}/w/${slug}/v1/config`)).arrayBuffer();
    const H = { authorization: 'Bearer sim_s_held_secret', 'x-forwarded-for': '203.0.113.20' };
    // A asks for timeoutMs=0 (a peek) but the fake world holds every listen 30 s: past its deadline 5 s later
    const a = fetch(`${base}/w/${slug}/v1/edge/inbox/listen?timeoutMs=0`, { headers: H }).then((r) => r.status, (e) => `closed:${e.cause?.code ?? e.name}`);
    await sleep(600);
    const bc = new AbortController(), t0 = performance.now();
    const b = fetch(`${base}/w/${slug}/v1/edge/inbox/listen?timeoutMs=25000`, { headers: H, signal: bc.signal }).then((r) => r.status, () => 'aborted');
    const aEnd = await a, released = performance.now() - t0;
    assert.match(String(aEnd), /^closed/, 'the stale listener was released');
    assert.ok(released > 3500 && released < 5300, `${released} ms`);
    await sleep(200);
    const m = await (await fetch(`${base}/__sim/metrics`)).text();
    assert.match(m, new RegExp(`sim_world_listen_held_total\\{world="${slug}",outcome="served"\\} 1`));
    // at red a third listen over the ceiling is refused at once (B holds the slot)
    await (await fetch(`${base}/w/${slug}/level?l=red`)).arrayBuffer(); await (await fetch(`${base}/w/${slug}/healthz`)).arrayBuffer();
    const s0 = performance.now(), r = await fetch(`${base}/w/${slug}/v1/edge/inbox/listen?timeoutMs=25000`, { headers: H }), ms = performance.now() - s0, body = await r.json();
    assert.equal(r.status, 429); assert.equal(body.code, 'soul.busy'); assert.ok(ms < 50, `${ms} ms`); assert.equal(body.retryAfterMs, 5000); assert.match(body.message, /very busy: red/);
    bc.abort(); await b;
  } finally { await L.close(); }
});
