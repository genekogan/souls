import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { coreLibrary, coreRef, hashOf, type ResidentMove, type Result } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { GOD_EDIT_RECEIPTS, GOD_EDIT_OUTCOME_BYTES } from './store.ts';

function fixture(t: TestContext, file = false) {
  const dir = mkdtempSync(join(tmpdir(), 'god-authoring-'));
  const dbFile = file ? join(dir, 'world.db') : ':memory:';
  const db = new Db(dbFile);
  const emitted: unknown[] = [];
  const opts = { worldId: 'contract', ownerId: 'owner', tick: () => 100, emit: (m: unknown) => emitted.push(m), library: coreLibrary(), assetDir: join(dir, 'assets'), constants: { extent: 128 } };
  const god = new GodMode(db, opts);
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'fixture');
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Contract', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://fixture.invalid', limitIp: () => {} });
  app.onError((err, c) => err instanceof ApiError ? c.json({ code: err.code, message: err.message }, err.status as 400) : c.json({ code: 'internal', message: String(err) }, 500));
  const request = async (path: string, body?: unknown, authorized = true) => {
    const response = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() as any };
  };
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { god, db, dbFile, opts, app, request, token, emitted };
}
const placement = (name?: string) => ({ op: 'place', def: coreRef('bench'), ...(name ? { name } : {}), p: [0, 0] });
const accepted = (r: Result) => { assert.equal(r.accepted, true, JSON.stringify(r)); if (!r.accepted) throw Error('refused'); return r; };

test('R1 exact retries return the original named/unnamed result without commits, callbacks or broadcasts', async t => {
  const f = fixture(t);
  let notifications = 0; f.god.onCommit(() => notifications++);
  const original = f.god.model;
  for (const [name, at] of [['bench', 0], [undefined, 20]] as const) {
    const batch = { clientRef: `place-${at}`, ops: [{ ...placement(name), p: [at, 0] }] };
    const first = await f.request('/v1/god/act', batch);
    assert.equal(first.status, 200); assert.equal(first.data.accepted, true);
    const before = structuredClone(f.god.model.snapshot()), events = f.god.head, count = f.emitted.length;
    // Explicit defaults and different object key order normalize to the same payload.
    const retry = await f.request('/v1/god/act', { ops: [{ mode: 'strict', in: { parent: 'world' }, ...batch.ops[0] }], schema: 'edit/1', clientRef: batch.clientRef });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.data, { ...first.data, replayed: true });
    assert.deepEqual(f.god.model.snapshot(), before); assert.equal(f.god.head, events); assert.equal(f.emitted.length, count);
    const lookup = await f.request(`/v1/god/requests/${batch.clientRef}`);
    assert.equal(lookup.status, 200); assert.equal(lookup.data.world, 'contract'); assert.equal(lookup.data.seq, first.data.seq); assert.deepEqual(lookup.data.result, first.data); assert.match(lookup.data.payloadHash, /^[0-9a-f]{64}$/);
  }
  assert.equal(notifications, 2); assert.equal(f.god.model, original); assert.equal(f.god.model.entities.size, 2);
  assert.equal((await f.request('/v1/god/requests/place-0', undefined, false)).status, 401);
  assert.equal((await f.request('/v1/god/requests/missing')).status, 404);
});

test('same ref with a different normalized payload or note refuses and names the original seq', t => {
  const f = fixture(t), batch = { clientRef: 'conflict', ops: [placement('b')] };
  const first = accepted(f.god.act(batch));
  const before = structuredClone(f.god.model.snapshot());
  for (const changed of [{ ...batch, ops: [{ ...placement('different'), p: [20, 0] }] }, { ...batch, note: 'different' }]) {
    const r = f.god.act(changed); assert.equal(r.accepted, false);
    if (!r.accepted) { assert.equal(r.failures[0].code, 'request.conflict'); assert.match(r.failures[0].detail, new RegExp(`seq ${first.seq}`)); }
    assert.deepEqual(f.god.model.snapshot(), before);
  }
});

test('refusals are not retained: the same request re-plans after its missing entity appears', t => {
  const f = fixture(t), batch = { clientRef: 'refused-then-retry', ops: [{ op: 'remove', id: 'later' }] };
  assert.equal(f.god.act(batch).accepted, false); assert.equal(f.god.store.receipt(batch.clientRef), null);
  accepted(f.god.act({ ops: [placement('later')] }));
  accepted(f.god.act(batch)); assert.equal(f.god.model.get('later'), undefined);
  assert.ok(f.god.store.receipt(batch.clientRef));
});

test('lost-response receipt survives a fresh database connection and caller mutations do not change it', t => {
  const f = fixture(t, true), batch = { clientRef: 'lost', ops: [placement('b')] };
  const first = accepted(f.god.act(batch)), stored = structuredClone(first);
  first.warnings.push('caller mutation'); first.ids.changed = 'caller';
  const reopened = new Db(f.dbFile); t.after(() => reopened.close());
  const other = new GodMode(reopened, { ...f.opts, emit: () => { throw Error('replay must not emit'); } });
  assert.deepEqual(other.act(batch), { ...stored, replayed: true });
  assert.equal(other.model.entities.size, 1); assert.equal(other.store.edits().length, 1);
});

test('planning runs outside SQL write transaction; SQL failure leaves no phantom model, prayer, journal or receipt', t => {
  const f = fixture(t), batch = { clientRef: 'sql-fault', ops: [placement('uncommitted')] };
  const prayer = f.god.pray({ id: 's', name: 'Fixture' }, 'a bench');
  batch.ops.push({ op: 'answer', prayer: prayer.id, text: 'granted' } as never);
  const before = structuredClone(f.god.model.snapshot()), object = f.god.model, head = f.god.head;
  let transaction = false, checked = false;
  const exec = f.db.db.exec.bind(f.db.db);
  f.db.db.exec = (sql: string) => { if (sql === 'BEGIN IMMEDIATE') transaction = true; const result = exec(sql); if (sql === 'COMMIT' || sql === 'ROLLBACK') transaction = false; return result; };
  f.god.bodies = { uses: () => null, refuse: () => { assert.equal(transaction, false); checked = true; return null; } };
  f.db.db.exec("CREATE TRIGGER receipt_fault BEFORE INSERT ON god_edit_receipts_v1 BEGIN SELECT RAISE(ABORT,'fixture receipt fault'); END");
  assert.throws(() => f.god.act(batch), /fixture receipt fault/);
  assert.equal(checked, true); assert.equal(transaction, false); assert.equal(f.god.model, object); assert.deepEqual(f.god.model.snapshot(), before);
  assert.equal(f.god.store.edits().length, 0); assert.equal(f.god.store.receipt(batch.clientRef), null); assert.equal(f.god.store.prayer(prayer.id)!.answer, null);
  assert.equal(f.god.head, head); assert.equal(f.emitted.length, 0);
  f.db.db.exec('DROP TRIGGER receipt_fault');
  accepted(f.god.act({ ops: [{ op: 'world', state: { sky: { sun: .7 } } }] }));
  assert.equal(f.god.model.get('uncommitted'), undefined);
  const committed = accepted(f.god.act(batch)), after = f.god.head;
  assert.equal(f.god.store.prayer(prayer.id)!.answer, 'granted');
  assert.deepEqual(f.god.act(batch), { ...committed, replayed: true }); assert.equal(f.god.head, after);
});

test('forcing store.commit itself to fail preserves the public model', t => {
  const f = fixture(t), before = structuredClone(f.god.model.snapshot()), commit = f.god.store.commit.bind(f.god.store);
  f.god.store.commit = () => { throw Error('forced commit failure'); };
  assert.throws(() => f.god.act({ ops: [placement('phantom')] }), /forced commit failure/);
  assert.deepEqual(f.god.model.snapshot(), before);
  f.god.store.commit = commit;
  accepted(f.god.act({ ops: [{ op: 'world', state: { sky: { sun: .9 } } }] }));
  assert.equal(f.god.model.get('phantom'), undefined);
});

const walkout = (name = 'Ada'): ResidentMove => ({ soulId: `s_${name}`, body: `h_${name}`, name, how: 'walked', from: [0, 0], to: [3, 0], reason: 'The god is building the bench; you stepped aside.', released: [] });
/** G1: a spy for the bridge's walk-out hooks (prepare plans on the would-be world; apply moves residents after SQL). */
function walkoutSpy(f: ReturnType<typeof fixture>) {
  const calls = { prepare: 0, apply: 0, dry: 0, moved: [] as ResidentMove[] };
  f.god.bodies = { uses: () => null, prepare: (before, after, _diff, _ops, o) => { if (o?.dry) calls.dry++; else calls.prepare++; assert.equal(before, f.god.model); assert.notEqual(after, f.god.model); return { moved: [walkout()], warnings: [], touched: [] }; }, apply: moved => { calls.apply++; calls.moved.push(...moved); } };
  return calls;
}

test('G1: walk-out planning runs once before the durable accepted receipt; a retry replays it without moving anyone', t => {
  const f = fixture(t), calls = walkoutSpy(f);
  const batch = { clientRef: 'walkout', ops: [placement('b')] }, first = accepted(f.god.act(batch));
  assert.deepEqual(first.moved, [walkout()]); assert.match(first.warnings.join('\n'), /^body\.walked-out: Ada walked to \(3, 0\); told "The god is building the bench/m);
  assert.deepEqual({ prepare: calls.prepare, apply: calls.apply }, { prepare: 1, apply: 1 }); assert.deepEqual(calls.moved, [walkout()]);
  assert.deepEqual(f.god.store.receipt(batch.clientRef)?.result.moved, [walkout()], 'the durable receipt lists who moved');
  assert.deepEqual(f.god.act(batch), { ...first, replayed: true }); assert.deepEqual({ prepare: calls.prepare, apply: calls.apply }, { prepare: 1, apply: 1 });
  // Previews and dry runs plan who would be walked out (shown to the god) but move nobody.
  const dry = f.god.dryrun({ ops: [{ ...placement('c'), p: [20, 0] }] }) as { accepted: boolean; wouldMove?: unknown };
  const seen = f.god.preview({ ops: [{ ...placement('c'), p: [20, 0] }] }) as { accepted: boolean; wouldMove?: unknown };
  const would = [{ name: 'Ada', soulId: 's_Ada', how: 'walked', to: [3, 0], reason: walkout().reason }];
  assert.equal(dry.accepted, true); assert.deepEqual(dry.wouldMove, would); assert.equal(seen.accepted, true); assert.deepEqual(seen.wouldMove, would);
  assert.deepEqual({ prepare: calls.prepare, apply: calls.apply, dry: calls.dry }, { prepare: 1, apply: 1, dry: 2 });
  // Committing a sealed preview is an edit like any other.
  const pv = f.god.preview({ ops: [{ ...placement('d'), p: [40, 0] }] }); assert.ok(pv.id);
  assert.deepEqual(accepted(f.god.act({ preview: pv.id! })).moved, [walkout()]); assert.deepEqual({ prepare: calls.prepare, apply: calls.apply }, { prepare: 2, apply: 2 });
});

test('a generator failure during body warning geometry is a typed refusal before persistence', t => {
  const f = fixture(t);
  const invalid = f.god.model.defineDef({ schema: 'def/1', name: 'legacy-bad', make: { kind: 'gen', gen: 'no-such-gen/1' }, size: { box: [1, 1, 1] } } as never, 'fixture', 0);
  f.god.bodies = { uses: () => null, lifted: (_ids, after) => { after!.bake(invalid, {}, 0); return []; } };
  const r = f.god.act({ clientRef: 'bad-warning', ops: [placement('b')] });
  assert.equal(r.accepted, false);
  if (!r.accepted) { assert.equal(r.failures[0].code, 'def.invalid'); assert.equal(r.failures[0].op, 0); assert.equal(r.failures[0].def, 'legacy-bad@1'); assert.ok(r.failures[0].fix); }
  assert.equal(f.god.model.entities.size, 0); assert.equal(f.god.store.receipt('bad-warning'), null); assert.equal(f.emitted.length, 0);
});

test('receipt storage is capped per world and refused results use no receipt space', t => {
  const f = fixture(t);
  for (let n = 0; n <= GOD_EDIT_RECEIPTS; n++) accepted(f.god.act({ clientRef: `ref-${n}`, ops: [{ op: 'world', state: { sky: { sun: .5 } } }] }));
  assert.equal((f.db.db.prepare('SELECT count(*) AS n FROM god_edit_receipts_v1 WHERE world_id=?').get('contract') as { n: number }).n, GOD_EDIT_RECEIPTS);
  assert.equal(f.god.store.receipt('ref-0'), null); assert.ok(f.god.store.receipt('ref-1')); assert.ok(f.god.store.receipt(`ref-${GOD_EDIT_RECEIPTS}`));
  assert.equal(f.god.act({ clientRef: 'no', ops: [{ op: 'remove', id: 'absent' }] }).accepted, false); assert.equal(f.god.store.receipt('no'), null);
});

test('receipt byte overage refuses before persistence and can be retried after reducing the outcome', t => {
  const f = fixture(t), batch = { clientRef: 'large-result', ops: [placement('b')] };
  f.god.finalizeAct = result => { if (result.accepted) result.warnings.push('x'.repeat(GOD_EDIT_OUTCOME_BYTES)); return result; };
  const r = f.god.act(batch); assert.equal(r.accepted, false); if (!r.accepted) assert.equal(r.failures[0].code, 'request.budget');
  assert.equal(f.god.model.entities.size, 0); assert.equal(f.god.store.receipt(batch.clientRef), null);
  f.god.finalizeAct = null; accepted(f.god.act(batch));
});

test('R2/R3 malformed, unknown and unsupported agent submissions return typed refusals over Hono', async t => {
  const f = fixture(t);
  const definition = { schema: 'def/1', name: 'spire', size: { box: [2, 8, 2] }, make: { kind: 'gen', gen: 'no-such-gen/1', args: {} } };
  for (const body of [
    { ops: [{ op: 'define', def: definition }] },
    { ops: [{ op: 'define', def: { ...definition, name: 'bad-kit', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'lathe', at: [0, 0, 0], profile: [[0, 0]] }] } } } }, { op: 'place', def: 'bad-kit@1', p: [20, 20] }] },
    { ops: [{ op: 'unsupported' }] },
    { ops: Array.from({ length: 257 }, () => ({ op: 'remove', id: 'absent' })) },
    { ops: [{ op: 'place', def: coreRef('bench'), p: ['bad', 1] }] },
  ]) {
    const r = await f.request('/v1/god/act', body); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.accepted, false);
    assert.equal(typeof r.data.failures[0].op, 'number'); assert.equal(typeof r.data.failures[0].code, 'string');
    assert.ok(r.data.failures[0].field); assert.ok(r.data.failures[0].fix);
  }
  assert.equal(f.god.model.entities.size, 0); assert.equal(f.god.store.edits().length, 0);
});

test('R4 preview refuses a replaced named entity and reports exactly that stale entity', async t => {
  const f = fixture(t);
  accepted(f.god.act({ ops: [placement('b')] }));
  const old = f.god.model.get('b')!;
  const pv = await f.request('/v1/god/preview', { ops: [{ op: 'move', id: 'b', p: [10, 0] }] });
  assert.equal(pv.status, 200); assert.equal(pv.data.accepted, true); assert.equal(pv.data.baseEditSeq, f.god.model.editSeq);
  assert.deepEqual(pv.data.expect.b, { id: old.id, v: old.v });
  accepted(f.god.act({ ops: [{ op: 'remove', id: 'b' }, { ...placement('b'), p: [30, 0] }] }));
  const replacement = structuredClone(f.god.model.get('b')!);
  const r = await f.request('/v1/god/act', { preview: pv.data.id, clientRef: 'stale-preview' });
  assert.equal(r.status, 200); assert.equal(r.data.accepted, false); assert.equal(r.data.failures.length, 1);
  assert.equal(r.data.failures[0].code, 'revision.stale'); assert.equal(r.data.failures[0].entity, old.id);
  assert.deepEqual(f.god.model.get('b'), replacement); assert.equal(f.god.store.receipt('stale-preview'), null);
});

test('preview commits sealed ops after unrelated edits, then replays even after preview loss', async t => {
  const f = fixture(t);
  accepted(f.god.act({ ops: [placement('b'), { ...placement('unrelated'), p: [40, 0] }] }));
  const pv = await f.request('/v1/god/preview', { group: 'preview-group', note: 'sealed note', ops: [{ op: 'move', id: 'b', p: [10, 0] }] });
  accepted(f.god.act({ ops: [{ op: 'move', id: 'unrelated', p: [50, 0] }] }));
  const body = { preview: pv.data.id, clientRef: 'preview-commit' };
  const r = await f.request('/v1/god/act', body); assert.equal(r.data.accepted, true, JSON.stringify(r));
  assert.equal(f.god.model.get('b')!.p![0], 10); assert.equal(f.god.model.get('unrelated')!.p![0], 50);
  assert.equal(f.god.store.edits()[0].grp, 'preview-group'); assert.equal(f.god.store.edits()[0].note, 'sealed note');
  (f.god as any).previews.clear();
  assert.deepEqual((await f.request('/v1/god/act', body)).data, { ...r.data, replayed: true });
  const reopened = new GodMode(f.db, { ...f.opts, emit: () => {} });
  assert.deepEqual(reopened.act(body), { ...r.data, replayed: true });
});

test('preview detects same-id version changes and permits identical explicit ops only', t => {
  const f = fixture(t);
  accepted(f.god.act({ ops: [placement('b')] }));
  const ops = [{ op: 'move', id: 'b', p: [10, 0] }];
  const pv = f.god.preview({ ops }); assert.equal(pv.accepted, true); assert.ok(pv.id);
  const altered = f.god.act({ preview: pv.id, ops: [{ ...ops[0], p: [20, 0] }] });
  assert.equal(altered.accepted, false); if (!altered.accepted) assert.equal(altered.failures[0].code, 'schema');
  assert.equal(f.god.model.get('b')!.p![0], 0);
  accepted(f.god.act({ ops: [{ op: 'move', id: 'b', p: [30, 0] }] }));
  const stale = f.god.act({ preview: pv.id, ops }); assert.equal(stale.accepted, false);
  if (!stale.accepted) { assert.equal(stale.failures[0].code, 'revision.stale'); assert.match(stale.failures[0].detail, /v1; now .* v2/); }
});

test('explicit expectations guard only changed refs and are bound to the retry payload', t => {
  const f = fixture(t);
  accepted(f.god.act({ ops: [placement('b'), { ...placement('other'), p: [40, 0] }] }));
  const b = f.god.model.get('b')!, other = f.god.model.get('other')!;
  const expect = { b: { id: b.id, v: b.v }, other: { id: other.id, v: other.v } };
  accepted(f.god.act({ ops: [{ op: 'move', id: 'other', p: [50, 0] }] }));
  const stale = f.god.act({ expect, ops: [{ op: 'move', id: 'b', p: [10, 0] }] });
  assert.equal(stale.accepted, false); if (!stale.accepted) { assert.equal(stale.failures.length, 1); assert.equal(stale.failures[0].entity, other.id); }
  const batch = { clientRef: 'expected', expect: { b: expect.b }, ops: [{ op: 'move', id: 'b', p: [10, 0] }] };
  const first = accepted(f.god.act(batch)); assert.deepEqual(f.god.act(batch), { ...first, replayed: true });
  const conflict = f.god.act({ ...batch, expect: { b: { id: b.id, v: b.v + 1 } } });
  assert.equal(conflict.accepted, false); if (!conflict.accepted) assert.equal(conflict.failures[0].code, 'request.conflict');
});

test('world meaning guards and previews refuse a concurrent description without blocking unrelated weather', t => {
  const f = fixture(t), empty = hashOf(null);
  const ops = [{ op: 'world', state: { about: { title: 'Reviewed world' } } }];
  const pv = f.god.preview({ ops }); assert.equal(pv.accepted, true);
  accepted(f.god.act({ ops: [{ op: 'world', state: { about: { title: 'Owner description' } } }] }));
  for (const batch of [{ preview: pv.id }, { ops, expectWorldAbout: empty }]) {
    const r = f.god.act(batch); assert.equal(r.accepted, false);
    if (!r.accepted) assert.equal(r.failures[0].code, 'revision.stale');
  }
  const expected = hashOf(f.god.model.state.about);
  accepted(f.god.act({ ops: [{ op: 'world', state: { weather: { kind: 'clear' } } }] }));
  const batch = { ops, expectWorldAbout: expected, clientRef: 'meaning-retry' };
  const first = accepted(f.god.act(batch));
  assert.deepEqual(f.god.act(batch), { ...first, replayed: true });
  assert.equal(f.god.model.state.about?.title, 'Reviewed world');
});

test('preview tracks parent paths, subtree children, and facing references', t => {
  const f = fixture(t);
  accepted(f.god.act({ ops: [{ op: 'place', def: coreRef('table'), name: 'table', tmp: '$t', p: [0, 0] }, { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } }, { ...placement('b'), p: [20, 0] }] }));
  const parent = f.god.model.get('table')!, child = f.god.model.get('table/bowl')!, ref = f.god.model.get('b')!;
  const pv = f.god.preview({ ops: [{ op: 'set', id: 'table/bowl', constraints: [{ kind: 'facing', ref: 'b' }] }] });
  assert.equal(pv.accepted, true); if (!pv.accepted) return;
  assert.deepEqual(pv.expect['table/bowl'], { id: child.id, v: child.v }); assert.ok(pv.expect[parent.id]); assert.ok(pv.expect.b);
  accepted(f.god.act({ ops: [{ op: 'move', id: 'b', p: [30, 0] }] }));
  const stale = f.god.act({ preview: pv.id }); assert.equal(stale.accepted, false);
  if (!stale.accepted) { assert.equal(stale.failures.length, 1); assert.equal(stale.failures[0].entity, ref.id); }
  const clone = f.god.preview({ ops: [{ op: 'clone', id: 'table', p: [0, 30] }] });
  assert.equal(clone.accepted, true); if (!clone.accepted) return;
  assert.ok(clone.expect[child.id]);
  accepted(f.god.act({ ops: [{ op: 'move', id: 'table/bowl', r: 1 }] }));
  const changedChild = f.god.act({ preview: clone.id }); assert.equal(changedChild.accepted, false);
  if (!changedChild.accepted) assert.equal(changedChild.failures[0].code, 'revision.stale');
});

test('expired previews and malformed expectation maps refuse without an HTTP 500', async t => {
  const f = fixture(t);
  for (const body of [{ preview: 'absent' }, { preview: 1 }, { ops: [placement('b')], expect: { b: { id: 'e_1', v: 'bad' } } }, {}]) {
    const r = await f.request('/v1/god/act', body); assert.equal(r.status, 200); assert.equal(r.data.accepted, false);
  }
});

test('preview detects newly added subtree members even when the parent version is unchanged', t => {
  for (const operation of [
    { op: 'clone', id: 'table', p: [0, 30] }, { op: 'remove', id: 'table' },
    { op: 'move', id: 'table', p: [10, 0] }, { op: 'set', id: 'table', params: { top: '#112233' } },
  ]) {
    const f = fixture(t);
    accepted(f.god.act({ ops: [{ op: 'place', def: coreRef('table'), name: 'table', p: [0, 0] }] }));
    const before = structuredClone(f.god.model.get('table')!);
    const pv = f.god.preview({ ops: [operation] }); assert.equal(pv.accepted, true, JSON.stringify(pv));
    accepted(f.god.act({ ops: [{ op: 'place', def: coreRef('bowl'), name: 'new-bowl', in: { parent: 'table', slot: 'top' } }] }));
    assert.equal(f.god.model.get('table')!.v, before.v);
    const child = f.god.model.get('table/new-bowl')!;
    const r = f.god.act({ preview: pv.id }); assert.equal(r.accepted, false);
    if (!r.accepted) {
      assert.equal(r.failures.length, 1); assert.equal(r.failures[0].code, 'revision.stale'); assert.equal(r.failures[0].entity, before.id);
      assert.deepEqual(r.failures[0].measured, { added: [child.id], removed: [] });
    }
    assert.deepEqual(f.god.model.get('table'), before); assert.ok(f.god.model.get(child.id));
  }
});

test('preview guards descendant reference identity even when replacing the ref preserves the descendant pose', t => {
  const f = fixture(t);
  accepted(f.god.act({ ops: [{ op: 'place', def: coreRef('table'), name: 'table', p: [0, 0] }, { ...placement('b'), p: [20, 0] }, { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: 'table', slot: 'top' }, constraints: [{ kind: 'facing', ref: 'b' }] }] }));
  const old = f.god.model.get('b')!, child = structuredClone(f.god.model.get('table/bowl')!);
  const pv = f.god.preview({ ops: [{ op: 'clone', id: 'table', p: [0, 30] }] }); assert.equal(pv.accepted, true);
  accepted(f.god.act({ ops: [{ op: 'remove', id: 'b' }, { ...placement('b'), p: [20, 0] }] }));
  assert.deepEqual(f.god.model.get(child.id), child);
  const r = f.god.act({ preview: pv.id }); assert.equal(r.accepted, false);
  if (!r.accepted) { assert.equal(r.failures.length, 1); assert.equal(r.failures[0].entity, old.id); }
});

test('preview refuses newly affected external dependents while allowing unrelated additions', t => {
  const f = fixture(t);
  accepted(f.god.act({ ops: [placement('b')] }));
  const pv = f.god.preview({ ops: [{ op: 'move', id: 'b', p: [0, 10] }] }); assert.equal(pv.accepted, true);
  accepted(f.god.act({ ops: [{ op: 'place', def: coreRef('bowl'), name: 'follower', p: [-20, 0], constraints: [{ kind: 'facing', ref: 'b' }] }] }));
  const follower = f.god.model.get('follower')!;
  const r = f.god.act({ preview: pv.id }); assert.equal(r.accepted, false);
  if (!r.accepted) { assert.equal(r.failures.length, 1); assert.equal(r.failures[0].entity, follower.id); assert.equal(r.failures[0].field, 'preview.affected'); }
  assert.equal(f.god.model.get('b')!.p![2], 0);
  const fresh = f.god.preview({ ops: [{ op: 'move', id: 'b', p: [0, 10] }] }); assert.equal(fresh.accepted, true);
  accepted(f.god.act({ ops: [{ ...placement('unrelated'), p: [50, 0] }] }));
  accepted(f.god.act({ preview: fresh.id }));
});

test('G1: a refused or failed request never moves a resident; undo and redo walk residents out like any edit', t => {
  const f = fixture(t), calls = walkoutSpy(f);
  const batch = { clientRef: 'refused-first', ops: [{ op: 'remove', id: 'later' }] };
  const r = f.god.act(batch); assert.equal(r.accepted, false); assert.deepEqual({ prepare: calls.prepare, apply: calls.apply }, { prepare: 0, apply: 0 }); assert.equal(f.god.store.receipt(batch.clientRef), null);
  accepted(f.god.act({ ops: [placement('later')] })); assert.equal(calls.apply, 1);
  const commit = f.god.store.commit.bind(f.god.store); f.god.store.commit = () => { throw Error('forced commit failure'); };
  try { assert.throws(() => f.god.act(batch), /forced commit failure/); } finally { f.god.store.commit = commit; }
  assert.equal(calls.apply, 1, 'a failed SQL commit moves nobody'); assert.ok(f.god.model.get('later'));
  const removed = accepted(f.god.act(batch)); assert.deepEqual(removed.moved, [walkout()]); assert.equal(calls.apply, 2);
  const undo = accepted(f.god.undo()); assert.deepEqual(undo.moved, [walkout()]); assert.ok(undo.warnings.some(w => w.startsWith('body.walked-out: Ada')));
  const redo = accepted(f.god.redo()); assert.deepEqual(redo.moved, [walkout()]); assert.equal(calls.apply, 4);
  assert.deepEqual(f.god.act(batch), { ...removed, replayed: true }); assert.equal(calls.apply, 4);
});

test('empty refs stay lookupable and unknown prayers are repairable refusals', async t => {
  const f = fixture(t);
  const r = await f.request('/v1/god/act', { clientRef: '', ops: [placement('b')] }); assert.equal(r.data.accepted, true);
  const lookup = await f.request('/v1/god/requests/'); assert.equal(lookup.status, 200); assert.equal(lookup.data.clientRef, '');
  const missing = await f.request('/v1/god/act', { clientRef: 'unknown-prayer', ops: [{ op: 'answer', prayer: 'missing', text: 'reply' }] });
  assert.equal(missing.status, 200); assert.equal(missing.data.accepted, false); assert.equal(missing.data.failures[0].field, 'prayer');
  assert.equal(f.god.store.receipt('unknown-prayer'), null);
});

test('schema and status expose the same protocol/schema/skill/source versions', async t => {
  const f = fixture(t);
  const schema = await f.request('/v1/god/schema'), status = await f.request('/v1/god/status');
  assert.deepEqual(schema.data.versions, status.data.versions);
  assert.equal(status.data.versions.protocol, 'god/1'); assert.equal(status.data.versions.schema, 'god-schema/1'); assert.equal(status.data.versions.skill, '1.7');
  assert.equal(typeof status.data.versions.source, 'string'); assert.ok(status.data.versions.source.length > 0);
  assert.ok(schema.data.submission); assert.ok(schema.data.refusals.includes('revision.stale'));
});
