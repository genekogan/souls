// E2C: old Eden's lit windows on building/1 (node --test apps/web/src/gen-mesh/building-windows.test.ts).
// Every outside window pane carries its size, sill and outdoor side (edenPane), so the night glass can show a room
// behind it; the attribute survives the worker round trip; the glass gets the night-rooms material.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GENERATORS, type Value } from '@souls/generators';
import { CORE_KIT, WorldModel, type Entity } from '@souls/world-compiler';
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import { Builder } from './building-kit.ts';
import './building.mesh.ts';

function draw(name: string, extra: Record<string, unknown>) {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'b1' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const def = w.def(`core/${name}@1`)!;
  const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
  Object.assign(params, extra);
  const e = { id: 'b1', def: def.ref, in: { parent: 'world' }, by: 'b1', born: 0, v: 1, params } as Entity;
  const ctx = { def, entity: e, params, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked: w.bake(def, params as Record<string, Value>, 7), model: w, materials: new MaterialLib(), tint: (_k: string, f: string) => f } as unknown as MeshCtx;
  return meshFor(def)!.build(ctx)!;
}
const glass = (g: THREE.Object3D) => { const out: THREE.Mesh[] = []; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && / glass$/.test(m.name)) out.push(m); }); return out; };

test('outside window panes carry their size, sill and outdoor side; the glass is the night-rooms material', () => {
  const g = draw('cottage', { material: 'brick', floors: 2 });
  const meshes = glass(g);
  assert.ok(meshes.length > 0);
  let panes = 0;
  for (const m of meshes) {
    assert.match((m.material as THREE.Material).name, /night rooms/);
    const a = m.geometry.attributes.edenPane as THREE.BufferAttribute; assert.ok(a, m.name);
    assert.equal(a.count, m.geometry.attributes.position.count);
    for (let i = 0; i < a.count; i += 6) {
      const w = a.getZ(i); if (!w) continue; panes++;
      const W = Math.abs(w), us = [0, 1, 2, 3, 4, 5].map((k) => a.getX(i + k)), vs = [0, 1, 2, 3, 4, 5].map((k) => a.getY(i + k));
      assert.ok(W > 0.3 && W < 4, `width ${W}`);
      assert.equal(Math.min(...us), 0); assert.ok(Math.abs(Math.max(...us) - W) < 1e-5);
      assert.equal(Math.min(...vs), 0); assert.ok(Math.max(...vs) > 0.5);
      assert.ok(a.getW(i) >= 0 && a.getW(i) < 3, `sill ${a.getW(i)}`);
      // the outdoor side: the face normal times the sign points away from the building's middle
      const p = m.geometry.attributes.position, n = m.geometry.attributes.normal, s = Math.sign(w);
      assert.ok((p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i)) * s > 0, 'outdoor side faces out');
    }
  }
  assert.ok(panes >= 4, `panes ${panes}`);
});

test('the pane attribute survives the worker round trip (raw / fromRaw)', () => {
  const b = new Builder();
  b.face([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], '#fff', 'glass');                    // plain glass first
  b.pane = { w: 1.2, h: 1.4, sill: 0.9, out: -1 };
  b.face([2, 1, 0], [3.2, 1, 0], [3.2, 2.4, 0], [2, 2.4, 0], '#fff', 'glass'); b.pane = null;
  const raw = b.raw(); assert.equal(raw.length, 1); assert.equal(raw[0].pane!.length, 12 * 4);
  const { groups } = Builder.fromRaw(raw).emit(new MaterialLib());
  const mesh = groups.get('level-0')!.children[0] as THREE.Mesh, a = mesh.geometry.attributes.edenPane as THREE.BufferAttribute;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((k) => a.getZ(k)), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([6, 7, 8].map((k) => [a.getX(k), a.getY(k)].map((v) => +v.toFixed(3))), [[0, 0], [1.2, 0], [1.2, 1.4]]);
  assert.equal(+a.getZ(6).toFixed(3), -1.2); assert.equal(+a.getW(6).toFixed(3), 0.9);
});
