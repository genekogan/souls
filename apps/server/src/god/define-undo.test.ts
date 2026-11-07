import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { type DefInput, type Result } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { GodMode, type WorldDiffMessage } from './god.ts';
import { mountGodRoutes } from './routes.ts';

const post = (size: [number, number, number]): DefInput => ({ schema: 'def/1', name: 'probe-post', size: { box: size }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, size[1] / 2, 0], size }] } } });
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'god-define-undo-')), db = new Db(':memory:'), emitted: WorldDiffMessage[] = [];
  const opts = { worldId: 'define-undo', ownerId: 'owner', tick: () => 100, emit: (m: WorldDiffMessage) => emitted.push(m), assetDir: join(dir, 'assets') };
  const god = new GodMode(db, opts), token = god.mintFor({ id: 'owner', role: 'user' }, 'fixture'), app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Define undo', requireUser: async () => { throw Error('unused'); }, soulFromBearer: () => null, baseOf: () => 'http://fixture.invalid', limitIp: () => {} });
  const request = async (path: string, body = {}) => {
    const r = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal(r.status, 200); return await r.json() as any;
  };
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { god, db, opts, emitted, request };
}
const ok = (r: Result) => { assert.equal(r.accepted, true, JSON.stringify(r)); if (!r.accepted) throw Error('refused'); return r; };

test('group undo passes first and identical definitions, removes all placements, and supports redo', async t => {
  const f = fixture(t), group = 'g';
  const bench = ok(f.god.act({ group, ops: [{ op: 'place', def: 'core/bench@1', name: 'bench', p: [0, 0] }] }));
  const definition = ok(f.god.act({ group, ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }] }));
  const identical = ok(f.god.act({ group, ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }] }));
  const placed = ok(f.god.act({ group, ops: [{ op: 'place', def: 'probe-post@1', name: 'post', p: [5, 0] }] }));
  const r = await f.request('/v1/god/undo?group=g');
  assert.equal(r.accepted, true); assert.deepEqual(r.reverted, [placed.seq, identical.seq, definition.seq, bench.seq]);
  assert.equal(f.god.model.entities.size, 0); assert.ok(f.god.model.def('probe-post@1'));
  for (let i = 0; i < 4; i++) ok(f.god.redo());
  assert.equal(f.god.model.entities.size, 2);
});

test('RL2: a real mid-group conflict changes nothing and reports every unreverted edit over HTTP', async t => {
  const f = fixture(t), group = 'g';
  const early = ok(f.god.act({ group, ops: [{ op: 'place', def: 'core/bench@1', name: 'early', p: [0, 0] }] }));
  const blocked = ok(f.god.act({ group, ops: [{ op: 'place', def: 'core/bench@1', name: 'blocked', p: [5, 0] }] }));
  const last = ok(f.god.act({ group, ops: [{ op: 'place', def: 'core/bench@1', name: 'last', p: [10, 0] }] }));
  f.god.bodies = { uses: id => id === f.god.model.get('blocked')?.id ? { code: 'body.protected', detail: 'blocked is a resident body' } : null };
  const before = f.god.model.snapshot(), journal = f.god.store.edits(), emitted = f.emitted.length;
  const r = await f.request('/v1/god/undo?group=g');
  assert.equal(r.accepted, false); assert.deepEqual(r.reverted, []); assert.deepEqual(r.notReverted, [last.seq, blocked.seq, early.seq]);
  assert.deepEqual(f.god.model.snapshot(), before); assert.deepEqual(f.god.store.edits(), journal); assert.equal(f.emitted.length, emitted);
  assert.equal(r.failed, blocked.seq); assert.equal(r.failures[0].code, 'body.protected');
  assert.ok(f.god.model.get('early') && f.god.model.get('blocked')); assert.ok(f.god.model.get('last'));
});

test('admitted redefine broadcasts instance changes, persists undo/redo bindings, and keeps retry receipts exact', t => {
  const f = fixture(t);
  ok(f.god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }] }));
  const id = f.god.model.get('post')!.id, old = f.god.model.def('probe-post@1')!.hash;
  const batch = { clientRef: 'redefine', ops: [{ op: 'define', def: post([2, 3, 2]) }] };
  let notifications = 0; f.god.onCommit(() => notifications++);
  const r = ok(f.god.act(batch));
  assert.deepEqual(f.emitted.at(-1)!.diff.upserts.map(e => e.id), [id]);
  assert.deepEqual(f.god.act(batch), { ...r, replayed: true }); assert.equal(notifications, 1);
  ok(f.god.undo()); assert.equal(f.god.model.def('probe-post@1')!.hash, old);
  const loaded = new GodMode(f.db, f.opts);
  assert.equal(loaded.model.def('probe-post@1')!.hash, old); assert.equal(loaded.model.footprintsOf(id)[0].half[0], 0.25);
  assert.deepEqual(loaded.act(batch), { ...r, replayed: true }); assert.equal(loaded.model.def('probe-post@1')!.hash, old);
  ok(loaded.redo()); assert.equal(loaded.model.footprintsOf(id)[0].half[0], 1);
  const again = new GodMode(f.db, f.opts); assert.equal(again.model.footprintsOf(id)[0].half[0], 1);
});

test('overlapping definition retries replan after refusal, then replay the exact admitted receipt', async t => {
  const f = fixture(t);
  ok(f.god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }, { op: 'place', def: 'core/bench@1', name: 'bench', p: [2, 0] }] }));
  const batch = { clientRef: 'retry-definition', ops: [{ op: 'define', def: post([6, 6, 6]) }] }, before = structuredClone(f.god.model.snapshot());
  const refused = await f.request('/v1/god/act', batch);
  assert.equal(refused.accepted, false); assert.equal(refused.failures[0].entity, f.god.model.get('post')!.id);
  assert.equal(f.god.store.receipt(batch.clientRef), null); assert.deepEqual(f.god.model.snapshot(), before);
  ok(f.god.act({ ops: [{ op: 'remove', id: 'bench' }] }));
  const admitted = await f.request('/v1/god/act', batch); assert.equal(admitted.accepted, true);
  assert.deepEqual(await f.request('/v1/god/act', batch), { ...admitted, replayed: true });
  const changed = await f.request('/v1/god/act', { ...batch, ops: [{ op: 'define', def: post([2, 2, 2]) }] });
  assert.equal(changed.accepted, false); assert.equal(changed.failures[0].code, 'request.conflict');
});

test('first definition undo and redo journal accepted no-ops without deleting the stored def', t => {
  const f = fixture(t), definition = ok(f.god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }] }));
  const hash = f.god.model.def('probe-post@1')!.hash;
  const undo = f.god.undo(); ok(undo); assert.equal(undo.reverted, definition.seq);
  assert.equal(f.god.store.edits(3).find(e => e.seq === definition.seq)!.undone, 1);
  assert.equal(f.god.model.def('probe-post@1')!.hash, hash);
  const loaded = new GodMode(f.db, f.opts), redo = loaded.redo(); ok(redo);
  assert.equal(loaded.model.def('probe-post@1')!.hash, hash);
  ok(loaded.undo()); assert.equal(loaded.store.undoable(), null);
});

test('a conflicting definition inverse leaves the current bounds and durable binding unchanged', async t => {
  const f = fixture(t);
  ok(f.god.act({ ops: [{ op: 'define', def: post([6, 6, 6]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }] }));
  const target = ok(f.god.act({ group: 'shrink', ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }] }));
  ok(f.god.act({ ops: [{ op: 'place', def: 'core/bench@1', name: 'bench', p: [2, 0] }] }));
  const before = structuredClone(f.god.model.snapshot());
  const refused = await f.request('/v1/god/undo?group=shrink');
  assert.equal(refused.accepted, false); assert.deepEqual(refused.reverted, []); assert.deepEqual(refused.notReverted, [target.seq]);
  assert.equal(refused.failures[0].code, 'undo.conflict'); assert.equal(refused.failures[0].entity, f.god.model.get('post')!.id);
  assert.deepEqual(f.god.model.snapshot(), before);
  const loaded = new GodMode(f.db, f.opts); assert.equal(loaded.model.def('probe-post@1')!.hash, f.god.model.def('probe-post@1')!.hash);
});

test('SQL failure rolls back an admitted ref change and an empty-inverse undo', t => {
  const f = fixture(t), first = ok(f.god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }] }));
  const before = structuredClone(f.god.model.snapshot());
  f.db.db.exec("CREATE TRIGGER definition_fault BEFORE INSERT ON world_edits_v1 BEGIN SELECT RAISE(ABORT,'fixture definition fault'); END");
  assert.throws(() => f.god.act({ clientRef: 'sql-fault', ops: [{ op: 'define', def: post([2, 3, 2]) }] }), /fixture definition fault/);
  assert.deepEqual(f.god.model.snapshot(), before); assert.equal(f.god.store.receipt('sql-fault'), null);
  assert.throws(() => f.god.undo(), /fixture definition fault/);
  assert.deepEqual(f.god.model.snapshot(), before); assert.equal(f.god.store.undoable()!.seq, first.seq);
  const loaded = new GodMode(f.db, f.opts); assert.equal(loaded.model.def('probe-post@1')!.hash, f.god.model.def('probe-post@1')!.hash);
});
