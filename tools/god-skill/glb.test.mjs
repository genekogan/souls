// Issue #760: the CLI's GLB measurer agrees with the server's and refuses what the server would, before the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_BUDGET, adviceFor, budgetRefusals, describeMeasure, imageSize, measureGlb, parseGlb, readManifest, sniff } from './lib/glb.mjs';

const ROOT = new URL('../../', import.meta.url);
const repo = (p) => new Uint8Array(readFileSync(new URL(p, ROOT)));

/** A GLB with only a JSON chunk: enough for the container measurer. */
export function syntheticGlb(json) {
  const text = Buffer.from(JSON.stringify(json), 'utf8'), len = Math.ceil(text.length / 4) * 4;
  const b = Buffer.alloc(12 + 8 + len); b.write('glTF', 0); b.writeUInt32LE(2, 4); b.writeUInt32LE(b.length, 8); b.writeUInt32LE(len, 12); b.writeUInt32LE(0x4e4f534a, 16); b.fill(0x20, 20); text.copy(b, 20);
  return new Uint8Array(b);
}
const mesh = (count, extra = {}) => ({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, ...(extra.node ?? {}) }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count, componentType: 5126, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 1] }], ...extra.json });

test('repo GLBs measure as the server does: dog pack 602 tris with Idle/Walk and a skin, minaret 17 928 tris at 1024 px', () => {
  const dog = measureGlb(repo('worlds/core-assets/packs/dog-pack.glb'));
  assert.equal(dog.tris, 602); assert.deepEqual(dog.animations, ['Idle', 'Walk']); assert.equal(dog.skins, 1); assert.equal(dog.vertexColors, true);
  const minaret = measureGlb(repo('worlds/littlemartians/buildings/minaret-temple.glb'));
  assert.equal(minaret.tris, 17928); assert.equal(minaret.textures, 2); assert.equal(minaret.texPx, 1024); assert.equal(minaret.box[1], 45);
  assert.deepEqual(budgetRefusals(minaret), []);
  assert.match(describeMeasure(minaret), /17,928 tris, 0\.83 MB, 2 textures \(max 1024 px\), box 19\.2 × 45 × 19\.2 m, clips none/);
  // a compressed file (meshopt + WebP + quantization) measures without a decoder and is decodable
  const ada = measureGlb(repo('worlds/littlemartians-two/assets/character-ada.glb'));
  assert.equal(ada.tris, 26816); assert.ok(ada.extensionsRequired.includes('EXT_meshopt_compression'));
});

test('the budget refusals carry the measured number and the limit', () => {
  const big = measureGlb(syntheticGlb(mesh(300_000)));
  assert.equal(big.tris, 100_000);
  const r = budgetRefusals(big);
  assert.equal(r.length, 1); assert.equal(r[0].field, 'tris'); assert.equal(r[0].measured, 100_000); assert.equal(r[0].allowed, DEFAULT_BUDGET.tris); assert.match(r[0].message, /100,000 triangles > 80,000/);
  const fat = { ...big, bytes: 3_500_000, texPx: 4096 };
  assert.deepEqual(budgetRefusals(fat).map((x) => x.field), ['tris', 'bytes', 'texPx']);
  assert.deepEqual(budgetRefusals({ ...big, tris: 80_000 }), [], 'exactly the limit passes');
});

test('containers the server refuses as invalid are refused here with the same reasons', () => {
  assert.throws(() => measureGlb(new TextEncoder().encode('{"asset":{"version":"2.0"}}')), /not a GLB/);
  assert.throws(() => parseGlb(syntheticGlb(mesh(3)).subarray(0, 40)), /length does not match|truncated/i);
  assert.throws(() => measureGlb(syntheticGlb(mesh(3, { json: { buffers: [{ byteLength: 4, uri: 'scene.bin' }] } }))), /external buffer scene\.bin/);
  assert.throws(() => measureGlb(syntheticGlb(mesh(3, { json: { images: [{ uri: 'tex.png' }] } }))), /external image tex\.png/);
  assert.throws(() => measureGlb(syntheticGlb(mesh(3, { json: { extensionsRequired: ['KHR_materials_transmission'] } }))), /cannot decode: KHR_materials_transmission/);
  assert.throws(() => measureGlb(syntheticGlb({ asset: { version: '1.0' } })), /version must be 2/);
  assert.throws(() => measureGlb(syntheticGlb({ asset: { version: '2.0' } })), /no measurable geometry/);
  // the viewer's decodable set passes
  assert.equal(measureGlb(syntheticGlb(mesh(3, { json: { extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp'] } }))).tris, 1);
});

test('bounds follow the node hierarchy (a scaled parent) and the box is in metres', () => {
  const json = mesh(3, { json: { nodes: [{ children: [1], scale: [2, 2, 2] }, { mesh: 0, translation: [0, 1, 0] }] } });
  const m = measureGlb(syntheticGlb(json));
  assert.deepEqual(m.box, [2, 4, 2]); assert.deepEqual(m.min, [0, 2, 0]);
});

test('advice names what the server warns about and what it does not see', () => {
  const m = { tris: 7000, bytes: 1, textures: 1, texPx: 2048, box: [1, 0.01, 1], animations: ['Run'], skins: 1, extensionsUsed: ['KHR_texture_basisu'], vertexColors: false };
  const a = adviceFor(m).join('\n');
  assert.match(a, /KTX2/); assert.match(a, /fits colour maps to 1024/); assert.match(a, /7,000 triangles: above the prop/); assert.match(a, /unlike metres/); assert.match(a, /name one Idle and one Walk/);
  assert.deepEqual(adviceFor({ ...m, tris: 300, texPx: 1024, box: [1, 1, 1], animations: ['Idle'], extensionsUsed: [] }), []);
});

test('sniff and imageSize read headers; a manifest is checked for shape', () => {
  assert.equal(sniff(repo('worlds/core-assets/packs/dog-pack.glb')), 'glb');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000400000002008060000001f15c489', 'hex');
  assert.equal(sniff(png), 'png'); assert.deepEqual(imageSize(png), { w: 64, h: 32, type: 'png' });
  assert.equal(sniff(new TextEncoder().encode('  {"a":1}')), 'json');
  assert.throws(() => readManifest({ schema: 'x' }), /schema must be/);
  assert.throws(() => readManifest({ schema: 'god-upload-manifest/1', assets: [] }), /non-empty/);
  assert.throws(() => readManifest({ schema: 'god-upload-manifest/1', assets: [{ name: 'x' }] }), /assets\[0\]\.file/);
  assert.throws(() => readManifest({ schema: 'god-upload-manifest/1', assets: [{ file: 'a.glb', colour: 'red' }] }), /unknown field\(s\) colour/);
  assert.throws(() => readManifest({ schema: 'god-upload-manifest/1', assets: [{ file: 'a.glb', layer: 'water' }] }), /layer must be solid or decor/);
  assert.deepEqual(readManifest({ schema: 'god-upload-manifest/1', assets: [{ file: 'a.glb', name: 'a', tags: ['x', 'y'], height: 2 }] }), [{ file: 'a.glb', name: 'a', tags: 'x,y', height: 2 }]);
});
