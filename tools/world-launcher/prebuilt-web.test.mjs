import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, seal } from './deploy/prebuilt-web.mjs';

const identity = { sourceSha: 'a'.repeat(40), buildId: 'we-aaaaaaaaaaaa', base: '/worlds/', cdn: '1', cdnOrigin: 'https://assets.eden.art', edenWorlds: 'test-world', arrivalUI: '0', goatCounter: 'simeden', godUploadsCdn: '1' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'souls-prebuilt-test-'));
  mkdirSync(join(root, 'dist/assets'), { recursive: true });
  writeFileSync(join(root, 'dist/index.html'), '<script src="/worlds/assets/main.js"></script>');
  writeFileSync(join(root, 'dist/assets/main.js'), 'console.log("test")');
  seal(root, identity); return root;
}
test('prebuilt web installs exact files for the exact release identity', () => {
  const root = fixture(), out = join(root, 'installed'); install(root, out, identity);
  assert.equal(readFileSync(join(out, 'assets/main.js'), 'utf8'), 'console.log("test")');
  assert.throws(() => install(root, out, identity), /existing web output/);
});
test('prebuilt web refuses every source or release flag mismatch', () => {
  const root = fixture();
  for (const key of Object.keys(identity)) assert.throws(() => install(root, join(root, 'out'), { ...identity, [key]: 'wrong' }), /mismatch/);
});
test('prebuilt web detects modified, missing, extra and symbolic-link artifact files', () => {
  for (const change of [
    r => writeFileSync(join(r, 'dist/assets/main.js'), 'changed'),
    r => renameSync(join(r, 'dist/assets/main.js'), join(r, 'kept-main.js')),
    r => writeFileSync(join(r, 'dist/extra'), 'unexpected'),
    r => symlinkSync('../WEB-BUILD.json', join(r, 'dist/link')),
  ]) {
    const root = fixture(); change(root);
    assert.throws(() => install(root, join(root, 'out'), identity), /inventory|Unsupported/);
  }
});
