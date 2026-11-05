// node --test tools/god-skill/thumbnail.test.mjs — `eden-god thumbnail` (#887): framing defaults, PNG → JPEG, the
// launcher endpoint, refusals with their fix, --clear, --dry/--out. Offline: look and fetch are stand-ins; the JPEG
// encoder is checked against the PNG it came from, decoded by ffmpeg when it is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THUMB_SIZE, framing, thumbnail, thumbnailEndpoint, toJpeg } from './lib/thumbnail.mjs';
import { decodePng, encodeJpeg } from './lib/jpeg.mjs';
import { validateUpload } from '../../apps/server/src/moderation/validate.ts';

const dir = mkdtempSync(join(tmpdir(), 'god-thumb-test-'));
const CRC = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** An RGB(A) PNG with every filter type in use, the way Chrome writes them. */
function png(w, h, pixel, ch = 3) {
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * ch + 1)] = 0; for (let x = 0; x < w; x++) pixel(x, y).slice(0, ch).forEach((v, k) => { raw[y * (w * ch + 1) + 1 + x * ch + k] = v; }); }
  // re-filter rows with Sub/Up/Average/Paeth so the decoder's unfiltering is exercised
  const out = Buffer.alloc(raw.length), s = w * ch;
  for (let y = 0; y < h; y++) {
    const f = y % 5, o = y * (s + 1); out[o] = f;
    for (let i = 0; i < s; i++) {
      const v = raw[o + 1 + i], a = i >= ch ? raw[o + 1 + i - ch] : 0, b = y ? raw[o - s - 1 + 1 + i] : 0, c = i >= ch && y ? raw[o - s - 1 + 1 + i - ch] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const p = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      out[o + 1 + i] = (v - p) & 255;
    }
  }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out)), chunk('IEND', Buffer.alloc(0))]);
}
const scene = (x, y) => [Math.round(90 + 80 * Math.sin(x / 40)), Math.round(140 + 60 * Math.cos(y / 30)), (x >> 6) % 2 ? 200 : 60, 255];
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('the PNG decoder reads every filter, RGB and RGBA', () => {
  for (const ch of [3, 4]) {
    const d = decodePng(png(37, 23, scene, ch));
    assert.deepEqual([d.width, d.height], [37, 23]);
    for (const [x, y] of [[0, 0], [36, 22], [17, 11]]) assert.deepEqual([...d.data.subarray((y * 37 + x) * 4, (y * 37 + x) * 4 + 4)], scene(x, y), `${ch} channels at ${x},${y}`);
  }
  assert.throws(() => decodePng(Buffer.from('not a png at all, really not one')), /not a PNG/);
});

test('the JPEG encoder: what the launcher gate accepts, and faithful to the source', () => {
  const src = decodePng(png(1280, 720, scene));
  const j = encodeJpeg(src, { quality: 82 });
  const v = validateUpload(j, { formats: ['jpg'], maxBytes: 512 * 1024, maxTris: 0, maxTextures: 1, maxTexPx: 4096, maxImageBytes: 512 * 1024 });
  assert.deepEqual([v.images[0].w, v.images[0].h], [1280, 720]); assert.equal(v.stripped.bytes, 0, 'nothing to strip');
  assert.ok(j.length < 480 * 1024, `${j.length} bytes`);
  assert.ok(encodeJpeg(src, { quality: 40 }).length < j.length, 'quality scales the size');
  if (!ffmpeg) return;   // decoding needs a reference decoder; recorded in the PR when absent
  const f = join(dir, 'e.jpg'); writeFileSync(f, j);
  const dec = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
  assert.equal(dec.length, src.data.length);
  let se = 0, n = 0; for (let i = 0; i < dec.length; i++) if (i % 4 !== 3) { se += (dec[i] - src.data[i]) ** 2; n++; }
  const psnr = 10 * Math.log10(255 ** 2 / (se / n));
  assert.ok(psnr > 32, `PSNR ${psnr.toFixed(1)} dB`);
});

test('framing defaults: south-west, midday, clear, 1280×720; each overridable', () => {
  assert.deepEqual(framing(), { from: 'sw', hour: '12:00', weather: 'clear', width: '1280', h: '720', json: true });
  assert.deepEqual(framing({ from: 'n', at: 'plaza', hour: '17:30', remote: true, span: '60' }), { from: 'n', hour: '17:30', weather: 'clear', width: '1280', h: '720', json: true, at: 'plaza', span: '60', remote: true });
  assert.deepEqual(THUMB_SIZE, { width: 1280, height: 720 });
});

test('the endpoint is the launcher beside the world, under any base', () => {
  assert.deepEqual(thumbnailEndpoint('http://127.0.0.1:4720/w/proof-garden'), { url: 'http://127.0.0.1:4720/__sim/worlds/proof-garden/thumbnail', slug: 'proof-garden', site: 'http://127.0.0.1:4720/' });
  assert.equal(thumbnailEndpoint('https://example.test/worlds/w/hollow/?dev=1').url, 'https://example.test/worlds/__sim/worlds/hollow/thumbnail');
  assert.throws(() => thumbnailEndpoint('http://127.0.0.1:4710/'), /world launcher/);
});

const state = { world: 'http://127.0.0.1:4720/w/hollow', token: 'god_test' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('thumbnail: frames a look, sends a JPEG with the god token, reports what the launcher kept', async () => {
  const shot = join(dir, 'shot.png'); writeFileSync(shot, png(1280, 720, scene, 4));
  const looks = [], sent = [];
  const out = await thumbnail({}, { load: () => state, look: async (f) => { looks.push(f); writeFileSync(f.out, readFileSync(shot)); return { file: f.out, at: [4, 0, -2] }; },
    fetch: async (url, o) => { sent.push({ url, ...o }); return reply(200, { ok: true, thumbnail: '/__sim/thumbs/hollow/x.jpg', thumbnailSource: 'owner', width: 1280, height: 720, bytes: o.body.length }); } });
  assert.equal(looks.length, 1); assert.equal(looks[0].from, 'sw'); assert.equal(looks[0].hour, '12:00'); assert.match(looks[0].out, /look\.png$/);
  assert.equal(existsSync(looks[0].out), false, 'the look is not left behind');
  assert.equal(sent.length, 1); assert.equal(sent[0].url, 'http://127.0.0.1:4720/__sim/worlds/hollow/thumbnail'); assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].headers.authorization, 'Bearer god_test'); assert.equal(sent[0].headers['content-type'], 'image/jpeg');
  assert.deepEqual([...sent[0].body.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.match(out, /^thumbnail: set for hollow from a look from the sw at 12:00 toward \(4, 0, -2\), 1280×720, JPEG q82, 1280×720, \d+ KB/);
});

test('thumbnail: --file (JPEG as is, PNG re-encoded), --dry --out sends nothing, --clear deletes', async () => {
  const jpg = join(dir, 'mine.jpg'); writeFileSync(jpg, encodeJpeg(decodePng(png(640, 360, scene)), { quality: 70 }));
  let sent = [];
  const fetch = async (url, o) => { sent.push({ url, ...o }); return o.method === 'DELETE' ? reply(200, { ok: true, thumbnail: '/__sim/thumbs/_template/y.jpg', thumbnailSource: 'template' }) : reply(200, { ok: true, width: 640, height: 360, bytes: o.body.length }); };
  await thumbnail({ file: jpg }, { load: () => state, fetch });
  assert.deepEqual(Buffer.from(sent[0].body), readFileSync(jpg), 'a JPEG is sent byte for byte');
  const pngFile = join(dir, 'mine.png'); writeFileSync(pngFile, png(640, 360, scene));
  sent = []; assert.match(await thumbnail({ file: pngFile }, { load: () => state, fetch }), /re-encoded as JPEG q82/);
  sent = []; const keep = join(dir, 'kept.jpg');
  const dry = await thumbnail({ file: pngFile, dry: true, out: keep }, { load: () => ({ world: state.world }), fetch });
  assert.equal(sent.length, 0); assert.match(dry, /nothing sent/); assert.deepEqual([...readFileSync(keep).subarray(0, 2)], [0xff, 0xd8]);
  assert.match(await thumbnail({ clear: true }, { load: () => state, fetch }), /cleared for hollow; the world list shows the template's default picture/);
  assert.equal(sent[0].method, 'DELETE');
  assert.equal(toJpeg(readFileSync(jpg)).quality, null);
  assert.throws(() => toJpeg(Buffer.from('GIF89a')), /JPEG or PNG/);
});

test('thumbnail: a refusal names the code and the launcher’s fix; no token, no upload', async () => {
  const jpg = join(dir, 'tall.jpg'); writeFileSync(jpg, encodeJpeg(decodePng(png(400, 600, scene))));
  const fetch = async () => reply(400, { ok: false, code: 'thumbnail.dimensions', message: 'The image is 400×600; a thumbnail is 16:9', fix: 'Crop or resize it to 16:9, 640–1920 px wide; 1280×720 is the default.' });
  await assert.rejects(thumbnail({ file: jpg }, { load: () => state, fetch }), /refused: thumbnail\.dimensions: .*\n {2}fix: Crop or resize/);
  await assert.rejects(thumbnail({ file: jpg }, { load: () => ({ world: state.world }), fetch }), /no god token; run pair/);
});
