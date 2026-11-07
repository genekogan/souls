import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATION_LIMITS as L } from '@souls/generators';
import { WorldModel, applyBatch, type Entity, type Refused } from './index.ts';
const cube = { schema: 'def/1' as const, name: 'cube', size: { box: [0.1, 1, 0.1] as [number, number, number] }, overlaps: ['cube'], make: { kind: 'gen' as const, gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [0.1, 1, 0.1] }] } } };
test('clone expansion cannot bypass the world entity limit', () => {
  const w = new WorldModel({ constants: { ground: 'land', limits: { entities: 1 } as never }, seed: 'budget' });
  w.defineDef(cube, 'god', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'cube@1', name: 'a' }] }, 'god', 0).result.accepted, true);
  const before = w.snapshot(), r = applyBatch(w, { ops: [{ op: 'clone', id: 'a', p: [3, 0], count: 2 }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.world'); assert.equal(r.failures[0].measured, 3); assert.equal(r.failures[0].limit, 1); assert.deepEqual(w.snapshot(), before);
});
test('region budget counts each solid entity once; non-solids do not count', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'region' }); w.defineDef(cube, 'god', 0);
  for (let i = 0; i < L.regionSolidEntities; i++) {
    const e: Entity = { id: `a${i}`, def: 'cube@1', in: { parent: 'world' }, p: [5, 0, 5], by: 'fixture', born: 0, v: 1 }; w.insert(e); w.index(e.id, w.footprint(e));
  }
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'cube@1', p: [5, 5] }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.region'); assert.equal(r.failures[0].measured, L.regionSolidEntities + 1); assert.equal(r.failures[0].limit, L.regionSolidEntities);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'cube@1', p: [40, 40] }] }, 'god', 1).result.accepted, true);
  w.defineDef({ ...cube, name: 'decor', layer: 'decor' }, 'god', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'decor@1', p: [5, 5] }] }, 'god', 1).result.accepted, true);
});
test('retained definition revisions count by content, not alias', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'defs' }), d = w.defineDef(cube, 'god', 0);
  for (let i = 1; i < L.worldDefs; i++) w.defs.set(`sha:${i}`, { ...d, hash: String(i), ref: `old-${i}@1` });
  const r = applyBatch(w, { ops: [{ op: 'define', def: { ...cube, name: 'next' } }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.world'); assert.equal(r.failures[0].field, 'defs'); assert.equal(r.failures[0].measured, L.worldDefs + 1);
});
test('world triangle budget includes every placed instance', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'tris', assets: () => ({ tris: L.defTris, bytes: 10, textures: 0, box: [1, 1, 1] }) });
  const d = w.defineDef({ schema: 'def/1', name: 'mesh', layer: 'decor', size: { box: [1, 1, 1] }, make: { kind: 'mesh', asset: 'a'.repeat(64), collide: 'none' } }, 'god', 0);
  for (let i = 0; i < L.worldTris / L.defTris; i++) w.insert({ id: `m${i}`, def: d.ref, in: { parent: 'world' }, by: 'fixture', born: 0, v: 1 });
  const r = applyBatch(w, { ops: [{ op: 'place', def: d.ref }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.world'); assert.equal(r.failures[0].field, 'tris'); assert.equal(r.failures[0].measured, L.worldTris + L.defTris);
});
test('definition input size is bounded independently of asset bytes', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'def-bytes' });
  const large = { ...cube, make: { ...cube.make, args: { ...cube.make.args, padding: 'x'.repeat(L.defBytes) } } };
  const r = applyBatch(w, { ops: [{ op: 'define', def: large }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'def.budget'); assert.equal(r.failures[0].limit, L.defBytes);
});

test('cached triangles follow diffs, definition rebinds, removal and independent model mutations', async () => {
  const {worldTris} = await import('./budgets.ts');
  const w = new WorldModel({constants: {ground: 'land'}, seed: 'incremental'}); w.defineDef(cube, 'god', 0);
  const run = (ops: unknown[]) => {const r = applyBatch(w, {ops}, 'god', 1).result; assert.equal(r.accepted, true, JSON.stringify(r));};
  const unit = w.bake(w.resolvedDef('cube@1')!, {}, 0).tris;
  run([{op: 'place', def: 'cube@1', name: 'a'}, {op: 'place', def: 'cube@1', name: 'b', p: [3,0]}]);
  assert.equal(worldTris(w), unit * 2);
  run([{op: 'define', def: {...cube, make: {...cube.make, args: {shapes: [...cube.make.args.shapes, {kind: 'box', at: [0,2,0], size: [.1,1,.1]}]}}}}]);
  const revised = w.bake(w.resolvedDef('cube@1')!, {}, 0).tris;
  assert.equal(worldTris(w), revised * 2);
  run([{op: 'remove', id: 'a'}]); assert.equal(worldTris(w), revised);
  const e = w.get('b')!;
  w.entities.set(e.id, {...e, def: 'missing@1'}); assert.equal(worldTris(w), 0);
  w.entities.set(e.id, e); assert.equal(worldTris(w), revised);
  const snapshot = WorldModel.fromSnapshot(w.snapshot()); assert.equal(worldTris(snapshot), revised);
  snapshot.delete(e.id); assert.equal(worldTris(snapshot), 0); assert.equal(worldTris(w), revised);
  const fork = w.fork(); fork.delete(e.id); assert.equal(worldTris(fork), 0); assert.equal(worldTris(w), revised);
  const empty = w.defineDef({...cube, name: 'empty', make: {kind: 'none'}}, 'fixture', 0);
  w.defs.set('cube@1', empty); assert.equal(worldTris(w), 0);
});

test('warm triangle budget bakes only changed ids and region budget visits only touched cells', async t => {
  const {worldTris, worldBudgetFailure} = await import('./budgets.ts');
  const w = new WorldModel({constants: {ground: 'land'}, seed: 'budget-local'}); w.defineDef(cube, 'god', 0);
  for (let i = 0; i < 100; i++) { const e: Entity = {id: `local-${i}`, def: 'cube@1', seed: i, p: [i*3,0,0], in: {parent: 'world'}, by: 'fixture', born: 0, v: 1}; w.insert(e); w.index(e.id, w.footprint(e)); }
  const total = 100 * w.bake(w.resolvedDef('cube@1')!, {}, 0).tris;
  assert.equal(worldTris(w), total);
  const after = w.fork(), old = w.entities.get('local-0')!, e: Entity = {...old, p: [-10,0,-10]};
  after.delete(e.id); after.insert(e); after.index(e.id, after.footprint(e));
  const bake = WorldModel.prototype.bake, region = WorldModel.prototype.solidRegionCount;
  let bakes = 0; const cells = new Set<string>();
  t.mock.method(WorldModel.prototype, 'bake', function(this: WorldModel, ...args: Parameters<WorldModel['bake']>) {assert.equal(args[2], 0, 'unrelated entity was baked'); bakes++; return bake.apply(this, args);});
  t.mock.method(WorldModel.prototype, 'solidRegionCount', function(this: WorldModel, cell: string) {cells.add(cell); return region.call(this,cell);});
  t.mock.method(WorldModel.prototype, 'solidRegionCounts', () => {throw Error('whole-world region scan');});
  assert.equal(worldBudgetFailure(w, after, {upserts: [e], removes: []}, 0), null);
  assert.equal(worldTris(after), total); assert.equal(bakes, 2);
  assert.deepEqual(cells, new Set([...w.solidRegionsOf([e.id]), ...after.solidRegionsOf([e.id])])); // Only overloaded cells need an old count read.
});

test('server-style speculative forks retain warm safety caches until their own maps change', t => {
  const w = new WorldModel({constants: {ground: 'land'}, seed: 'server-forks'});
  w.defineDef(cube, 'god', 0);
  const initial = applyBatch(w, {ops: Array.from({length: 100}, (_, i) => ({op: 'place', def: 'cube@1', name: `c${i}`, p: [i * 2, 0]}))}, 'god', 0);
  assert.equal(initial.result.accepted, true, JSON.stringify(initial.result));
  const bake = WorldModel.prototype.bake;
  let bakes = 0;
  t.mock.method(WorldModel.prototype, 'bake', function(this: WorldModel, ...args: Parameters<WorldModel['bake']>) {bakes++; return bake.apply(this, args);});
  for (let i = 0; i < 3; i++) {
    // GodMode first forks the public model; plan then forks that speculative model again.
    const next = w.fork();
    const r = applyBatch(next, {ops: [{op: 'world', state: {constitution: `draft ${i}`}}]}, 'god', i + 1);
    assert.equal(r.result.accepted, true, JSON.stringify(r.result));
    Object.assign(w, next);
  }
  assert.equal(bakes, 0, 'unchanged entities must not be re-baked by cold safety scans on each server edit');
});
