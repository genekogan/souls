// A small baseline JPEG encoder and PNG decoder, so `thumbnail` can turn any look (a local Chrome screenshot or the
// world's own renderer, both PNG) into the JPEG the world list takes, with no dependency (eden-god.mjs is one file).
// Encoder: baseline sequential DCT, 4:2:0, the standard ITU T.81 Annex K tables scaled by quality the way libjpeg does.
// Decoder: 8-bit greyscale, RGB, grey+alpha and RGBA PNGs, non-interlaced (what Chrome writes); alpha is dropped.
import { inflateSync } from 'node:zlib';

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...Array(32).fill(99)];
// Annex K.3 Huffman tables: code counts per length 1..16, then the symbols
const DC_LUMA = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const DC_CHROMA = [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const AC_LUMA = [[0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];
const AC_CHROMA = [[0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];

/** Canonical Huffman codes (T.81 Annex C): symbol → [code, length]. */
function codes([counts, symbols]) {
  const out = new Map(); let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) { for (let i = 0; i < counts[len - 1]; i++) out.set(symbols[k++], [code++, len]); code <<= 1; }
  return out;
}
const scaled = (table, quality) => {
  const q = Math.min(100, Math.max(1, Math.round(quality))), s = q < 50 ? 5000 / q : 200 - 2 * q;
  return table.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))));
};
// the 8×8 DCT basis: A[u][x] = c(u)/2 · cos((2x+1)uπ/16)
const A = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => (u ? 1 : Math.SQRT1_2) / 2 * Math.cos((2 * x + 1) * u * Math.PI / 16)));

class Bits {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  put(code, len) {
    for (let i = len - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      if (++this.n === 8) { this.bytes.push(this.acc); if (this.acc === 0xff) this.bytes.push(0); this.acc = 0; this.n = 0; }
    }
  }
  flush() { if (this.n) this.put((1 << (8 - this.n)) - 1, 8 - this.n); }   // pad with 1s
}
const magnitude = (v) => { let a = Math.abs(v), n = 0; while (a) { n++; a >>= 1; } return n; };

/**
 * Encode RGBA (or RGB with `channels: 3`) pixels as a baseline 4:2:0 JFIF JPEG.
 * @param {{ width: number, height: number, data: Uint8Array, channels?: 3 | 4 }} image
 */
export function encodeJpeg({ width, height, data, channels = 4 }, { quality = 82 } = {}) {
  if (!(width > 0 && height > 0 && width < 65536 && height < 65536) || data.length < width * height * channels) throw Error('jpeg: bad image size');
  const ql = scaled(LUMA_Q, quality), qc = scaled(CHROMA_Q, quality);
  const dcL = codes(DC_LUMA), acL = codes(AC_LUMA), dcC = codes(DC_CHROMA), acC = codes(AC_CHROMA);
  // planes at full resolution, padded to whole 16×16 MCUs by repeating the edge
  const W = Math.ceil(width / 16) * 16, H = Math.ceil(height / 16) * 16;
  const Y = new Float32Array(W * H), Cb = new Float32Array(W * H), Cr = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * channels, r = data[o], g = data[o + 1], b = data[o + 2], i = y * W + x;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const bits = new Bits(), block = new Float32Array(64), tmp = new Float32Array(64), pred = [0, 0, 0];
  const encodeBlock = (q, dc, ac, comp) => {
    // F = A · f · Aᵀ, then quantise in zig-zag order
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let y = 0; y < 8; y++) s += A[v][y] * block[y * 8 + x]; tmp[v * 8 + x] = s; }
    const zz = new Int32Array(64);
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += tmp[v * 8 + x] * A[u][x]; block[v * 8 + u] = s; }
    for (let i = 0; i < 64; i++) zz[i] = Math.round(block[ZIGZAG[i]] / q[ZIGZAG[i]]);
    const diff = zz[0] - pred[comp]; pred[comp] = zz[0];
    const n = magnitude(diff); bits.put(...dc.get(n)); if (n) bits.put(diff < 0 ? diff + (1 << n) - 1 : diff, n);
    let run = 0;
    for (let i = 1; i < 64; i++) {
      const c = zz[i];
      if (!c) { run++; continue; }
      while (run > 15) { bits.put(...ac.get(0xf0)); run -= 16; }
      const m = magnitude(c); bits.put(...ac.get((run << 4) | m)); bits.put(c < 0 ? c + (1 << m) - 1 : c, m); run = 0;
    }
    if (run) bits.put(...ac.get(0x00));
  };
  for (let my = 0; my < H; my += 16) for (let mx = 0; mx < W; mx += 16) {
    for (const [ox, oy] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = Y[(my + oy + y) * W + mx + ox + x];
      encodeBlock(ql, dcL, acL, 0);
    }
    for (const [plane, comp] of [[Cb, 1], [Cr, 2]]) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (my + 2 * y) * W + mx + 2 * x; block[y * 8 + x] = (plane[i] + plane[i + 1] + plane[i + W] + plane[i + W + 1]) / 4; }
      encodeBlock(qc, dcC, acC, comp);
    }
  }
  bits.flush();
  const seg = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  const dht = (cls, id, [counts, symbols]) => [(cls << 4) | id, ...counts, ...symbols];
  const head = [0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, [0, ...ZIGZAG.map((k) => ql[k]), 1, ...ZIGZAG.map((k) => qc[k])]),
    ...seg(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xc4, [...dht(0, 0, DC_LUMA), ...dht(1, 0, AC_LUMA), ...dht(0, 1, DC_CHROMA), ...dht(1, 1, AC_CHROMA)]),
    ...seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])];
  const out = new Uint8Array(head.length + bits.bytes.length + 2);
  out.set(head); out.set(bits.bytes, head.length); out.set([0xff, 0xd9], head.length + bits.bytes.length);
  return out;
}

/** Decode an 8-bit, non-interlaced PNG to RGBA. */
export function decodePng(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const u32 = (p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
  if (b.length < 33 || u32(0) !== 0x89504e47 || u32(4) !== 0x0d0a1a0a) throw Error('png: not a PNG file');
  let p = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0; const idat = [];
  while (p + 8 <= b.length) {
    const n = u32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]), d = b.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') { width = u32(p + 8); height = u32(p + 12); depth = d[8]; color = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + n;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (depth !== 8 || !ch || interlace) throw Error(`png: only 8-bit non-interlaced grey/RGB/RGBA images are supported (depth ${depth}, colour type ${color}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat)), stride = width * ch;
  if (raw.length < (stride + 1) * height) throw Error('png: truncated image data');
  const px = new Uint8Array(stride * height), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[o + i - ch] : 0, up = y ? px[o - stride + i] : 0, c = i >= ch && y ? px[o - stride + i - ch] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const pred = f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? up : c) : 0;
      px[o + i] = (row[i] + pred) & 255;
    }
  }
  for (let i = 0, j = 0; i < width * height; i++, j += ch) {
    const g = ch < 3;
    rgba[i * 4] = px[j]; rgba[i * 4 + 1] = g ? px[j] : px[j + 1]; rgba[i * 4 + 2] = g ? px[j] : px[j + 2]; rgba[i * 4 + 3] = ch === 4 ? px[j + 3] : ch === 2 ? px[j + 1] : 255;
  }
  return { width, height, data: rgba, channels: 4 };
}
