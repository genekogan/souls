#!/usr/bin/env node
// PERF-MUSIC: serves the rendered playlist audio (tools/score/render-playlist.mjs) from a local folder with open CORS and
// Range requests, for proofs of a local web build: the asset bucket's CORS admits only the production origins, so a page on
// localhost cannot route the CDN files through Web Audio. Open the world with `?musicAudio=http://127.0.0.1:<port>` and
// the player (gen-mesh/music-file.ts) fetches each file by name from here instead of the CDN. Never for production.
//
//   node tools/score/serve-playlist-audio.mjs [--dir .local/score-audio] [--port 5213]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const TYPES = { m4a: 'audio/mp4', webm: 'audio/webm', mp3: 'audio/mpeg' };
const args = process.argv.slice(2), value = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = resolve(value('--dir', '.local/score-audio')), port = +value('--port', 5213);
let served = 0;
createServer((req, res) => {
  const m = /^\/([0-9a-f]{64})\.(m4a|webm|mp3)$/.exec(new URL(req.url, 'http://x').pathname);
  const file = m && resolve(dir, `${m[1]}.${m[2]}`);
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Length,Content-Range,Accept-Ranges' };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-headers': 'range' }); return res.end(); }
  if (!file || !existsSync(file)) { res.writeHead(404, cors); return res.end(); }
  const size = statSync(file).size, type = TYPES[m[2]], range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0, end = size - 1, status = 200;
  if (range && (range[1] || range[2])) { start = range[1] ? +range[1] : Math.max(0, size - +range[2]); end = range[1] && range[2] ? Math.min(+range[2], size - 1) : end; status = 206; }
  if (start > end || start >= size) { res.writeHead(416, { ...cors, 'content-range': `bytes */${size}` }); return res.end(); }
  const headers = { ...cors, 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'cache-control': 'no-store', ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) };
  res.writeHead(status, headers);
  served++;
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`playlist audio: ${dir} at http://127.0.0.1:${port}/ (open the world with ?musicAudio=http://127.0.0.1:${port})`));
process.on('SIGINT', () => { console.log(`served ${served} requests`); process.exit(0); });
