// CE8 passive attention marker: the lead's look hint is memory-only, rate-limited and public on its site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type GodEvent, type WorldDiffMessage, type WorldBuildMessage } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { ATTENTION } from './builds.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fixture() {
  const db = new Db(':memory:'), emitted: (WorldDiffMessage | WorldBuildMessage)[] = [], events: GodEvent[] = [], timers: { fn: () => void; due: number }[] = [];
  let now = 1_000_000;
  const god = new GodMode(db, { worldId: 'attention-test', ownerId: 'owner', tick: () => 100, now: () => now, buildPauseMs: 600_000, buildClosureMs: 1_800_000, assetDir: join(tmpdir(), 'y7-attention-assets'),
    schedule: (fn, ms) => { timers.push({ fn, due: now + ms }); }, emit: (m: WorldDiffMessage | WorldBuildMessage) => emitted.push(m) });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'lead'), other = god.mintFor({ id: 'owner', role: 'user' }, 'helper');
  god.subscribe(0, e => events.push(e));
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Attention', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5369', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, ...e.extra }, e.status as 400) : c.json({ ok: false, internal: String(e) }, 500));
  const req = async (path: string, data?: unknown, auth: string | null = token) => { const r = await app.request(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); return { status: r.status, data: await r.json() as any }; };
  const start = async () => (await req('/v1/god/builds', { id: 'church', title: 'Stone church', steps: ['shell', 'roof'], site: { at: [0, 0], size: [40, 40] }, massing: [{ name: 'nave', at: [0, 0], size: [20, 10], h: 8, roof: 'gable' }] })).data;
  const attention = () => emitted.filter((m): m is WorldBuildMessage => m.kind === 'world-build' && m.event === 'attention');
  const advance = (ms: number) => { now += ms; for (const t of timers.splice(0).sort((a, b) => a.due - b.due)) { if (t.due <= now) t.fn(); else timers.push(t); } };
  return { db, god, token, other, emitted, events, timers, req, start, attention, advance, now: () => now };
}

test('CE8: a lead hint is published on the public site without SQL, rev, history or a god-stream event', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const rev = f.god.store.build('church')!.rev, buildsRev = f.god.store.buildsRev(), events = f.events.length;
  f.advance(10);
  const r = await f.req('/v1/god/builds/church/attention', { at: [3.14159, 0.5, -2.71828], eye: [20, 12, 18] });
  assert.equal(r.status, 200); assert.deepEqual(r.data, { ok: true, t: f.now(), published: true });
  const [m] = f.attention(); assert.ok(m, 'one attention event');
  assert.equal(m.rev, rev, 'the current rev, not a new one'); assert.equal(m.delta!.rev, rev); assert.equal(m.site, undefined);
  assert.deepEqual(m.delta!.attention, { at: [3.14, 0.5, -2.72], eye: [20, 12, 18], t: f.now() });
  assert.equal(f.god.store.build('church')!.rev, rev, 'no SQL write'); assert.equal(f.god.store.buildsRev(), buildsRev);
  assert.equal(f.events.length, events, 'not pushed to the god SSE stream');
  assert.equal(JSON.stringify(f.god.store.build('church')!.body).includes('attention'), false, 'never persisted');
  const pub = (await f.req('/v1/world/builds', undefined, null)).data.builds[0];
  assert.deepEqual(pub.attention, m.delta!.attention); assert.equal(JSON.stringify(pub).includes(s.lease), false);
  assert.deepEqual((await f.req('/v1/world/snapshot', undefined, null)).data.builds[0].attention, m.delta!.attention);
  // No history: a new look replaces the old one.
  f.advance(ATTENTION.minMs);
  assert.equal((await f.req('/v1/god/builds/church/attention', { at: [5, 0, 5] })).data.published, true);
  assert.deepEqual(f.god.builds.publicList().builds[0].attention, { at: [5, 0, 5], t: f.now() });
  // Stale after ~20 s: snapshots stop carrying it.
  f.advance(ATTENTION.ttlMs + 1);
  assert.equal(f.god.builds.publicList().builds[0].attention, undefined);
});

test('CE8: hints are rate limited to one publish per second per build, coalescing to the latest (trailing edge)', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start();
  const hint = (x: number) => f.god.builds.attend('church', { at: [x, 0, 0] }, f.god.godIdentity(f.token)!);
  assert.equal((hint(1) as any).published, true); assert.equal(f.attention().length, 1);
  f.advance(100); const second = hint(2) as any; assert.equal(second.published, false); assert.equal(f.timers.length, 1);
  f.advance(100); const third = hint(3) as any; assert.equal(third.published, false); assert.equal(f.timers.length, 1, 'one trailing publish, not one per hint');
  assert.equal(f.attention().length, 1);
  f.advance(799); assert.equal(f.attention().length, 1);
  f.advance(1); assert.equal(f.attention().length, 2); assert.deepEqual(f.attention()[1].delta!.attention!.at, [3, 0, 0], 'the latest wins');
  assert.equal(f.attention()[1].delta!.attention!.t, 1_000_200, 'keeps the hint time, so the viewer fades from when the god looked');
  f.advance(1000); assert.equal((hint(4) as any).published, true); assert.equal(f.attention().length, 3);
  // A trailing hint for a build that closed meanwhile is dropped.
  f.advance(10); hint(5); assert.equal(f.god.builds.done('church', { force: true }, f.god.godIdentity(f.token)!).ok, true);
  const n = f.attention().length; f.advance(2000); assert.equal(f.attention().length, n);
});

test('CE8: only the lead (token or lease) may hint; refusals are typed and never throw', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const code = (r: any) => r.data.failures?.[0]?.code ?? r.data.code;
  assert.equal(code(await f.req('/v1/god/builds/church/attention', { at: [0, 0, 0] }, f.other)), 'build.lease');
  assert.equal((await f.req('/v1/god/builds/church/attention', { at: [0, 0, 0], lease: s.lease }, f.other)).data.ok, true, 'the lease is the lead credential');
  assert.equal(code(await f.req('/v1/god/builds/church/attention', { at: [0, 0, 0] }, null)), 'unauthorized');
  assert.equal(code(await f.req('/v1/god/builds/missing/attention', { at: [0, 0, 0] })), 'build.unknown');
  assert.equal(code(await f.req('/v1/god/builds/church/attention', { at: [9999, 0, 0] })), 'build.site');
  for (const bad of [{ at: [0, 0] }, { at: [0, 5000, 0] }, { at: [0, 0, 0], eye: [0, 0] }, { at: [0, 0, 0], note: 'x' }, { at: ['0', 0, 0] }, {}]) assert.equal(code(await f.req('/v1/god/builds/church/attention', bad)), 'schema', JSON.stringify(bad));
  assert.equal(f.god.builds.done('church', { force: true }, f.god.godIdentity(f.token)!).ok, true);
  assert.equal(code(await f.req('/v1/god/builds/church/attention', { at: [0, 0, 0] })), 'build.closed');
});

test('CE8: the attention route has its own per-token rate limit', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start();
  for (let i = 0; i < ATTENTION.perMinute; i++) assert.equal((await f.req('/v1/god/builds/church/attention', { at: [0, 0, 0] })).status, 200);
  assert.equal((await f.req('/v1/god/builds/church/attention', { at: [0, 0, 0] })).status, 429);
  // Edits are not starved by looks.
  assert.equal((await f.req('/v1/god/act', { ops: [{ op: 'place', def: coreRef('bench'), name: 'b', p: [100, 100] }] })).data.accepted, true);
});

test('CE8: the schema advertises the attention endpoint and its body shape', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const schema = (await f.req('/v1/god/schema', undefined, null)).data;
  assert.ok(JSON.stringify(schema).includes('POST /v1/god/builds/:id/attention'));
  assert.deepEqual(Object.keys(schema.builds.actions.attention.properties).sort(), ['at', 'eye', 'lease']);
});

test('CE8: hints stay out of the god trace: no rows and no loop hints, even when refused again and again', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start();
  if (!f.god.trace.enabled) return t.skip('GOD_TRACE=0');
  const before = f.god.trace.rows({ limit: 1000 }).length;
  for (let i = 0; i < 4; i++) { await f.req('/v1/god/builds/church/attention', { at: [0, 0, 0] }); await f.req('/v1/god/builds/church/attention', { at: [9999, 0, 0] }); }
  assert.equal(f.god.trace.rows({ limit: 1000 }).length, before);
  assert.deepEqual(f.god.trace.loops({ build: 'church' }), []);
  // An authoring call is still traced.
  await f.req('/v1/god/builds/church/check', {});
  assert.equal(f.god.trace.rows({ limit: 1000 }).length, before + 1);
});
