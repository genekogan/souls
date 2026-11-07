// Offline: node --import=./tools/test-harness/web-loader.mjs --test apps/web/src/WorldEntityLayer.resync.test.ts
// Lane PERF-SNAPSHOT: a resync applies the snapshot as a delta (applyDelta): an unchanged thing is not drawn again and
// stays frozen; a changed one is re-posed or rebuilt; a missing one goes; a snapshot behind the socket never steps back.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { WorldModel, coreLibrary, applyBatch, type Entity } from '@souls/world-compiler';
import { diffSnapshots, type PlainSnapshot, type SnapshotDelta, type SnapshotDecoder } from './snapshot-delta.ts';

type Drawn = { settled?: boolean; frozen?: THREE.Object3D[]; removing?: boolean; dur: number; obj: THREE.Object3D; to: { p: THREE.Vector3; s: number } };
type Inner = { snapshotDecoder: () => Promise<SnapshotDecoder>; model: WorldModel; draw: (e: Entity, ease: boolean) => void; drawn: Map<string, Drawn>; now: number; seq: number; signal: AbortSignal; touched: Set<string>; groundTouched: boolean; applyDelta: (d: SnapshotDelta, asked: Set<string>, signal: AbortSignal) => Promise<void> };

const plain = (m: WorldModel, seq: number): PlainSnapshot => { const s = m.snapshot(); return { contract: 'world/1', seq, counter: s.seq, seed: s.seed, constants: s.constants, state: s.state, ground: s.ground, defs: structuredClone(s.defs) as never, entities: structuredClone(s.entities) as never, builds: [], buildsRev: 0, now: 0 }; };

async function fixture() {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hook = registerHooks({ load(url, ctx, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, ctx); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hook.deregister()); await import('./gen-mesh/kit.mesh.ts');
  const model = new WorldModel({ constants: { ground: 'land', extent: 350 }, seed: 'resync' }); model.library = coreLibrary();
  const r = applyBatch(model, { ops: [{ op: 'place', def: 'core/floor-lamp@2', name: 'a', p: [3, 0] }, { op: 'place', def: 'core/floor-lamp@2', name: 'b', p: [-3, 0] }] }, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const layer = new WorldEntityLayer((p) => p), inner = layer as unknown as Inner;
  inner.model = model; layer.active = true; layer.freezeSettled = true; inner.seq = 10; inner.now = 1000; inner.signal = new AbortController().signal;
  const scene = new THREE.Scene(); scene.add(layer.group);
  let now = 1000;
  const frame = () => { now += 16; inner.now = now; layer.update(0.016, now); scene.updateMatrixWorld(); };
  for (const e of model.entities.values()) inner.draw(e, false);
  for (let i = 0; i < 4; i++) frame();
  const a = model.get('a')!, b = model.get('b')!;
  const d = (id: string) => inner.drawn.get(id);
  assert.ok(!!d(a.id)?.frozen && !!d(b.id)?.frozen, 'both settled and frozen before the resync');
  const base = plain(model, 10);
  return { layer, inner, model, a, b, d, frame, base, scene };
}
const drawCalls = (inner: Inner) => { let n = 0; const orig = inner.draw; inner.draw = function (e, ease) { n++; return orig.call(this, e, ease); }; return () => n; };

test('the same picture again: nothing is drawn, nothing thaws, the seq moves on', async () => {
  const f = await fixture(); const draws = drawCalls(f.inner);
  await f.inner.applyDelta(diffSnapshots(f.base, plain(f.model, 12)), new Set(), f.inner.signal);
  assert.equal(draws(), 0);
  assert.equal(f.layer.lastResync?.drawn, 0); assert.equal(f.layer.lastResync?.unchanged, 2); assert.equal(f.layer.lastResync?.full, false);
  assert.ok(!!f.d(f.a.id)?.frozen && !!f.d(f.b.id)?.frozen, 'still frozen');
  assert.equal(f.inner.seq, 12); assert.equal(f.layer.stats.resyncs, 1);
});

test('a full snapshot (the worker had no baseline) equal to what we hold: nothing is drawn either', async () => {
  const f = await fixture(); const draws = drawCalls(f.inner);
  await f.inner.applyDelta(diffSnapshots(null, plain(f.model, 11)), new Set(), f.inner.signal);
  assert.equal(draws(), 0); assert.equal(f.layer.lastResync?.full, true); assert.equal(f.layer.lastResync?.upserts, 0);
  assert.ok(!!f.d(f.a.id)?.frozen && !!f.d(f.b.id)?.frozen, 'still frozen');
});

test('a moved thing is re-posed at once (no easing) and the other is left frozen; a missing one goes; a new one eases in', async () => {
  const f = await fixture(); const draws = drawCalls(f.inner);
  const next = plain(f.model, 13);
  const moved = next.entities.find((e) => e.id === f.a.id)!; (moved as unknown as { p: number[] }).p = [6, 0, 0];
  next.entities = next.entities.filter((e) => e.id !== f.b.id);
  const fresh = { ...structuredClone(moved), id: 'e_new', name: 'c', p: [0, 0, 5] };
  next.entities.push(fresh as never);
  await f.inner.applyDelta(diffSnapshots(f.base, next), new Set(), f.inner.signal);
  assert.equal(draws(), 2, 'the moved one and the new one');
  assert.deepEqual(f.layer.lastResync && [f.layer.lastResync.upserts, f.layer.lastResync.removes, f.layer.lastResync.drawn], [2, 1, 2]);
  assert.deepEqual(f.model.get('a')!.p, [6, 0, 0]);
  const da = f.d(f.a.id)!; assert.equal(da.settled, false, 'out of settled: the next frame thaws and re-poses it'); assert.equal(da.to.p.x, 6); assert.ok(da.dur < 0.01, 'no easing for a thing already drawn');
  f.frame(); assert.equal(!!da.frozen, false, 'thawed'); assert.equal(da.obj.position.x, 6, 'at its new place on the first frame');
  assert.equal(f.d(f.b.id)?.removing, true, 'eases out (then leaves the drawn set)'); assert.equal(f.model.entities.has(f.b.id), false);
  const dn = f.d('e_new')!; assert.ok(!!dn, 'drawn'); assert.ok(dn.dur > 0.5, 'a new thing eases in');
  for (let i = 0; i < 80; i++) f.frame();
  assert.equal(f.inner.drawn.has(f.b.id), false, 'gone once eased out');
  assert.ok(!!f.d(f.a.id)?.frozen, 'the moved one settles and freezes again at its new place'); assert.equal(f.d(f.a.id)!.obj.position.x, 6);
});

test('a changed record with the same pose (a param) rebuilds that thing only', async () => {
  const f = await fixture(); const draws = drawCalls(f.inner);
  const next = plain(f.model, 14), e = next.entities.find((x) => x.id === f.a.id)!;
  (e as { params?: Record<string, unknown> }).params = { ...((e as { params?: Record<string, unknown> }).params ?? {}), shade: '#123456' };
  const objBefore = f.d(f.a.id)!.obj, bObj = f.d(f.b.id)!.obj;
  await f.inner.applyDelta(diffSnapshots(f.base, next), new Set(), f.inner.signal);
  assert.equal(draws(), 1);
  assert.ok(f.d(f.a.id)!.obj !== objBefore, 'rebuilt'); assert.ok(f.d(f.b.id)!.obj === bObj, 'the other is the same object'); assert.ok(!!f.d(f.b.id)!.frozen, 'the other stays frozen');
});

test('a snapshot behind the socket (a diff applied while it downloaded) removes only what we did not touch and never steps back', async () => {
  const f = await fixture(); const draws = drawCalls(f.inner);
  f.inner.seq = 20;
  const next = plain(f.model, 15);
  const moved = next.entities.find((e) => e.id === f.a.id)!; (moved as unknown as { p: number[] }).p = [9, 0, 0];
  next.entities = next.entities.filter((e) => e.id !== f.b.id);
  const d = diffSnapshots(f.base, next); d.removes.push('e_touched');
  await f.inner.applyDelta(d, new Set(['e_touched']), f.inner.signal);
  assert.equal(draws(), 0, 'no upsert applied'); assert.deepEqual(f.model.get('a')!.p, [3, 0, 0]);
  assert.equal(f.inner.seq, 20); assert.equal(f.layer.lastResync?.stale, true);
  assert.equal(f.model.entities.has(f.b.id), false, 'what the server no longer has and we did not touch goes');
});

test('applyEdge remembers what the socket changed, so the next delta reports those ids whatever the worker holds', async () => {
  const f = await fixture();
  f.layer.applyEdge([{ type: 'edge', kind: 'world-diff', seq: 11, by: 'god', diff: { upserts: [{ ...f.a, p: [4, 0, 0] }], removes: [f.b.id], defs: [], tiles: [] } } as never]);
  assert.deepEqual([...f.inner.touched].sort(), [f.a.id, f.b.id].sort()); assert.equal(f.inner.groundTouched, false);
  const d = diffSnapshots(f.base, f.base, f.inner.touched);
  assert.deepEqual(d.upserts.map((e) => e.id).sort(), [f.a.id, f.b.id].sort(), 'both asked for although the snapshot did not change');
});


test('concurrent cold snapshot requests share a baseline owner and teardown closes it', async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.inner.snapshotDecoder(), f.inner.snapshotDecoder()]);
  assert.equal(a, b);
  const pieces = { kind: 'plain' as const, body: [new TextEncoder().encode(JSON.stringify(f.base))] };
  assert.deepEqual(await a.initial(pieces), f.base);
  f.layer.dispose();
  await assert.rejects(a.initial(pieces), /disposed/);
  await assert.rejects(f.inner.snapshotDecoder(), { name: 'AbortError' });
});

test('teardown while the snapshot client module is loading prevents a late decoder', async () => {
  const f = await fixture(), pending = f.inner.snapshotDecoder();
  f.layer.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
});
