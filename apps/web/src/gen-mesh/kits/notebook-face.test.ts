// #428: the notebook stand is drawn by the sign builder, so its page face carries the handwritten lines, each at its
// ruling (notebookLine), with the writer's name after it.
//   node --import=./tools/test-harness/web-loader.mjs --test apps/web/src/gen-mesh/kits/notebook-face.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldModel, coreLibrary, notebookLine } from '@souls/world-compiler';
import { MaterialLib } from '../materials.ts';
import { meshFor, type MeshCtx } from '../registry.ts';

test('the notebook stand draws its page face with each signed line at its ruling', async () => {
  const globals = globalThis as unknown as { location?: URL; document?: unknown };
  const previousLocation = globals.location, previousDocument = globals.document;
  const texts: { s: string; y: number }[] = [];
  globals.location = new URL('http://offline.invalid/w/fixture?shot=1');
  const context = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    measureText: (s: string) => ({ width: s.length * 12 }), fillText(s: string, _x: number, y: number) { texts.push({ s, y }); } };
  globals.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  try {
    await import('./sign.mesh.ts');
    const model = new WorldModel({ constants: { ground: 'land' }, seed: 'offline-notebook' }), def = coreLibrary().get('core-notebook-stand@1')!;
    assert.equal(meshFor(def)?.gen, 'tag:sign-text', 'the sign builder draws the page');
    const root = meshFor(def)!.build({ def, entity: { id: 'e_nb', def: def.ref, in: { parent: 'world' }, by: 'god', born: 0, v: 1, state: { text: 'Came by at noon — Ana\nThe kite is back — Ben', textBy: 's_a,s_b' } },
      args: def.make.kind === 'gen' ? def.make.args : {}, params: {}, model, materials: new MaterialLib(), tint: (_key: string | undefined, fallback: string) => fallback } as unknown as MeshCtx)!;
    const face = root.getObjectByName('sign-face') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    assert.ok(face?.material.map, 'a page face with a texture');
    assert.ok(face.rotation.x < -1.2 && face.rotation.x > -1.3, 'the face lies on the sloped page');
    const f = (def.make as unknown as { args: { faces: { h: number }[] } }).args.faces[0], ch = Math.round(1024 * f.h / 0.4), row = (i: number) => (0.5 - notebookLine(i)[1] / f.h) * ch;
    const ana = texts.find(t => t.s === 'Came by at noon'), ben = texts.find(t => t.s === 'The kite is back');
    assert.ok(ana && ben, JSON.stringify(texts));
    assert.ok(Math.abs(ana.y - row(0)) < 1 && Math.abs(ben.y - row(1)) < 1, 'each line on its own ruling');
    assert.ok(texts.some(t => t.s === '  — Ana') && texts.some(t => t.s === '  — Ben'), 'signed');
  } finally { globals.location = previousLocation; globals.document = previousDocument; }
});
