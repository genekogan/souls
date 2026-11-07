import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Hono } from 'hono';
import { coreLibrary, coreRef } from '@souls/world-compiler';
import { meter, work } from '@souls/world-compiler/work-meter';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type GodOptions } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { searchDefs } from './assets.ts';
import type { BuildBody } from './builds.ts';
import type { VerifyUse, VerifyReceipt } from './verify-use.ts';

function fixture(t: TestContext, options: Partial<GodOptions> = {}, shared?: Db, verifyUse?: VerifyUse) {
  const dir = mkdtempSync(join(tmpdir(), 'r1-parts-')), db = shared ?? new Db(':memory:'); let now = 1_000_000;
  const god = new GodMode(db, { worldId: 'parts-test', ownerId: 'owner', tick: () => 42, now: () => now, assetDir: dir, ...options, emit() {} });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'maker'), identity = god.godIdentity(token)!;
  t.after(() => { if (!shared) db.close(); rmSync(dir, { recursive: true, force: true }); });
  const app = new Hono(); mountGodRoutes(app, { god, worldName: 'Parts', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'test'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5367', limitIp() {}, verifyUse });
  app.onError((e, c) => c.json({ code: (e as ApiError).code ?? 'internal', message: String(e) }, ((e as ApiError).status ?? 500) as 400));
  const req = async (path: string, body?: unknown, auth: string | null = token) => {
    const r = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json() as any };
  };
  const act = (ops: unknown[], build?: { id: string; lease: string; done?: boolean }, group?: string, clientRef?: string) => god.as({ identity }, () => god.act({ ops, build, group, clientRef }));
  const start = (id = 'first', x = 0, extra = {}) => { const s = god.builds.start({ id, title: 'Gothic tower', steps: ['tower'], site: { at: [x, 0], size: [80, 80] }, ...extra }, identity); assert.equal(s.ok, true, JSON.stringify(s)); if (!s.ok) throw new Error('start'); return { id, lease: s.lease }; };
  const done = (id = 'first') => god.builds.done(id, {}, identity);
  const query = (table: string) => db.db.prepare(`SELECT * FROM ${table} WHERE world_id=?`).all(god.opts.worldId).map(r => ({ ...r })) as any[];
  return { god, db, dir, token, identity, app, req, act, start, done, query, advance: (n = 10) => { now += n; } };
}
const kit = (name = 'gothic-tower', color = '#336699', extra = {}) => ({ schema: 'def/1', name, version: 1, size: { box: [1, 1, 1] }, layer: 'decor', description: 'Gothic church tower', tags: ['gothic'], make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, .5, 0], size: [1, 1, 1], color }], round: 0 } }, ...extra });
const define = (def = kit()) => ({ op: 'define', def });
const place = (def = 'gothic-tower@1', name = 'tower', x = 0, extra = {}) => ({ op: 'place', def, name, p: [x, 0], ...extra });
const accepted = (r: any) => assert.equal(r.accepted, true, JSON.stringify(r));
const uses = (f: ReturnType<typeof fixture>) => f.query('god_part_uses_v1').filter(r => r.hash !== '-').map(r => ({ hash: r.hash, ...JSON.parse(r.body) }));
const hash = (f: ReturnType<typeof fixture>, ref = 'gothic-tower@1') => f.god.model.def(ref)!.hash;

// Origins and durable transaction boundaries.
test('act origins record exact caller, seq, group and wall time; retries do not duplicate them', async t => {
  const f = fixture(t), b = f.start();
  const input = { ops: [define(), place()], build: b, group: 'details', clientRef: 'origin-once' };
  const r = (await f.req('/v1/god/act', input)).data; accepted(r);
  assert.deepEqual(f.query('god_def_origins_v1'), [{ world_id: 'parts-test', hash: hash(f), seq: r.seq, ref: 'gothic-tower@1', at: 1_000_000, grp: 'first/details', label: 'maker', hash8: f.identity.hash.slice(0, 8), exact: 1 }]);
  assert.equal((await f.req('/v1/god/act', input)).data.replayed, true); assert.equal(f.query('god_def_origins_v1').length, 1);
  const other = f.god.mintFor({ id: 'owner', role: 'user' }, 'sculptor');
  accepted((await f.req('/v1/god/act', { ops: [define(kit('helper-kit'))] }, other)).data);
  assert.equal(f.query('god_def_origins_v1').find(o => o.ref === 'helper-kit@1').label, 'sculptor');
});
test('an origin SQL failure rolls back defs, journal, receipt and model', t => {
  const f = fixture(t);
  f.db.db.exec("CREATE TRIGGER fail_origin BEFORE INSERT ON god_def_origins_v1 BEGIN SELECT RAISE(ABORT,'origin failure'); END");
  assert.throws(() => f.act([define()], undefined, undefined, 'failed'), /origin failure/);
  for (const table of ['world_defs_v1', 'world_edits_v1', 'god_edit_receipts_v1', 'god_def_origins_v1']) assert.equal(f.query(table).length, 0);
  assert.equal(f.god.model.editSeq, 0); assert.equal(f.god.model.def('gothic-tower@1'), undefined);
});
test('adoption and identical library define have no origin; undo and redo author no new origin', t => {
  const f = fixture(t), libraryDef = coreLibrary().get(coreRef('bench'))!;
  accepted(f.act([place(coreRef('bench'), 'bench')]));
  accepted(f.act([define(libraryDef as never)])); assert.equal(f.query('god_def_origins_v1').length, 0);
  accepted(f.act([define()])); const before = f.query('god_def_origins_v1');
  accepted(f.god.undo()); accepted(f.god.redo()); assert.deepEqual(f.query('god_def_origins_v1'), before);
});
test('genesis defines have null identity and never become parts', t => {
  const f = fixture(t, { genesis: { schema: 'genesis/1', batches: [{ ops: [define(), place()] }] } });
  assert.equal(f.query('god_def_origins_v1')[0].label, null);
  const b = f.start('first', 0, { root: 'tower' }); f.done(b.id); assert.deepEqual(uses(f), []);
});
test('identical content in two builds gets two origins and keeps first-defined credit', t => {
  const f = fixture(t), first = f.start(); accepted(f.act([define(), place()], first)); f.done(); f.advance();
  const second = f.start('second', 100); accepted(f.act([define(), place('gothic-tower@1', 'again', 100)], second)); f.done('second');
  assert.equal(f.query('god_def_origins_v1').length, 2); assert.equal(uses(f).length, 2);
  assert.ok(uses(f).every(u => u.definedInBuild)); assert.ok(uses(f).every(u => u.origin.seq === 1));
  assert.deepEqual(f.god.parts.reuseOf('second'), { newDefs: 1, placedFromParts: 1, fromBuilds: ['first'], kept: ['gothic-tower@1'], recorded: true });
});


test('multiple revisions defined inside one batch each retain their own exact hash origin', t => {
  const f = fixture(t), b = f.start();
  accepted(f.act([define(), place(), define(kit('gothic-tower', '#993366'))], b));
  const origins = f.query('god_def_origins_v1'); assert.equal(origins.length, 2); assert.equal(origins[0].seq, origins[1].seq);
  assert.notEqual(origins[0].hash, origins[1].hash); f.done(); assert.equal(uses(f).length, 1); assert.equal(uses(f)[0].hash, hash(f));
});

// Promotion at both done paths and its exclusions.
test('route done and in-batch done promote synchronously with exact in-batch origins', async t => {
  const f = fixture(t); const b = f.start(); accepted(f.act([define(), place()], b));
  const r = await f.req('/v1/god/builds/first/done', {}); assert.equal(r.data.reuse.recorded, true); assert.equal(r.data.build.reuse.newDefs, 1);
  f.advance(); const second = f.start('second', 100);
  accepted(f.act([define(kit('second-tower')), place('second-tower@1', 'second', 100)], { ...second, done: true }));
  assert.equal(uses(f).length, 2); assert.equal(uses(f).find(u => u.build.id === 'second').origin.exact, true);
});
test('abandoned and abandon-undo builds do not promote', t => {
  const f = fixture(t); const b = f.start(); accepted(f.act([define(), place()], b));
  assert.equal(f.god.builds.abandon('first', {}, () => { throw new Error('unexpected'); }).ok, true);
  const second = f.start('second', 100); accepted(f.act([define(kit('abandoned-kit')), place('abandoned-kit@1', 'gone', 100)], second));
  const r = f.god.as({ identity: f.identity }, () => f.god.builds.abandon('second', { undo: true }, () => f.god.undoGroupUnder('second'))); assert.equal(r.ok, true);
  assert.deepEqual(f.query('god_part_uses_v1'), []);
});
test('undone definitions and replaced west-front revision are not parts; redo survives', t => {
  const f = fixture(t); const first = f.start(); accepted(f.act([define(), place()], first)); accepted(f.god.undo()); f.done(); assert.deepEqual(uses(f), []);
  const second = f.start('second'); accepted(f.act([define(kit('buttress')), place('buttress@1', 'buttress', 3), define(kit('spire')), place('spire@1', 'spire', 6), define(kit('west-front')), place('west-front@1', 'front')], second)); const old = hash(f, 'west-front@1');
  accepted(f.act([define(kit('west-front', '#993366'))], second)); const kept = hash(f, 'west-front@1');
  accepted(f.god.undo()); accepted(f.god.redo()); f.done('second');
  assert.equal(uses(f).length, 3); assert.ok(uses(f).some(u => u.hash === kept)); assert.ok(uses(f).every(u => u.hash !== old));
});
test('extends, definition-valued parameters and default overrides count standing instances', t => {
  const f = fixture(t), b = f.start();
  accepted(f.act([define(), define(kit('other-kit')), define(kit('child-kit', '#336699', { extends: 'gothic-tower@1', make: { kind: 'none' } })),
    define(kit('param-kit', '#336699', { params: { item: { type: 'string', default: 'gothic-tower@1' } } })),
    place('child-kit@1', 'child'), place('param-kit@1', 'param', 3), place('param-kit@1', 'override', 6, { params: { item: 'other-kit@1' } })], b));
  f.done(); const rows = uses(f); assert.equal(rows.length, 4);
  const base = rows.find(u => u.hash === hash(f)); assert.equal(base.placed, 2); assert.equal(base.via, 'extends');
  assert.equal(rows.find(u => u.hash === hash(f, 'other-kit@1')).placed, 1);
  assert.ok(rows.find(u => u.hash === hash(f, 'child-kit@1')).closure.includes(hash(f)));
});
test('title, lead, done details and first-defined credit survive build pruning', t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place()], b)); f.done(); const saved = uses(f)[0];
  // Exercise the actual closed-build pruning via saveBuild, without creating 201 worlds or live sites.
  const row = f.god.store.build('first')!, body = JSON.parse(row.body) as BuildBody;
  const insert = f.db.db.prepare('INSERT INTO god_builds_v1 VALUES(?,?,?,?,?,?,?)');
  for (let i = 1; i <= 200; i++) insert.run('parts-test', `closed-${i}`, 'done', row.rev + i, row.created_at, row.last_at, JSON.stringify({ ...body, id: `closed-${i}` }));
  const newest = f.god.store.build('closed-200')!;
  assert.equal(f.god.store.saveBuild({ id: newest.id, expectRev: newest.rev, status: 'done', lastAt: newest.last_at, body: newest.body }), null);
  assert.equal(f.god.store.build('first'), null); assert.deepEqual(uses(f)[0], saved);
  assert.match(f.god.parts.list()[0].firstBy!, /^maker#/);
});
test('64 parts per build, 4000 use rows per world, SQL body caps, append-only reports', async t => {
  const f = fixture(t), b = f.start();
  const ops = Array.from({ length: 65 }, (_, i) => [define(kit('part-' + i)), place(`part-${i}@1`, `part-${i}`, i % 10)]).flat();
  // Compiler per-batch op budget is independent of the parts cap.
  for (let i = 0; i < ops.length; i += 40) accepted(f.act(ops.slice(i, i + 40), b));
  const done = (await f.req('/v1/god/builds/first/done', {})).data;
  assert.equal(uses(f).length, 64); assert.equal(done.reuse.recorded, false); assert.equal(done.reuse.code, 'parts.cap');
  const body = f.query('god_part_uses_v1')[0].body;
  assert.throws(() => f.db.db.prepare('INSERT INTO god_part_uses_v1 VALUES(?,?,?,?,?)').run('parts-test', 'oversize', 'too-big', 0, JSON.stringify({ text: 'é'.repeat(2048) })), /CHECK/);
  const insert = f.db.db.prepare('INSERT INTO god_part_uses_v1 VALUES(?,?,?,?,?)');
  const count = f.query('god_part_uses_v1').length;
  for (let i = count; i < 4000; i++) insert.run('parts-test', '-', `marker-${i}`, i, '{}');
  const next = f.start('next', 100); accepted(f.act([define(kit('cap-kit')), place('cap-kit@1', 'capped', 100)], next));
  const r = (await f.req('/v1/god/builds/next/done', {})).data; assert.equal(r.ok, true); assert.equal(r.reuse.code, 'parts.cap'); assert.equal(r.reuse.recorded, false);
  assert.equal(f.query('god_part_uses_v1').length, 4000); assert.equal(f.query('god_part_uses_v1')[0].body, body);
});
test('a failed parts hook never refuses a committed done; backfill repairs it', t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place()], b));
  const onDone = f.god.parts.onDone.bind(f.god.parts); f.god.parts.onDone = () => { throw new Error('hook failure'); };
  assert.equal(f.done().ok, true); assert.equal(f.god.store.build('first')!.status, 'done'); assert.deepEqual(uses(f), []);
  f.god.parts.onDone = onDone; f.god.parts.backfill(); assert.equal(uses(f)[0].source, 'backfill');
});

// Recovery, current standing, world isolation.
test('boot backfill recomputes normalized hashes, is idempotent and marks inexact observations', t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place()], b)); f.done();
  f.db.db.exec("DELETE FROM god_def_origins_v1; DELETE FROM god_part_uses_v1; UPDATE world_meta_v1 SET body=json_remove(body,'$.partsOriginsV1')");
  const loaded = new GodMode(f.db, f.god.opts); assert.equal(loaded.parts.list().length, 1);
  assert.equal(f.query('god_def_origins_v1')[0].exact, 0); const row = uses(f)[0]; assert.equal(row.source, 'backfill'); assert.equal(row.origin.exact, false); assert.equal(row.observedAt, 1_000_000);
  const before = f.query('god_part_uses_v1'); loaded.parts.backfill(); new GodMode(f.db, f.god.opts);
  assert.deepEqual(f.query('god_part_uses_v1'), before);
  assert.equal(loaded.store.meta()!.partsOriginsV1, true);
  f.db.db.exec("CREATE TRIGGER forbid_backfill BEFORE INSERT ON god_def_origins_v1 BEGIN SELECT RAISE(ABORT,'origins rescanned'); END");
  assert.doesNotThrow(() => new GodMode(f.db, f.god.opts));
});
test('an empty done build has a scan marker and never rescans later standing parts', t => {
  const f = fixture(t), b = f.start(); f.done(); assert.equal(f.query('god_part_uses_v1')[0].hash, '-');
  accepted(f.act([define(), place()]));
  const row = f.god.store.build(b.id)!; const body = JSON.parse(row.body) as BuildBody; body.roots = [f.god.model.get('tower')!.id];
  f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE world_id=? AND id=?').run(JSON.stringify(body), 'parts-test', b.id);
  f.god.parts.backfill(); assert.deepEqual(uses(f), []);
});
test('backfill and counters do not truncate early defines beyond 200 group edits', t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place()], b));
  for (let i = 0; i < 205; i++) accepted(f.act([{ op: 'move', id: 'tower', p: [i % 2, 0] }], b));
  f.done(); assert.equal(f.god.parts.reuseOf(b.id).newDefs, 1);
  f.db.db.exec("DELETE FROM god_def_origins_v1; DELETE FROM god_part_uses_v1; UPDATE world_meta_v1 SET body=json_remove(body,'$.partsOriginsV1')");
  new GodMode(f.db, f.god.opts); assert.equal(uses(f).length, 1); assert.equal(f.query('god_def_origins_v1')[0].seq, 1);
});
test('standing cache invalidates on editSeq; removed parts stay listed and rank last', t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place(), define(kit('gothic-spire')), place('gothic-spire@1', 'spire', 3)], b)); f.done();
  assert.equal(f.god.parts.placedNow(hash(f)), 1); assert.equal(f.god.parts.placedNow(hash(f)), 1);
  accepted(f.act([{ op: 'remove', id: 'tower' }])); assert.equal(f.god.parts.placedNow(hash(f)), 0);
  const list = f.god.parts.list('gothic'); assert.equal(list.length, 2); assert.equal(list.at(-1)!.ref, 'gothic-tower@1'); assert.match(list.at(-1)!.firstBy!, /^maker#/);
  accepted(f.god.undo()); assert.equal(f.god.parts.placedNow(hash(f)), 1);
  accepted(f.god.undo()); assert.equal(f.god.parts.list().every(p => p.placedNow === 0), true);
});
test('world_id scopes origins, parts, receipts, backfill and find misses on a shared database', async t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const a = fixture(t, { worldId: 'world-a' }, db), b = fixture(t, { worldId: 'world-b' }, db);
  const build = a.start(); accepted(a.act([define(), place()], build)); a.done(); await a.req('/v1/god/verify-use', { target: 'tower' });
  assert.equal(b.god.parts.list().length, 0); assert.equal((await b.req('/v1/god/parts')).data.parts.length, 0);
  assert.equal(b.query('god_def_origins_v1').length, 0); assert.equal(b.query('god_verify_receipts_v1').length, 0);
  b.god.parts.backfill(); assert.equal(b.god.parts.list().length, 0);
  await b.req('/v1/god/defs?q=zzzz'); assert.equal(b.query('god_find_misses_v1').length, 1);
  assert.equal(a.query('god_find_misses_v1').length, 0);
});

// Observed verification facts only.
const receipt = (target = 'tower', ok = true): VerifyReceipt => ({ ok, target, uses: [{ use: 'enter', ok }], probe: { created: true, removed: true, removal: 'done' }, timings: { birth: 0, start: 0, enter: 1, sit: 0, retire: 0 }, ms: 12, notes: [] });
test('verify-use route persists one bounded receipt for each call with resolved entity, hash and caller', async t => {
  const f = fixture(t, {}, undefined, { run: async () => receipt() } as unknown as VerifyUse);
  accepted(f.act([define(), place()]));
  const r = await f.req('/v1/god/verify-use', { target: 'tower' }); assert.equal(r.data.ok, true);
  await f.req('/v1/god/verify-use', { target: 'tower' });
  const rows = f.query('god_verify_receipts_v1'); assert.equal(rows.length, 2); assert.notEqual(rows[0].at, rows[1].at);
  assert.equal(rows[0].entity, f.god.model.get('tower')!.id); assert.equal(rows[0].def_hash, hash(f)); assert.equal(rows[0].ok, 1); assert.equal(rows[0].edit_seq, f.god.model.editSeq); assert.equal(rows[0].label, 'maker');
  assert.deepEqual(JSON.parse(rows[0].body), { uses: [{ use: 'enter', ok: true }], ms: 12 });
  assert.equal((await f.req('/v1/god/verify-use', { target: 'tower' }, null)).status, 401); assert.equal(f.query('god_verify_receipts_v1').length, 2);
});

test('minimal verifier outcomes still persist a row and cannot invent entity or use evidence', async t => {
  const f = fixture(t, {}, undefined, { run: async () => ({ ok: true }) } as unknown as VerifyUse);
  const r = await f.req('/v1/god/verify-use', { target: 'unknown' }); assert.equal(r.status, 200);
  const rows = f.query('god_verify_receipts_v1'); assert.equal(rows.length, 1); assert.equal(rows[0].entity, ''); assert.equal(rows[0].def_hash, null);
  assert.deepEqual(JSON.parse(rows[0].body), { uses: [], ms: 0 });
});

test('verify receipts keep newest 1000, enforce byte cap and exclude other worlds when pruning', t => {
  const f = fixture(t); accepted(f.act([define(), place()]));
  f.db.db.prepare('INSERT INTO god_verify_receipts_v1 VALUES(?,?,?,?,?,?,?,?,?)').run('other-world', 0, 'foreign', 0, null, 0, null, null, '{}');
  for (let i = 0; i < 1005; i++) f.god.parts.recordVerify(receipt('tower', i % 2 === 0), f.identity);
  const rows = f.query('god_verify_receipts_v1'); assert.equal(rows.length, 1000); assert.equal(Math.min(...rows.map(r => r.at)), 1_000_005);
  assert.ok(rows.every(r => Buffer.byteLength(r.body) <= 1024));
  assert.equal(f.db.db.prepare("SELECT count(*) AS n FROM god_verify_receipts_v1 WHERE world_id='other-world'").get()!.n, 1);
  assert.throws(() => f.db.db.prepare('INSERT INTO god_verify_receipts_v1 VALUES(?,?,?,?,?,?,?,?,?)').run('parts-test', 9, 'huge', 0, null, 0, null, null, JSON.stringify({ x: 'x'.repeat(1024) })), /CHECK/);
});
test('done copies latest checks per in-root target after start, no checks claims for decorative kits', async t => {
  const f = fixture(t, {}, undefined, { run: async () => receipt() } as unknown as VerifyUse); const b = f.start();
  accepted(f.act([define(), place(), place('gothic-tower@1', 'outside', 100)], b));
  f.god.parts.recordVerify(receipt('outside'), f.identity); f.god.parts.recordVerify(receipt('tower', false), f.identity); f.god.parts.recordVerify(receipt(), f.identity);
  f.done(); const row = uses(f)[0]; assert.equal(row.checks.buildUse.length, 1); assert.equal(row.checks.buildUse[0].target, 'tower'); assert.equal(row.checks.buildUse[0].ok, true); assert.equal(row.checks.partUse, 'n/a');
  for (let i = 0; i < 1001; i++) f.god.parts.recordVerify(receipt('outside'), f.identity);
  assert.deepEqual(uses(f)[0].checks, row.checks);
});
test('unobserved build checks say none-recorded; interactive part checks cite matching targets only', t => {
  const f = fixture(t), b = f.start();
  accepted(f.act([define(), place()], b)); f.done(); assert.equal(uses(f)[0].checks.buildUse, 'none-recorded');
  f.advance(); const next = f.start('next', 100);
  accepted(f.act([define(kit('interactive', '#336699', { slots: [{ id: 'seat', kind: 'seat', p: [0, 0, 0] }] })), place('interactive@1', 'seat', 100)], next));
  f.god.parts.recordVerify(receipt('seat'), f.identity); f.done('next');
  const row = uses(f).find(u => u.build.id === 'next'); assert.equal(row.checks.partUse[0].target, 'seat'); assert.equal(row.checks.partUse[0].ok, true);
});


test('receipts before build start and checks for a replaced revision are never part passes', t => {
  const f = fixture(t);
  const seated = (color: string) => kit('gothic-tower', color, { slots: [{ id: 'seat', kind: 'seat', p: [0, 0, 0] }] });
  accepted(f.act([define(seated('#336699')), place()]));
  f.god.parts.recordVerify(receipt(), f.identity); f.advance(20);
  const b = f.start('first', 0, { root: 'tower' });
  f.god.parts.recordVerify(receipt(), f.identity);
  accepted(f.act([define(seated('#993366'))], b)); f.done();
  assert.equal(uses(f)[0].checks.partUse, 'none-recorded');
  assert.equal(uses(f)[0].checks.buildUse.length, 1);
});
test('dependency closure records non-library hashes and world-local asset provenance without rewriting defs', t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place()], b));
  const d = f.god.model.def('gothic-tower@1')!, asset = 'f'.repeat(64), fp = 'e'.repeat(64);
  // Seed already-admitted mesh content to test metadata alone; promotion must not bake or read asset files.
  const mesh = f.god.model.defineDef({ schema: 'def/1', name: 'mesh-part', version: 1, extends: 'sha:' + d.hash, make: { kind: 'mesh', asset, footprint: fp }, size: { box: [1, 1, 1] } }, 'god', 42);
  f.db.db.prepare('INSERT INTO god_def_origins_v1 VALUES(?,?,?,?,?,?,?,?,?)').run('parts-test', mesh.hash, 99, mesh.ref, 1_000_000, 'first', 'maker', f.identity.hash.slice(0, 8), 1);
  f.db.db.prepare('INSERT INTO world_assets_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('parts-test', asset, 'mesh', 'glb', 100, 12, 0, '[1,1,1]', 'mesh', 'CC0', null, 'uploader', 0);
  const e = f.god.model.get('tower')!; f.god.model.entities.set(e.id, { ...e, def: 'sha:' + mesh.hash });
  const before = JSON.stringify(mesh); f.done();
  const row = uses(f).find(u => u.hash === mesh.hash); assert.ok(row.closure.includes(d.hash));
  assert.deepEqual(row.assets, [{ sha: fp, license: null, by: null }, { sha: asset, license: 'CC0', by: 'uploader' }]);
  assert.equal(JSON.stringify(f.god.model.def('sha:' + mesh.hash)), before);
});

// Reuse and discovery.
test('sha placement pins the second build, preserves first-build entities and name redefinition warns', async t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place()], b)); f.done(); const original = hash(f), first = structuredClone(f.god.model.get('tower'));
  f.advance(); const start = (await f.req('/v1/god/builds', { id: 'second', title: 'Another gothic tower', steps: ['tower'], brief: 'reuse the gothic kit', site: { at: [100, 0], size: [80, 80] } })).data;
  assert.equal(start.parts[0].sha, original); assert.equal(start.parts[0].place, `place sha:${original} …`);
  accepted(f.act([place('sha:' + original, 'pinned', 100)], { id: 'second', lease: start.lease }));
  assert.deepEqual(f.god.model.get('tower'), first); assert.equal(f.god.parts.reuseOf('second').placedFromParts, 1);
  const redef = f.act([define(kit('gothic-tower', '#993366'))]); accepted(redef);
  assert.match((redef as any).warnings.join('\n'), /gothic-tower@1.*done build first.*1 copies placed by name/);
  assert.equal(f.god.model.def(f.god.model.get('pinned')!.def)!.hash, original); assert.notEqual(hash(f), original);
  assert.equal(f.god.parts.list('gothic').some(p => p.sha === original), true);
  assert.equal((await f.req('/v1/god/defs/sha:' + original)).data.parts[0].build.id, 'first');
});
test('search tie favors a standing used part over core, while higher scores always win', () => {
  const core = { name: 'core-brick', ref: 'core-brick@1', hash: 'core', tags: ['stone'] }, part = { name: 'local-brick', ref: 'local-brick@1', hash: 'part', tags: ['stone'] };
  assert.equal(searchDefs([core, part], 'stone', { used: h => h === 'part' })[0].def.hash, 'part');
  assert.equal(searchDefs([core, part], '', { used: h => h === 'part' })[0].def.hash, 'part');
  assert.equal(searchDefs([core, part], 'brick', { used: h => h === 'part' })[0].def.hash, 'core');
});
test('used badges appear on compact and full find rows', async t => {
  const f = fixture(t), b = f.start(); accepted(f.act([define(), place()], b)); f.done();
  for (const compact of ['', '&compact=1']) {
    const r = (await f.req('/v1/god/defs?q=gothic' + compact)).data;
    assert.equal(r.defs[0].used[0].build, 'first'); assert.equal(r.defs[0].usedIn[0].placedNow, 1);
  }
});
test('start parts are bounded to eight and 2KB, empty before a done build, parts needs god token', async t => {
  const f = fixture(t); assert.equal((await f.req('/v1/god/parts', undefined, null)).status, 401);
  const start = (await f.req('/v1/god/builds', { id: 'first', title: 'Gothic tower', steps: ['tower'], site: { at: [0, 0], size: [80, 80] } })).data;
  assert.deepEqual(start.parts, []);
  for (let i = 0; i < 12; i++) accepted(f.act([define(kit('gothic-' + i)), place(`gothic-${i}@1`, `tower-${i}`, i * 2)], { id: 'first', lease: start.lease }));
  f.done(); const suggested = f.god.parts.suggest(start.build); assert.ok(suggested.length > 0 && suggested.length <= 8); assert.ok(Buffer.byteLength(JSON.stringify(suggested)) <= 2048);
  const all = (await f.req('/v1/god/parts?q=gothic&limit=2')).data; assert.equal(all.parts.length, 2);
  for (const path of ['/v1/world/builds', '/v1/world/snapshot']) {
    const text = JSON.stringify((await f.req(path, undefined, null)).data); assert.equal(text.includes(f.identity.hash), false); assert.equal(text.includes(f.identity.hash.slice(0, 8)), false); assert.equal(text.includes('maker'), false);
  }
});
test('a find miss is logged once at offset zero', async t => {
  const f = fixture(t); await f.req('/v1/god/defs?q=zqxwzqxw'); await f.req('/v1/god/defs?q=offset-only&offset=1');
  assert.equal(f.query('god_find_misses_v1').length, 1); assert.equal(f.query('god_find_misses_v1')[0].query, 'zqxwzqxw');
});

// Measured 2026-10-20: onDone 70,049 (13 per node), origins overhead -0.06%. Budgets are about 2x.
const ONDONE_WORK = 140_000, ORIGINS_TOTAL_PCT = 2;
// Z3: work budgets, not milliseconds (see @souls/world-compiler/work-meter): the same answer on any CPU, so these run in the gate.
test('bench: onDone with 256 roots and 5000 entities stays below 20ms', t => {
  const f = fixture(t); accepted(f.act([define()])); const b = f.start();
  const roots: string[] = [];
  for (let i = 0; i < 5000; i++) { const id = 'e_' + i, parent = i < 256 ? 'world' : 'e_' + (i % 256); if (i < 256) roots.push(id);
    f.god.model.insert({ id, def: 'gothic-tower@1', name: 'part-' + i, in: { parent }, p: [0, 0, 0], by: 'god', born: 0, v: 1 }); }
  const row = f.god.store.build(b.id)!, body = JSON.parse(row.body) as BuildBody; body.roots = roots; body.done = { at: 1_000_000, byLabel: 'maker' };
  f.db.db.prepare("UPDATE god_builds_v1 SET status='done',body=? WHERE world_id=? AND id=?").run(JSON.stringify(body), 'parts-test', b.id);
  const at = performance.now(), { work: w } = meter(() => f.god.parts.onDone(b.id)), ms = performance.now() - at;
  console.log(`PARTS_BENCH onDone ms=${ms.toFixed(3)} work=${JSON.stringify(w)}`);
  // Linear in the subtree (5256 nodes), a few units of work per node; a scan of every entity per root is ~1.3M.
  assert.ok(w.total <= ONDONE_WORK, `onDone work ${w.total} > ${ONDONE_WORK}: ${JSON.stringify(w)}`); assert.ok(w.sql <= 16, `onDone SQL statements ${w.sql}`);
  assert.equal(uses(f)[0].placed, 5000);
});
test('bench: median act overhead with origins versus without origins is below 2%', t => {
  const f = fixture(t), withOrigins: number[] = [], withoutOrigins: number[] = [], origins = f.god.parts.origins.bind(f.god.parts);
  // M2's design fixture has four define edits among 24 edits: one define per six batches.
  // Pair identical workloads, alternate order, and include both define and ordinary placement batches.
  const refs = new Map<boolean, string>();
  for (let i = 0; i < 240; i++) for (const enabled of i % 2 ? [false, true] : [true, false]) {
    f.god.parts.origins = enabled ? origins : () => [];
    const name = `bench-${i}-${Number(enabled)}`, ops: unknown[] = [];
    if (i % 6 === 0) { ops.push(define(kit(name))); refs.set(enabled, name + '@1'); }
    ops.push(place(refs.get(enabled)!, name, 0));
    const w = work(() => accepted(f.act(ops))).total;
    if (i > 39) (enabled ? withOrigins : withoutOrigins).push(w);
  }
  const median = (a: number[]) => a.sort((a, b) => a - b)[a.length >> 1], yes = median(withOrigins), no = median(withoutOrigins), overhead = (yes / no - 1) * 100;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), total = (sum(withOrigins) / sum(withoutOrigins) - 1) * 100;
  console.log(`PARTS_BENCH act workload=1-define-per-6-batches median work origins=${yes} baseline=${no} overhead=${overhead.toFixed(2)}% total overhead=${total.toFixed(2)}%`);
  assert.ok(overhead < 2, String(overhead)); assert.ok(total < ORIGINS_TOTAL_PCT, `total origins overhead ${total}%`);
});
