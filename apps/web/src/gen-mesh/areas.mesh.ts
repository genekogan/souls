// plaza/1, lawn/1, pitch/1, parking/1, garden-bed/1 mesh halves: draped on the ground with an
// interior grid (follows hills, not a boundary fan), patterns and markings in vertex colours.
// Owner: L3. Lift order (surface priority): road 0.05–0.09 > plaza 0.06 > pitch 0.04 > lawn 0.02.
import { areaFrame } from '@souls/generators';
import * as THREE from 'three';
import { registerMesh, type MeshCtx } from './registry.ts';
import { groundBaseFor, groundRealismFor } from './ground-palette.ts';
import { applyWorldRealism, applyMownTurf } from '../WorldEdenRealism.ts';
import { Soup, distEdge, drapeArea, h01, hf, inPoly, mix, rgb, scale, soupMesh, type RGB, type V3 } from './soup.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const areaOf = (ctx: MeshCtx) => (ctx.entity.shape && 'area' in ctx.entity.shape ? (ctx.entity.shape.area as [number, number][]) : null);
const G = (ctx: MeshCtx) => (x: number, z: number) => ctx.model.terrain.sample(x, z);

// ---------- plaza ----------
const PAVE: Record<string, string> = { cobble: '#a69d8e', stone: '#c2baa9', tile: '#c48a6a', brick: '#a65a43', gravel: '#b5ad9c', asphalt: '#55585c' };
registerMesh({
  gen: 'plaza/1', world: true,
  build(ctx) {
    const poly = areaOf(ctx); if (!poly) return null;
    const mat = String(ctx.params.material ?? 'cobble'), pattern = String(ctx.params.pattern ?? 'grid'), unit = num(ctx.params.size, mat === 'brick' ? 0.4 : 0.8);
    const base = rgb(typeof ctx.params.color === 'string' && ctx.params.color !== '#b9b2a4' ? ctx.params.color : PAVE[mat] ?? PAVE.cobble);
    const grout = scale(base, 0.62), g = G(ctx), soup = new Soup(), fr = areaFrame(poly);
    drapeArea(soup, poly, 2, g, 0.05, () => grout);
    const V = (x: number, z: number, lift = 0.075): V3 => [x, g(x, z) + lift, z];
    const L = (a: number, b: number): [number, number] => [fr.c[0] + fr.u[0] * a + fr.v[0] * b, fr.c[1] + fr.u[1] * a + fr.v[1] * b];
    const stone = (pts: [number, number][], k1: number, k2: number, f = 1) => {
      const m = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length] as [number, number], [0, 0] as [number, number]);
      if (!pts.every(([x, z]) => inPoly(x, z, poly))) return;
      const c = scale(base, (0.84 + h01(k1, k2, 9) * 0.26) * f);
      if (pts.length === 4) soup.topQuad(V(...pts[0]), V(...pts[1]), V(...pts[2]), V(...pts[3]), c); else for (let i = 1; i < pts.length - 1; i++) soup.tri(V(...pts[0]), V(...pts[i + 1]), V(...pts[i]), c);
      void m;
    };
    const gap = Math.max(0.03, unit * 0.06);
    if (pattern === 'grid' || pattern === 'plain') {
      const u = pattern === 'plain' ? Math.max(unit, 2) : unit;
      for (let a = -fr.hl; a < fr.hl; a += u) for (let b = -fr.hw; b < fr.hw; b += u) {
        const i = Math.round(a / u), j = Math.round(b / u), a1 = Math.min(fr.hl, a + u) - gap, b1 = Math.min(fr.hw, b + u) - gap;
        stone([L(a, b), L(a1, b), L(a1, b1), L(a, b1)], i, j, (i + j) % 7 === 0 && pattern === 'grid' ? 0.88 : 1);
      }
    } else if (pattern === 'herringbone') {
      const s = unit / 2, lng = unit; // bricks s × 2s laid at alternating 90°
      for (let a = -fr.hl - lng; a < fr.hl; a += s) for (let b = -fr.hw - lng; b < fr.hw; b += lng) {
        const i = Math.round(a / s), j = Math.round(b / lng), off = (i % 2) * s;
        const horiz = (i + j) % 2 === 0;
        const a0 = a, b0 = b + off + (horiz ? 0 : s);
        const r = horiz ? [L(a0, b0), L(a0 + lng - gap, b0), L(a0 + lng - gap, b0 + s - gap), L(a0, b0 + s - gap)] : [L(a0, b0), L(a0 + s - gap, b0), L(a0 + s - gap, b0 + lng - gap), L(a0, b0 + lng - gap)];
        stone(r as [number, number][], i, j);
      }
    } else if (pattern === 'radial') {
      const R = Math.hypot(fr.hl, fr.hw);
      // a rosette at the centre, then rings of setts
      for (let ring = 0; ring * unit < R; ring++) {
        const r0 = ring * unit, r1 = r0 + unit - gap, n = Math.max(6, Math.round((2 * Math.PI * (r0 + unit / 2)) / unit));
        for (let k = 0; k < n; k++) {
          const t0 = (k / n) * Math.PI * 2 + (ring % 2) * (Math.PI / n), t1 = t0 + (Math.PI * 2) / n - gap / Math.max(0.5, r1);
          const P = (r: number, t: number): [number, number] => [fr.c[0] + Math.cos(t) * r, fr.c[1] + Math.sin(t) * r];
          stone(ring === 0 ? [P(0, 0), P(r1, t0), P(r1, t1)] : [P(r0, t0), P(r1, t0), P(r1, t1), P(r0, t1)], ring, k, ring % 4 === 0 ? 0.82 : 1);
        }
      }
    }
    // kerb: a chamfered stone edge along the outline
    if (ctx.params.kerb !== false) {
      const kerb = rgb('#cfc8b8');
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 1));
        for (let k = 0; k < n; k++) { const p0 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], p1 = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n]; soup.beam([p0[0], g(p0[0], p0[1]) - 0.05, p0[1]], [p1[0], g(p1[0], p1[1]) - 0.05, p1[1]], 0.22, 0.2, scale(kerb, 0.94 + h01(i, k) * 0.1), 0.05); }
      }
    }
    const m = soupMesh(soup, `plaza ${ctx.entity.name ?? ctx.entity.id}`, { shadow: false }); if (m) m.userData.tris = soup.tris; return m;
  },
});

// ---------- lawn / ground paint ----------
const PAINT: Record<string, string> = { grass: '#6aa84f', sand: '#d9c38f', gravel: '#b3ac9e', moss: '#5d7a3a', mud: '#6a5136', rock: '#8d8a84', snow: '#f2f4f6', dirt: '#8a6a48' };
registerMesh({
  gen: 'lawn/1', world: true,
  build(ctx) {
    const poly = areaOf(ctx); if (!poly) return null;
    const mat = String(ctx.params.material ?? 'grass'), base = rgb(typeof ctx.params.color === 'string' ? ctx.params.color : PAINT[mat] ?? PAINT.grass);
    const edge = num(ctx.params.edge, 1), stripes = ctx.params.stripes === true && mat === 'grass', fr = areaFrame(poly), soup = new Soup();
    const pal = (ctx.model.state as { ground?: { palette?: string } }).ground?.palette, ground = rgb(groundBaseFor(pal));
    drapeArea(soup, poly, 1.5, G(ctx), 0.02, (x, z, d) => {
      let c = scale(base, 0.92 + hf(x, z) * 0.14);
      if (mat === 'rock') c = scale(c, 0.85 + h01(Math.floor(x / 1.5), Math.floor(z / 1.5), 3) * 0.3);
      // mown stripes read from a height like old Eden's commons: 3.5 m bands, light 1.2x / dark 0.9x
      if (stripes) { const a = (x - fr.c[0]) * fr.u[0] + (z - fr.c[1]) * fr.u[1]; c = scale(c, Math.floor(a / 3.5) % 2 === 0 ? 1.2 : 0.9); }
      if (edge > 0 && d < edge) c = mix(ground, c, Math.min(1, d / edge * (0.7 + hf(x, z, 2) * 0.6)));
      return c;
    });
    const mesh = soupMesh(soup, `lawn ${ctx.entity.name ?? ctx.entity.id}`, { shadow: false });
    // On Eden's meadow, unstriped turf lawns take the same realism ground shader as the terrain around them. W2b: a grass
    // lawn is mown like old Eden's commons (the shader's 3.2 m bands along its long side). Authored stripes keep their own
    // crisp vertex bands (the turf's blade texture would mute them).
    if (mesh && groundRealismFor(pal) && !stripes && (mat === 'grass' || mat === 'moss')) mesh.material = meadowTurf(mat === 'grass' ? (fr.hl >= fr.hw ? fr.v : fr.u) : undefined);
    return mesh;
  },
});

const turfs = new Map<string, THREE.MeshStandardMaterial>();
/** Eden's meadow turf; `mown` = the unit xz axis old Eden's mown bands alternate along (stripes run across it) (one material per 5° of axis). */
function meadowTurf(mown?: [number, number]) {
  const deg = mown ? ((Math.round(Math.atan2(mown[1], mown[0]) * 180 / Math.PI / 5) * 5) % 180 + 180) % 180 : -1, key = String(deg);
  let turf = turfs.get(key);
  if (!turf) {
    turf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }); turf.name = mown ? `meadow lawn turf mown ${deg}` : 'meadow lawn turf';
    if (mown) applyMownTurf(turf, [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)]);
    else applyWorldRealism(new THREE.Mesh(new THREE.BufferGeometry(), turf), { classify: () => 'ground' });
    turfs.set(key, turf);
  }
  return turf;
}

// ---------- pitches ----------
const WHITE = rgb('#f2efe6');
registerMesh({
  gen: 'pitch/1', world: true,
  build(ctx) {
    const poly = areaOf(ctx); if (!poly) return null;
    const sport = String(ctx.params.sport ?? 'football'), fr = areaFrame(poly), g = G(ctx), soup = new Soup();
    const surf: Record<string, string> = { football: '#4f8f3a', tennis: '#3f7a5a', basketball: '#b8693e', petanque: '#b7ab93', volleyball: '#dccb98' };
    const base = rgb(typeof ctx.params.color === 'string' ? ctx.params.color : surf[sport] ?? surf.football);
    const L = (a: number, b: number): [number, number] => [fr.c[0] + fr.u[0] * a + fr.v[0] * b, fr.c[1] + fr.u[1] * a + fr.v[1] * b];
    drapeArea(soup, poly, 2, g, 0.035, (x, z) => {
      const a = (x - fr.c[0]) * fr.u[0] + (z - fr.c[1]) * fr.u[1];
      if (sport === 'football') return scale(base, Math.floor((a + fr.hl) / 5) % 2 ? 1.1 : 0.96);
      if (sport === 'tennis') return base;
      if (sport === 'basketball') return rgb('#2f5d8a');
      return scale(base, 0.94 + hf(x, z) * 0.1);
    });
    // crisp inner zones (playing court over its apron) as their own draped polygons
    const zone = (a0: number, b0: number, a1: number, b1: number, col: RGB) => drapeArea(soup, [L(a0, b0), L(a1, b0), L(a1, b1), L(a0, b1)], 2, g, 0.045, () => col);
    if (sport === 'tennis') zone(-Math.min(11.885, fr.hl), -Math.min(5.485, fr.hw), Math.min(11.885, fr.hl), Math.min(5.485, fr.hw), rgb('#3b6aa0'));
    if (sport === 'basketball') zone(-fr.hl + 1, -fr.hw + 1, fr.hl - 1, fr.hw - 1, base);
    const lw = sport === 'football' ? 0.12 : 0.06, lift = 0.06;
    const V = (p: [number, number]): V3 => [p[0], g(p[0], p[1]) + lift, p[1]];
    const seg = (a: [number, number], b: [number, number], w = lw, col: RGB = WHITE) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2; const n = Math.max(1, Math.ceil(l / 2)); for (let k = 0; k < n; k++) { const p0: [number, number] = [a[0] + dx * k / n, a[1] + dz * k / n], p1: [number, number] = [a[0] + dx * (k + 1) / n, a[1] + dz * (k + 1) / n]; soup.topQuad(V([p0[0] + nx, p0[1] + nz]), V([p1[0] + nx, p1[1] + nz]), V([p1[0] - nx, p1[1] - nz]), V([p0[0] - nx, p0[1] - nz]), col); } };
    const rect = (a0: number, b0: number, a1: number, b1: number, w = lw) => { seg(L(a0, b0), L(a1, b0), w); seg(L(a1, b0), L(a1, b1), w); seg(L(a1, b1), L(a0, b1), w); seg(L(a0, b1), L(a0, b0), w); };
    const circle = (a: number, b: number, r: number, from = 0, to = Math.PI * 2, w = lw) => { const n = Math.max(12, Math.round((to - from) * r * 1.5)); for (let k = 0; k < n; k++) { const t0 = from + ((to - from) * k) / n, t1 = from + ((to - from) * (k + 1)) / n; seg(L(a + Math.cos(t0) * r, b + Math.sin(t0) * r), L(a + Math.cos(t1) * r, b + Math.sin(t1) * r), w); } };
    const hl = fr.hl - 1, hw = fr.hw - 1;
    const post = rgb('#f4f4f0'), net = rgb('#dcdcd8');
    const P3 = (a: number, b: number, dy: number): V3 => { const p = L(a, b); return [p[0], g(p[0], p[1]) + dy, p[1]]; };
    if (sport === 'football') {
      const k = Math.min(1, hl / 52.5, hw / 34);
      rect(-hl, -hw, hl, hw); seg(L(0, -hw), L(0, hw)); circle(0, 0, 9.15 * k); soup.cyl(P3(0, 0, 0.04), 0.2, 0.02, WHITE, 10);
      for (const e of [-1, 1]) {
        rect(e * hl, -20.16 * k, e * (hl - 16.5 * k), 20.16 * k); rect(e * hl, -9.16 * k, e * (hl - 5.5 * k), 9.16 * k);
        soup.cyl(P3(e * (hl - 11 * k), 0, 0.04), 0.15, 0.02, WHITE, 8);
        circle(e * (hl - 11 * k), 0, 9.15 * k, e > 0 ? Math.PI - 0.93 : -0.93, e > 0 ? Math.PI + 0.93 : 0.93);
        // goal: two posts, crossbar, a sloping net back
        const gw = 7.32 * k / 2, gh = 2.44 * Math.max(0.7, k);
        for (const s of [-1, 1]) { soup.cyl(P3(e * hl, s * gw, 0), 0.06, gh, post, 8); soup.rod(P3(e * hl, s * gw, gh), P3(e * (hl + 1.6), s * gw, 0.1), 0.025, net, 4); }
        soup.rod(P3(e * hl, -gw, gh), P3(e * hl, gw, gh), 0.06, post, 8);
        for (let j = 0; j <= 8; j++) { const b = -gw + (2 * gw * j) / 8; soup.rod(P3(e * hl, b, gh), P3(e * (hl + 1.6), b, 0.1), 0.012, net, 3); }
        for (let j = 1; j <= 4; j++) { const t = j / 5; soup.rod(P3(e * (hl + 1.6 * t), -gw, gh * (1 - t) + 0.1 * t), P3(e * (hl + 1.6 * t), gw, gh * (1 - t) + 0.1 * t), 0.012, net, 3); }
      }
    } else if (sport === 'tennis') {
      const a = Math.min(11.885, hl), b = Math.min(5.485, hw), bs = b * 4.115 / 5.485;
      rect(-a, -b, a, b, 0.05); seg(L(-a, -bs), L(a, -bs), 0.05); seg(L(-a, bs), L(a, bs), 0.05);
      for (const e of [-1, 1]) seg(L(e * 6.4, -bs), L(e * 6.4, bs), 0.05);
      seg(L(-6.4, 0), L(6.4, 0), 0.05);
      for (const s of [-1, 1]) soup.cyl(P3(0, s * (b + 0.9), 0), 0.05, 1.07, rgb('#3a3d40'), 8);
      for (let j = 0; j <= 9; j++) soup.rod(P3(0, -(b + 0.9), 0.1 + j * 0.1), P3(0, b + 0.9, 0.1 + j * 0.1 - (j === 9 ? 0.15 : 0.12 * (1 - Math.abs(j - 9) / 9) * 0)), 0.006, rgb('#2a2d30'), 3);
      soup.rod(P3(0, -(b + 0.9), 0.98), P3(0, b + 0.9, 0.98), 0.03, WHITE, 4);
    } else if (sport === 'basketball') {
      rect(-hl + 1, -hw + 1, hl - 1, hw - 1, 0.05); seg(L(0, -hw + 1), L(0, hw - 1), 0.05); circle(0, 0, 1.8, 0, Math.PI * 2, 0.05);
      for (const e of [-1, 1]) {
        rect(e * (hl - 1), -2.45, e * (hl - 6.8), 2.45, 0.05); circle(e * (hl - 6.8), 0, 1.8, e > 0 ? Math.PI / 2 : -Math.PI / 2, e > 0 ? Math.PI * 1.5 : Math.PI / 2, 0.05);
        circle(e * (hl - 2.6), 0, 6.75, e > 0 ? Math.PI - 1.35 : -1.35, e > 0 ? Math.PI + 1.35 : 1.35, 0.05);
        const base3 = P3(e * (hl - 0.4), 0, 0); soup.cyl(base3, 0.1, 3.05, rgb('#3a3d40'), 8);
        const bb = P3(e * (hl - 1.0), 0, 2.9); soup.box([bb[0], bb[1] + 0.5, bb[2]], [0.06, 1.05, 1.8], Math.atan2(-fr.u[1], fr.u[0]) + Math.PI / 2, WHITE, 0.02);
        const rim = P3(e * (hl - 1.4), 0, 3.05); soup.cyl([rim[0], rim[1] - 0.02, rim[2]], 0.23, 0.03, rgb('#e2662a'), 12, 0.23, false);
      }
    } else if (sport === 'petanque') {
      const kerb = rgb('#8a6440');
      for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; soup.beam([a[0], g(a[0], a[1]), a[1]], [b[0], g(b[0], b[1]), b[1]], 0.12, 0.16, kerb, 0.02); }
      for (const [da, db, c] of [[0.5, 0.2, '#e8743a'], [-1.2, 0.4, '#c9ccd0'], [0.8, -0.5, '#c9ccd0'], [1.4, 0.1, '#c9ccd0'], [-0.4, -0.3, '#c9ccd0']] as const) soup.blob(P3(da, db, 0.07), da === 0.5 ? [0.03, 0.03, 0.03] : [0.045, 0.045, 0.045], rgb(c), 0, 0, 1, false);
    } else if (sport === 'volleyball') {
      const a = Math.min(8, hl), b = Math.min(4, hw); rect(-a, -b, a, b, 0.05);
      for (const s of [-1, 1]) soup.cyl(P3(0, s * (b + 0.6), 0), 0.05, 2.5, post, 8);
      for (let j = 0; j <= 8; j++) soup.rod(P3(0, -(b + 0.6), 1.7 + j * 0.1), P3(0, b + 0.6, 1.7 + j * 0.1), 0.006, rgb('#2a2d30'), 3);
      for (let j = 0; j <= Math.round((2 * b + 1.2) / 0.25); j++) { const bb = -(b + 0.6) + j * 0.25; soup.rod(P3(0, bb, 1.7), P3(0, bb, 2.55), 0.005, rgb('#2a2d30'), 3); }
      soup.rod(P3(0, -(b + 0.6), 2.58), P3(0, b + 0.6, 2.58), 0.035, WHITE, 4);
    }
    if (ctx.params.fence === true) {
      const h = sport === 'tennis' ? 3 : 1.2, wire = rgb('#4f5a52');
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 3));
        for (let k = 0; k <= n; k++) { const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n; soup.cyl([x, g(x, z), z], 0.04, h, wire, 6); }
        for (const yy of [0.15, h / 2, h - 0.05]) soup.rod([a[0], g(a[0], a[1]) + yy, a[1]], [b[0], g(b[0], b[1]) + yy, b[1]], 0.02, wire, 3);
        const meshN = Math.max(2, Math.round(len / 0.5)); for (let k = 0; k <= meshN; k++) { const x = a[0] + ((b[0] - a[0]) * k) / meshN, z = a[1] + ((b[1] - a[1]) * k) / meshN; soup.rod([x, g(x, z) + 0.15, z], [x, g(x, z) + h - 0.05, z], 0.006, scale(wire, 1.2), 3); }
      }
    }
    void distEdge;
    return soupMesh(soup, `pitch ${ctx.entity.name ?? ctx.entity.id}`, { shadow: true });
  },
});

// ---------- parking, garden beds ----------
registerMesh({
  gen: 'parking/1', world: true,
  build(ctx) {
    const poly = areaOf(ctx); if (!poly) return null;
    const fr = areaFrame(poly), g = G(ctx), soup = new Soup(), bay = num(ctx.params.bay, 2.5);
    drapeArea(soup, poly, 2, g, 0.04, (x, z) => scale(rgb('#55585c'), 0.95 + hf(x, z) * 0.08));
    const L = (a: number, b: number): [number, number] => [fr.c[0] + fr.u[0] * a + fr.v[0] * b, fr.c[1] + fr.u[1] * a + fr.v[1] * b];
    for (const side of [-1, 1]) for (let a = -fr.hl + 0.5; a <= fr.hl - 0.5; a += bay) {
      const p0 = L(a, side * fr.hw * 0.98), p1 = L(a, side * (fr.hw - 5)), dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.06, nz = dx / l * 0.06;
      const V = (p: [number, number]): V3 => [p[0], g(p[0], p[1]) + 0.065, p[1]];
      soup.topQuad(V([p0[0] + nx, p0[1] + nz]), V([p1[0] + nx, p1[1] + nz]), V([p1[0] - nx, p1[1] - nz]), V([p0[0] - nx, p0[1] - nz]), WHITE);
    }
    return soupMesh(soup, `parking ${ctx.entity.name ?? ctx.entity.id}`, { shadow: false });
  },
});
registerMesh({
  gen: 'garden-bed/1', world: true,
  build(ctx) {
    const poly = areaOf(ctx); if (!poly) return null;
    const fr = areaFrame(poly), g = G(ctx), soup = new Soup(), rows = num(ctx.params.rows, 0.7), crop = String(ctx.params.crop ?? 'mixed');
    drapeArea(soup, poly, 1, g, 0.05, (x, z) => scale(rgb('#6a4b31'), 0.9 + hf(x, z) * 0.15));
    const L = (a: number, b: number): [number, number] => [fr.c[0] + fr.u[0] * a + fr.v[0] * b, fr.c[1] + fr.u[1] * a + fr.v[1] * b];
    const cols: Record<string, string[]> = { flowers: ['#d9534f', '#e8c547', '#f2f0e6', '#9b6cc0', '#e88aa8'], vegetables: ['#4f8a3e', '#6aa84f', '#3e7a35'], herbs: ['#7fa64a', '#5d8f3c'], wheat: ['#d8b85a', '#cfae4f'], pumpkins: ['#e07a2a', '#d0702a'], mixed: ['#4f8a3e', '#d9534f', '#e8c547', '#6aa84f', '#e07a2a'] };
    let i = 0;
    for (let b = -fr.hw + rows / 2; b < fr.hw; b += rows) for (let a = -fr.hl + 0.25; a < fr.hl; a += crop === 'pumpkins' ? 0.9 : 0.35, i++) {
      const [x, z] = L(a, b); if (!inPoly(x, z, poly)) continue;
      const palette = cols[crop] ?? cols.mixed, c = rgb(palette[Math.floor(h01(i, 7) * palette.length)]), y = g(x, z) + 0.05;
      if (crop === 'wheat') soup.cone([x, y, z], 0.12, 0.7, c, 4);
      else if (crop === 'pumpkins') { soup.blob([x, y + 0.15, z], [0.25, 0.18, 0.25], c, 0, 0.1, i); soup.blob([x + 0.3, y + 0.05, z], [0.18, 0.06, 0.15], rgb('#4f8a3e'), 0, 0.2, i + 1); }
      else soup.blob([x, y + 0.14, z], [0.16, 0.14, 0.16], c, 0, 0.2, i);
    }
    if (ctx.params.border !== false) for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; soup.beam([a[0], g(a[0], a[1]) - 0.02, a[1]], [b[0], g(b[0], b[1]) - 0.02, b[1]], 0.1, 0.22, rgb('#8a6440'), 0.02); }
    return soupMesh(soup, `garden ${ctx.entity.name ?? ctx.entity.id}`);
  },
});
export type { THREE };
