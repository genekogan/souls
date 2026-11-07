// W2b: old Eden's per-building finish on building/1 (node --test apps/web/src/gen-mesh/building-finish.test.ts).
// The facade material picks the wall pattern, the roof colour the roof pattern; only the outer face of the walls is
// marked for it (rooms inside keep their plaster); glass and metal stay plain; draws and geometry are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GENERATORS, type Value } from '@souls/generators';
import { CORE_KIT, WorldModel, type Entity } from '@souls/world-compiler';
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import { buildingFinish } from './building.mesh.ts';

function draw(name: string, extra: Record<string, unknown>, palette?: string) {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'b1' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  if (palette) (w.state as Record<string, unknown>).ground = { palette };
  const def = w.def(`core/${name}@1`)!;
  const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
  Object.assign(params, extra);
  const e = { id: 'b1', def: def.ref, in: { parent: 'world' }, by: 'b1', born: 0, v: 1, params } as Entity;
  const ctx = { def, entity: e, params, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked: w.bake(def, params as Record<string, Value>, 7), model: w, materials: new MaterialLib(), tint: (_k: string, f: string) => f } as unknown as MeshCtx;
  return meshFor(def)!.build(ctx)!;
}
const walls = (g: THREE.Object3D) => { const out: THREE.Mesh[] = []; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && / wall$/.test(m.name)) out.push(m); }); return out; };

test('the facade material picks the wall pattern and the roof colour the roof pattern', () => {
  assert.deepEqual(buildingFinish('stone', '#c8b08a', '#8a3b2a', 1, false), { wall: 2, roof: 0 });
  assert.deepEqual(buildingFinish('wood', '#a4774f', '#5d6268', 1, false), { wall: 3, roof: 1 });
  assert.ok([0, 1].includes(buildingFinish('brick', '#9a4a36', '#5d4a3f', 7, false)!.wall));
  assert.equal(buildingFinish('plaster', '#d49a8c', '#8a3b2a', 7, false)!.wall, 4, 'outside Eden plaster stays limewash');
  assert.equal(buildingFinish('glass', '#ffffff', '#8a3b2a', 1, true), null);
  assert.equal(buildingFinish('metal', '#ffffff', '#8a3b2a', 1, true), null);
  // in Eden's look painted render varies across buildings as old Eden's districts did
  const seen = new Set<number>(); for (let s = 0; s < 64; s++) seen.add(buildingFinish('plaster', '#9a5a40', '#8a3b2a', s * 7919, true)!.wall);
  assert.ok(seen.size >= 3, [...seen].join());
});

test('only the outer face of a building is marked for its finish, with one material per pattern', () => {
  const g = draw('cottage', { material: 'brick', floors: 2 }, 'meadow');
  const marked = walls(g).filter((m) => m.geometry.attributes.edenFace);
  assert.ok(marked.length, 'outer walls carry edenFace');
  for (const m of marked) {
    const f = m.geometry.attributes.edenFace.array as Float32Array, ones = f.reduce((a, b) => a + b, 0);
    assert.equal(f.length, m.geometry.attributes.position.count);
    // storeys hold both sides of the outer walls; the roof's gable ends are outer through and through
    if (/^level-/.test(m.name)) assert.ok(ones > 0 && ones < f.length, `${m.name}: outer and inner faces both present (${ones}/${f.length})`);
    else assert.ok(ones > 0, m.name);
    assert.match((m.material as THREE.Material).name, /^building wall (running|Flemish) brick$/);
  }
  const plain = draw('greenhouse', { material: 'glass' }, 'meadow');
  assert.equal(walls(plain).some((m) => m.geometry.attributes.edenFace), false, 'glass buildings keep the plain kit');
});

test('outer-face marks survive the worker hand-off (raw -> fromRaw)', async () => {
  const { Builder } = await import('./building-kit.ts');
  const b = new Builder();
  b.wallSlab(0, 4, 0, 3, -0.1, 0.1, '#aa5544', '#eeeeee', { outer: 1 });
  const raw = JSON.parse(JSON.stringify(b.raw().map((r) => ({ ...r, p: [...r.p], n: [...r.n], c: [...r.c] }))));
  const again = Builder.fromRaw(raw.map((r: { k: string; p: number[]; n: number[]; c: number[]; face?: number[] }) => ({ ...r, p: Float32Array.from(r.p), n: Float32Array.from(r.n), c: Float32Array.from(r.c) })));
  again.finish = { wall: 0, roof: 0 };
  const { groups } = again.emit(new MaterialLib());
  const wall = [...groups.values()][0].children[0] as THREE.Mesh, f = wall.geometry.attributes.edenFace.array as Float32Array;
  assert.deepEqual([...f], [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], 'the plus (outer) face only');
});
