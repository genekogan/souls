// PERF-MUSIC: the render tool's pure parts (seeds, keys, the index text) and the publish plan against a scratch folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cdnUrl, indexText, pieceSeed, readIndex, INDEX } from './render-playlist.mjs';
import { plan } from './publish-playlist-audio.mjs';
import { PLAYLIST } from './build-playlist.mjs';

test('one deterministic 31-bit seed per piece, distinct across the playlist', () => {
  assert.equal(pieceSeed('velour'), 1563010843);
  for (const id of PLAYLIST) { const s = pieceSeed(id); assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 31, id); }
  assert.equal(new Set(PLAYLIST.map(pieceSeed)).size, PLAYLIST.length);
});

test('the file key is the CDN convention: assets/<sha[0:2]>/<sha>.<ext>', () => {
  const sha = 'ab'.repeat(32);
  assert.equal(cdnUrl(sha, 'm4a'), `https://assets.eden.art/assets/ab/${sha}.m4a`);
});

test('the index text is stable: fields in order, one piece per line, sorted', () => {
  const index = { version: 1, generated: 'g', format: 'audio/mp4', sampleRate: 44100, channels: 2, seconds: 240, note: 'n', pieces: { b: { url: 'u', seconds: 240, seed: 2, bytes: 1, sha256: 'x' }, a: { url: 'v', seconds: 240, seed: 1, bytes: 2, sha256: 'y' } } };
  const text = indexText(index);
  assert.deepEqual(JSON.parse(text), index);
  assert.deepEqual(text.split('\n').slice(1, 3).map((l) => l.slice(0, 4)), ['"a":', '"b":']);
  assert.equal(indexText(JSON.parse(text)), text);
});

test('the committed index (when present) names every piece on the playlist at most once, with CDN keys of its hashes', () => {
  const index = readIndex(INDEX);
  for (const [id, e] of Object.entries(index.pieces)) {
    assert.ok(PLAYLIST.includes(id), `${id} is not on the playlist`);
    assert.match(e.sha256, /^[0-9a-f]{64}$/); assert.equal(e.url, cdnUrl(e.sha256, e.url.split('.').pop()));
    assert.ok(e.bytes > 0 && e.seconds > 0 && Number.isInteger(e.seed));
  }
});

test('the publish plan rehashes each file, reports the missing ones and refuses a file that is not the index bytes', () => {
  const out = mkdtempSync(join(tmpdir(), 'score-audio-')), body = Buffer.from('not really aac'), sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(out, `${sha}.m4a`), body);
  const bad = 'cd'.repeat(32); writeFileSync(join(out, `${bad}.m4a`), Buffer.from('other'));
  const index = { pieces: { velour: { url: cdnUrl(sha, 'm4a'), seconds: 240, seed: 1, bytes: body.length, sha256: sha }, halogen: { url: cdnUrl('ef'.repeat(32), 'm4a'), seconds: 240, seed: 2, bytes: 5, sha256: 'ef'.repeat(32) } } };
  const p = plan({ out, index });
  assert.equal(p.objects.length, 1); assert.deepEqual(p.missing.map((m) => m.id), ['halogen']);
  assert.deepEqual({ ...p.objects[0], file: undefined }, { id: 'velour', key: `assets/${sha.slice(0, 2)}/${sha}.m4a`, file: undefined, bytes: body.length, sha256: sha, contentType: 'audio/mp4', cacheControl: 'public, max-age=31536000, immutable', licence: 'own-work', url: cdnUrl(sha, 'm4a') });
  assert.throws(() => plan({ out, index: { pieces: { velour: { url: cdnUrl(bad, 'm4a'), seconds: 240, seed: 1, bytes: 5, sha256: bad } } } }), /not the index's bytes/);
});
