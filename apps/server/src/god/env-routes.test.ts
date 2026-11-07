import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono, type Context } from 'hono';
import { CREATION_LIMITS } from '@souls/generators';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountEnvRoutes } from './world-env.ts';
import { mountLightningRoutes } from './lightning.ts';

function fixture(t: { after(fn: () => void): void }) {
  const db = new Db(':memory:'); t.after(() => db.close());
  const opts = { worldId: 'env-routes', ownerId: 'dev:owner', tick: () => 0, emit: () => {} };
  const god = new GodMode(db, opts), other = new GodMode(db, { ...opts, worldId: 'other-world' });
  const mint = (g: GodMode, label: string) => g.mintFor({ id: 'dev:owner', role: 'user' }, label);
  const a = mint(god, 'lead'), b = mint(god, 'other'), wrong = mint(other, 'wrong');
  const app = new Hono();
  const requireGod = (c: Context) => { if (!god.godFromToken(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))) throw new ApiError(401, 'unauthorized', 'god token'); };
  mountEnvRoutes(app, { god, host: { engine: { world: { tick: 0, env: { datetime: '2026-10-03T06:00:00.000Z' } } } } as never, requireGod });
  mountLightningRoutes(app, { god, requireGod, tick: () => 0 });
  app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code, ...e.extra }, e.status as 400) : c.json({ code: 'internal', message: String(e) }, 500));
  const request = (path: string, token?: string, body: unknown = {}) => app.request(path, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { god, a, b, wrong, request };
}

test('env/strike authenticate first and limit per token and endpoint before parsing/work', async t => {
  const f = fixture(t);
  for (const [path, max, body] of [
    ['/v1/god/env', CREATION_LIMITS.envEditsPerMinute, { timeScale: -1 }],
    ['/v1/god/strike', CREATION_LIMITS.strikesPerMinute, { at: [99999, 0] }],
  ] as const) {
    for (const token of [undefined, f.wrong]) assert.equal((await f.request(path, token, body)).status, 401);
    for (let i = 0; i < max; i++) assert.equal((await f.request(path, f.a, body)).status, 400);
    const refused = await f.request(path, f.a, body), data = await refused.json() as { code: string; retry_after: number };
    assert.equal(refused.status, 429); assert.equal(data.code, 'rate-limited'); assert.ok(data.retry_after > 0);
    assert.equal((await f.request(path, f.b, body)).status, 400, 'another token has its own allowance');
    assert.equal(f.god.model.editSeq, 0, 'refused work never enters the journal');
  }
});

test('only a token leading an open build receives the shared-clock warning, without refusing the edit', async t => {
  const f = fixture(t), start = f.god.builds.start({ id: 'hall', title: 'Hall', steps: ['shell'], site: { at: [0, 0], size: [20, 20], yaw: 0 } }, f.god.godIdentity(f.a)!);
  assert.equal(start.ok, true);
  for (const body of [{ timeOfDay: '14:22' }, { weather: { kind: 'rain' } }, { timeScale: 1 }]) {
    const data = await (await f.request('/v1/god/env', f.a, body)).json() as { accepted: boolean; warnings: string[] };
    assert.equal(data.accepted, true); assert.ok(data.warnings.some(w => w.startsWith('env.shared-clock:') && w.includes('look --hour')));
  }
  const other = await (await f.request('/v1/god/env', f.b, { weather: { kind: 'clear' } })).json() as { warnings: string[] };
  assert.equal(other.warnings.some(w => w.startsWith('env.shared-clock:')), false);
  f.god.builds.pause('hall', {}, f.god.godIdentity(f.a)!);
  const paused = await (await f.request('/v1/god/env', f.a, { timeOfDay: '21:00' })).json() as { warnings: string[] };
  assert.ok(paused.warnings.some(w => w.startsWith('env.shared-clock:')), 'paused builds are still open');
  assert.equal(f.god.builds.done('hall', {}, f.god.godIdentity(f.a)!).ok, true);
  const done = await (await f.request('/v1/god/env', f.a, { weather: { kind: 'clear' } })).json() as { warnings: string[] };
  assert.equal(done.warnings.some(w => w.startsWith('env.shared-clock:')), false);
});
