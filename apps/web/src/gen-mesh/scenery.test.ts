// far-land/1 and panorama/1 mesh halves build without a browser (lane MARSLAND-FAR): the Mars data draws within budget,
// nothing of the far land lies on the walkable terrain, the ground ring meets the terrain's edge, the pole line stands
// outside, and the panorama carries every range.
//   node --test apps/web/src/gen-mesh/scenery.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TILE_M } from '@souls/ground';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import './scenery.mesh.ts';
import { MARS_FAR_LAND, MARS_PANORAMA } from '../../../../tools/god-skill/e2e/marsland-far-data.mjs';

function world() {
  const w = new WorldModel({ constants: { extent: 1200, ground: 'land' }, seed: 'far', state: { ground: { palette: 'desert' } } as never });
  for (const d of CORE_KIT as DefInput[]) w.defineDef(d, 'core', 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'core/far-land@1', p: [0, 0], params: MARS_FAR_LAND as never }, { op: 'place', def: 'core/panorama@1', p: [0, 0], params: MARS_PANORAMA as never }] } as never, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  return w;
}
function build(w: WorldModel, gen: string) {
  const e = [...w.entities.values()].find((x) => w.resolvedDef(x.def)?.make.kind === 'gen' && (w.resolvedDef(x.def)!.make as { gen: string }).gen === gen)!;
  const def = w.resolvedDef(e.def)!, b = meshFor(def)!;
  const params: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(def.params)) if ((f as { default?: unknown }).default !== undefined) params[k] = (f as { default?: unknown }).default;
  Object.assign(params, e.params ?? {});
  const ctx = { def, entity: e, params, args: {}, baked: w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: w, materials: new MaterialLib(), tint: (_k: string, f: string) => f } as unknown as MeshCtx;
  return { obj: b.build(ctx)!, def, baked: ctx.baked, builder: b };
}

test('far-land/1: Mars data within budget, nothing on the walkable terrain, joined at its edge', () => {
  const w = world(), { obj, def, baked, builder } = build(w, 'far-land/1');
  assert.equal(def.layer, 'decor'); assert.ok(def.tags.includes('horizon')); assert.equal(baked.colliders.length, 0); assert.ok(builder.world);
  const st = obj.userData.farLand as { tris: number; draws: number; shrubs: number; poles: number };
  assert.ok(st.tris > 20000 && st.tris < 75000, `tris ${st.tris}`);
  assert.ok(st.draws <= 10, `draws ${st.draws}`);
  assert.ok(st.poles > 20 && st.shrubs > 200, JSON.stringify(st));
  const [ex0, ez0, ex1, ez1] = w.ground().extent, R = [Math.floor(ex0 / TILE_M) * TILE_M, Math.floor(ez0 / TILE_M) * TILE_M, Math.ceil(ex1 / TILE_M) * TILE_M, Math.ceil(ez1 / TILE_M) * TILE_M];
  const inside = (x: number, z: number) => x > R[0] + 0.01 && x < R[2] - 0.01 && z > R[1] + 0.01 && z < R[3] - 0.01;
  let ringEdge = 0, ringMin = Infinity;
  obj.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh || !m.geometry?.index) return;
    const p = m.geometry.attributes.position, idx = m.geometry.index;
    if (o.name === 'far land: ground') { for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); ringMin = Math.min(ringMin, Math.max(Math.abs(x), Math.abs(z))); if (Math.abs(Math.max(Math.abs(x), Math.abs(z)) - R[2]) < 0.01) ringEdge++; } return; }
    if (!/strip|roads/.test(o.name)) return;
    // ribbons: no triangle's centroid on the walkable terrain (straddling quads are split; at most a sliver remains)
    for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); const cx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, cz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3; assert.ok(!inside(cx, cz) || Math.min(cx - R[0], R[2] - cx, cz - R[1], R[3] - cz) < 3, `${o.name} triangle at ${cx.toFixed(1)},${cz.toFixed(1)} on the terrain`); }
  });
  assert.ok(Math.abs(ringMin - R[2]) < 0.01, `ring starts at ${ringMin}, terrain ends at ${R[2]}`);
  assert.ok(ringEdge >= 300, `ring vertices on the edge: ${ringEdge}`);
});

test('panorama/1: every range drawn, layered far to near, within budget; sea bearings carry water', () => {
  const w = world(), { obj } = build(w, 'panorama/1');
  const mesh = obj.children[0] as THREE.Mesh, st = mesh.userData.panorama as { tris: number; ranges: number };
  const given = (MARS_PANORAMA.ranges as { foothills?: number }[]).length, withFoot = (MARS_PANORAMA.ranges as { foothills?: number }[]).filter((r) => (r.foothills ?? 0.5) > 0).length;
  assert.equal(st.ranges, given + withFoot);
  assert.ok(st.tris < 30000, `tris ${st.tris}`);
  assert.equal(mesh.frustumCulled, false); assert.ok(mesh.renderOrder < 1e6, 'drawn before the sky dome');
  const far = mesh.geometry.attributes.far as THREE.BufferAttribute;
  let layers = 0, waterVerts = 0; for (let i = 0; i < far.count; i++) { layers = Math.max(layers, far.getZ(i)); if (far.getZ(i) < -1.4) waterVerts++; }
  assert.equal(layers, st.ranges, 'one depth layer per range'); assert.ok(waterVerts > 1000, `water skirt vertices ${waterVerts}`);
  // no NaN vertices where facet jitter steps past a range's profile (they were dropped facets and a NaN bounding-box warning)
  for (const name of ['position', 'color'] as const) { const arr = mesh.geometry.attributes[name].array as Float32Array; assert.ok(!arr.some(Number.isNaN), `${name} has NaN`); }
});
