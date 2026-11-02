import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MUSIC_SOURCE, fingerprintMusicSource } from './index.ts';

test('current authored sources have one physical home and remain readable through the compatibility alias', () => {
  assert.equal(realpathSync(new URL('../../../vendor/sim-score', import.meta.url)), realpathSync(MUSIC_SOURCE));
  const current = fingerprintMusicSource();
  assert.ok(current.files.length > 100);
  assert.deepEqual(fingerprintMusicSource(), current);
  assert.ok(current.files.some(f => f.path === 'site/index.html'));
  assert.ok(current.files.some(f => f.path === 'site/engine/compose.js'));
  assert.ok(current.files.some(f => f.path === 'site/pieces/pixel-town.js'));
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.dev, undefined);
  assert.equal(manifest.scripts.start, undefined);
});

test('owned source fingerprints accept local edits and do not freeze historical import hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'music-owned-'));
  try {
    writeFileSync(join(root, 'piece.js'), 'first composition');
    const before = fingerprintMusicSource(root);
    writeFileSync(join(root, 'piece.js'), 'edited composition');
    assert.notEqual(fingerprintMusicSource(root).sha256, before.sha256);
    writeFileSync(join(root, 'PROVENANCE.json'), 'historical evidence');
    mkdirSync(join(root, 'renders'));
    writeFileSync(join(root, 'renders', 'local-output.json'), 'ignored render metadata');
    const after = fingerprintMusicSource(root);
    assert.equal(after.files.length, 1);
    assert.equal(after.files[0].path, 'piece.js');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
