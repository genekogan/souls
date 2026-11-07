import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { CREATION_LIMITS } from '@souls/generators';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { config } from '../config.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { mountEnvRoutes } from './world-env.ts';
import { godSchema } from './schema.ts';
import { sourceVersion } from './versions.ts';
import { EngineBridge } from './engine-bridge.ts';

function fixture(t: TestContext) {
  const db = new Db(':memory:'); t.after(() => db.close()); let now = 10_000;
  const god = new GodMode(db, { worldId: 'hotfix', ownerId: 'owner', tick: () => 0, emit: () => {}, now: () => now });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'lead'), other = god.mintFor({ id: 'owner', role: 'user' }, 'other');
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Hotfix', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5368', limitIp: () => {} });
  mountEnvRoutes(app, { god, host: { engine: { world: { tick: 0, env: {} } } } as never, requireGod: c => { if (!god.godIdentity(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))) throw new ApiError(401, 'unauthorized', 'god token'); } });
  app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code, message: e.message, ...e.extra }, e.status as 400) : c.json({ code: 'internal', message: String(e) }, 500));
  const req = (path: string, body?: unknown, auth: string | null = token, key?: string) => app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(key ? { 'x-preview-key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { god, token, other, req, advance: (ms: number) => { now += ms; } };
}
const batch = { ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0] }] };

test('preview view key is scoped, expires with the preview, and grants no list/write privileges', async t => {
  const f = fixture(t), a = await (await f.req('/v1/god/preview', batch)).json() as any;
  const b = await (await f.req('/v1/god/preview', batch)).json() as any;
  assert.equal(a.accepted, true); assert.match(a.viewKey, /^[\w-]{43}$/); assert.notEqual(a.viewKey, b.viewKey);
  assert.equal(a.url, `?preview=${a.id}#previewKey=${a.viewKey}`); assert.equal(a.expiresAt, 610_000);
  const path = `/v1/god/preview/${a.id}`;
  for (const key of [undefined, b.viewKey, a.viewKey.slice(1), 'x'.repeat(129)]) assert.equal((await f.req(path, undefined, null, key)).status, 401);
  const viewed = await f.req(path, undefined, null, a.viewKey);
  assert.equal(viewed.status, 200); assert.equal(viewed.headers.get('cache-control'), 'no-store');
  const payload = await viewed.json() as any; assert.equal(payload.ops.ops[0].op, 'place'); assert.equal(payload.viewKeyHash, undefined);
  assert.equal((await f.req(path)).status, 200, 'a god token works without the key');
  assert.equal((await f.req('/v1/god/previews', undefined, null, a.viewKey)).status, 401);
  assert.equal((await f.req('/v1/god/act', { preview: a.id }, null, a.viewKey)).status, 401);
  assert.equal((await f.req('/v1/god/snapshot', undefined, null, a.viewKey)).status, 401);
  assert.equal(f.god.model.editSeq, 0);
  f.advance(600_000);
  assert.equal((await f.req(path, undefined, null, a.viewKey)).status, 401);
  assert.equal((await f.req(path)).status, 404);
  assert.deepEqual(await (await f.req('/v1/god/previews')).json(), { previews: [] });
});

test('dryrun budget permits ten 12-candidate placements and retains a finite per-token bound', async t => {
  const f = fixture(t);
  assert.equal(CREATION_LIMITS.dryrunsPerMinute, 180);
  for (let i = 0; i < CREATION_LIMITS.dryrunsPerMinute; i++) assert.equal((await f.req('/v1/god/dryrun', batch)).status, 200, `dryrun ${i + 1}`);
  const refused = await f.req('/v1/god/dryrun', batch), data = await refused.json() as any;
  assert.equal(refused.status, 429); assert.equal(data.code, 'rate-limited'); assert.ok(data.retryAfterMs > 0);
  assert.equal((await f.req('/v1/god/dryrun', batch, f.other)).status, 200); assert.equal(f.god.model.editSeq, 0);
});

test('env, land, strike and asset limiters report retryAfterMs before doing work', async t => {
  const f = fixture(t);
  for (const [path, max] of [['env', CREATION_LIMITS.envEditsPerMinute], ['land', CREATION_LIMITS.landEditsPerMinute], ['strike', CREATION_LIMITS.strikesPerMinute], ['assets', CREATION_LIMITS.assetUploadsPerMinute]] as const) {
    for (let i = 0; i < max; i++) assert.notEqual((await f.req(`/v1/god/${path}`, {})).status, 429, path);
    const refused = await f.req(`/v1/god/${path}`, {}), data = await refused.json() as any;
    assert.equal(refused.status, 429, path); assert.ok(data.retry_after > 0, path); assert.equal(data.retryAfterMs, data.retry_after * 1000, path);
  }
});

test('act sky/time/weather warns only the lead of an open build, including sealed commits and replays', async t => {
  const f = fixture(t), identity = f.god.godIdentity(f.token)!;
  const start = f.god.builds.start({ id: 'hall', title: 'Hall', steps: ['shell'], site: { at: [0, 0], size: [20, 20], yaw: 0 } }, identity);
  assert.equal(start.ok, true);
  const warned = async (state: object, token = f.token, expect = true) => {
    const result = await (await f.req('/v1/god/act', { ops: [{ op: 'world', state }] }, token)).json() as any;
    assert.equal(result.accepted, true, JSON.stringify(result)); assert.equal(result.warnings.some((w: string) => w.startsWith('env.shared-clock:')), expect);
  };
  for (const state of [{ sky: { palette: 'dusk' } }, { time: { paused: true } }, { weather: { kind: 'rain' } }]) await warned(state);
  await warned({ sky: { palette: 'clear-day' } }, f.other, false);
  await warned({ constitution: 'Be kind.' }, f.token, false);
  f.god.builds.pause('hall', {}, identity); await warned({ sky: { palette: 'dusk' } });
  const preview = await (await f.req('/v1/god/preview', { ops: [{ op: 'world', state: { sky: { palette: 'clear-day' } } }] })).json() as any;
  const sealed = { preview: preview.id, clientRef: 'sky-once' };
  const committed = await (await f.req('/v1/god/act', sealed)).json() as any;
  assert.ok(committed.warnings.some((w: string) => w.startsWith('env.shared-clock:')));
  assert.deepEqual(await (await f.req('/v1/god/act', sealed)).json(), { ...committed, replayed: true });
  f.god.builds.done('hall', {}, identity); await warned({ sky: { palette: 'dusk' } }, f.token, false);
});

test('schema advertises look and parts; source falls back to the deployed build; declaration matches runtime', () => {
  const schema = godSchema() as any;
  assert.ok(schema.endpoints.god.includes('POST /v1/god/look')); assert.ok(schema.endpoints.god.includes('GET /v1/god/parts?q='));
  assert.equal(sourceVersion(undefined, 'we-cf2145156100'), 'we-cf2145156100');
  assert.equal(sourceVersion('bad source', 'we-cf2145156100'), 'we-cf2145156100');
  assert.equal(sourceVersion('cf214515', 'we-other'), 'cf214515'); assert.equal(sourceVersion(undefined), config.build);
  assert.match(readFileSync(new URL('../../../../tools/god-skill/lib/version.d.mts', import.meta.url), 'utf8'), /SKILL_VERSION: '1\.8'/);
});

test('probe retirement journal identifies the actual h_vp body prefix and keeps ordinary labels', () => {
  for (const [entityId, note] of [['h_vp0123456789', 'retire: verifier probe h_vp0123456789 body removed'], ['h_0123456789', 'retire: body removed']]) {
    const calls: any[] = [];
    EngineBridge.prototype.bodyRetired.call({ model: { entities: new Map([[entityId, {}]]), children: new Map() }, engineAct: (...args: any[]) => { calls.push(args); return { accepted: true }; } } as never, { entityId });
    assert.deepEqual(calls, [[[{ op: 'remove', id: entityId, cascade: true }], note]]);
  }
});
