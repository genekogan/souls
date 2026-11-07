import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { GroundCover } from './ground-cover.ts';
import { BLOCK_CELL, blockCellsOf } from './ecology.mesh.ts';
import { COVER_CELL, REC, cellKind, cellSites, coverIndex } from './ground-cover-recipe.ts';
const fixtureModule = '../../../../tools/context-views/fixture.mjs';
const { genesis } = await import(fixtureModule);

function fixture() {
  const model = new WorldModel({ constants: genesis.constants, seed: 'quality-cover' });
  const have = new Set(CORE_KIT.map(d => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter(d => !have.has(d.name))]) model.defineDef(d, 'core', 0);
  for (const batch of genesis.batches) {
    const result = applyBatch(model, batch as never, 'god', 0);
    assert.equal(result.result.accepted, true, JSON.stringify(result.result));
  }
  return model;
}

test('the exact context hall excludes every cover kind while outdoor grass remains', () => {
  const model = fixture(), ix = coverIndex(model, blockCellsOf(model), BLOCK_CELL);
  let indoor = 0, outdoor = 0;
  for (const k of [0, 1, 2]) for (let j = -2; j < 2; j++) for (let i = -2; i < 2; i++) {
    const rec = cellKind(ix, i, j, k, cellSites(ix, i, j));
    for (let o = 0; o < rec.length; o += REC) {
      const x = rec[o], z = rec[o + 2];
      if (Math.abs(x) < 6 && Math.abs(z) < 5) indoor++;
      else outdoor++;
    }
  }
  assert.equal(indoor, 0);
  assert.ok(outdoor > COVER_CELL * COVER_CELL, `outdoor instances: ${outdoor}`);
});

test('first-frame instance uploads contain the cover actually drawn, including on a camera switch', () => {
  const model = fixture(), cover = new GroundCover(() => model, { enabled: true, reason: 'test' });
  const scene = new THREE.Scene(); scene.add(cover.group);
  // Scene callbacks run before WebGLRenderer projects objects and WebGLObjects uploads instances.
  cover.bindScene(scene);
  const uploaded = new Map<THREE.BufferAttribute, Float32Array>();
  const info = { render: { frame: 0 } };
  const objects = new WebGLObjects({} as never, { get: (_object: unknown, geometry: THREE.BufferGeometry) => geometry, update() {} } as never, {
    update(attribute: THREE.BufferAttribute) { uploaded.set(attribute, new Float32Array(attribute.array)); }, remove() {},
  } as never, { releaseStatesOfObject() {} } as never, info as never);
  let drawn = 0;
  try {
    for (const [x, y] of [[7, 1.7], [-12, 5.7]]) {
      const camera = new THREE.PerspectiveCamera(); camera.position.set(x, y, 0); camera.updateMatrixWorld();
      // Mirror the real renderer order using Three's actual upload coordinator, without a WebGL context.
      scene.onBeforeRender({} as never, scene, camera, null as never, null as never, null as never);
      const meshes = cover.group.children as THREE.InstancedMesh[];
      for (const mesh of meshes) objects.update(mesh);
      for (const mesh of meshes) {
        mesh.onBeforeRender({} as never, scene, camera, mesh.geometry, mesh.material as THREE.Material, null as never);
        if (!mesh.count) continue;
        drawn += mesh.count;
        const matrices = uploaded.get(mesh.instanceMatrix)!, colours = uploaded.get(mesh.instanceColor!)!;
        assert.ok(matrices.subarray(0, mesh.count * 16).every((v, i) => v === mesh.instanceMatrix.array[i]), `GPU transforms must match the current draw (${mesh.count} ${mesh.name} instances; first uploaded root ${matrices[12]},${matrices[14]})`);
        assert.ok(colours.subarray(0, mesh.count * 3).every((v, i) => v === mesh.instanceColor!.array[i]), 'GPU colours must match the current draw');
        for (let i = 0; i < mesh.count; i++) {
          assert.ok(Math.abs(matrices[i * 16 + 12]) >= 6 || Math.abs(matrices[i * 16 + 14]) >= 5, 'no uploaded instance at the hall floor');
          assert.ok(colours[i * 3] + colours[i * 3 + 1] + colours[i * 3 + 2] > 0, 'no initial black instance colours');
        }
      }
      info.render.frame++;
    }
    assert.ok(drawn > 0, 'real outdoor cover was drawn');
  } finally { cover.dispose(); objects.dispose(); }
});

test('scene binding chains the prior callback, is idempotent, and restores on rebind and disposal', () => {
  const cover = new GroundCover(() => null, { enabled: true, reason: 'test' });
  const first = new THREE.Scene(), second = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const events: string[] = [];
  const priorFirst: THREE.Scene['onBeforeRender'] = function (this: THREE.Scene) { assert.equal(this, first); events.push('first'); };
  const priorSecond: THREE.Scene['onBeforeRender'] = function (this: THREE.Scene) { assert.equal(this, second); events.push('second'); };
  first.onBeforeRender = priorFirst; second.onBeforeRender = priorSecond;
  cover.prepare = received => { assert.equal(received, camera); events.push('cover'); };
  try {
    cover.bindScene(first); const hook = first.onBeforeRender;
    cover.bindScene(first); assert.equal(first.onBeforeRender, hook);
    first.onBeforeRender({} as never, first, camera, null as never, null as never, null as never);
    assert.deepEqual(events, ['first', 'cover']);
    cover.bindScene(second);
    assert.equal(first.onBeforeRender, priorFirst);
    second.onBeforeRender({} as never, second, camera, null as never, null as never, null as never);
    assert.deepEqual(events, ['first', 'cover', 'second', 'cover']);
    cover.dispose(); assert.equal(second.onBeforeRender, priorSecond);
    // A retained old wrapper must not prepare a disposed or rebound cover.
    hook({} as never, first, camera, null as never, null as never, null as never);
    assert.deepEqual(events, ['first', 'cover', 'second', 'cover', 'first']);
  } finally { cover.dispose(); }
});
