// XP8 faces in the viewer: text lines (canvas), this world's own images (TextureLoader on /w/<world>/assets/<sha>.png|jpg
// only, the WD8 sign-media rule), and seeded stained glass / mosaic (pure pixel arrays → DataTexture: no canvas, network
// or paid generation). One small mesh per face, on a kit/2 shape side or a building wall slot. Owner: lane Y2.
import * as THREE from 'three';
import { FACE_IMAGE, FACE_NORMALS, boxSideSize, decalSchema, faceLines, faceLocalSide, type Decal, type FaceContent, type FaceSide, type KitShape, type ShapeFace, type Slot } from '@souls/generators';
import { BASE } from '../base-path.ts';

type V3 = [number, number, number];
const LIFT = 0.004;
/** Text-up of each local side (front/back/left/right read upright; a top reads from the front; a bottom from below the front). */
const UP: Record<FaceSide, V3> = { front: [0, 1, 0], back: [0, 1, 0], left: [0, 1, 0], right: [0, 1, 0], top: [0, 0, -1], bottom: [0, 0, 1] };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Face textures are budgeted by bytes (RGBA with mipmaps), least recently used first out. An evicted texture that is
 *  still drawn re-uploads on its next draw; only the evicted texture and its materials are released. */
export const FACE_TEXTURE_BUDGET = Object.freeze({ bytes: 192 * 2 ** 20, count: 1024 });
const textures = new Map<string, { t: THREE.Texture; bytes: number }>(); // insertion order = recency
const materials = new Map<string, THREE.MeshStandardMaterial>();
let loader: THREE.TextureLoader | undefined, cachedBytes = 0;
const rgbaBytes = (w: number, h: number) => Math.round(w * h * 4 * 4 / 3);
/** The face texture cache as it stands (tests and probes). */
export const faceTextureCache = () => ({ textures: textures.size, bytes: cachedBytes, materials: materials.size });
function cached(key: string): THREE.Texture | undefined {
  const hit = textures.get(key); if (!hit) return undefined;
  textures.delete(key); textures.set(key, hit); return hit.t;
}
function resize(key: string, bytes: number) { const e = textures.get(key); if (e) { cachedBytes += bytes - e.bytes; e.bytes = bytes; evict(key); } }
function evict(keep: string) {
  for (const [key, e] of textures) {
    if (cachedBytes <= FACE_TEXTURE_BUDGET.bytes && textures.size <= FACE_TEXTURE_BUDGET.count) break;
    if (key === keep) continue;
    textures.delete(key); cachedBytes -= e.bytes;
    for (const [k, m] of materials) if (m.map === e.t) { m.dispose(); materials.delete(k); }
    e.t.dispose();
  }
}
function remember(key: string, t: THREE.Texture, bytes: number): THREE.Texture {
  textures.set(key, { t, bytes }); cachedBytes += bytes; evict(key); return t;
}

/** Same rule as world-path.ts, resolved per call so offline meshers (no `location`) can import this module. */
export function faceImagePath(image: unknown): string | null {
  if (typeof image !== 'string' || !FACE_IMAGE.test(image)) return null;
  const path = typeof location !== 'undefined' ? location.pathname : '';
  const rel = BASE && path.startsWith(BASE + '/') ? path.slice(BASE.length) : path;
  return `${BASE}/w/${rel.match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/)?.[1] ?? 'toy'}${image}`;
}

// ---------------------------------------------------------------- seeded patterns (pure; tested for determinism)

const DEFAULT_PALETTE: Record<'stained-glass' | 'mosaic', string[]> = {
  'stained-glass': ['#b3202a', '#1f4e9c', '#e3a51b', '#2f7d3b', '#6a2c8c', '#d9622b', '#3aa0c8'],
  mosaic: ['#f2e8d5', '#b5532f', '#2d5f8a', '#d8a23a', '#3f6e4a', '#7a2f3a'],
};
const rgb = (hex: string): V3 => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash3 = (i: number, j: number, seed: number) => mulberry(Math.imul(i + 7919, 73856093) ^ Math.imul(j + 104729, 19349663) ^ Math.imul(seed + 1, 83492791))();
const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
/** Pixels (centres) closer than `r` to the closed outline, found by stroking each edge: each edge visits only the rows
 *  and columns of its own band, so the cost follows perimeter × border rather than pixels × outline vertices. */
function strokeMask(w: number, h: number, outline: [number, number][], r: number): Uint8Array {
  const mask = new Uint8Array(w * h), r2 = r * r;
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i], [bx, by] = outline[(i + 1) % outline.length], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 0.5)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      // The part of the edge within r of this row, widened by r: no nearer pixel lies outside it.
      let t0 = 0, t1 = 1;
      if (dy !== 0) { const ta = (yc - r - ay) / dy, tb = (yc + r - ay) / dy; t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb)); if (t0 > t1) continue; }
      else if (Math.abs(ay - yc) >= r) continue;
      const xa = ax + t0 * dx, xb = ax + t1 * dx;
      const x0 = Math.max(0, Math.floor(Math.min(xa, xb) - r - 0.5)), x1 = Math.min(w - 1, Math.ceil(Math.max(xa, xb) + r));
      for (let x = x0; x <= x1; x++) {
        const k = y * w + x; if (mask[k]) continue;
        const xc = x + 0.5, t = Math.max(0, Math.min(1, ((xc - ax) * dx + (yc - ay) * dy) / len2)), ex = xc - ax - t * dx, ey = yc - ay - t * dy;
        if (ex * ex + ey * ey < r2) mask[k] = 1;
      }
    }
  }
  return mask;
}

/** RGBA pixels (row 0 = bottom, v = 0) of a seeded pattern. `outline` (pixels) draws a lead border along a shaped face. */
export function patternPixels(kind: 'stained-glass' | 'mosaic', w: number, h: number, opts: { seed?: number; palette?: string[]; cells?: number; outline?: [number, number][] } = {}): Uint8Array {
  const seed = opts.seed ?? 1, palette = (opts.palette ?? DEFAULT_PALETTE[kind]).map(rgb), px = new Uint8Array(w * h * 4);
  const put = (i: number, c: V3) => { px[i] = clamp8(c[0]); px[i + 1] = clamp8(c[1]); px[i + 2] = clamp8(c[2]); px[i + 3] = 255; };
  if (kind === 'stained-glass') {
    // Jittered Voronoi glass folded about the vertical centre line (windows read as designed), leaded between pieces.
    const cells = opts.cells ?? 7, s = w / cells, lead: V3 = [38, 34, 30], leadW = Math.max(1.2, s * 0.07), border = Math.max(2, s * 0.14);
    const gx = Math.ceil(w / 2 / s) + 2, gy = Math.ceil(h / s) + 2, sites: { x: number; y: number; c: V3; shade: number }[] = [];
    const rand = mulberry(seed * 2654435761);
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) sites.push({ x: (i + 0.15 + 0.7 * rand()) * s, y: (j + 0.15 + 0.7 * rand()) * s, c: palette[Math.floor(rand() * palette.length)], shade: 0.82 + 0.3 * rand() });
    const rim = opts.outline ? strokeMask(w, h, opts.outline, border) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = Math.min(x, w - 1 - x) + 0.5, fy = y + 0.5, k = (y * w + x) * 4;
      if (rim ? rim[y * w + x] : Math.min(x + 0.5, w - x - 0.5, fy, h - fy) < border) { put(k, lead); continue; }
      const ci = Math.floor(fx / s), cj = Math.floor(fy / s);
      let q1 = Infinity, q2 = Infinity, near = sites[0]; // squared distances; one root each for the two nearest
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= gx || j >= gy) continue;
        const site = sites[j * gx + i], ex = fx - site.x, ey = fy - site.y, q = ex * ex + ey * ey;
        if (q < q1) { q2 = q1; q1 = q; near = site; } else if (q < q2) q2 = q;
      }
      const d1 = Math.sqrt(q1);
      if (Math.sqrt(q2) - d1 < leadW) { put(k, lead); continue; }
      const glow = near.shade * (1.1 - 0.28 * Math.min(1, d1 / s)) + 0.04 * Math.sin(fy * 0.21 + near.x);
      put(k, [near.c[0] * glow, near.c[1] * glow, near.c[2] * glow]);
    }
    return px;
  }
  // Mosaic: square tesserae laid in grout, coloured by a seeded medallion (rings bent into petals) inside a border.
  const cols = opts.cells ?? 16, s = w / cols, rows = Math.ceil(h / s), grout: V3 = [204, 196, 180], gw = Math.max(1, s * 0.12);
  const petals = 4 + (seed % 5), bands = palette.length + 1, R = Math.min(w, h) / 2;
  const tile = (i: number, j: number) => {
    const r = hash3(i, j, seed), cx = (i + 0.5) * s - w / 2, cy = (j + 0.5) * s - h / 2, d = Math.hypot(cx, cy) / R, a = Math.atan2(cy, cx);
    let index: number;
    if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) index = 1 % palette.length;
    else if (d > 0.98) index = 0;
    else index = (Math.floor((d + 0.12 * (0.5 + 0.5 * Math.cos(a * petals))) * bands) + (r < 0.06 ? 1 : 0)) % palette.length;
    const c = palette[index], shade = 0.9 + 0.2 * r;
    return { c: [c[0] * shade, c[1] * shade, c[2] * shade] as V3, ox: (hash3(j, i, seed) - 0.5) * 0.16 * s, oy: (r - 0.5) * 0.16 * s };
  };
  const tiles = Array.from({ length: rows * cols }, (_, k) => tile(k % cols, Math.floor(k / cols)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = Math.min(cols - 1, Math.floor((x + 0.5) / s)), j = Math.min(rows - 1, Math.floor((y + 0.5) / s)), t = tiles[j * cols + i];
    const lx = x + 0.5 - i * s - t.ox, ly = y + 0.5 - j * s - t.oy, k = (y * w + x) * 4;
    put(k, lx < gw || ly < gw || lx > s - gw || ly > s - gw ? grout : t.c);
  }
  return px;
}

/** Long side of a pattern texture: 160 px per metre, 128 at least; glass pieces are large, so glass stops at 256. */
export const patternSize = (pattern: FaceContent['pattern'], wM: number, hM: number) => Math.max(128, Math.min(pattern === 'stained-glass' ? 256 : 512, Math.round(Math.max(wM, hM) * 160)));
function patternTexture(face: FaceContent, wM: number, hM: number, outline: [number, number][] | undefined): THREE.Texture {
  const long = patternSize(face.pattern, wM, hM), w = wM >= hM ? long : Math.max(32, Math.round(long * wM / hM)), h = wM >= hM ? Math.max(32, Math.round(long * hM / wM)) : long;
  const pxOutline = outline?.map(([u, v]) => [u * w, v * h] as [number, number]);
  const key = JSON.stringify(['pattern', face.pattern, face.seed ?? 1, face.palette ?? null, face.cells ?? null, w, h, pxOutline?.map(p => p.map(Math.round)) ?? null]);
  const hit = cached(key); if (hit) return hit;
  const t = new THREE.DataTexture(patternPixels(face.pattern!, w, h, { seed: face.seed, palette: face.palette, cells: face.cells, outline: pxOutline }), w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return remember(key, t, rgbaBytes(w, h));
}

// ---------------------------------------------------------------- text and images

const FONTS: Record<string, string> = {
  serif: "600 {s}px Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  sans: "600 {s}px 'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "500 {s}px Menlo, Consolas, 'Courier New', monospace",
  hand: "500 {s}px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive",
};
/** Text canvas pixels from the face's size: 640 px per metre of height (64..256, or 512 past four lines), the face's
 *  aspect kept, and at most 1024 wide (a long sign gets a shorter canvas rather than a stretched one). */
export function textCanvasSize(lines: number, wM: number, hM: number): [number, number] {
  const aspect = wM / Math.max(hM, 0.01);
  let ch = Math.max(64, Math.min(lines > 4 ? 512 : 256, Math.round(hM * 640))), cw = Math.round(ch * aspect);
  if (cw > 1024) { cw = 1024; ch = Math.max(16, Math.round(1024 / aspect)); }
  return [Math.max(32, cw), ch];
}
function textTexture(face: FaceContent, wM: number, hM: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const lines = faceLines(face.text), key = JSON.stringify(['text', lines, face.font, face.ink, face.bg, face.align, Math.round(wM * 100), Math.round(hM * 100)]);
  const hit = cached(key); if (hit) return hit;
  const [cw, ch] = textCanvasSize(lines.length, wM, hM);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d')!;
  if (face.bg !== 'none') { g.fillStyle = face.bg ?? '#f3ead7'; g.fillRect(0, 0, cw, ch); }
  const margin = Math.max(cw * 0.05, ch * 0.05), font = (s: number) => FONTS[face.font ?? 'serif'].replace('{s}', String(s));
  const cols = lines.map(l => l.split('\t'));
  const width = (cells: string[], s: number) => cells.length > 1 ? g.measureText(cells[0]).width + s + g.measureText(cells.slice(1).join(' ')).width : g.measureText(cells[0]).width;
  let size = Math.floor((ch * 0.82) / Math.max(1, lines.length)); g.font = font(size);
  while (size > 8 && Math.max(...cols.map(cells => width(cells, size))) > cw - 2 * margin) { size -= 2; g.font = font(size); }
  g.fillStyle = face.ink ?? '#2b2622'; g.textBaseline = 'middle';
  cols.forEach((cells, i) => {
    const y = ch / 2 + (i - (lines.length - 1) / 2) * size * 1.12;
    if (cells.length > 1) { g.textAlign = 'left'; g.fillText(cells[0], margin, y); g.textAlign = 'right'; g.fillText(cells.slice(1).join(' '), cw - margin, y); }
    else if (face.align === 'left') { g.textAlign = 'left'; g.fillText(cells[0], margin, y); }
    else { g.textAlign = 'center'; g.fillText(cells[0], cw / 2, y); }
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return remember(key, t, rgbaBytes(cw, ch));
}
function imageTexture(image: unknown): THREE.Texture | null {
  const url = faceImagePath(image);
  if (!url) return null;
  if (typeof document === 'undefined') return null;
  loader ??= new THREE.TextureLoader();
  let t = cached(url);
  if (!t) {
    // Counted at 1 MB until the image arrives, then at its real size.
    t = loader.load(url, loaded => { const img = loaded.image as { width?: number; height?: number } | undefined; if (img?.width && img.height) resize(url, rgbaBytes(img.width, img.height)); });
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; remember(url, t, 2 ** 20);
  }
  return t;
}

function faceMaterial(face: FaceContent, wM: number, hM: number, outline: [number, number][] | undefined, glow: number): THREE.MeshStandardMaterial {
  const map = face.pattern ? patternTexture(face, wM, hM, outline) : face.text !== undefined ? textTexture(face, wM, hM) : imageTexture(face.image);
  const clear = face.text !== undefined && face.bg === 'none', level = Math.round(glow * 20) / 20;
  const fallback = face.text !== undefined ? (face.bg !== 'none' ? face.bg ?? '#f3ead7' : '#ffffff') : '#8a8f96';
  const key = `${map?.uuid ?? fallback}|${level}|${clear}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : fallback, roughness: face.pattern === 'stained-glass' ? 0.35 : 0.85, metalness: 0, transparent: clear && !!map, opacity: clear && !map ? 0 : 1, alphaTest: clear ? 0.4 : 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    if (level > 0 && map) { m.emissive.set('#ffffff'); m.emissiveMap = map; m.emissiveIntensity = level * 1.2; }
    m.userData.face = face.pattern ?? (face.text !== undefined ? 'text' : 'image'); // survives instancing (probes count faces)
    materials.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------- geometry

/** A flat face through 3-D outline points (kit or building frame) with outward normal `n` and text-up `up`: uv spans the
 *  outline's bounds; triangles wind toward `n`. Returns the mesh and the outline in uv for a pattern's lead border. */
function faceGeometry(outline: THREE.Vector3[], holes: THREE.Vector3[][], n: THREE.Vector3, up: THREE.Vector3): { geometry: THREE.BufferGeometry; size: [number, number]; uv: [number, number][] } {
  const right = new THREE.Vector3().crossVectors(up, n).normalize(), origin = outline[0];
  const flat = (p: THREE.Vector3) => new THREE.Vector2(p.clone().sub(origin).dot(right), p.clone().sub(origin).dot(up));
  const contour = outline.map(flat), inner = holes.map(h => h.map(flat)), all = [...contour, ...inner.flat()], points = [...outline, ...holes.flat()];
  const box = new THREE.Box2().setFromPoints(all), size = box.getSize(new THREE.Vector2());
  const uv = (v: THREE.Vector2): [number, number] => [(v.x - box.min.x) / (size.x || 1), (v.y - box.min.y) / (size.y || 1)];
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [];
  for (let [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, inner)) {
    if (THREE.ShapeUtils.area([all[a], all[b], all[c]]) < 0) [b, c] = [c, b];
    for (const k of [a, b, c]) { const p = points[k].clone().addScaledVector(n, LIFT); pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uvs.push(...uv(all[k])); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return { geometry: g, size: [size.x, size.y], uv: contour.map(uv) };
}
function faceMesh(content: FaceContent, outline: THREE.Vector3[], holes: THREE.Vector3[][], n: THREE.Vector3, up: THREE.Vector3, glow: number, shaped: boolean): THREE.Mesh {
  const { geometry, size, uv } = faceGeometry(outline, holes, n, up);
  const mesh = new THREE.Mesh(geometry, faceMaterial(content, size[0], size[1], shaped ? uv : undefined, glow));
  mesh.name = 'kit-face'; mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.userData.face = content.pattern ?? (content.text !== undefined ? 'text' : 'image');
  return mesh;
}

/** Meshes for one kit shape's faces in the kit frame (minus `offset`, a role pivot). Mirrored shapes keep readable text. */
export function shapeFaceMeshes(sh: KitShape, round: number, offset?: THREE.Vector3): THREE.Mesh[] {
  if (!sh.faces?.length || (sh.kind !== 'box' && sh.kind !== 'rbox' && sh.kind !== 'extrude')) return [];
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...sh.at).sub(offset ?? new THREE.Vector3()), new THREE.Quaternion().setFromEuler(new THREE.Euler(sh.pitch ?? 0, sh.yaw ?? 0, sh.roll ?? 0, 'YXZ')), new THREE.Vector3(...(sh.scale ?? [1, 1, 1])));
  const out: THREE.Mesh[] = [];
  for (const face of sh.faces as ShapeFace[]) {
    const { local } = faceLocalSide(sh, face.side), nl = new THREE.Vector3(...FACE_NORMALS[local]), ul = new THREE.Vector3(...UP[local]), rl = new THREE.Vector3().crossVectors(ul, nl);
    let outline: THREE.Vector3[], holes: THREE.Vector3[][] = [];
    if (sh.kind === 'extrude') {
      const bevel = (sh.round ?? round) > 0.005 ? Math.min(sh.round ?? round, 0.03) : 0, y = local === 'top' ? (sh.h ?? 0.2) + bevel : -bevel;
      outline = (sh.polygon ?? [[0, 0], [1, 0], [0, 1]]).map(([x, z]) => new THREE.Vector3(x, y, z));
      holes = (sh.holes ?? []).map(hole => hole.map(([x, z]) => new THREE.Vector3(x, y, z)));
    } else {
      const size = sh.size ?? [1, 1, 1], [W, H] = boxSideSize(size, local);
      const r = Math.max(0, Math.min(sh.round ?? (sh.kind === 'rbox' ? Math.max(round, 0.06) : round), Math.min(...size) / 2 - 1e-4));
      const w = face.w ?? Math.max(0.01, W - 2 * r), h = face.h ?? Math.max(0.01, H - 2 * r), [ax, ay] = face.at ?? [0, 0];
      const c = nl.clone().multiply(new THREE.Vector3(...size).multiplyScalar(0.5)).addScaledVector(rl, ax).addScaledVector(ul, ay);
      outline = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => c.clone().addScaledVector(rl, i * w / 2).addScaledVector(ul, j * h / 2));
    }
    for (const p of [...outline, ...holes.flat()]) p.applyMatrix4(m);
    // Directions through the same transform: a reflection keeps the outward side outward; text is rebuilt unmirrored.
    const n = nl.clone().transformDirection(m), up = ul.clone().transformDirection(m);
    up.addScaledVector(n, -up.dot(n)).normalize(); if (up.y < -0.3) up.negate();
    out.push(faceMesh(face, outline, holes, n, up, Math.max(face.glow ?? (face.pattern === 'stained-glass' ? 0.3 : 0), sh.glow ?? 0), sh.kind === 'extrude'));
  }
  return out;
}

/** Building decals on wall slots, grouped as `level-<floor>` in the building's canonical frame (the interior view hides
 *  them with their storey). Slots come from the bake (entity frame); `yaw` turns them back into the canonical frame. */
export function decalGroups(decals: unknown, slots: readonly Slot[] | undefined, yaw: number): THREE.Group[] {
  if (!Array.isArray(decals) || !slots?.length) return [];
  const groups = new Map<string, THREE.Group>(), c = Math.cos(yaw), s = Math.sin(yaw);
  for (const raw of decals.slice(0, 16)) {
    const parsed = decalSchema.safeParse(raw); if (!parsed.success) continue;
    const d: Decal = parsed.data, slot = slots.find(x => x.id === d.slot && x.kind === 'wall'); if (!slot) continue;
    const [px, py, pz] = slot.p, a = slot.yaw - yaw, [ax, ay] = d.at ?? [0, 0];
    const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, n);
    const centre = new THREE.Vector3(px * c - pz * s, py, px * s + pz * c).addScaledVector(right, ax).addScaledVector(up, ay).addScaledVector(n, 0.002);
    const outline = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => centre.clone().addScaledVector(right, i * d.w / 2).addScaledVector(up, j * d.h / 2));
    const name = `level-${slot.floor ?? 0}`, group = groups.get(name) ?? Object.assign(new THREE.Group(), { name });
    group.add(Object.assign(faceMesh(d, outline, [], n, up, d.glow ?? 0, false), { name: 'building-decal' }));
    groups.set(name, group);
  }
  return [...groups.values()];
}
