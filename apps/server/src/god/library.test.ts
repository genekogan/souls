// CATRUN (engine fix i): GodMode no longer copies the core kit into every world. A fresh world stores 0 library defs;
// an old world (which stores the whole kit from an earlier release) boots unchanged: same defs, same hashes, no commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, buildLibrary, coreLibrary, type DefInput } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { WorldStore } from './store.ts';
// @ts-expect-error The portable CLI export helper is JavaScript without a declaration file.
import { exportGenesis } from '../../../../tools/god-skill/lib/export.mjs';

const opts = (worldId: string) => ({ worldId, ownerId: null, tick: () => 1, emit: () => {} });
const rows = (db: Db, w: string) => (db.db.prepare('SELECT COUNT(*) n FROM world_defs_v1 WHERE world_id=?').get(w) as { n: number }).n;
const edits = (db: Db, w: string) => (db.db.prepare('SELECT COUNT(*) n FROM world_edits_v1 WHERE world_id=?').get(w) as { n: number }).n;

test('fresh world: stores 0 library defs; placing adopts exactly what it uses; reload resolves identically', () => {
  const db = new Db(':memory:');
  const god = new GodMode(db, opts('fresh-1'));
  assert.equal(rows(db, 'fresh-1'), 0);
  assert.ok(god.godSnapshot().library.length >= coreLibrary().all().length, 'the god still sees the whole library');
  assert.equal(god.godSnapshot().libraryRef, `core@${coreLibrary().version}`);
  const r = god.act({ ops: [{ op: 'place', def: 'core/cottage@1', name: 'home', p: [0, 0, 0] }, { op: 'place', def: 'eden/bench@1', name: 'bench', p: [8, 0, 6] }] });
  assert.ok(r.accepted, JSON.stringify(r));
  assert.equal(rows(db, 'fresh-1'), 2);
  const snap = god.publicSnapshot();
  assert.deepEqual(snap.defs.map((d) => d.ref).sort(), ['core-bench@1', 'core-cottage@1']);
  const again = new GodMode(db, opts('fresh-1'));
  assert.equal(JSON.stringify(again.publicSnapshot().entities), JSON.stringify(snap.entities));
  assert.equal(JSON.stringify(again.publicSnapshot().defs), JSON.stringify(snap.defs));
  assert.equal(rows(db, 'fresh-1'), 2, 'loading commits nothing');
});

test('old world: the full kit stored by an earlier release boots unchanged (same rows, same hashes, no core-kit commit)', () => {
  const db = new Db(':memory:');
  // build the world the way the pre-CATRUN GodMode did: every core def in its own store, one of them an older rev,
  // and one type missing (added by a later release)
  const store = new WorldStore(db, 'old-1');
  const model = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'old-1:genesis' });
  const fountain = CORE_KIT.find((d) => d.name === 'core-fountain')!;
  for (const d of CORE_KIT) if (d.name !== 'core-sofa' && d.name !== 'core-fountain') model.defineDef(d, 'core', 0);
  const oldFountain = model.defineDef({ ...fountain, description: 'An older stone fountain.' } as DefInput, 'core', 0);
  store.init(model, null);
  const r = applyBatch(model, { ops: [{ op: 'place', def: 'core/fountain@1', name: 'f', p: [0, 0, 0] }] }, 'god', 1);
  assert.ok(r.result.accepted);
  store.commit(model, null, r.diff!, { seq: 1, by: 'god', at: 0, ops: [], inverse: [], kind: 'edit' });
  const n0 = rows(db, 'old-1'), e0 = edits(db, 'old-1');
  const bare = new GodMode(db, { ...opts('old-1'), library: null });   // what the world itself holds, nothing more
  const god = new GodMode(db, opts('old-1'));
  assert.equal(rows(db, 'old-1'), n0, 'no defs written on load');
  assert.equal(edits(db, 'old-1'), e0, 'no core-kit commit on load');
  assert.equal(god.model.def('core/fountain@1')!.hash, oldFountain.hash, 'the pinned older rev wins');
  assert.equal(JSON.stringify({ ...god.publicSnapshot(), now: undefined }), JSON.stringify({ ...bare.publicSnapshot(), now: undefined }), 'the viewer sees the identical world (now is the wall clock)');
  // a type the old world never stored resolves through the library and is pinned when placed
  assert.ok(god.model.def('core/sofa@1'));
  const p = god.act({ ops: [{ op: 'place', def: 'core/sofa@1', name: 's', p: [10, 0, 10] }] });
  assert.ok(p.accepted, JSON.stringify(p));
  assert.equal(rows(db, 'old-1'), n0 + 1);
});

test('genesis imports exact same-major library hashes; ordinary act cannot redefine the library', (t) => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const input: DefInput = { schema: 'def/1', name: 'core-revision', version: 1, layer: 'decor', make: { kind: 'none' }, size: { box: [1, 1, 1] } };
  const source = new WorldModel({ constants: { ground: 'land' }, seed: 'export-library' });
  const old = source.defineDef({ ...input, description: 'one' }, 'core', 0);
  const latest = source.defineDef({ ...input, description: 'two' }, 'core', 0);
  const library = buildLibrary('revisions', [old, latest]);
  const genesis = exportGenesis({ worldId: 'source', seq: 1, constants: source.constants, state: source.state, defs: [old, latest], entities: [
    { id: 'one', name: 'one', def: 'sha:' + old.hash, in: { parent: 'world' }, p: [0, 0, 0] },
    { id: 'two', name: 'two', def: 'sha:' + latest.hash, in: { parent: 'world' }, p: [4, 0, 0] },
  ] });
  const god = new GodMode(db, { ...opts('genesis-revisions'), library, genesis });
  assert.equal(rows(db, 'genesis-revisions'), 2);
  for (const def of [old, latest]) {
    assert.deepEqual(god.model.def('sha:' + def.hash), def);
    assert.equal(god.model.get(def === old ? 'one' : 'two')!.def, 'sha:' + def.hash);
  }
  const loaded = new GodMode(db, { ...opts('genesis-revisions'), library: null });
  for (const def of [old, latest]) assert.deepEqual(loaded.model.def('sha:' + def.hash), def);
  const before = structuredClone(god.model.snapshot()), n = edits(db, 'genesis-revisions');
  for (const extra of [{}, { trusted: true }, { group: 'genesis' }]) {
    const r = god.act({ ...extra, ops: [{ op: 'define', def: { ...input, description: 'agent override' } }] });
    assert.equal(r.accepted, false);
    if (!r.accepted) assert.equal(r.failures[0].code, 'constant.immutable');
    assert.deepEqual(god.model.snapshot(), before);
    assert.equal(edits(db, 'genesis-revisions'), n);
  }
});
