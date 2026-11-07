// Shared picture helpers for L3's path meshes: stations along a centre line, (s, t) → world
// mapping, bridge decks (stone arch, timber trestle, steel), rails with posts. Owner: L3.
import { arcLengths, deckAt, frames, type Span } from '@souls/generators';
import { Soup, h01, rgb, scale, type RGB, type V3 } from './soup.ts';

export type Line = { c: [number, number][]; s: number[]; f: { t: [number, number]; n: [number, number] }[]; total: number };
export function line(c: [number, number][]): Line { const s = arcLengths(c); return { c, s, f: frames(c), total: s[s.length - 1] }; }
/** World x,z at arc length q and lateral offset t (left positive). */
export function at(L: Line, q: number, t = 0): [number, number] {
  const { c, s, f } = L;
  let i = 1; while (i < s.length - 1 && s[i] < q) i++;
  const k = s[i] - s[i - 1] ? Math.min(1, Math.max(0, (q - s[i - 1]) / (s[i] - s[i - 1]))) : 0;
  const x = c[i - 1][0] + (c[i][0] - c[i - 1][0]) * k, z = c[i - 1][1] + (c[i][1] - c[i - 1][1]) * k;
  let nx = f[i - 1].n[0] + (f[i].n[0] - f[i - 1].n[0]) * k, nz = f[i - 1].n[1] + (f[i].n[1] - f[i - 1].n[1]) * k; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
  return [x + nx * t, z + nz * t];
}
export function dirAt(L: Line, q: number): [number, number] { const a = at(L, Math.max(0, q - 0.5)), b = at(L, Math.min(L.total, q + 0.5)); const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; }

export type BridgeStyle = 'stone' | 'wood' | 'metal';
const STONE = rgb('#b7ad9c'), STONE_DARK = rgb('#8f8676'), TIMBER = rgb('#9b6f47'), TIMBER_DARK = rgb('#6f5038'), STEEL = rgb('#5d646b'), RAIL_WOOD = rgb('#70533b');

/**
 * A bridge deck between arc lengths sp.from..sp.to of a line, width w, at heights deckAt(sp, q):
 * deck, fascia, rails with posts, and what holds it up — a stone barrel arch with spandrel walls,
 * timber piles with cross-bracing, or steel girders on piers — down to the ground (river bed).
 */
export function bridgeDeck(soup: Soup, L: Line, sp: Span, w: number, style: BridgeStyle, ground: (x: number, z: number) => number, water: (x: number, z: number) => number | null, rails = true) {
  const n = Math.max(2, Math.ceil((sp.to - sp.from) / 1));
  const qs = Array.from({ length: n + 1 }, (_, k) => sp.from + ((sp.to - sp.from) * k) / n);
  const y = (q: number) => deckAt(sp, q);
  const P = (q: number, t: number, dy = 0): V3 => { const [x, z] = at(L, q, t); return [x, y(q) + dy, z]; };
  const thick = style === 'stone' ? 0.5 : 0.25;
  // deck top: planks across (wood) or flags (stone/metal)
  for (let k = 0; k < n; k++) {
    const q0 = qs[k], q1 = qs[k + 1];
    if (style === 'wood') {
      const planks = Math.max(1, Math.round((q1 - q0) / 0.3));
      for (let p = 0; p < planks; p++) {
        const a = q0 + ((q1 - q0) * p) / planks, b = q0 + ((q1 - q0) * (p + 1)) / planks - 0.03;
        const tone = 0.88 + h01(k, p, 3) * 0.2;
        soup.topQuad(P(a, w / 2, 0.02), P(b, w / 2, 0.02), P(b, -w / 2, 0.02), P(a, -w / 2, 0.02), scale(TIMBER, tone));
      }
    } else {
      const c = style === 'stone' ? STONE : rgb('#8d8f91');
      soup.topQuad(P(q0, w / 2, 0.02), P(q1, w / 2, 0.02), P(q1, -w / 2, 0.02), P(q0, -w / 2, 0.02), scale(c, 0.95 + h01(k, 9) * 0.1));
    }
    // fascia both sides and underside
    for (const side of [1, -1]) soup.quad(P(q0, side * w / 2, 0.02), P(q1, side * w / 2, 0.02), P(q1, side * w / 2, -thick), P(q0, side * w / 2, -thick), style === 'wood' ? TIMBER_DARK : STONE_DARK);
    soup.quad(P(q0, w / 2, -thick), P(q1, w / 2, -thick), P(q1, -w / 2, -thick), P(q0, -w / 2, -thick), scale(style === 'wood' ? TIMBER_DARK : STONE_DARK, 0.8));
  }
  // rails: stone parapets, or posts + handrail + mid rail
  if (rails) for (const side of [1, -1]) {
    if (style === 'stone') {
      for (let k = 0; k < n; k++) { const a = P(qs[k], side * (w / 2 - 0.15)), b = P(qs[k + 1], side * (w / 2 - 0.15)); soup.beam(a, b, 0.3, 0.75, scale(STONE, 0.9 + h01(k, side) * 0.12), 0.04); }
    } else {
      const col = style === 'wood' ? RAIL_WOOD : STEEL;
      for (let q = sp.from; q <= sp.to + 1e-6; q += 1.6) { const b = P(q, side * (w / 2 - 0.06)); soup.box([b[0], b[1] + 0.55, b[2]], [0.1, 1.1, 0.1], 0, col, 0.02); }
      for (let k = 0; k < n; k++) { const a = P(qs[k], side * (w / 2 - 0.06)), b = P(qs[k + 1], side * (w / 2 - 0.06)); soup.beam([a[0], a[1] + 1.02, a[2]], [b[0], b[1] + 1.02, b[2]], 0.09, 0.08, col, 0.02); soup.beam([a[0], a[1] + 0.55, a[2]], [b[0], b[1] + 0.55, b[2]], 0.05, 0.05, col); }
    }
  }
  // supports
  const len = sp.to - sp.from;
  if (style === 'stone') {
    // barrel arch: intrados from the banks up to just under the deck at mid-span; spandrel walls between
    const wl = Math.max(...qs.map((q) => { const [x, z] = at(L, q); return water(x, z) ?? ground(x, z); }));
    const top = Math.min(y(sp.from + len / 2) - thick - 0.15, wl + Math.max(1.2, len * 0.35));
    const intr = (q: number) => { const u = (q - sp.from) / len; const g = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)); return Math.max(minGround(q), wl - 0.6 + (top - wl + 0.6) * g); };
    const minGround = (q: number) => { const [x, z] = at(L, q); return ground(x, z); };
    for (let k = 0; k < n; k++) {
      const q0 = qs[k], q1 = qs[k + 1];
      for (const side of [1, -1]) {
        const a0 = P(q0, side * w / 2, -thick), a1 = P(q1, side * w / 2, -thick);
        const b0: V3 = [a0[0], intr(q0), a0[2]], b1: V3 = [a1[0], intr(q1), a1[2]];
        if (b0[1] < a0[1] || b1[1] < a1[1]) soup.quad(b0, b1, a1, a0, scale(STONE, 0.86 + h01(k, side, 5) * 0.12));
      }
      const i0l = at(L, q0, w / 2), i1l = at(L, q1, w / 2), i0r = at(L, q0, -w / 2), i1r = at(L, q1, -w / 2);
      soup.quad([i0l[0], intr(q0), i0l[1]], [i1l[0], intr(q1), i1l[1]], [i1r[0], intr(q1), i1r[1]], [i0r[0], intr(q0), i0r[1]], STONE_DARK);
    }
    // voussoir ring: a slightly proud band along the arch on each face
    for (const side of [1, -1]) for (let k = 0; k < n; k++) { const q0 = qs[k], q1 = qs[k + 1]; const a = at(L, q0, side * (w / 2 + 0.04)), b = at(L, q1, side * (w / 2 + 0.04)); soup.quad([a[0], intr(q0), a[1]], [b[0], intr(q1), b[1]], [b[0], intr(q1) + 0.35, b[1]], [a[0], intr(q0) + 0.35, a[1]], k % 2 ? STONE : scale(STONE, 1.08)); }
  } else {
    // piles / piers every ~3 m, cross-braced (timber) or solid (steel)
    const bays = Math.max(1, Math.round(len / 3));
    for (let b = 0; b <= bays; b++) {
      const q = sp.from + (len * b) / bays;
      for (const side of [1, -1]) {
        const [x, z] = at(L, q, side * (w / 2 - 0.15)), g = ground(x, z) - 0.3, top = y(q) - thick;
        if (top - g < 0.2) continue;
        soup.cyl([x, g, z], style === 'wood' ? 0.11 : 0.14, top - g, style === 'wood' ? TIMBER_DARK : STEEL, 6);
      }
      if (style === 'wood' && b < bays) {
        const qn = sp.from + (len * (b + 1)) / bays, [x0, z0] = at(L, q, w / 2 - 0.15), [x1, z1] = at(L, qn, w / 2 - 0.15);
        const g0 = Math.max(ground(x0, z0), water(x0, z0) ?? -1e9), g1 = Math.max(ground(x1, z1), water(x1, z1) ?? -1e9);
        const t0 = y(q) - thick, t1 = y(qn) - thick;
        if (t0 - g0 > 0.8 && t1 - g1 > 0.8) for (const side of [1, -1]) { const a = at(L, q, side * (w / 2 - 0.12)), c = at(L, qn, side * (w / 2 - 0.12)); soup.rod([a[0], g0 + 0.2, a[1]], [c[0], t1 - 0.1, c[1]], 0.04, TIMBER_DARK, 4); }
      }
    }
    // stringers under the deck
    for (const side of [1, -1]) for (let k = 0; k < n; k++) { const a = P(qs[k], side * (w / 2 - 0.15), -thick - 0.2), b = P(qs[k + 1], side * (w / 2 - 0.15), -thick - 0.2); soup.beam(a, b, 0.16, 0.2, style === 'wood' ? TIMBER : STEEL); }
  }
}

export type RGBc = RGB;
