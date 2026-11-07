import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { expandKitProgram, kitPhysics } from '@souls/generators';
import { WorldModel, type DefInput } from '@souls/world-compiler';
import { buildKit } from './kit.mesh.ts';
import { meshFor, type MeshCtx } from './registry.ts';
import { MaterialLib } from './materials.ts';
import './creatures/creature.mesh.ts';

const materials = new MaterialLib();
const draw = (args: unknown, params = {}) => buildKit(args, { materials, params, tint: (_k, f) => f });
function positions(obj: THREE.Object3D) {
  const points: string[] = []; obj.updateMatrixWorld(true);
  obj.traverse(c => { if (!(c instanceof THREE.Mesh)) return; const p = c.geometry.getAttribute('position'); const v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld); points.push(v.toArray().map(v => Math.round(v * 1000) / 1000).join(',')); } });
  return points.sort();
}
function arrays(obj: THREE.Object3D) {
  const result: number[][] = []; obj.traverse(c => { if (c instanceof THREE.Mesh) result.push(Array.from(c.geometry.getAttribute('position').array)); }); return result;
}
const program = { shapes: [
  { kind: 'box', at: [0, '$height/2', 0], size: [1, '$height', 1], repeat: { n: 3, step: [2, 0, 0] } },
  { kind: 'cyl', from: [-1, 1, 0], to: [2, 3, 0], r: .1, mirror: true },
  { kind: 'arch.pointed', at: [0, 2, -2], size: [2, 4, .2] },
] };
test('server bake and viewer mesh consume identical expanded shapes with instance params', () => {
  const params = { height: 3 }, expanded = expandKitProgram(program, params);
  assert.deepEqual(kitPhysics(program, params), kitPhysics(expanded, params));
  assert.deepEqual(arrays(draw(program, params)), arrays(draw(expanded, params)));
});
for (const v of [1, 2]) test(`pointed arch mesh has a real open doorway and matches its baked bounds (v${v})`, () => {
  const args = { v, round: 0, shapes: [{ kind: 'arch.pointed', at: [0, 2, 0], size: [2, 4, .3] }] };
  const obj = draw(args); obj.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  assert.ok(bounds.distanceTo(new THREE.Vector3(2, 4, .3)) < 1e-6);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 3), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(obj, true).length, 0);
  ray.set(new THREE.Vector3(.9, 1, 3), new THREE.Vector3(0, 0, -1)); assert.ok(ray.intersectObject(obj, true).length > 0);
  const actualTris = arrays(obj).reduce((n, p) => n + p.length / 9, 0);
  assert.equal(actualTris, kitPhysics(args).tris);
});
for (const v of [1, 2]) test(`mirror retains visible front faces on asymmetric extrusions (v${v})`, () => {
  const args = { v, round: 0, shapes: [{ kind: 'extrude', at: [2, 0, 0], polygon: [[0, 0], [1, 0], [0, 1]], h: 1, mirror: true }] };
  const obj = draw(args); obj.updateMatrixWorld(true);
  assert.deepEqual(kitPhysics(args).box, [6, 1, 1]);
  const ray = new THREE.Raycaster(new THREE.Vector3(-2.2, 3, .2), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(obj, true).length > 0);
});
test('v2 repeated primitives can exceed the authored cap and retain the K1 mesh triangle estimate', () => {
  const args = { v: 2, round: 0, shapes: [{ kind: 'sphere', at: [0, 1, 0], segments: 6, repeat: { n: 100, step: [2, 0, 0] } }] };
  const baked = kitPhysics(args), mesh = draw(args);
  assert.equal(expandKitProgram(args).shapes.length, 100);
  assert.equal(arrays(mesh).reduce((n, p) => n + p.length / 9, 0), baked.tris);
  const width = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x;
  assert.ok(width > 198 && width <= baked.box[0] + 1e-6);
});
function context(tag?: string): MeshCtx {
  const model = new WorldModel({ constants: { ground: 'land' }, seed: 'mesh-program' });
  const def = model.defineDef({ schema: 'def/1', name: 'sized', tags: tag ? [tag] : [], params: { height: { type: 'number', default: 2, min: 1, max: 6 } }, size: { box: [8, 6, 8] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [program.shapes[0]] } } } as DefInput, 'fixture', 0);
  const entity = { id: 'fixture', def: def.ref, in: { parent: 'world' }, by: 'fixture', born: 0, v: 1 };
  return { model, def, entity, params: { height: 2 }, args: def.make.kind === 'gen' ? def.make.args! : {}, baked: model.bake(def, {}, 0), materials, tint: (_k, f) => f };
}
for (const tag of [undefined, 'creature']) test(`numeric params change prototype and instance caches (${tag ?? 'kit'})`, () => {
  const a = context(tag), b = { ...a, params: { height: 5 } }, builder = meshFor(a.def)!;
  assert.notEqual(builder.instanceKey!(a), builder.instanceKey!(b));
  const first = new THREE.Box3().setFromObject(builder.build(a)!).getSize(new THREE.Vector3());
  const second = new THREE.Box3().setFromObject(builder.build(b)!).getSize(new THREE.Vector3());
  assert.ok(Math.abs(first.y - 2) < 1e-6); assert.ok(Math.abs(second.y - 5) < 1e-6);
});
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../packages/generators/src/fixtures/kit-programs/${name}.json`, import.meta.url), 'utf8'));
for (const name of ['m4-gatehouse', 'm2-tower']) test(`${name} rewrite retains geometry bounds and triangle counts`, () => {
  const a = draw(fixture(`${name}.original`)), b = draw(fixture(`${name}.kit`));
  const x = new THREE.Box3().setFromObject(a), y = new THREE.Box3().setFromObject(b);
  assert.ok(x.min.distanceTo(y.min) < .001 && x.max.distanceTo(y.max) < .001);
  const tris = (obj: THREE.Object3D) => { let count = 0; obj.traverse(o => { if (o instanceof THREE.Mesh) count += o.geometry.getAttribute('position').count / 3; }); return count; };
  assert.equal(tris(a), tris(b));
  // Point sets rounded to 1 mm need not match at a rounding boundary. Nearest source vertex is stricter.
  const source: number[][] = []; a.traverse(o => { if (o instanceof THREE.Mesh) { const p = o.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) source.push([p.getX(i), p.getY(i), p.getZ(i)]); } });
  let maxDistance = 0;
  b.traverse(o => { if (o instanceof THREE.Mesh) { const p = o.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) { const v = [p.getX(i), p.getY(i), p.getZ(i)]; const nearest = Math.min(...source.map(s => Math.hypot(s[0] - v[0], s[1] - v[1], s[2] - v[2]))); maxDistance = Math.max(maxDistance, nearest); } } });
  assert.ok(maxDistance < .001, `${name} max vertex distance ${maxDistance}`);
  console.log(`${name}: max vertex distance=${maxDistance} m; triangles=${tris(b)}`);
});
