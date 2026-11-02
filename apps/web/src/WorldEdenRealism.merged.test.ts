// PERF-BATCH round 2: installed building materials of one layer share one merged material; each source's class, seed and
// style ride per vertex in a merged batch, exactly the values its own uniforms hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyBuildingFinish, mergedRealismAttributes, mergedRealismCount, mergedRealismMaterial } from './WorldEdenRealism.ts';

const wall = (finish: number) => { const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true }); assert.equal(applyBuildingFinish(m, 'wall', { wall: finish, roof: 0 }), true); return m; };
/** What the material's own shader would read: run its compile hook on a bare shader and read the uniforms back. */
function uniforms(m: THREE.Material) { const sh = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <project_vertex>', fragmentShader: '#include <color_fragment>#include <roughnessmap_fragment>#include <normal_fragment_maps>' }; m.onBeforeCompile(sh as never, null as never); return sh.uniforms; }

test('walls of different finishes share one merged material; roofs and floors have their own; a merged batch reads each source per vertex', () => {
  const before = mergedRealismCount();
  const brick = wall(0), limewash = wall(4), roof = new THREE.MeshStandardMaterial({ roughness: 0.7, vertexColors: true }), floor = new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true });
  applyBuildingFinish(roof, 'roof', { wall: 0, roof: 1 }); applyBuildingFinish(floor, 'floor');
  const mb = mergedRealismMaterial(brick)!, ml = mergedRealismMaterial(limewash)!, mr = mergedRealismMaterial(roof)!, mf = mergedRealismMaterial(floor)!;
  assert.ok(mb && mr && mf);
  assert.equal(mb, ml, 'two wall finishes: one merged material');
  assert.notEqual(mb, mr); assert.notEqual(mr, mf);
  assert.equal(mergedRealismCount() - before, 3);
  assert.equal(mb.defines?.EDEN_MERGED, ''); assert.equal(mb.userData.mergedRealism, true);
  assert.equal(mergedRealismMaterial(new THREE.MeshStandardMaterial()), null, 'a material realism never installed');
  // the merged shader rename: uniforms edenRealismU / edenStyleU exist beside the originals
  const u = uniforms(mb); assert.ok(u.edenRealismU && u.edenStyleU && u.edenRealism && u.edenStyle);
  // per-vertex: class, seed and style code of the source material, origin and local y of the source mesh
  const g = new THREE.BoxGeometry(1, 2, 1), mesh = new THREE.Mesh(g.clone(), limewash); mesh.position.set(3, 0, 4); mesh.updateMatrixWorld(true);
  const copy = g.clone(); mergedRealismAttributes(copy, mesh, mesh.matrixWorld);
  const s = copy.attributes.edenMergedS, o = copy.attributes.edenMerged, ul = uniforms(limewash), realism = ul.edenRealism.value as THREE.Vector4, style = ul.edenStyle.value as THREE.Vector4;
  assert.equal(s.itemSize, 3); assert.equal(s.count, g.attributes.position.count);
  assert.equal(s.getX(0), realism.x); assert.equal(s.getY(0), Math.fround(realism.z)); assert.equal(s.getZ(0), style.x + 8 * style.y + 64 * style.z);
  assert.equal(style.y, 4, 'limewash is wall pattern 4'); assert.equal(style.x, 7, 'a building wall is role 7');
  assert.deepEqual([o.getX(0), o.getY(0), o.getZ(0)], [3, 0, 4]); assert.equal(o.getW(0), g.attributes.position.getY(0));
  const ub = uniforms(brick); assert.notEqual((ub.edenRealism.value as THREE.Vector4).z, realism.z, 'each finish keeps its own seed');
  assert.throws(() => mergedRealismAttributes(copy, new THREE.Mesh(g, new THREE.MeshStandardMaterial()), new THREE.Matrix4()), /not-installed/);
});
