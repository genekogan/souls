// scatter/2 and orchard/1 mesh halves: one InstancedMesh per species (≤ 16 draws for a whole
// forest), per-instance tone and size from the seed. A palette entry with `def` instances that
// def's own mesh half (any kit tree, rock or flower) instead of a built-in species. Exclusions
// come from the model: solids (footprints), roads/paths/plazas/pitches (surfaces), buildings.
// Owner: L3.
import { centreLine, orchardPoints, paletteOf, queryOf, scatter2Points, type ScatterPoint } from '@sim/generators';
import type { Entity, WorldModel } from '@sim/world-compiler';
import * as THREE from 'three';
import { meshFor, registerMesh, type MeshCtx } from './registry.ts';
import { blockTest, type BlockCells, type BlockShape } from './block-test.ts';
import { speciesGeometry } from './species.ts';
import { vertexMaterial } from './soup.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The blocked-ground index is the same for every scatter in one world state: built once per model revision (Eden 2026's
 * ~240 woodlands each rebuilt it over all ~3,800 entities, ~18 s of first frame), keyed by the model's safety cache key.
 * P7: built by region. A scatter adds only the things that can reach its own area (BLOCK_REACH metres around it, by each
 * thing's root pose or shape box: no footprint bakes for the rest), so a phone's near-first build pays for the things near
 * the arrival only (Eden 2026: 0.37 s of 4x CPU for every footprint before the card); the whole index when asked without a
 * region. Each thing is added once; shapes in a cell are tested as a set, so the order they were added in is immaterial. */
type Anchor = { e: Entity; box: [number, number, number, number]; reach: number };
type BlockState = { pad: number; cells: BlockCells; done: Set<string>; all: boolean; anchors?: Anchor[] };
const blockIndex = new WeakMap<object, BlockState>();
export const BLOCK_CELL = 16;
/** No thing's blocked ground reaches farther than this from its root's stored pose (a building's floor plan, its furniture). */
export const BLOCK_REACH = 96;
/** The blocked-ground cells of a model (solid footprints and paved / road surfaces), cached per model revision: all of
 *  them, or (`region` [x0, z0, x1, z1]) at least every shape that can cover a point in that box. */
export function blockCellsOf(model: WorldModel, pad = 0.6, region?: readonly [number, number, number, number]): BlockCells {
  const key = model.safetyCacheKey(); let st = blockIndex.get(key);
  if (!st || st.pad !== pad) { st = { pad, cells: new Map(), done: new Set(), all: false }; blockIndex.set(key, st); }
  if (st.all) return st.cells;
  const s = st;
  model.readPass(() => {
    if (!region) { for (const e of model.entities.values()) if (!s.done.has(e.id)) { s.done.add(e.id); addBlocks(model, e, pad, s.cells); } s.all = true; return; }
    s.anchors ??= blockAnchors(model);
    for (const a of s.anchors) if (a.box[0] <= region[2] + a.reach && a.box[2] >= region[0] - a.reach && a.box[1] <= region[3] + a.reach && a.box[3] >= region[1] - a.reach && !s.done.has(a.e.id)) { s.done.add(a.e.id); addBlocks(model, a.e, pad, s.cells); }
    if (s.done.size >= model.entities.size) s.all = true;
  });
  return st.cells;
}
/** Where each thing is, without a bake: its shape's box, else its root ancestor's stored pose (a point box), and how far
 *  its blocked ground can reach beyond that box. */
function blockAnchors(model: WorldModel): Anchor[] {
  const out: Anchor[] = [], reachOf = new Map<string, number>();
  for (const e of model.entities.values()) {
    let r: Entity = e; for (let depth = 0; r.in.parent !== 'world' && depth < 8; depth++) { const up = model.get(r.in.parent); if (!up) break; r = up; }
    const pts = r.shape && 'area' in r.shape ? r.shape.area as number[][] : r.shape && 'path' in r.shape ? r.shape.path as number[][] : null;
    if (pts?.length) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } out.push({ e, box: [x0, z0, x1, z1], reach: BLOCK_REACH }); continue; }
    const p = (r as { p?: number[] }).p;
    let reach = reachOf.get(r.id); if (reach === undefined) { reach = rootReach(model, r); reachOf.set(r.id, reach); }
    // no stored pose: everywhere (always added)
    out.push({ e, box: p && Number.isFinite(p[0]) && Number.isFinite(p[2]) ? [p[0], p[2], p[0], p[2]] : [-Infinity, -Infinity, Infinity, Infinity], reach });
  }
  return out;
}
/** t4-phone: a building's floor plan, porch and furniture stay within its own size of its pose (the layout is centred on
 *  it: half the diagonal, a porch or balcony a few metres more), so a building and everything in it reaches twice its
 *  diagonal plus 12 m at most; the town around a phone's first trees then bakes no far footprints (Eden 2026: ~0.4 s of
 *  4x CPU before the poster). Anything else, or one without a numeric size: BLOCK_REACH. */
function rootReach(model: WorldModel, r: Entity): number {
  const d = model.resolvedDef(r.def); if (!d || d.make.kind !== 'gen') return BLOCK_REACH;
  const pr = (r.params ?? {}) as Record<string, unknown>, scale = Math.max(1, Math.abs(num((r as { s?: unknown }).s, 1)));
  // a kit thing (a tree, a lamp, a stall) within three times its declared box (its def's size, which its build is held
  // to), stretched by its own sx / sz and scale, plus 8 m
  if (d.make.gen === 'kit/2') {
    const box = (d as { size?: { box?: unknown } }).size?.box;
    if (!Array.isArray(box) || box.length !== 3 || !box.every((v) => Number.isFinite(v))) return BLOCK_REACH;
    const stretch = Math.max(1, Math.abs(num(pr.sx, 1)), Math.abs(num(pr.sz, 1)));
    return Math.min(BLOCK_REACH, 3 * Math.hypot(box[0] as number, box[2] as number) * stretch * scale + 8);
  }
  if (d.make.gen !== 'building/1') return BLOCK_REACH;
  let w = num(pr.w, NaN), dd = num(pr.d, NaN);
  const plan = pr.plan as { floors?: { rooms?: { rect?: unknown }[] }[] } | undefined;
  for (const f of plan?.floors ?? []) for (const room of f?.rooms ?? []) { const rc = room?.rect; if (Array.isArray(rc) && rc.length === 4 && rc.every(Number.isFinite)) { w = Math.max(Number.isFinite(w) ? w : 0, Math.abs(rc[0]), Math.abs(rc[2]), Math.abs(rc[2] - rc[0])); dd = Math.max(Number.isFinite(dd) ? dd : 0, Math.abs(rc[1]), Math.abs(rc[3]), Math.abs(rc[3] - rc[1])); } }
  if (!(w > 0) || !(dd > 0)) return BLOCK_REACH;
  return Math.min(BLOCK_REACH, (2 * Math.hypot(w, dd) + 12) * scale);
}
/** A spatial test for "something is already here": solid footprints and paved / road surfaces (block-test.ts). */
export function blockedBy(model: WorldModel, self: Entity, pad = 0.6): (x: number, z: number) => boolean {
  const area = self.shape && 'area' in self.shape ? self.shape.area as number[][] : null;
  let region: [number, number, number, number] | undefined;
  if (area?.length) { region = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, z] of area) { region[0] = Math.min(region[0], x); region[1] = Math.min(region[1], z); region[2] = Math.max(region[2], x); region[3] = Math.max(region[3], z); } }
  return blockTest(blockCellsOf(model, pad, region), BLOCK_CELL, self.id);
}
const OUTSIDE_SLOTS = new Set(['front', 'porch', 'balcony']);
function addBlocks(model: WorldModel, e: Entity, pad: number, cells: BlockCells, C = BLOCK_CELL): void {
  const put = (x0: number, z0: number, x1: number, z1: number, s: BlockShape) => { for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) { const k = `${gx},${gz}`; const l = cells.get(k); if (l) l.push(s); else cells.set(k, [s]); } };
  {
    // t4-phone: a thing in a building's room or floor stands inside its floor plan, which the building blocks whole (below):
    // no slot pose or bake for it (Eden 2026: ~3,200 pieces of furniture; their poses bake every house's layout). The
    // front stand, porch, balcony and wall hang points are outside that plan and keep their own.
    const slot = e.in.slot;
    if (slot && !OUTSIDE_SLOTS.has(slot) && !slot.startsWith('wall-') && e.in.parent !== 'world') { const up = model.get(e.in.parent), ud = up && model.resolvedDef(up.def); if (ud && ud.make.kind === 'gen' && ud.make.gen === 'building/1') return; }
    const d = model.resolvedDef(e.def); if (!d) return;
    const gen = d.make.kind === 'gen' ? d.make.gen : '';
    if (gen === 'scatter/1' || gen === 'scatter/2' || gen === 'landform/1' || gen === 'lake/1' || gen === 'river/1' || gen.startsWith('cliff') || gen.startsWith('terrace') || gen.startsWith('brush') || gen.startsWith('channel') || gen === 'lawn/1' || gen === 'shore/1') return;
    if ((gen === 'road/1' || gen === 'path/1') && e.shape && 'path' in e.shape) {
      const c = centreLine(e.shape), w = num(e.params?.width, gen === 'road/1' ? 6 : 1.6) + 2 * (num(e.params?.shoulder, gen === 'road/1' ? 0.6 : 0)) + pad * 2;
      for (let i = 1; i < c.length; i++) put(Math.min(c[i - 1][0], c[i][0]) - w, Math.min(c[i - 1][1], c[i][1]) - w, Math.max(c[i - 1][0], c[i][0]) + w, Math.max(c[i - 1][1], c[i][1]) + w, { kind: 'line', c: [c[i - 1], c[i]], w: w / 2, id: e.id });
      return;
    }
    if (e.shape && 'area' in e.shape && (gen === 'plaza/1' || gen === 'pitch/1' || gen === 'parking/1' || gen === 'deck/1' || gen === 'garden-bed/1' || gen === 'orchard/1')) {
      const p = e.shape.area as [number, number][]; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      put(x0 - pad, z0 - pad, x1 + pad, z1 + pad, { kind: 'poly', p, id: e.id }); return;
    }
    // a building's whole floor plan is blocked, not only its walls: no flowers or saplings growing indoors
    if (gen === 'building/1') { const fp = model.footprint(e, d), yaw = model.worldPose(e).yaw, co = Math.cos(yaw), si = Math.sin(yaw); let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity, cx = 0, cz = 0;
      for (const o of fp) { cx += o.c[0] / fp.length; cz += o.c[1] / fp.length; }
      for (const o of fp) { const oc = Math.cos(o.yaw), os = Math.sin(o.yaw); for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = o.c[0] + i * o.half[0] * oc + j * o.half[1] * os - cx, z = o.c[1] - i * o.half[0] * os + j * o.half[1] * oc - cz, a = x * co - z * si, b = x * si + z * co; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); } }
      if (fp.length) { const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2, c: [number, number] = [cx + ma * co + mb * si, cz - ma * si + mb * co], h: [number, number] = [(a1 - a0) / 2 + pad, (b1 - b0) / 2 + pad], r = Math.hypot(h[0], h[1]); put(c[0] - r, c[1] - r, c[0] + r, c[1] + r, { kind: 'obb', c, h, yaw, id: e.id }); }
    }
    for (const o of model.footprint(e, d)) { const r = Math.hypot(o.half[0], o.half[1]) + pad; put(o.c[0] - r, o.c[1] - r, o.c[0] + r, o.c[1] + r, { kind: 'obb', c: o.c, h: [o.half[0] + pad, o.half[1] + pad], yaw: o.yaw, id: e.id }); }
    // #870: a footprinted kit's (or a mesh sidecar's) ground rooms are walkable floor, not colliders, but no meadow either:
    // each floor-0 room polygon is blocked in the thing's world pose (the bake footprint() just made, memoised)
    if (gen !== 'building/1' && (gen === 'kit/2' || d.make.kind === 'mesh')) {
      const rooms = model.bake(d, e.params ?? {}, e.seed ?? 0, e.shape).rooms;
      if (rooms?.length) {
        const world = d.form !== 'point' && e.in.parent === 'world', wp = world ? null : model.worldPose(e), co = wp ? Math.cos(wp.yaw) : 1, si = wp ? Math.sin(wp.yaw) : 0;
        for (const room of rooms) {
          if (room.floor !== 0 || !(room.polygon?.length >= 3)) continue;
          const p = room.polygon.map(([x, z]): [number, number] => wp ? [wp.x + (x * co + z * si) * wp.s, wp.z + (-x * si + z * co) * wp.s] : [x, z]);
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
          if (Number.isFinite(x0 + z0 + x1 + z1)) put(x0, z0, x1, z1, { kind: 'poly', p, id: e.id });
        }
      }
    }
  }
}

const tint = new THREE.Color();
/** W2 sway: scattered plants bend in the wind (trees and bushes from the root, grasses and flowers flutter); rocks and
 *  cacti stay still. Their own vertex-colour material, so the wind never patches the rocks that share the scatter. */
const STILL_KINDS = new Set(['rock', 'boulder', 'cactus']), GRASS_KINDS = new Set(['grass', 'reed', 'fern', 'flower']);
const swayMats = new Map<string, THREE.Material>();
function swayOf(kind: string): { mode: 'crown' | 'grass'; mat: THREE.Material } | null {
  if (STILL_KINDS.has(kind)) return null;
  const mode = GRASS_KINDS.has(kind) ? 'grass' : 'crown';
  let mat = swayMats.get(mode); if (!mat) { mat = vertexMaterial().clone(); mat.name = `scatter plants ${mode}`; swayMats.set(mode, mat); }
  return { mode, mat };
}
function instance(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], pts: { x: number; y: number; z: number; s: number; yaw: number; tone: number; sink?: number }[], name: string, local?: THREE.Matrix4, windMode?: string) {
  if (!pts.length) return;
  const im = new THREE.InstancedMesh(geo, mat, pts.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  pts.forEach((p, i) => { q.setFromAxisAngle(up, p.yaw); m.compose(new THREE.Vector3(p.x, p.y - (p.sink ?? 0) * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s)); if (local) m.multiply(local); im.setMatrixAt(i, m); tint.setRGB(0.85 + p.tone * 0.3, 0.88 + p.tone * 0.24, 0.85 + p.tone * 0.25); im.setColorAt(i, tint); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true; im.name = name; im.computeBoundingSphere(); im.userData.cameraTransparent = true;
  if (windMode) im.userData.edenWindMode = windMode;
  group.add(im);
}

/** Instance an arbitrary def's mesh half (palette entry with `def`): each Mesh in its object becomes one InstancedMesh. */
function instanceDef(group: THREE.Group, ctx: MeshCtx, ref: string, pts: { x: number; y: number; z: number; s: number; yaw: number; tone: number }[]): boolean {
  const def = ctx.model.resolvedDef(ref); if (!def) return false;
  const b = meshFor(def); if (!b || b.world) return false;
  const fake = { id: `${ctx.entity.id}:${ref}`, def: def.ref, in: { parent: 'world' }, by: 'viewer', born: 0, v: 1 } as Entity;
  const obj = b.build({ ...ctx, def, entity: fake, params: {}, args: def.make.kind === 'gen' ? ((def.make.args ?? {}) as Record<string, unknown>) : {}, baked: ctx.model.bake(def, {}, 0), tint: (_k, f) => f });
  if (!obj) return false;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh) instance(group, mesh.geometry, mesh.material, pts, `scatter:${ref}`, mesh.matrixWorld.clone(), mesh.userData.edenWindMode); });
  return true;
}

function ground(ctx: MeshCtx) { return (x: number, z: number) => ctx.model.terrain.sample(x, z); }

registerMesh({
  gen: 'scatter/2', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const pal = paletteOf(ctx.params);
    const pts: ScatterPoint[] = scatter2Points(e.shape.area as [number, number][], ctx.params, e.seed ?? hashSeed(e.id), queryOf(ctx.model), blockedBy(ctx.model, e));
    const group = new THREE.Group(); group.name = `scatter ${e.name ?? e.id}`;
    const g = ground(ctx), byK = new Map<number, { x: number; y: number; z: number; s: number; yaw: number; tone: number; sink?: number }[]>();
    for (const p of pts) { const l = byK.get(p.k) ?? []; const kind = pal[p.k].kind; const y = g(p.x, p.z); l.push({ x: p.x, y, z: p.z, s: p.s, yaw: p.yaw, tone: p.tone, sink: pal[p.k].def ? 0 : kind === 'rock' || kind === 'boulder' ? 0.15 : 0.05 }); byK.set(p.k, l); }
    for (const [k, list] of byK) {
      const entry = pal[k];
      if (entry.def && instanceDef(group, ctx, entry.def, list)) continue;
      const sway = swayOf(entry.kind ?? 'oak');
      instance(group, speciesGeometry(entry.kind ?? 'oak'), sway?.mat ?? vertexMaterial(), list, `scatter:${entry.kind ?? 'oak'}`, undefined, sway?.mode);
    }
    group.userData.points = pts.length;
    return group.children.length ? group : null;
  },
});

registerMesh({
  gen: 'orchard/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const pts = orchardPoints(e.shape.area as [number, number][], num(ctx.params.spacing, 5), e.seed ?? 0), g = ground(ctx), h = num(ctx.params.height, 4.5) / 4.2;
    const group = new THREE.Group(); group.name = `orchard ${e.name ?? e.id}`;
    instance(group, speciesGeometry(String(ctx.params.species ?? 'apple')), swayOf(String(ctx.params.species ?? 'apple'))?.mat ?? vertexMaterial(), pts.map((p, i) => ({ x: p.x, y: g(p.x, p.z), z: p.z, s: p.s * h, yaw: i * 2.39, tone: (i * 0.618) % 1, sink: 0.05 })), 'orchard-trees', undefined, swayOf(String(ctx.params.species ?? 'apple'))?.mode);
    return group;
  },
});
function hashSeed(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 100000; }
