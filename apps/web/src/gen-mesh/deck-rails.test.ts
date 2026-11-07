// The deck picture opens its rail where a stair lands on it, as the engine bridge does (server god/deck-stairs.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareFor, queryOf } from '@souls/generators';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import './water.mesh.ts';

const lib = new MaterialLib();
function world() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'deck-rails' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  return w;
}
/** Whether the drawn deck blocks a horizontal ray at the rail's top beam (floor + 0.95 m) from (x, z0) toward −z over 2 m. */
function railHit(w: WorldModel, x: number, z0: number, y: number): boolean {
  const e = w.get('deck')!, def = w.resolvedDef(e.def)!;
  const ctx: MeshCtx = { def, entity: e, params: (e.params ?? {}) as never, args: {}, baked: w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: w, materials: lib, tint: (_k, f) => f };
  const o = meshFor(def)!.build(ctx)!; o.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, y + 0.95, z0), new THREE.Vector3(0, 0, -1), 0, 2).intersectObject(o, true).length > 0;
}

test('a stair landing on a deck opens the drawn rail at its head; the other edges keep theirs', () => {
  const w = world(), area: [number, number][] = [[-3, -7], [3, -7], [3, -3], [-3, -3]];
  const p = prepareFor('deck/1', queryOf(w), { area }, { height: 1.6 } as never);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'core/deck@1', name: 'deck', shape: { area }, params: { height: 1.6, ...(p?.params ?? {}) } as never }] }, 'god', 1).result.accepted, true);
  const y = (w.get('deck')!.params!.at as { y: number }).y;
  for (const x of [-0.4, 0, 0.4]) assert.ok(railHit(w, x, -2, y), `a whole rail before the stair (x ${x})`);
  const r = applyBatch(w, { ops: [
    { op: 'define', def: { schema: 'def/1', name: 'deck-stair', version: 1, description: 'A stair.', tags: ['stairs'], form: 'point', size: { box: [1.1, 1.6, 2.4] }, make: { kind: 'gen', gen: 'stairs/1' }, params: { rise: { type: 'number', min: 0.3, max: 12, default: 1.6 }, run: { type: 'number', min: 0.5, max: 20, default: 2.4 } } } as never },
    { op: 'place', def: 'deck-stair@1', name: 'stair', p: [0, -1.8] },
  ] }, 'god', 2);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  for (const x of [-0.4, 0, 0.4]) assert.equal(railHit(w, x, -2, y), false, `no rail across the stair head (x ${x})`);
  assert.ok(railHit(w, 1.5, -2, y) && railHit(w, -1.5, -2, y), 'the rail either side of the gap stays');
  assert.ok(railHit(w, 0, -6, y), 'the far rail stays');
});
