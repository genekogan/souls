// entity-physics/1: the `world-edit` engine fact (spec eden4/31 B2/B3, lane L9). One logged event per committed
// entity-world batch carries, per changed entity, the physics the engine needs — floors (surfaces on levels),
// solids (wall segments, closed doors), stairs (links) — and the fixtures/items it registers with the same ids.
// The fold applies it to plain world state (`world.entityPhysicsV1` + `world.entities`), so live, restored and
// replayed engines agree without ever reading the entity model.
import { hashOf, hashPhysicsResumable, PART_TEXT, stableStringify, trustPhysicsText, type PhysicsHashMark } from '../../../mars/viewer/engine/core/hash.ts';
import { pointInObb, type Vec2 } from '../../../mars/viewer/engine/core/math.ts';
import type { EntityPhysicsV1 } from '../../../mars/viewer/engine/spatial/edits.ts';
import type { Level, Link, Obstacle, Surface } from '../../../mars/viewer/engine/spatial/types.ts';
import type { Entity, WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { isLooseCarryAsset, registerAssets } from './catalog-adapter.ts';
import { prepareImmutableSnapshotData } from '../../../mars/viewer/engine/runtime/codec.ts';

export type { EntityPhysicsV1 };
export type EntityPartV1 = { surfaces?: Surface[]; solids?: Obstacle[]; links?: Link[] };
/** A god-placed fixture or item as the engine holds it (same id as the entity-world entity). */
export type FixtureSpecV1 = {
  def: string; kind: 'fixture' | 'item'; label: string;
  p: [number, number, number]; yaw: number;
  /** PC12 (#691): a part with connectors stood on end (the entity's tilt about its own z); absent otherwise. */
  roll?: number;
  support?: { kind: 'ground' } | { kind: 'resting-on'; on: string; slot: string } | { kind: 'connected'; to: string[] };
  /** PC12 (#691): the part's structural joints (its connector, the other part, that part's connector), mirrored from the
   *  entity world's reciprocal `joins`; the part is then installed. Absent for a part with none. */
  connections?: { socket: string; to: string; toSocket: string }[];
  /** The engine level of the floor it stands on. Hosts send it for a fixture on an upper floor since lane LEVELS
   *  (2026-10-21); absent (earlier journals, the ground), the engine takes the level nearest its height. */
  level?: number;
};
export type WorldEditV1 = {
  contract: 'world-edit/1';
  /** Entity-world edit seq this event mirrors (0 = boot reconciliation). */
  seq: number;
  /** hashOf the resulting entity-physics (levels, byEntity, assets): replay checks it re-derived the same. */
  hash: string;
  /** Upper-floor levels (ids 1..MAX_LEVEL_ID, spatial/types.ts) the parts stand on; the full list after this edit. */
  levels: Level[];
  /** Changed entities: their physics and fixture, or null when removed. */
  set: Record<string, (EntityPartV1 & { fixture?: FixtureSpecV1 }) | null>;
  /** Engine assets first used by this edit (catalog-adapter.ts). */
  assets?: Record<string, unknown>;
};

/** A string built by += is a rope; reading it char by char flattens it in place (V8), so the many later joins of the
 *  cached part texts into the physics hash copy flat strings (a join of 3,000 ropes took ~60 ms, of flat ones ~0.3 ms). */
const flat = (t: string) => { t.charCodeAt(0); return t; };
export const emptyEntityPhysics = (): EntityPhysicsV1 => ({ version: 'entity-physics/1', seq: 0, hash: '', baseKey: '', levels: [], bounds: null, byEntity: {}, assets: {} });
export const entityPhysicsHash = (ep: Pick<EntityPhysicsV1, 'levels' | 'byEntity' | 'assets'>) => hashOf({ levels: ep.levels, byEntity: sortKeys(ep.byEntity), assets: sortKeys(ep.assets) });
function sortKeys<T>(r: Record<string, T>): Record<string, T> { const o: Record<string, T> = {}; for (const k of Object.keys(r).sort()) o[k] = r[k]; return o; }

const RASTER_HALF = 64;
/** Integer bounds covering every floor (and solid) of the physics, or null when there is none. */
function floorBounds(ep: EntityPhysicsV1): [number, number, number, number] | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const add = (c: [number, number], h: [number, number], yaw: number) => { const ca = Math.abs(Math.cos(yaw)), sa = Math.abs(Math.sin(yaw)), hx = h[0] * ca + h[1] * sa, hz = h[0] * sa + h[1] * ca; x0 = Math.min(x0, c[0] - hx); z0 = Math.min(z0, c[1] - hz); x1 = Math.max(x1, c[0] + hx); z1 = Math.max(z1, c[1] + hz); };
  for (const b of Object.values(ep.byEntity)) for (const s of b.surfaces ?? []) add(s.obb.c, s.obb.half, s.obb.yaw);
  if (x0 === Infinity) return null;
  // round out to 8 m so a small move does not re-base the raster; never beyond ±64 m (one flat 0.1 m raster per level;
  // a wider world waits for L8's tiled Spatial — floors beyond it are simply not walkable yet)
  const c = (v: number) => Math.max(-RASTER_HALF, Math.min(RASTER_HALF, v));
  return [c(Math.floor(x0 / 8) * 8), c(Math.floor(z0 / 8) * 8), c(Math.ceil(x1 / 8) * 8), c(Math.ceil(z1 / 8) * 8)];
}

/** The physics state a world-edit produces from `prev` (pure). */
export function nextEntityPhysics(prev: EntityPhysicsV1 | undefined, e: WorldEditV1): EntityPhysicsV1 {
  // G1: a physics value is replaced, never mutated (hash.ts), and so are its parts and assets: the new value carries
  // the unchanged ones over (was a structuredClone of the whole ~3 MB physics per edit) and hashes with their cached text
  const cur: EntityPhysicsV1 = prev ? { ...prev, levels: prev.levels, byEntity: { ...prev.byEntity }, assets: { ...prev.assets } } : emptyEntityPhysics();
  for (const id of Object.keys(e.set).sort()) {
    const v = e.set[id];
    if (!v) { delete cur.byEntity[id]; continue; }
    const part: EntityPartV1 = {};
    if (v.surfaces?.length) part.surfaces = v.surfaces;
    if (v.solids?.length) part.solids = v.solids;
    if (v.links?.length) part.links = v.links;
    if (part.surfaces || part.solids || part.links) cur.byEntity[id] = structuredClone(part); else delete cur.byEntity[id];
  }
  for (const [id, a] of Object.entries(e.assets ?? {})) cur.assets[id] ??= structuredClone(a);
  cur.levels = structuredClone(e.levels).sort((a, b) => a.id - b.id);
  cur.seq = Math.max(cur.seq, e.seq);
  cur.byEntity = sortKeys(cur.byEntity); cur.assets = sortKeys(cur.assets);
  cur.bounds = floorBounds(cur);
  for (const p of [...Object.values(cur.byEntity), ...Object.values(cur.assets)]) if (p && typeof p === 'object' && !PART_TEXT.has(p)) PART_TEXT.set(p, flat(stableStringify(p)));
  // srv-hub-physics item 2: the digest resumes from prev's at the first changed entity (same bytes, same hash)
  const { hash, mark } = hashPhysicsResumable({ levels: cur.levels, byEntity: cur.byEntity, assets: cur.assets }, PART_TEXT as unknown as ReadonlyMap<object, string>, prev && HASH_MARK.get(prev));
  cur.hash = hash;
  cur.baseKey = hashOf({ levels: cur.levels, bounds: cur.bounds });
  // Seal the existing replace-never-mutate ownership contract only after all
  // derived fields are complete. Unchanged parts retain their admitted shapes.
  prepareImmutableSnapshotData(cur, '$.entityPhysicsV1');
  if (mark) HASH_MARK.set(cur, mark);
  trustPhysicsText(cur);   // srv-hub-physics item 3: its hash is of exactly the texts hash.ts caches for it
  return cur;
}
/** srv-hub-physics item 2: where the next physics' hash can resume (hash.ts hashPhysicsResumable), by physics value. */
const HASH_MARK = new WeakMap<EntityPhysicsV1, PhysicsHashMark>();

/** L4 #7 (audit 2026-10-31): the physics a world-edit event was built into by its producer (the god bridge builds it to
 *  log its hash), with the hash and seq of the physics it was built from. The engine's fold adopts that very value when
 *  its own physics is the same one (same hash and seq: `nextEntityPhysics` is pure in exactly these), instead of building
 *  it a second time: one build per edit, and one physics object shared by bridge and engine (was two full copies with
 *  their own part clones, stable texts and admitted shapes; `nextEntityPhysics` retained 136 of 283 MB on a genesis
 *  Eden 2026). A producer never mutates an event after this (the bridge only sets `hash` from the result). The entry
 *  is taken by the first fold that reads it; replay, restore and any other engine build their own (same bytes). */
const BUILT = new WeakMap<WorldEditV1, { prevHash: string; prevSeq: number; next: EntityPhysicsV1 }>();
/** nextEntityPhysics for an event its caller is about to log: the engine's fold of that event adopts the result. */
export function buildWorldEditPhysics(prev: EntityPhysicsV1 | undefined, e: WorldEditV1): EntityPhysicsV1 {
  const next = nextEntityPhysics(prev, e);
  BUILT.set(e, { prevHash: prev?.hash ?? '', prevSeq: prev?.seq ?? 0, next });
  return next;
}
/** The physics `e` makes of `prev`: the one its producer built when that was from the same physics, else a new build. */
function foldPhysics(prev: EntityPhysicsV1 | undefined, e: WorldEditV1): EntityPhysicsV1 {
  const b = BUILT.get(e);
  if (b) BUILT.delete(e);
  if (b && b.prevHash === (prev?.hash ?? '') && b.prevSeq === (prev?.seq ?? 0) && b.next.hash === e.hash) {
    if (CHECK_FOLD) { const own = nextEntityPhysics(prev, e); if (own.hash !== b.next.hash || own.seq !== b.next.seq || own.baseKey !== b.next.baseKey) throw new Error('entity-physics.adopted-differs'); }
    return b.next;
  }
  return nextEntityPhysics(prev, e);
}
/** Oracle (tests, SIM_PHYSICS_CHECK=1): an adopted build is also built again and must match. */
const CHECK_FOLD = typeof process !== 'undefined' && (process as { env?: Record<string, string | undefined> }).env?.SIM_PHYSICS_CHECK === '1';

/** Labels are public perception metadata, not a reason to rebuild the navigation raster.
 * Compare only changed parts; fixtures are held separately from entityPhysicsV1. */
export function worldEditChangesNavigation(world: WorldState, edit: WorldEditV1): boolean {
  const text = (x: unknown) => stableStringify(JSON.parse(JSON.stringify(x, (key, value) => key === 'label' ? undefined : value)));
  if (text(edit.levels) !== text(world.entityPhysicsV1?.levels ?? [])) return true;
  if (Object.keys(edit.assets ?? {}).some(id => !world.entityPhysicsV1?.assets[id])) return true;
  for (const [id, part] of Object.entries(edit.set)) {
    const old = world.entityPhysicsV1?.byEntity[id];
    const geometry = (p: EntityPartV1 | null | undefined) => ({...(p?.solids?.length ? {solids:p.solids} : {}), ...(p?.surfaces?.length ? {surfaces:p.surfaces} : {}), ...(p?.links?.length ? {links:p.links} : {})});
    if (text(geometry(old)) !== text(geometry(part))) return true;
    const f = part?.fixture, cur = world.entities[id];
    if (!f) { if (cur?.tags?.includes('entity-world')) return true; continue; }
    if (!cur || cur.def !== f.def || cur.kind !== (f.kind === 'item' ? 'component' : 'fixture') || cur.level !== f.level
      || text(cur.pose.p) !== text(f.p) || cur.pose.yaw !== f.yaw || text(cur.support ?? null) !== text(f.support ?? null)
      || (cur.pose.roll ?? 0) !== (f.roll ?? 0) || text(cur.connections ?? null) !== text(f.connections ?? null)) return true;
  }
  return false;
}

/**
 * Apply a world-edit to world state: physics + fixture entities. Returns the ids of fixtures it could not update
 * because a body holds them (the server refuses such edits first; this is the engine's own guard).
 */
export function applyWorldEdit(world: WorldState, e: WorldEditV1): { physics: EntityPhysicsV1; kept: string[] } {
  const physics = foldPhysics(world.entityPhysicsV1, e);
  registerAssets(physics.assets);
  world.entityPhysicsV1 = physics;
  const kept: string[] = [];
  for (const id of Object.keys(e.set).sort()) {
    const v = e.set[id], cur = world.entities[id];
    const heldByBody = cur?.support?.kind === 'in-hand' || cur?.support?.kind === 'held';
    if (!v?.fixture) {
      if (cur && cur.tags?.includes('entity-world')) { if (heldByBody) kept.push(id); else delete world.entities[id]; }
      continue;
    }
    if (heldByBody) { kept.push(id); continue; }
    const f = v.fixture;
    const next: Entity = {
      id, def: f.def, kind: f.kind === 'item' ? 'component' : 'fixture', label: f.label, tags: ['entity-world', ...((physics.assets[f.def] as import('../../../mars/viewer/engine/world/catalog.ts').AssetDef | undefined)?.capabilities?.recordedItemPoseV1 ? ['entity-world-item-pose'] : []), ...((physics.assets[f.def] as import('../../../mars/viewer/engine/world/catalog.ts').AssetDef | undefined)?.capabilities?.fixtureCarry || isLooseCarryAsset(physics.assets[f.def] as import('../../../mars/viewer/engine/world/catalog.ts').AssetDef | undefined) ? ['entity-world-transport'] : [])],
      pose: { p: [f.p[0], f.p[1], f.p[2]], yaw: f.yaw, ...(f.roll ? { roll: f.roll } : {}) },
      provenance: { origin: 'design-edit', confidence: 'hypothetical', note: 'placed by the world\'s god (entity world, world-edit/1)' },
      ...(f.support ? { support: structuredClone(f.support) } : {}),
      ...(f.kind !== 'item' && typeof f.level === 'number' ? { level: f.level } : {}),
      // PC12 (#691): a joined part is installed (never carried off while joined); a loose one on the ground is staged
      ...(f.connections?.length ? { phase: 'installed' as const, connections: structuredClone(f.connections) } : f.kind === 'item' && f.support?.kind === 'ground' ? { phase: 'staged' as const } : {}),
      ...(cur?.contents ? { contents: cur.contents } : {}),
    };
    world.entities[id] = next;
  }
  return { physics, kept };
}

const AGENT_R = 0.34;
/**
 * Stairs whose foot or head sits close to a wall (a cottage flight along its north wall, a landing beside the
 * stairwell) cannot be entered straight along their heading: the planner's default approach point (0.7 m back)
 * lands in the wall. For such an end, pick a side approach on that end's own floor, clear of this part's solids,
 * and record it on the link (`approach`). Ends whose straight approach is clear keep the default (no field). A link may
 * arrive with `approach` points already set by the builder (a helix flight: where a body stands straight in from the
 * stair well's axis); those give the direction to try first.
 */
export function withLinkApproaches(part: EntityPartV1): EntityPartV1 {
  if (!part.links?.length) return part;
  const solidsAt = (y: number) => (part.solids ?? []).filter((o) => o.y0 < y + 1.7 && o.y1 > y + 0.15);
  const floorsOf = (level: number) => (part.surfaces ?? []).filter((s) => s.level === level);
  const onFloor = (p: Vec2, level: number) => {
    if (level === 0) return true; // level 0 is the ground itself (and the floors laid on it)
    const fl = floorsOf(level);
    return [[0, 0], [AGENT_R, 0], [-AGENT_R, 0], [0, AGENT_R], [0, -AGENT_R]].every(([dx, dz]) => fl.some((s) => pointInObb([p[0] + dx, p[1] + dz], s.obb)));
  };
  // `pad`: extra room to keep from solids. The planner's grid reads about 0.1 m tighter than these point tests (cells
  // are marked blocked whole), so a place that passes with no pad can still be one it will not stand a body on.
  const clear = (a: Vec2, b: Vec2, y: number, level: number, pad = 0) => {
    const ss = solidsAt(y);
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, q: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], r = (k === 4 ? AGENT_R + 0.04 : AGENT_R * 0.9) + pad;
      if (ss.some((o) => pointInObb(q, o.obb, r))) return false;
      if (k === 4 && !onFloor(q, level)) return false;
    }
    return true;
  };
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  for (const l of part.links) {
    const dir: Vec2 = [Math.cos(l.heading), Math.sin(l.heading)];
    // `toward`: the builder knows the way on or off this end (a helix flight is entered straight in from the stair well's
    // axis, not along the chord of its heading). A clear approach that way is then recorded, with the nearer places and
    // the sides tried when it is not; without it the default 0.7 m back along the heading stays.
    const pick = (end: { level: number; p: Vec2; y: number }, out: Vec2, toward = false, pad = 0, degs = [30, -30, 60, -60, 90, -90, 120, -120]): Vec2 | null => {
      const straight: Vec2 = [r3(end.p[0] + out[0] * 0.7), r3(end.p[1] + out[1] * 0.7)];
      if (clear(end.p, straight, end.y, end.level, pad)) return toward ? straight : null;
      for (const d of toward ? [0.7, 0.5, 0.9, 1.1] : [0.7, 0.9, 1.1]) for (const deg of degs) {
        const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        const q: Vec2 = [r3(end.p[0] + (out[0] * c - out[1] * s) * d), r3(end.p[1] + (out[0] * s + out[1] * c) * d)];
        if (clear(end.p, q, end.y, end.level, pad)) return q;
      }
      return null;
    };
    // Last resort for an end none of the above clears: finer turns (the heading runs from the foot's approach to the
    // head, so a flight entered from the side has it skewed ~15 deg off the flight's own axis) and the way back, first
    // with room to spare (the planner's grid reads ~0.07 m tighter than these point tests), then without.
    const FINE = [75, -75, 105, -105, 90, -90, 180, 165, -165, 150, -150, 135, -135, 120, -120, 60, -60, 45, -45];
    const fallback = (end: { level: number; p: Vec2; y: number }, out: Vec2): Vec2 | null => {
      if (clear(end.p, [r3(end.p[0] + out[0] * 0.7), r3(end.p[1] + out[1] * 0.7)], end.y, end.level)) return null;
      return pick(end, out, false, 0.06, FINE) || pick(end, out, false, 0, FINE);
    };
    const towards = (end: { p: Vec2 }, at?: Vec2): Vec2 | null => { if (!at) return null; const dx = at[0] - end.p[0], dz = at[1] - end.p[1], n = Math.hypot(dx, dz); return n > 0.05 ? [dx / n, dz / n] : null; };
    const hint = l.approach, hf = towards(l.from, hint?.from), ht = towards(l.to, hint?.to);
    const from = (hf && (pick(l.from, hf, true, 0.12) || pick(l.from, hf, true))) || pick(l.from, [-dir[0], -dir[1]]);
    // An upper end with no clear way on along or beside its heading (a cottage head set sideways into the corridor
    // beside the flight, the end wall 0.5 m ahead; a head between the rail's end and the end wall with the heading
    // skewed) takes the fallback (lane RAIL: the default 0.7 m ahead lay in the end wall, so the descent was refused
    // and the upstairs one-way). Only when nothing else is clear, so every end that had an approach keeps it.
    // A head whose straight 0.7 m runs into the end wall of a 0.9 m landing corridor (the rail on one side, a room wall on
    // the other) is stood on nearer, straight along the corridor's middle, before any turned place: a turned place 0.7 m
    // out passes these point tests but lands by the corridor's corner where the planner's grid reads ~0.3 m and the descent
    // was refused (lane LEVELS: cliff-house-8, the upstairs one-way once its floor had its own level).
    const near = (end: { level: number; p: Vec2; y: number }, out: Vec2): Vec2 | null => {
      if (clear(end.p, [r3(end.p[0] + out[0] * 0.7), r3(end.p[1] + out[1] * 0.7)], end.y, end.level)) return null;
      for (const d of [0.5, 0.4]) { const q: Vec2 = [r3(end.p[0] + out[0] * d), r3(end.p[1] + out[1] * d)]; if (clear(end.p, q, end.y, end.level, 0.06)) return q; }
      return null;
    };
    const to = (ht && (pick(l.to, ht, true, 0.12) || pick(l.to, ht, true))) || near(l.to, dir) || pick(l.to, dir) || fallback(l.to, dir);
    if (from || to) l.approach = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    else delete l.approach;
  }
  return part;
}
