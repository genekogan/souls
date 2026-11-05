// Soul navigation to god-built named things (party lane P4). On an entity world a Soul can walk to anything the god
// built and named, by its path: `walk:fountain`, `walk:rose-house` (in at its front door), `walk:rose-house/living`
// (that room's floor), `walk:plaza/bench-2` (the bench's front). Each resolves to a standing point the engine can plan
// to: inside a building's open front door (outside it when the door is closed), a room's floor, the approach to a seat,
// a fountain's rim, the nearest shore of a pond.
//
// World-engine side only: the engine bridge offers these as ordinary `walk:<path>` capabilities through the ledger's
// existing world-profile hook (as the ground host offers `walk:flag-<name>`), labelled with what each thing is and what
// it is by, so the ledger's own vocabulary resolves plain words ("walk to the fountain", "go into rose-house",
// "sit on the bench by the pond") to them. No edge contract change: no new verbs, fields or routes.
//
// Pure reads over the entity model and the engine's standing grids; nothing here is logged or changes the world.
import {menuWorldOf, type MenuWorld} from '../split/menu-world.ts';
import { deckRaised } from '@sim/generators';
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import { humanTitle, meaningParts } from './meaning.ts';
import { isShut } from './doors.ts';
import type { MenuFocus } from '../edge/ledger/focus.ts';
import type {ActivityServicePoint} from './activity-spots.ts';
import {HUMAN_RADIUS} from '../../../../mars/viewer/engine/world/catalog.ts';
import { keptShut } from './actuators.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Step = { verb: string; params: Record<string, unknown> };
type Plans = Map<string, { label: string; steps: Step[]; seconds?: boolean }>;
type Engine = {
  world: { tick: number; entities: Record<string, any> };
  standableNearV1(at: Vec2, level?: number, except?: string, minClear?: number, maxRing?: number): Vec2 | null;
  reachV1?(from: { p: Vec2; level?: number }, to: { p: Vec2; level?: number }): { ok: boolean };
  /** The navigation epoch: moves exactly when the static world the planner sees does (spatial navChanged). */
  navEpochV1?(): number;
  /** Nav labels: label up to `budgetMs` more, true when complete; then whether points are on the main walkable ground and
   *  the nearest open spot of it to a point. */
  navWarmV1?(budgetMs: number): boolean;
  navCheckV1?(points: { id: string; p: Vec2; level?: number }[]): { ok: boolean }[];
  navNearestMainV1?(p: Vec2, except?: string, maxR?: number): Vec2 | null;
};
export type NavHost = {
  model: WorldModel;
  /** Changes when anything but a body's pose changed (the engine bridge's version); else the model's editSeq. */
  version?: () => number;
  /** E-life: changes only with the god's edits (furniture, walls, doors placed): room goals are kept across engine
   *  writebacks (a carried cup, a duck) that used to re-route every room near the Soul. Unset: `version`. */
  staticVersion?: () => number;
  engine: Engine;
  /** Derived work positions, independent of whether someone is using them.
   * Stable array identity until their authored geometry changes. */
  serviceStandingPoints?(): readonly ActivityServicePoint[] | undefined;
  /** Physical same-level interior outlines for this outdoor destination. */
  outdoorRegionExclusions?(ref: string): Vec2[][] | undefined;
  /** Engine level of a standing height at (x, z): 0 on the ground (any terrain height), else a floor's level. */
  levelAt(x: number, z: number, y: number): number;
  /** Things the engine owns (bodies and what they carry). */
  engineOwned(e: Entity): boolean;
  /** R4-INFO: the place (places.ts) a thing is, if it is one: its walk then targets that place (exits, map, `via`). */
  placeOf?(ref: string): string | undefined;
  /** G1: changes when what every thing's description reads beyond the thing and what holds it changed (terrain, defs,
   *  the engine's levels); unset: descriptions are never reused across rebuilds. */
  describeStamp?: () => string;
};

export type ThingKind = 'building' | 'room' | 'seat' | 'water' | 'area' | 'path' | 'thing';
/** A named god-built thing (or a room of a building) a Soul can walk to. */
export type Thing = {
  /** What the Soul names: the entity's path (`plaza/bench-2`) or `<building path>/<room id>`. */
  ref: string;
  id: string;
  room?: string;
  /** A semantic alias/stand target; excluded from physical place membership. */
  semanticPart?: {owner:string; part:string; entity?:string; local?:true; seat?:{entity:string;slot:string}};
  name: string;
  aliases?: string[];
  kind: ThingKind;
  /** A stand-alone structure big enough to head for from anywhere nearby, like a building. */
  big?: boolean;
  /** e.g. "a cottage", "a bench", "Living room of rose-house". */
  what: string;
  /** Words it answers to (names, def name, tags, parent's name). */
  words: string[];
  /** Reference point (for distances and "by the X") and its level. */
  at: Vec2;
  level: number;
  /** A room's floor height above its building's base (m): a low raised floor (a deck reached by a few risers) is not an upper storey. */
  rise?: number;
  /** Rooms: the storey (0 the ground floor, 1 the first floor above it). */
  floor?: number;
  /** Area things: their outline; path things: their centre line + width. */
  area?: Vec2[];
  path?: Vec2[];
  width?: number;
  /** Rooms: their world outline (for "you are in"). Buildings: their rooms' refs. */
  poly?: Vec2[];
  /** Room geometry in the building frame, for rotation-invariant fallback sampling only when needed. */
  roomFrame?: { poly: Vec2[]; at: Vec2; origin: Vec2; yaw: number; scale: number };
  rooms?: string[];
  /** Standing points to approach from (seat fronts, a fountain's rim; a building's door approach), on `level`. */
  stands?: Vec2[];
  /** Buildings: just inside the front door, and whether that door is open now. */
  inside?: Vec2;
  doorOpen?: boolean;
  /** Has a seat (sit:<id> is offered near it). */
  seat?: boolean;
  /** Piers, decks, bridges: standing points ON the deck, preferred in order (F1). */
  deck?: Vec2[];
  /** Rooms: where the building is entered from outside (its front door's approach), for the reachability check. */
  entry?: { p: Vec2; level: number };
};

const NO_SERVICE_POINTS: readonly ActivityServicePoint[] = [];
// Same distance at which the activity layer considers another body to take a spot.
const SERVICE_STAND_DISTANCE = 0.7;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** L8: nearest first, ties by ref, so "by the X" names do not depend on the things list's order (a boot's full pass and
 *  incremental passes built it differently: 472 built objects rewrote their `near` on every first boot after a copy). */
const byDistanceThenRef = (a: { o: { ref: string }; d: number }, b: { o: { ref: string }; d: number }) => a.d - b.d || (a.o.ref < b.o.ref ? -1 : a.o.ref > b.o.ref ? 1 : 0);
const SHOW = 120;            // walk capabilities offered: the nearest this many named things (plus rooms of near buildings)
const ROOMS_WITHIN = 80;
/** Upper-storey rooms are offered inside (or at the door of) their building, or to a Soul already upstairs (m). */
const UPPER_ROOMS_WITHIN = 1;
/** ... but a raised floor lower than this (Mars: Mimos main at .53 m, the kitchen's diner up its steps) is offered like the ground floor. */
const LOW_RISE_M = 1.5;
const BUILDINGS_WITHIN = 150;
const DOWN_FIRST_M = 60;     // from a raised floor, a ground goal farther than this is walked to via the building's front (the engine pages long walks on the ground only, from 72 m)
const PLACE_M2 = 300;       // ... at least this big (a court or a garden, not a paving tile or an exhibit's pad)
const PLACES_MAX = 6;          // ... the nearest this many of them
const PLACES_WITHIN = 400;   // an open area that is one of the world's places (a court, a garden) stays offered within this many metres
const BIG_THING_M2 = 200;    // a root thing whose solids spread over at least this much ground is offered like a building
const THING_REACH_M = 3.5;  // RESOLVE: a walk to a named thing ends this close to it (next to the horse, not its lawn's middle)
const STROLL_AREA = 150;     // m²: an open area this big offers a stroll through it (the ledger strolls places ≥ 250 m²)     // rooms of buildings within this many metres are offered too
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'at', 'on']);
const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

const polyArea = (p: Vec2[]) => Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
/** MARSLIVED: the height a thing is reached from — the floor its support stands on. A cup on a tea table is reached from
 *  the table's floor, not at the table top's height: a 0.55 m top matched Mimos's 0.53 m raised floor (its own level),
 *  so Souls were sent up there to fetch a cup from a ground-floor table, and found no standing room. */
export function supportY(m: { entities: Map<string, Entity>; slotsOf(e: Entity): { id: string; kind: string }[]; worldPose(e: Entity): { y: number } }, e: Entity): number {
  let x = e;
  for (let i = 0; i < 8 && x.in.parent !== 'world'; i++) {
    const p = m.entities.get(x.in.parent); if (!p) break;
    const kind = m.slotsOf(p).find((s) => s.id === x.in.slot)?.kind;
    if (!kind || kind === 'room' || kind === 'floor' || kind === 'stand') break;   // in a building's room: on its floor
    if (kind === 'roof') return m.worldPose(e).y;   // RESOLVE2: on a roof: reached from the roof, not the ground below it
    x = p;
  }
  return m.worldPose(x).y;
}
function centroid(pts: Vec2[]): Vec2 { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }
function inPoly(x: number, z: number, poly: Vec2[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
/** Nearest point on a polyline (closed when `loop`). */
function nearestOn(pts: Vec2[], p: Vec2, loop: boolean): { q: Vec2; d: number; dir: Vec2 } {
  let best: { q: Vec2; d: number; dir: Vec2 } = { q: pts[0], d: Infinity, dir: [1, 0] };
  const n = loop ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0, q: Vec2 = [a[0] + dx * t, a[1] + dz * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < best.d) { const l = Math.sqrt(L) || 1; best = { q, d, dir: [dx / l, dz / l] }; }
  }
  return best;
}
const shortDef = (def: StoredDef) => def.name.replace(/^core-/, '').replace(/^ew-/, '');
const article = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);

export class GodNav {
  private h: NavHost;
  private cache: { key: string; things: Thing[]; byRef: Map<string, Thing> } | null = null;
  private goals = new Map<string, { tick: number; key: string; goal: { p: Vec2; level: number } | null }>();
  constructor(h: NavHost) { this.h = h; }
  /** B-facade: the world this read code reaches (split/menu-world.ts); `h.engine` may be the engine or a MenuWorld. */
  private get E(): MenuWorld { return menuWorldOf(this.h); }
  private servicePoints: readonly ActivityServicePoint[] = NO_SERVICE_POINTS;
  private refreshServicePoints() {
    const points = this.h.serviceStandingPoints?.() ?? NO_SERVICE_POINTS;
    if (points !== this.servicePoints) {
      this.servicePoints = points;
      this.goals.clear(); this.rooms.clear();
    }
  }

  // ------------------------------------------------------------------ what is there

  /** Every named thing (and room) in the entity world, rebuilt when the world changes. */
  things(): Thing[] { return this.index().things; }
  /** BOOT2: the things, deriving them (when stale) in steps that yield every few dozen entities, so a sliced caller
   *  (the places' catch-up) never runs the whole ~5,000-entity describe in one go. Same result as `things()`. */
  *thingsGen(): Generator<void, Thing[], void> { const key = this.indexKey(); return (this.cache?.key === key ? this.cache : yield* this.indexGen(key)).things; }
  thing(ref: string): Thing | undefined { return this.index().byRef.get(ref); }
  private indexKey() { const m = this.h.model; return `${this.h.version?.() ?? m.editSeq}:${m.entities.size}`; }
  private index() {
    const key = this.indexKey();
    if (this.cache?.key === key) return this.cache;
    const it = this.indexGen(key); for (;;) { const r = it.next(); if (r.done) return r.value; }
  }
  private *indexGen(key: string): Generator<void, NonNullable<GodNav['cache']>, void> {
    const m = this.h.model;
    const things: Thing[] = [], waters = new Map(m.ground().waters.map((w: any) => [w.id, w])), stamp = this.h.describeStamp?.();
    if (stamp === undefined || stamp !== this.memoStamp) { this.memo.clear(); this.memoStamp = stamp; }
    const seen = new Set<string>();
    let n = 0;
    for (const e of [...m.entities.values()]) {
      if (++n % 64 === 0) yield;
      if (!e.name) continue;
      const def = m.resolvedDef(e.def); if (!def || def.components.body || /^core[-/]flag@/.test(def.ref) || this.h.engineOwned(e)) continue;
      if (keptShut(m, e)) continue;   // entry 42: kept in a shut drawer or locker: not a place to walk to, nor a name nearby
      seen.add(e.id);
      try { things.push(...this.described(e, def, waters.get(e.id), stamp)); } catch { /* one odd thing never hides the rest */ }
    }
    for (const id of this.memo.keys()) if (!seen.has(id)) this.memo.delete(id);
    const byRef = new Map<string, Thing>();
    for (const t of things) if (!byRef.has(t.ref)) byRef.set(t.ref, t);
    // Named parts reuse a real entity/room or an explicit transformed stand point. Descriptive parts stay prose.
    for (const e of m.entities.values()) for (const p of meaningParts(m,e.id)) {
      if (!p.anchor || !p.target) continue;
      const ref=`${m.pathOf(e.id)}/part-${p.id}`; if(byRef.has(ref)) continue;
      const partAliases=[...new Set([...(p.aliases??[]),...(e.about?.title?[e.about.title]:[]),...(e.about?.aliases??[]),...(e.about?.kind?[e.about.kind]:[])])].slice(0,24);
      const names=[...words(p.title),...(p.aliases??[]).flatMap(words),...words(e.about?.title??e.name??'')];
      if(p.anchor.kind==='entity') {
        const t=p.target.ref?byRef.get(p.target.ref):undefined; if(!t)continue;
        const slot=p.target.slot?m.slotsOf(m.entities.get(p.target.entity!)!).find(s=>s.id===p.target!.slot):undefined;
        byRef.set(ref,{...t,ref,id:`${e.id}#meaning-${p.id}`,name:p.title,aliases:partAliases,what:p.what??t.what,words:[...new Set([...names,...t.words])],semanticPart:{owner:e.id,part:p.id,entity:p.target.entity!,...(slot?.kind==='seat'?{seat:{entity:p.target.entity!,slot:slot.id}}:{})}});
      } else {
        const point=p.target.point!,stand=p.target.stand!,level=p.target.level!;
        // A stale authored floor number must not send a Soul to an unrelated floor at the same X/Z.
        if(this.h.levelAt(stand[0],stand[2],stand[1])!==level)continue;
        byRef.set(ref,{ref,id:`${e.id}#meaning-${p.id}`,name:p.title,aliases:partAliases,what:p.what??`A named part of ${e.about?.title??humanTitle(m.pathOf(e.id))}`,words:names,kind:'thing',at:[point[0],point[2]],stands:[[stand[0],stand[2]]],level,...(p.target.region?{poly:p.target.region}:{}),semanticPart:{owner:e.id,part:p.id,local:true}});
      }
    }
    this.cache = { key, things: [...byRef.values()], byRef };
    this.goals.clear();
    return this.cache;
  }
  /** G1 (tranche 2026-10-19): a thing's description is a function of the entity, what holds it (pose, names, slots), its
   *  def, its water and the stamp (terrain, defs, levels); the model replaces an entity object when it changes, so an
   *  unchanged thing keeps its description across rebuilds (every edit rebuilt all ~3,000 on Eden 2026: ~50 ms). */
  private memo = new Map<string, { e: Entity; chain: Entity[]; def: StoredDef; water: unknown; things: Thing[]; kids?: string }>();
  /** A building's rooms yield to a child named like a room: its named children are part of its description's inputs. */
  private kidsOf(e: Entity): string { const m = this.h.model; return [...(m.children.get(e.id) ?? [])].map((id) => m.entities.get(id)?.name ?? '').filter(Boolean).sort().join('|'); }
  private memoStamp: string | undefined;
  private described(e: Entity, def: StoredDef, water: any, stamp: string | undefined): Thing[] {
    const m = this.h.model, chain: Entity[] = [];
    for (let p = e.in.parent; p !== 'world' && chain.length < 64; ) { const x = m.entities.get(p); if (!x) break; chain.push(x); p = x.in.parent; }
    if (stamp !== undefined) {
      const hit = this.memo.get(e.id);
      if (hit && hit.e === e && hit.def === def && hit.water === water && hit.chain.length === chain.length && hit.chain.every((x, i) => x === chain[i]) && (hit.kids === undefined || hit.kids === this.kidsOf(e))) return hit.things;
    }
    const things = this.describe(e, def, water);
    if (e.about?.what) for (const t of things) if (t.kind !== 'room') t.what = e.about.what;
    if (stamp !== undefined) this.memo.set(e.id, { e, chain, def, water, things, ...(things.some((t) => t.kind === 'room') ? { kids: this.kidsOf(e) } : {}) });
    return things;
  }
  private describe(e: Entity, def: StoredDef, water: any): Thing[] {
    const m = this.h.model, baked = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), wp = m.worldPose(e), ref = m.pathOf(e.id);
    const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
    const toWorld = (x: number, z: number): Vec2 => [r3(wp.x + (x * c + z * s) * wp.s), r3(wp.z + (-x * s + z * c) * wp.s)];
    const kind0 = shortDef(def), parent = e.in.parent !== 'world' ? m.entities.get(e.in.parent) : undefined;
    const pname = parent?.name ? [parent.name] : [];
    const base = { id: e.id, name: e.about?.title ?? humanTitle(e.name!), ...(e.about ? {aliases:[...new Set([...(e.about.aliases??[]),...(e.about.kind?[e.about.kind]:[]),...def.tags,...(def.synonyms??[])])].slice(0,24)} : {}), words: [...new Set([...words(e.name!), ...words(e.about?.title ?? ''), ...words(e.about?.kind ?? ''), ...(e.about?.aliases ?? []).flatMap(words), ...words(kind0), ...def.tags.flatMap(words), ...(def.synonyms ?? []).flatMap(words), ...pname.flatMap(words)])] };
    const sh = e.shape as { area?: Vec2[]; path?: Vec2[]; width?: number } | undefined;
    if (water || (def.form !== 'point' && e.in.parent === 'world' && sh)) {
      const area = (water?.area ?? sh?.area) as Vec2[] | undefined, path = (water?.path ?? sh?.path) as Vec2[] | undefined;
      const width = Number(water?.w ?? water?.width ?? sh?.width ?? 3);
      const at = area ? centroid(area) : path ? path[Math.floor(path.length / 2)] : [wp.x, wp.z] as Vec2;
      const kind: ThingKind = water ? 'water' : area ? 'area' : 'path';
      // F1: a pier, a deck or a bridge is walked ONTO: its end platform (a pier's `end` stand), else the middle of its
      // deck — not the nearest point of its line, which is the shore end
      const deck = !water && def.components.floor ? [...baked.slots.filter((x) => x.kind === 'stand').map((x) => [r3(x.p[0]), r3(x.p[2])] as Vec2), ...(area ? [centroid(area)] : path ? [path[Math.floor(path.length / 2)], ...(path.length === 2 ? [[(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2] as Vec2] : [])] : [])] : [];
      // a raised deck (deck/1 with rails) is a floor of its own, walked onto by its stairs: its level, not the ground's
      const deckY = deck.length && def.make.kind === 'gen' && def.make.gen === 'deck/1' && deckRaised(e.params ?? {}) ? (e.params?.at as { y?: number } | undefined)?.y : undefined;
      const level = typeof deckY === 'number' && deck[0] ? this.h.levelAt(deck[0][0], deck[0][1], deckY) : 0;
      return [{ ...base, ref, kind, what: article(kind0), at: deck[0] ?? at, level, ...(area ? { area } : {}), ...(path ? { path, width } : {}), ...(deck.length ? { deck } : {}) }];
    }
    const y = wp.y, level = this.h.levelAt(wp.x, wp.z, supportY(m, e));
    // buildings: rooms (ground floor first), a door approach from outside
    const rooms = (baked.rooms ?? []).filter((r) => r.polygon?.length >= 3);
    if (rooms.length) {
      const out: Thing[] = [];
      const doors = (baked.openings ?? []).filter((o) => o.kind === 'door' && (o.level ?? 0) === 0);
      // the front door: named so, else the ground-floor door farthest from the building's centre (an outer wall); an
      // exterior door first when the openings say which are (the police station's interior "door-front-room-office"
      // matched the name and put every room's entry behind its front desk)
      const named = (o: { id: string }) => /front|main|entr/.test(o.id), outer = doors.filter((o) => o.exterior);
      const pool = outer.length ? outer : doors;
      const front = pool.find(named) ?? [...pool].sort((a, b) => Math.hypot(b.at[0], b.at[1]) - Math.hypot(a.at[0], a.at[1]))[0];
      const stands: Vec2[] = [];
      const frontSlot = baked.slots.find((x) => x.kind === 'stand' && /front|door|entr/.test(x.id));
      let inside: Vec2 | undefined, doorOpen = false;
      if (front) {
        // An off-centre door need not face away from the building's centre. Its opening yaw is the outward normal
        // in the building frame; the same transform as the walls/slots then handles any enclosing world yaw.
        const ux = Math.sin(front.yaw), uz = Math.cos(front.yaw);
        stands.push(toWorld(front.at[0] + ux * 1.2, front.at[1] + uz * 1.2));
        inside = toWorld(front.at[0] - ux * 1.0, front.at[1] - uz * 1.0);
        const st = ((e.state?.doors ?? {}) as Record<string, unknown>)[front.id];
        doorOpen = st === 'open' || (st === undefined && front.state !== 'closed' && !isShut(e, def));
      }
      if (frontSlot) stands.push(toWorld(frontSlot.p[0], frontSlot.p[2]));
      // XP5 hook: the footprint's clear lane can be off-centre, or on an open side without a radial front door.
      if (def.make.kind === 'gen' && def.make.gen === 'kit/2' && def.make.args?.footprint && frontSlot) {
        const n: Vec2 = [Math.sin(frontSlot.yaw), Math.cos(frontSlot.yaw)];
        stands.unshift(toWorld(frontSlot.p[0], frontSlot.p[2]));
        inside = toWorld(frontSlot.p[0] + n[0] * 2.2, frontSlot.p[2] + n[1] * 2.2); doorOpen = true;
      }
      const roomRefs: string[] = [];
      for (const r of rooms) {
        const rref = `${ref}/${r.id}`; if (m.get(rref)) continue; // a child named like a room keeps its name
        const slot = baked.slots.find((x) => x.id === r.id);
        const local = slot ? [slot.p[0], slot.p[2]] as Vec2 : centroid(r.polygon as Vec2[]);
        // a room slot's outline is relative to the slot; the baked room's own outline is in the building's frame
        const sp = (slot as { polygon?: Vec2[] } | undefined)?.polygon;
        const localPoly: Vec2[] = sp?.length ? sp.map(([a, b]) => [slot!.p[0] + a, slot!.p[2] + b]) : r.polygon as Vec2[];
        const poly = localPoly.map(([a, b]) => toWorld(a, b));
        const roomFrame = { poly: localPoly, at: local, origin: [wp.x, wp.z] as Vec2, yaw: wp.yaw, scale: wp.s };
        const ry = wp.y + (r.y ?? 0) * wp.s, at = toWorld(local[0], local[1]);
        const rname = r.name ?? r.id, floor = r.floor ?? 0;
        roomRefs.push(rref);
        out.push({ id: e.id, room: r.id, ref: rref, name: `${base.name} / ${humanTitle(r.id)}`, kind: 'room', what: `${rname} of ${base.name}${floor ? `, floor ${floor}` : ''}`,
          words: [...new Set([...words(r.id), ...words(rname), ...base.words, 'room', 'inside'])], at, level: this.h.levelAt(at[0], at[1], ry), rise: r3((r.y ?? 0) * wp.s), floor, poly, roomFrame, ...(stands[0] ? { entry: { p: stands[0], level } } : {}) });
      }
      // the room the front door opens into goes first (the entrance)
      if (front) { const fa = toWorld(front.at[0], front.at[1]); roomRefs.sort((a, b) => { const A = out.find((t) => t.ref === a)!, B = out.find((t) => t.ref === b)!; return (A.level - B.level) || (polyDist(A.poly!, fa) - polyDist(B.poly!, fa)); }); }
      out.unshift({ ...base, ref, kind: 'building', what: article(kind0), at: [wp.x, wp.z], level, stands, ...(inside ? { inside, doorOpen } : {}), rooms: roomRefs, words: [...base.words, 'building', 'house'] });
      return out;
    }
    // seats: approach in front of each seat; stand slots (a fountain's rim): those points
    const seats = baked.slots.filter((x) => x.kind === 'seat'), standSlots = baked.slots.filter((x) => x.kind === 'stand');
    const stands: Vec2[] = [
      ...seats.map((x) => toWorld(x.p[0] + Math.sin(x.yaw) * 0.75, x.p[2] + Math.cos(x.yaw) * 0.75)),
      ...standSlots.map((x) => toWorld(x.p[0], x.p[2])),
    ];
    // a big structure standing on its own (a mesh camp with no rooms: Mars's Freeside) is a landmark like a building
    let big = false;
    if (!parent && baked.colliders.length) { // the extent its solids cover (a camp of thin walls counts by its whole spread)
      const r = (o: { half: number[] }) => Math.hypot(o.half[0], o.half[1]);
      const xs = baked.colliders.flatMap((o) => [o.c[0] - r(o), o.c[0] + r(o)]), zs = baked.colliders.flatMap((o) => [o.c[1] - r(o), o.c[1] + r(o)]);
      big = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs)) * wp.s * wp.s >= BIG_THING_M2;
    }
    return [{ ...base, ref, kind: seats.length ? 'seat' : 'thing', what: `${article(kind0)}${parent?.name ? ` in ${m.pathOf(parent.id)}` : ''}`, at: [r3(wp.x), r3(wp.z)], level, ...(stands.length ? { stands } : {}), ...(seats.length ? { seat: true } : {}), ...(big ? { big } : {}) }];
  }

  /** Metres from a point to a thing (0 inside an area; to the line of a path; to its outline for a room). */
  distance(t: Thing, p: Vec2): number {
    if (t.area) return inPoly(p[0], p[1], t.area) ? 0 : nearestOn(t.area, p, true).d;
    if (t.path) return Math.max(0, nearestOn(t.path, p, false).d - (t.width ?? 3) / 2);
    if (t.poly) return inPoly(p[0], p[1], t.poly) ? 0 : nearestOn(t.poly, p, true).d;
    return Math.hypot(t.at[0] - p[0], t.at[1] - p[1]);
  }

  /** Where a Soul standing at `me` goes for this thing: a clear standing point on a level (null: no standing room). */
  goal(t: Thing, me: Vec2, except?: string): { p: Vec2; level: number } | null {
    this.refreshServicePoints();
    const E = this.E, tick = E.world.tick;
    // a Soul-dependent goal (the shore nearest me, the nearest point of a road) is never cached
    // MARSLIVED: a room's goal is refined live round whoever already stands there (roomGoal itself is cached per version)
    const mine = t.kind === 'water' || t.kind === 'room' || (t.kind === 'path' && !t.deck?.length) || (t.stands?.length ?? 0) > 1 || t.level > 0;
    // (L3: `except` too: the goal is a free standing point away from other bodies, so one Soul's cached goal could be the
    // very spot another Soul stands on, and which one a listing got depended on who asked first in the last 50 ticks)
    const key = `${t.ref}|${except ?? ''}|${t.kind === 'area' ? 'area' : mine ? `${Math.round(me[0])},${Math.round(me[1])}` : ''}`;
    // Area arrivals depend on exact current position, but movement must replace
    // the actor's entry rather than retain a new cache entry for every position.
    const positionKey = t.kind === 'area' ? `${me[0]},${me[1]}` : key;
    const hit = this.goals.get(key); if (hit && hit.key === positionKey && tick - hit.tick < 50) return hit.goal;
    const near = (at: Vec2, level: number, ring = 24) => { const p = E.standableNearV1!(at, level, except, 0.4, ring); return p ? { p: [r2(p[0]), r2(p[1])] as Vec2, level } : null; };
    // WALK3: a ground goal off the main walkable ground (a fenced court, a dense wood, a mountain band, a hill) moves to the
    // nearest open spot of the main ground within r of it, else of `alt`; only once the engine's labels are ready (a
    // listing never waits for them)
    const toMain = (g: { p: Vec2; level: number } | null, r: number, ...alts: Vec2[]) => {
      if (!g || g.level || !E.navCheckV1 || !E.navNearestMainV1 || !E.navWarmV1?.(0) || E.navCheckV1([{ id: t.ref, p: g.p, level: 0 }])[0]?.ok) return g;
      // an area's spot must stay inside it: main ground outside a walled yard is not the yard (route truth)
      const ok = (v: Vec2 | null) => (v && (!t.area || inPoly(v[0], v[1], t.area)) ? v : null);
      let q = ok(E.navNearestMainV1(g.p, except, r));
      for (const a of alts) q ??= ok(E.navNearestMainV1(a, except, r));
      return q ? { p: [r2(q[0]), r2(q[1])] as Vec2, level: 0 } : g;
    };
    let goal: { p: Vec2; level: number } | null = null;
    if (t.semanticPart?.local) {
      const stand=t.stands?.[0];
      if(stand) {
        const candidate=near(stand,t.level,1);
        if(candidate && Math.hypot(candidate.p[0]-stand[0],candidate.p[1]-stand[1])<=0.75 && (!t.poly||inPoly(candidate.p[0],candidate.p[1],t.poly))) goal=candidate;
      }
    } else if (t.kind === 'water') {
      // the nearest shore to me, a little outside the water's edge
      const edge = t.area ? nearestOn(t.area, me, true) : nearestOn(t.path!, me, false);
      const away: Vec2 = t.area ? (() => { const c = centroid(t.area!), dx = edge.q[0] - c[0], dz = edge.q[1] - c[1], n = Math.hypot(dx, dz) || 1; return [dx / n, dz / n] as Vec2; })()
        : (() => { const n: Vec2 = [-edge.dir[1], edge.dir[0]], side = Math.sign((me[0] - edge.q[0]) * n[0] + (me[1] - edge.q[1]) * n[1]) || 1; return [n[0] * side, n[1] * side] as Vec2; })();
      const off = t.area ? 1.5 : (t.width ?? 3) / 2 + 1.5;
      goal = near([edge.q[0] + away[0] * off, edge.q[1] + away[1] * off], 0, 16);
    } else if (t.deck?.length) {
      for (const d of t.deck) { goal = near(d, t.level, 6); if (goal) break; }
    } else if (t.kind === 'path') {
      goal = toMain(near(nearestOn(t.path!, me, false).q, 0, 16), 40);
    } else if (t.kind === 'area') {
      // WALK3: standing room near me when I am inside it; a pond, a tree or a wheel at that spot widens the search, and an
      // area whose middle has none (a lake with its shore, a dense forest) is reached at its edge
      const exclusions = this.h.outdoorRegionExclusions?.(t.ref);
      const valid = (g: {p: Vec2; level: number} | null) => !!g && (exclusions === undefined || g.level === 0 && inPoly(g.p[0], g.p[1], t.area!) && exclusions.every(poly => polyDist(poly, g.p) >= HUMAN_RADIUS + .07));
      const outdoorNear = (p: Vec2, ring: number) => {const g = near(p, 0, ring);return valid(g) ? g : null;};
      // `raw` is the WALK3 goal from the same standing searches without the outdoor-region rule (an area with no
      // standing room inside, a dense forest or a lake, is reached at its edge or on the main ground beside it).
      // Without exclusions it is the goal itself; with them it is the last resort below, never inside an interior.
      const edge = nearestOn(t.area!, me, true).q, inside = inPoly(me[0], me[1], t.area!);
      let raw = inside ? near(me, 0, 8) : near(t.at, 0, 40);
      goal = valid(raw) ? raw : null;
      if (inside && !goal) { const g = near(me, 0, 40); raw ??= g; goal = valid(g) ? g : null; }
      if (!goal) { const g = near(edge, 0, 16); raw ??= g; goal = valid(g) ? g : null; }
      // its edge spot can be a pocket (a slope wood) while open main ground lies nearer its middle: try both
      goal = toMain(goal, 80, edge, t.at);
      if (!valid(goal)) goal = null;
      if (!goal && exclusions !== undefined) {
        // A clear room floor is not the outdoor area around it. Search a bounded
        // set of area points, checking the actual displaced standing result and
        // any main-ground adjustment. Never fall back to an excluded interior.
        const seeds: Vec2[] = [t.at];
        for (const radius of [1, 2, 4, 8, 16]) for (let i = 0; i < 8; i++) seeds.push([me[0] + Math.cos(i * Math.PI / 4) * radius, me[1] + Math.sin(i * Math.PI / 4) * radius]);
        const xs = t.area!.map(p => p[0]), zs = t.area!.map(p => p[1]);
        for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) seeds.push([Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * (x + .5) / 5, Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * (z + .5) / 5]);
        let tried = 0;
        for (const p of seeds) {
          if (!inPoly(p[0], p[1], t.area!) || !exclusions.every(poly => polyDist(poly, p) >= HUMAN_RADIUS + .07)) continue;
          if (++tried > 32) break;
          const g = toMain(outdoorNear(p, 3), 80, edge, t.at);
          if (valid(g)) {goal = g;break;}
        }
        // No clear standing room inside the area at all: keep its WALK3 edge goal when that lands in no interior, so
        // the rule never turns a reachable forest or lake into a place with no walk (walk gate, release 404)
        const legacy = goal ? null : toMain(raw, 80, edge, t.at);
        if (legacy && legacy.level === 0 && exclusions.every(poly => polyDist(poly, legacy.p) >= HUMAN_RADIUS + .07)) goal = legacy;
      }
    } else if (t.kind === 'room') {
      // the room's reachable standing point, moved aside when another body already stands on it (two Souls told to go
      // into the tea room do not queue for one spot)
      // ... and still reached from the front door: the spot beside it can be in a pocket furniture closes off (V6-party S6,
      // the furnished moss-cottage living room: refused route.unreachable), so it is reach-checked as roomGoal's own goal is
      const base = this.roomGoal(t, near), free = base ? near(base.p, base.level, 6) : null;
      const moved = !!free && !!base && (free.p[0] !== base.p[0] || free.p[1] !== base.p[1]);
      goal = free && (!t.poly || inPoly(free.p[0], free.p[1], t.poly)) && (!moved || this.entryReaches(t, free.p)) ? free : base;
    } else if (t.kind === 'building' && t.inside && t.doorOpen) {
      // in at the front door: standing room just inside it (the room it opens into); else its approach outside
      goal = near(t.inside, 0, 4);
      for (const s of t.stands ?? []) { if (goal) break; goal = near(s, t.level, 6); }
    } else {
      // a door approach, a seat's front, a fountain's rim: the nearest to me with standing room; else around the thing
      const stands = [...(t.stands ?? [])].sort((a, b) => Math.hypot(a[0] - me[0], a[1] - me[1]) - Math.hypot(b[0] - me[0], b[1] - me[1]));
      for (const s of stands) { goal = near(s, t.level, 6); if (goal) break; }
      goal ??= near(t.at, t.level, 40);
      // a thing with no approach of its own: the main ground nearest it when the spot beside it is a pocket (a lamp behind
      // a fence, a shelf with a gap behind it), and a big structure from the main ground near it
      if (!t.stands?.length) goal = toMain(goal, t.big ? 80 : 3);
      // RESOLVE2: a thing up on a roof whose own patch is cut off (eden-house-3: its planters stand on a strip a ridge
      // parts from the terrace its roof stair lands on): the nearest connected standing room on that roof within 4 m
      if (goal && goal.level > 0 && E.navCheckV1 && E.navWarmV1?.(0) && !E.navCheckV1([{ id: t.ref, ...goal }])[0]?.ok) goal = this.roofReach(goal) ?? goal;
      // #875: a seat whose stand point is in a pocket furniture closes off (a dining chair pushed in between the table and
      // the wall) while the room's main floor is beside it: another stand point of it that is connected, else the nearest
      // connected standing spot within 2.5 m (inside THING_REACH_M); with none the goal stays, refused honestly
      if (goal && t.seat && E.navCheckV1 && E.navWarmV1?.(0) && !E.navCheckV1([{ id: t.ref, ...goal }])[0]?.ok) {
        let other: { p: Vec2; level: number } | null = null;
        for (const s of stands) { const g = near(s, t.level, 6); if (g && E.navCheckV1([{ id: t.ref, ...g }])[0]?.ok) { other = g; break; } }
        // the spot stays in the seat's own room: the floor through the wall (the next room, the garden) is no way to it
        const room = this.things().find((r) => r.kind === 'room' && r.level === t.level && r.poly && inPoly(t.at[0], t.at[1], r.poly));
        goal = other ?? this.roofReach(goal, 2.5, room?.poly) ?? goal;
      }
      // WALK3: a duck on the lake, a boat in the harbour: the shore of the water it floats on, nearest to it
      if (!goal && !t.level) for (const w of this.things()) {
        if (w.kind !== 'water' || !w.area || !inPoly(t.at[0], t.at[1], w.area)) continue;
        const edge = nearestOn(w.area, t.at, true), c = centroid(w.area), dx = edge.q[0] - c[0], dz = edge.q[1] - c[1], n = Math.hypot(dx, dz) || 1;
        goal = near([edge.q[0] + (dx / n) * 1.5, edge.q[1] + (dz / n) * 1.5], 0, 16); if (goal) break;
      }
    }
    // D2 (playtest 2026-10-25: 4 of 4 "walk to the pavilion" ended at its closed front door, outside its floor): a building
    // with a single room is walked into that room, as walk:<building>/<room> is.
    // A blocked interior must not retain the earlier exterior approach while the offer promises entry.
    // Retained mesh buildings can have an entrance stand without a ground-level door opening (Mars kitchen).
    // Use the lowest room within the low-rise limit, nearest that entrance, on its actual engine floor.
    // An explicit closed door keeps its existing exterior-approach behavior for multi-room buildings.
    const entrance = t.kind === 'building' && !t.inside ? t.stands?.[0] : undefined;
    if (t.kind === 'building' && !t.doorOpen && (t.rooms?.length === 1 || !!entrance)) {
      const rooms = this.things().filter((x) => x.kind === 'room' && t.rooms?.includes(x.ref));
      const room = t.rooms?.length === 1 ? rooms[0] : rooms.filter((x) => x.rise !== undefined && x.rise >= 0 && x.rise < LOW_RISE_M && x.poly?.length)
        .sort((a, b) => (a.rise! - b.rise!) || polyDist(a.poly!, entrance!) - polyDist(b.poly!, entrance!) || a.ref.localeCompare(b.ref))[0];
      const inner = room ? this.goal(room, me, except) : null;
      goal = inner;
      if (!inner) this.blocked.set(t.ref, `The interior of ${t.ref} is not reachable right now; its entrance or the route inside is blocked.`);
      else this.blocked.delete(t.ref);
    }
    if (this.goals.size > 50_000) this.goals.clear();   // per Soul and per position: bounded
    // Only generic room/building visits avoid work positions. A walk to a
    // named instrument/stand, or the activity's own approach, keeps its target.
    if (goal && (t.kind === 'room' || t.kind === 'building')) {
      const room = t.kind === 'room' ? t : this.things().find(r => r.kind === 'room' && t.rooms?.includes(r.ref) && r.level === goal!.level && r.poly && inPoly(goal!.p[0], goal!.p[1], r.poly));
      if (room) goal = this.visitorGoal(room, goal, near);
    }
    this.goals.set(key, { tick, key: positionKey, goal });
    return goal;
  }

  /** RESOLVE2: the nearest connected (walkable both ways from the main ground) standing spot on `g`'s level within `r` m
   *  (and inside `within`, a room's polygon, when given). */
  private roofReach(g: { p: Vec2; level: number }, r = 4, within?: Vec2[]): { p: Vec2; level: number } | null {
    const E = this.E, pts: { id: string; p: Vec2; level: number }[] = [];
    for (let dz = -r; dz <= r; dz += 0.5) for (let dx = -r; dx <= r; dx += 0.5) if (Math.hypot(dx, dz) <= r && (!within || inPoly(g.p[0] + dx, g.p[1] + dz, within))) pts.push({ id: `${dx},${dz}`, p: [r2(g.p[0] + dx), r2(g.p[1] + dz)], level: g.level });
    let best: Vec2 | null = null, bd = Infinity;
    for (const v of E.navCheckV1!(pts) as { id: string; ok: boolean }[]) {
      if (!v.ok) continue; const [dx, dz] = v.id.split(',').map(Number), d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = [r2(g.p[0] + dx), r2(g.p[1] + dz)]; }
    }
    return best ? { p: best, level: g.level } : null;
  }

  /** Prefer an equally reachable visitor point outside an activity's work
   * position. Retain the original goal if this bounded search has no alternative. */
  private visitorGoal(room: Thing, original: {p: Vec2; level: number}, near: (at: Vec2, level: number, ring?: number) => {p: Vec2; level: number} | null) {
    if (!room.poly) return original;
    const services = this.servicePoints.filter(s => s.level === original.level && inPoly(s.at[0], s.at[1], room.poly!));
    const free = (p: Vec2) => services.every(s => Math.hypot(p[0] - s.at[0], p[1] - s.at[1]) >= SERVICE_STAND_DISTANCE);
    if (!services.length || free(original.p)) return original;
    const frame = room.roomFrame;
    const candidates = frame ? roomSamples(frame.poly, frame.at, 0.6 / frame.scale).map(([x, z]): Vec2 => {
      const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
      return [r3(frame.origin[0] + (x * c + z * s) * frame.scale), r3(frame.origin[1] + (-x * s + z * c) * frame.scale)];
    }) : roomSamples(room.poly, room.at);
    // Test actual standing points, not just sample seeds: native occupancy can
    // displace a seed back onto a station or outside this room.
    const tried = new Set<string>();
    for (const seed of candidates.slice(0, 32)) {
      const q = near(seed, original.level, 3);
      if (!q || !inPoly(q.p[0], q.p[1], room.poly) || !free(q.p)) continue;
      const key = `${q.p[0]},${q.p[1]}`; if (tried.has(key)) continue;
      if (tried.size >= 14) break; tried.add(key);
      if (!room.entry || this.entryReaches(room, q.p)) return q;
    }
    return original;
  }

  /** F1: a room's goal is standing room inside it that the front door reaches (furniture can close off its middle):
   *  its centre if reachable, else the reachable spot inside nearest the centre; null (and `blocked`) when furniture
   *  closes the whole room off. Cached per navigation epoch and room (furniture moves the epoch). */
  private roomGoal(t: Thing, near: (at: Vec2, level: number, ring?: number) => { p: Vec2; level: number } | null): { p: Vec2; level: number } | null {
    const E = this.E;
    const centre = near(t.at, t.level, 40);
    if (!t.entry || !E.feasibility.reaches) return centre;
    // S2: kept per navigation epoch (the static world the reach checks route over) and the room's own outline, door and
    // frame, not per god edit: a calendar entry or opening hours (half a busy god's edits) re-reached every room in 80 m
    this.index(); const ep = this.navEpoch(), rv = ep === undefined ? `${this.h.staticVersion?.() ?? this.cache?.key}` : `ep${ep}`;
    const key = `${rv}|${t.ref}|${JSON.stringify([t.at, t.level, t.entry, t.poly, t.roomFrame])}`, hit = this.rooms.get(key); if (hit !== undefined) return hit;
    const reach = (p: Vec2) => this.entryReaches(t, p);
    let goal: { p: Vec2; level: number } | null = null;
    if (centre && inPoly(centre.p[0], centre.p[1], t.poly ?? []) && reach(centre.p)) goal = centre;
    else if (t.poly?.length) {
      // The same bounded search at every yaw: a world-axis lattice changed which furnished pockets were tried
      // when the building turned. Sample and order in its own frame, then transform exactly as its room/slots.
      const frame = t.roomFrame;
      const cand = frame ? roomSamples(frame.poly, frame.at, 0.6 / frame.scale).map(([x, z]): Vec2 => {
        const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
        return [r3(frame.origin[0] + (x * c + z * s) * frame.scale), r3(frame.origin[1] + (-x * s + z * c) * frame.scale)];
      }) : roomSamples(t.poly, t.at);
      const tried = new Set<string>();
      for (const c of cand) {
        if (tried.size >= 14) break;
        const q = near(c, t.level, 3); if (!q || !inPoly(q.p[0], q.p[1], t.poly)) continue;
        const k = `${q.p[0]},${q.p[1]}`; if (tried.has(k)) continue; tried.add(k);
        if (reach(q.p)) { goal = q; break; }
      }
    }
    // one entry per room per world version: drop an older version's entries, never clear mid-sweep (the Eden 2026 cafe
    // offers 268 rooms within 80 m; the old 200-entry cap cleared during every sweep, so each sweep past the 50-tick goal
    // cache re-routed every room: the cafe's ~10 s stalls)
    if (this.roomsOf !== rv) { this.rooms.clear(); this.roomsOf = rv; }
    this.rooms.set(key, goal); if (this.rooms.size > 20_000) this.rooms.clear();
    if (!goal) this.blocked.set(t.ref, `Nothing inside ${t.ref} can be reached from its front door right now: furniture closes the way in.`); else this.blocked.delete(t.ref);
    return goal;
  }
  /** Does the room's front door reach p (on the room's level)? True when there is no door or no reach check to ask. */
  private entryReaches(t: Thing, p: Vec2): boolean {
    const E = this.E;
    return !t.entry || !E.feasibility.reaches || E.feasibility.reach({ p: t.entry.p, level: t.entry.level }, { p, level: t.level })!.ok;
  }
  private rooms = new Map<string, { p: Vec2; level: number } | null>();
  private roomsOf: string | undefined;
  /** Why a thing has no goal (shown as the capability's blocked reason). */
  readonly blocked = new Map<string, string>();

  // ------------------------------------------------------------------ capabilities

  /** `walk:<path>` for the nearest named things and the rooms of near buildings (plus any this Soul asked for). */
  private selectedWalks(soul: EdgeSoul) {
    const me = this.E.world.entities[soul.entityId]; if (!me?.human) return null;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]], myLevel = me.human.level ?? 0;
    const seated = me.human.activity === 'sit' || me.human.baseActivity === 'sit';
    const all = this.things();
    // on a raised floor: the ground-level front of the building whose room I stand in (walked to first for far ground goals)
    const exit = myLevel === 0 ? null : all.find((t) => t.kind === 'room' && t.level === myLevel && t.poly && inPoly(here[0], here[1], t.poly) && t.entry && t.entry.level === 0)?.entry ?? null;
    const ranked = all.filter((t) => t.kind !== 'room' || !!t.semanticPart).map((t) => ({ t, d: this.distance(t, here) })).sort((a, b) => a.d - b.d || (a.t.ref < b.t.ref ? -1 : 1));
    const pick: { t: Thing; d: number }[] = ranked.slice(0, SHOW);
    // SOULFIX2: a furnished town has more named things near than SHOW (each chair is one): buildings within
    // BUILDINGS_WITHIN stay offered however many pieces of furniture are nearer, so a Soul can always head for one
    // (and big stand-alone structures, so a Soul in a furnished room can still head for Freeside across the camp)
    // ... and the world's open-area places (courts, gardens) within PLACES_WITHIN (Little Martians: from Madmaraca's court 236 painted
    // courts and 96 exhibits are nearer than the Minarete court, so `walk:minarete-court` was refused while jog-around was offered)
    // (at most PLACES_MAX of them, nearest first: Eden 2026 has dozens of gardens and courts within 400 m, and each offered walk
    // costs a reach check: uncapped, a capabilities sweep built 160 fine tiles and a warm /here in the café took 21 s)
    let places = 0;
    for (const x of ranked.slice(SHOW)) {
      if (x.t.semanticPart && x.d <= ROOMS_WITHIN) pick.push(x);
      else if ((x.t.kind === 'building' || x.t.big) && x.d <= BUILDINGS_WITHIN) pick.push(x);
      else if (places < PLACES_MAX && x.d <= PLACES_WITHIN && !!x.t.area && polyArea(x.t.area) >= PLACE_M2 && !!this.h.placeOf?.(x.t.ref)) { pick.push(x); places++; }
    }
    // E-life: an upper storey's rooms are offered from close by (or from inside the building) only: each needs a multi-floor
    // reach check from the front door, and near Eden 2026's 3-4 storey canal row ~100 of them made one capabilities call
    // take 44 s (1600 floor windows built). Ground-floor rooms stay offered within ROOMS_WITHIN; walk to the building first.
    for (const { t, d } of ranked) if (t.kind === 'building' && d <= ROOMS_WITHIN) {
      const rooms = (t.rooms ?? []).map((r) => this.thing(r)).filter((r): r is Thing => !!r);
      const inside = d <= UPPER_ROOMS_WITHIN || myLevel !== 0 || rooms.some((r) => r.level === 0 && !!r.poly && inPoly(here[0], here[1], r.poly));
      for (const rt of rooms) if (rt.level === 0 || (rt.rise ?? 0) < LOW_RISE_M || inside) pick.push({ t: rt, d: this.distance(rt, here) });
    }
    return {pick, here, myLevel, seated, exit};
  }

  /** Continuity (warm after listen): the walk goals this Soul's listing would ask for (room reaches, standing points and
   *  the fine route tiles under them), one thing per step, so a sliced caller builds them between other requests instead
   *  of inside one listing. A read: only caches fill (goals here are recomputed by the listing as usual). */
  *servingWarmGen(soul: EdgeSoul): Generator<void, void, void> {
    const selected = this.selectedWalks(soul); if (!selected) return;
    for (const { t } of selected.pick) { yield; this.goal(t, selected.here, soul.entityId); }
  }

  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Plans, focus?: MenuFocus | null) {
    const selected=this.selectedWalks(soul);if(!selected)return;
    // srv-act-words (D): a focused words walk keeps only the walks its words can choose (focus.walkKeep, the ledger's test)
    const at={...selected,keep:focus?.walkKeep?.keep};
    for(const {t,d} of selected.pick)if(this.wantsThing(focus,t))this.offerWalk(soul,t,d,at,caps,plans);
  }
  /** L3 item 4: whether a focused build (EdgeLedger.bindOne) needs this thing's offers (walk, sit, hang out, stroll). */
  private wantsThing(f: MenuFocus | null | undefined, t: Thing): boolean {
    if (!f) return true;
    if (['walk:', 'sit:', 'hang-out:', 'stroll:'].some((v) => f.ids.has(v + t.ref))) return true;
    if (f.verbs.has('walk') || f.verbs.has('hang-out') || f.verbs.has('stroll') || (f.verbs.has('sit') && !!t.semanticPart?.seat)) return true;
    if (!f.targets.size) return false;
    if (f.targets.has(t.id) || (!!t.semanticPart?.entity && f.targets.has(t.semanticPart.entity))) return true;
    const place = this.h.placeOf?.(t.ref); return !!place && f.targets.has(place);
  }
  /** Exact authored place refs only. Unlisted/on-demand refs retain the full
   * resolver, whose far-room door leg differs from the ordinary listing. */
  exactPlaceWalkRef(ref:string):boolean {
    const t=this.thing(ref);return !!t&&!t.semanticPart&&!!this.h.placeOf?.(ref);
  }
  exactListedWalk(soul:EdgeSoul,ref:string,caps:EdgeCapability[],plans:Plans):boolean {
    if(!this.exactPlaceWalkRef(ref))return false;
    const selected=this.selectedWalks(soul),entry=selected?.pick.find(({t})=>t.ref===ref);
    if(!selected||!entry)return false;
    this.offerWalk(soul,entry.t,entry.d,selected,caps,plans,true);
    return caps.some(c=>c.id==='walk:'+ref);
  }

  /** A walk to one named place the listing leaves out for distance (the far big top, asked for by name): the same
   *  capability the listing would give it from here. Ground-floor things and rooms only (an upper floor's rooms need a
   *  multi-floor reach check; walk to the building first). True when a capability was added. */
  walkOnDemand(soul: EdgeSoul, placeId: string, caps: EdgeCapability[], plans: Plans): boolean {
    const me = this.E.world.entities[soul.entityId]; if (!me?.human || !this.h.placeOf) return false;
    const t = this.placeWalkThing(placeId); if (!t) return false;
    return this.offerOnDemand(soul, t, caps, plans);
  }

  /** The existing place-ID representative, shared by ordinary on-demand resolution
   * and the narrowly projected canonical area walk. Never pick a different ref. */
  private placeWalkThing(placeId: string): Thing | undefined {
    if (!this.h.placeOf) return undefined;
    // RESOLVE2: an upstairs room is walked to as well (in at the front door, up its stair): ground-floor rooms first
    const low = (t: Thing) => t.kind !== 'room' || t.level === 0 || (t.rise ?? 0) < LOW_RISE_M;
    const all = this.things(), mine = all.filter((t) => this.h.placeOf!(t.ref) === placeId).sort((a, b) => +low(b) - +low(a));
    // F6: a room's own place is that room (not a piece of furniture standing in it)
    const room = mine.some((x) => x.kind === 'building') ? undefined : mine.find((x) => x.kind === 'room');
    return room ?? mine.find((x) => x.kind !== 'room') ?? mine[0];
  }

  /** Only a canonical authored area whose place-ID resolution picks this exact
   * Thing may bypass listing truncation. Rooms, shores and other place kinds
   * retain their complete legacy resolution and on-demand admission. */
  exactAreaWalkRef(ref: string, placeId: string): boolean {
    const t = this.thing(ref);
    return !!t && t.kind === 'area' && !t.semanticPart && !!t.area && t.area.length >= 3
      && this.h.placeOf?.(ref) === placeId && this.placeWalkThing(placeId) === t;
  }

  exactAreaWalkOnDemand(soul: EdgeSoul, ref: string, placeId: string, caps: EdgeCapability[], plans: Plans): boolean {
    if (!this.E.world.entities[soul.entityId]?.human || !this.exactAreaWalkRef(ref, placeId)) return false;
    const t = this.placeWalkThing(placeId)!;
    this.offerOnDemand(soul, t, caps, plans, true);
    return caps.some(c => c.id === `walk:${ref}`);
  }

  /** RESOLVE2: a re-sent walk id of a named thing or room (`walk:seafront-hotel-4/seafront-hotel-4-roof-bench`, offered by
   *  thingOnDemand for one resolution) offered again by its ref: it was refused capability.unknown. */
  walkRefOnDemand(soul: EdgeSoul, ref: string, caps: EdgeCapability[], plans: Plans): boolean {
    const me = this.E.world.entities[soul.entityId]; if (!me?.human) return false;
    const t = this.things().find((x) => x.ref === ref); if (!t) return false;
    return this.offerOnDemand(soul, t, caps, plans);
  }

  private offerOnDemand(soul: EdgeSoul, t: Thing, caps: EdgeCapability[], plans: Plans, onlyWalk = false): boolean {
    const me = this.E.world.entities[soul.entityId]!, all = this.things();
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]], myLevel = me.human!.level ?? 0;
    const exit = myLevel === 0 ? null : all.find((r) => r.kind === 'room' && r.level === myLevel && r.poly && inPoly(here[0], here[1], r.poly) && r.entry && r.entry.level === 0)?.entry ?? null;
    const seated = me.human!.activity === 'sit' || me.human!.baseActivity === 'sit', n = caps.length;
    this.offerWalk(soul, t, this.distance(t, here), { here, myLevel, seated, exit }, caps, plans, onlyWalk);
    // F6 (SOULSIM-H): a room of a far building is walked to in at its front door, in one walk: to the door's approach
    // outside, then onto the room's floor (it was refused, so the Soul walked to the building first, then in: ~10 s more)
    const id = `walk:${t.ref}`, plan = plans.get(id), door = t.kind === 'room' ? t.entry : undefined;
    if (plan && door && door.level === 0 && myLevel === 0 && Math.hypot(door.p[0] - here[0], door.p[1] - here[1]) > 3) {
      const stand = plan.steps.filter((s) => s.verb === 'stand'), rest = plan.steps.filter((s) => s.verb !== 'stand');
      plans.set(id, { ...plan, steps: [...stand, { verb: 'walk_to', params: { to: door.p, standoff: 0 } }, ...rest] });
    }
    return caps.length > n;
  }

  /** RESOLVE (2026-10-21, SOULSIM-E "go to the horse" ended at the west lawn's centre ~10 m from the horse): the words name
   *  a thing (an animal, a boat, a bench) by its own name or kind, not a place: a walk to standing room next to the nearest
   *  such thing, added for this resolution. Rooms are left to their buildings. Null when no such thing has standing room
   *  within reach of it. */
  thingOnDemand(soul: EdgeSoul, ask: string[], caps: EdgeCapability[], plans: Plans, hit: (w: string, set: string[]) => boolean): { id: string; count: number } | null {
    const me = this.E.world.entities[soul.entityId]; if (!me?.human || !ask.length) return null;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]], myLevel = me.human.level ?? 0;
    // its own name and kind, the last word of the asked words naming the head of either ("go to the school" is not a school-desk)
    const own = (t: Thing) => [...words(t.name.split('/').pop()!), ...words(t.what.replace(/\s+in\s+\S+$/, ''))];
    const heads = (t: Thing) => [words(t.name.split('/').pop()!).filter((w) => !/^\d+$/.test(w)).at(-1) ?? '', words(t.what.replace(/\s+in\s+\S+$/, '')).at(-1) ?? ''];
    const all = this.things(), named = all.filter((t) => t.kind !== 'room' && ask.every((w) => hit(w, own(t))) && hit(ask.at(-1)!, heads(t)))
      .map((t) => ({ t, d: this.distance(t, here) })).sort((a, b) => a.d - b.d || (a.t.ref < b.t.ref ? -1 : 1));
    const exit = myLevel === 0 ? null : all.find((r) => r.kind === 'room' && r.level === myLevel && r.poly && inPoly(here[0], here[1], r.poly) && r.entry && r.entry.level === 0)?.entry ?? null;
    const seated = me.human.activity === 'sit' || me.human.baseActivity === 'sit';
    for (const { t, d } of named.slice(0, 6)) {
      const goal = this.goal(t, here, soul.entityId);
      if (!goal || (['thing', 'seat'].includes(t.kind) && Math.hypot(goal.p[0] - t.at[0], goal.p[1] - t.at[1]) > THING_REACH_M)) continue;
      const id = `walk:${t.ref}`;
      if (!caps.some((c) => c.id === id)) this.offerWalk(soul, t, d, { here, myLevel, seated, exit }, caps, plans);
      if (caps.find((c) => c.id === id)?.available) return { id, count: named.length };
    }
    return null;
  }
  /** A named thing by its entity id (not a room): where the decor and creatures that are not engine bodies stand. */
  thingById(id: string): Thing | undefined {
    const key = this.cache?.key; if (!this.byIdMemo || this.byIdMemo.key !== key) { this.things(); this.byIdMemo = { key: this.cache?.key, m: new Map(this.things().filter((t) => t.kind !== 'room').map((t) => [t.id, t])) }; }
    return this.byIdMemo.m.get(id);
  }
  private byIdMemo: { key: string | undefined; m: Map<string, Thing> } | null = null;
  /** Words of every named thing (its own name and kind), for reading a misspelt name (RESOLVE typo fallback). */
  thingWords(): string[] {
    const key = this.cache?.key; if (this.wordsMemo && this.wordsMemo.key === key) return this.wordsMemo.words;
    const out = new Set<string>(); for (const t of this.things()) for (const w of [...words(t.name.split('/').pop()!), ...words(t.what)]) out.add(w);
    this.wordsMemo = { key: this.cache?.key, words: [...out] }; return this.wordsMemo.words;
  }
  private wordsMemo: { key: string | undefined; words: string[] } | null = null;

  /** RESOLVE (SOULSIM-E "go inside the cottage and go upstairs" was capability.unknown): a floor of a building, as its main
   *  room (the largest that is not a landing, stair or bathroom). The building: `prefer` (the place the building words walk
   *  to), else the nearest whose name or kind is `ask`, else the one the Soul stands in or at the door of. With building
   *  words, a building without that floor gives way to the nearest so named that has it (said in the note). From the
   *  ground it walks to the front door first, then up. */
  floorOnDemand(soul: EdgeSoul, q: { ask: string[]; prefer?: string; floor: 'up' | 'down' | 'top' | number }, caps: EdgeCapability[], plans: Plans, hit: (w: string, set: string[]) => boolean): { id: string; note: string } | { code: string; reason: string } {
    const me = this.E.world.entities[soul.entityId]; if (!me?.human) return { code: 'floor.no-body', reason: 'This Soul has no body to walk with.' };
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]], myLevel = me.human.level ?? 0, all = this.things();
    const roomsOf = (b: Thing) => (b.rooms ?? []).map((r) => this.thing(r)).filter((r): r is Thing => !!r && !!r.poly);
    const inRoom = all.find((r) => r.kind === 'room' && r.level === myLevel && !!r.poly && inPoly(here[0], here[1], r.poly));
    const buildingOf = (t: Thing | undefined) => t?.kind === 'building' ? t : t?.kind === 'room' ? this.thing(t.ref.slice(0, t.ref.lastIndexOf('/'))) : undefined;
    const curFloor = (b: Thing) => (inRoom && b.rooms?.includes(inRoom.ref) ? inRoom.floor ?? 0 : 0);
    const want = (b: Thing): number | null => {
      const floors = [...new Set(roomsOf(b).map((r) => r.floor ?? 0))].sort((x, y) => x - y), cur = curFloor(b);
      const f = q.floor === 'up' ? floors.find((x) => x > cur) : q.floor === 'down' ? [...floors].reverse().find((x) => x < cur) : q.floor === 'top' ? floors.at(-1) : q.floor;
      return f !== undefined && floors.includes(f) && (q.floor === 'top' ? f > 0 || cur > 0 : true) ? f : null;
    };
    const own = (t: Thing) => [...words(t.ref), ...words(t.name), ...t.words];
    const near = (cands: Thing[]) => cands.map((t) => ({ t, d: this.distance(t, here) })).sort((a, b) => a.d - b.d || (a.t.ref < b.t.ref ? -1 : 1));
    const preferred = q.prefer ? buildingOf(all.find((t) => this.h.placeOf?.(t.ref) === q.prefer)) : undefined;
    const atDoor = all.find((b) => b.kind === 'building' && (b.stands ?? []).some((s) => Math.hypot(s[0] - here[0], s[1] - here[1]) <= 4));
    const first = preferred ?? (q.ask.length ? near(all.filter((t) => t.kind === 'building' && q.ask.every((w) => hit(w, own(t)))))[0]?.t : buildingOf(inRoom) ?? atDoor);
    const which = q.floor === 'up' ? 'an upper floor' : q.floor === 'down' ? 'a floor below' : q.floor === 'top' ? 'an upper floor' : q.floor === 0 ? 'a ground floor' : `a floor ${q.floor}`;
    const withFloor = (b: Thing) => b.kind === 'building' && want(b) !== null;
    if (!first) {
      const n = near(all.filter(withFloor))[0];
      return { code: 'floor.no-building', reason: `${q.ask.length ? `No building called "${q.ask.join(' ')}" is here` : 'You are not in a building, so there is no upstairs here'}; nothing else was chosen in its place.${n ? ` The nearest building with ${which} is ${n.t.ref} (${n.t.what}, ${Math.round(n.d)} m): say "go upstairs in ${n.t.ref}".` : ''}` };
    }
    // the building, else (building words given) the nearest so named that has that floor and whose floor can be reached
    const tries = withFloor(first) ? [first] : [];
    if (q.ask.length) for (const { t } of near(all.filter((t) => t !== first && withFloor(t) && q.ask.every((w) => hit(w, own(t))))).slice(0, 4)) tries.push(t);
    const nearestWith = () => { const n = near(all.filter(withFloor))[0]; return n ? ` The nearest building with ${which} is ${n.t.ref} (${n.t.what}, ${Math.round(n.d)} m): say "go upstairs in ${n.t.ref}".` : ''; };
    if (!tries.length) return { code: 'floor.none', reason: `${first.ref} (${first.what}) has no ${q.floor === 'down' ? 'floor below this one' : q.floor === 0 ? 'ground floor room' : 'upper floor'} to go to; nothing else was chosen in its place.${q.ask.length ? '' : nearestWith()}` };
    const seated = me.human.activity === 'sit' || me.human.baseActivity === 'sit';
    const exit = myLevel === 0 ? null : inRoom?.entry && inRoom.entry.level === 0 ? inRoom.entry : null;
    const main = (r: Thing) => polyArea(r.poly!) * (/landing|stair|corridor|bath|wc|toilet|closet|cupboard|hallway/.test(r.room ?? '') ? 0.3 : 1);
    const skipped: string[] = []; let why: string | undefined;
    for (const b of tries) {
      const f = want(b)!, rooms = roomsOf(b).filter((r) => (r.floor ?? 0) === f).sort((x, y) => main(y) - main(x) || (x.ref < y.ref ? -1 : 1));
      for (const r of rooms) {
        const id = `walk:${r.ref}`;
        if (!caps.some((c) => c.id === id)) this.offerWalk(soul, r, this.distance(r, here), { here, myLevel, seated, exit }, caps, plans);
        const cap = caps.find((c) => c.id === id); if (!cap?.available) { why ??= cap?.blocked?.reason; continue; }
        // from the ground outside: to the front door's stand on the ground first (the long walk), then up inside
        const plan = plans.get(id), door = r.entry;
        if (plan && door && myLevel === 0 && door.level === 0 && Math.hypot(door.p[0] - here[0], door.p[1] - here[1]) > 3 && !plan.steps.some((s) => s.verb === 'walk_to'))
          plans.set(id, { ...plan, steps: [...plan.steps.filter((s) => s.verb === 'stand'), { verb: 'walk_to', params: { to: door.p, standoff: 0 } }, ...plan.steps.filter((s) => s.verb !== 'stand')] });
        const other = b !== first ? `; ${first.ref}, the nearest ${q.ask.join(' ')}, has no ${q.floor === 'down' ? 'lower' : 'upper'} floor${withFloor(first) ? ' that can be reached' : ''}${skipped.length ? `, nor can ${skipped.join(', ')}'s be reached` : ''}` : '';
        return { id, note: ` (floor ${f} of ${b.ref}, ${b.what}${other})` };
      }
      if (b !== first) skipped.push(b.ref);
    }
    return { code: 'route.unreachable', reason: `${tries.length > 1 ? `The ${which.replace(/^an? /, '')} of ${tries.map((b) => b.ref).join(', ')}` : `Floor ${want(first)} of ${first.ref}`} cannot be reached right now${why ? ` (${why.replace(/[.\s]+$/, '')})` : ''}; nothing else was chosen in its place.` };
  }

  /** RT (2026-10-20): `run:<building>` / `jog:<room>`: the listing offers walks only to buildings and rooms (a gait per
   *  room bloated Eden 2026's list), so a named one gets its gait on demand: at that gait to the front door's stand
   *  outside, then the walk inside as offered. A thing with no door stand, or a Soul already at the door or upstairs, gets
   *  the walk at that gait as it is. True when `<gait>:<placeId>` was added. */
  gaitOnDemand(soul: EdgeSoul, placeId: string, gait: 'jog' | 'run', caps: EdgeCapability[], plans: Plans): boolean {
    const me = this.E.world.entities[soul.entityId]; if (!me?.human || !this.h.placeOf) return false;
    const id = `${gait}:${placeId}`; if (caps.some((c) => c.id === id)) return false;
    let walk = caps.find((c) => c.verb === 'walk' && c.target?.kind === 'place' && c.target.id === placeId);
    if (!walk && this.walkOnDemand(soul, placeId, caps, plans)) walk = caps.find((c) => c.verb === 'walk' && c.target?.kind === 'place' && c.target.id === placeId);
    const base = walk?.available ? plans.get(walk.id) : undefined; if (!walk || !base) return false;
    const t = this.thing(walk.id.slice('walk:'.length)), here: Vec2 = [me.pose.p[0], me.pose.p[2]];
    const door = t?.kind === 'building' && t.stands?.[0] ? { p: t.stands[0], level: t.level } : t?.kind === 'room' ? t.entry ?? null : null;
    const far = !!door && door.level === 0 && (me.human.level ?? 0) === 0 && Math.hypot(door.p[0] - here[0], door.p[1] - here[1]) > 3;
    const fast = (s: Step): Step => (s.verb === 'walk_to' ? { ...s, params: { ...s.params, gait } } : structuredClone(s));
    const steps: Step[] = far
      ? [...base.steps.filter((s) => s.verb === 'stand'), { verb: 'walk_to', params: { to: door!.p, gait, standoff: 0 } }, ...base.steps.filter((s) => s.verb !== 'stand' && !(s.verb === 'walk_to' && String(s.params.to) === String(door!.p)))]
      : base.steps.map(fast);
    const name = t?.ref ?? placeId, label = far ? `${gait === 'jog' ? 'Jog' : 'Run'} to the door of ${name.split('/')[0]}, then walk inside${t?.kind === 'room' ? ` to ${name}` : ''}` : `${gait === 'jog' ? 'Jog' : 'Run'} to ${name}`;
    caps.push({ ...walk, id, verb: gait, label });
    plans.set(id, { label, steps });
    return true;
  }

  private offerWalk(soul: EdgeSoul, t: Thing, d: number, at: { here: Vec2; myLevel: number; seated: boolean; exit: { p: Vec2; level: number } | null; keep?: NonNullable<MenuFocus['walkKeep']>['keep'] }, caps: EdgeCapability[], plans: Plans, onlyWalk=false) {
    const { here, myLevel, seated, exit } = at;
    const id = `walk:${t.ref}`; if (caps.some((c) => c.id === id)) return;
    const where = this.label(t, Math.round(d)), place = this.h.placeOf?.(t.ref);
    const target: EdgeCapability['target'] = t.semanticPart?.entity ? { id: t.semanticPart.entity, kind: 'object' } : place ? { id: place, kind: 'place' } : { id: t.id, kind: 'object' };
    // (srv-act-words D: a walk the focused words cannot choose is not built: no goal, no route check)
    if (at.keep && !at.keep({ id, verb: 'walk', label: where, ...(t.aliases?.length ? { aliases: t.aliases } : {}), target })) return;
    const g0 = this.goal(t, here, soul.entityId);
    // RESOLVE2: a goal up on a roof (or a raised floor) the main ground has no way up to is never offered as available
    // (a roof bench with no stair: the walk 'completed' in the lobby below)
    const E = this.E, cut = !!g0 && (g0.level > 0 || !!t.semanticPart) && !!E.navCheckV1 && !!E.navWarmV1?.(0) && E.navCheckV1([{ id, ...g0 }])[0]?.ok === false;
    const goal = cut ? null : g0;
    const cap: EdgeCapability = { id, verb: 'walk', label: where, ...(t.aliases?.length?{aliases:t.aliases}:{}), target, available: !!goal,
      ...(goal ? {} : { blocked: cut ? { code: 'route.unreachable', reason: `${t.ref} is up where no stair or ramp from the ground reaches.` } : this.blocked.has(t.ref) ? { code: 'route.unreachable', reason: this.blocked.get(t.ref)! } : { code: 'place.no-standing-room', reason: `There is no clear standing room at ${t.ref} right now.` } }) };
    caps.push(cap);
    if (!goal) return;
    const stand: Step[] = seated ? [{ verb: 'stand', params: {} }] : [];
    // on the ground from the ground: the ledger's walk (swims and wades where the way is water); else the level walk
    const go: Step = goal.level === 0 && myLevel === 0 ? { verb: 'walk_to', params: { to: goal.p, standoff: 0 } } : { verb: 'mars:walk_to', params: { x: goal.p[0], z: goal.p[1], level: goal.level } };
    // from a raised floor to somewhere far on the ground, first walk out of the building (the engine plans long walks
    // on the ground only: "too far to plan from an upper floor; walk down first" — Mars: kitchen dining hall -> Freeside)
    const down: Step[] = exit && goal.level === 0 && Math.hypot(goal.p[0] - here[0], goal.p[1] - here[1]) > DOWN_FIRST_M ? [{ verb: 'mars:walk_to', params: { x: exit.p[0], z: exit.p[1], level: exit.level } }] : [];
    plans.set(id, { label: `Walk to ${t.name}`, steps: [...stand, ...down, go] });
    if (t.semanticPart?.seat) {
      const target=t.semanticPart.seat, sid=`sit:${t.ref}`;
      // This invokes the engine's actual slot reservation/approach; the semantic name cannot create a seat.
      caps.push({id:sid,verb:'sit',label:`Sit at ${t.name} [${t.ref}]`,...(t.aliases?.length?{aliases:t.aliases}:{}),target:{id:target.entity,kind:'object'},available:true,params:{seconds:{type:'integer',min:1,max:600,default:600}}});
      plans.set(sid,{label:`Sit at ${t.name}`,steps:[...stand,...down,go,{verb:'mars:sit',params:{slot:`${target.entity}#${target.slot}`}},{verb:'rest',params:{seconds:600}}],seconds:true});
    }
    if (place&&!onlyWalk) this.placeCapabilities(t, place, here, d, [...stand, ...down, go], myLevel, caps, plans);
  }

  /** R4-INFO: what Eden offers at each of its places, at a god-built place too: hang out there (walk there, then spend
   *  a while), and for an open area big enough, a stroll through it (a loop of clear stops inside it). */
  private placeCapabilities(t: Thing, place: string, here: Vec2, d: number, go: Step[], myLevel: number, caps: EdgeCapability[], plans: Plans) {
    const secs = { seconds: { type: 'integer', min: 1, max: 600, default: 60 } };
    const hid = `hang-out:${t.ref}`;
    if (!caps.some((c) => c.id === hid) && t.kind !== 'water') {
      caps.push({ id: hid, verb: 'hang-out', label: `Hang out at ${t.ref} (${t.what}; ${Math.round(d)} m)`, target: { id: place, kind: 'place' }, available: true, params: secs });
      plans.set(hid, { label: `Hang out at ${t.ref}`, steps: [...go, { verb: 'rest', params: { seconds: 60 } }], seconds: true });
    }
    const poly = t.area; if (!poly || t.kind !== 'area' || myLevel !== 0 || polyArea(poly) < STROLL_AREA) return;
    const sid = `stroll:${t.ref}`; if (caps.some((c) => c.id === sid)) return;
    const spots = this.strollSpots(t.ref, poly); if (spots.length < 2) return;
    // a loop from the stop nearest me, each next the nearest not yet visited
    const left = [...spots], route: Vec2[] = [];
    let at = here; while (left.length) { left.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1])); at = left.shift()!; route.push(at); }
    caps.push({ id: sid, verb: 'stroll', label: `Stroll through ${t.ref} (a loop of ${route.length} stops)`, target: { id: place, kind: 'place' }, available: true, params: { pause: { type: 'integer', min: 0, max: 60, default: 4 } } });
    plans.set(sid, { label: `Stroll through ${t.ref}`, steps: [...go.filter((s) => s.verb === 'stand'), ...route.flatMap((p, i) => [{ verb: 'walk_to', params: { to: p } }, ...(i < route.length - 1 ? [{ verb: 'rest', params: { seconds: 4 } }] : [])])] });
  }
  private strolls = new Map<string, { key: string; spots: Vec2[] }>();
  /** The engine's navigation epoch, read once per tick and world version (each read syncs the planner, ~0.5 ms). */
  private epochMemo: { at: string; ep: number | undefined } | null = null;
  private navEpoch(): number | undefined {
    const at = `${this.E.world.tick}|${this.h.version?.() ?? this.h.model.editSeq}`;
    if (this.epochMemo?.at !== at) this.epochMemo = { at, ep: this.E.navEpochV1?.() };
    return this.epochMemo.ep;
  }
  private strollSpots(ref: string, poly: Vec2[]): Vec2[] {
    // L1: clear spots read only the static clearance (clearSpotsV1), so they are kept until a god edit (the area's outline)
    // or the navigation epoch (the static world) moves — not every engine writeback: after each walk a Soul's next listing
    // re-derived every area's spots (~200 nav tiles rebuilt, 6–10 s on Eden 2026)
    const ep = this.navEpoch(), key = ep === undefined ? this.cache?.key ?? '' : `${this.h.staticVersion?.() ?? this.cache?.key}|${ep}`;
    const hit = this.strolls.get(ref); if (hit?.key === key) return hit.spots;
    const f = this.E.clearSpotsV1;
    const spots = (f ? f.call(this.E, poly, 5) : []).map(([x, z]) => [r2(x), r2(z)] as Vec2);
    // (L1: was cleared past 200 areas; Eden 2026's listing reads more than that, so every listing recomputed them all)
    this.strolls.set(ref, { key, spots }); if (this.strolls.size > 4096) this.strolls.delete(this.strolls.keys().next().value!);
    return spots;
  }
  private label(t: Thing, d: number): string {
    const by = this.landmarks(t).map((x) => x.ref);
    if (t.kind === 'room') return `Go into ${t.name}, ${t.what} (${t.ref}; ${d} m)`;
    if (t.kind === 'building') return `Walk to ${t.name} [${t.ref}], ${t.what}: ${t.doorOpen ? 'in at its front door' : t.rooms?.length === 1 ? `inside, into ${t.rooms[0]}` : !t.inside && t.stands?.length ? 'inside via its entrance' : 'to its front door (closed)'} (${t.rooms?.length ?? 0} rooms, each walk:${t.ref}/<room>; ${d} m)`;
    if (t.kind === 'water') return `Walk to the shore of ${t.name} [${t.ref}], ${t.what} (${d} m)`;
    return `Walk to ${t.name} [${t.ref}], ${t.what}${by.length ? `, by ${by.join(' and ')}` : ''} (${d} m)`;
  }
  /** Named things within 15 m of a thing (its "by the X"), nearest first. */
  landmarks(t: Thing, n = 2): Thing[] {
    return this.byVersion(`l|${t.ref}|${n}`, () => this.within(t.at, 15).filter((o) => o.kind !== 'room' && o.id !== t.id && !t.ref.startsWith(o.ref + '/')).map((o) => ({ o, d: this.distance(o, t.at) })).filter((x) => x.d <= 15).sort(byDistanceThenRef).slice(0, n).map((x) => x.o));
  }
  /** Names of the named things within `within` m of a point (not `except`, not rooms), nearest first: "by the X". */
  namesNear(at: Vec2, except: string, n = 2, within = 12): string[] {
    return this.byVersion(`n|${at[0]},${at[1]}|${except}|${n}|${within}`, () => this.within(at, within).filter((o) => o.kind !== 'room' && o.id !== except).map((o) => ({ o, d: this.distance(o, at) })).filter((x) => x.d <= within).sort(byDistanceThenRef).slice(0, n).map((x) => x.o.ref));
  }
  /** L1: the things (rooms included) that can lie within `r` m of a point by `distance`, in things() order — a superset
   *  (callers filter by distance as before), so "by the X" answers are unchanged. A grid of each thing's box (a path's
   *  grown by half its width), rebuilt with the things list; was a scan of all ~3,000 Eden 2026 things per label
   *  (~1.2 s of a new Soul's first listing). */
  private within(at: Vec2, r: number): Thing[] {
    const all = this.things();
    if (this.grid?.of !== all) {
      const cells = new Map<number, number[]>(), always: number[] = [];
      all.forEach((t, i) => {
        const pts = t.area ?? t.path ?? t.poly ?? [t.at], pad = !t.area && t.path ? Math.max(0, (t.width ?? 3) / 2) : 0;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        if (!(x0 <= x1 && z0 <= z1) || !Number.isFinite(x0 + x1 + z0 + z1 + pad)) return;  // no outline: never within r
        const i0 = Math.floor((x0 - pad) / NEAR_CELL), i1 = Math.floor((x1 + pad) / NEAR_CELL), j0 = Math.floor((z0 - pad) / NEAR_CELL), j1 = Math.floor((z1 + pad) / NEAR_CELL);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) { always.push(i); return; }
        for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) { const k = cellKey(ci, cj), l = cells.get(k); if (l) l.push(i); else cells.set(k, [i]); }
      });
      this.grid = { of: all, cells, always };
    }
    const g = this.grid, m = r + 1, seen = new Set<number>(g.always);   // (+1 m: float slack; the caller's distance test decides)
    const i0 = Math.floor((at[0] - m) / NEAR_CELL), i1 = Math.floor((at[0] + m) / NEAR_CELL), j0 = Math.floor((at[1] - m) / NEAR_CELL), j1 = Math.floor((at[1] + m) / NEAR_CELL);
    if (!((i1 - i0 + 1) * (j1 - j0 + 1) <= 4096)) return all;
    for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) for (const i of g.cells.get(cellKey(ci, cj)) ?? []) seen.add(i);
    return [...seen].sort((a, b) => a - b).map((i) => all[i]);
  }
  private grid: { of: Thing[]; cells: Map<number, number[]>; always: number[] } | null = null;
  /** "by the X" answers depend only on the named things (index version): remembered until the world changes (each
   *  label scanned every thing: ~0.25 s of every capabilities sweep in the Eden 2026 cafe). */
  private nearMemo = new Map<string, unknown>();
  private nearOf: string | undefined;
  private byVersion<T>(key: string, f: () => T): T {
    this.things(); if (this.nearOf !== this.cache?.key) { this.nearMemo.clear(); this.nearOf = this.cache?.key; }
    if (this.nearMemo.has(key)) return this.nearMemo.get(key) as T;
    const v = f(); if (this.nearMemo.size > 50_000) this.nearMemo.clear(); this.nearMemo.set(key, v); return v;
  }
}

const NEAR_CELL = 16;
const cellKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
function polyDist(poly: Vec2[], p: Vec2) { return inPoly(p[0], p[1], poly) ? 0 : nearestOn(poly, p, true).d; }

function roomSamples(poly: Vec2[], at: Vec2, step = 0.6): Vec2[] {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]), candidates: Vec2[] = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step)
    if (inPoly(x, z, poly)) candidates.push([x, z]);
  return candidates.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1]));
}
