import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GENERATORS } from '@souls/generators';
import { CORE_KIT, WorldModel, type Entity } from '@souls/world-compiler';
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import { buildingBuffers, prefetchBuilding, releaseBuildingWorkersWhenIdle, type BuildingJob, type BuildingBuffers } from './building.mesh.ts';

class GeometryWorker {
  static all: GeometryWorker[] = [];
  static failConstructionAt = -1;
  onmessage: ((ev: { data: { id: number; out: BuildingBuffers | null } }) => void) | null = null;
  onerror: (() => void) | null = null;
  jobs: { id: number; job: BuildingJob }[] = [];
  terminated = 0;
  failPost = false;
  constructor() {
    if (GeometryWorker.all.length === GeometryWorker.failConstructionAt) throw new Error('worker unavailable');
    GeometryWorker.all.push(this);
  }
  postMessage(job: { id: number; job: BuildingJob }) {
    if (this.failPost) throw new Error('post failed');
    this.jobs.push(job);
  }
  reply() {
    const { id, job } = this.jobs.shift()!;
    const out = buildingBuffers(job), transfer = out.raw.flatMap(r => [r.p.buffer, r.n.buffer, r.c.buffer]);
    const received = structuredClone(out, { transfer });
    assert.ok(transfer.every(b => b.byteLength === 0), 'worker-side soups transferred, not copied');
    this.onmessage!({ data: { id, out: received } });
    return received;
  }
  terminate() { this.terminated++; }
}

test('isolated capture retires only idle building workers and preserves geometry and later prefetch', async t => {
  const oldWorker = globalThis.Worker;
  globalThis.Worker = GeometryWorker as unknown as typeof Worker;
  t.after(() => { releaseBuildingWorkersWhenIdle(); globalThis.Worker = oldWorker; });
  const model = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'worker-lifecycle' });
  for (const d of CORE_KIT) model.defineDef(d, 'core', 0);
  const def = model.def('core/cottage@1')!, materials = new MaterialLib();
  let serial = 0;
  function fixture() {
    const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default!]));
    params.w = 8 + serial++;
    const entity = { id: `b${serial}`, def: def.ref, in: { parent: 'world' }, by: 'test', born: 0, v: 1, params } as Entity;
    return { def, params, entity, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked: model.bake(def, params, 7), model, materials, tint: (_k: string, f: string) => f } as unknown as MeshCtx;
  }
  const pool = () => GeometryWorker.all.slice(-2);
  const replyAll = () => { for (const w of pool()) while (w.jobs.length) w.reply(); };

  await t.test('default live prefetch retains the pool; explicit retirement preserves consumed template buffers', async () => {
    const ctx = fixture(), pending = prefetchBuilding(ctx)!;
    assert.ok(pending); assert.equal(GeometryWorker.all.length, 2);
    replyAll(); await pending;
    const built = meshFor(def)!.build(ctx)!, geometries: THREE.BufferGeometry[] = [];
    built.traverse(o => { if ((o as THREE.Mesh).isMesh) geometries.push((o as THREE.Mesh).geometry); });
    const bytes = geometries.map(g => Buffer.from(g.attributes.position.array.buffer).toString('hex'));
    assert.ok(geometries.length); assert.ok(pool().every(w => w.terminated === 0));
    releaseBuildingWorkersWhenIdle();
    assert.ok(pool().every(w => w.terminated === 1));
    const clone = meshFor(def)!.build(ctx)!, reused: THREE.BufferGeometry[] = [];
    clone.traverse(o => { if ((o as THREE.Mesh).isMesh) reused.push((o as THREE.Mesh).geometry); });
    assert.deepEqual(reused, geometries);
    assert.deepEqual(geometries.map(g => Buffer.from(g.attributes.position.array.buffer).toString('hex')), bytes);
  });

  await t.test('outstanding replies finish before retirement; unused soups are dropped and the pool can restart', async () => {
    const ctx = fixture(), a = prefetchBuilding(ctx)!, b = prefetchBuilding(fixture())!;
    const active = pool();
    releaseBuildingWorkersWhenIdle();
    assert.ok(active.every(w => w.terminated === 0));
    active[0].reply();
    assert.ok(active.every(w => w.terminated === 0), 'another geometry job remains');
    active[1].reply(); await Promise.all([a, b]);
    assert.ok(active.every(w => w.terminated === 1));
    const count = GeometryWorker.all.length;
    const later = prefetchBuilding(ctx)!;
    assert.ok(later, 'unused prefetched soup was dropped');
    assert.equal(GeometryWorker.all.length, count + 2);
    // Events from a retired pool cannot terminate or populate the new pool.
    active[0].onerror!();
    assert.ok(pool().every(w => w.terminated === 0));
    replyAll(); await later; releaseBuildingWorkersWhenIdle();
  });

  await t.test('a later prefetch cancels pending retirement and retains default live behavior', async () => {
    const first = prefetchBuilding(fixture())!;
    releaseBuildingWorkersWhenIdle();
    const later = prefetchBuilding(fixture())!;
    replyAll(); await Promise.all([first, later]);
    assert.ok(pool().every(w => w.terminated === 0));
    releaseBuildingWorkersWhenIdle(); assert.ok(pool().every(w => w.terminated === 1));
  });

  await t.test('worker error settles pending work and honors retirement without leaking or blocking a new pool', async () => {
    const first = prefetchBuilding(fixture())!, second = prefetchBuilding(fixture())!;
    releaseBuildingWorkersWhenIdle(); pool()[0].onerror!();
    await Promise.all([first, second]);
    assert.ok(pool().every(w => w.terminated === 1));
    const next = prefetchBuilding(fixture())!; replyAll(); await next; releaseBuildingWorkersWhenIdle();
  });

  await t.test('posting failure leaves no stale pending entry and partial pool construction is cleaned up', async () => {
    const initial = prefetchBuilding(fixture())!; replyAll(); await initial;
    for (const w of pool()) w.failPost = true;
    const ctx = fixture(), failed = prefetchBuilding(ctx); await failed;
    const retried = prefetchBuilding(ctx); await retried;
    assert.ok(retried); assert.notEqual(retried, failed, 'failed post leaves no stale pending promise');
    releaseBuildingWorkersWhenIdle(); assert.ok(pool().every(w => w.terminated === 1));
    const count = GeometryWorker.all.length;
    GeometryWorker.failConstructionAt = count + 1;
    assert.equal(prefetchBuilding(fixture()), null);
    assert.equal(GeometryWorker.all[count].terminated, 1);
    releaseBuildingWorkersWhenIdle(); GeometryWorker.failConstructionAt = -1;
  });
});
