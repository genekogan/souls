import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type Op } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { commsFixture } from '../edge/comms/testing.ts';
import { GodNav } from './nav.ts';
import { GodPerceive, type BuiltState } from './perceive.ts';

function fixture(t: TestContext, charge: () => void) {
  const db = new Db(':memory:');
  const f = commsFixture(['Alice'], { sweepMs: 0 }, { dir: '', db, clock: { now: 1_800_000_000_000 } });
  t.after(() => { f.close(); db.close(); });
  const model = new WorldModel({ constants: { extent: 500, ground: 'land' }, seed: 'perceive-slice-budget' });
  for (const def of CORE_KIT) model.defineDef(def, 'core', 0);
  let version = 0;
  const act = (ops: Op[]) => {
    const result = applyBatch(model, { ops }, 'god', ++version);
    assert.equal(result.result.accepted, true, JSON.stringify(result.result));
  };
  act(Array.from({ length: 9 }, (_, i) => ({ op: 'place' as const, def: 'core-sign@1', name: `sign-${i}`,
    in: { parent: 'world' }, mode: 'strict' as const, p: [i * 20, 0] as [number, number], state: { text: `initial-${i}` } })));
  const ids = [...model.entities.keys()];
  assert.equal(ids.length, 9);
  const edge = Object.assign(f.ledger, { comms: f.runtime, places: { byId: new Map([
    ['eden-commons', { id: 'eden-commons', parent: null }],
  ]) } });
  const nav = new GodNav({ model, version: () => version, describeStamp: () => 'stable-ground',
    engine: f.host.engine as never, engineOwned: () => false, levelAt: () => 0 });
  const visited: string[] = [], created: string[] = [], advanced: string[] = [], messages: string[] = [];
  const perceive = new GodPerceive({ model, version: () => version, edge: edge as never, engine: f.host.engine as never,
    engineOwned: () => false, levelAt: () => 0, things: () => nav.things(),
    namesNear(at, except) { visited.push(except); const names = nav.namesNear(at, except); charge(); return names; },
    log: message => messages.push(message) });
  const objects = f.runtime.objects, create = objects.create.bind(objects);
  t.mock.method(objects, 'create', (input: Parameters<typeof objects.create>[0]) => {
    const result = create(input);
    assert.equal(db.db.isTransaction, false, 'a completed creation has committed before the slice may yield');
    created.push(input.id); return result;
  });
  // The durable log is WITHOUT ROWID and only orders each object's versions.
  // Observe FIFO at each real refresh transaction's return, then verify its committed log.
  const refresh = objects.refresh.bind(objects);
  const lastLog = db.db.prepare('SELECT version,action FROM edge_comms_object_log WHERE world_id=? AND object_id=? ORDER BY version DESC LIMIT 1');
  t.mock.method(objects, 'refresh', (queue: Iterable<string>) => refresh((function* () {
    for (const id of queue) {
      const before = lastLog.get(f.host.worldId, id) as { version: number; action: string };
      yield id;
      assert.equal(db.db.isTransaction, false, 'refresh committed this object before requesting the next ID');
      const after = lastLog.get(f.host.worldId, id) as { version: number; action: string };
      assert.equal(after.version, before.version + 1);
      assert.equal(after.action, 'advance');
      advanced.push(id);
    }
  })()));
  const rows = () => objects.all().filter(row => ids.includes(row.id));
  const states = () => new Map(rows().map(row => [row.id, row.state as BuiltState]));
  const logs = () => (db.db.prepare('SELECT object_id,version,action,params,tick FROM edge_comms_object_log WHERE world_id=? ORDER BY object_id,version')
    .all(f.host.worldId) as { object_id: string; version: number; action: string }[]).filter(row => ids.includes(row.object_id));
  const errors = () => messages.filter(message => !/^built objects: \d+ made, \d+ changed \(\d+ in all\)$/.test(message));
  return { ...f, model, act, ids, perceive, visited, created, advanced, messages, errors, rows, states, logs };
}

test('perception yields after one expensive completed object and preserves FIFO durable results against Infinity', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const sliced = fixture(t, () => { now += 9; }), sync = fixture(t, () => { now += 9; });
  assert.equal(sliced.perceive.step(8), false);
  assert.deepEqual(sliced.visited, sliced.ids.slice(0, 1), 'the expensive first name read must not start seven more objects');
  assert.deepEqual(sliced.created, sliced.ids.slice(0, 1));
  assert.deepEqual(sliced.rows().map(row => row.id), sliced.ids.slice(0, 1));
  assert.equal(sliced.logs().length, 1, 'creation and its durable log complete before yielding');
  assert.equal(sliced.perceive.stats.runs, 0);
  for (let i = 1; i < sliced.ids.length; i++) {
    assert.equal(sliced.perceive.step(8), false);
    assert.equal(sliced.created.length, i + 1);
    assert.equal(sliced.db.db.isTransaction, false);
  }
  assert.equal(sliced.perceive.pending(), true, 'the final costly apply yields before completion');
  assert.equal(sliced.perceive.stats.runs, 0);
  assert.deepEqual(sliced.messages, []);
  assert.equal(sliced.perceive.step(8), true, 'the next step completes the exhausted final item');
  assert.equal(sync.perceive.step(Infinity), true, 'ordinary synchronous drain still completes in one call');
  assert.deepEqual(sliced.visited, sliced.ids); assert.deepEqual(sliced.created, sliced.ids);
  assert.deepEqual(sliced.rows(), sync.rows()); assert.deepEqual(sliced.logs(), sync.logs());
  assert.equal(sliced.perceive.stats.runs, 1); assert.equal(sliced.perceive.pending(), false);
  assert.deepEqual(sliced.messages, ['built objects: 9 made, 0 changed (9 in all)']);
  assert.deepEqual(sliced.messages, sync.messages);
  assert.deepEqual(sliced.errors(), []); assert.deepEqual(sync.errors(), []);
});

test('queued perception reads replacement and deletion from the current model between slices', t => {
  let now = 0, charged = false;
  t.mock.method(performance, 'now', () => now);
  const f = fixture(t, () => { if (charged) now += 9; }), reference = fixture(t, () => {});
  f.perceive.sync(true); reference.perceive.sync(true);
  const changeAll = (x: typeof f) => x.act(x.ids.map((id, i) => ({ op: 'set', id, state: { text: `changed-${i}` } })));
  changeAll(f); changeAll(reference);
  f.perceive.note(f.ids, true); f.visited.length = 0; charged = true;
  assert.equal(f.perceive.step(8), false); assert.deepEqual(f.visited, f.ids.slice(0, 1));
  const changes = (x: typeof f) => x.act([
    { op: 'remove', id: x.ids[1], cascade: true },
    { op: 'set', id: x.ids[2], state: { text: 'replacement-after-yield' } },
  ]);
  const replaced = f.model.entities.get(f.ids[2]); changes(f); changes(reference);
  assert.notStrictEqual(f.model.entities.get(f.ids[2]), replaced, 'the queued ID now names a replaced model entity');
  let calls = 0;
  while (f.visited.length < f.ids.length - 1) {
    assert.ok(++calls <= f.ids.length, 'finite queue reaches its final live object');
    assert.equal(f.perceive.step(8), false);
    assert.equal(f.db.db.isTransaction, false);
  }
  assert.equal(f.perceive.pending(), true);
  assert.equal(f.perceive.stats.runs, 1, 'the initial pass is still the only completed run');
  // L8 (2026-10-31, re-pinned): built kinds' advance is refresh-only, so each changed object is refreshed as it is applied
  // (was: at the end of the run); a listing between slices reads every recomputed object's current state.
  assert.deepEqual(f.advanced, f.ids, 'each applied object was refreshed in its own slice, FIFO');
  assert.equal(f.logs().filter(row => row.action === 'advance').length, f.ids.length,
    'the refresh is not deferred to the end of the run');
  assert.equal(f.states().get(f.ids[0])!.text, 'changed-0');
  assert.equal(f.perceive.step(8), true);
  const referenceLiveOrder = [...reference.model.entities.keys()];
  assert.deepEqual(referenceLiveOrder, [...f.ids.filter((_, i) => i !== 1 && i !== 2), f.ids[2]],
    'set deletes and reinserts the replaced entity at the end of the live model order');
  reference.perceive.sync(true);
  assert.deepEqual(f.visited, f.ids.filter((_, i) => i !== 1), 'removed queued entity has no stale names read');
  assert.equal(f.states().get(f.ids[1])!.removed, true);
  assert.equal(f.states().get(f.ids[2])!.text, 'replacement-after-yield');
  assert.deepEqual(f.rows(), reference.rows());
  assert.deepEqual(f.advanced, f.ids,
    'committed refresh transactions keep FIFO, including the removed entity');
  // A fresh full pass uses the current live order, then appends the previously known deleted ID.
  assert.deepEqual(reference.advanced, [...referenceLiveOrder, f.ids[1]]);
  assert.deepEqual(f.logs(), reference.logs());
  assert.deepEqual(f.messages, ['built objects: 9 made, 0 changed (9 in all)', 'built objects: 0 made, 9 changed (9 in all)']);
  assert.deepEqual(f.errors(), []); assert.equal(f.perceive.pending(), false);
});

test('initial authoritative perception ensure drains a partially completed finite slice synchronously', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const f = fixture(t, () => { now += 25; });
  assert.equal(f.perceive.step(8), false);
  assert.equal(f.created.length, 1, 'one expensive atomic object may overrun but does not start the next');
  f.perceive.ensure();
  assert.equal(f.perceive.pending(), false); assert.equal(f.perceive.stats.runs, 1);
  assert.deepEqual(f.visited, f.ids); assert.deepEqual(f.created, f.ids);
  assert.equal(f.db.db.isTransaction, false); assert.deepEqual(f.errors(), []);
});
