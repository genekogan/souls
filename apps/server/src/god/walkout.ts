// G1 "god rules" (Gene, 2026-10-15): a god edit is never refused or delayed because a resident is in, on, asleep in or
// holding what it changes. Before the edit applies, each resident in its way stands up or wakes, sets down what it
// holds, and walks to the nearest clear standing point outside the affected footprint (outside the building for a
// building edit). The exit is checked against the engine's own walking route planner from where the resident would
// stand up and with the same landing check the fold applies; only a resident with no walking route out is relocated.
// Planning here is pure: the bridge logs the moves (`edge-god-walkout`, `edge-relocate` with `godWalkout` when there is
// no route, `edge-stop` for a resident only heading to a changed seat), folds them before the new geometry reaches the
// engine, and gives each resident its reason (notices.ts).
//
// What counts as "in the way": a thing the edit removes, adds, moves or physically re-makes (its solids, floors,
// stairs, slots, landform or water change; a state-only edit such as a door shut, or a cosmetic param such as a wall
// colour, changes nothing anyone stands in), and anything under it; a resident is in the way when it uses one of those
// things (seat, bed, item in hand), stands inside the new solid/floor footprint of one or the old footprint of
// something it could be in or on (the whole box of a building, interior included; a floor or deck), or when the ground
// under it rises over it, drops away by more than a step, or turns to deep water. A resident still walking to a seat
// the edit changes only stops (its body stays). Held things are set down at the resident's feet, or beside its exit
// when its feet are inside what the edit touches; the exit is never inside a footprint the edit touches. An upstairs
// resident whose floor the edit leaves standing (only its chair moved) steps aside on that floor.
import type { Diff, Entity, ResidentMove, WorldModel } from '@sim/world-compiler';
import { isFixtureDef } from '@sim/engine-mars';
import { mediumAt } from '@sim/ground';
import { inSite, siteLocal, siteWorld, type ClosingSite } from './builds.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Zone = ClosingSite['zones'][number];
export type WalkoutEngine = {
  world: { entities: Record<string, any> };
  bodyUsesV1(id: string): { body: string; how: string } | null;
  seatOccupantsV1?(id: string): { body: string }[];
  standableNearV1(at: Vec2, level?: number, except?: string, minClear?: number, maxRing?: number): Vec2 | null;
  godWalkoutRouteV1(id: string, to: Vec2, level?: number): boolean;
  /** The fold's landing check (standing room, walkable ground, no other body there); absent: standableNearV1 only. */
  godWalkoutLandableV1?(id: string, to: Vec2, level?: number): boolean;
  /** Where a walking body is heading (its live walk goal). */
  walkGoalV1?(id: string): { level: number; p: Vec2 } | null;
  levelsV1?(): { id: number; y: number }[];
};
type Mind = { soulId: string; entityId: string; name: string };
/** A resident in the way that no clear ground could be found for (it stays where it is; the receipt warns). */
export type StuckResident = { soulId: string; body: string; name: string; reason: string; place?: string };
export type WalkoutPlan = { moved: ResidentMove[]; stuck: StuckResident[] };

/** Route checks per resident and tier (nearest goals first), and per plan: past the budget, exits are relocations. */
const ROUTE_TRIES = 6, ROUTE_BUDGET = 64;
/** The near search (m); beyond it, coarse rings out to the world's extent (step, directions, at most this many points). */
const NEAR_M = 40, WIDE_STEP = 4, WIDE_DIRS = 24, WIDE_MAX = 12_000;
/** Ground that rises, sinks or changes by more than a step counts as changed. */
const STEP_M = .25;
const round = (n: number) => Math.round(n * 1000) / 1000;
const isBody = (m: WorldModel, e: Entity) => !!m.resolvedDef(e.def)?.components.body;
const isBuilding = (m: WorldModel, e: Entity) => { const d = m.resolvedDef(e.def); return !!d && ((d.make.kind === 'gen' && d.make.gen.startsWith('building/')) || d.tags.includes('building')); };
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Ground a body can stand on in a world: walkable or shallow water (the fold's medium ≤ 1), inside the extent. */
const standable = (m: WorldModel, q: Vec2) => { const [x0, z0, x1, z1] = m.ground().extent; if (!(q[0] > x0 && q[0] < x1 && q[1] > z0 && q[1] < z1)) return false; const md = mediumAt(m.terrain, q[0], q[1]); return md === 'walk' || md === 'wade'; };
const deepWater = (m: WorldModel, q: Vec2) => mediumAt(m.terrain, q[0], q[1]) === 'swim';

/** Engine activities of a body lying down (on a bed or the ground), asleep, seated or getting up, and walking. */
const LYING = new Set(['lie', 'nap']), ASLEEP = new Set(['nap', 'sleep']), SEATED = new Set(['sit', 'sit-down', 'stand-up']), MOVING = new Set(['walk', 'wade', 'swim']);
/** Beside a bed: within a lying body's clearance (0.9 m) of its footprint, as the `lie:`/`sleep:` plans put the body. */
function besideBed(m: WorldModel, bed: Entity, p: Vec2): boolean {
  const wp = m.worldPose(bed); if (Math.hypot(wp.x - p[0], wp.z - p[1]) > 6) return false;
  // Its whole box: a bed's solid part may be only the headboard.
  const d = m.resolvedDef(bed.def), box = d ? m.bake(d, bed.params ?? {}, bed.seed ?? 0, bed.shape).box : [1, 1, 1];
  return inSite({ at: [wp.x, wp.z], size: [box[0] * wp.s, box[2] * wp.s], yaw: wp.yaw }, p, .9);
}

/** Who uses and carries what, from one pass over the engine's entities (built on first need, once per plan). */
class UseIndex {
  private seats?: Map<string, Set<string>>; private carry?: Map<string, Set<string>>; private lying?: { id: string; p: Vec2 }[]; private beds?: Entity[];
  private readonly engine: WalkoutEngine; private readonly before: WorldModel;
  constructor(engine: WalkoutEngine, before: WorldModel) { this.engine = engine; this.before = before; }
  private build() {
    this.seats = new Map(); this.carry = new Map(); this.lying = [];
    const add = (map: Map<string, Set<string>>, body: string, id: string) => map.set(body, (map.get(body) ?? new Set()).add(id));
    for (const [id, x] of Object.entries(this.engine.world.entities)) {
      if (!x) continue;
      if (x.human && LYING.has(x.human.activity)) this.lying.push({ id, p: [x.pose.p[0], x.pose.p[2]] });
      const s = x.support;
      if (s?.kind === 'in-hand' && typeof s.by === 'string') add(this.carry, s.by, id);
      else if (s?.kind === 'held' && Array.isArray(s.by)) for (const by of s.by) add(this.carry, by, id);
      if (x.kind === 'fixture' && this.before.entities.has(id)) for (const u of this.engine.seatOccupantsV1?.(id) ?? []) add(this.seats, u.body, id);
    }
  }
  /** God things a body sits on (claimed seats). */
  seated(body: string): Set<string> { if (!this.seats) this.build(); return this.seats!.get(body) ?? new Set(); }
  /** Everything a body carries, alone or with others. */
  carried(body: string): Set<string> { if (!this.carry) this.build(); return this.carry!.get(body) ?? new Set(); }
  /** Bodies lying beside a god bed (engine-bridge `lie:`/`sleep:` plans put the body at a standable point by its side). */
  lyingBeside(bed: Entity): string[] { if (!this.lying) this.build(); return this.lying!.filter(o => besideBed(this.before, bed, o.p)).map(o => o.id); }
  /** God beds a lying body at p is beside. */
  bedsAt(p: Vec2): string[] {
    this.beds ??= [...this.before.entities.values()].filter(e => this.engine.world.entities[e.id] && this.before.slotsOf(e).some(s => s.kind === 'bed'));
    return this.beds.filter(e => besideBed(this.before, e, p)).map(e => e.id);
  }
}

/** A thing's plain name ("church", "bench"), for the sentence a resident reads. */
export function thingName(m: WorldModel, id: string): string {
  const e = m.entities.get(id), d = e && m.resolvedDef(e.def);
  return (e?.name ?? d?.name.replace(/^core-/, '') ?? 'something').replace(/[-_]+/g, ' ');
}

/** Where a thing is and what a body meets in it: its pose, solids, floors, openings, stairs, rooms, slots, landform and
 *  water. A state-only edit or a cosmetic param (a colour, a material) leaves this unchanged. */
function physicsKey(m: WorldModel, id: string): string | null {
  const e = m.entities.get(id); if (!e) return null;
  const p = m.worldPose(e), d = m.resolvedDef(e.def), b = d ? m.bake(d, e.params ?? {}, e.seed ?? 0, e.shape) : null;
  return JSON.stringify([e.in.parent, e.in.slot ?? null, [p.x, p.y, p.z, p.yaw, p.s].map(round), d ? [d.layer, d.form, d.components.floor ?? null] : null, b && [
    b.box, b.colliders, (b.surfaces ?? []).map(s => [s.level, s.y, s.polygon, s.abs ?? false]),
    (b.openings ?? []).map(o => [o.id, o.kind, o.at, o.yaw, o.width, o.height, o.sill ?? 0, o.level, o.state ?? null]),
    b.links ?? [], (b.rooms ?? []).map(r => [r.id, r.floor, r.y, r.polygon, r.origin, r.yaw, r.height]),
    b.slots.map(s => [s.id, s.kind, s.p, s.yaw, s.height ?? null, s.capacity ?? null]), b.landform ?? null, b.water ?? null]]);
}

/** What an edit physically changes (never bodies): removed, added, moved or re-made things, with their subtrees. */
export function affectedBy(before: WorldModel, after: WorldModel, diff: Diff): { ids: Set<string>; removed: Set<string>; added: Set<string> } {
  const removed = new Set(diff.removes.filter(id => { const e = before.entities.get(id); return !!e && !isBody(before, e); }));
  const added = new Set<string>(), ids = new Set<string>(removed);
  for (const u of diff.upserts) {
    if (!after.entities.has(u.id) || isBody(after, u)) continue;
    for (const id of after.subtree(u.id)) {
      const e = after.entities.get(id); if (!e || ids.has(id) || isBody(after, e)) continue;
      if (!before.entities.has(id)) { added.add(id); ids.add(id); }
      else if (physicsKey(before, id) !== physicsKey(after, id)) ids.add(id);
    }
  }
  return { ids, removed, added };
}

/** The ground a thing's footprint covers: a building's whole box (rooms included), solid colliders, walkable floors. */
export function zonesOf(m: WorldModel, id: string, holdingOnly = false): Zone[] {
  const e = m.entities.get(id); if (!e || isBody(m, e)) return [];
  const d = m.resolvedDef(e.def); if (!d) return [];
  const baked = m.bake(d, e.params ?? {}, e.seed ?? 0, e.shape), wp = m.worldPose(e);
  const worldFrame = d.form !== 'point' && e.in.parent === 'world';
  // Ground cover (roads, lawns, plazas: ground-relative level-0 surfaces of world-frame shapes) is the ground itself.
  const floors = !!baked.links?.length || !!d.components.floor || (baked.surfaces ?? []).some(s => !(worldFrame && !(s as { abs?: boolean }).abs && s.level === 0));
  // Where a thing was matters only if residents can be in or on it (a building, a floor, a deck): a plain solid that
  // moves away or is removed leaves its neighbours standing where they are.
  if (holdingOnly && !floors && !isBuilding(m, e)) return [];
  if (!worldFrame && (isBuilding(m, e) || floors)) return [{ at: [wp.x, wp.z], size: [baked.box[0] * wp.s, baked.box[2] * wp.s], yaw: wp.yaw }];
  const zones: Zone[] = d.layer === 'solid' || floors ? m.footprint(e, d).map(o => ({ at: o.c, size: [o.half[0] * 2, o.half[1] * 2] as Vec2, yaw: o.yaw })) : [];
  // #1066: the engine keeps a body out of a fixture's whole box, not just its colliders: under a table top reads clearance 0, and
  // a body left there faults the world. Where it stands now matters only if the thing arrives or moves there, so not for `holdingOnly`.
  if (!holdingOnly && !worldFrame && isFixtureDef(d as never) && !(d.components.carryable && !d.tags.includes('upright-carry'))) zones.push({ at: [wp.x, wp.z], size: [baked.box[0] * wp.s, baked.box[2] * wp.s], yaw: wp.yaw });
  if (worldFrame && floors) {
    // A deck, pier or bridge along a path or over an area: its outline, plus half its width.
    const pts = ((e.shape as { path?: Vec2[]; area?: Vec2[] } | undefined)?.path ?? (e.shape as { area?: Vec2[] } | undefined)?.area ?? []) as Vec2[];
    if (pts.length) {
      const pad = Number(e.params?.width ?? 2) / 2 + .5, xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
      zones.push({ at: [(x0 + x1) / 2, (z0 + z1) / 2], size: [x1 - x0, z1 - z0], yaw: 0 });
    }
  }
  if (!zones.length && d.layer === 'solid' && !worldFrame) zones.push({ at: [wp.x, wp.z], size: [baked.box[0] * wp.s, baked.box[2] * wp.s], yaw: wp.yaw });
  return zones;
}

/** Near exits: just outside each zone's edges (doors and far edges too, so a blocked near edge never forces a
 *  relocation), then rings out to NEAR_M; nearest first. */
function candidates(p: Vec2, zones: Zone[]): Vec2[] {
  const points: Vec2[] = [];
  for (const zone of zones) {
    const [x, z] = siteLocal(zone, p), [hx, hz] = zone.size.map(v => v / 2), gap = .65;
    const clamp = (v: number, h: number) => Math.max(-h, Math.min(h, v));
    const local: Vec2[] = [[-hx - gap, clamp(z, hz)], [hx + gap, clamp(z, hz)], [clamp(x, hx), -hz - gap], [clamp(x, hx), hz + gap]];
    for (const a of [-1, 1]) for (const b of [-1, 1]) local.push([a * (hx + gap), b * (hz + gap)]);
    for (let i = 1; i <= 8; i++) for (const side of [-1, 1]) {
      local.push([-hx - gap, side * hz * i / 8], [hx + gap, side * hz * i / 8], [side * hx * i / 8, -hz - gap], [side * hx * i / 8, hz + gap]);
    }
    points.push(...local.map(q => siteWorld(zone, q)));
  }
  // A wider search also clears overlapping before/after footprints of a moved building and changed ground.
  for (let r = .5; r <= NEAR_M; r += r < 4 ? .5 : 1) for (let k = 0; k < 16; k++) points.push([p[0] + r * Math.cos(k * Math.PI / 8), p[1] + r * Math.sin(k * Math.PI / 8)]);
  return points.map(q => q.map(round) as Vec2).sort((a, b) => dist(a, p) - dist(b, p) || a[0] - b[0] || a[1] - b[1]);
}
/** Far exits: coarse rings from NEAR_M out to the farthest corner of the world's extent. */
function wideCandidates(p: Vec2, extent: [number, number, number, number]): Vec2[] {
  const [x0, z0, x1, z1] = extent, far = Math.max(...[[x0, z0], [x0, z1], [x1, z0], [x1, z1]].map(c => dist(c as Vec2, p)));
  const points: Vec2[] = [];
  for (let r = NEAR_M + WIDE_STEP; r <= far && points.length < WIDE_MAX; r += WIDE_STEP) for (let k = 0; k < WIDE_DIRS; k++) {
    const q: Vec2 = [round(p[0] + r * Math.cos(k * 2 * Math.PI / WIDE_DIRS)), round(p[1] + r * Math.sin(k * 2 * Math.PI / WIDE_DIRS))];
    if (q[0] > x0 && q[0] < x1 && q[1] > z0 && q[1] < z1) points.push(q);
  }
  return points;
}

type ExitCtx = { engine: WalkoutEngine; before: WorldModel; after: WorldModel; body: string; p: Vec2; zones: Zone[]; groundEdited: boolean; reserved: Vec2[]; budget: { routes: number }; levelY: (level: number) => number };
type Exit = { to: Vec2; how: 'walked' | 'relocated'; level: number };

/** Clear standing points among `points`, nearest candidates first and found lazily (each costs engine reads): outside
 *  every affected footprint, away from other exits, on ground a body can stand on in the world as it will be
 *  (unchanged ground only when `unchanged`), with standing room in the engine now (the fold's own landing check) and in
 *  the world as it will be. */
function* goalsIn(c: ExitCtx, points: Vec2[], level: number, unchanged: boolean): Generator<Vec2> {
  const { engine, before, after, body } = c;
  const clear = (q: Vec2) => !c.zones.some(z => inSite(z, q, .4)) && !c.reserved.some(r => dist(r, q) < .85)
    && (level > 0 || (standable(after, q) && !(unchanged && c.groundEdited && Math.abs(after.terrain.sample(q[0], q[1]) - before.terrain.sample(q[0], q[1])) > STEP_M)));
  const seen = new Set<string>();
  for (const q of points) {
    if (!clear(q)) continue;
    const to = engine.standableNearV1(q, level, body, .4, 2); if (!to || !clear(to)) continue;
    const key = to.join(','); if (seen.has(key)) continue; seen.add(key);
    if (engine.godWalkoutLandableV1 && !engine.godWalkoutLandableV1(body, to, level)) continue;
    // The world as it will be must also leave standing room there (the engine has not seen the edit yet).
    const y = level > 0 ? c.levelY(level) : after.terrain.sample(to[0], to[1]);
    const blocked = [...after.near([{ c: to, half: [.4, .4], yaw: 0, y0: y, y1: y + 1.8 }])].some(id => {
      const e = after.entities.get(id); if (!e || isBody(after, e)) return false;
      return after.footprintsOf(id).some(o => {
        if (o.y1 <= y + .22 || o.y0 >= y + 1.8) return false;
        const [lx, lz] = siteLocal({ at: o.c, size: [o.half[0] * 2, o.half[1] * 2], yaw: o.yaw }, to);
        return Math.abs(lx) < o.half[0] + .35 && Math.abs(lz) < o.half[1] + .35;
      });
    });
    if (!blocked) yield to;
  }
}
/** The first goal the resident can walk to among the first `tries` (each route check spends the plan's budget), else
 *  the nearest goal found, to be relocated to; null when there is none. */
function pick(c: ExitCtx, goals: Iterable<Vec2>, level: number, tries = ROUTE_TRIES): Exit | null {
  let first: Vec2 | null = null, n = 0;
  for (const to of goals) {
    first ??= to;
    if (c.budget.routes <= 0) break;
    c.budget.routes--;
    if (c.engine.godWalkoutRouteV1(c.body, to, level)) return { to, how: 'walked', level };
    if (++n >= tries) break;
  }
  return first ? { to: first, how: 'relocated', level } : null;
}

/** Nearest clear standing point outside every affected footprint, walked to when a route is open, else relocated:
 *  1. near, on its own floor (an upstairs resident whose floor stays; walked only, else the ground is tried) or on
 *     ground the edit leaves unchanged; 2. near, on ground the edit changed that a body can stand on (it rises or sinks
 *     with the ground); 3. anywhere in the world's extent. Null only when the world has no clear standing ground. */
export function exitFor(c: ExitCtx, ownLevel = 0): Exit | null {
  const near = candidates(c.p, c.zones);
  if (ownLevel > 0) {
    const upstairs = pick(c, goalsIn(c, near.filter(q => dist(q, c.p) <= 12), ownLevel, true), ownLevel);
    if (upstairs?.how === 'walked') return upstairs;
  }
  return pick(c, goalsIn(c, near, 0, true), 0)
    ?? (c.groundEdited ? pick(c, goalsIn(c, near, 0, false), 0, 2) : null)
    ?? pick({ ...c, budget: { routes: 0 } }, goalsIn(c, wideCandidates(c.p, c.after.ground().extent), 0, false), 0);
}

/** The sentence a resident reads: what the god is doing, what the resident did, where it went. */
export function walkoutReason(o: { verb: string; subject: string; how: ResidentMove['how'] | 'stuck'; outside: boolean; seated?: boolean; asleep?: boolean; lying?: boolean; setDown?: string[]; site?: boolean }): string {
  const did = [o.asleep ? 'you woke' : o.seated ? 'you stood up' : o.lying ? 'you got up' : '', o.setDown?.length ? `you set down ${o.setDown.length === 1 ? `the ${o.setDown[0]}` : `the ${o.setDown.slice(0, -1).join(', the ')} and the ${o.setDown.at(-1)}`}` : ''].filter(Boolean);
  const where = o.site ? 'off the site' : o.outside ? 'outside' : 'aside';
  const head = o.site ? `The god started building ${o.subject} here` : `The god is ${o.verb} ${o.subject}`;
  if (o.how === 'stopped') return `The god is ${o.verb} ${o.subject} you were heading for; you stopped.`;
  if (o.how === 'stuck') return `${head}; there was no clear ground to step to, so you stayed where you were.`;
  if (o.how === 'walked') return `${head}; ${did.length ? `${did.join(', ')} and stepped ${where}` : `you stepped ${where}`}.`;
  return `${head}; ${did.length ? `${did.join(', ')}; ` : ''}no walking route was open, so you were moved safely ${where}.`;
}

/** Residents in the way of an edit (or inside closing construction zones), each with its exit, reason and what it lets
 *  go of. Pure: reads the engine, changes nothing. A resident walking through a closing site to somewhere outside it
 *  is passing by, not in the way. */
export function planWalkouts(engine: WalkoutEngine, before: WorldModel, after: WorldModel, diff: Diff, minds: Iterable<Mind>, closure?: { zones: Zone[]; title: string; avoid?: Zone[] }): WalkoutPlan {
  const { ids, removed, added } = closure ? { ids: new Set<string>(), removed: new Set<string>(), added: new Set<string>() } : affectedBy(before, after, diff);
  const zoneOf = new Map<string, Zone[]>();
  for (const id of ids) zoneOf.set(id, [...(before.entities.has(id) ? zonesOf(before, id, true) : []), ...(after.entities.has(id) ? zonesOf(after, id) : [])]);
  const zones = closure?.zones ?? [...zoneOf.values()].flat();
  const watersChanged = !closure && before.ground().waters !== after.ground().waters && JSON.stringify(before.ground().waters) !== JSON.stringify(after.ground().waters);
  const groundEdited = !closure && (diff.tiles.length > 0 || watersChanged);
  const index = new UseIndex(engine, before), levels = engine.levelsV1?.() ?? [];
  // Who uses what the edit changes: a seat (claimed, perhaps still on the way to it), a bed, an item in hand.
  const uses = new Map<string, Map<string, 'seat' | 'held' | 'bed'>>(), use = (body: string, id: string, how: 'seat' | 'held' | 'bed') => { const m = uses.get(body) ?? new Map(); if (m.get(id) !== 'held') m.set(id, how); uses.set(body, m); };
  for (const id of ids) {
    for (const u of engine.seatOccupantsV1?.(id) ?? []) use(u.body, id, 'seat');
    const u = engine.bodyUsesV1(id); if (u) use(u.body, id, u.how === 'held' ? 'held' : 'seat');
    const e = before.entities.get(id), parent = e && e.in.parent !== 'world' ? before.entities.get(e.in.parent) : undefined;
    if (parent && isBody(before, parent)) use(parent.id, id, 'held');
    for (const b of e && before.slotsOf(e).some(s => s.kind === 'bed') ? index.lyingBeside(e) : []) use(b, id, 'bed');
  }
  const top = (id: string) => { let cur = id; for (;;) { const m = before.entities.has(cur) ? before : after, parent = m.entities.get(cur)?.in.parent; if (!parent || parent === 'world' || !ids.has(parent)) return cur; cur = parent; } };
  const ground = [...ids].find(id => { const m = after.entities.has(id) ? after : before, e = m.entities.get(id), d = e && m.resolvedDef(e.def); if (!d) return false; const b = m.bake(d, e!.params ?? {}, e!.seed ?? 0, e!.shape); return !!b.landform || !!b.water; });
  const moved: ResidentMove[] = [], stuck: StuckResident[] = [], reserved: Vec2[] = [], budget = { routes: ROUTE_BUDGET };
  for (const m of minds) {
    const b = engine.world.entities[m.entityId], h = b?.human; if (!h) continue;
    const p: Vec2 = [b.pose.p[0], b.pose.p[2]], level = h.level ?? 0;
    const inside = [...zoneOf].filter(([, zs]) => zs.some(z => inSite(z, p, .35))).map(([id]) => id);
    // The ground rises over the body, or drops away from under it (left standing on air), by more than a step.
    const ga = after.terrain.sample(p[0], p[1]), gb = before.terrain.sample(p[0], p[1]);
    const buried = groundEdited && ga > Math.max(b.pose.p[1], gb) + STEP_M;
    const sunk = groundEdited && level === 0 && ga < Math.min(b.pose.p[1], gb) - STEP_M;
    const wet = groundEdited && level === 0 && deepWater(after, p) && !deepWater(before, p);
    const here = uses.get(m.entityId);
    const seated = SEATED.has(h.activity) || h.baseActivity === 'sit', lying = LYING.has(h.activity), asleep = !!h.sleepPose || ASLEEP.has(h.activity);
    if (closure) {
      if (!zones.some(z => inSite(z, p, .35))) continue;
      // Walking through to somewhere outside the site: passing by (closures refuse destinations inside, not routes).
      const goal = engine.walkGoalV1?.(m.entityId);
      if ((MOVING.has(h.activity) || (h.speed ?? 0) > .05) && !seated && !(goal && zones.some(z => inSite(z, goal.p, .35)))) continue;
    } else if (!here && !inside.length && !buried && !sunk && !wet) continue;
    // The thing to name: the outermost changed thing it uses or stands in (the house, not the chair in it).
    const subjects = [...(here?.keys() ?? []), ...inside].map(top);
    const subject = subjects.find(id => { const e = before.entities.get(id) ?? after.entities.get(id); return !!e && isBuilding(before.entities.has(id) ? before : after, e); }) ?? subjects[0] ?? ground;
    const subjectModel = subject && !after.entities.has(subject) ? before : after;
    const place = closure ? closure.title : subject ? thingName(subjectModel, subject) : undefined, name = place ?? 'the ground here';
    const posed = (id: string) => { const a = before.entities.get(id), z = after.entities.get(id); if (!a || !z) return false; const pa = before.worldPose(a), pz = after.worldPose(z); return Math.hypot(pa.x - pz.x, pa.y - pz.y, pa.z - pz.z) > 1e-3 || Math.abs(pa.yaw - pz.yaw) > 1e-4; };
    const verb = !subject ? 'reshaping' : removed.has(subject) ? 'removing' : added.has(subject) ? 'building' : posed(subject) ? 'moving' : 'rebuilding';
    const outside = !!subject && (() => { const e = subjectModel.entities.get(subject); return !!e && isBuilding(subjectModel, e); })();
    const said = closure || !subject ? name : `the ${name}`;
    // Still on its way to a seat the edit changes (claimed, not yet sat on): it only stops; its body stays put.
    if (!closure && here && [...here.values()].every(k => k === 'seat') && !seated && !lying && !inside.length && !buried && !sunk && !wet) {
      moved.push({ soulId: m.soulId, body: m.entityId, name: m.name, how: 'stopped', from: [round(p[0]), round(p[1])], to: [round(p[0]), round(p[1])], reason: walkoutReason({ verb, subject: said, how: 'stopped', outside }), released: [...here.keys()].sort(), ...(place ? { place } : {}) });
      continue;
    }
    // An upstairs resident steps aside on its own floor when only what it uses there changed (not its floor).
    const ownLevel = !closure && level > 0 && !inside.length && !buried ? level : 0;
    const usedZones = ownLevel ? [...(here?.keys() ?? [])].flatMap(id => zoneOf.get(id) ?? []) : [];
    const avoid = ownLevel ? usedZones : closure?.avoid ?? zones;
    const levelY = (l: number) => levels.find(x => x.id === l)?.y ?? b.pose.p[1];
    const exit = exitFor({ engine, before, after, body: m.entityId, p, zones: avoid.length ? avoid : [{ at: p, size: [1, 1], yaw: 0 }], groundEdited, reserved, budget, levelY }, ownLevel);
    if (!exit) { stuck.push({ soulId: m.soulId, body: m.entityId, name: m.name, reason: walkoutReason({ verb, subject: said, how: 'stuck', outside, site: !!closure }), ...(place ? { place } : {}) }); continue; }
    reserved.push(exit.to);
    // Everything it lets go of: what it uses here, its seat or bed anywhere, what it carries (alone or with others).
    const released = new Set([...(here?.keys() ?? []), ...index.seated(m.entityId)]);
    if (typeof h.sleepPose?.mat === 'string') released.add(h.sleepPose.mat);
    if (lying) for (const id of index.bedsAt(p)) released.add(id);
    const carried = new Set([...index.carried(m.entityId), ...(before.children.get(m.entityId) ?? [])]);
    for (const id of carried) released.add(id);
    // Held things are set down at its feet, or beside its exit when its feet are inside what the edit touches.
    const feetInside = inside.length > 0 || buried || sunk || wet || zones.some(z => inSite(z, p, .35));
    const exitY = exit.level > 0 ? levelY(exit.level) : after.terrain.sample(exit.to[0], exit.to[1]);
    const dropAt: [number, number, number] = feetInside ? [exit.to[0], round(exitY), exit.to[1]]
      : [round(p[0]), round(level > 0 ? levelY(level) : after.terrain.sample(p[0], p[1])), round(p[1])];
    const setDown = [...carried].map(id => before.entities.has(id) ? thingName(before, id) : String(engine.world.entities[id]?.label ?? 'thing').toLowerCase());
    const reason = walkoutReason({ verb, subject: said, how: exit.how, outside: outside && exit.level === 0, seated, asleep, lying, setDown, site: !!closure });
    moved.push({ soulId: m.soulId, body: m.entityId, name: m.name, how: exit.how, from: [round(p[0]), round(p[1])], to: exit.to, ...(exit.level ? { level: exit.level } : {}), reason, released: [...released].sort(), ...(carried.size ? { dropAt } : {}), ...(place ? { place } : {}) });
  }
  return { moved, stuck };
}

/** Held things leave the resident's hands in the entity world too, set down where the engine sets them down. A thing
 *  the edit itself places elsewhere keeps the god's placement. Never written to the edit's inverse: an undo must not
 *  put a thing back into a resident's hands (see unhand). Returns the ids it rewrote. */
export function dropReleased(after: WorldModel, diff: Diff, moved: ResidentMove[]): string[] {
  const touched: string[] = [];
  for (const m of moved) {
    if (!m.dropAt) continue;
    for (const id of m.released) if (setDown(after, diff, id, m.body, m.dropAt)) touched.push(id);
  }
  return touched;
}
/** Re-parent a thing held by `body` to the ground at `at` in the would-be world and its diff. */
function setDown(after: WorldModel, diff: Diff, id: string, body: string, at: [number, number, number]): boolean {
  const e = after.entities.get(id); if (!e || e.in.parent !== body) return false;
  const taken = e.name && after.names.get(`world/${e.name}`), name = taken && taken !== id ? `${e.name}-${id.slice(-4)}` : e.name;
  const next: Entity = { ...e, ...(name ? { name } : {}), in: { parent: 'world' }, p: [...at], v: e.v + 1 };
  after.delete(id); after.insert(next);
  const d = after.resolvedDef(next.def), fp = d?.layer === 'solid' ? after.footprint(next, d) : [];
  if (fp.length) after.index(id, fp);
  const i = diff.upserts.findIndex(x => x.id === id); if (i >= 0) diff.upserts[i] = next; else diff.upserts.push(next);
  return true;
}
/** A god edit never puts a thing into a resident's hands. An undo or redo that would (the edit it reverts took the thing
 *  from them, or removed it while they held it) sets it down at the resident's feet instead, with a warning. Direct ops
 *  that aim at a resident's hands are refused before this (engine-bridge protectedBody). */
export function unhand(engine: WalkoutEngine, before: WorldModel, after: WorldModel, diff: Diff): { warnings: string[]; touched: string[] } {
  const warnings: string[] = [], touched: string[] = [];
  for (const u of [...diff.upserts]) {
    const e = after.entities.get(u.id); if (!e || e.in.parent === 'world') continue;
    const holder = after.entities.get(e.in.parent); if (!holder || !isBody(after, holder) || before.entities.get(u.id)?.in.parent === holder.id) continue;
    const b = engine.world.entities[holder.id], wp = after.worldPose(holder), p: Vec2 = b?.pose?.p ? [b.pose.p[0], b.pose.p[2]] : [wp.x, wp.z];
    const up = (b?.human?.level ?? 0) > 0, at: [number, number, number] = [round(p[0]), round(up ? b.pose.p[1] : after.terrain.sample(p[0], p[1])), round(p[1])];
    if (!setDown(after, diff, u.id, holder.id, at)) continue;
    touched.push(u.id);
    warnings.push(`held.set-down: ${after.pathOf(u.id)} was set down at ${String(b?.label ?? holder.name ?? holder.id)}'s feet (${at[0]}, ${at[2]}); a god edit never puts things into a resident's hands`);
  }
  return { warnings, touched };
}
/** The god's line for a resident in the way that no clear ground was found for. */
export const stuckWarning = (x: StuckResident) => `body.stuck: ${x.name} (${x.body}) is in the edit's way but no clear standing ground was found; left where they are; told "${x.reason}"`;
