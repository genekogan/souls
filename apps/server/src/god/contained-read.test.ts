// #1198: a rewind sets aside what it can't repair; only the world's god can read that, on the god API.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { coreLibrary } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';

function fixture(t: TestContext) {
  const db = new Db(':memory:');
  const god = new GodMode(db, { worldId: 'contained', ownerId: 'owner', tick: () => 100, emit: () => {}, library: coreLibrary(), constants: { extent: 128 } } as never);
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'fixture'), app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Contained', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://fixture.invalid', limitIp: () => {} } as never);
  app.onError((err, c) => err instanceof ApiError ? c.json({ code: err.code, message: err.message }, err.status as 400) : c.json({ code: 'internal', message: String(err) }, 500));
  t.after(() => db.close());
  const read = async (auth?: string) => { const r = await app.request('/v1/god/contained', { headers: auth ? { authorization: `Bearer ${auth}` } : {} }); return { status: r.status, data: await r.json() as { contained?: unknown[]; code?: string } }; };
  return { god, token, read };
}

test('G2: nothing contained reads as an empty list', async (t) => {
  const { token, read } = fixture(t);
  assert.deepEqual(await read(token), { status: 200, data: { contained: [] } });
});

test('G2: only the world\'s god can read it', async (t) => {
  const { god, token, read } = fixture(t);
  god.contained = () => [{ rule: 'support.floating', subjects: ['e_1'], things: [{ id: 'e_1', path: 'shed' }] }];
  assert.equal((await read()).status, 401);
  assert.equal((await read('not-a-token')).status, 401);
  assert.equal((await read(token)).status, 200);
});

test('G1, G3: each entry\'s rule, subjects and the god\'s own thing, and it leaves the list when it stops firing', async (t) => {
  const { god, token, read } = fixture(t); let list = [{ rule: 'support.floating', subjects: ['e_1', 'h_2'], things: [{ id: 'e_1', path: 'market/stall' }] }];
  god.contained = () => list;
  assert.deepEqual((await read(token)).data.contained, list);
  list = [];
  assert.deepEqual((await read(token)).data.contained, []);
});
