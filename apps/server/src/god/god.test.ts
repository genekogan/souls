import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { coreRef } from '@souls/world-compiler';
import { GodMode, type WorldDiffMessage } from './god.ts';
import { mountGodRoutes } from './routes.ts';

function fixture(dbFile = ':memory:') {
  const db = new Db(dbFile);
  const emitted: WorldDiffMessage[] = [];
  let tick = 100;
  const god = new GodMode(db, { worldId: 'hello-1', ownerId: null, tick: () => tick++, emit: (m) => emitted.push(m) });
  const app = new Hono();
  const users: Record<string, { id: string; role: 'user' | 'admin' }> = { 'dev:gene': { id: 'dev:gene', role: 'user' }, 'dev:other': { id: 'dev:other', role: 'user' } };
  mountGodRoutes(app, {
    god, worldName: 'Hello',
    requireUser: async (c: Context) => { const t = c.req.header('authorization')?.replace(/^Bearer\s+/i, ''); const u = t ? users[t] : undefined; if (!u) throw new ApiError(401, 'unauthorized', 'sign in'); return { ...u, email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null }; },
    soulFromBearer: (c) => (c.req.header('authorization') === 'Bearer sim_s1_x' ? { id: 's_1', name: 'Ada' } : null),
    baseOf: () => 'http://localhost:4990/w/hello',
    limitIp: () => {},
  });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const req = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const r = await app.request(path, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
    const text = await r.text(); let data: unknown; try { data = JSON.parse(text); } catch { data = text; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: r.status, data: data as any, headers: r.headers };
  };
  return { db, god, app, req, emitted };
}

test('pairing: start → owner approves in the browser → poll yields a god token; strangers cannot approve; first approver owns the world', async () => {
  const f = fixture();
  const start = await f.req('/v1/god/pair/start', { body: { agent: 'claude code' } });
  assert.equal(start.status, 200);
  const { user_code, poll_token, approve_url } = start.data as { user_code: string; poll_token: string; approve_url: string };
  assert.ok(approve_url.endsWith(`/#godpair/${user_code}`));
  assert.equal((await f.req('/v1/god/pair/poll', { body: { poll_token } })).data.status, 'pending');
  const info = await f.req(`/v1/god/pair/${user_code}`, { token: 'dev:gene' });
  assert.equal(info.data.agent, 'claude code');
  assert.equal((await f.req('/v1/god/pair/approve', { body: { code: user_code }, token: 'dev:gene' })).status, 200);
  const poll = await f.req('/v1/god/pair/poll', { body: { poll_token } });
  assert.equal(poll.data.status, 'approved');
  assert.ok(String(poll.data.token).startsWith('god_hello-1_'));
  assert.equal(f.god.owner, 'dev:gene');
  // a second agent: another user may not approve now
  const s2 = await f.req('/v1/god/pair/start', { body: {} });
  assert.equal((await f.req('/v1/god/pair/approve', { body: { code: s2.data.user_code }, token: 'dev:other' })).status, 403);
  assert.equal((await f.req('/v1/god/snapshot')).status, 401);
  assert.equal((await f.req('/v1/god/snapshot', { token: poll.data.token })).status, 200);
});

test('hello world over HTTP: build, read as a viewer, undo/redo, persistence across a restart', async () => {
  const f = fixture();
  const token = (await f.req('/v1/god/mint', { body: { label: 'test' }, token: 'dev:gene' })).data.token as string;
  const empty = await f.req('/v1/world/snapshot');
  assert.equal(empty.data.entities.length, 0);
  assert.equal(empty.data.constants.extent, 1000);
  const ground = await f.req('/v1/world/ground');
  assert.ok(Object.keys(ground.data.tiles).length === 256, 'a 1 km world is 16×16 tiles');
  const dry = await f.req('/v1/god/dryrun', { token, body: { ops: [{ op: 'place', def: coreRef('mountain'), name: 'east', shape: { path: [[300, -200], [340, 220]], width: 140 } }] } });
  assert.equal(dry.data.accepted, true);
  assert.equal(f.god.model.entities.size, 0, 'dry run places nothing');
  const built = await f.req('/v1/god/act', { token, body: { ops: [
    { op: 'place', def: coreRef('mountain'), name: 'east-range', shape: { path: [[300, -200], [340, 220]], width: 140 } },
    { op: 'place', def: coreRef('lake'), name: 'west-lake', shape: { area: [[-260, -40], [-180, -90], [-150, 10], [-230, 60]] } },
    { op: 'place', def: coreRef('knoll'), name: 'knoll', p: [40, 10] },
    { op: 'place', tmp: '$c', def: coreRef('cottage'), name: 'cottage', p: [48, 10], r: 1.2 },
    { op: 'place', def: coreRef('bench'), name: 'bench', in: { parent: '$c' }, p: [0, 0, 5] },
  ], note: 'hello world' } });
  assert.equal(built.data.accepted, true, JSON.stringify(built.data));
  assert.equal(f.emitted.length, 1, 'one diff to viewers');
  assert.equal(f.emitted[0].diff.upserts.length, 5);
  assert.ok(f.emitted[0].diff.tiles.length > 0, 'tiles invalidated');
  const snap = await f.req('/v1/world/snapshot');
  assert.equal(snap.data.entities.length, 5);
  assert.ok(snap.data.defs.some((d: { ref: string }) => d.ref === 'core-cottage@1'), 'defs in use are public');
  assert.ok(!('library' in snap.data));
  const ent = await f.req('/v1/world/entities/cottage/bench');
  assert.equal(ent.data.path, 'cottage/bench');
  const tile = await f.req('/v1/world/tiles/5/0');
  assert.equal(tile.status, 200); assert.equal(tile.headers.get('x-tile-n'), '65');
  const wrongTile = await f.req('/v1/world/tiles/40/0'); assert.equal(wrongTile.status, 404);
  // recolor + move + undo + redo
  assert.equal((await f.req('/v1/god/act', { token, body: { ops: [{ op: 'set', id: 'cottage', state: { paint: '#3366cc' } }] } })).data.accepted, true);
  assert.equal(f.god.model.get('cottage')!.state!.paint, '#3366cc');
  const undo = await f.req('/v1/god/undo', { method: 'POST', token });
  assert.equal(undo.data.accepted, true); assert.equal(undo.data.reverted, 2);
  assert.equal(f.god.model.get('cottage')!.state!.paint, '#f1e7d2');
  const redo = await f.req('/v1/god/redo', { method: 'POST', token });
  assert.equal(redo.data.accepted, true);
  assert.equal(f.god.model.get('cottage')!.state!.paint, '#3366cc');
  const edits = await f.req('/v1/god/edits', { token });
  assert.deepEqual(edits.data.edits.map((e: { kind: string }) => e.kind), ['redo', 'undo', 'edit', 'edit']);
  // restart: a fresh GodMode on the same db sees the same world
  let tick = 500;
  const again = new GodMode(f.db, { worldId: 'hello-1', ownerId: null, tick: () => tick++, emit: () => {} });
  assert.equal(again.model.entities.size, 5);
  assert.equal(again.model.get('cottage/bench')!.in.parent, again.model.get('cottage')!.id);
  assert.equal(again.model.terrain.sample(320, 0), f.god.model.terrain.sample(320, 0));
  assert.equal(again.owner, 'dev:gene');
  assert.ok(again.godFromToken(token), 'tokens persist');
  assert.equal(again.store.undoable()!.seq, 4);
});

test('prayers: a Soul prays, the god sees it on the stream and answers; rate limited; constitution is public markdown', async () => {
  const f = fixture();
  const token = (await f.req('/v1/god/mint', { body: {}, token: 'dev:gene' })).data.token as string;
  const seen: unknown[] = [];
  const unsub = f.god.subscribe(0, (e) => seen.push(e));
  assert.equal((await f.req('/v1/god/pray', { body: { text: 'a fountain please' } })).status, 401);
  const prayed = await f.req('/v1/god/pray', { body: { text: 'a fountain please' }, token: 'sim_s1_x' });
  assert.equal(prayed.status, 200);
  const id = prayed.data.prayer.id as string;
  assert.ok(seen.some((e) => (e as { event: string }).event === 'prayer'));
  const list = await f.req('/v1/god/prayers', { token });
  assert.equal(list.data.prayers.length, 1);
  const answered = await f.req('/v1/god/act', { token, body: { ops: [{ op: 'place', def: coreRef('fountain'), name: 'fountain', p: [0, 0] }, { op: 'answer', prayer: id, text: 'Granted. Look by the knoll.' }] } });
  assert.equal(answered.data.accepted, true);
  const mine = await f.req('/v1/god/prayers/mine', { token: 'sim_s1_x' });
  assert.equal(mine.data.prayers[0].answer, 'Granted. Look by the knoll.');
  assert.equal((await f.req('/v1/god/prayers', { token })).data.prayers.length, 0, 'answered prayers leave the queue');
  for (let i = 0; i < 3; i++) await f.req('/v1/god/pray', { body: { text: 'more' }, token: 'sim_s1_x' });
  assert.equal((await f.req('/v1/god/pray', { body: { text: 'more' }, token: 'sim_s1_x' })).status, 429);
  await f.req('/v1/god/act', { token, body: { ops: [{ op: 'world', state: { constitution: '# Hello world\nThree prayers a day are heard.' } }] } });
  const con = await f.req('/v1/world/constitution');
  assert.ok(String(con.data).startsWith('# Hello world'));
  unsub();
});

test('contract endpoints: schema, query (terrain, entity, free plots, clearance), preview, grouped undo, onCommit order', async () => {
  const f = fixture();
  const token = (await f.req('/v1/god/mint', { body: {}, token: 'dev:gene' })).data.token as string;
  const seen: number[] = []; f.god.onCommit((c) => seen.push(c.seq));
  const schema = await f.req('/v1/god/schema');
  assert.equal(schema.data.contract, 'god-schema/1');
  assert.ok(schema.data.generators.some((g: { id: string }) => g.id === 'building/1'));
  assert.ok(schema.data.kit.primitives.includes('capsule'));
  await f.req('/v1/god/act', { token, body: { ops: [{ op: 'place', def: coreRef('knoll'), name: 'knoll', p: [0, 0], params: { height: 5, radius: 20 } }, { op: 'place', def: coreRef('cottage'), name: 'c', p: [30, 0] }], group: 'hamlet' } });
  await f.req('/v1/god/act', { token, body: { ops: [{ op: 'place', def: coreRef('bench'), name: 'b', p: [40, 0] }], group: 'hamlet' } });
  await f.req('/v1/god/act', { token, body: { ops: [{ op: 'place', def: coreRef('rock'), name: 'r', p: [-40, 0] }] } });
  assert.deepEqual(seen, [1, 2, 3]);
  const q = await f.req('/v1/god/query', { body: { points: [[0, 0], [100, 100]], entity: 'c', free: { size: [8, 6], near: [0, 40], count: 2 }, clearance: { at: [30, 3], size: [2, 2] } } }); // across the hollow cottage's front wall
  assert.equal(q.data.points[0].y, 5); assert.equal(q.data.points[1].medium, 'walk');
  assert.equal(q.data.entity.path, 'c'); assert.equal(q.data.free.length, 2);
  assert.equal(q.data.clearance.clear, false); assert.ok(q.data.clearance.blockedBy.includes('c'));
  const pv = await f.req('/v1/god/preview', { token, body: { ops: [{ op: 'place', def: coreRef('fountain'), p: [0, 60] }] } });
  assert.equal(pv.data.accepted, true); assert.equal(f.god.model.entities.size, 4, 'preview commits nothing');
  const got = await f.req(`/v1/god/preview/${pv.data.id}`, { token }); assert.equal(got.data.diff.upserts.length, 1);
  const ug = await f.req('/v1/god/undo?group=hamlet', { method: 'POST', token });
  assert.deepEqual(ug.data.reverted, [2, 1]); assert.ok(f.god.model.get('r') && !f.god.model.get('c') && !f.god.model.get('b'));
  const edits = await f.req('/v1/god/edits', { token });
  assert.equal(edits.data.edits.find((e: { seq: number }) => e.seq === 1).grp, 'hamlet');
});
