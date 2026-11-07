// far-land/1 and panorama/1 mesh halves (lane MARSLAND-FAR): what lies beyond the walkable edge.
//  - far-land/1: a polar ring of coarse low-poly ground from the extent edge (heights and colours taken from the
//    terrain there, so there is no seam) out to `radius`, vertex-painted from data (areas, strips, sea); strips and
//    roads as crisp ribbons (lateral bands, polygon offset, clipped to outside the extent), utility poles and wires
//    along roads, sparse shrub mounds (one instanced draw), and the sea as one water polygon at its level.
//  - panorama/1: mountain ranges at real distances as a camera-following ring (a vertex shader places every vertex at
//    its true elevation angle for the current eye, earth curvature included), drawn at a fixed depth just in front of
//    the sky dome, so it is behind every real thing; a ground/water skirt fills below the horizon to ~600 m.
// The view's depth buffer (near 0.1, far 2400) cannot hold anything beyond ~2.1 km in front of the sky dome, so the
// panorama sits exactly there and stands in for everything farther. Coordinates: x east, z south; bearings compass.
import * as THREE from 'three';
import { TILE_M } from '@souls/ground';
import { registerMesh, type MeshCtx } from './registry.ts';
import { terrainColorFor } from './ground-palette.ts';
import { waterMaterial, waterMesh } from './water.ts';
import { GRADE_A, GRADE_B, GRADE_GLSL, GRADE_PARS } from '../atmosphere/grade.ts';
import { NOISE_MAP } from '../atmosphere/chunks.ts';

type V2 = [number, number];
type RGB = [number, number, number];
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _c = new THREE.Color();
const rgb = (hex: string): RGB => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, f: number): RGB => [a[0] * f, a[1] * f, a[2] * f];
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function h01(a: number, b = 0, c = 0): number { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0; return h / 4294967296; }
/** Smooth value noise in 2-D (lattice 1), 0..1. */
function vn(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h01(xi, zi, seed), b = h01(xi + 1, zi, seed), c = h01(xi, zi + 1, seed), d = h01(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function vn1(x: number, seed: number): number { const xi = Math.floor(x), f = x - xi, u = f * f * (3 - 2 * f); return h01(xi, seed) * (1 - u) + h01(xi + 1, seed) * u; }

// ---------------------------------------------------------------- finishes
type Finish = { c: string; m: string[]; shrub?: string; sh?: number; d?: string; da?: number };
/** Ground finishes (drone-frame colours, Salton basin): base colour, mottle colours (patches), shrub colour, shrubs/ha. */
const FINISH: Record<string, Finish> = {
  playa: { c: '#d3c4a4', m: ['#c2b292', '#ddd2bb', '#c9b48e'], d: '#b2a283', da: 0.25 },
  salt: { c: '#e9e6df', m: ['#c99e72', '#dcd8cf', '#f3f1ec'], d: '#c39a70', da: 0.45 },
  // the salt-pan mosaic between the levee and the shore: pale crusts, orange-brown flats and dark shrub patches
  flats: { c: '#bdb5a5', m: ['#a8845f', '#dedad0', '#7f7862'], shrub: '#4a4838', sh: 30, d: '#4b4a38', da: 0.75 },
  beach: { c: '#eeebe4', m: ['#e2ded4', '#f6f4ef'] },
  scrub: { c: '#5e5946', m: ['#3f3b2e', '#857a5e', '#55533f'], shrub: '#403d2f', sh: 45, d: '#34322a', da: 0.7 },
  wash: { c: '#57543f', m: ['#3f4334', '#8f8670', '#5a7044'], shrub: '#3c4232', sh: 60, d: '#30352a', da: 0.75 },
  delta: { c: '#5f6a49', m: ['#465538', '#76894f', '#958b74'], shrub: '#3f4e34', sh: 55, d: '#34412c', da: 0.65 },
  mud: { c: '#a8998a', m: ['#928472', '#b8ab95'] },
  track: { c: '#e2d9c6', m: ['#d6ccb7'] },
  sand: { c: '#dccca8', m: ['#cdbb94', '#e6d9bb'] },
  grass: { c: '#7a8f55', m: ['#6a804a', '#8c9c62'], shrub: '#5a7040', sh: 25 },
  rock: { c: '#8f877b', m: ['#7a7368', '#a39a8c'] },
  dirt: { c: '#a99276', m: ['#957f63', '#b9a386'] },
};
type Paint = { base: RGB; mott: RGB[]; shrub: RGB | null; sh: number; seed: number; det: RGB; da: number };
function paintOf(f: { m?: unknown; c?: unknown; shrubs?: unknown }, seed: number): Paint {
  const fin = FINISH[String(f.m ?? '')] ?? FINISH.playa;
  const base = typeof f.c === 'string' && /^#[0-9a-f]{6}$/i.test(f.c) ? rgb(f.c) : rgb(fin.c);
  return { base, mott: fin.m.map(rgb), shrub: fin.shrub ? rgb(fin.shrub) : null, sh: num(f.shrubs, fin.sh ?? 0), seed, det: rgb(fin.d ?? fin.c), da: fin.da ?? 0 };
}
/** A finish's colour at a point: base, broken into soft patches of its mottle colours, plus a little grain. */
function paintAt(p: Paint, x: number, z: number, amount: number): RGB {
  let c = p.base;
  for (let i = 0; i < p.mott.length; i++) {
    const s = 55 + i * 41, t = sstep(0.56, 0.78, vn(x / s, z / s, p.seed * 7 + i * 13));
    if (t > 0) c = mix(c, p.mott[i], t * amount);
  }
  const g = 1 + (h01(Math.floor(x / 9), Math.floor(z / 9), p.seed) - 0.5) * 0.06 * amount;
  return mul(c, g);
}

// ---------------------------------------------------------------- geometry helpers
const pointsOf = (v: unknown): V2[] => (Array.isArray(v) ? v.filter((p): p is V2 => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) : []);
function inPoly(px: number, pz: number, poly: V2[]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }
function segDist(px: number, pz: number, a: V2, b: V2) { const vx = b[0] - a[0], vz = b[1] - a[1], n = vx * vx + vz * vz; let t = n ? ((px - a[0]) * vx + (pz - a[1]) * vz) / n : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t); }
function lineDist(px: number, pz: number, path: V2[], closed: boolean) { let d = Infinity; for (let i = 1; i < path.length; i++) d = Math.min(d, segDist(px, pz, path[i - 1], path[i])); if (closed && path.length > 2) d = Math.min(d, segDist(px, pz, path[path.length - 1], path[0])); return d; }
function bbox(p: V2[], pad: number): [number, number, number, number] { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } return [x0 - pad, z0 - pad, x1 + pad, z1 + pad]; }
const inBox = (x: number, z: number, b: [number, number, number, number]) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
/** Resample a polyline so no step is longer than `step` (keeps the corners). */
function resample(p: V2[], step: number): V2[] {
  const out: V2[] = p.length ? [p[0]] : [];
  for (let i = 1; i < p.length; i++) { const [ax, az] = p[i - 1], [bx, bz] = p[i], l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / step)); for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]); }
  return out;
}
/** Pieces of a polyline outside a rectangle (Liang–Barsky per segment). */
function outsideRect(p: V2[], r: [number, number, number, number]): V2[][] {
  const pieces: V2[][] = []; let cur: V2[] = [];
  const flush = () => { if (cur.length > 1) pieces.push(cur); cur = []; };
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], dx = b[0] - a[0], dz = b[1] - a[1];
    let t0 = 0, t1 = 1, hit = true;
    for (const [pp, q] of [[-dx, a[0] - r[0]], [dx, r[2] - a[0]], [-dz, a[1] - r[1]], [dz, r[3] - a[1]]] as [number, number][]) {
      if (Math.abs(pp) < 1e-12) { if (q < 0) { hit = false; break; } continue; }
      const t = q / pp; if (pp < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
    }
    const at = (t: number): V2 => [a[0] + dx * t, a[1] + dz * t];
    if (!hit || t1 - t0 < 1e-9) { if (!cur.length) cur.push(a); cur.push(b); continue; }
    if (t0 > 1e-9) { if (!cur.length) cur.push(a); cur.push(at(t0)); }
    flush();
    if (t1 < 1 - 1e-9) cur.push(at(t1), b);
  }
  flush();
  return pieces;
}

// ---------------------------------------------------------------- materials (shared, cached)
const mats = new Map<string, THREE.Material>();
function landMat(offset = 0): THREE.MeshStandardMaterial {
  const k = `land${offset}`; let m = mats.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) { m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }); if (offset) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4 * offset; } withDetail(m); mats.set(k, m); }
  return m;
}
/** Fine ground detail the coarse grid cannot carry: a vertex's `detail` (rgb = its finish's dark mottle, a = amount)
 *  breaks the colour into patches with the atmosphere's tiling noise at three scales (one texture, three taps). */
function withDetail(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFarNoise = NOISE_MAP; sh.uniforms.uFarNoiseOn = { get value() { return NOISE_MAP.value ? 1 : 0; } };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 detail;\nvarying vec4 vFarDetail;\nvarying vec2 vFarXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarDetail = detail;\nvFarXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uFarNoise;\nuniform float uFarNoiseOn;\nvarying vec4 vFarDetail;\nvarying vec2 vFarXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (uFarNoiseOn > 0.5 && vFarDetail.a > 0.001) {
        vec2 q1 = mat2(0.866, 0.5, -0.5, 0.866) * vFarXZ, q2 = mat2(0.6, -0.8, 0.8, 0.6) * vFarXZ;   // rotated taps: no lattice-aligned blocks
        float n1 = texture2D(uFarNoise, vFarXZ * (1.0 / 173.0)).r, n2 = texture2D(uFarNoise, q1 * (1.0 / 41.0) + 0.37).b, n3 = texture2D(uFarNoise, q2 * (1.0 / 13.0) + 0.71).g;
        float n = n1 * 0.5 + n2 * 0.38 + n3 * 0.12;
        diffuseColor.rgb = mix(diffuseColor.rgb, vFarDetail.rgb, smoothstep(0.46, 0.64, n) * vFarDetail.a);
        diffuseColor.rgb *= 1.0 + (n3 - 0.5) * 0.1 * vFarDetail.a;
      }`);
  };
  m.customProgramCacheKey = () => 'far-land-detail';
}
function shrubMat(): THREE.MeshStandardMaterial { let m = mats.get('shrub') as THREE.MeshStandardMaterial | undefined; if (!m) { m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }); mats.set('shrub', m); } return m; }
function poleMat(): THREE.MeshStandardMaterial { let m = mats.get('pole') as THREE.MeshStandardMaterial | undefined; if (!m) { m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }); mats.set('pole', m); } return m; }
function wireMat(): THREE.LineBasicMaterial { let m = mats.get('wire') as THREE.LineBasicMaterial | undefined; if (!m) { m = new THREE.LineBasicMaterial({ color: '#2f2a26', transparent: true, opacity: 0.45 }); mats.set('wire', m); } return m; }
function disposeOnRemove(g: THREE.Object3D) { g.addEventListener('removed', () => g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.geometry) mm.geometry.dispose(); })); }

/** Vertex buffers for a vertex-coloured mesh. */
type Det = [number, number, number, number];
const NO_DET: Det = [0, 0, 0, 0];
class Buf {
  pos: number[] = []; col: number[] = []; idx: number[] = []; det: number[] = [];
  v(x: number, y: number, z: number, c: RGB, d: Det = NO_DET) { this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2]); this.det.push(d[0], d[1], d[2], d[3]); return this.pos.length / 3 - 1; }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, c, b, b, c, d); }
  get tris() { return this.idx.length / 3; }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('detail', new THREE.Float32BufferAttribute(this.det, 4)); g.setIndex(this.idx); g.computeVertexNormals(); return g; }
}

// ---------------------------------------------------------------- far-land/1
type Area = { poly: V2[]; bb: [number, number, number, number]; p: Paint; edge: number };
type Strip = { path: V2[]; bb: [number, number, number, number]; p: Paint; w: number; edge: number; tracks: number[]; trackW: number; trackC: RGB };
type Road = { path: V2[]; w: number; lines: boolean; poles: { side: number; every: number; h: number } | null };
type Sea = { poly: V2[]; bb: [number, number, number, number]; level: number; c: string; beach: number; beachP: Paint };

function buildFarLand(ctx: MeshCtx): THREE.Object3D | null {
  const m = ctx.model, P = ctx.params, wp = m.worldPose(ctx.entity), ox = wp.x, oz = wp.z;
  // the terrain picture covers whole tiles, so it can overhang the extent: start where it ends
  const [ex0, ez0, ex1, ez1] = m.ground().extent;
  const bx0 = Math.floor(ex0 / TILE_M) * TILE_M, bz0 = Math.floor(ez0 / TILE_M) * TILE_M, bx1 = Math.ceil(ex1 / TILE_M) * TILE_M, bz1 = Math.ceil(ez1 / TILE_M) * TILE_M, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, hx = (bx1 - bx0) / 2, hz = (bz1 - bz0) / 2;
  const base = m.constants.base, R = num(P.radius, 2300), mottle = num(P.mottle, 0.5), seed = (ctx.entity.seed ?? 0) | 0;
  const W = (p: V2[]): V2[] => p.map(([x, z]) => [x + ox, z + oz]);
  const terrainColor = terrainColorFor((m.state as { ground?: { palette?: string } }).ground?.palette);
  const tc = new THREE.Color();
  terrainColor(tc, base, 0, base, 0, 0);
  const gBase: RGB = typeof P.ground === 'string' && /^#/.test(P.ground) ? rgb(P.ground) : [tc.r, tc.g, tc.b];
  const groundP: Paint = { base: gBase, mott: [mul(gBase, 0.92), mul(gBase, 1.05), mix(gBase, [0.6, 0.6, 0.6], 0.18)], shrub: null, sh: 0, seed: seed + 1, det: mul(gBase, 0.82), da: 0.3 };
  const areas: Area[] = (Array.isArray(P.areas) ? P.areas : []).flatMap((f, i) => { const o = f as Record<string, unknown>; const poly = W(pointsOf(o.pts)); if (poly.length < 3) return []; const edge = num(o.edge, 30); return [{ poly, bb: bbox(poly, edge), p: paintOf(o, seed + 11 + i), edge }]; });
  const strips: Strip[] = (Array.isArray(P.strips) ? P.strips : []).flatMap((f, i) => { const o = f as Record<string, unknown>; const path = W(pointsOf(o.pts)); if (path.length < 2) return []; const w = Math.max(2, num(o.w, 60)), edge = num(o.edge, Math.min(30, w * 0.3)); return [{ path, bb: bbox(path, w / 2 + edge), p: paintOf(o, seed + 31 + i), w, edge, tracks: Array.isArray(o.tracks) ? (o.tracks as unknown[]).filter((t): t is number => typeof t === 'number') : [], trackW: num(o.trackW, 4), trackC: rgb(FINISH.track.c) }]; });
  const roads: Road[] = (Array.isArray(P.roads) ? P.roads : []).flatMap((f) => { const o = f as Record<string, unknown>; const path = W(pointsOf(o.pts)); if (path.length < 2) return []; const po = o.poles as Record<string, unknown> | undefined; return [{ path, w: Math.max(4, num(o.w, 12)), lines: o.lines !== false, poles: po ? { side: num(po.side, 1) < 0 ? -1 : 1, every: Math.max(20, num(po.every, 60)), h: num(po.h, 10) } : null }]; });
  const so = P.sea as Record<string, unknown> | null | undefined;
  const seaPoly = so ? W(pointsOf(so.pts)) : [];
  const sea: Sea | null = seaPoly.length >= 3 ? { poly: seaPoly, bb: bbox(seaPoly, num(so!.beach, 40) + 10), level: base + num(so!.level, -1), c: typeof so!.c === 'string' ? so!.c : '#4f8fb4', beach: num(so!.beach, 40), beachP: paintOf({ m: 'beach' }, seed + 71) } : null;
  const rect: [number, number, number, number] = [bx0, bz0, bx1, bz1];

  /** The far ground's colour and height at a point (the painted features in order, then the sea). */
  const colourAt = (x: number, z: number, soft: number): RGB => {
    let c = paintAt(groundP, x, z, mottle);
    for (const a of areas) { if (!inBox(x, z, a.bb)) continue; const e = Math.max(a.edge, soft), d = lineDist(x, z, a.poly, true), s = inPoly(x, z, a.poly) ? d : -d, t = sstep(-e, e, s); if (t > 0) c = mix(c, paintAt(a.p, x, z, mottle), t); }
    for (const s of strips) { if (!inBox(x, z, s.bb)) continue; const e = Math.max(s.edge, soft), d = lineDist(x, z, s.path, false), t = sstep(s.w / 2 + e, s.w / 2 - e * 0.5, d); if (t > 0) c = mix(c, paintAt(s.p, x, z, mottle), t); }
    if (sea && inBox(x, z, sea.bb)) {
      const d = lineDist(x, z, sea.poly, true), inside = inPoly(x, z, sea.poly);
      if (inside) c = mix(paintAt(sea.beachP, x, z, mottle), rgb('#5f8fb0'), sstep(0, 60, d));
      else if (sea.beach > 0) c = mix(c, paintAt(sea.beachP, x, z, mottle), sstep(sea.beach + Math.max(10, soft), sea.beach * 0.5, d));
    }
    return c;
  };
  /** The fine-detail ink at a point (same weights as colourAt): its finish's dark mottle and how much of it. */
  const detailAt = (x: number, z: number, soft: number): Det => {
    let d: RGB = groundP.det, a = groundP.da;
    const blend = (p: Paint, t: number) => { const wa = a * (1 - t), wb = p.da * t, w = wa + wb; d = w > 1e-6 ? mix(d, p.det, wb / w) : d; a = w; };
    for (const ar of areas) { if (!inBox(x, z, ar.bb)) continue; const e = Math.max(ar.edge, soft), dd = lineDist(x, z, ar.poly, true), sgn = inPoly(x, z, ar.poly) ? dd : -dd, t = sstep(-e, e, sgn); if (t > 0) blend(ar.p, t); }
    for (const st of strips) { if (!inBox(x, z, st.bb)) continue; const e = Math.max(st.edge, soft), dd = lineDist(x, z, st.path, false), t = sstep(st.w / 2 + e, st.w / 2 - e * 0.5, dd); if (t > 0) blend(st.p, t); }
    if (sea && inBox(x, z, sea.bb)) { const dd = lineDist(x, z, sea.poly, true); if (inPoly(x, z, sea.poly)) a = 0; else if (sea.beach > 0) a *= 1 - sstep(sea.beach + Math.max(10, soft), sea.beach * 0.5, dd); }
    return [d[0], d[1], d[2], a];
  };
  const heightAt = (x: number, z: number): number => {
    if (!sea || !inBox(x, z, sea.bb)) return base;
    const d = lineDist(x, z, sea.poly, true);
    if (inPoly(x, z, sea.poly)) return sea.level - Math.min(8, 0.4 + d * 0.04);
    return sea.level + (base - sea.level) * sstep(0, Math.max(10, sea.beach), d) + 0.05;
  };

  const group = new THREE.Group(); group.name = 'far land'; group.userData.cameraTransparent = true;
  const stats = { tris: 0, draws: 0, shrubs: 0, poles: 0 };
  // ---- the ground ring: spokes from the extent edge outward, geometric radial spacing (8 m at the edge, ~85 m out)
  {
    const SEG = 300, K = 40, q = 1.06, qK = Math.pow(q, K);
    const edge = (a: number) => Math.min(Math.abs(Math.cos(a)) > 1e-6 ? hx / Math.abs(Math.cos(a)) : Infinity, Math.abs(Math.sin(a)) > 1e-6 ? hz / Math.abs(Math.sin(a)) : Infinity);
    const b = new Buf();
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), d0 = edge(a), span = Math.max(50, R - d0);
      const ex = cx + ca * (d0 - 0.5), ez = cz + sa * (d0 - 0.5), hEdge = m.terrain.sample(ex, ez);
      terrainColor(tc, hEdge, m.terrain.slope(ex, ez), base, ex, ez); const cEdge: RGB = [tc.r, tc.g, tc.b];
      for (let k = 0; k <= K; k++) {
        const r = d0 + (span * (Math.pow(q, k) - 1)) / (qK - 1), x = cx + ca * r, z = cz + sa * r, out = r - d0;
        const step = (span * (q - 1) * Math.pow(q, k)) / (qK - 1);
        const join = Math.exp(-out / 45);
        const y = k === 0 ? hEdge : heightAt(x, z) + (hEdge - base) * join;
        const c = k === 0 ? cEdge : mix(colourAt(x, z, step * 0.6), cEdge, join * 0.85);
        b.v(x, y, z, c, k === 0 ? NO_DET : (() => { const dd = detailAt(x, z, step * 0.6); return [dd[0], dd[1], dd[2], dd[3] * (1 - join)] as Det; })());
      }
    }
    for (let s = 0; s < SEG; s++) for (let k = 0; k < K; k++) { const a = s * (K + 1) + k, a2 = (s + 1) * (K + 1) + k; b.quad(a, a + 1, a2, a2 + 1); }
    const mesh = new THREE.Mesh(b.geometry(), landMat()); mesh.name = 'far land: ground'; mesh.receiveShadow = false; mesh.castShadow = false;
    group.add(mesh); stats.tris += b.tris; stats.draws++;
  }
  // ---- ribbons: strips (lateral bands with tracks) and roads; triangles inside the extent are dropped (exactly enough:
  // straddling quads are split in 4 up to 3 times), the rest drawn over the ground with a polygon offset
  const insideRect = (x: number, z: number) => x > rect[0] && x < rect[2] && z > rect[1] && z < rect[3];
  const ribbon = (b: Buf, path: V2[], bands: { o0: number; o1: number; col: (x: number, z: number, o: number) => RGB; det?: Det }[], lift: number, jag: number, jseed: number) => {
    const pts = resample(path, 18);
    for (const piece of outsideRect(pts, rect)) {
      if (piece.length < 2) continue;
      const nrm: V2[] = piece.map((_, i) => { const a = piece[Math.max(0, i - 1)], c = piece[Math.min(piece.length - 1, i + 1)], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; });
      let sAcc = 0; const sAt: number[] = piece.map((p, i) => (i ? (sAcc += Math.hypot(p[0] - piece[i - 1][0], p[1] - piece[i - 1][1])) : 0));
      for (const band of bands) {
        const row: number[][] = [];
        for (let i = 0; i < piece.length; i++) {
          const [px, pz] = piece[i], [nx, nz] = nrm[i];
          const j0 = band.o0 === bands[0].o0 ? (vn1(sAt[i] / 37, jseed) - 0.5) * jag : 0, j1 = band.o1 === bands[bands.length - 1].o1 ? (vn1(sAt[i] / 41, jseed + 5) - 0.5) * jag : 0;
          const ids: number[] = [];
          for (const o of [band.o0 + j0, band.o1 + j1]) { const x = px + nx * o, z = pz + nz * o; ids.push(b.v(x, heightAt(x, z) + lift, z, band.col(x, z, o), band.det ?? NO_DET)); }
          row.push(ids);
        }
        for (let i = 1; i < row.length; i++) {
          const a = row[i - 1][0], c = row[i - 1][1], d = row[i][0], e = row[i][1];
          const P3 = (k: number): V2 => [b.pos[k * 3], b.pos[k * 3 + 2]];
          const allOut = [a, c, d, e].every((k) => !insideRect(...P3(k)));
          if (allOut) b.quad(a, d, c, e);
          else if ([a, c, d, e].some((k) => !insideRect(...P3(k)))) splitQuad(b, a, c, d, e, insideRect, 3);
        }
      }
    }
  };
  if (strips.length) {
    strips.forEach((s, i) => {
      const b = new Buf(), hw = s.w / 2;
      const cuts = [-hw, ...s.tracks.flatMap((t) => [t - s.trackW / 2, t + s.trackW / 2]).filter((o) => o > -hw && o < hw), hw].sort((x, y) => x - y);
      const bands: { o0: number; o1: number; col: (x: number, z: number, o: number) => RGB; det?: Det }[] = [];
      for (let k = 1; k < cuts.length; k++) {
        const o0 = cuts[k - 1], o1 = cuts[k], mid = (o0 + o1) / 2, track = s.tracks.some((t) => Math.abs(t - mid) < s.trackW / 2 + 1e-6);
        bands.push({ o0, o1, det: track ? NO_DET : [s.p.det[0], s.p.det[1], s.p.det[2], s.p.da], col: track ? (x, z) => mix(s.trackC, paintAt(s.p, x, z, mottle), 0.45) : (x, z, o) => { const c = paintAt(s.p, x, z, mottle); return mix(c, colourAt(x, z, 0), sstep(hw * 0.55, hw * 1.05, Math.abs(o)) * 0.6); } });
      }
      ribbon(b, s.path, bands, 0.05, s.w * 0.3, seed + 101 + i);
      if (!b.tris) return;
      const mesh = new THREE.Mesh(b.geometry(), landMat(1 + i)); mesh.name = `far land: strip ${i + 1}`; group.add(mesh); stats.tris += b.tris; stats.draws++;
    });
  }
  // ---- roads: shoulders, edge lines, lanes, a double yellow centre line; poles and wires on one side
  if (roads.length) {
    const b = new Buf(), poleB = new Buf(), wires: number[] = [];
    const asphalt = rgb('#4b4c4f'), gravel = rgb('#a39886'), white = rgb('#e8e6df'), yellow = rgb('#d8b23a'), wood = rgb('#6e5b47');
    for (const r of roads) {
      const k = r.w / 12.2, sh = 2.2 * k, ln = 3.6 * k, wl = 0.15, yl = 0.12, gap = 0.1, hw = r.w / 2;
      const prof: [number, RGB][] = r.lines ? [[sh, gravel], [wl, white], [ln, asphalt], [yl, yellow], [gap, asphalt], [yl, yellow], [ln, asphalt], [wl, white], [sh, gravel]] : [[sh, gravel], [ln * 2 + 2 * wl + 2 * yl + gap, asphalt], [sh, gravel]];
      let o = -hw; const bands = prof.map(([w, c]) => { const o0 = o; o += w; const col = c === gravel ? (x: number, z: number) => mix(gravel, colourAt(x, z, 0), 0.25) : () => c; return { o0, o1: o, col }; });
      bands[bands.length - 1].o1 = hw;
      ribbon(b, r.path, bands, 0.08, 0, 0);
      if (r.poles) {
        const off = r.poles.side * (hw + 4), H = r.poles.h;
        const pts = resample(r.path, 5); let acc = 0, next = 0, prevTop: [number, number, number][] | null = null;
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [bx, bz] = pts[i], l = Math.hypot(bx - ax, bz - az); acc += l;
          if (acc < next) continue; next = acc + r.poles.every;
          const nx = -(bz - az) / l, nz = (bx - ax) / l, x = bx + nx * off, z = bz + nz * off;
          const far = Math.hypot(x - cx, z - cz) > R || insideRect(x, z);
          if (far) { prevTop = null; continue; }
          const y = heightAt(x, z);
          pole(poleB, x, y, z, H, Math.atan2(nz, nx), wood); stats.poles++;
          const tops: [number, number, number][] = [-1.05, 0, 1.05].map((u) => [x + nx * u, y + H - 0.55 + (u === 0 ? 0.55 : 0), z + nz * u]);
          if (prevTop) for (let w = 0; w < 3; w++) { const A = prevTop[w], B = tops[w]; for (let t = 0; t < 4; t++) { const t0 = t / 4, t1 = (t + 1) / 4, sag = (u: number) => -4 * 0.45 * u * (1 - u); wires.push(A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0 + sag(t0), A[2] + (B[2] - A[2]) * t0, A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1 + sag(t1), A[2] + (B[2] - A[2]) * t1); } }
          prevTop = tops;
        }
      }
    }
    if (b.tris) { const mesh = new THREE.Mesh(b.geometry(), landMat(1 + strips.length)); mesh.name = 'far land: roads'; group.add(mesh); stats.tris += b.tris; stats.draws++; }
    if (poleB.tris) { const g = poleB.geometry(); const mesh = new THREE.Mesh(g, poleMat()); mesh.name = 'far land: poles'; group.add(mesh); stats.tris += poleB.tris; stats.draws++; }
    if (wires.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3)); const lines = new THREE.LineSegments(g, wireMat()); lines.name = 'far land: wires'; lines.raycast = () => {}; group.add(lines); stats.draws++; }
  }
  // ---- shrub mounds: jittered grid inside shrubby strips/areas, clumped by noise, one instanced draw
  {
    const spots: { x: number; z: number; s: number; c: RGB }[] = [], CAP = 2000;
    const scatter = (bb: [number, number, number, number], p: Paint, inside: (x: number, z: number) => number, k: number) => {
      if (!p.shrub || p.sh <= 0) return;
      const cell = 100 / Math.sqrt(p.sh);
      for (let z = bb[1]; z < bb[3] && spots.length < CAP; z += cell) for (let x = bb[0]; x < bb[2] && spots.length < CAP; x += cell) {
        const jx = x + h01(Math.floor(x), Math.floor(z), k) * cell, jz = z + h01(Math.floor(x), Math.floor(z), k + 1) * cell;
        if (insideRect(jx, jz) || Math.hypot(jx - cx, jz - cz) > R - 30) continue;
        const w = inside(jx, jz); if (w <= 0) continue;
        if (vn(jx / 60, jz / 60, k + 2) * w < 0.42) continue;   // clumps
        const s = 0.8 + h01(Math.floor(jx), Math.floor(jz), k + 3) * 1.3;
        spots.push({ x: jx, z: jz, s, c: mix(p.shrub, p.mott[(h01(Math.floor(jx), Math.floor(jz), k + 4) * p.mott.length) | 0] ?? p.shrub, 0.25 * h01(Math.floor(jz), Math.floor(jx), k)) });
      }
    };
    strips.forEach((s, i) => scatter(s.bb, s.p, (x, z) => { const d = lineDist(x, z, s.path, false); return d < s.w / 2 ? 1 - d / (s.w / 2) * 0.5 : 0; }, seed + 201 + i * 7));
    areas.forEach((a, i) => scatter(a.bb, a.p, (x, z) => (inPoly(x, z, a.poly) ? 0.8 : 0), seed + 301 + i * 7));
    if (spots.length) {
      const geo = shrubGeometry(), inst = new THREE.InstancedMesh(geo, shrubMat(), spots.length), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
      spots.forEach((sp, i) => { e.set(0, h01(i, 9) * 6.28, 0); q.setFromEuler(e); mtx.compose(new THREE.Vector3(sp.x, heightAt(sp.x, sp.z) - 0.15, sp.z), q, new THREE.Vector3(sp.s, sp.s * (0.45 + h01(i, 11) * 0.25), sp.s * (0.8 + h01(i, 12) * 0.4))); inst.setMatrixAt(i, mtx); inst.setColorAt(i, col.setRGB(sp.c[0], sp.c[1], sp.c[2])); });
      inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere(); inst.name = 'far land: shrubs'; inst.castShadow = false; inst.receiveShadow = false;
      group.add(inst); stats.shrubs = spots.length; stats.tris += spots.length * 15; stats.draws++;
    }
  }
  // ---- the sea: one water polygon at its level (the panorama carries it on past the view's reach)
  if (sea) {
    const shape = new THREE.Shape(sea.poly.map(([x, z]) => new THREE.Vector2(x, z)));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(Math.PI / 2); geo.translate(0, sea.level, 0);
    const water = waterMesh(geo, waterMaterial({ color: sea.c, opacity: 0.86 }), 'far land: sea');
    group.add(water); stats.tris += geo.index ? geo.index.count / 3 : 0; stats.draws++;
  }
  group.userData.farLand = stats;
  disposeOnRemove(group);
  return group;
}
/** Split a straddling quad (a,c | d,e) into four and keep the parts outside the rectangle. */
function splitQuad(b: Buf, a: number, c: number, d: number, e: number, inside: (x: number, z: number) => boolean, depth: number) {
  const P = (k: number) => [b.pos[k * 3], b.pos[k * 3 + 1], b.pos[k * 3 + 2]] as const, C = (k: number): RGB => [b.col[k * 3], b.col[k * 3 + 1], b.col[k * 3 + 2]], D4 = (k: number) => b.det.slice(k * 4, k * 4 + 4);
  const lerpV = (k1: number, k2: number) => { const p1 = P(k1), p2 = P(k2), c1 = C(k1), c2 = C(k2), d1 = D4(k1), d2 = D4(k2); return b.v((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2, mix(c1, c2, 0.5), [0, 1, 2, 3].map((i) => (d1[i] + d2[i]) / 2) as Det); };
  const ac = lerpV(a, c), de = lerpV(d, e), ad = lerpV(a, d), ce = lerpV(c, e), mid = lerpV(ad, ce);
  for (const [p, q, r, s] of [[a, ac, ad, mid], [ac, c, mid, ce], [ad, mid, d, de], [mid, ce, de, e]] as [number, number, number, number][]) {
    const ins = [p, q, r, s].map((k) => inside(b.pos[k * 3], b.pos[k * 3 + 2]));
    if (ins.every((v) => !v)) b.quad(p, r, q, s);
    else if (ins.some((v) => !v) && depth > 1) splitQuad(b, p, q, r, s, inside, depth - 1);
  }
}
/** A wooden utility pole with a crossarm (20 tris), arm across the road. */
function pole(b: Buf, x: number, y: number, z: number, h: number, yaw: number, wood: RGB) {
  const r = 0.16, ring = (yy: number, rr: number) => [0, 1, 2, 3].map((k) => { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; return b.v(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, wood); });
  const lo = ring(y - 0.3, r), hi = ring(y + h, r * 0.75);
  for (let k = 0; k < 4; k++) b.quad(lo[k], lo[(k + 1) % 4], hi[k], hi[(k + 1) % 4]);
  b.idx.push(hi[0], hi[2], hi[1], hi[0], hi[3], hi[2]);
  const ca = Math.cos(yaw), sa = Math.sin(yaw), ay = y + h - 0.55, L = 1.25, t = 0.07;
  const v = (u: number, dy: number, w: number) => b.v(x + ca * u - sa * w, ay + dy, z + sa * u + ca * w, mul(wood, 0.85));
  const box = [v(-L, -t, -t), v(L, -t, -t), v(-L, t, -t), v(L, t, -t), v(-L, -t, t), v(L, -t, t), v(-L, t, t), v(L, t, t)];
  b.quad(box[0], box[1], box[2], box[3]); b.quad(box[5], box[4], box[7], box[6]); b.quad(box[2], box[3], box[6], box[7]); b.quad(box[4], box[5], box[0], box[1]);
}
let shrubGeo: THREE.BufferGeometry | null = null;
/** A low dome (15 tris): five sides and a five-sided cap, unit radius, unit height. */
function shrubGeometry(): THREE.BufferGeometry {
  if (shrubGeo) return shrubGeo;
  const pos: number[] = [], P = (a: number, r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * Math.PI * 2, a1 = ((k + 1) / 5) * Math.PI * 2;
    const b0 = P(a0, 1, 0), b1 = P(a1, 1, 0), t0 = P(a0 + 0.3, 0.7, 0.6), t1 = P(a1 + 0.3, 0.7, 0.6);
    pos.push(...b0, ...t0, ...b1, ...b1, ...t0, ...t1, ...t0, ...[0, 1, 0], ...t1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return (shrubGeo = g);
}

// ---------------------------------------------------------------- panorama/1
const PANO_VERT = /* glsl */`
attribute vec3 color;
attribute vec3 far;       // x: distance (m; < 0 = skirt row: fraction of the horizon distance), y: haze multiplier, z: depth layer
uniform float uBase, uK, uSkirtMin;
varying vec3 vColor;
varying float vD, vHz, vW;
void main(){
  // orthographic views (maps) draw no panorama
  if (projectionMatrix[2][3] == 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float camH = max(cameraPosition.y - uBase, 0.5);
  float dHz = sqrt(camH / uK);                       // distance to the horizon of a smooth earth
  float D = far.x < 0.0 ? max(uSkirtMin, -far.x * dHz) : far.x;
  float hr = position.y - D * D * uK;                 // height on the curved earth (refraction folded into uK)
  float e = (hr - camH) / D;                          // tan of the elevation angle
  if (far.x > 0.0 && D > dHz) e = max(e, -2.0 * sqrt(camH * uK));   // beyond the horizon: only what rises above it
  float m22 = projectionMatrix[2][2], m32 = projectionMatrix[3][2], farP = m32 / (m22 + 1.0), R = farP * 0.8;
  vec3 wp = cameraPosition + vec3(position.x * R, e * R, position.z * R);
  vec4 p = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  // a fixed depth just in front of the sky dome (ndc 0.99999), nearer ranges a hair in front of farther ones
  float Pd = farP * 0.88, zn = (m22 * -Pd + m32) / Pd - max(far.z, 0.0) * 4.0e-7;
  p.z = zn * p.w;
  gl_Position = p;
  vColor = color; vD = D; vHz = far.y; vW = far.z < 0.0 ? -far.z - 0.5 : 1.0;
}`;
const PANO_FRAG = /* glsl */`
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 uHaze;
uniform float uVis, uLight, uNearCap;
uniform vec3 uGroundLit;
varying vec3 vColor;
varying float vD, vHz, vW;
${GRADE_PARS}
void main(){
  // ground in the skirt is lit like the far land (sun and sky light on a level surface); water and ranges follow the sky
  vec3 c = vColor * mix(uGroundLit, vec3(uLight), clamp(vW, 0.0, 1.0));
  // the long-range haze, then the scene's own air (the same exp² fog as every lit thing, up to the view's reach)
  float farF = (1.0 - exp(-vD / uVis)) * vHz;
  c = mix(c, uHaze * uLight, clamp(farF, 0.0, 0.94));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  // three mixes fog after the output conversion (fog_fragment follows colorspace_fragment): do the same, so the
  // panorama's foot and the far land meet in one colour
  float fd = fogDensity * min(vD, uNearCap);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - exp(-fd * fd));
  ${GRADE_GLSL}
}`;
type Range = { from: number; to: number; d: number; h: number; rough: number; c: RGB; c2: RGB | null; bands: number; haze: number; seed: number; profile: number[] | null; foot: number };
const DEG = Math.PI / 180;
const tmpV = new THREE.Vector3();
function buildPanorama(ctx: MeshCtx): THREE.Object3D | null {
  const P = ctx.params, m = ctx.model, seed = (ctx.entity.seed ?? 0) | 0;
  const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const given: Range[] = (Array.isArray(P.ranges) ? P.ranges : []).flatMap((r, i) => {
    const o = r as Record<string, unknown>; const from = num(o.from, 0); let to = num(o.to, from + 30); while (to <= from) to += 360;
    return [{ from, to, d: Math.max(2500, num(o.d, 15000)), h: Math.max(1, num(o.h, 500)), rough: Math.max(0, Math.min(1, num(o.rough, 0.5))), c: rgb(isHex(o.c) ? o.c : '#7d7a86'), c2: isHex(o.c2) ? rgb(o.c2) : null, bands: num(o.bands, 0.35), haze: Math.max(0, num(o.haze, 1)), seed: num(o.seed, seed + i * 17) | 0, profile: Array.isArray(o.profile) ? (o.profile as unknown[]).map((v) => Math.max(0, Math.min(1.5, num(v, 0.5)))) : null, foot: Math.max(0, Math.min(1, num(o.foothills, 0.5))) }];
  });
  // foothills: a lower, nearer front range under each range (`foothills` 0 = none), darker, its own ridges
  const ranges: (Range & { front?: boolean })[] = [...given];
  for (const r of given) if (r.foot > 0) ranges.push({ ...r, d: r.d * 0.72, h: r.h * 0.42 * r.foot * 0.72, c: mul(r.c, 0.86), c2: r.c2 ? mul(r.c2, 0.86) : null, seed: r.seed + 999, profile: null, rough: Math.min(1, r.rough + 0.2), front: true });
  ranges.sort((a, b) => b.d - a.d);   // far first; each nearer range a depth layer in front
  const wo = P.water as Record<string, unknown> | null | undefined;
  const water = wo ? { from: num(wo.from, 135), to: num(wo.to, 225), c: rgb(isHex(wo.c) ? wo.c : '#5d93b8'), far: rgb(isHex(wo.far) ? wo.far : '#a9c7dc') } : null;
  if (water) while (water.to <= water.from) water.to += 360;
  const tcol = new THREE.Color(); terrainColorFor((m.state as { ground?: { palette?: string } }).ground?.palette)(tcol, m.constants.base, 0, m.constants.base, 0, 0);
  const ground: RGB = isHex(P.ground) ? rgb(P.ground) : [tcol.r, tcol.g, tcol.b];   // default: the terrain palette's plain
  const pos: number[] = [], col: number[] = [], far: number[] = [];
  const dir = (b: number): [number, number] => [Math.sin(b * DEG), -Math.cos(b * DEG)];
  const vert = (b: number, y: number, c: RGB, D: number, hz: number, layer: number) => { const [dx, dz] = dir(b); pos.push(dx, y, dz); col.push(c[0], c[1], c[2]); far.push(D, hz, layer); };
  // ---- skirt below the horizon (layer 0): ground or water per bearing, rows by fraction of the horizon distance
  const inWater = (b: number) => { if (!water) return 0; let x = b; while (x < water.from) x += 360; const t = x - water.from, span = water.to - water.from; return t > span ? 0 : sstep(0, 2.5, t) * sstep(0, 2.5, span - t); };
  const ROWS = [1, 0.62, 0.34, 0.16, 0.06, 0];
  const corner = (b: number, f: number): [RGB, number, number] => { const w = inWater(b), wc = mix(water?.c ?? ground, water?.far ?? ground, Math.pow(f, 0.6)), gc = mul(ground, 0.97 + 0.06 * vn1(b / 7, seed)); return [mix(gc, wc, w), -(f || 0.0001), -(0.5 + w)]; };
  for (let s = 0; s < 360; s += 1) {
    const b0 = s, b1 = s + 1;
    for (let r = 1; r < ROWS.length; r++) {
      const [cA, fA, wA] = corner(b0, ROWS[r - 1]), [cB, fB, wB] = corner(b1, ROWS[r - 1]), [cC, fC, wC] = corner(b0, ROWS[r]), [cD, fD, wD] = corner(b1, ROWS[r]);
      vert(b0, 0, cA, fA, 1, wA); vert(b0, 0, cC, fC, 1, wC); vert(b1, 0, cB, fB, 1, wB);
      vert(b1, 0, cB, fB, 1, wB); vert(b0, 0, cC, fC, 1, wC); vert(b1, 0, cD, fD, 1, wD);
    }
  }
  // ---- ranges: rows foot → crest of flat-shaded facets. For shading only, each row sits nearer the eye the lower it is
  // (slopes ~25°) and spurs/gullies push it in and out, so facets tilt like real mountainsides; lit by a high sun from the SSW.
  const L = new THREE.Vector3(-0.32, 0.77, 0.56).normalize(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), E1 = new THREE.Vector3();
  const FR = [0, 0.22, 0.45, 0.7, 1];
  ranges.forEach((r, li) => {
    const layer = li + 1, span = r.to - r.from, ang = (2200 / r.d) / DEG;   // a ridge every ~2.2 km, as an angle
    const n = Math.max(8, Math.ceil(span / 0.3)), bAt = (i: number) => r.from + (span * i) / n;
    const height = (b: number) => {
      // clamp: facet jitter can push a bearing just past either end, where a profile lookup would read outside its array (NaN facets)
      const t = Math.max(0, Math.min(1, (b - r.from) / span)), env = sstep(0, 0.06, t) * sstep(0, 0.06, 1 - t);
      let prof: number;
      if (r.profile && r.profile.length > 1) { const u = t * (r.profile.length - 1), k = Math.min(r.profile.length - 2, Math.floor(u)); prof = r.profile[k] + (r.profile[k + 1] - r.profile[k]) * (u - k); }
      else prof = 0.5 + 0.5 * vn1(b / (ang * 3), r.seed);
      let ridge = 0, amp = 0.5, f = 1, sum = 0;
      for (let o = 0; o < 6; o++) { ridge += Math.pow(1 - Math.abs(vn1((b / ang) * f, r.seed + o * 3) * 2 - 1), 1.6) * amp; sum += amp; amp *= 0.55; f *= 2.05; }
      return r.h * env * prof * Math.max(0.05, 1 - r.rough + r.rough * ((ridge / sum) * 1.7 - 0.3));
    };
    const grid: { b: number; y: number; rr: number }[][] = [];
    for (let i = 0; i <= n; i++) {
      const b = bAt(i), h = height(b), spur = (vn1((b / ang) * 5.3, r.seed + 41) - 0.5) * 1.4;
      grid.push(FR.map((f, k) => {
        const mid = k > 0 && k < FR.length - 1, jb = mid ? (h01(i, k, r.seed) - 0.5) * (span / n) * 0.8 : 0, jh = mid ? (h01(i, k + 7, r.seed) - 0.5) * 0.14 : 0;
        const y = k === 0 ? 0 : Math.max(0, height(b + jb) * Math.max(0, f + jh));
        return { b: b + jb, y, rr: r.d - (1 - Math.max(0, f)) * 2.1 * Math.max(h, 1) + spur * h * (mid ? 0.6 : 0.2) };
      }));
    }
    const P3 = (g: { b: number; y: number; rr: number }, out: THREE.Vector3) => { const [dx, dz] = dir(g.b); return out.set(dx * g.rr, g.y, dz * g.rr); };
    const hzOf = (k: number) => [1.15, 1.05, 1.0, 0.94, 0.88][k] * r.haze;
    const strata = (y: number, b: number) => r.c2 ? sstep(0.15, 0.85, 0.5 + 0.5 * Math.sin((y / Math.max(30, r.h * 0.11)) * 6.283 + vn1(b / (ang * 0.7), r.seed + 5) * 4)) * r.bands : 0;
    const facet = (a: { b: number; y: number; rr: number }, b2: { b: number; y: number; rr: number }, c: { b: number; y: number; rr: number }, ka: number, kb: number, kc: number) => {
      P3(a, A); P3(b2, B); P3(c, C); N.subVectors(B, A).cross(E1.subVectors(C, A)).normalize(); if (N.dot(A) > 0) N.negate();   // face the viewer
      const lit = 0.5 + 0.62 * Math.max(0, N.dot(L)) + 0.12 * Math.max(0, N.y), mb = (a.b + b2.b + c.b) / 3, my = (a.y + b2.y + c.y) / 3;
      const gully = 0.93 + 0.14 * vn1((mb / ang) * 7, r.seed + 11);
      let base = mix(r.c, mul(r.c, 1.15), Math.min(1, my / r.h));
      if (r.c2) base = mix(base, r.c2, strata(my, mb));
      const tone = (k: number): RGB => mul(base, lit * gully * (k === 0 ? 0.9 : 1));
      vert(a.b, a.y, tone(ka), r.d, hzOf(ka), layer); vert(b2.b, b2.y, tone(kb), r.d, hzOf(kb), layer); vert(c.b, c.y, tone(kc), r.d, hzOf(kc), layer);
    };
    for (let i = 0; i < n; i++) for (let k = 0; k < FR.length - 1; k++) {
      const a = grid[i][k], b2 = grid[i + 1][k], c = grid[i][k + 1], d = grid[i + 1][k + 1];
      facet(a, c, b2, k, k + 1, k); facet(b2, c, d, k, k + 1, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('far', new THREE.Float32BufferAttribute(far, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const haze = rgb(isHex(P.haze) ? P.haze : '#c6d6e2');
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uBase: { value: m.constants.base }, uK: { value: (1 - 0.13) / (2 * 6371000) }, uSkirtMin: { value: 600 }, uHaze: { value: new THREE.Color(...haze) }, uVis: { value: num(P.visibility, 70000) }, uLight: { value: 1 }, uNearCap: { value: 2100 }, uGroundLit: { value: new THREE.Color(1, 1, 1) } }]);
  (uniforms as Record<string, { value: unknown }>).uEdenGradeA = { value: GRADE_A }; (uniforms as Record<string, { value: unknown }>).uEdenGradeB = { value: GRADE_B };
  const mat = new THREE.ShaderMaterial({ vertexShader: PANO_VERT, fragmentShader: PANO_FRAG, uniforms, fog: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'panorama'; mesh.frustumCulled = false; mesh.renderOrder = 1e6 - 1; mesh.userData.cameraTransparent = true; mesh.raycast = () => {};
  mesh.castShadow = false; mesh.receiveShadow = false;
  // day and night: the panorama has no lights of its own; it follows the brightness of the sky colour (Daylight)
  const day = new THREE.Color('#a6bed0'), dayL = day.r * 0.2126 + day.g * 0.7152 + day.b * 0.0722;
  // level ground's light, as MeshStandardMaterial sees it (albedo/π × (sun·up + sky + ambient)); lights found once a second
  let lights: THREE.Light[] = [], found = -Infinity;
  const sun = new THREE.Vector3(), lit = uniforms.uGroundLit.value as THREE.Color, tmp = new THREE.Color();
  mesh.onBeforeRender = (_r, scene) => {
    const bg = scene.background as THREE.Color | null;
    const l = bg && (bg as THREE.Color).isColor ? (bg.r * 0.2126 + bg.g * 0.7152 + bg.b * 0.0722) / dayL : 1;
    uniforms.uLight.value = Math.max(0.05, Math.min(1.1, l));
    const now = performance.now();
    if (now - found > 1000) { found = now; lights = []; scene.traverse((o) => { const L = o as THREE.Light; if (L.isLight && L.visible) lights.push(L); }); }
    lit.setRGB(0, 0, 0);
    for (const L of lights) {
      if ((L as THREE.DirectionalLight).isDirectionalLight) { const d = L as THREE.DirectionalLight; sun.setFromMatrixPosition(d.matrixWorld).sub(tmpV.setFromMatrixPosition(d.target.matrixWorld)).normalize(); lit.add(tmp.copy(d.color).multiplyScalar(d.intensity * Math.max(0, sun.y))); }
      else if ((L as THREE.HemisphereLight).isHemisphereLight) lit.add(tmp.copy(L.color).multiplyScalar(L.intensity));
      else if ((L as THREE.AmbientLight).isAmbientLight) lit.add(tmp.copy(L.color).multiplyScalar(L.intensity));
    }
    if (!lights.length) lit.setRGB(Math.PI, Math.PI, Math.PI);
    lit.multiplyScalar(1 / Math.PI);
  };
  mesh.userData.panorama = { tris: pos.length / 9, ranges: ranges.length };
  const group = new THREE.Group(); group.name = 'panorama'; group.add(mesh); group.userData.cameraTransparent = true;
  group.addEventListener('removed', () => { g.dispose(); mat.dispose(); });
  return group;
}

registerMesh({ gen: 'far-land/1', world: true, build: buildFarLand });
registerMesh({ gen: 'panorama/1', world: true, build: buildPanorama });
