// Model import (issue #760): measure a GLB from its container alone, the way the world does at POST /v1/god/assets
// (apps/server/src/god/assets.ts measureGlb), so `upload` can refuse an oversized or malformed file before the network
// with the same numbers the server would print. No decoders, no dependencies: this file is bundled into eden-god.mjs.
// The server stays authoritative; a file that passes here can still be refused there (moderation, world totals).

/** The default per-asset budget (packages/generators/src/creation-limits.ts: defTris, assetBytes, texturePx). */
export const DEFAULT_BUDGET = Object.freeze({ tris: 80_000, bytes: 3_000_000, texPx: 2048 });
/** Images uploaded on their own (PNG/JPEG for signs, pictures, murals). */
export const IMAGE_BUDGET = Object.freeze({ bytes: 2_000_000, texPx: 2048 });
/** Required glTF extensions the viewer decodes (assets.ts DECODABLE). Anything else required is refused. */
export const DECODABLE = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization', 'KHR_texture_transform', 'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_texture_basisu']);
/** Listed as decodable by the server, but the web viewer has no KTX2 transcoder wired: such textures would not show. */
export const WARN_EXTENSIONS = new Set(['KHR_texture_basisu']);

const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const ascii = (b, s, e) => String.fromCharCode(...b.subarray(s, e));

/** What the first bytes say a file is. */
export function sniff(b) {
  if (b.length >= 4 && ascii(b, 0, 4) === 'glTF') return 'glb';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  let i = 0; while (i < b.length && /\s/.test(String.fromCharCode(b[i]))) i++;
  return b[i] === 0x7b ? 'json' : 'unknown';
}

/** Width and height from a PNG, JPEG or WebP header (0 when unreadable). */
export function imageSize(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return { w: dv.getUint32(16), h: dv.getUint32(20), type: 'png' };
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
  if (b.length > 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    const fmt = ascii(b, 12, 16);
    if (fmt === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff, type: 'webp' };
    if (fmt === 'VP8L') { const v = dv.getUint32(21, true); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, type: 'webp' }; }
    if (fmt === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: 'webp' };
    return { w: 0, h: 0, type: 'webp' };
  }
  return { w: 0, h: 0, type: 'unknown' };
}

/** The JSON and BIN chunks of a GLB 2.0 container; a readable error for anything else. */
export function parseGlb(b) {
  if (b.length < 20) throw new Error('not a GLB (too short)');
  if (ascii(b, 0, 4) !== 'glTF') throw new Error('not a GLB (magic is not "glTF"): export binary glTF 2.0 (.glb), not .gltf, .obj or .fbx');
  if (u32(b, 4) !== 2) throw new Error(`GLB version ${u32(b, 4)}; only glTF 2.0 is accepted`);
  const total = u32(b, 8);
  if (total !== b.length) throw new Error(total > b.length ? 'GLB truncated' : 'GLB length does not match the file');
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = u32(b, off), type = u32(b, off + 4);
    if (len % 4 || off + 8 + len > total) throw new Error('GLB chunk is misaligned or truncated');
    if (off === 12 && type !== 0x4e4f534a) throw new Error('GLB first chunk must be JSON');
    const chunk = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) { if (json) throw new Error('GLB has duplicate JSON chunks'); json = JSON.parse(new TextDecoder().decode(chunk)); }
    else if (type === 0x004e4942) { if (bin) throw new Error('GLB has duplicate BIN chunks'); bin = chunk; }
    off += 8 + len;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('GLB JSON chunk must be an object');
  return { json, bin };
}

// column-major 4x4, as glTF stores them
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Measure a GLB: triangles, bytes, textures (count and largest side), the rest-pose bounds through the node hierarchy,
 * clips, skins, extensions. Throws for a container the world would refuse as invalid (external URIs, no geometry,
 * a required extension the viewer cannot decode).
 */
export function measureGlb(bytes) {
  const { json, bin } = parseGlb(bytes);
  if (!String(json.asset?.version ?? '').startsWith('2')) throw new Error('glTF asset.version must be 2.x');
  for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith('data:')) throw new Error(`external buffer ${b.uri}: the GLB must be self-contained (export with embedded buffers)`);
  for (const im of json.images ?? []) if (im.uri && !im.uri.startsWith('data:')) throw new Error(`external image ${im.uri}: embed textures in the GLB`);
  const required = json.extensionsRequired ?? [];
  const missing = required.filter((e) => !DECODABLE.has(e));
  if (missing.length) throw new Error(`required extension(s) the viewer cannot decode: ${missing.join(', ')} (use meshopt + KHR_mesh_quantization for geometry, WebP for textures)`);
  const acc = json.accessors ?? [];
  let tris = 0;
  for (const [mi, m] of (json.meshes ?? []).entries()) for (const [pi, p] of (m.primitives ?? []).entries()) {
    const field = `meshes.${mi}.primitives.${pi}`;
    const position = acc[p.attributes?.POSITION];
    if (!position || position.min?.length !== 3 || position.max?.length !== 3) throw new Error(`${field}.attributes.POSITION needs an accessor with 3D min/max bounds`);
    const mode = p.mode ?? 4, n = p.indices !== undefined ? acc[p.indices]?.count ?? 0 : position.count ?? 0;
    tris += mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const nodes = json.nodes ?? [], scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => n.children?.includes(i)));
  const world = new Map();
  const walk = (i, parent, depth) => { const n = nodes[i]; if (!n || depth > 64 || world.has(i)) return; const m = mul(parent, n.matrix ?? trs(n.translation, n.rotation, n.scale)); world.set(i, m); for (const c of n.children ?? []) walk(c, m, depth + 1); };
  for (const r of roots) walk(r, I4, 0);
  for (const [i, m] of world) {
    const n = nodes[i]; if (n.mesh === undefined) continue;
    // a skinned mesh is drawn by its skeleton; at rest the first joint's world matrix stands in (the server reads the
    // inverse bind matrix too; the two agree for every rig exported in bind pose)
    const mm = n.skin !== undefined && json.skins?.[n.skin]?.joints?.length ? world.get(json.skins[n.skin].joints[0]) ?? m : m;
    for (const p of json.meshes?.[n.mesh]?.primitives ?? []) {
      const a = acc[p.attributes?.POSITION]; if (!a?.min || !a.max) continue;
      const k = a.normalized ? NORM[a.componentType] ?? 1 : 1, mn = a.min.map((v) => v / k), mx = a.max.map((v) => v / k);
      for (let c = 0; c < 8; c++) { const q = apply(mm, [c & 1 ? mx[0] : mn[0], c & 2 ? mx[1] : mn[1], c & 4 ? mx[2] : mn[2]]); for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], q[j]); hi[j] = Math.max(hi[j], q[j]); } }
    }
  }
  if (![...lo, ...hi].every(Number.isFinite)) throw new Error('GLB has no measurable geometry (no finite POSITION min/max)');
  let texPx = 0;
  const views = json.bufferViews ?? [];
  for (const im of json.images ?? []) {
    let b = null;
    if (im.bufferView !== undefined && bin) { const v = views[im.bufferView]; if (v) b = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + Math.min(v.byteLength, 4096)); }
    else if (im.uri?.startsWith('data:')) b = Uint8Array.from(Buffer.from(im.uri.slice(im.uri.indexOf(',') + 1, im.uri.indexOf(',') + 1 + 8192), 'base64'));
    if (b) { const s = imageSize(b); texPx = Math.max(texPx, s.w, s.h); }
  }
  return {
    tris: Math.round(tris), bytes: bytes.byteLength, textures: (json.images ?? []).length, texPx,
    box: [r3(hi[0] - lo[0]), r3(hi[1] - lo[1]), r3(hi[2] - lo[2])], min: lo.map(r3), max: hi.map(r3),
    animations: (json.animations ?? []).map((a, i) => a.name ?? `clip-${i}`), skins: (json.skins ?? []).length,
    meshes: (json.meshes ?? []).length, materials: (json.materials ?? []).length, nodes: roots.map((r) => nodes[r]?.name ?? `node-${r}`),
    extensionsUsed: json.extensionsUsed ?? [], extensionsRequired: required,
    vertexColors: (json.meshes ?? []).some((m) => (m.primitives ?? []).some((p) => p.attributes?.COLOR_0 !== undefined)),
  };
}

const MB = (n) => `${(n / 1e6).toFixed(2)} MB`;
export const FIX = 'reduce it first: node tools/god-skill/scripts/optimize-glb.mjs <file> --out <dir> --kind hero|scene|character|head|prop (or, without the repo: npx @gltf-transform/cli optimize in.glb out.glb --simplify-error 0.01 --texture-size 1024 --texture-compress webp --compress meshopt), then upload the output';

/**
 * The refusals the world would answer for this measurement under `budget` (none → an empty list), each with the
 * field, the measured number and the limit, as the server reports them (code asset.budget).
 */
export function budgetRefusals(m, budget = DEFAULT_BUDGET) {
  const out = [];
  if (m.tris > budget.tris) out.push({ code: 'asset.budget', field: 'tris', measured: m.tris, allowed: budget.tris, message: `${m.tris.toLocaleString('en-US')} triangles > ${budget.tris.toLocaleString('en-US')}` });
  if (m.bytes > budget.bytes) out.push({ code: 'asset.budget', field: 'bytes', measured: m.bytes, allowed: budget.bytes, message: `${MB(m.bytes)} > ${MB(budget.bytes)}` });
  if (m.texPx > budget.texPx) out.push({ code: 'asset.budget', field: 'texPx', measured: m.texPx, allowed: budget.texPx, message: `a ${m.texPx} px texture > ${budget.texPx} px` });
  return out;
}

/** Advice the server does not refuse on, printed as warnings. */
export function adviceFor(m) {
  const out = [];
  for (const e of m.extensionsUsed) if (WARN_EXTENSIONS.has(e)) out.push(`${e}: the web viewer has no KTX2 transcoder; these textures will not show. Use WebP (EXT_texture_webp).`);
  if (m.texPx > 1024) out.push(`largest texture ${m.texPx} px: the viewer fits colour maps to 1024 px and other maps to 512 px on load; 2048 only pays off on a hero piece seen up close`);
  if (m.tris > 6000) out.push(`${m.tris.toLocaleString('en-US')} triangles: above the prop (400) and building (6000) guides; fine for a landmark, heavy if placed many times`);
  if (m.box[1] < 0.05 || m.box[1] > 200) out.push(`measured height ${m.box[1]} m looks unlike metres; pass --height <m> to scale it`);
  if (m.animations.length && !m.animations.some((a) => /^(idle|walk)$/i.test(a))) out.push(`clips ${m.animations.join(', ')}: name one Idle and one Walk (Fly/Swim/Run count as Walk) or the first clip plays for everything`);
  return out;
}

/** One line of facts, the way the server's report reads. */
export function describeMeasure(m) {
  return `${m.tris.toLocaleString('en-US')} tris, ${MB(m.bytes)}, ${m.textures} texture${m.textures === 1 ? '' : 's'}${m.textures ? ` (max ${m.texPx} px)` : ''}, box ${m.box.join(' × ')} m, clips ${m.animations.join(', ') || 'none'}${m.skins ? `, ${m.skins} skin${m.skins === 1 ? '' : 's'}` : ''}${m.vertexColors ? ', vertex colours' : ''}`;
}

/** The fields POST /v1/god/assets takes beside the file, in the order the manifest and the CLI name them. */
export const UPLOAD_FIELDS = ['name', 'height', 'tags', 'license', 'source', 'description', 'layer', 'define'];
export const MANIFEST_SCHEMA = 'god-upload-manifest/1';

/** Check a manifest's shape; returns its entries with `file`/`footprint` kept as written (the caller resolves paths). */
export function readManifest(doc) {
  if (!doc || doc.schema !== MANIFEST_SCHEMA) throw new Error(`manifest.schema must be "${MANIFEST_SCHEMA}"`);
  if (!Array.isArray(doc.assets) || !doc.assets.length) throw new Error('manifest.assets must be a non-empty array of { file, name, … }');
  return doc.assets.map((a, i) => {
    if (!a || typeof a.file !== 'string' || !a.file) throw new Error(`assets[${i}].file must be a path`);
    if (a.name !== undefined && typeof a.name !== 'string') throw new Error(`assets[${i}].name must be a string`);
    if (a.height !== undefined && !(Number(a.height) > 0 && Number(a.height) < 400)) throw new Error(`assets[${i}].height must be metres in (0, 400)`);
    if (a.layer !== undefined && !['solid', 'decor'].includes(a.layer)) throw new Error(`assets[${i}].layer must be solid or decor`);
    if (a.tags !== undefined && !(Array.isArray(a.tags) || typeof a.tags === 'string')) throw new Error(`assets[${i}].tags must be an array or a comma list`);
    const unknown = Object.keys(a).filter((k) => !['file', 'footprint', ...UPLOAD_FIELDS].includes(k));
    if (unknown.length) throw new Error(`assets[${i}]: unknown field(s) ${unknown.join(', ')}; allowed: file, footprint, ${UPLOAD_FIELDS.join(', ')}`);
    return { ...a, tags: Array.isArray(a.tags) ? a.tags.join(',') : a.tags };
  });
}
