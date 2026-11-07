import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WorldModel} from '@souls/world-compiler';
import {tmpdir} from 'node:os';
const {build} = createRequire(new URL('../../../mars/viewer/package.json', import.meta.url))('esbuild');

test('ghost previews require the caller’s authenticated loader and cannot repaint after ownership clears', async t => {
  const scratch = process.env.SAFETY_ISOLATION_TMP ?? tmpdir();
  mkdirSync(scratch, {recursive: true}); const dir = mkdtempSync(join(scratch, 'ghost-loader-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const outfile = join(dir, 'ghost.mjs');
  // Node has no Vite glob. No mesh is drawn in these admission/error tests;
  // the actual geometry class and its network/cancellation flow remain intact.
  await build({entryPoints: [new URL('../src/WorldPreviewGhost.ts', import.meta.url).pathname], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    define: {'import.meta.glob': '__testGlob'}, banner: {js: 'const __testGlob = () => ({});'}});
  const {WorldPreviewGhost} = await import(pathToFileURL(outfile).href);
  const previous = {fetch: globalThis.fetch, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame};
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  const ghost = new WorldPreviewGhost(path => '/w/alice' + path); t.after(() => {ghost.dispose(); Object.assign(globalThis, previous);});
  let reads = [];
  globalThis.fetch = async path => {reads.push(path); throw Error('Unexpected anonymous fallback.');};
  const denied = await ghost.show('pv_private', async path => {assert.equal(path, '/v1/god/preview/pv_private'); throw Error('Sign in first.');});
  assert.equal(denied.ok, false); assert.equal(denied.message, 'Sign in first.'); assert.equal(ghost.group.children.length, 0); assert.deepEqual(reads, []);

  const pv = {diff: {upserts: [], removes: [], defs: [], tiles: []}, failures: null};
  const model = new WorldModel({constants: {ground: 'land', extent: 1000}, seed: 'private-ghost-test'}), snapshot = model.snapshot();
  globalThis.fetch = async path => {reads.push(path); assert.equal(path, '/w/alice/v1/world/snapshot'); return new Response(JSON.stringify({...snapshot, seq: snapshot.editSeq, counter: snapshot.seq}));};
  let loads = 0;
  const owner = await ghost.show('pv_owner', async () => {loads++; return pv;});
  assert.equal(owner.ok, true); assert.equal(loads, 1); assert.deepEqual(reads, ['/w/alice/v1/world/snapshot']);

  reads = []; let resolvePreview;
  const pending = ghost.show('pv_lost_owner', () => new Promise(resolve => {resolvePreview = resolve;}));
  ghost.clear(); resolvePreview(pv);
  assert.equal((await pending).ok, false); assert.equal(ghost.current, null); assert.equal(ghost.group.children.length, 0); assert.deepEqual(reads, []);

  let resolveSnapshot;
  globalThis.fetch = () => new Promise(resolve => {resolveSnapshot = resolve;});
  const afterAuth = ghost.show('pv_lost_while_snapshot', async () => pv); await Promise.resolve();
  ghost.clear(); resolveSnapshot(new Response(JSON.stringify({...snapshot, seq: snapshot.editSeq, counter: snapshot.seq})));
  assert.equal((await afterAuth).ok, false); assert.equal(ghost.current, null); assert.equal(ghost.group.children.length, 0);
});
