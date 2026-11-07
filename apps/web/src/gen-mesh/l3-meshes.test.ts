// L3 mesh halves build without a browser for a small world (node --test): every terrain-kit def
// draws something (or deliberately nothing), within triangle budgets, and the picture follows the
// ground (road setts sit on the graded terrain; river water at its frozen levels).
//   node --test apps/web/src/gen-mesh/l3-meshes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareFor, queryOf } from '@souls/generators';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import './roads.mesh.ts';
import './water.mesh.ts';
import './areas.mesh.ts';
import './ecology.mesh.ts';
import './boundaries.mesh.ts';

function world() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'mesh' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  return w;
}
const lib = new MaterialLib();
function draw(w: WorldModel, name: string): THREE.Object3D | null {
  const e = w.get(name)!; const def = w.resolvedDef(e.def)!; const b = meshFor(def);
  assert.ok(b, `mesh half for ${def.ref}`);
  const params = Object.fromEntries(Object.entries(def.params).filter(([, f]) => (f as { default?: unknown }).default !== undefined).map(([k, f]) => [k, (f as { default: unknown }).default]));
  const ctx: MeshCtx = { def, entity: e, params: { ...params, ...(e.params ?? {}) } as never, args: {}, baked: w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: w, materials: lib, tint: (_k, f) => f };
  return b!.build(ctx);
}
function tris(o: THREE.Object3D | null): number {
  let n = 0; o?.traverse((c) => { const m = c as THREE.Mesh; if (!m.isMesh) return; const g = m.geometry; const k = g.index ? g.index.count / 3 : g.attributes.position.count / 3; n += (m as unknown as THREE.InstancedMesh).isInstancedMesh ? k * (m as unknown as THREE.InstancedMesh).count : k; }); return n;
}
const placeP = (w: WorldModel, def: string, name: string, shape: { path?: [number, number][]; area?: [number, number][] }, params: Record<string, unknown> = {}) => {
  const d = w.resolvedDef(def)!; const gen = d.make.kind === 'gen' ? d.make.gen : '';
  const p = prepareFor(gen, queryOf(w), shape, params as never);
  const r = applyBatch(w, { ops: [{ op: 'place', def, name, shape: p?.path ? { ...shape, path: p.path } : shape, params: { ...params, ...(p?.params ?? {}) } as never }] }, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
};

test('every L3 def draws within budget on a small world', () => {
  const w = world();
  applyBatch(w, { ops: [
    { op: 'place', def: 'core/hill@1', name: 'hill', p: [0, -40], params: { height: 10, radius: 40 } },
    { op: 'place', def: 'core/lake@1', name: 'lake', shape: { area: [[-80, -20], [-50, -20], [-50, 10], [-80, 10]] }, params: { level: -0.3 } },
  ] }, 'god', 0);
  placeP(w, 'core/road@1', 'road', { path: [[-10, -90], [0, -40], [5, 30]] });
  placeP(w, 'core/street@1', 'street', { path: [[0, 0], [60, 4]] });
  placeP(w, 'core/footpath@1', 'path', { path: [[20, 10], [30, 30]] });
  placeP(w, 'core/river@1', 'river', { path: [[-55, -5], [-20, 10], [40, 20]] }, { width: 5 });
  placeP(w, 'core/shore@1', 'shore', { area: [[-80, -20], [-50, -20], [-50, 10], [-80, 10]] });
  placeP(w, 'core/bridge@1', 'bridge', { path: [[60, 30], [70, 30]] });
  placeP(w, 'core/pier@1', 'pier', { path: [[-65, 14], [-65, -6]] });
  placeP(w, 'core/deck@1', 'deck', { area: [[80, 0], [88, 0], [88, 6], [80, 6]] });
  placeP(w, 'core/garden-wall@1', 'wall', { path: [[30, -20], [50, -20]] }, { gates: [{ at: 10, width: 2 }] });
  placeP(w, 'core/fence@1', 'fence', { path: [[30, -30], [50, -30]] });
  placeP(w, 'core/hedge@1', 'hedge', { path: [[30, -35], [50, -35]] }, { flowers: true });
  placeP(w, 'core/power-line@1', 'power', { path: [[30, -60], [120, -60]] });
  placeP(w, 'core/plaza@1', 'plaza', { area: [[100, -20], [120, -20], [120, 0], [100, 0]] }, { pattern: 'herringbone' });
  placeP(w, 'core/lawn@1', 'lawn', { area: [[100, 10], [120, 10], [120, 30], [100, 30]] }, { stripes: true });
  placeP(w, 'core/football-pitch@1', 'pitch', { area: [[130, -40], [230, -40], [230, 24], [130, 24]] });
  for (const [i, sport] of ['tennis', 'basketball', 'petanque', 'volleyball'].entries()) placeP(w, 'core/pitch@1', `court-${sport}`, { area: [[130 + i * 40, 40], [166 + i * 40, 40], [166 + i * 40, 58], [130 + i * 40, 58]] }, { sport });
  placeP(w, 'core/parking@1', 'parking', { area: [[240, 0], [260, 0], [260, 14], [240, 14]] });
  placeP(w, 'core/garden-bed@1', 'bed', { area: [[240, 20], [246, 20], [246, 23], [240, 23]] });
  placeP(w, 'core/orchard@1', 'orchard', { area: [[250, 30], [270, 30], [270, 50], [250, 50]] });
  placeP(w, 'core/woodland@1', 'wood', { area: [[-100, -100], [-40, -100], [-40, -30], [-100, -30]] });
  placeP(w, 'core/reedbed@1', 'reeds', { area: [[-86, -26], [-44, -26], [-44, 16], [-86, 16]] });
  const budget: Record<string, number> = { road: 40000, street: 12000, path: 4000, river: 20000, shore: 12000, bridge: 8000, pier: 8000, deck: 6000, wall: 6000, fence: 6000, hedge: 8000, power: 6000, plaza: 14000, lawn: 1500, pitch: 12000, parking: 2000, bed: 4000, orchard: 20000, wood: 120000, reeds: 60000 };
  const counts: Record<string, number> = {};
  for (const name of Object.keys(budget)) { const o = draw(w, name); assert.ok(o, `${name} draws`); counts[name] = tris(o); assert.ok(counts[name] > 0 && counts[name] <= budget[name], `${name}: ${counts[name]} tris (budget ${budget[name]})`); }
  for (const sport of ['tennis', 'basketball', 'petanque', 'volleyball']) assert.ok(tris(draw(w, `court-${sport}`)) > 50, sport);
  console.log(JSON.stringify(counts));
});

test('the road picture sits on the graded ground; river water at its frozen levels', () => {
  const w = world();
  applyBatch(w, { ops: [{ op: 'place', def: 'core/hill@1', name: 'hill', p: [0, 0], params: { height: 14, radius: 45 } }] }, 'god', 0);
  placeP(w, 'core/road@1', 'road', { path: [[-70, 0], [70, 0]] });
  const o = draw(w, 'road')!; const pos = (o as THREE.Mesh).geometry.attributes.position as THREE.BufferAttribute;
  let worst = 0; for (let i = 0; i < pos.count; i += 7) { const d = pos.getY(i) - w.terrain.sample(pos.getX(i), pos.getZ(i)); if (Math.abs(d) > 0.6) worst++; }
  assert.ok(worst / (pos.count / 7) < 0.02, `vertices off the ground: ${worst}`);
  placeP(w, 'core/river@1', 'river', { path: [[-60, 30], [60, 30]] });
  const r = draw(w, 'river')!; const water = r.getObjectByName('river-water') as THREE.Mesh;
  const flow = w.get('river')!.params!.flow as { levels: number[] };
  assert.ok(water && Math.abs((water.geometry.attributes.position as THREE.BufferAttribute).getY(0) - flow.levels[0]) < 1e-6);
});
