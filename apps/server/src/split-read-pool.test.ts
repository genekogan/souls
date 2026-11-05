// Stage B (lane B-port): the read-worker pool without a world — workers, ports, health, lag, the subset answers, token
// lookups, forwards into Admission over the MessagePort (closed() through the port), respawn, pool size 1→4, and the
// live.json fields (absent when there is no pool: flag off is byte-identical).
import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadPool, readPorts} from './split/read-pool.ts';
import {Admission} from './load/admission.ts';
import {liveOf, newSharedLoad, S} from './load/shared.ts';
import type {WorldInit} from './split/read-model.ts';
import {SECURITY_HEADERS} from './security-headers.ts';

const human = (id: string, x: number) => ({id, kind: 'human', pose: {p: [x, 0, 0], yaw: 0}, human: {}});
const init = (tick = 7): WorldInit => ({v: 1, gen: 1, seq: 0, tick, logSeq: 0, entities: {ent1: human('ent1', 0), ent2: human('ent2', 5)}, env: {}, living: null,
  static: {epoch: 'e1', places: [], shells: {}, solids: [], fires: [{id: 'fire1', name: 'campfire', at: [3, 0]}], regions: [], spots: []},
  minds: [{soulId: 's1', entityId: 'ent1', name: 'A', owner: 'o', native: false}, {soulId: 's2', entityId: 'ent2', name: 'B', owner: 'o', native: false}], faded: [], receipts: [], programs: [], holds: [],
  objects: {gen: 0, records: []}, items: [], togetherVersion: 0, menuInputs: [], scene: null, sceneKey: '', pages: null, navReady: false});
const TOKENS: Record<string, string> = {sim_a: 's1', sim_b: 's2'};
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw Error('timed out'); await new Promise(r => setTimeout(r, 10)); } };
const get = async (port: number, path: string, token?: string, init: RequestInit = {}) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, {...init, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(init.headers ?? {})}}); return {status: r.status, headers: r.headers, body: await r.json().catch(() => null) as Record<string, unknown> | null}; };

function pool(o: Partial<ConstructorParameters<typeof ReadPool>[0]> = {}) {
  const shared = newSharedLoad(), runs: {method: string; url: string; body: string}[] = [];
  const p = new ReadPool({workers: 1, worldPath: '/w/test', shared, init: () => init(), auth: (t) => ({soulId: TOKENS[t] ?? null, account: TOKENS[t] ? 'acct-' + TOKENS[t] : null}),
    run: async (f) => { runs.push({method: f.method, url: f.url, body: f.body ? Buffer.from(f.body).toString() : ''}); const b = Buffer.from(JSON.stringify({from: 'main', url: f.url})); return {status: 200, headers: [['content-type', 'application/json'], ['x-from', 'main']], body: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer}; },
    log: () => {}, respawnMs: 50, ...o});
  return {p, shared, runs};
}
const ready = (p: ReadPool, n = p.size) => until(() => p.slots.filter(s => s.ready && s.port > 0).length === n);

test('flag off: live.json has no read fields (byte-identical to the release before)', () => {
  const a = newSharedLoad(), j = liveOf(a, 1, 1000);
  assert.equal('readPort' in j, false); assert.equal('read' in j, false);
  assert.deepEqual(Object.keys(j), ['v', 'pid', 'at', 'phase', 'loop', 'heap', 'level', 'shed', 'boot']);
});

test('one worker: health, subset answers by token, lag, live.json advertises readPort', async () => {
  const {p, shared} = pool(); p.start();
  try {
    await ready(p);
    const port = p.slots[0].port, h = await get(port, '/w/test/healthz/read');
    assert.equal(h.status, 200); assert.equal(h.body!.tick, 7); assert.equal(h.body!.subset, true); assert.equal(h.body!.lagGens, 0);
    const here = await get(port, '/w/test/v1/edge/here', 'sim_a');
    assert.equal(here.status, 200); assert.equal(here.headers.get('x-sim-read'), 'worker'); assert.equal(here.headers.get('x-sim-account'), 'acct-s1');
    assert.deepEqual(here.body!.here, {me: {pos: [0, 0]}, near: [{id: 's2', dist: 5}], things: [{kind: 'fire', id: 'fire1', dist: 3}]});
    assert.equal(here.body!.subset, true);
    const caps = await get(port, '/v1/edge/capabilities', 'sim_b');
    assert.deepEqual((caps.body!.capabilities as {id: string}[]).map(c => c.id), ['face:s1', 'go-near:s1', 'warm-by-fire:fire1', 'wave:s1']);
    assert.equal(p.stats.auths, 2);
    await get(port, '/v1/edge/here', 'sim_a'); assert.equal(p.stats.auths, 2, 'a token is looked up once, then cached');
    // deltas move the replica; lag is gens behind main
    p.delta({v: 1, gen: 1, seq: 1, tick: 8, logSeq: 0, bodies: [['ent2', 1, 0, 0, 0]]});
    await until(() => p.lagGens() === 0 && p.lag[1] === p.gen);
    await until(() => shared[S.readLagGens] === 0);   // republished every 250 ms
    const near = await get(port, '/v1/edge/here', 'sim_a');
    assert.equal(near.body!.tick, 8); assert.deepEqual(near.body!.here && (near.body!.here as {near: unknown}).near, [{id: 's2', dist: 1}]);
    const j = liveOf(shared, 1, Date.now());
    assert.equal(j.readPort, port); assert.deepEqual(j.read, {ports: [port], workers: 1, lagGens: 0, subset: true, routes: ['here', 'capabilities']});
  } finally { await p.close(); }
});

test('what the worker does not serve goes to main over the MessagePort, through Admission', async () => {
  const adm = new Admission(), {p, runs} = pool({admission: adm}); p.start();
  try {
    await ready(p); const port = p.slots[0].port;
    // a C1 by mistake: forwarded, body and all; a query the subset does not serve; an unknown token
    const act = await get(port, '/w/test/v1/edge/act', 'sim_a', {method: 'POST', body: JSON.stringify({capability: 'wave:s2'}), headers: {'content-type': 'application/json'}});
    assert.equal(act.status, 200); assert.equal(act.headers.get('x-from'), 'main'); assert.equal(act.body!.url, '/v1/edge/act');
    await get(port, '/v1/edge/here?include=doHere', 'sim_a');
    await get(port, '/v1/edge/here', 'sim_nobody');
    await get(port, '/v1/edge/observe', 'sim_a');
    assert.deepEqual(runs.map(r => `${r.method} ${r.url}`), ['POST /v1/edge/act', 'GET /v1/edge/here?include=doHere', 'GET /v1/edge/here', 'GET /v1/edge/observe']);
    assert.equal(runs[0].body, '{"capability":"wave:s2"}');
    assert.equal(p.stats.jobs[0].jobs, 4);
    // Admission's rules apply to forwarded jobs: a second request from the same Soul while one is out is soul.busy
    adm.outstanding.add('soul:sim_a');
    const busy = await get(port, '/v1/edge/act', 'sim_a', {method: 'POST', body: '{}'});
    assert.equal(busy.status, 429); assert.equal((busy.body!.error as {code: string}).code, 'soul.busy');
    adm.outstanding.delete('soul:sim_a');
  } finally { adm.close(); await p.close(); }
});

test('the worker\'s own answers carry the shared security headers; a forwarded answer keeps main\'s headers (#1025)', async () => {
  const adm = new Admission(), {p} = pool({admission: adm}); p.start();
  const secure = (h: Headers, why: string) => { for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(h.get(name), value, `${why}: ${name}`); };
  try {
    await ready(p); const port = p.slots[0].port;
    secure((await get(port, '/w/test/healthz/read')).headers, 'health');
    const here = await get(port, '/w/test/v1/edge/here', 'sim_a'); assert.equal(here.headers.get('x-sim-read'), 'worker'); secure(here.headers, 'subset read');
    secure((await get(port, '/v1/edge/capabilities', 'sim_b')).headers, 'subset capabilities');
    adm.outstanding.add('soul:sim_a');
    const busy = await get(port, '/v1/edge/act', 'sim_a', {method: 'POST', body: '{}'});
    assert.equal(busy.status, 429); secure(busy.headers, 'refusal');
    adm.outstanding.delete('soul:sim_a');
    // Main's answer is relayed as it is: main's app sets these headers itself (buildApp); the worker adds none.
    const fwd = await get(port, '/v1/edge/observe', 'sim_a');
    assert.equal(fwd.headers.get('x-from'), 'main'); assert.equal(fwd.headers.get('x-frame-options'), null);
  } finally { adm.close(); await p.close(); }
});

test('closed() through the port: a queued job whose client hung up is dropped, never run', async () => {
  const adm = new Admission(); adm.setLoadLevel('black');   // black: an act waits in the queue (budget 0) until its deadline
  const {p, runs} = pool({admission: adm}); p.start();
  try {
    await ready(p); const port = p.slots[0].port;
    const ac = new AbortController(), r = fetch(`http://127.0.0.1:${port}/v1/edge/act`, {method: 'POST', body: '{}', headers: {authorization: 'Bearer sim_b'}, signal: ac.signal}).catch(e => e);
    await until(() => adm.queue.length === 1);
    ac.abort(); await r;
    await until(() => adm.queue.length === 0, 3000);
    assert.equal(runs.length, 0, 'the abandoned job never ran'); assert.equal(adm.shed.dropped, 1);
    await until(() => p.stats.jobs[0].dropped === 1);
    assert.equal(adm.outstanding.size, 0);
  } finally { adm.close(); await p.close(); }
});

test('pool size 1→4, ports from SIM_READ_PORTS, respawn after a worker dies (fresh init to all)', async () => {
  assert.deepEqual(readPorts('5231, 5232,x,0'), [5231, 5232]);
  const {p, shared} = pool({workers: 9}); assert.equal(p.size, 4);
  p.start();
  try {
    await ready(p, 4);
    assert.equal(new Set(p.slots.map(s => s.port)).size, 4);
    assert.equal(liveOf(shared, 1, Date.now()).read!.workers, 4);
    for (const s of p.slots) assert.equal((await get(s.port, '/v1/edge/here', 'sim_a')).body!.tick, 7);
    const inits = p.stats.inits; await p.slots[2].worker!.terminate();
    await until(() => !p.slots[2].alive);
    assert.equal(liveOf(shared, 1, Date.now()).read!.workers, 3, 'a dead worker is not advertised');
    await ready(p, 4);
    assert.equal(p.slots[2].restarts, 1); assert.equal(p.stats.inits, inits + 1);
    assert.equal(liveOf(shared, 1, Date.now()).read!.ports.length, 4);
  } finally { await p.close(); }
  assert.equal(shared[S.readMode], 0); assert.equal('read' in liveOf(shared, 1, Date.now()), false, 'closed: nothing advertised');
});
