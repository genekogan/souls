// G8 moderation: the one front gate every upload passes before any store sees it (Soul body GLBs,
// Godmode models, images and footprints). Pure and dependency-free.
//
// - Size, format (by magic bytes, never by name or content-type), triangle and texture budgets.
// - Malformed containers are refused: GLB chunk layout, JSON, external/data URIs, embedded image
//   structure (PNG chunk CRCs and pixel-data size, JPEG segment walk, WebP/KTX2 headers).
// - Metadata is stripped: glTF `extras` everywhere, unknown GLB chunks, PNG text/time/EXIF and
//   unknown ancillary chunks, JPEG EXIF/XMP/IPTC/comments and bytes after the end marker.
//   Standalone images lose those segments; images embedded in a GLB are blanked in place (same length)
//   so no buffer offset moves. A clean file comes back byte-identical (its content address is stable).
// - The output carries the facts a classifier needs (metadata text seen before stripping, the images).
//
// The stores behind it keep their own deeper checks (BODY admission, Godmode's parseGlb/measureGlb).
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

export type UploadFormat = 'glb' | 'png' | 'jpg' | 'json';
export type UploadPolicy = {
  formats: readonly UploadFormat[];
  maxBytes: number; maxTris: number; maxTextures: number; maxTexPx: number; maxImageBytes: number;
};
/** Soul bodies: the BODY-v1 limits. Godmode assets: the world's budget is passed per call (see `assetPolicy`). */
export const BODY_UPLOAD_POLICY: UploadPolicy = { formats: ['glb'], maxBytes: 4 * 1024 * 1024, maxTris: 10_000, maxTextures: 2, maxTexPx: 1024, maxImageBytes: 1024 * 1024 };
export function assetPolicy(budget: { tris: number; bytes: number; texPx: number }): UploadPolicy {
  return { formats: ['glb', 'png', 'jpg', 'json'], maxBytes: budget.bytes, maxTris: budget.tris, maxTextures: 64, maxTexPx: budget.texPx, maxImageBytes: Math.min(budget.bytes, 8 * 1024 * 1024) };
}
export const FOOTPRINT_MAX_BYTES = 1_000_000;

export class UploadRejected extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const no = (status: number, code: string, message: string): never => { throw new UploadRejected(status, code, message); };

export type UploadImage = { mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/ktx2'; bytes: Uint8Array; w: number; h: number };
export type ValidatedUpload = {
  format: UploadFormat;
  /** What the store keeps: the input minus its metadata. */
  bytes: Uint8Array;
  sha: string; inputSha: string;
  tris: number; textures: number; texPx: number;
  stripped: { fields: number; chunks: number; segments: number; bytes: number };
  /** Metadata text seen before stripping (bounded), for a classifier. */
  text: string[];
  /** Images after stripping (standalone or embedded), for a classifier. */
  images: UploadImage[];
};

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, e));
const u32be = (b: Uint8Array, p: number) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const u16be = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const u32le = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const CRC = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const TEXT_BUDGET = 4096;
function noteText(out: string[], s: string) { const used = out.reduce((n, x) => n + x.length, 0); if (used < TEXT_BUDGET && s.trim()) out.push(s.slice(0, TEXT_BUDGET - used)); }

/** Sniff an upload by its first bytes. */
export function sniff(b: Uint8Array): UploadFormat | 'webp' | 'ktx2' | 'unknown' {
  if (b.length >= 4 && ascii(b, 0, 4) === 'glTF') return 'glb';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && b[0] === 0xab && ascii(b, 1, 7) === 'KTX 20') return 'ktx2';
  let i = 0; while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  if (b[i] === 0x7b) return 'json';
  return 'unknown';
}

// ---------------------------------------------------------------- PNG

/** PNG chunks that change how pixels look; everything else ancillary is metadata. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs']);
const PNG_TEXT = new Set(['tEXt', 'zTXt', 'iTXt']);
/** Validate a PNG; return its dimensions and its metadata chunks as [start, end) ranges. */
function checkPng(b: Uint8Array, policy: UploadPolicy, text: string[]) {
  if (b.length < 45 || u32be(b, 0) !== 0x89504e47 || u32be(b, 4) !== 0x0d0a1a0a) no(400, 'upload.image-invalid', 'Invalid PNG signature');
  let p = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0, ended = false, palette = false;
  const idat: Uint8Array[] = [], drop: [number, number][] = [];
  while (p < b.length) {
    if (p + 12 > b.length) no(400, 'upload.image-invalid', 'Truncated PNG chunk');
    const n = u32be(b, p), type = ascii(b, p + 4, p + 8), end = p + 12 + n;
    if (n > 0x7fffffff || end > b.length) no(400, 'upload.image-invalid', 'Truncated PNG chunk');
    if (!/^[A-Za-z]{4}$/.test(type)) no(400, 'upload.image-invalid', 'Invalid PNG chunk type');
    if (crc32(b.subarray(p + 4, p + 8 + n)) !== u32be(b, p + 8 + n)) no(400, 'upload.image-invalid', 'Invalid PNG checksum');
    if (p === 8) {
      if (type !== 'IHDR' || n !== 13) no(400, 'upload.image-invalid', 'PNG must begin with IHDR');
      w = u32be(b, p + 8); h = u32be(b, p + 12); depth = b[p + 16]; color = b[p + 17]; interlace = b[p + 20];
      if (!w || !h) no(400, 'upload.image-invalid', 'PNG has no pixels');
      if (Math.max(w, h) > policy.maxTexPx) no(413, 'upload.texture-budget', `Image ${w}×${h} exceeds ${policy.maxTexPx} px`);
      const okDepth: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!okDepth[color]?.includes(depth) || b[p + 18] !== 0 || b[p + 19] !== 0 || interlace > 1) no(400, 'upload.image-format', 'Unsupported PNG pixel layout');
    } else if (type === 'IHDR') no(400, 'upload.image-invalid', 'Duplicate PNG header');
    if (type === 'PLTE') palette = true;
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + n));
    if (!PNG_KEEP.has(type)) {
      if (type[0] === type[0].toUpperCase()) no(400, 'upload.image-format', `Unknown critical PNG chunk ${type}`);
      if (PNG_TEXT.has(type)) noteText(text, ascii(b, p + 8, p + 8 + Math.min(n, 512)).replace(/\0/g, ' '));
      drop.push([p, end]);
    }
    p = end;
    if (type === 'IEND') { if (n !== 0) no(400, 'upload.image-invalid', 'Invalid PNG end'); ended = true; break; }
  }
  if (!ended || !idat.length || (color === 3 && !palette)) no(400, 'upload.image-invalid', 'Incomplete PNG');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color], stride = Math.ceil((w * channels * depth) / 8) + 1;
  const expected = h * stride;
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: interlace ? expected * 2 : expected }); }
  catch { return no(400, 'upload.image-invalid', 'Invalid or excessive PNG pixel data'); }
  if (!interlace && pixels.length !== expected) no(400, 'upload.image-invalid', 'PNG pixel data does not match its dimensions');
  // trailing bytes after IEND are metadata too
  const trailer = p < b.length ? p : undefined;
  if (trailer !== undefined) drop.push([trailer, b.length]);
  return { w, h, drop, trailer, pixels: !interlace && depth === 8 && (color === 2 || color === 6) ? { data: pixels, channels, stride } : null };
}
export type DecodedRgb = { w: number; h: number; data: Uint8Array; channels: number; stride: number };
const decoded = new WeakMap<Uint8Array, DecodedRgb>();
/** Raw (still filtered) pixel rows of an 8-bit RGB/RGBA PNG checked by this module, for a local classifier. */
export function pngRows(image: UploadImage): DecodedRgb | null { return decoded.get(image.bytes) ?? null; }

// ---------------------------------------------------------------- JPEG

/** Validate a JPEG; return its dimensions and its metadata segments (and trailer) as [start, end) ranges. */
function checkJpeg(b: Uint8Array, policy: UploadPolicy, text: string[]) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) no(400, 'upload.image-invalid', 'Invalid JPEG header');
  let p = 2, w = 0, h = 0, sos = -1;
  const drop: [number, number][] = [];
  while (p < b.length) {
    if (b[p] !== 0xff) no(400, 'upload.image-invalid', 'Invalid JPEG marker');
    while (b[p] === 0xff) p++;
    const marker = b[p++];
    if (marker === undefined || marker === 0xd8 || marker === 0xd9 || marker === 0) no(400, 'upload.image-invalid', 'Invalid JPEG segment order');
    if (marker >= 0xd0 && marker <= 0xd7) no(400, 'upload.image-invalid', 'Restart marker outside a scan');
    if (p + 2 > b.length) no(400, 'upload.image-invalid', 'Truncated JPEG segment');
    const n = u16be(b, p), start = p - 2, end = p + n;
    if (n < 2 || end > b.length) no(400, 'upload.image-invalid', 'Truncated JPEG segment');
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (n < 8) no(400, 'upload.image-invalid', 'Invalid JPEG frame');
      if (![0xc0, 0xc1, 0xc2].includes(marker)) no(400, 'upload.image-format', 'Only baseline, extended and progressive JPEG are supported');
      h = u16be(b, p + 3); w = u16be(b, p + 5);
      if (!w || !h) no(400, 'upload.image-invalid', 'JPEG has no pixels');
      if (Math.max(w, h) > policy.maxTexPx) no(413, 'upload.texture-budget', `Image ${w}×${h} exceeds ${policy.maxTexPx} px`);
    }
    const app = marker >= 0xe0 && marker <= 0xef;
    const icc = marker === 0xe2 && ascii(b, p + 2, p + 14) === 'ICC_PROFILE\0';
    if ((app && marker !== 0xe0 && marker !== 0xee && !icc) || marker === 0xfe) {
      noteText(text, ascii(b, p + 2, Math.min(end, p + 2 + 512)).replace(/[^\x20-\x7e]+/g, ' '));
      drop.push([start, end]);
    }
    p = end;
    if (marker === 0xda) { sos = p; break; }
  }
  if (sos < 0 || !w) no(400, 'upload.image-invalid', 'Incomplete JPEG image');
  let eoi = -1;
  for (let i = b.length - 2; i >= sos; i--) if (b[i] === 0xff && b[i + 1] === 0xd9) { eoi = i + 2; break; }
  if (eoi < 0) no(400, 'upload.image-invalid', 'JPEG has no end marker');
  const trailer = eoi < b.length ? eoi : undefined;
  if (trailer !== undefined) drop.push([trailer, b.length]);
  return { w, h, drop, trailer };
}

// ---------------------------------------------------------------- one image

function checkImage(b: Uint8Array, mime: string | undefined, policy: UploadPolicy, text: string[]): { image: UploadImage; drop: [number, number][]; trailer?: number; kind: 'png' | 'jpg' | 'webp' | 'ktx2' } {
  const kind = sniff(b);
  if (b.length > policy.maxImageBytes) no(413, 'upload.texture-budget', `Image ${b.length} bytes exceeds ${policy.maxImageBytes}`);
  const declared = mime === undefined ? undefined : ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/ktx2': 'ktx2' } as Record<string, string>)[mime];
  if (mime !== undefined && declared !== kind) no(400, 'upload.image-format', `Embedded image is ${kind}, declared ${mime}`);
  if (kind === 'png') {
    const r = checkPng(b, policy, text), image: UploadImage = { mime: 'image/png', bytes: b, w: r.w, h: r.h };
    if (r.pixels) decoded.set(b, { w: r.w, h: r.h, ...r.pixels });
    return { image, drop: r.drop, trailer: r.trailer, kind };
  }
  if (kind === 'jpg') { const r = checkJpeg(b, policy, text); return { image: { mime: 'image/jpeg', bytes: b, w: r.w, h: r.h }, drop: r.drop, trailer: r.trailer, kind }; }
  if (kind === 'webp') {
    if (u32le(b, 4) + 8 !== b.length) no(400, 'upload.image-invalid', 'WebP size does not match its container');
    const fmt = ascii(b, 12, 16);
    const [w, h] = fmt === 'VP8 ' && b.length > 30 ? [((b[27] << 8) | b[26]) & 0x3fff, ((b[29] << 8) | b[28]) & 0x3fff]
      : fmt === 'VP8L' && b.length > 25 ? [(u32le(b, 21) & 0x3fff) + 1, ((u32le(b, 21) >> 14) & 0x3fff) + 1]
        : fmt === 'VP8X' && b.length > 30 ? [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))] : [0, 0];
    if (!w || !h) no(400, 'upload.image-invalid', 'Unreadable WebP header');
    if (Math.max(w, h) > policy.maxTexPx) no(413, 'upload.texture-budget', `Image ${w}×${h} exceeds ${policy.maxTexPx} px`);
    return { image: { mime: 'image/webp', bytes: b, w, h }, drop: [], kind };
  }
  if (kind === 'ktx2') {
    const w = u32le(b, 20), h = u32le(b, 24);
    if (!w) no(400, 'upload.image-invalid', 'Unreadable KTX2 header');
    if (Math.max(w, h) > policy.maxTexPx) no(413, 'upload.texture-budget', `Image ${w}×${h} exceeds ${policy.maxTexPx} px`);
    return { image: { mime: 'image/ktx2', bytes: b, w, h }, drop: [], kind };
  }
  return no(415, 'upload.image-format', 'Images must be PNG or JPEG (WebP/KTX2 only inside a GLB that declares them)');
}

const isSegment = (b: Uint8Array, s: number, e: number) => b[s] === 0xff && b[s + 1] !== 0xd9 && e - s >= 4 && u16be(b, s + 2) === e - s - 2;
const isChunk = (b: Uint8Array, s: number, e: number) => e - s >= 12 && u32be(b, s) === e - s - 12;
/** Blank metadata ranges in place: same length, so nothing after them moves. */
function blank(b: Uint8Array, kind: 'png' | 'jpg', drop: [number, number][], trailer?: number) {
  for (const [s, e] of drop) {
    if (s === trailer) { b.fill(0, s, e); continue; }
    if (kind === 'jpg') {
      if (isSegment(b, s, e)) { b[s + 1] = 0xfe; b.fill(0x20, s + 4, e); }  // segment → empty comment
      else b.fill(0, s, e);  // trailer after the end marker
    } else {
      if (isChunk(b, s, e)) {  // chunk → a private ancillary chunk of zeros, valid CRC
        b.set([0x7a, 0x65, 0x52, 0x6f], s + 4);  // "zeRo"
        b.fill(0, s + 8, e - 4);
        const c = crc32(b.subarray(s + 4, e - 4)); b[e - 4] = c >>> 24; b[e - 3] = (c >>> 16) & 255; b[e - 2] = (c >>> 8) & 255; b[e - 1] = c & 255;
      } else b.fill(0, s, e);  // trailer after IEND
    }
  }
}
/** Remove metadata ranges (standalone images). */
function cut(b: Uint8Array, drop: [number, number][]): Uint8Array {
  if (!drop.length) return b;
  const keep: Uint8Array[] = []; let p = 0;
  for (const [s, e] of [...drop].sort((x, y) => x[0] - y[0])) { keep.push(b.subarray(p, s)); p = e; }
  keep.push(b.subarray(p));
  return new Uint8Array(Buffer.concat(keep));
}

// ---------------------------------------------------------------- GLB

type Json = Record<string, unknown>;
const MAX_JSON_NODES = 200_000;
function stripExtras(root: unknown, text: string[]) {
  let fields = 0, nodes = 0;
  const pending: unknown[] = [root];
  while (pending.length) {
    const x = pending.pop();
    if (typeof x === 'number' && !Number.isFinite(x)) no(400, 'upload.invalid', 'Nonfinite glTF value');
    if (!x || typeof x !== 'object') continue;
    if (++nodes > MAX_JSON_NODES) no(413, 'upload.too-complex', 'Too much glTF metadata');
    if (Array.isArray(x)) { for (const v of x) pending.push(v); continue; }
    const o = x as Json;
    if ('extras' in o) { noteText(text, JSON.stringify(o.extras).slice(0, 512)); delete o.extras; fields++; }
    for (const v of Object.values(o)) pending.push(v);
  }
  return fields;
}
const TRI = (mode: number, n: number) => (mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0);

function checkGlb(input: Uint8Array, policy: UploadPolicy, text: string[]) {
  const b = input;
  if (b.length < 20) no(400, 'upload.invalid', 'Not a GLB (too short)');
  if (u32le(b, 4) !== 2) no(400, 'upload.invalid', `GLB version ${u32le(b, 4)}; only glTF 2.0 is accepted`);
  if (u32le(b, 8) !== b.length) no(400, 'upload.invalid', 'GLB length does not match the uploaded bytes');
  let p = 12, json: Json | null = null, jsonText = '', bin: Uint8Array | null = null, chunks = 0;
  while (p < b.length) {
    if (p + 8 > b.length) no(400, 'upload.invalid', 'Truncated GLB chunk header');
    const n = u32le(b, p), type = u32le(b, p + 4);
    if (n % 4 || p + 8 + n > b.length) no(400, 'upload.invalid', 'GLB chunk is misaligned or truncated');
    if (p === 12 && type !== 0x4e4f534a) no(400, 'upload.invalid', 'GLB first chunk must be JSON');
    const data = b.subarray(p + 8, p + 8 + n);
    if (type === 0x4e4f534a) {
      if (json) no(400, 'upload.invalid', 'GLB has duplicate JSON chunks');
      try { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(data); json = JSON.parse(jsonText); } catch { no(400, 'upload.invalid', 'GLB JSON chunk does not parse'); }
      if (!json || typeof json !== 'object' || Array.isArray(json)) no(400, 'upload.invalid', 'GLB JSON chunk must be an object');
    } else if (type === 0x004e4942) {
      if (bin) no(400, 'upload.invalid', 'GLB has duplicate BIN chunks');
      bin = data;
    } else chunks++;  // unknown chunk: dropped as metadata
    p += 8 + n;
  }
  const j = json as Json & { asset?: { version?: unknown }; buffers?: Json[]; bufferViews?: Json[]; images?: Json[]; accessors?: Json[]; meshes?: { primitives?: Json[] }[] };
  if (typeof j.asset?.version !== 'string' || !j.asset.version.startsWith('2')) no(400, 'upload.invalid', 'glTF asset.version must be 2.x');
  const arr = (v: unknown, k: string): Json[] => (v === undefined ? [] : Array.isArray(v) ? v as Json[] : no(400, 'upload.invalid', `${k} must be an array`));
  for (const [i, x] of arr(j.buffers, 'buffers').entries()) if (x && typeof x === 'object' && x.uri !== undefined) no(400, 'upload.external-resource', `buffers.${i} has a URI: a GLB must embed its data`);
  const images = arr(j.images, 'images'), views = arr(j.bufferViews, 'bufferViews'), accessors = arr(j.accessors, 'accessors');
  for (const [i, x] of images.entries()) if (x && typeof x === 'object' && x.uri !== undefined) no(400, 'upload.external-resource', `images.${i} has a URI: embed textures in the GLB`);
  if (images.length > policy.maxTextures) no(413, 'upload.texture-budget', `${images.length} textures exceed ${policy.maxTextures}`);
  let tris = 0;
  for (const [m, mesh] of arr(j.meshes, 'meshes').entries()) for (const [k, prim] of arr((mesh as Json)?.primitives, `meshes.${m}.primitives`).entries()) {
    const attrs = (prim?.attributes ?? {}) as Record<string, unknown>, mode = prim?.mode ?? 4;
    if (!Number.isInteger(mode) || (mode as number) < 0 || (mode as number) > 6) no(400, 'upload.invalid', `meshes.${m}.primitives.${k}.mode is not a glTF mode`);
    const counted = accessors[(prim?.indices ?? attrs.POSITION) as number];
    if (!counted || !Number.isSafeInteger(counted.count) || (counted.count as number) < 0) no(400, 'upload.invalid', `meshes.${m}.primitives.${k} references a missing accessor`);
    tris += TRI(mode as number, counted.count as number);
    if (tris > policy.maxTris) no(413, 'upload.triangle-budget', `More than ${policy.maxTris} triangles`);
  }
  // Embedded images: in bounds, of their declared type, within the texture budget; their metadata blanked.
  const out = bin ? new Uint8Array(bin) : null;
  const seen: UploadImage[] = []; let texPx = 0, segments = 0, bytesBlanked = 0, trimmed = 0;
  for (const [i, im] of images.entries()) {
    const v = views[im.bufferView as number];
    if (!v || !out || v.buffer !== 0) no(400, 'upload.invalid', `images.${i} must reference the GLB BIN chunk`);
    const start = (v!.byteOffset ?? 0) as number, len = v!.byteLength as number;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(len) || start < 0 || len <= 0 || start + len > out!.length) no(400, 'upload.invalid', `images.${i} lies outside the BIN chunk`);
    const view = out!.subarray(start, start + len);
    const r = checkImage(view, typeof im.mimeType === 'string' ? im.mimeType : undefined, policy, text);
    let image = view;
    if (r.kind === 'png' || r.kind === 'jpg') {
      blank(view, r.kind, r.drop, r.trailer); segments += r.drop.length; bytesBlanked += r.drop.reduce((n, [s, e]) => n + e - s, 0);
      // bytes after the image's end marker: blanked above, and left outside the image's view
      if (r.trailer !== undefined) { v!.byteLength = r.trailer; trimmed++; image = view.subarray(0, r.trailer); }
    }
    seen.push({ ...r.image, bytes: image });
    if (r.image.mime === 'image/png') { const d = decoded.get(r.image.bytes); if (d) decoded.set(image, d); }
    texPx = Math.max(texPx, r.image.w, r.image.h);
  }
  const fields = stripExtras(j, text);
  if (!fields && !chunks && !segments) return { bytes: input, tris, textures: images.length, texPx, images: seen, stripped: { fields: 0, chunks: 0, segments: 0, bytes: 0 } };
  const raw = Buffer.from(fields || trimmed ? JSON.stringify(j) : jsonText, 'utf8'), jlen = Math.ceil(raw.length / 4) * 4;
  const blen = out ? Math.ceil(out.length / 4) * 4 : 0, total = 12 + 8 + jlen + (out ? 8 + blen : 0);
  const o = Buffer.alloc(total);
  o.writeUInt32LE(0x46546c67, 0); o.writeUInt32LE(2, 4); o.writeUInt32LE(total, 8);
  o.writeUInt32LE(jlen, 12); o.writeUInt32LE(0x4e4f534a, 16); o.fill(0x20, 20, 20 + jlen); raw.copy(o, 20);
  if (out) { o.writeUInt32LE(blen, 20 + jlen); o.writeUInt32LE(0x004e4942, 24 + jlen); o.set(out, 28 + jlen); }
  const final = new Uint8Array(o.buffer, o.byteOffset, o.byteLength);
  // the images now live in the rebuilt buffer
  const rebased = out ? seen.map((im) => { const off = im.bytes.byteOffset - out.byteOffset; const view = final.subarray(28 + jlen + off, 28 + jlen + off + im.bytes.length); const d = decoded.get(im.bytes); if (d) decoded.set(view, d); return { ...im, bytes: view }; }) : seen;
  return { bytes: final, tris, textures: images.length, texPx, images: rebased, stripped: { fields, chunks, segments, bytes: input.length - total + bytesBlanked } };
}

// ---------------------------------------------------------------- the gate

/**
 * Validate one upload against a policy and strip its metadata. Throws UploadRejected (status, code, message)
 * with a fix the uploader can act on. The returned `bytes` are what the store must keep.
 */
export function validateUpload(input: Uint8Array, policy: UploadPolicy): ValidatedUpload {
  if (!input?.byteLength) no(400, 'upload.empty', 'The upload is empty');
  const kind = sniff(input);
  const allowed = (f: UploadFormat) => policy.formats.includes(f);
  if (kind === 'unknown' || kind === 'webp' || kind === 'ktx2' || !allowed(kind)) no(415, 'upload.format', `Accepted here: ${policy.formats.map((f) => ({ glb: 'GLB (binary glTF 2.0)', png: 'PNG', jpg: 'JPEG', json: 'footprint JSON' })[f]).join(', ')}`);
  const inputSha = sha256(input), text: string[] = [];
  if (kind === 'json') {
    if (input.length > FOOTPRINT_MAX_BYTES) no(413, 'upload.size', `Footprint ${input.length} bytes exceeds ${FOOTPRINT_MAX_BYTES}`);
    try { const v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input)); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; } catch { no(400, 'upload.invalid', 'Footprint must be a JSON object'); }
    return { format: 'json', bytes: input, sha: inputSha, inputSha, tris: 0, textures: 0, texPx: 0, stripped: { fields: 0, chunks: 0, segments: 0, bytes: 0 }, text, images: [] };
  }
  if (input.length > policy.maxBytes) no(413, 'upload.size', `${input.length} bytes exceed ${policy.maxBytes}`);
  if (kind === 'glb') {
    const r = checkGlb(input, policy, text);
    return { format: 'glb', bytes: r.bytes, sha: r.bytes === input ? inputSha : sha256(r.bytes), inputSha, tris: r.tris, textures: r.textures, texPx: r.texPx, stripped: r.stripped, text, images: r.images };
  }
  const r = checkImage(input, undefined, { ...policy, maxImageBytes: policy.maxBytes }, text);
  const bytes = cut(input, r.drop);
  if (bytes !== input && r.image.mime === 'image/png') { const d = decoded.get(input); if (d) decoded.set(bytes, d); }
  return { format: kind as 'png' | 'jpg', bytes, sha: bytes === input ? inputSha : sha256(bytes), inputSha, tris: 0, textures: 1, texPx: Math.max(r.image.w, r.image.h), stripped: { fields: 0, chunks: 0, segments: r.drop.length, bytes: input.length - bytes.length }, text, images: [{ ...r.image, bytes }] };
}
