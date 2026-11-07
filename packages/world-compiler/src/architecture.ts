// Exterior entrance safety uses the generator's room/door/stair graph and the same yaw boxes
// indexed for overlap/engine navigation. No engine or server is needed for a local dry run.
import { CREATION_LIMITS as L, pointInPoly, reachableFromOutside, type Baked, type Opening, type Vec2 } from '@souls/generators';
import { obbOverlap, type WorldModel, type OBB } from './model.ts';
import type { Diff } from './compile.ts';
import type { Entity, Failure } from './schemas.ts';

const EPS = 1e-7;
type Sealed = { room: string; openings: string[] };

/** Clip a convex polygon to the resident-centre corridor. */
function clip(poly: Vec2[], half: number, depth: number): Vec2[] {
  for (const [axis, bound, sign] of [[0, -half, 1], [0, half, -1], [1, 0, 1], [1, depth, -1]]) {
    const out: Vec2[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = (a[axis] - bound) * sign, db = (b[axis] - bound) * sign;
      if (da >= -EPS) out.push(a);
      if ((da < -EPS) !== (db < -EPS)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    poly = out;
  }
  return poly;
}

/** Closed convex polygons intersect (touching obstacles leave no body clearance). */
function touches(a: Vec2[], b: Vec2[]): boolean {
  for (const p of [a, b]) for (let i = 0; i < p.length; i++) {
    const u = p[i], v = p[(i + 1) % p.length], dx = v[1] - u[1], dz = u[0] - v[0];
    const pa = a.map(([x, z]) => x * dx + z * dz), pb = b.map(([x, z]) => x * dx + z * dz);
    if (Math.max(...pa) < Math.min(...pb) - EPS || Math.max(...pb) < Math.min(...pa) - EPS) return false;
  }
  return true;
}

function approach(w: WorldModel, e: Entity, baked: Baked, door: Opening) {
  const wp = w.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw), yaw = wp.yaw + door.yaw;
  const at: Vec2 = [wp.x + (door.at[0] * c + door.at[1] * s) * wp.s, wp.z + (-door.at[0] * s + door.at[1] * c) * wp.s];
  const radius = L.bodyWidthM / 2, half = Math.max(EPS, door.width * wp.s / 2 - radius), depth = L.sealApproachDepthM;
  const room = baked.rooms?.find(r => r.id === door.from && r.floor === door.level);
  const y = wp.y + ((room?.y ?? baked.rooms?.find(r => r.floor === door.level)?.y ?? 0) + (door.sill ?? 0)) * wp.s;
  const corridor: OBB = { c: [at[0] + Math.sin(yaw) * depth / 2, at[1] + Math.cos(yaw) * depth / 2],
    half: [half + radius * 2, depth / 2 + radius * 2], yaw, y0: y + 0.15, y1: y + L.bodyHeightM };
  return {at, yaw, half, depth, radius, corridor};
}

function blocked(w: WorldModel, e: Entity, baked: Baked, door: Opening, index: RouteIndex): boolean {
  const {at, yaw, half, depth, radius, corridor} = approach(w, e, baked, door);
  const polys: Vec2[][] = [];
  const def = w.resolvedDef(e.def), ownKit = def?.make.kind === 'gen' && def.make.gen === 'kit/2' && !!def.make.args?.footprint; // XP5 hook
  // Surface generators can carry solid rails/posts too (the engine bridge collides with them),
  // although the compiler's placement-overlap hash indexes only the solid layer.
  for (const id of new Set([...w.near([corridor]), ...index.surfaces.near([corridor])])) {
    if (id === e.id && !ownKit) continue; // XP5: combine a kit's posts/walls with new external obstructions.
    const other = w.entities.get(id);
    if (other && w.resolvedDef(other.def)?.components.body) continue; // residents are transient, not construction
    const surface = other && w.resolvedDef(other.def)?.layer === 'surface';
    let boxes = w.footprintsOf(id);
    if (surface) { boxes = index.surfaceFootprints.get(id) ?? w.footprint(other!); index.surfaceFootprints.set(id, boxes); }
    for (const b of boxes) {
      if (b.y1 <= corridor.y0 || b.y0 >= corridor.y1) continue;
      const bc = Math.cos(b.yaw), bs = Math.sin(b.yaw), dc = Math.cos(yaw), ds = Math.sin(yaw);
      // Expand each obstacle by the resident radius, retaining its orientation. This is a conservative
      // square-body clearance, matching the yaw-box representation used by the compiler.
      const poly: Vec2[] = [];
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = b.c[0] + i * (b.half[0] + radius) * bc + j * (b.half[1] + radius) * bs - at[0];
        const z = b.c[1] - i * (b.half[0] + radius) * bs + j * (b.half[1] + radius) * bc - at[1];
        poly.push([x * dc - z * ds, x * ds + z * dc]);
      }
      const clipped = clip(poly, half, depth);
      if (clipped.length) polys.push(clipped);
    }
  }
  // A connected obstacle barrier from the corridor's left side to its right side seals it.
  // Unlike projecting all obstacles onto the door width, this allows a winding clear approach.
  const seen = new Set<number>(), queue: number[] = [];
  polys.forEach((p, i) => { if (p.some(([x]) => x <= -half + EPS)) { seen.add(i); queue.push(i); } });
  for (let k = 0; k < queue.length; k++) {
    const p = polys[queue[k]];
    if (p.some(([x]) => x >= half - EPS)) return true;
    polys.forEach((q, i) => { if (!seen.has(i) && touches(p, q)) { seen.add(i); queue.push(i); } });
  }
  return false;
}

function sealed(w: WorldModel, e: Entity, index: RouteIndex): Sealed[] {
  const d = w.resolvedDef(e.def); if (!d) return [];
  const b = w.bake(d, e.params ?? {}, e.seed ?? 0, e.shape);
  if (!b.rooms?.length) return [];
  const edges: [string, string][] = [], allEdges: [string, string][] = [], shut: string[] = [];
  const key = (floor: number, id: string) => `${floor}:${id}`;
  const roomAt = (level: number, p: Vec2) => b.rooms!.find(r => r.floor === level && pointInPoly(p[0], p[1], r.polygon));
  for (const o of b.openings ?? []) {
    if (o.kind === 'window') continue;
    // A legacy sidecar can contain a slot narrower than a resident (e.g. a serving door).
    // Such a slot was never a body route, so construction cannot remove it as the last route.
    if (o.width * w.worldPose(e).s < L.bodyWidthM || o.height * w.worldPose(e).s < L.bodyHeightM) continue;
    // Sidecars predating graph metadata can recover the adjacent rooms from the opening normal.
    const n: Vec2 = [Math.sin(o.yaw) * 0.3, Math.cos(o.yaw) * 0.3];
    const from = o.from ?? roomAt(o.level, [o.at[0] - n[0], o.at[1] - n[1]])?.id;
    const to = o.to ?? roomAt(o.level, [o.at[0] + n[0], o.at[1] + n[1]])?.id ?? 'outside';
    if (!from) continue;
    const exterior = to === 'outside' || to === 'porch', edge: [string, string] = [key(o.level, from), exterior ? 'outside' : to === 'balcony' ? 'balcony' : key(o.level, to)];
    allEdges.push(edge);
    if (exterior && blocked(w, e, b, o, index)) shut.push(o.id); else edges.push(edge);
  }
  for (const l of b.links ?? []) {
    const a = roomAt(l.from, l.path[0]), z = roomAt(l.to, l.path[l.path.length - 1]);
    if (a && z) { const edge: [string, string] = [key(l.from, a.id), key(l.to, z.id)]; edges.push(edge); allEdges.push(edge); }
  }
  if (!shut.length) return [];
  const before = reachableFromOutside(allEdges), after = reachableFromOutside(edges);
  return b.rooms.filter(r => before.has(key(r.floor, r.id)) && !after.has(key(r.floor, r.id))).map(r => ({ room: r.id, openings: shut }));
}

/** Coarse spatial lookup with copy-on-write cell sets, shared only between immutable plan states. */
class BoxesIndex {
  boxes = new Map<string, OBB[]>();
  cells = new Map<string, Set<string>>();
  private owned = new Set<string>();
  fork() { const out = new BoxesIndex(); out.boxes = new Map(this.boxes); out.cells = new Map(this.cells); return out; }
  private keys(b: OBB): string[] {
    const c = Math.abs(Math.cos(b.yaw)), s = Math.abs(Math.sin(b.yaw));
    const x = b.half[0] * c + b.half[1] * s, z = b.half[0] * s + b.half[1] * c, keys: string[] = [];
    for (let j = Math.floor((b.c[1] - z) / L.regionSizeM); j <= Math.floor((b.c[1] + z) / L.regionSizeM); j++)
      for (let i = Math.floor((b.c[0] - x) / L.regionSizeM); i <= Math.floor((b.c[0] + x) / L.regionSizeM); i++) keys.push(`${i},${j}`);
    return keys;
  }
  private edit(key: string) {
    if (!this.owned.has(key) || !this.cells.has(key)) { this.cells.set(key, new Set(this.cells.get(key))); this.owned.add(key); }
    return this.cells.get(key)!;
  }
  set(id: string, boxes: OBB[]) {
    for (const box of this.boxes.get(id) ?? []) for (const key of this.keys(box)) { const ids = this.edit(key); ids.delete(id); if (!ids.size) this.cells.delete(key); }
    if (!boxes.length) { this.boxes.delete(id); return; }
    this.boxes.set(id, boxes);
    for (const box of boxes) for (const key of this.keys(box)) {
      if (!this.cells.has(key)) {this.cells.set(key, new Set()); this.owned.add(key);}
      this.edit(key).add(id);
    }
  }
  near(boxes: OBB[]): Set<string> {
    const ids = new Set<string>();
    for (const box of boxes) for (const key of this.keys(box)) for (const id of this.cells.get(key) ?? [])
      if (!ids.has(id) && this.boxes.get(id)!.some(b => obbOverlap(b, box))) ids.add(id);
    return ids;
  }
}
type RouteIndex = {buildings: BoxesIndex; surfaces: BoxesIndex; surfaceFootprints: Map<string, OBB[]>};
const indices = new WeakMap<object, {ground: unknown; index: RouteIndex}>();

function update(index: RouteIndex, w: WorldModel, id: string, base?: RouteIndex) {
  const e = w.entities.get(id), d = e && w.resolvedDef(e.def);
  const b = e && d ? w.bake(d, e.params ?? {}, e.seed ?? 0, e.shape) : undefined;
  const corridors: OBB[] = [];
  if (e && b?.rooms?.length) for (const o of b.openings ?? []) {
    if (o.kind === 'window') continue;
    const wp = w.worldPose(e);
    if (o.width * wp.s < L.bodyWidthM || o.height * wp.s < L.bodyHeightM) continue;
    const n: Vec2 = [Math.sin(o.yaw) * .3, Math.cos(o.yaw) * .3];
    const roomAt = (p: Vec2) => b.rooms!.find(r => r.floor === o.level && pointInPoly(p[0], p[1], r.polygon));
    const from = o.from ?? roomAt([o.at[0] - n[0], o.at[1] - n[1]])?.id;
    const to = o.to ?? roomAt([o.at[0] + n[0], o.at[1] + n[1]])?.id ?? 'outside';
    if (from && (to === 'outside' || to === 'porch')) corridors.push(approach(w, e, b, o).corridor);
  }
  if (corridors.length || index.buildings.boxes.has(id)) {
    if (base && index.buildings === base.buildings) index.buildings = base.buildings.fork();
    index.buildings.set(id, corridors);
  }
  // Surface lookup uses conservative bounds only. Full transformed collider footprints are
  // evaluated lazily for surfaces near a candidate's entrance, never for every world surface.
  const bounds: OBB[] = [];
  if (e && d?.layer === 'surface' && b?.colliders.length) {
    const wp = w.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const box of b.colliders) {
      const worldShape = d.form !== 'point' && e.in.parent === 'world';
      const x = worldShape ? box.c[0] : wp.x + (box.c[0] * c + box.c[1] * s) * wp.s;
      const z = worldShape ? box.c[1] : wp.z + (-box.c[0] * s + box.c[1] * c) * wp.s;
      const r = Math.hypot(...box.half) * (worldShape ? 1 : wp.s);
      x0 = Math.min(x0, x-r); x1 = Math.max(x1, x+r); z0 = Math.min(z0, z-r); z1 = Math.max(z1, z+r);
    }
    bounds.push({c: [(x0+x1)/2, (z0+z1)/2], half: [(x1-x0)/2, (z1-z0)/2], yaw: 0, y0: -Infinity, y1: Infinity});
  }
  if (bounds.length || index.surfaces.boxes.has(id)) {
    if (base && index.surfaces === base.surfaces) index.surfaces = base.surfaces.fork();
    index.surfaces.set(id, bounds);
  }
  index.surfaceFootprints.delete(id);
}
function indexOf(w: WorldModel): RouteIndex {
  const key = w.safetyCacheKey(), hit = indices.get(key);
  if (hit?.ground === w.ground()) return hit.index;
  const index: RouteIndex = {buildings: new BoxesIndex(), surfaces: new BoxesIndex(), surfaceFootprints: new Map()};
  for (const id of w.entities.keys()) update(index, w, id);
  indices.set(key, {ground: w.ground(), index}); return index;
}

/** Refuse only newly sealed rooms; inspect only changed buildings or entrances near changed geometry. */
export function sealedRouteFailure(before: WorldModel, after: WorldModel, diff: Pick<Diff, 'upserts' | 'removes'>, op: number): Failure | null {
  const oldIndex = indexOf(before);
  const nextIndex: RouteIndex = {buildings: oldIndex.buildings, surfaces: oldIndex.surfaces, surfaceFootprints: new Map()};
  const changed = new Set([...diff.upserts.map(e => e.id), ...diff.removes]);
  for (const id of changed) update(nextIndex, after, id, oldIndex);
  indices.set(after.safetyCacheKey(), {ground: after.ground(), index: nextIndex});
  const boxes: OBB[] = [];
  for (const w of [before, after]) for (const id of changed) {
    const e = w.entities.get(id); if (!e) continue;
    const d = w.resolvedDef(e.def); if (!d || d.components.body) continue;
    for (const b of w.footprintsOf(id).length ? w.footprintsOf(id) : w.footprint(e, d))
      boxes.push({...b, half: [b.half[0] + L.sealQueryMarginM, b.half[1] + L.sealQueryMarginM], y0: b.y0 - L.sealQueryMarginM, y1: b.y1 + L.sealQueryMarginM});
  }
  const candidates = new Set([...changed, ...oldIndex.buildings.near(boxes), ...nextIndex.buildings.near(boxes)]);
  for (const id of candidates) {
    const e = after.entities.get(id); if (!e || !nextIndex.buildings.boxes.has(id)) continue;
    const next = sealed(after, e, nextIndex); if (!next.length) continue;
    const prev = before.entities.get(e.id), old = new Set(prev ? sealed(before, prev, oldIndex).map(r => r.room) : []);
    const bad = next.find(r => !old.has(r.room)); if (!bad) continue;
    const building = after.pathOf(e.id), openings = bad.openings.join(', ');
    return { op, code: 'architecture.sealed', entity: e.id, def: e.def, field: 'p',
      detail: `${building}: room ${bad.room} loses its last exterior route; blocked door/opening: ${openings}`,
      measured: { building, room: bad.room, openings: bad.openings }, limit: L.bodyWidthM,
      fix: `Move the solid clear of ${building}/${openings}; leave a clear approach at least ${L.bodyWidthM} m wide for ${L.sealApproachDepthM} m outside an exterior opening.` };
  }
  return null;
}
