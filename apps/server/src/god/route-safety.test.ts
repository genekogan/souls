import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { CREATION_LIMITS } from '@souls/generators';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';

function fixture(t: { after(fn: () => void): void }) {
  const db = new Db(':memory:'); t.after(() => db.close());
  const opts = { worldId: 'route-safety', ownerId: 'dev:owner', tick: () => 0, emit: () => {} };
  const god = new GodMode(db, opts), other = new GodMode(db, { ...opts, worldId: 'other-world' });
  const a = god.mintFor({ id: 'dev:owner', role: 'user' }, 'a'), b = god.mintFor({ id: 'dev:owner', role: 'user' }, 'b'), wrong = other.mintFor({ id: 'dev:owner', role: 'user' }, 'wrong');
  const app = new Hono(); let verifications = 0;
  mountGodRoutes(app, { god, worldName: 'Safety', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => '', limitIp: () => {}, verifyUse: { run: async () => { verifications++; return { ok: true }; } } as never });
  app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code, ...e.extra }, e.status as 400) : c.json({ code: 'internal', message: String(e) }, 500));
  const request = (path: string, token?: string, body?: unknown) => app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { god, a, b, wrong, request, verifications: () => verifications };
}
test('expensive endpoints reject missing/wrong-world tokens and rate limits are per token and endpoint', async t => {
  const f = fixture(t);
  for (const token of [undefined, f.wrong]) assert.equal((await f.request('/v1/god/verify-use', token, { target: 'x' })).status, 401);
  for (let i = 0; i < 6; i++) assert.equal((await f.request('/v1/god/verify-use', f.a, { target: 'x' })).status, 200);
  const refused = await f.request('/v1/god/verify-use', f.a, { target: 'x' });
  assert.equal(refused.status, 429); assert.equal((await refused.json() as { code: string }).code, 'rate-limited'); assert.equal(f.verifications(), 6);
  assert.equal((await f.request('/v1/god/verify-use', f.b, { target: 'x' })).status, 200);
  assert.equal((await f.request('/v1/god/preview', f.a, { ops: [{ op: 'world', state: { constitution: 'draft' } }] })).status, 200);
  for (const [path, max] of [['/v1/god/assets', CREATION_LIMITS.assetUploadsPerMinute], ['/v1/god/preview', CREATION_LIMITS.previewsPerMinute], ['/v1/god/dryrun', CREATION_LIMITS.dryrunsPerMinute]] as const) {
    // Malformed requests still consume a slot, before any parser/compiler work.
    for (let i = 0; i < max; i++) await f.request(path, f.b, {});
    assert.equal((await f.request(path, f.b, {})).status, 429, path);
  }
});
test('preview and request receipt reads require a god token scoped to this world', async t => {
  const f = fixture(t), pv = f.god.preview({ ops: [{ op: 'world', state: { constitution: 'draft' } }] });
  assert.ok(pv.id);
  f.god.act({ clientRef: 'safe-ref', ops: [{ op: 'world', state: { constitution: 'accepted' } }] });
  for (const path of [`/v1/god/preview/${pv.id}`, '/v1/god/requests/safe-ref']) {
    for (const token of [undefined, f.wrong]) assert.equal((await f.request(path, token)).status, 401);
    assert.equal((await f.request(path, f.a)).status, 200); assert.equal((await f.request(path, f.b)).status, 200);
  }
});
test('schema advertises the shared rules and effective world overrides', async t => {
  const f = fixture(t);
  f.god.model.constants = { ...f.god.model.constants, limits: { ...f.god.model.constants.limits, entities: 123, budget: { tris: 5000, bytes: 10000, texPx: 512 } } };
  const schema = await (await f.request('/v1/god/schema')).json() as { limits: Record<string, unknown>; refusals: string[] };
  assert.equal(schema.limits.worldEntities, 123); assert.equal(schema.limits.assetBytes, 10000); assert.equal(schema.limits.texturePx, 512);
  assert.equal(schema.limits.batchOps, 256); assert.equal(schema.limits.sealApproachDepthM, 1.5);
  for (const code of ['architecture.sealed', 'budget.world', 'budget.region']) assert.ok(schema.refusals.includes(code));
});
test('deep JSON is a typed refusal through act, preview and dryrun before recursive schema work', async t => {
  const f = fixture(t); let deep: unknown = 1;
  for (let i = 0; i < 500; i++) deep = { next: deep };
  for (const path of ['act', 'preview', 'dryrun']) {
    const r = await f.request(`/v1/god/${path}`, f.a, { ops: [{ op: 'set', id: 'missing', params: { plan: deep } }] });
    assert.equal(r.status, 200); const data = await r.json() as { accepted: boolean; failures: { code: string }[] };
    assert.equal(data.accepted, false); assert.equal(data.failures[0].code, 'schema');
  }
});
