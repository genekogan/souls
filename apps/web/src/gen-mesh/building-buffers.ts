// Geometry-only building job: shared by the page fallback and building.worker.ts.
// Keep layout generation, mesh registration and rendering on the page.
import * as THREE from 'three';
import type { Value } from '@souls/generators';
import type { BuildingLayout } from '../../../../packages/generators/src/building.ts';
import { Builder, hashStr, mix, rng, type Col, type RawSoup } from './building-kit.ts';

type V2 = [number, number];
type Wall = BuildingLayout['walls'][number];
type Opening = BuildingLayout['openings'][number];
export const FLOOR0 = 0.1, SLAB = 0.18;
export const col = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);

/** Facade palettes from eden-facades (trim, base, quoin, shutters, hood) by wall material. */
export const FACADE: Record<string, { trim: string; base: string; quoin: string; shutters: string[]; hood: string }> = {
  brick: { trim: '#ece4d2', base: '#a99d88', quoin: '#d9cdb4', shutters: ['#4f6d5a', '#2f4f6f', '#7a2f2a'], hood: '#3f4a46' },
  plaster: { trim: '#f4eee2', base: '#a7a08f', quoin: '#e4d9c5', shutters: ['#5b7f8c', '#8a6a3a', '#4f6d5a'], hood: '#7a2f2a' },
  wood: { trim: '#5e412b', base: '#8f877a', quoin: '#6e4c32', shutters: ['#355e3b', '#7a2f2a', '#2f4f5f'], hood: '#4a3423' },
  stone: { trim: '#dad3c3', base: '#958d7c', quoin: '#cbc2af', shutters: ['#2f4f5f', '#4f6d5a', '#6a4a6a'], hood: '#3a3f42' },
  glass: { trim: '#f4f4f0', base: '#a7a08f', quoin: '#f4f4f0', shutters: [], hood: '#5e6a6a' },
  metal: { trim: '#d8dadc', base: '#8c9196', quoin: '#b9bdc1', shutters: ['#3f4a46'], hood: '#3f4a46' },
};
const FLOWERS = ['#d9485f', '#f1c84b', '#e86aa8', '#f4f1e8', '#9b6fd1', '#ff8a3d'];
const LEAVES = ['#3f6e33', '#4c7f3c', '#355f2b', '#5a8a3f', '#2f5428'];
/** Interior wall paints (from eden-window-interiors' room shader) by room kind, seeded otherwise. */
const PAINTS = ['#eddbb8', '#f2c7a8', '#bdd1ad', '#b3c7e0', '#f5eddb'];
const ROOM_PAINT: Record<string, string> = { kitchen: '#f3e6c4', bath: '#dfe9ea', bedroom: '#c9d6e6', living: '#efdcc0', hall: '#efe6d4', landing: '#ece4d2', shop: '#f2ead8', nave: '#ece7dc', barn: '#c9a982', loft: '#c9a982', greenhouse: '#eef4ee', reading: '#e4d6b8', stacks: '#e4d6b8', cafe: '#f3ead9' };
const FLOOR_FINISH: Record<string, string> = { kitchen: '#c79e7a', bath: '#d9dcd6', shop: '#b88d60', barn: '#a08060', loft: '#b08b5a', greenhouse: '#9e968a', entrance: '#b9b3a6', nave: '#c8bfae', pavilion: '#a77c52', reading: '#b49c7c', stacks: '#b49c7c', cafe: '#9f7e5e' };

/** Lane W1: everything a building's geometry depends on, as plain data (it crosses to building.worker.ts). */
export type BuildingJob = { L: BuildingLayout; params: Record<string, Value>; presetTrim: unknown; paint: string; seed: number };
export type BuildingBuffers = { raw: RawSoup[]; tris: number; anchors: [number, number, number][] };
/** The geometry half of a building: the finest detail level within 6000 triangles. Pure; runs here or in a worker. */
export function buildingBuffers(job: BuildingJob): BuildingBuffers {
  let b: Builder | null = null;
  for (const detail of [2, 1, 0]) { b = drawBuilding(job.L, job.params, job.presetTrim, job.paint, job.seed, detail); if (b.tris() <= 6000 || detail === 0) break; }
  return { raw: b!.raw(), tris: b!.tris(), anchors: b!.anchors };
}
function drawBuilding(L: BuildingLayout, p: Record<string, Value>, presetTrim: unknown, paint: string, seed: number, detail: number): Builder {
  const b = new Builder(), r = rng(seed);
  const mat = L.material in FACADE ? L.material : 'plaster', F = FACADE[mat];
  const trim = col(p.trim, F.trim === '#f4eee2' ? '#6b4a2b' : F.trim), roofCol = col(p.roofColor, '#8a3b2a');
  // Keep the library's original sill palette at its preset trim; an authored trim change dresses
  // sills and lintels too, instead of leaving cream stone on Gothic/Japanese facades.
  const sillTrim = p.trim !== undefined && p.trim !== presetTrim ? trim : F.quoin;
  const glassWalls = mat === 'glass';
  const lighthouse = !!L.args.lantern;
  const extOf = (floor: number) => (lighthouse && floor % 2 === 1 ? trim : paint);
  const roomPaint = (id: string | null) => { if (!id) return paint; const room = L.rooms.find((x) => x.id === id); return ROOM_PAINT[room?.kind ?? ''] ?? PAINTS[hashStr(id) % PAINTS.length]; };
  const shutter = F.shutters.length ? F.shutters[Math.floor(r() * F.shutters.length)] : trim;
  const fy = (k: number) => k * L.fh + FLOOR0;
  const at = (k: number) => `level-${k}`;

  // ---- plinth, floors, ceilings
  const outline = L.round ? ngon(L.round.R + L.t / 2 + 0.06, L.round.sides) : rectPoly(-L.W / 2 - 0.06, -L.D / 2 - 0.06, L.W / 2 + 0.06, L.D / 2 + 0.06);
  b.group = at(0);
  b.slab(outline, 0, FLOOR0 - 0.02, F.base, 'floor');
  for (const lv of L.levels) {
    b.group = at(lv.floor);
    for (const q of lv.polys) {
      const kind = L.rooms.find((x) => x.id === q.room)?.kind ?? '';
      const finish = FLOOR_FINISH[kind] ?? mix('#a77c52', '#c49a63', (hashStr(q.room) % 100) / 200);
      if (lv.floor === 0) b.slab(q.poly, FLOOR0 - 0.02, 0.02, finish, 'floor');
      else { b.group = `slab-${lv.floor}`; b.slab(q.poly, lv.y - SLAB, SLAB, finish, 'floor'); b.slab(q.poly, lv.y - SLAB - 0.005, 0.006, '#f4efe6', 'wall'); b.group = at(lv.floor); }
    }
  }
  // a glass house (greenhouse, palm house) has no ceiling slab under its glass roof: the beds inside show from outside
  if (!L.open && L.roof !== 'none' && !glassWalls) { b.group = `slab-${L.floors}`;   // roof none = open-topped walls (the Mars camp rooms)
    b.slab(L.round ? ngon(L.round.R + L.t / 2, L.round.sides) : rectPoly(-L.W / 2, -L.D / 2, L.W / 2, L.D / 2), L.wallTop - 0.1, 0.12, '#f4efe6', 'wall');
    b.markTopCeiling(); // actual roof assembly; never base/intermediate floor soups
  }

  // ---- walls with openings
  L.walls.forEach((w, wi) => drawWall(b, L, w, L.openings.filter((o) => o.wall === wi), { ext: extOf(w.floor), trim, sillTrim, quoin: F.quoin, roomPaint, glassWalls, shutter, r, detail, mat, F, fy }));

  // ---- facade details: plinth band, string courses, cornice, corners
  if (!L.open) facade(b, L, { trim, quoin: F.quoin, base: F.base, mat, r, detail, ext: paint, lighthouse });

  // ---- stairs and rails
  for (const st of L.stairs) { b.group = at(st.from); drawStairs(b, L, st, trim, detail); }
  for (const rl of L.rails) {
    const k = Math.max(0, Math.min(L.floors - 1, Math.round((rl.y0 - FLOOR0) / L.fh)));
    b.group = at(k);
    const h = rl.y1 - rl.y0, len = Math.hypot(rl.b[0] - rl.a[0], rl.b[1] - rl.a[1]);
    b.run(rl.a[0], rl.a[1], rl.b[0], rl.b[1], rl.y0 + h - 0.06, 0.06, 0.07, trim);
    if (len > 1.6 && detail >= 1) b.run(rl.a[0], rl.a[1], rl.b[0], rl.b[1], rl.y0 + h * 0.45, 0.04, 0.04, trim);
    const posts = Math.max(2, Math.ceil(len / (detail >= 1 ? 2 : 3.2)) + 1);
    for (let i = 0; i < posts - 1; i++) { const t = i / (posts - 1); b.box(rl.a[0] + (rl.b[0] - rl.a[0]) * t, rl.y0, rl.a[1] + (rl.b[1] - rl.a[1]) * t, 0.06, h - 0.03, 0.06, trim); }
  }

  // ---- porch, balcony, pavilion posts
  if (L.porch) {
    b.group = at(0);
    const [x0, z0, x1, z1] = bboxOf(L.porch.poly);
    b.box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, FLOOR0, z1 - z0, '#a07a52', 'floor');
    for (let x = x0 + 0.4; x < x1 - 0.2; x += 0.45) b.box(x, FLOOR0 - 0.005, (z0 + z1) / 2, 0.02, 0.01, z1 - z0 - 0.04, '#8a6644', 'floor');
    b.box(0, 0, z1 + 0.18, Math.min(2.2, x1 - x0), FLOOR0 * 0.55, 0.36, F.base, 'floor');
    // a veranda under a balcony gets a flat roof at the balcony's level; otherwise a lean-to
    const under = L.balcony && !L.balcony.ring && L.balcony.floor === 1;
    const roofY = under ? fy(1) - SLAB - 0.02 : Math.min(L.fh - 0.12, 2.9), lowY = under ? roofY : Math.min(roofY - 0.25, 2.55);
    for (const post of L.posts) { b.cyl(post.c[0], FLOOR0, post.c[1], 0.075, 0.09, lowY - FLOOR0, trim, 'trim', 8); b.box(post.c[0], FLOOR0, post.c[1], 0.22, 0.12, 0.22, F.base); }
    const run = z1 - z0 + 0.3, drop = roofY - lowY, ang = Math.atan2(drop, run);
    b.group = under ? at(1) : 'roof';
    if (under) b.box(0, roofY, (z0 + z1 + 0.3) / 2, x1 - x0 + 0.3, 0.14, run, '#b9b3a6', 'floor');
    else b.tilt(0, (roofY + lowY) / 2 + 0.12, (z0 + z1 + 0.3) / 2, x1 - x0 + 0.4, 0.1, Math.hypot(run, drop) + 0.1, ang, 0, roofCol, 'roof');
    b.group = at(0);
    b.box(0, lowY - 0.18, z1 - 0.15, x1 - x0, 0.18, 0.14, trim);
  }
  if (L.balcony) {
    b.group = at(L.balcony.floor);
    for (const q of L.balcony.polys) b.slab(q, L.balcony.y - 0.16, 0.16, '#b9b3a6', 'floor');
    if (L.balcony.rect && !L.porch) { const [x0, , x1, z1] = L.balcony.rect; for (const x of [x0 + 0.25, x1 - 0.25]) b.tilt(x, L.balcony.y - 0.45, z1 - 0.55, 0.1, 0.12, 0.9, -0.6, 0, trim); }
  }
  if (L.open) {
    b.group = at(0);
    for (const post of L.posts) { b.cyl(post.c[0], FLOOR0, post.c[1], 0.1, 0.12, L.fh - FLOOR0, trim, 'trim', 8); b.box(post.c[0], FLOOR0, post.c[1], 0.3, 0.14, 0.3, F.base); }
    const y = L.fh - 0.25, hx = L.W / 2 - 0.15, hz = L.D / 2 - 0.15;
    b.run(-hx, -hz, hx, -hz, y, 0.25, 0.16, trim).run(-hx, hz, hx, hz, y, 0.25, 0.16, trim).run(-hx, -hz, -hx, hz, y, 0.25, 0.16, trim).run(hx, -hz, hx, hz, y, 0.25, 0.16, trim);
  }

  // ---- roof
  b.group = 'roof';
  drawRoof(b, L, { roofCol, trim, ext: paint, glass: glassWalls, r, detail });

  // ---- lit lantern (lighthouse) and a lamp in every room
  if (lighthouse) { b.group = at(L.floors - 1); b.cyl(0, fy(L.floors - 1) + 0.9, 0, 0.35, 0.35, 0.8, '#fff3c9', 'glow', 10); b.cyl(0, fy(L.floors - 1), 0, 0.25, 0.4, 0.9, '#3b3d40', 'trim', 8); }
  for (const room of L.rooms) {
    if (L.open || detail < 1) break;
    b.group = at(room.floor);
    const [cx, cz] = room.centre, top = room.y + room.height - 0.05;
    b.cyl(cx, top - 0.5, cz, 0.012, 0.012, 0.5, '#3b3d40', 'trim', 4);
    b.cone(cx, top - 0.72, cz, 0.2, 0.22, '#ffd99a', 'glow', 8);
  }

  return b;
}

type WallOpts = { ext: string; trim: string; sillTrim: string; quoin: string; roomPaint: (id: string | null) => string; glassWalls: boolean; shutter: string; r: () => number; detail: number; mat: string; F: (typeof FACADE)[string]; fy: (k: number) => number };

/** One wall run: two skins (outside / inside colours, or room paints either side), cut at its openings, then dressed. */
function drawWall(b: Builder, L: BuildingLayout, w: Wall, ops: Opening[], o: WallOpts) {
  b.group = `level-${w.floor}`;
  const ux = w.b[0] - w.a[0], uz = w.b[1] - w.a[1], len = Math.hypot(ux, uz) || 1;
  const yaw = Math.atan2(-uz / len, ux / len);
  // local +z after the yaw is (-uz, ux); find which room sits there
  const lz: V2 = [-uz / len, ux / len];
  const posN: V2 = w.axis === 'x' ? [0, 1] : w.axis === 'z' ? [1, 0] : (w.out ?? [0, 1]);
  const plusIsPos = lz[0] * posN[0] + lz[1] * posN[1] > 0;
  const posCol = w.pos ? o.roomPaint(w.pos) : o.ext, negCol = w.neg ? o.roomPaint(w.neg) : o.ext;
  const [plusCol, minusCol] = plusIsPos ? [posCol, negCol] : [negCol, posCol];
  // outward (for frames): local +z or -z
  const outSign = w.exterior ? (w.out ? (lz[0] * w.out[0] + lz[1] * w.out[1] > 0 ? 1 : -1) : 1) : 1;
  const T = w.thick, H = w.y1 - w.y0, base = FLOOR0 + w.floor * L.fh - w.y0;
  b.push(w.a[0], w.y0, w.a[1], yaw);
  const reveal = w.exterior ? o.ext : plusCol;
  const seg = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
    if (o.glassWalls && w.exterior) { b.face([s0, y0, 0], [s1, y0, 0], [s1, y1, 0], [s0, y1, 0], '#dff0ec', 'glass'); return; }
    b.wallSlab(s0, s1, y0, y1, -T / 2, T / 2, plusCol, minusCol, { outer: w.exterior ? outSign : 0, top: y1 < H - 1e-3 || w.floor === L.floors - 1 ? reveal : undefined, bottom: y0 > 1e-3 ? reveal : undefined, ends: reveal, endL: s0 > 1e-3, endR: s1 < len - 1e-3 });
  };
  const sorted = [...ops].sort((a, c) => a.s - c.s);
  let x = 0;
  for (const op of sorted) {
    const a = op.s - op.width / 2, c = op.s + op.width / 2, sill = base + op.sill, top = base + op.sill + op.height;
    seg(x, a, 0, H); seg(a, c, 0, op.sill > 0 ? sill : 0); seg(a, c, top, H);
    x = c;
  }
  seg(x, len, 0, H);
  if (o.glassWalls && w.exterior) {
    // greenhouse: slender frames every ~1.1 m and a base board
    const n = Math.max(1, Math.round(len / 1.1));
    for (let i = 0; i <= n; i++) b.box((len * i) / n, 0, 0, 0.05, H, 0.07, o.trim);
    b.box(len / 2, 0, 0, len, 0.45, T * 0.6, o.F.base, 'wall'); b.box(len / 2, H - 0.06, 0, len, 0.06, 0.08, o.trim);
  }
  for (const op of sorted) dressOpening(b, L, w, op, { ...o, outSign, base });
  b.pop();
}

/** Frames, glass, sills, lintels, shutters, flower boxes (windows); jambs, a leaf, hood and step (doors). Wall-local frame. */
function dressOpening(b: Builder, L: BuildingLayout, w: Wall, op: Opening, o: WallOpts & { outSign: number; base: number }) {
  const T = w.thick, sOut = o.outSign, face = sOut * (T / 2 + 0.015);
  const sill = o.base + op.sill, top = sill + op.height, cx = op.s, hw = op.width / 2;
  const r = o.r, framed = !o.glassWalls || !w.exterior;
  if (op.kind === 'window') {
    // E2C: an outside window's pane carries its size and outdoor side, so at night a room shows behind it (building-windows.ts)
    b.pane = w.exterior && framed ? { w: op.width, h: op.height, sill: op.sill, out: sOut } : null;
    b.face([cx - hw, sill, 0], [cx + hw, sill, 0], [cx + hw, top, 0], [cx - hw, top, 0], '#bcd6e0', 'glass');
    b.pane = null;
    if (!framed) return;
    const fc = w.exterior ? o.trim : '#f4efe6', ft = 0.07;
    b.box(cx - hw + ft / 2, sill, face * 0.6, ft, op.height, T * 0.5, fc);
    b.box(cx + hw - ft / 2, sill, face * 0.6, ft, op.height, T * 0.5, fc);
    b.box(cx, top - ft, face * 0.6, op.width, ft, T * 0.5, fc);
    const tall = op.height > 2.2;
    if ((op.width > 1.05 || op.height > 1.6) && !tall && o.detail >= 1) b.box(cx, sill, 0, 0.05, op.height, 0.05, fc);
    if (op.height > 1.1 && op.width > 0.7 && !tall && o.detail >= 1) b.box(cx, sill + op.height * 0.62, 0, op.width, 0.045, 0.05, fc);
    if (!w.exterior || (o.detail < 1 && L.round)) return; // round towers at the lowest detail: the string courses frame them
    // sill and lintel (eden-facades), shutters and flower boxes on some
    b.box(cx, sill - 0.07, sOut * (T / 2 + 0.03), op.width + 0.2, 0.08, 0.16, o.sillTrim);
    b.box(cx, top, sOut * (T / 2 + 0.02), op.width + 0.24, 0.14, 0.08, o.mat === 'wood' ? o.trim : o.sillTrim);
    b.optional(L.params.shutters !== false, () => {
      if (o.detail >= 1 && L.round === undefined && op.width <= 1.4 && op.height <= 1.9 && o.mat !== 'stone' && o.F.shutters.length && r() < 0.65) {
        const sw = Math.min(0.5, op.width / 2);
        for (const sd of [-1, 1]) {
          const x = cx + sd * (hw + sw / 2 + 0.04);
          b.box(x, sill, sOut * (T / 2 + 0.03), sw, op.height, 0.04, o.shutter);
          if (o.detail >= 2) b.face([x - sw / 2 + 0.05, sill + op.height * 0.5, sOut * (T / 2 + 0.051)], [x + sw / 2 - 0.05, sill + op.height * 0.5, sOut * (T / 2 + 0.051)], [x + sw / 2 - 0.05, sill + op.height * 0.53, sOut * (T / 2 + 0.051)], [x - sw / 2 + 0.05, sill + op.height * 0.53, sOut * (T / 2 + 0.051)], '#2b2b2b', 'trim');
        }
      }
    });
    b.optional(L.params.flowerBoxes !== false, () => {
      if (o.detail >= 2 && w.floor === 0 && op.sill > 0.4 && op.sill < 1.4 && r() < 0.5) {
        b.box(cx, sill - 0.3, sOut * (T / 2 + 0.13), op.width + 0.06, 0.18, 0.2, '#6e4a30');
        for (let k = 0; k < 4; k++) { const fx = cx - hw + 0.1 + ((op.width - 0.2) * (k + 0.5)) / 4; b.ball(fx, sill - 0.08 + r() * 0.04, sOut * (T / 2 + 0.13), 0.075, 0.06, 0.07, k % 2 ? LEAVES[k % LEAVES.length] : FLOWERS[Math.floor(r() * FLOWERS.length)]); }
      }
    });
    return;
  }
  if (op.kind !== 'door') return;
  // jambs and head on both faces
  const jc = w.exterior ? o.trim : '#d8cbb1';
  for (const sd of [-1, 1]) b.box(cx + sd * (hw + 0.035), o.base, 0, 0.07, op.height + 0.07, T + 0.04, jc);
  b.box(cx, o.base + op.height, 0, op.width + 0.14, 0.08, T + 0.04, jc);
  // the leaf, standing open into the room (hinged on the left jamb)
  const leafW = op.width - 0.04, swing = sOut * 1.25;
  b.at(cx - hw + 0.02, o.base, 0, 0, () => b.at(0, 0, 0, swing, () => b.box(leafW / 2, 0, -sOut * 0.03, leafW, op.height - 0.02, 0.05, w.exterior ? mix(o.trim, '#5e412b', 0.4) : '#a77c52')));
  if (!w.exterior || op.to === 'balcony') return;
  if (o.glassWalls) { b.box(cx, 0, sOut * (T / 2 + 0.25), op.width + 0.5, FLOOR0 + 0.02, 0.5, o.F.base); return; }
  // hood on brackets and a step (eden-facades), a lamp beside the door
  if (L.params.hood !== false) {
    b.tilt(cx, o.base + op.height + 0.32, sOut * 0.38, op.width + 0.6, 0.06, 0.62, sOut * 0.2, 0, o.F.hood);
    for (const sd of [-1, 1]) b.box(cx + sd * (hw + 0.22), o.base + op.height + 0.04, sOut * 0.17, 0.06, 0.24, 0.3, o.trim);
  }
  if (!L.porch || w.side !== 's') b.box(cx, 0, sOut * (T / 2 + 0.25), op.width + 0.5, FLOOR0 + 0.02, 0.5, o.F.base);
  if (o.detail >= 1 && L.params.doorLamp !== false) { b.box(cx + hw + 0.4, o.base + 1.75, sOut * (T / 2 + 0.06), 0.05, 0.05, 0.12, '#3b3d40'); b.box(cx + hw + 0.4, o.base + 1.58, sOut * (T / 2 + 0.14), 0.12, 0.2, 0.12, '#ffd99a', 'glow'); }
}

/** Plinth band, string courses between storeys, cornice at the top, quoins or pilasters at corners, a downpipe, ivy. */
function facade(b: Builder, L: BuildingLayout, o: { trim: string; quoin: string; base: string; mat: string; r: () => number; detail: number; ext: string; lighthouse: boolean }) {
  if (L.round) {
    const R = L.round.R + L.t / 2;
    b.group = 'level-0'; b.cyl(0, 0, 0, R + 0.06, R + 0.08, 0.45, o.base, 'wall', L.round.sides);
    for (let k = 1; k <= L.floors; k++) { b.group = k === L.floors ? `slab-${L.floors}` : `level-${k}`; /* capped bands: the top one hides with the ceiling (interior view), the others with the storey above */ b.cyl(0, k * L.fh - 0.12, 0, R + 0.07, R + 0.07, 0.14, k === L.floors ? o.base : o.quoin, 'trim', L.round.sides); }
    return;
  }
  const hx = L.W / 2, hz = L.D / 2, top = L.wallTop;
  const sides: { a: V2; b: V2; out: V2 }[] = [{ a: [-hx, hz], b: [hx, hz], out: [0, 1] }, { a: [hx, -hz], b: [-hx, -hz], out: [0, -1] }, { a: [hx, hz], b: [hx, -hz], out: [1, 0] }, { a: [-hx, -hz], b: [-hx, hz], out: [-1, 0] }];
  const doorsOn = (out: V2, floor: number) => L.openings.filter((op) => op.exterior && op.kind === 'door' && op.floor === floor && L.walls[op.wall]?.out?.[0] === out[0] && L.walls[op.wall]?.out?.[1] === out[1]).map((op) => op.at);
  for (const s of sides) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), ux = (s.b[0] - s.a[0]) / len, uz = (s.b[1] - s.a[1]) / len;
    const P = (t: number, d: number): V2 => [s.a[0] + ux * t + s.out[0] * d, s.a[1] + uz * t + s.out[1] * d];
    const yaw = Math.atan2(-uz, ux);
    // plinth band, broken at doors
    b.group = 'level-0';
    const cuts = doorsOn(s.out, 0).map((d) => (d[0] - s.a[0]) * ux + (d[1] - s.a[1]) * uz).sort((a, c) => a - c);
    let t0 = -0.05;
    for (const c of [...cuts.map((c) => [c - 0.62, c + 0.62]), [len + 0.05, len + 0.05]]) { if (c[0] - t0 > 0.05) { const m = P((t0 + c[0]) / 2, 0.035); b.box(m[0], 0, m[1], c[0] - t0, 0.42, 0.07, o.base, 'wall', yaw); } t0 = c[1]; }
    // string courses and the cornice
    for (let k = 1; k < L.floors; k++) { b.group = `level-${k}`; const m = P(len / 2, 0.03); b.box(m[0], k * L.fh - 0.06, m[1], len + 0.08, 0.12, 0.06, o.trim, 'trim', yaw); }
    b.group = `level-${L.floors - 1}`;
    { const m = P(len / 2, 0.06); b.box(m[0], top - 0.2, m[1], len + 0.3, 0.2, 0.14, o.trim, 'trim', yaw); }
    // corners: quoins on brick/stone, pilasters on plaster/wood
    if (o.detail >= 1 && L.params.quoins !== false) for (const end of [0.0]) {
      const sign = 1, c0 = P(end, 0.025);
      if (o.mat === 'brick' || o.mat === 'stone') {
        for (let y = 0.45, k = 0; y < top - 0.45; y += 0.84, k++) { const wq = k % 2 ? 0.34 : 0.52; const m = P(end + sign * (wq / 2 - 0.01), 0.025); b.group = `level-${Math.min(L.floors - 1, Math.floor(y / L.fh))}`; b.box(m[0], y, m[1], wq, 0.36, 0.06, o.quoin, 'trim', yaw); }
      } else if (o.mat !== 'glass') { const m = P(end + 0.12, 0.025); for (let k = 0; k < L.floors; k++) { b.group = `level-${k}`; const y0 = k === 0 ? 0.42 : k * L.fh, y1 = k === L.floors - 1 ? top - 0.2 : (k + 1) * L.fh; b.box(m[0], y0, m[1], 0.24, y1 - y0, 0.06, o.quoin, 'trim', yaw); } void c0; }
    }
    // a downpipe at the clockwise end of the long sides
    if (o.detail >= 1 && len > 3.5 && o.mat !== 'glass') { const m = P(len - 0.25, 0.1); for (let k = 0; k < L.floors; k++) { b.group = `level-${k}`; const y0 = k === 0 ? 0.1 : k * L.fh, y1 = k === L.floors - 1 ? top - 0.3 : (k + 1) * L.fh; b.cyl(m[0], y0, m[1], 0.045, 0.045, y1 - y0, '#4a4f4d', 'trim', 6); } }
  }
  // ivy on one wall of older (stone/brick) houses, clear of the windows
  if (o.detail >= 2 && (o.mat === 'stone' || o.mat === 'brick') && o.r() < 0.7) {
    const s = sides[Math.floor(o.r() * 4)], len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), ux = (s.b[0] - s.a[0]) / len, uz = (s.b[1] - s.a[1]) / len;
    const cx = len * (0.2 + 0.6 * o.r()), w0 = Math.min(2.2, len * 0.4), hgt = Math.min(top - 0.3, 2 + o.r() * 2.5);
    b.group = 'level-0';
    for (let k = 0; k < 48; k++) {
      const t = Math.pow(o.r(), 0.6), y = 0.1 + t * hgt, a = cx + (o.r() - 0.5) * w0 * (1 - t * 0.6);
      const wx = s.a[0] + ux * a, wz = s.a[1] + uz * a;
      if (L.openings.some((op) => op.kind !== 'arch' && Math.hypot(op.at[0] - wx, op.at[1] - wz) < op.width / 2 + 0.1 && y > FLOOR0 + op.floor * L.fh + op.sill - 0.1 && y < FLOOR0 + op.floor * L.fh + op.sill + op.height + 0.15)) continue;
      b.ball(wx + s.out[0] * 0.05, y, wz + s.out[1] * 0.05, 0.11, 0.09, 0.11, LEAVES[Math.floor(o.r() * LEAVES.length)]);
    }
  }
}

function drawStairs(b: Builder, L: BuildingLayout, st: BuildingLayout['stairs'][number], trim: Col, detail: number) {
  const rise = (st.y1 - st.y0) / st.risers, wood = '#9a6b43', dark = '#6e4c32';
  if (st.rect && st.axis && st.dir) {
    const [x0, z0, x1, z1] = st.rect, along = st.axis === 'x';
    const lo = along ? x0 : z0, hi = along ? x1 : z1, run = hi - lo, going = run / Math.max(1, st.risers - 1);
    const mid = along ? (z0 + z1) / 2 : (x0 + x1) / 2, w = st.width;
    const bottom = st.dir === 1 ? lo : hi;
    const P = (s: number, off = 0): V2 => (along ? [bottom + st.dir! * s, mid + off] : [mid + off, bottom + st.dir! * s]);
    const yaw = along ? 0 : Math.PI / 2;
    for (let i = 0; i < st.risers - 1; i++) {
      const [x, z] = P((i + 0.5) * going), y = st.y0 + (i + 1) * rise;
      b.box(x, y - 0.06, z, along ? going + 0.03 : w, 0.06, along ? w : going + 0.03, wood, 'floor');
      b.box(along ? x - st.dir! * (going / 2 - 0.01) : x, y - rise, along ? z : z - st.dir! * (going / 2 - 0.01), along ? 0.02 : w - 0.02, rise - 0.06, along ? w - 0.02 : 0.02, '#e9e2d0', 'floor');
    }
    // stringers and a handrail on the room side
    const pitch = Math.atan2(st.y1 - st.y0, run), slope = Math.hypot(run, st.y1 - st.y0);
    for (const off of [-w / 2 - 0.03, w / 2 + 0.03]) {
      const [cx, cz] = P(run / 2, off);
      const rz = st.dir === 1 ? pitch : -pitch;
      b.tilt(cx, (st.y0 + st.y1) / 2 - 0.1, cz, slope, 0.22, 0.05, along ? 0 : rz, along ? rz : 0, dark, 'trim', along ? 0 : Math.PI / 2);
    }
    const [hx, hz] = P(run / 2, (w / 2 + 0.03) * 1);
    b.tilt(hx, (st.y0 + st.y1) / 2 + 0.9, hz, slope, 0.05, 0.06, along ? 0 : (st.dir === 1 ? pitch : -pitch), along ? (st.dir === 1 ? pitch : -pitch) : 0, trim, 'trim', along ? 0 : Math.PI / 2);
    for (const s of [0, run]) { const [px, pz] = P(s, w / 2 + 0.03); b.box(px, st.y0 + (s / run) * (st.y1 - st.y0), pz, 0.07, 0.95, 0.07, trim); }
    void yaw;
    return;
  }
  if (st.c && st.r !== undefined) {
    const n = st.risers, wedge = (st.r * st.sweep!) / n;
    for (let i = 0; i < n; i++) {
      const a = st.a0! + (st.sweep! * (i + 0.5)) / n, y = st.y0 + (i + 1) * rise;
      const cx = st.c[0] + st.r * Math.sin(a), cz = st.c[1] + st.r * Math.cos(a);
      // tread: long axis radial
      b.box(cx, y - 0.07, cz, st.width + 0.08, 0.07, wedge * 1.12, wood, 'floor', a + Math.PI / 2);
      if (i % (detail >= 1 ? 4 : 8) === 0) { const ri = st.r - st.width / 2 + 0.04; b.box(st.c[0] + ri * Math.sin(a), y, st.c[1] + ri * Math.cos(a), 0.04, 0.95, 0.04, trim); }
    }
    // the inner handrail, segment by segment along the helix
    const segs = detail >= 1 ? 6 : 4, ri = st.r - st.width / 2 + 0.04;
    for (let i = 0; i < segs; i++) {
      const a0 = st.a0! + (st.sweep! * i) / segs, a1 = st.a0! + (st.sweep! * (i + 1)) / segs;
      const p0: THREE.Vector3Tuple = [st.c[0] + ri * Math.sin(a0), st.y0 + ((st.y1 - st.y0) * i) / segs + 0.95, st.c[1] + ri * Math.cos(a0)];
      const p1: THREE.Vector3Tuple = [st.c[0] + ri * Math.sin(a1), st.y0 + ((st.y1 - st.y0) * (i + 1)) / segs + 0.95, st.c[1] + ri * Math.cos(a1)];
      beam(b, p0, p1, 0.05, trim);
    }
  }
}

/** A box between two 3-D points (handrails). */
export function beam(b: Builder, p0: THREE.Vector3Tuple, p1: THREE.Vector3Tuple, t: number, c: Col) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], hl = Math.hypot(dx, dz), len = Math.hypot(hl, dy);
  b.tilt((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, len, t, t, 0, Math.atan2(dy, hl), c, 'trim', Math.atan2(-dz, dx));
}

function drawRoof(b: Builder, L: BuildingLayout, o: { roofCol: string; trim: string; ext: string; glass: boolean; r: () => number; detail: number }) {
  const top = L.wallTop, rise = L.roofRise, layer = o.glass ? 'glass' as const : 'roof' as const;
  const rc = o.glass ? '#dff0ec' : o.roofCol, dark = mix(o.roofCol, '#000000', 0.25);
  if (L.round) {
    const R = L.round.R + L.t / 2;
    if (L.roof === 'dome' || L.args.lantern) {
      b.cyl(0, top, 0, R + 0.25, R + 0.25, 0.14, o.trim, 'trim', L.round.sides);
      b.dome(0, top + 0.14, 0, R * 0.92, Math.max(rise, R * 0.7), rc, layer, 14);
      b.cyl(0, top + 0.14 + Math.max(rise, R * 0.7), 0, 0.05, 0.08, 0.6, '#3b3d40', 'trim', 6); b.ball(0, top + 0.9 + Math.max(rise, R * 0.7), 0, 0.12, 0.12, 0.12, o.trim);
    } else if (L.roof !== 'none' && L.roof !== 'flat') {
      b.cone(0, top, 0, R + 0.4, rise, rc, layer, L.round.sides * 2);
      b.cyl(0, top - 0.12, 0, R + 0.42, R + 0.42, 0.12, o.trim, 'trim', L.round.sides * 2);
    } else parapet(b, L.round ? ngon(R, L.round.sides) : [], top, o);
    return;
  }
  const W = L.W, D = L.D, ov = L.open ? 0.4 : 0.35;
  if (L.roof === 'none') return;
  if (L.roof === 'flat') { parapet(b, rectPoly(-W / 2, -D / 2, W / 2, D / 2), top, o); return; }
  if (L.roof === 'dome') {
    parapet(b, rectPoly(-W / 2, -D / 2, W / 2, D / 2), top, o);
    const R = Math.min(W, D) / 2 * 0.8; b.cyl(0, top, 0, R + 0.1, R + 0.1, 0.3, o.trim, 'trim', 16); b.dome(0, top + 0.3, 0, R, rise, rc, layer, 16);
    return;
  }
  // gable / hip / shed: work in a frame where the ridge runs along local x (the longer side)
  const alongX = W >= D || L.roof === 'shed';
  const Lx = alongX ? W : D, Lz = alongX ? D : W;
  b.push(0, 0, 0, alongX ? 0 : Math.PI / 2);
  if (L.roof === 'shed') {
    const run = Lz + 2 * ov, ang = Math.atan2(rise, run), slope = Math.hypot(run, rise);
    b.tilt(0, top + rise / 2 + 0.07, 0, Lx + 2 * ov, 0.14, slope, -ang, 0, rc, layer);
    // side walls fill the slope
    for (const sx of [-1, 1]) b.outer(() => { b.tri([sx * Lx / 2, top, Lz / 2], [sx * Lx / 2, top, -Lz / 2], [sx * Lx / 2, top + rise * (Lz / run + ov / run), -Lz / 2], o.ext, 'wall'); b.tri([sx * Lx / 2, top, -Lz / 2], [sx * Lx / 2, top, Lz / 2], [sx * Lx / 2, top + rise * (Lz / run + ov / run), -Lz / 2], o.ext, 'wall'); });
    b.box(0, top - 0.02, Lz / 2 + ov - 0.05, Lx + 2 * ov, 0.12, 0.08, o.trim);
    b.pop(); return;
  }
  const half = Lz / 2 + ov, ang = Math.atan2(rise, half), slope = Math.hypot(half, rise);
  if (L.roof === 'gable') {
    const len = Lx + 2 * 0.3;
    for (const sz of [-1, 1]) {
      b.tilt(0, top + rise / 2 + 0.06, sz * half / 2, len, 0.12, slope + 0.04, sz * ang, 0, rc, layer);
      // tile courses
      if (!o.glass && o.detail >= 1) for (const f of [0.3, 0.62]) b.tilt(0, top + rise * (1 - f) + 0.14, sz * half * f, len + 0.02, 0.04, 0.12, sz * ang, 0, dark, 'roof');
      // bargeboards (fascia along the gable edges) and eaves
      for (const sx of [-1, 1]) b.tilt(sx * (len / 2 - 0.03), top + rise / 2 + 0.02, sz * half / 2, 0.08, 0.2, slope, sz * ang, 0, o.trim);
      b.box(0, top - 0.1, sz * (half - 0.05), len, 0.14, 0.1, o.trim);
    }
    b.cylX(0, top + rise + 0.08, 0, 0.1, len + 0.06, dark, 'roof', 8);
    // gable-end walls
    const rw = rise * (Lz / 2) / half;
    if (!L.open) for (const sx of [-1, 1]) b.at(sx * (Lx / 2 - L.t / 2), top, 0, Math.PI / 2, () => b.outer(() => b.prism(0, 0, 0, Lz, rw, L.t, o.ext, 'wall')));
  } else {
    // hip: two trapezoids and two triangles over the eaves rectangle
    const ex = Lx / 2 + ov, ez = Lz / 2 + ov, rx = Math.max(0, ex - ez), y0 = top - 0.02, y1 = top + rise;
    b.quad([-ex, y0, ez], [ex, y0, ez], [rx, y1, 0], [-rx, y1, 0], rc, layer);
    b.quad([ex, y0, -ez], [-ex, y0, -ez], [-rx, y1, 0], [rx, y1, 0], rc, layer);
    b.tri([ex, y0, ez], [ex, y0, -ez], [rx, y1, 0], rc, layer);
    b.tri([-ex, y0, -ez], [-ex, y0, ez], [-rx, y1, 0], rc, layer);
    // underside (soffit) so the eaves read from below
    b.quad([-ex, y0 - 0.01, ez], [-ex, y0 - 0.01, -ez], [ex, y0 - 0.01, -ez], [ex, y0 - 0.01, ez], o.trim, 'trim');
    for (const [ax, az, bx, bz] of [[-ex, ez, ex, ez], [-ex, -ez, ex, -ez], [-ex, -ez, -ex, ez], [ex, -ez, ex, ez]]) b.run(ax, az, bx, bz, y0 - 0.12, 0.12, 0.08, o.trim);
    if (rx > 0.05) b.cylX(0, y1 + 0.04, 0, 0.08, 2 * rx + 0.1, dark, 'roof', 8);
  }
  b.pop();
  // a chimney with pots on houses
  b.optional(L.params.chimney !== false, () => {
    if (o.detail >= 1 && /cottage|townhouse|shop|plan/.test(L.style) && !L.open) {
      const cx = (alongX ? 1 : 0) * (W / 2 - 0.9) * (o.r() < 0.5 ? -1 : 1), cz = (alongX ? 0 : 1) * (D / 2 - 0.9) - (alongX ? 0.5 : 0);
      const h = rise + 1.0, brick = '#8a4a36';
      b.box(cx, top, cz, 0.6, h, 0.6, brick, 'roof'); b.box(cx, top + h, cz, 0.74, 0.08, 0.74, o.trim);
      for (const sd of [-1, 1]) b.cyl(cx + sd * 0.13, top + h + 0.08, cz, 0.06, 0.07, 0.3, '#a3442f', 'roof', 6);
      b.anchor(cx, top + h + 0.35, cz); // W2: chimney smoke
    }
  });

}

function parapet(b: Builder, poly: V2[], top: number, o: { trim: string; ext: string }) {
  if (poly.length < 3) return;
  b.slab(poly, top - 0.02, 0.06, '#9a958a', 'roof');
  for (let i = 0; i < poly.length; i++) { const a = poly[i], c = poly[(i + 1) % poly.length]; b.run(a[0], a[1], c[0], c[1], top, 0.42, 0.2, o.ext, 'wall'); b.run(a[0], a[1], c[0], c[1], top + 0.42, 0.06, 0.28, o.trim); }
}

function rectPoly(x0: number, z0: number, x1: number, z1: number): V2[] { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }
function ngon(R: number, n: number): V2[] { return Array.from({ length: n }, (_, i) => { const a = ((i + 0.5) * 2 * Math.PI) / n; return [R * Math.sin(a), R * Math.cos(a)] as V2; }); }
function bboxOf(poly: V2[]): [number, number, number, number] { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; }
