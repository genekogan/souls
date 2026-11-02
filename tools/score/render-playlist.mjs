#!/usr/bin/env node
// PERF-MUSIC (2026-11-01, Gene: "can we move music to a separate thread, and make them all mp3s instead of rendering
// over cpu?"): renders every playlist piece offline to an audio file, so the world plays files (decoded by the browser's
// media pipeline, off the main thread) instead of synthesising Tone.js on the main thread. The Tone path stays as the
// fallback (gen-mesh/music.ts).
//
// Each piece renders with the engine's own Sim.renderOffline (playlist/engine.mjs, end of the Conductor section: the same
// instruments and master compressor + limiter at -1 dBFS as live playback) inside headless Chrome (Tone's PluckSynth and
// BitCrusher need worklets, so this cannot run under Node). One deterministic seed per piece (FNV-1a of its id), TRACK_S
// seconds, 44.1 kHz stereo; the float WAV is downloaded from the page, encoded with ffmpeg (AAC in an .m4a with the moov
// up front, so a media element can start before the file is down; `--format opus|mp3` for the others) and named by its
// SHA-256, the CDN's content-addressed key. Peak and RMS are measured on the render; a clipping or silent render fails.
//
//   node tools/score/render-playlist.mjs [--pieces a,b] [--out .local/score-audio] [--seconds 240] [--rate 44100]
//                                         [--format m4a] [--bitrate 160k] [--concurrency 4] [--force] [--dry-run]
//                                         [--index <file>]   (another index, for trials; default the committed one)
//                                         [--performances 3] (renders per piece, each its own seed)
//
// Each piece has several performances (perf-music-seeds, 2026-11-02): performance 0 is seeded by FNV-1a of the id, k > 0
// by FNV-1a of `<id>#<k>`, so the player can pick one at random and a piece does not sound identical every time.
// Writes <out>/<sha256>.<ext> per performance, <out>/renders.json (every render's stats, keyed `<id>#<k>`) and the index
// the client imports, apps/web/src/score/playlist/playlist-audio.json (version 2: piece id -> seconds and performances
// [{seed, url, bytes, sha256}]), with the CDN URL each file will have once tools/score/publish-playlist-audio.mjs has
// uploaded it. A performance already in the index whose file is in <out> is skipped unless --force. Media never enters
// git: <out> is under the ignored .local/.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findPlaywright } from '../god-skill/lib/look.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PLAYLIST_DIR = resolve(root, 'apps/web/src/score/playlist');
export const INDEX = resolve(PLAYLIST_DIR, 'playlist-audio.json');
export const CDN = 'https://assets.eden.art';
export const TRACK_S = 240;
/** Encoded peak ceiling (linear): -1 dBFS, the engine's own limiter threshold. */
export const PEAK_TARGET = Math.pow(10, -1 / 20);
const TONE_UMD = resolve(root, 'apps/web/node_modules/tone/build/Tone.js');
const FORMATS = {
  m4a: { ext: 'm4a', type: 'audio/mp4', args: (codec, br) => ['-c:a', codec, '-b:a', br, '-movflags', '+faststart'] },
  opus: { ext: 'webm', type: 'audio/webm', args: (_c, br) => ['-c:a', 'libopus', '-b:a', br] },
  mp3: { ext: 'mp3', type: 'audio/mpeg', args: (_c, br) => ['-c:a', 'libmp3lame', '-b:a', br] },
};

/** One deterministic seed per piece: FNV-1a (32-bit) of its id, kept to 31 bits like the player's seeds. */
export function pieceSeed(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 1;
}
/** The seed of a piece's k-th performance: performance 0 keeps the piece seed (the first published files). */
export const performanceSeed = (id, k) => pieceSeed(k ? `${id}#${k}` : id);
export const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const cdnUrl = (sha, ext, cdn = CDN) => `${cdn}/assets/${sha.slice(0, 2)}/${sha}.${ext}`;
const db = (x) => (x > 0 ? +(20 * Math.log10(x)).toFixed(2) : -Infinity);

/** The render page: Tone's UMD bundle, the generated engine, one renderOffline per call, the float WAV as a download. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>render</title><script src="/tone.js"></script>
<script type="module">
import { createPlaylistScore, loadPiece } from '/playlist/engine.mjs';
const Sim = createPlaylistScore(Tone);
window.__render = async (id, seed, seconds, sampleRate) => {
  if (!Sim.pieces.find((p) => p.id === id)) (await loadPiece(id)).default(Sim, Tone);
  const piece = Sim.pieces.find((p) => p.id === id);
  if (!piece) throw Error('no piece ' + id);
  // the seed fixes the notes. The engine's humanise jitter and Tone's noise draw from Math.random, seeded here too
  // (mulberry32; the vendored engine is untouched). Renders are still not bit-identical run to run: Tone's Reverb builds
  // its impulse in a nested async offline render whose draws interleave with the piece's (measured: same peak and RMS,
  // decoded samples differ from ~1 s). The file, not the seed, is the record; its sha256 is in the index.
  let rs = seed >>> 0; Math.random = () => { rs = (rs + 0x6d2b79f5) >>> 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const t0 = performance.now();
  const tb = await Sim.renderOffline(piece, { seconds, seed, sampleRate, channels: 2 });
  const buf = tb.get(), n = buf.length, ch = buf.numberOfChannels;
  let peak = 0, sq = 0, first = -1, last = -1;
  const data = [];
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c); data.push(d);
    for (let i = 0; i < n; i++) { const v = d[i], a = v < 0 ? -v : v; if (a > peak) peak = a; sq += v * v; if (a > 1e-4) { if (first < 0 || i < first) first = i; if (i > last) last = i; } }
  }
  // 32-bit float WAV, interleaved
  const bytes = n * ch * 4, head = new DataView(new ArrayBuffer(44)), w = (o, s) => { for (let i = 0; i < s.length; i++) head.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); head.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt '); head.setUint32(16, 16, true); head.setUint16(20, 3, true); head.setUint16(22, ch, true);
  head.setUint32(24, sampleRate, true); head.setUint32(28, sampleRate * ch * 4, true); head.setUint16(32, ch * 4, true); head.setUint16(34, 32, true); w(36, 'data'); head.setUint32(40, bytes, true);
  const pcm = new Float32Array(n * ch);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) pcm[i * ch + c] = data[c][i];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([head, pcm], { type: 'audio/wav' })); a.download = id + '.wav'; document.body.append(a); a.click();
  return { peak, rms: Math.sqrt(sq / (n * ch)), renderMs: Math.round(performance.now() - t0), frames: n, firstSoundS: first < 0 ? null : +(first / sampleRate).toFixed(2), lastSoundS: last < 0 ? null : +(last / sampleRate).toFixed(2), title: piece.title ?? id, bpm: piece.bpm };
};
</script>`;

/** A loopback server for the page, Tone and the generated playlist (engine + piece chunks). */
function serve() {
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html' };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    let file = null;
    if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (path === '/' || path === '/render.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (path === '/tone.js') file = TONE_UMD;
    else if (/^\/playlist\/(engine\.mjs|pieces\/[a-z0-9-]+\.mjs)$/.test(path)) file = resolve(PLAYLIST_DIR, path.slice('/playlist/'.length));
    if (!file || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

export function ffmpegCodec(format) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const has = (c) => new RegExp(`^\\s*A[^\\n]*\\s${c}\\s`, 'm').test(r.stdout);
  if (format === 'm4a') return has('aac_at') ? 'aac_at' : has('libfdk_aac') ? 'libfdk_aac' : has('aac') ? 'aac' : null;
  if (format === 'opus') return has('libopus') ? 'libopus' : null;
  if (format === 'mp3') return has('libmp3lame') ? 'libmp3lame' : null;
  return null;
}
/** `gain` < 1 scales a render whose float peak overshoots the limiter down to PEAK_TARGET before encoding. */
function encode(wav, out, format, codec, bitrate, gain = 1) {
  const f = FORMATS[format];
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...(gain < 1 ? ['-af', `volume=${gain.toFixed(6)}`] : []), ...f.args(codec, bitrate), out], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`ffmpeg failed for ${wav}: ${r.stderr}`);
}

/** The index, as version 2 (a version 1 index, one file per piece, reads as one performance each). */
export function readIndex(file = INDEX) {
  if (!existsSync(file)) return { version: 2, generated: null, format: null, sampleRate: 44100, channels: 2, seconds: TRACK_S, pieces: {} };
  return upgradeIndex(JSON.parse(readFileSync(file, 'utf8')));
}
export function upgradeIndex(index) {
  if (index.version >= 2) return index;
  const pieces = {};
  for (const [id, e] of Object.entries(index.pieces)) pieces[id] = { seconds: e.seconds, performances: [{ seed: e.seed, url: e.url, bytes: e.bytes, sha256: e.sha256 }] };
  return { ...index, version: 2, pieces };
}
/** A stable text for the index: fields in a fixed order, one piece per line. */
export function indexText(index) {
  const ids = Object.keys(index.pieces).sort();
  const head = { version: 2, generated: index.generated, format: index.format, sampleRate: index.sampleRate, channels: index.channels, seconds: index.seconds, note: index.note };
  // performances are written contiguous from 0: one rendered ahead of a missing one waits for the next run
  const piece = (e) => { const n = e.performances.findIndex((p) => !p); return { seconds: e.seconds, performances: n < 0 ? e.performances : e.performances.slice(0, n) }; };
  return `${JSON.stringify(head).slice(0, -1)},"pieces":{\n${ids.map((id, i) => `${JSON.stringify(id)}:${JSON.stringify(piece(index.pieces[id]))}${i < ids.length - 1 ? ',' : ''}`).join('\n')}\n}}\n`;
}

async function renderAll({ pieces, performances = 3, out, seconds, rate, format, bitrate, concurrency, force, dryRun, indexFile = INDEX, log = console.log }) {
  const { PLAYLIST } = await import(pathToFileURL(resolve(PLAYLIST_DIR, 'engine.mjs')).href);
  const ids = pieces ?? [...PLAYLIST];
  for (const id of ids) if (!PLAYLIST.includes(id)) throw Error(`not on the playlist: ${id}`);
  const f = FORMATS[format]; if (!f) throw Error(`--format takes ${Object.keys(FORMATS).join('|')}`);
  const codec = ffmpegCodec(format); if (!codec) throw Error(`ffmpeg with an encoder for ${format} is needed (which ffmpeg; ffmpeg -encoders)`);
  mkdirSync(out, { recursive: true });
  const index = readIndex(indexFile), renders = existsSync(join(out, 'renders.json')) ? JSON.parse(readFileSync(join(out, 'renders.json'), 'utf8')) : {};
  const have = (id, k) => { const e = index.pieces[id], p = e?.performances?.[k]; return !force && e?.seconds === seconds && p?.seed === performanceSeed(id, k) && existsSync(join(out, `${p.sha256}.${f.ext}`)); };
  // performance-major order (every piece's k = 1 before any k = 2), so an interrupted run leaves whole tiers
  const todo = Array.from({ length: performances }, (_, k) => ids.map((id) => ({ id, k }))).flat().filter(({ id, k }) => !have(id, k));
  log(`render: ${todo.length} of ${ids.length * performances} performances (${ids.length} pieces x ${performances}), ${seconds} s at ${rate} Hz, ${format} (${codec} ${bitrate}), ${concurrency} at a time -> ${out}`);
  if (dryRun || !todo.length) return { index, renders, rendered: [] };
  const pw = findPlaywright(); if (!pw) throw Error('no Playwright found (pnpm install)');
  const { server, origin } = await serve();
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
  const rendered = [], failures = [];
  const queue = [...todo];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { id, k } = job, key = `${id}#${k}`;
      const ctx = await browser.newContext({ acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
      try {
        await page.goto(`${origin}/render.html`, { waitUntil: 'load' });
        const seed = performanceSeed(id, k), t0 = Date.now();
        // a slow render (a busy machine, a heavy piece) must not take the run down: the download wait is long, and its
        // rejection is handled (it is awaited after the render; unawaited, a timeout was an uncaught rejection)
        const download = page.waitForEvent('download', { timeout: 90 * 60_000 }); download.catch(() => {});
        const stats = await page.evaluate(([id, seed, seconds, rate]) => window.__render(id, seed, seconds, rate), [id, seed, seconds, rate]);
        const wav = join(out, `${id}.${k}.wav`);
        await (await download).saveAs(wav);
        const peakDb = db(stats.peak), rmsDb = db(stats.rms);
        // Tone.Limiter(-1) is a fast compressor, not a brick wall: some pieces overshoot 0 dBFS in the float render (live
        // playback clips them at the output). Those are scaled to PEAK_TARGET before encoding, so the file plays clean; a
        // render far over is a broken piece.
        if (stats.peak >= 4) throw Error(`${id}: render clips (peak ${peakDb} dBFS)`);
        const gain = stats.peak > PEAK_TARGET ? PEAK_TARGET / stats.peak : 1, gainDb = gain < 1 ? +(20 * Math.log10(gain)).toFixed(2) : 0;
        if (stats.rms < 1e-3) throw Error(`${id}: render is silent (rms ${rmsDb} dBFS)`);
        if (stats.lastSoundS == null || stats.lastSoundS < seconds * 0.5) throw Error(`${id}: sound ends at ${stats.lastSoundS} s of ${seconds}`);
        const tmp = join(out, `${id}.${k}.tmp.${f.ext}`);
        encode(wav, tmp, format, codec, bitrate, gain);
        const sha = sha256File(tmp), file = join(out, `${sha}.${f.ext}`);
        if (existsSync(file)) rmSync(tmp); else spawnSync('mv', [tmp, file]);
        rmSync(wav);
        const bytes = statSync(file).size;
        const entry = { seed, url: cdnUrl(sha, f.ext), bytes, sha256: sha };
        const piece = index.pieces[id]?.seconds === seconds ? index.pieces[id] : (index.pieces[id] = { seconds, performances: [] });
        piece.performances[k] = entry;
        renders[key] = { ...entry, seconds, title: stats.title, bpm: stats.bpm, peakDb, rmsDb, gainDb, firstSoundS: stats.firstSoundS, lastSoundS: stats.lastSoundS, renderMs: stats.renderMs, wallMs: Date.now() - t0, codec, bitrate, sampleRate: rate, at: new Date().toISOString(), pageErrors: errors.slice(0, 5) };
        rendered.push(key);
        log(`  ${key}: peak ${peakDb} dBFS${gain < 1 ? ` (scaled ${gainDb} dB)` : ''}, rms ${rmsDb} dBFS, sound ${stats.firstSoundS}–${stats.lastSoundS} s, render ${(stats.renderMs / 1000).toFixed(1)} s, ${(bytes / 1e6).toFixed(2)} MB ${sha.slice(0, 12)}…${errors.length ? ` (${errors.length} page errors)` : ''}`);
        // the index and stats after every piece, so an interrupted run keeps what it has
        index.generated = new Date().toISOString(); index.format = f.type; index.sampleRate = rate; index.channels = 2; index.seconds = seconds;
        index.version = 2;
        index.note = 'Generated by tools/score/render-playlist.mjs: every playlist piece rendered offline by the score engine, several performances (seeds) each, and encoded; the player (gen-mesh/music.ts) picks one at random and streams it instead of synthesising. Upload: tools/score/publish-playlist-audio.mjs.';
        writeFileSync(indexFile, indexText(index)); writeFileSync(join(out, 'renders.json'), JSON.stringify(renders, null, 1) + '\n');
      } catch (e) { failures.push({ id: key, error: String(e).slice(0, 300), pageErrors: errors.slice(0, 5) }); log(`  ${key}: FAILED ${String(e).slice(0, 200)}`); }
      finally { await ctx.close().catch(() => {}); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  await browser.close(); server.close();
  if (failures.length) { log(`render: ${failures.length} failed`); for (const f of failures) log(`  ${f.id}: ${f.error}${f.pageErrors.length ? `\n    ${f.pageErrors.join('\n    ')}` : ''}`); }
  const all = Object.values(index.pieces).flatMap((e) => e.performances), total = all.reduce((s, p) => s + p.bytes, 0);
  log(`render: ${rendered.length} rendered, index ${indexFile} (${Object.keys(index.pieces).length} pieces, ${all.length} performances, ${(total / 1e6).toFixed(1)} MB)`);
  if (failures.length) process.exitCode = 1;
  return { index, renders, rendered, failures };
}

async function main() {
  const args = process.argv.slice(2), value = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  await renderAll({
    pieces: value('--pieces') ? value('--pieces').split(',') : null, performances: +value('--performances', 3), out: resolve(value('--out', '.local/score-audio')),
    seconds: +value('--seconds', TRACK_S), rate: +value('--rate', 44100), format: value('--format', 'm4a'), bitrate: value('--bitrate', '160k'),
    concurrency: +value('--concurrency', 4), force: args.includes('--force'), dryRun: args.includes('--dry-run'), indexFile: resolve(value('--index', INDEX)),
  });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
