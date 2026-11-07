// Ground cover recipe (lane W4): where tall grass, short tufts and wildflowers grow in an entity world, and how tall,
// dense and what colour, as a pure function of the world model (ground palette, terrain, water, areas, footprints).
// Old Eden drew its field from a hand-painted mask (WorldGroundDetails.ts); here the same look comes from the world's
// own recipe, so every world gets it, god-built ones included:
//  - the ground palette sets the base (meadow and grass grow it, garden a little less; desert, dust, sand, snow, rock and
//    playa grow none), shore, water, steep rock and snow stay bare;
//  - areas say what kind of ground it is: a meadow (any area def tagged `meadow`) grows tall grass thick with wildflowers,
//    woodland a thinner, taller understory, a mown lawn only short tufts with a few daisies (its rim is left long),
//    sand/gravel/bed areas nothing; zones thin it in civic and market places and let it grow wild in `wild` ones;
//  - paths, roads, paved areas, pitches, beds and every footprint are kept clear (the scatters' own blocked-ground test,
//    ecology.mesh.ts), and their verges grow a little longer with flowers: the meadow edges;
//  - drifts: value noise makes the tall grass come in swathes and the flowers in single-colour drifts.
// Candidates are dealt per 8 m cell from a fixed hash, so the same blade is always in the same place, and each cell's
// instances are sorted by a random rank: the renderer keeps a prefix per cell and thins the rest with distance.
import * as THREE from 'three';
import { levelAmong, watersNear } from '@souls/ground';
import type { Entity, WorldModel } from '@souls/world-compiler';
import { blockTest, inPoly, shapeBox, shapeHits, type BlockCells, type BlockShape } from './block-test.ts';
import { terrainColorFor, groundRealismFor } from './ground-palette.ts';

export const COVER_CELL = 8;
/** Instance kinds: tall grass clumps, short tufts, wildflowers. */
export const KINDS = ['tall', 'tuft', 'flower'] as const;
export type CoverKind = (typeof KINDS)[number];
/** Candidate grid step (m) per kind: one candidate per sub-cell, kept with the site's density. */
const STEP: Record<CoverKind, number> = { tall: 0.62, tuft: 0.42, flower: 0.7 };

/** What the palette grows on open ground: tall-grass density, tuft density, flower density, tall height (m). */
const PALETTE: Record<string, { tall: number; tuft: number; flower: number; h: number; rockFrom: number; snow: number }> = {
  meadow: { tall: 0.16, tuft: 0.85, flower: 0.12, h: 0.55, rockFrom: 0.75, snow: 150 },
  grass: { tall: 0.1, tuft: 0.75, flower: 0.06, h: 0.5, rockFrom: 0.7, snow: 140 },
  garden: { tall: 0.08, tuft: 0.7, flower: 0.1, h: 0.45, rockFrom: 0.85, snow: 160 },
};
/** Flower species colours (petals); drifts pick one dominant species. */
export const FLOWER_COLOURS = ['#f6f3ea', '#f3cf3f', '#d8402e', '#7f93e0', '#b27ad6', '#f08cb6', '#f6f3ea', '#ffb347'];

type Area = { kind: 'bare' | 'lawn' | 'mown' | 'meadow' | 'forest' | 'zone'; use: string; poly: [number, number][]; bb: [number, number, number, number]; edge: number; size: number; color?: string };
export type CoverIndex = {
  model: WorldModel; palette: string; realism: boolean; base: number;
  blocked: (x: number, z: number) => boolean;
  /** The blocked test narrowed to one rectangle's shapes (a cell deals a few hundred candidates against them). */
  blockedIn: (x0: number, z0: number, x1: number, z1: number) => (x: number, z: number) => boolean;
  areas: Map<string, Area[]>;
  colour: (c: THREE.Color, y: number, slope: number, base: number, x?: number, z?: number) => void;
};

const AREA_CELL = 32;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export function h01(a: number, b = 0, c = 0): number { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0; return h / 4294967296; }
/** Smooth value noise, lattice 1, 0..1. */
export function vn(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h01(xi, zi, seed), b = h01(xi + 1, zi, seed), c = h01(xi, zi + 1, seed), d = h01(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// The realism ground shader's lush / sun-dried macro field (WorldEdenRealism.ts edenHash / edenNoise), so a blade takes
// the tone of the turf it stands in.
const fr = Math.fround, fract = (v: number) => v - Math.floor(v);
function edenHash(x: number, y: number) { let px = fract(fr(x * 123.34)), py = fract(fr(y * 456.21)); const d = px * (px + 45.32) + py * (py + 45.32); px = fr(px + d); py = fr(py + d); return fract(fr(px * py)); }
function edenNoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = edenHash(ix, iy), b = edenHash(ix + 1, iy), c = edenHash(ix, iy + 1), d = edenHash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy;
}
export const realismMacro = (x: number, z: number) => edenNoise(x * 0.045, z * 0.045) * 0.65 + edenNoise(x * 0.14 + 7.3, z * 0.14 + 7.3) * 0.35;

/** Does this palette grow anything? */
export const coverPalette = (palette: string | undefined) => !!PALETTE[palette ?? 'grass'];

/** The world's cover index: its palette, blocked ground and areas by 32 m cell. `blocked` is the scatters' own test. */
export function coverIndex(model: WorldModel, blockedCells: BlockCells, blockCell: number): CoverIndex {
  const palette = (model.state as { ground?: { palette?: string } }).ground?.palette ?? 'grass';
  const areas = new Map<string, Area[]>();
  const put = (a: Area) => { for (let gz = Math.floor(a.bb[1] / AREA_CELL); gz <= Math.floor(a.bb[3] / AREA_CELL); gz++) for (let gx = Math.floor(a.bb[0] / AREA_CELL); gx <= Math.floor(a.bb[2] / AREA_CELL); gx++) { const k = `${gx},${gz}`; const l = areas.get(k); if (l) l.push(a); else areas.set(k, [a]); } };
  for (const e of model.entities.values()) {
    if (!e.shape || !('area' in e.shape)) continue;
    const def = model.resolvedDef(e.def); if (!def) continue;
    const kind = areaKind(e, def); if (!kind) continue;
    const poly = e.shape.area as [number, number][]; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    put({ kind, use: String(e.params?.use ?? ''), poly, bb: [x0, z0, x1, z1], edge: num(e.params?.edge, 1), size: (x1 - x0) * (z1 - z0), ...(typeof e.params?.color === 'string' ? { color: e.params.color } : {}) });
  }
  for (const l of areas.values()) l.sort((a, b) => a.size - b.size);   // the smallest area that holds a point speaks for it
  return { model, palette, realism: groundRealismFor(palette), base: model.constants.base ?? 0, blocked: blockTest(blockedCells, blockCell, '\u0000cover'), blockedIn: (x0, z0, x1, z1) => narrowBlock(blockedCells, blockCell, x0, z0, x1, z1), areas, colour: terrainColorFor(palette) };
}
function narrowBlock(cells: BlockCells, C: number, x0: number, z0: number, x1: number, z1: number) {
  const hit = new Set<BlockShape>();
  for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) for (const s of cells.get(`${gx},${gz}`) ?? []) {
    if (hit.has(s)) continue; const b = shapeBox(s); if (b[0] <= x1 && b[2] >= x0 && b[1] <= z1 && b[3] >= z0) hit.add(s);
  }
  const list = [...hit];
  return list.length ? (x: number, z: number) => { for (const s of list) if (shapeHits(s, x, z)) return true; return false; } : () => false;
}
function areaKind(e: Entity, def: NonNullable<ReturnType<WorldModel['resolvedDef']>>): Area['kind'] | null {
  const gen = def.make.kind === 'gen' ? def.make.gen : '', tags = def.tags ?? [];
  if (gen === 'lawn/1') { const mat = String(e.params?.material ?? 'grass'); return mat === 'grass' || mat === 'moss' ? (e.params?.stripes === true ? 'mown' : 'lawn') : 'bare'; }
  if (gen === 'garden-bed/1' || gen === 'lake/1' || gen === 'shore/1' || tags.includes('garden') && gen.startsWith('scatter')) return 'bare';
  if (tags.includes('meadow') || /meadow|wildflower/.test(def.name)) return 'meadow';
  if (tags.includes('forest') || tags.includes('orchard')) {
    // a "woodland" planted only with grass, flowers and stones is ground cover, not a wood
    const pal = e.params?.palette;
    if (Array.isArray(pal) && pal.length && !pal.some((k) => !/^(grass|flower|rock|stone|boulder|tuft)/.test(String((k as { kind?: unknown })?.kind ?? '')))) return null;
    return 'forest';
  }
  if (gen === 'zone/1' || def.name === 'core-zone' || tags.includes('zone')) return 'zone';
  return null;
}

export type Site = { tall: number; tuft: number; flower: number; h: number; short: number; r: number; g: number; b: number; dry: number; drift: number };
const _c = new THREE.Color();
/** The ground at (x, z): null where nothing grows, else densities 0..1, tall height and the turf colour. */
export function siteAt(ix: CoverIndex, x: number, z: number, verge: boolean): Site | null {
  const P = PALETTE[ix.palette]; const m = ix.model, g = m.ground();
  if (x < g.extent[0] || x >= g.extent[2] || z < g.extent[1] || z >= g.extent[3]) return null;
  const y = m.terrain.sample(x, z), h = y - ix.base;
  if (h < -0.15) return null;                                        // shore, banks below the plain, beds
  const lvl = levelAmong(watersNear(g, x - 1, z - 1, x + 1, z + 1), g.seaLevel, x, z); if (lvl !== null && y < lvl + 0.08) return null;
  let area: Area | null = null; const list = ix.areas.get(`${Math.floor(x / AREA_CELL)},${Math.floor(z / AREA_CELL)}`);
  let zone: Area | null = null, cover: Area | null = null;
  if (list) for (const a of list) {
    if (x < a.bb[0] || x > a.bb[2] || z < a.bb[1] || z > a.bb[3] || !inPoly(x, z, a.poly)) continue;
    if (a.kind === 'bare') return null;
    if (a.kind === 'zone') { zone ??= a; continue; }
    if (a.kind === 'lawn' || a.kind === 'mown') { area ??= a; continue; }
    cover ??= a;
  }
  if (!P && !cover) return null;                                     // desert-like ground: only an explicit meadow grows
  const p = P ?? PALETTE.grass;
  const slope = m.terrain.slope(x, z), steep = 1 - ss(p.rockFrom * 0.55, p.rockFrom, slope);
  const high = h > p.snow ? 0 : 1 - 0.65 * ss(40, 110, h);
  let base = steep * high; if (base <= 0) return null;
  // swathes of long grass with shorter gaps between them; flowers in drifts
  const drift = vn(x / 13 + 0.37, z / 13 + 0.71, 5), swathe = 0.1 + 1.9 * ss(0.4, 0.8, drift);
  let short = 1, lawnTint = 0, tall = p.tall * swathe, tuft = p.tuft, flower = p.flower * (0.4 + 1.2 * vn(x / 9, z / 9, 9)), ht = p.h * (0.8 + 0.4 * drift);
  if (cover?.kind === 'meadow') { tall = 0.75 * (0.45 + 0.3 * swathe); flower = 0.55 * (0.35 + 0.65 * vn(x / 7, z / 7, 9)); ht = p.h * 1.15 * (0.85 + 0.3 * drift); tuft = 0.5; }
  else if (cover?.kind === 'forest') { tall *= 0.9; ht *= 1.1; flower *= 0.4; tuft = 0.45; }
  if (zone) {
    const use = zone.use;
    if (use === 'civic' || use === 'commercial' || use === 'residential' || use === 'industrial') { tall *= 0.3; flower *= 0.6; }
    else if (use === 'wild') { tall = Math.min(1, tall * 1.3); ht *= 1.15; }
    else if (use === 'farm') { tall *= 0.75; }
  }
  if (area) {
    // a lawn is mown short; its ragged rim (the lawn's own soft edge) is left long, as at old Eden's field
    let d = Infinity; const poly = area.poly;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, az] = poly[j], [bx, bz] = poly[i], vx = bx - ax, vz = bz - az, n = vx * vx + vz * vz; const t = n ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / n)) : 0; d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t)); }
    const rim = 1 - ss(area.edge * 0.6, area.edge + 1.2, d);
    tall = Math.max(tall, 0.45) * rim; ht *= 0.75 + 0.25 * rim;
    tuft = area.kind === 'mown' ? 0.6 : 0.55; short = (area.kind === 'mown' ? 0.5 : 0.65) + (area.kind === 'mown' ? 0.5 : 0.35) * rim; lawnTint = area.color ? 1 - rim : 0; flower = Math.max(flower * rim, area.kind === 'mown' ? 0.035 : 0.03);
  }
  if (verge) { tall = Math.max(tall, zone && (zone.use === 'civic' || zone.use === 'commercial') ? 0.2 : area ? tall : 0.5); flower = Math.max(flower, area ? flower : 0.2); ht *= 1.08; }
  tall *= base; tuft *= base; flower *= base;
  // turf colour: the terrain's own paint, times the realism shader's lush/dry field on Eden's meadow
  ix.colour(_c, y, slope, ix.base, x, z);
  let r = _c.r, gg = _c.g, b = _c.b, dry = 0.5;
  if (lawnTint > 0) { _c.set(area!.color!); r += (_c.r - r) * lawnTint; gg += (_c.g - gg) * lawnTint; b += (_c.b - b) * lawnTint; }   // a lawn's own green
  if (ix.realism) {
    const macro = realismMacro(x, z), t = ss(0.28, 0.78, macro), k = 0.82 + 0.3 * macro; dry = t;
    r *= (0.74 + 0.5 * t) * k; gg *= (0.97 + 0.11 * t) * k; b *= (0.86 - 0.16 * t) * k;
  }
  return { tall, tuft, flower, h: ht, short, r, g: gg, b, dry, drift };
}

/** One cell's sites: a 2 m grid (the terrain picture's own vertex step, so heights interpolate onto its surface) (5 × 5) of siteAt, verges marked where a path, paving or footprint is within 1.3 m. */
export type CellSites = (Site | null)[] & { y?: Float32Array };
export function cellSites(ix: CoverIndex, ci: number, cj: number): CellSites {
  const x0 = ci * COVER_CELL, z0 = cj * COVER_CELL, S = SITES, sites: CellSites = [], y = new Float32Array((S + 1) * (S + 1));
  const blocked = ix.blockedIn(x0 - 1.4, z0 - 1.4, x0 + COVER_CELL + 1.4, z0 + COVER_CELL + 1.4), near = (x: number, z: number) => blocked(x + 1.3, z) || blocked(x - 1.3, z) || blocked(x, z + 1.3) || blocked(x, z - 1.3);
  for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) { const x = x0 + (i * COVER_CELL) / S, z = z0 + (j * COVER_CELL) / S; y[j * (S + 1) + i] = ix.model.terrain.sample(x, z); sites.push(siteAt(ix, x, z, blocked(x, z) || near(x, z))); }
  sites.y = y; return sites;
}
const SITES = 4;
/** Floats per dealt instance: x, y, z, yaw, width scale, height scale, r, g, b, rank. */
export const REC = 10;
/** Deal one kind in one 8 m cell from its sites: records of REC floats sorted by rank (the renderer keeps a prefix). */
export function cellKind(ix: CoverIndex, ci: number, cj: number, k: number, sites: CellSites): Float32Array {
  const x0 = ci * COVER_CELL, z0 = cj * COVER_CELL, S = SITES, m = ix.model, blocked = ix.blockedIn(x0, z0, x0 + COVER_CELL, z0 + COVER_CELL);
  const Y = sites.y, G = COVER_CELL / S;
  // ground height: bilinear on the 2 m site grid (where the terrain picture's vertices are), else an exact sample
  const yAt = (x: number, z: number) => {
    if (!Y) return m.terrain.sample(x, z);
    const u = (x - x0) / G, v = (z - z0) / G, i = Math.min(S - 1, Math.floor(u)), j = Math.min(S - 1, Math.floor(v)), fu = u - i, fv = v - j, o = j * (S + 1) + i;
    const h = (Y[o] * (1 - fu) + Y[o + 1] * fu) * (1 - fv) + (Y[o + S + 1] * (1 - fu) + Y[o + S + 2] * fu) * fv;
    return Number.isFinite(h) ? h : m.terrain.sample(x, z);
  };
  const at = (x: number, z: number) => sites[Math.round(((z - z0) / COVER_CELL) * S) * (S + 1) + Math.round(((x - x0) / COVER_CELL) * S)];
  const kind = KINDS[k], step = STEP[kind], n1 = Math.round(COVER_CELL / step), list: number[][] = [];
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
    const gi = ci * n1 + i, gj = cj * n1 + j;
    const x = x0 + (i + 0.1 + 0.8 * h01(gi, gj, 11 + k)) * step, z = z0 + (j + 0.1 + 0.8 * h01(gi, gj, 21 + k)) * step;
    const s = at(x, z); if (!s) continue;
    const want = kind === 'tall' ? s.tall : kind === 'tuft' ? s.tuft : s.flower;
    if (h01(gi, gj, 31 + k) >= want || blocked(x, z)) continue;
    const y = yAt(x, z); if (!Number.isFinite(y)) continue;
    const v = h01(gi, gj, 41 + k), w = h01(gi, gj, 51 + k);
    let r = s.r, g = s.g, b = s.b, sc = 1, ht = 1;
    if (kind === 'tall') {
      sc = 0.8 + 0.5 * v; ht = s.h * (0.7 + 0.6 * w);
      const tone = 0.9 + 0.22 * h01(gi, gj, 61); r *= tone; g *= tone; b *= tone;
      // in the sun-dried swathes some clumps have gone to straw
      if (s.dry > 0.55 && h01(gi, gj, 71) < (s.dry - 0.55) * 1.6) { r = r * 0.55 + 0.42 * 0.45; g = g * 0.55 + 0.36 * 0.45; b = b * 0.55 + 0.16 * 0.45; }
    } else if (kind === 'tuft') { sc = 0.75 + 0.6 * v; ht = (0.6 + 0.9 * w) * s.short; const tone = 0.92 + 0.16 * h01(gi, gj, 62); r *= tone; g *= tone; b *= tone; }
    else {
      // a drift's own species most of the time, now and then another
      const dom = Math.floor(vn(x / 6 + 3.1, z / 6 + 1.7, 13) * FLOWER_COLOURS.length * 0.999), sp = h01(gi, gj, 81) < 0.72 ? dom : Math.floor(h01(gi, gj, 82) * FLOWER_COLOURS.length);
      _c.set(FLOWER_COLOURS[sp]); r = _c.r; g = _c.g; b = _c.b; sc = 0.75 + 0.5 * v; ht = (0.55 + 0.6 * w) * Math.max(0.7, s.h / 0.62);
    }
    list.push([x, y, z, h01(gi, gj, 91 + k) * Math.PI * 2, sc, ht, r, g, b, h01(gi, gj, 101 + k)]);
  }
  list.sort((a, b) => a[9] - b[9]);
  const out = new Float32Array(list.length * REC); list.forEach((p, i) => out.set(p, i * REC));
  return out;
}
/** How many of a cell's records (sorted by rank) have rank below `keep`. */
export function prefix(rec: Float32Array, keep: number): number {
  let lo = 0, hi = rec.length / REC;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rec[mid * REC + 9] < keep) lo = mid + 1; else hi = mid; }
  return lo;
}
