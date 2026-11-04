// Geometry kit for building/1's mesh half, ported from the Eden interiors kit
// (mars/viewer/app/engine-view/content/assets/eden-interiors/kit.ts): every part is accumulated as a
// flat-shaded, vertex-coloured triangle soup per (group, layer) and emitted as ONE mesh per pair, so a
// furnished storey costs a handful of draws. Groups are storeys ('level-0', 'level-1', …) and 'roof',
// so the interior view can hide the roof and the floors above the camera. Owner: L2.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MaterialLib } from './materials.ts';
import { applyBuildingFinish } from '../WorldEdenRealism.ts';
import { nightWindows } from './building-windows.ts';

/** wall: walls, partitions · floor: slabs, boards, decks · roof · trim: frames, sills, rails, details · glass · glow (lamps, lit lantern). */
export type Layer = 'wall' | 'floor' | 'roof' | 'trim' | 'glass' | 'glow';
export type Col = THREE.ColorRepresentation;
const tmpC = new THREE.Color();

const unit = new Map<string, THREE.BufferGeometry>();
function prim(key: string, make: () => THREE.BufferGeometry) {
  let g = unit.get(key);
  if (!g) { const made = make(); g = made.index ? made.toNonIndexed() : made; if (g !== made) made.dispose(); unit.set(key, g); }
  return g;
}

/** A growable float32 array: the values land rounded to float32 exactly as Float32BufferAttribute(number[]) rounds them. */
class F32 {
  a = new Float32Array(768); n = 0;
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3;
  }
  get length() { return this.n; }
  view() { return this.a.subarray(0, this.n); }
}
/** W2b: vertex ranges [from, to) of a buffer that are a building's outer face (its finish pattern goes there). */
type Buf = { p: F32; n: F32; c: F32; face?: number[]; pane?: Float32Array; topCeilingVertices?: number };
/** E2C: a glass buffer's per-vertex window pane (u, v metres from the pane's lower left, signed width (sign = which side of the
 *  face is outdoors, 0 = not a window pane), sill height above its storey floor), padded with zeros to the vertex count. */
function paneOf(b: Buf, verts: number): Float32Array {
  const need = verts * 4; let a = b.pane ?? new Float32Array(0);
  if (a.length < need) { const g = new Float32Array(Math.max(need, a.length * 2, 96)); g.set(a); a = g; }
  return (b.pane = a);
}
const paneView = (b: { p: F32; pane?: Float32Array }) => { const n = (b.p.length / 3) * 4, a = b.pane ?? new Float32Array(0); if (a.length >= n) return a.subarray(0, n); const g = new Float32Array(n); g.set(a); return g; };
/** Old Eden's building identity for one building: wall 0 running brick, 1 Flemish, 2 ashlar, 3 clapboard, 4 limewash;
 *  roof 0 clay tile, 1 slate, 2 shingle. */
export type Finish = { wall: number; roof: number };
const WALLS = ['running brick', 'Flemish brick', 'ashlar', 'clapboard', 'limewash'], ROOFS = ['clay tile', 'slate', 'shingle'];
/** One (group|layer) soup: positions, normals, colours (and W2b's outer-face vertex ranges). */
export type RawSoup = { k: string; p: Float32Array; n: Float32Array; c: Float32Array; face?: number[]; pane?: Float32Array; topCeilingVertices?: number };
export class Builder {
  readonly buf = new Map<string, Buf>();
  group = 'level-0';
  private enabled = true;
  /** Consume the same seeded detail choices while omitting an optional ornament's geometry. */
  optional(enabled: boolean, draw: () => void) { const was = this.enabled; this.enabled = was && enabled; try { draw(); } finally { this.enabled = was; } }
  /** W2: effect anchors (chimney smoke) in the builder's current frame; enabled ornaments only. */
  readonly anchors: [number, number, number][] = [];
  /** W2b: the building's finish (null = plain kit materials), and whether the parts drawn now are its outer face. */
  finish: Finish | null = null;
  facade = false;
  /** Draw `f` as the building's outer face (marked for the finish pattern; only the wall layer keeps the mark). */
  outer(f: () => void) { const was = this.facade; this.facade = true; try { f(); } finally { this.facade = was; } return this; }
  private mark(b: Buf, layer: Layer, from: number) { if (this.facade && layer === 'wall') { const to = b.p.length / 3, f = (b.face ??= []); if (f.length && f[f.length - 1] === from) f[f.length - 1] = to; else f.push(from, to); } }
  /** E2C: the window pane the next glass face() is (width, height, sill above the storey floor, outdoor side: +1 the face's
   *  front, -1 its back); null = plain glass. Read by the night-windows glass (rooms behind lit windows). */
  pane: { w: number; h: number; sill: number; out: number } | null = null;
  anchor(x: number, y: number, z: number) { if (this.enabled) { const v = new THREE.Vector3(x, y, z).applyMatrix4(this.m); this.anchors.push([v.x, v.y, v.z]); } }
  private m = new THREE.Matrix4(); private stack: THREE.Matrix4[] = [];
  private l = new THREE.Matrix4(); private nm = new THREE.Matrix3(); private v = new THREE.Vector3(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private t = new THREE.Vector3(); private e = new THREE.Euler();
  push(x: number, y: number, z: number, yaw = 0) { this.stack.push(this.m.clone()); this.m.multiply(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z)); return this; }
  pop() { this.m = this.stack.pop() ?? new THREE.Matrix4(); return this; }
  at(x: number, y: number, z: number, yaw: number, f: () => void) { this.push(x, y, z, yaw); try { f(); } finally { this.pop(); } return this; }
  private bufOf(layer: Layer) { const k = `${this.group}|${layer}`; let b = this.buf.get(k); if (!b) { b = { p: new F32(), n: new F32(), c: new F32() }; this.buf.set(k, b); } return b; }
  private add(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: Col, layer: Layer, rx = 0, ry = 0, rz = 0) {
    if (!this.enabled) return;
    this.q.setFromEuler(this.e.set(rx, ry, rz, 'YXZ')); this.l.compose(this.t.set(cx, cy, cz), this.q, this.s.set(sx, sy, sz)); this.l.premultiply(this.m); this.nm.getNormalMatrix(this.l);
    const b = this.bufOf(layer), P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute; tmpC.set(col);
    const from = b.p.length / 3;
    const cr = tmpC.r, cg = tmpC.g, cb = tmpC.b;
    if (P.normalized || N.normalized || P.itemSize !== 3 || N.itemSize !== 3 || (P as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || (N as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) {
      for (let i = 0; i < P.count; i++) {
        this.v.fromBufferAttribute(P, i).applyMatrix4(this.l); b.p.push3(this.v.x, this.v.y, this.v.z);
        this.v.fromBufferAttribute(N, i).applyMatrix3(this.nm).normalize(); b.n.push3(this.v.x, this.v.y, this.v.z); b.c.push3(cr, cg, cb);
      }
      this.mark(b, layer, from);
      return;
    }
    // Vector3.fromBufferAttribute + applyMatrix4 / applyMatrix3 + normalize, inlined term for term (same operations, same order)
    const pa = P.array, na = N.array, e = this.l.elements, m = this.nm.elements;
    for (let i = 0, o = 0; i < P.count; i++, o += 3) {
      const x = pa[o], y = pa[o + 1], z = pa[o + 2], w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      b.p.push3((e[0] * x + e[4] * y + e[8] * z + e[12]) * w, (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, (e[2] * x + e[6] * y + e[10] * z + e[14]) * w);
      const u = na[o], v = na[o + 1], t = na[o + 2];
      const nx = m[0] * u + m[3] * v + m[6] * t, ny = m[1] * u + m[4] * v + m[7] * t, nz = m[2] * u + m[5] * v + m[8] * t;
      const k = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      b.n.push3(nx * k, ny * k, nz * k); b.c.push3(cr, cg, cb);
    }
    this.mark(b, layer, from);
  }
  /** Box by its bottom-centre (x, y = bottom, z), size and yaw. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'trim', yaw = 0) { if (w > 1e-4 && h > 1e-4 && d > 1e-4) this.add(prim('box', () => new THREE.BoxGeometry(1, 1, 1)), x, y + h / 2, z, w, h, d, col, layer, 0, yaw, 0); return this; }
  /** Chamfered box: an octagonal prism scaled to the box (the Eden look for posts and newels, 32 tris). */
  rbox(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'trim', yaw = 0) { if (w > 1e-4 && h > 1e-4 && d > 1e-4) this.add(prim('oct', () => new THREE.CylinderGeometry(0.5 / Math.cos(Math.PI / 8), 0.5 / Math.cos(Math.PI / 8), 1, 8).rotateY(Math.PI / 8)), x, y + h / 2, z, w, h, d, col, layer, 0, yaw, 0); return this; }
  /** Rounded box with real fillets (108 tris): use sparingly. */
  roundBox(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'trim', yaw = 0) { if (w > 1e-4 && h > 1e-4 && d > 1e-4) this.add(prim('rbox', () => new RoundedBoxGeometry(1, 1, 1, 1, 0.18)), x, y + h / 2, z, w, h, d, col, layer, 0, yaw, 0); return this; }
  /** One planar quad (a, b, c, d counter-clockwise seen from its front) under the current transform; 2 tris, no geometry allocation. */
  face(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, d: THREE.Vector3Tuple, col: Col, layer: Layer = 'wall') {
    if (!this.enabled) return this;
    const buf = this.bufOf(layer); tmpC.set(col);
    // Vector3.applyMatrix4 on each corner, then subVectors/cross/normalize for the normal, inlined term for term
    const e = this.m.elements, X: number[] = [], Y: number[] = [], Z: number[] = [];
    for (const p of [a, b, c, d]) {
      const x = p[0], y = p[1], z = p[2], w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      X.push((e[0] * x + e[4] * y + e[8] * z + e[12]) * w); Y.push((e[1] * x + e[5] * y + e[9] * z + e[13]) * w); Z.push((e[2] * x + e[6] * y + e[10] * z + e[14]) * w);
    }
    const ax = X[1] - X[0], ay = Y[1] - Y[0], az = Z[1] - Z[0], bx = X[2] - X[0], by = Y[2] - Y[0], bz = Z[2] - Z[0];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, k = 1 / (Math.sqrt(cx * cx + cy * cy + cz * cz) || 1);
    const nx = cx * k, ny = cy * k, nz = cz * k, cr = tmpC.r, cg = tmpC.g, cb = tmpC.b;
    const from = buf.p.length / 3;
    for (const i of [0, 1, 2, 0, 2, 3]) { buf.p.push3(X[i], Y[i], Z[i]); buf.n.push3(nx, ny, nz); buf.c.push3(cr, cg, cb); }
    this.mark(buf, layer, from);
    if (layer === 'glass' && this.pane) {
      // corners a, b, c, d = lower left, lower right, upper right, upper left of the pane seen from the face's front
      const P = this.pane, a = paneOf(buf, from + 6), U = [0, P.w, P.w, 0], V = [0, 0, P.h, P.h], sw = P.w * (P.out < 0 ? -1 : 1);
      [0, 1, 2, 0, 2, 3].forEach((i, k) => { a.set([U[i], V[i], sw, P.sill], (from + k) * 4); });
    }
    return this;
  }
  /**
   * A wall slab in a local frame (x along the wall, y up, z across): faces only where they can be seen —
   * both sides, the top and bottom when asked, the ends when they frame an opening (≈ 6–10 tris instead of 24).
   */
  wallSlab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, plus: Col, minus: Col, opts: { top?: Col; bottom?: Col; ends?: Col; endL?: boolean; endR?: boolean; /** W2b: which side is the outer face (1 plus, -1 minus); its reveals go with it */ outer?: number } = {}, layer: Layer = 'wall') {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return this;
    const out = opts.outer ?? 0, was = this.facade;
    this.facade = was || out > 0; this.face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], plus, layer);
    this.facade = was || out < 0; this.face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], minus, layer);
    this.facade = was || out !== 0;
    if (opts.top) this.face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], opts.top, layer);
    if (opts.bottom) this.face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], opts.bottom, layer);
    if (opts.endL && opts.ends) this.face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], opts.ends, layer);
    if (opts.endR && opts.ends) this.face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], opts.ends, layer);
    this.facade = was;
    return this;
  }
  /** Box between two plan points (a wall run, a rail): from (ax, az) to (bx, bz), bottom y, height h, thickness d. */
  run(ax: number, az: number, bx: number, bz: number, y: number, h: number, d: number, col: Col, layer: Layer = 'trim') {
    const len = Math.hypot(bx - ax, bz - az); if (len < 1e-4) return this;
    return this.box((ax + bx) / 2, y, (az + bz) / 2, len, h, d, col, layer, Math.atan2(-(bz - az), bx - ax));
  }
  /** Tilted box: centre, size and Euler (YXZ: yaw, pitch, roll). */
  tilt(x: number, y: number, z: number, w: number, h: number, d: number, rx: number, rz: number, col: Col, layer: Layer = 'trim', ry = 0) { this.add(prim('box', () => new THREE.BoxGeometry(1, 1, 1)), x, y, z, w, h, d, col, layer, rx, ry, rz); return this; }
  /** Vertical cylinder (bottom at y); rTop ≠ rBot gives a frustum. */
  cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, col: Col, layer: Layer = 'trim', seg = 8) { const r = Math.max(rTop, rBot, 1e-4); this.add(prim(`cyl${seg}:${(rTop / r).toFixed(3)}:${(rBot / r).toFixed(3)}`, () => new THREE.CylinderGeometry(rTop / r, rBot / r, 1, seg)), x, y + h / 2, z, r, h, r, col, layer); return this; }
  /** Horizontal cylinder along local X (ridges, logs). */
  cylX(x: number, y: number, z: number, r: number, len: number, col: Col, layer: Layer = 'trim', seg = 8, yaw = 0) { this.add(prim(`cylx${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg).rotateZ(Math.PI / 2)), x, y, z, len, r, r, col, layer, 0, yaw, 0); return this; }
  /** Low-poly ball. */
  ball(x: number, y: number, z: number, rx: number, ry: number, rz: number, col: Col, layer: Layer = 'trim') { this.add(prim('ico0', () => new THREE.IcosahedronGeometry(1, 0)), x, y, z, rx, ry, rz, col, layer); return this; }
  /** Cone (bottom at y). */
  cone(x: number, y: number, z: number, r: number, h: number, col: Col, layer: Layer = 'roof', seg = 12) { this.add(prim(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)), x, y + h / 2, z, r, h, r, col, layer); return this; }
  /** Dome (upper hemisphere), base at y. */
  dome(x: number, y: number, z: number, r: number, h: number, col: Col, layer: Layer = 'roof', seg = 12) { this.add(prim(`dome${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(3, seg / 3), 0, Math.PI * 2, 0, Math.PI / 2)), x, y, z, r, h, r, col, layer); return this; }
  /** Triangular prism along local Z: width w (x), ridge height h, length d, bottom at y. */
  prism(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'roof', yaw = 0) {
    this.add(prim('prism', () => { const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]); const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g; }), x, y, z, w, h, d, col, layer, 0, yaw, 0); return this;
  }
  /** A flat polygon slab (plan polygon, bottom y, thickness h). */
  slab(poly: [number, number][], y: number, h: number, col: Col, layer: Layer = 'floor') {
    if (poly.length < 3) return this;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g0 = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); g0.rotateX(-Math.PI / 2); g0.translate(0, y, 0);
    const g = g0.index ? g0.toNonIndexed() : g0; if (g !== g0) g0.dispose(); g.computeVertexNormals();
    this.add(g, 0, 0, 0, 1, 1, 1, col, layer); g.dispose(); return this;
  }
  /** Raw triangle (world-of-builder coordinates under the current transform). */
  tri(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, col: Col, layer: Layer = 'roof') {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3)); g.computeVertexNormals();
    this.add(g, 0, 0, 0, 1, 1, 1, col, layer); g.dispose(); return this;
  }
  quad(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, d: THREE.Vector3Tuple, col: Col, layer: Layer = 'roof') { this.tri(a, b, c, col, layer); this.tri(a, c, d, col, layer); return this; }
  /** Called only at the generator's final ceiling slab emission. Later geometry
   * appended to this soup invalidates the whole-soup classification. */
  markTopCeiling() { const b = this.buf.get(`${this.group}|wall`); if (b) b.topCeilingVertices = b.p.length / 3; }
  tris(): number { let n = 0; for (const b of this.buf.values()) n += b.p.length / 9; return n; }
  /** Lane W1: the accumulated soups as plain arrays (to cross to or from a worker), in the order emit takes them. */
  raw(): RawSoup[] { return [...this.buf].map(([k, b]) => ({ k, p: b.p.view().slice(), n: b.n.view().slice(), c: b.c.view().slice(), ...(b.face ? { face: b.face.slice() } : {}), ...(b.pane ? { pane: paneView(b).slice() } : {}), ...(b.topCeilingVertices !== undefined ? { topCeilingVertices: b.topCeilingVertices } : {}) })); }
  /** A builder holding soups made elsewhere (raw()), ready to emit exactly as the builder that made them would. */
  static fromRaw(raw: readonly RawSoup[]): Builder {
    const b = new Builder(), f = (a: Float32Array) => { const x = new F32(); x.a = a as Float32Array<ArrayBuffer>; x.n = a.length; return x; };
    for (const r of raw) b.buf.set(r.k, { p: f(r.p), n: f(r.n), c: f(r.c), ...(r.face ? { face: r.face.slice() } : {}), ...(r.pane ? { pane: r.pane.slice() } : {}), ...(r.topCeilingVertices !== undefined ? { topCeilingVertices: r.topCeilingVertices } : {}) });
    return b;
  }
  /** One mesh per (group, layer) under one THREE.Group per group. */
  emit(materials: MaterialLib): { groups: Map<string, THREE.Group>; draws: number; tris: number } {
    const groups = new Map<string, THREE.Group>(); let draws = 0, tris = 0;
    for (const [k, b] of this.buf) {
      if (!b.p.length) continue;
      const [gname, layer] = k.split('|') as [string, Layer];
      const face = b.face && this.finish ? b.face : null, pane = b.pane && layer === 'glass' ? paneView(b) : null;
      const g = sharedGeometry(soupKey(b, face, pane), () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.p.view(), 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n.view(), 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(b.c.view(), 3));
        if (face) { const f = new Float32Array(b.p.length / 3); for (let i = 0; i < face.length; i += 2) f.fill(1, face[i], face[i + 1]); g.setAttribute('edenFace', new THREE.Float32BufferAttribute(f, 1)); }
        if (pane) g.setAttribute('edenPane', new THREE.Float32BufferAttribute(pane, 4));
        g.computeBoundingBox(); g.computeBoundingSphere();
        return g;
      });
      const mesh = new THREE.Mesh(g, materialFor(materials, layer, this.finish)); mesh.name = `${gname} ${layer}`;
      // Structural evidence comes from the builder layer, never a display-name guess.
      // Wall soups combine interior and exterior surfaces, so conservatively protect all facades.
      if (b.topCeilingVertices === b.p.length / 3) mesh.userData.contextStructure = { classification: 'roof', assembly: 'top-ceiling', exteriorFacade: false };
      else if (layer === 'roof' || layer === 'wall') mesh.userData.contextStructure = { classification: layer, exteriorFacade: layer === 'wall' };
      mesh.castShadow = layer !== 'glow' && layer !== 'glass'; mesh.receiveShadow = layer !== 'glow';
      if (layer === 'glass' || layer === 'glow') mesh.userData.cameraTransparent = true;
      let grp = groups.get(gname); if (!grp) { grp = new THREE.Group(); grp.name = gname; groups.set(gname, grp); }
      grp.add(mesh); draws++; tris += b.p.length / 9;
    }
    this.buf.clear();
    return { groups, draws, tris };
  }
}

// Lane PERF-MATERIALS: one BufferGeometry per distinct soup, whatever building emitted it. Templates are per (def,
// params, paint), but their ornaments (chimneys, shutters, steps, sills) and plain storeys repeat across templates byte
// for byte: Eden 2026's 239 buildings held 3,906 geometries of 2,046 distinct contents. The key is the vertex data itself
// (two 32-bit FNV-1a hashes over the float bits, with the lengths), so a hit is the same picture. Past the cap the
// oldest geometry is released; a mesh still drawing it uploads it again (three re-creates disposed buffers), the same
// self-healing the template cap relied on.
export const SHARED_GEOMETRY_CAP = 4096;
const sharedGeometries = new Map<string, THREE.BufferGeometry>();
function fnv(h: number, a: Float32Array): number {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
  for (let i = 0; i < u.length; i++) { const x = u[i]; h = Math.imul(h ^ (x & 0xffff), 16777619); h = Math.imul(h ^ (x >>> 16), 16777619); }
  return h >>> 0;
}
function soupKey(b: Buf, face: number[] | null, pane: Float32Array | null): string {
  const p = b.p.view(), n = b.n.view(), c = b.c.view();
  let h1 = fnv(fnv(fnv(2166136261, p), n), c), h2 = fnv(fnv(fnv(0x811c9dc5 ^ 0x5bd1e995, c), n), p);
  if (face) for (const f of face) { h1 = Math.imul(h1 ^ f, 16777619) >>> 0; h2 = Math.imul(h2 ^ (f + 7), 16777619) >>> 0; }
  if (pane) { h1 = fnv(h1, pane); h2 = fnv(h2 ^ 0x9e3779b9, pane); }
  return `${p.length}|${face ? face.length : '-'}|${pane ? pane.length : '-'}|${h1.toString(16)}|${h2.toString(16)}`;
}
function sharedGeometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = sharedGeometries.get(key);
  if (g) { sharedGeometries.delete(key); sharedGeometries.set(key, g); return g; }   // most recent last
  g = make(); g.userData.sharedKey = key; sharedGeometries.set(key, g);
  if (sharedGeometries.size > SHARED_GEOMETRY_CAP) { const [k, old] = sharedGeometries.entries().next().value!; sharedGeometries.delete(k); old.dispose(); }
  return g;
}
/** Shared building geometries held (tests and probes). */
export const sharedGeometryCount = () => sharedGeometries.size;

let glow: THREE.Material | null = null;
const realismOff = typeof location !== 'undefined' && new URLSearchParams(location.search).get('realism') === '0';
/** W2b: with a finish, walls, roofs and floors take old Eden's building identity (WorldEdenRealism role 7): one cached
 *  material per wall pattern and per roof pattern (same program), so a building's finish costs no extra draws. */
function finished(lib: MaterialLib, kind: 'plaster' | 'tile' | 'wood', layer: 'wall' | 'roof' | 'floor', finish: Finish | null) {
  if (!finish || realismOff) return lib.get(kind, undefined, { vertexColors: true });
  const m = lib.get(kind, undefined, { vertexColors: true, buildingFinish: layer === 'wall' ? `wall-${finish.wall}` : layer === 'roof' ? `roof-${finish.roof}` : 'floor' });
  if (!m.name) m.name = layer === 'wall' ? `building wall ${WALLS[finish.wall]}` : layer === 'roof' ? `building roof ${ROOFS[finish.roof]}` : 'building floor';
  applyBuildingFinish(m, layer, finish); return m;
}
function materialFor(lib: MaterialLib, layer: Layer, finish: Finish | null): THREE.Material {
  switch (layer) {
    case 'wall': return finished(lib, 'plaster', 'wall', finish);
    case 'floor': return finished(lib, 'wood', 'floor', finish);
    case 'roof': return finished(lib, 'tile', 'roof', finish);
    case 'trim': return lib.get('paint', undefined, { vertexColors: true });
    case 'glass': return nightWindows(lib.get('glass', undefined, { vertexColors: true, side: THREE.DoubleSide, buildingFinish: 'night-windows' }));
    case 'glow': return (glow ??= new THREE.MeshBasicMaterial({ vertexColors: true }));
  }
}

/** Deterministic PRNG (seeded per entity) for shutters, flowers, ivy. */
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0; s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0; s = (s ^ (s >>> 16)) >>> 0; return s / 4294967296; }; }
export function hashStr(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }
/** Mix a hex colour toward another (0..1). */
export function mix(a: string, b: string, t: number): string { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }
