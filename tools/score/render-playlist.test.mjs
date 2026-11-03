// PERF-MUSIC: the render tool's pure parts (seeds, keys, the index text) and the publish plan against a scratch folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cdnUrl, indexText, performanceSeed, pieceSeed, readIndex, renderDownload, resumeRenders, upgradeIndex, INDEX } from './render-playlist.mjs';
import { plan } from './publish-playlist-audio.mjs';
import { PLAYLIST } from './build-playlist.mjs';

test('one deterministic 31-bit seed per piece, distinct across the playlist', () => {
  assert.equal(pieceSeed('velour'), 1563010843);
  for (const id of PLAYLIST) { const s = pieceSeed(id); assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 31, id); }
  assert.equal(new Set(PLAYLIST.map(pieceSeed)).size, PLAYLIST.length);
});

test('performance 0 keeps the piece seed; the others are distinct seeds of their own', () => {
  assert.equal(performanceSeed('velour', 0), pieceSeed('velour'));
  const seeds = PLAYLIST.flatMap((id) => [0, 1, 2].map((k) => performanceSeed(id, k)));
  assert.equal(new Set(seeds).size, seeds.length);
  for (const s of seeds) assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 31);
});

test('a version 1 index reads as one performance per piece', () => {
  const v1 = { version: 1, seconds: 240, pieces: { a: { url: 'u', seconds: 240, seed: 7, bytes: 3, sha256: 'x' } } };
  assert.deepEqual(upgradeIndex(v1).pieces, { a: { seconds: 240, performances: [{ seed: 7, url: 'u', bytes: 3, sha256: 'x' }] } });
  assert.equal(upgradeIndex(v1).version, 2);
});

test('the file key is the CDN convention: assets/<sha[0:2]>/<sha>.<ext>', () => {
  const sha = 'ab'.repeat(32);
  assert.equal(cdnUrl(sha, 'm4a'), `https://assets.eden.art/assets/ab/${sha}.m4a`);
});

test('the index text is stable: fields in order, one piece per line, sorted; performances contiguous from 0', () => {
  const p = (seed) => ({ seed, url: 'u' + seed, bytes: 1, sha256: 'x' + seed });
  const index = { version: 2, generated: 'g', format: 'audio/mp4', sampleRate: 44100, channels: 2, seconds: 240, note: 'n', pieces: { b: { seconds: 240, performances: [p(2), p(3)] }, a: { seconds: 240, performances: [p(1)] } } };
  const text = indexText(index);
  assert.deepEqual(JSON.parse(text), index);
  const holed = { ...index, pieces: { a: { seconds: 240, performances: [p(1), undefined, p(9)] } } };
  assert.deepEqual(JSON.parse(indexText(holed)).pieces.a.performances, [p(1)]);
  assert.deepEqual(text.split('\n').slice(1, 3).map((l) => l.slice(0, 4)), ['"a":', '"b":']);
  assert.equal(indexText(JSON.parse(text)), text);
});

test('a late render download survives a pause longer than the former wall-clock limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishRender, emitDownload, listening = false;
  const stats = { peak: 0.5 }, wav = { saveAs() {} };
  const page = {
    waitForEvent(event, { timeout = 30_000 }) {
      assert.equal(event, 'download'); listening = true;
      return new Promise((resolve, reject) => { emitDownload = resolve; if (timeout) setTimeout(() => reject(Error('download timeout')), timeout); });
    },
    evaluate(_fn, args) {
      assert.ok(listening, 'listen before the render can emit its download');
      assert.deepEqual(args, ['velour', 7, 240, 44100]);
      return new Promise((resolve) => { finishRender = resolve; });
    },
  };
  const pending = renderDownload(page, ['velour', 7, 240, 44100]);
  await Promise.resolve();
  t.mock.timers.tick(90 * 60_000 + 1);
  await Promise.resolve();
  emitDownload(wav); finishRender(stats);
  assert.deepEqual(await pending, { stats, download: wav });
});

test('render and download failures reject promptly while the other operation is still pending', async () => {
  const pending = () => new Promise(() => {});
  await assert.rejects(renderDownload({ waitForEvent: pending, evaluate: () => Promise.reject(Error('render failed')) }, []), /render failed/);
  await assert.rejects(renderDownload({ waitForEvent: () => Promise.reject(Error('browser closed')), evaluate: pending }, []), /browser closed/);
});

test('resume restores a completed performance behind an index gap and reuses only verified matching bytes', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'score-resume-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  const saved = (id, k, body) => {
    const bytes = Buffer.from(body), sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(out, `${sha256}.m4a`), bytes);
    return { seed: performanceSeed(id, k), url: cdnUrl(sha256, 'm4a'), bytes: bytes.length, sha256 };
  };
  const a = saved('a', 0, 'first'), hidden = saved('a', 2, 'third'), corrupt = saved('b', 0, 'bad!'), wrongSeed = saved('c', 0, 'wrong seed'), wrongRate = saved('d', 0, 'wrong rate');
  writeFileSync(join(out, `${corrupt.sha256}.m4a`), 'oops'); // same length, different hash
  const index = { version: 2, format: 'audio/mp4', sampleRate: 44100, seconds: 240, pieces: { a: { seconds: 240, performances: [a] }, b: { seconds: 240, performances: [corrupt] } } };
  const stats = (p) => ({ ...p, seconds: 240, sampleRate: 44100 });
  const renders = { 'a#2': stats(hidden), 'b#0': stats(corrupt), 'c#0': { ...stats(wrongSeed), seed: 123 }, 'd#0': { ...stats(wrongRate), sampleRate: 48000 } };
  const options = { ids: ['a', 'b', 'c', 'd'], performances: 3, out, seconds: 240, rate: 44100, format: 'm4a' };
  const result = resumeRenders(index, renders, options);
  assert.deepEqual([...result.ready], ['a#0', 'a#2']); assert.equal(result.recovered, 1);
  assert.deepEqual(index.pieces.a.performances[2], hidden);
  assert.deepEqual(JSON.parse(indexText(index)).pieces.a.performances, [a], 'client index stays contiguous until the gap is filled');
  const restarted = JSON.parse(indexText(index));
  assert.ok(resumeRenders(restarted, renders, options).ready.has('a#2'), 'a second restart keeps the hidden completed bytes');
  assert.equal(resumeRenders(index, renders, { ...options, force: true }).ready.size, 0);
});

test('the committed index (when present) names every piece on the playlist at most once, each performance with its seed and the CDN key of its hash', () => {
  const index = readIndex(INDEX), shas = new Set();
  for (const [id, e] of Object.entries(index.pieces)) {
    assert.ok(PLAYLIST.includes(id), `${id} is not on the playlist`);
    assert.ok(e.seconds > 0 && e.performances.length > 0, id);
    e.performances.forEach((p, k) => {
      assert.match(p.sha256, /^[0-9a-f]{64}$/); assert.equal(p.url, cdnUrl(p.sha256, p.url.split('.').pop()));
      assert.ok(p.bytes > 0); assert.equal(p.seed, performanceSeed(id, k), `${id}#${k}`);
      assert.ok(!shas.has(p.sha256), `${id}#${k} repeats a file`); shas.add(p.sha256);
    });
  }
});

test('the publish plan rehashes each file, reports the missing ones and refuses a file that is not the index bytes', () => {
  const out = mkdtempSync(join(tmpdir(), 'score-audio-')), body = Buffer.from('not really aac'), sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(out, `${sha}.m4a`), body);
  const bad = 'cd'.repeat(32); writeFileSync(join(out, `${bad}.m4a`), Buffer.from('other'));
  const index = { pieces: { velour: { url: cdnUrl(sha, 'm4a'), seconds: 240, seed: 1, bytes: body.length, sha256: sha }, halogen: { url: cdnUrl('ef'.repeat(32), 'm4a'), seconds: 240, seed: 2, bytes: 5, sha256: 'ef'.repeat(32) } } };
  const p = plan({ out, index });
  assert.equal(p.objects.length, 1); assert.deepEqual(p.missing.map((m) => m.id), ['halogen#0']);
  assert.deepEqual({ ...p.objects[0], file: undefined }, { id: 'velour#0', key: `assets/${sha.slice(0, 2)}/${sha}.m4a`, file: undefined, bytes: body.length, sha256: sha, contentType: 'audio/mp4', cacheControl: 'public, max-age=31536000, immutable', licence: 'own-work', url: cdnUrl(sha, 'm4a') });
  const two = plan({ out, index: { version: 2, pieces: { velour: { seconds: 240, performances: [{ seed: 1, url: cdnUrl(sha, 'm4a'), bytes: body.length, sha256: sha }, { seed: 2, url: cdnUrl('ef'.repeat(32), 'm4a'), bytes: 5, sha256: 'ef'.repeat(32) }] } } } });
  assert.deepEqual([two.objects.map((o) => o.id), two.missing.map((m) => m.id)], [['velour#0'], ['velour#1']]);
  assert.throws(() => plan({ out, index: { pieces: { velour: { url: cdnUrl(bad, 'm4a'), seconds: 240, seed: 1, bytes: 5, sha256: bad } } } }), /not the index's bytes/);
});
