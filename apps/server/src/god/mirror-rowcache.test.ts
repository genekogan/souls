// G2 row cache (tranche 2026-10-19 follow-up): an act's mirror reuses each layout row and entity hash whose inputs did
// not change. The cache must end where a whole recompute ends: after each kind of edit (place, place into a slot, move a
// building with things in it, rename a parent, set params, set state, clone, define and redefine a def its instances use,
// raise terrain under a wall, remove, undo, redo, world state) and each Soul movement (sits, moves seat, stands up), the
// cached rows equal the query `layout` and a cache-free recompute, the entity hashes equal fresh ones, and the delta
// patches the CLI's mirror to exactly a whole mirror. Only the rows whose inputs changed are laid out again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { entityHash, layoutRows, mirrorHash, mirrorPayload, rowCacheStats } from './mirror.ts';
import { runQuery, seatProviders } from './query.ts';
import { applyMirror } from '../../../../tools/god-skill/lib/mirror.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const W = 'http://world.invalid';
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const box = (name: string, size: number, extra: Record<string, unknown> = {}) => ({ schema: 'def/1', name, version: 1, size: { box: [size, size, size] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [size, size, size] }] } }, slots: [{ id: 'top', kind: 'surface', p: [0, size, 0], capacity: 4 }], ...extra });

test('G2 row cache: cached rows, hashes and deltas equal a whole recompute after every kind of edit and Soul movement', (t) => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const god = new GodMode(db, { worldId: 'rowcache-test', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
  // Souls on seats come from the engine (engine-bridge.ts); here a table the test edits
  const seats: Record<string, { slot: string; soul: string }[]> = {};
  seatProviders.set(god.model, (id) => seats[id] ?? []);
  const act = (ops: unknown[]) => { const r = god.act({ ops } as never) as any; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r; };
  const id = (name: string) => god.model.get(name)!.id;
  act([
    { op: 'place', def: coreRef('cottage'), name: 'cottage', p: [0, 0], tmp: '$c' },
    { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$c', slot: 'ground' }, p: [1, 0, 0] },
    { op: 'place', def: coreRef('bench'), name: 'bench-a', p: [20, 0] },
    { op: 'place', def: coreRef('bench'), name: 'bench-b', p: [24, 0] },
    { op: 'place', def: coreRef('table'), name: 'table', p: [-20, 0], tmp: '$t' },
    { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } },
    { op: 'place', def: coreRef('garden-wall'), name: 'wall', shape: { path: [[30, 30], [50, 30], [50, 40]] } },
    { op: 'place', def: coreRef('sign'), name: 'notice', p: [-4, 12], state: { text: 'Welcome' } },
    { op: 'define', def: box('crate', 1) },
    { op: 'place', def: 'crate@1', name: 'crate-1', p: [-30, 20] },
    { op: 'place', def: 'crate@1', name: 'crate-2', p: [-34, 20], tmp: '$k' },
    { op: 'place', def: coreRef('bowl'), name: 'cup', in: { parent: '$k', slot: 'top' } },
  ]);
  const crate1 = god.model.def('crate@1')!;
  let mirror = applyMirror(null, json(mirrorPayload(god, {})), W)!;
  assert.ok(mirror?.guard, 'whole mirror verifies');
  const n = () => god.model.entities.size;
  const check = (label: string, change: () => void, most: number) => {
    change();
    const d = json(mirrorPayload(god, { since: mirror.seq, builds: mirror.buildsRev, have: mirror.guard, lib: mirror.libraryHash })) as any;
    const recomputed = rowCacheStats.recomputed;
    assert.ok(recomputed <= most, `${label}: ${recomputed} of ${n()} rows laid out again (at most ${most})`);
    // the cached rows are the query's layout and a cache-free recompute, byte for byte
    const cached = layoutRows(god), fresh = layoutRows(god, { fresh: true });
    assert.equal(rowCacheStats.recomputed, rowCacheStats.rows, `${label}: the fresh pass lays out every row`);
    const query = (runQuery(god.model, { layout: { obbs: true } }).layout as { entities: unknown[] }).entities;
    assert.equal(JSON.stringify(cached.rows), JSON.stringify(query), `${label}: cached rows equal the query layout`);
    assert.equal(JSON.stringify(cached.rows), JSON.stringify(fresh.rows), `${label}: cached rows equal a recompute`);
    assert.deepEqual(cached.rowH, fresh.rows.map((r) => [r.id, mirrorHash(JSON.stringify(r))]), `${label}: cached row hashes`);
    for (const e of god.model.entities.values()) assert.equal(entityHash(e), mirrorHash(JSON.stringify(e)), `${label}: entity hash of ${e.id}`);
    // the CLI's mirror, patched by the delta, is a whole mirror (its guard verified in applyMirror)
    if (d.full !== false) assert.fail(`${label}: a delta, not a whole mirror`);
    const patched = applyMirror(mirror, d, W);
    assert.ok(patched, `${label}: patched mirror verifies against the guard`);
    const whole = applyMirror(null, json(mirrorPayload(god, {})), W)!;
    assert.equal(patched.guard, whole.guard);
    assert.deepEqual(patched.rows, whole.rows, `${label}: rows`);
    assert.deepEqual(patched.snapshot.entities, whole.snapshot.entities, `${label}: entities`);
    assert.deepEqual(patched.snapshot.defs, whole.snapshot.defs, `${label}: defs`);
    mirror = patched;
    return recomputed;
  };
  const rowOf = (name: string) => (mirror.rows as any[]).find((r) => r.id === id(name));
  const used = (name: string) => (rowOf(name).slots as { id: string; used: number }[]).map((s) => s.used).join(',');

  check('nothing changed', () => {}, 0);
  check('a bench placed', () => act([{ op: 'place', def: coreRef('bench'), name: 'bench-c', p: [28, 0] }]), 1);
  check('a lamp placed into the cottage', () => act([{ op: 'place', def: coreRef('lamp-post'), name: 'lamp', in: { parent: id('cottage'), slot: 'ground' }, p: [-1, 0, 0] }]), 2);
  const chairBefore = JSON.stringify(rowOf('cottage/chair'));
  check('the cottage moved with what is in it', () => act([{ op: 'move', id: id('cottage'), p: [6, 4], r: 0.5 }]), 3);
  assert.notEqual(JSON.stringify(rowOf('cottage/chair')), chairBefore, 'the chair moved with the cottage');
  check('the cottage renamed (its things\' paths)', () => act([{ op: 'set', id: id('cottage'), name: 'old-cottage' }]), 3);
  assert.equal(rowOf('old-cottage/chair').path, 'old-cottage/chair');
  check('the cottage\'s params (its rooms and slots move its things)', () => act([{ op: 'set', id: id('old-cottage'), params: { front: 'n' } }]), 3);
  check('the sign\'s words (an entity, not its row)', () => act([{ op: 'set', id: id('notice'), state: { text: 'Closed today' } }]), 1);
  check('a bowl taken off the table', () => act([{ op: 'remove', id: id('table/bowl') }]), 1);
  check('a crate cloned twice', () => act([{ op: 'clone', id: id('crate-1'), p: [-38, 20], step: [-4, 0], count: 2 }]), 2);
  check('crate redefined: every crate changes', () => act([{ op: 'define', def: box('crate', 1.5) }]), 5);
  assert.equal(rowOf('crate-2').box[0], 1.5);
  // a def binding that changes outside an edit (the instances stay the same objects): the def identity catches it, for the
  // crate's own row and for the cup it holds (its pose and path read the crate)
  const cupBefore = JSON.stringify(rowOf('crate-2/cup'));
  check('crate@1 bound back to its first content outside an edit', () => { god.model.defs.set('crate@1', crate1); }, 6);
  assert.equal(rowOf('crate-2').box[0], 1);
  assert.notEqual(JSON.stringify(rowOf('crate-2/cup')), cupBefore, 'the cup sits on the smaller crate');
  const wallBefore = JSON.stringify(rowOf('wall'));
  check('a knoll raised under the wall', () => act([{ op: 'place', def: coreRef('knoll'), name: 'mound', p: [40, 32], params: { height: 3, radius: 12 } }]), 2);
  assert.notEqual(JSON.stringify(rowOf('wall')), wallBefore, 'the wall sits on the new ground');
  check('a crate removed (the ground recipe is rebuilt, same terrain)', () => act([{ op: 'remove', id: id('crate-1') }]), 0);
  check('world state (sky)', () => act([{ op: 'world', state: { sky: { palette: 'dusk' } } }]), 0);
  check('a Soul sits on bench-a', () => { seats[id('bench-a')] = [{ slot: 'seat-1', soul: 'Ana' }]; }, 1);
  assert.equal(used('bench-a'), '1,0');
  check('the Soul moves to bench-b\'s second seat', () => { delete seats[id('bench-a')]; seats[id('bench-b')] = [{ slot: 'seat-2', soul: 'Ana' }]; }, 2);
  assert.deepEqual([used('bench-a'), used('bench-b')], ['0,0', '0,1']);
  check('a second Soul sits beside her', () => { seats[id('bench-b')] = [{ slot: 'seat-2', soul: 'Ana' }, { slot: 'seat-1', soul: 'Ben' }]; }, 1);
  check('both stand up', () => { delete seats[id('bench-b')]; }, 1);
  check('undo (the crate comes back)', () => { assert.notEqual((god.undo() as any).accepted, false); }, 1);
  check('undo (the knoll goes)', () => { assert.notEqual((god.undo() as any).accepted, false); }, 2);
  check('redo (the knoll again)', () => { assert.notEqual((god.redo() as any).accepted, false); }, 2);
  check('the cottage removed with what is in it', () => act([{ op: 'remove', id: id('old-cottage') }]), 0);
  assert.equal(god.model.get('old-cottage'), undefined);
});
