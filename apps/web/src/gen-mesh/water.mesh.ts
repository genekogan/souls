// river/1, shore/1, bridge/1, pier/1, deck/1 mesh halves. Owner: L3.
// Rivers draw their own water (per-point levels, flowing, animated) trimmed where they enter a lake,
// banks by material (sand, pebbles, stone, reeds), waterfalls with foam and lip rocks where the
// frozen profile steps; shores ring lakes; bridges, piers and decks stand on posts to the bed.
import { areaFrame, atOf, bridgeSpan, flowOf, prepareBridge, prepareDeck, queryOf, railGaps, riverLine, smoothPath } from '@souls/generators';
import type { Ground } from '@souls/ground';
import * as THREE from 'three';
import { registerMesh, type MeshCtx } from './registry.ts';
import { at, bridgeDeck, line } from './l3-path.ts';
import { Soup, drapeArea, h01, inPoly, mix, rgb, scale, soupMesh, type RGB, type V3 } from './soup.ts';
import { waterMaterial, waterMesh } from './water.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const inLake = (g: Ground, x: number, z: number) => g.waters.some((w) => w.area && inPoly(x, z, w.area));
const BANKS: Record<string, string> = { grass: '#6f9a4f', sand: '#d8c690', stone: '#a9a294', reeds: '#6d6a45', pebble: '#a8a090' };

function reeds(soup: Soup, x: number, y: number, z: number, s: number, seed: number) {
  const stalk = rgb('#6f8a3f'), head = rgb('#6b4a2c');
  for (let k = 0; k < 4; k++) {
    const a = h01(seed, k) * 6.28, r = 0.12 * h01(seed, k, 2), h = (0.9 + h01(seed, k, 3) * 0.9) * s;
    const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r, lean = (h01(seed, k, 4) - 0.5) * 0.3;
    soup.rod([bx, y - 0.1, bz], [bx + lean, y + h, bz + lean * 0.5], 0.018, stalk, 3);
    if (k < 2) soup.rod([bx + lean * 0.8, y + h * 0.78, bz + lean * 0.4], [bx + lean, y + h * 0.95, bz + lean * 0.5], 0.04, head, 5);
  }
}
function pebbles(soup: Soup, x: number, y: number, z: number, seed: number, big = false) {
  const n = big ? 2 : 3;
  for (let k = 0; k < n; k++) { const r = (big ? 0.35 : 0.1) * (0.6 + h01(seed, k) * 0.8), a = h01(seed, k, 1) * 6.28, d = h01(seed, k, 2) * 0.6; soup.blob([x + Math.cos(a) * d, y + r * 0.35, z + Math.sin(a) * d], [r * 1.3, r * 0.7, r], scale(rgb('#9c968a'), 0.8 + h01(seed, k, 3) * 0.35), 0, 0.2, seed + k); }
}

registerMesh({
  gen: 'river/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('path' in e.shape)) return null;
    const c = riverLine(e.shape), L = line(c), W = num(ctx.params.width, 6), bankW = num(ctx.params.bankWidth, 2.5), banks = String(ctx.params.banks ?? 'grass');
    const f = flowOf(ctx.params, e.shape, c), lv = f ? f.levels : c.map(() => num(ctx.params.level, -0.3));
    const g = ctx.model.ground(), ground = (x: number, z: number) => ctx.model.terrain.sample(x, z);
    const group = new THREE.Group(); group.name = `river ${e.name ?? e.id}`;
    // water ribbon: 3 columns across, uv u = metres downstream, v = across
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const across = [W / 2, W / 6, -W / 6, -W / 2];
    for (let i = 0; i < c.length; i++) for (let k = 0; k < across.length; k++) { const [x, z] = at(L, L.s[i], across[k]); pos.push(x, lv[i], z); uv.push(L.s[i], across[k]); }
    const cols = across.length;
    for (let i = 0; i < c.length - 1; i++) {
      const mx = (c[i][0] + c[i + 1][0]) / 2, mz = (c[i][1] + c[i + 1][1]) / 2;
      if (inLake(g, mx, mz)) continue;
      for (let k = 0; k < cols - 1; k++) { const a = i * cols + k, b = a + 1, cc = a + cols, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
    }
    if (idx.length) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('waterUv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      group.add(waterMesh(geo, waterMaterial({ flow: 0.7, color: '#3f86ad' }), 'river-water'));
    }
    // banks
    const soup = new Soup(), bankCol = rgb(BANKS[banks] ?? BANKS.grass), wet = scale(bankCol, 0.72);
    // the bank fades into the bare ground of the world's palette (green on grass, sand on desert…)
    const pal = (ctx.model.state as { ground?: { palette?: string } }).ground?.palette ?? 'grass';
    const outer = rgb(pal === 'desert' || pal === 'dust' || pal === 'sand' ? '#d1ad74' : pal === 'snow' ? '#e6ebef' : pal === 'rock' ? '#9b958a' : pal === 'meadow' ? '#8a9b6e' : '#6f9a4f');
    const dry = mix(bankCol, outer, banks === 'grass' && outer[1] > outer[0] ? 0 : 0.35);
    const ACROSS = 4; // strips across the bank so the drape follows the trench wall (no terrain poking through)
    if (bankW > 0) for (const side of [1, -1]) for (let i = 0; i < c.length - 1; i++) {
      const q0 = L.s[i], q1 = L.s[i + 1], t0 = side * (W / 2 - 0.5), t1 = side * (W / 2 + bankW);
      const m = at(L, (q0 + q1) / 2, (t0 + t1) / 2); if (inLake(g, m[0], m[1])) continue;
      const G = (p: [number, number], lift: number): V3 => [p[0], ground(p[0], p[1]) + lift, p[1]];
      for (let k = 0; k < ACROSS; k++) {
        const ta = t0 + ((t1 - t0) * k) / ACROSS, tb = t0 + ((t1 - t0) * (k + 1)) / ACROSS, ca = mix(wet, dry, k / ACROSS), cb = mix(wet, dry, (k + 1) / ACROSS);
        soup.topQuad(G(at(L, q0, ta), 0.07), G(at(L, q1, ta), 0.07), G(at(L, q1, tb), 0.07), G(at(L, q0, tb), 0.07), [ca, ca, cb, cb]);
      }
      const edge = at(L, (q0 + q1) / 2, side * (W / 2 - 0.2)), ey = ground(edge[0], edge[1]);
      const seed = (i * 7 + (side > 0 ? 1 : 2)) * 13 + (e.seed ?? 0);
      if (banks === 'reeds' && h01(seed, 1) < 0.7) reeds(soup, edge[0], Math.max(ey, lv[i] - 0.3), edge[1], 1, seed);
      if ((banks === 'pebble' || banks === 'stone') && h01(seed, 2) < 0.6) pebbles(soup, edge[0], ey, edge[1], seed, banks === 'stone');
      if (banks === 'grass' && h01(seed, 3) < 0.25) reeds(soup, edge[0], Math.max(ey, lv[i] - 0.3), edge[1], 0.7, seed);
    }
    // waterfalls: a falling sheet of water (flowing down), foam at the foot, rocks at the lip
    const foam = new Soup(), white = rgb('#eef5f8');
    const fpos: number[] = [], fuv: number[] = [], fidx: number[] = [];
    for (const fall of f?.falls ?? []) {
      const i = fall.i, q0 = L.s[i - 1], q1 = L.s[i], rows = 5, colsF = 6, base0 = fpos.length / 3;
      for (let r = 0; r <= rows; r++) {
        const u = r / rows, qq = q0 + (q1 - q0) * Math.sqrt(u) * 0.9, y = fall.top + (fall.bottom - fall.top) * u * u * 0.4 + (fall.bottom - fall.top) * u * 0.6;
        for (let k = 0; k <= colsF; k++) { const t = W / 2 - (W * k) / colsF; const [x, z] = at(L, qq, t * 0.96); fpos.push(x, y + 0.04, z); fuv.push(u * (fall.top - fall.bottom) * 2, t); }
      }
      for (let r = 0; r < rows; r++) for (let k = 0; k < colsF; k++) { const a = base0 + r * (colsF + 1) + k, b = a + 1, cc = a + colsF + 1, d = cc + 1; fidx.push(a, cc, b, b, cc, d); }
      const foot = !(f?.falls ?? []).some((g) => g.i === i + 1); // foam only where the cascade ends
      if (foot) for (let k = 0; k < 7; k++) {
        const t = -W / 2 + (W * (k + 0.5)) / 7, p = at(L, q1 + 0.4 + h01(i, k) * 2.6, t + (h01(i, k, 2) - 0.5) * 1.2);
        foam.blob([p[0], fall.bottom + 0.02, p[1]], [0.5 + h01(i, k, 3) * 0.4, 0.08, 0.45 + h01(i, k, 5) * 0.3], scale(white, 0.95 + h01(i, k, 4) * 0.05), 1, 0.18, i * 31 + k);
      }
      for (const side of [1, -1]) { const lip = at(L, q0, side * (W / 2 + 0.3)); soup.blob([lip[0], fall.top - 0.2, lip[1]], [0.9, 0.7, 0.8], rgb('#8f8a80'), 1, 0.18, i * 17 + side); const low = at(L, q1, side * (W / 2 + 0.2)); soup.blob([low[0], fall.bottom, low[1]], [0.7, 0.5, 0.6], rgb('#857f75'), 0, 0.2, i * 19 + side); }
    }
    if (fidx.length) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3)); geo.setAttribute('waterUv', new THREE.Float32BufferAttribute(fuv, 2)); geo.setIndex(fidx); geo.computeVertexNormals();
      group.add(waterMesh(geo, waterMaterial({ flow: 2.2, color: '#cfe6ef', opacity: 0.82 }), 'river-falls'));
    }
    const banksMesh = soupMesh(soup, 'river-banks'); if (banksMesh) group.add(banksMesh);
    const foamMesh = soupMesh(foam, 'river-foam', { shadow: false }); if (foamMesh) group.add(foamMesh);
    return group.children.length ? group : null;
  },
});

registerMesh({
  gen: 'shore/1', world: true,
  build(ctx) {
    const mat = String(ctx.params.material ?? 'sand'), soup = new Soup(), ground = (x: number, z: number) => ctx.model.terrain.sample(x, z);
    const col = rgb(BANKS[mat] ?? BANKS.sand), wet = scale(col, 0.75);
    for (const s of ctx.baked.surfaces ?? []) {
      const [i0, i1, o1, o0] = s.polygon as [number, number][];
      drapeArea(soup, s.polygon as [number, number][], 1, ground, 0.025, (x, z) => { const di = Math.hypot(x - (i0[0] + i1[0]) / 2, z - (i0[1] + i1[1]) / 2), dO = Math.hypot(x - (o0[0] + o1[0]) / 2, z - (o0[1] + o1[1]) / 2); const t = di / Math.max(0.01, di + dO); return scale(mix(wet, mix(col, rgb('#7d9c56'), 0.25), t), 0.94 + hf2(x, z) * 0.1); });
      const mid: [number, number] = [(i0[0] + i1[0]) / 2 * 0.7 + (o0[0] + o1[0]) / 2 * 0.3, (i0[1] + i1[1]) / 2 * 0.7 + (o0[1] + o1[1]) / 2 * 0.3];
      const seed = Math.round(mid[0] * 13 + mid[1] * 7);
      if (mat === 'reeds') reeds(soup, mid[0], ground(mid[0], mid[1]), mid[1], 1, seed);
      if (mat === 'pebble' || mat === 'stone') pebbles(soup, mid[0], ground(mid[0], mid[1]), mid[1], seed, mat === 'stone');
    }
    return soupMesh(soup, `shore ${ctx.entity.name ?? ctx.entity.id}`, { shadow: false });
  },
});
const hf2 = (x: number, z: number) => h01(Math.floor(x * 2), Math.floor(z * 2), 5);

registerMesh({
  gen: 'bridge/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('path' in e.shape)) return null;
    const c = smoothPath(e.shape.path, 1.5, 120), L = line(c), w = num(ctx.params.width, 3);
    const at0 = atOf(ctx.params, e.shape) ?? prepareBridge(queryOf(ctx.model), e.shape.path).at;
    const sp = bridgeSpan(at0, L.total, num(ctx.params.deck, 0.8), num(ctx.params.arch, 0.6));
    const soup = new Soup(), mat = String(ctx.params.material ?? 'wood') as 'wood' | 'stone' | 'metal';
    const water = (x: number, z: number) => { let lv: number | null = null; for (const wt of ctx.model.ground().waters) if (wt.area && inPoly(x, z, wt.area)) lv = wt.level; return lv; };
    bridgeDeck(soup, L, sp, w, mat, (x, z) => ctx.model.terrain.sample(x, z), water, ctx.params.rails !== false);
    return soupMesh(soup, `bridge ${e.name ?? e.id}`);
  },
});

const PLANK = rgb('#a47b50'), POST = rgb('#6a4c33');
registerMesh({
  gen: 'pier/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('path' in e.shape)) return null;
    const c = smoothPath(e.shape.path, 2, 200), L = line(c), w = num(ctx.params.width, 2.4), pl = num(ctx.params.platform, 5);
    const y = (atOf(ctx.params, e.shape) ?? prepareDeck(queryOf(ctx.model), { path: e.shape.path }, ctx.params).at).y ?? 0.7;
    const base = rgb(typeof ctx.params.color === 'string' ? ctx.params.color : '#a07a4f'), soup = new Soup(), ground = (x: number, z: number) => ctx.model.terrain.sample(x, z);
    const plank = (a: [number, number], b: [number, number], cc: [number, number], d: [number, number], k: number) => soup.topQuad([a[0], y, a[1]], [b[0], y, b[1]], [cc[0], y, cc[1]], [d[0], y, d[1]], scale(base, 0.86 + h01(k, 3) * 0.24));
    let k = 0;
    for (let q = 0; q < L.total - 0.05; q += 0.32, k++) { const q1 = Math.min(L.total, q + 0.29); plank(at(L, q, w / 2), at(L, q1, w / 2), at(L, q1, -w / 2), at(L, q, -w / 2), k); }
    for (const side of [1, -1]) { for (let i = 0; i < c.length - 1; i++) { const a = at(L, L.s[i], side * w / 2), b = at(L, L.s[i + 1], side * w / 2); soup.quad([a[0], y, a[1]], [b[0], y, b[1]], [b[0], y - 0.22, b[1]], [a[0], y - 0.22, a[1]], scale(base, 0.7)); } }
    // posts every 2 m both sides, into the bed
    for (let q = 0.3; q <= L.total; q += 2) for (const side of [1, -1]) { const [x, z] = at(L, q, side * (w / 2 - 0.1)), gy = ground(x, z) - 0.4; if (y - gy > 0.15) soup.cyl([x, gy, z], 0.11, y - gy - 0.02, POST, 6); }
    // rails (open for the first 3 m, the landing)
    if (ctx.params.rails !== false) for (const side of [1, -1]) {
      for (let q = 3; q <= L.total + 1e-6; q += 2) { const [x, z] = at(L, q, side * (w / 2 - 0.05)); soup.box([x, y + 0.5, z], [0.09, 1.0, 0.09], 0, POST, 0.02); }
      for (let q = 3; q < L.total - 0.1; q += 1) { const a = at(L, q, side * (w / 2 - 0.05)), b = at(L, Math.min(L.total, q + 1), side * (w / 2 - 0.05)); soup.beam([a[0], y + 0.95, a[1]], [b[0], y + 0.95, b[1]], 0.08, 0.07, POST, 0.02); }
    }
    // end platform with posts, a rail on three sides, a mooring post
    const plat = (ctx.baked.surfaces ?? []).find((s, i, all) => i === all.length - 1 && s.polygon.length === 4 && pl > 0);
    if (plat) {
      const poly = plat.polygon as [number, number][], fr = areaFrame(poly);
      for (let a = -fr.hl; a < fr.hl - 0.05; a += 0.32) { const P = (aa: number, bb: number): [number, number] => [fr.c[0] + fr.u[0] * aa + fr.v[0] * bb, fr.c[1] + fr.u[1] * aa + fr.v[1] * bb]; plank(P(a, fr.hw), P(Math.min(fr.hl, a + 0.29), fr.hw), P(Math.min(fr.hl, a + 0.29), -fr.hw), P(a, -fr.hw), k++); }
      for (const [x, z] of poly) { const gy = ground(x, z) - 0.4; soup.cyl([x, gy, z], 0.13, y - gy, POST, 6); }
      if (ctx.params.rails !== false) for (let i = 0; i < 4; i++) { const a = poly[i], b = poly[(i + 1) % 4]; if (i === 3) continue; soup.beam([a[0], y + 0.95, a[1]], [b[0], y + 0.95, b[1]], 0.08, 0.07, POST, 0.02); soup.box([a[0], y + 0.5, a[1]], [0.1, 1, 0.1], 0, POST, 0.02); }
      const m = poly[1]; soup.cyl([m[0] * 0.85 + poly[2][0] * 0.15, y, m[1] * 0.85 + poly[2][1] * 0.15], 0.14, 0.5, rgb('#4d3a2a'), 8);
    }
    return soupMesh(soup, `pier ${e.name ?? e.id}`);
  },
});

registerMesh({
  gen: 'deck/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const poly = e.shape.area as [number, number][], fr = areaFrame(poly);
    const y = (atOf(ctx.params, e.shape) ?? prepareDeck(queryOf(ctx.model), { area: poly }, ctx.params).at).y ?? 0.6;
    const base = rgb(typeof ctx.params.color === 'string' ? ctx.params.color : '#a07a4f'), soup = new Soup(), ground = (x: number, z: number) => ctx.model.terrain.sample(x, z);
    const P = (a: number, b: number): [number, number] => [fr.c[0] + fr.u[0] * a + fr.v[0] * b, fr.c[1] + fr.u[1] * a + fr.v[1] * b];
    let k = 0;
    for (let b = -fr.hw; b < fr.hw - 0.05; b += 0.16, k++) {
      for (let a = -fr.hl; a < fr.hl - 0.05; a += 0.4) {
        const p0 = P(a + 0.2, b + 0.07); if (!inPoly(p0[0], p0[1], poly)) continue;
        const a1 = Math.min(fr.hl, a + 0.4), b1 = Math.min(fr.hw, b + 0.14), A = P(a, b), B = P(a1, b), C = P(a1, b1), D = P(a, b1), col = scale(base, 0.86 + h01(k, Math.floor(a), 3) * 0.24);
        soup.topQuad([A[0], y, A[1]], [B[0], y, B[1]], [C[0], y, C[1]], [D[0], y, D[1]], col);
      }
    }
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; soup.quad([a[0], y, a[1]], [b[0], y, b[1]], [b[0], y - 0.25, b[1]], [a[0], y - 0.25, a[1]], scale(base, 0.68)); }
    for (let a = -fr.hl + 0.2; a <= fr.hl; a += 2) for (let b = -fr.hw + 0.2; b <= fr.hw; b += 2) { const [x, z] = P(Math.min(a, fr.hl - 0.2), Math.min(b, fr.hw - 0.2)); if (!inPoly(x, z, poly)) continue; const gy = ground(x, z) - 0.3; if (y - gy > 0.2) soup.cyl([x, gy, z], 0.1, y - gy - 0.02, POST, 6); }
    // the rail opens where a stair, ramp or ladder of another thing lands on the deck (the engine bridge opens the same gap)
    const ends = ctx.params.rails !== false ? linkEndsAt(ctx, e.id, poly, y) : [];
    if (ctx.params.rails !== false && y - Math.min(...poly.map(([x, z]) => ground(x, z))) > 0.4) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (ground((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) > y - 0.4) continue; // edge meets the bank: leave it open
      const P = (t: number): [number, number] => [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len];
      let t0 = 0;
      for (const [g0, g1] of [...railGaps(a, b, ends), [len, len]]) {
        const piece = g0 - t0;
        if (piece > 0.05) {
          const n = Math.max(1, Math.round(piece / 1.8)), p0 = P(t0), p1 = P(g0);
          for (let j = 0; j <= n; j++) { const [x, z] = P(t0 + (piece * j) / n); soup.box([x, y + 0.5, z], [0.09, 1, 0.09], 0, POST, 0.02); }
          soup.beam([p0[0], y + 0.95, p0[1]], [p1[0], y + 0.95, p1[1]], 0.08, 0.07, POST, 0.02);
        }
        t0 = g1;
      }
    }
    return soupMesh(soup, `deck ${e.name ?? e.id}`);
  },
});
/** Stair, ramp and ladder ends of other things at a deck's height within 0.6 m of its outline (the engine bridge's
 *  linkEndsNear, for the picture) whose flight comes from off the deck: world point and width. */
function linkEndsAt(ctx: MeshCtx, self: string, poly: [number, number][], y: number): { p: [number, number]; width: number }[] {
  const m = ctx.model, out: { p: [number, number]; width: number }[] = [];
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]), pad = 24, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
  for (const o of m.entities.values()) {
    if (o.id === self) continue;
    const def = m.resolvedDef(o.def); if (!def) continue;
    const world = def.form !== 'point' && o.in.parent === 'world', wp = m.worldPose(o);
    if (!world && (wp.x < x0 || wp.x > x1 || wp.z < z0 || wp.z > z1)) continue;
    let links: ReturnType<typeof m.bake>['links'];
    try { links = m.bake(def, o.params ?? {}, o.seed ?? 0, o.shape).links; } catch { continue; }
    if (!links?.length) continue;
    const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
    const toWorld = (x: number, z: number): [number, number] => (world ? [x, z] : [wp.x + (x * c + z * s) * wp.s, wp.z + (-x * s + z * c) * wp.s]);
    for (const l of links) {
      if (l.path.length < 2) continue;
      const ends = [[l.path[0], l.y0, l.path[l.path.length - 1]], [l.path[l.path.length - 1], l.y1, l.path[0]]] as const;
      for (const [q, ly, far] of ends) {
        const p = toWorld(q[0], q[1]), h = world ? m.terrain.sample(p[0], p[1]) + ly : wp.y + ly * wp.s, o = toWorld(far[0], far[1]);
        // a flight arriving from off the deck (one starting on the deck leaves its rail alone)
        if (Math.abs(h - y) <= 0.3 && !inPoly(o[0], o[1], poly)) out.push({ p, width: l.width * (world ? 1 : wp.s) });
      }
    }
  }
  return out;
}
export type { MeshCtx, RGB };
