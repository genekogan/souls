// Issue #760: `upload` measures first, refuses before the network, posts multipart, and a manifest continues past a
// refused entry. The wire is a stub `send`; the live path is checked against a dev world in the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMANDS, checkArgs, readArgs } from './cli.mjs';
import { inspectFile, upload, uploadOne } from './lib/upload.mjs';
import { syntheticGlb } from './glb.test.mjs';

const ROOT = new URL('../../', import.meta.url);
const DOG = new URL('worlds/core-assets/packs/dog-pack.glb', ROOT).pathname;
const bigGlb = () => syntheticGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count: 300_000, componentType: 5126, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 1] }] });

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'god-upload-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const accepted = (fields) => ({ ok: true, status: 200, data: { ok: true, asset: { sha: 'ab'.repeat(32), url: `/assets/${'ab'.repeat(32)}.glb`, tris: 602 }, def: fields.name ? { name: fields.name, version: 1, size: { box: [0.2, Number(fields.height ?? 0.15), 0.5] }, layer: 'decor' } : null, defined: fields.define ? { accepted: true } : null, warnings: [], report: '' } });

test('upload posts the file and its fields as multipart and prints the place line', async (t) => {
  const sent = [];
  const send = async (req) => { sent.push(req); return accepted(req.fields); };
  const out = await upload(DOG, { name: 'Rex', height: '0.7', tags: ['dog', 'pet'], license: 'CC0 1.0', define: true }, { send });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].fields, { name: 'Rex', height: '0.7', tags: 'dog,pet', license: 'CC0 1.0', define: '1' });
  assert.equal(sent[0].mime, 'model/gltf-binary'); assert.equal(sent[0].filename, 'dog-pack.glb'); assert.equal(sent[0].bytes.byteLength, readFileSync(DOG).byteLength);
  assert.match(out, /uploaded mesh dog-pack\.glb: 602 tris, .* clips Idle, Walk, 1 skin, vertex colours \(as Rex, height 0\.7 m, define\)/);
  assert.match(out, /defined Rex@1 .* — place it with: place Rex@1 --at …/);
  void t;
});

test('--dry measures and posts nothing; without --name the stored-only note appears', async () => {
  let calls = 0;
  const out = await upload(DOG, { dry: true }, { send: async () => { calls++; } });
  assert.equal(calls, 0); assert.match(out, /^would upload mesh dog-pack\.glb: 602 tris/);
  const stored = await upload(DOG, {}, { send: async (req) => accepted(req.fields) });
  assert.match(stored, /no --name: stored only/);
});

test('an over-budget or malformed file is refused before the network with the measured number, the limit and the fix', async (t) => {
  const dir = scratch(t), big = join(dir, 'big.glb'), junk = join(dir, 'junk.glb'), fp = join(dir, 'fp.json');
  writeFileSync(big, bigGlb()); writeFileSync(junk, 'not a model'); writeFileSync(fp, '[1,2]');
  let calls = 0; const send = async () => { calls++; };
  const r = await uploadOne({ file: big, name: 'big' }, { send });
  assert.equal(r.refused, true); assert.equal(calls, 0);
  assert.match(r.lines[0], /REFUSED big\.glb: asset\.budget tris: 100,000 triangles > 80,000 \(measured 100000, allowed 80000\)/);
  assert.match(r.lines[0], /fix: reduce it first: node tools\/god-skill\/scripts\/optimize-glb\.mjs/);
  assert.match((await uploadOne({ file: junk }, { send })).lines[0], /asset\.type file: an unknown file type; accepted: GLB/);
  assert.match((await uploadOne({ file: DOG, footprint: fp }, { send })).lines[0], /footprint is not an lm-building-footprint\/1 object/);
  assert.match((await uploadOne({ file: DOG, height: '0' }, { send })).lines[0], /--height must be metres in \(0, 400\)/);
  assert.match((await uploadOne({ file: join(dir, 'missing.glb') }, { send })).lines[0], /no such file/);
  assert.equal(calls, 0);
  // the server's own refusal is printed verbatim: code, field, measured, allowed, fix
  const refused = await uploadOne({ file: DOG, name: 'rex' }, { send: async () => ({ ok: false, status: 413, data: { code: 'asset.budget', field: 'bytes', message: 'asset 249000 bytes > 1000', measured: { bytes: 249000 }, allowed: { bytes: 1000 }, fix: 'shrink it' } }) });
  assert.equal(refused.ok, false); assert.match(refused.lines[0], /REFUSED dog-pack\.glb: HTTP 413 asset\.budget bytes: asset 249000 bytes > 1000\n  measured \{"bytes":249000\} allowed \{"bytes":1000\}\n  fix: shrink it/);
  // a define the world refused is reported, never claimed
  const half = await uploadOne({ file: DOG, name: 'rex', define: true }, { send: async () => ({ ok: true, status: 200, data: { asset: { sha: 'cd'.repeat(32), url: '/assets/x.glb' }, def: { name: 'rex', version: 1, size: { box: [1, 1, 1] }, layer: 'solid' }, defined: { accepted: false, failures: [{ code: 'def.exists', message: 'rex@1 is already defined' }] } } }) });
  assert.match(half.lines.join('\n'), /define REFUSED: def\.exists: rex@1 is already defined/); assert.doesNotMatch(half.lines.join('\n'), /place rex@1/);
});

test('a manifest uploads in order, continues past a refused entry and counts the outcome; command flags are refused', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'big.glb'), bigGlb());
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema: 'god-upload-manifest/1', assets: [
    { file: DOG, name: 'rex', height: 0.7, tags: ['dog'], license: 'CC0 1.0', define: true },
    { file: 'big.glb', name: 'too-big' },
    { file: DOG, name: 'rex-two' },
  ] }));
  const sent = [];
  const out = await upload(join(dir, 'manifest.json'), {}, { send: async (req) => { sent.push(req.fields.name); return accepted(req.fields); } });
  assert.deepEqual(sent, ['rex', 'rex-two'], 'the refused entry is skipped, the next one still goes');
  assert.match(out, /REFUSED big\.glb: asset\.budget tris/); assert.match(out, /uploaded 2 of 3; refused 1: big\.glb/);
  const dry = await upload(join(dir, 'manifest.json'), { dry: true, json: true }, { send: async () => { throw new Error('must not send'); } });
  assert.deepEqual(dry.map((r) => r.ok), [true, false, true]);
  await assert.rejects(upload(join(dir, 'manifest.json'), { name: 'x' }), /--name belongs in the manifest/);
  writeFileSync(join(dir, 'other.json'), '{"schema":"lm-building-footprint/1"}');
  await assert.rejects(upload(join(dir, 'other.json'), {}), /must be a god-upload-manifest\/1/);
  await assert.rejects(upload(undefined, {}), /usage: upload/);
});

test('images: PNG/JPEG within 2048 px and 2 MB pass; a standalone WebP is refused with the reason', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000400000002008060000001f15c489', 'hex');
  assert.deepEqual(inspectFile(new Uint8Array(png)).refusals, []);
  const wide = Buffer.from(png); wide.writeUInt32BE(4096, 16);
  assert.match(inspectFile(new Uint8Array(wide)).refusals[0].message, /image 4096×32 > 2048 px/);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
  assert.match(inspectFile(new Uint8Array(webp)).refusals[0].message, /standalone WebP/);
});

test('the CLI reads upload the way SKILL.md writes it', () => {
  const r = readArgs('upload', ['models/kalama.glb', '--name', 'kalama', '--height', '1.2', '--tags', 'martian,character', '--license', 'CC-BY-4.0 <Artist Name>', '--define', '--dry']);
  checkArgs('upload', r.flags, r.rest);
  assert.equal(r.flags.define, true); assert.equal(r.flags.license, 'CC-BY-4.0 <Artist Name>'); assert.deepEqual(r.rest, ['models/kalama.glb']);
  assert.throws(() => checkArgs('upload', { colour: 'red' }, ['a.glb']), /upload has no option --colour/);
  assert.throws(() => checkArgs('upload', { height: 'tall' }, ['a.glb']), /--height takes a number/);
  assert.throws(() => checkArgs('upload', {}, ['a.glb', 'b.glb']), /takes one word/);
  assert.equal(typeof COMMANDS.upload, 'function');
});
