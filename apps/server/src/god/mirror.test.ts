// G2: mirror/1 deltas. The CLI's patched mirror must equal a fresh whole mirror, and the guard must say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { mirrorCurrent, mirrorPayload } from './mirror.ts';
import { applyMirror } from '../../../../tools/god-skill/lib/mirror.mjs';

const W = 'http://world.invalid';
function fixture(t: { after(fn: () => void): void }) {
  const db = new Db(':memory:'); t.after(() => db.close());
  const god = new GodMode(db, { worldId: 'mirror-test', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
  return god;
}
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const stateOf = (m: { seq: number; buildsRev: number; guard?: string; libraryHash?: string; groundHash?: string }) => ({ since: m.seq, builds: m.buildsRev, have: m.guard, lib: m.libraryHash, ground: m.groundHash });
const oldStateOf = (m: { seq: number; buildsRev: number; guard?: string; libraryHash?: string }) => ({ since: m.seq, builds: m.buildsRev, have: m.guard, lib: m.libraryHash });
const place = (god: GodMode, name: string, p: [number, number], def = 'core/barrel@1') => { const r = god.act({ ops: [{ op: 'place', def, name, p }] }); assert.equal(r.accepted, true, JSON.stringify(r)); return r; };

test('mirror/1: a delta patches the client mirror to exactly the whole mirror, with only what changed on the wire', (t) => {
  const god = fixture(t);
  place(god, 'a', [0, 0]); place(god, 'b', [5, 0]);
  const full = json(mirrorPayload(god, {})) as Record<string, unknown>;
  assert.equal(full.full, true); assert.ok(Array.isArray(full.library) && (full.library as unknown[]).length > 50);
  const m0 = applyMirror(null, full, W); assert.ok(m0?.guard, 'whole mirror verifies');
  assert.equal(mirrorCurrent(god, stateOf(m0)), true);
  // an edit: one new row; a move: one changed row; a removal: one gone
  place(god, 'c', [10, 0]);
  god.act({ ops: [{ op: 'move', id: 'a', p: [0, 3] }] });
  god.act({ ops: [{ op: 'remove', id: 'b' }] });
  assert.equal(mirrorCurrent(god, stateOf(m0)), false);
  const d = json(mirrorPayload(god, stateOf(m0))) as Record<string, unknown> & { rows: { id: string }[]; rowsGone: string[]; entities: unknown[] };
  assert.equal(d.full, false); assert.equal(d.library, undefined, 'the library is not resent');
  assert.equal(d.rows.length, 2); assert.equal(d.rowsGone.length, 1); assert.equal(d.entities.length, 2);
  assert.ok(JSON.stringify(d).length < 8000, `delta ${JSON.stringify(d).length} bytes`);
  const m1 = applyMirror(m0, d, W); assert.ok(m1, 'patched mirror verifies against the guard');
  const fresh = applyMirror(null, json(mirrorPayload(god, {})), W)!;
  assert.deepEqual(m1.rows, fresh.rows); assert.deepEqual(m1.snapshot.entities, fresh.snapshot.entities); assert.equal(m1.guard, fresh.guard);
  const { now: _n, tick: _t, ...a } = m1.snapshot, { now: _n2, tick: _t2, ...b } = fresh.snapshot;
  assert.deepEqual({ ...a, library: undefined }, { ...b, library: undefined });
  assert.deepEqual(new Set(m1.snapshot.library.map((x: { ref: string }) => x.ref)), new Set(fresh.snapshot.library.map((x: { ref: string }) => x.ref)));
});

test('mirror/1: a drifted or unknown client state gets the whole mirror; a tampered delta fails the guard', (t) => {
  const god = fixture(t);
  place(god, 'a', [0, 0]);
  const m0 = applyMirror(null, json(mirrorPayload(god, {})), W)!;
  const unknown = json(mirrorPayload(god, { ...stateOf(m0), have: 'not-a-state', since: -1 })) as Record<string, unknown>;
  assert.equal(unknown.full, true); assert.equal(unknown.library, undefined, 'same library hash: still not resent');
  place(god, 'b', [4, 0]);
  const d = json(mirrorPayload(god, stateOf(m0))) as unknown as { rows: { pose: number[] }[] };
  d.rows[0].pose[0] += 1; // a row the client would get wrong
  assert.equal(applyMirror(m0, d, W), null);
  // a client whose cached mirror is missing a row it should have
  const broken = { ...m0, rows: [] };
  assert.equal(applyMirror(broken, json(mirrorPayload(god, stateOf(m0))), W), null);
});

test('mirror/1: the act answer carries the delta for the state the CLI sent', (t) => {
  const god = fixture(t);
  place(god, 'a', [0, 0]);
  const m0 = applyMirror(null, json(mirrorPayload(god, {})), W)!;
  const r = god.act({ ops: [{ op: 'place', def: 'core/barrel@1', name: 'b', p: [3, 0] }] });
  const d = json(mirrorPayload(god, stateOf(m0)));
  const m1 = applyMirror(m0, d, W)!;
  const id = Object.keys(r.accepted ? r.ids : {})[0];
  assert.ok(m1.rows.some((x: { id: string }) => x.id === id)); assert.equal(m1.seq, god.model.editSeq);
});

test('mirror/1 (G3): the ground recipe goes by hash; the patched mirror is the same object, key order included', (t) => {
  const god = fixture(t);
  place(god, 'a', [0, 0]);
  const full = json(mirrorPayload(god, {})) as Record<string, unknown> & { top: Record<string, unknown> };
  assert.equal(typeof full.groundHash, 'string'); assert.equal(full.groundRef, undefined); assert.ok(full.top.ground && typeof full.top.ground === 'object');
  const m0 = applyMirror(null, full, W)!; assert.equal(m0.groundHash, full.groundHash);
  place(god, 'b', [4, 0]);
  const d = json(mirrorPayload(god, stateOf(m0))) as Record<string, unknown> & { top: Record<string, unknown> };
  assert.equal(d.groundRef, true); assert.equal(d.top.ground, null); assert.ok(Object.keys(d.top).includes('ground'));
  // a CLI before G3 sends no hash: the recipe as before, the same delta otherwise
  const old = json(mirrorPayload(god, oldStateOf(m0))) as Record<string, unknown> & { top: Record<string, unknown> };
  assert.equal(old.groundRef, undefined); assert.deepEqual(old.top.ground, full.top.ground);
  const m1 = applyMirror(m0, d, W)!, m1old = applyMirror(m0, old, W)!;
  assert.ok(m1 && m1old);
  // `now` is the clock at each answer: pinned in place (same key position) before comparing bytes
  const bytes = (m: { snapshot: Record<string, unknown> }) => JSON.stringify({ ...m.snapshot, now: 0, tick: 0 });
  assert.equal(bytes(m1), bytes(m1old), 'byte-identical snapshot, key order included');
  // a server before G3 (no groundHash): the CLI sends nothing next time and reads the recipe as sent
  const { groundHash: _g, ...pre } = old;
  const m1pre = applyMirror(m0, pre, W)!; assert.equal(m1pre.groundHash, undefined); assert.equal(bytes(m1pre), bytes(m1));
  // a ground reference the client cannot honour (its copy is another recipe): refused, so the CLI refetches whole
  assert.equal(applyMirror({ ...m0, groundHash: 'other' }, d, W), null);
  // the whole mirror for a client whose state the server forgot still keeps the recipe by hash
  const forgot = json(mirrorPayload(god, { ...stateOf(m1), have: 'gone', since: -1 })) as Record<string, unknown>;
  assert.equal(forgot.full, true); assert.equal(forgot.groundRef, true);
  assert.equal(JSON.stringify(applyMirror(m1, forgot, W)!.snapshot.ground), JSON.stringify(full.top.ground));
});

test('mirror/1 (G3): a terrain edit sends the new recipe and a new hash', (t) => {
  const god = fixture(t);
  place(god, 'a', [0, 0]);
  const m0 = applyMirror(null, json(mirrorPayload(god, {})), W)!;
  const r = god.act({ ops: [{ op: 'place', def: coreRef('knoll'), name: 'hill', p: [30, 0], params: { height: 5, radius: 25 } }] });
  assert.equal(r.accepted, true, JSON.stringify(r));
  const d = json(mirrorPayload(god, stateOf(m0))) as Record<string, unknown> & { top: Record<string, unknown> };
  assert.notEqual(d.groundHash, m0.groundHash); assert.equal(d.groundRef, undefined); assert.ok(d.top.ground);
  const m1 = applyMirror(m0, d, W)!, fresh = applyMirror(null, json(mirrorPayload(god, {})), W)!;
  assert.deepEqual(m1.snapshot.ground, fresh.snapshot.ground); assert.equal(m1.groundHash, fresh.groundHash);
});
