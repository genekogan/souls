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
//
// Writes <out>/<sha256>.<ext> per piece, <out>/renders.json (every render's stats) and the index the client imports,
// apps/web/src/score/playlist/playlist-audio.json (piece id -> url, seconds, seed, bytes, sha256), with the CDN URL the
// file will have once tools/score/publish-playlist-audio.mjs has uploaded it. A piece already in the index whose file is
// in <out> is skipped unless --force. Media never enters git: <out> is under the ignored .local/.
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
function encode(wav, out, format, codec, bitrate) {
  const f = FORMATS[format];
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...f.args(codec, bitrate), out], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`ffmpeg failed for ${wav}: ${r.stderr}`);
}

export function readIndex(file = INDEX) {
  if (!existsSync(file)) return { version: 1, generated: null, format: null, sampleRate: 44100, channels: 2, seconds: TRACK_S, pieces: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}
/** A stable text for the index: fields in a fixed order, one piece per line. */
export function indexText(index) {
  const ids = Object.keys(index.pieces).sort();
  const head = { version: 1, generated: index.generated, format: index.format, sampleRate: index.sampleRate, channels: index.channels, seconds: index.seconds, note: index.note };
  return `${JSON.stringify(head).slice(0, -1)},"pieces":{\n${ids.map((id, i) => `${JSON.stringify(id)}:${JSON.stringify(index.pieces[id])}${i < ids.length - 1 ? ',' : ''}`).join('\n')}\n}}\n`;
}

async function renderAll({ pieces, out, seconds, rate, format, bitrate, concurrency, force, dryRun, log = console.log }) {
  const { PLAYLIST } = await import(pathToFileURL(resolve(PLAYLIST_DIR, 'engine.mjs')).href);
  const ids = pieces ?? [...PLAYLIST];
  for (const id of ids) if (!PLAYLIST.includes(id)) throw Error(`not on the playlist: ${id}`);
  const f = FORMATS[format]; if (!f) throw Error(`--format takes ${Object.keys(FORMATS).join('|')}`);
  const codec = ffmpegCodec(format); if (!codec) throw Error(`ffmpeg with an encoder for ${format} is needed (which ffmpeg; ffmpeg -encoders)`);
  mkdirSync(out, { recursive: true });
  const index = readIndex(), renders = existsSync(join(out, 'renders.json')) ? JSON.parse(readFileSync(join(out, 'renders.json'), 'utf8')) : {};
  const todo = ids.filter((id) => { const e = index.pieces[id]; return force || !e || e.seconds !== seconds || !existsSync(join(out, `${e.sha256}.${f.ext}`)); });
  log(`render: ${todo.length} of ${ids.length} pieces, ${seconds} s at ${rate} Hz, ${format} (${codec} ${bitrate}), ${concurrency} at a time -> ${out}`);
  if (dryRun || !todo.length) return { index, renders, rendered: [] };
  const pw = findPlaywright(); if (!pw) throw Error('no Playwright found (pnpm install)');
  const { server, origin } = await serve();
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
  const rendered = [], failures = [];
  const queue = [...todo];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const ctx = await browser.newContext({ acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
      try {
        await page.goto(`${origin}/render.html`, { waitUntil: 'load' });
        const seed = pieceSeed(id), t0 = Date.now();
        // a slow render (a busy machine, a heavy piece) must not take the run down: the download wait is long, and its
        // rejection is handled (it is awaited after the render; unawaited, a timeout was an uncaught rejection)
        const download = page.waitForEvent('download', { timeout: 90 * 60_000 }); download.catch(() => {});
        const stats = await page.evaluate(([id, seed, seconds, rate]) => window.__render(id, seed, seconds, rate), [id, seed, seconds, rate]);
        const wav = join(out, `${id}.wav`);
        await (await download).saveAs(wav);
        const peakDb = db(stats.peak), rmsDb = db(stats.rms);
        if (stats.peak >= 1) throw Error(`${id}: render clips (peak ${peakDb} dBFS)`);
        if (stats.rms < 1e-3) throw Error(`${id}: render is silent (rms ${rmsDb} dBFS)`);
        if (stats.lastSoundS == null || stats.lastSoundS < seconds * 0.5) throw Error(`${id}: sound ends at ${stats.lastSoundS} s of ${seconds}`);
        const tmp = join(out, `${id}.tmp.${f.ext}`);
        encode(wav, tmp, format, codec, bitrate);
        const sha = sha256File(tmp), file = join(out, `${sha}.${f.ext}`);
        if (existsSync(file)) rmSync(tmp); else spawnSync('mv', [tmp, file]);
        rmSync(wav);
        const bytes = statSync(file).size;
        const entry = { url: cdnUrl(sha, f.ext), seconds, seed, bytes, sha256: sha };
        index.pieces[id] = entry;
        renders[id] = { ...entry, title: stats.title, bpm: stats.bpm, peakDb, rmsDb, firstSoundS: stats.firstSoundS, lastSoundS: stats.lastSoundS, renderMs: stats.renderMs, wallMs: Date.now() - t0, codec, bitrate, sampleRate: rate, at: new Date().toISOString(), pageErrors: errors.slice(0, 5) };
        rendered.push(id);
        log(`  ${id}: peak ${peakDb} dBFS, rms ${rmsDb} dBFS, sound ${stats.firstSoundS}–${stats.lastSoundS} s, render ${(stats.renderMs / 1000).toFixed(1)} s, ${(bytes / 1e6).toFixed(2)} MB ${sha.slice(0, 12)}…${errors.length ? ` (${errors.length} page errors)` : ''}`);
        // the index and stats after every piece, so an interrupted run keeps what it has
        index.generated = new Date().toISOString(); index.format = f.type; index.sampleRate = rate; index.channels = 2; index.seconds = seconds;
        index.note = 'Generated by tools/score/render-playlist.mjs: every playlist piece rendered offline by the score engine (one seed each) and encoded; the player (gen-mesh/music.ts) streams these instead of synthesising. Upload: tools/score/publish-playlist-audio.mjs.';
        writeFileSync(INDEX, indexText(index)); writeFileSync(join(out, 'renders.json'), JSON.stringify(renders, null, 1) + '\n');
      } catch (e) { failures.push({ id, error: String(e).slice(0, 300), pageErrors: errors.slice(0, 5) }); log(`  ${id}: FAILED ${String(e).slice(0, 200)}`); }
      finally { await ctx.close().catch(() => {}); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  await browser.close(); server.close();
  if (failures.length) { log(`render: ${failures.length} failed`); for (const f of failures) log(`  ${f.id}: ${f.error}${f.pageErrors.length ? `\n    ${f.pageErrors.join('\n    ')}` : ''}`); }
  const total = Object.values(index.pieces).reduce((s, e) => s + e.bytes, 0);
  log(`render: ${rendered.length} rendered, index ${INDEX} (${Object.keys(index.pieces).length} pieces, ${(total / 1e6).toFixed(1)} MB)`);
  if (failures.length) process.exitCode = 1;
  return { index, renders, rendered, failures };
}

async function main() {
  const args = process.argv.slice(2), value = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  await renderAll({
    pieces: value('--pieces') ? value('--pieces').split(',') : null, out: resolve(value('--out', '.local/score-audio')),
    seconds: +value('--seconds', TRACK_S), rate: +value('--rate', 44100), format: value('--format', 'm4a'), bitrate: value('--bitrate', '160k'),
    concurrency: +value('--concurrency', 4), force: args.includes('--force'), dryRun: args.includes('--dry-run'),
  });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
