// Asset store, mesh-def physics from footprints, and the def catalog (spec <eden4>/29 WP1a/WP1b,
// 28 §10, 33 §2 row 1). Owner: L5.
//
// - Files are content-addressed and shared by every world on the box: `$ASSET_DIR/<sha256>.<ext>`
//   (default `<DATA_DIR>/../assets`), each with a `<sha>.meta.json` sidecar so any world can look an
//   asset up without its own row. Core assets (the CC0 packs split per model, the Little Martians
//   buildings and kin) are read-only repo files listed in `worlds/core-assets/index.json`.
// - Per-world provenance lives in `world_assets_v1` (who uploaded what, licence, source).
// - Budgets are enforced at ingest (world constants `limits.budget`): a GLB over the triangle, byte
//   or texture limit is refused, so no browser ever meets an oversized thing.
// - GLBs are measured from the container itself (JSON chunk: accessor counts and min/max through the
//   node hierarchy, embedded image headers), so Draco/meshopt/WebP files measure without decoders;
//   uncompressed files are additionally parsed by @gltf-transform/core as a validity check.
// - A footprint sidecar (`lm-building-footprint/1`) becomes Baked physics (rooms, wall colliders,
//   surfaces, openings, links, room slots) attached to the asset's lookup.
// - Catalog: `GET /v1/god/defs?q=` ranks name > tags > description with synonyms and plurals;
//   `GET /v1/god/defs/<ref>` returns the full def plus an example op; thumbnails per def hash.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context, Hono } from 'hono';
import type { Baked, Vec2, Vec3 } from '@souls/generators';
import type { AssetInfo, AssetLookup, StoredDef } from '@souls/world-compiler';
import { nearHash, vocab } from '@souls/world-compiler';
import { CREATION_LIMITS as L, assertFootprint, footprintToBaked, type LmFootprint } from '@souls/generators';
import { assetBytesOf, mountCatalogRoutes } from './catalog.ts';
import { WireCache, acceptsBrotli, readRenditions } from './asset-wire.ts';
import type { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import type { GodMode } from './god.ts';
import { FOOTPRINT_BYTES, godBodyLimit } from './ingestion.ts';
import { godTokenLimiter } from './rate-limit.ts';
import { intakeUpload, recordIntake } from '../moderation/intake.ts';
import { moderationFor } from '../moderation/store.ts';
import { assetPolicy, UploadRejected, validateUpload } from '../moderation/validate.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const CORE_ASSET_INDEX = join(REPO_ROOT, 'worlds/core-assets/index.json');

/** Physics a footprint contributes to a mesh def (everything but tris). */
export type FootprintBaked = Pick<Baked, 'box' | 'colliders' | 'slots'> & Pick<Baked, 'surfaces' | 'openings' | 'links' | 'rooms' | 'notes'>;
/** What the compiler's AssetLookup sees, plus the store's own facts. `baked` is set for footprints (and for a GLB uploaded with one). */
export type AssetMeta = AssetInfo & {
  sha: string; ext: 'glb' | 'png' | 'jpg' | 'json'; kind: 'mesh' | 'image' | 'footprint';
  texPx: number; min?: Vec3; animations?: string[]; nodes?: string[]; extensions?: string[];
  name?: string; license?: string; source?: string; at?: number;
  /** For a GLB: the sha of its footprint sidecar. For a footprint: its derived physics. */
  footprint?: string; baked?: FootprintBaked;
  /** Core assets: repo-relative path of the file. */
  path?: string;
};
export type Budget = { tris: number; bytes: number; texPx: number };
export const DEFAULT_BUDGET: Budget = { tris: L.defTris, bytes: L.assetBytes, texPx: L.texturePx };

const SHA = /^[0-9a-f]{64}$/;
const EXT_TYPES: Record<AssetMeta['ext'], string> = { glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg', json: 'application/json' };
/** Required glTF extensions the viewer's loader can decode (Draco, meshopt, WebP are configured in LiveWorld/mesh.mesh.ts). */
const DECODABLE = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization', 'KHR_texture_transform', 'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_texture_basisu']);

const refuse = (status: number, code: string, message: string, extra?: Record<string, unknown>) => new ApiError(status, code, message, extra);

// ---------------------------------------------------------------- measuring

type GltfJson = {
  asset?: { version?: string }; scene?: number; scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; skin?: number }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { count: number; min?: number[]; max?: number[]; componentType: number; normalized?: boolean; bufferView?: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number } } }[];
  buffers?: { byteLength: number; uri?: string; extensions?: { EXT_meshopt_compression?: { fallback?: boolean } } }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
  textures?: unknown[]; materials?: unknown[]; animations?: { name?: string }[]; skins?: unknown[];
  extensionsUsed?: string[]; extensionsRequired?: string[];
};
export type GlbMeasure = { tris: number; bytes: number; textures: number; texPx: number; box: Vec3; min: Vec3; max: Vec3; animations: string[]; nodes: string[]; extensions: string[]; meshes: number; skins: number };

/** Parse a GLB container into its JSON and BIN chunks. Throws a readable error for anything else. */
export function parseGlb(buf: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  if (buf.byteLength < 20) throw new Error('not a GLB (too short)');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (magic is not "glTF"); upload binary glTF (.glb)');
  if (dv.getUint32(4, true) !== 2) throw new Error(`GLB version ${dv.getUint32(4, true)}; only glTF 2.0 is accepted`);
  const total = dv.getUint32(8, true);
  if (total !== buf.byteLength) throw new Error(total > buf.byteLength ? 'GLB truncated' : 'GLB length does not match the uploaded bytes');
  let off = 12, json: GltfJson | null = null, bin: Uint8Array | null = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (len % 4 || off + 8 + len > total) throw new Error('GLB chunk is misaligned or truncated');
    if (off === 12 && type !== 0x4e4f534a) throw new Error('GLB first chunk must be JSON');
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) { if (json) throw new Error('GLB has duplicate JSON chunks'); json = JSON.parse(new TextDecoder().decode(chunk)); }
    else if (type === 0x004e4942) { if (bin) throw new Error('GLB has duplicate BIN chunks'); bin = chunk; }
    off += 8 + len;
  }
  if (off !== total) throw new Error('GLB has an incomplete chunk header');
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('GLB JSON chunk must be an object');
  // Also check compressed containers: the server carries no Draco/meshopt decoder,
  // but their buffer references must still point inside the uploaded BIN chunk.
  const whole = (n: number) => Number.isSafeInteger(n) && n >= 0;
  for (const [i, b] of (json.buffers ?? []).entries()) {
    // meshopt may declare a virtual uncompressed fallback buffer; its actual
    // compressed bytes are checked through each bufferView extension below.
    const fallback = b.extensions?.EXT_meshopt_compression?.fallback && json.extensionsRequired?.includes('EXT_meshopt_compression');
    if (!whole(b.byteLength) || (!b.uri && !fallback && (i !== 0 || b.byteLength > (bin?.byteLength ?? 0)))) throw new Error(`buffers.${i}.byteLength exceeds the GLB BIN chunk`);
  }
  for (const [i, v] of (json.bufferViews ?? []).entries()) {
    const b = json.buffers?.[v.buffer], offset = v.byteOffset ?? 0;
    if (!b || !whole(offset) || !whole(v.byteLength) || offset + v.byteLength > b.byteLength) throw new Error(`bufferViews.${i} is outside its buffer`);
    const compressed = v.extensions?.EXT_meshopt_compression;
    if (compressed) {
      const source = json.buffers?.[compressed.buffer], start = compressed.byteOffset ?? 0;
      if (!source || source.extensions?.EXT_meshopt_compression?.fallback || !whole(start) || !whole(compressed.byteLength) || start + compressed.byteLength > source.byteLength) throw new Error(`bufferViews.${i}.extensions.EXT_meshopt_compression is outside its buffer`);
    }
  }
  for (const [i, a] of (json.accessors ?? []).entries()) {
    if (!whole(a.count) || (a.bufferView !== undefined && !json.bufferViews?.[a.bufferView])) throw new Error(`accessors.${i} has an invalid count or bufferView`);
    if ((a.min && !a.min.every(Number.isFinite)) || (a.max && !a.max.every(Number.isFinite))) throw new Error(`accessors.${i} has invalid bounds`);
  }
  return { json, bin };
}

type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): M4 {
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
}
const apply = (m: M4, p: number[]) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const NORM: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/** Image dimensions from PNG/JPEG/WebP headers (0 when unknown). */
export function imageSize(b: Uint8Array): { w: number; h: number; type: string } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: dv.getUint32(16), h: dv.getUint32(20), type: 'png' };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1], len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5), type: 'jpg' };
      i += 2 + len;
    }
    return { w: 0, h: 0, type: 'jpg' };
  }
  if (b.length > 30 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') {
    const fmt = String.fromCharCode(...b.subarray(12, 16));
    if (fmt === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff, type: 'webp' };
    if (fmt === 'VP8L') { const v = dv.getUint32(21, true); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, type: 'webp' }; }
    if (fmt === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: 'webp' };
    return { w: 0, h: 0, type: 'webp' };
  }
  return { w: 0, h: 0, type: 'unknown' };
}

/** Measure a GLB: triangles, bytes, textures (count and largest side), bounds through the node hierarchy, clips, root names. */
export function measureGlb(buf: Uint8Array): GlbMeasure {
  const { json, bin } = parseGlb(buf);
  if (!json.asset?.version?.startsWith('2')) throw new Error('glTF asset.version must be 2.x');
  for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith('data:')) throw new Error(`external buffer ${b.uri}: the GLB must be self-contained`);
  for (const im of json.images ?? []) if (im.uri && !im.uri.startsWith('data:')) throw new Error(`external image ${im.uri}: embed textures in the GLB`);
  const missing = (json.extensionsRequired ?? []).filter((e) => !DECODABLE.has(e));
  if (missing.length) throw new Error(`required extension(s) the viewer cannot decode: ${missing.join(', ')}`);
  const acc = json.accessors ?? [];
  let tris = 0;
  for (const [mesh, m] of (json.meshes ?? []).entries()) for (const [primitive, p] of m.primitives.entries()) {
    const field = `meshes.${mesh}.primitives.${primitive}`;
    const position = acc[p.attributes?.POSITION];
    if (!position || position.min?.length !== 3 || position.max?.length !== 3 || position.min.some((v, i) => v > position.max![i])) throw new Error(`${field}.attributes.POSITION needs a valid accessor with 3D min/max bounds`);
    if (Object.values(p.attributes).some(i => !Number.isSafeInteger(i) || !acc[i]) || (p.indices !== undefined && (!Number.isSafeInteger(p.indices) || !acc[p.indices]))) throw new Error(`${field} references an unknown accessor`);
    const mode = p.mode ?? 4, n = p.indices !== undefined ? acc[p.indices]?.count ?? 0 : acc[p.attributes.POSITION]?.count ?? 0;
    if (!Number.isInteger(mode) || mode < 0 || mode > 6) throw new Error(`${field}.mode must be a glTF primitive mode (0–6)`);
    tris += mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const nodes = json.nodes ?? [], views = json.bufferViews ?? [];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => n.children?.includes(i)));
  // world matrices of every node in the scene (rest pose)
  const world = new Map<number, M4>();
  const walk = (i: number, parent: M4, depth: number) => { const n = nodes[i]; if (!n || depth > 64 || world.has(i)) return; const m = mul(parent, n.matrix ?? trs(n.translation, n.rotation, n.scale)); world.set(i, m); for (const c of n.children ?? []) walk(c, m, depth + 1); };
  for (const r of roots) walk(r, I4, 0);
  /** A skinned mesh in bind pose is drawn by its skeleton: joint world × inverse bind (the same for every joint at rest). */
  const skinMatrix = (skinIndex: number): M4 | null => {
    const sk = (json.skins as { joints: number[]; inverseBindMatrices?: number }[] | undefined)?.[skinIndex];
    if (!sk?.joints?.length) return null;
    const jw = world.get(sk.joints[0]); if (!jw) return null;
    if (sk.inverseBindMatrices === undefined || !bin) return jw;
    const a = acc[sk.inverseBindMatrices], v = a?.bufferView !== undefined ? views[a.bufferView] : undefined; if (!v) return jw;
    const off = (v.byteOffset ?? 0) + ((a as { byteOffset?: number }).byteOffset ?? 0);
    // #760: in a meshopt-compressed file the matrices sit in a compressed view (or the virtual fallback buffer), not in
    // the BIN chunk at this offset; at rest the joint's world matrix stands in, as it does for a skin without matrices.
    if (v.extensions?.EXT_meshopt_compression || json.buffers?.[v.buffer]?.extensions?.EXT_meshopt_compression?.fallback || off + 64 > bin.byteLength) return jw;
    const dv2 = new DataView(bin.buffer, bin.byteOffset + off, 64);
    const ib = Array.from({ length: 16 }, (_, k) => dv2.getFloat32(k * 4, true));
    return mul(jw, ib);
  };
  for (const [i, m] of world) {
    const n = nodes[i]; if (n.mesh === undefined) continue;
    const mm = (n.skin !== undefined ? skinMatrix(n.skin) : null) ?? m;
    for (const p of json.meshes?.[n.mesh]?.primitives ?? []) {
      const a = acc[p.attributes.POSITION]; if (!a?.min || !a.max) continue;
      const k = a.normalized ? NORM[a.componentType] ?? 1 : 1, mn = a.min.map((v) => v / k), mx = a.max.map((v) => v / k);
      for (let c = 0; c < 8; c++) { const q = apply(mm, [c & 1 ? mx[0] : mn[0], c & 2 ? mx[1] : mn[1], c & 4 ? mx[2] : mn[2]]); for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], q[j]); hi[j] = Math.max(hi[j], q[j]); } }
    }
  }
  if (![...lo, ...hi].every(Number.isFinite) || lo.some((v, i) => v > hi[i])) throw new Error('GLB has no measurable geometry (no finite POSITION min/max)');
  let texPx = 0;
  for (const im of json.images ?? []) {
    let bytes: Uint8Array | null = null;
    if (im.bufferView !== undefined && bin) { const v = views[im.bufferView]; bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + Math.min(v.byteLength, 4096)); }
    else if (im.uri?.startsWith('data:')) bytes = Uint8Array.from(Buffer.from(im.uri.slice(im.uri.indexOf(',') + 1, im.uri.indexOf(',') + 1 + 8192), 'base64'));
    if (bytes) { const s = imageSize(bytes); texPx = Math.max(texPx, s.w, s.h); }
  }
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const min = lo.map(r3) as Vec3, max = hi.map(r3) as Vec3;
  return {
    tris: Math.round(tris), bytes: buf.byteLength, textures: (json.images ?? []).length, texPx,
    box: [r3(hi[0] - lo[0]), r3(hi[1] - lo[1]), r3(hi[2] - lo[2])], min, max,
    animations: (json.animations ?? []).map((a, i) => a.name ?? `clip-${i}`),
    nodes: roots.map((r) => nodes[r]?.name ?? `node-${r}`),
    extensions: json.extensionsUsed ?? [], meshes: (json.meshes ?? []).length, skins: (json.skins ?? []).length,
  };
}

/** Full parse when no unavailable geometry/texture decoder is needed. Compressed
 * files still receive parseGlb's container/reference checks and measurement. */
export async function validateGlb(buf: Uint8Array, json?: GltfJson): Promise<string | null> {
  try {
    const req = (json ?? parseGlb(buf).json).extensionsRequired ?? [];
    const { WebIO } = await import('@gltf-transform/core');
    const io = new WebIO(), document = await io.binaryToJSON(buf);
    if (req.some(e => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_texture_basisu'].includes(e))) return null;
    // These viewer-supported extensions do not need a decoder to validate core
    // geometry. They must not skip the whole parse just for being required.
    document.json.extensionsRequired = req.filter(e => !DECODABLE.has(e));
    await io.readJSON(document);
    return null;
  } catch (e) { return String((e as Error).message ?? e); }
}

// ---------------------------------------------------------------- footprints

// XP5: the pure converter is shared with kit/2; asset imports retain this public export.
export { footprintToBaked } from '@souls/generators';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The same footprint at `k` times the size (an import that states a different height than the model's own). */
export function scaleFootprint(fp: LmFootprint, k: number): LmFootprint {
  assertFootprint(fp);
  if (!(Number.isFinite(k) && k > 0)) throw new Error('footprint scale must be positive and finite');
  if (k === 1) return fp;
  const v = (a: number[]) => a.map((x) => r4(x * k));
  const scaled = {
    ...fp,
    bounds: fp.bounds && { min: v(fp.bounds.min) as Vec3, max: v(fp.bounds.max) as Vec3 },
    levels: fp.levels?.map((l) => ({ ...l, y: r4(l.y * k) })),
    rooms: fp.rooms?.map((r) => ({ ...r, y0: r4(r.y0 * k), y1: r4(r.y1 * k), polygon: r.polygon.map((p) => v(p) as Vec2), ...(r.clearHeight !== undefined ? { clearHeight: r4(r.clearHeight * k) } : {}) })),
    terraces: fp.terraces?.map((t) => ({ ...t, y: r4(t.y * k), polygon: t.polygon.map((p) => v(p) as Vec2), hole: t.hole?.map((p) => v(p) as Vec2) })),
    obstacles: fp.obstacles?.map((o) => ({ ...o, obb: { ...o.obb, c: v(o.obb.c) as Vec2, half: v(o.obb.half) as Vec2 }, y0: r4(o.y0 * k), y1: r4(o.y1 * k) })),
    portals: fp.portals?.map((p) => ({ ...p, center: v(p.center) as Vec3, y0: r4(p.y0 * k), y1: r4(p.y1 * k), ...(p.width !== undefined ? { width: r4(p.width * k) } : {}), ...(p.diameter !== undefined ? { diameter: r4(p.diameter * k) } : {}) })),
    links: fp.links?.map((l) => ({ ...l, width: r4(l.width * k), from: { ...l.from, y: r4(l.from.y * k) }, to: { ...l.to, y: r4(l.to.y * k) }, path: l.path.map((p) => v(p) as Vec3) })),
  };
  assertFootprint(scaled);
  return scaled;
}

// ---------------------------------------------------------------- the store

type CoreIndex = { schema: 'core-assets/1'; assets: Record<string, AssetMeta> };

type AssetOptions = { name?: string; license?: string; source?: string; by?: string; budget?: Budget; footprint?: Uint8Array | object | null; kind?: 'footprint' };

/** Pure admission: no file, cache or provenance writes. Routes also run the
 * asynchronous GLB parser before passing admitted bytes to the store. */
export function inspectAsset(bytes: Uint8Array, opts: Pick<AssetOptions, 'budget' | 'kind'> = {}): AssetMeta {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const footprint = opts.kind === 'footprint' || bytes[0] === 0x7b;
  const maxBytes = footprint ? FOOTPRINT_BYTES : budget.bytes;
  if (bytes.byteLength > maxBytes) throw refuse(413, 'asset.budget', `${footprint ? 'footprint' : 'asset'} ${bytes.byteLength} bytes > ${maxBytes}`, { field: 'bytes', measured: { bytes: bytes.byteLength }, allowed: { bytes: maxBytes } });
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (footprint) {
    let baked: FootprintBaked;
    try { baked = footprintToBaked(JSON.parse(new TextDecoder().decode(bytes))); }
    catch (e) { throw refuse(400, 'asset.invalid', `invalid footprint: ${(e as Error).message}`, { field: 'footprint', measured: { problem: (e as Error).message }, allowed: { schema: 'lm-building-footprint/1', bytes: FOOTPRINT_BYTES }, fix: 'Provide a valid footprint with finite bounds and room polygons of at least 3 points.' }); }
    return { sha, ext: 'json', kind: 'footprint', tris: 0, bytes: bytes.byteLength, textures: 0, texPx: 0, box: baked.box, baked };
  }
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'glTF') {
    let m: GlbMeasure;
    try { m = measureGlb(bytes); }
    catch (e) { throw refuse(400, 'asset.invalid', (e as Error).message, { field: 'file', measured: { problem: (e as Error).message, bytes: bytes.byteLength }, allowed: { format: 'self-contained GLB 2.0' }, fix: 'Export a valid self-contained binary glTF 2.0 file.' }); }
    if (m.tris > budget.tris) throw refuse(413, 'asset.budget', `${m.tris} triangles > ${budget.tris} (simplify the mesh, e.g. gltf-transform simplify)`, { field: 'tris', measured: m, allowed: budget });
    if (m.texPx > budget.texPx) throw refuse(413, 'asset.budget', `a ${m.texPx} px texture > ${budget.texPx} px (resize textures)`, { field: 'texPx', measured: m, allowed: budget });
    return { sha, ext: 'glb', kind: 'mesh', tris: m.tris, bytes: m.bytes, textures: m.textures, texPx: m.texPx, box: m.box, min: m.min, animations: m.animations, nodes: m.nodes, extensions: m.extensions };
  }
  const s = imageSize(bytes);
  if (s.type !== 'png' && s.type !== 'jpg') throw refuse(415, 'asset.type', 'accepted: GLB (binary glTF 2.0), PNG, JPEG, footprint JSON (lm-building-footprint/1)', { measured: { bytes: bytes.byteLength }, allowed: { formats: ['glb', 'png', 'jpg', 'lm-building-footprint/1'] } });
  if (!(s.w > 0 && s.h > 0)) throw refuse(400, 'asset.invalid', 'image has no valid dimensions', { measured: s, allowed: { width: '> 0', height: '> 0' } });
  if (bytes.byteLength > Math.min(budget.bytes, L.imageBytes)) throw refuse(413, 'asset.budget', `image ${bytes.byteLength} bytes > ${Math.min(budget.bytes, L.imageBytes)}`, { field: 'bytes', measured: { bytes: bytes.byteLength }, allowed: { bytes: Math.min(budget.bytes, L.imageBytes) } });
  if (Math.max(s.w, s.h) > budget.texPx) throw refuse(413, 'asset.budget', `image ${s.w}×${s.h} > ${budget.texPx} px`, { field: 'texPx', measured: { texPx: Math.max(s.w, s.h) }, allowed: { texPx: budget.texPx } });
  return { sha, ext: s.type, kind: 'image', tris: 0, bytes: bytes.byteLength, textures: 1, texPx: Math.max(s.w, s.h), box: [s.w, s.h, 0] };
}

export class AssetStore {
  readonly dir: string;
  private cache = new Map<string, AssetMeta>();
  private core: Record<string, AssetMeta> = {};
  private readonly db?: Db; private readonly worldId?: string;
  private readonly renditionIndex: string;
  constructor(opts: { dir: string; db?: Db; worldId?: string; coreIndex?: string | null; renditionIndex?: string }) {
    this.dir = resolve(opts.dir); this.db = opts.db; this.worldId = opts.worldId; this.renditionIndex = opts.renditionIndex ?? join(dirname(CORE_ASSET_INDEX), 'renditions.json');
    const idx = opts.coreIndex === undefined ? CORE_ASSET_INDEX : opts.coreIndex;
    if (idx && existsSync(idx)) { try { this.core = (JSON.parse(readFileSync(idx, 'utf8')) as CoreIndex).assets ?? {}; } catch { this.core = {}; } }
    // lane LM: template asset sets beside the core index (`<name>.index.json`, same schema) resolve on any box too
    if (opts.coreIndex === undefined && existsSync(dirname(CORE_ASSET_INDEX))) for (const f of readdirSync(dirname(CORE_ASSET_INDEX)).filter((n) => n.endsWith('.index.json')).sort()) {
      try { this.core = { ...(JSON.parse(readFileSync(join(dirname(CORE_ASSET_INDEX), f), 'utf8')) as CoreIndex).assets, ...this.core }; } catch { /* a broken extra index is skipped */ }
    }
    if (this.db) this.db.db.exec(`CREATE TABLE IF NOT EXISTS world_assets_v1 (world_id TEXT NOT NULL, sha TEXT NOT NULL, kind TEXT NOT NULL, ext TEXT NOT NULL, bytes INTEGER NOT NULL, tris INTEGER NOT NULL, textures INTEGER NOT NULL, box TEXT NOT NULL, name TEXT, license TEXT, source TEXT, by TEXT, at INTEGER NOT NULL, PRIMARY KEY (world_id, sha)) WITHOUT ROWID`);
  }

  /** The compiler's view: tris/bytes/textures/box (+ footprint physics) by sha. */
  readonly lookup: AssetLookup = (sha: string) => {
    const m = this.info(sha); if (!m) return undefined;
    const fp = m.kind === 'footprint' ? m : m.footprint ? this.info(m.footprint) : undefined;
    const image = m.kind === 'image' && (m.ext === 'png' || m.ext === 'jpg') && this.file(sha, m.ext)
      && (this.core[sha] || !this.db || !this.worldId || this.db.db.prepare('SELECT 1 FROM world_assets_v1 WHERE world_id=? AND sha=?').get(this.worldId, sha));
    return { tris: m.tris, bytes: m.bytes, textures: m.textures, box: m.box, ...(image ? { image: { ext: m.ext as 'png' | 'jpg' } } : {}), ...(fp?.baked ? { baked: fp.baked } : {}) } as AssetInfo;
  };
  info(sha: string): AssetMeta | undefined {
    if (!SHA.test(sha)) return undefined;
    const hit = this.cache.get(sha) ?? this.core[sha];
    if (hit) return { ...hit, sha };
    const metaFile = join(this.dir, `${sha}.meta.json`);
    if (!existsSync(metaFile)) return undefined;
    try { const m = JSON.parse(readFileSync(metaFile, 'utf8')) as AssetMeta; this.cache.set(sha, m); return { ...m, sha }; } catch { return undefined; }
  }
  /** Absolute file path for a sha (store or core), or null. */
  file(sha: string, ext?: string): string | null {
    const m = this.info(sha); if (!m || (ext && m.ext !== ext)) return null;
    const p = m.path ? join(REPO_ROOT, m.path) : join(this.dir, `${sha}.${m.ext}`);
    return existsSync(p) ? p : null;
  }
  private renditions: ReturnType<typeof readRenditions> | null = null;
  /** Core source identities can acquire a different viewer rendition in a later release. */
  isCore(sha: string): boolean { return Object.hasOwn(this.core, sha); }
  /** W3b: the smaller encoding of a core mesh the viewer gets instead (worlds/core-assets/renditions.json), or null. */
  rendition(sha: string) { if (!this.core[sha]) return null; this.renditions ??= readRenditions(this.renditionIndex, REPO_ROOT); return this.renditions.get(sha) ?? null; }
  coreAssets(): AssetMeta[] { return Object.entries(this.core).map(([sha, m]) => ({ ...m, sha })); }

  /**
   * Ingest bytes: sniff the type, measure, enforce the budget, write `<sha>.<ext>` + meta, record provenance.
   * `footprint` (JSON bytes or object) is ingested first and linked to a GLB.
   */
  put(bytes: Uint8Array, opts: AssetOptions = {}): AssetMeta {
    let meta = inspectAsset(bytes, opts);
    const sha = meta.sha;
    const fpBytes = opts.footprint && meta.kind === 'mesh' ? opts.footprint instanceof Uint8Array ? opts.footprint : new TextEncoder().encode(JSON.stringify(opts.footprint)) : undefined;
    this.checkWorldBudget([meta, ...(fpBytes ? [inspectAsset(fpBytes, { ...opts, kind: 'footprint' })] : [])]);
    if (opts.footprint && meta.kind === 'mesh') {
      const fp = this.put(fpBytes!, { ...opts, footprint: null, kind: 'footprint', name: opts.name ? `${opts.name}-footprint` : undefined });
      meta.footprint = fp.sha;
    }
    const prior = this.info(sha);
    meta = { ...meta, name: opts.name ?? prior?.name, license: opts.license ?? prior?.license, source: opts.source ?? prior?.source, at: prior?.at ?? Date.now(), ...(meta.footprint ?? prior?.footprint ? { footprint: meta.footprint ?? prior?.footprint } : {}) };
    if (!prior?.path) {
      mkdirSync(this.dir, { recursive: true });
      const file = join(this.dir, `${sha}.${meta.ext}`);
      if (!existsSync(file)) { writeFileSync(file + '.tmp', bytes); renameSync(file + '.tmp', file); }
      const { sha: _s, ...stored } = meta;
      writeFileSync(join(this.dir, `${sha}.meta.json`), JSON.stringify(stored));
      this.cache.set(sha, stored as AssetMeta);
    }
    if (this.db && this.worldId) this.db.db.prepare('INSERT INTO world_assets_v1 (world_id, sha, kind, ext, bytes, tris, textures, box, name, license, source, by, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(world_id, sha) DO UPDATE SET name=coalesce(excluded.name, name), license=coalesce(excluded.license, license), source=coalesce(excluded.source, source)')
      .run(this.worldId, sha, meta.kind, meta.ext, meta.bytes, meta.tris, meta.textures, JSON.stringify(meta.box), meta.name ?? null, meta.license ?? null, meta.source ?? null, opts.by ?? null, meta.at ?? Date.now());
    return { ...meta, sha };
  }
  /** Check the entire upload (including sidecars) before any file or provenance write. */
  checkWorldBudget(incoming: Pick<AssetMeta, 'sha' | 'bytes'>[]): void {
    if (!this.db || !this.worldId) return;
    const rows = this.db.db.prepare('SELECT sha,bytes FROM world_assets_v1 WHERE world_id=?').all(this.worldId) as { sha: string; bytes: number }[];
    const sizes = new Map(rows.map(r => [r.sha, r.bytes]));
    for (const m of incoming) sizes.set(m.sha, m.bytes);
    const bytes = [...sizes.values()].reduce((a, b) => a + b, 0);
    for (const [field, measured, limit] of [['assets', sizes.size, L.worldAssets], ['assetBytes', bytes, L.worldAssetBytes]] as const) {
      if (measured > limit && measured > (field === 'assets' ? rows.length : rows.reduce((n, r) => n + r.bytes, 0)))
        throw refuse(413, 'budget.world', `${field}: ${measured} > ${limit}`, { field, measured, limit, fix: 'Reuse an existing uploaded asset or reduce the upload; this world has reached its asset budget.' });
    }
  }
  /** Assets this world uploaded (newest first). */
  listWorld(limit = 100): AssetMeta[] {
    if (!this.db || !this.worldId) return [];
    const rows = this.db.db.prepare('SELECT sha FROM world_assets_v1 WHERE world_id=? ORDER BY at DESC LIMIT ?').all(this.worldId, limit) as { sha: string }[];
    return rows.map((r) => this.info(r.sha)).filter((m): m is AssetMeta => !!m);
  }

  // ---- thumbnails (keyed by def hash; shared across worlds like the defs themselves)
  thumbFile(defHash: string): string | null {
    if (!/^[0-9a-f]{16,64}$/.test(defHash)) return null;
    for (const p of [join(this.dir, 'thumbs', `${defHash}.png`), join(REPO_ROOT, 'worlds/core-assets/thumbs', `${defHash}.png`)]) if (existsSync(p)) return p;
    return null;
  }
  /** A def's thumbnail and the hash it is filed under: its own, else (a mesh given a distant version) the one rendered
   *  under its hash before lod1 was attached, since the near model it pictures is unchanged. */
  thumbOf(def: Omit<StoredDef, 'by'> & { by?: string }): { file: string; hash: string } | null {
    for (const hash of [def.hash, nearHash(def)]) { const file = hash ? this.thumbFile(hash) : null; if (file) return { file, hash: hash! }; }
    return null;
  }
  putThumb(defHash: string, png: Uint8Array) {
    const s = imageSize(png);
    if (s.type !== 'png') throw refuse(415, 'asset.type', 'thumbnails are PNG');
    if (s.w > L.thumbnailPx || s.h > L.thumbnailPx || png.byteLength > L.thumbnailBytes) throw refuse(413, 'asset.budget', `thumbnail ≤ ${L.thumbnailPx} px and ≤ ${L.thumbnailBytes} bytes`);
    mkdirSync(join(this.dir, 'thumbs'), { recursive: true });
    const f = join(this.dir, 'thumbs', `${defHash}.png`); writeFileSync(f + '.tmp', png); renameSync(f + '.tmp', f);
  }
}

/** The default asset directory: `$ASSET_DIR`, else `<DATA_DIR>/../assets` (shared by every world on the box). */
export function defaultAssetDir(env = process.env) { return resolve(env.ASSET_DIR ?? join(resolve(env.DATA_DIR ?? './data'), '..', 'assets')); }

// ---------------------------------------------------------------- catalog search

/** Words a god (or a person) uses for a thing → the names the library uses. Both directions are tried. */
export const SYNONYMS: Record<string, string[]> = {
  pup: ['dog', 'puppy'], puppy: ['dog'], doggy: ['dog'], doggo: ['dog'], hound: ['dog'], kitty: ['cat'], kitten: ['cat'], kitteh: ['cat'],
  hen: ['chicken'], rooster: ['chicken'], chick: ['chicken'], cockerel: ['chicken'], duckling: ['duck'], drake: ['duck'], mallard: ['duck'],
  gander: ['goose'], geese: ['goose'], lamb: ['sheep'], ewe: ['sheep'], ram: ['sheep'], calf: ['cow'], cattle: ['cow'], bull: ['cow'], ox: ['cow'],
  pony: ['horse'], foal: ['horse'], mare: ['horse'], stallion: ['horse'], piglet: ['pig'], hog: ['pig'], swine: ['pig'], bunny: ['rabbit'], hare: ['rabbit'],
  kid: ['goat'], fawn: ['deer'], doe: ['deer'], stag: ['deer'], alpaca: ['llama'], fish: ['koi', 'fish'], carp: ['koi'], goldfish: ['koi'],
  gull: ['seagull'], songbird: ['bird'], sparrow: ['bird'], robin: ['bird'], raven: ['crow'], duck: ['duck', 'waterfowl'], waterfowl: ['duck', 'goose'],
  boat: ['rowing-boat', 'rowboat'], rowboat: ['rowing-boat', 'rowboat'], 'rowing-boat': ['rowboat'], kayak: ['canoe'],
  ship: ['boat', 'sailboat'], bike: ['bicycle'], cycle: ['bicycle'], car: ['car', 'cart'], wagon: ['cart', 'wagon'],
  lighthouse: ['lighthouse', 'tower', 'beacon'], beacon: ['lighthouse', 'tower'], tower: ['tower', 'minaret'], minaret: ['tower', 'temple'], temple: ['temple', 'shrine'], church: ['chapel', 'temple'],
  house: ['house', 'cottage', 'building', 'home'], home: ['house', 'cottage'], hut: ['cottage', 'shed'], cabin: ['cottage'], barn: ['barn', 'shed'],
  shrub: ['bush'], bush: ['bush', 'shrub', 'plant'], boulder: ['rock'], stone: ['rock', 'stone'], pebble: ['rock'], log: ['log', 'woodlog'], stump: ['treestump', 'stump'],
  sofa: ['sofa', 'couch'], couch: ['sofa'], seat: ['chair', 'bench', 'seat'], stool: ['stool', 'chair'], lamp: ['lamp', 'light'], light: ['lamp', 'light'], streetlight: ['lamp-post'],
  rug: ['carpet'], carpet: ['carpet', 'rug'], mushroom: ['mushroom', 'toadstool'], toadstool: ['mushroom'], flower: ['flowers', 'flower'], flowers: ['flower'],
  veg: ['crop', 'vegetable'], vegetable: ['crop'], crop: ['crop'], tomato: ['tomato'], pumpkin: ['pumpkin'], corn: ['corn', 'maize'], maize: ['corn'],
  mug: ['cup'], teacup: ['cup', 'tea'], coffee: ['cup', 'coffee'], bread: ['loaf', 'bread'], loaf: ['loaf', 'bread'], dish: ['plate', 'bowl'], plate: ['plate'],
  head: ['kin', 'head', 'floater'], ceramic: ['ceramic', 'kin'], martian: ['kin', 'littlemartians'], statue: ['sculpture', 'statue', 'kin'],
  well: ['well'], pond: ['pond', 'lake'], lake: ['lake', 'pond'], hill: ['hill', 'knoll'], tree: ['tree'], oak: ['tree', 'commontree'], birch: ['birchtree', 'birch'], willow: ['willow'],
};
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && /(ches|shes|xes|ses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

type Searchable = { name: string; ref: string; description?: string; tags?: string[]; hash?: string; make?: { kind: string; gen?: string }; synonyms?: string[]; category?: string };
export type SearchHit<T> = { def: T; score: number; why: string[] };

/**
 * Rank defs for a query. The whole query as the def's name, or as one of its phrase synonyms, 100. Per query
 * word (and its singular and synonyms, synonyms at 0.7): an exact name match (whole name minus `core-`) 100 for a
 * one-word query, 40 within a phrase; a name token 40; a name prefix/substring 14; an exact tag
 * 16, a tag prefix 6; a description word 4, a description substring 1. Every query word must match
 * something unless none of the defs matches all words (then any). Ties: shorter names first, core
 * kit defs (kit/2 creatures before pack meshes) before world defs.
 */
export function searchDefs<T extends Searchable>(defs: T[], q: string, opts: { tag?: string; limit?: number; used?: (hash: string) => boolean } & vocab.Facets = {}): SearchHit<T>[] {
  let pool = defs;
  // VOCAB-MECH facets: category subtree, tag, form, has (slot:sit, action:open, comp:light, actuator:door …)
  if (opts.tag || opts.category || opts.form || opts.has?.length) pool = vocab.facetFilter(pool as never[], { tag: opts.tag, category: opts.category, form: opts.form, has: opts.has }) as unknown as T[];
  const qw = words(q);
  if (!qw.length) return (opts.used ? [...pool].sort((a, b) => Number(!!b.hash && opts.used!(b.hash)) - Number(!!a.hash && opts.used!(a.hash))) : pool).slice(0, opts.limit ?? 500).map((def) => ({ def, score: 0, why: [] }));
  const whole = qw.join('-');
  const variants = qw.map((w) => {
    const base = new Map<string, number>([[w, 1]]);
    const s = singular(w); if (!base.has(s)) base.set(s, 0.95);
    for (const k of [w, s]) for (const syn of SYNONYMS[k] ?? []) if (!base.has(syn)) base.set(syn, 0.7);
    return base;
  });
  // VOCAB-MECH: words that name a category ("bodega" → building.commercial), per query word and for the whole phrase
  const catOf = new Map<string, string[]>();
  for (const w of [...qw, whole]) { const c = [...new Set([...vocab.categoriesForWord(w), ...vocab.categoriesForWord(singular(w))])]; if (c.length) catOf.set(w, c); }
  const phraseCats = catOf.get(whole) ?? [];
  const scored = pool.map((def) => {
    const name = def.name.replace(/^core-/, ''), ntoks = name.split(/[-._]+/), tags = def.tags ?? [], desc = (def.description ?? '').toLowerCase(), dwords = new Set(words(desc).map(singular));
    const why: string[] = []; let score = 0, matched = 0;
    const syns = (def.synonyms ?? []).map((x) => x.toLowerCase().replace(/\s+/g, '-')), cat = vocab.categoryOf(def as never);
    if (name === whole || name === singular(whole) || name === `${singular(whole)}-pack`) { score += 100; why.push('name'); }
    // a def's own name for the whole phrase counts as its name (E2 #6: "canal boat" is the narrowboat, not the canal)
    else if (qw.length > 1 && (syns.includes(whole) || syns.includes(singular(whole)))) { score += 100; matched = qw.length; why.push(`aka=${whole}`); }
    else if (qw.length > 1 && phraseCats.some((c) => vocab.within(cat, c))) { score += 20; matched = qw.length; why.push(`cat=${cat}`); }
    for (const vs of variants) {
      let best = 0, bestWhy = '';
      for (const [v, wgt] of vs) {
        const cand: [number, string][] = [];
        if (name === v) cand.push([qw.length > 1 ? 40 : 100, `name=${v}`]);   // in a phrase, one word naming a def is only part of it
        if (ntoks.includes(v)) cand.push([40, `name~${v}`]);
        else if (name.includes(v) && v.length >= 3) cand.push([14, `name*${v}`]);
        if (tags.includes(v)) cand.push([16, `tag=${v}`]); else if (tags.some((t) => t.startsWith(v) && v.length >= 4)) cand.push([6, `tag*${v}`]);
        if (syns.includes(v)) cand.push([45, `aka=${v}`]);
        if ((catOf.get(v) ?? []).some((c) => vocab.within(cat, c))) cand.push([3.5, `cat=${cat}`]);   // below a description word: a tiebreak, and the answer when nothing else knows the word
        if (dwords.has(v)) cand.push([4, `desc=${v}`]); else if (v.length >= 4 && desc.includes(v)) cand.push([1, `desc*${v}`]);
        for (const [c, label] of cand) if (c * wgt > best) { best = c * wgt; bestWhy = label; }
      }
      if (best > 0) { matched = Math.min(qw.length, matched + 1); score += best; why.push(bestWhy); }
    }
    return { def, score, matched, why };
  }).filter((r) => r.score > 0);
  const all = scored.filter((r) => r.matched === qw.length);
  // partial matches (no def matched every word) never stand on a category word alone ("xylophone zeppelin")
  const hits = all.length ? all : scored.filter((r) => r.why.some((w) => !w.startsWith('cat=')));
  const rank = (d: Searchable) => (d.hash && opts.used?.(d.hash) ? -1 : d.ref.startsWith('core-') ? (d.make?.kind === 'mesh' ? 1 : 0) : 2);
  hits.sort((a, b) => b.score - a.score || rank(a.def) - rank(b.def) || a.def.name.length - b.def.name.length || (a.def.name < b.def.name ? -1 : 1));
  return hits.slice(0, opts.limit ?? 500).map(({ def, score, why }) => ({ def, score: Math.round(score * 10) / 10, why }));
}

/** The public ref a god types: `core/<name>@v` for the core kit, else `name@v`. */
export const publicRef = (d: { ref: string }) => (d.ref.startsWith('core-') ? 'core/' + d.ref.slice(5) : d.ref);

/** A ready-to-send example op for a def (what `place` looks like for its form). */
export function exampleOp(d: StoredDef) {
  const params: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(d.params ?? {}).slice(0, 3)) if ((f as { default?: unknown }).default !== undefined) params[k] = (f as { default?: unknown }).default;
  const base = { op: 'place', def: publicRef(d), name: d.name.replace(/^core-/, '') + '-1', ...(Object.keys(params).length ? { params } : {}) };
  const [w, , dd] = d.size.box, hw = Math.max(2, Math.min(40, w / 2)), hd = Math.max(2, Math.min(40, dd / 2));
  if (d.form === 'path') return { ...base, shape: { path: [[-hw, 0], [hw, 0]], width: Math.max(1, Math.min(8, dd)) } };
  if (d.form === 'area') return { ...base, shape: { area: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] } };
  return { ...base, p: [0, 0], r: 0 };
}

// ---------------------------------------------------------------- suggested def for an upload

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'asset';
/** A def/1 for an uploaded mesh: real-world size from `height` (uniform scale of the measured box); a footprint (already in the def's metres) gives room slots. */
export function meshDefFor(meta: AssetMeta, opts: { name: string; height?: number; description?: string; tags?: string[]; layer?: 'solid' | 'decor'; license?: string; source?: string }, fp?: { sha: string; baked?: FootprintBaked }) {
  const k = opts.height && meta.box[1] > 0 ? opts.height / meta.box[1] : 1;
  const box: Vec3 = [meta.box[0] * k, meta.box[1] * k, meta.box[2] * k].map((v) => Math.max(0.05, Math.round(v * 1000) / 1000)) as Vec3;
  const credit = [opts.license && `licence: ${opts.license}`, opts.source && `source: ${opts.source}`].filter(Boolean).join('; ');
  return {
    schema: 'def/1' as const, name: slug(opts.name), version: 1,
    description: (opts.description ?? `Imported model ${opts.name}.`) + (credit ? ` (${credit})` : ''),
    tags: [...new Set([...(opts.tags ?? []).map(slug), 'mesh', ...(fp ? ['building'] : [])])].slice(0, 32),
    form: 'point' as const,
    make: { kind: 'mesh' as const, asset: meta.sha, collide: 'box' as const, ...(fp ? { footprint: fp.sha } : {}) },
    size: { box, scale: [0.25, 4] as [number, number] },
    layer: opts.layer ?? (Math.max(box[0], box[2]) < 0.35 && box[1] < 0.6 ? 'decor' as const : 'solid' as const),
    anchor: 'base' as const,
    ...(fp?.baked?.slots.length ? { slots: fp.baked.slots } : {}),
    ...(fp ? { components: { place: { kind: 'building', enclosed: true } } } : {}),
  };
}

// ---------------------------------------------------------------- routes

export type AssetDeps = { god: GodMode; requireGod: (c: Context) => void; store?: AssetStore; dir?: string; asGod?: <T>(c: Context, fn: () => T) => T; wire?: WireCache };
const noStore = { 'cache-control': 'no-store' };

/**
 * Mount the asset and catalog routes. Must run before mountGodRoutes' own `/v1/god/defs` (the lead calls
 * this at the top of mountGodRoutes). Also wires the store into the world model as its AssetLookup.
 *   GET  /assets/<sha>.<ext>                 immutable objects; core GLB aliases revalidate
 *   GET  /asset-view/<source-sha>.glb        current viewer representation, revalidated by ETag
 *   POST /v1/god/assets                      god: multipart (file, footprint?, name?, height?, tags?, license?, source?, define?) or raw body + query
 *   GET  /v1/god/assets[?core=1]             god: this world's uploads (and the core assets)
 *   GET  /v1/god/assets/<sha>                public: measured facts
 *   GET  /v1/god/defs?q=&tag=&limit=         god: ranked library search
 *   GET  /v1/god/defs/<ref>                  god: full def, example op, asset facts, thumb url
 *   GET  /v1/god/defs/<ref>/thumb.png        public: thumbnail (404 until rendered: tools/god-skill/scripts/thumbs.mjs)
 *   POST /v1/god/defs/<ref>/thumb.png        god: store a rendered thumbnail (PNG ≤ 512 px)
 */
export function mountAssetRoutes(app: Hono, d: AssetDeps): AssetStore {
  const limitGod = godTokenLimiter(d.requireGod);
  const store = d.store ?? (d.god as { assets?: AssetStore }).assets ?? new AssetStore({ dir: d.dir ?? defaultAssetDir(), db: d.god.db, worldId: d.god.opts.worldId });
  d.god.model.assets = store.lookup;
  const budget = (): Budget => ({ ...DEFAULT_BUDGET, ...d.god.model.constants.limits.budget });
  // a def that extends another (a preset of a generator: corner-shop of shop) is listed as it resolves (its make, slots, params)
  const library = () => d.god.model.allDefs().map((x) => (x.extends ? d.god.model.resolvedDef(x.ref) ?? x : x)) as StoredDef[];
  const findDef = (ref: string): StoredDef | undefined => d.god.model.resolvedDef(ref) ?? d.god.model.def(ref.replace(/^core\//, 'core-'));

  // W3b: a core mesh's rendition (renditions.json) goes out under the source sha; brotli once ready (asset-wire.ts)
  const wire = d.wire ?? new WireCache(join(store.dir, 'wire'));
  const serveAsset = (view: boolean) => (c: Context) => {
    const [sha, ext] = c.req.param('file')!.split('.');
    const ren = ext === 'glb' ? store.rendition(sha) : null;
    const etag = ren ? `"${sha}-r${ren.sha.slice(0, 16)}"` : `"${sha}"`;
    const f = ren ? (existsSync(ren.file) ? ren.file : null) : store.file(sha, ext);
    if (!f || store.info(sha)?.ext !== ext) {
      c.header('cache-control', 'no-store');
      throw new ApiError(404, 'not-found', 'no such asset');
    }
    // A source SHA identifies the model, not necessarily its current wire bytes. Revalidate even before its first
    // rendition. The new view namespace also escapes historically fresh immutable aliases without per-build URLs.
    const cache = { 'cache-control': view || (ext === 'glb' && store.isCore(sha)) ? 'public, no-cache' : 'public, max-age=31536000, immutable', vary: 'accept-encoding' };
    if ((c.req.header('if-none-match') ?? '').replace(/^W\//, '') === etag) return c.body(null, 304, { etag, ...cache, 'access-control-allow-origin': '*' });
    const headers: Record<string, string> = { 'content-type': EXT_TYPES[ext as AssetMeta['ext']], etag, ...cache, 'access-control-allow-origin': '*' };
    const br = ext === 'glb' || ext === 'json' ? wire.brotli(`${ren ? ren.sha : sha}.${ext}`, f) : null;
    if (br && acceptsBrotli(c.req.header('accept-encoding'))) return c.body(br as never, 200, { ...headers, 'content-encoding': 'br' });
    return c.body(readFileSync(f) as never, 200, headers);
  };
  app.get('/assets/:file{[0-9a-f]{64}\\.(glb|png|jpg|json)}', serveAsset(false));
  app.get('/asset-view/:file{[0-9a-f]{64}\\.glb}', serveAsset(true));

  app.post('/v1/god/assets', godBodyLimit(budget), async (c) => {
    limitGod(c, 'asset-upload', L.assetUploadsPerMinute);
    const ct = c.req.header('content-type') ?? '';
    const q = (k: string) => c.req.query(k);
    let bytes: Uint8Array | null = null, footprint: Uint8Array | null = null;
    const field: Record<string, string | undefined> = {};
    if (ct.startsWith('multipart/form-data')) {
      let form: Awaited<ReturnType<typeof c.req.parseBody>>;
      try { form = await c.req.parseBody({ all: false }); }
      catch { throw new ApiError(400, 'asset.invalid', 'malformed multipart upload', { field: 'body', measured: { format: 'malformed multipart' }, allowed: { format: 'multipart/form-data with a file field' } }); }
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === 'string') field[k] = v;
        else if (v && typeof (v as Blob).arrayBuffer === 'function') {
          const file = v as Blob, max = k === 'footprint' ? FOOTPRINT_BYTES : budget().bytes;
          if (file.size > max) throw new ApiError(413, 'asset.budget', `${k} ${file.size} bytes > ${max}`, { field: k, measured: { bytes: file.size }, allowed: { bytes: max } });
          const b = new Uint8Array(await file.arrayBuffer()); if (k === 'footprint') footprint = b; else if (k === 'file' || !bytes) bytes = b;
        }
      }
      if (!footprint && field.footprint) footprint = new TextEncoder().encode(field.footprint);
    } else {
      const ab = await c.req.arrayBuffer(); bytes = new Uint8Array(ab);
      for (const k of ['name', 'height', 'tags', 'license', 'source', 'define', 'description', 'layer']) field[k] = q(k);
    }
    if (!bytes?.byteLength) throw new ApiError(400, 'asset.invalid', 'send the file as multipart field `file` (or as the raw body with content-type model/gltf-binary)', { field: 'file', measured: { bytes: 0 }, allowed: { bytes: '> 0' } });
    const name = field.name?.trim() || undefined;
    const height = field.height !== undefined ? Number(field.height) : undefined;
    if (height !== undefined && !(height > 0 && height < 400)) throw new ApiError(400, 'asset.invalid', 'height must be metres in (0, 400)', { field: 'height', measured: { height: field.height }, allowed: { minExclusive: 0, maxExclusive: 400, unit: 'metres' }, fix: 'Pass a finite height greater than 0 and less than 400 metres.' });
    const admitted = inspectAsset(bytes, { budget: budget() });
    let scaledFootprint: Uint8Array | undefined, footprintScale = 1;
    if (footprint) {
      inspectAsset(footprint, { kind: 'footprint' });
      // Check the transformed sidecar too before ANY store write.
      if (admitted.kind === 'mesh' && height && admitted.box[1] > 0 && Math.abs(height / admitted.box[1] - 1) > 1e-4) {
        footprintScale = height / admitted.box[1];
        try { scaledFootprint = new TextEncoder().encode(JSON.stringify(scaleFootprint(JSON.parse(new TextDecoder().decode(footprint)), footprintScale))); }
        catch (error) { throw new ApiError(400, 'asset.invalid', `footprint could not be scaled: ${(error as Error).message}`, { field: 'footprint', measured: { problem: (error as Error).message, scale: footprintScale }, allowed: { coordinates: 'finite numeric values after scaling' }, fix: 'Use finite footprint coordinates and a height that keeps its dimensions valid.' }); }
        inspectAsset(scaledFootprint, { kind: 'footprint' });
      }
    }
    store.checkWorldBudget([admitted, ...(footprint ? [inspectAsset(footprint, { kind: 'footprint' })] : []), ...(scaledFootprint ? [inspectAsset(scaledFootprint, { kind: 'footprint' })] : [])]);
    if (admitted.kind === 'mesh') { const v = await validateGlb(bytes); if (v) throw new ApiError(400, 'asset.invalid', `the GLB does not parse: ${v}`, { field: 'file', measured: { problem: v, bytes: bytes.byteLength }, allowed: { format: 'valid self-contained GLB 2.0' }, fix: 'Export a valid self-contained binary glTF 2.0 file.' }); }
    // G8 moderation after release 2's structured admission: metadata stripped, words and classifier checked
    const moderation = moderationFor(d.god.db.db, d.god.opts.worldId);
    const intake = await intakeUpload(moderation, bytes, { surface: 'asset', policy: assetPolicy(budget()), words: [name, field.source, field.license, field.description, field.tags], actor: 'god' })
      .catch((e) => { if (e instanceof UploadRejected) throw new ApiError(e.status, e.code, e.message); throw e; });
    bytes = intake.upload.bytes;
    const meta = store.put(bytes, { name, license: field.license, source: field.source, by: 'god', budget: budget(), footprint });
    recordIntake(moderation, intake, { surface: 'asset', actor: 'god' });
    const warnings: string[] = [];
    // the def's footprint is in the def's metres: rescale the sidecar when the import states another height
    let fpMeta = meta.footprint ? store.info(meta.footprint) : undefined;
    if (fpMeta && scaledFootprint) fpMeta = store.put(scaledFootprint, { kind: 'footprint', name: `${name ?? 'asset'}-footprint-x${footprintScale.toFixed(3)}`, by: 'god' });
    if (meta.kind === 'mesh' && !height && (meta.box[1] < 0.05 || meta.box[1] > 200)) warnings.push(`measured height ${meta.box[1]} looks unlike metres; pass height=<m> to scale it`);
    if (meta.kind === 'mesh' && meta.tris > 6000) warnings.push(`${meta.tris} triangles: above the prop (400) and building (6000) guides; fine for a landmark, heavy if repeated`);
    const def = meta.kind === 'mesh' && name ? meshDefFor(meta, { name, height, description: field.description, tags: field.tags?.split(',').map((t) => t.trim()).filter(Boolean), layer: field.layer === 'decor' || field.layer === 'solid' ? field.layer : undefined, license: field.license, source: field.source }, fpMeta) : undefined;
    let defined: unknown;
    if (def && (field.define === '1' || field.define === 'true')) { const act = () => d.god.act({ ops: [{ op: 'define', def }], note: `import ${def.name}` }, `import ${def.name}`); defined = d.asGod ? d.asGod(c, act) : act(); }
    const report = [
      `${meta.kind} ${meta.sha.slice(0, 12)}… ${meta.bytes} bytes${meta.kind === 'mesh' ? `, ${meta.tris} tris, ${meta.textures} textures (max ${meta.texPx} px), box ${meta.box.join(' × ')} m, clips ${meta.animations?.join(', ') || 'none'}` : ''}`,
      ...(fpMeta?.baked?.notes ?? []), ...(def ? [`def ${def.name}@1: size ${def.size.box.join(' × ')} m, layer ${def.layer}${def.slots ? `, ${def.slots.length} room slots` : ''}`] : []), ...warnings,
    ];
    return c.json({ ok: true, moderation: { ...moderation.state(meta.sha), classifier: intake.verdict.classifier, labels: intake.verdict.labels, stripped: intake.upload.stripped }, asset: { ...meta, url: `/assets/${meta.sha}.${meta.ext}` }, footprint: fpMeta ? { sha: fpMeta.sha, rooms: fpMeta.baked?.rooms?.length ?? 0, openings: fpMeta.baked?.openings?.length ?? 0, links: fpMeta.baked?.links?.length ?? 0, colliders: fpMeta.baked?.colliders.length ?? 0 } : null, def: def ?? null, defined: defined ?? null, warnings, report: report.join('\n') }, 200, noStore);
  });
  app.get('/v1/god/assets', (c) => { d.requireGod(c); const strip = (m: AssetMeta) => { const { baked: _b, ...rest } = m; return { ...rest, url: `/assets/${m.sha}.${m.ext}` }; }; return c.json({ assets: store.listWorld().map(strip), ...(c.req.query('core') ? { core: store.coreAssets().map(strip) } : {}) }, 200, noStore); });
  app.get('/v1/god/assets/:sha{[0-9a-f]{64}}', (c) => { const m = store.info(c.req.param('sha')); if (!m) throw new ApiError(404, 'not-found', 'no such asset'); const { baked, ...rest } = m; return c.json({ asset: { ...rest, url: `/assets/${m.sha}.${m.ext}` }, ...(baked ? { baked } : {}) }, 200, noStore); });

  app.get('/v1/god/defs', (c) => {
    d.requireGod(c);
    const q = c.req.query('q') ?? '', tag = c.req.query('tag'), limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 200) || 200)), offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
    // VOCAB-MECH facets: &category=building.commercial &has=slot:sit (repeatable or comma list) &form=area; `compact=1` = manifest rows
    const facets = { category: c.req.query('category') || undefined, form: c.req.query('form') || undefined, has: c.req.queries('has')?.flatMap((h) => h.split(',')).filter(Boolean) };
    const all = searchDefs(library().map((x) => ({ ...x, by: undefined })), q, { tag, limit: offset + limit, ...facets, used: hash => d.god.parts.used(hash) }), hits = all.slice(offset);
    const compact = c.req.query('compact') === '1';
    const defs = hits.map((h) => { const used = d.god.parts.badge(h.def.hash); return { ...(compact ? { ...vocab.manifestRow(h.def as never, { bytes: assetBytesOf(h.def as never, store), publicRef: publicRef(h.def) }), ...(q ? { score: h.score, why: h.why } : {}) } : { ...h.def, publicRef: publicRef(h.def), category: vocab.categoryOf(h.def as never), interfaces: vocab.interfacesOf(h.def as never), ...(q ? { score: h.score, why: h.why } : {}), thumb: ((t) => t ? `/thumbs/${t.hash}.png` : null)(store.thumbOf(h.def)) }), ...(used.length ? { used, usedIn: used } : {}) }; });
    if (q.trim() && !all.length && offset === 0) d.god.recordFindMiss(q);
    return c.json({ defs, count: defs.length, offset, query: q || null, ...(facets.category || facets.has?.length || facets.form ? { facets } : {}), ...(q && !defs.length ? { hint: 'nothing in the library matches; define it (kit/2 parts, a generator, or an imported mesh: POST /v1/god/assets)' } : {}) }, 200, noStore);
  });
  app.get('/v1/god/defs/*', (c) => {
    const rest = decodeURIComponent(c.req.path.replace(/^.*\/v1\/god\/defs\//, ''));
    const thumb = rest.endsWith('/thumb.png');
    const ref = thumb ? rest.slice(0, -'/thumb.png'.length) : rest;
    const def = findDef(ref);
    if (!def) throw new ApiError(404, 'not-found', `no def ${ref}; search with GET /v1/god/defs?q=`);
    if (thumb) {
      const t = store.thumbOf(def);
      if (!t) throw new ApiError(404, 'not-found', 'no thumbnail rendered yet (tools/god-skill/scripts/thumbs.mjs)');
      return c.body(readFileSync(t.file) as never, 200, { 'content-type': 'image/png', etag: `"${t.hash}"`, 'cache-control': 'public, max-age=3600' });
    }
    d.requireGod(c);
    const { by: _by, ...pub } = def;
    const asset = def.make.kind === 'mesh' ? store.info(def.make.asset) : undefined;
    const extendsChain: string[] = []; for (let e = def.extends; e && extendsChain.length < 8; e = d.god.model.def(e)?.extends) extendsChain.push(e);
    return c.json({
      def: pub, publicRef: publicRef(def), example: { ops: [exampleOp(def)] },
      parts: d.god.parts.details(def.hash),
      slots: def.slots.map((s) => ({ id: s.id, kind: s.kind, capacity: s.capacity, ...(s.label ? { label: s.label } : {}) })),
      components: Object.keys(def.components ?? {}), extends: extendsChain,
      category: vocab.categoryOf(def as never), interfaces: vocab.interfacesOf(def as never), manifest: vocab.manifestLine(vocab.manifestRow(def as never, { bytes: assetBytesOf(def, store), publicRef: publicRef(def) })),
      asset: asset ? (({ baked: _b, ...m }) => ({ ...m, url: `/assets/${m.sha}.${m.ext}` }))(asset) : null,
      thumb: ((t) => t ? `/thumbs/${t.hash}.png` : null)(store.thumbOf(def)),
    }, 200, noStore);
  });
  app.post('/v1/god/defs/*', async (c) => {
    limitGod(c, 'thumbnail-upload', L.thumbnailUploadsPerMinute);
    const rest = decodeURIComponent(c.req.path.replace(/^.*\/v1\/god\/defs\//, ''));
    if (!rest.endsWith('/thumb.png')) throw new ApiError(404, 'not-found', 'POST /v1/god/defs/<ref>/thumb.png with a PNG body');
    const def = findDef(rest.slice(0, -'/thumb.png'.length));
    if (!def) throw new ApiError(404, 'not-found', 'no such def');
    // G8 moderation: the same gate as every upload (a well-formed PNG, metadata stripped)
    let png: Uint8Array;
    try { png = validateUpload(new Uint8Array(await c.req.arrayBuffer()), { formats: ['png'], maxBytes: 400_000, maxTris: 0, maxTextures: 1, maxTexPx: 512, maxImageBytes: 400_000 }).bytes; }
    catch (e) { if (e instanceof UploadRejected) throw new ApiError(e.status, e.code, e.message); throw e; }
    store.putThumb(def.hash, png);
    return c.json({ ok: true, thumb: `/v1/god/defs/${publicRef(def)}/thumb.png`, immutable: `/thumbs/${def.hash}.png` }, 200, noStore);
  });
  mountCatalogRoutes(app, { god: d.god, requireGod: d.requireGod, store, library });
  return store;
}
