// Desert near-field mesh halves build without a browser (node --test): tyres, a tyre ring, scrub
// over 1.2 km, tracks. Budgets: a prop ≤ 400 tris; a ring and a scrub field draw in a few
// instanced meshes; same seed, same picture; tyres sink into the ground; scrub keeps clear.
//   node --test apps/web/src/gen-mesh/desert-meshes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CORE_KIT, WorldModel, applyBatch } from '@souls/world-compiler';
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import './basic.mesh.ts';
import './kit.mesh.ts';
import './desert.mesh.ts';

const lib = new MaterialLib();
function world() {
  const w = new WorldModel({ constants: { extent: 1400, ground: 'land' }, seed: 'desert' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  return w;
}
function draw(w: WorldModel, name: string): THREE.Object3D | null {
  const e = w.get(name)!; const def = w.resolvedDef(e.def)!; const b = meshFor(def);
  assert.ok(b, `mesh half for ${def.ref}`);
  const params = Object.fromEntries(Object.entries(def.params).filter(([, f]) => (f as { default?: unknown }).default !== undefined).map(([k, f]) => [k, (f as { default: unknown }).default]));
  const ctx: MeshCtx = { def, entity: e, params: { ...params, ...(e.params ?? {}) } as never, args: {}, baked: w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: w, materials: lib, tint: (_k, f) => f };
  return b!.build(ctx);
}
function stats(o: THREE.Object3D | null) {
  let tris = 0, draws = 0, instances = 0, perProto = 0;
  o?.traverse((c) => { const m = c as THREE.Mesh; if (!m.isMesh) return; const g = m.geometry, k = g.index ? g.index.count / 3 : g.attributes.position.count / 3; const im = m as unknown as THREE.InstancedMesh; draws++; perProto = Math.max(perProto, k); if (im.isInstancedMesh) { tris += k * im.count; instances += im.count; } else { tris += k; instances++; } });
  return { tris, draws, instances, perProto };
}
const ok = (w: WorldModel, ops: unknown[]) => { const r = applyBatch(w, { ops } as never, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };

test('desert near-field draws within budget, instanced, deterministic', () => {
  const w = world();
  ok(w, [
    { op: 'place', def: 'core/cottage@1', name: 'camp-house', p: [0, 0] },
    { op: 'place', def: 'core/tire@1', name: 'tire', p: [20, 20] },
    { op: 'place', def: 'core/tire@1', name: 'tire-flat', p: [22, 20], params: { pose: 'flat' } },
    { op: 'place', def: 'core/creosote@1', name: 'bush', p: [24, 24], params: { height: 1.4, variant: 1 } },
    { op: 'place', def: 'core/tire-ring@1', name: 'ring', p: [-175, -60], params: { rx: 55, rz: 100 } },
    { op: 'place', def: 'core/tire-line@1', name: 'line', shape: { path: [[50, 50], [120, 60], [160, 120]] } },
    { op: 'place', def: 'core/desert-scrub@1', name: 'scrub', shape: { area: [[-600, -600], [600, -600], [600, 600], [-600, 600]] }, params: { toward: 'se', clear: [[0, 0, 40]] } },
    { op: 'place', def: 'core/tire-tracks@1', name: 'tracks', shape: { area: [[-260, -190], [-60, -190], [-60, 70], [-260, 70]] }, params: { count: 40 } },
  ]);
  const out: Record<string, ReturnType<typeof stats>> = {};
  for (const name of ['tire', 'tire-flat', 'bush', 'ring', 'line', 'scrub', 'tracks']) { const t0 = performance.now(); out[name] = stats(draw(w, name)); (out[name] as Record<string, number>).ms = Math.round(performance.now() - t0); }
  console.log(JSON.stringify(out));
  // props within the Eden prop budget
  for (const k of ['tire', 'tire-flat', 'bush']) assert.ok(out[k].tris > 50 && out[k].tris <= 400, `${k}: ${out[k].tris} tris`);
  assert.ok(out.scrub.perProto <= 400 && out.ring.perProto <= 400, 'instanced prototypes ≤ 400 tris');
  // the ring: one instanced mesh, ~200 tyres for a 55 × 100 m ellipse
  assert.equal(out.ring.draws, 1); assert.ok(out.ring.instances > 150 && out.ring.instances < 320, `ring tyres ${out.ring.instances}`);
  // scrub over 1.2 km: ≤ 5 draws, sparse (a bush per several hundred m²), cheap
  assert.ok(out.scrub.draws <= 5, `scrub draws ${out.scrub.draws}`);
  assert.ok(out.scrub.instances > 2000 && out.scrub.instances < 9000, `scrub plants ${out.scrub.instances}`);
  assert.ok(out.scrub.tris < 700000, `scrub tris ${out.scrub.tris}`);
  assert.equal(out.tracks.draws, 1);
  // deterministic: same entity, same picture
  assert.deepEqual(stats(draw(w, 'ring')), { ...stats(draw(w, 'ring')) });
  // tyres sink: every upright tyre's top is below a whole diameter above the ground
  const ring = draw(w, 'ring')! as THREE.InstancedMesh, m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let sunk = 0; for (let i = 0; i < ring.count; i++) { ring.getMatrixAt(i, m); m.decompose(p, q, s); const g = w.terrain.sample(p.x, p.z); if (p.y - g < s.x / 2 - 0.05) sunk++; }
  assert.ok(sunk / ring.count > 0.8, `sunk ${sunk}/${ring.count}`);
  // scrub keeps the clear circle and the house bare
  const scrub = draw(w, 'scrub')!; let inClear = 0;
  scrub.traverse((c) => { const im = c as THREE.InstancedMesh; if (!im.isInstancedMesh) return; for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (Math.hypot(p.x, p.z) < 40) inClear++; } });
  assert.equal(inClear, 0, 'nothing in the clear circle');
});
