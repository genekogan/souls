import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { coreRef, hashOf } from '@souls/world-compiler';
import { work } from '@souls/world-compiler/work-meter';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type GodEvent, type WorldDiffMessage, type WorldBuildMessage, type GodOptions } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { closureMeetsPolygon, type BuildBody, type BuildField } from './builds.ts';
import { GOD_EDIT_OUTCOME_BYTES } from './store.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fixture(options: Partial<GodOptions> = {}, file = ':memory:') {
  const db = new Db(file), emitted: (WorldDiffMessage | WorldBuildMessage)[] = [], events: GodEvent[] = [];
  let now = 1_000_000;
  const god = new GodMode(db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: () => now, buildPauseMs: 50, buildClosureMs: 500, assetDir: join(tmpdir(), 'c1-build-assets'), ...options, emit: (m: WorldDiffMessage | WorldBuildMessage) => emitted.push(m) });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'lead'), other = god.mintFor({ id: 'owner', role: 'user' }, 'helper');
  god.subscribe(0, e => events.push(e));
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Build test', requireUser: async c => { if (c.req.header('authorization') !== 'Bearer owner') throw new ApiError(401, 'unauthorized', 'sign in'); return { id: 'owner', role: 'user', email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null }; }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5364', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, ...e.extra }, e.status as 400) : c.json({ ok: false, internal: String(e) }, 500));
  const req = async (path: string, data?: unknown, auth: string | null = token, method?: string) => { const response = await app.request(path, { method: method ?? (data === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); return { status: response.status, headers: response.headers, data: await response.json() as any }; };
  const start = async (extra = {}) => (await req('/v1/god/builds', { id: 'church', title: 'Stone church', steps: ['shell', 'roof', 'interior'], site: { at: [0, 0], size: [80, 80] }, massing: [{ name: 'nave', at: [0, 0], size: [20, 10], h: 8, roof: 'gable' }], brief: 'god-only brief', ...extra })).data;
  const field = (lease: string, extra = {}): BuildField => ({ id: 'church', lease, ...extra });
  const place = (name: string, x = 0, z = 0) => ({ op: 'place', def: coreRef('bench'), name, p: [x, z] });
  return { db, god, app, token, other, emitted, events, req, start, field, place, setNow: (n: number) => { now = n; }, advance: (n: number) => { now += n; }, now: () => now };
}
const body = (f: ReturnType<typeof fixture>, id = 'church'): BuildBody => JSON.parse(f.god.store.build(id)!.body);
const code = (r: any) => r.failures?.[0]?.code;
const assertAccepted = (r: any) => assert.equal(r.accepted, true, JSON.stringify(r));

test('CE1: step announces before an edit, sanitizes public text, and replays without counting a batch', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), seq = f.god.model.editSeq;
  f.advance(10);
  const input = { lease: s.lease, n: 2, label: 'roof details', say: 'Two\u0000 green\nspires\u0085', masses: ['nave'] };
  const r = await f.req('/v1/god/builds/church/step', input); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.data.ok, true);
  const b = r.data.build; assert.equal(b.step.n, 2); assert.equal(b.step.seq, null); assert.equal(b.step.label, 'roof details');
  assert.deepEqual(b.say, { text: 'Two green spires', at: f.now() }); assert.equal(b.sayAt, f.now()); assert.deepEqual(b.designing, ['nave']);
  assert.equal(f.god.model.editSeq, seq); assert.deepEqual(body(f).steps, []); assert.equal(body(f).lastBatchAt, undefined); assert.equal(b.lastAt, f.now());
  const event = f.emitted.at(-1) as WorldBuildMessage; assert.equal(event.event, 'step'); assert.equal(event.site, undefined); assert.deepEqual(event.delta!.say, b.say); assert.deepEqual(event.delta!.designing, ['nave']);
  assert.equal((f.events.at(-1)!.data as any).view, undefined);
  const replay = (await f.req('/v1/god/builds/church/step', input)).data; assert.equal(replay.replayed, true); assert.equal(replay.build.rev, b.rev); assert.deepEqual(replay.build.say, b.say);
  const pub = (await f.req('/v1/world/snapshot', undefined, null)).data.builds[0]; assert.deepEqual(pub.say, b.say); assert.deepEqual(pub.designing, ['nave']);
  assert.equal(pub.reopensAt, s.build.createdAt + 500); assert.equal(JSON.stringify(pub).includes(s.lease), false); assert.equal(JSON.stringify(pub).includes('god-only brief'), false);
  // A late batch from a prior step cannot move the announced step backwards.
  f.advance(10); const committed = (await f.req('/v1/god/act', { ops: [f.place('caption')], note: 'Placed\u0001 ten ribs ' + 'r'.repeat(150), build: f.field(s.lease, { step: 1 }) })).data; assertAccepted(committed);
  const delta = (f.emitted.at(-1) as WorldDiffMessage).builds![0]; assert.equal(delta.step!.n, 2); assert.equal(delta.note!.text.length, 140); assert.ok(!delta.note!.text.includes('\u0001')); assert.equal(delta.note!.at, f.now());
  assert.equal(delta.say, undefined, 'unchanged narration is not repeated on every batch'); assert.equal(delta.designing, undefined);
  assert.deepEqual(f.god.builds.publicList().builds[0].note, delta.note);
  assert.equal(body(f).steps[0].batches, 1);
  assertAccepted(f.god.act({ ops: [f.place('uncaptioned', 8)], build: f.field(s.lease) }));
  assert.equal(f.god.builds.publicList().builds[0].note, undefined); assert.equal((f.emitted.at(-1) as WorldDiffMessage).builds![0].note!.text, '', 'a batch without a note clears the previous caption');
  f.advance(10); assert.equal((await f.req('/v1/god/builds/church/step', { lease: s.lease, n: 3, say: 'Designing the door' })).data.ok, true);
  const latest = body(f).say;
  assert.equal((await f.req('/v1/god/builds/church/step', input)).data.replayed, true); assert.deepEqual(body(f).say, latest, 'an old tuple retry cannot replace newer narration'); assert.equal(body(f).step.n, 3);
});

test('CE1: a long, chatty build keeps a bounded step-call record and still saves', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  // Direct calls: the route's per-token edit limiter is tested elsewhere; this is about the stored record.
  const caller = f.god.godIdentity(f.token)!;
  for (let i = 0; i < 300; i++) { f.advance(1); assert.equal(f.god.builds.step('church', { lease: s.lease, say: `sub-step ${i} of the nave` }, caller).ok, true); }
  const b = body(f); assert.equal(b.stepCalls!.length, 256); assert.equal(b.say!.text, 'sub-step 299 of the nave');
  assertAccepted(f.god.act({ ops: [f.place('after-chatter')], build: f.field(s.lease) }));
});

test('CE1: step validates lease/claim, text, masses and the existing edit limiter', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), path = '/v1/god/builds/church/step';
  assert.equal((await f.req(path, { lease: s.lease }, null)).status, 401);
  for (const input of [{}, { lease: s.lease, claim: 'c_00000000' }, { lease: s.lease, n: 1.5 }, { lease: s.lease, label: 'x'.repeat(61) }, { lease: s.lease, say: 'x'.repeat(141) }, { lease: s.lease, masses: Array(9).fill('nave') }]) assert.equal(code((await f.req(path, input)).data), 'schema');
  assert.equal(code((await f.req(path, { lease: 'l_00000000' })).data), 'build.lease');
  assert.equal(code((await f.req(path, { claim: 'c_00000000' })).data), 'build.claim-unknown');
  assert.equal((await f.req(path, { lease: s.lease, masses: ['absent'] })).data.failures[0].field, 'masses');
  const schema = (await f.req('/v1/god/schema')).data; assert.ok(schema.builds.actions.step); assert.ok(schema.endpoints.god.includes('POST /v1/god/builds/:id/step'));
  let limited = false;
  for (let i = 0; i < 121; i++) { const r = await f.req(path, { lease: s.lease, n: 2, say: 'Designing' }); if (r.status === 429) { assert.ok(r.data.retryAfterMs > 0); limited = true; break; } }
  assert.ok(limited);
  f.god.builds.done('church', {}, f.god.godIdentity(f.token)!);
  assert.equal(code(f.god.builds.step('church', { lease: s.lease })), 'build.closed');
  assert.equal(code(f.god.builds.step('missing', { lease: s.lease })), 'build.unknown');
});

test('WD2: only committed work extends closure while the lead keeps reading and narrating', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const first = (await f.req('/v1/god/act', { ops: [f.place('first')], build: f.field(s.lease), clientRef: 'first' })).data; assertAccepted(first);
  const at = f.now(), deadline = at + 500;
  for (let i = 0; i < 13; i++) {
    f.advance(40); await f.req('/v1/god/snapshot');
    if (i % 3 === 0) assert.equal((await f.req('/v1/god/builds/church/step', { lease: s.lease, n: 2, say: `Design ${i}` })).data.ok, true);
    const p = f.god.builds.publicList().builds[0]; assert.equal(p.status, 'active'); assert.equal(p.reopensAt, deadline); assert.equal(p.closed, f.now() < deadline); assert.equal(body(f).lastBatchAt, at);
  }
  assert.ok(body(f).closureLapsedAt); assert.equal(f.emitted.filter(m => m.kind === 'world-build' && m.event === 'closure-lifted').length, 1);
  assert.equal((await f.req('/v1/god/builds/church/resume', {})).data.build.closed, false);
  assert.equal((await f.req('/v1/god/act', { ops: [f.place('first')], build: f.field(s.lease), clientRef: 'first' })).data.replayed, true);
  assert.equal(f.god.builds.publicList().builds[0].reopensAt, deadline);
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('bad')], build: f.field('l_00000000') })).data), 'build.lease');
  await f.req('/v1/god/preview', { ops: [f.place('preview', 10)], build: f.field(s.lease) });
  assert.equal(body(f).lastBatchAt, at);
  const next = (await f.req('/v1/god/act', { ops: [f.place('rearmed', 5)], build: f.field(s.lease), note: 'Committed again' })).data; assertAccepted(next);
  const delta = (f.emitted.at(-1) as WorldDiffMessage).builds![0]; assert.equal(delta.closed, true); assert.equal(delta.reopensAt, f.now() + 500); assert.equal(body(f).closureLapsedAt, undefined);
  const restarted = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, buildPauseMs: 50, buildClosureMs: 500, emit() {} });
  assert.equal(restarted.builds.publicList().builds[0].reopensAt, f.now() + 500);
  f.advance(500); assert.equal(restarted.builds.publicList().builds[0].closed, false, 'deadline is inclusive');
});

test('WD2: new starts get one idle window; legacy rows use committed edits, and default CLOSE_IDLE is 30 minutes', async t => {
  const saved = process.env.GOD_BUILD_CLOSE_IDLE_MS; delete process.env.GOD_BUILD_CLOSE_IDLE_MS;
  t.after(() => { if (saved === undefined) delete process.env.GOD_BUILD_CLOSE_IDLE_MS; else process.env.GOD_BUILD_CLOSE_IDLE_MS = saved; });
  const f = fixture({ buildClosureMs: undefined }); t.after(() => f.db.close()); const s = await f.start();
  assert.equal(f.god.builds.closureMs, 1_800_000); assert.equal(s.build.reopensAt, f.now() + 1_800_000);
  const b = body(f) as any; b.lastEditAt = f.now() - 1000; b.closureLiftedAt = f.now() - 1;
  f.db.db.prepare('UPDATE god_builds_v1 SET body=?,last_at=? WHERE id=?').run(JSON.stringify(b), f.now(), 'church');
  const again = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, buildClosureMs: 500, emit() {} });
  const p = again.builds.publicList().builds[0]; assert.equal(p.reopensAt, b.lastEditAt + 500); assert.equal(p.closed, false); assert.equal((again.builds.status('church')!.build as any).closureLiftedAt, undefined);
  process.env.GOD_BUILD_CLOSE_IDLE_MS = '750';
  const env = fixture({ buildClosureMs: undefined }); t.after(() => env.db.close()); assert.equal(env.god.builds.closureMs, 750);
});

test('WD1: inventory is bounded with total counts, inherited protection and explicit include', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [{ op: 'define', def: { schema: 'def/1', name: 'inventory-seat', size: { box: [.1, .5, .1] }, layer: 'decor', make: { kind: 'none' }, components: { seat: { height: .5 } } } }, ...Array.from({ length: 55 }, (_, i) => ({ op: 'place', def: 'inventory-seat@1', name: `chair-${i}`, p: [i / 20, 0], owner: 'soul:Ana' }))] }));
  const sources = { occupied: () => true, places: Array.from({ length: 55 }, (_, i) => ({ id: `p-${i}`, name: `Place ${i}`, polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][] })), bodies: Array.from({ length: 55 }, (_, i) => ({ name: `Soul ${i}`, soulId: `s_${i}`, at: [0, 0] as [number, number] })) };
  f.god.builds.inventoryContext = () => sources;
  const no = await f.start(); assert.equal(code(no), 'build.site'); assert.equal(no.failures[0].field, 'include'); assert.match(no.failures[0].fix, /chair-0 \(e_/); assert.equal(f.god.store.build('church'), null);
  for (const key of ['things', 'seats', 'places', 'owned', 'bodies']) { assert.equal(no.inventory[key].length, 50); assert.equal(no.inventory.counts[key], 55); }
  const yes = await f.start({ include: [...f.god.model.entities.keys()] }); assert.equal(yes.ok, true); assert.deepEqual(yes.inventory, no.inventory); assert.equal((await f.start({ include: [...f.god.model.entities.keys()] })).replayed, true);
});

test('WD1: inherited Soul ownership and private things require their explicit ids, including privacy without an owner', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [
    { op: 'define', def: { schema: 'def/1', name: 'private-root', size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'none' } } },
    { op: 'place', def: 'private-root@1', name: 'home', owner: 'soul:Ana' },
    { op: 'place', def: coreRef('sign'), name: 'notice', in: { parent: 'home' } },
    { op: 'place', def: coreRef('sign'), name: 'private', p: [4, 0], access: 'private' },
  ] }));
  const no = await f.start(); assert.equal(code(no), 'build.site'); assert.equal(no.failures[0].field, 'include'); assert.equal(no.failures[0].measured, 3);
  assert.deepEqual(no.inventory.owned.map((e: any) => [e.path, e.owner]), [['home', 'soul:Ana'], ['home/notice', 'soul:Ana'], ['private', null]]);
  assert.equal(code(await f.start({ include: [f.god.model.get('home')!.id] })), 'build.site');
  assert.equal((await f.start({ include: no.inventory.things.map((e: any) => e.id) })).ok, true);
});

test('WD1: named-place inventory intersects rotated/concave polygons rather than their broad bounds', () => {
  const zones = [{ at: [0, 0] as [number, number], size: [2, 2] as [number, number], yaw: Math.PI / 4 }];
  assert.equal(closureMeetsPolygon(zones, [[-10, -.1], [10, -.1], [10, .1], [-10, .1]]), true, 'crossing without a vertex inside');
  assert.equal(closureMeetsPolygon(zones, [[-10, -10], [10, -10], [10, 10], [-10, 10]]), true, 'zone wholly contained');
  assert.equal(closureMeetsPolygon(zones, [[2, 2], [5, 2], [5, 5], [2, 5]]), false);
  assert.equal(closureMeetsPolygon(zones, [[-10, -10], [10, -10], [10, 10], [3, 10], [3, -3], [-3, -3], [-3, 10], [-10, 10]]), false, 'concave void stays open');
});

test('M4: a non-build group retains exact-group undo semantics', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [f.place('plain')], group: 'ordinary' }));
  assertAccepted(f.god.act({ ops: [f.place('child', 10)], group: 'ordinary/child' }));
  const seq = f.god.store.groupEdits('ordinary')[0].seq;
  const r = (await f.req('/v1/god/undo?group=ordinary', {})).data; assert.equal(r.accepted, true); assert.deepEqual(r.reverted, [seq]);
  assert.equal(f.god.model.get('plain'), undefined); assert.ok(f.god.model.get('child'));
});

test('start/get/snapshot/status are bounded public projections and never leak identity or brief', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/builds', undefined, null)).status, 401);
  const s = await f.start(); assert.equal(s.ok, true); assert.match(s.lease, /^l_[a-f0-9]{8}$/);
  assert.equal(s.build.plan.brief, 'god-only brief'); assert.equal(s.build.lead.lease, undefined); assert.equal(s.build.lead.tokenHash, undefined);
  assert.equal(body(f).startHash, hashOf({ id: 'church', title: 'Stone church', steps: ['shell', 'roof', 'interior'], site: { at: [0, 0], size: [80, 80], yaw: 0 }, massing: [{ name: 'nave', at: [0, 0], size: [20, 10], h: 8, roof: 'gable' }], brief: 'god-only brief' }), 'omitting include preserves pre-WD1 start hashes');
  const get = await f.req('/v1/god/builds/church'); assert.equal(get.data.build.id, 'church'); assert.deepEqual(get.data.journal, []);
  for (const path of ['/v1/world/builds', '/v1/world/snapshot']) {
    const r = await f.req(path, undefined, null); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.data.builds.length, 1);
    const p = r.data.builds[0]; for (const key of ['plan', 'brief', 'lead', 'agents', 'lease', 'startHash']) assert.equal(key in p, false, key);
    assert.equal(JSON.stringify(p).includes(s.lease), false); assert.equal(JSON.stringify(p).includes('god-only'), false);
  }
  assert.equal((await f.req('/v1/world/snapshot', undefined, null)).data.buildsRev, s.build.rev);
  assert.equal((await f.req('/v1/world/seq', undefined, null)).data.builds, s.build.rev);
  assert.equal((await f.req('/v1/god/status', undefined, 'owner')).data.builds[0].id, 'church');
  assert.equal((await f.req('/v1/god/status', undefined, null)).data.builds, undefined);
  assert.equal((await f.req('/v1/god/builds/missing')).status, 404);
  assert.equal((await f.start()).replayed, true);
  assert.equal(code((await f.req('/v1/god/builds', { id: 'church', title: 'Stone church', steps: ['shell', 'roof', 'interior'], site: { at: [0, 0], size: [80, 80] }, massing: [{ name: 'nave', at: [0, 0], size: [20, 10], h: 8, roof: 'gable' }], brief: 'god-only brief' }, f.other)).data), 'build.exists');
});

test('batch echo, rev and receipt share one commit; retry does not count again; delta and SSE stay small', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const request = { ops: Array.from({ length: 5 }, (_, i) => f.place(`bench-${i}`, i * 4)), build: f.field(s.lease, { step: 2, label: 'roof details' }), clientRef: 'five' };
  const r = (await f.req('/v1/god/act', request)).data; assertAccepted(r);
  const stored = f.god.store.build('church')!; assert.equal(r.build.rev, stored.rev); assert.equal(r.build.group, 'church'); assert.equal(f.god.store.edits()[0].grp, 'church');
  assert.equal(body(f).steps[0].batches, 1); assert.equal(body(f).step.n, 2);
  const replay = (await f.req('/v1/god/act', request)).data; assert.equal(replay.replayed, true); assert.deepEqual(replay.build, r.build); assert.equal(body(f).steps[0].batches, 1);
  assert.deepEqual(f.god.store.receipt('five')!.result, r);
  const diff = f.emitted.at(-1) as WorldDiffMessage; assert.equal(diff.kind, 'world-diff'); assert.equal(diff.builds![0].rev, stored.rev); assert.equal(diff.builds![0].rootsAdded!.length, 5); assert.ok(Buffer.byteLength(JSON.stringify(diff.builds)) <= 400);
  const event = f.events.at(-1)!.data as any; assert.equal(event.kind, 'step'); assert.equal(event.view, undefined);
  if (process.env.BUILD_EXPORT_FIXTURES === '1') {
    const dir = new URL('./fixtures/', import.meta.url); mkdirSync(dir, { recursive: true }); const started = f.emitted.find(m => m.kind === 'world-build')!;
    assert.equal(f.god.builds.step('church', { lease: s.lease, n: 3, say: 'Designing the stone vault', masses: ['nave'] }).ok, true); const narration = f.emitted.at(-1);
    assertAccepted((await f.req('/v1/god/act', { ops: [{ op: 'set', id: 'bench-0', name: 'bench-caption' }], build: f.field(s.lease), note: 'Placed the first vault rib' })).data); const caption = f.emitted.at(-1);
    const file = new URL('build-messages.json', dir), existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    writeFileSync(file, JSON.stringify({ ...existing, started, diff, narration, caption, revGap: [started, { ...diff, builds: diff.builds!.map(d => ({ ...d, rev: d.rev + 1 })) }] }, null, 2) + '\n');
  }
});

// R2F (release 1.1 walk, release-check-1015): a visitor's feed while the lead narrates after a pause, then commits.
// Production defaults (10 min pause, 30 min closure). `walk` in fixtures/build-messages.json is this feed as the viewer
// replays it (apps/web/src/WorldBuildSites.test.ts); BUILD_EXPORT_FIXTURES=1 rewrites it. Only the replay projection is
// stored and compared: a diff's catalog defs (core-bench's description, defaults, hash) and an upsert's default params
// belong to catalog lanes, not to the build feed, and JSON (the wire) is the comparison, not structuredClone output.
const replayable = (feed: unknown[]) => JSON.parse(JSON.stringify(feed.map((m: any) => m.kind !== 'world-diff' ? m
  : { ...m, defs: undefined, diff: { ...m.diff, defs: [], upserts: m.diff.upserts.map(({ id, def, in: parent, name, p }: any) => ({ id, def, in: parent, name, p })) } }))) as unknown[];
test('R2F: a step after a pause reaches visitors live as contiguous world-build messages; only committed batches move reopensAt', async t => {
  const f = fixture({ buildPauseMs: 600_000, buildClosureMs: 1_800_000 }); t.after(() => f.db.close());
  const t0 = f.now(), MIN = 60_000, closure = 30 * MIN;
  const s = await f.start({ id: 'walk1', title: 'Release walk lighthouse', steps: ['massing', 'tower', 'lantern'], site: { at: [24, 30], size: [16, 16] }, massing: [{ name: 'tower', at: [0, 0], size: [8, 8], h: 15, roof: 'pyramid' }] });
  assert.equal(s.ok, true, JSON.stringify(s)); const build = { id: 'walk1', lease: s.lease };
  const reopens = async () => {
    const pub = (await f.req('/v1/world/builds', undefined, null)).data.builds[0], god = (await f.req('/v1/god/builds/walk1')).data.build;
    assert.equal(pub.reopensAt, god.reopensAt, 'the public list and the god view agree'); return { reopensAt: pub.reopensAt as number, lastAt: pub.lastAt as number, rev: pub.rev as number };
  };
  assert.equal((await reopens()).reopensAt, t0 + closure);
  // a 701 s look: nothing reaches the server for 12 minutes; the next read finds the build paused
  f.advance(12 * MIN); assert.equal((await f.req('/v1/world/builds', undefined, null)).data.builds[0].status, 'paused');
  const said = (await f.req('/v1/god/builds/walk1/step', { lease: s.lease, say: 'Raising the lighthouse tower', masses: ['tower'] })).data; assert.equal(said.ok, true);
  let r = await reopens(); assert.equal(r.lastAt, f.now(), 'narration is activity'); assert.equal(r.reopensAt, t0 + closure, 'narration does not extend the closure');
  // reads and more narration move lastAt, never reopensAt
  for (let i = 0; i < 3; i++) { f.advance(4 * MIN); await f.req('/v1/god/snapshot'); await f.req('/v1/god/builds/walk1'); assert.equal((await f.req('/v1/god/builds/walk1/step', { lease: s.lease, n: 1, say: `Designing course ${i}` })).data.ok, true); r = await reopens(); assert.equal(r.reopensAt, t0 + closure); assert.equal(r.lastAt, f.now()); }
  const walk = f.emitted.filter(m => m.kind === 'world-build').map(m => structuredClone(m)) as unknown[];
  // every committed batch with the build field moves it: a plain act, a sealed preview, a claim-less step jump
  f.advance(MIN); const placed = (await f.req('/v1/god/act', { ops: [f.place('lighthouse-stand', 24, 30)], build, note: 'Placed the lighthouse' })).data; assertAccepted(placed);
  const diff = f.emitted.at(-1) as WorldDiffMessage; walk.push(structuredClone(diff));
  assert.equal(diff.builds![0].reopensAt, f.now() + closure); assert.equal(diff.builds![0].note!.text, 'Placed the lighthouse'); assert.equal((await reopens()).reopensAt, f.now() + closure);
  const firstBatch = f.now();
  f.advance(2 * MIN); assert.equal((await f.req('/v1/god/builds/walk1/step', { lease: s.lease, n: 2, say: 'Shaping the lantern' })).data.ok, true); walk.push(structuredClone(f.emitted.at(-1)));
  assert.equal((await reopens()).reopensAt, firstBatch + closure, 'a step call after a batch keeps the batch deadline');
  f.advance(MIN); const p = (await f.req('/v1/god/preview', { ops: [f.place('lantern-bench', 26, 30)], build })).data; assert.equal(p.accepted, true);
  assert.equal((await reopens()).reopensAt, firstBatch + closure, 'a preview is not a commit');
  f.advance(MIN); assertAccepted((await f.req('/v1/god/act', { preview: p.id })).data); assert.equal((await reopens()).reopensAt, f.now() + closure, 'a sealed commit moves it');
  const gallery = { ops: [f.place('gallery-bench', 22, 30)], build: { ...build, step: 3 }, clientRef: 'r2f-gallery' };
  f.advance(MIN); const accepted = (await f.req('/v1/god/act', gallery)).data; assertAccepted(accepted); assert.equal((await reopens()).reopensAt, f.now() + closure);
  // a refused batch and a replay do not
  const last = f.now(); f.advance(MIN);
  assert.equal((await f.req('/v1/god/act', { ops: [{ op: 'remove', id: 'no-such-thing' }], build })).data.accepted, false);
  const refused = await reopens(); assert.equal(refused.reopensAt, last + closure);
  const replay = (await f.req('/v1/god/act', gallery)).data; assert.equal(replay.replayed, true, JSON.stringify(replay)); assert.deepEqual(replay.build, accepted.build);
  r = await reopens(); assert.equal(r.reopensAt, last + closure, 'a clientRef replay is not a new commit'); assert.equal(r.rev, refused.rev, 'nor a new revision');
  // the feed a visitor's viewer applied: started, paused, resumed (the lead's request), step, then reads (alive) and steps,
  // the committed diff, a step
  assert.deepEqual(walk.map((m: any) => m.kind === 'world-diff' ? 'diff' : m.event), ['started', 'paused', 'resumed', 'step', 'alive', 'step', 'alive', 'step', 'alive', 'step', 'diff', 'step']);
  const revs = walk.map((m: any) => m.kind === 'world-diff' ? m.builds[0].rev : m.rev); assert.deepEqual(revs, revs.map((_, i) => i + 1), 'contiguous revisions: no refetch needed');
  const step = walk[3] as WorldBuildMessage; assert.equal(step.delta!.status, 'active'); assert.deepEqual(step.delta!.say, { text: 'Raising the lighthouse tower', at: t0 + 12 * MIN }); assert.deepEqual(step.delta!.designing, ['tower']);
  const fixtureFile = new URL('./fixtures/build-messages.json', import.meta.url);
  if (process.env.BUILD_EXPORT_FIXTURES === '1') writeFileSync(fixtureFile, JSON.stringify({ ...JSON.parse(readFileSync(fixtureFile, 'utf8')), walk: replayable(walk) }, null, 2) + '\n');
  assert.deepEqual(replayable(JSON.parse(readFileSync(fixtureFile, 'utf8')).walk), replayable(walk), 'fixtures/build-messages.json walk is stale: BUILD_EXPORT_FIXTURES=1 node --test --test-name-pattern=R2F apps/server/src/god/builds.test.ts');
});

test('preview seals build/group, checks lease and claim in preview and dryrun, and never mutates progress', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), build = f.field(s.lease), before = f.god.store.build('church');
  const p = (await f.req('/v1/god/preview', { ops: [f.place('pew')], build, group: 'interior' })).data; assert.equal(p.accepted, true);
  assert.equal((await f.req('/v1/god/dryrun', { ops: [f.place('dry')], build })).data.accepted, true);
  assert.deepEqual(f.god.store.build('church'), before);
  const bad = (await f.req('/v1/god/act', { preview: p.id, build: { ...build, step: 9 } })).data; assert.equal(code(bad), 'schema');
  const committed = (await f.req('/v1/god/act', { preview: p.id, clientRef: 'sealed' })).data; assertAccepted(committed); assert.equal(committed.build.group, 'church/interior');
  for (const path of ['preview', 'dryrun', 'act']) {
    assert.equal(code((await f.req(`/v1/god/${path}`, { ops: [f.place(`bad-${path}`, 10)], build: { id: 'church', lease: 'l_00000000' } })).data), 'build.lease');
    assert.equal(code((await f.req(`/v1/god/${path}`, { ops: [f.place(`claim-${path}`, 10)], build: { id: 'church', claim: 'c_00000000' } })).data), 'build.claim-unknown');
  }
});

test('group mapping, no-field reservation, unknown and closed refusals do not change world', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const r = (await f.req('/v1/god/act', { ops: [f.place('one')], group: 'interior', build: f.field(s.lease) })).data;
  assertAccepted(r); assert.equal(r.build.group, 'church/interior'); assert.match(r.warnings.join(), /mapped/);
  const r2 = (await f.req('/v1/god/act', { ops: [f.place('two', 4)], group: 'church/detail', build: f.field(s.lease) })).data; assertAccepted(r2); assert.equal(r2.build.group, 'church/detail');
  const seq = f.god.model.editSeq;
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('illegal', 8)], group: 'church' })).data), 'build.group');
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('unknown', 8)], build: { id: 'missing', lease: s.lease } })).data), 'build.unknown');
  await f.req('/v1/god/builds/church/done', {});
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('closed', 8)], build: f.field(s.lease) })).data), 'build.closed'); assert.equal(f.god.model.editSeq, seq);
});

test('lazy pause emits once and current-lease batch resumes atomically', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(); f.advance(51);
  const r = await f.req('/v1/world/builds', undefined, null); assert.equal(r.data.builds[0].status, 'paused');
  const n = f.emitted.length; await f.req('/v1/world/builds', undefined, null); assert.equal(f.emitted.length, n);
  // Direct method isolates the T2 resume from the HTTP lead touch (which also legitimately resumes).
  const r2 = f.god.act({ ops: [f.place('resumed')], build: f.field(s.lease) }); assertAccepted(r2);
  assert.equal(f.god.store.build('church')!.status, 'active'); assert.equal(body(f).pauses, 1);
  assert.equal((f.events.at(-1)!.data as any).kind, 'resumed'); assert.equal((f.emitted.at(-1) as WorldDiffMessage).builds![0].status, 'active');
});

test('any lead request touches at most four times per pause window, including reads and dryruns', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start();
  for (let i = 1; i <= 10; i++) { f.advance(5); await f.req(i % 2 ? '/v1/god/snapshot' : '/v1/god/dryrun', i % 2 ? undefined : { ops: [f.place('dry')] }); }
  const alive = f.emitted.filter(m => m.kind === 'world-build' && m.event === 'alive'); assert.ok(alive.length <= 4 && alive.length > 0); assert.equal(f.god.store.build('church')!.status, 'active');
  f.advance(51); await f.req('/v1/god/snapshot'); assert.equal(f.god.store.build('church')!.status, 'active'); assert.equal(body(f).pauses, 1);
});

test('lease takeover and idempotent resume preserve current in-progress step and notes', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  for (let i = 0; i < 2; i++) assertAccepted((await f.req('/v1/god/act', { ops: [f.place(`pew-${i}`, i * 4)], note: `roof ${i}`, build: f.field(s.lease, { step: 2 }) })).data);
  const leased = (await f.req('/v1/god/builds/church/resume', {}, f.other)).data; assert.equal(code(leased), 'build.leased'); assert.equal(leased.failures[0].measured.label, 'lead');
  const resumed = (await f.req('/v1/god/builds/church/resume', { take: true }, f.other)).data; assert.equal(resumed.ok, true); assert.notEqual(resumed.lease, s.lease); assert.equal(resumed.current.n, 2); assert.equal(resumed.current.batches, 2); assert.equal(resumed.current.recent.length, 2); assert.equal(resumed.next.n, 3);
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('stale', 12)], build: f.field(s.lease) })).data), 'build.lease');
  const replay = (await f.req('/v1/god/builds/church/resume', {}, f.other)).data; assert.equal(replay.lease, resumed.lease); assert.equal(replay.replayed, true);
  const field = { id: 'church', lease: resumed.lease, step: 1, label: 'old label' };
  const r = (await f.req('/v1/god/act', { ops: [f.place('third', 12)], build: field }, f.other)).data; assertAccepted(r); assert.equal(r.build.step.n, 2); assert.equal(body(f).steps[0].batches, 3);
});

test('explicit pause permits a handoff; restart recovers leases and lazily persists pause', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'c1-restart-')), file = join(dir, 'sim.db'); const f = fixture({}, file); t.after(() => { f.db.close(); rmSync(dir, { recursive: true, force: true }); }); const s = await f.start();
  const p = (await f.req('/v1/god/builds/church/pause', { note: 'handoff' })).data; assert.equal(p.build.status, 'paused');
  assert.equal((await f.req('/v1/god/builds/church/pause', {})).data.replayed, true);
  const taken = (await f.req('/v1/god/builds/church/resume', {}, f.other)).data; assert.equal(taken.ok, true); assert.notEqual(taken.lease, s.lease);
  f.advance(51); const again = new GodMode(f.db, { worldId: 'build-test', ownerId: null, tick: () => 100, now: f.now, buildPauseMs: 50, emit: () => {} });
  const status = again.builds.status('church')!; assert.equal(status.build.status, 'paused');
  assertAccepted(again.act({ ops: [f.place('after-restart')], build: f.field(taken.lease) }));
});

test('done and final-batch done are idempotent, close atomically and reopen roots', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const r = (await f.req('/v1/god/act', { ops: [f.place('last')], build: f.field(s.lease, { done: true }), clientRef: 'finish' })).data; assertAccepted(r); assert.equal(r.build.status, 'done'); assert.equal(f.god.store.build('church')!.status, 'done'); assert.equal(f.god.builds.hasClosure(), false); assert.equal(f.god.builds.rootIndex.size, 0);
  assert.equal((await f.req('/v1/god/builds/church/done', {})).data.replayed, true);
  const r2 = await f.start({ id: 'other' }); assert.equal(r2.ok, true); assert.equal((await f.req('/v1/god/builds/other/done', { summary: 'complete' })).data.build.status, 'done');
});

test('RL2: abandon undo preflights subgroups, changes nothing on conflict and can retry', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  for (let i = 0; i < 3; i++) assertAccepted((await f.req('/v1/god/act', { ops: [f.place(`bench-${i}`, i * 4)], build: f.field(s.lease), group: `part-${i}` })).data);
  let calls = 0; f.god.bodies = { uses: () => null, refuse: () => ++calls === 2 ? { op: -1, code: 'body.protected', detail: 'a resident body' } : null };
  const before = JSON.stringify(f.god.model.snapshot()), journal = f.god.store.edits(), rev = f.god.store.buildsRev(), emitted = f.emitted.length;
  const partial = (await f.req('/v1/god/builds/church/abandon', { undo: true })).data; assert.equal(code(partial), 'build.undo-incomplete'); assert.equal(partial.reverted.length, 0); assert.equal(partial.notReverted.length, 3); assert.equal(f.god.store.build('church')!.status, 'active');
  assert.equal(JSON.stringify(f.god.model.snapshot()), before); assert.deepEqual(f.god.store.edits(), journal); assert.equal(f.god.store.buildsRev(), rev); assert.equal(f.emitted.length, emitted);
  f.god.bodies = null;
  const closed = (await f.req('/v1/god/builds/church/abandon', { undo: true })).data; assert.equal(closed.ok, true); assert.equal(closed.build.status, 'abandoned'); assert.equal(f.god.model.entities.size, 0);
  assert.equal((await f.req('/v1/god/builds/church/abandon', {})).data.replayed, true);
});

test('bounds, schema, massing containment and body SQL CHECK hold', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal(code(await f.start({ id: 'Bad_ID' })), 'schema');
  assert.equal(code(await f.start({ steps: Array(25).fill('step') })), 'schema');
  assert.equal(code(await f.start({ massing: [{ at: [40, 0], size: [20, 20], h: 2 }] })), 'build.site');
  assert.equal(code(await f.start({ site: { at: [1001, 0], size: [10, 10] } })), 'build.site');
  const s = await f.start(); assert.equal(s.ok, true);
  assert.equal(code(f.god.builds.start({ id: 'overlap', title: 'Other', steps: ['a'], site: { at: [10, 10], size: [10, 10], yaw: .7 } }, f.god.godIdentity(f.token)!)), 'build.site');
  for (let i = 1; i < 8; i++) assert.equal(f.god.builds.start({ id: `b-${i}`, title: 'Other', steps: ['a'], site: { at: [i * 50 - 200, 100], size: [10, 10] } }, f.god.godIdentity(f.token)!).ok, true);
  assert.equal(code(f.god.builds.start({ id: 'ninth', title: 'Other', steps: ['a'], site: { at: [0, 200], size: [10, 10] } }, f.god.godIdentity(f.token)!)), 'build.limit');
  assert.throws(() => f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE id=?').run(JSON.stringify({ text: 'x'.repeat(65536) }), 'church'), /CHECK/);
  const schema = (await f.req('/v1/god/schema')).data; assert.ok(schema.refusals.includes('build.lease')); assert.ok(schema.builds.field);
});

test('journal group collisions include subgroups and cannot be adopted by abandon', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [f.place('historic', -100)], group: 'church/old' }));
  assert.equal(code(await f.start()), 'build.exists');
  assert.equal((await f.start({ id: 'church-2' })).ok, true);
  await f.req('/v1/god/builds/church-2/abandon', { undo: true }); assert.ok(f.god.model.get('historic'));
});

test('roots from every diff: no-field additions, inverse symmetry, outside warnings and engine removals', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted((await f.req('/v1/god/act', { ops: [f.place('x')], build: f.field(s.lease) })).data);
  const x = f.god.model.get('x')!.id;
  assertAccepted((await f.req('/v1/god/act', { ops: [{ op: 'remove', id: x }, f.place('y')], build: f.field(s.lease) })).data);
  const y = f.god.model.get('y')!.id; assert.deepEqual(body(f).roots, [y]);
  assertAccepted(f.god.undo()); assert.deepEqual(body(f).roots, [x]); assert.equal(f.god.builds.closing(x)?.id, 'church');
  assertAccepted(f.god.redo()); assert.deepEqual(body(f).roots, [y]);
  const noField = (await f.req('/v1/god/act', { ops: [f.place('raw', 8)] })).data; assertAccepted(noField); assert.ok(body(f).roots.includes(f.god.model.get('raw')!.id));
  assert.equal((f.emitted.at(-1) as WorldDiffMessage).builds!.length, 1);
  const outside = (await f.req('/v1/god/act', { ops: [f.place('outside', 100)], build: f.field(s.lease) })).data; assertAccepted(outside); assert.match(outside.warnings.join(), /outside site/); assert.ok(!body(f).roots.includes(f.god.model.get('outside')!.id));
  const touched = f.god.act({ ops: [{ op: 'move', id: y, p: [110, 0] }] }); assertAccepted(touched); if (touched.accepted) assert.match(touched.warnings.join(), /progress not recorded/); assert.ok(body(f).roots.includes(y));
  assertAccepted(f.god.engineAct([{ op: 'remove', id: y, cascade: false }], 'retire')); assert.ok(!body(f).roots.includes(y));
});

test('nested new subtree tops bind existing containers; bodies never become roots; root cap warns', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [{ op: 'define', def: { schema: 'def/1', name: 'district', size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } } } }, { op: 'place', def: 'district@1', name: 'district', p: [0, 0] }] }));
  const s = await f.start();
  assertAccepted(f.god.act({ ops: [{ ...f.place('nested'), in: { parent: 'district' } }], build: f.field(s.lease) })); assert.ok(body(f).roots.includes(f.god.model.get('district/nested')!.id));
  const b = body(f); b.roots = Array.from({ length: 256 }, (_, i) => `existing-${i}`); f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE id=?').run(JSON.stringify(b), 'church');
  const again = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, buildPauseMs: 50, emit: () => {} });
  const cap = again.act({ ops: [f.place('over-cap', 10)], build: f.field(s.lease) }); assertAccepted(cap); if (cap.accepted) assert.match(cap.warnings.join(), /one container/); assert.equal(JSON.parse(again.store.build('church')!.body).roots.length, 256);
});

test('rev increases beyond a closed highest row; stale build conflict is atomic; planning and refusals are pure', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const second = await f.start({ id: 'second', site: { at: [100, 0], size: [20, 20] }, massing: [] }); assert.equal(second.ok, true);
  const closed = (await f.req('/v1/god/builds/second/done', {})).data.build.rev;
  const r = (await f.req('/v1/god/act', { ops: [f.place('next')], build: f.field(s.lease) })).data; assertAccepted(r); assert.ok(r.build.rev > closed);
  const before = body(f), world = hashOf(f.god.model.snapshot()), original = f.god.store.commit.bind(f.god.store);
  f.god.store.commit = (...args) => { f.db.db.prepare('UPDATE god_builds_v1 SET rev=rev+1 WHERE id=?').run('church'); return original(...args); };
  const refused = (await f.req('/v1/god/act', { ops: [f.place('not-written', 12)], build: f.field(s.lease) })).data; assert.equal(code(refused), 'revision.stale'); assert.equal(refused.failures[0].field, 'build'); assert.equal(hashOf(f.god.model.snapshot()), world); assert.deepEqual(body(f), before); assert.equal(f.god.model.get('not-written'), undefined);
  assert.equal((await f.req('/v1/world/seq', undefined, null)).data.builds, f.god.store.buildsRev());
});

test('start limiter returns 429 retryAfterMs, no auth and bad JSON keep their HTTP errors', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (let i = 0; i < 6; i++) assert.equal((await f.start()).ok, true);
  const limited = await f.req('/v1/god/builds', {}); assert.equal(limited.status, 429); assert.ok(limited.data.retryAfterMs > 0);
  const unauthorized = await f.req('/v1/god/builds', {}, null); assert.equal(unauthorized.status, 401); assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
  const bad = await f.req('/v1/god/builds/church/resume', {}, f.other); assert.equal(bad.status, 200);
});

test('compatible plain edit has no build echo or delta outside all sites', t => {
  const f = fixture(); t.after(() => f.db.close()); const r = f.god.act({ ops: [f.place('plain')] }) as any; assertAccepted(r); assert.equal(r.build, undefined); assert.equal((f.emitted.at(-1) as WorldDiffMessage).builds, undefined);
});

test('deferred claims seam: live held claims gate group, done and abandon; final edits are retained', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), b = body(f);
  b.claims.push({ id: 'c_00000001', part: 'tower', made: [], step: { n: 1, label: 'tower' }, status: 'held', lastAt: f.now(), holder: { label: 'private-holder', hash8: '12345678' }, user: { hash8: '12345678', tokenHash: 'private-token-hash' } });
  f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE id=?').run(JSON.stringify(b), 'church');
  const god = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, buildPauseMs: 50, emit: () => {} });
  assert.equal(code(god.act({ ops: [f.place('bad')], group: 'tower', build: f.field(s.lease) })), 'build.group');
  const r = god.act({ ops: [f.place('last')], build: f.field(s.lease, { done: true }) }) as any; assertAccepted(r); assert.equal(r.build.status, 'active'); assert.match(r.warnings.join(), /1 live claims \(tower\)/);
  const caller = god.godIdentity(f.token)!;
  assert.equal(code(god.builds.done('church', {}, caller)), 'build.claims-open');
  assert.equal(code(god.builds.abandon('church', {}, () => { throw Error('must not undo'); })), 'build.claims-open');
  const pub = JSON.stringify(god.publicSnapshot()); assert.ok(!pub.includes('private-holder')); assert.ok(!pub.includes('private-token-hash'));
  assert.equal(JSON.stringify(god.builds.status('church')).includes('private-token-hash'), false);
  assert.equal(god.builds.done('church', { force: true }, caller).ok, true);
});

test('SQL update sentinel rolls back entities, journal, receipt and cached build together', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), before = f.god.store.build('church'), seq = f.god.model.editSeq;
  f.db.db.exec("CREATE TRIGGER refuse_build_write BEFORE UPDATE ON god_builds_v1 BEGIN SELECT RAISE(IGNORE); END");
  const r = (await f.req('/v1/god/act', { ops: [f.place('rollback')], build: f.field(s.lease), clientRef: 'rollback' })).data;
  assert.equal(code(r), 'revision.stale'); assert.equal(f.god.model.editSeq, seq); assert.equal(f.god.model.entities.size, 0); assert.equal(f.god.store.load()!.model.entities.size, 0); assert.equal(f.god.store.receipt('rollback'), null); assert.deepEqual(f.god.store.build('church'), before);
});

test('late receipt refusal leaves progress, roots and world unchanged; current labels and unknown roots are validated', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal(code(await f.start({ root: 'missing' })), 'entity.unknown');
  const s = await f.start(), original = f.god.finalizeAct, before = f.god.store.build('church');
  f.god.finalizeAct = result => { if (result.accepted) result.warnings.push('x'.repeat(GOD_EDIT_OUTCOME_BYTES)); return result; };
  const no = (await f.req('/v1/god/act', { ops: [f.place('not-committed')], build: f.field(s.lease), clientRef: 'too-large' })).data;
  assert.equal(code(no), 'request.budget'); assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.entities.size, 0); assert.equal(f.god.store.receipt('too-large'), null);
  f.god.finalizeAct = original;
  const yes = (await f.req('/v1/god/act', { ops: [f.place('custom')], build: f.field(s.lease, { label: 'south wall' }) })).data;
  assertAccepted(yes); assert.equal(yes.build.step.label, 'south wall'); assert.equal(body(f).steps[0].label, 'south wall');
  const bad = await f.app.request('/v1/god/builds/church/pause', { method: 'POST', headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' }, body: '{' }); assert.equal(bad.status, 400);
});

test('one diff can update two sites with consecutive SQL revs and a receipt echo for its own build', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  await f.start({ id: 'second', site: { at: [100, 0], size: [20, 20] }, massing: [] });
  const r = (await f.req('/v1/god/act', { ops: [f.place('own'), f.place('other', 100)], build: f.field(s.lease), clientRef: 'two-sites' })).data; assertAccepted(r);
  const m = f.emitted.at(-1) as WorldDiffMessage; assert.equal(m.builds!.length, 2); assert.equal(m.builds![1].rev, m.builds![0].rev + 1); assert.equal(r.build.rev, m.builds![0].rev);
  assert.equal(body(f).roots.length, 1); assert.equal(body(f, 'second').roots.length, 1); assert.equal(f.god.builds.rootIndex.size, 2);
  assert.deepEqual((f.god.store.receipt('two-sites')!.result as any).build, r.build);
});

test('closed retention prunes by rev and never loses the world revision high-water mark', t => {
  const f = fixture(); t.after(() => f.db.close()); const caller = f.god.godIdentity(f.token)!;
  for (let i = 0; i < 202; i++) { const id = `site-${i}`; const started = f.god.builds.start({ id, title: 'Retention', steps: ['a'], site: { at: [0, 0], size: [10, 10] } }, caller); assert.equal(started.ok, true); assert.equal(f.god.builds.done(id, {}, caller).ok, true); }
  assert.equal(f.god.store.builds().length, 200); assert.equal(f.god.store.build('site-0'), null); assert.equal(f.god.store.buildsRev(), 404);
  const next = f.god.builds.start({ id: 'next', title: 'Next', steps: ['a'], site: { at: [0, 0], size: [10, 10] } }, caller) as any; assert.equal(next.build.rev, 405);
});

// Z3: work budgets, not milliseconds (see @souls/world-compiler/work-meter): the same answer on any CPU, so these run in the gate.
// Measured 2026-10-20, identical on every run: build overhead 1,935 per five-place batch (a plain batch is 44,642 at p50),
// touch 1, undo p95 70,035; two live claims add 662 per batch and 3,410 to the 200-upsert check. Budgets are about 2x.
const BUILD_WORK = { overheadP95: 4_000, touchMax: 2, undoP95: 140_000 }, CLAIM_WORK = { overheadP95: 1_400, check200Overhead: 7_000 };
const p95 = (xs: number[]) => { const sorted = [...xs].sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1)! }; };
test('bench: commitBatch 300 five-place batches with/without build plus 300 undos', t => {
  const summary: any = {};
  const fixtures = [false, true].map(withBuild => {
    const f = fixture({ buildPauseMs: 600_000 }); t.after(() => f.db.close());
    const started = withBuild ? f.god.builds.start({ id: 'church', title: 'Bench', steps: ['shell'], site: { at: [0, 0], size: [200, 200] } }, f.god.godIdentity(f.token)!) as any : null;
    return { f, started, withBuild, work: [] as number[], receipt: [] as number[], deltas: [] as number[], sse: [] as number[] };
  });
  for (let batch = 0; batch < 500; batch++) for (const sample of fixtures) {
    const { f, started, withBuild } = sample; if (!withBuild && batch >= 300) continue;
    const ops = Array.from({ length: 5 }, (_, j) => { const i = batch * 5 + j; return f.place(`b-${i}`, -96 + i % 49 * 4, -96 + Math.floor(i / 49) * 4); });
    let result: any; const w = work(() => { result = f.god.act({ ops, clientRef: `bench-${batch}`, ...(started ? { build: f.field(started.lease) } : {}) }); }).total; assertAccepted(result);
    if (batch < 300) { sample.work.push(w); sample.receipt.push(Buffer.byteLength(JSON.stringify(result))); const m = f.emitted.at(-1) as WorldDiffMessage; sample.deltas.push(Buffer.byteLength(JSON.stringify(m.builds ?? []))); sample.sse.push(Buffer.byteLength(JSON.stringify(f.events.at(-1)))); }
  }
  for (const { f, withBuild, work: commits, receipt, deltas, sse } of fixtures) {
    const undo: number[] = [], touch: number[] = [];
    const ring500Bytes = withBuild ? Buffer.byteLength(JSON.stringify(f.events.slice(-500))) : undefined;
    const tokenHash = f.god.godIdentity(f.token)!.hash;
    if (withBuild) for (let i = 0; i < 10000; i++) touch.push(work(() => f.god.builds.touch(tokenHash)).total);
    if (withBuild) for (let i = 0; i < 300; i++) undo.push(work(() => assertAccepted(f.god.undo())).total);
    summary[withBuild ? 'build' : 'plain'] = { work: p95(commits), receiptBytes: p95(receipt), deltaBytes: p95(deltas), sseBytes: p95(sse), ...(undo.length ? { undoWork: p95(undo), ring500Bytes, touchWork: p95(touch) } : {}) };
  }
  // The two worlds commit identical batches, so the per-batch difference is the build's own work.
  const overhead = fixtures[1].work.slice(0, 300).map((w, i) => w - fixtures[0].work[i]);
  summary.overheadWork = p95(overhead);
  console.log('BUILD_BENCH ' + JSON.stringify(summary));
  assert.ok(summary.overheadWork.p95 <= BUILD_WORK.overheadP95, `build p95 overhead work ${summary.overheadWork.p95} exceeds ${BUILD_WORK.overheadP95}`);
  assert.ok(summary.build.deltaBytes.p95 <= 400); assert.ok(summary.build.touchWork.max <= BUILD_WORK.touchMax, `touch work ${summary.build.touchWork.max}`);
  assert.ok(summary.build.undoWork.p95 <= BUILD_WORK.undoP95, `undo p95 work ${summary.build.undoWork.p95}`);
});

// C1b adversarial-review regressions. Numbers match evidence/review-c1.json confirmed[].
test('C1b #1: undo/redo validate the lease but never advance steps, batches or done', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const build = f.field(s.lease, { step: 1 });
  assertAccepted(f.god.act({ ops: [f.place('one')], build }));
  const progress = body(f);
  for (const action of ['undo', 'redo', 'undo'] as const) {
    const result = (await f.req(`/v1/god/${action}`, { build: { ...build, step: 3, label: 'not built', done: true } })).data;
    assertAccepted(result); assert.equal(result.build.group, f.god.store.edits()[0].grp);
    const b = body(f); assert.deepEqual(b.step, progress.step); assert.deepEqual(b.steps, progress.steps);
    assert.equal(b.lastEditAt, progress.lastEditAt); assert.equal(b.done, undefined); assert.equal(f.god.store.build('church')!.status, 'active');
  }
  assert.equal(code((await f.req('/v1/god/redo', { build: { ...build, lease: 'l_00000000' } })).data), 'build.lease');
  assert.equal(code((await f.req('/v1/god/redo', { build: { id: 'church', claim: 'c_00000000' } })).data), 'build.claim-unknown');
});

test('C1b #2: receipt admission reserves the real SQL revision width and stays atomic', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), build = f.field(s.lease);
  for (let i = 0; i < 12; i++) assertAccepted(f.god.act({ ops: [f.place(`p${i}`, i * 4 - 30)], build }));
  let spare = 0;
  f.god.finalizeAct = r => {
    if (!r.accepted) return r;
    const echo = { id: 'church', status: 'active', rev: 0, group: 'church', step: { n: 1, label: 'shell' } };
    const base = Buffer.byteLength(JSON.stringify({ ...r, warnings: [...r.warnings, ''], build: echo }));
    r.warnings.push('x'.repeat(GOD_EDIT_OUTCOME_BYTES - base - spare)); return r;
  };
  const before = f.god.store.build('church'), seq = f.god.model.editSeq;
  const refused = f.god.act({ ops: [f.place('edge', 25)], build, clientRef: 'edge' }); assert.equal(code(refused), 'request.budget');
  assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.editSeq, seq); assert.equal(f.god.store.receipt('edge'), null); assert.equal(f.god.model.get('edge'), undefined);
  spare = 15;
  const accepted: any = f.god.act({ ops: [f.place('safe', 25)], build, clientRef: 'safe' }); assertAccepted(accepted);
  assert.ok(accepted.build.rev >= 10); assert.ok(Buffer.byteLength(JSON.stringify(f.god.store.receipt('safe')!.result)) <= GOD_EDIT_OUTCOME_BYTES);
});

test('C1b #3: a lead group-only revert clears pause markers and emits the next closure lift', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted(f.god.act({ ops: [f.place('one')], build: f.field(s.lease) }));
  f.advance(501); f.god.builds.sweep(); assert.ok(body(f).closureLapsedAt); assert.equal(f.god.builds.hasClosure(), false);
  const caller = f.god.godIdentity(f.token)!;
  assertAccepted(f.god.as({ identity: caller }, () => f.god.undo()));
  assert.equal(f.god.store.build('church')!.status, 'active'); assert.equal(body(f).paused, undefined); assert.equal(body(f).closureLapsedAt, undefined);
  assert.equal(f.god.builds.hasClosure(), true); f.advance(501); f.god.builds.sweep();
  const lifts = f.emitted.filter((m): m is WorldBuildMessage => m.kind === 'world-build' && m.event === 'closure-lifted'); assert.equal(lifts.length, 2);
  assert.ok(lifts[1].rev > lifts[0].rev); assert.equal(f.god.builds.publicList().builds[0].closed, false);
});

test('C1b #4: superseded leads cannot pause a live lease or enable an unrequested takeover', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const next = (await f.req('/v1/god/builds/church/resume', { take: true }, f.other)).data;
  const third = f.god.mintFor({ id: 'owner', role: 'user' }, 'third');
  for (const auth of [f.token, third]) {
    const result = (await f.req('/v1/god/builds/church/pause', { lease: s.lease, note: 'stale stop' }, auth)).data;
    assert.equal(code(result), 'build.lease'); assert.equal(f.god.store.build('church')!.status, 'active');
  }
  assert.equal(code((await f.req('/v1/god/builds/church/resume', {}, third)).data), 'build.leased');
  assertAccepted((await f.req('/v1/god/act', { ops: [f.place('still-lead')], build: f.field(next.lease) }, f.other)).data);
  assert.equal((await f.req('/v1/god/builds/church/pause', { lease: next.lease }, third)).data.ok, true, 'current lease authorizes a deliberate handoff');
  assert.equal((await f.req('/v1/god/builds/church/resume', {}, third)).data.ok, true);
});

test('C1b #5: non-lead field-less reverts and abandon undo never revive a quiet lead', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  for (let i = 0; i < 2; i++) assertAccepted(f.god.act({ ops: [f.place(`part-${i}`, i * 4)], build: f.field(s.lease) }));
  f.advance(501); f.god.builds.sweep(); const before = f.god.store.build('church')!, lifted = body(f).closureLapsedAt;
  for (const action of ['undo', 'redo'] as const) {
    assertAccepted((await f.req(`/v1/god/${action}`, {}, f.other)).data);
    assert.equal(f.god.store.build('church')!.last_at, before.last_at); assert.equal(body(f).closureLapsedAt, lifted);
    assert.equal(f.god.builds.publicList().builds[0].closed, false);
  }
  let calls = 0; f.god.bodies = { uses: () => null, refuse: () => ++calls === 2 ? { op: -1, code: 'body.protected', detail: 'a resident body' } : null };
  assert.equal(code((await f.req('/v1/god/builds/church/abandon', { undo: true }, f.other)).data), 'build.undo-incomplete');
  assert.equal(f.god.store.build('church')!.last_at, before.last_at); assert.equal(f.god.builds.hasClosure(), false);
  assert.equal((await f.req('/v1/god/builds/church/resume', {}, f.other)).data.ok, true);
});

test('C1b #6: HTTP resume emits once for a transition and replays only refresh alive', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start(); f.advance(51);
  const resumed = () => f.emitted.filter(m => m.kind === 'world-build' && m.event === 'resumed').length;
  const first = (await f.req('/v1/god/builds/church/resume', {})).data; assert.equal(first.ok, true); assert.equal(resumed(), 1); assert.equal(body(f).pauses, 1);
  const rev = f.god.store.build('church')!.rev;
  assert.equal((await f.req('/v1/god/builds/church/resume', {})).data.replayed, true); assert.equal(resumed(), 1); assert.equal(f.god.store.build('church')!.rev, rev);
  f.advance(1); assert.equal((await f.req('/v1/god/builds/church/resume', {})).data.ok, true); assert.equal(resumed(), 1); assert.equal(body(f).pauses, 1);
  assert.equal((f.emitted.at(-1) as WorldBuildMessage).event, 'alive');
});

test('C1b #7: reverts of unrelated, ungrouped and grouped edits report the actual journal group', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), build = f.field(s.lease, { step: 9, done: true });
  assertAccepted(f.god.act({ ops: [f.place('tracked')], build: f.field(s.lease) })); const before = body(f);
  for (const group of ['misc', undefined]) {
    assertAccepted(f.god.act({ ops: [f.place(group ?? 'ungrouped', group ? 100 : 110)], ...(group ? { group } : {}) }));
    for (const action of ['undo', 'redo'] as const) {
      const result = (await f.req(`/v1/god/${action}`, { build })).data; assertAccepted(result);
      assert.equal(result.build.group, group); assert.equal(f.god.store.edits()[0].grp, group ?? null); assert.ok(!result.warnings.some((w: string) => /mapped/.test(w)));
      assert.deepEqual(body(f).steps, before.steps); assert.deepEqual(body(f).step, before.step); assert.equal(body(f).done, undefined);
    }
  }
  const undone = f.god.as({ identity: f.god.godIdentity(f.token)!, build }, () => f.god.undoGroup('church')); assert.equal(undone.accepted, true);
  // Y5: a whole-group undo of an open build rewinds it to the start; the revert's field (step 9, done) still never applies.
  assert.deepEqual(body(f).steps, []); assert.equal(body(f).step.n, 1); assert.equal(body(f).done, undefined); assert.equal(f.god.store.build('church')!.status, 'active');
});

test('C1b #8: identical start replay refuses both done and abandoned records', async t => {
  for (const close of ['done', 'abandon']) {
    const f = fixture(); t.after(() => f.db.close()); await f.start(); await f.req(`/v1/god/builds/church/${close}`, {});
    const replay = await f.start(); assert.equal(replay.ok, false); assert.equal(code(replay), 'build.closed'); assert.equal(replay.lease, undefined);
  }
});

test('C1b #13: every build body write is bounded, leaves transition space and cannot wedge public sweeps', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const hugeStart = f.god.builds.start({ id: 'huge', title: 'Huge', steps: ['a'], site: { at: [100, 0], size: [10, 10] } }, { hash: 'a'.repeat(64), label: 'x'.repeat(65_536) });
  assert.equal(code(hugeStart), 'build.limit'); assert.equal(f.god.store.build('huge'), null);
  const s = await f.start(), row = f.god.store.build('church')!;
  const seed = (bytes: number) => {
    const b = body(f); b.plan.brief = ''; b.plan.brief = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(b)));
    const encoded = JSON.stringify(b); assert.equal(Buffer.byteLength(encoded), bytes);
    f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE world_id=? AND id=?').run(encoded, f.god.store.worldId, 'church');
    (f.god.builds as any).rows.get('church').body = b;
  };
  seed(65_250);
  for (const [action, data] of [['pause', { note: 'x'.repeat(1000) }], ['done', { summary: 'x'.repeat(1000) }]] as const) {
    const out = await f.req(`/v1/god/builds/church/${action}`, data); assert.equal(out.status, 200); assert.equal(code(out.data), 'build.limit');
    assert.equal(out.data.failures[0].field, 'build'); assert.ok(out.data.failures[0].measured > out.data.failures[0].limit);
  }
  const before = f.god.store.build('church');
  const act = (await f.req('/v1/god/act', { ops: [f.place('overflow')], build: f.field(s.lease, { step: 2, label: '\u0001'.repeat(60) }), clientRef: 'overflow' })).data;
  assert.equal(code(act), 'build.limit'); assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.get('overflow'), undefined); assert.equal(f.god.store.receipt('overflow'), null);
  // Store-level defenses cover direct saves and a caller bypassing the planner's size guard.
  const write = { id: 'church', expectRev: row.rev, status: row.status, lastAt: row.last_at, body: JSON.stringify({ padding: 'x'.repeat(65_536) }) };
  assert.equal(code(f.god.store.saveBuild(write)), 'build.limit');
  assert.equal(code(f.god.store.saveBuild({ ...write, body: '{' })), 'build.limit', 'SQLite CHECK fallback is a refusal');
  assert.equal(code(f.god.store.insertBuild('invalid', f.now(), '{')), 'build.limit');
  seed(60_000); const writes = f.god.builds.writes.bind(f.god.builds);
  for (const encoded of [write.body, '{']) {
    f.god.builds.writes = (...args) => { const planned = writes(...args); for (const w of planned.writes) w.body = encoded; return planned; };
    assert.equal(code(f.god.act({ ops: [f.place('store-overflow')], build: f.field(s.lease) })), 'build.limit');
    assert.equal(f.god.model.get('store-overflow'), undefined);
  }
  f.god.builds.writes = writes;
  // Simulate a pre-fix durable row without reserved space. It cannot prevent other rows transitioning.
  seed(65_530); const other = await f.start({ id: 'other', site: { at: [100, 0], size: [10, 10] }, massing: [] }); assert.equal(other.ok, true);
  f.advance(501);
  for (const path of ['/v1/world/snapshot', '/v1/world/builds', '/v1/world/seq']) { const out = await f.req(path, undefined, null); assert.equal(out.status, 200, path); }
  assert.ok(JSON.parse(f.god.store.build('other')!.body).closureLapsedAt);
  assert.ok(f.god.store.build('church')!.body.length <= 65_536);
  // A healthy row near the admission bound has enough room for both persisted lazy markers.
  seed(65_260); f.god.builds.sweep(); assert.equal(f.god.store.build('church')!.status, 'paused'); assert.ok(body(f).closureLapsedAt);
});

function journalReads(f: ReturnType<typeof fixture>, work: () => void) {
  const db = f.db.db as any, prepare = db.prepare.bind(db), reads: { sql: string; args: any[] }[] = [];
  db.prepare = (sql: string) => new Proxy(prepare(sql), { get(target, key) {
    const value = Reflect.get(target, key); if (typeof value !== 'function') return value;
    return (...args: any[]) => { if ((key === 'all' || key === 'get') && /^SELECT/.test(sql) && sql.includes('world_edits_v1')) reads.push({ sql, args }); return value.apply(target, args); };
  } });
  try { work(); } finally { db.prepare = prepare; }
  return reads;
}
function indexedReads(f: ReturnType<typeof fixture>, reads: ReturnType<typeof journalReads>, index: string) {
  assert.ok(reads.length > 0);
  for (const q of reads) {
    const plan = f.db.db.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.args) as { detail: string }[];
    assert.ok(plan.some(p => p.detail.includes(index)), JSON.stringify(plan));
    assert.ok(!plan.some(p => /SCAN world_edits_v1/.test(p.detail)), JSON.stringify(plan));
  }
}

test('C1b #14: group views use index seeks and small projections; status reads its journal once', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted(f.god.act({ ops: [f.place('one')], build: f.field(s.lease), note: 'first' }));
  const insert = f.db.db.prepare("INSERT INTO world_edits_v1(world_id,seq,by,at,note,grp,ops,inverse,kind) VALUES(?,?,'god',0,?,?,?,?,'engine')");
  f.db.db.exec('BEGIN'); for (let i = 2; i <= 1000; i++) insert.run(f.god.store.worldId, i, 'noise', i < 250 ? 'church/interior' : 'church-neighbour', '[]', 'not parsed'); f.db.db.exec('COMMIT');
  f.db.db.prepare("UPDATE world_edits_v1 SET inverse='not parsed' WHERE world_id=? AND seq=1").run(f.god.store.worldId);
  f.god.store.groupEditsUnder = () => { throw Error('views must not parse complete edit/inverse rows'); };
  let view: any;
  const list = journalReads(f, () => { view = f.god.builds.list().open[0]; }); indexedReads(f, list, 'world_edits_v1_grp_seq');
  assert.equal(view.current.recent[0].note, 'first'); assert.ok(list.every(q => !/\bops\b|\binverse\b/.test(q.sql)));
  let status: any;
  const reads = journalReads(f, () => { status = f.god.builds.status('church'); }); indexedReads(f, reads, 'world_edits_v1_grp_seq'); assert.equal(reads.length, 1);
  assert.equal(status.journal.length, 200); assert.ok(status.journal.every((e: any) => e.grp.startsWith('church/'))); assert.equal(status.build.current.recent[0].seq, 1, 'current notes survive >200 newer undo/engine rows');
  assert.ok(!/\binverse\b/.test(reads[0].sql)); assert.deepEqual(status.journal[0].ops, { count: 0, kinds: [] });
  const range = journalReads(f, () => { f.god.store.buildRecent('church', 1, 1000); f.god.store.hasGroupUnder('missing'); }); indexedReads(f, range, 'world_edits_v1_grp_seq');
});

test('C1b #15: touch and sweep skip unused views; route transitions share one view and massing one point pass', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const builds = f.god.builds as any, view = builds.view.bind(builds); let views = 0;
  builds.view = (...args: any[]) => { views++; return view(...args); };
  const s = await f.start({ massing: Array.from({ length: 8 }, (_, i) => ({ name: `m${i}`, at: [0, 0], size: [20, 20], h: 4 })) }); assert.equal(views, 1);
  assertAccepted(f.god.act({ ops: [f.place('one')], build: f.field(s.lease) })); views = 0;
  f.advance(14); f.god.builds.touch(f.god.godIdentity(f.token)!.hash); assert.equal(views, 0, 'alive write discards no view');
  f.advance(501); f.god.builds.sweep(); assert.equal(views, 0, 'pause and closure lift discard no view');
  const model = f.god.model, footprints = model.footprintsOf.bind(model); let points = 0;
  model.footprintsOf = (...args) => { points++; return footprints(...args); };
  const resumed = f.god.builds.resume('church', {}, f.god.godIdentity(f.token)!); assert.equal(resumed.ok, true); assert.equal(views, 1); assert.equal(points, 1);
  assert.ok(resumed.ok && resumed.build.massing.every(m => m.parts === 1));
});

test('C1b #16: untracked root warnings use the root index for changed ids and ancestors once per build', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted(f.god.act({ ops: [f.place('root'), { ...f.place('child'), in: { parent: 'root' }, p: [0, 0] }], build: f.field(s.lease) }));
  const row = (f.god.builds as any).rows.get('church'); row.body.roots.includes = () => { throw Error('linear root lookup'); };
  const index = f.god.builds.rootIndex, get = index.get.bind(index); let lookups = 0;
  index.get = id => { lookups++; return get(id); };
  const result = f.god.act({ ops: [{ op: 'set', id: 'root/child', name: 'renamed' }] }); assertAccepted(result);
  assert.equal(result.accepted && result.warnings.filter(w => w.includes('progress not recorded')).length, 1);
  assert.ok(lookups <= 4, `bounded ancestor lookups: ${lookups}`);
});

test('C1b #17: empty and mixed undo stacks seek the partial index instead of scanning history', t => {
  const f = fixture(); t.after(() => f.db.close());
  const insert = f.db.db.prepare("INSERT INTO world_edits_v1(world_id,seq,by,at,grp,ops,inverse,undone,kind) VALUES(?,?,'god',0,'noise','[]','[]',?,?)");
  f.db.db.exec('BEGIN'); for (let i = 1; i <= 2000; i++) insert.run(f.god.store.worldId, i, 1, i % 3 ? 'edit' : 'undo'); insert.run(f.god.store.worldId, 2001, 0, 'engine'); f.db.db.exec('COMMIT');
  let reads = journalReads(f, () => { assert.equal(f.god.store.undoable(), null); assert.equal(f.god.store.redoable(), null); }); indexedReads(f, reads, 'world_edits_v1_stack');
  for (const [seq, kind] of [[2002, 'edit'], [2003, 'redo'], [2004, 'undo']] as const) insert.run(f.god.store.worldId, seq, 0, kind);
  assert.equal(f.god.store.undoable()!.seq, 2003); assert.equal(f.god.store.redoable()!.seq, 2004);
  const clear = "UPDATE world_edits_v1 INDEXED BY world_edits_v1_stack SET undone=1 WHERE world_id=? AND kind='undo' AND undone=0";
  const plan = f.db.db.prepare('EXPLAIN QUERY PLAN ' + clear).all(f.god.store.worldId) as { detail: string }[]; assert.ok(plan.some(p => p.detail.includes('world_edits_v1_stack')));
  f.db.db.prepare(clear).run(f.god.store.worldId); assert.equal(f.god.store.redoable(), null);
  f.db.db.prepare("UPDATE world_edits_v1 SET undone=1 WHERE world_id=? AND kind IN ('edit','redo')").run(f.god.store.worldId);
  reads = journalReads(f, () => { assert.equal(f.god.store.undoable(), null); }); indexedReads(f, reads, 'world_edits_v1_stack');
});

test('bench: 300 five-place build commits with two live claims versus none; 200-upsert check', t => {
  const summary: any = {};
  const fixtures = [false, true].map(withClaims => {
    const f = fixture({ buildPauseMs: 600_000 }); t.after(() => f.db.close());
    const started = f.god.builds.start({ id: 'church', title: 'Claims bench', steps: ['shell'], site: { at: [0, 0], size: [200, 200] } }, f.god.godIdentity(f.token)!) as any;
    const build = f.field(started.lease);
    assertAccepted(f.god.act({ ops: [f.place('east-anchor', -80, 90), f.place('tower-anchor', 80, 90)], build }));
    if (withClaims) for (const [part, root, x] of [['east-aisle', 'east-anchor', -80], ['tower', 'tower-anchor', 80]] as const) assert.equal(f.god.builds.claim('church', { part, root, region: { at: [x, 90], size: [12, 12] } }, f.god.godIdentity(f.other)!).ok, true);
    return { f, build, work: [] as number[], withClaims };
  });
  for (let batch = 0; batch < 300; batch++) for (const sample of fixtures) {
    const { f, build } = sample, ops = Array.from({ length: 5 }, (_, j) => { const i = batch * 5 + j; return f.place(`c-${i}`, -96 + i % 49 * 4, -96 + Math.floor(i / 49) * 4); });
    let r: any; sample.work.push(work(() => { r = f.god.act({ ops, build, clientRef: `claims-bench-${batch}` }); }).total); assertAccepted(r);
  }
  for (const { f, build, withClaims } of fixtures) {
    const before = f.god.model, after = before.fork();
    const upserts = Array.from(before.entities.values()).slice(2, 202).map(e => ({ ...e, v: e.v + 1 }));
    for (const e of upserts) { after.delete(e.id); after.insert(e); }
    const diff = { upserts, removes: [], defs: [], tiles: [], answers: [] }, admission = f.god.builds.admit(build, {}, f.god.godIdentity(f.token)!);
    let r: any; const check200 = work(() => { r = f.god.builds.check(admission, before, after, diff, []); }).total; assert.ok('made' in r);
    summary[withClaims ? 'twoLiveClaims' : 'none'] = { check200Work: check200, diff: upserts.length };
  }
  const overhead = fixtures[1].work.map((w, i) => w - fixtures[0].work[i]);
  summary.commitWork = { none: p95(fixtures[0].work), twoLiveClaims: p95(fixtures[1].work) }; summary.overheadWork = p95(overhead);
  summary.check200Overhead = summary.twoLiveClaims.check200Work - summary.none.check200Work;
  console.log('CLAIM_BENCH ' + JSON.stringify(summary));
  assert.ok(summary.overheadWork.p95 <= CLAIM_WORK.overheadP95, `claims p95 overhead work ${summary.overheadWork.p95} exceeds ${CLAIM_WORK.overheadP95}`);
  assert.ok(summary.check200Overhead <= CLAIM_WORK.check200Overhead, `200-upsert check overhead work ${summary.check200Overhead}`);
});


test('RL2: group commit failure rolls back every row and observer; successful chain retains redo', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  for (let i = 0; i < 3; i++) assertAccepted(f.god.act({ ops: [f.place(`atomic-${i}`, i * 4)], build: f.field(s.lease), group: `part-${i}` }));
  const before = JSON.stringify(f.god.model.snapshot()), rows = f.god.store.edits(), rev = f.god.store.buildsRev(), events = f.emitted.length;
  f.db.db.exec(`CREATE TEMP TRIGGER fail_group BEFORE INSERT ON world_edits_v1 WHEN NEW.kind='undo' AND NEW.undo_of=${rows[1].seq} BEGIN SELECT RAISE(ABORT, 'injected undo failure'); END;`);
  assert.throws(() => f.god.undoGroup('church'), /injected undo failure/);
  assert.equal(JSON.stringify(f.god.model.snapshot()), before); assert.deepEqual(f.god.store.edits(), rows); assert.equal(f.god.store.buildsRev(), rev); assert.equal(f.emitted.length, events);
  assert.equal(f.god.store.load()!.model.entities.size, 3);
  f.db.db.exec('DROP TRIGGER fail_group');
  const undone = f.god.undoGroup('church'); assert.equal(undone.accepted, true); assert.equal(undone.reverted.length, 3); assert.equal(f.god.model.entities.size, 0);
  for (let i = 0; i < 3; i++) assertAccepted(f.god.redo());
  assert.equal(f.god.model.entities.size, 3); assert.equal(f.god.store.edits().filter(e => e.kind === 'undo').length, 3);
});

test('CE4: brief, later asks and linked chapters survive restart; public channels and non-creator tokens cannot read them', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const s = await f.start({ brief: 'Owner verbatim: “quiet green spires”', asks: ['Walk inside [use]', 'Keep the oak'] });
  const step = { lease: s.lease, asks: ['Sit by the window [use]'] };
  assert.equal((await f.req('/v1/god/builds/church/step', step)).data.ok, true);
  assert.equal((await f.req('/v1/god/builds/church/step', step)).data.replayed, true);
  const read = (await f.req('/v1/god/builds/church')).data;
  assert.deepEqual(read.build.plan.asks, ['Walk inside [use]', 'Keep the oak', 'Sit by the window [use]']);
  assertAccepted(f.god.act({ ops: [f.place('chapter-one')], build: f.field(s.lease) }));
  const done = (await f.req('/v1/god/builds/church/done', {})).data;
  assert.equal(done.ok, true); assert.equal(done.receipt.openAsks, 3); assert.ok(done.receipt.warnings.some((w: string) => /asks remain unverified/.test(w)));
  const chapter = await f.start({ id: 'church-2', root: 'church', brief: 'Follow-up words: copper roof', asks: ['Copper roof'] });
  assert.equal(chapter.ok, true); assert.equal(chapter.build.chapterOf, 'church');
  assert.equal(chapter.build.chapters[0].brief, s.build.plan.brief);
  const first = JSON.stringify(f.god.model.get('chapter-one'));
  assertAccepted(f.god.act({ ops: [f.place('chapter-two', 8)], build: { id: 'church-2', lease: chapter.lease } }));
  const undo = f.god.undoGroup('church-2'); assert.equal(undo.accepted, true); assert.equal(f.god.model.get('chapter-two'), undefined); assert.equal(JSON.stringify(f.god.model.get('chapter-one')), first);
  const restarted = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, emit() {} });
  assert.equal(restarted.builds.status('church-2')!.build.plan.brief, 'Follow-up words: copper roof');
  assert.equal(restarted.builds.status('church-2')!.build.chapters![0].brief, s.build.plan.brief);
  for (const auth of [null, 'owner', 'god_another-world_fixture']) for (const path of ['/v1/god/builds', '/v1/god/builds/church', '/v1/god/builds/church-2']) assert.equal((await f.req(path, undefined, auth)).status, 401);
  const publicData = JSON.stringify([f.god.publicSnapshot(), f.god.builds.publicList(), f.emitted]);
  for (const word of ['quiet green spires', 'Follow-up words', 'Walk inside [use]', 'Copper roof', 'receipt', 'refusalCount', 'chapterOf']) assert.equal(publicData.includes(word), false, word);
});

test('WD4: existing outsiders refuse with a one-retry include fix; remove/reparent cannot smuggle them into the build', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [f.place('oak-4', 30), f.place('outside-seat', 25)] }));
  const s = await f.start(), build = f.field(s.lease), seq = f.god.model.editSeq;
  for (const op of [{ op: 'move', id: 'oak-4', p: [32, 0] }, { op: 'remove', id: 'outside-seat' }, { op: 'set', id: 'oak-4', name: 'stolen-tree' }]) {
    const refused = f.god.act({ ops: [op], build }); assert.equal(code(refused), 'build.outside'); assert.match((refused as any).failures[0].fix, /build step --include/); assert.equal(f.god.model.editSeq, seq);
  }
  const step = (await f.req('/v1/god/builds/church/step', { lease: s.lease, include: ['oak-4'] })).data;
  assert.equal(step.ok, true); assertAccepted(f.god.act({ ops: [{ op: 'move', id: 'oak-4', p: [32, 0] }], build }));
  const receipt = (await f.req('/v1/god/builds/church/check', {})).data.receipt;
  assert.equal(receipt.refused.count, 3); assert.ok(receipt.refused.recent.every((r: any) => r.code === 'build.outside'));
  assert.equal(receipt.preservation.outside[0].path, 'oak-4'); assert.equal(receipt.preservation.outside[0].included, true);
  assert.equal(receipt.undoability.ok, true);
  assert.equal(f.god.undoGroup('church').accepted, true); assert.equal(f.god.model.get('oak-4')!.p![0], 30);
});

test('WD4: start includes are canonical, unknown includes fail before writes, engine write-backs remain exempt', async t => {
  const f = fixture(); t.after(() => f.db.close()); assertAccepted(f.god.act({ ops: [f.place('old', 30)] }));
  assert.equal(code(await f.start({ include: ['missing'] })), 'build.site'); assert.equal(f.god.store.build('church'), null);
  const s = await f.start({ include: ['old'] }); assert.deepEqual(body(f).include, [f.god.model.get('old')!.id]);
  assertAccepted(f.god.act({ ops: [{ op: 'remove', id: 'old' }], build: f.field(s.lease) }));
  assertAccepted(f.god.engineAct([f.place('engine-part', 32) as any], 'fixture engine part'));
  assertAccepted(f.god.engineAct([{ op: 'move', id: 'engine-part', p: [35, 0], mode: 'strict' }], 'fixture write-back'));
  const before = JSON.stringify(body(f));
  assert.equal(code((await f.req('/v1/god/builds/church/step', { lease: s.lease, include: ['missing'] })).data), 'build.site'); assert.equal(JSON.stringify(body(f)), before);
});

test('EF3: check is read-only, done stores a warning receipt naming an A2-class outside change and undo conflict', async t => {
  const f = fixture(); t.after(() => f.db.close()); assertAccepted(f.god.act({ ops: [f.place('oak-4', 30)] }));
  const s = await f.start({ include: ['oak-4'], asks: ['An open nave'] });
  assertAccepted(f.god.act({ ops: [{ op: 'move', id: 'oak-4', p: [32, 0] }], build: f.field(s.lease) }));
  assertAccepted(f.god.act({ ops: [f.place('receipt-seat')], build: f.field(s.lease) }));
  // A later independent removal makes the original move inverse impossible.
  assertAccepted(f.god.act({ ops: [{ op: 'remove', id: 'oak-4' }] }));
  const before = JSON.stringify(f.god.model.snapshot()), journal = f.god.store.edits(), rev = f.god.store.buildsRev(), events = f.emitted.length;
  const checked = (await f.req('/v1/god/builds/church/check', {})).data.receipt;
  assert.equal(checked.undoability.ok, false); assert.equal(checked.undoability.edits, 2); assert.ok(checked.undoability.conflicts.length); assert.ok(checked.preservation.outside.some((p: any) => p.path === 'oak-4'));
  assert.equal(JSON.stringify(f.god.model.snapshot()), before); assert.deepEqual(f.god.store.edits(), journal); assert.equal(f.god.store.buildsRev(), rev); assert.equal(f.emitted.length, events);
  assert.equal((await f.req('/v1/god/builds/church/check', {}, null)).status, 401);
  assert.equal((await f.req('/v1/god/builds/missing/check', {})).status, 404);
  const done = (await f.req('/v1/god/builds/church/done', {})).data; assert.equal(done.ok, true); assert.deepEqual(done.receipt, checked); assert.deepEqual(f.god.builds.body('church')!.done!.receipt, checked);
  assert.equal(checked.viewerCost.triangles.added, null); assert.equal(checked.viewerCost.draws.added, null);
});

test('EF3: done:true checks the final batch; valid receipts count compiled uses and cost shares', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted(f.god.act({ ops: [f.place('last-seat')], build: f.field(s.lease, { done: true }) }));
  const receipt = f.god.builds.body('church')!.done!.receipt!; assert.equal(receipt.seq, f.god.model.editSeq); assert.equal(receipt.exists.count, 1); assert.equal(receipt.undoability.ok, true); assert.equal(receipt.undoability.edits, 1);
  assert.ok(receipt.uses.some(u => u.path === 'last-seat')); assert.ok(receipt.viewerCost.triangles.world > 0); assert.equal(receipt.viewerCost.triangles.share, 1); assert.equal(receipt.viewerCost.colliders.share, 1);
});

test('EF2: start returns sampled ground, neighbour footprints and ratios, fit, closure inventory and approach in <=3KB', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'neighbour', p: [20, 0] }, f.place('inside-zone', 0)] }));
  f.god.builds.inventoryContext = () => ({ occupied: () => false, places: [{ id: 'plaza', name: 'Meeting plaza', polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] }], bodies: [{ name: 'Fixture resident', at: [0, 0] }] });
  const s = await f.start({ title: 'Quiet garden' }); assert.equal(s.ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(s.report)) <= 3072); assert.equal(s.report.ground.samples, 289); assert.ok(s.report.ground.min <= s.report.ground.max);
  assert.ok(s.report.neighbours.some((n: any) => n.path === 'neighbour' && n.footprint.length)); assert.ok(s.report.eaves.max > 0); assert.equal(s.report.masses[0].fits, true); assert.ok(s.report.masses[0].maxRatio > 0);
  assert.equal(s.report.closure.counts.things, 1); assert.equal(s.report.closure.counts.bodies, 1); assert.equal(s.report.approach.from, 'Meeting plaza'); assert.deepEqual(s.report.approach.line[1], [0, 0]); assert.equal(s.report.approach.checked, false); assert.ok(s.report.library.length <= 5);
  assert.equal((await f.start({ title: 'Quiet garden' })).replayed, true);
});

test('EF3: checked receipts have a separate durable allowance, so a full legacy record can still finish', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start();
  const legacy = body(f) as any; legacy.paused = { from: f.now(), seenAt: f.now(), note: 'p'.repeat(62_000) };
  assert.ok(Buffer.byteLength(JSON.stringify(legacy)) < 65_000);
  f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE id=?').run(JSON.stringify(legacy), 'church');
  const god = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, emit() {} });
  const done = god.builds.done('church', {}, god.godIdentity(f.token)!); assert.equal(done.ok, true);
  if (!done.ok) return;
  assert.ok(done.build.done!.receipt); assert.ok(Buffer.byteLength(JSON.stringify(done.build.done!.receipt)) <= 10_000);
  assert.ok(god.store.buildReceipt('church'));
  const restored = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, emit() {} });
  assert.deepEqual(restored.builds.status('church')!.build.done!.receipt, done.build.done!.receipt);
});

test('EF2: crowded closure reports bound Unicode data by bytes and retain full inventory counts', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.god.builds.inventoryContext = () => ({ occupied: () => false, places: Array.from({ length: 55 }, (_, i) => ({ id: `place-${i}`, name: '木'.repeat(1000), polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][] })), bodies: Array.from({ length: 55 }, () => ({ name: '人'.repeat(1000), at: [0, 0] as [number, number] })) });
  const start = await f.start(); assert.equal(start.ok, true); assert.ok(Buffer.byteLength(JSON.stringify(start.report)) <= 3072); assert.equal(start.report.truncated, true); assert.equal(start.report.closure.counts.places, 55); assert.equal(start.report.closure.counts.bodies, 55);
});

test('WD4: terrain followers are exempt, and build-created parts outside the site are still editable', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [f.place('follower', 45)] })); const s = await f.start();
  assertAccepted(f.god.act({ ops: [{ op: 'place', def: coreRef('knoll'), name: 'new-land', p: [30, 0], params: { height: 2, radius: 25 } }], build: f.field(s.lease) }));
  assert.ok(f.god.model.get('follower')); assert.equal(f.god.model.get('follower')!.p!.length, 3);
  assertAccepted(f.god.act({ ops: [f.place('offsite', 100)], build: f.field(s.lease) }));
  assertAccepted(f.god.act({ ops: [{ op: 'move', id: 'offsite', p: [105, 0] }], build: f.field(s.lease) }));
  const receipt = f.god.checkBuild('church')!.receipt; assert.ok(receipt.exists.paths.includes('offsite')); assert.ok(receipt.massingOutside!.count > 0);
});
