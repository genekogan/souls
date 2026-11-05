// B-facade item 6: the read code over a read-only host. A ReplicaWorld fed main's stream (structured clones, as a
// MessagePort delivers them) + a read-only sqlite connection + EdgeLedger({readOnly}) answer `here` as main does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {hereFrame} from '../edge/perception/here.ts';
import {installDeltaStream, type StreamMessage} from './delta.ts';
import {worldInit} from './world-init.ts';
import {ReplicaWorld} from './replica-world.ts';
import {ReadOnlyHost, readLedger} from './read-host.ts';
import {diffFields} from './read-oracle.ts';

test('read host: here over a ReplicaWorld + read-only sqlite equals main', {timeout: 300000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'read-host-')), path = join(dir, 'sim.db');
  const f = fixture(path, factory);
  f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db);
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'read host'}));
  await settle(5);
  const tap = installDeltaStream(f.host, edge, {SIM_READ_WORKER: '1'})!;
  const RW = new ReplicaWorld(), msgs: StreamMessage[] = [];
  tap.subscribe(m => msgs.push(structuredClone(m)));
  RW.init(structuredClone(worldInit(f.host, edge, tap)));
  const H = new ReadOnlyHost(RW, f.host.worldId, path), RL = readLedger(H);
  t.after(() => {H.close(); f.brain.quiesce(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
  const flush = () => {for (const m of msgs.splice(0)) if ('t' in m || !RW.apply(m)) {msgs.length = 0; RW.init(structuredClone(worldInit(f.host, edge, tap))); break;} RL.replicaSync(RW.R.faded, RW.R.static?.places);};
  const mind = f.host.minds.get(row.id)!, soul = {soulId: row.id, entityId: mind.entityId, name: 'Mira', owner: 'dev:mira'} as never;
  flush();
  const kinds = new Set<string>();
  const compare = (what: string) => {
    const a = hereFrame(edge, soul), b = hereFrame(RL, soul), d = diffFields(a, b);
    kinds.add(String((a as {me: {activity: {kind: string; endsIn?: string}}}).me.activity.kind) + ((a as {me: {activity: {endsIn?: string}}}).me.activity.endsIn ? '+endsIn' : ''));
    assert.deepEqual(d, [], `${what}: ${JSON.stringify(d).slice(0, 2000)}`);
  };
  compare('init');
  assert.throws(() => (H.engine as {programOf(x: string): unknown}).programOf('x'), /main-only/);
  assert.throws(() => H.db.db.prepare('INSERT INTO edge_receipts_v1 (world_id) VALUES (1)').run(), /readonly|read-only/i);
  const r = await accept(f.host, edge.act(soul, {capability: 'dance', params: {seconds: 5}})) as {accepted?: boolean};
  assert.equal(r.accepted, true, JSON.stringify(r));
  for (let i = 0; i < 12; i++) {await settle(10); flush(); compare(`dance ${i}`);}
  assert.ok([...kinds].some(k => k.startsWith('dance')), `the dance showed: ${[...kinds]}`);
});

test('read worker mode 2: here, observe, capabilities (incl. ?all=1) and view?alt=only served by the worker\'s read code equal main\'s answers', {timeout: 300000}, async t => {
  const {ReadPool, deltaSource} = await import('./read-pool.ts');
  const dir = mkdtempSync(join(tmpdir(), 'read-w2-')), path = join(dir, 'sim.db');
  const f = fixture(path, factory);
  f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db);
  // as edge/routes.ts mounts it: main's comms (object offers, stream heads), which the worker's ledger reads from the db
  const {Hono} = await import('hono'), {registerEdgeComms} = await import('../edge/comms/index.ts');
  const comms = registerEdgeComms(new Hono(), {host: f.host, db: f.db, ledger: edge, souls: f.souls, soul: () => { throw new Error('unused'); }} as never, {sweepMs: 0, fetch: null} as never);
  edge.attachComms(comms);
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'worker'}));
  await settle(5);
  const source = await deltaSource(f.host, edge, {SIM_READ_WORKER: '1'});
  const forwarded: string[] = [];
  const p = new ReadPool({workers: 1, mode: 2, worldPath: '/w/eden', init: source.init, ask: source.ask, writes: source.writes, world: {dbPath: path, worldId: f.host.worldId},
    auth: token => token === 'sim_mira' ? {soulId: row.id, account: 'acct'} : {soulId: null},
    run: async fw => {forwarded.push(fw.url); return {status: 200, headers: [['content-type', 'application/json']], body: new TextEncoder().encode(JSON.stringify({main: true})).buffer as ArrayBuffer};},
    log: () => {}}).start();
  source.onDelta(d => p.delta(d), () => p.reinit());
  t.after(async () => {await p.close(); comms.close?.(); f.brain.quiesce(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
  const until = async (ok: () => boolean, ms = 60000) => {const t0 = Date.now(); while (!ok()) {if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20));}};
  await until(() => p.slots[0].ready && p.slots[0].port > 0);
  const port = p.slots[0].port, mind = f.host.minds.get(row.id)!, soul = {soulId: row.id, entityId: mind.entityId, name: 'Mira', owner: 'dev:mira'} as never;
  const get = async (route: string) => {const r = await fetch(`http://127.0.0.1:${port}/w/eden/v1/edge/${route}`, {headers: {authorization: 'Bearer sim_mira'}}); return {r, j: await r.json() as Record<string, unknown>};};
  const {planView} = await import('../edge/eyes/view.ts'), {parseViewQuery, viewSummary} = await import('../edge/eyes/routes.ts');
  // main's answers (edge/routes.ts, edge/eyes/routes.ts), computed on main's ledger at the same tick
  const mainOf: Record<string, () => Record<string, unknown>> = {
    'here': () => ({contract: 'eden-edge/1', tick: f.host.engine.world.tick, here: hereFrame(edge, soul)}),
    'observe': () => ({contract: 'eden-edge/1', ...edge.observe(soul, new Set()) as object}),
    'capabilities': () => ({contract: 'eden-edge/1', tick: f.host.engine.world.tick, ...edge.capabilitiesPage(soul, {})}),
    'capabilities?all=1': () => ({contract: 'eden-edge/1', tick: f.host.engine.world.tick, ...edge.capabilitiesPage(soul, {all: true})}),
    'view?alt=only': () => ({contract: 'eden-edge/1', ...viewSummary(planView(edge, soul, parseViewQuery(k => k === 'alt' ? 'only' : undefined))), url: null, image: 'not requested (alt=only)'}),
  };
  const check = async (what: string) => {
    for (const [route, live] of Object.entries(mainOf)) {
      await until(() => p.lagGens() === 0);
      const {r, j} = await get(route), m = live();
      assert.equal(r.headers.get('x-sim-read'), 'worker', `${what} ${route}`);
      // the header is set only when the worker's read code served it; a cheap cached page can round to 0 ms on a fast box (the Modal gate)
      assert.ok(r.headers.get('x-sim-read-cpu-ms') !== null && Number(r.headers.get('x-sim-read-cpu-ms')) >= 0, `${what} ${route}: served by the worker's read code (${JSON.stringify(j).slice(0, 300)})`);
      if (route === 'observe') {delete (j as {at?: unknown}).at; delete (m as {at?: unknown}).at;}   // the wall clock of each call
      assert.deepEqual(diffFields(m, j), [], `${what} ${route}`);
    }
  };
  await check('idle');
  const r = await accept(f.host, edge.act(soul, {capability: 'dance', params: {seconds: 5}})) as {accepted?: boolean};
  assert.equal(r.accepted, true);
  for (let i = 0; i < 4; i++) {await settle(10); await check(`dance ${i}`);}
  // a resnapshot (main's tap restarts: engine or object table replaced): the worker loads a new WorldInit and answers as
  // main again, during an act begun before it and one begun after
  source.tap.restart('test'); await settle(2); await until(() => p.slots[0].ready); await check('after resnapshot');
  const r2 = await accept(f.host, edge.act(soul, {capability: 'dance', params: {seconds: 5}})) as {accepted?: boolean};
  assert.equal(r2.accepted, true);
  for (let i = 0; i < 3; i++) {await settle(10); await check(`dance after resnapshot ${i}`);}
  const h = await (await fetch(`http://127.0.0.1:${port}/w/eden/healthz/read`)).json() as {read: {served: number; warmMs: number; fallbacks: Record<string, number>}};
  assert.equal(h.read.served, 9 * 5, JSON.stringify(h.read));
  assert.deepEqual(forwarded, [], 'nothing forwarded');
  // a picture (main's render worker) and a gaze (an attention write) are main's
  for (const q of ['view', 'view?gaze=left&alt=only']) {const {j} = await get(q); assert.deepEqual(j, {main: true}, q);}
  assert.equal(forwarded.length, 2);
});

test('read worker mode 2: here?view= is main\'s (body view answered by main\'s hereBodyFrame, a bad view gets main\'s 400)', {timeout: 300000}, async t => {
  const {ReadPool, deltaSource} = await import('./read-pool.ts');
  const {hereBodyFrame} = await import('../edge/perception/here.ts');
  const {Hono} = await import('hono'), {mountEdgeRoutes} = await import('../edge/routes.ts'), {EdgeError} = await import('../edge/contract.ts');
  const dir = mkdtempSync(join(tmpdir(), 'read-w2v-')), path = join(dir, 'sim.db');
  const f = fixture(path, factory);
  f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db);
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'worker view'}));
  await settle(5);
  const mind = f.host.minds.get(row.id)!, soul = {soulId: row.id, entityId: mind.entityId, name: 'Mira', owner: 'dev:mira'} as never;
  // main: the real edge routes (as main.ts runs a forwarded job through its app)
  const app = new Hono();
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge,
    soul: (c: {req: {header(name: string): string | undefined}}) => {if (c.req.header('authorization') !== 'Bearer sim_mira') throw new EdgeError(401, 'unauthorized', 'test token'); return soul;}} as never);
  const source = await deltaSource(f.host, edge, {SIM_READ_WORKER: '1'});
  const forwarded: string[] = [];
  const p = new ReadPool({workers: 1, mode: 2, worldPath: '/w/eden', init: source.init, ask: source.ask, writes: source.writes, world: {dbPath: path, worldId: f.host.worldId},
    auth: token => token === 'sim_mira' ? {soulId: row.id, account: 'acct'} : {soulId: null},
    run: async fw => {
      forwarded.push(fw.url);
      const r = await app.request(fw.url, {method: fw.method, headers: fw.headers});
      return {status: r.status, headers: [...r.headers.entries()], body: await r.arrayBuffer()};
    },
    log: () => {}}).start();
  source.onDelta(d => p.delta(d), () => p.reinit());
  t.after(async () => {await p.close(); comms.close(); f.brain.quiesce(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
  const until = async (ok: () => boolean, ms = 60000) => {const t0 = Date.now(); while (!ok()) {if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20));}};
  await until(() => p.slots[0].ready && p.slots[0].port > 0);
  await until(() => p.lagGens() === 0);
  const port = p.slots[0].port;
  const get = async (route: string) => {const r = await fetch(`http://127.0.0.1:${port}/w/eden/v1/edge/${route}`, {headers: {authorization: 'Bearer sim_mira'}}); return {r, j: await r.json() as Record<string, unknown>};};
  // the rich frame stays the worker's
  const rich = await get('here');
  assert.equal(rich.r.headers.get('x-sim-read'), 'worker');
  assert.match(rich.r.headers.get('x-handler-ms') ?? '', /^\d+\.\d$/, '#371 H-b: the worker times its own answer');
  assert.deepEqual(forwarded, []);
  // view=body: main answers with the body projection, not the worker's rich frame
  const body = await get('here?view=body');
  assert.equal(body.r.status, 200);
  assert.equal(body.r.headers.get('x-sim-read'), null, 'not the worker\'s own answer');
  assert.match(body.r.headers.get('x-handler-ms') ?? '', /^\d+\.\d$/, '#371 H-b: a relayed answer carries the worker\'s whole time');
  const here = body.j.here as Record<string, unknown>;
  assert.deepEqual(Object.keys(here), ['tick', 'view', 'me']);
  assert.equal(here.view, 'body');
  assert.equal(here.objects, undefined);
  assert.deepEqual(diffFields(hereBodyFrame(edge, soul) as never, here as never), []);
  // a bad view, and body with rich context: main's 400
  for (const q of ['here?view=unknown', 'here?view=body&include=doHere']) {
    const {r, j} = await get(q);
    assert.equal(r.status, 400, q);
    assert.equal((j.error as {code: string}).code, 'invalid', q);
  }
  assert.deepEqual(forwarded, ['/v1/edge/here?view=body', '/v1/edge/here?view=unknown', '/v1/edge/here?view=body&include=doHere']);
  const h = await (await fetch(`http://127.0.0.1:${port}/w/eden/healthz/read`)).json() as {read: {served: number; fallbacks: Record<string, number>}};
  assert.equal(h.read.fallbacks['here-view'], 3, JSON.stringify(h.read.fallbacks));
});
